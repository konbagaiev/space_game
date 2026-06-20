# Current state (SUMMARY)

> A living snapshot of "how things are now". Updated with every change.
> Change history is in [CHANGELOG.md](CHANGELOG.md). Rationale is in [DECISIONS.md](DECISIONS.md).

**Updated:** 2026-06-19

## What this is
**Space Ninjas** — a browser prototype built on Three.js (`client/index.html`): little spaceships
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
- **Components** (DB `components`, `type` `hull`/`engine`/`thruster`; `weight` column + `stats` JSON):
  a **hull** has `{ durability (= maxHp), volume }`; an **engine** has `{ power → acceleration, maxSpeed,
  exhaust }`; a **thruster** has `{ power → maneuverability (turn rate) }`. Seeded: hulls
  Basic(100hp)/Light(30hp)/Medium(150hp)/Boss(210hp); engines + thrusters Basic/Scout/Medium/Boss. The
  fighter, rocketeer and the medium (ex-mini-boss) share the **same Scout engine**; fighter + rocketeer
  also share the Scout thrusters, while the medium has weak (Medium) thrusters → it's sluggish.
- **Mass** = hull + engine + thruster weight + every mounted weapon's `weight` (`shipMass`).
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
  gun hits).
- **Enemy types** (DB ships, `type` `enemy`, `stats.role`): `fighter` (red, gun, 30 hp light hull),
  `rocketeer` (yellow, gun + rocket, same 30 hp light hull), `medium` (purple ex-mini-boss, two rocket
  launchers, 150 hp medium hull → sluggish, 2× model), and the `boss` (`first boss` — orange, its own
  `boss.glb` model + own hull/engine, 210 hp, 3× model, two guns + two rocket launchers; spawned only
  in the level's boss phase). Which enemies spawn is decided by the **level** (see Gameplay), not the
  ship; ship `radius` scales with model size.
- **Balance reference:** player — 100 hp hull, gun 10 damage; basic enemy — 20 hp hull, gun 5 damage
  (an enemy dies in 2 player hits; the player survives 20 enemy hits).

## Gameplay
- Inertial physics (like Asteroids): thrust along the nose, velocity is preserved; when all
  buttons are released — smooth braking. At the arena boundaries (±240) the velocity along the axis is zeroed.
- Camera: nearly vertical, rigidly attached to the player, does not rotate.
- **Welcome screen** — on load, a start overlay greets the player ("Welcome, Ninja. Our home system
  is under attack…"), lets them **pick a ship** (cards from the player-type ships, with HP + weapon
  summary) and **Take off**. The scene backdrop renders behind it; the level only starts on take-off.
- **Level flow** — driven by a DB **level descriptor** (a phase/wave script) played by the client's
  `levelRunner`. `level-1`: wave 1 (red fighter + yellow rocketeer, up to 4 at once) → after **10 kills**
  → wave 2 (adds the purple mini-boss) → at **20 total kills** → **spawning stops**; clear the rest →
  the **boss spawns alone** → on its death the game keeps running for ~5 s (so you can watch the boss
  explode) before the **Victory!** overlay (the win phase's `delay`). The AI keeps its distance and
  fires its weapon groups by range/aim. Spawn composition (which ships + weights + max concurrent) is
  per-phase in the level, not per-ship.
- **Rockets can be shot down by the machine gun:** a bullet subtracts its damage from an opposite-side
  rocket's HP (shot down at 0) — you can deflect enemy rockets, and an enemy can shoot down yours.
- Player health is 100; HUD shows the remaining health as a percentage with one decimal
  (e.g. "87.5%") below the bar. Score for kills.

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
- Effects: a micro-explosion at the hit point; a narrow glowing engine trail on **every ship**
  (player and enemies), via the shared `emitExhaust` — particle speed = ship speed + ejection backward
  along the nozzle, colored by the engine's `exhaust.color`, emitted while thrusting forward.
- **Ship destruction** (`spawnShipExplosion`): a destroyed ship bursts in a layered fireball
  (white-hot flash → exhaust-colored glow → orange → red cloud), a radial spray of sparks, and an
  expanding shockwave ring — much louder than the hit micro-flash, and slow (~3.75 s). **Sized to the
  ship** (scales by `sizeScale`) and **tinted by the engine's exhaust color** (`engine.exhaust.color` —
  the glow layer, accent sparks and ring), so the player's burst is cyan-blue, enemies' orange. Used on
  enemy and player death.

## Backend
- **Node.js + Express** server (`server/`): serves the game client (static) AND a JSON API on
  the same origin (no CORS).
- **Storage is pluggable** (`datastore.js`): **Postgres** when `DATABASE_URL` is set (production),
  otherwise **SQLite** via built-in `node:sqlite` (local dev / tests). Same async API either way
  (`db.js` = SQLite, `db_postgres.js` = Postgres via `pg`).
- **Auto-registration by browser:** the client makes a UUID on first visit (kept in `localStorage`)
  and posts it on load; the server creates the player if new. Anonymous, minimal friction.
- **Game history:** on game over the client posts `{ score, kills, durationMs }`, saved per player.
- **Catalog tables:** `ships` (player + enemies; `name`, `type`, `stats` JSON, `model_url`,
  `components` JSON ref `{hull,engine,thruster}`), `components` (`name`, `type`
  `hull`/`engine`/`thruster`, `weight`, `stats` JSON; stable ids) and `weapons` (`name`, `type`
  `bullet`/`rocket`, `stats` JSON; stable ids), seeded from a shared snapshot
  (`server/src/catalog_seed.js`). **The client assembles all ships from these.**
- **`player_ships`:** ships a player owns; exactly one `is_active` goes into battle. `loadout` JSON
  overrides `mounts` (empty ⇒ the ship's default weapons), `components` JSON overrides the ship's
  hull/engine (null ⇒ ship defaults), `meta` JSON for the future. A new player auto-gets a default
  active ship on registration.
- **Maps & levels:** `maps` table holds a JSON scene `descriptor` per map (seeded as `home-system`),
  built by `buildMap`. `levels` table holds a JSON descriptor per level (a map + a phase/wave script,
  seeded as `level-1`), played by the client's `levelRunner`. Served via `GET /api/maps/:name` and
  `GET /api/levels/:name`.
- API: `POST /api/players/register`, `POST /api/games`, `GET /api/players/:id/games`,
  `GET /api/health`, `GET /api/ships`, `GET /api/weapons`, `GET /api/components`,
  `GET /api/players/:id/active-ship`, `GET /api/maps/:name`, `GET /api/levels/:name`.
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
- **Live: https://space.bagaiev.com** — Hetzner VPS (178.104.91.144) shared with another project.
  Runs as a Docker container `spacegame_app` (1 GB mem limit) behind **Traefik** (auto-HTTPS via
  Let's Encrypt), on the shared **`backend`** + **`proxy`** networks; uses the shared `shared_postgres`
  (DB+user `spacegame`). Files at `/opt/projects/spacegame/`; server-only `.env` holds `DATABASE_URL`.
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
  `hitsToKill`) and `steering.js` (`headingToDir`, `shortestAngleDelta`, `steerToward`,
  `enemyThrustFactor`, `inForwardSector`). `index.html` imports and uses them.
- Because the client now uses ES modules, it must be **served over http** (not opened as `file://`).
- More of the simulation can be extracted incrementally (it's still tied to Three.js objects + the render loop).

## Tests (built-in `node:test`, no deps)
- **Client logic** — `client/src/*.test.js` (14): drive derivation (engine + mass), balance, steering math.
  Run: `cd client && npm test`.
- **Backend API** — `server/src/server.test.js` (15): register / record game / history / validation /
  health / serves client / ships + weapons + components + maps + levels catalog + active ship. Mounts the Express app on an ephemeral port against a temp SQLite DB
  (`DB_PATH` env) — the real `game.db` is untouched. Run: `cd server && npm test`.
- The backend was made testable: `server.js` exports `createApp()` (no auto-listen; listens only when
  run directly), `db.js` honors `DB_PATH`.
- **Visual / e2e** — `client/visual/` (Playwright headless, **not in CI**): boots the real game and
  asserts on simulation state (particle counts, size ratios, exhaust colors) via a `?debug`-gated
  `window.__game` hook; saves frames to `__screenshots__/` for review (no pixel diffing). Self-contained
  runner starts its own server + throwaway DB. Setup + run from `client/`:
  `npm install && npx playwright install chromium && npm run test:visual`. A stable, growing suite for
  occasional larger releases. See `client/visual/README.md`.

## Project structure
- `client/` — the game (Three.js), `server/` — Node.js/Express backend + SQLite, `docs/` — documentation.
