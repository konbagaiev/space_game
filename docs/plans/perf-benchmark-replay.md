# Plan: deterministic replay benchmark + pre-commit perf-regression gate

## Goal
Catch when a code change makes the **per-frame CPU cost** worse by **>2%** on weak-device-class work,
**before it lands**, and surface it to the maintainer. Do it by recording a real playthrough once into a
**deterministic input trace**, then **replaying** that trace identically on `main` (merge-base) and on the
feature branch inside the feature-pipeline, comparing the JS-work buckets **A/B** on the same machine in
the same job.

This extends the measurement work in `docs/plans/perf-low-end-phones.md` (the shipped `?dev` perf monitor)
and DECISIONS §23. It does **not** replace real-device testing — see **Scope & the GPU blind spot**.

## Scope & the GPU blind spot (READ FIRST — non-negotiable framing)
This benchmark measures the **CPU/JS half** only — the `js.update` / `js.dom` / `js.render` (submit) buckets
already produced by `devPerf` (`client/src/main.js:355`). That is exactly the half that CAN be measured
deterministically on a desktop/CI (per the perf-low-end-phones findings: the A03s/Redmi were largely
**fill-rate / thermal / compositor-governed**, which no desktop run reproduces).

Consequences the executing agent MUST honor:
- The gate primary metric is **`js.*`, never `fps`/`frameMs`** (wall-clock is vsync/compositor-noisy, never
  2%-detectable — see perf-low-end-phones).
- A **green gate ≠ "no A03s regression."** A change that only adds GPU cost (an extra additive-particle
  layer, an extra render pass, a bigger backbuffer, a heavier shader) can regress a real A03s while `js.*`
  stays flat. To partly cover this, the gate ALSO tracks secondary structural signals from `devPerf.load`
  (`draws`, `tris`, `particles`) and the `js.render` submit bucket, and flags growth in those too — but
  states plainly it is a proxy, not a GPU measurement.
- Real-device `?dev` telemetry (already shipped) remains the source of truth for the GPU/thermal half.

## Why "record a playthrough" is feasible here
`update(dt)` (`client/src/sim.js:304`) is a **pure function of `(G state, keys, touchAim, dt, Math.random)`** —
there is **no wall-clock in the gameplay math** (the only `performance.now()` reads are `G.gameStartTime`
bookkeeping in `state.js:45` / `sim.js:722`, which do not feed the sim). Input is two mutable shared
objects, `keys` and `touchAim` (`client/src/state.js:98-99`), written by the listeners in
`client/src/main.js` (keydown/keyup ~:91-94, touch stick ~:137-147, fire/rocket buttons ~:202-223). So if
we (1) seed `Math.random`, (2) drive a **fixed `dt`**, and (3) feed a recorded per-tick snapshot of
`keys`+`touchAim`, the whole simulation is reproducible bit-for-bit within one browser binary.

FP note: JS doubles + `Math.*` are deterministic within a single V8/Chromium build. The A/B always runs both
branches on the **same** headless Chromium binary in the **same** job, so transcendental-function last-bit
differences across browser versions never enter the comparison. Do **not** rely on cross-machine or
cross-version trace stability.

## Architecture overview
```
  authoring (once, by a human):
    open game with ?bench=record  →  play  →  __bench.stop() downloads trace JSON
    trace committed to client/bench/traces/<name>.json

  measurement (in CI / pipeline, per diff):
    bench/run.mjs
      ├─ start isolated server (throwaway SQLite)              [reuse visual/run.mjs pattern]
      ├─ launch ONE headless Chromium (swiftshader)
      ├─ for rep in 1..N, interleaved A,B,A,B,…:
      │     checkout A = merge-base build,  B = worktree build  (served as static files)
      │     page.goto(?bench=replay) → __bench.replay(trace) → returns per-bucket stats
      ├─ aggregate medians + bootstrap CI per bucket
      └─ verdict: B.median > A.median × 1.02 (CI lower bound > +2%)  → REGRESSION flag
```

