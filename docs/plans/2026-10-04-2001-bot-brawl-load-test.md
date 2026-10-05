# Bot brawl (`?brawl`): an N-vs-N Sentinel load test you can run on a phone, plus the pilot owning its own reload stagger

**Status:** planned (2026-10-04), revision 2. Feature id `2026-10-04-2001-bot-brawl-load-test`.

## Goal

This change has two parts, built in this order.

**Part A — the pilot owns its mistakes.** This is a gameplay change the maintainer asked for. Today the
reload stagger (`+ simRandom() * 0.5` s on each volley) belongs to the **side**: `updateGroups` applies
it only when `side === 'enemy'` (`client/src/sim-core/ship-entity.js:253`, verified). As a result, a
`?duel` ace fires roughly 30 % less often than the identical wingman, even though both are flown by
`flySentinel`, and it draws from the shared seeded stream. After this change:

- Every ship flown by the Sentinel pilot gets the **same** stagger, drawn from the pilot's own private
  per-pilot RNG. That covers the wingman, every duel ace, and both teams of brawl bots.
- Pilot-flown ships take **zero** draws from the shared stream.
- Catalog enemies (stand-off AI, no pilot) keep today's `simRandom()` stagger exactly.

The pilot's "human error" knobs are gathered into **one named profile object** (`SENTINEL_PILOT`). A
future change to it reaches every Sentinel-flown ship, and a future, different pilot can be a second
profile.

**Part B — the bot brawl.** This is a repeatable load test the maintainer can run on a real phone against
production:

- **Teams:** two teams of N Sentinel bots each (default 20, range 1–30), all flown by `flySentinel`.
  After Part A both teams have literally identical pilots, so the fight is symmetric with no brawl-only
  switch.
- **Spectator camera:** the player only watches. The camera follows the centre of the living ships at
  normal gameplay zoom. A tap follows one bot, and a second tap goes back to the centre.
- **Location:** the fight is fought **over the home station** (the worst-case frame: station plus bots).
- **Determinism:** the seed is fixed, so every device running **the same JS engine** simulates the same
  fight, tick for tick, for as far as it gets.
- **Length:** **60 s of wall-clock time**, or earlier if one side is wiped out.
- **Result card:** avg / p95 / worst frame ms and FPS, overall and **per 10-sim-second window**; ships in
  frame; sim-seconds reached; the sim/wall ratio; tier, N and build; the station-in-frame %; and a
  **fight fingerprint** (alive per side every 10 sim-s, plus final kills per side).
- **Telemetry:** every per-second perf sample, plus one final result sample, goes to `/api/perf` →
  `perf_samples` in prod Postgres. `?brawl` alone turns this on.
- **No side effects:** the brawl pays nothing, records no session, and never involves the duel referee.

## Decisions (settled — do not re-ask)

### Part A — pilot-owned stagger

| # | Decision | Notes |
|---|---|---|
| A1 | **The stagger is the pilot's.** `flySentinel` passes it to `updateGroups` as a new optional last argument, `reloadStagger` (a `() => seconds` closure). `updateGroups` uses it when it is present, and otherwise keeps today's rule **verbatim**: `side === 'enemy' ? simRandom() * 0.5 : 0`. | Passing the stagger in from the caller means `ship-entity.js` never imports pilot code. `step-ally.js` already imports `updateGroups` from it (`step-ally.js:35`), so the reverse import would be a cycle. No function is stored on an entity either, so netsim snapshots and `digest.js` (which read named fields) are unaffected. The player (`step-player.js:344`) and catalog enemies (`step-enemies.js:116`) pass nothing, so they behave exactly as today. |
| A2 | **Its own private stream.** `pilotReloadRandom(a)` sits next to `pilotRandom` (`step-ally.js:76`). It uses the same keying, `(simSeed() ?? 0) ^ Math.imul(ordinal, 0x9E3779B1)`, XOR a fixed salt `PILOT_RELOAD_SALT = 0x5F3759DF`, and it re-derives itself when the seed changes, just as `pilotRandom` does. | **This is a separate stream, not the aim stream.** Sharing the aim stream would interleave reload draws with aim draws and shift every calibrated aim measurement (§153: the 18 % first-shot miss and the PD ~50 %) for no reason. A second stream built with the same mechanism keeps the aim sequence identical to today's. Integers only (§151). |
| A3 | **One profile object.** `SENTINEL_PILOT` lives in `client/src/sim-core/ally-config.js`, with the fields `aimHitFrac`, `aimLagSec`, `aimTauSec`, `aimJitter`, `aimJitterSec`, `aimKick`, `aimMax`, `pdJitter`, `pdJitterSec`, and `reloadStaggerSec: 0.5`. It is `Object.freeze`d. The existing `ALLY_AIM_*` / `ALLY_PD_*` exports stay as **aliases read from the profile** (`export const ALLY_AIM_KICK = SENTINEL_PILOT.aimKick;`), so no test or tool import changes. Every read of those knobs inside `step-ally.js` (lines 292, 311-335, 352, 702-703) becomes `SENTINEL_PILOT.<field>`. | **This deliberately differs from "a block in `step-ally.js`".** `ally-config.js` is where every one of these constants already lives, with its measured justification comments. `step-ally.js` and `server/src/ally-sim.test.js` import them from there. A second home would split one block in two. **Not built now (§30):** a `ctx.profile` seam. A second pilot adds it when it arrives. The profile's header comment says exactly that. |
| A4 | **This is an intended gameplay change, so "wingman/ace byte-identical" is lifted for exactly this change.** The wingman now staggers (on the 0.6 s Heavy cannon the mean reload goes from 0.60 s to 0.85 s, about −29 % sustained cadence, which is the same cadence an ace already had). An ace's stagger is unchanged in size, but now comes from its private stream, so it takes zero shared draws. | See §Replay / trace impact for exactly what moves. |

### Part B — the brawl

