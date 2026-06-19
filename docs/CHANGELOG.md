# Changelog

> Change log, newest on top. Append-only (we don't edit history).
> Current state is in [SUMMARY.md](SUMMARY.md).

## 2026-06-19

- **Rollback support.** Each deploy tags the image `spacegame:<git-sha>` and CI keeps the 3 newest
  versions (current + 2 to roll back to). Added `rollback.sh` (re-tag a previous version to `:latest`
  + `docker rollout` → zero-downtime, no rebuild). Documented the migration strategy: forward-only /
  expand-contract, so code rollback is safe without reversing the DB (DECISIONS §9).
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