## Determinism prerequisites (3 nondeterminism sources, each pinned)
1. **`Math.random`** — install a seeded PRNG (mulberry32) BEFORE any game module runs, under the `?bench`
   flag. Modules call `Math.random()` at call-time (e.g. `projectiles.js:86`, `drops-config.js:27`), never
   caching the function reference, so a global override taken early is sufficient.
2. **`dt`** — in bench mode the loop uses a **fixed** step (default `1/60`s) instead of
   `clock.getDelta()` (`client/src/main.js:452`). The sim already clamps `dt` to `0.05`, so `1/60` is safe.
3. **Input** — per tick, snapshot the resolved input state, not raw DOM events:
   `{ k: [<KeyboardEvent.code strings currently true>], t: touchAim.active ? [heading, thrust] : null }`.
   Replay writes these back into the shared `keys`/`touchAim` objects each tick before calling `update`.

## Trace format (`client/bench/traces/<name>.json`)
```jsonc
{
  "version": 1,
  "name": "combat-heavy",
  "seed": 1234567,          // PRNG seed used at record time
  "dt": 0.016666,           // fixed step (s) — record and replay MUST match
  "warmupTicks": 120,       // ticks to run but EXCLUDE from timing (JIT/shader warmup)
  "ticks": [                // one entry per simulated frame, in order
    { "k": ["KeyW","Space"], "t": null },
    { "k": ["KeyW","KeyA","Space"], "t": null },
    { "k": [], "t": [1.57, 0.8] }   // touch heading=1.57rad thrust=0.8
    // …
  ],
  "setup": {                // optional deterministic scene setup applied before tick 0
    "shipId": 1,            // player ship to build (fixed, not account-dependent)
    "spawns": [ { "atTick": 0, "count": 6 } ]   // enemy waves (uses spawnEnemyShip via __bench)
  }
}
```
Keep traces small: RLE is unnecessary at ~600–1800 ticks (10–30 s). One trace ≈ tens of KB.

## Component 1 — seeded RNG + bench flag (`client/src/bench.js`, NEW)
- Mirror `client/src/dev.js` (sticky flag). `isBench()` / `benchMode()` returns `'record' | 'replay' | null`
  from `?bench=record` / `?bench=replay` (and a sticky sessionStorage copy so a reload keeps it).
- Export `installSeededRandom(seed)`: sets `Math.random = mulberry32(seed)` (pure, ~5 lines). Idempotent.
- Import `client/src/bench.js` **first** in `client/src/main.js` (before the imports that may call random at
  module init), and call `installSeededRandom` in bootstrap the moment bench mode is detected, before the
  player/enemies are built.
- Zero overhead when `?bench` absent (same discipline as `?dev`).

## Component 2 — recorder (`__bench` hook, in `client/src/main.js`)
Attach under `?bench` (extend the existing `location.search.includes('debug')` block at `main.js:502`, or a
sibling `?bench` block). Expose on `window.__bench`:
- `record()` — start capturing. From now the animate loop (see Component 4) runs at fixed `dt` and pushes a
  tick snapshot each frame.
- `stop()` — finalize a trace object `{version, name, seed, dt, warmupTicks, ticks, setup}` and trigger a
  JSON download (`Blob` + anchor click) so the human can save it into `client/bench/traces/`.
- `mark(name)` — optional: label the current tick (for future partial-scene analysis).
Recording runs the **real, playable** game (a human flies it) but with fixed `dt` so record == replay.

## Component 3 — replayer (`__bench.replay(trace)`, in `client/src/main.js`)
`window.__bench.replay(trace)` (async, resolves to a stats object):
1. `installSeededRandom(trace.seed)`, `reset()` to a clean fight, apply `trace.setup` (build the fixed ship,
   spawn the fixed waves via `spawnEnemyShip`).
