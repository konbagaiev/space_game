# A third combatant in the simulation — and the ally who flies it

> **Step 1 of ROADMAP Phase 4.5.** The design brief is `docs/plans/combat-ally.md`; **§2 / §2d of it are
> settled and are NOT re-opened here.** This plan builds only what that brief's §2c calls "(b) there is no
> third combatant in the simulation today, and this is the bulk of the work": a genuine third party in
> targeting, collision and homing; the ally module itself; the **descriptor field that says when he
> arrives**; the **netsim wire** so a room can run him; and a **dev flag** that injects the arrival into
> Level 4 for local play. Level 5, the base pirates, the boss and every player-facing line are step 2/3 and
> ship as one later batch.
>
> Read before starting: `docs/SUMMARY.md` (§Gameplay, §Simulation state is Three.js-free, §Playing in a
> server-run room), `docs/plans/combat-ally.md` §2/§2c/§2d/§3, `docs/DECISIONS.md` §73 (seeded-RNG
> contract), §76 (one damage router), §124 (no auto-aim), §127 (one clock), §130-§133 (how a mission ends),
> §30 (do not over-engineer).

## Goal

Today the fight is binary end to end: a bullet either scans `world.enemies` or strikes `world.player`, a
rocket branches on `r.fromPlayer`, and `stepEnemyAI` reads `world.player` directly. This change makes the
simulation **three-sided in targeting** — a friendly ship that is not the player can shoot enemies, and
enemies can steer at, aim at, home on and hit it — and adds the **ally** who flies it: a Sentinel wingman
with his own logic (a firing pass and a reversal, not `stepEnemyAI` pointed the other way), his own
loadout, a retreat instead of a death, and kills that advance the mission but pay nothing. He arrives
because a **phase of the level descriptor says so**, which is the mechanism Level 5 will use unchanged. He
runs in `sim-core`, so a **room already controls him server-side**; the only genuinely new server work is
putting him on the wire. Behind the `?ally` dev flag he can be flown in Level 4 locally; with the flag off
nothing about the shipped game changes — **not one extra RNG draw, not one extra entity, not one changed
byte of any recorded trace.**

The user-visible effect (dev flag on, Level 4): at the `clear-out` wave a green Sentinel corvette warps in
behind you, charges the nearest pirate firing, flies straight through it, reverses, picks the next one, and
breaks off to heal when he is nearly dead — coming back a wave later. The kill counter counts his kills;
your credits do not.

---

## Decisions — settled, do not re-ask

**From the brief (`combat-ally.md` §2/§2d), unchanged:**

| | |
|---|---|
| Loadout | Heavy hull id 13 (200 HP), Basic engine id 5, Basic thrusters id 8, Repair drone id 12, **Heavy cannon id 6**, Rocket (homing) id 3, Base shield id 31. **No grab, no skills.** Derived via `deriveDrive`: mass 86, massFactor 0.58, acceleration **8.7** (player 10), turnRate **1.16 rad/s** (player 2.0). **Top speed = the player's flat `PLAYER_MAX_SPEED` 30 u/s** — see "Movement model" below; the brief's "terminal ≈4.8 u/s" was wrong and is corrected in `combat-ally.md` §2d as part of this change. |
| Manoeuvre | Nearest enemy → accelerate at it while firing → fly past → turn. Re-search **arms when the target is behind him** (`|diff| > 120°`); mid-turn switch when another enemy is inside `aimTol` 0.25 rad. Both in named constants. |
| Firing | Falls out of the existing rule (a group only fires inside `g.ai.aimTol`) — he goes quiet through the pass by himself. **Never fires through the player's hull:** `inForwardSector` against the player, hold when it passes and the player is nearer than the target. |
| Retreat | ~~Never mid-charge — the decision is taken **after the pass**. Leaves at **≤20 %** hull~~ **RETIRED/CORRECTED 2026-08-23 (it killed him):** the decision is taken **the instant the damage lands**, mid-charge or not, and the threshold is **≤25 %** hull with the shield **down**. The old rule was written while he could not die; against the boss's ~35 dmg/s a 20 % threshold is a ~1 s window vs a ~6 s pass cycle. Rejoins at **≥40 %** hull with the shield **full**, unchanged. See `combat-ally.md` §2d and DECISIONS §134. |
| Idle | No enemy anywhere → close to ~10 u of the player and hold station. |
| Economy | His kills **increment `world.kills`** (phase advance, HUD, banners, `isLastKillDrop`, the `cleared` payload) and add **nothing** to `world.earned` / `world.earnedXp`. No grab; he does not react to loot at all. |
| Deliberate | He flies **through** enemy hulls on the pass. **Do not** add a lateral pass offset. **Do not** add ship-to-ship collision. Both were proposed and declined. |
| ~~Cannot die~~ | ~~§2.4: he retreats, he does not die.~~ **REVERSED 2026-08-23 by the maintainer after flying it: HE DIES**, for the rest of the mission, and returns in the next one. The retreat survives and becomes the thing standing between low hull and death. See `combat-ally.md` §2.4 and DECISIONS §134. |

**Answered by the maintainer for this step (2026-08-23):**

- **A1 — enemies DO fight him.** An enemy steers/aims/fires at the **nearer of player-or-ally**, and its
  rockets home on whichever it picked. Built now because §2c promises the same rule to the Level-5 base
  pirates. With no ally in the world the selection returns the player, so every existing level is unchanged.
- **A2 — "nearest" means nearest to the ALLY.** §2d is authoritative; **§3's "it targets what threatens
  YOU" is superseded** — it is brief prose written before the maintainer specified the behaviour. A
  player-proximity **leash** goes in as a named constant `ALLY_TARGET_LEASH` **defaulting to `Infinity`**,
  so shipped behaviour is literal §2d and "he wandered off frame" is a one-value fix. **Do not ship a
  finite default.** `docs/plans/combat-ally.md` §3 is edited in this same change so the contradiction
  cannot resurface (Step 19).
- **A3 — the retreat is visible.** ~~He turns, runs to `ALLY_RETREAT_DIST = 70 u` from the arena centre,~~
  **CORRECTED 2026-08-23 (it did not work):** the distance is measured from the **NEAREST ENEMY**, not from
  the arena centre — `ALLY_BREAK_OFF_DIST = 120 u`. Enemies spawn at 70..130 from the centre, so the old
  holding point was the inner edge of their spawn ring, and because he charges enemies out there his own
  centre distance was usually already past 70: `70 − d` went negative, thrust was 0, and he stopped dead in
  the fight. See DECISIONS §134. The original wording follows.
  He turns, runs to `ALLY_RETREAT_DIST = 70 u` from the arena centre,
  holds there while the drone works, and flies back at ≥40 %. No despawn, no warp, no teleport. 70 u is
  deliberately **just past the frame edge** (visible half-extent ≈ ±57 u vertically at zoom 1), so he does
  leave view while healing — intended: the player is meant to be alone.
  **70 u is now a LIVE-TUNING question, not a settled number** (see "Movement model"). What justifies it is
  DISTANCE, not time: 70 u is well outside the **45 u** gun range his pursuers fight at, and far outside
  their 14–22 u standoff band, so anything that follows him has to close a long way before it can shoot
  again. He is faster than every Level-4 enemy and can break contact freely, so the fix — if the live test
  shows him re-engaged while healing — is to **raise this one constant**. Do not add a mechanic for it.
- **A4 — legibility kit.** Same `player_combat` .glb tinted a distinct friendly colour; hull + shield bars
  from the existing pool; a minimap dot in that colour. **No** off-screen edge arrow (it reads as "threat
  over there"), no name label, no HUD panel, **no player-facing copy**.
- **A5 — the arrival is MISSION DATA.** A **phase** of the level descriptor carries `ally: true`; entering
  that phase is when he arrives. Level 5 will set it on the wave before the boss. The **dev flag's only job
  is to inject that field into Level 4** client-side (and into a room, via one query param), so the
  mechanism under test is the real one and shipped Level 4 is unchanged for players.
- **A6 — the wire is IN SCOPE.** The ally must be server-controlled because this feature is preparation for
  multiplayer. The simulation is shared, so an ally written in `sim-core` **is already server-controlled
  inside a room** — there is no second implementation to write and none may be written. What is extra is
  the wire: a snapshot entity kind, its static half, and the client ghost/builder. Ally-only-in-a-room was
  explicitly NOT chosen: `?netsim=1` is opt-in and DECISIONS §131/D1 deliberately keeps normal play
  browser-hosted, so a room-only ally would leave Level 5 companionless for nearly every real player.

**Decisions this plan makes (engineering, §30 — smallest thing that fully delivers):**

1. **`world.allies` is an ARRAY** (empty in every shipped fight), not a single slot. Four consumers are
   list-shaped already — the digest, the netsim attach/despawn map, the HUD bar loop, the minimap — and an
   array needs no special case in any of them. Only one is ever spawned (`spawnAlly` refuses a second).
2. **The simulation becomes three-sided in TARGETING, and stays two-sided in DAMAGE ROUTING.** Friendly
   fire is off in both directions by design (§2.6), so a projectile only ever needs "friendly" vs
   "hostile": `fromPlayer` keeps its meaning **"fired by the friendly side"** (player *or* ally) and the
   change is that a hostile projectile now tests the player **and** every ally. A general N-team model is
   deferred to co-op/PvP, where it will have a reason to exist. Recorded as DECISIONS §134.
3. **Attribution rides a second flag, `fromAlly`,** set on the ally's projectiles only. It never crosses
   the wire (nothing on the client draws differently) and it exists for exactly one rule: an ally kill pays
   no credits and no XP.
4. **The `fire` EVENT keeps meaning "your own shot"** (`fromPlayer: side === 'player'`) while the
   PROJECTILE keeps meaning "friendly side" (`fromPlayer: side !== 'enemy'`). Without this split the
   adapter at `client/src/sim.js:281` would play the ally's guns as if they were yours — his fire must be
   silent (§2.6).
5. ~~**He cannot die, enforced by a floor:** `hp` clamps at `ALLY_MIN_HP = 1`. There is no ally death path at
   all, which also means `world.allies` never shrinks mid-run — the digest and the wire stay simple.~~
   **REVERSED 2026-08-23.** The floor and the constant are gone; `stepAllyDeaths` (in `step-ally.js`, called
   from `tick.js` right after `stepEnemyDeaths`) removes him at `hp <= 0` and emits **`allyDown`** — a new
   event, because `kill` is built for enemies and carries a reward. He pays nothing and `world.kills` does
   not move. `world.allies` therefore DOES shrink mid-run; the digest is still deterministic (same step,
   same tick order on both hosts) and the wire needed nothing (absence is the despawn). The FX is the whole
   announcement — no banner, no log line, no new string.
6. **The ally's kill writes no event-log line** (`byAlly` on the `kill` event; the adapter skips
   `logEvent`). The log is the player's own tally, and "`X` destroyed **+0** · **+0 XP**" would be a lie
   with no new string available to fix it. One-line flip if the maintainer wants it back.
7. **No asset changes.** He flies the existing `player_combat.9188c820.glb` with a different tint (one
   number). **No new `client/assets/CREDITS.md` row, no content-hash change, and therefore NO
   `/publish-itch` step in this feature.**

