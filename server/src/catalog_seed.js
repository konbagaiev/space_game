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
export const COMPONENTS = [
  { id: 1, name: 'Basic hull',  type: 'hull', weight: 20,  stats: { durability: 100, volume: 100 } },
  { id: 2, name: 'Light hull',  type: 'hull', weight: 8,   stats: { durability: 30,  volume: 40 } },
  { id: 3, name: 'Medium hull', type: 'hull', weight: 60,  stats: { durability: 150, volume: 200 } },
  { id: 4, name: 'Boss hull',   type: 'hull', weight: 100, stats: { durability: 210, volume: 400 } },
  { id: 5, name: 'Basic engine', type: 'engine', weight: 10, stats: { power: 10,   maxSpeed: 0,    exhaust: { color: 0x6fd0ff, speed: 12, life: 0.55, size: 0.5, spread: 0.35 } } },
  { id: 6, name: 'Scout engine', type: 'engine', weight: 6,  stats: { power: 12.6, maxSpeed: 10.5, exhaust: { color: 0xff8a5a, speed: 10, life: 0.4,  size: 0.4, spread: 0.3 } } },
  { id: 7, name: 'Boss engine',  type: 'engine', weight: 50, stats: { power: 19,   maxSpeed: 8,    exhaust: { color: 0xff5a3a, speed: 10, life: 0.6,  size: 0.9, spread: 0.45 } } },
  { id: 8,  name: 'Basic thrusters',  type: 'thruster', weight: 4,  stats: { power: 2.0 } },
  { id: 9,  name: 'Scout thrusters',  type: 'thruster', weight: 3,  stats: { power: 1.6 } },
  { id: 10, name: 'Medium thrusters', type: 'thruster', weight: 8,  stats: { power: 0.63 } }, // sluggish (turn ~0.35)
  { id: 11, name: 'Boss thrusters',   type: 'thruster', weight: 20, stats: { power: 1.66 } }, // turn ~0.42 = 1.2× medium
];

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

