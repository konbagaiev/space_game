// Unit tests for the OBB hitbox (broad-phase → narrow-phase). collision.js is deliberately THREE-free, so
// we hand-build a minimal mesh stub (column-major matrixWorld + position/scale) instead of depending on a
// `three` install the node test harness doesn't have. Boxes are stored { c, h, u0, u1, u2 } in the
// group-local frame; the narrow phase is a point-vs-OBB projection test.
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
const AX = V(1, 0, 0), AY = V(0, 1, 0), AZ = V(0, 0, 1);
// nose box at +Z, tail box at −Z (group-local, axis-aligned so projection is hand-checkable), broadR encloses.
const BOXES = [
  { c: V(0, 0, 1), h: V(0.4, 0.3, 0.6), u0: AX, u1: AY, u2: AZ },
  { c: V(0, 0, -1), h: V(0.4, 0.3, 0.6), u0: AX, u1: AY, u2: AZ },
];
const BROAD = 1.6; // encloses both boxes (corner ~ hypot(0.4,0.3,1.6)≈1.68 → round up)

test('(a) a point inside a box hits', () => {
  const ship = { mesh: mesh(10, 0, 0), sizeScale: 1, hitBoxes: BOXES, broadR: BROAD };
  assert.equal(pointHitsShip(ship, V(10, 0, 1)), true);   // dead-center of the nose box
  assert.equal(pointHitsShip(ship, V(10.3, 0.2, 1.4)), true); // inside all three half-extents
});

test('(b) a point inside the broad radius but outside every box misses (narrow-phase runs)', () => {
  const ship = { mesh: mesh(10, 0, 0), sizeScale: 1, hitBoxes: BOXES, broadR: BROAD };
  // (10,0,0): between the two boxes (|z|=1 > 0.6 half-extent from each center) but well within broadR
  assert.equal(pointHitsShip(ship, V(10, 0, 0)), false);
  // (10,0.5,1): over the nose box in Z but 0.5 > 0.3 half-extent in Y → miss
  assert.equal(pointHitsShip(ship, V(10, 0.5, 1)), false);
});

test('(c) a point beyond the broad radius misses (broad-phase reject)', () => {
  const ship = { mesh: mesh(10, 0, 0), sizeScale: 1, hitBoxes: BOXES, broadR: BROAD };
  assert.equal(pointHitsShip(ship, V(10, 0, 3)), false);
});

test('(d) pad expands the hit', () => {
  const ship = { mesh: mesh(10, 0, 0), sizeScale: 1, hitBoxes: BOXES, broadR: BROAD };
  // (10,0,1.7): 0.1 beyond the nose box's +Z face (face at z=1.6) → miss at pad 0; pad 0.2 reaches it
  assert.equal(pointHitsShip(ship, V(10, 0, 1.7)), false);
  assert.equal(pointHitsShip(ship, V(10, 0, 1.7), 0.2), true);
});

test('(e) hitBoxes null falls back to 2.6×sizeScale broad behavior', () => {
  const ship = { mesh: mesh(0, 0, 0, 1), sizeScale: 1, hitBoxes: null, broadR: null };
  assert.equal(broadRadius(ship), 2.6);
  assert.equal(pointHitsShip(ship, V(2.0, 0, 0)), true);  // inside 2.6
  assert.equal(pointHitsShip(ship, V(3.0, 0, 0)), false); // outside 2.6
});

test('(f) mesh.scale scales both center and half-extents (a near-miss flips to a hit)', () => {
  const s1 = { mesh: mesh(0, 0, 0, 1), sizeScale: 1, hitBoxes: BOXES, broadR: BROAD };
  const s2 = { mesh: mesh(0, 0, 0, 2), sizeScale: 1, hitBoxes: BOXES, broadR: BROAD };
  // clear hit at scale 1 stays a hit at scale 2
  assert.equal(pointHitsShip(s1, V(0, 0, 1)), true);
  assert.equal(pointHitsShip(s2, V(0, 0, 2)), true);
  // (0,0,1.9): scale-1 miss (nose box +Z face at 1.6), scale-2 hit (center→(0,0,2), face at z=1.6..3.2)
  assert.equal(pointHitsShip(s1, V(0, 0, 1.9)), false);
  assert.equal(pointHitsShip(s2, V(0, 0, 1.9)), true);
});

// Rotated box: axes at 45° in XZ. A point inside the AABB of the same extents but outside the rotated box
// must MISS — proves the orientation is actually applied, not ignored.
test('(g) a rotated box actually applies its orientation', () => {
  const c = Math.SQRT1_2; // cos/sin 45°
  const box = { c: V(0, 0, 0), h: V(1.0, 0.3, 0.2), u0: V(c, 0, c), u1: V(0, 1, 0), u2: V(-c, 0, c) };
  const ship = { mesh: mesh(0, 0, 0), sizeScale: 1, hitBoxes: [box], broadR: 2 };
  // (0.9,0,0): inside an axis-aligned h.x=1.0 box, but the long axis is the diagonal — project onto u0/u2:
  //   u0·p = 0.9·c ≈ 0.636 (≤1.0), u2·p = -0.9·c ≈ -0.636 (>0.2 half-extent) → OUTSIDE the rotated box
  assert.equal(pointHitsShip(ship, V(0.9, 0, 0)), false);
  // (0.7,0,0.7): along the +u0 diagonal → u0·p ≈ 0.99 (≤1.0), u2·p ≈ 0 (≤0.2) → INSIDE
  assert.equal(pointHitsShip(ship, V(0.7, 0, 0.7)), true);
});

