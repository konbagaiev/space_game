# Fix the Level-0 intro replay desync — opt-in seeded RNG, a stall watchdog, and a headless guard test

**Feature id:** `2026-07-26-0009-fix-intro-replay-desync`
**Baseline:** branched from `0e5766a` ("feat(fx): flipbook explosions + kinetic energy bolts").
**Type:** bug fix + determinism refactor. Touches the client sim/FX RNG plumbing, the replay/cutscene
lifecycle, the headless visual suite, and one asset-pipeline guard. No server behavior change (one
`catalog_seed.js` string is swapped at the very end, by the maintainer, when the new trace is recorded).

---

## Goal

The Level-0 intro cutscene desyncs. It re-simulates a canonical **input-replay** trace
(`client/assets/recordings/level0-intro.a39d1f46.json`, recorded 2026-07-10, named by `introTrace` on the
`level-1` descriptor at `server/src/catalog_seed.js:402`) through the real `sim`. On current `main` that
trace no longer reproduces the recorded fight: the first kill lands, then the ship flies and shoots at
empty space, enemies 3 and 4 are never killed, cards p3/p4 never fire and the level never clears — so a
brand-new player's very first impression of the game is a broken cutscene.

The root cause is **not** the individual commits that broke it; it is that the seeded sim RNG is
*opt-out*. `main.js` swaps a seeded `Math.random` in around `update()`/`reset()`, so **every** draw made
anywhere inside those calls — including purely cosmetic explosion sparks, exhaust puffs and set-piece
decor — consumes the seeded stream. Change any FX or decor code and the stream shifts, and the recorded
input no longer lines up with the fight. That has now shipped **three times** (`db78736` shield sphere →
extra absorbed hits → extra `spawnExplosion` spark draws; `7d8fa50` asteroid-field model → different decor
draw count/order inside `reset()`; `0e5766a` flipbook/bolt FX → the `spawnExplosion` path again).

This change makes the seeded stream **opt-in**: a new `client/src/sim-random.js` exports `simRandom()`, the
~8 real *gameplay* draw sites call it explicitly, and the global `Math.random` monkey-patching
(`withSimRand` in `main.js`, `installSeededRandom` in `bench.js`) is deleted. New FX/decor code is then
replay-safe **by default** — this class of bug cannot come back. On top of that we add (a) **two termination
fixes** so a failed re-sim can never dead-end: a **watchdog** on the return-home phase (the one path with no
exit) plus the missing end-of-trace exit in `__replay.step()`, both routing through the normal
`cutsceneEnd()` → `finishIntro()` path (progress 1→2 → Level 1 briefing); and (b) a **committed headless
guard test** that re-sims the canonical intro trace and asserts the outcome (4 kills, cards p0..p4, win), so
a regression fails a test run instead of shipping.

Because purification necessarily shifts the seeded stream, the 2026-07-10 trace **cannot** survive it. The
intro trace is re-recorded by the maintainer at the live-test stage; the checklist is Step 9.

### Why the current trace is unsalvageable (read this before proposing an alternative)

Inside the seeded scope, cosmetic draws vastly outnumber gameplay draws:

- `emitExhaust` (`client/src/projectiles.js:213-218`) draws **2-3 randoms per ship per tick** (a thinning
  roll on lower tiers + two spread offsets) — with 2-4 ships alive that is thousands of draws per fight.
- `spawnShipExplosion` (`client/src/projectiles.js:118-124`) draws **~5 per spark**, up to 22 sparks per
  kill; `spawnRocketBurst` (`:167-173`) the same for 8 sparks per detonation; `spawnSmoke` (`:335,341`)
  2 per rocket-trail puff.
- Set-piece decor is built inside `reset()` (`client/src/sim.js:869`, `for (const spec of G.mapSetpieces)
  buildSetPiece(spec)`), and `makeAsteroidField` alone draws ~11 per rock × 14 rocks + 2 × 50 beam
  particles per rig (`client/src/world.js:555-558,593`) — i.e. the stream is already displaced *before
  tick 0*.

There is no way to remove those from the stream and still have the recorded input hit the same enemies.
Re-recording is mandatory, not a fallback.

**Bonus bug this also fixes:** several of those cosmetic draw counts are gated on the graphics tier
(`G.gfx.particleScale`, `G.gfx.maxParticles` — see `projectiles.js:213` and `:110`). With the current
opt-out model the intro trace is therefore **tier-dependent**: the same trace consumes a *different* number
of seeded values on a Performance-tier phone than on a High-tier desktop, so the intro can desync on a weak
device with no code change at all. Opt-in removes that too.

---

## Decisions (already settled — do not re-open)

1. **Opt-in seeded RNG.** New `client/src/sim-random.js` (`simRandom()` + `seedSim(seed)`); the gameplay
   draw sites call `simRandom()` explicitly; `withSimRand` (`main.js:79`) and `installSeededRandom`
   (`bench.js:50`) are deleted. Accepted consequence: decor/asteroid layout now varies between playbacks of
   the same trace (cosmetic only — in normal play it already varies run to run). Recorded as a **new**
   DECISIONS entry (§73) that amends §62; §62 itself is not rewritten.
2. **Stall watchdog**, scoped to the **return-home stall**: `rs.cutReturning` is engaged (the fight cleared,
   the autopilot is flying to the station) but the level can never be won, so no tick ever ends the run.
   After ~15 s of sim time in that state → end the cutscene through the normal `cutsceneEnd()` →
   `finishIntro()` path (progress 1→2 → Level 1 briefing), exactly like Skip. The counter lives on the
   `makeReplaySession()` object in `replay.js` so it is unit-testable.
   **Correction to the discovery framing:** the watchdog does **not** rescue *today's* desync. Today's run
   exhausts the trace with enemies still alive, and that path already terminates —
   `if (rs.play && rs.done && rs.cut && !rs.cutDone) cutsceneEnd();` at `client/src/main.js:620` fires the
   tick the trace runs out, and in intro mode `cutsceneEnd()` calls `finishIntro()`. So today's player gets an
   intro that **cuts out mid-fight** and dumps them on the Level 1 briefing with no victory — bad, but not a
   hang. What actually fixes today's symptom is Steps 1-3 + the re-record (Step 9); the watchdog closes the
   one path that genuinely has no exit, and Step 4 also mirrors `main.js:620` into `__replay.step()` (which
   lacks it) so the guard test terminates the same way the game does. No temporary `introTrace` removal is
   needed either way.
