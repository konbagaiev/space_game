# The enemy charged beam — arming a pirate, and the telegraph that makes it fair

> **Executable plan.** Source briefs: `docs/plans/charge-beam-weapon.md` (§0a the corridor rule, §0a-bis the
> player's numbers, §0a-ter the scope cut this work RESUMES, §0e the look + its testing rule) and
> `docs/plans/2026-08-25-1056-charge-beam-weapon.md` §2d (the deferral and the wire shape it names).
> The gate this work exists to pass is **`docs/DECISIONS.md` §135**, quoted in §1 below.
>
> This plan is self-contained: everything it needs decided is decided here, with the maintainer's answers
> inline. The handful of items that want his eye are gathered in **§2h** and are **not blockers** —
> implement the stated value and raise them at the review gate.
>
> Anchors are line numbers **in this worktree at plan time**. If a line has moved, match the quoted code.

---

## 1. Goal

Arm a pirate with a **weakened Charged beam**, and prove the player can see it coming — including in a
**server-run netsim room**, where the shooter is a remote ghost nobody simulates locally.

Three pieces, and the first two are the gate:

- **A. The hostile sight.** `client/src/beam-fx.js` draws the corridor for `world.player` only today. A
  charging hostile gets the *same three lines*, from the same `sim-core/beam.js` geometry, in a hostile hue,
  **only while it is charging** — pooled, so several can charge at once.
- **B. The wire.** `beamCharge` gains the **shooter** as an entity reference, so a client can draw a
  *remote* shooter's corridor. Still two events per shot; no per-tick charge fraction, no snapshot column,
  no digest field.
- **C. A ship that carries it, and a way to fly against it.** A new beam-only enemy — the **pirate
  lancer** — plus a `?lancer` dev flag that injects it into a level's spawn pool, client-side **and** in a
  room, exactly the way `?ally` does.

DECISIONS §135 records the gate in these words, and it is non-negotiable:

> **An enemy beam is a 1.0 s unanswerable hit unless its telegraph is on screen. Before any enemy is ever
> armed with one, two things must exist first: (1) the hostile-sight rendering — the three lines drawn from
> a charging hostile hull, in a hostile colour, for the duration of its charge — and (2) the wire entity
> reference on `beamCharge` that lets a client draw a REMOTE shooter's corridor.** An aiming line the player
> never sees is not a warning; it is an unfair attack.

**User-visible effect.** Fly `?lancer` and orange pirates warp in that do not shoot at you — they *aim* at
you. Three red-orange lines snap out of a lancer's nose and brighten over a full second, and then a
cyan-white bolt runs down the middle of them for 45 damage. You break it by moving off the line. This is the
first enemy in the game whose attack you can see before it exists, and it is what Level 5 is built on.

**What does NOT change.** The player's Charged beam (weapon id 12) is untouched — same power 80, same range
100, same green sight, same price and gate. No shipped level's spawn pool changes, so no recorded trace and
no `enemyTotal` moves.

---

## 2. Decisions

### 2a. The weakened numbers — a NEW enemy-only weapon row. SETTLED, do not re-balance.

> **AMENDED 2026-08-25, AFTER THE MAINTAINER FLEW THE BUILD. Two numbers below are superseded; everything
> else in this section stands.**
> - **`fireCooldown` 0.5 → 2.0** ("1 second charge, 2 seconds cooldown"). The cycle is **3.0 s**, so
>   sustained DPS is **15**, not 30 — *below* the pirate machine gun's 16.7 rather than the highest in the
>   game.
> - **Turn rate 148°/s → 50°/s**, via a new thruster row (component **32**, `Lancer thrusters`, power
>   0.541, weight 3 so mass stays 31 and acceleration is unchanged at 30.6 — the row was later renamed
>   `Pirate fighter thruster` when the pirate gunner and advanced rocket pirate were brought to the same
>   50°/s, making it a TIER rather than the lancer's alone; the intro's two ships are excluded).
>
> **The consequence is that the "PRACTICALLY NEVER MISSES" analysis below is now HISTORY, not current
> behaviour.** It was correct when measured, it was accepted for the first pass, and the maintainer then
> flew it and chose both levers. At 50°/s the lancer turns slower than a player's ~96°/s bearing sweep at
> the AI's standoff, so **the corridor can now be escaped during the charge** — which is what the corridor
> design always assumed. `power` 45 and `maxRange` 67 are unchanged. Read the rest of this section as the
> reasoning that produced the first pass; DECISIONS §135 carries the current state.

| stat | lancer (id **13**) | the player's (id 12) | why |
|---|---|---|---|
| `power` | **45** | 80 | maintainer, 2026-08-25 |
| `maxRange` | **67** | 100 | maintainer: "two thirds of the player's" |
| `chargeTime` | **1.0** | 1.0 | **unchanged on purpose** — telegraph length is not the lever |
| `fireCooldown` | **0.5** | 0.5 | unchanged; he named only damage and range |
| `corridorDeg` | **2** | 2 | unchanged; same reason |
| `weight` | **12** | 12 | enemy mass matters only through `deriveDrive` |
| `class` | `'beam'` | `'beam'` | reuses the existing `SOUND_MAP` charge+fire rows |
| `projectileColor` | `0xbfefff` | `0xbfefff` | the discharge bolt is drawn whoever fired it |
| `price` | **250** | 5500 | enemy gear pricing (resale only) |
| `buyable` | **false** | — | never in the shop |
| `minLevel` | **none** | `FACTORY_GATE` | a hidden row needs no gate |

**This is exactly what "every behaviour number lives in the weapon row so two ships can carry
differently-tuned beams" (§135) was built for.** There is no shared tuning object; `sim-core/beam.js` reads
all five off `g.mounts[…].weapon` every time.

~~**The cycle is 1.5 s, so the lancer sustains 30 DPS — the highest sustained enemy DPS in the game**~~
**SUPERSEDED (see the banner above): the cycle is 3.0 s and sustained DPS is 15**, below the pirate MG's
16.7 and above the advanced pirate cannon's 10. **45 is still 2.25× the biggest single hit that exists**
(the 20-damage pirate rocket, which is dodgeable *and* shootable-down, while a hitscan beam is neither) —
the single hit was never the thing that changed.

**REACHABILITY AS MEASURED FOR THE FIRST PASS — HISTORY, superseded by the 50°/s retune above.** (At 148°/s
the corridor held; at 50°/s it does not. Kept because the arithmetic is the reason the retune happened.)
An earlier draft of this plan claimed a moving player escapes most charges, on a made-up ~20°/s lancer turn
rate. **That was wrong by about 7× and is retracted here rather than quietly dropped** — it must not reach
DECISIONS or SUMMARY, because a false reachability story recorded as rationale is worse than none.

The real arithmetic (`shipMass`/`deriveDrive`, `client/src/sim-core/components.js:16-36`,
`REFERENCE_MASS = 50`): the lancer's mass is 10 (Pirate hull 22) + 6 (Pirate engine 23) + 3 (Scout thrusters
9) + **12 (the beam itself)** = **31**, so `massFactor` = 50/31 = 1.61 and

- **`turnRate` = 1.6 × 1.61 = 2.58 rad/s ≈ 148°/s**;
- `acceleration` = 19 × 50/31 = **30.6** (the pirate gunner, mass 25, gets 3.20 rad/s / 183°/s and 38.0).

`PLAYER_MAX_SPEED = 30` (`client/src/sim-core/step-player.js:29`), so at the AI's 14–22 u standoff
(`enemyThrustFactor(dist, near = 14, far = 22)`, `client/src/sim-core/steering.js:43`) the player's
**maximum** bearing sweep is 30/18 = 1.67 rad/s ≈ 96°/s — **the lancer out-turns it by half again.**
`steerToward` clamps to the target rather than overshooting (`client/src/sim-core/steering.js:21-24`) and
`ef` is re-derived from the freshly steered heading in the same tick (`step-enemies.js:92`), so the residual
at release is one tick of target motion: 0.5 u at 18 u = **~1.6°**, inside the ±2° corridor.

**So state the consequence plainly, and record THIS in DECISIONS:** against a player who keeps flying, a
lancer's corridor holds through the charge and **45 lands roughly every 1.5 s**. Three hits clear a default
100 HP hull + 20 shield in about **four seconds**, and `?lancer` puts **two** lancers on screen. The
counter-play is the telegraph itself — break line of fire, or kill it inside its 1.0 s window — not
out-turning it.

**The one real derived cost of `weight: 12` on the carrier:** mass 31 against the pirate gunner's 25, so the
lancer is **slower to turn and slower to accelerate than the ship whose model it borrows** (2.58 vs 3.20
rad/s, 30.6 vs 38.0). That is the beam's mass tax landing on an enemy exactly as it lands on the player, and
it is left as is.

**THE LANCER PRACTICALLY NEVER MISSES, AND THAT IS AN ACCEPTED PROPERTY OF THIS FIRST PASS — NOT AN
OVERSIGHT.** The maintainer was shown the measurement above at the review gate on **2026-08-25** — the
corridor holds through the charge, 45 lands about every 1.5 s, two lancers clear a default player in roughly
four seconds — and decided, verbatim (translated): ***"For now we leave everything as it is, let them not
miss."*** So `power` 45, `maxRange` 67 and the components that give mass 31 all stand exactly as written.
**Do not retune them, do not lighten the carrier, and do not soften this paragraph.** He also asked for the
turn rate to be lowered **later**, as a follow-up rather than part of this change — that goes to
`docs/ROADMAP.md` with its arithmetic and its lever (§6), so a future reader can act on it without
re-deriving anything.

### 2b. The carrier: a NEW beam-only ship. Do NOT swap a weapon id onto an existing enemy.

A new `SHIPS` row, **`pirate lancer`**, whose ONLY weapon is the beam, in its **own single-mount group**.

**Why a new ship rather than re-arming a pirate.** `isBeamGroup` uses `some`
(`client/src/sim-core/beam.js:60`), so a group holding a beam takes the beam path and **every other mount in
it goes silent**. **Four enemy ships carry multi-mount groups today, six groups between them** — `first
pirate boss/gun`, `first pirate boss/rocket`, `second pirate boss/gun`, `second pirate boss/rocket`, `pirate
mini boss/rocket`, `advanced medium pirate/rocket`; the inventory is asserted in
`server/src/catalog_beam.test.js:108` — and `equipItem` replaces only the FIRST mount of a group
(`server/src/db.js:1025-1027`). §135 records this trap; the new row sidesteps it by construction.

**Because no existing ship row changes, both determinism gates hold by construction — verify that, do not
assume it** (§10).

