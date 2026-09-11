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

// ---------- THE HUMAN AIM: a tracking error on the PERCEIVED bearing ----------
//
// ONE BLOCK FOR BOTH PILOTS, by design. The Level-4 wingman and the `?duel` aces are the same code
// (`flySentinel`), so they are the same numbers: there is no per-side `ctx` knob, because the duel room is
// supposed to be a test of the WINGMAN's own flying and a pilot that can be tuned apart from the thing it
// tests is not that.
//
// WHAT IS PERTURBED IS THE BEARING, not the nose and not the range. The fire gate judges the projectile's
// real path against the vector it is handed, so an error added to the NOSE would make him HOLD FIRE instead
// of missing — the mechanic would silently invert. The error rotates the unit vector to the target; that
// perceived vector feeds the nose, the come-about exit AND the fire gate, so the gate honestly says "on
// target" while the bullet flies past. `dist` stays true, so every range gate (`groupReach`, `engageBand`,
// `holdFireForPlayer`) is untouched: he misjudges WHERE, not HOW FAR.
//
// ---- THE YARDSTICK: the hull a bullet can actually hit, NOT `broadRadius` ----
//
// `broadRadius` (collision.js) is the broad-phase ENCLOSING SPHERE; the narrow phase (`segmentHitsShip`)
// then tests per-part OBBs, and a top-down shot only ever crosses the hull at `BULLET_PLANE_Y`. Sweeping a
// `segmentHitsShip` probe laterally past each hull at that plane over 288 headings gives the contiguous hit
// half-width — the largest offset that still connects before the first gap:
//
//   hull                                          broadRadius   narrowest half-width   ratio
//   Basic player ship (both pilots fly it)            4.318      1.87 (heading 0.79)   0.433
//   Basic pirate / pirate gunner / pirate lancer      4.153      1.75 (heading 0.46)   0.421
//   basic + advanced rocket pirate                    4.001      1.97 (heading 2.47)   0.492
//   pirate mini boss / advanced medium pirate         7.567      2.82 (heading 0.24)   0.373  ← the floor
//   first + second pirate boss                       11.983      6.60 (heading 3.05)   0.551
//
// The BINDING hull is the `pirate mini boss` / `advanced medium pirate` pair at 0.374 — an ordinary
// `world.enemies` row the wingman fights, not an exotic case. The measurement has to cover EVERY enemy row:
// both `server/src/sim-host.js` and `client/src/main.js` build `enemyShips` with NO level filter, so all
// nine are in scope, and a three-hull sample suggests ~0.42 and is wrong. Test (m) in
// `server/src/ally-sim.test.js` re-measures all of them on every run, because a re-exported model, a new
// `lift` or a re-scaled hull would otherwise silently break "a settled solution lands" with every other
// test still green.
//
// Scaling against `broadRadius` itself — which the first draft of this feature did — overstates a real hull
// by up to 2.7× at the worst aspect: ±2.16 u of range-independent error against a 1.87 u player hull and
// ±3.78 u against a 2.83 u mini boss, losing ~13 % of SETTLED shots on the player hull and ~25 % on the
// mini boss. That breaks the one promise this feature is not allowed to break.
//
//   hitR     = ALLY_AIM_HIT_FRAC × broadRadius(target)      // 1.51 u player, 1.45 u pirate, 2.65 u mini boss
//   thetaHit = min(hitR / max(dist, 1), 0.30)               // its angular half-width, small-angle
//
// Everything below is expressed in units of `thetaHit`: |err| ≤ 1 means the shot is on the hull at EVERY
// aspect.
export const ALLY_AIM_HIT_FRAC = 0.35; // what fraction of broadRadius a bullet must actually be within at the
                                       // BULLET PLANE. Measured floor over every hull the pilot shoots at is
                                       // 0.373 (pirate mini boss / advanced medium pirate); the rest run
                                       // 0.42-0.55. 0.35 sits under the floor with room for a model
                                       // re-export to move it a little (the floor is grid-sensitive: 0.373
                                       // at 1.25° steps, 0.378 at 2.5°).
export const ALLY_AIM_LAG_SEC    = 0.17; // his aim TRAILS the target by this much of its crossing motion
export const ALLY_AIM_TAU_SEC    = 0.30; // smoothing/decay time constant for the rate AND the acquisition kick
export const ALLY_AIM_JITTER     = 0.70; // standing offset, in hit half-widths (±), re-rolled on a timer
export const ALLY_AIM_JITTER_SEC = 0.80; // …how often it is re-rolled
export const ALLY_AIM_KICK       = 2.30; // acquisition kick, in hit half-widths (±). TUNED TO A MEASUREMENT,
                                        // not derived — see "THE FIRST SHOT" below.
