# Current state (SUMMARY)

> A living snapshot of "how things are now". Updated with every change.
> Change history is in [CHANGELOG.md](CHANGELOG.md). Rationale is in [DECISIONS.md](DECISIONS.md).

**Updated:** 2026-06-21

## What this is
**Vega Sentinels** — a browser prototype built on Three.js (`client/index.html`): little spaceships
fighting on a plane. Opens in a browser with no installation (Three.js from a CDN).

## Controls
- `W`/`↑` — thrust forward, `S`/`↓` — backward
- `A`/`D` or `←`/`→` — turn the nose
- `Space` — fire (primary weapon)
- `F` — rocket (homing, 5 s cooldown)
- **Touch (mobile browsers):** "steer toward direction" — the angle of the left stick = desired
  nose direction (the ship turns toward it), the magnitude of deflection = thrust; on the right are the
  "FIRE" and "🚀" (rocket) buttons. Shown only on touch devices.

## Tools
- **Perf overlay** at the top center: FPS, frame time (ms), draw calls, triangles
  (across both render passes). A proxy for hardware load.
- **Rocket cooldown indicator** — the 🚀 circle (bottom-right) fills radially as it reloads
  (orange while reloading, green when ready). Shown on both PC and mobile; on PC it's also
  clickable to fire (besides the `F` key), on mobile it's the rocket button.
- **Off-screen enemy markers** — for each enemy that's off-screen, an arrow on the screen edge points
  toward it, tinted by the enemy's type color (`updateMarkers`, a pooled DOM overlay). Hidden while an
  overlay (game over / victory) is up.

## Ship model (DB-driven)
Ships, components and weapons are **defined in the database** (`ships`, `components`, `weapons`); the
client fetches them on startup (`bootstrap()`) and assembles every ship from that data. Only the pure
derivation (`deriveDrive`/`shipMass` in `client/src/components.js`) stays client-side. A ship is a
**hull + an engine + maneuvering thrusters** (referenced by id in the ship's `components` field) plus
**mounted weapons** (`stats.mounts`). `stats` (JSON) also carry **fire `groups`** (named channels — a
key for the player, an AI range/aim rule for enemies), `role`, `color`, `sizeScale`. A `mount` = a
weapon id, its `group`, a lateral `offset` (side-by-side fire), a `delay` (staggered volley); a ship
can mount several of the same weapon (the mini-boss has two rocket launchers). The player's active ship
+ its loadout/components overrides come from `player_ships` (see Backend).
- **Components** (DB `components`, `type` `hull`/`engine`/`thruster`/`repair`; `weight` column + `stats`
  JSON): a **hull** has `{ durability (= maxHp), volume }`; an **engine** has `{ power → acceleration,
  maxSpeed, exhaust }`; a **thruster** has `{ power → maneuverability (turn rate) }`; a **repair drone**
  (4th type) has `{ repairPerTick, intervalSec, maxFraction }` → passive hull regen. Seeded: hulls
  Basic(100hp)/Light(30hp)/Medium(150hp)/Boss(210hp); engines + thrusters Basic/Scout/Medium/Boss; one
  **Repair drone** (id 12: heal 1 HP / 3 s, capped at 80% of max HP). The fighter, rocketeer and the
  medium (ex-mini-boss) share the **same Scout engine**; fighter + rocketeer also share the Scout
  thrusters, while the medium has weak (Medium) thrusters → it's sluggish.
- **Repair drone:** installed on the player's ship via the **level-3 briefing** (server-authoritative
  `installComponent` action; persisted in `player_ships.components.repair`). During live combat the
  client ticks `repairTick` (pure, in `components.js`) each frame, slowly healing the hull up to the
  80% cap — never higher, never reducing hp; banked time is cleared once topped up. Its `weight` (4)
  counts toward mass like any component.
- **Mass** = hull + engine + thruster + repair-drone weight + every mounted weapon's `weight` (`shipMass`).
  Acceleration and turn rate are **derived AND scaled by mass** (`deriveDrive`): `massFactor =
  REFERENCE_MASS / mass`; `acceleration = engine.power × massFactor`, `turnRate = thruster.power ×
  massFactor`. `REFERENCE_MASS` = 48 (the player's loadout: hull 20 + engine 10 + thrusters 4 + gun 6 + rocket 8)
  keeps the player at accel 10 / turn 2.0; heavier ships are slower & less agile.
- **Visual model:** each ship's `model_url` (in the DB) points to a `.glb` (the exported primitives
  live in `client/assets/ships/`, e.g. `player.glb`); `makeShip` shows the primitive while it loads /
  as a fallback, and `applyShipModel` auto-centers/scales/tints/orients it. Swap a `model_url` for a
  real model later. See `client/assets/README.md` + `CREDITS.md`.
