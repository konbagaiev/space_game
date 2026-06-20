// Seed data for the ships/weapons catalog — a snapshot of the game's ship/weapon design.
// Both backends seed from this via an idempotent upsert on startup (see db.js / db_postgres.js),
// so editing this file updates the catalog on the next start.
//
// References are by id everywhere. A ship has named fire GROUPS (a channel triggered by a key for
// the player, or by an AI range/aim rule for enemies) and a list of MOUNTS, each a weapon on a
// group with a lateral offset (side-by-side fire) and a delay (staggered volley). A player's
// loadout (player_ships.loadout) may override `mounts`; empty ⇒ the ship's default mounts.

// --- shared ship components ---
const HULL = {
  basic:     { name: 'Basic hull',     durability: 100, weight: 20, volume: 100 },
  fighter:   { name: 'Light hull',     durability: 20,  weight: 8,  volume: 40 },
  rocketeer: { name: 'Rocketeer hull', durability: 40,  weight: 14, volume: 60 },
  heavy:     { name: 'Heavy hull',     durability: 150, weight: 60, volume: 200 },
};
const ENGINE = {
  basic: { name: 'Basic main engine', power: 10,   maxSpeed: 0,    weight: 10, durability: 30, exhaust: { color: 0x6fd0ff, speed: 12, life: 0.55, size: 0.5, spread: 0.35 } },
  scout: { name: 'Scout main engine', power: 12.6, maxSpeed: 10.5, weight: 6,  durability: 20, exhaust: { color: 0xff8a5a, speed: 10, life: 0.4,  size: 0.4, spread: 0.3 } },
  heavy: { name: 'Heavy main engine', power: 6,    maxSpeed: 5,    weight: 30, durability: 60, exhaust: { color: 0xff7040, speed: 9,  life: 0.5,  size: 0.7, spread: 0.4 } },
};
const THRUSTER = {
  basic: { name: 'Basic thrusters', power: 2.0, weight: 4, durability: 15 },
  scout: { name: 'Scout thrusters', power: 1.6, weight: 3, durability: 10 },
  heavy: { name: 'Heavy thrusters', power: 0.8, weight: 8, durability: 25 },
};

// --- weapons: type 'bullet' | 'rocket'; stats hold the (now fully DB-driven) characteristics ---
// bullets: power (damage), projectileSpeed, maxRange (units), fireCooldown, weight, projectileColor.
// rockets: power (damage), accel, turnRate (maneuverability), launchSpeed, maxRange, health
//   (HP — reduced by a bullet's `power`; the rocket is shot down when it hits 0, so e.g. 20 HP
//   takes two 10-damage gun hits), blastRadius (AoE — can hit several), detonateRadius, blastVisual,
//   seekHalfAngle (homing search cone), fireCooldown, weight, projectileColor.
export const WEAPONS = [
  { id: 1, name: 'Basic kinetic', type: 'bullet', stats: {
      power: 10, projectileSpeed: 40, maxRange: 88, fireCooldown: 0.18, weight: 6, projectileColor: 0x6fe6ff } },
  { id: 2, name: 'Kinetic (enemy)', type: 'bullet', stats: {
      power: 5, projectileSpeed: 40, maxRange: 88, fireCooldown: 1.1, weight: 4, projectileColor: 0xff6b6b } },
  { id: 3, name: 'Rocket (homing)', type: 'rocket', stats: {
      power: 50, accel: 10, turnRate: 1.0, launchSpeed: 12, maxRange: 150, health: 30,
      seekHalfAngle: 60 * Math.PI / 180, detonateRadius: 3.2, blastRadius: 5, blastVisual: 4.5,
      fireCooldown: 5, weight: 8, projectileColor: 0xffaa44 } },
  { id: 4, name: 'Rocket (enemy)', type: 'rocket', stats: {
      power: 30, accel: 9, turnRate: 1.0, launchSpeed: 12, maxRange: 120, health: 20,
      detonateRadius: 3.2, blastRadius: 5, blastVisual: 4.5,
      fireCooldown: 4, weight: 6, projectileColor: 0xffcc66 } },
];