2. Run `trace.ticks` in order. For each tick: clear+set `keys` from `tick.k`, set `touchAim` from `tick.t`,
   then execute ONE full frame’s work timed into the same three buckets `devPerf` uses:
   `t0→update(dt)→t1→(HUD/markers/minimap DOM updates)→t2→(two-pass renderer.render submit)→t3`.
   Reuse the exact call sequence from `animate()` (`main.js:~452-477`) so buckets are comparable to live.
3. Discard the first `warmupTicks` from timing. For the rest collect per-tick `{update, dom, render, total}`
   plus a per-tick `load` snapshot (`enemies`, `particles`, `draws`, `tris`).
4. Return `{ update, dom, render, total, load:{draws,tris,particles} }` where each field is the **median**
   over timed ticks (median, not mean — robust to a stray GC pause), plus the raw per-tick arrays for the
   runner’s bootstrap CI.

Modes:
- **`mode:'full'`** (default) — update+dom+render, matches live frame cost.
- **`mode:'sim'`** — call only `update(dt)` in a tight loop (no DOM, no render). Tightest, lowest-noise
  signal; the most 2%-sensitive for pure-sim changes. The runner records both; the gate keys on `full` but
  reports `sim` too.

Determinism self-check: `replay()` twice on the same build must return identical **entity trajectory**
(assert on final `G` entity counts / a cheap state hash). If it diverges, a hidden random source exists —
that is a real bug the recorder flushed out; fail loudly.

## Component 4 — fixed-dt loop hook (`client/src/main.js` `animate()`)
Add a bench branch in `animate()` (`main.js:~448`): when `benchMode()` is active, use `dt = BENCH_DT`
instead of `clock.getDelta()`, and (in record mode) push the tick snapshot after `update`. Keep the
non-bench path byte-identical (guard with the sticky flag so normal play and the `?dev` path are untouched).

## Component 5 — A/B runner (`client/bench/run.mjs`, NEW)
Model on `client/visual/run.mjs` (isolated server + throwaway SQLite + swiftshader Chromium — reuse its
server-spawn, `waitForHealth`, and launch args verbatim). Differences:
- Serves **two builds**: `A` = merge-base checkout, `B` = the worktree HEAD. Simplest: the pipeline passes
  two dirs (or two git refs) via env; the runner serves static client files from each and points the same
  isolated API server at both (the client is static; only `/api/*` needs the server, which is
  branch-agnostic for perf). If a diff changes server sim code too, serve each build’s own server — see
  Open Questions.
- **Interleaved reps** `A,B,A,B,…` (default `N=15` each; configurable). Interleaving cancels slow thermal
  drift so the ratio stays clean.
- Optional CDP **CPU throttle** (`Emulation.setCPUThrottlingRate`, default `4×`) applied to the page. It
  multiplies both A and B equally (ratio preserved) and nudges the A03s CPU proportions; keep it on but it
  is not what delivers 2% — the interleaved-median design is.
- For each rep: `page.goto(<build>/?bench=replay)`, wait for `window.__bench`, run
  `await page.evaluate(t => window.__bench.replay(t), trace)`, collect the returned per-tick arrays.
- Runs every trace in `client/bench/traces/` (auto-discovered, like visual scenarios).

## Component 6 — statistics & verdict (`client/bench/stats.mjs`, NEW; pure + unit-tested)
- Aggregate the interleaved reps per build per bucket. Use the **median of per-rep medians**, and a
  **bootstrap 95% CI** on the A→B delta ratio `(B/A − 1)`.
- **Verdict per bucket:** `REGRESSION` iff the CI **lower bound** of the delta ratio exceeds **+0.02**
  (i.e. we are confident the true regression is >2%, not just point-estimate noise). `IMPROVED` iff CI
  upper bound < −0.02. Else `FLAT`.
- **Gate result:** flag if `js.total` (or `js.update` in `sim` mode) is `REGRESSION`, OR any structural
  `load.*` signal grew > a small epsilon (draws/tris/particles are integer-ish and near-deterministic, so
  even a small consistent rise is a real GPU-cost proxy — flag it).
