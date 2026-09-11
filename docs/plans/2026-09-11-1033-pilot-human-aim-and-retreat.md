# The Sentinel pilot gets a human aim — and a retreat that actually leaves

> **Status:** planned 2026-09-11, revised after review. Worktree/branch
> `2026-09-11-1033-pilot-human-aim-and-retreat`.
> Read first: `docs/plans/combat-ally.md` (§2d, §2.6 — what the pilot is), `docs/plans/duel-room.md`
> (the `?duel` aces that fly the same code), DECISIONS **§30** (keep it simple), **§70** (rockets inherit
> nothing), **§73** (the seeded stream is opt-in per draw site), **§113** (no reverse), **§134** (friendly
> fire off; enemy aim deliberately left alone), **§146-148** (the ace, point defence, `groupReach`),
> **§151** (the browser and Node do not agree bit-for-bit).
> Current state after this lands: `docs/SUMMARY.md` → Gameplay → "The ally (a third combatant)".

## 1. Goal

The Sentinel pilot — `flySentinel` in `client/src/sim-core/step-ally.js`, flown by **both** the Level-4
wingman and the `?duel` aces — puts its bullets exactly where it means to, every single shot. This change
gives it two human properties:

1. **A tracking error.** Its *perceived* bearing to the target lags the true one while the line of sight is
   swinging, carries a small standing offset, and is kicked by a random amount the instant it acquires a
   target.
2. **A retreat that leaves the fight.** Today a broken-off pilot coasts to a stop 120 u from the nearest
   threat, which reads as "he wandered off a bit". Now he runs at **full thrust for the arena boundary**,
   braking only on his own kinematic stopping distance so he arrives with ~0 speed and heals there — and if
   you chase him he keeps going straight past the border.

### 1.1 What actually changes on screen — the honest version

**The original framing of this feature ("~70 % of the shots in a hard crossing pass will now miss") was
already true before the change, and the plan must not claim it.** `aimWithDrift` corrects the *shooter's*
drift and **deliberately does not lead a moving target** (`step-ally.js:203`). So a target crossing at
30 u/s at 40 u needs `30 × 40/65 = 18.5 u` of lead against a hull whose *hittable* half-width at the bullet
plane is **1.8-3.9 u** (measured, §3.0): **every one of those shots already misses today**, and the new lag
term pushes the aim a further `0.17 × 30 = 5.1 u` in the same direction. Flight time, not aim, is what makes
a fast crosser hard, and that was so yesterday.

What this change really adds, in the regime where his shots *land*:

- **The first shot at a newly acquired target misses ~50 % of the time.** Nothing made him miss it before —
  not at any range, not at any aspect. This is the single biggest visible difference, and it is the
  maintainer's own rule ("even against a stationary target the first shot must carry a miss chance; the
  second already lands, if the target stays put").
- **A settled solution still lands every shot** — guaranteed by construction against the *narrowest* aspect
  of every hull in the catalog (§3.1), not merely on average.
- **A target that makes him swing his hull costs him hits in the CLOSE fight**, where flight time alone
  would not have: the tracking lag is `LAG × v_perp` (range-**independent**) while the un-led flight-time
  error is `v_perp × d / 65` (grows with range), so inside `0.17 × 65 = 11 u` the tracking error is the
  **dominant** reason a shot misses. A crossing of only ~8.6 u/s displaces his aim by a full hit
  half-width, at any range.
- **A circling target cannot become immune.** The standing jitter, re-rolled on a timer, breaks any
  systematic offset a constant-rate circle would otherwise settle into.

Both halves are **identical for the wingman and for the duel ace**: one shared block of constants in
`ally-config.js`. There is no per-side `ctx` knob — the duel room is supposed to be a test of the wingman's
own flying, and a pilot that can be tuned apart from the thing it tests is not that.

**On Level-4 balance:** the wingman there is a **test harness, not tuned content**, and he got *stronger*
when `aimWithDrift` shipped; a tracking error is a correction back toward where he already was, not a nerf
against a balanced baseline (maintainer, 2026-09-11). No balance caveat beyond this line.

`stepEnemyAI` is **not touched** (DECISIONS §134).

## 2. Decisions (settled — do not re-open)

| # | Question | Decision |
|---|---|---|
| 1 | Perturb the nose, or the aim point? | **The perceived BEARING.** The fire gate (`step-ally.js:557`, the `at` argument) judges the real projectile path against the vector it is handed, so an error added to `desired`/the nose would make him **hold fire** instead of missing. The error rotates the unit vector to the target; that perceived vector feeds `aimWithDrift`, the nose, the come-about exit **and** the fire gate — the gate honestly says "on target" while the bullet flies past. |
| 2 | Bearing or range? | **Bearing only.** `dist` stays true, so every range gate (`groupReach`, `engageBand`, `holdFireForPlayer`) is unaffected. He misjudges *where*, not *how far*. |
| 3 | Who gets it? | **Both pilots, identically.** One constant block in `ally-config.js`. No `ctx` field. |
| 4 | What is the error measured against? | **The target's HITTABLE half-width at the bullet plane** (`ALLY_AIM_HIT_FRAC × broadRadius`), **not** `broadRadius` itself. Measured, §3.0. This is what makes "a settled solution lands" a provable statement rather than an average. |
| 5 | How hard is a crossing target? | See §1.1 — the honest answer is "already impossible past ~11 u; newly harder inside it". The coefficient is tuned so that **a ~8.6 u/s crossing displaces his aim by one hit half-width** (§3.1), not to a miss-rate headline. |
| 6 | First shot at a new target? | **~50 % miss, and the second lands.** One continuous mechanic — acquisition *kicks* the tracking error, which then decays (shape S1, chosen over an explicit one-off snap-shot flag, "because we're going for HUMAN behaviour"). **"The second shot lands" is a consequence of τ against the Heavy cannon's 0.6 s `fireCooldown`, not a rule** — DECISIONS §152. |
| 7 | Point defence? | **It gets the error, with its OWN constant, keyed to the CLOSING geometry** (§3.2). ~**50 % miss per shot**, measured at the point the bullet and the rocket actually meet — not at the range the error was computed at, which would have made it ~27 %. |
| 8 | RNG source | **A private per-pilot `mulberry32`**, seeded from `(installed sim seed, spawn ordinal)` — both integers. **Zero draws from the shared seeded stream** (§73). |
| 9 | Retreat destination | **`remaining = max(borderRemaining, ALLY_BREAK_OFF_DIST − gap)`** — the arena edge, but never stopping closer than 120 u to the threat. |
| 10 | `?roam` | `borderRemaining` is forced to **0** there (the arena boundary is meaningless in roam — the same reason `step-player.js` skips the OOB rule), so the max() degrades to exactly today's rule with no extra branch. |
| 11 | Top speed | **Unchanged.** "Maximum speed" means FULL THRUST; the cap stays `PLAYER_MAX_SPEED` (30), a property of the ship. |

## 3. The mechanics, with the arithmetic

