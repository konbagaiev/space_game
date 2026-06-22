// Seed data for the ships/weapons catalog — a snapshot of the game's ship/weapon design.
// Both backends seed from this via an idempotent upsert on startup (see db.js / db_postgres.js),
// so editing this file updates the catalog on the next start.
//
// References are by id everywhere. A ship has named fire GROUPS (a channel triggered by a key for
// the player, or by an AI range/aim rule for enemies) and a list of MOUNTS, each a weapon on a
// group with a lateral offset (side-by-side fire) and a delay (staggered volley). A player's
// loadout (player_ships.loadout) may override `mounts`; empty ⇒ the ship's default mounts.

// --- components: ships are assembled from a hull + an engine + maneuvering thrusters (weapons are
// separate, in WEAPONS). `weight` (a column) sums into the ship's mass; `stats` (json) hold the rest.
//   hull     : { durability (= maxHp), volume }
//   engine   : { power -> acceleration, maxSpeed, exhaust }
//   thruster : { power -> turn rate (maneuverability) }
// So mobility = engine power (accel) / thruster power (turn), each scaled by mass. Stable explicit
// ids (referenced from ships.components / player_ships.components as { hull, engine, thruster }).
// Optional top-level `price` (credits, for the hangar shop) defaults to 0 when omitted — the economy
// is inert until real prices are set; sell price is floor(price * 0.75), computed server-side.
export const COMPONENTS = [
  { id: 1, name: 'Basic hull', type: 'hull', weight: 20, price: 300, stats: { durability: 100, volume: 100 } }, // starter gear: cheap, buyable
  { id: 2, name: 'Light hull', type: 'hull', weight: 8, stats: { durability: 30, volume: 40 } },
  { id: 3, name: 'Medium hull', type: 'hull', weight: 60, stats: { durability: 150, volume: 200 } },
  { id: 4, name: 'Boss hull', type: 'hull', weight: 100, stats: { durability: 210, volume: 400 } },
  { id: 5, name: 'Basic engine', type: 'engine', weight: 10, price: 500, stats: { power: 10, maxSpeed: 0, exhaust: { color: 0x6fd0ff, speed: 12, life: 0.55, size: 0.5, spread: 0.35 } } }, // starter gear: cheap
  { id: 6, name: 'Scout engine', type: 'engine', weight: 6, stats: { power: 12.6, maxSpeed: 10.5, exhaust: { color: 0xff8a5a, speed: 10, life: 0.4, size: 0.4, spread: 0.3 } } },
  { id: 7, name: 'Boss engine', type: 'engine', weight: 50, stats: { power: 19, maxSpeed: 8, exhaust: { color: 0xff5a3a, speed: 10, life: 0.6, size: 0.9, spread: 0.45 } } },
  { id: 8, name: 'Basic thrusters', type: 'thruster', weight: 4, price: 400, stats: { power: 2.0 } }, // starter gear: cheap
  { id: 9, name: 'Scout thrusters', type: 'thruster', weight: 3, stats: { power: 1.6 } },
  { id: 10, name: 'Medium thrusters', type: 'thruster', weight: 8, stats: { power: 0.63 } }, // sluggish (turn ~0.35)
  { id: 11, name: 'Boss thrusters', type: 'thruster', weight: 20, stats: { power: 1.66 } }, // turn ~0.42 = 1.2× medium
  // repair drone (4th component type): passively heals the hull mid-combat, up to a fraction of max HP.
  // Installed on the player's ship via the level-3 briefing's installComponent action.
  { id: 12, name: 'Repair drone', type: 'repair', weight: 4, price: 500, stats: { repairPerTick: 1, intervalSec: 3, maxFraction: 0.8 } }, // granted at L3; cheap to rebuy

  // --- Player shop ladder (docs/plans/catalog-economy.md). Upgrades are mass trade-offs, not
  // power-creep; ids continue from 12. The enemy/starter parts above stay out of the shop (price 0 →
  // hidden by the client's price>0 shop filter); only these priced rows are buyable.
  // Hull: "a new ship = a new hull" — 2× HP for a real mobility cost (mass 48→78: accel ~6.2, turn ~1.2).
  { id: 13, name: 'Heavy hull', type: 'hull', weight: 50, price: 6000, stats: { durability: 200, volume: 350 } },
  // Engines: Racing = T2 (more power, heavier); Ion = high-accel and light (premium top-tier).
  { id: 15, name: 'Solid-fuel engine', type: 'engine', weight: 14, price: 1400, stats: { power: 14, maxSpeed: 12, exhaust: { color: 0x7fb0ff, speed: 13, life: 0.55, size: 0.55, spread: 0.35 } } },
  { id: 16, name: 'Ion engine', type: 'engine', weight: 10, price: 6400, stats: { power: 18, maxSpeed: 14, exhaust: { color: 0xffd24d, speed: 14, life: 0.45, size: 0.45, spread: 0.30 } } },
  // Repair drones: faster cadence + higher cap (the "future tiers" from the repair-drone spec).
  { id: 19, name: 'Repair drone II', type: 'repair', weight: 6, price: 1800, stats: { repairPerTick: 1, intervalSec: 2, maxFraction: 0.85 } },
  { id: 20, name: 'Nanobot repair', type: 'repair', weight: 8, price: 7000, stats: { repairPerTick: 2, intervalSec: 3, maxFraction: 0.90 } },
  { id: 21, name: 'Advanced thrusters', type: 'thruster', weight: 5, price: 2500, stats: { power: 3.0 } },

  // --- Pirate gunner parts (side missions, docs/plans/mission-enemies-difficulty.md). +20% HP and
  // +50% top speed over the base enemy (fighter: Light hull 30 HP + Scout engine maxSpeed 10.5).
  // Enemy gear → price 0 (hidden from the shop). ids continue past the max (21).
  { id: 22, name: 'Pirate hull', type: 'hull', weight: 10, stats: { durability: 36, volume: 45 } },          // 30 × 1.2
  { id: 23, name: 'Pirate engine', type: 'engine', weight: 6, stats: { power: 12.6, maxSpeed: 15.75, exhaust: { color: 0xff6a4a, speed: 10, life: 0.4, size: 0.4, spread: 0.3 } } }, // maxSpeed 10.5 × 1.5; same accel as Scout
];

