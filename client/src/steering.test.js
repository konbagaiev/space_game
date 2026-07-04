import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headingToDir, shortestAngleDelta, steerToward, enemyThrustFactor, inForwardSector, spiralOffset } from './steering.js';

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
