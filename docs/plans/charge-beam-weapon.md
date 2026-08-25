# A charged beam weapon

> **Status:** requested 2026-08-23 by the maintainer. **A throwaway SPIKE exists and has been flown**
> (see §0); the production plan is what the pipeline produces next. §0 records what the maintainer settled
> in discussion on 2026-08-23/25 — **those answers are decided, do not re-open or re-ask them.** The rest of
> this file is the original request and is still accurate about the seams and the constraints.

## 0. SETTLED — decisions taken with the maintainer, and the spike that exists

### 0a. The aiming rule (this was §5's question 1, and it is now ANSWERED)

**A CORRIDOR, not a lock and not a bare nose-line.** At RELEASE the beam hits the target it painted at
charge start **if that target is still within ±`corridorDeg` of the ship's nose**; otherwise it fires down
the centre line and hits whatever that crosses. The maintainer chose this over both alternatives, and asked
for **three lines drawn while aiming — centre + both corridor edges** — with a fast crossing target able to
escape.

**The corridor is attached to the NOSE AT RELEASE, not frozen at charge start.** So turning away breaks the
shot (~1 rad/s sweeps ~30° in 0.5 s, against a corridor only ±2° wide) while turning TOWARD the target tracks it and
keeps the hit. Chosen because it keeps the three drawn lines *honest*: they are glued to the hull, rotate
with it, and are literally the hit test rather than an illustration of it. A frozen corridor would have to
either detach from the hull on screen or lie about where the beam will go.

**The corridor's WIDTH is this weapon's lag compensation** — which is why it needs no D5 rewind, and why a
hard lock (zero tolerance) would have re-created exactly the problem the discarded 2026-08-19 spike measured
(14 % of client hit reports rejected at 0 ms, 55 % at 300 ms). The width itself is settled in §0a-bis.

### 0a-bis. THE NUMBERS — settled with the maintainer 2026-08-25. **These supersede the spike's.**

**The spike's numbers were NOT the maintainer's.** Charge time and cooldown came from his original
description; **corridor width, range, damage, weight and price were invented or derived by the assistant
and presented as if settled — they were not.** They have now been discussed and replaced. Anything in this
file or in the spike quoting ±10°, range 40 or damage 45 is STALE; this table wins.

| stat | value | where it comes from |
|---|---|---|
| `chargeTime` | **1.0 s** | maintainer, 2026-08-25 — **raised from 0.5** so the charge sound and animation are clearly heard and seen |
| `cooldown` (`fireCooldown`) | **0.5 s** | the maintainer's original description |
| `corridorDeg` | **±2°** | maintainer, 2026-08-25 |
| `maxRange` | **100** | maintainer, 2026-08-25 — **raised from 90**, i.e. 10 past `GUN_LONG` |
| `power` (damage) | **80** | maintainer, 2026-08-25 |
| `weight` | **12** | plan §2b(1), approved at the review gate — costs ~11 % accel and turn |
| `price` | **5500** | maintainer, 2026-08-25, **reaffirmed after being told it now reads as a trap purchase** |
| `minLevel` | **`FACTORY_GATE`** (`'level-4'`) | maintainer, 2026-08-25, reaffirmed with the price |

**THE CYCLE IS `chargeTime + fireCooldown` = 1.5 s, so the beam is 53 DPS — and that is DELIBERATE.**
Raising the charge to 1.0 s cut sustained damage from 80 DPS to **53**, which is *below the 800-credit
starter gun* (56) and beside Heavy cannon (58 DPS at 2000 cr). Offered the choice of restoring it (zero
cooldown, or damage 120), the maintainer chose to **leave it weaker on purpose**: the beam is bought for the
**instant, no-lead hit at range 100**, not for damage. Told that 5500 cr behind a Level-4 gate would then read
as a trap purchase next to Heavy MG's stat line, he **kept the price and the gate anyway**. Recorded here so
nobody "fixes" it later: the low DPS is the design, not an oversight.

**The maintainer's reasoning, and it answers the trap-purchase objection** (2026-08-25): *"Pure DPS is not
that important. It is compensated by the range and by the aim assist."* This is the justification the price
rests on, and it is a real argument rather than a preference: **nominal DPS assumes every shot lands.** A
kinetic round has travel time and must be LED, so a large share of it misses a manoeuvring target; the beam
has zero flight time and lands on whatever stayed in the corridor. So the beam's *effective* damage against a
moving target is far closer to a kinetic's than 53-vs-56 suggests, and it also reaches 100 u where the
starter gun reaches 88. Any future rebalance must compare EFFECTIVE damage-on-target, not the stat line.

*A terminology note for whoever writes DECISIONS, because the word matters here.* The maintainer calls the
corridor "aim assist", and colloquially that is what it feels like. The recorded rationale must stay precise
anyway: §124 removed a cone that **silently redirected a shot at a target the player never chose**, whereas
this corridor never moves the shot — it is a hit test the player keeps a target inside by TURNING, drawn on
screen for the whole charge. That distinction is the entire §124 reconciliation in §0a; do not let the
shorthand collapse it.