3. **Guard test** = `client/visual/scenarios/22-intro-replay.mjs`, run by the existing
   `npm run test:visual`. It navigates to its **own** URL (`?playback&id=…&cutscene=1&debug`) because the
   runner's base URL carries no `?playback`; it fast-steps via `window.__replay.step()` + `advance()` on
   freeze and asserts 4 kills, cards `p0..p4`, `cut().won === true`. It **hard-fails** with a "run
   `npm run assets:pull`" message when the recording is absent. No CI change.
   **Correction to the discovery framing:** `?debug` does **not** suppress playback — bootstrap takes the
   `rs.play` branch at `main.js:1320`, *before* the `shouldPlayIntro` headless gate at `:1329`. It only skips
   `prewarmShaders` (`main.js:1345`, explicitly "very slow on the headless visual") and takes the procedural
   asteroid branch — both render/decor-only, and after this change decor is off the seeded stream, so the
   flag is sim-neutral. We therefore **keep `&debug`** for speed/stability under swiftshader; see the
   scenario comment in Step 6 for the invariant it relies on.
4. **Re-record by the maintainer**, by hand, at the pipeline's live-test stage (Step 9). The guard test is
   validated against the NEW trace before merge.
5. **Keep** the shield-sphere interception (`db78736`) and the `.glb` asteroid field (`7d8fa50`). They are
   shipped features; after purification they are replay-neutral (the shield changes only the player's
   HP/shield, which feeds back into nothing the enemies do).

---

## Step 1 — `client/src/sim-random.js` (new, pure, node-testable)

Create the leaf module. It must import nothing (so `drops-config.js` / `spawn-timing.js` stay dependency-free
and node-safe) — so **move** `mulberry32` here from `bench.js` and re-export it there for back-compat.

```js
// The SEEDED SIM RNG — the single source of randomness for GAMEPLAY draws (spawn timing, spawn positions,
// which enemy spawns, enemy reload jitter, loot rolls). Deterministic input-replay (?record/?playback, the
// Level-0 intro cutscene, the ?bench perf gate) reproduces a fight from (seed + per-tick input), which only
// works if the seeded stream is consumed by the SIM and by nothing else.
//
// This is OPT-IN by design (DECISIONS §73): cosmetic code — explosion sparks, exhaust, smoke, shield/flipbook
// /bolt FX, world decor + set-pieces — keeps calling plain Math.random and is therefore replay-NEUTRAL.
// The previous opt-out model (a seeded Math.random swapped in around update()/reset()) meant any FX or decor
// change silently shifted the stream and broke the recorded intro; it did, three times.
//
// RULE FOR NEW CODE: if a draw changes what the SIM does (positions, timing, damage, loot), call simRandom().
// If it only changes what the frame LOOKS like, call Math.random(). When in doubt: cosmetic.

// mulberry32 — tiny, fast, well-distributed 32-bit PRNG; the same seed reproduces the same sequence.
export function mulberry32(seed) { /* moved verbatim from bench.js:37-44 */ }

let rand = null; // null = live play (native Math.random); a function = a seeded record/playback/bench run.

// Install (or clear) the seeded stream. seedSim(n) → deterministic; seedSim(null) → back to native.
// Called at record start, at playback/intro arm, by the ?bench replayer, and cleared on teardown.
export function seedSim(seed) { rand = (seed == null) ? null : mulberry32(seed >>> 0); }

// One gameplay random in [0,1). Falls back to Math.random when no seed is installed (normal play).
export function simRandom() { return rand ? rand() : Math.random(); }

// True while a seeded stream is installed (diagnostics / tests).
export function isSimSeeded() { return rand !== null; }
```

`client/src/bench.js`: delete `installSeededRandom` (line 50) and the `mulberry32` body (lines 35-44);
add `export { mulberry32 } from './sim-random.js';` so `bench.test.js:3,42-48` and any other importer keep
working unchanged. Update the file-header comment (it still describes a global override).

**Tests** — new `client/src/sim-random.test.js`:
- `seedSim(1234567)` → two fresh streams from the same seed produce identical sequences; a different seed
  diverges (mirror `bench.test.js:42-48`).
- `simRandom()` with no seed installed calls `Math.random` — stub `Math.random = () => 0.4242` and assert the
  return value, then restore.
- `seedSim(7); simRandom(); seedSim(null); simRandom()` → the post-clear call uses the stubbed native RNG
  (i.e. the teardown invariant: clearing really returns to live play).
- `seedSim(7)` twice rewinds to the same first value (idempotent re-seed — record/playback rely on it).

---

## Step 2 — classify every draw site, convert the GAMEPLAY ones

**This classification IS the fix.** Convert exactly these to `simRandom()` (import
`{ simRandom } from './sim-random.js'`); leave everything else on `Math.random`.

### GAMEPLAY → `simRandom()`

| # | Site | What it decides | Note |
|---|------|-----------------|------|
| 1 | `client/src/sim.js:149` (`levelRunner.pickShip`, `let r = Math.random() * total`) | which enemy ship type spawns from the phase pool | unambiguous |
| 2 | `client/src/sim.js:757` (`else if (Math.random() < DROP_CHANCE)`) | whether a killed enemy drops loot | unambiguous |
| 3 | `client/src/drops-config.js:79` (`pickLoot`, `pool[(Math.random() * pool.length) | 0]`) | which item drops | pure leaf; import `simRandom` directly (keeps the call signature) |
| 4 | `client/src/ship-build.js:95` (`heading: Math.random() * Math.PI * 2`) | an enemy's initial facing | **judgement call: gameplay.** Facing decides how long the enemy turns before its first shot → it changes the fight, not just the picture |
| 5 | `client/src/ship-build.js:115` (`const ang = Math.random() * Math.PI * 2`) | spawn angle on the ring around `arenaCenter` | unambiguous |
| 6 | `client/src/ship-build.js:116` (`const d = 70 + Math.random() * 60`) | spawn distance | unambiguous |
| 7 | `client/src/ship-build.js:167` (`g.cooldown = g.reload + (isPlayer ? 0 : Math.random() * 0.5)`) | enemy reload stagger | **judgement call: gameplay.** It shifts when enemy bullets exist |
| 8 | `client/src/sim.js:172` — the `stepSpawnGate({...})` call | the 2-4 s spawn cooldown | pass `simRandom` **explicitly** as the 2nd arg: `stepSpawnGate({...}, simRandom)` |