// --- weapons: type 'bullet' | 'rocket'; stats hold the (now fully DB-driven) characteristics ---
// bullets: power (damage), projectileSpeed, maxRange (units), fireCooldown, weight, projectileColor.
// rockets: power (damage), accel, turnRate (maneuverability), launchSpeed, maxRange, health
//   (HP — reduced by a bullet's `power`; the rocket is shot down when it hits 0, so e.g. 20 HP
//   takes two 10-damage gun hits), blastRadius (AoE — can hit several), detonateRadius, blastVisual,
//   seekHalfAngle (homing search cone), fireCooldown, weight, projectileColor.
// Optional top-level `price` (credits, hangar shop) defaults to 0 when omitted (see COMPONENTS note).
export const WEAPONS = [
  {
    id: 1, name: 'Basic kinetic', type: 'bullet', price: 800, stats: { // granted into the stash on shop unlock; sells ~600 to help fund the Heavy hull
      power: 10, projectileSpeed: 40, maxRange: 88, fireCooldown: 0.18, weight: 6, projectileColor: 0x6fe6ff
    }
  },
  {
    id: 2, name: 'Kinetic (enemy)', type: 'bullet', stats: {
      power: 4, projectileSpeed: 40, maxRange: 88, fireCooldown: 1.1, weight: 4, projectileColor: 0xff6b6b
    }
  },
  {
    id: 3, name: 'Rocket (homing)', type: 'rocket', price: 600, stats: { // player starter rocket: cheap to rebuy
      power: 60, accel: 10, turnRate: 1.0, launchSpeed: 12, maxRange: 150, health: 10,
      seekHalfAngle: 60 * Math.PI / 180, detonateRadius: 3.2, blastRadius: 5, blastVisual: 4.5,
      fireCooldown: 5, weight: 8, projectileColor: 0xffaa44
    }
  },
  {
    id: 4, name: 'Rocket (enemy)', type: 'rocket', stats: {
      power: 25, accel: 9, turnRate: 1.0, launchSpeed: 12, maxRange: 120, health: 20,
      detonateRadius: 3.2, blastRadius: 5, blastVisual: 4.5,
      fireCooldown: 4, weight: 6, projectileColor: 0xffcc66
    }
  },
  {
    id: 5, name: 'Machine Gun', type: 'bullet', price: 1500, stats: { // rapid-fire kinetic: low per-hit damage, high rate of fire — strong, so NOT cheap
      power: 7, projectileSpeed: 50, maxRange: 100, fireCooldown: 0.1, weight: 8, projectileColor: 0xffe066
    }
  },
  // --- Player shop ladder weapons (docs/plans/catalog-economy.md). Trade-offs: damage ↔ fire-rate ↔ range ↔ weight.
  {
    id: 6, name: 'Heavy cannon', type: 'bullet', price: 2000, stats: { // hard-hitting, slow fire, long range
      power: 35, projectileSpeed: 65, maxRange: 140, fireCooldown: 0.6, weight: 10, projectileColor: 0xff8a3c
    }
  },
  {
    id: 7, name: 'Heavy Machine Gun', type: 'bullet', price: 6000, stats: { // strong all-rounder: med damage, high rate of fire
      power: 12, projectileSpeed: 48, maxRange: 100, fireCooldown: 0.12, weight: 8, projectileColor: 0xb46bff
    }
  },
  {
    id: 8, name: 'Heavy rocket', type: 'rocket', price: 2600, stats: { // homing: high damage, slow reload, big blast
      power: 90, accel: 9, turnRate: 0.8, launchSpeed: 12, maxRange: 180, health: 20,
      seekHalfAngle: 50 * Math.PI / 180, detonateRadius: 3.5, blastRadius: 7, blastVisual: 6,
      fireCooldown: 7, weight: 12, projectileColor: 0xff7a3c
    }
  },
  // Enemy weapon for the pirate gunner (side missions) + the upgraded boss: a long-range, rapid-fire
  // kinetic mirroring the player's Machine Gun's reach. Low per-hit damage, high RoF. Price 0 (enemy gear).
  {
    id: 9, name: 'Pirate machine gun', type: 'bullet', stats: {
      power: 3, projectileSpeed: 50, maxRange: 90, fireCooldown: 0.18, weight: 6, projectileColor: 0xff5a4a
    }
  },
];

