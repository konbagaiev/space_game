// Guard for the SHIP-ID RECONCILE (db.js `reconcileShipIds`, DECISIONS §168, duplication audit B3).
//
// The seed's ships now carry explicit ids equal to production's (1, 132, 141, 368…375, 2329) and the startup
// upsert keys on `id`. Every other database numbered its ships with the old name-keyed upsert's sequence — a
// local dev DB holds 1..9 + 1337, a fresh test DB used to hold 1..10. Without the reconcile, the explicit
// `INSERT id=368 'Basic pirate ship'` hits UNIQUE(name) against that DB's row 2 and the server cannot boot.
//
// What this pins, against a reproduced mis-numbered DB STATE (not just the logic):
//   (a) a local-shaped DB is moved onto the seed ids, a stale row squatting a seed id is pruned, the player's
//       ship stays joined, the FK is back, the sequence clears the ids, nothing is left parked;
//   (b) a player_ships row on a mis-numbered PLAYER ship moves with it (the FK lockstep path);
//   (c) it is idempotent, and a drifted sequence (prod's 2929) is pulled back to the max id;
//   (d) a seed RENAME is not a mismatch: the row keeps its id + player_ships and is renamed in place.
//
// Own throwaway database (like levels_drift.test.js): renumbering `ships` inside the shared spacegame_test
// would race the other test files (one process per file, in parallel) and the visual runner's server.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const BASE = process.env.DATABASE_URL || 'postgres://localhost:5432/spacegame_test';
const SHIPS_DB = 'spacegame_test_ships';
const admin = new URL(BASE); admin.pathname = '/postgres';
const own = new URL(BASE); own.pathname = '/' + SHIPS_DB;

const sql = async (url, q) => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await c.query(q); } finally { await c.end(); }
};

await sql(admin.href, `DROP DATABASE IF EXISTS ${SHIPS_DB} WITH (FORCE)`);
await sql(admin.href, `CREATE DATABASE ${SHIPS_DB}`);
process.env.DATABASE_URL = own.href;                      // the pool reads this at import time
const db = await import('./db.js');
const { SHIPS } = await import('./catalog_seed.js');
await db.migrate();                                       // schema + a correctly-numbered seed
await db.registerPlayer('ships-drift-pilot');             // owns the starter ship (player_ships → ship 1)

after(async () => {
  await db.pool.end();
  await sql(admin.href, `DROP DATABASE IF EXISTS ${SHIPS_DB} WITH (FORCE)`);
});

const q = (text, params) => db.pool.query(text, params);
const idsByName = async () => Object.fromEntries((await q('SELECT id, name FROM ships')).rows.map((r) => [r.name, Number(r.id)]));
const shipList = async () => (await q('SELECT id, name FROM ships ORDER BY id')).rows.map((r) => `${r.id}:${r.name}`);
const seqValue = async () => Number((await q('SELECT last_value FROM ships_id_seq')).rows[0].last_value);
const fkExists = async () => (await q(`SELECT 1 FROM pg_constraint WHERE conname = 'player_ships_ship_id_fkey'`)).rows.length === 1;
const pilotShip = async () => (await q(
  `SELECT ps.ship_id, s.name FROM player_ships ps JOIN ships s ON s.id = ps.ship_id WHERE ps.player_id = 'ships-drift-pilot'`)).rows;
const parkedCount = async () => Number((await q('SELECT COUNT(*) AS n FROM ships WHERE id >= $1', [db.SHIP_PARK])).rows[0].n);

// Rewind to the shape a local dev DB has: ids handed out in seed order by the old sequence — the player at
// `playerId` (1 locally; 50 for the FK-path test), the nine enemies at 2..10 — plus a stale enemy row
// squatting the seed id 368 and a drifted sequence.
async function rewindToLocalShape({ playerId = 1 } = {}) {
  assert.equal(SHIPS.length, 10, 'the seed holds 10 ships — extend the local-shape map if one was added');
  await q('ALTER TABLE player_ships DROP CONSTRAINT IF EXISTS player_ships_ship_id_fkey');
  await q(`UPDATE ships SET id = id + 900000, name = 'tmp-' || name`);
  await q('UPDATE player_ships SET ship_id = ship_id + 900000');
  let next = 2;
  for (const s of SHIPS) {             // matched by NAME, so the rewind works whatever ids the DB held
    const local = s.type === 'player' ? playerId : next++;
    const parked = Number((await q('SELECT id FROM ships WHERE name = $1', ['tmp-' + s.name])).rows[0].id);
    await q('UPDATE player_ships SET ship_id = $1 WHERE ship_id = $2', [local, parked]);
    await q('UPDATE ships SET id = $1, name = $2 WHERE id = $3', [local, s.name, parked]);
  }
  await q(`INSERT INTO ships (id, name, type, stats, model_url, model_url_high, components)
           SELECT 368, 'zzz stale (test)', type, stats, model_url, model_url_high, components FROM ships WHERE id = 2`);
  await q(`ALTER TABLE player_ships ADD CONSTRAINT player_ships_ship_id_fkey FOREIGN KEY (ship_id) REFERENCES ships(id)`);
  await q(`SELECT setval('ships_id_seq', 1000)`);
}