export const ALLY_AIM_MAX        = 3.00; // hard cap on the TOTAL error, in hit half-widths
//
// WHY THOSE NUMBERS:
//
// • ALLY_AIM_JITTER 0.70 — "a SETTLED solution lands every shot", provably, and it is one multiplication:
//   the standing offset is at most `ALLY_AIM_JITTER × ALLY_AIM_HIT_FRAC = 0.70 × 0.35 = 0.245` of
//   `broadRadius`, against a measured narrowest half-width of 0.373 of `broadRadius` (the mini boss above).
//   A settled shot therefore connects at EVERY aspect of EVERY hull with ~35 % of margin. BOTH factors have
//   to stay in view: raising either one breaks the promise, and the yardstick test guards the second.
//   **Neither factor was touched when the first-shot rate was raised to ~18 % (2026-09-11):** buying misses
//   by raising the standing jitter would be trading THIS promise, which is a different one and was not
//   traded. Only ALLY_AIM_KICK moved.
//
// • THE FIRST SHOT — ALLY_AIM_KICK 2.30, TUNED TO A MEASUREMENT AND NOT TO A FORMULA.
//   The number that matters is how often the first round at a freshly acquired target actually MISSES A REAL
//   HULL, and that is not any closed form: it is a sweep of `segmentHitsShip(ship, p0, p1)` with no pad —
//   the exact swept call `stepBullets` makes — over the target's headings and over the acquisition-tick error
//   distribution. Note the RANGE CANCELS, which is why one number per hull is meaningful: the lateral miss is
//   `d · tan(err) ≈ d · (j + k) · ALLY_AIM_HIT_FRAC · broadRadius / d`.
//   **How to re-run it:** `firstShotMissRate` in `server/src/ally-sim.test.js` ("THE FIRST SHOT ... against a
//   real hull") is exactly this sweep, over three hulls; widen its `cases` list and print the rates to
//   re-tune. MEASURED at 288 headings (the test samples 24 and agrees to 0.4 points):
//
//     hull                                          KICK 2.00   KICK 2.30 (shipped)
//     Basic pirate / pirate gunner / pirate lancer      11.7 %        18.3 %
//     basic + advanced rocket pirate                     8.3 %        14.3 %
//     pirate mini boss / advanced medium pirate         12.0 %        17.9 %
//     first + second pirate boss                        11.4 %        18.4 %
//     Basic player ship (what an ACE shoots at)         13.6 %        20.2 %
//     mean over all ten hulls                           11.2 %        17.6 %
//
//   2.00 read as too weak in live `?duel` play (maintainer, 2026-09-11); ~18 % is the number he asked for.
//   **The "50 %"-style figure that used to be quoted here is NOT a miss rate.** `P(|j + k| > 1)` — now
//   56.5 % — is the chance the error exceeds the WORST-ASPECT yardstick (`ALLY_AIM_HIT_FRAC × broadRadius`),
//   and a real hull is wider than its worst aspect at almost every heading, with per-part boxes that catch a
//   round past a gap. It is a useful internal bound and it is what `step-ally.test.js` pins as an ANGLE; it
//   is three times the real miss rate and must never be published as one.
//
// • …AND THE SECOND SHOT STILL LANDS, which is the constraint that caps the kick. One Heavy-cannon cooldown
//   is 0.6 s = 36 ticks at 60 Hz, over which the kick decays by (1 − dt/τ)^36 = 0.944444^36 = 0.127747.
//   Worst case against a target that stopped manoeuvring: 2.30 × 0.127747 + 0.70 = 0.9938 < 1 → the second
//   shot lands. **The headroom is now 0.006, where at KICK 2.00 it was 0.045** — the bound is
//   `KICK < (1 − ALLY_AIM_JITTER) / 0.127747 = 2.3484`, and 2.30 sits 2 % under it. That is a deliberate
//   trade for the first-shot rate: the guarantee is still a PROOF, not a probability, but it no longer has
//   slack — so the bound is ASSERTED FROM LIVE INPUTS rather than trusted. `server/src/ally-sim.test.js`
//   imports these three constants and derives the decay COUNT from the gun's real `fireCooldown`, which is
//   the input nothing else here reads: the margin is ONE TICK (weapon 6 at 0.583 s instead of 0.6 s gives 35
//   decays and 1.0111 > 1), so that derivation is what stands between a catalog edit and a silently broken
//   promise. Buying slack back means shortening ALLY_AIM_TAU_SEC, which is
//   SHARED with the tracking lag — a faster decay also makes a manoeuvring target's lag error appear and
//   disappear sooner (the steady-state lag is unchanged; only the transient is) and it would leave the
//   0.3-0.5 s window the maintainer specified. Not done.
//   THIS IS A COUPLING TO `fireCooldown` 0.6 s AND TO NOTHING ELSE — DECISIONS §153. Hand this pilot one of
//   the catalog's 0.12-0.18 s kinetics and its first three or four shots would miss instead.
//
// • ALLY_AIM_LAG_SEC 0.17 — a ~8.6 u/s crossing displaces his aim by one hit half-width (hitR ≈ 1.45 u for a
//   pirate, so v_ref = hitR / LAG = 8.6; 8.9 u/s against the player hull's 1.51 u). Expressed range-free, the
//   lag error in `thetaHit` units is `m = LAG · v_perp / hitR` — THE DISTANCE CANCELS, which is why one
//   coefficient covers every range. Note the direction: LOWERING `ALLY_AIM_HIT_FRAC` shrinks `hitR` and so
//   LOWERS the crossing speed at which the lag costs him a hit.
//   It is NOT tuned to a crossing-pass miss rate: `aimWithDrift` deliberately does not LEAD a moving target,
//   so a target crossing at 30 u/s at 40 u already needs 30 × 40/65 = 18.5 u of lead against a 1.8-3.9 u
//   hittable half-width — every one of those shots already missed before this feature existed. Against the
//   un-led flight-time error `v_perp · d / 65`, the lag contributes `LAG × 65 / d = 11/d` times as much:
//   DOMINANT inside 11 u, 37 % of it at 30 u, 28 % at 40 u. This feature makes the FIRST shot and the CLOSE
//   fight fallible; it does not make fast crossers harder, because they were already un-hittable.
//
// • ALLY_AIM_MAX 3.00 caps the total lateral error at 3 × hitR ≈ 4.4 u ≈ 1.05 broad hull radii, so a miss
//   reads as "passed close by" and never as "shot off into space". It is tighter than the 1.5-2.5 angular
//   RADII originally specified precisely because the yardstick moved from the enclosing sphere to the
//   hittable width. At KICK 2.30 the jitter + kick peak is 3.00, i.e. EXACTLY the cap — so it still clips
//   nothing but the boundary, and the cap remains effectively a bound on the lag term alone. Raising KICK
//   further would start clipping, which is a second reason 2.30 is where this stops.
//   Two collateral margins are measured against this cap and both were RE-CHECKED at KICK 2.30 (nothing
//   moved, because the cap did not): at `driftFireCase`'s 40 u the total error reaches
//   3.00 × (0.35 × 4.153)/40 = 0.109 rad, which is more than the 0.08 rad the rocket-gate test has spare —
//   that test pins the error to zero for exactly this reason, and now needs to more than before; and at the
//   §2.6 fixture's 30 u it reaches 3.00 × (0.35 × 4.153)/30 = 0.145 rad, still far inside the 0.35 rad
//   fire-block cone, so the nose can never swing out of it.
//
// THE LINE-OF-SIGHT RATE INCLUDES HIS OWN CROSSING MOTION, deliberately: the framing is "if he had to swing
// his hull to get the nose on target there is a chance to miss".