- Emit a compact report: per-bucket `A median / B median / Δ% [CI]` and the verdict, e.g.
  ```
  trace combat-heavy (15×2 reps, 4× CPU throttle)
    js.update   0.42ms → 0.47ms   +11.9%  [+9.1%, +14.6%]   REGRESSION
    js.dom      0.31ms → 0.31ms    +0.6%  [−2.1%, +3.4%]    FLAT
    js.render   0.55ms → 0.55ms    +0.2%  [−1.8%, +2.1%]    FLAT
    load.draws  74 → 74 · tris 66k → 66k · particles ≈ equal   FLAT
    VERDICT: REGRESSION (js.update +11.9%)
  ```
- Exit non-zero on any `REGRESSION` so the runner is usable standalone (`node client/bench/run.mjs`) and in
  the pipeline.

## Component 7 — feature-pipeline integration
Insert a new stage **after reviewer `PASS`, before the retro/deploy question** in the flow
(`docs/plans/multi-agent-pipeline.md:59-65`):
```
… → implementer → [reviewer ⇄ implementer] → PASS
   → PERF A/B GATE                              ← NEW
   → retro (metrics) → deploy? → …
```
Stage behavior (orchestrator, not a sub-agent — it is deterministic tooling):
1. Compute the merge-base of the worktree branch vs `main`. Materialize build `A` from merge-base (a
   `git worktree add` at the merge-base, or `git archive` to a temp dir) and build `B` from the feature
   worktree HEAD.
2. Run `node client/bench/run.mjs` over all committed traces with both builds.
3. **If any trace verdicts REGRESSION → do NOT silently proceed.** Surface it to the maintainer as a
   blocking question (same posture as the reviewer returning `CHANGES` and the deploy y/n), showing the
   per-bucket table. Maintainer decides: accept (intended cost), send back to implementer, or abandon.
4. If all FLAT/IMPROVED → note it in the retro metrics and continue.
Add a retro-metrics row: **perf gate = FLAT / REGRESSION(bucket, Δ%)**.
Update the `feature-pipeline` skill (`.claude/skills/…` per the skill spec) and `multi-agent-pipeline.md`
to document the stage.

## Load-pinning for gameplay-changing diffs (accuracy guard)
A recorded trace replays **inputs**, not the world. If the diff changes gameplay (turn rate, damage, spawn
timing), the same inputs yield a **different entity population** on B → the perf delta is contaminated by
"different amount of work." Mitigations, in order:
- Ship at least one **load-pinned** trace whose `setup` respawns enemies to hold a fixed count and fires on
  a fixed cadence, so per-frame workload is structurally constant regardless of combat outcome. This is the
  trace the gate trusts for gameplay-touching diffs.
- The runner reports the per-build `load.*` (enemies/particles) alongside timings; if A and B diverge in
  `load` beyond a small tolerance, it **annotates the verdict as "load diverged — treat Δ as approximate"**
  rather than asserting a clean 2%.
- Non-gameplay diffs (render/HUD/refactor) stay in lock-step → clean 2% comparison; this is the common case.

## Files to create / change
**New:**
- `client/src/bench.js` — bench flag + `installSeededRandom` (mulberry32).
- `client/bench/run.mjs` — A/B runner (fork of `client/visual/run.mjs` structure).
- `client/bench/stats.mjs` — pure median/bootstrap-CI + verdict (unit-tested).
- `client/bench/stats.test.js` — table-driven tests for the verdict thresholds (2% boundary, CI logic).
- `client/bench/traces/combat-heavy.json` — first canonical trace (authored by a human, see Authoring).
- `client/bench/README.md` — how to record a trace, run the bench, read the report; the GPU-blind-spot note.

**Changed:**
- `client/src/main.js` — import `bench.js` first; bench branch in `animate()` (fixed dt + record snapshot);
  `window.__bench` record/stop/replay hook (near the `?debug` block at `:502`).
