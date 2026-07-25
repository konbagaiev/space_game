# Multiplayer — architecture brief (high level)

> **Status:** research + high-level plan only. **Nothing is built.** No decision is final — the
> "Open decisions" section lists what must be answered before Phase 1 starts. Supersedes nothing;
> expands `docs/ROADMAP.md` **Phase 5 — Multiplayer** and its "Netcode notes" with a concrete,
> sequenced path derived from an audit of the code as it exists on 2026-07-25.
>
> Read first: `docs/ROADMAP.md` Phase 5 (the parked netcode notes are still valid and are folded in
> below), `docs/DECISIONS.md` §16 (pause must be reworked for MP), §30 (keep processes simple),
> §45 (why `collision.js` is deliberately THREE-free).

## Goal

**Co-op PvE first**: 2–4 players fly one mission instance together, on a **server-authoritative**
simulation (clients send inputs, render state). PvP is explicitly out of scope for this plan — it
changes the transport requirements (see "Why PvP is not in this plan").

---

## 1. Where the code stands today (the audit)

### 1.1 What we already have that helps — more than expected

| Asset | Where | Why it matters for MP |
|---|---|---|
| **The mission script already lives on the server** | `server/src/missions.js`, `server/src/catalog_seed.js`, `GET /api/levels/:name`, `GET /api/maps/:name` | Phases, spawn pools, `maxConcurrent`, `total`, `enemyTotal` are **already server data**. The server does not need to learn what a level is — it already defines it. |
| **The whole catalog is DB-driven** | `server/src/db.js`, `/api/ships|weapons|components|sounds` | Ship/weapon/component stats needed to *simulate* are already in Postgres, server-side. No duplication needed. |
| **Deterministic input-replay already exists** | `client/src/replay.js`, `?record` / `?playback`, `main.js` fixed-step accumulator | This is **exactly the client→server input channel MP needs**: one input snapshot per fixed tick (`{k,t}`), a seeded PRNG isolated to the sim, and a fixed timestep (`BENCH_DT`) already proven to reproduce a fight bit-for-bit. The game can already be driven purely by an input stream. |
| **A remote-entity renderer prototype** | `client/src/ghost-battle.js` + `backdrop-battle.js` | Already interpolates a transform stream for ships it does not simulate. ROADMAP already schedules its convergence with the MP remote-entity path. |
| **Pure, THREE-free logic modules** | `components.js`, `steering.js`, `spawn-timing.js`, `collision.js`, `level-sim.js`, `autopilot-config.js`, `drops-config.js`, `replay.js` | These run under `node --test` today (DECISIONS §45). They are the seed of the shared sim package — roughly the *rules* of the game are already portable; the *loop* is not. |
| **Auth with a bearer token** | `server/src/auth.js`, dual cookie/`Authorization: Bearer` | The WebSocket handshake can reuse the existing session token — no second auth system. |
| **A headless-sim regression suite** | `level-sim.js` + `level-sim.test.js`, `?bench` replay, the Level-0 intro trace | The riskiest phase (Phase 1) has a ready-made oracle: after the refactor the recorded intro must still win and reach the L1 briefing (see the "sim change → re-run replay/intro" rule). |

### 1.2 What actually blocks a server-side sim

**(a) Sim state is stored inside Three.js objects.** There is no separate transform state:

- position is `entity.mesh.position` (`sim.js:428`, `:503`, `ship-build.js:117`)
- orientation is `entity.mesh.rotation.y` (`sim.js:463`, `:504`)
- velocity is a `THREE.Vector3` (`ship-build.js:46`, `:94`)
- the **warp-in animation is gameplay state** — `mesh.scale` drives `e.warping` (invulnerable /
  can't fire / not homing-targetable), `sim.js:479-485`
- `collision.js` is THREE-free but reads `mesh.matrixWorld.elements` — it needs *a* matrix, i.e. an
  entity transform, not necessarily THREE

→ Nothing can run without a WebGL scene graph. **This is the single biggest cost of the whole project.**

**(b) `sim.js update()` mixes four concerns.** It is 898 lines that simulate *and* play audio
(`audio`, `sfxFor`), spawn FX (`spawnExplosion`, `spawnShieldHit`, `emitExhaust`), write DOM
(`el.overlayTitle`, `el.overlaySub`, i18n `t()`), and call the backend (`bankRun`, `depositLoot`,
`unlockNextLevel`, `track`) — see `levelRunner.win()` at `sim.js:119`. The server needs the first
concern only.

**(c) The world is a module-level singleton.** `client/src/state.js` exports `G`, `enemies`,
`bullets`, `rockets`, `drops`, and ~8 FX pools as shared-by-reference module constants — deliberately
(the header documents the pattern). One Node process can therefore host **exactly one world**. ROADMAP
already flags this as the reason a second concurrent sim was rejected.

**(d) Economy and progression are client-authoritative.** The client tells the server what it earned:
`POST /api/games {credits, kills}` (`net.js bankRun`), `POST /api/players/:id/loot`,
`POST /api/players/:id/advance`. `server/src/missions.js` already calls server-sealed rewards "a later
integrity item". In single-player this is a shrug; the moment two accounts share an economy, one
player's fabricated payout is everyone's problem.

**(e) Pause is a client-side freeze** (`G.paused`, `sim.js setPaused`) — DECISIONS §16 already states
this does not survive MP.

**(f) The deploy topology drops live connections.** One container serves static + `/api`; CI does a
`docker rollout` blue-green swap. HTTP requests survive that; **open WebSockets and in-flight rooms do
not**.

---

## 2. The shape of the target

```
                       ┌─────────────────────────── server (Node) ────────────────────────────┐
  browser client        │  room manager                                                        │
  ┌───────────────┐     │   ├─ Room "sortie-42": World { players[], enemies[], bullets[], … }  │
  │ input sampler │────▶│   │    fixed 30 Hz loop  →  simCore.update(dt)   (SHARED CODE)       │
  │ (replay.js    │ ws  │   │    ├─ owns spawning, AI, hits, HP, drops, phase advance          │
  │  format)      │     │   │    └─ emits events (fire/kill/hit/spawn/phase/win)               │
  ├───────────────┤     │   └─ Room "sortie-43": …                                             │
  │ prediction    │◀────│  snapshot @ 15–20 Hz (ships only, quantized) + event stream           │
  │ + reconcile   │     │  economy/progression sealed here (never trusts the client)            │
  ├───────────────┤     └──────────────────────────────────────────────────────────────────────┘
  │ remote-entity │
  │  interpolator │  ← the generalized ghost-battle.js
  ├───────────────┤
  │ renderer/FX/  │  ← everything that is currently tangled INTO sim.js
  │  audio/HUD    │
  └───────────────┘
```

Two rules define the whole design:

1. **`shared/sim/` is the only code that decides anything.** It runs identically in the browser (for
   prediction) and in Node (as the authority). It imports no `three`, no DOM, no `fetch`, no audio.
2. **The client renders and predicts; it never asserts.** It may *show* a hit instantly, but the
   server's verdict overwrites it.

### Protocol sketch (deliberately close to what already exists)

- **client → server**, every sim tick: `{ tick, keys }` — the `replay.js` input snapshot, unchanged in
  shape, plus the last server tick acknowledged.
- **server → client**, 15–20 Hz: ship transforms only (pos/heading/vel/HP/flags), quantized; plus an
  event list (`fire`, `hit`, `kill`, `spawn`, `drop`, `phase`, `banner`, `win`).
- **Bullets are never streamed.** A `fire` event carries muzzle + direction + weapon id + tick; both
  sides simulate the flight deterministically. The *server* also simulates them and decides hits. This
  is already the parked ROADMAP decision and it is the right one — machine-gun fire at 30 Hz in JSON
  would dominate bandwidth.
- Start with **JSON at 15 Hz for 2–4 ships** and measure before reaching for binary/delta encoding.
  4 ships × ~10 floats × 15 Hz is a few KB/s — premature encoding work is exactly the kind of
  pre-building for scale DECISIONS §30 warns against.

---

## 3. Phased plan

Each phase is independently shippable and has value even if the next one never happens. Phases 1–2 are
**single-player work**: they land on `main`, improve testability and close the economy hole, and carry
no netcode risk.

### Phase 0 — Feel-check spike (throwaway, ~1–2 days, own branch, never merged)

Before paying for Phase 1, find out whether flying co-op is *fun* and whether latency to the Hetzner VPS
feels acceptable. Cheapest possible version: add `ws` to the server, have each client broadcast its own
transform at 15 Hz, and render other players with the existing `ghost-battle.js` interpolator. Fully
client-authoritative, cheatable, no shared enemies — a **toy**.

- **Explicitly disposable.** Branch, playtest, write findings into this file, delete. Its only outputs
  are: does co-op feel good, what is the real RTT, does interpolation at 15 Hz look right.
- Rationale: "visual/feel features churn the pipeline — get a playable build in the maintainer's hands
  EARLY" applies double to netcode feel. It is much cheaper to learn this now than after Phase 1.
- **Risk to manage:** do not let the toy grow. If it starts accreting features it becomes the
  architecture, and it is a dead end (no authority, no anti-cheat, no shared enemies).

### Phase 1 — Decouple the sim from Three.js, the DOM, audio and the network *(the real cost)*

Still 100% single-player. Nothing user-visible should change.

1. **Give entities their own transform.** Add `pos`, `vel`, `heading` as plain structs on the entity
   (`ship-build.js` `buildPlayer` / `spawnEnemyShip`) and make the sim read/write only those. Add a
   one-directional `syncMeshes()` in the render step that copies state → `mesh.position` /
   `mesh.rotation.y` / `mesh.scale`. Introduce a tiny vec2/vec3 helper (~50 lines) so `shared/sim/` has
   no `three` import. Same for bullets, rockets, drops, and the FX pools that the sim currently ages.
2. **Move the gameplay meaning out of the animation.** `warping` / `spawnAge` / `spawnDur` become sim
   fields; `mesh.scale` becomes a pure render consequence.
3. **Split `sim.js`.** `shared/sim/` gets the loop, the AI, `levelRunner`, collision resolution, damage,
   drops. The client keeps a thin `sim-view.js` that consumes an **event queue** the sim emits
   (`{type:'kill', entityId, pos, reward}` → explosion + SFX + event-log line + credit popup). Every
   `audio.*`, `spawn*FX`, `el.*`, `t()`, and `net.js` call leaves the sim. `levelRunner.win()`
   (`sim.js:119`) becomes: emit `win`; the client shows the overlay, the server seals the reward.
4. **Make the fixed timestep the only loop.** The accumulator already exists for `?bench`/`?record`
   (`main.js:592`); promote it to the normal path — sim at a fixed 30 Hz, render interpolating between
   the last two sim states.
5. **Move the pure modules into `shared/sim/`** (`components.js`, `steering.js`, `spawn-timing.js`,
   `collision.js`, `spawn`/`drops` config, `level-sim.js`) so both `client/` and `server/` import one copy.
   `collision.js` swaps `mesh.matrixWorld.elements` for a matrix built from the entity transform.

**Acceptance gate (non-negotiable):** the recorded Level-0 intro trace still wins and lands on the L1
briefing, `?playback` replays reproduce, `?bench` shows no >2% CPU regression, and the visual suite is
no worse than its flaky baseline. This is a large refactor of the most load-bearing file in the game —
without that oracle it should not be attempted.

**Deliberately NOT in Phase 1: instancing the world.** `state.js`'s module-level singletons stay. See
Phase 3 for why that is affordable.

### Phase 2 — Run the same sim headless in Node (still single-player)

1. A `sim:headless` script runs a full level to completion in Node using `shared/sim/`, driven by a
   recorded input trace, and prints kills / credits / outcome.
2. **Assert client and server agree** on the same trace — this is the proof Phase 1 succeeded, and it
   becomes a CI test.
3. **Cash the first dividend: close the economy hole (e).** The client submits its recorded input trace
   with the run; the server re-simulates it and **seals** credits, kills and loot instead of trusting
   `POST /api/games`. Valuable on its own, before any MP exists, and it converts the server-authoritative
   sim from "future MP infrastructure" into shipped anti-cheat.
   - Cost to weigh: re-simming every run costs CPU and grows the request payload; an alternative is
     plausibility bounds (max credits per level) — cheaper, weaker. Decide when we get there.

### Phase 3 — Transport + rooms

1. Add `ws` to `server/` (first new runtime dep since `pg`). Upgrade at `/ws`, authenticated with the
   existing session bearer token (`server/src/auth.js`); check `Origin` (the itch build connects
   cross-origin to `wss://vega.tenony.com/ws`, so it must be allowed the way `/api` CORS already allows it).
2. **Room manager**: create / join / leave a sortie, 2–4 players, a room = one `World` + one 30 Hz loop.
3. **World instancing, the cheap way.** Because `state.js` is a singleton, the honest options are:
   - **(recommended) one room per worker process** — `child_process`/`worker_threads`, the parent owns
     the sockets and routes frames. Zero refactor of `state.js`, a crashing room can't take the API down,
     and at this game's scale (tens of concurrent players on one VPS) the per-process overhead is
     irrelevant. Fits DECISIONS §30.
   - **(deferred) thread a `World` context through the sim** — the "correct" version, a second large
     refactor. Do it only when room count actually makes processes hurt.
4. **Lobby UI**: the Main Window "Missions" list is the natural home. Start with the *side-mission* board
   (see §4.3 — it dodges the whole progression question).

### Phase 4 — Client-side prediction, reconciliation, remote entities

1. **Remote ships**: generalize `ghost-battle.js` into `remote-entities.js` fed by the server snapshot
   stream, with a ~100 ms interpolation buffer. The backdrop ghost battle becomes a consumer of the same
   path (already ROADMAP'd), so the two do not diverge.
2. **The local ship** predicts: apply input immediately, keep an input buffer, and on each server
   snapshot rewind + re-simulate the un-acked ticks. The replay infrastructure means the client can
   already re-run the sim from a state + input list — this is that mechanism, applied per frame.
3. **Bullets**: spawn locally on the local player's own fire for feel; remote fire spawns on the `fire`
   event; the server's `hit`/`kill` events are the truth (a locally-predicted hit that the server
   rejects simply doesn't produce damage).
4. **Note:** cross-machine float determinism is *not* required — server authority + reconciliation
   corrects drift. Do not build lockstep.

### Phase 5 — Game rules that only exist in MP (design work, not plumbing)

These are decisions, and every one of them changes the code. They must be answered before Phase 3 ships:

- **Pause** (DECISIONS §16): in a room there is no freeze. Solo keeps the current pause; MP gets, at
  most, a personal menu that leaves the ship flying (and vulnerable).
- **Loot & credit attribution**: per-player instanced drops (everyone sees their own chest, no race) vs
  a shared pool (social, but a griefing/fairness surface). Kill credit: last hit, or shared per-kill?
- **Victory / return-to-base**: does everyone have to dock, or the first one, or a majority? Current
  `checkArrival` (`sim.js:110`) assumes exactly one player.
- **Difficulty scaling**: `maxConcurrent` / `total` per phase are already server data — scaling them by
  player count is a data change, not code. Cheap, and worth doing from day one.
- **Disconnect / AFK**: despawn the ship, or leave it drifting? What happens to a room when everybody
  leaves mid-mission? Reconnect into a running room?
- **Progression**: does a co-op clear advance `current_progress` for all participants?

### Phase 6 — Ops

- **Blue-green kills rooms** (blocker (f)): the deploy currently swaps containers, dropping every
  socket. Minimum viable answer: client auto-reconnects into its room by id, plus a drain window that
  refuses new rooms and waits for in-flight ones. Otherwise every deploy hard-kills live sorties.
- **Sticky routing** is a non-issue while there is one container — note it as the condition that
  forces a real answer (Redis/room registry) if the VPS ever scales out.
- **Monitoring**: room count, per-tick sim time, snapshot bytes/s, dropped clients. `server/src/instrument.js`
  (Sentry) exists; the perf-sample table pattern (`/api/perf`) is a ready template.

---

## 4. Open decisions (answer before Phase 1 starts)

1. **Co-op only, PvP never/later?** This plan assumes co-op. It changes nothing structurally if PvP is
   added later *except* transport (see below), so "co-op now, decide PvP after feedback" is safe.
2. **Do we take Phase 0 (the throwaway spike)?** Recommended yes — it is the cheapest way to learn
   whether the whole idea is fun before spending the Phase 1 budget.
3. **Which mission type goes co-op first?** **Recommended: the side-mission board.** Side missions are
   already repeatable, already server-generated (`server/src/missions.js`), and deliberately do **not**
   advance `current_progress` — so co-op ships without answering a single progression question. The
   campaign can follow once the rules in Phase 5 are settled.
4. **Phase 2's server-sealed economy — full re-sim, or plausibility bounds?** Re-sim is exact and reuses
   the work; bounds are ~10% of the effort and catch only crude cheating.
5. **Rooms as processes or as an instanced `World`?** Recommended processes first (§3, Phase 3.3).

## Why PvP is not in this plan

Competitive PvP wants 30–60 Hz and UDP; the browser's ceiling is WebSocket (TCP, head-of-line blocking)
or WebRTC data channels. That is the actual argument for reconsidering Godot + a native client
(ROADMAP Phase 5, DECISIONS §1) — and it is a re-platforming decision, not a feature. Co-op at 15–20 Hz
over WebSocket with interpolation is comfortably within what a browser client does well, so co-op and
PvP are genuinely different projects. Deciding co-op does not commit us to PvP.

## Cost honesty

**Phase 1 is the project.** Detangling `sim.js` + `state.js` + `ship-build.js` from Three.js is weeks of
careful work on the most load-bearing code in the game, with a real regression surface (the intro
cutscene, every recorded replay, the perf benchmark, the visual suite). The netcode itself — transport,
rooms, snapshots, interpolation — is comparatively small and well-trodden.

The consolation: Phase 1 and Phase 2 are worth doing **on their own merits** even if multiplayer is
never shipped. A sim that runs headless in Node is testable, benchmarkable, replayable and cheat-proof
in ways the current one can never be.

## Docs to update when this is picked up

- `docs/ROADMAP.md` Phase 5 — point at this brief instead of restating the netcode notes.
- `docs/DECISIONS.md` — a new entry per decision as it is actually made (co-op-vs-PvP scope; rooms as
  processes vs instanced world; sealed economy method). §16 (pause) gets revisited at Phase 5.
- `docs/SUMMARY.md` — only once something is built.