// ---------- Point defence: its own constant, keyed to where the shot MEETS the rocket ----------
//
// A rocket homing AT the pilot has almost no line-of-sight rate (the lag term above would be ~0); one homing
// on his friend crosses faster than anything else in the game. So the intercept uses a pure random
// dispersion against the rocket's own kill radius — the 2.4 u a bullet must come within to detonate it
// (`ROCKET_INTERCEPT_RADIUS`, step-projectiles.js).
//
// AND IT IS MEASURED AT THE INTERCEPT POINT, NOT AT THE ACQUISITION RANGE. The bullet leaves at 65 u/s while
// the rocket closes at 12→37 u/s, so they meet at d × s/(s + v_close) — 0.64-0.84 of the range the error was
// computed at. An error of `e` radians therefore produces a lateral miss of only `e × d × s/(s + v_close)`,
// i.e. the EFFECTIVE tolerance is (2.4/d) × (s + v_close)/s. Sizing the dispersion against the naive 2.4/d
// would have delivered a ~73 % per-shot hit rate, not the 50 % that was agreed — so the closing factor is
// carried explicitly rather than absorbed into the constant, and the hit rate is then independent of the
// rocket's speed.
export const ALLY_PD_JITTER     = 2.00; // intercept scatter, in units of the CLOSING-corrected tolerance:
                                        // a shot lands iff |err| ≤ that tolerance, so with U uniform in
                                        // (−1, 1) the per-shot hit rate is 1/2.00 = 50 %.
export const ALLY_PD_JITTER_SEC = 0.30; // …re-rolled this often — shorter than the 0.6 s gun cooldown, so
                                        // consecutive shots at one rocket are independent rolls.
// ROCKET-LEVEL OUTCOME: a rocket is only acquired inside `engageBand` 45 u and covers that stretch in ~1.5 s,
// so the 0.6 s cooldown gives him 2-3 shots → 1 − 0.5ⁿ = 75-88 % of the rockets he gets more than one shot at
// still die; one he gets a single shot at is a coin flip. (Before this change, measured live: 13 rockets
// fired, 5 shot down, 6 never engaged, 1 reaching a hull — ~71 % of the ones he engaged.)

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
