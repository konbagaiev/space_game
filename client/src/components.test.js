import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveDrive, hitsToKill, shipMass, REFERENCE_MASS, repairTick, absorbDamage, shieldRecharge,
  applyShieldedDamage, enemyShieldSplit, ENEMY_SHIELD_RECHARGE_SEC, skillEffects, SKILL_RATES,
} from './components.js';

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

// --- applyShieldedDamage: shield-first damage routing + the { absorbed, broke } contract the hit FX rely on ---
// The shield-bubble FX (shield-fx.js) fires a ripple only when `absorbed` is true and a bigger flash when
// `broke` is true, so these return values are load-bearing for the visual — guard them.
test('applyShieldedDamage: a partial hit is fully absorbed by the shield (no hull damage, ripple only)', () => {
  const p = { shield: {}, _shieldValue: 20, _shieldRechargeAccum: 0, hp: 100 };
  assert.deepEqual(applyShieldedDamage(p, 5), { absorbed: true, broke: false });
  assert.equal(p._shieldValue, 15);
  assert.equal(p.hp, 100);
});

test('applyShieldedDamage: an exact-capacity hit breaks the shield and resets its recharge timer', () => {
  const p = { shield: {}, _shieldValue: 20, _shieldRechargeAccum: 7, hp: 100 };
  assert.deepEqual(applyShieldedDamage(p, 20), { absorbed: true, broke: true });
  assert.equal(p._shieldValue, 0);
  assert.equal(p._shieldRechargeAccum, 0); // timer reset on the breaking hit
  assert.equal(p.hp, 100);                 // exact break spills nothing
});

test('applyShieldedDamage: an over-capacity hit breaks the shield and spills the excess to the hull', () => {
  const p = { shield: {}, _shieldValue: 20, _shieldRechargeAccum: 0, hp: 100 };
  assert.deepEqual(applyShieldedDamage(p, 30), { absorbed: true, broke: true });
  assert.equal(p._shieldValue, 0);
  assert.equal(p.hp, 90); // 10 excess to hull
});

test('applyShieldedDamage: with no shield the full damage hits the hull (no ripple)', () => {
  const p = { shield: null, _shieldValue: 0, hp: 100 };
  assert.deepEqual(applyShieldedDamage(p, 12), { absorbed: false, broke: false });
  assert.equal(p.hp, 88);
});

test('applyShieldedDamage: an already-broken shield (value 0) takes nothing; damage goes to the hull', () => {
  const p = { shield: {}, _shieldValue: 0, hp: 100 };
  assert.deepEqual(applyShieldedDamage(p, 8), { absorbed: false, broke: false });
  assert.equal(p.hp, 92);
});

// --- Enemy shield split & lossless damage -----------------------------------------------------------
// Enemies carve 1/3 of their catalog hull durability into a shield buffer (the rest stays hull), so a kill
// finished inside one shield cycle costs EXACTLY the damage it cost before shields. These tests are the
// guard for that invariant — the recorded Level-0 intro replay depends on it (DECISIONS §76).
const DURABILITIES = [30, 36, 150, 300, 310, 550]; // every enemy hull in catalog_seed.js

const makeEnemy = (d) => {
  const { shieldCap, hullMax } = enemyShieldSplit(d);
  return {
    shield: shieldCap ? { capacity: shieldCap, rechargeSec: ENEMY_SHIELD_RECHARGE_SEC } : null,
    _shieldValue: shieldCap, _shieldRechargeAccum: 0, hp: hullMax, maxHp: hullMax,
  };
};
const killWith = (d, perHit) => {
  const e = makeEnemy(d);
  let hits = 0;
  while (e.hp > 0) { applyShieldedDamage(e, perHit); hits++; if (hits > 10000) throw new Error('runaway'); }
  return { hits, dealt: hits * perHit, overkill: -e.hp };
};

test('enemyShieldSplit: the split is integer, exact and always sums back to the catalog durability', () => {
  for (const d of DURABILITIES) {
    const { shieldCap, hullMax } = enemyShieldSplit(d);
    assert.equal(shieldCap, Math.round(d / 3), `${d} → shield is 1/3 rounded`);
    assert.ok(Number.isInteger(shieldCap) && Number.isInteger(hullMax), `${d} → both pools are integers`);
    assert.equal(shieldCap + hullMax, d, `${d} → shield + hull equals the original durability`);
  }
});

test('enemyShieldSplit: a missing/zero durability yields no shield (defensive)', () => {
  assert.deepEqual(enemyShieldSplit(0), { shieldCap: 0, hullMax: 0 });
  assert.deepEqual(enemyShieldSplit(undefined), { shieldCap: 0, hullMax: 0 });
});

test('enemy shields are LOSSLESS: damage-to-kill is identical to the pre-shield hull', () => {
  for (const d of DURABILITIES) {
    for (const perHit of [6, 7, 13, 40, 100]) {
      const { hits, dealt, overkill } = killWith(d, perHit);
      assert.equal(hits, hitsToKill(d, perHit), `${d} HP @ ${perHit}/hit → same hit count as before shields`);
      assert.equal(dealt - overkill, d, `${d} HP @ ${perHit}/hit → every damage point is accounted for`);
    }
  }
});

