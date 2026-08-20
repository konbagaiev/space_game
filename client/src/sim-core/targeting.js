// Who a rocket homes on. A pure scan over the World's combatants — no RNG, no scene graph.
//
// This lived in `projectiles.js`, next to the meshes, but choosing a target is a decision the simulation
// makes and a server has to make it identically. Planar (XZ) and deterministic.
//
// It used to have a sibling, `findBulletAimTarget`, backing the bullet auto-aim cone. That mechanic is
// gone (DECISIONS §124) and so is the function; `broadRadius` was only ever needed by it.
//
// See docs/plans/server-authoritative-sim.md (Slice B3c).
import { Vec3 } from './vec.js';
import { nearestInConeIndex } from './steering.js';

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
