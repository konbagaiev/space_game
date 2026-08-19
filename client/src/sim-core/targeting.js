// Who a shot is aimed at. Pure scans over the World's combatants — no RNG, no scene graph.
//
// These lived in `projectiles.js`, next to the meshes, but choosing a target is a decision the simulation
// makes and a server has to make it identically. Both are planar (XZ) and deterministic.
//
// See docs/plans/server-authoritative-sim.md (Slice B3c).
import { Vec3 } from './vec.js';
import { nearestInConeIndex } from './steering.js';
import { broadRadius } from './collision.js';

// Nearest enemy in the front sector [fwd ± halfAngle] — the ROCKET seeker's pick, by hull CENTRE.
export function findTargetInSector(world, pos, fwd, halfAngle) {
  let best = null, bestDist = Infinity;
  for (const e of world.enemies) {
    if (e.warping) continue; // not a valid homing target until fully formed
    const to = new Vec3(e.pos.x, e.pos.y, e.pos.z).sub(pos);
    const d = to.length();
    if (d < 0.001) continue;
    to.divideScalar(d);
    if (fwd.dot(to) >= Math.cos(halfAngle) && d < bestDist) { best = e; bestDist = d; }
  }
  return best;
}

// Aim-assist target for a BULLET shot: the best-aimed valid OPPOSING-side target whose HULL overlaps the
// forward cone (halfAngle, radians). Player guns consider every non-warping enemy; enemy guns pick the
// player (if alive). Returns the target ship or null. Deterministic (pure scan; no RNG). Planar (XZ).
// Rockets do NOT use this — they keep findTargetInSector.
//
// Each candidate carries its `broadRadius` — the same enclosing sphere the collision broad-phase uses — so
// the cone test knows how big the ship actually is. Without it a target only counted when its CENTRE fell
// inside the cone, so a ship whose wing was in the line of fire got no correction and the assist appeared
// dead: bullets flew past the wing, and any hit was the wing drifting into them rather than the shot
// bending. The aim point is still the hull CENTRE (see fireMount) — the meaty part, not the wingtip that
// let the target in.
export function findBulletAimTarget(world, pos, fwd, halfAngle, fromPlayer) {
  const from = { x: pos.x, z: pos.z };
  const f = { x: fwd.x, z: fwd.z };            // fwd is horizontal (y=0) → its XZ is unit
  if (fromPlayer) {
    const cands = [];
    for (const e of world.enemies) if (!e.warping) cands.push(e); // skip enemies still forming
    const idx = nearestInConeIndex(from, f, cands.map((e) => ({ x: e.pos.x, z: e.pos.z, r: broadRadius(e) })), halfAngle);
    return idx >= 0 ? cands[idx] : null;
  }
  const p = world.player;
  if (!p || !p.alive) return null;
  const idx = nearestInConeIndex(from, f, [{ x: p.pos.x, z: p.pos.z, r: broadRadius(p) }], halfAngle);
  return idx >= 0 ? p : null;
}
