// Unit tests for the multi-sphere hitbox (broad-phase → narrow-phase). collision.js is deliberately
// THREE-free, so we hand-build a minimal mesh stub (column-major matrixWorld + position/scale) instead of
// depending on a `three` install the node test harness doesn't have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointHitsShip, broadRadius } from './collision.js';

// mesh stub: uniform scale `s`, translation `(px,py,pz)`; matrixWorld is column-major with scale on the
// diagonal and translation in the last column — exactly what THREE.Object3D.updateMatrixWorld produces.
function mesh(px, py, pz, s = 1) {
  return {
    position: { x: px, y: py, z: pz },
    scale: { x: s },
    updateMatrixWorld() {},
    matrixWorld: { elements: [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, px, py, pz, 1] },
  };
}
const V = (x, y, z) => ({ x, y, z });
// nose sphere at +Z, tail sphere at −Z (group-local), enclosing broadR
const SPHERES = [{ x: 0, y: 0, z: 1, r: 0.5 }, { x: 0, y: 0, z: -1, r: 0.5 }];
const BROAD = 1.5;

test('(a) a point inside a nose sphere hits', () => {
  const ship = { mesh: mesh(10, 0, 0), sizeScale: 1, hitSpheres: SPHERES, broadR: BROAD };
  assert.equal(pointHitsShip(ship, V(10, 0, 1)), true);
});

test('(b) a point inside the broad radius but outside every sphere misses (narrow-phase runs)', () => {
  const ship = { mesh: mesh(10, 0, 0), sizeScale: 1, hitSpheres: SPHERES, broadR: BROAD };
  // (10,1.2,0): 1.2 < broadR 1.5 (broad passes) but ≥0.5 from both spheres
  assert.equal(pointHitsShip(ship, V(10, 1.2, 0)), false);
});

test('(c) a point beyond the broad radius misses (broad-phase reject)', () => {
  const ship = { mesh: mesh(10, 0, 0), sizeScale: 1, hitSpheres: SPHERES, broadR: BROAD };
  assert.equal(pointHitsShip(ship, V(10, 2, 0)), false);
});

test('(d) pad expands the hit', () => {
  const ship = { mesh: mesh(10, 0, 0), sizeScale: 1, hitSpheres: SPHERES, broadR: BROAD };
  // (10,0,1.7): 1.7 > broadR 1.5 → miss at pad 0; pad 0.5 lets both broad + nose reach it
  assert.equal(pointHitsShip(ship, V(10, 0, 1.7)), false);
  assert.equal(pointHitsShip(ship, V(10, 0, 1.7), 0.5), true);
});

test('(e) hitSpheres null falls back to 2.6×sizeScale broad behavior', () => {
  const ship = { mesh: mesh(0, 0, 0, 1), sizeScale: 1, hitSpheres: null, broadR: null };
  assert.equal(broadRadius(ship), 2.6);
  assert.equal(pointHitsShip(ship, V(2.0, 0, 0)), true);  // inside 2.6
  assert.equal(pointHitsShip(ship, V(3.0, 0, 0)), false); // outside 2.6
});

test('(f) mesh.scale scales both center and radius (a near-miss flips to a hit)', () => {
  const s1 = { mesh: mesh(0, 0, 0, 1), sizeScale: 1, hitSpheres: SPHERES, broadR: BROAD };
  const s2 = { mesh: mesh(0, 0, 0, 2), sizeScale: 1, hitSpheres: SPHERES, broadR: BROAD };
  // clear hit at scale 1 stays a hit at scale 2
  assert.equal(pointHitsShip(s1, V(0, 0, 1.4)), true);
  assert.equal(pointHitsShip(s2, V(0, 0, 1.4)), true);
  // (0,0,1.6): scale-1 miss (broad 1.5 < 1.6), scale-2 hit (nose→(0,0,2) r1.0)
  assert.equal(pointHitsShip(s1, V(0, 0, 1.6)), false);
  assert.equal(pointHitsShip(s2, V(0, 0, 1.6)), true);
});