**Rejected at the maintainer's review gate (2026-08-23) — do not re-propose.** An earlier draft made a
**retreating ally invisible to enemy target selection**, so a wingman breaking off would not drag part of
the wave off screen. **Vetoed:** it adds artificiality, and the ally must behave **as close to a real
player as possible** — this is a rehearsal for actual multiplayer, where nothing makes a fleeing human stop
being a target. If enemies latch onto him and follow him out of the fight, that is acceptable; the minimap
shows where everyone is. **A retreating ally is a fully valid target everywhere** — and, with the movement
model below, **the veto costs nothing**: he is faster than every enemy in Level 4, so a retreat that is
chased is still a retreat he can win.

### Movement model — he flies like the PLAYER, not like an enemy

**The maintainer's rule (2026-08-23):** *thrust determines ACCELERATION, not top speed; top speed is a
property of the SHIP, not of the engine; the ally's max speed must be the same as the player's.* That is
also how the code already works, verified in `client/src/sim-core/step-player.js`:

- **`export const PLAYER_MAX_SPEED = 30`** (`:29`), whose own comment reads *"Flat top speed for the PLAYER
  only (world units/s). Enemies use their per-engine `maxSpeed` instead."* The cap is a flat constant and
  does **not** come from the engine component.
- **There is no per-frame drag while thrusting.** `IDLE_DRAG = 0.8` (`:26`) is applied only inside the
  `if (!controlling)` branch (`:288`) — passive braking when the pilot lets go. Slowing on purpose is
  `brakeStep` (`:41-47`), a kinematic symmetric decel at the ship's own `accel` that stops cleanly at 0.
- The cap is applied at `:296-300` as `PLAYER_MAX_SPEED * (player.maxSpeedMul || 1)`, with `capLifted`
  exempting two autopilot legs.

**So the ally uses that model, and NOT the enemy one.** An earlier draft of this plan gave him the enemy's
`DRAG = 1.8` and a drag-limited terminal speed of ≈4.8 u/s — **that was wrong**, and it would have broken
the feature outright: at one sixth of the player's speed he could not hold station off a player flying at
30, could not catch an enemy, and could not disengage from one. `step-ally.js` therefore:

- **caps at `PLAYER_MAX_SPEED * (a.maxSpeedMul || 1)`, read from `step-player.js`** — the one place that
  owns the cap. He has no skills, so `maxSpeedMul` is 1 and his cap is exactly a fresh player's **30 u/s**.
  Do not re-state `30` anywhere: the maintainer expects components may raise this cap later, and it must
  move in one edit.
- **never imports the enemy `DRAG`**, and never applies `IDLE_DRAG` either. He is an AI: he is always
  either **thrusting** or **braking** (`brakeVel`, the generalised `brakeStep`), never "hands off the
  controls". Where he needs to stop on a point he uses the player's own arrival rule from
  `autopilotControl` (`:83-100`) — thrust while the remaining distance exceeds the kinematic stopping
  distance `v²/(2·accel)`, brake inside it — **fed the CLOSING speed, which is his ground speed only when
  the destination is stationary** (see "Station-keeping on a moving player": at a 30 u/s cap that
  distinction is the difference between escorting at 10 u and trailing at 62).
- keeps `deriveDrive`'s **acceleration 8.7** (player 10) and **turnRate 1.16 rad/s** (player 2.0): he
  accelerates more slowly and turns more slowly because he is heavier (mass 86), and tops out identically.
  0 → 30 u/s takes **≈3.45 s** for him, **3.0 s** for the player.

### The reversal is BRAKE → TURN → RE-ACCELERATE

**The maintainer's shape for the manoeuvre (2026-08-23):** *"a relatively fast turn (1 rad/s) but relatively
long braking and a new acceleration."* He does **not** carry 30 u/s around a constant-speed arc. Once the
target is behind him he **bleeds off speed while coming about**, turns nearly in place, and then builds
speed again into the next pass. Slow, heavy and deliberate — which is what a 200 HP hull on an ordinary
engine should feel like.

**The primitive already exists** and is the same one the player's brake and autopilot use: `brakeStep`
(`step-player.js:42-47`), `dec = Math.min(sp, accel * dt)` — a **symmetric** kinematic decel, deceleration
equal to thrust acceleration, bleeding to zero with no overshoot and never flipping direction. It is
module-private and hard-bound to `world.player`, so it cannot be imported as it stands; **generalise it**
(the four-line `brakeVel` extraction in Step 6) rather than writing a second copy of the maths in
`step-ally.js` — one implementation cannot drift from itself, and it is the smaller change (§30).

**The numbers, re-derived from the source rather than copied** (`acceleration` 8.7, `turnRate` 1.16 rad/s,
cap 30 u/s):

| | |
|---|---|
| 0 → 30 u/s | **3.45 s** (the player: 3.0 s at accel 10) |
| 30 → 0 u/s under `brakeVel` | **3.45 s** — symmetric, same rate |
| 180° at 1.16 rad/s | **2.71 s** |
| speed still carried when the 180° completes | 30 − 8.7 × 2.71 ≈ **6.4 u/s** of old-direction drift |
| ground covered during those 2.71 s | ≈ **49 u** (he coasts past the target while coming about) |
| full stopping distance from 30 u/s | ≈ **52 u** |

So the brake (3.45 s) outlasts the turn (2.71 s): **they run together**, he comes out of the reversal nearly
stationary with a little residual drift, and then spends another ≈3.45 s rebuilding to top speed. **A whole
pass cycle is therefore ~6 s and swings him ~50 u out and back** — big, and deliberately so.

**How the state machine expresses it** (details in Step 9; every threshold is a named constant in
`ally-config.js` because the maintainer intends to tune this from live play):

- **CHARGE** — `thrust = 1`, steer at the target, fire when aligned and in range. Ends when the target
  passes **`ALLY_BEHIND_ANGLE` (120°)** behind him: that is the existing `passArmed` flag being set, and it
  is also the only place the retreat is decided.
- **COME ABOUT** — while `passArmed`: **brake every tick AND steer toward the target at the same time**.
  No new state field; `passArmed` *is* the come-about. The re-search rules run here unchanged.
- **BACK TO CHARGE** — when the nose is within **`ALLY_TURN_EXIT_ANGLE` (0.25 rad, = `aimTol`)** of the
  target, `passArmed` clears and thrust resumes — so he comes out of the turn already able to fire, which
  is what §2d means by "opens up out of the turn". A mid-turn switch to an enemy that is *already* inside
  `ALLY_SNAP_ANGLE` also clears it immediately ("switch to that one and **accelerate at it**"); a switch to
  one that is merely *nearer* does not, because he would otherwise accelerate off in the wrong direction.

**Two consequences to record — observe them, do not pre-empt them:**

1. **The nose still slides off a target at roughly the turn radius he is carrying speed at** — 30 / 1.16 ≈
   **26 u** at full speed (the player's is 15 u). The brief's §2d figure of ≈4 u came from the wrong
   4.8 u/s and is corrected in the same change. So **"he flies through enemy hulls" will now rarely be seen
   at all.** The maintainer's ruling stands regardless: still deliberate, still no ship-to-ship collision,
   still no lateral pass offset.
2. **The firing window per pass is short.** His gun engages inside `ai.range` 45 u and `aimTol` 0.25 rad;
   closing at up to 30 u/s he crosses from 45 u to the ~26 u break-off in **≈0.63 s**, about **one
   Heavy-cannon round** (`fireCooldown` 0.6). Expect a modest damage share — which is exactly what
   `allyKills` measures. The ~50 u excursion is also comparable to the visible frame (≈ ±57 u vertically,
   ≈ ±32 u horizontally in portrait), so **he may leave view mid-reversal**, especially on a phone.

**Do not add machinery for either.** The maintainer's closing instruction: *"when we've built it I'll test
it and then we'll correct from there."* Every lever needed to correct them is already a named constant.

### Station-keeping on a moving player — judge the CLOSING speed, not the ground speed

This is the one place the flat 30 u/s cap changes a rule rather than just a number, and it was got wrong in
a draft of this plan, so it is written out.

`approachThrust` brakes when the distance still to cover drops below `v²/(2·accel)`. At 30 u/s that
allowance is **51.7 u** — larger than the entire 10 u gap the escort is trying to hold. Fed the ally's
**ground** speed it therefore reads "I am going too fast to stop in time" *while he is flying in formation*:
two ships cruising at 30 with a 40 u gap give `remaining` 30 against a 52 u stopping distance, so he brakes,
falls back, and settles at roughly `ALLY_ESCORT_DIST + 52` ≈ **62 u** — past the visible half-extent
(±57 u vertically, ±32 u in portrait) and exactly the "drifting scenery" §2d says the escort exists to
avoid. **And no constant fixes it:** the 52 falls out of `v²/2a`, so neither `ALLY_ESCORT_DIST` nor
`ALLY_ESCORT_BAND` moves it.

The rule is therefore judged on the **closing speed** — the component of `(ally.vel − player.vel)` along the
unit vector from the ally to the player — which is the speed at which the GAP is actually shrinking:

- **flying in formation** (matched velocities): closing ≈ 0 → stopping allowance ≈ 0 → he keeps thrusting
  until he is genuinely inside `ALLY_ESCORT_DIST`. Correct.
- **overtaking a slower or stationary player**: closing is large → he still brakes in time and settles on
  the hold. With the player at rest he begins braking ~52 u out and arrives at ~10 u at walking pace; with
  the player at 20 u/s the allowance is only `10²/17.4` ≈ **5.7 u**, so he eases in from close range.
- **the player pulling away**: closing is negative → clamped to 0 → full thrust, which is all he can do.

**The retreat branch keeps GROUND speed, and that is not an oversight**: its destination is a fixed point
~~`ALLY_RETREAT_DIST` from the arena centre, so ground speed *is* the closing speed there.~~ **CORRECTED
2026-08-23: the break-off destination MOVES too** — it is "120 u from the nearest enemy", and that enemy is
flying. So BOTH branches judge the closing speed, and the "stationary destination" case no longer exists.
The lesson generalised the third time it bit: a distance is only meaningful relative to the thing it is
protecting him from (DECISIONS §134).

**Two limits to state plainly, both accepted:**

1. **He can never win a stern chase.** His cap is the player's cap, so a player who holds full throttle in a
   straight line simply keeps whatever lead they have — the ally closes only while the player is below the
   cap (turning, braking, fighting), which is most of the time. That is precisely what a second human in the
   same ship would face, which is the point (this is a multiplayer rehearsal).
2. **On the flight home he is left behind, and that is fine.** The player's cap is LIFTED on the dock leg —
   `capLifted({ roam, autopilot, docking })` (`sim-core/system-map.js:365`), whose comment calls the docking
   leg "a quick trip home" — while the ally is hard-capped at `PLAYER_MAX_SPEED`. So after "Finish and
   Return" he falls behind and is still out there when the ship docks. The mission is over; do not add an
   exemption for him, and do not report it as a bug from the live test.

*(Detail confirmed while checking this: `makePlayer` always sets `maxSpeedMul` from
`skillEffects(null).mobilityMul`, so the ally's is `1`, not `undefined` — the `|| 1` in the cap expression
is belt-and-braces, not load-bearing. Keep it as written.)*

For reference when reading the live test: every Level-4 enemy is **slower than he is**, verified in
`server/src/catalog_seed.js` — **pirate gunner** *Pirate engine* id 23 `maxSpeed` **15.75** (`:115-117`,
ship `:362-363`); **basic rocket pirate** (`:348`) and **advanced medium pirate** (`:407-408`) *Scout
engine* id 6 `maxSpeed` **10.5** (`:63-65`); **second pirate boss** (`:424`) *Second-boss engine* id 26
`maxSpeed` **14.3** (`:127-129`). And enemies hold a 14–22 u standoff rather than overshooting
(`enemyThrustFactor(dist, near = 14, far = 22)`, `steering.js:43`), so a pursuer trails and keeps firing —
which is why the *holding point* of the retreat, not his speed, is the thing to watch.

---

## Out of scope / non-goals

- **Level 5**, its centre, briefing, victory copy, boss, set-piece and enemy composition.
- **The base pirates' standoff behaviour and weapons** (§2c(a)) — the ally does not use it.
- **Orders / command UI** (§2.3 — autonomous only), a hangar row, a price, a component, a shop entry.
- **Friendly fire in either direction**, ship-to-ship collision, a lateral pass offset.
- **Several allies**, an ally in side missions or roam by default, an ally the player can lose permanently.
  (He can now be lost for the rest of a MISSION — reversed 2026-08-23 — but never for the campaign: a fresh
  run re-enters the phase that spawns him.)
- **Any player-facing string, briefing line, banner or log line** about the wingman.
- **A general N-team/faction model** in the projectile step — see decision 2 above.
- **Any escape mechanic for the retreat** — no speed boost while retreating, no enemy loss-of-interest
  rule, no target-drop distance. He already outruns every enemy in the level (see "Movement model"); if the
  retreat still plays badly the answer is the existing `ALLY_BREAK_OFF_DIST` constant, not a mechanic.
- **Leading a MOVING target.** `aimWithDrift` (added 2026-08-23) corrects the SHOOTER's own drift, which is
  what made his shots miss stationary enemies; predicting where a moving target will be is a separate and
  larger problem.
- **A single fire gate shared by his gun and his rocket.** They fly down different lines off one nose, so
  both the aim test and the §2.6 safety test are asked per group of that group's own projectile path.
- **Correcting ENEMY aim.** Enemies have the identical inherit-velocity flaw and are deliberately left alone:
  fixing it raises the difficulty of all five levels at once and moves every recorded replay. Its own slice,
  its own balance pass (DECISIONS §134).
- **A charge-speed cap or any other new `ALLY_*` knob** invented before the live test — the pass being fast
  and the firing window short are recorded consequences to observe, not defects to pre-empt.
- Enemy behaviour changes other than "target the nearer of player-or-ally".

---

## The RNG guarantee, and how it is tested (DECISIONS §73)

The archive of recorded traces — the Level-0 intro among them — depends on the exact sequence of
`simRandom()` draws. This change must not add, remove or reorder a single draw in any fight without an
ally, and must add none at all in a fight with one:

- `makeAlly` / `spawnAlly` draw **nothing** (`makePlayer` consumes no randomness — the three enemy draws
  live in `makeEnemy`, which the ally does not use).
- `stepAlly` draws **nothing**: no dodge (skills are `null` → `dodge = 0`, so `resolveHostileBulletHit`
  never rolls), no spawn ring, no drop roll of its own.
- `updateGroups`'s enemy reload jitter (`simRandom() * 0.5`, `ship-entity.js:227` block) stays **enemy-only**:
  the condition becomes `side === 'enemy'` — identical for the player (`0`) and for enemies (one draw).
- Everything else the ally touches is a *branch that is not taken* when `world.allies` is empty.

**Tested by:** `node visual/run.mjs 36-sim-divergence` (browser vs Node on the Level-0 trace) and
`node visual/run.mjs 22-intro-replay`, plus a unit test that steps `stepAlly` for 600 ticks in a fight and
asserts `simRandomDraws()` is unchanged.

### Replay / intro impact (mandatory analysis)

`client/src/replay.js` consumers re-run the real `sim.update()`: the Level-0 intro cutscene (the
`introTrace` on the `level-0` descriptor) and any `?playback` trace. This change touches the damage path,
enemy targeting and the projectile step, so it must be shown neutral there:

- **Level 0 has no ally and no `ally` phase**, and the dev flag is not on in a replay, so `world.allies` is
  empty for its whole run. Every new branch is guarded on that (`if (world.allies.length)`, `for (const a
  of world.allies)`), and the enemy target selection returns `world.player` by construction.
- The two rewritten expressions are **algebraically identical** with no ally: `nearestHostileTarget(world,
  e.pos)` → `world.player`; a hostile rocket's `!r.target.alive` → `!world.player.alive` (its target is
  always the player today).
