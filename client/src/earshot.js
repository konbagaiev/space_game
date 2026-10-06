// EARSHOT — which world sounds are worth playing (maintainer, 2026-10-05). A sound plays only if what made it
// is IN THE FRAME, plus a thin band past the edge so a blast right on the border is not cut off. Judged on
// the camera's own projection, so it follows the zoom: pull the camera back and you hear more of the fight.
// Your own shots and hits on your own ship do not ask (they are always yours to hear) — this gate is for the
// rest of the battle, which at 100 v 100 was a wall of noise from ships nowhere near the screen.
//
// Pure (no THREE, no DOM) so Node can test it; `sim.js` projects the position and passes NDC in.

export const EARSHOT_MARGIN = 0.15;   // NDC units past the frame edge (~7.5 % of the screen each side)

// `x, y, z` are normalised device coordinates from `Vector3.project(camera)`: on screen is |x|,|y| ≤ 1, and
// |z| ≤ 1 means between the near and far planes (behind the camera projects outside that).
export function inEarshotNdc(x, y, z, margin = EARSHOT_MARGIN) {
  if (!(Math.abs(z) <= 1)) return false;          // behind the camera / past the far plane (NaN-safe)
  const lim = 1 + margin;
  return Math.abs(x) <= lim && Math.abs(y) <= lim;
}
