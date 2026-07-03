import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { up } from './migrations/019_backfill_grab.js';

// Validates the base-Grab backfill (migration 019) in isolation — a fresh server test DB has no pre-Grab
// players, so the migration wouldn't be exercised otherwise. Mirrors the Postgres backfill in
// db_postgres.js migrate(). NOTE: this file lives in src/ (NOT migrations/) so the migration runner's
// `^\d+_.*\.js$` scan doesn't mistake it for a migration.
test('019 backfill: grants base grab (29) only to grab-less explicit loadouts, idempotently', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE player_ships (id INTEGER PRIMARY KEY, components TEXT)');
  const ins = db.prepare('INSERT INTO player_ships (id, components) VALUES (?, ?)');
  ins.run(1, null);                                                  // NULL → inherits ship default (grab:29); untouched
  ins.run(2, JSON.stringify({ hull: 1, engine: 5, thruster: 8 }));   // pre-Grab loadout → gets grab 29
  ins.run(3, JSON.stringify({ hull: 1, engine: 5, grab: 30 }));      // already has a grab (advanced) → untouched
  ins.run(4, 'not json');                                            // malformed → skipped, no throw

  up(db);

  const get = db.prepare('SELECT components FROM player_ships WHERE id = ?');
  assert.equal(get.get(1).components, null);
  assert.deepEqual(JSON.parse(get.get(2).components), { hull: 1, engine: 5, thruster: 8, grab: 29 });
  assert.deepEqual(JSON.parse(get.get(3).components), { hull: 1, engine: 5, grab: 30 });
  assert.equal(get.get(4).components, 'not json');

  // idempotent: a second run is a no-op
  up(db);
  assert.deepEqual(JSON.parse(get.get(2).components), { hull: 1, engine: 5, thruster: 8, grab: 29 });
});
