// Guard for duplication audit B3: the seed's ship rows carry explicit ids, so the server's `buildShip` resolves
// a trace's / handshake's `shipId` to THAT ship instead of silently falling back to the first player ship.
// Before the fix the seed rows had no `id` at all (the DB handed out sequence ids), so the match never fired —
// harmless with one flyable hull, wrong the day a second one ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, WEAPONS, SHIPS, STARTER_SHIP } from './catalog_seed.js';
import { buildCatalog, buildShip, createSimWorld } from './sim-host.js';
import { catalogFromRows } from '../../client/src/sim-core/catalog.js';
import { applyFightSpec, NO_FIGHT_SPEC } from '../../client/src/sim-core/fight-spec.js';
import { readFileSync } from 'node:fs';

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

// ---------- the fight spec (duplication audit B4/B5) ----------

// EQUIVALENCE, not a fail-on-old guard: sim-host already applied this order before the spec existed. It pins
// "the client and the server build the same descriptor" from here on — both now call the same function.
const COMBOS = [{}, { ally: 'clear-out' }, { lancer: 'wave-1' }, { duel: { aces: 2 } }, { ally: 'clear-out', lancer: 'wave-1' },
  { ally: 'clear-out', duel: { aces: 2 } }, { lancer: 'wave-1', duel: { aces: 2 } },
  { ally: 'clear-out', lancer: 'wave-1', duel: { aces: 2 } }, { beam: true }];
for (const combo of COMBOS) {
  test(`createSimWorld builds the same level-4 descriptor the client does: ${JSON.stringify(combo)}`, () => {
    const w = createSimWorld({ levelName: 'level-4', ...combo });
    assert.deepEqual(w.catalog.level, applyFightSpec(buildCatalog('level-4').level, { ...NO_FIGHT_SPEC, ...combo }));
  });
}

// FAILS ON OLD CODE: `buildShip` ignored `duel`, so a room flew the account's own gear under a duel room.
test('a duel world flies the duel KIT over the account\'s beam loadout and its components', () => {
  const w = createSimWorld({ levelName: 'level-1', duel: { aces: 2 }, ship: { shipId: 1,
    loadout: { mounts: [{ weapon: 12, group: 'gun', offset: 0, delay: 0 }, { weapon: 3, group: 'rocket', offset: 0, delay: 0 }] },
    components: { hull: 1, engine: 5, thruster: 8, grab: 29, shield: 31 }, skills: { mobility: 3 } } });
  assert.deepEqual(w.player.mounts.map((m) => m.weapon.id), [1, 3], 'Basic kinetic + Rocket');
  assert.ok(w.player.repair, 'the duel kit\'s Repair drone is fitted');
});

test('a beam world (no account loadout) swaps the catalog default gun, and leaves the seed row alone', () => {
  const before = JSON.stringify(SHIPS.find((x) => x.id === 1).stats.mounts);
  const w = createSimWorld({ levelName: 'level-1', beam: true });
  assert.deepEqual(w.player.mounts.map((m) => m.weapon.id), [12, 3]);
  assert.equal(JSON.stringify(SHIPS.find((x) => x.id === 1).stats.mounts), before);
  assert.deepEqual(createSimWorld({ levelName: 'level-1' }).player.mounts.map((m) => m.weapon.id), [1, 3],
    'and the next room in the process flies the real gun');
});

// The server half of the call-site guard (the client half is client/src/fight-spec-callsites.test.js).
test('sim-host applies the spec through applyFightSpec + resolvePlayerBuild, and imports no per-flag transform', () => {
  const src = readFileSync(new URL('./sim-host.js', import.meta.url), 'utf8');
  const imports = src.split('\n').filter((l) => l.startsWith('import ')).join('\n');
  assert.match(imports, /applyFightSpec/);
  assert.match(imports, /resolvePlayerBuild/);
  for (const name of ['withAllyAt', 'withLancersAt', 'withDuelRoom', 'withBrawlRoom', 'withBeamGun']) {
    assert.ok(!imports.includes(name), `sim-host.js still imports ${name}`);
  }
});