- **Model: reuse `assets/ships/enemy_1_orange_combat.f3b006ba.glb`** — the pirate gunner's hull.
  **No new asset ⇒ `client/assets/CREDITS.md` needs no change ⇒ no itch re-publish is required** (nothing's
  content hash moves). **Copy the pirate gunner's entire `model: { … }` block verbatim** from
  `server/src/catalog_seed.js:421` — same `.glb`, therefore the same baked `muzzle`/`exhaust`/`hitBoxes`/
  `broadR`/`lift`/`yaw`/`scale`. **Do NOT re-run `npm run assets:muzzle` or `assets:hitboxes`.**
  `server/src/catalog_muzzle.test.js` will check the block is there.
- **Consequence the maintainer accepted knowingly (2026-08-25): a lancer and a pirate gunner are visually
  identical.** The red telegraph is the identification. Do not add a runtime re-tint.
- **Components `{ hull: 22, engine: 23, thruster: 9 }`** — Pirate hull (36 durability → 12 shield / 24 hull
  after `enemyShieldSplit`), Pirate engine, Scout thrusters: the pirate gunner's own kit, which is what the
  model reads as.
- **`role: 'pirate_lancer'`, `class: 'fighter'`, `color: MARKER.small`** (orange; the marker convention is by
  size tier, `catalog_seed.js:358-363`).
- **`reward: 100, xp: 100`** — above the gunner's 50, below the mini boss's 125: it is the most dangerous
  small ship in the game. Review-gate item (§2h).
- **`groups: { gun: BEAM }`, `mounts: [{ weapon: 13, group: 'gun', offset: 0, delay: 0 }]`.** The group is
  named `gun` because that is the primary-weapon vocabulary the whole codebase shares
  (`GROUP_WEAPON_TYPE.gun = ['bullet','beam']`, `client/src/shop-slots.js:13`).

### 2c. The `BEAM` AI preset: `ai.range` 50, `aimTol` 0.12 — and what each is measured against.

```js
const BEAM = { ai: { range: 50, aimTol: 0.12 } }; // charged beam (pirate lancer)
```

**`ai.range` gates only the START of a charge; it does NOT set the fighting distance.** The AI's standoff
comes from `enemyThrustFactor(dist, near = 14, far = 22)` (`client/src/sim-core/steering.js:43`), which is
independent of every group's `ai.range` — the lancer *closes to 14–22 u* whatever this number says. Write
that into the seed comment, because the next reader will assume otherwise (`GUN_LONG` pairs `ai.range` 90
with a 90-reach weapon and looks like a rule).

Why **50**, justified against the frame the way §135 asked — **and note that §135's own stated reason is
factually wrong; correcting it is part of this change** (see §6):

- **THERE IS NO PORTRAIT FRAME. A phone held in portrait renders LANDSCAPE.** On a touch device with
  `innerHeight > innerWidth`, `applyOrientation()` sets `G.rotated` and the whole `<body>` is rotated 90° in
  CSS (`client/src/engine.js:69`, `body.rot` at `client/styles.css:463-466`), with `gameW()`/`gameH()`
  swapped (`engine.js:34-35`) — DECISIONS **§26**. So the "±32 u horizontally on a phone in portrait" figure
  quoted in `DECISIONS.md:5198-5200`, in `charge-beam-weapon.md:147-148` and `:505`, and in
  `combat-ally.md:180-182` **describes a frame the game never renders.** A modern handset ends up at aspect
  ~2.16, i.e. roughly **±124 u horizontally — the WIDEST frame in the game**, not the narrowest.
- **The binding axis is therefore VERTICAL, and it is the same on every device: ±57 u** on the combat plane
  at zoom 1 (camera `(0,110,26)`, 55° FOV — `engine.js:62-63`; horizontal is ±102 u at 16:9 and more on a
  phone). **`ai.range` 50 < 57**, so a lancer that starts a charge is **inside the frame on every axis on
  every device** — its hull, not merely its lines. That is the real justification, and it is stronger than
  the one it replaces.
- 50 is only where the lancer *starts* engaging; it then closes to the ~14–22 u standoff, so 50 is transient.
- **50 sits INSIDE the weapon's 67 reach on purpose** — the lancer closes to fight rather than sniping at
  the edge of its own reach, exactly as `GUN` engages at 45 with an 88-reach weapon.
- **Independently of the frame, the hostile sight is drawn to the weapon's full `maxRange` and is never
  clipped to the shooter's vicinity** (§4 S4, asserted in §9). The reason is not the frame but the reading:
  the part of the telegraph the player actually uses is the part crossing **his own ship**, 45 u past a
  lancer sitting at its 22 u standoff. A sight clipped short would hide exactly the half that is the warning.

Why **`aimTol` 0.12 rad (~7°) rather than `GUN`'s 0.25 (~14°)**: `aimTol` gates only the start of a charge,
and 14° of slop against a ±2° corridor produces telegraphs with no shot behind them — which teaches the
player to ignore the lines, destroying the thing the gate exists to protect.

### 2d. The telegraph: **CHANGE NOTHING.** The hostile sight is the player's sight, in red, charge-only.

Maintainer, 2026-08-25, verbatim (translated): *"Change nothing. As soon as they start shooting at me, I see
all the lines. When I look at it, we'll decide what to do."*

So the hostile sight **reproduces the player's exactly** — same three lines, same `THREE.LineDashedMaterial`,
same dash rhythms (centre `2.4/1.6`, edges `0.7/1.5`), same opacity ramp (`SIGHT_IDLE` 0.22 idle,
`+ SIGHT_GAIN` 0.38 over the charge) — differing in **three** ways, of which the third is a known side
effect this change deliberately does not fix:

1. the colour is **`0xff6b4a`** instead of `0x5ad17f`;
2. it is **charge-only** (the player's is always-on while a beam is mounted; a hostile shows nothing until it
   triggers) — brief §0b Q2: lines from a hostile hull must always mean *"a shot is coming right now."*
3. **its dashes do not FLOW while the player carries no beam** — which is the usual case. The dash animation
   is driven by the shared `dashPhase` accumulator, and `dashPhase` is advanced only inside the player's own
   pass, which returns early at `client/src/beam-fx.js:213` when the ship has no beam group. So a hostile
   telegraph normally shows the right pattern, brightening correctly over the charge, with the pattern
   **static** rather than rushing outward. **The fix is one line moved** — advance `dashPhase` in
   `drawBeamSight` before either pass, instead of inside `drawPlayerSight`. **The maintainer chose to leave
   it for the live-tuning pass** (2026-08-25, the same *"for now we leave everything as it is"* that kept the
   45): the brightening ramp is the charge readout the player actually reads, and moving the accumulator
   changes the player's own sight timing, which is a look value he wants to judge in flight rather than have
   changed underneath him. **Disclosed here and again in S4 so it is a known deferral, not a silent
   regression**, and listed on the ROADMAP beside the turn-rate follow-up so the two are found together
   (§6).

**Explicitly declined, so nobody "improves" it later:** no muzzle bead, no reticle, no marker on the
player's ship, no separate hostile dash rhythm, no brighter opacity ramp. An earlier draft proposed
`0.28 → 0.78` plus a hostile muzzle bead; the maintainer declined it. This is deliberately the smallest thing
(DECISIONS §30) — it is a look-and-feel weapon, he will judge it in flight, and we tune it *then*.

**Audio: the hostile charge stays SILENT.** "Only your own shots are audible" is unchanged; both beam sounds
stay gated on `ev.fromPlayer` (`client/src/sim.js:315,326`). §135's gate names exactly two things — the sight
and the wire ref — and an audible hostile charge is not one of them. **Do not add a `SOUND_MAP` exception.**
(The discharge BOLT is already drawn whoever fired it, `sim.js:325`; that stays.)

### 2e. The wire: `beamCharge` carries the SHOOTER, and the ref table gets one home.

In a room a remote shooter's fire group is **never ticked** — the ghost keeps its `groups`, but nothing
advances `g.charge` — so the corridor is underivable without a reference. `beamCharge` gains the shooter as
an `EVENT_ENTITY_REFS` entry (→ a ship **id**, never the entity). **Still two events per shot. No per-tick
charge fraction, no snapshot column, no digest field.**

Three facts that shape it, each re-verified in the code for this plan:

- **The ghost already carries the weapon row.** `spawnGhost` → `makeEnemyShell` runs
  `e.groups = buildGroups(s.groups, e.mounts)` (`client/src/sim-core/ship-entity.js:158`;
  `client/src/netsim-world.js:123`), so `maxRange` and `corridorDeg` are client-side already. **The event
  therefore needs NO `range`/`corridorDeg` fields — only the ref.** (§2d of the 1056 plan proposed carrying
  them; it is superseded here, and the reason is that the ghost is built by the same constructor the
  simulation uses.)
- **`hydrateEvent` hardcodes `enemyId`** (`client/src/netsim-world.js:319`). Generalise the rehydration over
  `EVENT_ENTITY_REFS` rather than adding a second hardcoded line.
- **`beamFire` needs no second ref.** A hostile sight entry ends on its own `dur` (§3, item 4).

**Where the table lives — this is the new architectural decision (new DECISIONS entry, §11).** No client
module imports from `server/` (verified: `client/src/netsim-world.js:315` only *mirrors* `protocol.js` in a
comment), and the browser is served `client/` alone — so the client cannot import
`server/src/netsim/protocol.js`. **`EVENT_ENTITY_REFS` moves to `client/src/sim-core/events.js`** — host-
neutral, already the file `server/src/netsim/room.test.js:122` parses — and `protocol.js` imports it. One
table, read by both the room that serializes and the client that rehydrates, instead of a server table
shadowed by a hardcoded line on the client.

### 2f. The dev flag: `?lancer`, shaped exactly like `?ally`.

```
?lancer                    the default phase ('wave-1'), on whatever level this tab was going to fly
?lancer=clear-out          that phase instead
?lancer&level=4            the default phase, on Level 4 — regardless of the account's progress
?lancer=0 | false | off    off (and no `lancer` param at all is off)
```

- It lives in **`client/src/beam-dev.js`** beside `?beam`, and **the two compose**: `?beam&lancer&level=4` is
  the full test flight (your beam against theirs). `?beam` alone still means "the player carries the beam",
  including for any unrecognised value — `evalBeamDev('?beam=enemy') === true` stays true, but its test's
  comment must be corrected (the enemy half now exists, under its own param).
- **It is a pure `sim-core` descriptor transform**, `withLancersAt(level, phaseName)`, applied client-side at
  `main.js:2045` **and** forwarded on the netsim handshake so a room runs the same fight
  (`netsim.js wsUrl` → `server/src/netsim/socket.js:95` → `createRoom` → `createSimWorld`), exactly as
  `?ally` does.