**TWO THINGS THE 1.0 s CHARGE BROKE THAT WERE TUNED TO 0.5 s — check anything else measured against it.**
1. **`RoF` on the shop stat line must be `1 / (chargeTime + fireCooldown)` = `0.67/s`, NOT `1.0/s`.** The
   naive `1 / fireCooldown` would read **2.0/s**, which is a flat lie for a weapon that spends a second
   charging. Any plan text, mock or manual-check string still saying `RoF 1.0/s` is STALE.
2. **Every target drifts twice as far during the charge, so the corridor became much harder to land
   passively.** A 5 u/s crosser drifted 2.5 u at 0.5 s and stayed inside the ~2.66 u effective window at
   close range; at 1.0 s it drifts 5.0 u and **escapes**. A top-speed crosser ends ~40° off the nose at 20 u.
   Accepted: it makes ACTIVE tracking with A/D mandatory rather than optional, which is the skill the design
   is about — and the player still out-turns everything (57°/s against a target's ~10°/s at range).

**Why range 40 was wrong, recorded because the mistake is instructive.** It was derived from the camera
frame and from its own dodgeability, and never once measured against **what the enemies shoot at** — the
neighbouring system that decides whether the weapon is usable. Every enemy type outranges 40: basic pirate
`GUN` 45, every rocketeer/boss `ROCKET` 80, and gunner / advanced medium / second boss / advanced rocket
pirate `GUN_LONG` **90**. Enemies also **spawn at 70–130** from the arena centre, i.e. outside a 40 u beam
on arrival. Since the beam **replaces the primary gun**, a 40 u version meant flying through ~50 u of
unanswered fire to reach anything.

**TWO CONSEQUENCES OF ±2° THAT THE PLAN MUST HANDLE.**

1. **The corridor test MUST become hull-aware — this is a correctness requirement, not a preference.** The
   spike PAINTS with `segmentHitsShip` (the real hull, so clipping a wingtip marks the target) but tests the
   corridor against the hull **CENTRE**. At ±10° the gap was invisible; at ±2° it inverts, because a ±2°
   corridor is *narrower than a ship* at most ranges — half-width 0.70 u at 20 u, 1.57 u at 45 u, 2.10 u at
   60 u, 3.14 u at 90 u, against a hull roughly 2 u across. Inside ~60 u the spike would **paint a ship it
   cannot hit**: the reticle lights and the shot misses, which breaks the single promise the three lines
   make. Fix: a target is hittable when **any part of it** lies between the two drawn lines — which is also
   exactly what a player reads off the screen.
2. **Lag tolerance gets thin, and the hull-aware test is what rescues it.** At 90 u, §127's 100 ms
   interpolation delay makes a top-speed crosser 1.6 u stale = **1.0°**. A bare ±2° is only 2× that — thin
   for a server-run room. With the hull-aware test the effective window is ~3.3°, which is acceptable.
   Record this as a reason the hull-aware form matters for multiplayer, not only for honesty.

**Checked in both directions at the settled numbers:** a top-speed crosser travels 7.9 u during the charge =
**5.0°** at 90 u, so it still escapes ±2° comfortably (the maintainer's "if the target moves fast across, you
miss" holds). And the player turns at ~57°/s against a target's ~10°/s angular rate at 90 u, so **tracking by
holding A/D still works easily** and turn rate remains the beam's skill stat.

### 0a-ter. SCOPE CUT — the ENEMY beam is OUT until the maintainer asks (2026-08-25)

**Maintainer, 2026-08-25: "Don't waste time for enemy beam before I asked."** This cut lands AFTER the plan
was first written, so anything below (or in the first draft of
`docs/plans/2026-08-25-1056-charge-beam-weapon.md`) that builds the enemy experience is superseded.

**This cuts deliberate ENEMY-FACING WORK. It does NOT cut the architecture.** "Any weapon on any ship" stays
exactly as it is, because it costs nothing: the weapon is a `WEAPONS` row and the charge/corridor/hitscan
lives behind the one side-agnostic `updateGroups` branch, so an enemy, an ally and the player all go down
the *same* code path. Nothing may be special-cased to the player, and no `side === 'player'` shortcut may be
introduced — that would be the one change that makes arming pirates later expensive.

**IN — build it:**
- the `WEAPONS` row with its own per-weapon numbers (the `beamTuning` shortcut still dies);
- `sim-core/beam.js` — charge state machine, hull-aware corridor, hitscan resolve, **side-agnostic**;
- the `updateGroups` branch;
- the PLAYER's sight (three lines + reticle), the player's audio, and the `beamCharge`/`beamFire` events
  needed for the player's own beam in a netsim room;
- shop slot, stat line, i18n, price, gate, CREDITS row, DECISIONS, SUMMARY, CHANGELOG, tests, both
  determinism gates.

**OUT — do not build, do not tune, do not test:**
- the enemy `BEAM` AI preset and its numbers (the plan's `ai.range` 50 / `aimTol` 0.12) — **do not add a
  beam group or a BEAM preset to any enemy ship**, and do not tune an engagement range nobody uses;
- drawing an ENEMY's corridor/sight while it charges, and generalising `beam-fx.js` beyond the player;
- the `beamCharge` **entity-ref wire change** — its only purpose was letting a client draw a *remote*
  shooter's corridor. Keep the two events; drop the ref until there is a remote shooter to draw;
- making an enemy's charge audible as an exception to the "only your own shots are audible" rule;
- arming enemies in the visual scenario (the spike's `?beam=enemy` half).

**THE GATE THIS CREATES — write it into the plan and into DECISIONS so it is not lost.** An enemy beam is a
0.5 s unanswerable hit unless its telegraph is on screen. **Before any enemy is ever armed with one, the
enemy-sight rendering AND the wire entity ref must be built first** — an aiming line the player never sees
is not a warning, it is an unfair attack. Recording this is the whole reason the cut is safe to take now.
The §6 framing constraint and the separate-`ai.range` argument below are preserved as INPUT TO THAT FUTURE
WORK, not as work to do now.

**AN OPEN ITEM DEFERRED WITH THE ENEMY BEAM — the enemy's engagement range is a SEPARATE number from the weapon's reach.**
A fire group's `ai.range` (the preset) and the weapon's `maxRange` are independent — `GUN_LONG` already
pairs `ai.range` 90 with weapon 9's own `maxRange` 90, but they need not match. Range 90 on the PLAYER's
beam is fine; range 90 on an ENEMY's beam means it can charge you **from off-screen on a portrait phone**
(the frame is only ±32 u wide), which is precisely the failure `combat-ally.md` §2c(a) names — and an aiming
line you never see is not a warning. **Propose a shorter enemy `ai.range` (≈45–55) so the telegraph is
always on screen, and surface it at the review gate.**

**How this reconciles with §124 (auto-aim was removed on purpose) — write this into DECISIONS.** A corridor
*without* a lock **is** the deleted aim-assist cone, verbatim. Three things make this not that, and all
three are visible to the player: the target is **named at charge start** (not chosen at the instant of
fire), the **reticle shows which one**, and the **corridor is drawn for the whole 0.5 s** so the player
watches a target leave it. §124's actual complaint was *"the player cannot see it working or not working"*;
here, seeing it work is the mechanic. It is also the reason the weapon survives PvP, where a lock on another
human reads as an aimbot unless it is visibly escapable.

### 0e. THE LOOK — settled at the spike, 2026-08-25. **This weapon is a look-and-feel feature first.**

Maintainer, 2026-08-25: *"this feature is more about Look and Feel, it must be beautiful and sound good."*
The mechanic was already settled; these came out of flying it, and the production build must REPRODUCE them —
the spike is throwaway, so anything not written here is lost.

**The sight is GREEN; the shot is CYAN-WHITE.** They originally shared one blue, so the aiming aid competed
with the discharge it exists to predict. Splitting the hues means a half second of green build-up hands over
to a cyan-white flash and the SHOT is what the eye lands on — the sight can sit on screen permanently without
ever stealing the moment it announces. Sight `#5ad17f`; bolt / muzzle orb / impact bloom stay `0xbfefff`.

**All three lines carry the SAME weight, and the centre is distinguished by DASH RHYTHM, not brightness.**
The centre first read as "too thick" while the edges read correctly — but every WebGL line is 1 px
(`linewidth` is ignored on essentially every platform), so what read as thickness was a brighter colour and
a higher opacity. The centre came down to meet the edges rather than the edges going up. The centre now runs
LONG strokes (dash 2.4 / gap 1.6) against the edges' SHORT ticks (0.7 / 1.5) — rhythm distinguishes without
adding visual mass. Idle opacity 0.22 for all three, rising by 0.38 as the charge completes.

**The dashes are the charge animation.** They drift outward slowly while aiming (3 u/s) and RUSH as the shot
fills (up to 40 u/s), so the half second has direction and rhythm rather than only a brightness ramp. Driven
by writing the `lineDistance` attribute directly — `computeLineDistances()` restarts the pattern at 0 every
frame and freezes the flow.

**Three more beats, all cosmetic and RNG-free (so replay-neutral, §73):**
- a bead of light gathers at the MUZZLE and blooms as the charge fills (eased `k²`, so the last third is
  where it visibly swells);
- the reticle is a DIAMOND, not a circle — it reads as a targeting mark rather than a halo — and it tightens
  onto the target and spins up as the charge completes;
- **the discharge is QUAD GEOMETRY, not a line, and it trails for a full second** (maintainer, 2026-08-25).
  A WebGL line is 1 px wide whatever `linewidth` says — it is ignored on essentially every platform — so a
  *thicker* beam is impossible as a line and the bolt had to become geometry: two additive quads, a
  white-hot **core** inside a wider **glow**, spanned muzzle→impact. Widths are WORLD units so the beam keeps
  its thickness as the camera zooms: core **0.3**, glow **1.0** (both thinned by a third from the first
  pass). The fade is **1.0 s**, split so it reads as a strike rather than a dissolve — the glow decays on
  `a²` across the whole second (linear read as a cut), while the core burns out inside the first quarter
  (`max(0, (a−0.75)/0.25)`) so only the trail lingers. The impact bloom is unchanged.

**A TESTING RULE THIS PRODUCED, worth more than the values.** The first implementation of the quad bolt
shipped INVISIBLE: a patch silently failed to apply, `boltGlowWidth` stayed `undefined`, the quads were
scaled by `undefined` — and `visible === true` still held, so a visibility assertion passed on a beam that
rendered as nothing. Assert on the GEOMETRY (is it a mesh, is the width finite and positive, is the core
narrower than the glow, does it span muzzle→target), never on visibility alone. Two more traps in capturing
the frame: the hot core is gone within ~0.25 s so a screenshot taken even slightly late shows only the soft
trail, and at 80 damage the target is one-shot so the kill explosion covers the very thing the frame exists
to show — step one tick at a time, stop the instant the charge completes, and give the target enough HP to
survive.

**The charge FX is driven by the `beamCharge` EVENT, not by reading the fire group.** In a netsim room the
local World's group is never ticked (the ship keeps its `groups`, but nothing advances `g.charge`), so the
event is the only thing that arrives. Locally the two agree tick-for-tick. The event carries `dur`, so the
animation always fills exactly the window the weapon actually charges for.

**AUDIO — FINAL (maintainer, 2026-08-25).** The charge is the maintainer's own cut: three pieces of the
source concatenated to **1.400 s** — a quiet opening burst (0.600–1.100, −9 dB), a **tapered-lift** build
(2.750–3.250, +19 dB easing to +4 dB) and a tail that deliberately runs PAST the shot (3.250–3.650, natural).
Three details are load-bearing and each fixed a real defect: **`BEAM_CHARGE_CLIP_SEC` is the 1.0 s LEAD, not
the 1.4 s file** (only the first second is the charge; filling the window with the whole file speeds it up
40 % and drags the crack in front of the shot); the second piece starts at **2.750, not 2.800**, so the
source's own crack lands exactly on the discharge rather than 50 ms early, which is precisely the interval
that reads as a *flam*; and the lift is **tapered, not flat**, because a flat +15 dB made the build as loud
as the crack (both −9 dB) and the shot stopped being the payoff of its own build-up.

The discharge is EQ'd lower and darker: `asetrate 0.82 + atempo 1.2195`, a −11 dB dip at 3.5 kHz (2 octaves
wide), −6 dB high shelf at 6 kHz, low-pass 9 kHz. **Record why, because it is counter-intuitive:**
pitch-shifting alone barely touches the harsh region — measured per band, 2–5 kHz went 45.7 → 45.6 dB at
0.80× and only → 44.0 at 0.70×, because a pitch shift slides higher content down to refill that band. The EQ
is what removes the shrillness: the shipped chain takes 2–5 kHz down **~10 dB** while leaving the bass
intact (64.3 → 64.9 dB). Still no `loudnorm` anywhere.

*Superseded, kept only so the reasoning is not re-derived:* the earlier
`assets-src/sounds/843729__tannersound__scifi-laser-gun-shooting.wav`: **charge = 2.860→3.250 s** (the build)
and **crack = 3.250→3.750 s** (discharge + decay tail). Shipped in the spike as `beamCharge.c051b19f.mp3` and
`beamFire.27ebb60a.mp3`, routed by a new `class: 'beam'` with a NEW `'charge'` event in `SOUND_MAP`
(`sound_map.event` is a free-text column, so a new event name is legal).
**The charge is played at `rate = 0.39 / chargeTime`** so it stretches to fill the window exactly — retuning
`chargeTime` can never desync the bang from the shot. An EXPLICIT rate is passed for both, which also skips
the random pitch jitter `audio.sfx.shoot` applies by default: a timing cue must sound identical every time.

**Every look value above is exposed on the `?beam` lil-gui panel** (colour picker, four opacities, both dash
rhythms, both flow speeds) because a look-and-feel feature can only be settled in flight. The values recorded
here are the ones to bake into the production build unless the maintainer reports better ones.

### 0b. The other §5 questions, as answered by the spike

- **Q2 (what breaks a charge, on every device):** **nothing does — the trigger is a TAP THAT COMMITS.**
  Releasing fire mid-charge still discharges; damage does not interrupt; a target dying mid-charge just
  drops the lock and the shot goes down the centre line. Reasons: touch has a fire *button*, not a held key,
  so "keep holding" is not expressible on every device (a rule that only exists on desktop is not a rule);
  an AI's `wantsFire` flickers as it steers; and it means there is no "charge spoiled" state to invent, put
  on the wire, or reconcile between hosts. **The corridor test at release IS the rule.**
- **Q3 (what an ENEMY carrying it does):** the same rule, unchanged. An enemy's steering tracks the player
  during its charge — but the player can do the identical thing by holding A/D, and **out-turns every enemy
  in the game** (player ~2–3× a medium's ~0.35 rad/s, and 30 u/s against their 10.5–15.75). **Turn rate
  becomes the beam's skill stat,** which the Mobility skill already buys. The AI needs no new gate: the
  existing `dist < g.ai.range && |diff| < g.ai.aimTol` starts the charge and the corridor decides the hit.
- **Q4 (hitscan or travelling):** **hitscan**, resolved at release. It cannot be shot down. Attribution
  follows §134 unchanged — `lastHitBy = 'ally' | 'player'` for credit/XP, the friendly/hostile split for
  damage routing, and the hostile path reuses `resolveHostileBulletHit` so the shield catches it on the
  bubble (§76). **Note this dissolves §134's enemy-aim flaw for this weapon at no cost:** the flaw is
  *bullets inheriting shooter velocity* (`spawn.js:27`), and a hitscan has no projectile velocity to
  inherit. Mounting the beam changes no existing enemy's bullet aim, so the §134 cancellation holds by
  construction.
- **Q5 (the aiming line is a SIM fact):** done — the geometry lives in `sim-core/beam.js` and the renderer
  only asks. Adding that module auto-generated three guard tests (a suite enumerates every `sim-core/*.js`
  and asserts it is renderer-free and Node-loadable); all three pass, so browser and headless room agree by
  construction. **This is why client test counts read 554 where §8 below says 551.**
- **Q6 (cost and ladder place):** **STILL OPEN.** Price, mass, `minLevel` and its position against Heavy
  cannon (6) / Heavy Machine Gun (7) are for the plan.

**Dodge: the beam applies NO dodge roll — settled by the maintainer 2026-08-25 as a DESIGN call.**

*The determinism argument originally given here was wrong and is retracted.* It claimed a beam dodge roll
would break the recorded archive under §73. It would not: `dodgeRoll` is an injected predicate consulted
only AFTER a geometric connect (`collision.js:208`) and is passed only from `step-projectiles.js:58`, and no
archived trace mounts a beam — so a beam dodge would draw nothing in any recorded fight. §73 does not decide
this. (Caught by the planner agent, 2026-08-25.)

The real reason, and the one to record: **the corridor IS the dodge.** The beam stays entirely RNG-free and
the three drawn lines never lie — if the corridor showed a hit, you took a hit. You escape a beam by flying
out of the corridor, a skill the player exercises directly, rather than by a percentage. Accepted cost: a
Maneuver-heavy build gets no statistical protection from Level 5 beams.

### 0c. The spike — what exists, and what it is not

Branch **`spike/charge-beam`**, worktree **`../ag-wt/charge-beam`**. Throwaway; the plan should treat it as
evidence about feel, not as an implementation to preserve.

- `client/src/sim-core/beam.js` — tuning, `paintTarget`, `inCorridor`, the charge state machine, the hitscan
  resolve. RNG-free. Reuses `segmentHitsShip` / `applyShieldedDamage` / `resolveHostileBulletHit`.
- `client/src/beam-fx.js` — the three lines + reticle + discharge bolt, objects named `beamSight*` /
  `beamReticle` / `beamBolt` so a headless scenario can assert on *them*, not on "some line in the scene".
- `client/src/beam-dev.js` — the `?beam` / `?beam=enemy` / `?beam=only-enemy` flag + a lil-gui panel.
- `client/visual/scenarios/40-charge-beam.mjs` — mounts / charges / damages / **is visible while aiming**.
- `server/src/catalog_seed.js` — weapon **id 12** (`type: 'beam'`) + an exported `BEAM` group preset.
- One branch added to `updateGroups` (`isBeamGroup(g) → updateBeamGroup(...)`), which is what makes the
  weapon available to the player, the ally and every enemy through the one existing seam.

**Verified on the spike:** `client npm test` 554/0 · `22-intro-replay` **tick=2474** · `36-sim-divergence`
**hash=0x2a36f8d9, draws=38** (browser ≡ node) · `40-charge-beam` pass.

**The spike's one real cheat, which the plan MUST undo:** all five numbers live in a shared module-level
`beamTuning` so a slider can move them mid-fight. On a shipped weapon they belong to the **weapon row**, so
two ships can carry differently-tuned beams. Nothing else in the design depends on the shortcut.

**Two things the spike surfaced that are balance input, not defects.** (1) Any shot of 30+ **one-shots a
basic fighter** (30 HP) and a gunner (36 HP), so at the settled 80 damage the corridor never decides a fight
against small pirates — it starts mattering at the mini boss (150 HP) and up. (2) Because the corridor is
*angular*, escaping it is **easier up close**: a top-speed crosser reaches 23° off the nose at 20 u but only
5.0° at 90 u. At ±2° it escapes at every range, which is the intended reading — but note the corridor's
world-space width still grows with distance, which is what makes the hull-aware test in §0a-bis necessary
rather than optional.

### 0d-bis. THE CHOSEN SOUND (maintainer, 2026-08-25) — supersedes the railgun below

The maintainer found and chose a laser sound, and specified the cut: **from 2.86 s, 0.5–0.6 s long.**

**Source:** `assets-src/sounds/843729__tannersound__scifi-laser-gun-shooting.wav` (5.50 s, 48 kHz stereo),
saved with `…843729….license.txt` beside it and both backed up to `s3://vega-sentinels-assets/source/`.

> Scifi Laser Gun Shooting by TannerSound — https://freesound.org/s/843729/ — License: **Attribution 4.0**

**Licence verified at source on 2026-08-25** (the maintainer's notes file gave the author but not the
licence). CC-BY ⇒ **`client/assets/CREDITS.md` needs a row and it must stay while the asset is in use.**

**Measured content of the chosen segment** (10 ms RMS envelope; times are offsets INTO a cut starting at
2.860 s):

| offset into clip | what is there | level |
|---|---|---|
| 0.00 – 0.05 | quiet lead-in (tail of the previous shot in the source) | −45 dB |
| 0.05 – 0.39 | **the build** — a rising swell | −35 → −18 dB |
| 0.39 – 0.61 | **the discharge** — the crack | **−9 dB** peak |
| 0.61 → | decay (the source dips at 3.48 s, then a new shot begins at 4.00 s) | −15 → −30 dB |

Two cuts were produced for audition, both in `~/Downloads`: `beam-cut-060.wav` (0.60 s — the requested upper
bound; ends just before the source's 3.48 s dip, so it keeps the most of the crack) and `beam-cut-056.wav`
(0.56 s, which truncates the crack slightly earlier).

**THE TIMING PROBLEM THE PLAN MUST SOLVE — this is the point of the table above.** The clip is itself a
*build-then-crack*, and its crack lands **0.39 s** in, while the weapon fires at **0.50 s**. Playing the clip
once at charge start puts the bang **~110 ms before the beam actually leaves the ship** — plainly visible
against a telegraph that is only half a second long, and worse if `chargeTime` is ever tuned. Pick one and
record it:
- **split the clip** into a charge part (0.00–0.39) and a discharge part (0.39–0.60), fire the second on the
  `beamFire` event — the only option that stays correct when `chargeTime` is tuned, and the one that fits
  the two-event wire shape the weapon already has;
- **delay the clip's start** by (`chargeTime` − 0.39 s) — one sound, but silently wrong the moment
  `chargeTime` moves off 0.5 s;
- **align `chargeTime` to 0.39 s** so the clip is correct by construction — cheapest, but it lets an audio
  asset dictate a gameplay number the maintainer tuned by feel.

The railgun sound below stays saved as an unused alternative — **do not wire it**; the CREDITS.md row for it
is NOT to be added while it is unused.

### 0d. Audio and CREDITS.md — the earlier candidate, saved but NOT chosen

The maintainer supplied a candidate and asked to keep it for later. **Saved to
`assets-src/sounds/767074__fairhavencollection__sci-fi-rail-gun.wav`** with its attribution beside it as
`…sci-fi-rail-gun.license.txt`, and both backed up to `s3://vega-sentinels-assets/source/` (that folder is
gitignored, so S3 is the only durable copy).

> Sci-Fi Rail Gun by FairhavenCollection — https://freesound.org/s/767074/ — License: **Attribution 4.0**

**CC-BY: if it ships, `client/assets/CREDITS.md` gets a row and that row must stay while the asset is in
use.** Nothing has landed yet — the spike borrows the cannon's samples via `class: 'cannon'`, so CREDITS.md
is currently untouched and correct.

**Measured shape of the file (17.95 s, 44.1 kHz stereo):** a smooth charge ramp from −95 dB rising over
**~8 seconds**, the discharge at **~8.0–9.1 s** peaking at −21.5 dB, then a ~3 s decaying tail. **The ramp is
16× longer than our 0.5 s charge**, so it cannot be dropped in as-is. Three routes for the plan: take only
the last ~0.5 s of the ramp; time-compress the ramp (changes its character); or **use the discharge alone
and synthesize the charge sweep** (`audio.js` already has a synth path — the Grab's pickup blip uses it —
and a synthesized sweep is the only option that tracks a *tunable* charge time instead of being a fixed
clip). The maintainer is still open to either a sourced sound or a synthesized one.

---
>
> **It blocks Level 5.** The Level 5 base pirates and their boss were going to carry a new short-ranged
> kinetic; the maintainer chose this weapon instead and ordered the work **beam first, then Level 5**
> (2026-08-23), so the mission is built and tuned once against the weapon that will actually be in it.
> See §7 for exactly what Level 5 is waiting on.

## 1. What the maintainer described

A **fundamentally new weapon class** — nothing in `WEAPONS` behaves like it today. In their own words
(2026-08-23), translated:

> Something like a laser, with a new interesting animation. You aim, you press fire, over half a second
> energy builds up and the beam strikes the enemy. Half a second later you can do it again. A thin line
> runs from the ship, like a laser sight; when it crosses an enemy, the enemy lights up with something like
> a reticle. I press fire, the energy starts building; if while that happens I press left/right (the
> manoeuvring thrusters) I can miss — but if I didn't touch them, I hit.

And the constraint that decides the architecture:

> Everything here is set up so that ANY weapon is available to ANYONE — if I want to arm the pirates with
> it, that has to be easy. Maybe the boss has it, maybe ordinary enemies, maybe the player if they find or
> buy one.

So this is **a catalog row in `WEAPONS`, mountable by any ship**, exactly like every other weapon — not a
player-only special case and not a boss scripted attack.

## 2. Why it is its own feature

Three things in it are new to the codebase at once, and each is a real design decision rather than a
number:

- **A shot that takes time.** Every projectile in the game exists the instant the trigger is pulled.
  This one has a **charge window** the shooter can lose during — that is state that lives across ticks, in
  the simulation, on the wire, and in the digest.
- **A shot with no projectile.** Every hit today is resolved by a moving entity in `step-projectiles.js`.
  A beam is (probably) hitscan, resolved at the instant of release. That is a new damage path.
- **A shot that is announced before it lands.** The aiming line and the reticle are the mechanic, not
  decoration: they are what makes the charge fair for the target. On an ENEMY carrying this weapon, the
  line is the player's warning to get off it — which is a genuinely good fight beat and the reason the
  maintainer wants enemies able to carry it.

## 3. Read first

- `docs/SUMMARY.md` — fire groups, weapons, the enemy AI, the netsim room. It is the map; read it before
  grepping.
- `docs/DECISIONS.md`:
  - **§124 — auto-aim was REMOVED on purpose.** The player aims. See §5's first question: "if I didn't
    touch the controls, I hit" is a guarantee, and a guarantee is adjacent to the thing §124 deleted.
  - **§127 — one clock.** Anything new on screen is drawn on it like everything else.
  - **§70 — rockets deliberately do NOT inherit ship velocity** (realistic physics was tried and rejected).
  - **§73 — the recorded replay archive is frozen; cosmetic FX are replay-neutral.**
  - **§76 — damage routes through the shield before the hull.**
  - **§134 — the sim is three-sided in TARGETING, two-sided in DAMAGE ROUTING.** A projectile carries
    `fromPlayer` meaning *"the friendly side fired it"*, plus `fromAlly` for the one rule that separates
    the two friendlies. A new damage path must fit that shape, not invent a faction model.
  - **§134's closing amendments — the enemy aim flaw is PERMANENT for existing enemies.** Kinetic bullets
    inherit the shooter's velocity and enemies do not compensate; that is not to be fixed. Anything new is
    opt-in per ship or per enemy type, never a change to the shared firing path.
- `docs/plans/server-authoritative-sim.md` — the room/wire model this has to survive.
- `docs/plans/combat-ally.md` §2c — the Level 5 mission this unblocks, and the framing constraint in §2c(a).
- `docs/narrative/` — before writing any player-facing string (the weapon's shop name and description are
  player-facing).

## 4. The seams it plugs into — verified in the code, 2026-08-23

- **`WEAPONS` in `server/src/catalog_seed.js:161`** — the catalog table. Every weapon is a row with
  `type` (`'bullet'` | `'rocket'`), `stats.class` (`'kinetic'` | `'cannon'` | `'rocket'`) and a stat block.
  A beam is a **third `type`**, and its `class` drives sound routing through `SOUND_MAP`
  (`catalog_seed.js:282`) and the detonation/impact FX.
- **Fire groups — `buildGroups` / `updateGroups` (`client/src/sim-core/ship-entity.js:46` and `:237`).**
  This is the seam that makes "any weapon on any ship" true today, and it is already side-agnostic:
  `updateGroups(world, ship, fwd, side, dt, wantsFire, rocketTarget)` with `side` = `'player'` | `'ally'` |
  `'enemy'`. A group holds `{ key, ai, mounts, reload, cooldown, pending }`. **A charge is a natural
  extension of this object** — the trigger starts a charge instead of queueing mounts, and the mounts fire
  when the charge completes. Note the comment at `:246`: only ENEMIES draw randomness for reload jitter,
  because the player and the ally consuming none is what keeps recorded traces bit-identical (§73). A
  charge must not add a draw on the player/ally path.
- **The three callers of `updateGroups`** — `step-player.js:344` (`wantsFire` = `keys[g.key]`),
  `step-enemies.js:105` (AI rule: in range and `|diff| < ai.aimTol`), `step-ally.js:388`. All three need an
  answer for "what does *holding a charge* mean for this shooter".
- **Player controls (`step-player.js:251-291`).** **A/D and the arrows are TURN, not lateral strafe** —
  they rotate the hull. `KeyW`/`ArrowUp` is thrust; touch has `touchAim` instead of keys. This matters a
  lot for §5's first question.
- **Fire-group AI presets (`catalog_seed.js:298-300`):** `GUN` range 45, `GUN_LONG` 90, `ROCKET` 80, all
  with an `aimTol`. A beam needs its own preset, and its range is **framing-constrained** — see §6.
- **Damage/collision:** `step-projectiles.js` (entity-based, binary end to end),
  `sim-core/collision.js`, `sim-core/targeting.js` (`nearestHostileTarget`).
- **Events/wire:** `sim-core/events.js`, `EVENT_FIELDS` in `protocol.js`, and the client adapter in
  `client/src/sim.js` that turns sim events into FX. §134's `allyDown` entry explains the house rule for
  when a new event type is justified rather than overloading an existing one.

## 5. The questions this feature turns on — settle these before writing code

**1. Does a charged shot that was not disturbed HIT, or merely GO WHERE THE NOSE POINTS?**
This is the whole feature and it collides with a recorded decision. The maintainer said *"if I didn't press
left/right, I hit"* — a guarantee, which implies the beam **locks** the highlighted target at charge start.
But A/D **rotate the hull**, so a plain nose-line hitscan already misses when you turn — the described feel
may fall out for free with no lock at all, and no tension with §124. The two readings differ sharply for a
moving target: a lock tracks it, a nose-line does not. **Ask the maintainer directly; do not pick.** If it
is a lock, reconcile it with §124 in writing (an aimed, charged, interruptible lock is arguably the
opposite of auto-aim — but that argument has to be made and recorded, not assumed).

**2. What breaks the charge, on every input device?** Keyboard turn is A/D. Touch has no A/D — it has
`touchAim`. Thrust (W) is a separate key: does accelerating break it? Does taking damage? Does the target
dying mid-charge? A rule that only exists on desktop is not a rule.

**3. What does an ENEMY carrying it do?** The maintainer explicitly wants this easy. An AI needs its own
answer for when to start a charge, and — if a lock exists — whether *its* charge is breakable by its own
manoeuvring, which its steering does constantly. If an enemy's charge is unbreakable while the player's is
not, the weapon is two different weapons.

**4. Is it hitscan or a fast travelling beam?** Hitscan is a new damage path and cannot be shot down;
a travelling beam reuses `step-projectiles.js` and could be. Decide, and say which entity the damage is
attributed to for `world.kills`, credits, XP and `fromPlayer`/`fromAlly` (§134).

**5. The aiming line is a SIM fact, not a decoration.** Whether the line crosses an enemy determines the
reticle and (question 1) possibly the hit. So the line's geometry must be computed where both the browser
and a headless room agree — `sim-core` — even though the rendering of it is client-side. Getting this wrong
is how the room and the browser start disagreeing about who is targetable.

**6. Cost and place in the ladder.** `WEAPONS` is an explicit price/mass ladder (`docs/plans/catalog-economy.md`).
A charged beam has an obvious identity — high damage, low rate, punished by manoeuvring — but its price,
mass, `minLevel` gate and where it sits against Heavy cannon (id 6) / Heavy Machine Gun (id 7) are real
decisions.

## 6. Hard constraints

- **The frame is small.** With the camera at `(0, 110, 26)` and a 55° FOV (`engine.js:62-63`), the visible
  half-extent on the plane at zoom 1 is about **±57 units vertically, ±102 horizontally on 16:9 — and only
  about ±32 horizontally on a phone in portrait**. A beam whose range exceeds that lets an enemy shoot from
  off-screen, which is the failure mode `combat-ally.md` §2c(a) names. The AIMING LINE makes this worse,
  not better: a line drawn from off-frame is a warning the player never sees.
- **Determinism.** `22-intro-replay` must still log **tick 2474** and `36-sim-divergence` must still agree
  on hash **0x2a36f8d9** with **38** draws. If the weapon is on no existing ship, both should be untouched
  by construction — verify it rather than assume it.
- **Load, for the room.** A charge is per-ship state that changes every tick and an aiming line is
  per-ship geometry. Neither may become a per-tick broadcast of something derivable. Say explicitly what
  goes on the wire (probably: charge start/release as EVENTS, the line derived client-side from the ship's
  state) and what does not.
- **The existing enemies' aim flaw stays** (§134). Do not touch the shared firing path.
- **English only** (CLAUDE.md). Source strings, identifiers, comments, commits.

## 7. Assets and CREDITS.md — ASK, do not decide

A beam almost certainly wants **a charge sound and a discharge sound**, and possibly a muzzle/impact model.
`client/assets/CREDITS.md` tracks every third-party asset with source and licence, and CLAUDE.md requires
**stopping to ask the maintainer** before adding, replacing or removing a model or a sound. Do that before
anything lands. Sounds route through `SOUNDS` + `SOUND_MAP` in `catalog_seed.js` by
`(entity, class, event)`, so a new weapon `class` needs its rows.

## 8. Verification

```
cd client && npm test                            # 551 tests
cd server && npm test                            # 246 tests, needs a local Postgres
cd client && node visual/run.mjs 22-intro-replay # READ the log: tick=2474
cd client && node visual/run.mjs 36-sim-divergence# hash=0x2a36f8d9, draws=38
```

Rakes, from the maintainer:
- `visual/run.mjs` takes **ONE** argument; the full suite does not finish on this machine.
- `22-intro-replay` does not ASSERT the tick number — it prints it. Read the log.
- Do not run the suites while the maintainer is playing.
- Local server: the `/run-local` skill, but **port 4000 is already taken by an old server — use 4001**.
- The visual suite has a flaky baseline (~6 scenarios fail at baseline); judge by the reliably-passing set
  and zero page errors.
- A visual/feel feature should reach the maintainer as a **playable build EARLY** — this one is almost
  entirely feel, and the real requirements will only emerge from flying it.

## 9. What Level 5 is waiting on

Three of Level 5's four open decisions were settled on 2026-08-23 and are recorded in
`docs/plans/combat-ally.md`. Level 5 resumes as soon as this weapon exists. Nothing in this file should be
shaped around Level 5 beyond the framing constraint in §6 — the weapon has to be good on its own terms.