- **Expected oracle results, unchanged:** `22-intro-replay` → 4 kills, cards `p0..p4`, `won=true`, and the
  logged tick still **2474**; `36-sim-divergence` → identical world hash on both hosts, **draws=38**, same
  summary.
- **What those two oracles do and do NOT prove.** Both replay the Level-0 trace, which has no ally and no
  `ally` phase — so they exercise **none** of the ally's own code. That is exactly what they are here for:
  they prove the change is **INERT** when no ally exists. **There is no cross-host oracle for a world that
  HAS an ally, and this step does not build one** — `ally-room.test.js` re-runs a room against itself
  (Node-vs-Node determinism, not host agreement). The ally's own path is covered by `ally-sim.test.js`
  (rules + economy + loadout), `ally-room.test.js` (the room produces him and puts him on the wire),
  `netsim-world.test.js` (the browser builds and interpolates his ghost) and the live verification below.
  Because both hosts import the *same* `sim-core` modules — the server imports `client/src/sim-core/*`
  directly (`server/src/sim-host.js`, `server/src/netsim/room.js`) — an ally-specific browser/Node
  divergence would have to come from a browser-only branch, and `step-ally.js` has none. A second oracle
  (an ally-bearing trace replayed on both hosts) is a reasonable follow-up when Level 5 exists and can be
  recorded; it is **not** required here.
- If either oracle moves at all, **stop** — something took a branch it should not have. Note that
  `22-intro-replay` only *logs* the tick (see the verification section): read the console line, do not
  trust the green exit code.

---

## Steps

### Step 1 — `world.allies`, and the client re-export

`client/src/sim-core/world.js`, in `createWorld()` under `// --- entities ---` (beside `enemies: []`):

```js
    enemies: [],
    // The friendly ships this fight has that are NOT the player. At most one today (the Sentinel wingman,
    // docs/plans/combat-ally.md); an ARRAY because every consumer — the digest, the netsim ghost map, the
    // HUD bars, the minimap — is list-shaped already. Empty in every shipped level: the ally arrives only
    // when a level PHASE asks for him.
    allies: [],
```

…and, beside the existing diagnostic `enemyShieldRefills` in the run-state block:

```js
    // DIAGNOSTIC ONLY — how many of this run's kills the ALLY took. It exists to answer the one question
    // the dev flag is for: "is the wingman stealing the fight?" (docs/plans/combat-ally.md §3). Read off
    // `window.__game.allyKills`; deliberately NOT in the digest or the summary, and nothing gameplay
    // reads it.
    allyKills: 0,
```

`client/src/sim-core/reset-world.js startRun` zeroes it beside `world.enemyShieldRefills = 0`.

Add both to the "What the World holds" comment block in the same file's header prose.

`client/src/state.js:95` — extend the re-export so client modules read it under a plain name:

```js
export const { enemies, bullets, rockets, drops, allies } = world;
```

### Step 2 — `client/src/sim-core/ally-config.js` (new): the loadout, the tuning constants, the descriptor helper

Every number the maintainer will tune live goes here, one file, with the derivation in the comments.

```js
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
export const ALLY_RETREAT_HP_FRAC = 0.25; // CORRECTED 2026-08-23 (was 0.20): breaks off at ≤25% hull WITH
                                          // the shield down, the INSTANT the damage lands
export const ALLY_REJOIN_HP_FRAC = 0.40;  // rejoins at ≥40% hull WITH the shield full (≈40 s at 1 HP/s)
export const ALLY_BREAK_OFF_DIST = 120;   // CORRECTED 2026-08-23 — see DECISIONS §134. Was:
// export const ALLY_RETREAT_DIST = 70;   // heals this far from the arena centre — just past the frame edge
                                          // (visible half-extent ≈ ±57 u vertically at zoom 1): he does leave view.
                                          // WHY 70: it is well outside the 45 u gun range his pursuers fight
                                          // at (and their 14-22 u standoff band), so anything that follows
                                          // him has to close a long way before it can shoot again. Raise
                                          // this number if the live test shows him re-engaged while
                                          // healing. One constant, no new mechanic.
export const ALLY_ESCORT_DIST = 10;       // station-keeping distance with no enemy anywhere (§2d)
export const ALLY_ESCORT_BAND = 2;        // …and the deadband: he only re-thrusts past ESCORT_DIST + this,
                                          // so he settles instead of pulsing the engine on the spot
// (`ALLY_MIN_HP` was here; REMOVED 2026-08-23 with the no-death rule — see the decision list above.)

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
```

### Step 3 — `client/src/sim-core/ally.js` (new): building him and putting him in the world

```js
import { makePlayer } from './ship-entity.js';
import { BULLET_PLANE_Y } from './consts.js';
import { headingToDir } from './steering.js';
import { ALLY_SHIP_NAME, ALLY_COMPONENTS, ALLY_MOUNTS, ALLY_COLOR, ALLY_ARRIVE_BEHIND, ALLY_WARP_SEC } from './ally-config.js';

// The ally's NUMBERS — no randomness, no position. He is built through makePlayer, not makeEnemyShell:
// he carries REAL components (a 200 HP hull, a repair drone, a catalog shield) rather than an enemy's
// derived 1/3-shield split, and the player ship row's fire groups already carry the `ai` rules
// (gun: range 45 / aimTol 0.25, rocket: range 80 / aimTol 0.40) his fire rule reads.
// Draws NOTHING from the seeded stream — see the RNG guarantee in the plan/DECISIONS §73.
// Takes the catalog, not the World, because the netsim client builds this same shell from a wire descriptor.
export function makeAlly(catalog) {
  const shipDef = catalog.shipByName.get(ALLY_SHIP_NAME);
  if (!shipDef) return null;
  const a = makePlayer(catalog, {
    ship: shipDef,
    loadout: { mounts: ALLY_MOUNTS },
    components: ALLY_COMPONENTS,
    skills: null,           // no skills → dodge 0 → a hostile hit never rolls the seeded stream
  });
  a.name = shipDef.name;
  a.color = ALLY_COLOR;     // the livery: one number against the same .glb (§2 "already free")
  a.radius = 2.6 * (a.sizeScale || 1); // health-bar/minimap anchor (makePlayer has no `radius`; enemies do)
  a.isAlly = true;
  a.target = null;          // the enemy he is charging
  a.passArmed = false;      // the current target is BEHIND him: the re-search (and the retreat check) are armed
  a.retreating = false;     // opening the gap to the nearest ENEMY (ALLY_BREAK_OFF_DIST) — STILL a target
  a.thrusting = false;
  return a;
}

// Arrive. Called from the level runner when a phase carries `ally: true`; refuses a second one.
export function spawnAlly(world) {
  if (world.allies.length) return null;
  const a = makeAlly(world.catalog);
  if (!a) return null;
  // Behind the player's nose, so he warps in astern and flies past — deterministic, no RNG.
  const p = world.player, d = headingToDir(p.heading);
  a.pos.set(p.pos.x - d.x * ALLY_ARRIVE_BEHIND, BULLET_PLANE_Y, p.pos.z - d.z * ALLY_ARRIVE_BEHIND);
  a.heading = p.heading;
  a.spawnAge = 0; a.spawnDur = ALLY_WARP_SEC; a.warping = true; a.scale = a.fullScale * 0.001;
  world.allies.push(a);
  world.host.onSpawn('ally', a);
  return a;
}
```