- **§81 dev-flag rule:** URL only, never sticky, pure and unit-testable, and an absent flag changes nothing
  (the SAME descriptor object comes back out).
- **`beam-dev.js`'s header comment currently says "NO ENEMY HALF"** (`client/src/beam-dev.js:16-18`). That
  comment must be **rewritten**, not left lying.
- **It changes the fight**, so a campaign session recorded with it on re-simulates into a divergence in
  `server/tools/verify-sessions.mjs` — expected for a dev flag, exactly as `?ally` documents at
  `client/src/ally-dev.js:27-35`. Document it in the flag's header the same way.

### 2g. THE `enemyTotal` TRAP — swap the pool, clamp concurrency, **touch nothing else**.

An earlier draft of this plan clamped the injected phase to `maxConcurrent: 2, total: 4`. **`total` is a
defect and is overruled.** Two independent things break:

1. **`advanceWhen: { kills: N }` is CUMULATIVE kills, not kills-since-phase** —
   `client/src/sim-core/level-runner.js:270` reads `world.kills >= c.kills` (the `killsSincePhase` variant is
   the *next* line, `:271`). Level 4's `wave-1` carries `advanceWhen: { kills: 8 }` against `spawn.total: 8`
   and `maxConcurrent: 5` (`server/src/catalog_seed.js:733-742`). Clamp the total to 4 and the phase spawns 4, the player
   kills 4, `world.kills` stalls at 4 < 8, and **the level never advances.**
2. **`enemyTotal` is the sum of every phase's `spawn.total`** (`server/src/enemy_total.js`, mirrored by
   `levelEnemyTotal` at `client/src/sim-core/level-sim.js:9`). It drives the HUD's killed/total and
   `isLastKillDrop` (`level-sim.js:13`).

**So the transform does exactly two things, and neither of them is `total` or `advanceWhen`:**

- **replace the phase's `spawn.pool` with 100 % `pirate lancer`**;
- **clamp `spawn.maxConcurrent` to `Math.min(existing, 2)`** — two simultaneous 1-second telegraphs is a
  legible fight; five is a red lattice.

*Draw-count note:* `pickShip` calls `simRandom()` once per spawn even for a single-entry pool
(`level-runner.js:216-221`), so the swap is **draw-count neutral** — the seeded stream advances identically,
only the chosen ship differs.

### 2h. Review-gate items — implement as stated, raise, do NOT block on

