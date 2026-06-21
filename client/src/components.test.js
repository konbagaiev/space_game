import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDrive, hitsToKill, shipMass, REFERENCE_MASS, repairTick } from './components.js';

// Synthetic components mirroring the DB seed: hull {weight,durability}, engine {weight,power},
// thruster {weight,power}.
const HULL = {
  basic:  { weight: 20, durability: 100 },
  light:  { weight: 8,  durability: 30 },
  medium: { weight: 60, durability: 150 },
};
const ENGINE = {
  basic: { weight: 10, power: 10 },
  scout: { weight: 6,  power: 12.6 },
};
const THR = {
  basic: { weight: 4, power: 2.0 },
  scout: { weight: 3, power: 1.6 },
};
const W = { gun: { weight: 6 }, rocket: { weight: 8 } };
const mount = (weapon) => ({ weapon });
const playerShip = () => ({ hull: HULL.basic, engine: ENGINE.basic, thruster: THR.basic, mounts: [mount(W.gun), mount(W.rocket)] });

test('shipMass = hull + engine + thruster + every mounted weapon weight', () => {
  assert.equal(shipMass(playerShip()), 20 + 10 + 4 + 6 + 8);
  assert.equal(shipMass(playerShip()), REFERENCE_MASS); // 48
});

test('shipMass with no mounts = hull + engine + thruster only', () => {
  assert.equal(shipMass({ hull: HULL.light, engine: ENGINE.scout, thruster: THR.scout, mounts: [] }), 8 + 6 + 3);
});

test('deriveDrive: at the reference mass, stats equal the engine/thruster power', () => {
  const s = deriveDrive(playerShip());
  assert.equal(s.mass, REFERENCE_MASS);
  assert.equal(s.acceleration, 10);  // engine.power, massFactor = 1
  assert.equal(s.turnRate, 2.0);     // thruster.power, massFactor = 1
});

test('deriveDrive: a heavier hull lowers acceleration AND turn rate (same engine + thruster)', () => {
  const light  = deriveDrive({ hull: HULL.light,  engine: ENGINE.scout, thruster: THR.scout, mounts: [] });
  const medium = deriveDrive({ hull: HULL.medium, engine: ENGINE.scout, thruster: THR.scout, mounts: [] });
  assert.ok(medium.mass > light.mass);
  assert.ok(medium.acceleration < light.acceleration); // same drive, more mass -> slower
  assert.ok(medium.turnRate < light.turnRate);
});

test('deriveDrive: adding a weapon increases mass and lowers mobility', () => {
  const without = deriveDrive({ hull: HULL.light, engine: ENGINE.scout, thruster: THR.scout, mounts: [] });
  const withGun = deriveDrive({ hull: HULL.light, engine: ENGINE.scout, thruster: THR.scout, mounts: [mount(W.gun)] });
  assert.ok(withGun.mass > without.mass);
  assert.ok(withGun.acceleration < without.acceleration);
  assert.ok(withGun.turnRate < without.turnRate);
});

test('deriveDrive: a light ship out-accelerates the raw engine power', () => {
  const light = deriveDrive({ hull: HULL.light, engine: ENGINE.scout, thruster: THR.scout, mounts: [] });
  assert.ok(light.mass < REFERENCE_MASS);
  assert.ok(light.acceleration > ENGINE.scout.power); // massFactor > 1
});

test('hitsToKill: light hull (30hp) dies in 3 player gun hits (10 dmg)', () => {
  assert.equal(hitsToKill(HULL.light.durability, 10), 3);
});

test('hitsToKill: medium hull (150hp) takes 15 gun hits', () => {
  assert.equal(hitsToKill(HULL.medium.durability, 10), 15);
});

// --- repair drone (repairTick) ---
const DRONE = { repairPerTick: 1, intervalSec: 3, maxFraction: 0.8 }; // mirrors the DB seed (id 12)

test('repairTick: adds the repair weight to ship mass', () => {
  const base = shipMass({ hull: HULL.light, engine: ENGINE.scout, thruster: THR.scout, mounts: [] });
  const withDrone = shipMass({ hull: HULL.light, engine: ENGINE.scout, thruster: THR.scout, repair: { weight: 4 }, mounts: [] });
  assert.equal(withDrone, base + 4);
});

test('repairTick: heals 1 HP once per interval (banks sub-interval time)', () => {
  let { hp, accum } = repairTick(50, 100, DRONE, 1, 0); // 1s elapsed < 3s
  assert.equal(hp, 50);   // no tick yet
  assert.equal(accum, 1);
  ({ hp, accum } = repairTick(hp, 100, DRONE, 2.5, accum)); // total 3.5s -> one tick, 0.5 banked
  assert.equal(hp, 51);
  assert.ok(Math.abs(accum - 0.5) < 1e-9);
});

test('repairTick: a large dt can apply several ticks at once', () => {
  const { hp } = repairTick(50, 100, DRONE, 9, 0); // 9s / 3s = 3 ticks
  assert.equal(hp, 53);
});

test('repairTick: clamps at maxFraction*maxHp and never exceeds it', () => {
  const { hp, accum } = repairTick(79, 100, DRONE, 100, 0); // cap = 80
  assert.equal(hp, 80);
  assert.equal(accum, 0); // at the cap: don't bank time toward future ticks
});

test('repairTick: no-op when hp is already at/above the cap', () => {
  assert.deepEqual(repairTick(80, 100, DRONE, 3, 0), { hp: 80, accum: 0 });
  assert.deepEqual(repairTick(95, 100, DRONE, 3, 0), { hp: 95, accum: 0 }); // above cap: never reduces hp
});

test('repairTick: no drone (or disabled stats) is a no-op', () => {
  assert.deepEqual(repairTick(50, 100, null, 5, 2), { hp: 50, accum: 0 });
  assert.deepEqual(repairTick(50, 100, { repairPerTick: 0, intervalSec: 3 }, 5, 0), { hp: 50, accum: 0 });
});