### Step 4 — firing knows three sides (`client/src/sim-core/ship-entity.js`)

`fireMount` and `updateGroups` currently take `isPlayer` (`ship-entity.js:~200` and `:227`). Replace it with
`side` — `'player' | 'ally' | 'enemy'` — and add the rocket target as an explicit argument.

```js
function fireMount(world, ship, mount, fwd, side, rocketTarget) {
  const isPlayer = side === 'player';
  const friendly = side !== 'enemy';       // the PROJECTILE's `fromPlayer` means "fired by the friendly side"
  ...
  if (w.type === 'rocket') {
    // Friendlies seek an enemy in the nose sector; a hostile rocket is handed whoever its shooter is flying at
    // (the player today, the player OR an ally once one exists).
    const target = friendly
      ? findTargetInSector(world, muzzle, fwd, w.seekHalfAngle ?? Math.PI)
      : (rocketTarget || world.player);
    const accel = isPlayer ? ship.acceleration * (ship.rocketSpeedMul || 1) : (w.accel ?? ship.acceleration);
    spawnRocket(world, muzzle, fwd, w, accel, friendly, target, side === 'ally');
    // NOTE the split: the projectile's `fromPlayer` is "friendly side"; the EVENT's is "it was YOUR shot".
    // Only the player's fire is audible (sim.js:281) — the ally's guns must be silent (§2.6).
    world.events.emit({ type: 'fire', weaponClass: w.class, isRocket: true, fromPlayer: isPlayer });
  } else {
    spawnBullet(world, muzzle, fwd, w, friendly, ship.vel, side === 'ally');
    world.events.emit({ type: 'fire', weaponClass: w.class, isRocket: false, fromPlayer: isPlayer });
  }
}

export function updateGroups(world, ship, fwd, side, dt, wantsFire, rocketTarget = null) {
  ...
      // Only ENEMIES stagger their reloads, and only they draw for it. The player and the ally consume no
      // randomness here, which is what keeps every recorded trace bit-identical (DECISIONS §73).
      g.cooldown = g.reload + (side === 'enemy' ? simRandom() * 0.5 : 0);
  ...
      for (const m of g.mounts) g.pending.push({ mount: m, t: m.delay });
  // …and the pending drain passes `side` + `rocketTarget` through to fireMount.
}
```

Call sites to update in the same pass:
- `client/src/sim-core/step-player.js:340` → `updateGroups(world, player, fwd, 'player', dt, …)`.
- `client/src/sim-core/step-enemies.js` (the `updateGroups(...)` call, ~`:100`) → `'enemy'` + the enemy's
  chosen target (Step 6).
- `client/src/ship-build.js:14` — the browser's historical 5-arg shim. Keep its signature, map the boolean:
  `updateGroupsIn(world, ship, fwd, isPlayer ? 'player' : 'enemy', dt, wantsFire)`.

### Step 5 — `fromAlly` on projectiles (`client/src/sim-core/spawn.js`)

Trailing, defaulted, so no existing call changes: `makeBullet(from, dir, weapon, fromPlayer, shooterVel,
fromAlly = false)` and `rocketBody(from, weapon, fromPlayer, maxRangeDefault, fromAlly = false)` each add
`fromAlly,` to the returned object; `makeRocket` / `makeSpiralVolley` / `spawnBullet` / `spawnRocket` take
and forward it (the spiral leader carries it too, harmlessly). Comment it:

```js
// `fromAlly` — WHO on the friendly side fired this. It exists for exactly one rule: an ally's kill pays no
// credits and no XP (docs/plans/combat-ally.md §2.5). It never crosses the wire: nothing is drawn differently.
```

### Step 6 — enemies pick the nearer of player-or-ally

**`client/src/sim-core/targeting.js`** — add beside `findTargetInSector`:

```js
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
```

**`client/src/sim-core/step-enemies.js`** — inside `stepEnemyAI`, keep the `if (!player.alive)` coast rule at
`:71` exactly as it is (a dead player still ends the fight; single-player never reaches it), then replace the
player-only block at `:78`:

```js
    const target = nearestHostileTarget(world, e.pos) || player;
    const toTarget = target.pos.clone().sub(e.pos);
    const dist = toTarget.length();
    toTarget.normalize();
    const desired = Math.atan2(toTarget.x, toTarget.z);
    // …unchanged from here: diff, steerToward, enemyThrustFactor(dist), the velocity integration…
    updateGroups(world, e, ef, 'enemy', dt,
      (g) => !e.warping && world.combatElapsed >= ENEMY_FIRE_GRACE && g.ai && dist < g.ai.range && Math.abs(diff) < g.ai.aimTol,
      target);            // …and its rockets home on whoever it is flying at
```

**Nothing else in this file changes.** In particular **do NOT export `DRAG`** — the ally does not use the
enemy movement model at all (see "Movement model"); an earlier draft exported it and that was the error the
maintainer caught. `forwardVec` also stays private in both `step-enemies.js` and `step-player.js`:
`step-ally.js` builds its nose vector from `headingToDir(heading)`, which `steering.js` already exports and
which both `forwardVec`s are two-line wrappers around.

**One small generalisation in `client/src/sim-core/step-player.js` instead.** `brakeStep` (`:41-47`) is
module-private and hard-bound to `world.player`, so the ally cannot import it as it stands — and he needs it
for both the come-about and every arrival. Generalising is the SMALLER change than a second copy of the
maths in `step-ally.js` (§30): one implementation cannot drift from itself, and the player's own call sites
keep the shorthand.

```js
// Kinematic symmetric-decel brake on ANY ship's velocity: bleed toward 0 at the ship's own thrust accel.
// It stops AT 0 and never flips the direction, which is the "no flying backwards" rule (DECISIONS §113).
// Exported because the ally brakes exactly like a hand-flown ship (docs/plans/combat-ally.md).
export function brakeVel(vel, accel, dt) {
  const sp = vel.length();
  if (sp <= 1e-4) { vel.set(0, 0, 0); return; }
  const dec = Math.min(sp, accel * dt);
  vel.addScaledVector(vel.clone().normalize(), -dec);
}
function brakeStep(world, accel, dt) { brakeVel(world.player.vel, accel, dt); }   // unchanged behaviour
```

That is a pure extraction — same maths, same vector, same call sites — so the player's motion is
bit-identical and both oracles are unaffected.

### Step 7 — kill attribution and the reward split (`client/src/sim-core/step-enemies.js`)

Wherever an enemy takes damage from a friendly projectile, stamp who fired it. Three call sites, all
one-liners next to the existing `applyShieldedDamage(e, …)`:

- `step-projectiles.js` bullet-vs-enemy (`~:40`): `e.lastHitBy = b.fromAlly ? 'ally' : 'player';`
- `spawn.js` `detonateRocket` friendly blast loop: `e.lastHitBy = r.fromAlly ? 'ally' : 'player';`
- (there is no third damage source today; if one is added it must stamp too.)

Then in `stepEnemyDeaths` (`step-enemies.js:~140`):

```js
      // WHO KILLED IT decides only the money. Progress does not care: `world.kills` counts every death, or a
      // level with `advanceWhen: {kills:8}` whose ally took three would never advance and the HUD would
      // freeze over an empty sector (docs/plans/combat-ally.md §2.5). Last hit wins.
      const byAlly = e.lastHitBy === 'ally';
      ...
      world.events.emit({ type: 'kill', pos: e.pos.clone(), isBoss, exhaustColor: …,
        reward: byAlly ? 0 : reward, xp: byAlly ? 0 : xp, byAlly, name: e.name, … });
      ...
      world.kills++;                              // unchanged — every death counts
      if (byAlly) world.allyKills++;              // DIAGNOSTIC: the wingman's share of this run (see below)
      world.earned += byAlly ? 0 : reward;
      world.earnedXp += byAlly ? 0 : xp;
```

