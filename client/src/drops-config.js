// Pure constants for the loot-drop system (no imports → importable by scripts/assets-check.mjs under node).
// SINGLE source of truth for the shared drop model URL (client renders it; assets:check validates it).
export const DROP_MODEL_URL = 'assets/ships/metal_box_combat.ee25e1bd.glb'; // built by assets:build (metal box, CC-BY District24)
export const DROP_CHANCE    = 0.2;   // per-kill chance to drop one item
export const MAX_DROPS      = 40;    // hard cap on simultaneous drops in the arena (perf guard)
export const ARM_DELAY      = 0.3;   // seconds in range before the grab engages an item
export const ROTATE_PERIOD  = 5.0;   // seconds per full drop revolution
export const COLLECT_DIST   = 3.0;   // world units: within this of the ship → collected
export const WEIGHT_FALLBACK = 10;   // defensive: used only if an item somehow has no weight

// Pure pull-speed formula (world units/sec): (strength / 2) * (10 / itemWeight). Anchor: strength 10,
// weight 10 → 5 u/s; light parts pull faster (weight 2 → 25 u/s), heavy parts slower. A zero/missing
// weight falls back to WEIGHT_FALLBACK so the sim never divides by zero. Kept here (import-free) so it's
// node-testable without pulling in THREE.
export function pullSpeed(strength, weight) {
  return (strength / 2) * (10 / (weight || WEIGHT_FALLBACK));
}

// Pick one looted item uniformly among the enemy's NON-HULL parts (engine, thruster) + mounted weapons.
// HULLS ARE NEVER DROPPABLE (progression guard — a looted 550-HP boss hull would be equippable and break
// balance; see DECISIONS). e.hull is deliberately excluded from the pool. Pure (no THREE) → node-testable.
// Reads .id off the resolved components/weapons (carried through by resolveComponents/buildMounts).
export function pickLoot(e) {
  const pool = [];
  for (const c of [e.engine, e.thruster]) if (c && c.id != null) pool.push({ kind: 'component', refId: c.id }); // NO e.hull
  for (const m of (e.mounts || [])) if (m.weapon && m.weapon.id != null) pool.push({ kind: 'weapon', refId: m.weapon.id });
  return pool.length ? pool[(Math.random() * pool.length) | 0] : null;
}
