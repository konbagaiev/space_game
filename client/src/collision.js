// Multi-sphere ship hitbox tests. Broad-phase (one enclosing sphere) → narrow-phase (per-model spheres).
// hitSpheres/broadR live in the group-local noseZ frame (see ship-factory.js); mesh.matrixWorld folds in
// position + heading + 1.8×sizeScale but NOT the cosmetic bank roll (a child group). Radii scale by mesh.scale.x.
//
// Deliberately THREE-free: the sphere centre is transformed by mesh.matrixWorld.elements with plain math
// (an affine transform, w=1) and distances are squared-compared inline. That keeps this module importable
// under `node --test` (the client has no `three` install for node), so collision.test.js can exercise it.

const LEGACY_R = 2.6; // primitive/cone fallback radius (the historical single-sphere hit radius), ×sizeScale

// World broad-phase radius. Modeled ships → broadR (group-local) × world scale; primitives → legacy 2.6×sizeScale.
export function broadRadius(ship) {
  const sc = ship.mesh.scale.x || 1;
  if (ship.hitSpheres && ship.broadR) return ship.broadR * sc;
  return LEGACY_R * (ship.sizeScale || 1);
}

// squared distance between a THREE.Vector3-like {x,y,z} and a bare (x,y,z)
function distSq(p, x, y, z) {
  const dx = p.x - x, dy = p.y - y, dz = p.z - z;
  return dx * dx + dy * dy + dz * dz;
}

// True if world `point` is within `pad` world units of the ship's hull. Broad-phase first; ships without
// hitSpheres fall back to the single broad sphere (unchanged behavior for primitive/cone ships).
export function pointHitsShip(ship, point, pad = 0) {
  const p = ship.mesh.position;
  const br = broadRadius(ship) + pad;
  if (distSq(point, p.x, p.y, p.z) > br * br) return false;
  if (!ship.hitSpheres) return true;               // broad sphere IS the hitbox for primitives
  const sc = ship.mesh.scale.x || 1;
  ship.mesh.updateMatrixWorld();                   // sim mutates position mid-frame; refresh before transforming
  const e = ship.mesh.matrixWorld.elements;        // column-major 4x4 (folds position + heading + world scale)
  for (const s of ship.hitSpheres) {
    const wx = e[0] * s.x + e[4] * s.y + e[8] * s.z + e[12];
    const wy = e[1] * s.x + e[5] * s.y + e[9] * s.z + e[13];
    const wz = e[2] * s.x + e[6] * s.y + e[10] * s.z + e[14];
    const r = s.r * sc + pad;
    if (distSq(point, wx, wy, wz) <= r * r) return true;
  }
  return false;
}
