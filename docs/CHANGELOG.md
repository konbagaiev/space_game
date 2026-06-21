# Changelog

> Change log, newest on top. Append-only (we don't edit history).
> Current state is in [SUMMARY.md](SUMMARY.md).

## 2026-06-21

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
