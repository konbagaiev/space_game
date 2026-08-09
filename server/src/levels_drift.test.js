// Regression guard for DECISIONS §95: progress gates must resolve by level NAME, never by a raw
// `levels.id`. `levels.id` is a BIGSERIAL and the startup seed's `INSERT ... ON CONFLICT (name) DO UPDATE`
// still burns a sequence value on every boot, so production ids had drifted to 1, 6, 7, 71, 564 — and the
// old hardcoded thresholds (`>= 5` board, `>= 3` shop) fired a level (or three) early for everyone.
//
// This file runs against its OWN throwaway database: reproducing the drift means re-numbering `levels`,
// which `players.current_progress REFERENCES levels(id)` (no ON UPDATE CASCADE) forbids once any player
// exists, and mutating `levels` inside the shared `spacegame_test` would race the other test files
// (`node --test` runs one child process per file, in parallel) and the visual runner's server.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

// Isolated DB: never touch spacegame_test (the shared suite + the visual runner use it).
const BASE = process.env.DATABASE_URL || 'postgres://localhost:5432/spacegame_test';
const DRIFT_DB = 'spacegame_test_drift';
const admin = new URL(BASE); admin.pathname = '/postgres';          // maintenance connection
const drift = new URL(BASE); drift.pathname = '/' + DRIFT_DB;

const sql = async (url, q) => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await c.query(q); } finally { await c.end(); }
};

await sql(admin.href, `DROP DATABASE IF EXISTS ${DRIFT_DB} WITH (FORCE)`);
await sql(admin.href, `CREATE DATABASE ${DRIFT_DB}`);
process.env.DATABASE_URL = drift.href;                    // the pool reads this at import time
const db = await import('./db.js');
await db.migrate();

// The exact production shape. Guarded so a future extra level fails loudly instead of silently skewing
// the expectations below.
const PROD_IDS = { 'level-1': 1, 'level-2': 6, 'level-3': 7, 'level-4': 71, 'level-5': 564 };
const seeded = (await db.pool.query('SELECT name FROM levels ORDER BY id')).rows.map((r) => r.name);
assert.deepEqual(seeded, Object.keys(PROD_IDS),
  'the seed still holds exactly level-1..level-5 — extend PROD_IDS if a level was added');
// Safe as one statement: no player rows exist yet (no FK references) and the new ids {1,6,7,71,564}
// do not collide with the remaining old ids {1..5}.
await db.pool.query(`UPDATE levels SET id = CASE name
  WHEN 'level-2' THEN 6 WHEN 'level-3' THEN 7 WHEN 'level-4' THEN 71 WHEN 'level-5' THEN 564 ELSE id END`);
await db.pool.query("SELECT setval('levels_id_seq', 1000)");   // future inserts can't collide

// One HTTP-level check that the flag really reaches the wire (server.js forwards it verbatim).
const { createApp } = await import('./server.js');
const app = await createApp();
const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const base = `http://localhost:${server.address().port}`;

after(async () => {
  server.close();
  await db.pool.end();
  await sql(admin.href, `DROP DATABASE IF EXISTS ${DRIFT_DB} WITH (FORCE)`);
});

test('drifted level ids: the side-mission board opens by level NAME, not by a raw progress id', async () => {
  await db.registerPlayer('drift-1');
  const gates = async () => {
    const a = await db.getActivePlayerShip('drift-1');
    const { rows } = await db.pool.query('SELECT current_progress FROM players WHERE id = $1', ['drift-1']);
    return { progress: Number(rows[0].current_progress), shop: a.shopUnlocked, board: a.sideMissionsUnlocked };
  };
  const missionsStatus = async () => (await fetch(`${base}/api/players/drift-1/missions`)).status;

  assert.deepEqual(await gates(), { progress: 1, shop: false, board: false }, 'fresh player: level-1 ("Level 0"), both locked');

  await db.advanceProgress('drift-1');   // → level-2 ("Level 1" briefing — the first playable level)
  // THE production bug: id 6 satisfied both `>= 5` (board) and `>= 3` (shop), so a player who had not yet
  // flown the first playable level was handed the side-mission board AND the hangar shop.
  assert.deepEqual(await gates(), { progress: 6, shop: false, board: false },
    'on the "Level 1" briefing (drifted id 6) both gates stay CLOSED');
  assert.equal(await missionsStatus(), 403, 'GET /missions is 403 on the "Level 1" briefing');

  await db.advanceProgress('drift-1');   // → level-3 ("Level 2"): the briefing's unlockShop action runs
  assert.deepEqual(await gates(), { progress: 7, shop: true, board: false },
    'shop opens after clearing the first playable level; the board does not');

  await db.advanceProgress('drift-1');   // → level-4 ("Level 3")
  assert.deepEqual(await gates(), { progress: 71, shop: true, board: false }, 'board still locked at "Level 3"');

  await db.advanceProgress('drift-1');   // → level-5 ("Level 4"): the board opens
  assert.deepEqual(await gates(), { progress: 564, shop: true, board: true },
    'the board opens only on reaching level-5, after clearing "Level 3"');
  assert.equal(await missionsStatus(), 200, 'GET /missions serves the board once level-5 is reached');

  // The helper itself, including the fail-closed case (missing row → locked, never "open by default").
  assert.equal(await db.reachedLevel(6, 'level-5'), false);
  assert.equal(await db.reachedLevel(564, 'level-5'), true);
  assert.equal(await db.reachedLevel(564, 'no-such-level'), false, 'fail-closed on an absent level row');
});

test('drifted level ids: the boot shop backfill uses the level name, not `>= 3`', async () => {
  await db.registerPlayer('drift-early');
  await db.registerPlayer('drift-past');
  await db.pool.query(`UPDATE players SET current_progress = (SELECT id FROM levels WHERE name = 'level-2'),
    shop_unlocked = 0 WHERE id = 'drift-early'`);                                     // → 6
  await db.pool.query(`UPDATE players SET current_progress = (SELECT id FROM levels WHERE name = 'level-3'),
    shop_unlocked = 0 WHERE id = 'drift-past'`);                                      // → 7
  await db.pool.query(`DELETE FROM stash WHERE player_id IN ('drift-early', 'drift-past')
    AND kind = 'weapon' AND ref_id = 1`);
  await db.migrate();                    // idempotent re-run — exercises the boot backfill

  const shop = async (id) => Number((await db.pool.query('SELECT shop_unlocked FROM players WHERE id = $1', [id])).rows[0].shop_unlocked);
  assert.equal(await shop('drift-early'), 0,
    'still on the first playable level → shop stays locked, even though its raw id 6 >= 3');
  assert.equal(await shop('drift-past'), 1, 'past the first playable level (level-3) → shop backfilled');
  const gun = await db.pool.query("SELECT qty FROM stash WHERE player_id = 'drift-past' AND kind = 'weapon' AND ref_id = 1");
  assert.equal(gun.rows[0].qty, 1, 'basic gun backfilled into the stash');
  const noGun = await db.pool.query("SELECT 1 FROM stash WHERE player_id = 'drift-early' AND kind = 'weapon' AND ref_id = 1");
  assert.equal(noGun.rows.length, 0, 'the still-locked player gets no gun');
});
