# Server-authoritative combat simulation

> **Status:** agreed slicing, in progress on `feature/server-sim` (worktree `../ag-wt/server-sim`).
> Started 2026-08-19. **Local testing only — nothing ships to prod or itch until the maintainer says so.**
>
> Supersedes the netcode sequencing in `docs/plans/multiplayer-architecture.md` (2026-07-25). That brief's
> audit is still accurate; its Phase 1–4 ordering is replaced by Slices A–E below, and three of its "open
> decisions" are now answered (see §2).
>
> Read first: `docs/DECISIONS.md` §16 (pause), §30 (keep processes simple), §45 (why `collision.js` is
> THREE-free), §73 (seeded sim-RNG contract). `docs/ROADMAP.md` Phase 5.

## 1. Goal

Move combat simulation to the server: Node owns the truth, the client sends input and draws. First cut is
**one player** in a **server-run mission instance** — spawning, enemy AI, projectile flight, collisions,
hits, HP and deaths all decided by the server, with client-side prediction of the local ship.

The first cut is **not** multiplayer. Rooms, matchmaking UI, PvP, shared roam, side missions, sealed
economy, reconnect and socket-draining on deploy are all explicitly out of scope.

**Every slice must leave single-player fully playable locally.** The maintainer plays between slices and
brings back feel notes; a slice that only produces green tests has failed its purpose.

## 2. Decisions taken (do not re-open)

### D1 — Single-player keeps running the sim locally in the browser

The netsim path is opt-in and additive. Single-player combat never requires a live socket.

Why:
- The failure mode changes qualitatively. Today a network blip costs an unbanked run; with a socket-bound
  fight, a blip kills the fight in progress.
- itch is served worldwide, the VPS is one box. 200–300 ms RTT is a loading delay today; it would become
  the feel of the controls.
- Load shifts from "tens of requests per session" to "N concurrent worlds at 60 Hz" on the same box that
  runs Postgres and static.
- **The decisive reason is engineering, not player experience:** with single-player on the browser host
  and multiplayer on the Node host, the two hosts running one module give a permanent, free divergence
  oracle — the same input trace must produce the same outcome on both, as a CI test. Route single-player
  through the server and the browser path atrophies; "one simulation" becomes a slogan within months.

The one genuine argument for server-side single-player — sealing the economy (`POST /api/games` is
client-authoritative) — is better served without a socket: the client already records every session as an
input trace, so the server can re-simulate a submitted trace headless with the same `sim-core` and seal the
reward itself. That is Slice C's infrastructure and a later slice's payoff.

### D2 — `World` context threaded through the sim, one process. Not worker-per-room.

There is no real choice: `client/src/state.js` cannot be imported in Node at all. Its module body runs
`resolveTier(loadTier(window.localStorage, Device.hasTouch))` (`state.js:19`) plus `Device` — it touches
`window` at import time. So `sim-core` can never reach the module singletons, and the `World` context is
paid the moment `sim-core` exists.

Therefore: `createWorld()` returns `{ tick, player, enemies, bullets, rockets, drops, rng, events, … }`
and every `step*` takes it as its first argument. The client's `state.js` stays exactly as it is — it holds
a reference to the single `World` it created, plus everything render-side (FX pools, `sky`, `stars`,
`setPieces`, `CATALOG`, `keys`). Cost for single-player: zero. Node gets N worlds in one process for free.

Worker-per-room is therefore unnecessary complexity (§30). It stays an escape hatch: with the `World`
context in place, "a worker holds several worlds" is a later, cheap change, not a rewrite.

### D3 — Decouple everything from Three.js, player included; FX stay behind

Half-decoupled is the worst state: if enemies carry `pos` while the player carries `mesh.position`, every
interaction (enemy aiming, `resolveHostileBulletHit`, autopilot, docking) needs a bridge that gets written
and then deleted. `stepPlayer` is also exactly what Slice E puts under prediction/reconciliation — leaving
it entangled means doing this work twice.

Out of scope for the decoupling: FX pools (`smoke`, `sparks`, `shockwaves`, `flipbooks`, `creditPopups`,
`banner`), `settleView`, exhaust, audio, `hud.js`. They are not simulation state.

`mesh.scale` stops being gameplay: `warping` / `spawnAge` / `spawnDur` become world fields and the scale
becomes a render consequence (`sim.js:679-687`, `:655-662`).

### D4 — Tick 60 Hz on both hosts; snapshot rate 15–20 Hz is a separate knob

The request was a 30 Hz server tick. Rejected, deliberately:

- Live play, every recording and the intro oracle run at `TICK_HZ = 60` (`client/src/bench.js`).
  Integration is dt-dependent (`vel *= 1 - DRAG*dt`, thrust accumulation, `spawnAge`), so 30 Hz in Node vs
  60 Hz in the browser produces **different outcomes for the same trace** — destroying the oracle from D1.
- Slice E has the client predicting at 60 while the authority steps at 30; the reconciliation error would
  be visibly worse for no gain.
- Upstream cost is negligible: `{tick, keys}` is a handful of bytes and can be batched 2–3 ticks per
  message. Simulating ~10 enemies and ~50 bullets at 60 Hz is microseconds per tick.

