// Guard for duplication audit B3: the seed's ship rows carry explicit ids, so the server's `buildShip` resolves
// a trace's / handshake's `shipId` to THAT ship instead of silently falling back to the first player ship.
// Before the fix the seed rows had no `id` at all (the DB handed out sequence ids), so the match never fired —
// harmless with one flyable hull, wrong the day a second one ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, WEAPONS, SHIPS, STARTER_SHIP } from './catalog_seed.js';
import { buildCatalog, buildShip } from './sim-host.js';
import { catalogFromRows } from '../../client/src/sim-core/catalog.js';

test('every catalog ship has an explicit integer id, unique, equal to its seed row', () => {
  const cat = buildCatalog();
  const ids = [];
  for (const [name, s] of cat.shipByName) {
    assert.ok(Number.isInteger(s.id), `${name} has an integer id (got ${s.id})`);
    assert.equal(s.id, SHIPS.find((x) => x.name === name).id);
    ids.push(s.id);
  }
  assert.equal(new Set(ids).size, ids.length, 'ship ids are unique');
  assert.equal(ids.length, SHIPS.length);
  assert.equal(STARTER_SHIP.id, 1, 'the starter is ship 1 — every recorded trace carries shipId 1');
});

test('buildShip resolves shipId to that exact ship, not the first player ship', () => {
  // An extra PLAYER hull with a LOWER id sorts before the starter, so it is exactly what the fallback would
  // pick — the first assertion only holds if the id match really works.
  const extra = { ...STARTER_SHIP, id: 0, name: 'test hull', modelUrl: 'test.glb' };
  const cat = catalogFromRows({ weapons: WEAPONS, components: COMPONENTS, ships: [...SHIPS, extra] });
  assert.equal(buildShip(cat, { shipId: STARTER_SHIP.id }).modelUrl, STARTER_SHIP.modelUrl);
  assert.equal(buildShip(cat, { shipId: 0 }).modelUrl, 'test.glb');
});

test('an unknown shipId still falls back to the first player ship (old traces)', () => {
  const extra = { ...STARTER_SHIP, id: 0, name: 'test hull', modelUrl: 'test.glb' };
  const cat = catalogFromRows({ weapons: WEAPONS, components: COMPONENTS, ships: [...SHIPS, extra] });
  assert.equal(buildShip(cat, { shipId: 99999 }).modelUrl, 'test.glb', 'lowest-id player row');
  assert.equal(buildShip(buildCatalog(), { shipId: 99999 }).modelUrl, STARTER_SHIP.modelUrl);
  assert.equal(buildShip(buildCatalog(), {}).modelUrl, STARTER_SHIP.modelUrl);
});