### 3.0 The yardstick, MEASURED — `broadRadius` is not what a bullet has to hit

`broadRadius` (`collision.js:26`) is the broad-phase **enclosing sphere**; the narrow phase
(`segmentHitsShip`, `collision.js:159`) then tests per-part OBBs, and a top-down shot only ever crosses the
hull at the **bullet plane**. Sweeping a `segmentHitsShip` probe laterally past each hull at
`y = BULLET_PLANE_Y`, over 288 headings (1.25° steps), gives the **contiguous hit half-width** (the largest
offset that still connects before the first gap):

**EVERY hull the pilot can shoot at**, because that is the set test (m) will iterate: both
`server/src/sim-host.js:42` and `client/src/main.js:2196` build `enemyShips` as `type === 'enemy'` with
**no level filter**, so all nine enemy rows are in scope, not just the ones a given level fields.

| hull | `broadRadius` | narrowest half-width | widest | ratio |
|---|---|---|---|---|
| Basic player ship (what both pilots FLY, and what an ace SHOOTS AT) | 4.318 | 1.87 (h 0.79) | 3.90 | 0.433 |
| Basic pirate ship / pirate gunner / pirate lancer | 4.153 | 1.75 (h 0.46) | 3.61 | 0.421 |
| basic rocket pirate / advanced rocket pirate | 4.001 | 1.97 (h 2.47) | 3.66 | 0.492 |
| **pirate mini boss / advanced medium pirate** | **7.567** | **2.83 (h 0.24)** | 6.65 | **0.374 ← the floor** |
| first pirate boss / second pirate boss | 11.983 | 6.60 (h 3.05) | 9.99 | 0.551 |

(Entity `broadR` is the seed's value **plus `|lift|`** — `ship-config.js:38` — so it is 2.181 and 2.307,
not the raw 2.001/2.097, and `broadRadius = broadR × scale` with `scale = 1.8 × model scale`. Every figure
above is from a live probe against `createSimWorld` sweeping 288 headings, not from reading the seed.)

**The binding hull is the `pirate mini boss` / `advanced medium pirate` pair at 0.374** — an ordinary
`world.enemies` row the wingman fights, not an exotic case. A three-hull sample would have suggested ~0.42
and put test (m) in the red on arrival; that is exactly the trap this table exists to close.

So a yardstick of `broadRadius` overstates the target by **up to 2.7×** at the worst aspect. Calibrating
the standing jitter against it would have put ±2.16 u of range-independent error against a 1.87 u player
hull and ±3.78 u against a 2.83 u mini boss, losing **~13 % of settled shots on the player hull and ~25 %
on the mini boss** — breaking the one promise this feature is not allowed to break, on the `?duel` surface
the maintainer live-tests.

**The yardstick is therefore**

```js
export const ALLY_AIM_HIT_FRAC = 0.35; // what fraction of broadRadius a bullet must actually be within at the
                                       // BULLET PLANE. Measured floor over EVERY hull the pilot shoots at is
                                       // 0.374 (pirate mini boss / advanced medium pirate); the rest run
                                       // 0.42-0.55. 0.35 sits under the floor with room for a model
                                       // re-export to move it a little. Test (m) re-measures all nine.
hitR   = ALLY_AIM_HIT_FRAC * broadRadius(target)   // 1.51 u player hull, 1.45 u pirate, 2.65 u mini boss
thetaHit = min(hitR / max(dist, 1), 0.30)          // its angular half-width, small-angle
```

Everything below is expressed in **units of `thetaHit`**: `|err| ≤ 1` means the shot is on the hull at
**every** aspect.

### 3.1 The tracking error

**State on the pilot** (all created lazily, so the plain-object unit tests keep working):

| field | meaning |
|---|---|
| `_aimTarget` | the entity the bearing history belongs to (identity check) |
| `_aimBearing` | last tick's TRUE bearing to that entity, radians |
| `_aimRate` | the SMOOTHED bearing rate, rad/s |
| `_aimKick` | a decaying random offset, in `thetaHit` units |
| `_aimJitter` | a held random offset, same units, re-rolled on a timer |
| `_aimJitterT` | seconds until the next jitter re-roll |

**Per tick, for the ship he is aiming at:**

```
rate = shortestAngleDelta(_aimBearing, bearing) / dt
_aimRate += (rate - _aimRate) * min(1, dt / ALLY_AIM_TAU_SEC)
_aimKick -= _aimKick * min(1, dt / ALLY_AIM_TAU_SEC)
err = -ALLY_AIM_LAG_SEC * _aimRate + (_aimJitter + _aimKick) * thetaHit
err = clamp(err, ±ALLY_AIM_MAX * thetaHit)
perceived = rotate(u, err)                      // u = the TRUE unit vector to the target
```

`rotate({x,z}, e) = { x: x·cos e + z·sin e, z: −x·sin e + z·cos e }` — the convention that matches
`heading = atan2(x, z)` (rotating by +e raises the bearing). The lag is **signed to trail**: a rising
bearing produces a negative error, so the burst falls behind a target that is pulling away.