The loot roll and the last-kill reward drop stay **exactly** as they are (an ally kill still rolls the 20 %
crate — a crate is the player's to grab, and the roll must stay the last draw of the step).

**Why `allyKills` exists at all.** Every other trace of an ally kill is deliberately invisible: it lumps
into `world.kills`, the credit popup is suppressed by `reward: 0`, and the event-log line is suppressed by
`byAlly` (decision 6). That is right for the player and wrong for the maintainer — `combat-ally.md` §3
makes *"it must not steal the fight"* a design requirement and §2.5 warns that every ally kill quietly
costs the player a reward, and **neither can be judged without the number.** This counter is the one
measurement the whole dev-flag step exists to produce: without it `ALLY_*` cannot be tuned before Level 5.
It is diagnostic only — **not** in `worldDigest`, **not** in `worldSummary`, not on the wire, and nothing
in the simulation reads it.

### Step 8 — hostile projectiles can hit an ally (`client/src/sim-core/step-projectiles.js`)

**Bullets** — the `else` branch at `:55`, after the existing player resolution, unchanged above:

```js
      if (res.hit) {
        …exactly as today…
      } else if (world.allies.length) {
        // The third party. Player first, then allies, in list order — deterministic, and skipped entirely
        // when there is no ally (which is every level that ships today).
        for (const a of world.allies) {
          if (a.warping) continue;               // untouchable while forming, the same rule enemies get (§54)
          const ra = resolveHostileBulletHit(a, _bulletP0, b.pos, b.damage, null); // no dodge: the ally has no skills
          if (!ra.hit) continue;
          hit = true;
          if (ra.impact) b.pos.copy(ra.impact);
          if (ra.damageResult.absorbed) world.events.emit({ type: 'enemyShieldHit', enemy: a, pos: b.pos.clone(), broke: ra.damageResult.broke });
          world.events.emit({ type: 'hit', target: 'ally', shipClass: a.class });
          break;
        }
      }
```

`enemyShieldHit` is reused deliberately: it is the "bubble on THAT ship" event (it already carries an entity
reference and is already id-swapped on the wire), where `shieldHit` is specifically the player's own.

**Rockets** — three edits, each identical with no ally:

- target-lost (both the `r.lead` branch `~:105` and the normal branch `~:137`):
  `if (r.target && (r.fromPlayer ? !world.enemies.includes(r.target) : !r.target.alive)) r.target = null;`
  (a hostile rocket's target is always `world.player` today, so `!r.target.alive` is the same expression).
- detonation (`~:155-159`):

```js
    } else {
      if (world.player.alive && pointHitsShip(world.player, r.pos, r.detonateR)) det = true;
      else if (world.allies.length) {
        for (const a of world.allies) { if (!a.warping && pointHitsShip(a, r.pos, r.detonateR)) { det = true; break; } }
      }
    }
```

- blast damage, `spawn.js detonateRocket` hostile branch: after the player test, the same guarded loop
  applying `applyShieldedDamage(a, r.damage)` and emitting `enemyShieldHit` with `enemy: a`.

### Step 9 — `client/src/sim-core/step-ally.js` (new): the ally's own logic

This is the design content (`combat-ally.md` §3): it is **not** `stepEnemyAI` pointed the other way. An
enemy holds a stand-off band and beelines at a drag-limited crawl; the ally flies the PLAYER's movement
model — charge at full thrust, fly past, **brake and come about together**, re-pick, build speed again —
holds fire across the player's line, breaks off to heal, and escorts when there is nothing to fight.

Exported pure helpers (unit-testable with plain objects, no catalog):

```js
export function nearestEnemyTo(pos, enemies, player, leash) // nearest by centre; skips warping; if `leash`
                                                            // is finite, only enemies within it of `player`
export function aimedEnemy(pos, heading, enemies, tol)      // the best-aimed enemy inside `tol` rad, or null
export function holdFireForPlayer(fwd, toPlayer, playerDist, targetDist) // §2.6: inForwardSector && nearer
export function shouldRetreat(a)  // hp <= ALLY_RETREAT_HP_FRAC * maxHp && !(a._shieldValue > 0)
export function shouldRejoin(a)   // hp >= ALLY_REJOIN_HP_FRAC * maxHp && shield full
// Fly to a point and STOP on it, with the player's own arrival rule (step-player.autopilotControl :83-100):
// thrust while the distance still to cover exceeds the kinematic stopping distance v²/(2·accel), else brake.
// Returns 1 (thrust) or 0 (brake this tick) — never negative: he has no reverse, exactly like the player.
//
// THE FIRST ARGUMENT IS THE CLOSING SPEED, NOT THE GROUND SPEED, and the caller decides which is which:
// the stopping distance that matters is the one for the speed at which the GAP is shrinking. Against a
// stationary destination the two are the same; against a MOVING one they are not, and using ground speed
// there brakes for a rendezvous that is not happening (see the escort branch, which is where this bit).
export function approachThrust(closingSpeed, remaining, accel) {
  const v = Math.max(0, closingSpeed);           // opening (negative) needs no braking allowance at all
  return remaining > (v * v) / (2 * accel) + 0.5 ? 1 : 0;
}
```

The step itself:

```js
export function stepAlly(world, dt) {
  if (!world.allies.length) return;   // no ally in this fight: nothing below runs, nothing draws
  const player = world.player;
  for (const a of world.allies) {
    // 1. Warp-in grow — the same rule enemies get (DECISIONS §54): the delay IS the arrival animation.
    if (a.spawnAge < a.spawnDur) { …ease-out cubic on a.scale…; if (a.spawnAge >= a.spawnDur) a.warping = false; }

    // 2. Repair drone + shield, ALWAYS — including mid-charge. 1 HP/s to the drone's 0.8 cap; the shield
    //    refills all-or-nothing 10 s after breaking (components.repairTick / shieldRecharge).
    const rp = repairTick(a.hp, a.maxHp, a.repair, dt, a._repairAccum); a.hp = rp.hp; a._repairAccum = rp.accum;
    if (a.shield) { …shieldRecharge, same 5 lines enemies use… }
    // SUPERSEDED 2026-08-23 — there is no latch and no `wantsRetreat` field. The break-off is decided
    // at the TOP of the step and acted on at once; see the retreat note below.
    if (!a.retreating && shouldRetreat(a)) { a.retreating = true; a.target = null; a.passArmed = false; }

    // 3. The player is gone → come to a stop and hold fire, the same wind-down enemies do
    //    (step-enemies.js:71) — but braked like a pilot letting go, not on the enemy's exponential DRAG.
    if (!player.alive) { brakeVel(a.vel, a.acceleration, dt); a.pos.addScaledVector(a.vel, dt); a.thrusting = false; continue; }

    const enemies = world.enemies;   // `nearestEnemyTo`/`aimedEnemy` skip the warping ones themselves
    let desired, thrust, wantsFire = false, dist = Infinity, diff = 0;

    if (a.retreating) {
      // 4a. BREAKING OFF. CORRECTED 2026-08-23 — straight away from the NEAREST ENEMY, not from the centre:
      //     player's arrival rule, so he settles on the holding point instead of sailing past it (at
      //     30 u/s the stopping distance is ~52 u, which is most of the run). He does not fire while
      //     healing — a wingman leaving reads as leaving. HE IS STILL A TARGET while he does it (the veto
      //     above); he outruns every Level-4 enemy, so breaking contact is his to win.
      const dx = a.pos.x - world.arenaCenter.x, dz = a.pos.z - world.arenaCenter.z;
      const d = Math.hypot(dx, dz);
      desired = d > 1e-3 ? Math.atan2(dx, dz) : a.heading;   // outward, radially
      // Ground speed IS the closing speed here: the holding point is STATIONARY and he is flying straight
      // at it. (Any lateral drift left over from the fight only overstates it, which brakes him early —
      // safe.) The escort branch below must NOT copy this line; its destination moves.
      // CORRECTED 2026-08-23: threat-relative, and judged on the rate the GAP IS OPENING (the destination
      // moves, so this is the escort case, not the stationary-point one).
      thrust = approachThrust(openingRateFromNearestEnemy, ALLY_BREAK_OFF_DIST - gap, a.acceleration);
      if (shouldRejoin(a)) a.retreating = false;             // ≥40% hull AND the shield full → back in
    } else {
      // 4b. THE PASS. Target bookkeeping first, then geometry against the FINAL target.
      if (a.target && !enemies.includes(a.target)) { a.target = null; a.passArmed = false; }
      if (!a.target) { a.target = nearestEnemyTo(a.pos, enemies, player, ALLY_TARGET_LEASH); a.passArmed = false; }
      if (a.target) {
        const d0 = shortestAngleDelta(a.heading, angleTo(a, a.target));
        if (!a.passArmed && Math.abs(d0) > ALLY_BEHIND_ANGLE) {
          // THE TARGET IS BEHIND HIM: the pass is over. This is the ONLY place the retreat is decided —
          // (RETIRED 2026-08-23: the retreat is no longer decided here — it is taken the instant the
          //  damage lands. "low health never interrupts a charge" (§2d) is struck; see DECISIONS §134.)
          a.passArmed = true;
          if (shouldRetreat(a)) { a.retreating = true; a.target = null; }
        }
        if (a.passArmed && a.target) {
          // Re-search, armed. Either something swung round into a shot he could take RIGHT NOW, or somebody
          // else is simply nearer after the pass.
          const snap = aimedEnemy(a.pos, a.heading, enemies, ALLY_SNAP_ANGLE);
          const near = nearestEnemyTo(a.pos, enemies, player, ALLY_TARGET_LEASH);
          const next = snap || (near !== a.target ? near : null);
          // A SNAP target is already inside the aim cone, so §2d's "switch to that one and accelerate at
          // it" applies at once: end the come-about. A merely NEARER one does not end it — he would
          // accelerate off at whatever angle it happens to sit at, instead of coming about first.
          if (next && next !== a.target) { a.target = next; if (next === snap) a.passArmed = false; }
        }
        // COME ABOUT ENDS when the nose reaches the target: stop braking, charge again, already able to fire.
        if (a.passArmed && a.target
            && Math.abs(shortestAngleDelta(a.heading, angleTo(a, a.target))) <= ALLY_TURN_EXIT_ANGLE) {
          a.passArmed = false;
        }
      }
      if (a.target) {
        const to = a.target.pos.clone().sub(a.pos); dist = to.length(); to.normalize();
        desired = Math.atan2(to.x, to.z);
        // CHARGE (thrust) or COME ABOUT (brake) — the reversal is brake + turn TOGETHER, never a
        // constant-speed arc (see "The reversal is BRAKE → TURN → RE-ACCELERATE"). He still steers at the
        // target in both, so the only difference this line makes is whether the engine is lit.
        thrust = a.passArmed ? 0 : 1;
        wantsFire = true;
      } else {
        // 4c. NOTHING TO FIGHT: escort. Close to ~10 u of the player and hold — a wingman with nothing to do
        //     should read as escorting, not as drifting scenery (§2d). Same arrival rule as the retreat,
        //     with ONE difference that is the whole point: the destination MOVES, so the approach is judged
        //     on the CLOSING speed — the component of (his velocity − the player's) along the line to the
        //     player — not on his ground speed. Ground speed would have him braking at 30 u/s while flying
        //     in formation, because his 52 u stopping distance exceeds the gap he is trying to hold; he
        //     would settle ~62 u back, off the frame, and no constant could fix it (the 52 falls out of
        //     v²/2a). See "Station-keeping on a moving player". NOT `enemyThrustFactor` either, whose
        //     -0.6 band is a REVERSE the player does not have (DECISIONS §113).
        const to = player.pos.clone().sub(a.pos); const pd = to.length();
        desired = Math.atan2(to.x, to.z);
        const remaining = pd - ALLY_ESCORT_DIST;
        const closing = pd > 1e-6                       // >0 closing, <0 opening; 0 when flying in formation
          ? ((a.vel.x - player.vel.x) * to.x + (a.vel.z - player.vel.z) * to.z) / pd
          : 0;
        thrust = remaining > ALLY_ESCORT_BAND ? approachThrust(closing, remaining, a.acceleration) : 0;
      }
    }

    diff = shortestAngleDelta(a.heading, desired);
    a.heading = steerToward(a.heading, desired, a.turnRate * dt);
    const fwd = headingToDir(a.heading);   // {x,z} from steering.js — NOT step-enemies' private forwardVec
    // THE PLAYER'S MOVEMENT MODEL, not the enemy's: thrust OR brake (never both, never a passive drag),
    // then the player's FLAT cap. `a.engine.maxSpeed` is deliberately ignored — top speed is a property of
    // the ship, not of the engine (maintainer, 2026-08-23) — and the enemy `DRAG` is never imported.
    if (thrust > 0) a.vel.addScaledVector(fwd, a.acceleration * thrust * dt);
    else brakeVel(a.vel, a.acceleration, dt);
    const maxSpeed = PLAYER_MAX_SPEED * (a.maxSpeedMul || 1);   // no skills → 1 → exactly a fresh player's 30
    if (a.vel.length() > maxSpeed) a.vel.setLength(maxSpeed);
    a.pos.addScaledVector(a.vel, dt);     // no arena clamp: he fights out of bounds like everyone else
    a.thrusting = thrust > 0;             // render consequence only (the exhaust plume)

    // 5. FIRE. The pulse is free: a group only fires inside its own aimTol, so he goes quiet through the
    //    pass and opens up out of the turn without a line of code. What IS written is the discipline —
    //    never a tracer through the player's hull (§2.6).
    const toP = { x: player.pos.x - a.pos.x, z: player.pos.z - a.pos.z };
    const blocked = holdFireForPlayer(fwd, toP, Math.hypot(toP.x, toP.z), dist);
    // No `rocketTarget` argument: the friendly branch of `fireMount` resolves its own seeker target with
    // `findTargetInSector` (the same rule the player's rockets follow), so passing `a.target` would be a
    // dead argument. Only an ENEMY is handed a target, because a hostile rocket's is "whoever I fly at".
    updateGroups(world, a, fwd, 'ally', dt,
      (g) => wantsFire && !a.warping && !blocked && g.ai && dist < g.ai.range && Math.abs(diff) < g.ai.aimTol);
  }
}
```

Imports, stated so nobody guesses: `PLAYER_MAX_SPEED` and `brakeVel` from `./step-player.js`;
`headingToDir` / `shortestAngleDelta` / `steerToward` / `inForwardSector` from `./steering.js`;
`repairTick` / `shieldRecharge` from `./components.js`; `updateGroups` from `./ship-entity.js`; the
constants from `./ally-config.js`. **Nothing from `step-enemies.js`.**

Note deliberately absent: `ENEMY_FIRE_GRACE` (he arrives mid-fight, long past it), the enemy `DRAG`, the
player's passive `IDLE_DRAG` (he is an AI — he always holds a control, so he thrusts or brakes), and
`enemyThrustFactor` (its negative band is a reverse the player does not have).

**~~About the `ALLY_MIN_HP` floor and WHEN it runs.~~ SUPERSEDED 2026-08-23 — HE DIES.** `stepAllyDeaths`
walks `world.allies`, and anything at `hp <= 0` emits `allyDown` and is despawned. It runs from `tick.js`
immediately after `stepEnemyDeaths`, i.e. after the projectile steps that caused the damage — the same
placement and the same reason the enemy death step has.

**And the retreat had to be fixed in the same change, because it is now the thing that keeps him alive. It
took THREE attempts, and the first two are recorded here because each looked correct on paper.**

1. *Sampled once per pass.* `shouldRetreat` was consulted only at the instant `passArmed` flipped. But
   `shieldRecharge` refills all-or-nothing 10 s after a break, so the condition oscillates on a ~10 s cycle
   and that single sample almost always missed it — against a boss re-breaking the shield he never left.
2. *Latched every tick, acted on at the pass.* Fixed the sampling, kept the cadence. Still failed: Level 4's
   boss puts out ~35 dmg/s, so at 200 max HP the 20 % threshold gave a **~1 second** window against a ~6 s
   pass cycle. The rule "low health never interrupts a charge" was written while the ally **could not die**;
   once he became mortal it meant "die mid-charge".
3. **Current, 2026-08-23: threshold 25 %, decided on damage and acted on IMMEDIATELY.** There is no latch and
   no `wantsRetreat` field — both are deleted. §2d's "never interrupts a charge" is RETIRED. The shield
   clause survives but costs nothing: damage routes through the shield first (§76), so it is down by
   construction when hull damage lands.

**The accepted cost:** leaving mid-charge turns him away with 30 u/s of momentum and the nose still on the
enemy, so he coasts THROUGH it — the gap dips to well under a unit and he stays inside the 45 u gun range for
2.2–3.6 s before opening to 120 u. Exposure went from unbounded to bounded; some break-offs still end in
death, which is intended.

### Step 10 — the tick order (`client/src/sim-core/tick.js`)

One line, immediately after `stepPlayer` — the friendly side moves before the hostile side reads its
position, mirroring where the player already sits:

```js
  if (alive) stepPlayer(world, dt);
  stepAlly(world, dt);              // the friendly ship that is not the player (winds down on his own if the player is gone)
  stepEnemyAI(world, dt);
```

Update the file-header note about call order being execution order to mention the new step.

### Step 11 — the descriptor field (`client/src/sim-core/level-runner.js`)

In `enterPhase(world)` (`:~87`), after the "Final Stage" banner block and before the `event === 'win'`
handling:

```js
  // THE ALLY ARRIVES BECAUSE THE MISSION SAYS SO. `ally: true` on a phase = "he joins when this phase
  // starts" — the same data-driven shape the enemy waves use, so Level 5 sets one field and nothing else
  // (docs/plans/combat-ally.md). No level in the seed carries it today; the ?ally dev flag injects it.
  if (ph && ph.ally) spawnAlly(world);   // refuses a second one
```

Document the field beside the phase-script description in the module header.

### Step 12 — a fresh run has no ally (`client/src/sim-core/reset-world.js`)

In `clearAndPlaceRun`, beside the enemy teardown:

```js
  for (const a of world.allies) world.host.onDespawn('ally', a);
  world.allies.length = 0;
```

### Step 13 — the digest (`client/src/sim-core/digest.js`)

After the `for (const e of world.enemies)` loop, append (an empty `allies` pushes nothing, so **every
existing hash is unchanged**):

```js
  for (const a of world.allies) {
    parts.push('al');
    pushVec(parts, a.pos); pushVec(parts, a.vel);
    parts.push(String(a.heading), String(a.hp), String(a._shieldValue), String(a.spawnAge),
      String(a.warping), String(a.retreating), String(world.enemies.indexOf(a.target))); // -1 = no target
  }
```

…and `allies: world.allies.length` in `worldSummary`. Both hosts compute the same key, so the deep-equal in
`36-sim-divergence` still holds. **Grep for any test that deep-equals a fixed summary object and update it.**

**`world.allyKills` goes in NEITHER.** It is a maintainer's readout, not simulation state anyone must agree
on; putting it in the digest or the summary would move hashes/summaries for no benefit.

### Step 14 — the browser gives him a body

- `client/src/ship-build.js`, after `detachEnemyBody` (`:~65-90`):

```js
// An ally's body is built exactly like an enemy's — same .glb, tinted by its OWN colour (ally-config
// ALLY_COLOR). Named separately because the host's `kind` is what says which list it came from.
export const attachAllyBody = attachEnemyBody;
export const detachAllyBody = detachEnemyBody;
```

- `client/src/sim.js:410` host: `else if (kind === 'ally') attachAllyBody(e);` and the mirror in
  `onDespawn`.
- `client/src/sim.js:235` `syncMeshes`: `for (const a of allies) syncShipMesh(a, dt);` (import `allies`
  from `state.js`).
- `client/src/main.js:1272` debug hooks: add `allies` to `window.__game`, plus the readout the dev flag
  exists to produce:

```js
    allies,                                          // the live ally array (count/positions/hp assertable)
    get allyKills() { return G.allyKills; },          // diagnostic: how many of this run's kills he took
```

  (`G.<name>` proxies onto the World for run-state fields — the `for (const k of ['kills', 'enemyTotal',
  …])` loop at `client/src/state.js:160` — so add `'allyKills'` to that list when you add the field in
  Step 1. Or read `world.allyKills` directly; the proxy is only for consistency with its neighbours.)

### Step 15 — the HUD (A4: bars + minimap dot, nothing else)

`client/src/hud.js` — the bar loop at `:353` and the minimap loop at `:413`. Extract the per-ship bar body
into a local `function drawShipBars(e)` returning whether it used a slot, then run it for `enemies` and then
for `allies` sharing the same `used` counter (no array spread per frame). The ally carries every field the
loop reads (`hp`, `maxHp`, `shield`, `_shieldValue`, `_shieldRechargeAccum`, `radius`, `pos`).

Minimap: a second small loop over `allies` using the same dot code and `a.color`.

**Do not touch** the off-screen edge-arrow loop at `:190` — an arrow pointing at him reads as "threat over
there" (A4).

### Step 16 — the event adapter (`client/src/sim.js`)

- `case 'hit'` (`:257`): unchanged behaviour — `ev.target === 'player'` is still the only sampled hull
  impact; `'ally'` falls through to the generic zap like `'enemy'`. Update the comment.
- `case 'kill'` (`:303`): the credit popup is already guarded by `ev.reward > 0`, so an ally kill shows
  none. Add `if (!ev.byAlly) logEvent(t('ui.log.killed', …));` — the event log is the player's own tally and
  there is no new string to describe a wingman's kill in this step (decision 6).
- `case 'fire'` (`:281`): unchanged — it already keys off `ev.fromPlayer`, which now means "your own shot".
- Extend the event catalogue comment in `client/src/sim-core/events.js`: `hit` gains `'ally'` as a `target`
  value; `kill` gains `byAlly`. **Edit those lines in place and keep their exact prefix shape**
  (`//   { type: 'hit',` / `//   { type: 'kill',`): `server/src/netsim/room.test.js:122` parses this
  comment block with `/^\/\/\s+\{\s*type:\s*'([a-zA-Z]+)'/gm` and asserts it finds **≥ 19** types, so a
  reflowed or re-indented catalogue line silently breaks the wire-allowlist guard.

### Step 17 — the dev flag (`?ally`)

**`client/src/ally-dev.js`** (new, pure + unit-testable, same non-sticky shape as `dev.js`):

```js
// ?ally — DEV ONLY: inject the ally's arrival into the level this tab is about to fly.
//
// It injects the REAL mechanism (a phase's `ally: true`) rather than spawning him itself, so what is being
// tested locally is exactly what Level 5 will ship. Bare `?ally` uses DEV_ALLY_DEFAULT_PHASE ('clear-out'
// on Level 4 — the deterministic wave before the boss); `?ally=wave-1` names another phase.
//
// NOT STICKY, ANYWHERE (the §81 rule `dev.js` follows): the URL alone decides, nothing is stored, and with
// the flag absent the simulation has no ally, runs no ally step, draws no extra randomness and produces a
// byte-identical world (DECISIONS §73).
export function evalAllyDev(search) { … null | { phase } … }
export const allyDev = () => ALLY_DEV;
export const applyAllyDev = (descriptor) => (ALLY_DEV ? withAllyAt(descriptor, ALLY_DEV.phase) : descriptor);
```

Wrap **all three** places a level descriptor lands (miss one and the flag silently stops working after a
level advance or a login):

- `client/src/main.js:2035` → `CATALOG.level = applyAllyDev(level.descriptor);`
- `client/src/net.js:230` → same.
- `client/src/account.js:280` → same.

**One caveat to state in the flag's own comment: `?ally` changes the FIGHT, and campaign sessions are
recorded.** Every campaign run is uploaded as a replay (see `docs/SUMMARY.md` §Combat record/playback and
the session recorder), and a session played with the flag on contains an entity that the level descriptor
on the server does not produce — so `server/tools/sim-replay.mjs` and
`server/tools/verify-sessions.mjs` will re-simulate it into a divergence and file it under "disagree". That is expected, not a bug: it is a dev session, not
evidence about the build. Say so in the comment so nobody chases it later, and prefer `?ally` runs on a
throwaway local player.
### Step 18 — the wire (A6)

**Server, `server/src/sim-host.js`** — `createSimWorld({ levelName, seed, ship, host, ally = null })`, and
right after `buildCatalog`, **before** `startRun`:

```js
  // A room may be asked to run the ally (the ?ally dev flag today; Level 5's own descriptor tomorrow).
  // withAllyAt COPIES: `buildCatalog` shares the seed's `phases` array, so mutating it would give every
  // room in this process an ally.
  if (ally) catalog.level = withAllyAt(catalog.level, ally);
```

The referee (`server/tools/sim-replay.mjs`) passes nothing → unchanged.

**`server/src/netsim/room.js`:**
- `createRoom({ …, ally = null })` → `createSimWorld({ …, ally })`.
- `describe()` gains the kind — the client resolves the model from the NAME plus the catalog it already
  has, exactly as an enemy does; only the colour is extra:

```js
    if (kind === 'ally') {
      return { id, kind, name: e.name, shipClass: e.class, color: e.color,
               fullScale: e.fullScale, maxHp: e.maxHp, sizeScale: e.sizeScale };
    }
```

- `takeSnapshot()` gains a rows array with the **same column order as `enemies`**:

```js
        allies: world.allies.map((a) => [idOf(a), a.pos.x, a.pos.z, a.heading, a.hp, a.scale,
                                         a.warping ? 1 : 0, a._shieldValue, a._shieldRechargeAccum]),
```

**`server/src/netsim/protocol.js`:** add `allies: 'id, x, z, heading, hp, scale, warping, shieldValue,
shieldRecharge'` to `COLUMNS`, and `'byAlly'` to `EVENT_FIELDS.kill` (without it a room's client would log
ally kills as the player's).

**`server/src/netsim/socket.js:91`** — read the flag alongside the level and pass it on:
`const ally = url.searchParams.get('ally') || null;` → `createRoom({ levelName, seed, ship, ally, … })`.

**Client, `client/src/netsim.js`:** `wsUrl({ …, ally })` sets `u.searchParams.set('ally', ally)` when
present; `connectNetsim({ …, ally })` forwards it. `client/src/main.js:931` (where the room's level is
chosen) passes `allyDev()?.phase || null`.

**Client, `client/src/netsim-world.js`:**
- `spawnGhost`: `else if (desc.kind === 'ally') { e = makeAlly(world.catalog); if (!e) return null; e.maxHp = desc.maxHp ?? e.maxHp; if (desc.color != null) e.color = desc.color; }` — the same constructor the
  simulation uses, which is the whole point (no second "render-only ally").
- `attachGhost` / `despawnGhost`: map `'ally' → world.allies`.
- `applySnapshot`: `rows(snap.allies, (e, r) => pushSample(state.samples.get(r[0]), { at, tick, x: r[1],
  z: r[2], h: r[3], hp: r[4], sc: r[5], warping: !!r[6], sh: r[7], shr: r[8] }));` — `renderNet` already
  applies those fields generically per id, so interpolation, the health bars and the despawn timing all
  come for free.

### Step 19 — docs (do these in the same change, not after)

- **`docs/plans/combat-ally.md` §3 — the A2 resolution.** Under the bullet "It targets what threatens YOU,
  not what is nearest to it", add, verbatim in substance:

  > **SUPERSEDED (2026-08-23).** This bullet is the brief's own prose, written before the maintainer
  > specified the behaviour. **§2d is authoritative: the ally picks the enemy nearest to HIMSELF**, and
  > that is what shipped in `step-ally.js`. The maintainer's own spec beats the brief's earlier reasoning.
  > The player-relative idea survives only as `ALLY_TARGET_LEASH` (`sim-core/ally-config.js`), a named
  > constant **defaulting to `Infinity`** — set it finite and he will only engage enemies within that
  > distance of the player. Do not re-open this from §3's wording.

  Also flip the "Still open" list: the ally's arrival mechanism is settled (a phase's `ally: true`); the
  exact arrival MOMENT for Level 5 is still the maintainer's call.

  **And correct §2d's physics, marking clearly what was wrong**, so nobody re-derives the error from the
  brief later. Two claims in "What the numbers say about it" are false and must be struck, not softened:

  > **CORRECTED (2026-08-23).** ~~"With `DRAG = 1.8` terminal speed is about **4.8 u/s**"~~ — that applied
  > the ENEMY movement model. The ally flies the **player's**: `PLAYER_MAX_SPEED` is a **flat 30 u/s**
  > (`sim-core/step-player.js:29`, *"Flat top speed for the PLAYER only… Enemies use their per-engine
  > `maxSpeed` instead"*), there is no per-frame drag while thrusting (`IDLE_DRAG` runs only when no
  > control is held), and slowing down is the kinematic `brakeStep`. **Thrust decides ACCELERATION; top
  > speed is a property of the SHIP, not of the engine** (maintainer). So: acceleration **8.7** (0→30 in
  > **3.45 s**), turn **1.16 rad/s** (180° in **2.71 s**), top speed **30 u/s** — the same as the player's.
  >
  > ~~"The pass bottoms out at about **4 units** and he flies THROUGH the enemy"~~ — that figure came from
  > the wrong 4.8 u/s. Turn radius = speed / turn rate = 30 / 1.16 ≈ **26 u** at full speed, so the nose
  > slides off far earlier and **flying through a hull will now rarely be seen**. The ruling it supported
  > is unchanged and still stands: passing through ships is by design, there is no ship-to-ship collision,
  > and no lateral pass offset is to be added.
  >
  > The reversal is **brake → turn → re-accelerate**, not a constant-speed arc: braking (3.45 s) outlasts
  > the 180° turn (2.71 s), so he comes about nearly stationary and rebuilds speed into the next pass.
  > Everything else in §2d — the loadout, the two re-target angles, the retreat thresholds, the free firing
  > pulse, station-keeping — is unaffected.
- **`docs/SUMMARY.md`** — bump `**Updated:**`, and edit:
  - **§Gameplay** — a short "The ally (a third combatant)" block: what he flies, the derived numbers, the
    pass/retreat/escort behaviour, kills-count-but-do-not-pay, no friendly fire, no ship-to-ship collision,
    and that no shipped level spawns him (`?ally` dev flag + a phase's `ally: true`). **Include the
    movement model in one sentence:** he flies the PLAYER's model, not the enemy's — flat cap
    `PLAYER_MAX_SPEED` 30 u/s (top speed is a property of the ship, not the engine), acceleration 8.7 and
    turn 1.16 rad/s from `deriveDrive`, braking with the player's kinematic decel, and a reversal that
    **brakes and turns together** (≈2.7 s to come about, ≈3.45 s to rebuild speed). Enemies target the
    nearer of player-or-ally, **including a retreating one** — he outruns every Level-4 pirate, so that
    costs him nothing.
  - **§Simulation state is Three.js-free** — `world.allies` in the "What the World holds" paragraph, the
    new `sim-core/ally-config.js` / `ally.js` / `step-ally.js` modules, and the sentence that the sim is
    three-sided in targeting and two-sided in damage routing.
  - **§Playing in a server-run room (`?netsim=1`)** — the `ally` snapshot rows + spawn kind and the `ally`
    handshake param.
  - **§Tests** — the new test files.
- **`docs/CHANGELOG.md`** — one bullet under today's date, e.g. *"**A third combatant in the simulation, and
  the wingman who flies it** — enemies now fight the nearer of player-or-ally, hostile fire can hit a
  friendly ship that is not you, and `sim-core/step-ally.js` flies a Sentinel wingman with logic of his own
  (charge, pass through, reverse, break off to heal at 20 % and return at 40 %). He arrives because a level
  PHASE says `ally: true`; no shipped level does. `?ally` injects that into Level 4 for local play, rooms
  take the same flag on the wire. His kills advance the mission and pay nothing."*
- **`docs/DECISIONS.md` §134** — *"The simulation is three-sided in targeting and two-sided in damage
  routing"*, and include the **rejected alternative**: making a retreating ally invisible to enemy target
  selection (vetoed 2026-08-23 — the ally must behave as close to a real player as possible, because this is
  a rehearsal for multiplayer; being followed and pinned is accepted, and the minimap shows where everyone
  is). Also: why a general N-team model was not built (friendly fire is off in both directions, so a
  projectile only needs friendly/hostile; `fromPlayer` keeps meaning "the friendly side" and one extra flag
  `fromAlly` carries the only rule that needs the distinction — the reward split), what it buys (every
  existing trace and both oracles are untouched, because with no ally every new branch is skipped), and what
  it costs (co-op/PvP will have to generalise it, deliberately deferred to when there is a second human).
- **`client/assets/CREDITS.md`** — **no change**; the ally reuses `player_combat.9188c820.glb`. No content
  hash moves, so **no `/publish-itch` step is required for this feature**.

---

## Tests

**Client — `cd client && npm test`** (494 at baseline; all must still pass):

1. **`client/src/sim-core/step-ally.test.js` (new)** — plain objects, no catalog, no browser:
   - `nearestEnemyTo` picks by distance to the ALLY (not the player), skips `warping`, and honours a finite
     `leash` around the player while `Infinity` ignores it;
   - `aimedEnemy` returns the best-aimed enemy inside `ALLY_SNAP_ANGLE` and `null` outside it;
   - `holdFireForPlayer` is true only when the player is inside the cone **and** nearer than the target
     (and false when the player is behind, or beyond the target);
   - `shouldRetreat` needs **both** ≤20 % hull and a broken shield; `shouldRejoin` needs **both** ≥40 % and
     a full shield;
   - **the pass**: with one enemy dead ahead, `stepAlly` closes and fires; once the enemy is behind
     (`|diff| > 120°`) `passArmed` flips, and a nearer second enemy takes the target;
   - **the MOVEMENT MODEL is the player's, not the enemy's** — the regression that this revision exists to
     prevent: hold an enemy far ahead and step for ~5 s of sim time; his speed must climb **past 4.8 u/s**
     and settle at **`PLAYER_MAX_SPEED`** (import the constant, never hard-code 30), and must not exceed
     it. A companion assertion that he is not on exponential drag: with no thrust and no brake his velocity
     would decay — instead, in the come-about, it must fall **linearly** at `acceleration` per second
     (sample two ticks and compare the delta to `a.acceleration * dt` within a small epsilon);
   - **the come-about brakes and turns together**: with `passArmed` true and the target behind, one step
     must both reduce `|vel|` by ≈`acceleration * dt` and rotate `heading` toward the target by
     ≈`turnRate * dt`. Then, once the nose is inside `ALLY_TURN_EXIT_ANGLE`, `passArmed` clears and the very
     next step ACCELERATES again (speed increases);
   - **a mid-turn switch to a SNAP target ends the come-about immediately; a switch to a merely NEARER one
     does not** (he keeps braking until the nose comes round);
   - **ESCORT ON A MOVING PLAYER — the case every other movement test misses**, because they all use a
     stationary reference and pass with the ground-speed bug in place. Two halves, and **both are
     load-bearing** (each fails on its own against the old rule):
     (a) **formation**: no enemies, the player flying at `PLAYER_MAX_SPEED` in a straight line and the ally
     40 u behind **at the same speed** — one step must **thrust, not brake** (`a.thrusting === true`, and
     `|vel|` must not drop). Ground speed would brake here (40 − 10 = 30 remaining against a 51.7 u
     allowance);
     (b) **convergence**: the player at **0.8 × `PLAYER_MAX_SPEED`** (24 u/s — near the cap, but below it,
     because at exactly the cap he cannot close at all and (a) is the assertion that covers that), the ally
     starting at the cap 60 u back. Step ~10 s of sim time, **advancing `player.pos` by `player.vel * dt`
     in the test loop** since `stepAlly` does not move the player, and assert the gap **converges toward
     `ALLY_ESCORT_DIST`** — under 20 u. The two models are ~4× apart here: closing speed settles him at
     ≈10–12 u, while ground speed parks him at `ALLY_ESCORT_DIST + 24²/(2 × 8.7)` ≈ **43 u** and never
     crosses 20. (Do **not** run this half at a third of the cap: there the old rule's allowance is only
     ≈5.7 u, so it settles near the threshold and the test reads as flaky instead of as a regression.);
   - **the retreat is never taken mid-charge**: at 10 % hull with a broken shield and the target ahead,
     `a.retreating` stays false; it flips only on the tick the pass arms;
   - **he DIES** (reversed 2026-08-23): bring `hp` to 0, run `stepAllyDeaths`, assert he is out of
     `world.allies`, `alive === false`, that `world.kills` / `earned` / `earnedXp` / `drops` did not move,
     and that exactly one `allyDown` event was emitted carrying no reward field. Plus: a full tick with a
     dead wingman still runs, and a fresh run brings him back;
   - **the retreat LATCHES**: at 10 % hull with the shield broken, let the shield refill to FULL *before* the
     pass arms — he must still retreat. That is the exact case the one-sample-per-pass rule let escape;
   - **a RETREATING ally is still a target** — name the case for the module it actually guards, e.g.
     `test('targeting: nearestHostileTarget still returns a RETREATING ally (veto 2026-08-23)')`. It lives
     in this file because it belongs to the ally's rules, but it exercises `sim-core/targeting.js` (both
     modules are `three`-free, so both load under `node --test`). With `a.retreating = true` and the ally
     nearer to an enemy than the player is, `nearestHostileTarget(world, e.pos)` must return **the ally**,
     not the player. If someone re-adds the exclusion, this test fails and says why;
   - **ZERO RNG**: seed the stream, step a fight with an ally for 600 ticks with `world.enemies` populated
     by hand, assert `simRandomDraws()` is unchanged.
2. **`client/src/ally-dev.test.js` (new)** — `evalAllyDev('')`/`'?dev'` → null; `'?ally'` →
   `{ phase: 'clear-out' }`; `'?ally=wave-1'` → that phase; `'?ally=0'` → null. `withAllyAt` does not mutate
   its input, returns a NEW `phases` array with a NEW phase object, and returns the input untouched for an
   unknown phase name.
3. **`client/src/netsim-world.test.js` (extend)** — a snapshot carrying an `ally` spawn descriptor plus
   `allies` rows: the ghost lands in `world.allies` with a body, is interpolated between two samples, takes
   `hp`/`_shieldValue` outright (never lerped), and is despawned when it stops being listed.
4. **`client/src/sim-core/boundary.test.js`** — passes unchanged; the three new `sim-core` modules import
   nothing outside the folder and load in Node.

**Server — `cd server && npm test`** (214 at baseline; needs local Postgres — `npm test` drops and recreates
`spacegame_test` via `pretest`):

5. **`server/src/ally-sim.test.js` (new)** — `createSimWorld({ levelName: 'level-4', ally: 'wave-1' })`
   against the real seed:
   - the ally is in `world.allies` exactly once when that phase starts, and never twice;
   - **the loadout is guarded against catalog drift**: `maxHp === 200`, `mass === 86`,
     `acceleration ≈ 8.7`, `turnRate ≈ 1.16`, `shield.capacity === 20`, `repair` present, `grab` null,
     mounts = weapons 6 and 3 — and `maxSpeedMul` is 1, so his cap resolves to exactly `PLAYER_MAX_SPEED`;
   - `spawnAlly` consumes **no** seeded draws;
   - an ally kill (`e.lastHitBy = 'ally'`, `hp = 0`, `stepEnemyDeaths`) increments `world.kills` and leaves
     `world.earned` / `world.earnedXp` untouched; a player kill still pays;
   - `withAllyAt` does not mutate `LEVELS` — build two worlds, one with the flag and one without, and assert
     the second has no `ally` phase.
6. **`server/src/netsim/ally-room.test.js` (new)** — a room on `level-4` with `ally: 'wave-1'`: the spawn
   queue eventually carries a `kind: 'ally'` descriptor, snapshots carry `allies` rows of the documented
   width, no snapshot ever leaks `hitBoxes`, and the room's `digest()` is stable across a re-run with the
   same seed and inputs.
7. **`server/src/netsim/room.test.js:122`** — `test('every event in the sim-core catalogue is wired for the
   network')` must still pass unchanged. It READS `client/src/sim-core/events.js` and parses the catalogue
   comment with `/^\/\/\s+\{\s*type:\s*'([a-zA-Z]+)'/gm`, asserts `catalogue.length >= 19`, and requires
   every parsed type to have an `EVENT_FIELDS` entry. So the Step 16 edits to the catalogue comment must
   keep each line's exact `//   { type: 'name',` prefix shape — reflowing or re-indenting those lines
   breaks the parser (and the same test is what catches a new event type nobody wired up). The same file
   also asserts `hitBoxes` never appears in a snapshot, which now covers the ally rows too.

**Visual oracles — one argument each, run one at a time** (`visual/run.mjs` reads only `process.argv[2]`;
the full suite does not finish on this machine — an unhandled timeout after ~13 scenarios that reproduces
on clean `main` and is not a regression):

```
cd client && node visual/run.mjs 22-intro-replay     # asserts kills=4, cards p0..p4, won=true — READ the tick
cd client && node visual/run.mjs 36-sim-divergence   # asserts identical world hash + equal draws on both hosts
cd client && node visual/run.mjs 37-netsim           # the wire was touched
cd client && node visual/run.mjs 04-combat           # the projectile/enemy steps were touched
cd client && node visual/run.mjs 16-enemy-health-bar # the HUD bar loop was refactored
```

All five must be green **before** the live test.

**`22-intro-replay` does NOT assert the tick count — it only LOGS it.** Its assertions are `kills === 4`,
`cards === ['p0'…'p4']` and `won === true` (`22-intro-replay.mjs:66-68`); the tick appears in the
`intro re-sim:` console line it prints at `:64-65`. So a green exit code is **not** proof the tick held:
read that line and confirm it still says **2474**. If it moved while the assertions passed, the simulation
changed in a way the oracle happens not to check — stop and find the branch that ran when there was no ally.
`36-sim-divergence` does assert its hash and draw count, and prints both hosts' numbers (expected **38**
draws); a mismatch there names the culprit directly.

---

## Live verification (after the suites, before calling it done)

1. `npm run assets:pull` at the repo root if needed, then run the local stack (`/run-local`).
2. **Flag off** — start Level 4 normally, fight a wave: no ally, no green ship, no HUD change. This is the
   "players see nothing" check and it is not optional.
3. **`?ally`** on Level 4: he warps in behind you at the `clear-out` wave, charges the nearest pirate,
   fires while the nose is on, goes quiet through the pass, flies *through* the hull (expected), reverses,
   re-picks. Watch specifically for: a tracer crossing your hull (must never happen), and whether he stays
   in frame (if he wanders, that is `ALLY_TARGET_LEASH`, one number).
4. **Watch one full pass cycle and judge the FEEL of the reversal** (the thing the maintainer will tune):
   he should charge at full thrust, fly past, visibly **slow down as he comes about** (≈2.7 s to turn, ≈3.45 s
   to rebuild speed — a ~6 s cycle swinging him ~50 u out and back), then come at the next one already able
   to fire. Report whether that reads as a heavy, deliberate wingman or as sluggish; whether he leaves the
   frame mid-reversal (especially phone-width); and roughly how many shots he lands per pass. Every lever is
   a named constant — `ALLY_BEHIND_ANGLE`, `ALLY_TURN_EXIT_ANGLE`, `ALLY_SNAP_ANGLE` — so report numbers, do
   not redesign.
5. Let him get shot down to ~20 %: he should finish the current charge, *then* turn and run out of view,
   heal at the holding point, and come back at ≥40 % (~40 s at 1 HP/s). The kill counter must include his
   kills; the credit total must not move for them.
   **Two things to report:** whether pursuers **follow him off screen and out of your fight** — how many
   peel off, for how long, and whether the fight in front of you got easier or emptier — and whether they
   **re-engage him at the holding point** and stop him healing. He outruns every Level-4 enemy, so if the
   second happens the answer is a bigger `ALLY_BREAK_OFF_DIST`, one number. Do not fix it; report it.
6. **THE NUMBER THIS STEP EXISTS FOR — his share of the fight.** Play Level 4 with `?ally&debug` **all the
   way to the win** and report `window.__game.allyKills` against the level's total: *"the ally took N of
   the level's 22 kills"* (Level 4's `enemyTotal` is 8 + 8 + 5 + 1 = 22). This is the input to
   `combat-ally.md` §3's "it must not steal the fight" and to §2.5's warning that a good wingman makes a
   poorer run — nothing else on screen reveals it, by design. Report it even if it looks fine; the tuning
   of `ALLY_*` before Level 5 hangs off this one figure.