| # | Decision | Notes |
|---|---|---|
| B1 | **The fight lasts 60 s of WALL time** (maintainer). It ends early if a side is wiped out. | A slow phone simulates less, because the loop runs at most 6 steps per frame and clamps the accumulator at 0.1 s/frame (`client/src/main.js:1188-1199`, verified). The card therefore shows **sim-seconds reached** and **sim/wall ratio**, and the fingerprint and per-window stats are keyed to **sim** time, so devices are compared over the windows both reached. `&sec=N` (clamped 10–300) overrides the limit for tests and soaks. |
| B2 | **The fight is fought over the home station.** `BRAWL_CENTER = ANCHORS.base` = `(-10,-10)` (`sim-core/system-map.js:227`, verified). | See §Placement. |
| B3 | **Camera.** **Centre mode:** an eased centroid of the living ships that are neither retreating nor warping, at zoom 1, **clamped to `BRAWL_CAM_LEASH = 55` u around the station**. **Bot mode:** a tap/click follows the ship nearest the tap point, rigidly and unclamped. A second tap returns to centre. If the followed ship dies, the camera returns to centre. | Without the clamp the centroid drifts badly. After Part A (symmetric) the prototype measured a mean of 198–685 u and only 13–35 % of ticks within 60 u (§Evidence). **Flagged design call:** in centre mode a long chase can leave the frame. |
| B4 | **Setup screen:** a **−/+ stepper** for bots per side (1–30, default 20; a stepper rather than a number input, so no phone keyboard appears), a tier picker (High / Balance / Performance, defaulting to the **saved** tier), and **Start**. Start **always reloads** into `?brawl=<n>&tier=<t>`. A URL that carries a count starts the run immediately. | The light pool is baked into lit shaders at boot (`graphics.js` tier comment; `engine-lights.js:59`, verified), so a tier change *needs* a reload. Reloading every run also gives every run an identical fresh page. The `tier` param applies to that page load only and is never saved (§81). |
| B5 | **Teams** map onto the existing two-sided damage model. **Blue** is `world.allies` (`makeAlly`, side `'ally'`). **Red** is `world.enemies` (`makeAce`, side `'enemy'`). Each pilot gets `ctx = { foes: <other list>, friend: null, side, leash: Infinity, canFire: true }`. | Friendly fire is off both ways (`sim-core/world.js` header, verified). Ally-side shots damage only `world.enemies`; hostile shots damage only the player and allies (`step-projectiles.js:11`, `:184-191`). |
| B6 | **The brawl is a new caller of `flySentinel`.** `tick.js`, `stepAlly`, `stepAces` and `flySentinel`'s flying logic are not touched by Part B. | `flySentinel` already takes `foes`/`friend`/`side` from `ctx` (`step-ally.js:430-458`). It reads the player in only one place, step 3, `if (!player.alive)` (`:494-501`). The spectator stays **alive**, so that branch never fires. |
| B7 | **The spectator** is the real player ship, alive, **parked `BRAWL_SPECTATOR_PARK = 5000` u east** of the centre, and never stepped. **Every render reader of the player position that shapes the picture is routed to the view target** (§Render readers). | Rockets stop at `maxRange` (`step-projectiles.js:194`, verified). Bullet lifetime is ASSUMED finite (not opened); the prototype measured the spectator's hp as unchanged, and node test B4 is the guard. `brawlTick` never calls `stepPlayer`/`stepPlayerDeath`. |
| B8 | **Deaths only drive the visuals.** Blue deaths go through the existing `stepAllyDeaths`. Red deaths go through a new `stepBrawlRedDeaths`, which emits the same `allyDown` event and calls `despawnAt(world,'enemy',…)`. **`stepEnemyDeaths` is never called**, so there is no loot roll, no `kills`/`earned`/`earnedXp`, no drops and no draws. | The `allyDown` adapter case (`sim.js:337-340`, verified) is an explosion plus a boom and nothing else. |
| B9 | **Seed:** `BRAWL_SEED = 20261004`, installed with `seedSim()` after `reset()` and right before spawning. Ordinals: blue `1+2i`, red `2+2i`. | After Part A, a brawl takes **0** shared draws; the prototype measured exactly 0. Aim and reload streams are private per pilot and keyed to that seed. |
| B10 | **Nothing escapes:** no `beginLiveSession` (so no session row and no referee), `track()` does nothing under `?brawl`, and nothing ever emits `cleared`/`death`. The level is `withBrawlRoom(level-1)` with `xpReward: 0` and no briefing, intro or lastKillDrop. | See Step B7. |
| B11 | **Per-window statistics** (maintainer): for each 10-sim-s window, the card and the result sample carry avg/p95/worst frame ms, alive per side at the window's end, and the mean number of live ships inside the camera frustum. **Window 0 is the "full load" number.** No respawn. | A frame belongs to the window of the sim tick count at the end of that frame. A trailing partial window is kept and marked `partial: true`. |
| B12 | **Determinism is claimed for the same JS engine only.** | Browsers and Node do not agree bit-for-bit (§151; memory "cross-engine digest divergence"). An Android Chrome (V8) and an iPhone (JavaScriptCore) can diverge. The card says so under the fingerprint. SUMMARY and the DECISIONS entry say so too. |

## Evidence (measured, not assumed)

The planner ran a headless prototype of exactly the brawl tick body (Step B1) against the real catalog
(`buildCatalog('level-1')`). The setup was: centre `(-10,-10)`, the 5-wide grid with front ranks at ±60 u,
and the spectator parked +5000 u away. It used a scratch copy of `sim-core` patched with **Part A as
specified** (8th `updateGroups` argument plus a salted private reload stream). Nothing was committed.

| N | seed | ended (sim s) | fingerprint, blue v red | max bullets / rockets | shared draws | spectator hp |
|---|---|---|---|---|---|---|
| 20 | 20261004 | 161.9 (0v2) | 10s 9v11 · 20s 7v11 · 30s 6v9 · 60s 5v5 · 120s 2v3 | 74 / 29 | **0** | unchanged |
| 30 | 20261004 | 146.8 (0v2) | 10s 13v12 · 20s 10v11 · 40s 5v9 · 60s 4v7 | 87 / 46 | **0** | unchanged |
| 5 | 20261004 | 85.0 (3v0) | 10s 4v5 · 40s 4v4 · 80s 3v1 | 24 / 8 | **0** | unchanged |
| 1 | 20261004 | **9.9** (1v0) | — | 6 / 2 | **0** | unchanged |

What this shows:

- **Part A makes the fight even.** With today's code the same 20v20 was lopsided: 12v5 at 10 s and 12v0
  at 67 s, with blue winning every seed. With A applied, both sides trade evenly. At 20 per side, the 60 s
  wall limit, not a wipe-out, will end most runs.
- **The sim is cheap:** 0.02–0.03 ms/tick in Node on an M1. The phone's load is render plus DOM.
- **The centroid wanders** (198–685 u mean), so B3's clamp is necessary.

## Placement — how "station in frame" is guaranteed and verified

**Camera geometry (verified):**

- `PerspectiveCamera(55°)` (`client/src/engine.js:89`).
- The camera sits at offset `(0,110,26)` from its target (`engine.js:90`) and looks at the target
  (`sim.js settleView`).
- Phones always run in landscape (SUMMARY), so the aspect ratio is about 1.6–2.2.
- The station is 100 u long (`world.js:1244`) and its centre is at `y = -42`.

The station centre projected into NDC, by how far the camera target is offset from the station:

| target offset | NDC, aspect 2.0 | aspect 1.6 |
|---|---|---|
| 60 u +z (screen up) | (0, 0.56) | (0, 0.56) |
| 60 u −z (worst direction) | (0, −0.93) | (0, −0.93) |
| 80 u ±x | (∓0.50, −0.12) | (∓0.62, −0.12) |
| 80 u −z | (0, −1.24) — centre off-screen | same |

So with the target clamped to **55 u**, the station centre stays on screen in every direction. The leash
comes from this table.

**Measured at run time.** On every rendered frame of the armed run, the host tests the station's
bounding sphere against the camera frustum. Two details:

- The `Box3`/sphere is computed **lazily, on the first armed frame**, after the loading veil has dropped.
  The veil waits for `G.pendingAssets` (`main.js` warm block), so the station `.glb` is loaded by then.
  The sphere is never computed inside `startBrawl`, where the model may still be a placeholder.
- If `G.baseStation?.obj` has no mesh children at that point, `stationInFramePct` is reported as `null`
  ("unknown"), not 0 and not 100.

Centre mode should read ~100 %. Bot mode is unclamped and reports honestly.

## Render readers of the player position (critic blocker 1, enumerated)

`grep -n "player.pos\|G.player" client/src/{world,sim,hud,shield-fx,drops,main,engine-lights,ghost-battle,speed-field}.js`:

| site | what it shapes | brawl handling |
|---|---|---|
| `sim.js:656,661` camera position + `lookAt` | the frame | **view target** (Step B5) |
| `sim.js:666` `updateSpeedField` | player-locked dust backdrop | **view target** |
| `world.js:685` `updateSystemBodies` — `bodyFade(distance to ship)` hides planet 2 / moons; star lift | the sky | **view target**: add a param `updateSystemBodies(ship = <today's default>)`; `settleView` passes `tgt`. Without this, planet 2 and its moons fade to 0 with the ship parked 5000 u away. |
| `sim.js:519` `drawArenaBorder` — opacity from distance to the edge | border line opacity | **view target** (pass `tgt`), so the border reads as it would for a ship at the view centre (~0.12, not ~0.87). |
| `hud.js:453-462` minimap player triangle | radar | **skip drawing the triangle while `G.viewTarget` is set**. The radar is centred on `arenaCenter` (`hud.js:420`, verified), so the ships draw correctly, but the spectator triangle would sit pinned to the edge as a phantom. |
| `hud.js:233` drop edge markers, `drops.js:257` grab line | loot UI | no drops in a brawl, so inert |
| `shield-fx.js:107` the player's bubble ripple | player shield FX | the spectator is never hit, so inert |
| `sim.js:435` player death explosion | — | never dies, so inert |
| `hud.js:53-78` player hp/shield/rocket readouts | HUD | shows a full static hull, which is accepted (HUD stays visible, critic blocker 2) |
| `main.js:500/922/1115/1540/1661/2069/2229` | `?roam` readout, backdrop recorder, netsim, debug digests, boot camera | not active under `?brawl` (or runs before it), so inert |

**`G.viewTarget`** is `null` by default. Under the brawl it is a function returning a **reused
`THREE.Vector3` with `y = BULLET_PLANE_Y`**: never a plain `{x,z}` and never a sim `Vec3`. The reason is
the NaN-camera trap: `lookAt` type-tests its argument (`sim.js:657-660`). Keep the `lookAt(tgt.x, tgt.y,
tgt.z)` component form as well.

## Steps

### Part A — pilot-owned stagger (do this first, as its own commit)

**A1. `client/src/sim-core/ally-config.js`.** Add `SENTINEL_PILOT` (A3), built from the literal values
now on lines 88-100 and 197-200, plus `reloadStaggerSec: 0.5` and `PILOT_RELOAD_SALT = 0x5F3759DF`.

- Move the long justification comments onto the profile fields.
- Re-export `ALLY_AIM_HIT_FRAC`, `ALLY_AIM_LAG_SEC`, `ALLY_AIM_TAU_SEC`, `ALLY_AIM_JITTER`,
  `ALLY_AIM_JITTER_SEC`, `ALLY_AIM_KICK`, `ALLY_AIM_MAX`, `ALLY_PD_JITTER` and `ALLY_PD_JITTER_SEC` as
  aliases of the profile fields.
- Header comment on the profile: "The Sentinel pilot's human error, in one place: every ship
  `flySentinel` flies — the wingman, every `?duel` ace, every `?brawl` bot — reads THIS. A different pilot
  is a second profile, threaded through `flySentinel`'s ctx when it exists (not before — §30)."

**A2. `client/src/sim-core/step-ally.js`.**

- Next to `pilotRandom` (`:76`), add `export function pilotReloadRandom(a)`. It mirrors `pilotRandom`,
  but uses the fields `_reloadSeed`/`_reloadRng` and the seed
  `((simSeed() ?? 0) ^ Math.imul(a._aimOrdinal | 0, 0x9E3779B1) ^ PILOT_RELOAD_SALT) >>> 0`. Comment it:
  "a separate stream so the aim sequence (and every §153 calibration) is unchanged".
- Replace every read of the aliased knobs in this file with `SENTINEL_PILOT.<field>` (A3).
- At the `updateGroups` call (`:760-786`), add the 8th argument
  `() => pilotReloadRandom(a) * SENTINEL_PILOT.reloadStaggerSec`.
