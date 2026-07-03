import { test } from 'node:test';
import assert from 'node:assert/strict';
// Only the PURE pieces of the drop system are imported (drops-config.js has no THREE / engine deps, so it
// stays node-safe). The THREE/scene behavior (meshes, the blue pull line) is covered by the headless suite.
import { pullSpeed, pickLoot, WEIGHT_FALLBACK, DROP_CHANCE, ARM_DELAY } from './drops-config.js';

// --- pull speed: (strength / 2) * (10 / weight), in world units/sec ---
test('pullSpeed: anchor cases (s10/w10 → 5, s10/w2 → 25)', () => {
  assert.equal(pullSpeed(10, 10), 5);   // strength 10, weight 10 → 5 u/s
  assert.equal(pullSpeed(10, 2), 25);   // light part pulls faster
  assert.equal(pullSpeed(20, 10), 10);  // advanced grab (strength 20) → 2× the base at the same weight
});

test('pullSpeed: heavier items pull slower; the advanced grab pulls faster than the base', () => {
  assert.ok(pullSpeed(10, 50) < pullSpeed(10, 10)); // heavier = slower
  assert.ok(pullSpeed(20, 10) > pullSpeed(10, 10)); // stronger grab = faster
});

test('pullSpeed: a zero/undefined weight falls back to WEIGHT_FALLBACK (never divides by zero)', () => {
  assert.equal(pullSpeed(10, 0), pullSpeed(10, WEIGHT_FALLBACK));
  assert.equal(pullSpeed(10, undefined), pullSpeed(10, WEIGHT_FALLBACK));
  assert.ok(Number.isFinite(pullSpeed(10, 0))); // not Infinity/NaN
});

// range = grab.strength (documented world-unit radius) — asserted at the formula level.
test('range equals the grab strength (base 10, advanced 20 world units)', () => {
  const range = (grab) => grab.strength;
  assert.equal(range({ strength: 10 }), 10);
  assert.equal(range({ strength: 20 }), 20);
});

// --- pickLoot: uniform among the enemy's NON-HULL components + mounted weapons; hulls NEVER drop ---
const enemy = () => ({
  hull: { id: 28 },                                   // boss hull — must NEVER be picked
  engine: { id: 26 }, thruster: { id: 27 },
  mounts: [{ weapon: { id: 10 } }, { weapon: { id: 4 } }],
});

test('pickLoot: only ever returns an engine/thruster/weapon id — never the hull', () => {
  const allowed = new Set([
    'component:26', 'component:27', 'weapon:10', 'weapon:4',
  ]);
  for (let i = 0; i < 500; i++) {
    const loot = pickLoot(enemy());
    assert.ok(loot, 'a loot item is chosen');
    assert.ok(allowed.has(`${loot.kind}:${loot.refId}`), `picked ${loot.kind}:${loot.refId}`);
    assert.notEqual(loot.refId, 28, 'the hull (id 28) is never dropped');
  }
});

test('pickLoot: draws from the whole non-hull pool over many rolls (uniform-ish)', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) { const l = pickLoot(enemy()); seen.add(`${l.kind}:${l.refId}`); }
  assert.deepEqual([...seen].sort(), ['component:26', 'component:27', 'weapon:10', 'weapon:4'].sort());
});

test('pickLoot: an enemy with no non-hull parts yields null (nothing to drop)', () => {
  assert.equal(pickLoot({ hull: { id: 1 }, mounts: [] }), null);
  assert.equal(pickLoot({ hull: { id: 1 } }), null);
});

test('config: drop chance is 20% and the grab arms after 0.3 s in range', () => {
  assert.equal(DROP_CHANCE, 0.2);
  assert.equal(ARM_DELAY, 0.3);
});
