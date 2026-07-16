// Ship hitbox tests. Broad-phase (one enclosing sphere) → narrow-phase (per-part oriented bounding boxes).
// hitBoxes/broadR live in the group-local noseZ frame (see ship-factory.js); mesh.matrixWorld folds in
// position + heading + 1.8×sizeScale but NOT the cosmetic bank roll (a child group). Half-extents scale by
// mesh.scale.x (uniform world scale).
//
// Deliberately THREE-free: each box center is transformed by mesh.matrixWorld.elements with plain math (an
// affine transform, w=1) and each axis is rotated by the matrix's upper-3×3 then renormalized, so the point
// is projected onto the box's world axes inline. That keeps this module importable under `node --test` (the
// client has no `three` install for node), so collision.test.js can exercise it. See DECISIONS §45.

import { applyPlayerDamage } from './components.js';

const LEGACY_R = 2.6; // primitive/cone fallback radius (the historical single-sphere hit radius), ×sizeScale

// World broad-phase radius. Modeled ships → broadR (group-local) × world scale; primitives → legacy 2.6×sizeScale.
export function broadRadius(ship) {
  const sc = ship.mesh.scale.x || 1;
  if (ship.hitBoxes && ship.broadR) return ship.broadR * sc;
  return LEGACY_R * (ship.sizeScale || 1);
}

// squared distance between a THREE.Vector3-like {x,y,z} and a bare (x,y,z)
function distSq(p, x, y, z) {
  const dx = p.x - x, dy = p.y - y, dz = p.z - z;
  return dx * dx + dy * dy + dz * dz;
}

// Rotate a group-local unit axis u by matrixWorld's upper-3×3 and normalize (uniform world scale), writing
// the world unit axis into `out` (a reused [x,y,z] array to avoid allocs). THREE-free.
function worldAxis(e, u, out) {
  let ax = e[0] * u.x + e[4] * u.y + e[8] * u.z;
  let ay = e[1] * u.x + e[5] * u.y + e[9] * u.z;
  let az = e[2] * u.x + e[6] * u.y + e[10] * u.z;
  const len = Math.hypot(ax, ay, az) || 1; // == sc for a unit axis under uniform scale
  out[0] = ax / len; out[1] = ay / len; out[2] = az / len;
  return out;
}

// Return whether the offset (dx,dy,dz) projects within h·sc + pad along the world axis of u. THREE-free.
function withinAxis(e, u, dx, dy, dz, h, sc, pad, tmp) {
  worldAxis(e, u, tmp);
  const proj = dx * tmp[0] + dy * tmp[1] + dz * tmp[2];
  return Math.abs(proj) <= h * sc + pad;
}

// Segment [a0,a1] (in a box's local frame — origin-centered AABB, per-axis half-extent H[i]) intersects the
// box? Standard slab clipping over t∈[0,1]. When a0==a1 this reduces to point-in-AABB. THREE-free.
function segIntersectsAABB(a0, a1, H) {
  let tmin = 0, tmax = 1;
  for (let i = 0; i < 3; i++) {
    const d = a1[i] - a0[i];
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(a0[i]) > H[i]) return false; // parallel to the slab and outside it
    } else {
      let t1 = (-H[i] - a0[i]) / d, t2 = (H[i] - a0[i]) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
  }
  return true;
}

// Squared distance from point c to the segment [p0,p1] (all {x,y,z}). For the swept broad-phase gate.
function segDistSq(p0, p1, c) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((c.x - p0.x) * dx + (c.y - p0.y) * dy + (c.z - p0.z) * dz) / len2 : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const ex = p0.x + t * dx - c.x, ey = p0.y + t * dy - c.y, ez = p0.z + t * dz - c.z;
  return ex * ex + ey * ey + ez * ez;
}

// reused scratch buffers (single-threaded; avoids per-call allocation in the hot projectile loop)
const _tmp = [0, 0, 0];
const _wu0 = [0, 0, 0], _wu1 = [0, 0, 0], _wu2 = [0, 0, 0];
const _a0 = [0, 0, 0], _a1 = [0, 0, 0], _H = [0, 0, 0];

