# Plan: deterministic replay benchmark + pre-commit perf-regression gate

**Feature ID:** `2026-07-04-0949-perf-benchmark-replay` · **Slug:** `perf-benchmark-replay`
Executable, self-contained build brief. Adopts and supersedes the exploratory
`docs/plans/perf-benchmark-replay.md` in this worktree, with three maintainer-confirmed decisions folded in
(see **Resolved decisions**).

## Goal
Catch when a code change makes the **per-frame CPU cost** worse by **>2%** on weak-device-class work,
**before it lands**, and surface it to the maintainer. Do it by recording a real playthrough into a
**deterministic input trace**, then **replaying** that trace identically on `main` (merge-base) and on the
feature branch, comparing the JS-work buckets **A/B** on the same machine in the same job. User-visible
effect: a new `node client/bench/run.mjs` tool (and a documented feature-pipeline stage) that reports a
per-bucket regression table and exits non-zero on a confirmed >2% CPU regression.

This extends the measurement work in `docs/plans/perf-low-end-phones.md` (the shipped `?dev` perf monitor)
and DECISIONS §23. It does **not** replace real-device testing — see **Scope & the GPU blind spot**.

## Resolved decisions (maintainer-confirmed 2026-07-04 — do NOT re-open)
1. **Canonical trace = programmatically-generated, load-pinned synthetic.** Ship
   `client/bench/traces/combat-heavy.json` produced by a committed deterministic generator
   (`client/bench/gen-trace.mjs`) — a scripted `keys`/`touchAim` sequence plus a `setup` that holds a fixed
   enemy count and a fixed fire cadence, so the gate self-tests fully headlessly (no human play needed for
   v1). The `?bench=record` recorder + `__bench.stop()` JSON-download flow **is still built in v1**; only the
   *human-flown "real playthrough" trace* is deferred — documented as a follow-up in `client/bench/README.md`.
2. **Deliver the runnable standalone tool + docs; do NOT wire a live CI/orchestrator stage.** Ship
   `client/bench/run.mjs` + `client/bench/stats.mjs` + `client/bench/stats.test.js` + the `?bench` hooks.
   **Document** the PERF A/B GATE stage (flow diagram + retro row) in `docs/plans/multi-agent-pipeline.md`
   and the feature-pipeline skill prompt as prose the pipeline Claude executes. **No new GitHub Actions job,
   no orchestrator code.** The runner must be usable standalone: `node client/bench/run.mjs`.
3. **Runner skip-and-passes when either build lacks `window.__bench`.** Because build A is always the
   merge-base, on *this* PR (and any pre-bench branch) build A has no bench hook. The runner detects the
   missing hook on either build, prints `gate inactive (baseline predates bench harness)`, and **exits 0**.
   Real A/B activates on the first feature merged *after* this one.

## Scope & the GPU blind spot (READ FIRST — non-negotiable framing)
This benchmark measures the **CPU/JS half** only — the `js.update` / `js.dom` / `js.render` (submit) buckets
already produced by `devPerf` (`client/src/main.js:355`). That is exactly the half that CAN be measured
deterministically on a desktop/CI (per perf-low-end-phones: the A03s/Redmi were largely **fill-rate /
thermal / compositor-governed**, which no desktop run reproduces).

Consequences the executing agent MUST honor:
- The gate primary metric is **`js.*`, never `fps`/`frameMs`** (wall-clock is vsync/compositor-noisy, never
  2%-detectable — see perf-low-end-phones).
- A **green gate ≠ "no A03s regression."** A change that only adds GPU cost (an extra additive-particle
  layer, an extra render pass, a bigger backbuffer, a heavier shader) can regress a real A03s while `js.*`
  stays flat. To partly cover this, the gate ALSO tracks secondary structural signals from the per-tick
  `load` snapshot (`draws`, `tris`, `particles`) and the `js.render` submit bucket, and flags growth — but
  states plainly it is a proxy, not a GPU measurement.
- Real-device `?dev` telemetry (already shipped) remains the source of truth for the GPU/thermal half.

