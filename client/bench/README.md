# Deterministic replay benchmark + perf-regression gate

Catches when a code change makes the **per-frame CPU cost** worse by **>2%** on weak-device-class JS work,
**before it lands**. It records a playthrough as a deterministic input trace, then **replays** that trace
identically on two builds (merge-base `A` vs feature `B`) on the same machine in the same job, and compares
the JS-work buckets (`js.update` / `js.dom` / `js.render` / `js.total`) A/B.

Extends the shipped `?dev` perf monitor (`docs/plans/perf-low-end-phones.md`, DECISIONS §23 + §41).

## The GPU blind spot (read first)

This gate measures the **CPU/JS half only** — the buckets `devPerf` already produces. That is the half that
can be measured deterministically on a desktop/CI. It does **NOT** measure GPU execution / fill-rate / thermal
behaviour (browsers don't expose those on mobile). A change that only adds GPU cost (an extra additive-particle
layer, a render pass, a bigger backbuffer, a heavier shader) can regress a real weak phone while `js.*` stays
flat. To partly cover this the gate also tracks structural signals from the per-tick scene `load` snapshot
(`draws`, `tris`, `particles`) and flags growth — but that is a **proxy, not a GPU measurement**. Real-device
`?dev` telemetry remains the source of truth for the GPU/thermal half.

## Files

- `src/bench.js` (in `client/src/`) — the `?bench` flag (`benchMode`/`isBench`, sticky like `?dev`) + the
  seeded RNG (`installSeededRandom` / `mulberry32`) + `BENCH_DT` (fixed 1/60 step).
- `gen-trace.mjs` — deterministic generator for the canonical trace.
- `traces/combat-heavy.json` — the committed canonical trace (output of the generator).
- `run.mjs` — the A/B runner (forks Chromium + an isolated server).
- `stats.mjs` — pure median + bootstrap-CI + verdict (unit-tested in `stats.test.js`).

## Generate the canonical trace

```
cd client && node bench/gen-trace.mjs      # writes bench/traces/combat-heavy.json (byte-identical each run)
```

`combat-heavy.json` is **load-pinned**: `setup.maintainEnemies` makes the replayer respawn to hold a fixed
enemy count each tick, so the per-frame workload is structurally constant regardless of who wins the fight —
a gameplay-touching diff still gets a clean A/B comparison.

## Run the gate

```
cd client && npm run bench                 # or: node bench/run.mjs
```

Environment:
- `BENCH_A_DIR` — the merge-base client dir (build A). Unset ⇒ `A === B ===` this client (self-comparison /
  noise-floor mode).
- `BENCH_B_DIR` — the worktree client dir (build B). Defaults to this client.
- `BENCH_REPS` (default 15) — interleaved reps per build. Raise it if the self-compare CI isn't < 2%.
- `BENCH_THROTTLE` (default 4) — CDP CPU throttle multiplier (multiplies A and B equally; ratio preserved).

If **either** build lacks `window.__bench` (e.g. a merge-base that predates this harness), the runner prints
`gate inactive (baseline predates bench harness)` and exits 0. Real A/B activates on the first feature merged
*after* the bench harness itself.

### Reading the report

```
trace combat-heavy [full] (15×2 reps, 4× CPU throttle)
  js.update   0.42ms → 0.47ms   +11.9%  [+9.1%, +14.6%]   REGRESSION
  js.dom      0.31ms → 0.31ms    +0.6%  [−2.1%, +3.4%]    FLAT
  js.render   0.55ms → 0.55ms    +0.2%  [−1.8%, +2.1%]    FLAT
  js.total    1.28ms → 1.33ms    +3.9%  [+2.4%, +5.6%]    REGRESSION
  load.draws 74 → 74 · tris 66000 → 66000 · particles 40 → 40 · enemies 6 → 6   FLAT
  VERDICT: REGRESSION (js.total +3.9%)
```

A bucket is `REGRESSION` only when the **CI lower bound** of the delta ratio exceeds **+2%** (we are confident
the true regression is >2%, not point-estimate noise); `IMPROVED` when the upper bound is < −2%; else `FLAT`.
The gate keys on `js.total` (full mode) / `js.update` (sim mode), OR any structural `load.*` growth.

## Validation checks

- **Noise floor (self-compare):** `node bench/run.mjs` on an unchanged tree (`A === B`) → every bucket `FLAT`
  (exit 0). Interleaving is **paired** (`A[i]`/`B[i]` run back-to-back, orders flipped each round) so common-mode
  machine noise cancels in the ratio (see `stats.mjs`).
- **Which bucket to trust — read this.** On **software GL (swiftshader), the desktop/CI default**, the
  full-mode **`render` bucket rasterizes on the CPU**, so its per-run cost is genuinely noisy (~10–20% CI at
  ~15 reps) and it dominates `js.total`. That is a swiftshader artifact, *not* real GPU submit cost (on a real
  GPU `render` is just command-buffer building — cheap + stable). The tight, **2%-sensitive** signal on
  swiftshader is **`sim`-mode `js.update`** (`[-1.8%, +2.0%]` at 12 reps here) — a pure `update(dt)` loop with
  no render noise. The gate fires on **either** `sim.js.update` **or** `full.js.total` regressing, so a real CPU
  regression is caught by the clean `sim` signal even when `full` is too noisy to resolve 2%. If you need a
  tight `full` number, raise `BENCH_REPS` (CI narrows ~1/√reps) or run on real-GPU CI.
- **Deliberate regression (verified):** add a busy-loop in `update()` (`client/src/sim.js`), point
  `BENCH_A_DIR` at a clean checkout, and run → the gate reports **`REGRESSION`** on `sim.js.update` (and
  `full.js.total` once the added cost clears the `full` noise floor) and exits non-zero. Remove the busy-loop →
  back to `FLAT`. A ~10% `update` slowdown is comfortably resolved by the `sim` bucket; the `full` bucket needs
  a larger delta to clear its swiftshader noise.

## Recording a real playthrough (deferred follow-up)

The v1 gate trusts the synthetic `combat-heavy.json`. Authoring a **human-flown** trace is a documented
follow-up (not a v1 blocker):

1. Run the client locally and open it with `?bench=record`.
2. Play a representative ~15 s heavy fight.
3. In the console: `window.__bench.stop('my-trace')` — it finalizes the trace and triggers a JSON download.
4. Save the file into `client/bench/traces/` (it is auto-discovered by the runner).

The recorder seeds `Math.random` with a fixed constant (`BENCH_SEED`, matching `gen-trace.mjs`) so the recorded
run replays bit-for-bit. Keep human traces load-pinned (`setup.maintainEnemies`) if the diff you gate might
change gameplay.
