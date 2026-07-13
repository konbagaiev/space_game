// ==================================================================
// Pure ship-drive derivation (no Three.js / DOM) — unit-tested in Node.
// Ships are assembled from DB components (a hull + an engine + maneuvering thrusters) plus mounted
// weapons; this module derives mobility from the engine/thrusters and the ship's mass. The
// component/weapon DATA itself lives in the database (see server/src/catalog_seed.js).
// ==================================================================

// Reference mass at which a ship's engine/thruster stats apply 1:1. = the player's starter loadout
// (hull 20 + engine 10 + thrusters 4 + gun 6 + rocket 8 + grab 2 = 50). Lighter ships get a boost
// (massFactor > 1), heavier ones a penalty (< 1). Bumped 48 → 50 when the base Grab (weight 2) was
// auto-equipped, so the player's baseline accel 10 / turn 2.0 is unchanged (mass-neutral, by design).
export const REFERENCE_MASS = 50;

// Total ship mass = hull + engine + thruster + repair-drone + grab weight + the weight of every mounted weapon.
export function shipMass(ship) {
  let mass = 0;
  for (const slot of ['hull', 'engine', 'thruster', 'repair', 'grab', 'shield']) {
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
  ship.acceleration = (ship.engine?.power ?? 0) * massFactor; // engine may be missing in the hangar (unequipped required slot)
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

// Absorb incoming damage with the shield first. Returns the new shield value, the damage that spills to
// the hull, and whether this hit FULLY depleted the shield. A partial hit (dmg < shieldValue) leaves the
// shield reduced with nothing reaching the hull; a hit >= shieldValue breaks it to 0 and spills the excess.
// Assumes shieldValue > 0 (the caller routes to the hull directly when the shield is already depleted).
export function absorbDamage(shieldValue, dmg) {
  if (dmg < shieldValue) return { shieldValue: shieldValue - dmg, toHull: 0, broke: false };
  return { shieldValue: 0, toHull: dmg - shieldValue, broke: true };
}

// Recharge a BROKEN shield. Only runs once fully depleted (shieldValue <= 0): a partial shield holds
// indefinitely (returns accum 0 = not recharging). While broken, banks dt; on reaching rechargeSec the
// shield refills to full capacity and reactivates. Pure: the caller passes the accumulator in/out.
export function shieldRecharge(shieldValue, capacity, rechargeSec, dt, accum) {
  if (shieldValue > 0 || !(capacity > 0) || !(rechargeSec > 0)) return { shieldValue, accum: 0 };
  accum += dt;
  if (accum >= rechargeSec) return { shieldValue: capacity, accum: 0 }; // refilled → active again
  return { shieldValue, accum };
}

// Route ALL incoming player damage through the shield first (bullets + rocket blast). The shield absorbs
// until fully depleted, spilling only the excess to the hull; once broken it stays at 0 and recharges in
// sim.update (shieldRecharge). No shield, or already depleted → full damage hits the hull. Pure: mutates
// only the passed-in player (no THREE/DOM), so the damage routing is state-independent and unit-testable.
// Returns { absorbed, broke }: whether the shield took any of this hit (so the caller can spawn the
// shield-ripple FX at the impact point) and whether this hit was the one that broke it (bigger flash).
export function applyPlayerDamage(player, dmg) {
  if (player.shield && player._shieldValue > 0) {
    const r = absorbDamage(player._shieldValue, dmg);
    player._shieldValue = r.shieldValue;
    if (r.broke) player._shieldRechargeAccum = 0; // start the recharge timer fresh on the breaking hit
    if (r.toHull > 0) player.hp -= r.toHull;
    return { absorbed: true, broke: r.broke };
  }
  player.hp -= dmg;
  return { absorbed: false, broke: false };
}