For #8, keep `client/src/spawn-timing.js` a dependency-free pure leaf: do **not** import `sim-random` there.
Leave the `rand = Math.random` default parameters (`spawn-timing.js:12` and `:20`) but update their comments
to: *"injectable RNG — the sim MUST pass `simRandom` (see sim.js); the `Math.random` default exists for
tests only."* Its unit tests keep injecting stubs and need no change.

**Leave `client/src/level-sim.js:42` alone.** It is the second `stepSpawnGate` caller (the pure, headless
projection used to precompute `enemyTotal`) and it already injects its own `rand` argument. It is not the
live sim and must **not** be switched to `simRandom` — do not "fix" it.

### COSMETIC → stays on `Math.random` (now genuinely native, since nothing swaps it any more)

- `client/src/projectiles.js:118,121,122,123,124` (ship-explosion sparks), `:167,170,171,172,173`
  (rocket-burst sparks), `:213,217,218` (exhaust thinning + spread), `:335,341` (rocket smoke).
- `client/src/world.js` — **all 27 draws**: stars (`:65-68,88-89,113`), nebula/planet textures
  (`:289-303,325-343`), moon phase (`:366`), parallax asteroid ring (`:437-442`), mission asteroid-field
  scatter (`:555-558`) and beam particles (`:593`), and the mining-rig/exhaust jitter at `:671`.
- `client/src/main.js:688-689` (`__game.spawnTestDrop`, a `?debug`-only stress hook).
- `client/src/flipbook-fx.js`, `client/src/bolt-fx.js`, `client/src/shield-fx.js`,
  `client/src/ghost-battle.js` — **verified RNG-free today** (`flipbook-fx.js:150` uses a module counter for
  variety). Sweep them again during implementation and keep them that way; if a draw has appeared, it is
  cosmetic and stays on `Math.random`.
- `client/src/audio.js` — already has its own module-local `arand` (`:22-28`). Leave it; update only its
  comment (`:16`, it names `installSeededRandom`).

Add a short block comment at the top of `client/src/projectiles.js` and above `buildSetPiece` in
`client/src/world.js` stating the contract: *"Cosmetic FX/decor draw the NATIVE `Math.random` on purpose —
never `simRandom()`. Gameplay-affecting randomness lives in `sim-random.js`; keeping FX out of the seeded
stream is what makes the recorded intro/replays survive FX changes (DECISIONS §73)."*

---

## Step 3 — delete the global `Math.random` swapping

`client/src/main.js`:

| Line | Now | After |
|------|-----|-------|
| `:6` | imports `installSeededRandom, mulberry32` from `bench.js` | drop both from that import; add `import { seedSim } from './sim-random.js';` |
| `:63` comment | "mulberry32 seed installed at record start" | keep (still accurate) |
| `:74-79` | the `nativeRandom` const, `let simRand`, `withSimRand()` | **delete all three** (`nativeRandom` at `:76` has no other reference — verified). Replace the block comment with a 3-line pointer to `sim-random.js` |
| `:611` | `withSimRand(() => update(BENCH_DT));` | `update(BENCH_DT);` |
| `:784` | `installSeededRandom(trace.seed);` (in `__bench.replay`) | `seedSim(trace.seed);` |
| `:835` | `installSeededRandom(BENCH_SEED);` (in `bakeBackdrop`) | `seedSim(BENCH_SEED);` |
| `:914` | `simRand = mulberry32(recSeed);` | `seedSim(recSeed);` |
| `:924` | `withSimRand(() => reset());` | `reset();` |
| `:959` | `simRand = mulberry32(trace.seed);` | `seedSim(trace.seed);` |
| `:963` | `withSimRand(() => reset());` | `reset();` |
| `:1196` | `if (!simRand) return this.status();` (in `__replay.step`) | `if (!isSimSeeded()) return this.status();` (import `isSimSeeded` too) |
| `:1205` | `if (!rs.done) withSimRand(() => update(BENCH_DT));` | `if (!rs.done) update(BENCH_DT);` |
| `:1239` | `if (BENCH) installSeededRandom(BENCH_SEED);` | `if (BENCH) seedSim(BENCH_SEED);` |

**Clear the seed when a session ends** (so live play after the intro is not running off a stale mulberry32
stream): add `seedSim(null);` next to `rs.teardown()` in `finishIntro()` (`main.js:1057`) and at the end of
`stopRecordSession()` (`main.js:~936`). Cover the first one in the sim-random unit test (Step 1, third
bullet) — this is the same "teardown must clear every field" invariant the 2026-07-10 dead-screen bug
violated.

---

## Step 4 — two termination fixes: mirror the end-of-trace exit into `step()`, then add the return-home watchdog

There are **two** distinct ways a desynced cutscene can fail to end, and they need different fixes. Get this
distinction right — the naive "watchdog after `cutsceneObserve()`" does **not** cover the first one.

### 4a. Trace exhausted with the fight unfinished — already handled in `animate()`, MISSING in `step()`

Read the accumulator (`client/src/main.js:604-620`). The playback branch is:

```js
      while (replayAcc >= BENCH_DT && steps < 6 && !rs.done && !cutFrozen) {   // :604
        ...
        } else if (rs.play && rs.trace) {
          if (rs.index < rs.trace.ticks.length) applyInput(rs.trace.ticks[rs.index], keys, touchAim);
          else { rs.done = true; break; }                                      // :609  ← exits BEFORE update()
        }
        ...
        if (rs.cut) cutsceneObserve();                                         // :614
        ...
      }
      ...
      if (rs.play && rs.done && rs.cut && !rs.cutDone) cutsceneEnd();          // :620  ← the real exit
```

