import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headingToDir, shortestAngleDelta, steerToward, enemyThrustFactor, inForwardSector, spiralOffset, nearestInConeIndex, keyboardThrust } from './steering.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('headingToDir: 0 -> +Z, PI/2 -> +X', () => {
  const a = headingToDir(0);
  assert.ok(close(a.x, 0) && close(a.z, 1));
  const b = headingToDir(Math.PI / 2);
  assert.ok(close(b.x, 1) && close(b.z, 0));
});

test('shortestAngleDelta is normalized to [-PI, PI] and takes the short way', () => {
  assert.ok(close(shortestAngleDelta(0, Math.PI * 1.5), -Math.PI / 2)); // 270deg -> -90deg
  assert.ok(close(shortestAngleDelta(3.0, -3.0), (Math.PI * 2) - 6));    // ~ +0.283
});

test('steerToward clamps the step and does not overshoot', () => {
  assert.ok(close(steerToward(0, 1.0, 0.1), 0.1));   // big target, step-limited
  assert.ok(close(steerToward(0, 0.05, 0.1), 0.05)); // small target, reached exactly
  assert.ok(close(steerToward(0, -1.0, 0.1), -0.1)); // negative direction
});

test('steerToward turns the short way across the +-PI wrap', () => {
  assert.ok(close(steerToward(3.0, -3.0, 0.1), 3.1)); // increases past PI, not back through 0
});

test('keyboardThrust: W thrusts, S brakes, both = thrust, and thrust is NEVER negative', () => {
  assert.deepEqual(keyboardThrust({}), { thrust: 0, brake: false });
  assert.deepEqual(keyboardThrust({ KeyW: true }), { thrust: 1, brake: false });
  assert.deepEqual(keyboardThrust({ ArrowUp: true }), { thrust: 1, brake: false });
  assert.deepEqual(keyboardThrust({ KeyS: true }), { thrust: 0, brake: true });
  assert.deepEqual(keyboardThrust({ ArrowDown: true }), { thrust: 0, brake: true });
  assert.deepEqual(keyboardThrust({ KeyW: true, KeyS: true }), { thrust: 1, brake: false }); // forward wins
});

