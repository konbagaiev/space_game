# Combat record/playback — deterministic input-replay (`?record` / `?playback`)

**Feature ID:** 2026-07-09-replay-record · **Branch/worktree:** `feature/2026-07-09-replay-record`
**Status:** SHIPPED to prod + itch (2026-07-10) — mechanism + Level-0 cutscene + real intro flow all live (see Status below).

## Goal

A general, reusable way to **record a fight and replay it on the real engine**. A recording is the player's
**INPUT + the RNG seed** — NOT a movie of positions. Playback re-runs the actual `sim`, so it has real
projectile colors, smooth physics, real FX and real collisions, for free. Consumers: the Level-0 intro
cutscene (built on top, next), "watch a fight from another angle", video capture. Supersedes the
transform-replay approach (DECISIONS §59) for foreground combat; see DECISIONS §62.

## Trace format

```
{ version: 1, kind: 'input-replay', id, level, seed, dt, shipId, ticks: [ { k:[keyCodes], t:[heading,thrust]|null } ] }
```
- `seed` — the mulberry32 seed installed at record start (`Date.now()>>>0`). The ONLY thing beyond input the
  sim needs (audit: spawn timing/positions/loot/reload jitter all draw the global `Math.random`; no
  wall-clock or Map/Set-iteration-order deps in the sim path).
- `dt` — fixed step (`BENCH_DT` = 1/60). `shipId` — rebuilds the same player ship. `level` — catalog level
  name (`normalizeLevelName`: bare `N` → `level-N`). `ticks` — one input snapshot per sim tick.

## Files

- **`client/src/replay.js`** — pure core (DOM/engine-free, unit-tested in `replay.test.js`): `evalRecord`/
  `evalPlayback` URL parsing, `normalizeLevelName`, `snapshotInput`/`applyInput`, `makeTrace`/`validateTrace`.
- **`client/src/main.js`** — engine wiring: URL flags `REC`/`PLAY`; the fixed-timestep **accumulator** in
  `animate()`; `enterRecordMode`/`beginRecordCapture`/`stopRecordSession`/`startPlaybackSession`; the
  seeded-RNG isolation (`withSimRand`, `simRand`, `nativeRandom`); `watchModelsReady`; the record/playback
  UI; `loadTrace`/`downloadTrace`; the `window.__replay` hook.
- **`client/src/audio.js`** — pitch/variant/noise randomness moved to a module-local PRNG (`arand`), so audio
  never draws from the seeded sim stream.

## How it works

- **Record** (`?record=1&level={id}`): land on the level with the real ship **idle**; a top bar shows a
  **Start recording** button that unlocks once the ship `.glb` has loaded (via `THREE.DefaultLoadingManager`
  + a 2.5 s fallback). Start installs a fresh seed, `reset()`s the level, and the accumulator captures one
  `snapshotInput` per sim tick. **Stop & Save** → `makeTrace` → `localStorage['replay:{id}']` +
  `['replay:last']` + a `{id}.json` download + a **Play it ▶** link. `id = '{level}-{seed base36}'`.
- **Playback** (`?playback&id={id}`, or `?playback` = last): `loadTrace` (localStorage, then
  `/recordings/{id}.json`), `validateTrace`, rebuild the recorded ship, re-seed, `reset()`, hold the idle
  frame until the model loads, then the accumulator steps the trace one tick per fixed step. Top bar:
  `tick / total` + Restart.

### Two load-bearing invariants (found in live testing — do not regress)

1. **Fixed-timestep accumulator, not one-step-per-frame.** One `BENCH_DT` step per rAF frame ran 2× on a
   120 Hz screen. Both modes accumulate real elapsed time and take whole `BENCH_DT` steps → real-time on any
   refresh rate. Frames ≠ ticks **by design**.
2. **Seeded RNG feeds the sim ONLY.** Because frames ≠ ticks, cosmetic per-frame `Math.random`
   (stars/FX/HUD/idle frames/audio) would consume the seeded stream by a frame-count that differs between
   record and playback → divergence. `withSimRand(fn)` swaps the private seeded PRNG into `Math.random` only
   around `update()`/`reset()`; everything else uses `nativeRandom`. `audio.js` uses its own `arand`.

**Verification:** `window.__replay.hash()` (rounded-position state hash) matches between record and playback
bit-for-bit — validated for an idle run and an active fight (thrust+fire+turns), independent of frame rate,
audio state, and model-load timing. `window.__replay.step(n)` steps the sim synchronously (bypasses rAF —
for tests and background tabs that throttle rAF).

## Storage (decision + current state)

Recordings are an **S3 asset** (like ship `.glb`s — off git, synced prod↔local via `assets:pull`, referenced
from seed when promoted to prod). **Current build:** `localStorage` + `{id}.json` download only (the
same-browser dev loop). **Next:** wire an `assets-*`-style push/pull for `recordings/{id}.json` + a
`/recordings/` fetch fallback (already attempted by `loadTrace`), and reference promoted ids from the seed.

## Tests

- `client/src/replay.test.js` (8) — pure core. `cd client && node --test` (159 green).
- The engine path (accumulator, isolation, UI) is browser-only; validated via the `window.__replay` state-hash
  check above.

## Status — SHIPPED (prod + itch, 2026-07-10)

1. ✅ **S3-asset storage.** The canonical intro trace is a content-hashed S3 asset (`recordings/` prefix in
   `assets-config`/`assets-pull`), referenced from the `level-1` descriptor's `introTrace`, bundled into the
   itch build.
2. ✅ **Level-0 cutscene** — event-driven text pauses (P0–P4, +1s after each SIM EVENT) + auto "Return to
   base" to victory, on the real re-simmed fight (`client/src/level0-cutscene.js` + `main.js` runtime).
3. ✅ **Real new-player intro flow** — bootstrap `startIntroCutscene` (auto-play from the S3 trace) →
   `finishIntro` advances 1→2 → Level 1 Main Window briefing (restored `level.1.briefing`).

### Still open
- **Migrate the freighter backdrop** (§59) onto input-replay (optional, later).
- **itch:** the trace is bundled today; if the trace grows, consider fetching it from the CDN instead.