// OUTCOME: a bullet hits the hull but misses in the empty gap beyond a thin wing. This is the regression
// the spheres could not satisfy — a fuselage box + one wing box offset to +X, with empty gaps to either
// side. A shot through the lateral gap between fuselage and wingtip connects on neither.
test('(outcome) bullet hits the hull, misses in the gap beyond a wing', () => {
  const fuselage = { c: V(0, 0, 0), h: V(0.25, 0.3, 1.4), u0: AX, u1: AY, u2: AZ }; // narrow in X, long in Z
  const wing = { c: V(1.2, 0, 0), h: V(0.3, 0.1, 0.4), u0: AX, u1: AY, u2: AZ };    // pod out at +X (X∈[0.9,1.5])
  const ship = { mesh: mesh(0, 0, 0), sizeScale: 1, hitBoxes: [fuselage, wing], broadR: 2.2 };
  assert.equal(pointHitsShip(ship, V(0, 0, 0.5)), true);   // on the fuselage → hit
  assert.equal(pointHitsShip(ship, V(1.2, 0, 0)), true);   // on the wing pod → hit
  // empty lateral gap between fuselage (X≤0.25) and wing (0.9≤X≤1.5): X=0.55 is within broadR but no box
  assert.equal(pointHitsShip(ship, V(0.55, 0, 0)), false); // GAP → miss
  assert.equal(pointHitsShip(ship, V(1.8, 0, 0)), false);  // just beyond the wingtip → miss
  assert.equal(pointHitsShip(ship, V(-0.55, 0, 0)), false); // empty side (no wing there) → miss
});

// OUTCOME (carry the sphere iteration's regression, retargeted to hitBoxes): a rocket actually damages an
// enemy. Mirrors the FIXED hull-relative detonateRocket loop (`pointHitsShip(ship, pos, blastR)`), NOT a
// center-distance test. The detonation point sits on a nose box but > blastR from the CENTER, so the old
// `distanceTo(center) <= blastR` check missed everybody. Covers player→enemy and enemy→player.
test('(outcome) rocket blast applies damage on a hull hit even past blastR of the center (player→enemy)', () => {
  const enemy = { hp: 100, mesh: mesh(20, 0, 0, 1), sizeScale: 1, hitBoxes: [{ c: V(0, 0, 1.5), h: V(0.4, 0.3, 0.5), u0: AX, u1: AY, u2: AZ }], broadR: 2.1 };
  const rocket = { fromPlayer: true, damage: 40, blastR: 5, obj: { position: V(20, 0, 6.9) } };
  assert.ok(Math.hypot(6.9) > rocket.blastR, 'setup: point is beyond blastR of center');
  // hull-relative: the point is ~4.9 from the nose box's +Z face → within blastR(5)
  if (pointHitsShip(enemy, rocket.obj.position, rocket.blastR)) enemy.hp -= rocket.damage;
  assert.equal(enemy.hp, 60, 'enemy hp dropped by the rocket damage');
});

test('(outcome) rocket blast applies damage to the player (enemy→player)', () => {
  const player = { hp: 100, alive: true, mesh: mesh(0, 0, 0, 1), sizeScale: 1, hitBoxes: [{ c: V(0, 0, 1.5), h: V(0.4, 0.3, 0.5), u0: AX, u1: AY, u2: AZ }], broadR: 2.1 };
  const rocket = { fromPlayer: false, damage: 25, blastR: 5, obj: { position: V(0, 0, 6.9) } };
  if (player.alive && pointHitsShip(player, rocket.obj.position, rocket.blastR)) player.hp -= rocket.damage;
  assert.equal(player.hp, 75, 'player hp dropped by the enemy rocket damage');
});

test('(outcome) rocket direct-hit (detonation point right on the hull) also applies damage', () => {
  const enemy = { hp: 50, mesh: mesh(0, 0, 0, 1), sizeScale: 1, hitBoxes: [{ c: V(0, 0, 1), h: V(0.4, 0.3, 0.5), u0: AX, u1: AY, u2: AZ }], broadR: 1.6 };
  const rocket = { fromPlayer: true, damage: 30, blastR: 5, obj: { position: V(0, 0, 1) } }; // dead-center on the nose box
  if (pointHitsShip(enemy, rocket.obj.position, rocket.blastR)) enemy.hp -= rocket.damage;
  assert.equal(enemy.hp, 20);
});
