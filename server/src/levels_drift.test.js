// Guard for the 0-BASED LEVEL RENUMBERING (db.js `levels_zero_based_ids`) and for DECISIONS §95.
//
// History this file exists to protect. `levels.id` was a BIGSERIAL and the old startup seed
// (`INSERT ... ON CONFLICT (name) DO UPDATE`) burned a sequence value on EVERY boot, so production ids
// drifted to 1, 6, 7, 71, 564 for level-1..level-5 — and hardcoded numeric thresholds (`>= 5` board,
// `>= 3` shop) fired a level or three early for everyone. The fix then was to gate by level NAME.
// The fix NOW goes further: a level's id, name and displayed title are the same 0-based campaign number,
// seeded explicitly and upserted `ON CONFLICT (id)` so nothing drifts again — because three numbers that
// disagreed (row `level-4` = "Level 3" = progress 4) cost real debugging time twice in one session.
//
// So there are two things to pin, and both are here:
//   1. the migration MOVES a legacy database — drifted ids, old names, players pointing at them, recorded
//      sessions carrying the old names — onto 0..4 without losing anyone's progress;
//   2. the content gates still resolve by NAME, never by a raw id.
//
// This file runs against its OWN throwaway database: it re-numbers `levels`, which
// `players.current_progress REFERENCES levels(id)` (no ON UPDATE CASCADE) forbids once any player exists,
// and mutating `levels` inside the shared `spacegame_test` would race the other test files (`node --test`
// runs one child process per file, in parallel) and the visual runner's server.
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
await db.migrate();                                       // schema + a correctly-numbered 0..4 seed

// The exact pre-renumbering production shape, name → drifted id. Guarded below so a future extra level
// fails loudly instead of silently skewing the expectations.
const LEGACY_IDS = { 'level-1': 1, 'level-2': 6, 'level-3': 7, 'level-4': 71, 'level-5': 564 };
const LEGACY_OF = { 0: 'level-1', 1: 'level-2', 2: 'level-3', 3: 'level-4', 4: 'level-5' };

// Rewind this database to the legacy shape so the migration has something real to move: undo its ledger
// claim, put the old names + drifted ids back, and point players/sessions at them.
async function rewindToLegacy() {
  const seeded = (await db.pool.query('SELECT id, name FROM levels ORDER BY id')).rows;
  assert.deepEqual(seeded.map((r) => r.name), ['level-0', 'level-1', 'level-2', 'level-3', 'level-4'],
    'the seed holds exactly level-0..level-4 — extend LEGACY_IDS/LEGACY_OF if a level was added');
  await db.pool.query(`DELETE FROM migrations_pg WHERE name = 'levels_zero_based_ids'`);
  await db.pool.query('ALTER TABLE players DROP CONSTRAINT IF EXISTS players_current_progress_fkey');
  // Park BOTH columns clear of the target values before assigning: the ids collide across ranges and the
  // names collide with each other (0-based `level-1` and legacy `level-1` are different levels), and
  // `levels.name` is UNIQUE — the same two-phase move the migration itself has to make.
  await db.pool.query(`UPDATE levels SET id = id + 900000, name = 'tmp-' || name`);
  // players move in lockstep or the FK re-add below fails — earlier tests leave rows behind
  await db.pool.query('UPDATE players SET current_progress = current_progress + 900000');
  for (const [zeroBased, legacyName] of Object.entries(LEGACY_OF)) {
    await db.pool.query('UPDATE players SET current_progress = $1 WHERE current_progress = $2',
      [LEGACY_IDS[legacyName], Number(zeroBased) + 900000]);
    await db.pool.query('UPDATE levels SET id = $1, name = $2 WHERE id = $3',
      [LEGACY_IDS[legacyName], legacyName, Number(zeroBased) + 900000]);
  }
  await db.pool.query(`ALTER TABLE players ADD CONSTRAINT players_current_progress_fkey
                       FOREIGN KEY (current_progress) REFERENCES levels(id)`);
  await db.pool.query('ALTER TABLE players ALTER COLUMN current_progress SET DEFAULT 1');
  await db.pool.query(`SELECT setval('levels_id_seq', 1000)`);
}

const { createApp } = await import('./server.js');
const app = await createApp();
const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const base = `http://localhost:${server.address().port}`;