On the exhaustion tick the loop `break`s at `:609` **before** `update()`/`cutsceneObserve()`, and the loop
guard `!rs.done` keeps every later frame out of the body entirely. So **any** per-tick accounting placed
after `cutsceneObserve()` is unreachable in this mode — a watchdog there would never fire. `animate()`
survives only because of the post-loop line `:620`, which ends the cutscene (→ `finishIntro()` in intro
mode) on the very frame the trace runs out. **Keep `:620` exactly as is.**

`__replay.step()` (`main.js:1195-1211`) mirrors the same loop (break at `:1203`, observe at `:1208`) but has
**no** post-loop equivalent — so a stepped run just returns with `rs.done === true`, `cut().done === false`
forever. Add the mirror right after its `for` loop, before `return this.status();`:

```js
      // Mirror animate()'s post-loop exit (main.js:620): when the trace runs out with the fight unfinished,
      // end the cutscene instead of returning a session that can never progress. Without this, a stepped
      // guard-test run of a DESYNCED trace never terminates (the loop body is unreachable once rs.done).
      if (rs.play && rs.done && rs.cut && !rs.cutDone) cutsceneEnd();
```

This is what makes the guard test (Step 6) terminate deterministically on a desynced trace instead of
spinning to a Playwright timeout, and it keeps `step()` faithful to `animate()` — which is its contract.

### 4b. Return-home stall — the one path with no exit at all

`cutsceneObserve()` (`main.js:1105-1111`) flips `rs.cutReturning = true` when the fight clears and lets the
autopilot fly home; only the win ends the cutscene. While returning, `rs.index` is frozen and `rs.done` is
never set — so the loop body **does** keep executing every tick, and if the level can never be won (the
player is dead, or a future desync leaves the ship unable to dock) it runs forever. This is where the
per-tick watchdog belongs, and it is reachable here precisely because `rs.done` is false.

`client/src/replay.js` — extend `makeReplaySession()` (`:88-113`):

```js
// ~15 s of sim time at the fixed 1/60 step. Once the cutscene engages "return to base" (rs.cutReturning)
// only a WIN ends it: rs.index is frozen and rs.done is never set, so a run that can never dock (dead
// player, or a desync that leaves the ship unable to reach the station) loops forever. This bail-out ends
// it through the normal path (cutsceneEnd → finishIntro) = "the intro stops early and you land on the
// Level 1 briefing" instead of a dead screen.
// The limit must clear a LEGITIMATE flight home: the station sits at [-60,-42,-60] (catalog_seed.js:656),
// BASE_ARRIVE_RADIUS = 45 (autopilot-config.js:5) and PLAYER_MAX_SPEED = 30 (sim.js:345), so a fight that
// ends ~200 u out is a ~7-8 s flight — 8 s would abort real intros. 15 s is ~2× the expected worst case;
// Step 9 measures the actual value on the new recording and bumps this if it lands within 2×.
export const CUTSCENE_STALL_TICKS = 900;
```

inside the returned object:

```js
  stallTicks: 0,       // consecutive RETURN-HOME ticks without a win (see CUTSCENE_STALL_TICKS)
  // Count one stepped tick. `returningNoWin` = rs.cutReturning is engaged and the level is still not won.
  noteTick(returningNoWin) { this.stallTicks = returningNoWin ? this.stallTicks + 1 : 0; return this.stallTicks; },
  stalled(limitTicks = CUTSCENE_STALL_TICKS) { return this.stallTicks >= limitTicks; },
```

and add `this.stallTicks = 0;` to `teardown()`.

`client/src/main.js` — inside the accumulator loop, right after `if (rs.cut) cutsceneObserve();`
(`:614`), before `replayAcc -= BENCH_DT;`:

```js
        if (rs.cut && !rs.cutDone) {                 // watchdog: see makeReplaySession/CUTSCENE_STALL_TICKS
          rs.noteTick(rs.cutReturning && !levelRunner.won);   // ONLY the return-home path reaches this line:
          if (rs.stalled()) {                                 // an exhausted trace breaks at :609 (see 4a)
            cutsceneEnd(); rs.done = true; break;             // ends the intro via finishIntro()
          }
        }
```

Mirror the same block in `__replay.step()` after its `if (rs.cut) cutsceneObserve();` (`:1208`) — together
with the 4a post-loop mirror, that gives `step()` both exits and makes the guard test terminate **fast and
deterministically** on either failure mode instead of spinning to a Playwright timeout.

Do **not** try to fold "trace exhausted" into `noteTick` (e.g. `(rs.cutReturning || rs.done)`): that
condition is unreachable in this position (4a), and writing it there would create the false impression that
the exhaustion case is watchdog-covered when it is actually covered by `:620` / the 4a mirror.

**The watchdog does not mask a desync**: the guard test asserts kills/cards/win, so a bailed-out run fails
its assertions — the watchdog only turns an infinite hang into an immediate, readable failure (and, for a
real player, into a graceful landing on the Level 1 briefing).

**Tests** — extend `client/src/replay.test.js`:
- `noteTick(true)` increments, `noteTick(false)` resets to 0, `stalled()` flips at `CUTSCENE_STALL_TICKS`.
- `teardown()` clears `stallTicks` **and** every pre-existing field (extend the existing teardown test's
  field list; the invariant is "teardown clears every field").

---

## Step 5 — two tiny affordances the guard test needs

1. `client/src/main.js:1184` — expose the arm gate in `__replay.status()`:
   `status: () => ({ recording: recCapturing, armed: rs.armed, ticks: recTicks.length, playIndex: rs.index,
   playDone: rs.done, total: rs.trace ? rs.trace.ticks.length : 0 })`.
   **Load-bearing:** the ship `.glb` sets `mesh.userData.noseZ`/`tailZ`, which decide where bullets spawn —
   stepping before the model has loaded changes the sim. `rs.armed` is exactly the "models ready" gate, so
   the test must wait on it (the orchestrator's probe approximated this with a `hitBoxes` check + a 3 s
   sleep; `armed` is the honest signal).
2. `client/visual/run.mjs:82-85` (the `// 3. discover scenarios` block) — accept an optional name filter so
   one scenario can be re-run alone:
   ```js
   const only = process.argv[2] || '';                       // e.g. `node visual/run.mjs 22-intro-replay`
   const files = (await readdir(path.join(__dirname, 'scenarios')))
     .filter((f) => f.endsWith('.mjs') && f.includes(only))
     .sort();
   ```
   Document it in `client/visual/README.md` (one line under how to run).