// fire-group presets (a group can carry a player key and/or an enemy AI rule; ships use what fits)
const GUN = { key: 'Space', ai: { range: 45, aimTol: 0.25 } };
const GUN_LONG = { ai: { range: 90, aimTol: 0.25 } }; // long-range MG (pirate gunner): engage from afar
const ROCKET = { key: 'KeyF', ai: { range: 80, aimTol: 0.40 } };

// --- ships: one table for player + enemies. `components` references a hull + an engine by id
// (player_ships.components may override them); `stats` carry role/color/sizeScale + groups + mounts.
// fighter, rocketeer and the medium share the SAME engine (6); the medium is sluggish only because of
// its heavier hull (mass). The boss has its own hull + engine; weapons are shared (in WEAPONS).
export const SHIPS = [
  {
    name: 'Basic player ship', type: 'player', modelUrl: 'assets/ships/player.glb',
    components: { hull: 1, engine: 5, thruster: 8 }, stats: {
      role: 'player', color: 0x4d8bff, sizeScale: 1, nameKey: 'ship.player_basic.name',
      groups: { gun: GUN, rocket: ROCKET },
      mounts: [
        { weapon: 1, group: 'gun', offset: 0, delay: 0 },
        { weapon: 3, group: 'rocket', offset: 0, delay: 0 },
      ]
    }
  },
  {
    name: 'basic enemy ship', type: 'enemy', modelUrl: 'assets/ships/fighter.glb',
    components: { hull: 2, engine: 6, thruster: 9 }, stats: { // light hull (30 hp) + scout engine/thrusters
      role: 'fighter', color: 0xff5d5d, sizeScale: 1, reward: 20,
      groups: { gun: GUN },
      mounts: [{ weapon: 2, group: 'gun', offset: 0, delay: 0 }]
    }
  },
  {
    name: 'basic rocket enemy', type: 'enemy', modelUrl: 'assets/ships/rocketeer.glb',
    components: { hull: 2, engine: 6, thruster: 9 }, stats: { // same hull + engine + thrusters as the fighter
      role: 'rocketeer', color: 0xffd24d, sizeScale: 1, reward: 40,
      groups: { gun: GUN, rocket: ROCKET },
      mounts: [
        { weapon: 2, group: 'gun', offset: 0, delay: 0 },
        { weapon: 4, group: 'rocket', offset: 0, delay: 0 },
      ]
    }
  },
  {
    // Pirate gunner (side missions): a tougher, faster skirmisher — Pirate hull (36 HP) + Pirate engine
    // (top speed +50%) + Scout thrusters, one long-range Pirate machine gun. Reuses the fighter model.
    name: 'pirate gunner', type: 'enemy', modelUrl: 'assets/ships/fighter.glb',
    components: { hull: 22, engine: 23, thruster: 9 }, stats: {
      role: 'pirate_gunner', color: 0xe53935, sizeScale: 1, reward: 40,
      groups: { gun: GUN_LONG },
      mounts: [{ weapon: 9, group: 'gun', offset: 0, delay: 0 }]
    }
  },
  {
    name: 'basic mini boss', type: 'enemy', modelUrl: 'assets/ships/heavy.glb',
    components: { hull: 3, engine: 6, thruster: 10 }, stats: { // medium hull + scout engine + weak (Medium) thrusters
      role: 'medium', color: 0xb267e6, sizeScale: 2, reward: 100,
      groups: { rocket: ROCKET },
      // two rocket launchers side by side, fired one after the other (0.2s stagger)
      mounts: [
        { weapon: 4, group: 'rocket', offset: -0.8, delay: 0 },
        { weapon: 4, group: 'rocket', offset: 0.8, delay: 0.2 },
      ]
    }
  },
  // The end-of-level boss: big orange ship (its own .glb), its own hull + engine, two guns side by
  // side + two staggered rocket launchers.
  {
    name: 'first boss', type: 'enemy', modelUrl: 'assets/ships/boss.glb',
    components: { hull: 4, engine: 7, thruster: 11 }, stats: {
      role: 'boss', color: 0xff8c2a, sizeScale: 3, reward: 200,
      // Boss buff (docs/plans/mission-enemies-difficulty.md): two Pirate machine guns (id 9) replace the
      // old basic-kinetic guns; rockets unchanged. Also buffs the level-3 boss (same ship) — intended.
      groups: { gun: GUN, rocket: ROCKET },
      mounts: [
        { weapon: 9, group: 'gun', offset: -0.6, delay: 0 },
        { weapon: 9, group: 'gun', offset: 0.6, delay: 0 },
        { weapon: 4, group: 'rocket', offset: -0.9, delay: 0 },
        { weapon: 4, group: 'rocket', offset: 0.9, delay: 0.2 },
      ]
    }
  },
];

