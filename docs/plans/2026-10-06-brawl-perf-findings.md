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

## 5. Where the numbers came from

Prod sessions (`perf_samples`), 2026-10-05: M1 `b91b0c71…` (50v50), `f055cd78…`, `4b82d216…`, `5b0cb0d1…`,
`2cb5a541…`, `3e68c5c0…` (100v100); Adreno 750 `99f84a0e…` (50v50), `72b221ae…`, `3e8de69b…`, `6fad0d49…`
(100v100). Local profiles: M1 Pro, Chrome via Playwright `--use-angle=metal`, `?debug&brawl=N&tier=high`.