If per-room CPU ever becomes real, the tick drops **on both hosts at once** (one constant, `bench.js`),
by measurement. Downstream snapshot rate (15–20 Hz) is the knob that actually costs bandwidth and is tuned
independently.

### D5 — Lag compensation from day one; its main consumer here is aim-assist

The discarded 2026-08-19 spike measured an authority rejecting 14% of a non-authoritative client's hit
reports at zero added latency and 55% at 300 ms — the shooter aims where the target was ~400 ms ago.

Our shape mutes the classic version: the client sends **keys**, not a crosshair, and fire direction comes
from the ship's nose, which the server simulates itself. But two things do depend on where the client saw
the enemies:

- **Aim-assist target selection** — `findBulletAimTarget` / `findTargetInSector` (`projectiles.js:286`,
  `:310`) pick a target inside a cone from live enemy positions.
- **`touchAim`** is part of the input snapshot (`state.js:138`, `replay.js snapshotInput`).

So the server keeps a ring buffer of per-tick entity transforms (~1 s = 60 frames × a few dozen entities —
trivial) and resolves aim-assist selection and player-bullet hit tests against the rewound state at
`clientTick - (interpDelay + RTT/2)`, clamped. Built in Slice D, not deferred.

### D6 — Straight bullets travel as fire events; rockets stream transforms

Rockets home on a target (`sim.js:796-868`). The client renders **interpolated, stale** enemy positions, so
a locally re-simulated homing path diverges visibly. Straight bullets (`spawnBullet`) depend on nothing but
their own muzzle state → `fire` event + deterministic flight, as intended. Rockets stream their transforms
(a spiral volley is 1 leader + 3 warheads — nothing). Loot drops are server-owned and streamed.

## 3. Architecture

```
client/src/sim-core/          ← the ONLY implementation of the rules. No three, no DOM, no fetch, no audio.
  world.js                      createWorld() → the World context; entity collections; event queue
  vec.js                        ~50-line plain vec3 (replaces THREE.Vector3 in sim state)
  step-player.js  step-enemies.js  step-bullets.js  step-rockets.js
  damage.js  level-runner.js  spawn.js
  (moved in, unchanged rules) components.js steering.js spawn-timing.js collision.js
                              level-sim.js drops-config.js autopilot-config.js sim-random.js
```

Lives under `client/src/` because that is what actually gets served and packaged: the client is raw ESM via
`express.static(clientDir)` (`server/src/server.js:549`) and `build-itch` copies only
`client/{src,locales,assets}`. A root-level `shared/` would ship to neither. The server imports it by
relative path — it already computes `clientDir` (`server/src/server.js:50`).

**Two rules:**
1. `sim-core` decides; nothing else does. It is the same file in the browser and in Node.
2. `sim-core` never calls out. It appends to `world.events`; the host drains that queue and does whatever
   it does (client: FX, audio, event log, overlays, `net.js`; server: broadcast).

## 4. Slices

Baselines captured on `main` @ `24849f7` before any change (2026-08-19):
`client node --test` **342/342**, `server npm test` **137/137**. Visual guard set: see §7.

### Slice A — transform state on entities *(largest, riskiest)* — ✅ DONE 2026-08-19

Give every simulated entity plain state and make the sim read/write only that.

1. **`client/src/sim-core/vec.js`** — a minimal `{x,y,z}` helper (`add`, `addScaled`, `scale`, `len`,
   `setLen`, `copy`, `distTo`, `sub`) so `sim-core` never imports `three`.
2. **Entities carry `pos` / `vel` / `heading`.**
   - `ship-build.js buildPlayer` (`:43`) and `spawnEnemyShip` (`:118`) — `vel: new THREE.Vector3()` → plain
     vec; add `pos`.
   - `projectiles.js spawnBullet` (`:46`), `spawnRocket` (`:325`), the spiral warheads (`:367`),
     `drops.js spawnDrop` — same.
3. **Warp-in becomes sim state.** `warping`, `spawnAge`, `spawnDur`, `spawnScale` are world fields
   (`sim.js:679-687` for enemies, `:655-662` for the player). `mesh.scale` is written only by the renderer.
4. **`syncMeshes()`** — a single one-way pass in the render step: `pos → mesh.position`,
   `heading → mesh.rotation.y`, warp progress → `mesh.scale`, rocket `heading → obj.rotation.y`. Nothing in
   the sim touches a mesh afterwards. Cosmetic bank (`updateBank`, `sim.js:498`) moves to the render side.
5. **`collision.js` builds its own matrix.** It is already THREE-free math; it just needs 16 floats from
   somewhere. Replace `ship.mesh.updateMatrixWorld(); ship.mesh.matrixWorld.elements` (`:119-120`, `:144-145`)
   and `ship.mesh.scale.x` (`:21`, `:118`, `:143`) with a `shipMatrix(entity)` built from
   `pos + heading + sizeScale`. Same for `resolveHostileBulletHit` (`:188`) reading `player.mesh.position`.
6. **Render-side consumers switch to `.pos`:** `hud.js`, `shield-fx.js`, `hitboxes-debug.js`,
   `systemmap-ui.js`, `ghost-battle.js`, the camera/`settleView` (`sim.js:1026-1032`).

The ~50 sim-side sites are enumerated by
`grep -n 'mesh\.position\|mesh\.rotation\|mesh\.scale\|obj\.position' client/src/sim.js`.