**Re-rolls** (all from the pilot's private stream, `U` uniform in (−1, 1)):

- **Acquisition** — `_aimTarget` changes (a fresh target, a snap switch, a re-pick), **and** on come-about
  exit: `_aimKick = ALLY_AIM_KICK × U`, `_aimRate = 0`, bearing history reset (no rate this tick).
- **Timer** — every `ALLY_AIM_JITTER_SEC`: `_aimJitter = ALLY_AIM_JITTER × U`.
- Nothing else; no draw on a tick with no target.

**The constants** (new, in `ally-config.js`):

```js
export const ALLY_AIM_HIT_FRAC   = 0.35; // §3.0 — the measured yardstick (floor 0.374, the mini boss)
export const ALLY_AIM_LAG_SEC    = 0.17; // his aim trails the target by this much of its crossing motion
export const ALLY_AIM_TAU_SEC    = 0.30; // smoothing/decay time constant for the rate AND the kick
export const ALLY_AIM_JITTER     = 0.70; // standing offset, in hit half-widths (±)
export const ALLY_AIM_JITTER_SEC = 0.80; // …re-rolled this often
export const ALLY_AIM_KICK       = 2.00; // acquisition kick, in hit half-widths (±)
export const ALLY_AIM_MAX        = 3.00; // hard cap on the total error, in hit half-widths
```

**Why those numbers:**

- **`JITTER = 0.70` — "a settled solution lands every shot", provably.** The claim is one multiplication:
  the standing offset is at most `JITTER × HIT_FRAC = 0.70 × 0.35 = 0.245` of `broadRadius`, against a
  measured narrowest half-width of **0.374** of `broadRadius` (the mini boss, §3.0) — so a settled shot
  connects at **every** aspect of **every** hull with **~35 % of margin**. Both factors have to stay in
  view: the promise is broken by raising either constant, and test (m) guards the second. (This is the pair
  the original draft got wrong by scaling against `broadRadius` itself; see §3.0.)
- **`TAU = 0.30 s` + `KICK = 2.00` — the first shot misses 50 % and the second lands.** One Heavy-cannon
  cooldown is 0.6 s = 36 ticks at 60 Hz, over which the kick decays by
  `(1 − dt/τ)^36 = 0.944444^36 = 0.1277`. Worst case against a target that stopped manoeuvring:
  `2.00 × 0.1277 + 0.70 = 0.955 < 1` → **the second shot lands**, with 4.5 % of margin. And on the
  acquisition tick, with `k ~ U(±2.0)` and `j ~ U(±0.7)`, the landing interval for `k` is 2 wide out of a
  4-wide support for every `|j| ≤ 0.7`, so the first shot misses **exactly 50 %** of the time. τ sits inside
  the 0.3-0.5 s window the maintainer specified.
- **`LAG = 0.17 s` — a ~8.6 u/s crossing displaces his aim by one hit half-width** (`hitR ≈ 1.45 u` for a
  pirate, so `v_ref = hitR / LAG = 8.6`; 8.9 u/s against the player hull's 1.51 u). Note the direction:
  *lowering* `ALLY_AIM_HIT_FRAC` shrinks `hitR` and therefore *lowers* the crossing speed at which the lag
  costs him a hit. Expressed range-free, the lag error in `thetaHit` units is
  `m = LAG · v_perp / hitR` — **the distance cancels**, which is why one coefficient covers every range.
  It is *not* tuned to a crossing-pass miss rate, because §1.1 shows flight time already owns that regime;
  it is tuned to the range band where his shots land at all, and there its contribution is
  `LAG × 65 / d = 11/d` times the flight-time error — dominant inside 11 u, 37 % of it at 30 u, 28 % at 40 u.
- **`MAX = 3.00`** caps the total lateral error at `3 × hitR ≈ 4.4 u` ≈ **1.05 broad hull radii**, so a miss
  reads as "passed close by" and never as "shot off into space". Note this is *tighter* than the
  "1.5-2.5 × the angular radius" originally specified, because the yardstick moved from the enclosing
  sphere to the hittable width; it satisfies the stated intent more strictly, and it binds only on the lag
  term (jitter + kick peak at 2.70).

**The line-of-sight rate includes HIS OWN crossing motion**, deliberately: the framing is "if he had to
swing his hull to get the nose on target there is a chance to miss".

**No new transcendental in the hot path beyond `sin`/`cos`.** `thetaHit` uses the small-angle ratio rather
than `Math.atan` (within 1.5 % at every range that matters, and `Math.atan` would be a *new*
implementation-defined function — §151 measured `Math.sin` differing on 2.7 % of arguments between two
Chromium minors). `Math.sin`/`Math.cos` are already called every tick by `headingToDir`.

### 3.2 Point defence: its own constant, keyed to where the shot actually meets the rocket

A rocket homing *at* the pilot has almost no line-of-sight rate (the §3.1 lag term would be ~0); one homing
on his friend crosses faster than anything else in the game. So the intercept uses a **pure random
dispersion** against the rocket's own kill radius — the **2.4 u** a bullet must come within to detonate it
(`step-projectiles.js:97`).

**And it must be measured at the INTERCEPT point, not at the acquisition range.** The bullet leaves at
65 u/s while the rocket closes at 12→37 u/s, so they meet at `d × s/(s + v_r)` — **0.64-0.84 of the range
the error was computed at**. An error of `e` radians therefore produces a lateral miss of only
`e × d × s/(s+v_r)`, i.e. the *effective* tolerance is `(2.4/d) × (s+v_r)/s`. Sizing the dispersion against
the naive `2.4/d` would have delivered a **~73 % per-shot hit rate**, not the 50 % that was agreed. So:

```js
export const ALLY_PD_JITTER     = 2.00; // intercept scatter, in units of the CLOSING-corrected tolerance
export const ALLY_PD_JITTER_SEC = 0.30; // …re-rolled this often — shorter than the 0.6 s gun cooldown, so
                                        //   consecutive shots at one rocket are independent rolls
```

```
// vClose is the rocket's CLOSING component along the line of sight, not its speed: a rocket homing on the
// FRIEND crosses instead of closing, so |vel| would overstate how quickly the two meet and inflate the
// tolerance. One dot product, clamped at 0 (a rocket opening away simply gets the uncorrected tolerance).
vClose  = Math.max(0, -(r.vel.x * u.x + r.vel.z * u.z))          // u = unit pilot → rocket
thetaPD = min((ROCKET_INTERCEPT_RADIUS / max(dist,1)) * (s + vClose) / s, 0.30)   // s = gunSpeed(a)
errPD   = _pdJitter * thetaPD                     // _pdJitter = ALLY_PD_JITTER × U
```

A shot lands iff `|errPD| ≤ thetaPD`, so with `U` uniform the per-shot hit rate is `1/2.00` = **50 %,
independent of the rocket's speed** — that is the point of carrying the closing factor rather than
absorbing it into the constant. (It is a first-order meeting-point estimate, not a solved intercept: the
rocket also accelerates and turns during the bullet's flight. Close enough for a dispersion constant, and
test (j) measures the outcome rather than trusting the formula.) `_pdJitter`/`_pdTimer` reset whenever `a.intercept` changes (including to
`null`).

**Rocket-level outcome, stated honestly.** A rocket is only acquired inside `engageBand` = 45 u and covers
that last stretch in ~1.5 s, so the 0.6 s cooldown gives him **2-3 shots**: `1 − 0.5ⁿ` = **75-88 %** of the
rockets he gets more than one shot at still die, and a rocket he gets a single shot at is a coin flip.
Today's baseline, measured in a live duel and recorded in SUMMARY, is 13 rockets fired → 5 shot down,
6 never engaged (expired at max range), 1 reaching a hull — i.e. **~71 % of the ones he engaged**. After
this change he spends more ammunition per rocket and some get through. That is the agreed trade
("I'm fine with 1-2 shots being spent on the rocket instead of on me").

`ROCKET_INTERCEPT_RADIUS` does not exist yet — it is the bare literal `2.4` at
`client/src/sim-core/step-projectiles.js:97`. **Export it there and import it in `step-ally.js`.**

### 3.3 The retreat: run for the edge

`step-ally.js:387` today is

```js
thrust = approachThrust(opening, ALLY_BREAK_OFF_DIST - gap, a.acceleration);
```

At 30 u/s his stopping distance is `v²/2a = 900/17.4 = 51.7 u`, so he cuts thrust at a gap of ~68 u and
coasts: no dash. Replace the *remaining distance* — and the speed it is judged against:

```js
const border = world.roam ? 0 : edgeRemaining(a.pos, ax / gap, az / gap, world.arenaCenter, ARENA);
const gapRemaining = ALLY_BREAK_OFF_DIST - gap;
const remaining = Math.max(border, gapRemaining);
// WHICH SPEED THE ARRIVAL IS JUDGED ON depends on WHICH DESTINATION IS BINDING, and they are not the same
// number. The 120 u floor is a distance to a MOVING threat, so it is judged on the rate the GAP is opening
// (a pursuer matching his course means the gap is not opening, however fast he flies). The BORDER is a
// fixed line in world space, so it is judged on his own ground speed along the escape course. Using
// `opening` for the border would brake up to ~116 u early against a threat that is itself fleeing.
const alongCourse = gap > 1e-6 ? (a.vel.x * ax + a.vel.z * az) / gap : 0;
thrust = approachThrust(border > gapRemaining ? alongCourse : opening, remaining, a.acceleration);
```

`edgeRemaining` is a ray/box (slab) intersection from inside the ±`ARENA` square around
`world.arenaCenter`, **recomputed every tick** so a drifting zone (`world.arenaDrift`,
`step-player.js:311-314`) is followed for free. Outside the box it returns 0, which reads as "he has reached
the edge" and lets the 120 u floor take over.

**Being chased falls out of the max(), with no extra mechanic** — and the precise statement is not "the
remaining distance never reaches 0" but: once he is past the border, `border` is 0 and
`remaining = 120 − gap`, and `approachThrust` holds full thrust while `remaining > 51.7 + 0.5`, i.e.
**while the pursuer keeps the gap under ~68 u**. A pursuer matching his 30 u/s cap does exactly that, so he
keeps running straight past the boundary; one that falls behind lets the gap open past 68 u, at which point
he is achieving the break-off anyway and brakes into the hold.

**The chase self-resolves, and that is accepted, not designed around.** The ally/ace has no out-of-bounds
rule (`step-ally.js:522`), but the **player** does: `step-player.js:318-328` counts `oobTime` while outside
±`ARENA` and warps the player back to `world.arenaCenter` after `OOB_RETURN_TIME` = **30 s** continuous
(lifted in `world.roam` and during `world.returnToBase`).

**What this costs, stated in full.** `ARENA` is 360, so from a typical engagement ~100 u off-centre the
border is **260 u away straight out along the axis**, and up to **~609 u** in the worst case — a pilot
100 u off-centre on a diagonal, running out along that same diagonal, where the slab test's nearer wall is
still 609 u away (`430.7/0.707`). So **9-20 s** of running at 30 u/s. He then heals ~**30 s** (repair drone
id 12 is 1 HP/s, 25 % → 40 % of a 200 HP hull) plus the 10 s shield refill, and on rejoining he has to fly
much the same **9-20 s** back to the fight. **Total absence: roughly 50-80 s** — longer than the old 120 u
hold by about a minute. That is the
point of the feature (a wingman leaving reads as leaving) and it is the trade-off DECISIONS §153 records.

### 3.4 Replay / intro impact, and the determinism story

- **No recorded trace moves.** No shipped level carries `ally: true` (asserted by
  `server/src/ally-sim.test.js:44`) and aces exist only behind `?duel`, so `world.allies` is empty and no
  ship carries `pilot: 'ace'` in the Level-0 intro trace or in any campaign session. Every path added here
  is inside `flySentinel`, which those runs never enter. `22-trace-replay` and `36-sim-divergence` are
  inert — **run 22 anyway**, it is the standing guard (§6).
- **Zero seeded draws.** The pilot's randomness is a private `mulberry32`; `simRandom()` is never called,
  so `simRandomDraws()` — half the divergence oracle and half the duel referee's verdict — is unchanged.
  The three existing "zero RNG" assertions (`step-ally.test.js:485`, `ace.test.js:68`,
  `server/src/ally-sim.test.js:87`) stay green **as written**; do not weaken them.
- **Both hosts reproduce the same pilot.** The seed is `(simSeed() ?? 0)` mixed with an **integer spawn
  ordinal**; `simSeed()` is a new getter over the value `seedSim()` already receives. Every host that
  re-runs a fight installs the same value: live play `client/src/main.js:1773` (`beginLiveSession`, a
  `Date.now()>>>0` seed — so the `?? 0` fallback is only reachable on genuinely unseeded paths, where every
  pilot would fly an identical aim stream every run; say so in the code comment), `?playback`/admin "▶ play"
  `main.js:1594` and `:1852`, `?bench` `:1645`, and the server referee `server/src/sim-host.js:127`.
  Integer seed + `Math.imul` means the *sequence* is bit-identical on every engine.
- **It does make a duel more divergence-sensitive, and that is what scenario 49 is for.** The claim that
  this "does not widen" the browser↔Node surface would be too comfortable: a 1-ULP float difference that
  flips a target re-pick now also flips a *draw*, so the two hosts diverge by a whole pilot instead of by an
  ULP. The pre-existing guard is `49-duel-referee`, which demands an identical hash, tick count and draw
  count between Chromium and Node on a live-recorded duel — **run it** (§6) rather than reason about it.
- **`simSeed()` is process-global**, which matters for tests: see §5.0.

## 4. Steps

Paths are relative to the worktree root
`/Users/kbagaiev/Projects/ag-wt/2026-09-11-1033-pilot-human-aim-and-retreat`.

### S1 — `client/src/sim-core/sim-random.js`: expose the installed seed

Beside `isSimSeeded()` (end of file), keep the installed seed and add a getter:

```js
let seedValue = null; // the integer installed by seedSim, or null in an unseeded run
export function seedSim(seed) { seedValue = (seed == null) ? null : (seed >>> 0); rand = …; draws = 0; }

// The seed this run was started with, or null when nothing is installed. NOT a draw and NOT a random
// source: it exists so a sim entity can derive its OWN private, deterministic stream (the Sentinel
// pilot's aim error, step-ally.js) without touching the shared gameplay stream — DECISIONS §73 rules the
// STREAM, and a per-entity mulberry32 seeded from this value consumes none of it.
export function simSeed() { return seedValue; }
```

Add to `client/src/sim-core/sim-random.test.js`: `seedSim(7)` → `simSeed() === 7`; `seedSim(null)` →
`null`; and `simSeed()` does not move `simRandomDraws()`.

### S2 — `client/src/sim-core/step-projectiles.js`: name the 2.4

Hoist the literal at line 97 to a module-level export:

```js
// How close a BULLET has to come to a rocket to take it out of the air. The Sentinel pilot's point
// defence is calibrated against this number (step-ally.js), so the two must not drift apart.
export const ROCKET_INTERCEPT_RADIUS = 2.4;
```

### S3 — `client/src/sim-core/ally-config.js`: the shared constant block

Insert a new section between `---------- The pass ----------` (ends at `ALLY_TARGET_LEASH`) and
`---------- Retreat & station-keeping ----------`, carrying the eight aim constants and the two
point-defence ones **with the derivations in the comments** — the derivation is what makes them
re-tunable. State in the block header:

- it is **one block for both pilots** by design;
- **the yardstick is the measured hit half-width, not `broadRadius`** — include the §3.0 table, name the
  **binding hull (`pirate mini boss` / `advanced medium pirate`, ratio 0.374)**, and say why (the original
  calibration lost 13-25 % of settled shots at the narrow aspect). Also say that test (m) iterates **all
  nine** enemy rows, because `enemyShips` carries no level filter — a three-hull sample suggests ~0.42 and
  is wrong;
- the settled-lands proof as a single product: `ALLY_AIM_JITTER × ALLY_AIM_HIT_FRAC = 0.245 ≤ 0.374`;
- `m = LAG · v_perp / hitR` and why the distance cancels; the `11/d` comparison against flight time;
- the second-shot guarantee `KICK × 0.1277 + JITTER < 1` **and that it is a coupling to `fireCooldown`
  0.6 s**, pointing at DECISIONS §152;
- for the PD pair: the closing-geometry correction `(s + v_r)/s` and why it is carried explicitly.

### S4 — `client/src/sim-core/step-ally.js`: the pilot

**Imports** (`:34-38`): add `ARENA` from `./consts.js`, `broadRadius` from `./collision.js` (THREE-free;
imports only `components.js`, no cycle), `ROCKET_INTERCEPT_RADIUS` from `./step-projectiles.js`,
`mulberry32`/`simSeed` from `./sim-random.js`, and the new `ALLY_AIM_*` / `ALLY_PD_*` constants.

**a) The private stream** — a helper after `angleTo` (`:44`):

```js
// The pilot's OWN randomness — never the shared seeded stream (DECISIONS §73), whose draw count is half
// the divergence oracle and half the duel referee's verdict. Seeded from two INTEGERS both hosts have:
// the seed this run installed and the pilot's spawn ordinal. Integers on purpose — a float-derived seed
// would give the browser and the referee different PILOTS off a 1-ULP difference (§151). Lazy, so the
// plain-object unit tests (and any pilot built before a seed was installed) just work.
export function pilotRandom(a) {
  if (!a._aimRng) a._aimRng = mulberry32(((simSeed() ?? 0) ^ Math.imul(a._aimOrdinal | 0, 0x9E3779B1)) >>> 0);
  return a._aimRng();
}
const signed = (a) => pilotRandom(a) * 2 - 1;   // uniform in (-1, 1)
```

**b) The tracking error** — one exported function next to `aimWithDrift`, so "this is the aim" stays one
place in the file:

```js
// The pilot's PERCEIVED bearing to `target`: the true unit vector `u`, rotated by a signed tracking error.
// Everything downstream — the nose, the come-about exit and the FIRE GATE — reads this vector, which is
// what makes him MISS rather than HOLD FIRE: the gate honestly reports "on target" while the bullet flies
// past. The range is NOT perturbed; he misjudges where, not how far. The error is measured in units of the
// target's HITTABLE half-width at the bullet plane (ALLY_AIM_HIT_FRAC × broadRadius) — NOT of broadRadius,
// which is the enclosing sphere and overstates a real hull by up to 2.7× (see ally-config.js).
export function perceivedBearing(a, target, u, dist, dt) { … }
```

It owns the §3.1 state and the acquisition re-roll (`target !== a._aimTarget`), and returns the rotated
unit `{x, z}`.

**c) Wire it into the pass** (`:422-437`). After `toTarget` is built:

```js
const aimAt = perceivedBearing(a, a.target, toTarget, dist, dt);
// COME ABOUT ENDS when the nose reaches WHERE HE THINKS THE TARGET IS. Judged on the perceived bearing,
// not the true one: the nose converges on the perceived vector, so a true-bearing test could sit up to
// ALLY_AIM_MAX·thetaHit outside a 0.25 rad exit angle and never fire — the come-about would never end.
// (Moved down from :417, unchanged in order within the tick.)
if (a.passArmed && Math.abs(shortestAngleDelta(a.heading, Math.atan2(aimAt.x, aimAt.z))) <= ALLY_TURN_EXIT_ANGLE) {
  a.passArmed = false;   // …and this is an ACQUISITION event too — see perceivedBearing
}
const aim = aimWithDrift(aimAt, a.vel, gunSpeed(a));
```

