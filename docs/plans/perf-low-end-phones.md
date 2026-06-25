# Plan: performance pass for weak phones (Samsung Galaxy A03s class)

## Goal
A tester on a **Samsung Galaxy A03s** (PowerVR GE8320 — a very weak GPU) reports **~25 fps even on the
Performance tier**. Get that class of device to a smoother frame rate **without hurting the look on
capable hardware**. The graphics-tier system already exists (`client/src/graphics.js`, DECISIONS §23);
this plan extends it, measurement-first.

## Diagnosis (what is and isn't the bottleneck)
Per DECISIONS §23, this game is **fragment fill-rate / overdraw bound** on mobile, not triangles or model
file size. The per-frame cost on a weak GPU is dominated by:
- **two full-screen render passes** every frame — sky scene then combat scene (`client/index.html ~:2625`:
  `renderer.clear(); renderer.render(skyScene, camera); renderer.clearDepth(); renderer.render(scene, camera);`),
- **additive-blended particles** (exhaust, explosion fireballs, shockwave) — heavy overdraw,
- **pixel ratio × resolution** (`renderer.setPixelRatio(min(devicePixelRatio, gfx.pixelRatioCap))`, `~:708`).

The 463 KB→371 KB model size and the env map are **not** the cause (env map is already off on Performance).
So the levers below all target **fill rate**.

## Step 0 — MEASURE FIRST (do not skip)
The right fix depends on whether the device is pass-bound or particle-bound. Have the tester read the
**perf overlay** (top-center: FPS / frame ms / draw / tris / **backbuffer resolution `w×h`**) in two
situations, on the **Performance** tier:
1. **Empty menu / quiet scene** (no enemies, no firing) — isolates the fixed cost (two passes + pixel ratio).
2. **Heavy fight** (multiple enemies firing, an explosion) — adds the particle/overdraw cost.

Interpretation:
- Low fps **already at idle** → the **two render passes + resolution** dominate → do Levers A & B.
- fps **craters only during combat** → **particle overdraw** dominates → do Lever C.
- Capture before/after numbers for each lever so we keep what helps and revert what doesn't.