// --- levels: a JSON descriptor the client's level runner plays. A level uses a map and runs an
// ordered list of phases. Each phase optionally spawns enemies from a pool weighted by `chance`
// (spawn frequency — NOT ship mass), up to `maxConcurrent`, with an optional `total` cap, and
// advances when a condition is met:
//   { kills: N }           — N cumulative kills this level
//   { killsSincePhase: N }  — N kills since entering this phase
//   { allCleared: true }    — no enemies left (and the phase's `total` has all spawned)
// A phase with `event: 'win'` ends the level with a victory overlay.
export const LEVELS = [
  // Level 1 — beginner-friendly: gentle ramp, no boss.
  {
    name: 'level-1', descriptor: {
      title: 'Level 1', map: 'home-system',
      phases: [
        {
          name: 'wave-1', // only plain fighters, 3 at a time
          spawn: { maxConcurrent: 3, pool: [{ ship: 'basic enemy ship', chance: 100 }] },
          advanceWhen: { kills: 7 }
        },
        {
          name: 'wave-2', // rocketeers join at 25%
          spawn: {
            maxConcurrent: 3, pool: [
              { ship: 'basic enemy ship', chance: 75 },
              { ship: 'basic rocket enemy', chance: 25 }]
          },
          advanceWhen: { kills: 15 }
        },
        {
          name: 'finale', // spawning stops; one last rocketeer, then clear the field
          spawn: { maxConcurrent: 4, total: 1, pool: [{ ship: 'basic rocket enemy', chance: 100 }] },
          advanceWhen: { allCleared: true }
        },
        { name: 'victory', event: 'win', delay: 2, textKey: 'level.1.victory', text: 'Level 1 cleared! Nice flying, Sentinel.' },
      ]
    }
  },
  // Level 2 — medium: ends with a single mini-boss (the medium) as the boss.
  // `briefing` is shown when the player unlocks this level (after clearing level 1); its `actions`
  // run server-side once, on advance (see advanceProgress). Here: swap the basic gun for a Machine Gun.
  {
    name: 'level-2', descriptor: {
      title: 'Level 2', map: 'home-system',
      briefing: {
        textKey: 'level.2.briefing',
        text: 'The pirates are storming our weapons factory — we have to push them back before they arm their fleet. Their heavier squadrons are dug in there, so command has refitted your ship: the basic gun is out, a Machine Gun is in. Go take it back, Sentinel.',
        actions: [{ type: 'replaceWeapon', from: 1, to: 5 }], // Basic kinetic -> Machine Gun
      },
      phases: [
        {
          name: 'wave-1', // only fighters until 5 kills
          spawn: { maxConcurrent: 4, pool: [{ ship: 'basic enemy ship', chance: 100 }] },
          advanceWhen: { kills: 5 }
        },
        {
          name: 'wave-2', // fighters + rocketeers 75/25 until 15 kills
          spawn: {
            maxConcurrent: 4, pool: [
              { ship: 'basic enemy ship', chance: 75 },
              { ship: 'basic rocket enemy', chance: 25 }]
          },
          advanceWhen: { kills: 15 }
        },
        { name: 'clear-out', spawn: null, advanceWhen: { allCleared: true } },
        {
          name: 'boss', // a single medium appears alone — it's the level's boss
          spawn: { maxConcurrent: 1, total: 1, pool: [{ ship: 'basic mini boss', chance: 1 }] },
          advanceWhen: { allCleared: true }
        },
        { name: 'victory', event: 'win', delay: 5, textKey: 'level.2.victory', text: 'Level 2 cleared! The mid-boss is down.' },
      ]
    }
  },
  // Level 3 — the full fight: waves of all three enemy types, then the Sector boss.
  // Briefing shown when the player reaches level 3 (after clearing level 2). Installs the repair drone.
  {
    name: 'level-3', descriptor: {
      title: 'Level 3', map: 'home-system',
      briefing: {
        textKey: 'level.3.briefing',
        text: "Good news, Sentinel — we salvaged a spare repair drone and fitted it to your ship. It'll patch up your hull mid-fight, a little at a time. If you take heavy damage, peel off to a quiet corner of the map and let it work.",
        actions: [{ type: 'installComponent', slot: 'repair', component: 12 }],
      },
      phases: [
        {
          name: 'wave-1',
          spawn: {
            maxConcurrent: 4, pool: [
              { ship: 'basic enemy ship', chance: 75 },
              { ship: 'basic rocket enemy', chance: 25 }]
          },
          advanceWhen: { kills: 10 }
        },
        {
          name: 'wave-2',
          spawn: {
            maxConcurrent: 4, pool: [
              { ship: 'basic enemy ship', chance: 65 },
              { ship: 'basic rocket enemy', chance: 20 },
              { ship: 'basic mini boss', chance: 15 }]
          },
          advanceWhen: { kills: 20 }
        },
        { name: 'clear-out', spawn: null, advanceWhen: { allCleared: true } },
        {
          name: 'boss',
          spawn: { maxConcurrent: 1, total: 1, pool: [{ ship: 'first boss', chance: 1 }] },
          advanceWhen: { allCleared: true }
        },
        { name: 'victory', event: 'win', delay: 5, textKey: 'level.3.victory', text: 'Sector cleared. Congratulations, Sentinel!' },
      ]
    }
  },
];