**Delete** the old exit check at `:417-420`, and set `toTarget = aimAt` so the fire gate's `at` (`:557`)
reads the perceived vector. **Target SELECTION stays on the TRUE bearing** — `nearestEnemyTo`,
`aimedEnemy`, the >120° `ALLY_BEHIND_ANGLE` arm at `:399-404` — those are questions about geometry, not
about aim, and perturbing them would make the manoeuvre state machine flap.

**d) Point defence** (`:495-504`) — same shape with the §3.2 constants and the closing correction:

```js
const pdAt = perceivedIntercept(a, a.intercept, interceptDir, id, gunSpeed(a), dt);
const aim = aimWithDrift(pdAt, a.vel, gunSpeed(a));
desired = Math.atan2(aim.x, aim.z);
interceptDir = pdAt;      // the fire gate must judge against the same vector (`at`, :557)
```

`interceptDist` stays the true distance.

**e) No target, no drift.** When he has no ship target (escorting, retreating, player dead), clear
`_aimTarget` so the next acquisition cannot compute a fake rate spike off a stale `_aimBearing`. Make it
explicit rather than relying on the identity check alone.

**f) The retreat** (`:375-387`) — add the slab helper next to `approachThrust`, and apply §3.3:

```js
// How far a ray from `pos` along the unit (dx,dz) can run before it leaves the ±half square centred on
// `c` — the ARENA box. 0 when he is already outside it (which reads as "he has reached the edge") or when
// the ray heads away on both axes. Recomputed every tick, so a DRIFTING zone is followed for free.
export function edgeRemaining(pos, dx, dz, c, half) { … }
```

Extend the existing comment block with the max() rule, the `?roam` → 0 degradation, the
which-speed-for-which-destination note, and the chase arithmetic.

### S5 — `client/src/sim-core/ally.js` + `ace.js`: the spawn ordinal

- `makeSentinelHull(catalog)` → `makeSentinelHull(catalog, ordinal = 0)`: set
  `a._aimOrdinal = ordinal | 0` beside `a.intercept = null`, commented as the **only** input that separates
  two pilots' aim streams.
- `makeAlly(catalog)` keeps ordinal **0**. `makeAce(catalog, ordinal)` (`ace.js:59`) passes it through;
  the spawn loop at `ace.js:83` passes **`i + 1`**, so an ace can never share a stream with a wingman in a
  `?duel` fought with `?ally` on — two identical pilots flying one fight is exactly the lockstep
  `ACE_SPAWN_STAGGER` exists to break.
- **Do not** seed at build time; `pilotRandom` is lazy and both spawn paths run after `seedSim()`.
- Update the "DRAWS NOTHING FROM THE SEEDED STREAM" headers in `ally.js`, `ace.js` and `step-ally.js:27`
  to say *why that is still true*: a private stream, not no randomness.

### S6 — tests (§5) · S7 — docs (§7) · S8 — guards (§6)

## 5. Tests

`cd <worktree>/client && node --test` and `cd <worktree>/server && npm test` (Postgres; `pretest` drops and
recreates `spacegame_test`).

### 5.0 Two rules that keep these tests from becoming lotteries

