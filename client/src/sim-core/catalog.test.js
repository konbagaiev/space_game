// Guard for the ONE catalog flattener (duplication audit C8). Before this module existed the browser
// (main.js bootstrap) and the server (sim-host.buildCatalog) each hand-wrote the same flatten of catalog
// rows into the shape the sim reads. `legacyFlatten` below is a verbatim copy of the server's old version,
// kept here so the swap is pinned against what both hosts produced before — with ONE deliberate change:
// ships are now id-ordered on both hosts (DECISIONS §168), so `enemyShips` is compared sorted by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, WEAPONS, SHIPS } from '../../../server/src/catalog_seed.js';
import { catalogFromRows, emptyCatalog, shipById } from './catalog.js';

// Copied from server/src/sim-host.js buildCatalog @ 695b907 (minus the level lookup, which stays per host).
function legacyFlatten({ weapons, components, ships }) {
  const catalog = { weapons: new Map(), components: new Map(), enemyShips: [], shipByName: new Map() };
  for (const w of weapons) {
    catalog.weapons.set(w.id, {
      id: w.id, name: w.name, type: w.type, price: w.price,
      modelUrl: w.modelUrl, modelUrlHigh: w.modelUrlHigh, rarity: w.rarity, color: w.color, ...w.stats,
    });
  }
  for (const c of components) catalog.components.set(c.id, c);
  catalog.enemyShips = ships.filter((s) => s.type === 'enemy');
  for (const s of ships) catalog.shipByName.set(s.name, s);
  return catalog;
}

const seed = { weapons: WEAPONS, components: COMPONENTS, ships: SHIPS };

test('catalogFromRows over the seed equals the legacy flatten (enemyShips id-sorted)', () => {
  const cat = catalogFromRows(seed);
  const old = legacyFlatten(seed);
  assert.deepStrictEqual(cat.weapons, old.weapons);
  assert.deepStrictEqual(cat.components, old.components);
  assert.deepStrictEqual(cat.shipByName, old.shipByName);
  assert.deepStrictEqual(cat.enemyShips, [...old.enemyShips].sort((a, b) => a.id - b.id));
  assert.equal(cat.level, null);
  assert.equal(cat.levelName, null);
});

test('ships are id-ordered: enemyShips ascending, shipByName iterates in id order', () => {
  const cat = catalogFromRows(seed);
  const ids = cat.enemyShips.map((s) => s.id);
  assert.ok(ids.length > 1);
  for (const id of ids) assert.ok(Number.isInteger(id), `ship id ${id} is an explicit integer`);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  const all = [...cat.shipByName.values()].map((s) => s.id);
  assert.deepEqual(all, [...all].sort((a, b) => a - b));
});

test('component and ship rows are the SAME objects as the seed rows (no clone); weapons are flattened copies', () => {
  const cat = catalogFromRows(seed);
  for (const c of COMPONENTS) assert.equal(cat.components.get(c.id), c);
  for (const s of SHIPS) assert.equal(cat.shipByName.get(s.name), s);
  for (const s of cat.enemyShips) assert.ok(SHIPS.includes(s));
  // weapons: equal, not identical — the stats are spread to the top level
  for (const w of WEAPONS) assert.notEqual(cat.weapons.get(w.id), w);
});

test('catalogFromRows does not mutate the input ships array', () => {
  const ships = [...SHIPS].reverse();
  const before = ships.map((s) => s.id);
  catalogFromRows({ ...seed, ships });
  assert.deepEqual(ships.map((s) => s.id), before);
});

test('refilling the same target clears stale entries and keeps the target identity', () => {
  const target = emptyCatalog();
  target.level = { marker: true };
  const extraShip = { id: 999999, name: 'stale test hull', type: 'enemy', stats: {} };
  const out1 = catalogFromRows({ weapons: [...WEAPONS, { id: 999999, name: 'stale gun', type: 'gun', stats: {} }],
    components: [...COMPONENTS, { id: 999999, name: 'stale comp' }], ships: [...SHIPS, extraShip] }, target);
  assert.equal(out1, target);
  assert.ok(target.shipByName.has('stale test hull'));
  const out2 = catalogFromRows(seed, target);
  assert.equal(out2, target);
  assert.equal(target.weapons.has(999999), false);
  assert.equal(target.components.has(999999), false);
  assert.equal(target.shipByName.has('stale test hull'), false);
  assert.equal(target.enemyShips.includes(extraShip), false);
  assert.deepEqual(target.level, { marker: true }, 'level is not catalogFromRows business (Phase 4 / B4)');
  assert.equal(target.shipByName.size, SHIPS.length);
});

test('shipById resolves every seed ship by its explicit id; unknown → null', () => {
  const cat = catalogFromRows(seed);
  for (const s of SHIPS) assert.equal(shipById(cat, s.id), s);
  assert.equal(shipById(cat, 123456789), null);
  assert.equal(shipById(cat, undefined), null);
});