7. **`?ally=wave-1&netsim=level-4&debug`** — he appears in the room's snapshots, moves smoothly (he is
   interpolated like everything else), and his bars follow. `window.__game.allies` is populated in both
   modes.
8. Report on both a desktop frame and a phone-width frame whether he reads at a glance — **and judge his
   FIRE as well as his hull.** The green hull separates him from the player's blue and the pirates' orange,
   but his Heavy cannon (weapon id 6) fires `projectileColor: 0xff8a3c` — orange, the same family as
   `Kinetic pirate` (0xff6b6b) and `Rocket pirate` (0xffcc66), where the player's basic kinetic is cyan
   (0x6fe6ff). A stream of orange bolts crossing the frame may read as incoming fire in a top-down game
   where the player aims (§124). **This plan deliberately does not decide it** — surface it as a question
   for the maintainer with a real frame: keep the weapon's own colour (honest: it is what a Heavy cannon
   looks like) or give the ally's shots a friendly tint. Either way it is a follow-up, not a fix to make
   silently. Same for the three-liveries-one-silhouette call (§2c(c)).

---

## Implementer's checklist

- [ ] `world.allies` added + re-exported from `state.js`; `clearAndPlaceRun` empties it.
- [ ] `ally-config.js` / `ally.js` / `step-ally.js` created; every tunable number is a named export.
- [ ] `updateGroups` / `fireMount` take a `side` and a `rocketTarget`; **all three** call sites updated
      (`step-player.js:340`, `step-enemies.js`, `ship-build.js:14`).
