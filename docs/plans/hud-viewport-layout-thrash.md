# HUD forces synchronous layout every frame — cache the viewport in `applyOrientation`

**Status:** ready to build. Measured on a real phone 2026-09-01; the numbers below are evidence, not
estimates. Do **not** re-derive them — the capture needs a USB-attached phone that the building session
will not have.

**Scope:** one small change in `client/src/engine.js` plus a guard scenario. The level-start warm is a
**separate, larger** item and is explicitly out of scope (see §7).

---

## 1. The defect

`client/src/engine.js:34-35`:

```js
export const gameW = () => G.rotated ? window.innerHeight : window.innerWidth;
export const gameH = () => G.rotated ? window.innerWidth : window.innerHeight;
```

`window.innerWidth` / `innerHeight` are layout-inducing reads: if the layout is dirty, Blink must flush
style and layout synchronously before it can answer. Five HUD functions call this pair **every frame**,
each interleaved with style writes from `updateHud` and from the markers themselves, so the frame is a
write → read → write → read sequence. Each read after a write forces a mid-frame recalc.

Call sites (all in `client/src/hud.js`, all called every frame from the DOM block of `animate()` in
`client/src/main.js:1121-1134`):

| line | function |
|---|---|
| `hud.js:198` | `updateMarkers` |
| `hud.js:231` | `updateDropMarkers` |
| `hud.js:279` | `updateMissionMarker` |
| `hud.js:302` | `updateCreditPopups` |
| `hud.js:356` | `updateEnemyHealthBars` |

Ten layout-forcing reads per frame.

## 2. The measurement (already done — do not repeat)

**Device passport.** Redmi 15C (`25078RA3EE`), Android 15, Chrome 137, Mali-G52 MC2, drawing buffer
1600×720 at dpr 2, landscape, one tab. Graphics tier **`high`** — the saved value; the game has **no
hardware auto-detection**, so the tier is whatever was last stored under `localStorage.gfxTier`.

**Capture.** 83 s Chrome DevTools trace over adb/CDP, aligned to the level-load veil, 1,089,093 events.

**Forced-layout test.** A style/layout recalc that Chrome schedules for itself lands *after* the frame's
JS; one a script forces by reading layout lands *inside* `FireAnimationFrame`. Nesting is therefore the
test. On the renderer main thread over 1987 frames:

| event | placement | n | total | avg |
|---|---|---|---|---|
| `UpdateLayoutTree` | **inside rAF (forced)** | 2832 | 1519 ms | 0.536 ms |
| `Layout` | **inside rAF (forced)** | 793 | 452 ms | 0.569 ms |
| `Layout` | after the frame (scheduled) | 1147 | 642 ms | 0.559 ms |
| `UpdateLayoutTree` | after the frame (scheduled) | 1740 | 417 ms | 0.240 ms |

→ **1.82 forced recalcs per frame, 0.99 ms per frame.** A forced style recalc costs 0.536 ms against
0.240 ms for a scheduled one — 2.2× — because it must flush everything the script just dirtied.

Steady-state telemetry reports `js.dom` ≈ 1.6 ms/frame, so roughly **two thirds of the DOM time the game
measures is this self-inflicted layout**, not real DOM work.

## 3. Expected outcome — read this before promising anything

The frame is **GPU-bound**, not CPU-bound. In the same trace the renderer main thread was busy 29,722 ms
of 82,893 ms (36%) while the GPU process main thread was busy 54,833 ms (66%) and carried 117 tasks over
50 ms against the renderer's 9.

**So this change is not expected to raise fps.** The saved ~1 ms/frame will be absorbed into GPU wait. It
removes main-thread jitter and makes `js.dom` mean what it says. The maintainer chose it on
code-correctness grounds with that stated up front — do not re-litigate it as a perf win, and do not
report an fps delta as the success criterion.

## 4. The change

