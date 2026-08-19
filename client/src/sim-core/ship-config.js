// Per-ship model config resolved from the catalog row (`stats.model`).
//
// This looks like presentation — yaw, scale, a lift — but three of the values it returns are SIMULATION
// input: `hitBoxes` and `broadR` decide what a shot connects with, and `muzzle` decides where a shot is
// born. They lived in `ship-factory.js` next to the Three.js loader purely because that is where the model
// is assembled, which meant a headless authority could not resolve a ship's own hitbox. Nothing here reads
// a mesh or a loader — it is a pure read of catalog data, so it belongs in sim-core.
//
// `muzzle`/`exhaust` used to default to null, meaning "measure it off the .glb once it downloads"
// (applyShipModel). They are now baked into the seed by `npm run assets:muzzle`, so the value is the same
// in a browser and in Node, and a shot fired before the model lands is no longer placed differently from
// one fired after. The null fallback remains for PRIMITIVE ships, which have no model to measure.
//
// See docs/plans/server-authoritative-sim.md and docs/plans/ship-model-pipeline.md.

// Per-ship model-presentation config (stats.model), with back-compat for the old loose keys
// (stats.modelYaw / stats.sizeScale) so a stale player_ships row or cache can't break.
export const shipModelCfg = (s) => {
  const m = s.model || {};
  // `lift` (group-local +Y, pre-scale) raises BOTH the visual model (applyShipModel) and the hitboxes
  // together. Bullets fly in the fixed BULLET_PLANE_Y plane, which is the group origin (group-local y=0).
  // A model whose bounding-box center sits above its hull leaves the nose/deck below that plane, so shots
  // pass over it (see enemy_3). We fix this by moving the MODEL onto the plane, never the bullets: lift
  // slides the hull up into the bullet plane, and visual + hitboxes stay in lockstep by sharing this value.
  const lift = m.lift ?? 0;
  const raw = m.hitBoxes ?? null;
  const hitBoxes = (raw && lift)
    ? raw.map((b) => ({ ...b, c: { x: b.c.x, y: b.c.y + lift, z: b.c.z } }))
    : raw;
  return {
    yaw: m.yaw ?? s.modelYaw ?? 0,
    scale: m.scale ?? s.sizeScale ?? 1,
    scaleMul: m.scaleMul ?? 1,
    lift,                       // group-local +Y offset applied to the visual model + hitboxes (top-down aim fix)
    muzzle: m.muzzle ?? null,   // group-local +Z override for the projectile spawn (null → auto from glb bounds)
    exhaust: m.exhaust ?? null, // group-local −Z override for the exhaust spawn (null → auto from glb bounds)
    hitBoxes,                   // per-part OBB hitbox (group-local noseZ frame, lift-adjusted); null → single-sphere fallback
    broadR: m.broadR == null ? null : m.broadR + Math.abs(lift), // grow the broad sphere so lifted boxes stay enclosed
  };
};
