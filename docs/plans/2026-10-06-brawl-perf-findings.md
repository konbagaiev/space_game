# Bot brawl — performance findings and what was optimized (2026-10-04 … 2026-10-06)

> **What this is.** A record of the measurement work done with the `?brawl` load test (brief:
> `2026-10-04-2001-bot-brawl-load-test.md`): what was measured, on which devices, what the bottlenecks
> turned out to be, what was fixed, and what is still open. The individual changes are in `CHANGELOG.md`
> (2026-10-04 … 2026-10-06) and `DECISIONS.md` §156–§160; this file is the one place that ties the numbers
> together, so the next performance session starts from them instead of re-measuring.

## 1. The instrument

- `?brawl` (setup panel) / `?brawl=N&tier=T` — N v N Sentinel bots (1-100) fight over the home station for
  60 s of wall time; the player only watches. Deterministic (`BRAWL_SEED`), same JS engine → same fight.
- The result card + `perf_samples` (`kind:'brawl-result'` and per-second `scene:'brawl'` rows) in prod
  Postgres carry per-10-s windows (avg / p95 / worst frame, alive per side, ships in frame), the tier,
  the build, the device passport, JS update/render/dom split, draw calls, triangles, long tasks, heap,
  live shader programs. Query recipe: SUMMARY → "`?dev` perf monitor".
- Ad-hoc tools used (scratch, not committed): Playwright + CDP `Profiler` (CPU profile),
  `HeapProfiler.startSampling` with `includeObjectsCollectedByMajorGC/MinorGC` (allocation profile),
  a `renderBufferDirect` wrapper (draw calls by object), a `material.version` setter trap (who forces
  three.js to re-resolve a program), `onAfterRender` hooks (program flips per shared material), and a
  runtime A/B toggle + frozen-frame screenshot diff (PIL) for visual equivalence. All are a few dozen lines;
  rebuild them from this description when needed.

## 2. Limits measured (prod build, 2026-10-05)

| device | tier | N per side | full-load window (0-10 s) | after |
|---|---|---|---|---|
| MacBook M1 Pro, Chrome 154, 100 Hz screen | high | 50 | ~100 fps (10 ms), render CPU ~5 ms after §159 | 100 fps |
| MacBook M1 Pro | high | 100 | avg 13 ms, p95 18-24 ms, peak ~50-75 fps | 100 fps from ~8 s |
| Android, Adreno 750 (flagship), 60 Hz | balance | 50 | 60 fps except the start freeze | 60 fps |
| Android, Adreno 750 | balance / high | 100 | avg 17.5-18 ms, p95 21-23 ms (~55 fps) | 60 fps from ~7 s |

- The peak is **CPU-bound on the main thread**, not GPU-bound: frame time ≈ JS time; at 100v100 peak
  ~3300 draw calls/frame, `renderer.render` CPU 13-15 ms, sim 2-4.5 ms.
- **Headless sim cost** (Node, no rendering): 100v100 ≈ 0.4 ms/tick average, ~1.3 ms/tick over the first
  10 s, worst 4-7 ms (GC). Server-side simulation of 200 ships is cheap.
- The phone *feels* smoother than the M1 at the same load because a 60 Hz budget is 16.7 ms and the M1's
  100 Hz budget is 10 ms — a 20 ms frame on the M1 drops 2-3 refreshes.
- **Measurement hygiene:** an M1 with 20 GB of swap and `kernel_task` at ~200 % CPU (11 days uptime, a 5 GB
  Chrome tab, a VM) produced isolated 70-380 ms freezes that were GC waiting on page-ins, not the game.
  Check `sysctl vm.swapusage` / `uptime` before trusting a Mac run (see also memory: playtest load).

## 3. What was found and fixed