test('enemy shields: a single overkill hit still kills in one hit', () => {
  for (const d of DURABILITIES) {
    const { hits } = killWith(d, d + 50);
    assert.equal(hits, 1, `${d} HP dies to one oversized hit`);
  }
});

test('enemy shields: an exact-capacity hit breaks the shield without touching the hull', () => {
  const { shieldCap, hullMax } = enemyShieldSplit(150);
  const e = makeEnemy(150);
  e._shieldRechargeAccum = 4; // banked time from an earlier break must be cleared by the breaking hit
  assert.deepEqual(applyShieldedDamage(e, shieldCap), { absorbed: true, broke: true });
  assert.equal(e._shieldValue, 0);
  assert.equal(e._shieldRechargeAccum, 0);
  assert.equal(e.hp, hullMax);              // exact break spills nothing
  applyShieldedDamage(e, 10);               // the next hit goes 100% to the hull
  assert.equal(e.hp, hullMax - 10);
});

test('enemy shields: a multi-hit volley (triple spiral 3×40) deals its full 120 to a mini boss', () => {
  const e = makeEnemy(150); // 50 shield + 100 hull
  for (let i = 0; i < 3; i++) applyShieldedDamage(e, 40);
  assert.equal(e._shieldValue, 0);
  assert.equal(e.hp, 100 - 70);             // 120 dealt: 50 absorbed, 70 to the hull
  assert.equal(e.shield.capacity + e.maxHp - (e._shieldValue + e.hp), 120);
});

test('enemy shields: a PARTIAL shield never recharges; a broken one refills to full after rechargeSec', () => {
  const { shieldCap } = enemyShieldSplit(30); // 10
  assert.deepEqual(shieldRecharge(shieldCap - 1, shieldCap, 10, 5, 0), { shieldValue: shieldCap - 1, accum: 0 });
  assert.deepEqual(shieldRecharge(0, shieldCap, 10, 10, 0), { shieldValue: shieldCap, accum: 0 });
});

test('the derived enemy shield is WEIGHTLESS: mass, acceleration and turn rate are unchanged', () => {
  const base = () => ({ hull: HULL.light, engine: ENGINE.scout, thruster: THR.scout, mounts: [] });
  const withShield = deriveDrive({ ...base(), shield: { capacity: 10, rechargeSec: ENEMY_SHIELD_RECHARGE_SEC } });
  const without = deriveDrive({ ...base(), shield: null });
  assert.equal(shipMass(withShield), shipMass(without), 'a weightless shield does not add mass');
  assert.equal(withShield.acceleration, without.acceleration);
  assert.equal(withShield.turnRate, without.turnRate);
});

// --- skillEffects (character progression): point allocation -> concrete multipliers/bonuses ---
test('skillEffects: no/empty allocation is the identity (x1, +0, no dodge)', () => {
  for (const s of [undefined, null, {}, { kinetic: 0, rocket: 0, shields: 0, maneuver: 0, mobility: 0 }]) {
    const fx = skillEffects(s);
    assert.equal(fx.kineticDmgMul, 1); assert.equal(fx.aimAssistBonusDeg, 0);
    assert.equal(fx.rocketDmgMul, 1); assert.equal(fx.rocketSpeedMul, 1);
    assert.equal(fx.shieldMul, 1); assert.equal(fx.dodge, 0); assert.equal(fx.mobilityMul, 1);
  }
});

test('skillEffects: each point adds one SKILL_RATES step, and skills are independent', () => {
  const fx = skillEffects({ kinetic: 3, rocket: 2, shields: 4, maneuver: 5, mobility: 1 });
  assert.ok(Math.abs(fx.kineticDmgMul - (1 + SKILL_RATES.kineticDmgPct * 3)) < 1e-9);
  assert.ok(Math.abs(fx.aimAssistBonusDeg - SKILL_RATES.aimAssistDeg * 3) < 1e-9);
  assert.ok(Math.abs(fx.rocketDmgMul - (1 + SKILL_RATES.rocketDmgPct * 2)) < 1e-9);
  assert.ok(Math.abs(fx.rocketSpeedMul - (1 + SKILL_RATES.rocketSpeedPct * 2)) < 1e-9);
  assert.ok(Math.abs(fx.shieldMul - (1 + SKILL_RATES.shieldPct * 4)) < 1e-9);
  assert.equal(fx.dodge, SKILL_RATES.dodgePctPerPt * 5);
  assert.ok(Math.abs(fx.mobilityMul - (1 + SKILL_RATES.mobilityPct * 1)) < 1e-9);
});

test('skillEffects: negative/garbage points clamp to 0 (no negative multipliers)', () => {
  const fx = skillEffects({ kinetic: -5, rocket: NaN, shields: -1, maneuver: -2, mobility: -9 });
  assert.equal(fx.kineticDmgMul, 1); assert.equal(fx.rocketDmgMul, 1);
  assert.equal(fx.shieldMul, 1); assert.equal(fx.dodge, 0); assert.equal(fx.mobilityMul, 1);
});