1. **`seedSim` is PROCESS-GLOBAL and `pilotRandom` reads it lazily**, so without care the seed left
   installed by an earlier test (e.g. `ace.test.js:68` installs 12345) would decide a later test's
   outcome — **test order would become a hidden input**. Every test below that exercises the aim
   **installs its own seed before the first step**, and every *statistical* test **aggregates over K
   pilot seeds** (`for (let s = 1; s <= K; s++) { seedSim(s); …rebuild the pilot… }`) so no single stream
   can carry it. Restore with `seedSim(null)` at the end where a test installed one.
2. **A test about a GATE pins the aim error to zero; a test about the AIM lets it run.** The error state
   lives on the pilot, so a fixture that already pins pose per tick adds
   `a._aimJitter = 0; a._aimKick = 0; a._aimJitterT = Infinity;` on the same line. This is how the
   rocket/§2.6 gate tests stay about what they are about (§5.3).

### 5.1 Mechanism — `client/src/sim-core/step-ally.test.js`

These measure the aim **angle** against `thetaHit`; the **outcome** tests that fire real bullets at real
catalog hulls live in §5.2, where a catalog exists.

First, give the shared `enemy()` helper (`:44`) a realistic broad radius — **without `hitBoxes`**:

```js
sizeScale: 1.6,   // broadRadius falls back to LEGACY_R × sizeScale = 4.16 u ≈ the real Basic pirate's 4.153.
                  // Do NOT fake `hitBoxes: [{}]` to get there: broadRadius would be right and the NARROW
                  // phase would throw (collision.js:143 reads b.c.x) the moment a projectile is stepped.
```

- **(a) a SETTLED solution lands every shot.** Pinned pilot (re-set `pos`/`vel` each tick, as `:608`
  already does), stationary target at 40 u. Step 120 ticks so the acquisition kick decays, then assert
  `aimOff ≤ thetaHit` on **every** one of the next 600 ticks, aggregated over 20 seeds. Comment that the
  first ~1.5 s are skipped *by design* — the kick is the first-shot rule, pinned by (e).
- **(b) a CROSSING target drags the aim, and it LAGS — pinned UNSATURATED.** Re-place the target each tick
  on a 40 u circle at **0.25 rad/s (a 10 u/s crossing)**. At that rate `m = LAG × 10 / hitR ≈ 1.17`, well
  inside `ALLY_AIM_MAX = 3.00`, so the clamp is idle and the assertion actually pins the coefficient:
  the **mean signed error has the opposite sign to the bearing rate** (it LAGS, it does not lead) and its
  magnitude is within **±25 %** of `LAG × v_perp / hitR` in `thetaHit` units.
  **Do not use a 30 u/s crossing here**: `m` would be 3.5 against a cap of 3.0, the clamp would be active,
  and the band could not tell `LAG = 0.17` from `0.20` — it would only catch a sign flip or a dead
  smoothing filter. That saturated case is (c)'s job, not this one.
  This test pins the *mechanism*, never a miss rate, because §1.1 shows the miss rate in the fast-crossing
  regime is 100 % with or without the feature.
- **(c) the CAP holds.** Over both runs, `aimOff ≤ ALLY_AIM_MAX × thetaHit + 1e-9`, always.
- **(d) two pilots with different ordinals fly different fights** — identical geometry, `_aimOrdinal`
  0 and 1 → headings differ within 2 s; **and** the same ordinal + the same seed reproduces the same
  heading bit-for-bit (the determinism half).
- **(e) THE COUPLING — one cooldown of decay, and the second shot lands.** Two halves:
  1. arithmetic, so it fails loudly if a constant moves:
     `ALLY_AIM_KICK * Math.pow(1 - (1/60)/ALLY_AIM_TAU_SEC, 36) + ALLY_AIM_JITTER < 1`, commented that
     **36 ticks IS the Heavy cannon's 0.6 s `fireCooldown`** and that a faster gun breaks the promise
     (DECISIONS §152);
  2. behavioural — force `_aimKick = ALLY_AIM_KICK`, `_aimJitter = ALLY_AIM_JITTER` (worst case) against a
     stationary pinned target, step 36 ticks, assert `aimOff ≤ thetaHit`.
- **(f) the FIRST shot carries a miss chance.** Re-acquire ~200 times across ≥20 seeds, sampling
  `aimOff > thetaHit` on the acquisition tick → fraction in **[0.35, 0.65]** (design point 0.50).
- **(g) ZERO seeded draws, still.** Extend the existing `:485` test's fight to include an acquisition, a
  target switch and an intercept; keep `assert.equal(simRandomDraws(), before)` unchanged.
- **(h) `edgeRemaining` as a pure unit:** from the centre along +x → `ARENA`; diagonally from inside → the
  nearer slab; already outside → 0; heading away on both axes → 0; a **drifted** centre shifts the answer
  by exactly the drift.

### 5.2 Outcome — `server/src/ally-sim.test.js` (real catalog, real bullets)

This is the half the review was right to demand: everything in §5.1 could pass while the game misses
settled shots.

- **(i) a SETTLED solution connects, on BOTH aspects, with real bullets.** Real world
  (`createSimWorld({ levelName: 'level-4', ally: 'wave-1' })`), a real `pirate gunner` at 30 u, pilot pinned
  (the `:269` fixture is the template). Run it at the target's **NARROWEST heading (0.46 rad for a pirate
  gunner)** and at its widest (≈1.57) — **and repeat the narrow case against an `advanced medium pirate` at
  heading 0.24**, which is the hull that BINDS `ALLY_AIM_HIT_FRAC` (§3.0) and therefore the worst case the
  promise has to survive. After a 2 s settle, count shots fired (`fire` events / bullets spawned) and hits
  landed (`stepBullets` damage), aggregated over 10 seeds: assert **every** shot connects. This is the test
  that fails if the yardstick regresses to `broadRadius`.
- **(j) POINT DEFENCE, in a CLOSING engagement, at the pinned rate.** Not a rocket parked at a fixed
  range — spawn a real Rocket (homing) at 45 u closing on the pilot, run `stepAlly` + `stepBullets` +
  `stepRockets` to resolution, repeat over ≥40 seeds, and assert **kills-per-shot-fired ∈ [0.35, 0.65]**
  (design point 0.50) and **rockets-destroyed ∈ [0.55, 0.95]** of rockets engaged (design point 0.75-0.88).
- **(m) THE YARDSTICK GUARD — `ALLY_AIM_HIT_FRAC` is still true of every hull.** Sweep
  `segmentHitsShip` laterally at `BULLET_PLANE_Y` over **≥144 headings** for the Sentinel hull and for
  every `catalog.enemyShips` row (all nine — there is no level filter), and assert
  `ALLY_AIM_HIT_FRAC * broadRadius(ship) <= narrowestContiguousHalfWidth(ship)`. Log the measured ratio per
  hull in the failure message: the floor is grid-sensitive (0.374 at 1.25° steps, 0.378 at 2.5°), which is
  part of why `HIT_FRAC` is 0.35 and not 0.37. This is exactly the
  measurement of §3.0, kept live: a re-exported model, a new `lift`, a new enemy or a re-scaled hull would
  otherwise silently break "a settled solution lands" with every other test still green.