| item | proposed value |
|---|---|
| the model | `enemy_1_orange_combat.f3b006ba.glb` (the pirate gunner's) — identical on screen to a gunner, accepted knowingly; **CREDITS.md unchanged** |
| the English name | **`pirate lancer`** (lower-case, matching `pirate gunner` / `basic rocket pirate`) |
| components / HP | `{ hull: 22, engine: 23, thruster: 9 }` → 36 total = 12 shield + 24 hull |
| reward / xp | **100 / 100** |
| where it spawns | **dev-flag only.** No shipped level's pool is touched — that would move `enemyTotal` and break recorded traces. Level 5 wires it for real. |

---

## 3. The reachability checklist — answered from the source, not asserted

This is the class of defect that survived 797 tests on the combat-ally run and was found only by playing.
Each answer carries its `file:line`; each one that can be a test is one (§9).

1. **Does the lancer ever actually fire?** Two gates sit in front of it, both in the `wantsFire` predicate at
   `client/src/sim-core/step-enemies.js:105-106`:
   `!e.warping && world.combatElapsed >= ENEMY_FIRE_GRACE && dist < g.ai.range && Math.abs(diff) < g.ai.aimTol`.
   `ENEMY_FIRE_GRACE = 5` seconds (`step-enemies.js:33`), and `e.warping` clears when
   `spawnAge >= spawnDur` (`step-enemies.js:52`). **The scenario must step past both** — force
   `e.warping = false; e.spawnAge = e.spawnDur; e.scale = e.fullScale` and step ≥ 5 s of sim, exactly as
   `39-charge-beam.mjs:71` and `:136` already do.
   **`aimTol` 0.12 is reachable with room to spare:** `e.heading = steerToward(e.heading, desired,
   e.turnRate * dt)` (`step-enemies.js:90`) runs *every* tick toward the target, and the lancer's real turn
   rate is **2.58 rad/s** (§2a) — `maxStep` is 0.043 rad = **2.5° per tick**, so `steerToward` reaches the
   exact bearing (it clamps, `steering.js:21-24`) within a tick or two of acquiring and holds it. 7° of error
   closes in **under 50 ms**, not 0.2 s.
2. **Does the charge ever COMPLETE?** Yes — the trigger is a **tap that COMMITS**. In `updateBeamGroup`
   (`client/src/sim-core/beam.js:184-195`) the `if (g.charge) { … return; }` branch **returns before
   `wantsFire` is consulted at all** (`:196`). So a flickering AI predicate cannot stall a charge, and
   nothing interrupts one — not damage, not the target dying (`:188` only drops the lock).
3. **The sight is redrawn from the LIVE transform every frame — never from the event's `pos`.**
   `beamCharge.pos` is the muzzle **at charge start**; the shooter moves and turns for the whole second, and
   the corridor is nose-attached **at release** by design (§135). A sight drawn from the event's `pos` would
   be a lie of exactly the kind the three lines promise not to tell. So the event supplies **only the ref and
   the `dur`**; every frame the renderer re-derives `fwd` from `ship.heading` and re-asks
   `beamMuzzle`/`corridorEnds` (`sim-core/beam.js:89,98`). In a room `ship.heading` is the **interpolated**
   heading (`netsim-world.js:390`), which is §127's one clock — and the event is released when the render
   clock reaches its tick (`netsim-world.js:373-382`), so sight and picture stay in step.
4. **What clears a hostile sight entry — all four ways it can end.**
   - **the `dur` expires** — the primary rule: `t >= dur` drops it. This is also what covers *the shooter
     fired*, since `dur` **is** the sim's `chargeTime`; there is no second entity ref on `beamFire` and none
     is being added (§135 keeps it at two events, one ref).
   - **the shooter DIES mid-charge** — `!ship.alive` drops it. Locally `stepEnemyDeaths` splices the entity;
     the FX holds the last reference, and `alive` is false.
   - **the ghost is DESPAWNED by the render clock in a room** (`netsim-world.js:405-416`) — this drops it from
     `world.enemies` while the FX module may still hold a reference, and **a local test cannot reach it**.
     It is covered by the same `!ship.alive` check, because `despawnGhost` sets **`e.alive = false`**
     (`netsim-world.js:182`) before returning. A `warping` shooter is dropped too (it cannot fire).
   - **the run ends** — `hideBeamFx()` (`client/src/sim.js:716`) must clear the hostile pool as well as the
     player's sight and the bolts.
5. **The corridor is drawn to the full `maxRange` (67), never clipped.** `corridorEnds(ship, fwd, range, …)`
   is handed the weapon row's `maxRange` verbatim, exactly as the player's path does
   (`client/src/beam-fx.js:219,225`). Asserted in §9: the drawn line length ≈ 67, not the muzzle→player
   distance. The reason is the READING, not the frame (§2c): from a lancer at its 14–22 u standoff the useful
   half of the telegraph is the ~45 u running past the player's own ship.
6. **`ai.range` 50 is not the fighting distance** — see §2c. Stated in the seed comment beside the preset.
7. **`g.reload` for the lancer's group = 0.5 s, not 0.** `buildGroups` sets
   `reload = gm.reduce((mx, m) => Math.max(mx, m.weapon.fireCooldown || 0), 0)`
   (`client/src/sim-core/ship-entity.js:50`), and the single mount's `fireCooldown` is 0.5. After the
   discharge `updateBeamGroup` sets `g.cooldown = g.reload` (`beam.js:192`). So the cycle is
   1.0 + **2.0** = **3.0 s** (`fireCooldown` was raised from 0.5 after the live test — see the §2a banner).
8. **The `events.js` catalogue comment is PARSED.** `room.test.js:122` reads it with
   `/^\/\/\s+\{\s*type:\s*'([a-zA-Z]+)'/gm` and asserts every parsed type has an `EVENT_FIELDS` entry (and
   that ≥19 types parse). Adding `ship` to `beamCharge`'s catalogue line must keep the line starting
   `//   { type: 'beamCharge',` — the field list after the type is free text.
9. **`?lancer` changes the fight** → recorded sessions with it on diverge in
   `server/tools/verify-sessions.mjs`. Documented in the flag's header (§2f).
10. **The player never sees a red sight on a friendly.** `beamCharge` carries `fromPlayer`, not `side`, so an
    ALLY carrying a beam (dev-only; `ALLY_MOUNTS` has none — `sim-core/ally-config.js:7-10`) would otherwise
    take the hostile branch. The renderer therefore accepts a hostile sight **only for a ship that is in
    `world.enemies`** — a RENDERING-scope test, in the renderer, which introduces **no `side === 'player'`
    test into `sim-core`** (§135's standing constraint).
11. **The lancer's beam row can be LOOTED.** Enemy weapons drop and land in the stash (that is how `Kinetic
    pirate` works), and the `gun` slot accepts `beam` (`shop-slots.js:13`) — so a player who kills a lancer
    could equip a 45-power beam without paying 5500 or clearing the Level-4 gate. **Unreachable in shipped
    play** (the lancer spawns only behind a dev flag) and therefore not guarded here; it becomes a real
    question the day Level 5 fields lancers, and is recorded in SUMMARY as such.

---

## 4. Steps

### S1 — the catalog: weapon 13, the `BEAM` preset, the lancer

**`server/src/catalog_seed.js`**

1. **Weapon id 13.** Append after the Charged beam row (id 12 runs `:263-272`; the `WEAPONS` array closes at
   `:274`):

```js
  // The pirate lancer's beam — a WEAKENED copy of id 12, and a second row rather than a shared one because
  // every behaviour number lives in the weapon row so two ships can carry differently-tuned beams
  // (DECISIONS §135). Enemy gear: hidden from the shop, no level gate, resale-only.
  //
  // AMENDED: shipped as `fireCooldown: 2.0` — 45 damage on a 3.0 s cycle = 15 DPS, BELOW the pirate MG's
  // 16.7. The snippet below is the first-pass draft (pirate MG 16.7,
  // advanced pirate cannon 10), and 2.25x the biggest single hit that exists today (the 20-damage pirate
  // rocket, which is dodgeable AND shootable-down while a hitscan beam is neither). The maintainer was told
  // both and chose these numbers anyway (2026-08-25) — DO NOT "fix" them. What keeps it fair is the
  // TELEGRAPH: a full second of three drawn lines before the shot exists (the gate in DECISIONS §135).
  {
    id: 13, name: 'Pirate charged beam', type: 'beam', price: 250, stats: {
      power: 45,         // vs the player's 80
      maxRange: 67,      // two thirds of the player's 100 (maintainer, 2026-08-25)
      chargeTime: 1.0,   // SAME as the player's: telegraph length is not the lever
      fireCooldown: 0.5, // unchanged from the player's
      corridorDeg: 2,    // HALF-angle of the hit corridor, degrees — unchanged from the player's
      weight: 12, projectileColor: 0xbfefff, class: 'beam', buyable: false,
    }
  },
```

   Also extend the beams paragraph of the `WEAPONS` header comment (`:160-163`) to note that a beam row may
   be enemy gear (`buyable: false`, no `minLevel`).

2. **The `BEAM` fire-group preset.** After `ROCKET` (`:355`):

```js
// The charged beam (pirate lancer). `ai.range` gates only the START of a charge — it is NOT the fighting
// distance: every enemy closes to a 14-22 u standoff via enemyThrustFactor (sim-core/steering.js:43),
// whatever this says.
//
// 50 is chosen against the FRAME, on its BINDING AXIS — the vertical, which is ±57 u on the combat plane on
// EVERY device (camera (0,110,26), 55° FOV; horizontal is ±102 u at 16:9 and wider on a phone, because a
// touch device held in portrait renders LANDSCAPE — the body is rotated 90°, DECISIONS §26). So a lancer
// that starts a charge is on frame, hull and all, and an aiming line the player never sees is not a warning
// (the gate in DECISIONS §135). It also sits INSIDE the weapon's 67 reach on purpose, so the lancer closes
// to fight rather than sniping at its own edge.
//
// aimTol 0.12 (~7°) rather than GUN's 0.25 (~14°): aimTol gates only the start, and 14° of slop against a
// ±2° corridor produces telegraphs with no shot behind them, which teaches the player to ignore the lines.
const BEAM = { ai: { range: 50, aimTol: 0.12 } };
```

3. **The lancer.** Append as the LAST entry of `SHIPS` (the array closes at `:507`) — appending keeps
   `CATALOG.enemyShips[0..2]` stable for the A/B bench (`client/src/main.js:1456,1502-1503`):

```js
  {
    // Pirate lancer: the first enemy in the game that carries a CHARGED BEAM (weapon 13). Beam-only, in its
    // OWN single-mount group — `isBeamGroup` uses `some`, so a beam sharing a group would silence every
    // other mount in it (DECISIONS §135; server/src/catalog_beam.test.js guards it).
    //
    // It reuses the pirate gunner's .glb and its baked model block VERBATIM (same asset, same muzzle /
    // hitboxes / lift / yaw) — no new asset, so client/assets/CREDITS.md is unchanged. It is therefore
    // visually identical to a pirate gunner: the RED aiming corridor is the identification, accepted
    // knowingly by the maintainer (2026-08-25).
    //
    // NOT wired into any level. It spawns only behind the `?lancer` dev flag until Level 5 fields it —
    // editing a shipped level's pool would move `enemyTotal` and break recorded traces.
    name: 'pirate lancer', type: 'enemy', modelUrl: 'assets/ships/enemy_1_orange_combat.f3b006ba.glb', modelUrlHigh: 'https://d1843uwjdjg4vs.cloudfront.net/ships-hangar/enemy_1_orange_hangar.5e6e1cc4.glb',
    components: { hull: 22, engine: 23, thruster: 9 }, stats: {
      role: 'pirate_lancer', class: 'fighter', color: MARKER.small, reward: 100, xp: 100, dodge: 0,
      model: { /* …COPY the pirate gunner's whole model block from :421, unchanged… */ },
      groups: { gun: BEAM },
      mounts: [{ weapon: 13, group: 'gun', offset: 0, delay: 0 }]
    }
  },
```

**FOUR assertions break here, all in `server/src/server.test.js` — not two:**
- `:394` `assert.equal(ships.length, 9)` → **10**;
- `:396-400` `assert.deepEqual(names.sort(), [ …nine names… ].sort())` → add **`'pirate lancer'`**;
- `:418` `assert.equal(enemies.length, 8)` → **9**, and extend its inline enumeration comment (which lists
  every enemy by hand) with the lancer;
- `:519` `assert.equal(weapons.length, 12)` → **13**, and extend the enumerating comment at `:517-518`
  ("… + Charged beam (12)") to name **Pirate charged beam (13)**.

Grep `server/src/server.test.js` for other hand-counted catalog assertions before assuming that is all of
them — a hardcoded count is exactly the kind of thing that hides one line below the one you fixed.

**`server/src/catalog_beam.test.js` needs one assertion rewritten and two left alone:**
- `:67` `assert.equal(beamGroups, 0, 'no seeded ship carries a beam today …')` is now FALSE. Rewrite it to
  assert what is true: **exactly one** seeded ship carries a beam, and it is the `pirate lancer`'s `gun`
  group. Keep the loop above it (the mixed-group guard at `:50-64`) doing its job — the point of the guard is
  that the lancer's group has **exactly one mount**.
- `:70` (no PLAYER ship has two mounts in one group) and `:88-116` (the multi-mount enemy inventory) are
  **unchanged** and must not be weakened. The lancer is single-mount, so it does not join the `multi` list at
  `:108`.
- The per-row loop at `:27-47` now runs over **two** beams; both must carry every stat and both route
  `class: 'beam'` → the existing `charge` + `fire` `SOUND_MAP` rows. No new sound rows.

`server/src/catalog_muzzle.test.js` gains one case (the copied `model` block satisfies it).

### S2 — `client/src/sim-core/lancer-config.js` (new): the descriptor transform

A new `sim-core` module — pure, Node-loadable, renderer-free (`sim-core/boundary.test.js` enumerates the
folder and will generate its guard cases automatically). It mirrors `ally-config.js`'s `withAllyAt`
(`client/src/sim-core/ally-config.js:82-91`), which is the precedent for "a dev flag injects into a level
descriptor without mutating the shared seed".

```js
// The pirate lancer's dev injection: what the `?lancer` flag does to a level descriptor.
//
// NON-MUTATING, and that is load-bearing: `buildCatalog` shallow-copies a level, so its `phases` array is
// SHARED with the module-level seed — mutating a phase in place would give every room in the process
// lancers. Do not "simplify" this to an assignment. (Same trap as withAllyAt.)
export const LANCER_SHIP_NAME = 'pirate lancer';
export const DEV_LANCER_DEFAULT_PHASE = 'wave-1'; // the FIRST wave, so a test flight meets one in seconds
// Two simultaneous 1-second telegraphs is a legible fight; five is a red lattice. Clamped, never raised.
export const DEV_LANCER_MAX_CONCURRENT = 2;

// Swap one phase's spawn POOL to 100% lancers and clamp its concurrency. `spawn.total` and `advanceWhen`
// are DELIBERATELY UNTOUCHED: `advanceWhen: { kills: N }` is CUMULATIVE kills (level-runner.js:270), so
// lowering a total below its phase's kill threshold hangs the level forever — and `enemyTotal` is the sum of
// every phase's total (server/src/enemy_total.js), which drives the HUD and the last-kill reward drop.
export function withLancersAt(level, phaseName) {
  if (!level || !Array.isArray(level.phases)) return level;
  let found = false;
  const phases = level.phases.map((ph) => {
    if (ph.name !== phaseName || !ph.spawn) return ph;
    found = true;
    return { ...ph, spawn: {
      ...ph.spawn,
      pool: [{ ship: LANCER_SHIP_NAME, chance: 100 }],
      maxConcurrent: Math.min(ph.spawn.maxConcurrent ?? DEV_LANCER_MAX_CONCURRENT, DEV_LANCER_MAX_CONCURRENT),
    } };
  });
  return found ? { ...level, phases } : level; // an unknown (or spawn-less) phase name changes nothing
}
```

### S3 — `client/src/beam-dev.js`: the `?lancer` half, and the header that lies

1. **Rewrite the header block at `:16-18`.** It currently reads "NO ENEMY HALF … there is deliberately
   nothing here to turn it on with." Replace it with what is now true: the gate in DECISIONS §135 has been
   passed (the hostile sight and the wire ref exist), `?lancer` injects the beam-armed **pirate lancer** into
   a phase, the two params compose, and — like `?ally` — a session recorded with it on re-simulates into a
   divergence in `verify-sessions.mjs`.
2. Add, mirroring `evalAllyDev` (`client/src/ally-dev.js:43-53`):

```js
import { withLancersAt, DEV_LANCER_DEFAULT_PHASE } from './sim-core/lancer-config.js';
import { normalizeLevelName } from './replay.js';

// `?lancer[=phase]` (+ the shared `level` param). Pure + storage-free: the URL alone decides.
export function evalLancerDev(search) {
  const p = new URLSearchParams(search || '');
  const v = p.get('lancer');
  if (v == null) return null;
  if (v === '0' || v === 'false' || v === 'off') return null;
  const phase = (v === '' || v === 'true' || v === '1') ? DEV_LANCER_DEFAULT_PHASE : v;
  // Only when the param is actually there: normalizeLevelName(null) is 'level-0', which would drag every
  // bare ?lancer run back to the intro level.
  const level = p.has('level') ? normalizeLevelName(p.get('level')) : null;
  return { phase, level };
}

const LANCER_DEV = evalLancerDev(typeof location !== 'undefined' ? location.search : '');
export function lancerDev() { return LANCER_DEV; }
export function lancerDevLevel() { return LANCER_DEV && LANCER_DEV.level; }
// A strict no-op with the flag off: the SAME descriptor object comes straight back out.
export function applyLancerDev(descriptor) {
  return LANCER_DEV ? withLancersAt(descriptor, LANCER_DEV.phase) : descriptor;
}
```

   (`?beam` resolves lazily via `beamDev()` because the ship builder asks for it mid-boot; `?lancer` is read
   at import time like `?ally`, because the level descriptor is fetched later than module load. Keep both
   shapes as they are — do not unify them.)

### S4 — `client/src/beam-fx.js`: the hostile sight

**Restructure `drawBeamSight` first — this is the single most important instruction in the file.** It
currently returns early three times before drawing anything (`:211` no player, `:213` no beam group, `:218`
no weapon row), and **the usual case is a player with no beam**. If the hostile pass lives after those
returns, it never runs. So:

```js
export function drawBeamSight(dt) {
  stepTransients(dt);
  drawHostileSights(dt);   // FIRST, and unconditionally: the player almost never carries a beam
  drawPlayerSight(dt);     // the existing body, verbatim, minus its own stepTransients call
}
```

Add beside the existing constants:

```js
// THE HOSTILE SIGHT IS THE PLAYER'S SIGHT IN RED, AND NOTHING ELSE. Maintainer, 2026-08-25: "Change
// nothing. As soon as they start shooting at me, I see all the lines." Same three lines, same dash rhythms,
// same 0.22 + 0.38 opacity ramp — it differs in the hue, and in being CHARGE-ONLY (lines from a hostile hull
// must always mean "a shot is coming right now" — brief §0b Q2). No muzzle bead, no reticle, no marker on
// your ship, no brighter ramp: all proposed, all declined. He will judge it in flight.
//
// KNOWN AND DEFERRED (maintainer, 2026-08-25; it is on the ROADMAP): the dashes do not FLOW while the player
// carries no beam, because `dashPhase` is advanced inside the player's pass, which returns early for a ship
// with no beam group. The pattern is right, it just holds still. One line moved fixes it — but it retimes
// the player's own sight too, so it waits for the live-tuning pass. Do not "fix" it in passing.
const HOSTILE_SIGHT_COLOR = 0xff6b4a;
const HOSTILE_POOL = 4;   // several lancers can charge at once
```

The pool and its lifecycle:

```js
let hostiles = null;   // [{ ship, t, dur, centre, left, right }]

function ensureHostiles() {
  if (hostiles) return hostiles;
  hostiles = [];
  for (let i = 0; i < HOSTILE_POOL; i++) {
    hostiles.push({
      ship: null, t: 0, dur: 0,
      centre: makeLine(HOSTILE_SIGHT_COLOR, SIGHT_IDLE, 'beamHostileSightCentre', true, CENTRE_DASH, CENTRE_GAP),
      left:   makeLine(HOSTILE_SIGHT_COLOR, SIGHT_IDLE, 'beamHostileSightEdge', true, EDGE_DASH, EDGE_GAP),
      right:  makeLine(HOSTILE_SIGHT_COLOR, SIGHT_IDLE, 'beamHostileSightEdge', true, EDGE_DASH, EDGE_GAP),
    });
  }
  return hostiles;
}
```

- **Own object names** (`beamHostileSight*`), so a headless scenario asserts on THOSE and never confuses them
  with the player's `beamSight*`. Keep the named-object convention.
- **`startHostileBeamCharge(ship, dur)`** — the `beamCharge` event's hostile branch:
  - **accept only a ship that is in `world.enemies`.** This is the RENDERING-scope guard from §3 item 10: an
    ally's charge also has `fromPlayer === false`, and a red sight on a friendly would be a lie. It
    introduces no `side` test into `sim-core`.
  - **reuse the entry already keyed to that ship** if there is one (a second charge resets it), else take a
    free entry, else evict the entry with the smallest remaining `dur - t`.
  - `e.ship = ship; e.t = 0; e.dur = dur > 0 ? dur : 1;`
- **`drawHostileSights(dt)`** — per entry:
  - age `e.t += dt`;
  - **drop** (`e.ship = null`, hide all three lines) when `!e.ship || !e.ship.alive || e.ship.warping ||
    e.t >= e.dur` — the four endings from §3 item 4, `!alive` covering both a local death and a room despawn
    (`netsim-world.js:182`);
  - otherwise: `w = beamWeaponOf(beamGroupOf(e.ship))` — **from the ghost's own catalog groups, so the
    corridor is this weapon's 67 and ±2°, never the player's**; if there is no beam weapon, drop the entry;
  - `_fwd.set(Math.sin(ship.heading), 0, Math.cos(ship.heading))` — **the LIVE (interpolated, §127) heading
    every frame, never the event's `pos`** (§3 item 3);
  - `beamMuzzle(ship, _fwd, _muzzle)` then
    `corridorEnds(ship, _fwd, w.maxRange, corridorRadOf(w), _endC, _endL, _endR)` — **the full `maxRange`,
    never clipped** (§2c, §3 item 5);
  - `k = Math.min(1, e.t / e.dur)`; three `setLine(…, dashPhase)` calls; opacity
    `SIGHT_IDLE + k * SIGHT_GAIN` on all three — **the player's exact numbers**.
  - Reuse the module's existing `dashPhase`, and **leave it advanced where it is advanced today — inside the
    player's pass.** The consequence is stated openly in §2d and is a **deliberate deferral, not an
    oversight**: `drawPlayerSight` returns early at `beam-fx.js:213` for a player with no beam, which is the
    usual case, so a hostile telegraph normally shows the right dash pattern **static** instead of flowing
    outward. The fix is one line moved (advance `dashPhase` in `drawBeamSight`, before either pass); the
    maintainer chose to leave it for the live-tuning pass rather than change the player's own sight timing
    underneath him. **Do not silently "fix" it here** — it is on the ROADMAP with the turn-rate follow-up.
- **`hideBeamFx()` (`:336`) must clear the hostile pool too**: null every `ship`, zero every `t`/`dur`, hide
  all three lines per entry. A fresh run must not inherit a red corridor from a fight that is over.
- **Update the module header's SCOPE paragraph (`:18-20`)**, which currently says it draws the local
  player's sight "and nothing else" and calls the hostile sight deferred. It is no longer deferred.

### S5 — the events: the shooter ref, and one home for the ref table

1. **`client/src/sim-core/events.js`** — the catalogue line for `beamCharge` (`:26-27`) becomes:

```
//   { type: 'beamCharge',      ship, pos, dur, weaponClass, fromPlayer }  a beam started charging (the sight
//                                                                       brightens over `dur` seconds; `ship`
//                                                                       is the SHOOTER — an entity ref, so a
//                                                                       client can draw a REMOTE corridor)
```

   Keep the `//   { type: 'name',` prefix exactly — `room.test.js:122` parses it (§3 item 8).

   Then add the table, below the catalogue:

```js
// Fields holding a LIVE ENTITY rather than a value. One table, two readers: the room swaps each for a
// network id on the way out (server/src/netsim/protocol.js wireEvent), and a netsim client swaps it back for
// the ghost that id names (client/src/netsim-world.js hydrateEvent). It lives HERE, in host-neutral
// sim-core, because the client cannot import from server/ — the browser is served client/ alone — and the
// alternative was a table on the server shadowed by a hardcoded `enemyId` line on the client. (DECISIONS §136)
export const EVENT_ENTITY_REFS = {
  enemyShieldHit: ['enemy'],  // bind a pooled shield bubble to a specific ship
  beamCharge:     ['ship'],   // the SHOOTER, so a client can draw a remote corridor (DECISIONS §135's gate)
};
```

   Extend the header's "Entity references are the exception, and deliberate" note (`:11-13`) to name the
   second one and why it is identity rather than a value.

2. **`server/src/netsim/protocol.js`** — delete the local table at `:85` and import it:
   `import { EVENT_ENTITY_REFS } from '../../../client/src/sim-core/events.js';` (re-export it if any test
   imports it from here — `wireEvent` at `:106` reads it unchanged). Update the comment at `:52-56`, which
   currently says "No entity reference: … the hostile sight is deferred (plan §2d)."
   **`EVENT_FIELDS.beamCharge` is NOT changed** — the ref is added by `wireEvent`'s second loop as `shipId`.

3. **`client/src/sim-core/beam.js`** — `updateBeamGroup`'s emit (`:199-206`) gains the shooter:

```js
      type: 'beamCharge', ship, pos: _muzzle.clone(), dur: chargeTime, weaponClass: w.class,
      fromPlayer: side === 'player',
```

   with a comment: *the shooter is an entity REF (the wire turns it into an id, `EVENT_ENTITY_REFS`), because
   a remote client cannot derive a corridor it never ticks. Still two events per shot.* This is
   side-agnostic — no `side === 'player'` test is introduced.

   *Wire-safety:* `wireEvent` serializes only `EVENT_FIELDS` plus the id, so no entity graph leaks;
   `room.test.js:110-118` (snapshot < 20 KB, no `hitBoxes`) and `:133` (the `enemyShieldHit` id swap) keep
   guarding it. `idOf(world.player)` is `null` (the player is never `host.onSpawn`ed), so a player's own
   `beamCharge` simply carries no `shipId` — harmless, since `fromPlayer` already routes it.

4. **`client/src/netsim-world.js`** — import `EVENT_ENTITY_REFS` from `./sim-core/events.js` (beside the
   `Vec3` import at `:23`) and replace the hardcoded line at `:319`:

```js
  // The reverse of the wire's entity-id swap, generalised over the ONE ref table both ends read: a shield
  // ripple binds to the ship it hit, and a hostile beam's corridor to the ghost that is charging it. An id
  // whose ghost has already been retired resolves to null, and the FX treats that as "nothing to draw".
  for (const f of EVENT_ENTITY_REFS[ev.type] || []) {
    const id = ev[`${f}Id`];
    if (id != null) { out[f] = state.byId.get(id) || null; delete out[`${f}Id`]; }
  }
```

   Behaviour for `enemyShieldHit` is identical to today's line, including the `|| null`.

### S6 — `client/src/sim.js`: the adapter

The `beamCharge` case (`:315-323`) gains one branch. Import `startHostileBeamCharge` alongside the existing
four (`:39`).

```js
    case 'beamCharge':
      if (ev.fromPlayer) {
        startBeamCharge(ev.dur);
        audio.sfx.shoot(sfxFor('weapon', ev.weaponClass, 'charge'), { rate: BEAM_CHARGE_CLIP_SEC / (ev.dur || 1) });
      } else if (ev.ship) {
        // A HOSTILE is charging: draw its corridor, in the hostile hue, for exactly its `dur`. SILENT — only
        // your own shots are audible, and the beam makes no exception (DECISIONS §135's gate names the sight
        // and the wire ref, not a sound). `ev.ship` is the live entity locally and the rehydrated GHOST in a
        // room; beam-fx accepts it only if it is in world.enemies, so an ally's beam never draws red.
        startHostileBeamCharge(ev.ship, ev.dur);
      }
      break;
```

Correct the comment block above it (`:304-314`), which says the `fromPlayer` gate on the CLOCK exists because
`beam-fx.js` draws exactly one ship's sight and "dissolves the day `beamCharge` carries a shooter reference".
That day is today: say that the audio gate stays (only your own shots are audible) and the sight now has a
per-shooter pool.

### S7 — the room: forwarding `?lancer` end to end

Mirror `ally` at every hop. Four one-line changes plus the client's two:

1. `server/src/sim-host.js:88` — `createSimWorld({ …, ally = null, lancer = null })`, and after the `ally`
   line (`:92`): `if (lancer) catalog.level = withLancersAt(catalog.level, lancer);`, importing
   `withLancersAt` from `../../client/src/sim-core/lancer-config.js` beside the `withAllyAt` import (`:26`).
   Note in the comment that the headless referee (`server/tools/sim-replay.mjs`) passes neither, so a
   re-simulated trace is unchanged.
2. `server/src/netsim/room.js:82` — `createRoom({ …, ally = null, lancer = null })`, passed through to
   `createSimWorld` at `:97`.
3. `server/src/netsim/socket.js:95` — beside the `ally` param: `const lancer = params.get('lancer') || null;`
   and add it to the `createRoom({ … })` call at `:110`.
4. `client/src/netsim.js` — `wsUrl({ …, lancer })` sets `u.searchParams.set('lancer', lancer)` when truthy
   (`:95-104`), and `connectNetsim({ …, lancer = null })` forwards it into `wsUrl` (`:161`, `:174`).
5. `client/src/main.js:936` — beside `ally:`, add `lancer: lancerDev()?.phase || null,`.
6. `client/src/main.js:2014` — the forced level becomes
   `const devLevel = allyDevLevel() || lancerDevLevel();` (used at `:2017`); and `:2045` becomes
   `CATALOG.level = applyLancerDev(applyAllyDev(level.descriptor));` — the two transforms compose, each a
   strict no-op with its flag off. Import `lancerDev, lancerDevLevel, applyLancerDev` from `./beam-dev.js`
   (which is not yet imported by `main.js`; `?beam` reaches the build through `ship-build.js:22`).

### S8 — the early playable build (do this BEFORE S9)

A telegraph can only be judged in flight (the visual-feature lesson: a playable build must reach the
maintainer EARLY). After **S1–S6** the whole thing works locally; after **S7** it works in a room. So:

1. finish S1–S6, run `cd client && npm test` and `node visual/run.mjs 40-enemy-beam`;
2. **hand over a local build** — `/run-local` on **port 4001** (4000 is taken), URL
   `http://localhost:4001/?lancer&level=4` (and `?beam&lancer&level=4` for beam-vs-beam);
3. only then finish S7 and the room scenario.

Do not run test suites while the maintainer is playing.

### S9 — tests

**`client/src/beam-dev.test.js`** (extend):
- `evalLancerDev`: absent/`0`/`false`/`off` → null; bare `?lancer`, `=1`, `=true` → `{ phase: 'wave-1',
  level: null }`; `?lancer=clear-out` → that phase; `?lancer&level=4` → `level: 'level-4'`;
  `?beam&lancer&level=4` → both flags read independently.
- **Rewrite the existing `?beam=enemy` test's TITLE and comment (`:27-33`).** Its title is literally
  `'evalBeamDev: there is NO enemy half — arming a hostile is gated behind DECISIONS §135'`, and its body
  comment says an enemy beam is an unanswerable hit until the hostile sight exists. The **assertion** stays
  correct (any unrecognised `beam` value still means "the player carries it"), but both the title and the
  reason are now false. Retitle it around what it actually guards — that `?beam` never turns enemies on by
  accident, because the enemy half has **its own param** — and point at `?lancer`.

**`client/src/sim-core/lancer-config.test.js`** (new):
- `withLancersAt` on a real Level-4-shaped descriptor swaps `wave-1`'s pool to 100 % `pirate lancer` and
  clamps `maxConcurrent` 5 → 2;
- **it leaves `spawn.total` and `advanceWhen` byte-identical** — the §2g trap, asserted directly, with the
  `level-runner.js:270` / `enemy_total.js` reasoning in the test's comment;
- it does **not mutate** the input (the caller's phases array and phase objects are untouched — the
  `withAllyAt` trap);
- an unknown phase name, and a phase with no `spawn`, return the SAME object.
- Plus the three `boundary.test.js` guard cases the new `sim-core` module generates automatically.

**`client/src/sim-core/beam.test.js`** (extend — it already drives the hostile path with `side: 'enemy'`):
- a `beamCharge` emitted by an enemy carries **`ship` === the shooter entity** and `fromPlayer === false`;
- a lancer built from the real catalog (`createSimWorld`, as `:459` and `:502` already do) puts weapon 13 in a
  **single-mount** group whose `reload` is **0.5** (§3 item 7), and its corridor reaches **67**, not 100 —
  the two-ships-differently-tuned regression guard, now with two real rows instead of one synthetic.

**`client/src/netsim-world.test.js`** (extend):
- a wire `beamCharge` carrying `shipId` hydrates to **`ev.ship === world.enemies[i]`**, the ghost that id
  names (mirroring the existing `enemyShieldHit` test at `:231` and the beam `from`/`to` test at `:235`);
- an unknown `shipId` hydrates to `null` rather than throwing;
- `enemyShieldHit` still hydrates exactly as before (the generalisation is behaviour-preserving).

**`server/src/netsim/room.test.js`** (extend) — **the room-level half of the gate**:
- run a room on a descriptor carrying lancers, step past `ENEMY_FIRE_GRACE`, and assert a `beamCharge`
  appears in the room's pending events **with a `shipId`** that matches the `id` the same room `describe`d
  for that enemy — i.e. the id resolves to a ghost on the client side;
- assert the wire event carries **no entity graph** (`!JSON.stringify(w).includes('hitBoxes')`), the guard
  that already exists for `enemyShieldHit` at `:133`;
- the catalogue-parse test at `:122` must still pass with the amended `beamCharge` line;
- **`:155`'s assertion message is now false and must be rewritten**: *"beamFire carries NO entity reference —
  the hostile sight is deferred"*. `beamFire` still carries none, and that is still correct (§3 item 4: the
  entry ends on its own `dur`), but the REASON is no longer "deferred". Say instead that the ref rides on
  `beamCharge` alone, because a sight that knows when a charge STARTED and how long it lasts needs nothing
  from the release. The existing `wireEvent` `beamCharge` test at `:158-163` still passes with the new ref
  and needs no change beyond asserting the id when one is supplied.

**`server/src/catalog_beam.test.js`** — rewrite `:67` as described in S1; leave `:50`, `:70` and `:88` intact.

**`server/src/server.test.js`** — `:397` → 10 ships, `:521` → 13 weapons.

**`client/visual/scenarios/40-enemy-beam.mjs`** (new) — the local half of the gate. Modelled on
`39-charge-beam.mjs`; **assert on GEOMETRY and COLOUR, never on `visible === true`** (brief §0e: a beam with
an undefined width renders as nothing while `visible` stays true — this actually happened on this weapon):

1. boot `${baseURL}&lancer&level=4`; wait out the level-warm veil as `39` does at `:37-41`;
2. assert **a lancer is in the fight** and carries weapon 13 in a single-mount `gun` group whose weapon has
   `maxRange === 67` (the ship really is beam-armed, and with the WEAKENED row);
3. **nothing charging ⇒ no hostile sight**: with the enemy freshly spawned, every `beamHostileSight*` object
   is hidden. (Take this reading BEFORE step 4 — it is the "charge-only" half of the rule.)
4. park the lancer ~25 u dead ahead of the player, clear `warping` (`e.warping = false;
   e.spawnAge = e.spawnDur; e.scale = e.fullScale`), then step past `ENEMY_FIRE_GRACE` and into a charge —
   `g.stepSim(1)` in a loop of **≥ 400** iterations (5 s of grace at 60 Hz is 300 steps, plus the closing and
   the aim), watching the lancer's own `groups.gun.charge` and stopping the instant it appears. Pin the
   lancer's position each iteration the way `39` pins its target at `:128-132`, so the geometry is
   deterministic rather than a live chase;
5. **the hostile sight is drawn**: `beamHostileSightCentre` visible ×1, `beamHostileSightEdge` visible ×2;
6. **the colour is the hostile hue and is NOT the player's**: every one of the three is `0xff6b4a`, and
   `assert.notEqual(colour, 0x5ad17f)`;
7. **the look is the player's, reproduced**: one colour and one opacity across all three, all three
   `isLineDashedMaterial`, centre `dashSize` > edge `dashSize` (the same three assertions `39` makes at
   `:101-110`, now against the hostile objects);
8. **the lines span muzzle → `maxRange`**: read the three lines' `position` attributes and assert each
   segment's length ≈ **67** (± a couple of units), and that the near end is at the lancer's muzzle
   (`pos + fwd × noseZ × scale`). **This is the assertion that keeps the telegraph readable** (§2c's last
   bullet): from a lancer at its 14–22 u standoff, ~45 u of the corridor runs *past* the player's own ship,
   and that is the half he reads. A sight clipped to the shooter's vicinity fails here.
9. **the sight brightens over the charge** and is brightest LATE (as `39:170-173` does), proving the ramp
   rides the event's `dur`;
10. **the shooter's release clears it**: keep stepping past the discharge and assert every
    `beamHostileSight*` is hidden again, and that a `beamBolt` mesh exists with a finite positive width
    (the discharge is drawn whoever fired it);
11. **the player took the lancer's damage, not the player weapon's**: the hostile path routes through the
    shield first (§76), so assert the **combined** loss (`_shieldValue` + `hp`) is **45** — with the Base
    shield's 20 capacity that is 20 absorbed + 25 hull — and explicitly **not 80**. Zero the player's shield
    first if a partial recharge makes the arithmetic ambiguous;
12. `shot('hostile-charging')` on the charging frame and `shot('hostile-discharge')`.

**`client/visual/scenarios/41-enemy-beam-netsim.mjs`** (new) — **the room half of the gate, and the reason
the gate exists.** The visual runner already starts a real server on an isolated port with a throwaway
`spacegame_test` database (`client/visual/run.mjs:60-66`), so a room is reachable headlessly.
`37-netsim.mjs` is the precedent, including its `SLOW = 60000` timeouts and its note that a scenario driven
by a room **cannot step the simulation** — the room advances on its own 60 Hz wall clock, which is exactly
what makes this test possible at 2 fps under suite load.

**TWO THINGS THIS SCENARIO MUST HANDLE, AND BOTH SANK AN EARLIER DRAFT OF IT.**

- **The supply of telegraphs is FINITE, and small.** An idle player in the room takes 45 from each of two
  lancers every 1.5 s against a default 100 HP hull + 20 shield — and the instant `!player.alive`,
  `stepEnemyAI` cuts the engines and **holds all fire** (`client/src/sim-core/step-enemies.js:73-78`), so
  charges stop *entirely*. That is roughly **three 1.0 s windows**, arriving ~6–10 s after the room starts
  (spawn + close + `ENEMY_FIRE_GRACE`). The scenario **cannot step the sim** — the room owns the clock — and
  `37-netsim.mjs` documents the client dropping to ~2 fps under full-suite load.
- **A hidden line keeps its geometry.** `setLine` leaves `position`, `lineDistance` and the material colour
  intact when a line is later hidden, so any assertion read in a *separate* `page.evaluate` after the window
  closed would pass off a **stale buffer with nothing on screen** — the "assert on geometry, not on
  `visible`" rule failing in the other direction.

So:

1. boot `${baseURL}&netsim=level-4&lancer&level=4`; wait for `window.__netsim.connected` and for the room's
   first enemies to appear with real bodies (as `37` does). **Send no input at all** and start polling
   immediately, so the tab is already watching before the first charge can happen.
2. **the room is running the lancers** — the ghosts' `name === 'pirate lancer'`, proving the handshake param
   reached `createSimWorld`;
3. **ONE polled read that both waits and measures.** `page.waitForFunction(fn, null, { polling: 100, timeout:
   SLOW })` — an explicit 100 ms timer, **not** the default `raf` polling, so sampling is independent of a
   2 fps render loop while a visible 1.0 s window still spans ~10 samples. The polled function returns
   `null` until a `beamHostileSightCentre` is **visible**, and on the frame it is, it returns the whole
   reading **captured then and there**: the three lines' `material.color.getHex()` and `material.opacity`,
   their `isLineDashedMaterial`/`dashSize`, both endpoints of each line from the `position` attribute, the
   shooter ghost's `pos`/`heading`/`noseZ`/`scale`, and `world.player.alive`. Assert on the returned object.
   **This single wait is the gate's proof**: the room's `beamCharge` crossed the wire, `hydrateEvent`
   resolved its `shipId` to a ghost, and the renderer drew a corridor for a shooter **this tab never
   simulated**.
4. assert on that captured reading: hue `0xff6b4a` and **not** `0x5ad17f`; one colour and one opacity across
   all three; all three dashed with centre `dashSize` > edge; each segment ≈ **67** long and starting at the
   ghost's muzzle (`40` steps 6–8, off the ghost's interpolated pose).
