import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDrive, hitsToKill, shipMass, REFERENCE_MASS } from './components.js';

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