- [ ] The reload jitter draws **only** for `side === 'enemy'`.
- [ ] `nearestHostileTarget` returns `world.player` verbatim when `world.allies` is empty — and skips ONLY
      warping allies. **No `retreating` exclusion anywhere in enemy targeting** (vetoed 2026-08-23).
- [ ] Hostile bullets, rocket detonation and rocket blast all test allies — each behind an
      `if (world.allies.length)` / empty-loop guard.
- [ ] `fromAlly` set on ally projectiles; `lastHitBy` stamped at all three damage sites; the reward split
      lives **only** in `stepEnemyDeaths`; `world.kills` still counts every death.
- [ ] `world.allyKills` counts his kills, is zeroed in `startRun`, is exposed on `window.__game`, and is in
      **neither** `worldDigest` nor `worldSummary`.
- [ ] **The ally flies the PLAYER's movement model:** capped at `PLAYER_MAX_SPEED * (a.maxSpeedMul || 1)`
      read from `step-player.js` (never a literal 30, never `a.engine.maxSpeed`), thrust-or-`brakeVel` with
      **no** enemy `DRAG`, **no** `IDLE_DRAG` and **no** `enemyThrustFactor`; `brakeStep` generalised to
      `brakeVel` with the player's motion bit-identical.
- [ ] **The reversal brakes and turns together:** `passArmed` = come about (thrust 0 + steer), cleared at
      `ALLY_TURN_EXIT_ANGLE` or by a SNAP switch — never by a merely-nearer switch.
