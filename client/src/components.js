// ==================================================================
// Pure ship-drive derivation (no Three.js / DOM) — unit-tested in Node.
// Ships are assembled from DB components (a hull + an engine + maneuvering thrusters) plus mounted
// weapons; this module derives mobility from the engine/thrusters and the ship's mass. The
// component/weapon DATA itself lives in the database (see server/src/catalog_seed.js).
// ==================================================================

// Reference mass at which a ship's engine/thruster stats apply 1:1. = the player's loadout
// (hull 20 + engine 10 + thrusters 4 + gun 6 + rocket 8 = 48). Lighter ships get a boost
// (massFactor > 1), heavier ones a penalty (< 1).
export const REFERENCE_MASS = 48;

// Total ship mass = hull + engine + thruster + repair-drone weight + the weight of every mounted weapon.
export function shipMass(ship) {
  let mass = 0;
  for (const slot of ['hull', 'engine', 'thruster', 'repair']) {
    if (ship[slot] && typeof ship[slot].weight === 'number') mass += ship[slot].weight;
  }
  if (Array.isArray(ship.mounts)) {
    for (const m of ship.mounts) {
      if (m && m.weapon && typeof m.weapon.weight === 'number') mass += m.weapon.weight;
    }
  }
  return mass;
}

// Derive acceleration + turn rate, scaled by mass (heavier = slower & less agile). engine.power ->
// acceleration; thruster.power -> maneuverability (turn rate). Mutates and returns the ship.
export function deriveDrive(ship) {
  const mass = shipMass(ship);
  const massFactor = mass > 0 ? REFERENCE_MASS / mass : 1;
  ship.mass = mass;
  ship.acceleration = ship.engine.power * massFactor;
  ship.turnRate = (ship.thruster?.power ?? 0) * massFactor;
  return ship;
}

// How many hits a hull takes to destroy (derived; handy for balance/tests).
export function hitsToKill(hullDurability, weaponPower) {
  return Math.ceil(hullDurability / weaponPower);
}

// Passive hull repair from a repair-drone component. Pure/stateless: the caller holds the accumulator
// (seconds since the last tick) and passes it in/out, like deriveDrive stays side-effect-free.
// Heals `repairPerTick` HP every `intervalSec` seconds, capped at `maxFraction * maxHp`; never reduces
// hp and never exceeds the cap. No-op (returns the inputs unchanged) when there's no drone, or hp is
// already at/above the cap. Multiple ticks can land in one call if dt spans several intervals.
export function repairTick(hp, maxHp, repairComp, dt, accum) {
  if (!repairComp || !(repairComp.repairPerTick > 0) || !(repairComp.intervalSec > 0)) return { hp, accum: 0 };
  const cap = (repairComp.maxFraction ?? 1) * maxHp;
  if (hp >= cap) return { hp, accum: 0 }; // already topped up — don't bank time toward future ticks
  accum += dt;
  while (accum >= repairComp.intervalSec && hp < cap) {
    accum -= repairComp.intervalSec;
    hp = Math.min(cap, hp + repairComp.repairPerTick);
  }
  if (hp >= cap) accum = 0; // topped up: don't bank time toward an instant heal after the next hit
  return { hp, accum };
}