*Playable:* identical game, pure refactor.
*Acceptance:* full guard set green (§7). `22-intro-replay` still 4 kills / p0..p4 / `won=true` is the
non-negotiable oracle.

**Outcome.** Landed exactly as scoped. `client/src/sim-core/{vec.js,consts.js}` are new; `collision.js`
gained `shipMatrix()` and no longer touches Three.js; `sim.js` gained `syncMeshes(dt)` (called once per
tick after the movement steps, and at the end of `reset()`). Result: **`tick=2503/3490`, identical to the
baseline** — the intro trace re-sims bit-for-bit, which is the strongest available evidence that nothing
about the fight changed. Client units 342 → 346 (the 4 new ones cover the rotation matrix Three.js used to
supply: a yawed hull's hitboxes, and a swept hit along the new axis). 17 visual scenarios were migrated —
they poked `mesh.position` / `mesh.scale` to place or full-size an entity, which the sim now overwrites on
the next tick.

**The bug that no simulation test could catch.** `THREE.Object3D.lookAt` branches on `x.isVector3`, so
handing it a `Vec3` fell through to `set(v, undefined, undefined)` and NaN'd the camera quaternion. The game
rendered nothing, threw nothing, and **the intro replay stayed bit-identical down to `tick=2503/3490`** —
sim-state oracles are blind to the render side by construction. It surfaced only from a full-suite delta
against `main` (3 scenarios: `16-enemy-health-bar`, `27-smoke-instancing`, `33-space-factory` — all
screen-space assertions). Lesson for the remaining slices: **the intro oracle proves the simulation, never
the picture.** `01-smoke` now asserts a finite camera position + orientation, negative-tested by
reintroducing the bug. Run the full suite and diff against a `main` baseline (14 failures at
`24849f7`) — the guard set alone would have shipped this.

**Finding worth acting on later — model-derived simulation input.** `fireMount` spawns bullets at
`ship.noseZ`, which `ship-factory.applyShipModel` *measures off the loaded `.glb`* and writes to
`mesh.userData.noseZ`. So where a bullet is born — and therefore what it hits — depends on an asset a
headless server would never parse, and a shot fired before the model lands uses the `1.6` primitive default.
That is a pre-existing latent replay wobble (today masked by `preloadLevelShipModels`), and it is a hard
blocker for Slice C's headless referee. Slice A keeps it working with an explicit render→sim copy inside
`syncMeshes`; the real fix is to bake `noseZ` into the catalog next to `hitBoxes`/`broadR`, which the ship
model pipeline already produces. **Do this in Slice B or C, before the Node host needs it.**

### Slice B — extract `sim-core`, client as its first host

**Revised ordering (2026-08-19).** The original write-up implied a `World` context early. That is the wrong
order: a `createWorld()` nothing consumes is a factory with no callers, because the step functions still
read the `state.js` module singletons directly. The `World` should arrive as the *argument* of the steps,
at the moment they actually move. So Slice B runs:

- **B1 — move the already-pure modules into `sim-core/` + enforce the boundary.** ✅ DONE 2026-08-19.
- **B2 — the event queue**: the sim stops calling audio / FX / DOM / i18n / `net.js` and appends events
  instead; `sim.js` becomes the client-side adapter that drains them. ✅ DONE 2026-08-19.
- **B3 — move the step functions in**, taking a `World` as their first argument. `state.js` calls
  `createWorld()` once and re-exports its collections, so client code that reads `enemies`/`bullets`
  is untouched while Node gets N worlds in one process. Runs in three parts:
  - **B3a — the World, plus the projectile lifecycle seam.** ✅ DONE 2026-08-19.
  - **B3b — the enemy lifecycle seam.** ✅ DONE 2026-08-20.
  - **B3c — physically move the steps into `sim-core/`**, with the station position and the input snapshot
    arriving as World data. Part 1 (firing + targeting) ✅ DONE 2026-08-20; the step functions themselves,
    the station position, the input snapshot and the `reset()` split remain.

#### B3a outcome

`sim-core/world.js` provides `createWorld({ host })`; `state.js` creates this tab's World and re-exports
`enemies`/`bullets`/`rockets`/`drops` under their historical names, so no client module noticed. `drops.js`
now takes its array from the World rather than owning one.

**The host is the new idea.** A bullet in the browser needs a mesh; the same bullet on a server needs
nothing. So the sim announces lifecycle — `world.host.onSpawn(kind, entity)` / `onDespawn(kind, entity)` —
and the browser host (installed in `sim.js`) attaches and disposes Three.js objects while `noopHost` does
nothing at all. This is deliberately *not* the event queue: events describe what happened, are copied, and
drain in a batch at end of tick; the host must run at the exact instant an entity appears or disappears,
because a mesh has to exist before the next render and be disposed before the reference is dropped.

`sim-core/spawn.js` now owns the DATA half of firing — `makeBullet`, `makeRocket`, `makeSpiralVolley`, and
the World-aware `spawnBullet`/`spawnRocket`/`despawnAt`. `projectiles.js` keeps only
`attachBulletBody`/`detachBulletBody`/`attachRocketBody`/`detachRocketBody`.

Two things this surfaced:
- **`sfxExplode` was simulation state.** A rocket resolved `sfxFor('weapon', class, 'explode')` at spawn and
  carried the result — a client sound-map lookup baked into an entity. Rockets now carry `weaponClass` and
  the client resolves the sound at detonation.
- **`detonateRocket` owned disposal**, which meant "exploded" and "left the world" were the same event. They
  are not: a rocket that reaches `maxRange` despawns without detonating. Disposal moved to `despawnAt`, so
  every rocket now leaves through one door.

Verified: client tests 374 → **378**, intro trace `tick=2503/3490`, guard scenarios green — and
`17-triple-spiral-rocket`, which had been failing intermittently on *both* branches, is now stably green.

#### B3c part 6 outcome — the projectile steps run from sim-core, and a two-month flake is gone

`stepBullets` and `stepRockets` moved to **`sim-core/step-projectiles.js`**, taking the World explicitly.
They were the busiest part of `sim.js`. Everything they used is now either a sim-core import or reached
through `world` — the swept bullet test, the warping-enemy immunity, the opt-in dodge roll and the spiral
volley's child accounting are all verbatim, because each of those was a bug once.

Three smaller couplings went with them: the UI handovers (`onMissionArrival` / `onBaseArrival` /
`onMissionZoneEnter`) became the events `missionArrival` / `baseArrival` / `missionZoneEnter`; clearing a
lingering banner became `bannerClear` (the simulation was writing `G.banner.life` directly); and
`ownsReward` moved to sim-core, reading the account record from `world.activeShip`.

**`17-triple-spiral-rocket` is fixed, not tolerated.** It had been failing about half the time all day, on
`main` as much as here, and it sat in the way of reading every full-suite delta. Rather than shrug at it I
checked the invariant it asserts — "once the warheads are gone, the invisible leader must leave too" —
**deterministically**, stepping the sim with `stepSim` instead of the wall clock: 4 rockets born (1 leader
+ 3 warheads), all gone after 239 fixed steps, `leadersLeft = 0`. The invariant holds; the *measurement*
was wrong. The scenario waited `4000 ms` of WALL CLOCK, but headless software WebGL under load renders only
a few frames a second and the accumulator caps at 6 steps per frame — so "wait 4 seconds" was never 4
seconds of simulation. It now steps the sim, and passes **5/5** where it used to pass 2/5.

That is worth generalising: a scenario that waits on real time is asserting something about the CPU.

Verified: client tests 388 → **390**, intro trace `tick=2503/3490`.

#### B3c part 5 outcome — the last things the steps were reaching for

Everything `simTick` still borrowed from a client module is now either in `sim-core` or behind the host:

- **`system-map.js` moved into `sim-core/`** (with its test). It was already pure — its only import was
  `level-sim.js`, and its single mention of "three" is a word in a prose comment — but the boundary test
  forbids sim-core reaching outside itself, so the seam it provides (`capLifted`, `arrivedAtPoint`,
  `ARRIVE_RADIUS`, plus the whole star-system geometry) had to come along.
- **`ARENA`, `OOB_WARN_DELAY`, `OOB_RETURN_TIME`** moved to `sim-core/consts.js`. The soft boundary is a
  rule (DECISIONS §2), not scenery; `world.js` re-exports them.
- **The arena border stopped being written from inside `stepPlayer`.** The simulation was setting a
  material's opacity. `drawArenaBorder()` now derives the marker's position and brightness from where the
  ship is, in `renderTick`.
- **Asset warming became a host call.** `world.host.onWarmLevel(level)` replaces `preloadLevelShipModels` +
  `preloadRewardModel` at both call sites (level start, and the roam countdown that warms a fight three
  seconds before it begins). The browser host fetches and parses; `noopHost` does nothing, which is the
  point.

Verified: client tests 386 → **388**, intro trace `tick=2503/3490`, guard scenarios green including
`26-ship-model-cache` and `28-scene-warm`, which are what the warming exists for.

**What is left of Slice B:** the physical move of `stepPlayer` / `stepEnemyAI` / `stepBullets` /
`stepRockets` / `levelRunner` into `sim-core` (now nearly mechanical — `simTick` contains exactly them),
and splitting `reset()` into "reset the world" and "rebuild the scene".

#### B3c part 4 outcome — the tick has two halves, and detonation stops mixing them

**`update(dt)` is now `simTick(dt)` + `renderTick(dt)`.** The first is the game — movement, deaths, the
Grab, the level runner. The second is the picture — `syncMeshes`, the event drain, the drop beam, the FX
ageing, the camera, the set-piece animations. `update()` keeps its name and signature, so the accumulator,
the replay stepper and the `?debug` hooks are untouched.

This required **reordering**, which Slices A–B3b deliberately refused to do. It is safe here for a reason
that can be stated: no presentation step reads or writes simulation state — the FX pools only age
themselves. What genuinely shifts is when FX created *during* a tick first age, by one tick (~16 ms) on
effects that live 0.06–2 s. The intro trace is the check that the simulation did not move, and it did not:
`tick=2503/3490`.

**`detonateRocket` split.** It was doing three jobs at once: blast damage (simulation), the fireball and
ring (presentation), and the bang (audio). The damage half moved to `sim-core/spawn.js` — hull-relative
within `blastR`, exactly as before — and it now emits **`detonate`**, which the adapter turns into
`spawnRocketBurst` plus the sound. Disposal stays with `despawnAt`, since detonating and leaving the world
are still different things.

**A slice bug worth remembering.** Cutting `detonateRocket` out of `projectiles.js` by text range also took
`const SMOKE_MAX = 640` with it, and **the 386 unit tests did not notice** — they never load
`projectiles.js`, which imports `three`. The whole visual suite timed out instead, with
`SMOKE_MAX is not defined` on page load. For any module that imports `three`, *booting the game* is the
only test there is; run one scenario, not the unit suite, after editing one.

#### B3c part 3 outcome — loot drops split

`sim-core/drops-sim.js` owns the Grab: `makeDrop`, `spawnDrop`, `stepDrops` (arm → pick the nearest
eligible drop → pull → collect), `takeLoot`, `clearDrops`. `world.pendingLoot` holds what the run has
collected. `drops.js` keeps the crate model, the halo, the cosmetic spin, the blue beam and the catalog
weight lookup, plus `attachDropBody`/`detachDropBody` for the host. Collecting emits **`pickup`**; the
adapter plays the blip and writes the event-log line, both of which needed the catalog and i18n and so were
never the simulation's to do.

Note the reach stays emergent — a drop is eligible while the inverse-square field crosses `FIELD_CUTOFF`,
never a stored radius — and `special` reward drops still deposit nothing.

**Verified the pickup path by hand, for the same reason as the fire sound.** `19-hud-log` fails on the KILL
line assertion — identically on `main` — *before* it reaches the pickup line, so it would have passed a
broken `pickup` event silently. A probe dropped a component next to the ship: `drops 1 → 0`, one blip, and
`#event-log` reading "picked up Scout engine".

Verified: client tests 384 → **386**, intro trace `tick=2503/3490`.

#### B3c part 2 outcome — the World now holds everything a fight is made of

The last data the simulation was reading out of client modules moved onto the World, each reachable under
its historical name so no call site changed:

- **The home station** (`world.station`) carries `pos` — captured once, because it never moves — alongside
  `active` and the host's `obj`. Docking distance decides the mission win, so its position is simulation
  input; `G.baseStation` proxies it.
- **Input** (`world.input = { keys, touchAim }`) points at this tab's live objects, in the shape
  `replay.js` already records. A server swaps in the per-tick snapshot its client sent; the simulation only
  ever reads it.
- **Run state** — `kills`, `enemyTotal`, `earned`, `earnedXp`, `banked`, `combatElapsed`,
  `enemyShieldRefills`, `activeMission`, `roam`, `returnToBase`, `replayMode`, `missionZone`, `autopilot`
  — moved off `G`. `state.js` defines getter/setter proxies for all thirteen in one loop, so `G.kills++`
  and `G.autopilot.active = false` keep working while there is only one copy.

What is left on `G` is genuinely the client's: the graphics tier, the scene handles, the account, the
callbacks into the UI, `paused`/`gameStarted`/`mapOpen`, and the HUD banner.

**Still to do for B3c:** physically move `stepPlayer` / `stepEnemyAI` / `stepBullets` / `stepRockets` /
`levelRunner` into `sim-core` taking `world`; give `drops` the same data/body split the projectiles and
ships got; route `levelRunner`'s asset preloads through the host; lift `settleView`, the arena-border
opacity and the banner ageing out of `update()`; and split `reset()` into "reset the world" and "rebuild
the scene".

#### B3c part 1 outcome — and a gap B2 left behind

**B2 missed two outbound calls, because I swept `sim.js` and firing lives in `ship-build.js`.**
`fireMount` was still calling `audio.sfx.rocket(...)` / `audio.sfx.shoot(...)` mid-tick, driven by
`updateGroups` from `stepPlayer`/`stepEnemyAI` — simulation code reaching into the audio layer. A thirteenth
event type, `fire { weaponClass, isRocket, fromPlayer }`, closes it; the adapter decides that only the
player's own shots are audible, which was always a client judgement rather than a rule of the game.

Moved to sim-core with it:
- `sim-core/targeting.js` — `findTargetInSector` (the rocket seeker) and `findBulletAimTarget` (the
  aim-assist cone). Pure scans over the World's combatants; they were in `projectiles.js` only because that
  is where the meshes were.
- `fireMount` / `updateGroups` → `sim-core/ship-entity.js`. `ship-build.js` keeps a World-bound
  `updateGroups` wrapper so the two call sites in `sim.js` are untouched.
- **`G.player` is now a getter/setter onto `world.player`** — one source of truth, and every existing
  `G.player` call site works unchanged.

**Verified the fire path directly, because the obvious test does not cover it.** `12-audio` fails on a
music-clip length assertion — identically on `main` — *before* it reaches any weapon sound, so it would have
passed a broken fire event silently. A browser probe holding the fire keys counted 13 gun sounds and 1
rocket sound against 8 bullets and 1 rocket in flight.

#### B3b outcome

`sim-core/ship-entity.js` owns turning a catalog ship row into a fighting entity: `resolveWeapon`,
`resolveComponents`, `buildMounts`, `buildGroups`, `makeEnemy` and `spawnEnemy`. `ship-build.js` keeps thin
wrappers that bind this tab's World, so `resolveComponents(refs)` and `spawnEnemyShip(def)` read the same
to every existing caller, and it gained `attachEnemyBody`/`detachEnemyBody` for the host.

Three shared dependencies had to move first:
- `BULLET_PLANE_Y` and `SPAWN_GROW_TIME` are gameplay, so they moved to `sim-core/consts.js` (re-exported
  from `state.js` under their old names). `SPAWN_GROW_TIME` in particular is not decoration — a growing
  ship is invulnerable, cannot fire and cannot be homed on.
- `arenaCenter` moved onto the World. The renderer's export is now literally the World's `Vec3`, so the sim
  and the mini-map cannot disagree about where the fight is; `arenaDrift` moved with it, off `G` and out of
  `THREE.Vector3` into a plain `{x, z}`.
- The catalog hangs off the World (`world.catalog`), because sim-core cannot import `state.js`.

**The RNG draw order is now documented as a contract** at the top of `ship-entity.js`: facing, then spawn
angle, then spawn distance. Every recorded trace replays against that exact sequence, so new draws go at the
END (DECISIONS §73).

**One real bug, and it is the interesting part.** `shield-fx.js` decided whether a pooled bubble's enemy was
gone by testing **`enemy.mesh.parent`** — using the scene graph as a proxy for a simulation fact. That
worked only because a dead enemy kept its mesh; now the host releases it, so the check threw
`Cannot read properties of null (reading 'parent')` every frame. `despawnAt` now sets `alive = false` on
every entity it removes — "has this left the World?" is a fact the entity carries — and `shield-fx` asks the
entity. Note how it surfaced: the intro scenario printed a *correct* `tick=2503/3490` line and still failed,
on the harness's **page-error** check. Simulation assertions cannot see this class of bug; the zero-errors
check is what does.

Verified: client tests 380 → **382**, intro trace `tick=2503/3490`, guard scenarios green.

#### B3-catalog — model-derived simulation input is now baked ✅ DONE 2026-08-20

The blocker below is cleared. `npm run assets:muzzle` (`scripts/assets-muzzle.mjs`) bakes each ship's
group-local nose/tail offsets into its `model:{}` block as `muzzle`/`exhaust`, and `shipModelCfg` moved to
`sim-core/ship-config.js` — it was always a pure read of catalog data, it just lived next to the Three.js
loader. `entity.noseZ` now comes from the catalog at build time, and the render→sim copy in `syncMeshes`
that stood in for it is gone.

Findings worth keeping:

- **The runtime "measurement" was mostly a constant.** Models are normalized so their longest axis spans
  `SHIP_MODEL_LEN` (3.4) and are recentred, so any ship whose longest axis is its length measures exactly
  ±1.7 — which is all eight pirates. The player's ship is *not* one of those: it measures **1.104**, so this
  was never a value we could have hard-coded.
- **Precision matters more than tidiness.** Rounding the baked value to a "clean" 1e-6 shifts every player
  bullet by 3.6e-7 world units; emitting the raw double leaves a **1 ULP** (~2e-16) gap against the runtime
  measurement, the irreducible cost of a Float64 offline pass versus Float32 attributes × Matrix4 in the
  browser. The script rounds nothing, and says so.
- **The script deliberately does not re-run the hitbox fit.** It reuses `assets-hitboxes.mjs`'s exported
  `gatherMesh`/`normalize` (the same group-local frame the boxes live in) and owns a separate
  `muzzle:auto:*` marker span. Re-fitting would risk moving every collision box in the game to bake two
  numbers; verified byte-identical `hitBoxes`/`broadR` afterwards.
- **The change made an unguarded failure mode worse, so it is guarded.** A missing `muzzle` used to mean
  "measure it" and worked; now it means the entity falls back to `1.6` — the *primitive cone's* nose — while
  the visible hull's nose is elsewhere, silently. `server/src/catalog_muzzle.test.js` fails per ship with the
  fix in the message (10 new tests, negative-tested by stripping a span).

Oracle held at every step: `tick=2503/3490` after baking, and again after `noseZ` switched to the catalog —
so the latent wobble Slice A flagged (shots fired before the `.glb` lands using the 1.6 default) never
manifested in this trace, because `preloadLevelShipModels` warms the models first.

#### B3b was blocked on catalog data — this was the same debt Slice A flagged

Splitting `spawnEnemyShip` into data + body needs `hitBoxes`, `broadR` and `sizeScale`, which come from
`shipModelCfg()` in the Three.js-importing `ship-factory.js` — plus `noseZ`, which is *measured off the
loaded `.glb`*. All four are simulation input (they decide what a shot hits and where it is born) derived
from presentation code a headless authority cannot run. The fix is the one already named in Slice A: bake
them into the catalog next to the rest of the ship's stats, which the model pipeline already computes.
**Do that before B3b**, not after.

#### B2 outcome

`sim-core/events.js` provides `createEventQueue()`; `state.js` holds the one instance for this world
(`simEvents`) until it moves onto the World in B3. Twelve event types cover everything the tick used to do
to the outside: `hit`, `bulletImpact`, `shieldHit`, `enemyShieldHit`, `shieldReady`, `evade`, `smoke`,
`kill`, `warpFlash`, `banner`, `win`, `death`. The catalogue is documented at the top of `events.js` — the
server will answer to the same list.

Three things worth knowing:

- **Events carry copied values.** The queue drains at the end of the tick, by which time a bullet's `pos`
  has moved and a killed enemy is already spliced out of `enemies`. Positions are cloned at emit time and
  the `kill` event carries reward/xp/name/colour outright. The one deliberate reference is
  `enemyShieldHit.enemy`, which binds a pooled bubble to a specific ship — identity, not a value.
- **`banner` carries an i18n KEY plus params, never translated text.** `t()` is a client concern; a
  headless authority must not need it. Same reasoning moved `levelRunner.win()`'s overlay and its
  `bankRun`/`depositLoot`/`unlockNextLevel`/`reportMissionCleared` block into the adapter, leaving the
  rules (`won`, the ×2 credit double, the XP bonus) in the sim.
- **Engine exhaust became state, not an event.** `emitExhaust` was called every tick while thrusting —
  that is not an event, it is a condition. The sim sets `ship.thrusting`; `syncMeshes` draws the plume.

**The one real regression this caused, and why it is instructive.** `stepSmokeTrail` rebuilds the instanced
puff pool from `smoke[]`, and it ran *before* the drain — so puffs created by the adapter reached the pool a
frame late and `27-smoke-instancing` failed on `poolCount !== puffs`. Moving that one flush after the drain
restores the original spawn → age → flush order exactly. **The lesson for B3: a pool that a step function
flushes must be written before that flush runs**, and moving work into the queue silently changes when it is
written. The intro replay caught none of this — `tick=2503/3490` throughout.

Verified: client tests 367 → **374**, intro trace `tick=2503/3490`, guard scenarios green.
`19-hud-log` and `17-triple-spiral-rocket` fail identically on `main` (pre-existing / flaky), checked
individually on both.

#### B1 outcome

`components`, `steering`, `spawn-timing`, `collision`, `level-sim`, `drops-config`, `autopilot-config` and
`sim-random` moved to `client/src/sim-core/` with `git mv` (history preserved), alongside `vec.js` and
`consts.js` from Slice A. Importers across `client/src`, `client/visual`, `client/bench` and
`scripts/assets-check.mjs` were rewritten; stale paths in CLAUDE.md, SUMMARY, DECISIONS, the
`record-playback` skill and a `catalog_seed.js` comment were swept too (dated historical briefs and the
append-only CHANGELOG were deliberately left alone).

**`sim-core/boundary.test.js` is the point of the folder.** It scans every non-test module in `sim-core/`
and fails on: an import of `three`, any import reaching outside the folder, a reference to `window` /
`document` / `localStorage` / `sessionStorage` / `navigator` / `location` / `alert`, or a `fetch()` call.
Comments are stripped first so the guard doesn't fire on its own documentation. Without this, "sim-core is
Node-safe" is a convention, and conventions rot — one import on a tired afternoon makes the authority
un-loadable, and it surfaces weeks later. Negative-tested by adding `import * as THREE from 'three'` plus a
`window` reference to `steering.js` and watching both assertions fire.

Behaviour-neutral, as intended: 346 → **367 client tests** (+21 boundary), all five guard scenarios green,
and the intro trace still `tick=2503/3490`.

1. Move the decision-making out of `sim.js` (1171 lines) into `sim-core/`, and move the already-pure
   modules under it. Keep `sim.js` as the client-side adapter.
2. **The sim emits events instead of calling out.** Every `audio.*`, `sfxFor`, `spawnExplosion`,
   `spawnShieldHit`, `spawnHitSprite`, `spawnSmoke`, `emitExhaust`, `el.*`, `t()`, `track`, `bankRun`,
   `depositLoot`, `unlockNextLevel`, `reportMissionCleared` call leaves `sim-core`. Event shapes:
   `{type:'hit'|'kill'|'fire'|'spawn'|'drop'|'shieldHit'|'evade'|'phase'|'banner'|'win'|'death', …}`.
3. **`levelRunner.win()` (`sim.js:136-165`) splits**: the runner emits `win`; the client shows the overlay
   and performs the `!G.replayMode` backend block verbatim.
4. `levelRunner` state (`sim.js:73-75`) moves onto the `World`.

*Playable:* identical game.
*Dividend:* a whole level runs to completion under `node --test`.
*Acceptance:* guard set green; a new unit test drives a level headless from a recorded trace.

### Slice C — headless referee in Node + determinism test

1. `server/tools/sim-replay.mjs` imports `sim-core` via `clientDir` and runs an input trace to completion,
   printing kills / credits / outcome.
2. **The divergence oracle**, as a test: browser-run and Node-run of the same trace must agree on the
   outcome, on a hash of the final world state, **and on the number of `simRandom()` draws consumed**. The
   draw count is what catches a §73 violation — an FX path that reached into the gameplay stream.

*Playable:* unchanged.
*Deferred payoff (separate slice, not now):* seal the economy by re-simulating the submitted trace.

### Slice D — WebSocket + one server-run mission instance, no prediction

1. `ws` added to `server/` (first new runtime dep since `pg`). Upgrade at `/ws`.
2. A room = one `World` stepping at 60 Hz. One player.
3. Client flag `?netsim=1` routes a single level into the server instance. Without the flag, nothing
   changes anywhere.
4. Upstream: `{tick, keys, touchAim, ackTick}` — the `replay.js` snapshot shape, batched.
   Downstream at 15–20 Hz: ship + rocket + drop transforms, HP, flags, plus the event list.
5. Remote entities rendered by a generalized `ghost-battle.js` with a ~100 ms interpolation buffer.
6. The rewind ring buffer + lag compensation of D5.

*Playable:* both paths. The local ship will feel mushy — that is the point, it gives Slice E a measurable
baseline.
*Pause:* there is no freeze in a room (§16). First cut: Esc opens a local menu, the ship keeps flying and
stays vulnerable. Needs hands-on evaluation.

### Slice E — client-side prediction + reconciliation of the local ship

The client keeps a buffer of unacked inputs; on each snapshot it reseeds its `World` from the authoritative
state and re-runs the buffer through the same `sim-core`. That is exactly what `replay.js` already does
(simulate from a state + a list of inputs), applied per frame. Own bullets spawn locally on fire; the
server's verdict overrides.

*Playable:* the netsim path becomes enjoyable and honestly comparable to the local path.

## 5. Transport auth (decided up front)

`Origin` is not a security control — any non-browser client forges it — and itch's rotating
`*.itch.zone` / `*.hwcdn.net` subdomains make an allowlist a permanent chore (`client/src/api-base.js`
warns against hostname sniffing for exactly this reason). Browsers also cannot set `Authorization` on a
WebSocket handshake.

Both problems close with one move: **`POST /api/ws-ticket`** (authenticated by the existing cookie/bearer,
`server/src/auth.js`) issues a single-use ticket valid ~30 s; the client connects to
`wss://…/ws?ticket=…`. `Origin` is logged and soft-filtered by suffix, but the security boundary is the
ticket.

Since single-player stays local (D1), itch is untouched until the maintainer chooses to enable netsim there.

## 6. Non-goals for this cut

Rooms and matchmaking UI, PvP, shared roam, side missions over the network, sealed economy, reconnect,
socket draining across the blue-green deploy swap, binary/delta snapshot encoding.

## 7. Guard suites (run them, do not assume)

| Gate | Command | Baseline @ `24849f7` |
|---|---|---|
| Client units | `cd client && node --test` | 342 pass / 0 fail |
| Server units | `cd server && npm test` (needs local Postgres) | 137 pass / 0 fail |
| **Intro oracle** | `cd client && node visual/run.mjs 22-intro-replay` | 4 kills, cards p0..p4, `won=true` |
| Visual guards | `node visual/run.mjs {01-smoke,04-combat,20-warp-blast-immunity,25-enemy-shield}` | see §7.1 |

The visual suite drops ~6 scenarios at baseline — judge by the reliably-green set and zero page errors.
The `?bench` A/B perf gate takes 25–40 min: **ask before running**, default skip. It is worth proposing
once, at the end of Slice B (the hottest file in the game just moved).

### 7.1 Measured baselines

Captured on `feature/server-sim` @ `24849f7` (worktree `../ag-wt/server-sim`), 2026-08-19, before any edit:

| Gate | Result |
|---|---|
| `client node --test` | **342 pass / 0 fail** (308 ms) |
| `server npm test` | **137 pass / 0 fail** (13.4 s) |
| `22-intro-replay` | **`kills=4 enemiesLeft=0 cards=p0\|p1\|p2\|p3\|p4 won=true ended=true playDone=true tick=2503/3490`** — pass |
| `01-smoke` | pass |
| `04-combat` | pass |
| `20-warp-blast-immunity` | pass |
| `25-enemy-shield` | pass |

`tick=2503/3490` is the exact intro-replay signature to compare against after every slice: a change in the
tick count means the sim diverged even if the outcome still reads `won=true`.

**Full visual suite baseline on `main` @ `24849f7`: 26 passed / 14 failed.** The failing set is
`06-pause`, `08-arena-boundaries`, `09-mission-setpieces`, `12-audio`, `15-mobile-landscape`,
`16-enemy-health-bar`, `18-briefing-staged-reveal`, `19-hud-log`, `23-topbar-credits-radar`,
`25-enemy-shield`, `32-star-system`, `29-intro-live-handoff`, `14-reset-progress`,
`30-session-upload-on-hide`. **Take this number, not the remembered "~6".** Two caveats that cost time
once already:
- The suite is noisy — `16-enemy-health-bar` and `25-enemy-shield` fail inside the full run but pass when
  run alone, on `main` and on the branch alike. **An individual rerun is the reliable signal**; use the
  suite only to produce the candidate list.
- **The guard set alone is not enough.** Slice A shipped a NaN camera that every guard scenario and the
  intro replay passed; only the full-suite delta caught it (see Slice A's outcome). Run the full suite and
  `comm` the failure lists whenever a change crosses the sim→render boundary.

## 8. Docs to update

- `docs/SUMMARY.md` — once `sim-core` exists (Slice B) and again when netsim is playable (Slice D).
- `docs/CHANGELOG.md` — a bullet per slice.
- `docs/DECISIONS.md` — D1 (single-player stays local), D2 (World context, not worker-per-room),
  D4 (60 Hz on both hosts), D5 (lag compensation from day one), D6 (bullets as events, rockets streamed).
  §16 (pause) gets revisited at Slice D.
- `docs/plans/multiplayer-architecture.md` — point its phase list at this file.
