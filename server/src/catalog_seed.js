// Seed data for the ships/weapons catalog — a snapshot of the client component catalogs
// (client/src/components.js + the player loadout). Both backends seed from this: the SQLite
// migration (002) and the Postgres bootstrap.
//
// References are by id everywhere: a ship's stats reference weapons by id, and a player's
// loadout (player_ships.loadout) does too. Weapons therefore get STABLE explicit ids.
// Keep this in sync with the client catalogs until the client reads the catalog from the API.

// --- shared ship components (mirror of client/src/components.js) ---
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

// --- weapons: stable explicit ids; type is 'bullet' or 'rocket'; stats hold the characteristics ---
export const WEAPONS = [
  { id: 1, name: 'Basic kinetic', type: 'bullet', stats: {
      power: 10, projectileSpeed: 40, fireCooldown: 0.18, weight: 6, projectileColor: 0x6fe6ff } },
  { id: 2, name: 'Kinetic (enemy)', type: 'bullet', stats: {
      power: 5, projectileSpeed: 40, fireCooldown: 1.1, weight: 4, projectileColor: 0xff6b6b } },
  { id: 3, name: 'Rocket (homing)', type: 'rocket', stats: {
      power: 50, fireCooldown: 5, seekHalfAngle: 60 * Math.PI / 180, turnRate: 1.0,
      launchSpeed: 12, detonateRadius: 3.2, blastRadius: 5, blastVisual: 4.5, life: 4,
      weight: 8, projectileColor: 0xffaa44 } },
  { id: 4, name: 'Rocket (enemy)', type: 'rocket', stats: {
      power: 30, fireCooldown: 4, turnRate: 1.0, launchSpeed: 12, accel: 9,
      detonateRadius: 3.2, blastRadius: 5, blastVisual: 4.5, life: 4,
      weight: 6, projectileColor: 0xffcc66 } },
];

// --- ships: one table for the player and the enemies; type is 'player' or 'enemy'.
// stats carry the loadout/characteristics; weapon/secondary/rocket reference weapons BY ID.
// Enemy ships also carry spawn rules (spawnWeight, unlockAfterKills) so spawning is data-driven.
export const SHIPS = [
  { name: 'Basic player ship', type: 'player', modelUrl: 'assets/ships/player.glb', stats: {
      role: 'player', color: 0x4d8bff, hull: HULL.basic, engine: ENGINE.basic, thrusters: THRUSTER.basic,
      weapon: 1, secondary: 3, rocket: null, sizeScale: 1 } },
  { name: 'basic enemy ship', type: 'enemy', modelUrl: 'assets/ships/fighter.glb', stats: {
      role: 'fighter', color: 0xff5d5d, hull: HULL.fighter, engine: ENGINE.scout, thrusters: THRUSTER.scout,
      weapon: 2, secondary: null, rocket: null, sizeScale: 1, spawnWeight: 5, unlockAfterKills: 0 } },
  { name: 'basic rocket enemy', type: 'enemy', modelUrl: 'assets/ships/rocketeer.glb', stats: {
      role: 'rocketeer', color: 0xffd24d, hull: HULL.rocketeer, engine: ENGINE.scout, thrusters: THRUSTER.scout,
      weapon: 2, secondary: null, rocket: 4, sizeScale: 1, spawnWeight: 3, unlockAfterKills: 0 } },
  { name: 'basic mini boss', type: 'enemy', modelUrl: 'assets/ships/heavy.glb', stats: {
      role: 'heavy', color: 0xb267e6, hull: HULL.heavy, engine: ENGINE.heavy, thrusters: THRUSTER.heavy,
      weapon: null, secondary: null, rocket: 4, sizeScale: 2, spawnWeight: 2, unlockAfterKills: 10 } },
];
