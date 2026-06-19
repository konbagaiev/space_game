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
- Acceleration and maneuverability are **derived** (`deriveDrive`): `acceleration = engine.power ×
  THRUST_TO_ACCEL`, `turnRate = thrusters.power × THRUSTER_TO_TURN` (coefficients are 1 for now).
- **Hull** (`HULLS`): `durability` (= maxHp), `weight`, `volume` (weight/volume — for later).
- **Weapon** (`WEAPONS`): `power` (damage), `projectileSpeed`, `fireCooldown`, color, `type`.
  - `basicKinetic` ("Basic kinetic") — primary (`Space`).
  - `homingRocket` ("Rocket") — secondary (`F`/🚀): 5 s cooldown, on launch it finds the nearest
    enemy in the forward 120° sector, **maneuvers** toward it (turning its velocity vector, `turnRate`)
    and accelerates with the player's engine acceleration (10), 50 damage, an explosion slightly larger
    than the machine-gun one (small AoE), **a light smoke trail**. The player has a `secondary` slot.
  - `enemyRocket` ("Rocket (enemy)") — used by the yellow rocketeer, hits the player (30 damage).
- Enemy types are `ENEMY_KINDS` (color + hull/engine/weapon + optional `rocket`): `fighter`
  (red, kinetic) and `rocketeer` (yellow, tough hull + `enemyRocket`).
- Bullets and rockets carry damage/speed from the weapon and remember their side (`fromPlayer`).
- **Base configuration (the reference point for balance):** player — 100 hp hull, weapon
  basicKinetic (10 damage); enemy — light 20 hp hull, enemyKinetic (5 damage).
  Net result: an enemy dies in 2 player hits, the player survives 20 enemy hits.
  Bullets carry their own damage/speed from the weapon.

## Gameplay
- Inertial physics (like Asteroids): thrust along the nose, velocity is preserved; when all
  buttons are released — smooth braking. At the arena boundaries (±240) the velocity along the axis is zeroed.
- Camera: nearly vertical, rigidly attached to the player, does not rotate.
- Enemies (4 of them, spawning in a ring around the player, the AI keeps its distance and shoots), two types:
  - **red fighter** — machine gun (dies in 2 hits);
  - **yellow "rocketeer"** — tougher (4 hits), shoots bullets AND periodically launches homing rockets
    at the player. Spawns ~30% of the time.
- **Rockets can be shot down by the machine gun:** a bullet destroys a rocket of the opposite side (a harmless
  explosion) — you can deflect enemy rockets, and an enemy can theoretically shoot down yours.
- Player health is 100; score for kills.

## Visuals
- Background in 3 layers: stars (varying brightness, a static backdrop) → asteroids (a parallax layer,
  the sense of speed) → planet + 2 moons (light parallax).
- Lighting: **two render passes** — combat (its own scene/light) and sky (its own scene/light with a
  real day/night terminator on the planet and moons).
- Effects: a micro-explosion at the hit point; a narrow glowing engine trail (particle speed
  = ship speed + ejection backward along the nozzle).

## Project structure
- `client/` — the game (Three.js), `server/` — the backend (planned), `docs/` — documentation.