- `docs/plans/multi-agent-pipeline.md` — document the perf A/B stage + retro row.
- The `feature-pipeline` skill file — add the stage to the flow it executes.

## Authoring the first trace (human step, documented in `client/bench/README.md`)
1. `npm run` the local client, open `…/?bench=record` (dev build; needs `window.__bench`).
2. Play a representative ~15 s heavy fight (multiple enemies, sustained fire, at least one big explosion).
3. Run `__bench.stop()` in the console → save the downloaded JSON to `client/bench/traces/combat-heavy.json`.
4. Verify determinism: `node client/bench/run.mjs` on an unchanged tree → both A and B identical builds →
   every bucket must be `FLAT` with a tiny CI (sanity that the harness noise floor is < 2%). If the noise
   floor is not < 2%, raise `N`, raise `warmupTicks`, or prefer `sim` mode before trusting the gate.

## Docs to update on implementation (per CLAUDE.md docs workflow)
- **CHANGELOG.md** — under today's date: *"Deterministic replay benchmark + pre-commit perf-regression gate"*
  — what it measures (CPU `js.*` buckets), A/B interleaved design, the 2% flag, the feature-pipeline stage,
  and the explicit GPU blind spot.
- **SUMMARY.md** — new subsection near the `?dev` monitor description (the perf-samples paragraph ~:958):
  the `?bench` record/replay flags, trace format location, `client/bench/` runner, and the pipeline stage.
  Bump `**Updated:**`.
- **DECISIONS.md** — new numbered entry: *"Perf regression gate is relative A/B, not an absolute threshold"* —
  why 2% is only detectable as an interleaved same-job comparison, why the metric is `js.*` not `fps`, the
  CPU-only scope + GPU blind spot, and load-pinning for gameplay diffs. Cross-reference §23.

## Open questions (resolved inline)
- **Absolute vs relative threshold?** → **Relative A/B only.** Absolute stored baselines drown 2% in
  machine noise. Decided; see DECISIONS entry above.
- **Gate metric?** → **`js.total`** (`full` mode) primary; **`js.update`** (`sim` mode) and `load.*`
  secondary. Never `fps`/`frameMs`.
- **Hard-fail or ask?** → **Ask the maintainer** (blocking question), per the user's requirement ("поднимать
  вопрос мне"). Not an unattended CI hard-fail.
- **Reps / throttle defaults?** → `N=15` interleaved each side, `4×` CPU throttle. Tunable via env; the
  authoring determinism check validates the noise floor is < 2%.
- **Server-side sim changes?** → v1 assumes the diff is client-side (the game sim is client-side; the server
  is catalog/accounts). If a diff touches `server/` sim-relevant code, the runner serves each build's own
  server. Out of scope for v1 beyond noting it; revisit if it comes up.
- **Where does the seed come from at record time?** → a fixed constant chosen by the author and stored in
  the trace; not time-derived (keeps authoring reproducible).

## Acceptance criteria
- `node client/bench/run.mjs` on an unchanged tree reports all buckets `FLAT` with CI width < 2% (noise
  floor validated).
- Introducing a deliberate ~10% slowdown in `update()` (e.g. a throwaway busy-loop) makes the gate report
  `REGRESSION` on `js.update`/`js.total`; removing it returns to `FLAT`.
- `client/bench/stats.test.js` passes (2%-boundary + CI verdict logic).
- The feature-pipeline runs the stage after reviewer PASS and asks the maintainer on `REGRESSION`.
- Docs updated (CHANGELOG/SUMMARY/DECISIONS) and cross-linked with `perf-low-end-phones.md` + §23.

## Non-goals (v1)
- Measuring GPU execution time / fill rate (browsers don't expose it on mobile; covered by real-device
  `?dev`). This gate is a CPU proxy with structural `load.*` guards, nothing more.
- Cross-machine or cross-browser-version trace stability.
- Absolute performance budgets ("update must be < 0.5ms") — only relative regressions.
