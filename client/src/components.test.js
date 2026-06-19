import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINES, THRUSTERS, HULLS, WEAPONS, ENEMY_KINDS,
  deriveDrive, hitsToKill, shipMass, REFERENCE_MASS,
} from './components.js';

// Fresh loadouts per call (deriveDrive mutates the ship object).
const playerLoadout = () => ({
  hull: HULLS.basic, engine: ENGINES.basic, thrusters: THRUSTERS.basic,
  weapon: WEAPONS.basicKinetic, secondary: WEAPONS.homingRocket,
});
const shipFromKind = (k) => ({
  hull: k.hull, engine: k.engine, thrusters: k.thrusters, weapon: k.weapon, rocket: k.rocket,
});

test('shipMass = sum of all component weights', () => {
  const expected = HULLS.basic.weight + ENGINES.basic.weight + THRUSTERS.basic.weight
    + WEAPONS.basicKinetic.weight + WEAPONS.homingRocket.weight;
  assert.equal(shipMass(playerLoadout()), expected);
  assert.equal(shipMass(playerLoadout()), 48);
});

test('shipMass ignores empty slots (e.g. no gun)', () => {
  const heavy = shipFromKind(ENEMY_KINDS.heavy); // weapon: null
  assert.equal(heavy.weapon, null);
  const expected = HULLS.heavy.weight + ENGINES.heavy.weight + THRUSTERS.heavy.weight + WEAPONS.enemyRocket.weight;
  assert.equal(shipMass(heavy), expected);
});

test('deriveDrive: at the reference mass, stats equal raw component power', () => {
  const ship = deriveDrive(playerLoadout());
  assert.equal(ship.mass, REFERENCE_MASS);
  assert.equal(ship.acceleration, 10);  // engine.power, massFactor = 1
  assert.equal(ship.turnRate, 2.0);     // thrusters.power, massFactor = 1
});

test('deriveDrive: heavier ship has lower acceleration AND turn rate', () => {
  const base = deriveDrive(playerLoadout());
  const heavier = deriveDrive({ ...playerLoadout(), hull: HULLS.heavy }); // +130 weight
  assert.ok(heavier.mass > base.mass);
  assert.ok(heavier.acceleration < base.acceleration);
  assert.ok(heavier.turnRate < base.turnRate);
});

test('deriveDrive: adding a component (weapon) increases mass and lowers stats', () => {
  const without = deriveDrive({ hull: HULLS.basic, engine: ENGINES.basic, thrusters: THRUSTERS.basic });
  const withGun = deriveDrive({ hull: HULLS.basic, engine: ENGINES.basic, thrusters: THRUSTERS.basic, weapon: WEAPONS.basicKinetic });
  assert.ok(withGun.mass > without.mass);
  assert.ok(withGun.acceleration < without.acceleration);
  assert.ok(withGun.turnRate < without.turnRate);
});

test('deriveDrive: lighter ship is faster than the reference', () => {
  const light = deriveDrive({ hull: HULLS.fighter, engine: ENGINES.basic, thrusters: THRUSTERS.basic });
  assert.ok(light.mass < REFERENCE_MASS);
  assert.ok(light.acceleration > ENGINES.basic.power); // massFactor > 1
});

test('heavy enemy is slower than the fighter in both acceleration and turn rate', () => {
  const heavy = deriveDrive(shipFromKind(ENEMY_KINDS.heavy));
  const fighter = deriveDrive(shipFromKind(ENEMY_KINDS.fighter));
  assert.ok(heavy.mass > fighter.mass);
  assert.ok(heavy.acceleration < fighter.acceleration);
  assert.ok(heavy.turnRate < fighter.turnRate);
});

test('base balance: fighter dies in 2 player hits', () => {
  assert.equal(hitsToKill(HULLS.fighter.durability, WEAPONS.basicKinetic.power), 2);
});

test('heavy hull is 150 hp (15 gun hits)', () => {
  assert.equal(HULLS.heavy.durability, 150);
  assert.equal(hitsToKill(HULLS.heavy.durability, WEAPONS.basicKinetic.power), 15);
});

test('heavy enemy kind is rocket-only and double-sized', () => {
  assert.equal(ENEMY_KINDS.heavy.weapon, null);
  assert.ok(ENEMY_KINDS.heavy.rocket);
  assert.equal(ENEMY_KINDS.heavy.sizeScale, 2);
});

test('player rocket out-damages the gun', () => {
  assert.ok(WEAPONS.homingRocket.power > WEAPONS.basicKinetic.power);
});