- **Weapons** (DB `weapons`, type `bullet`/`rocket`): bullets — `power` (damage), `projectileSpeed`,
  `maxRange`, `fireCooldown`; rockets — `power`, `accel`, `turnRate`, `launchSpeed`, `maxRange`,
  `health` (HP it can absorb from gunfire), `seekHalfAngle`, `detonateRadius`, `blastRadius` (AoE). The
  player's homing rocket seeks the nearest enemy in a forward cone and trails smoke; a bullet subtracts
  its `power` from an opposite-side rocket's HP, shooting it down at 0 (enemy rocket 20 HP = two player
  gun hits). Seeded bullets: **Basic kinetic** (id 1, power 10 / cooldown 0.18), **Kinetic (enemy)** (id 2),
  and **Machine Gun** (id 5 — rapid-fire kinetic: power 7, cooldown 0.1, projectile speed 50, range 100,
  weight 8). Rockets: **Rocket (homing)** (id 3), **Rocket (enemy)** (id 4).
- **Enemy types** (DB ships, `type` `enemy`, `stats.role`): `fighter` (red, gun, 30 hp light hull),
  `rocketeer` (yellow, gun + rocket, same 30 hp light hull), `medium` (purple ex-mini-boss, two rocket
  launchers, 150 hp medium hull → sluggish, 2× model), and the `boss` (`first boss` — orange, its own
  `boss.glb` model + own hull/engine, 210 hp, 3× model, two guns + two rocket launchers; spawned only
  in the level's boss phase). Which enemies spawn is decided by the **level** (see Gameplay), not the
  ship; ship `radius` scales with model size. Each enemy also carries a **`reward`** (`stats.reward`,
  fighter 20 / rocketeer 40 / medium 100 / boss 200) in **credits**, earned on destruction.
- **Balance reference:** player — 100 hp hull, gun 10 damage; basic enemy — 20 hp hull, gun 5 damage
  (an enemy dies in 2 player hits; the player survives 20 enemy hits).

## Gameplay
- Inertial physics (like Asteroids): thrust along the nose, velocity is preserved; when all
  buttons are released — smooth braking. At the arena boundaries (±240) the velocity along the axis is zeroed.
- Camera: nearly vertical, rigidly attached to the player, does not rotate.
- **Landing screen (reflects the current level)** — on load the homepage depends on the player's current
  level: if it has a **briefing** (level 2+), the client lands on the **Hangar** showing that briefing (so a
  returning player sees *their* mission, not the level-1 intro); otherwise (level 1 / new player) it shows
  the **welcome screen** — a start overlay that greets the player ("Welcome, Sentinel"), frames the threat
  as a pirate raid, lets them **pick a ship** (cards with HP + weapon summary) and **Take off**. Either way
  the scene backdrop renders behind it and the level only starts on take-off.
- **Progression** — each player has a **`current_progress`** (their highest unlocked level; see
  Backend). On load the client fetches **that** level (`GET /api/players/:id/level`, not a hard-coded
  one); clearing a level **unlocks the next** (the `win` handler POSTs `/advance`, then loads the new
  level so the next **Restart** plays it). A new player starts on `level-1`; the last level stays put.
- **Victory → Hangar → next level.** On a win the result overlay shows a **Continue** button (a loss
  shows **Restart**/retry); Continue opens the **Hangar screen** — the between-battles screen (also the
  landing/homepage; future home for ship management). It shows the current/next mission's briefing in large
  (2×) text, with a **Take off** button that launches the level. The same Hangar is used on page load and
  after a win (and `launchFromHangar` starts the loop the first time).
- **Between-level briefings** — a level descriptor can carry an optional **`briefing`** (`{ textKey,
  text, actions[] }`). When the player advances **into** a level, the server runs that briefing's
  `actions` (server-authoritative, once — progress only moves forward) and returns the message; the
  client shows it on the **Hangar screen** between the victory overlay and the next run (or a default
  "standby" line when there's none). Actions are a typed, extensible list dispatched server-side; the one
  types today are **`replaceWeapon` `{from, to}`** (swaps a mounted weapon id on the active `player_ships`
  loadout) and **`installComponent` `{slot, component}`** (sets a component slot, e.g. `repair`, on the
  active ship). `level-2`'s briefing narrates the weapons-factory mission and swaps the basic gun (1) for
  the **Machine Gun** (5); `level-3`'s briefing narrates fitting the **repair drone** and installs it
  (`installComponent` `repair` → 12). After advancing, the client reloads the active ship and rebuilds
  the player so the new loadout/components take effect. (Future action types: add credits, add to a
  stash, etc.)
- **Level flow** — driven by a DB **level descriptor** (a phase/wave script) played by the client's
  `levelRunner`. Three levels are seeded (played in order via the player's progress):
  - **`level-1` (beginner):** fighters only (3 at a time) → after **7 kills** rocketeers join at 25%
    → at **15 kills** spawning stops, one last rocketeer appears, clear the field → **Victory!** No boss.
  - **`level-2` (medium):** fighters only until 5 kills → fighters + rocketeers 75/25 until 15 kills →
    spawning stops → a single **medium** appears alone as the boss → clear → Victory.
  - **`level-3` (full fight):** waves of all three enemy types → after 20 kills spawning stops → the
    **Sector boss** spawns alone → on its death the game runs ~5 s (watch it explode) → Victory.
  The AI keeps its distance and fires its weapon groups by range/aim. Spawn composition (ships +
  `chance` weights + max concurrent) is per-phase in the level; a `win` phase's `delay` defers the
  overlay so the last/boss explosion plays out.
- **Rockets can be shot down by the machine gun:** a bullet subtracts its damage from an opposite-side
  rocket's HP (shot down at 0) — you can deflect enemy rockets, and an enemy can shoot down yours.
- Player health is 100; HUD shows the remaining health as a percentage with one decimal
  (e.g. "87.5%") below the bar.
- **Economy (credits)** — the currency is **credits**. Every enemy carries a `reward` (`stats.reward`:
  fighter 20, rocketeer 40, medium 100, first boss 200); destroying one adds it to the run's **Earned**
  total. Completing a level **doubles** Earned (`win` applies `earned ×= 2`). The separate **kill count**
  drives level thresholds. At the **end of each run — death OR victory — Earned is banked** into the
  player's persistent **Credits** balance (server-authoritative; closing the browser mid-run loses the
  unbanked amount). New players start at **1000 credits**. HUD (top-right) shows two counters — **Credits**
  (the persistent balance) and **Earned** (this run) — plus **Destroyed** (kills) and **Enemies** (alive).
  Banking posts `{ credits, kills, durationMs }` to `POST /api/games`, which returns the new balance.

## Visuals
- Background in 3 layers: stars (varying brightness, a static backdrop) → asteroids (a parallax layer,
  the sense of speed) → planet + 2 moons (light parallax).
- Lighting: **two render passes** — combat (its own scene/light) and sky (its own scene/light with a
  real day/night terminator on the planet and moons).
- The planet and moons have minimal **procedural textures** (baked canvas maps, no asset files):
  `makePlanetTexture(ocean)` — an ocean world with depth variation and soft clouds; `makeMoonTexture` —
  craters (darker floor + lighter rim) plus faint maria, per moon from its base color. The bodies
  don't rotate, so the terminator stays consistent.
- **The whole scene is data-driven:** it's described by a JSON **map descriptor** in the DB (`maps`
  table, seeded as `home-system`) and built generically by `buildMap(descriptor)` in `bootstrap()`
  (planet/moons/stars/asteroids/sky-light from params). API: `GET /api/maps/:name`.
- **Enemy spawn ("warp in"):** a newly spawned enemy grows from a dot to its full size over
  `SPAWN_GROW_TIME` (1 s, ease-out cubic) — it scales up in place while the AI is already active.
- Effects: a micro-explosion at the hit point; a narrow glowing engine trail on **every ship**
  (player and enemies), via the shared `emitExhaust` — particle speed = ship speed + ejection backward
  along the nozzle, colored by the engine's `exhaust.color`, emitted while thrusting forward.
- **Ship destruction** (`spawnShipExplosion`): a destroyed ship bursts in a layered fireball
  (white-hot flash → exhaust-colored glow → orange → red cloud), a radial spray of sparks, and an
  expanding shockwave ring — much louder than the hit micro-flash, and slow (~3.75 s). **Sized to the
  ship** (scales by `sizeScale`) and **tinted by the engine's exhaust color** (`engine.exhaust.color` —
  the glow layer, accent sparks and ring), so the player's burst is cyan-blue, enemies' orange. Used on
  enemy and player death.

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
  line) and `t()` for JS-set strings (victory/game-over/perf/ship cards).
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
  and posts it on load; the server creates the player if new. Anonymous, minimal friction.
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
- **Catalog tables:** `ships` (player + enemies; `name`, `type`, `stats` JSON, `model_url`,
  `components` JSON ref `{hull,engine,thruster[,repair]}`), `components` (`name`, `type`
  `hull`/`engine`/`thruster`/`repair`, `weight`, `stats` JSON; stable ids) and `weapons` (`name`, `type`
  `bullet`/`rocket`, `stats` JSON; stable ids), seeded from a shared snapshot
  (`server/src/catalog_seed.js`). **The client assembles all ships from these.**