| # | finding | evidence | fix | effect |
|---|---|---|---|---|
| 1 | Pilot reload stagger belonged to the SIDE, so duel aces fired ~30 % less than the identical wingman; red always lost | prototype fingerprints | pilot owns it (`SENTINEL_PILOT`, private stream) — §156 | symmetric fights; wingman cadence −29 % |
| 2 | Bots circled the station (escort of a still point = stable orbit 75-93 u out) | headless trace | engage range 150 u from self; still anchor = arrive and stop; cornered pilots fight — §158 | stops at 10 u, v = 0 |
| 3 | "Blue always wins" | 150 seeds: 76:72 | not a bug — one fixed seed = one fight; at N = 30/40 red wins | documented |
| 4 | Canopy glass (transparent + DoubleSide) drawn in 2 passes with `needsUpdate` before each → `getProgram`/`getParameters` per ship per frame | version trap: ~10 000 bumps / 2 s at 50v50 | `forceSinglePass` on DoubleSide ship materials, all tiers — §159 | render CPU at full load 7.1 → 5.2 ms (−27 %); 0 px changed at gameplay zoom |
| 5 | Every hit/detonation/death in the arena played a sound (529 voices in 7 s at 100v100) | AudioNode `start` counter | earshot gate: on screen + 0.15 NDC — §160 | off-screen battle silent (16/17 dropped when following one bot) |
| 6 | Starfield specks showed through the see-through radar and read as contacts | screenshot | opaque radar | — |
| 7 | 91 ms "worst frame" in the last window | long task at 59.8 s | (open) it is the result card being built, not the fight | — |

## 4. Still open, ranked by payoff

1. **Draw calls per ship — the main limit.** The player hull (`player_combat` glb) is **14 meshes / 14
   materials** → 14 draws per ship; 77 % of the 3300 draws at the 100v100 peak. Options: (a) join/palette the
   untextured parts in the asset pipeline (`docs/plans/ship-model-pipeline.md`; ask about `CREDITS.md`),
   maybe 14 → 4-6; (b) `InstancedMesh` per ship type (14 draws for ALL ships of a type) — biggest win, but
   hit flash, accent repaint, warp-in scale and per-ship exhaust must move to instance attributes.
2. **Garbage: ~148 MB/s at the 100v100 peak** (allocation profile, sim 1-10 s). ~48 % is three.js render
   internals (uniform caches, `getParameters`, cache-key strings) — it scales with draws and with NEW
   materials; ~13 % collision (`pointHitsShip`/`segmentHitsShip` — scratch arrays already reused, so likely
   boxed doubles; investigate before editing), ~8 % `stepBullets`/`stepRockets` (`pos.clone()` per event and
   per smoke puff, `clone().sub()` in homing), ~7 % the pilot (`pick` closure per call, `new Vec3` per ship
   per tick). Major GC pauses of 50-70 ms every ~15-20 s follow from it.
3. **A new material per projectile.** `bolt-fx.js:124` (tracers), `projectiles.js:62` (capsules),
   `projectiles.js:307` (rockets) each `new THREE.MeshBasicMaterial` per spawn (~1300 new materials in 4 s
   at 50v50): every one runs `getProgram` on first draw and becomes garbage. Cache by (colour, texture,
   brightness). Cheap, no visual change.
4. **Projectiles as instanced meshes** (tracers ~215 draws + plumes/rocket FX ~500 at the peak).
5. **Brawl start freeze** — 250 ms desktop / 440 ms phone: the Sentinel/ace hull programs compile after the
   veil. Warm the brawl's hulls before arming.