---

## Step 6 — the guard test: `client/visual/scenarios/22-intro-replay.mjs`

Prior art to read first (they already solve the two awkward parts — loading a trace the server does not
serve at `/recordings/{id}.json`, and auto-advancing the cards):
`/private/tmp/claude-501/-Users-kbagaiev-Projects-another-game-attempt/25fc385c-d482-47d3-8f4a-6b78cb00d280/scratchpad/intro-realtime.mjs`
and `…/scratchpad/probe-commit.sh`. Scenario conventions: `client/visual/scenarios/21-language-initial-ru.mjs`
(a scenario may navigate/reload on its own); scenarios receive `{ page, assert, shot, baseURL }`.

Shape:

```js
// The Level-0 intro cutscene must still re-sim the canonical trace to a WIN. The intro is an INPUT replay
// (input + seed re-run through the real sim), so ANY change that shifts the seeded gameplay stream desyncs
// it — that shipped unnoticed three times (shield sphere / asteroid glb / flipbook FX) before this guard
// existed. Runs on its OWN url (the runner's base url has no ?playback), fast-stepped via __replay.step()
// — watching it in real time would take ~50 s.
// `&debug` is kept for SPEED: it skips prewarmShaders (main.js:1345 — "very slow on the headless visual")
// and takes the procedural asteroid-field branch. Both are RENDER/DECOR only, and after DECISIONS §73 decor
// draws the native RNG, so ?debug is sim-neutral here. (It does NOT suppress playback: bootstrap branches on
// `rs.play` at main.js:1320, BEFORE the `shouldPlayIntro` headless gate at :1329.) If a future change ever
// makes ?debug affect the SIM, drop the flag from this url — fidelity beats speed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'intro-replay';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export default async function ({ page, assert, shot, baseURL }) {
  // 1. Resolve the trace the SEED points at (so a seed/asset mismatch fails here, not in prod).
  const seedSrc = fs.readFileSync(path.join(repoRoot, 'server/src/catalog_seed.js'), 'utf8');
  const m = seedSrc.match(/introTrace:\s*'([^']+)'/);
  assert.ok(m, 'catalog_seed.js level-1 descriptor carries an introTrace');
  const tracePath = path.join(repoRoot, 'client', m[1]);
  assert.ok(fs.existsSync(tracePath),
    `intro trace missing: ${tracePath}\n  It is a gitignored S3 asset — run \`npm run assets:pull\` from the repo root.`);
  const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));

  // 2. loadTrace() checks localStorage `replay:{id}` first; the server does NOT serve /recordings/{id}.json
  //    (the asset is content-hash-named under /assets/recordings/), so seed it there. Same origin as the
  //    page the runner already opened → the value survives the goto below.
  await page.evaluate(([id, json]) => localStorage.setItem(`replay:${id}`, json),
    [trace.id, JSON.stringify(trace)]);

  const origin = new URL(baseURL).origin;
  await page.goto(`${origin}/?playback&id=${encodeURIComponent(trace.id)}&cutscene=1&debug`, { waitUntil: 'load' });
  // 3. Wait for the ARM gate: the ship .glb sets noseZ/tailZ (bullet spawn point) → stepping earlier
  //    would change the sim.
  await page.waitForFunction('!!(window.__replay && window.__replay.status().armed)', null, { timeout: 30000 });

  // 4. Fast-step the whole cutscene, auto-tapping each card. Chunked so no single evaluate runs long.
  //    THREE terminal states, all of which must end the loop:
  //      won      — the healthy one (fight cleared → autopilot docked → victory)
  //      done     — cutscene ended (win, Skip, or the return-home watchdog bailed out)
  //      playDone — the TRACE RAN OUT with the fight unfinished. This is the DOMINANT desync mode, and
  //                 step() returns instantly forever once it is set (the loop body is unreachable while
  //                 rs.done), so omitting it would hang here until the budget expires and report nothing.
  let out = null;
  for (let i = 0; i < 60 && !out; i++) {
    out = await page.evaluate(() => {
      const r = window.__replay;
      const over = () => { const c = r.cut(); return c.won || c.done || r.status().playDone; };
      for (let n = 0; n < 20 && !over(); n++) {
        if (r.cut().frozen) { r.advance(); continue; }   // dismiss the lower-third card
        r.step(60);
      }
      if (!over()) return null;
      const c = r.cut(), s = r.status();
      return { kills: r.state.G.kills, enemiesLeft: r.state.enemies.length, cards: c.fired,
               won: c.won, ended: c.done, playDone: s.playDone, tick: s.playIndex, total: s.total };
    });
  }
  await shot('final');
  assert.ok(out, 'the cutscene never reached a terminal state (won / ended / trace exhausted) — scenario or engine bug, not a desync');
  console.log(`      intro re-sim: kills=${out.kills} enemiesLeft=${out.enemiesLeft} cards=${out.cards.join('|')} `
            + `won=${out.won} ended=${out.ended} playDone=${out.playDone} tick=${out.tick}/${out.total}`);
  assert.equal(out.kills, 4, `intro re-sim killed ${out.kills}/4 enemies — the trace desynced from the sim`);
  assert.deepEqual(out.cards, ['p0', 'p1', 'p2', 'p3', 'p4'], 'all five cutscene cards fired in order');
  assert.equal(out.won, true, 'the intro re-sim cleared the level and docked home (finishIntro path)');

  await page.evaluate((id) => localStorage.removeItem(`replay:${id}`), trace.id); // leave no cross-scenario state
}
```

Notes for the implementer:
- `window.__replay` is exposed under any `?record`/`?playback` load (`main.js:1170`), independent of `?debug`.
- `cut().fired` is a `Set` spread into an array by the hook (`main.js:1187`) — insertion-ordered, so
  `deepEqual` against `['p0'..'p4']` is stable. Card ids/order come from
  `client/src/level0-cutscene.js`.
- **`won` and `done` alone are not enough.** On the dominant desync mode the trace simply runs out: `step()`
  hits the `rs.done = true; break;` at `main.js:1203` and, from then on, every call returns immediately
  without touching `cut()`. `status().playDone` is the only signal that flips. Step 4a's post-loop mirror
  additionally makes `cut().done` flip in that case; the scenario checks **both** so it terminates even if
  that mirror is missing or `rs.cutDone` was already set.
- In a HEALTHY run the trace is never *exhausted*: once the fight clears, `rs.cutReturning` freezes `rs.index`
  (`main.js:612`), so the run ends on the win instead of running off the end of the ticks. `playDone` only
  flips on the winning tick (`main.js:1110`), together with `won`/`done` — so do **not** assert
  `playDone === false` anywhere (it is `true` in the healthy terminal state too, which is why the scenario
  treats it as one of three terminal signals rather than a health check). A recording that stops on the exact
  tick of the final kill *would* exhaust the trace before the transition and fail the `won`/`kills`
  assertions — hence the "keep flying a beat after the last kill" instruction in Step 9.3.
- The runner already asserts zero page errors per scenario — don't duplicate that.
- Screenshot lands in `client/visual/__screenshots__/intro-replay__final.png` for a human eyeball.

**Ordering constraint — how to work before the new trace exists.** The guard cannot pass until Step 9. So:
0. **`npm run assets:pull` from the repo root FIRST.** `client/assets/recordings/` does not exist in a fresh
   worktree (the traces are gitignored S3 assets), so without this the scenario stops at its
   "run `npm run assets:pull`" assertion and you learn nothing. The same pull also fetches the ship `.glb`s
   the arm gate waits on.
1. Implement Steps 1-6, then run `cd client && node visual/run.mjs 22-intro-replay` against the **old**
   trace.
2. **Expected result with the OLD trace: the run terminates on TRACE EXHAUSTION and fails the kills
   assertion.** The console line should read approximately
   `intro re-sim: kills=2 enemiesLeft=2 cards=p0|p1|p2 won=false ended=true playDone=true tick=3069/3069`,
   and the failure is `assert.equal(out.kills, 4)` — i.e. the *plumbing* works (trace resolved from the seed,
   page armed, stepping ran, the run reached a terminal state) and only the *outcome* is wrong.
   Note what this is **not**: the run does **not** reach the return-home watchdog (the fight never clears),
   so `enemiesLeft > 0` and `won=false` are expected, and exact `kills`/`cards`/`tick` numbers may differ
   slightly on the current baseline (`0e5766a` moved the FX path again) — the shape is what matters:
   `playDone=true`, `won=false`, `kills < 4`.
   **Signals that the scenario itself is broken** (fix these before handing over): `out === null` after the
   budget; the `armed` wait timing out at 30 s; a page error; `total === 0` or the trace assertion firing
   (asset not pulled / seed path wrong).
3. Record that expected-fail output in the PR/run notes, and hand the maintainer the single re-validation
   command for after the re-record: `cd client && node visual/run.mjs 22-intro-replay`.

---

## Step 7 — `assets:check` covers the intro trace

The seed will get a new `introTrace` hash in Step 9; nothing currently verifies that file exists on S3, so a
typo would ship a 404 intro. Add a third lane to `scripts/assets-check.mjs` (mirroring `soundKey`, ~6 lines):

```js
import { SHIPS, SOUNDS, COMPONENTS, WEAPONS, LEVELS } from '../server/src/catalog_seed.js';
const HASHED_JSON = /\.[0-9a-f]{8}\.json$/;
const traceKey = (url) => (url && url.startsWith('assets/recordings/') && HASHED_JSON.test(url))
  ? PREFIX.recordings + url.slice('assets/recordings/'.length) : null;
