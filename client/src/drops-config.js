// Pure constants for the loot-drop system (no imports → importable by scripts/assets-check.mjs under node).
// SINGLE source of truth for the shared drop model URL (client renders it; assets:check validates it).
export const DROP_MODEL_URL = 'assets/ships/metal_box_combat.ee25e1bd.glb'; // built by assets:build (metal box, CC-BY District24)
export const DROP_CHANCE    = 0.2;   // per-kill chance to drop one item
export const MAX_DROPS      = 40;    // hard cap on simultaneous drops in the arena (perf guard)
export const ARM_DELAY      = 0.3;   // seconds in range before the grab engages an item
export const ROTATE_PERIOD  = 5.0;   // seconds per full drop revolution
export const COLLECT_DIST   = 3.0;   // world units: within this of the ship → collected
export const WEIGHT_FALLBACK = 10;   // defensive: used only if an item somehow has no weight

// Grab (tractor) inverse-square pull field. The pull FIELD at a drop is strength·FIELD_K/dist²; the
// beam ENGAGES a drop only where field ≥ FIELD_CUTOFF, so the reach is EMERGENT (derived from the
// cutoff), not a stored stat — see range() below. Both are fixed this iteration.
export const FIELD_K      = 5;    // field numerator scale (sets the emergent reach together with FIELD_CUTOFF)
export const FIELD_CUTOFF = 0.4;  // field threshold: below this the drop leaves the beam (line hides)
export const PULL_SPEED_SCALE = 0.67; // reel-in SPEED multiplier only — tunes how fast drops pull in WITHOUT changing reach

// Reward (L1/L2 last-kill) special drops: the model gets a green emissive tint + an additive green halo
// sprite, and its off-screen pointer pulses green. Cosmetic only — collecting a special drop deposits
// nothing (the one guaranteed copy is server-installed on victory; see DECISIONS).
export const REWARD_TINT      = 0x59e0a0; // green — emissive tint + halo + off-screen pointer glow
export const REWARD_HALO_SIZE = 5.0;      // world-units diameter of the additive halo sprite behind a reward drop
export const DROP_HALO_SIZE   = 4.5;      // soft rarity-color glow behind a normal loot drop (smaller than the reward halo)

// Pure deposit decision, factored out so it's node-testable: a special (cosmetic reward) drop deposits
// NOTHING to the stash; a normal loot drop deposits its item. This is the load-bearing no-dupe guarantee.
export function shouldDeposit(drop) { return !!drop && !drop.special; }

// Pure ownership gate: does the player's active-ship record already carry this reward? A weapon reward is
// owned if any mount references it; a component reward (the L2 repair drone) is owned if the repair slot is
// filled. Takes the active ship explicitly (drops.js passes G.activeShip) so it's THREE-free + node-testable.
export function rewardOwned(activeShip, reward) {
  const as = activeShip; if (!as || !reward) return false;
  if (reward.kind === 'weapon') {
    const mounts = (as.loadout && as.loadout.mounts) || (as.ship && as.ship.stats && as.ship.stats.mounts) || [];
    return mounts.some((m) => m.weapon === reward.refId);
  }
  if (reward.kind === 'component') {
    const comps = as.components || (as.ship && as.ship.components) || {};
    return comps.repair != null; // L2 reward is the repair slot; refId 12 lands here
  }
  return false;
}

// Grab pull math (inverse-square field). All pure + import-free so drops.test.js runs under node.
//   field(strength, dist)  = strength · FIELD_K / dist²        — pull strength at a given distance
//   engaged                = field ≥ FIELD_CUTOFF               — below this the drop leaves the beam
//   pullSpeed(s, w, dist)  = field · (10 / w) · PULL_SPEED_SCALE — u/s toward the ship (light parts pull faster;
//                            the scale tunes reel-in SPEED only, it does NOT affect field/cutoff → reach unchanged)
//   range(strength)        = sqrt(strength · FIELD_K / FIELD_CUTOFF)  — EMERGENT, weight-INDEPENDENT reach
// A zero/missing weight falls back to WEIGHT_FALLBACK so the sim never divides by zero. dist is always
// > 0 in practice (collection at COLLECT_DIST=3 fires before dist→0; drops.js caps the step at the gap).
export function field(strength, dist) {
  return (strength * FIELD_K) / (dist * dist);
}
export function pullSpeed(strength, weight, dist) {
  return field(strength, dist) * (10 / (weight || WEIGHT_FALLBACK)) * PULL_SPEED_SCALE;
}
export function range(strength) {
  return Math.sqrt((strength * FIELD_K) / FIELD_CUTOFF);
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
