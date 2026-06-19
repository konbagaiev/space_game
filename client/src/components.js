// ==================================================================
// Data model: the components that ships are assembled from.
// Pure data + derivation, no Three.js / DOM — so it can be unit-tested in Node.
// Some stats are not yet used by the logic (weight, durability, volume) —
// reserved for the future (upgrades, balance, different ships).
// ==================================================================

// Main engines: power -> ACCELERATION. Exhaust is part of the engine.
export const ENGINES = {
  basic: {
    name: 'Basic main engine',
    power: 10,        // thrust power -> acceleration
    maxSpeed: 0,      // 0 = no limit (for the player)
    weight: 10,       // [not used yet]
    durability: 30,   // [not used yet]
    exhaust: { color: 0x6fd0ff, speed: 12, life: 0.55, size: 0.5, spread: 0.35 },
  },
  scout: {            // enemy engine - weaker
    name: 'Scout main engine',
    power: 12.6,
    maxSpeed: 10.5,
    weight: 6,
    durability: 20,
    exhaust: { color: 0xff8a5a, speed: 10, life: 0.4, size: 0.4, spread: 0.3 },
  },
  heavy: {            // heavy enemy engine - slow
    name: 'Heavy main engine',
    power: 6,
    maxSpeed: 5,
    weight: 30,
    durability: 60,
    exhaust: { color: 0xff7040, speed: 9, life: 0.5, size: 0.7, spread: 0.4 },
  },
};

// Maneuvering thrusters: power -> TURN RATE (rad/s at coefficient 1).
export const THRUSTERS = {
  basic: { name: 'Basic thrusters', power: 2.0, weight: 4, durability: 15 },
  scout: { name: 'Scout thrusters', power: 1.6, weight: 3, durability: 10 },
  heavy: { name: 'Heavy thrusters', power: 0.8, weight: 8, durability: 25 },
};

// Coefficients converting component power into ship stats (derived).
export const THRUST_TO_ACCEL = 1;    // acceleration = main engine power x this coefficient
export const THRUSTER_TO_TURN = 1;   // maneuverability = thruster power x this coefficient

// Component slots whose weight adds to a ship's total mass.
export const COMPONENT_SLOTS = ['hull', 'engine', 'thrusters', 'weapon', 'secondary', 'rocket'];

// Total ship mass = sum of the weights of all its components.
export function shipMass(ship) {
  let mass = 0;
  for (const slot of COMPONENT_SLOTS) {
    const c = ship[slot];
    if (c && typeof c.weight === 'number') mass += c.weight;
  }
  return mass;
}

// Reference mass at which a ship's stats equal its raw component power.
// = the player's basic loadout (hull 20 + engine 10 + thrusters 4 + gun 6 + rocket 8 = 48).
// Lighter ships get a boost (massFactor > 1), heavier ones a penalty (< 1).
export const REFERENCE_MASS = 48;

// Derive ship stats from its engines AND its mass (mutates the ship object).
// acceleration ~ enginePower / mass, turnRate ~ thrusterPower / mass (heavier = slower).
export function deriveDrive(ship) {
  const mass = shipMass(ship);
  const massFactor = mass > 0 ? REFERENCE_MASS / mass : 1;
  ship.mass = mass;
  ship.acceleration = ship.engine.power * THRUST_TO_ACCEL * massFactor;
  ship.turnRate = ship.thrusters.power * THRUSTER_TO_TURN * massFactor;
  return ship;
}

// Hulls.
export const HULLS = {
  basic: {
    name: 'Basic hull',
    durability: 100,  // = maxHp
    weight: 20,       // [not used yet]
    volume: 100,      // [not used yet]
  },
  fighter: {          // enemy hull
    name: 'Light hull',
    durability: 20,   // 2 hits of the basic weapon (10 damage)
    weight: 8,
    volume: 40,
  },
  rocketeer: {        // hull of the yellow "rocketeer" - sturdier
    name: 'Rocketeer hull',
    durability: 40,   // 4 hits of the basic weapon
    weight: 14,
    volume: 60,
  },
  heavy: {            // hull of the slow "heavy" enemy
    name: 'Heavy hull',
    durability: 150,
    weight: 60,
    volume: 200,
  },
};

// Weapons.
export const WEAPONS = {
  basicKinetic: {
    name: 'Basic kinetic',
    type: 'kinetic',
    power: 10,           // damage per hit
    projectileSpeed: 40, // projectile speed
    fireCooldown: 0.18,  // reload, sec
    weight: 6,           // contributes to ship mass
    projectileColor: 0x6fe6ff,
  },
  enemyKinetic: {
    name: 'Kinetic (enemy)',
    type: 'kinetic',
    power: 5,
    projectileSpeed: 40,
    fireCooldown: 1.1,
    weight: 4,
    projectileColor: 0xff6b6b,
  },
  homingRocket: {
    name: 'Rocket (homing)',
    type: 'rocket',
    power: 50,                          // damage
    fireCooldown: 5,                    // reload, sec
    seekHalfAngle: 60 * Math.PI / 180,  // search half-sector (120 deg total)
    turnRate: 1.0,                      // maneuverability: turn rate toward target, rad/s
    launchSpeed: 12,                    // initial speed
    detonateRadius: 3.2,                // detonation distance near the enemy
    blastRadius: 5,                     // blast radius (slightly larger than a bullet)
    blastVisual: 4.5,                   // visual explosion size (bullet is ~3)
    life: 4,                            // self-destruct, sec
    weight: 8,                          // launcher contributes to ship mass
    projectileColor: 0xffaa44,
    // acceleration toward target = player's engine.power
  },
  enemyRocket: {
    name: 'Rocket (enemy)',
    type: 'rocket',
    power: 30,
    fireCooldown: 4,
    turnRate: 1.0,
    launchSpeed: 12,
    accel: 9,                           // the enemy has its own homing acceleration
    detonateRadius: 3.2,
    blastRadius: 5,
    blastVisual: 4.5,
    life: 4,
    weight: 6,
    projectileColor: 0xffcc66,
  },
};

// Enemy types: regular fighter, yellow "rocketeer", and slow purple "heavy".
export const ENEMY_KINDS = {
  fighter: {
    color: 0xff5d5d, hull: HULLS.fighter, engine: ENGINES.scout, thrusters: THRUSTERS.scout,
    weapon: WEAPONS.enemyKinetic, rocket: null,
  },
  rocketeer: {
    color: 0xffd24d, hull: HULLS.rocketeer, engine: ENGINES.scout, thrusters: THRUSTERS.scout,
    weapon: WEAPONS.enemyKinetic, rocket: WEAPONS.enemyRocket,
  },
  heavy: {            // slow rocket-only tank, 2x model, unlocks after 10 kills
    color: 0xb267e6, hull: HULLS.heavy, engine: ENGINES.heavy, thrusters: THRUSTERS.heavy,
    weapon: null, rocket: WEAPONS.enemyRocket, sizeScale: 2,
  },
};

// How many basic-weapon hits a hull takes to destroy (derived; handy for balance/tests).
export function hitsToKill(hullDurability, weaponPower) {
  return Math.ceil(hullDurability / weaponPower);
}