for (const l of LEVELS) {
  const key = traceKey(l.descriptor && l.descriptor.introTrace);
  if (key) targets.push({ name: `intro:${l.name}`, field: 'introTrace', url: l.descriptor.introTrace, key });
}
```

Update the file-header comment ("Covers two lanes" → three). This runs in CI's deploy job
(`.github/workflows/ci-cd.yml:72`) with a read-only key, so a bad hash blocks the deploy.

**`docs/SUMMARY.md` also enumerates the lanes** — the `assets:check` parenthetical around **line 629**
("drift-check: every pipeline `model_url*` in the seed **and every `SOUNDS` url in `catalog_seed.js`** exists
on S3 — the deploy guard"). Add the recordings lane there too, e.g. *"…, every `SOUNDS` url, **and the
`level-1` descriptor's `introTrace`**, exists on S3". Don't leave the doc describing two lanes while the
script checks three.

---

## Step 8 — replay / intro impact analysis (mandatory section)

- **The canonical intro trace is invalidated by design.** That is the whole point of the change and is
  resolved by Step 9. State it plainly in the CHANGELOG so nobody "fixes" a red guard test by reverting.
- **The maintainer's local `localStorage` recordings (`replay:*`) are also invalidated** — any older
  `?playback` clip will desync after this change. Mention it in the CHANGELOG; no code action.
- **The ghost-battle backdrop is unaffected**: it is a transform replay (`client/src/backdrop-battle.js`),
  dumb-lerped, never re-simmed (DECISIONS §59).
- **`?bench` perf gate (DECISIONS §58) still works, but `finalHash` will differ between A (merge-base) and
  B (this branch)** — the seeded stream is intentionally different, so the two builds simulate different
  fights. The gate stays valid because it is load-pinned (`setup.maintainEnemies`) and compares medians, not
  hashes. Expect roughly flat `js.*`; call the hash divergence out in the pipeline notes so the reviewer
  does not flag it as a regression. `?bench` determinism *within* one build is preserved (`seedSim` is
  installed at bootstrap, `main.js:1239`, and per-trace in `__bench.replay`).
- **`bakeBackdrop`** (`main.js:835`) stays deterministic for gameplay draws; its output is only a bootstrap
  fallback track, so cosmetic drift there is irrelevant.
- **Live (non-replay) play is unchanged**: with no seed installed, `simRandom()` delegates to
  `Math.random()`.
- **Stage-9 live test (required):** reset progress → play the intro end-to-end → confirm it reaches the
  victory + the Level 1 briefing, then take off into Level 1 and confirm the live sim runs (the
  `finishIntro` teardown path).

---

## Step 9 — re-record the intro trace (maintainer, at the live-test stage)

Run this **after** Steps 1-7 are merged into the worktree branch and the local server is running. Ordered,
no step is optional.

1. `npm run assets:pull` (root) — the gitignored models/sounds/recordings must be present, or the record
   session runs on the blue placeholder. Start the server: `cd server && PORT=4000 node src/server.js`
   (see the `run-local` skill).
2. Open `http://localhost:4000/?record=1&level=1` (hard refresh). Wait for the top bar to change from
   **"Loading model…"** to **"Start recording"** — do not click early.
