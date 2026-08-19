# Changelog

> Change log, newest on top. Append-only (we don't edit history).
> Current state is in [SUMMARY.md](SUMMARY.md).

## 2026-08-20

- **Enemies are built as data; the scene graph is no longer anyone's source of truth.**
  `client/src/sim-core/ship-entity.js` now turns a catalog ship row into a fighting entity
  (`resolveWeapon`/`resolveComponents`/`buildMounts`/`buildGroups`/`makeEnemy`/`spawnEnemy`); `ship-build.js`
  keeps World-bound wrappers so `resolveComponents(refs)` and `spawnEnemyShip(def)` are unchanged for every
  caller, plus `attachEnemyBody`/`detachEnemyBody` for the host. Three shared dependencies moved to make it
  possible: `BULLET_PLANE_Y` and `SPAWN_GROW_TIME` are gameplay and now live in `sim-core/consts.js`
  (re-exported from `state.js`); **`arenaCenter` moved onto the World** — the renderer's export IS the
  World's `Vec3` now, so the simulation and the mini-map cannot disagree about where the fight is, and
  `arenaDrift` came with it, off `G` and out of `THREE.Vector3` into a plain `{x, z}`; and the catalog hangs
  off `world.catalog`. The enemy spawn's three seeded RNG draws (facing, angle, distance) are documented as
  a replay contract — new draws go at the end. **Bug found and fixed:** `shield-fx.js` tested
  `enemy.mesh.parent` to decide whether a bubble's ship was gone — the scene graph standing in for a
  simulation fact — which threw once the host started releasing meshes. `despawnAt` now sets `alive = false`
  on every entity it removes, and `shield-fx` asks the entity. It surfaced through the harness's page-error
  check while the intro scenario was printing a perfectly correct `tick=2503/3490`, which is precisely the
  class of failure simulation assertions cannot see. Client tests 380 → 382; guard scenarios green.
  Plan: `docs/plans/server-authoritative-sim.md` (Slice B3b).

- **Where a bullet is born is now catalog data, not a runtime measurement.** `ship-build.fireMount` spawns
  a projectile at `noseZ × the ship's world scale`, so that number decides what a shot can hit — and it was
  *measured* off the `.glb` by `ship-factory.applyShipModel` once the model finished downloading. A piece of
  the game's rules was therefore produced by code that needs a WebGL scene graph, and a shot fired before
  the model landed silently used the `1.6` primitive default. New `npm run assets:muzzle`
  (`scripts/assets-muzzle.mjs`) bakes each ship's group-local nose/tail into its `model:{}` block as
  `muzzle`/`exhaust`; `shipModelCfg` moved to `client/src/sim-core/ship-config.js` (it was always a pure
  read of catalog data — `hitBoxes`, `broadR` and `muzzle` are all simulation input); `entity.noseZ` comes
  from the catalog at build time and the render→sim copy in `syncMeshes` is gone. The script reuses
  `assets-hitboxes.mjs`'s normalization and owns a separate marker span, so `hitBoxes`/`broadR` are
  byte-identical — verified. It rounds nothing on purpose: a "tidy" 1e-6 would shift every player bullet by
  3.6e-7 world units, whereas the raw double sits 1 ULP (~2e-16) from the runtime value. New
  `server/src/catalog_muzzle.test.js` (10 tests) fails per ship if a model ship has no baked muzzle —
  necessary, because the fallback is now silently wrong rather than merely non-portable. Turns out the old
  measurement was ±1.7 for all eight pirates (a consequence of normalizing the longest axis to 3.4) but
  **1.104 for the player's ship**, so it could never have been hard-coded. No gameplay change: intro trace
  still `tick=2503/3490`, before and after. Server tests 137 → 147, client 378 → 380.
  Plan: `docs/plans/server-authoritative-sim.md`.

## 2026-08-19

- **A fight is now a `World` object, and entities get their body from a host.** `client/src/sim-core/world.js`
  adds `createWorld({ host })` — one running fight, owning its entities, its event queue and its arena
  centre. `state.js` creates this tab's World and re-exports `enemies`/`bullets`/`rockets`/`drops` under
  their historical names, so no client module changed; `drops.js` takes its array from the World instead of
  owning one. The point is that a Node process can hold many Worlds, which `state.js` (it reads
  `window.localStorage` at import) can never provide. **The host** is how an entity gets a body: the sim
  calls `world.host.onSpawn(kind, entity)` / `onDespawn(...)`, the browser host attaches and disposes
  Three.js objects, and `noopHost` — the server, the referee, every unit test — does nothing.
  `sim-core/spawn.js` now owns the data half of firing (`makeBullet`, `makeRocket`, `makeSpiralVolley`,
  plus World-aware `spawnBullet`/`spawnRocket`/`despawnAt`) while `projectiles.js` keeps only
  `attach*Body`/`detach*Body`. Two bits of hidden coupling fell out: a rocket used to carry `sfxExplode`,
  a **client sound-map lookup baked into simulation state** (it now carries `weaponClass` and the client
  resolves the sound at detonation), and `detonateRocket` used to dispose the body, conflating "exploded"
  with "left the world" — a rocket that reaches `maxRange` does the latter without the former, so disposal
  moved to `despawnAt` and every rocket now leaves through one door. No gameplay change: intro trace still
  `tick=2503/3490`; client tests 374 → 378; `17-triple-spiral-rocket`, intermittently failing on both
  branches before, is now stably green.
  Plan: `docs/plans/server-authoritative-sim.md` (Slice B3a).

- **The simulation stopped calling out: it emits events, the client acts on them.** Mid-tick the sim used
  to play audio, spawn FX, write the DOM through i18n and call the backend — `levelRunner.win()` alone did
  the victory sting, the overlay, `bankRun`, `depositLoot`, `unlockNextLevel` and `reportMissionCleared`.
  It now appends to a queue (`client/src/sim-core/events.js`, `createEventQueue()`; the instance lives on
  `state.js` as `simEvents`) and an adapter in `sim.js` turns each event into sight, sound, HUD and
  network. Twelve types: `hit`, `bulletImpact`, `shieldHit`, `enemyShieldHit`, `shieldReady`, `evade`,
  `smoke`, `kill`, `warpFlash`, `banner`, `win`, `death`. Events carry **copied** values (the queue drains
  at end of tick, by which point a bullet has moved and a dead enemy is spliced out), and `banner`/`win`
  carry i18n **keys**, never translated text — `t()` must not be reachable from a headless authority. Game
  rules stayed in the sim (the ×2 victory credit double, the XP bonus, `won`). Engine exhaust became
  **state** rather than a call: the sim sets `ship.thrusting`, `syncMeshes` draws the plume. One ordering
  fix fell out — `stepSmokeTrail` rebuilds the instanced puff pool from `smoke[]`, so it now runs after the
  drain, restoring the original spawn → age → flush order. No gameplay change: intro trace still
  `tick=2503/3490`; client tests 367 → 374.
  Plan: `docs/plans/server-authoritative-sim.md` (Slice B2).

- **The game's pure rules now live in `client/src/sim-core/`, and a test keeps them pure.**
  `components.js`, `steering.js`, `spawn-timing.js`, `collision.js`, `level-sim.js`, `drops-config.js`,
  `autopilot-config.js` and `sim-random.js` moved into the folder (via `git mv`, history preserved) next to
  Slice A's `vec.js`/`consts.js`; importers across `client/src`, `client/visual`, `client/bench` and
  `scripts/assets-check.mjs` follow, as do the path references in CLAUDE.md, SUMMARY, DECISIONS, the
  `record-playback` skill and a `catalog_seed.js` comment. The point is the new
  **`sim-core/boundary.test.js`**: it fails if any module in the folder imports `three`, imports anything
  outside the folder, touches `window`/`document`/`localStorage`/`sessionStorage`/`navigator`/`location`/
  `alert`, or calls `fetch()` — the properties the multiplayer authority and the headless referee depend
  on, enforced rather than remembered (negative-tested by breaking a module on purpose). Behaviour-neutral:
  client tests 346 → 367, guard scenarios green, intro trace still `tick=2503/3490`.
  Plan: `docs/plans/server-authoritative-sim.md` (Slice B1).

- **Simulation state moved out of Three.js (Slice A of the server-authoritative sim).** Entity transforms
  used to live *inside* Three.js objects — position was `entity.mesh.position`, velocity a `THREE.Vector3`,
  and `mesh.scale` was gameplay (the warp-in grow drove `e.warping` = invulnerable / can't fire / not
  homing-targetable). Nothing could step the fight without a WebGL scene graph. Now every simulated entity
  (player, enemies, bullets, rockets, loot drops) owns plain `pos` / `vel` / `heading` / `scale` data backed
  by a new ~40-line `client/src/sim-core/vec.js` `Vec3`, `warping`/`spawnAge`/`spawnDur` are simulation
  fields, and the new **one-way `sim.js syncMeshes(dt)`** is the single place that state reaches the scene
  graph (also called at the end of `reset()` so a frozen pre-fight cutscene card is framed correctly).
  `collision.js` composes the ship's world matrix itself (`shipMatrix`, translate × rotateY × uniform scale)
  instead of reading `mesh.matrixWorld` + `updateMatrixWorld()`, so hit tests no longer touch Three.js at
  all; the `1.8` ship-group scale is now the shared `sim-core/consts.js SHIP_GROUP_SCALE`. **No gameplay
  change:** the recorded Level-0 intro trace replays bit-identically — same 4 kills, cards p0..p4,
  `won=true`, and the same `tick=2503/3490` signature. Client unit tests 342 → 346 (4 new: the hand-written
  rotation matrix that Three.js used to supply, incl. a yawed hull's hitboxes and swept hits). 17 visual
  scenarios that poked `mesh.position`/`mesh.scale` to place or full-size an entity were migrated to the
  sim fields. Known stopgap: `noseZ` (where bullets are born) is still *measured* off the loaded `.glb`, so
  `syncMeshes` copies it back sim-ward each tick until it becomes catalog data.
  Caught during the slice: passing a `Vec3` to `camera.lookAt()` NaN'd the camera's quaternion (THREE's
  `lookAt` branches on `isVector3` rather than reading `x/y/z`), so **the game rendered nothing while every
  simulation assertion — the whole intro replay included — stayed green**. Fixed by passing components;
  `01-smoke` now guards a finite camera position + orientation, and the guard was negative-tested by
  reintroducing the bug. Full visual suite: 14 failures at `24849f7` baseline, unchanged by this slice.
  Plan: `docs/plans/server-authoritative-sim.md`.

## 2026-08-18

- **Star-centered canonical coordinate frame + per-object `frame` tag (foundation for multiplayer zones).**
  The game's *canonical* world frame is now **heliocentric** — the star is the origin, planets sit at their
  own orbit vectors — while all gameplay still runs in a **planet-2 floating origin** (numerically unchanged,
  so combat/missions/replays are byte-identical). `client/src/system-map.js` gains a pure, node-tested seam:
  `orbitVec`, `starWorldPos(name,t)`, `planetOriginOffset(t)` (planet 2's star-frame position = the base
  zone's world origin), and `worldToLocal(pt,origin)` / `localToWorld` (exact inverses; a "zone" is just an
  origin point, kept a parameter so instanced combat zones can reuse it later). Set-pieces carry an optional
  **`frame`**: `"planet:2"` (default — pos is a local offset, placed verbatim as before) or `"world"` (pos is
  a space-fixed STAR coordinate, re-derived to local **every frame** in `world.js` `buildSetPiece` so the
  object holds its place while the base orbits past it at ~0.51 u/s). Added one demo `frame:"world"` object —
  a procedural research-station **1000 u due south of the star** (star coord `(0,1000)`), so in the base's
  local frame it sits ~10 000 u away, met on the run out to the star.
- **Star system compacted — planet orbits scaled to 0.7× (30% closer).** Orbit radii dropped p1 9000→6300,
  p2 (base) 15000→10500, p3 22000→15400, p4 30000→21000, and the asteroid belt 16000–24000→11200–16800, in
  both the client `SYSTEM` (`system-map.js`) and the seed `system` block (`catalog_seed.js`). Shorter trips
  between bodies; base-local gameplay (set-pieces, mission centers, anchors — all planet-2-local) is
  unchanged, and the base's linear orbital drift drops to ~0.51 u/s. Moons (planet-relative) untouched.
  New unit tests pin the frame identity, the inverse round-trip, and the space-fixed drift; the
  `22-intro-replay` guard stays byte-identical (kills=4, p0..p4, won). Plan:
  `docs/plans/heliocentric-coordinate-frame.md`; rationale DECISIONS §115. **No multiplayer machinery was
  built** — this is coordinates only.

## 2026-08-16

- **Loadout no longer balloons on large/foldable phones after entering fullscreen.** The device **form**
  axis classified `phone` off the viewport's **longest** edge (`< 900` CSS px). On a Galaxy Fold cover
  screen (≈ 369×905 CSS px) hiding the browser chrome on fullscreen grew the long edge past 900, flipping
  `phone→tablet` mid-session — the `dev-phone` shrink rules dropped and the loadout slots + right-panel
  fonts jumped to tablet sizes. `classifyForm` now decides `phone` by the **shortest** edge (`< 600`) and
  the larger tiers by the longest edge; both stay orientation-invariant and the short edge barely moves
  when chrome hides, so the class is stable across fullscreen. Also fixes large phones (e.g. iPhone Pro
  Max, long edge 932) that were already misclassified as tablet. `client/src/device.js` +
  `device.test.js`; DECISIONS §114.

## 2026-08-15

- **Cannon shells are glowing bolts now, sized to the class.** The Heavy cannon (and the enemy cannon)
  fired the old flat opaque sphere while every kinetic gun already fired the travel-aligned additive bolt;
  both cannon classes now use the same `bolt-fx.js` bolt + muzzle flash, scaled **1.7×** via the new
  `BOLT_SCALE` map in `projectiles.js` (kinetic stays 1). A cannon slug reads as a visibly heavier tracer,
  matching the bigger hit flash it already had. Cosmetic only — the bullet's hit test is still a point,
  and there is no RNG, so recorded replays are unaffected.
- **The ship can no longer fly backwards — `S`/`↓` is now a brake.** The reverse thruster was a
  keyboard-only ability (touch steering can only push forward, `touchAim.thrust` is 0..1) and it let a
  player retreat while keeping the guns on an enemy, which is a kite rather than a dogfight. `S`/`↓` now
  runs the same kinematic decel the autopilot uses: speed bleeds to 0 at the ship's own acceleration and
  stops there. `W`+`S` thrusts (forward wins), and `S` still cancels the autopilot. The on-screen controls
  cheatsheet (EN + RU) reads "brake". Rule extracted as the pure `keyboardThrust()` seam in `steering.js`
  with a test asserting no key combination can produce negative thrust. DECISIONS §113.

- **Replaying your own recording no longer plays synthesized sfx instead of the real sounds.** Sample
  preloading fired only from the gesture handler (or from bootstrap if a gesture had already happened), but
  `?playback` is reached by NAVIGATION — the record page's "Play it ▶" link — so no gesture ever landed on
  it, the replay auto-started with zero decoded buffers, and every shot fell back to its synth voice. The
  shipped intro cutscene hid this completely: it opens on a "tap to begin" card, and that tap loaded the
  samples before the first tick — so the sounds were right in production and wrong the moment you replayed a
  fight you had just recorded, which is how it was reported. Bootstrap now preloads as soon as the sound
  catalog lands, ungated: decoding needs an `AudioContext`, not a *running* one. `audio.unlock()` stays
  gesture-bound (resuming the context really does need one). Consequence worth knowing: the sample set
  (~3.2 MB, dominated by `music_combat_2` at 2.5 MB) is now fetched on page load rather than on the first
  click — in practice the same bytes a few hundred ms earlier, since any real session clicks within seconds.
  New guard `client/visual/scenarios/35-playback-loads-samples.mjs` opens the bare `?playback` page, touches
  nothing, and asserts the `kinetic`/`cannon`/`rocket` mp3s were fetched; verified to fail on the pre-fix
  code and pass after.
- **Level-0 intro cutscene re-recorded** (`level0-intro.6674d840.json`, 3490 ticks / 58 s, seed 78672849,
  trace v3 on `level-0`). The aim-assist change below shifts the seeded gameplay stream, so the old trace
  desynced — it re-simmed to 3/4 kills with the fight unfinished. The new recording re-sims to 4 kills, all
  five cards (`p0|p1|p2|p3|p4`) and a win at tick 2503, so `22-intro-replay` is green again. Uploaded to
  `s3://vega-sentinels-assets/recordings/` (immutable, content-hashed) and wired into the level-0
  descriptor's `introTrace`. Because the cutscene's pauses are triggered by SIM EVENTS rather than fixed
  ticks, the script needed no changes to survive the re-record. Shipped to prod (CI/CD) and **re-published to
  itch** (butler build #1885217 / version 61) in the same pass — the itch bundle carries the trace file but
  reads the catalog live from prod, so a hash change there breaks the cutscene into a 404 until it is
  re-pushed. The superseded `level0-intro.0526e940.json` was deleted from S3 afterwards.
- **`record-playback` skill: the record URL is `?record=1&level=0`, not `level=1`.** It had gone stale when
  the campaign went 0-based (DECISIONS §102) — following it would have captured the wrong fight. Noted why
  old traces still carry `level: 'level-1'` (shifted at load by `traceLevelName`).
- **Aim assist now aims at the target's HULL, not a dot at its centre.** The auto-aim cone treated every
  ship as a zero-size point, so a target only engaged the assist when its **centre** fell inside the
  `aimAssistDeg` cone — a needle 0.35 u wide at 10 u. Fly head-on at a ship and your bullets would stream
  past its wing with the launch angle never changing; the hits that did land were the wing drifting into
  the line of fire, not the assist correcting for you. Each candidate now carries its `broadRadius(ship)`
  enclosing sphere (the same one the collision broad-phase uses) into an exact sphere-vs-cone test, so any
  part of the hull overlapping the cone engages the assist and the shot bends onto the hull centre. The
  winner also changed from **nearest** to **best-aimed** (smallest angle from the aim axis to the hull's
  near edge): with hull radii several ships can qualify at once, and picking by distance would let a closer
  bystander steal fire from the ship the player is actually pointing at. Symmetric as before — enemy guns
  get the same treatment against the player. Trig-free in the loop (tan/cos hoisted), so it costs slightly
  **less** per candidate than the old normalize-and-dot. `nearestInConeIndex` (`client/src/steering.js`) +
  `findBulletAimTarget` (`client/src/projectiles.js`); guarded by new cases in `steering.test.js` covering
  the wing engagement, the bystander-steal, and behind/outside rejection. Still pure and RNG-free.
  **Target leading is unchanged** (still none) — that's a separate change.

## 2026-08-14

- **The freighter side mission is reachable again — moved to `(-100,-950)`.** When the flyable star system
  moved the mining and research sites out to their new distances, the freighter was left behind and never
  got an `ANCHORS` entry or a host object in `listSystemObjects()`. The result was a mission you could take
  from the board and then had no way to reach: `objectForMission('side-freighter')` returned `null`, so the
  gold off-screen pointer and the "Autopilot to Mission" button both hid, and no zone was ever armed. Its
  centre now sits at `(-100,-950)` (~955 u belt-ward and "north", a crossing comparable to science/mining
  and clear of the space factory's short hop), with a matching `freighter` map object — `kind: 'freighter'`,
  a new navigation-list label, and a coral marker. The set-piece moved with it to `(-100,-900)`, keeping the
  deliberate +50 z offset that puts the freighter ahead of the player's forward-gliding spawn. Server tests
  already covered offering and activating the mission, which is why this passed unnoticed — the gap was
  reachability, so a test now pins that **exactly the three side missions carry a host object** and each
  resolves back to it. `SUMMARY.md`'s mission-centre line was also stale for mining and research (still the
  pre-star-system `(-550,0)` / `(400,0)`) and is corrected.
- **Sim loop de-duplicated + `update(dt)` sectioned (pure refactor, no behaviour change).** The
  fixed-timestep tick body was written twice in `client/src/main.js` — once in `animate()`'s accumulator,
  once in `window.__replay.step(n)` ("mirror the accumulator") — so an edit to one could silently desync
  replays. Both now call one shared `stepReplayTick()` in `client/src/replay.js` (dependency-injected,
  8 new unit tests). The two copies' guards differed (`!rs.done` vs `!(rs.play && rs.done)`); they
  disagree only in the post-intro teardown state (`rs.play` nulled by `finishIntro`, `rs.done` still
  true), which the `?record`/`?playback`-only `step()` hook can never reach — so they are unified on the
  accumulator's live-play-safe form, with a unit test pinning that a torn-down session keeps stepping.
  `client/src/sim.js`'s 471-line `update(dt)` was split along its existing comment sections into 12
  module-local `step*()` functions (all still in `sim.js`); `update()` is now a table of contents. Proven
  behaviour-neutral by a before/after `__replay.hash()` parity run over the whole Level-0 intro re-sim
  (43 samples, byte-identical at every milestone), plus `22-intro-replay`.
- **Ion engine + Nanobot repair unlock by clearing "Research station"; the gold "(new)" trail now reaches
  the shelf.** Second shop-gate kind (`stats.minMission`, catalog `RESEARCH_GATE`) enforced server-side in
  `buyItem` and mirrored by the client's single `buyableNow()` predicate; side-mission **completion is now
  persisted** (`cleared_missions` + `POST /api/players/:id/missions/clear`, reported from the victory path)
  and shipped to the client as `activeShip.clearedMissions`. Players already past the side-mission board
  gate are **grandfathered** by a one-shot migration (`grandfather_research_clear`) so nobody loses gear off
  their shelf. The mission board shows a **Cleared** badge (precedence Cleared > Active > Taken). Inside the
  shop, the type tab holding a never-clicked newly unlocked item goes **gold** instead of blue, and so does
  the item's row — clicking the row clears it; the menu + Shop-button "(new)" keep clearing on shop-open
  (separate localStorage keys, both first-sight baselined; the pure state machine moved to
  `client/src/shop-markers.js`). A baseline taken **before** a gate kind existed absorbs the rows that kind
  just gated, so grandfathered players are not told that gear they have been buying for weeks is "(new)".
  See DECISIONS §110/§111.

- **The "(new)" marker no longer greets existing players with gear they have owned for weeks.** The
  seen-set baseline is now **primed at bootstrap** (`primeShopItemsSeen()` in `shop.js`, called from
  `main.js` once `G.activeShip` lands): the first time a device sees a player, whatever is **already
  unlocked counts as already seen**. Before this, an empty store read as "nothing seen", so shipping the
  "Level 3" gate to the live game flagged the Heavy hull / Heavy Machine Gun / Triple spiral rocket as
  new to every player who had cleared the factory long ago. The marker now fires only on an unlock the
  player **lived through** — someone short of the gate baselines to the empty set, so clearing the factory
  still lights it. A corrupt or unreadable store re-primes rather than re-arming, so a storage hiccup can
  never invent a marker. Guarded in the `05-hangar-shop` visual scenario by a player advanced past the
  gate **before** their first page load: baseline holds the three gated items, marker stays dark.

- **Roam navigation HUD: a gold mission pointer + two nav buttons.** While roaming the star system, a **gold
  off-screen edge arrow** now points toward your active mission (hidden once the mission is on-screen), and a
  **bottom-center bar** carries two buttons: **"Return to Base"** (flies the dock autopilot home) and
  **"Autopilot to Mission"** (flies to where your mission is). Each button doubles as its own cancel —
  clicking the destination you're already flying to drops back to manual, and the live one is outlined so you
  can tell which autopilot is running. When there's no active mission target both the pointer and the mission
  button disappear, leaving just Return to Base. The mission's place is snapshotted on entering roam via the
  existing `objectForActiveMission` (side mission → its object, campaign → the object nearest its fight
  centre). New: `updateMissionMarker` (`hud.js`), `updateRoamNav` + `cancelAutopilot` (`sim.js`), `#roam-nav`
  markup + CSS, `ui.roam.return` / `ui.roam.autopilot` strings (EN + RU). Guarded by the `32-star-system`
  visual scenario (pointer shows off-screen, both buttons engage/cancel the right autopilot, both hide with no
  mission).

- **The "(new)" marker now leads all the way to the shelf.** The same gold "(new)" that announces newly
  unlocked gear rides not just the Loadout menu item but also the **Shop button inside the Loadout panel**
  (reusing `.mw-new`), so it draws the player from the menu, through Loadout, to the actual shelf. And it
  now **clears only when the player opens the shop** — previously it cleared the instant you entered
  Loadout, which would have hidden the Shop-button marker before it could show. The `open-shop` action marks
  the items seen and fires a `shop-items-seen` event that refreshes the menu marker (`shop.js` /
  `mainwindow.js`). The `05-hangar-shop` visual scenario now asserts the marker persists through Loadout,
  sits on the Shop button, and clears on opening the shop.

## 2026-08-11

- **The mid-game gear tier is now earned, not just afforded: Heavy hull, Heavy Machine Gun and Triple
  spiral rocket go on sale only after clearing "Level 3" (the weapons factory).** A catalog row can now
  name a level gate (`stats.minLevel`, `FACTORY_GATE = 'level-4'` in `catalog_seed.js`), compared by level
  NAME like every other progress gate (DECISIONS §95). Before the factory falls, those three rows are
  **absent from the shop list** — no greyed-out teaser (DECISIONS §108) — and the server refuses the
  purchase outright (`buyItem` → 403 `item locked`), so the list is presentation and the gate is real.
  **Looted copies are unaffected**: a gated item that drops still banks into the stash and equips. The
  client mirrors the gate from the new `activeShip.reachedLevels` (level names shipped with the active
  ship), never from a raw id.

- **Heavy Machine Gun rebalanced for its new slot at the top of the ladder: weight 8 → 15, aim assist
  2° → 3°.** It is the heaviest gun in the game now (Heavy cannon 10, Machine Gun 8), so mounting it costs
  real acceleration and turn — it is meant to pair with the Heavy hull that unlocks beside it, not to be a
  free upgrade. The wider auto-aim cone is what makes its rate of fire land at speed.

- **A gold "(new)" marker on the Loadout menu item when new gear unlocks.** Plain inline text in the same
  gold as the free-skill-points pill (`#mw-loadout-new`, string `ui.mainwin.new`, EN + RU) — no count, it
  just says "look here". It appears when a level-gated shop row becomes buyable and **clears the moment the
  player opens Loadout**; the seen set is per-player `localStorage` and is pruned to what is unlocked now,
  so a progress reset re-arms it. Only gated rows count, so it stays rare instead of becoming permanent
  chrome. Covered by the `05-hangar-shop` visual scenario (marker shown → cleared on open → stays cleared)
  plus new server tests for the gate itself (403 before the factory, 200 and in the stash after).

## 2026-08-10

- **Shop owned badge reads as an aside: "(owned ×N)".** Was "Owned ×N" — now lowercase and in
  parentheses so it sits quietly after the item name instead of competing with it ("Advanced thrusters
  (owned ×1)"). String-only change in `client/locales/source.json` + the RU translation
  ("(в наличии ×{n})"); the `05-hangar-shop` visual scenario asserts the new wording.

- **`M` toggles the system map (desktop).** The same overlay the on-screen **Map** button opens, on a key.
  Gated exactly like that button — **out of combat only**: during a live fight the corner is the battle
  radar, and since the overlay freezes the sim an ungated M would be a way to pause a fight. A modifier
  passes through (**Cmd+M stays "minimise window"** on macOS) and so does an "m" typed into a text field.
  Wired separately from the sim's global keydown, which mirrors every code into `keys` for the input
  recorder — this is UI, not input. Discoverability: the Map button, which appears exactly when the shortcut
  works, now names it in its tooltip (`ui.map.shortcut`, EN+RU, mouse devices only). The `#help` cheatsheet
  is deliberately left alone: it is the combat cheatsheet, and M does nothing there.
  Guarded by `32-star-system` checks 0 and 12 (inert in a fight; toggles out of combat; modifier and
  typed-into-a-field both ignored; tooltip present) — driven through real key events, because the first cut
  of this **crashed the whole client on load** with a duplicate `Device` import in `welcome.js`, which no
  unit test sees and only loading the page catches.

- **The parallax speed field now gets out of the sun's way.** Its specks are rock-grey and deliberately
  non-additive (dust, not stars), and the field lives in the **combat** scene, which is drawn on top of the
  sky scene — so next to the star they landed straight over its smooth bright disk and read as dirt on the
  lens. A/B on one rendered frame (field forced on vs faded) put a number on it: **19 265 changed pixels**
  in the sun's neighbourhood, **15 054 of them on the disk itself**, peak delta 231 — near-black specks on a
  near-white surface. The field now fades out as you close on the star (`system.star.dust` / `dustNear` 400 /
  `dustFar` 760, smoothstep, same shape as the backdrop lift). The ramp begins exactly where the star becomes
  visible at all (`fade.out`), so everywhere you fly and fight it is untouched — and the "you are moving" cue
  survives, because parallax against a huge close body sells motion better than dust did. Brightening the
  specks or making them additive was rejected: white-on-yellow is still a blemish on a smooth gradient, and
  additive turns them into sparks, the exact look the field's own design notes reject.
  Guarded by `32-star-system` check 11 (gone at the star, full strength at the base — a global dimming would
  fail the second half).

- **The sky light now comes FROM the star.** The directional light that shapes the planets' and moons'
  terminator sat at an authored fixed position (`sky.sun.pos`), which had it arriving **64° off** the star's
  real bearing — and inverted along z, so at the base the home planet's lit limb faced *away* from Vega.
  It is now placed at the star's world position and aimed at the ship every frame (`aimSkySunAtStar`).
  Measured on the rendered pixels, not just the vectors: the brightest side of the home planet's disk went
  from **89° off** the star's on-screen bearing to **16°** (one bucket of a 24-direction sweep), and the
  light vector itself from 64° to 1.3° (the remainder is the ~1° parallax between the ship and the body it
  lights — the light is aimed at the ship, which is what keeps it correct 22 000 u away at another planet).
  `?tune`'s sun-position sliders are gone (they would be overwritten every frame); colour + intensity stay
  authored. Guarded by `32-star-system` check 10, at the base *and* after flying to planet 3 — a per-body
  constant would pass the first and fail the second.

- **Fixed a sky-light leak: `buildMap` never removed the lights it replaced.** Every level start / map
  switch created a new ambient + directional light for the sky scene and left the old pair in it, so they
  **accumulated across a session** — the planets got brighter and their terminator flatter the longer you
  played. Found while measuring the change above: the probe kept reading a stale light whose target never
  moved, while the live one was aimed correctly. Same class of leak the nebula render target already
  guarded against. Now removed on rebuild, and pinned by an assertion that exactly one of each survives.

- **Vega is a real sun now — a `.glb` star with a corona, slow rotation, and a wash on the backdrop.**
  The central star was an emissive sphere plus one glow sprite; it is now the **"Sun"** model by
  **SebastianSosnowski** (Sketchfab, CC-BY 4.0), through the normal asset pipeline: a new `sun` preset in
  `assets-config.mjs` (geometry kept — decimating a sphere this big on screen only buys faceting; textures
  512 WebP), **2.1 MB → 167 KB**, pushed to S3 and wired as a content-hashed same-origin URL on the map
  descriptor's `system.star` block. Also:
  - **30% bigger** — `size` 74 → **96** (1.6x a planet). The model's longest axis normalizes to `size*2`, so
    it exactly fills the sphere it replaced, and the corona scales off the same number. Still permanently out
    of reach: its top sits `depth − size` = 204 below the flight plane.
  - **All yellow.** The asset ships two concentric spheres — an orange emissive core inside a slightly larger
    yellow **transmissive** shell — and the shell is see-through face-on, so drawing both gave an orange disk
    with a yellow limb ("two halves of different oranges"). The core is now hidden (`system.star.yellowOnly`)
    and the shell is the star. Tinting the core yellow is not possible: its colour is an orange emissive
    TEXTURE and a material colour only multiplies it, which cannot raise the green channel.
  - **A real corona** — two additive layers (5.0 and 11.0 star-radii wide) instead of one 3.0-wide sprite.
    The old one was invisible for a reason: the shared glow texture's falloff sits at 0.275 of the sprite
    width, so at 3.0 the entire glow fell BEHIND the disk and only a thin rim showed. Layer brightness rides
    the colour, because the distance fade overwrites `material.opacity` every frame.
  - **Slow rotation** (0.02 rad/s, ~5 min/turn) and a **backdrop wash**: closing on the star brightens the sky
    background by up to +35% on a smoothstep from 1200 u to 300 u. Both background paths are covered — the
    baked nebula cubemap via `backgroundIntensity`, the flat-colour fallback by multiplying in place (they
    were verified separately; `?debug` disables the nebula bake, so testing only that path would have missed
    what players actually see). `liftFar` sits just outside `fade.out` (760) so the wash grows as the star
    fades in — from 3000 it brightened thousands of units of visibly empty space and read as a bug.
  - **Perf, stated plainly:** the shell is a `MeshPhysicalMaterial` with `transmission: 1`, the priciest
    material in the game (an extra render target per frame). It is affordable only because the distance fade
    hides the whole star outside 760 u, so the pass never runs at the base or anywhere but the star's own
    neighbourhood. Replacing it with an unlit material was tried and reverted — the yellow comes from the
    transmission, not a texture, so the flat version rendered orange.
  - Guarded on the real scene by `32-star-system` check 9 (model loaded, exactly one sphere drawn and it is
    the transmissive one, core present-but-hidden, both corona layers, corona clears the disk, materials
    registered for the fade). Credits: `CREDITS.md` row + verbatim CC-BY attribution + the in-game credits
    screen via `credits:build` (12 models now).

- **`assets:check` now guards models referenced from a MAP DESCRIPTOR.** The deploy guard walked ships,
  components, weapons, SFX, the intro trace and the loot-drop model — but never the map descriptors, so the
  `.glb` set-pieces (freighter, base station, space factory) and the new star model were in an unchecked
  lane: a bad content hash shipped a 404, and the object silently vanished (or the star fell back to a flat
  sphere) with nothing failing the deploy. Covers 49 assets now, 7 of them previously unchecked.

- **Fixed a latent flaky assertion in `32-star-system`.** "Turning the ship does not move a body" asserted
  `turnShift < 1e-6`, but its two samples are taken at different wall-clock times and the bodies drift along
  their orbits between them — the star alone moves ~0.73 u/s, and `Date.now()` ticks in whole milliseconds,
  so the floor is ~7e-4 whenever the reads straddle a millisecond. It passed by luck. Threshold is now 0.5 u,
  which still proves the point: the bug it guards (a camera-anchored re-projection) swings bodies by hundreds
  of units, not fractions of one.

- **"Level 4" now fights at the far belt outpost, and that outpost moved further out.** The third mining
  outpost (`ANCHORS.mining3` + its `asteroid-field` set-piece) moved from `(-760,1560)` to `(-900,2800)`,
  making it the system's most distant destination (~2941 u from the base, past `mining2`'s 1893). The
  campaign's "Level 4" — "Find the pirate base" — now names that exact point as its `center`, so it is the
  second level (after "Level 3" at the Space Factory) that does not fight at the origin: Take off launches
  you at the base, you fly the trail out to the outpost, and crossing into the zone starts the fight among
  the rigs. The centre sits **exactly on** the anchor rather than offset off it (the factory is offset 30 u
  so the station frames beside the ship; a scattered below-plane asteroid field has nothing to frame around),
  which also gives the fly-in countdown its full 200 u margin. The map's dashed gold "your mission is here"
  frame follows automatically, marking the outpost. New guard in `level-sim.test.js`: **every** level that
  names a centre must park you inside its own fly-in zone (nearest `ANCHORS` entry < `MISSION_ZONE_RADIUS`)
  — it fails for a centre dropped more than 200 u from any landmark, the silent "fly there and nothing
  happens" bug.
- **The map marks where your mission is.** The object hosting the ACTIVE mission now carries a dashed gold
  frame in the object list and a dashed gold ring on the map — in the base-menu Map and the in-flight
  overlay alike (one component). A side mission is matched by its id; the campaign, which names a fight
  CENTRE rather than an object, is derived: the nearest object within `MISSION_ZONE_RADIUS` of the level's
  `runCenter` — the same 200 u that starts the fight when you fly in (new pure `objectForActiveMission`,
  DECISIONS §105). So the factory level marks the Space Factory; a level with no centre fights at the origin
  and marks the home planet. Unit-tested in `system-map.test.js`, guarded end-to-end in `32-star-system`.
- **Phone map layout: list on the right, map down to the bottom.** The star-system navigation component
  stacked on `body.dev-phone`, which split a 390px-tall landscape phone into two strips — a 149px map above
  a 153px list. It now keeps the desktop's side-by-side shape: the map fills the central area to the bottom
  edge (383×308 on that screen) and the object list is a 38%/260px column on the right, its Take off /
  Autopilot buttons stacked full-width. Applies to both hosts (base-menu Map and the in-flight overlay).
  Also fixed a pre-existing collision the wider layout made obvious: in the base menu the bottom action
  button ran under the floating ⛶ fullscreen button, which drew over it and took the tap — the column now
  reserves 52px there (and takes it back when ⛶ is hidden: already fullscreen, or no fullscreen API). New
  `34-phone-map-layout` scenario pins both hosts and hit-tests that bottom button; it fails on the old CSS.
- **Fixed: on a phone the in-flight "Map" button did nothing.** `#map-btn` shipped at `z-index: 5` — the
  same layer as `#touch`, whose full-screen `#stick-zone` takes pointer events everywhere and comes LATER
  in the document, so it won the hit test and swallowed every tap. Desktop was unaffected (`#touch` is
  hidden there), which is why it survived. The button now sits at `z-index: 6`, like `#rocket-btn` and
  `#return-btn`, which solved the same collision. Guarded by a hit test (not a z-index number) in
  `15-mobile-landscape`: with the touch layer live it asserts `elementFromPoint` at the button's centre is
  the button — it fails on the old CSS.
- **No "Launch mission" button on the campaign — "Take off" is the one launch control.** Since every
  campaign level starts by flying to its zone, `launchCampaign()` and `takeOff()` are the same call
  (`enterRoam(null)`), so the two buttons only asked the player to guess at a difference that no longer
  existed. `#mw-go` (and its hint note) is hidden whenever the campaign is the active mission, on every
  level, and starts hidden in the markup; it still appears — as "Launch mission: <name>" — for an active
  **side** mission, which really does drop straight into its own level. DECISIONS §104. The visual suite
  followed: every scenario that started the campaign by clicking `#mw-go` now clicks `#mw-takeoff` (the
  control a player actually has), `18-briefing-staged-reveal` asserts the reveal on `#mw-takeoff`, and
  `10-mission-board` + `32-star-system` gained guards that the button is hidden for the campaign and comes
  back, mission-named, for an active side mission.
- **Level up now happens in the fight, not back at base.** The XP bar resolves the level itself every
  frame (`liveProgress` in the new `client/src/progression.js`, a tested mirror of the server curve —
  DECISIONS §103): crossing a threshold mid-combat immediately bumps the displayed level, empties the bar
  toward the next one, and fires the centered "Level up" toast. Previously the bar sat pinned at 100% for
  the rest of the mission and the toast only appeared after `bankRun`, back at base. The toast is deduped
  by level (`announceLevel`), so banking doesn't repeat it. `bankRun` also refreshes
  `xpIntoLevel`/`xpForNextLevel` from the banked experience and zeroes `G.earnedXp` — fixing a
  pre-existing double-count where the post-victory active-ship refetch left the run's XP counted twice.
  **Seen on prod**: a player with 950 banked XP read `Level 0 · 1900/1000` on the base XP bar (950 refetched
  + 950 still previewed). The same refetch now `await`s the bank POST (`bankingDone()` in `net.js`), so it
  can no longer read the pre-run experience and overwrite the freshly banked progression with it.
- **Home station moved 50 right + 50 down, to `(-10,-10)`.** `ANCHORS.base` (`client/src/system-map.js`)
  and the `base-station` set-piece in `server/src/catalog_seed.js` `home-system` moved together from
  `(-60,-60)`, keeping the four-way invariant (pinned by `system-map.test.js`). It now sits further from
  the home planet's rendered sphere (planet 2 draws at `(-150,-110)` = anchor `(0,0)` + `SYSTEM.offset`)
  and 14 u off the campaign arena center. Verified sim-neutral: the station is non-collidable below-plane
  decor, the campaign levels and side missions key their spawns off `descriptor.center` (Level 0 / Level 1
  at `(0,0)`, untouched), and the base activity zone still contains the `(0,0)` spawn. The intro-replay
  guard (`node visual/run.mjs 22-intro-replay`) reports an identical run before/after — 4 kills, cards
  `p0..p4`, `won=true`, same end tick 2213. Full client (294) + server (127) suites green.
  Two accepted consequences: the origin-spawning ship is now framed **over** the station in Level 0 /
  Level 1 / the intro, and the post-victory flight home from the campaign arena is inside
  `BASE_ARRIVE_RADIUS` (45 u), so docking completes almost immediately.

- **Bigger star/planet markers on the system map.** The star and the four planets are drawn at double
  their old marker radius (star 7→14px, planets 5→10px) in `systemmap-ui.js`; stations, belt outposts
  and the factory keep 4px. The celestial bodies now read as bodies at a glance instead of blending
  into the man-made anchors, and they're easier to hit with a tap. Selection ring, lock ring and label
  offsets follow the radius, so they scale with it.

- **Base-menu Map now clears the XP bar by 10px.** The **Map** view hides the global launch bar, so the
  map canvas and the object list's action row (**Take off** / **Autopilot to destination**) ran down
  under `#xp-bar`, which floats over the base. `#mw-view-map` gets `padding-bottom: 16px` — the bar's top
  edge sits 20px off the viewport bottom and `#mainwin` already pads 14px, so the view's content lands
  exactly 10px above it (measured headless at 1280x800: canvas/buttons bottom 770, bar top 780).
  Cosmetic only; the in-flight overlay map is unchanged.

- **Levels are 0-based now, and one number means one level (DECISIONS §102).** A level's row id, its
  `levels.name` and its player-facing title were three numbers that disagreed — row `level-4` was titled
  "Level 3" and a player on it had `current_progress = 4` — and `levels.id` had additionally drifted on
  production to 1, 6, 7, 71, 564, because the old name-keyed upsert burned a sequence value on every boot.
  That ambiguity cost two wrong answers in a single session (a feature built on the wrong level, then a
  gate wrongly diagnosed as broken). Now **id = name number = title number**, 0-based, 0 = the intro, and
  `current_progress` reads as the level number. Ids are explicit in `catalog_seed.js` and upserted
  `ON CONFLICT (id)`, which pins them and ends the drift. A one-shot migration (`levels_zero_based_ids`)
  maps **by name**, never arithmetic — the drifted prod ids are not a shift of anything — parking both `id`
  and `name` clear of their targets before assigning (both collide mid-move, and `name` is UNIQUE), moving
  `players.current_progress` in lockstep with the FK dropped, rewriting `gameplay_sessions.level`, then
  restoring the FK and setting the column default to 0. `levels_drift.test.js` was rewritten around it: it
  now builds a legacy-shaped database (old names, the real drifted ids, players and a recorded session
  pointing at them) and migrates it, asserting nobody's progress moves to different content. Content gates
  stay name-based (§95 unchanged); `SHOP_MIN_LEVEL`/`SIDE_MISSIONS_MIN_LEVEL` moved down one with everything
  else and gate the same two moments.

- **Recorded traces are v3 — replaying the archive after the renumbering.** A trace stores the level NAME it
  was recorded on, so every existing recording (the shipped intro asset included) names a level one too
  high. Caught by `22-intro-replay`, which stopped winning: playback resolved `/api/levels/level-1` and
  re-simmed "Level 1" with input recorded on the intro (`kills=4 enemiesLeft=2 won=false`). `TRACE_VERSION`
  went to 3 purely as a marker, and the new pure `traceLevelName()` shifts v1/v2 traces down one at the
  single boundary where a stored name is read. A blanket alias in `normalizeLevelName` was rejected —
  `level-1` is a perfectly good CURRENT name, so aliasing it would break the live campaign to fix the
  archive. Nothing on S3 was rewritten. Intro guard back to byte-identical (kills=4, cards p0..p4,
  tick 2213/2730).

- **The factory fight moved to "Level 3", and Take off is a take-off again.** The combat centre sits on the
  level AFTER the one that drops the repair drone — the first to field a real boss (`first pirate boss`;
  Level 2's `pirate mini boss` is the mid-boss its own victory text calls it) — which is also what
  `docs/narrative/canon.md` has always said ("Level 2 — reach the weapons factory", "Level 3 — take the
  factory"). It had been put on Level 2 by mistake. Pressing **Take off** on a level that names a `center`
  no longer drops you into the fight at that centre: it launches you from the **home base** and you fly out,
  the fight starting when you cross into the zone. Levels without a `center` fight at the origin and are
  untouched. En route: the seed's inline `text` fallback for `level.3.briefing` was a stale copy that
  predated the canon rewrite (drone only, no factory assault) — synced to the i18n source, which is the
  single source of truth the player actually sees.

- **Take off, fly to the mission, and it starts — for EVERY campaign level.** Crossing within **200 u** of
  the ACTIVE campaign mission's centre starts a **3-second countdown** on the HUD
  ("Contact in 3…" / "Контакт через 3…"), and then the fight simply begins there. Flying back out **cancels**
  it, and it can't re-fire without leaving and returning. Gated exactly as asked — it arms **only when that
  mission is the active one**: `mainwindow.enterRoam` sets `G.missionZone` only when no side mission is
  taken (`activeMissionId == null`). The centre comes from `runCenter`, so a level that names one is its own
  place in the system and **every other level is the origin** — which is the base you take off from, so
  those missions start right after take-off. That is the point: if pirates are sitting on your station you
  fight them, you do not stroll past. Reached however you get there — autopilot cruise or hand-flown (the
  check sits outside sim.js's autopilot/manual split). **Take off no longer starts a fight directly at all**:
  `launchCampaign` always launches you at the base and hands over to the countdown; only the countdown's
  `engage: true` return trip starts the level (and arms the session recorder).
  Two things the ship does NOT do, both fixed after play-testing: **taking off never teleports you to the
  mission** (in roam `reset()` spawns at the origin — the home station — no matter where the level names its
  centre; before this, Take off on the factory level dropped you straight at the factory), and **arriving
  never re-positions you** (`reset({ keepPlayer: true })` on the engage path keeps the ship's position,
  heading and velocity, so the enemies come to you and the fight opens mid-flight instead of snapping you to
  a standstill at the arena centre). Both are pinned in `33-space-factory`.
  **And the handover costs nothing.** Starting the fight used to re-tear-down and rebuild the map's seven
  set-pieces — re-fetching and re-parsing every `.glb` for a world that was already standing, identical —
  and `levelRunner.start()` pulled in the enemy models on that same frame. Measured: **3 `.glb` loads in
  flight on the engage frame**. Now `reset({ keepWorld: true })` keeps the existing set-pieces (a cold start
  still rebuilds them, which is what resets the cruising freighter), and the **countdown is spent warming**
  the enemy models + the last-kill reward model, so the frame the mission starts kicks off nothing at all.
  The scenario asserts `pendingAssets === 0` and an unchanged parsed-model count on that exact frame; both
  fail (3 in flight) if `keepWorld` is dropped.
  One exception, or the star system would be unreachable on four levels out of five: **a countdown never
  runs while you are on your way somewhere else** — an autopilot cruising to a point outside the zone (a
  planet, a belt outpost) or a dock autopilot heading for the home station. Picking a destination is an
  explicit "not now"; without it, every trip out died three seconds after take-off and the "Dock at the
  station?" prompt was eaten by the fight starting first. A destination INSIDE the zone (the factory anchor
  is ~131 u from the Level 3 centre) is not "somewhere else" — that trip is how you reach the mission. The countdown itself is the pure, unit-tested **`stepMissionZone`** seam in `level-sim.js`
  (arm on entry / cancel on exit / fire once / NaN-safe), and the 200 u radius is pinned by a test against
  the ~131 u gap between the map's factory destination and the level centre — too tight and arriving by
  autopilot would park you just outside and nothing would ever happen. The `33-space-factory` visual
  scenario drives the whole thing on the real engine: sit outside → nothing; cross in → the count runs and
  the banner is actually **painted at full opacity** (the count is stepped in `update()` but drawn in the
  render pass, so the test lets real frames run rather than trusting `stepSim`); leave → cancels; stay →
  roam ends and the arena is centred at the factory.

- **"Level 2" now fights AT the Space Factory — and a campaign level can finally name its own combat
  centre.** The level whose briefing sends you to the weapons factory (and the first with a `boss` phase,
  the `pirate mini boss`) now spawns you **30 u up-left of the factory** at `(-450,-435)` instead of the
  origin, so you arrive with the station sprawling down-right of you. Getting there needed a real fix:
  `sim.js` resolved the combat centre from `G.activeMission.center` alone, which is **null for the
  campaign** — a `center` on a campaign level descriptor was accepted by the seed and **silently ignored**,
  pinning every campaign run to (0,0). Extracted the resolution into a pure **`runCenter(activeMission,
  levelDescriptor)`** seam in `level-sim.js` (active side mission wins → else the level's own → else the
  origin, NaN-proofed per axis) and unit-tested it, including a guard that **exactly one** campaign level
  names a centre, that it is the boss/factory level, and that it stays pinned to the set-piece position
  + (-30,-30). The `33-space-factory` visual scenario drives the campaign path through the real `reset()`
  and asserts the arena and the player spawn land there, with a frame to eyeball.
  Note when tuning: the post-victory return-to-base flight for this level is now ~570 u instead of ~85 u
  (the dock autopilot is uncapped, so a cruise), and any session replay of `level-3` recorded before today
  starts from the old origin spawn. `22-intro-replay` re-verified byte-identical (Level 0 has no centre).

- **New system object: the Space Factory.** An orbital industrial ring station now sits at **(-350, -350)**
  — up-left of the home planet, ~495 u out, about **two screens diagonally** at zoom 1 (a screen is
  ~204 x 115 u). It is a **first-class navigation destination**: `ANCHORS.factory` + a `listSystemObjects`
  entry (new `kind: 'factory'`) in `client/src/system-map.js`, so it draws a marker on the system map, is
  listed and selectable in the object panel, and autopilot flies to it — with a matching **`space-factory`
  set-piece** in `catalog_seed.js`, so arriving finds the station rather than empty space.
  It carries **no mission**. Deliberately the system's one SHORT hop: it sits just past the base activity
  zone (`ZONE_RADIUS` 360), against the ~1000 u belt/science crossings. Names are i18n'd (EN
  "Space Factory" / RU "Орбитальный завод", plus the `Factory` / `Завод` kind label).
  `world.js`'s `makeBaseStation` was generalized into a shared **`makeStationModel`** (async center/scale/
  `yaw` normalization + slow spin) that both station set-pieces use; `STATION_LEN` normalizes the factory to
  **120 u** against the base station's 100, so it reads as the bigger facility (~85% of the frame height at
  its depth) without overflowing the frame. The model is placed **(-70,-55) off the anchor**, not on it:
  centred, autopilot parked the ship dead on the station's brightest point and the ~15 u ship vanished into
  the 120 u structure — caught by looking at the rendered frame, not by any assertion. New guards: a unit
  test pins that **every navigation anchor with a physical set-piece matches the seed position** (offset
  included, `system-map.test.js` importing `MAPS`) — drift there is a silent bug that only shows up as
  autopilot parking you in empty space — and a new **`33-space-factory` visual scenario** flies to the
  anchor and asserts the station is on-screen, covers a sane fraction of the viewport (not a speck, not the
  whole frame) and stays entirely below the flight plane. `32-star-system`'s two hard-coded object counts
  (10 → 11) were updated with it. `22-intro-replay` re-verified byte-identical (kills=4, cards p0..p4,
  tick 2213/2730) — a set-piece is decor and draws no seeded RNG (DECISIONS §73).

- **Asset: `space_factory_combat` (CC-BY, rivetech) — 6.7 MB source → 159 KB.** The model is
  texture-dominated (4.6 MB of it is eight 1024² PNGs, ~45 MB of VRAM, against ~2 MB of geometry), so a new
  `space_factory` preset override in `scripts/assets-config.mjs` shrinks every texture to **256px WebP** —
  159 KB download, **~2.8 MB VRAM** (down from 44.7 MB). It sets `pruneSolidTextures: false` because the
  emissive maps are mostly black with small lit windows, exactly what `optimize`'s solid-texture heuristic
  flattens — which would have made the whole hull glow. 256 rather than the metal box's 128 because the
  station is big on screen. CREDITS.md gained its row + verbatim CC-BY attribution, and `credits-data.js`
  was regenerated.

## 2026-08-09

- **Mission count badge on the base menu.** The **Missions** item now carries the same gold pill the
  **Character** item uses for free skill points, showing how many side missions are on offer
  (`#mw-missions-badge` + `updateMissionsBadge` in `mainwindow.js`, fed from `missionOffers` on every board
  render). It counts **all offers**, so taking one doesn't decrement it, and the always-present campaign card
  isn't counted; the badge is hidden at zero (before the board unlocks after "Level 3"). The badge CSS was
  generalized from `#mw-char-badge` to a shared `.mw-badge` class, and the Missions label moved into a child
  `<span data-i18n>` so the i18n `textContent` write can't wipe the badge. Asserted in the
  `10-mission-board` visual scenario (badge shows "3", and stays "3" after taking a mission).

- **[2026-08-09-1456-star-system-map] "Return to base" now flies home at full speed, and you can click the
  station while roaming.** The end-of-mission return crawled at the combat cap because the speed cap was
  gated on `roam` — a conservative proxy for the real replay invariant, which is that a replay reproduces the
  recorded **INPUT** stream, and an **autopilot leg is not input-driven** (the intro replayer literally
  freezes the trace index and zeroes input while the dock autopilot flies home). Measured first: uncapping
  the dock leg leaves `22-intro-replay` byte-identical. So the dock autopilot is now uncapped in **both**
  states, while manual flight stays capped everywhere and a mid-combat drop-grab autopilot stays capped too.
  Separately, **clicking the home station now works during free flight**, not only after the last kill:
  it engages the dock autopilot, flies you back, and raises a **"Dock at the station?"** confirm (EN+RU) that
  ends the flight in the base menu — the flown counterpart of the map's teleporting "Return to hangar". It
  wins nothing (there is no mission in roam). Fixed en route, exposed by the higher arrival speed: the
  autopilot chased its goal past it, overshot and settled into a **~10 u/s orbit around the target**, so an
  arrival predicate waiting for the ship to stop never fired — it now brakes once inside the arrive radius
  (drops excluded; their pickup radius owns that endgame). Guards: `capLifted` unit tests pin every cell of
  the new table; `32-star-system` flies home from 1 400 u and asserts the station is clickable in roam, the
  trip peaks above the combat cap, the ship parks at the station, the prompt fires and nothing is won. §101.
- **[2026-08-09-1456-star-system-map] Fix: the base menu had a yellow-and-blue backdrop.** `buildMap` built
  the star-system bodies but left their placement to the per-frame `updateSystemBodies`, and the hangar
  renders the scene while the sim is **not** ticking (`G.gameStarted` false) — so every body kept its
  default `(0,0,0)`, stacking the emissive star, its additive glow and the ocean planet exactly where the
  camera looks. `buildSystemBodies` now places (and fades) them immediately, and `updateSystemBodies` falls
  back to the origin — the base — when no ship exists yet. Guarded: `32-star-system` rebuilds the map with
  no frame in between and asserts no body sits at the origin and only the home planet is drawn (the guard
  fails with the fix reverted).
- **[2026-08-09-1456-star-system-map] Star-system navigation UI: one map+object-list component everywhere,
  and "Take off" on every base stage.** Choosing a destination now uses a single shared component
  (`systemmap-ui.mountSystemNav`) in all three hosts — the base-menu **Map** section, the in-flight overlay
  and mission activation. Layout is the **map pinned left** (next to the base's nav menu) with the **object
  list on the right**; the list and the markers are the same 10 objects (`listSystemObjects`): the **star and
  all four planets as first-class, selectable destinations** alongside the home station, the research station
  and **three** belt outposts (two new ones, `ANCHORS.mining2/3`, with matching asteroid-field set-pieces so
  arriving finds rigs, not empty space). Selecting a row or a marker highlights **both**; "Autopilot to
  destination" then flies you there — `enterRoam({pos, missionId})` from the base, `engagePointAutopilot` if
  already flying — and a body routes to its anchor, never to the (permanently distant) planet. The map
  **pans and zooms** (wheel + pinch, drag + one-finger drag, ± buttons) through a new pure, unit-tested
  `map-view.js` seam whose clamps make it impossible to fling the map into empty space or zoom to a
  degenerate scale. Objects are named through i18n (`ui.object.*`, EN + RU) — the star is **Vega**, the
  planets **Vega I–IV** — never raw ids; locked mission sites stay greyed with the unlock hint.
  **"Take off" is now on every stage** (Character/Missions/Loadout/Map/Craft) and means *free flight into the
  system*; on Map it sits inside the component's action row beside Autopilot. Because the old `#mw-go` said
  "Take off" but launched the **fight**, it was renamed **"Launch mission ⚔"** and keeps its behaviour (the
  campaign flow is untouched); the mission briefing also gained "Autopilot to destination" for the
  fly-there-then-"Start mission?" path. All launch controls share one gate — a missing hull/armor, engine or
  thruster disables the fight launch, Take off and Autopilot together, with the reason shown. Fixed in
  passing: `body.menu` never hid the `#touch` layer, so on a phone the **FIRE button stayed live on top of
  the base menu**. Guards: new `map-view.test.js` (inverse transform, zoom + centre clamps, cursor-anchored
  zoom, marker picking) + `system-map.test.js` object-model cases; `32-star-system` now drives the real UI
  (overlay re-routes in place, base Map lists 10 objects, selection enables Autopilot, Take off present on
  every stage, gate greys everything); headless rect check shows no fixed-HUD overlap on desktop or phone.
  `22-intro-replay` byte-identical. No new assets. §100.
- **[2026-08-09-1456-star-system-map] The star system is now REAL bodies laid out on the ecliptic — you fly
  to a planet instead of watching a sky dome — and zooming out no longer dims the game.** The
  bearing-projected camera-anchored backdrop is gone. The ship flies on the ecliptic plane and the camera
  looks **down** at it, so the star, the 4 planets and the home planet's two (restored) **moons** are now
  real spheres at **their own true (x,z) on that plane**, sunk `depth` below it at a shared framing offset —
  exactly the placement the game's original single home planet had, applied per body. Visible effects: at the
  base you see **only planet 2 and the station**; the other bodies are 9 000–45 000 u away and you **fly to
  them** (`planetAnchor` = a body's own (x,z), so reaching planet 3 is a real ~15 000 u crossing, and
  arriving frames it exactly the way the home planet is framed at base), fading in by distance from the ship
  rather than popping in at the far plane. Nothing is camera-anchored any more, so flying past a planet no
  longer makes it **jump** (passing one used to swing its bearing ~180°); a moon can no longer slide **into**
  its planet (unit-asserted clear of the limb at every angle); and a body is **permanently out of reach even
  directly overhead** — its top sits `depth − size` below the flight plane — so the "home planet looms at the
  base" behaviour is gone with no special case. The descriptor's `system` block is now **merged into** the
  client `SYSTEM` constant (`applySystemSpec`), so the renderer, the map screen and the `?roam` tunables can
  no longer disagree. `camera.far` 900 → 1300 so a still-fading body can't be clipped at max zoom.
  Separately, a real dimming bug: `THREE.Fog` measures depth **from the camera**, and zoom moves the camera
  back, so at max zoom-out the **player ship and the station set-pieces faded into the fog** (camera ~396 u
  vs `fogNear` 240). Fog is now re-anchored to the ship, an exact no-op at zoom 1. Guards:
  `system-map.test.js` gains absolute-placement, unreachability, fly-there-fade, moon-clearance and anchor
  cases; `32-star-system` flies 12 000 u through the origin asserting no body moves, the ship never gets
  within 100 u of a body's surface, only planet 2 is drawn at the base, flying to planet 3's anchor shows
  planet 3 and hides planet 2, and the ship stays in front of the fog at max zoom. `22-intro-replay`
  unchanged (kills=4, cards p0..p4, won). No new assets — moons are procedural. §98, §99.
- **[2026-08-09-1456-star-system-map] Flyable to-scale star system + autopilot navigation (on main's speed-field).**
  Out of combat the home map is now a to-scale, flyable star system. A central **star + 4 planets** render as
  a **bearing-projected sky backdrop** (`system-map.js` geometry + `world.js` `buildSystemBodies`/
  `updateSystemBodies`) at constant apparent size, re-projected each frame by their true bearing from the
  player, **replacing the single planet + moons**. The parallax **speed-field is main's already-shipped one
  (§96)** — this feature keeps it unchanged and adds the backdrop bodies + navigation on top. New **roam**
  state (`G.roam`) — entered via the base-menu **Map** section (`enterRoam`) or the `?roam` dev sandbox — with
  the player **speed cap lifted outside activity zones** (`capLifted({roam,inZone})`, which is **false whenever
  roam is off**, so every recorded/campaign replay stays byte-identical) and OOB warp-back disabled. A
  **system-map screen** (`systemmap-ui.js`; base-menu Map + a mini-map tap **out of combat**) freezes the game
  via a raw `G.mapOpen` loop-skip (not `setPaused`) and lets you pick a destination → **autopilot-to-point**
  (`engagePointAutopilot`, a new `point` target kind that never wins by proximity); arriving at a mission
  marker whose offer exists shows a localized **"Start mission?"** prompt reusing `missionOffers`/`launchMission`
  (locked markers park, no prompt). `levelRunner.resetLevelRunnerState()` was extracted so the roam `reset()`
  clears win/return state without spawning (fixes the frozen-ship / roam-enemy failure modes). Data: the
  near-mining + research set-pieces + `missions.js` centers moved out (2× distance, four-way invariant kept),
  and `catalog_seed.js` gained a `system` block (moons dropped; main's `speedField` + dead `asteroids` shim
  kept). New EN+RU `ui.systemmap.*` strings. Tests: pure `system-map.test.js` (incl. the `capLifted` invariant
  + Float32 bound) + the `32-star-system` visual scenario with a post-win roam guard; `22-intro-replay` is
  unchanged (replay-neutral) and main's `31-speed-field` still passes. Replay-neutral, zero sim RNG.
  DECISIONS §98 (coordinate model + bearing backdrop; speed-field is §96). docs/plans/2026-08-09-1456-star-system-map.md.
- **Both Grab (tractor) components are 30 % stronger.** Base Grab (id 29) `strength` 10 → **13**,
  Advanced grab (id 30) 20 → **26** in `server/src/catalog_seed.js`. Since grab reach is emergent from
  the inverse-square field (`range = √(strength·5/0.4)`), a +30 % stat is **≈+14 % reach**: base
  ≈11.2 → **≈12.7 u**, Advanced ≈15.8 → **≈18.0 u** (the Advanced/base ratio stays √2). Player-visible
  effect: loot boxes get vacuumed in from noticeably further out. Weights, prices and reel-in **speed**
  are untouched — pull speed depends on distance + item weight only, never on strength. No migration:
  the startup catalog upsert (`db.js`) rewrites `components.stats` for everyone on deploy. Tests
  updated: `server.test.js` (seed assertions), `client/src/drops.test.js` (reach anchors now 13/26),
  `client/src/components.test.js` (seed mirror).

- **Missions: the mission list moved to the right column; the ship preview is gone.** The Main Window's
  25% right column no longer shows a spinning ship + characteristics strip — on **Missions** it holds the
  **mission list** (campaign + side-mission cards, restacked: title + badge, reward/XP, Take/Defer/Set
  active), and the center work zone holds **only** the briefing body (title, text + granted-item showcase,
  reward, Take off). **Character / Map / Craft** now collapse to a two-column grid; **Loadout** is
  unchanged (centered ship + 30% context panel) and is the only screen showing `#ship-stats`. The
  `mwPreview` viewer, the `#mw-ship` canvas, the `previewTarget` debug hook and the staged reveal's
  `.briefing-hide-ship` beat are deleted — the mission list now stays visible while a briefing types out.
  DECISIONS §97. docs/plans/2026-08-09-1534-missions-list-right-column.md

- **[infra] Speed-field `asteroids` compatibility shim retired; itch republished and `/v2` brought back in
  sync.** Both of the shim's removal conditions were met, so the dead `asteroids: {…}` block is **gone from
  the map descriptor**. (1) The itch build was re-published via butler — build **#1868869, v52**, an
  incremental push that re-used 95% of the previous build and moved 272 KB instead of 20 MB. (2) The `/v2`
  sandbox was redeployed: it had drifted **70 commits** behind `main` while its only unique content was its
  three deploy files (both FX experiments had been promoted to `main` back in `0e5766a`), so `main` was
  merged into `v2` — the four conflicts were all in those already-promoted FX files, resolved in `main`'s
  favour — and the nginx container rebuilt, so `/v2` now serves the same client as production. Verified:
  `/v2/src/speed-field.js` returns 200 and `makeAsteroids` is gone from `/v2/src/world.js`.
  `server/src/maps_speedfield.test.js` no longer pins the shim's presence — it now asserts the **opposite**,
  so the dead key cannot reappear via a copy-pasted descriptor. DECISIONS §96.

- **[fix] Speed field: its own crisp sprite, rock tone, near-weighted density — the look is now settled.**
  Follow-up to the contrast fix below, tuned live against the maintainer on a local build. The field no
  longer borrows the star layer's `getStarGlowTexture` (a soft glow built to bloom points into haloes,
  ~25% average alpha) — it has its **own hard-edged procedural dot** (`getSpeedDotTexture`), which is why
  the specks can now be tiny *and* visible instead of big and white ("there are no white blobs like that in
  space"). Final: colour `0xd2ccc1` (warm rock grey), 760/220/110 points at sizes 0.8/1.3/2.0, depths
  10/90/220 — density deliberately **weighted to the near layer**, since those are the specks that sweep
  past and sell speed while the deep ones barely move. `SPEED_FIELD_RANGES.depth` now reaches **−110** so a
  foreground dust layer (above the combat plane, ~1.5–3.4× the ship's apparent speed) can be judged live in
  the `?dev` panel; the shipped look stays below-plane. The visibility guard became a **budget**
  (`size × contrast ≥ 5`) rather than a hard minimum size, since a small speck is fine when it is crisp and
  bright — it was the *combination* that failed. Also fixed a test that hardcoded a tuning number
  (`count === 420`) in an assertion that was really about copy semantics. DECISIONS §96.

- **[fix] The new speed field shipped invisible — contrast pass + a guard against it happening again.**
  The player-locked backdrop landed on prod and the live check came back "I see nothing, nothing gives a
  sense of speed": dark-grey sprites (`0x6b6f78`) at 0.9–2.6 world units and opacity 0.55–0.90, drawn with a
  soft glow sprite whose alpha is 0.25 at 55% radius, composite to within a few percent of the map
  background (`0x0a1624`) — so the only thing on screen was the **starfield, which is glued to the camera and
  therefore conveys no motion at all**. Every unit test, the outcome scenario and both review passes were
  green: they checked geometry, cost and replay-neutrality, never **contrast**. Colour is now `0xc8d0da`,
  sizes 3.8/6.7/10.9, opacity 1.0/0.94/0.69 (counts unchanged at 420/300/200), and
  `SPEED_FIELD_RANGES.size` widened to 20 so those sizes survive `normalizeSpeedField`. New regression guard
  `MIN_CONTRAST`/`contrastRatio` in `speed-field.js` asserts every shipped layer is ≥3.5× background
  luminance **and** that the known-invisible combination (2.39×) is rejected — a proxy calibrated from the
  escaped defect, not a visibility model. DECISIONS §4 already said a ~1px point needs bigger + brighter +
  near-white; the plan reasoned about density and pixel counts instead.

- **[fix] The side-mission board unlocked far too early (and the shop a level early).** Progress gates
  compared `players.current_progress` against hardcoded level ids (`>= 5` / `>= 3`), but `levels.id` is a
  BIGSERIAL whose sequence is burned by the startup upsert's `ON CONFLICT` path, so production ids had
  drifted to 1, 6, 7, 71, 564 — a player still on the "Level 1" briefing (id 6) was handed **both** the
  side-mission board and the hangar shop. Both gates now resolve the threshold by level **name**
  (`reachedLevel(progress, 'level-5')` / `'level-3'`, via the new `SIDE_MISSIONS_MIN_LEVEL`/`SHOP_MIN_LEVEL`
  constants in `db.js`), fail-closed if the row is missing. Ops detail: the shop backfill is **not**
  ledger-guarded — it re-runs on every boot, so it had been re-granting the shop early on each deploy and
  the fix likewise applies to everyone on the next deploy. Players who already got the shop early **keep
  it** (no revocation); the side-mission board re-locks for players below `level-5`, which is inert — a
  stale `active_mission_id` is never read while the board is locked. New `server/src/levels_drift.test.js`
  reproduces the production id drift on its own throwaway database (`spacegame_test_drift`). DECISIONS §95.
- **[decision] Star-system map + autopilot navigation (planned; feeds the star-system-map pipeline).**
  Recorded DECISIONS §94: the world becomes a to-scale flyable star system (star + 4 wall-clock-orbiting
  planets + an asteroid belt with 3 mining bases + a science station), sized so the outermost orbit's
  diameter is ~2 min of uncapped ion-engine travel (not astronomical). Out of combat the speed cap is
  lifted; a **system-map screen** (opened from the in-battle map button and the base menu) lets the player
  pick a destination that **autopilot** flies to, with the active mission highlighted; combat re-applies the
  cap + full inertia. Float32 coordinates are kept safe by the deliberately compact sizing (no floating
  origin; whole system fits one server-side coordinate space for the planned one-system-per-server
  multiplayer). Freighter trade route deferred to ROADMAP. No code yet — building via /feature-pipeline.
- **[2026-08-09-1410-player-locked-speed-field] Parallax backdrop is now a player-locked wrapping speed
  field.** The origin-anchored 2000-rock asteroid ring is gone; a fixed pool of ~920 point sprites in 3
  depth layers wraps around the player every frame (view-layer only, from `settleView`), so the same sense
  of speed surrounds you everywhere in the system at constant cost — the ring left you in empty space once
  you roamed, and it was ~40k tris to render sub-pixel specks. Points are static in world space and move
  only by whole box spans when they leave the ±620 box, so parallax stays real and a stationary player
  uploads nothing; the sprite is the existing procedural canvas dot (no new asset). Per-map colour/density
  moved to the descriptor's `speedField`; the old `asteroids` key is kept for one release so the
  already-published itch/`/v2` clients don't break (removal condition in DECISIONS §96). Also fixes a real
  leak: `buildMap` never removed the previous backdrop on a level/map switch. New `?dev` "Speed field"
  tuning folder (per-layer sliders + dump-to-console) inside the Backdrop panel, new pure
  `client/src/speed-field.js` + unit tests, a `31-speed-field` headless scenario (teleport 4000 units out,
  the field is still centred on the ship — mutation-verified against a camera-centred wrap) and a
  `maps_speedfield` server test; intro-replay guard green. DECISIONS §96,
  `docs/plans/2026-08-09-1410-player-locked-speed-field.md`.
- **[gameplay] Character progression HUD — always-on XP bar, free-points badge, "Level up" toast.**
  Added three always-visible bits to the progression feature: a **free-skill-points badge** (gold count) on
  the **Character** left-menu item, shown only when there are unspent points; an **always-on XP bar** at the
  bottom-center of the screen (yellow, 80% wide, on the base **and** in battle) that fills toward the next
  level and previews the current run's earned XP live; and a centered white **"Level up"** toast that fades
  out over 2s when a run banks enough XP to reach a new level. All in the per-frame HUD
  (`hud.js updateProgressionHud`/`showLevelUp`, called from the render loop; level-up fires from `bankRun`).
  New `ui.levelup` i18n (EN+RU); `11-character-progression` scenario extended to assert the badge + bar.
  Aim-assist note: the cone was briefly tripled for a feel test then **reverted** (2° weapon / 0.5°-per-point
  skill) — targeting still keys off the ship center, so improving it (hitbox-sphere aim, watch perf) is now a
  ROADMAP backlog item.
- **[shop] Selling gear now shows the price and asks to confirm — with a quantity picker.** Clicking
  **Sell** on a stash item opens a confirmation dialog showing **You receive: N × 75% of price**; when the
  stash holds more than one, a **slider + number field** (clamped to what you own, kept in lockstep) choose
  how many to sell, with the total updating live. Cancel/backdrop dismisses; Sell confirms. Server:
  `/api/players/:id/sell` gained an optional `qty` (positive integer; omitted → 1, back-compatible), and
  `sellItem` sells `min(qty, owned)` atomically and returns `{ sold, unit, refund }`. Equipped-item sells
  (single unit) are unchanged. New `#sell-overlay` modal + `ui.shop.sell.*` i18n (EN+RU), server qty test,
  and the `12-sell-confirm` visual scenario. docs/plans/2026-08-09-sell-confirm-quantity.md.
- **[shop] Fixed the Buy button in the shop detail card — it now matches the blue list button.** The
  `.primary` button styling was scoped to `.lp-item`/`.lp-shop-item`/`.lp-foot`, so the detail card
  (`.lp-detail`) rendered an unstyled plain "Buy"; added `.lp-detail .lp-acts button[.primary]` (incl. the
  dev-phone sizing) so it's the same blue button as in the shop list.
- **[gameplay] Character progression — experience, levels & five skills (Character screen now live).**
  The base-menu **Character** section is no longer a stub: it shows the pilot's **level**, an **XP bar**,
  unspent **skill points**, and five skill cards — **Kinetic** (+5% damage, +0.5° aim-assist cone/pt),
  **Rocket** (+5% damage, +5% speed/pt), **Shields** (+5% capacity/pt), **Maneuverability** (+5% dodge
  chance/pt), **Mobility** (+5% engine+thruster power AND +5% max speed/pt). **XP** is earned per enemy
  killed (= the ship's credit reward, now shown in the kill log next to credits) plus a one-shot bonus per
  mission cleared (Level 1 500 · Level 2 500 · Level 3 700 · Level 4 1500 · side missions 1000, shown on the
  mission cards). Level curve is an arithmetic ramp — 1000 XP to level 1, +500 each level after (2500, 4500,
  7000, …); each level grants one skill point, spent freely on the "Coming: choose what to level" cards.
  **Dodge** is a real per-shot roll (hit chance `100/(100+dodge−accuracy)`, accuracy reserved for a future
  skill) drawn from the **seeded** sim RNG **only when dodge>0**, so every existing recording still replays
  bit-identically; a dodged shot pops an **"EVADE"** over the ship and takes no damage. Enemies carry a
  `dodge` stat too (all current enemies = 0). Server: new `players` columns (`experience` + 5 `skill_*`);
  `/api/games` banks `xp`; new `POST /api/players/:id/skills/spend`; level + unspent points are **derived**
  from XP (never stored). New `progression.js` (+tests), skill-effect tests, dodge tests, server
  banking/spend/reset tests, and a `11-character-progression` visual scenario; intro-replay guard still
  green. DECISIONS §93; docs/plans/2026-08-09-character-progression.md.
- **[assets] Engines and thrusters got 3D item icons — and the item viewer learned to animate.** Every
  `engine` component (7: Basic/Scout/Boss/Solid-fuel/Ion/Pirate/Second-boss) now shows a shared **animated**
  nozzle in the shop/loadout detail panel — laid on its side into a horizontal nacelle, flame looping — and
  every `thruster` component (7) a shared low-poly turbine. Previously both families showed nothing. Wired hangar-only (`model_url_high`,
  CloudFront) through two shared constants in `catalog_seed.js` — one model per family is a deliberate
  placeholder pass, so per-tier models later mean editing one constant. Both sources are **CC-BY 4.0**
  (Yo.Ri; photon (that one larry)) — table rows + verbatim attribution added to `client/assets/CREDITS.md`
  and regenerated into the in-game Credits screen (`npm run credits:build`, now 10 models). Note the glb
  file names read backwards against the families they serve — they are named after their source assets, and
  the two were swapped between families after seeing them in the preview; `catalog_seed.js` is the truth.
- **[client] `model-viewer.js` plays glb animation clips.** The shared spinning-model viewer (shop detail,
  loadout, briefing showcase, hangar ship preview) had no `AnimationMixer` — an animated glb froze in its
  bind pose. It now drives clip 0 on loop, advanced by the same clamped per-frame `dt` as the auto-rotate,
  and clears the mixer when the model is swapped or the viewer is disposed. Models without clips are
  untouched (`mixer` stays null). The item cfg also gained **`pitch`** (rotation about X, applied in a group
  nested inside the yaw pivot so the spin axis stays vertical) — needed to lay the engine nozzle down, which
  `yaw` cannot do: the preview already auto-rotates about the vertical axis, so a yaw only shifts the phase.
- **[assets] Texture downscaling on both new sources (256px WebP).** The animated source was
  texture-dominated — 2.3 MB of its 2.5 MB — so its hangar build went **2.51 MB → 86 KB (29×)** with the
  skeleton and the 6 s flame clip intact. The turbine source was already tiny (3 KB of textures), but 256px
  still cuts its texture VRAM ~2.8 MB → ~700 KB, which matters on the weak phones. The unused *combat*
  builds of both items were deliberately **not** pushed to S3 (menu-only items never load them, and the
  thruster's would have added 2.2 MB of dead weight to every deploy image).
- **[test] New visual scenario `96-item-models-engine-thruster`.** Asserts all 14 engine/thruster rows
  resolve to exactly one model url per family (catching a half-wired family), that the animated engine's
  mixer clock actually **advances** (catching a silently frozen flame), and that a clip-less model leaves
  the mixer null — plus that swapping back clears it. Adds `?debug` hooks `shopItemTarget` /
  `shopItemLoaded` / `shopItemClipTime`. `shopItemLoaded` matters: the viewer sets its url synchronously
  and loads later, so without it the mixer assertions would just race the fetch.

- **[base-menu-redesign] Fix: player id broke over http://<ip> (secure-context-only `crypto.randomUUID`).**
  On a plain-HTTP LAN IP (e.g. testing on a phone at `http://192.168.1.151:4000`) — a **non-secure
  context** — `crypto.randomUUID()` is `undefined` and threw, so `state.js` returned a `null` player id;
  `unlockNextLevel()` then bailed on `if (!G.playerId) return` and the campaign never advanced (the Level‑0
  intro appeared to loop / Take‑off replayed Level 0). Pre-existing bug, surfaced by LAN‑IP testing
  (localhost + prod HTTPS are secure contexts, so it never showed there). New `client/src/client-id.js`
  `makeClientId()` tries `randomUUID()`, else builds a v4 UUID from `crypto.getRandomValues()` (available
  in insecure contexts), else a `Math.random` fallback; `state.js` uses it. Regression tests in
  `client/src/client-id.test.js` (incl. the no-randomUUID / throwing-randomUUID paths).
- **[base-menu-redesign] Phone: base-menu chrome scaled down ~2× (`body.dev-phone`).**
  On phone form factor (longest viewport edge < 900px) the redesigned base-menu UI — left menu items,
  mission-board cards, Loadout slot chips, and the right context panel — render at roughly half size so they
  fit a phone. The **centered ship viewer stays full size**; on phone the panel's **weapon/item model box
  is short** (`.lp-model` 220→73px) while the model itself renders at full scale. The model
  **auto-rotation is now time-based** (rad/sec, not per-frame) so it
  stays smooth under uneven phone frame rates, and the hidden right-column ship preview is **stopped while
  Loadout is open** so the Loadout viewers get the phone's frame budget (it spun jerkily with three
  concurrent WebGL loops).

## 2026-08-08

- **[base-menu-redesign] Loadout: item 3D models in the slot panel + the shop card (Slice C, increment 2).**
  Selecting a ship slot now shows the equipped item's **3D model** in the right panel (e.g. the Machine Gun
  when you click the GUN slot), alongside its stats + Remove + stash replacements; picking a stash part
  shows that part's model. Clicking a shop entry opens a **detail card** — stats at top, the item's **3D
  model** below (rendered via `model-viewer.js` on `#shop-model`, rebuilt+disposed per item; items with no
  glb show a "No 3D preview" placeholder), **Buy** below, and **Back** to the list. The Loadout right column widened a touch (30%) so
  the model reads well. The equipment slot blocks were also enlarged. New i18n `ui.shop.no_model`. The
  type navigation is still a tab row (the spec's collapsed-sections-per-type is a later refinement). See
  docs/plans/2026-08-08-base-menu-redesign.md (Slice C).
- **[base-menu-redesign] Loadout redesigned: ship centered, slots around it, a right context panel (Slice C, increment 1).**
  Clicking **Loadout** now shows the player ship **centered** in the work zone with its equipment/weapon
  **slot chips arranged around it** (`#loadout-stage`); clicking a slot opens the **right panel** with the
  equipped item's info + **Remove**, the fitting **stash replacements** (pick one → its info + **Install/
  Replace**), and a **Shop** button pinned bottom-right. The Shop button swaps the panel to the shop
  (type list → buyable items with price + **Buy** + Owned badge + **Back**). The old Ship/Stash/Shop tabs
  are gone; the redundant right-column ship preview is hidden while Loadout is open. The reusable 3D viewer
  was extracted to `client/src/model-viewer.js` (shared by the Main Window previews + the centered ship).
  Read-only until the shop unlocks. New i18n (EN+RU): `ui.shop.action.remove/replace`,
  `ui.shop.select_slot/slot_empty/in_stash/no_replacement/back`. Visual `05-hangar-shop` rewritten for the
  new screen. Increment 2 (collapsed shop sections + a stats→3D-model→Buy card) is next. Server unchanged.
  See docs/plans/2026-08-08-base-menu-redesign.md (Slice C).
- **[base-menu-redesign] Missions: a central board with take / defer / one-active (Slice B).**
  The Missions section is now a central **board** of cards — the campaign ("Main operation") + the side
  missions — each with **Take / Defer / Set active** and Active/Taken badges (the old left mission
  sublist + caret is gone). **Take-off flies the ACTIVE mission** (shown on the button), not just the
  selected one. Server-persisted: new `taken_missions` table + `players.active_mission_id` (NULL =
  campaign), created idempotently in `migrate()`; endpoints `POST /api/players/:id/missions/take|defer|
  activate` (gated on `sideMissionsUnlocked`, ids validated; activate auto-takes + enforces one-active;
  defer of the active mission falls back to the campaign) and `GET /missions` now returns `taken` +
  `activeMissionId`. Reset clears both. New i18n (EN + RU): `ui.mission.take/defer/set_active/active/taken`,
  `ui.button.take_off_mission`. Server tests (take/activate/defer + one-active + reset-clears); visual
  `10-mission-board` rewritten for the board, `97-briefing-showcase` updated. See DECISIONS §91 +
  docs/plans/2026-08-08-base-menu-redesign.md (Slice B).
- **[base-menu-redesign] Base menu reworked into five sections: Character · Missions · Loadout · Map · Craft.**
  The left base-menu is now a five-item hub (all always shown). **Character / Map / Craft** are stub
  panels ("Coming soon" — `#mw-view-stub`, routed by `selectMenu()`). **Loadout** absorbs the former
  standalone Stash / Shop menu items as an in-bay tab row (Ship / Stash / Shop, `#mw-bay-tabs`); before
  the shop unlocks it shows the ship **read-only** (no Unequip/Sell/prices, Stash/Shop tabs hidden, a
  hint shown). New i18n keys (EN + RU): `ui.mainwin.character/map/craft`, `ui.shop.tab.ship`,
  `ui.shop.loadout_locked`, `ui.stub.character/map/craft`. Visual scenario `05-hangar-shop.mjs` updated
  to the new tab navigation (+ fixed a stale `types === 6`→`7` assertion; shield is a shop type).
  Deferred Character/Map/Craft specs live in the plan. See docs/plans/2026-08-08-base-menu-redesign.md
  (Slice A).
- **[base-menu-redesign] Side missions now unlock after "Level 3" — decoupled from the shop.**
  Kicks off the base-menu redesign (docs/plans/2026-08-08-base-menu-redesign.md). The side-mission board
  no longer rides on the shop's unlock flag: the shop still opens right after the first flight (§90),
  but the board now opens later — on reaching the "Level 4" briefing (descriptor `level-5`, i.e. after
  clearing "Level 3"), gated on `current_progress >= 5` (new exported `SIDE_MISSIONS_MIN_PROGRESS` in
  `server/src/db.js`). `getActivePlayerShip()` returns a derived `sideMissionsUnlocked`; the missions
  endpoint and the client's `refreshMissions()` gate on it (was `shopUnlocked`). No new DB column /
  migration / backfill — the gate is computed live from progress. Briefing copy updated (EN + RU +
  `catalog_seed.js` fallbacks): the "Level 2" briefing drops its "side jobs" line; the "Level 4" briefing
  announces the side-job board. New server test guards the split (403 at "Level 2" with the shop open,
  offered after "Level 3"). See DECISIONS §91.

## 2026-08-06

- **[2026-08-06-1847-shop-unlock-after-first-mission] Shop opens after the first mission, not at the end.**
  The hangar shop + side missions now unlock the moment a player clears "first flight" (reaching
  player-facing "Level 2") instead of at the final level — `unlockShop` moved from the last briefing
  (descriptor `level-5`) to the "Level 2" briefing (descriptor `level-3`, alongside the Machine-Gun swap).
  A one-time idempotent boot backfill (in `migrate()`) opens the shop and seeds the basic gun for existing
  players already past the first flight (`current_progress >= 3`). Briefing copy updated (EN + RU): the
  "Level 2" briefing announces the open hangar; the "Level 4" briefing drops its now-stale "look over the
  upgrade gear" line. No client code change (the client was already data-driven off `shopUnlocked`). See
  DECISIONS §90.

## 2026-08-03

- **[2026-08-03-2154-admin-progress-column] The admin `progress` column is readable.** It rendered the
  raw `current_progress` id (a bare `3`, which actually means "Level 2" — the level ids are off by one
  from the player-facing titles). Each cell now shows the level **title** from the `levels` table
  `descriptor.title`, a small CSS bar, and an `n/N` fraction, with a **✔** when the player is on the
  last level. `N` and the ordinal `n` are derived from the `levels` table at render time (new
  `getLevels()` in `db.js`, injected into `mountAdmin`) — never hardcoded — and the column still sorts
  by the raw numeric progress via `data-sort`. Unknown ids fall back to the bare number.
- **Frame-pacing probe (`/raf-probe.html`) — measure the platform, not our renderer.** A tester's 90 Hz
  tablet (Mali-G52 MC2) sits at a ruler-flat **22.2 ms/frame = exactly half of 90 Hz**, unmoved by enemy
  count or particles. His 2335 `?dev` samples rule out the two obvious culprits: **not** the new
  fixed-timestep sim (the same 22.2 ms p50 is there on **2026-06-25**, six weeks earlier; `js.update` =
  0.7 ms) and **not** fill rate (DECISIONS §23 already measured a **5.5–7× pixel cut moving fps by
  nothing** on this exact GPU). What is unexplained is ~11 ms/frame outside our JS, uncorrelated with our
  load, at `longTasks` 0 — while the same device *does* reach 90 fps in combat in 36 samples. So the open
  question is what the platform gives a browser tab, which a page running the game cannot measure. The new
  standalone, dependency-free page runs three ~3 s phases — **blank** (rAF only), **triangle** (one WebGL
  draw, ~no pixels), **fill** (one draw over the full backbuffer) — so the last two differ only in
  fragments, isolating fill rate from draw-call count. Results POST to the existing `/api/perf` sink tagged
  `probe:'raf'` (no new table/route), keyed by the game's `playerId` so a run is read with SQL instead of a
  screenshot; it never mints a playerId (anonymous → `probe-anon`), `?dry=1` uploads nothing, and each
  phase carries a frame-interval histogram (a half-rate lock is one spike at 22 ms; generic slowness is a
  smear — an average cannot tell them apart). Verified end-to-end in a real browser against a live server:
  three phases measured, row landed in `perf_samples`. See DECISIONS §88.
- **[2026-08-03-1246-record-all-sessions] Fix: sessions from phones/tablets were never uploaded at all;
  trace format v2 (run-length packed).** A tablet tester played Level 3 for 20+ minutes and left **no
  session row and no `quit` event**; the maintainer's own hour-long Level-4 quit produced the event but
  **no row**. Two independent causes. (1) The session flush hung only on `pagehide`, which phones and
  tablets routinely never fire — backgrounding the app or locking the screen freezes/discards the page
  instead. The recorder now also flushes on **`visibilitychange → hidden`** (`main.js`), which fires while
  the page is still alive, so the upload is a plain `fetch` with **no ~64KB body cap**; the beacon path is
  demoted to a last resort. The flush is **provisional** — recording continues, so a player who tabs away
  and comes back and wins still yields ONE complete row. (2) `sendBeacon`'s ~64KB cap silently dropped
  **every quit longer than ~34 seconds** (measured 32.4 bytes/tick), not just outliers. Sessions now carry
  a **client-minted id** and `recordSession` **UPSERTs** (`ON CONFLICT (id) DO UPDATE … WHERE player_id IS
  NOT DISTINCT FROM EXCLUDED.player_id`, so a colliding id can't rewrite another player's row), so
  provisional + final uploads land on one row. (3) Same loss class, fixed alongside: `beginLiveSession()`
  now flushes any still-open session as `quit` before arming the next one, so a fight ABANDONED mid-way —
  left, then another level launched — leaves a row instead of being thrown away.
  Trace **v2** stores ticks **run-length packed**
  (`runs: [[tick, count], …]` + `tickCount`) — **23.8× smaller** on a real 131 s session (7867 ticks →
  279 runs, 254 KB → 10.7 KB) — and the live recorder packs **as it captures**, so retained memory on a
  weak device is a few hundred objects instead of tens of thousands. The touch aim is quantized
  (heading 1e-3 rad, thrust 1e-2) or an analog stick would defeat the packing on exactly the devices this
  is for. v1 traces (the shipped Level-0 intro asset + all pre-existing recordings) stay playable —
  `hydrateTrace()` normalizes both shapes at load. Caps raised/reshaped: `MAX_SESSION_TICKS` 36000 → 108000
  (~30 min) plus a new `MAX_SESSION_RUNS` 20000 (the bound that actually binds on touch); server caps
  120000 ticks / 25000 runs. Guards: new `client/visual/scenarios/30-session-upload-on-hide.mjs` (verified
  fail-before: 0 uploads on hide without the listener), pack/unpack/quantize/v1-compat unit tests, a
  provisional-then-final recorder test, and a server upsert + cross-player-overwrite test. See DECISIONS §87.
- **[2026-08-03-1907-weapon-aim-assist] Bullet weapons get aim assist.** Every non-rocket bullet weapon
  (ids 1, 2, 5, 6, 7, 9, 10) gains a data-driven `aimAssistDeg` (2° cone **half-angle**) auto-aim cone: at
  fire time, a shot whose shooter has an opposing-side target within ±`aimAssistDeg` of the nose is
  redirected to fire straight at that target's **current** position (planar XZ, no leading; nearest-in-cone
  wins; player guns skip warping enemies, enemy guns require the player alive). It's a **weapon property**,
  so **enemy guns auto-aim at the player** exactly as player guns auto-aim at enemies. Velocity inheritance
  and rockets are unchanged (rockets keep their homing). Shown as `Aim assist 2°` in the shop stat line.
  Deterministic — pure `nearestInConeIndex` (`steering.js`) + `findBulletAimTarget` (`projectiles.js`), no
  RNG → replay-safe. See DECISIONS §89. **Sim change:** aim assist alters bullet launch directions inside
  the seeded sim, so it can invalidate the recorded Level-0 intro trace — the fix for a red
  `22-intro-replay` guard is a **maintainer re-record** of the intro, NOT weakening the guard assertions.
  (This time the 2° cone was small enough that the intro re-sim still won unchanged — 4 kills, cards
  p0..p4, won — so no re-record was forced.)
- **[2026-08-03-1246-record-all-sessions] Fix: win/long sessions were silently dropped (keepalive 64KB cap).**
  Prod `gameplay_sessions` had only short `death`/`quit` rows and ZERO `win` rows despite completed levels.
  `net.js postSession()`'s win/death flush used `fetch(… , { keepalive: true })`; Chrome caps a **keepalive**
  request body at **~64KB**, so a completed level's trace (minutes of 60Hz ticks, ~0.1–2MB) threw synchronously
  and the `.catch()` swallowed it — only sub-64KB death/quit traces uploaded. Win/death flushes happen while the
  page STAYS OPEN (the overlay is up), so `keepalive` was never needed there: the non-beacon path now uses a
  plain `fetch` (no body cap). `navigator.sendBeacon` stays for the `pagehide`/unload (`beacon:true`) path only,
  where the ~64KB cap remains a documented v1 limit for tab-closers (their early-drop-off traces are small).
  The transport decision was extracted to a pure, unit-tested `client/src/session-transport.js`
  (`sendSession`) with a regression guard asserting the win/death path issues a `fetch` WITHOUT `keepalive`.
  Effective upload ceiling is the client's 36000-tick cap (≈≤2MB), comfortably inside the route's 3MB parser.
- **[2026-08-03-1246-record-all-sessions] Fix: intro→Level-1 dead controls after always-on recording.**
  Unifying live play onto the record/playback fixed-step accumulator introduced a freeze: the accumulator's
  inner loop was gated `while (… && !rs.done …)`, and the intro's completion set `rs.done = true` *after*
  `finishIntro()`→`rs.teardown()` had already reset it — so the first live session right after the intro
  inherited a stale `rs.done=true`, the accumulator never stepped, and the ship sat off-center with dead
  controls until a page refresh. The accumulator now ignores `rs.done` for live play (`!(rs.play && rs.done)`
  — `rs.done` gates PLAYBACK/intro only, where `rs.play` is truthy; freeze-on-exhaustion there is unchanged).
  Also wired `beginLiveSession()` into the welcome-screen Take-off path (`welcome.js takeOff`) so a
  welcome-path live-level entry is recorded too (the actual post-intro campaign path — Main Window
  `launchCampaign` — was already armed). Added a deterministic regression guard
  (`client/visual/scenarios/29-intro-live-handoff.mjs`): it fires the real intro-completion sequence, takes
  off into live Level 1, and asserts the accumulator actually steps (captured ticks > 0) — it fails on the
  unfixed engine (0 ticks) and passes after the fix.
- **[2026-08-03-1246-record-all-sessions] Record all gameplay sessions for funnel analytics.** Every live
  **campaign** session (side missions excluded in v1) is now captured **always-on and invisibly** as a
  deterministic input-replay (seed + per-tick input, reusing `replay.js`) and uploaded. The client POSTs
  the trace to `POST /api/sessions`; the **server** uploads it to S3 (`server/src/s3.js` — hand-rolled
  SigV4 PutObject, no `@aws-sdk`; no-ops without creds) and writes a metadata row to the new
  **`gameplay_sessions`** table (distinct from the auth `sessions` token store), stamping `game_version`
  from `process.env.SENTRY_RELEASE`. A new **`/admin/sessions`** page lists every session (created, player,
  level, outcome, duration, kills, version + ✓/✗ deploy match) with a **▶ play** link
  (`/?playback&id=…`) that streams the trace back from `GET /api/sessions/:id/trace` (intentionally
  unauthenticated — seed+input only, unguessable UUID) and re-sims it. Trivial sessions (< 180 ticks ≈ 3 s)
  are dropped; capture caps at 36000 ticks (~10 min). **Load-bearing change:** all live play is unified
  onto the fixed-timestep seeded loop (`TICK_HZ`, default 60, `BENCH_DT = 1/TICK_HZ`) — the same
  deterministic accumulator record/playback/bench already used; capture is per sim-tick, decoupled from
  render frames (a frame drop → slow-motion, never a corrupted recording). A recorded trace reproduces
  faithfully only on its recorded `game_version` (inherent to input-replay analytics; admin shows ✓/✗, no
  old-engine restoration). **Ops prerequisite:** the server IAM key needs `s3:PutObject`+`s3:GetObject` on
  `arn:aws:s3:::vega-sentinels-assets/recordings/sessions/*`, and the server `.env` needs `ASSETS_BUCKET`
  (+ region) — without them uploads no-op silently and playback 404s.
- **[2026-08-03-1246-record-all-sessions] `migrate()` now serializes behind a Postgres advisory lock.**
  Concurrent `CREATE TABLE IF NOT EXISTS` on the same DB (parallel `node --test` processes, or a future
  multi-instance boot) races in `pg_type` ("duplicate key … pg_type_typname_nsp_index"); the lock makes
  only one migrate run its DDL at a time. Fixes a latent flake surfaced by the new server test file.

## 2026-08-02

- **The loading veil now waits for the models, not just the shaders.** On itch (first load ≈ 20 MB) the
  fight began with the player flying the **procedural placeholder cone** and the base station popping in
  seconds later, with no loading screen — the veil only covered the shader warm and dropped before the
  `.glb` files arrived. `G.pendingAssets` now counts essential model loads in flight (ship models +
  set-pieces, decremented on error as well as success) and the veil stays up until they land. Bounded by a
  9 s cap so a wedged download can never lock anyone out — it just falls back to the old
  start-with-placeholders behaviour. The cap is anchored to the FIRST raise of the wait: late arrivals
  re-raise the warm request, and resetting the deadline each time pushed it forward forever (caught under an
  emulated 300 kbit/s link, where the veil never came down). Verified on that same emulated link: the veil
  lifts at the cap with the player's ship on its real model, the rest still arriving. On a warm cache (assets are `immutable`, §78) the wait is a frame or
  two. See DECISIONS §84.

## 2026-07-29

- **A ship blowing up no longer costs a shader compile.** Reported from the field as a half-second lag on
  every kill (verified three times). The obvious suspect — overdraw from flying through the blast — was
  measured and cleared: an explosion covers at most **6.7% of the screen** across its whole life. The stall
  telemetry pointed elsewhere: freeze frames creating **7 shader programs in one second**. A local probe
  pinned it — a ship death compiled **+3 programs on first use**, while rockets, smoke and enemy spawns
  compiled none. The death FX (flipbook fireball + shockwave ring) each dispose their material when they
  finish, and THREE frees a program with its last material, so every death after a lull recompiled.
  `flipbook-fx.js` and `projectiles.js` now export a `keepAliveMaterial()` held by the permanent warm rig;
  the same probe now reports **0**. Guard: `28-scene-warm` asserts a ship explosion compiles nothing
  (mutation-verified). See DECISIONS §83.

- **Level-load veil, so the pre-fight warm reads as loading instead of a crash.** Moving the shader
  compile/upload to level build (previous entry) worked — a cold-phone session shows the steady state fully
  recovered (25-35 fps, `js.render` 10-13 ms) — but it concentrates the work into **one blocking render call
  measured at 3198 ms** on that device, and the player just saw the picture sit at 1 fps for 5 seconds. A
  full-screen veil ("Preparing the sector...") now covers it. The ordering is the whole trick: the frame
  that takes the warm request only RAISES the veil and returns, and the next frame — with the veil already
  painted — does the blocking work and takes it down, because the browser cannot paint anything until a
  frame ends. The veil fades in after a 90 ms delay, so a fast machine (warm done in a frame or two) never
  shows it at all. EN + RU strings; guard extended in `visual/scenarios/28-scene-warm.mjs`.

## 2026-07-28

- **The first 15 seconds of a fight no longer build the game while you play it.** The new stall-attribution
  telemetry found it immediately: on a weak phone the main thread was blocked **10+ seconds out of the first
  15** (one frame 2082 ms) while live shader programs climbed **14 → 33** — THREE compiles a program and
  uploads textures lazily, on the first frame an object is drawn, and `prewarmShaders()` ran at page
  bootstrap, before any level exists. `sim.reset()` now raises `G.needsSceneWarm`, the render loop consumes
  it at the top of the next frame (before that frame draws), and `world.js`'s async set-piece loaders raise
  it again when a model lands. Separately, the FX warm rig is now **permanent**: it used to dispose its
  materials right after compiling, and THREE frees a program when its last material goes — so every lull in
  bullets/explosions bought a recompile, visible as the program count sawing 37↔40 with 100-300 ms blocks.
  Guard: `visual/scenarios/28-scene-warm.mjs` (pins the wiring; the perf effect is only measurable in the
  field). See DECISIONS §83.

- **`?dev` telemetry now attributes stalls.** Field freezes of 700-1100 ms stayed unexplained: our own
  buckets accounted for 12-40 ms of them, the scene was byte-identical before and after (same enemies, draw
  calls and triangles), music decode was ruled out (all buffers decode once at preload), and in one session
  even the sampler skipped 6 s. Two counters now ship in every sample: **`gpu`** (three.js live
  `programs`/`geometries`/`textures` — a jump during a stalled second means the freeze was a shader compile
  or texture upload, curable by warming it early, as the ship-model stall was) and **`longTasks`** (`{n, ms}`
  from the Long Tasks API — non-zero on a freeze means our own main thread (script or GC), zero means the
  stall was outside it: compositor, GPU process, or CPU governor/thermal). Diagnostic only, `?dev`-gated,
  read once per sample.

- **Kinetic bolt + muzzle flash restyle.** Up close, machine-gun / kinetic fire read as a *mutable
  coloured oval* and the muzzle flash showed as a faceted 10-sided polygon. The bolt (`bolt-fx.js`) is no
  longer a radial gradient: its texture is now a **crisp bright capsule core** (a near-opaque rounded-rect
  on the shared canvas) wrapped in a **faint soft halo**, so a shot reads as a clearly-outlined body with a
  thin fog rim. The bolt is also smaller (`BOLT_LEN` 3.4 → **2.4**, `BOLT_WID` 1.15 → **0.7**). The
  **muzzle flash** (`projectiles.js`) became its own flat additive **glow sprite** (a round radial texture,
  same FX family as the bolt / shockwave ring) instead of borrowing the faceted micro-explosion sphere,
  and is **~30% smaller** (scale 1.7 → 1.19). Pure render, replay-neutral (no RNG; intro guard unaffected).

## 2026-07-27

- **Rocket smoke is one draw call instead of 25-30.** Every FX primitive was its own mesh with its own
  material, so each particle cost a draw call — the rendering equivalent of an N+1 query, and on a weak
  phone (~0.25 ms per call) a single rocket in flight added **25-30 calls**, spotted in the field by the
  maintainer. New `client/src/particle-pool.js` gives one `InstancedMesh` per particle KIND, filled per
  frame; the rocket trail (the only high-volume kind left — the spark spray died with §75) now goes through
  it, so the cost stops scaling with puff count. Per-puff fade rides an instanced `aAlpha` attribute so the
  tail still dissolves while the head stays dense — a shared `material.opacity` would blink the whole trail
  out at once. `maxParticles` is finite on every tier now (640/480/300); it was `Infinity` on High and
  Balance. Guard: `visual/scenarios/27-smoke-instancing.mjs`, which reads the framebuffer to prove the fade
  reaches actual pixels. New high-volume FX must use a pool — see DECISIONS §82.

- **`?dev` is no longer sticky — no more service information stuck on the live site.** The diagnostics flag
  persisted in `localStorage`, so a single `?dev` visit left the perf overlay, the right-docked lil-gui
  authoring panels, the `window.__backdrop` hooks and the per-second telemetry running on
  **vega.tenony.com forever** — for the maintainer and for any playtester handed a `?dev` link (those panels
  in a tester's screenshots were exactly this). `?dev` now governs the **current page load only**, on every
  device and host: `evalDev` reads the query string and nothing else, and the retired `devMode` key is
  cleared on load so an old visit stops haunting a browser. Trade-off: telemetry needs `?dev` in the URL for
  each measuring session. Supersedes the touch-only non-stickiness added just before it (the device axis is
  moot with no stickiness anywhere); the "never build lil-gui panels on touch" half stays. See DECISIONS §81.

- **First sighting of an enemy type no longer freezes the frame.** Caching the parsed glb removed the
  re-parse, but three.js uploads geometry/textures and compiles the shader program **lazily, on the first
  frame an object is drawn** — so the first time each ship TYPE appeared in a fight still cost **215 ms
  inside `js.render`** on a weak phone ("a new ship shows up on the map and it's instantly 2 fps").
  `ship-factory.js` now **warms** each model right after parsing: parks the template off-camera in the real
  scene (the program depends on its lights/fog), runs `renderer.compile()`, and pushes every texture up via
  `renderer.initTexture()` — `compile()` covers shaders only. Same idea as `prewarmShaders()`, which warms
  the FX materials at startup but runs before any ship model exists. See DECISIONS §79.

- **HUD stopped costing a fixed ~8 ms every frame.** Weak-phone telemetry showed `js.dom` pinned at
  7.5-8.3 ms no matter what was on screen (against 1-2 ms for the whole sim) — 40% of a 50fps budget. Two
  causes, both now fixed in `hud.js`: it rewrote values that had not changed (`innerHTML` re-parsed 60×/s
  for a credits line that changes on a kill; the same widths, percentages and `display` values rewritten
  every frame), and it positioned every floating overlay with pixel `left`/`top`, which invalidates layout
  per element per frame. New `setText`/`setHTML`/`setStyle` helpers skip identical writes, and `place()`
  positions via a single compositor-only `translate3d` — the CSS anchor offsets moved into that transform,
  and the pooled overlays are pinned at `left:0/top:0`. The radar canvas (a full 2D repaint) is throttled
  to ~20 Hz; everything anchored to a moving ship stays per-frame so it can't lag. No visual change. See
  DECISIONS §80.

- **Ship models are now parsed once and cloned per spawn (was: a full re-parse on EVERY spawn).**
  `applyShipModel` called `gltfLoader.load` per spawn with no cache anywhere, so every enemy that appeared
  rebuilt the model from scratch — new geometry, a fresh texture decode + GPU upload, one VRAM copy per
  instance. On a weak phone that meant a **864 ms frame** and **242 ms of `js.render` in a single second**
  during the first seconds of a fight, with `draws` climbing 12 -> 36 as the scene assembled mid-combat, and
  enemies often flying as the untextured placeholder until their glb landed. `ship-factory.js` gained a
  `shipModelCache` (parse once, `clone(true)` per ship — geometry and materials shared, so one GPU copy per
  ship TYPE), and `levelRunner.start` now warms every model the level can spawn
  (`preloadLevelShipModels`), mirroring the `preloadRewardModel` precedent. New guard
  `client/visual/scenarios/26-ship-model-cache.mjs` (mutation-verified). The constraint this creates —
  never mutate a live ship's material, clone it first — is recorded in DECISIONS §79.

- **Content-hashed assets are now cached forever (`immutable`) instead of revalidating on every request.**
  `express.static` defaulted to `max-age=0`, i.e. a conditional GET + 304 round trip for **every** asset —
  and ship models are re-requested on **every enemy spawn**, so a player on weak mobile paid a network round
  trip per spawned pirate and watched enemies fly as the untextured placeholder until it returned. Files
  named `<name>.<hash8>.<ext>` (`.glb`/`.mp3`/`.json`) now get `public, max-age=31536000, immutable`;
  un-hashed files (`index.html`, `src/*.js`, `styles.css`) keep revalidating so deploys land immediately.
  Safe by construction — the hash is the version, so a changed asset is a NEW URL and there is nothing to
  invalidate (hence no "reload assets" command; see DECISIONS 78). Policy is a pure, unit-tested
  `staticCacheControl()`. Does **not** remove the per-spawn glb re-parse — that needs an in-code model cache.

- **Player ship combat model: 31 -> 15 draw calls (and 371 -> 178 KB).** Weak-phone telemetry
  (`?dev` → `perf_samples`, Samsung SM-A037F / PowerVR GE8320) showed 42-67 ms per frame in `js.render`
  — our own draw-call submit — and the culprit was a single asset: the player ship was **31 draw calls /
  31 materials / 79 textures**, where every other ship is 3-5 primitives. It is a Sketchfab model split
  "part x material", so `join` could never merge it. The combat build now runs a **material-flattening
  pre-pass** (`scripts/assets-flatten.mjs`, opted in via `flattenMaterials` in the preset): each material
  is replaced by flat factors **sampled from its own maps** (`npm run assets:materials` →
  `assets-src/<base>.materials.json`), so `--palette` can merge them and `--join` can collapse the mesh.
  The few maps that paint several colours onto one material — the red engine nacelles, the yellow wing
  chevrons — keep their base map (`keepTexturedAbove: 34`), so the ship looks the same; normal/MR/occlusion
  maps are dropped everywhere (invisible on a ~50px top-down ship, a texture bind each). The **hangar**
  model is untouched. Geometry is not modified, so hitboxes, collision and the recorded Level-0 intro are
  unaffected (guard re-run green). The size drop also fixes the model intermittently failing to download on
  that phone, which silently left the player flying the placeholder primitive. See DECISIONS §77.

- **Rocket detonation unified onto the flipbook fireball; blast look is now weapon-driven.** A rocket blast
  is the **same flipbook fireball + soft shockwave ring** as a ship death (the old layered additive spheres +
  spark spray are gone), just **smaller, faster and brighter** — a white-hot `uTint` > 1 on the flipbook.
  The whole blast appearance is **data-driven from the rocket weapon's stats** so a **new weapon type changes
  its explosion with no code change**: `blastVisual` (size), `blastTimeScale` (speed), `blastTint` (ring
  color) and a **new `blastBright`** (fireball brightness / white flecks; default `1.6` in code, added to all
  4 rocket weapons in `catalog_seed.js`). `spawnFlipbookExplosion` gained a `speed`/`tint` arg; `spawnRocket`
  threads `blastBright`. Pure render / replay-neutral (intro rocket-finale re-sim bit-identical). DECISIONS §75.
- **Explosions/rings/hits unified onto the flipbook+shader family; boss chain-detonation.** The ship-death
  burst is now the flipbook fireball + a soft expanding **shockwave ring** only — the old CPU **spark
  spray** is gone (DECISIONS §75). The shockwave ring became a **baked soft-ring texture on an additive
  quad** (`spawnShockRing`, shared by ship death + rocket burst) instead of a hard `RingGeometry`. The
  **bullet hit-flash** is now a small **flipbook mini-blast** (`spawnHitSprite`, same baked fire sheet,
  sized by weapon class) instead of an additive sphere. **Bosses** (`boss`/`boss2`) get a **staged chain
  detonation** (`spawnBossExplosion`): oversized primary fireball + big ring, then a brighter **yellow
  secondary detonation** (~0.7 s later) + its own ring, plus scattered small pops — driven by a deterministic
  deferred queue (`updateDeferredBlasts`, cleared on reset). The **flipbook fireball** was made smoother +
  longer: sprite sheet 6×6→**8×8 (64 frames, 2048px)** with **shader frame-blending** (cross-fades baked
  frames → synthesized in-between frames), playing over ~1.8 s. All pure render / **replay-neutral** (no
  `Math.random`/`simRandom` in FX; intro guard bit-identical). `02-ship-explosion` scenario updated (asserts
  no sparks + textured rings).
- **Exhaust FX live-tuning: flame is the default look + ship tails whip on turns.** [2026-07-26-2114-freighter-exhaust-fx]
  Follow-up to yesterday's shared-plume conversion, tuned on a live build. The **flame** look is now the
  shipped default (the `points` glow read as slow drifting particles, not engine thrust — kept as a
  `?dev`-only legacy option). Flame was made **intense**: fiery-orange by default (until exotic/ion
  engines), bright white-hot core, dense body, fast flicker, shorter + thinner on ships; the **freighter
  plume is ~2× longer and hotter/denser** (its own `len`/`softness`). Ship tails no longer snap rigidly with
  the hull on a fast turn — each ship plume is now **scene-parented and tracked to the hull with a smoothed
  yaw lag** (`syncShipPlume`), so the tail trails behind on a hard turn and settles straight in level flight
  (natural jet inertia; still no curved position-history, DECISIONS §74). Flame length is now in world units
  (independent of hull scale). Pure render — replay-neutral (intro guard still passes); `points`↔`flame` is
  still the global `?dev` toggle. `03-exhaust-trail` + `24-freighter-exhaust` scenarios updated to the flame
  default.
- **Enemy shields for every enemy type.** Each enemy's catalog HP is now split into a **1/3 shield + 2/3
  hull** (30 → 10+20, 36 → 12+24, 150 → 50+100, 300 → 100+200, 310 → 103+207, 550 → 183+367), derived
  client-side at spawn from the hull's `durability` — no DB column, no catalog change, no migration, and the
  derived shield is weightless so enemy mass/acceleration/turn rate are untouched. Absorbed hits play the same
  unified `spawnHitSprite` mini-blast as a hull hit but smaller and tinted **cyan** (a new `SHIELD_HIT_TINT`
  `uTint` multiplier on the flipbook family from the same-day §75 change, rather than the orange hull spark)
  and ripple on a snug per-enemy bubble (`shield-fx.js` pool, sized
  `broadRadius(enemy) × 1.05`, ripple-only with **no idle rim**, tier-capped `enemyShieldBubbles` **6 / 3 / 0**
  and cleared on `reset()`), and the floating enemy bar gained a **blue shield strip** above the red health
  strip (purple + filling with the recharge progress while broken; shown whenever *either* pool is below full).
  `applyPlayerDamage` became the shared `applyShieldedDamage` router — one lossless implementation for both
  sides: the shield absorbs and the excess spills to the hull **in the same tick**, no rounding and no per-hit
  cap. **A broken enemy shield refills to full 10 s after the break — the timer runs from the breaking hit and
  keeps banking under continuous fire, exactly like the player's — so a kill finished inside that window costs
  exactly the damage it did before shields, while a longer fight costs up to one extra shield per 10 s
  (+183 HP second boss / +103 first boss / +100 advanced medium / +50 mini boss / +10-+12 small pirates):
  long fights are deliberately harder.** Hitboxes are unchanged (enemies keep the hull OBB swept test — no
  `SHIELD_RADIUS` sphere interception, so aim feel is identical) and warping enemies stay invulnerable.
  Also fixes the shared FX clock in `shield-fx.js`: `updateShieldBubble` advanced `time` only *after* a player
  bubble existed, which would have frozen an enemy ripple on screen until the player was first hit. New knobs
  `ENEMY_SHIELD_FRACTION` / `ENEMY_SHIELD_RECHARGE_SEC` (`components.js`) + `enemyShieldBubbles`
  (`graphics.js`), and a `G.enemyShieldRefills` diagnostic counter for replay triage. Tests: +8 unit cases in
  `components.test.js` (the load-bearing one asserts damage-to-kill is byte-identical to `hitsToKill` across
  every durability × per-hit combination, and that the derived shield adds no mass) and a new
  `client/visual/scenarios/25-enemy-shield.mjs`; `11-l4-enemies` now asserts hull + shield = the catalog total
  (and its stale `450` for the second boss was corrected to **550**). The recorded Level-0 intro still wins
  (`22-intro-replay` green). A distinct shield-absorb **sound** is deferred → ROADMAP backlog. See DECISIONS §76.

## 2026-07-26

- **UI: credit balance in the Main Window top bar + the radar moved under the health bars.** The
  between-battles top-right now reads `<n> cr.` in credit-gold beside the (still inactive) "Ships" label —
  the player finally sees what they can spend without opening the shop. Both live in a new `#mw-topright`
  flex row; below 780px it stacks into a right-aligned column so it clears the centered wordmark (which
  scales with `4.5vw`) on phone landscape. The number is pushed by `updateMenuCredits()` (`hud.js`) from
  `showMain`/`showWelcome` and, using the server's authoritative `credits`, from `renderBay` after every
  buy/sell. New i18n key `ui.mainwin.credits_unit` (EN `cr.` / RU `кр.`). In-fight, the mini-map/radar left
  the vertical center of the left edge and joined the top-left HUD cluster: directly under the
  shield/health bars and their % readout, left-aligned with them — it no longer sits in the middle of the
  play area. Guard: `client/visual/scenarios/23-topbar-credits-radar.mjs` asserts the radar geometry, the
  `<n> cr.` format against the live balance, and that the top-right pair never overlaps the wordmark on
  either a desktop or a 667×375 phone-landscape viewport. Shipped to **prod** (`vega.tenony.com`) and
  **itch.io** (`html5` build #1834315).
- **Exhaust FX unified onto a shared GPU/baked-texture plume.** [2026-07-26-2114-freighter-exhaust-fx] The
  cargo-freighter set-piece exhaust (`world.js makeFreighter`) **and** every ship's engine trail
  (`projectiles.js emitExhaust`/`spawnTrail`) were converted from per-frame CPU-simulated particle clouds
  (position **and** color buffers re-uploaded every frame) to **one** additive, baked-texture-once,
  shader-driven **axis-aligned plume** in the `bolt-fx`/`flipbook-fx` FX family — new module
  `client/src/exhaust-fx.js` (GL factory + registry + `?dev` panel) with the pure, unit-tested seams
  (`hash`, `plumeCfg`, `decayThrottle`, `derivePalette`) split into `client/src/exhaust-config.js`. Each
  plume builds **both** looks — (a) silhouette-preserving **point-glow** (default) / (b) **noise-scroll
  flame** — and a new `?dev` "Exhaust" tuning panel toggles the look **GLOBALLY** (freighter + all ships at
  once, `setGlobalExhaustMode`), with **freighter-only** palette/shape sliders (count/len/size/speed/spread/
  turbulence/softness) + a **Copy JSON** export (no persistence — Copy JSON is the save path). Per-ship
  trails are now **rigidly straight** plumes parented to each ship (the old curved position-history is
  intentionally dropped — DECISIONS §74); they attach lazily on first thrust (count tier-scaled once), fade
  in/out with a smoothed `throttle`, and are disposed on ship **death/reset** (`disposeShipExhaust`) and
  **player ship-swap** (`ship-build.js`). The dead `trail` particle pool (`state.js`), `spawnTrail`, and its
  `sim.js` drain loop / reset teardown / `window.__game` export are **removed**; `liveParticles()` no longer
  counts exhaust. User-visible: prettier, unified engine fire the maintainer can retune live and pick the
  final look by eye. **Replay-neutral by construction** — no `Math.random`/`simRandom` in the FX
  (deterministic `hash(i)` seeds), no sim/damage/collision/economy change; the mandatory `22-intro-replay`
  guard passes (4 kills / cards p0..p4 / win). `spec.exhaust` schema unchanged (+ optional
  `turbulence`/`softness`, defaults on the client); **no server/catalog/model/asset change** (no
  `CREDITS.md` change, no `/publish-itch`). New unit test `exhaust-fx.test.js`; `03-exhaust-trail` rewritten
  to assert attached plumes; new visual scenario `24-freighter-exhaust` (global toggle flips freighter **and**
  ship plumes). The general "unified visual/UX live-tuning panel + save-to-file" is parked to ROADMAP
  (DECISIONS §30/§74).
- **Intro replay desync fixed — the seeded sim RNG is now opt-in.** Cosmetic FX (explosion sparks, exhaust,
  smoke) and world decor were drawing from the seeded stream inside `update()`/`reset()`, because `main.js`
  swapped a seeded `Math.random` in around those calls. So *any* FX/decor change silently shifted the stream
  and desynced the recorded Level-0 intro — it broke **three times** (shield sphere `db78736`, asteroid `.glb`
  `7d8fa50`, flipbook FX `0e5766a`), leaving a brand-new player's first impression as a cutscene that shoots
  at empty space and never clears. New `client/src/sim-random.js` (`simRandom`/`seedSim`/`isSimSeeded`, plus
  `mulberry32` moved here and re-exported from `bench.js`); the ~8 **gameplay** draw sites opt in explicitly
  (`sim.js` enemy pick + drop roll + the `stepSpawnGate(..., simRandom)` injection, `ship-build.js` spawn
  angle/distance/heading + enemy reload stagger, `drops-config.js` `pickLoot`) and the global `Math.random`
  swapping (`withSimRand`, `installSeededRandom`) is **gone** — so new FX code is replay-safe by default, and
  a trace is no longer graphics-tier dependent (spark/exhaust counts are gated on `G.gfx`, so the same trace
  used to consume a different number of seeded values on a weak phone). The seed is also **cleared** on
  teardown (`finishIntro`, `stopRecordSession`) so live play never runs off a stale stream. Verified
  record→playback still reproduces a fight bit-for-bit (identical state hash over 900 ticks).
- **Two termination guards so a failed intro re-sim can never dead-end** — a **return-home watchdog** on the
  replay session (`CUTSCENE_STALL_TICKS = 900` ≈ 15 s of sim time in `replay.js`, unit-tested) ends a
  cutscene that engaged "return to base" but can never dock, and `__replay.step()` now mirrors `animate()`'s
  missing **end-of-trace** exit. Both route through the normal `cutsceneEnd()` → `finishIntro()` path, so the
  player still advances 1→2 and lands on the Level 1 briefing instead of staring at a hung screen.
- **Committed headless guard against the whole bug class** — `client/visual/scenarios/22-intro-replay.mjs`
  (in `npm run test:visual`) re-sims the canonical intro trace on its own `?playback&…&cutscene=1&debug` url
  and asserts **4 kills, cards `p0..p4`, win**; it waits on the new `__replay.status().armed` gate (models
  loaded = correct bullet spawn point) and hard-fails with "run `npm run assets:pull`" when the trace asset is
  absent. `visual/run.mjs` accepts a name filter (`node visual/run.mjs 22-intro-replay`) to re-run one
  scenario. **The intro trace was re-recorded** as part of this change — the purified stream necessarily
  invalidates the old one, so a red guard test must be fixed by re-recording, never by reverting the
  purification. Older local `?playback` recordings (`replay:*` in localStorage) are invalidated too.
- **`assets:check` gained a third lane** (ops): the `level-1` descriptor's `introTrace` must exist on S3
  (`recordings/`), so a bad hash blocks the deploy instead of shipping a 404 intro. See DECISIONS §73.

- **HUD earned-credits counter now green.** In the top-right `credits {total}/{earned} earned`
  readout, the **Earned this run** number is now rendered green (`.hud-earned`, `#77ee77` — the same
  green as the "+xx" kill popups) so the live mission gain stands out from the persistent balance.
  `updateHud` wraps the `{earned}` interpolation in a `<span class="hud-earned">`; works for both EN
  and RU. CSS + one-line `hud.js` change.

- **HUD "credits X/Y earned" font no longer oversized.** The top-right credits readout used
  `.bigval` (26px / weight 700) — nearly double every other HUD readout, so it read as gigantic. Dropped
  to **14px / weight 600**, matching the sibling `#hppct` readout (14px) and the rest of the HUD scale.
  CSS-only (`.bigval` is used only by `#credits`).

## 2026-07-25

- **FX polish shipped to prod + itch: flipbook explosions + kinetic energy bolts.** Two visual upgrades,
  prototyped in the `/v2` sandbox and now promoted to `main`/production and re-published to itch.io:
  1. **Flipbook (sprite-sheet) ship-death fireball** (`client/src/flipbook-fx.js`) — a single
     camera-facing quad that plays a procedurally-baked explosion animation (~0.78 s) replaces the old
     stack of 4 additive fireball spheres in `spawnShipExplosion`. Sparks + shockwave ring stay. **One
     draw call per blast + one sprite-sheet texture uploaded once for the session** (vs ~28 meshes
     before), so it's cheaper on weak phones (the measured draw-call-submit bottleneck, DECISIONS §23)
     yet reads like a movie fireball.
  2. **Kinetic energy bolt + muzzle flash** (`client/src/bolt-fx.js`) — kinetic bullets render as a
     travel-aligned additive glow bolt (hot core + soft rim, one shared glow texture) laid on the combat
     plane instead of a flat opaque sphere, and each shot pops a quick tinted muzzle flash at the barrel.
     `spawnBullet` branches on `weapon.class`; other classes keep the sphere. One draw call per shot.

  Both are **pure render** — no sim/RNG/economy/schema changes — so the intro cutscene + `?playback`
  replays stay deterministic (verified: client unit tests 183/0; the sim RNG draw sequence is unchanged).
  New `flipbooks` pool in `state.js` (advanced in `sim.update()`, cleared in `reset()`). The
  `02-ship-explosion` visual scenario was updated to assert the surviving sparks + shockwave (the fireball
  no longer feeds the `explosions` pool). Deployed to prod via the normal `main` CI/CD + `publish-itch`.

- **Multiplayer architecture brief written (docs only, no code, nothing decided).** New
  `docs/plans/multiplayer-architecture.md` audits the current code against the parked Phase 5 netcode
  notes and lays out a sequenced path to **server-authoritative co-op**: what already helps (mission
  scripts + catalog are already server-side; `?record`/`?playback` is already an input-stream protocol;
  `ghost-battle.js` is already a remote-entity interpolator; the THREE-free pure modules), and the four
  real blockers (sim state lives inside Three.js objects, `sim.js` mixes sim + FX + DOM + network, the
  world is a module-level singleton in `state.js`, and the economy is client-authoritative). Phases:
  throwaway feel-check spike → **decouple the sim from Three.js/DOM/audio/net into `shared/sim/`** (the
  bulk of the cost, single-player, guarded by the intro-trace/replay/bench oracle) → run it headless in
  Node + seal the economy server-side → `ws` transport + rooms (one room per worker process) →
  prediction/reconciliation + generalized remote-entity renderer → the MP-only game rules (pause per
  DECISIONS §16, loot attribution, victory condition, disconnects) → ops (blue-green deploys currently
  kill live sockets). Open decisions are listed in the brief; PvP is explicitly out of scope.

- **`/v2` experimental client sandbox is LIVE + deploy architecture documented.** A client-only
  visual-FX sandbox is now serving at **https://vega.tenony.com/v2** — a standalone `nginx:alpine`
  container (`docker-compose.v2.yml`, `deploy/v2/*` on the new `v2` git branch) that Traefik routes via
  `Host(vega.tenony.com) && PathPrefix(/v2)` (priority 100, trailing-slash redirect + StripPrefix). It
  shares the **production `/api` + Postgres** for free (bare `/api` calls carry no `/v2` prefix, so they
  fall through to the prod `app` container) and joins only the `proxy` network — **the prod `app`
  service/router are untouched**. Hard rule: `v2` changes the **client only** (no server/schema/catalog/
  sim), so sharing the live DB carries no data risk. Verified: `/v2/` 200, assets + models 200, prod
  unaffected. Auto-deploy CI on push to `v2` is still TODO (redeploy is manual rsync + compose-up).
  `docs/SUMMARY.md` Deployment & CI/CD section now spells out the **single-origin serving** model — one
  Node container serves the static client (`express.static(clientDir)`, `client/` baked into the Docker
  image) *and* the `/api` on port 4000, the client reaching the API via a baked same-origin `API_BASE`
  (`client/src/api-base.js`) — and the **full CI deploy pipeline** (assets-check → assets-pull → rsync to
  `/opt/projects/spacegame/` → `docker compose build --build-arg GIT_SHA` → `docker rollout` blue-green →
  `/api/health` smoke check with legacy-host fallback → optional Sentry release). New build brief
  `docs/plans/v2-experimental-branch.md` + **DECISIONS §72** record a planned **`vega.tenony.com/v2`**
  sandbox for FX-polish visual experiments: **subpath** (same origin, so `/api` + prod DB are shared for
  free), **shared production Postgres**, and a **hard client-only rule** (no server/schema/catalog/sim
  changes — the FX work is pure render, so sharing the live DB carries no data risk).

## 2026-07-17

- **Dev diagnostics no longer leak onto touch devices.** Two fixes so a phone/tablet that once opened
  `?dev` (e.g. to collect low-end perf telemetry) doesn't get stuck with dev UI:
  1. **`?dev` is now non-sticky on touch** — `evalDevForDevice` (`client/src/dev.js`) ignores (and never
     writes) `localStorage['devMode']` when `Device.input === 'touch'`, so dev diagnostics — the top-center
     **FPS/triangles perf overlay** *and* the `devPerf` telemetry — are on **only** while an explicit truthy
     `?dev` is in the current URL. This kills the "FPS/tris sometimes visible in normal play" leak (the
     sticky flag survived from an earlier `?dev` visit). Desktop keeps the sticky flag unchanged.
  2. **The right-docked lil-gui panels are never built on touch** — the `?tune` palette/**colors** panel and
     the `?dev` **"Backdrop authoring" record/sliders** panel are gated behind `Device.input !== 'touch'` in
     `main.js` bootstrap; they're mouse-only tools that just clutter a phone screen. Under an explicit `?dev`
     on touch the perf overlay still shows — only these panels are suppressed.
  Regression guard: `dev.test.js` covers touch ignoring a stuck sticky flag + honoring (but not persisting)
  an explicit `?dev`. Quick unblock for anyone already stuck: open `/?dev=false` once.

## 2026-07-16

- **Wider camera zoom range.** The zoom clamp widened from `0.6–2.2×` to `0.35–3.5×` of the fixed camera
  offset (`ZOOM_MIN`/`ZOOM_MAX` in `engine.js`) — you can now zoom in noticeably closer and pull out much
  farther via the wheel / ＋−  buttons / pinch. No change to smoothing or persistence.

- **Shield hits land ON the bubble sphere, not on the hull inside it.** While a shield is UP, an incoming
  hostile shot is now intercepted on the shield **sphere** (radius `SHIELD_RADIUS = 4`, the same sphere
  `shield-fx.js` draws) instead of the ship hull — the bullet stops at the sphere surface and its hit-flash +
  cyan ripple appear there, so the shield visibly *blocks* the shot rather than letting it reach the ship. A
  **broken/absent** shield falls back to the swept hull test exactly as before (bullets reach the ship). Net
  effect while shielded: the effective hitbox is the (slightly larger, rounder) bubble sphere, so a few shots
  that would have flown just past the hull are now caught by the shield. Implemented in `collision.js`
  (`resolveHostileBulletHit` gains an `impact` return = the sphere-entry point via a new pure ray-sphere
  `segmentSphereHit`; `SHIELD_RADIUS` is exported and `shield-fx.js` imports it so FX-sphere and hitbox share
  one source of truth); `sim.js` snaps the bullet to `res.impact` before spawning the hit-flash/ripple. +4
  unit tests. Verified the recorded Level-0 intro re-sim still wins and reaches the Level-1 briefing with the
  wider shielded hitbox (headless playback). See DECISIONS §68.
- **Fix: enemy bullets dealt no damage and stuttered the frame.** `applyPlayerDamage` was called but not
  imported in `sim.js` after the shield-ripple refactor (commit 51eec94, which moved it from `projectiles.js`
  to `components.js`), so every hostile-bullet→player hit threw a `ReferenceError` that aborted the rest of
  the frame's `update()` (the visible stutter) and skipped the bullet cull below — the shot flew straight
  through the player dealing no damage. Extracted the enemy-bullet→player hit-resolution into a pure,
  THREE-free `resolveHostileBulletHit(player, p0, p1, damage) → { hit, damageResult, remove }` helper in
  `collision.js` (side-effect-/RNG-free, so record/playback stays deterministic) and wired `sim.js` to it, so
  `sim.js` no longer names `applyPlayerDamage` at all. Scene.remove / hit-flash / shield-ripple / SFX and the
  range-based bullet culling stay inline in `sim.update()`. Enemy fire again damages the player (shield-first,
  then hull) and the offending bullet is consumed on impact. +3 unit tests in `collision.test.js`. [2026-07-16-1409-fix-player-damage-import]
- **Mission asteroid-field rocks are now a real 3D model (CC-BY pack).** The mission `asteroid-field`
  set-piece (the ~24 field rocks + the 2 mining-rig host rocks) now scatters random variants from a 3-mesh
  `.glb` pack (`asteroids_combat`, "Wandering Asteroids Of Andromeda" by ARCTIC WOLVES™, CC-BY 4.0 — added
  to `CREDITS.md`). A shared loader (`loadAsteroidPack`, `world.js`) fetches the pack once and hands back 3
  variants normalized to unit radius; the field clones them per rock (fog OFF, readable up close), builds
  **asynchronously** (empty group now, populated on load) like the freighter set-piece, and keeps the
  procedural cratered icosahedra as the `?debug` / load-failure fallback. `modelUrl` lives on the
  `asteroid-field` set-piece in the `home-system` descriptor (`catalog_seed.js`).
- **The distant parallax backdrop field stays procedural** (low-poly instanced icosahedra, ~40k tris). A
  model backdrop was prototyped but reverted: a full-disk field of 2000 instanced model rocks is ~1.6M tris
  (vs a ~70–100k budget) and the rocks are sub-pixel specks at that distance where the detail is wasted.
  See DECISIONS §71.
- **Asset pipeline:** new `asteroids` preset override (`assets-config.mjs`) — the source's legacy
  spec-gloss materials are converted to metal-rough (three r160 dropped spec-gloss), textures shrunk to
  256px WebP, geometry kept (already low-poly; simplifying shredded the rock silhouette) → a ~171 KB combat
  glb. Two pipeline gotchas fixed: (1) wired a new `--prune-solid-textures` flag through `assets-build.mjs`
  (`optimize` was baking the low-contrast rock diffuse maps into a flat `baseColorFactor`, losing all
  surface detail → preset sets `pruneSolidTextures: false`); (2) **meshopt compression disabled**
  (`compress: false`) — `EXT_meshopt_compression`/`KHR_mesh_quantization` shredded these meshes' geometry
  and normals into a shattered spiky mess in-game (the ships survive it, these don't). See DECISIONS §71.
- **Music is ~2× quieter by default (players found it too loud).** Added a baked `MUSIC_TRIM = 0.5` on the
  music bus in `client/src/audio.js`, applied in both `effectiveGain('music')` and `applyVolumes`. The Music
  slider stays the user's control at its ≈-middle default (45%), but the whole music channel is halved behind
  it — so music is ~2× quieter for **everyone**, including players who had already raised their slider (100%
  now = half the old 100%). SFX/master untouched; mirrors the per-SFX `gain` trims. No asset changes (pure
  gain constant). +1 test guarding the trim applies to music only. See DECISIONS §69.

## 2026-07-14

- **Simplify `datastore.js` — the façade is now `export * from './db.js'`.** Follow-up to the
  Postgres-only refactor (§67): now that the runtime SQLite/Postgres selector is gone, the 40 hand-written
  `export const foo = (...a) => impl.foo(...a)` pass-throughs collapse to a single `export * from './db.js'`
  (plus the `backend = 'postgres'` const). Same stable import surface for every consumer, but new `db.js`
  functions are exported automatically instead of needing a matching wrapper line. No behavior change;
  server suite green (85/85). (`pool` is now also re-exported via the façade — harmless.)

## 2026-07-13

- **[2026-07-13-1844-shield-hit-ripple] Shield-hit FX — a shield bubble that flashes & ripples on hit.**
  Added a cosmetic translucent **shield bubble** around the player ship (new `client/src/shield-fx.js`, a
  `ShaderMaterial` sphere). While a shield is equipped it shows a faint idle Fresnel rim; on every **absorbed
  hit** it flashes and sends a ripple **outward from the impact point** (an expanding gaussian ring capped to
  the near hemisphere, up to 6 concurrent), brighter/near-white on the **breaking** hit; and when the shield
  **finishes recharging** (broken → full) the **whole sphere flashes once**. Wired from the existing damage
  sites via `spawnShieldHit(pos, broke)` (`sim.js` bullet + `projectiles.js` rocket) and the recharge-complete
  transition via `spawnShieldReady()` (`sim.js`); advanced per rendered frame by `updateShieldBubble(dt)` in
  `main.js`. **Pure render** — reads sim state but writes none and uses no seeded RNG, so record/playback and
  the intro cutscene stay bit-identical. Refactor: `applyPlayerDamage` moved from `projectiles.js` to
  `components.js` (alongside `absorbDamage`/`shieldRecharge`) and now returns `{ absorbed, broke }` (the FX
  trigger contract), making it unit-testable — **+5 tests** in `components.test.js`. No new assets (procedural
  shader → no `CREDITS.md` change). See DECISIONS §68.

## 2026-07-12

- **[2026-07-12-1826-backend-postgres-only] Backend is Postgres-only — SQLite dropped (maintainability, no
  behavior change).** Deleted the hand-maintained SQLite data layer (`db.js`, 678 lines), the `migrate.js`
  runner, and `migrations/001…023`; renamed `db_postgres.js → db.js` (the single data layer); `datastore.js`
  is now a static façade with `backend = 'postgres'`. The pool defaults to
  `postgres://localhost:5432/spacegame` so `npm start`/`reset.js` work with zero env; prod/CI set
  `DATABASE_URL`. `npm test` now targets Postgres and a `pretest` drops+recreates `spacegame_test` for a
  clean schema (folds in the old `test:pg`); CI runs one Postgres job (the second, SQLite, job removed).
  Removed the now-inert `--disable-warning=ExperimentalWarning` flags (node:sqlite was their only trigger)
  from package.json/Dockerfile/bench/visual/skills; the bench/visual dev runners now point their isolated
  server at `spacegame_test` (their old `DB_PATH` throwaway-file isolation became a no-op). reset-progress
  skill + READMEs rewritten Postgres-only. Deleted `backfill-grab.test.js` (SQLite-only unit test of
  migration 019; the PG backfill stays idempotent in `db.js migrate()`). See DECISIONS §67.

## 2026-07-11

- **[2026-07-11-1503-shield-component] Base shield component.** New `shield` component type (a real catalog
  component in a new optional `shield` slot): the **Base shield** (id 31, capacity 20 / recharge 10 s /
  weight 0 / price 500) is equipped on the starter ship and buyable in the shop. All incoming player damage
  (enemy bullets + rocket blast) now routes through one `applyPlayerDamage(player, dmg)` helper that absorbs
  into the shield first, spilling only the **excess** to the hull; a hit that fully depletes the shield
  breaks it and it recharges to **full** over the recharge time (a partial shield holds indefinitely and
  never triggers recharge). New HUD **shield bar directly above a now-red health bar** — blue while active
  (width = remaining fraction), purple while recharging (width grows over the recharge time); the standalone
  "Health" label was dropped (the colour-coded stacked bars are self-descriptive). Pure, unit-tested
  `absorbDamage`/`shieldRecharge` in `components.js`. SQLite migration `023_backfill_shield.js` + a mirrored
  Postgres back-fill grant the slot to existing players; EN+RU shop strings added. **No** ship-visual / FX
  this iteration — HUD bar states only.
- **Reworked the Level 2–3 campaign spine so the briefings mean something (grounded in the actual
  bosses).** Level 2 is now "**fight through to the weapons factory**" (was "push the pirates off the
  factory"); its ending medium mini-boss is framed as the heavier escort holding the door. Level 3 is now
  "**take the factory**", defended by the **first genuinely big enemy warship** (the Sector boss that
  actually spawns at the end of that level) — previously `level.3.briefing` only talked about the salvaged
  repair drone and named no mission at all. Level 3 victory reframed (warship down, factory taken, some
  pirates flee) and the Level 4 briefing tweaked to follow on ("those ships that ran when the factory
  fell…"). Salvage-gear framing preserved (MG before L2, repair drone before L3 — matches the drops).
  EN + RU; `source.json` + `ru.json` + `docs/narrative/canon.md`; no code/logic.
- **Polished the level victory lines (L0–L3) into the mission-control register.** Rewrote
  `level.0.victory`…`level.3.victory` (EN + RU) to match the dispatcher voice already used by
  `level.4.victory`, dropping game vocabulary ("Level N cleared!", "mid-boss"). Also fixed two canon
  slips: `level.0.victory` no longer calls the intro a "patrol" (it's an ambush now), and
  `level.3.victory` no longer reads as the finale (Levels 4–5 follow — it now sets up the hunt for the
  pirate base). Strings-only; no code/logic.
- **Added a narrative-canon doc home (`docs/narrative/`).** A seed for story/character/tone reference
  that future player-facing text is generated *from*, so the writing stays consistent as the game grows.
  `README.md` (conventions: reference not shipped text, English-only, capture-established-only),
  `canon.md` (premise, setting, factions, the level-by-level story spine cross-referenced to the locale
  keys, and the tone/register from §65), and `characters/player-sentinel.md` (the protagonist =
  **rookie Vega Sentinel**). Deliberately minimal (DECISIONS §30) — the far-reaching setting bible is
  deferred; this exists so the canon that already exists is captured and reusable. Also noted a known
  stale line to reconcile later (`level.3.victory` says "final level" but L4–L5 exist).
- **Rewrote the intro-cutscene + first-mission narrative (less naive, grounded register).** Replaced the
  Level-0 intro cutscene lines (`ui.cutscene.p0`–`p4`), the Level 1 briefing (`level.1.briefing`), and the
  welcome-screen intro (`ui.welcome.intro`) in EN + RU. New voice: the pilot is a rookie **Vega Sentinel**
  ambushed on approach to their first posting — scared but holding, no hero quips or `!!!` bravado. The
  cutscene now deliberately teaches the mechanics through the beats: dodge enemy fire (p1) → the ship's own
  **rocket launcher** downs the second pirate (p1→p2) → an enemy rocketeer's missiles can be **outrun** (p3)
  and **shot down** with the cannon (p4). The Level 1 briefing is now spoken by a **station dispatcher**
  ("you made it in just in time, and in a ship like that…") who asks the player to drive the pirates off the
  station first and sort out the rest later. Strings-only change (`source.json` + `ru.json`); no code/logic.
  Starter weapon stays the **cannon** (+ rockets); the Machine Gun remains the Level-1 salvage reward, so the
  L2 briefing arc is unaffected.

## 2026-07-10

- **[2026-07-10-1524-language-selector-menu] Language selector in Settings + intro cutscene.** EN/RU toggles
  added to the **Settings modal** (`#settings-lang`, a Language row between Graphics quality and the reset
  danger zone; `ui.settings.language`, EN "Language" / RU "Язык") and the **intro cutscene screen**
  (`#cutscene-lang`, a persistent top-left toggle beside Skip) so a Russian-defaulted player (e.g. on itch) can
  switch language after the welcome screen — where a brand-new player, dropped straight into the Level-0
  cutscene, never sees the welcome toggle. Both reuse the existing `setLanguage()` i18n path (live, no reload):
  all three toggle hosts share a `.lang-switch` look and a single re-localize entry point — `applyTranslations()`
  re-renders every mounted host from a module-scoped `langHosts` registry (via the pure `langButtons()` helper +
  `mountLangSwitch()`), so a non-`en` initial load highlights the right button on first paint and a live switch
  updates every host at once. The cutscene toggle is a `<body>` sibling of the overlay (+ `stopPropagation` on
  each button) so tapping it re-localizes the visible card without advancing/skipping the cutscene, and is
  removed in `cutsceneEnd()` so it can't leak into live Level 1. New unit test (`langButtons`) + visual
  scenarios (21 RU-initial-state guard, extended 14 live-switch).
- **[2026-07-10-1303-fix-intro-replay-teardown] Intro → Take-off dead-screen fix + reset now replays the
  intro.** (1) The playback/cutscene lifecycle state is now one `makeReplaySession()` object in `replay.js`
  (unit-tested `teardown()`); `finishIntro()` calls `rs.teardown()` + clears `G.replayMode` before landing on
  the Level 1 briefing, so `animate()` leaves the inert `if (REC || rs.play)` branch and Take-off's `reset()`
  runs the live sim (previously the loop stayed stuck in playback → no player/enemies/input). The
  `PLAY`/`play*`/`CUT`/`cut*` module vars in `main.js` are mechanically renamed to `rs.*`; no behavior change
  for `?record`/`?playback`. (2) The intro trigger is now **server-authoritative**: gated solely on the
  served level carrying `introTrace` (present only while `current_progress===1`) + the headless check, via a
  new pure `shouldPlayIntro()` — the redundant client `localStorage['introSeen']` guard is gone, so a genuine
  `reset-progress` now REPLAYS the intro. New `shouldPlayIntro` unit test + a server test that a
  progress-1/reset player is served an `introTrace`-carrying level (and level-2 is not).

- **[2026-07-09-replay-record] Real new-player intro flow wired: auto-cutscene from S3 → Level 1 briefing.**
  A brand-new player (or reset progress) at Level 0 now **auto-plays the intro cutscene** (bootstrap
  `startIntroCutscene` fetches the canonical recording named on the level descriptor's `introTrace` and drives
  the playback+cutscene machinery), then on finish/Skip **advances `current_progress` 1→2** (`finishIntro` →
  `unlockNextLevel`) and lands on the **Level 1 Main Window briefing** + Take off (shop stays gated). Headless
  (`?debug`/`?bench`), already-seen (`localStorage['introSeen']`), or no recording → the playable Level 0 (the
  arena the harnesses + `?dev` re-record path expect). Verified: a fresh player auto-opens on the P0 card with
  the HUD hidden, no console errors.
  - **Canonical recording is an S3 asset.** The intro trace (`level0-intro.<hash>.json`) lives on S3 under a
    new `recordings/` prefix, pulled same-origin by `assets:pull` (config + pull wired in
    `scripts/assets-config.mjs` / `assets-pull.mjs`), and referenced content-hashed from the `level-1`
    descriptor (`introTrace`). New recording = new URL, like the ship glbs.
  - **Level 1 got its briefing back.** Restored the original first-flight briefing (`level.1.briefing`, EN+RU
    — "Pirates are raiding our home system…") on the `level-2` descriptor, so after the intro the player lands
    on a real Main Window briefing (not the "Stand by" default). Reseed the catalog on deploy.

- **[2026-07-09-replay-record] Level-0 intro cutscene on the input-replay playback (event-driven pauses +
  auto return-to-base).** `?playback&id={id}&cutscene=1` overlays the Level-0 script on a playback: a P0
  opening card (freeze before the fight, tap to begin) + P1–P4 text pauses each firing **~1s after their SIM
  EVENT** (1st/2nd kill, rocketeer warp-in, the rocketeer's 2nd rocket) — event-driven, so re-recording never
  needs re-timing. New `client/src/level0-cutscene.js` (the pause script) + runtime in `main.js` (event
  detection, a cutscene-local freeze that never pops the combat Pause overlay, a localized lower-third card,
  Skip). EN+RU `ui.cutscene.p0..p4` + skip/tap. On clearing the fight it **simulates the "Return to base"
  button** (`engageAutopilot` — a click, so not in the key trace) and flies home to the victory overlay.
- **Record/playback are READ-ONLY (`G.replayMode`).** A replayed win showed the victory overlay but was also
  calling `unlockNextLevel()`/`bankRun()`/`depositLoot()`/funnel — silently advancing the real player's
  progress (skipping levels) and banking credits. `win()` now gates every server side effect on
  `!G.replayMode` (set for `?record`/`?playback`). Verified: a replayed win fires ZERO server mutations.
- **Recordings are account-independent.** Playback rebuilt the player from the CURRENT account loadout, so a
  weapon unlocked on a later level (e.g. the Machine Gun) leaked into an intro-level replay. `buildPlayerFor`
  gained an `override` param; playback now builds the **recorded** loadout — captured in the trace
  (`loadout`/`components`) for new recordings, or the ship's catalog defaults for old ones — never the account.
  Verified bit-for-bit with the captured loadout.
- **Camera/planet no longer jump when the cutscene un-freezes.** Extracted `settleView()` from `update()` and
  call it right after `reset()` in record/playback, so a frozen P0 frame is already framed on the player (the
  camera + stars + planet parallax + moons were only set inside `update()`, which the freeze skips).
- **Campaign flow: a no-briefing level lands on the Welcome/take-off screen after a victory, not the "Stand
  by" default.** `leaveOverlay` (post-victory Continue) now mirrors bootstrap/account
  (`briefing ? showMain : showWelcome`) — fixes Level 1 (no briefing yet) showing "Stand by for new orders"
  right after the Level 0 intro.

- **[2026-07-09-replay-record] Combat record/playback via deterministic input-replay.** A new general
  mechanism to **record a fight and replay it on the real engine**: `?record=1&level={id}` captures the
  player's INPUT + the RNG seed (trace `{seed,dt,shipId,level,ticks:[{k,t}]}`), and `?playback&id={id}`
  re-runs the actual `sim` from it — so playback has real bullet colors, smooth physics, real FX and real
  collisions (not the old "movie of positions"). New `client/src/replay.js` (pure core, unit-tested in
  `replay.test.js`) + wiring in `main.js`; a `window.__replay` console/automation hook. Record lands on the
  **real ship idle** with a **Start recording** button that unlocks once the ship `.glb` has loaded (no
  placeholder capture); **Stop & Save** writes the trace to `localStorage` + downloads `{id}.json` + offers a
  **Play it ▶** link. **User-visible effect:** you can record a Level-0 playthrough and watch it play back
  faithfully. Built as the foundation the Level-0 intro cutscene (and alt-angle views / video capture) will
  sit on. Storage today is `localStorage` + file download; **S3-asset storage is the planned next step**.
  - **Real-time pacing.** Both modes advance the sim with a **fixed-timestep accumulator** (real elapsed time
    → whole `BENCH_DT` steps), fixing a 2× fast-forward on 120 Hz displays (one fixed step ran per frame).
  - **Determinism isolation (load-bearing fix).** The seeded `Math.random` now feeds the **sim only** — a
    private seeded PRNG is swapped in around `update()`/`reset()`, and the native RNG serves render / HUD / FX
    animation / audio / idle frames. Without this, cosmetic per-frame draws (whose count differs between
    record and playback because frames ≠ ticks) desynced the run. `client/src/audio.js` pitch/variant/noise
    randomness was likewise moved to a **module-local PRNG** (audio only runs when the ctx is unlocked, so it
    would otherwise consume the seeded stream asymmetrically). Verified: record↔playback reproduce a fight
    **bit-for-bit** (rounded-position state hash) regardless of frame rate, audio state, or model-load timing.
  - New `/record-playback` skill documents the record→playback loop.

## 2026-07-08

- **[2026-07-08-2224-intro-first-level] Intro "Level 0" first level.** A gentle, non-skippable opening
  level (3 basic pirates one at a time via `maxConcurrent 1` → 1 rocket-pirate finale, no boss, no reward,
  `enemyTotal 4`) is now the first level every new player plays. Implemented by keeping the seed names
  `level-1`..`level-4` stable (stable ids) and shifting the campaign descriptors down one id + appending
  `level-5` (old L4) — the campaign keeps its "Level 1"–"Level 4" titles/rewards/briefings, one id higher.
  Existing players were migrated `+1` (SQLite migration `022_intro_level0_shift.js` + an idempotent guarded
  one-shot on Postgres via a `migrations_pg` ledger, run after the levels seed so the FK validates) so they
  stayed on their exact same content. New EN+RU `level.0.victory` string ("First patrol clear, Sentinel.").
  **On first launch the intro auto-launches straight into the fight — no welcome screen, no "Take off"**
  (the ship is controllable at once, flying the default player ship, gated to `level.name === 'level-1'`);
  Level 1+ landing is unchanged. The maintainer will record a playthrough of this level for the parked intro
  cutscene (Step 2). Deploy needs a catalog reseed + the `+1` migration to run.
- **Balance: ease level-2 & level-3 — 3 enemies on-screen at once (was 4).** Players reported these
  missions felt too hard, so the non-boss spawning phases of `level-2` and `level-3` had their
  `maxConcurrent` lowered from **4 → 3** (`server/src/catalog_seed.js`: L2 `wave-1`/`wave-2`/`clear-out`,
  L3 `wave-1`/`wave-2`/`clear-out`), matching level-1's cap. Only the simultaneous-alive cap changed —
  per-phase `spawn.total` and the stamped `enemyTotal` (L2 = 17, L3 = 21), the boss phases, and the
  killed/total counter and last-kill reward are all unchanged. Enemies still trickle in one at a time on the
  2–4 s cooldown, just filling toward 3 instead of 4. `enemy_total`, `level-sim`, and `spawn-timing` tests
  still pass. The new descriptors reach players automatically on deploy — the server re-upserts the level
  catalog from `catalog_seed.js` on every startup (`db_postgres.js` `ON CONFLICT (name) DO UPDATE`).

- **Dev: live ship-speed readout in the perf overlay.** `updatePerf` (`client/src/hud.js`) now appends
  `· spd N pk N` (current `|velocity|` + a per-run peak-hold, units/s) to the perf line, to help tune a
  future player max-speed cap (the ship has no speed limit today). Dev-only — the perf overlay only renders
  under `body.devmode` (`styles.css`), so regular players never see it. Peak resets when a fresh `G.player`
  is built (run start / loadout change).

- **Tooling: pipeline agent retro-learnings.** Appended hard-won lessons to `.claude/agents/` guidance
  (`code-reviewer`, `feature-planner`, `plan-critic`): on any spawn/timing/**pacing** diff, trace every
  reward/counter/threshold derived from the old timing and demand a full-level outcome test; and when citing
  an existing test as a helper, check what it *asserts* against the behavior being changed. No runtime effect.

## 2026-07-07

- **Fix: touch HUD overlap — zoom buttons vs the Return-to-base button.** On phones the `＋/−` zoom pair
  (`body.touch #zoom`) sat bottom-center at `bottom:40px`, directly under the Return-to-base pill
  (`#return-btn`, `bottom:34px`), so during the return-to-base phase the two overlapped. Moved the touch
  zoom pair to the **top-right, a vertical column under the "Destroyed X/Y" counter** (clear of the counter,
  the rocket button, and the return button). Also **restyled `#return-btn` to match the Take-off button**
  (orange gradient `#ffb35a→#ff7a3c`, dark text) so it reads as the primary "go" action instead of a blue
  pill. CSS-only (`client/styles.css`); verified with a headless layout check (no rect overlaps on an
  812×375 touch viewport). Docs: SUMMARY zoom + return-button sections.
- **Ambient "ghost battle"** — a **clearly visible** looping recorded "ghost battle" (near-opaque, full-color,
  below-plane (`y≈−60`) ghost ships **with births AND deaths** + their bullets) now plays as decor at a **FIXED
  ABSOLUTE world point** (default `(−100,−450)`) — a distant landmark you fly toward — in **every mission EXCEPT
  the freighter escort** (you're IN that fight there). The ghosts sit on a separate layer below the `y=0.6`
  combat plane (the player can never shoot them) and carry no HUD/markers/health-bars, collision, targeting, or
  audio — the "distant/not-mine" read comes from horizontal separation, not dimming (over-dimming was the first
  playtest failure). It is a **committed transform-replay track** (`client/src/backdrop-battle.js`) replayed at
  runtime (`client/src/ghost-battle.js`) as a dumb lerped animation — it **never runs a second sim** and never
  touches the live world. A ghost death regenerates the real small-pirate explosion at the ghost's own depth
  (`spawnShipExplosion` gained an optional `ringY` param so the shockwave ring stays off the combat plane). The
  freighter render position was nudged **+50 z (−450 → −400)** (mission `center` stays at −450, balance-neutral).
  No new assets (ghost ships reuse the existing `player_combat` + `enemy_*_combat` glbs).
  - **Built in `sim.js reset()`**, gated `G.activeMission?.title !== 'freighter'` (campaign `null` → shows;
    mining/research → show; freighter escort → hidden), at the absolute `GHOST_TUNE.ax/y/az` (NOT arenaCenter-
    relative, NOT following any object). `buildGhostBattle()` takes no argument, adds its group to `scene` + a
    `setPieces` entry (universal teardown on the next reset), and **self-skips under `?debug` AND `?bench`** (both
    headless harnesses — the async glb loads would add nondeterministic draw counts to the §58 perf gate, which
    now runs the campaign where this fires).
  - **Player flies FREELY — re-center by a SINGLE FIXED OFFSET (the mean of the player's path).** The shared
    `recenterAndQuantize` subtracts one constant `(mean(p0.x), mean(p0.z))` from every ship + bullet, so only a
    constant is removed → the player's real free-flight motion is preserved (it visibly flies), enemies move
    naturally, and there's **no per-frame membership dependence → no birth/death jumps**. (Reverses the two
    rejected earlier anchors: per-keyframe slot-0 pinning froze the player at center; the cast-centroid anchor
    stepped at every birth/death and jerked the whole formation "downward".)
  - **Births keep the clip populated.** Each slot carries `birth` + `death`; the track holds up to **16 slots**
    and the recorder assigns a NEW `birth` slot to every enemy — **including later-spawned waves** — instead of
    freezing the record-start cast. The runtime builds one mesh per slot but shows only born-and-alive slots up
    to a per-tier **CONCURRENT ceiling** (`maxConcurrent`: **High 8 + bullets, Balance 4 / no bullets,
    Performance off**). A death only explodes if the ghost was on-screen the prior frame (no sourceless burst).
  - **Authoring = a REAL in-game recording** via a new **`?dev` "Backdrop" panel** (lil-gui, mirrors `?tune`):
    a **Start/Stop-record** button with a live **`REC 12s/60s`** readout (auto-stops at 60 s) captures the
    played battle (`window.__backdrop.record()/stop()/status()`) and downloads a `backdrop-battle.js` module;
    plus live **Depth / Scale / Opacity / Anchor X / Anchor Z** sliders driving a persisted `GHOST_TUNE`
    (`localStorage['ghostTune']`, defaults `{y:−60, scale:0.8, opacity:0.9, ax:−100, az:−450}`). **Anchor X/Z**
    are the absolute world anchor (±600) that moves the battle across the ground plane (the placement control);
    **Depth (y)** mostly changes apparent size under the near-top-down camera (layer separation). Authoring note:
    don't OOB-warp mid-record (it skews the player's mean → shifts the cloud; nudge back with Anchor X/Z). A
    synthetic `client/bench/gen-backdrop.mjs` (`window.__bench.bakeBackdrop`, `npm run bench:backdrop`) is a
    **bootstrap/fallback**; both paths share the pure `recenterAndQuantize`. Docs: SUMMARY, DECISIONS §59.
    Tests: `client/src/ghost-battle-track.test.js` (gating + `slotAlive` + sampler + quantize + 5-key tune
    helpers + `recenterAndQuantize` fixed-mean-offset/born-late + shape (birth/death invariants, ≤16) +
    player-flies-freely / `<600u` runaway guard).

- **Grab reel-in speed is now a linear ramp (no near-ship jerk).** Replaced the `1/dist²` field-based pull
  *speed* with a **linear ramp by distance** — `PULL_SPEED_FAR = 1` u/s far out rising linearly to
  `PULL_SPEED_NEAR = 4` u/s at the ship (weight-10 refs; `·(10/weight)`), floored at/beyond `PULL_FAR_DIST = 11`.
  Deliberately un-physical: a constant slope removes the sharp near-ship snap the inverse-square speed produced,
  which plays better. Speed now depends on **distance + weight only, not strength** (strength still drives reach).
  Retired `PULL_SPEED_SCALE`. **Reach is unchanged** (still `field`/`FIELD_CUTOFF`: base ≈11.2 u, Advanced ≈15.8 u,
  √2 ratio). `pullSpeed` signature dropped its `strength` arg. Docs: SUMMARY, DECISIONS §57. Tests: `drops.test.js`
  pull-speed suite rewritten (linear anchors, constant-slope + floor-clamp checks); client 116/116.

- **Grab pull speed tuned down ~1.5× (reach unchanged).** Added `PULL_SPEED_SCALE = 0.67` to
  `drops-config.js` and applied it in `pullSpeed` only, so drops reel in about 1.5× slower while the
  emergent reach (base ≈11.2 u, Advanced ≈15.8 u) stays exactly the same — `field`/`FIELD_CUTOFF` (which
  define the range) are untouched. Follow-up to the inverse-square rebalance after live play felt the pull
  too fast. Docs: SUMMARY (Grab & loot drops), DECISIONS §57. Tests: `drops.test.js` anchors rescaled + a
  new "speed-only, not reach" assertion; client 115/115.

- **Feature-pipeline: human code-review step after the reviewer agent.** Added **Stage 6.5** to
  `/feature-pipeline` — once the `code-reviewer` agent returns PASS, the maintainer reviews the diff before
  commit, **every run**. The orchestrator gives a guided per-file walkthrough (what changed, why, how it
  fits the architecture, with `file:line` refs) **and** shows the diff, then asks approve / request-changes;
  "request-changes" loops implementer→reviewer→walkthrough. It's not a correctness re-check (the agent +
  tests cover that) — the point is a final human sign-off and keeping the maintainer's mental model of the
  codebase current. New run-log field `human_review{decision,rounds}`. Docs: `SKILL.md`,
  `multi-agent-pipeline.md` (flow + description), run-log schema in
  `docs/plans/pipeline-review-gate-and-run-log.md`.

## 2026-07-06

- **Grab tractor = inverse-square field with emergent range** `[2026-07-06-2350-grab-inverse-square-pull]`
  — the pull is now `strength·5/dist²`, engaging where field ≥ 0.4 (`FIELD_CUTOFF`); pull speed rises the
  closer a drop is, and the blue pull line hides the instant a drop drops below the cutoff. Range is now
  **derived** (not a stored stat) and **weight-independent**: base ≈11.2 u, Advanced ≈15.8 u (= √2× base,
  not 2×) — item weight scales only pull speed. Shop still shows the abstract strength number (10/20),
  relabeled so it no longer claims to equal the world-unit range. No DB/schema change (strength values
  unchanged at 10/20).

- **Feature-pipeline: pre-implementation review gate + committed run-log.** The `/feature-pipeline`
  orchestrator gained two things. (1) A **review gate (Stage 4.5)** — after the critic approves and
  *before* any code is written, the maintainer sees a compact digest (what the critic caught & how it was
  resolved · files that will change · tests planned · open decisions) and chooses approve / request-changes
  / stop. It's the one human-in-the-loop interrupt, placed on the least-reversible step. (2) A committed
  **`docs/pipeline-runs.jsonl`** run-log (Stage 11) — one JSONL line per run with per-agent
  tokens/tool-calls/time, the loop counters, critic/reviewer findings, review-gate decision, and live-test
  outcome, so critic/reviewer effectiveness and token cost can be tracked over time via `jq`/DuckDB (the
  headline metric = **escaped-defect rate**: bugs the live test caught that critic *and* reviewer both
  passed). Storage is a git-diffable JSONL journal, not an observability platform (DECISIONS §55; OTel
  export is the documented escape hatch). Docs: `SKILL.md`, `multi-agent-pipeline.md` (flow + "Analyzing
  runs" section + query recipes), full spec in `docs/plans/pipeline-review-gate-and-run-log.md`.
- **[2026-07-06-2154-admin-device-column] Admin "device" column.** `GET /admin` now shows the browser +
  device model each player played from — best-effort `Chrome · Galaxy A03s`, degrading to `Chrome ·
  Android 10` → raw User-Agent → blank, never crashing on odd/empty UAs (full raw UA on `title` hover).
  New nullable `players.user_agent` + `players.device_model` columns (migration 021 / PG bootstrap)
  captured at the boot `POST /api/players/register` call **latest-wins** (via `COALESCE`, so covers
  anonymous players too), using an `Accept-CH: Sec-CH-UA-Model` response header + the `Sec-CH-UA-Model`
  Chromium client hint (the device model is hidden from the modern Android UA). Curated code→marketing-name
  lookup + a hand-rolled UA parser (`deviceLabel`/`parseBrowser`/`parseOS`) in `server/src/admin.js`, **no
  new npm dependency** (DECISIONS §56). Best-effort: non-Chromium browsers + the cross-origin itch embed
  send no model hint, and existing rows stay `NULL` until the player next boots (no backfill). No client
  change (the browser sends the headers automatically).
- **[2026-07-06-2044-return-to-base-button] Return-to-base button.** A bottom-center "Return to base" pill
  button (`#return-btn`) now appears during return-to-base (after the last enemy is destroyed), giving
  players an obvious, always-on-screen tap target to auto-fly home and dock — the base station model is
  small and often off-screen. It does exactly what clicking the station does (`engageAutopilot()`). Shown
  only while return-to-base is available and the ship is still under player control (same predicate as
  `stationClickable()`), and hidden the moment the autopilot engages (reappears if the dock is cancelled
  mid-flight). Wired **split per DECISIONS §42** — touch fires on `touchstart` (so a second-thumb tap works
  while a steering finger holds `#stick-zone`), mouse on `click` — layered `z-index:6` above the full-screen
  stick zone and hidden on menus. New i18n key `ui.return.button` (EN + RU). The existing top-center
  `#return-hint` and station-click dock are unchanged.
- **PC menu layout: top-aligned start screen + un-clipped mission title.** Two CSS-only fixes scoped to
  non-phone forms (`body:not(.dev-phone)`). (1) The **welcome/start screen** now pins the greeting/intro
  **and** the Take-off footer to the **top** of the screen (button still directly under the text) instead
  of the mobile vertical-center — `#welcome` switches to `grid-template-rows: auto auto; align-content:
  start` and the scroll cell's centering auto-margins are dropped. (2) The **Main Window mission title**
  no longer hid behind the top-left account block: the floating `#account-bar` (fixed-position, over the
  left column) grew with the longer RU "guest / log in" string and spilled past a narrow 18% column into
  the work zone, clipping the title's first letters at windowed/tablet widths. The left column now gets a
  wider `minmax(240px, 18%)` min on non-phone forms so it fully contains the bar, and the bar's own
  `max-width` is capped (340→200px) so a long localized string wraps instead of overflowing right. Phone
  layout unchanged.

- **[2026-07-06-1738-fix-spawn-count-warpin] Deterministic spawn counts + enemy warp-in.** Fixed a
  staggered-spawns regression where the last-kill reward drops (L1 Machine Gun, L2 Repair drone) stopped
  appearing and the destroyed X/Y counter finished short (14/16, 15/16): the precomputed `enemyTotal`
  assumed the old instant-fill "carry". Every spawning phase now has an explicit `total` (threshold phase =
  its kill-delta, 0 leftovers; clear-out/finale waves carry the remainder), so `enemyTotal` = sum of phase
  totals and the counter reaches N/N and the drop fires on the true last kill. Totals preserved except L1
  (16→14). Enemies now appear immediately and materialize over their 2–4 s stagger interval — invulnerable,
  non-firing, and not homing-targetable until fully formed (player warp-back stays 1 s). New pure
  `client/src/level-sim.js` + test proves counter=enemyTotal and the drop fires on the last kill; server
  `enemy_total` simplified to sum-of-totals. New visual scenario `20-warp-blast-immunity` proves a rocket
  blast spares a co-located warping enemy. Catalog reseeds on server restart (prod on deploy).

- **[2026-07-06-1313-stagger-enemy-spawns] Staggered enemy spawns.** The level runner no longer tops the
  arena up to `maxConcurrent` every frame — every enemy spawn is gated by a randomized **2–4 s** cooldown
  (`client/src/spawn-timing.js`). The first enemy of each phase still appears immediately; each subsequent
  spawn (and each post-kill replacement) waits 2–4 s, so phases populate gradually. All phases/levels;
  totals (`enemyTotal`) and the win/return-to-base flow are unchanged. Updated `01-smoke`/`04-combat` visual
  scenarios (they encoded the old instant-fill).

## 2026-07-05

- **[2026-07-05-2126-player-speed-cap-engine-buff] Combat pacing + engine buff.** The player now has a
  flat top speed of **30 u/s** (`PLAYER_MAX_SPEED`, clamped in `sim.js`; enemies keep their per-engine
  `maxSpeed`). All engine `power` (acceleration) is **+50%**: Basic 10→15, Scout 12.6→19, Boss 19→29,
  Solid-fuel 14→21, Ion 18→27, Pirate 12.6→19, Second-boss 30→45 (thrusters/`maxSpeed` untouched).
  Enemies **hold fire for the first 5 s** of each run (silent `G.combatElapsed` grace — they still spawn,
  move and aim). Each run now **opens gliding forward at 3 u/s** (10% of top speed) instead of dead-stopped.
- **Ship-speed readout in the `?dev` perf overlay.** The perf line now appends `spd {current} pk {peak}`
  (world units/sec) — the live player velocity magnitude plus a per-run peak-hold (resets on each new
  player-ship build). Instrumentation only (no gameplay change), added to measure the actual speed range
  before introducing a max-speed cap; the player currently has no speed limit (`sim.js` "pure inertia").
  `client/src/hud.js` `updatePerf`. Visible only under the sticky `?dev` flag.
- **Pirate rocket slower + weaker.** The enemy **Rocket pirate** (weapon id 4) had its launch speed cut
  `12 → 6` and damage `25 → 20`, so pirate rockets are easier to read/dodge and hit softer. Other stats
  (accel 9, turnRate 1.0, maxRange 120, health 20) unchanged. Seeded via the idempotent catalog upsert on
  server startup (`server/src/catalog_seed.js`, weapons keyed by id) — no migration; live on vega.
- **Base station moved farther off the arena center.** The return-to-base station set-piece was pushed
  from `(-20,-42,-20)` to `(-60,-42,-60)` (screen top-left, same diagonal) in `catalog_seed.js` MAPS
  `home-system`, so the ship — which spawns and fights near the origin — is no longer framed against the
  big station and lost on its backdrop. Below-plane `y` is unchanged (`-42`). The dock/win test measures
  distance to the station's live position, so return-to-base still completes correctly; the homing arrow
  and mandatory-dock flow are unaffected. Takes effect on server restart (MAPS upsert `ON CONFLICT DO
  UPDATE`).
- **[2026-07-05-2101-welcome-pin-takeoff] Welcome screen: dropped the L1 ship picker, pinned Take off
  structurally.** The Level-1 welcome is now a fixed grid (scrollable greeting/intro over a pinned footer)
  so the Take off button is on-screen regardless of content height — replacing a centered-flex column whose
  `justify-content:center` + overflow clipped the unreachable *top* of the intro on short/wide viewports.
  The decorative single-ship picker (`.pick` + `#ship-choices` cards) was removed (L1 owns exactly one
  ship). Staged L1 reveal simplified to intro-types → Take off. Scenario 18 gains a 900×360 structural-pin
  regression guard (scroll region overflows + footer flush to the bottom).
- **[2026-07-05-1844-touch-hud-log-item-colors] HUD overhaul + item rarity/color + fading event log.**
  Reworked several in-combat HUD surfaces and added an item rarity data model. **HUD:** the credits
  readout is now a single line `credits {total}/{earned} earned` (total owned / earned this run) and the
  live **Enemies** counter was removed. **Event log:** a new stack of up to **4** lines above the rocket
  button (`#event-log`, `client/src/eventlog.js`), each fading out over 5 s — a kill logs
  `{shipname} killed +{amount}`, a grab pickup logs `picked up {name}` tinted by the item's color (fires
  for every collected drop, reward drops included). **Touch:** the zoom `+`/`−` buttons moved from the
  right edge to the **bottom-center**, laid out horizontally as `−  +` (desktop unchanged). **Data model:**
  new `rarity` (`trash`/`common`/`rare`) + `color` (hex) columns on **both** `components` and `weapons`
  (SQLite migration `020_item_rarity_color.js` + Postgres bootstrap parity), seeded via a derived rule in
  `catalog_seed.js` (shop-available → common/green `#59e0a0`; enemy/price-0 → trash/white `#ffffff`; the
  single override Triple spiral rocket → rare/blue `#0000ff`) and exposed through the client CATALOG.
  **World loot:** dropped items now show a soft additive halo tinted by their rarity color (fresh
  per-drop material; off-screen edge pointers stay fixed green). Added a server test asserting rarity +
  color come through `/api/components` + `/api/weapons`, and a visual scenario
  (`19-hud-log.mjs`) covering the removed counter, the credits line, the kill/pickup event lines with the
  pickup tint, the world-drop halo color, and the bottom-center touch zoom. EN+RU strings for the credits
  line + both log templates (the enemy ship / item names still render via the English DB name — a surface
  for a later i18n pass). Shop UI does not surface rarity/color yet (data only). No model/asset changes.
- **[2026-07-05-1641-briefing-staged-reveal] Staged briefing reveal (L1-3).** On the first three campaign
  levels the landing briefing now appears **in sequence** instead of all at once. **L1** (the welcome / ship-
  picker screen): the greeting shows immediately, the `.intro` briefing **types out over ~5 s**, then the
  **ship picker** fades in, then the **Take off** button **+0.5 s** later. **L2/L3** (the Main Window
  campaign briefing): the briefing text types out over ~5 s, then the right-column **ship-preview window** +
  the **granted-item showcase** (Machine Gun on L2 / Repair drone on L3) fade in together, then **Take off
  +0.5 s** later. **Tap the briefing text to skip** the typewriter and reveal everything at once. Plays
  **once per landing** (a language switch / bay switch / launch settles to the full state, no replay);
  hidden steps use `visibility:hidden` so nothing reflows. The L1 welcome `.intro` was **enlarged to 26px**
  (16px on mobile) to match the mission-briefing size. A shared `client/src/typewriter.js` drives both
  screens. **L4+ and side missions are unchanged (instant).** Client-only; no server/catalog/i18n/asset
  changes. Visual coverage: new `18-briefing-staged-reveal.mjs` (both screens + the L4 instant negative);
  the existing `97-briefing-showcase.mjs` now skips the L2/L3 typewriter before asserting the showcase.

- **Milestone banners ("10 enemies left" / "Final Stage").** A big, semi-transparent line now flashes
  in the upper third of the screen at key moments and fades to invisible over 3 s: when the level's
  remaining-enemy count drops to **10** and to **5** (keyed off `enemyTotal − kills`, once each), and
  when the **final combat phase** begins (the boss/finale — the phase right before the `event: 'win'`
  phase) showing **Final Stage**. New `#banner` DOM node + CSS, `G.banner {text,life,maxLife}`,
  `showBanner`/`updateBanner` in `client/src/sim.js` (fades in `update(dt)` like the credit popups,
  drawn each frame from `main.js`), and EN/RU strings `ui.banner.enemies_left` / `ui.banner.final_stage`.
  Fires once per run (reset in `levelRunner.start`); hidden on menus/overlays.

- **[2026-07-05-1340-credits-screen] In-game Credits screen (CC-BY compliance).** Added a player-facing
  **Credits & attributions** panel, opened from the Settings gear (`#credits-open` → scrollable
  `#credits-overlay`, `client/src/credits.js`): 3D models get the full CC-BY 4.0 credit (work title,
  `by <author>`, Source link, CC BY 4.0 license link, "Modified" chip + a blanket "all models are modified"
  note); music/sound get a CC0/Pixabay courtesy list. Content is **generated at build time** from
  `client/assets/CREDITS.md` (single source of truth) via new **`npm run credits:build`**
  (`scripts/credits-build.mjs`) → committed `client/src/credits-data.js`; a drift unit test
  (`client/src/credits-data.test.js`, mirroring `assets:check`) fails CI if the module is stale, and
  `build:itch` regenerates it into the staged export. Chrome labels are i18n (`ui.credits.*`, EN+RU);
  attribution content stays literal. Satisfies the CC-BY 4.0 obligation to show attributions to players on
  **both** vega.tenony.com and itch.io. See DECISIONS §48.
- **[2026-07-05-1244-l1-machine-gun-drop] L1/L2 reward drops on the battlefield.** The **last enemy of
  Level 1** now drops the **Machine Gun** model (and the last enemy of **Level 2** the **Repair drone**) as a
  **green-glowing, green-haloed** battlefield drop with a **pulsing green off-screen arrow** — shown only when
  the reward isn't already owned. The drop is **cosmetic**: grabbing it deposits **nothing** to the stash
  (`collect()` gates the `pendingLoot` push on the pure `shouldDeposit` = `!d.special`), so the single
  guaranteed copy still comes solely from the **unchanged, idempotent** server force-install on victory
  (clearing L1 runs L2's briefing `replaceWeapon 1→5`, clearing L2 runs L3's `installComponent repair 12`) —
  a player **never ends up with two** Machine Guns / repair drones, whether they grab the drop or fly past it.
  Marked declaratively by a new `lastKillDrop {kind,refId}` field on the L1/L2 descriptors (`catalog_seed.js`,
  re-seeded via the normal upsert — no migration); spawned by `spawnSpecialDrop` when `G.kills === G.enemyTotal`
  and `!ownsReward(...)`, rendered green (emissive tint + one additive halo sprite, no bloom) with the pulsing
  `.drop-marker.special` pointer. The **L2/L3 briefings were reworded** from "command installed it" to a
  "you recovered it" framing (EN source + RU), while **keeping** their grant actions and the spinning
  item showcase. No new assets/hash/CREDITS/itch changes (reuses the existing `modelUrlHigh` hangar glbs).
  See DECISIONS §49.
  - **Follow-up:** the Machine-Gun reward drop model is scaled **1.5×** (it read thin at the shared 2.5
    longest-axis) — `normalizeGreen(obj, targetLen)` in `drops.js` takes a per-reward target size; only
    weapon 5 is enlarged, the Repair-drone drop is unchanged.
  - **Follow-up (perf):** fixed a frame **hitch on the last-enemy kill** — the high-poly CloudFront hangar
    glb was fetched+parsed on the killing frame. Reward models are now **warmed at level start**
    (`preloadRewardModel` in `sim.js` `levelRunner.start`, gated on `!ownsReward`) into a normalized
    template cache keyed by url; `spawnSpecialDrop` clones instantly from the warm cache (falls back to the
    old lazy load + green box only if it isn't ready yet).
- **Tuned `model.lift` on every remaining ship for consistency (enemy_1/2/4).** The coverage report flagged
  the other enemy models as partly see-through from above too, so all 9 modeled ships now sit at their
  robust max bullet-plane coverage: enemy_1 (`Basic pirate ship`/`pirate gunner`) `lift: 0.21` (30→40 of
  48), enemy_2 (`basic`/`advanced rocket pirate`) `0.17` (28→36), enemy_4 (`first`/`second pirate boss`)
  **`-0.132`** (32→37 — the boss hull sat *above* the plane, so it's *lowered*, not raised). Also hardened
  `bestLift`: it now scans a fine grid and returns the **centre of the peak plateau** (robust — the plane
  passes *through* the seated boxes) instead of the plane-crossing extremum, which could land on a box edge
  (a tangent, razor-line "hit"). Tests updated to the plateau-centre semantics.
- **Model `lift` — top-down aim fix for hulls that sit off the bullet plane.** The game is top-down and
  bullets fly in the world y≈0.6 plane (the ship group's origin). A model whose bounding-box centre sits
  above its hull left the nose/deck below that plane, so centre-aimed shots visibly passed *over* the ship —
  reported on **enemy_3** (mini-boss + orange `advanced medium pirate`): shots flew over the drooped nose.
  Added a per-model **`model.lift`** (signed group-local Y, pre-scale) resolved in `shipModelCfg`: it offsets
  `pivot.position.y` (visual) **and** every hitbox `c.y`, and grows `broadR` by `|lift|`, so the visual model
  and its collision boxes stay in lockstep while the hull seats onto the bullet plane (positive raises,
  negative lowers). Applied `lift: 0.2` to both enemy_3 configs and `lift: 0.18` to the player ship. Verified
  offline (nose OBBs now span the y=0.6 plane; boxes intersecting the plane rose enemy_3 23→35 / player
  29→47 of 48) and in-game (model + `?hitboxes` overlay render in lockstep). Default `lift: 0` leaves every
  other ship unchanged.
- **Formalized the combat plane as an invariant (`BULLET_PLANE_Y`).** The "move the model, never the
  bullets" rule needs exactly one bullet plane, so `client/src/state.js` now exports `BULLET_PLANE_Y = 0.6`
  as the single source of truth. Replaced the scattered bare `0.6` ship-plane literals — group spawn Y
  (`ship-factory`), enemy spawn Y (`ship-build`), player warp/recenter Y (`sim` ×2), and the flat hit-ring
  FX Y (`projectiles` ×2) — with references to it. (Kept the plane at 0.6, not literal world 0: it's already
  model-independent, and re-zeroing would be cosmetic churn across exhaust/HP-bar/ring code for no gameplay
  gain — see DECISIONS §47.)
- **`assets:hitboxes` now reports bullet-plane coverage + a suggested `model.lift` per ship.** So a
  freshly-fit model isn't shipped accidentally see-through from above, the generator prints, per ship, how
  many hitboxes the bullet plane crosses at the current lift (`· plane y=0 N/total (lift L)`) and warns
  `⚠ up to M at lift≈L` when a signed lift would seat ≥2 more boxes on the plane. Coverage is computed as
  `|c.y + lift| ≤ Σ|uᵢ.y|·hᵢ` — exact and invariant to heading and scale. It's a warning, not a build
  failure (over-lifting floats the model, so the maintainer decides). The report currently flags
  **enemy_1/2/4** as under-covered (enemy_4 wants a slight *negative* lift); those aren't tuned yet. New
  `planeCoverage`/`bestLift` helpers + unit tests in `scripts/assets-hitboxes.mjs`.
- **Asset cleanup — removed stale/unused pipeline builds from S3, local, and git.** Diffed every asset
  store against the authoritative keep-set (the 29 combat/hangar/sfx URLs referenced by
  `server/src/catalog_seed.js` + `client/src/drops-config.js`; `assets:check` stays green). Deleted **28
  unused S3 objects**: `ships-combat/` 16 (superseded content-hashes of live models + the never-referenced
  combat builds of the menu-only `machine_gun`/`repair_drone` items) and `ships-hangar/` 12 (stale hashes +
  hangar builds nothing references — `base_station`/`freighter` set-pieces, `metal_box` drop, and the
  non-orange `enemy_2/3/4` hangars the menu doesn't use). Deleted the matching **19 stale local pulled
  files** (`client/assets/ships/` 16 hashed combat glbs + `client/assets/sounds/` 3: `kinetic` ×2,
  `rocket` ×1). `git rm`'d **16 unreferenced legacy binaries** from `client/assets/` (`Spaceship{,_1,_2,_3}`,
  `boss/fighter/heavy/player/rocketeer.glb`, pre-pipeline non-hashed `enemy_1–4.glb`,
  `projectiles/Missile.glb`, `weapons/{Rocket Launcher,Missile Turret}.glb`) — none referenced by code; the
  runtime pre-load fallback is a **procedural** placeholder ship (`client/src/ship-factory.js`), never a
  glb file. **Kept** the S3 `source/` prefix (24 high-poly originals + raw sound sources — the backups that
  let the pipeline deterministically re-build any model) and every in-use combat/hangar/sfx asset +
  `ui/dock-cursor.png`. Corrected stale SUMMARY/CREDITS wording that named `player.glb` as the fallback.
  Prod gets the clean image on the next deploy (CI `assets:pull` has no `--delete`, so the running
  container still carries the old combat glbs until rebuilt).

## 2026-07-04

- **[2026-07-04-0949-perf-benchmark-replay] Deterministic replay benchmark + pre-commit perf-regression
  gate.** A standalone A/B tool that catches when a code change makes the **per-frame CPU cost** worse by
  **>2%** before it lands. It replays a fixed input **trace** identically on two builds — the **merge-base**
  (`A`) and the **worktree** (`B`) — on the same headless Chromium in the same job, and compares the JS-work
  buckets (`js.update`/`js.dom`/`js.render`/`js.total`, the CPU half of the shipped `?dev` `devPerf` monitor).
  New `client/src/bench.js`: the sticky **`?bench`** flag (`benchMode`/`isBench`, mirrors `?dev`) + a seeded
  PRNG (`installSeededRandom`/`mulberry32`) + `BENCH_DT` (fixed 1/60 step) — the three nondeterminism sources
  (RNG, `dt`, input) pinned so the client sim replays bit-for-bit. **`?bench=record`** captures the per-tick
  resolved input; `window.__bench.stop()` downloads a trace JSON. **`?bench=replay`** →
  `window.__bench.replay(trace,{mode})` re-seeds, `reset()`s to a clean fight, **sets `G.gameStarted=true`**
  (the headless page never runs the launch flows, so without it `update()` early-returns and the bench
  measures nothing), and drives the trace through the exact per-frame work `animate()` does, timed into the
  same buckets. Canonical trace `client/bench/traces/combat-heavy.json` (produced deterministically by
  `node bench/gen-trace.mjs`, **load-pinned** to 6 enemies so a gameplay-touching diff still gets a clean
  A/B). Runner **`node client/bench/run.mjs`** (`npm run bench`) starts an isolated server + one Chromium,
  interleaves reps `A,B,…` (default 15, 4× CDP CPU throttle), and via the pure, unit-tested
  `client/bench/stats.mjs` reports a per-bucket **median + bootstrap-95%-CI** table, flagging **REGRESSION**
  only when the CI lower bound of `(B/A−1)` exceeds +2% (keys on `js.total` full / `js.update` sim, plus
  structural `load.draws/tris/particles` growth as a GPU-cost proxy). If either build lacks `window.__bench`
  it prints `gate inactive` and exits 0 (so this very PR, whose merge-base predates the harness, passes). New
  tests: `client/src/bench.test.js` (flag + PRNG) and `client/bench/stats.test.js` (verdict thresholds), both
  under `node --test`. **Scope: CPU-only** — GPU/fill-rate isn't measured (browsers don't expose it on
  mobile); real-device `?dev` telemetry stays the source of truth for the GPU/thermal half. Wired as a
  **documented (not CI-enforced)** PERF A/B stage in the feature pipeline (`docs/plans/multi-agent-pipeline.md`
  + the skill prompt). See DECISIONS §58 + `client/bench/README.md`.
- **[2026-07-04-1740-triple-spiral-rocket] Shop damage reads 40×3 for the triple spiral rocket.**
  Live-test follow-up: the shop/loadout stat line showed the triple spiral rocket's damage as a single
  warhead's `40`, misrepresenting a 3-warhead weapon. `statLine` (`client/src/shop.js`) now renders
  `40×3` for `stats.spiral` weapons (per-warhead × warhead count) so the true on-hit damage is shown.
- **[2026-07-04-1740-triple-spiral-rocket] Triple spiral rocket + fading-line rocket trail.** New
  4000-credit shop rocket (weapon id 11, `stats.spiral:true`, top of the rocket ladder): firing it spawns
  an **invisible leading homing rocket** (steers via `findTargetInSector`, deals no damage, not shootable)
  that defines the flight path, plus **three visible cyan warheads** that spiral around its axis (radius
  1.4u, 6 rad/s, 120° apart). Each warhead is a **real** rocket — its own power 40 / health 10, independent
  proximity detonation, and individually shot down by gunfire (all three connecting = 3× = 120 damage); the
  leader self-removes once its last warhead is gone or it hits maxRange. Separately, the **standard** rocket
  smoke trail (all rockets, player + enemy) changed from an expanding sphere cone into a **thin dissipating
  haze line** — small fixed-size puffs that only fade — and `spawnSmoke` now honors the particle ceiling
  (`liveParticles()` counts smoke), so dense trails stay within budget on weak tiers (a burst mid-heavy-smoke
  loses a few sparks on capped low tiers — intentional). New pure `spiralOffset` helper in `steering.js`
  (unit-tested); new visual scenario `17-triple-spiral-rocket` asserts the 1-leader-+-3-warhead spawn and
  that the whole volley drains with no leaked entries. Files: `server/src/catalog_seed.js` (row 11),
  `client/src/projectiles.js` (spiral spawn + slim warhead geo + fading `spawnSmoke`), `client/src/sim.js`
  (leader/warhead/normal rocket cases + fixed-size smoke fade + reset guard), `client/src/steering.js`,
  `client/src/main.js` (`spawnRocket` on the `?debug` hook). No new .glb / CREDITS.md change (procedural
  warhead). `detonateRadius` 0.5 to match the hull-relative detonation regime. Server weapon-count assertion
  10 → 11.
- **[2026-07-04-1253-multi-sphere-hitbox] Ship hitboxes: convex-decomposition OBBs (replaces multi-sphere).**
  Supersedes the same-branch multi-sphere iteration below (never shipped to prod). `npm run assets:hitboxes`
  decomposes each combat glb into near-convex parts with V-HACD (`vhacd-js`, build-time-only, memory-safe
  `voxelResolution 400000` (bounded voxel count, library default) / `maxHulls 48` / `maxVerticesPerHull 32`)
  and fits one tight PCA **oriented bounding box** per part into `model.hitBoxes`/`model.broadR`
  (`{c,h,u0,u1,u2}` per box, group-local noseZ frame), written into `server/src/catalog_seed.js` via a
  marker-delimited idempotent edit that also migrates off the old `hitSpheres` span (round-trip verified).
  Runtime narrow-phase (`client/src/collision.js`) is now **point-vs-OBB** — each box center transformed by
  `mesh.matrixWorld`, axes rotated by its upper-3×3 and renormalized, hit iff `|dot(p−c, uᵢ)| ≤ hᵢ·scale +
  pad` on all three axes (behind the unchanged broad sphere). The fit is **tight** (`HITBOX_MARGIN` 0.05, no
  1.1 bubble), so a bullet through the empty gap **beyond a thin wing** misses while shots that touch a
  wingtip connect — the case inscribed spheres couldn't cover. **Live-test fixes:** (1) shots passed straight
  through the player's wings — an offline surface-coverage diagnostic pinned it to a genuine **coverage hole**
  (not misplacement): at `maxHulls 16` V-HACD merged the outer wing into a body hull whose tight OBB stopped
  at x≈±1.5 while the wing reached ±1.7, so the player's +X wing was only ~16% covered. Fixed by raising the
  decomposition budget to **`maxHulls 48` + `minVolumePercentError 0.5`** (the wing panels/tips now get their
  own hulls → 100% surface coverage on every ship; box count ~48). Also raised voxelResolution 100k → 400k
  (bounded; catches thin geometry) and floored every box's per-axis half-extent at `MIN_HALF` 0.1. (2) A
  fast bullet (~1-3 world units/frame) can still step clean over a thin box between frames, so bullet↔ship is
  now a **swept segment-vs-OBB test** `segmentHitsShip(ship, p0, p1)` (the bullet's per-frame movement
  segment vs each box's local-frame slab, behind a segment-sphere broad phase); `sim.js` sweeps bullet↔enemy
  and bullet↔player. (3) Rockets detonated "at a distance" — the `detonateRadius` proximity pad dropped from
  ~1.0/1.2 to **0.5** (near contact, floored at ~one frame of rocket travel). Rockets keep the point test
  (slow + homing + padded, no tunneling); the rocket hull-relative blast damage carries over unchanged. Guard
  added: a `node --test` surface-coverage check (decode the glb, assert ≥97% of surface inside the boxes) —
  the gate the size/span sanity couldn't provide. Dev-only `?hitboxes` draws wireframe boxes over every ship.
  **Known limitation (accepted, deferred → ROADMAP):** bullets fly in the y=0 combat plane but the boxes hug
  the model's real 3D geometry, so elements off y=0 aren't hit by centre-aimed shots — the **player's wings**
  (~0.27 below centre) read as "transparent", and the **advanced-medium-pirate**'s drooped nose registers deep.
  Diagnosed via offline renders (surface coverage is fine; the boxes correctly wrap geometry that simply sits
  off the aim plane). Accepted for now and documented in SUMMARY as a model-choice factor; the fitter fix
  (extend each box's Y to cross y=0) is scheduled in ROADMAP. No combat-glb hash change → no itch republish
  (collision data only).
- **[2026-07-04-1253-multi-sphere-hitbox] Multi-sphere ship hitboxes.** _(Superseded by the OBB entry above.)_
  Ships no longer collide as one fat
  sphere. A new `npm run assets:hitspheres` step auto-fits ~4-8 spheres to each combat hull — spheres
  chained along the hull's **longest horizontal axis** (so a wide-winged ship like the player is fit across
  its wingspan, not its length), each radius hugging the perpendicular cross-section and **capped** so it
  can't balloon past the hull, + up to 2 thin wing spheres, `HITSPHERE_PAD` 1.1 — and writes
  `model.hitSpheres`/`model.broadR` into `server/src/catalog_seed.js` via a marker-delimited idempotent edit
  (round-trip verified). Collision (`client/src/collision.js`) is now broad-phase (one `broadR × mesh.scale.x`
  sphere) → narrow-phase (per-sphere, transformed by `mesh.matrixWorld`, ignoring the cosmetic bank roll).
  All four bullet/rocket↔ship sites use it — including the **player**, fixing the old hardcoded `2.6` broad
  radius and the player↔rocket test that ignored ship size (rocket `detonateR` is now the hit pad). Rocket
  **blast (AoE) damage is hull-relative too** (`detonateRocket` uses `pointHitsShip(…, blastR)`) — fixing a
  bug where rockets exploded visually but dealt **zero damage** (the old center-distance check missed because
  the detonation point sits off-center on a hull sphere), for both player and enemy rockets. Effect: hits
  register on the real hull — grazing shots past a thin fuselage miss, nose/engine shots connect, and rockets
  hurt again. Primitive/un-modeled ships keep the legacy single `2.6 × sizeScale` sphere; `e.radius` stays as
  the health-bar anchor only. Dev-only `?hitspheres` draws the wireframe hitbox over every ship.
- **[2026-07-04-1223-enemy-hp-bar-above-model] Enemy HP bar clears the model.** The over-enemy health bar
  now pins its bottom edge above the ship (CSS `translate(-50%, calc(-100% - 4px))` + a size-proportional
  world anchor `e.radius * 1.15 + 1.5`) instead of centering on the anchor, so it no longer merges with /
  dips into the hull (`hud.js` `updateEnemyHealthBars`, `styles.css` `.enemy-hp`).
  - **Follow-up (live-test fix):** the first pass raised the anchor along **world +Y**, but the camera is
    near-top-down (`CAM_OFFSET 0,110,26`) so world-up points almost *at* the camera — the bar barely moved
    up the screen and still overlapped the model. Now the anchor is offset along the **camera's screen-up
    axis** (`camera` local +Y in world) by `~e.radius*1.6 + 2`, so the bar sits straight above the model on
    the 2D screen at any camera angle/zoom (still depth-correct). Exposed `__game.camera` and added a
    position assertion in `visual/scenarios/16-enemy-health-bar.mjs` (bar top must be above the enemy's
    projected center) so this can't silently regress.
- **[2026-07-04-1148-weapon-hit-fx] Weapon hit/explosion FX pass.** Bullet hit-flash is now keyed off the
  weapon `class` (kinetic → tiny spark `maxScale 0.8`, cannon → small flash `maxScale 2`) instead of every
  bullet using the same `maxScale 3` micro-flash; `class` is threaded onto the bullet in `spawnBullet` and
  added to the enemy bullet weapons (id 2/9 kinetic, id 10 cannon) in `catalog_seed.js`. Rocket detonation
  now uses a new small/fast layered `spawnRocketBurst` (fireball layers + a few sparks + shockwave ring,
  ~0.4–0.9 s), sized off `blastVisual`, replacing the single-sphere blast — same particle-budget/tier gating
  as the ship burst; ship-death explosion unchanged.
  - **Follow-up (live-test tuning):** the rocket-detonation FX are now **fully data-driven from the weapon
    stats** — `spawnRocketBurst` reads `blastVisual` (size), new `blastTimeScale` (lifetime multiplier) and
    new `blastTint` (color) off the rocket, threaded via `spawnRocket`. All rocket weapons (id 3/4/8) set
    `blastTimeScale: 0.8`, making the burst **20% quicker** (rounded); tint unchanged (`0xffb050`).
- **Nebula clump size is now tunable (`sky.nebula.scale`).** Added a `scale` knob (noise frequency) to the
  procedural nebula: higher = smaller/finer clumps. Replaces the previously hardcoded `2.2` in the shader
  with a `uScale` uniform, threaded from the descriptor (fallback `2.2`). `home-system` ships **`scale: 3.6`**
  so the dense lobes read as finer wisps with more black space between them (calmer behind combat) rather
  than one large smooth cloud.
- **[2026-07-04-1008-fullscreen-btn-on-pause] Full-screen button available mid-battle on mobile.** The
  floating `⛶` button now shows during active combat and pause (not just menus) — placed left of the rocket
  and raised above the phone's bottom chrome — so after backgrounding/restoring the browser (which drops
  fullscreen) the player can re-enter without leaving the fight. Fixed a stale-`body.fs` bug where the button
  stayed hidden after restore because `fullscreenchange` isn't delivered to a backgrounded tab: `body.fs` now
  re-syncs on `visibilitychange`/`pageshow`/`focus`. On iPhone (no Fullscreen API) the Add-to-Home-Screen hint
  pill now also shows in-game. See DECISIONS §44.
- **[2026-07-04-0933-procedural-nebula-sky] Procedural nebula skybox (baked cubemap).** Replaced the flat
  slate-blue `skyScene.background` with a procedurally generated ice-blue nebula + star field (GLSL fbm),
  baked **once** into a `WebGLCubeRenderTarget` at `buildMap` time → per-frame cost unchanged (flat
  background draw). Palette is data-driven in the `home-system` descriptor (`sky.nebula`). Tier-gated (High
  1024/6-octave, Balance 512/4-octave, **Performance keeps the flat color**), skipped under `?debug` (visual
  suite unchanged). Parallax `makeStars` thinned to 0.4× when the nebula is baked. Fully procedural — no
  third-party asset, no `CREDITS.md` change.
- **feature-pipeline: live-test before agent feedback.** Reordered the `/feature-pipeline` stages so the
  result is **exercised live** (running app / real device) *after* deploy/build and *before* per-agent
  feedback is collected — passing the automated suites doesn't prove a feature works for a human, especially
  touch/feel/visual changes. Stage 7 now asks the deploy question only; new Stage 9 is a live test against a
  concrete acceptance checklist; Stage 10 collects satisfaction + self-improve, informed by the live result.
  Also documented stashing unrelated uncommitted main-checkout work around the deploy merge. (`.claude/skills/feature-pipeline/SKILL.md`, `docs/plans/multi-agent-pipeline.md`.)
- **[2026-07-04-0121-touch-tap-vs-drag] Touch tap-vs-drag.** On touch, on-screen objects — **loot chests**
  and (during return-to-base) the **base station** — are now tappable **anywhere** on screen. The old
  `#stick-zone` (`left:0; width:58%`) claimed the whole left region for steering and **swallowed taps** there,
  so chests/the station were untappable across most of the screen. Now `#stick-zone` covers the full play area
  (`inset:0`) and a single-finger gesture is disambiguated by **movement slop**: within **`TAP_SLOP = 10px`**
  (measured in the rotated game space) it's an **object tap** that runs the **same raycast as the desktop click**
  (factored into a shared `engageObjectAt` — nearest live chest wins over the station), beyond 10px it becomes
  the floating **steering stick**. Steering + object taps both work anywhere; the stick still shows on
  touchstart but a tap never engages steering. A **2nd finger on the play area = pinch** (moved off
  `renderer.domElement` onto `#stick-zone`), still counting **`e.targetTouches`** so a finger held on **FIRE**/🚀
  isn't counted — **holding FIRE while steering is unaffected**. The **rocket + zoom buttons** are layered
  **above** the now full-screen stick zone (`#rocket-btn`/`#zoom` → `z-index:6`). New pure module
  `client/src/tap-gesture.js` (`exceedsSlop`, `TAP_SLOP`) + its `node --test` unit test.
- **[2026-07-04-0121-touch-tap-vs-drag] Fixed: zoom `+`/`−` unusable during flight on touch.** Reproduced on a
  touch harness (Playwright + CDP multitouch): during flight the player steers with one finger, and tapping
  `+`/`−` with a second thumb **did nothing**. **Root cause:** the buttons fired on a synthesized **`click`**,
  and the browser **only synthesizes a click for a single-touch tap** — it suppresses it while a second touch
  point (the steering finger) is active. **Fix:** the zoom buttons now fire on **`touchstart`** (mirroring
  FIRE/🚀, which always worked during flight); the `click` path is kept **mouse-only** so a lone touch tap
  doesn't double-zoom. Verified empirically that the zoom visibly changes when tapped mid-flight on touch. The
  `z-index:6` keep is a necessary companion (so the full-screen zone doesn't cover the buttons) but was **not**
  the actual cause. See DECISIONS §42 + the §20 amendment.

## 2026-07-03

- **Enemy health bars.** Each enemy now shows a small translucent-red health bar floating just above it —
  but **only once it drops below full HP** (an undamaged enemy shows nothing, so the arena stays clean until
  the fight starts). The bar is a pooled DOM overlay in `#markers`, projected from the enemy's world position
  each frame (`updateEnemyHealthBars` in `client/src/hud.js`, wired into the frame loop in `client/src/main.js`),
  with its fill width tracking `hp / maxHp`. Enemies gained a `maxHp` reference at spawn
  (`client/src/ship-build.js`); styling in `client/styles.css` (`.enemy-hp` + fill). New visual scenario
  `client/visual/scenarios/16-enemy-health-bar.mjs` (no bar at full HP → 40% bar after damage).
- **Base station moved off the arena center.** Repositioned the return-to-base station from the world origin
  `(0,-42,0)` to `(-20,-42,-20)` — 20 units toward screen-top (−z) and 20 toward screen-left (−x) — for
  composition (`server/src/catalog_seed.js` MAPS set-piece `pos`). Safe with no logic change: the dock/win
  measures distance to `G.baseStation.obj.position` (live), not a hard-coded `(0,0)`, and the homing arrow
  already tracks the object. `pos.y` unchanged so the §17 below-plane guarantee holds. Server catalog change →
  reaches the client (and itch, which reads the catalog live) on deploy; no new asset.
- **Silver loot chests + base-Grab backfill + enemy-weapon balance.** Follow-ups after the interactive-chest
  ship: (1) **Chests are now brushed silver** instead of near-chrome — the pure mirror went black against dark
  space, so the drop material got a light silver albedo (`0xd2d6de`), lower metalness (0.55), and a faint
  emissive floor so a crate is never fully black even where the scene is unlit (`client/src/drops.js`). (2)
  **Every existing player is granted the base Grab (component 29).** New players already get it from the ship
  default; players created before the Grab feature whose ship has an explicit `components` override predating
  Grab are backfilled — SQLite migration `019_backfill_grab.js` + an idempotent `UPDATE` in the Postgres
  `migrate()` (both skip rows that already have a grab; NULL-components players inherit the default). (3)
  **Enemy weapons renamed** `Kinetic (enemy)`→`Kinetic pirate`, `Rocket (enemy)`→`Rocket pirate`, and rocket
  **volley stagger widened** (mini-boss/rocketeer/advanced 0.2→0.3 s; second-boss 0.15/0.3→0.3/0.6 s).
- **Chests are interactive.** [2026-07-03-1703-chest-click-and-markers] Loot drops are now discoverable and
  one-click reachable. **Click/tap a chest → autopilot flies the ship over to it** (works in **combat AND
  return-to-base**; the passive Grab then collects it, after which the autopilot stops — no auto-chaining).
  On desktop, hovering a chest shows a **`cursor: grab` hand** (wins over the station dock cursor on overlap);
  a chest click also wins over the station click. Drops now **glint** — their material is set near-chrome
  (`metalness 1.0`, `roughness 0.25`) so they catch the env-map + sun. **Off-screen chests show green
  `0x59e0a0` edge arrows** (nearest 6), a distinct pool from the enemy markers. Under the hood the autopilot
  was generalized to a typed **`target`** (station **or** a specific drop); the dock/win now fires **only when
  the target is the station** — extracted into a pure, unit-tested `client/src/autopilot-config.js`
  (`canDock` + `BASE_ARRIVE_RADIUS`) so a chest-aimed autopilot can never win the mission. Client-only; no
  new asset.
- **Grab component + enemy equipment drops.** [2026-07-03-1412-grab-tractor-drops] Added a new optional
  ship component type — the **Grab** (tractor beam) — and a light loot loop on top of the kill→credits
  economy. On each enemy kill there's a **20 % chance** to drop **one** piece of the enemy's gear (a
  non-hull component or a mounted weapon — **hulls never drop**, to protect progression) as a slowly-
  rotating **metal-box** in the arena. A drop within the Grab's **range = strength** (world units) is
  pulled toward the ship at **speed = (strength/2)·(10/itemWeight)** (a thin blue line shows the active
  pull; the grab arms after 0.3 s in range and pulls the nearest one at a time). Collected drops deposit
  into the **Stash on mission victory only** (lost on death / restart). Two Grab items: the **base Grab**
  (id 29, range 10, weight 2, price 500) the player **owns from the start**, and the buyable **Advanced
  grab** (id 30, range 20, weight 3, price 2000) under a new **"Grab"** shop tab. `REFERENCE_MASS` bumped
  **48 → 50** so auto-equipping the base grab is **mass-neutral** (player accel 10 / turn 2.0 unchanged).
  **Pirate parts are now priced** (engines/thrusters/weapons + hulls) with `stats.buyable:false` — resale
  value only, still hidden from the shop. Server: a client-authoritative `POST /api/players/:id/loot`
  endpoint (`depositLoot`, kept in SQLite/Postgres parity) dumps the run's haul into the stash; `grab` is
  an optional, sellable component slot. Shipped the reused **metal-box** model through the asset pipeline
  (**703 KB → ~6 KB** combat glb; two 1024² PNG textures downscaled to 128px WebP + meshopt) + a CREDITS
  row ("Metal box" by District24, CC-BY 4.0). Added a `?dev` **drop-count** perf readout and a
  `?debug` `__game.spawnTestDrop()` stress hook.
- **Autopilot + return-to-base mission end.** [2026-07-03-1445-autopilot-return-to-base] Added a **base-station
  `.glb` set-piece** at the world origin `(0,0)` (CC-BY 4.0 "Low Poly space station." by MisterH — a below-plane,
  non-collidable decor like the freighter, but raised nearer the plane, top tuned to ~y=-2.9 so it never occludes
  ships per DECISIONS §17). **Every mission** — campaign L1–4 **and** the three side missions — now ends by flying
  **back to the station** instead of on the last kill: a single `levelRunner` intercept replaces `win()` with a
  return-to-base gate, so after the last enemy dies the OOB warp-back is **lifted**, a translucent **blue homing
  arrow** (anchored to the ship, pointing home) + a centered **"Sector cleared — return to base"** HUD hint
  (i18n `ui.return.hint`, EN+RU) appear, and the station becomes **clickable**. Clicking/tapping the station is a
  **mandatory dock**: it engages **autopilot** (brake → rotate to face → accelerate → kinematic symmetric-decel
  brake to a stop next to it), and the existing victory fires on arrival (`BASE_ARRIVE_RADIUS` 45u from `(0,0)`) —
  **proximity alone never wins**, and **any** control input (move/fire/rocket) cancels the dock (re-tap to resume).
  Enemies now spawn in a ring around the **mission-zone center (`arenaCenter`)**, not the hero. New
  `base_station_combat.529dee5e.glb` on S3; CREDITS.md row added; a prod **`/publish-itch`** is needed once this
  ships (model/hash change — DECISIONS §37). See DECISIONS §39 (+ the §2 amendment).
- **Dock cursor on the clickable station (desktop).** [2026-07-03-1445-autopilot-return-to-base] While the base
  station is clickable (return-to-base phase), hovering it on **mouse** now swaps the cursor to a first-party
  **"landing/dock" glyph** (`client/assets/ui/dock-cursor.png` — a plane descending onto a pad; a raster PNG,
  not SVG, since Safari has no SVG data-URI cursors; `pointer` fallback) as a "you can dock here" affordance. A
  throttled `pointermove` raycast (reusing the station click raycast) toggles a `dock-cursor` class on the WebGL
  canvas; gated to `!Device.hasTouch` and the same clickable gate as the click, and cleared when the phase ends.
  First-party art → no CREDITS.md change.
- **Kill credit popup: green + longer.** Recolored the `+xx` kill popup from gold to green (`#77ee77`) so
  it stays legible against the warm/gold ship-explosion burst it spawns on top of, and extended its life
  from ~1 s to ~2 s (`maxLife` 2.0), holding at full opacity then fading over the last ~1 s instead of
  fading the whole time. Cosmetic tweak only.
- **Kill credit popups.** [2026-07-03-0042-kill-credit-popup] Destroying an enemy now shows a short gold
  `+xx` popup floating up from the kill site (the credits earned), fading over ~1 s. It's a pooled DOM
  overlay in the `#markers` container, projected world→screen each frame like the enemy edge markers
  (`updateCreditPopups` in `hud.js`, `creditPopups` FX array spawned in `sim.js` on enemy death). Cosmetic
  only — no gameplay/economy/server change; skipped for reward-0 kills, hidden while a game-over/victory
  overlay is up, frozen in place during pause, and cleared on restart.

## 2026-07-02

- **Freighter set-piece is now a real `.glb` model.** [2026-07-02-1937-freighter-glb-model] Replaced the
  procedural box freighter (spine + bridge + window + cargo containers + engine block + 4 nozzles) with the
  CC-BY **"Freighter - Spaceship"** combat glb (`freighter_combat.ffdacc37.glb`, by Felipe Augusto Vera) —
  the project's **first `.glb`-backed set-piece**. A standalone loader in `makeFreighter` (`world.js`)
  reuses the shared `gltfLoader` from `ship-factory.js` (meshopt-wired) and auto center/scales/`yaw`-orients
  it like a ship model (`yaw: 0` — the model already faces +Z, bridge/engines aft). Kept the **fiery
  exhaust**, now a **single rear-center emitter** re-derived from the loaded model's real group-local rear
  bounds (built synchronously so a trail shows immediately; no procedural-box fallback — on load error the
  exhaust keeps running). Made the exhaust palette + particle params an **optional server-delivered
  `exhaust:` effect config** on the set-piece spec (`catalog_seed.js`), delivered via the map descriptor,
  with the current fiery look as defaults (the light seed for future server-driven model effects). User
  effect: a recognizable 3D cargo ship (not grey boxes) drifting below the battlefield with a live flame
  trail. **Field rename:** the freighter spec's old `exhaustCount`/`exhaustLen` fields (never set in the
  seed) are replaced by the nested `exhaust: { count, len, size, speed, palette }` shape — no data cleanup
  needed. Added the CC-BY row + verbatim attribution to `client/assets/CREDITS.md` (mandatory while in
  use). **Prod model/hash change → run `/publish-itch` once this lands on prod** (DECISIONS §37) so the
  itch bundle doesn't 404 the new freighter glb. See DECISIONS §38.
- **Institutionalized the "prod model change → re-publish itch" rule.** After the metallic-hull change
  broke the two changed ships to generic cones on itch (itch bundles glbs but reads the catalog live from
  prod), baked the guard into four places so it can't be forgotten: **DECISIONS §37** (the coupling +
  rejected alternatives), **`update-ship-model` skill** (new step 11 + checklist item), the
  **feature-planner** agent's Learned guidance (any model-change plan must include a `publish-itch` step),
  and the **ship-model-pipeline** brief (step 7).

- **Basic pirate hull now reflects the env-map (metallic).** The grey `black_mat_for_body_0` material —
  the whole hull/wings of the basic pirate — was flat matte (metalness 0.16, roughness 0) and read as dull
  light-grey plastic while the red/dark parts caught reflections. Bumped it to **metalness 0.8 / roughness
  0.22** in the source glbs (`assets-src/enemy_1.glb` + `enemy_1_orange.glb`), so the hull now picks up the
  RoomEnvironment reflections like the metallic parts (reads as darker gunmetal, red accents pop more).
  Rebuilt combat+hangar glbs, pushed to S3, superseded objects deleted, wired the new content-hashed URLs
  into `catalog_seed.js` (`Basic pirate ship` → `enemy_1_combat.527b5a89` / `enemy_1_hangar.aa6fed25`;
  `pirate gunner` → `enemy_1_orange_combat.f3b006ba` / `enemy_1_orange_hangar.5e6e1cc4`). Red materials and
  `enemy_2/3/4` untouched; same asset/license so `CREDITS.md` unchanged. **Also re-published the itch.io
  build** (`/publish-itch` → butler build #1766900): the itch ZIP bundles the combat glbs but reads the
  catalog live from prod, so the model-hash change made those two ships fall back to generic primitive
  cones on itch until the ZIP re-bundled the new glbs. (Rule: any prod model change now needs a
  publish-itch too.)

- **HUD Destroyed counter now killed/total.** The on-screen kill counter shows `killed/total` (e.g.
  `8/16`) instead of a bare count. *Total* is precomputed on the server from each descriptor's phase
  script via the new `enemyTotalFromPhases` (`server/src/enemy_total.js`) and stamped as
  `descriptor.enemyTotal` for campaign levels (`catalog_seed.js`) and side missions (`missions.js`); the
  client reads it in `levelRunner.start` and renders `${G.kills}/${G.enemyTotal}` in the HUD, falling back
  to the bare count when the total is unknown. Verified totals: L1 16, L2 17, L3 21, L4 22, side missions
  20. The **Enemies** (alive) counter is unchanged. Campaign levels need a server restart/deploy to reseed
  `levels.descriptor` with the field (production reseeds on deploy); side missions are generated live.

- **itch.io player tagging.** The itch.io build now bakes `BUILD_SOURCE='itch'` into
  `client/src/api-base.js` (default `'web'`), and `referrerPayload` adds `"source":"itch"` to the
  write-once `players.referrer` JSON for non-web builds — so itch.io players show up as
  `{"source":"itch"}` in `/admin` even though `document.referrer` is blank inside itch's sandboxed CDN
  iframe. Organic web players stay untagged. Takes effect once a fresh itch build is published.
- **Launch/distribution playbook (docs).** Added `docs/plans/launch-distribution.md` — the go-to-market
  brief for *where and how to post the itch.io prototype for feedback*: waves (RU Telegram chats +
  DTF first, then EN Reddit r/playmygame & Discord & itch community, Yandex Games later), per-platform
  etiquette/rules (incl. why r/indiegames is announce-only, not feedback), an itch-page readiness
  checklist, and options for automating update-posting/feedback digests. Distilled from an earlier
  chat session so it's no longer only in conversation. ROADMAP Phase 0 "Announce / share the link"
  now points at it. No code change.

- **Admin panel + referrer capture `[2026-07-02-1352-admin-panel-player-stats]`.** New private
  server-rendered **`GET /admin`** dashboard (`server/src/admin.js`) that lists every registered player
  (id, username, email, verified, created/last-seen, progress, credits, games) plus per-player aggregates
  from the `games` table (total time played, total kills, total earned) in one sortable HTML table
  (client-side click-to-sort per column; capped at 1000 rows). Protected by **HTTP Basic Auth**
  (`ADMIN_USER`/`ADMIN_PASSWORD` from the server `.env`, compared with `crypto.timingSafeEqual`); the route
  **404s when either env var is unset**, so it's never open on prod. Backed by a new `getAdminPlayers`
  datastore fn (both backends; Postgres coerces the BIGINT `SUM`s + `email_verified` INTEGER). Also added a
  new write-once **`players.referrer`** column (**migration 018** / Postgres bootstrap): the client sends a
  compact JSON of `document.referrer` + `?ref=`/UTM params once at boot (`net.js` `referrerPayload`/
  `registerBoot`, called in `bootstrap()`); the server persists it **only on player-row creation**
  (`registerPlayer(id, referrer)`, truncated to 512 chars), so it reflects where a player first came from
  and is never overwritten. No new runtime deps.
- **Perf/FPS overlay is now dev-only `[2026-07-02-0149-dev-diagnostics-flag]`.** The top-center perf/service
  string (FPS, frame-ms, draw calls, triangles, backbuffer resolution) was shown to every player during a
  fight; it's a diagnostic tool, so it's now **hidden for normal players** and shown only under the existing
  `?dev` flag. The flag is now **sticky** via `localStorage['devMode']`: truthy `?dev`/`?dev=true`/`?dev=1`
  turns it on and remembers it across loads; `?dev=false`/`?dev=0` clears it; no `dev` param → the stored
  flag decides. New shared `client/src/dev.js` / `isDev()` (self-applies a `body.devmode` class; `#perf` is
  `display:none` until `body.devmode:not(.menu)` reveals it) replaces two loose
  `location.search.includes('dev')` substring checks in `hud.js`/`main.js` (which also matched `?developer`
  etc.); the `?dev` perf telemetry (`devPerf`) rides the same helper. Gameplay HUD, mini-map, edge markers
  and rocket cooldown are unchanged for everyone. `?tune`/`?debug` stay independent.

## 2026-07-01

- **`/publish-itch` skill.** Added a `publish-itch` skill (`.claude/skills/publish-itch/SKILL.md`) that
  ships an update to itch.io via **butler** (itch's official upload CLI): `assets:pull` → `npm run
  build:itch` → `butler push dist/itch-staging USER/GAME:html5` (incremental — only changed files upload).
  Recommends butler over any web-form automation; documents the one-time `brew install butler` +
  `butler login`, the `html5` channel + "play in browser" first-push step, and the `ITCH_TARGET`/`.itch-target`
  resolution. Complements the build-itch skill.
- **Guest callsign now shown `[2026-07-01-2006-guest-callsign-display]`.** A guest who names themselves
  at the level-1 prompt sees "Playing as <name>" in the account bar (was always "Playing as a guest"); the
  callsign persists across reloads via `localStorage['guestName']` and pre-fills the register form so a
  later sign-up keeps it. Client-only — no server/DB change. New i18n key `ui.account.guest_named`.
- **Device-support architecture (iteration 1) + desktop Main Window polish
  `[2026-07-01-1933-device-profiles-desktop-polish]`.** Replaced the single `isTouch` boolean with a
  two-axis device model in one new module `client/src/device.js`: an **input** axis (`touch`/`mouse`,
  ~constant per session — drives touch controls, auto-pause on blur, fullscreen-on-tap) and a **form** axis
  (`phone`/`tablet`/`desktop`/`desktop-lg`, recomputed on resize from the viewport's longest edge — drives
  layout/CSS + forced rotation). Each axis has a single source of truth and projects onto mutually-exclusive
  body classes (`input-touch`/`input-mouse`, `dev-phone|dev-tablet|dev-desktop|dev-desktop-lg`); **`body.touch`**
  is kept as a compatibility alias so existing touch CSS/rotation/fullscreen rules aren't rewritten. `FS_API` /
  `STANDALONE` moved from `main.js` onto `Device`, and `applyDevice()` (called at load + first thing inside
  `engine.applyOrientation()` on resize) owns all those body classes; every `isTouch` consumer migrated to
  `Device.hasTouch`. Breakpoints (longest edge): `phone < 900 ≤ tablet < 1280 ≤ desktop < 1920 ≤ desktop-lg`.
  **Desktop Main Window polish** (additive CSS scoped to `body.dev-desktop`/`.dev-desktop-lg` only — mobile/touch
  and the `@media (max-width:760px)` override untouched): briefing title 32px / body text 26px; Loadout/Stash/Shop
  fixed-height (56px, no longer stretched); the granted-item 3D icon centers **below** the mission text (float +
  strut dropped) with Take-off under the item; ship-stats fonts ×2 — **verified they fit on one line** at
  1440×900 (scrollWidth == clientWidth), so the 2×2 borderless-grid fallback stays unused; Take-off follows the
  content instead of pinning to the bottom. **User-visible effect:** the PC/desktop between-battles screen reads
  cleanly (sized for a monitor, item + Take-off flowing under the text); mobile/touch is unchanged.
  **Iteration split:** this builds the architecture + the listed desktop fixes ONLY — full resize-driven
  adaptation of every screen is deferred to iteration 2 (the `form` axis already recomputes on resize; layout
  keys off `body.dev-*`, never raw `isTouch`). New unit test `client/src/device.test.js` (classifyForm
  boundaries); no server/DB changes. See DECISIONS §34.
- **itch.io HTML5 export ("Online" build) `[2026-07-01-1824-itch-html5-export]`.** New
  `npm run build:itch` (`scripts/build-itch.mjs`) assembles a static ZIP (index.html at root) that runs on
  itch.io and talks to the live backend at `https://vega.tenony.com`. Client API calls now go through a
  baked `API_BASE` (`client/src/api-base.js`; empty = same-origin, prod origin on the itch build — the
  build overwrites only the staged copy). Server gained CORS on `/api` (reflects Origin, no credentials)
  and **bearer-token auth** — login/register/reset return the session token in the body and the server
  accepts `Authorization: Bearer` alongside the existing cookie (`sessionTokenFromReq` reads the header
  first), so account login works inside the itch iframe (third-party cookies are unreliable). The
  same-origin `vega.tenony.com` deploy is unchanged (relative URLs, cookie auth). Guest play works
  cross-origin via the localStorage `playerId`. No `db.js`/`db_postgres.js` change (parity holds by
  construction); manual script, not wired into CI; `dist/` stays gitignored.
- **`/build-itch` skill.** Added a `build-itch` skill (`.claude/skills/build-itch/SKILL.md`) that packages
  the uploadable web build end-to-end: `assets:pull` (S3 models/SFX) → `npm run build:itch` → verify the
  archive (index.html at root, prod `API_BASE` baked, itch limits) → probe the live `/api` CORS preflight
  to report whether the prod deploy is ready → print the itch.io upload checklist. Clarifies that building
  the zip and deploying the server are independent (build/upload anytime; wait for a green deploy before
  publishing/play-testing).

- **Password recovery `[2026-07-01-1717-password-reset]`.** Added a self-service "Forgot password?" flow
  modeled on the email-verification flow. From the login form the player requests a reset by email;
  `POST /api/auth/forgot-password` is **enumeration-safe** (always `200 { ok:true }`, identical
  confirmation whether or not the email exists) and, for a real account, emails a `/?reset=TOKEN` client
  link (1 h token TTL, throttled per account by `password_reset_sent_at` reusing the 60 s resend gap).
  Opening the link puts the `#account` modal in a new **reset** mode; `POST /api/auth/reset-password`
  rotates the password, **marks the email verified** (clicking the link proves ownership), **invalidates
  all of the player's existing sessions**, then logs them in on this device (auto-login, client adopts the
  returned player row like login). Reuses existing infra: SES no-op `outbox` (`sendPasswordResetEmail`),
  the token-hash + `sent_at` + TTL pattern, `crypto.scrypt`, the per-IP rate limiter. New SQLite
  **migration 017** adds `password_reset_token_hash` + `password_reset_sent_at`, mirrored in the Postgres
  bootstrap (backend parity kept in `db.js` + `db_postgres.js`). EN + RU i18n strings added; new server
  auth tests (SQLite) cover happy-path/rotation, session invalidation, enumeration-safety, invalid/
  consumed/expired token, and weak password. See DECISIONS §32.

## 2026-06-30

- **Tooling — multi-agent development pipeline (`/feature-pipeline`).** New skill
  (`.claude/skills/feature-pipeline/SKILL.md`) that runs a feature end-to-end through four clean-context
  agents in `.claude/agents/`: **feature-planner** (clarifying questions → self-contained plan in
  `docs/plans/<id>.md`), **plan-critic** (APPROVE/REVISE, read-only), **feature-implementer** (code +
  tests + doc updates in an isolated **git worktree**), **code-reviewer** (PASS/CHANGES, read-only). Feature
  ID = `YYYY-MM-DD-HHMM-slug` (also the branch/worktree/CHANGELOG tag); "deploy" = merge/push to `main` →
  CI/CD. Ends with a retro that flags high iteration counts and asks satisfaction-per-agent, appending
  concrete lessons to each agent's `## Learned guidance`. Spec: `docs/plans/multi-agent-pipeline.md`. Also
  recorded **DECISIONS §30** (keep processes simple until a real problem forces more — why we use timestamp
  IDs, not a registry). Added a `CLAUDE.md` rule: when the maintainer asks for a **code change** (not just
  discussion/research), offer to run it through `/feature-pipeline` first.

- **Refactor (client structure) — Slice 20: prune dead imports from `main.js`.** After the UI split,
  `main.js` still imported ~40 symbols only its now-moved code used. Removed the fully-dead import lines
  (three/addons `RoomEnvironment`, `components`, `steering`, `audio` settings helper, `graphics` `saveTier`,
  `format`, `ship-factory`, `shop`, `settings`) and trimmed the partially-used ones (`i18n` `t`,
  `sound-routing` `sfxFor`, `state` `moons`/`SPAWN_GROW_TIME`, `projectiles`/`ship-build`/`net` down to the
  handful `__game`/`bootstrap`/the funnel listeners actually use). Verified with a comment-aware unused-import
  scan across all modules (only `main.js` had dead imports; the `shop`/`welcome` "hits" were false positives
  — template-literal `${}` usage). No behavior change. Unit 46/46; visual 10/6 baseline, zero page errors.
  Branch `refactor/client-esm-split`.

- **Refactor (client structure) — Slice 19: the between-battles UI → `mainwindow.js` + `welcome.js` +
  `account.js`; `main.js` is now a lean composition root.** Co-extracted the last, mutually-recursive UI
  cluster (one strongly-connected cycle: mainwindow↔account↔welcome) in a single commit — the only way,
  since a module can't call a function still in `main.js` and ESM tolerates the resulting runtime import
  cycles (all edges fire on user actions, never at module init). `mainwindow.js` = the Main Window
  (`showMain`/`selectMenu`/mission board/`launchCampaign`/`launchMission`/`refreshMissions`) + the two
  spinning-model viewers (ship preview + briefing-item showcase); `welcome.js` = the ship-picker/take-off +
  the i18n UI glue (`applyTranslations`/EN-RU switch) + the fullscreen helper; `account.js` = the auth
  block + `initSentry` + a new `restoreSession()` (the `/me` + `?verified` logic bootstrap used to inline)
  and a `setPlayerShipsCache()` setter. `main.js` (1208 → **543 lines**) is now just imports + input/touch/
  zoom wiring + `devPerf` + `animate` + the `?debug` `window.__game` hook + `bootstrap`. Shared read-only
  state the hook needs (`missionOffers`/`mainBriefing`/`mwPreview`/`mwItem`) is exported as live `let`
  bindings from `mainwindow.js`. No behavior change. Unit 46/46; visual 11/5 (better than baseline this run),
  **zero page errors** (the whole cyclic graph initializes cleanly and every UI scenario passes:
  hangar-shop, mobile-hangar, mission-board, briefing-showcase, welcome/smoke). This completes the client
  ESM split — `index.html` is 212 host-only lines and the former 3736-line inline script is now 24 cohesive
  modules. Branch `refactor/client-esm-split`.

- **Refactor (client structure) — Slice 18: audio-settings modal → `src/settings.js`.** Peeled the second
  self-contained leaf (~137 lines) out of `main.js`: the gear modal (master/music/sfx volumes + on/off
  toggles), the graphics-quality tier picker (persists + reloads), and the slide-to-confirm "reset my
  progress" control. It calls only sim (pause/music) + the audio engine + persistence, never back into the
  UI; the only outward tie is `localizeSettings` (imported by the language switch). No behavior change.
  Unit 46/46; visual at the flaky baseline (zero page errors → the modal's ~20 DOM handlers all wired).
  Branch `refactor/client-esm-split`.

- **Refactor (client structure) — Slice 17: hangar shop → `src/shop.js`.** First of the optional
  `main.js` UI split. Peeled the self-contained shop/stash leaf (~285 lines) out of `main.js`:
  loadout/stash/two-pane shop rendering, the delegated bay click handler, buy/sell/equip actions
  (server-authoritative), the live ship-stats delta bar, and `openBay`. It calls nothing back into the UI;
  the Main Window calls in via `openBay`/`showBayView`/`updateTakeoffGate`/`renderShipStatsBar`/
  `deriveShipStats`/`resetShipStatsDelta`. The two spots where the Main Window poked shop's private state
  (`bayView`, `lastShipStats`) now go through `showBayView()`/`resetShipStatsDelta()` setters. No behavior
  change. Unit 46/46; visual 10/6 baseline (`05-hangar-shop` passes). Branch `refactor/client-esm-split`.

- **Refactor (client structure) — Slice 16 (final): inline script → `src/main.js`; `index.html` is now
  buildless host-only.** Moved the entire remaining inline `<script type="module">` body (~1620 lines:
  `bootstrap`/`animate`/`prewarmShaders`/`window.__game` + the Main Window / hangar shop / welcome / account
  / audio-settings + i18n UI) into `src/main.js`, fixed its 18 sibling-import paths (`./src/x.js` → `./x.js`),
  and collapsed the inline script to a single `import './src/main.js';`. **`index.html` went 3736 → 212
  lines** — pure markup + the `three` importmap + the one module import; no game code remains inline. Pure
  relocation (the inline block was already `type="module"`, so the moved closure keeps identical scope/
  references) — no behavior change. Unit 46/46; visual 10/6 flaky baseline (incl. all UI scenarios:
  hangar-shop, mobile-hangar, mission-board, welcome/smoke, briefing-showcase). Auth register/login have no
  visual scenario but are byte-identical relocated code. A follow-up can peel `main.js` into cohesive
  `mainwindow.js`/`shop.js`/`welcome.js`/`account.js`/`settings.js` modules (now a mechanical
  module→module split). Branch `refactor/client-esm-split`.

- **Refactor (client structure) — Slice 15: `reset` → `src/sim.js` + dead-import cleanup.** Moved the
  `reset()` restart routine (clears entities/FX, recenters the arena, rebuilds set-pieces, respawns the
  player + (re)starts the level) into `sim.js` beside the loop it resets; the take-off + overlay
  Restart/Continue flows import it. Trimmed imports the inline script no longer uses now that their callers
  moved out: `combatAmbient`/`sun` (engine, → tune.js) and `updateMoons`/`buildSetPiece` (world, → sim.js).
  This makes the remaining UI leaves extractable (they call `reset` as a module now). No behavior change.
  Unit 46/46; visual at/above the flaky baseline (11/5 this run). Branch `refactor/client-esm-split`.

- **Refactor (client structure) — Slice 14: `?tune` palette panel → `src/tune.js`.** Moved the dev-only
  color/lighting tuning panel (`dumpPalette` + `buildTunePanel`) into `src/tune.js` (imports `scene`/
  `skyScene`/`combatAmbient`/`sun` from engine, `G` from state, `buildMap` from world). `buildTunePanel(GUI)`
  is still called only under `?tune` in bootstrap, and lil-gui is still dynamically imported there — so
  players download the tiny module but never the GUI library. No behavior change. Unit 46/46; visual 10/6
  baseline. Branch `refactor/client-esm-split`.

- **Refactor (client structure) — Slice 13: the simulation → `src/sim.js`.** The biggest slice: moved the
  fixed-step `update(dt)` loop (~310 lines), the `levelRunner` (DB phase/wave script), the cosmetic helpers
  (`forwardVec`/`updateBank` wing-bank/`warpPlayerToCenter`/`updateOobWarning`), the music routing
  (`musicForState`/`refreshMusic`), and pause control (`setPaused`/`togglePause`/`autoPauseOnBlur`) out of
  the inline script into `src/sim.js`. Promoted the last two run-lifecycle scalars `gameStarted`/`paused`
  onto `G`, and moved the result-overlay + pause + OOB nodes (`overlay-title`/`overlay-sub`/`restart`/
  `back-hangar`/`pause-btn`/`pause-overlay`/`oob-warn`) into `dom.js`'s `el`. The inline script keeps the
  boot wiring (the `animate` render loop calling the imported `update`/`updateOobWarning`, the pause-button
  + focus listeners calling the imported pause fns, `reset`). `sim.js` sits at the top of the dependency
  graph (imports state/engine/world/projectiles/ship-build/net/i18n/dom; nothing imports it back — no
  cycle). No behavior change. Unit 46/46; visual at the 10/6 flaky baseline (incl. `04-combat`, which drives
  the whole loop). Branch `refactor/client-esm-split`.

- **Refactor (client structure) — Slice 12: backend + telemetry → `src/net.js`.** Moved `fetchJson`,
  `bankRun`, `track`, `currentLevelLabel`, and `unlockNextLevel` out of the inline script into `src/net.js`
  (imports `G`/`CATALOG` from state, `updateHud` from hud, `buildMap` from world, `buildPlayerFor` from
  ship-build — no import cycle). The community-link + pagehide funnel listeners stay inline (boot wiring,
  calling the now-imported `track`/`currentLevelLabel`); `reloadPlayerWorld` also stays inline for now (it
  calls `showMain`/`showWelcome`, still inline) and now calls the imported `fetchJson`/`buildMap`/
  `buildPlayerFor`. This unblocks the `sim.js` slice (the loop calls `bankRun`/`track`/`unlockNextLevel`).
  No behavior change. Unit 46/46; visual at the 10/6 flaky baseline. Branch `refactor/client-esm-split`.

- **Refactor (client structure) — Slice 11: `buildPlayerFor` → `src/ship-build.js`.** Moved the
  "(re)build the player ship and swap it into the scene" helper into `ship-build.js` (beside `buildPlayer`,
  which it already wraps; it needed only `scene` + `G.activeShip`/`G.currentShipName`, all already
  available there). This is a prerequisite for `net.js`: `unlockNextLevel` calls `buildPlayerFor`, so it had
  to be a module before the net layer can move out. No behavior change. Unit suite 46/46; visual suite at
  the 10/6 flaky baseline. Branch `refactor/client-esm-split`.

- **Refactor (client structure) — Slice 10: promote the back-half shared scalars onto `G`.** Keystone for
  the remaining split (mirrors slice 2's engine/world promotion): the simulation loop, the backend/net code,
  and the UI panels form one mutually-recursive blob sharing ~9 reassigned scalars, so none can move to a
  module while those scalars are inline `let`s (an ES module can't import a binding from the inline
  `<script>`). Moved `playerId`, `banked`, `gameStartTime`, `gameStartSent`, `quitSent`, `pendingBriefing`,
  `activeShip`, `currentShipName`, `activeMission` onto the shared `G` bag (`playerId` now initializes in
  `state.js`); rewrote all ~97 usages to `G.x` (comment/string/template/object-shorthand/member-access
  aware). No new modules, no behavior change — pure state relocation that unblocks the `net.js` then `sim.js`
  slices next. Unit suite 46/46; visual suite at the documented 10/6 flaky baseline (zero page errors).
  Branch `refactor/client-esm-split`.

- **Refactor (client structure) — Slice 9: HUD draws → `src/hud.js` + `src/dom.js`.** Moved the per-frame
  HUD draws (`updateHud`, `updateMarkers`, `updateMiniMap`, `updatePerf`) out of the inline script into
  `src/hud.js`, and introduced `src/dom.js` — the single fail-loud `el` inventory of shared `index.html`
  nodes (HUD readouts + the result `overlay`; a missing id throws on boot instead of failing silently).
  Promoted the run/account scalars `kills`/`earned`/`balance` onto the `G` state bag (the HUD reads them
  cross-module now). Pause control + the OOB warning + music routing stayed inline — they're coupled to
  `levelRunner`, which moves with the sim slice. No behavior change; unit suite 46/46, visual suite at the
  documented 10/6 flaky baseline (zero page errors). Branch `refactor/client-esm-split`.

- **Refactor (client structure) — Slice 8: ship building & weapons → `src/ship-build.js`.** Moved the
  catalog resolution (`resolveWeapon`/`resolveComponents`/`buildMounts`/`buildGroups`), `buildPlayer`,
  enemy spawning (`spawnEnemyShip`/`spawnEnemy`) and the fire-group logic (`fireMount`/`updateGroups`)
  into `src/ship-build.js`, imported back in. The shared `SPAWN_GROW_TIME` constant moved to `state.js`.
  The inline `levelRunner` stays (its methods close over the loop's kills/spawn/pause state and call the
  imported `spawnEnemyShip`). No behavior change; visual suite unchanged from baseline (combat green).

- **Refactor (client structure) — Slice 7: projectiles & combat FX → `src/projectiles.js`.** Moved
  bullets, micro-explosions, the layered ship-death burst, engine exhaust trail, homing rockets and
  rocket smoke (`spawnBullet`/`spawnExplosion`/`spawnShipExplosion`/`emitExhaust`/`spawnRocket`/
  `detonateRocket`/`spawnSmoke`/`findTargetInSector`/`liveParticles` + the FX geometries) into
  `src/projectiles.js` (imports `scene`, the state pools, `G`, and `audio`/`sfxFor`), imported back in.
  `bulletGeo`/`explosionGeo` are exported too (reused by `prewarmShaders`). No behavior change; visual
  suite unchanged from baseline (combat/explosion/exhaust scenarios green).

- **Refactor (client structure) — Slice 6: promote `player` onto the `G` state bag.** The active player
  ship moved from the inline `let player` to `G.player` (185 reads rewritten to `G.player`; the single
  runtime assignment is `G.player = buildPlayer(...)`; the `__game` test getter reads it live). This
  unblocks the gameplay-core modules (projectiles/ship-build/sim/hud) that all touch the player. Pure
  rename, no behavior change; visual suite unchanged from baseline.

- **Refactor (client structure) — Slice 5: audio engine + SFX routing → `src/sound-routing.js`.** Moved
  the `audio` engine singleton and the DB-driven `tracksFor`/`sfxFor` routing into `src/sound-routing.js`
  (depends only on `audio.js` + `state.js`'s `soundMap`), imported back in. Music *state* selection
  (`musicForState`/`refreshMusic`/`tryUnlockAudio`) stays inline since it reads live loop state. The
  `createAudio`/`loadAudioSettings` imports moved into that module. No behavior change; visual unchanged.

- **Refactor (client structure) — Slice 4: ship factory → `src/ship-factory.js`.** Moved
  `shipModelCfg`/`modelSpec`/`makeShip`/`applyShipModel` + the shared `gltfLoader` + `SHIP_MODEL_LEN`
  into `src/ship-factory.js`, imported back in (the inline model viewer reuses the exported loader). The
  inline `GLTFLoader`/`MeshoptDecoder` imports moved into that module. Repointed `adding-a-ship-model.md`,
  `ship-model-config.md` and the SUMMARY "Visual model" note at the new file. No behavior change; visual
  suite unchanged from baseline.

- **Refactor (client structure) — Slice 3: world building → `src/world.js`.** Moved the arena boundary
  (`ARENA`/`OOB_*` consts, `arenaCenter`, `arenaBorder`), the starfield, planet/moons/asteroid builders,
  the procedural mission set-pieces and `buildMap`/`updateMoons`/`buildSetPiece` into `src/world.js`
  (~560 lines), imported back in. Promoted the per-map handles reassigned by `buildMap` to the `G` bag
  (`G.sky/stars/skyAmbient/skySun/currentMapDescriptor/mapSetpieces/arenaDrift`); `arenaCenter`/`planetPos`
  are mutated-in-place so they stay `const`. No behavior change; visual suite unchanged from baseline
  (set-pieces `09`, planet/stars `01` green).

- **Refactor (client structure) — Slice 2b: engine singletons → `src/engine.js` + the `G` state bag.**
  Moved the renderer/`scene`/`skyScene`/`camera`/lights (`combatAmbient`/`sun`) + PMREM env-map, the
  orientation block (`isTouch`/`gameW`/`gameH`/`toGame`/`applyOrientation`) and the camera-zoom block
  (`setZoom`/`zoomBy`/`tickZoom`/`camOffset`) into `src/engine.js`, imported back in. Introduced the
  mutable state bag `export const G` in `state.js` for reassigned cross-module scalars — seeded with
  `G.gfx` (graphics tier; tier switch reloads the page, so it's effectively read-only) and `G.rotated`
  (portrait-rotation flag, read by the reset-slider code). The inline `RoomEnvironment` import stays for
  the not-yet-moved model viewer. No behavior change; visual suite unchanged from baseline (orientation
  `15-mobile-landscape` + zoom/combat scenarios green).

- **Refactor (client structure) — Slice 2a: shared entity collections → `src/state.js`.** Moved the
  `const` entity/data collections (`bullets`, `explosions`, `sparks`, `shockwaves`, `trail`, `rockets`,
  `smoke`, `enemies`, `moons`, `setPieces`, `soundMap`, `CATALOG`, `keys`, `touchAim`) out of the inline
  script into `src/state.js`, imported back in. These are `const` shared by reference, so mutating their
  contents works across modules with zero renames. `levelRunner` stayed inline (its methods close over
  inline scope; it moves with the sim slice). No behavior change; visual suite unchanged from baseline.

- **Refactor (client structure) — Slice 1: pure presentation helpers → `src/format.js`.** Extracted the
  stateless helpers `esc`, `cssColor`, `slotLabel`, `priceLabel`, `sellLabel` (+ `SELL_RATE`) out of the
  inline `index.html` script into a new `src/format.js` ES module, imported back in. Added
  `src/format.test.js` (5 cases; unit suite 41 → 46). Proves cross-module browser imports for the split;
  no behavior change. CATALOG-dependent helpers (`mountSummary`/`shipHullHp`) deferred to a later slice.

- **Refactor (client structure) — Slice 0: CSS extracted out of `index.html`.** Moved the ~560-line
  inline `<style>` block verbatim into `client/styles.css`, linked via `<link rel="stylesheet">`. No
  behavior change (the server already serves `clientDir` statically, so the new file is served with no
  server change); visual suite unchanged from baseline. First step of the buildless ESM split per
  `docs/plans/client-code-structure.md`.

- **Bugfix — hangar no longer bricks when a required component is unequipped.** Unequipping a
  required slot (hull/engine/thruster) is intentional (the ship goes `launchable: false` and the
  part drops to the stash, gated by `updateTakeoffGate`), but the 3D hangar preview crashed building
  it: `buildPlayer` read `hull.durability` off a null hull and `deriveDrive` read `engine.power` off a
  null engine, so the page threw `Cannot read properties of null (reading 'durability')` and the
  hangar never rendered — leaving the player unable to reach Loadout/Stash to put the part back.
  Made both null-safe (`client/index.html` `buildPlayer`, `client/src/components.js` `deriveDrive`),
  matching the already-tolerant `deriveShipStats`/`shipHullHp`/take-off-gate paths. Now the hangar
  renders (HP shows **0 in red** via the `.v.crit` stats-bar class, Take-off disabled with the
  "required slot empty" note) and the player re-equips
  normally. Repaired the one live account this had already bricked by re-equipping its hull from stash.

- **CI fix — sync server tests with the new level balance.** The balance bump above changed enemy
  `reward` values and the L1 kill threshold, but `server/src/server.test.js` still asserted the old
  numbers, so CI failed at the test stage and the `level balance` + `IDEAS.md` commits never deployed.
  Updated the catalog/level assertions (fighter reward 25, rocketeer 50, medium 125, first boss 250,
  advanced medium pirate 200, L1 kills 6) — suite is green again and the balance can ship.

- **Docs — added `docs/IDEAS.md`, a directional idea parking lot.** A loose, no-commitment notebook for
  capturing where the game could go (PvP / co-op PvE / story grind; arcade vs. sim; session shapes) before
  any of it earns a roadmap slot or a plan. Linked from `ROADMAP.md`'s doc-map header.

- **Level balance — higher rewards, shorter early waves.** Bumped every enemy `reward` ~+25%
  (`catalog_seed.js`): fighter 20→25, rocketeer 50, pirate gunner 50, medium 100→125, first boss
  200→250, advanced medium pirate 150→200, Second Boss 400→500, advanced rocket pirate 60→75. Lowered
  the campaign wave kill thresholds so early levels move faster: L1 6/12 (was 7/15), L2 second wave 12
  (was 15), L3 8/16 (was 10/20). Net effect: runs pay out more and the opening levels are quicker.

- **iPhone Safari full-screen fallback — "Add to Home Screen" hint.** iPhone Safari has no Fullscreen
  API (it exists only on iPad/Android), so the floating `⛶` button was a silent no-op there and testers
  had no way to hide the URL bar/tabs. Now we detect the case (`FS_API` = any `requestFullscreen`?,
  `STANDALONE` = `navigator.standalone`/`display-mode: standalone`) and, on a touch device with no FS API,
  set `body.no-fs-api`: hide the dead `⛶` button and show a non-interactive hint pill instead
  (`#a2hs-hint`, bottom-right, touch menus only) reading **"Full screen: Share → Add to Home Screen"** —
  the standalone PWA being the only true full screen on iPhone. Once already launched standalone
  (`body.standalone`) both vanish (no chrome to hide). New i18n key `ui.a2hs.hint` (EN + RU).

- **Second combat music track — "Energetic Synthwave" (Pixabay).** Added `music_combat_2`
  (ed-musicproductions, **Pixabay Content License** — commercial-OK, no attribution required) as a second
  track in the combat scene's rotation alongside the existing `music_combat_1`. Because the combat scene
  now has more than one track, the engine plays a **full track end-to-end then chains a fresh random one**
  (`src.loop` only when a scene has a single track), so battles alternate between the two. The source mp3
  (256 kbps, +0.7 dBTP clipping) was loudness-normalized to **−15 LUFS / −1 dBTP** to match
  `music_combat_1` (→ 101 s, ~199 kbps, 2.5 MB). Pipeline: source + license cert → `assets-src/sounds/`,
  hashed mp3 → `assets-dist/sounds/` + `client/assets/sounds/`, pushed to S3 (`sfx/` + `source/`), wired
  into `SOUNDS` + a second `(scene, combat, music)` row in `SOUND_MAP` (`server/src/catalog_seed.js`).
  `CREDITS.md` gained a row + a Pixabay-license note (and its Audio section was corrected — background
  music is sampled/rotated, not generative).

- **Fix: Main Window no longer shows a phantom scrollbar on the briefing.** The briefing item showcase
  (the strut+float trick that pins the gun to the bottom-right of the mission text) overflowed
  `#mw-mission-desc` by 8px: the 0-width strut reserved `100% − var(--gun-h)` while the floated gun added
  its own `var(--gun-h)` **plus** 8px of vertical margin (`2px` top + `6px` bottom), so the stack totalled
  `100% + 8px` and the description always scrolled even when the text fit. The strut height now subtracts
  that 8px (`calc(100% − var(--gun-h) − 8px)`), so the floated stack is exactly 100% tall and the scrollbar
  is gone. `client/index.html`.

## 2026-06-29

- **Fix: side mission no longer blanks the campaign briefing.** When the shop is unlocked but the current
  campaign level isn't cleared (e.g. on **level-4**), returning to the Main Window after playing a **side
  mission** showed "Stand by for new orders" on the **primary (campaign)** row instead of that level's
  briefing. `launchMission` clears `pendingBriefing`, so the return paths (`leaveOverlay`→`showMain(null)`
  on win, `elBackHangar`→`showMain(null)` on loss) lost the briefing. `showMain` now falls back to
  `CATALOG.level.briefing` when none is passed, so the campaign primary always reflects the current level.
  Added `showMain` + a `mainBriefing` getter to the `?debug` test hook (`client/index.html`).
- **Boss buff: +100 HP and +30% max speed.** The **first pirate boss** (Boss hull 210→**310** HP, Boss
  engine maxSpeed 8→**10.4**) and the **Second Boss** (Second-boss hull 450→**550** HP, Second-boss engine
  maxSpeed 11→**14.3**) are tougher and faster. Edited the boss-exclusive hull/engine components in
  `catalog_seed.js` (so the side-mission finale, which reuses the first boss, is buffed too); the
  mini-boss/medium (a wave enemy, not an end boss) is unchanged. Updated the level-4 catalog test (550 HP).

- **Stash/Loadout show the resale value; single-row cards off the Shop.** The **Stash** and **Loadout**
  screens now display each item's **resale value** (`floor(price*0.75)` — what the player actually gets on
  sale) instead of the full catalog price; the **Shop** keeps the full **buy** price. Added a client
  `sellLabel`/`SELL_RATE` (mirrors the server's `sellPrice`) and a `priceMode` arg on `itemCard`
  (`'buy'`/`'sell'`). Loadout cards also now carry the price (next to the slot's actions). **Layout:**
  Loadout/Stash item cards stay on a **single row** everywhere; the two-row phone stacking is now scoped to
  the **Shop** only. Sell rate unchanged (75%). Client-only.

- **Briefing item showcase — pinned to the bottom-right corner, text wraps around it.** The granted item
  (Machine Gun on L2, Repair drone on L3) now floats into the **bottom-right corner of the mission text** so
  the briefing text wraps full-width above it and down its left side, instead of occupying a full-width band.
  Implemented with the **classic CSS strut-float trick**: the canvas moved **inside `#mw-mission-desc`** next
  to a `#mw-mission-text` span and a 0-width `#mw-item-strut` (`height: calc(100% − var(--gun-h))`) that
  reserves the top of the right column; the canvas `clear: right` then drops below it into the corner.
  `renderMissionView` now sets the text on the `#mw-mission-text` span (not the whole description, which would
  wipe the canvas); visibility toggles `#mw-mission-desc.show-item`; the `itemShowcaseTarget` test hook reads
  that class. Client-only.

- **Briefing item showcase — full-size model in the bottom-left quarter.** Final placement: the granted item
  (Machine Gun on L2, Repair drone on L3) now renders at **full size** (`ITEM_SHOWCASE_SCALE = 1`) in a
  **left-aligned, half-width canvas occupying ~the bottom-left quarter of the work zone**, below the mission
  text; the title + text fill the top 3/4, the ship preview stays in the column to the right. Canvas height
  is a **flex-basis % of the work zone** (`flex: 0 1 42%`) instead of `vh`, so it's stable under the phone
  portrait→landscape rotation; the description keeps a `min-height` so it's never pushed off-screen.
  Client-only.

- **Briefing item showcase — bigger model, side-by-side layout (phone fix).** Follow-up to the move below.
  The granted item now renders at **2/3 scale** (was 1/3 — it was too small) in a **half-width canvas docked
  to the right of the work zone**: the mission text scrolls on the left, the item sits bottom-right against
  the ship column (ship just right of it). Restructured into a flex **body row** (`#mw-mission-body`,
  text + canvas) so the canvas no longer steals the description's vertical space — fixes the phone bug where
  the full-width item block pushed the mission text off-screen. `ITEM_SHOWCASE_SCALE` 1/3 → 2/3. Client-only.

- **Briefing item showcase moved into the work zone (no longer replaces the ship).** The granted item
  (Machine Gun on L2, Repair drone on L3) now spins in a **dedicated viewer between the mission text and
  the Take-off button** (`#mw-item`) at **1/3 scale** (`ITEM_SHOWCASE_SCALE`), instead of swapping the
  right-column ship preview — so the player always sees their ship *and* the new gear at once. Refactored
  the preview machinery into reusable `buildModelViewer` / `startViewer` / `stopViewer` / `resizeViewer` +
  `setViewerModel(viewer,…)` so the same code drives both GL contexts; the item viewer is built lazily and
  its loop stops on launch / when the bay view hides the mission canvas. Hidden on L4 (no item) and on side
  missions. Client-only change (no reseed). Updated the `97-briefing-showcase` visual scenario + a new
  `itemShowcaseTarget` test hook. See DECISIONS §29.

- **Mission briefings showcase the granted item's 3D model.** The level-2 briefing now spins the
  **Machine Gun** and the level-3 briefing the **Repair drone** in the right-column preview panel (instead
  of the player ship) while that briefing is up — the eye-catching item draws the player into the text.
  The server attaches a **`showcase {kind,id}`** to the briefing response, derived from the briefing's
  grant actions (`replaceWeapon`→weapon, `installComponent`→component; explicit `briefing.showcase` wins);
  the client resolves the id in its catalog and swaps the preview via `setPreviewModel`. The client also
  derives the showcase from the briefing `actions` on the **page-reload landing path** (where it gets the
  raw descriptor, no server `showcase`). Reverts to the ship on level 4 (no granted item) and when a side
  mission is selected. Postgres parity applied. See `docs/plans/briefing-item-showcase.md` + DECISIONS.

- **Component & weapon 3D models + a reusable item viewer.** Components and weapons can now carry a 3D
  model like ships do — `model_url` / `model_url_high` columns (**migration 016**, Postgres parity), seed
  fields, getters, and client bootstrap. Only **`model_url_high`** (hangar, CloudFront, lazy-loaded) is
  wired — items are **menu-only icons**, never rendered in combat. First two real item models, both
  CC-BY 4.0 on CloudFront: the **Repair drone** (component 12) and the **Machine Gun** (weapon 5). The
  hangar ship preview was generalized into a reusable **ship-or-item viewer** (`setPreviewModel(url,cfg)` +
  `itemModelCfg`). `assets:check` now also validates component/weapon model URLs. CREDITS updated. See
  `docs/plans/component-weapon-models.md` + DECISIONS.

- **Main Window: left-menu scroll section + mobile 2-line shop cards.** The left menu now has its **own
  scroll section** that begins below the top-left auth block (`#mw-menu` uses `margin-top`, so
  `overflow-y` clips scrolled items there instead of sliding them up behind the block), and the
  **`#account-bar` is opaque** so nothing shows through it. Shop/loadout/stash item cards now lay out as
  **two rows on touch phones** — the item name on top, the **price + action button centered** on a second
  row (a long name + price + Buy don't fit one line on a phone) — while **desktop keeps them on one line**
  (`body.touch .bay-item` switches to a stacked column).

- **Main Window: ship-stats strip relocated + bay shrunk.** The ship characteristics
  (HP / Accel / Turn / Weight) moved out of the shop bay to a **compact one-line strip above the model**
  (in the right column, under the "Ships" label) — fonts halved, **no boxes** — and it now renders
  whenever the Main Window opens (not only when the shop is unlocked). The work-zone **bay
  (Loadout/Stash/Shop)** content — fonts, buttons, accompanying elements — is scaled **~1.5× smaller**
  (`#mw-view-bay { zoom: 0.67 }`).

- **Fixed a Postgres auth-session race (and the CI flake it caused).** `startSession` fired the session
  `INSERT` **without awaiting it** before sending the cookie — on Postgres that insert could still be in
  flight when the client's next authenticated request arrived, so auth failed intermittently (a real prod
  race; `node:sqlite`'s synchronous insert hid it locally, which is why the SQLite suite never caught it).
  Now `register`/`login` **await** the insert before responding. Also added `perf_samples` to
  `resetAllPlayers` (both backends) so the suite is **re-runnable against a persistent Postgres** (the perf
  test no longer accumulates rows across runs). This is what made the visual-redesign deploy's CI job flake
  on `verify: the email link flips email_verified`.

- **Main Window layout polish.** Left-menu **Loadout/Stash/Shop** buttons got centered labels and are
  ~30% shorter than the Missions item; the **Mission 1/2/3** (and primary) sub-rows are centered too. The
  work-zone **title/description fonts dropped 4px** (title 26→22, description 22→18; mobile 18→14). The
  **Take off** button is centered in the work zone. The **left menu no longer overlaps** the auth
  (nickname / Log in / Sign up) block — it starts below it (`#mw-menu padding-top`).

- **Main Window redesign — dropped the "Hangar" name.** The between-battles / landing screen is now the
  **Main Window**, a fixed landscape layout instead of a centered, vertically-scrolling column. Top bar:
  the settings gear (top-left, top-aligned with the auth block), the **auth block** next to it, the
  enlarged **Vega Sentinels** wordmark centered (the on-screen "Hangar" title is gone), and an inactive
  **Ships** label top-right (future ship-buying). Below it a 3-column grid — **left menu** (Missions /
  Loadout / Stash / Shop) | **work zone** | a **25% live ship-model preview**. The **Missions** item
  (collapsible) lists the campaign mission (primary) and, once unlocked, the three side missions
  (secondary); selecting one renders its description + Take-off into the work zone (only the description
  scrolls). The old top-right **side-mission board + its modal panel were removed** — selection moved into
  the left menu. The shop bay (Loadout/Stash/Shop) is unchanged internally but now opens **in the work
  zone** from the left menu (the in-bay nav strip is gone). The **auth block shows the player's nickname**
  (not "Guest") whenever they've set one, even without a full account. New **ship-model preview**: a
  small, self-contained Three.js view (`#mw-ship`) that loads the player's `_hangar` glb and slowly
  rotates; its render loop runs only while the Main Window is visible (costs nothing in a fight).
  Code/DOM/i18n renamed `hangar*`→`main*`/`mw-*` (`showHangar`→`showMain`, `launchFromHangar`→
  `launchCampaign`, `openHangarShop`→`openBay`, `#hangar`→`#mainwin`, `#hangar-go`→`#mw-go`); new i18n
  keys `ui.mainwin.missions|ships|primary` (EN+RU). Visual scenarios 05/07/10 reworked to the new layout.
  See `docs/plans/main-window-redesign.md` + DECISIONS §24.

- **Machine-gun fire is quieter (−30%).** The `kinetic` weapon-fire SFX (player guns 1/5/7) now plays at
  `gain: 0.7`. Wired the long-unused per-sound `gain` from the `sounds` table through to playback: the
  client preloads gains via `audio.setSampleGains(...)` and `playSample` multiplies each one-shot by its
  registered gain (default 1). Set in `SOUNDS` (`catalog_seed.js`); re-seeded on server boot.

## 2026-06-28

- **Mobile landscape is now real rotation, not a "please rotate" cover.** Replaced the rotate-to-landscape
  cover with actually rendering the game horizontally on a portrait phone: when a touch device is in
  portrait, the whole `<body>` is rotated 90° in CSS (`body.rot`, `transform: translateX(100vw)
  rotate(90deg)`) and the game runs in the swapped dimensions. `applyOrientation()` (boot + `resize`/
  `orientationchange`) toggles the class and is the single place the renderer/camera are sized, via new
  `gameW()/gameH()` (innerHeight/innerWidth swapped when rotated). Touch input is mapped into the rotated
  frame with `toGame()` (steering stick + reset-progress slider; pinch is rotation-invariant), and the
  off-screen enemy markers project against the game dims. Removed the now-obsolete `#rotate-cover`
  (markup + CSS), `screen.orientation.lock` best-effort, and `autoPauseOnPortrait` — there's no unseen
  portrait fight to pause anymore. When auto-rotate is on, turning the phone to real landscape disables the
  CSS rotation and the native landscape viewport takes over. Visual: `15-mobile-landscape` now asserts the
  rotation geometry (rotated body stays full-screen + lays out landscape); the real touch+portrait render
  was eyeballed via a touch-emulated Playwright context. (Supersedes the cover described in the next bullet.)
- **Mobile landscape + floating fullscreen button.** Phones are now forced to landscape: held in
  portrait, a full-screen rotate-to-landscape cover (`#rotate-cover`, icon-only `📱↻`) hides the game
  via a touch-gated `@media (orientation: portrait)` query, backed by a best-effort
  `screen.orientation.lock('landscape')` (Android in fullscreen; iOS Safari ignores it → the cover is the
  fallback), and rotating to portrait mid-fight auto-pauses (`autoPauseOnPortrait`, mirrors
  `autoPauseOnBlur`, no auto-resume). The four inline "⛶ Full screen" buttons (welcome / hangar / pause /
  settings) are replaced by **one** fixed, icon-only, brighter button in the bottom-right
  (`#fullscreen-btn`), gated to touch menus (`body.touch.menu`) so it never overlaps the in-fight rocket
  button, and hidden once fullscreen (a `fullscreenchange` listener toggles `body.fs`). `ui.fullscreen`
  now drops the leading glyph and is applied to the button's `aria-label`/`title` (re-applied on language
  change) — source.json + ru.json updated. Visual scenarios: `07-mobile-hangar` updated for the single
  button; new `15-mobile-landscape` covers the rotate cover + no-overlap gating.
- **Seed now prunes orphaned enemy ships (cleans up after a rename/removal).** The catalog upsert
  couldn't delete, so the earlier enemy→pirate rename left stale enemy rows (`basic enemy ship`,
  `first boss`, `second boss`, …) lingering in every DB (harmless — nothing spawned them — but untidy).
  `seedCatalog` (both `db.js` SQLite and `db_postgres.js` Postgres, kept in parity) now deletes
  `type='enemy'` rows not in the seed **and owned by no player** (enemies never are, so no player can
  lose a ship). Cleans local on restart and prod on the next deploy. Added a re-seed prune test +
  exported the PG `pool` for it; 55/55 tests green on both backends.
- **Formalized map/border marker colors by ship size tier.** The off-screen edge arrows, the mini-map
  dots and the hangar ship-dot read each ship's `stats.color`; these were ad-hoc per ship. Introduced a
  single `MARKER` palette in `catalog_seed.js` — **small → orange `#f4741f`** (enemy_1 fighters/gunners +
  enemy_2 rocketeers), **medium → red `#e53935`** (enemy_3), **boss → maroon `#800020`** (enemy_4) — and
  pointed every enemy's `color` at its tier (player keeps blue). Visible effect: consistent threat-tier
  colors on the radar/edge arrows. Updated the L4 visual scenario's color assertions and the
  `update-ship-model` skill (set the marker color from `MARKER` when adding/changing a ship). Does NOT
  touch the 3D models. Requires the usual local server restart to reseed (done).
- **New skill `update-ship-model`** (`.claude/skills/update-ship-model/SKILL.md`) — encodes the
  add/replace/re-tint-a-model workflow end-to-end so it's done consistently: build the optimized glbs →
  `assets:push` to S3 (always) → wire the hashes into `catalog_seed.js` → refresh the local serve dir →
  `assets:check` → **restart the local server** (the catalog reseeds only on startup — skipping this is
  what made a replaced model show the generic primitive locally) → for a replacement, delete the
  superseded S3 objects via an atomic `aws s3api delete-objects` (NOT a zsh `for` loop, which silently
  no-ops) → CREDITS check → docs + commit + push (CI bakes combat glbs + reseeds prod on deploy).
- **Enemy "orange" tint pushed warmer: `#f4541f` → `#f4741f`.** The advanced-tier pirate models
  (`enemy_1..4_orange`) now read as a noticeably more orange (less red) hull. Made the recolor
  **reproducible**: added `scripts/assets-recolor.mjs` (`npm run assets:recolor`) — it re-derives the
  `enemy_*_orange` sources from the red `enemy_*` sources by re-tinting only the pack's RED materials
  (linear G≈0, B≈0, R>0) to the target hex, scaling each red's brightness so light/dark shading is
  preserved (black/gray untouched). The target hex is the single constant `TARGET` in that script.
  Rebuilt the 4 orange combat+hangar glbs (new content hashes), pushed to S3, repointed
  `catalog_seed.js` (`pirate gunner`, `advanced medium pirate`, `second pirate boss`, `advanced rocket
  pirate`), and bumped the advanced-rocket-pirate marker `color` to `0xf4741f` to match. Also:
  `assets:build` now accepts optional base-name args to rebuild a subset (so we skip the 48 MB player
  rebuild); added `@gltf-transform/core`/`extensions` as repo **devDependencies** (the recolor script
  uses the JS API, not just the CLI). Asset guard passes (all 23 referenced assets on S3). CREDITS.md +
  SUMMARY.md updated to `#f4741f`.
- **Fix: "Reset my progress" never reset anything on production (Postgres).** The Postgres
  `resetPlayer` (`server/src/db_postgres.js`) wrote `shop_unlocked = false`, but the column is an
  `INTEGER` (it's `0`/`1` everywhere else) — so the `UPDATE players …` threw
  `column "shop_unlocked" is of type integer but expression is of type boolean`, the endpoint
  returned **500**, and the client (which `throw`s on a non-OK reset and skips its reload) left the
  player on their old credits/level/missions. Worse, the function had **no transaction** (the SQLite
  version does), so the `DELETE`s of games/ships/stash that run *before* the failing UPDATE committed
  anyway — a partial wipe (the starter ship is auto-restored on the next load, but stash items were
  lost). Fix: write `shop_unlocked = 0` and wrap the whole reset in `withTx` (matching the SQLite
  `resetPlayer`); `ensureDefaultShip` now takes an optional transaction client. SQLite was unaffected
  (loosely typed + already transactional), which is why the unit tests passed while prod broke.
- **Tests now run against Postgres too (closes the gap that hid the bug above).** `server.test.js` is
  backend-agnostic, but CI only ever ran it on SQLite — whose loose typing silently accepts a boolean
  in an INTEGER column, so the Postgres-only 500 never showed up. The `test` CI job now runs the suite
  **twice**: SQLite (`npm test`) and a throwaway `postgres:16` service container
  (`DATABASE_URL=… npm test`). On Postgres the suite truncates the player tables up front for a clean
  slate (catalog kept). Local equivalent: **`npm run test:pg`** (defaults to a `spacegame_test` DB).
  Strengthened the reset test to clear the campaign (unlocking the shop) and assert `shopUnlocked` is
  `false` after reset — the assertion that catches this exact regression (verified: it fails on the
  Postgres pass when the bug is reintroduced, passes when fixed). An audit of every other
  `db.js`/`db_postgres.js` mutation found no further boolean-vs-integer or missing-transaction
  divergences.
- **Orange (#f4541f) recolors of `enemy_1..4`, used as the ADVANCED-tier pirate models.** Ran the source
  models (`assets-src/enemy_1..4.glb`) through a recolor pass that maps every red `baseColorFactor`
  (#ff0000 / #c40000 / #bb0000) to #f4541f, preserving each shade's relative brightness (darker reds →
  proportionally darker orange); black/grey untouched (the models carry no textures — colors live in the
  materials). Built combat + hangar `.glb`s (`assets-src/enemy_*_orange.glb`), pushed to S3. The advanced
  enemies now use these orange models instead of placeholder primitives: **pirate gunner** ← orange `enemy_1`
  (was `fighter.glb`), **advanced medium pirate** ← orange `enemy_3` (was `heavy.glb`), **second boss** ←
  orange `enemy_4` (was `boss.glb`) — each with `model.yaw: Math.PI`. The orange `enemy_2` is seeded as a
  new **`advanced rocket pirate`** ship (role `advanced_rocket_pirate`, Pirate hull/engine + Pirate MG +
  rocket, reward 60) for future use — **not yet wired into any level**. (`fighter.glb` / `heavy.glb` /
  `boss.glb` are now unused placeholders, left in git.)
- **Renamed all enemies enemy→pirate.** `basic enemy ship`→`Basic pirate ship`, `basic rocket
  enemy`→`basic rocket pirate`, `basic mini boss`→`pirate mini boss`, `first boss`→`first pirate boss`,
  `second boss`→`second pirate boss` (`pirate gunner` / `advanced medium pirate` already named). Updated
  every level/mission pool (`catalog_seed.js`, `missions.js`) and the tests that spawn/look up by name.
  Updated `assets/CREDITS.md` (same CC-BY pack, attribution unchanged), SUMMARY, and the ship-count tests
  (`ships.length` → 9, enemies → 8).
- **Combat-model policy change: light for battle first (meshopt is now the combat default).** Dropped the
  old "combat glbs must be vanilla so they open in macOS Quick Look" requirement — combat models are now
  built as small as possible: aggressive decimation **+ meshopt geometry compression** (`PRESET.combat` in
  `assets-config.mjs`). Motivated by the orange enemies above, which are hard-surface low-poly with
  un-welded (flat-shaded) vertices: `simplify` cuts triangles but not vertices, so uncompressed they were
  huge (enemy_4 combat **1.2 MB**, bigger than its source; raising the simplify error did nothing). With
  meshopt the orange combat models are **28 / 93 / 63 / 211 KB**. The client already wires
  `setMeshoptDecoder`, so combat + hangar both load; preview/orientation-check combat in a **web glTF
  viewer** now, not Quick Look. Scrubbed the Quick Look requirement from the living docs (DECISIONS §14,
  `ship-model-pipeline.md`, `adding-a-ship-model.md`, `client/assets/README.md`) and the pipeline-script
  comments; removed the now-redundant per-source orange overrides (the default covers them — hash-neutral,
  no re-push). Also **rebuilt the plain `enemy_1..4` originals** under the new default and re-pushed
  (combat **223/536/275/1278 KB → 28/93/62/211 KB**; hangar hashes unchanged; old combat orphans deleted
  from S3; catalog `modelUrl`s updated to the new hashes).

## 2026-06-27

- **Reverted the Performance particle batching — measured no benefit on the governor-bound device.**
  Trail + sparks were batched into one `THREE.Points` each (commit reverted here) to cut CPU draw-call
  submit. On-device telemetry (`?dev`, PowerVR GE8320) showed it **did** lower per-particle draw cost
  (~0.9 → ~0.5 draws/particle) but **combat fps was unchanged** (~22-24, governor-capped — a 5th
  independent proof the device's combat ceiling is its GPU/compositor governor, not our code) and
  **`js.render` actually rose ~1 ms** when particles were present — the Points fields re-uploaded their
  full buffer every frame, costing more than the few draw calls saved. So it added a custom-shader Points
  system (plus an un-prewarmed point-shader compile hitch) for zero measurable gain. Removed it; the
  prettier mesh-per-particle path is restored on all tiers. The real wins from this pass stay: the shader
  **pre-warm** (startup freeze gone) and the **`renderScale` removal** (sharper image). See DECISIONS §23.

- **Perf: removed the sub-1 `renderScale` knob (it blurred for no gain).** Measured on two GPUs (PowerVR
  GE8320 phone, Mali-G52 tablet), a 5.5-7× backbuffer-pixel cut moved fps by **nothing** — the weak-device
  bottleneck is CPU draw-call submit + the thermal/compositor governor, **not** fragment fill rate. So the
  Performance-tier `renderScale: 0.7` only degraded image sharpness for zero perf benefit. Removed the knob
  entirely (`client/src/graphics.js` TIERS, the `setPixelRatio` multiply, the `?dev` device-passport field,
  the tier-table test). `pixelRatioCap`/`antialias` remain as cosmetic-quality knobs. Docs (SUMMARY tiers /
  DECISIONS §23 / plan) corrected — the "bottleneck is fill rate" framing is now marked disproven. Next
  perf change is particle batching (trail+sparks → one `THREE.Points`), the one data-supported CPU lever.

## 2026-06-25

- **Perf: shader pre-warm to kill the startup freeze.** The `?dev` capture showed the **first 1-4 frames of
  every session spend 0.4-2.2 s** in render submit — THREE compiles each material's GL program lazily on its
  first render (shader compile + texture upload), so the opening of every fight stuttered (worst on the
  GE8320 phone: ~2.2 s; ~0.4 s on the Mali tablet). Added `prewarmShaders()` (`client/index.html`):
  `renderer.compile(skyScene)` + `renderer.compile(scene)` plus two throwaway off-screen meshes matching the
  dynamic effect program keys (additive fog-off for particles/explosions, opaque fog-on for bullets/rockets),
  so those programs compile up front instead of on first spawn. Runs **once, deferred two frames** after the
  loop starts (off the critical path — a synchronous compile would block first paint), during the menu while
  the player ship + sky already compile behind the welcome screen. **Skipped under the `?debug` inspection
  hook** — `renderer.compile` is very slow on the headless visual suite's software GL and would flake its
  startup-sensitive scenarios; prewarm is perf-only and behaviorally inert, so the suite loses nothing. Real
  users always get it. Verified: runs error-free in a real load; the visual suite is stable again. (On-device
  effect to be confirmed via the `?dev` first-sample render time.)

- **Mobile: "Full screen" button on the settings overlay.** On a phone the gear doubles as pause, but the
  settings overlay (`#settings-overlay`) had no way back to fullscreen — so opening the menu (or any
  pause/menu that drops browser chrome back in) left the player out of fullscreen with no recovery. Added a
  touch-only `.fullscreen-btn` to the settings box; it's auto-wired by the existing shared handler
  (`client/index.html`), joining the welcome/hangar/pause-overlay copies. Visual scenario `07-mobile-hangar`
  updated to expect 4 fullscreen buttons.
- **Perf measurement fix: FPS/frame-ms use the raw frame interval, not the clamped sim `dt`.** The render
  loop clamps `dt` to `0.05`s for sim stability, and that clamped value was also feeding the perf overlay
  **and** the `?dev` monitor — so `frameMs` saturated at 50 ms and the overlay FPS was *overstated* on slow
  devices (it under-counted elapsed time). Now `clock.getDelta()` is read raw for all perf metrics
  (overlay + `devPerf.frameMs`/fps) while the sim keeps the clamped `dt`. Surfaced by the GE8320 analysis,
  where every session's `frameMs.max` read exactly `50` regardless of real frame time.

- **Perf: low-end-phone fill-rate pass (Lever A + cheap Lever C).** A tester on a Samsung Galaxy A03s
  (PowerVR GE8320) reported the **same 15-25 fps in combat on both High and Performance** — a ~4× pixel
  cut (pixelRatioCap 2→1) plus AA/envMap/particles off bought nothing, which points at either a
  `devicePixelRatio` ~1 (the cap was a no-op) or a CPU-bound frame. Two new Performance-tier knobs in
  `client/src/graphics.js`, both **off on High/Balance** (no regression): **`renderScale` 0.7** —
  multiplies into `setPixelRatio` (`client/index.html`) so the backbuffer renders *below* native and the
  browser upscales the full-size canvas (the only fill-rate lever that bites below a pixel-ratio cap of 1);
  **`maxParticles` 300** — a hard ceiling on live additive particles (exhaust trail + sparks), skipping new
  emits over budget (caps overdraw *and* per-frame JS). The **perf overlay now appends the real backbuffer
  resolution** (`w×h`), so a tester can confirm whether a tier/`renderScale` change actually moved the pixel
  count — distinguishing the two hypotheses. Tier-table unit test extended; visual smoke unchanged at High.
  The costlier sky-pass throttle ("Lever B") and a 4th "Potato" tier stay **deferred until measured** — see
  `docs/plans/perf-low-end-phones.md` and DECISIONS §23.

- **Perf: `?dev` client perf monitor + `perf_samples` telemetry.** A second tester (Redmi 10c) reported
  fps **independent of our graphics tier AND of scene load** (High gave *higher* fps than Performance;
  brief dips while simply turning, none during a heavy fight) — the signature of external governing
  (thermal/DVFS/vsync), which a single fps number can't confirm. So: opening the game with **`?dev`**
  (mirrors `?tune`/`?debug`) turns on a per-frame profiler (`devPerf` in `client/index.html`) that times
  the JS work each frame — `update` (sim) / `dom` (HUD+markers+minimap+OOB) / `render` (two-pass submit) —
  and once per second ships an aggregated sample (fps, frame-time p50/p95/max, the JS breakdown, a jank
  count, scene load, backbuffer res, and a one-time device/GPU passport via `WEBGL_debug_renderer_info`)
  to the new **`POST /api/perf`** → **`perf_samples`** table (migration 015 SQLite / Postgres bootstrap;
  both datastores; `recordPerfSample`/`getPerfSamples`). Batched every ~5 s + on tab-hide (`sendBeacon`);
  a `●dev` marker shows on the overlay while recording. **Off — zero overhead — for normal players.** The
  diagnostic tell: if `js.total` ≪ `frameMs.p50`, the frame isn't CPU-bound → external/GPU-governed.
  Server test added; verified end-to-end (page → POST 204 → rows stored). Give a friend a `/?dev` link and
  read it with SQL over `perf_samples`. See DECISIONS §23.

- **Perf monitor: capture JS-heap memory.** The `?dev` sampler now records a **`heap`** field (`used`/
  `total`/`limit` MB via `performance.memory`) in each sample, and the `?dev` overlay shows live `usedMB`.
  Chrome/Android-Chrome only (`null` elsewhere); it's the JS heap, **not** process RSS or GPU memory, but
  it's the only in-page memory signal and catches JS-side growth/leaks over a session. (`navigator.device
  Memory` — total device RAM — is already in the device passport.)

## 2026-06-24

- **Refactor: per-ship model knobs consolidated into a documented `stats.model` block.** The loose,
  undocumented `stats.modelYaw` / `stats.sizeScale` keys (scattered across all 8 seed ships) are now one
  JSON sub-object `model: { yaw, scale, scaleMul?, muzzle?, exhaust? }` (`server/src/catalog_seed.js`).
  Added optional **`muzzle`/`exhaust` overrides** (group-local units) to nudge the projectile/exhaust
  spawn when the auto-derived glb nose/tail bounds are slightly off — `applyShipModel` honors them
  (default `null` keeps the auto behavior). Client reads route through a new `shipModelCfg(s)` resolver
  with **back-compat fallback** to the old loose keys (a stale `player_ships` row or cache can't break).
  No gameplay/balance change. New convention doc **`docs/plans/adding-a-ship-model.md`** ("fill this
  block" onboarding); `client/assets/README.md` + SUMMARY updated.

- **Fix: muzzle/exhaust spawned far off the model (regression).** `applyShipModel` measured the model's
  forward/back bounds with `Box3.setFromObject` **after** attaching it to the live, world-positioned group,
  so the box was in **world** space — it folded in the group's 1.8×sizeScale scale *and* the ship's world
  position (`fireMount`/`emitExhaust` then re-applied the scale). For the player (near origin) this widened
  the gap; for **enemies** (spawned far from origin) `noseZ`/`tailZ` became hundreds of units, so their
  bullets spawned off-screen (they "stopped shooting") and exhaust streamed off in the distance. Now the
  bounds are measured in **group-local** space (pivot un-parented, `updateMatrixWorld(true)` first), so
  spawn points sit on the model for every ship.
- **Real player ship model ("Air & Space Vessel" by Raven, CC-BY 4.0) — textured.** Replaced the
  placeholder `player.glb` primitive with a real fighter, keeping its **real paint/decals** (red side pods,
  white belly stripe, markings). The Sketchfab source was 48.7 MB (~89 high-res PBR textures); a **new
  per-model preset override** (`PRESET_OVERRIDES.player` in `scripts/assets-config.mjs`, merged by
  `presetFor`) **downscales the textures** + meshopt-compresses geometry → **combat `player_combat` ~371 KB**
  (128px, same-origin; loads via the meshopt decoder already wired) + **hangar `player_hangar` ~1.7 MB**
  (512px, CloudFront, lazy-loaded). Enemy builds are untouched (their hashes didn't change). Wired into
  `catalog_seed.js` (`modelUrl`/`modelUrlHigh`, `modelYaw: 0`, `sizeScale: 1.1` = +10%). Pushed to S3;
  `assets:check` green (15 assets). Credited in `CREDITS.md` (CC-BY attribution verbatim).
- **Ship reflections via a tier-gated environment map.** Added a PMREM of THREE's `RoomEnvironment` as
  `scene.environment` (combat scene) so metallic/low-roughness ship surfaces show real reflections — the
  "shine" a single directional light can't give. New `envMap` knob in `graphics.js` tiers: **on for
  High/Balance, off for Performance** (one prefiltered-cubemap lookup per lit fragment; spared on the
  weakest phones). Built once at startup, no per-frame CPU cost.
- **Muzzle flashes + exhaust now spawn at the model's real nose/engines.** Previously hardcoded offsets
  (`fwd*3` / `fwd*-2.6`) tuned to the old primitive left bullets/exhaust floating in empty space ahead of
  the new (wingspan-dominant) model — obvious with the machine gun. `applyShipModel` now caches the glb's
  forward/back bounds (`userData.noseZ/tailZ`); `fireMount` + `emitExhaust` spawn from there, scaled by the
  mesh's current world scale (so it tracks spawn-grow too). Auto-correct for any future model. Also fixed:
  the **player mesh never applied `sizeScale`** (only enemies did), so the +10% now actually shows.
- **Silenced enemy weapon fire.** Enemy bullet shots and rocket-launch whooshes no longer play any sound
  (both gated to `isPlayer` in `fireMount`, `client/index.html`) — only the player's own shots are
  audible now. **Enemy rocket *detonations* are kept** (the blast SFX stays ungated). `enemyShoot` remains
  defined in `audio.js` but is no longer called.
- **"Reset my progress" in the settings menu (slide-to-confirm → confirm dialog).** Players can now wipe
  their own progress from the settings modal: a **slide-to-confirm** control (drag the knob left→right to
  arm — a partial slide snaps back) opens a **confirm/cancel** dialog; confirming POSTs the new
  **`POST /api/players/:id/reset`** endpoint and reloads. Server-side it runs the existing per-player
  `resetPlayer` (same op as `reset.js --player`): clears games/ships/stash/events and resets
  level/credits/shop to the new-player baseline, re-granting the starter ship, while **keeping the account,
  login and language**; 404 for an unknown player. Settings modal elements were **shrunk** (paddings,
  row gaps, fonts, slider/knob sizes; cap 92→98vh) so everything **fits with no internal scroll**. New i18n
  keys (`ui.settings.reset.*`, EN+RU). Tests: server 52 (+2: reset to baseline, unknown→404), visual 14
  (+`reset-progress`: modal fits, slide arms the dialog, cancel snaps back, confirm POSTs /reset).
- **Palette/lighting tweaks (via `?tune`).** Space **background** retinted to **RGB 27,37,49**
  (`0x1b2531`, a dark slate-blue) in the `home-system` map descriptor (`catalog_seed.js`). The **combat
  "sun"** (the main-scene `DirectionalLight` lighting the battlefield from above, `client/index.html`) is
  **+20% brighter** (intensity `1.4 → 1.68`) for better ship readability.
- **Credited the enemy ship models + made the credits check a standing rule.** `enemy_1`–`enemy_4`
  (basic enemy, rocketeer, medium, first boss) are cut from the **"LowPoly Spaceships"** pack by **Pedram
  Ashoori** (Sketchfab, **CC-BY 4.0** — attribution required); added the row + a "## Models" note to
  `client/assets/CREDITS.md` (the ship models were previously uncredited). Added an **asset-credits rule to
  `CLAUDE.md`** and step 6 to `docs/plans/ship-model-pipeline.md`: when adding/replacing/removing any model
  (or sound), **always ask the maintainer whether CREDITS.md changes** before finishing — never decide
  silently; drop stale rows when an asset's last use is removed; CC-BY attribution stays while in use.
- **Ship wing-bank on turn (cosmetic).** Every ship — player **and** enemies — now **rolls its wings into
  a turn**, a smooth tilt capped at **20°** that eases back to level when straight
  (`docs/plans/ship-bank-on-turn.md`). Implemented client-side in `client/index.html`: `makeShip` now wraps
  the visual children in an inner **bank group** (`g.userData.bankGroup`) whose local Z is the ship's nose
  axis, so `bankGroup.rotation.z` is a pure roll that never fights the heading yaw; `applyShipModel` loads
  the `.glb` into that same group. A new `updateBank(ship, turnRate, dt)` derives the roll from the
  **actual per-frame heading change** (vs `turnRate*dt`), eased with `BANK_TAU` (0.15 s) and clamped to
  `BANK_MAX` (20°) — one path covers keyboard, touch, warp-back and enemy AI turning. Called right after the
  player's and each enemy's heading is written. **Purely cosmetic** — heading/physics/aim/collision read
  `heading`/`mesh.position`, never the bank. New visual scenario `13-ship-bank` (visual suite now 13/13).
- **Real low-poly models for the rocketeer, medium, and first boss.** Ran three new sources
  (`assets-src/enemy_2|3|4.glb`) through `assets:build` and pointed three enemies at the resulting
  **combat** glbs in `catalog_seed.js`: **rocketeer** (`basic rocket enemy`) → `enemy_2_combat`,
  **medium** (`basic mini boss`) → `enemy_3_combat`, **first boss** → `enemy_4_combat`. Each got
  `modelYaw: Math.PI` (the pack faces `-Z`, like `enemy_1`). No size change needed — `applyShipModel`
  normalizes every model's longest axis to a fixed base and the existing `sizeScale` (rocketeer 1 /
  medium 2 / boss 3) sets the in-game scale, so the medium/boss stay their current size automatically.
  The L4 pirate variants that *shared* these looks now diverge: **advanced medium pirate** still uses
  `heavy.glb` and **second boss** still uses `boss.glb`; `rocketeer.glb` is now unused (kept as a
  fallback primitive). Local-only so far: combat glbs copied into `client/assets/ships/` for testing;
  **not yet pushed to S3** (`assets:push`) — the hashed `modelUrl`s won't pass `assets:check`/CI deploy
  until then.
- **Background music: looping sampled tracks per scene (generative synth removed).** Replaced the
  generative Web-Audio music (chord progression + arpeggio scheduler) with real **looping mp3 tracks** —
  one for the **hangar** and one for **combat** (CC0, stereo ~18–20 s). Routed through the same DB map as
  SFX under a new **`entity: 'scene'`** (`(scene,'hangar','music')` / `(scene,'combat','music')`); the
  `sound_map` PK widened to `(entity,class,event,sound_key)` so a scene can hold **several tracks played at
  random** (migration `014_sound_map_multi.js` + postgres; `sound_map` is now rebuilt each startup). The
  audio engine plays a random track on the music bus, **crossfading** (~0.8 s) on scene change; a
  single-track scene loops seamlessly, multiple tracks chain at random (no immediate repeat); a track not
  yet decoded starts via the preload hook. New `setMusicTracks()`; the client passes per-scene lists from
  the DB map (`tracksFor`). Add more tracks later = drop the mp3, add a `SOUNDS` row + a `SOUND_MAP`
  `(scene,…, 'music')` row. Verified: client 40, server 50 (+migration 014), assets:check (10 assets),
  visual 12/12.
- **SFX routing moved into the DB (sound classes + a sound_map table).** Removed all hardcoded sound
  routing from the client so adding ships/weapons never touches `index.html`
  (`docs/plans/sound-classes-and-mapping.md`). New tables: **`sounds`** (asset registry: `key → url + gain`)
  and **`sound_map`** (`(entity, class, event) → sound key`); seeded from `SOUNDS`/`SOUND_MAP` in
  `catalog_seed.js` (idempotent upsert, both sqlite migration `013_sounds.js` + postgres). Each ship and
  weapon now carries a **`stats.class`** (ship `fighter`/`capital`/`player`; weapon `kinetic`/`cannon`/
  `rocket`). New `GET /api/sounds` returns the registry + map; the client (`bootstrap`) builds a resolver
  `sfxFor(entity, class, event)` and the fire/death/hit/detonation call sites look the sound up instead of
  naming it inline. **Deleted `client/src/sfx_manifest.js`** (its key→url job is now the `sounds` table);
  `assets:check` + the `12-audio` scenario now source URLs from `catalog_seed.SOUNDS`. Behavior is
  unchanged (same sounds as before); only the wiring is data-driven. Verified: client 40, server 50 (+
  migration 013), `assets:check` (8 assets), visual suite 12/12.

## 2026-06-23

- **Sampled SFX: rocket launch, cannon, player-ship hit, ship explosions (+ blast).** Processed new CC0
  source clips (Freesound; ffmpeg → mono mp3, content-hashed, pushed to S3 `sfx/`), all routed through the
  sample layer with a synth fallback: **`rocket`** — launch whoosh (trimmed 2.3 s) on the player's rockets
  (ids 3/8, `stats.sfx`); **`cannon`** — on the `Heavy cannon` (id 6, `stats.sfx`); **`shipHit`** — kinetic
  impact when the **player's** ship is struck (`audio.sfx.hit('shipHit')`; enemy hits stay synth);
  **`shipBoom`** — death boom for **medium/large** ships (`sizeScale ≥ 2`) **and the player's destruction**
  (trimmed 2 s, pitched down for the largest); **`blast`** (first 0.7 s of blast.flac) — **rocket
  detonation + small-ship** death (`sizeScale < 2`). Added `kind` sample support to `sfx.rocket/hit/
  explosion` in `audio.js` (were synth-only); registered the hashed urls in `sfx_manifest.js`. Verified:
  `assets:check` (all sfx on S3) + the `12-audio` visual scenario decodes every clip. **All sounds are
  CC0 1.0** (downloaded via the Freesound CC0 filter), recorded in `CREDITS.md`.
- **Settings modal fits on phones (no overflow).** Fixed the modal spilling off narrow screens: the
  volume **sliders were fixed-width (`flex: 0 0 210px`, shrink 0)** so they ran off the right edge —
  now they're **shrinkable + capped** (`flex: 1 1 90px; min-width:0; max-width:180px`) and the labels
  can shrink too. The quality buttons were equal-thirds (`flex: 1 1 0`) which **clipped "Performance"** —
  now `flex: 1 1 auto` so each sizes to its text (Performance gets its natural, wider width). All modal
  fonts trimmed (h1 32→26, labels 19→16, toggles/seg/note down a step), horizontal padding `clamp`ed for
  small screens, and the box got `max-height: 92vh` + `overflow-y:auto` as a safety net. Verified at
  360px width: box 320px, zero elements past the edge, no horizontal scroll.
- **Kinetic gun SFX: quieter + more reliable loading.** Re-baked the kinetic sample ≈10 dB quieter (it was
  louder than the synth SFX it replaced) — the level is baked into the mp3 (new content hash), no runtime
  knob. Also made the sample preload fire on the **first user gesture** (decode works on a still-suspended
  AudioContext) instead of waiting for the context to report running, so the sample is ready before the
  first shot. Old orphaned sfx mp3s pruned from S3.
- **Graphics quality: reload-on-change + a mobile layout fix.** Two fixes after a phone playtest. (1) On a
  narrow screen the High/Balance/Performance buttons overflowed the settings modal — the row now **stacks**
  (label on its own line, the 3 equal-width buttons share the row below; they shrink to fit). (2) Picking a
  tier now **reloads the page** instead of applying live: antialias is a `WebGLRenderer` constructor arg, so
  the old "applies after reload" half-state meant the AA cost never dropped without a manual reload — a
  Galaxy A03s tester saw "no FPS change." Reload guarantees the whole preset (AA + pixel ratio + density)
  applies cleanly; progress is server-side so it just returns to the menu. Verified on an emulated phone:
  Performance → pixel ratio 1 **and antialias off**. Note + i18n updated ("Changing quality reloads the
  game"). Also documented the measurement caveat: FPS is vsync-capped and the gear pauses the fight, so the
  overlay reads ≈60 on every tier in the menu — judge tiers during combat, not in the paused menu.
- **Sampled SFX layer + audio asset pipeline — first real sound.** The audio engine
  (`client/src/audio.js`) gains an optional sample layer alongside its procedural synth: `preloadSamples()`
  fetches + decodes content-hashed mp3s into a buffer cache, and `sfx.shoot('kinetic')` plays the sample as
  a `BufferSource` on `sfxGain` (with a per-shot pitch jitter so rapid machine-gun fire reusing one clip
  isn't robotic), falling back to the synth zap if the buffer is missing. Weapons opt in **data-driven** via
  `stats.sfx` in `catalog_seed.js` (`Basic kinetic` 1, `Machine Gun` 5, `Heavy Machine Gun` 7 → `kinetic`),
  read as `w.sfx` at the fire site (`fireMount` in `index.html`); enemy fire stays synthesized. The first
  sound is a **CC0 glock shot from Freesound** (serutonin-deprivd), one shot extracted + tail-trimmed +
  loudness-normalized to a 0.22 s dry transient (ffmpeg). New manifest `client/src/sfx_manifest.js` pins the
  hashed url (the audio analog of a ship's `modelUrl`). Plan: `docs/plans/audio-sample-pipeline.md`.
- **Asset pipeline extended to audio (S3 + CI/CD).** `scripts/assets-config.mjs` gains a sounds lane
  (`PREFIX.sounds='sfx/'`, `DIR.soundsServe='client/assets/sounds'`, `soundPath()`); `assets:push` uploads
  built mp3s (`assets-dist/sounds/*.<hash>.mp3` → `sfx/`, `audio/mpeg`) + sound sources (→ `source/`);
  `assets:pull` syncs `sfx/` → `client/assets/sounds/`; `assets:check` (deploy guard) now also verifies every
  `SFX_SOURCES` url exists on S3. `.gitignore` excludes `client/assets/sounds/*.*.mp3` (no binaries in git).
  CI/CD (`ci-cd.yml`) deploy step renamed/extended to pull models **and** SFX and bake them into the image;
  the scoped read-only IAM key (`vega-assets-ci-read`) is already bucket-wide so no IAM change was needed.
  Verified end-to-end (build→push→pull→serve→decode) + the headless `12-audio` visual scenario now asserts
  each manifest sound is served same-origin and decodes. Fixed a stale `DECISIONS §21`→`§22` ref in
  `audio.js` + `index.html`.
- **Graphics quality tiers (High/Balance/Performance) — implemented.** Built the selector from
  `docs/plans/performance-quality-tiers.md` into the existing settings menu. New pure module
  `client/src/graphics.js` (+ `graphics.test.js`) holds the tier knob table and `localStorage`
  persistence (key `gfxTier`); mirrors `audio.js`. Per tier: pixel-ratio cap (2/1.5/1), antialias
  (on/off/off), star density (×1/.6/.35) and particle density (×1/.6/.4 — fewer sparks, drops the 2
  middle fireball layers + the shockwave, thins the exhaust). Targets the real mobile bottleneck —
  fragment **fill rate** (pixel ratio × two render passes × additive overdraw), not the draw
  calls/triangles the perf overlay shows. Pixel ratio + density apply **live** (the dominant lever);
  **antialias on the next reload** (constructor arg — no mid-game renderer rebuild), noted in the UI.
  **Default High**, but a touch device's **first run defaults to Balance**. Verified live: emulating a
  DPR-3 device, switching to Performance drops the backing buffer from ×2 to ×1 immediately. Added the
  five `ui.settings.quality*` strings (EN + RU). See DECISIONS §23.
- **Plan: performance quality tiers (High/Balance/Performance).** Wrote
  `docs/plans/performance-quality-tiers.md` — a graphics-quality selector in the existing settings
  menu, persisted in `localStorage`. Targets the real mobile bottleneck (fragment **fill rate** — pixel
  ratio × two render passes × additive overdraw — not draw calls/triangles). Levers per tier: pixel
  ratio cap (live), antialias (on reload), star + particle density (live). Default High; Balance on a
  touch device's first run. Not yet implemented.
- **Bigger combat zone (1.5×) + mission set-pieces relocated.** Grew the soft arena half-size `ARENA`
  from 240 to **360** (`client/index.html`), so the battlefield boundary/mini-map/OOB region is 1.5× in
  each direction (combat was never hard-clamped, so only the boundary UI grows). Shifted three mission
  set-pieces by 50 units each, moving both the set-piece (`catalog_seed.js` `home-system.setpieces`) and
  the mission's combat `center` (`server/src/missions.js`) in lockstep so each mission still spawns over
  its structure: **mining/asteroids left** (`x −500 → −550`), **research station right** (`x 350 → 400`),
  **freighter up/north** (`z −400 → −450`). (Axes: left = −x, right = +x, up = −z.)

- **Settings gear is always available + doubles as pause.** The ⚙ gear now shows at all times (including
  during a live fight), not just on menus/while paused. Opening it from gameplay **freezes the battle like
  the pause button** and opens the menu in one click (no separate pause first); **closing resumes** — but
  only when the gear is what paused it (a manual pause stays paused). Updated the `12-audio` visual scenario
  accordingly (gear available mid-fight → opening pauses → closing resumes). Also shifted the **account bar
  (Login/Sign up)** right so the always-on gear no longer overlaps it on the welcome/hangar screens (same
  treatment as the HUD Health block).

- **Brighter "hero" stars (~2% of the field).** `makeStars` now builds the starfield as two point
  layers: the dim majority as before, plus a bright ~2% (`brightFraction`, default 0.02) that stands out
  via three combined cues — a **bigger point size** (5 vs 1.4), a **soft additive glow sprite** (a
  generated radial-gradient `CanvasTexture` so they bloom into a round halo instead of a square), and a
  **near-white, full-luminance color**. The bright layer renders with `depthTest: true` (the dim layer
  stays `depthTest: false`) so the planet/moons occlude it and the additive glow can't creep onto the
  planet disk (the transparency pitfall from DECISIONS §5). Bright fraction is a `makeStars` parameter,
  easy to tune. See DECISIONS §4.
- **Audio follow-ups: cross-browser unlock fix + settings-menu polish.** (1) **Fixed "no sound on
  macOS/Safari".** Safari doesn't accept `pointerdown` as a gesture for audio and stays suspended until a
  node plays in the gesture — and the old code detached after the first (rejected) attempt. Now `unlock()`
  plays a one-sample silent "kick" buffer, and the client listens on `pointerdown`/`touchend`/`click`/
  `keydown` and **retries every gesture until the context is actually running** (verified the engine
  outputs a healthy signal once running via an analyser tap). (2) **Settings menu:** enlarged the modal
  (560px, bigger title/labels/sliders/toggles + a prominent Close), nudged the ⚙ gear firmly into the
  top-left corner, and **shifted the HUD Health block right** so the gear no longer overlaps it while
  paused. (Mute toggle confirmed working — the earlier report was a misread.)
- **Audio + a settings menu — procedural Web Audio (no asset files), with an audio settings modal.**
  Added sound to the game: synthesized SFX (player/enemy fire, bullet hits, rocket launch, ship/rocket
  explosions sized to the ship, a victory/defeat sting, UI clicks) and **generative background music**
  (layered pads + an arpeggio over a slow Am–F–C–G progression) that follows game state — a driving
  **combat** mood during a live fight, a calmer **hangar** mood on menus/overlays/while paused, with a
  short crossfade. **Everything is synthesized in code via the native Web Audio API** — no libraries, no
  audio files, nothing on the CDN, no licensing (matches the project's procedural/built-in-only ethos;
  swappable for real files later — see DECISIONS §21). The engine is new `client/src/audio.js`
  (lazy `AudioContext`, created on the first user gesture per the browser autoplay policy; a
  `DynamicsCompressor` + a polyphony cap tame stacked explosions). Added a **settings modal** opened by a
  ⚙ gear (shown on the welcome/hangar screens + while paused): **Master / Music / SFX** volume sliders +
  **Music/SFX on-off toggles**, all persisted to `localStorage` and live-applied. i18n: new
  `ui.settings.*` keys (EN + RU). Tests: `client/src/audio.test.js` (5 — settings clamp/load/save/effective
  gain) and visual scenario `12-audio` (gear → modal → slider/toggle persistence → music scene follows
  state); 33 client unit + 12 visual scenarios pass. Resolves the Phase-0 "Basic sound" item + the
  "native Web Audio vs Howler" open question (chose native).
- **Fixed the basic enemy flying backwards + restored the ship-orientation knob.** The `enemy_1` model
  on S3 was exported nose-toward `-Z` (our ships face `+Z`), so the basic enemy flew engine-first. Root
  cause: `applyShipModel` supports a per-model `yaw`, but when ships went DB-driven, `modelSpec` was
  written as `(url) => ({url, tint:false})` — silently dropping `yaw`, with no seed field to set it (and
  the asset README still documented the long-gone `SHIP_MODELS` map). Restored it as data: added a
  `stats.modelYaw` (radians) field, threaded seed → `modelSpec(url, yaw)` → `applyShipModel`, and set
  `modelYaw: Math.PI` on `basic enemy ship`. Orientation is now a runtime normalization alongside
  auto-center/scale, so a wrong-way model is corrected in the seed (one field fixes both the combat and
  hangar models), not by re-exporting/re-pushing to S3. Rewrote `client/assets/README.md` (DB-driven
  `modelYaw` + a "preview the combat `.glb` in Quick Look and confirm nose = `+Z` before `assets:push`"
  checklist). See DECISIONS §14.
- **Dev color/lighting tuning panel (`?tune`) — implemented.** Built the dev-only lil-gui panel from
  `docs/plans/color-tuning.md`. Opening the game with `?tune` shows live controls for the space
  `background` + `fog`, **sky light** (ambient/sun color, intensity, sun position) and **combat light**
  (ambient/sun color, intensity), plus a "Rebuild planet" button (re-bakes the ocean texture) and a
  "Dump palette → console" button that prints a labeled `0x`-hex snapshot saying where each value goes
  (`catalog_seed.js` descriptor vs. hardcoded in `index.html`). To reach the lights, hoisted
  `combatAmbient`/`skyAmbient`/`skySun` to module scope and recorded `currentMapDescriptor` in
  `buildMap`. **Default build unchanged:** lil-gui is dynamically imported only inside the `?tune`
  guard, so players never fetch it (verified via Network in a headless render; all 11 visual scenarios
  still pass). See DECISIONS §21.
- **Plan: dev color/lighting tuning panel (`?tune`).** Wrote `docs/plans/color-tuning.md` — a dev-only
  lil-gui panel (gated by `?tune`, dynamically imported so players never fetch it) to live-tune the
  space backdrop + sky/combat lighting and dump the chosen values for baking into
  `catalog_seed.js`/`index.html`. Chosen over a player-facing brightness setting (per-element control +
  exact export + zero combat-readability risk). Not yet implemented.
- **Smooth camera zoom.** Zoom input now sets a *target* and the camera eases toward it over ~0.2 s
  (frame-rate-independent exponential, `tickZoom` in the frame loop) instead of jumping instantly —
  smoother for wheel notches, button taps, and pinch alike. Saved/restored zoom still applies at once
  on load (no ease-in on boot).
- **Camera zoom in/out (PC + mobile).** Implemented `docs/plans/zoom-controls.md`. The player can now
  zoom the combat camera: **PC** via the mouse **wheel** (scroll up = closer) and on-screen **＋/−**
  buttons; **mobile** via the **＋/−** buttons and two-finger **pinch**. Zoom scales the fixed camera
  offset (`CAM_OFFSET`) along its angle within `0.6–2.2×` — the near-vertical, non-rotating angle, FOV,
  and camera type are unchanged. The level is **persisted** across runs (`localStorage` key `camZoom`).
  The ＋/− buttons sit at the right edge (vertically centered, `#zoom`, hidden on menus via `body.menu`);
  wheel/pinch listen on the canvas so the hangar shop still scrolls with the wheel on menus and pinch
  (scoped to `targetTouches`) never fights the steering stick. All inline in `client/index.html`.
- **CLAUDE.md: "plans go to `docs/plans/*.md`" rule + zoom-controls plan.** Added a rule that when the
  user asks to *plan* (not implement), the plan is written to a self-contained, executable
  `docs/plans/<name>.md` (exact file paths/anchors, decisions inline) so it can be handed to another
  terminal/agent — planning-only means write the plan file and change nothing else. First application:
  `docs/plans/zoom-controls.md` (camera Zoom-In/Out for PC + mobile — not yet implemented).
- **Lighter, slightly bluer space backdrop.** Nudged the `home-system` map background from near-black
  `0x05060d` to a faint blue-cyan `0x0a1624` (blue/green lifted more than red) — a subtle lift toward
  blue/light-blue. The combat scene's `Fog` color (`client/index.html`) was moved to match so distant
  asteroids still fade cleanly into the backdrop.
- **CLAUDE.md: "locate code via SUMMARY first" rule.** Added a read-first rule so we consult
  `docs/SUMMARY.md` (the map → exact files) before grepping/Explore-ing the codebase, falling back to
  broad search only when SUMMARY + the relevant `docs/plans/*.md` don't pin the location down (and
  treating that as a SUMMARY gap to fix).
- **Player-data reset tooling (CLI + skill).** Added a reusable way to wipe *progress* without
  touching the catalog, replacing the ad-hoc "delete `game.db`" step. `server/src/reset.js`:
  `--player <id>` resets one player (games, ships, stash, events → baseline; **account, login &
  language kept**; starter ship re-granted) via per-backend SQL DELETEs; `--all --yes` wipes every
  player-scoped table (SQLite `DELETE` + `sqlite_sequence` reset / Postgres `TRUNCATE … RESTART
  IDENTITY CASCADE`) for a fresh DB, catalog re-seeds on startup. Both modes are `resetPlayer` /
  `resetAllPlayers` in `db.js` + `db_postgres.js`, re-exported via `datastore.js`. Wrapped by the new
  `reset-progress` skill (`.claude/skills/`). Backend auto-selected by `DATABASE_URL` (local SQLite by
  default — prod is only touched if it's set). See DECISIONS §19. (All 50 server tests still pass.)
- **Repair drones 3× faster — once-per-second cadence.** Repair drones now tick every **1 s** instead of
  every 3 s, healing the same HP per tick → 3× the regen rate (`catalog_seed.js` `intervalSec` 3→1). To
  keep the upgrade ladder intact at the new cadence, the tiers' per-tick HP was scaled so each stays 3× its
  old rate: **Repair drone** id 12 → 1 HP/s, **Repair drone II** id 19 → 1.5 HP/s, **Nanobot repair** id 20
  → 2 HP/s (caps/weights/prices unchanged). Updated the `repairTick` tests to the 1 s interval. Also did a
  **full wipe of the local SQLite DB** (`server/data/game.db` deleted; schema + catalog reseeded on restart).
- **First real model through the pipeline: basic enemy ship → `enemy_1` (recolored), + "model defines the
  look" rule.** The `basic enemy ship` now uses a sourced `.glb` (`enemy_1`) instead of the `fighter.glb`
  primitive — built/pushed via the asset pipeline (combat on S3 `ships-combat/`, hangar on the CDN; URLs in
  `catalog_seed.js`, `assets:check` green). The model's **black body material was recolored to dark-grey**
  *in the glb itself* (gltf-transform `@gltf-transform/core` material edit), not at runtime. **Codified the
  rule:** a ship's appearance comes from its **model, never a `color` tint** — `applyShipModel` loads with
  `tint: false`, and `stats.color` is only metadata (radar markers/mini-map + explosion + the loading
  placeholder). A brief experiment that tinted enemy models by `color` was reverted. Consequence (noted in
  SUMMARY/DECISIONS §14): enemies that *reuse* a base model (pirate gunner, advanced medium pirate, Second
  Boss) look like that base until a distinct model is authored — they differ only mechanically for now.

- **Asset pipeline: combat glbs are vanilla (load + Quick-Look-able); hangar uses meshopt.** Fix after the
  first build: the combat preset was `--compress meshopt` (+ GPU-instancing), which the client's plain
  `GLTFLoader` can't decode (it would fall back to the primitive) and which macOS Quick Look can't preview.
  Combat is now uncompressed/vanilla (no meshopt, `--instance false`, textures kept in their original format)
  — small via decimation + 256px textures. Hangar keeps meshopt + WebP; the client now wires
  `gltfLoader.setMeshoptDecoder(MeshoptDecoder)` so the (lazy, future) hangar high-poly models load.
  `scripts/assets-config.mjs` + `assets-build.mjs` + `client/index.html`.

- **Level 4 real balance — Advanced medium pirate, Second Boss, new waves** (`docs/plans/level-4-difficulty.md`).
  New enemy **`advanced_medium_pirate`** (`heavy.glb` recolored maroon `0x800020`, **300 hp** hull, turns
  ~+30% vs the medium, 1 Pirate MG + 2 rockets, reward 150) and the **Second Boss `boss2`** (`boss.glb`
  recolored crimson `0x8b0000`, **450 hp**, ~+30% speed/accel/turn, **2× Advanced pirate cannons + 3
  rockets**, reward 400), plus a new enemy weapon **Advanced pirate cannon** (id 10 — power 10, 1 shot/sec,
  range 110) and the new components (ids 24–28: 300/450-HP hulls, a faster medium thruster, a +30% boss
  engine/thruster — component power bumped above the headline +30% to land ~+30% NET after the heavier mass;
  all tunable). **Level-4 waves** rebuilt: `pirate gunner / rocketeer / advanced medium pirate` 40/40/20 →
  35/35/30 (maxConcurrent 5) to 8 then 16 kills → clear-out → the **Second Boss** finale. `catalog_seed.js`
  only; server tests (50) updated; new visual scenario `11-l4-enemies`.

- **Ship-model asset pipeline (local tooling + schema).** First slice of `docs/plans/ship-model-pipeline.md`.
  **Schema:** new nullable **`ships.model_url_high`** (migration 012 / PG bootstrap + idempotent ALTER) for
  the hangar high-poly model URL, wired through the seed + datastore + API (`modelUrlHigh`, null for all
  ships today). **Tooling:** repo-root `package.json` + `scripts/assets-*.mjs` — **`assets:build`**
  (gltf-transform via npx → a content-hashed combat + hangar `.glb`; verified end-to-end), **`assets:push`**
  (→ S3 `vega-sentinels-assets`, content-hashed, immutable cache), **`assets:pull`** (S3 combat → 
  `client/assets/ships/`), **`assets:check`** (drift-check / deploy guard: every pipeline `model_url*` in the
  seed must exist on S3 — a safe no-op today since all models are in-git primitives). **Policy:** no binaries
  in git (S3 canonical); `.gitignore` excludes `assets-src/`, `assets-dist/`, and content-hashed combat glbs.
  **Infra wired:** created the scoped **read-only IAM user `vega-assets-ci-read`** (S3 GetObject/ListBucket
  on the bucket only — verified read-allowed / write-denied), stored its key as GitHub secrets
  `ASSETS_AWS_ACCESS_KEY_ID`/`ASSETS_AWS_SECRET_ACCESS_KEY`, and added an `assets:check` + `assets:pull` step
  to the **`ci-cd.yml` deploy job** (before rsync/build, gated on the secret) so combat models are baked into
  the image. All a safe **no-op today** (no real models yet). **Remaining:** produce the first real model.
  See DECISIONS §14.

- **Level 4 — "Find the pirate base."** New campaign level after L3 (`docs/plans/level-4-find-the-pirate-base.md`),
  appended to `LEVELS` in `catalog_seed.js` (gets the next level id; `advance` is gap-tolerant). Clearing L3
  now **advances into L4 and shows its briefing** — fixing the "L3 victory text lingers" symptom (there was
  no next level before). The L4 briefing is text + a new **`unlockShop` briefing action** (added to both
  backends' `applyBriefingActions`) that opens the hangar shop + side missions on reaching L4 — i.e. still on
  clearing L3, the original campaign milestone (the old "unlock on advancing off the last level" stays as a
  fallback). L4 is clearly harder than L3: **pirate gunners + more heavies** (40/35/25 → 30/25/45 to 12/24
  kills) + the **upgraded boss**; its victory sets up the planned L5. New EN+RU `level.4.briefing` /
  `level.4.victory`. Server tests updated (progression now L1→L4; L4 briefing unlocks the shop; L4 served).

- **Mission set-pieces spread further apart + resized.** Per playtest, in the shared `home-system` world:
  the **asteroid field** moved 100 further left (`x` −400→−500), the **research station** 150 further right
  (`x` +200→+350) and **1.5× smaller** (scale 0.9→0.6), and the **freighter** 100 further "up"/north
  (`z` −300→−400), **1.5× smaller** (0.5→0.33) and faster (cruise `speed` 1→2). Mission `center`s updated
  to match (`missions.js`) so each still spawns the player over its structure. `catalog_seed.js` + `missions.js`.

## 2026-06-22

- **One shared world: all set-pieces on every mission.** Per request — a single unified map that differs
  only by *where you fight*. Moved the three set-pieces (asteroid field + mining rigs, research station,
  freighter) back into the `home-system` map at **fixed, far-apart world positions** (so they don't pile
  up), where they exist on **every level/mission**; a side mission's `center` just spawns the player + arena
  over the matching structure (the others sit at a distance). Dropped the per-mission `setpieces` from the
  generator (`missions.js` now carries only `center`); the client rebuilds the map's set-pieces each run so
  the cruising freighter resets (`mapSetpieces`). Visual `09-mission-setpieces` rewritten (all three present
  on each mission; the mission's own one is centered). `catalog_seed.js` + `index.html` + `missions.js`.

- **Freighter mission set-piece reworked.** Per playtest: the freighter is **much smaller** (scale
  1.1→0.5), **a touch deeper** (−28→−48), and now **cruises slowly forward** (~1 unit/sec, a transport in
  transit) via a new `speed` param in `makeFreighter` (distinct from the unused zone-drift escort mechanic).
  Client + `missions.js`.

- **Research mission set-piece reworked.** Per playtest: the research station is now **smaller**
  (scale 1.3→0.9), **a touch deeper** (−95→−125), and has a **light tilt** (`tilt` 0.35 rad) so the ring
  reads as a 3D wheel from the top-down camera instead of a flat circle; it now spins around its own
  (tilted) axis (`rotateY`). New `makeResearchStation` `tilt` param. Client + `missions.js`.

- **Mining mission set-piece reworked.** Per playtest: the asteroid-field now has **two tilted mining
  rigs** (each a host rock + a station + a beam) instead of one; the rigs are **tilted off vertical** so
  the beam reads from the top-down camera; **1.5× the rocks** (16→24) with **2× the spacing** (`spread`
  120→240, shallower vertical scatter to stay below the plane); placed a touch deeper (~-100). New
  `makeAsteroidField` params: `beamTilt`, multi-rig. Client (`index.html`) + `missions.js`.

- **Each side mission fights at its own location with its own set-piece, pulled close to the plane.** Fixes
  the side missions all running at the campaign spot with the asteroid field/station/freighter piled
  together. Now each mission descriptor carries a **`center`** (mining `(-400,0)`, research `(200,0)`,
  freighter `(-100,-300)`) — the player + arena (soft boundary, mini-map, warp-back) start there — and the
  client **builds only that mission's set-piece** at the center (the campaign map no longer carries
  set-pieces; set-piece materials are fog-exempt, so building only the active one prevents overlap). The
  set-pieces now sit **just below the combat plane** (tops ~20 below the ships) instead of ~500 down, so you
  fly over them with strong parallax like the background asteroids; they're **static** (no drift — the
  drift mechanic stays in code for a future escort mission). Touches `catalog_seed.js` (set-pieces off the
  map), `server/src/missions.js` (per-mission `center` + `setpieces`, compact mining station),
  `index.html` (`reset()` centers the zone + builds the mission's set-piece). Visual `09-mission-setpieces`
  rewritten to launch each mission and assert its lone, centered, just-below-the-plane set-piece (no drift).

- **Side-mission board (3 missions) + pirate enemies + boss buff.** First slice of
  `docs/plans/mission-generator.md` (2a) and `docs/plans/mission-enemies-difficulty.md`. **(1) New enemy
  content** (`catalog_seed.js`): **Pirate machine gun** (weapon id 9 — long-range 90, rapid-fire, low
  damage), **Pirate hull** (id 22, 36 HP) + **Pirate engine** (id 23, top speed +50%), and the **pirate
  gunner** enemy (`role: pirate_gunner`, 1× long-range MG, deeper-crimson, reward 40). The **"first boss"
  guns are swapped** from basic-kinetic to two Pirate machine guns — also buffs the level-3 boss (intended).
  **(2) Mission generator** (`server/src/missions.js`) emits **3 flavored side missions** (mining /
  research / freighter), all the **same difficulty** (40/40/20 → 35/35/30 gunner/rocketeer/heavy, then a
  **2-boss finale**). **`GET /api/players/:id/missions`** returns them, gated behind the campaign-clear
  (same gate as the shop). **(3) Client UI** (provisional): **3 buttons top-right** (Mission 1/2/3) on the
  menus once unlocked; clicking opens a **panel** with the mission's flavor description + est. reward and a
  **Take off** button. Playing a mission reuses the `levelRunner` and **banks per-kill ×2 credits like a
  level but does NOT advance the story counter** (repeatable grind). New EN+RU i18n (`ui.mission.*`,
  `mission.*`). Tests: server `missions`/`catalog` cases (49 total); visual `10-mission-board`. (Next per
  the plan: server-sealed rewards, richer objectives, per-mission set-piece environments.)

- **Mission set-pieces — asteroid field + mining beam, freighter, drifting arena.** Phases 2–3 of
  `docs/plans/mission-maps.md`. **(1)** New **`asteroid-field`** set-piece: a cluster of **irregular,
  cratered** rocks (noise-deformed icosahedra so they're lumpy not round, `makeMoonTexture` craters,
  varied sizes — distinct from the round parallax-backdrop asteroids), a big host rock with a small
  **mining station** and a **mining beam** (a particle stream flowing host→collector); rocks tumble.
  **(2)** New **`freighter`** set-piece: a cargo ship (spine + containers + bridge + engine block/nozzles)
  with a **fiery exhaust** particle stream (hot→orange→red). **(3)** **Drifting arena:** the soft
  boundary, warp-back and mini-map now compute relative to a movable **`arenaCenter`**; a map descriptor
  `drift` `{x,z}` pans the zone, the edge marker follows, warp-back returns to the drifted center, and a
  `sync` set-piece (the freighter) tracks it — wired for a future escort mission (no campaign map drifts
  yet). All three are decor-only (not collidable). Seeded into `home-system`; client (`index.html`) +
  seed (`catalog_seed.js`); visual `09-mission-setpieces` extended (all three built + screenshotted, drift
  verified). DECISIONS §17 updated.

- **Mission set-pieces (procedural) — research station.** First slice of `docs/plans/mission-maps.md`:
  the map descriptor can now carry a **`setpieces`** array of large structures generated **in code** (no
  `.glb`). They're added to the **combat scene** (lit from above by the combat sun, like the ships),
  sit **~500 below the combat plane** (real depth → render behind the ships; `fog: false` so they stay
  readable), and are **pure decor** — not in the gameplay arrays, so bullets pass through and the AI
  ignores them. `buildSetPiece` dispatches per `type` to a builder; the render loop ticks each
  set-piece's `update(dt)`. Built the **`research-station`** (hub + flat ring on spokes, two solar-panel
  wings, docking modules, emissive windows; slow spin), seeded into `home-system` lower-right below the
  plane (scale 1.3). Client (`index.html`) + seed (`catalog_seed.js`); new visual scenario
  `09-mission-setpieces`. (Next per the plan: irregular/cratered asteroid field + mining beam, then the
  drifting freighter + arena drift.)

- **Combat works out of bounds + distant asteroid field.** Follow-up to the soft boundary: **(1)** removed
  every remaining hard clamp to the arena — enemies are no longer pinned inside ±240 (dropped the
  `clampToArena` call + the now-unused function), they spawn in the ring around the player even when it's
  out of bounds (no spawn clamp), and bullets/rockets are no longer culled at the boundary (limited only by
  their range/hits). So the player can fight normally past the edge. **(2)** Reworked the asteroid layer into
  a **distant ring well outside the arena**: `makeAsteroids` now takes the descriptor object and scatters
  rocks in an annulus (`inner`..`spread` radius) instead of a square, with `minSize`/`maxSize`/`depth`
  params; the `home-system` seed makes them **smaller** (≤0.5) and scatters **2000** of them across the
  whole disk (`inner` 0 → `spread` **1000**) — inside the arena and far beyond it, the far edge fading into
  the fog (~600). Client (`index.html`) + seed (`catalog_seed.js`); visual scenario `08-arena-boundaries`
  extended (enemy spawns + stays out of bounds).

- **Soft arena boundaries + mini-map.** Replaced the hard wall at ±240 (which zeroed the player's
  velocity and read as a bug — the ship stuck to an invisible edge) with a **soft boundary**: the player
  now flies past the edge freely. A faint glowing **edge marker** (a Line at ±240, additive blend, brightens
  as you approach/cross) makes the battlefield bounds visible. After the ship is **2 s continuously out of
  bounds** (`OOB_WARN_DELAY`) a centered HUD **warning + countdown** appears ("You've left the battlefield —
  return to the combat zone" / "Returning in {seconds}s"); re-entering clears it. After **30 s** out
  (`OOB_RETURN_TIME`) the ship **auto-warps back to center** — velocity zeroed, replaying the enemy warp-in
  grow animation so it reads as intentional. Added a corner **mini-map/radar** (bottom-center, non-interactive)
  showing the arena square, the player (heading triangle, clamped to the radar edge so it stays visible OOB,
  red while out), and type-colored enemy dots; it **complements** the existing off-screen edge arrows.
  **Enemies are still hard-clamped** inside the arena — only the player gets the soft boundary. New EN+RU
  i18n (`ui.oob.warning`, `ui.oob.countdown`). Client-only (`index.html` + locales); new visual scenario
  `08-arena-boundaries`. Supersedes the boundary behavior in DECISIONS §2. (`docs/plans/arena-boundaries.md`.)

- **Mobile hangar fixes.** **(1)** The welcome/hangar screens now **scroll** — on short/landscape viewports
  the shop bay made them taller than the screen and the **Take off** button was clipped/unreachable; added
  `overflow-y:auto` and top-aligned layout under `@media (max-height:600px)` so you can scroll down to launch.
  **(2)** New touch-only **"Full screen"** button (welcome / hangar / pause overlay) that re-enters fullscreen
  on demand — after minimizing the app and coming back, the browser chrome (URL bar, tabs) reappears, and
  this re-hides it. Gated by a `body.touch` class; new `ui.fullscreen` i18n (EN "⛶ Full screen" / RU
  "⛶ Во весь экран"). Client-only (`index.html`); new visual scenario `07-mobile-hangar` (short viewport →
  hangar scrolls, Take off reachable; Full-screen buttons present + touch-gated).

- **Shop "Owned ×N" badge.** Each shop item the player already has shows a green **"Owned ×N"** badge next
  to its name, where N = how many are **equipped on the active ship + sitting in the stash** (`ownedCount`
  sums `activeShip.components`/`loadout.mounts` matches + stash qty). New `ui.shop.owned` i18n (EN "Owned
  ×{n}", RU "В наличии ×{n}"). Client-only (`index.html`); visual scenario `05-hangar-shop` asserts the
  badge for owned weapons.

## 2026-06-21

- **Paused overlay.** While paused, a large centered **"Paused"** label with a **▶ Play** button (resume)
  now shows over the frozen battlefield (button is the only interactive part; the rest passes through).
  Complements the top ⏸/▶ toggle — either resumes. New `ui.pause.paused` / `ui.pause.play` i18n (EN
  "Paused" / "▶ Play", RU "Пауза" / "▶ Продолжить"). Client-only; visual scenario `06-pause` extended to
  assert the overlay + Play.

- **Pause button.** Added a ⏸/▶ toggle at the top (between the *Vega Sentinels* wordmark and the Credits
  HUD) that **freezes the whole fight** — the render loop skips the sim `update()` while paused, so
  enemies, bullets, rockets, cooldowns, repair regen and spawns all stop (the frozen frame keeps
  rendering); the label flips to ▶ to resume. Only active during a running fight (hidden on menus; below
  the result overlay); a fresh run starts unpaused (`reset()`). **Mobile auto-pause:** on touch devices
  the fight auto-pauses when the browser/tab loses focus (`visibilitychange`/`blur`). New `ui.pause.*`
  i18n (EN "Pause"/"Resume", RU "Пауза"/"Продолжить") for the button's aria-label/tooltip, re-localized on
  live language switch. Client-only (`index.html`). New headless visual scenario `06-pause` (asserts the
  world freezes while paused and advances again on resume). **Pause is single-player/client-side — flagged
  for rework when multiplayer lands (DECISIONS §16).**

- **Catalog balance-tuning pass.** Playtest tuning on the shop ladder + combat values (`catalog_seed.js`):
  new **Advanced thrusters** (id 21 — power 3.0 / weight 5 / 2500), a buyable turn upgrade. Engine bump:
  **Ion engine** power 16→**18**. Starter-gear prices: Basic engine 300→**500**, Basic thrusters
  200→**400** (Basic hull 300, Repair drone 500 unchanged). Weapon balance: **Rocket (homing)** power
  50→**60** / health 30→**10** (now downed by a single Machine Gun burst), **Heavy rocket** power 80→**90**
  / health 40→**20**, **Heavy cannon** power 20→**25**; enemy nerfs — **Kinetic (enemy)** 5→**4**, **Rocket
  (enemy)** 30→**25**. Renames (final): id 15 *Racing → **Solid-fuel engine***, id 7 *Plasma repeater →
  **Heavy Machine Gun***. (catalog_seed.js also reformatted to multi-line objects.) Server tests updated
  (18 components, new prices); 47/47 green.

- **Hangar bay readability pass (sizing + button placement).** Enlarged the shop UI per request: the
  **Loadout / Stash / Shop screen switchers** and all **Stash + Shop item text** (and the Shop type-list
  column) are **2×**; **Loadout** item text is 2× with **1.5× buttons**; the **final-characteristics panel
  labels** (ship HP/accel/turn/weight) are **1.5×**. Action buttons (**Unequip / Sell / Install / Buy**)
  moved **into the item header row**, with the **(i)** attached right after the title and the price /
  slot tag + buttons pushed to the **right end** (`[name][i] … [meta][buttons]`; no longer a separate row
  below). Item **characteristics reveal only on tapping the (i)** (no hover reveal), keeping rows clean.
  The whole bay is **`zoom: 0.9`** (10% smaller overall). Client-only (CSS + `itemCard` markup in
  `index.html`); the header row wraps if a card gets cramped. Visual suite green.

- **Cheap starter prices + full hover stats.** The previously-free **starter gear** now has cheap,
  buyable prices so the shop ladder starts low instead of hiding them: Basic hull **300**, Basic engine
  **300**, Basic thrusters **200**, Repair drone **500**, Rocket (homing) **600**, Basic kinetic 800. The
  **Machine Gun** is the exception at **1500** (it's strong in a fight, so not cheap). The shop's item
  characteristics on hover/(i) are now **comprehensive** — for weapons that means **damage, rate of fire /
  reload, projectile speed, range, blast, weight** (previously only damage + RoF + weight); engines show
  top speed, repair drones show heal/cap. New stat-label i18n keys (`ui.shop.stat.speed|range|reload|blast|
  maxspeed|heal|cap`, EN + RU), and the stats reveal on hover (desktop) as well as the (i) tap (touch).

- **Engine names swapped.** The two shop engines traded names so **Ion engine** is now the premium
  top-tier (id 16 — power 16, light, 6400) and **Racing engine** is the cheaper T2 (id 15 — power 14,
  1400). Stats/prices/ids unchanged — names only (`catalog_seed.js`). (Re-seeding can't swap two
  `UNIQUE` names in place, so the local dev rows were dropped to re-insert fresh; prod inserts fresh on
  first deploy, so no migration is needed.)

- **Economy + shop v2** (`docs/plans/economy-shop-v2.md`). Three fixes. **(1) Doubled all ladder prices**
  — v1 anchored to ~2700 but each level clear **doubles** that run's Earned (`earned *= 2`), so the real
  first-shop budget is ~4300 (flawless) to ~5800 (with retries); prices were ~half what they should be.
  New prices: Heavy hull **6000**, Racing engine 6400, Nanobot 7000, Plasma repeater 6000, Heavy rocket
  2600, Heavy cannon 2000, Repair II 1800, Ion engine 1400, Basic kinetic **800**. The Heavy hull is now
  the aspirational big buy (needs a retry or two — confirmed intentional). **(2) Shop UI rework** — the
  hangar bay's Loadout / Stash / Shop are now **separate nav-switched screens** (not cramped side-by-side
  columns); the **Shop is a two-pane screen** (a type list — Hull / Engine / Thrusters / Repair / Weapon —
  → the items of the selected type on the right); and the **type-label / (i)-icon overlap is fixed** (item
  cards now lay name → meta → (i) in a flex row, name ellipsizes). **(3) Game-over "Back to Hangar"** — once
  the shop is unlocked, the **death overlay** offers a secondary **Back to Hangar** button (banked credits
  already applied) beside Restart, so the player can re-shop/change loadout instead of an instant retry;
  before unlock (the L1–L3 campaign) only Restart shows. New `ui.gameover.back_to_hangar` (EN "Back to
  Hangar" / RU "В ангар"). Server **47** (price assertions updated); client **28**; visual `05-hangar-shop`
  extended (nav screens, two-pane shop, death → Back to Hangar) — all green.

- **Catalog expansion + pricing** (`docs/plans/catalog-economy.md`). Seeded the **player shop ladder**
  with draft (strawman) prices anchored to the ~2700-credit first-shop budget. New **components**: **Heavy
  hull** (id 13 — 200 HP / weight 50 / 3000, the upgrade "ship": 2× HP for accel ~6.2 / turn ~1.2),
  **Ion engine** (id 15 — power 14 / 700) + **Racing engine** (id 16 — power 16, light / 3200), **Repair
  drone II** (id 19 — 1 HP / 2 s / 85% / 900) + **Nanobot repair** (id 20 — 2 HP / 3 s / 90% / 3500). New
  **weapons**: **Heavy cannon** (id 6 — power 20, slow / long range / 1000), **Plasma repeater** (id 7 —
  power 12, high RoF / 3000), **Heavy rocket** (id 8 — homing, power 80, slow reload, big blast / 1300).
  Existing **Basic kinetic** (id 1) now **priced 400** (granted into the stash on unlock; sells ~300 toward
  the hull). Upgrades are **mass trade-offs, not power-creep**; thrusters are intentionally left out of the
  shop. All via `catalog_seed.js` (idempotent re-seed on startup — no migration). **Shop now lists only
  buyable items (`price > 0`)** so the curated ladder shows and enemy/starter parts stay hidden; new
  `ui.shop.empty_shop` i18n string (EN + RU). Tests: server **47** (+2: real-price buy/sell/overspend-402,
  ladder seeded; updated catalog counts 17 components / 8 weapons); visual `05-hangar-shop` still green.

- **Hangar shop + stash** (`docs/plans/hangar-shop.md`). The "spend" side of the economy: a player
  **stash** (inventory) plus **buy / sell / equip / unequip**, all **server-authoritative + transactional**
  (no double-spend / item dupe). New `stash` table (qty model, keyed by `(player_id, kind, ref_id)`,
  `kind ∈ {component, weapon}`; SQLite **migration 011_stash.js**, mirrored in the Postgres bootstrap);
  a top-level **`price`** column on `components` + `weapons` (seeded 0 — the economy is inert until real
  prices land); a **`players.shop_unlocked`** flag. Datastore methods `getStash` / `buyItem` / `sellItem`
  / `equipItem` / `unequipItem` in both backends; endpoints `GET /api/players/:id/stash` and
  `POST .../buy|sell|equip|unequip` (403 until unlocked, 400/402/409 on bad input / insufficient credits /
  conflict), each returning the refreshed `{ credits, shopUnlocked, stash, activeShip }`. **Gating:** the
  shop unlocks only after the player **clears the final level** (advance off the last level flips
  `shop_unlocked` and backfills the **basic gun (id 1)** — swapped out after level 2 — into the stash);
  `replaceWeapon` briefings now also deposit the replaced weapon. **Required slots** (hull/engine/thruster)
  can't be sold while equipped and block take-off when empty (`active-ship` now reports
  `launchable` / `missingRequired`); **optional** equipped items (weapons, repair drone) sell directly.
  Sell price = `floor(price * 0.75)`, server-computed. **Client:** a Hangar **bay** (shown once unlocked)
  with Loadout / Stash / Shop columns (text-in-rectangle items, hover/(i) stats, type filter), a **live
  ship-stats panel** (HP / acceleration / maneuverability / weight with ▲/▼ deltas vs the previous config,
  derived client-side), and a **disabled Take-off** + note while a required slot is empty. New `ui.shop.*`
  i18n keys (EN + RU). Tests: server **45** (9 new shop tests: lock/unlock, backfill, buy/sell/equip/unequip,
  optional-vs-required sell, launch gating, no double-spend, net-zero same-id equip); client **28**; new
  headless visual scenario `05-hangar-shop`. Around-model slot icons (Phase C step 10) deferred.

- **Feedback / community Telegram link** (`docs/plans/feedback-link.md`). Added a localized in-game link
  to the Phase-0 feedback channel (Telegram), shown on the **welcome screen** and the **game-over/victory
  overlay**. Both the link text and the target URL are locale values — new i18n keys `ui.community.label`
  and `ui.community.url` (EN → the English group, `ru.json` overrides both with the Russian group). The
  i18n renderer (`applyTranslations`) now also resolves a **`data-i18n-href`** attribute → `href`, so a
  live language switch updates the text and the destination together; links open in a new tab
  (`target="_blank" rel="noopener"`). Clicks fire a fire-and-forget **`community_click`** event via
  `track()` (added to the `POST /api/events` allowlist). Verified EN/RU text+href resolution headlessly;
  client/server test suites unchanged and green (16 / 36).

- **Monitoring: Sentry errors + product funnel events** (`docs/plans/monitoring.md`). **Sentry (errors
  only, `tracesSampleRate: 0`):** server via `@sentry/node` (new dep) initialized in
  `server/src/instrument.js` (imported first) + `Sentry.setupExpressErrorHandler`; browser via the
  Sentry CDN bundle loaded on demand by `initSentry()`. Both **no-op when their DSN is unset** (dev/tests
  unchanged); the public browser DSN + environment/release are served by the new **`GET /api/config`**
  (no hardcoded DSN in the buildless client). **Funnel events:** new `events` table (migration 010 +
  Postgres bootstrap) + **`POST /api/events`** (one or batched; allowlist `game_start`/`level_start`/
  `level_clear`/`player_death`/`victory`/`quit`; 204 ok / 400 junk; best-effort). Client fires them
  fire-and-forget via `track()` (`quit` uses `sendBeacon` to survive tab close) and tags Sentry's scope
  with the level. Tests: `/api/config` + `/api/events` (server now 36); verified events land via a
  headless playthrough. New env (server `.env`, optional): `SENTRY_DSN_SERVER`, `SENTRY_DSN_WEB`,
  `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`. UptimeRobot is owned separately (not in this change).
  **Activated on prod (single Sentry project for browser + server — one repo/deploy/release):** set the
  `SENTRY_*` vars in the server `.env` and recreated the container; verified the browser SDK loads/inits
  and the server has its DSN.
- **Durable Sentry release pipeline.** Replaced the static `.env` `SENTRY_RELEASE` with the
  industry-standard approach: the **git SHA is baked into the image at build time** (`Dockerfile`
  `ARG GIT_SHA` → `ENV SENTRY_RELEASE`; CI `docker compose build --build-arg GIT_SHA=<full sha>`), so
  each deployed artifact reports its own release automatically (removed `SENTRY_RELEASE` from the server
  `.env` so it no longer overrides). Both SDKs read it (server env; client via `/api/config`). Added a CI
  step (`@sentry/cli`: `releases new`/`set-commits --auto`/`finalize`/`deploys -e production`, with
  `fetch-depth: 0`) that registers the release + commits for suspect-commits/regressions. **Now active:**
  repo secrets `SENTRY_AUTH_TOKEN`/`SENTRY_ORG=tenony`/`SENTRY_PROJECT=vega-sentinels` are set, so the
  step runs on every deploy; verified by registering the live release `f13baf0…` (commit associated,
  finalized, production deploy marked). **Monitoring is fully live on prod** — Sentry (browser + server)
  errors, per-deploy release tracking, and the funnel `events` table + `POST /api/events`.
- **Monitoring-grade `/api/health`.** Upgraded the existing health endpoint into a proper uptime probe
  for UptimeRobot: it now returns **200** `{ ok, status:"ok", backend, uptimeSec, players, games }` when
  healthy and **503** `{ ok:false, status:"error", error }` when the DB is unreachable (was a generic
  500). Added `status` + `uptimeSec`; kept `ok`/`players`/`games` so the Docker healthcheck, CI smoke
  check, and visual runner are unaffected. Test updated. Point UptimeRobot at
  `https://vega.tenony.com/api/health` (alert on non-2xx or keyword `"status":"ok"`).
- **Deployed accounts + repair drone to production.** Pushed the auth + repair-drone work to `main`;
  CI/CD ran the suites (server 34, client 28) and rolled out a new container (`spacegame-app-28`,
  zero-downtime). Verified live on https://vega.tenony.com: migration 009 applied (`sessions` table +
  auth columns), repair-drone component seeded, level-3 briefing updated, `GET /api/auth/me` → 401.
  Confirmed the server `.env` has all SES vars (`SES_REGION`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `SES_FROM_ADDRESS=noreply@vega.tenony.com`, `APP_BASE_URL`), so verification
  emails send for real (not the no-op path). Verified the full SES chain via AWS CLI (profile
  `claude_admin`, account `140065018525`, us-east-1): production access enabled, sending HEALTHY, and the
  `vega.tenony.com` identity verified with DKIM signing on. Full-wiped prod player data afterward for a
  clean slate.
- **Repair drone (4th component type).** Added a `repair`-type component (`Repair drone`, id 12: heal
  1 HP every 3 s, capped at 80% of max HP, weight 4) that passively repairs the hull during combat.
  Installed on the player's ship via the **level-3 briefing** (new server action `installComponent`
  `{slot, component}`, applied once on advance, persisted in `player_ships.components` — mirrored in
  SQLite + Postgres). Level-3 briefing copy (EN + RU) rewritten to narrate the drone (was a machine-gun
  tactical hint); key `level.3.briefing` unchanged. Client: new pure `repairTick` helper in
  `components.js` (per-interval heal, multi-tick, 80% cap, banked-time cleared when topped up),
  `shipMass` now counts the `repair` slot, the player build stashes `player.repair` + `_repairAccum`,
  and the game loop ticks it during live combat only. No DB migration (uses the existing
  `player_ships.components`). Tests: updated the level-3 briefing + components-catalog server tests;
  added 6 `repairTick`/mass client tests. Docs: SUMMARY updated.
- **SES production access granted.** Amazon SES (us-east-1, account `140065018525`) is out of sandbox,
  so account-verification emails can be sent to arbitrary player addresses (no per-recipient
  verification, no 200/day sandbox cap). Updated DECISIONS §11, SUMMARY, and the AWS brief
  (`docs/plans/aws-ses-production-request.md` item #1 → done). No code change — `ses.js` already sends
  via SigV4 when creds are present.
- **Player accounts (anonymous-first, optional email/password).** Added an optional account that
  upgrades the existing anonymous player row in place (progress preserved). After clearing level 1 the
  client prompts once for a **username** + offers to **create an account** (decline → keep playing as a
  guest with the username saved). Login is by email; a small account bar on the menu screens shows the
  signed-in identity, a "verify your email to sync across devices" nudge + resend, and log out.
  - **Server (no new deps):** new `server/src/auth.js` (scrypt password hashing with per-user salt +
    `timingSafeEqual`, random session tokens stored as SHA-256 hashes, a tiny cookie parser, httpOnly
    `Secure` `SameSite=Lax` cookie helpers, a `requireAuth` middleware) and `server/src/ses.js` (Amazon
    SES send via **hand-rolled AWS SigV4 over built-in `fetch`** — no `@aws-sdk`; no-ops + logs/records
    the link to an `outbox` when creds are absent). New endpoints: `POST /api/players/:id/username`,
    `POST /api/auth/register|login|logout|resend-verification`, `GET /api/auth/me|verify`. In-memory
    per-IP rate limiting on register/login/resend; 400/401/409 validation.
  - **Schema (migration 009 + Postgres bootstrap):** `players` gains `username`, `email`,
    `password_hash`, `password_salt`, `email_verified`, `email_verify_token_hash`,
    `email_verify_sent_at` (email uniqueness via a partial unique index); new `sessions` table.
  - **Client:** account dialog (prompt / register / login modes) + status bar, `credentials:'include'`
    on auth calls, boots via `GET /api/auth/me` (prefers a session over the local UUID), adopts the
    account's player id on login and reloads progress + active ship, handles the `?verified=1` return.
    Added `ui.account.*` strings to `locales/source.json` (+ `ru.json`).
  - **Email verification** generates a hashed, 24 h token and emails a `/api/auth/verify` link that
    flips `email_verified` and redirects back into the game; resend throttled by `email_verify_sent_at`.
  - **Tests:** `server/src/auth.test.js` (5, scrypt/token/cookie units) + 9 new server integration
    tests (register/login/me/logout/verify/username/cross-device); SES stubbed via its no-creds outbox.
  - **Docs:** SUMMARY gains an "Accounts / authentication" subsection. DECISIONS §11 unchanged (the
    build follows it). AWS-side SES production access + DKIM/IAM setup remain a launch prerequisite
    (`docs/plans/aws-ses-production-request.md`).
- **Extracted enemy ship models.** Split the multi-model `client/assets/ships/lowpoly_spaceships.glb`
  (a Sketchfab export, 4 ships + a stray cylinder) into separate files `enemy_1.glb`..`enemy_4.glb` via
  gltf-transform (per-model prune + dedup; no textures, colored materials only). Verified each loads in
  Three.js `GLTFLoader` with valid geometry. **Not yet wired to any ship** (no `model_url` references them).

## 2026-06-20

- **Landing screen reflects the current level (Hangar as homepage).** On load the client now lands on the
  **Hangar** showing the **current level's briefing** when it has one (so a player who's reached level 3
  sees the level-3 briefing on refresh, not the level-1 welcome intro). New players / level-1 (no briefing)
  still get the welcome screen + ship picker. The Hangar's **Take off** now also starts the loop on first
  launch (`launchFromHangar`: sets `gameStarted`, mobile fullscreen, clears the menu overlay).
- **Hangar screen + victory "Continue".** A win now shows a **Continue** button (a loss still shows
  **Restart**/retry) that opens a new **Hangar screen** — the between-battles screen (future home for ship
  management). For now it shows the next mission's briefing in large 2× text with a **Take off** button to
  launch the next level. (The old post-victory briefing overlay became the Hangar.) Added **`level-3`'s
  briefing** (text-only, no actions): the "reach the factory / flank the slow big ships with your machine
  gun" hint. i18n: `ui.button.continue`, `ui.hangar.title`, `ui.hangar.default`, `level.3.briefing` (EN+RU).
- **Between-level briefings (data-driven message + actions).** A level descriptor can now carry an
  optional `briefing` (`{ textKey, text, actions[] }`). When a player advances **into** a level, the
  server (`advanceProgress`) runs that briefing's `actions` server-side (once — progress only moves
  forward) and returns the message; the client shows it on a new **briefing overlay** between the
  victory screen and the next run. Actions are typed/extensible (dispatched server-side); the first is
  **`replaceWeapon {from,to}`**, which swaps a mounted weapon id on the active `player_ships` loadout.
  `level-2` now narrates the weapons-factory mission and swaps the basic gun (1) → **Machine Gun** (5).
  Also fixed `buildPlayerFor` to actually use the active ship's persisted loadout/components (it was
  ignoring them), and the client reloads the active ship after advancing so the swap takes effect.
  No migration (briefing lives in the level descriptor JSON). i18n: `level.2.briefing`, `ui.briefing.title`
  (EN+RU). Verified end-to-end (beat level-1 → briefing shows → gun becomes the Machine Gun). Server tests 20.
- **New weapon: Machine Gun.** A second kinetic bullet (`weapons` id 5): power 7 (vs Basic kinetic's 10)
  but twice the rate of fire (cooldown 0.1), projectile speed 50, range 100, weight 8, tracer-yellow
  rounds. Added to the catalog seed (no migration — upserts on startup); not yet mounted on any ship.
- **Renamed the game to "Vega Sentinels" (Phase A: text).** Brand/wordmark Space Ninjas → Vega Sentinels
  (stays Latin in every locale); player in-game title Ninja → Sentinel (RU Ниндзя → Страж). Updated the
  i18n catalogs (`ui.title`, `ui.welcome.greeting`, `level.1/3.victory` values + context — keys unchanged),
  the matching `index.html` fallbacks and `<title>`, the `catalog_seed.js` victory `text` fallbacks, the
  served-client test assertion, and the README/SUMMARY/DECISIONS titles.
- **Vega Sentinels rename — Phase B (domain cutover).** The canonical host is now **https://vega.tenony.com**
  (DNS A → 178.104.91.144). Traefik now serves both hosts (`Host(vega.tenony.com) || Host(space.bagaiev.com)`,
  a Let's Encrypt cert per host), so the legacy `space.bagaiev.com` keeps working during the transition. The
  CI smoke check verifies `vega.tenony.com` first and falls back to the legacy host while the new cert issues.
  The internal `spacegame` container/image/router/deploy-dir/DB-role names are **left unchanged** (cosmetic
  churn with rollback/CI/host-move risk; the Postgres role stays for safety). Infra docs updated.
- **Money: credits currency + persistent balance.** The former "score" is now **credits** (the
  currency). The HUD shows two counters: **Earned** (credits this run — the old score, ×2 on level
  clear) and **Credits** (a persistent account balance). At the end of every run (death OR victory) the
  Earned credits are **banked** into the balance server-side; closing the browser mid-run loses the
  unbanked amount. New players start with **1000 credits**. DB: migration 008 renames `games.score` →
  `games.credits` and adds `players.credits INTEGER NOT NULL DEFAULT 1000` (no FK; Postgres bootstrap
  mirrors both, with an idempotent column rename). `POST /api/games` now takes `{ credits, … }` (still
  accepts legacy `score`), banks it, and returns the new balance; `registerPlayer`/active-ship return
  `credits`. i18n labels updated (Credits/Earned, RU Кредиты/Заработано). Verified end-to-end (new
  player 1000 → win banks earned×2 → balance persists across reload). Tests: server 19, client 22.
- **Localization (i18n): English source + Russian translation.** Player-facing text is now localized
  (EN canonical, RU first locale). New `client/src/i18n.js` (`t(key, params)` with `{var}` interpolation,
  language resolution, `loadLanguage`) + file catalogs `client/locales/source.json` (canonical
  `{key:{source,context}}`) and `ru.json`. UI strings in `index.html` moved to `data-i18n` attributes +
  `t()` calls; DB content carries i18n keys in existing JSON (`ships.stats.nameKey`, level
  `phases[].textKey`) with English kept as fallback — no content migration. Language preference persists in
  `players.language` (migration 007, `TEXT NOT NULL DEFAULT 'en'`, no FK) and `localStorage`; new endpoint
  `POST /api/players/:id/language` (validates en/ru); `registerPlayer`/active-ship return `language`.
  Selection: explicit → `navigator.language` → en; an EN/RU toggle on the welcome screen switches live.
  Verified: EN↔RU re-render (chrome + ship names + victory text), `ru-RU` browser auto-detect, and a chosen
  language surviving a `localStorage` clear via the server preference. Tests: client 22, server 18.
- **Enemy spawn animation.** Newly spawned enemies now "warp in" — they grow from a dot to full size
  over 1 s (`SPAWN_GROW_TIME`, ease-out cubic) instead of popping in at full scale. Purely visual; the
  AI runs during the grow (enemies spawn off-screen, so they're full-grown before they reach the player).
- **Per-player level progression.** Players now have a `current_progress` column (migration 006) — the
  highest unlocked level, an integer **foreign key into `levels(id)`** (enforced in Postgres; a plain
  integer in SQLite, which can't `ALTER`-add a FK column with a non-null default and doesn't enforce FKs
  anyway). Defaults to `1` (`level-1`). New API: `GET /api/players/:id/level` (the player's current
  level descriptor) and `POST /api/players/:id/advance` (unlock the next level — smallest level id above
  the current, gap-tolerant, no-op at the last). `registerPlayer` now returns `currentProgress`. The
  client loads the player's current level on boot (instead of hard-coded `level-1`), and on **Victory**
  it POSTs `/advance` then loads the newly-unlocked level so the next **Restart** plays it. Verified
  end-to-end (win level-1 → progress moves to level-2).
- **Welcome copy reworded.** The intro now reads naturally for a US audience and frames the threat as
  pirates, plus a gameplay nudge: "Pirates are raiding our home system — we need you to push them back.
  Good news: you've got a fast, nimble ship. Use that agility — keep moving, out-turn them, and don't
  let them pin you down." Points the player at the ship's maneuverability.
- **Scoring system (per-enemy rewards + level bonus).** Every enemy ship now carries a `reward`
  (`stats.reward` in `catalog_seed.js`, passed to the client): fighter 20, rocketeer 40, medium 100,
  first boss 200. The client now tracks **score** (points) separately from **kills** (the count that
  drives level thresholds): destroying an enemy adds `reward` to the score, and **completing a level
  doubles** it (the `win` phase does `score ×= 2`, shown on the Victory overlay). HUD (top-right) gained
  a **Score** readout above **Destroyed** (kills) and **Enemies**. Game over / victory report
  `{ score, kills, durationMs }`. Server test asserts the four reward values; verified end-to-end
  (level-1: 19 kills → 460 → ×2 = 920).
- **Three levels (easier on-ramp).** The old single level was a steep first experience, so it's now
  **`level-3`** and two gentler levels lead up to it (the client still plays `level-1`):
  - `level-1` (beginner): fighters only (3 at once) → 7 kills → rocketeers at 25% → 15 kills: spawning
    stops, one last rocketeer, clear → Victory. No boss.
  - `level-2` (medium): fighters only until 5 kills → fighters+rocketeers 75/25 until 15 kills → a lone
    **medium** appears as the boss → clear → Victory.
  - `level-3`: the original full fight (all three enemy types → the Sector boss).
  All seeded in `catalog_seed.js`; the smoke/combat visual scenarios no longer hard-code "4 enemies".
- **Ships are assembled from DB components (hull + engine + maneuvering thrusters).** New `components`
  table (migration 005): `name`, `type` (`hull`/`engine`/`thruster`), `weight` (→ mass), `stats` JSON —
  hull `{durability,volume}`, engine `{power → acceleration, maxSpeed, exhaust}`, thruster
  `{power → turn rate}`. Ships + player_ships got a `components` JSON ref column (`{hull,engine,thruster}`;
  player_ships overrides the ship's defaults). The client fetches `/api/components` and assembles ships
  from them; `deriveDrive` = `acceleration = engine.power × 48/mass`, `turnRate = thruster.power ×
  48/mass`. Rebalance: fighter + rocketeer share one **Light hull (30 HP, durability equalised)** + Scout
  engine + Scout thrusters (rocketeer is a touch less agile only from its extra rocket weight); the
  ex-mini-boss is `medium` (role renamed from `heavy`) — Medium hull (150 HP) + the same Scout engine +
  weak thrusters → sluggish (turn ~0.35, as before); the boss has its own heavy hull (weight 100) +
  bigger engine + thrusters tuned to **turn = 1.2× the medium** (~0.42), a heavy tank (mass 190). Player
  baseline preserved (mass 48 → accel 10 / turn 2.0). Weapon weight counts in mass. `components.js`
  trimmed to the pure drive math (dead hardcoded catalogs removed); unit tests rewritten.
  **Clarified the level pool field `weight` → `chance`** (spawn frequency, not ship mass).
  API: `GET /api/components`.
- **Welcome / start screen.** On load the game shows a welcome overlay — "Welcome, Ninja. Our home
  system is under attack. Pick your ship and help us clear it." — with a **ship picker** (cards built
  from the player-type ships in the DB, showing hull HP + weapon summary) and a **Take off** button.
  The scene backdrop renders behind it; the level doesn't start until take-off (`gameStarted` gate).
  `bootstrap()` now builds the map + an idle player and shows the picker; `takeOff()` (re)builds the
  player from the chosen ship and starts the level. The in-game HUD is hidden behind the welcome screen.
- **Mobile: FIRE and rocket buttons no longer overlap.** On touch the FIRE button sat on top of the
  rocket button (both bottom-right); FIRE moved to the left of the rocket (≈22 px gap).
- **Mobile: take-off goes fullscreen.** On touch devices, "Take off" requests fullscreen (inside the
  click gesture) so the browser address bar stops eating the screen (an issue in landscape). Works on
  Android/iPad; silently ignored where unsupported (iPhone Safari). Added `viewport-fit=cover` +
  web-app-capable meta tags.
- **Off-screen enemy markers.** For every enemy that's off-screen, an arrow on the screen edge points
  toward it, tinted by the enemy's type color. Implemented as a pooled DOM overlay (`#markers` +
  `updateMarkers`): each enemy's world position is projected to NDC; if outside the viewport, the
  direction is clamped to the screen-edge box and the arrow rotated to aim at it (with behind-camera
  handling). Hidden while a game-over/victory overlay is up.
- **Levels are data-driven (DB) + a level runner.** New `levels` table (migration 004): a JSON
  descriptor per level = a `map` + an ordered list of **phases**, seeded as `level-1` via the startup
  upsert. Each phase optionally spawns a weighted ship `pool` up to `maxConcurrent` (with an optional
  `total` cap) and advances on a condition (`kills` / `killsSincePhase` / `allCleared`); a phase with
  `event: 'win'` shows a **victory overlay** (after an optional `delay`, so the boss explosion plays
  out first — `level-1` waits 5 s). The client's `levelRunner` (a small state machine)
  replaces the old `spawnRandomEnemy`/`TARGET_ENEMIES`. `level-1` plays the designed flow: wave 1
  (fighter + rocketeer) → after 10 kills → wave 2 (adds the mini-boss) → at 20 total kills → **spawn stops**
  → clear the rest → the **boss spawns alone** → victory. New **boss ship** ("first boss": 210 HP,
  3× size, its own orange multi-color `boss.glb` model, moves like the heavy, two guns + two rocket
  launchers; spawned only in its phase). Per-ship
  `spawnWeight`/`unlockAfterKills` were removed from `ships.stats` (spawn composition now lives in the
  level). API: `GET /api/levels/:name`; `bootstrap()` fetches the level, then its map.
- **Maps are data-driven (DB).** The scene (blue ocean planet + two cratered moons + stars + parallax
  asteroids + sky lighting) is now described by a JSON **map descriptor** in a new `maps` table
  (`generator` + params), seeded as `home-system` via the startup upsert. The client builds it
  generically with `buildMap(descriptor)` — the hardcoded scene construction was extracted into
  parameterized helpers (`makeStars`, `makePlanetTexture(ocean)`, `makeMoonTexture`, `makeAsteroids`)
  + `buildMap`, and `bootstrap()` fetches `/api/maps/home-system` and builds it before the player.
  Same look, no binary assets (textures stay procedural). API: `GET /api/maps/:name`. (Step 1 of
  maps/levels; the level/wave runner + a boss + victory come next.)
- **Multiple weapons per ship (mounts + fire groups), fully DB-driven.** A ship's stats now hold
  `groups` (named fire channels — a key for the player, an AI range/aim rule for enemies) and
  `mounts` (each: a weapon id, its `group`, a lateral `offset`, and a `delay`). Firing a group fires
  ALL its mounts: `offset` puts bullets side by side, `delay` staggers a volley. The mini-boss now
  carries **two rocket launchers** firing one after another (0.2 s apart). Any number of groups is
  supported (player binds them to keys; rocket group also fires via the touch button). Weapons gained
  data-driven characteristics: bullets `maxRange`; rockets `health` (HP — reduced by a bullet's
  `power`, shot down at 0; e.g. 20 HP = two 10-damage hits), `maxRange`, plus the existing
  accel/turnRate/power/blastRadius — projectiles now despawn by distance and rockets take damage from
  gunfire (hp), instead of the old hardcoded life/instant-kill. The
  player's loadout (`player_ships.loadout`) may override `mounts` (empty ⇒ the ship's defaults). Ship
  mass now sums all mounted weapons (`shipMass`). The catalog is re-seeded by an idempotent **upsert on
  every startup** (editing `catalog_seed.js` propagates on deploy; ids/FKs preserved). Gameplay
  preserved (player still accel 10 / turn 2.0; one bullet still downs a rocket at `health` 1).
- **Ships are now generated from the database.** The client fetches the catalog (`/api/ships`,
  `/api/weapons`) and the player's active ship (`/api/players/:id/active-ship`) on startup
  (`bootstrap()`), then builds the player and spawns enemies from that data — the hardcoded client
  catalogs (`ENGINES`/`HULLS`/`WEAPONS`/`ENEMY_KINDS`) are no longer used (only the pure `deriveDrive`
  remains). New **`player_ships`** table: ships a player owns, exactly one `is_active` goes into battle;
  `loadout` JSON holds weapon ids by slot (empty ⇒ the ship's default weapons), `meta` JSON for the
  future. A new player auto-gets a default active ship on registration. Weapons are referenced **by id**
  everywhere (catalog seeded with stable ids 1–4). **Enemy spawning is data-driven**: `spawnWeight` +
  `unlockAfterKills` live in each enemy ship's stats (the mini-boss still unlocks at 10 kills), not in
  client code. The game now needs the API to start (it's always served same-origin, so it's available);
  `reportGame` stays best-effort. Gameplay is unchanged (player still accel 10 / turn 2.0). Server suite 12.
- **Ship & weapon catalog in the database.** New `ships` table (one for the player AND enemies:
  `name`, `type` = `player`/`enemy`, `stats` JSON, `model_url`) and `weapons` table (`name`,
  `type` = `bullet`/`rocket`, `stats` JSON). Seeded from a shared snapshot (`server/src/catalog_seed.js`)
  by both backends — a SQLite migration (`002_catalog.js`, schema v2) and the Postgres bootstrap.
  Ships reference weapons by name; characteristics live in the JSON `stats`. Seeded ships:
  "Basic player ship", "basic enemy ship", "basic rocket enemy", "basic mini boss". Read-only API:
  `GET /api/ships`, `GET /api/weapons` (+ tests; server suite now 11). The client still uses its own
  catalogs for now — wiring it to read from the API is a later step.
- **Ship-model pipeline (optional `.glb`).** Added `GLTFLoader` (via the `three/addons/` importmap)
  and an asset folder (`client/assets/` with `README.md` + `CREDITS.md` license log + `ships/`).
  `makeShip(color, model)` still builds the primitive immediately (shown while loading, and as a
  fallback on error), then `applyShipModel()` loads a `.glb`, auto-centers + scales it to the ship's
  footprint, optionally tints it to the ship color (keeps the color-coding) and rotates it, and swaps
  it into the same object — so all gameplay (movement, hit radius, exhaust, explosions, `sizeScale`)
  is unchanged. Models are configured in the `SHIP_MODELS` map (player + per enemy kind); all `null`
  for now, so the look is unchanged until a model is dropped in. See `client/assets/README.md`.
- **Named the game "Space Ninjas".** Set the document `<title>`, added an on-screen wordmark at the
  top-center of the HUD (the perf badge moved just below it), and updated the docs (`README.md`,
  `DECISIONS.md`) and the served-client test.
- **Minimal planet & moon textures.** The sky bodies got procedural surfaces (canvas color maps, no
  asset files). Planet (`makePlanetTexture`): a blue ocean world (base = the original water color, so
  brightness is unchanged) with depth variation and soft white clouds. Moons (`makeMoonTexture`,
  per-moon from its base color): a scatter of craters (darker floor + lighter rim ring) plus faint
  maria — albedo only, so it doesn't fight the real light. Features stay in the central latitude band
  to avoid equirectangular pole-pinching; the bodies don't rotate, so the baked maps keep the day/night
  terminator consistent.
- **Favicon** (`client/favicon.svg`, linked from `index.html`): the game's signature blue planet with
  a day/night terminator and a small moon on a deep-space tile (an SVG icon — crisp at any size; no
  rocket/ship). Colors echo the game.

## 2026-06-19

- **Headless visual / e2e test suite** (`client/visual/`, **not in CI**). Boots the real game in
  headless Chromium (Playwright, software WebGL) and asserts on **simulation state** (particle
  counts, size ratios, exhaust colors) via a `?debug`-gated `window.__game` hook — no pixel diffing
  (flaky under software rendering); screenshots are saved to `__screenshots__/` as review artifacts.
  Self-contained runner (`visual/run.mjs`): starts its own server on an isolated port + throwaway DB,
  auto-discovers `visual/scenarios/*.mjs`. Initial scenarios: smoke, ship-explosion (counts + size
  scaling + exhaust tint), exhaust-trail (enemies emit colored trails), combat. Run from `client/`:
  `npm install && npx playwright install chromium && npm run test:visual`. Kept as a stable, growing
  suite for occasional larger releases; CI still runs only the fast unit tests.
- **Engine exhaust trail on every ship.** Exhaust emission was generalized into a shared
  `emitExhaust(pos, fwd, vel, exhaust, sizeScale)` (nozzle offset scales with ship size); the player
  and **all enemies** now use it. Enemies leave a glowing trail in their engine's `exhaust.color`
  (orange for the scout-engine fighter/rocketeer, orange-red for the heavy) while thrusting forward
  (thrust factor > 0.1). Previously only the player rendered a trail, so the enemies' exhaust color
  was defined but never visible.
- **Colorful ship-destruction explosions.** A destroyed ship (enemy or player) now bursts instead of
  just vanishing: a layered fireball (white-hot flash core → orange ball → red cloud), a radial spray
  of ~22 colored sparks (warm fire palette + a few in the ship's own color) flying outward and fading,
  and a flat shockwave ring expanding on the plane. New `spawnShipExplosion(pos, shipColor)` (tinted by
  the enemy's color); `spawnExplosion` gained tunable `life`/`color` so the same primitive serves both
  the quick hit-flash and the slower fireball layers. Distinct from the small impact micro-flash, which
  is unchanged. `reset()` cleans up the new `sparks`/`shockwaves` pools. The burst plays out **slowly**
  (~3.75 s: fireball layers 1.05/2.55/3.75 s, sparks up to 5.4 s as cooling embers, shockwave 2.4 s)
  for a weighty, drawn-out feel. **Sized to the ship** (every dimension scales by the ship's `sizeScale`,
  so the 2× heavy enemy bursts twice as big) and **tinted by the engine's exhaust color**
  (`engine.exhaust.color`): an exhaust-colored glow layer, accent sparks and the shockwave ring take it,
  so the player's burst glows cyan-blue and the enemies' orange — the destroyed engine's signature.
- **Rollback support.** Each deploy tags the image `spacegame:<git-sha>` and CI keeps the 3 newest
  versions (current + 2 to roll back to). Added `rollback.sh` (re-tag a previous version to `:latest`
  + `docker rollout` → zero-downtime, no rebuild). Documented the migration strategy: forward-only /
  expand-contract, so code rollback is safe without reversing the DB (DECISIONS §9).
- **Graceful shutdown (SIGTERM).** On `SIGTERM`/`SIGINT` the server now stops accepting new
  connections and lets in-flight requests finish (`server.close()`) before exiting, with an 8 s hard
  cap (`setTimeout(...).unref()`) so a hung request can't block exit forever (`server.js`). This drains
  the old container cleanly when it's removed during a zero-downtime rollout, eliminating the occasional
  transient 502 (the last gap left by the blue-green deploy).
- **Zero-downtime deploys.** Deploy now uses blue-green via `docker rollout -w 10 app`: a Docker
  `healthcheck` gates Traefik routing (only routes once `/api/health` passes, i.e. after migrations),
  the new container comes up alongside the old, and the old is removed only after the new is healthy +
  registered. Verified by polling `/api/health` throughout a rollout (0 dropped requests). Migrations
  run on startup, gated by the healthcheck. CI deploys on push to main (incl. PR merges) after tests.
- **Deployed to production: https://space.bagaiev.com.** Dockerized (`Dockerfile`, `docker-compose.yml`,
  1 GB mem limit) on the existing Hetzner VPS behind Traefik (auto-HTTPS), on the shared `backend`/`proxy`
  networks, using the shared Postgres (`spacegame` DB+user). Backend storage is now **pluggable**
  (`datastore.js`): Postgres (`pg`, `db_postgres.js`) when `DATABASE_URL` is set, else SQLite for
  local/tests; API handlers made async. Added **GitHub Actions CI/CD** (`.github/workflows/ci-cd.yml`):
  tests on every push/PR, deploy on push to main (needs secrets `DEPLOY_SSH_KEY/HOST/USER`).
- **Acceleration and turn rate now depend on ship MASS.** Mass = sum of all component weights
  (`shipMass`; weapons gained a `weight`). `deriveDrive` applies `massFactor = REFERENCE_MASS / mass`
  to both: heavier ships accelerate and turn slower, lighter ones faster. `REFERENCE_MASS = 48`
  (player's basic loadout) keeps the player at accel 10 / turn 2.0; enemies rebalanced by their mass
  (fighters lighter → nimble, the heavy → sluggish). Added unit tests for mass and the new derivation
  (client suite now 17). Tunable via component `weight`s and `REFERENCE_MASS`.
- **Backend tests added** (`server/src/server.test.js`, 9, via `node:test`): register / record game /
  history / validation (400s) / health / serves client. Made the backend testable — `server.js`
  exports `createApp()` (listens only when run directly) and `db.js` honors a `DB_PATH` env (tests
  use a temp SQLite file; real `game.db` untouched). `getPlayerGames` now orders by `id DESC`
  (deterministic newest-first). Run: `cd server && npm test`.
- **Extracted pure game logic from `index.html` into testable ES modules** (`client/src/`):
  `components.js` (component catalogs + `deriveDrive` + `hitsToKill`) and `steering.js`
  (`headingToDir`, `shortestAngleDelta`, `steerToward`, `enemyThrustFactor`, `inForwardSector`).
  `index.html` now imports them and uses `steerToward`/`enemyThrustFactor`/`headingToDir` in
  player/enemy/rocket steering. Added unit tests via built-in `node:test` (`client/src/*.test.js`,
  `npm test`), 12 passing. Note: the client now uses ES modules, so it must be served over http
  (not opened as `file://`). Full simulation extraction will continue incrementally.
- Added a **minimal schema migration runner** (`server/src/migrate.js`, no dependencies):
  schema version in SQLite's `PRAGMA user_version`; ordered migrations `src/migrations/NNN_name.js`
  (`up(db)`), each applied in a transaction. Runs on server startup and via `npm run migrate`
  (standalone, for deploys). Moved the initial schema into `001_init`; `db.js` no longer creates
  tables inline.
- **Backend added (Node.js + Express + SQLite via `node:sqlite`).** The server (`server/`) serves
  the game client and a JSON API on one origin. **Auto-registration by browser:** the client makes
  a UUID (localStorage) and posts it on load; the server upserts the player. **Game history:** on
  game over the client posts the result, stored per player. Endpoints: `/api/players/register`,
  `/api/games`, `/api/players/:id/games`, `/api/health`. Runs on http://localhost:4000
  (`cd server && npm install && npm start`). Client calls are best-effort (game works without it).
- HUD Health panel now also shows the remaining health as a percentage with one decimal
  (e.g. "87.5%") below the bar.
- Third enemy type — the **purple "heavy"** (`ENEMY_KINDS.heavy`): slow, rocket-only (no gun),
  150 hp, 2x model. Unlocks after 10 kills (`score >= 10`), then ~20% of spawns. Added heavy
  engine/thrusters/hull components; ships now have a `radius` (hit size scales with model);
  enemy gun fire is guarded so gun-less enemies don't shoot bullets.
- **Project rule: English only** — all UI text, docs, code comments and commits must be English
  (recorded in `CLAUDE.md`). All existing UI strings, documentation and code comments were
  translated from Russian to English.
- **Rocket cooldown is now shown by the 🚀 circle filling radially** (conic-gradient): orange
  while reloading, green when ready. The separate bottom bar was removed. The circle is shown on
  PC too (bottom-right) and is clickable to fire (in addition to the `F` key).
- Engines split into a **main** one (`ENGINES`, power → acceleration) and **maneuvering** ones
  (`THRUSTERS`, power → turn rate). Acceleration and maneuverability became **derived** ship
  stats (`deriveDrive`: `acceleration = engine.power × THRUST_TO_ACCEL`,
  `turnRate = thrusters.power × THRUSTER_TO_TURN`, coefficients are 1 for now). Values preserved.
- Bullets now **inherit the ship's velocity**: the resulting speed = projectile speed along the nose
  + the shooter's speed (previously they flew strictly out of the barrel). A bullet stores a `vel`
  vector instead of `dir`+`speed`. Applied to the player and enemies.
- A new enemy type — the **yellow "rocketeer"** (`ENEMY_KINDS.rocketeer`): tougher (40 hull),
  shoots bullets AND launches homing rockets at the player (`enemyRocket`, 30 damage).
  Spawns ~30%. Introduced `ENEMY_KINDS` and `spawnRandomEnemy`.
- **Rockets can be shot down by the machine gun:** a bullet destroys a rocket of the opposite side (a harmless
  explosion). Rockets now remember their side (`fromPlayer`) and an explicit target; homing/detonation/damage
  respect the side (a player rocket hits enemies, an enemy one hits the player).
- The rocket's maneuverability was reduced: `turnRate` 3.5 → 1.0 — it turns more lazily, in wide arcs.
- The rocket's initial direction is now strictly along the ship's nose (previously it inherited the
  ship's inertia and "drifted" when the ship was drifting).
- The rocket got **maneuverability** (`turnRate` — actively turning its velocity vector toward the target,
  not just accelerating in a straight line) and **a light smoke trail** (gray puffs that expand and fade).
  Added a **rocket cooldown indicator** (a bar at the bottom center, "🚀 READY" when ready).
- Added **homing rockets** (secondary weapon, the `F` key / the 🚀 touch button):
  5 s cooldown, on launch they find the nearest enemy in the forward 120° sector and accelerate toward
  it with the player's engine acceleration, 50 damage, an explosion slightly larger than the machine-gun one (+a small AoE).
  Implemented as `WEAPONS.homingRocket` + the `player.secondary` slot + the `rockets` system.
- **The player's acceleration is fixed at 10** (was 18) — the same value is used by the rocket as its
  homing acceleration. The explosion was made parameterizable by size.
- **Base balance as a reference point:** the player's hull is 100 hp / weapon 10 damage; the enemy — a 20 hp
  hull / 5 damage. (It was 200/1 and 2/8.) We build on these numbers going forward.
- Introduced a **component-based ship model**: catalogs `ENGINES` / `HULLS` / `WEAPONS` with
  stats (some — for later: weight, durability, volume). A ship is assembled from components
  (loadout), and all logic (thrust, turning, maxSpeed, hp, projectile damage/speed, exhaust) reads
  values from them instead of hardcoded constants. The exhaust is part of the engine. The current weapon was named
  "Basic kinetic" (`basicKinetic`). Game behavior is unchanged (the values are the same).
- Touch controls reworked into **"steering by touch direction"**: the stick's angle = the desired
  nose direction (the ship smoothly turns toward it), the magnitude of deflection = thrust.
  Previously it was discrete "left/right/forward/backward".
- Added a **perf overlay** (FPS / ms / draw calls / triangles across both render passes) —
  for tracking load.
- Added **touch controls** for mobile browsers: an on-screen stick (thrust+turn) on the left
  and a "FIRE" button on the right; they feed the same input flags as the keyboard; visible only on
  touch devices.
- Documentation split into two streams: `SUMMARY.md` (current state) and `CHANGELOG.md`
  (change log); `DECISIONS.md` remains the rationale.
- The folder was reorganized: `client/` (Three.js), `server/` (backend — groundwork), `docs/`.
  The project was pushed to git → GitHub (konbagaiev/space_game).

### Baseline (accumulated before the reorganization)
- A Three.js prototype: arena, player ship, 4 AI enemies, shooting, hits, HUD.
- Inertial physics + passive braking; boundaries with no bounce (velocity to zero).
- Camera: nearly vertical, rigid attachment to the player, no rotation.
- Background: stars (varying brightness), a parallax layer of asteroids, planet + 2 moons (parallax).
- Lighting via two render passes: a real day/night on the planet and moons.
- Effects: a micro-explosion on a hit; a narrow engine trail with speed derived from the ship's motion.
- Enemies — 2 hits, spawning in a ring around the player.
