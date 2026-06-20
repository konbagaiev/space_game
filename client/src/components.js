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

// Total ship mass = hull + engine + thruster weight + the weight of every mounted weapon.
export function shipMass(ship) {
  let mass = 0;
  for (const slot of ['hull', 'engine', 'thruster']) {
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
