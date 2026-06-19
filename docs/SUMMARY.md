# Current state (SUMMARY)

> A living snapshot of "how things are now". Updated with every change.
> Change history is in [CHANGELOG.md](CHANGELOG.md). Rationale is in [DECISIONS.md](DECISIONS.md).

**Updated:** 2026-06-19

## What this is
A browser prototype built on Three.js (`client/index.html`): little spaceships fighting on a
plane. Opens in a browser with no installation (Three.js from a CDN).

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

## Ship model (components)
A ship is assembled from data components (in `client/index.html`, catalogs `ENGINES`,
`THRUSTERS`, `HULLS`, `WEAPONS`); all logic reads the stats from them.
- **Main engine** (`ENGINES`): `power` → **acceleration**; plus `maxSpeed` (0 = no limit),
  `weight`/`durability` (for later) and **exhaust** `exhaust` (part of the engine).
- **Maneuvering thrusters** (`THRUSTERS`): `power` → **turn rate**.
- **Mass** = sum of weights of all components (`shipMass`; every component, incl. weapons, has `weight`).
- Acceleration and maneuverability are **derived from power AND mass** (`deriveDrive`):
  `massFactor = REFERENCE_MASS / mass`; `acceleration = engine.power × massFactor`,
  `turnRate = thrusters.power × massFactor`. `REFERENCE_MASS` (48 = player's basic loadout) keeps the
  player at accel 10 / turn 2.0; heavier ships are slower, lighter ones faster. Tunable via component
  `weight`s and `REFERENCE_MASS`.
- **Hull** (`HULLS`): `durability` (= maxHp), `weight`, `volume` (weight/volume — for later).
- **Weapon** (`WEAPONS`): `power` (damage), `projectileSpeed`, `fireCooldown`, color, `type`.
  - `basicKinetic` ("Basic kinetic") — primary (`Space`).
  - `homingRocket` ("Rocket") — secondary (`F`/🚀): 5 s cooldown, on launch it finds the nearest
    enemy in the forward 120° sector, **maneuvers** toward it (turning its velocity vector, `turnRate`)
    and accelerates with the player's engine acceleration (10), 50 damage, an explosion slightly larger
    than the machine-gun one (small AoE), **a light smoke trail**. The player has a `secondary` slot.
  - `enemyRocket` ("Rocket (enemy)") — used by the yellow rocketeer, hits the player (30 damage).
- Enemy types are `ENEMY_KINDS` (color + hull/engine/thrusters/weapon + optional `rocket`/`sizeScale`):
  `fighter` (red, kinetic), `rocketeer` (yellow, tough hull + `enemyRocket`), and `heavy`
  (purple, 150 hp, rocket-only, slow, 2x model; unlocks after 10 kills). Ship `radius` scales with model size.
- Bullets and rockets carry damage/speed from the weapon and remember their side (`fromPlayer`).
- **Base configuration (the reference point for balance):** player — 100 hp hull, weapon
  basicKinetic (10 damage); enemy — light 20 hp hull, enemyKinetic (5 damage).
  Net result: an enemy dies in 2 player hits, the player survives 20 enemy hits.
  Bullets carry their own damage/speed from the weapon.

## Gameplay
- Inertial physics (like Asteroids): thrust along the nose, velocity is preserved; when all
  buttons are released — smooth braking. At the arena boundaries (±240) the velocity along the axis is zeroed.
- Camera: nearly vertical, rigidly attached to the player, does not rotate.
- Enemies (4 at a time, spawning in a ring around the player, the AI keeps its distance and shoots), three types:
  - **red fighter** — machine gun (dies in 2 hits);
  - **yellow "rocketeer"** — tougher (4 hits), shoots bullets AND periodically launches homing rockets
    at the player. Spawns ~30% of the time.
  - **purple "heavy"** — slow tank, rocket only (no gun), 150 hp, 2x model. Unlocks after 10 kills
    (then ~20% of spawns).
- **Rockets can be shot down by the machine gun:** a bullet destroys a rocket of the opposite side (a harmless
  explosion) — you can deflect enemy rockets, and an enemy can theoretically shoot down yours.
- Player health is 100; HUD shows the remaining health as a percentage with one decimal
  (e.g. "87.5%") below the bar. Score for kills.

## Visuals
- Background in 3 layers: stars (varying brightness, a static backdrop) → asteroids (a parallax layer,
  the sense of speed) → planet + 2 moons (light parallax).
- Lighting: **two render passes** — combat (its own scene/light) and sky (its own scene/light with a
  real day/night terminator on the planet and moons).
- Effects: a micro-explosion at the hit point; a narrow glowing engine trail (particle speed
  = ship speed + ejection backward along the nozzle).

## Backend
- **Node.js + Express** server (`server/`): serves the game client (static) AND a JSON API on
  the same origin (no CORS).
- **Storage is pluggable** (`datastore.js`): **Postgres** when `DATABASE_URL` is set (production),
  otherwise **SQLite** via built-in `node:sqlite` (local dev / tests). Same async API either way
  (`db.js` = SQLite, `db_postgres.js` = Postgres via `pg`).
- **Auto-registration by browser:** the client makes a UUID on first visit (kept in `localStorage`)
  and posts it on load; the server creates the player if new. Anonymous, minimal friction.
- **Game history:** on game over the client posts `{ score, kills, durationMs }`, saved per player.
- API: `POST /api/players/register`, `POST /api/games`, `GET /api/players/:id/games`, `GET /api/health`.
- **Schema:** SQLite uses a versioned migration runner (`migrate.js`, `PRAGMA user_version`);
  Postgres uses idempotent `CREATE TABLE IF NOT EXISTS` bootstrap (versioned PG migrations: TODO).
  Migrations run on startup; `npm run migrate` runs them for the active backend.
- Run locally: `cd server && npm install && npm start` → open **http://localhost:4000**.
- Client calls are best-effort (`fetch` with `.catch`): the game still works if served without the API.

## Deployment & CI/CD
- **Live: https://space.bagaiev.com** — Hetzner VPS (178.104.91.144) shared with another project.
  Runs as a Docker container `spacegame_app` (1 GB mem limit) behind **Traefik** (auto-HTTPS via
  Let's Encrypt), on the shared **`backend`** + **`proxy`** networks; uses the shared `shared_postgres`
  (DB+user `spacegame`). Files at `/opt/projects/spacegame/`; server-only `.env` holds `DATABASE_URL`.
- **CI/CD:** `.github/workflows/ci-cd.yml` — runs client + server tests on every push/PR, and on
  push to `main` deploys (rsync → `docker compose up -d --build`). Needs GitHub secrets
  `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`.

## Testable logic (extracted from index.html)
- Pure, Three.js-free logic lives in `client/src/`: `components.js` (catalogs + `deriveDrive` +
  `hitsToKill`) and `steering.js` (`headingToDir`, `shortestAngleDelta`, `steerToward`,
  `enemyThrustFactor`, `inForwardSector`). `index.html` imports and uses them.
- Because the client now uses ES modules, it must be **served over http** (not opened as `file://`).
- More of the simulation can be extracted incrementally (it's still tied to Three.js objects + the render loop).

## Tests (built-in `node:test`, no deps)
- **Client logic** — `client/src/*.test.js` (17): component derivation, mass, balance, steering math.
  Run: `cd client && npm test`.
- **Backend API** — `server/src/server.test.js` (9): register / record game / history / validation /
  health / serves client. Mounts the Express app on an ephemeral port against a temp SQLite DB
  (`DB_PATH` env) — the real `game.db` is untouched. Run: `cd server && npm test`.
- The backend was made testable: `server.js` exports `createApp()` (no auto-listen; listens only when
  run directly), `db.js` honors `DB_PATH`.

## Project structure
- `client/` — the game (Three.js), `server/` — Node.js/Express backend + SQLite, `docs/` — documentation.