## Why "record a playthrough" is feasible here
`update(dt)` (`client/src/sim.js:304`) is a **pure function of `(G state, keys, touchAim, dt, Math.random)`** —
there is **no wall-clock in the gameplay math** (`performance.now()` reads are `G.gameStartTime` bookkeeping
only; they do not feed the sim). Input is two mutable shared objects, `keys` and `touchAim`
(`client/src/state.js:98-99`): `keys` is a `{ KeyboardEvent.code -> bool }` bag; `touchAim` is
`{ active, heading, thrust }`. They are written by the listeners in `client/src/main.js` (keydown/keyup,
touch stick, fire/rocket buttons). So if we (1) seed `Math.random`, (2) drive a **fixed `dt`**, and (3) feed
a recorded per-tick snapshot of `keys`+`touchAim`, the whole simulation is reproducible bit-for-bit within
one browser binary. `update` reads codes like `keys['KeyW']`, `keys['ArrowUp']`, `keys['Space']`
(`sim.js:318-319`) — the trace stores exactly those `.code` strings.

FP note: JS doubles + `Math.*` are deterministic within a single V8/Chromium build. The A/B always runs both
branches on the **same** headless Chromium binary in the **same** job, so transcendental last-bit differences
across browser versions never enter the comparison. Do **not** rely on cross-machine or cross-version trace
stability.

## Architecture overview
```
  authoring:
    v1 (implementer, headless):  node client/bench/gen-trace.mjs  →  client/bench/traces/combat-heavy.json
    follow-up (human, deferred): open ?bench=record → play → __bench.stop() downloads a trace JSON

  measurement (standalone tool / documented pipeline stage, per diff):
    node client/bench/run.mjs
      ├─ start isolated server (throwaway SQLite)              [reuse visual/run.mjs pattern]
      ├─ launch ONE headless Chromium (swiftshader)
      ├─ if either build lacks window.__bench → print "gate inactive …", exit 0   [decision 3]
      ├─ for rep in 1..N, interleaved A,B,A,B,…:
      │     A = merge-base build,  B = worktree build  (served as static files)
      │     page.goto(<build>/?bench=replay) → __bench.replay(trace) → per-bucket per-tick arrays
      ├─ aggregate medians + bootstrap CI per bucket   [client/bench/stats.mjs]
      └─ verdict: CI lower bound of (B/A − 1) > +0.02  → REGRESSION → exit non-zero
```

## Determinism prerequisites (3 nondeterminism sources, each pinned)
1. **`Math.random`** — install a seeded PRNG (mulberry32) BEFORE any game module runs, under the `?bench`
   flag. Modules call `Math.random()` at call-time (e.g. `projectiles.js`, `drops.js`), never caching the
   function reference, so a global override taken early is sufficient.
2. **`dt`** — in bench mode the loop uses a **fixed** step (default `1/60`s) instead of `clock.getDelta()`
   (`client/src/main.js:452`). The sim already clamps `dt` to `0.05` (`main.js:453`), so `1/60` is safe.
3. **Input** — per tick, snapshot the resolved input state, not raw DOM events:
   `{ k: [<KeyboardEvent.code strings currently true>], t: touchAim.active ? [heading, thrust] : null }`.
   Replay writes these back into the shared `keys`/`touchAim` objects each tick before calling `update`.

## Trace format (`client/bench/traces/<name>.json`)
```jsonc
{
  "version": 1,
  "name": "combat-heavy",
  "seed": 1234567,          // PRNG seed used at record/generation time
  "dt": 0.016666,           // fixed step (s) — record and replay MUST match
  "warmupTicks": 120,       // ticks to run but EXCLUDE from timing (JIT/shader warmup)
  "ticks": [                // one entry per simulated frame, in order
    { "k": ["KeyW","Space"], "t": null },
    { "k": ["KeyW","KeyA","Space"], "t": null },
    { "k": [], "t": [1.57, 0.8] }   // touch heading=1.57rad thrust=0.8
    // …
  ],
  "setup": {                       // deterministic scene setup applied before tick 0
    "shipId": 1,                   // player ship to build (fixed, not account-dependent)
    "spawns": [ { "atTick": 0, "count": 6 } ],  // initial enemy waves (via spawnEnemyShip)
    "maintainEnemies": 6           // LOAD-PIN: replayer respawns to keep this many enemies alive each tick
  }
}
```
`maintainEnemies` is the load-pinning knob (see **Load-pinning**): with it set, the per-frame entity
population is structurally constant regardless of who wins the fight, so a gameplay-touching diff still gets
a clean A/B. Keep traces small: RLE is unnecessary at ~600–1800 ticks (10–30 s). One trace ≈ tens of KB.

