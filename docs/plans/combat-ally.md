# An ally who fights with you

> **Status:** requested 2026-08-21; **§2 answered 2026-08-22**, nothing implemented. ROADMAP Phase 4.5 —
> deliberately **before** Phase 5 (multiplayer).
>
> **Read §2 first — it is settled, and its scope grew.** The ally is a Sentinel wingman who arrives in the
> MIDDLE of a fight, in a **NEW Level 5** (the assault on the pirate base Level 4's victory line promises),
> autonomous, unkillable-but-retreating, harmless to and harmed by nobody. So this brief now covers a new
> campaign mission AND the ally in it. Weapons, detailed combat behaviour, the arrival moment and Level 5's
> own content are listed as still-open at the end of §2.
>
> Read first: `docs/SUMMARY.md` (enemy AI, fire groups, the netsim room), `docs/narrative/` before writing
> any player-facing line, `docs/DECISIONS.md` §124 (auto-aim was removed — the player aims, and so does the
> AI) and §127 (one clock; anything new on screen is drawn on it like everything else).

## 1. Why this, and why now

A friendly ship that flies with the player and helps in combat — **with logic of its own, not an enemy bot
pointed the other way.**

It comes before multiplayer for two reasons, and the first is the interesting one.

**It is the dress rehearsal for co-op.** A second combatant in a room that is not the player exercises
nearly everything co-op needs, minus everything that makes co-op hard:

| co-op needs | the ally exercises it | the ally skips |
|---|---|---|
| a ship on the wire the client does not own | yes — spawned, streamed, drawn as a ghost | two humans' input, matchmaking |
| per-ship targeting decided server-side | yes — the ally picks targets in `sim-core` | reconnect, socket draining on deploy |
| a room holding more than one fighter | yes | shared roam, shared level scripts |
| friendly fire, shared loot, shared XP | yes — all become real questions | PvP, spectating |
| more entities per snapshot | yes — the measured cost is in `server-authoritative-sim.md` | — |

If the ally reads well, co-op is mostly plumbing. If it does not, co-op would not have rescued it — two
humans in a badly-legible fight is the same fight, twice as confusing.

**And it is worth having on its own**, in single-player, with no netcode attached. The sim is one module
(`client/src/sim-core/`) and runs identically in the browser and in a room, so an ally written there works
in both without a second implementation.

## 2. Decisions the maintainer owns — ANSWERED 2026-08-22

**Settled. Do not re-open, and do not guess past them.** The answers below came from the maintainer on
2026-08-22; what is still open is listed at the end of this section.

1. **Where does it come from?** → **A wingman the Sentinels assign.** Story, not economy and not
   progression: no price, no shop row, no component. He is given.
2. **One, or several?** → **One**, and not a permanent companion. He belongs to a single mission and
   **arrives in the MIDDLE of the fight**, not at take-off. The player neither chooses him nor opts out —
   "optional" means *not a standing feature*, not *a choice in the hangar*. No new hangar UI.
3. **Does the player command it?** → **Autonomous only, in the first cut.** No orders, no order UI. This is
   deliberate: the thing worth judging first is how it BEHAVES, and an order set would paper over bad
   autonomous logic instead of exposing it. Orders remain cheap to add later — `world.onCommand` already
   carries click-to-fly and would take them unchanged, and the click-to-fly UI already knows how to name a
   target on screen.
4. **Can it die?** → ~~**No. It RETREATS at low health** and comes back in the next mission. The player sees a
   consequence (he is suddenly alone) without an irreversible loss, and we never create the "restart the
   level because the bot died stupidly" moment.~~

   > **REVERSED (2026-08-23), by the maintainer, after flying it.** **He DIES**, is gone for the rest of the
   > mission, and returns in the next one. The immortality was watched in play on Level 4 and read as
   > wrong: the wingman sat at a sliver of hull soaking three boss rockets and simply would not leave, which
   > is neither a retreat nor a fight — it is a prop. The retreat SURVIVES and is now the thing standing
   > between low hull and a dead wingman (it also had a real sampling bug, fixed in the same change: the
   > break-off condition was tested on one tick per pass while the shield's all-or-nothing 10 s refill made
   > it oscillate, so it almost always missed — it is latched every tick now and acted on at the next pass).
   > He is worth **nothing** on the way out: no credits, no XP, no loot, and `world.kills` does not move, so
   > phase thresholds, `enemyTotal`, `isLastKillDrop` and the `cleared` payload cannot notice. His death is
   > announced by the **explosion FX alone** (`allyDown`) — no banner, no log line, no new string, because
   > player-facing copy is still out of scope (§2).
   >
   > **Recorded, not solved:** in this first cut the player has **no orders** (§2.3), so they cannot defend
   > him, screen for him or call him off. His death will therefore read as bad luck rather than as the
   > player's mistake. The maintainer chose this knowing it; it is the argument for orders in a later cut,
   > not a defect to file.
5. **Does it take?** → **Credits and XP: NO. Phase progress and the HUD counter: YES.** See the box below —
   this one has a trap in it.
6. **Friendly fire.** → **No damage in either direction**, but it still **holds the line of fire**: it must
   not shoot through the player's hull, because a tracer crossing your own ship reads as a bug even when it
   deals nothing. Sound follows from "no damage": his fire is not a threat cue.
7. **Every mission, or some?** → **Exactly one campaign mission**, see §2.9.
8. **Single-player from the start, or only in a room?** → single-player first (the brief's own
   recommendation; the sim is shared, so the room gets it for free and feel is far easier to judge without a
   socket in the way).

### 2.5 has a trap — `world.kills` is load-bearing, and "he does not take kills" cannot mean "do not count them"

**Verified in the code, 2026-08-22.** `world.kills` is not a scoreboard. It drives:

- **phase advance** — `level-runner.js:261-262`, `world.kills >= c.kills`. Nearly every level is built on it:
  `catalog_seed.js:493` `{kills:3}`, `:522` `{kills:6}`, `:531` `{kills:12}`, `:563`, `:572`, `:622`, `:632`,
  `:687` `{kills:8}`, `:697` `{kills:16}`; side missions too (`missions.js:20,24`).
- the HUD counter `${G.kills}/${G.enemyTotal}` (`hud.js:51`),
- the "10/5 enemies left" banners (`step-enemies.js:133`),
- `isLastKillDrop` — which kill drops the level's reward model,
- the intro cutscene's nth-kill pauses (`main.js:1804`),
- the `cleared` event payload a room banks (`level-runner.js:152`).

So if an ally kill did not increment `world.kills`, a level with `advanceWhen: {kills:8}` whose ally took
three would **never advance** — a hung mission and a HUD frozen at "17/20" over an empty sector.

**Therefore the decision is split exactly here:** the ally's kills increment `world.kills` like any other
death (progress and HUD stay honest), and only `world.earned` / `world.earnedXp` skip the reward
(`step-enemies.js:140-141`). What the ally kills does not pay.

**A consequence to watch in play, flagged at decision time:** the better the wingman shoots, the poorer the
run. Tuned badly, the feature charges the player for having help. Since he appears in ONE mission and only
mid-fight, the exposure is small — but if he ever becomes a standing companion, revisit this before he does.

### 2.9 Where it lands — a NEW campaign mission after Level 4

The ally does not go into an existing level. He arrives mid-fight in a **new Level 5**, which Level 4's own
victory line already sets up: *"the pirate base just lit up our long-range scan — they're dug in deep.
Rearm and regroup, Sentinel; next, we take it down."* So this brief now covers **two things**: a new
campaign mission, and the ally inside it. Sizing, planning and review must treat them as such.

The campaign is `level-0`..`level-4` today (`catalog_seed.js:478-657`), all five with `map: 'home-system'`.
`advanceLevel` picks `MIN(id) WHERE id > current_progress` (`db.js:600`), so **adding a seed row with id 5
gives the new mission to players who already finished the campaign, with no migration** — they simply
advance into it. Note the stale-looking `level-5` references in older DECISIONS entries and the comment at
`catalog_seed.js:671`: those predate the 0-based renumber (§102) and name a *progress gate*, not this level.
`SIDE_MISSIONS_MIN_LEVEL` is `'level-4'` (`db.js:28`) and is unaffected.

### Still open — the maintainer said these come later

- ~~The ally's weapons~~ — **settled, see §2d** (Heavy cannon id 6 + Rocket id 3, Base shield, no grab).
- **The base pirates' and the boss's weapons** — and with them the standoff distance, which §2c(a) shows is
  a framing constraint, not a free choice.
- ~~Its combat behaviour in detail~~ — **settled, see §2d**: the firing pass, the two re-target angles, the
  retreat thresholds and station-keeping. §3 remains the reasoning behind why it is shaped this way.
- ~~**How he arrives**~~ — **settled and BUILT (2026-08-23):** a **phase of the level descriptor carries
  `ally: true`**, and entering that phase is when he joins (`sim-core/level-runner.js enterPhase` →
  `sim-core/ally.js spawnAlly`). Level 5 sets one field and nothing else. No seeded level carries it today;
  the `?ally` dev flag injects it into whatever level the tab is flying, and a room takes the same phase name
  over the handshake.
- **The exact arrival MOMENT for Level 5** is still the maintainer's call. Level 4's shape shows the natural
  seams and Level 5 will have its own: early enough to read his behaviour, or at the boss as the cavalry.
- **Level 5 itself** — centre/anchor, `xpReward`, `lastKillDrop`, briefing and victory copy (write from
  `docs/narrative/`, never ad-hoc). The enemy composition mirrors Level 4 and there IS a boss (§2c).
- **The BOSS's model, and therefore CREDITS.md** — §2c says the boss gets a different model. If it is not
  an existing catalog ship, that is a new asset and a new credits row; ask before it lands.
- **Its set-piece, and therefore CREDITS.md.** A pirate base is new scenery. `buildSetPiece`
  (`world.js:1133`) knows `research-station`, `asteroid-field`, `freighter`, `base-station`,
  `space-factory`. Reusing or re-tinting one costs no asset; a new model means a new
  `client/assets/CREDITS.md` row and must be asked about before it lands.

### What is already free, and does not need deciding

**The ally's ship costs no asset and no CREDITS.md change.** There is exactly one flyable ship in the
catalog — `Basic player ship` (`catalog_seed.js:321`, `color: 0x4d8bff`, `player_combat.9188c820.glb`) — so
"the same ship as ours" is unambiguous, and `applyShipModel` (`ship-factory.js:104`) tints a .glb's
materials with the ship's `color` by default. A different livery is **one number in the catalog against the
same model file**.

## 2c. Level 5 as the maintainer described it (2026-08-22)

**The mission.** We come out at the pirate base and the pirates meet us there. Composition mirrors Level 4;
the enemies' and the boss's WEAPONS are still to be discussed.

**The base pirates.** The same ship as ours in a different livery, a little faster, more HP. **They stop
closing at their firing range** rather than pressing all the way in, and they **close on the NEAREST
opponent — the player or the ally.** A heavy closes to the range of its *shortest-ranged* weapon (its
kinetic), so every gun it carries can reach.

**The boss** gets a different model and different equipment.

**The ally** appears just before the LAST WAVE preceding the boss.

**Shipping.** One batch — the level does not exist without the ally. But for testing, drop the ally into
Level 4 locally first, before the level is built. (Endorsed: visual and feel-driven features churn the
pipeline when the plan is polished before anyone has flown it.)

### What that costs — three things measured in the code, 2026-08-22

**(a) Standoff already exists, but the proposed distances leave the frame.** `enemyThrustFactor(dist, near
= 14, far = 22)` (`steering.js:43`) already closes above 22, coasts between 14 and 22 and backs off below
14. So "hold at weapon range" is not a new mechanic, it is a new NUMBER — but the numbers are big: `GUN` is
45, `GUN_LONG` 90, `ROCKET` 80 (`catalog_seed.js:298-300`). With the camera at `(0, 110, 26)` and a 55° FOV
(`engine.js:62-63`), the visible half-extent on the plane at zoom 1 is roughly **±57 units vertically, ±102
horizontally on 16:9 — and only about ±32 horizontally on a phone in portrait**. A pirate holding station
at 45 is off-frame to the side on a phone; one holding at 90 is off-frame everywhere. **Being shot from
empty space is the failure mode**, so the standoff distance has to be clamped to the frame (portrait is the
binding case), or these pirates need deliberately short-ranged weapons. This is the first input to "the
enemies' and the boss's weapons are still to be discussed".

**(b) There is no third combatant in the simulation today, and this is the bulk of the work.**
`step-projectiles.js` is binary end to end: a bullet either scans `world.enemies` (`:40`) or strikes
`world.player` (`:55`, via `resolveHostileBulletHit(world.player, …)`), and rockets branch on `r.fromPlayer`
for both homing and impact (`:105`, `:137`, `:155-159`). `stepEnemyAI` reads `world.player` directly
(`step-enemies.js:78`) and cuts every engine when the player dies (`:71`). An ally that can shoot and be
shot needs a genuine third party in targeting, collision and homing. That is precisely the co-op rehearsal
the ROADMAP wanted from this phase — and it means "enemies target the nearest of player-or-ally" is not a
small AI tweak, it is the same change seen from the other side.

**(c) Three liveries of ONE silhouette.** The player, the ally and the base pirates would all fly
`player_combat.9188c820.glb`. No asset cost — and the whole burden of telling friend from foe falls on
colour, in a top-down game where the player has to aim (auto-aim was removed, §124). Flagged as a design
call rather than an objection: pirates in captured Sentinel corvettes is a strong story beat. But it must
be judged on a real frame, at real zoom, on a phone as well as a desktop — a visual change can pass every
test and ship illegible.

## 2d. The ally's loadout and behaviour (maintainer, 2026-08-22)

### Loadout — stated, and what it derives to

Heavy armour, ordinary engine and thrusters, an ordinary repair drone, a heavy cannon, an ordinary rocket,
**no skills**.

| slot | catalog row | weight |
|---|---|---|
| hull | Heavy hull (id 13, 200 HP) | 50 |
| engine | Basic engine (id 5, power 15, `maxSpeed: 0` = uncapped) | 10 |
| thruster | Basic thrusters (id 8, power 2.0) | 4 |
| repair | Repair drone (id 12) | 4 |
| gun | **Heavy cannon (id 6)** — power 35, `fireCooldown` 0.6 | 10 |
| rocket | Rocket (homing) (id 3) | 8 |
| shield | Base shield (id 31) — capacity 20, `rechargeSec` 10 | **0** |
| grab | *none — by design* | — |

**Derived through `deriveDrive` (`components.js:29`):** mass **86** against `REFERENCE_MASS` 50 →
`massFactor` **0.58**. Acceleration **8.7** (the player's is 10), turn rate **1.16 rad/s** (the player's is
2.0) — a 180° reversal takes **2.7 s**. ~~With `DRAG = 1.8` (`step-enemies.js:30`) terminal speed is about
**4.8 u/s**.~~

> **CORRECTED (2026-08-23), and this one was WRONG rather than merely imprecise.** The struck sentence
> applied the **ENEMY** movement model. The ally flies the **player's**: `PLAYER_MAX_SPEED` is a **flat
> 30 u/s** (`sim-core/step-player.js:29`, *"Flat top speed for the PLAYER only… Enemies use their per-engine
> `maxSpeed` instead"*), there is no per-frame drag while thrusting (`IDLE_DRAG` runs only when no control is
> held), and slowing down is the kinematic `brakeVel`. **Thrust decides ACCELERATION; top speed is a property
> of the SHIP, not of the engine** (maintainer, 2026-08-23). So the real numbers are: acceleration **8.7**
> (0→30 u/s in **3.45 s**), turn **1.16 rad/s** (180° in **2.71 s**), top speed **30 u/s** — the same as the
> player's. `step-ally.js` reads the cap straight from `step-player.js` and never restates it.
>
> The reversal is therefore **brake → turn → re-accelerate**, not a constant-speed arc: braking (3.45 s)
> outlasts the 180° turn (2.71 s), so he comes about nearly stationary, carrying ≈6.4 u/s of old-direction
> drift, and rebuilds speed into the next pass. A whole pass cycle is ~6 s and swings him ~50 u out and back.

*Confirmed as id 6 (Heavy cannon), not id 7.*

**The shield is free, and the missing grab is load-bearing.** Base shield id 31 weighs **0**
(`catalog_seed.js:150`), so adding it changes neither the mass nor a single derived number above. And there
is deliberately **no grab**: he does not react to loot at all. That makes §2.5's "takes nothing" a property
of the ship rather than a special case in the code — there is no pickup path to suppress.

### Behaviour — a firing pass, then a reversal

Find the nearest enemy, accelerate at it while firing, fly past, begin to turn. After the pass, if a
different enemy is now nearer, switch to it. If during the turn another enemy comes round into a position he
could fire on immediately, switch to that one and accelerate at it. **The search for a new target arms the
moment the current one is behind him** — the angles are to be tuned.

### What the numbers say about it — measured 2026-08-22

- **The firing pulse is free.** A group only fires while `|diff| < ai.aimTol` (0.25 rad ≈ 14°,
  `catalog_seed.js:298`; the rule is in `step-enemies.js:100`). So he fires while the nose is on, falls
  silent through the pass, and opens up again out of the turn. Nothing has to be written to make that
  rhythm — it falls out of the existing fire rule.
- ~~**The pass bottoms out at about 4 units and he flies THROUGH the enemy — and that is INTENDED.** Turn
  radius = speed / turn rate = 4.8 / 1.16 ≈ **4.2 u**~~ — **CORRECTED (2026-08-23):** that figure came from
  the wrong 4.8 u/s above. Turn radius = speed / turn rate = 30 / 1.16 ≈ **26 u** at full speed (the
  player's is 15 u), so the nose slides off the target far earlier and **flying through a hull will now
  rarely be seen at all**. *The ruling it supported is unchanged and still stands:* hulls are `broadR` ≈ 2.0
  each and **there is no ship-to-ship collision anywhere in `sim-core`**, so two hulls may still visibly
  overlap on the pass. Steering at a
  lateral offset to make him cut down the flank instead was proposed and **declined by the maintainer,
  2026-08-22: passing through ships is by design, not a bug.** Do not "fix" it in review, and do not add
  ship-to-ship collision to stop it.
- **Starting values for the two angles.** "Target is behind me", arming the re-search: `|diff| > 120°`.
  "Could fire on it immediately", allowing the mid-turn switch: reuse `aimTol` 0.25 rad — the same number
  that already gates firing, so the rule reads identically in the code and on screen. Both belong in named
  constants for live tuning.
- **HIS NOSE IS AIMED FOR THE GUN, NOT AT THE ENEMY (added 2026-08-23).** Kinetic bullets inherit the
  shooter's velocity (`spawn.js makeBullet`; rockets deliberately do not, DECISIONS §70), so a ship drifting
  across its own line of fire misses even a **stationary** target. That is the worst possible defect for
  *this* ship, whose entire manoeuvre is a firing pass with heavy lateral drift. `aimWithDrift` picks the
  nose so the RESULTING bullet travels at the target. One nose, two ballistics: it is optimised for the GUN
  (0.6 s cooldown against the rocket's 5 s), so the two weapons fly down different lines — and therefore
  **every gate, the firing rule above AND §2.6's player-safety rule, is asked per fire group of the path
  that group's projectile really takes** (`fwd × speed + vel` for a bullet; the bare nose for a rocket,
  which inherits nothing and homes afterwards). Corrects the SHOOTER's drift only; leading a moving target
  is a separate job. The bearing is taken from the hull centre, not the muzzle — the same few degrees of
  parallax every other aim in the game already carries.
  **Enemies have the same flaw and are deliberately untouched** — fixing it would raise the difficulty of
  all five levels at once and move every recorded replay.
- **Fire discipline has a ready-made primitive.** §2.6 requires he never shoot through the player's hull.
  `inForwardSector(fwd, toTarget, halfAngle)` (`steering.js:49`) is exactly that test; run it against the
  player and hold fire when it passes and the player is nearer than the target.

### The retreat, and station-keeping — settled 2026-08-22

~~**Low health never interrupts a charge.** He commits to the run he is on; the decision to leave is taken
**after the pass**, never in the middle of one. So the retreat can only ever look like a wingman breaking
off, not like one flinching.~~

> **RETIRED 2026-08-23 — this rule was killing him.** It was written while the ally **could not die**, when
> interrupting a charge bought nothing: the retreat was only ever about finding time to heal. The moment he
> became mortal (§2.4 above), the same words meant *"die mid-charge"*.
>
> **The measurement that settled it.** Level 4's boss (`catalog_seed.js`) mounts 2× weapon 10 (power 10,
> `fireCooldown` 1.0) and 3× weapon 4 (power 20, `fireCooldown` 4) — about **35 damage per second** on
> target. Against a 200 HP hull the old 20 % threshold is 40 HP, so **crossing it to dead takes about one
> second**, while a full pass cycle is ~6 s (2.71 s reversal + 3.45 s re-acceleration). A decision taken
> once per pass therefore landed inside the fatal window roughly **one time in six**. The maintainer flew it
> and watched him press on and die.
>
> **What replaces it:** break off at **≤ 25 %** hull (was 20 %) with the shield down, **evaluated as the
> damage lands and acted on at once** — mid-charge or not. Rejoin at **≥ 40 %**, unchanged. He may still
> die; that is deliberate and is not to be softened. The `wantsRetreat` latch that used to bridge
> "condition true" → "pass armed" is gone with the gap it bridged.
>
> **The cost, accepted:** he now turns away with his nose still on the enemy, so he spends the first ~2.7 s
> of the break-off coming about while a pursuer closes — the gap dips to near contact before it opens. That
> is the price of leaving immediately rather than at the end of the pass, and it is the better trade.

**WHERE he goes, corrected 2026-08-23.** *Away from the nearest ENEMY* — `ALLY_BREAK_OFF_DIST = 120 u`,
recomputed each tick — and he holds there while the drone works. The first implementation measured the
distance from the **arena centre** (70 u) and did not work at all: enemies spawn at 70..130 from that same
centre, so the holding point was the inner edge of their spawn ring, and since he charges enemies out there
his own centre-distance was normally already past it — the remaining distance went negative, thrust went to
zero, and the "retreat" was a dead stop in the middle of the fight. **A retreat distance is only meaningful
relative to the thing he is retreating FROM.** With no enemy at all there is nothing to break from, so he
escorts and heals instead. See DECISIONS §134.

**And the break-off decision is TAKEN THE INSTANT IT IS TRUE.** The pair of conditions below is evaluated
every tick and acted on at once — no latch, no pass gate, no timed cadence. (Two earlier shapes both failed:
sampling the conditions once per pass tested them at one arbitrary point of the shield's ~10 s break/refill
cycle and almost always missed; latching the intent and acting on it at the next pass fixed *that* but still
waited up to ~6 s, which at 35 dmg/s is most of a life. See the retired rule above.)

**Two thresholds, and they are deliberately not the same number:**

| | hull | shield |
|---|---|---|
| breaks off to heal | ≤ **25 %** (50 of 200 HP) — *was 20 %, raised 2026-08-23* | down (0) |
| rejoins the fight | ≥ **40 %** (80 HP) | recharged (full) |

**Why two.** The repair drone (id 12) heals **1 HP/s** and only to `maxFraction` 0.8 — 160 of 200 HP — so
healing to the drone's ceiling is a 100–120 s round trip, and he arrives one wave before the boss. Waiting
for a full repair would mean the player meets the wingman, watches him leave, and never sees him again in
the mission the whole beat exists for. Returning at 40 % makes it **40 s** (40 → 80 HP at 1 HP/s) and he is
back for the boss — bloodied, and plausibly leaving a second time. The shield condition costs nothing:
`shieldRecharge` (`components.js:107`) refills all-or-nothing 10 s after breaking and only from zero, so it
is full long before the hull reaches 80. **The hull is the binding constraint; the shield clause is a
legibility gate, not a delay.** *(2026-08-23: under the damage-triggered check the shield clause is nearly
free on the BREAK-OFF side too — damage routes through the shield before the hull (§76), so at the instant
any hull damage lands the shield is already down by construction. It is kept because the maintainer
specified "≤25 % with the shield down", and it still says something true: a wingman whose shield came back
up is no longer taking hull damage.)*

**Between waves, with no enemy anywhere, he closes to about 10 u of the player** and holds there. That is
§3's "it positions relative to the PLAYER" in its simplest form, and it means a wingman with nothing to do
reads as escorting rather than as drifting scenery.

## 2b. The original questions, for reference

1. **Where does it come from?** A wingman the Sentinels assign (story), a mercenary hired with credits per
   mission (economy), a drone unlocked as a component (progression), or something the player builds?
2. **One, or several?** One companion, or a wing the player composes? Does the player choose which?
3. **Does the player command it?** Autonomous only, or orders — *attack that*, *hold*, *on me*? The netsim
   command channel (`world.onCommand`, already carrying click-to-fly) would take orders unchanged, and the
   click-to-fly UI already knows how to name a target on screen.
4. **Can it die?** For the rest of the mission, permanently, or does it retreat at low health? Does losing
   it cost credits, progress, or a story beat?
5. **Does it take?** Loot crates, XP, kill credit. Every "yes" changes the reward curve; every "no" needs a
   reason the player can see.
6. **Friendly fire.** Can its shots hit you, and yours hit it? (Today enemy fire is silent and the player's
   is not — DECISIONS on audio — so an ally's fire needs its own answer for sound as well as damage.)
7. **Every mission, or some?** Campaign only, side missions too, roam?
8. **Does it exist in single-player from the start**, or only inside a room? (Recommendation: single-player
   first — the sim is shared, and it is far easier to judge feel without a socket in the way.)

## 3. What "logic of its own" has to mean

The design content of this feature is here, and it is why "reuse `stepEnemyAI`" is the wrong answer.

`stepEnemyAI` (`client/src/sim-core/step-enemies.js:39`) is: fly at the player, fire when in range and
roughly aimed. That is correct for a threat. An ally has a different job — **be useful and be legible** —
and every difference below follows from one of those two.

- **It positions relative to the PLAYER, not to its target.** A wingman holds a station off your flank and
  fights from there; a bot that beelines at whatever it is shooting reads as a stranger who happens to be
  nearby. This is also what makes it feel like an ally at all, before it fires a shot.
- ~~**It targets what threatens YOU**, not what is nearest to it: the enemy shooting at the player, or the one
  closest to the player. A companion that wanders off to the far side of the arena is not helping, however
  many kills it gets.~~

  > **SUPERSEDED (2026-08-23).** This bullet is the brief's own prose, written before the maintainer
  > specified the behaviour. **§2d is authoritative: the ally picks the enemy nearest to HIMSELF**, and that
  > is what shipped in `sim-core/step-ally.js`. The maintainer's own spec beats the brief's earlier
  > reasoning. The player-relative idea survives only as `ALLY_TARGET_LEASH` (`sim-core/ally-config.js`), a
  > named constant **defaulting to `Infinity`** — set it finite and he will only engage enemies within that
  > distance of the player. Do not re-open this from §3's wording.
- **It must not steal the fight.** If it out-kills the player, the player is a spectator; if it does
  nothing, it is decoration. This is a tuning problem with a real answer — cap its damage share, or give it
  a role that is not damage (drawing fire, finishing wounded ships, screening the player while shields
  recharge).
- **Fire discipline.** It must not shoot through the player, both because of friendly fire and because a
  tracer crossing your own hull reads as a bug. It holds fire when the player is on the line — which is a
  check enemies have never needed.
- **It must be legible at a glance.** The player has to be able to tell what it is doing and why, from the
  screen alone: what it is attacking, whether it is hurt, whether it is coming when called. An ally whose
  behaviour is opaque reads as broken even when it is working. (Memory of this project: a new element has to
  read correctly on *every* player-facing surface, not merely simulate correctly.)
- **It reacts to the player's state, not only the enemy's.** Player at low health → screen and draw fire.
  Player winning → stay out of the way. This is the behaviour no enemy has, and it is where the feature
  either earns its place or does not.

**Where it lives.** `sim-core` — a new `step-ally.js` beside `step-enemies.js`, drawn on the same clock as
everything else, spawned through the host like any other entity (§127). It must not draw from the seeded
gameplay RNG in a way that reorders existing draws (DECISIONS §73: new draws go at the END, never inserted),
or every recorded trace and the intro replay break.

## 4. Open technical questions

- **Does the ally count toward `enemyTotal` / level completion?** No, but kills it makes must count
  somewhere or the "kills === total" drop trigger breaks. (This project has broken that trigger before by
  changing what feeds it — check every consumer.)
- **Collision.** Can the player ram it? Do enemy rockets home on it? `findTargetInSector` currently seeks
  `world.player` for enemies; an ally is a second candidate and that is a balance change, not a detail.
- **The wire.** A new entity kind in the snapshot, its static half in `staticOf`, its rows in the column
  list, and a `kind` the client's `spawnGhost` knows how to build. Straightforward, but it is where the
  co-op rehearsal actually happens.
- **The intro replay guard.** Any change to sim ordering or RNG draws needs
  `node visual/run.mjs 22-intro-replay` green (4 kills, p0..p4, win).

## 5. Not in this brief

Multiplayer, matchmaking, a second human, PvP. The point of doing this first is that none of them are here.