- Update the header's "DRAWS NOTHING FROM THE SEEDED STREAM" paragraph (`:22-27`). The words "no reload
  jitter (that is enemy-only)" become "his reload stagger is his own too — a second private stream".

**A3. `client/src/sim-core/ship-entity.js:239-260`.** Change the signature to
`updateGroups(world, ship, fwd, side, dt, wantsFire, rocketTarget = null, reloadStagger = null)`.

- The cooldown line becomes
  `g.cooldown = g.reload + (reloadStagger ? reloadStagger() : (side === 'enemy' ? simRandom() * 0.5 : 0));`.
- Rewrite the comment above it: catalog enemies stagger on the shared stream, exactly as before (every
  campaign trace stays bit-identical). A pilot-flown ship passes its own stagger and draws nothing shared.
  The player passes nothing and has no stagger.
- Note that the beam branch (`updateBeamGroup`) ignores it, since no Sentinel carries a beam.

**A4. `client/src/sim-core/ace.js` header (`:20-22`).** Its "human aim error … PRIVATE per-pilot
mulberry32" sentence gains "…and so does its reload stagger. An ace draws NOTHING from the shared stream
any more."

### Part B — the brawl

**B1. `client/src/sim-core/brawl.js` (new, pure, Three-free).**

It imports `makeAlly` (`ally.js`), `makeAce` (`ace.js`), `flySentinel` and `stepAllyDeaths`
(`step-ally.js`), `stepBullets` and `stepRockets`, `despawnAt` (`spawn.js`), `ANCHORS` (`system-map.js`),
and `SIM_DT`, `TICK_HZ` and `BULLET_PLANE_Y` (`consts.js`).

Exported constants:

- `BRAWL_SEED = 20261004`
- `BRAWL_N_MIN = 1`, `BRAWL_N_MAX = 30`, `BRAWL_N_DEFAULT = 20`
- `BRAWL_CENTER = ANCHORS.base`
- `BRAWL_FRONT_GAP = 60`, `BRAWL_COLS = 5`, `BRAWL_SPACING = 12`
- `BRAWL_SPECTATOR_PARK = 5000`
- `BRAWL_WINDOW_TICKS = 10 * TICK_HZ` (600)
- `BRAWL_CAM_LEASH = 55`

Functions:

- **`withBrawlRoom(descriptor)`** is non-mutating, like `withDuelRoom`. It returns
  `{ ...d, title: 'Bot brawl', xpReward: 0, enemyTotal: 0, finalStageBanner: false, briefing: undefined,
  lastKillDrop: undefined, introTrace: undefined, intro: undefined, center: { x: BRAWL_CENTER.x, z:
  BRAWL_CENTER.z }, phases: [{ name: 'brawl' }] }`.
  - It keeps `map`.
  - `center` puts `world.arenaCenter` on the station (`level-sim.js:26 runCenter`, verified), so the
    retreat's edge rule (`step-ally.js:569-570`) is measured from the brawl.
  - The single inert phase spawns nothing (`level-runner.js:94-120`).
- **`spawnBrawl(world, n)`** clamps `n` to [1, 30] and:
  - parks the spectator at `(C.x + 5000, Y, C.z)` with zero velocity;
  - for each `i`, computes `row = ⌊i/5⌋`, `col = i%5`, `lat = (col−2)·12 + (row%2)·6`, `depth = row·12`;
  - builds **blue** with `makeAlly(cat)`, sets `_aimOrdinal = 1+2i`, places it at
    `(C.x−60−depth, Y, C.z+lat)` with heading `+π/2`, pushes it onto `world.allies`, and calls
    `host.onSpawn('ally', a)`;
  - builds **red** with `makeAce(cat, 2+2i)`, places it at `(C.x+60+depth, Y, C.z−lat)` with heading
    `−π/2`, pushes it onto `world.enemies`, and calls `host.onSpawn('enemy', e)`;
  - gives both the warp fields `spawnAge = 0`, `spawnDur = 1`, `warping = true`, `scale = fullScale·0.001`;
  - sets `world.brawl = { n, armed: false, ended: false, ticks: 0, killsByBlue: 0, killsByRed: 0,
    fingerprint: [] }`.

  This is the only place `world.brawl` is set. `createWorld` is untouched, and `digest.js` reads named
  fields only. The layout draws no randomness.
- **`brawlTick(world, dt)`** returns `null`. It does nothing unless `world.brawl?.armed &&
  !world.brawl.ended`. Otherwise (illustrative):
  ```js
  world.combatElapsed += dt;
  for (const a of world.allies)  flySentinel(world, a, dt, { foes: world.enemies, friend: null, side: 'ally',  leash: Infinity, canFire: true });
  for (const e of world.enemies) flySentinel(world, e, dt, { foes: world.allies,  friend: null, side: 'enemy', leash: Infinity, canFire: true });
  stepBullets(world, dt); stepRockets(world, dt);
  b.killsByBlue += stepBrawlRedDeaths(world);
  const before = world.allies.length; stepAllyDeaths(world); b.killsByRed += before - world.allies.length;
  b.ticks++;
  if (b.ticks % BRAWL_WINDOW_TICKS === 0) b.fingerprint.push([b.ticks / TICK_HZ, world.allies.length, world.enemies.length]);
  ```
- **`stepBrawlRedDeaths(world)`** loops backwards over `world.enemies` and handles each ship with
  `hp <= 0`:
  - emits `{ type: 'allyDown', pos: e.pos.clone(), exhaustColor: e.engine?.exhaust?.color ?? e.color,
    sizeScale: e.sizeScale || 1, shipClass: e.class, weightClass: e.weightClass ?? null }` (same shape as
    `step-ally.js:806-819`);
  - calls `despawnAt(world,'enemy',…)`.

  It returns the number of ships removed.
- **`brawlOver(world)`** is true when either list is empty.
- **`brawlSimSec(world)`** is `ticks * SIM_DT`.
- **`brawlViewCentre(world, out)`** computes the mean of the living ships that are neither retreating
  nor warping. If there are none it uses all living ships, and if there are no ships it uses
  `BRAWL_CENTER`. It then clamps the result to `BRAWL_CAM_LEASH` around `BRAWL_CENTER` and writes x/z
  into `out`.