## Component 1 — seeded RNG + bench flag (`client/src/bench.js`, NEW)
- Mirror `client/src/dev.js` (sticky flag). Export `benchMode()` returning `'record' | 'replay' | null`
  from `?bench=record` / `?bench=replay`, with a sticky `sessionStorage` copy so a reload keeps it (mirror
  `dev.js`'s `evalDev` tri-state + storage discipline; make the pure decision unit-testable the same way).
  Export `isBench()` = `benchMode() !== null`.
- Export `installSeededRandom(seed)`: sets `Math.random = mulberry32(seed)` (pure, ~5 lines). Idempotent.
- Export `BENCH_DT = 1/60`.
- Zero overhead when `?bench` absent (same discipline as `?dev` — evaluated once, cached).

## Component 2 — import order + fixed-dt/record loop hook (`client/src/main.js`)
- **Import `./bench.js` first** — add its import at the very top of the import block
  (`client/src/main.js:6`, before `three` and the game modules that may call random at module init). Call
  `installSeededRandom(seed)` in bootstrap the moment `benchMode()` is truthy, before the player/enemies are
  built. (The trace's seed is passed into `replay()`; for `record` mode use a fixed constant so record ==
  replay — see Component 3.)
- **`animate()` bench branch** (`client/src/main.js:450`): add `const bench = benchMode();` and, when
  truthy, use `dt = BENCH_DT` instead of the clamped `clock.getDelta()` result. Keep the non-bench path
  **byte-identical** (guard so normal play, `?dev`, and `?debug` are untouched). In `record` mode, after
  `update(dt)`, push a tick snapshot `{ k: Object.keys(keys).filter(c => keys[c]), t: touchAim.active ?
  [touchAim.heading, touchAim.thrust] : null }` into a module-level `benchRecord` array.

## Component 3 — recorder + replayer hook (`window.__bench`, in `client/src/main.js`)
Attach a `?bench` block next to the existing `?debug` block (`client/src/main.js:501`). It reuses the
in-scope imported symbols directly (`spawnEnemyShip`, `reset`, `enemies`, `liveParticles`, `renderer`,
`update`, `keys`, `touchAim`, the HUD updaters) — it does **not** require `?debug`. Expose on `window.__bench`:

**Recorder (v1, drives the deferred human authoring flow):**
- `record()` — start capturing (sets the flag that makes `animate()` push snapshots; Component 2).
- `stop()` — finalize `{ version:1, name, seed, dt:BENCH_DT, warmupTicks:120, ticks: benchRecord, setup }`
  and trigger a JSON download (`Blob` + anchor click) so a human can save it into `client/bench/traces/`.
  (No `mark()` / label API — no current consumer; DECISIONS §30, don't build it speculatively.)

**Replayer (the gate's engine):** `window.__bench.replay(trace)` — async, resolves to a stats object:
1. `installSeededRandom(trace.seed)`, `reset()` to a clean fight, apply `trace.setup`: build the fixed ship
   (`shipId`), spawn the fixed waves (`spawnEnemyShip`).
   **PRECONDITION — the sim gate (do NOT rely on `reset()` alone).** `update(dt)` early-returns when
   `!G.gameStarted || !G.player.alive || levelRunner.won` (`client/src/sim.js:305`). `reset()` sets
   `G.player.alive = true` and `levelRunner.start()` but does **NOT** set `G.gameStarted` — that flag is set
   only by the launch flows (`mainwindow.js:62/177`, `welcome.js:137`), which the headless `?bench=replay`
   page never runs. So BEFORE the tick loop (in both `full` and `sim` modes) explicitly set
   `G.gameStarted = true`, and **assert** `G.player.alive === true && levelRunner.won === false` — else every
   timed `update(dt)` returns immediately and the benchmark measures ~nothing (a deliberate-regression
   busy-loop placed above the guard could even mask this). Fail loudly if the assert doesn't hold.
2. Run `trace.ticks` in order. For each tick:
   - Clear+set `keys`: `for (const c in keys) keys[c] = false; for (const c of tick.k) keys[c] = true;`
   - Set `touchAim`: `if (tick.t) { touchAim.active = true; [touchAim.heading, touchAim.thrust] = tick.t; }
     else touchAim.active = false;`
   - **Load-pin:** if `trace.setup.maintainEnemies`, while `enemies.length < maintainEnemies` call
     `spawnEnemyShip(...)` to top up (deterministic — same on A and B).
   - Execute ONE full frame's work timed into the SAME three buckets `devPerf` uses, reusing the exact call
     sequence from `animate()` (`main.js:455-476`): `t0 → update(dt) → t1 → (updateHud/updateMarkers/
     updateDropMarkers/updateCreditPopups/updateEnemyHealthBars/updateOobWarning/updateReturnArrow/
     updateReturnHint/updateMiniMap) → t2 → (renderer.info.reset(); renderer.clear();
     renderer.render(skyScene, camera); renderer.clearDepth(); renderer.render(scene, camera)) → t3`.
     **Deliberately dropped from `animate()`:** `tickZoom(dt)`, the dock/grab-cursor raycast checks
     (`main.js:466-467`), and `updatePerf`/`devPerf.frame` (`main.js:477-478`) — none feed the sim, and
     dropping them consistently on both A and B keeps the comparison clean (do not "restore" them for
     fidelity to the live sequence).
3. Discard the first `warmupTicks` from timing. For the rest, collect per-tick
   `{ update:t1-t0, dom:t2-t1, render:t3-t2, total:t3-t0 }` plus a per-tick `load` snapshot
   (`draws: renderer.info.render.calls, tris: renderer.info.render.triangles, particles: liveParticles(),
   enemies: enemies.length`).
4. Return `{ update, dom, render, total, load:{draws,tris,particles,enemies} }` where each timing field is
   the **median** over timed ticks (robust to a stray GC pause), plus the **raw per-tick arrays** (`ticks:
   {update:[…],dom:[…],render:[…],total:[…]}`) for the runner's bootstrap CI, and the per-tick `load`
   arrays.

Modes (second arg `{ mode }`):
- **`mode:'full'`** (default) — update+dom+render, matches live frame cost. **The gate keys on this.**
- **`mode:'sim'`** — call only `update(dt)` in a tight loop (no DOM, no render). Tightest, lowest-noise,
  most 2%-sensitive for pure-sim changes. The runner records both; the report shows `sim` too.

Determinism self-check inside `replay()` (or a `__bench.selfCheck()`): running the same build twice must
yield an identical final entity population (assert equal final `enemies.length` + a cheap state hash of
positions). Divergence means a hidden random source — a real bug the recorder flushed out; fail loudly.

## Component 4 — trace generator (`client/bench/gen-trace.mjs`, NEW) — decision 1
A tiny committed node script that writes `client/bench/traces/combat-heavy.json` deterministically (so the
trace is reviewable and reproducible, not an opaque blob):
- Fixed `seed` constant, `dt = 1/60`, `warmupTicks = 120`, ~900 ticks (~15 s).
- Scripted input pattern: hold `["KeyW","Space"]` (thrust + fire) as the baseline, and every ~40 ticks add a
  short `KeyA`/`KeyD` turn burst — enough steering + sustained fire to exercise projectiles/collisions/FX.
- `setup: { shipId: 1, spawns: [{ atTick: 0, count: 6 }], maintainEnemies: 6 }` — load-pinned.
- Writes pretty-printed JSON. Re-running it must reproduce byte-identical output.
Document the command in `client/bench/README.md`. The implementer runs it once and commits the output JSON.

## Component 5 — A/B runner (`client/bench/run.mjs`, NEW)
Model on `client/visual/run.mjs` — reuse its isolated-server spawn (throwaway SQLite at `os.tmpdir()`),
`waitForHealth`, and Chromium launch args verbatim (`--use-gl=angle --use-angle=swiftshader
--enable-unsafe-swiftshader --ignore-gpu-blocklist`). Differences:
- **Serves two builds.** `A` = merge-base checkout dir, `B` = worktree HEAD (this tree). The pipeline (or an
  env var) passes the two client dirs; the runner serves each build's **static client files** over its own
  tiny static HTTP route, and points both at the **same** isolated API server (the client is static; only
  `/api/*` needs the server, which is branch-agnostic for perf — the game sim is client-side). Default env:
  `BENCH_A_DIR` (merge-base client dir), `BENCH_B_DIR` (defaults to this worktree's `client/`). If neither is
  set, default `A === B === this client` (self-comparison noise-floor mode, used by the authoring
  determinism check).
- **Decision 3 — hook presence check.** For each build, `page.goto(<build>/?bench=replay)` and
  `await page.waitForFunction('!!window.__bench', { timeout: 8000 })`. If **either** build times out (no
  `__bench`), print `gate inactive (baseline predates bench harness)` and **`process.exit(0)`** before any
  measurement. This is the expected path for THIS PR (merge-base has no bench).
- **Interleaved reps** `A,B,A,B,…` (default `N=15` each, `BENCH_REPS` env). Interleaving cancels slow thermal
  drift so the ratio stays clean.
- Optional CDP **CPU throttle** (`Emulation.setCPUThrottlingRate`, default `4×`, `BENCH_THROTTLE` env)
  applied via a CDP session on the page. It multiplies both A and B equally (ratio preserved). Keep it on,
  but it is the interleaved-median design — not the throttle — that delivers the 2% sensitivity.
- For each rep: `page.goto(<build>/?bench=replay)`, wait for `window.__bench`, run
  `await page.evaluate(t => window.__bench.replay(t), trace)` (and again with `{mode:'sim'}`), collect the
  returned per-tick arrays.
- Runs **every** trace in `client/bench/traces/` (auto-discovered, like visual scenarios).
- Aggregates via `client/bench/stats.mjs`, prints the report, exits non-zero on any `REGRESSION`.
- Add npm script `"bench": "node bench/run.mjs"` to `client/package.json`. **Not** part of `npm test`
  (it forks Chromium + a server; keep it a separate manual/pipeline command, like `test:visual`).

## Component 6 — statistics & verdict (`client/bench/stats.mjs`, NEW; pure + unit-tested)
- Aggregate the interleaved reps per build per bucket. Use the **median of per-rep medians**, and a
  **bootstrap 95% CI** on the A→B delta ratio `(B/A − 1)` (resample rep pairs; ~2000 resamples).
- **Verdict per bucket:** `REGRESSION` iff the CI **lower bound** of the delta ratio exceeds **+0.02** (we
  are confident the true regression is >2%, not point-estimate noise). `IMPROVED` iff CI upper bound <
  −0.02. Else `FLAT`.
- **Gate result:** flag if `js.total` (`full` mode) — or `js.update` in `sim` mode — is `REGRESSION`, OR any
  structural `load.*` signal (draws/tris/particles) grew beyond a small epsilon (they are integer-ish and
  near-deterministic, so a small consistent rise is a real GPU-cost proxy — flag it).
- **Load-divergence annotation:** if A and B per-build `load.*` medians differ beyond a small tolerance,
  annotate the verdict `load diverged — treat Δ as approximate` (a gameplay diff whose inputs yielded a
  different world despite the load-pin) rather than asserting a clean 2%.
- Emit a compact report per trace:
  ```
  trace combat-heavy (15×2 reps, 4× CPU throttle)
    js.update   0.42ms → 0.47ms   +11.9%  [+9.1%, +14.6%]   REGRESSION
    js.dom      0.31ms → 0.31ms    +0.6%  [−2.1%, +3.4%]    FLAT
    js.render   0.55ms → 0.55ms    +0.2%  [−1.8%, +2.1%]    FLAT
    load.draws  74 → 74 · tris 66k → 66k · particles ≈ equal   FLAT
    VERDICT: REGRESSION (js.update +11.9%)
  ```
- `stats.mjs` is **pure** (takes the raw arrays, returns verdicts + a formatted string) so it is unit-tested
  without a browser. The runner does the I/O and calls `process.exit(anyRegression ? 1 : 0)`.

## Component 7 — feature-pipeline integration (DOCS/PROSE ONLY — decision 2)
Do **not** add a GitHub Actions job or orchestrator code. Instead:
- **`docs/plans/multi-agent-pipeline.md`** — insert the stage into the Flow block (`:61-66`), after reviewer
  `PASS`, before retro:
  ```
  … → implementer → [reviewer ⇄ implementer] → PASS
     → PERF A/B GATE (node client/bench/run.mjs; A=merge-base, B=worktree)   ← NEW
     → retro (metrics) → deploy? → …
  ```
  Add prose describing what the pipeline Claude does at this stage: compute the merge-base of the worktree
  branch vs `main`; materialize build `A` from merge-base (`git worktree add` at the merge-base, or
  `git archive` to a temp dir) and set `BENCH_A_DIR`/`BENCH_B_DIR`; run `node client/bench/run.mjs`; **if any
  trace verdicts REGRESSION → surface it to the maintainer as a blocking question** (same posture as the
  reviewer returning `CHANGES` and the deploy y/n), showing the per-bucket table — maintainer decides:
  accept (intended cost), send back to implementer, or abandon; if all FLAT/IMPROVED → note it and continue;
  if the runner prints `gate inactive` → note it and continue.
  Add a retro-metrics row to the table at `:79`: **perf gate = FLAT / REGRESSION(bucket, Δ%) / inactive**.
- **The feature-pipeline skill prompt** (`.claude/skills/feature-pipeline/…` — the skill that drives the
  orchestrator; grep for the flow it executes) — add the same stage prose so the pipeline Claude actually
  runs it. Prose only; no code.

## Load-pinning for gameplay-changing diffs (accuracy guard)
A recorded trace replays **inputs**, not the world. If the diff changes gameplay (turn rate, damage, spawn
timing), the same inputs could yield a **different entity population** on B → the perf delta is contaminated
by "different amount of work." Mitigations, in order:
- The shipped `combat-heavy.json` is **load-pinned** via `setup.maintainEnemies` (Component 3/4): the
  replayer respawns to hold a fixed enemy count each tick, so per-frame workload is structurally constant
  regardless of combat outcome. This is the trace the gate trusts for gameplay-touching diffs.
- The runner reports per-build `load.*`; if A and B diverge beyond tolerance, the verdict is annotated
  "load diverged — treat Δ as approximate" (Component 6).
- Non-gameplay diffs (render/HUD/refactor) stay in lock-step → clean 2% comparison; the common case.

## Files to create / change
**New:**
- `client/src/bench.js` — bench flag (`benchMode`/`isBench`, sticky + unit-testable) + `installSeededRandom`
  (mulberry32) + `BENCH_DT`.
- `client/bench/gen-trace.mjs` — deterministic generator for `combat-heavy.json` (decision 1).
- `client/bench/traces/combat-heavy.json` — first canonical trace (committed output of the generator).
- `client/bench/run.mjs` — A/B runner (fork of `client/visual/run.mjs` structure).
- `client/bench/stats.mjs` — pure median/bootstrap-CI + verdict.
- `client/bench/stats.test.js` — table-driven tests for the verdict thresholds (2% boundary, CI logic).
- `client/bench/README.md` — how to (v1) generate the trace + run the bench + read the report; how to
  (deferred) record a real human playthrough via `?bench=record` + `__bench.stop()`; the GPU-blind-spot note.

**Changed:**
- `client/src/main.js` — import `bench.js` first; bench branch in `animate()` (fixed dt + record snapshot);
  `window.__bench` record/stop/replay hook (a `?bench` block near the `?debug` block at `:501`).
- `client/src/bench.test.js` — NEW unit test for the sticky flag decision + mulberry32 determinism (mirror
  `dev.js`'s testable-decision pattern; run under `client && node --test`).
- `client/package.json` — add `"bench": "node bench/run.mjs"` script.
- `docs/plans/multi-agent-pipeline.md` — document the perf A/B stage + retro row (prose only).
- The `feature-pipeline` skill prompt — add the stage to the flow it executes (prose only).

## Authoring the trace
**v1 (implementer, headless):** `cd client && node bench/gen-trace.mjs` → writes
`bench/traces/combat-heavy.json`. Commit it. Then verify determinism (see Tests).
**Deferred (human, documented in README, NOT a v1 blocker):** run the local client, open `…/?bench=record`,
play a representative ~15 s heavy fight, `__bench.stop()` in the console, save the download into
`client/bench/traces/`.

## Tests
- **`client/bench/stats.test.js`** — table-driven: a synthetic A/B where B is +11% → `REGRESSION`; +1% →
  `FLAT`; exactly the +2% boundary → `FLAT` (strict `>`); B −11% → `IMPROVED`; a `load.draws` bump →
  flagged; equal arrays → `FLAT` with tiny CI. Run: `cd client && node --test`.
- **`client/bench/bench.test.js`** (or `bench.test.js` beside `bench.js`) — `evalBench` sticky tri-state +
  `mulberry32(seed)` reproduces the same sequence for the same seed. `cd client && node --test`.
- **Noise-floor / determinism check (manual, documented):** `cd client && node bench/run.mjs` with
  `A === B` (default when `BENCH_A_DIR` unset) on the unchanged tree → every bucket `FLAT` with CI width
  < 2%. If not < 2%, raise `BENCH_REPS`, raise `warmupTicks`, or prefer `sim` mode before trusting the gate.
- **Deliberate-regression check (manual, documented in README):** temporarily add a busy-loop in `update()`
  costing ~10%, point `BENCH_A_DIR` at a clean checkout → gate reports `REGRESSION` on `js.update`/
  `js.total`; remove it → `FLAT`.
- **No server-test impact:** this feature touches no datastore code, so `db.js`/`db_postgres.js` stay in
  sync by not being touched. Still run `cd server && npm test` to confirm nothing regressed.
- **Visual smoke unaffected:** `?bench` is off by default; confirm `cd client && node visual/run.mjs` is
  unchanged (judge by the reliably-passing set + zero page errors — the suite has a flaky baseline).

## Docs to update on implementation (per CLAUDE.md docs workflow)
- **CHANGELOG.md** — under today's date: *"Deterministic replay benchmark + pre-commit perf-regression gate"*
  — what it measures (CPU `js.*` buckets), A/B interleaved design, the 2% flag, the `?bench` record/replay
  flags, the standalone `node client/bench/run.mjs` tool, the documented (not CI-wired) feature-pipeline
  stage, and the explicit GPU blind spot.
- **SUMMARY.md** — new subsection near the `?dev` monitor / perf-samples paragraph (`docs/SUMMARY.md`
  ~:958): the `?bench=record`/`?bench=replay` flags, trace format + `client/bench/traces/` location,
  `client/bench/run.mjs` + `stats.mjs` runner, the noise-floor/determinism checks, and the documented
  pipeline stage. Bump `**Updated:**`. **Also fix the pre-existing stale word in that same `?dev`
  paragraph:** it says `devPerf` lives in `index.html`, but it now lives in `client/src/main.js:355` —
  correct it as part of this SUMMARY edit.
- **DECISIONS.md** — new numbered entry: *"Perf regression gate is relative A/B, not an absolute threshold"* —
  why 2% is only detectable as an interleaved same-job comparison, why the metric is `js.*` not `fps`, the
  CPU-only scope + GPU blind spot, load-pinning for gameplay diffs, and why the gate is a standalone tool +
  documented pipeline prose (not a CI hard-fail; maintainer is asked). Cross-reference §23.

## Acceptance criteria
- `cd client && node bench/run.mjs` with `A === B` on an unchanged tree reports all buckets `FLAT` with CI
  width < 2% (noise floor validated).
- With `BENCH_A_DIR` pointing at a build lacking `window.__bench`, the runner prints
  `gate inactive (baseline predates bench harness)` and exits 0 (decision 3).
- Introducing a deliberate ~10% slowdown in `update()` makes the gate report `REGRESSION` on
  `js.update`/`js.total`; removing it returns to `FLAT`.
- `client/bench/gen-trace.mjs` deterministically (re)produces the committed `combat-heavy.json`.
- `cd client && node --test` passes (`stats.test.js` 2%-boundary + CI logic; `bench` flag + mulberry32).
- `?bench` is inert during normal play, `?dev`, and `?debug` (non-bench `animate()` path byte-identical).
- Docs updated (CHANGELOG/SUMMARY/DECISIONS) and cross-linked with `perf-low-end-phones.md` + §23; the
  pipeline stage is documented in `multi-agent-pipeline.md` + the skill prompt.

## Out of scope / non-goals (v1) — DECISIONS §30, do not gold-plate
- **No human-authored "real playthrough" trace** — the synthetic load-pinned `combat-heavy.json` is the v1
  gate trace; the `?bench=record` flow is built but authoring a real trace is a documented follow-up.
- **No live CI/orchestrator wiring** — no GitHub Actions job, no orchestrator code; the stage is a standalone
  tool + documented prose the pipeline Claude runs (decision 2).
- **No GPU execution-time / fill-rate measurement** — browsers don't expose it on mobile; covered by
  real-device `?dev`. This gate is a CPU proxy with structural `load.*` guards, nothing more.
- **No cross-machine or cross-browser-version trace stability.**
- **No absolute performance budgets** ("update must be < 0.5ms") — only relative A/B regressions.
- **No server-side sim A/B** — the game sim is client-side; the server is catalog/accounts. If a future diff
  touches server sim-relevant code, revisit then (not v1).
- **No RLE/compression of traces**, no `mode:'sim'`-only gate (report it, key on `full`), no 4th trace beyond
  the one load-pinned canonical trace.