3. Click **Start recording** and fly the intro fight: 3 basic pirates one at a time, then the rocket pirate.
   For the cutscene beats to fire, the run must contain **4 kills**, the **rocketeer warp-in**, and the
   rocketeer must launch **at least 2 rockets** before dying (P4 triggers on its 2nd rocket). Try to survive
   comfortably — a death mid-run ends the intro early for every new player.
   **Keep flying for a second or two after the final kill before stopping.** Playback engages "return to
   base" on the tick the fight clears, which freezes `rs.index` — if the trace ends on the exact tick of the
   last kill, the re-sim can exhaust it instead of transitioning, and the guard test (Step 6) will fail on
   `playDone=true, won=false`. A trailing second of input costs nothing and removes the race.
   **Also try to end the fight reasonably close to home** — the flight back is dead screen time in the
   cutscene, and it is what `CUTSCENE_STALL_TICKS` has to clear.
4. Click **Stop & Save** → `{id}.json` downloads (`id = level-1-<seed base36>`). Click **Play it ▶** and
   watch it back once end-to-end: cards p0..p4, fight cleared, autopilot flies home, victory. If any beat is
   missing, re-record — the fix is not the trace's fault.
   **Measure the flight home while you are here** (it sizes the watchdog, Step 4b). Measure it in WALL TIME,
   not in `playIndex` — `rs.index` is FROZEN while `cutReturning` (`main.js:612`), so a `playIndex`-based
   delta reads ≈ 0 and would silently report "no flight at all". With the playback open, run in the console
   `let t0=null; const h=setInterval(()=>{const c=__replay.cut(); if(c.returning&&t0===null)t0=performance.now(); if(c.won){clearInterval(h);const s=(performance.now()-t0)/1000;console.log('return-home ≈',s.toFixed(1),'s =',Math.round(s*60),'ticks');}},100);`
   — or simply time it with a stopwatch (seconds × 60 = ticks). Playback runs at real time, so wall seconds ==
   sim seconds here. If the observed value is within 2× of
   `CUTSCENE_STALL_TICKS` (900), raise the constant in `client/src/replay.js` to ~3× the observed value and
   update its comment + the unit test. A watchdog that trips on a legitimate flight home would truncate every
   new player's intro — this measurement is not optional.
5. Content-hash + stage it:
   ```sh
   HASH=$(node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex').slice(0,8))" ~/Downloads/<id>.json)
   cp ~/Downloads/<id>.json client/assets/recordings/level0-intro.$HASH.json
   ```
6. Push it to S3 (there is no `assets:push` lane for recordings — it is a manual `cp`, same as the original
   2026-07-10 upload; prefix from `scripts/assets-config.mjs:18`):
   ```sh
   aws s3 cp client/assets/recordings/level0-intro.$HASH.json \
     s3://vega-sentinels-assets/recordings/level0-intro.$HASH.json \
     --cache-control "public, max-age=31536000, immutable" --content-type application/json
   ```
7. Update `server/src/catalog_seed.js:402` — `introTrace: 'assets/recordings/level0-intro.<newhash>.json'`
   — and commit **only that string** (the trace bytes stay out of git).
