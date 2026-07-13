import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDrive, hitsToKill, shipMass, REFERENCE_MASS, repairTick, absorbDamage, shieldRecharge, applyPlayerDamage } from './components.js';

// Synthetic components mirroring the DB seed: hull {weight,durability}, engine {weight,power},
// thruster {weight,power}.
const HULL = {
  basic:  { weight: 20, durability: 100 },
  light:  { weight: 8,  durability: 30 },
  medium: { weight: 60, durability: 150 },
};
const ENGINE = {
  basic: { weight: 10, power: 15 },
  scout: { weight: 6,  power: 19 },
};
const THR = {
  basic: { weight: 4, power: 2.0 },
  scout: { weight: 3, power: 1.6 },
};
const W = { gun: { weight: 6 }, rocket: { weight: 8 } };
const GRAB = { base: { weight: 2, strength: 10 }, adv: { weight: 3, strength: 20 } }; // mirrors the DB seed (ids 29/30)
const mount = (weapon) => ({ weapon });
// The starter loadout now includes the base Grab (weight 2), so its mass = REFERENCE_MASS (50) → accel/turn 1:1.
const playerShip = () => ({ hull: HULL.basic, engine: ENGINE.basic, thruster: THR.basic, grab: GRAB.base, mounts: [mount(W.gun), mount(W.rocket)] });

test('shipMass = hull + engine + thruster + grab + every mounted weapon weight', () => {
  assert.equal(shipMass(playerShip()), 20 + 10 + 4 + 2 + 6 + 8);
  assert.equal(shipMass(playerShip()), REFERENCE_MASS); // 50 (starter loadout incl. the base grab)
});

test('shipMass: the grab slot adds its weight (mass-neutral baseline: bare loadout 48 + grab 2 = 50)', () => {
  const bare = { hull: HULL.basic, engine: ENGINE.basic, thruster: THR.basic, mounts: [mount(W.gun), mount(W.rocket)] };
  assert.equal(shipMass(bare), 48);
  assert.equal(shipMass({ ...bare, grab: GRAB.base }), 50); // base grab (+2)
  assert.equal(shipMass({ ...bare, grab: GRAB.adv }), 51);  // advanced grab (+3)
});

test('shipMass with no mounts = hull + engine + thruster only', () => {
  assert.equal(shipMass({ hull: HULL.light, engine: ENGINE.scout, thruster: THR.scout, mounts: [] }), 8 + 6 + 3);
});

