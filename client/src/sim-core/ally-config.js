// The Sentinel wingman: what he flies, how he fights, and when a level says he arrives.
// The reasoning behind each number is docs/plans/combat-ally.md §2d — this is only where they live.

// ---------- The ship ----------
export const ALLY_SHIP_NAME = 'Basic player ship'; // the one flyable hull in the catalog (§2 "already free")
export const ALLY_COMPONENTS = { hull: 13, engine: 5, thruster: 8, repair: 12, shield: 31 }; // NO grab, by design
export const ALLY_MOUNTS = [
  { weapon: 6, group: 'gun', offset: 0, delay: 0 },     // Heavy cannon (power 35, cooldown 0.6)
  { weapon: 3, group: 'rocket', offset: 0, delay: 0 },  // Rocket (homing)
];
export const ALLY_COLOR = 0x3ddc84; // friendly green — the MINIMAP dot and the primitive placeholder. NOT the
                                    // hull: catalog ships are built with `tint: false` (ship-factory
                                    // modelSpec), so a ship's `color` never reaches its .glb. Which is why
                                    // the wings below exist.

// THE WINGS. He flies the player's own `player_combat` .glb and was otherwise indistinguishable from it, so
// his wing materials are repainted at runtime — no new asset, no CREDITS row, no content hash change.
// The prefix is the material-name convention in the model itself: `Wings_Material` is the one
// `Wings_`-prefixed material in `player_combat.9188c820.glb` (~6.5% of its vertices, but broad flat panels,
// so a much larger share of the silhouette). It carries a baseColorTexture, so this MULTIPLIES the artwork
// rather than flat-filling it — brighten the constant if it reads dull.
// NOTE the maintainer already flagged the trade-off: the player's own hull is 0x4d8bff, so blue wings sit
// nearer the player's palette than green did. One number, tune it live.
export const ALLY_ACCENT_COLOR = 0x2f6bff;          // blue wings (maintainer's call, 2026-08-23)
export const ALLY_ACCENT_MATERIAL_PREFIX = 'Wings_'; // which of the model's materials it repaints

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
export const ALLY_RETREAT_HP_FRAC = 0.25; // breaks off at ≤25% hull WITH the shield down, the INSTANT the
                                          // threshold is crossed (was 0.20 + a once-per-pass decision, which
                                          // killed him: Level 4's boss deals ~35 dmg/s, so 20% of a 200 HP
                                          // hull is a ~1 s window against a ~6 s pass cycle — see §2d and
                                          // DECISIONS §134).
export const ALLY_REJOIN_HP_FRAC = 0.40;  // rejoins at ≥40% hull WITH the shield full (≈40 s at 1 HP/s)
// How far he opens the gap TO THE NEAREST ENEMY before he stops running and lets the drone work. Measured
// from the THREAT, because the threat is the thing he is getting away from.
//
// (`ALLY_RETREAT_DIST = 70`, measured from the ARENA CENTRE, lived here and was broken twice over. Enemies
// SPAWN at 70..130 from that same centre — `ship-entity.js` `70 + simRandom() * 60` — so the holding point
// was the inner edge of the enemy spawn ring. And because he charges enemies sitting out at 70..130, his own
// distance from the centre was usually already PAST 70 when the break-off fired: `70 − d` went negative,
// `approachThrust` correctly returned 0, and he simply stopped dead in the middle of the fight. He entered
// the retreating state and held fire but never opened the distance, which is exactly what the maintainer
// reported. The old justification — "well outside the 45 u gun range" — was reasoning about the wrong
// reference point entirely. Do not reintroduce a centre-relative retreat distance.)
//
// WHY 120: comfortably past `GUN_LONG`'s **90 u** reach (the pirate gunner's long-range MG), not merely past
// the 45 u basic gun, and far outside the 14-22 u standoff band enemies hold. He caps at 30 u/s against
// 10.5-15.75 for every Level-4 enemy, so opening this gap is a race he wins. Raise it if the live test still
// shows him shot at while healing — one constant, no new mechanic.
export const ALLY_BREAK_OFF_DIST = 120;
export const ALLY_ESCORT_DIST = 10;       // station-keeping distance with no enemy anywhere (§2d)
export const ALLY_ESCORT_BAND = 2;        // …and the deadband: he only re-thrusts past ESCORT_DIST + this,
                                          // so he settles instead of pulsing the engine on the spot
// (`ALLY_MIN_HP` lived here and pinned his hull at 1. REMOVED 2026-08-23: the maintainer reversed §2.4 after
// watching an immortal wingman soak three boss rockets at a sliver of hull. He dies for the rest of the
// mission now and returns in the next one — `step-ally.js stepAllyDeaths`.)

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