// fire-group presets (a group can carry a player key and/or an enemy AI rule; ships use what fits)
const GUN = { key: 'Space', ai: { range: 45, aimTol: 0.25 } };
const ROCKET = { key: 'KeyF', ai: { range: 80, aimTol: 0.40 } };

// --- ships: one table for player + enemies; stats carry groups + mounts (weapons by id).
// Enemy ships also carry spawn rules (spawnWeight, unlockAfterKills) so spawning is data-driven.
export const SHIPS = [
  { name: 'Basic player ship', type: 'player', modelUrl: 'assets/ships/player.glb', stats: {
      role: 'player', color: 0x4d8bff, hull: HULL.basic, engine: ENGINE.basic, thrusters: THRUSTER.basic,
      sizeScale: 1,
      groups: { gun: GUN, rocket: ROCKET },
      mounts: [
        { weapon: 1, group: 'gun',    offset: 0, delay: 0 },
        { weapon: 3, group: 'rocket', offset: 0, delay: 0 },
      ] } },
  { name: 'basic enemy ship', type: 'enemy', modelUrl: 'assets/ships/fighter.glb', stats: {
      role: 'fighter', color: 0xff5d5d, hull: HULL.fighter, engine: ENGINE.scout, thrusters: THRUSTER.scout,
      sizeScale: 1, spawnWeight: 5, unlockAfterKills: 0,
      groups: { gun: GUN },
      mounts: [ { weapon: 2, group: 'gun', offset: 0, delay: 0 } ] } },
  { name: 'basic rocket enemy', type: 'enemy', modelUrl: 'assets/ships/rocketeer.glb', stats: {
      role: 'rocketeer', color: 0xffd24d, hull: HULL.rocketeer, engine: ENGINE.scout, thrusters: THRUSTER.scout,
      sizeScale: 1, spawnWeight: 3, unlockAfterKills: 0,
      groups: { gun: GUN, rocket: ROCKET },
      mounts: [
        { weapon: 2, group: 'gun',    offset: 0, delay: 0 },
        { weapon: 4, group: 'rocket', offset: 0, delay: 0 },
      ] } },
  { name: 'basic mini boss', type: 'enemy', modelUrl: 'assets/ships/heavy.glb', stats: {
      role: 'heavy', color: 0xb267e6, hull: HULL.heavy, engine: ENGINE.heavy, thrusters: THRUSTER.heavy,
      sizeScale: 2, spawnWeight: 2, unlockAfterKills: 10,
      groups: { rocket: ROCKET },
      // two rocket launchers side by side, fired one after the other (0.2s stagger)
      mounts: [
        { weapon: 4, group: 'rocket', offset: -0.8, delay: 0 },
        { weapon: 4, group: 'rocket', offset:  0.8, delay: 0.2 },
      ] } },
];

// --- maps: a JSON descriptor the client renders generically (buildMap). `generator` picks the code
// generator; `params` are its inputs. The current scene (blue ocean planet + two cratered moons +
// stars + a parallax asteroid layer + sky lighting) is the 'home-system' map. No binary assets —
// the textures are procedural from these colors/params.
export const MAPS = [
  { name: 'home-system', descriptor: {
      generator: 'planet-system',
      background: 0x05060d,
      sky: {
        ambient: { color: 0x3a506e, intensity: 0.7 },           // night-side fill
        sun: { color: 0xfff2e0, intensity: 3.4, pos: [170, -80, 40] }, // side light -> terminator
      },
      stars: { count: 2500, radius: 400 },
      planet: { pos: [-150, -285, -110], radius: 60, ocean: 0x5a82c0, halo: { color: 0x6fa8ff, opacity: 0.13 } },
      moons: [
        { radius: 11, color: 0xb9b2a6, orbitR: 96,  tilt: 0.5,  speed: 0.0625 },
        { radius: 7,  color: 0x8f9aa6, orbitR: 136, tilt: -0.35, speed: -0.04 },
      ],
      asteroids: { count: 500, spread: 440, color: 0x6b6f78 },
  } },
];
