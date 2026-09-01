# Current state (SUMMARY)

> A living snapshot of "how things are now". Updated with every change.
> Change history is in [CHANGELOG.md](CHANGELOG.md). Rationale is in [DECISIONS.md](DECISIONS.md).

**Updated:** 2026-08-31 (**A finished mission can always be closed, and the homing arrow is gone.** Firing on
the way home cancels the autopilot (§39) — and used to leave the mission permanently unclosable: the
"Finish and Return" button refused every further press and hand-flying to the station did nothing. The button
now re-engages the flight (without re-running the one-shot settlement) and, once it has been pressed, arriving
at the station counts however you got there; `canDock` is unchanged for every other case (DECISIONS §143). The
world-space blue arrow that pointed at the base station is **deleted** — it showed from the first frame after
take-off with no distance gate; the roam nav bar's "Return to Base" button and the system map are how you get
home.) 2026-08-31 (**Ship weight class is a first-class data axis.** Every ship row states
`stats.weightClass` (`light`/`medium`/`heavy`, with `ultraHeavy`/`station` declared for later), described by
`SHIP_CLASSES` in `client/src/sim-core/ship-classes.js`, which owns each class's explosion-blast profile. The
blast flash reads the class instead of guessing from `sizeScale`; those thresholds survive only as the
fallback for data that predates the field. No visible change — see DECISIONS §142.) 2026-08-31 (**The expensive look — REAL LIGHTS, a layered backdrop and bigger dust.** The frame
is the historical two-pass one, drawn straight to the canvas with its own MSAA and **no tone mapping**: a
full-frame `EffectComposer` and then an additive glow overlay were both built, live-tested and **deleted**
(DECISIONS §139). What ships is a fixed, tier-gated pool of **real `THREE.PointLight`s** on engines, rockets
in flight and explosion flashes (`engine-lights.js`, High 16 / Balance 4 / Performance 0); a second, coarser
nebula bake riding an additive camera-tracking sphere in front of the baked cube for real parallax; a hull
emissive floor that is wired but ships at **0**; and speed-field dust ~30% larger.) 2026-08-30 (**The intro is a fight you fly** — Level 0 is a live, session-recorded campaign level with a scripted director speaking five first-person lines over it and a controls card that flies into the bottom-left cheatsheet; the cutscene, its S3 trace fetch and its tap-to-continue cards are deleted, `&cutscene` is now the generic `&finish`, and the beat timings live on the `level-0` descriptor beside the `spawn.earliest` floors the SIMULATION reads.) 2026-08-30 (**The target reacts — hull flash, model punch, camera shudder.**) 2026-08-26 (**The beam is bluer, and its impact flash is now the shared one** — it emits `bulletImpact` like
every other weapon instead of drawing its own bloom.) 2026-08-25 (**The enemy charged beam — the pirate lancer, and the red telegraph that makes
it fair.** A weakened enemy-only beam row (id 13: **power 45, maxRange 67, charge 1.0 s + cooldown 2.0 s
→ a 3.0 s cycle, 15 sustained DPS**) on a NEW beam-only ship, the **pirate lancer** — which turns at
**50°/s** on a thruster row of its own — the same 50°/s the pirate gunner and advanced rocket pirate
were brought down to in the same change, the intro's two ships deliberately excluded; a pooled
**charge-only hostile sight** in `#ff6b4a` drawn from any charging enemy's hull — including a shooter in
a server-run room, because `beamCharge` now carries the SHOOTER as an entity reference; and a `?lancer`
dev flag that swaps a phase's spawn pool. **DECISIONS §135's gate is MET.** The first pass shipped a 0.5
s cooldown and a 148°/s turn, at which the lancer held the corridor and practically never missed; the
maintainer flew it and cut both — a 4× longer cooldown and a 3× slower turn — so **the beam is now
genuinely escapable**, which is what the corridor design always assumed. It spawns only behind `?lancer`
until Level 5.)
Prior: (**The Charged beam — a shot that takes time, has no projectile, and announces
itself.** A third weapon `type` (`'beam'`, catalog id 12, 5500 credits, gated behind "Level 3"): three thin
lines run from the hull — the centre and the two edges of a **±2° hit corridor** — the trigger commits to a
**1.0 s charge**, and at release it **hitscans** the ship it painted if any part of it is still between the
drawn lines, out to **range 100**. Turning away breaks the shot; turning toward it tracks, and a full
second of charge makes that tracking mandatory. Its sustained 53 DPS is **deliberately** below the starter
gun: it is bought for the instant, no-lead hit at range, not for damage. Undodgeable and RNG-free — **the
corridor IS the dodge** (DECISIONS §135) — and it takes the PRIMARY GUN slot, so buying it means giving up
your rapid gun. The green dashed sight hands over to a cyan-white discharge; both sounds are cut from one
CC-BY clip, the game's first. Shipped as a player purchase, with arming an enemy GATED on building the
hostile sight first, because a telegraph the player never sees is not a warning.) Prior:
(**A third combatant in the simulation, and the wingman who flies it** — the fight
is three-sided in TARGETING (an enemy steers, aims and homes at the nearer of player-or-ally) and stays
two-sided in DAMAGE ROUTING (no friendly fire, DECISIONS §134). `world.allies` + `sim-core/step-ally.js`
fly a Sentinel wingman with logic of his own — charge, pass through, brake-and-come-about, break off to
heal at 25 % hull and return at 40 %, and **die** if that fails — he is lost for the rest of the mission and
returns in the next one, worth nothing. He arrives because a level PHASE says `ally: true`; **no shipped
level does**, so with the `?ally` dev flag off nothing about the game changes and not one seeded RNG draw
moves. His kills advance the mission and pay nothing.) Prior: (**A mission ends when the player presses "Finish and Return"** — the last kill
clears the sector and pays the reward; the pilot is then free in a quiet sector to pick over the wreckage,
and "Finish and Return" sweeps up what is left, commits the campaign advance and flies the ship home on
autopilot; arriving closes the mission. Reloading the tab mid-flight loses nothing — settling is what
survives the trip, not the trip. DECISIONS §132, §133.) Prior: (**A server-run room banks its own run** — a `?netsim=1` room reports what its own
simulation decided (`onEconomy` → `makeEconomySink` → `recordGame`/`depositLoot`) under the playerId from
its handshake ticket, and the tab stops banking a run the room is banking. Credits, XP and loot are sealed
for fights the server actually ran; netsim is opt-in, so browser single-player still banks on trust and is
described that way. DECISIONS §131.) Prior: (**A mission ends twice — clearing the sector pays you,
reporting back advances you** — a level states a `winCondition` (`allEnemiesDead` everywhere today) and the simulation grants the
reward the moment it holds: doubled credits, the one-shot XP bonus and a new `cleared` event, with docking
left as ceremony. Victory no longer depends on a mouse click, so a room or a headless referee can conclude a
mission; die on the flight home and you keep the credits but fly the level again. DECISIONS §130.)
Prior: (**The server can now say what a run SHOULD have earned — and it is only watching**
— `server/src/seal/verify-run.js` re-simulates a recorded run and returns a verdict; nothing is enforced and
no balance is touched, because the first survey of production says traces do not yet reproduce (20%
agreement, no cheating — DECISIONS §129, `docs/plans/seal-the-economy.md` §3.1). The finding that matters: a
trace reproduces only on the **build** that recorded it, and session recording captures a stub under
`?netsim=1`.) Prior: (**A level can be played in a server-run room — `?netsim=1`** — the server holds the
World and steps it at 60 Hz while the browser sends input and draws 15 Hz snapshots, running no local
simulation at all; opt-in, so single-player is untouched. Built on the same `sim-core` the browser runs, and
a test requires a room to reach the same digest as the headless referee. No client-side prediction yet, so
the local ship answers ~100 ms late. Slices A–D of `docs/plans/server-authoritative-sim.md`; see "Playing in
a server-run room" below.) Prior: (**The simulation runs in Node, and a test proves it agrees with the browser** — the
whole tick lives in `client/src/sim-core/` behind `tick.js simTick(world, dt)`, `sim.js` is down to ~630
lines of picture, and `server/tools/sim-replay.mjs` replays the canonical Level-0 input trace headlessly
(3490 ticks, 4 kills, arena cleared) with no browser anywhere. `36-sim-divergence` requires the browser and
Node to land on the same world digest AND the same seeded-RNG draw count.) Prior: (**Simulation state moved out of Three.js** — every simulated entity now owns plain
`pos`/`vel`/`heading`/`scale` data (`sim-core/vec.js`), `collision.js` composes the ship's world matrix itself
from that state instead of reading `mesh.matrixWorld`, and the new one-way `sim.js syncMeshes()` is the only
place the simulation reaches the scene graph. Warp-in is sim state, not an animation. A pure refactor: the
Level-0 intro trace replays bit-identically (`tick=2503/3490`). Slice A of
`docs/plans/server-authoritative-sim.md`.) Prior: (**Star-centered canonical coordinate frame + per-object `frame` tag** — the canonical
frame is now heliocentric (star at origin) with a planet-2 floating origin for gameplay; `system-map.js` gains a
pure `starWorldPos`/`planetOriginOffset`/`worldToLocal`/`localToWorld` seam, set-pieces carry `frame:"planet:2"`
(default, unchanged) vs `"world"` (space-fixed, re-derived to local each frame), with one demo world-fixed
object near the base. Foundation toward instanced multiplayer zones; no gameplay/replay change. DECISIONS §115,
see the star-system paragraph below.) Prior: (**Large/foldable phones keep phone chrome in fullscreen** — the device `form` axis now
classifies `phone` by the viewport's shortest edge, so a Galaxy Fold cover no longer flips to tablet sizing when
fullscreen hides the browser chrome; see the device-model paragraph below and DECISIONS §114.) Prior: (**No reverse: `S`/`↓` is a brake** — the ship can no longer be thrust backwards along
its nose (a keyboard-only ability touch can't have, and a kite the enemy AI can't answer); the key now bleeds
speed to 0 with the autopilot's kinematic decel, `W`+`S` thrusts, DECISIONS §113. Previously: **Sampled sfx
load without waiting for a gesture** — `?playback` is reached by
navigation, so no gesture ever landed on it and a replayed recording ran entirely on synth voices; the intro
cutscene's tap-to-begin card had been hiding it. Previously: **Aim assist now tests the target's HULL, not its
centre** — a ship whose wing was in
the line of fire never engaged the assist, so bullets grazed it with no correction; each candidate now carries
its collision `broadRadius` into the cone test and the best-AIMED target wins, not the nearest. Previously:
**The freighter side mission is reachable again** — it had no `ANCHORS` entry and no
host object in `listSystemObjects()`, so it could be taken from the board and then had nothing on the map to
fly to; it now sits at `(-100,-950)` with a map object, an autopilot destination and a test pinning that every
side mission has a host. Previously: **Sim-loop de-duplicated + `update(dt)` sectioned** — a pure refactor with no
behaviour change: the fixed-timestep tick body that was written twice in `client/src/main.js` (the `animate()`
accumulator and `window.__replay.step(n)`) is now the one shared `stepReplayTick()` in `client/src/replay.js`,
and `sim.js`'s 471-line `update(dt)` is a table of contents over 12 module-local `step*()` functions.
Previously: **Mission-gated shop rows + the gold "(new)" trail inside the shop** — the Ion engine and Nanobot repair are hidden from the shop and refused by the server until the "Research station" side mission has been **cleared** (a second gate kind, `stats.minMission`; side-mission completion is persisted now in `cleared_missions`, and players already past the board gate are grandfathered by a one-shot migration); the mission board grows a **Cleared** badge, and inside the shop the type tab holding a never-clicked newly unlocked row goes **gold** — as does the row itself, until it is clicked. Previously: **Roam navigation HUD** — while roaming, a gold off-screen edge arrow points at the active mission and a bottom-center bar carries "Return to Base" + "Autopilot to Mission" (each button also cancels its own autopilot); both the pointer and the mission button hide when there is no active mission target. Previously: **The "(new)" marker now leads all the way to the shelf** — the gold "(new)" that announces newly unlocked gear rides both the Loadout menu item AND the Shop button inside the Loadout panel, and it now clears only when the player OPENS THE SHOP (merely entering Loadout no longer clears it). Previously: **The "Level 3" gear tier is progress-gated** — Heavy hull, Heavy Machine Gun (now weight 15 / aim assist 3°) and Triple spiral rocket are hidden from the shop and refused by the server until the weapons factory is cleared; a gold "(new)" marker on Loadout announces them when they unlock. Previously: **`M` toggles the system map on desktop** — out of combat only, so it can't be used to freeze a fight. Previously: **The speed field fades out near the star** — its grey specks read as dirt over the
sun's smooth bright disk (~15 000 speck pixels on it), so the parallax field ramps away inside 760 u.
Previously: **The sky light comes from the star** — the terminator source is no longer an
authored fixed position but the star's own world position, aimed every frame; it used to arrive 64° off
Vega's real bearing, leaving the home planet lit from the wrong side. Fixing it surfaced a sky-light LEAK:
`buildMap` never removed the lights it replaced, so every level start added another pair. Previously:
**Vega is a real sun** — the star is now a `.glb` model (CC-BY "Sun" by
SebastianSosnowski, 2.1 MB → 167 KB) instead of an emissive sphere: 30% bigger (`size` 96), turning slowly on
its axis, wrapped in a two-layer additive corona, and washing the sky backdrop brighter as you close on it.
The asset's orange core is hidden so only its yellow transmissive shell is drawn. `assets:check` now also
guards models referenced from a MAP DESCRIPTOR (set-pieces + the star) — previously an unchecked lane.
Previously: **"Level 4" fights at the far belt outpost** — the third mining outpost moved to
`(-900,2800)`, the system's most distant destination, and "Level 4" now names that exact point as its
`center`, so it is the second level you fly out to rather than fight at the origin. Previously: **The map
marks where your mission is** — the object hosting the active mission
carries a dashed gold frame/ring in both map hosts; the campaign's object is derived from its fight centre
via `objectForActiveMission` (DECISIONS §105, §106). Previously: **Phone map layout: object list on the right, map down to the bottom** — the
navigation component keeps its side-by-side shape on `body.dev-phone` instead of stacking into two strips,
in both hosts, with the ⛶ fullscreen button's corner reserved in the base menu (`34-phone-map-layout`).
Previously: **The in-flight "Map" button works on phones again** — it sat at the same z-index
as the full-screen touch/stick layer but earlier in the document, so every tap went to the stick; now z-6,
with a hit-test guard in `15-mobile-landscape`. Previously: **The campaign has no "Launch mission" button** — `#mw-go` is hidden whenever the
campaign is the active mission (it had become the same call as Take off once levels started by flying to
their zone; DECISIONS §104); it returns only for an active side mission. Previously: **Level-ups land mid-fight** — the XP bar resolves the level live from the run's
unbanked XP (`client/src/progression.js` `liveProgress`, a parity-tested mirror of the server curve;
DECISIONS §103), so crossing a threshold in combat bumps the level, resets the bar and toasts right then;
the toast is deduped so banking doesn't repeat it, and `bankRun` now zeroes `G.earnedXp` so the run's XP
can't be counted twice. Previously: **Levels are 0-based — id = row name = title = `current_progress`, 0 = the intro** (DECISIONS §102; one-shot `levels_zero_based_ids` migration, recorded traces bumped to v3 so the archive still replays). **Space Factory + "Level 3" moved onto it, and you FLY INTO it to start it** — while roaming, crossing within 200 u of the active campaign mission's centre runs a 3 s HUD countdown and the fight begins there (`stepMissionZone`; armed only when that mission is the active one). Take off on such a level launches you at the HOME BASE, not at the centre. — the campaign's weapons-factory level (db `level-3`, the first with a boss) now fights at `(-450,-435)`, 30 u up-left of the new station, via the new `runCenter` seam that lets a CAMPAIGN level name its own combat centre (it was silently ignored before). **Space Factory** — a new first-class system object: an orbital industrial ring station at `(-350,-350)`, up-left of the home planet and ~two screens out, listed/selectable on the system map and flown to by autopilot (`ANCHORS.factory`, `kind: 'factory'`), with a matching `space-factory` set-piece; no mission. Previously: **Home station at `(-10,-10)`** — the return-to-base station moved 50 u right and 50 u down from `(-60,-60)`, anchor + set-piece together, so it sits further from the home planet's sphere and 14 u off the campaign arena center; and the system map draws the **star at 14px / planets at 10px**, double their old marker radius. Previously: **Flyable to-scale star system + autopilot navigation** — out of combat the home map is now a to-scale, flyable star system: a central star + 4 planets + the home planet's 2 moons rendered as **real spheres at their own true (x,z) ON the ecliptic** (`system-map.js` + `world.js` `buildSystemBodies`/`updateSystemBodies`), replacing the single planet. The ship flies on the plane and the camera looks down at it; each body is sunk `depth` below the plane at the shared `SYSTEM.offset` framing — the original home planet's placement, now per body. Nothing is camera-anchored, so nothing re-projects and **nothing jumps**. At the base you see **only planet 2 + the station**; the other bodies are 9k–45k u away and you **fly to them** (`planetAnchor` = a body's own (x,z); reaching planet 3 is a real ~15 000 u crossing, and arriving frames it like the home planet at base), fading in by distance from the ship rather than popping. A body is **permanently out of reach** even overhead — its top sits `depth − size` below the flight plane. Zooming out no longer **dims** the ship/stations — fog is re-anchored to the ship (`applyZoom`, DECISIONS §99). The parallax **speed field is main’s** (see below, DECISIONS §96). New **roam** state (`G.roam`, entered via the base-menu **Map** `enterRoam` or the `?roam` dev flag) with the speed cap **lifted only while an autopilot is cruising** (`capLifted` — false whenever roam is off → replays byte-identical) and OOB warp-back off. **Navigation UI: ONE shared component** (`systemmap-ui.js` `mountSystemNav`) in three hosts — the base-menu **Map**, the out-of-combat **overlay** (Map button / mini-map tap; freezes via `G.mapOpen`, not setPaused) and **mission activation**: map pinned **left**, **object list right**, the **star and all 4 planets first-class selectable destinations** beside the home/research stations and **three** belt outposts (`listSystemObjects`, i18n `ui.object.*`), selection highlighting list + marker together, and pan/zoom through the pure unit-tested **`map-view.js`** seam (clamped so the map can't be lost). **“Autopilot to destination”** flies there → **autopilot-to-point** (`engagePointAutopilot`, a `point` target kind that never wins by proximity); arriving at a mission object whose offer exists shows a localized **“Start mission?”** prompt reusing `missionOffers`/`launchMission`. **“Take off” (free flight) is on EVERY base stage**; the old mission button is now **“Launch mission ⚔”**, and one gate (`updateTakeoffGate`) greys every launch control when a required slot is empty. DECISIONS §100. Near-mining + research set-pieces + `missions.js` centers moved out (2× distance, four-way invariant); `catalog_seed.js` gained a `system` block, merged into the client `SYSTEM` at build (`applySystemSpec`). Pure `system-map.test.js` (capLifted invariant, Float32 bound, absolute body placement, unreachability, fly-there fade, moon clearance, anchors) + the `32-star-system` visual scenario (post-win roam guard + the fixed-body, travel-to-planet-3 and zoom-fog guards); the `22-intro-replay` and main’s `31-speed-field` guards are unchanged. DECISIONS §98/§99. docs/plans/2026-08-09-1456-star-system-map.md. Previously: **Both Grab (tractor) components are 30 % stronger** — the base Grab (id 29) went `strength` 10 → **13** and the Advanced grab (id 30) 20 → **26** in `catalog_seed.js`; the startup catalog upsert propagates it to every existing player on deploy (no migration). Reach is emergent from the inverse-square field, so it grows by **√1.3 ≈ +14 %**: base ≈11.2 → **≈12.7 u**, Advanced ≈15.8 → **≈18.0 u**; the advanced/base ratio stays √2. Weights, prices and reel-in speed are unchanged (speed never depended on strength). Previously: **The Main Window mission list moved into the right column; the ship preview is gone** — on **Missions** the 25% right column (`#mw-ship-col`) now holds the mission list (campaign + side-mission cards, restacked: title + badge / reward · XP / Take · Defer · Set active, scrolling), and the center work zone holds **only** the briefing body (title, text + granted-item showcase, reward, Take off). The spinning right-column ship model and its characteristics strip are gone from every view except **Loadout**, which is unchanged (centered ship + 30% context panel) and is now the only screen showing `#ship-stats`. **Character / Map / Craft** collapse to a two-column grid. The staged campaign-briefing reveal lost its "ship window fades in" beat — only Take off is held back while the text types, so the mission list stays visible. DECISIONS §97. Previously: **The parallax backdrop is now a player-locked wrapping speed field** — the origin-anchored ring of 2000 instanced asteroids is gone; a fixed pool of ~1090 `THREE.Points` sprites in 3 depth layers (3 draw calls, own crisp procedural sprite) is re-wrapped into a ±620 box around the ship every frame from the VIEW layer (`settleView`), so the same specks sell speed everywhere in the system at constant cost — the ring left you in empty space as soon as you roamed. Per-map colour/density moved to the descriptor's `speedField` (the dead `asteroids` key is gone — the shim was removed once itch was re-published and /v2 redeployed); new pure `client/src/speed-field.js`, a `?dev` "Speed field" tuning folder, and a `31-speed-field` scenario that teleports 4000 units out and asserts the field is still centred on the ship. DECISIONS §97. Previously: **Progress gates now resolve by level NAME, not by a raw `levels.id`** — the side-mission board was opening far too early on production (and the shop a level early): both gates compared `players.current_progress` against a hardcoded id (`>= 5` / `>= 3`), but `levels.id` is a BIGSERIAL whose sequence the startup upsert burns on every boot, so live ids had drifted to 1, 6, 7, 71, 564 and a player still on the "Level 1" briefing (id 6) satisfied both. New `reachedLevel(progress, name)` + `SHOP_MIN_LEVEL='level-3'` / `SIDE_MISSIONS_MIN_LEVEL='level-5'` in `db.js`, fail-closed if the row is missing; the boot shop backfill uses the same lookup and still never revokes. New `server/src/levels_drift.test.js` reproduces the drift on its own DB. DECISIONS §95. Previously: **Selling gear now confirms with a price + quantity picker** — clicking Sell on a stash item opens a confirm dialog (`#sell-overlay`) showing the resale total; when the stash holds more than one, a slider + number field pick how many to sell (clamped to owned, live total). `/sell` gained an optional `qty`; `sellItem` sells `min(qty, owned)` atomically. Also fixed the shop **detail-card Buy button** to render as the blue `.primary` button like the list (the styling was scoped to `.lp-item`/`.lp-shop-item`/`.lp-foot`, not `.lp-detail`). New `12-sell-confirm` scenario + server qty test. docs/plans/2026-08-09-sell-confirm-quantity.md. Previously: **Character progression shipped — experience, levels & five skills** — the Character base-menu screen is now real: level + XP bar + unspent skill points + five skill cards (Kinetic/Rocket/Shields/Maneuverability/Mobility, effects live and baked into the player at build time). XP is earned per kill (= the ship's credit reward) + a one-shot mission bonus on victory; the arithmetic curve is 1000 to level 1 then +500/level; level & unspent points are DERIVED from `experience`, never stored (`progression.js`). Dodge is a seeded-RNG per-shot roll drawn only when dodge>0 (existing replays bit-identical), with an "EVADE" popup. New `players` columns (`experience` + 5 `skill_*`), `/api/games` banks `xp`, new `POST /skills/spend`; `11-character-progression` visual scenario + progression/skill/dodge/server tests; intro-replay guard green. DECISIONS §93. Previously: **Engine + thruster components now show 3D item icons, and the item viewer animates** — every `engine` shares one menu-only glb (an animated nozzle, laid on its side) and every `thruster` another (a turbine), via the shared `ENGINE_MODEL`/`THRUSTER_MODEL` constants in `catalog_seed.js`; one model per family is a deliberate placeholder pass. `model-viewer.js` gained `AnimationMixer` support so the engine's flame clip loops instead of freezing in its bind pose, plus a `pitch` field in the item cfg (yaw can't tip a model over — the preview already spins about the vertical axis). Both sources CC-BY 4.0, textures built at 256px WebP (the animated one: 2.51 MB → 86 KB). Guarded by visual scenario `96-item-models-engine-thruster`. Previously: **Loadout redesigned — ship centered with slot chips around it + a right context panel** — clicking Loadout shows the ship in the middle of the work zone with its equipment/weapon slots around it; selecting a slot opens a right panel (equipped info + Remove, stash replacements → Install, a Shop button) that swaps to the shop; clicking a shop entry opens a **detail card** with the item's stats, its **3D model**, and Buy. The reusable 3D viewer moved to `client/src/model-viewer.js`. Server unchanged; the type nav is still a tab row (collapsed-sections-per-type is a later refinement). Base-menu-redesign Slice C (increments 1–2). Previously: **Missions is now a central board with take / defer / one-active** — the Missions section shows a board of cards (campaign + side missions) with Take/Defer/Set-active + Active/Taken badges; **Take-off flies the ACTIVE mission** (server-persisted: `taken_missions` table + `players.active_mission_id`, endpoints `POST /missions/take|defer|activate`, one active at a time). The old left mission sublist is gone. Base-menu-redesign Slice B; DECISIONS §91. Previously: **Base menu reworked into five sections — Character · Missions · Loadout · Map · Craft** — the left base-menu is now a five-item hub (all always shown; docs/plans/2026-08-08-base-menu-redesign.md). Character/Map/Craft are "Coming soon" stub panels (`#mw-view-stub`); Loadout absorbed the standalone Stash/Shop items as an in-bay Ship/Stash/Shop tab row (`#mw-bay-tabs`) and shows the ship **read-only** until the shop unlocks. New EN+RU i18n for the labels/stubs; `05-hangar-shop` visual scenario updated to the tabs. Base-menu-redesign Slice A. Previously: **Side missions now unlock after "Level 3", decoupled from the shop** — the side-mission board no longer rides the shop's `shop_unlocked` flag: the shop still opens right after the first flight (§90), but the board opens later, on reaching the "Level 4" briefing (the `level-5` row — `SIDE_MISSIONS_MIN_LEVEL`); `getActivePlayerShip` returns a derived `sideMissionsUnlocked` the missions endpoint + client `refreshMissions()` gate on (was `shopUnlocked`). No new DB column — the gate is computed live from progress. Briefing copy updated (EN+RU + `catalog_seed.js` fallbacks). Kicks off the base-menu redesign (docs/plans/2026-08-08-base-menu-redesign.md, Slice 0). See DECISIONS §91. Previously: **The hangar shop + side missions now unlock right after the first mission** — the `unlockShop` briefing action moved from the final level to the "Level 2" briefing (descriptor `level-3`, reached right after clearing "first flight"), so the upgrade economy is reachable during the campaign instead of only at its end; an idempotent boot backfill retroactively opens the shop + seeds the basic gun for existing players already past the first flight (progress at or beyond the `level-3` row), and the "Level 2"/"Level 4" briefing copy (EN + RU) was updated to match. See DECISIONS §90. Previously: **The admin `progress` column reads "Level 2 · bar · 3/5"** instead of a raw level id — the ids are off by one from the player-facing titles, so the cell now shows the level title from the `levels` table plus a CSS bar, an `n/N` fraction (both derived per request, never hardcoded) and a **✔** on the last level, while still sorting by the raw progress id. Previously: **Bullet weapons get aim assist** — every non-rocket bullet weapon now carries a data-driven `aimAssistDeg` (2° cone **half-angle**); a shot fired with an opposing-side target within ±`aimAssistDeg` of the nose at fire time is redirected straight at that target's current position (planar XZ, no leading, nearest-in-cone; skips warping enemies / requires the player alive). It's a **weapon property**, so **enemy guns auto-aim at the player** exactly as player guns auto-aim at enemies; velocity inheritance and rockets are unchanged. Shown as `Aim assist 2°` in the shop stat line. Deterministic (pure scan, no RNG). See DECISIONS §89. Previously: **Frame-pacing probe `/raf-probe.html`** — a 90 Hz tablet stuck at a ruler-flat 22.2 ms/frame (exactly half-rate) is explained by neither the new fixed-timestep sim (same p50 six weeks earlier) nor fill rate (§23 measured a 5.5–7× pixel cut moving fps by nothing on that GPU), so a standalone dependency-free page now measures what the *platform* gives a browser tab — blank rAF / one triangle / full-screen fill — and POSTs to `/api/perf` tagged `probe:'raf'` for SQL. See DECISIONS §88. Previously: **Sessions now actually upload from phones/tablets + trace format v2** — the recorder flushed only on `pagehide`, which mobile browsers routinely never fire, and `sendBeacon`'s ~64KB cap silently dropped every quit longer than ~34 s: a tablet tester's 20-minute session left no row at all. Sessions now also flush on **`visibilitychange → hidden`** over a plain `fetch` (provisional — recording continues), carry a **client-minted id** that the server **UPSERTs**, and store ticks **run-length packed** (v2, 23.8× smaller; v1 traces stay playable via `hydrateTrace()`). See DECISIONS §87. Previously: **Record ALL gameplay sessions** — every live campaign session is now captured always-on and invisibly as a deterministic input-replay (seed + per-tick input) and uploaded via the server to S3 + the new `gameplay_sessions` table, with a `/admin/sessions` page of ▶ play links. The load-bearing change: **all live play is unified onto the fixed-timestep seeded loop** (`TICK_HZ`, default 60) — the same deterministic accumulator record/playback/bench already used. `game_version` = the deploy commit (server-stamped from `SENTRY_RELEASE`); traces reproduce faithfully only on their recorded version (admin shows ✓/✗). See DECISIONS §85. Previously: **The load veil waits for the MODELS too** — it previously covered only the shader warm and dropped before the `.glb`s arrived, so on itch (first load ≈20 MB) the fight started with the player on a procedural placeholder cone and the station popping in later. `G.pendingAssets` counts essential model loads in flight (ship models + set-pieces, decremented on error too) and the veil holds until they land, capped at 9 s so a wedged download can't lock anyone out. See DECISIONS §84. Previously: **A ship explosion no longer compiles a shader** — a reported half-second lag on every kill turned out not to be overdraw (an explosion covers ≤6.7% of the screen) but shader compilation: the flipbook fireball and shockwave ring dispose their materials when they finish, THREE frees a program with its last material, so every death after a lull recompiled (+3 programs, measured). Both configs are now held alive by the warm rig via `keepAliveMaterial()`. Previously: **Level-load veil** — the pre-fight warm is one blocking render call (measured 3198 ms on a weak phone), so `#levelwarm` now covers it: the frame that takes the warm request only raises the veil, the NEXT frame does the work, since nothing paints until a frame ends. Fades in after 90 ms, so a fast machine never sees it. Previously: **A level is compiled/uploaded when it is BUILT, not while it is played** — stall attribution in the `?dev` telemetry showed a weak phone blocking its main thread **10+ of the first 15 seconds** of combat (one 2082 ms frame) while live shader programs climbed 14→33: THREE compiles lazily on first DRAW, and `prewarmShaders()` ran at page bootstrap, before any level exists. `sim.reset()` now raises `G.needsSceneWarm`, the render loop consumes it before the next frame draws, and async set-piece loads raise it again. The FX warm rig is now permanent — it used to dispose its materials right after compiling, and THREE frees a program with its last material, so every lull in bullets/explosions bought a recompile (program count sawing 37↔40). See DECISIONS §83. Previously: **Rocket smoke is ONE draw call, not 25-30** — every FX primitive used to be its own mesh with its own material, so each particle cost a draw call (the rendering equivalent of an N+1 query; ~0.25 ms each on a weak phone). New `client/src/particle-pool.js` gives one `InstancedMesh` per particle KIND, refilled per frame; the rocket trail — the only high-volume kind left — uses it, with per-puff fade on an instanced `aAlpha` attribute so the tail still dissolves while the head stays dense. `maxParticles` is finite on every tier now (640/480/300; it was `Infinity` on High and Balance). New high-volume FX must use a pool. Guard: `visual/scenarios/27-smoke-instancing.mjs` (reads the framebuffer). See DECISIONS §82. Previously: **Kinetic bolt + muzzle flash restyle** — up close, kinetic gunfire read as a mutable coloured oval and the muzzle flash showed as a faceted 10-gon; the bolt texture is now a crisp bright capsule core + faint soft halo (clear body + thin fog rim) at a smaller `BOLT_LEN` 2.4 × `BOLT_WID` 0.7, and the muzzle flash is its own flat additive glow **sprite** (round radial texture, ~30% smaller than the old sphere flash) pushed into the `explosions` pool. Pure render / replay-neutral. Previously: **`?dev` is no longer sticky** — the diagnostics flag used to persist in `localStorage`, so a single `?dev` visit left the perf overlay, the lil-gui authoring panels and the per-second telemetry running on **vega.tenony.com forever**, for the maintainer and for any playtester handed a `?dev` link. It now governs the current page load only: `evalDev` reads the query string and nothing else, and the retired `devMode` key is cleared on load. See DECISIONS §81. Also: **ship models are warmed onto the GPU** right after parsing (`warmModel` — `renderer.compile()` + `initTexture()`), because three.js otherwise uploads and compiles lazily on the first frame an object is DRAWN, which cost 215 ms in `js.render` the first time each enemy type appeared. Previously: **HUD no longer costs a fixed ~8 ms/frame** — weak-phone telemetry had `js.dom` pinned at 7.5-8.3 ms whatever was happening (the whole sim is 1-2 ms), because `hud.js` rewrote unchanged values (`innerHTML` re-parsed 60×/s) and positioned every floating overlay with pixel `left`/`top`, which invalidates layout per element per frame. New `setText`/`setHTML`/`setStyle` skip identical writes and `place()` positions via one compositor-only `translate3d` (CSS anchor offsets folded in, elements pinned at `left:0/top:0`); the radar canvas repaint is throttled to ~20 Hz while anything anchored to a moving ship stays per-frame. No visual change. See DECISIONS §80. Previously: **Ship models are parsed once and cloned per spawn** — `applyShipModel` used to re-run the whole GLTFLoader pipeline on EVERY spawn (new geometry, fresh texture decode + GPU upload, one VRAM copy per instance): on a weak phone that cost an **864 ms frame** and **242 ms of `js.render` in one second** at the start of a fight, with `draws` climbing 12→36 as the scene assembled mid-combat, and enemies often flying as the placeholder until their glb landed. `ship-factory.js` now caches the parsed template per url and clones it; `levelRunner.start` warms every model the level can spawn (`preloadLevelShipModels`) — the `preloadRewardModel` pattern, finally applied to ships. Clones share geometry + textures (one GPU copy per ship TYPE) but get their OWN materials, cloned per instance at attach so the hit flash can light one ship without lighting every ship of its type; only the cached TEMPLATE's materials must never be mutated. Guard: `visual/scenarios/26-ship-model-cache.mjs`. See DECISIONS §79 + §137. Previously: **Content-hashed assets now served `immutable`** — `express.static` was on its `max-age=0` default, so every asset revalidated (conditional GET + 304) on every request; because ship models are re-requested on **every enemy spawn**, a weak-mobile player paid a round trip per spawned pirate and saw enemies fly as the untextured placeholder until it returned. `<name>.<hash8>.<ext>` files now get `public, max-age=31536000, immutable`; un-hashed files keep revalidating so deploys land at once. Safe by construction (the hash is the version → a changed asset is a new URL), so there is deliberately **no "reload assets" command**. Pure unit-tested `staticCacheControl()`. See DECISIONS §78. Previously: **Player ship combat model: 31 -> 15 draw calls** — weak-phone telemetry (`?dev` -> `perf_samples`, PowerVR GE8320) showed 42-67 ms/frame in `js.render` (our own draw-call submit); the cause was one asset — the player ship was **31 draw calls / 31 materials / 79 textures / 371 KB** where every other ship is 3-5 primitives, because the Sketchfab source is split "part x material" and `join` can only merge primitives sharing a material. The combat build now runs a **material-flattening pre-pass** (`assets-flatten.mjs` + the new `npm run assets:materials` sampler and its committed `assets-src/<base>.materials.json` sidecar): each material becomes flat factors sampled from its own maps, so `--palette` merges them and `--join` collapses the mesh; the few maps that paint several colours onto one material keep their base map (`keepTexturedAbove: 34`) so the livery survives, and normal/MR/occlusion maps are dropped everywhere. Result **15 draws / 16 textures / 178 KB**, hangar model untouched, geometry untouched (hitboxes + intro replay unaffected). See DECISIONS §77. Previously: **Enemy shields** — every enemy's HP is now split **1/3 shield + 2/3 hull** (derived client-side at spawn from the catalog `durability`; 30 → 10+20, 150 → 50+100, 300 → 100+200, 550 → 183+367), routed through the same shield-first `applyShieldedDamage` router as the player's (renamed from `applyPlayerDamage`) — lossless, so a kill finished within 10 s of breaking the shield costs exactly the damage it cost before. A broken enemy shield **refills to full 10 s after the breaking hit** and the timer keeps banking **under continuous fire** (player-identical rule), so a longer fight costs up to one extra shield per 10 s (**+183 HP second boss / +103 first boss / +100 advanced medium / +50 mini boss / +10–+12 small pirates**) — long fights are deliberately harder. Absorbed hits flash **cyan** and ripple on a snug per-enemy bubble (ripple-only, no idle rim, tier-capped `enemyShieldBubbles` 6/3/0), and the floating enemy bar gained a **blue shield strip** above the red one (purple while recharging). Hitboxes, mass and handling are unchanged and the recorded Level-0 intro still wins. Guard: `client/visual/scenarios/25-enemy-shield.mjs`. See DECISIONS §76. Previously: **Top-bar credit balance + radar moved under the health bars** — the Main Window top-right now shows the player's balance as `<n> cr.` in credit-gold beside the inactive "Ships" label (`#mw-topright` wraps both; stacks into a right-aligned column below 780px so it clears the 4.5vw wordmark on phone landscape), pushed by `updateMenuCredits()` on menu entry + after every shop action; and the in-fight mini-map/radar left the vertical center of the left edge for the top-left HUD cluster, directly under the shield/health bars and left-aligned with them. Guard: `client/visual/scenarios/23-topbar-credits-radar.mjs`. Previously: **Intro replay desync fixed — the seeded sim RNG is now OPT-IN** — cosmetic FX (explosion sparks, exhaust, smoke) and world decor used to draw from the seeded stream because `main.js` swapped a seeded `Math.random` in around `update()`/`reset()`, so *any* FX/decor change silently shifted the stream and desynced the recorded Level-0 intro (it broke three times: shield sphere, asteroid `.glb`, flipbook FX — and made a trace graphics-tier dependent). The stream now lives in `client/src/sim-core/sim-random.js` (`simRandom`/`seedSim`/`isSimSeeded`), the ~8 GAMEPLAY draw sites opt in explicitly, and `withSimRand`/`installSeededRandom` are gone, so new FX code is replay-safe by default. Adds a **return-home watchdog** (`CUTSCENE_STALL_TICKS`) so a re-sim that can never dock ends on the Level 1 briefing instead of looping, the missing end-of-trace exit in `__replay.step()`, and a committed headless guard `client/visual/scenarios/22-intro-replay.mjs` (re-sims the canonical trace, asserts 4 kills / cards p0..p4 / win). `assets:check` gained a recordings lane. The intro trace was **re-recorded** (purification necessarily invalidates the old one); older local `?playback` clips are invalid too. See DECISIONS §73. Previously: **FX polish shipped to prod: flipbook explosions + kinetic energy bolts** — ship-death fireballs are now a single camera-facing **flipbook (sprite-sheet) quad** (`flipbook-fx.js`, one draw call, one texture uploaded once) instead of a 4-sphere stack, and kinetic gunfire renders as a **travel-aligned glow bolt + muzzle flash** (`bolt-fx.js`) instead of a flat sphere; both are pure render (replay-safe) and cheaper on weak phones. Prototyped in the `/v2` sandbox, then promoted to `main`/prod + itch. Previously: **Deploy architecture documented + `/v2` sandbox planned** — the Deployment & CI/CD section now spells out **single-origin serving** (one container serves the static client via `express.static` + the `/api`, client reaches it via a baked same-origin `API_BASE`) and the **full CI deploy pipeline** (assets-check/pull → rsync → `docker compose build --build-arg GIT_SHA` → `docker rollout` blue-green → `/api/health` smoke); a new `docs/plans/v2-experimental-branch.md` + DECISIONS §72 record the **client-only `/v2`** FX-experiment sandbox — now **LIVE at vega.tenony.com/v2** (a standalone nginx container + Traefik `PathPrefix(/v2)` route, sharing the prod `/api`+DB; prod `app` untouched). Previously: **Shield hits land on the bubble sphere** — while a shield is UP, hostile shots are now intercepted on the shield **sphere** (`SHIELD_RADIUS = 4`, shared by `collision.js` + `shield-fx.js`) instead of the hull: `resolveHostileBulletHit` swept-tests the shot against the sphere (pure ray-sphere `segmentSphereHit`) and returns the sphere-entry `impact`; `sim.js` snaps the bullet there so the hit-flash + ripple appear on the sphere, and the shield visibly *stops* the shot. A broken/absent shield reverts to the hull swept test. Wider/rounder hitbox while shielded (a few near-misses now caught) — verified the recorded intro still wins to the L1 briefing. See DECISIONS §68. Previously: **Enemy-bullet damage fix** — `applyPlayerDamage` was called but not imported in `sim.js` after the shield-ripple refactor (commit 51eec94), throwing a `ReferenceError` that aborted the frame and let hostile bullets tunnel through the player dealing no damage; the enemy-bullet→player hit resolution now goes through a pure, THREE-free, unit-tested `resolveHostileBulletHit` helper in `collision.js` (no free `applyPlayerDamage` symbol left in `sim.js`; FX/audio/culling stay inline in `sim.update()`). Previously: **Mission asteroid-field uses a real `.glb` model** — the up-close `asteroid-field` set-piece (field rocks + mining-rig host rocks) scatters random variants of a 3-mesh CC-BY rock pack (`asteroids_combat`, fog OFF), async-loaded via the shared `loadAsteroidPack`, with the procedural cratered icosahedra kept as the `?debug`/failure fallback. The **distant parallax backdrop stays procedural** (a model backdrop was ~1.6M tris — reverted). New `asteroids` build preset (spec-gloss→metal-rough, 256px WebP, `pruneSolidTextures: false`) + a `--prune-solid-textures` flag on `assets:build`. See DECISIONS §71. Previously: **Shield-hit FX** — a cosmetic shader **bubble** (`shield-fx.js`) now wraps the player ship while a shield is equipped: a faint idle Fresnel rim that **flashes + ripples from the impact point** on every absorbed hit (near-hemisphere gaussian ring, up to 6 concurrent), brighter on the breaking hit, and a **whole-sphere flash** when the shield finishes recharging. Pure render (no sim/RNG writes → replay-safe); driven by `spawnShieldHit`/`spawnShieldReady` from the damage + recharge sites and `updateShieldBubble` in the render loop. `applyPlayerDamage` moved from `projectiles.js` to `components.js` (now returns `{ absorbed, broke }` for the FX) so it's unit-testable; +5 tests. See DECISIONS §68. Previously: **Backend is Postgres-only** — the hand-maintained SQLite data layer (`db.js`) + the `migrate.js` runner + `migrations/001…023` were deleted; `db_postgres.js` was renamed to `db.js` (the single data layer) and `datastore.js` is now a static façade with `backend = 'postgres'`. The pool defaults to `postgres://localhost:5432/spacegame` so `npm start`/`reset.js` work with zero env; prod/CI set `DATABASE_URL`. `npm test` targets a local `spacegame_test` that a `pretest` step drops+recreates for a clean schema (folds in the old `test:pg`); CI runs one Postgres job. Pure maintainability refactor — no runtime behavior change. See DECISIONS §67. Previously: **Base shield component** — a new `shield` component type (6th type): the **Base shield** (id 31, capacity 20 / recharge 10 s / weight 0 / 500) sits in an **optional** `shield` slot on the starter ship and is **buyable**. Every incoming player-damage site (enemy bullets + rocket blast) now routes through `applyPlayerDamage(player, dmg)` (in `projectiles.js`), which absorbs into the shield first (`absorbDamage`) and spills only the **excess** to the hull; a fully-depleting hit breaks the shield and it recharges to **full** over `rechargeSec` (`shieldRecharge`, ticked in `sim.update`) — a **partial** shield holds indefinitely. HUD gained a **shield bar above a now-red health bar** (blue = active / purple = recharging); the standalone "Health" label was dropped. SQLite migration `023_backfill_shield.js` + Postgres back-fill grant the slot to existing players. Previously: **Language selector in Settings + intro cutscene** — the EN/RU toggle now appears in three places (welcome screen, **Settings modal** `#settings-lang`, **intro cutscene** `#cutscene-lang` top-left beside Skip), all fed by one re-localize entry point: `applyTranslations()` re-renders every mounted toggle host from a shared `langHosts` registry, so a non-`en` initial load highlights the right button on first paint; the cutscene toggle is a `<body>` sibling of `cutOverlayEl` (+ `stopPropagation`) so it never advances/skips the cutscene and is removed in `cutsceneEnd()`. Reuses the existing `setLanguage()` i18n path (live, no reload). Previously: **Intro → Take-off dead-screen fix + reset replays the intro** — `finishIntro()` now calls `rs.teardown()` + clears `G.replayMode` so `animate()` leaves the inert playback branch and the Level-1 Take-off runs the live sim; the playback/cutscene lifecycle state is one unit-tested `makeReplaySession()` object in `replay.js`. The intro trigger is now server-authoritative (pure `shouldPlayIntro()` gates on the served level's `introTrace` + the headless check, no client `introSeen` flag), so a genuine `reset-progress` replays the intro. Previously: **Level-0 intro cutscene SHIPPED (prod + itch)** — a new player, or reset progress, at Level 0 auto-plays the intro CUTSCENE from an S3 recording: event-driven text pauses (P0 opening card; P1/P2 = 1st/2nd kill; P3 = rocketeer warp-in; P4 = 2nd rocket, each +1s) over a real re-simmed fight, then it simulates "Return to base", flies home to victory, **advances `current_progress` 1→2** and lands on the **Level 1 Main Window briefing** (restored `level.1.briefing` — "pirates raiding our home system"). Bootstrap `startIntroCutscene`/`finishIntro`; the canonical trace is a content-hashed S3 asset (`introTrace` on the `level-1` descriptor, pulled by `assets:pull`, bundled into the itch build). Gated server-authoritatively by `shouldPlayIntro` (served level carries `introTrace`, i.e. `current_progress===1`, + not headless); a `reset-progress` replays it. Headless (`?debug`/`?bench`) / no trace → the playable Level 0. Previously: **Combat record/playback (input-replay)** — a general `?record=1&level={id}` / `?playback&id={id}` mechanism that records a fight as INPUT + RNG seed and replays it on the REAL `sim` (real bullet colors, physics, FX, collisions), built to later carry the Level-0 cutscene / alt-angle views / video capture. `client/src/replay.js` (pure core, unit-tested) + `main.js` wiring. Record lands on the real ship idle with a **Start recording** button that unlocks after the model loads; capture is one input snapshot per sim tick; **Stop & Save** → localStorage + a `{id}.json` download + a **Play it ▶** link. Both modes pace the sim with a fixed-timestep accumulator (real-time on any refresh rate) and isolate the seeded `Math.random` to the sim ONLY (a private PRNG swapped in around `update()`/`reset()`; render/HUD/FX/audio/idle frames use the native RNG) so record↔playback reproduce a fight bit-for-bit regardless of frame rate / audio / model-load timing. `audio.js` pitch randomness moved to a module-local PRNG for the same reason. Trace: `{seed,dt,shipId,level,ticks:[{k,t}]}`; localStorage for the same-browser dev loop, and the canonical intro trace is an **S3 asset** (served same-origin via `assets:pull`, referenced from the seed's `introTrace`). The real new-player intro auto-plays this cutscene then lands on the Level 1 briefing. See the record/playback + cutscene subsections under Tools. Previously: **Intro "Level 0" first level** — a gentle, non-skippable opening level (3 basic pirates one at a time via `maxConcurrent 1` → 1 rocket-pirate finale, no boss, no reward, `enemyTotal 4`) is now the first level every new player plays. Implemented by keeping the seed names `level-1`..`level-4` (stable ids) and shifting the campaign descriptors down one id + appending `level-5` (old L4); the campaign keeps its "Level 1"-"Level 4" titles/rewards/briefings, one id higher. Existing players were migrated `+1` (SQLite migration 022 + a guarded `migrations_pg` one-shot on Postgres). On first launch the intro AUTO-LAUNCHES straight into the fight — no welcome screen, no "Take off" — flying the default player ship; Level 1+ landing is unchanged. New EN+RU `level.0.victory` string. Previously: **Ambient ghost battle** — a clearly visible looping recorded skirmish (near-opaque, full-color, below-plane (`y≈−60`) ghost ships with births+deaths + bullets, up to 16 slots) plays as a distant landmark at a FIXED ABSOLUTE world point (default `(−100,−450)`) in every mission EXCEPT the freighter escort; a committed transform-replay track (re-centered by a single fixed offset = the player's mean path, so the player flies FREELY, no birth/death jumps) replayed as a dumb lerped animation that never runs a second sim. Built in `sim.js reset()` gated `activeMission?.title !== 'freighter'`; self-skips under `?debug` AND `?bench`. Canonical track is a REAL battle recorded in-game via a `?dev` "Backdrop" panel (Start/Stop-record + REC readout + live Depth/Scale/Opacity/Anchor X/Anchor Z sliders, persisted `ghostTune`); synthetic `gen-backdrop.mjs` is a bootstrap. Tier-gated CONCURRENT ceiling (High 8 / Balance 4 / Performance off). Freighter render pos nudged +50 z to -400. See the ghost-battle subsection. Previously: **L2/L3 difficulty ease** — max simultaneous enemies in the non-boss spawning phases of **level-2 and level-3** lowered from 4 to **3 at a time** (`maxConcurrent`), matching level-1; `enemyTotal` (17/21) + boss phases unchanged. Previously: **Touch HUD overlap fix** — on touch the zoom `＋/−` pair moved to the top-right (under the Destroyed counter) so it no longer collides with the bottom-center Return-to-base button, now styled like the Take-off button (orange gradient). Previously: **Deterministic replay benchmark + perf-regression gate** — a standalone A/B tool (`?bench` + `client/bench/run.mjs` + `stats.mjs`) that replays a fixed input trace on the merge-base vs the worktree and flags a >2% CPU (`js.*`) regression; CPU-only, documented pipeline stage. See the perf-samples subsection. Previously: **Grab inverse-square field** — the Grab (tractor) now pulls drops via an Previously: **Explosion/hit FX unified onto the flipbook family + boss chain-detonation** — the ship-death burst is now the flipbook fireball + a soft expanding **shockwave ring** only (the old CPU **spark spray** is gone, DECISIONS §75); the ring is a **baked soft-ring texture on an additive quad** (`spawnShockRing`, shared with the rocket burst) not a hard `RingGeometry`; the **bullet hit-flash** is a small **flipbook mini-blast** (`spawnHitSprite`, same baked fire sheet, sized by weapon class) not an additive sphere. **Bosses** (`boss`/`boss2`) get a **staged chain detonation** (`spawnBossExplosion`): oversized primary + big ring, then a brighter **yellow secondary detonation** ~0.7 s later + its own ring + scattered small pops, via a deterministic deferred queue (`updateDeferredBlasts`, cleared on reset). The flipbook fireball is smoother + longer — sheet 6×6→**8×8 (64 frames, 2048px)** with **shader frame-blending** (synthesized in-between frames), ~1.8 s. **Rocket detonations** now use the same flipbook fireball + soft ring too (smaller/faster/brighter, white-hot), **fully weapon-driven** — `blastVisual`/`blastTimeScale`/`blastTint`/**`blastBright`** on the rocket weapon, so a new weapon type changes its blast with no code change. Pure render / replay-neutral (no `Math.random`/`simRandom`; intro guard bit-identical). See DECISIONS §75. Previously: **Exhaust FX live-tuning: flame is the default look + ship tails whip on turns** — after live tuning, the **flame** look is the shipped default (the `points` glow read as slow drifting particles, not engine thrust — now a `?dev`-only legacy option): an intense, fiery-orange (default until exotic/ion engines), short, dense jet with a bright hot core + fast flicker; the freighter plume is ~2× longer and hotter (its own `len`/`softness`). Ship tails no longer snap rigidly with the hull on a fast turn — each ship plume is **scene-parented and tracked to the hull with a smoothed yaw lag** (`syncShipPlume`, `k = 1 − e^(−8·dt)`), so the tail trails behind on a hard turn and settles straight in level flight (natural jet inertia; still no curved position-history). Flame length is now world-space (independent of hull scale). Pure render / replay-neutral. See DECISIONS §74. Previously: **Exhaust FX unified onto a shared GPU/baked-texture plume** — the cargo-freighter set-piece exhaust **and** every ship's engine trail were converted from per-frame CPU particle clouds to one additive, baked-texture-once, shader-driven **axis-aligned plume** (`client/src/exhaust-fx.js`; pure seams in `exhaust-config.js`), built once (no per-frame buffer re-upload). It ships **two selectable looks** — (a) **point-glow** / (b) **noise-scroll flame** — behind a `?dev` "Exhaust" tuning panel whose **Mode toggle is GLOBAL** (flips the freighter + all ships at once, `setGlobalExhaustMode`) with **freighter-only** palette/shape sliders + Copy JSON. The `trail` particle pool is **removed** (plumes attach lazily on first thrust, fade with throttle, and are disposed on death/reset/ship-swap). Replay-neutral — NO `Math.random`/`simRandom` in the FX (deterministic `hash(i)` seeds), no sim/damage/collision change; the `22-intro-replay` guard passes. `spec.exhaust` schema unchanged (+ optional `turbulence`/`softness`); no server/catalog/model change. Previously: **Top-bar credit balance + radar moved under the health bars** — the Main Window top-right now shows the player's balance as `<n> cr.` in credit-gold beside the inactive "Ships" label (`#mw-topright` wraps both; stacks into a right-aligned column below 780px so it clears the 4.5vw wordmark on phone landscape), pushed by `updateMenuCredits()` on menu entry + after every shop action; and the in-fight mini-map/radar left the vertical center of the left edge for the top-left HUD cluster, directly under the shield/health bars and left-aligned with them. Guard: `client/visual/scenarios/23-topbar-credits-radar.mjs`. Previously: **Intro replay desync fixed — the seeded sim RNG is now OPT-IN** — cosmetic FX (explosion sparks, exhaust, smoke) and world decor used to draw from the seeded stream because `main.js` swapped a seeded `Math.random` in around `update()`/`reset()`, so *any* FX/decor change silently shifted the stream and desynced the recorded Level-0 intro (it broke three times: shield sphere, asteroid `.glb`, flipbook FX — and made a trace graphics-tier dependent). The stream now lives in `client/src/sim-core/sim-random.js` (`simRandom`/`seedSim`/`isSimSeeded`), the ~8 GAMEPLAY draw sites opt in explicitly, and `withSimRand`/`installSeededRandom` are gone, so new FX code is replay-safe by default. Adds a **return-home watchdog** (`CUTSCENE_STALL_TICKS`) so a re-sim that can never dock ends on the Level 1 briefing instead of looping, the missing end-of-trace exit in `__replay.step()`, and a committed headless guard `client/visual/scenarios/22-intro-replay.mjs` (re-sims the canonical trace, asserts 4 kills / cards p0..p4 / win). `assets:check` gained a recordings lane. The intro trace was **re-recorded** (purification necessarily invalidates the old one); older local `?playback` clips are invalid too. See DECISIONS §73. Previously: **FX polish shipped to prod: flipbook explosions + kinetic energy bolts** — ship-death fireballs are now a single camera-facing **flipbook (sprite-sheet) quad** (`flipbook-fx.js`, one draw call, one texture uploaded once) instead of a 4-sphere stack, and kinetic gunfire renders as a **travel-aligned glow bolt + muzzle flash** (`bolt-fx.js`) instead of a flat sphere; both are pure render (replay-safe) and cheaper on weak phones. Prototyped in the `/v2` sandbox, then promoted to `main`/prod + itch. Previously: **Deploy architecture documented + `/v2` sandbox planned** — the Deployment & CI/CD section now spells out **single-origin serving** (one container serves the static client via `express.static` + the `/api`, client reaches it via a baked same-origin `API_BASE`) and the **full CI deploy pipeline** (assets-check/pull → rsync → `docker compose build --build-arg GIT_SHA` → `docker rollout` blue-green → `/api/health` smoke); a new `docs/plans/v2-experimental-branch.md` + DECISIONS §72 record the **client-only `/v2`** FX-experiment sandbox — now **LIVE at vega.tenony.com/v2** (a standalone nginx container + Traefik `PathPrefix(/v2)` route, sharing the prod `/api`+DB; prod `app` untouched). Previously: **Shield hits land on the bubble sphere** — while a shield is UP, hostile shots are now intercepted on the shield **sphere** (`SHIELD_RADIUS = 4`, shared by `collision.js` + `shield-fx.js`) instead of the hull: `resolveHostileBulletHit` swept-tests the shot against the sphere (pure ray-sphere `segmentSphereHit`) and returns the sphere-entry `impact`; `sim.js` snaps the bullet there so the hit-flash + ripple appear on the sphere, and the shield visibly *stops* the shot. A broken/absent shield reverts to the hull swept test. Wider/rounder hitbox while shielded (a few near-misses now caught) — verified the recorded intro still wins to the L1 briefing. See DECISIONS §68. Previously: **Enemy-bullet damage fix** — `applyPlayerDamage` was called but not imported in `sim.js` after the shield-ripple refactor (commit 51eec94), throwing a `ReferenceError` that aborted the frame and let hostile bullets tunnel through the player dealing no damage; the enemy-bullet→player hit resolution now goes through a pure, THREE-free, unit-tested `resolveHostileBulletHit` helper in `collision.js` (no free `applyPlayerDamage` symbol left in `sim.js`; FX/audio/culling stay inline in `sim.update()`). Previously: **Mission asteroid-field uses a real `.glb` model** — the up-close `asteroid-field` set-piece (field rocks + mining-rig host rocks) scatters random variants of a 3-mesh CC-BY rock pack (`asteroids_combat`, fog OFF), async-loaded via the shared `loadAsteroidPack`, with the procedural cratered icosahedra kept as the `?debug`/failure fallback. The **distant parallax backdrop stays procedural** (a model backdrop was ~1.6M tris — reverted). New `asteroids` build preset (spec-gloss→metal-rough, 256px WebP, `pruneSolidTextures: false`) + a `--prune-solid-textures` flag on `assets:build`. See DECISIONS §71. Previously: **Shield-hit FX** — a cosmetic shader **bubble** (`shield-fx.js`) now wraps the player ship while a shield is equipped: a faint idle Fresnel rim that **flashes + ripples from the impact point** on every absorbed hit (near-hemisphere gaussian ring, up to 6 concurrent), brighter on the breaking hit, and a **whole-sphere flash** when the shield finishes recharging. Pure render (no sim/RNG writes → replay-safe); driven by `spawnShieldHit`/`spawnShieldReady` from the damage + recharge sites and `updateShieldBubble` in the render loop. `applyPlayerDamage` moved from `projectiles.js` to `components.js` (now returns `{ absorbed, broke }` for the FX) so it's unit-testable; +5 tests. See DECISIONS §68. Previously: **Backend is Postgres-only** — the hand-maintained SQLite data layer (`db.js`) + the `migrate.js` runner + `migrations/001…023` were deleted; `db_postgres.js` was renamed to `db.js` (the single data layer) and `datastore.js` is now a static façade with `backend = 'postgres'`. The pool defaults to `postgres://localhost:5432/spacegame` so `npm start`/`reset.js` work with zero env; prod/CI set `DATABASE_URL`. `npm test` targets a local `spacegame_test` that a `pretest` step drops+recreates for a clean schema (folds in the old `test:pg`); CI runs one Postgres job. Pure maintainability refactor — no runtime behavior change. See DECISIONS §67. Previously: **Base shield component** — a new `shield` component type (6th type): the **Base shield** (id 31, capacity 20 / recharge 10 s / weight 0 / 500) sits in an **optional** `shield` slot on the starter ship and is **buyable**. Every incoming player-damage site (enemy bullets + rocket blast) now routes through `applyPlayerDamage(player, dmg)` (in `projectiles.js`), which absorbs into the shield first (`absorbDamage`) and spills only the **excess** to the hull; a fully-depleting hit breaks the shield and it recharges to **full** over `rechargeSec` (`shieldRecharge`, ticked in `sim.update`) — a **partial** shield holds indefinitely. HUD gained a **shield bar above a now-red health bar** (blue = active / purple = recharging); the standalone "Health" label was dropped. SQLite migration `023_backfill_shield.js` + Postgres back-fill grant the slot to existing players. Previously: **Language selector in Settings + intro cutscene** — the EN/RU toggle now appears in three places (welcome screen, **Settings modal** `#settings-lang`, **intro cutscene** `#cutscene-lang` top-left beside Skip), all fed by one re-localize entry point: `applyTranslations()` re-renders every mounted toggle host from a shared `langHosts` registry, so a non-`en` initial load highlights the right button on first paint; the cutscene toggle is a `<body>` sibling of `cutOverlayEl` (+ `stopPropagation`) so it never advances/skips the cutscene and is removed in `cutsceneEnd()`. Reuses the existing `setLanguage()` i18n path (live, no reload). Previously: **Intro → Take-off dead-screen fix + reset replays the intro** — `finishIntro()` now calls `rs.teardown()` + clears `G.replayMode` so `animate()` leaves the inert playback branch and the Level-1 Take-off runs the live sim; the playback/cutscene lifecycle state is one unit-tested `makeReplaySession()` object in `replay.js`. The intro trigger is now server-authoritative (pure `shouldPlayIntro()` gates on the served level's `introTrace` + the headless check, no client `introSeen` flag), so a genuine `reset-progress` replays the intro. Previously: **Level-0 intro cutscene SHIPPED (prod + itch)** — a new player, or reset progress, at Level 0 auto-plays the intro CUTSCENE from an S3 recording: event-driven text pauses (P0 opening card; P1/P2 = 1st/2nd kill; P3 = rocketeer warp-in; P4 = 2nd rocket, each +1s) over a real re-simmed fight, then it simulates "Return to base", flies home to victory, **advances `current_progress` 1→2** and lands on the **Level 1 Main Window briefing** (restored `level.1.briefing` — "pirates raiding our home system"). Bootstrap `startIntroCutscene`/`finishIntro`; the canonical trace is a content-hashed S3 asset (`introTrace` on the `level-1` descriptor, pulled by `assets:pull`, bundled into the itch build). Gated server-authoritatively by `shouldPlayIntro` (served level carries `introTrace`, i.e. `current_progress===1`, + not headless); a `reset-progress` replays it. Headless (`?debug`/`?bench`) / no trace → the playable Level 0. Previously: **Combat record/playback (input-replay)** — a general `?record=1&level={id}` / `?playback&id={id}` mechanism that records a fight as INPUT + RNG seed and replays it on the REAL `sim` (real bullet colors, physics, FX, collisions), built to later carry the Level-0 cutscene / alt-angle views / video capture. `client/src/replay.js` (pure core, unit-tested) + `main.js` wiring. Record lands on the real ship idle with a **Start recording** button that unlocks after the model loads; capture is one input snapshot per sim tick; **Stop & Save** → localStorage + a `{id}.json` download + a **Play it ▶** link. Both modes pace the sim with a fixed-timestep accumulator (real-time on any refresh rate) and isolate the seeded `Math.random` to the sim ONLY (a private PRNG swapped in around `update()`/`reset()`; render/HUD/FX/audio/idle frames use the native RNG) so record↔playback reproduce a fight bit-for-bit regardless of frame rate / audio / model-load timing. `audio.js` pitch randomness moved to a module-local PRNG for the same reason. Trace: `{seed,dt,shipId,level,ticks:[{k,t}]}`; localStorage for the same-browser dev loop, and the canonical intro trace is an **S3 asset** (served same-origin via `assets:pull`, referenced from the seed's `introTrace`). The real new-player intro auto-plays this cutscene then lands on the Level 1 briefing. See the record/playback + cutscene subsections under Tools. Previously: **Intro "Level 0" first level** — a gentle, non-skippable opening level (3 basic pirates one at a time via `maxConcurrent 1` → 1 rocket-pirate finale, no boss, no reward, `enemyTotal 4`) is now the first level every new player plays. Implemented by keeping the seed names `level-1`..`level-4` (stable ids) and shifting the campaign descriptors down one id + appending `level-5` (old L4); the campaign keeps its "Level 1"-"Level 4" titles/rewards/briefings, one id higher. Existing players were migrated `+1` (SQLite migration 022 + a guarded `migrations_pg` one-shot on Postgres). On first launch the intro AUTO-LAUNCHES straight into the fight — no welcome screen, no "Take off" — flying the default player ship; Level 1+ landing is unchanged. New EN+RU `level.0.victory` string. Previously: **Ambient ghost battle** — a clearly visible looping recorded skirmish (near-opaque, full-color, below-plane (`y≈−60`) ghost ships with births+deaths + bullets, up to 16 slots) plays as a distant landmark at a FIXED ABSOLUTE world point (default `(−100,−450)`) in every mission EXCEPT the freighter escort; a committed transform-replay track (re-centered by a single fixed offset = the player's mean path, so the player flies FREELY, no birth/death jumps) replayed as a dumb lerped animation that never runs a second sim. Built in `sim.js reset()` gated `activeMission?.title !== 'freighter'`; self-skips under `?debug` AND `?bench`. Canonical track is a REAL battle recorded in-game via a `?dev` "Backdrop" panel (Start/Stop-record + REC readout + live Depth/Scale/Opacity/Anchor X/Anchor Z sliders, persisted `ghostTune`); synthetic `gen-backdrop.mjs` is a bootstrap. Tier-gated CONCURRENT ceiling (High 8 / Balance 4 / Performance off). Freighter render pos nudged +50 z to -400. See the ghost-battle subsection. Previously: **L2/L3 difficulty ease** — max simultaneous enemies in the non-boss spawning phases of **level-2 and level-3** lowered from 4 to **3 at a time** (`maxConcurrent`), matching level-1; `enemyTotal` (17/21) + boss phases unchanged. Previously: **Touch HUD overlap fix** — on touch the zoom `＋/−` pair moved to the top-right (under the Destroyed counter) so it no longer collides with the bottom-center Return-to-base button, now styled like the Take-off button (orange gradient). Previously: **Deterministic replay benchmark + perf-regression gate** — a standalone A/B tool (`?bench` + `client/bench/run.mjs` + `stats.mjs`) that replays a fixed input trace on the merge-base vs the worktree and flags a >2% CPU (`js.*`) regression; CPU-only, documented pipeline stage. See the perf-samples subsection. Previously: **Grab inverse-square field** — the Grab (tractor) now pulls drops via an
inverse-square field (`field = strength·5/dist²`, engaged where `field ≥ 0.4`); reach is emergent +
weight-independent (base ≈11.2 u, Advanced ≈15.8 u = √2× base). Reel-in speed is a **linear ramp** by
distance (1 u/s far → 4 u/s at the ship, weight-scaled) — un-physical but no near-ship jerk, replacing the
`1/dist²` field speed; speed depends on distance + weight only, not strength — see **Grab & loot drops**. Prior: **Admin "device" column** — `GET /admin` now shows a best-effort
`Browser · Device/OS` label per player (`Chrome · Galaxy A03s` → `Chrome · Android 10` → raw UA → blank);
`players` gained nullable `user_agent` + `device_model` columns (migration 021 / PG bootstrap) captured at
the boot register call latest-wins, via an `Accept-CH: Sec-CH-UA-Model` response header + client hint;
parsing + a curated code→name lookup live in `server/src/admin.js` (`deviceLabel`) — see the Admin
dashboard section. Prior: **Return-to-base button** — a bottom-center "Return to base" pill button
(`#return-btn`, i18n `ui.return.button`) now appears during return-to-base as an explicit tap target that
auto-flies the ship home (same as clicking the station); shown only while return-to-base is available and the
ship is under player control, hidden once the autopilot engages; touch fires on `touchstart` / mouse on
`click` per DECISIONS §42 — see the Return-to-base section. Prior: **PC menu layout** — on non-phone forms the start/welcome screen top-aligns the
greeting/intro + Take-off, and the Main Window left column is widened to `minmax(240px, 18%)` so the
top-left account bar no longer clips the mission title; see the Welcome + Main Window sections. Prior:
**deterministic spawn totals + enemy warp-in-as-arrival** — every spawning phase
now carries an explicit `total` cap (threshold phase `total` = its kill-delta → 0 enemies alive at advance;
clear-out/finale waves carry the remainder), so `enemyTotal` is the exact sum of phase totals — fixing a
staggered-spawns regression where the killed/total counter stopped short and the last-kill reward drops
(L1 Machine Gun, L2 Repair drone) never fired. L1 total is now 14 (was 16). A spawning enemy appears
immediately as a dot and **materializes over its 2–4 s stagger interval** — invulnerable, non-firing, and
not homing-targetable until fully formed (`e.warping`/`e.spawnDur`; player warp-back stays 1 s). Prior:
**staggered enemy spawns** — enemies trickle in one at a time on a
randomized 2–4 s cooldown (`client/src/sim-core/spawn-timing.js`), first-of-phase immediate, instead of the arena
snapping to `maxConcurrent` every frame. Prior: **combat pacing + engine buff** — flat player top speed 30 u/s, all engine
`power` +50%, 5 s enemy hold-fire grace at run start, and each run opens gliding forward at 3 u/s. Prior:
**base station moved off-origin** — the return-to-base station was pushed from
`(-20,-20)` to `(-60,-60)` so the origin-spawning ship is no longer framed against its backdrop (it now
sits at `(-10,-10)` — see below). Prior:
**Welcome screen: dropped the L1 ship picker + pinned Take off** — the Level-1
welcome (`#welcome`) is now a fixed CSS grid (`1fr auto`): a scrollable greeting/intro cell (`#welcome-scroll`)
over a pinned footer (`#welcome-footer`, Take off + community link), so the **Take off** button is always
on-screen regardless of content height (on **non-phone/PC forms** the greeting/intro + footer are top-aligned
rather than vertically centered — see the Mobile menus section), replacing a centered-flex column whose `justify-content:center` +
overflow clipped the unreachable *top* of the intro on short viewports. The decorative single-ship picker
(`.pick` + `#ship-choices` cards) was removed (L1 owns exactly one ship). Prior: **HUD overhaul + item rarity/color** — the HUD credits readout is now one line
`credits {total}/{earned} earned` and the live **Enemies** counter is removed; a small **event log** above
the rocket button shows the last 4 lines (kill: `{shipname} killed +{amount}`; pickup: `picked up {name}`
tinted by the item's color), each fading over 5 s (`client/src/eventlog.js`); dropped loot now glows in its
own rarity color (trash white / common green / rare blue); on **touch** the zoom `＋/−` pair sits at the
**top-right, under the Destroyed counter** (moved off the bottom-center so it never collides with the
Return-to-base button). New `rarity`/`color` columns on `components`/`weapons` (migration 020 + Postgres parity)
drive the glow + tint. Prior: **Staged briefing reveal (L1-3)** — the L1 welcome briefing and the L2/L3 Main
Window campaign briefing now **type out over ~5 s** (`client/src/typewriter.js`), then reveal the
granted-item showcase (L1 has no picker), then the **Take off** button **+0.5 s** later;
**tap the briefing text to skip**; plays once per landing; the L1 `.intro` was enlarged to 26px; L4+ and
side missions stay instant. Prior: **L1/L2 reward drops** — the last enemy of Level 1 drops the Machine Gun model, and
the last enemy of Level 2 the Repair drone, as a **green-glowing, green-haloed cosmetic battlefield drop** with
a **pulsing green off-screen pointer** (`.drop-marker.special`), shown only when the reward isn't already owned
(`lastKillDrop` on the L1/L2 descriptors + `ownsReward`); collecting it deposits **nothing** — the one
guaranteed copy still comes from the **unchanged** server force-install on victory, so a player never ends with
two; the L2/L3 briefings were reworded to a "you recovered it" framing (EN + RU), item still spinning; no
asset/hash/itch changes. Prior: **Milestone banners** — a big, semi-transparent HUD line flashes and fades over 3 s at "10 enemies left", "5 enemies left" (from `enemyTotal − kills`) and "Final Stage" (entering the boss/finale phase); `#banner` + `showBanner`/`updateBanner` in `sim.js`, once per run. Prior: **In-game Credits/attributions screen** — a player-facing Credits panel opened from the Settings gear, listing every third-party 3D model (full CC-BY 4.0 attribution + license link + "Modified") and music/sound (CC0/Pixabay courtesy), build-generated from `client/assets/CREDITS.md` via `npm run credits:build` → committed `client/src/credits-data.js`, drift-guarded by a unit test and regenerated into the itch zip by `build:itch`; satisfies the CC-BY 4.0 obligation to show attributions to players. Prior: **Fixed bullet plane + model `lift` — top-down aim fix** — formalized the single combat plane as `state.js` `BULLET_PLANE_Y` (0.6) that every ship group sits on and all bullets fly in (spawn/recenter/ring-FX reference it, no bare `0.6`); new per-model signed `model.lift` moves a ship's visual model *and* its hitboxes together so an off-plane hull seats onto it; `assets:hitboxes` reports bullet-plane coverage + a robust (plateau-centre) suggested lift per ship. **All 9 modeled ships tuned to max coverage** (player `0.18`, enemy_1 `0.21`, enemy_2 `0.17`, enemy_3 `0.2`, enemy_4 `-0.132` — boss lowered). Prior: **Asset cleanup** — deleted 28 stale/unused S3 builds (`ships-combat/` 16, `ships-hangar/` 12) + 19 stale local pulled files; `git rm`'d 16 unreferenced legacy primitive glbs from `client/assets/`; pre-load fallback is procedural, not a binary. Prior: **Triple spiral rocket + fading-line rocket trail** — new 4000-credit shop rocket
(id 11): an invisible homing leader defines the path while three visible cyan warheads spiral around it,
each a real rocket (own power 40 / HP 10, independent detonation + shoot-down; 3× on a full hit). The
standard rocket smoke trail changed from an expanding sphere cone to a thin, fixed-size fading haze line
(now particle-budget-capped); the spiral volley reads as three intertwined smoke helices.)
(**Convex-decomposition OBB ship hitboxes** — each real-model ship now collides as
one **oriented bounding box per near-convex part** (broad-phase enclosing sphere → point-vs-OBB narrow-phase)
instead of a multi-sphere fit; the combat glb is decomposed with V-HACD (`vhacd-js`, memory-capped) and each
hull wrapped in a tight PCA box, generated by `assets:hitboxes` into `model.hitBoxes`/`broadR`, wired at all
four bullet/rocket↔ship sites plus the rocket blast-damage loop (player included), with a `?hitboxes`
wireframe overlay. Bullets use a **swept** segment test (no tunneling through thin boxes); tight fit → bullets
miss in the empty gap beyond a thin wing. **Known accepted limitation:** off-y=0 model elements (low wings /
drooped noses) aren't hit by centre-aimed shots — a model-choice factor; global fix scheduled in ROADMAP.
**Per-model workaround:** a `model.lift` (signed group-local Y, pre-scale) moves the visual model *and* its
hitboxes together so a hull that sits off the fixed bullet plane (`BULLET_PLANE_Y`) seats onto it (positive
raises, negative lowers; all 9 modeled ships tuned — see the model-presentation section). The
`assets:hitboxes` run reports bullet-plane coverage + a suggested lift per ship so this isn't missed.
Supersedes the same-branch
multi-sphere iteration.)
(**Enemy HP bar floats above the model on screen** — anchored along the camera's screen-up axis, not world
+Y (which points nearly *at* the near-top-down camera), so it sits clearly above the ship on the 2D screen.)
(**Weapon hit/explosion FX** — bullet hit-flash is a small **flipbook mini-blast** (`spawnHitSprite`)
sized by the weapon `class` (`HIT_FLASH_SCALE`: kinetic tiny spark / cannon small flash); rocket
detonation is the same flipbook fireball + soft ring (`spawnRocketBurst`), smaller/faster/brighter, fully
weapon-driven (`blastVisual`/`blastTimeScale`/`blastTint`/`blastBright`); the ship-death
burst is the flipbook fireball + a soft shockwave ring (no sparks), and bosses get a staged chain
detonation — see the FX subsection below + DECISIONS §75.)
(**Procedural nebula skybox** — `skyScene.background` is now a baked procedural
nebula + star-field cubemap (`makeNebulaSky`), tier-gated and skipped under `?debug`; see Visuals + DECISIONS §43.)
(**Touch tap-vs-drag** — `#stick-zone` now covers the whole play area (`inset:0`); a
single-finger gesture within `TAP_SLOP = 10px` is an object tap (shared `engageObjectAt` raycast — chests +
the return-to-base station are tappable *anywhere*), beyond 10px is the steering stick; a 2nd finger = pinch
(counts `targetTouches`, so holding FIRE while steering still steers); the rocket + zoom buttons layer above
the full-screen zone and the zoom `+`/`−` fire on `touchstart` so they work during active flight. Previously:
**Enemy health bars** — a translucent-red bar floats above each enemy, shown only
once its HP drops below max. Previously: **Interactive chests** — loot drops are now clickable: clicking a chest engages
autopilot toward it (in combat or return-to-base), a `grab` hand cursor shows on hover (mouse), chests are
brushed silver so they read against dark space, and off-screen chests get their own green edge arrows. Autopilot
gained a typed target (station|drop); the mission-win dock fires only when the target is the station. Every
existing player was granted the base Grab (migration `019_backfill_grab` + Postgres parity). Also 2026-07-03:
**Grab component + enemy equipment drops** — a new optional tractor-beam component:
enemies have a 20% chance on death to drop a piece of their gear as a metal-box the Grab pulls in (range =
strength, speed = (strength/2)·(10/weight)); collected drops deposit into the stash on victory only; hulls
never drop; pirate parts now priced for resale but hidden from the shop (`buyable:false`); `REFERENCE_MASS`
48→50 so the base grab is mass-neutral; metal-box model shipped through the asset pipeline (703 KB→~6 KB).
Also 2026-07-03: **Autopilot + return-to-base mission end** — a **base station** `.glb` set-piece now
sits just up-left of the arena center at `(-10,-10)`, and **every** mission (campaign L1–4 + the three side missions) ends by flying
**back to it** instead of on the last kill. After the last enemy dies the out-of-bounds warp-back is lifted, a
translucent **blue homing arrow** anchored to the ship points home, and a centered **"Sector cleared — return to
base"** hint shows; the station becomes **clickable** and tapping it is a **mandatory dock** that engages
**autopilot** (brake → rotate to face → accelerate → kinematic brake to a stop next to it) — the existing victory
fires on arrival within `BASE_ARRIVE_RADIUS` (45u). Proximity alone never wins; any control input cancels the dock
(re-tap to resume). Enemies now spawn in a ring around the **mission-zone center (`arenaCenter`)**, not the hero.
The station is a below-plane, non-collidable decor (like the freighter) raised nearer the plane, its top tuned
below the ships so it never occludes them. Previously: **Kill credit popups** — destroying an enemy floats a green `+xx` popup up from
the kill site showing credits earned, holding then fading over ~2 s; pooled DOM overlay projected each frame like the
enemy edge markers, skipped for reward-0 kills. **Freighter set-piece is now a real `.glb` model** — the "save the transport"
cargo freighter dropped its procedural box hull (spine/bridge/cargo/engine/nozzles) for the CC-BY
"Freighter - Spaceship" combat glb (`freighter_combat`, first `.glb`-backed set-piece; standalone loader in
`world.js` reusing `ship-factory.js`'s `gltfLoader`, auto center/scale/`yaw`-oriented). The fiery exhaust
stays but is now a single rear-center emitter re-derived from the model's real bounds, and its palette +
particle params became an optional server-delivered `exhaust:` config on the set-piece spec (defaults built
in). Previously: **Basic pirate hull now metallic** — the grey `black_mat_for_body_0` material
(hull/wings of `enemy_1` + its orange gunner variant) went from flat matte to metalness 0.8 / roughness
0.22 in the source glbs so it reflects the RoomEnvironment env-map like the metallic parts; combat+hangar
glbs rebuilt + rehashed in `catalog_seed.js`, `enemy_2/3/4` and CREDITS untouched. Previously: **HUD
Destroyed counter now killed/total** — the on-screen kill counter shows
`killed/total`; total is precomputed on the server from each descriptor's phase script
(`enemyTotalFromPhases` → `descriptor.enemyTotal`). Also: **admin panel + referrer capture** — a private server-rendered `GET /admin`
dashboard [`server/src/admin.js`] lists every registered player + per-player game aggregates behind HTTP
Basic Auth [`ADMIN_USER`/`ADMIN_PASSWORD`, 404 when unset]; a new write-once `players.referrer` column
[migration 018 / PG bootstrap] captures `document.referrer`+`?ref=`/UTM at boot; see the Admin dashboard
+ Referrer capture bullets in Backend). Prior: perf/FPS overlay is now dev-only — hidden by default, shown
only under the `?dev` flag via the new `client/src/dev.js`/`isDev()`; see the Perf overlay bullet below.
Prior: device-support architecture [iteration 1] + desktop Main Window polish — a two-axis
device model in `client/src/device.js` replaces the old `isTouch` boolean: an **input** axis [`touch`/`mouse`,
~constant per session] and a **form** axis [`phone`/`tablet`/`desktop`/`desktop-lg`, recomputed on resize;
`phone` is decided by the viewport's **shortest** edge [`< 600` CSS px], the larger tiers by the **longest**
edge [`< 1280` tablet, `< 1920` desktop, else desktop-lg] — both orientation-invariant, and the short-edge
phone test keeps large/foldable phones [Galaxy Fold cover ≈ 369×905, iPhone Pro Max] on phone chrome even
after fullscreen hides the browser chrome and grows the long edge past 900], projected onto `input-touch|input-mouse` + `dev-phone|dev-tablet|dev-desktop|
dev-desktop-lg` body classes [`body.touch` kept as a compat alias]; the desktop [`dev-desktop(-lg)`] Main Window
now reads bigger/cleaner [32px title, 26px text, ×2 ship-stats on one line (a Loadout-only strip today), granted item centered below the text,
fixed-height Loadout/Stash/Shop, Take-off following the content]; mobile/touch unchanged; itch.io HTML5 export — `npm run build:itch` assembles a static ZIP that runs on itch.io and talks to the live backend; client `/api` calls go through a baked `API_BASE` [`client/src/api-base.js`: empty same-origin, prod origin on the itch build]; server gained `/api` CORS [reflect Origin, no credentials] + dual-path bearer-token auth [login/register/reset return the token in the body, `Authorization: Bearer` accepted alongside the cookie]; self-service password reset — forgot-password → emailed `/?reset=TOKEN` link → new-password modal; enumeration-safe endpoint [always 200], 1 h token TTL, all sessions invalidated + email auto-verified on reset, auto-login after; migration 017 + Postgres parity; EN+RU strings; hangar no longer crashes when a required slot [hull/engine/thruster] is unequipped — `buildPlayer`/`deriveDrive` are null-safe and the Take-off gate blocks launch; briefing-showcase strut height now subtracts the gun's 8px margin so the Main Window briefing no longer grows a phantom scrollbar; component/weapon 3D models — items now carry an optional hangar `model_url_high` like ships [migration 016], shown as a spinning menu icon via the generalized ship-or-item preview; first two item models = Repair drone + Machine Gun; mission briefings showcase the granted item [MG on L2, repair drone on L3] spinning at full size in a viewer floated into the BOTTOM-RIGHT CORNER of the mission text (the text wraps around it via the classic strut+float trick) via a server-derived `showcase {kind,id}`; fixed a Postgres auth-session race [await the session insert]; Main Window redesign — the between-battles screen dropped the "Hangar" name for a fixed landscape layout: top bar (gear + nickname/auth + enlarged Vega Sentinels wordmark + inactive Ships), left menu (Missions/Loadout/Stash/Shop), center work zone, and a 25% right column [then a live ship-model preview, since replaced by the mission list]; the side-mission board + modal moved into the left menu's collapsible Missions list (campaign primary + side secondary), the shop bay opens in the work zone, code/DOM/i18n renamed hangar→main/mw; machine-gun/kinetic fire SFX trimmed −30% via DB per-sound gain; enemies renamed enemy→pirate; advanced tier uses orange ship models; low-end-phone perf: measured on two GPUs that the weak-device bottleneck is **CPU
draw-call submit + thermal governor, NOT fill rate** — so the sub-native `renderScale` knob was **removed**
(blurred for no gain), a shader **pre-warm** kills the 0.4-2.2s first-frame freeze, and a `maxParticles` 300
ceiling caps the weakest tier; a **`?dev` perf monitor** samples per-frame JS-cost breakdown + device/GPU
passport + JS heap once a second to `POST /api/perf` → `perf_samples` table; per-ship model presentation
consolidated into a documented `stats.model` block — yaw/scale + optional muzzle/exhaust spawn overrides — replacing loose `modelYaw`/`sizeScale` keys (back-compat reads kept); new `docs/plans/adding-a-ship-model.md` convention; player ship = real textured "Air & Space Vessel" model (downscaled textures → player_combat/_hangar, model.scale 1.1); tier-gated env-map reflections on ships; muzzle/exhaust spawn from the model's real nose/tail bounds; enemy weapon fire silenced (rocket detonations kept); "Reset my progress" in settings (slide-to-confirm → POST /reset; modal shrunk to fit); ships bank their wings into turns, capped 20° (cosmetic, player + enemies); rocketeer/medium/first-boss now use real low-poly models enemy_2/3/4_combat; background music = looping sampled tracks per scene via the sound_map (generative synth removed); SFX routing moved to DB — `sounds`/`sound_map` tables + ship/weapon `class`, `/api/sounds`, no client hardcoding; sampled SFX: kinetic/rocket/cannon + ship hit + ship explosions (shipBoom/blast); `?tune` dev palette panel; `stats.modelYaw`; bright-star layer; arena ±360 + shifted mission set-pieces; graphics quality tiers; mobile forced to landscape by rotating the whole body 90° in portrait (CSS `body.rot`; renderer/touch run in swapped game dims via applyOrientation/gameW/gameH/toGame); the four inline "⛶ Full screen" buttons replaced by one floating, icon-only, brighter bottom-right button that hides once fullscreen)

## What this is
**Vega Sentinels** — a browser prototype built on Three.js (`client/index.html`): little spaceships
fighting on a plane. Opens in a browser with no installation (Three.js from a CDN).

## Controls
- `W`/`↑` — thrust forward, `S`/`↓` — **brake** (bleeds the velocity to a stop at the ship's own `accel`,
  the same kinematic decel the autopilot uses). **There is no reverse** — the ship can never be pushed
  backwards along its nose (DECISIONS §113). Holding `W`+`S` thrusts (forward wins); the pure seam is
  `keyboardThrust(keys)` in `client/src/sim-core/steering.js`, consumed by `stepPlayer` in `client/src/sim.js`
- `A`/`D` or `←`/`→` — turn the nose
- `Space` — fire (primary weapon)
- `F` — rocket (homing, 5 s cooldown)
- The bottom-left **`#help` cheatsheet** carries these bindings (`ui.help`) — and on a touch device it
  carries a **touch variant** instead (`ui.help_touch`: *drag anywhere* to steer · FIRE · 🚀 — the virtual
  stick spawns under the finger wherever it lands, since `#stick-zone` is `inset: 0`), swapped once in
  bootstrap on `Device.input === 'touch'`. It used to be hidden outright on touch; it is on screen there now
  (the Level-0 intro's controls card flies into it, and a `display:none` target measures as a zero rect), and
  it sits at `bottom: 26px` so it clears the always-on XP bar, whose top edge is 20px off the bottom.
- `M` — **toggle the system-map overlay** (keyboard, so desktop by construction; works on a tablet with a
  keyboard attached). Gated exactly like the on-screen **Map** button: only **out of combat** (`G.roam` /
  return-to-base) — during a live fight the corner is the battle radar, there is no map to open, and since
  the overlay freezes the sim (`G.mapOpen`) an ungated M would be a way to pause a fight. Ignored when a
  modifier is held (**Cmd+M must stay "minimise window"** on macOS) and while typing in a field. It is
  wired separately from the sim's global keydown — that one mirrors every code into `keys` for the input
  recorder, and this is UI, not input. The Map button carries the shortcut in its `title` on mouse devices
  (`ui.map.shortcut`, EN+RU); the `#help` cheatsheet deliberately does NOT list it, because that line is
  the COMBAT cheatsheet and M does nothing there.
- **Autopilot (station or loot chest)** — after the last enemy is destroyed the **base station** (at
  `(-10,-42,-10)`, just up-left of the arena center) becomes clickable; **clicking/tapping it** (a canvas raycast,
  ignored on HUD buttons — on touch it's a **slop-gated tap**, a single finger that moved <10px, not a
  raw touch-anywhere; both desktop click and touch tap route through the shared `engageObjectAt` pick) engages autopilot,
  which flies the ship home: **brake to a stop → rotate the nose to face the target → accelerate at max →
  kinematic symmetric-decel brake** so it coasts to a stop right next to it. The **same autopilot also flies
  to a clicked loot chest** (combat and return-to-base — see Grab & loot drops); on overlap a chest wins over
  the station. On **desktop/mouse**, hovering the clickable station swaps the cursor to a first-party
  **"dock/landing" glyph** (`client/assets/ui/dock-cursor.png`, a raster PNG since Safari has no SVG cursors;
  `pointer` fallback), and hovering a chest shows the OS **grab hand** (`canvas.grab-cursor`, wins over the
  dock cursor) — throttled canvas raycasts toggle the classes, gated to mouse input (`!Device.hasTouch`).
  Only a **station**-targeted autopilot reaching `BASE_ARRIVE_RADIUS` ≈ 45u of the station's position completes the mission. **Any control input** — move (`W/S/A/D`, arrows,
  touch stick), fire (`Space`/FIRE), or rocket (`F`/🚀) — instantly cancels autopilot and returns control; a
  cancelled dock does not win (re-tap the station to resume). See the Level flow / Victory section.
- **Autopilot (roam point)** — a third target kind `{kind:'point', pos, mission?}` (`engagePointAutopilot`,
  allowed out of combat only). It flies the ship to a fixed world coordinate picked on the system-map screen;
  a **`point` autopilot never wins a mission by proximity** (only `station` docks). On arrival at rest it
  parks; if it carries a mission id **whose offer exists** it shows the **"Start mission?"** prompt (see the
  Star system / navigation section). Manual input still cancels it (mid-journey override).
- **Zoom** — **PC:** mouse **wheel** (scroll up = closer) + on-screen **＋/−** buttons (right edge,
  vertically centered — unchanged). **Mobile:** the buttons (**top-right, a vertical `＋/−` column under the
  Destroyed X/Y counter** — clear of the bottom-center Return-to-base button; `body.touch #zoom` override) +
  two-finger **pinch**. Zoom scales the fixed
  camera offset along its angle within `0.35–3.5×`, **eases smoothly** toward the target (~0.2 s, frame-rate
  independent) instead of snapping, and is **persisted** across runs (`localStorage` key `camZoom`). On touch
  the `+`/`−` buttons fire on **`touchstart`** (like FIRE/🚀), not a synthesized `click`, and sit `z-index:6`
  above the full-screen stick zone — so they (and two-finger pinch) stay usable **during active flight**
  (a `click` is only synthesized for a single-touch tap; the browser suppresses it while a steering finger is
  down, which is why the old click-based buttons were dead during flight — see DECISIONS §42). The `click`
  path is kept **mouse-only** so a touch tap doesn't double-zoom.
- **Touch (mobile browsers) — tap-vs-drag over the whole play area.** `#stick-zone` now covers the entire
  play area (`inset:0`, not the old left 58%), and a single-finger gesture is disambiguated by **movement
  slop**: a gesture that stays within **`TAP_SLOP = 10px`** of its touchstart point (measured in the rotated
  game space, `toGame` coords — the same space as the stick, so slop and the ~12px dead zone are
  apples-to-apples) is an **object TAP** that runs the **same raycast as the desktop click** (nearest live
  loot chest wins over the base station → `engageObjectAt` → `engageDropAutopilot`/`engageAutopilot`); once
  the gesture travels **>10px** it becomes the **floating steering stick** (angle = desired nose direction,
  deflection = thrust) for the rest of that gesture. Steering and object taps both work **anywhere** on
  screen. The stick base/knob **appears immediately** on touchstart (a tap may briefly flash it), but a tap
  never engages steering (a ≤10px deflection is inside the dead zone, and `dragged` gates the classification).
  The pure classifier is `client/src/tap-gesture.js` (`exceedsSlop`, unit-tested). A **2nd finger on the play
  area = pinch-zoom**, which aborts the in-progress stick/tap; pinch counts **`e.targetTouches`** on
  `#stick-zone` (not all screen fingers), so a finger held on **FIRE**/🚀 (sibling targets) isn't counted and
  **holding FIRE while steering** is preserved. On the right are the "FIRE" and "🚀" (rocket) buttons, and the
  zoom `+`/`−` buttons — all layered **above** the now full-screen stick zone (`#fire-btn` is a later
  `#touch` child in the z-5 context; `#rocket-btn` and `#zoom` are `z-index:6`). Shown only on touch devices.
- **Landscape on phones (forced via rotation):** touch devices always play in landscape. When a phone is
  held in **portrait**, the whole `<body>` is rotated 90° in CSS (`body.rot`, `transform: translateX(100vw)
  rotate(90deg)`) and the game runs in the **swapped** dimensions — the browser can't widen its viewport
  past the physical screen and `screen.orientation.lock` is unsupported on iOS Safari, so a CSS rotation is
  the only cross-browser way to render horizontally on a portrait screen. `applyOrientation()` (called at
  boot + on every `resize`/`orientationchange`) toggles the class and is the **single place** the
  renderer/camera are sized — to `gameW()/gameH()` (innerHeight/innerWidth swapped when rotated). It now also
  calls `applyDevice()` (from `client/src/device.js`) **first**, so the reactive **form** axis
  (`dev-phone|dev-tablet|dev-desktop|dev-desktop-lg`) recomputes on every resize/orientationchange (this
  iteration only re-sets the body classes on a form change; full resize-driven layout adaptation of every
  screen is a deferred iteration 2 — see DECISIONS §34). Because a
  `transform` makes `position:fixed` children relative to `<body>`, the whole HUD/menus/buttons rotate with
  it for free. `toGame(clientX,clientY)` maps pointer/touch coords into the rotated game space (used by the
  steering stick and the reset-progress slider); pinch distance is rotation-invariant so it needs no mapping.
  When auto-rotate is on and the user turns the phone to real landscape, `rotated` becomes false and the
  native landscape viewport takes over seamlessly. Desktop is unaffected (`rotated` is touch-only).
- **Mobile menus & Full screen:** the **welcome** screen is a **fixed grid** (scrollable greeting/intro
  cell on top, pinned Take-off footer at the bottom) — only the text scrolls and the **Take off** button
  is always on-screen, like the Main Window. On **non-phone forms** (`body:not(.dev-phone)`, i.e. PC) the
  greeting/intro **and** the Take-off footer are instead pinned to the **top** (`grid-template-rows: auto
  auto; align-content: start`), button still directly under the text; the **Main Window** is a fixed full-height grid (only its
  work-zone description scrolls), so its **Take off** button is likewise always on-screen. A single
  touch-only **floating Full-screen button** (`#fullscreen-btn`, fixed bottom-right, **icon-only `⛶`**,
  brighter than the old inline buttons) re-enters fullscreen to hide the browser chrome (URL bar, tabs) after
  the app is minimized/restored. It is shown on **all touch screens** (`body.touch`) — **menus AND in-game
  (active combat + paused)** — so the player can re-enter fullscreen mid-battle after the mobile browser
  silently drops out of it on background/restore. On a **menu** it sits bottom-right (`right:14; bottom:14`);
  **in-game** (`body.touch:not(.menu)`) it moves just **left of the rocket button**, raised clear of the
  phone's bottom chrome (`right:124; bottom:58`, a ~12px gap from the rocket's left edge, vertically centered
  on it). It **hides once fullscreen** (`body.fs`): a `fullscreenchange`/`webkitfullscreenchange` listener
  toggles `body.fs`, **and** — because mobile browsers often don't deliver `fullscreenchange` to a
  backgrounded tab, leaving `body.fs` stale-true after restore — it **re-syncs `body.fs` on foreground**
  (`visibilitychange` when `!document.hidden`, plus `pageshow` and window `focus`) so the button reliably
  reappears. The translated words live on its `aria-label`/`title` (key `ui.fullscreen`, re-applied
  by `applyTranslations` on language change); `requestFullscreen` no-ops if already fullscreen or unsupported.
  **iPhone Safari has no Fullscreen API** (it exists only on iPad/Android), so there the `⛶` button can't
  work — the only true full screen is the **standalone web app from "Add to Home Screen"** (we ship
  `apple-mobile-web-app-capable`). **Device detection lives in `client/src/device.js`** (the single source of
  truth): the **touch** capability (`Device.hasTouch`, via `pointer: coarse` / `ontouchstart` / `maxTouchPoints`)
  plus `FS_API` (any `requestFullscreen`/`webkitRequestFullscreen`?) and `STANDALONE` (`navigator.standalone` /
  `display-mode: standalone`). Its `applyDevice()` **owns the body classes** — it projects the two axes onto
  `input-touch`/`input-mouse` + `dev-phone|dev-tablet|dev-desktop|dev-desktop-lg`, keeps **`body.touch`** as a
  compatibility alias (set with `input-touch`, so the existing touch CSS/rotation/fullscreen rules are unchanged),
  and sets the touch-only `standalone` / `no-fs-api` gates. On a touch device with no FS API → `body.no-fs-api` hides the `⛶` button and
  shows a non-interactive **A2HS hint pill** instead (`#a2hs-hint`, text key `ui.a2hs.hint`) — now gated to
  `body.touch.no-fs-api:not(.standalone)` so it also shows **in-game** (bottom-right on menus; in-game it tucks
  under the top-left settings gear at `left:14; top:56`, clear of the rocket/pause/zoom); once already launched
  standalone → `body.standalone` hides both (no chrome to hide).

## Tools
- **Pause button** — a ⏸/▶ toggle at the top, between the **Vega Sentinels** wordmark and the Credits
  HUD. Pausing **freezes the whole fight** (the render loop skips the sim `update` — enemies, bullets,
  rockets, cooldowns, repair-drone regen and spawns all stop; the frozen frame keeps rendering) and the
  label flips to ▶. While paused, a large centered **"Paused"** label with a **▶ Play** button (resume)
  shows over the frozen battlefield (the button is the only interactive part — the rest passes through).
  Resume via either the top toggle or the Play button. Only active during a running fight (hidden on menus via `body.menu`;
  the result overlay sits above it); a fresh run always starts unpaused. **Mobile auto-pause:** on touch
  devices the fight auto-pauses when the browser/tab loses focus (`visibilitychange`/`blur`) so a
  backgrounded fight doesn't run on; the player resumes manually. **This is a client-side, single-player
  freeze — it must be reworked server-side when multiplayer lands (a client can't freeze a shared world);
  see DECISIONS §16.**
- **Perf overlay** at the top center: FPS, frame time (ms), draw calls, triangles, and a **ship-speed
  readout** `spd {current} pk {peak}` (world units/sec — the live `|G.player.vel|` plus a per-run peak-hold
  that resets when a new player ship is built; instrumentation for tuning a future max-speed cap, since the
  player currently has no speed limit — see Movement)
  (the `?dev` per-second perf sample posted to `/api/perf` also carries `load.drops` = the live loot-drop
  count, next to `enemies`/`particles`, so drop cost shows up on a real device)
  (across both render passes), and the **real backbuffer resolution** (`w×h` = CSS size × pixelRatio —
  the actual pixels the GPU fills). FPS/frame-ms use the **raw rAF interval**
  (`clock.getDelta()` before the sim's `0.05`s clamp), so they stay accurate below 20 fps instead of
  saturating at the clamp. A proxy for hardware load; the resolution lets a tester confirm whether a
  tier change actually moved the pixel count (a weak phone often reports `devicePixelRatio`
  ~1, making the pixel-ratio cap a no-op; the sub-1 `renderScale` knob that used to be in this product was
  removed in 2026-06-27, DECISIONS §23). `calls` is the plain two-pass frame's submit count — there is no
  post-processing chain to inflate it. Where the tier carries a real-light pool the line also appends
  **`lit N/POOL pw P y Y`** (lights in use / pool size, and the live power + height knobs). **Dev-only:** the overlay is a diagnostic tool, hidden by
  default (`#perf { display: none }`) and shown only under the **`?dev` flag** — CSS reveals it via
  `body.devmode:not(.menu) #perf`. `client/src/dev.js` / `isDev()` is the single source of truth for `?dev`
  (it also gates the `devPerf` perf telemetry in `main.js`, the `window.__backdrop` hooks and the
  `●dev`/JS-heap suffix in `hud.js`). Truthy for `?dev`/`?dev=true`/`?dev=1`; **anything else — including no
  param — is off.** The flag is **NOT sticky on any device or host** (DECISIONS §81): it governs the current
  page load only, nothing is read from or written to storage, and the retired `localStorage['devMode']` key
  is cleared on load. So diagnostics can never end up stuck on the live site — for the maintainer or for a
  playtester handed a `?dev` link — and a dev simply keeps `?dev` in the URL (or a bookmark). `evalDev` takes
  the query string and nothing else, which `dev.test.js` pins.
  The **right-docked lil-gui panels** (the `?tune` palette/colors panel, the `?dev` "Backdrop authoring"
  record/sliders panel, and the `?dev` **"Exhaust" tuning panel**) are **never built on touch**
  (`Device.input !== 'touch'` guards in `main.js` bootstrap) — they're mouse-only tools; the perf overlay
  still shows under an explicit `?dev` on touch, just not those panels.
  The **Backdrop panel hosts three groups**: the ghost battle's *Appearance* sliders, the **"Speed field"**
  folder (`buildSpeedFieldFolder` in `world.js`: a shared colour + per-layer count / point size / wrap
  radius / depth / depth-spread / opacity, plus a **Dump speed field → console** button that prints a
  paste-ready `speedField` block for `catalog_seed.js`; look-only controls write to the live materials,
  structural ones rebuild on release, everything persists to `localStorage['speedFieldTune']` and is
  re-applied by `buildMap` **under `isDev()` only**), and *Record*.
- **`?dev` Hit-feel tuning panel** (`hit-fx.js buildHitFxPanel`, built beside the Backdrop/Exhaust panels
  under the same `isDev() && Device.input !== 'touch'` guard). Four folders — **Hull flash** (colour,
  intensity, duration), **Model punch** (shove, scale pop, duration, cooldown), **Camera shudder**
  (amplitude, duration, cooldown) and **Tracers** (per-class length + brightness for kinetic and cannon,
  plus the two jitters; both jitters at 0 restores the old uniform bolt) — plus **`Copy JSON`**, which is
  pasted back over `HIT_FX` in `hit-fx-config.js`. Unlike the exhaust panel it mutates the **live** object,
  so a slider is felt on the very next shot; there is no persistence (a page reload is a fresh start).
- **`?dev` Exhaust tuning panel** (`exhaust-fx.js buildExhaustPanel`, mirrors the Backdrop panel; built under
  `isDev()` next to it) — tunes the shared engine-exhaust plume with **two scopes**: a **GLOBAL Mode toggle**
  (`points` ↔ `flame`) that flips **every** plume at once (the freighter set-piece **and** all ship plumes,
  via `setGlobalExhaustMode`), plus **freighter-only** Palette (hot/mid/end) + Shape (count/len/size/speed/
  spread/turbulence/softness) sliders that retarget the live `activeFreighterPlume` only (ships derive their
  own palette from each engine color, so recoloring the freighter never recolors ships). A **Copy JSON**
  button exports the tuned numbers (paste back into `EXHAUST_DEFAULTS`) — **no localStorage persistence**;
  prod look is driven only by `spec.exhaust` + the module defaults, never a dev-session tune.
- **Rocket cooldown indicator** — the 🚀 circle (bottom-right) fills radially as it reloads
  (orange while reloading, green when ready). Shown on both PC and mobile; on PC it's also
  clickable to fire (besides the `F` key), on mobile it's the rocket button.
- **Off-screen enemy markers** — for each enemy that's off-screen, an arrow on the screen edge points
  toward it, tinted by the enemy's marker color (`updateMarkers`, a pooled DOM overlay). Hidden while an
  overlay (game over / victory) is up.
- **Enemy health bars** — a small translucent-red bar that floats **above each enemy on the 2D screen**,
  with a **blue shield strip stacked above it** (`.enemy-shield`, a *sibling* element — the `.enemy-hp` DOM
  shape is unchanged — 40×3 px, lifted 10 px by its CSS transform; purple `recharging` gradient while the
  shield is broken, its fill then showing the **recharge progress** `_shieldRechargeAccum / rechargeSec`
  instead of the remaining absorption). Both are drawn from the **same** projected anchor and the pair is
  shown when **EITHER** pool is below full (`e.hp < e.maxHp` **or** `_shieldValue < shield.capacity`) — a
  freshly spawned enemy has both full, so it still shows nothing. Enemies with no shield get the red bar
  only. `updateEnemyHealthBars`
  (a pooled DOM overlay in `#markers`) offsets the anchor along the **camera's screen-up axis**
  (`camera` local +Y in world, `_screenUp`) by `~e.radius*1.6 + 2` units, then projects it — because the
  camera is near-top-down (`CAM_OFFSET 0,110,26`), world +Y points almost *at* the camera, so a plain +Y
  bump barely moves the bar up the screen; offsetting along screen-up lifts it straight up over the model
  (still depth-correct, scales with zoom/distance). The CSS `translate(-50%, calc(-100% - 4px))` then pins
  the bar's bottom edge above that anchor with a 4 px gap. Fill width is set to `hp / maxHp`; enemies carry
  a `maxHp` from spawn (`ship-build.js`). CSS: `.enemy-hp` + its `> i` fill in `styles.css`. Hidden while an
  overlay (game over / victory) is up. (`__game.camera` is exposed for the headless position assertion in
  `visual/scenarios/16-enemy-health-bar.mjs`.)
- **Kill credit popups** — a green `+xx` popup floats up from each destroyed enemy's position showing the
  credits earned, holding then fading over ~2 s (`updateCreditPopups`, a pooled DOM overlay in the `#markers`
  container; `creditPopups` FX array spawned in `sim.js` on enemy death with `maxLife` 2.0, skipped when
  reward ≤ 0; opacity holds full then fades over the last ~1 s). Green (not the credits gold) so it stays
  legible against the warm ship-explosion burst it spawns on. Hidden while an overlay is up and cleared on restart.
- **Event log** — a short stack of fading lines (`#event-log`) directly above the rocket button (fixed,
  bottom-right, `z-index:6`, right-aligned; same anchor on desktop + touch). Keeps the **last 4** lines,
  newest at the bottom; each line fades out over **5 s** via the CSS `eventfade` animation then removes
  itself (`animationend`). On an enemy kill it logs `{shipname} killed +{amount}` (default text color); on
  a grab pickup it logs `picked up {name}` tinted by the item's rarity **color** (fires for every collected
  drop, including the L1/L2 cosmetic reward drops). Module `client/src/eventlog.js` (`logEvent(text,color)` /
  `clearEventLog()`); called from `sim.js` (kill line + `clearEventLog()` in `reset()`) and `drops.js`
  `collect()` (pickup line). Drawn on **every** level including the Level-0 intro — it was briefly hidden
  there while the intro's line shared this band with it, and came back when the line moved to the top of the
  screen. Purely cosmetic — the fade is wall-clock, so it keeps fading while paused
  (DECISIONS §30, no per-frame integration). Strings `ui.log.killed` / `ui.log.picked_up` (EN+RU); the enemy
  ship name (kill line) and the component/weapon name (pickup line) render to players via the **English DB
  name** (unlocalized — a later i18n pass should localize these surfaces). Hidden on menus via `body.menu`.
- **Milestone banners** — a big, semi-transparent line (`#banner`, upper third, centered, non-interactive)
  flashes at full opacity and fades to 0 over **3 s** at key beats: when the remaining-enemy count hits
  **10** and **5** (`enemyTotal − kills`, once each) showing `N enemies left`, and when the **final combat
  phase** begins (the boss/finale — the phase right before the `event: 'win'` phase) showing **Final Stage**.
  State is `G.banner {text,life,maxLife}`; `showBanner`/`updateBanner` live in `sim.js` (opacity = `life/maxLife`,
  aged in `update(dt)` so it freezes on pause, drawn each frame from `main.js`). Fires once per run
  (`firedBanners` set, cleared in `levelRunner.start`); hidden on menus/overlays. Strings
  `ui.banner.enemies_left` / `ui.banner.final_stage` (EN+RU).
- **Marker colors by size tier** — the edge arrows, the mini-map dots and the hangar ship-dot all read a
  ship's `stats.color`, sourced from the `MARKER` palette in `catalog_seed.js` (NOT ad-hoc per ship; it
  does not tint the 3D model). Convention: **small → orange `#f4741f`** (enemy_1 fighters/gunners +
  enemy_2 rocketeers), **medium → red `#e53935`** (enemy_3), **boss → maroon `#800020`** (enemy_4); the
  player keeps blue.
- **Shader/GPU warm (`prewarmShaders` in `main.js`, DECISIONS §83).** THREE compiles a material's program and uploads its textures **lazily, on the first frame the object is DRAWN** — so a level that is built and then played compiles itself during the fight. `sim.reset()` raises **`G.needsSceneWarm`**; the render loop consumes it at the top of the next frame, ahead of that frame's draw, and calls `renderer.compile()` on both scenes. `world.js`'s async set-piece loaders raise it again when a model lands, and `ship-factory.js` warms each ship model itself as it is parsed (§79). The **FX warm rig is permanent**: throwaway meshes matching the bullet/explosion program keys stay in the scene for the session, parked at `y = -100000` and frustum-culled (no per-frame cost; `compile()` ignores culling). While the warm runs — and while essential `.glb` loads are still in flight (`G.pendingAssets`, capped at 9 s) — **`#levelwarm`** covers the canvas ("Preparing the sector...", EN+RU): the frame that takes the request only RAISES the veil and returns, and the next frame — with the veil painted — does the blocking work, because nothing can paint until a frame ends. It fades in after a 90 ms delay, so a fast machine never shows it. Disposing the rig's materials would hand the compiled programs straight back — THREE frees a program when its last material is disposed, and every FX primitive disposes on death, so each lull bought a recompile. **Any material config that is created and destroyed repeatedly needs one instance held alive for the session.**
- **Particle draw cost (`particle-pool.js`, DECISIONS §82).** High-volume FX is drawn with **one draw call per particle KIND**, not per particle: `makeParticlePool({ geometry, color, opacity, blending, max })` owns an `InstancedMesh` that the sim refills each frame (`begin` / `push(pos, size, alpha)` / `end`). The **rocket smoke trail** is the only high-volume kind (the ship-death spark spray went with §75) — it was 25-30 draw calls per rocket in flight, now 1. Per-particle fade travels as an instanced **`aAlpha`** attribute patched into the material (a shared `material.opacity` would fade the whole trail in unison); the patch checks its own shader anchors and exposes `alphaPatched`, since a three.js chunk rename would break the fade silently. One-off effects that are only ever a handful on screen (the warp flash, the death shockwave ring) stay plain meshes on purpose. **New high-volume FX must go through a pool.** Puffs never move after birth — the trail's shape is just the sequence of points the rocket passed through, so a curving flight still curves the trail.
- **HUD draw cost (`hud.js`, DECISIONS §80).** Every per-frame HUD write goes through three helpers: **`setText`/`setHTML`/`setStyle`** cache the last written value on the node and skip identical writes, and **`place(node, x, y, extra)`** positions an overlay with a single `translate3d(...)` transform instead of pixel `left`/`top` (which would invalidate layout every frame). The pooled overlays — enemy health/shield bars, off-screen enemy + loot arrows, credit popups — are pinned at `left: 0; top: 0` in CSS with their centring/anchor offsets folded into the JS transform string. The **radar canvas repaint is throttled to ~20 Hz** (`MINI_INTERVAL_MS`); everything anchored to a moving ship stays per-frame so it cannot lag behind the model. New HUD code must use the helpers, and a placement test must read `getBoundingClientRect()`, not `style.top`.
- **Mini-map / radar** (top-left, directly under the shield/health bars and left-aligned with them —
  `left: 62px; top: 72px`, i.e. `#hud`'s 18px padding + the 44px gear inset; `<canvas id="minimap">`,
  non-interactive) — an overview that
  **complements** the edge arrows (arrows = immediate threat direction; radar = spatial overview, useful now
  that the player can wander out of bounds). Shows the **arena boundary** square (±360), the **player** as a
  heading triangle (clamped to the radar edge so it stays visible when far out, red while out of bounds), and
  **enemies** as dots tinted by type color (`updateMiniMap`). Hidden on menus and while a result overlay is up.

### Combat record/playback (input-replay) — `?record` / `?playback`
A general, reusable mechanism to **record a fight and replay it on the real engine** (not a movie of
positions — it captures the player's INPUT + the RNG seed, then re-runs the actual `sim`, so playback has
real bullet colors, smooth physics, real FX and real collisions). Consumers: the canonical Level-0
determinism fixture (below), the admin session viewer, "watch a fight from another angle", video capture. Files: `client/src/replay.js`
(pure core — URL parsing, trace shape, snapshot/apply/validate, unit-tested) + wiring in `main.js`.
- **Record:** `/?record=1&level={id}` (bare number → seed name `level-{id}`, so `?record=1&level=1` is the
  intro four-ship level; or pass a full name). Lands on the level with the **real ship idle**; a top bar
  shows a **Start recording** button that unlocks once the ship `.glb` has loaded (no placeholder capture).
  Start installs a fresh captured seed (`Date.now()>>>0`), `reset()`s the level, and captures one input
  snapshot per sim tick. **Stop & Save** writes the trace and offers a **Play it ▶** link.
- **Playback:** `/?playback&id={id}` (or `?playback` alone = the last recording). Loads the trace, rebuilds
  the recorded ship, re-seeds, and re-sims the fight; holds on the idle frame until the model loads, then
  plays. A top bar shows `tick / total` + Restart.
- **`&finish`** (`?playback&id=…&finish=1`, `rs.autoFinish`): **press "Finish and Return" for the pilot when
  the sector clears**, and stop the re-sim on the victory overlay. A trace records keys and touch, never the
  MOUSE CLICK that ends a mission, so without it a winning replay orbits a cleared sector forever. Opt-in and
  generic — it replaced the old `&cutscene` flag, which did the same thing as a side effect.
- **Trace format v3** (`{version:3, kind:'input-replay', id, level, seed, dt, shipId, tickCount,
  runs:[[{k,t}, repeatCount], …]}`): `k` = held key codes, `t` = `[heading,thrust]` when the touch stick is
  active (**quantized** to 1e-3 rad / 1e-2 before storage). That is the ENTIRE recording — the determinism
  audit found the sim needs only the seed (no wall-clock / Map-Set-order deps in the sim path).
  Ticks are **run-length packed** (`packTicks`/`unpackTicks`): input changes ~2×/s against 60 captured
  ticks/s, measured **23.8×** smaller on a real 131 s session, and the live recorder packs *as it captures*
  so retained memory stays flat on weak devices (DECISIONS §87). **v1 traces** (flat `ticks:[…]` — the
  shipped Level-0 intro asset + every pre-2026-08-03 recording) stay readable forever: `validateTrace`
  accepts both and **`hydrateTrace()` normalizes any trace to a flat `.ticks` array at load**, so playback,
  the HUD counters and the bench index ticks the one way they always have. Use `traceTickCount(t)` for a
  count that works on either shape. **v3 changed no bytes** — it marks the 0-based level
  renumbering (DECISIONS §102). A trace stores the level NAME it was recorded on, and every level moved
  down one that day, so a v1/v2 trace's stored name now points at the wrong level; **`traceLevelName(trace)`**
  shifts pre-v3 traces down one at the single boundary where a stored name is read (the playback level
  fetch in `main.js` bootstrap). Deliberately NOT a blanket alias in
  `normalizeLevelName`: `level-1` is a valid CURRENT name, so aliasing it would break the live campaign to
  fix the archive. Nothing on S3 was rewritten — the intro asset is content-hashed, and every stored session
  trace is equally affected. Guarded by `replay.test.js` + `22-trace-replay` (which caught the bug: playback
  had started re-simming "Level 1" with the intro's recorded input).
- **Real-time pacing / ALL live play is now on the deterministic loop:** record, playback, `?bench` AND
  **normal live play** advance the sim with a **fixed-timestep accumulator** (real elapsed
  time → whole `BENCH_DT` steps, capped at 6 steps/frame → slow-motion under load, never a corrupted tick),
  so a fight runs at true speed on any refresh rate. `TICK_HZ` (`bench.js`, default **60**) is the single
  tunable tick rate; `BENCH_DT = 1/TICK_HZ`. Live play is **seeded at level entry** (`beginLiveSession()` in
  `main.js`, called before each campaign launch/retry — and the welcome-screen Take-off) and captured per sim
  tick — see **Session recordings** under Backend for the always-on funnel-analytics capture built on this.
  **One shared per-tick body:** the accumulator and the `window.__replay.step(n)` hook both call
  **`stepReplayTick()`** (`client/src/replay.js`, dependency-injected: `rs`/`keys`/`touchAim`/`dt`/`update` +
  `capture`/`onTick`/`isCleared`/`isWon`/`finish` callbacks; returns `'ok'` or `'stop'`) — it holds the
  recorded-input apply, `update(dt)`, the index advance, the per-tick capture, the per-tick `onTick` observer
  (**the Level-0 intro director rides this**) and the `&finish` auto-finish + its return-home watchdog.
  `animate()` keeps only the WRAPPER around it: `replayAcc`, the 6-step cap and the record/playback HUDs.
  (The two drivers used to carry hand-written copies of that body — "mirror the accumulator" — so an edit to
  one silently desynced replays.)
  The completion flag `rs.done` gates **playback/intro ONLY** — the same guard that opens `stepReplayTick`
  (`if (rs.play && rs.done) return 'stop'`) and still heads the accumulator's `while (… && !(rs.play &&
  rs.done) …)`: live play (`rs.play===null`) must ignore it, because the intro's Skip path leaves a stale
  `rs.done=true` after `finishIntro()`→`rs.teardown()` — a live session inheriting it would never step (the
  intro→Level-1 dead-controls bug; guarded by `visual/scenarios/29-intro-live-handoff.mjs` and by a
  `replay.test.js` case on that exact torn-down state).
- **Determinism isolation (load-bearing) — the seeded stream is OPT-IN (`client/src/sim-core/sim-random.js`).**
  `simRandom()` is the sim's RNG: `seedSim(n)` installs a `mulberry32` stream (record start, playback arm,
  `?bench` bootstrap + per-trace, **and every live campaign session via `beginLiveSession()` — the Level-0
  intro included**),
  `seedSim(null)` clears it back to the native `Math.random` (called from `finishIntro()` and at the end of
  the dev `stopRecordSession()`), `isSimSeeded()` reports the state. **NB: under always-on recording live
  play is now seeded per session** — a stale seed lingering on the post-win/death menu is harmless (menu
  cosmetics use `Math.random`, never `simRandom`).
  **Only GAMEPLAY draws call it** — `sim.js` (`pickShip`, the loot-drop roll, and the `stepSpawnGate(..., simRandom)`
  spawn-cooldown injection), `ship-build.js` (enemy spawn angle + distance, initial heading, enemy reload
  stagger) and `drops-config.js` (`pickLoot`). **Everything cosmetic keeps the native `Math.random` and is
  therefore replay-NEUTRAL**: explosion/rocket sparks, exhaust, smoke (`projectiles.js`), all world decor +
  set-pieces (`world.js`, built inside `reset()`), the flipbook/bolt/shield FX, and `audio.js`'s module-local
  `arand`. There is **no global `Math.random` swapping** any more (`withSimRand`/`installSeededRandom` are
  deleted) — so an FX or decor change can no longer shift the stream and desync a recorded trace, and a trace
  is no longer **graphics-tier dependent** (spark/exhaust counts are gated on `G.gfx`, so under the old
  opt-out model the same trace consumed a different number of seeded values on a Performance-tier phone).
  Rule for new code: does the draw change what the SIM does (positions, timing, damage, loot)? → `simRandom()`.
  Only what the frame LOOKS like? → `Math.random()`. Verified: record↔playback reproduce a fight
  **bit-for-bit** (a rounded-position state hash) regardless of frame rate, audio state, or model-load timing.
  Accepted cosmetic cost: backdrop/decor layout now varies between two playbacks of the same trace.
  See DECISIONS §73.
- **Two termination guards so a desynced re-sim can never dead-end.** (a) **Trace exhausted with the fight
  unfinished** — `stepReplayTick` sets `rs.done` and returns `'stop'`, freezing the re-sim on its last frame.
  (b) **Return-home stall** — once `&finish` has engaged the flight home (`rs.returning`) only a WIN ends the
  playback (`rs.index` is frozen, `rs.done` never set), so a run that can never dock would loop forever; a
  per-tick watchdog on the session (`rs.noteTick(returningNoWin)` / `rs.stalled()` /
  `RETURN_HOME_STALL_TICKS = 900` ≈ 15 s of sim time, in `replay.js`) sets `rs.done` and stops it. Both
  drivers (`animate()` and `__replay.step()`) carry both exits because they run the **same** body
  (`stepReplayTick`) — they can no longer drift apart. The watchdog masks nothing: the guard scenario asserts
  kills + the win, so a bailed-out run still fails.
- **Guard test (`client/visual/scenarios/22-trace-replay.mjs`, in `npm run test:visual`).** Re-sims the
  canonical Level-0 trace named by the seed's `introTrace` and asserts **4 kills and `won === true`** — so a
  stream-shifting change fails a test run instead of rotting the fixture three determinism guards pin an
  outcome on. It navigates to its own `?playback&id=…&finish=1&debug` url (the runner's base url has no
  `?playback`; `&finish` is what produces the dock), seeds the trace into `localStorage` (the server doesn't
  serve `/recordings/{id}.json`), waits on `__replay.status().armed` (the ship `.glb` sets `noseZ`/`tailZ` =
  where bullets spawn, so stepping earlier would change the sim), then fast-steps via `step()`. Needs
  `npm run assets:pull` (the trace is a gitignored S3 asset) and hard-fails with that instruction when it is
  absent.
- **Second guard (`client/visual/scenarios/35-playback-loads-samples.mjs`).** Opens the BARE `?playback` page
  (no `&finish`) and touches nothing, then asserts the `kinetic`/`cannon`/`rocket` mp3s were actually
  fetched — pinning that a replay reached by navigation still gets SAMPLED sfx rather than the synth
  fallback. Asserted at the network layer because headless Chromium has no audio out and the buffer cache is
  module-private. Deliberately gesture-free: adding a click re-hides the bug it exists for.
- **Storage:** currently the trace is cached in `localStorage` (`replay:{id}` + `replay:last`) for the
  same-browser record→playback loop, and downloaded as `{id}.json`. Planned: promote recordings to an **S3
  asset** (like the ship `.glb`s — `assets:pull`/S3, referenced from seed on prod) so they sync prod↔local.
- **`window.__replay`** console/automation hook (under either flag): `begin()` (== Start), `stop()`,
  `step(n)` (synchronous sim stepping, bypasses rAF — for tests + a background tab that throttles rAF),
  `hash()` (state hash), `status()` (`{recording, armed, ticks, playIndex, playDone, total}` — `armed` is the
  models-ready gate automation must wait on), `play()` (`{returning, done, won}` — the `&finish` lifecycle).
  See `docs/plans/2026-07-09-replay-record.md`.
- **`makeReplaySession()` (`replay.js`)** — the playback lifecycle state is one object (owned
  fields `play`/`trace`/`armed`/`index`/`done`/`autoFinish`/`returning`/`stallTicks`; the return-home
  watchdog counters `noteTick()`/`stalled()` (+ the exported `RETURN_HOME_STALL_TICKS`); an `active` getter = the
  `animate()` gate `!!rs.play`; a unit-tested `teardown()` that clears every field together). `main.js` holds
  exactly one instance (`rs`). Kept as one object so the whole cluster tears down atomically — a partial
  reset leaves `animate()` stuck in the playback branch (the intro→Take-off dead-screen bug `finishIntro`'s
  `rs.teardown()` guards against). The record vars, `replayAcc` and `G.replayMode` stay module-level in
  `main.js`.
- **READ-ONLY (`G.replayMode`).** A `?record`/`?playback` session must not mutate the server: `win()` gates
  `unlockNextLevel`/`bankRun`/`depositLoot`/funnel on `!G.replayMode`, so a (re)played win shows the victory
  overlay but never advances progress or banks credits.
- **Account-independent loadout.** Playback rebuilds the ship+weapons the recording was MADE with — captured
  in the trace (`loadout`/`components`) for new recordings, or the ship's catalog defaults for old ones —
  via a `buildPlayerFor(ship, override)` param, so a later-unlocked weapon (e.g. the Machine Gun) never leaks
  into an intro-level replay.
- **`settleView()`** (extracted from `sim.js update()`) frames the camera + sky/stars/planet on the player
  right after `reset()`, so a playback's first still frame doesn't jump when the re-sim's first tick runs.

### The scripted intro (Level 0) — a fight you FLY
**The intro is an ordinary campaign level, played live.** A new (or freshly reset) player lands straight in
the Level-0 ambush with the controls in their hands from the first second; over the fight a scripted
**director** speaks five first-person lines and, once, flies a **controls card** into the bottom-left `#help`
cheatsheet. There is no playback, no freeze, no tap-to-continue, and the client never fetches the canonical
trace (that is now only a determinism fixture — see *Combat record/playback*). See DECISIONS §138.

**One timeline, stated once, on the `level-0` descriptor** (`server/src/catalog_seed.js`) — the UI and the
SIMULATION read the same object, so the words and the fight cannot drift apart:
- `intro.lineHold` **3 s** fully opaque, `intro.lineFade` **2 s** linear fade. A beat that fires while a line
  is up **replaces it immediately** (the fade restarts from full) — no queue.
- `intro.helpHold` **3.5 s** the controls card sits in the line's slot, `intro.helpFly` **0.9 s** the flight
  into `#help` — the card crosses the whole screen from the top-centre slot to the bottom-left cheatsheet, and
  at 0.45 s that diagonal read as a jump rather than a journey. `styles.css`'s `.fly` transition carries the
  same number.
- `intro.beats`: `l0` on `start` · `l1` on the 2nd `spawn` · `l2` 2 s after the 2nd `kill` · `l3` on the 4th
  `spawn` (the rocketeer) · `l4` on `cleared`. Text keys `ui.intro.l0…l4` (EN source + RU).
- `phases[0].spawn.earliest = [3, 9.4]` — the SIM half of the same timeline (see *Level flow*).
- `finalStageBanner: false` — the rocketeer's warp-in is when `l3` speaks, so the "FINAL STAGE" banner is
  suppressed by data rather than by a special case in `level-runner.js`.

Resulting clock: **0 s** L0 · **3 s** pirate #1 warps in · **5 s** the controls card takes the slot ·
**8.5 s** it starts flying · **9.4 s** it is gone · then #2 (once #1 is dead) with L1 · L2 two seconds after
the 2nd kill · the rocketeer with L3 · `cleared` → L4 + "Finish and Return".

**The clock is `world.combatElapsed`** (sim ticks of unpaused combat, already in `worldDigest`) — never wall
clock, never rAF deltas. That is what makes a recorded intro session replay exactly, and it resets to 0 in
`reset()`, which is the whole of the death→**Restart re-arms every beat** contract.

- **`client/src/intro-director.js`** — the state machine: pure, DOM-free, engine-free, so `node --test` loads
  it (`intro-director.test.js`: the beat triggers, the fade, the card states, replacement, the restart
  re-arm). `makeIntroDirector(script)` → `tick({t, kills, alive, cleared})` returns this tick's one-shot
  commands (`line:<id>` / `help:hold|fly|done`), plus `view` (`{lineKey, lineAlpha, help}`) and `fired`.
  `spawned` is derived by the caller as `kills + alive` — exact, and it needs nothing new in the World.
- **`main.js`** — `introTick()` runs once per SIM TICK (it is the `onTick` dep of `stepReplayTick`, and
  `__game.stepSim` calls it too); `updateIntro()` runs once per FRAME beside `updateBanner()` and writes
  `#intro-line`. `showIntroHelp()`/`flyIntroHelp()` execute the card commands.
- **DOM:** `#intro-line` + `#intro-help` (`index.html`, styled in `styles.css`), **top-centre** at
  `top: max(14vh, 76px)`, `z-index: 7`. The slot sits above the ship and out of the fight (it started at the
  bottom and moved here on the maintainer's live test — the bottom band already holds "Finish and Return",
  the rocket/FIRE buttons and the kill log, and reading a line down there means looking away from your own
  ship). **The offset and the WIDTH are both structural, and the width is the load-bearing one.** `top` is
  `max(14vh, 76px)`: 14 % is the look, and the 76 px floor exists because the HUD block above it is a fixed
  PIXEL height — on a 375 px-tall landscape phone 14vh is 52 px and cut 10 px into the HP bars, whose bottom
  edge is 63. `width` is **explicit** (`min(760px, calc(100vw - 400px))`, and on touch the slot is centred in
  the FREE BAND instead: `left: calc(50% + 67px); width: min(560px, calc(100vw - 266px))`). It has to be:
  these boxes are `position: fixed; left: 50%` with no `right`, so a shrink-to-fit width can never exceed
  **50vw** — a `max-width` above that is dead code and the left edge is simply `25vw`, which only clears the
  radar's fixed 194 px right edge above ~776 px of viewport. That is how the first version of this shipped a
  card painting over the battle radar on every phone narrower than an iPhone X: it cleared by 9 px at 812, by
  1 px at 780, and overlapped by 10 px at 736 and 27 px at 667. With `width` set the left edge is
  `50vw − w/2` for a KNOWN w, which is **≥ 200 px at every viewport width under both rules** — a proof rather
  than a measurement. The touch rule shifts the centre right by 67 px because the left reserve must clear the
  132 px radar and the right one only the 60 px zoom column; being 67 px off the screen's centre is the price
  of being centred in the space that is actually free.
  `44-playable-intro`'s `assertBand` checks non-intersection with the HUD's two corner blocks, the radar, the
  gear, the pause button and the zoom column at **1280×800, 812×375, 736×414 and 667×375** — the phone widths
  straddle the ~776 px boundary deliberately, because the escape was that both originally-asserted viewports
  sat on the clearing side of it. (`#banner` shares the band at `top: 26%`
  but cannot fire on the intro: FINAL STAGE is suppressed and the "N enemies left" milestones only fire at 10
  and 5 remaining, against an enemyTotal of 4.) **Everything is `pointer-events: none`** — the player is
  flying underneath, and `#stick-zone` is a full-screen `pointer-events:auto` layer, so an interactive
  overlay here would swallow steering and fire taps. The card's flight is a FLIP: `main.js` measures both
  rects and sets `transform: translate(calc(-50% + dx), dy) scale(s)` with `transform-origin: left top` — the
  `-50%` must stay INSIDE the composed transform (the rect was measured with it applied) — and drives
  `opacity` from JS, because the inline `opacity:1` would beat any `.fly` class rule. The `.fly` class
  supplies only the transition. Both are negatively tested by `44-playable-intro`.
- **Nothing in the HUD is taken away** — the intro is a level, not a cutscene. `body.intro` is still set by
  `updateIntro` while a director is armed, but it is now only a state hook that tests read; no CSS hangs off
  it. (It briefly hid `#event-log`, back when the line sat in the bottom band beside the kill log.)
- **Skip lives in the Settings gear** (`#skip-intro`, `ui.intro.skip`, shown only while `G.skipIntro` is
  published). The gear already **pauses the fight** when opened, so a skip takes two deliberate acts and can
  never be a stray tap; every screen edge was already occupied by HUD or thumb controls. `skipIntro()`
  flushes the abandoned session (`quit`), then calls `finishIntro()` — the SKIP path only, which advances
  0 → 1 itself and lands on the briefing.
- **Ending / progress.** Clearing it is the **normal win path** every other level uses, and it does not go
  through `finishIntro()` at all: `cleared` → "Finish and Return" (`sim.js` `finishing` →
  `commitLevelAdvance`) → autopilot home → dock → victory overlay (`loadAdvancedLevel`) → Continue → the
  Level-1 briefing. The one-time gate is `level.name === 'level-0'` in bootstrap — the server serves that
  descriptor only while `current_progress === 0`, so there is **no client flag and a genuine progress reset
  replays the intro** (DECISIONS §63).
- **The director cannot outlive its level, by construction.** `introArmed()` (`main.js`, consulted by both
  `introTick` and `updateIntro`) drops the director the moment the SERVED descriptor stops carrying an
  `intro` script, and clears `G.skipIntro` with it. That is not belt-and-braces: the win path advances the
  campaign **in page** (`loadAdvancedLevel` swaps `CATALOG.level`, no reload), so a latched module flag
  survived into Level 1, re-armed itself on that level's `reset()` — the clock going backwards is the
  restart signal — and replayed the whole script over it, and left a Settings row that would have granted a
  free level advance.
- **It is session-recorded** like every other campaign level: bootstrap calls `beginLiveSession()` before
  `reset()`, so the level new players actually drop off on finally reaches the funnel and `/admin/sessions`.
- **Death is death.** Normal rules, normal Game-over overlay; **Restart** replays Level 0 with every beat
  re-armed (the director sees `combatElapsed` go backwards and resets itself).
- **`#help` has a touch variant** (`ui.help_touch`): bootstrap swaps the key once when `Device.input ===
  'touch'`, so a phone no longer reads keyboard bindings — and the card that flies into it matches.

#### ⚠ READ THIS BEFORE CHANGING ANY OF THE FOLLOWING — the intro breaks from the OTHER end

The intro is coupled to systems that show no sign of it from their own side. Every row below is something
that actually went wrong while building it, not a hypothetical. Full detail:
`docs/plans/2026-08-30-1654-playable-intro.md`.

| If you change… | The intro breaks like this | Do this |
|---|---|---|
| **Level-0 pacing** — `spawn.earliest`, the phase script, the pool, either intro ship's stats/turn rate | The canonical recorded trace no longer clears the level, and **three** determinism guards that pin its OUTCOME go red: `server/tools/sim-replay.test.js` (kills 4 / earned 250 / cleared), `server/src/seal/verify-run.test.js` (`TRUTH`), visual `22-trace-replay`. CI never sees it (the trace is a gitignored S3 asset and the tests `skip` when absent), so it rots silently until someone runs `assets:pull` | Re-record it — **Step 9 of the plan**. The cheap path is prepending idle ticks to the packed runs; when the first spawn moved to 3 s that was **exactly 180** ticks, because `180 × 1/60` sums to `2.9999999999999942 < 3` and so leaves the spawn on its original relative tick. 181 shifts the whole fight. Verify with `node server/tools/sim-replay.mjs <file> --json` and accept only on the six load-bearing fields; `loot` legitimately moves |
| **The intro's timing numbers** (`intro.lineHold/lineFade/helpHold/helpFly` on the level-0 descriptor) | You have moved the FIGHT too, not just the words: `spawn.earliest[1]` is **derived** from them (`INTRO_HELP_GONE`), so a UI tweak retimes enemy #2. That is the design (one timeline, DECISIONS §138) — but it means the words and the fight cannot be tuned separately | Change the constant in `server/src/catalog_seed.js`, never a hard-coded copy, and re-run the trace check above. `styles.css`'s `.fly` transition duration must be edited to match `helpFly` by hand — CSS cannot read the descriptor |
| **Anything about the default boot** of the visual suite | **Every one of the ~48 scenarios boots as a NEW player at progress 0 — i.e. into the intro.** The runner's boot gate (steps the sim until the arena holds an enemy) and `__game.silenceIntro()` exist ONLY for that. A pacing change is a change to the default boot of the whole suite | Keep the gate. Do not "fix" a scenario by giving the harness a different level-0 — the suite's value is that it fights the level production ships |
| **`introArmed()`** (`main.js`) or the `intro` field on a served descriptor | The director outlives its level. This is not theoretical: a latched module flag survived the win (the advance is **in page**, no reload), re-armed on Level 1's `reset()` and replayed the whole script over it, and left a Settings "Skip the intro" row that granted a **free level advance** | Keep the lifetime tied to `CATALOG.level.intro`. Guarded by scenario 44's win step |
| **`advanceDone()` / the order of `commitLevelAdvance` → `loadAdvancedLevel`** (`net.js`) | Re-opens the **free level** bug for every level, not just the intro: the level GET overtakes the advance POST, the tab reloads the level it just cleared, and clearing it again advances the account a second time and pays out the next level's reward | Leave the `await advanceDone()`. Guarded by scenario 44 docking instantly with the POST held 1.5 s |
| **The TOP band** — adding/moving a fixed element near the top, or resizing `#minimap` | The line and the controls card live there and are opaque; a new neighbour is painted over (or paints over them) | Add it to `assertBand` in `44-playable-intro.mjs` and re-derive the slot's width. **Note the trap:** the radar overlap escaped because both asserted viewports sat on the clearing side of a ~776 px boundary — assert on BOTH sides of any boundary your arithmetic implies |
| **`#help`** — moving, hiding, or hiding it on touch | It is the controls card's flight DESTINATION. A `display: none` target measures as a zero rect, so the card flies into the screen corner at minimum scale. It was hidden on touch for exactly this reason once | Keep it rendered whenever the intro can run. Guarded by scenario 44 at three phone widths |
| **`#stick-zone` / the input layers, or the intro DOM** | Every intro node is `pointer-events: none` because the player is FLYING underneath them; `#stick-zone` is a full-screen `pointer-events: auto` layer. An interactive intro node swallows steering and fire | Keep `pointer-events: none`. Guarded by an `elementFromPoint` assertion in scenario 44 |
| **`world.combatElapsed`, `reset()` zeroing it, or the digest** | The director's whole clock — and its restart contract (the clock going backwards IS the re-arm signal). Wall-clock timing would also desync a recorded intro session | Keep the director on sim ticks only |
| **The i18n keys `ui.intro.l0`…`l4`, `ui.intro.skip`, `ui.help_touch`** | The lines are resolved by key at speak time; a rename shows the raw key on a new player's first screen | Rename in `source.json` AND `ru.json` AND the descriptor's `beats[].textKey` together |

## Ship model (DB-driven)
Ships, components and weapons are **defined in the database** (`ships`, `components`, `weapons`); the
client fetches them on startup (`bootstrap()`) and assembles every ship from that data. Only the pure
derivation (`deriveDrive`/`shipMass` in `client/src/sim-core/components.js`) stays client-side. A ship is a
**hull + an engine + maneuvering thrusters** (referenced by id in the ship's `components` field) plus
**mounted weapons** (`stats.mounts`). `stats` (JSON) also carry **fire `groups`** (named channels — a
key for the player, an AI range/aim rule for enemies), `role`, `color`, **`weightClass`** and a `model`
block (per-ship model presentation — see the Visual model section). **`weightClass` is the ship's MASS
tier** — a third axis, orthogonal to `role` (behaviour) and `class` (the SFX/sound class): `light` (all the
1.0-scale hulls + the player), `medium` (the 2.0-scale capitals) and `heavy` (both bosses), with
`ultraHeavy` and `station` declared-but-unused. The classes and what each one owns live in
`client/src/sim-core/ship-classes.js`; the seed refuses to load a ship whose class is not declared there. A `mount` = a
weapon id, its `group`, a lateral `offset` (side-by-side fire), a `delay` (staggered volley); a ship
can mount several of the same weapon (the mini-boss has two rocket launchers). The player's active ship
+ its loadout/components overrides come from `player_ships` (see Backend).
- **Components** (DB `components`, `type` `hull`/`engine`/`thruster`/`repair`/`grab`/`shield`; `weight` column + `stats`
  JSON): a **hull** has `{ durability (= maxHp), volume }`; an **engine** has `{ power → acceleration,
  maxSpeed, exhaust }`; a **thruster** has `{ power → maneuverability (turn rate) }`; a **repair drone**
  (4th type) has `{ repairPerTick, intervalSec, maxFraction }` → passive hull regen; a **grab** (5th type,
  the tractor beam) has `{ strength }` → scales its inverse-square loot-pull field (reach is emergent,
  ≈12.7 u base / ≈18.0 u advanced; see **Grab & loot drops** under
  Gameplay); a **shield** (6th type) has `{ capacity, rechargeSec }` → a regenerating damage buffer that
  absorbs hits before the hull (see **Shield** below + the combat/damage section). Seeded: hulls
  Basic(100hp)/Light(30hp)/Medium(150hp)/Boss(310hp); engines + thrusters Basic/Scout/Medium/Boss; one
  **Repair drone** (id 12: heal 1 HP / 1 s, capped at 80% of max HP); two **Grab** items — the **base Grab**
  (id 29: strength 13 / weight 2 / 500, which the player **owns from the start** — it's in the default
  player ship's `components.grab`) and the buyable **Advanced grab** (id 30: strength 26 / weight 3 / 2000);
  one **Base shield** (id 31: capacity 20 / recharge 10 s / **weight 0** / 500, in an **optional** `shield`
  slot, which the player also **owns from the start** — it's in the default player ship's `components.shield`
  — and is **buyable**). Base-shield weight is 0 so it doesn't shift starter handling or `REFERENCE_MASS`;
  heavier capacitor tiers can add weight later (`'shield'` is in the mass loop).
  The fighter, rocketeer and the
  medium (ex-mini-boss) share the **same Scout engine**; fighter + rocketeer also share the Scout
  thrusters, while the medium has weak (Medium) thrusters → it's sluggish.
  - **Pirate/enemy parts are priced but not buyable.** Every enemy component/weapon carries a resale `price`
    (e.g. Scout engine 250, Pirate MG 300, Second-boss hull 2000) **plus** `stats.buyable: false`, which the
    client shop filter uses to **hide** them (`n.s.buyable !== false`). So looted enemy gear has real resale
    value (`sell = floor(price·0.75)`) without ever appearing in the shop. Player/starter/ladder items have no
    `buyable` key → shown.
  - **Player shop ladder** (priced; `docs/plans/economy-shop-v2.md`) adds buyable upgrades beyond the
    enemy/starter parts: **Heavy hull** (id 13: 200 hp / weight 50 / **6000** — the upgrade "ship": 2× HP for
    accel ~6.2 / turn ~1.2), **Solid-fuel engine** (id 15: power 21 / **1400**) + **Ion engine** (id 16: power
    27, light / **6400** — the premium top-tier engine, **mission-gated**), **Advanced thrusters** (id 21:
    power 3.0 / weight 5 / **2500**), and repair tiers **Repair drone II** (id 19: 1.5 HP / 1 s / 85% /
    **1800**) + **Nanobot repair** (id 20: 2 HP / 1 s / 90% / **7000**, **mission-gated**). Upgrades are
    **mass trade-offs, not power-creep**.
  - **Gated shop rows — TWO gate kinds (`stats.minLevel`, `stats.minMission`), composed with AND.** A
    catalog row may name a campaign level and/or a side mission that must be behind the player before it is
    **buyable**. Both are compared by **NAME / id string**, never by a raw row id (DECISIONS §95):
    - **`minLevel`** — constant `FACTORY_GATE = 'level-4'` in `catalog_seed.js`, i.e. *after clearing
      "Level 3"* (the weapons factory). Three rows carry it: **Heavy hull** (13), **Heavy Machine Gun** (7)
      and **Triple spiral rocket** (11) — the mid-game power tier. Client source: `activeShip.reachedLevels`
      (level names, from `reachedLevels()` in `db.js`).
    - **`minMission`** — constant `RESEARCH_GATE = 'side-research'`, the **"Research station" side mission**,
      which must have been **cleared** at least once. Two rows carry it: **Ion engine** (16) and **Nanobot
      repair** (20) — the premium support tier, tied to flying the station instead of to a credit balance.
      Client source: `activeShip.clearedMissions` (cleared side-mission ids, from `getClearedMissions()`).
    Both kinds are enforced **server-side** in `buyItem` (403 `item locked`) — every gate present on a row
    must pass; the client simply **omits** the row from the shop list — no greyed-out teaser (DECISIONS
    §108). The gate is on the **purchase only**: a looted copy still lands in the stash and equips. The
    client mirror is one predicate, `itemUnlocked()` → `buyableNow()` in `client/src/shop.js`.
  - **Rarity + color** (`rarity`/`color` columns on **both** `components` and `weapons`; migration 020,
    Postgres bootstrap parity; flow into the client CATALOG). Three tiers with a fixed hex each: **trash
    `#ffffff`** (white), **common `#59e0a0`** (green, the loot-glow green), **rare `#0000ff`** (blue).
    Rarity is **derived** in `catalog_seed.js`, not hand-authored per row: `rarity = explicit override ??
    ((price>0 && stats.buyable !== false) ? 'common' : 'trash')` — so every shop-available item is
    common/green and every pirate/enemy part (`buyable:false`) + price-0 boss part is trash/white. The
    **only** explicit override is **Triple spiral rocket (weapon 11) → rare/blue**. `color` is the single
    source for both the in-world **drop glow** (see Grab & loot drops) and the pickup-log **line tint**. The
    **shop UI does not surface rarity/color yet** — it's data only (no card borders/badges), left for a
    later iteration.
- **Repair drone:** installed on the player's ship via the **level-3 briefing** (server-authoritative
  `installComponent` action; persisted in `player_ships.components.repair`). During live combat the
  client ticks `repairTick` (pure, in `components.js`) each frame, slowly healing the hull up to the
  80% cap — never higher, never reducing hp; banked time is cleared once topped up. Its `weight` (4)
  counts toward mass like any component.
- **Shield:** a regenerating damage buffer carried on the **starter ship** (`components.shield = 31`) and
  **buyable**. On the player entity it seeds `_shieldValue` (starts full = `capacity`) + `_shieldRechargeAccum`.
  Three pure functions in `components.js` (unit-tested, caller holds state like `repairTick`): `absorbDamage`
  (a partial hit reduces the shield with nothing reaching the hull; a hit ≥ remaining breaks it to 0 and
  spills the excess to the hull), `shieldRecharge` (a **broken** shield banks dt while inactive and, at
  `rechargeSec`, refills to **full** capacity and reactivates — a **partial** shield holds indefinitely and
  never recharges), and `applyShieldedDamage(ship, dmg)` (the shield-first damage router, shared with enemies;
  returns `{ absorbed, broke, toHull }` for the hit FX — `toHull` is the damage that actually reached the
  hull, which is what the hull flash / model punch / camera shudder fire on; `absorbed: true` does NOT mean
  nothing got through, because a breaking shield spills the excess in the same tick). The recharge ticks each sim frame (freezes on pause; refills to full
  on each run reset). Base shield `weight` (0) still counts toward mass like any component (future weighted
  tiers will matter). **Hitbox while up:** an ACTIVE shield is also the *collision surface* — incoming hostile
  shots are intercepted on the bubble **sphere** (`SHIELD_RADIUS = 4`, exported from `collision.js`), not the
  hull; a broken/absent shield reverts to the hull swept test (see the combat/damage section + Shield-hit FX).
- **Enemy shields:** **every** enemy ship carries a shield too, **derived at spawn** — there is no DB row, no
  catalog column and no migration. `enemyShieldSplit(durability)` (`components.js`) carves the hull's catalog
  `durability` into `shieldCap = Math.round(durability × ENEMY_SHIELD_FRACTION)` (1/3) plus the remaining
  `hullMax`, and `spawnEnemyShip` (`ship-build.js`) seeds `shield: { capacity, rechargeSec }` + `_shieldValue`
  (starts full) + `_shieldRechargeAccum`, with `hp`/`maxHp` set to the **hull** max only. The split is integer
  and exact (`shieldCap + hullMax === durability`) and the derived shield object has **no `weight`**, so
  `shipMass` skips it and enemy mass/acceleration/turn rate are unchanged. Per archetype: basic pirate /
  rocket pirate 30 → **10 + 20**, pirate gunner / advanced rocket pirate 36 → **12 + 24**, mini boss 150 →
  **50 + 100**, advanced medium pirate 300 → **100 + 200**, first boss 310 → **103 + 207**, second boss
  550 → **183 + 367**. Damage routes through the same `applyShieldedDamage` router as the player's (shield
  first, the excess spilling to the hull **in the same tick**, no rounding or per-hit cap), so
  damage-to-kill inside one shield cycle is exactly what it was before shields. A broken enemy shield refills
  to full **10 s after the breaking hit** (`ENEMY_SHIELD_RECHARGE_SEC = 10`, ticked by `shieldRecharge` in the
  `sim.js` enemy loop) — the timer runs from the break and keeps banking **even under continuous fire** (hull
  damage never resets it), exactly like the player's. So a kill finished within 10 s of the break costs
  exactly the damage it cost before shields; a longer fight costs up to one extra shield capacity per 10 s —
  **+183 HP for the second boss, +103 for the first boss, +100 for the advanced medium pirate, +50 for the
  mini boss, +10/+12 for the small pirates.** Long fights are meaningfully harder; this is intended. The
  player's shield rule is unchanged. **Hitbox is unchanged** for enemies (the hull OBB swept test — enemies
  do *not* get the player's `SHIELD_RADIUS` sphere interception, so aim feel is untouched); warping enemies
  stay fully invulnerable. Rockets keep their own `r.hp` and get no shield. Tuning knobs, all in one place:
  `ENEMY_SHIELD_FRACTION` + `ENEMY_SHIELD_RECHARGE_SEC` in `components.js` and the per-tier bubble cap
  `enemyShieldBubbles` in `graphics.js`. `G.enemyShieldRefills` counts completed refills per run (diagnostic,
  reset in `reset()`, read via `__game.enemyShieldRefills` — used to triage a trace-replay divergence).
  See DECISIONS §76.
- **Shield-hit FX (`shield-fx.js`):** a cosmetic translucent **bubble** (a `ShaderMaterial` sphere of radius
  `SHIELD_RADIUS`, imported from `collision.js` so the drawn bubble and the interception hitbox are the same
  sphere) drawn around the player ship while a shield is equipped. Idle it shows only a faint Fresnel rim; on every
  **absorbed** hit it **flashes + ripples outward from the impact point** (an expanding gaussian ring, capped
  to the near hemisphere and fading to the sphere's mid-latitude — up to 6 concurrent, round-robin buffer),
  brighter/near-white on the **breaking** hit; when the shield **finishes recharging** (broken → full) the
  **whole sphere flashes once** (`uReady` pulse). Damage sites call `spawnShieldHit(pos, broke)` (a thin
  wrapper in `projectiles.js` → `registerShieldImpact`) and the recharge-complete transition in `sim.js` calls
  `spawnShieldReady()`; the bubble is advanced once per rendered frame by `updateShieldBubble(dt)` in
  `main.js`. **Pure render** — it reads sim state but never writes it and uses no seeded RNG, so record and
  playback stay bit-identical. See DECISIONS §68.
  **Enemy bubbles** live in the same module as a small **pool**: an enemy gets **no idle rim** (the always-on
  Fresnel read stays player-exclusive) — its bubble is invisible until a hit is absorbed, then plays the same
  ~1 s ripple/flash and disappears. It is sized snug to the hull (`broadRadius(enemy) × 1.05`, i.e. the
  *world* radius with the entity's `scale` folded in ≈ 2.2 small pirate / 4.0 medium / 6.6 boss) since the enemy
  hitbox stays the hull. Slots are capped by the graphics tier (`G.gfx.enemyShieldBubbles`: High 6 /
  Balance 3 / **Performance 0** = `registerEnemyShieldImpact` returns immediately, so **no bubble mesh or
  material is ever created** — only the module-level unit `SphereGeometry` shared by the whole pool exists,
  built at import on every tier), the oldest slot is recycled when all are busy (and its impact ring is
  retired on rebind so the previous enemy's ripples can't replay on the new one),
  and an enemy that can't get a slot still shows the HP-bar shield strip + the cyan hit flash. Damage sites
  call `spawnEnemyShieldHit(enemy, pos, broke)` → `registerEnemyShieldImpact`; `updateEnemyShieldBubbles()`
  runs once per frame in `main.js` **immediately after** `updateShieldBubble(dt)` — which owns the shared
  module clock and now advances it **unconditionally** (it used to bail before the `time += dt` when no
  player bubble existed, which would have frozen an enemy ripple on screen forever until the player was
  first hit). `sim.reset()` calls `clearEnemyShieldBubbles()`; the meshes are pooled and kept (never
  re-created), so repeated runs can't accumulate them.
- **Mass** = hull + engine + thruster + repair-drone + grab + shield weight + every mounted weapon's `weight` (`shipMass`).
  Acceleration and turn rate are **derived AND scaled by mass** (`deriveDrive`): `massFactor =
  REFERENCE_MASS / mass`; `acceleration = engine.power × massFactor`, `turnRate = thruster.power ×
  massFactor`. `REFERENCE_MASS` = 50 (the player's starter loadout: hull 20 + engine 10 + thrusters 4 + gun 6
  + rocket 8 + **grab 2**) keeps the player at accel 15 / turn 2.0; heavier ships are slower & less agile.
  (`REFERENCE_MASS` was bumped 48 → 50 when the base grab was auto-equipped, so its 2 weight is mass-neutral
  at the baseline — a deliberate neutralization, not a nerf.)
  **TURN RATES, AS A LADDER RATHER THAN A CLAIM.** Turn rate falls out of mass, so it is easy to get
  backwards; the numbers are given in full because a superlative about them has been wrong three times.
  Slowest first (°/s, measured through `deriveDrive`):

  | °/s | ship | why |
  |---|---|---|
  | 21 · 25 · 27 · 31 | pirate mini boss · first pirate boss · advanced medium pirate · second pirate boss | the four CAPITALS — heavy, so slow on mass alone |
  | **50** | **pirate gunner · advanced rocket pirate · pirate lancer** | the SLOW FIGHTER TIER — set deliberately, see below |
  | 115 | the player (mass 50; ≈103 carrying the Charged beam at mass 56) | |
  | 170 · 218 | basic rocket pirate · basic pirate | the INTRO's two ships, deliberately left fast |

  What the player wins over the fast pirates is not agility but **SPEED** — `PLAYER_MAX_SPEED` 30 against
  their 10.5–15.75.
  **The 50°/s tier is a deliberate design line** (maintainer, 2026-08-25: *"make it 50 for everyone except
  those in the intro"*). It matters because turn rate is what decides whether an enemy can hold a target
  inside a beam corridor: at the AI's 14–22 u standoff a player's best bearing sweep is 30/18 = 1.67 rad/s ≈
  **96°/s**, so a 50°/s enemy can be pulled off the line and a 183°/s one could not.
  **A thruster row reaches 50°/s at exactly ONE mass** (power = 0.8727 × mass / 50), so the three ships need
  **two** rows: component **32 `Pirate fighter thruster`** (0.541, mass 31) and **33 `Pirate skirmisher
  thruster`** (0.4363, mass 25). Both are weight 3 like the `Scout thrusters` they replace, so no mass and
  no acceleration moved. A future fighter at another mass needs a third row.
  **The intro's two ships are excluded on purpose** — level-0's pool is exactly `Basic pirate ship` +
  `basic rocket pirate` and level-0 carries `introTrace`, so slowing either would move the recorded replay
  archive (§73). That exclusion is why this retune needed no re-recorded trace.
  A **required slot
  (hull/engine/thruster) may legitimately be empty** in the hangar (you can unequip it back into the
  stash) — the active ship then reports `launchable: false` + `missingRequired`, the **Take-off button
  is disabled** (`updateTakeoffGate`, "required slot empty" note), and the hangar preview build is
  null-safe (`buildPlayer` HP→0 on a null hull, `deriveDrive` accel→0 on a null engine) so the player
  can still reach Loadout/Stash to re-equip rather than crashing on a null component. The stats bar
  (shown **only on the Loadout screen**) paints **HP 0 red** (`#ship-stats .v.crit`) so the empty slot
  reads as a problem, not a real stat.
- **Visual model:** the **ship visual-model rendering lives in `client/src/ship-factory.js`** — `makeShip` builds a
  ship's **root group** (carries world position, the `SHIP_GROUP_SCALE` = `1.8` base scale, and
  `rotation.y` = heading) plus an **inner "bank" group** (`g.userData.bankGroup`) that holds the primitives /
  `.glb` and rolls about the nose; `applyShipModel` swaps the loaded `.glb` into that bank group (applying
  `model.yaw`). **The group is a COPY, not the source of truth:** the simulation owns `entity.pos` /
  `.heading` / `.scale` as plain data and `sim.js syncMeshes()` writes them into the group once per tick
  (see "Simulation state is Three.js-free" below).
  Each ship's `model_url` (in the DB) points to the **combat** `.glb`; `makeShip` shows a **procedural
  placeholder ship** (built in code in `ship-factory.js`, no binary asset) while it loads / as a
  fallback, and `applyShipModel` auto-centers/scales/tints/orients it.
  **Each glb is fetched + parsed ONCE** — `ship-factory.js` keeps a `shipModelCache` (url -> template +
  in-flight waiters, exactly like `drops.js`'s `rewardModelCache`) and every ship gets a
  `template.clone(true)`; `levelRunner.start` warms every model the level's spawn pools can produce via
  `preloadLevelShipModels`, and each freshly parsed template is **warmed onto the GPU** (`warmModel`: parked off-camera in the real scene → `renderer.compile()` → `renderer.initTexture()` per map) because three.js otherwise uploads geometry/textures and compiles the program lazily on the first frame an object is DRAWN — which cost 215 ms in `js.render` the first time each type appeared. So no spawn pays for a fetch/parse/upload/compile mid-fight. Cloning
  **shares geometry and textures** (one GPU copy per ship TYPE, not per instance — and the compiled shader
  program with them), but **materials are cloned PER INSTANCE at attach**, so a per-ship visual state can
  mutate them safely: that is what lets the **hit flash** light up the one ship that was shot instead of
  every ship of its type. The clones cost nothing on the GPU (identical parameters → the same program) and
  nothing disposes them; they are garbage-collected with the mesh. The shared **template's** materials must
  still never be touched — everything a live ship mutates is its own copy (the `tint` recolour and the
  ghost-battle `darken`/`opacity` treatment clone as well, now redundantly but harmlessly).
  (DECISIONS §79 + §137; guard `visual/scenarios/26-ship-model-cache.mjs`; `?debug` exposes
  `__game.shipModelsParsed` = the cache size, which must stay a per-TYPE count.)
  **Per-ship model
  presentation lives in one documented block, `stats.model`** (`{ yaw, scale, scaleMul?, lift?, muzzle?, exhaust? }`),
  resolved client-side by `shipModelCfg(s)` (with back-compat fallback to the old loose `stats.modelYaw` /
  `stats.sizeScale` keys so a stale row/cache can't break) and threaded seed → `modelSpec` → `applyShipModel`.
  Full convention + onboarding steps: **`docs/plans/adding-a-ship-model.md`**.
  **Orientation convention: ships face `+Z`.** A model whose nose points elsewhere is corrected at load
  time by `model.yaw` (radians; `Math.PI` for a `-Z`-facing export). Center/scale/orientation are **runtime
  normalizations** (the asset's own transform isn't trusted), so a wrong-way model is fixed with `model.yaw`
  in the seed, not by re-exporting. The `Basic pirate ship` uses this (`model.yaw: Math.PI`; its `enemy_1`
  export faced `-Z`), as do all the other pirates (the `enemy_*` / `enemy_*_orange` exports share that `-Z`
  convention); the **player ship** (`player_combat`) uses `model.yaw: 0`. `model.scale` is the size
  multiplier (auto-normalize the longest axis to `SHIP_MODEL_LEN` 3.4 first, then scale; also scales the hit
  radius). Muzzle/exhaust spawn at the model's real nose/tail (`userData.noseZ`/`tailZ`, auto-derived from
  the glb bounds); `model.muzzle` / `model.exhaust` optionally override them in group-local units.
  **`model.lift` (signed group-local Y, pre-scale) — top-down aim fix.** The camera is near-top-down and
  **all** bullets fly in ONE fixed horizontal plane at `state.js` **`BULLET_PLANE_Y`** (`0.6`), which is the
  ship group's origin (group-local y=0) — every ship group sits at this world Y and muzzle/exhaust spawn from
  a planar (y=0) forward vector, so the plane is model-independent (that constant is the single source of
  truth; ship spawn/recenter + hit-ring FX reference it, never a bare `0.6`). A model whose bounding-box
  centre sits off its hull leaves the nose/deck off that plane, so centre-aimed shots pass over/under it. We
  fix it by moving the MODEL, never the bullets: `shipModelCfg` adds `lift` to `pivot.position.y` (visual)
  **and** to every hitbox `c.y` (and grows `broadR` by `|lift|`), keeping model + hitboxes in lockstep as the
  hull seats onto the plane. `lift` is signed (positive raises, negative lowers). **All 9 modeled ships are
  tuned to their robust max plane coverage** (default `0` = no lift): player `0.18`, enemy_1
  (`Basic pirate ship`/`pirate gunner`) `0.21`, enemy_2 (`basic`/`advanced rocket pirate`) `0.17`, enemy_3
  (mini-boss/`advanced medium pirate`) `0.2`, enemy_4 (`first`/`second pirate boss`) **`-0.132`** (the boss
  bbox centre sat *below* the deck, so it's lowered). The `assets:hitboxes` run prints per-ship bullet-plane
  coverage + a suggested lift (`bestLift` scans a fine grid and returns the plateau *centre*, so the plane
  passes *through* the seated boxes, not tangent) so any future off-plane hull is caught at model-prep time.
  **`model.hitBoxes` + `model.broadR` — the auto-fit collision hitbox.** Instead of a single fat sphere,
  each real-model ship carries **one oriented bounding box per near-convex part** (V-HACD convex
  decomposition → PCA box per hull, **~48 boxes**) fitted to its actual hull by the `assets:hitboxes`
  pipeline step. Each box is `{c,h,u0,u1,u2}` — center, half-extents, and three orthonormal group-local
  axes — stored in the **same group-local noseZ frame** as `userData.noseZ` (after auto-scale to
  `SHIP_MODEL_LEN` 3.4 + recenter + `yaw`). The fit is **tight** (only a `HITBOX_MARGIN` 0.05 additive
  inflate, no round bubble), so a bullet passing through the empty gap **beyond a thin wing** no longer
  connects — but each box's per-axis half-extent is floored at `MIN_HALF` 0.1 (group-local) so a razor-thin
  wing/nose stays a **hittable slab** (a discrete ~1-world-unit/frame bullet would tunnel through anything
  thinner). The box budget is `maxHulls` 48 + `minVolumePercentError` 0.5 so **the wing panels/tips get
  their own hulls** (at 16-32 hulls V-HACD merged a wing into the fuselage → the player's outer wing was
  uncovered/"transparent"); a surface-coverage test guards it. `broadR` is the enclosing radius (~1.9-2.2,
  the exact farthest box corner). Do **not** hand-author these — regenerate with `npm run assets:hitboxes`
  (decomposes the combat glb with V-HACD via `vhacd-js`, memory-safe `voxelResolution 400000` (bounded voxel
  count, library default; `maxHulls` is only a part-count cap, cheap); writes into the seed's `model:{}`
  blocks via a marker-delimited idempotent edit, verified by a seed round-trip; `HITBOXES_DEBUG=1` prints
  each fit's box count / broadR / union span). Collision
  (`client/src/sim-core/collision.js`) is broad-phase (one
  `broadR × entity.scale` sphere at `entity.pos`) → narrow-phase (point-vs-OBB: each box center
  transformed by `shipMatrix(ship)` — collision.js composes translate × rotateY × uniform-scale from the
  entity's own `pos`/`heading`/`scale`, no scene graph involved — axes rotated by its upper-3×3 and
  renormalized, hit iff
  `|dot(p−c, uᵢ)| ≤ hᵢ·scale + pad` for all three axes; ignores the cosmetic bank roll). **Bullets use a
  SWEPT test** (`segmentHitsShip(ship, p0, p1)`) — the bullet's per-frame movement segment (pre-move →
  post-move) vs each OBB (both endpoints transformed into the box's local frame, then a slab test), behind a
  segment-vs-sphere broad phase — so a fast bullet (~1-3 world units/frame) can't tunnel clean over a thin
  wing/nose box between frames (the point test only checked the end-of-frame position). `segmentHitsShip`
  reduces to `pointHitsShip` when `p0==p1`, so it's a strict superset. Ships with no `hitBoxes`
  (primitive/cone fallbacks) keep the legacy single `2.6 × sizeScale` sphere. All four bullet/rocket↔ship
  sites hit-test the hull — bullets via the swept `segmentHitsShip`, rockets via `pointHitsShip` (slow +
  homing + padded, no tunneling) — including the **player** (fixing the old hardcoded `2.6` and the
  player↔rocket test that ignored ship size); the rocket's `detonateR` becomes the hit `pad` — so
  it's now a small **proximity fuse to the hull surface** (`detonateRadius` **0.5** on all rocket rows —
  near contact with the hull boxes, with a floor of ~one frame of rocket travel so a fast rocket can't
  tunnel past without detonating; retuned down from the old ~3.2–3.5 which measured to the ship *center*
  and made rockets detonate a ship-length away).
  **Rocket blast (AoE) damage is hull-relative too** (`detonateRocket` → `pointHitsShip(ship, pos, blastR)`),
  matching the detonation trigger — a center-distance test used to miss because the detonation point sits
  off-center on the hull. `e.radius` (`2.6 × scale`) is kept **only** as the over-enemy health-bar / marker
  anchor. Dev-only `?hitboxes` draws the wireframe boxes over every ship for eyeballing.
  **All damage — player AND enemy — routes through the shield first.** Every damage site (enemy bullet hits +
  the rocket blast on the player, and the player's bullet hits + rocket blast on enemies, all in `sim.js` /
  `projectiles.js`) calls the one router `applyShieldedDamage(ship, dmg)` (in
  `components.js`, alongside `absorbDamage`/`shieldRecharge`) — one implementation for both sides, so the
  lossless "absorb, then spill the excess to the hull in the same tick" invariant can't drift. The
  enemy-bullet→player hit resolution goes
  through the pure, THREE-free `resolveHostileBulletHit(player, p0, p1, damage)` helper in `collision.js`,
  returning `{ hit, damageResult, remove, impact }`. **The target surface depends on the shield:** while the
  shield is **UP** (`_shieldValue > 0`) the shot is swept-tested against the bubble **sphere** (`SHIELD_RADIUS
  = 4`, via the pure ray-sphere `segmentSphereHit`) and `impact` is the **sphere-entry point**; a **broken/
  absent** shield falls back to the **hull** swept test (`segmentHitsShip`) with `impact = null`. The helper is
  unit-tested and side-effect-/RNG-free (so record/playback stays deterministic), while the scene.remove /
  hit-flash / shield-ripple / SFX and the range-based bullet culling stay inline in `sim.update()` — which
  snaps the bullet to `res.impact` before spawning the hit-flash + ripple, so on a shielded hit both land **on
  the sphere surface**, not the hull inside it. `applyShieldedDamage` absorbs into the shield (`absorbDamage`)
  when one is equipped and still active, spilling only the **excess** to `hp`; a fully-depleting hit breaks the
  shield and resets its recharge timer. With no shield (or an already-broken one) the full damage hits the hull
  as before. It returns `{ absorbed, broke, toHull }` so the site can fire the shield-bubble ripple FX (see the
  **Shield-hit FX** bullet above) **and, when `toHull > 0`, the `hullHit` event the target's own reaction is
  drawn from** (hull flash / model punch / camera shudder — see **Hit feel** under Visuals). The third field
  exists because `absorbed` is not the same question: a shield that breaks spills the excess to the hull in
  the same tick, so the biggest hit in the game returns `absorbed: true` with 60 points on the hull. Note: while shielded the effective hitbox is the radius-4 sphere (wider/
  rounder than the hull OBB), so a few near-misses are caught by the shield — an intentional "the field is
  bigger than the ship" trade. **Enemies keep the hull hitbox** (no sphere interception — widening every
  enemy's hitbox would change aim feel), so a player shot that connects is tested against the hull as before
  and *then* routed through the enemy's shield. An **absorbed** hit plays the **same** `spawnHitSprite`
  flipbook mini-blast as a hull hit (the unified FX family, §75) but at **0.7× the class scale** and tinted
  **cyan** via the material's `uTint` multiplier (`SHIELD_HIT_TINT = (0.18, 1.25, 1.5)`, exported from
  `flipbook-fx.js` — the same per-blast tint mechanism as the boss secondary detonation), plus the enemy
  bubble ripple; once the shield is broken the hits flash orange again. See DECISIONS §76.
  **Known limitation — the y=0 aim plane (accepted, factor it in when choosing models):** bullets fly in the
  combat plane (y≈0 = a ship's centre of mass), while the boxes hug the model's real 3D geometry. So a model
  element that sits **off** y=0 is **not hit by a centre-aimed shot, and that is normal/expected** — e.g. the
  player's wings hang ~0.27 below centre (a y=0 bullet passes over them → they read as "transparent"), and the
  advanced-medium-pirate's drooped nose sits below y=0 (a shot registers deep in the body). The shot still
  connects with the body; only the off-plane extremities are missed. **When picking/authoring a ship model,
  prefer geometry whose hittable mass straddles y=0** (or accept that low/high appendages won't take hits).
  The scheduled fix (extend each box's Y to cross y=0) is in ROADMAP. An optional
  **`model_url_high`** (DB column, migration 012) holds the **hangar** high-poly `.glb` (CloudFront,
  lazy-loaded; the player + every real-model pirate have one — `player_hangar`, `enemy_1..4_hangar`,
  `enemy_1/2/3/4_orange_hangar`). See
  `client/assets/README.md` + `CREDITS.md`.
- **Component & weapon models (menu-only icons).** Components and weapons also carry optional
  `model_url` / `model_url_high` columns (**migration 016**, Postgres parity), exactly like ships, with the
  same `stats.model` `{ yaw, scale }` convention. Only **`model_url_high`** (hangar, CloudFront) is wired —
  items are **never rendered in combat** (they're part of the ship there), only shown as a spinning icon in
  the menu preview — so `model_url` (combat) stays null/unused and the hangar glbs reuse the `ships-hangar/`
  S3 prefix. Items with a model today: the **Repair drone** (component 12), the **Machine Gun** (weapon 5),
  and **all 14 engine + thruster components** — every `engine` (5, 6, 7, 15, 16, 23, 26) shares the
  **animated nozzle** glb and every `thruster` (8, 9, 10, 11, 21, 25, 27) the **turbine** glb, wired through
  the shared `ENGINE_MODEL` / `THRUSTER_MODEL` constants in `catalog_seed.js` (one model per family is a
  deliberate placeholder pass; per-tier models are a future iteration — swapping one in means editing one
  constant). The glb *file names* read backwards against their families (they are named after the source
  assets, which were swapped between families after a look at the preview); the catalog is the truth.
  All CC-BY 4.0.
  Every other item's `model_url_high` is null (the viewer degrades to nothing).
  `assets:check` validates item model URLs alongside ships. See `docs/plans/component-weapon-models.md`.
  - **Animated item models.** `model-viewer.js` plays a glb's **first animation clip on loop** via an
    `AnimationMixer` (`v.mixer`, advanced with the same clamped `dt` as the auto-rotate; cleared when the
    model is swapped or the viewer disposed). Models without clips keep `mixer` null and behave exactly as
    before. The only animated asset today is the **engine** icon (skinned, `"Flame startAction"`, 6 s) —
    its `model.scale` is **0.75** because the clip scales the flame well past the bind-pose bounding box the
    viewer fits, so at 1.0 the plume ran off the edge of the preview canvas. The thruster icon sits at
    **1.15**. The item cfg also takes **`pitch`** (rotation about X, applied in a group nested inside the
    yaw pivot so the spin axis stays vertical): the engine nozzle models standing upright, and `pitch:
    Math.PI/2` lays it down into a horizontal nacelle. `yaw` cannot do this — the preview auto-rotates
    about the vertical axis, so a yaw only shifts the spin phase. Guarded by visual scenario `96-item-models-engine-thruster` (asserts all 14 rows are wired,
    that the mixer clock *advances* for the thruster, and that it stays null for the clip-less engine); the
    `?debug` hook exposes `shopItemTarget` / `shopItemLoaded` / `shopItemClipTime`.
  The **L2 and L3 briefings still showcase the granted item** spinning at full size (Machine Gun on L2,
  repair drone on L3) and still run the **same idempotent grant actions** (`replaceWeapon 1→5` /
  `installComponent repair 12`) — only their **text was reworded** to a "you recovered / picked it up" framing
  (EN source + RU), since the reveal now also happens as a glowing battlefield drop at the end of the prior
  level (see Grab & loot drops → L1/L2 reward drops).
  - **Player ship** = the real **"Air & Space Vessel"** model (Raven, CC-BY): a light-grey/red textured
    fighter, **`model.scale: 1.1`**. The source is a Sketchfab model split "part x material" — 110 meshes over
    36 materials, the same material kind repeated per body part — so the combat build used to be **31 draw
    calls / 31 materials / 79 textures / 371 KB**, against 3-5 primitives for every other ship. Its combat
    build now runs the **material-flattening pre-pass** (see Asset pipeline): **15 draw calls / 16 textures /
    178 KB**, visually near-identical. The **hangar** model keeps the full textured material set
    (`player_hangar` ~1.7 MB, 512px, CloudFront, lazy-loaded). The pre-load fallback is the procedural
    placeholder ship (no in-git binary). Metal surfaces shine via the env map (see Visuals).
- **Static-asset cache headers** (`server.js`, DECISIONS §78): the client is served by `express.static(clientDir, { setHeaders })`. Content-hashed pipeline assets — `<name>.<hash8>.<ext>` for `.glb`/`.mp3`/`.json`, matched by the pure exported **`staticCacheControl(filePath)`** — get `public, max-age=31536000, immutable`; everything un-hashed (`index.html`, `src/*.js`, `styles.css`) keeps express's revalidating `max-age=0` default so a deploy is picked up on the next load. There is **no cache-bust / "reload assets" endpoint and none is needed**: a changed asset gets a new filename, the seed points at the new URL, and `/api` (never cached) hands the client that URL. Unit-tested in `server.test.js`, near-misses included.
- **Asset pipeline** (`docs/plans/ship-model-pipeline.md` + `audio-sample-pipeline.md`): repo-root `npm run
  assets:recolor` (`scripts/assets-recolor.mjs` — regenerates the `enemy_*_orange` sources by tinting the
  pack's RED materials to the **target hex `#f4741f`** (constant in the script), scaling each red shade's
  brightness so light/dark shading is preserved; black/gray untouched — uses the `@gltf-transform`
  **devDependencies**) / `npm run
  assets:build` (gltf-transform via npx → a content-hashed **combat** + **hangar** glb per `assets-src/*.glb`,
  or pass base names to build a subset, e.g. `assets:build enemy_1_orange`;
  default `PRESET.combat`/`hangar` in `assets-config.mjs`, with optional per-source **`PRESET_OVERRIDES`**
  merged by `presetFor` — combat geometry is **meshopt-compressed** to stay light for battle) /
  **`assets:materials`** (`scripts/assets-sample-materials.mjs` — samples every material of a source model
  into the committed sidecar `assets-src/<base>.materials.json`: the LINEAR-averaged base colour, the mean
  metalness/roughness off the MR map, an emissive mean when the map actually lights up, and `spread` = how
  far the most-deviant 5% of the base map's texels sit from its mean. Drives headless Chromium — reusing
  `client/`'s playwright — because the maps are jpeg/png/webp inside the glb. Re-run whenever a source model
  changes; the sidecar is the one thing under the gitignored `assets-src/` that IS committed, since the build
  can't reproduce without it) / `assets:push`
  (→ S3 `vega-sentinels-assets`: glbs to `ships-combat/`+`ships-hangar/`, **SFX mp3s to `sfx/`**, sources to
  `source/`) / `assets:pull` (S3 → `client/assets/ships/` **+ `client/assets/sounds/`**) / `assets:check`
  — the deploy guard: every content-hashed URL referenced in code must exist on S3. It covers ship /
  component / weapon models, SFX, the Level-0 `introTrace`, the shared loot-drop model, **and (since
  2026-08-10) everything reached through a MAP DESCRIPTOR** — the `.glb` set-pieces (freighter, base
  station, space factory) and the star's `system.star.modelUrl`. That last lane was a hole: a bad hash on a
  set-piece or the sun shipped a 404 and the object silently vanished (or fell back to a flat sphere) with
  nothing failing the deploy.
  **Material flattening (combat only, `scripts/assets-flatten.mjs`, DECISIONS §77).** A model opts in with
  `flattenMaterials: { keepTexturedAbove: N }` in its **combat** preset. Before `optimize`, every material is
  replaced by flat factors read from the `assets:materials` sidecar, so `optimize --palette` can merge the
  factor-only materials into one palette-textured material and `--join` can collapse the mesh — the fix for a
  source that is split "part x material" and therefore can never be joined. A material whose `spread` is at or
  above `keepTexturedAbove` KEEPS its base map (its texture paints several different colours, e.g. the player
  ship's red engine nacelles inside an otherwise-grey `Thrusters_Material` atlas, or the yellow wing chevrons
  inside `Wings_Material` — averaging those deletes the livery); everything else flattens. Normal /
  metallic-roughness / occlusion maps are dropped even on a kept material — a texture bind and a heavier
  shader permutation each, invisible on a ~50px top-down ship. Only the glb's JSON chunk is rewritten (the BIN
  chunk passes through), so **geometry is unchanged** and the generated `model.hitBoxes`/`broadR`, collision
  and the recorded intro replay are all unaffected. Currently opted in for **`player`** (`keepTexturedAbove:
  34`, the measured value that keeps every visible marking). The **hangar** build never flattens.
  (drift-check, three lanes: every pipeline `model_url*` in the seed, **every `SOUNDS` url in
  `catalog_seed.js`**, **and the `level-0` descriptor's `introTrace`** exist on S3 — the deploy guard). **No model binaries in git** (S3 canonical; the pre-load fallback is a
  procedural placeholder ship, not a binary). `scripts/assets-*.mjs`. **CI is wired** (the deploy job runs check + pull before the build,
  baking combat models **and SFX** into the image) via a scoped **read-only IAM key** (`vega-assets-ci-read`,
  bucket-wide read → GitHub secrets `ASSETS_AWS_*`). **Audio SFX**: drop a source in `assets-src/sounds/`,
  extract/clean/encode an mp3 by hand (ffmpeg recipes in the audio plan), content-hash → `assets-dist/sounds/`,
  push, then add the hashed url to **`SOUNDS`** in `catalog_seed.js` (+ a `SOUND_MAP` row to route it to a
  ship/weapon class). See DECISIONS §14 + §22.
  **`npm run credits:build`** (`scripts/credits-build.mjs`, DECISIONS §48) parses `client/assets/CREDITS.md`
  → the committed `client/src/credits-data.js` powering the in-game Credits screen; `credits:build --check`
  is the drift guard (wired into `client/src/credits-data.test.js`), and **`build:itch` regenerates the
  staged `credits-data.js`** from `CREDITS.md` so the itch export can never ship stale attributions.
- **Weapons** (DB `weapons`, type `bullet`/`rocket`/`beam`): bullets — `power` (damage), `projectileSpeed`,
  `maxRange`, `fireCooldown`. **There is no auto-aim: a bullet always leaves along the ship's nose.** Guns
  used to carry an `aimAssistDeg` cone that silently redirected a shot at any opposing-side target inside
  it — removed 2026-08-20 (DECISIONS §124), stat and code together, for the player *and* for enemies.
  Removing it from enemies changed almost nothing (measured: ~0.2% slower to kill a circling parked player),
  because the enemy AI already turns to face you before it fires; the cone was doing the player's aiming.
  Velocity inheritance (`spawnBullet` adds the shooter's velocity) is unchanged. rockets — `power`, `accel`, `turnRate`, `launchSpeed`, `maxRange`,
  `health` (HP it can absorb from gunfire), `seekHalfAngle`, `detonateRadius`, `blastRadius` (AoE), plus
  **detonation-FX stats** `blastVisual` (burst size), `blastTimeScale` (burst speed — `0.8` = 20% quicker),
  `blastTint` (burst color) read by `spawnRocketBurst`. The
  player's homing rocket seeks the nearest enemy in a forward cone and trails a thin fading haze line
  (see FX below); a bullet subtracts
  its `power` from an opposite-side rocket's HP, shooting it down at 0 (enemy rocket 20 HP = two player
  gun hits). Seeded bullets: **Basic kinetic** (id 1, power 10 / cooldown 0.18; **price 800** — granted
  into the stash on shop unlock, sells ~600 toward the Heavy hull), **Kinetic (enemy)** (id 2, power 4),
  and **Machine Gun** (id 5 — rapid-fire kinetic: power 7, cooldown 0.1, projectile speed 50, range 100,
  weight 8; **priced 1500** — strong, so not cheap). Rockets: **Rocket (homing)** (id 3, power 60 / health 10,
  **priced 600**), **Rocket (enemy)** (id 4, power 25). **Player shop ladder** (priced;
  `docs/plans/economy-shop-v2.md`): **Heavy cannon** (id 6: power 25, slow fire / long range / **2000**),
  **Heavy Machine Gun** (id 7: power 12, cooldown 0.12, high RoF, **weight 15** — the heaviest gun in the
  game; **6000** credits, **gated behind "Level 3"**), **Heavy rocket** (id 8: homing, power 90, slow
  reload, big blast / **2600**), and **Triple spiral rocket** (id 11: **4000**, top of the rocket ladder —
  `stats.spiral:true`; **gated behind "Level 3"**). The triple spiral fires an **invisible leading homing rocket** (steers via
  `findTargetInSector`, deals no damage, not shootable) that defines the flight path; **three visible
  cyan warheads** (power 40 / health 10 each; flight = Heavy-rocket-class ×1.2: launchSpeed 14, accel 12)
  spiral around its axis (radius 1.4u, 6 rad/s, 120° apart). Each warhead is a real rocket — it detonates
  on its own proximity and can be individually shot down (all three connecting = 3× = 120 damage);
  fireCooldown 7. Its shop/loadout stat line shows damage as **40×3** (`statLine` special-cases
  `stats.spiral` — per-warhead × warhead count — so a 3-warhead weapon isn't misread as a single 40).
  Enemy weapons: **Pirate machine gun** (id 9 — long-range 90, rapid fire 0.18,
  low damage 3; pirate gunner + buffed boss) and **Advanced pirate cannon** (id 10 — power 10, slow 1 shot/sec,
  long range 110; the Second Boss's main gun).
- **Charged beam** (id 12, the third weapon `type` — `'beam'`): **power 80, maxRange 100, chargeTime 1.0 s,
  corridorDeg ±2° (a HALF-angle), fireCooldown 0.5 s, weight 12, price 5500, gated behind "Level 3"
  (`FACTORY_GATE`), `class: 'beam'`, `projectileColor 0x3d8bff`.** **That colour is not decoration: it is what the beam
  BURNS** — its bolt, its charge dust and its muzzle bead, carried on both beam events and applied per
  shot. The hue belongs to the WEAPON, never to the side firing it, so the pirates' row (id 13, red
  `0xff6b4a`) stays red in an ALLY's hands.
 A shot that takes time, has no
  projectile and announces itself: pull the trigger and energy builds for a full second, then it
  **hitscans** — it strikes the ship it painted at charge start if **any part of that ship is still inside
  the ±2° wedge drawn from the nose**, otherwise whatever is in the corridor at that instant (nearest),
  otherwise nothing. Half a second later it can fire again, so **the true cycle is `chargeTime +
  fireCooldown` = 1.5 s → 53 DPS**.
  **THAT LOW SUSTAINED DPS IS DELIBERATE — do not "fix" it.** 53 is *below* the 800-credit starter gun
  (56) and beside Heavy cannon (58). Offered a zero cooldown or 120 damage to restore 80 DPS, the
  maintainer declined both (2026-08-25) and kept the 5500 price and the Level-4 gate after being told it
  reads as a trap purchase. The reasoning, which is a real argument rather than a preference: **nominal DPS
  assumes every shot lands.** A kinetic round has travel time and must be LED, so much of it misses a
  manoeuvring target, while the beam has zero flight time and lands on whatever stayed in the corridor —
  and it reaches 100 u where the starter gun reaches 88. Any rebalance must compare **effective
  damage-on-target**, not the stat line. (DECISIONS §135.)
  The trigger is a **tap that COMMITS**: nothing interrupts a
  charge — not releasing fire, not damage, not the locked target dying (the lock just drops). Turning away
  breaks the shot; turning toward the target tracks it, so **turn rate is its skill stat** — and at 1.0 s
  every target drifts twice as far as it did at the original 0.5 s, which makes **active tracking with A/D
  mandatory rather than optional** (a mere 5 u/s crosser now covers 5.0 u against a ~3.3 u effective window
  at 20 u, and escapes). It is
  **undodgeable** — the corridor *is* the dodge (RNG-free; DECISIONS §135) — and it cannot be shot down.
  It occupies the **primary gun slot** and fires on **Space**, so buying it means **giving up your rapid
  gun**: the `gun` slot now accepts `bullet | beam` (`client/src/shop-slots.js`, mirrored server-side by
  `WEAPON_GROUP` in `db.js`). The **Kinetic skill scales it** like every other non-rocket weapon
  (`makePlayer` multiplies `power` by `kineticDmgMul`), and the skill card's generic "+X% damage" text
  needs no change. Its shop stat line reads exactly
  **`DMG 80 · Charge 1.0s · Arc ±2° · RoF 0.7/s · Range 100 · Weight 12`** — the RoF is
  `1 / (chargeTime + fireCooldown)` rendered at the label's existing one decimal (0.67 → `0.7`), **never**
  `1 / fireCooldown`, which would advertise **2.0/s** for a weapon that spends a whole second charging.
  `Speed` is skipped: a hitscan has no projectile speed. It has no `modelUrlHigh`, so
  the shop shows the "no model" placeholder.
  **ONE SHIP CARRIES A BEAM: the `pirate lancer`, and it carries its OWN weapon row (id 13, below).** The
  player's 12 remains a hangar purchase and appears on no ship row. The simulation is **side-agnostic** —
  `sim-core/beam.js` has no `side === 'player'` branch anywhere and `updateGroups` routes player, ally and
  enemy down the one branch — which is why arming a pirate was a catalog edit plus rendering work.
  **Mixed-group trap, for whoever adds the next player ship:** `isBeamGroup` uses `some`, so a group
  holding a beam takes the beam path and **every other mount in it goes silent** (it never reaches
  `fireMount`). `equipItem` replaces the **first** mount of the target group (`db.js`), so a player ship
  with *two* `gun` mounts would end up with a beam in one and a kinetic in the other. No **player** ship
  has two mounts in one group today; four enemy ships do, six groups between them (twin guns / rocket pods
  — `first pirate boss`, `second pirate boss`, `pirate mini boss`, `advanced medium pirate`), which is why
  the lancer got its **own single-mount group** rather than a weapon id swapped onto one of those — it is
  the worked example of the right way to arm an enemy with a beam.
  `server/src/catalog_beam.test.js` guards all of it, and now asserts that **exactly one** seeded ship
  carries a beam and that it is `pirate lancer/gun`.
- **Pirate charged beam** (id 13 — the ENEMY beam, and the second `'beam'` row): **power 45, maxRange 67,
  chargeTime 1.0 s, corridorDeg ±2°, fireCooldown 2.0 s, weight 12, `buyable: false`, no `minLevel`, price
  250 (resale only), `class: 'beam'`.** Deliberately a **second row rather than a shared one**: every
  behaviour number lives in the weapon row precisely so two ships can carry differently-tuned beams, and
  `sim-core/beam.js` reads all five off `g.mounts[…].weapon` every tick. Damage and reach are the only
  levers turned down from the player's row — **the telegraph length is unchanged on purpose**, because the
  second of warning is what makes the weapon fair rather than what makes it weak. **The cooldown is 4× the
  player's 0.5**, set by the maintainer after flying the first pass: the cycle is **3.0 s → 15 sustained
  DPS**, *below* the pirate machine gun's 16.7 and above the advanced pirate cannon's 10, while 45 is still
  2.25× the biggest single hit that exists (the 20-damage pirate rocket). A big, rare, announced hit rather
  than a stream — do not restore the shorter cooldown to "fix" the DPS (DECISIONS §135). Its `class: 'beam'` reuses the existing
  charge + fire `SOUND_MAP` rows, but **a hostile charge is silent** — both beam sounds stay gated on
  `ev.fromPlayer` (only your own shots are audible; DECISIONS §135). It is a normal enemy weapon in every
  other respect, which means it can be **LOOTED**: enemy weapons drop into the stash and the `gun` slot
  accepts `beam`, so a player who kills a lancer could equip a 45-power beam without paying 5500 or
  clearing the Level-4 gate. Unreachable in shipped play (the lancer spawns only behind `?lancer`), and a
  real question the day Level 5 fields lancers.
- **Enemy types** (DB ships, `type` `enemy`, `stats.role`). **Appearance = the ship's `.glb` model; we
  never tint by `color`** (see DECISIONS §14), so enemies that reuse a base model look like it until a
  distinct model is authored. The basic pirates use the **red `enemy_1..4` models**; the advanced tier uses
  the **orange (`#f4741f`) `enemy_*_orange` recolors** so they read as distinct. `fighter` (`Basic pirate
  ship`, `enemy_1`, gun, 30 hp light hull), `rocketeer` (`basic rocket pirate`, `enemy_2`, gun + rocket, same
  30 hp light hull), `medium` (`pirate mini boss`, `enemy_3`, two rocket launchers, 150 hp medium hull →
  sluggish, 2× model), `pirate_gunner` (a fast skirmisher for the side missions — **orange `enemy_1`** —
  Pirate hull 36 hp + Pirate engine top-speed +50% + one **long-range** Pirate machine gun; reward 50),
  `advanced_medium_pirate` (the L4 heavy — **orange `enemy_3`** — **300 hp**, turns ~+30% vs the medium,
  1 Pirate MG + 2 rockets; reward 200), the `boss` (`first pirate boss` — `enemy_4` + own hull/engine,
  **310 hp** (boss buff: 210 +100), 3× model, max speed 10.4 (+30%), **two Pirate machine guns** + two rocket
  launchers), and `boss2` (the **Second Boss**, `second pirate boss`, L4 finale — **orange `enemy_4`** —
  **550 hp** (boss buff: 450 +100), max speed 14.3 (+30%), ~+30% accel/turn vs the first boss, **two
  Advanced pirate cannons + three rockets**; reward 500). **Two** more ships are seeded but **not wired into
  any level** yet: `advanced_rocket_pirate` (`advanced rocket pirate`, **orange `enemy_2`** — Pirate
  hull/engine, Pirate MG + a rocket; reward 75), kept for a future harder rocketeer wave, and
  `pirate_lancer` (`pirate lancer` — **the first enemy in the game that carries a CHARGED BEAM**, weapon 13,
  in its own single-mount `gun` group with the `BEAM` preset). Pirate hull + Pirate engine + its OWN thrusters
  (36 durability → 12 shield + 24 hull), reward/xp **100** — above the gunner's 50, below the mini boss's
  125, because it is the most dangerous small ship in the game. It **reuses the pirate gunner's orange
  `enemy_1` .glb and its baked model block verbatim**, so it is *visually identical to a gunner* — the red
  aiming corridor is the identification, accepted knowingly (DECISIONS §135), and no asset or `CREDITS.md`
  row changed.
  **It turns at 50°/s (0.873 rad/s) — the SLOW FIGHTER TIER, shared with the pirate gunner and the advanced
  rocket pirate** (see the turn-rate ladder above; no superlative, because that claim has been wrong three
  times). Set by the maintainer after flying the first pass's 148°/s. Turn rate is derived, never a field, so
  it carries a **dedicated thruster row** (component **32, `Pirate fighter thruster`**, power 0.541,
  `buyable: false`) exactly as the `Pirate medium thruster` (25) and `Second-boss thruster` (27) do:
  `0.541 × REFERENCE_MASS 50 / mass 31 = 0.873 rad/s`. That row keeps the Scout thrusters' **weight 3**, so mass stays **31** and **acceleration is
  unchanged at 30.6** — the turn was slowed, not the ship. At 50°/s it turns slower than the player (115°/s)
  and slower than a player's ~96°/s bearing sweep at the AI's 14–22 u standoff, which is what makes its beam
  escapable during the 1.0 s charge. **It spawns only behind the `?lancer` dev flag**
  until Level 5 fields it — putting it in a shipped pool would move `enemyTotal` and break recorded traces. Which
  enemies spawn is decided by the **level/mission** (see Gameplay), not the ship; ship `radius` scales with
  model size. Each enemy carries a **`reward`** (`stats.reward`, fighter 25 / rocketeer 50 / pirate gunner 50 /
  medium 125 / advanced medium pirate 200 / first boss 250 / Second Boss 500) in **credits**, earned on
  destruction. (`stats.color` is metadata for the radar markers/mini-map + explosion tint + the loading
  placeholder — not a model tint; set from the `MARKER` size-tier palette, see HUD above.)
- **Balance reference:** player — 100 hp hull, gun 10 damage; basic enemy — 30 hp light hull, gun 4 damage
  (an enemy dies in 3 player hits; the player survives ~25 enemy hits).

## Gameplay
- Inertial physics (like Asteroids): thrust along the nose, velocity is preserved; when all
  buttons are released — smooth braking. The **player** velocity is capped at a **flat top speed of
  30 u/s** (`PLAYER_MAX_SPEED`, a movement-system constant — enemies still clamp to their per-engine
  `maxSpeed`). Each run **opens already gliding forward at 3 u/s** (10% of top speed, `+Z`), and
  **enemies hold fire for the first 5 s** of a run (`G.combatElapsed` grace — they still spawn, move
  and aim; silent, no HUD countdown).
- **Soft arena boundary (±360).** The player can fly **past** the edge freely — there's no hard wall. A
  faint glowing **edge marker** (a Line at ±360, brightens as you approach/cross) shows where the
  battlefield ends. After **2 s continuously out of bounds** (`OOB_WARN_DELAY`) a centered HUD **warning +
  countdown** appears ("You've left the battlefield — return to the combat zone" / "Returning in {seconds}s",
  i18n keyed); re-entering clears it. After **30 s** out (`OOB_RETURN_TIME`) the ship is **warped back to
  center** (velocity zeroed, replaying the enemy warp-in grow animation). The **30 s warp-back is suspended
  during return-to-base** (`&& !G.returnToBase`) so, after the last kill, a side mission fought far from `(0,0)`
  can fly the full way home. **Nothing is hard-clamped to the arena** — enemies chase the player out and fight
  freely (no edge clamp), and bullets/rockets fly normally beyond ±360 (limited only by range/hits); combat works
  fully out of bounds. ±360 only drives the boundary UI (edge marker + warning/warp-back). Enemies **spawn in a
  ring around the mission-zone center (`arenaCenter`)**, not the hero (70–130u; `ship-build.js`), so waves still
  originate at the zone/set-piece after the player wanders. See DECISIONS §2 (+ the §39 amendment).
- **Off-center / drifting arena.** The boundary, warp-back and mini-map all compute relative to a
  **combat-zone center** (`arenaCenter`). A side mission sets it to the mission's `center` (so its fight
  happens at that location); the campaign uses `(0,0)`. A `drift` `{x,z}` (units/sec) can also *pan* the
  center over time (edge marker + warp-back + mini-map follow; a `sync` set-piece rides it) — the mechanic
  is built and tested, but **no mission turns drift on today** (set-pieces are static). Wired for a future
  escort mission.
- **The ally (a third combatant)** — a Sentinel **wingman** who is neither the player nor an enemy
  (`sim-core/ally-config.js` / `ally.js` / `step-ally.js`; design brief `docs/plans/combat-ally.md`).
  **No level that ships spawns him**: he arrives only when a level **phase carries `ally: true`**, which
  Level 5 will set and the **`?ally` dev flag** injects for local play (`client/src/ally-dev.js`). `?ally`
  names the **phase** (bare = `clear-out`; `?ally=<phase>` names another) and the existing **`level`** param
  names the **level** — the same param and the same `normalizeLevelName` mapping `?record=1&level=<id>` uses
  — so `?ally=wave-1&level=4&debug` is a reproducible test flight. The level half exists because Level 3 and
  Level 4 carry IDENTICAL phase names, so a flight aimed at Level 4 silently landed on whichever level the
  account happened to be on. Not sticky, URL only. With the flag off there is no ally, no ally step, no extra
  entity and **not one extra seeded RNG draw**.
  **`?lancer` is the same shape, for the pirate lancer** (`client/src/beam-dev.js`, transform in
  `sim-core/lancer-config.js`): bare `?lancer` = phase `wave-1`, `?lancer=<phase>` names another, `&level=N`
  forces the level, `0|false|off` (or absent) is off. It swaps that phase's `spawn.pool` for **100 %
  `pirate lancer`** and clamps `spawn.maxConcurrent` to **2** (two simultaneous 1-second telegraphs is a
  legible fight; five is a red lattice) — and touches **`spawn.total` and `advanceWhen` for nothing**, because
  `advanceWhen: { kills: N }` is cumulative and `enemyTotal` is the sum of every phase's total. It is
  draw-count neutral (`pickShip` calls `simRandom()` once per spawn even for a single-entry pool), it
  composes with `?beam` (`?beam&lancer&level=4` is your beam against theirs), and it is **forwarded on the
  netsim handshake** so a room runs the same fight. Like `?ally`, a campaign session recorded with it on
  re-simulates into a divergence in `verify-sessions.mjs` — expected for a dev flag.
  - **What he flies:** the same `player_combat` .glb as you, with his **WINGS repainted blue**
    (`ALLY_ACCENT_COLOR 0x2f6bff` over the model's `Wings_`-prefixed materials, via `applyShipModel`'s
    optional `accent`). That repaint is the only thing separating him from the player in 3D: catalog ships
    are built with `tint: false` (`ship-factory.js modelSpec`), so a ship's `color` reaches the **minimap dot
    and the primitive placeholder but never the .glb** — `ALLY_COLOR 0x3ddc84` is his radar green, not his
    hull. The accent defaults to `null` for every other ship, so nothing else in the game is touched. No new
    asset, no `CREDITS.md` row, no content-hash change.
    Heavy hull id 13 (**200 HP**), Basic engine id 5, Basic thrusters id 8, Repair drone id 12, Base shield
    id 31, **Heavy cannon id 6 + Rocket (homing) id 3**. **No grab and no skills** — so he never reacts to
    loot, and a hostile hit never rolls the dodge draw. Derived by `deriveDrive`: mass **86**, acceleration
    **8.7**, turn **1.16 rad/s**.
  - **He flies the PLAYER's movement model, not the enemy's.** Top speed is a property of the ship, not of
    the engine, so he is capped at the flat `PLAYER_MAX_SPEED` **30 u/s** read from `step-player.js` (never
    `engine.maxSpeed`, never the enemy `DRAG`, never the passive `IDLE_DRAG`). He is always either thrusting
    or braking on the player's own kinematic decel (`brakeVel`, extracted from `brakeStep`). 0→30 takes
    **3.45 s**; a 180° reversal takes **2.71 s** and **brakes and turns together**, so he comes about nearly
    stationary and rebuilds speed into the next pass — a ~6 s cycle swinging him ~50 u out and back.
  - **His nose is aimed for the GUN, not at the enemy.** Kinetic bullets inherit the shooter's velocity
    (`spawn.js`; rockets deliberately do not, DECISIONS §70), so a ship drifting across its own line of fire
    misses even a STATIONARY target — and his whole manoeuvre is a firing pass with heavy lateral drift.
    `aimWithDrift` picks the nose so the RESULTING bullet travels at the target. The nose is optimised for
    the gun (0.6 s cooldown vs the rocket's 5 s), which means the two weapons on the hull fly down
    **different lines** — so every question about a shot is asked **per fire group, of the path that group's
    projectile actually takes**: `fwd × speed + vel` for a bullet, and the bare nose for a rocket, which
    inherits nothing and homes afterwards. Both the aim gate AND the §2.6 player-safety gate read that same
    per-group path. `aimWithDrift` takes the bearing from the hull CENTRE, not the muzzle (~3-4° of parallax
    at 20 u) — the same parallax the player's and every enemy's aim already carries. It corrects the
    SHOOTER's drift only; leading a moving target is a separate problem. **Enemies have the same flaw and
    are deliberately left alone** pending a balance pass (see below).
  - **What he does:** charges the enemy nearest **to himself** (`ALLY_TARGET_LEASH` is `Infinity`; make it
    finite to keep him near the player), fires when the SHOT is on, **flies through the hull** (deliberate —
    there is no ship-to-ship collision and no lateral pass offset), then brakes and comes about. He re-picks
    once the target is >120° behind (`ALLY_BEHIND_ANGLE`), snapping straight onto anything already inside the
    0.25 rad aim cone. **He never fires through your hull** — and that is judged per weapon group on the path
    the projectile really takes (below), not on the nose. With nothing to fight he escorts toward
    `ALLY_ESCORT_DIST` ~10 u of you, judged on the **closing** speed so he holds formation instead of
    settling 60 u back. *Known:* coming at you from a standing start facing away, his 26 u turn radius puts
    him into a slow bounded orbit rather than onto the hold point; it is idle/healing behaviour and is left
    for a live judgement.
  - **He breaks off at ≤25 % hull with the shield down, the instant the damage lands** — mid-charge or not —
    and flies **directly away from the nearest ENEMY** until that gap reaches `ALLY_BREAK_OFF_DIST` **120 u**,
    holds there while the drone works, and **rejoins at ≥40 % hull with the shield full**.
    *§2d's "low health never interrupts a charge" is RETIRED (2026-08-23): it was written while he could not
    die, and once he was mortal it meant "die mid-charge". Level 4's boss deals ~35 dmg/s, so 20 % of a
    200 HP hull was a ~1 s window against a ~6 s pass cycle — the decision landed inside the fatal window
    about one time in six.* The condition is evaluated every tick and acted on at once (equivalent to a
    damage trigger: it can only newly become true when damage lands, since the drone only heals and the
    shield only refills). The shield clause is kept but is nearly free — damage routes through the shield
    first (§76), so at the instant hull damage lands the shield is already down. **He can still die**; that
    is a chance, not protection. The cost, accepted: he turns away with his nose still on the enemy, so the
    gap dips to near contact during the ~2.7 s reversal before it opens. The threat is
    recomputed every tick (the nearest one can change as he runs) and the arrival rule is judged on the rate
    the **gap is opening**, not on ground speed, so a pursuer matching his course does not read as escape.
    With no enemy at all there is nothing to break from, so he falls through to the escort instead of flying
    into empty space. *The distance was measured from the ARENA CENTRE and was broken twice over: enemies
    spawn at 70–130 from that same centre, so the old 70 u holding point sat on the inner edge of their spawn
    ring — and since he charges enemies out there, his own distance from the centre was normally already past
    it, making the remaining distance negative, thrust 0, and the "retreat" a dead stop in the middle of the
    fight.*
  - **He CAN die** (§2.4, reversed 2026-08-23 — an immortal wingman soaked three boss rockets at a sliver of
    hull and read as a prop). `stepAllyDeaths` removes him at `hp <= 0` and emits **`allyDown`**; he is gone
    for the rest of the **mission** and returns in the next one, because a fresh run empties `world.allies`
    and the level's phase spawns him again. He is worth **nothing** — no credits, no XP, no loot roll, and
    `world.kills` does not move, so phase thresholds, `enemyTotal`, `isLastKillDrop` and the `cleared`
    payload cannot notice, and his death does not end the mission. The **explosion FX is the entire
    announcement**: no banner, no log line, no new string. (Known and accepted: with no orders in this cut
    the player cannot defend him, so his death reads as bad luck rather than as their mistake.)
  - **Enemies fight him.** `nearestHostileTarget` (`sim-core/targeting.js`) gives a hostile ship the nearer
    of player-or-ally to steer, aim, fire and home at — **including a RETREATING one**, deliberately: he must
    behave as close to a real player as possible, and he outruns every Level-4 pirate, so being chased costs
    him nothing. With no ally it returns `world.player` verbatim, so every existing level is unchanged.
  - **Friendly fire is off in both directions.** A projectile is only ever "friendly" or "hostile"
    (`fromPlayer` means *the friendly side*), and a hostile one now tests the player **and** every ally.
  - **His kills count but pay nothing.** A kill he lands increments `world.kills` (so phases advance, the
    HUD moves, banners fire and the last-kill drop still rolls) and adds **0 credits and 0 XP**; the kill
    event carries `byAlly`, which suppresses the credit popup and the event-log line. `world.allyKills` is a
    **diagnostic** of his share of the run — on `window.__game.allyKills`, and deliberately in neither the
    world digest nor the world summary.
  - **On screen (A4):** hull + shield bars from the same pool the enemies use, and a green minimap dot.
    Deliberately **no** off-screen edge arrow (it would read as "threat over there"), no name label, no HUD
    panel and no player-facing copy at all.
- **Grab & loot drops** (`client/src/drops.js` + `drops-config.js`; docs/plans/2026-07-03-1412-grab-tractor-drops.md).
  On each enemy kill there's a **20 %** chance (`DROP_CHANCE`) to drop **one** item — chosen uniformly from
  the enemy's **non-hull** components (engine, thruster) **+** its mounted weapons (the real catalog id +
  kind; `pickLoot`). **Hulls NEVER drop** (progression guard — a looted 550-HP boss hull would be
  equippable and break balance). A drop is a slowly-rotating **metal-box** glb (one turn / 5 s), rendered
  from the single `DROP_MODEL_URL` (a fallback metallic box shows until the model loads). The **Grab**
  component (if equipped) pulls drops in via an **inverse-square field** (`field = strength·FIELD_K/dist²`,
  `FIELD_K = 5`; `field()` in `drops-config.js`): a drop must sit where **field ≥ 0.4** (`FIELD_CUTOFF`) for
  **0.3 s** (`ARM_DELAY`) to arm, then the **nearest** armed drop is pulled toward the ship's live position
  at a **linear-ramp speed** (`pullSpeed(weight, dist)` — deliberately **not** the field): speed rises linearly
  from **`PULL_SPEED_FAR` (1 u/s)** far out to **`PULL_SPEED_NEAR` (4 u/s)** at the ship (weight-10 refs, at/beyond
  `PULL_FAR_DIST = 11` it sits at the floor), then `·(10/itemWeight)` (light parts fast, heavy slow; zero/missing
  weight falls back to 10). The linear ramp is un-physical on purpose — a **constant slope has no near-ship jerk**
  and plays better than the `1/dist²` field speed it replaced. **Speed depends on distance + weight only, not on
  strength** — strength drives reach, not speed. Reach is **emergent + weight-independent**
  (`range(strength) = sqrt(strength·5/0.4)`, no weight term): base strength 13 → **≈12.7 u**, Advanced
  strength 26 → **≈18.0 u (= √2× base, not 2×)**. Both strengths were raised **+30 %** (10→13, 20→26) on
  2026-08-09; because reach is a square root, that's **≈+14 % reach** (11.2→12.7 / 15.8→18.0). A single **thin blue line** (pooled `THREE.Line`,
  `0x4db6ff`) is drawn only **while actively pulling** and **hides the instant** a drop drops below the
  cutoff; at most one drop is pulled at a time. Within 3 units the drop is **collected** (`pendingLoot`). The
  base grab's short reach (≈12.7) is a deliberate "vacuum assist"; the Advanced grab (≈18.0) is the real
  tractor + the upgrade incentive. A **`MAX_DROPS = 40`** cap bounds the
  arena. Collected loot is deposited into the **Stash only on mission VICTORY** (`levelRunner.win` →
  `depositLoot` → `POST /api/players/:id/loot`); on **death** or **restart** the haul (and any un-grabbed
  drops) is **lost** — nothing about a run persists until it's won, consistent with credit banking. The
  roll + pull are **client-authoritative** (server just banks the haul; forgeable like unsealed rewards,
  DECISIONS §18). `updateDrops(dt)` runs inside the sim `update(dt)`, so drops **freeze on pause**;
  `clearDrops()` (in `reset()`) removes the meshes/line and discards uncollected loot.
  A drop is also **clickable/tappable → engages autopilot to fly to it** (`engageDropAutopilot`, works in
  **combat and return-to-base**; a chest under the pointer wins over the station on overlap); a `cursor: grab`
  **hand** shows on chest hover (mouse only, `canvas.grab-cursor`, wins over the dock cursor). The targeted
  drop being collected/removed (or a reset) **cancels the autopilot** — it never auto-chains to another chest.
  Drops read as **brushed silver** — their glb (and the fallback box) material is overridden to a light silver
  albedo (`0xd2d6de`, `metalness 0.55`, `roughness 0.4`) with a faint **emissive floor** (`0x3a3e46`) so a
  crate is visible against dark space and never fully black (a one-time tweak in `normalize()`; a pure chrome
  mirror had gone black where the backdrop was dark). Each drop also gets a **soft additive halo tinted by
  its item's rarity `color`** (trash white / common green / rare blue) — `addHalo(obj, colorInt,
  DROP_HALO_SIZE=4.5)` in `spawnDrop`, using a **fresh SpriteMaterial per drop** so a per-drop tint never
  cross-contaminates other drops (clones share materials); the reward-drop halo keeps the default green.
  On collection the pickup is logged to the **event log** tinted the same color (see Tools → Event log).
  **Off-screen drops
  show green `0x59e0a0` edge arrows** (`updateDropMarkers` in `hud.js`, its own pool + `.drop-marker` CSS,
  the **nearest 6**), distinct from the enemy edge markers — the edge pointers stay **fixed green** (not
  recolored by rarity).
  - **L1/L2 reward drops (cosmetic).** The **last enemy of Level 1** drops the **Machine Gun** model and the
    **last enemy of Level 2** the **Repair drone** — rendered from each item's `modelUrlHigh` (the same
    lazy-loaded hangar glbs the menu preview uses; a **green fallback box** shows until it loads). Marked
    declaratively by a `lastKillDrop` `{ kind, refId }` field on the L1/L2 level descriptors
    (`catalog_seed.js`); the sim spawns it (`spawnSpecialDrop`) when `G.kills === G.enemyTotal` **and** the
    player doesn't already own the reward (`ownsReward`/`rewardOwned` — L1: no mount with `weapon === 5`; L2:
    the `components.repair` slot empty), else it falls back to the normal 20 % metal-box roll. The special
    drop renders **green** (an emissive `REWARD_TINT 0x59e0a0` tint via `normalizeGreen`, **not** the silver
    override) with one **additive green halo sprite** behind it (`addHalo`, radial-gradient `CanvasTexture`,
    additive/`depthWrite:false`; no bloom/post), and its off-screen pointer uses the **pulsing `.drop-marker.special`**
    variant (brighter green `#7dffbf` + an animated green `drop-shadow` — the pulse, not the hue, is what
    distinguishes it from the plain green loot arrows). It reuses the whole normal drop lifecycle (rotate,
    grab-pull, click/tap `engageDropAutopilot` to fly to it) but is **cosmetic — collecting it deposits
    NOTHING** (`collect()` gates the `pendingLoot` push on the pure `shouldDeposit(d)` = `!d.special`). The one
    guaranteed copy of the reward still comes solely from the **unchanged** server force-install on victory
    (clearing L1 runs L2's briefing `replaceWeapon 1→5`; clearing L2 runs L3's `installComponent repair 12`,
    both idempotent), so grabbing the drop or ignoring it makes no difference and the player never ends with
    two. Only L1/L2 carry `lastKillDrop`.
- Camera: nearly vertical, rigidly attached to the player, does not rotate. The fixed offset
  (`CAM_OFFSET` = (0,110,26)) is scaled by the player's zoom (`ZOOM_MIN 0.35 – ZOOM_MAX 3.5`) along its
  angle — zoom never changes the angle, FOV, or camera type. Near/far are **0.1 / 1300** (far raised from 900
  so a star-system body still fading at 760 u from the ship can't be clipped when max zoom pushes the camera
  ~396 u further back). **Zoom also slides the fog** (`applyZoom`,
  engine.js): `THREE.Fog` fades by depth *from the camera*, and zooming out moves the camera up to ~396 u
  from the ship — past the zoom-1 `fogNear` of 240 — which used to visibly **dim the player ship and the
  station set-pieces**. Both planes now shift by the extra camera distance, so fog always starts the same
  distance *past the action*; it is an exact no-op at zoom 1 (240..600), and `fogFar` is clamped to
  `camera.far − 20` so geometry fades out before the far plane clips it. DECISIONS §99.
- **Landing screen (reflects the current level)** — on load the homepage depends on the player's current
  level, a **three-way branch** (`main.js`): (1) the **intro ("Level 0", seed name `level-0`, served only
  while `current_progress === 0`) AUTO-LAUNCHES straight into the fight** — no welcome screen, no "Take off",
  no menu gate: the ship is controllable immediately (flying the default player ship). The client arms the
  **intro director** from `CATALOG.level.intro` and publishes `G.skipIntro` (the Settings Skip row), sets
  `G.gameStarted = true`, then calls **`beginLiveSession()` before `reset()`** — so the intro is
  session-recorded like every other campaign level and the seed is installed before `reset()` draws the
  spawn RNG. See *The scripted intro (Level 0)*. Once the intro is cleared, the normal landing resumes: (2) if the
  level has a **briefing** (level 2+, i.e. "Level 2"–"Level 4"), the client lands on the **Main Window**
  showing that briefing (so a returning player sees *their* mission); (3) otherwise ("Level 1" / id 2, no
  briefing) it shows the **welcome screen** — a start overlay that greets the player ("Welcome, Sentinel"),
  frames the threat as a pirate raid, and offers **Take off**. Its layout is a **fixed grid** (`grid-template-rows:
  1fr auto`): a scrollable greeting/intro cell (`#welcome-scroll`) over a pinned footer (`#welcome-footer`,
  Take off + community link), so the Take off button is always on-screen regardless of content height (the
  scroll cell top-aligns + scrolls via auto margins on short viewports, avoiding the flex-center clip trap).
  Either way the scene backdrop renders behind it and the level only starts on take-off.
  - **Staged L1 welcome reveal** (`docs/plans/2026-07-05-1641-briefing-staged-reveal.md`): on the L1
    landing the greeting `h1` shows immediately, then the `.intro` briefing **types out over ~5 s at 26px**
    (matching the L2/L3 mission-briefing size; 16px on the `≤760px` mobile override), then the **Take off**
    button fades in **+0.5 s** later (no ship picker). **Tap the intro to skip** to the full text +
    Take off revealed at once. Hidden steps use `visibility:hidden` (not `display`) so nothing reflows.
    Plays **once per landing**; a language switch mid-type settles to full. The shared typewriter lives in
    `client/src/typewriter.js`; the community/feedback link is not staged.
- **Main Window (the between-battles / landing screen; was the "Hangar")** — `#mainwin`, a **fixed
  landscape layout** (CSS grid, not a scrolling column), built for mobile landscape but unified for desktop
  (`docs/plans/main-window-redesign.md`). **Top bar** (fixed elements above the grid): the **settings gear**
  (top-left), the **auth block** next to it (top-aligned with the gear; shows the player's **nickname** if
  set, else "Guest", + a Login/Signup button until they have a real account), the enlarged **Vega
  Sentinels** wordmark centered (`#gametitle`, scaled up on `body.menu`; the old on-screen "Hangar" title is
  gone), and the **top-right pair** (`#mw-topright`): the player's **credit balance** (`#mw-credits`,
  `<n> cr.` in credit-gold `#ffd27a`; the unit is the i18n key `ui.mainwin.credits_unit`, RU `кр.`) next to
  an **inactive "Ships"** label (`#mw-ships`, muted, reserved for future ship-buying). The balance is
  pushed by `updateMenuCredits(balance = G.balance)` (`hud.js`) from `showMain` + `showWelcome` and, with
  the server's authoritative `credits`, from `renderBay` after every buy/sell. Below 780px the pair stacks
  into a right-aligned column so it clears the wordmark (which scales with 4.5vw) on phone landscape.
  **Below**: a grid — **left menu** (`#mw-menu`: **Character / Missions / Loadout / Map / Craft** —
  five sections, all always shown; docs/plans/2026-08-08-base-menu-redesign.md) | **work zone**
  (`#mw-work`) | a **per-view right column** (`#mw-ship-col`): the **mission list** on Missions
  (`#mainwin.missions-open`, **25%**), the **Loadout context panel** on Loadout (`#mainwin.bay-open`,
  **30%**), and **nothing** on Character / Map / Craft — there the column is `display: none` and the grid
  drops to **two columns** so the work zone takes the freed width. (There is **no ship preview**: the
  spinning right-column ship model was removed — the ship is inspectable full-size in Loadout.
  docs/plans/2026-08-09-1534-missions-list-right-column.md, DECISIONS §97.)
  **"Take off" is available on EVERY stage** — a global launch bar (`#mw-launch` / `#mw-takeoff`) pinned
  under the work zone on Character/Missions/Loadout/Craft, which flies into the star system for free flight
  (`enterRoam(null)`). On **Map** it steps aside (`#mainwin.map-open`) because the navigation component
  carries its own Take off next to "Autopilot to destination". On the **campaign it is the ONLY launch
  control** — the mission button (`#mw-go`) is **hidden whenever the campaign is the active mission**
  (DECISIONS §104), because launching the campaign and taking off became the same act once every campaign
  level started by flying to its zone. `#mw-go` appears **only for an active SIDE mission** (label
  **"Launch mission: <name>"**), which really is different: it drops straight into that mission's level.
  The briefing also offers **"Autopilot to destination"** (`#mw-mission-nav`, shown only
  for a mission that HAS a system object) to fly there and be asked "Start mission?" on arrival. All of them
  share ONE gate: `updateTakeoffGate` (shop.js) reads the server's `launchable` flag and disables the fight
  launch, Take off and Autopilot together — with the reason — when a required slot (hull/armor, engine,
  thruster) is empty. DECISIONS §100.
  Left column = `minmax(160px, 18%)`, widened
  to `minmax(240px, 18%)` on **non-phone forms** (`body:not(.dev-phone)`) so it fully contains the
  fixed-position `#account-bar` floating over it — otherwise a long localized (RU) "guest / log in" string
  spilled past a narrow 18% column into the work zone and clipped the mission title's first letters (the bar
  is also `max-width: 200px`, wrapping rather than overflowing). The **Missions** item shows the
  **mission list in the right column** (`#mw-mission-board`, `renderMissionsBoard`) — the **campaign**
  ("Main operation") card plus, once the side-mission board unlocks (after "Level 3" — DECISIONS §91), the
  **three side-mission** cards — each with **Take / Defer / Set active** buttons + a status badge (the old
  left mission sublist + caret are gone). A card shows **at most ONE badge**, in the precedence
  **Cleared > Active > Taken**: **Cleared** (green `.mc-badge.cleared`, `ui.mission.cleared`) means the
  mission has been **won at least once** (permanent, from `cleared` on `GET /api/players/:id/missions` →
  `clearedIds` in `mainwindow.js`) and is first because cleared-ness has no other tell on the card, whereas
  Active also tints the whole card gold and Taken also shows **Defer**. The **Missions menu item carries a count badge**
  (`#mw-missions-badge`, `updateMissionsBadge` in `mainwindow.js`, refreshed from every `renderMissionsBoard`)
  — the number of **side missions on offer** (`missionOffers.length`, currently a fixed 3; taking one does
  **not** decrement it, and the ever-present campaign card isn't counted), hidden at zero (i.e. before the
  board unlocks). It reuses the **same `.mw-badge` gold pill** as the free-skill-points badge on Character.
  The **Loadout menu item carries a gold "(new)" marker** (`#mw-loadout-new`, `.mw-new`, `updateLoadoutNew`
  in `mainwindow.js`, string `ui.mainwin.new`) — plain inline text in the same gold `#ffcf5a` as those
  pills, **no count**. It appears when a **gated shop row has just become buyable** (the "Level 3" tier:
  Heavy hull / Heavy Machine Gun / Triple spiral rocket; the research tier: Ion engine / Nanobot repair).
  The **same "(new)" (reusing
  `.mw-new`) also rides the Shop button inside the Loadout panel** (`shop.js` `renderPanel` → `.lp-foot`
  `data-act="open-shop"`), so the marker leads the player from the menu, through Loadout, to the shelf —
  **and the trail continues onto the shelf itself** (see the gold tab/row below).
  Both **clear only when the player OPENS THE SHOP** — the `open-shop` action calls `markShopItemsSeen()`
  and fires a `shop-items-seen` DOM event that `updateLoadoutNew` listens for (merely entering Loadout no
  longer clears it). Recomputed on every landing (after `openBay()` resolves, since the gate names arrive
  with the shop state), on every menu switch, and on the shop-items-seen event.
  Each card is **stacked for the narrow column**:
  line 1 = title (wrapping) with the badge right-aligned beside it, line 2 = the reward/XP sub-line,
  line 3 = the action buttons right-aligned (an empty action row collapses). The list is **its own
  scroller** (`overflow-y: auto`, full column height, no header). The **center work zone holds only the
  mission body** — title, description (with the granted-item showcase), reward, **Take off** + note.
  Clicking a card renders its briefing there (**only the description scrolls**, `#mw-mission-desc`).
  **Take-off flies the ACTIVE mission** (`activeMissionId`; the campaign when none is active), and its title shows on the button
  (`ui.button.take_off_mission`). Take/Defer/Set-active POST to the server (`missionAction`) and re-render
  from the fresh `{ taken, activeMissionId }`. **Loadout** opens the **redesigned Loadout screen** in the work zone
  (`#mw-view-bay`, Slice C): the player **ship is centered** (`#loadout-ship`, a 3D viewer from the shared
  `client/src/model-viewer.js`) with its **slot chips arranged around it** (`#loadout-slots`, positioned by
  `SLOT_LAYOUT`) — one per component slot + weapon group, empty/required flagged. Clicking a slot opens the
  **right context panel** (`#loadout-panel`): the equipped item's info + **its 3D model** + **Remove**, the
  fitting **stash replacements** (pick one → its info + model + **Install/Replace** with **Sell** to the right), and a **Shop** button pinned bottom-right that
  swaps the panel to the shop (type tabs → buyable items with price + **Buy** + Owned badge; clicking an item
  opens a **detail card** — stats on top, its **3D model** (`#shop-model`, a `model-viewer.js` viewer;
  model-less items show a placeholder), **Buy**, and **Back**; `renderSlots`/`renderPanel`/`renderShopPanel`/
  `renderShopDetail` in shop.js). The Loadout widens the right column a touch (30%, vs the Missions 25%) for the model:
  the ship+slots fill the center work zone, and the context
  **panel lives in the same right column the Missions view uses for the mission list**
  (`#loadout-panel` inside `#mw-ship-col`, **borderless — no boxed rectangle**); `#mainwin.bay-open` swaps
  that column's contents from the mission list to the **`#ship-stats` strip + the panel** — and
  `#ship-stats` is **Loadout-only** (hidden on every other view). **Before the shop unlocks**
  the screen is **read-only**
  (no Remove/Install/Shop, a hint `#mw-loadout-locked`); `openBay()` synthesizes the locked state from
  `G.activeShip` (no `/stash` fetch). (Shop polish — collapsed sections + a stats→3D-model→Buy card — is a
  planned increment 2.)
  **Character** is a real screen (see **Character progression** below); **Map / Craft** are **stub
  sections** — `selectMenu()` routes them to `#mw-view-stub`, `renderStub()` fills the title + "Coming
  soon" body from `ui.mainwin.*` / `ui.stub.*` (specs in the redesign plan). Character routes to
  `#mw-view-character`, rendered by `renderCharacter()`. JS:
  `showMain(briefing)` (was `showHangar`) shows it — **the campaign (primary) row
  always reflects the current level's briefing**: an explicit `briefing` (the server-derived one stashed on
  `/advance`) wins, else it falls back to `CATALOG.level.briefing`, so returning from a **side mission**
  (`showMain(null)`) keeps the campaign description instead of blanking to the `ui.hangar.default` standby
  line; `selectMenu(which)` switches the
  work-zone view; `renderMissionsBoard()` + `renderMissionView(m)` drive the mission board/detail;
  `launchCampaign()` (was `launchFromHangar`) and `launchMission(m)` launch + stop the Loadout viewers; `openBay()`
  (was `openHangarShop`) gates + loads the bay.
  - **Staged campaign-briefing reveal (L2/L3)** (`docs/plans/2026-07-05-1641-briefing-staged-reveal.md`):
    when the **primary (campaign) briefing** lands on **levels 1-3** (in practice L2/L3; L1 lands on the
    welcome screen), the briefing text (`#mw-mission-text`) **types out over ~5 s** while **only** the
    **launch controls** — the global Take-off bar (`#mw-launch`), plus `#mw-go` on the rare landing where a
    side mission is active — are hidden (`.briefing-hide-go`, `visibility:hidden`, so nothing reflows)
    — the **mission list in the right column stays visible throughout**; when typing completes the
    **granted-item showcase** (`#mw-item`, Machine Gun on L2 / Repair drone on L3) fades into the work zone,
    then the **launch controls +0.5 s**
    later. **Tap the briefing text (`#mw-mission-desc`) to skip** to full + reveal everything at once. The
    level is parsed from the descriptor `title` ("Level N"); it plays **once per landing** (switching to
    a bay view / launching / re-selecting the row after settles to full, no replay). **L4+ and side missions
    stay instant** (no staging). Shared typewriter: `client/src/typewriter.js`.
  - **Scroll affordance on the briefing** (`client/src/scroll-hint.js`). A briefing longer than the panel
    (routine on a phone, where the browser hides the scrollbar until you drag) used to end mid-sentence at
    the edge with nothing saying it continued. `#mw-mission-desc` now sits inside a non-scrolling host
    (`#mw-mission-scroll`, `position: relative`), and the module appends **two chevrons** to that host:
    **`.scroll-hint.up`** at the top edge while there is text above, **`.scroll-hint.down`** at the bottom
    while there is text below, **neither** when the text fits or the view is hidden. They are quote-mark
    chevrons drawn in CSS (a 13px box with two 2px borders, rotated 45°/-135°, `#cfe0ff` at .8 opacity with
    a dark drop-shadow so they read over text), `pointer-events: none`, fading in over .18 s. The host
    carries the state as `.has-more-up` / `.has-more-down`. `hintState({scrollTop,scrollHeight,clientHeight})`
    is the pure decision (2px slack so sub-pixel layout can't light a chevron pointing at nothing) and is
    unit-tested; `attachScrollHint(el, host)` is the wiring — a `scroll` listener, `window.resize`, a
    `ResizeObserver` on the panel and a `MutationObserver` on its subtree (the staged typewriter rewrites
    the text every frame), all coalesced into one read per rAF. Wired once at `mainwindow.js` import.
    Guarded by `client/visual/scenarios/45-briefing-scroll-hint.mjs` (phone viewport: down-only at the top,
    up-only at the end, neither at 1440×900) — an outcome test on the painted chevron, not on the DOM node.
  - **Desktop (PC) form polish** (`docs/plans/2026-07-01-1933-device-profiles-desktop-polish.md`,
    device-profiles iteration 1) — additive CSS scoped to `body.dev-desktop` / `body.dev-desktop-lg` only
    (phone/tablet + the `@media (max-width:760px)` mobile override are untouched): the briefing **title is 32px**
    and the **body text 26px**; the **Loadout/Stash/Shop** buttons are **fixed-height** (56px, `flex: 0 0 auto`
    — no longer stretched to fill the menu column); the **granted-item 3D icon centers directly below the mission
    text** (the bottom-right float + strut are dropped — `#mw-mission-desc` becomes a flex column, the item takes
    `order: 2`, `align-self: center`, 55% width) so **Take-off then sits under the item**; the **ship-stats strip
    uses ×2 fonts** (k 16 / v 20 / d 12px) and **fits on one line** (measured at 1440×900, scrollWidth == clientWidth
    → the borderless 2×2 grid fallback stays unused); and **Take-off follows the content** (`#mw-mission-desc`
    **and its scroll host** `flex: 0 1 auto`, still scrolling when the text is genuinely long). Mobile/touch layout is unchanged.
- **The gold "(new)" trail — state model (DECISIONS §111).** The pure logic lives in
  **`client/src/shop-markers.js`** (unit-tested by `shop-markers.test.js`); `shop.js` keeps all
  `localStorage`/DOM I/O. **Two independent marker keys, per player, plus one housekeeping key:**
  - `shopSeenNew:<playerId>` — *"the shop has been OPENED since these rows unlocked"* → the Loadout menu
    "(new)" + the Shop-button "(new)" (`hasNewShopItems` / `markShopItemsSeen`).
  - `shopItemsClicked:<playerId>` — *"this specific ROW has been clicked in the shop list"* → the gold
    type-tab + the gold row (`markShopItemClicked`, called from the `shop-item` action). One key could not
    serve both: opening the shop would mark everything seen and kill every gold frame before it rendered.
  - `shopMarkerKinds:<playerId>` — not a marker: which **gate kinds** (`GATE_KINDS = ['minLevel',
    'minMission']`) the two baselines above were taken under. On prime, any row that is gated+unlocked now
    but carries **none** of the previously-known kinds is folded into the baselines as **already seen**
    (`absorbRefs`), so a release that introduces a gate kind does not announce gear the player has been
    buying for weeks — while a genuinely pending marker for an already-known kind is left alone. This key
    is deliberately **NOT cleared by a progress reset or a marker re-arm**, and a corrupt read of it errs
    toward *swallowing* (it re-runs `absorbRefs` under `LEGACY_GATE_KINDS = ['minLevel']`) rather than
    re-arming — clearing it would silently swallow a legitimately pending `minMission` marker. That is the
    opposite of the two marker keys, on purpose.
  Both marker sets are **pruned to what is unlocked now** on every write **and on every bootstrap prime**,
  so a progress reset re-arms the markers instead of swallowing them. The prime is what makes that true for
  **both** keys: `seen` is also pruned whenever the shop is opened (`markShopItemsSeen`), but `clicked` is
  otherwise only rewritten when a row is actually clicked — so without pruning at prime, a reset player who
  reopened the shop without clicking anything would keep a stale `clicked` set and, on re-earning the tier,
  get the menu "(new)" with no gold behind it. Only **gated** rows count — anything on the shelf since the
  shop opened would make them permanent noise. **Both baselines are primed at bootstrap**
  (`primeShopItemsSeen()`, called from `main.js` right after `G.activeShip` lands; it waits for both
  `reachedLevels` and `clearedMissions` to be arrays, or it would fail closed to an empty baseline; the
  decision itself is the pure, unit-tested `primeSets()` in `shop-markers.js` — `shop.js` only does the
  storage I/O): the
  first time a device sees a player, whatever is **already unlocked counts as already seen**. A device that
  has a `seen` baseline but no `clicked` one seeds `clicked` **from `seen`**, so a pending menu marker
  always has matching gold in the shop instead of dead-ending on its first step. A player short of a gate
  baselines to the empty set, so clearing it later still lights the whole trail. **No baseline ⇒ nothing is
  new** (a corrupt/unreadable marker store re-primes rather than re-arming).
- **The gold inside the shop.** In the shop list, a **type tab** (`.lp-type.new`) is gold `#ffcf5a` instead
  of the usual blue while its section still holds an unlocked gated row the player has never clicked, and
  that **row** (`.lp-shop-item.new`) carries the same gold frame. The tab's gold is **derived**
  (`unseenSections`), not its own state: it clears when the last unseen row inside it is clicked, so
  visiting a tab without clicking the row leaves it gold (the trail keeps pointing at unfinished business),
  and a row in the section that is already active when the shop opens (the shop opens on `hull`) simply
  shows its gold with no tab click to wait for. Several sections can be gold at once — the "Level 3" tier
  spans hull + weapon, the research tier engine + repair. **Clicking the ROW** is what marks an item seen
  (not buying it, not merely opening its detail card).
- **Model viewers** (`client/src/model-viewer.js`) — a **small self-contained Three.js view** (own
  `WebGLRenderer` + scene + camera + a directional light + the same RoomEnvironment PMREM reflections as the
  combat scene) that **slowly auto-rotates** a glb. The viewer machinery is reusable helpers
  (`buildModelViewer` builds a `{renderer,scene,camera,group,raf,url}` viewer; `startViewer`/`stopViewer`/
  `resizeViewer` drive its rAF loop/size; `setViewerModel(viewer, url, cfg)` normalizes/recenters/orients
  any glb — ship **or** item). The old **right-column ship preview is gone** (DECISIONS §97); the surviving
  consumers are the **work-zone item showcase** (`mwItem`, below) and the **Loadout** viewers (the centered
  ship `#loadout-ship` + the shop/slot item model `#shop-model`, both in `shop.js`). Their loops run **only
  while the Main Window is visible** and only for the open view (`selectMenu` stops the Loadout viewers off
  Loadout; launching stops them all), so they cost nothing during a fight; `resizeViewers` keeps the
  showcase crisp on resize/rotation.
- **Work-zone item showcase** (`#mw-item`, `mwItem`) — a viewer **floated into the bottom-right
  corner of the mission text**, showing the **3D model of the gear a campaign briefing grants** (Machine Gun
  on L2, Repair drone on L3), spinning, at **full size** (`ITEM_SHOWCASE_SCALE = 1`). The canvas lives **inside `#mw-mission-desc`** alongside the text
  (`#mw-mission-text` span) and a 0-width strut (`#mw-item-strut`); both floats precede the text in source.
  **Bottom-right + wrap is the classic CSS strut-float trick:** the strut floats right with
  `height: calc(100% − var(--gun-h))` to reserve the **top** of the right column (text flows full-width past
  it), then the canvas `clear: right` drops **below** the strut into the bottom-right corner (`width: 46%`,
  `height: var(--gun-h)`) — the mission text then wraps full-width above it and down its left side. Floats
  can't anchor to the bottom by themselves, hence the strut. Revealed by `#mw-mission-desc.show-item`. The
  **mission list** is the column to the right. `showShowcaseItem(sc)` toggles `.show-item` + starts/stops the
  loop; built lazily on first use, its loop is stopped on launch and when the bay view hides the mission
  canvas. Hidden on L4 (no item) and side missions. Test hook: `window.__game.itemShowcaseTarget` (the item
  glb url, or null when hidden).
- **Community / feedback link.** A small localized link to the Telegram feedback group sits on the welcome
  screen and the game-over/victory overlay (`.community-link`). Its text and URL are i18n values
  (`ui.community.label` / `ui.community.url`, via `data-i18n` + `data-i18n-href`), so EN players get the
  English group and RU players the Russian one; a live language switch updates both. Opens in a new tab and
  fires a `community_click` funnel event on click.
- **Progression** — each player has a **`current_progress`** (their highest unlocked level; see
  Backend). On load the client fetches **that** level (`GET /api/players/:id/level`, not a hard-coded
  one); clearing a level **unlocks the next** (the `win` handler POSTs `/advance`, then loads the new
  level so the next **Restart** plays it). A new player starts on `level-0` — the **intro
  ("Level 0")**; the last level is `level-4`. Existing players were bumped `+1` once by the
  intro-shift migration (see below) so they stayed on their exact same content, just one id higher.
- **Character progression (XP · level · 5 skills)** — the **Character** base-menu screen
  (`renderCharacter()` in `mainwindow.js` → `#mw-view-character`). A player earns **experience**: each enemy
  kill adds the ship's `xp` (= its credit `reward`; both live in `catalog_seed.js` `stats` and reach the sim
  via `ship-build.js`), plus a **one-shot mission bonus on victory** (`descriptor.xpReward`: Level 1 500 ·
  Level 2 500 · Level 3 700 · Level 4 1500 · side missions 1000). The run's `G.earnedXp` is banked with the
  credits (`bankRun` POSTs `xp` to `/api/games`). **Curve** (`server/src/progression.js`): cost to reach
  level *n* = `1000 + 500·(n−1)` (cumulative 1000/2500/4500/7000/…); **level and unspent skill points are
  DERIVED from `experience`, never stored**; one point per level. The five **skills** (per invested point,
  rates in `components.js` `SKILL_RATES` → `skillEffects()`, baked into the player at `buildPlayer`):
  **Kinetic** +5% kinetic damage & +0.5° aim-assist cone · **Rocket** +5% rocket damage & +5% rocket speed ·
  **Shields** +5% shield capacity · **Maneuverability** +5% dodge chance · **Mobility** +5% engine+thruster
  power & +5% max speed. **Dodge**: on a hostile bullet connect the hit lands with probability
  `100/(100+dodge−accuracy)` (accuracy reserved for a future skill = 0); the roll uses the **seeded** sim RNG
  and is drawn **only when dodge>0** (existing recordings replay unchanged — DECISIONS §73/§93), injected
  into the pure `resolveHostileBulletHit(...)`; a dodge pops an **"EVADE"** popup and deals no damage.
  Enemies carry a `dodge` stat too (all current = 0). Skills apply **only to the real active ship** — never
  to previews or `?playback` overrides. The "+" cards POST `POST /api/players/:id/skills/spend`. Skills'
  *gameplay effects* are live; the numbers are first-pass and tunable via `SKILL_RATES`. **Always-on HUD**
  (`hud.js updateProgressionHud`, per frame): a gold **free-skill-points badge** on the Character menu item
  (when > 0; shared `.mw-badge` pill — the Missions item uses the same one for its offer count, see the
  mission board below), and a bottom-center **XP bar** (yellow, 80% wide, on base + in battle; fills toward the next
  level and previews the run's unbanked XP live). **Levelling up happens LIVE, mid-fight**: the HUD rolls the
  banked progression forward by `G.earnedXp` through the curve every frame (`client/src/progression.js`
  `liveProgress` — the curve is **mirrored** client-side because the client can't import from `server/`, and
  `client/src/progression.test.js` asserts the two copies agree; DECISIONS §103), so crossing a threshold
  during combat immediately bumps the displayed level, empties the bar toward the next one, and fires the
  centered **"Level up"** toast that fades over 2s (`showLevelUp`). The toast is deduped by `announceLevel`
  (highest level already toasted this session), so `bankRun` — which still covers a level gained while the
  bar was hidden — never repeats it back at base. `bankRun` also refreshes `xpIntoLevel`/`xpForNextLevel`
  from the banked `experience` and **zeroes `G.earnedXp`**, so the post-run active-ship refetch can't
  double-count the run's XP on top of the banked total; that refetch (in `unlockNextLevel`) also
  **`await`s the bank POST** via `bankingDone()`, so it can't read the pre-run experience and overwrite the
  banked progression with it. (Aim assist used to live here too; it is gone — DECISIONS §124.)
- **Ending a mission (all missions).** Killing the last enemy does not close the mission — it CLEARS the
  sector, which is a different thing (see the three moments below). `clearMission()` in
  `sim-core/level-runner.js` runs for **every** mission, campaign L1–4 and the three side missions alike,
  off the `win` phase in the descriptor's script (whose `delay` still runs first, so the boss explosion
  plays out). It lifts the **OOB warp-back** (`&& !G.returnToBase`, so a side mission fought far from
  `(0,0)` can fly home), shows a centred HUD hint (`updateReturnHint`, i18n `ui.return.hint`), and makes
  the **base station clickable** (`G.baseStation.active`). **There is no homing arrow** — the world-space
  blue arrow that used to point at the station is gone (it fired from the first frame after take-off, with
  no distance gate, at a station 15 u away and plainly in view); the way home is the **"Return to Base"**
  button on the roam nav bar and the **system map**.
  Flying home is one of the two ways to end it, and no longer mandatory. Clicking/tapping the station (on
  touch a **slop-gated tap** — a <10px single-finger gesture — through the shared `engageObjectAt` pick, not
  a raw touch-anywhere) calls `engageAutopilot()` (sets `G.autopilot.active` + phase `brake0` +
  `target = { kind:'station' }`), and `checkArrival()` closes the mission once the ship is within
  `BASE_ARRIVE_RADIUS` (45u, horizontal xz) of the station's actual position (measured against
  `G.baseStation.obj.position`, not a hardcoded origin). `G.autopilot` carries a typed **`target`** (the
  station **or** a loot drop — the same autopilot flies to loot chests, see Grab & loot drops); the
  dock predicate `canDock(autopilot, dist)` (pure, in `client/src/sim-core/autopilot-config.js` with
  `BASE_ARRIVE_RADIUS`, unit-tested) fires **only when the target is the station** — a chest-aimed autopilot
  is structurally incapable of ending a mission. **Proximity alone never ends one**, and any control input
  cancels the dock (clears `active` + `target`) so a cancelled/manual approach doesn't complete (re-tap to
  resume). **ONE exception, and only one:** once the player has pressed "Finish and Return"
  (`levelRunner.finishing`), arriving within `BASE_ARRIVE_RADIUS` closes the mission **with or without an
  engaged autopilot** — the reward is already banked and the salvage already swept at that point, so the trip
  home is all that is left. `canDock` still decides every other case. Pressing the button **again** after the
  flight was interrupted (firing cancels the autopilot, DECISIONS §39) **re-engages** it and returns true
  instead of refusing, without re-running the one-shot settlement. Both are the fix for a real soft-lock —
  see DECISIONS §143.
  **A mission ends in TWO moments, not one (DECISIONS §130, §132).** (1) **CLEARED** — the level's `winCondition`
  holds (`{ type: 'allEnemiesDead' }` on every campaign level and side mission today, stated on the
  descriptor). `clearMission()` in `sim-core/level-runner.js` doubles the credits, adds the one-shot
  `xpReward`, opens the way home, and emits the `cleared` event; the client's adapter banks off THAT —
  `bankRun`, `depositLoot`, the session flush, the side-mission clear flag. The reward is therefore a pure
  consequence of the fight, reachable by the browser, a server-run room and a headless referee alike — no
  mouse click involved, which is what made it unreachable for any host without one. (2) **FINISHING** — the player presses
  **"Finish and Return"**, the bottom-centre button that replaces the old "Return to base" once the sector is
  clear. `finishMission()` sweeps every crate still on the field into the run (the last enemy's drop appears
  at the instant the fight ends — no ship reaches it in time), emits `finishing`, and **engages the autopilot
  home**. The host deposits the loot and commits the campaign advance **server-side** on that event, so
  reloading the tab mid-flight loses nothing. **The two halves are ordered by a promise, not by hope:**
  `commitLevelAdvance()` publishes its in-flight POST on `advancing` and `loadAdvancedLevel()` **`await`s
  `advanceDone()`** before its `GET /level` — the same pattern as `bankingDone()` beside it. Without that the
  GET could overtake the POST and hand the tab back the level it had just cleared while the server was
  already on the next one: the player took off into the level they had finished, cleared it a second time,
  and the second clear advanced the account AGAIN — a skipped level plus its reward drop. It is easiest to
  hit on the intro (the home station is ~43 u from the arena centre against a 45 u arrival radius, so the
  dock can land on the tick the button is pressed) but the race was there for every level. The stored promise
  never rejects, so a failed advance still lets the read through — "on failure the same level replays". It refuses unless the sector is really cleared, so a stray tap
  cannot end a live fight. (3) **WON** — the ship arrives. `checkArrival` → `winLevel()`: overlay, sting,
  hangar, releasing a netsim room, and only now `loadAdvancedLevel()` — the descriptor, the map and the
  rebuilt ship, which need everything standing still (`buildPlayerFor` makes a fresh player at the spawn
  point, so mid-flight it would teleport the ship out from under its own autopilot). Flying home WITHOUT
  pressing settles and closes in one go; for that route `canDock` still requires an ENGAGED station
  autopilot, so proximity alone finishes nothing. **After** the button has been pressed the requirement is
  distance alone (§143), which is what lets a player who fired on the way home still get in. In a room the press travels as `{kind:'finish'}` and the room flies the ship home
  itself; the salvage swept at the press gets its own money-free economy report. An unreadable `winCondition` can never be met — no payout on a
  rule we cannot evaluate.
  A **bottom-center "Return to base" pill button** (`#return-btn`, i18n `ui.return.button`, shown/hidden in
  `updateReturnHint`) is also drawn as an **explicit, always-on-screen tap target** — same effect as clicking
  the station (`engageAutopilot()`) — since the station model is small and often off-screen. It's visible only
  while return-to-base is available and the ship is still under player control (the same predicate as
  `stationClickable()` **and** `!G.autopilot.active`), so it **hides the moment the autopilot engages** and
  reappears if the player cancels the dock mid-flight. Wired **split per DECISIONS §42**: on touch it fires on
  `touchstart` (a second-thumb tap works while a steering finger holds `#stick-zone`), and the `click` path is
  **mouse-only**; the button sits `z-index:6` above the full-screen `#stick-zone`, is hidden on menus
  (`body.menu #return-btn`), and its label localizes via `data-i18n`/`applyTranslations` (EN + RU). It is
  **styled to match the Take-off button** (orange gradient `#ffb35a→#ff7a3c`, dark text) so it reads as the
  primary "go" action, and on **touch** the zoom `＋/−` pair lives top-right (not bottom-center) so the two
  never overlap.
- **Roam navigation HUD — a gold mission pointer + two nav buttons.** While roaming (`G.roam`), a **gold
  off-screen edge arrow** points toward the active mission (`updateMissionMarker` in `hud.js`, class
  `marker mission-marker`, its own single pooled div; same off-screen-only edge-clamp math as the loot/enemy
  arrows, hidden when the mission projects on-screen), and a **bottom-center two-button bar** (`#roam-nav`,
  `updateRoamNav` in `sim.js`) carries **"Return to Base"** (`#roam-return`, `ui.roam.return`, orange —
  engages the dock autopilot, `engageAutopilot`) and **"Autopilot to Mission"** (`#roam-autopilot`,
  `ui.roam.autopilot`, gold to match the pointer — engages `engagePointAutopilot(pos, missionId)` toward the
  mission). **Each button is its own cancel** (switch/cancel): clicking the destination you are already
  flying to drops the autopilot back to manual (`cancelAutopilot`), clicking the other re-routes in place, and
  the live one carries an `.engaged` outline. The **mission target is snapshotted at `enterRoam`** into
  `G.roamMission = { pos, missionId }` via `objectForActiveMission` (side mission → its host object; campaign
  → the object nearest its fight centre; mission hosts are fixed anchors so a snapshot never goes stale); when
  it is **null** (no active mission target) both the gold pointer and the "Autopilot to Mission" button hide,
  leaving just "Return to Base". Same touch/click wiring split as `#return-btn` (DECISIONS §42), hidden on
  menus, EN + RU. The bar sits in the same bottom-center slot as `#return-btn`, which is safe because
  roam (`G.roam`) and return-to-base (`G.returnToBase`) are never both true. Covered by `32-star-system`.
- **Star system / navigation (roam).** Out of combat the game world is a **to-scale, flyable star system**
  you cross with an autopilot driven by a **system-map screen** (docs/plans/2026-08-09-1456-star-system-map.md).
  - **Roam (`G.roam`)** is the interactive out-of-combat flight state: world up, player controllable, **no
    `levelRunner`, no enemies**. Entered ONLY via `enterRoam(dest)` (base-menu Map) or the `?roam` dev flag —
    the campaign/mission launch paths never set it. In roam `reset()` skips the level start (calls
    `levelRunner.resetLevelRunnerState()` with `level = null` → no spawns; clears a prior win's `won` so the
    ship isn't frozen) and the ghost battle; the player spawns at planet 2 (origin). **Roam is unrecorded**
    (`beginLiveSession` is not called).
  - **Uncapped AUTOPILOT travel (`capLifted`, pure/tested — DECISIONS §101).** The player speed cap
    (`PLAYER_MAX_SPEED` 30) is lifted for exactly two legs: **roam + autopilot** (cruising to a system
    destination) and **docking** (the return-to-base autopilot, in OR out of roam — so end-of-mission
    "Return to base" and clicking the station while roaming both fly home fast). Everything else clamps:
    all **manual** flight, and a **drop-grab** autopilot during a fight. The invariant is *"never lift the
    cap for INPUT-DRIVEN flight"* — a replay reproduces the recorded input stream, and an autopilot leg is
    not part of it (`?playback&finish` freezes the trace index and zeroes input while the dock autopilot
    flies home), which is why the dock leg can be uncapped with `22-trace-replay` byte-identical. The
    autopilot **brakes once inside `ARRIVE_RADIUS`** instead of chasing its goal (without that, a fast
    arrival overshoots into a ~10 u/s orbit and an arrival prompt never fires); drops are excluded. The
    OOB warn/warp-back is disabled in roam. (`ZONE_RADIUS` / `inActivityZone` / `activityZoneCenters` remain
    as pure helpers for the `?roam` readout and future zone rules; the speed cap no longer consults them.)
  - **Clicking the home station.** Out of combat the station is a click target — after the last kill
    (return-to-base → docking WINS the mission) **and while roaming**, where it engages the same dock
    autopilot but wins nothing (`levelRunner.returningToBase` is false, so `canDock`/`win` never run):
    arriving parks the ship and raises a **"Dock at the station?"** confirm (`G.onBaseArrival`) that ends the
    flight back in the base menu — the flown counterpart of the map overlay's teleporting "Return to hangar".
  - **Navigation UI — ONE component, three hosts (`systemmap-ui.js` `mountSystemNav`, DECISIONS §100).**
    The base-menu **Map** section, the in-flight **overlay** and **mission activation** all run the same
    component over the same object list. Layout: the **map canvas is pinned LEFT** (in the base menu, right
    beside the nav menu) and the **object list is the panel on the RIGHT** — **the same side-by-side shape on
    a phone** (`body.dev-phone`: map filling the central area down to the bottom edge, list a ~38%/260px
    column on the right with its Take off / Autopilot buttons **stacked full-width** under it). On a phone in
    the **base menu only**, that button column reserves 52px on the right for the floating **⛶ fullscreen
    button** (fixed bottom-right, z-60), which would otherwise draw over the bottom button and eat its taps;
    the in-flight overlay is z-9000 and covers the ⛶ instead, so it needs no reservation. Pinned by
    `34-phone-map-layout` (both hosts: side-by-side, map ≥90% of the height, bottom button hit-tested).
    - **Objects (`listSystemObjects()`, 12).** The **star and all four planets are first-class, selectable
      destinations**, listed and marked exactly like the **home station**, the **research station**, the
      **three belt outposts** (`ANCHORS.mining` at `(-988,0)` / `mining2` at `(-1480,-1180)` / `mining3` at
      `(-900,2800)` — the latter two host no SIDE mission, but `mining3` is the system's **far** outpost
      (~2941 u) and is where the campaign's **"Level 4"** fights: that level's `center` is that exact (x,z).
      Each has a matching `asteroid-field` set-piece in `catalog_seed.js` at the same (x,z))
      and the **Space Factory** (`ANCHORS.factory` at `(-350,-350)`, `kind: 'factory'` — navigation-only,
      no mission, with a matching `space-factory` set-piece at the same (x,z)). The factory is the system's
      one **short hop**: ~495 u out, about two screens diagonally at zoom 1, just past the base activity
      zone (`ZONE_RADIUS` 360) against the ~1000 u belt/science crossings.
      Finally the **freighter in distress** (`ANCHORS.freighter` at `(-100,-950)`, `kind: 'freighter'`) —
      host of the `side-freighter` mission, ~955 u belt-ward and "north" of the home planet. It is the one
      anchor whose set-piece is deliberately **not** at the anchor: the `freighter` set-piece renders +50 z
      ahead at `(-100,-900)` so it sits in front of the player's forward-gliding spawn.
      A test pins that **every anchor with a physical set-piece matches the seed `pos` exactly**
      (`system-map.test.js` importing `MAPS`, freighter carrying that +50 z framing offset) — moving one
      without the other flies autopilot into empty space. A second test pins that **exactly the three side
      missions carry a host object** and each resolves back to it: a mission with no host can be taken from
      the board and then has no marker, no autopilot target and no zone to fly into.
      Each object carries `pos` (where autopilot flies — a body's own **anchor** on the plane, never the
      permanently distant body itself), `marker` (the same point, so list and map can't disagree),
      `missionId` and an i18n **`nameKey`** — names are localized (`ui.object.*`, EN+RU; the star is
      **Vega**, planets **Vega I–IV**), never raw ids. Map markers are filled dots sized by kind — the
      **star 14px**, **planets 10px**, everything else (stations, outposts, factory) **4px** — so the
      celestial bodies read as bodies against the man-made anchors; the selection ring, lock ring and
      name label all offset from that radius.
    - **"Your mission is here" — a dashed gold frame** (DECISIONS §105). Exactly one object is marked: the
      one hosting the **active** mission. An active **side** mission is matched by `missionId`; with the
      **campaign** active the object is **derived** — the nearest object to the level's `runCenter` within
      `MISSION_ZONE_RADIUS` (200 u), i.e. the same radius that starts the fight when you fly in
      (`objectForActiveMission` in `system-map.js`, pure + unit-tested). So "Level 3" marks the
      **Space Factory** (131 u from its centre), "Level 4" marks the **far belt outpost** (0 u — its centre
      *is* that anchor), and a level naming no centre fights at the origin and marks the **home planet**.
      The row gets a **dashed** gold border and the map marker a **dashed** gold ring *outside* the solid
      selection ring, so a selected mission object shows both. Both hosts pass `activeMissionId` in.
    - **Selection.** Tap a list row **or** its map marker → both highlight; picking a row re-centres the map
      on it. Objects hosting a not-yet-offered mission are **greyed with a lock hint** and can't be flown to.
    - **Pan + zoom.** Wheel and pinch zoom (anchored on the cursor/midpoint), drag and one-finger-drag pan,
      ± buttons. The transform is the pure, unit-tested **`map-view.js`** seam (`toScreen`/`toWorld`/
      `panByScreen`/`zoomAtScreen`/`pickAt`): zoom is clamped to `ZOOM_MIN..ZOOM_MAX` and the view centre to
      the system disc, so the map can never be panned into empty space or zoomed to a degenerate scale.
    - **"Autopilot to destination"** flies to the selection — `enterRoam({pos, missionId})` from the base,
      `engagePointAutopilot(...)` when already flying (re-routes **in place**, no re-entry into roam).
    The overlay is opened by the out-of-combat **Map** button (`#map-btn`, click + `touchstart`; it sits at
    **z-6**, above the full-screen `#stick-zone` inside `#touch` at z-5 — at an equal z-index the later
    element won the hit test and the button was dead to every tap on a phone) or a **tap on the mini-map**
    (during a live fight the mini-map stays the battle radar) and **freezes the game via a raw loop-skip on `G.mapOpen`**
    (NOT `setPaused`, which would stack the Paused UI); it also carries **"Return to hangar"** and Close.
  - **Mission-arrival prompt.** Autopiloting to a mission marker parks the ship on arrival and — only when the
    matching **offer exists** (`missionOffers`, side missions unlocked at L≥4) — shows a **"Start mission?"**
    confirm (EN+RU, `ui.systemmap.*`). **Yes** clears roam and launches the fight via `launchMission` (the
    existing path); **No** parks. Locked/greyed markers are not selectable as a mission and never prompt.
- **Victory → Main Window → next level.** On a win the result overlay shows a **Continue** button (a loss
  shows **Restart**/retry); Continue opens the **Main Window** (see above) — the between-battles screen (also
  the landing/homepage). The campaign briefing shows as the **primary mission** in the work zone with a
  **Take off** button that launches the level. The same Main Window is used on page load and after a win
  (and `launchCampaign` starts the loop the first time). **Once the shop is unlocked** (cleared the final
  level), the **death overlay** also offers a secondary **Back to Hangar** button beside Restart (banked
  credits already applied) → returns to the Main Window to shop / change loadout instead of an instant
  retry; before unlock only Restart shows. (The button keeps its i18n key `ui.gameover.back_to_hangar`.)
- **Between-level briefings** — a level descriptor can carry an optional **`briefing`** (`{ textKey,
  text, actions[] }`). When the player advances **into** a level, the server runs that briefing's
  `actions` (server-authoritative, once — progress only moves forward) and returns the message; the
  client shows it on the **Hangar screen** between the victory overlay and the next run (or a default
  "standby" line when there's none). Actions are a typed, extensible list dispatched server-side; the one
  types today are **`replaceWeapon` `{from, to}`** (swaps a mounted weapon id on the active `player_ships`
  loadout), **`installComponent` `{slot, component}`** (sets a component slot, e.g. `repair`, on the
  active ship), and **`unlockShop`** (flips `shop_unlocked` → opens the hangar shop; the side-mission board
  unlocks separately, by a progress gate — DECISIONS §91).
  `level-2`'s briefing narrates the weapons-factory mission, swaps the basic gun (1) for the **Machine
  Gun** (5), **and now also opens the hangar shop** (`unlockShop`) — the shop unlocks right
  after the first flight, on reaching player-facing "Level 2"; `level-3`'s briefing narrates fitting the
  **repair drone** and installs it (`installComponent` `repair` → 12); `level-4`'s briefing is now
  **text-only** — it directs the player to the pirate base and reminds them to rearm (the shop was already
  opened back at "Level 2"). After advancing, the client reloads the active ship and rebuilds
  the player so the new loadout/components take effect. (Future action types: add credits, add to a
  stash, etc.)
  - **Briefing item showcase.** When a briefing **grants gear**, a **dedicated work-zone viewer** (`#mw-item`,
    a canvas floated into the **bottom-right corner of the mission text** with the text wrapping around it —
    the mission list is the column to the right; the bottom-float strut height is `calc(100% − var(--gun-h) − 8px)`,
    subtracting the gun's 8px vertical margin so the floated stack is exactly 100% tall and the description
    doesn't grow a phantom scrollbar) shows that item spinning at **full size** (Machine Gun on L2,
    Repair drone on L3) — the
    eye-catching item pulls the player into the text. The server attaches a
    **`showcase {kind,id}`** to the briefing response, derived from its grant actions
    (`replaceWeapon`→`{weapon,to}`, `installComponent`→`{component}`; an explicit `briefing.showcase`
    overrides). The client resolves the id in its catalog (which carries the item model URLs) and renders it
    via `showShowcaseItem`/`setViewerModel`; on the **page-reload landing** path it gets the raw descriptor (no
    server `showcase`) so it derives the same `{kind,id}` from the briefing `actions` client-side. No grantable
    item (L2's `unlockShop` never showcases, and L4 is text-only) or a side mission → the work-zone viewer hides. See
    `docs/plans/briefing-item-showcase.md` + DECISIONS §29.
- **Level flow** — driven by a DB **level descriptor** (a phase/wave script) played by the client's
  `levelRunner`. Each descriptor also carries a server-computed **`enemyTotal`** — the exact number of
  enemies destroyed to complete it — derived from the phase script by `enemyTotalFromPhases`
  (`server/src/enemy_total.js`), stamped in `catalog_seed.js` (campaign) and `missions.js` (side missions);
  it drives the HUD killed/total counter. **Five levels are seeded** (an intro + four campaign levels,
  played in order via the player's progress). Level order is `levels.id`, which since the 0-based
  renumbering (DECISIONS §102) IS the campaign number and matches both the row `name` and the displayed
  `title` — id 3 is `level-3` is "Level 3":
  - **`level-0` (id 0) — "Level 0", the intro ambush:** the gentle FIRST level for new players, and it is
    **played, not watched**. **3 basic pirates one at a time** (`maxConcurrent 1`, kill one → the next warps
    in) → a single **rocket pirate** finale → **Victory!** No boss, no reward, no briefing (enemyTotal **4**).
    On first launch it auto-launches straight into the fight (see the Landing screen), with the scripted
    director talking over it and Skip in the Settings gear. Three fields make it the intro:
    **`spawn.earliest: [3, 9.4]`** on `wave-1` — a FLOOR (in seconds of `world.combatElapsed`) on the first
    two spawns, on top of the ordinary 2–4 s stagger, so pirate #1 waits for the opening line and #2 waits
    for the controls card to have flown away; **`intro`** — the director script (see *The scripted intro*);
    **`finalStageBanner: false`** — no "FINAL STAGE" banner, because that instant is when line `l3` speaks.
    `introTrace` also lives here, but it is now purely the **canonical trace three determinism guards
    re-simulate** (`sim-replay.test.js`, `seal/verify-run.test.js`, `22-trace-replay`) — the client never
    fetches it. **Changing level-0's pacing invalidates it and it must be re-recorded.**
  - **`level-1` — "Level 1" (beginner):** fighters only (3 at a time) → after **6 kills** rocketeers
    join at 25% → at **12 kills** two last rocketeers appear, clear the field → **Victory!** No boss
    (enemyTotal **14**). Carries the Machine-Gun `lastKillDrop`.
  - **`level-2` — "Level 2" (medium):** fighters only until 5 kills → fighters + rocketeers 75/25
    until 12 kills → spawning stops → a single **medium** appears alone as the boss → clear → Victory.
    Spawning phases cap at **3 at a time** (`maxConcurrent`). MG-replace briefing (which **also opens the
    hangar shop** — `unlockShop`; side missions unlock later, by progress) + repair-drone drop.
  - **`level-3` — "Level 3" (full fight):** waves of all three enemy types → after 16 kills spawning
    stops → the **Sector boss** spawns alone → on its death the game runs ~5 s (watch it explode) → Victory.
    Spawning phases cap at **3 at a time** (`maxConcurrent`). Drone-install + factory-assault briefing.
    **One of the two levels that do not fight at (0,0)**: it carries a `center` of `(-450,-435)`, 30 u
    up-left of the Space Factory set-piece, so Take off launches you from the base and the fight starts when
    you fly into the zone (see the star-system navigation section).
  - **`level-4` — "Level 4" ("Find the pirate base"):** clearly harder — **pirate gunners + rocketeers
    + advanced medium pirates** (40/40/20 → 35/35/30, maxConcurrent 5) to 8 then 16 kills → clear-out → the
    **Second Boss** (two Advanced pirate cannons + three rockets) → Victory. Its briefing has **no grant
    actions**, but now **announces the side-mission board** — which unlocks here once `current_progress` has
    reached the `level-4` row (matched by NAME, not by id — DECISIONS §91/§95; the hangar shop was already
    opened back at "Level 2" — see
    Between-level briefings); its victory sets up the planned L5 ("Storm the pirate base"). Currently the final level.
    **The second level that does not fight at (0,0)**: it carries a `center` of `(-900,2800)` — exactly the
    far belt outpost (`ANCHORS.mining3` + its `asteroid-field` set-piece), so you follow the fleeing pirates'
    trail out to the system's most distant outpost (~2941 u from the base, its longest run) and the fight
    starts when you fly in. Take off launches you at the base, not into the fight.
    (Balance: `docs/plans/level-4-difficulty.md`.)
  The AI keeps its distance and fires its weapon groups by range/aim. Spawn composition (ships +
  `chance` weights + max concurrent) is per-phase in the level; a `win` phase's `delay` defers the
  outcome so the last/boss explosion plays out — but the `win` phase no longer wins outright: it now opens the
  **return-to-base** gate (fly home to the station to complete the mission — see Level flow / Victory).
  Enemies spawn **one at a time on a randomized 2–4 s cooldown** (`stepSpawnGate`/`nextSpawnDelay` in
  `client/src/sim-core/spawn-timing.js`, driven by `levelRunner`): the **first** enemy of each phase appears
  immediately, then each spawn arms a fresh 2–4 s delay, so a phase fills 1→2→3… toward `maxConcurrent`
  rather than snapping to it — and a killed enemy's replacement also waits 2–4 s (never an instant refill).
  The `maxConcurrent` numbers above are the **cap**, not the fill rate. **Spawn counts are deterministic:**
  every spawning phase carries an explicit `spawn.total` cap — a threshold (`kills`/`killsSincePhase`)
  phase's `total` equals its kill-delta so it leaves **0** enemies alive when it advances, and the
  clear-out/finale (`allCleared`) phases are real spawning waves (drawn from that level's wave-2 pool) that
  carry the remainder. So `enemyTotal` is the exact **sum of every phase's `spawn.total`**, the killed/total
  counter reaches N/N, and the last-kill reward drop (`isLastKillDrop` in `client/src/sim-core/level-sim.js`) fires on
  the true final kill. Per-level totals: L1 **14**, L2 **17**, L3 **21**, L4 **22**, side missions **20**.
- **Rockets can be shot down by the machine gun:** a bullet subtracts its damage from an opposite-side
  rocket's HP (shot down at 0) — you can deflect enemy rockets, and an enemy can shoot down yours.
- Player health is 100; the HUD (top-left, beside the settings gear) shows a **shield bar directly above a
  now-red health bar** (same 220px width, touching — the standalone "Health" label was dropped since the
  colour-coded stacked bars are self-descriptive). The shield bar is **blue** while active (width = remaining
  `_shieldValue / capacity`) and turns **purple** while broken, its width **growing over the recharge time**
  (`_shieldRechargeAccum / rechargeSec`) until it refills and goes blue again; it's **hidden** on a ship with
  no shield component (the health bar then reverts to fully rounded corners). Health still shows its
  remaining percentage with one decimal (e.g. "87.5%") below the bars.
- **Economy (credits)** — the currency is **credits**. Every enemy carries a `reward` (`stats.reward`:
  fighter 25, rocketeer 50, medium 125, first boss 250); destroying one adds it to the run's **Earned**
  total. Completing a level **doubles** Earned (`win` applies `earned ×= 2`). The separate **kill count**
  drives level thresholds. At the **end of each run — death OR victory — Earned is banked** into the
  player's persistent **Credits** balance (server-authoritative; closing the browser mid-run loses the
  unbanked amount). New players start at **1000 credits**. HUD (top-right) shows one credits line —
  `credits {total}/{earned} earned` (total persistent balance / Earned this run; `ui.hud.credits_line`,
  EN+RU), where the **Earned** number is rendered **green** (`.hud-earned`, `#77ee77`, matching the
  "+xx" kill popups) so live mission gain stands out — plus **Destroyed**. The live **Enemies** (alive) counter has been **removed**.
  **Destroyed** reads **killed / total** (e.g. `8/16`): *total* is the number of enemies destroyed to clear
  the whole level/mission, precomputed on the server from the descriptor's phase script and embedded as
  `descriptor.enemyTotal` (the client reads it in `levelRunner.start`; falls back to the bare kill count when
  the total is unknown, e.g. a level row not yet reseeded).
  Banking posts `{ credits, kills, durationMs }` to `POST /api/games`, which returns the new balance.
- **Shop & stash (the "spend" side)** — once the player **clears the first mission** (shop unlocks early,
  §90), the Main Window's **Loadout** section is the hub: the ship centered with its **slot chips around it**,
  a **right context panel** for the selected slot (equipped info + Remove, stash replacements → Install), and
  a **Shop** button (Slice C — see the Main Window section above). The **stash** (owned-but-not-equipped
  inventory, a qty model) surfaces **per-slot** as the fitting replacements. The **Shop panel** lists items
  by **type** (**Hull / Engine / Thrusters / Repair / Shield / Weapon / Grab**). The Shop lists only
  **buyable** items (`price > 0` **and** `stats.buyable !== false` **and** every gate the row carries is
  open — `stats.minLevel` in `activeShip.reachedLevels`, `stats.minMission` in `activeShip.clearedMissions`
  — one predicate, `buyableNow()` in `shop.js`); **enemy parts are priced
  (resale value) but flagged `buyable:false` → hidden**, while
  the player's **starter gear is cheap-but-buyable** (Basic hull 300 / engine 500 / thrusters 400 / repair
  drone 500 / homing rocket 600) so each type's ladder starts low. The **Grab** tab sells the **Advanced grab**
  (2000); the base grab the player already owns. Each item's **full characteristics show
  on hover (desktop) or the (i) tap (mobile)** — for weapons: damage, RoF/reload, projectile speed, range,
  blast, weight. A shop item the player **already owns shows an "(owned ×N)" badge** (N = total equipped on
  the active ship **+** in the stash). **Price shown per screen:** the **Shop** shows the **full buy price**;
  **Stash + Loadout** show the **resale value** (`floor(price*0.75)` — the amount the player actually gets on
  sale, computed client-side via `sellLabel`/`SELL_RATE` to mirror the server), so the player reads "what I'd
  get" right on the card. **Card layout:** Loadout/Stash item cards stay on a **single row** everywhere (incl.
  phones); only the **Shop** stacks into two rows on touch (its long name + price + Buy don't share a phone
  line). Flows, all
  **server-authoritative + transactional**: **buy** (credits down → item into stash), **sell** (stash item
  or an *optional* equipped item → 75% of price back), **install/equip** (stash → ship; the displaced item
  returns to the stash), **unequip** (ship → stash). **Selling a stash item goes through a confirm dialog**
  (`#sell-overlay`, `shop.js` `openSellConfirm`) that shows the resale total and — when the stash holds more
  than one — a **slider + number field** to pick how many to sell (clamped to owned, live total); `/sell`
  takes an optional `qty` and `sellItem` sells `min(qty, owned)` atomically. Equipped-item sells stay a
  single unit (no dialog). A **live ship-stats panel** (`#ship-stats`, at the top of the right column —
  **shown only on the Loadout screen**) shows **HP / acceleration /
  maneuverability / weight** with a **▲/▼ delta vs the previous config** on every change (derived client-side;
  the server stays authoritative on the saved config). **Required slots** (hull/engine/thruster) can't be
  sold while equipped and **block take-off when empty** (the button greys out); **optional** equipped items
  (weapons, repair drone, grab) sell directly from the bay. **Looted enemy gear** deposited via `depositLoot`
  (the victory loot deposit) is equippable-from-stash like any part (engines/thrusters/weapons/grab) — hulls
  can't drop, so a looted-hull exploit never arises. On unlock the **basic gun (id 1)** swapped out after
  level 2 is **backfilled into the stash**. **Prices:** the player ladder has draft prices (strawman, see
  `docs/plans/economy-shop-v2.md`) anchored to the **corrected ~5800-credit first-shop budget** (the budget
  includes the ×2 victory bonus per level; a flawless run banks ~4280, retries push it toward ~5800 — so the
  Heavy hull at 6000 is the aspirational big buy — and since it is now **gated behind "Level 3"**, that
  budget is what the player has *by the time it goes on sale*); sell = `floor(price*0.75)`, server-computed.
  The shop lists only `price > 0` **and** `buyable !== false` **and** gate-satisfied items, so the curated
  ladder shows and enemy parts (now priced for resale but `buyable:false`) don't. The **ship-with-slots-around-it** layout + the shop's
  **stats→3D-model→Buy detail card** are built (Slice C increments 1–2); collapsed-sections-per-type (vs the
  current tab row) is a later refinement.
- **Side missions — on the Main Window's Missions board** (`docs/plans/mission-generator.md` +
  `2026-08-08-base-menu-redesign.md`). Unlocked **after clearing "Level 3"** — a progress gate that fires
  once the player has reached the `level-4` row (`sideMissionsUnlocked`, resolved by level name, never by a
  raw id), **separate from the shop** which opens earlier (DECISIONS §91/§95). They render as **cards** on the central mission board (below the campaign card), each
  with **Take / Defer / Set active** and Active/Taken badges; selecting a card shows its flavor
  description + est. reward, and **Take-off flies the ACTIVE** one (`renderMissionsBoard` /
  `renderMissionView`). The **taken set + active mission are server-persisted** (`taken_missions` table +
  `players.active_mission_id`; endpoints `POST /api/players/:id/missions/take|defer|activate`, `GET
  /missions` returns `taken` + `activeMissionId` + `cleared`; one active at a time, defer-of-active →
  campaign). **Clearing one is persisted too** (`cleared_missions`, `POST .../missions/clear`, reported
  from the victory path) — it drives the **Cleared** card badge and the `stats.minMission` shop gate.
  The three flavors — **mining / research / freighter** (i18n flavor text only) —
  are all the **same difficulty**: waves of **pirate gunner / rocketeer / heavy** (40/40/20 → 35/35/30),
  then a **2-boss finale** (two buffed `first pirate boss`). A mission is just a level-style descriptor played by
  the existing `levelRunner`; clearing it **banks per-kill ×2 credits like a level but does NOT advance the
  story counter** (repeatable grind to fund the shop). **Each mission fights at its own location in the
  world** (`descriptor.center` — mining at `(-988, 0)`, research at `(928, 0)`, freighter at `(-100, -950)`),
  away from the campaign center `(0,0)`. The map is **one shared world** — all set-pieces (the three mission
  structures + the base station at `(-10,-10)`) exist at fixed positions on every level/mission; the mission only
  moves the combat there (you spawn over the matching structure, the others — and the base station you return
  to — are in the distance). They sit **just below the combat plane** (strong
  parallax like the background speed field). Server-owned (`GET /api/players/:id/missions`,
  gated); rewards bank via the existing `/api/games` (server-sealed per-mission rewards = later integrity
  item). The list refreshes whenever the Main Window is shown (`refreshMissions`).

## Visuals
- **The frame is the historical two-pass one, drawn straight to the canvas** (`main.js animate()`, DECISIONS
  §139): `renderer.info.reset()` → `clear()` → `render(skyScene, camera)` → `clearDepth()` →
  `render(scene, camera)`, with the canvas's own native MSAA (`WebGLRenderer({ antialias })` per tier) and
  **no tone mapping anywhere** (`renderer.toneMapping` is never assigned; the hangar's `model-viewer.js`
  matches by doing the same nothing). The `?bench` `fullFrame` duplicates the identical five lines, so the
  bench measures the real frame. **There is no post-processing chain**: a full-frame `EffectComposer`
  (bloom + ACES) and then an additive glow overlay were both built, live-tested and deleted — a composer with
  MSAA renders ~90-100% black on ANGLE Metal, routing the frame through one throws away the free canvas MSAA,
  ACES over-exposed lighting authored for direct sRGB output, and the overlay's screen-space blur could not
  scale with zoom. `graphics.test.js` asserts no `samples`/`superSample`/`bloom`/`glowScale` knob comes back.
- **Glow is REAL POINT LIGHTS** (`client/src/engine-lights.js`, DECISIONS §139). A **fixed pool** of
  `THREE.PointLight`s, built once at module load and never grown, shrunk or disposed — three bakes the count
  into every lit material's shader (`#define NUM_POINT_LIGHTS`), so changing it at runtime recompiles every
  lit material (§83's stall). Unused lights are parked at `y = -100000` with `intensity 0`. Each frame
  `update()` (called from `settleView`, i.e. the VIEW layer — no randomness, no sim state, replay-neutral
  §73) collects candidates and assigns the **nearest to the camera** to the pool:
  - **engines** — every live plume, at the nozzle (`lightSample()` reads `uOrigin` through the plume group's
    matrix), tinted with the engine's hot palette colour and scaled by throttle, so an idle engine emits
    nothing; power `?lightpow` (default 300), reach 26 u;
  - **rockets in flight** — a smaller always-on source at the body (`?rocketpow`, default 150);
  - **blast flashes** — a detonation is a brief, very bright source that competes for the SAME pool
    (`addFlash`, quadratic-out falloff). Power, reach AND duration all read their tier from ONE classifier
    (`blastClass` in `client/src/blast.js`), so a hull can never be "medium" for one and "small" for another.
    The tier comes from the dead ship's **`weightClass`**, carried on the `kill`/`allyDown` event, and each
    class owns its own profile in `SHIP_CLASSES` (`sim-core/ship-classes.js`): **`light` 800 / 45 u / ×2**,
    **`medium` 1400 / 70 / ×3**, **`heavy` 2400 / 110 / ×5**; the rocket detonation is a WEAPON blast, not a
    class (`400 / 30`, on `BLAST`). Resolution order: a `weightClass` with a blast block → else `isBoss`
    (the role) → else the old `sizeScale` thresholds (`>= 2.2` heavy, `>= 1.4` medium), which are kept as the
    **fallback** for data that predates the field (recorded traces, an older server's wire, the `?tune` rig)
    and are reached by no catalog ship. Power is × `size²`, **reach** × size — reach, not power, is what
    makes a big detonation feel big, because `distance` is a hard cutoff — base duration 0.44 s × the class's
    multiplier.
  **Tier knob `gfx.post.lights`: High 16 / Balance 4 / Performance 0 (`post: null`)**, measured on a Redmi
  15C (Mali-G52): 0 lights holds ~60 fps, 16 drops — worst zoomed in at the station, mild when it is small on
  screen, because the cost tracks LIT PIXELS. **`?lights=N`** overrides the pool size for measurement (needs
  a reload, by construction). Intensity is in candela with `decay: 2` (physically correct 1/d²), which is why
  the numbers are large: at 3 u a power of 4 contributes ~0.44 against a 1.68 sun and a 1.2 ambient.
- **Silhouette: a hull emissive floor that is wired but ships at 0.** Every ship `.glb` template gets
  `applyHullEmissiveFloor` (`ship-factory.js`) **once, on the shared cached template, before `warmModel` and
  before any clone is served** — each lit material with no authored emissive gets `emissive = its own base
  colour` at `emissiveIntensity = LOOK_DEFAULTS.hullEmissive`, which **is 0**: at the planned 0.25 the floor
  flattened the hulls and killed their glint on a real screen. It is kept live because it is the value
  §137's hull flash **restores to** (`applyShipModel` clones every material per instance and `flashMats`
  captures the baked emissive — the floor is applied to the template first, so the captured value IS the
  floor) and because turning it back on is a one-line experiment. Two traps are guarded: it must NOT live in
  `applyShipModel`'s tint traverse (that block is `if (tint)` and every ship with a real `.glb` loads with
  `tint: false` — a silent no-op), and a value copied from `color` is lost wherever `color` is re-assigned,
  so the tint and accent passes re-copy it (`floorMark`/`reFloor`, keyed on `emissive.equals(color)` — the
  floor's own signature — not on a `userData` tag). Without that the wingman's accent-repainted `Wings_`
  materials would self-light in the *player's* hull hue; `38-ally` asserts the emissive hue and the shipped
  intensity. The **ghost-battle `darken`** multiplies the emissive alongside the albedo, but that path is
  **defensive only — nothing passes `darken` today** (`ghost-battle.js` ships `opacity: 0.9` alone), and it
  cannot be checked headlessly (`ghostBattlePlan` disables ghosts under `?debug`).
  **FX colours are the ones their authors chose.** Every HDR gain above 1.0 (`fxGain`, `exhaustGain`,
  `postGain`, `fxColor`/`hdrColor`, the plume's `uGain`) was deleted with the overlay: with nothing mapping
  HDR back to the display, a value above 1.0 only clamps per channel at the 8-bit sRGB write, which flattens
  the effect AND shifts its hue.
- **The Charged beam's sight and discharge** (`client/src/beam-fx.js`; the look was settled by flying a
  throwaway spike and is reproduced, not re-tuned). While a beam is mounted the player sees **three thin
  lines from the hull, always on**: the centre and the two corridor edges, drawn from `sim-core/beam.js`'s
  `corridorEnds` — *the same three endpoints the hit test uses*, so the picture on screen IS the hit test.
  **The sight is GREEN (`#5ad17f`); the shot is BLUE (`0x3d8bff`, taken bluer twice on 2026-08-26 from a
  near-white cyan — the white-hot CORE is unchanged).** They shared one blue at first
  and the aiming aid competed with the discharge it exists to predict; split hues mean a full second of
  green build-up hands over to a cyan-white flash and the SHOT is what the eye lands on, so the sight can
  sit on screen permanently. **All three lines carry the same colour and the same opacity — 0.22 idle,
  rising by 0.38 as the charge fills** (every WebGL line is 1 px whatever `linewidth` says, so a brighter
  centre reads as a *thicker* one; the centre came DOWN to meet the edges). The centre is distinguished by
  **dash rhythm, not brightness**: long strokes (`dashSize` 2.4 / `gapSize` 1.6) against the edges' short
  ticks (0.7 / 1.5), all three `LineDashedMaterial`. **The dashes ARE the charge animation** — they drift
  outward at 3 u/s while aiming and rush to 40 u/s as the shot fills, implemented by writing the
  `lineDistance` attribute directly (`computeLineDistances()` restarts the pattern every frame and freezes
  the flow). A **bead of light gathers at the muzzle** while charging (additive disc, `scale = 0.12 + k²·0.52`,
  `opacity = 0.3 + k·0.65`, slowly spinning), **with DUST pulled into it** (`beamChargeDust`, maintainer
  2026-08-27): a `THREE.Points` cloud of ~96 specks in the discharge blue, born on a 2.8 u ring around the
  muzzle and falling inward on a slight curl. It is a **stream that COLLAPSES** — the fall quickens and
  brightens as the charge fills, and in the last quarter the birth radius closes in, so the second has
  motion throughout and an unmistakable "now" at the end (chosen over a single gathering sweep and over a
  constant stream). Built on `exhaust-fx.js`'s idiom: one `Points`, the per-particle seed packed into the
  position buffer, all motion in the vertex shader off `uTime`/`uK` — nothing stepped on the CPU, no
  randomness, so it is replay-neutral like every other FX here. Its dot texture is its OWN (solid to 45% of
  the radius); the plume's glow is soft by design and reads as fog at speck size. **The shader's `300.0`
  size factor is load-bearing** — the combat camera is ~110 u up, so without it the specks render at
  0.24 px, and scenario 39 asserts the real pixel size (6 → 11 px across the charge) for that reason.
  **Every radius here came down 2.5× on 2026-08-27** after the maintainer flew it — ring 7.0 → 2.8, bead
  0.3→1.6 becoming 0.12→0.64 — and the speck size came down with them, because at ~7 px per world unit
  a 2.8 u ring is only ~40 px across and 15–28 px specks would merge into one patch.
  **Their colour comes off the WEAPON ROW** (`projectileColor`, on both beam events), not from the side —
  so the pirates' red row burns red for whoever mounts it. Only the three SIGHT lines stay
  side-coloured: green is "my aid", red is "aimed at me", which is a different statement from the gun's
  own light. **A charging HOSTILE gets the same bead and dust** (`beamHostileOrb` / `beamHostileDust`, one pair
  per pool entry, maintainer 2026-08-30) — the player's numbers exactly, in the TELEGRAPH's `#ff6b4a`
  rather than the shot's blue. Red says "aimed at you, now"; the bolt then leaves in the shared blue, so
  the hue change at release reads on its own as "it has gone". The seed buffer is shared across every
  cloud (the seeds are constants); `uTime`/`uK` are per-material, so each shooter animates on its own
  charge. The hostile bead deliberately does NOT read `spin` — that counter advances in the player's
  pass, which returns early for a ship with no beam, so it would sit frozen.
  The **reticle is a DIAMOND**, not a circle
  (`RingGeometry(2.2, 2.7, 4)`), marking the corridor's current candidate — or, mid-charge, the committed
  lock — tightening onto it (`×= 1.25 - k·0.25`) and spinning up as the charge completes. **The discharge is a THICK BEAM
  that leaves a trail, and it is geometry by necessity — not a line.** A WebGL line is 1 px wide whatever
  `linewidth` says, so thickness is simply not expressible as a `Line`; the bolt is **two additive quads**,
  a white-hot **core** (width **0.3**) inside a wider cyan **glow** (width **1.0**), both `PlaneGeometry`
  spanned muzzle→impact by midpoint + `rotation.y` + `scale.set(w, 1, len)`, with the core a hair higher in
  Y so it wins the additive blend. **Widths are in WORLD units**, so the beam keeps its thickness as the
  camera zooms. The **fade is 1.0 s and split**: the glow goes `a²` over the whole second while the core is
  `max(0, (a − 0.75) / 0.25)` — it burns out in the first quarter and only the trail lingers, which is what
  makes it read as a strike rather than a dissolve. **The impact flash is NOT this module's** — the beam
  emits `bulletImpact` like every other weapon and the shared hit-sprite path draws it, so a beam hit looks
  like a bullet hit and picks up the cyan `SHIELD_HIT_TINT` when a shield stopped it (§75). **It is placed where the shot
  first MEETS THE HULL** (`hullEntryToward` — a bounded march asking `pointHitsShip` against the same baked
  OBBs a bullet collides with), NOT at the bolt's endpoint and NOT on the bounding sphere. Both of those
  shipped and were invisible: at the hull centre a ~4 u sprite is swallowed by the hull's own depth
  (`depthTest` is on, camera near-top-down); on the sphere it floats metres off the flank of anything
  elongated, because the broad radius is half the hull's LENGTH (heavy pirate: extent x ±4.05, radius 7.57).
  A graze that matched on a corridor edge falls back to the sphere. The hostile path uses the resolver's own
  contact point instead, hull or shield bubble. `'beam'` has no
  `HIT_FLASH_SCALE` entry, so it takes the `0.8` fallback — the kinetic's size, chosen deliberately
  (maintainer, 2026-08-26). It replaced a bespoke additive disc that made the beam the one weapon whose hit
  resembled nothing else's and had no way to say "absorbed". Round-robin over a pool of 4 so a second
  shot never cuts the first short. **The charge FX is driven by the `beamCharge` EVENT carrying `dur`**,
  never by reading `g.charge`: in a room the local group is never ticked, so the event is the only thing
  that arrives; locally the two agree tick-for-tick. All of it is cosmetic and RNG-free → replay-neutral
  (§73).
  **It also draws a POOLED HOSTILE SIGHT.** Any enemy that is charging gets the same three lines from its own
  hull, in **`#ff6b4a`** instead of the player's green — same dash rhythms, same 0.22 + 0.38 opacity ramp,
  drawn to that weapon's own `maxRange` (67 for the lancer, never clipped to the shooter's vicinity, because
  the half of the corridor the player reads is the half crossing his own ship). Four pooled entries
  (`beamHostileSight*`, so a headless scenario can assert on those and not on the player's `beamSight*`), one
  per shooter, keyed on the entity `beamCharge` now carries. It is **CHARGE-ONLY** — lines from a hostile hull
  always mean "a shot is coming right now" — and an entry is dropped when its `dur` expires (which is also
  "it fired"), when the shooter dies, when a room despawns the ghost (`alive = false`), or on `hideBeamFx`.
  The geometry is re-derived from the shooter's LIVE (in a room, interpolated) heading every frame, never
  from the event's frozen `pos`.
  **The hostile pass runs FIRST and unconditionally in `drawBeamSight`**, before the player's — the player's
  pass returns early for a ship with no beam, which is the usual case, so a hostile pass placed after those
  returns would never run at all (`40-enemy-beam` fails if it is moved).
  **Hostile/friendly is decided HERE, in rendering scope**, by asking whether the shooter is in
  `world.enemies`: the event carries `fromPlayer`, not `side`, so an ally handed a beam would otherwise draw
  red — and there is still no `side === 'player'` test anywhere in `sim-core`.
  **Known deferral:** the hostile dashes show the right pattern but do **not FLOW**, because `dashPhase` is
  advanced inside the player's pass, which returns early for a player with no beam. One line moved fixes it,
  but it retimes the player's own sight too, so it is on the ROADMAP for the live-tuning pass rather than
  changed underneath him.
  **Known and accepted:** at the 0.22 idle opacity the sight reads clearly against space (ΔG ≈ +19 on the
  `(27,37,49)` sky) but is **not distinguishable where it crosses a brightly-lit white set-piece** — over
  Level 0's station arm it samples `(237,250,241)` on `(255,255,255)`. Measured on
  `39-charge-beam__aiming.png` and **accepted by the maintainer on 2026-08-25** rather than fixed: the beam
  is a Level-4 purchase and that station is the one place it will rarely be flown over, and raising opacity
  would undo the "the centre came DOWN to meet the edges" decision above. If it is ever revisited the fix
  is a **contrast/outline treatment, not more opacity**.
- **Sky backdrop is a baked procedural nebula cubemap.** `makeNebulaSky` (`world.js`) runs a GLSL
  multi-octave value-noise (fbm) nebula + a sparse power-law star field over the view direction and
  renders it **once** into a `WebGLCubeRenderTarget` (via a `CubeCamera`) at `buildMap` time, then sets
  it as `skyScene.background` — so the per-frame cost is a single flat background draw (same as the old
  flat color), while the shader runs only 6 times total (once per cube face) at map build. Palette is
  data-driven in the map descriptor (`sky.nebula`; fallback `NEBULA_ICEBLUE` in `world.js`) — the shipped
  "ice blue sparse" look: deep-black space + faint blue wisps + a dense static field, tuned so the
  backdrop never competes with ships/bullets/FX. The bake is **tier-gated** (`gfx.nebulaBake`): High bakes
  1024/6-octave, Balance 512/4-octave, **Performance keeps the flat `background` color (no bake)** so the
  weakest phones skip a 6-face shader hitch. It is **skipped under the `?debug` test hook** (mirrors
  `prewarmShaders`), so the headless visual suite's backdrop is unchanged. The bake `ShaderMaterial` uses
  `side: BackSide` + `depthTest/depthWrite: false` (load-bearing — the engine runs `autoClear = false` and
  `CubeCamera.update` doesn't clear depth between faces). The previous cube RT is disposed on every
  rebuild (`G.nebulaRT`). Under `?debug` the bake can be turned back ON with the opt-in **`nebula`** flag
  (`?debug&nebula`), which is how `43-expensive-look` gets the real backdrop while keeping `window.__game`.
  See DECISIONS §43.
- **In front of the cube: ONE additive parallax nebula layer** (`buildBackdropLayer`/`updateBackdropLayer` in
  `world.js`, DECISIONS §139). **The backdrop brightness ceiling (D13) is NOT met, and what ships is a
  REGRESSION FLOOR, not a ceiling.** `43-expensive-look` measures the honest quantities on a real frame — the
  sky's 99th-percentile luminance (`bgP99`, whole sky) against the dimmer end of the lit hull (`hullP25`) —
  and reads **1.155x** where D13 asked for 1.50x. **It was already breached before this feature:**
  attribution on a real frame gives sky p99 **0.4770** all on → **0.4555** with this layer at `amp` 0 →
  **0.4549** with the star layers hidden too → **0.0000** with the baked nebula cubemap removed. So the
  **pre-existing baked cubemap (shipped 2026-07-04) is ~95% of the sky peak**, this layer ~4.5% and the stars
  ~0.1%; **deleting this layer outright would still fail 1.50x**. Reaching it would mean dimming shipped
  backdrop art, or raising hulls — **and raising hulls is rejected because a hull must not become a standing
  light source** (the same reason the emissive floor ships at 0). So the scenario asserts
  `hullP25 >= 1.11 x bgP99` plus `hullLit >= 120` silhouette pixels: the same measurement, pinned just under
  the observed value (1.153/1.155/1.155 across three runs, and 1.155 on the pre-deletion tree — the earlier
  1.30x/1.25x pair was measured on the ACES composer build, whose 1.67x exposure flattered the hull).
  Mutation-checked by raising `amp` through its real `?tune` range: 0.60 passes, 1.00 and 1.50 fail.
  `amp` remains a live `?tune` knob.
  A cubemap background is sampled by view DIRECTION only, so it is incapable of
  parallax by construction. So a **second, coarser bake** (half the cube size, one fewer octave) is mapped
  onto a `SphereGeometry(900, 32, 16)` `ShaderMaterial` that tracks the camera at a **fraction** of its
  motion. It has its **own constant seed and its own noise scale** (`NEBULA2_FALLBACK = { seed 41, scale 2.0,
  thLow 0.55, thHigh 0.78, glow 0.5 }`, per-map overridable via `sky.nebula2`; the threshold band starts
  ABOVE the fbm's ~0.48 median on purpose, so ~a quarter of the sky carries a mass and the rest stays black —
  a band starting below it lights everything and the layer reads as FOG) — required, because an
  `octaves-1` truncation of the same fbm is literally the first n-1 terms of the same sum and would composite
  the base cube's wisps onto themselves; a different seed puts the masses in different directions and the
  lower scale makes them ~1.8× larger. `starB: 0` + `base: [0,0,0]` are forced so only the wisps survive (the
  layer is additive — its own stars would double the cube's and its base colour would lift the whole sky).
  **Brightness `amp` 0.25**, `uLift` driven by `applyStarLift` so the layer brightens with the cube as you
  approach the star. **Parallax:** `follow` **0.94** — the offset is accumulated from the camera **delta**
  (never from `|camPos|`, which would drift the sphere thousands of units off in a 21 000-unit system and
  make the backdrop vanish) and clamped to `offsetMax` **250**, so parallax stays alive wherever you fight and
  merely saturates after ~4 km in one direction. Radius 900 + offset 250 keeps the sphere inside
  `camera.far` 1300 and its near wall (650) outside the camera-locked star sphere (400). Reset to zero
  offset + the current camera position on every `buildMap`; RT/geometry/material disposed there too.
  **It is NOT a skybox, and that guarantee rests on the RENDER LIST, not on `renderOrder`:** three draws the
  whole **opaque** list before any transparent object and `renderOrder` only sorts *within* a list, so the
  material is built **`transparent: false`** (load-bearing) — which puts it in the opaque list where
  `renderOrder: -3` draws it first, ahead of `G.stars` (-1) and every system body. `AdditiveBlending` still
  applies (three forces `NoBlending` only for `NormalBlending` + `transparent: false`), and
  `depthTest: false` + `depthWrite: false` mean it can never occlude or depth-reject a planet, moon or star.
  Gated inside the same `bakeNebula` branch, so Performance and plain `?debug` get no layer at all.
- Background in 3 layers: stars (varying brightness, a static backdrop) → the **player-locked speed-field**
  (parallax) → the **star-system backdrop bodies** (a star + 4 planets). **Stars are two point layers
  (`makeStars`):** the dim majority (small opaque points, power-law brightness — many faint, few less faint)
  plus a bright **~2%** (`brightFraction`, default 0.02) that pops via a **bigger size (5 vs 1.4) + a soft
  additive glow sprite + near-white full-luminance color** — the three cues that make a ~1px point read as
  brighter. The bright layer uses `depthTest: true` (unlike the dim layer) so the bodies occlude it and the
  glow can't creep onto a planet disk (the transparency gotcha in DECISIONS §5). **When the nebula is baked**
  (High/Balance, non-`?debug`) this moving parallax layer is thinned to **0.4×** count.
- **The parallax layer is a PLAYER-LOCKED WRAPPING SPEED FIELD** (`THREE.Points`, DECISIONS §96) — its only
  job is to sell motion, so the ship never reads as floating in place. A **fixed pool of ~1090 point sprites
  in 3 depth layers** (760/220/110 at sizes **1.04/1.69/2.6** world units — ~30% larger than the first
  shipped pass, because **speed reads via SIZE, never via glow**: the field is deliberately dim rock and
  nothing in the renderer can turn it into sparks (§96), which leaves size as the only speed cue. The sizes
  live in BOTH `SPEED_FIELD_DEFAULTS` and the `home-system` map
  descriptor (`catalog_seed.js`), since `normalizeSpeedField` only falls back to the client defaults for
  MISSING keys — sunk to y ≈ −10/−90/−220 with a
  16/40/60 depth spread, opacity 1.0/0.95/0.82), **one draw call per layer**, sprite = the field's **own**
  crisp procedural canvas dot (`getSpeedDotTexture`, no image asset), tint = the descriptor's
  `speedField.color` (`0xd2ccc1`, a warm rock grey) times a per-point 0.55–1.0 brightness jitter.
  The pool is **weighted toward the NEAR layer** — those specks are the ones that actually sweep past and
  sell speed; the deep layers barely move and mostly add clutter, so they are thinned out.
  **The sprite choice is load-bearing, not incidental.** It deliberately does NOT reuse the star layer's
  `getStarGlowTexture`: that one is a soft radial glow built to bloom a point into a halo, averaging ~25%
  alpha across its face, so a speck using it must be blown up and whitened to be visible — which then reads
  as a white blob rather than a lit rock. A hard-edged dot is opaque across its whole face, so a sub-1-unit
  speck reads clearly at a natural tone. **Do not "deduplicate" these two textures.**
  **The sizes/colour are a CONTRAST floor, not taste.** The first shipped pass (grey `0x6b6f78`, sizes
  0.9/1.6/2.6, opacity 0.55–0.90, on the glow sprite) was geometrically perfect and **literally invisible**
  against the map background — every unit test, the outcome scenario and both review rounds were green, and
  the live check came back "I see nothing". `MIN_CONTRAST`/`contrastRatio` in `speed-field.js` now assert
  each layer is ≥3.5× the background luminance (the known-invisible combination scores 2.39), a **visibility
  budget** (`size × contrast ≥ 5`) guards the combination rather than either axis alone, and
  `SPEED_FIELD_RANGES.size` was widened to 20. A ~1px point needs **bigger + brighter + crisper** to read at
  all (DECISIONS §4).
  `SPEED_FIELD_RANGES.depth` reaches **−110**: a negative depth lifts a layer *above* the combat plane,
  between camera and ships, where screen speed scales as `camOffset.y / (camOffset.y − y)` (≈1.5× at y=+40,
  ≈3.4× at y=+90). The shipped look stays **below-plane**; the range exists so a foreground dust layer can
  be judged live in the `?dev` panel. The points are **static in world space** and are
  translated by whole box spans only when they fall outside a **±`radius` (620) box centred on the player** —
  a treadmill, so parallax stays real (deeper layers sweep slower) and a stationary player uploads nothing.
  The re-centre runs **once per frame from the VIEW layer** (`updateSpeedField` called by `settleView` in
  `sim.js`), never from the deterministic tick; it draws **zero randomness** (the one-time scatter uses the
  native `Math.random`), so replays stay bit-identical (DECISIONS §73). Same specks anywhere in the system,
  at constant cost — the old origin-anchored ring left you in empty space as soon as you roamed.
  **No pop-in rule:** `radius ≥ 600` (`WRAP_SAFE_RADIUS`) keeps the wrap edge **outside the frustum** at max
  zoom-out for the shallow layers, which never even reach `fogNear`; the deep layer *does* out-reach the
  frustum but its view depth there exceeds `fog.far` so fog covers that end. **`THREE.Fog` fogs on view
  depth, not radial distance** — do not re-derive the radius from `fog.far`; and the margin is aspect-ratio
  dependent (tight past ~2.4, i.e. ultra-wide would need a bigger radius on the shallow layers).
  Files: `client/src/speed-field.js` (pure math/defaults/clamping/tune persistence, unit-tested),
  `world.js` (`makeSpeedField`/`updateSpeedField`/`disposeSpeedField`/`buildSpeedFieldFolder`, built by
  `buildMap` and disposed on rebuild), `sim.js settleView` (the single per-frame call site). Per-map
  colour/density live in the map descriptor's **`speedField`**; values are dialled live in the `?dev`
  "Speed field" folder. It is **pure client-side render decor**: not in any gameplay array, not collidable,
  nothing about it reaches the server.
- **Star-system bodies (`system-map.js` geometry + `world.js` `buildSystemBodies`/`updateSystemBodies`).**
  A central **star + 4 planets + the home planet's 2 moons**, drawn as **real spheres at their own true (x,z)
  ON the ecliptic** the ship flies over (DECISIONS §98). The ship flies at y = 0 and the camera looks down at
  the plane; each body is sunk **`depth` below** it (285 u; star 300) and shifted by the shared
  **`SYSTEM.offset`** (−150, −110), i.e. exactly the framing the game's original single home planet had
  (`[-150,-285,-110]`, radius 60) — now applied per body. Sizes 52–60 (star 74 ≈ 1.2× a planet).
  Nothing is camera-anchored, so nothing re-projects and **nothing can jump**; perspective and parallax are
  just real 3D. Consequences:
  - **You have to fly there.** At the base you see planet 2 + the station and nothing else — the other bodies
    are ~6k–32k u away (orbits compacted to 0.7× on 2026-08-18). `planetAnchor(name)` (the autopilot
    destination) is a body's own (x,z), so reaching planet 3 is a real ~10 000 u crossing, and arriving frames
    it just like the home planet at the base.
    Bodies **fade in/out by distance from the SHIP** (`bodyFade`, 520 → 760 u) instead of popping; keying the
    fade to the ship (not the camera) is what keeps zoom-out from fading the planet you're parked at.
  - **Permanently out of reach**, even directly overhead: a body's top is `depth − size` below the flight
    plane (`bodyClearance` > 0, unit-asserted). No looming and no "home is near" special case.
  - **Moons** orbit the home planet in world units at radii clear of its limb (`moonClearance` > 0,
    unit-asserted at every angle), animated off wall-clock.
  **"To-scale" means the travel distances (world coords).** Planet 2 is the ocean base planet, **pinned to
  the world origin** (system-map.js) — so the base/set-pieces/mission centers stay origin-relative, and its
  anchor *is* the base. The descriptor's `system` block is **merged into** the client `SYSTEM` at build
  (`applySystemSpec`), so renderer / map screen / `?roam` tunables share one object. Pure view layer →
  replay-neutral.
  **Coordinate frames (docs/plans/heliocentric-coordinate-frame.md).** The *canonical* frame is
  **star-centered** (star at origin); the frame everything runs in is a **planet-2 floating origin** — a
  "zone" is just an origin point in the star frame, and today the only one is the base. `system-map.js`
  exports the pure seam: `starWorldPos(name,t)` (heliocentric position), `planetOriginOffset(t)` (planet 2's
  star-frame position = the base zone's world origin, drifting ~0.51 u/s along its orbit), and
  `worldToLocal(pt,origin)` / `localToWorld` (exact inverses). Identity: `bodyWorldPos(n,t) ===
  worldToLocal(starWorldPos(n,t), planetOriginOffset(t))`. Set-pieces carry an optional **`frame`**: default
  `"planet:2"` (pos is a local offset, placed verbatim — every existing object) or `"world"` (pos is a
  space-fixed STAR coordinate, re-derived to local **every frame** in `buildSetPiece` so the object holds its
  place while the base orbits past it). One demo `frame:"world"` object exists — a procedural research-station
  **1000 u due south of the star** (star coord `(0,1000)`), i.e. right by the star, so in the base's local
  frame it sits ~10 000 u away and is met on the run out to the star; non-collidable decor → replay-neutral
  (DECISIONS §115).
- Lighting: **two render passes** — combat (its own scene/light) and sky (its own scene/light with a
  real day/night terminator on the star-system bodies).
- **Shader pre-warm (`prewarmShaders`).** THREE compiles a material's GL program lazily on its first
  render, so the opening frames of a fight used to stall 0.4-2.2 s (shader compile + texture upload — worst
  on weak phones; see DECISIONS §23). `prewarmShaders()` compiles both scenes plus two throwaway off-screen
  meshes matching the dynamic effect program keys (additive fog-off particles/explosions; opaque fog-on
  bullets/rockets) up front. Runs **once, deferred two frames** after the loop starts (off the critical
  path), during the menu. **Skipped under the `?debug` test hook** (software-GL compile is slow there and
  flakes the visual suite; prewarm is perf-only / behaviorally inert).
- **Ship reflections (env map).** The combat scene sets `scene.environment` to a PMREM of THREE's
  `RoomEnvironment` (built once at startup), so metallic / low-roughness ship surfaces show real
  reflections (the player ship's painted metal, enemy hulls) — the "shine" a single directional light
  can't give. **Tier-gated** (`gfx.envMap` in `graphics.js`): on for High/Balance, **off on Performance**
  (one prefiltered-cubemap lookup per lit fragment — spared on the weakest phones). Sky scene is unaffected.
- The star-system bodies have minimal **procedural textures** (baked canvas maps, no asset files):
  `makePlanetTexture(ocean)` — the ocean base planet with depth variation and soft clouds; `makeMoonTexture`
  — the other planets' cratered/maria surfaces from their base color. The planets don't rotate, so the
  terminator stays consistent.
- **The star (Vega) is a `.glb` sun, not a procedural sphere** (`makeStarMesh`/`loadStarModel` in
  `world.js`; `sun_combat.<hash>.glb`, CC-BY "Sun" by SebastianSosnowski, 2.1 MB source → **167 KB** built).
  Everything about it is driven by the descriptor's **`system.star`** block, merged into `SYSTEM.star`, so
  renderer / map screen / `?roam` tunables read one object:
  - **`size` 96** — the visual radius (1.6x a planet; the model's longest axis is normalized to `size*2`,
    so it exactly fills the sphere it replaces). Clearance is unchanged in kind: the ship flies at `y=0` and
    the star's top is `depth − size` = **204** below it, so it stays permanently out of reach.
  - **`yellowOnly`** — the asset is TWO concentric spheres, an orange emissive core inside a slightly larger
    **yellow transmissive shell**. The shell is see-through face-on, so with both drawn you get an orange
    disk with a yellow limb. The core is **hidden** (not removed — the distance fade holds its material) and
    the shell IS the star. Tinting the core yellow is impossible: its colour is an orange emissive TEXTURE
    and a material colour only multiplies it.
  - **`glow`/`halo` (5.0 / 11.0 star-radii wide) + `glowColor`/`haloColor`** — a two-layer additive corona,
    tight-and-bright over broad-and-dim. Brightness rides the COLOUR, because the fade overwrites
    `material.opacity` every frame. A layer narrower than ~3.6 radii falls entirely behind the disk (the
    shared glow texture's falloff sits at 0.275 of the sprite width) and reads as a rim, not a corona.
  - **`spin` 0.02 rad/s** — the sun turns on its axis, wall-clock driven (frame-rate independent, machine
    independent, zero sim RNG → replay-neutral).
  - **`lift` 0.35 / `liftNear` 300 / `liftFar` 1200** — the star's wash on the sky BACKDROP: closing on it
    brightens the background by up to +35% on a smoothstep. Covers both background paths — the baked nebula
    cubemap rides `backgroundIntensity`, the flat-colour fallback (`?debug` / Performance tier) is multiplied
    in place. `liftFar` sits just outside `fade.out` (760) so the wash grows as the star itself fades in.
  - **Perf**: the shell is a `MeshPhysicalMaterial` with `transmission: 1` — an extra render target per
    frame, the priciest material in the game. Affordable only because the distance fade **hides the whole
    star** outside `fade.out`: at the base, and everywhere but the star's own neighbourhood, the pass never
    runs. Swapping in an unlit material was tried and rejected — the yellow comes from the transmission, not
    a texture, so a flat material renders it orange again.
  - A missing/404 model leaves the procedural emissive sphere (`color`), so the star can never be a hole.
- **The sky light comes FROM the star** (`aimSkySunAtStar`, called from `updateSystemBodies`). The sky
  scene's directional light — the one that shapes the planets' and moons' terminator — is **not** authored
  any more: every frame it is placed AT the star's world position and aimed at the SHIP. The descriptor's
  `sky.sun.pos` survives only as the pre-first-frame placement / the fallback for a map with no star;
  `sky.sun.color` + `intensity` are still authored and `?tune`-able (the position sliders are gone — they
  would be overwritten on the next frame).
  - Aiming at the ship rather than at a body is what keeps it correct after you fly 15 000 u: only one body
    is ever in range, so "from the star toward where you are" is right for whatever you are looking at. The
    body hangs ~340 u off that point, ≈1° of parallax at the star's 15 000–22 000 u range.
  - Measured before/after at the base: the light used to arrive **64°** off the star's true bearing
    (inverted along z), and the home planet's brightest limb sat **89°** away from Vega. Now: 1.3° and 16°
    (one bucket of the 24-direction brightness sweep).
  - The direction drifts as the star orbits (~0.24°/minute) — real, unreadable inside a session.
- **The speed field fades out near the star** (`starDustFactor` → `G.speedFieldDim`, applied in
  `updateSpeedField`; `system.star.dust` 1 / `dustNear` 400 / `dustFar` 760). The parallax field's specks are
  rock-grey and deliberately non-additive, and it lives in the **combat** scene, which draws on top of the
  sky — so over the sun's smooth bright disk they read as dirt on the lens (A/B measured on the rendered
  frame: **~15 000 speck pixels on the disk alone**, peak delta 231). The ramp starts at `fade.out` (760, the
  distance the star first becomes visible), so everywhere you actually fly and fight the field is untouched;
  the motion cue is not lost near the star, because parallax against a huge close body reads better than dust.
  Each layer's opacity is recomputed per frame as `spec × dim`, so the `?dev` opacity slider still works.
- **Sky lights are removed on map rebuild.** `buildMap` recreates the ambient + directional pair per map;
  until 2026-08-10 it never removed the previous ones, so **every level start / map switch leaked another
  pair into the sky scene** — the planets got brighter and their terminator flatter the longer a session
  ran. Pinned by `32-star-system` check 10 (exactly one of each survives repeated builds).
- **The whole scene is data-driven:** it's described by a JSON **map descriptor** in the DB (`maps`
  table, seeded as `home-system`) and built generically by `buildMap(descriptor)` in `bootstrap()`
  (the `system` block → star + 4 planets, `speedField` → the player-locked wrapping speed field, `planet.ocean`
  → the base planet tint, stars/sky-light/set-pieces from params; the dead `asteroids` block is a one-release
  compatibility shim for older published clients — not read here. The client's `SYSTEM` constant in
  `system-map.js` is the fallback for the `system` block + the source of truth for body POSITIONS).
  API: `GET /api/maps/:name`.
- **Dev palette tuning panel (`?tune`, dev-only).** Open the game with `?tune` to get a live lil-gui
  panel for dialing in the backdrop palette: space `background` + `fog` (color/near/far), **sky light**
  (ambient + sun color/intensity/position — the terminator) and **combat light** (ambient + sun
  color/intensity — these affect ship readability, see the two-pass invariant in DECISIONS §5). A
  **"Rebuild planet"** button re-bakes the ocean texture (it's a baked canvas map, so it only re-tints on
  rebuild), and **"Dump palette → console"** prints a labeled `0x`-hex snapshot saying where each value
  goes (sky/background live in the `home-system` map descriptor in `catalog_seed.js`; fog + combat lights
  are currently hardcoded in `client/index.html`). A **`Backdrop (parallax nebula layer)`** folder drives the
  layer's two live uniforms — `amp` (its brightness, and the backdrop ceiling knob 43-expensive-look measures)
  and `follow` (1 = a skybox, no parallax) — or says the layer does not exist here (Performance / `?debug`
  without `&nebula`); the dump prints them as a `LOOK_DEFAULTS` block ready to paste back into `graphics.js`.
  An **`Engine lights`** folder drives the real point lights: `power`, `decay` (2 = physical, lower reaches
  further), `distance` (the hard cutoff), `height` above the plane, a **`nozzle Z`** probe (the baked
  `exhaust` anchor is auto-generated as exactly `-muzzle`, i.e. mirrored from the gun rather than measured off
  the model, so on some hulls the plume — and its light — start too far forward), and a **`Blast flashes`**
  sub-folder whose per-class power/reach/duration sliders are **generated from `SHIP_CLASSES`** (a new class
  row grows its own three sliders with no edit to `tune.js`; a class with no blast block gets none), plus the
  rocket tier and the base duration on `BLAST` and the `medAt`/`bigAt` thresholds labelled **fallback-only**
  (no catalog ship reaches them). It also has buttons that fire one blast on demand and spawn a
  **frozen test range** (3 ranks of 3 disarmed, immobile enemies at small/medium/boss size, HP scaled by
  size²) — the range **clears `weightClass`** on its targets on purpose, so faking hull sizes through
  `sizeScale` keeps exercising that fallback path — an explosion lasts ~0.2 s, so it cannot be judged by dragging a slider and watching. There are
  deliberately **no glow/bloom/exposure/grade/vignette controls**: those belonged to the deleted composer and
  overlay. **There are deliberately no dust `size` sliders here either** — those already exist in the `?dev` Backdrop → "Speed field" folder, which persists to
  localStorage and is the panel `buildMap` re-applies (two panels for one number would be §30's problem).
  Two long-standing crashes are also guarded: with the nebula baked, `skyScene.background` is a cube
  **Texture**, so both the background colour picker and `dumpPalette` used to throw; they now check `isColor`
  and the dump prints `(baked nebula cube)`. **Never shipped to players:** lil-gui is
  dynamically imported only inside the `?tune` guard, so the default build doesn't fetch it and is
  unchanged. Mirrors the `?debug` dev-hook convention. See `docs/plans/color-tuning.md` and DECISIONS §21.
- **Mission set-pieces (procedural decor).** The descriptor can carry a **`setpieces`** array — large
  structures generated **in code** (no `.glb`) — **except the `freighter`, which loads a real `.glb`
  model** — and added to the **combat `scene`** (so they're lit from
  above by the combat sun, like the ships), sitting **just below the combat plane** (so you fly over them
  with strong parallax, like the background speed field; `fog: false` keeps them readable). **Decor only —
  NOT registered in the gameplay arrays**, so bullets pass through and the AI ignores them (collidable
  cover is a later scope). Each spec is `{ type, pos, scale, … }`; `buildSetPiece` dispatches to a
  per-type builder, and each set-piece can self-animate (the render loop calls its `update(dt)`). **All
  set-pieces live in ONE shared world** (the `home-system` map holds them at fixed, far-apart positions),
  so they exist on every level/mission; a run only changes **where you fight** — its `center` spawns you
  over the matching structure while the others sit at a distance. That centre is resolved by the pure
  **`runCenter(activeMission, levelDescriptor)`** seam (`level-sim.js`, unit-tested, called from `sim.js`
  `reset()`): an active **side mission**'s own `center` wins; otherwise the **campaign level**'s `center`
  if it names one; otherwise the origin. Campaign levels omit it and fight at (0,0) — **except two**:
  **"Level 3"** (the weapons-factory briefing, the first with a `boss` phase) fights at `(-450,-435)`,
  30 u up-left of the `space-factory` set-piece; **"Level 4"** ("Find the pirate base") fights at
  `(-900,2800)` — **exactly** `ANCHORS.mining3` / the far `asteroid-field` set-piece, with **no** framing
  offset, since a scattered below-plane field has nothing to frame around and a 0 u offset gives the fly-in
  zone its full margin. (Before the seam, `sim.js` read only `G.activeMission`, which is null for the
  campaign, so a level's `center` was silently ignored.)
  **A level with a `center` is also a place you can FLY INTO to start it.** While roaming, crossing within
  **`MISSION_ZONE_RADIUS` (200 u)** of that centre runs a **`MISSION_ZONE_COUNTDOWN` (3 s)** HUD countdown
  (`ui.roam.engaging`) and then starts the fight — no confirm dialog, and flying back out cancels it (it
  cannot re-fire without leaving and re-entering). The countdown is the pure `stepMissionZone` seam
  (`level-sim.js`), stepped by `sim.js` `checkMissionZone` OUTSIDE the autopilot/manual branch so it works
  however you arrive. It arms via `G.missionZone`, set in `mainwindow.enterRoam` when **no side mission is
  active** (`activeMissionId == null`) — that is the "only when THAT mission is active" rule — with the
  centre from `runCenter`, so it covers **every** campaign level: one that names a `center` is its own place
  in the system, and every other one is the origin, i.e. the base you take off from, so its fight starts
  right after take-off. **`launchCampaign` never starts a fight directly**: it always lands you at the base
  and the countdown's `engage: true` return trip is what starts the level (and arms the session recorder).
  **A countdown never runs while you are on your way somewhere else** — a point autopilot targeting outside
  the zone, or a dock autopilot heading home — or the star system would be unreachable on the three levels
  that fight at the origin and the dock prompt would be eaten by the fight starting first.
  **The ship is moved in exactly one of the three cases** (`reset()` in `sim.js`): in **roam** it spawns at
  the **origin**, the home station, whatever centre the level names — Take off is never a teleport to the
  mission; with **`keepPlayer: true`** (the engage path, i.e. you flew here) it is not moved at all, keeping
  position, heading and velocity so enemies come to you mid-flight; only a **cold start** (a retry, or a
  level that begins where you already are) centres it on `runCenter`.
  **The roam→combat handover is allocation-free by design:** `reset({ keepWorld: true })` skips the
  set-piece teardown/rebuild (they are shared, fixed-position decor, identical either side of the handover —
  rebuilding re-fetched and re-parsed all seven `.glb`s), and `checkMissionZone` spends the countdown
  calling `preloadLevelShipModels` + `preloadRewardModel`, so the frame the fight starts issues no fetch and
  parses no model. A cold start still rebuilds the set-pieces — that is what resets the cruising freighter.
  Firing calls `G.onMissionZoneEnter` → clear roam → `launchCampaign()`. The radius must exceed the distance
  from the map destination autopilot parks you at to the level centre, or arriving would sit just outside the
  zone and nothing would happen: ~131 u for the factory, 0 u for the belt outpost. A `level-sim.test.js` test
  pins this for **every** level that names a centre (nearest `ANCHORS` entry < `MISSION_ZONE_RADIUS`), so a
  new one can't be dropped where autopilot never reaches.
  They're rebuilt each run (so the cruising freighter resets — and every set-piece `.glb` is re-fetched,
  which a test measuring a post-`reset()` frame must wait on via `pendingAssets`). Four builders cover the
  five set-piece types (the two stations share one):
  - **`research-station`** — a hub + a ring on spokes, two solar-panel wings, docking modules and
    emissive windows; slowly rotates around its own axis. A `tilt` param tips it off-vertical so the ring
    reads as a 3D wheel from the top-down camera (the research mission uses a light tilt).
  - **`asteroid-field`** — a wide cluster of rocks (random **`.glb` variants** from the `asteroids_combat`
    pack, fog OFF for readability up close; `makeMoonTexture` icosahedra remain the `?debug`/load-failure
    fallback — the distant backdrop is now the Points speed field, so this up-close field is the pack's
    only use) plus **two mining rigs**, each a
    host rock + a **tilted station** + a **mining beam** (a particle stream flowing from the host up to the
    collector). The rigs are tilted off vertical so the beam reads from the top-down camera. Rocks tumble
    slowly. Like the freighter it builds **asynchronously**: the random scatter/tumble list is precomputed
    synchronously, then `placeRocks` populates the rocks + host rocks once the pack loads (or immediately,
    procedurally, in the fallback). `modelUrl` names the rock pack (its only user — the backdrop needs no
    model). Tunable: `count`, `spread`,
    `hostSize`, `beamLen`, `beamTilt`.
  - **`freighter`** — the **first `.glb`-backed set-piece** (the base-station and asteroid-field packs
    followed; the research-station is still procedural). It loads the
    `freighter_combat` combat glb (CC-BY "Freighter - Spaceship"), auto center/scaled (longest axis →
    `FREIGHTER_MODEL_LEN` 130, then `spec.scale`) and **`yaw`-oriented like a ship model** (nose faces +Z;
    `spec.yaw` 0 here — the model already faces +Z with its bridge/engines aft). A standalone loader in
    `makeFreighter` (`world.js`) reuses the shared `gltfLoader` from `ship-factory.js` (meshopt-wired); the
    exhaust plume is built **synchronously** (a plume shows immediately) and the model is added when it resolves —
    **no procedural box fallback** (on load error → `console.warn`, plume keeps running). It keeps a
    **fiery exhaust**, now the **shared GPU/baked-texture, shader-driven axis-aligned plume**
    (`client/src/exhaust-fx.js` `makeFreighterExhaust`), built **once** — no per-frame buffer re-upload (the
    old system re-uploaded position **and** color buffers every frame). The emitter is a **single rear-center
    origin** re-derived from the loaded model's real group-local rear bounds (`-Z` tail, vertical center,
    spread scaled to the rear width) and pushed into the plume's `uOrigin`/`uSpread` uniforms via
    `fx.setOrigin`. The plume ships **two selectable looks** — **(b)** an intense fiery **noise-scroll flame**
    (the shipped default; the freighter runs a longer/hotter plume via its own `len`/`softness`) / **(a)** the
    legacy **point-glow** (kept as a `?dev`-only option) — switched **globally** (freighter + every ship
    at once) from the `?dev` Exhaust panel (see Tools). The exhaust palette + params (`palette` hot/mid/end,
    `count`, `len`, `size`, `speed`, + optional `turbulence`/`softness`) are an **optional, server-delivered
    `exhaust:` effect config** on the set-piece spec merged over the module defaults (`plumeCfg`; defaults →
    look unchanged when omitted) — the light extension point for future server-driven model effects
    (DECISIONS §38). Its materials are disposed via the set-piece teardown loop (`sp.dispose?.()` in `reset()`).
    **Cruises slowly forward** (`speed` units/sec — a transport in transit). Its render
    position is `pos [-100,-48,-400]` — intentionally offset **+50 z ahead of the freighter mission center**
    (`z -450`, which is unchanged), so the freighter sits ahead of the player's
    forward-gliding spawn; balance-neutral (enemy/player spawns key off the mission center, not the
    non-collidable freighter — DECISIONS §59). (A separate `sync` + zone-drift escort mechanic exists but no
    mission turns it on.)
    - **Ambient "ghost battle" (a distant landmark, shown in every mission EXCEPT the freighter escort).** A
      **clearly visible, looping recorded skirmish** — ghost ships (with **births AND deaths**, so later waves
      keep the clip populated) + their bullets — plays as decor at a **FIXED ABSOLUTE world point** you fly
      toward (default `(ax,az) = (−100,−450)`, the freighter mission's spot — which is why it's documented here,
      though it is **not** tied to the freighter set-piece). It is **near-opaque (`opacity` default 0.9),
      full-color (no darken), moderate scale (default 0.8), at depth `y≈−60`** — a separate layer BELOW the
      `y=0.6` combat plane (so the player can never shoot the ghosts), a distinct depth layer under the
      near-top-down camera. It reads as a *separate distant* battle through **horizontal separation** (a
      landmark off across the arena you fly toward), NOT through dimming (over-dimming was the first playtest
      failure). Strictly **non-interactive**: no HUD/markers/health-bars, no collision, no targeting, no audio.
      It is a **committed, quantized transform-replay track** (`client/src/backdrop-battle.js`) — the runtime
      (`client/src/ghost-battle.js`) just **lerps** ship transforms (shortest-arc yaw) and snaps bullets; it
      **never runs a second sim** and never touches the live world. A ghost death regenerates the **real**
      small-pirate explosion at the ghost's own below-plane depth (`spawnShipExplosion`'s `ringY` param keeps
      the shockwave ring off the combat plane).
      - **Built in `sim.js reset()`, gated to non-freighter missions.** After the set-piece rebuild loop,
        `reset()` dynamically imports + calls `buildGhostBattle()` when `G.activeMission?.title !== 'freighter'`
        (campaign `null` → shows; mining/research → show; **freighter escort → hidden**, you're IN that fight).
        `buildGhostBattle()` takes **no argument** — it anchors at the absolute `GHOST_TUNE.ax/y/az`, adds its
        group to `scene` AND pushes a `setPieces` entry so the universal teardown at the next `reset()` removes
        it. It **self-skips under `?debug` AND `?bench`** (both headless harnesses — the async glb loads would
        add nondeterministic draw counts to the §58 perf gate, which now runs the campaign where this fires).
      - **Births + deaths + a concurrent cap.** Each track slot carries a `birth` (keyframe it appears, default
        0) and a `death` (keyframe it dies, `−1` = survives). A slot renders only for `birth ≤ frame < death`.
        The track holds up to **`MAX_GHOST_SHIPS` = 16 slots** over the whole loop (player + up to 15 enemy
        waves); one mesh is built per slot but **only born-and-alive slots up to a per-tier CONCURRENT ceiling
        are ever visible** (hidden meshes don't draw). **Tier-gated `maxConcurrent`: High 8 + bullets, Balance
        4 / no bullets, Performance = off**. A death only explodes if that ghost was actually on-screen the prior
        frame (a capped-out or never-shown slot doesn't pop a sourceless burst). No new assets — ghost ships
        reuse the existing `player_combat` + `enemy_*_combat` glbs.
      - **Authoring (canonical track = a REAL in-game recording).** The maintainer plays a fight and records it
        via the **`?dev` "Backdrop" panel** (lil-gui, mirrors `?tune`): a **Start/Stop-record** button with a
        live **`REC 12s/60s`** readout (auto-stops at `maxSeconds`, default **60 s**), which captures the player
        (slot 0) + every enemy — **including later-spawned waves, which join as new slots with a `birth`** (up
        to the 16-slot cap) instead of the clip decaying to a lone ship — plus ≤24 bullets at 20 fps, then
        downloads a `backdrop-battle.js` module. Console `window.__backdrop.record()/stop()/status()` is the
        secondary trigger. **We can now record these backdrop clips repeatably via the `/record-backdrop-clip`
        skill** (`.claude/skills/record-backdrop-clip/`): it starts the local server, guides the recording,
        then runs **`node client/bench/process-recording.mjs`** to **trim the low-action tail** (a clip that
        winds down plays as a 2–4 s "lag" before the loop restarts), **re-center** (trimming shifts the
        player's mean), **validate** against the runtime guards, and install `client/src/backdrop-battle.js` —
        so making more such recorded background elements is a one-command flow, not a manual dance. **Authoring note: don't OOB-warp /
        return-to-base mid-record** — a teleport skews the player's mean and shifts the whole cloud off the
        anchor (nudge it back with the Anchor X/Z sliders); fly normally. The panel has live **Depth / Scale /
        Opacity / Anchor X / Anchor Z** sliders that drive a persisted `GHOST_TUNE` object
        (`localStorage['ghostTune']`, defaults `GHOST_TUNE_DEFAULTS = {y:−60, scale:0.8, opacity:0.9, ax:−100,
        az:−450}`) — `ax/az` are the **absolute world anchor** (range ±600) that moves the battle across the
        ground plane (clearly visible), while **Depth (y)** (range [−80,0]) mostly changes apparent size/layer
        under the near-top-down camera (`CAM_OFFSET 0,110,26`) — so Anchor X/Z is the placement control, Depth is
        layer separation. Final numbers are baked into the defaults. A **synthetic headless generator**
        (`window.__bench.bakeBackdrop` → `client/bench/gen-backdrop.mjs`, `npm run bench:backdrop`) is kept only
        as a **bootstrap/fallback** so the runtime + tests work before a real recording exists.
      - Both authoring paths re-center via the shared pure helper **`recenterAndQuantize`** (in
        `ghost-battle-track.js`): it subtracts **ONE FIXED offset — the MEAN of the player's (slot-0) path over
        the whole track** — from every ship + bullet. Only a constant is removed, so the **player's real
        free-flight motion is preserved** (it visibly flies) and the cloud centers near the anchor, with **no
        per-frame membership dependence → no birth/death jumps** (earlier per-keyframe slot-0 pinning froze the
        player at center — rejected; the cast-centroid anchor stepped at every birth/death — also rejected). The
        cloud centers on the player's mean *path* (not the cast centroid), so an enemy-biased formation sits
        slightly off the anchor — that's what the Anchor X/Z sliders nudge. Then quantizes to ints. Pure helpers
        (gating `ghostBattlePlan`, `slotAlive`, sampler, quantize, the tune helpers
        `clampGhostTune`/`loadGhostTune`/`saveGhostTune`, `recenterAndQuantize`) live in
        `client/src/ghost-battle-track.js` (unit-tested, `ghost-battle-track.test.js`).
  - **`base-station` / `space-factory`** — the two `.glb` **station** set-pieces, both built by the shared
    **`makeStationModel`** (`world.js`, mirroring the freighter's async center/scale/`yaw` normalization but
    with **no exhaust**), auto-scaled so the model's longest axis becomes `STATION_LEN[type]`, with an
    optional slow idle `spin`. NON-collidable like the others. Each must stay **entirely below the flight
    plane** (`pos.y + halfHeight < 0.6`, DECISIONS §17), so changing `STATION_LEN` or the source model means
    re-checking the seed's `pos.y`:
    - **`base-station`** — the **return-to-base target** at `(-10,-10)`, just up-left of the arena center
      (14 u off it, so the origin-spawning ship IS framed over the station). `base_station_combat` (CC-BY 4.0 "Low Poly space
      station." by MisterH), len **100**, `spin` 0.03 rad/s, `pos.y = -42` — raised **closer to the plane than
      the freighter** (`-48`) so it reads clearly top-down; the model is tall (y ≈ 0.78 of its longest axis)
      so its **top lands at ~y = -2.9**. `buildSetPiece` stashes it on `G.baseStation = { obj, active }` so
      the sim/HUD/click code can find it; it's the clickable autopilot target for the return-to-base flow
      (see Level flow / Victory).
    - **`space-factory`** — the **Space Factory** navigation destination, ~two screens up-left of the home
      planet. `space_factory_combat` (CC-BY 4.0 "Sci-Fi Space Station: Rotor Nexus" by rivetech), len
      **120** (a step up from the home station, ~85% of the frame height at its depth), `spin` 0.02 rad/s,
      `pos.y = -28` → **top at ~y = -14**. Hosts no mission. Its model sits at `(-420,-405)` — deliberately
      **(-70,-55) off** `ANCHORS.factory` `(-350,-350)`, the point autopilot parks you at, so the station
      frames up-left instead of swallowing the ~15 u ship in its bright middle (the same -x/-z framing the
      base station uses against the arena spawn). Both the offset and the arrival-distance bound are
      test-pinned.
  See `docs/plans/mission-maps.md`. (Collidable cover is later scope.)
- **Wing-bank on turn:** every ship (player + enemies) **rolls its wings into a turn**, a smooth tilt
  capped at **20°** (`BANK_MAX`) that eases back to level when straight. `updateBank` derives the roll from
  the **actual per-frame heading change** (vs the max possible `turnRate*dt`), eases it with `BANK_TAU`
  (0.15 s, frame-rate-independent), and applies it as `bankGroup.rotation.z` (the inner bank group, so it
  composes with the root's heading yaw + scale and the model's `modelYaw` without fighting them). One path
  covers keyboard, touch, warp-back and enemy AI turning. **Cosmetic only** — nothing gameplay reads the
  roll (aim/forward use `heading`; collisions use the OBB hitbox, whose boxes ride `shipMatrix(ship)`
  — built from `pos`/`heading`/`scale` only, so the child `bankGroup` roll can never shift the hitbox).
  `updateBank` runs inside `syncMeshes()`, on the render side of the sim/render split.
- **Enemy spawn ("warp in" IS the arrival):** a newly spawned enemy appears **immediately** as a dot and
  **materializes over its stagger interval** — the armed 2–4 s cooldown, carried per-instance on `e.spawnDur`
  (ease-out cubic grow). While forming (`e.warping`, cleared once `spawnAge >= spawnDur`) it is
  **invulnerable, cannot fire, and is not a valid homing-rocket target** — but it still counts toward
  `maxConcurrent` (preserving the stagger) and shows its off-screen edge marker so the player sees it
  arriving; because no player damage path touches it, its hp stays full and no health bar shows on the dot.
  It becomes a normal combatant the instant it finishes forming. `SPAWN_GROW_TIME` (1 s) stays as the
  per-instance default and drives the **player warp-back** (unchanged).
- Effects: a bullet hit-flash at the impact point — a **small flipbook mini-blast** (`spawnHitSprite`,
  the same baked fire sheet as the ship death, `flipbook-fx.js`), **sized by the weapon `class`** via the
  client `HIT_FLASH_SCALE` map (`kinetic`/unset → a tiny spark, `cannon` → a heavier but still small flash);
  a glowing engine exhaust plume on **every ship** (player and
  enemies) — the **same shared GPU/baked-texture plume as the freighter** (`exhaust-fx.js`
  `attachShipExhaust`), streaming along the aft `-Z`. It is **scene-parented and tracked to the hull each
  frame with a smoothed yaw lag** (`syncShipPlume`, catch-up `k = 1 − e^(−8·dt)`): the tail **trails behind
  on a fast turn** and settles straight in level flight — natural jet inertia, but still **no curved
  position-history** (the old history trail is gone — deliberate trade-off, DECISIONS §74). Because it's
  scene-parented, the flame length is **world-space** (independent of hull scale). It is a **fixed-cost
  render object, not a growing particle pool**: `emitExhaust` (called from the player/enemy thrust sites)
  just lazily attaches the plume (cached on `mesh.userData.exhaustPlume`, count tier-scaled once at attach)
  and flags `throttleTarget = 1`; `updateShipExhaust(dt)` (in `sim.update`) smoothly decays each plume's
  `throttle` toward the target, syncs its transform, then zeroes the target, so a ship that stops thrusting
  **fades out** (the shader multiplies alpha by the throttle). The plume is derived from the engine's single
  `exhaust.color` (`derivePalette` → hot/mid/end) and **honors the same global look toggle as the freighter**
  (default the intense **flame**; **point-glow** is a `?dev`-only legacy option). The old `trail` particle pool (`state.js`) and `spawnTrail` are **removed**;
  `liveParticles()` no longer counts exhaust (only sparks + rocket smoke). Plumes are disposed on ship
  **death/reset** (`disposeShipExhaust`) and on **player ship-swap** (`ship-build.js buildPlayerFor`).
- **Gun fire visual** (`bolt-fx.js`): kinetic **and cannon** bullets render as a **travel-aligned additive bolt**
  laid flat on the combat plane, instead of the old flat opaque sphere. The bolt texture is a **crisp
  bright capsule core** (a near-opaque rounded-rect drawn on the shared, once-uploaded canvas) wrapped in
  a **faint soft halo** — a clearly-outlined body + thin fog rim, rather than the earlier radial gradient
  that read as a mutable oval up close. Base body size `BOLT_LEN` 2.4 × `BOLT_WID` 0.7 world units,
  with the WIDTH multiplied by the weapon class's `BOLT_SCALE` (`projectiles.js`) — **kinetic 1, cannon
  1.7**, so a Heavy cannon slug is the same bolt with more heft (matching its 2× `HIT_FLASH_SCALE`).
  **Length and brightness no longer come from `BOLT_SCALE`:** every shot draws its own from
  `HIT_FX.tracer` (`hit-fx-config.js` `tracerLook`) — a per-class base (`kineticLen`/`cannonLen`,
  `kineticBright`/`cannonBright`) times a symmetric per-shot **jitter** (`jitterLen`/`jitterBright`), so a
  burst reads as a stream of distinct rounds rather than one repeated sprite. Setting both jitters to 0 and
  the bases back to 1.0 / 1.7 reproduces the old uniform look exactly. The jitter is the native
  `Math.random`, never `simRandom` — purely cosmetic and replay-neutral. Each shot
  also pops a quick **muzzle flash** at the barrel — now its own flat additive **glow sprite** (round
  radial texture, same FX family as the bolt/shockwave ring, ~30% smaller than the old sphere flash it
  replaced), scaled by the same `BOLT_SCALE` and pushed into the `explosions` pool so `sim.update()`
  grows + fades it. One draw call per shot; a class with no `BOLT_SCALE` entry keeps the plain sphere.
  Purely cosmetic (a bullet's hit test is a point) and replay-safe (bolt orientation is derived from the
  constant bullet velocity — no RNG). `spawnBullet` looks the scale up by `weapon.class`.
- **Hit feel — the TARGET reacts** (`client/src/hit-fx.js`; tunables + pure seams in
  `client/src/hit-fx-config.js`). Driven by the `hullHit` event, which the sim emits **only when a
  projectile's damage reached a ship's HULL** (`toHull > 0` — a shield that broke and spilled counts;
  **beams deliberately emit nothing**, the Charged beam and the pirate lancer keep their current look).
  Three consequences, all render-only:
  **(1) a hull flash** — an emissive wash over the victim's own (per-instance) materials, on **every** ship:
  enemies, the wingman and your own hull. Defaults `color` white, `intensity` 1.6, `dur` 0.12 s. Materials
  carrying an `emissiveMap` glow only where that map is non-black (2 of 15 on the player hull, 0 on the two
  enemy hulls), which is accepted — changing a map slot would force a shader recompile (§83). It restores to
  the values `flashMats` captured at attach, which since the emissive floor landed is **that floor** (see
  Silhouette above) — 0 today, and whatever the floor is set to if it is ever turned back up.
  **(2) a model punch** from **rockets and the heavy cannon only**, never from plain bullets: a directional
  `shove` (group-local units, along the world yaw the impact pushes toward) and/or a `pop` (a fraction of
  scale), **both shipping at 0** pending live tuning in the panel. It rides the ship's cosmetic
  `bankGroup` — the same child the wing bank uses — so it can never touch `pos`/`heading`/`scale` (which
  feed the hitboxes and the muzzle offset). The impulse is **instant out, eased back**, **refreshes rather
  than accumulates**, and carries a **cooldown** (0.15 s), so a triple-warhead spiral volley punches once
  instead of vibrating.
  **(3) a camera shudder** when a **rocket** reaches the **player's** hull: a pure screen-plane translation
  applied **after** `camera.lookAt` (shaking the orientation would swing the world), along the CAMERA's own
  right/up basis rather than world axes, at a fresh random angle per shudder. Defaults `amp` 1.2 world
  units, `dur` 0.18 s, `cooldown` 0.25 s. Note the shipped balance: a pirate rocket (power 20) into a FULL
  Base shield (capacity 20) breaks it with **exactly 0 spilling to the hull**, so that first hit is silent
  by design — the shield is then down for 10 s and the next rocket is felt.
  All randomness here is the native `Math.random`, never `simRandom`; nothing writes entity state, so the
  recorded intro trace is unaffected (it does now flash and shudder on screen, which is expected). Cleared
  on `reset()` via `resetHitFx()`. Tuned live in the **`?dev` "Hit feel" panel**.
- **Muzzle / exhaust spawn from the model's real bounds.** Bullets/rockets leave the **nose** and the
  exhaust plume streams from the **engines** because `applyShipModel` caches each glb's forward/back extent
  (`mesh.userData.noseZ` / `tailZ`, group-local); `fireMount` fires from `noseZ` × the mesh's current world
  scale (so it tracks spawn-grow), and `attachShipExhaust` tracks the plume to the hull's world-space tail
  `(0,0,tailZ)` each frame (`syncShipPlume`, scene-parented with a smoothed yaw lag — DECISIONS §74).
  Replaces the old fixed `fwd*3` / `fwd*-2.6`
  offsets that floated in empty space ahead of a wingspan-dominant model (the primitive fallback keeps the
  old ±1.6 values).
- **Ship destruction** (`spawnShipExplosion`): a destroyed ship bursts in a **flipbook (sprite-sheet)
  fireball** (`flipbook-fx.js`) — one camera-facing quad that plays a procedurally-baked explosion
  animation (~1.8 s) — **plus a soft expanding shockwave ring only**. The old CPU **spark spray is gone**
  (DECISIONS §75). The fireball sheet is **8×8 = 64 frames (2048px)** and the shader **cross-fades between
  baked frames** (`uFrames`, synthesized in-between frames) so it plays buttery-smooth even at the slow
  ~1.8 s pacing. **One shared sprite-sheet texture uploaded once for the session + one draw call per blast**
  (mobile-friendly, DECISIONS §23) and replay-safe (no sim RNG). The shockwave **ring** is a **baked
  soft-ring texture on an additive quad** (`spawnShockRing`, reuses the `shockwaves` pool grow+fade), **not**
  a hard `RingGeometry`, tinted by the engine's exhaust color. **Sized to the ship** (`sizeScale`). Used on
  enemy and player death; an enemy death also spawns a floating `+xx` credit popup.
- **Boss destruction** (`spawnBossExplosion`, roles `boss`/`boss2`): a **staged chain detonation** — an
  oversized primary fireball + a big ring NOW, then a brighter **yellow SECONDARY detonation** ~0.7 s later
  (the reactor going up; a `uTint` > 1 on the flipbook shader) with its own big ring, plus a handful of
  small pops scattered around the wreck. Timing/positions run off a **deterministic deferred queue**
  (`deferredBlasts` + `updateDeferredBlasts(dt)` in `sim.update`, cleared in `reset()`) seeded by a local
  hash — NO `Math.random`, so it's replay-safe. Non-boss deaths use the plain `spawnShipExplosion` above.
- **Rocket detonation** (`spawnRocketBurst`): the **same flipbook fireball + soft `spawnShockRing`** as a
  ship death (unified §75), just **smaller, faster and brighter** — a white-hot `uTint` > 1 on the flipbook
  reads hotter/whiter than the baked orange. The old layered spheres + spark spray are gone. The blast look
  is **fully weapon-driven** from the rocket weapon's stats, so a **new weapon type changes the blast with
  no code change**: `blastVisual` (fireball size), `blastTimeScale` (playback speed; `0.8` = quicker),
  `blastTint` (ring/accent color) and **`blastBright`** (fireball brightness / white flecks; default `1.6`
  in code so it's correct even before a catalog reseed). Threaded weapon → `spawnRocket` (`r.blastBright`
  …) → `detonateRocket` → `spawnRocketBurst`.
- **Rocket smoke trail** (`spawnSmoke`): every rocket (player + enemy) leaves a **thin, dissipating haze
  line** — small **fixed-size** gray puffs that only fade out (no expansion), emitted densely along the
  flight path so it reads as a vapor line, not a widening cone. `spawnSmoke` honors the particle ceiling
  (`liveParticles()` + `particleScale`), so smoke thins/skips on weak tiers. The **Triple spiral rocket**'s
  three visible warheads each emit their own trail, so its volley reads as **three intertwined smoke
  helices** corkscrewing around the (invisible) flight axis.

## Audio (synth + sampled — `client/src/audio.js`)
**Native Web Audio API, no library.** SFX are **synthesized** by default (oscillators + filtered white
noise + gain envelopes) with an optional **sampled SFX layer** for curated sounds; **background music is
sampled looping tracks** per scene (the generative synth music was removed). All routing is DB-driven
(DECISIONS §22). `createAudio()` builds a lazy `AudioContext` on
the **first user gesture** (browser autoplay policy; `audio.unlock()` on first `pointerdown`/`keydown` + on
opening settings). Graph: sources → `sfxGain` / `musicGain` → master → a `DynamicsCompressor` → output; a
**polyphony cap** (~28 voices) + the compressor keep machine-gun fire / stacked explosions from clipping.
- **SFX** (`audio.sfx.*`, hooked in `index.html`): **shoot(kind?)** (player gun), **enemyShoot** (lower,
  low-passed, distance-attenuated — **defined but no longer called**: enemy fire is silent, see below),
  **hit(kind?)** (bullet connects;
  a `kind` plays a sample — used for the player-ship impact), **rocket** (launch whoosh),
  **explosion(size, kind?)** (ship death — sized to `sizeScale`; a `kind` plays a sample — `shipBoom` for
  medium/large ships, `blast` for small ships + rocket detonation), **uiClick** (every `<button>` via a
  capturing handler), and a **jingle** (ascending major on victory / descending minor on death).
- **Sampled SFX layer — DB-driven routing** (`docs/plans/sound-classes-and-mapping.md`). `audio.preloadSamples(map)`
  fetches + decodes content-hashed mp3s into a buffer cache; `audio.sfx.shoot/rocket/hit/explosion(kind)`
  plays the named sample as a `BufferSource` on `sfxGain` (subtle per-shot pitch jitter), **falling back to
  the synth** if the buffer/key is missing. **The preload runs in bootstrap as soon as the sound catalog
  lands — it is NOT gated on a user gesture** (decoding needs an `AudioContext`, not a *running* one, and
  `preloadSamples` calls `ensure()` itself). Gating it on a gesture used to silently mean all-synth audio on
  any page that starts playing without one — `?playback`, which is reached by navigation from the record
  page's "Play it ▶" link. Guarded by `35-playback-loads-samples`. The gesture handler still calls it (free —
  already-decoded names are skipped); `audio.unlock()` remains gesture-bound, since *resuming* the context
  genuinely needs one. **Routing lives in the DB, not the client:** two tables —
  **`sounds`** (`key → url + gain`, the asset registry) and **`sound_map`** (`(entity, class, event) → sound
  key`) — seeded from `SOUNDS`/`SOUND_MAP` in `catalog_seed.js`. Each **ship**/**weapon** carries a
  **`stats.class`** (ship `fighter`/`capital`/`player`; weapon `kinetic`/`cannon`/`rocket`/`beam`). The per-sound
  **`gain`** (default 1) is a playback trim applied on top of the baked-in file volume — the client preloads
  it via `audio.setSampleGains(...)` and `playSample` multiplies each one-shot by it (currently `kinetic`
  machine-gun fire is at **0.7**, i.e. −30%). The client
  fetches both via **`GET /api/sounds`** in `bootstrap()`, preloads every `sounds` url, and resolves at each
  call site with **`sfxFor(entity, class, event)`** (e.g. ship death → `sfxFor('ship', e.class, 'explode')`;
  gun fire → `sfxFor('weapon', w.class, 'fire')`; rocket detonation resolves `(weapon, class, 'explode')`,
  stored on the rocket at spawn). Adding a ship/weapon = give it a `class` + (if new) a `sound_map` row; no
  client edit. Current map: weapon `kinetic`→`kinetic` (glock) on guns 1/5/7, `cannon`→`cannon` on Heavy
  cannon (6), `rocket`→`rocket` launch on player rockets (3/8) + `rocket` detonation→`blast`,
  **`beam`→`beamCharge` on a NEW `'charge'` event + `beamFire` on `'fire'`** (the Charged beam, 12); ship
  `fighter`→`blast` (small), `capital`→`shipBoom` (medium/large), `player`→`shipBoom` death + `shipHit` when
  struck. `sound_map.event` is a free-text column, so `'charge'` needed no schema change. **Enemy fire is
  silent** — both bullet fire and rocket-launch SFX are gated to `isPlayer` at the
  call site (`fireMount`), so only the player's own shots are audible, and the beam makes **no exception**:
  both of its sounds are gated on `ev.fromPlayer` in the `sim.js` adapter; **enemy rocket *detonations* still
  play** (the blast SFX is ungated).
  **The beam's two samples are cut from ONE CC-BY source** (`assets-src/sounds/843729__tannersound__scifi-laser-gun-shooting.wav`,
  *Scifi Laser Gun Shooting* by TannerSound, **CC-BY 4.0 — the first CC-BY sound in the game**, so its
  attribution block in `CREDITS.md` must stay while it is in use). The maintainer chose both cuts by ear
  (2026-08-25) and neither is a straight excerpt.
  **`beamCharge` is THREE pieces concatenated, 1.400 s total**: a quiet opening burst (0.600→1.100 at
  −9 dB), a lifted build (2.750→3.250), and a tail that deliberately runs PAST the shot (3.250→3.650).
  Three details are load-bearing: **only the first 1.0 s is the charge** — hence
  `BEAM_CHARGE_CLIP_SEC = 1.0`, **not** the file's 1.4 (using 1.4 plays it 40 % fast and drags the crack in
  front of the shot); the build starts at **2.750, not 2.800**, which lands the source's own crack onset
  exactly on the shot rather than 50 ms early, where it reads as a *flam* instead of one fuller hit; and the
  lift is **tapered (+19 dB → +4 dB), not flat**, because a flat lift made the build as loud as the crack
  and the shot stopped being the payoff of its own build-up.
  **`beamFire` is pitch-shifted down (0.82×, tempo-corrected) and then EQ'd** — −11 dB at 3.5 kHz, a −6 dB
  shelf from 6 kHz, a 9 kHz low-pass. **The EQ is the part that matters, and it is counter-intuitive: do not
  "simplify" it to a pitch shift.** Measured per band, pitch-shifting alone moves the harsh 2–5 kHz region
  by ~0.1 dB, because it slides higher content down to refill it; the shipped chain takes that band down
  ~9 dB while leaving the bass essentially intact.
  Neither file is loudness-normalised and neither should be — the swell stays ~4 dB below the crack by mean,
  which is the whole dynamic; trim with a `SOUNDS` `gain`, never a per-file `loudnorm`.
  **The charge plays at `rate = BEAM_CHARGE_CLIP_SEC / ev.dur`** (`1.0 / 1.0` = 1.0 today) so the build
  fills the charge window exactly whatever `chargeTime` is retuned to, leaving the 0.4 s overrun to ring out
  across the shot; an **explicit `rate` is passed for both** (the discharge at `rate: 1`), which also
  suppresses the random per-shot pitch jitter `audio.sfx.shoot` applies by default — a timing cue must sound
  identical every time. Sample bytes
  live on S3 (`sfx/`), pulled same-origin into `client/assets/sounds/` — see the asset pipeline.
- **Music** is **sampled, looping background tracks** (no more generative synth). Routed through the same
  DB map under **`entity: 'scene'`** — `(scene, 'hangar', 'music')` / `(scene, 'combat', 'music')` → track
  key(s). **Hangar** has one track (`music_hangar_1`); **combat** rotates two (`music_combat_1` CC0 +
  `music_combat_2` "Energetic Synthwave", Pixabay Content License). The client passes the per-scene lists to `audio.setMusicTracks(...)`; `audio.setScene()` (via
  `refreshMusic()`, called at every state change) **crossfades** (~0.8 s) to a **random track** of the new
  scene — **combat** during a live fight, **hangar** on menus/overlays/while paused. A scene with one track
  loops it seamlessly; **multiple tracks per scene rotate at random** (no immediate repeat) — add more rows
  with the same `(scene, …, 'music')` in `SOUND_MAP`. Tracks are stereo mp3s preloaded with the SFX; if a
  track isn't decoded yet when the scene starts, the preload-completion hook starts it. Volume follows the
  Music slider/toggle (`musicGain`), **times a baked `MUSIC_TRIM = 0.5`** on the music bus — the tracks are
  mastered hot relative to the SFX, so the whole music channel is halved behind the slider (the slider stays
  the user's control, default 45%; 100% now = half the old 100%). Mirrors the per-SFX `gain` trims. See
  DECISIONS §69.
- **Settings menu — the project's dedicated settings screen.** A ⚙ **gear**
  (`#settings-btn`, **top-left corner, always visible** — incl. during a live fight; the HUD shield/health
  bars block is padded right so the gear never overlaps it) opens a modal (`#settings-overlay`). **Opening it doubles as
  pause:** during a live fight the gear freezes the battle (like the pause button) and opens the menu in one
  click; **closing resumes** — but only if the gear is what paused it (a manual pause stays paused). The
  modal has **Master / Music / SFX volume** sliders + **Music/SFX on-off toggles**, a **Graphics
  quality** selector (see below), a **Language (EN/RU) row** (`#settings-lang`, a `.set-row stack` between
  Graphics quality and the reset danger zone; label key `ui.settings.language`, EN "Language" / RU "Язык") — the
  single place to switch language once past the intro — and a **danger zone: "Reset my progress"** (see next).
  Changes apply live and persist to `localStorage` (audio keys `audioMaster`,
  `audioMusic`, `audioSfx`, `audioMusicOn`, `audioSfxOn`); a fresh player gets sane defaults
  (master .7 / music .45 / sfx .8, both on). Zoom stays where it is. **Mobile-fit:** the modal
  is sized so nothing overflows the viewport width on a narrow phone — sliders are shrinkable + capped (not
  fixed-width), the quality buttons size to their text, fonts/paddings/row-gaps are compact, horizontal padding
  is `clamp`ed, and the box is height-bounded by `max-height: 98vh; overflow-y: auto` (with the added Language
  row the content can exceed a short viewport — e.g. ~77px over on 1280×800 — so the box scrolls internally
  while staying on-screen, with every control, incl. the reset danger zone, reachable).
- **Reset my progress (settings danger zone).** A **slide-to-confirm** control (`#reset-slide` — drag the
  knob left→right to ~96% to *arm*; a partial slide eases back) opens a **confirm/cancel** dialog
  (`#reset-confirm`). Confirm POSTs **`/api/players/:id/reset`** then **reloads** the page (clean re-fetch of
  level + active ship from the baseline); Cancel (or the backdrop) snaps the slide back. Two deliberate
  gestures, since it's destructive. Server-side it's the per-player `resetPlayer` (clears
  games/ships/stash/events, resets level/credits/shop to the new-player baseline, re-grants the starter
  ship; **keeps the account, login and language**). i18n keys `ui.settings.reset.*` (EN+RU).
- **Credits & attributions screen (`client/src/credits.js`, DECISIONS §48).** A **"Credits"** button in the
  settings modal (`#credits-open`) opens a scrollable, closeable `#credits-overlay` (z-index 21, above the
  settings modal; backdrop/Close dismiss) listing every third-party asset: **3D models** (each CC-BY 4.0 —
  work title, `by <author>`, a **Source** link, a **CC BY 4.0** license link, and a **Modified** chip, under
  one blanket "all models are modified" note) and **Music & sound** (CC0 / Pixabay courtesy list — author +
  Source where present, no license link / Modified chip). This satisfies the CC-BY 4.0 obligation to show
  attributions to players on **both** vega.tenony.com and itch.io. The list is **build-generated** from
  `client/assets/CREDITS.md` (single source of truth) by **`npm run credits:build`**
  (`scripts/credits-build.mjs`) → the **committed** `client/src/credits-data.js` the buildless client
  imports; the parser reads the 5-column asset table + the verbatim CC-BY blockquote work titles (matched by
  URL, **throws** if a CC-BY row lacks one) and ignores the narrative prose. A drift test
  (`client/src/credits-data.test.js`) fails CI if the committed module is stale (`credits:build --check`
  mirrors the `assets:check` guard). Chrome labels are i18n (`ui.credits.*`, EN+RU); attribution content
  (authors/titles/URLs/licenses) stays literal.
- **Graphics quality tiers (`client/src/graphics.js`, DECISIONS §23).** A 3-way selector —
  **High / Balance / Performance** — for weak phones. **Note (measured on two GPUs, see DECISIONS §23):
  the weak-device bottleneck is NOT fragment fill rate** — a 5.5-7× backbuffer-pixel cut moved fps by
  nothing; it's **CPU draw-call submit + the GPU/compositor thermal governor**. So the resolution levers
  are largely cosmetic-quality knobs, not perf knobs (a sub-1 `renderScale` was tried and **removed** — it
  only blurred the image for no fps gain). **Balance stopped cutting resolution on 2026-08-31** (DECISIONS
  §140): it renders at **full pixel ratio with AA, exactly like High** — the 1.5 cap + `antialias: false` it
  used to carry was a blur every phone player saw, buying fps that had been measured as nothing twice. What
  separates High from Balance now is the **lighting** (16 vs 4 lights), the additive overdraw and the bake
  sizes; **Performance is the only tier that cuts pixels**. Per tier: **pixel-ratio cap** (2 / 2 / 1),
  **antialias** (on / on / off), **star density** ×(1 / .6 / .35), **particle density** ×(1 / .6 / .4 — scales rocket-burst spark
  count, drops the rocket's middle fireball layer + skips shockwave rings below 0.5, and scales the
  per-ship exhaust plume's particle count once at attach), and **maxParticles** (∞ / ∞ /
  **300** — a hard ceiling on live additive particles, now just **sparks + rocket smoke**
  (`liveParticles() = sparks + smoke`; the engine exhaust is a fixed-cost attached plume, not counted, and
  ship-death sparks are gone — §74/§75); new emits skip over budget, capping per-frame JS / draw-call submit).
  maxParticles is **finite on every tier — 640 / 480 / 300** (it used to be ∞ on High and Balance, an
  unbounded resource on the two tiers most people play; the caps sit at or under the instanced pool's own
  capacity).
  Also **`enemyShieldBubbles`** (**6 / 3 / 0**) — how many enemy shield-hit bubbles may be on screen at once;
  **0 on Performance means the effect is off entirely and no bubble mesh or material is ever created** (the
  pool's shared unit `SphereGeometry` is still built at module import, as on every tier; the HP-bar shield
  strip + the cyan hit flash still read), and above 0 the oldest slot is recycled when all are busy. Persisted in
  `localStorage` (key `gfxTier`). **Default High**; a touch device's **first run defaults to Balance**. **Picking a tier
  reloads the page** so the whole preset (antialias — a `WebGLRenderer` constructor arg — + pixel ratio +
  star/particle density) applies cleanly from startup, no half-applied state (server-side progress is
  untouched). The selector sits below its label (the 3 buttons share one row). The tier knob table lives
  in `graphics.js` (pure, tested). Also **`post`** — the real-light pool (High `{ lights: 16 }` / Balance
  `{ lights: 4 }` / Performance **`null`**, i.e. no lights at all). It is tiered by **per-fragment cost**, not
  resolution (§23 measured resolution levers as a dead end): three evaluates every point light for every
  fragment of every lit material, so the cost tracks LIT PIXELS — measured on a Redmi 15C, 0 lights holds
  ~60 fps and 16 drops, worst zoomed in at the station. `graphics.js` also holds **`LOOK_DEFAULTS`** (the
  shipped look constants: the `hullEmissive` floor and the parallax `backdrop` block).

## Localization (i18n)
English is the **source of truth**; other languages are a derived layer. **EN + RU** today (RU is the
first translation). See DECISIONS §10.
- **Catalogs** (`client/locales/`): `source.json` — the canonical `{ key: { source, context } }` (English
  text + a translator note per string); `<lang>.json` (e.g. `ru.json`) — `{ key: value }` translations.
  English is **not** duplicated into an `en.json`; it comes from `source.json`. **Adding a language = add
  one `<lang>.json` file, zero schema/code change.**
- **Resolution is client-side** (`client/src/i18n.js`): `t(key, params)` → `bundle[key] ?? source[key].source
  ?? key`, with simple `{var}` interpolation (no plural logic — deferred, see DECISIONS §10). UI uses
  `data-i18n="key"` attributes (`applyTranslations()` walks them; `data-i18n-html` for markup like the help
  line; `data-i18n-href` resolves a key into the element's `href`, used by the localized community link) and
  `t()` for JS-set strings (victory/game-over/perf/ship cards).
- **DB content carries keys, not display text.** Player-visible content stores its i18n key in the existing
  JSON columns — `ships.stats.nameKey` (only the player ship is shown to players) and the level victory
  line's `descriptor.phases[].textKey` — with the English `name`/`text` kept as fallback. The DB/API stay
  language-agnostic; the client resolves keys through `t()`. (No content migration needed — keys ride in the
  JSON that already upserts on startup.)
- **Language selection:** explicit choice → `navigator.language` (`ru*`→`ru`, else `en`) → `en`, clamped to
  `{en, ru}`. Persisted in `players.language` (migration 007, `TEXT NOT NULL DEFAULT 'en'`, no FK) **and**
  mirrored to `localStorage.lang`. On load the client adopts the server preference only when it's a real
  non-default choice (so it restores a chosen language after a `localStorage` clear without overriding a new
  player's browser language). The **EN/RU toggle** appears in **two** places — the **welcome screen**
  (`#lang-switch`) and the **Settings modal** (`#settings-lang`, reachable anywhere incl. mid-fight since the
  gear pauses, which is also what covers an RU-browser player who lands straight in the playable intro; the
  cutscene's own third host went with the cutscene — DECISIONS §64 as amended by §138). Both share the
  `.lang-switch` two-button look and a
  **single re-localize entry point**: `applyTranslations()` re-renders every mounted toggle host from a small
  module-scoped registry (`langHosts` in `welcome.js`) so each host's active button matches the loaded language on
  first paint (bootstrap's initial `applyTranslations()`) **and** after a live switch (`setLanguage()`, which also
  calls it). `mountLangSwitch(host)` renders + registers a host from the pure `langButtons(current)` helper
  (`i18n.js`); detached hosts self-prune. Switching is live (no reload), re-rendering chrome + DB-sourced names +
  the intro director's visible line/card. `POST /api/players/:id/language` (validates `en`/`ru`) stores it; `registerPlayer`
  / active-ship return it.

## Backend
- **Node.js + Express** server (`server/`): serves the game client (static) AND a JSON API on
  the same origin (no CORS).
- **Storage is PostgreSQL** (`db.js`, via `pg`), exposed through the `datastore.js` façade (one async
  API). Connects via `DATABASE_URL`; defaults to `postgres://localhost:5432/spacegame` for zero-config
  local dev/test. (SQLite was dropped 2026-07-12 — see DECISIONS §67.)
- **Auto-registration by browser:** the client makes a UUID on first visit (kept in `localStorage`)
  and posts it on load; the server creates the player if new. Anonymous, minimal friction. The client
  now calls **`POST /api/players/register`** once early in `bootstrap()` (previously it relied only on
  the auto-register side-effect of active-ship/level) to carry a **referrer** on first-row creation.
- **Referrer capture (`players.referrer`, migration 018 / Postgres bootstrap):** a nullable `TEXT`
  column written **write-once at row creation** (`registerPlayer(id, referrer)` sets it only on the
  INSERT path — never on the `last_seen` UPDATE — so it reflects where a player *first* came from and is
  never overwritten by later visits). The client builds a compact JSON string of `document.referrer` +
  `?ref=`/UTM params (empty keys omitted, `client/src/net.js` `referrerPayload`/`registerBoot`); the
  server truncates it to **512 chars** and stores it verbatim. Existing prod players keep `NULL` (no
  backfill). All other auto-register call sites pass no referrer. Shown raw in the `/admin` panel.
  **Build source tag:** `referrerPayload` also adds `"source": BUILD_SOURCE` when the build is **not**
  `web` (`client/src/api-base.js` `BUILD_SOURCE`, baked to `'itch'` by `scripts/build-itch.mjs`), so
  **itch.io players are tagged** (`{"source":"itch"}`) even though `document.referrer` is blank inside
  itch's sandboxed CDN iframe. Organic web players stay untagged (`BUILD_SOURCE==='web'`). Requires a
  fresh itch build to be published for the tag to take effect on itch.
- **Device capture (`players.user_agent` + `players.device_model`, migration 021 / Postgres bootstrap):**
  two nullable `TEXT` columns written **latest-wins** at the boot register call — unlike `referrer` (which
  is write-once), each `registerPlayer(id, referrer, device)` overwrites them with any **non-null** value it
  carries via `COALESCE(?, col)` (a call that omits the info never wipes a good prior value). `user_agent`
  is the raw `User-Agent` (capped 512 chars); `device_model` is the raw `Sec-CH-UA-Model` **client-hint
  device code** (e.g. `SM-A037F`, capped 128 chars) — the server opts in by sending `Accept-CH:
  Sec-CH-UA-Model, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version` on **every** response, so Chromium
  browsers attach the hint on subsequent **same-origin** requests (the register route strips the RFC-8941
  quotes). Best-effort: non-Chromium browsers and the cross-origin itch embed send no model hint; existing
  prod rows stay `NULL` until the player next boots (no backfill). No client change — the browser sends the
  headers automatically. All other auto-register call sites pass no device (`COALESCE` preserves the prior
  value). `resetPlayer` intentionally leaves `user_agent`/`device_model` in place (device metadata, not
  progress; overwritten latest-wins on the next boot). Parsed into a `Browser · Device/OS` label at render
  time in `server/src/admin.js` (`deviceLabel` + the curated `DEVICE_NAMES` code→marketing-name map).
- **Player progress:** `players.current_progress` stores the player's currently-available level — an
  integer **foreign key into `levels(id)`** (a real, enforced FK, added after the `levels` table exists
  so the non-null default validates). Defaults to **0** — the intro. `registerPlayer` returns it as
  `currentProgress`; `GET /api/players/:id/level` returns that level's descriptor;
  `POST /api/players/:id/advance` unlocks the next level (smallest level id greater than the current —
  gap-tolerant; a no-op at the last level), runs the newly-unlocked level's `briefing.actions` server-side,
  and returns its `briefing` message.
  **ONE NUMBER PER LEVEL (DECISIONS §102).** A level's `id`, its `name` (`level-0`..`level-4`) and its
  displayed `title` (`Level 0`..`Level 4`) all carry the same 0-based campaign number, 0 = the intro — so
  `current_progress` reads as the level number. Ids are written **explicitly** in `catalog_seed.js` and
  upserted **`ON CONFLICT (id)`**, which pins them and stops the drift the old name-keyed upsert caused (it
  burned a `BIGSERIAL` value every boot; production had reached 1, 6, 7, 71, 564). Ordering stays
  gap-tolerant, and every progress **gate still resolves its threshold by level `name`** via `reachedLevel()`
  — a name is what says *which content* (DECISIONS §95): `SHOP_MIN_LEVEL = 'level-2'`,
  `SIDE_MISSIONS_MIN_LEVEL = 'level-4'`.
  **Migrations** are guarded one-shots in `db.js migrate()` — a `migrations_pg (name, applied_at)` ledger +
  `INSERT ... ON CONFLICT (name) DO NOTHING RETURNING name`, applied only when the INSERT claims the
  sentinel. A third, `grandfather_research_clear`, credits every player already past
  `SIDE_MISSIONS_MIN_LEVEL` with `side-research` (`backfillResearchClear()` — one set-based INSERT that
  resolves the level by NAME, `ON CONFLICT DO NOTHING`, safe to re-run) so the rows that just became
  mission-gated stay on their shelf; it runs **after** the levels seed. Two others matter here:
  `intro_level0_progress_shift` (when "Level 0" was prepended, every existing player was bumped
  `current_progress += 1` once so they stayed on the same content), and **`levels_zero_based_ids`**, which
  runs **before** the levels seed and maps **by name, never arithmetic** (the drifted ids are not a shift of
  anything): it parks both `id` and `name` clear of their targets before assigning — both collide mid-move
  and `name` is UNIQUE — moves `current_progress` in lockstep with the FK dropped, rewrites
  `gameplay_sessions.level`, then restores the FK and sets the column default to 0. On a fresh database
  every statement is a no-op and the seed writes 0..4 directly. Pinned end-to-end by
  `levels_drift.test.js`, which builds a legacy-shaped DB and migrates it.
- **Game history & credits:** at the end of each run the client posts `{ credits, kills, durationMs, xp }`
  to `/api/games`; the server stores it (`games.credits`, renamed from `score` in migration 008) **and
  banks the earned credits** into `players.credits` (the persistent balance, default **1000** for new
  players, no FK), returning the new balance. It **also banks `xp`** into `players.experience` and returns
  `{ experience, level, leveledUp, xpEarned }` (level derived via `progression.js`).
  `registerPlayer`/active-ship also return `credits`; **active-ship additionally returns `progression`**
  `{ experience, level, xpIntoLevel, xpForNextLevel, skillPoints, skills{kinetic,rocket,shields,maneuver,mobility} }`.
- **Character progression columns:** `players.experience` (banked XP) + five `skill_*` allocation columns
  (`skill_kinetic/rocket/shields/maneuver/mobility`), all `INTEGER DEFAULT 0`. **Level and unspent skill
  points are derived**, not stored (`progression.js`: `levelFromXp`, `unspentSkillPoints`).
  `POST /api/players/:id/skills/spend {skill}` row-locks, validates unspent>0 + whitelisted skill, and
  bumps that column (returns fresh `progression`). `resetPlayer` zeroes `experience` + all `skill_*`; the
  enemy `xp`/`dodge` values live in `catalog_seed.js` `stats` (all enemies `dodge:0` for now), and level
  descriptors carry `xpReward` for the mission bonus.
- **Catalog tables:** `ships` (player + enemies; `name`, `type`, `stats` JSON, `model_url` (combat),
  `model_url_high` (hangar high-poly, nullable), `components` JSON ref `{hull,engine,thruster[,repair]}`),
  `components` (`name`, `type`
  `hull`/`engine`/`thruster`/`repair`/`grab`, `weight`, **`price`**, `stats` JSON, **`rarity`**/**`color`**;
  stable ids) and `weapons`
  (`name`, `type` `bullet`/`rocket`, **`price`**, `stats` JSON, **`rarity`**/**`color`**; stable ids), seeded
  from a shared snapshot
  (`server/src/catalog_seed.js`). **`price`** (credits, hangar shop) defaults to **0** until real prices
  are set. **`rarity`** (`trash`/`common`/`rare`) + **`color`** (hex; migration 020, Postgres bootstrap
  parity) are derived in the seed (see Ship model → Rarity + color) and drive the client's drop glow +
  pickup-log tint. **The client assembles all ships from these.**
- **`player_ships`:** ships a player owns; exactly one `is_active` goes into battle. `loadout` JSON
  overrides `mounts` (empty ⇒ the ship's default weapons), `components` JSON overrides the ship's
  hull/engine (null ⇒ ship defaults), `meta` JSON for the future. A new player auto-gets a default
  active ship on registration.
- **Stash & hangar shop (`stash` table, migration 011 / Postgres bootstrap):** a player inventory keyed by
  `(player_id, kind, ref_id)` with a `qty` (`kind ∈ {component, weapon}` → `components.id` / `weapons.id`;
  unique per `(player_id, kind, ref_id)`, indexed by player). **Gated by `players.shop_unlocked`** — flipped
  by `level-2`'s **`unlockShop`** briefing action (i.e. on **reaching player-facing "Level 2"**, right after
  clearing the first flight — the shop opens early in the campaign now, not at its end), with the final-level
  advance still a fallback; it also **backfills the basic gun (id 1)** into the stash. A **boot
  backfill** (`migrate()`, idempotent) retroactively opens the shop + seeds the basic gun for existing
  players who have reached the `level-3` row (threshold resolved by level NAME, not a raw id — DECISIONS
  §95). That backfill is **not** ledger-guarded: it re-runs on **every boot**, and it **never revokes** —
  players granted the shop early by the old raw-id comparison keep it. `replaceWeapon` briefing actions also
  deposit the replaced weapon.
  Datastore methods (server-authoritative + transactional): `getStash` (joined to the catalog),
  `buyItem` (price ≤ balance → deduct → qty++), `sellItem` (stash item — optional `qty`, sells `min(qty,
  owned)` and credits `qty × floor(price*0.75)`; or an *optional* equipped item via a `slot`, single unit),
  `equipItem` (stash → active ship; component slots by `type`, weapons
  by fire-group; the displaced item returns to the stash), `unequipItem` (slot → stash; required slots allowed
  but then take-off is blocked), and **`depositLoot`** (bulk-adds a mission's collected loot items into the
  stash inside one transaction — the victory loot deposit; **not** shop-gated). Component slots =
  `{hull, engine, thruster, repair, grab}` (`grab` is optional + sellable-while-equipped, like `repair`).
  `getActivePlayerShip` now also returns **`shopUnlocked`**, **`sideMissionsUnlocked`**
  (derived via `reachedLevel(progress, SIDE_MISSIONS_MIN_LEVEL = 'level-4')` — a level-NAME lookup that
  fails closed if the row is missing; DECISIONS §95), **`launchable`**,
  and **`missingRequired`** (empty required slots).
- **Maps & levels:** `maps` table holds a JSON scene `descriptor` per map (seeded as `home-system`;
  background, sky light, the **`system`** block (star + 4 fixed-position planets + the home planet's moons), stars, the
  **`speedField`** backdrop (per-layer count/size/radius/depth/opacity + colour), and an optional
  **`setpieces`** array of
  procedural mission decor), built by `buildMap`. `levels` table holds a JSON descriptor per level (a map + a phase/wave script,
  seeded as `level-0`..`level-4`), played by the client's `levelRunner`. Served via `GET /api/maps/:name` and
  `GET /api/levels/:name`.
- **Side missions:** `server/src/missions.js` is a stateless generator (`generateMissions()`) that emits
  the 3 flavored side-mission descriptors (same composition; see Gameplay). `GET /api/players/:id/missions`
  returns them, **gated by `sideMissionsUnlocked`** (progress has reached the `level-4` row, matched by
  name; 403 until the board opens — after clearing "Level 3", DECISIONS §91/§95 — decoupled from the shop,
  which opens earlier); the response
  also carries the player's `taken` set + `activeMissionId`. Each descriptor carries `sideMission: true`;
  the client plays it via `levelRunner` and banks via `/api/games` without advancing progress. The **taken
  set + active mission ARE persisted now** (Slice B): `taken_missions (player_id, mission_id, taken_at)` +
  `players.active_mission_id` (NULL = campaign), with `getMissionState`/`takeMission`/`deferMission`/
  `activateMission` (activate auto-takes + enforces one-active; defer-of-active → campaign) behind
  `POST /api/players/:id/missions/take|defer|activate` (gated on `sideMissionsUnlocked`, ids validated
  against `generateMissions()`). Reset clears both. **Mission COMPLETION is persisted too**:
  `cleared_missions (player_id, mission_id, cleared_at)` (PK on the pair → permanent + idempotent) with
  `getClearedMissions`/`clearMission` behind `POST /api/players/:id/missions/clear`, reported by the client
  from the victory path (`sim.js win()` → `reportMissionCleared`, suppressed under replay) —
  **client-authoritative like `/api/games` + `/loot`**. `getMissionState` (and therefore **every** mission
  route, including the `GET /missions` board read) returns `cleared`; `getActivePlayerShip` ships
  `clearedMissions`. It is the second content-gate source next to `current_progress`: catalog rows carrying
  `stats.minMission` (Ion engine 16, Nanobot repair 20) are buyable only once the named mission is in it.
  Reset (`resetPlayer`/`resetAllPlayers`) clears it, re-arming the gate.
  (Server-sealed rewards = still a later integrity item.)
- API: `POST /api/players/register`, `POST /api/games`, `GET /api/players/:id/games`,
  `POST /api/players/:id/missions/clear` (record a side mission as cleared — permanent, idempotent;
  unlocks `stats.minMission` shop rows), `GET /api/health`, `GET /api/ships`, `GET /api/weapons`, `GET /api/components`,
  `GET /api/players/:id/active-ship`, `GET /api/players/:id/level`, `POST /api/players/:id/advance`,
  `POST /api/players/:id/reset` (player-initiated progress reset → new-player baseline; 404 if unknown),
  `GET /api/players/:id/stash`, `POST /api/players/:id/buy`, `.../sell` (optional `qty`), `.../equip`, `.../unequip`
  (hangar shop; 403 until the shop is unlocked), `POST /api/players/:id/skills/spend` (character
  progression: spend one skill point on `{skill}`; 400 unknown skill, 409 no unspent points — not
  shop-gated), `POST /api/players/:id/loot` (victory loot deposit → stash;
  **not** shop-gated), `GET /api/players/:id/missions` (side-mission board; 403 until unlocked),
  `POST /api/players/:id/language`, `POST /api/players/:id/username`, `GET /api/maps/:name`,
  `GET /api/levels/:name`, the auth routes (`POST /api/auth/register`, `/login`, `/logout`,
  `POST /api/auth/resend-verification`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`,
  `GET /api/auth/me`, `GET /api/auth/verify`), plus
  `GET /api/config` (public client config), `POST /api/events` (funnel telemetry),
  `POST /api/perf` (client perf samples from the `?dev` monitor — write-only diagnostic telemetry),
  `POST /api/sessions` (store one gameplay session recording — 3MB route-scoped body parser),
  `GET /api/sessions/:id/trace` (serve a recorded trace for admin playback — **intentionally
  unauthenticated**: seed + input only, no PII, unguessable UUID key) and
  `POST /api/ws-ticket` (mint a single-use 30 s ticket for the `?netsim` WebSocket — see "Playing in a
  server-run room"; the socket itself is an `upgrade` on the raw HTTP server at **`/ws`**, not an Express
  route).
- **Session recordings (funnel analytics, `docs/plans/2026-08-03-1246-record-all-sessions.md`):**
  **every live campaign session** (side missions excluded in v1 — their server-generated descriptors
  aren't refetchable for `/api/levels/:name` playback) is captured **always-on and invisibly** as a
  deterministic input-replay (seed + per-tick input + the ship it was flown with, reusing `replay.js`) and
  uploaded via `POST
  /api/sessions`. The **server** uploads the trace to S3 (`server/src/s3.js` — hand-rolled SigV4 PutObject,
  no `@aws-sdk`, keyed `recordings/sessions/<uuid>.json`; **no-ops without AWS creds** so `npm test` stays
  green) and writes a metadata row to the **`gameplay_sessions`** table (`id`, nullable `player_id`, `level`,
  `outcome` win|death|quit, `duration_ms`, `kills`, `s3_key`, `game_version`, `created_at`; indexes
  `idx_gsessions_created`/`idx_gsessions_player`).
  **A trace must carry the SKILL allocation or the replay is fiction (v4, DECISIONS §125).** Skills change
  engine power, weapon damage, shield capacity and — through Maneuver's `dodge` — whether the hostile-hit
  roll draws from the seeded gameplay stream at all, so a run replayed on a skill-less ship diverges within
  seconds and every later enemy spawn lands elsewhere; in the admin viewer that looked like the pilot
  fighting ghosts. `TRACE_VERSION` is the line: **v4 and up reproduce, v1–v3 only for a player who had
  spent nothing** (which is why the shipped Level-0 intro was always fine). Old traces cannot be fixed —
  an allocation that was never recorded is not recoverable. **This table is DISTINCT from the auth `sessions` token
  store** (`db.js`; different name + `idx_gsessions_*` prefix — reusing either would silently no-op the
  `CREATE TABLE`). **Upload triggers (four, DECISIONS §87):** win/death → plain `fetch`, **final** (the
  session closes, nothing more is sent); **tab hidden (`visibilitychange`) → plain `fetch`**, provisional
  (recording continues); `pagehide` → `sendBeacon`, provisional last resort (~64KB body cap); and
  `beginLiveSession()` flushes any still-open session as `quit` before starting a new one, so a fight
  ABANDONED mid-way (left, then another level launched) leaves a row instead of being discarded. A
  provisional flush with no new ticks since the last one sends nothing (repeated tab switches while the game
  is auto-paused would otherwise re-upload an identical trace). The hidden
  flush is **the** path that works on phones/tablets, where `pagehide` usually never fires. Because a session
  can upload several times, its **`id` is minted client-side** at `beginLiveSession()` and `recordSession`
  **UPSERTs** (`ON CONFLICT (id) DO UPDATE … WHERE player_id IS NOT DISTINCT FROM EXCLUDED.player_id` — a
  colliding id can't rewrite another player's row), so a provisional `quit` is replaced in place by the final
  `win`/`death`: one session = one row. `game_version` = the deploy commit, stamped **server-side** from
  `process.env.SENTRY_RELEASE`. Trivial sessions **< 180 ticks (~3 s)** are dropped; capture stops appending
  past **108000 ticks (~30 min)** or **20000 runs** (`MAX_SESSION_RUNS` — the bound that actually binds on
  touch, where the aim changes almost every tick); server hard caps are 120000 ticks / 25000 runs → 413.
  **Known limitation:** a trace reproduces faithfully **only on its recorded `game_version`** (input-replay
  analytics) — admin shows a ✓/✗ match; no old-engine restoration. **Ops prerequisite:** the server IAM key
  needs `s3:PutObject`+`s3:GetObject` on `recordings/sessions/*` and `ASSETS_BUCKET` (+ region) in the server
  `.env`, else uploads no-op and playback 404s.
- **Admin dashboard (`GET /admin`, `server/src/admin.js`):** a private, **server-rendered** HTML page
  listing every player (id short, username, email, email_verified, created_at, last_seen,
  **progress**, credits, games_played, referrer, **device**) plus per-player aggregates from `games`
  (total time played, total kills, total earned), one aggregated query `players LEFT JOIN games GROUP BY
  player` ordered `last_seen DESC`, hard-capped at **1000 rows** — via the `getAdminPlayers` datastore fn
  (Postgres coerces the BIGINT `SUM`s with `Number()` and `email_verified` with
  `!!Number()`). The **progress** column renders the player's `current_progress` (an FK into `levels`) as
  the level's player-facing **title** (`descriptor.title`, e.g. `Level 2` — the `levels.name` column
  `level-0`..`level-4` now carries the same number and the title is what is shown) plus a CSS bar and an `n/N` fraction, with a **✔**
  on the last level; `N` = the number of level rows and `n` = the level's ordinal position, both derived
  per request from the new `getLevels()` datastore fn injected into `mountAdmin` (never hardcoded). The
  cell keeps `data-sort="<raw id>"`, so sorting is still by real progress; an id missing from `levels`
  falls back to the bare number (`progressCell` in `server/src/admin.js`). The **device** column (last column) is a best-effort `Browser · Device/OS` label composed
  from `user_agent` + `device_model` by `deviceLabel(ua, model)` at render time: `Browser · Model` (known
  device code → marketing name via the curated `DEVICE_NAMES` map, else the raw code) → `Browser · OS` →
  `Browser` → `OS` → the raw UA (truncated) → blank, HTML-escaped, with the full raw UA on `title` hover
  (`parseBrowser`/`parseOS` are hand-rolled regexes, no npm dependency — DECISIONS §56).
  Client-side click-to-sort per column (inline JS); no pagination/search/export. Protected by **HTTP
  Basic Auth** (`ADMIN_USER` / `ADMIN_PASSWORD` from the server `.env`, compared with
  `crypto.timingSafeEqual`); **404 (disabled) when either env var is unset**, so it's never wide open on
  prod. Mounted outside `/api`, so the `/api`-scoped CORS never touches it (same-origin only).
- **Admin sessions (`GET /admin/sessions`, `server/src/admin.js`):** same Basic-Auth guard + shared page
  shell/sort script, cross-linked from `/admin`. Lists every recorded gameplay session (newest first, cap
  500 via `getAdminSessions`): created, player (id short or `anon`), level, outcome, duration, kills,
  game_version (+ **✓/✗** whether it matches the current deploy `SENTRY_RELEASE`), and a **▶ play** link
  (`/?playback&id=<id>`) that streams the trace from `GET /api/sessions/:id/trace` and re-sims it.
- **Run verification (`server/src/seal/verify-run.js`, `server/tools/verify-sessions.mjs`) — MEASURING ONLY,
  nothing is enforced.** `POST /api/games` is still client-authoritative: the browser says what it earned
  and the server banks it. `verifyRun({ trace, claim, build })` is the other half being built up — it
  re-simulates a recorded run with `runTrace()` and returns `{ verdict, credits, xp, kills, note }`, where
  verdict is `agree` / `disagree` / `unverifiable` / `no-trace` / `error`. **It writes nothing and no caller
  may change a balance on it.** What it refuses to judge is the point: a trace below **v4** (no skill
  allocation — DECISIONS §125), a trace at the recorder's tick/run cap (its tail was never recorded), a
  level the catalog does not carry (side missions), a claim about a different level, and — the constraint
  measurement added, DECISIONS §129 — a run recorded by **any build other than the one running**
  (`build-drift` / `build-unknown`), because removing auto-aim (§124) proved a trace reproduces only on the
  code that made it. Two rules inside it: a claimed win whose re-simulation reached return-to-base gets
  `winLevel` applied (a headless referee cannot dock, so it would otherwise under-count every victory by
  half), and the comparison is credits/XP/kills — **never the world digest**, whose `ownsReward` branch
  legitimately differs per account. `server/tools/verify-sessions.mjs` is the read-only survey over
  `gameplay_sessions` (`--rows FILE` to survey a dumped row set with no database connection,
  `--build SHA` to apply the live gate, `--include-unskilled` to widen the sample to pre-v4 traces from
  accounts that never spent a point). **First survey, 2026-08-21, all 74 production sessions: 20%
  agreement, no cheating** — see `docs/plans/seal-the-economy.md` §3.1, which also records that session
  recording captures a stub under `?netsim=1` (so the admin replay viewer plays a 5-second stub for those).
  **That defect is PARKED** (§6): the flag is a manual opt-in, so no production session is affected, and the
  fix — the ROOM writes the trace — waits for real multiplayer sessions.
- **Health / uptime** — `GET /api/health` is the monitoring endpoint (UptimeRobot, the Docker
  healthcheck, the CI smoke check all use it). It touches the DB (via `stats`), so it reflects DB
  outages, not just process liveness: **200** `{ ok:true, status:"ok", backend, uptimeSec, players,
  games }` when healthy, **503** `{ ok:false, status:"error", backend, error }` when a dependency is
  down. Monitor it at `https://vega.tenony.com/api/health` (alert on non-2xx, or keyword `"status":"ok"`).
- **Monitoring / observability** (`docs/plans/monitoring.md`):
  - **Sentry (errors only, no perf tracing).** Server uses `@sentry/node` (the only runtime dep beyond
    express/pg), initialized in `server/src/instrument.js` (imported first in `server.js`), with
    `Sentry.setupExpressErrorHandler` before the custom error middleware. Browser uses the Sentry **CDN
    bundle**, loaded on demand by `initSentry()` only when the server hands it a public DSN. **Both
    no-op when their DSN env is unset** (local dev / tests unaffected). Server reads `SENTRY_DSN_SERVER`;
    the public browser DSN + `SENTRY_ENVIRONMENT`/`SENTRY_RELEASE` come from **`GET /api/config`** (so
    the buildless client needs no hardcoded DSN). `tracesSampleRate: 0` keeps it within the free tier.
    **Release = git SHA, baked into the image at build time** (`Dockerfile` `ARG GIT_SHA` →
    `ENV SENTRY_RELEASE`; CI `--build-arg GIT_SHA=<full sha>`) — each artifact reports its own release,
    so `SENTRY_RELEASE` is **not** in `.env` (env_file would override the baked value). CI registers the
    release + commits in Sentry via `@sentry/cli` on every deploy (repo secrets `SENTRY_AUTH_TOKEN` /
    `SENTRY_ORG=tenony` / `SENTRY_PROJECT=vega-sentinels` are set). **Live on prod:** Sentry (browser +
    server) + release tracking + funnel events are all active.
  - **Product funnel events.** `events` table (migration 010 / Postgres bootstrap): `id`, `player_id`
    (logical FK, no hard FK — best-effort), `type`, `data` (JSON), `created_at`; indexed on
    `(type, created_at)` and `(player_id)`. **`POST /api/events`** records one event or a batch
    (`{ events:[…] }`), validating `type` against an allowlist (`game_start`, `level_start`,
    `level_clear`, `player_death`, `victory`, `quit`, `community_click`) — unknown/junk dropped, **204** if anything stored
    else **400**; never blocks gameplay. The client fires these fire-and-forget via a `track()` helper
    (`quit` uses `navigator.sendBeacon` so it survives tab close), and tags the Sentry scope with the
    current level. Read the funnel with plain SQL over `events`.
  - **Client perf samples (`?dev` monitor).** `perf_samples` table (migration 015 / Postgres bootstrap):
    `id`, `player_id` (logical FK), `session_id` (random per page load), `sample` (JSON/JSONB),
    `created_at`; indexed on `(session_id)`, `(created_at)`, `(player_id)`. Diagnostic telemetry for weak
    phones: opening the game with **`?dev`** (mirrors `?tune`/`?debug`) turns on a per-frame profiler
    (`devPerf` in `client/src/main.js`) that times the JS work each frame — **`update` (sim) / `dom` (HUD, markers,
    minimap, OOB) / `render` (the two-pass submit)** — and once per second emits an aggregated **sample**:
    `fps`, `frameMs` (p50/p95/max), the `js` breakdown (means + `totalP95`), a `jank` count (frames >
    1.5× p50), scene `load` (enemies/particles/draws/tris), **`heap`** (JS-heap MB — `used`/`total`/`limit`
    via `performance.memory`; Chrome-only, **not** process RSS or GPU memory, `null` elsewhere), backbuffer
    `res`, **`gpu`** (live three.js `programs`/`geometries`/`textures` counts — a jump inside a stalled second
    means the freeze WAS a GPU-resource creation, i.e. a shader compile or texture upload, and is fixable by
    warming it early), **`longTasks`** (`{n, ms}` — main-thread blocks >50 ms from the Long Tasks API in that
    window: non-zero on a freeze frame points at OUR thread (script or GC), zero points outside it —
    compositor, GPU process, CPU governor/thermal — which our own optimisation cannot fix), and a one-time **device
    passport** (`ua`, `dpr`, `cores`, `mem`, `screen`, real **`gpu`** via `WEBGL_debug_renderer_info`, the
    `tier` + its `knobs`). Batched to **`POST /api/perf`** (`{ playerId, sessionId, samples:[…] }`, cap
    120/batch) every ~5 s and on tab-hide (`sendBeacon`); the perf overlay shows a `●dev` marker while
    recording. **Off — zero overhead — without `?dev`.** (`devPerf` is gated on `isDev()`, which is never
    sticky, so a device reports only while an explicit `?dev` is in *this* load's URL — a playtester must be
    handed a `?dev` link for each measuring session, and a one-off visit can't leave a phone reporting
    forever; see the Perf-overlay bullet + DECISIONS §81.) Write-only over HTTP (no public read); analyze
    with plain SQL over `perf_samples` (the key tell: if `js.total` ≪ `frameMs.p50` the frame isn't
    CPU-bound → external/GPU-governed). Not wiped by a player reset. See DECISIONS §23 +
    `docs/plans/perf-low-end-phones.md`.
  - **Frame-pacing probe (`/raf-probe.html`) — the PLATFORM baseline, with the game out of the way.**
    Standalone, dependency-free single page (no modules/imports, so it measures the device and not our
    bundle), served static from the client root; nothing in the game links to it. Three ~3 s phases:
    **blank** (rAF callbacks only, nothing drawn), **triangle** (one WebGL draw, a few pixels), **fill**
    (one draw covering the full `innerWidth×innerHeight×dpr` backbuffer) — the last two differ *only* in
    fragment count, so they separate **fill rate** from **draw-call cost** without touching the game.
    Reports fps + p50/p95/min/max + a frame-interval **histogram** per phase (a half-rate vsync lock is one
    tight spike at ~22 ms; generic slowness is a smear) plus a device passport incl. the real `gpu`.
    Results POST to the same **`/api/perf`** sink tagged `probe:'raf'` — no new table or route — keyed by
    the game's localStorage `playerId` (never created here; anonymous runs land under `probe-anon`), so a
    tester just opens the link and the numbers are read with SQL:
    `SELECT sample->'phases' FROM perf_samples WHERE sample->>'probe'='raf'`. `?dry=1` measures and renders
    but uploads nothing. Reading the result table + why it exists: DECISIONS §88.
  - **Deterministic replay benchmark + perf-regression gate (`?bench`, `client/bench/`).** A standalone
    A/B tool that catches when a code change makes the **per-frame CPU cost** worse by **>2%** before it lands
    — the CPU/JS half of the `?dev` buckets, measured deterministically on desktop/CI. `client/src/bench.js`
    holds the sticky `?bench` flag (`benchMode`/`isBench`, mirrors `?dev`) + `BENCH_DT` (fixed 1/60 step);
    the seeded RNG itself moved to `sim-random.js` (opt-in, DECISIONS §73) and `bench.js` only re-exports
    `mulberry32` for back-compat. Two modes: **`?bench=record`** — a
    human plays and `window.__bench.stop()` downloads a JSON **trace** of the per-tick resolved input
    (`{ k:[KeyboardEvent.code], t:[heading,thrust]|null }`) + a `setup` (`shipId`, initial `spawns`,
    `maintainEnemies` load-pin); **`?bench=replay`** — `window.__bench.replay(trace,{mode})` re-seeds the RNG,
    `reset()`s to a clean fight, **sets `G.gameStarted=true`** (the launch flows never run headless, so
    without it every `update()` early-returns), and drives the trace through the exact per-frame work
    `animate()` does, timed into the same `update`/`dom`/`render` buckets (`mode:'full'`) or `update`-only
    (`mode:'sim'`). Traces live in `client/bench/traces/` (canonical: `combat-heavy.json`, produced by
    `node bench/gen-trace.mjs`, load-pinned to 6 enemies). The runner **`node client/bench/run.mjs`** (`npm run
    bench`; NOT part of `npm test`) starts an isolated server + one headless Chromium, serves build **A**
    (`BENCH_A_DIR`, the merge-base) and build **B** (`BENCH_B_DIR`, the worktree; default `A===B` =
    self-compare noise floor), replays every trace interleaved `A,B,…` (default 15 reps, 4× CDP CPU throttle),
    and via `client/bench/stats.mjs` (pure, unit-tested) reports a per-bucket table, flagging **REGRESSION**
    when the CI lower bound of `(B/A−1)` exceeds +2%. Each rep is aggregated by the **mean** of its per-tick
    samples (beats Chromium's 100µs timer quantization) with the **median across reps**; the CI is a **paired**
    bootstrap (`A[i]`/`B[i]` run back-to-back, order flipped each round, so common-mode noise cancels). The gate
    fires on `full.js.total` **or** `sim.js.update` (plus structural `load.draws/tris/particles` growth as a
    GPU-cost proxy). On software GL the full-mode `render` bucket rasterizes on the CPU and is noisy, so the
    tight 2%-sensitive signal is **`sim`-mode `js.update`**. If either build lacks `window.__bench` it prints
    `gate inactive` and exits 0. **CPU-only** — the GPU/fill-rate half stays with real-device `?dev`. Documented (not CI-wired) as the pipeline PERF A/B stage in
    `docs/plans/multi-agent-pipeline.md`. See DECISIONS §58 + `client/bench/README.md`.

### Accounts / authentication (DECISIONS §11)
- **Anonymous-first, optional account.** Players keep the localStorage UUID and auto-register as
  before. **After clearing level 1** the client prompts (once) for a **username** (display name) and
  offers to **create an account**. Decline → keep playing as a guest (the username is still saved).
  Accept → email + password **upgrade the same `players` row in place** (progress preserved).
- **Account bar (menu screens).** A signed-in account shows "Signed in as …" (`ui.account.signed_in_as`);
  a guest who set a callsign at the post-"Level 1" prompt shows **"Playing as <name>"** (`ui.account.guest_named`),
  otherwise "Playing as a guest" (`ui.account.anon`); the *Log in / Sign up* CTA is present for any guest.
  The guest callsign persists client-side in **`localStorage['guestName']`** (mirrored by `setGuestName`
  in `client/src/account.js`, loaded at import so the first paint reflects it) — a guest is already a
  localStorage identity, so no server/DB row is needed. Opening the account dialog with an empty username
  field pre-fills it from the stored callsign, so a later guest→register keeps the name instead of wiping
  it. `guestName` is not cleared on register/login (the signed-in `accountPlayer` takes precedence in the
  bar); a same-device logout then falls back to "Playing as <that callsign>".
- **Identity:** `players.id` UUID stays the game identity; credentials attach to that row. **Login is
  by email** (case-insensitive, stored lower-cased); the username is a non-unique display name.
  Fresh-device login **adopts the account's player row** (the client swaps `localStorage.playerId`
  and re-fetches level + active ship). Merging two anonymous progresses is out of scope (v1).
- **Cross-device sync requires a verified email.** Until verified, the account works on the device it
  was created on (session cookie) but can't be logged into elsewhere usefully; the UI shows a "verify
  your email to sync" nudge with a resend button.
- **Passwords:** built-in `crypto.scrypt` (N=16384, r=8, p=1, 64-byte key), per-user random salt,
  `crypto.timingSafeEqual` compare — **no hashing dependency** (`server/src/auth.js`). Plaintext is
  never stored or logged.
- **Sessions:** a random token (`crypto.randomBytes(32).base64url`) in an **httpOnly, SameSite=Lax,
  Path=/** cookie (Secure in prod; off when `NODE_ENV==='test'` for local http). The DB stores only
  the token's **SHA-256 hash** in a `sessions` table (`token_hash` PK, `player_id`, `created_at`,
  `expires_at`, `user_agent`; 30-day TTL). No `cookie-parser` — a tiny header parser in `auth.js`.
  **Dual-path (for the itch.io build):** the login/register/reset JSON body **also** returns the raw
  token, and `sessionTokenFromReq` accepts an `Authorization: Bearer <token>` header (checked first)
  **or** the cookie. The same-origin site uses the cookie unchanged; the cross-origin itch build uses the
  bearer token (see "itch.io HTML5 export").
- **Schema (migration 009 / Postgres bootstrap):** `players` gains `username`, `email`,
  `password_hash`, `password_salt`, `email_verified`, `email_verify_token_hash`,
  `email_verify_sent_at`; plus `password_reset_token_hash` + `password_reset_sent_at` (**migration 017** /
  Postgres bootstrap). Email uniqueness via a **partial unique index** (`WHERE email IS NOT NULL`).
  New `sessions` table (real FK on `player_id`).
- **Email:** Amazon SES (`us-east-1`), outbound only, from `noreply@vega.tenony.com`, sent via
  **hand-rolled AWS SigV4 over built-in `fetch`**, isolated in `server/src/ses.js` — **no `@aws-sdk`
  dep**. Reads `SES_REGION`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`SES_FROM_ADDRESS`/
  `APP_BASE_URL` from the server `.env`. **If creds are absent (local dev/tests) it no-ops**: logs the
  verification link and records it to an in-memory `outbox` (which tests assert on). **SES has
  production access** (granted 2026-06-21) — out of sandbox, so it can email arbitrary player addresses.
  **Prod is fully configured + verified** (via AWS CLI, account `140065018525`, us-east-1): account
  `SendingEnabled`/`HEALTHY`, the `vega.tenony.com` identity is verified with DKIM, and all
  `SES_*`/`AWS_*`/`APP_BASE_URL` vars are in the server `.env` — verification emails send for real
  (DKIM-signed), not the no-op path.
- **Verification flow:** register/resend generates a token, stores its hash + `sent_at`, emails a
  `/api/auth/verify?token=…` link; the route hashes + matches an unexpired token (24 h TTL), flips
  `email_verified`, clears the token, and **redirects** to `/?verified=1` (the client shows a
  confirmation). Resend is throttled per account by `email_verify_sent_at`.
- **Password reset flow:** `POST /api/auth/forgot-password` is **enumeration-safe** — it always returns
  `200 { ok:true }` and only emails when the email maps to a real account with a password (and isn't
  throttled by `password_reset_sent_at`, reusing the 60 s resend gap). It stores a hashed, single-use
  reset token and emails a **`/?reset=TOKEN`** client link (a client route like `/?verified=1`, **not** an
  API/static page; 1 h TTL). Opening it puts the `#account` modal in `reset` mode; `POST
  /api/auth/reset-password` validates the token, **rotates the password**, **marks the email verified**
  (clicking the link proves ownership) and clears both reset + verify tokens, **drops ALL of the player's
  sessions** (`deleteSessionsForPlayer`), then opens one fresh session for this device and returns the
  player row (client adopts it like login). Invalid/expired/consumed token or a <8-char password → 400.
- **Rate limiting:** in-memory per-IP fixed-window limiter on register/login/resend/forgot-password/
  reset-password (10/min); disabled
  under the test suite. Input validation: email shape, password ≥ 8 chars → 400; bad creds → 401;
  duplicate email → 409.
- **Schema** is an idempotent `CREATE TABLE IF NOT EXISTS` + guarded `ALTER`/one-shot bootstrap in
  `db.js migrate()`, plus a `migrations_pg (name, applied_at)` ledger for one-off data backfills — the
  single forward-only migration story (DECISIONS §9). Runs on every boot (`createApp()` awaits it);
  `npm run migrate` runs it standalone.
- **Catalog seeding (data safety):** `server/src/catalog_seed.js` is the single source of truth for the
  **reference tables** (`components`, `weapons`, `ships`, `maps`, `levels`). On **every server startup** the data layer
  **upserts** these rows from the seed (`INSERT … ON CONFLICT DO UPDATE`, keyed by weapon `id` / ship/map/
  level `name`) — so editing `catalog_seed.js` ships content/balance changes to prod on the next deploy.
  This is **update-and-insert, not a wipe** — with one exception: **orphaned `enemy` ships are pruned**
  (a rename/removal would otherwise leave the old enemy row lingering). The prune deletes only
  `type='enemy'` rows no longer in the seed **and owned by no player** (enemies never are), so a player
  can't lose an owned ship; other removed/renamed entries (components/weapons/maps/levels/player ships)
  still linger harmlessly. **Player data is never touched by seeding** — `players`,
  `games`, `player_ships` persist across deploys. (If we ever want the catalog editable in prod, switch to
  seed-only-when-empty + migrations for changes.)
- **Player-data reset (admin):** `server/src/reset.js` is a CLI for wiping *progress* (never the
  catalog). Two modes, in `db.js` (`resetPlayer` / `resetAllPlayers`, re-exported via `datastore.js`):
  **`--player <id>`** clears one player's games, ships, stash and events and resets level/credits/shop
  to the new-player baseline (re-granting the starter ship) while **keeping the account, login session
  and language** (per-player SQL DELETEs); **`--all --yes`** wipes every player-scoped table
  (`TRUNCATE … RESTART IDENTITY CASCADE`), leaving the catalog to re-seed on startup. Wrapped by the
  **`reset-progress`** skill (`.claude/skills/reset-progress/`). The **per-player**
  reset is also reachable by players themselves via **`POST /api/players/:id/reset`** (the settings
  "Reset my progress" control) — same `resetPlayer` op. See DECISIONS §19.
- **Headless simulation replay (`server/tools/sim-replay.mjs`):** a CLI that replays an input trace through
  `client/src/sim-core/` in Node — no browser, no renderer, no DOM.
  `node server/tools/sim-replay.mjs <trace.json> [--ticks N] [--json]` prints kills / credits / outcome, a
  world digest and the seeded-RNG draw count. It is the machinery for sealing the economy later (re-simulate
  a submitted session trace server-side instead of trusting `POST /api/games`), and its exported
  `runTrace()` is one half of the `36-sim-divergence` guard. See "The headless referee and the divergence
  oracle" below.
- Run locally: `cd server && npm install && npm start` → open **http://localhost:4000**.
- The client now **requires the API to start** (it fetches the ship/weapon catalog + active ship in
  `bootstrap()`). Since the game is always served same-origin by this server, the API is available.
  Game-history posting (`reportGame`) stays best-effort.

### itch.io HTML5 export ("Online" build)
- **What it is:** a static ZIP (index.html at its root) that runs inside itch.io's iframe and talks to the
  **live production backend** at `https://vega.tenony.com`. Players open the game on its itch.io page, play
  as a guest immediately, **and** can log into their real account — progress syncs against the same prod DB.
- **API base:** every client `/api` call is prefixed with `API_BASE` from **`client/src/api-base.js`**.
  It exports `''` (empty = same-origin relative — the normal `vega.tenony.com` deploy where client + API
  share one origin); the itch build **overwrites only the staged copy** of that file with
  `https://vega.tenony.com` **and `BUILD_SOURCE='itch'`** (same file exports `BUILD_SOURCE`, default
  `'web'`, so referrer capture can tag itch players — see Referrer capture). The shared `fetchJson` helper (`net.js`) prefixes **only `/api` URLs**
  (`url.startsWith('/api') ? API_BASE + url : url`) so bundled same-origin assets (i18n locale loads,
  `audio.js` sound assets) stay relative. No runtime hostname sniffing — the value is baked at build time.
- **Auth is dual-path:** same-origin uses the httpOnly `session` cookie (unchanged); cross-origin (itch)
  uses a **bearer token** returned in the login/register/reset JSON body, stored in
  `localStorage['authToken']`, sent as `Authorization: Bearer` by `authFetch` (`account.js`). The server
  accepts either (`sessionTokenFromReq` reads the header first, then the cookie). Guest play works
  cross-origin with no auth (gameplay/economy endpoints key off the localStorage `playerId`, not a cookie).
- **CORS:** `server/src/server.js` mounts a middleware **scoped to `/api`** that reflects the request
  `Origin`, sets `Vary: Origin`, allows `GET, POST, OPTIONS` + the `Content-Type`+`Authorization` headers,
  and answers `OPTIONS` preflight with `204`. It does **not** set `Access-Control-Allow-Credentials` (bearer
  auth ⇒ no cookies cross-origin ⇒ no CSRF), so reflecting an arbitrary origin is safe. Same-origin requests
  carry no `Origin` header and are unaffected; static client serving is untouched (CORS is `/api`-only).
- **How to build it:** `npm run build:itch` (root, `scripts/build-itch.mjs`, no new deps — system `zip`).
  It stages `index.html` + `styles.css` + `favicon.svg` + `src/` + `locales/` + `assets/` from `client/`
  (index.html at the ZIP root), excludes `*.test.js`/`node_modules`/`.DS_Store`, bakes the prod `API_BASE`
  into the staged `src/api-base.js`, **regenerates the staged `src/credits-data.js` from `CREDITS.md`** (so
  the export can't carry stale attributions), and zips → **`dist/vega-sentinels-itch.zip`** (gitignored). It asserts
  ≤1000 files / ≤500 MB and prints the file count + sizes. **Manual, not wired into CI.** Upload: itch.io
  project → Kind = HTML → upload the ZIP → tick "This file will be played in the browser" → set the embed
  viewport → save. itch limits: ≤1000 files, ≤500 MB extracted, ≤200 MB/file.

## Deployment & CI/CD
- **Live: https://vega.tenony.com** — the canonical production host and has been for a long time; the
  domain cutover is **complete**, not in transition. Hetzner VPS (178.104.91.144) shared with another
  project. The old **https://space.bagaiev.com** is a retired legacy host — it may still resolve to the
  same container (Traefik rule `Host(vega.tenony.com) || Host(space.bagaiev.com)`, a Let's Encrypt cert
  per host), but it is **not** the address we use, quote, or deploy against. Runs as a Docker container
  `spacegame_app` (1 GB mem limit) behind **Traefik** (auto-HTTPS), on
  the shared **`backend`** + **`proxy`** networks; uses the shared `shared_postgres` (DB+user
  `spacegame`). Files at `/opt/projects/spacegame/`; server-only `.env` holds `DATABASE_URL`. The
  internal `spacegame` container/image/router/dir/DB names are unchanged (renaming is cosmetic churn).
- **Single-origin serving (client + API in ONE container).** The Node server (`server/src/server.js`,
  port 4000) serves BOTH the static game client and the JSON API on the same origin: `app.use('/api', …)`
  for the API and `app.use(express.static(clientDir))` (`server.js:420`, `clientDir = ../../client`) for
  everything else. The `client/` tree is **baked into the Docker image** at build time (`Dockerfile`
  `COPY client ./client`), so there is no separate static host. The browser client calls the API via a
  **baked `API_BASE`** (`client/src/api-base.js` = `''` → same-origin relative `/api/...`; the itch build
  overwrites it with the absolute prod origin). Traefik routes the whole host (`vega.tenony.com`, incl.
  `/api`) to this one container's port 4000. Consequence for sandboxes: an `/api`-less **subpath** (e.g.
  `/v2`) served by a second container still shares this container's `/api` + DB for free, because
  `/api` carries no subpath prefix — see `docs/plans/v2-experimental-branch.md` + DECISIONS §72.
- **CI/CD:** `.github/workflows/ci-cd.yml`. On every push/PR (incl. PR merges) it runs the client +
  server test job (server tests against a `postgres:16` service container). On push to **`main`** the
  `deploy` job runs: SSH (`DEPLOY_SSH_KEY`/`DEPLOY_HOST`/`DEPLOY_USER`) → **`node scripts/assets-check.mjs`**
  (deploy guard: every model + SFX referenced in code must exist on S3) → **`assets-pull.mjs`** (pulls the
  combat models into `client/assets/ships/` + SFX into `client/assets/sounds/`, gitignored, so they get
  baked into the image) → **`rsync`** the repo to `/opt/projects/spacegame/` on the VPS → `docker compose
  build --build-arg GIT_SHA=<full-sha>` (the SHA becomes `SENTRY_RELEASE` in the image) → tag
  `spacegame:<short-sha>` for rollback → `docker rollout -w 10 app` (blue-green, below) → prune to the 3
  newest tags → **smoke check** `GET /api/health` (retries `vega.tenony.com`, falls back to the legacy
  `space.bagaiev.com` so a still-issuing cert doesn't fail a healthy deploy) → optional Sentry release
  registration (only if `SENTRY_AUTH_TOKEN` is set). S3 access is a scoped read-only IAM key
  (`vega-assets-ci-read`).
- **Server tests run against Postgres.** The `server.test.js` suite runs against a `postgres:16`
  service container in the CI `test` job (one pass). Locally, `npm test` targets
  `postgres://localhost:5432/spacegame_test`, and a `pretest` step drops+recreates that DB for a
  clean schema each run (a direct `node --test` skips `pretest`, so the suite also
  `resetAllPlayers()`-truncates up front for clean data; catalog kept). One file is the exception:
  `levels_drift.test.js` creates and drops its **own** database (`spacegame_test_drift`) so it can
  re-number `levels` without racing the shared DB.
- **Graceful shutdown:** on `SIGTERM`/`SIGINT` the server stops accepting new connections and lets
  in-flight requests finish (`server.close()`) before exiting, with an 8 s hard cap so a hung request
  can't block exit forever (`server.js`). This drains the old container cleanly when it's removed
  during a rollout, eliminating the occasional transient 502.
- **Zero-downtime deploy** (blue-green): the container has a Docker `healthcheck` (so Traefik only
  routes to it once `/api/health` passes — i.e. after migrations). The deploy uses
  `docker rollout -w 10 app`: it starts the new container, waits until it's healthy + 10s so Traefik
  picks it up, then removes the old one — no dropped requests (verified by polling during a rollout).
  Migrations run on container startup and are gated by the healthcheck (a failed migration ⇒ unhealthy
  ⇒ rollout keeps the old container). Note: deploys that *change docker-compose.yml itself* may blip once.
- **Rollback:** each deploy tags the image `spacegame:<git-sha>`; CI keeps the 3 newest (current + 2).
  `rollback.sh` re-tags a previous version to `:latest` and `docker rollout`s — zero-downtime, no rebuild.
  Migrations are **forward-only** (expand/contract), so a code rollback is safe without reversing the DB
  (see DECISIONS §9).
- **`/v2` experimental client sandbox (LIVE).** A **client-only** visual-FX sandbox at
  **https://vega.tenony.com/v2**, served by a **separate** `nginx:1.27-alpine` container
  (`spacegame-v2-app-v2-1`, compose project in `/opt/projects/spacegame-v2/`, files
  `docker-compose.v2.yml` + `deploy/v2/{Dockerfile,nginx.conf}` on the **`v2` git branch**). Traefik
  routes `Host(vega.tenony.com) && PathPrefix(/v2)` to it at **priority 100** (above the host-only
  `spacegame` router), with a `redirectregex` trailing-slash fix (`/v2`→`/v2/`) + `stripprefix` `/v2` so
  the container sees rooted paths. It joins **only** the `proxy` network — no Postgres, no `/api`. Bare
  `/api/...` calls from the v2 client have no `/v2` prefix, so Traefik serves them from the **prod `app`
  container** → v2 **shares the production `/api` + DB** (a v2 player *is* their prod account). The prod
  `app` service and router are **untouched**; v2 is disposable (`docker compose -f docker-compose.v2.yml
  down` → prod unaffected). **Hard rule: v2 changes the CLIENT only** (no server/schema/catalog/sim), which
  is what makes sharing the live DB safe (see DECISIONS §72). First bring-up was **manual** (S3
  `assets:pull` → rsync to the VPS → `docker compose -f docker-compose.v2.yml up -d --build`); a
  push-to-`v2` auto-deploy workflow is **still TODO**. Full brief: `docs/plans/v2-experimental-branch.md`.

## Client module layout (`client/src/`)
`index.html` is now just markup + the `three` importmap + `<script type="module">import './src/main.js'</script>`
— **no inline game code remains**. The client is buildless native ES modules (no bundler; `three` resolved
by the importmap). See `docs/plans/client-code-structure.md` and DECISIONS for the rationale and the
`G`-state-bag pattern.

### Simulation state is Three.js-free (`client/src/sim-core/`)
Entity transforms are **plain data owned by the simulation**, not Three.js objects. Every simulated
entity — the player, enemies, bullets, rockets, loot drops — carries:

| field | meaning |
|---|---|
| `pos` | world position, a `Vec3` from `sim-core/vec.js` (**not** `THREE.Vector3`) |
| `vel` | velocity, same type |
| `heading` | yaw in radians; nose = `(sin h, 0, cos h)`, matching `steering.headingToDir` |
| `scale` | **current** uniform world scale = `SHIP_GROUP_SCALE (1.8) × sizeScale × warp-in growth`; ships only |
| `fullScale` | the full-size `scale` to grow back into after a warp; ships only |
| `noseZ` | group-local muzzle offset — where bullets are born |

`sim-core/vec.js` is a ~40-line `Vec3` whose method names mirror the subset of `THREE.Vector3` the sim used
(`copy`/`clone`/`addScaledVector`/`setLength`/…). It reads only `.x/.y/.z` off its arguments and exposes the
same, so a `Vec3` and a `THREE.Vector3` can be passed to each other freely — that duck-typing is what lets the
renderer and the simulation meet without either importing the other.

**The duck-typing has a hard edge**, documented at the top of `vec.js`: it holds for THREE APIs that only
*read* `x/y/z` (`Vector3.copy`, `Matrix4.compose`, …) and breaks for ones that **type-test** — notably
`Object3D.lookAt(v)`, which checks `v.isVector3` and otherwise degrades to `set(v, undefined, undefined)`,
NaN-ing the camera with no error. Pass components there (`camera.lookAt(p.x, p.y, p.z)`). `Vec3` deliberately
does **not** claim `isVector3`, and `01-smoke` asserts the camera's position and orientation stay finite.

**`sim.js syncMeshes(dt)` is the one place sim state reaches the scene graph.** It runs once per tick inside
`update()`, straight after the movement steps and *before* anything render-side (exhaust plumes, FX, camera)
samples a hull pose, and copies `pos → mesh.position`, `heading → mesh.rotation.y`, `scale → mesh.scale`
(plus the cosmetic `updateBank` wing roll). It also runs at the end of `reset()`, so a still pre-fight
frame is framed correctly. **The copy is strictly one-way** — nothing in the simulation reads a mesh
back. Entities spawned later in a tick (`levelRunner` enemies, drops) seed their own mesh at spawn.

Consequences that matter:
- `collision.js` composes the ship's world matrix itself (`shipMatrix`) from `pos`/`heading`/`scale`, so hit
  tests need no scene graph and no `updateMatrixWorld()` — it was already THREE-free math (DECISIONS §45),
  now it is THREE-free *input* too.
- The **warp-in animation is simulation state**, not an animation: `warping` / `spawnAge` / `spawnDur` decide
  invulnerability, fire-hold and homing eligibility, and `mesh.scale` is merely their visible consequence.

**Model-derived simulation input is baked into the catalog.** A ship's `hitBoxes`, `broadR` and `muzzle`
all decide gameplay — what a shot connects with, and where it is born — so `shipModelCfg` lives in
`sim-core/ship-config.js`, not next to the Three.js loader. `muzzle`/`exhaust` (the group-local nose/tail
offsets) used to be *measured* off the `.glb` at load time; they are now baked into each ship's `model:{}`
block by **`npm run assets:muzzle`** (`scripts/assets-muzzle.mjs`), which reuses `assets-hitboxes.mjs`'s
normalization and owns its own `muzzle:auto:*` marker span so the hitbox fit is never re-run. `entity.noseZ`
is read from the catalog at build time. **Adding a ship model means running `assets:muzzle`** — without it
the entity falls back to `1.6` (the primitive cone's nose) while the hull's nose is elsewhere, silently;
`server/src/catalog_muzzle.test.js` fails per ship to catch exactly that.

**A fight is a `World`.** `sim-core/world.js` `createWorld({ host })` owns one running fight: `player`,
`enemies`, `bullets`, `rockets`, `drops`, the event queue, and `arenaCenter`/`arenaDrift` (the combat zone's
centre is simulation state — the soft boundary, warp-back and mini-map all measure from it). `state.js`
creates this tab's World and re-exports its collections under their historical names, so client code that
reads `enemies`/`bullets` is unchanged. The reason it exists: `state.js` cannot load in Node (it reads
`window.localStorage` at import), so the simulation can never reach module singletons — collections have to
arrive as an argument, and one process can then hold many Worlds.

**What the World holds.** Besides the entities and the event queue: **`allies`** — the friendly ships that
are not the player (**empty in every shipped level**; the Sentinel wingman arrives only when a phase says
`ally: true`), `arenaCenter`/`arenaDrift`, the home
`station` (`{ pos, active, obj }` — `pos` is captured once at build because it never moves, and docking
distance decides the mission win), `catalog`, `input` (`{ keys, touchAim }`, the shape `replay.js` records),
and the run state — `kills`, `enemyTotal`, `earned`, `earnedXp`, `banked`, `combatElapsed`,
`enemyShieldRefills`, **`allyKills`** (diagnostic: the wingman's share of this run — in neither the digest
nor the summary), `activeMission`, `roam`, `returnToBase`, `replayMode`, `missionZone`, `autopilot`.
**All of it is still reachable as `G.<name>`**: `state.js` defines getter/setter proxies (`G.player`,
`G.baseStation`, and the thirteen run-state fields in one loop), so there is one copy and no call site had
to change. What stays genuinely on `G` is the client's own: graphics tier, scene handles, the account, UI
callbacks, `paused`/`gameStarted`/`mapOpen`, and the HUD banner.

**The tick has two halves, and the first one lives in `sim-core`.** `sim.js` `update(dt)` = `simTick(dt)`
then `renderTick(dt)`, and it keeps that name and signature because the fixed-step accumulator, the replay
stepper and the `?debug` hooks all call it. `simTick` is a one-line bind of **`sim-core/tick.js`
`simTick(world, dt)`** — the module a server runs — which advances the combat clock and then calls, in this
order: `stepPlayer`, **`stepAlly`**, `stepEnemyAI`, `stepBullets`, `stepRockets`, `stepEnemyDeaths`,
**`stepAllyDeaths`**, `stepDrops`, `updateLevelRunner`, `stepPlayerDeath` (`stepAlly` returns immediately
when `world.allies` is empty — the friendly side moves before the hostile side reads its position — and
`stepAllyDeaths` sits after the projectiles that caused the damage, exactly like the enemy death step). It draws nothing, plays nothing and fetches nothing; it returns the
Grab's current target, the one thing the host wants back (the pull beam is drawn around it). **Call order is
execution order** — deaths after the projectiles that caused them, spawning after the deaths that free its
slots, the player's death check last. `renderTick` is the picture: `syncMeshes`, the event drain, the drop
beam, the FX-pool ageing, `settleView`, the set-piece animations. `sim.js` is ~630 lines and holds no rules:
the browser host, the event adapter, `syncMeshes` + the cosmetic wing-bank, the FX ageing, the DOM readouts
(banner, OOB warning, return arrow/hint, roam nav), music, pause, the scene half of `reset()`, and thin binds
of the sim-core entry points other modules import by name from it. **A rocket's detonation is likewise split**: `sim-core/spawn.js detonateRocket` applies
the hull-relative blast damage (within `blastR`) and emits `detonate`; the adapter draws the fireball and
plays the bang. Disposal is `despawnAt`'s job either way — a rocket that reaches `maxRange` leaves the world
without ever detonating.

**Loot drops are split the same way.** `sim-core/drops-sim.js` owns the Grab — arming (`ARM_DELAY` in the
field), the weight-scaled pull, the collect at `COLLECT_DIST` — and fills `world.pendingLoot`, which the
victory path drains. Reach is **emergent**: a drop is eligible while the inverse-square field crosses
`FIELD_CUTOFF`, never a stored radius. `drops.js` keeps the crate model, the rarity halo, the cosmetic spin,
the blue beam and the catalog weight lookup, and provides `attachDropBody`/`detachDropBody` to the host.
A collect emits `pickup`; the adapter plays the blip and writes the event-log line.

**Firing is simulation, sound is not.** `fireMount`/`updateGroups` live in `sim-core/ship-entity.js` and
emit a `fire` event ({ weaponClass, isRocket, fromPlayer }) instead of playing anything; the adapter in
`sim.js` decides that only the player's own shots are audible (enemy fire is deliberately silent — rocket
detonations still sound). **`updateGroups`/`fireMount` take a three-valued `side`** (`'player' | 'ally' |
'enemy'`) rather than an `isPlayer` boolean, and the split matters: the PROJECTILE's `fromPlayer` means
*"fired by the friendly side"* (player **or** ally) while the `fire` EVENT's means *"it was YOUR shot"*, so
the wingman's guns are silent. Only an enemy draws the reload jitter (`side === 'enemy'`), which is what
keeps every recorded trace bit-identical. A second flag `fromAlly` rides the projectile purely so an ally
kill can pay nothing; it never crosses the wire. Target selection is `sim-core/targeting.js`:
`findTargetInSector` for the rocket seeker, and **`nearestHostileTarget`** — who a HOSTILE ship is fighting,
the nearer of the player and the allies — both pure scans over the World's combatants. With no ally,
`nearestHostileTarget` returns `world.player` verbatim.
`ship-build.js` keeps a World-bound `updateGroups` wrapper. **`G.player` is a getter/setter onto
`world.player`** — one object, two names, no duplicated state.

**A BEAM group has its own tick.** The first statement in `updateGroups`' loop is
`if (isBeamGroup(g)) { updateBeamGroup(...); continue; }` — one side-agnostic branch, so player, ally and
enemy all get the weapon and a ship without one never takes it. `sim-core/beam.js` owns the whole mechanic
(charge state machine, the hull-aware corridor predicate, the hitscan resolve) and reads **every number off
`g.mounts[…].weapon`** — `maxRange`, `chargeTime`, `corridorDeg`, `power`, plus `g.reload` for the
lock-out — so two ships can carry differently-tuned beams. It **never calls `simRandom()`**, so the
player/ally paths still consume zero gameplay randomness (§73). Attribution follows §134 unchanged:
`lastHitBy = 'ally' | 'player'` for credit/XP on the friendly path, and the hostile path reuses
`resolveHostileBulletHit` (so the shield catches it on the bubble, §76) with a **`null` dodge roll**.
It emits exactly **two events per shot** — `beamCharge` (**ship**, pos, dur, weaponClass, fromPlayer) and
`beamFire` (from, to, hit, absorbed, weaponClass, fromPlayer). **`ship` is the SHOOTER, an entity REFERENCE
rather than a value** (one of the two in `EVENT_ENTITY_REFS`): a remote client never ticks that ship's fire
group, so without a name for the hull its corridor is underivable. The emit is side-agnostic — the player's
own charge carries the same field — and the renderer, not the simulation, decides whose sight it becomes.
The "only your own shots are audible" rule is **unchanged**: both beam sounds are gated on `ev.fromPlayer`,
exactly like `fire`, and **a hostile charge is silent**. The discharge BOLT is drawn whoever fired it; the
PLAYER's charge clock is still gated on `fromPlayer`, because his sight is a single always-on corridor — a
hostile's has its own per-shooter pool.
`step-ally.js`'s two aiming predicates were narrowed from `type !== 'rocket'` to **`type === 'bullet'`**
(`gunSpeed`, `isBallistic`) so a wingman carrying a beam plus a kinetic never leads the beam group by the
other gun's projectile speed — a hitscan must not be led. Provably identical for every catalog row that
exists today, asserted in `step-ally.test.js`.

**Ships are built as data too — the player included.** `sim-core/ship-entity.js` resolves a catalog ship
row into a fighting entity — `resolveWeapon`, `resolveComponents`, `buildMounts`, `buildGroups`,
**`makePlayer`**, `makeEnemy`, `spawnEnemy` — reading the catalog off `world.catalog` rather than a module
singleton. `buildPlayer` in `ship-build.js` is now `makePlayer(world.catalog, active)` plus a mesh, the same
split every other entity already had, which is what lets a headless referee build the exact ship a recording
was made with. `ship-build.js` keeps thin wrappers bound to this tab's World (so `resolveComponents(refs)` /
`spawnEnemyShip(def)` are unchanged for callers) plus `attachEnemyBody`/`detachEnemyBody` for the host. **`makeEnemy` draws from the seeded stream exactly
three times — facing, spawn angle, spawn distance, in that order.** Every recorded trace replays against
that sequence, so new draws are appended, never inserted (DECISIONS §73). Gameplay constants
`BULLET_PLANE_Y` and `SPAWN_GROW_TIME` live in `sim-core/consts.js`; `state.js` re-exports them.

**"Has this entity left the World?" is a fact the entity carries.** `despawnAt` sets `alive = false` on
whatever it removes. Nothing should test the scene graph for it — `shield-fx.js` used to check
`enemy.mesh.parent` to decide a pooled bubble's ship was gone, which broke the moment the host started
releasing meshes (and would be meaningless on a server, where no mesh exists).

**The host gives an entity its body.** A bullet in the browser needs a mesh; on a server it needs nothing.
So the sim announces lifecycle — `world.host.onSpawn(kind, entity)` and `onDespawn(kind, entity)`, where
`kind` is `'enemy' | 'bullet' | 'rocket' | 'drop'` — and the browser host (installed by `sim.js` at module
load) attaches/disposes Three.js objects while `noopHost` does nothing. This is **not** the event queue:
events describe what happened, carry copies and drain in a batch at end of tick, whereas the host must run
at the exact moment an entity appears or disappears. `sim-core/spawn.js` owns the data half of firing
(`makeBullet`/`makeRocket`/`makeSpiralVolley` + `spawnBullet`/`spawnRocket`/`despawnAt`); `projectiles.js`
keeps `attachBulletBody`/`detachBulletBody`/`attachRocketBody`/`detachRocketBody`. Note a rocket carries
`weaponClass`, not a resolved sound — the client looks the sound up when it detonates — and disposal
belongs to `despawnAt`, never to `detonateRocket` (a rocket that reaches `maxRange` leaves the world
without ever exploding).

**The simulation talks through an event queue.** `sim-core/events.js` (`createEventQueue()`; this world's
instance is `world.events`, re-exported as `simEvents` from `state.js`) is the sim's only outbound channel.
Instead of playing a sound or writing the DOM mid-tick, the sim appends an event and the adapter at the
bottom of `sim.js` drains them once per tick into FX, audio, HUD and `net.js`. **Twenty-five types**, all
catalogued at the top of `events.js`: `hit`, `bulletImpact`, **`hullHit`**, `shieldHit`, `enemyShieldHit`, `shieldReady`,
`fire`, `evade`, `beamCharge`, `beamFire`, `pickup`, `smoke`, `detonate`, `kill`, `allyDown`, `warpFlash`,
`banner`, `bannerClear`, `missionArrival`, `baseArrival`, `missionZoneEnter`, `cleared`, `finishing`,
`win`, `death`. **`hullHit`** (`ship`, `target`, `pos`, `dirHeading`, `weaponClass`, `toHull`) is emitted
only when a PROJECTILE's damage reached a ship's HULL (`toHull > 0` — a shield that broke and spilled
counts); beams deliberately do not emit it, and `ship` is the third entity REFERENCE in `EVENT_ENTITY_REFS`
(the VICTIM, whose own materials flash). The catalogue
is documented in `events.js`. Two rules hold: events carry **copied** values (the drain happens after the
tick, when a bullet has moved on and a killed enemy is already spliced out), and anything player-facing
carries an **i18n key plus params**, never translated text. `levelRunner.win()` keeps the rules (the ×2
credit double, the XP bonus) and emits `win`; the overlay and the `bankRun`/`depositLoot`/`unlockNextLevel`/
`reportMissionCleared` block belong to the adapter, still gated on `!G.replayMode`. Engine exhaust is
**state**, not an event: the sim sets `ship.thrusting` and `syncMeshes` drives the plume. Note
`stepSmokeTrail` runs *after* the drain — it rebuilds the instanced puff pool from `smoke[]`, so it must
see this tick's puffs.

**What lives in `sim-core/`:** `vec.js`, `consts.js` (including `SHIP_GROUP_SCALE`, `BULLET_PLANE_Y`,
`SPAWN_GROW_TIME`, the soft boundary's `ARENA`/`OOB_WARN_DELAY`/`OOB_RETURN_TIME`, and `TICK_HZ`/`SIM_DT` —
the fixed sim step both hosts must agree on or they are not running the same simulation, DECISIONS §118;
`bench.js` re-exports it as `BENCH_DT`), `events.js`,
`world.js`, `spawn.js`, `ship-entity.js`, `ship-config.js`, **`ship-classes.js`** (the `SHIP_CLASSES`
weight-class table — mass tiers as data; each row owns its explosion-blast profile), `targeting.js`, `drops-sim.js`,
`system-map.js`, `digest.js`, **`beam-config.js`** (`withBeamGun` — the pure, unconditional "swap the gun
mount for the Charged beam" transform behind `?beam`; host-neutral because a netsim ROOM has to apply the
same swap and cannot read `location.search`), the wingman — **`ally-config.js`** (his loadout + every `ALLY_*` tuning
constant + `withAllyAt`, the non-mutating "this phase carries an ally" helper) and **`ally.js`**
(`makeAlly`/`spawnAlly`) — **`lancer-config.js`** (the `?lancer` dev injection: `withLancersAt`, the
non-mutating "this phase's pool becomes 100% pirate lancers, concurrency clamped to 2" helper; it touches
`spawn.total` and `advanceWhen` for nothing, because `advanceWhen: { kills: N }` is CUMULATIVE and lowering
a total below its phase's threshold hangs the level) — and the whole tick — `tick.js`, `step-player.js`, **`step-ally.js`**,
`step-enemies.js`, `step-projectiles.js`, `level-runner.js`, `reset-world.js` — plus the game's pure rules —
`components.js` (`deriveDrive`/`shipMass`/`repairTick`/`shieldRecharge`/`applyShieldedDamage`),
`steering.js`, `spawn-timing.js`, `collision.js`, `level-sim.js`, `drops-config.js`, `autopilot-config.js`,
**`beam.js`** (the Charged beam's whole mechanic — `isBeamGroup`/`beamGroupOf`/`beamWeaponOf`,
`beamMuzzle`/`corridorEnds`/`inCorridor`/`beamCandidate` and the `updateBeamGroup` tick; side-agnostic and
RNG-free, with every number read off the weapon row) and `sim-random.js` (the seeded gameplay stream,
DECISIONS §73). Their unit tests moved with them.

**`sim-core/boundary.test.js` enforces the folder's contract** rather than trusting it: every non-test
module in here is scanned and the suite fails if it imports `three`, imports anything outside the folder,
references `window`/`document`/`localStorage`/`sessionStorage`/`navigator`/`location`/`alert`, or calls
`fetch()`. It then **dynamically imports each module**, so it also fails on a named import that does not
resolve — ESM only rejects those at link time, which is how a wrong-sibling import once left 424 unit tests
green and the game booting to a blank page. Those are exactly the properties that let the same file run as
the Node authority and as the headless referee; one stray import would break that silently and surface weeks
later.

**Starting a run is two sim-core calls with the host's scenery rebuild between them.** `reset()` in `sim.js`
clears the FX pools, then calls `sim-core/reset-world.js` `clearAndPlaceRun(world)` (empty the entities
through the host, discard uncollected loot, drain the event queue, resolve the run's centre via `runCenter`
and set `arenaCenter`/`arenaDrift`), then rebuilds the map's set-pieces and the ghost battle, then calls
`startRun(world, { keepPlayer })` (place the ship, restore hull/shield/fire-groups, zero the run counters,
start the level script or arm the roam). **That order is load-bearing in both directions:** the rebuild
READS `arenaCenter`/`arenaDrift` (drifting maps pin their decor to the zone centre) and it REPLACES
`world.station`, because the home station is a set-piece — so the roam gate that makes the station clickable
has to arm the new object. A headless authority has the same shape.

**The level runner runs on the World.** `sim-core/level-runner.js` holds the phase/wave script's rules
(`startLevel`, `updateLevelRunner`, `enterPhase`, `shouldAdvance`, `clearMission`, `finishMission`, `checkArrival`,
`winLevel`) and its state lives on `world.levelRunner` (`level`, `phaseIndex`, `killsAtPhaseStart`,
`spawnedThisPhase`, `spawnCooldown`, `won`, `winPending`, `winText`, `winTextKey`, `returningToBase`).
`sim.js` still exports an object called `levelRunner` whose properties proxy onto those fields and whose
`start`/`update`/`win` delegate, because `main.js`, `mainwindow.js`, `settings.js`, `account.js`,
`replay.js` and three visual scenarios read them by name.

### The headless referee and the divergence oracle

**The game's rules run in Node.** `server/tools/sim-replay.mjs` replays an input trace through `sim-core`
with no browser, no renderer and no DOM:

```
node server/tools/sim-replay.mjs client/assets/recordings/level0-intro.6674d840.json
```

replays the canonical Level-0 trace 3490/3490 ticks — 4 kills, 125 credits, arena cleared. It builds the
catalog straight from `server/src/catalog_seed.js` (with `enemyTotal` stamped on by `enemy_total.js`, as the
server does before serving it), places the home station from the map descriptor (docking decides a mission
win, so the station is simulation state), builds the exact ship the trace recorded, and steps
`sim-core/tick.js`. It reports `won false / returning true`, which is correct: winning needs the docking
autopilot, and a trace records keys and touch, never a mouse click — in the browser `?playback&finish` fakes
that click, which is browser-only machinery a referee has no business reproducing. `runTrace(trace, …)` is
exported, which is also the machinery for sealing the economy later (re-simulate a submitted session trace
server-side and decide the reward there, instead of trusting `POST /api/games`).

**`sim-core/digest.js`** reduces a World to one FNV-1a hash over its full-precision state plus a readable
summary. Positions are hashed unrounded on purpose: both hosts run the same code over IEEE doubles in the
same order, so bit-identical is the correct expectation and rounding would hide an early divergence.
`sim-random.js` counts its draws (`simRandomDraws()`, reset by `seedSim`).

**`36-sim-divergence` is the standing guard.** It replays the same trace in a real browser (plain
`?playback`, no `&finish`) and in Node, and requires the digest, the summary AND the draw count to match —
`hash=0x8d802ca2`, `draws=38`, 3670 ticks each. The draw count is the half that names a culprit: a cosmetic
path reaching into the seeded gameplay stream (DECISIONS §73) shifts one host's stream and not the other's,
and the test says so rather than reporting an opaque hash difference. `22-trace-replay` guards the browser's
end-to-end replay path; this one guards the simulation.

### Playing in a server-run room (`?netsim=1`)

**Opt-in and additive.** Open the game with `?netsim=1` and the level is simulated by a server ROOM: this
tab sends input and draws what comes back, and calls `simTick` never. Without the flag nothing below runs
and single-player is exactly what it was — that is DECISIONS §116, not an accident. `&seed=N` pins the
room's RNG so a session is reproducible.

**The room banks its own run (DECISIONS §131).** `createRoom({ onEconomy })` fires **once** per run, on the
simulation's own `cleared` (win condition held — credits already doubled, mission XP added, §130) or `death`
(whatever was earned before it), carrying credits, XP, kills, duration and the collected loot.
`makeEconomySink({ playerId, level, bankRun })` in `socket.js` does the writing (`recordGame` +
`depositLoot`); the room itself never touches the database, which is what keeps it clock-free and testable
with a spy. **`playerId` comes from the redeemed handshake ticket and is applied last**, so no field on the
run can substitute another account. A `banked` guard makes a duplicate event, a second death or a reconnect
unable to pay twice; `restart()` re-arms it (a retry is a new run); a run that just STOPS — disconnect,
abandoned tab — is worth nothing, and crates still in the hold on death are lost. Client-side `G.netDriving`
(written every frame by the loop) stops this tab banking a run the room is banking, and
`refreshAfterRoomBank()` re-reads the account so the HUD catches up. **Scope, stated plainly: credits, XP and
loot are sealed only for fights a ROOM ran.** netsim is opt-in, so browser single-player still banks through
`POST /api/games` on trust; that is a choice (D1), not an oversight. Campaign progression (`/advance`) also
stays a client call — not currency, and it must reload the next level into the tab either way.

**Which level the room fights.** A bare `?netsim=1` means **the level this tab is already on**
(`CATALOG.levelName`). It must: the client builds the map, the set-pieces and the arena centre at take-off,
so a room running a different level spawns its enemies around a different centre, in a world the player is
not looking at. `?netsim=level-2` overrides it deliberately. A **side mission** is refused — its descriptor
is generated per player by `missions.js` and appears in no room's level table — and the tab falls back to
simulating locally with a console warning, rather than quietly fighting the campaign level instead.

**Joining and starting are separate.** The socket is established as soon as the catalog names a level —
during the menu — and the room does **not** step until the client sends `start`. Connecting lazily at
take-off cost ~2.6 s of a ship that did not answer, and connecting-and-starting early would spawn enemies
into an empty hangar. `connectNetsim` also waits for the socket to be OPEN before returning a handle: a
`WebSocket` is constructed in CONNECTING, where `send()` is a silent no-op, so an early handle swallowed
the first message sent through it.

**The room follows the run, in level and in freshness.** `start` is keyed to `G.gameStartTime` — the
per-run stamp `reset()` sets — not to `G.gameStarted`, which stays true between fights and used to make a
room begin while the player was reading a briefing. That key **survives a reconnect**: advancing a level
reconnects the room, and forgetting the run there made the next fight start under the victory overlay.
Both `start` and `restart` carry the ship's **pose** when the run began without moving it
(`world.runKeepPlayer`, set by `reset({ keepPlayer })`) — a mission flown into opens around the ship,
mid-flight, instead of teleporting it to the arena centre. A new run sends **`restart`**: the room empties its
world and starts the level script again inside the same socket, with the tick counter still climbing (the
client drops any snapshot not newer than the last one applied, so rewinding it would make the next run
invisible). A change of LEVEL reconnects instead, since the room is built around one.

**netsim defers, per frame, and says why.** `netsimDeferReason({record, playback, sideMission})` returns
`'replay'`, `'side-mission'` or null, and the loop consults it every frame — deferring drops the link and
reconnects once the reason clears, rather than disabling netsim for the tab.
- **`'replay'`** — `?record` and `?playback` replay the local simulation deterministically and own the tick.
  Without this a replay ran a second, invisible fight against a server room that kept simulating.
- **`'roam'`** — free flight is not a room fight. A room only knows how to run a level and starts one when
  told, so roaming with a room live meant the campaign level was being fought on the server while the player
  cruised: no fly-in countdown, and the roam nav bar over the combat HUD. Shared roam is a non-goal (plan §6).
- **`'side-mission'`** — a side mission's descriptor is generated per player by `missions.js` and appears in
  no room's level table, so a room has nothing to fight.
**Both reasons arrive AFTER the socket is open**, which is why the check cannot live at connect time: the
socket opens during the menu, the mission is chosen after, and deciding once let a room start the campaign
level under a side-mission run. `window.__netsim.deferredBy` reports the current reason.

**Server side — `server/src/netsim/`:**
- `room.js` — one World, one player. Deliberately **clock-free**: `stepOnce()` advances one tick,
  `takeSnapshot()` builds one message, and who calls them is somebody else's problem. That is what lets the
  load-bearing test drive a room from a for-loop and require the same digest the headless referee produces.
  It assigns network ids through the World's **host** (in a `WeakMap`, so nothing is written onto a sim
  entity), holds a bounded input queue (240 ticks; overflow drops the OLDEST and is reported in the
  snapshot), and repeats the last input when the client goes quiet — a network gap holds the controls
  rather than releasing them.
  **Input catch-up:** the room retires an extra input on a tick while the queue is deeper than
  `INPUT_QUEUE_TARGET` (3). It consumes one per tick and a client produces ~60/s, so the two balance only on
  average — a single bursty client frame (up to six ticks at once) otherwise leaves a backlog that never
  drains and shows up as 130–180 ms of standing input lag. The skipped input's `dt` is never simulated, so
  a live room is intentionally NOT bit-identical to a trace replay when the client is bursty; the
  determinism test feeds at the natural rate and asserts nothing was fast-forwarded.
  **A room can run the WINGMAN.** The simulation is shared, so an ally written in `sim-core` is already
  server-controlled inside a room — there is no second implementation. What is extra is the wire:
  `createRoom({ … , ally })` takes the PHASE NAME he arrives on (`sim-host.createSimWorld` applies
  `withAllyAt`, which COPIES rather than mutating the shared seed), `describe()` gains a **`kind: 'ally'`**
  spawn descriptor (`name`, `shipClass`, `color`, `fullScale`, `maxHp`, `sizeScale` — the client resolves the
  model from the name plus its own catalog, and `color` is the only thing it cannot derive), and the snapshot
  gains an **`allies`** rows array with **the same column order as `enemies`**
  (`id, x, z, heading, hp, scale, warping, shieldValue, shieldRecharge`). The `kill` event gained `byAlly` on
  the wire, or a room's client would write his kills into the player's own event log. `socket.js` reads
  `?ally=<phase>` off the handshake; the client's `?ally` dev flag forwards it (`wsUrl`/`connectNetsim`).
  Both are inert without the param — a room with no ally sends `allies: []`.
  **THREE dev params now ride the handshake, and the rule behind them is general: a dev flag that changes
  the FIGHT has to reach the room, or the two ends simulate different worlds.**
  `?ally=<phase>` and **`?lancer=<phase>`** take the same hops (`socket.js` → `createRoom` →
  `createSimWorld` → `withAllyAt` / `withLancersAt`); **`beam=1`** is a boolean rather than a phase and goes
  one step further, into `buildShip`, where the player's EFFECTIVE loadout is resolved — applied there and
  not to the account row, because a failed account lookup falls back to the catalog default and an upstream
  swap would have silently done nothing in exactly that case. The headless referee
  (`server/tools/sim-replay.mjs`) passes none of the three, so a re-simulated trace is unchanged.
- `driver.js` — the 60 Hz clock, with the browser's same bounded catch-up (6 steps) so a stalled event loop
  cannot spiral into fast-forwarding the fight.
- `protocol.js` — the wire shapes and an **explicit event allowlist**. It exists because two events carry a
  live entity reference; a test parses the catalogue at the top of `sim-core/events.js` and fails
  if a new event type is not wired, so an unhandled event cannot be silently dropped.
  **`EVENT_ENTITY_REFS` lives in `client/src/sim-core/events.js`, not here** (DECISIONS §136): `protocol.js`
  imports and re-exports it, and `netsim-world.js hydrateEvent` loops over the SAME table on the way back
  in. One table, two readers — the client cannot import from `server/` (the browser is served `client/`
  alone), so the alternative was a server-side table shadowed by a hardcoded `enemyId` line on the client,
  which is how the next reference gets forgotten on the way back. Today it holds two entries:
  `enemyShieldHit: ['enemy']` and `beamCharge: ['ship']`. **Positional fields
  are vec-serialized from an explicit `VEC_FIELDS` set (`pos`, `from`, `to`)** rather than by the field
  literally being named `pos` — otherwise the beam's two endpoints would cross as whatever
  `JSON.stringify` makes of a `Vec3` *instance*, which is `{x,y,z}` today only by accident of the class's
  field layout. `netsim-world.js hydrateEvent` rebuilds all three as real `Vec3`s on the way back in,
  because the FX layer calls `.clone()` on them.
  **The Charged beam adds exactly two events and nothing else** — `beamCharge` (`pos`, `dur`,
  `weaponClass`, `fromPlayer`) and `beamFire` (`from`, `to`, `hit`, `absorbed`, `weaponClass`,
  `fromPlayer`). Both carry the class so the adapter routes each sample through `SOUND_MAP` instead of
  hardcoding `'beam'` — a second beam row with its own class then gets its own swell and crack. `beamCharge`
  carries **one entity reference, the SHOOTER** (`EVENT_ENTITY_REFS.beamCharge = ['ship']`, serialized as
  `shipId`), which is what lets a client draw a REMOTE shooter's aiming corridor for a fight it never
  simulates — the second half of DECISIONS §135's gate, proven end to end by
  `client/visual/scenarios/41-enemy-beam-netsim.mjs`. `beamFire` carries none and needs none: the sight
  entry ends on its own `dur`, which IS the sim's `chargeTime`. There is still **no per-tick charge
  broadcast and no snapshot column**: a charge is per-ship state that changes every tick and an aiming
  corridor is per-ship geometry. The corridor's WIDTH is this weapon's lag compensation, which is why it needs no
  rewind. `digest.js` is untouched (it hashes transforms/counts/draws, not group state), so the
  determinism hashes do not move. **Known room behaviour:** the player's idle sight still draws (the
  locally-built `world.player` keeps its `groups` and its transform is overwritten per snapshot), but the
  client has no ticked `g.charge` — which is exactly why the brightening rides the `beamCharge` event.
  **That only tells the truth because the ROOM agrees about the weapon**, which is why `?beam` is forwarded
  on the handshake: while it was a browser-only loadout swap, the local copy had a beam group and the server
  flew the account's real machine gun, so the tab drew a green aiming sight and a lock reticle over a ship
  that was firing kinetics. A sight derived from a loadout the authority does not share is exactly the lie
  the three lines exist not to tell. Fixed 2026-08-25. The
  reticle's corridor scan runs over ghost enemies, which do not always carry hitboxes, so it falls back to
  the broad sphere: accurate enough for a sight, and deliberately not "fixed" (§30).
- `tickets.js` + **`POST /api/ws-ticket`** — single-use, 30 s, in memory. A browser cannot set
  `Authorization` on a WebSocket handshake and `Origin` is not a security control, so the socket is gated by
  a ticket minted over the ordinary HTTP API and spent at `/ws?ticket=…` (plan §5).
- `socket.js` — one socket, one room, with an idle timeout, a room cap and teardown on close.
- `server/src/sim-host.js` — the World factory the room and `server/tools/sim-replay.mjs` **share**: a
  referee and a room that built their worlds differently would be two simulations again.

**Client side:**
- `netsim.js` — the flag (`evalNetsim`, URL-only and never sticky), the handshake, and an uplink that turns
  real time into whole 60 Hz input ticks and batches 3 per message. It speaks `replay.js`'s recorded-tick
  shape, because the client already produces exactly that for session recording and the referee already
  consumes it.
- `netsim-world.js` — reconciliation and interpolation. **THREE-free on purpose**, so it is unit-tested
  under `node --test`, including a test that drives a real room into a real client World in-process.
  An **ally ghost** is built by the simulation's own `makeAlly` (there is no second, render-only ally), lands
  in `world.allies`, and rides the generic per-id apply — so its interpolation, health bars and despawn
  timing come for free.

**The client grows no second rendering path.** It keeps the same World, written by the network instead of by
`simTick`. Ghosts arrive through the same `world.host.onSpawn` local spawns use — so a networked enemy gets
its mesh from the same code — and wire events are pushed onto `world.events`, so the network is just another
producer of the stream `sim.js`'s adapter already drains into FX, audio, i18n and the HUD. Nothing
downstream knows or cares where the fight is being decided. A **ship is named, not described**: the client
holds the same catalog and resolves the model, yaw, lift and scale from the name, which also keeps dozens of
collision OBBs per hull off the wire.

**Click-to-fly is a command, not local state.** The room owns the autopilot, so `engageAutopilot` and its
siblings forward the intent through **`world.onCommand`** (a sink alongside `world.host`; null in
single-player, where the same verbs act locally). A clicked DROP travels as its network id. The snapshot
returns the room's autopilot state so the HUD can show what the ship is doing. Without this the client set
a flag on a World nobody steps: the station could not be clicked, drops could not be collected, and since
winning requires docking under an engaged station autopilot, **no mission was completable**.

**A room flies the player's REAL ship**, read from the account server-side by the ticket's `playerId` —
loadout, components, skills, and the account record itself (`world.activeShip`), which the simulation reads
to decide whether the last-kill reward drop should appear at all: without it a room offered a reward the
player already owned. It used to build the catalog default for everyone, so a netsim run
ignored everything the player owned. Reading it from the DB rather than from the client also means a client
cannot claim a better ship than it has.

**ONE CLOCK.** Snapshots go out every `SNAPSHOT_EVERY = 2` ticks (30 Hz) and frames render at 60–120, so the
world is drawn as it was `INTERP_DELAY_MS` (100 ms — **three snapshot intervals**) ago. The timeline is made
of **server ticks, not arrival times**: `state.clock.offset` is the wall-clock instant tick 0 is due, slewed
toward each packet's observation by `CLOCK_FOLLOW` (2%) and taken outright past `CLOCK_RESYNC_MS` (250 ms,
i.e. a changed relationship — a paused room — rather than a jittery link). `tickAt(state, now)` gives the
fractional tick of an instant; `renderNet` draws everything at `tickAt − delay`, bracketed by the two samples
around it (`bracket()` compares `sample.tick`). Delivery jitter therefore moves nothing.

**Everything is interpolated; nothing is extrapolated.** Enemies, drops, bullets, rockets and the local ship
all take the same path. Past the newest sample the world **holds still** rather than guessing — a wrong guess
that has to be taken back reads worse than stillness, and it is what every comparable system does. Health,
the warp flag and both shield pools are STATE, not motion: taken from the newer sample outright, never
blended. Headings interpolate the short way around the circle. The local ship is interpolated with no smoothing of any
kind: a spring lags the interpolated pose by its own time constant, which puts the ship behind its own muzzle
while it drifts sideways, and bullets are interpolated at exactly the same tick. **There is no client-side prediction** — the ship answers the controls ~100 ms
later, which is the trade this game chose (DECISIONS §127).

**Spawn and despawn are events on the render timeline too.** A described entity is built and starts
collecting samples the moment its packet lands, but is only put in the World (`attachGhost` → `host.onSpawn`)
when the render clock reaches the tick it was born on — otherwise it stands frozen at its spawn point for the
whole interpolation delay, which was a stutter at the birth of every bullet and rocket. An entity that stops
being listed is retired when the clock reaches its **last sample** (not the snapshot that failed to mention
it, which would leave it standing still for an interval first), so a ship is still on screen for its own
explosion. One that lived and died inside a single interpolation delay is simply forgotten, never shown.

Absence from a snapshot IS the despawn — a snapshot is a complete statement about the world, and a lost
"despawn" message would leak a mesh.

**Events ride the clock too.** Every wire event carries `tk`, the tick it happened on; `applySnapshot` queues
it and `renderNet` releases it when the render clock reaches that tick, before the frame's own drain so FX
and audio reach the adapter alongside the poses they belong to. Played on arrival instead, an event fires
against a world a tenth of a second younger than the thing it describes — a rocket's smoke laid ahead of the
rocket, an explosion after its ship has gone. The queue is capped at `MAX_EVENT_QUEUE`; past it the oldest
are released at once, so an event can be late but never lost.

Measured on the `?netjerk` harness (60 s of fight, delivery jitter captured from real play): **6 breaks in
the drawn motion, none on a packet frame**, against 7476 (half of them on packet frames) for the four-clock
design this replaced. Rationale and sources: `docs/plans/netsim-one-clock-rendering.md`, DECISIONS §127.

**The drawn-motion probe** (`client/src/netsim-jerk.js`). **On by default on a local dev host**
(`localhost`/`127.0.0.1`) — a diagnostic that has to be remembered is off during the run that mattered, which
happened twice. `?netjerk` forces it on anywhere (a deployed build, a phone); `?netjerk=0` forces it off. It
never touches the picture. It reads the poses `renderNet` writes and records every discontinuity together with the delivery
fingerprint at that instant: whether a packet was applied on that frame, the arrival gap, the tick gap, and
the time/tick span between the two samples the object is drawn from. `__netsim.jerk.report()` returns the
tally (`byKind`, `byCause`, arrival-gap and frame-time percentiles, the nose-step and step-change
percentiles, and the ten worst events by both absolute turn and size-relative-to-cruise); it also warns once
a second while playing. **The ship dying POSTs the whole record to `/api/netjerk`**, which writes it
to `.netjerk/` on the dev machine (gitignored; the endpoint exists only when the server was started with
`NETJERK_SINK=1`), with a browser download as fallback — or `__netsim.saveJerk()` by hand. The file holds: every packet arrival, every frame the tab lost, every break with its context, and a
lifecycle timeline (socket dropped, run restarted, room idle, delivery stalls over 200 ms / 8 ticks). `byCause` is the point: a break on a frame that applied **no** packet is
the client drawing a curve as a straight line, not a network fault.

**THREE separate questions, never merged** (`window.__netsim`: `roomIdle`, `flying`, `drawing`) —
DECISIONS §128:

| flag | question | false when |
|---|---|---|
| `roomIdle` | should the ROOM step? | there is no live fight — between runs, in the hangar, after a death |
| `flying` | should this tab send INPUT? | a menu, the system map, or a hidden tab |
| `drawing` | should this tab RENDER? | an explicit pause or the map — **never** a death |

Conflating the first two froze the game on the death screen (the explosion, the overlay and the banking all
happen in `renderTick`, draining the room's events, so a tab that stopped rendering died at the moment it
had the most to say). Conflating the first and third froze it on coming back to a tab, in production.

**Diagnosing a stall.** `server/src/netsim/driver.js` warns on the server when a pump arrives more than
`STALL_LOG_MS` (100 ms) late (`[netsim] the room was not stepped for N ms`) and, separately, when the
stepping itself takes that long — the first means the process was busy elsewhere, the second that the room
is slow. The warning carries a reading from `netsim/health.js`: Node's event-loop-delay histogram (its own
resolution subtracted, so idle reads ~0) plus the machine's load average and core count, which is what
separates "the OS descheduled us" from "we blocked ourselves". The same reading is stamped onto every
`?netjerk` dump the sink receives, so one file holds both sides. `node server/tools/watch-machine.mjs
[--seconds N]` prints load and the greediest processes once a second for the length of a playtest. `node server/tools/netsim-load.mjs [--level L] [--seconds N] [--port P]` drives a real room from a
synthetic client and prints the arrival-gap distribution, which is how "is it the room or the browser?" gets
an answer without a human playing.

**A room steps whenever there is a live fight, and stops for nothing else.** Not for a menu, not for the
system map, not for a hidden tab, not for the pause button — **a running simulation is not stopped by what
one tab is doing** (DECISIONS §128, superseding §123's pause). It idles only where there is no fight at all:
between runs, in the hangar, on a death or victory overlay. The badge reads `room idle` then.

The cost is deliberate: **leave a fight and you are still in it, being shot at.** What the room will not do
is fly the ship for you. It repeats the last input across a short gap — one late packet must not stutter a
held key — but past `INPUT_HOLD_TICKS` (30 ticks, half a second) it **releases the controls**, so a ship
whose player walked away coasts to a stop on its own drag instead of running on a held thruster into the
arena wall. Liveness is the transport's: the server pings every `PING_EVERY_MS` (10 s) and a frozen tab
answers from its network stack without running a line of page JavaScript, which is what the previous
render-loop keep-alive could not do.

**When the player dies the fight winds down**, in `sim-core` so both hosts share the rule: the tick you die
on completes, and from the next one a dead ship neither flies nor fires, the level stops spawning, and the
enemies cut their engines and hold fire, coasting to a stop on their own drag. Single-player never sees it
only because `update()` stops its loop first.

**Pause is real here.** The pause button and the system map both stop the ROOM (`pause` / `resume` messages
stop and restart its driver), because a room holds one player and a local-only pause would be a lie — the
overlay saying "Paused" while the fight ran on and the ship kept taking hits. A paused client sends no
input, so it heartbeats every 5 s; otherwise the 30 s idle reaper would end the session. See DECISIONS §123.

**Loot works, and reaches the stash.** The Grab runs in the room and collects as it always did; a clicked
crate is fetched by the drop autopilot (as a command, above). The collected items come back in the
snapshot's `run.loot` and are mirrored **in place** into the client's `world.pendingLoot`, so the victory
path deposits them exactly as in single-player — the client is still what banks a win. Nothing filled that
list before, so every crate picked up in a room was silently lost at the victory screen. The special
last-kill reward deposits nothing by design (the real copy is installed server-side on victory).

**Client-side prediction (Slice E).** The local ship is not drawn from snapshots — it is SIMULATED locally
and corrected. `netsim-predict.js` holds a shadow World containing nothing but the player (no enemies, no
level script, no host, events discarded) and steps it with **the real `stepPlayer`** — predicting with a
second, simplified movement model is how prediction rots, and sharing the code is the whole reason
`sim-core` exists. Every rendered frame it re-seeds the shadow from the newest authoritative player block
and replays the input the room has not acknowledged (`ack` on every snapshot; the uplink keeps the recent
ticks), so the ship answers the controls at once rather than a round trip later. Re-simulating from scratch
each frame rather than stepping incrementally makes the whole thing idempotent — there is no accumulated
local state to get out of step. Verified against a real room: 120 ticks of thrusting and turning agree to
1e-9. It **stands down** when the ship is not the player's to author — an engaged autopilot is flying to a
target the shadow does not have, and a dead ship is not being authored — where the snapshot is simply the
better answer. Convergence uses a much shorter time constant while predicting
(`VIEW_TAU_PREDICTED_S`): smoothing exists to absorb the server disagreeing, and must not also smooth the
player's own input, which is already correct.

**What it does not do yet.** Bullets are still spawned by the room, so a shot appears when the snapshot
carrying it does rather than on the keypress (the roadmap's "don't stream bullets" — the next slice). No lag compensation (D5), so aim-assist selection resolves against the
server's present rather than what the client saw. No reconnect, no second player, no delta encoding, and
the economy is still banked by the client's own `POST /api/games`. The Grab's pull beam draws from the target id the room reports (only the room knows what is being pulled). A failed handshake **falls back to simulating
locally** rather than leaving a ship that will not answer.

**You can SEE which simulation is running.** With `?netsim` on, a small badge sits under the wordmark:
green `NETSIM ● room · level-N` while a room is driving, amber `NETSIM ○ local · <reason>` otherwise
(`replay`, `side-mission`, `disconnected`, `no room`, `connecting…`). It exists because the flag is URL-only and
not sticky, so it is easy to be on the local path without noticing — three playtests in a row reported
"netsim feels great" while actually local, which is the report that cannot be acted on. Never shown without
the flag.

**Losing the room is not fatal, and never permanent.** A DELIBERATE teardown (a replay taking over, a side
mission, a level change) detaches the socket's handlers before closing, so it cannot be mistaken for the
socket dying — it used to be, and every planned hand-off to the local sim therefore disabled netsim until a
page reload. An UNEXPECTED close (server restarted, network gone) hands the **current run** to the local
simulation, which simply carries on from the World the room left populated, and the **next run reconnects
by itself**. There is no permanent failure state: retrying mid-fight would swap the simulation out from
under the player, and retrying every frame would hammer the endpoint, so the retry waits for a new
`G.gameStartTime`. Verified by killing the server mid-fight: the badge turns amber, thrust still flies the
ship, and a fresh run comes back green on its own.

**Diagnosing it.** `window.__netsim` is attached whenever the flag is on — `?debug` or not, because the
first question about a server-run fight is always "am I connected". It reports `connected`, `tick`, `ack`,
`behind` (how far the room's acknowledgement trails the input sent), `welcome` and `lastSent`, and
`__netsim.pause()` / `.resume()` freeze the world on its last known state.

**Guards.** `client/src/netsim-world.test.js` covers reconciliation in Node; `server/src/netsim/*.test.js`
cover the room, the protocol allowlist, the tickets and the socket end to end — including that a room asked
for `?lancer` really runs lancers and that **every hostile `beamCharge` crosses the wire with a `shipId` the
client was already told about by a `spawn`** (with a control asserting a room without the flag runs the
shipped fight); and `37-netsim` proves the wiring in a real browser — the room flies the ship, its enemies arrive with bodies, pausing the room freezes
the world (which is how a local sim secretly running underneath would be caught), and a pixel diff with the
hull hidden proves the ship is actually on screen.

---

This is Slices A–D of `docs/plans/server-authoritative-sim.md` — one simulation, two hosts (browser for
single-player, Node for multiplayer, the headless referee and now a live room). Nothing about single-player
gameplay changed across the whole refactor: the recorded Level-0 intro trace replayed bit-identically at
`tick=2503/3490` through every commit of it. The oracle reads **`tick=2474/3490`** now — moved once, on
purpose, by removing auto-aim (DECISIONS §124), which changes where bullets go.
- **Pure, Three.js-free logic (unit-tested):** the rules-bearing ones now live in `sim-core/` (see above);
  the rest stay in `src/`. `components.js` (catalogs + `deriveDrive` + `shipMass` +
  `hitsToKill` + `repairTick`), `drops-config.js` (the loot-drop constants incl. the single `DROP_MODEL_URL`,
  plus the pure `pullSpeed`/`pickLoot` — import-free so `scripts/assets-check.mjs` + node tests can use it),
  `system-map.js` (star-system geometry + navigation: `bodyWorldPos`/`listBodies`/`SYSTEM`/`ANCHORS` +
  `capLifted`/`inActivityZone`/`arrivedAtPoint` — the replay-safety seam, unit-tested),
  `speed-field.js` (the speed-field pure seam: `wrapCoord`/`scatterLayer`/`wrapLayerPositions`/`SPEED_FIELD_LAYERS`,
  unit-tested; THREE assembly lives in `world.js`),
  `steering.js` (`headingToDir`, `shortestAngleDelta`, `steerToward`,
  `enemyThrustFactor`, `inForwardSector`), `i18n.js` (`t`, `resolveLanguage`, `normalizeLang`,
  `loadLanguage`), `audio.js` (procedural Web Audio engine + the pure settings helpers, engine
  browser-only), `format.js` (`esc`/`cssColor`/`slotLabel`/`priceLabel`/`sellLabel`), and
  `speed-field.js` (the backdrop speed field's defaults/ranges, `wrapDelta`/`wrapField`, the scatter
  helpers, `normalizeSpeedField` and the `?dev` tune load/save — the THREE side lives in `world.js`).
- **Shared state & engine:** `state.js` (entity collections + `CATALOG` + input + the mutable `G` state
  bag for reassigned cross-module scalars: `gfx`/`rotated`/`player`/`sky`/`stars`/… + the run/account
  scalars `kills`/`earned`/`balance` + the backend/funnel scalars `playerId`/`banked`/`gameStartTime`/
  `gameStartSent`/`quitSent`/`pendingBriefing` + the selection scalars `activeShip`/`currentShipName`/
  `activeMission` + `SPAWN_GROW_TIME`), `engine.js` (`renderer`/`scene`/`skyScene`/
  `camera`/lights + orientation + zoom), `engine-lights.js` (the fixed, tier-gated pool of real
  `THREE.PointLight`s on engines/rockets/blast flashes — the frame itself lives in `main.js animate()`, there
  is no render-path module; it **re-exports `blast.js`**, so every existing import path keeps working),
  `blast.js` (three-free, and unit-tested for it: the `BLAST` constants + the `blastClass`/`blastPower`/
  `blastReach`/`blastDurMul` classifier that turns a ship's weight class into how bright/far/long its death
  flashes), `dom.js` (the single
  fail-loud `el` inventory of shared
  index.html nodes — HUD readouts + the result `overlay`; a missing id throws on boot).
- **Domains (browser-only, touch the scene):** `world.js` (arena + sky/star-system bodies
  (`buildSystemBodies`/`updateSystemBodies`)/the baked nebula cube + the additive parallax backdrop layer
  (`buildBackdropLayer`/`updateBackdropLayer`/`setBackdropAmp`)/player-locked speed field
  (`makeSpeedField`/`updateSpeedField`/`disposeSpeedField`/`speedFieldLayers`)/set-pieces + `buildMap`), `systemmap-ui.js` (the shared navigation
  component `mountSystemNav` + the `openSystemMap` overlay + the "Start mission?" prompt), `map-view.js`
  (the PURE pan/zoom transform behind that map — `toScreen`/`toWorld`/`panByScreen`/`zoomAtScreen`/`pickAt`,
  with the zoom + centre clamps), `ship-factory.js`
  (`makeShip`/`applyShipModel` + `gltfLoader`), `projectiles.js`
  (bullets/explosions/exhaust/rockets/smoke FX), `ship-build.js` (catalog resolution + `buildPlayer`/
  `buildPlayerFor` + enemy spawning + fire groups), `drops.js` (loot drops + the Grab tractor sim: the
  `drops[]`/`pendingLoot` arrays, `spawnDrop`/`updateDrops`/`collect` + the pooled blue pull line + the
  victory `takeLoot`/`clearDrops`), `sound-routing.js` (the `audio` engine instance + `tracksFor`/`sfxFor`),
  `hud.js` (the per-frame draws `updateHud`/`updateMarkers`/`updateMiniMap`/`updatePerf`), `net.js`
  (backend identity/banking/progression + funnel telemetry: `fetchJson`/`bankRun`/`track`/
  `currentLevelLabel`/`unlockNextLevel`/`depositLoot`), `sim.js` (the per-frame `update(dt)` — now a short TABLE
  OF CONTENTS that calls the module-local per-section steppers in execution order: `stepPlayer` (repair/
  shield, manual-vs-autopilot control, speed cap, arena drift + soft boundary, exhaust, firing),
  `stepEnemyAI`, `stepBullets`, `stepRockets`, the FX steppers `stepMicroExplosions`/`stepSmokeTrail`/
  `stepSparks`/`stepShockwaves`/`stepBannerFade`/`stepCreditPopups`, then `stepEnemyDeaths` and
  `stepPlayerDeath`; the already-one-line delegations (`updateFlipbooks`/`updateDeferredBlasts`/
  `updateShipExhaust`/`updateDrops`/`levelRunner.update`/`settleView`/the set-piece loop) stay inline, and
  every stepper lives in `sim.js` — the call order IS the tick order — + `levelRunner`
  (with the extracted `resetLevelRunnerState` shared by roam) + wing-bank + soft-boundary warp/OOB warning +
  the roam speed-cap gate (`capLifted`/`activityZones`) + autopilot incl. `engagePointAutopilot`/roam-point
  arrival + music routing `refreshMusic` + pause `setPaused`/`togglePause`/`autoPauseOnBlur` + the `reset`
  restart (roam-aware) + `settleView` (camera + the fixed star-system backdrop + speed-field)), `spawn-timing.js` (the pure enemy-spawn stagger gate
  `stepSpawnGate`/`nextSpawnDelay`, unit-tested; driven by `levelRunner`), `level-sim.js` (a pure headless
  replay of the staggered level runner + the `isLastKillDrop` reward-drop predicate: `levelEnemyTotal`/
  `simulateLevel`, unit-tested — proves the killed/total counter reaches `enemyTotal` and the drop fires on
  the last kill), `beam-fx.js` (the Charged beam's LOOK — the three-line green sight, the diamond reticle,
  the muzzle bead, the pooled discharge bolt (the impact flash rides the shared `bulletImpact` path, not
  this module), **and the pooled charge-only HOSTILE sight**
  (`beamHostileSight*`, `#ff6b4a`, four entries, one per charging enemy); `drawBeamSight`/`startBeamCharge`/
  **`startHostileBeamCharge`**/`spawnBeamBolt`/`hideBeamFx`, all cosmetic and RNG-free), `beam-dev.js` (the
  `?beam` dev flag — `evalBeamDev`/`beamLoadout`, URL-only, never sticky, a strict no-op when absent; wired
  into `ship-build.js buildPlayerFor`, and **forwarded on the netsim handshake** (`beam=1`) so a ROOM mounts
  the same weapon — the pure swap itself lives in `sim-core/beam-config.js` (`withBeamGun`) precisely so both
  hosts can apply it — **and the `?lancer` flag beside it**: `evalLancerDev`/`lancerDev`/
  `lancerDevLevel`/`applyLancerDev`, which swaps a phase's spawn pool for pirate lancers. The two params
  compose (`?beam&lancer&level=4` is your beam against theirs) and are read independently; `?lancer` is
  forwarded on the netsim handshake so a ROOM runs the same fight, exactly as `?ally` is), `hit-fx.js` (**the receiving end of a shot** — the hull flash, the model punch and the camera shudder, plus
  the `?dev` "Hit feel" panel; `hullFlash`/`punchShip`/`cameraShudder`/`updateHitFx`/`applyCameraShake`/
  `resetHitFx`/`buildHitFxPanel`, all cosmetic and driven by the `hullHit` event),
  `hit-fx-config.js` (**THREE-free**, so `node --test` can load it: the `HIT_FX` tunables plus the pure
  seams — `impulse01` (instant out, eased back), `makeImpulse`/`refreshImpulse`/`ageImpulse`
  (refresh-never-accumulate + the salvo cooldown) and
  `tracerLook` (the per-class + per-shot bolt look, with the random source INJECTED); same split pattern as
  `exhaust-config.js` ↔ `exhaust-fx.js`),
  `tune.js` (the dev-only `?tune` palette panel `buildTunePanel`).
- **Between-battles UI:** `shop.js` (hangar shop + stash + live ship-stats bar; a leaf the Main Window
  calls into), `shop-slots.js` (the pure slot↔weapon-type rule extracted out of `shop.js` so it can be
  unit-tested — `GROUP_WEAPON_TYPE` (`gun: ['bullet','beam']`, `rocket: ['rocket']`), `isWeaponSlot`,
  `slotAcceptsWeaponType`; `shop.js` imports three, so nothing in it loads under `node --test`, and this
  rule is the player's only real path to the Charged beam), `shop-markers.js` (pure state logic for the gold "(new)" trail — gated refs, the whole
  bootstrap decision `primeSets` (first-sight baselines, the newly-gated-kind absorb, the prune that
  re-arms after a reset), the derived unseen sections; no DOM/storage, unit-tested by
  `shop-markers.test.js`), `settings.js` (audio-settings gear modal + graphics-quality picker + slide-to-confirm
  progress reset; a leaf whose only outward export is `localizeSettings`), `mainwindow.js` (the Main Window
  — `showMain`/`selectMenu`/the right-column mission list/`launchCampaign`/`launchMission`/`refreshMissions`/
  `enterRoam` (the one roam entry) + the real Map section + the mission-arrival `G.onMissionArrival` handler
  + the briefing-item model viewer; it owns no ship viewer any more), `welcome.js` (ship-picker/`takeOff` + the i18n UI glue
  `applyTranslations`/EN-RU switch + the fullscreen helper), `account.js` (auth block + `initSentry` +
  `restoreSession`/`reloadPlayerWorld`). These four (`mainwindow`/`account`/`welcome` + `settings`/`shop`)
  form the coupled landing-screen cluster — `mainwindow`↔`account`↔`welcome` is a runtime import cycle that
  ESM resolves (edges fire on user actions, not module init).
- **Composition root:** `main.js` (~630 lines) — imports + input/touch/zoom wiring + the `?dev` `devPerf`
  monitor + `animate`/`prewarmShaders` + the `?debug` `window.__game` test hook + the `?bench`
  `window.__bench` record/replay perf hook (`bench.js`) + the `?record`/`?playback` input-replay
  record/playback (`replay.js` pure core + `window.__replay`) + `bootstrap()` (fetch the DB
  catalog/level/active-ship, build the world + player, restore the session, show the landing screen).
- **Input-replay:** `replay.js` — the pure, DOM/engine-free half of `?record`/`?playback` (URL-flag parsing,
  the `{version,seed,dt,shipId,level,loadout,components,skills,tickCount,runs}` trace shape + its run-length codec
  (`packTicks`/`unpackTicks`/`sameInput`/`hydrateTrace`/`traceTickCount`), per-tick input snapshot/apply
  (the touch aim is quantized in `snapshotInput`), validate, the
  `makeReplaySession()` lifecycle object **incl. the `&finish` auto-finish + the return-home watchdog
  counters + `RETURN_HOME_STALL_TICKS`**, and **`stepReplayTick()`** — the ONE per-tick body both drivers in `main.js` run
  (the `animate()` accumulator and `window.__replay.step(n)`), dependency-injected so this module stays
  DOM/engine-free; unit-tested in `replay.test.js`).
- **The scripted Level-0 intro:** `intro-director.js` — the pure, DOM-free, engine-free state machine behind
  the playable intro's five spoken lines and its controls card (`makeIntroDirector(script)` → per-sim-tick
  `tick()` commands + a `view`; the script is data on the `level-0` descriptor). It imports nothing, so
  `node --test` loads it (`intro-director.test.js`); `main.js` owns the single instance, ticks it from
  `stepReplayTick`'s `onTick` and writes `#intro-line`/`#intro-help` from `updateIntro()`. (It replaced
  `level0-cutscene.js`, deleted with the cutscene.) The seeded-RNG isolation is its own leaf module,
  **`sim-random.js`** (`simRandom`/`seedSim`/`isSimSeeded` + `mulberry32`, imports nothing, unit-tested in
  `sim-random.test.js`) — `main.js` only installs/clears the seed. The remaining engine wiring (accumulator
  pacing, the record/playback UI) is in `main.js`. See the record/playback subsection under Tools.
- Because the client uses ES modules, it must be **served over http** (not opened as `file://`).

## Tests (built-in `node:test`, no deps)
- **Look constants** — `client/src/graphics.test.js`: the `post` knob per tier (High `{lights: 16}` /
  Balance `{lights: 4}` / Performance `null`, and a weaker tier may never carry MORE per-fragment lighting
  than a stronger one); a guard that **no `samples`/`superSample`/`bloom`/`glowScale` knob comes back** (AA is
  the canvas's own MSAA again — a composer threw that away and supersampling was rejected for buying it back
  at 2.25× the fill); the **hull emissive floor ships at 0** and can never be raised to a self-lit hull
  without failing here first; and the parallax backdrop's geometry sanity (`radius + offsetMax` inside
  `camera.far` 1300, near wall outside the camera-locked star sphere, `amp > 0` so the layer is never
  silently invisible, `0 < follow < 1`). **No unit test may import `world.js` or `ship-factory.js`** —
  `node --test` cannot resolve the browser importmap's `three`, which is exactly why these constants live in
  `graphics.js` (and why the visual scenarios can import that one file directly).
- **Client logic** — `client/src/*.test.js`: the **ship weight class** (`blast.test.js`: every catalog ship
  states a class that is both declared in `SHIP_CLASSES` and actually tuned, and the three classes the
  fallback ladder names as literals keep their blast block; a golden table pins each ship's
  peak/reach/duration so the class-driven answer stays byte-identical to the old `sizeScale` one on both the
  boss and the non-boss call path; the fallback degrades for an unknown/untuned class instead of throwing;
  and the `× size²` / `× size` scaling is asserted to still live at the `projectiles.js` call sites),
  drive derivation (engine + mass, incl. the grab slot + the
  mass-neutral 48+2=50 baseline), balance, repair-drone
  regen (`repairTick`: per-interval heal, multi-tick, 80% cap, no-op cases, mass), **shield**
  (`absorbDamage` partial/exact-break/overflow-spill + `shieldRecharge` no-op-while-active / bank-dt /
  refill-to-full-at-rechargeSec / no-overshoot + the `applyShieldedDamage` `{ absorbed, broke, toHull }`
  contract, **including the break-with-spill case the hit FX turn on** — 80 damage into a 20-point shield
  returns `{ absorbed: true, broke: true, toHull: 60 }`),
  **hit feel** (`hit-fx-config.test.js` — the rules that are REQUIREMENTS rather than tunables: `impulse01`
  starts at FULL with no ramp-in, is 0 at/after its duration, decreases monotonically and DECELERATES into
  rest; a second hit RESETS the impulse instead of summing with it and can never exceed 1; the salvo
  cooldown accepts exactly one of three refreshes 10 ms apart and accepts again once it expires; and
  `tracerLook` returns EXACTLY the class base at zero jitter (the "0 restores the old look" contract), with
  the injected `rand` proving the symmetric bounds. The "did it reach the hull" rule is deliberately NOT
  mirrored here — it is not a pure function but what the six emit sites decide, so it is guarded where it
  lives: the `toHull` contract in `components.test.js` and the real break-with-spill rocket in
  `42-hit-feel`),
  **the scroll affordance** (`scroll-hint.test.js` — `hintState` is the whole decision the briefing
  chevrons make: a panel whose text fits shows neither; clipped at the top shows DOWN only; the middle
  shows both; the very end shows UP only; sub-pixel slack (2 px) never lights a chevron pointing at
  nothing; and a not-yet-laid-out panel — `clientHeight` 0 while its view is `display:none` — shows
  nothing),
  **the intro director** (`intro-director.test.js` — the eight rules the playable Level-0 intro rests on,
  driven with a synthetic sim clock at 1/60 s: `l0` on the first tick, opaque for `lineHold` then a linear
  fade to nothing at `lineHold+lineFade`; the card's `idle → hold → fly → done` walk with exactly one command
  per transition; `l1` on `kills+alive === 2` whatever the split; `l2` two seconds AFTER the second kill, not
  on the kill tick; `l3` on the 4th spawn and `l4` on `cleared`; a new beat REPLACING a mid-fade line in the
  same tick; **the restart re-arm** — feeding `t = 0` after a finished run empties `fired` and speaks `l0`
  again; and every beat firing at most once however long its trigger stays true. Plus, in
  `sim-core/level-runner.test.js`, the SIM half of that timeline: `spawn.earliest` holds a spawn until the
  floor, the released enemy still gets a plain 2–4 s `spawnDur` (the floor must never leak into the warp-in),
  an index beyond the array is unfloored, `finalStageBanner: false` suppresses the banner, and the shipped
  `level-0` descriptor's floors match its own beat timings; plus **the mission-finish soft-lock** (§143): the
  button re-engages after the flight home was interrupted, the one-shot settlement — `collectAll` + the
  `finishing` event — happens exactly once across both presses, arriving hand-flown closes a mission the
  player already finished, and the guards that must NOT have loosened: an uncleared level can still be
  neither finished nor closed by proximity, a chest-aimed autopilot still cannot win, and a won mission does
  not re-open),
  **enemy shields** (`enemyShieldSplit` is integer/exact and sums back to the catalog durability for every
  enemy hull; **damage-to-kill is LOSSLESS** — for all 6 durabilities × 5 per-hit powers the kill takes exactly
  `hitsToKill(d, perHit)` hits and `dealt − overkill === d`, the invariant the recorded intro depends on;
  overkill in one hit; exact-break leaves the hull untouched and clears the timer; a 3×40 spiral volley deals
  its full 120; a partial shield never recharges while a broken one refills; and the derived shield is
  **weightless** so mass/acceleration/turn rate are unchanged), **loot drops**
  (`drops.test.js`: `pullSpeed` distance-aware anchors + weight fallback, `field`/emergent-`range` cutoff
  boundary (range(20)/range(10)=√2), `pickLoot` only draws
  engine/thruster/weapon ids — **never the hull**), steering math,
  i18n (`t()` resolution/fallback/interpolation, language resolution order, browser-lang mapping), and
  **audio settings** (`clamp01`, `loadAudioSettings`/`saveAudioSettings` round-trip + defaults + garbage
  handling, `effectiveGain` master×channel×toggle), **seeded sim RNG** (`sim-random.test.js`: same seed → same
  sequence, re-seeding rewinds, no seed installed → the native `Math.random`, and `seedSim(null)` really returns
  to live play — the teardown invariant), and the **return-home watchdog** (`replay.test.js`: `noteTick`
  counts/resets, `stalled()` trips exactly at `RETURN_HOME_STALL_TICKS`, `teardown()` clears every field), the
  **shared per-tick body** (`replay.test.js` `stepReplayTick`: the entry guard stops a finished playback dead
  **but the post-intro teardown state `rs.play=null && rs.done=true` keeps stepping** — the live-play gate;
  an exhausted trace sets `rs.done` and never steps; a normal tick applies the recorded input, calls `update`
  once with the passed `dt` and advances the index by one; `rs.returning` releases every key and freezes
  the index; the order is `update` → `capture` → `onTick`; live/record mode applies no trace input yet
  still captures; **`&finish` presses the button exactly once on the tick the sector clears and stops on the
  win, and does nothing at all without the flag**; and the watchdog trips exactly at
  `RETURN_HOME_STALL_TICKS`, or never while the level is won), and
  **character progression** (`client/src/progression.test.js`: the client XP-curve mirror agrees with
  `server/src/progression.js` for every level/threshold checked, and `liveProgress` fills, crosses a
  threshold, rolls through several levels in one haul, and no-ops without earned XP;
  `components.test.js` `skillEffects`: empty=identity / one step per point /
  independence / negative-clamp; `collision.test.js` dodge: `dodgeRoll` gates damage, is consulted **only
  after a geometric connect** (a miss never rolls → replay determinism), and skips shield absorption on an
  evade; `progression.test.js`: the curve, cumulative thresholds, derived level, and unspent-points math),
  and **the wingman** (`sim-core/step-ally.test.js`: target selection by distance to the ALLY, the
  finite-vs-`Infinity` leash, the snap cone, the "never fire through the player" rule, both retreat
  thresholds needing BOTH conditions, the pass arming at >120°, and — the regressions this file exists for —
  that he flies the **player's** movement model (speed climbs past the enemy drag-limited 4.8 u/s and
  settles at `PLAYER_MAX_SPEED`, and slowing is LINEAR at his own accel rather than an exponential drag),
  that the come-about **brakes and turns together** and re-accelerates the instant the nose arrives, that the
  escort judges the **closing** speed on a MOVING player (formation → thrust; convergence from 60 u closes
  inside 20 u — both halves fail against the ground-speed rule), that crossing 25 % hull **breaks the charge
  on that very tick** (the inverse of the retired "low health never interrupts a charge") and that the
  threshold and the shield clause are exactly as specified,
  that **he DIES and is gone for the rest of the mission**, that a **RETREATING ally is still a valid enemy target** (the 2026-08-23 veto), and
  that 600 ticks of a fight with an ally draw **zero** seeded randomness, that the break-off is measured **from
  the threat** (the gap to the enemy grows, it works when he is already past the retired centre-relative
  70 u, he settles at `ALLY_BREAK_OFF_DIST`, he outruns a pursuer flying at the fastest Level-4 enemy's
  15.75 u/s — though the gap first CLOSES during his ~2.7 s reversal, which is recorded rather than guarded —
  and with no enemy he escorts instead of flying off), that his nose is **aimed so the BULLET
  lands** (the shot points at a stationary enemy while he drifts 15 u/s across the line, the correction is a
  strict no-op at zero velocity, the solvability bound and its fallback, and **an enemy is left alone** —
  nose still on the player, flaw and all), and that he **dies** cleanly: out of
  `world.allies`, `alive` false, one `allyDown` event carrying no reward, and `kills`/`earned`/`earnedXp`/
  `drops` all untouched; `ally-dev.test.js`: the `?ally` flag's URL-only parsing, the `level` param, the two
  composing, and that `withAllyAt` never mutates the level it is given), and
  **the Charged beam** (`sim-core/beam.test.js`, 28: the **hull-aware corridor in both directions** — a
  target 4° off the nose at 45 u is hittable because an EDGE line crosses its hull even though its centre
  bearing is outside ±2° (the same test asserts that bearing, so it states the difference from a
  centre-based test rather than re-encoding the implementation), while one 10° off is not; the three drawn
  endpoints leave the MUZZLE and span exactly ±`corridorDeg`; **escape is real at the shipped numbers** —
  a 15.75 u/s crosser starting on the centre line at the weapon's own 100 u reach drifts the full 15.75 u
  through the 1.0 s charge and ends **8.95°** off, against a 6.09 u effective window — and the test asserts
  it is still WITHIN reach at 101.2 u, so it provably escapes by ANGLE, not by falling out of range. A
  second case pins what doubling the charge broke: a mere 5 u/s crosser at 20 u stayed inside the ~3.30 u
  window at 0.5 s and is outside it at 1.0 s. Plus **a charge must not survive a run reset** — driven
  against the real catalog and the real reset path: die mid-charge, restart, and the fresh run fires
  nothing the player never triggered (allies/enemies need no equivalent, because their entities are
  destroyed and rebuilt); **paint ≡
  corridor** per target; **the tap COMMITS** (one tick of trigger still discharges, damages `power` and
  locks out for `fireCooldown`, and a held trigger fires 3 times in 5 s — the 1.5 s cycle behind the
  `RoF 0.7/s` stat line, asserted together with sustained DPS staying deliberately under 60); a lock that dies or warps
  mid-charge falls back to the current candidate and a charge with nothing in the corridor still fires;
  **zero seeded draws** across a full charge + discharge (§73); **the HOSTILE path, driven directly with
  `side: 'enemy'`** and catalog-free: a hostile beam
  damages a player with `dodge = 100` (the corridor is the dodge), is caught on the shield BUBBLE with the
  drawn endpoint stopping in front of the hull, and picks player-then-allies in list order. That test is
  what made arming a pirate cheap, and it is what fails if a `side === 'player'` shortcut ever creeps in —
  mutation-verified, along with the centre-based corridor. It also asserts that a hostile `beamCharge`
  **names the SHOOTER entity** with `fromPlayer: false`, and that the player's own charge carries the same
  field — so the emit is provably side-agnostic. Then **the numbers come off the ROW**: two
  synthetic beams behave differently in one world (the regression guard for the
  spike's deleted shared `beamTuning`), and — now that two REAL rows exist — the **pirate lancer** is built
  from the real catalog and asserted to hold weapon 13 in a single-mount group with `reload` **2.0**, the
  `BEAM` preset's `ai.range` 50 / `aimTol` 0.12, and a drawn corridor of **67 u, not the player row's 100**.
  A further case pins the two BALANCE numbers in the units the maintainer chose them in, because both are
  reachable by accident from several directions: the enemy row's **cooldown 2.0 → a 3.0 s cycle → exactly 15
  DPS** (with the player's 0.5 asserted untouched beside it), and the lancer's derived **50°/s ± 0.1**,
  its mass **31** and its **unchanged 30.6 acceleration** — plus the contrast that the gunner and the basic
  pirate still turn >180°/s, and that 50°/s is below the player's ~96°/s bearing sweep, which is the whole
  point of the number.
  `shop-slots.test.js` is the only automated proof the beam is
  **equippable** at all (the `?beam` flag bypasses the shop); `beam-dev.test.js` covers both flags' URL-only
  parsing — that `beamLoadout` is identity with `?beam` off, that no spelling of `?beam` arms an enemy
  (the enemy half has its own param), and that `?beam&lancer&level=4` reads as both independently;
  `sim-core/lancer-config.test.js` pins `withLancersAt` — the pool swap, the concurrency clamp to 2,
  non-mutation of the shared seed, and above all that **`spawn.total` and `advanceWhen` come through
  byte-identical**, because `advanceWhen: { kills: N }` is cumulative and a clamped total hangs the level
  forever while `enemyTotal` drives the HUD and the last-kill drop;
  `step-ally.test.js` adds that a beam mount is
  never ballistic and contributes no muzzle speed, and that the narrowing is neutral for every
  bullet/rocket combination that ships today; `netsim-world.test.js` adds that a wire `beamFire` hydrates
  `from`/`to` back into real `Vec3`s, that a `beamCharge` carrying `shipId` **hydrates to the ghost that id
  names** (consuming the raw id), that an unknown id resolves to `null` rather than throwing, and that the
  player's own ref-less charge comes through with no `ship` key at all.
  Run: `cd client && npm test`. **Bench gate** —
  `client/src/bench.test.js` (`evalBench` sticky tri-state + `mulberry32` determinism, still importable from
  `bench.js` which re-exports it from `sim-random.js`) +
  `client/bench/stats.test.js` (median + bootstrap-CI verdicts: the 2% boundary is strict/FLAT, +2.5%→
  REGRESSION, −11%→IMPROVED, a `load.draws` bump flags) run under the same `node --test`; the browser A/B
  runner `node bench/run.mjs` is a separate manual command (forks Chromium + a server), **not** in `npm test`.
- **Backend API** — `server/src/server.test.js` (52): register / record game + credit banking / history /
  validation / health / serves client / ships + weapons + components + maps + levels catalog + active ship +
  player progress (current level + advance) + **progress reset** (per-player → new-player baseline, unknown→404) +
  **character progression** (XP banks into `experience` → derived level/points on the active-ship read; skill
  spend allocates + guards no-points 409 / unknown-skill 400; reset zeroes XP + skills) +
  language preference + credits balance + level briefings
  (level-2 weapon swap, level-3 repair-drone install) + repair-drone component seed + **Base shield seed**
  (component 31: type `shield`, capacity 20 / recharge 10 s) + the starter loadout carrying `shield: 31` +
  **hangar shop/stash** (lock before the first flight, unlock on reaching the `level-3` row (player-facing
  "Level 2") + basic-gun
  backfill, plus the boot existing-player backfill, buy/sell/equip/
  unequip, optional-vs-required equipped sell, take-off launch gating, no double-spend, net-zero same-id equip,
  real-price buy/sell/overspend-402, the priced player-shop ladder is seeded) +
  **Grab + loot drops** (Grab components 29/30 seeded, enemy parts priced with `buyable:false`, player starts
  with the base grab; `POST /loot` deposits collected drops into the stash + empty/absent = no-op 200; a
  looted grab equips into its optional slot and round-trips through the stash — exercises the
  `withTx`/`client` transactional deposit path) +
  **side missions** (`/missions` 403 until unlocked → 3 same-difficulty offers with the 2-boss composition;
  pirate gunner + Pirate machine gun id 9 seeded; boss guns swapped to the MG) +
  **auth** (username, register happy/duplicate-409/weak-400, login happy/wrong-401, `/me` authed vs 401,
  logout clears the session, verify-token flips `email_verified`, cross-device login adopts progress) +
  **monitoring** (`/api/config` returns `sentry:null` when unset; `/api/events` 204 allowlisted / 400
  junk / batch).
  Mounts the Express app on an ephemeral port against a `spacegame_test` Postgres DB recreated by
  `pretest` (`NODE_ENV=test`) — the real `spacegame` DB is untouched; SES uses its no-creds outbox.
  Run: `cd server && npm test`.
- **Level-id drift** — `server/src/levels_drift.test.js` (2): runs against its own throwaway DB
  (`spacegame_test_drift`, created + dropped by the file, so `spacegame_test` is untouched), re-ids the
  levels to the production drift shape (1, 6, 7, 71, 564) while no player rows exist, then asserts the
  gates: on the "Level 1" briefing (drifted id **6**) both the shop and the side-mission board stay
  **locked** (`GET /missions` → 403 — the exact production bug, where `6 >= 5`/`6 >= 3` opened both), the
  shop opens on reaching `level-2`, the board only on reaching `level-4` (`/missions` → 200), plus
  `reachedLevel`'s fail-closed case and the boot backfill (level-2 player stays locked, level-3 player
  gets the shop + basic gun). DECISIONS §95.
- **Auth unit** — `server/src/auth.test.js` (5): scrypt round-trip (right/wrong password), per-user
  salt, token uniqueness + SHA-256 hashing, cookie-header parsing.
- **The Charged beam's catalog row** — `server/src/catalog_beam.test.js` (8, two beam rows × the per-row
  loop): every `type: 'beam'` row
  carries a positive `power`/`maxRange`/`chargeTime`/`corridorDeg`/`fireCooldown`/`weight` plus a sound
  `class` (a beam reads all five off its own row every tick, and a missing field falls back silently rather
  than throwing), `corridorDeg` is a plausible HALF-angle in DEGREES, and its class routes BOTH a `charge`
  and a `fire` sample to keys that exist in `SOUNDS`. Plus the two group guards: **no seeded ship puts a
  beam in a group with any other mount** (a beam group never reaches `fireMount`, so the rest would go
  silent), **no PLAYER ship has a multi-mount group at all** (`equipItem` replaces the FIRST mount, so two
  `gun` mounts would strand a kinetic), and the six ENEMY multi-mount groups across four ships are pinned by
  name as a documented list — which is why an enemy beam gets its own single-mount group rather than a
  swapped weapon id. The first guard now asserts the beam-carrying groups **by name**: exactly
  `['pirate lancer/gun']`, so a second beam-armed ship is a deliberate edit rather than a silent one.
- **The wingman against the real seed** — `server/src/ally-sim.test.js` (25): no shipped level carries an
  `ally` phase; he arrives when his phase starts, exactly once; his loadout is **pinned against catalog
  drift** (200 HP, mass 86, accel 8.7, turn 1.16, shield 20, drone present, **no grab**, weapons 6+3,
  `maxSpeedMul` 1 so his cap is exactly `PLAYER_MAX_SPEED`); `spawnAlly` consumes no seeded draws; an ally
  kill advances `world.kills` and pays **0 credits / 0 XP** while a player kill still pays; his gun fires
  FRIENDLY (`fromPlayer`), ATTRIBUTED (`fromAlly`) and SILENT (the `fire` event says `fromPlayer: false`)
  with every projectile on the combat plane; he holds fire rather than shooting through the player's hull;
  an enemy fights the nearer of player-or-ally and its rocket homes on whoever it picked; hostile fire lands
  on the ally, shield first then hull, reported as `target: 'ally'`; `withAllyAt` never mutates `LEVELS`; and
  he **dies** paying nothing (no kill, no credits, no XP, no loot, mission not ended), a full tick keeps
  running with him gone, a fresh run brings him back, and — end to end against the real catalog and the real
  projectile step — his Heavy cannon **connects with a stationary enemy while he drifts 15 u/s across his
  own line of fire**, which is the shot that used to miss. **The per-group gates are pinned in both
  directions under real drift** (30 u/s, where the nose and the bullet line sit ~0.48 rad apart): §2.6 holds
  fire when the BULLET would cross the player though the nose is clear, and permits it when the NOSE crosses
  him but the bullet does not, with a player-far-away control proving the two differ only in his position;
  the ROCKET holds when the nose is off the true bearing even though the corrected aim reads "aligned", and
  is blocked by a player on the NOSE line in the one geometry where the gun is simultaneously clear.
  **And the reported break-off defect, end to end against the real boss loadout** (2× weapon 10 + 3× weapon 4
  = ~35 dmg/s): from 30 % hull mid-charge he breaks off **within 2 ticks** of crossing 25 % — not at the next
  pass, which is ~360 ticks away — survives if the fire then stops, **still dies if it does not**, and does
  not turn tail at 60 % hull.
- **A room runs the wingman** — `server/src/netsim/ally-room.test.js` (7): the room emits a `kind: 'ally'`
  spawn descriptor with no `hitBoxes`, its `allies` rows are the documented width, an ally room is
  deterministic across a re-run with the same seed and inputs, a room WITHOUT the flag sends `allies: []`
  and no ally descriptor, `byAlly` is on the wire's `kill` allowlist, and a room whose wingman DIES stops
  listing him, keeps stepping, and sends an `allyDown` event carrying no reward.
- The backend was made testable: `server.js` exports `createApp()` (no auto-listen; listens only when
  run directly).
- **Visual / e2e** — `client/visual/` (Playwright headless, **not in CI**): boots the real game and
  asserts on simulation state (particle counts, size ratios, exhaust colors) via a `?debug`-gated
  `window.__game` hook; saves frames to `__screenshots__/` for review (no pixel diffing). `?debug` also
  SKIPS the nebula bake so the suite's backdrop never moves — the opt-in **`nebula`** flag (`?debug&nebula`)
  turns the bake and the parallax backdrop layer back on for the one scenario that measures them, and every
  other scenario omits it and is byte-identical. Scenarios:
  smoke, ship-explosion, **exhaust-trail** (each thrusting enemy grows an **attached exhaust plume**
  (`mesh.userData.exhaustPlume`) in its engine color that fades in with thrust — the plume model, not the
  old `g.trail` pool), combat, **hangar-shop** (unlock the shop, render the bay +
  live stats, install from the stash), pause, mobile-hangar, and **arena-boundaries** (the ship flies past
  the edge unclamped, the out-of-bounds warning shows after the grace delay, `warpPlayerToCenter` recenters +
  zeroes velocity, and the edge marker + mini-map exist), and **mission-setpieces** (all three procedural
  set-pieces are built into the combat scene below the plane and multi-part; the station rotates; the
  drifting-arena mechanic moves the center/border and the synced freighter, and warp-back targets the drifted
  center), **mission-board** (after clearing the campaign the right-column mission list holds
  the campaign + 3 side-mission cards, selecting one shows its briefing in the work zone, Take off launches
  a `sideMission` via the levelRunner; it also asserts the **right-column layout** — the list is inside
  `#mw-ship-col`, no cards or ship-stats in the work zone, no `#mw-ship` canvas — and the **two-column
  collapse** on Character), **l4-enemies**
  (the Advanced medium pirate + Second Boss build with the right **total effective HP** — `hp` (hull) +
  `shield.capacity` = 300 / 550, since enemy shields split the pool — plus tint/mounts/derived drive), and
  **audio** (the settings gear opens the audio modal; the Master slider + Music toggle reach the engine and
  persist to `localStorage`; the gear hides during a live fight), **ship-bank** (the player rolls into a turn,
  capped ≤20°, eases back to level on release, opposite turns bank opposite ways, enemies have a bank group),
  and **reset-progress** (the settings modal fits the viewport with no internal scroll; the slide-to-confirm
  arms only on a near-full drag and opens the confirm dialog; Cancel snaps it back; Confirm POSTs `/reset`),
  and **triple-spiral-rocket** (firing the id-11 spiral weapon spawns exactly 1 invisible leader + 3 visible
  warheads into the `rockets` pool, and the whole volley drains to 0 after homing + detonation — the leader
  self-removes once its last child is gone, no leaked entries), and **trace-replay**
  (`22-trace-replay.mjs`: re-sims the canonical Level-0 trace on its own `?playback&…&finish=1&debug`
  url and asserts 4 kills / `won` — the guard against a seeded-stream shift rotting the fixture three
  determinism guards pin an outcome on; needs `npm run assets:pull` first, since the trace is a gitignored
  S3 asset), and
  **freighter-exhaust** (`24-freighter-exhaust.mjs`: launches the freighter mission, asserts its plume exists
  in the default `points` look, then flips the **global** mode to `flame` via `__game.exhaust.setGlobalExhaustMode`
  and asserts the flame mesh becomes visible on **both** the freighter plume **and** a thrusting ship plume).
  **enemy-shield** (`25-enemy-shield.mjs`: a basic pirate spawns as 10 shield + 20 hull with a 10 s recharge;
  no bars while both pools are full; a half-drained shield shows the blue strip at 50% with the hull bar still
  full; a broken one turns `recharging` purple and fills with the recharge progress; and an absorbed hit lights
  a pooled bubble sized to the hull — checked on the ×3-scaled second boss so a dropped `mesh.scale` factor is
  detectable — which then **expires** ~1 s of FX-clock time later **without the player ever having been hit**,
  the regression guard for the shared FX clock that used to stall until the first player-absorbed hit),
  **ship-model-cache** (`26-ship-model-cache.mjs`: two ships of one type + one of another; the pair must
  share a **geometry** set while having **distinct materials** (cloned per instance for the hit flash) and
  staying distinct scene objects, and the other type must share neither
  — i.e. each glb is parsed once and cloned, never re-parsed per spawn. Mutation-verified: bypassing the
  cache fails the shared-geometry assertion),
  **hit-feel** (`42-hit-feel.mjs`: parks TWO identical fighters side by side at an equal camera distance in
  empty space (frozen — no AI turn, no drift, no fire — so the two hulls are genuinely identical), shoots
  only one, and reads the framebuffer ONCE: **A minus B is the flash**. The crop is derived from each ship's
  own PROJECTED hull radius, so it self-adapts to the camera zoom. Asserts the pair share no material
  instance, that the two crops are indistinguishable BEFORE the hit (Δmean < 3), then that the flashed hull
  is measurably brighter on screen (**Δmean ≥ 8** of 255, and **≥ 6 % of the crop** turned genuinely bright)
  while the control did NOT brighten — which catches a shared-material regression on screen, not just by
  uuid. The second threshold is a FRACTION of the crop rather than a raw pixel count on purpose: the crop is
  derived from the ship's projected radius and `camZoom` is restored from localStorage, so the same working
  flash measures a 55 px crop in isolation and a 27 px one inside the full suite — a raw count swings with
  the zoom while the fraction holds steady (~12 % in both, against a ~1.5 % control floor).
  Also: a plain bullet flashes but never moves the model; a rocket punches it and a THREE-warhead spiral
  volley never exceeds ONE shove (refresh, not accumulate — observed on the scene graph); and the camera
  shudder is checked three ways against the same rocket — a DOWN shield shudders and settles back, a shield
  that absorbs everything (`toHull` 0) does not, and **a PARTIAL 10-point shield hit by a 20-power rocket
  BREAKS and spills 10 to the hull, which must still shudder** even though `absorbed` is `true`. That last
  one is the end-to-end guard for DECISIONS §137: rewriting the six emit sites to the naive
  `if (!dr.absorbed)` leaves the entire client and server unit suites green and is caught only here. Every
  case records its hull/shield damage deltas, so none can pass vacuously. Mutation-verified four ways:
  shared materials, a disabled flash, a disabled `applyCameraShake` and the `!absorbed` predicate each fail it),
  **session-upload-on-hide** (`30-session-upload-on-hide.mjs`: takes off into a live recorded session, plays
  past the 180-tick floor, then fakes a **backgrounded tab** (`document.hidden` override + a
  `visibilitychange` event) and asserts a `POST /api/sessions` actually goes out carrying a client id and a
  packed v2 trace, and that the recorder is **still active** afterwards — the guard for sessions from
  phones/tablets never being uploaded at all, DECISIONS §87; fail-before verified: 0 uploads without the
  listener), and **speed-field** (`31-speed-field.mjs`: launches a fight, teleports the ship **4000 units
  out** and asserts every backdrop layer's points are still inside `±half` of the **player** on **both x and
  z**, with the y column untouched and the pool size unchanged — the guard that the backdrop is
  player-locked, not camera-locked or origin-anchored; mutation-verified: wrapping on the camera position
  instead fails the z bound by the camera's +26 z offset).
  and **netsim** (`37-netsim.mjs`: opens `?netsim=1`, joins a server room, and asserts the ROOM flies the
  ship — this tab runs no sim — that the room's enemies arrive with real bodies built from the catalog by
  name, that `__netsim.pause()` FREEZES the world (the check that no local simulation is running underneath,
  the failure where the two worlds quietly fork), and that the hull is actually drawn at the screen centre
  by pixel-diffing against a frame with it hidden),
  and **sim-divergence** (`36-sim-divergence.mjs`: replays the canonical Level-0 trace in a real browser on a
  plain `?playback&debug` url **and** headlessly in Node via `server/tools/sim-replay.mjs`, then asserts the
  two hosts agree on the world digest (`sim-core/digest.js`), on the run summary and on the seeded-RNG draw
  count — `hash=0x8d802ca2`, `draws=38`, 3670 ticks each. This is the standing proof that "one simulation,
  two hosts" is true and not aspirational; the draw count is the half that names the culprit when a cosmetic
  path reaches into the gameplay stream. Negative-verified by adding one `simRandom()` call to the browser's
  tick, which fails it with the draw mismatch. Needs `npm run assets:pull`, like 22-trace-replay),
  and **ally** (`38-ally.mjs`: the one place the WINGMAN is seen in a browser — the two determinism oracles
  above deliberately exercise none of his code, because the Level-0 trace has no ally. It boots once with the
  flag OFF (`allies` stays empty — the "players see nothing" guarantee), then once on `?ally=wave-1`, and
  asserts he arrives from the PHASE, is given a body in the scene with his **blue wings** (asserted on the
  live material colours, and negatively on the player and an enemy — the accent has to be a strict no-op for
  every other ship), that `&level=` really overrides the account's progress level, flies under the
  player's cap, that his MESH tracks the simulation, and — projecting that mesh through the camera — that his
  hull is actually **inside the frame** on most samples (he is expected to leave it mid-reversal, so the
  assertion is a share, not an instant). The player never touches the controls, so every kill is his: the
  kill counter climbs and `earned` stays 0, which is the economy split end to end),
  and **charge-beam** (`39-charge-beam.mjs`: the only place the Charged beam is seen in a browser. Boots
  `?beam`, asserts the real catalog row mounts into the real `gun` group on `Space` with the rocket slot
  untouched; that the three NAMED sight objects (`beamSightCentre`, two `beamSightEdge`) and the
  `beamReticle` are drawn while aiming; **that the LOOK survived the port** — one green `#5ad17f` hue and
  one opacity on all three lines, the centre distinguished only by a longer `dashSize`, all three
  `LineDashedMaterial`, and the discharge/bead in a *different* blue `0x3d8bff`, which are exactly the
  values a careless re-type silently loses; that a held trigger runs charge → discharge → damage with the
  muzzle bead visible mid-charge and the sight brightest LATE in the charge; and — pausing to stop the rAF
  clock, since the transient is gone before a screenshot returns — that the **bolt is real GEOMETRY**: a
  mesh with a finite positive width, a core narrower than its glow, and a span that reaches muzzle→target
  (no hardcoded widths, which would break the next time they are tuned). It steps ONE tick at a time and
  stops the instant the charge completes, because the white-hot core burns out inside the first quarter of
  the 1.0 s fade, and gives the target a large hull so no kill explosion covers the frame. The target is pinned on the centre line during the
  charge on purpose: at 40 u the ±2° corridor is 1.4 u wide against a ~2.6 u hull, so a live AI drifts out
  of it through a 1.0 s charge most of the time, which is the weapon working — the escape is measured
  exactly in `sim-core/beam.test.js` instead. It covers the PLAYER's beam only),
  **the enemy beam** (`40-enemy-beam.mjs`: the LOCAL half of DECISIONS §135's gate. Boots `?lancer&level=4`,
  flies into the campaign's armed zone to leave roam, and asserts a lancer really carries weapon 13 in a
  single-mount `gun` group with `maxRange` 67; that with nothing charging **no hostile sight is on screen**
  (the charge-only half); then steps into a charge with the lancer pinned 25 u dead ahead and every other
  enemy shoved past its `ai.range`, and captures its reading **inside the stepping loop, on the frame the
  sight is visible** — a hidden line keeps its `position`, `lineDistance` and colour, so a reading taken
  afterwards would pass off a stale buffer. It asserts the hostile `#ff6b4a` and *not* the player's green;
  one colour and one opacity across all three with the centre distinguished only by `dashSize`; that each
  line spans the weapon's full **67 u** from the LANCER's own muzzle (a corridor clipped to the shooter's
  vicinity fails here); that it brightens and is brightest LATE; that the release **hides** all three while
  the bolt is drawn as real geometry; and that the player lost **45** combined shield+hull, not 80. Finally
  it pauses the rAF clock, steps to a second charge and photographs it, asserting on the **projected screen
  coordinates** — the corridor spans >200 px and runs well PAST the player's own hull, which is the reading
  that makes it a warning rather than decoration),
  and **the enemy beam in a ROOM** (`41-enemy-beam-netsim.mjs`: the other half of the gate, and the reason
  the gate exists. `?netsim=level-4&lancer&level=4` — the room runs the lancers, this tab simulates nothing.
  It sends **no input at all** (the supply of telegraphs is finite: an idle player dies in ~3 windows and
  `stepEnemyAI` holds all fire once he is dead) and takes ONE `waitForFunction` polled on an explicit 100 ms
  timer — independent of a 2 fps render loop — that returns null until a `beamHostileSightCentre` is visible
  and returns the whole reading on the frame it is. That single wait is the proof: the room's `beamCharge`
  crossed the wire, `hydrateEvent` resolved its `shipId` to a ghost, and the renderer drew a corridor for a
  shooter this tab never simulated, off that ghost's interpolated pose. A timeout fails with the player's
  liveness and the ghost count in the message, because a bare timeout here reads as "the wire is broken".
  Mutation-checked: removing `beamCharge: ['ship']` from `EVENT_ENTITY_REFS` leaves **40 passing and 41
  failing**, which is exactly why both exist),
  and **the backdrop against the hull** (`43-expensive-look.mjs`, measured on a REAL rendered frame via
  `gl.readPixels` inside a `requestAnimationFrame`. Runs on its OWN url `?debug&nebula` — the opt-in flag that
  turns the nebula bake and the parallax layer back on while keeping `window.__game`, which the world→screen
  projection needs. It clears the enemies and moves the ship OFF the base station (whose white modules would
  otherwise BE the "hull" it measures) and hides the speed-field dust (deliberately bright rock — leaving it
  in would make the sky ceiling a measurement of the dust). Four assertions, two of them written so the
  obvious formulation cannot pass on a broken frame: (1) the renderer never tone-maps (the deleted ACES pass
  must not come back — it multiplies by exposure/0.6 and over-exposes lighting authored for direct sRGB) and
  the parallax layer exists; (2) the layer really CONTRIBUTES, measured DIFFERENTIALLY (`setBackdropAmp(0)` vs
  the shipped amp in one frame sequence, **relative** sky-mean lift ≥ 3%, measured +4.9%) — an absolute floor
  is already satisfied by the cube and the stars; (3) the backdrop ceiling (D13) — the dimmer end of the lit
  hull (`hullP25`) against the sky's peak over the WHOLE sky (`bgP99`), asserted at **≥ 1.11×** plus
  **≥ 120 lit hull pixels**, as a **regression floor** rather than D13's unmet 1.50× ceiling (measured 1.155×;
  the pre-existing baked cubemap is ~95% of the sky peak, so the ideal was already breached before this
  feature). The weaker `hullP50` vs a 130 px ring's p95 was tried and rejected: it passes with 16% headroom on
  the same frame. Mutation-checked by raising `backdrop.amp`: 0.60 passes, 1.00 and 1.50 fail, and the sweep
  shows the pixel COUNT is the sensitive half (the ratio is partly self-normalising); (4) under 0.5% of the
  frame is blown out at rest. All numbers are printed for retuning).
  **`99-fill`** also gained two readability guards on the same frames it already measured: the peak
  blown-out share stays under **2%** and, on that peak frame, at least **60%** of pixels stay below luma 0.25
  — the frame must not become a white sheet when an FX retune spends its headroom on glow AREA.
  and **the playable intro** (`44-playable-intro.mjs`: the ONE scenario that runs with the director armed.
  It resets the shared throwaway player to progress 0, boots the intro on its own page, and then **freezes
  the live accumulator** (`__game.setPaused(true)`) so `__game.stepSim` is the only driver and every timing
  assertion reads `__game.combatElapsed` — never a step count, never a sleep. It asserts: the session
  recorder is armed on `level-0`; L0 is on screen at full opacity and `elementFromPoint` at its own centre
  returns the **canvas**, not the line (the `pointer-events:none` constraint); `enemyCount` 0 at 2.9 s and 1
  at 3.1 s (the spawn floor, end to end); the card appears at 5 s and carries `.fly` at 8.5 s; the flight
  **lands** — polled rects put it on `#help` within 4 px and its opacity under 0.05 — then is removed at
  9.4 s; **the TOP band** — the line's rect intersects neither HUD corner block, nor the radar, the gear, the
  pause button or the zoom column, asserted at **1280×800 and again at 812×375** with `body.touch` (where it
  also pins the `76px` floor the slot falls back to, and that `#help` is on screen and clear of the XP bar;
  that block guards the CSS band only — the runner's page is a desktop context, so `Device.hasTouch` is false
  and `#fire-btn`/`#stick-zone` are never rendered, and it makes no vacuous assertion about them); that the
  **kill log runs** on the intro like on every other level; the Settings **Skip** row is visible, the modal
  still FITS with it (the only place that is checked with the row present), and clicking it lands on
  `level-1`; that dying and pressing **Restart** re-arms `l0` **and takes the controls card off the screen**
  (the director's `reset()` emits no command, so a card left up sat stacked on the re-armed line); and
  finally **the WIN ending** — fight it to `cleared`, press "Finish and Return", **dock instantly from the
  arena centre with the `/advance` POST held for 1.5 s** (the advance-race guard, below), and assert the tab
  lands on `level-1`, the director is gone, `body.intro` is cleared, the Settings Skip row is gone, and a
  take-off into Level 1 draws no intro line. Mutation-checked six ways: a bare `translate(dx,dy)` (dropping
  the `-50%`), moving the fade to the `.fly` class rule, `pointer-events: auto`, reverting `introArmed()` to
  a sticky module flag, removing the card takedown, and dropping `await advanceDone()` — each fails it).
  and **the briefing scroll affordance** (`45-briefing-scroll-hint.mjs`: lands on Level 2 at a **760×360
  phone viewport**, skips the staged typewriter, and asserts the chevron the player actually sees — at the
  top of a clipped briefing the DOWN chevron is **painted** (opacity > .3, ≥ 8 px, centred on the panel and
  within 40 px of its bottom edge, in a light colour against the dark panel) while the UP one is invisible;
  scrolled to the end the pair **swaps**; and at 1440×900, where the same text fits, **neither** shows. It
  waits on the host's `.has-more-*` classes rather than a fixed sleep — the granted-item showcase floats in
  after its model loads and re-triggers the hint, so a timed read lands mid-fade. Mutation-checked by
  dropping the `attachScrollHint` call: it fails).
  **The runner's boot gate** (`visual/run.mjs`): every scenario boots the throwaway player into level-0, so
  after the take-off click it now **steps the sim** to the state scenarios have always been handed (an arena
  with an enemy — level-0 holds its first spawn for 3 s of sim), then calls **`__game.silenceIntro()`** so
  the director's line/card are not in every screenshot and `#skip-intro` does not widen the modal
  `14-reset-progress` measures. Stepping rather than waiting is deliberate: on software GL the sim runs
  behind wall clock, so waiting for real frames cost ~5-20 s per scenario. The SIMULATION is untouched — the
  spawn floors still apply, because the suite must fight the level production ships.
  Self-contained runner starts its own server + throwaway DB. Setup
  + run from `client/`:
  `npm install && npx playwright install chromium && npm run test:visual`; a single scenario:
  `node visual/run.mjs 22-trace-replay` (optional argv name filter). A stable, growing suite for
  occasional larger releases. See `client/visual/README.md`.

## Project structure
- `client/` — the game (Three.js): `index.html` (markup + importmap + inline module script being
  split out), `styles.css` (extracted CSS), `src/*.js` (ES modules); `client/locales/` — i18n catalogs
  (`source.json` + `<lang>.json`); `server/` — Node.js/Express backend + PostgreSQL; `docs/` — documentation.