8. `npm run assets:check` (root) → the new `intro:level-1` line must read `ok` (Step 7's new lane).
9. `cd client && node visual/run.mjs 22-intro-replay` → **must pass** (4 kills, p0..p4, won). This is the
   gate for merging.
10. Deploy to prod, then **live-test the real intro**: `/reset-progress` for a test account → load the game
    → the intro plays through to the Level 1 briefing.
11. **Re-publish the itch build (`/publish-itch`).** The itch ZIP bundles `client/assets/` (including
    `assets/recordings/`, see `scripts/build-itch.mjs:35`) but reads the catalog **live from prod** — so a
    new `introTrace` hash 404s against the old bundled trace and the itch intro breaks until republished
    (DECISIONS §37 pattern; the same trap as ship-model hashes).
12. The old `level0-intro.a39d1f46.json` on S3 can stay (immutable, harmless); delete the stale local copy
    from `client/assets/recordings/` so the guard test cannot accidentally resolve it.

---

## Tests

- `cd client && node --test` — must stay green. New: `client/src/sim-random.test.js`. Changed:
  `client/src/replay.test.js` (watchdog + teardown fields), `client/src/bench.test.js` (unchanged if
  `bench.js` re-exports `mulberry32`; if you point it at `sim-random.js` instead, update the import).
  `client/src/spawn-timing.test.js` and `client/src/drops.test.js` should need no change — verify.
- `cd server && npm test` — must stay green (Postgres; `pretest` drops+recreates `spacegame_test`). Only
  affected if Step 9's seed string lands; run it anyway.
- `cd client && npm run test:visual` — the full suite. **Baseline is flaky**: ~6 scenarios fail before this
  change; judge by the reliably-passing set + zero page errors, and by `22-intro-replay` specifically.
- `cd client && node visual/run.mjs 22-intro-replay` — the single-scenario command (Step 5.2), the gate for
  the re-record.
- Optional determinism spot-check (the `/record-playback` skill, step 4): record a short clip, note
  `__replay.hash()`, replay it, confirm the hash matches — proves record↔playback is still bit-for-bit under
  the opt-in RNG.

---

## Docs to update

**`docs/SUMMARY.md`** (bump `**Updated:**` and lead the header paragraph with this change):
- Line ~353-357, the "**Determinism isolation (load-bearing)**" bullet in *Combat record/playback*:
  rewrite for the opt-in model — the seeded stream is `client/src/sim-random.js` (`simRandom`/`seedSim`),
  consumed **only** by the enumerated gameplay sites; cosmetic FX/decor use native `Math.random` and are
  replay-neutral; `withSimRand`/`installSeededRandom` are gone. Mention that this also removes the old
  graphics-tier dependence of a trace.
- Same subsection: add the **return-home watchdog** (`rs.cutReturning` engaged + not won for
  `CUTSCENE_STALL_TICKS` ≈ 15 s → `cutsceneEnd()` → `finishIntro()`), the note that `__replay.step()` now
  mirrors `animate()`'s end-of-trace exit, and the **guard scenario** `22-intro-replay`.
- Line ~1601-1602 (Tools → `?bench`): `bench.js` no longer owns the seeded RNG; it re-exports `mulberry32`
  from `sim-random.js` and `BENCH_DT` stays.
- Line ~1862-1864 (client code structure → *Input-replay*): `replay.js` now also owns the watchdog
  counters; the RNG isolation moved out of `main.js` into `sim-random.js`.
- The Tests section (~line 1931, visual suite): add `22-intro-replay` and note it needs `assets:pull`.
- The Level-0 intro cutscene subsection (~line 384-400): note the watchdog fallback (a desynced/failed
  re-sim ends via the normal `finishIntro` path instead of hanging).

**`docs/CHANGELOG.md`** — one bullet under `## 2026-07-26`, e.g.: *"**Intro replay desync fixed — the
seeded sim RNG is now opt-in** — cosmetic FX (explosion sparks, exhaust, smoke) and world decor were drawing
from the seeded stream inside `update()`/`reset()`, so any FX/decor change silently shifted it and desynced
the recorded Level-0 intro (it broke three times: shield sphere, asteroid `.glb`, flipbook FX). New
`client/src/sim-random.js` (`simRandom`/`seedSim`); the ~8 gameplay draw sites opt in explicitly and the
global `Math.random` swapping (`withSimRand`, `installSeededRandom`) is gone, so new FX code is replay-safe
by default (and a trace is no longer graphics-tier dependent). Adds a **return-home watchdog** (a re-sim that
can never dock now ends on the Level 1 briefing instead of looping forever) + the missing end-of-trace exit in
`__replay.step()`, and a committed headless guard,
`client/visual/scenarios/22-intro-replay.mjs`, that re-sims the canonical trace and asserts 4 kills / cards
p0..p4 / win. The intro trace was **re-recorded** (the purified stream necessarily invalidates the old one);
older local `?playback` recordings are invalidated too. `assets:check` now also verifies the seed's
`introTrace` exists on S3. See DECISIONS §73."*

**`docs/DECISIONS.md`** — new **§73** (do not rewrite §62): *"Seeded sim RNG is OPT-IN (`simRandom()`), not
an opt-out global `Math.random` swap"*. Cover: the problem (three shipped desyncs + tier-dependence);
the alternative considered (keep the swap, move cosmetic modules to a captured native RNG — rejected because
it leaves the trap armed for every future FX addition); the accepted costs (a missed gameplay site fails
*non*-deterministically instead of deterministically — mitigated by the short, enumerated site list plus the
new guard test; decor layout now varies between playbacks of one trace); and that purification invalidates
every pre-existing trace, so the intro was re-recorded. Cross-ref §62, §58, §30.

**Also sweep these non-SUMMARY surfaces (they name the deleted mechanism):**
- `.claude/skills/record-playback/SKILL.md:19-21` ("The code already isolates this (`withSimRand` …)") and
  `:70` — rewrite for `sim-random.js` + the opt-in rule.
- `client/bench/README.md:23` — `bench.js` no longer owns `installSeededRandom`.
- `client/visual/README.md` — the new scenario + the `node visual/run.mjs <filter>` argument.
- `docs/plans/2026-07-09-replay-record.md:31` and `:54-55` — this is a historical brief; **do not rewrite
  it**, add a one-line note at each anchor: *"SUPERSEDED 2026-07-26: the seeded stream is opt-in via
  `sim-random.js` — see `docs/plans/2026-07-26-0009-fix-intro-replay-desync.md` / DECISIONS §73."*

---

## Out of scope (do not gold-plate — DECISIONS §30)

- Do **not** revert or re-tune the shield sphere (`db78736`) or the `.glb` asteroid field (`7d8fa50`).
- Do **not** change the cutscene script, card text, timings, or the intro's gating
  (`shouldPlayIntro`/`current_progress`).
- Do **not** add the visual suite to CI, or build a Playwright CI job.
- Do **not** convert the intro to a transform/"movie" replay, add state checkpoints to the trace format, or
  bump `TRACE_VERSION` — the format is unchanged.
- Do **not** add a seeded PRNG for FX "so visuals stay stable"; native `Math.random` is the decision.
- Do **not** automate the re-record with a scripted bot — the maintainer flies it.
- Do **not** refactor `main.js` beyond the lines listed in Steps 3-5.

---

## Final gate before handing back (run these, paste the output)

```sh
# 1. the deleted mechanism is gone everywhere — code, docs, skills, dev tooling (concept word, not just symbols)
grep -rn "withSimRand\|installSeededRandom\|nativeRandom" --include='*.js' --include='*.mjs' --include='*.md' . | grep -v node_modules
# expect: only the DECISIONS §73 / CHANGELOG / plan prose that describes the removal

# 2. no cosmetic module sneaks onto the seeded stream, and no gameplay site was missed
grep -rn "simRandom" client/src/*.js          # expect ONLY: sim-random.js, sim.js, ship-build.js, drops-config.js (+ tests)
grep -rn "Math.random" client/src/*.js | grep -v test   # expect ONLY cosmetic sites (projectiles/world/flipbook/bolt/main dev hook) + sim-random.js's fallback + spawn-timing's test-only defaults

# 3. both replay loops have BOTH exits (4a mirror + 4b watchdog) — animate() and __replay.step()
grep -n "cutsceneEnd();" client/src/main.js   # expect the post-loop exit in BOTH the accumulator (~:620) and step()

# 4. suites  (assets:pull FIRST — client/assets/recordings/ is gitignored and absent in a fresh worktree)
npm run assets:pull
cd client && node --test && cd ../server && npm test
cd client && node visual/run.mjs 22-intro-replay   # expected-fail on the OLD trace (see Step 6); MUST pass after Step 9
```
