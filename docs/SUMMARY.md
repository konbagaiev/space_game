# Current state (SUMMARY)

> A living snapshot of "how things are now". Updated with every change.
> Change history is in [CHANGELOG.md](CHANGELOG.md). Rationale is in [DECISIONS.md](DECISIONS.md).

**Updated:** 2026-07-05 (**combat pacing + engine buff** — flat player top speed 30 u/s, all engine
`power` +50%, 5 s enemy hold-fire grace at run start, and each run opens gliding forward at 3 u/s. Prior:
**base station moved off-origin** — the return-to-base station was pushed from
`(-20,-20)` to `(-60,-60)` so the origin-spawning ship is no longer framed against its backdrop. Prior:
**Welcome screen: dropped the L1 ship picker + pinned Take off** — the Level-1
welcome (`#welcome`) is now a fixed CSS grid (`1fr auto`): a scrollable greeting/intro cell (`#welcome-scroll`)
over a pinned footer (`#welcome-footer`, Take off + community link), so the **Take off** button is always
on-screen regardless of content height, replacing a centered-flex column whose `justify-content:center` +
overflow clipped the unreachable *top* of the intro on short viewports. The decorative single-ship picker
(`.pick` + `#ship-choices` cards) was removed (L1 owns exactly one ship). Prior: **HUD overhaul + item rarity/color** — the HUD credits readout is now one line
`credits {total}/{earned} earned` and the live **Enemies** counter is removed; a small **event log** above
the rocket button shows the last 4 lines (kill: `{shipname} killed +{amount}`; pickup: `picked up {name}`
tinted by the item's color), each fading over 5 s (`client/src/eventlog.js`); dropped loot now glows in its
own rarity color (trash white / common green / rare blue); on **touch** the zoom `−  +` pair moved to the
bottom-center. New `rarity`/`color` columns on `components`/`weapons` (migration 020 + Postgres parity)
drive the glow + tint. Prior: **Staged briefing reveal (L1-3)** — the L1 welcome briefing and the L2/L3 Main
Window campaign briefing now **type out over ~5 s** (`client/src/typewriter.js`), then reveal the
ship-preview window (+ granted-item showcase; L1 has no picker), then the **Take off** button **+0.5 s** later;
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
(**Weapon hit/explosion FX pass** — bullet hit-flash is now keyed off the weapon
`class` (`HIT_FLASH_SCALE`: kinetic tiny spark / cannon small flash) instead of one size, and rocket
detonation uses a new small/fast layered `spawnRocketBurst` whose size/speed/tint are data-driven from
the rocket weapon stats (`blastVisual`/`blastTimeScale` 0.8 = 20% quicker/`blastTint`); ship-death burst
unchanged.)
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
sits up-left of the arena center at `(-60,-60)` (moved off origin so the origin-spawning ship is
never framed against it), and **every** mission (campaign L1–4 + the three side missions) ends by flying
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
only under the sticky `?dev` flag via the new `client/src/dev.js`/`isDev()`; see the Perf overlay bullet below.
Prior: device-support architecture [iteration 1] + desktop Main Window polish — a two-axis
device model in `client/src/device.js` replaces the old `isTouch` boolean: an **input** axis [`touch`/`mouse`,
~constant per session] and a **form** axis [`phone`/`tablet`/`desktop`/`desktop-lg`, recomputed on resize from
the viewport's longest edge], projected onto `input-touch|input-mouse` + `dev-phone|dev-tablet|dev-desktop|
dev-desktop-lg` body classes [`body.touch` kept as a compat alias]; the desktop [`dev-desktop(-lg)`] Main Window
now reads bigger/cleaner [32px title, 26px text, ×2 ship-stats on one line, granted item centered below the text,
fixed-height Loadout/Stash/Shop, Take-off following the content]; mobile/touch unchanged; itch.io HTML5 export — `npm run build:itch` assembles a static ZIP that runs on itch.io and talks to the live backend; client `/api` calls go through a baked `API_BASE` [`client/src/api-base.js`: empty same-origin, prod origin on the itch build]; server gained `/api` CORS [reflect Origin, no credentials] + dual-path bearer-token auth [login/register/reset return the token in the body, `Authorization: Bearer` accepted alongside the cookie]; self-service password reset — forgot-password → emailed `/?reset=TOKEN` link → new-password modal; enumeration-safe endpoint [always 200], 1 h token TTL, all sessions invalidated + email auto-verified on reset, auto-login after; migration 017 + Postgres parity; EN+RU strings; hangar no longer crashes when a required slot [hull/engine/thruster] is unequipped — `buildPlayer`/`deriveDrive` are null-safe and the Take-off gate blocks launch; briefing-showcase strut height now subtracts the gun's 8px margin so the Main Window briefing no longer grows a phantom scrollbar; component/weapon 3D models — items now carry an optional hangar `model_url_high` like ships [migration 016], shown as a spinning menu icon via the generalized ship-or-item preview; first two item models = Repair drone + Machine Gun; mission briefings showcase the granted item [MG on L2, repair drone on L3] spinning at full size in a viewer floated into the BOTTOM-RIGHT CORNER of the mission text (the text wraps around it via the classic strut+float trick; the ship preview is the column to the right) — without replacing the ship preview — via a server-derived `showcase {kind,id}`; fixed a Postgres auth-session race [await the session insert]; Main Window redesign — the between-battles screen dropped the "Hangar" name for a fixed landscape layout: top bar (gear + nickname/auth + enlarged Vega Sentinels wordmark + inactive Ships), left menu (Missions/Loadout/Stash/Shop), center work zone, and a 25% live ship-model preview; the side-mission board + modal moved into the left menu's collapsible Missions list (campaign primary + side secondary), the shop bay opens in the work zone, code/DOM/i18n renamed hangar→main/mw; machine-gun/kinetic fire SFX trimmed −30% via DB per-sound gain; enemies renamed enemy→pirate; advanced tier uses orange ship models; low-end-phone perf: measured on two GPUs that the weak-device bottleneck is **CPU
draw-call submit + thermal governor, NOT fill rate** — so the sub-native `renderScale` knob was **removed**
(blurred for no gain), a shader **pre-warm** kills the 0.4-2.2s first-frame freeze, and a `maxParticles` 300
ceiling caps the weakest tier; a **`?dev` perf monitor** samples per-frame JS-cost breakdown + device/GPU
passport + JS heap once a second to `POST /api/perf` → `perf_samples` table; per-ship model presentation
consolidated into a documented `stats.model` block — yaw/scale + optional muzzle/exhaust spawn overrides — replacing loose `modelYaw`/`sizeScale` keys (back-compat reads kept); new `docs/plans/adding-a-ship-model.md` convention; player ship = real textured "Air & Space Vessel" model (downscaled textures → player_combat/_hangar, model.scale 1.1); tier-gated env-map reflections on ships; muzzle/exhaust spawn from the model's real nose/tail bounds; enemy weapon fire silenced (rocket detonations kept); "Reset my progress" in settings (slide-to-confirm → POST /reset; modal shrunk to fit); ships bank their wings into turns, capped 20° (cosmetic, player + enemies); rocketeer/medium/first-boss now use real low-poly models enemy_2/3/4_combat; background music = looping sampled tracks per scene via the sound_map (generative synth removed); SFX routing moved to DB — `sounds`/`sound_map` tables + ship/weapon `class`, `/api/sounds`, no client hardcoding; sampled SFX: kinetic/rocket/cannon + ship hit + ship explosions (shipBoom/blast); `?tune` dev palette panel; `stats.modelYaw`; bright-star layer; arena ±360 + shifted mission set-pieces; graphics quality tiers; mobile forced to landscape by rotating the whole body 90° in portrait (CSS `body.rot`; renderer/touch run in swapped game dims via applyOrientation/gameW/gameH/toGame); the four inline "⛶ Full screen" buttons replaced by one floating, icon-only, brighter bottom-right button that hides once fullscreen)

## What this is
**Vega Sentinels** — a browser prototype built on Three.js (`client/index.html`): little spaceships
fighting on a plane. Opens in a browser with no installation (Three.js from a CDN).

## Controls
- `W`/`↑` — thrust forward, `S`/`↓` — backward
- `A`/`D` or `←`/`→` — turn the nose
- `Space` — fire (primary weapon)
- `F` — rocket (homing, 5 s cooldown)
- **Autopilot (station or loot chest)** — after the last enemy is destroyed the **base station** (at
  `(-60,-42,-60)`, up-left of the arena center) becomes clickable; **clicking/tapping it** (a canvas raycast,
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
- **Zoom** — **PC:** mouse **wheel** (scroll up = closer) + on-screen **＋/−** buttons (right edge,
  vertically centered — unchanged). **Mobile:** the buttons (**bottom-center**, laid out horizontally as
  **`−  +`** — minus left, plus right; `body.touch #zoom` override) + two-finger **pinch**. Zoom scales the fixed
  camera offset along its angle within `0.6–2.2×`, **eases smoothly** toward the target (~0.2 s, frame-rate
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
  is always on-screen, like the Main Window; the **Main Window** is a fixed full-height grid (only its
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
- **Perf overlay** at the top center: FPS, frame time (ms), draw calls, triangles
  (the `?dev` per-second perf sample posted to `/api/perf` also carries `load.drops` = the live loot-drop
  count, next to `enemies`/`particles`, so drop cost shows up on a real device)
  (across both render passes), and the **real backbuffer resolution** (`w×h` = CSS size × pixelRatio —
  the actual pixels the GPU fills). FPS/frame-ms use the **raw rAF interval**
  (`clock.getDelta()` before the sim's `0.05`s clamp), so they stay accurate below 20 fps instead of
  saturating at the clamp. A proxy for hardware load; the resolution lets a tester confirm whether a
  tier/`renderScale` change actually moved the pixel count (a weak phone often reports `devicePixelRatio`
  ~1, making the pixel-ratio cap a no-op). **Dev-only:** the overlay is a diagnostic tool, hidden by
  default (`#perf { display: none }`) and shown only under the **sticky `?dev` flag** — CSS reveals it via
  `body.devmode:not(.menu) #perf`. `client/src/dev.js` / `isDev()` is the single source of truth for `?dev`
  (it also gates the `devPerf` perf telemetry in `main.js` and the `●dev`/JS-heap suffix in `hud.js`).
  Truthy for `?dev`/`?dev=true`/`?dev=1` (turns it on and remembers it in `localStorage['devMode']`),
  explicit-off for `?dev=false`/`?dev=0` (clears the stored flag); with no `dev` param the stored flag
  decides, so a dev visits `/?dev` once and keeps the overlay across loads. Normal players never see it.
- **Rocket cooldown indicator** — the 🚀 circle (bottom-right) fills radially as it reloads
  (orange while reloading, green when ready). Shown on both PC and mobile; on PC it's also
  clickable to fire (besides the `F` key), on mobile it's the rocket button.
- **Off-screen enemy markers** — for each enemy that's off-screen, an arrow on the screen edge points
  toward it, tinted by the enemy's marker color (`updateMarkers`, a pooled DOM overlay). Hidden while an
  overlay (game over / victory) is up.
- **Enemy health bars** — a small translucent-red bar that floats **above each enemy on the 2D screen**,
  shown **only while its HP is below max** (undamaged enemies show nothing). `updateEnemyHealthBars`
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
  `collect()` (pickup line). Purely cosmetic — the fade is wall-clock, so it keeps fading while paused
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
- **Mini-map / radar** (left edge, vertically centered, `<canvas id="minimap">`, non-interactive) — an overview that
  **complements** the edge arrows (arrows = immediate threat direction; radar = spatial overview, useful now
  that the player can wander out of bounds). Shows the **arena boundary** square (±360), the **player** as a
  heading triangle (clamped to the radar edge so it stays visible when far out, red while out of bounds), and
  **enemies** as dots tinted by type color (`updateMiniMap`). Hidden on menus and while a result overlay is up.

## Ship model (DB-driven)
Ships, components and weapons are **defined in the database** (`ships`, `components`, `weapons`); the
client fetches them on startup (`bootstrap()`) and assembles every ship from that data. Only the pure
derivation (`deriveDrive`/`shipMass` in `client/src/components.js`) stays client-side. A ship is a
**hull + an engine + maneuvering thrusters** (referenced by id in the ship's `components` field) plus
**mounted weapons** (`stats.mounts`). `stats` (JSON) also carry **fire `groups`** (named channels — a
key for the player, an AI range/aim rule for enemies), `role`, `color`, and a `model` block (per-ship
model presentation — see the Visual model section). A `mount` = a
weapon id, its `group`, a lateral `offset` (side-by-side fire), a `delay` (staggered volley); a ship
can mount several of the same weapon (the mini-boss has two rocket launchers). The player's active ship
+ its loadout/components overrides come from `player_ships` (see Backend).
- **Components** (DB `components`, `type` `hull`/`engine`/`thruster`/`repair`/`grab`; `weight` column + `stats`
  JSON): a **hull** has `{ durability (= maxHp), volume }`; an **engine** has `{ power → acceleration,
  maxSpeed, exhaust }`; a **thruster** has `{ power → maneuverability (turn rate) }`; a **repair drone**
  (4th type) has `{ repairPerTick, intervalSec, maxFraction }` → passive hull regen; a **grab** (5th type,
  the tractor beam) has `{ strength }` → its loot pull range/speed (see **Grab & loot drops** under
  Gameplay). Seeded: hulls
  Basic(100hp)/Light(30hp)/Medium(150hp)/Boss(310hp); engines + thrusters Basic/Scout/Medium/Boss; one
  **Repair drone** (id 12: heal 1 HP / 1 s, capped at 80% of max HP); two **Grab** items — the **base Grab**
  (id 29: strength 10 / weight 2 / 500, which the player **owns from the start** — it's in the default
  player ship's `components.grab`) and the buyable **Advanced grab** (id 30: strength 20 / weight 3 / 2000).
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
    27, light / **6400** — the premium top-tier engine), **Advanced thrusters** (id 21: power 3.0 / weight 5 /
    **2500**), and repair tiers **Repair drone II** (id 19: 1.5 HP / 1 s / 85% / **1800**) + **Nanobot repair**
    (id 20: 2 HP / 1 s / 90% / **7000**). Upgrades are **mass trade-offs, not power-creep**.
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
- **Mass** = hull + engine + thruster + repair-drone + grab weight + every mounted weapon's `weight` (`shipMass`).
  Acceleration and turn rate are **derived AND scaled by mass** (`deriveDrive`): `massFactor =
  REFERENCE_MASS / mass`; `acceleration = engine.power × massFactor`, `turnRate = thruster.power ×
  massFactor`. `REFERENCE_MASS` = 50 (the player's starter loadout: hull 20 + engine 10 + thrusters 4 + gun 6
  + rocket 8 + **grab 2**) keeps the player at accel 15 / turn 2.0; heavier ships are slower & less agile.
  (`REFERENCE_MASS` was bumped 48 → 50 when the base grab was auto-equipped, so its 2 weight is mass-neutral
  at the baseline — a deliberate neutralization, not a nerf.) A **required slot
  (hull/engine/thruster) may legitimately be empty** in the hangar (you can unequip it back into the
  stash) — the active ship then reports `launchable: false` + `missingRequired`, the **Take-off button
  is disabled** (`updateTakeoffGate`, "required slot empty" note), and the hangar preview build is
  null-safe (`buildPlayer` HP→0 on a null hull, `deriveDrive` accel→0 on a null engine) so the player
  can still reach Loadout/Stash to re-equip rather than crashing on a null component. The stats bar
  paints **HP 0 red** (`#ship-stats .v.crit`) so the empty slot reads as a problem, not a real stat.
- **Visual model:** the **ship visual-model rendering lives in `client/src/ship-factory.js`** — `makeShip` builds a
  ship's **root group** (owns world position, the `1.8` scale, and per-frame `rotation.y` = heading) plus
  an **inner "bank" group** (`g.userData.bankGroup`) that holds the primitives / `.glb` and rolls about the
  nose; `applyShipModel` swaps the loaded `.glb` into that bank group (applying `model.yaw`). The per-frame
  heading is written as `mesh.rotation.y` in the update loop (player ~`index.html:2153`, enemies ~`:2191`).
  Each ship's `model_url` (in the DB) points to the **combat** `.glb`; `makeShip` shows a **procedural
  placeholder ship** (built in code in `ship-factory.js`, no binary asset) while it loads / as a
  fallback, and `applyShipModel` auto-centers/scales/tints/orients it. **Per-ship model
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
  (`client/src/collision.js`) is broad-phase (one
  `broadR × mesh.scale.x` sphere at `mesh.position`) → narrow-phase (point-vs-OBB: each box center
  transformed by `mesh.matrixWorld`, axes rotated by its upper-3×3 and renormalized, hit iff
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
  S3 prefix. Today two items have a model: the **Repair drone** (component 12) and the **Machine Gun**
  (weapon 5), both CC-BY 4.0; every other item's `model_url_high` is null (the viewer degrades to nothing).
  `assets:check` validates item model URLs alongside ships. See `docs/plans/component-weapon-models.md`.
  The **L2 and L3 briefings still showcase the granted item** spinning at full size (Machine Gun on L2,
  repair drone on L3) and still run the **same idempotent grant actions** (`replaceWeapon 1→5` /
  `installComponent repair 12`) — only their **text was reworded** to a "you recovered / picked it up" framing
  (EN source + RU), since the reveal now also happens as a glowing battlefield drop at the end of the prior
  level (see Grab & loot drops → L1/L2 reward drops).
  - **Player ship** = the real **"Air & Space Vessel"** model (Raven, CC-BY): a light-grey/red textured
    fighter, **`model.scale: 1.1`**. Unlike the flat low-poly enemy pack, it **keeps its textures** (paint,
    decals, markings) — `assets:build` just **downscales** them via the `player` preset override
    (`PRESET_OVERRIDES` in `assets-config.mjs`): combat `player_combat` ~371 KB (128px textures + meshopt
    geometry, same-origin — loads through the wired meshopt decoder) + hangar `player_hangar` ~1.7 MB (512px,
    CloudFront, lazy-loaded). The pre-load fallback is the procedural placeholder ship (no in-git binary). Metal
    surfaces shine via the env map (see Visuals).
- **Asset pipeline** (`docs/plans/ship-model-pipeline.md` + `audio-sample-pipeline.md`): repo-root `npm run
  assets:recolor` (`scripts/assets-recolor.mjs` — regenerates the `enemy_*_orange` sources by tinting the
  pack's RED materials to the **target hex `#f4741f`** (constant in the script), scaling each red shade's
  brightness so light/dark shading is preserved; black/gray untouched — uses the `@gltf-transform`
  **devDependencies**) / `npm run
  assets:build` (gltf-transform via npx → a content-hashed **combat** + **hangar** glb per `assets-src/*.glb`,
  or pass base names to build a subset, e.g. `assets:build enemy_1_orange`;
  default `PRESET.combat`/`hangar` in `assets-config.mjs`, with optional per-source **`PRESET_OVERRIDES`**
  merged by `presetFor` — combat geometry is **meshopt-compressed** to stay light for battle; the **player**
  override only keeps its textures, downscaled to 128px + WebP, so a richly-textured ship stays ~371 KB) / `assets:push`
  (→ S3 `vega-sentinels-assets`: glbs to `ships-combat/`+`ships-hangar/`, **SFX mp3s to `sfx/`**, sources to
  `source/`) / `assets:pull` (S3 → `client/assets/ships/` **+ `client/assets/sounds/`**) / `assets:check`
  (drift-check: every pipeline `model_url*` in the seed **and every `SOUNDS` url in `catalog_seed.js`**
  exists on S3 — the deploy guard). **No model binaries in git** (S3 canonical; the pre-load fallback is a
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
- **Weapons** (DB `weapons`, type `bullet`/`rocket`): bullets — `power` (damage), `projectileSpeed`,
  `maxRange`, `fireCooldown`; rockets — `power`, `accel`, `turnRate`, `launchSpeed`, `maxRange`,
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
  **Heavy Machine Gun** (id 7: power 12, high RoF / **6000**), **Heavy rocket** (id 8: homing, power 90, slow
  reload, big blast / **2600**), and **Triple spiral rocket** (id 11: **4000**, top of the rocket ladder —
  `stats.spiral:true`). The triple spiral fires an **invisible leading homing rocket** (steers via
  `findTargetInSector`, deals no damage, not shootable) that defines the flight path; **three visible
  cyan warheads** (power 40 / health 10 each; flight = Heavy-rocket-class ×1.2: launchSpeed 14, accel 12)
  spiral around its axis (radius 1.4u, 6 rad/s, 120° apart). Each warhead is a real rocket — it detonates
  on its own proximity and can be individually shot down (all three connecting = 3× = 120 damage);
  fireCooldown 7. Its shop/loadout stat line shows damage as **40×3** (`statLine` special-cases
  `stats.spiral` — per-warhead × warhead count — so a 3-warhead weapon isn't misread as a single 40).
  Enemy weapons: **Pirate machine gun** (id 9 — long-range 90, rapid fire 0.18,
  low damage 3; pirate gunner + buffed boss) and **Advanced pirate cannon** (id 10 — power 10, slow 1 shot/sec,
  long range 110; the Second Boss's main gun).
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
  Advanced pirate cannons + three rockets**; reward 500). One more ship is seeded but **not wired into any
  level** yet: `advanced_rocket_pirate` (`advanced rocket pirate`, **orange `enemy_2`** — Pirate
  hull/engine, Pirate MG + a rocket; reward 75), kept for a future harder rocketeer wave. Which
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
- **Grab & loot drops** (`client/src/drops.js` + `drops-config.js`; docs/plans/2026-07-03-1412-grab-tractor-drops.md).
  On each enemy kill there's a **20 %** chance (`DROP_CHANCE`) to drop **one** item — chosen uniformly from
  the enemy's **non-hull** components (engine, thruster) **+** its mounted weapons (the real catalog id +
  kind; `pickLoot`). **Hulls NEVER drop** (progression guard — a looted 550-HP boss hull would be
  equippable and break balance). A drop is a slowly-rotating **metal-box** glb (one turn / 5 s), rendered
  from the single `DROP_MODEL_URL` (a fallback metallic box shows until the model loads). The **Grab**
  component (if equipped) pulls drops in: **range = strength** world units; a drop must sit in range for
  **0.3 s** (`ARM_DELAY`) to arm, then the **nearest** armed drop is pulled toward the ship's live position
  at **speed = (strength/2)·(10/itemWeight)** u/s (`pullSpeed` — light parts pull fast, heavy parts slow;
  a zero/missing weight falls back to 10). A single **thin blue line** (pooled `THREE.Line`, `0x4db6ff`) is
  drawn only **while actively pulling**; at most one drop is pulled at a time. Within 3 units the drop is
  **collected** (`pendingLoot`). The base grab's short range (10) is a deliberate "vacuum assist"; the
  Advanced grab (20) is the real tractor + the upgrade incentive. A **`MAX_DROPS = 40`** cap bounds the
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
  (`CAM_OFFSET`) is scaled by the player's zoom (`0.6–2.2×`) along its angle — zoom never changes the
  angle, FOV, or camera type.
- **Landing screen (reflects the current level)** — on load the homepage depends on the player's current
  level: if it has a **briefing** (level 2+), the client lands on the **Main Window** showing that briefing
  (so a returning player sees *their* mission, not the level-1 intro); otherwise (level 1 / new player) it
  shows the **welcome screen** — a start overlay that greets the player ("Welcome, Sentinel"), frames the
  threat as a pirate raid, and offers **Take off**. Its layout is a **fixed grid** (`grid-template-rows:
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
  gone), and an **inactive "Ships"** label top-right (`#mw-ships`, reserved for future ship-buying).
  **Below**: a 3-column grid — **left menu** (`#mw-menu`: Missions / Loadout / Stash / Shop) | **work zone**
  (`#mw-work`) | a **25% live ship-model preview** (`#mw-ship`). The **Missions** item (collapsible via the
  caret) lists the **campaign mission (primary)** and, once the shop is unlocked, the **three side missions
  (secondary)**; selecting a row renders its description + Take-off into the work zone (**only the
  description scrolls**, `#mw-mission-desc`). Loadout/Stash/Shop open the **shop bay in the work zone**
  (`#mw-view-bay`) — the bay's internals are unchanged, but the screen is switched from the **left menu**
  (no in-bay nav strip); those three menu items are hidden until the shop is unlocked. JS:
  `showMain(briefing)` (was `showHangar`) shows it and starts the preview — **the campaign (primary) row
  always reflects the current level's briefing**: an explicit `briefing` (the server-derived one stashed on
  `/advance`) wins, else it falls back to `CATALOG.level.briefing`, so returning from a **side mission**
  (`showMain(null)`) keeps the campaign description instead of blanking to the `ui.hangar.default` standby
  line; `selectMenu(which)` switches the
  work-zone view; `buildMissionList()` + `renderMissionView(m)` drive the mission list/description;
  `launchCampaign()` (was `launchFromHangar`) and `launchMission(m)` launch + stop the preview; `openBay()`
  (was `openHangarShop`) gates + loads the bay.
  - **Staged campaign-briefing reveal (L2/L3)** (`docs/plans/2026-07-05-1641-briefing-staged-reveal.md`):
    when the **primary (campaign) briefing** lands on **levels 1-3** (in practice L2/L3; L1 lands on the
    welcome screen), the briefing text (`#mw-mission-text`) **types out over ~5 s** while the right-column
    **ship-preview window** (`#mw-ship-col`) and the **Take off** button (`#mw-go`) are hidden
    (`visibility:hidden`, so nothing reflows); when typing completes the ship window + the **granted-item
    showcase** (`#mw-item`, Machine Gun on L2 / Repair drone on L3) fade in together, then **Take off +0.5 s**
    later. **Tap the briefing text (`#mw-mission-desc`) to skip** to full + reveal everything at once. The
    level is parsed from the descriptor `title` ("Level N"); it plays **once per landing** (switching to
    a bay view / launching / re-selecting the row after settles to full, no replay). **L4+ and side missions
    stay instant** (no staging). Shared typewriter: `client/src/typewriter.js`.
  - **Desktop (PC) form polish** (`docs/plans/2026-07-01-1933-device-profiles-desktop-polish.md`,
    device-profiles iteration 1) — additive CSS scoped to `body.dev-desktop` / `body.dev-desktop-lg` only
    (phone/tablet + the `@media (max-width:760px)` mobile override are untouched): the briefing **title is 32px**
    and the **body text 26px**; the **Loadout/Stash/Shop** buttons are **fixed-height** (56px, `flex: 0 0 auto`
    — no longer stretched to fill the menu column); the **granted-item 3D icon centers directly below the mission
    text** (the bottom-right float + strut are dropped — `#mw-mission-desc` becomes a flex column, the item takes
    `order: 2`, `align-self: center`, 55% width) so **Take-off then sits under the item**; the **ship-stats strip
    uses ×2 fonts** (k 16 / v 20 / d 12px) and **fits on one line** (measured at 1440×900, scrollWidth == clientWidth
    → the borderless 2×2 grid fallback stays unused); and **Take-off follows the content** (`#mw-mission-desc`
    `flex: 0 1 auto`, still scrolling when the text is genuinely long). Mobile/touch layout is unchanged.
- **Model preview** (`#mw-ship`, right ~25%) — a **small self-contained Three.js view** (own
  `WebGLRenderer` + scene + camera + a directional light + the same RoomEnvironment PMREM reflections as the
  combat scene) that **slowly auto-rotates** a glb. The viewer machinery is factored into reusable helpers
  (`buildModelViewer` builds a `{renderer,scene,camera,group,raf,url}` viewer; `startViewer`/`stopViewer`/
  `resizeViewer` drive its rAF loop/size; `setViewerModel(viewer, url, cfg)` normalizes/recenters/orients
  any glb — ship **or** item). The right-column preview (`mwPreview`) **always shows the player's active
  ship** (`model_url_high` → `model_url`; `loadPreviewModel`/`previewShip`); the **granted item** of a
  showcase briefing renders in a **separate work-zone viewer** instead (see "Briefing item showcase"). Both
  loops run **only while the Main Window is visible** (`startShipPreview`/`stopShipPreview`), so they cost
  nothing during a fight; `resizeViewers` keeps both crisp on resize/rotation.
- **Work-zone item showcase** (`#mw-item`, `mwItem`) — a **second** viewer **floated into the bottom-right
  corner of the mission text**, showing the **3D model of the gear a campaign briefing grants** (Machine Gun
  on L2, Repair drone on L3), spinning, at **full size** (`ITEM_SHOWCASE_SCALE = 1`) — **without** displacing
  the ship in the right-column preview. The canvas lives **inside `#mw-mission-desc`** alongside the text
  (`#mw-mission-text` span) and a 0-width strut (`#mw-item-strut`); both floats precede the text in source.
  **Bottom-right + wrap is the classic CSS strut-float trick:** the strut floats right with
  `height: calc(100% − var(--gun-h))` to reserve the **top** of the right column (text flows full-width past
  it), then the canvas `clear: right` drops **below** the strut into the bottom-right corner (`width: 46%`,
  `height: var(--gun-h)`) — the mission text then wraps full-width above it and down its left side. Floats
  can't anchor to the bottom by themselves, hence the strut. Revealed by `#mw-mission-desc.show-item`. The
  ship preview is the column to the right. `showShowcaseItem(sc)` toggles `.show-item` + starts/stops the
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
  level so the next **Restart** plays it). A new player starts on `level-1`; the last level stays put.
- **Return-to-base mission end (all missions).** Killing the last enemy **no longer wins immediately**. A single
  `levelRunner` intercept (`sim.js`) replaces the `win` phase's `this.win()` with `beginReturn()`, so **every**
  mission — campaign L1–4 **and** the three side missions — ends the same way, with no per-descriptor edits (the
  `win` phase's `delay` still runs first, so the boss explosion plays out). On `beginReturn`: `G.returnToBase`
  goes true — the **OOB warp-back is lifted** (`&& !G.returnToBase`, so a side mission fought far from `(0,0)`
  can fly home), a translucent **blue homing arrow** (`updateReturnArrow`, anchored to the ship, re-pointed at
  the station each frame) and a centered **"Sector cleared — return to base"** HUD hint (`updateReturnHint`,
  i18n `ui.return.hint`) appear, and the **base station becomes clickable** (`G.baseStation.active`). Clicking/
  tapping the station is a **mandatory dock** (on touch a **slop-gated tap** — a <10px single-finger gesture —
  through the shared `engageObjectAt` pick, not a raw touch-anywhere): it calls `engageAutopilot()` (sets `G.autopilot.active` + phase
  `brake0` + `target = { kind:'station' }`), and `checkArrival()` fires the existing `win()` once the ship is
  within `BASE_ARRIVE_RADIUS` (45u, horizontal xz) of the station's actual position `(-60,-60)` (the win
  test measures distance to `G.baseStation.obj.position`, not a hardcoded origin). `G.autopilot` now carries a typed **`target`**
  (the station **or** a loot drop — the same autopilot flies to loot chests, see Grab & loot drops); the
  dock/win predicate `canDock(autopilot, dist)` (pure, in `client/src/autopilot-config.js` with
  `BASE_ARRIVE_RADIUS`, unit-tested) fires **only when the target is the station** — a chest-aimed autopilot is
  structurally incapable of winning. **Proximity alone never wins**, and any control input cancels the dock
  (clears `active` + `target`) so a cancelled/manual approach doesn't complete (re-tap to resume). Clicking
  while already inside the radius wins on the next frame. `win()` tears the return state back down (arrow/hint/clickable off) and reuses the existing
  victory handling (overlay, `bankRun`, `×2`, `unlockNextLevel` for campaign only).
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
  active ship), and **`unlockShop`** (flips `shop_unlocked` → opens the hangar shop + side missions).
  `level-2`'s briefing narrates the weapons-factory mission and swaps the basic gun (1) for the **Machine
  Gun** (5); `level-3`'s briefing narrates fitting the **repair drone** and installs it (`installComponent`
  `repair` → 12); `level-4`'s briefing (text + `unlockShop`) directs the player to gear up at the shop
  before finding the pirate base. After advancing, the client reloads the active ship and rebuilds
  the player so the new loadout/components take effect. (Future action types: add credits, add to a
  stash, etc.)
  - **Briefing item showcase.** When a briefing **grants gear**, a **dedicated work-zone viewer** (`#mw-item`,
    a canvas floated into the **bottom-right corner of the mission text** with the text wrapping around it —
    the ship preview is the column to the right; the bottom-float strut height is `calc(100% − var(--gun-h) − 8px)`,
    subtracting the gun's 8px vertical margin so the floated stack is exactly 100% tall and the description
    doesn't grow a phantom scrollbar) shows that item spinning at **full size** (Machine Gun on L2,
    Repair drone on L3) — the
    eye-catching item pulls the player into the text **without** replacing the ship in the right-column preview
    (the ship preview always shows the player's ship). The server attaches a
    **`showcase {kind,id}`** to the briefing response, derived from its grant actions
    (`replaceWeapon`→`{weapon,to}`, `installComponent`→`{component}`; an explicit `briefing.showcase`
    overrides). The client resolves the id in its catalog (which carries the item model URLs) and renders it
    via `showShowcaseItem`/`setViewerModel`; on the **page-reload landing** path it gets the raw descriptor (no
    server `showcase`) so it derives the same `{kind,id}` from the briefing `actions` client-side. No item
    (L4 `unlockShop`) or a side mission → the work-zone viewer hides. See
    `docs/plans/briefing-item-showcase.md` + DECISIONS §29.
- **Level flow** — driven by a DB **level descriptor** (a phase/wave script) played by the client's
  `levelRunner`. Each descriptor also carries a server-computed **`enemyTotal`** — the exact number of
  enemies destroyed to complete it — derived from the phase script by `enemyTotalFromPhases`
  (`server/src/enemy_total.js`), stamped in `catalog_seed.js` (campaign) and `missions.js` (side missions);
  it drives the HUD killed/total counter. Four campaign levels are seeded (played in order via the player's progress):
  - **`level-1` (beginner):** fighters only (3 at a time) → after **6 kills** rocketeers join at 25%
    → at **12 kills** spawning stops, one last rocketeer appears, clear the field → **Victory!** No boss.
  - **`level-2` (medium):** fighters only until 5 kills → fighters + rocketeers 75/25 until 12 kills →
    spawning stops → a single **medium** appears alone as the boss → clear → Victory.
  - **`level-3` (full fight):** waves of all three enemy types → after 16 kills spawning stops → the
    **Sector boss** spawns alone → on its death the game runs ~5 s (watch it explode) → Victory.
  - **`level-4` ("Find the pirate base"):** clearly harder — **pirate gunners + rocketeers + advanced
    medium pirates** (40/40/20 → 35/35/30, maxConcurrent 5) to 8 then 16 kills → clear-out → the
    **Second Boss** (450 hp, two Advanced pirate cannons + three rockets) → Victory. Its briefing **opens the
    hangar shop + side missions** (`unlockShop` action — see Between-level briefings); its victory sets up the
    planned L5 ("Storm the pirate base"). Currently the final level. (Balance: `docs/plans/level-4-difficulty.md`.)
  The AI keeps its distance and fires its weapon groups by range/aim. Spawn composition (ships +
  `chance` weights + max concurrent) is per-phase in the level; a `win` phase's `delay` defers the
  outcome so the last/boss explosion plays out — but the `win` phase no longer wins outright: it now opens the
  **return-to-base** gate (fly home to the station to complete the mission — see Level flow / Victory).
- **Rockets can be shot down by the machine gun:** a bullet subtracts its damage from an opposite-side
  rocket's HP (shot down at 0) — you can deflect enemy rockets, and an enemy can shoot down yours.
- Player health is 100; HUD shows the remaining health as a percentage with one decimal
  (e.g. "87.5%") below the bar.
- **Economy (credits)** — the currency is **credits**. Every enemy carries a `reward` (`stats.reward`:
  fighter 25, rocketeer 50, medium 125, first boss 250); destroying one adds it to the run's **Earned**
  total. Completing a level **doubles** Earned (`win` applies `earned ×= 2`). The separate **kill count**
  drives level thresholds. At the **end of each run — death OR victory — Earned is banked** into the
  player's persistent **Credits** balance (server-authoritative; closing the browser mid-run loses the
  unbanked amount). New players start at **1000 credits**. HUD (top-right) shows one credits line —
  `credits {total}/{earned} earned` (total persistent balance / Earned this run; `ui.hud.credits_line`,
  EN+RU) — plus **Destroyed**. The live **Enemies** (alive) counter has been **removed**.
  **Destroyed** reads **killed / total** (e.g. `8/16`): *total* is the number of enemies destroyed to clear
  the whole level/mission, precomputed on the server from the descriptor's phase script and embedded as
  `descriptor.enemyTotal` (the client reads it in `levelRunner.start`; falls back to the bare kill count when
  the total is unknown, e.g. a level row not yet reseeded).
  Banking posts `{ credits, kills, durationMs }` to `POST /api/games`, which returns the new balance.
- **Shop & stash (the "spend" side)** — once the player **clears the final level**, the Main Window's left
  menu gains three items — **Loadout** (what's equipped), **Stash** (owned-but-not-equipped inventory, a qty
  model), and **Shop** — each opening that screen as the **bay view in the work zone** (`#mw-view-bay`;
  switched from the left menu, not an in-bay nav strip). **Shop** is a **two-pane** screen (a type list
  **Hull / Engine / Thrusters / Repair / Weapon / Grab** → the items of the selected type on the right). The Shop lists only **buyable** items (`price > 0` **and** `stats.buyable !== false`); **enemy parts are priced (resale value) but flagged `buyable:false` → hidden**, while
  the player's **starter gear is cheap-but-buyable** (Basic hull 300 / engine 500 / thrusters 400 / repair
  drone 500 / homing rocket 600) so each type's ladder starts low. The **Grab** tab sells the **Advanced grab**
  (2000); the base grab the player already owns. Each item's **full characteristics show
  on hover (desktop) or the (i) tap (mobile)** — for weapons: damage, RoF/reload, projectile speed, range,
  blast, weight. A shop item the player **already owns shows an "Owned ×N" badge** (N = total equipped on
  the active ship **+** in the stash). **Price shown per screen:** the **Shop** shows the **full buy price**;
  **Stash + Loadout** show the **resale value** (`floor(price*0.75)` — the amount the player actually gets on
  sale, computed client-side via `sellLabel`/`SELL_RATE` to mirror the server), so the player reads "what I'd
  get" right on the card. **Card layout:** Loadout/Stash item cards stay on a **single row** everywhere (incl.
  phones); only the **Shop** stacks into two rows on touch (its long name + price + Buy don't share a phone
  line). Flows, all
  **server-authoritative + transactional**: **buy** (credits down → item into stash), **sell** (stash item
  or an *optional* equipped item → 75% of price back), **install/equip** (stash → ship; the displaced item
  returns to the stash), **unequip** (ship → stash). A **live ship-stats panel** shows **HP / acceleration /
  maneuverability / weight** with a **▲/▼ delta vs the previous config** on every change (derived client-side;
  the server stays authoritative on the saved config). **Required slots** (hull/engine/thruster) can't be
  sold while equipped and **block take-off when empty** (the button greys out); **optional** equipped items
  (weapons, repair drone, grab) sell directly from the bay. **Looted enemy gear** deposited via `depositLoot`
  (the victory loot deposit) is equippable-from-stash like any part (engines/thrusters/weapons/grab) — hulls
  can't drop, so a looted-hull exploit never arises. On unlock the **basic gun (id 1)** swapped out after
  level 2 is **backfilled into the stash**. **Prices:** the player ladder has draft prices (strawman, see
  `docs/plans/economy-shop-v2.md`) anchored to the **corrected ~5800-credit first-shop budget** (the budget
  includes the ×2 victory bonus per level; a flawless run banks ~4280, retries push it toward ~5800 — so the
  Heavy hull at 6000 is the aspirational big buy); sell = `floor(price*0.75)`, server-computed. The shop
  lists only `price > 0` **and** `buyable !== false` items, so the curated ladder shows and enemy parts (now
  priced for resale but `buyable:false`) don't. Around-model slot icons are a later polish (not built yet).
- **Side missions — in the Main Window's Missions list** (`docs/plans/mission-generator.md` +
  `main-window-redesign.md`). Unlocked **after clearing the campaign** (same gate as the shop). They render
  as the **secondary rows** under the **Missions** menu item (below the primary campaign row); selecting one
  shows its flavor description + est. reward + a **Take off** button in the work zone (`buildMissionList` /
  `renderMissionView`). The three flavors — **mining / research / freighter** (i18n flavor text only) —
  are all the **same difficulty**: waves of **pirate gunner / rocketeer / heavy** (40/40/20 → 35/35/30),
  then a **2-boss finale** (two buffed `first pirate boss`). A mission is just a level-style descriptor played by
  the existing `levelRunner`; clearing it **banks per-kill ×2 credits like a level but does NOT advance the
  story counter** (repeatable grind to fund the shop). **Each mission fights at its own location in the
  world** (`descriptor.center` — mining at `(-550, 0)`, research at `(400, 0)`, freighter at `(-100, -450)`),
  away from the campaign center `(0,0)`. The map is **one shared world** — all set-pieces (the three mission
  structures + the base station at `(-60,-60)`) exist at fixed positions on every level/mission; the mission only
  moves the combat there (you spawn over the matching structure, the others — and the base station you return
  to — are in the distance). They sit **just below the combat plane** (strong
  parallax like the background asteroids). Server-owned (`GET /api/players/:id/missions`,
  gated); rewards bank via the existing `/api/games` (server-sealed per-mission rewards = later integrity
  item). The list refreshes whenever the Main Window is shown (`refreshMissions`).

## Visuals
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
  rebuild (`G.nebulaRT`). See DECISIONS §43.
- Background in 3 layers: stars (varying brightness, a static backdrop) → asteroids (a parallax layer)
  → planet + 2 moons (light parallax). **Stars are two point layers (`makeStars`):** the dim majority
  (small opaque points, power-law brightness — many faint, few less faint) plus a bright **~2%**
  (`brightFraction`, default 0.02) that pops via a **bigger size (5 vs 1.4) + a soft additive glow
  sprite + near-white full-luminance color** — the three cues that make a ~1px point read as brighter.
  The bright layer uses `depthTest: true` (unlike the dim layer) so the planet/moons occlude it and the
  glow can't creep onto the planet disk (the transparency gotcha in DECISIONS §5). **When the nebula is
  baked** (High/Balance, non-`?debug`) this moving parallax layer is thinned to **0.4×** count — the baked
  nebula supplies the dense static field, the point layer only sells depth; on the flat-color path
  (Performance/`?debug`) it keeps full count so the sky isn't empty. The asteroids are a
  **field of small rocks filling the whole disk**
  (annulus `inner`..`spread` radius; `inner` 0 → centered, `spread` 1000 in `home-system`) — inside the
  ±360 arena **and** far beyond it, sunk below the combat plane; the far edge fades into the fog (~600), so
  distant rocks read as a faraway field you can fly out into. Flying past them gives the sense of speed.
- Lighting: **two render passes** — combat (its own scene/light) and sky (its own scene/light with a
  real day/night terminator on the planet and moons).
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
- The planet and moons have minimal **procedural textures** (baked canvas maps, no asset files):
  `makePlanetTexture(ocean)` — an ocean world with depth variation and soft clouds; `makeMoonTexture` —
  craters (darker floor + lighter rim) plus faint maria, per moon from its base color. The bodies
  don't rotate, so the terminator stays consistent.
- **The whole scene is data-driven:** it's described by a JSON **map descriptor** in the DB (`maps`
  table, seeded as `home-system`) and built generically by `buildMap(descriptor)` in `bootstrap()`
  (planet/moons/stars/asteroids/sky-light/set-pieces from params). API: `GET /api/maps/:name`.
- **Dev palette tuning panel (`?tune`, dev-only).** Open the game with `?tune` to get a live lil-gui
  panel for dialing in the backdrop palette: space `background` + `fog` (color/near/far), **sky light**
  (ambient + sun color/intensity/position — the terminator) and **combat light** (ambient + sun
  color/intensity — these affect ship readability, see the two-pass invariant in DECISIONS §5). A
  **"Rebuild planet"** button re-bakes the ocean texture (it's a baked canvas map, so it only re-tints on
  rebuild), and **"Dump palette → console"** prints a labeled `0x`-hex snapshot saying where each value
  goes (sky/background live in the `home-system` map descriptor in `catalog_seed.js`; fog + combat lights
  are currently hardcoded in `client/index.html`). **Never shipped to players:** lil-gui is
  dynamically imported only inside the `?tune` guard, so the default build doesn't fetch it and is
  unchanged. Mirrors the `?debug` dev-hook convention. See `docs/plans/color-tuning.md` and DECISIONS §21.
- **Mission set-pieces (procedural decor).** The descriptor can carry a **`setpieces`** array — large
  structures generated **in code** (no `.glb`) — **except the `freighter`, which loads a real `.glb`
  model** — and added to the **combat `scene`** (so they're lit from
  above by the combat sun, like the ships), sitting **just below the combat plane** (so you fly over them
  with strong parallax, like the background asteroids; `fog: false` keeps them readable). **Decor only —
  NOT registered in the gameplay arrays**, so bullets pass through and the AI ignores them (collidable
  cover is a later scope). Each spec is `{ type, pos, scale, … }`; `buildSetPiece` dispatches to a
  per-type builder, and each set-piece can self-animate (the render loop calls its `update(dt)`). **All
  set-pieces live in ONE shared world** (the `home-system` map holds them at fixed, far-apart positions),
  so they exist on every level/mission; a side mission only changes **where you fight** (its `center`
  spawns you over the matching structure, the others sit at a distance). They're rebuilt each run (so the
  cruising freighter resets). Four builders exist:
  - **`research-station`** — a hub + a ring on spokes, two solar-panel wings, docking modules and
    emissive windows; slowly rotates around its own axis. A `tilt` param tips it off-vertical so the ring
    reads as a 3D wheel from the top-down camera (the research mission uses a light tilt).
  - **`asteroid-field`** — a wide cluster of **irregular, cratered** rocks (noise-deformed icosahedra +
    `makeMoonTexture`, varied sizes; distinct from the round parallax-backdrop asteroids) plus **two
    mining rigs**, each a host rock + a **tilted station** + a **mining beam** (a particle stream flowing
    from the host up to the collector). The rigs are tilted off vertical so the beam reads from the
    top-down camera. Rocks tumble slowly. Tunable: `count`, `spread`, `hostSize`, `beamLen`, `beamTilt`.
  - **`freighter`** — the **first `.glb`-backed set-piece** (all others are procedural). It loads the
    `freighter_combat` combat glb (CC-BY "Freighter - Spaceship"), auto center/scaled (longest axis →
    `FREIGHTER_MODEL_LEN` 130, then `spec.scale`) and **`yaw`-oriented like a ship model** (nose faces +Z;
    `spec.yaw` 0 here — the model already faces +Z with its bridge/engines aft). A standalone loader in
    `makeFreighter` (`world.js`) reuses the shared `gltfLoader` from `ship-factory.js` (meshopt-wired); the
    exhaust is built **synchronously** (a trail shows immediately) and the model is added when it resolves —
    **no procedural box fallback** (on load error → `console.warn`, exhaust keeps running). It keeps a
    **fiery exhaust** particle stream (hot→orange→red), now a **single rear-center emitter** re-derived from
    the loaded model's real group-local rear bounds (`-Z` tail, vertical center, spread scaled to the rear
    width). The exhaust palette + particle params (`palette` hot/mid/end, `count`, `len`, `size`, `speed`)
    are an **optional, server-delivered `exhaust:` effect config** on the set-piece spec (defaults built in
    → look unchanged when omitted) — the light extension point for future server-driven model effects
    (DECISIONS §38). **Cruises slowly forward** (`speed` units/sec — a transport in transit). (A separate
    `sync` + zone-drift escort mechanic exists but no mission turns it on.)
  - **`base-station`** — the **return-to-base target** at `(-60,-60)`, up-left of the arena center (so
    the origin-spawning ship isn't lost against its backdrop). A `.glb`-backed set-piece (`base_station_combat`, CC-BY 4.0 "Low Poly space station." by MisterH)
    loaded by `makeBaseStation` (`world.js`, mirroring the freighter's async center/scale/`yaw` normalization
    but with **no exhaust**), auto-scaled (longest axis → `BASE_STATION_LEN` 100) with an optional slow idle
    `spin` (0.03 rad/s). It sits at `pos.y = -42` — raised **closer to the plane than the freighter** (`-48`)
    so it reads clearly top-down, but the source model is tall (y ≈ 0.78 of its longest axis) so its **top lands
    at ~y = -2.9**, safely below the ships (`y ≈ 0.6`) so it never occludes them (DECISIONS §17). NON-collidable
    like the others. `buildSetPiece` stashes it on `G.baseStation = { obj, active }` so the sim/HUD/click code
    can find it; it's the clickable autopilot target for the return-to-base flow (see Level flow / Victory).
  See `docs/plans/mission-maps.md`. (Collidable cover is later scope.)
- **Wing-bank on turn:** every ship (player + enemies) **rolls its wings into a turn**, a smooth tilt
  capped at **20°** (`BANK_MAX`) that eases back to level when straight. `updateBank` derives the roll from
  the **actual per-frame heading change** (vs the max possible `turnRate*dt`), eases it with `BANK_TAU`
  (0.15 s, frame-rate-independent), and applies it as `bankGroup.rotation.z` (the inner bank group, so it
  composes with the root's heading yaw + scale and the model's `modelYaw` without fighting them). One path
  covers keyboard, touch, warp-back and enemy AI turning. **Cosmetic only** — nothing gameplay reads the
  roll (aim/forward use `heading`; collisions use the OBB hitbox, whose boxes ride `mesh.matrixWorld`
  — which excludes the child `bankGroup` roll — so the cosmetic roll never shifts the hitbox).
- **Enemy spawn ("warp in"):** a newly spawned enemy grows from a dot to its full size over
  `SPAWN_GROW_TIME` (1 s, ease-out cubic) — it scales up in place while the AI is already active.
- Effects: a bullet hit-flash at the impact point, **keyed off the weapon `class`** via the client
  `HIT_FLASH_SCALE` map (`kinetic`/unset → a tiny `maxScale 0.8` spark, `cannon` → a heavier but still
  small `maxScale 2` flash; color unchanged); a narrow glowing engine trail on **every ship**
  (player and enemies), via the shared `emitExhaust` — particle speed = ship speed + ejection backward
  along the nozzle, colored by the engine's `exhaust.color`, emitted while thrusting forward.
- **Muzzle / exhaust spawn from the model's real bounds.** Bullets/rockets leave the **nose** and exhaust
  the **engines** because `applyShipModel` caches each glb's forward/back extent (`mesh.userData.noseZ` /
  `tailZ`, group-local); `fireMount` + `emitExhaust` spawn there × the mesh's current world scale (so it
  tracks spawn-grow). Replaces the old fixed `fwd*3` / `fwd*-2.6` offsets that floated in empty space ahead
  of a wingspan-dominant model (the primitive fallback keeps the old ±1.6 values).
