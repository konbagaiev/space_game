import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headingToDir, shortestAngleDelta, steerToward, enemyThrustFactor, inForwardSector } from './steering.js';

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
