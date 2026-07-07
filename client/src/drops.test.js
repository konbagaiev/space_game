import { test } from 'node:test';
import assert from 'node:assert/strict';
// Only the PURE pieces of the drop system are imported (drops-config.js has no THREE / engine deps, so it
// stays node-safe). The THREE/scene behavior (meshes, the blue pull line) is covered by the headless suite.
import { pullSpeed, field, range, pickLoot, WEIGHT_FALLBACK, DROP_CHANCE, ARM_DELAY, shouldDeposit, rewardOwned } from './drops-config.js';

const approx = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

// --- pull speed: LINEAR ramp PULL_SPEED_FAR→PULL_SPEED_NEAR by distance, · (10/weight). NOT the field:
//     a constant slope (no near-ship 1/dist² jerk). Anchors are weight-10 refs (NEAR=4 @d=3, FAR=1 @d=11). ---
test('pullSpeed: linear ramp — NEAR at the ship, FAR floor, linear midpoint, closer=faster', () => {
  approx(pullSpeed(10, 3), 4.0);    // at COLLECT_DIST → PULL_SPEED_NEAR
  approx(pullSpeed(10, 11), 1.0);   // at PULL_FAR_DIST → PULL_SPEED_FAR
  approx(pullSpeed(10, 7), 2.5);    // halfway (d=7) → linear halfway between 1 and 4
  assert.ok(pullSpeed(10, 3) > pullSpeed(10, 7) && pullSpeed(10, 7) > pullSpeed(10, 11)); // closer = faster
});

test('pullSpeed: constant slope (no jerk) and clamped floor beyond PULL_FAR_DIST', () => {
  // equal distance steps → equal speed steps (linear, unlike the 1/dist² field)
  approx((pullSpeed(10, 5) - pullSpeed(10, 7)), (pullSpeed(10, 7) - pullSpeed(10, 9)));
  approx(pullSpeed(10, 20), pullSpeed(10, 11)); // past the far anchor → clamped to the FAR floor, never negative
  assert.ok(pullSpeed(10, 20) > 0);
});

test('pullSpeed: lighter items pull faster; speed no longer depends on grab strength (reach does)', () => {
  assert.ok(pullSpeed(2, 7) > pullSpeed(50, 7)); // lighter = faster at the same distance
  approx(pullSpeed(10, 7), 2.5);                 // strength is not even an argument now — speed is reach-independent
});

test('pullSpeed: a zero/undefined weight falls back to WEIGHT_FALLBACK (never divides by zero)', () => {
  assert.equal(pullSpeed(0, 7), pullSpeed(WEIGHT_FALLBACK, 7));
  assert.equal(pullSpeed(undefined, 7), pullSpeed(WEIGHT_FALLBACK, 7));
  assert.ok(Number.isFinite(pullSpeed(0, 7)));
});

// reach is unchanged by the speed-model swap — range() still comes from field/FIELD_CUTOFF (see range test below)
test('reach unchanged: range() is independent of the linear speed model', () => {
  approx(range(10), Math.sqrt(125));  // ≈ 11.18, exactly as before
  approx(range(20), Math.sqrt(250));  // ≈ 15.81
});

// --- field: inverse-square; the FIELD_CUTOFF boundary is what defines the emergent range ---
test('field: falls off as 1/dist² and crosses FIELD_CUTOFF exactly at range()', () => {
  approx(field(10, 5), 10 * 5 / 25);                 // = 2.0
  assert.ok(field(10, 3) > field(10, 5));            // stronger closer in
  const r = range(10);
  approx(field(10, r), 0.4);                         // at the emergent edge the field == FIELD_CUTOFF
  assert.ok(field(10, r - 0.01) > 0.4);              // just inside → engaged
  assert.ok(field(10, r + 0.01) < 0.4);              // just outside → released
});

// --- range: EMERGENT (sqrt(strength·FIELD_K/FIELD_CUTOFF)), weight-INDEPENDENT ---
test('range: base ≈11.18, advanced ≈15.81, advanced/base === sqrt(2)', () => {
  approx(range(10), Math.sqrt(125));   // ≈ 11.1803
  approx(range(20), Math.sqrt(250));   // ≈ 15.8114
  approx(range(20) / range(10), Math.SQRT2, 1e-9); // advanced reaches √2× the base, not 2×
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

// --- shouldDeposit: the no-dupe guarantee — a SPECIAL (cosmetic reward) drop deposits NOTHING ---
test('shouldDeposit: a normal loot drop deposits; a special reward drop never does', () => {
  assert.equal(shouldDeposit({ item: { kind: 'weapon', refId: 5 } }), true);   // normal loot → into the stash
  assert.equal(shouldDeposit({ item: { kind: 'weapon', refId: 5 }, special: true }), false); // reward → nothing (server force-installs the one copy)
  assert.equal(shouldDeposit({ special: false }), true);
  assert.equal(shouldDeposit(null), false); // defensive
});

// --- rewardOwned: the ownership gate that suppresses the special drop on replays ---
test('rewardOwned: L1 weapon reward is owned iff a mount references its refId', () => {
  const reward = { kind: 'weapon', refId: 5 };
  assert.equal(rewardOwned({ loadout: { mounts: [{ weapon: 5 }] } }, reward), true);   // MG mounted → owned
  assert.equal(rewardOwned({ loadout: { mounts: [{ weapon: 1 }] } }, reward), false);  // only the basic gun → not owned
  assert.equal(rewardOwned({ ship: { stats: { mounts: [{ weapon: 5 }] } } }, reward), true); // falls back to ship.stats.mounts
});

test('rewardOwned: L2 component reward is owned iff the repair slot is filled', () => {
  const reward = { kind: 'component', refId: 12 };
  assert.equal(rewardOwned({ components: { repair: 12 } }, reward), true);   // repair installed → owned
  assert.equal(rewardOwned({ components: {} }, reward), false);              // empty repair slot → not owned
  assert.equal(rewardOwned({ components: { repair: null } }, reward), false);
});

test('rewardOwned: null active ship / null reward → not owned (drop shows on a first playthrough)', () => {
  assert.equal(rewardOwned(null, { kind: 'weapon', refId: 5 }), false);
  assert.equal(rewardOwned({ loadout: { mounts: [] } }, null), false);
  assert.equal(rewardOwned({ loadout: { mounts: [] } }, { kind: 'other' }), false);
});