// --- ships: one table for player + enemies. `components` references a hull + an engine by id
// (player_ships.components may override them); `stats` carry role/color/sizeScale + groups + mounts.
// fighter, rocketeer and the medium share the SAME engine (6); the medium is sluggish only because of
// its heavier hull (mass). The boss has its own hull + engine; weapons are shared (in WEAPONS).
export const SHIPS = [
  { name: 'Basic player ship', type: 'player', modelUrl: 'assets/ships/player.glb',
    components: { hull: 1, engine: 5, thruster: 8 }, stats: {
      role: 'player', color: 0x4d8bff, sizeScale: 1,
      groups: { gun: GUN, rocket: ROCKET },
      mounts: [
        { weapon: 1, group: 'gun',    offset: 0, delay: 0 },
        { weapon: 3, group: 'rocket', offset: 0, delay: 0 },
      ] } },
  { name: 'basic enemy ship', type: 'enemy', modelUrl: 'assets/ships/fighter.glb',
    components: { hull: 2, engine: 6, thruster: 9 }, stats: { // light hull (30 hp) + scout engine/thrusters
      role: 'fighter', color: 0xff5d5d, sizeScale: 1, reward: 20,
      groups: { gun: GUN },
      mounts: [ { weapon: 2, group: 'gun', offset: 0, delay: 0 } ] } },
  { name: 'basic rocket enemy', type: 'enemy', modelUrl: 'assets/ships/rocketeer.glb',
    components: { hull: 2, engine: 6, thruster: 9 }, stats: { // same hull + engine + thrusters as the fighter
      role: 'rocketeer', color: 0xffd24d, sizeScale: 1, reward: 40,
      groups: { gun: GUN, rocket: ROCKET },
      mounts: [
        { weapon: 2, group: 'gun',    offset: 0, delay: 0 },
        { weapon: 4, group: 'rocket', offset: 0, delay: 0 },
      ] } },
  { name: 'basic mini boss', type: 'enemy', modelUrl: 'assets/ships/heavy.glb',
    components: { hull: 3, engine: 6, thruster: 10 }, stats: { // medium hull + scout engine + weak (Medium) thrusters
      role: 'medium', color: 0xb267e6, sizeScale: 2, reward: 100,
      groups: { rocket: ROCKET },
      // two rocket launchers side by side, fired one after the other (0.2s stagger)
      mounts: [
        { weapon: 4, group: 'rocket', offset: -0.8, delay: 0 },
        { weapon: 4, group: 'rocket', offset:  0.8, delay: 0.2 },
      ] } },
  // The end-of-level boss: big orange ship (its own .glb), its own hull + engine, two guns side by
  // side + two staggered rocket launchers.
  { name: 'first boss', type: 'enemy', modelUrl: 'assets/ships/boss.glb',
    components: { hull: 4, engine: 7, thruster: 11 }, stats: {
      role: 'boss', color: 0xff8c2a, sizeScale: 3, reward: 200,
      groups: { gun: GUN, rocket: ROCKET },
      mounts: [
        { weapon: 2, group: 'gun',    offset: -0.6, delay: 0 },
        { weapon: 2, group: 'gun',    offset:  0.6, delay: 0 },
        { weapon: 4, group: 'rocket', offset: -0.9, delay: 0 },
        { weapon: 4, group: 'rocket', offset:  0.9, delay: 0.2 },
      ] } },
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
  { name: 'level-1', descriptor: {
      title: 'Level 1', map: 'home-system',
      phases: [
        { name: 'wave-1', // only plain fighters, 3 at a time
          spawn: { maxConcurrent: 3, pool: [ { ship: 'basic enemy ship', chance: 100 } ] },
          advanceWhen: { kills: 7 } },
        { name: 'wave-2', // rocketeers join at 25%
          spawn: { maxConcurrent: 3, pool: [
            { ship: 'basic enemy ship', chance: 75 },
            { ship: 'basic rocket enemy', chance: 25 } ] },
          advanceWhen: { kills: 15 } },
        { name: 'finale', // spawning stops; one last rocketeer, then clear the field
          spawn: { maxConcurrent: 4, total: 1, pool: [ { ship: 'basic rocket enemy', chance: 100 } ] },
          advanceWhen: { allCleared: true } },
        { name: 'victory', event: 'win', delay: 2, text: 'Level 1 cleared! Nice flying, Ninja.' },
      ] } },
  // Level 2 — medium: ends with a single mini-boss (the medium) as the boss.
  { name: 'level-2', descriptor: {
      title: 'Level 2', map: 'home-system',
      phases: [
        { name: 'wave-1', // only fighters until 5 kills
          spawn: { maxConcurrent: 4, pool: [ { ship: 'basic enemy ship', chance: 100 } ] },
          advanceWhen: { kills: 5 } },
        { name: 'wave-2', // fighters + rocketeers 75/25 until 15 kills
          spawn: { maxConcurrent: 4, pool: [
            { ship: 'basic enemy ship', chance: 75 },
            { ship: 'basic rocket enemy', chance: 25 } ] },
          advanceWhen: { kills: 15 } },
        { name: 'clear-out', spawn: null, advanceWhen: { allCleared: true } },
        { name: 'boss', // a single medium appears alone — it's the level's boss
          spawn: { maxConcurrent: 1, total: 1, pool: [ { ship: 'basic mini boss', chance: 1 } ] },
          advanceWhen: { allCleared: true } },
        { name: 'victory', event: 'win', delay: 5, text: 'Level 2 cleared! The mid-boss is down.' },
      ] } },
  // Level 3 — the full fight: waves of all three enemy types, then the Sector boss.
  { name: 'level-3', descriptor: {
      title: 'Level 3', map: 'home-system',
      phases: [
        { name: 'wave-1',
          spawn: { maxConcurrent: 4, pool: [
            { ship: 'basic enemy ship', chance: 75 },
            { ship: 'basic rocket enemy', chance: 25 } ] },
          advanceWhen: { kills: 10 } },
        { name: 'wave-2',
          spawn: { maxConcurrent: 4, pool: [
            { ship: 'basic enemy ship', chance: 65 },
            { ship: 'basic rocket enemy', chance: 20 },
            { ship: 'basic mini boss', chance: 15 } ] },
          advanceWhen: { kills: 20 } },
        { name: 'clear-out', spawn: null, advanceWhen: { allCleared: true } },
        { name: 'boss',
          spawn: { maxConcurrent: 1, total: 1, pool: [ { ship: 'first boss', chance: 1 } ] },
          advanceWhen: { allCleared: true } },
        { name: 'victory', event: 'win', delay: 5, text: 'Sector cleared. Congratulations, Space Ninja!' },
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
