# Star-system map — flyable to-scale system + autopilot navigation

**Feature ID:** 2026-08-09-1456-star-system-map
**Status:** planned (2026-08-09)

## Goal

Turn the current single-planet home map into a **to-scale, flyable star system** you navigate with an
**autopilot driven by a system-map screen**. A central star, four orbiting planets, an asteroid belt with
three mining bases, a science station and our base station all live at real coordinates on the flat XZ
plane. Out of combat the player-speed cap is lifted so you can cross the system, a **player-locked wrapping
speed-field** (replacing the static origin-ring asteroids) sells the sense of speed, and a **system-map
screen** (opened from the base menu's *Map* section and — out of combat — from the in-battle mini-map) lets
you pick a destination and **autopilot the real ship there**. Arriving at a mission destination prompts
*Start mission?*, which hands off to the existing Take-off/mission-launch flow. **"To-scale" means the
travel distances** (orbit radii on the plane); the celestial bodies stay **backdrop-rendered at readable,
roughly constant on-screen sizes** and re-project across the sky by their true bearing from the player as
you fly. Everything new is **client-side visual + navigation, replay-neutral, and consumes zero sim RNG**.

This is a feel feature — **ship an early playable build FIRST** (Stage 1) so the maintainer can live-tune
the 2-minute sizing, the speed-field density/parallax and the autopilot feel before we polish the map UI.

---

## Where things live now (verified file map)

- **Backdrop / map build:** `client/src/world.js`
  - `buildMap(descriptor)` at `world.js:763` builds sky (nebula/stars), the single `planet`, the `moons`,
    the parallax `rocks` asteroid layer (`makeAsteroids(d.asteroids)` at `world.js:822`), and the
    set-pieces.
  - `makeAsteroids({count,spread,color,...})` at `world.js:428` — one `InstancedMesh` ring around origin,
    static in world coords. **This is what the speed-field replaces.**
  - `makeMoon` at `world.js:363`, `updateMoons(dt)` at `world.js:373` (orbit math around `planetPos`).
  - `ARENA = 360` (half-extent) at `world.js:16`; `arenaCenter` (Vector3) at `world.js:23`; `arenaBorder`
    at `world.js:28`.
- **Sim loop:** `client/src/sim.js`
  - `PLAYER_MAX_SPEED = 30` at `sim.js:357`; the velocity clamp at `sim.js:438-441`.
  - `update(dt)` at `sim.js:380`; early-return guard at `sim.js:381`; OOB/warp-back at `sim.js:453-` (uses
    `ARENA`, `arenaCenter`, `warpPlayerToCenter` around `sim.js:329`).
  - Autopilot: `autopilotControl` at `sim.js:246`, `autopilotTargetPos` at `sim.js:238`, `engage`/
    `engageAutopilot`/`engageDropAutopilot` at `sim.js:277-288`; `G.autopilot` shape in
    `client/src/state.js:71` (`{active, phase, target}`).
  - `settleView(dt)` at `sim.js:834` — the **view layer** (camera + sky/stars parallax + `updateMoons`).
    All new per-frame backdrop/speed-field updates hang off here (NOT the deterministic tick).
  - `reset()` at `sim.js:874` (clears entities, rebuilds set-pieces, recenters arena).
- **Input / raycasts:** `client/src/main.js`
  - `engageObjectAt(e)` at `main.js:339`, canvas `click` handler `main.js:349`, `eventNdc` at `main.js:321`.
  - Mini-map canvas is `#minimap` (`client/index.html:243`); drawn by `updateMiniMap` at
    `client/src/hud.js:347`.
- **Base menu:** `client/src/mainwindow.js`
  - `selectMenu(which)` at `mainwindow.js:111`; `STUB_SECTIONS = ['map','craft']` at `mainwindow.js:110`;
    `renderStub` at `mainwindow.js:135`. The *Map* menu button is `client/index.html:59`
    (`data-mw="map"`), stub host `#mw-view-stub` (`client/index.html:99`).
  - Mission launch: `launchCampaign`/mission activate flow around `mainwindow.js:362-392`
    (`G.activeMission = m.descriptor`). Side-mission descriptors come from `server/src/missions.js`
    (`FLAVORS` at `missions.js:48-52` — `mining` center `(-550,0)`, `research` `(400,0)`, `freighter`
    `(-100,-450)`; ids `side-mining|side-research|side-freighter`).
- **Map descriptor (data):** `server/src/catalog_seed.js` — the single `home-system` map at
  `catalog_seed.js:647`; `planet` at `:668`, `moons` at `:669-672`, `asteroids` at `:676`, `setpieces`
  at `:681-711` (`asteroid-field` `(-550,-100,0)`, `research-station` `(400,-125,0)`, `freighter`, and
  `base-station` `(-60,-42,-60)`).
- **Drive derivation:** `deriveDrive` at `client/src/components.js:30` — `acceleration =
  engine.power × massFactor`. Ion engine = component id 16 (`catalog_seed.js:80-82`, `power 27`,
  `maxSpeed 14`). `IDLE_DRAG = 0.8` at `sim.js:354` (only when controls released).

---

## Decisions (answers baked in — do not re-ask)

1. **In-battle vs out-of-combat map opener.** During a **live fight** the `#minimap` stays exactly the
   battle radar — **no change, no map opener**. Out of combat (roam / return-to-base) a **tap/click on
   `#minimap` opens the system-map screen** (context-sensitive control). The base-menu **Map** section
   opens the **same** screen.
2. **Map screen freezes the game** while open via a **raw render-loop skip** (a new `G.mapOpen` flag the
   loop treats like `G.paused`) — **NOT** `setPaused()`, which would stack the "Paused"+Play overlay and
   `body.paused` under the map. Fully interactive out of combat / at base (pick destination → autopilot
   engages on close). During an active fight it is **view-only** (destinations shown, "fly here" disabled).
3. **Autopilot = navigation + a prompt.** It flies the real ship to the picked point. On arrival at a
   **mission** destination show a **"Start mission?"** confirm → **Yes** launches via the existing
   mission/Take-off flow; **No** leaves the ship parked. Arriving at non-mission points (base / decor)
   just parks. **Never auto-start a fight.**
4. **Speed cap is lifted only in roam, only outside all activity zones.** Entering a **zone radius**
   (`ZONE_RADIUS`, provisional `= ARENA = 360`, tunable) around any activity center (base / science /
   each mining base / active-mission center) re-applies `PLAYER_MAX_SPEED` + full §2 inertia. In a normal
   fight (`!G.roam`) the ship is **always capped** exactly as today → **all recorded replays stay
   byte-identical** (roam is never recorded). Simple proximity check in `update()`, no sim arrays, no RNG.
5. **Bodies render as sky-backdrop, not literal to-scale spheres.** Same rendering family as today's
   `planet`+`moons` (skyScene, parallax), at readable ~constant on-screen size (star ~20% larger). The
   backdrop **re-projects each body by its true bearing from the player** so flying toward a planet brings
   it forward while the previous one recedes, and the star drifts across the sky. **"To-scale" applies to
   the travel distances / world coordinates only.** The old single planet + 2 moons are folded into this
   scheme (planet 2 = the base planet); the standalone moons are dropped for now.
6. **Coordinates stay Float32-safe → no floating-origin** (compact system; see the sizing math). Future
   multiplayer = one star system per server = one shared coordinate space.
7. **Geometry tunables live in a new client module** `client/src/system-map.js` (fast live-tuning, DECISIONS
   §30) for Stages 1-3; the tuned values are migrated into the `home-system` descriptor in Stage 4 so the
   scene stays data-driven. The **speed-field is descriptor-driven from `d.asteroids`** from the start.

---

## The world model

### Coordinate frame

Keep the **base neighborhood at world origin**: planet 2 (our base planet) sits at/near `(0,0)`, so
`arenaCenter`, the existing set-pieces and `missions.js` centers stay origin-relative — **no rewrite of
combat/mission code**. The **star and the other three planets are placed at fixed session world positions**
derived from wall-clock (below), treating planet-2-at-origin as the reference frame. Within a session
orbital motion is imperceptible, so bodies are effectively static per session but their **bearings are
live and correct**.

### Sizing math (provisional — Stage-1 live-tune target)

Out of combat the cap is lifted, so travel distance over 120 s is governed by acceleration + §2 inertia,
not a top speed. Autopilot (and a sensible manual crossing) is an accelerate-then-brake (bang-bang) profile:

- Ion engine `power 27`, `massFactor ≈ 1` → `accel a ≈ 25 u/s²` (verify in-build; it is
  `G.player.acceleration`).
- Bang-bang over `t = 120 s`: distance `d = a·(t/2)² = 25 · 60² ≈ 90,000 u`; peak speed at midpoint
  `= a·(t/2) = 1500 u/s`.
- **Orbit-4 diameter ≈ 90,000 u → orbit-4 radius ≈ 45,000 u.** Scale orbits 1-3 inside that (provisional:
  orbit radii ≈ `9k / 15k / 30k / 45k`; planet 2 = orbit 2 ≈ 15k). **These are starting values — the
  maintainer live-tunes them in Stage 1 using the on-screen speed/position readout; do not treat them as
  final.**
- **Float32 safety:** farthest body ≈ orbit-4 radius + planet-2 offset ≲ ~50,000 u. Float32 relative
  precision `2^-23 ≈ 1.19e-7` → absolute jitter at 50,000 u ≈ **0.006 u** (sub-centimeter vs a ~2 u ship).
  **Safe with wide margin, no floating-origin.** Record the **final** measured orbit-4 diameter + resulting
  `max |coord|` in the DECISIONS entry after Stage-1 tuning.

### Anchored bodies (swing with planet 2)

Base station, science station and the **near** mining base share planet-2's orbital angle. Compute their
world positions once at build time as `planet2.worldPos + rotate(localOffset, planet2.angle)`:

- **Base station:** anchored to planet 2 exactly as today — keep its current relative placement (the
  existing `base-station` set-piece near origin).
- **Science station:** on a radius **between orbit 1 and 2** (always inside planet-2's orbit), at
  planet-2's angle, placed at **2× its current distance from planet 2**. Current `research-station` is at
  `(400,-125,0)`; base at `(-60,-42,-60)` → current planar distance ≈ **464 u** → new ≈ **~928 u** from
  planet 2, on the star-ward side. (The `research-station` set-piece is the science station.)
- **Near mining base (active asteroids mission):** in the belt (just outside orbit 2), at planet-2's
  angle, at **2× its current distance from planet 2**. Current `asteroid-field` at `(-550,-100,0)` →
  planar distance ≈ **494 u** → new ≈ **~988 u**, on the anti-star side. Keep the existing up-close
  `asteroid-field` .glb rigs here (unchanged model).
- **Other two mining bases:** decor "in the belt" — for now they are **markers on the system-map screen
  only** (no 3D world set-piece); distant 3D placement is deferred (see Non-goals).

### Orbital motion (wall-clock, replay-safe)

`bodyAngle(name, tNow) = phase0[name] + 2π · (tNow − EPOCH) / periodMs[name]`, with periods **1 / 1.5 / 2 /
2.5 real days** for planets 1..4 and a **fixed `EPOCH` constant** (a hardcoded ms timestamp). `tNow =
Date.now()`. Pure function in `system-map.js`; consumed **only** by the view layer (buildMap for placement,
settleView for bearings). **Zero sim RNG, never sent to the server, replay-neutral** (§73).

---

## The backdrop render model (Q5 — the core visual read)

Render the star + 4 planets in **skyScene** as camera-anchored billboards at a large fixed radius (reuse
the stars radius scale, ~400) and **roughly constant apparent size**, positioned by **bearing from the
player to the body's true world position**:

Per frame, in `settleView` (after the existing camera/sky update at `sim.js:834-842`), for each body:

1. `dir = normalize(bodyWorldPos.xz − player.pos.xz)` (planar bearing).
2. `skyDir = normalize(vec3(dir.x, ELEV, dir.z))` — `ELEV > 0` lifts bodies above the horizon so they read
   as sky (tune for the near-top-down camera; `CAM_OFFSET` looks down-and-forward). Provisional `ELEV ≈
   0.6`, live-tuned.
3. `mesh.position = camera.position + skyDir · SKY_DIST`. Face the camera (billboard) — or keep the
   sphere+texture look like today's planet (a lit sphere in skyScene reads fine at fixed size).
4. **Apparent size ~constant**, with a mild distance modulation for legibility: scale `= baseSize ·
   clamp(nearBoost(dist), 0.85, 1.25)` and opacity easing so the body you approach looms slightly while a
   far one softens (never shrinks to a dot). Star `baseSize` ≈ 1.2× a planet's.

The bearing projection alone sells "flying across a real system": fly right and a body ahead-left swings
left; **pass a planet and its bearing flips ~180° (it moves behind you)**; the star drifts across the sky
as you move around the system. Cheap: one direction calc + position/scale write per body per frame (≤5
bodies), pure view layer → replay-neutral.

Keep the baked nebula/star cubemap (`makeNebulaSky`) unchanged. Drop the two standalone `moons` (fold into
the planets); `updateMoons` is superseded by the new `updateSystemBodies(dt)` called from `settleView`.

---

## State model: base ↔ roam ↔ combat (minimal — DECISIONS §30)

Today the 3D world is entered ONLY via `launchCampaign()` (`mainwindow.js:70`) / `launchMission(m)`
(`mainwindow.js:391`) → straight to a fight (`reset()` → `levelRunner.start`, `sim.js:941`), or the intro
replay. **Roam** is the new *interactive out-of-combat flight state* — the 3D world up, player
controllable, **no `levelRunner` running, no enemies**. It is a real player state (`G.roam`), not just the
`?roam` dev flag.

### `G.roam` and the roam-aware `reset()`

- `G.roam = false` in `client/src/state.js` (near `gameStarted`, `state.js:65`).
- **Factor a shared `resetLevelRunnerState()` helper out of `levelRunner.start()`** so BOTH `start()` and
  the roam branch clear the same runner + return-to-base state. `start()` (`sim.js:76-82`) is the ONLY
  place (besides `win()`) that clears `won`/`winPending`/`returningToBase`/`G.returnToBase`/
  `G.baseStation.active`; a roam `reset()` that merely *skips* `start()` would leave a **prior mission
  win**'s `levelRunner.won = true` (set in `win()`, `sim.js:130`) — and `update()` early-returns while
  `won` (`sim.js:381` + `:168`), freezing the roaming ship (settleView/speed-field/backdrop never tick).
  Conversely clearing only `won` but leaving `levelRunner.level` non-null would let `levelRunner.update()`
  run its staggered-spawn logic → **enemies spawn in roam**.
  - New method on `levelRunner` (move these exact lines out of `start()`, which then calls it after
    `this.level = level;`):
    ```
    resetLevelRunnerState() {
      this.phaseIndex = 0; this.won = false; this.winPending = 0; this.returningToBase = false;
      G.returnToBase = false; G.autopilot.active = false; G.autopilot.target = null;
      if (G.baseStation) G.baseStation.active = false;
      firedBanners.clear(); G.banner.life = 0;
    }
    ```
    (These are precisely `sim.js:77` minus `this.level=`, `:79-82`. Confirmed against the code:
    `won`/`winPending`/`returningToBase` at `levelRunner:73-74`; `win()` sets `won` + return-state at
    `:130-134`; `update()` guards on `!ph || won` at `:168` where `phase` is null when `level` is null.)
- In `reset()` (`sim.js:874`) branch on `G.roam`:
  - **Combat (`!G.roam`, unchanged):** `levelRunner.start(G.activeMission || CATALOG.level);` at `:941`
    (its first act is `this.level = level; this.resetLevelRunnerState(); …`).
  - **Roam:** replace the `start(...)` call with `levelRunner.level = null; levelRunner.resetLevelRunnerState();`
    → `phase` is null → `levelRunner.update()` early-returns → **no spawns**; `won` is false and
    return-to-base state is cleared → `update()` runs and the ship flies. Also skip the ghost-battle build
    (`sim.js:918-920`) when `G.roam` (keep roam clean/cheap).
  - Everything else in `reset()` runs (clear entities, rebuild set-pieces, respawn the player at
    `arenaCenter`, warm the scene). In roam `G.activeMission = null` → `cx,cz = 0` → the player spawns at
    planet 2 (origin). `beginLiveSession()` is **not** called in roam (roam is unrecorded — see the invariant).
  - Note ordering: `resetLevelRunnerState()` clears `G.autopilot`, so `enterRoam` calls
    `engagePointAutopilot(...)` **after** `reset()` returns (it already does).

### `enterRoam(dest)` — the ONE entry point (add to `mainwindow.js`)

Mirror `launchMission`'s menu-teardown (`mainwindow.js:392-403`) but without a mission/level:

```
export async function enterRoam(dest /* {pos:{x,z}, missionId} | null */) {
  G.activeMission = null; G.pendingBriefing = null;
  if (Device.hasTouch) requestFullscreen();
  mainEl.classList.remove('on'); document.getElementById('welcome').style.display = 'none';
  stopShipPreview(); stopLoadoutPreview(); settleBriefingReveal(); stopViewer(mwItem);
  document.body.classList.remove('menu');
  await refreshMissions();          // ensure missionOffers is current for arrival prompts (see Stage 3)
  G.gameStarted = true; G.roam = true;
  reset();                          // rebuilds world + player at planet 2, NO levelRunner (G.roam guard)
  if (dest) engagePointAutopilot(dest.pos, dest.missionId || null); // else: free manual cruise
}
```

- **ENTRY (base-menu Map, Stage 2a):** the Map view gets a **"Launch into system"** button →
  `enterRoam(null)` (free manual uncapped cruise), and each **reachable** destination gets **"Fly here"**
  → `enterRoam({pos, missionId})` (drops into roam + autopilots there). These two actions satisfy "manual
  cruise + mid-journey re-route": once in roam, the **in-world map overlay** re-routes without re-entering.
- **EXIT:**
  - **Start a mission** — the arrival "Start mission?" → Yes handler does `G.roam = false;
    launchMission(offer);` (Stage 3a). Clearing `G.roam` first makes `reset()` start the `levelRunner`.
  - **Return to base** — the in-world map overlay has a **"Return to hangar"** button →
    `G.roam = false; G.gameStarted = false; document.body.classList.add('menu'); showMain(null);` (back to
    the base menu exactly as today).
  - **After a mission ends** — the existing win/lose flow (`leaveOverlay`, `mainwindow.js:85-101`) lands on
    the base menu (`showMain`) as today; `G.roam` is already false. **Roam is re-entered fresh from base —
    no roam-position persistence in v1.**

### Replay invariant (unchanged, re-verified for roam)

Only `enterRoam` and the `?roam` dev flag ever set `G.roam = true`; `launchCampaign`/`launchMission` never
touch it (the mission-arrival path sets it *false* before launching). Every recorded/campaign trace runs
with `G.roam = false` → `capLifted` false → **byte-identical replays**, and `beginLiveSession()` is skipped
in roam so roam is never recorded.

---

## Stage 1 — Flyable roam sandbox (SHIP THIS FIRST)

Goal: a build the maintainer can fly to tune **sizing, speed-field, autopilot feel** — with **no changes
to the campaign/mission launch flow**. Entered via a dev flag so the normal game is untouched.

### 1a. Roam state + `?roam` entry

- `G.roam` + the roam-aware `reset()` (the `resetLevelRunnerState()` helper called instead of
  `levelRunner.start()`, plus the ghost-battle skip) are defined in the **State model** section above.
- In `client/src/main.js` bootstrap, add a `?roam` dev hook (mirror the `?debug`/`?bench` convention):
  after `buildMap`, build the player ship, set `G.gameStarted = true`, `G.roam = true`, then `reset()` —
  which now spawns the player at planet 2 with **no enemies** (the `!G.roam` guard skips `levelRunner`).
  Player is fully controllable. (This dev entry is separate from `enterRoam`, which is the real
  base-menu path; both land in the same `G.roam` state.)
- `update()` (`sim.js:380`) runs in roam (guard at `:381` passes: alive, gameStarted, `levelRunner.won`
  false).

### 1b. Uncapped travel + zones + OOB gating (the replay-critical change)

Add a pure module seam and wire it into `update()`:

- **New pure helpers** in `client/src/system-map.js`:
  - `inActivityZone(px, pz, zones, radius)` → boolean (any zone center within `radius`).
  - `capLifted({ roam, inZone })` → `roam && !inZone` (the invariant that protects replays: **false
    whenever `roam` is false, regardless of position**).
- In `sim.js` `update()` velocity clamp (`:438-441`): compute
  `const inZone = inActivityZone(p.x, p.z, activityZones(), ZONE_RADIUS);`
  `const lifted = capLifted({ roam: G.roam, inZone });`
  and **skip the clamp when `lifted`** (otherwise clamp exactly as today).
- `activityZones()` returns the base + science + near-mining + (active mission center if any) centers.
  Provisional `ZONE_RADIUS = ARENA (360)`, exported tunable from `system-map.js`.
- **OOB / warp-back gating** (`sim.js:453-`): only run the OOB warn + `OOB_RETURN_TIME` warp when a fight
  is active (`!G.roam`). In roam the player must be able to fly arbitrarily far — **the current
  `±ARENA → warp home` would instantly yank a roaming ship back**. Hide `arenaBorder.line` in roam.
- `PLAYER_MAX_SPEED` stays 30; `maxSpeedMul` unchanged. When `lifted`, no clamp → §2 inertia grows the
  speed as designed.

Because `capLifted` is `false` for every non-roam session and roam is never recorded, the deterministic sim
is **byte-identical** for the intro trace and all `?playback`/`gameplay_sessions` replays.

### 1c. Speed-field (replaces `makeAsteroids`/`rocks`)

- **New module** `client/src/speed-field.js`:
  - `makeSpeedField(cfg)` → a small set (**2-3 layers**) of `THREE.Points`, each a fixed pool
    (**~400-600 total, tunable**) distributed in a box of half-extent `R` around the player, at layer
    depths/sizes for parallax. Additive, `fog:false`, a **procedurally generated round dot texture**
    (canvas radial-gradient alpha sprite — **no image asset, no CREDITS.md change**).
  - `updateSpeedField(playerPos, camera)` — called **every frame from `settleView`** (view layer): recenter
    each layer on the player and **wrap each point into `[-R, R]` relative to the player** (points that fall
    outside wrap to the opposite side). Slower parallax layers wrap against a scaled player delta.
  - Extract the wrap arithmetic into a **pure `wrapCoord(v, center, R)`** (unit-tested).
  - **Velocity-stretch is out of scope** — leave a clean hook: accept an optional `velocity` param and a
    `// TODO: velocity-stretch/warp-streak hook` where a future shader could elongate points along `vel`.
  - **Per-map color/density from the descriptor `d.asteroids`** (`catalog_seed.js:676`): map
    `count`→pool size, `color`→tint; add optional `d.asteroids.layers` later. Read it in `buildMap`.
- In `world.js` `buildMap` (`:822-823`): **remove `rocks = makeAsteroids(d.asteroids); scene.add(rocks)`**
  and instead build the speed-field: `G.speedField = makeSpeedField(d.asteroids); scene.add(G.speedField)`.
  Delete `makeAsteroids` (`world.js:428-450`) and the `rocks` module var (`world.js:761`). Grep the concept
  words **`makeAsteroids`** and **backdrop `rocks`** across `client/`, docs, and visual scenarios and
  reconcile every reference (see the gate).
- Add `G.speedField` to `state.js` and dispose/rebuild it in `buildMap` (mirror the old `rocks` lifecycle).
- Call `updateSpeedField(...)` from `settleView` (`sim.js:834`).

### 1d. Backdrop system bodies

- **New helpers** in `system-map.js`: `SYSTEM` geometry constants (star + 4 planets: `orbitR`, `phase0`,
  `periodDays`, `color`, `size`, `ocean?`; belt inner/outer; anchored offsets; `EPOCH`; `ELEV`,
  `SKY_DIST`, `baseSize`s — all tunable), plus pure `bodyWorldPos(name, tNow)` and
  `listBodies()`/`listDestinations()`.
- In `world.js`: replace the single-planet + moons build (`:803-820`) with
  `buildSystemBodies(descriptor.system ?? SYSTEM)` — build the star + 4 planet meshes (reuse
  `makePlanetTexture`/`makeMoonTexture`; the star = an emissive sphere + glow sprite) into `G.sky`
  (skyScene). Keep planet 2 the ocean planet (reuse `d.planet.ocean`).
- **New `updateSystemBodies(dt)`** in `world.js` (replaces/rename `updateMoons`): implements the bearing
  projection (see the render model). Call it from `settleView` in place of `updateMoons(dt)` (`sim.js:841`).
  **Also fix the import:** `sim.js:10` imports `updateMoons` from `world.js` — switch that import to
  `updateSystemBodies` (or re-export a compat alias), not just the call site, or the build breaks.
- Drop `d.moons` usage; keep the descriptor keys until the Stage-4 migration.

### 1e. Tuning readout (temporary, dev-only)

- Add a `?roam`-only HUD line showing `speed | pos(x,z) | dist-to-orbit-4-edge | in-zone?` so the
  maintainer can measure the actual 120-s crossing and dial `SYSTEM` radii + `ZONE_RADIUS` +
  speed-field density/parallax. **Also expose the backdrop `ELEV`/`SKY_DIST`/`baseSize` for live tuning**
  here — whether the bearing-projected bodies actually read on the **near-top-down camera** is the known
  visual risk this early build exists to de-risk, so keep them tweakable in the `?roam` build. Gate
  strictly behind `?roam` (like `?dev`), removed/ignored in the shipped path.

**Deliverable:** load `?roam` → fly around the system near planet 2, out toward the belt/other planets;
watch the speed-field streak past and the star/planets swing by bearing. Hand off for live tuning.

---

## Stage 2 — System-map screen + autopilot-to-point

### 2a. System-map screen

- **New module** `client/src/systemmap-ui.js`: `renderSystemMap(hostEl, { interactive })` draws a top-down
  overview onto a canvas — star at center, the 4 orbit circles with planets at their **wall-clock**
  positions (`bodyWorldPos(name, Date.now())`), the belt ring, the 3 mining-base markers, the science
  station, our base, and the **player position** (a heading triangle). The **active mission is
  highlighted** (larger/colored marker + label). Returns picked destinations via a callback.
- Reuse it in **two hosts**:
  - **Base-menu Map (entry to roam):** make `map` a real section. In `mainwindow.js` `selectMenu` (`:111`)
    remove `map` from `STUB_SECTIONS` (`:110`), add a `mw-view-map` branch + host (new `#mw-view-map` in
    `client/index.html` beside `#mw-view-stub` at `:99`), call `renderSystemMap(host,{interactive:true})`.
    The Map view carries a **"Launch into system"** button → `enterRoam(null)` and, per **reachable**
    destination, a **"Fly here"** button → `enterRoam({pos, missionId})` (see the State-model section).
  - **In-world overlay (re-route while roaming):** new `#systemmap-overlay` (DOM). Opened by a mini-map
    tap **only out of combat**; selecting a destination + closing calls `engagePointAutopilot(...)`
    directly (already in roam — no re-entry). Also carries the **"Return to hangar"** exit button.

### 2b. Open/close + freeze

- In `main.js`, add a `#minimap` `click` + slop-gated touch handler that calls `openSystemMap()` **only
  when out of combat** (`G.roam || G.returnToBase`) — during a live fight the minimap stays the radar
  (no-op). Reuse the existing tap-slop gating pattern (`tap-gesture.js`).
- `openSystemMap()` → show `#systemmap-overlay` + **freeze via a raw loop-skip**: set a new `G.mapOpen =
  true` (add to `state.js`) and, in the `main.js` render loop, skip `update()` when `G.paused || G.mapOpen`
  (find the existing `G.paused` skip in the loop and widen it). Do **NOT** call `setPaused()` (`sim.js:850`)
  — it toggles `el.pauseOverlay` ("Paused"+Play) and `body.paused`, which would stack the pause UI under
  the map. `closeSystemMap()` → hide overlay + `G.mapOpen = false`. In an **active fight** the overlay is
  view-only (no "fly here"/"Return"; still freezes so it reads as a paused overview).

### 2c. Autopilot to a point

- Extend the autopilot in `sim.js`:
  - `G.autopilot.target` gains a new kind `{ kind:'point', pos:{x,z}, mission?:<missionId|null> }`.
  - `autopilotTargetPos()` (`:238`) returns `pos` for `kind:'point'`.
  - New `engagePointAutopilot(pos, mission)` — allowed out of combat (`G.roam || G.returnToBase`), not
    during a live fight. Reuse `engage({kind:'point', pos, mission})` (`:286`). `enterRoam` sets
    `G.roam = true` **before** calling it, so the gate passes.
  - The existing `autopilotControl` (brake → rotate → cruise → kinematic brake, `:246-274`) already flies
    to any target and its `stopDist = v²/(2a)` brake handles the high uncapped cruise speed. **Any manual
    input still cancels** (`:408`) — this is the mid-journey manual override.

**Guard:** `canDock` (`autopilot-config.js`) still fires the **win** only for `kind:'station'` — a `point`
autopilot never completes a mission by proximity (Stage 3 handles the arrival prompt).

---

## Stage 3 — Mission-arrival prompt + orbital motion polish

### 3a. Arrival detection + "Start mission?" prompt

- New pure `arrivedAtPoint(pos, playerPos, radius)` in `system-map.js` (unit-tested;
  provisional `ARRIVE_RADIUS` reuse `BASE_ARRIVE_RADIUS`-scale).
- **Descriptor source (concrete).** The prompt does NOT build a descriptor — it reuses the exact
  mission-offer the base menu would launch. `missionOffers` (exported `let` in `mainwindow.js:33`,
  populated by `refreshMissions()` at `:372`, server-gated on `sideMissionsUnlocked`) is refreshed by
  `enterRoam` on entry (the `await refreshMissions()` in the State-model snippet), so it is current at a
  roam arrival. The arrival handler imports `missionOffers` + `launchMission` from `mainwindow.js` and does:
  `const offer = missionOffers.find(o => o.id === missionId);`.
- When a `kind:'point'` autopilot **carrying a `mission` id whose offer EXISTS** reaches `ARRIVE_RADIUS`
  and comes to rest: clear the autopilot and show a **"Start mission?"** confirm overlay (EN + RU i18n
  keys, e.g. `ui.systemmap.startMission.*`). **Yes** → `G.roam = false; launchMission(offer);` (the
  existing path: `G.activeMission = offer.descriptor` → `reset()` → `levelRunner.start`, `mainwindow.js:391`).
  **No** → park (stay in roam). **Points with no mission id, OR a mission id with no offer** (locked / not
  yet unlocked / stale) → just **park, NO prompt**.
- Keep coupling minimal: the map's mission markers map to `side-mining`/`side-research`/`side-freighter`;
  the prompt reuses the same offer object the base-menu board launches.

### 3a-bis. Locked / not-offered mission markers

- The system-map always **draws** the 3 mining bases + science station markers, but a mission marker is
  **interactive** (shows "Fly here" and can trigger the arrival prompt) **only when its offer exists**
  (`missionOffers.some(o => o.id === markerId)` — i.e. `sideMissionsUnlocked`, L≥4). Compute this in
  `renderSystemMap` from the imported `missionOffers` + `G.activeShip.sideMissionsUnlocked`.
- **Locked / not-offered markers render greyed + a lock hint** (tooltip/label, e.g. "Unlocks at Level 4",
  i18n `ui.systemmap.locked`) and are **not selectable as a mission destination**. Autopilot MAY still fly
  to that world location if picked as a plain point (it is a place), but **no "Start mission?" prompt
  appears** (the arrival handler above only prompts when an offer exists).
- The **active mission** is highlighted (larger/colored marker + label), unchanged from Stage 2a.

### 3b. Wall-clock body placement in build

- `buildSystemBodies` computes each body's world position from `bodyWorldPos(name, Date.now())` at build
  time; anchored bodies (base/science/near-mining) use planet-2's angle. Bearings update live in
  `updateSystemBodies`. (Per-session static, cross-day drift — imperceptible and correct.)

---

## Stage 4 — Data migration, docs, tests, baselines

- **Migrate tuned geometry into the descriptor.** Move the final `SYSTEM` constants into a `system` block
  on the `home-system` descriptor in `server/src/catalog_seed.js` (after `:711`), and have
  `buildSystemBodies`/`system-map.js` read `descriptor.system` with the client `SYSTEM` as the fallback
  (mirror the `NEBULA_ICEBLUE` fallback pattern). Update `d.asteroids` if the speed-field needs new keys.
  Reseed locally (`server` npm start / reset re-seeds).
- **Update the mission `center`s in `server/src/missions.js` (`:49-51`) — MANDATORY, not conditional.**
  The near-mining and research (science) placements DO move (2× their current distance from planet 2 + a
  new star-relative direction), so their `center`s change. Enforce this invariant explicitly and keep it
  true in one pass: **map-marker position == set-piece `pos` (`catalog_seed.js` `home-system`) == missions.js
  `center` == the activity-zone center used by `activityZones()`** — all four are the same (x,z) per body
  (the `missions.js:56-61` comment already requires center == set-piece; the zone + map marker now join
  it). If any diverge, enemy spawns / the zone / the map / the fight location desync. (Freighter is out of
  scope — leave its center as-is.)
- Docs + tests + baselines (below).

---

## Tests

Run `cd client && node --test` and `cd server && npm test` (Postgres; `pretest` drops+recreates
`spacegame_test`). Add:

- **`client/src/system-map.test.js`** (new, pure — the testable seam):
  - `bodyWorldPos(name, tNow)` is deterministic for a fixed `tNow`; angle advances correctly over one
    period; `Date.now`-free.
  - **`capLifted({roam:false, inZone:false}) === false`** and stays false for every `inZone` — the
    replay-protection invariant (the bug this guards: a position-based cap that could desync replays).
  - `inActivityZone` boundary behavior; `arrivedAtPoint` predicate.
  - **Float32 bound:** `max |coord|` over all bodies ≤ the Float32-safe threshold (assert ≤ ~1e5).
- **`client/src/speed-field.test.js`** (new, pure): `wrapCoord(v, center, R)` keeps results within
  `[center−R, center+R]` and wraps monotonically.
- **Visual:** new `client/visual/scenarios/31-star-system.mjs` (28- collides with the existing
  `28-scene-warm.mjs`; highest current is 30-) — load `?roam`, assert the speed-field
  `THREE.Points` exist, ≥5 backdrop bodies exist, autopilot-to-point reaches a point, **zero page errors**.
  - **Post-win roam guard (the regression this revision fixes):** simulate a mission `win()` (set
    `levelRunner.won = true` + return-to-base state), then enter roam via `enterRoam(dest)` and assert
    **`levelRunner.won === false`** (so `update()` no longer early-returns), the **player position advances
    under autopilot** over a few frames, and **`enemies.length === 0`** (no spawns leak into roam). This
    catches both failure modes of a naive `!G.roam` skip (frozen ship / roam enemies).
- **Replay guard (must pass UNCHANGED):** `node visual/run.mjs 22-intro-replay` → still 4 kills, cards
  p0..p4, win. (roam off in the trace → cap always applied → byte-identical.)
- **Regenerate, intentionally,** any visual baseline that captured the old origin-ring asteroid backdrop
  (the speed-field + system bodies change those frames). Judge the suite by the **reliably-passing set +
  zero page errors** (≈6 scenarios flake at baseline — not regressions).
- **Server:** if `missions.js` centers or `catalog_seed.js` change, run `server && npm test` (mission
  generation test at `server.test.js:853`).

---

## Docs to update (in the worktree)

- **`docs/SUMMARY.md`:** bump `**Updated:**`. Rewrite the **Visuals** asteroid bullet (`~SUMMARY.md:1339-1355`)
  — the origin-ring `makeAsteroids`/`rocks` layer is replaced by the player-locked wrapping speed-field
  (`speed-field.js`, view-layer, descriptor-driven). Rewrite the planet/moons lines (`:1339-1373`) for the
  star + 4-planet **bearing-projected backdrop** (`system-map.js`, `buildSystemBodies`/`updateSystemBodies`).
  Add a **Star system / navigation** subsection under Gameplay: roam mode, uncapped-outside-zones travel,
  activity zones + `ZONE_RADIUS`, the system-map screen (base-menu Map + out-of-combat mini-map tap),
  autopilot-to-point + the mission-arrival prompt. Update **Controls/Autopilot** (`:155-168`) for the
  `point` target kind. Update **Client module layout** (`:2204+`) with the three new modules.
- **`docs/CHANGELOG.md`:** one dated bullet under today — flyable to-scale star system + autopilot via
  system-map, uncapped out-of-combat travel with re-cap zones, speed-field replacing the backdrop asteroid
  ring, bearing-projected backdrop bodies; replay-neutral; supersedes §71.
- **`docs/DECISIONS.md`:**
  - **§94 is already updated** (autopilot-via-map) — do not duplicate; reference it.
  - **Mark §71 superseded** (add a "SUPERSEDED by the speed-field, see §NN" note at
    `DECISIONS.md:2461`): the distant backdrop is now the procedural point-sprite speed-field, not the
    procedural icosahedra ring.
  - **Add §95** (next free number — verify): the **coordinate/rendering model** — compact Float32-safe
    system (record the **final measured** orbit-4 diameter + `max |coord|` after tuning), no
    floating-origin, one-system-per-server for MP; and the **bearing-projected sky-backdrop** bodies
    ("to-scale distances, constant apparent body sizes"); geometry tunables in `system-map.js` migrated to
    the descriptor.
- **This plan file** stays the brief of record.

---

## Out of scope / non-goals (DECISIONS §30 — do not gold-plate)

- **Velocity-stretch / warp-streak** on the speed-field — leave the hook only.
- **The two far mining bases as 3D world set-pieces** — system-map markers only for now.
- **Freighter route / repositioning** — leave the freighter as-is (deferred to ROADMAP).
- **Proximity/lazy rendering of distant bodies; distance-culling / broad-phase** — few objects, combat
  local, decor not in sim arrays.
- **Recording roam sessions** — roam is not captured (like side-mission retries).
- **Reworking the campaign Take-off** — campaign launch stays direct-to-fight; roam + map + autopilot are
  the exploration/side-mission path.
- **Collidable bodies** — all system bodies stay non-collidable decor.
- **New .glb/image/sound** — none. The speed-field texture MUST be procedural (canvas). If any binary
  asset becomes necessary, **STOP and ask about `client/assets/CREDITS.md`** (CLAUDE.md rule).

---

## Consistency gate (run before finishing)

1. `node visual/run.mjs 22-intro-replay` passes unchanged (4 kills, p0..p4, win).
2. `cd client && node --test` and `cd server && npm test` green.
3. Grep the concept words **`makeAsteroids`**, backdrop **`rocks`**, and **`updateMoons`** across
   `client/`, `docs/`, `client/visual/` — no stale reference to the removed origin-ring backdrop or the
   dropped moons remains.
4. Confirm `capLifted` is `false` in every non-roam path (unit test + read the clamp site) so replays are
   byte-identical.
5. English only; no new binary asset (speed-field texture is procedural).
6. Re-scan the plan's own prose for any line that still describes the old backdrop or a capped roam.