- **Ship destruction** (`spawnShipExplosion`): a destroyed ship bursts in a layered fireball
  (white-hot flash → exhaust-colored glow → orange → red cloud), a radial spray of sparks, and an
  expanding shockwave ring — much louder than the hit micro-flash, and slow (~3.75 s). **Sized to the
  ship** (scales by `sizeScale`) and **tinted by the engine's exhaust color** (`engine.exhaust.color` —
  the glow layer, accent sparks and ring), so the player's burst is cyan-blue, enemies' orange. Used on
  enemy and player death. An enemy death also spawns a floating `+xx` credit popup at the kill site (see
  the HUD "Kill credit popups").
- **Rocket detonation** (`spawnRocketBurst`): a rocket blast uses the same layered structure (fireball
  layers + a few sparks + a shockwave ring) but **shrunk and fast**, so it reads as a proper explosion
  rather than one glowing sphere. Its **size, speed and tint are data-driven** from the rocket's weapon
  stats — `blastVisual` (size), `blastTimeScale` (lifetime multiplier; `0.8` = 20% quicker) and
  `blastTint` (color). Reuses the same particle pools + `G.gfx` tier gating as the ship burst — distinct
  from the (unchanged) ship-death `spawnShipExplosion`.
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
  the synth** if the buffer/key is missing. **Routing lives in the DB, not the client:** two tables —
  **`sounds`** (`key → url + gain`, the asset registry) and **`sound_map`** (`(entity, class, event) → sound
  key`) — seeded from `SOUNDS`/`SOUND_MAP` in `catalog_seed.js`. Each **ship**/**weapon** carries a
  **`stats.class`** (ship `fighter`/`capital`/`player`; weapon `kinetic`/`cannon`/`rocket`). The per-sound
  **`gain`** (default 1) is a playback trim applied on top of the baked-in file volume — the client preloads
  it via `audio.setSampleGains(...)` and `playSample` multiplies each one-shot by it (currently `kinetic`
  machine-gun fire is at **0.7**, i.e. −30%). The client
  fetches both via **`GET /api/sounds`** in `bootstrap()`, preloads every `sounds` url, and resolves at each
  call site with **`sfxFor(entity, class, event)`** (e.g. ship death → `sfxFor('ship', e.class, 'explode')`;
  gun fire → `sfxFor('weapon', w.class, 'fire')`; rocket detonation resolves `(weapon, class, 'explode')`,
  stored on the rocket at spawn). Adding a ship/weapon = give it a `class` + (if new) a `sound_map` row; no
  client edit. Current map: weapon `kinetic`→`kinetic` (glock) on guns 1/5/7, `cannon`→`cannon` on Heavy
  cannon (6), `rocket`→`rocket` launch on player rockets (3/8) + `rocket` detonation→`blast`; ship
  `fighter`→`blast` (small), `capital`→`shipBoom` (medium/large), `player`→`shipBoom` death + `shipHit` when
  struck. **Enemy fire is silent** — both bullet fire and rocket-launch SFX are gated to `isPlayer` at the
  call site (`fireMount`), so only the player's own shots are audible; **enemy rocket *detonations* still
  play** (the blast SFX is ungated). Sample bytes live on S3 (`sfx/`),
  pulled same-origin into `client/assets/sounds/` — see the asset pipeline.
- **Music** is **sampled, looping background tracks** (no more generative synth). Routed through the same
  DB map under **`entity: 'scene'`** — `(scene, 'hangar', 'music')` / `(scene, 'combat', 'music')` → track
  key(s). **Hangar** has one track (`music_hangar_1`); **combat** rotates two (`music_combat_1` CC0 +
  `music_combat_2` "Energetic Synthwave", Pixabay Content License). The client passes the per-scene lists to `audio.setMusicTracks(...)`; `audio.setScene()` (via
  `refreshMusic()`, called at every state change) **crossfades** (~0.8 s) to a **random track** of the new
  scene — **combat** during a live fight, **hangar** on menus/overlays/while paused. A scene with one track
  loops it seamlessly; **multiple tracks per scene rotate at random** (no immediate repeat) — add more rows
  with the same `(scene, …, 'music')` in `SOUND_MAP`. Tracks are stereo mp3s preloaded with the SFX; if a
  track isn't decoded yet when the scene starts, the preload-completion hook starts it. Volume follows the
  Music slider/toggle (`musicGain`).
- **Settings menu — the project's dedicated settings screen.** A ⚙ **gear**
  (`#settings-btn`, **top-left corner, always visible** — incl. during a live fight; the HUD Health block is
  padded right so the gear never overlaps it) opens a modal (`#settings-overlay`). **Opening it doubles as
  pause:** during a live fight the gear freezes the battle (like the pause button) and opens the menu in one
  click; **closing resumes** — but only if the gear is what paused it (a manual pause stays paused). The
  modal has **Master / Music / SFX volume** sliders + **Music/SFX on-off toggles**, a **Graphics
  quality** selector (see below), and a **danger zone: "Reset my progress"** (see next). Changes apply live
  and persist to `localStorage` (audio keys `audioMaster`,
  `audioMusic`, `audioSfx`, `audioMusicOn`, `audioSfxOn`); a fresh player gets sane defaults
  (master .7 / music .45 / sfx .8, both on). Language/zoom stay where they are. **Mobile-fit:** the modal
  is sized so nothing overflows on a narrow phone — sliders are shrinkable + capped (not fixed-width),
  the quality buttons size to their text, fonts/paddings/row-gaps are compact, horizontal padding is
  `clamp`ed, and the box `max-height: 98vh` (everything fits without internal scroll on a 1280×800 viewport).
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
  only blurred the image for no fps gain). Per tier: **pixel-ratio cap** (2 / 1.5 / 1), **antialias** (on /
  off / off), **star density** ×(1 / .6 / .35), **particle density** ×(1 / .6 / .4 — scales spark count,
  drops the 2 middle fireball layers + the shockwave, and thins the exhaust), and **maxParticles** (∞ / ∞ /
  **300** — a hard ceiling on live additive particles, exhaust trail + sparks + **rocket smoke**
  (`liveParticles()` now counts smoke, and `spawnSmoke` honors the ceiling + `particleScale`); new emits
  skip over budget, capping per-frame JS / draw-call submit). maxParticles is **off (∞) on High & Balance**. Persisted in
  `localStorage` (key `gfxTier`). **Default High**; a touch device's **first run defaults to Balance**. **Picking a tier
  reloads the page** so the whole preset (antialias — a `WebGLRenderer` constructor arg — + pixel ratio +
  star/particle density) applies cleanly from startup, no half-applied state (server-side progress is
  untouched). The selector sits below its label (the 3 buttons share one row). The tier knob table lives
  in `graphics.js` (pure, tested).

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
  player's browser language). An **EN/RU toggle** on the welcome screen switches live (no reload), re-rendering
  chrome + DB-sourced names. `POST /api/players/:id/language` (validates `en`/`ru`) stores it; `registerPlayer`
  / active-ship return it.

## Backend
- **Node.js + Express** server (`server/`): serves the game client (static) AND a JSON API on
  the same origin (no CORS).
- **Storage is pluggable** (`datastore.js`): **Postgres** when `DATABASE_URL` is set (production),
  otherwise **SQLite** via built-in `node:sqlite` (local dev / tests). Same async API either way
  (`db.js` = SQLite, `db_postgres.js` = Postgres via `pg`).
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
- **Player progress:** `players.current_progress` stores the player's currently-available level — an
  integer **foreign key into `levels(id)`** (a real, enforced FK in Postgres; a plain integer in SQLite,
  whose `ALTER TABLE` can't add a FK column with a non-null default, and which doesn't enforce FKs
  anyway). Defaults to **1** (`level-1`). `registerPlayer` returns it as `currentProgress`;
  `GET /api/players/:id/level` returns that level's descriptor; `POST /api/players/:id/advance` unlocks
  the next level (smallest level id greater than the current — gap-tolerant; a no-op at the last level),
  runs the newly-unlocked level's `briefing.actions` server-side, and returns its `briefing` message.
- **Game history & credits:** at the end of each run the client posts `{ credits, kills, durationMs }`
  to `/api/games`; the server stores it (`games.credits`, renamed from `score` in migration 008) **and
  banks the earned credits** into `players.credits` (the persistent balance, default **1000** for new
  players, no FK), returning the new balance. `registerPlayer`/active-ship also return `credits`.
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
  by `level-4`'s **`unlockShop`** briefing action (i.e. on **clearing `level-3`**, the original campaign end),
  or as a fallback when a player advances off the final level; it also **backfills the basic gun (id 1)** into
  the stash. `replaceWeapon` briefing actions also deposit the replaced weapon.
  Datastore methods (both backends, server-authoritative + transactional): `getStash` (joined to the catalog),
  `buyItem` (price ≤ balance → deduct → qty++), `sellItem` (stash item, or an *optional* equipped item via a
  `slot` → credit `floor(price*0.75)`), `equipItem` (stash → active ship; component slots by `type`, weapons
  by fire-group; the displaced item returns to the stash), `unequipItem` (slot → stash; required slots allowed
  but then take-off is blocked), and **`depositLoot`** (bulk-adds a mission's collected loot items into the
  stash inside one transaction — the victory loot deposit; **not** shop-gated). Component slots =
  `{hull, engine, thruster, repair, grab}` (`grab` is optional + sellable-while-equipped, like `repair`).
  `getActivePlayerShip` now also returns **`shopUnlocked`**, **`launchable`**,
  and **`missingRequired`** (empty required slots).
- **Maps & levels:** `maps` table holds a JSON scene `descriptor` per map (seeded as `home-system`;
  background, sky light, planet, moons, stars, asteroids, and an optional **`setpieces`** array of
  procedural mission decor), built by `buildMap`. `levels` table holds a JSON descriptor per level (a map + a phase/wave script,
  seeded as `level-1`/`level-2`/`level-3`), played by the client's `levelRunner`. Served via `GET /api/maps/:name` and
  `GET /api/levels/:name`.
- **Side missions:** `server/src/missions.js` is a stateless generator (`generateMissions()`) that emits
  the 3 flavored side-mission descriptors (same composition; see Gameplay). `GET /api/players/:id/missions`
  returns them, **gated by `shop_unlocked`** (403 until the campaign is cleared). Each descriptor carries
  `sideMission: true`; the client plays it via `levelRunner` and banks via `/api/games` without advancing
  progress. No new table (server-sealed rewards = later integrity item).
- API: `POST /api/players/register`, `POST /api/games`, `GET /api/players/:id/games`,
  `GET /api/health`, `GET /api/ships`, `GET /api/weapons`, `GET /api/components`,
  `GET /api/players/:id/active-ship`, `GET /api/players/:id/level`, `POST /api/players/:id/advance`,
  `POST /api/players/:id/reset` (player-initiated progress reset → new-player baseline; 404 if unknown),
  `GET /api/players/:id/stash`, `POST /api/players/:id/buy`, `.../sell`, `.../equip`, `.../unequip`
  (hangar shop; 403 until the shop is unlocked), `POST /api/players/:id/loot` (victory loot deposit → stash;
  **not** shop-gated), `GET /api/players/:id/missions` (side-mission board; 403 until unlocked),
  `POST /api/players/:id/language`, `POST /api/players/:id/username`, `GET /api/maps/:name`,
  `GET /api/levels/:name`, the auth routes (`POST /api/auth/register`, `/login`, `/logout`,
  `POST /api/auth/resend-verification`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`,
  `GET /api/auth/me`, `GET /api/auth/verify`), plus
  `GET /api/config` (public client config), `POST /api/events` (funnel telemetry) and
  `POST /api/perf` (client perf samples from the `?dev` monitor — write-only diagnostic telemetry).
- **Admin dashboard (`GET /admin`, `server/src/admin.js`):** a private, **server-rendered** HTML page
  listing every player (id short, username, email, email_verified, created_at, last_seen,
  current_progress, credits, games_played, referrer) plus per-player aggregates from `games` (total time
  played, total kills, total earned), one aggregated query `players LEFT JOIN games GROUP BY player`
  ordered `last_seen DESC`, hard-capped at **1000 rows** — via the `getAdminPlayers` datastore fn (both
  backends; Postgres coerces the BIGINT `SUM`s with `Number()` and `email_verified` with `!!Number()`).
  Client-side click-to-sort per column (inline JS); no pagination/search/export. Protected by **HTTP
  Basic Auth** (`ADMIN_USER` / `ADMIN_PASSWORD` from the server `.env`, compared with
  `crypto.timingSafeEqual`); **404 (disabled) when either env var is unset**, so it's never wide open on
  prod. Mounted outside `/api`, so the `/api`-scoped CORS never touches it (same-origin only).
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
    (`devPerf` in `index.html`) that times the JS work each frame — **`update` (sim) / `dom` (HUD, markers,
    minimap, OOB) / `render` (the two-pass submit)** — and once per second emits an aggregated **sample**:
    `fps`, `frameMs` (p50/p95/max), the `js` breakdown (means + `totalP95`), a `jank` count (frames >
    1.5× p50), scene `load` (enemies/particles/draws/tris), **`heap`** (JS-heap MB — `used`/`total`/`limit`
    via `performance.memory`; Chrome-only, **not** process RSS or GPU memory, `null` elsewhere), backbuffer
    `res`, and a one-time **device
    passport** (`ua`, `dpr`, `cores`, `mem`, `screen`, real **`gpu`** via `WEBGL_debug_renderer_info`, the
    `tier` + its `knobs`). Batched to **`POST /api/perf`** (`{ playerId, sessionId, samples:[…] }`, cap
    120/batch) every ~5 s and on tab-hide (`sendBeacon`); the perf overlay shows a `●dev` marker while
    recording. **Off — zero overhead — without `?dev`.** Write-only over HTTP (no public read); analyze
    with plain SQL over `perf_samples` (the key tell: if `js.total` ≪ `frameMs.p50` the frame isn't
    CPU-bound → external/GPU-governed). Not wiped by a player reset. See DECISIONS §23 +
    `docs/plans/perf-low-end-phones.md`.

### Accounts / authentication (DECISIONS §11)
- **Anonymous-first, optional account.** Players keep the localStorage UUID and auto-register as
  before. **After clearing level 1** the client prompts (once) for a **username** (display name) and
  offers to **create an account**. Decline → keep playing as a guest (the username is still saved).
  Accept → email + password **upgrade the same `players` row in place** (progress preserved).
- **Account bar (menu screens).** A signed-in account shows "Signed in as …" (`ui.account.signed_in_as`);
  a guest who set a callsign at the level-1 prompt shows **"Playing as <name>"** (`ui.account.guest_named`),
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
  Postgres bootstrap). Email uniqueness via a **partial unique index** (`WHERE email IS NOT NULL`,
  since SQLite can't add a UNIQUE column). New `sessions` table (real FK on `player_id` in Postgres;
  logical FK in SQLite).
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
- **Schema:** SQLite uses a versioned migration runner (`migrate.js`, `PRAGMA user_version`);
  Postgres uses idempotent `CREATE TABLE IF NOT EXISTS` bootstrap (versioned PG migrations: TODO).
  Migrations run on startup; `npm run migrate` runs them for the active backend.
- **Catalog seeding (data safety):** `server/src/catalog_seed.js` is the single source of truth for the
  **reference tables** (`components`, `weapons`, `ships`, `maps`, `levels`). On **every server startup** both backends
  **upsert** these rows from the seed (`INSERT … ON CONFLICT DO UPDATE`, keyed by weapon `id` / ship/map/
  level `name`) — so editing `catalog_seed.js` ships content/balance changes to prod on the next deploy.
  This is **update-and-insert, not a wipe** — with one exception: **orphaned `enemy` ships are pruned**
  (a rename/removal would otherwise leave the old enemy row lingering). The prune deletes only
  `type='enemy'` rows no longer in the seed **and owned by no player** (enemies never are), so a player
  can't lose an owned ship; other removed/renamed entries (components/weapons/maps/levels/player ships)
  still linger harmlessly. **Player data is never touched by seeding** — `players`,
  `games`, `player_ships` persist across deploys. (If we ever want the catalog editable in prod, switch to
  seed-only-when-empty + migrations for changes.)
- **Player-data reset (admin):** `server/src/reset.js` is a CLI for wiping *progress* (never the
  catalog). Two modes, both implemented per-backend in `db.js`/`db_postgres.js` (`resetPlayer` /
  `resetAllPlayers`, re-exported via `datastore.js`): **`--player <id>`** clears one player's games,
  ships, stash and events and resets level/credits/shop to the new-player baseline (re-granting the
  starter ship) while **keeping the account, login session and language** (per-player SQL DELETEs,
  correct for SQLite + Postgres); **`--all --yes`** wipes every player-scoped table (fresh DB —
  SQLite `DELETE`s + `sqlite_sequence` reset; Postgres `TRUNCATE … RESTART IDENTITY CASCADE`), leaving
  the catalog to re-seed on startup. Backend is auto-selected by `DATABASE_URL` (local SQLite unless
  set). Wrapped by the **`reset-progress`** skill (`.claude/skills/reset-progress/`). The **per-player**
  reset is also reachable by players themselves via **`POST /api/players/:id/reset`** (the settings
  "Reset my progress" control) — same `resetPlayer` op. See DECISIONS §19.
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
- **CI/CD:** `.github/workflows/ci-cd.yml` — runs client + server tests on every push/PR (incl.
  PR merges), and on push to `main` deploys. Secrets: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`.
- **Server tests run against BOTH backends.** The `server.test.js` suite is backend-agnostic (the
  backend is chosen by `DATABASE_URL`). The `test` CI job runs it twice — once on SQLite
  (`npm test`) and once against a throwaway `postgres:16` service container
  (`DATABASE_URL=… npm test`) — so Postgres-only regressions that SQLite's loose typing hides (e.g. a
  JS boolean written to an `INTEGER` column) get caught. On Postgres the suite first
  `resetAllPlayers()`-truncates for a clean slate (catalog kept). Locally: `npm run test:pg`
  (defaults to `postgres://localhost:5432/spacegame_test` — `createdb spacegame_test` once first).
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

## Client module layout (`client/src/`)
`index.html` is now just markup + the `three` importmap + `<script type="module">import './src/main.js'</script>`
— **no inline game code remains**. The client is buildless native ES modules (no bundler; `three` resolved
by the importmap). See `docs/plans/client-code-structure.md` and DECISIONS for the rationale and the
`G`-state-bag pattern.
- **Pure, Three.js-free logic (unit-tested):** `components.js` (catalogs + `deriveDrive` + `shipMass` +
  `hitsToKill` + `repairTick`), `drops-config.js` (the loot-drop constants incl. the single `DROP_MODEL_URL`,
  plus the pure `pullSpeed`/`pickLoot` — import-free so `scripts/assets-check.mjs` + node tests can use it),
  `steering.js` (`headingToDir`, `shortestAngleDelta`, `steerToward`,
  `enemyThrustFactor`, `inForwardSector`), `i18n.js` (`t`, `resolveLanguage`, `normalizeLang`,
  `loadLanguage`), `audio.js` (procedural Web Audio engine + the pure settings helpers, engine
  browser-only), and `format.js` (`esc`/`cssColor`/`slotLabel`/`priceLabel`/`sellLabel`).
- **Shared state & engine:** `state.js` (entity collections + `CATALOG` + input + the mutable `G` state
  bag for reassigned cross-module scalars: `gfx`/`rotated`/`player`/`sky`/`stars`/… + the run/account
  scalars `kills`/`earned`/`balance` + the backend/funnel scalars `playerId`/`banked`/`gameStartTime`/
  `gameStartSent`/`quitSent`/`pendingBriefing` + the selection scalars `activeShip`/`currentShipName`/
  `activeMission` + `SPAWN_GROW_TIME`), `engine.js` (`renderer`/`scene`/`skyScene`/
  `camera`/lights + orientation + zoom), `dom.js` (the single fail-loud `el` inventory of shared
  index.html nodes — HUD readouts + the result `overlay`; a missing id throws on boot).
- **Domains (browser-only, touch the scene):** `world.js` (arena + sky/planet/moons/asteroids/set-pieces +
  `buildMap`), `ship-factory.js` (`makeShip`/`applyShipModel` + `gltfLoader`), `projectiles.js`
  (bullets/explosions/exhaust/rockets/smoke FX), `ship-build.js` (catalog resolution + `buildPlayer`/
  `buildPlayerFor` + enemy spawning + fire groups), `drops.js` (loot drops + the Grab tractor sim: the
  `drops[]`/`pendingLoot` arrays, `spawnDrop`/`updateDrops`/`collect` + the pooled blue pull line + the
  victory `takeLoot`/`clearDrops`), `sound-routing.js` (the `audio` engine instance + `tracksFor`/`sfxFor`),
  `hud.js` (the per-frame draws `updateHud`/`updateMarkers`/`updateMiniMap`/`updatePerf`), `net.js`
  (backend identity/banking/progression + funnel telemetry: `fetchJson`/`bankRun`/`track`/
  `currentLevelLabel`/`unlockNextLevel`/`depositLoot`), `sim.js` (the per-frame `update(dt)` + `levelRunner` + wing-bank +
  soft-boundary warp/OOB warning + music routing `refreshMusic` + pause `setPaused`/`togglePause`/
  `autoPauseOnBlur` + the `reset` restart), `tune.js` (the dev-only `?tune` palette panel `buildTunePanel`).
- **Between-battles UI:** `shop.js` (hangar shop + stash + live ship-stats bar; a leaf the Main Window
  calls into), `settings.js` (audio-settings gear modal + graphics-quality picker + slide-to-confirm
  progress reset; a leaf whose only outward export is `localizeSettings`), `mainwindow.js` (the Main Window
  — `showMain`/`selectMenu`/mission board/`launchCampaign`/`launchMission`/`refreshMissions` + the ship-
  preview and briefing-item model viewers), `welcome.js` (ship-picker/`takeOff` + the i18n UI glue
  `applyTranslations`/EN-RU switch + the fullscreen helper), `account.js` (auth block + `initSentry` +
  `restoreSession`/`reloadPlayerWorld`). These four (`mainwindow`/`account`/`welcome` + `settings`/`shop`)
  form the coupled landing-screen cluster — `mainwindow`↔`account`↔`welcome` is a runtime import cycle that
  ESM resolves (edges fire on user actions, not module init).
- **Composition root:** `main.js` (~540 lines) — imports + input/touch/zoom wiring + the `?dev` `devPerf`
  monitor + `animate`/`prewarmShaders` + the `?debug` `window.__game` test hook + `bootstrap()` (fetch the
  DB catalog/level/active-ship, build the world + player, restore the session, show the landing screen).
- Because the client uses ES modules, it must be **served over http** (not opened as `file://`).

## Tests (built-in `node:test`, no deps)
- **Client logic** — `client/src/*.test.js`: drive derivation (engine + mass, incl. the grab slot + the
  mass-neutral 48+2=50 baseline), balance, repair-drone
  regen (`repairTick`: per-interval heal, multi-tick, 80% cap, no-op cases, mass), **loot drops**
  (`drops.test.js`: `pullSpeed` anchor cases + weight fallback, range = strength, `pickLoot` only draws
  engine/thruster/weapon ids — **never the hull**), steering math,
  i18n (`t()` resolution/fallback/interpolation, language resolution order, browser-lang mapping), and
  **audio settings** (`clamp01`, `loadAudioSettings`/`saveAudioSettings` round-trip + defaults + garbage
  handling, `effectiveGain` master×channel×toggle). Run: `cd client && npm test`.
- **Backend API** — `server/src/server.test.js` (52): register / record game + credit banking / history /
  validation / health / serves client / ships + weapons + components + maps + levels catalog + active ship +
  player progress (current level + advance) + **progress reset** (per-player → new-player baseline, unknown→404) +
  language preference + credits balance + level briefings
  (level-2 weapon swap, level-3 repair-drone install) + repair-drone component seed +
  **hangar shop/stash** (lock until the final level is cleared, unlock + basic-gun backfill, buy/sell/equip/
  unequip, optional-vs-required equipped sell, take-off launch gating, no double-spend, net-zero same-id equip,
  real-price buy/sell/overspend-402, the priced player-shop ladder is seeded) +
  **Grab + loot drops** (Grab components 29/30 seeded, enemy parts priced with `buyable:false`, player starts
  with the base grab; `POST /loot` deposits collected drops into the stash + empty/absent = no-op 200; a
  looted grab equips into its optional slot and round-trips through the stash — **run on both backends via
  `npm run test:pg`**, which exercises the `withTx`/`client` deposit path SQLite-only runs miss) +
  **side missions** (`/missions` 403 until unlocked → 3 same-difficulty offers with the 2-boss composition;
  pirate gunner + Pirate machine gun id 9 seeded; boss guns swapped to the MG) +
  **auth** (username, register happy/duplicate-409/weak-400, login happy/wrong-401, `/me` authed vs 401,
  logout clears the session, verify-token flips `email_verified`, cross-device login adopts progress) +
  **monitoring** (`/api/config` returns `sentry:null` when unset; `/api/events` 204 allowlisted / 400
  junk / batch).
  Mounts the Express app on an ephemeral port against a temp SQLite DB (`DB_PATH` env, `NODE_ENV=test`)
  — the real `game.db` is untouched; SES uses its no-creds outbox. Run: `cd server && npm test`.
- **Auth unit** — `server/src/auth.test.js` (5): scrypt round-trip (right/wrong password), per-user
  salt, token uniqueness + SHA-256 hashing, cookie-header parsing.
- The backend was made testable: `server.js` exports `createApp()` (no auto-listen; listens only when
  run directly), `db.js` honors `DB_PATH`.
- **Visual / e2e** — `client/visual/` (Playwright headless, **not in CI**): boots the real game and
  asserts on simulation state (particle counts, size ratios, exhaust colors) via a `?debug`-gated
  `window.__game` hook; saves frames to `__screenshots__/` for review (no pixel diffing). Scenarios:
  smoke, ship-explosion, exhaust-trail, combat, **hangar-shop** (unlock the shop, render the bay +
  live stats, install from the stash), pause, mobile-hangar, and **arena-boundaries** (the ship flies past
  the edge unclamped, the out-of-bounds warning shows after the grace delay, `warpPlayerToCenter` recenters +
  zeroes velocity, and the edge marker + mini-map exist), and **mission-setpieces** (all three procedural
  set-pieces are built into the combat scene below the plane and multi-part; the station rotates; the
  drifting-arena mechanic moves the center/border and the synced freighter, and warp-back targets the drifted
  center), **mission-board** (after clearing the campaign, 3 mission buttons appear top-right, a button
  opens the description panel, and Take off launches a `sideMission` via the levelRunner), **l4-enemies**
  (the Advanced medium pirate + Second Boss build with the right HP/tint/mounts/derived drive), and
  **audio** (the settings gear opens the audio modal; the Master slider + Music toggle reach the engine and
  persist to `localStorage`; the gear hides during a live fight), **ship-bank** (the player rolls into a turn,
  capped ≤20°, eases back to level on release, opposite turns bank opposite ways, enemies have a bank group),
  and **reset-progress** (the settings modal fits the viewport with no internal scroll; the slide-to-confirm
  arms only on a near-full drag and opens the confirm dialog; Cancel snaps it back; Confirm POSTs `/reset`),
  and **triple-spiral-rocket** (firing the id-11 spiral weapon spawns exactly 1 invisible leader + 3 visible
  warheads into the `rockets` pool, and the whole volley drains to 0 after homing + detonation — the leader
  self-removes once its last child is gone, no leaked entries).
  Self-contained runner starts its own server + throwaway DB. Setup
  + run from `client/`:
  `npm install && npx playwright install chromium && npm run test:visual`. A stable, growing suite for
  occasional larger releases. See `client/visual/README.md`.

## Project structure
- `client/` — the game (Three.js): `index.html` (markup + importmap + inline module script being
  split out), `styles.css` (extracted CSS), `src/*.js` (ES modules); `client/locales/` — i18n catalogs
  (`source.json` + `<lang>.json`); `server/` — Node.js/Express backend + SQLite; `docs/` — documentation.
