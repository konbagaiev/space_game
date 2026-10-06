# Server-run bot brawl (`?brawl` over `?netsim`) + server load monitoring

> **Status: BRIEF, not started (2026-10-06).** Written to be executed by a fresh session (ideally through
> `/feature-pipeline`). Everything needed is in this file plus the documents it names; nothing depends on the
> conversation that produced it.

## Goal

Run the existing **bot brawl** load test (`?brawl`, N v N Sentinel bots over the home station) with the bots
**simulated by the server** instead of in the tab — the tab only renders what a server ROOM sends — and
**measure what that costs the server**: CPU per tick, event-loop health, memory and network bytes per
client. The question it answers for the roadmap: *can one server host a fight of ~200 ships, with some ships
flown by bots and some by people, and what does that cost per room and per client?* (Today's answer from
headless Node: the simulation is cheap — ~0.4 ms/tick average and ~1.3 ms/tick over the first 10 s at
100v100. Bandwidth and the per-client snapshot are the unknowns.)

Out of scope: client-side prediction, interest management / delta snapshots, binary encoding, human players
in the brawl. Measure first; those come after the numbers (see "Next" at the bottom).

## Read first

- `docs/SUMMARY.md` — "The bot brawl (`?brawl`)" (client brawl: `sim-core/brawl.js` `spawnBrawl`/
  `brawlTick`, `brawl-host.js`, `brawl-stats.js`, `brawl-dev.js`), the URL-flag table, and **"Playing in a
  server-run room (`?netsim=1`)"** (rooms, `room.js`, `driver.js`, `protocol.js`, `socket.js`, `health.js`,
  the handshake rule "a dev flag that changes the FIGHT has to reach the room").
- `docs/plans/2026-10-04-2001-bot-brawl-load-test.md` (the client brawl's brief) and
  `docs/plans/2026-10-06-brawl-perf-findings.md` (all measurements so far, client bottlenecks).
- `docs/plans/server-authoritative-sim.md` (merged 2026-08-21; the design of rooms) and DECISIONS §116,
  §127, §131-§136, §151 (browser ≠ Node bit-for-bit: never compare digests across engines), §157 (brawl).
- `server/src/netsim/health.js` — an event-loop-delay + load monitor that already exists; reuse it.

## Decisions (settled — do not re-ask)

1. **Flag:** `?brawl=N&netsim=1` (and a bare `?brawl&netsim=1` → setup panel, whose Start keeps `netsim=1`).
   The client forwards `brawl=N` on the handshake (`client/src/netsim.js wsUrl`, next to `ally`/`lancer`/
   `beam`); `socket.js` reads it and passes `brawl: n` to `createRoom` → `createSimWorld`. Without
   `netsim` the brawl stays exactly the local brawl of today.
2. **The room runs `brawlTick`, not `simTick`, when `world.brawl` exists** — the same routing `client/src/
   sim.js simTick` already does locally. `createSimWorld({ brawl })` applies `withBrawlRoom` to the level
   descriptor, `seedSim(BRAWL_SEED)`, `spawnBrawl(world, n)`, and the room arms it (`world.brawl.armed = true`)
   when the client's first input arrives, so the wall-clock 60 s starts when the tab is actually watching.
3. **The player is the spectator** exactly as locally (alive, parked `BRAWL_SPECTATOR_PARK` east, never
   stepped). The client's camera/view target logic (`brawl-host.js`) must work from the snapshot-built world
   (`netsim-world.js`), not from `world.brawl` fields the client no longer simulates.
4. **The snapshot gains a tiny `brawl` block**: `{ ticks, alive: [blue, red], killsByBlue, killsByRed,
   ended }` — the card's fingerprint and end rule read it instead of a local `world.brawl`.
5. **No economy, ever.** A brawl room never fires `onEconomy` (it has no `cleared`/`death`; assert it), sends
   no `/api/games`, records no session, and is never banked. Same guarantees as the local brawl (§157).
6. **Abuse guard on prod** (a URL anyone can type spins a 200-ship room): at most **2 concurrent brawl rooms per
   process** and `n ≤ BRAWL_N_MAX` (100); a third is refused with a protocol `error` the client shows on the
   setup panel. One constant in `socket.js`.
7. **Server metrics** (the point of the exercise), measured INSIDE the server process, per room, once per
   second:
   - `stepMs` — avg / p95 / max wall time of `room.stepOnce()` over the last second (`performance.now()`
     around the call in `driver.js`);
   - `ticks` — steps actually run that second (60 = keeping up; the driver's 6-step catch-up hides a slow
     room otherwise);
   - `snapBytes` — bytes of every JSON snapshot sent that second, and the largest one; `snapPerSec`;
   - `loopDelay` — p50 / p99 / max event-loop delay from `health.js`;
   - `cpu` — `process.cpuUsage()` delta → % of one core; `rssMB`, `heapMB`;
   - `rooms` — live rooms in the process, `brawlRooms`, `clients`.
   They travel in the snapshot as a `srv` block **once per second** (not every snapshot), so the client can:
   (a) show them on the brawl card as extra per-window columns (server step ms p95, KB/s down, loop delay),
   and (b) copy them into its own per-second `/api/perf` sample under `srv` — prod analysis then stays the one
   SQL table it is today. Also log one JSON line per room per 10 s on the server (`console.log`, it lands in
   the existing Loki/Grafana logging stack on the VPS) so a run can be read even if the tab dies.
8. **A headless capacity tool**, `server/tools/brawl-capacity.mjs`: create K brawl rooms in-process (no
   sockets), step them on one thread for 60 sim-s, and print per-room step ms (avg / p95 / max), snapshot
   bytes (by calling `takeSnapshot()` + `JSON.stringify` at the real cadence) and the implied **rooms per
   core**. Run it with N = 20, 50, 100 and K = 1, 2, 4, 8. It is the number the roadmap needs; the live test
   checks it against reality.
9. **Determinism check, same engine only:** a Node room's brawl fingerprint (alive per side every 10 sim-s)
   must equal `sim-core/brawl.js` run headless in Node for the same N and seed. Never compare it with a
   browser run (§151).

## Steps (anchors as of `main` @ 2026-10-06; re-grep before editing)

1. `server/src/sim-host.js createSimWorld` (`:110`) — accept `brawl = null` (N); when set: `catalog.level =
   withBrawlRoom(catalog.level)` (import from `client/src/sim-core/brawl.js`), and after `startRun(world)`:
   `seedSim(BRAWL_SEED); spawnBrawl(world, brawl)`. Mind the ordering comment at `:113-119` (duel replaces
   the phase script; brawl does too — make brawl and duel mutually exclusive, brawl wins, and say so).
2. `server/src/netsim/room.js` — `createRoom({ …, brawl })` (`:81`) passes it on; `stepOnce()` (`:212`)
   calls `brawlTick(world, SIM_DT)` when `world.brawl` else `simTick`; arm on first input; `takeSnapshot()`
   (`:241`) adds the `brawl` block (decision 4). Check `describe(kind, id, e)` covers an ace's look (`accent`,
   `pilot`) for `kind: 'enemy'` — the duel room never ran over netsim, so this path is untested.