6. **Measurement artefact** — stop the per-frame sampler before building the result card (#7 above).

## 6. Server-run brawl (`?netbrawl`) — what it costs the server (prod, 2026-10-07)

Built by `docs/plans/2026-10-06-1530-server-brawl.md` (DECISIONS §161). The same N v N fight, simulated by a
netsim room on the prod VPS (AMD EPYC-Rome, 4 vCPU, node 23, container `mem_limit 1g`); the tab only renders.
Numbers are the room's own `srv` block (per wall second, one client per room) from `perf_samples`, plus the
`evt: 'netsim-room'` log lines.

| N | client | step avg / p95, whole run | step avg / p95, peak second | ticks/s (min) | KB/s per client avg / peak | event loop p99 max | CPU % of a core avg / peak |
|---|---|---|---|---|---|---|---|
| 20 | M1 Chrome | 0.17 / 1.04 ms | 0.69 / 1.04 ms | 59 | 66 / 426 | 1.7 ms | 3.6 / 12 |
| 50 | headless only (VPS) | 0.08 / 0.49 ms | 0.36 / 0.80 ms (first 10 s) | — | 158 / 526 (first 10 s) | — | — |
| 100 | M1 Chrome | 0.73 / 7.0 ms | 4.55 / 7.0 ms | 59 | 355 / 1807 | 9.6 ms | 8.2 / 38 |
| 100 | Adreno 750 phone | 0.85 / 10.15 ms | 6.32 / 10.15 ms | 59 | 357 / 1851 | 11.6 ms | 11.3 / 77 |

- **The server keeps up.** `behind = 0` in every run, 59-61 ticks/s, socket send buffer always 0, RSS ≤ 144 MB.
- **The client got cheaper.** 100v100 over the network: the phone held 59.9 fps (p95 18.6 ms), the M1 ~98 fps —
  compare §2, where the same fight simulated in the tab was the limit.
- **The fight is front-loaded.** The peak is sim-seconds 3-8 (~70-90 alive a side); by 20 s ~25 a side are left,
  so the 60 s average is 5-10× below the peak.
- **Headless under-reports the live peak by ~3-5×.** `brawl-capacity.mjs` on the same VPS gives N = 100 first
  10 s at 1.11 / 2.83 ms per step; the live room peaked at 4.5-6.3 ms avg. Not investigated (candidates: a cold
  JIT in the process's first big room, WebSocket framing, a shared vCPU). Plan with the live figures.

Headless `node server/tools/brawl-capacity.mjs --n 20,50,100 --k 1,2` on the VPS (first 10 sim-s, K = 1):
N = 20 → 19.6 ms of process time per wall second per room (50 rooms/core avg, 18 p95); N = 50 → 26.1 ms
(38 / 18); N = 100 → 75.4 ms (13 / 5). The M1 is ~2× faster than the VPS on the same tool.

**Rooms per core (from the live numbers):**

| N | started together (peak) | staggered starts (60 s average) |
|---|---|---|
| 20 | ~8 | ~25 |
| 50 | ~4-5 (headless peak × 4) | ~12-15 |
| 100 | **1-2** | ~9-12 |

So the 4-vCPU box carries ~4-8 simultaneous 100v100 rooms; the 2-brawl-rooms-per-process cap is far inside it.

**The real limit is bandwidth, not CPU.** 100v100 sends 355 KB/s per client on average and **1.8 MB/s at the
peak** (snapshots up to 66 KB, 30/s, JSON, every projectile a row) — 7-60× the 30-50 KB/s target. Next, in this
order (the brief's "Next"): projectiles as fire/hit events instead of rows, ship deltas + interest management,
a compact binary encoding — then humans in the brawl. A general netsim reconnect is briefed separately in
`docs/plans/2026-10-06-netsim-reconnect.md`.

## 5. Where the numbers came from

Prod sessions (`perf_samples`), 2026-10-05: M1 `b91b0c71…` (50v50), `f055cd78…`, `4b82d216…`, `5b0cb0d1…`,
`2cb5a541…`, `3e68c5c0…` (100v100); Adreno 750 `99f84a0e…` (50v50), `72b221ae…`, `3e8de69b…`, `6fad0d49…`
(100v100). Local profiles: M1 Pro, Chrome via Playwright `--use-angle=metal`, `?debug&brawl=N&tier=high`.
Server-run brawl (§6), prod 2026-10-07, build `4ed714e`: phone 100v100 player `7da9b345…`, M1 20v20 and
100v100 player `cbbbc5ce…` (`perf_samples` with `srv`, `kind: 'brawl-result'` with `server: true`); headless
`brawl-capacity.mjs` run inside the app container.