`applyOrientation()` (`client/src/engine.js:82`) is documented as *"Called at boot and on every
resize/orientationchange (the only place we size the renderer)"* — the single existing choke point.

```js
let _gameW = 0, _gameH = 0;
export const gameW = () => _gameW;
export const gameH = () => _gameH;

export function applyOrientation() {
  applyDevice();
  G.rotated = Device.hasTouch && window.innerHeight > window.innerWidth;
  document.body.classList.toggle('rot', G.rotated);
  _gameW = G.rotated ? window.innerHeight : window.innerWidth;   // the ONE read per resize
  _gameH = G.rotated ? window.innerWidth  : window.innerHeight;
  camera.aspect = _gameW / _gameH;
  camera.updateProjectionMatrix();
  renderer.setSize(_gameW, _gameH);
}
```

Signatures are unchanged, so all seven call sites keep working untouched.

## 5. Risks that must be covered, not assumed

1. **Boot ordering.** `gameW()` called before `applyOrientation()` (invoked at `engine.js:90`) now returns
   `0` instead of a live size. Today nothing does — `engine.js:58` and `:77` read `window` directly — but
   this is a new fragile edge. Close it (initialize at declaration, or make the accessor fail loudly),
   don't just note it.
2. **Ordering inside the function.** The cache must be assigned **after** `G.rotated` is set, since the
   two swap on it.
3. **Stale cache.** If the cache misses a resize, every HUD marker lands in the wrong place. The guard
   **must** cover a resize, not only a static frame. On a phone this shows up on rotation.
4. **Mobile viewport churn.** The URL bar showing/hiding fires `resize`; confirm that path reaches
   `applyOrientation`.

## 6. The guard test — this is half the point

The maintainer's reason for doing this is that the pattern **reproduces**: five HUD functions were
written from one template, so the sixth will be too. The test has to fail on that sixth function.

Requirements:

- **It must be a visual-suite scenario** (`client/visual/scenarios/`), **not** `node --test`. Client
  modules import `three` and will not load in node — a node test would pass while measuring nothing.
- **Step real rAF frames.** The HUD updaters run in `animate()`, not in `stepSim`, so a
  `__game.stepSim`-driven loop will not exercise them. Do not wait on wall-clock time either; drive a
  fixed number of animation frames.
- **Case 1:** after boot, install counting getters over `window.innerWidth` / `innerHeight`, run N frames,
  assert **zero** reads.
- **Case 2:** resize the viewport, assert `gameW()`/`gameH()` reflect the new size — proving the cache is
  refreshed and not merely frozen.
- Negative-test the guard itself: confirm it **fails** against the current (pre-fix) code. A guard that
  passes both before and after is not a guard.

## 7. Explicitly out of scope

The **incomplete level-start warm**. Same trace, separate defect: five main-thread blocks of 58–190 ms
inside the two seconds around the veil, and shader program count climbing 14 → 26 → 32 → 42 with the
**32 → 42 leg happening after the veil has already dropped** (`prewarmShaders` at `main.js:790` only
compiles what is in the scene at that moment). Bigger win, separate brief, do not fold it in here.

## 8. Docs to update (CLAUDE.md workflow)

- **CHANGELOG.md** — bullet under today's date: what changed and the user-visible effect (be honest: no
  fps change expected; removes forced synchronous layout).
- **SUMMARY.md** — update wherever `gameW`/`gameH` and the HUD overlay pass are described; bump
  `**Updated:**`.
- **DECISIONS.md** — only if a real trade-off surfaces (e.g. if caching is rejected for a live read).

## 9. Agent gates

Per `docs/plans/multi-agent-pipeline.md` and DECISIONS §141: the 49-scenario visual suite and the A/B perf
bench are **opt-in** — ask the maintainer before running either, and a stuck agent reports rather than
grinds. Two worktrees running `visual/run.mjs` at once silently test each other's code (hardcoded port
4173); check `lsof -i :4173` first.