after(async () => {
  server.close();
  await db.pool.end();
  await sql(admin.href, `DROP DATABASE IF EXISTS ${DRIFT_DB} WITH (FORCE)`);
});

test('the renumbering migration moves a legacy database onto 0..4 without losing progress', async () => {
  await rewindToLegacy();
  // A player mid-campaign on the legacy shape: id 71 == `level-4` == the player-facing "Level 3".
  await db.pool.query(`INSERT INTO players (id, created_at, last_seen, current_progress)
                       VALUES ('legacy-mid', 1, 1, $1)`, [LEGACY_IDS['level-4']]);
  await db.pool.query(`INSERT INTO players (id, created_at, last_seen, current_progress)
                       VALUES ('legacy-new', 1, 1, $1)`, [LEGACY_IDS['level-1']]);
  // and a recorded session tagged with the legacy name (what /admin/sessions resolves against). Inserted
  // directly rather than via recordSession, which would want to upload the trace to S3.
  await db.pool.query(`INSERT INTO gameplay_sessions (id, player_id, level, outcome, duration_ms, kills, s3_key, created_at)
                       VALUES ('legacy-sess', 'legacy-mid', 'level-4', 'win', 1000, 3, 'recordings/legacy.json', 1)`);

  await db.migrate();                    // ← the migration under test

  const levels = (await db.pool.query('SELECT id, name, descriptor->>\'title\' AS title FROM levels ORDER BY id')).rows;
  assert.deepEqual(levels.map((r) => Number(r.id)), [0, 1, 2, 3, 4], 'ids are exactly 0..4, no legacy rows left behind');
  for (const r of levels) {
    assert.equal(r.name, `level-${r.id}`, 'the row name carries the same number as the id');
    assert.equal(r.title, `Level ${r.id}`, 'and so does the displayed title — one number per level');
  }
  // progress moved BY NAME, not by arithmetic on the drifted id
  const prog = async (id) => Number((await db.pool.query('SELECT current_progress FROM players WHERE id = $1', [id])).rows[0].current_progress);
  assert.equal(await prog('legacy-mid'), 3, 'the player on legacy `level-4` is now on level 3 — the same content');
  assert.equal(await prog('legacy-new'), 0, 'and the one on the intro is on level 0');
  // stored session names were rewritten so the admin view still resolves them
  const sess = (await db.pool.query("SELECT level FROM gameplay_sessions WHERE id = 'legacy-sess'")).rows[0];
  assert.equal(sess.level, 'level-3', 'recorded sessions carry the renumbered level name');
  // the FK and the new default survived the swap
  const fk = await db.pool.query(`SELECT 1 FROM pg_constraint WHERE conname = 'players_current_progress_fkey'`);
  assert.equal(fk.rows.length, 1, 'the progress foreign key is back');
  const def = await db.pool.query(`SELECT column_default FROM information_schema.columns
                                   WHERE table_name = 'players' AND column_name = 'current_progress'`);
  assert.equal(def.rows[0].column_default, '0', 'a new player now defaults to the intro, level 0');

  await db.migrate();                    // idempotent: a second boot must not move anything again
  assert.equal(await prog('legacy-mid'), 3, 're-running the migration is a no-op');
});

test('a level row outside the known campaign never costs its players their progress', async () => {
  // A hand-added or long-removed level row is the one shape the name map cannot place. Deleting it and
  // sending its players to the intro would be silent data loss on a live database — the migration leaves
  // both parked instead, still referencing each other.
  await rewindToLegacy();
  await db.pool.query(`INSERT INTO levels (id, name, descriptor) VALUES (777, 'level-experimental', '{}'::jsonb)`);
  await db.pool.query(`INSERT INTO players (id, created_at, last_seen, current_progress)
                       VALUES ('orphan-1', 1, 1, 777)`);

  await db.migrate();

  const known = (await db.pool.query('SELECT id, name FROM levels WHERE id < 1000 ORDER BY id')).rows;
  assert.deepEqual(known.map((r) => r.name), ['level-0', 'level-1', 'level-2', 'level-3', 'level-4'],
    'the campaign still lands on 0..4');
  const orphan = (await db.pool.query(`SELECT id FROM levels WHERE name = 'level-experimental'`)).rows[0];
  assert.ok(orphan, 'the unknown row survives instead of being deleted');
  const pl = (await db.pool.query(`SELECT current_progress FROM players WHERE id = 'orphan-1'`)).rows[0];
  assert.equal(Number(pl.current_progress), Number(orphan.id),
    'and its player still points at it — same content, no progress lost');
  // clean up so the later gate tests see the ordinary shape
  await db.pool.query(`DELETE FROM players WHERE id = 'orphan-1'`);
  await db.pool.query(`DELETE FROM levels WHERE name = 'level-experimental'`);
});

