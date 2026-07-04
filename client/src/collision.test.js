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

// Regression for BUG B ("rockets detonate but deal no damage"). Mirrors the FIXED blast-damage loop in
// projectiles.js `detonateRocket`, which must be HULL-relative (`pointHitsShip(ship, pos, blastR)`), not a
// center-distance test. The detonation point sits on the hull (a nose sphere) but > blastR from the CENTER,
// so the old `distanceTo(center) <= blastR` check missed everybody. Covers player→enemy and enemy→player.
test('rocket blast applies damage on a hull hit even past blastR of the center (player→enemy)', () => {
  const enemy = { hp: 100, mesh: mesh(20, 0, 0, 1), sizeScale: 1, hitSpheres: [{ x: 0, y: 0, z: 1.5, r: 0.6 }], broadR: 2.1 };
  const rocket = { fromPlayer: true, damage: 40, blastR: 5, obj: { position: V(20, 0, 6.9) } };
  // detonation point is 6.9 from the enemy CENTER (> blastR 5) → the OLD center test would miss:
  assert.ok(Math.hypot(6.9) > rocket.blastR, 'setup: point is beyond blastR of center');
  // FIXED loop (hull-relative): the point is 5.4 from the nose sphere center → within r(0.6)+blastR(5)
  if (pointHitsShip(enemy, rocket.obj.position, rocket.blastR)) enemy.hp -= rocket.damage;
  assert.equal(enemy.hp, 60, 'enemy hp dropped by the rocket damage');
});

test('rocket blast applies damage to the player (enemy→player)', () => {
  const player = { hp: 100, alive: true, mesh: mesh(0, 0, 0, 1), sizeScale: 1, hitSpheres: [{ x: 0, y: 0, z: 1.5, r: 0.6 }], broadR: 2.1 };
  const rocket = { fromPlayer: false, damage: 25, blastR: 5, obj: { position: V(0, 0, 6.9) } };
  if (player.alive && pointHitsShip(player, rocket.obj.position, rocket.blastR)) player.hp -= rocket.damage;
  assert.equal(player.hp, 75, 'player hp dropped by the enemy rocket damage');
});

test('rocket direct-hit (detonation point right on the hull) also applies damage', () => {
  const enemy = { hp: 50, mesh: mesh(0, 0, 0, 1), sizeScale: 1, hitSpheres: [{ x: 0, y: 0, z: 1, r: 0.5 }], broadR: 1.5 };
  const rocket = { fromPlayer: true, damage: 30, blastR: 5, obj: { position: V(0, 0, 1) } }; // dead-center on the nose sphere
  if (pointHitsShip(enemy, rocket.obj.position, rocket.blastR)) enemy.hp -= rocket.damage;
  assert.equal(enemy.hp, 20);
});
