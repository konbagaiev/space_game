# Changelog

> Change log, newest on top. Append-only (we don't edit history).
> Current state is in [SUMMARY.md](SUMMARY.md).

## 2026-06-29

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