async function assertOnSeedIds() {
  const ids = await idsByName();
  for (const s of SHIPS) assert.equal(ids[s.name], s.id, `${s.name} is on its seed id`);
  assert.equal(ids['zzz stale (test)'], undefined, 'the stale row squatting a seed id is pruned');
  assert.equal(Object.keys(ids).length, SHIPS.length);
  assert.equal(await parkedCount(), 0, 'nothing left parked');
  assert.ok(await fkExists(), 'player_ships_ship_id_fkey is back');
  assert.ok(await seqValue() >= 2329, 'ships_id_seq clears the explicit ids');
}

test('(a) a local-shaped DB (player 1, enemies 2..10, a stale row on 368) is moved onto the seed ids', async () => {
  await rewindToLocalShape();
  const before = await idsByName();
  assert.equal(before['Basic pirate ship'], 2, 'the rewind really produced the local shape');
  await db.migrate();
  await assertOnSeedIds();
  assert.deepEqual(await pilotShip(), [{ ship_id: '1', name: 'Basic player ship' }]);
});

test('(b) a player_ships row on a mis-numbered player ship moves with it (FK lockstep)', async () => {
  await rewindToLocalShape({ playerId: 50 });
  assert.deepEqual(await pilotShip(), [{ ship_id: '50', name: 'Basic player ship' }], 'rewound onto 50');
  await db.migrate();
  await assertOnSeedIds();
  assert.deepEqual(await pilotShip(), [{ ship_id: '1', name: 'Basic player ship' }]);
});

test('(c) idempotent: a second reconcile moves nothing; a drifted sequence is pulled back to the max id', async () => {
  const list = await shipList();
  assert.deepEqual(await db.reconcileShipIds(SHIPS), { moved: [], parked: [] });
  await q(`SELECT setval('ships_id_seq', 2929)`);         // prod's drifted value
  await db.migrate();
  assert.equal(await seqValue(), 2329);
  assert.deepEqual(await shipList(), list, 'no id or name changed');
  assert.deepEqual(await db.reconcileShipIds(SHIPS), { moved: [], parked: [] });
});

test('(d) a seed rename is NOT a mismatch: the row keeps its id and player_ships, renamed in place', async () => {
  // player ship
  await q(`UPDATE ships SET name = 'old player hull name' WHERE id = 1`);
  assert.deepEqual(await db.reconcileShipIds(SHIPS), { moved: [], parked: [] }, 'nothing moved or parked');
  await db.migrate();
  assert.equal((await q('SELECT name FROM ships WHERE id = 1')).rows[0].name, 'Basic player ship');
  assert.deepEqual(await pilotShip(), [{ ship_id: '1', name: 'Basic player ship' }]);
  assert.equal(await parkedCount(), 0);
  assert.equal((await q(`SELECT 1 FROM ships WHERE name = 'old player hull name'`)).rows.length, 0);
  // enemy ship
  await q(`UPDATE ships SET name = 'old pirate name' WHERE id = 368`);
  assert.deepEqual(await db.reconcileShipIds(SHIPS), { moved: [], parked: [] });
  await db.migrate();
  assert.equal((await q('SELECT name FROM ships WHERE id = 368')).rows[0].name, 'Basic pirate ship',
    'renamed back in place, not pruned + re-inserted');
  assert.equal(await parkedCount(), 0);
  assert.equal((await q(`SELECT 1 FROM ships WHERE name = 'old pirate name'`)).rows.length, 0);
  await assertOnSeedIds();
});
