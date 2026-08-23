// The Sentinel wingman: what he flies, how he fights, and when a level says he arrives.
// The reasoning behind each number is docs/plans/combat-ally.md §2d — this is only where they live.

// ---------- The ship ----------
export const ALLY_SHIP_NAME = 'Basic player ship'; // the one flyable hull in the catalog (§2 "already free")
export const ALLY_COMPONENTS = { hull: 13, engine: 5, thruster: 8, repair: 12, shield: 31 }; // NO grab, by design
export const ALLY_MOUNTS = [
  { weapon: 6, group: 'gun', offset: 0, delay: 0 },     // Heavy cannon (power 35, cooldown 0.6)
  { weapon: 3, group: 'rocket', offset: 0, delay: 0 },  // Rocket (homing)
];
export const ALLY_COLOR = 0x3ddc84; // friendly green: three ships share one silhouette (§2c(c)), colour is all we have

// ---------- Arrival ----------
export const ALLY_ARRIVE_BEHIND = 25; // world units BEHIND the player's nose — he warps in and flies past you
export const ALLY_WARP_SEC = 1.0;     // the warp-in grow, same rule enemies use (DECISIONS §54)

// ---------- The pass ----------
export const ALLY_BEHIND_ANGLE = 2.0944;  // 120° — "the target is behind me": the pass is over, arm the re-search
export const ALLY_SNAP_ANGLE = 0.25;      // = the fire rule's aimTol: "I could shoot that one right now" → switch
export const ALLY_TURN_EXIT_ANGLE = 0.25; // COME ABOUT ends here: nose within this of the target → stop braking
                                          // and charge again (same 0.25 as aimTol, so he exits the turn already
                                          // able to fire). The come-about itself is brake + steer together.
export const ALLY_FIRE_BLOCK_HALF_ANGLE = 0.35; // hold fire while the PLAYER is this close to the line and nearer
export const ALLY_TARGET_LEASH = Infinity; // engage only enemies within this of the PLAYER. Infinity = literal §2d
                                           // (nearest to HIMSELF). A finite value is the one-number fix if live
                                           // play shows him wandering off frame — see §3 of combat-ally.md.

// ---------- Retreat & station-keeping ----------
export const ALLY_RETREAT_HP_FRAC = 0.20; // breaks off at ≤20% hull WITH the shield down
export const ALLY_REJOIN_HP_FRAC = 0.40;  // rejoins at ≥40% hull WITH the shield full (≈40 s at 1 HP/s)
export const ALLY_RETREAT_DIST = 70;      // heals this far from the arena centre — just past the frame edge
                                          // (visible half-extent ≈ ±57 u vertically at zoom 1): he does leave view.
                                          // WHY 70: it is well outside the 45 u gun range his pursuers fight
                                          // at (and their 14-22 u standoff band), so anything that follows
                                          // him has to close a long way before it can shoot again. Raise
                                          // this number if the live test shows him re-engaged while
                                          // healing. One constant, no new mechanic.
export const ALLY_ESCORT_DIST = 10;       // station-keeping distance with no enemy anywhere (§2d)
export const ALLY_ESCORT_BAND = 2;        // …and the deadband: he only re-thrusts past ESCORT_DIST + this,
                                          // so he settles instead of pulsing the engine on the spot
export const ALLY_MIN_HP = 1;             // HE CANNOT DIE (§2.4). There is no ally death path anywhere.

// TOP SPEED IS DELIBERATELY NOT A CONSTANT HERE. It is a property of the SHIP, not of the engine or of
// this feature: the ally flies the PLAYER's movement model, so `step-ally.js` reads
// `PLAYER_MAX_SPEED * (a.maxSpeedMul || 1)` straight from `sim-core/step-player.js` — the one place that
// owns the cap. A component that raises the player's cap later must raise his in the same edit.

// ---------- Where a level says he arrives ----------
// Non-mutating: returns a NEW descriptor with a NEW phases array. `buildCatalog` shallow-copies a level, so
// its `phases` array is SHARED with the module-level seed — mutating a phase in place would give every room
// in the process an ally. Do not "simplify" this to an assignment.
export function withAllyAt(level, phaseName) {
  if (!level || !Array.isArray(level.phases)) return level;
  let found = false;
  const phases = level.phases.map((ph) => (ph.name === phaseName ? (found = true, { ...ph, ally: true }) : ph));
  return found ? { ...level, phases } : level; // an unknown phase name changes nothing
}

// The phase the DEV FLAG injects into Level 4: the deterministic wave before the boss, which is the seam
// Level 5 will use for real ("just before the LAST WAVE preceding the boss", §2c).
export const DEV_ALLY_DEFAULT_PHASE = 'clear-out';