5. **Fail loudly on the race rather than mysteriously.** If the wait times out, read `world.player.alive` and
   the ghost count and put them in the failure message — *"the room killed the idle player before a telegraph
   was captured; enemies hold fire once the player is dead (step-enemies.js:73-78)"*. A bare timeout here
   would be read as "the wire is broken", which is the opposite of what happened. If this proves flaky in
   practice, the cheap lever is a **shorter run to the first charge**, not a longer timeout — park the tab's
   camera and let the room's own first wave close.
6. `shot('room-hostile-charging')` — taken immediately after the wait resolves. It is a *nice-to-have*: the
   verdict rests on the captured reading, not on the frame, because at 2 fps the shutter may open after the
   window shut.

### S10 — the determinism gates: capture the baseline FIRST

```
cd client && node visual/run.mjs 22-intro-replay    # READ THE LOG: it PRINTS tick=…, it does not assert it
cd client && node visual/run.mjs 36-sim-divergence  # hash=0x2a36f8d9, draws=38
```

Run **both before touching anything** and keep the numbers. Expected after: **identical** —
`22-intro-replay` **tick=2474**, `36-sim-divergence` **hash=0x2a36f8d9 with 38 draws**.

Why they hold **by construction**, to be verified rather than assumed:
- **no existing ship row changes**, and the lancer is in no level's pool, so no recorded fight can contain
  one;
