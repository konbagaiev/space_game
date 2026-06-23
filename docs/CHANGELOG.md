# Changelog

> Change log, newest on top. Append-only (we don't edit history).
> Current state is in [SUMMARY.md](SUMMARY.md).

## 2026-06-23

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