// The regression guard for "no flying backwards" (DECISIONS §113): S/↓ used to apply -accel, which is the
// one thing touch controls can't do (touchAim.thrust is 0..1). No key combination may yield thrust < 0.
test('keyboardThrust: no key combination can produce reverse thrust', () => {
  const codes = ['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'Space'];
  for (let mask = 0; mask < (1 << codes.length); mask++) {
    const keys = {};
    codes.forEach((c, i) => { if (mask & (1 << i)) keys[c] = true; });
    assert.ok(keyboardThrust(keys).thrust >= 0, `reverse thrust for ${JSON.stringify(keys)}`);
  }
});

test('enemyThrustFactor: approach far, hold band, back off close', () => {
  assert.equal(enemyThrustFactor(30), 1);
  assert.equal(enemyThrustFactor(18), 0.15);
  assert.equal(enemyThrustFactor(5), -0.6);
});

test('inForwardSector: ahead in cone = true, behind / outside = false', () => {
  const fwd = { x: 0, z: 1 };
  assert.equal(inForwardSector(fwd, { x: 1, z: 1 }, Math.PI / 3), true);  // 45deg, cone 60deg
  assert.equal(inForwardSector(fwd, { x: 1, z: 0 }, Math.PI / 3), false); // 90deg, outside 60deg
  assert.equal(inForwardSector(fwd, { x: 0, z: -5 }, Math.PI / 3), false); // behind
});

test('nearestInConeIndex: in-cone / outside / behind / nearest-wins / co-located', () => {
  const from = { x: 0, z: 0 };
  const fwd = { x: 0, z: 1 };            // nose +Z
  const half = 2 * Math.PI / 180;        // 2° half-angle
  // In-cone, single target dead ahead → index 0.
  assert.equal(nearestInConeIndex(from, fwd, [{ x: 0, z: 10 }], half), 0);
  // Just outside the cone (~2.98° off-axis) → -1.
  assert.equal(nearestInConeIndex(from, fwd, [{ x: 0.52, z: 10 }], half), -1);
  // Just inside the cone (~0.97° off-axis) → 0.
  assert.equal(nearestInConeIndex(from, fwd, [{ x: 0.17, z: 10 }], half), 0);
  // Behind → -1.
  assert.equal(nearestInConeIndex(from, fwd, [{ x: 0, z: -10 }], half), -1);
  // Nearest wins among two in-cone (wide cone): i=1 is the closer one.
  assert.equal(nearestInConeIndex(from, fwd, [{ x: 0, z: 20 }, { x: 0, z: 8 }], Math.PI / 6), 1);
  // Co-located target (== from) is skipped → -1.
  assert.equal(nearestInConeIndex(from, fwd, [{ x: 0, z: 0 }], half), -1);
});

test('nearestInConeIndex: a hull radius engages a target whose CENTRE is outside the cone', () => {
  const from = { x: 0, z: 0 };
  const fwd = { x: 0, z: 1 };            // nose +Z
  const half = 2 * Math.PI / 180;        // 2° half-angle → cone radius 0.349 at z=10
  // The bug this guards: at 10 u a 2° cone is only 0.35 u wide, so a ship 2 u off-axis never engaged the
  // assist even with its wing squarely in the line of fire — shots grazed the hull with no correction.
  assert.equal(nearestInConeIndex(from, fwd, [{ x: 2, z: 10 }], half), -1);            // r=0: the old dot
  assert.equal(nearestInConeIndex(from, fwd, [{ x: 2, z: 10, r: 3.8 }], half), 0);     // hull overlaps → engaged
  // ...but the radius is not a blank cheque: a hull that genuinely clears the cone stays unengaged.
  assert.equal(nearestInConeIndex(from, fwd, [{ x: 8, z: 10, r: 3.8 }], half), -1);
  // A hull-sized target directly behind is still rejected (radius must not wrap around the muzzle).
  assert.equal(nearestInConeIndex(from, fwd, [{ x: 0, z: -10, r: 3.8 }], half), -1);
  // Nearest still wins when BOTH are engaged only thanks to their hulls: i=1 is the closer one.
  assert.equal(nearestInConeIndex(from, fwd, [{ x: 2, z: 10, r: 3.8 }, { x: 1.5, z: 6, r: 3.8 }], half), 1);
  // A nearer target OUT of the cone must not shadow a farther one that is in it.
  assert.equal(nearestInConeIndex(from, fwd, [{ x: 20, z: 5, r: 3.8 }, { x: 0, z: 30, r: 3.8 }], half), 1);
});

test('nearestInConeIndex: a closer bystander cannot steal fire from the ship being aimed at', () => {
  const from = { x: 0, z: 0 };
  const fwd = { x: 0, z: 1 };
  const half = 2 * Math.PI / 180;
  // i=0 is dead on the aim axis at 30 u; i=1 is nearer (10 u) but only clips the cone with a wingtip.
  // Hull radii let BOTH qualify — which they could not when the cone was a 2° needle — so ranking by
  // distance would hand the shot to the bystander and bend the player's fire off the ship they chose.
  const aimedAt = { x: 0, z: 30, r: 3.8 };
  const bystander = { x: 3.7, z: 10, r: 3.8 };
  assert.equal(nearestInConeIndex(from, fwd, [aimedAt, bystander], half), 0);
  assert.equal(nearestInConeIndex(from, fwd, [bystander, aimedAt], half), 1); // order must not matter
  // With the bystander alone in the cone it is still a valid target (the rule is preference, not exclusion).
  assert.equal(nearestInConeIndex(from, fwd, [bystander], half), 0);
});

const len3 = (v) => Math.hypot(v.x, v.y, v.z);
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

test('spiralOffset: length ≈ radius and perpendicular to the axis for several axes/phases', () => {
  const R = 1.4;
  const axes = [{ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }];
  // a normalized diagonal
  const dl = Math.hypot(1, 1, 1);
  axes.push({ x: 1 / dl, y: 1 / dl, z: 1 / dl });
  for (const axis of axes) {
    for (const phase of [0, 0.7, Math.PI, 2.5, 5.9]) {
      const o = spiralOffset(axis, phase, R);
      assert.ok(close(len3(o), R, 1e-9), `length ≈ radius (axis ${JSON.stringify(axis)}, phase ${phase})`);
      assert.ok(close(dot3(axis, o), 0, 1e-9), `offset ⟂ axis (axis ${JSON.stringify(axis)}, phase ${phase})`);
    }
  }
});

test('spiralOffset: three phases 120° apart sum to ≈ zero (balanced around the axis)', () => {
  const axis = { x: 0, y: 0, z: 1 };
  const R = 1.4;
  const a = spiralOffset(axis, 0, R);
  const b = spiralOffset(axis, 2 * Math.PI / 3, R);
  const c = spiralOffset(axis, 4 * Math.PI / 3, R);
  assert.ok(close(a.x + b.x + c.x, 0, 1e-9));
  assert.ok(close(a.y + b.y + c.y, 0, 1e-9));
  assert.ok(close(a.z + b.z + c.z, 0, 1e-9));
});

test('spiralOffset: world-up axis (0,1,0) still yields a valid basis (fallback branch)', () => {
  const axis = { x: 0, y: 1, z: 0 };
  const R = 1.4;
  for (const phase of [0, 1.2, 3.4]) {
    const o = spiralOffset(axis, phase, R);
    assert.ok(close(len3(o), R, 1e-9), 'length ≈ radius on the world-up fallback');
    assert.ok(close(dot3(axis, o), 0, 1e-9), 'offset ⟂ axis on the world-up fallback');
  }
});
