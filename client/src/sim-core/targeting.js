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

// WHO A HOSTILE SHIP IS FIGHTING: the nearest of the player and the allies, by hull centre. Planar, no RNG.
//
// With no ally in the world this returns `world.player` — which is what every enemy read directly before
// there was a third party, so every existing level and every recorded trace is arithmetically unchanged.
//
// A RETREATING ALLY IS STILL A TARGET, deliberately (maintainer, 2026-08-23). An earlier draft skipped him
// so a wingman breaking off could not drag part of the wave off screen; that was vetoed as artificial. The
// ally must behave as close to a real player as possible — this is a rehearsal for multiplayer, and nothing
// makes a fleeing human stop being a target. He is FASTER than every enemy in the level (same flat cap as
// the player), so being chased is a fight he can leave — it costs him nothing. Only WARPING is excluded,
// and only because a forming ship is untouchable anyway (§54).
export function nearestHostileTarget(world, pos) {
  let best = null, bestD = Infinity;
  const p = world.player;
  if (p && p.alive) { best = p; bestD = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z); }
  for (const a of world.allies) {
    if (!a.alive || a.warping) continue;
    const d = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z);
    if (d < bestD) { best = a; bestD = d; }
  }
  return best;
}