// --- maps: a JSON descriptor the client renders generically (buildMap). `generator` picks the code
// generator; `params` are its inputs. The current scene (blue ocean planet + two cratered moons +
// stars + a parallax asteroid layer + sky lighting) is the 'home-system' map. No binary assets —
// the textures are procedural from these colors/params.
export const MAPS = [
  {
    name: 'home-system', descriptor: {
      generator: 'planet-system',
      background: 0x05060d,
      sky: {
        ambient: { color: 0x3a506e, intensity: 0.7 },           // night-side fill
        sun: { color: 0xfff2e0, intensity: 3.4, pos: [170, -80, 40] }, // side light -> terminator
      },
      stars: { count: 2500, radius: 400 },
      planet: { pos: [-150, -285, -110], radius: 60, ocean: 0x5a82c0, halo: { color: 0x6fa8ff, opacity: 0.13 } },
      moons: [
        { radius: 11, color: 0xb9b2a6, orbitR: 96, tilt: 0.5, speed: 0.0625 },
        { radius: 7, color: 0x8f9aa6, orbitR: 136, tilt: -0.35, speed: -0.04 },
      ],
      // a field of small rocks filling the whole disk (inner=0) out to radius `spread`=1000 — inside
      // the arena AND far beyond it; the far edge fades into the fog (~600), so distant rocks read as
      // a faraway field you can fly out into
      asteroids: { count: 2000, inner: 0, spread: 1000, color: 0x6b6f78, minSize: 0.18, maxSize: 0.5, depth: 10, depthVar: 24 },
      // Mission set-pieces live in ONE shared world at FIXED positions — they exist on every level/mission;
      // a mission only changes WHERE you fight (its `center` in missions.js spawns you over the matching
      // one; the others sit at a distance). Spread far apart so they don't overlap. Just below the plane
      // (strong parallax like the background asteroids), static decor (not collidable). docs/plans/mission-maps.md.
      setpieces: [
        { type: 'asteroid-field', pos: [-500, -100, 0], scale: 1.0, color: 0x6e6a63, count: 24, spread: 240, hostSize: 26, beamLen: 34, beamTilt: 0.5, beamColor: 0xffcc66 },
        { type: 'research-station', pos: [350, -125, 0], scale: 0.6, hue: 0x9aa7b5, spin: 0.05, tilt: 0.35 },
        { type: 'freighter', pos: [-100, -48, -400], scale: 0.33, hue: 0x8a8f9c, cargoHue: 0xb0763a, speed: 2 },
      ],
    }
  },
];
