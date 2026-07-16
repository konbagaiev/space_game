// Unit tests for the OBB hitbox (broad-phase → narrow-phase). collision.js is deliberately THREE-free, so
// we hand-build a minimal mesh stub (column-major matrixWorld + position/scale) instead of depending on a
// `three` install the node test harness doesn't have. Boxes are stored { c, h, u0, u1, u2 } in the
// group-local frame; the narrow phase is a point-vs-OBB projection test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointHitsShip, broadRadius, segmentHitsShip, resolveHostileBulletHit } from './collision.js';

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

// OUTCOME (the inverse — the case that shipped "transparent"): a bullet aimed at a THIN part (a swept wing
// slab, a pointed nose) actually REGISTERS a hit. A wing/nose fits into a razor-thin box (h ~ MIN_HALF); if
// such a box were dropped or ignored, the feature would be transparent to bullets. Assert points ON these
// thin slabs hit, so a transparent/too-thin feature regresses the suite. (The data-side floor that keeps
// these boxes thick enough to survive a discrete moving bullet is asserted in assets-hitboxes.test.mjs.)
test('(outcome) a bullet aimed at a thin wing / nose slab registers a hit (not transparent)', () => {
  const FLOOR = 0.1; // the fitter's min per-axis half-extent (a thin feature is clamped up to this slab)
  // thin swept-wing slab out at +X, only FLOOR thick vertically (Y) — the shape spheres could not cover
  const wing = { c: V(1.1, 0, 0), h: V(0.6, FLOOR, 0.35), u0: AX, u1: AY, u2: AZ };
  // thin pointed-nose slab at +Z, only FLOOR thick laterally (X)
  const nose = { c: V(0, 0, 1.4), h: V(FLOOR, 0.12, 0.35), u0: AX, u1: AY, u2: AZ };
  const ship = { mesh: mesh(0, 0, 0), sizeScale: 1, hitBoxes: [wing, nose], broadR: 2.0 };
  assert.equal(pointHitsShip(ship, V(1.1, 0, 0)), true);      // dead-center of the thin wing → hit
  assert.equal(pointHitsShip(ship, V(1.6, 0.05, 0.2)), true); // near the wingtip, inside the thin slab → hit
  assert.equal(pointHitsShip(ship, V(0, 0, 1.4)), true);      // on the thin nose → hit
  assert.equal(pointHitsShip(ship, V(0.08, 0, 1.5)), true);   // grazing inside the nose slab → hit
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

// ---- swept segment collision (segmentHitsShip): the fix for bullet TUNNELING through thin boxes ----

// segmentHitsShip == pointHitsShip when the segment is degenerate (p0==p1) — a strict superset.
test('(swept) a degenerate segment (p0==p1) equals the point test', () => {
  const ship = { mesh: mesh(0, 0, 0), sizeScale: 1, hitBoxes: BOXES, broadR: BROAD };
  assert.equal(segmentHitsShip(ship, V(0, 0, 1), V(0, 0, 1)), true);   // inside the nose box
  assert.equal(segmentHitsShip(ship, V(0, 0, 0), V(0, 0, 0)), false);  // between the boxes (miss)
});

// THE tunneling regression the point-based suite structurally cannot catch: a fast bullet whose two
// consecutive frame positions STRADDLE a thin box (neither endpoint inside, the segment crosses it) must
// register a HIT via the swept test. This is the player-wing / medium-nose case from the live test — a box
// only ~0.2 world thick along the travel axis, a bullet stepping ~1 unit/frame.
test('(swept) a fast bullet straddling a thin box registers a hit (no tunneling)', () => {
  const thinNose = { c: V(0, 0, 1), h: V(0.4, 0.3, 0.1), u0: AX, u1: AY, u2: AZ }; // 0.1 half-extent along Z (travel)
  const ship = { mesh: mesh(0, 0, 0), sizeScale: 1, hitBoxes: [thinNose], broadR: 1.5 };
  const p0 = V(0, 0, 0.5), p1 = V(0, 0, 1.5); // one frame's move in +Z, stepping clean over the box (z∈[0.9,1.1])
  // the OLD point test misses at BOTH endpoints — this is exactly why bullets went transparent
  assert.equal(pointHitsShip(ship, p0), false, 'pre-move point is outside the box');
  assert.equal(pointHitsShip(ship, p1), false, 'post-move point is outside the box');
  // the swept test catches the crossing
  assert.equal(segmentHitsShip(ship, p0, p1), true, 'the movement segment crosses the box → hit');
});

// A swept segment through GENUINELY empty space (the gap beyond a wing) must still MISS — the tight-fit
// property is preserved, the swept test doesn't just "hit everything near the ship".
test('(swept) a segment through the empty gap beyond a wing still misses', () => {
  const fuselage = { c: V(0, 0, 0), h: V(0.25, 0.3, 1.4), u0: AX, u1: AY, u2: AZ };
  const wing = { c: V(1.2, 0, 0), h: V(0.3, 0.1, 0.4), u0: AX, u1: AY, u2: AZ }; // X∈[0.9,1.5]
  const ship = { mesh: mesh(0, 0, 0), sizeScale: 1, hitBoxes: [fuselage, wing], broadR: 2.2 };
  // a bullet flying in +Z at X=0.55 (the empty lateral gap between fuselage and wing) crosses no box
  assert.equal(segmentHitsShip(ship, V(0.55, 0, -1.6), V(0.55, 0, 1.6)), false, 'gap → miss even swept');
  // but the same swept flight at X=1.2 (through the wing) hits
  assert.equal(segmentHitsShip(ship, V(1.2, 0, -1.6), V(1.2, 0, 1.6)), true, 'through the wing → hit');
  // and a broad-phase-rejected far segment misses
  assert.equal(segmentHitsShip(ship, V(9, 0, -5), V(9, 0, 5)), false, 'far segment → broad reject');
});

// scale + pad behave under the swept test (rotated/scaled hull still swept-correct).
test('(swept) mesh.scale and pad expand the swept hit', () => {
  const box = { c: V(0, 0, 1), h: V(0.4, 0.3, 0.1), u0: AX, u1: AY, u2: AZ };
  const s2 = { mesh: mesh(0, 0, 0, 2), sizeScale: 1, hitBoxes: [box], broadR: 1.5 };
  // at scale 2 the box center is z=2, half-extent 0.2 → z∈[1.8,2.2]; a segment crossing z=2 hits
  assert.equal(segmentHitsShip(s2, V(0, 0, 1), V(0, 0, 3)), true);
  // a segment that stops short of the (scaled) box misses without pad, hits with pad
  assert.equal(segmentHitsShip(s2, V(0, 0, 0), V(0, 0, 1.5)), false);
  assert.equal(segmentHitsShip(s2, V(0, 0, 0), V(0, 0, 1.5), 0.4), true);
});

// --- resolveHostileBulletHit: the enemy-bullet → player damage+cull path (regression for the missing
// applyPlayerDamage import in sim.js, commit 51eec94). ---
const hostilePlayer = (over = {}) => ({
  mesh: mesh(0, 0, 0), sizeScale: 1, hitBoxes: null, broadR: null,
  hp: 100, shield: false, _shieldValue: 0, _shieldRechargeAccum: 0, ...over,
});

test('resolveHostileBulletHit: a swept segment through the hull damages the hull and consumes the bullet', () => {
  const p = hostilePlayer();                       // no shield → full damage to hull
  const r = resolveHostileBulletHit(p, V(-3, 0, 0), V(3, 0, 0), 12); // segment crosses the origin sphere
  assert.equal(r.hit, true);
  assert.equal(r.remove, true);                    // bullet is consumed (would reach sim's splice)
  assert.equal(p.hp, 88);                          // 100 − 12, routed by applyPlayerDamage
  assert.deepEqual(r.damageResult, { absorbed: false, broke: false });
});

test('resolveHostileBulletHit: with a shield, damage is absorbed shield-first (ripple contract)', () => {
  const p = hostilePlayer({ shield: true, _shieldValue: 20 });
  const r = resolveHostileBulletHit(p, V(-3, 0, 0), V(3, 0, 0), 5);
  assert.equal(r.hit, true);
  assert.equal(p._shieldValue, 15);                // absorbed by the shield
  assert.equal(p.hp, 100);                          // hull untouched
  assert.deepEqual(r.damageResult, { absorbed: true, broke: false });
});

test('resolveHostileBulletHit: an ACTIVE shield intercepts on the sphere and reports the surface impact point', () => {
  const p = hostilePlayer({ shield: true, _shieldValue: 20 }); // sphere radius 4 at the origin
  const r = resolveHostileBulletHit(p, V(-6, 0, 0), V(0, 0, 0), 5); // approaches +X from outside the sphere
  assert.equal(r.hit, true);
  assert.ok(r.impact, 'impact point returned so the FX land ON the sphere, not at the hull');
  assert.ok(Math.abs(r.impact.x + 4) < 1e-9, 'entry point is the −X face of the radius-4 sphere');
  assert.ok(Math.abs(r.impact.y) < 1e-9 && Math.abs(r.impact.z) < 1e-9);
});

test('resolveHostileBulletHit: an ACTIVE shield catches a shot the tight hull would MISS (sphere is wider)', () => {
  // y=3.5 is outside the 2.6 broad hull sphere but inside the radius-4 shield sphere → caught by the shield.
  const p = hostilePlayer({ shield: true, _shieldValue: 20 });
  const r = resolveHostileBulletHit(p, V(-3, 3.5, 0), V(3, 3.5, 0), 5);
  assert.equal(r.hit, true);
  assert.equal(p._shieldValue, 15);
});

test('resolveHostileBulletHit: a BROKEN shield (value 0) falls back to the hull test — a wide shot misses', () => {
  // Same off-plane shot as above, but with the shield down it must revert to the tight hull sphere and miss.
  const p = hostilePlayer({ shield: true, _shieldValue: 0 });
  const r = resolveHostileBulletHit(p, V(-3, 3.5, 0), V(3, 3.5, 0), 5);
  assert.equal(r.hit, false);
  assert.equal(r.impact, null);
  assert.equal(r.remove, false);
});

test('resolveHostileBulletHit: a segment that misses the hull does nothing and does not consume the bullet', () => {
  const p = hostilePlayer();
  const r = resolveHostileBulletHit(p, V(-3, 5, 0), V(3, 5, 0), 12); // 5 units off-plane → outside the 2.6 sphere
  assert.equal(r.hit, false);
  assert.equal(r.remove, false);
  assert.equal(p.hp, 100);
  assert.equal(r.damageResult, null);
});