### 5.3 Existing assertions that MUST change

| file:line | assertion | what to do |
|---|---|---|
| `client/src/sim-core/step-ally.test.js:363-371` `'he settles AT the break-off distance…'` | `gap ∈ ALLY_BREAK_OFF_DIST ± 15`, `vel < 3` after 30 s | **Rewrite** as *'he runs to the ARENA EDGE and comes to rest there'*: from `centreDist: 100` running along +x, after 30 s assert (1) within **±25 u of `world.arenaCenter.x + ARENA`**, (2) `vel.length() < 3` (the kinematic-arrival half), (3) `gap > ALLY_BREAK_OFF_DIST` (the floor is still honoured). Keep the retired-rule commentary; add why the 120 u hold became a floor. |
| — (new, same block) | — | **CHASED, he flies past the border:** drive the enemy at him at **30 u/s** for 30 s → his distance from `arenaCenter` exceeds `ARENA` on at least one axis, and the gap never collapses to 0. |
| — (new, same block) | — | **`?roam` keeps the old rule:** same fixture with `w.roam = true` → after 30 s `gap ∈ ALLY_BREAK_OFF_DIST ± 15` and `vel < 3` — the exact pair retired above, kept alive where it still applies. |
| `client/src/sim-core/step-ally.test.js:184-211` `'the come-about BRAKES AND TURNS TOGETHER…'` | `gap <= ALLY_TURN_EXIT_ANGLE + 1e-6` vs the **true** bearing | The exit is now judged on the **perceived** bearing. Relax to `ALLY_TURN_EXIT_ANGLE + ALLY_AIM_MAX * (ALLY_AIM_HIT_FRAC * broadRadius(e) / dist) + 1e-6`, commented "the nose ends inside the exit angle **of where he thinks the target is**". Brake/turn and re-acceleration assertions are unaffected. |
| `client/src/sim-core/step-ally.test.js:608-627` `'the ALLY in flight: his bullet flies at a stationary enemy…'` | `off < 0.02` | He now carries a standing jitter, so an exact-bearing pin is no longer the contract. Change to `off <= thetaHit` (the shot still lands **on the hull**). Nothing is lost: `aimWithDrift`'s exactness is pinned by the pure test at `:508`, which does not go through the pilot. `noseOff > 0.15` is unaffected. |
| `client/src/sim-core/ace.test.js:213` `'an ace whose target is TOO FAR turns onto an incoming rocket and shoots it down'` | `w.rockets.length === 0`, `ace.hp === ace.maxHp` | The engagement gives ~3 shots, so at 50 %/shot a single seed is a 12.5 % coin flip. **Rewrite as a rate over seeds**: run the same fixture for `seedSim(s)`, `s = 1..20`, assert the rocket dies in **[0.55, 0.95]** of them and that the pilot **opened fire in every one** (the capability half, which is what this test was really for). Say in the comment that a per-shot miss chance is the reason it is a band now. |
| `client/src/sim-core/ace.test.js:303` `'the wingman intercepts while ESCORTING…'` | `w.rockets.length === 0` **and** `w.player.hp === w.player.maxHp` | Same treatment, same 20 seeds, same bands — and `player.hp` is asserted **only on the runs where the rocket died**, because a rocket that gets through is now an expected outcome, not a bug. |
| `server/src/ally-sim.test.js:269` `'…his Heavy cannon still HITS a stationary enemy'` | some damage landed over 8 s | **Survives, and must be made deliberate:** install a seed at the top, and keep the assertion — the settled-lands guarantee (§3.1) is exactly what makes it true. Add a line noting it is now also a guard on that guarantee. (Its 8 s window is ~13 shots, and only the first one can be lost to the kick.) |
| `server/src/ally-sim.test.js:309` `driftFireCase` (feeds `:337`, `:357`, `:363`, `:375`) | the four gate tests | **Pin the aim error to zero inside `tick()`** (rule 2 of §5.0). Required, not cosmetic: at the fixture's 40 u the total error can reach `2.7 × (0.35 × 4.153)/40 = 0.098 rad`, and `:363` ('the ROCKET is gated on the RAW bearing') depends on the nose sitting `0.48 − 0.40 = 0.08 rad` clear of the rocket's `aimTol` — the error would flip that test at random. **Also fix that test's stated contract**: the gate now compares the nose to the **perceived** bearing, not the raw one; what it proves is that the rocket is judged on **its own path (the nose)** rather than on the gun's drift-corrected line. Retitle accordingly. |
| `server/src/ally-sim.test.js` `'he holds fire rather than shooting through the player's hull (§2.6)'` | `bullets.length === 0` | **No change needed** — and record the margin so the next reader does not have to re-derive it: at the fixture's 30 u the cap is `3.0 × (0.35 × 4.153)/30 = 0.145 rad`, far inside the 0.35 rad block cone, so the nose can never swing out of it. Add one new case instead: with the error **live**, every bullet he does fire has a path more than `ALLY_FIRE_BLOCK_HALF_ANGLE` off the line to the player — the §2.6 rule is judged on the real path and is untouched by the aim error. |

### 5.4 Visual scenarios that observe this behaviour

- **`client/visual/scenarios/38-ally.mjs`** — two edits.
  1. `:83` + the on-screen check at `:98-101`: he now dashes to the arena edge when hurt, so a retreating
     wingman is off frame **by design**. Add `retreating: a.retreating` to the sampled fields (`:65-79`),
     filter the on-screen check to `!s.retreating`, and guard it with `if (framed.length)` so it cannot
     become a vacuous pass silently. Leave `alive.length === samples.length` as is — if 4 light pirates
     start killing him that is a real signal.
  2. `:154-155` (`last.kills > 0`, `last.allyKills === last.kills`): this is the **economy split**, not a
     kill-rate assertion, but it needs a fight to have happened and this change makes him materially less
     lethal (first-shot misses + close-crossing misses). **Raise the sample loop from 12 to 16**
     (`:63`, 1.5 s each → 24 s instead of 18 s) so the assertion keeps measuring what it is for. If it
     still fails, extend the window further — do **not** weaken the assertion.
- **`client/visual/scenarios/47-duel-room.mjs`** — no edit expected. `playerHp < 100` is asserted against
  an **idle** player (near-zero crossing rate → the aces hit), and the point-defence block wants
  `shotDown > 0` across many rockets in 60 s, which survives a 50 %-per-shot miss. **Run it** (§6).
- **`client/visual/scenarios/49-duel-referee.mjs`** — no edit expected; it is the guard for §3.4's
  divergence sensitivity. **Run it.**

## 6. Guards — what to run, and what NOT to

```
cd <worktree>/client && node --test
cd <worktree>/server && npm test
cd <worktree>/client && node visual/run.mjs 22-trace-replay      # the standing sim guard (4 kills, p0..p4, win)
cd <worktree>/client && node visual/run.mjs 38-ally
cd <worktree>/client && node visual/run.mjs 47-duel-room
cd <worktree>/client && node visual/run.mjs 49-duel-referee
```

