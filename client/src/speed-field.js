// Player-locked wrapping speed-field — the PURE (THREE-free, node-testable; see speed-field.test.js) seam.
// It replaces the old static origin-ring backdrop asteroids (makeAsteroids/`rocks`): a small set of point
// layers kept in a box around the player, each point WRAPPED back to the opposite side as the player crosses
// the box edge, so the field streams past and sells the sense of speed while roaming across the system.
//
// This module is deliberately THREE-free (the node test harness has no `three` — same pattern as
// exhaust-config.js): the THREE.Points assembly + per-frame position write live in world.js
// (makeSpeedField/updateSpeedField), which consume these pure helpers. All view-layer → zero sim RNG.

// The parallax layers: `frac` = share of the point pool, `R` = box half-extent (world units) the layer
// wraps within, `par` = parallax factor (slower/farther layers track a scaled player delta), `size` =
// point sprite size, `y`/`depthVar` = the layer's depth band below the combat plane. Tunable in ?roam.
export const SPEED_FIELD_LAYERS = [
  { frac: 0.50, R: 220, par: 1.00, size: 1.6, y: -4,  depthVar: 30 },
  { frac: 0.30, R: 300, par: 0.70, size: 2.4, y: -14, depthVar: 40 },
  { frac: 0.20, R: 380, par: 0.45, size: 3.2, y: -26, depthVar: 50 },
];

// Total point pool derived from the descriptor asteroid `count` (clamped to a cheap 200–600 band).
export function poolSize(cfg = {}) {
  return Math.min(600, Math.max(200, Math.round((cfg.count ?? 2000) / 4)));
}

// Scatter one layer's points uniformly in its box [-R,R] on x/z and its depth band on y. `rand` is injected
// (defaults to Math.random — cosmetic, NEVER the seeded sim stream). Returns a flat Float32-ready number[].
export function scatterLayer(spec, n, rand = Math.random) {
  const pos = new Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3]     = (rand() * 2 - 1) * spec.R;
    pos[i * 3 + 1] = spec.y + (rand() * 2 - 1) * spec.depthVar;
    pos[i * 3 + 2] = (rand() * 2 - 1) * spec.R;
  }
  return pos;
}

// Pure wrap: bring `v` into [center-R, center+R] by adding/subtracting the 2R period. A point that has
// fallen outside the box (because the center moved past it) re-enters on the OPPOSITE side. Node-tested.
export function wrapCoord(v, center, R) {
  const span = 2 * R;
  let d = v - center;
  d = ((d + R) % span + span) % span - R; // → [-R, R)
  return center + d;
}

// Re-wrap a layer's x/z coordinates around a (parallax-scaled) center IN PLACE. `pos` is a flat xyz array
// (mutated); y is left untouched (fixed depth band). Pure arithmetic — the THREE geometry upload is the
// caller's job (world.js). velocity is accepted but unused today (see the stretch hook below).
export function wrapLayerPositions(pos, cx, cz, R /*, velocity */) {
  // TODO: velocity-stretch/warp-streak hook — a future shader could elongate each point along `velocity`.
  for (let i = 0; i < pos.length; i += 3) {
    pos[i]     = wrapCoord(pos[i], cx, R);
    pos[i + 2] = wrapCoord(pos[i + 2], cz, R);
  }
  return pos;
}