- **`nextCameraMode(mode, pickedId)`** handles taps: centre + a pick → `{kind:'bot', id}`; centre + no
  pick → centre; bot + any tap → centre.

**B2. `client/src/brawl-dev.js` (new; follow the `duel-dev.js` pattern).**

- `evalBrawlDev(search)` is pure. It returns `null` when the flag is absent or `0`/`false`/`off`.
  Otherwise it returns `{ n, tier, sec }`:
  - `n` is clamped to [1, 30], or is `null` for a bare `?brawl`, which shows the setup screen;
  - `tier` must be one of `TIER_ORDER`, otherwise it is `null`;
  - `sec` is clamped to [10, 300] and defaults to 60.
- Also export `brawlDev()` (cached), `brawlActive()`, `brawlDevLevel()` (`'level-1'` when on),
  `applyBrawlDev(d)` (`withBrawlRoom` when on, the **same object** when off) and `brawlTierOverride()`.
- The module must not import `state.js`, because `state.js` imports it.
- The header comment explains what the flag does, that it is not sticky (§81), the same-engine
  determinism (B12), and the hard-refresh note (Step B8).

**B3. `client/src/brawl-stats.js` (new, pure).**

- **`summarizeFrames(ms[], wallSec)`** returns `{ frames, avgMs, p95Ms, worstMs, fps }`. It uses the
  floor-index percentile rule of `main.js:683 pct`. The input is **raw** frame intervals (see the
  comment at `main.js:766`).
- **`windowStats(samples, windowTicks)`**: each sample is `{ ms, tick, inFrame }`. It returns one row
  per 10-sim-s window: `[{ w, fromSec, toSec, avgMs, p95Ms, worstMs, frames, meanInFrame, partial }]`.
  `alive` is joined in from the fingerprint by the caller.
- **`brawlShouldEnd({ wallMs, secLimit, over })`** returns `'wipeout' | 'time' | null`. The end rule is
  pure so that it can be unit-tested.
- **`buildBrawlResult({...})`** returns a plain object: `{ kind: 'brawl-result', n, tier, build, res,
  dpr, wallSec, simSec, ratio, overall, windows, fingerprint, killsByBlue, killsByRed, survivors,
  stationInFramePct, interrupted, endedBy, engine }`. `engine` comes from `engine-id.js` `jsEngine()`
  (verified at `client/src/engine-id.js:36`).
- **`formatBrawlCard(result)`** returns English `[label, value]` rows plus the per-window table.

**B4. `client/src/brawl-host.js` (new).** It imports `three`; `G`/`world` from `state.js`;
`camera`/`setZoom` from `engine.js`; `reset` from `sim.js`; `seedSim`; the `brawl.js`, `brawl-stats.js`
and `graphics.js` (`loadTier`/`TIER_ORDER`/`TIERS`) exports; and `Device`.

**`showBrawlSetup()`** shows the `#brawl-setup` panel:

- the N stepper (−/+, 1–30), the tier buttons, and Start;
- `G.buildVersion`, plus the line "Hard-refresh after a deploy";
- Start runs `location.assign('?brawl=<n>&tier=<t>' + preserved dev/debug/sec)`.

**`startBrawl()`** does the following, in order:

1. `body.classList.remove('menu')`, then `.add('brawl')`.
2. `G.activeMission = null; G.gameStarted = true;`
3. `reset();`
4. `seedSim(BRAWL_SEED); spawnBrawl(world, n); setZoom(1);`
5. Set `mode = {kind:'centre'}` and `G.viewTarget = () => _view` (a reused `THREE.Vector3` with
   `y = BULLET_PLANE_Y`).

The spawn happens in the same frame as `reset()`, so the deferred warm that `reset()` requested compiles
the ships too.

**`brawlFrame(rawSec, warmDone)`** runs once per animate frame:

- **Arming.** While the run is not armed and `warmDone` is true:
  - set `world.brawl.armed = true` and record `t0`;
  - compute the station bounding sphere now (§Placement).

  Frames before arming are not recorded.
- **While armed and not ended:**
  - update `_view`. In centre mode, ease `brawlViewCentre` with τ = 0.4 s. In bot mode, copy the followed
    ship's position; if it died, switch to centre.
  - Update the frustum from `camera`.
  - Push the sample `{ ms: rawSec*1000, tick: world.brawl.ticks, inFrame: <living ships whose pos is
    inside the frustum> }`, and count the station test.
  - If `document.hidden || G.paused`, set `interrupted = true`.
  - If `brawlShouldEnd(...)` returns a reason, set `ended = true`, build the result, call
    `devPerf.pushResult(result)`, and show `#brawl-card`.

**`#brawl-card`** has `z-index ≥ 10`, which puts it above `#stick-zone`, and is laid out for the rotated
landscape body. It shows:

- N, tier, build, resolution/DPR and engine;
- wall s, **sim s reached**, **sim/wall ratio** and `endedBy`;
- overall avg/p95/worst ms and FPS;
- **the per-window table**: window, avg/p95/worst ms, mean ships in frame, and blue v red alive. Window 0
  is labelled "full load".
- station-in-frame % (or "unknown");
- "INTERRUPTED — rerun" when that flag is set;
- final kills per side;
- the note "Fingerprints compare only on the same JS engine, over the windows both runs reached."

It has two buttons: **Run again** (`location.reload()`) and **Setup** (`?brawl` plus the preserved
params).

**`brawlTap(e)`** converts the event to NDC with `main.js`'s `eventNdc`. Move `eventNdc` into an
importable helper, or pass the NDC in. It intersects the ray with the plane `y = BULLET_PLANE_Y`, picks
the living, non-warping ship within 25 u of the hit, and applies `nextCameraMode`.

**`brawlDebugState()`** is used by `?debug` and the per-sample telemetry. It returns `{ ...world.brawl,
cam: mode.kind, followId, stationInFramePct, frames, windows, ended, cardVisible, interrupted }`.

**B5. `client/src/sim.js` and `client/src/world.js` (inert when the flag is off).**

- **`sim.js:508`:** `export function simTick(dt) { grabTarget = world.brawl ? brawlTick(world, dt) :
  simTickIn(world, dt); }`.