- the beam path **takes no reload jitter** — `updateGroups` `continue`s at
  `client/src/sim-core/ship-entity.js:243` **before** the `side === 'enemy' ? simRandom() * 0.5 : 0` draw at
  `:252`. So even a lancer that did spawn would add no draw to the seeded stream (§73). Keep that true.
- `sim-core/beam.js` never calls `simRandom()`;
- adding a field to an event object touches neither the world digest nor the draw count.

**§134's enemy-aim retrofit is CANCELLED and stays cancelled.** Corrections are opt-in per ship, never a
change to the shared firing path. A hitscan has no projectile velocity to inherit, so the beam sidesteps the
flaw by construction — **do not "fix" anything in `sim-core/spawn.js`.**

### S11 — the concept sweep (run it, do not assume)

Before finishing, grep for prose that this change makes FALSE — the concept words, not just the symbols:

```
grep -rn "no ship carries a beam\|NO SHIP IN THE GAME CARRIES A BEAM" docs client server
grep -rn "deferred" docs/SUMMARY.md | grep -i beam
grep -rniE "enemy beam|hostile sight|hostile corridor" docs client server .claude 2>/dev/null
grep -rn "NO ENEMY HALF\|beam=enemy" client server docs
grep -rn "±32\|32 u horizontally\|portrait" docs/plans docs/DECISIONS.md   # the frame that does not exist
```