test('deriveDrive: at the reference mass, stats equal the engine/thruster power', () => {
  const s = deriveDrive(playerShip());
  assert.equal(s.mass, REFERENCE_MASS);
  assert.equal(s.acceleration, 15);  // engine.power, massFactor = 1
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
const DRONE = { repairPerTick: 1, intervalSec: 1, maxFraction: 0.8 }; // mirrors the DB seed (id 12)

test('repairTick: adds the repair weight to ship mass', () => {
  const base = shipMass({ hull: HULL.light, engine: ENGINE.scout, thruster: THR.scout, mounts: [] });
  const withDrone = shipMass({ hull: HULL.light, engine: ENGINE.scout, thruster: THR.scout, repair: { weight: 4 }, mounts: [] });
  assert.equal(withDrone, base + 4);
});

test('repairTick: heals 1 HP once per interval (banks sub-interval time)', () => {
  let { hp, accum } = repairTick(50, 100, DRONE, 0.5, 0); // 0.5s elapsed < 1s
  assert.equal(hp, 50);   // no tick yet
  assert.equal(accum, 0.5);
  ({ hp, accum } = repairTick(hp, 100, DRONE, 0.7, accum)); // total 1.2s -> one tick, 0.2 banked
  assert.equal(hp, 51);
  assert.ok(Math.abs(accum - 0.2) < 1e-9);
});

test('repairTick: a large dt can apply several ticks at once', () => {
  const { hp } = repairTick(50, 100, DRONE, 3, 0); // 3s / 1s = 3 ticks
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

// --- shield (absorbDamage / shieldRecharge) — base shield mirrors the DB seed (id 31): cap 20, recharge 10s ---
test('absorbDamage: a partial hit reduces the shield with nothing reaching the hull', () => {
  assert.deepEqual(absorbDamage(20, 5), { shieldValue: 15, toHull: 0, broke: false });
});

test('absorbDamage: an exact-capacity hit breaks the shield to 0 with no overflow', () => {
  assert.deepEqual(absorbDamage(20, 20), { shieldValue: 0, toHull: 0, broke: true });
});

test('absorbDamage: an over-capacity hit breaks the shield and spills the excess to the hull', () => {
  assert.deepEqual(absorbDamage(20, 30), { shieldValue: 0, toHull: 10, broke: true });
});

test('shieldRecharge: no-op while the shield is still active/partial (does not bank time)', () => {
  assert.deepEqual(shieldRecharge(15, 20, 10, 5, 0), { shieldValue: 15, accum: 0 });
});

test('shieldRecharge: banks dt while broken but not yet full', () => {
  assert.deepEqual(shieldRecharge(0, 20, 10, 4, 0), { shieldValue: 0, accum: 4 });
});

test('shieldRecharge: refills to full capacity and resets the accumulator at rechargeSec', () => {
  assert.deepEqual(shieldRecharge(0, 20, 10, 6, 4), { shieldValue: 20, accum: 0 });
});

test('shieldRecharge: a large dt still refills to exactly capacity (no overshoot)', () => {
  assert.deepEqual(shieldRecharge(0, 20, 10, 100, 0), { shieldValue: 20, accum: 0 });
});

// --- applyPlayerDamage: shield-first damage routing + the { absorbed, broke } contract the hit FX rely on ---
// The shield-bubble FX (shield-fx.js) fires a ripple only when `absorbed` is true and a bigger flash when
// `broke` is true, so these return values are load-bearing for the visual — guard them.
test('applyPlayerDamage: a partial hit is fully absorbed by the shield (no hull damage, ripple only)', () => {
  const p = { shield: {}, _shieldValue: 20, _shieldRechargeAccum: 0, hp: 100 };
  assert.deepEqual(applyPlayerDamage(p, 5), { absorbed: true, broke: false });
  assert.equal(p._shieldValue, 15);
  assert.equal(p.hp, 100);
});

test('applyPlayerDamage: an exact-capacity hit breaks the shield and resets its recharge timer', () => {
  const p = { shield: {}, _shieldValue: 20, _shieldRechargeAccum: 7, hp: 100 };
  assert.deepEqual(applyPlayerDamage(p, 20), { absorbed: true, broke: true });
  assert.equal(p._shieldValue, 0);
  assert.equal(p._shieldRechargeAccum, 0); // timer reset on the breaking hit
  assert.equal(p.hp, 100);                 // exact break spills nothing
});

test('applyPlayerDamage: an over-capacity hit breaks the shield and spills the excess to the hull', () => {
  const p = { shield: {}, _shieldValue: 20, _shieldRechargeAccum: 0, hp: 100 };
  assert.deepEqual(applyPlayerDamage(p, 30), { absorbed: true, broke: true });
  assert.equal(p._shieldValue, 0);
  assert.equal(p.hp, 90); // 10 excess to hull
});

test('applyPlayerDamage: with no shield the full damage hits the hull (no ripple)', () => {
  const p = { shield: null, _shieldValue: 0, hp: 100 };
  assert.deepEqual(applyPlayerDamage(p, 12), { absorbed: false, broke: false });
  assert.equal(p.hp, 88);
});

test('applyPlayerDamage: an already-broken shield (value 0) takes nothing; damage goes to the hull', () => {
  const p = { shield: {}, _shieldValue: 0, hp: 100 };
  assert.deepEqual(applyPlayerDamage(p, 8), { absorbed: false, broke: false });
  assert.equal(p.hp, 92);
});