test('progress gates resolve by level NAME, never by a raw id', async () => {
  await db.registerPlayer('gate-1');
  const gates = async () => {
    const a = await db.getActivePlayerShip('gate-1');
    const { rows } = await db.pool.query('SELECT current_progress FROM players WHERE id = $1', ['gate-1']);
    return { progress: Number(rows[0].current_progress), shop: a.shopUnlocked, board: a.sideMissionsUnlocked };
  };
  const missionsStatus = async () => (await fetch(`${base}/api/players/gate-1/missions`)).status;

  assert.deepEqual(await gates(), { progress: 0, shop: false, board: false }, 'fresh player: the intro, both locked');

  await db.advanceProgress('gate-1');   // → level-1 ("Level 1" briefing — the first playable level)
  assert.deepEqual(await gates(), { progress: 1, shop: false, board: false },
    'on the "Level 1" briefing both gates stay CLOSED');
  assert.equal(await missionsStatus(), 403, 'GET /missions is 403 on the "Level 1" briefing');

  await db.advanceProgress('gate-1');   // → level-2: the briefing's unlockShop action runs
  assert.deepEqual(await gates(), { progress: 2, shop: true, board: false },
    'shop opens after clearing the first playable level; the board does not');

  await db.advanceProgress('gate-1');   // → level-3
  assert.deepEqual(await gates(), { progress: 3, shop: true, board: false }, 'board still locked at "Level 3"');

  await db.advanceProgress('gate-1');   // → level-4: the board opens
  assert.deepEqual(await gates(), { progress: 4, shop: true, board: true },
    'the board opens only on reaching level-4, after clearing "Level 3"');
  assert.equal(await missionsStatus(), 200, 'GET /missions serves the board once level-4 is reached');

  // The helper itself, including the fail-closed case (missing row → locked, never "open by default").
  assert.equal(await db.reachedLevel(3, 'level-4'), false);
  assert.equal(await db.reachedLevel(4, 'level-4'), true);
  assert.equal(await db.reachedLevel(4, 'no-such-level'), false, 'fail-closed on an absent level row');
});

test('the boot shop backfill uses the level name, not a bare number', async () => {
  await db.registerPlayer('gate-early');
  await db.registerPlayer('gate-past');
  await db.pool.query(`UPDATE players SET current_progress = (SELECT id FROM levels WHERE name = 'level-1'),
    shop_unlocked = 0 WHERE id = 'gate-early'`);
  await db.pool.query(`UPDATE players SET current_progress = (SELECT id FROM levels WHERE name = 'level-2'),
    shop_unlocked = 0 WHERE id = 'gate-past'`);
  await db.pool.query(`DELETE FROM stash WHERE player_id IN ('gate-early', 'gate-past')
    AND kind = 'weapon' AND ref_id = 1`);
  await db.migrate();                    // idempotent re-run — exercises the boot backfill

  const shop = async (id) => Number((await db.pool.query('SELECT shop_unlocked FROM players WHERE id = $1', [id])).rows[0].shop_unlocked);
  assert.equal(await shop('gate-early'), 0, 'still on the first playable level → shop stays locked');
  assert.equal(await shop('gate-past'), 1, 'past the first playable level (level-2) → shop backfilled');
  const gun = await db.pool.query("SELECT qty FROM stash WHERE player_id = 'gate-past' AND kind = 'weapon' AND ref_id = 1");
  assert.equal(gun.rows[0].qty, 1, 'basic gun backfilled into the stash');
  const noGun = await db.pool.query("SELECT 1 FROM stash WHERE player_id = 'gate-early' AND kind = 'weapon' AND ref_id = 1");
  assert.equal(noGun.rows.length, 0, 'the still-locked player gets no gun');
});
