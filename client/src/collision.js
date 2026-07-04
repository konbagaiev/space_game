// Ship hitbox tests. Broad-phase (one enclosing sphere) → narrow-phase (per-part oriented bounding boxes).
// hitBoxes/broadR live in the group-local noseZ frame (see ship-factory.js); mesh.matrixWorld folds in
// position + heading + 1.8×sizeScale but NOT the cosmetic bank roll (a child group). Half-extents scale by
// mesh.scale.x (uniform world scale).
//
// Deliberately THREE-free: each box center is transformed by mesh.matrixWorld.elements with plain math (an
// affine transform, w=1) and each axis is rotated by the matrix's upper-3×3 then renormalized, so the point
// is projected onto the box's world axes inline. That keeps this module importable under `node --test` (the
// client has no `three` install for node), so collision.test.js can exercise it. See DECISIONS §45.

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

// Rotate a group-local unit axis u by matrixWorld's upper-3×3, normalize (uniform world scale sc), and
// return whether the offset (dx,dy,dz) projects within h·sc + pad along it. THREE-free.
function withinAxis(e, u, dx, dy, dz, h, sc, pad) {
  let ax = e[0] * u.x + e[4] * u.y + e[8] * u.z;
  let ay = e[1] * u.x + e[5] * u.y + e[9] * u.z;
  let az = e[2] * u.x + e[6] * u.y + e[10] * u.z;
  const len = Math.hypot(ax, ay, az) || 1; // == sc for a unit axis under uniform scale
  ax /= len; ay /= len; az /= len;
  const proj = dx * ax + dy * ay + dz * az;
  return Math.abs(proj) <= h * sc + pad;
}

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
    if (withinAxis(e, b.u0, dx, dy, dz, b.h.x, sc, pad)
      && withinAxis(e, b.u1, dx, dy, dz, b.h.y, sc, pad)
      && withinAxis(e, b.u2, dx, dy, dz, b.h.z, sc, pad)) return true;
  }
  return false;
}