**Do NOT run the full 49-scenario visual suite** — ~20-30 minutes, opt-in, the maintainer's call at the
pipeline's visual gate (DECISIONS §141). Before trusting any `visual/run.mjs` result check `lsof -i :4173`:
two worktrees running the harness at once silently test each other's code.

**Live check (the part no test sees):** `?duel` — confirm the aces' *first* shot at you often misses and
that they hit when you fly straight; `?ally=wave-1&level=4&debug` — hurt the wingman and confirm the
break-off reads as a dash to the edge, that chasing him keeps him running, and that he comes back healed.

## 7. Docs to update (in the worktree)

- **`docs/CHANGELOG.md`** — one dated bullet under `## 2026-09-11`, leading with a bold phrase, e.g.
  *"**The Sentinel pilot aims like a person now — and a retreat actually leaves the fight.**"* It must
  carry the **honest framing of §1.1**: the first shot at a new target misses ~50 %, a settled solution
  still lands every shot, the tracking lag bites in the close fight (inside ~11 u it outweighs the
  un-led flight-time error), and a fast crosser at range was already un-hittable before this change —
  flight time, not aim. Plus the ~50 %-per-shot point defence and the arena-edge retreat with its 120 u
  floor. Note the yardstick discovery (`broadRadius` overstates a real hull by up to 2.7×) — it is the
  kind of fact the next reader will need.
- **`docs/SUMMARY.md`** — edit in place in Gameplay → "The ally (a third combatant)":
  - the **"His nose is aimed for the GUN, not at the enemy"** bullet (~`:1490`) — add the tracking error:
    perceived **bearing** (not the nose, not the range), the measured hit-half-width yardstick, the
    first-shot/second-shot rule and its coupling to `fireCooldown`, the per-pilot private RNG drawing
    nothing from the seeded stream, and that the ace flies identical numbers. State plainly that leading a
    moving target is still not attempted, so long-range shots at a crosser miss for flight time.
  - the point-defence bullet (~`:1517`) — the ~50 %-per-shot dispersion measured at the **intercept**
    point, and the 2-3 shots a closing rocket allows. Keep the "13 fired, 5 shot down" live measurement but
    mark it **as the before-picture**.
  - the break-off bullet (~`:1547`) — replace "until that gap reaches `ALLY_BREAK_OFF_DIST` 120 u, holds
    there" with the border rule, the 120 u floor, which speed each destination is judged on, the `?roam`
    fallback, the chase behaviour, the ~30 s player OOB warp-back, and the **50-80 s total absence**.
  - the `ally-config.js` pointer (~`:4101`) and the test inventory (~`:4741`, `:4896`).
  - bump **`**Updated:**`** to 2026-09-11 with a one-line summary.
- **`docs/DECISIONS.md`** — two entries (next free numbers; the file ends at **§151**, so **§152** and
  **§153**; renumber if a parallel branch took them).
  - **§152 — The pilot misses by misreading the BEARING, measured against the hull it can actually hit,
    and "the second shot lands" is a consequence of τ.** Record: (1) why the error is on the perceived
    bearing and not the nose (the fire gate would make him hold fire instead of missing — the mechanic
    would silently invert); (2) **the yardstick**: `broadRadius` is the enclosing sphere and overstates a
    real hull by up to 2.7× at the bullet plane (measured table, **binding hull `pirate mini boss` /
    `advanced medium pirate` at 0.374** — and note that a three-hull sample suggests 0.42 and is wrong, so
    the measurement has to cover every row), so the error is scaled by `ALLY_AIM_HIT_FRAC × broadRadius`
    and test (m) keeps that fraction honest against model drift — the first draft of this feature would
    have lost ~13 % of *settled* shots on the player hull and ~25 % on the mini boss; (3) why
    the randomness is a **private per-pilot mulberry32** and not `simRandom()` (§73's draw count is half
    the divergence oracle and half the duel referee's verdict); (4) **the coupling, named**: acquisition
    kicks the error and it decays with `ALLY_AIM_TAU_SEC` 0.30 s, so "the second shot lands" is
    `2.00 × 0.1277 + 0.70 = 0.955 < 1` **against the Heavy cannon's 0.6 s `fireCooldown` and nothing
    else** — hand this pilot one of the catalog's 0.12-0.18 s kinetics and its first three or four shots
    would miss instead, with no test on the current weapon showing it. Name the rejected alternative (an
    explicit one-off snap-shot flag consumed by the first shot) and why: one continuous mechanic reads as
    human, a flag reads as a rule. (5) Point defence carries its own constant **and the closing
    correction**, because the bullet meets the rocket at 0.64-0.84 of the range the error was computed at —
    ignoring that would have delivered 73 % hits where 50 % was agreed. (6) **What this feature does and
    does not change**, so nobody re-litigates it later: it does not make fast crossers harder — they were
    already un-hittable, because `aimWithDrift` does not lead — it makes the *first* shot fallible and the
    *close* fight fallible.
  - **§153 — A retreating pilot runs to the arena EDGE, floored by the break-off gap.** The trade-off: a
    break-off that stops 120 u away reads as "wandered off", so he dashes for the ±`ARENA` border at full
    thrust and heals there — at the cost of **50-80 s** out of the fight (9-20 s out, ~40 s healing, 9-20 s
    back). The floor `max(border, 120 − gap)` is the previous retreat bug's lesson applied in advance: a
    border-only rule guarantees nothing about the distance to the thing shooting at him. Each destination
    is judged on its **own** arrival speed — the gap-opening rate for the moving threat, ground speed along
    the course for the fixed border. `?roam` degrades to the old rule with no branch. Chasing him works and
    self-resolves via the player's own 30 s OOB warp-back — accepted, not designed around.

## 8. Out of scope (do not gold-plate — DECISIONS §30)

- **`stepEnemyAI` stays untouched.** The test at `step-ally.test.js:629` that pins this must stay green.
- **No leading a moving target.** `aimWithDrift` corrects the *shooter's* drift only. Adding a lead
  solution would change the whole balance of the feature and is explicitly not attempted here — §1.1 says
  plainly that flight time owns the long-range crossing case, and it stays that way.
- **No per-side tuning**, no `ctx` fields, no difficulty scaling, no per-level constants.
- **No per-shot dispersion knob.** The coherent tracking error is the mechanic; a second per-projectile
  scatter would need `updateGroups` plumbing to reach the muzzle and buys nothing the error does not give.
- **No Level-4 rebalance**, no change to `ALLY_RETREAT_HP_FRAC` / `ALLY_REJOIN_HP_FRAC`, the repair drone,
  or `ALLY_BREAK_OFF_DIST` itself (120 stays; it is now a floor).
- **No new player-facing copy**, no HUD, no log line.
- **No model, texture or sound change** → **no `publish-itch` step and no `CREDITS.md` question**; no
  content hash moves.