- [ ] **The escort judges the CLOSING speed** (`(a.vel − player.vel) · unit(player − ally)`), the retreat
      keeps ground speed against its stationary hold point, and `approachThrust` clamps a negative closing
      speed to 0 — with the moving-player test in place.
- [ ] `ally: true` on a phase spawns him from `enterPhase`; no seeded level carries the field.
- [ ] Digest + summary extended; empty `allies` changes no hash.
- [ ] Browser body/bars/minimap/`__game.allies`; **no** edge arrow; ally fire silent; ally kills log nothing.
- [ ] `?ally` wraps **all three** `CATALOG.level =` assignments; the room takes the same flag over the
      handshake; `withAllyAt` never mutates the seed.
- [ ] `cd client && npm test`, `cd server && npm test`, and the five visual scenarios above are green —
      and `22-intro-replay`'s LOGGED tick was read (2474), not just its exit code.
- [ ] The live run reported the ally's kill share (`allyKills` of 22), a judgement on his bolt colour, how
      the brake-turn-accelerate reversal FEELS, and whether pursuers follow him off screen or re-engage him
      while he heals.
- [ ] `docs/plans/combat-ally.md` §3 superseded-note written; SUMMARY sections + `Updated:` bumped;
      CHANGELOG bullet; DECISIONS §134. **No CREDITS change, no `/publish-itch`.**
