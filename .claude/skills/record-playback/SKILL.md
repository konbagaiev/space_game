---
name: record-playback
description: Record a fight and replay it on the real game engine via deterministic input-replay — start the local server, guide the maintainer to record a level via /?record=1&level={id}, then play it back via /?playback&id={id}. A recording captures the player's INPUT + the RNG seed (not positions), so playback re-runs the actual sim with real bullet colors, physics, FX and collisions. Use whenever the maintainer wants to record a level playthrough for later replay, "record a fight / a level and play it back", capture a run for a cutscene / alt-angle view / video, or debug the record/playback mechanism. This is the foundation the Level-0 intro cutscene sits on. Spec: docs/plans/2026-07-09-replay-record.md (DECISIONS §62).
---

# Record & play back a fight (input-replay)

Capture a live-played fight as **input + RNG seed**, then replay it by **re-running the real `sim`** — so the
replay has real projectile colors (blue player / red enemy), smooth physics, real FX and real collisions.
This is NOT the transform "movie of positions" (that's the backdrop, `/record-backdrop-clip`, DECISIONS §59);
it is a whole-level, engine-accurate replay (DECISIONS §62).

**What a recording is:** `{ seed, dt, shipId, level, ticks:[{k,t}] }` — one input snapshot per sim tick, plus
the seed. Nothing else (the sim is deterministic from the seed). Consumers: the Level-0 cutscene (built on
top), alt-angle views, video capture.

## The one thing to keep straight

The seeded `Math.random` must feed the **sim only**. Record and playback run the sim at a fixed step but at
different frame rates (frames ≠ ticks), so if any cosmetic per-frame code (stars/FX/HUD/idle frames/audio)
drew from the seeded stream, the run would desync. The code already isolates this (`withSimRand` around
`update()`/`reset()` in `main.js`; `audio.js` uses its own PRNG). **Don't route sim RNG through cosmetic code
or vice-versa** — verify with the state-hash check below after any change to the record/playback path.

## Steps

### 1. Start the local server
Use the **run-local** skill (pull the gitignored assets first, then serve on `localhost:4000`). From this
worktree: `npm run assets:pull` → `cd server && PORT=4000 node src/server.js`.
(In a fresh git worktree, symlink `node_modules` + `server/node_modules` from the main checkout, or `npm i`.)

### 2. Record (maintainer plays)
Open **`http://localhost:4000/?record=1&level=1`** (hard-refresh). `level=1` = the intro four-ship level
(seed name `level-1`); a bare number `N` maps to `level-N`, or pass a full name.
- The level loads with the **real ship idle**. A top bar shows **"Loading model…"** → it flips to **"Start
  recording"** once the ship `.glb` has loaded. **Wait for that**, then click **Start recording**.
- Fly and fight the level. The bar shows a live tick counter.
- Click **Stop & Save**. The trace is cached in `localStorage` (`replay:{id}` + `replay:last`) and downloaded
  as `{id}.json`; the bar shows the `id` and a **Play it ▶** link. `id = '{level}-{seed base36}'`.

### 3. Play back
Click **Play it ▶**, or open **`http://localhost:4000/?playback&id={id}`** (or just `?playback` for the last
recording). It re-sims the recorded fight on the real engine (holds the idle frame until the model loads,
then plays at real-time speed). Top bar: `tick / total` + Restart. Confirm it looks faithful (blue/red
bullets, smooth motion, real hits).

### 4. (Optional) Verify determinism after a code change
In the browser console on the record page: `__replay.begin()` then `__replay.step(360)` then note
`__replay.hash()`, `__replay.stop()`. Open the playback page for that id, `__replay.step(400)` past the end,
and confirm `__replay.hash()` **equals** the record hash. Equal = bit-for-bit reproduction. (`step(n)` runs
the sim synchronously, bypassing rAF — also how a background/hidden tab, which throttles rAF, can be driven.)

## Storage

Traces live in `localStorage` + a `{id}.json` download today (the same-browser dev loop). The intended
canonical store is an **S3 asset** (like ship `.glb`s — off git, synced prod↔local via `assets:pull`,
referenced from seed on prod); `loadTrace` already falls back to `/recordings/{id}.json`. Wiring the S3
push/pull is a pending step (see the spec).

**Testing caveat — don't clobber the maintainer's recordings.** The `localStorage` store is per-browser, and
Claude's `claude-in-chrome` automation drives the maintainer's REAL Chrome. So automated test recordings
write to the same `replay:last` / `replay:{id}` and can **overwrite the maintainer's own recording** — then
`?playback&cutscene=1` (no id → plays `replay:last`) shows the test clip and looks broken. When testing via
automation: use throwaway ids, list existing `replay:*` keys first, and **clean up afterward** (remove the
keys you created, restore `replay:last` to the maintainer's recording). This bit us once (2026-07-10).

## Files / reference

- `client/src/replay.js` — pure core (trace shape, URL parsing, snapshot/apply/validate; `replay.test.js`).
- `client/src/main.js` — engine wiring (accumulator pacing, seeded-RNG isolation, record/playback UI,
  `window.__replay`).
- `client/src/audio.js` — cosmetic RNG decoupled (`arand`).
- Spec + rationale: `docs/plans/2026-07-09-replay-record.md`, DECISIONS §62. Tests: `cd client && node --test`.