- **`player_ships`:** ships a player owns; exactly one `is_active` goes into battle. `loadout` JSON
  overrides `mounts` (empty ⇒ the ship's default weapons), `components` JSON overrides the ship's
  hull/engine (null ⇒ ship defaults), `meta` JSON for the future. A new player auto-gets a default
  active ship on registration.
- **Maps & levels:** `maps` table holds a JSON scene `descriptor` per map (seeded as `home-system`),
  built by `buildMap`. `levels` table holds a JSON descriptor per level (a map + a phase/wave script,
  seeded as `level-1`/`level-2`/`level-3`), played by the client's `levelRunner`. Served via `GET /api/maps/:name` and
  `GET /api/levels/:name`.
- API: `POST /api/players/register`, `POST /api/games`, `GET /api/players/:id/games`,
  `GET /api/health`, `GET /api/ships`, `GET /api/weapons`, `GET /api/components`,
  `GET /api/players/:id/active-ship`, `GET /api/players/:id/level`, `POST /api/players/:id/advance`,
  `POST /api/players/:id/language`, `POST /api/players/:id/username`, `GET /api/maps/:name`,
  `GET /api/levels/:name`, and the auth routes (`POST /api/auth/register`, `/login`, `/logout`,
  `POST /api/auth/resend-verification`, `GET /api/auth/me`, `GET /api/auth/verify`).

### Accounts / authentication (DECISIONS §11)
- **Anonymous-first, optional account.** Players keep the localStorage UUID and auto-register as
  before. **After clearing level 1** the client prompts (once) for a **username** (display name) and
  offers to **create an account**. Decline → keep playing as a guest (the username is still saved).
  Accept → email + password **upgrade the same `players` row in place** (progress preserved).
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
- **Schema (migration 009 / Postgres bootstrap):** `players` gains `username`, `email`,
  `password_hash`, `password_salt`, `email_verified`, `email_verify_token_hash`,
  `email_verify_sent_at`; email uniqueness via a **partial unique index** (`WHERE email IS NOT NULL`,
  since SQLite can't add a UNIQUE column). New `sessions` table (real FK on `player_id` in Postgres;
  logical FK in SQLite).
- **Email:** Amazon SES (`us-east-1`), outbound only, from `noreply@vega.tenony.com`, sent via
  **hand-rolled AWS SigV4 over built-in `fetch`**, isolated in `server/src/ses.js` — **no `@aws-sdk`
  dep**. Reads `SES_REGION`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`SES_FROM_ADDRESS`/
  `APP_BASE_URL` from the server `.env`. **If creds are absent (local dev/tests) it no-ops**: logs the
  verification link and records it to an in-memory `outbox` (which tests assert on). **SES has
  production access** (granted 2026-06-21) — out of sandbox, so it can email arbitrary player addresses.
- **Verification flow:** register/resend generates a token, stores its hash + `sent_at`, emails a
  `/api/auth/verify?token=…` link; the route hashes + matches an unexpired token (24 h TTL), flips
  `email_verified`, clears the token, and **redirects** to `/?verified=1` (the client shows a
  confirmation). Resend is throttled per account by `email_verify_sent_at`.
- **Rate limiting:** in-memory per-IP fixed-window limiter on register/login/resend (10/min); disabled
  under the test suite. Input validation: email shape, password ≥ 8 chars → 400; bad creds → 401;
  duplicate email → 409.
- **Schema:** SQLite uses a versioned migration runner (`migrate.js`, `PRAGMA user_version`);
  Postgres uses idempotent `CREATE TABLE IF NOT EXISTS` bootstrap (versioned PG migrations: TODO).
  Migrations run on startup; `npm run migrate` runs them for the active backend.
- **Catalog seeding (data safety):** `server/src/catalog_seed.js` is the single source of truth for the
  **reference tables** (`components`, `weapons`, `ships`, `maps`, `levels`). On **every server startup** both backends
  **upsert** these rows from the seed (`INSERT … ON CONFLICT DO UPDATE`, keyed by weapon `id` / ship/map/
  level `name`) — so editing `catalog_seed.js` ships content/balance changes to prod on the next deploy.
  This is **update-and-insert, not a wipe**: nothing is deleted, so removing/renaming a seed entry leaves
  the old row orphaned (harmless, but it lingers). **Player data is never touched by seeding** — `players`,
  `games`, `player_ships` persist across deploys. (If we ever want the catalog editable in prod, switch to
  seed-only-when-empty + migrations for changes.)
- Run locally: `cd server && npm install && npm start` → open **http://localhost:4000**.
- The client now **requires the API to start** (it fetches the ship/weapon catalog + active ship in
  `bootstrap()`). Since the game is always served same-origin by this server, the API is available.
  Game-history posting (`reportGame`) stays best-effort.

## Deployment & CI/CD
- **Live: https://vega.tenony.com** (canonical) — Hetzner VPS (178.104.91.144) shared with another
  project. The legacy host **https://space.bagaiev.com** stays routed to the same container during the
  transition (Traefik rule `Host(vega.tenony.com) || Host(space.bagaiev.com)`, a Let's Encrypt cert per
  host). Runs as a Docker container `spacegame_app` (1 GB mem limit) behind **Traefik** (auto-HTTPS), on
  the shared **`backend`** + **`proxy`** networks; uses the shared `shared_postgres` (DB+user
  `spacegame`). Files at `/opt/projects/spacegame/`; server-only `.env` holds `DATABASE_URL`. The
  internal `spacegame` container/image/router/dir/DB names are unchanged (renaming is cosmetic churn).
- **CI/CD:** `.github/workflows/ci-cd.yml` — runs client + server tests on every push/PR (incl.
  PR merges), and on push to `main` deploys. Secrets: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`.
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

## Testable logic (extracted from index.html)
- Pure, Three.js-free logic lives in `client/src/`: `components.js` (catalogs + `deriveDrive` +
  `shipMass` + `hitsToKill` + `repairTick`), `steering.js` (`headingToDir`, `shortestAngleDelta`,
  `steerToward`, `enemyThrustFactor`, `inForwardSector`), and `i18n.js` (`t`, `resolveLanguage`,
  `normalizeLang`, `loadLanguage`). `index.html` imports and uses them.
- Because the client now uses ES modules, it must be **served over http** (not opened as `file://`).
- More of the simulation can be extracted incrementally (it's still tied to Three.js objects + the render loop).

## Tests (built-in `node:test`, no deps)
- **Client logic** — `client/src/*.test.js` (28): drive derivation (engine + mass), balance, repair-drone
  regen (`repairTick`: per-interval heal, multi-tick, 80% cap, no-op cases, mass), steering math,
  i18n (`t()` resolution/fallback/interpolation, language resolution order, browser-lang mapping).
  Run: `cd client && npm test`.
- **Backend API** — `server/src/server.test.js` (29): register / record game + credit banking / history /
  validation / health / serves client / ships + weapons + components + maps + levels catalog + active ship +
  player progress (current level + advance) + language preference + credits balance + level briefings
  (level-2 weapon swap, level-3 repair-drone install) + repair-drone component seed +
  **auth** (username, register happy/duplicate-409/weak-400, login happy/wrong-401, `/me` authed vs 401,
  logout clears the session, verify-token flips `email_verified`, cross-device login adopts progress).
  Mounts the Express app on an ephemeral port against a temp SQLite DB (`DB_PATH` env, `NODE_ENV=test`)
  — the real `game.db` is untouched; SES uses its no-creds outbox. Run: `cd server && npm test`.
- **Auth unit** — `server/src/auth.test.js` (5): scrypt round-trip (right/wrong password), per-user
  salt, token uniqueness + SHA-256 hashing, cookie-header parsing.
- The backend was made testable: `server.js` exports `createApp()` (no auto-listen; listens only when
  run directly), `db.js` honors `DB_PATH`.
- **Visual / e2e** — `client/visual/` (Playwright headless, **not in CI**): boots the real game and
  asserts on simulation state (particle counts, size ratios, exhaust colors) via a `?debug`-gated
  `window.__game` hook; saves frames to `__screenshots__/` for review (no pixel diffing). Self-contained
  runner starts its own server + throwaway DB. Setup + run from `client/`:
  `npm install && npx playwright install chromium && npm run test:visual`. A stable, growing suite for
  occasional larger releases. See `client/visual/README.md`.

## Project structure
- `client/` — the game (Three.js); `client/locales/` — i18n catalogs (`source.json` + `<lang>.json`);
  `server/` — Node.js/Express backend + SQLite; `docs/` — documentation.