> **MEASUREMENT FINDING (2026-06-25) — the surprise that reshaped the plan.** The tester reported the
> **same 15-25 fps in *combat* on both High AND Performance** (the perf overlay only shows numbers in
> combat, so idle couldn't be isolated). That's the key datum: Performance is a ~4× pixel cut
> (pixelRatioCap 2→1) plus AA/envMap/particles off, yet fps didn't budge. Two live hypotheses:
> **(1)** the device's `devicePixelRatio` is ~1, so `min(DPR,2)` == `min(DPR,1)` — the cap **never reduced
> pixels** (so only a sub-1 `renderScale` can test fill rate); or **(2)** the frame is **CPU-bound** (the
> per-frame `update` + DOM HUD/markers/minimap, or the fixed two-pass overhead), where resolution is
> irrelevant. **Lever A (renderScale) + the cheap half of Lever C (particle ceiling) ship together because
> they test both at once**, and the new **resolution readout in the perf overlay** (`w×h`) lets the tester
> see whether `renderScale` actually moved the pixel count — distinguishing (1) from (2) directly.

> **MEASUREMENT FINDING #2 (2026-06-25) — second device, same story + a new clue.** A Redmi 10c tester:
> fps **independent of the tier** (High gave a *higher* fps than Performance — impossible if our knobs were
> the wall; a test-order thermal artifact) **and independent of scene load** (brief dips to ~35 while
> *simply turning* with nothing happening; a steady 55-60 during two simultaneous explosions + a station on
> screen). That's the fingerprint of **external governing** — thermal/DVFS + browser frame-pacing
> (vsync/compositor) + GC — which none of our levers touch. Confirms: a single fps number is the wrong
> instrument. → built the **`?dev` perf monitor** below.

## The `?dev` perf monitor (SHIPPED 2026-06-25 — the real measurement instrument)
Opening the game with **`?dev`** (mirrors `?tune`/`?debug`; **off/zero-overhead** otherwise) turns on
`devPerf` in `client/index.html`. Each frame it times the JS work in three buckets — **`update`** (sim) /
**`dom`** (HUD + markers + minimap + OOB) / **`render`** (the two-pass `renderer.render` *submit* cost) —
and once per second ships an aggregated sample to **`POST /api/perf`** → **`perf_samples`** table
(migration 015 SQLite / Postgres bootstrap; `recordPerfSample`/`getPerfSamples` in both datastores).
- **Sample shape:** `{ t, scene, fps, frames, frameMs:{p50,p95,max}, js:{update,dom,render,total,totalP95},
  jank, load:{enemies,particles,draws,tris}, heap:{used,total,limit}|null, res, device }`. `heap` is JS-heap
  MB via `performance.memory` (Chrome-only; **not** process RSS or GPU memory — textures/buffers live in the
  driver; the live overlay also shows `usedMB` in `?dev`). `device` (once): `ua, dpr, cores, mem` (=device
  RAM GB), `screen, gpu` (real chip via `WEBGL_debug_renderer_info`), `gpuVendor, tier, knobs`.
- **Transport:** batched every ~5 s + on tab-hide (`sendBeacon`), cap 120 samples/batch, write-only (no
  public read). A `●dev` marker shows on the perf overlay while recording. Workflow: **give a friend a
  `/?dev` link**, then read `perf_samples` with SQL.
- **The decisive read:** `js.total` ≪ `frameMs.p50` → **not** CPU-bound → external/GPU-governed (graphics
  settings won't help — accept the device or chase GPU/compositor). `js.total ≈ frameMs.p50` → **CPU-bound**
  → cut per-frame JS (throttle `updateMarkers`/`updateMiniMap`/`updateHud`, profile `update`).
- **Caveat:** browsers don't expose true GPU execution time on mobile (`EXT_disjoint_timer_query` disabled),
  so `render` is the CPU *submit* cost only — a low `js.total` with low fps still localizes the problem to
  "not our JS", which is the answer we need.

## Levers (ranked; each is independent and tier-gated so capable devices are untouched)

### Lever A — render below native resolution on Performance (biggest, cheapest) — ✅ SHIPPED 2026-06-25
Fill rate scales with pixel count. Performance currently caps `pixelRatioCap: 1` (`graphics.js ~:13`).
Add a sub-1 **`renderScale`** knob and apply it to the pixel ratio:
- `graphics.js` TIERS: add `renderScale` — `high: 1, balance: 1, performance: 0.75` (try 0.7–0.8).
- `client/index.html ~:708`: `renderer.setPixelRatio(Math.min(window.devicePixelRatio, gfx.pixelRatioCap) * gfx.renderScale)`.
The canvas stays full-size (CSS), so the GPU renders fewer pixels and the browser upscales. Expect a
**large** fps gain on a fill-bound GPU for a small sharpness cost (acceptable on a small phone screen).
Tune `renderScale` against the tester's numbers; this alone may get the A03s over the line.

> **Shipped:** `renderScale` added to `graphics.js` TIERS (`high: 1, balance: 1, performance: 0.7`) and
> applied at `client/index.html` `renderer.setPixelRatio(min(DPR, cap) * gfx.renderScale)`. `setSize()`
> preserves the ratio, so the resize handler needed no change. **Next: get the tester's before/after combat
> fps + the new `w×h` readout.** If `w×h` drops but fps doesn't → hypothesis (2), CPU-bound → pivot to
> cutting per-frame CPU (throttle the DOM HUD/markers/minimap, profile `update`), not more pixel levers.
> If fps rises → hypothesis (1) confirmed; tune `renderScale` (try 0.6–0.8).

### Lever B — cheaper sky pass on Performance
The sky scene (background + planet + 2 moons + stars) re-renders **every frame** as a full-screen pass.
Two options (B1 is simpler/safer):
- **B1 — render the sky pass less often.** Render the sky to its own render target every **N frames**
  (N=2–3 on Performance) and blit/reuse it between; the combat pass still runs every frame. The sky barely
  moves frame-to-frame (parallax only), so staleness is invisible. Needs a small `WebGLRenderTarget` +
  a fullscreen quad to composite (`client/index.html` render loop `~:2625`). Gate on a new
  `gfx.skyEveryNFrames` (1 on High/Balance, 2–3 on Performance).
- **B2 — render the sky at lower resolution** into a half-res target and upscale (a second `renderScale`
  just for the sky). More work than B1; do only if B1 is insufficient.
Either way, **measure** — if Lever A already hits target, B may be unnecessary.

### Lever C — cut particle overdraw further on Performance — ⏳ PARTIAL (cheap half shipped 2026-06-25)
`particleScale` already thins sparks, **drops the 2 middle fireball layers + the shockwave**, and thins the
exhaust (`spawnShipExplosion ~:1486–1511`, `emitExhaust ~:1546`, `scaledCount ~:1449`). On Performance go
further:
- **Throttle exhaust emission** harder (emit every other thrust frame, or cap concurrent trail particles).
- **Cap total live particles** with a hard ceiling on the lowest tier (skip new emits when over budget).
- Consider replacing the largest **additive** explosion layer with an **alpha-blended** sprite on
  Performance (additive overdraw is the worst case for these GPUs).
Gate all of it on the tier (`gfx.particleScale` / a new `gfx.maxParticles`). Keep High/Balance as-is.

> **Shipped (cheap half):** `gfx.maxParticles` (`high/balance: Infinity, performance: 300`) is a hard
> ceiling on live additive particles — `liveParticles()` = `trail.length + sparks.length`; `emitExhaust`
> bails over budget and `spawnShipExplosion` clamps its spark count to the remaining budget
> (`client/index.html`). **Not yet done:** swapping the largest additive explosion layer for an
> alpha-blended sprite (the worst-case overdraw) — do only if combat fps stays low after measuring.

### Lever D (optional) — a 4th "Potato" tier
If A03s-class devices still struggle after A–C, add a **lowest tier** below Performance:
`renderScale ~0.6`, `skyEveryNFrames 3`, particles minimal, env map off (already), stars min. Auto-suggest
it only when a device is detected as very weak (or leave it as a manual pick). Decide after measuring.

## Implementation notes
- All knobs live in **`graphics.js` TIERS** (pure data, testable) and are read off `gfx` in `index.html`
  exactly like the existing `pixelRatioCap` / `antialias` / `starScale` / `particleScale` / `envMap`.
- **Changing a tier already reloads the page** (so constructor-time knobs like resolution apply cleanly) —
  keep that behavior for any new constructor-time knob.
- Don't regress capable devices: every new knob is **1.0 / off** on High and Balance.
- Update the tier-knob table in `graphics.js` and its test (the knob table is unit-tested).

## Tests & docs
- `graphics.js` has a pure tier table — extend its unit test for the new knobs.
- Visual smoke (`cd client && node visual/run.mjs`) to confirm nothing breaks at default (High) tier.
- **SUMMARY** "Graphics quality tiers" section — document the new knobs (`renderScale`,
  `skyEveryNFrames`/sky-pass throttle, particle ceiling). **CHANGELOG** — one bullet. **DECISIONS §23** —
  extend with the resolution-scaling + sky-pass-throttle rationale (fill-rate, measured on device).

## Open decisions
- **Exact `renderScale` for Performance** — start 0.75, tune to the tester's fps (Step 0). Resolve on device.
- **Lever B at all** — only if idle fps is low after Lever A. Measure before building B1.
- **4th tier** — defer until A–C are measured; don't add speculative tiers.
- **Headless caveat:** the visual harness uses software WebGL (swiftshader) and can't reproduce the A03s
  GPU — these levers must be **validated on the real device** via the perf overlay, not in CI.