- **`settleView` (`sim.js:654`):** add `const tgt = G.viewTarget ? G.viewTarget() : G.player.pos;` and use
  it for:
  - the camera position;
  - `lookAt(tgt.x, tgt.y, tgt.z)`;
  - `updateSpeedField(tgt.x, tgt.z)`;
  - `updateSystemBodies(tgt)`.
- **`drawArenaBorder` (`sim.js:518`):** take `p` from the same view target (`G.viewTarget ?
  G.viewTarget() : world.player.pos`).
- **`world.js:680`:** `export function updateSystemBodies(ship = (G.player && G.player.pos) ? G.player.pos
  : ORIGIN)`. Delete the local `ship` const. Every other caller (bootstrap, roam) passes nothing, so their
  behaviour is unchanged.
- **`hud.js:451-462`:** wrap the player triangle in `if (!G.viewTarget) { … }`.
- **`state.js`:** add `viewTarget: null` to `G`, with a one-line comment. Line 21 becomes
  `gfx: resolveTier(brawlTierOverride() || loadTier(window.localStorage, Device.hasTouch))`.

**B6. `client/src/main.js`.**

- **Imports and constant:** add the brawl-dev/brawl-host imports and `const BRAWL = brawlActive();`.
- **Level:**
  - `:2168`: append `|| brawlDevLevel()` to the `devLevel` chain.
  - `:2203`: make `applyBrawlDev(…)` the outermost wrapper.
- **Landing (`:2240` chain):** `else if (BRAWL) { brawlDev().n ? startBrawl() : showBrawlSetup(); }`,
  placed before the `level-0` branch.
- **Telemetry:**
  - Add `const PERF = DEV || BRAWL;`. Use `PERF` instead of `DEV` in the devPerf guard (`:667`), in the
    `t0`–`t3` timers and in the `devPerf.frame` call (`:1069, 1216, 1237, 1271, 1273`). `#perf` stays
    gated by `body.devmode`.
  - In `finalizeBucket` (`:738-756`):
    - `scene` becomes `'brawl'` when `world.brawl` exists;
    - add the field `brawl: brawlDebugState()`, trimmed to `{ n, armed, ended, simSec, wallSec, ratio,
      alive, stationInFramePct, cam, interrupted }`;
    - add `allies: allies.length` to `load`.
  - Add `pushResult(obj)` to devPerf: `outbox.push(obj); flush(false); lastFlush = performance.now();`.
    No server change is needed: the payload is stored as JSONB (`server.js:529-541`, verified).
- **Loop:** after the accumulator (`~:1206`), call `if (BRAWL && world.brawl) brawlFrame(rawSec,
  !G.needsSceneWarm && !warmDeferred);`.
- **Input:**
  - Add `if (BRAWL && world.brawl) { brawlTap(e); return true; }` as the first line of `engageObjectAt`
    (`:468`). That single site covers the desktop click (`:483`) and the touch tap (`endStick`, `:360`;
    verified).
  - Add `if (BRAWL) return;` to the pinch branch (`:344`) and the wheel handler (`:408`).
- **Session:** add `|| BRAWL` to the early return of `beginLiveSession` (`:1767`).
- **`window.__game`** (`?debug`, `:1369`): add `get brawl()` (returns `brawlDebugState()` or `null`). If
  they are absent, also add `get kills()` and `get systemBodies()`; the latter returns
  `G.systemBodies.map(b => ({ name: b.name, visible: b.mesh.visible }))`.

**B7. Other guards.**

- **`net.js:203 track()`:** add `if (brawlActive()) return;` as the first line.
- **`account.js:282`:** wrap the call in `applyBrawlDev(…)`, as is already done for `applyDuelDev`.
- **CSS `body.brawl`:** hide **input controls only**: the fire and rocket buttons, the zoom buttons, the
  pause button, `#pause-overlay`, and the joystick knob/ring visuals. **Keep** `#hud`, `#minimap`, the XP
  bar, `#markers`, the enemy/ally health bars and the event log (critic blocker 2).
  - Hiding `#pause-overlay` stops a tap from accidentally unpausing. Auto-pause-on-blur still freezes the
    sim, which marks the run `interrupted`, and the wall clock then ends it.
  - `#stick-zone` stays able to receive touches, because taps travel through it.
- **Panels:** `#brawl-setup` and `#brawl-card` live in `client/index.html` next to the other overlays.

**B8. Deploy note (goes into SUMMARY).** Client modules have fixed names, so the maintainer must
**hard-refresh** on the phone after a deploy. The setup panel shows `G.buildVersion` so that can be
checked. No asset or content hash changes, so no `/publish-itch` is needed.

## Replay / trace impact (Part A is a deliberate sim change)

| what | effect | why (verified) |
|---|---|---|
| **Level-0 intro trace** → `22-trace-replay` (determinism fixture) and `36-sim-divergence` (browser vs Node digest) | **No change.** Both stay green with no fixture edit. | The intro has no pilot-flown ship: no seeded level carries `ally: true` or `aces` (`grep -n "ally\|aces:" server/src/catalog_seed.js`, no phase hits). Catalog enemies take the unchanged `simRandom()` branch. |
| Campaign session survey (`server/tools/verify-sessions.mjs`) | **No change.** | Same reason: no shipped level spawns a pilot. `?ally` sessions were already filed as "disagree" by design (`ally-dev.js` header). |
| **Old `?duel` rows in prod `gameplay_sessions`** | **Their stored verdicts stay as they are.** | The referee runs **once, at upload** (`server.js:604-607`), and writes the verdict onto the row. Nothing re-judges old rows. If someone re-ran the referee by hand under the new build, `classifyTrace` would return `build-drift` → **unverifiable**, not a false `disagree` (`server/src/seal/verify-run.js:66`). |
| Admin "▶ play" on an **old** duel row | **The replayed fight differs from the recorded one.** | Playback re-simulates on current code. This is accepted, and it is exactly what the 2026-09-11 aim-error change did to every earlier duel. |
| `TRACE_VERSION` | **No bump; it stays 4.** | The version marks trace format and level naming (`replay.js:26-39`), not per-build sim behaviour. Build drift is the referee's job (above), and the §153 aim change set the precedent of no bump. |
| `49-duel-referee` (live duel: browser vs Node) | **Must still pass.** It now sees **fewer** shared draws, and only loot rolls are left. | The draws assertion (`49:85`) still compares like with like on both hosts. Its hash check is already dormant (§155). The reload stream is another private sequential stream, so §155's caveat now covers it too; say so in the DECISIONS entry. |
| Netsim rooms | No special handling. | The room runs the same `sim-core`. |