Every hit is either updated or is a historical CHANGELOG/DECISIONS line that must stay (CHANGELOG is
append-only; §135 is amended in place, see §11).

### S12 — ship it

1. `cd client && npm test` — expect **+~12** (lancer-config + its 3 boundary guards, the `?lancer` flag
   cases, the beam + netsim-world additions).
2. `cd server && npm test` — expect **+~4 new** cases (the muzzle case for the new ship, the second beam
   row's two `catalog_beam` cases, the room event test) **and four EDITED assertions inside existing tests**
   (`server.test.js:394`, `:396-400`, `:418`, `:519` — see S1), which move no count. Needs a local
   Postgres — `npm test` drops and recreates `spacegame_test`.
3. `node visual/run.mjs 40-enemy-beam`, `41-enemy-beam-netsim`, `39-charge-beam`, `37-netsim`,
   `22-intro-replay`, `36-sim-divergence`. **One argument each** — the full suite does not finish on this
   machine, and it has a flaky baseline (~6 scenarios fail at baseline): judge by the reliably-passing set
   and zero page errors.
4. Docs (§11), then deploy, then **live-test — and the room test is not optional**:
   - local, `?lancer&level=4`: three red lines snap out of a lancer and brighten for a second; the bolt runs
     down the middle; the lines are gone the instant it fires and while it reloads;
   - local, `?beam&lancer&level=4`: green sight vs red sight, and they are never confused;
   - **`?netsim=level-4&lancer&level=4` on the deployed build** — the remote-shooter path is the entire point
     and a local single-player test is necessary but **not sufficient** evidence that the gate is met;
   - **on a phone, test the VERTICAL axis** — that is §2c's binding constraint, and it is the one the frame
     arithmetic rests on. (Held in portrait the phone renders *landscape*, DECISIONS §26, so the horizontal
     axis is the widest in the game and proves nothing.) Fly so a lancer engages from **directly above or
     below** the player and confirm both its hull and the near end of its corridor are on frame when the
     charge starts.
5. **No itch re-publish is needed** — no content hash moves (no new `.glb`, no new sound, no new trace).
   Say so explicitly at the review gate so nobody wonders.

---

## 5. Replay / intro impact

**The recorded archive is untouched, and here is the check rather than the claim.** `client/src/replay.js`'s
consumers — the Level-0 intro cutscene on the `level-1` descriptor, and any `?playback` trace — re-run the
real `sim.update()`, and only `G.replayMode` gates progress-advance, **not** the damage path. So a change to
damage, collision, movement or gameplay RNG genuinely changes what a recorded trace produces.

This change touches **none of them**:

- no existing weapon row, ship row, level pool or AI number changes;
- the lancer exists in no level's `spawn.pool`, so **no archived trace can contain one** — every recorded
  fight resolves exactly the ships it always did;
- the only sim-side edit is **one extra field on an event object** (`ship` on `beamCharge`), which is emitted
  only by a beam group. No archived trace mounts a beam at all, so the emit never runs in one;
- everything in `beam-fx.js` is cosmetic and RNG-free (§73), including the new hostile pool.

**Required check anyway, per the standing rule:** run `node visual/run.mjs 22-intro-replay` and **read the
log for tick=2474** (it prints, it does not assert), before and after. If it moves, stop.

---

## 6. Docs to update — checklist (CLAUDE.md: part of the change, not an afterthought)

**`docs/DECISIONS.md` §135 — AMENDED IN PLACE.**
- The gate paragraph (the block-quote at `:5185-5189`) now reads as **satisfied**: keep the quoted rule
  verbatim as the rationale, and follow it with what was built to meet it — the pooled hostile sight in
  `beam-fx.js`, and `beamCharge`'s shooter ref. Do not delete the gate; a rule that was met still explains
  why the thing exists.
- The two "input to future work" bullets (`:5194-5205`) become **shipped decisions**: `ai.range` 50 /
  `aimTol` 0.12 with the frame arithmetic that chose them and the note that `ai.range` is not the fighting
  distance; and "a beam must never share a fire group" → the lancer is a **new single-mount ship**, not a
  weapon swapped onto an existing pirate.
- **CORRECT THE FRAME CLAIM AT `:5197-5200` — do not carry it forward.** §135 currently justifies a short
  hostile `ai.range` with *"only ±32 u horizontally on a phone in portrait"*. **That frame does not exist:** a
  touch device held in portrait renders LANDSCAPE (`engine.js:69` + `body.rot`, DECISIONS §26), giving the
  *widest* frame in the game (~±124 u). Replace it with the true, and stronger, reason: **the binding axis is
  the vertical ±57 u, identical on every device, and `ai.range` 50 sits inside it** — see §2c.
- Add: the lancer's numbers (45 / 67, charge and cooldown unchanged) with **the maintainer's acceptance of
  30 sustained DPS and a 45-damage single hit recorded as deliberate**; the telegraph is the player's sight
  in `#ff6b4a` and **charge-only**, changed in nothing else that was *chosen* (muzzle bead / reticle /
  brighter ramp all proposed and declined — smallest thing first, judged in flight), with the **static
  dashes** noted as a known deferral rather than a third design difference; the hostile charge stays
  **silent**; the corridor is drawn to the **full `maxRange`, never clipped**, because the half of it the
  player reads is the half past his own ship.
- **Record that the lancer practically never misses as an ACCEPTED first-pass property** — maintainer,
  2026-08-25, after being shown the measurement: *"for now we leave everything as it is, let them not miss"*
  — with the lowering of its turn rate deferred to the ROADMAP. A reader who finds this in six months must
  see a decision, not an unnoticed bug.
- **Record the MEASURED reachability from §2a, and nothing softer:** the lancer turns at 2.58 rad/s against a
  player's maximum 1.67 rad/s of bearing sweep at the standoff, so **the corridor holds through the charge**
  and 45 lands about every 1.5 s — three hits in ~4 s against a default hull, with two lancers on screen
  under `?lancer`. **Do NOT write "a moving player escapes most charges"** into §135 or SUMMARY: an earlier
  draft of this plan claimed it off a turn rate that was wrong by ~7×, and it is retracted (§2a). The
  counter-play is the telegraph, not out-turning it.
- Update the sentence at `:5179-5180` — *"no ship in the game carries one"* — it is now false.

**`docs/DECISIONS.md` §136 (new) — "the wire's entity-ref table has one home, in `sim-core`."** The real
trade-off: the client cannot import `server/`, so the choice was a second hardcoded rehydration line on the
client (what existed) versus moving the table into host-neutral `sim-core/events.js` and having the server's
`protocol.js` import it. Record that a ref is *identity, not a value* — the one exception to "events carry
copied values" — and that one table read by both ends is what stops the third ref from being forgotten on the
way back. *(Check §136 is still free at implementation time — parallel sessions collide on section numbers.)*

**`docs/SUMMARY.md`** — bump `**Updated:**`, and:
- the weapons section (`:995`, `:1027-1053`): add **weapon 13**, enemy-only, with its numbers and the reason
  it is a second row rather than a shared one;
- **`:1060-1065` is now FALSE** — "NO SHIP IN THE GAME CARRIES A BEAM: it is a player purchase … no hostile
  aiming corridor is drawn — that work is deferred behind an explicit gate". Rewrite it: the **pirate
  lancer** carries one, the hostile corridor **is** drawn, §135's gate is **met**, and the lancer spawns only
  behind `?lancer` until Level 5;
- the mixed-group paragraph (`:1066-1073`): the lancer is the worked example of the right way to arm one, and
  `catalog_beam.test.js` now asserts exactly one seeded beam group;
- the enemy-types list (`:1074+`): the pirate lancer, its role, HP, reward, and that it reuses the gunner's
  model and is visually identical to one;
- the fire-group preset list: **`BEAM` (range 50, aimTol 0.12)**, with the note that `ai.range` gates only the
  charge start;
- the beam paragraph at `:3203-3216`: `beamCharge` now carries **`ship`**, and what that buys;
- the events/wire paragraph at `:3431-3445`: the ref table's new home and the generalised rehydration;
- the FX paragraph at `:1878-1912` and the module map at `:3700-3706`: `beam-fx.js` also draws a **pooled
  hostile sight** (`beamHostileSight*`, `#ff6b4a`, charge-only), and `beam-dev.js` also owns **`?lancer`**;
- the new `sim-core/lancer-config.js` in the sim-core module list (`:3275`);
- **test counts** (`:3796-3825`) and the visual-scenario list: scenarios **40** and **41**;
- one line recording §3 item 11 (a looted lancer beam would be equippable — unreachable today, a real
  question the day Level 5 fields lancers);
- **NEW, and NOT about the lancer — a plain fact of the drive model that is nowhere in the docs today.**
  Beside the enemy-AI / drive-derivation material (the `deriveDrive` + `stepEnemyAI` area around `:3196`),
  add one or two sentences of current state: because `turnRate = thruster.power × REFERENCE_MASS / mass`
  (`sim-core/components.js:30-36`), **every light pirate out-turns the player** — the basic pirate is
  **3.81 rad/s ≈ 218°/s** (mass 21) and the pirate gunner **3.20 rad/s ≈ 183°/s** (mass 25), against the
  player's **2.0 rad/s ≈ 115°/s** at his starter mass of 50 (≈103°/s carrying the Charged beam at mass 56).
  What the player wins is not agility but **speed** — `PLAYER_MAX_SPEED` 30 against their 10.5–15.75 — and
  the fact matters because turn rate is what decides whether an *enemy* can hold a target inside a beam
  corridor. **This is NOT a DECISIONS entry** (no trade-off was made; it is simply true), and it is worth
  writing down precisely because the first draft of this very plan got it wrong by ~7×.

**`docs/CHANGELOG.md`** — one bullet under today's date (append-only, newest on top), leading with a bold
summary phrase: enemies can now carry the charged beam; the pirate lancer; the red charge-only telegraph
including for a shooter the tab never simulates; §135's gate met; `?lancer`. Say plainly that the lancer
**rarely misses** and that this is the maintainer's call for the first pass, with the turn rate on the
ROADMAP to be lowered — the changelog is where someone looks to find out whether a thing was intended.

**Both charge-beam plan files get a status pointer:**
- `docs/plans/charge-beam-weapon.md` §0a-ter — the scope cut is **CLOSED**, pointing here;
- `docs/plans/2026-08-25-1056-charge-beam-weapon.md` §2d — the deferral is **CLOSED**, pointing here, and
  noting the one place its wire shape was superseded (no `range`/`corridorDeg` on the event — the ghost
  already carries the weapon row).

**The "±32 u portrait frame" is stale in TWO MORE BRIEFS, and leaving it is how it gets re-derived wrong
next time.** Add a one-line correction, in place, beside each — not a rewrite of their arguments, whose
conclusions all survive on the vertical axis:
- `docs/plans/charge-beam-weapon.md:147-148` and `:505`;
- `docs/plans/combat-ally.md:180-182` (the §2c(a) framing constraint every other brief cites, including this
  one's own source).
Each correction says: a touch device held in portrait renders **landscape** (`engine.js:69` + `body.rot`,
DECISIONS §26), so the narrow-portrait frame does not exist; **the binding axis is the vertical ±57 u on
every device**, and every conclusion drawn from "keep the enemy on frame" still holds against that.

**`docs/ROADMAP.md`** — two edits.

*(a)* Under the Level 5 bullet (`:136-142`): the enemy beam gate (§135) is **passed**, the weapon and a
carrier exist, and Level 5 can field lancers by naming `pirate lancer` in a phase pool. The `§134` follow-up
at `:145` is unaffected and stays as written.

*(b)* **Open a new block, `### Follow-ups opened by the enemy charged beam (2026-08-25)`, in the shape of the
ally's block at `:143`** ("Follow-ups opened by the ally (2026-08-23)"), directly after it. Two entries, and
the first must carry enough arithmetic that nobody re-derives it:

- **[ ] Lower the pirate lancer's TURN RATE so its beam becomes genuinely escapable.** The corridor design
  assumes a target can leave the ±2° wedge during the charge; measured **2026-08-25**, it cannot.
  `turnRate = thruster.power × REFERENCE_MASS / mass` (`client/src/sim-core/components.js:12,30-36`), and the
  lancer's mass is 31 (hull 10 + engine 6 + thrusters 3 + **beam 12**) → **2.58 rad/s ≈ 148°/s**. The
  player's *best* bearing sweep at the AI's 14–22 u standoff is `PLAYER_MAX_SPEED` 30 / 18 u = 1.67 rad/s ≈
  **96°/s** (`sim-core/step-player.js:29`, `steering.js:43`), `steerToward` clamps the nose to within ~1.6° of
  the target every tick (`steering.js:21-24`, `step-enemies.js:90-92`), and the corridor is ±2° — **so the
  shot lands every cycle.**
  **The lever is MASS, not a new stat** (`deriveDrive` derives turn from it), and the numbers are:
  mass 31 → 148°/s · mass 50 → 92°/s · mass 70 → **65°/s**. Escape needs the lancer's turn rate *below the
  player's ~96°/s bearing sweep*, so it only starts to work below ~mass 48 of extra ballast and only gets
  comfortable around **mass 70**. **The cost:** `deriveDrive` scales acceleration by the same factor
  (30.6 at mass 31 → 13.6 at mass 70), so a heavier lancer closes and repositions markedly worse — the fix is
  a real trade, not a free dial. *(For reference: the player at mass 50 turns 2.0 rad/s ≈ 115°/s, and 103°/s
  carrying the beam at mass 56.)*
  **Status: deliberately deferred by the maintainer, 2026-08-25** — *"for now we leave everything as it is,
  let them not miss"* for the first pass. Revisit after flying it.
- **[ ] The hostile sight's dashes do not FLOW** (they show the right pattern, static). `dashPhase` is
  advanced only inside the player's pass, which returns early for a player with no beam
  (`client/src/beam-fx.js:213`). **One line moved** fixes it — advance `dashPhase` in `drawBeamSight` before
  either pass — but it changes the player's own sight timing too, so the maintainer left it for the same
  live-tuning pass. **These two are the pair to pick up together when the lancer is next flown.**

---

## 7. Out of scope / non-goals (DECISIONS §30 — do not gold-plate)

- **Any change to the player's beam** (id 12) — numbers, colour, sight, price, gate, audio.
- **Any change to a shipped level's spawn pool.** The lancer is dev-flag-only. Wiring it into Level 4 would
  move `enemyTotal` and break recorded traces; Level 5 is where it lands for real.
- **Rebalancing 45 / 67.** Still settled. (The COOLDOWN and the TURN RATE were retuned on 2026-08-25 after
  the maintainer flew the build — see the §2a banner. Damage and reach were not.)
- **Any addition to the telegraph** — muzzle bead, reticle, a marker on the player's ship, a distinct dash
  rhythm, a brighter ramp, a HUD warning, an off-screen arrow. All declined (§2d).
- **Making the hostile dashes FLOW** (moving `dashPhase` out of the player's pass), and **lowering the
  lancer's turn rate**. Both are real, both are measured, both are written up on the ROADMAP, and both were
  **deferred by the maintainer on 2026-08-25** to the live-tuning pass — *"for now we leave everything as it
  is, let them not miss."* Doing either here would change a look value or a balance number he has said he
  wants to judge in flight first.
- **An audible hostile charge**, and any `SOUND_MAP` exception (§2d).
- **A second entity ref on `beamFire`**, a per-tick charge fraction, a snapshot column, or a digest field
  (§2e).
- **A `side === 'player'` test anywhere in `sim-core`** — the hostile/friendly decision is a RENDERING scope
  call, made in `beam-fx.js` by asking whether the shooter is in `world.enemies`.
- **Touching `sim-core/spawn.js`** or retrofitting enemy aim (§134 is cancelled).
- **A new model, a new sound, a re-tint, or a `CREDITS.md` row** — and therefore **no itch re-publish**.
- **A lil-gui tuning panel.** The look values are baked constants; `lil-gui` must not become a shipped
  import.
- **Enemy-beam AI beyond the existing rule.** The lancer uses `stepEnemyAI` unchanged: it needs no new gate,
  because `dist < ai.range && |diff| < aimTol` starts the charge and the corridor decides the hit.