// True if world `point` is within `pad` world units of the ship's hull. Broad-phase first; ships without
// hitBoxes fall back to the single broad sphere (unchanged behavior for primitive/cone ships).
export function pointHitsShip(ship, point, pad = 0) {
  const p = ship.mesh.position;
  const br = broadRadius(ship) + pad;
  if (distSq(point, p.x, p.y, p.z) > br * br) return false;
  if (!ship.hitBoxes) return true;                 // broad sphere IS the hitbox for primitives
  const sc = ship.mesh.scale.x || 1;
  ship.mesh.updateMatrixWorld();                   // sim mutates position mid-frame; refresh before transforming
  const e = ship.mesh.matrixWorld.elements;        // column-major 4x4 (folds position + heading + world scale)
  for (const b of ship.hitBoxes) {
    const cx = e[0] * b.c.x + e[4] * b.c.y + e[8] * b.c.z + e[12];
    const cy = e[1] * b.c.x + e[5] * b.c.y + e[9] * b.c.z + e[13];
    const cz = e[2] * b.c.x + e[6] * b.c.y + e[10] * b.c.z + e[14];
    const dx = point.x - cx, dy = point.y - cy, dz = point.z - cz;
    if (withinAxis(e, b.u0, dx, dy, dz, b.h.x, sc, pad, _tmp)
      && withinAxis(e, b.u1, dx, dy, dz, b.h.y, sc, pad, _tmp)
      && withinAxis(e, b.u2, dx, dy, dz, b.h.z, sc, pad, _tmp)) return true;
  }
  return false;
}

// True if the movement segment [p0,p1] (world) passes within `pad` of the ship's hull — a SWEPT hit test so
// a fast projectile that steps clean over a thin box between frames still registers (fixes bullet tunneling
// through thin wings/noses; see DECISIONS §45). Broad-phase = segment-vs-enclosing-sphere; narrow-phase =
// segment-vs-OBB (transform both endpoints into each box's local frame, then a slab test). When p0==p1 it is
// exactly `pointHitsShip`, so it's a strict superset. THREE-free.
export function segmentHitsShip(ship, p0, p1, pad = 0) {
  const c = ship.mesh.position;
  const br = broadRadius(ship) + pad;
  if (segDistSq(p0, p1, c) > br * br) return false;
  if (!ship.hitBoxes) return true;                 // broad sphere IS the hitbox for primitives
  const sc = ship.mesh.scale.x || 1;
  ship.mesh.updateMatrixWorld();
  const e = ship.mesh.matrixWorld.elements;
  for (const b of ship.hitBoxes) {
    const cx = e[0] * b.c.x + e[4] * b.c.y + e[8] * b.c.z + e[12];
    const cy = e[1] * b.c.x + e[5] * b.c.y + e[9] * b.c.z + e[13];
    const cz = e[2] * b.c.x + e[6] * b.c.y + e[10] * b.c.z + e[14];
    worldAxis(e, b.u0, _wu0); worldAxis(e, b.u1, _wu1); worldAxis(e, b.u2, _wu2);
    const r0x = p0.x - cx, r0y = p0.y - cy, r0z = p0.z - cz;
    const r1x = p1.x - cx, r1y = p1.y - cy, r1z = p1.z - cz;
    _a0[0] = r0x * _wu0[0] + r0y * _wu0[1] + r0z * _wu0[2];
    _a0[1] = r0x * _wu1[0] + r0y * _wu1[1] + r0z * _wu1[2];
    _a0[2] = r0x * _wu2[0] + r0y * _wu2[1] + r0z * _wu2[2];
    _a1[0] = r1x * _wu0[0] + r1y * _wu0[1] + r1z * _wu0[2];
    _a1[1] = r1x * _wu1[0] + r1y * _wu1[1] + r1z * _wu1[2];
    _a1[2] = r1x * _wu2[0] + r1y * _wu2[1] + r1z * _wu2[2];
    _H[0] = b.h.x * sc + pad; _H[1] = b.h.y * sc + pad; _H[2] = b.h.z * sc + pad;
    if (segIntersectsAABB(_a0, _a1, _H)) return true;
  }
  return false;
}

// Resolve a hostile (enemy) bullet against the player for a single frame: swept-test the bullet's movement
// segment [p0→p1] against the player hull and, on a connect, route the damage through the shield-then-hull
// path (applyPlayerDamage). Deliberately side-effect-free, RNG-free and THREE-free — it mutates ONLY the
// passed-in `player` and never touches scene/audio/FX or the seeded sim RNG — so it is unit-testable under
// `node --test` and record/playback stays deterministic. The caller (sim.update) owns the scene.remove /
// hit-flash / shield-ripple / SFX and the range-based bullet culling. Returns:
//   { hit, damageResult, remove }
//   hit          — the segment connected with the player hull
//   damageResult — the { absorbed, broke } contract from applyPlayerDamage (null when no hit), so the caller
//                  can spawn the cyan shield ripple at the impact point
//   remove       — whether this hit consumes the bullet (true on any hit; range culling stays in sim.update)
export function resolveHostileBulletHit(player, p0, p1, damage) {
  if (!segmentHitsShip(player, p0, p1)) return { hit: false, damageResult: null, remove: false };
  const damageResult = applyPlayerDamage(player, damage);
  return { hit: true, damageResult, remove: true };
}