## Tests

### Node (`cd client && node --test`; `cd server && npm test`, because `server/src/ally-sim.test.js` and `seal/*.test.js` import this sim-core)

**Part A (new, `client/src/sim-core/step-ally.test.js`):**

1. **Same pilot, same schedule.** Build a wingman with `makeAlly(cat)` (`_aimOrdinal = 7`) and an ace
   with `makeAce(cat, 7)`. Put each in its own world under the same `seedSim(4242)`, both 40 u from an
   identical stationary dummy (`makeSentinelHull(cat, 99)`) dead ahead. Fly each for 10 s with
   `flySentinel` and its own ctx: the wingman as `side 'ally'` with the dummy in `foes`, the ace as
   `side 'enemy'` with the dummy as its foe. Record the ticks on which the gun group's volley starts
   (`g.cooldown` jumps up). Assert:
   - **the two schedules are identical**;
   - at least one gap is greater than `reload`, i.e. the stagger is really there;
   - `simRandomDraws()` did not move in either run.
2. **A catalog enemy is unchanged.** Run `seedSim(S); const r = simRandom(); seedSim(S);`, then a firing
   `updateGroups(world, enemy, fwd, 'enemy', dt, () => true)` with no 8th argument. Assert that
   `g.cooldown === g.reload + r * 0.5` and that exactly one shared draw happened.
3. **The player is unchanged:** side `'player'` with no 8th argument gives `cooldown === reload` and no
   draws.
4. **Stream isolation.** Draw 5 values from `pilotRandom(a)` on a fresh pilot. On a second fresh pilot
   with the same ordinal and seed, interleave `pilotReloadRandom` draws with the same 5 `pilotRandom`
   draws. Assert the aim values are identical.
5. **Profile.** Every `ALLY_AIM_*`/`ALLY_PD_*` alias equals its `SENTINEL_PILOT` field, and the profile is
   frozen.

**Part A — existing tests:**

- **Must stay green untouched:**
  - `ace.test.js`, including "spawnAces draws NO randomness".
  - `step-ally.test.js`'s ZERO-RNG test (`:572`). Extend it, or add a sibling test asserting an **ace**
    fight also draws nothing shared.
  - The §153 aim tests (`:811-940`) and `server/src/ally-sim.test.js` "the SECOND shot still lands"
    (`:808`). These model the *minimum* gap of one `fireCooldown`. The stagger only lengthens gaps, so
    the bound stays a valid, now conservative, worst case.
  - `server/src/seal/verify-duel.test.js`: its anchors come from its own re-simulation, so it is
    self-consistent.
- **May move** (cadence-dependent): `server/src/ally-sim.test.js` "POINT DEFENCE in a CLOSING engagement:
  ~50 % per shot" (`:604`), and any ally-sim test that counts bullets inside a fixed window. If one fails:
  - re-measure;
  - update the `MEASURED:` comment with the new numbers;
  - **report the change in the final summary.**

  Never widen a band without a measurement. If "most rockets still die" stops holding, that is a real
  gameplay regression: report it to the maintainer, do not paper over it.

**Part B (new `client/src/sim-core/brawl.test.js`)** builds the catalog with `buildCatalog('level-1')`
(as in `ace.test.js:22-38`) and uses a spectator from `makeSentinelHull(cat, 999)` with `alive: true`.

1. **Layout.** `spawnBrawl(w, 20)` gives 20 + 20 ships. Every enemy has `pilot === ACE_PILOT` with
   reward/xp 0. All ordinals are distinct and none is 0. Blue x < centre < red x. The spectator is ≥
   4900 u from `BRAWL_CENTER`. No draws are taken. The count clamps: 99 → 30, 0 → 1.
2. **Inert** until `armed`, and again once `ended`: no ticks, no movement, no draws.
3. **Determinism.** Two fresh 20v20 worlds under `BRAWL_SEED`, each run for 60 sim-s (3600 ticks), give
   identical `fingerprint`, `ticks`, kills and survivor positions, plus **0 shared draws**. The
   fingerprint has 6 rows. Do **not** pin the prototype's numbers.
4. **It ends and nothing escapes.** Run `n = 1` until `brawlOver`, capped at 60 sim-s. It must end; the
   prototype measured 9.9 s. Then assert:
   - `kills`, `earned` and `earnedXp` are all 0;
   - `drops` and `pendingLoot` are empty;
   - the spectator's `hp`/`_shieldValue` are unchanged;
   - each death produced exactly one `allyDown` and there were no `kill` events. Drain the event queue
     every tick, as the host does.
5. **View centre:** retreating and warping ships are excluded, with the fallbacks; a centroid 300 u away
   clamps to exactly 55; an empty world gives `BRAWL_CENTER`.
6. **`nextCameraMode`:** centre → bot → centre; a tap that picks nothing stays in centre.
7. **`withBrawlRoom`:** it does not mutate its input; `xpReward` is 0; no briefing/lastKillDrop/intro;
   `center` is the station; `map` is kept.

**New `client/src/brawl-dev.test.js`:**

- off for a missing flag and for `0`/`false`/`off`;
- a bare `?brawl` gives `n: null`;
- `brawl=99` clamps to 30, and `brawl=-3` falls back to 20;
- `tier=garbage` gives null;
- `sec` is clamped;
- with the flag off, `applyBrawlDev(x) === x`.

**New `client/src/brawl-stats.test.js`:**

- `summarizeFrames` on a known array;
- `windowStats`: frames split by tick into 600-tick windows, the partial last window flagged, the mean of
  `inFrame`;
- `brawlShouldEnd` for time, wipe-out, and neither;
- `buildBrawlResult` ratio;
- `formatBrawlCard` includes the window table and "sim/wall".

### Visual — named scenarios only (the full suite is opt-in, §141)

**New `client/visual/scenarios/51-bot-brawl.mjs`**, modelled on `47-duel-room.mjs`:

1. Boot `?debug&brawl=1&tier=performance&sec=300`. One bot per side: the prototype wiped out at 9.9
   sim-s, which keeps software GL fast. Then `waitForFunction(() => __game.brawl?.armed)`.
2. **After** arming, attach `page.on('request')`. From then on:
   - every `POST` must be `/api/perf`;
   - **no** request may go to `/api/events`, `/api/sessions` or `/api/games`.

   Boot-time POSTs, such as anonymous player creation, happen before the listener is attached and are
   deliberately excluded.
3. Call `__game.setPaused(true)`; `stepSim` is then the only driver (`main.js:1421`).
4. Step with `__game.stepSim(30)` chunks, never wall-clock waits. At each sample assert:
   - both ships have `mesh.parent`, and the red one carries the red livery;
   - the spectator is ≥ 4900 u away and its hp never changes;
   - **perception:** in centre mode the station's world position projects inside NDC [−1, 1]², and at
     least one ship projects inside NDC at the opening;
   - **planet 2's mesh is `visible`** (critic blocker 1) — read it through `__game.systemBodies`;
   - `__game.brawl.cam === 'centre'`.
5. Click the canvas at the blue ship's projected screen position and assert `cam === 'bot'`. Click again
   and assert `'centre'`.
6. Step until `brawl.ended` (cap 60 sim-s). Then wait for `#brawl-card` and assert:
   - its rect is inside the viewport;
   - its z-index is ≥ 10;
   - it contains "sim/wall", "p95", "full load" and at least one window row;
   - `interrupted` is true, which is expected because the scenario paused;
   - kills are still 0;
   - **one `/api/perf` POST whose body contains `"brawl-result"`**.
7. Flag-off half: boot `?debug` and assert `__game.brawl === null`, no `body.brawl`, and planet 2 visible.
8. Take `shot('bot-brawl-mid')` and `shot('bot-brawl-card')`.

**Run only:** `51-bot-brawl`, `22-trace-replay`, `36-sim-divergence`, `47-duel-room`, `49-duel-referee`
(Part A touches the duel's sim) and `38-ally` (Part A touches the wingman). Use `VISUAL_WORKERS=1`, and
check `lsof -i :4173` first.

### Manual / live (Stage 9, after deploy)

1. **Desktop:** at prod `?brawl`, run N = 20 on the saved tier through to the card.
2. **Phone:** hard-refresh, then run on Balance and on Performance. Compare the per-window rows; window 0
   is "full load".
3. **Telemetry:** check
   `SELECT sample FROM perf_samples WHERE sample->>'kind'='brawl-result' ORDER BY id DESC LIMIT 5;`.
   Use per-second rows only where `(sample->'brawl'->>'ended')::bool IS NOT TRUE`.
4. **Camera:** tap a ship, then tap again.
5. **Part A in play:** fly `?ally&level=4` and `?duel`. The wingman's cannon should visibly fire a little
   less regularly. An ace should fire at the same cadence as the wingman.

## Docs to update

### SUMMARY.md

- **`flySentinel` / "The ally (a third combatant)" (`:1464`) and "The duel room" (`:1673`):** the pilot
  owns its reload stagger (0–0.5 s, private second stream). It is identical for the wingman and the aces.
  Aces take no shared draws. Mention the `SENTINEL_PILOT` profile.
- **Wherever SUMMARY states that enemies stagger reloads:** catalog enemies only, on the shared stream.
- **"Every dev URL flag" (`:~476`):** add `?brawl[=N]` with `&tier=` and `&sec=`.
- **A new bullet, "The bot brawl (`?brawl`) — a phone load test",** next to the duel room. It covers:
  - the side mapping, the spectator park, and the render readers routed to the view target;
  - the seed and same-engine determinism;
  - 60 s of wall time, with the sim-keyed fingerprint and per-window stats ("window 0 = full load");
  - the station placement and the 55 u leash;
  - tap-to-follow;
  - the card fields;
  - telemetry: `scene:'brawl'`, the `brawl` field with `ended`, and `kind:'brawl-result'`;
  - what it never does;
  - the hard-refresh note.
- **`perf_samples` paragraph (`:3761`):** add the `brawl-result` query and the `ended` filter.
- **Client module layout and the sim-core list:** add `brawl.js`, `brawl-dev.js`, `brawl-stats.js` and
  `brawl-host.js`.
- **Tests section:** add the new files and `51-bot-brawl`.
- Bump `**Updated:**`.

### CHANGELOG.md

Two bullets under `## 2026-10-04`:

1. **"The Sentinel pilot owns its reload stagger: wingman and aces now fire alike."** State that the
   wingman's cadence drops slightly and that aces no longer draw on the shared stream.
2. **"A bot brawl you can run on a phone (`?brawl`)."**

### DECISIONS.md

Re-check numbering at merge, because parallel sessions collide.

- **§156 "A pilot owns its human error — one profile for every ship it flies."**
  - The stagger was attached to the *side*, so one pilot behaved as two.
  - It now comes from a separate private stream, so the aim calibration is untouched.
  - Catalog enemies are left on the shared stream so campaign traces stay bit-identical.
  - There is no `TRACE_VERSION` bump; the build gate covers old duel rows.
  - The private sequential stream extends §155's caveat.
  - There is no `ctx.profile` until a second pilot exists (§30).
- **§157 "The brawl measures 60 s of WALL time over the home station."**
  - Wall time vs sim time, and comparison over the windows both runs reached on the same engine.
  - The per-window stats.
  - Near-station worst case: the projection table and the 55 u leash.
  - A reload per run, because the light pool is baked at boot.
  - A parked spectator plus routed render readers, instead of a special case in projectile code.

## Out of scope / non-goals (§30)

- No other change to `flySentinel`'s flying, no balance retune, no `ctx.profile`, and no pilot registry or
  class hierarchy.
- No server code, migration or admin page. `/api/perf` already accepts any JSON.
- No re-judging of old duel rows and no `TRACE_VERSION` bump.
- No recording or replay of a brawl, no referee, and no netsim.
- No respawn (maintainer), no zoom-to-fit, no cycling through every bot, no team picker, no per-team
  loadouts, and no audio mute.
- No perf A/B bench run and no full visual suite (both opt-in).
- No `/publish-itch`, because no asset or hash changes.