3. `server/src/netsim/driver.js` — time `stepOnce()`, count ticks, accumulate per-second stats; attach `srv`
   (decision 7) to the first snapshot after each second boundary. Keep `room.js` clock-free (its tests drive
   it from a for-loop) — all timing lives in the driver.
4. `server/src/netsim/socket.js` — read `brawl` from the handshake (`:33-58`, next to `ally`/`lancer`/`beam`),
   enforce decision 6, measure `JSON.stringify(snap).length` in `send()` (`:189`) into the room's stats.
5. `server/src/netsim/protocol.js` — document the `brawl` and `srv` blocks; the event allowlist test must
   stay green (the `hit` event already carries `pos`, vec-serialized via `VEC_FIELDS`).
6. `client/src/netsim.js wsUrl` (`:95`) — forward `brawl`; `client/src/brawl-dev.js` — let `?netsim`
   compose with `?brawl` (today `?duel&netsim` is documented as NOT composing — brawl must, so add it to the
   URL-flag table with the rule). `brawl-host.js` Start preserves `netsim=1`.
7. `client/src/brawl-host.js` / `brawl-stats.js` — under netsim read alive/kills/ticks/ended from the
   snapshot's `brawl` block; add the server columns to the card and `srv` to the perf sample
   (`client/src/main.js` `finalizeBucket`, the `brawl` slice at `:673`).
8. `server/tools/brawl-capacity.mjs` (decision 8).

## Tests

- `server/src/netsim/room.test.js`: a brawl room (N = 5, seed `BRAWL_SEED`) stepped from a for-loop for 60
  sim-s gives the same fingerprint as `spawnBrawl`+`brawlTick` headless; 0 shared draws; `onEconomy` never
  called; the snapshot carries `brawl` and the `allies`/`enemies` rows for 2N ships.
- `server/src/netsim/socket.test.js`: `brawl=N` is read from the handshake and clamped; the third concurrent
  brawl room is refused.
- driver stats: a unit test with a fake clock (`now`/`setIntervalFn` are already injectable, `:21`) — `srv`
  appears once per second with plausible fields; `ticks` drops below 60 when `stepOnce` is made slow.
- Client: `brawl-dev.test.js` (flag composes with netsim), `brawl-stats.test.js` (card renders server columns).
- One visual scenario, `52-bot-brawl-netsim`, modelled on `client/visual/scenarios/37-netsim.mjs` /
  `41-enemy-beam-netsim.mjs`: N = 2 over a real local room; the card appears with server columns; no
  `/api/games`, `/api/sessions` or `/api/events` request. Run only it, `22-trace-replay` and `36-sim-divergence`
  — the full visual suite is opt-in (§141). Check `lsof -i :4173` first.

## Live test (after deploy)

1. Desktop and phone: `https://vega.tenony.com/?brawl=20&netsim=1`, then 50, then 100 (hard refresh first).
   Compare each card with the LOCAL brawl at the same N: the client should be *cheaper* (no sim), the server
   columns show what moved.
2. On the VPS (`ssh root@178.104.91.144 -i ~/.ssh/do_cs`): `docker stats` on the app container during a 100v100
   run; the room's JSON log lines.
3. `node server/tools/brawl-capacity.mjs` locally and (if allowed) on the VPS; report rooms-per-core.
4. Report a table: N × (server step ms avg/p95, ticks/s, KB/s per client, loop delay, CPU %), and the
   capacity estimate.

## Docs to update

- SUMMARY: the bot brawl section (netsim mode), "Playing in a server-run room" (brawl rooms, `srv`, metrics,
  the concurrency cap), the URL-flag table, the `perf_samples` query (the `srv` field), tests list.
- CHANGELOG (today's date), DECISIONS: one entry for "server metrics ride the snapshot + perf_samples, not a
  new endpoint" and the brawl-room cap. Recheck the § number at merge.

## Next (not this brief)

Snapshot size will likely dominate (every bullet is a row in every snapshot, 30 snapshots/s, JSON). With the
numbers in hand: projectiles as fire/hit events instead of rows, ship deltas + interest management, a compact
binary encoding, then humans in the brawl (prediction, lag compensation — `server-authoritative-sim.md` Slice
E). Target to aim for: ≤ 30-50 KB/s per client in a 200-ship fight.
