// Unit tests for the speed-field pure seam (speed-field.js — THREE-free so it loads under `node --test`;
// the THREE.Points assembly lives in world.js). wrapCoord is the load-bearing bit: a point pushed outside
// the box by a moving center must re-enter on the opposite side and stay bounded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapCoord, wrapLayerPositions, scatterLayer, poolSize, SPEED_FIELD_LAYERS } from './speed-field.js';

test('wrapCoord keeps the result inside [center-R, center+R]', () => {
  const R = 100;
  for (const center of [-500, 0, 12345.6]) {
    for (let v = -2000; v <= 2000; v += 37) {
      const w = wrapCoord(v, center, R);
      assert.ok(w >= center - R - 1e-9 && w < center + R + 1e-9, `w=${w} in [${center - R},${center + R}]`);
    }
  }
});

test('wrapCoord is a no-op when already inside the box', () => {
  assert.ok(Math.abs(wrapCoord(50, 0, 100) - 50) < 1e-9);
  assert.ok(Math.abs(wrapCoord(-99, 0, 100) - -99) < 1e-9);
});

test('wrapCoord wraps by exactly one 2R period across the far edge', () => {
  // center 0, R 100: v=120 is 20 past the +edge → wraps to -80 (120 - 200)
  assert.ok(Math.abs(wrapCoord(120, 0, 100) - -80) < 1e-9);
  // v=-140 is 40 past the -edge → wraps to +60 (-140 + 200)
  assert.ok(Math.abs(wrapCoord(-140, 0, 100) - 60) < 1e-9);
});

test('wrapLayerPositions bounds all x/z around the (moving) center and leaves y untouched', () => {
  const pos = scatterLayer(SPEED_FIELD_LAYERS[0], 200, mulberry(1));
  const R = SPEED_FIELD_LAYERS[0].R;
  const y = pos.slice(); // capture y column
  wrapLayerPositions(pos, 5000, -3000, R);
  for (let i = 0; i < pos.length; i += 3) {
    assert.ok(pos[i] >= 5000 - R - 1e-9 && pos[i] < 5000 + R + 1e-9, 'x wrapped into box');
    assert.ok(pos[i + 2] >= -3000 - R - 1e-9 && pos[i + 2] < -3000 + R + 1e-9, 'z wrapped into box');
    assert.equal(pos[i + 1], y[i + 1], 'y is left untouched');
  }
});

test('poolSize clamps the descriptor count into the cheap 200–600 band', () => {
  assert.equal(poolSize({ count: 2000 }), 500);
  assert.equal(poolSize({ count: 100 }), 200);   // floor
  assert.equal(poolSize({ count: 50000 }), 600); // cap
  assert.equal(poolSize({}), 500);               // default
});

// tiny deterministic RNG so the scatter test is stable
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
