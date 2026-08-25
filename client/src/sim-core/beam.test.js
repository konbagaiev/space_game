// The charged beam's rules, without a catalog and without a browser.
//
// What these tests exist to protect, in order of how expensive the mistake would be:
//   1. PAINT ≡ CORRIDOR ≡ HIT. One hull-aware predicate decides the reticle, the lock and the shot. A ±2°
//      corridor is NARROWER THAN A SHIP at most ranges, so a centre-based test would paint targets it
//      cannot hit — the three drawn lines would lie, which is the one thing they promise not to do.
//   2. THE SIMULATION IS SIDE-AGNOSTIC. No ship in the shipped catalog carries a beam (it is a player
//      purchase), so the hostile path has no in-game exerciser at all. Test 7 drives it directly. Without
//      it, someone could make the whole weapon player-only and every other test here would stay green —
//      and arming a pirate later would stop being a catalog edit.
//   3. THE NUMBERS LIVE IN THE WEAPON ROW. Two ships must be able to carry differently-tuned beams; the
//      throwaway spike kept them in one shared module object, and test 8 is the regression guard for that.
//   4. ZERO RNG DRAWS on the player/ally path (DECISIONS §73).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from './vec.js';
import { createWorld } from './world.js';
import { shortestAngleDelta } from './steering.js';
import { seedSim, simRandomDraws } from './sim-random.js';
import { simTick } from './tick.js';
import {
  isBeamGroup, beamGroupOf, beamWeaponOf, beamMuzzle, corridorEnds, inCorridor, beamCandidate,
  updateBeamGroup, corridorRadOf, chargeTimeOf,
} from './beam.js';

const DT = 1 / 60;
const DEG = Math.PI / 180;

// The shipped Charged beam (catalog id 12). Copied rather than imported: sim-core tests stay catalog-free,
// and a test that silently followed a retune would stop being a guard. `chargeTime` is 1.0 s (raised from
// 0.5 by the maintainer on 2026-08-25 so the charge is clearly heard and seen) and the cycle is therefore
// chargeTime + fireCooldown = 1.5 s. At 60 Hz a charge takes ~61 ticks, not 30 — every loop below is sized
// against that, and the geometry every "does it still hit?" case rests on was re-derived at 1.0 s.
const BEAM = { type: 'beam', power: 80, maxRange: 100, chargeTime: 1.0, corridorDeg: 2, fireCooldown: 0.5, weight: 12, class: 'beam' };
const CHARGE_TICKS = Math.ceil(BEAM.chargeTime * 60) + 2;   // a charge, with a tick of slack either side
const CYCLE_TICKS = Math.ceil((BEAM.chargeTime + BEAM.fireCooldown) * 60);

const beamGroup = (weapon = BEAM) => ({
  name: 'gun', key: 'Space', ai: null,
  mounts: [{ group: 'gun', weapon, delay: 0, offset: 0 }],
  reload: weapon.fireCooldown, cooldown: 0, pending: [],
});

// A shooter: only the fields beam.js reads. `noseZ`/`scale` put the muzzle 1.6 u ahead of the hull centre.
function shooter(over = {}) {
  return Object.assign({
    pos: new Vec3(0, 0.6, 0), vel: new Vec3(), heading: 0, alive: true,
    noseZ: 1.6, scale: 1, sizeScale: 1, warping: false, class: 'player',
    groups: { gun: beamGroup() },
  }, over);
}

// A PRIMITIVE target — no hitBoxes, so `broadRadius` is the legacy 2.6 and the hull is that sphere. Every
// geometry number in test 1 is derived against exactly this.
function target(x, z, over = {}) {
  return Object.assign({
    pos: new Vec3(x, 0.6, z), vel: new Vec3(), heading: 0, alive: true, warping: false,
    hp: 400, maxHp: 400, hitBoxes: null, broadR: 0, scale: 1, sizeScale: 1,
    shield: null, _shieldValue: 0, _shieldRechargeAccum: 0, class: 'fighter',
  }, over);
}

const FWD = new Vec3(0, 0, 1); // heading 0 → +Z

function fight({ enemies = [], allies = [], player = null } = {}) {
  const w = createWorld();
  w.player = player;
  w.enemies = enemies;
  w.allies = allies;
  return w;
}

// A target `deg` off the nose at `dist`, measured from the MUZZLE (the wedge's apex).
function offNose(ship, deg, dist) {
  const m = beamMuzzle(ship, FWD);
  const a = ship.heading + deg * DEG;
  return target(m.x + Math.sin(a) * dist, m.z + Math.cos(a) * dist);
}

const HALF = corridorRadOf(BEAM);

// ---------- 1. the hull-aware corridor, both halves ----------

test('a hull that only an EDGE line touches is in the corridor — the centre-based test would miss it', () => {
  const s = shooter();
  // At 45 u the ±2° corridor is 1.57 u wide on each side; a primitive hull is a 2.6 u sphere. A target 4°
  // off the nose sits ~3.14 u laterally: its CENTRE is outside the wedge and more than 2.6 u off the centre
  // line (so the centre line misses it too), but it still overlaps the wedge — the edge line crosses it.
  const t = offNose(s, 4, 45);
  assert.equal(inCorridor(s, FWD, t, BEAM.maxRange, HALF), true, 'the hull overlaps the drawn wedge');

  // State the difference from a centre-based test rather than re-encoding the implementation:
  const m = beamMuzzle(s, FWD);
  const bearing = Math.atan2(t.pos.x - m.x, t.pos.z - m.z);
  assert.ok(Math.abs(shortestAngleDelta(s.heading, bearing)) > HALF,
    'the target CENTRE is outside ±2° — a centre-based corridor would have rejected this hit');
  assert.ok(Math.abs(shortestAngleDelta(s.heading, bearing)) < 5 * DEG, 'and it is 4° off, as built');
});

test('a hull fully clear of the wedge is NOT in the corridor', () => {
  const s = shooter();
  // 10° off at 45 u = 7.9 u lateral, well past the 1.57 + 2.6 = 4.17 u where a hull can still overlap.
  assert.equal(inCorridor(s, FWD, offNose(s, 10, 45), BEAM.maxRange, HALF), false);
});

test('range is measured to the HULL, and a warping or dead ship is never in the corridor', () => {
  const s = shooter();
  // maxRange is 100 (ten past GUN_LONG's 90), and the cut-off is maxRange + the hull's broad radius (2.6).
  assert.equal(inCorridor(s, FWD, offNose(s, 0, 99), BEAM.maxRange, HALF), true, 'just inside the reach');
  assert.equal(inCorridor(s, FWD, offNose(s, 0, 101), BEAM.maxRange, HALF), true,
    'and a hull straddling the tip still counts — range is measured to the HULL, not the centre');
  assert.equal(inCorridor(s, FWD, offNose(s, 0, 110), BEAM.maxRange, HALF), false, 'past maxRange + hull');
  assert.equal(inCorridor(s, FWD, offNose(s, 0, 20, {}), BEAM.maxRange, HALF), true);
  const warping = offNose(s, 0, 20); warping.warping = true;
  assert.equal(inCorridor(s, FWD, warping, BEAM.maxRange, HALF), false, 'a forming ship is untouchable (§54)');
  const dead = offNose(s, 0, 20); dead.alive = false;
  assert.equal(inCorridor(s, FWD, dead, BEAM.maxRange, HALF), false);
  assert.equal(inCorridor(s, FWD, null, BEAM.maxRange, HALF), false);
});

test('the three drawn endpoints ARE the corridor: they leave the MUZZLE and span exactly ±corridorDeg', () => {
  const s = shooter({ heading: 0.7 });
  const f = new Vec3(Math.sin(s.heading), 0, Math.cos(s.heading));
  const c = new Vec3(), l = new Vec3(), r = new Vec3();
  corridorEnds(s, f, BEAM.maxRange, HALF, c, l, r);
  const m = beamMuzzle(s, f);
  for (const [name, e] of [['centre', c], ['left', l], ['right', r]]) {
    assert.ok(Math.abs(Math.hypot(e.x - m.x, e.z - m.z) - BEAM.maxRange) < 1e-9, `${name} runs maxRange from the muzzle`);
  }
  const bear = (e) => Math.atan2(e.x - m.x, e.z - m.z);
  assert.ok(Math.abs(shortestAngleDelta(s.heading, bear(c))) < 1e-9, 'the centre is the nose');
  assert.ok(Math.abs(shortestAngleDelta(s.heading, bear(l)) - HALF) < 1e-9);
  assert.ok(Math.abs(shortestAngleDelta(s.heading, bear(r)) + HALF) < 1e-9);
});

// ---------- 2. escape is real at the settled numbers ----------

test('a top-speed crosser ESCAPES the corridor during the charge (the maintainer\'s "fly across and you miss")', () => {
  const s = shooter();
  // RE-DERIVED AT THE 1.0 s CHARGE. 15.75 u/s (the fastest enemy) now crosses the full 15.75 u, twice what
  // it managed at 0.5 s. Starting dead on the centre line at the weapon's own 100 u reach, that ends
  // atan(15.75 / 100) = 8.95° off the nose. The wedge is 100·tan(2°) = 3.49 u wide there and the hull adds
  // 2.6, so the effective window is 6.09 u — it escapes by better than 2×.
  const t = offNose(s, 0, 100);
  assert.equal(inCorridor(s, FWD, t, BEAM.maxRange, HALF), true, 'painted at charge start');
  t.pos.x += 15.75 * BEAM.chargeTime;
  const m = beamMuzzle(s, FWD);
  const off = Math.abs(shortestAngleDelta(s.heading, Math.atan2(t.pos.x - m.x, t.pos.z - m.z))) / DEG;
  assert.ok(off > 8.5 && off < 9.5, `it ended ~8.95° off the nose (got ${off.toFixed(2)}°)`);
  // It escapes by ANGLE, not by drifting out of reach — assert that, or the test could pass for the wrong
  // reason. Its distance from the muzzle is hypot(100, 15.75) = 101.2 u, still inside maxRange + 2.6.
  const dist = Math.hypot(t.pos.x - m.x, t.pos.z - m.z);
  assert.ok(dist < BEAM.maxRange + 2.6, `still within reach at ${dist.toFixed(1)} u — the corridor is what rejects it`);
  assert.equal(inCorridor(s, FWD, t, BEAM.maxRange, HALF), false, 'and it is gone by release');
});

test('DOUBLING THE CHARGE really did make a slow crosser escape at close range', () => {
  // The concrete case the 0.5 s → 1.0 s change broke, re-derived rather than assumed. At 20 u the wedge is
  // 20·tan(2°) = 0.70 u wide and the hull adds 2.6, so the effective window is ~3.30 u of lateral drift.
  // A modest 5 u/s crosser drifts 2.5 u in 0.5 s — inside it — but 5.0 u in 1.0 s, which is outside.
  // This is why ACTIVE tracking with A/D is now mandatory rather than optional.
  const s = shooter();
  const half = 20 * Math.tan(HALF) + 2.6;
  assert.ok(half > 3.2 && half < 3.4, `the effective window at 20 u is ~3.30 u (got ${half.toFixed(2)})`);

  const stays = offNose(s, 0, 20);
  stays.pos.x += 5 * 0.5;                       // the OLD 0.5 s charge
  assert.equal(inCorridor(s, FWD, stays, BEAM.maxRange, HALF), true, '2.5 u of drift stayed inside');

  const escapes = offNose(s, 0, 20);
  escapes.pos.x += 5 * BEAM.chargeTime;         // the SHIPPED 1.0 s charge
  assert.equal(inCorridor(s, FWD, escapes, BEAM.maxRange, HALF), false, '5.0 u of drift is out');
});

// ---------- 3. paint ≡ corridor ----------

test('beamCandidate paints exactly what the corridor accepts — nearest first, never a ship it rejects', () => {
  const s = shooter();
  const near = offNose(s, 0, 30), far = offNose(s, 0, 60), aside = offNose(s, 10, 40);
  const w = fight({ enemies: [far, aside, near] });
  assert.equal(beamCandidate(w, s, FWD, 'player', BEAM.maxRange, HALF), near, 'the nearest hull in the corridor');

  // Everything painted is in the corridor, and everything in the corridor is paintable.
  for (const t of w.enemies) {
    const painted = beamCandidate(fight({ enemies: [t] }), s, FWD, 'player', BEAM.maxRange, HALF);
    assert.equal(painted === t, inCorridor(s, FWD, t, BEAM.maxRange, HALF),
      'paint and corridor are the same predicate, per target');
  }
  assert.equal(beamCandidate(fight({ enemies: [aside] }), s, FWD, 'player', BEAM.maxRange, HALF), null,
    'a ship the corridor rejects is never painted');
});

// ---------- 4. the trigger is a tap that COMMITS ----------

test('one tick of fire commits the whole charge: it discharges at chargeTime and damages, then locks out', () => {
  const s = shooter();
  const t = offNose(s, 0, 40);
  const w = fight({ enemies: [t] });
  const g = s.groups.gun;

  let ticks = 0;
  const wantsFire = () => ticks === 0;   // ONE tick of trigger, then released for the rest
  const events = [];
  w.events.drain(() => {});

  for (; ticks < 150; ticks++) {         // 2.5 s — a full 1.0 s charge, its discharge, and the lock-out
    updateBeamGroup(w, s, g, FWD, 'player', DT, wantsFire);
    w.events.drain((e) => events.push(e));
    if (ticks === 5) assert.ok(g.charge && g.charge.t > 0, 'the charge spans ticks even with fire released');
  }

  assert.equal(t.hp, t.maxHp - BEAM.power, 'the discharge applied the weapon row\'s power');
  const fired = events.filter((e) => e.type === 'beamFire');
  assert.equal(fired.length, 1, 'exactly one discharge — the lock-out held for the rest of the 1.5 s');
  assert.equal(fired[0].hit, true);
  assert.equal(fired[0].weaponClass, 'beam');
  assert.equal(fired[0].fromPlayer, true);
  assert.ok(fired[0].from instanceof Vec3 && fired[0].to instanceof Vec3, 'both endpoints are real Vec3s');
  const charged = events.filter((e) => e.type === 'beamCharge');
  assert.equal(charged.length, 1);
  assert.equal(charged[0].dur, BEAM.chargeTime, 'the event carries the window the FX must fill');
  assert.equal(charged[0].weaponClass, 'beam',
    'and its class, so the swell is routed by SOUND_MAP rather than a hardcoded name in the adapter');
  assert.equal(t.lastHitBy, 'player', 'attribution: the player gets the credit (§134)');
});

test('the lock-out is fireCooldown long — a held trigger fires once per charge+cooldown cycle', () => {
  const s = shooter();
  const t = offNose(s, 0, 40);
  const w = fight({ enemies: [t] });
  const g = s.groups.gun;
  let shots = 0;
  for (let i = 0; i < 300; i++) {        // 5.0 s held down, against a 1.5 s cycle
    updateBeamGroup(w, s, g, FWD, 'player', DT, () => true);
    w.events.drain((e) => { if (e.type === 'beamFire') shots++; });
  }
  // A 1.5 s cycle (1.0 charge + 0.5 cooldown) → 3 shots in 5 s, ±1 for where the boundary lands. THE
  // WEAPON'S REAL RATE IS 1/1.5 = 0.67/s, which is what the shop must advertise — not `1/fireCooldown`,
  // which would claim 2.0/s. This test is the arithmetic behind that stat line.
  assert.ok(shots >= 3 && shots <= 4, `fired ${shots} times in 5 s — the cycle is charge + cooldown (1.5 s)`);
  assert.ok(shots * BEAM.power / 5 < 60,
    'sustained DPS is DELIBERATELY low (53) — below the starter gun; the beam is bought for the instant, '
    + 'no-lead hit at range 100, not for damage. Do not "fix" this by shortening the cycle.');
});

test('an ally\'s beam credits the ALLY, and its beamFire is not flagged as the player\'s', () => {
  const s = shooter();
  const t = offNose(s, 0, 40);
  const w = fight({ enemies: [t] });
  const seen = [];
  for (let i = 0; i < CHARGE_TICKS; i++) {
    updateBeamGroup(w, s, s.groups.gun, FWD, 'ally', DT, () => true);
    w.events.drain((e) => seen.push(e));
  }
  assert.equal(t.lastHitBy, 'ally', 'who gets paid (combat-ally.md §2.5)');
  assert.equal(seen.find((e) => e.type === 'beamFire').fromPlayer, false, 'the wingman\'s shot is silent');
});

// ---------- 5. a lock that dies or warps mid-charge ----------

test('a lock that dies mid-charge drops to the current corridor candidate', () => {
  const s = shooter();
  const doomed = offNose(s, 0, 30), behindIt = offNose(s, 0, 60);
  const w = fight({ enemies: [doomed, behindIt] });
  const g = s.groups.gun;

  updateBeamGroup(w, s, g, FWD, 'player', DT, () => true);
  assert.equal(g.charge.lock, doomed, 'it locked the nearer ship');
  doomed.alive = false;                            // killed by something else, mid-charge
  for (let i = 0; i < CHARGE_TICKS; i++) updateBeamGroup(w, s, g, FWD, 'player', DT, () => false);
  assert.equal(behindIt.hp, behindIt.maxHp - BEAM.power, 'the committed shot found the next ship in the corridor');
});

test('a charge with NOTHING in the corridor still fires, and damages nothing', () => {
  const s = shooter();
  const w = fight({ enemies: [] });
  const g = s.groups.gun;
  const events = [];
  for (let i = 0; i < CHARGE_TICKS; i++) {
    updateBeamGroup(w, s, g, FWD, 'player', DT, () => i === 0);
    w.events.drain((e) => events.push(e));
  }
  const fired = events.filter((e) => e.type === 'beamFire');
  assert.equal(fired.length, 1, 'the tap committed');
  assert.equal(fired[0].hit, false);
  // The drawn shot runs the full range down the nose into empty space.
  const m = beamMuzzle(s, FWD);
  assert.ok(Math.abs(Math.hypot(fired[0].to.x - m.x, fired[0].to.z - m.z) - BEAM.maxRange) < 1e-9);
});

test('a lock that WARPS OUT mid-charge is dropped (§54: a forming ship is untouchable)', () => {
  const s = shooter();
  const t = offNose(s, 0, 30);
  const w = fight({ enemies: [t] });
  const g = s.groups.gun;
  updateBeamGroup(w, s, g, FWD, 'player', DT, () => true);
  assert.equal(g.charge.lock, t);
  t.warping = true;
  for (let i = 0; i < CHARGE_TICKS; i++) updateBeamGroup(w, s, g, FWD, 'player', DT, () => false);
  assert.equal(t.hp, t.maxHp, 'nothing was hit');
});

// ---------- 6. zero RNG draws ----------

test('a full player charge + discharge consumes ZERO gameplay randomness (DECISIONS §73)', () => {
  seedSim(12345);
  const before = simRandomDraws();
  const s = shooter();
  const t = offNose(s, 0, 40);
  const w = fight({ enemies: [t] });
  for (let i = 0; i < 3 * CYCLE_TICKS; i++) {
    updateBeamGroup(w, s, s.groups.gun, FWD, 'player', DT, () => true);
    w.events.drain(() => {});
  }
  assert.ok(t.hp < t.maxHp, 'it really did fire (a no-op would trivially draw nothing)');
  assert.equal(simRandomDraws(), before, 'not one draw — every recorded trace stays bit-identical');
});

// ---------- 7. no dodge, and THE HOSTILE PATH EXISTS ----------
//
// No enemy in the shipped catalog carries a beam — it is a player purchase (plan §2d) — so this is the only
// exerciser the hostile path has. It is deliberately driven with `side: 'enemy'` straight into
// `updateBeamGroup`: the evidence that arming a pirate later is a catalog edit plus rendering work, not a
// simulation change. A `side === 'player'` shortcut anywhere in beam.js makes THIS test fail.

test('a HOSTILE beam damages the player through the same side-agnostic path — and dodge does not save him', () => {
  const hostile = shooter({ heading: 0, class: 'fighter' });
  const victim = target(0, 40, { class: 'player' });
  victim.dodge = 100;                                   // Maneuver maxed: a bullet would be evaded outright
  const w = fight({ player: victim, enemies: [] });
  const g = hostile.groups.gun;

  const events = [];
  for (let i = 0; i < CHARGE_TICKS; i++) {
    updateBeamGroup(w, hostile, g, FWD, 'enemy', DT, () => true);
    w.events.drain((e) => events.push(e));
  }
  assert.equal(victim.hp, victim.maxHp - BEAM.power, 'the corridor IS the dodge — no roll, no escape (§135)');
  assert.ok(events.some((e) => e.type === 'hit' && e.target === 'player'));
  assert.equal(events.find((e) => e.type === 'beamFire').fromPlayer, false, 'and it is not the player\'s shot');
});

test('a hostile beam is caught on the SHIELD BUBBLE, not the hull inside it (§76)', () => {
  const hostile = shooter({ heading: 0, class: 'fighter' });
  const victim = target(0, 40, { class: 'player', shield: { capacity: 200, rechargeSec: 10 }, _shieldValue: 200 });
  const w = fight({ player: victim });
  const events = [];
  for (let i = 0; i < CHARGE_TICKS; i++) {
    updateBeamGroup(w, hostile, hostile.groups.gun, FWD, 'enemy', DT, () => true);
    w.events.drain((e) => events.push(e));
  }
  assert.equal(victim.hp, victim.maxHp, 'the hull took nothing');
  assert.equal(victim._shieldValue, 200 - BEAM.power, 'the shield absorbed it');
  const shieldHit = events.find((e) => e.type === 'shieldHit');
  assert.ok(shieldHit, 'the player\'s own shield event, not the enemy one');
  const fired = events.find((e) => e.type === 'beamFire');
  assert.equal(fired.absorbed, true);
  // The DRAWN beam stops on the bubble — in front of the ship, never out the far side of it.
  assert.ok(fired.to.z < victim.pos.z, `the bolt ends on the sphere at z=${fired.to.z.toFixed(2)}, before the hull at 40`);
});

test('a hostile beam picks the PLAYER and the ALLIES as its hostiles, in list order', () => {
  const hostile = shooter({ heading: 0 });
  const player = target(0, 60, { class: 'player' });
  const wingman = target(0, 30, { class: 'player' });
  const w = fight({ player, allies: [wingman] });
  assert.equal(beamCandidate(w, hostile, FWD, 'enemy', BEAM.maxRange, HALF), wingman, 'the nearer friendly');
  wingman.alive = false;
  assert.equal(beamCandidate(w, hostile, FWD, 'enemy', BEAM.maxRange, HALF), player);
});

// ---------- 8. every number comes off the WEAPON ROW ----------

test('two ships carrying differently-tuned beams behave differently in the SAME world', () => {
  // The regression guard for the deleted module-level `beamTuning`: with a shared object these two would
  // be forced to agree, and whichever ticked last would win.
  const weak = { ...BEAM, power: 10, maxRange: 30, corridorDeg: 1 };
  const strong = { ...BEAM, power: 150, maxRange: 90, corridorDeg: 20 };

  const shortShip = shooter({ groups: { gun: beamGroup(weak) } });
  const longShip = shooter({ groups: { gun: beamGroup(strong) } });

  // (a) RANGE and (b) CORRIDOR are read per row: a target 10° off at 60 u is out of the weak beam's reach
  //     AND outside its arc, but well inside the strong one's.
  const far = offNose(shortShip, 10, 60);
  assert.equal(inCorridor(shortShip, FWD, far, weak.maxRange, corridorRadOf(weak)), false);
  assert.equal(inCorridor(longShip, FWD, far, strong.maxRange, corridorRadOf(strong)), true);

  // (c) POWER is read per row, in one shared world, on one shared target.
  const t = offNose(shortShip, 0, 20);
  const w = fight({ enemies: [t] });
  for (let i = 0; i < CHARGE_TICKS; i++) {
    updateBeamGroup(w, shortShip, shortShip.groups.gun, FWD, 'player', DT, () => true);
    w.events.drain(() => {});
  }
  const afterWeak = t.maxHp - t.hp;
  for (let i = 0; i < CHARGE_TICKS; i++) {
    updateBeamGroup(w, longShip, longShip.groups.gun, FWD, 'player', DT, () => true);
    w.events.drain(() => {});
  }
  assert.equal(afterWeak, 10, 'the weak beam dealt its own row\'s 10');
  assert.equal(t.maxHp - t.hp, 160, 'and the strong one added its own row\'s 150 — not one shared number');
});

test('chargeTime comes off the row too: a slower beam is still charging when a faster one has fired', () => {
  const slow = { ...BEAM, chargeTime: 3.0 };
  const s = shooter({ groups: { gun: beamGroup(slow) } });
  // 500 u away, so the two corridors cannot overlap — co-located shooters would both paint BOTH targets
  // and the faster one's shot would land on the slower one's mark, which is not what this test is about.
  const fast = shooter({ pos: new Vec3(500, 0.6, 0), groups: { gun: beamGroup(BEAM) } });
  const tSlow = offNose(s, 0, 30), tFast = offNose(fast, 0, 30);
  const w = fight({ enemies: [tSlow, tFast] });
  for (let i = 0; i < CHARGE_TICKS; i++) {  // ~1.03 s — past the shipped 1.0 s, far short of the slow 3.0 s
    updateBeamGroup(w, s, s.groups.gun, FWD, 'player', DT, () => true);
    updateBeamGroup(w, fast, fast.groups.gun, FWD, 'player', DT, () => true);
    w.events.drain(() => {});
  }
  assert.ok(s.groups.gun.charge, 'the slow beam is still building');
  assert.equal(chargeTimeOf(slow), 3.0);
  assert.equal(chargeTimeOf(BEAM), 1.0, 'and the shipped one charges for a full second');
  assert.equal(tSlow.hp, tSlow.maxHp, 'the slow beam has hit nothing yet');
  assert.ok(tFast.hp < tFast.maxHp, 'while the fast one has already fired');
});

// ---------- group plumbing ----------

test('isBeamGroup uses SOME, so a mixed group can never fall through to the bullet path', () => {
  const kinetic = { type: 'bullet', power: 10, projectileSpeed: 40, fireCooldown: 0.18 };
  const mixed = { mounts: [{ weapon: kinetic }, { weapon: BEAM }] };
  assert.equal(isBeamGroup(mixed), true, 'the beam is second — mounts[0] would have missed it');
  assert.equal(isBeamGroup({ mounts: [{ weapon: kinetic }] }), false);
  assert.equal(isBeamGroup({ mounts: [] }), false);
  assert.equal(isBeamGroup({}), false);
  assert.equal(beamWeaponOf(mixed), BEAM, 'and the weapon read back is the BEAM, not the kinetic');
});

test('beamGroupOf finds the ship\'s beam group, or null for every ship that has none', () => {
  const s = shooter();
  assert.equal(beamGroupOf(s), s.groups.gun);
  assert.equal(beamGroupOf({ groups: { gun: { mounts: [{ weapon: { type: 'bullet' } }] } } }), null);
  assert.equal(beamGroupOf(null), null);
  assert.equal(beamGroupOf({}), null);
});

// ---------- a charge must NOT survive a run reset ----------
//
// The one piece of beam state that outlives a fight. `reset()` reuses the SAME player object and the SAME
// `groups` (mainwindow.js: Restart → leaveOverlay → reset(), which never rebuilds the ship), so anything
// left on a group is carry-over — which is exactly why `cooldown` and `pending` were already cleared there.
// A charge is worse than a stale cooldown, because dying mid-charge FREEZES it: `tick.js` only steps the
// player while alive, so `g.charge.t` stops advancing and the charge is still sitting there at reset.
//
// Left uncleared, the next run would discharge BY ITSELF `chargeTime − t` seconds in: a bolt and a bang the
// player never triggered, with no charge FX in front of it (`hideBeamFx()` already ran), `g.cooldown` eaten
// so the first real shot is late — and `charge.lock` still pointing at an enemy entity from the PREVIOUS
// run, so the corridor can accept a ghost and 80 damage lands on a corpse at a stale position that the beam
// is then drawn to. Driven against the REAL catalog and the REAL reset path, not a stand-in.
test('a charge does not survive a run reset — the next run does not fire a shot nobody triggered', async () => {
  const { createSimWorld } = await import('../../../server/src/sim-host.js');
  const world = createSimWorld({
    levelName: 'level-0', seed: 5,
    // Arm the player with the real catalog beam (id 12) in the gun slot — what `?beam` and a purchase both do.
    ship: { loadout: { mounts: [{ group: 'gun', weapon: 12, offset: 0, delay: 0 }] } },
  });
  const g = beamGroupOf(world.player);
  assert.ok(g, 'the player is carrying the catalog beam');
  const w = beamWeaponOf(g);
  assert.equal(w.chargeTime, 1.0, 'against the shipped charge time');

  // Mid-charge, locked onto a ship that is about to stop existing — then die, which FREEZES the charge.
  const doomed = world.enemies[0] || { alive: true, warping: false, pos: new Vec3(0, 0.6, 30), hp: 10, maxHp: 10 };
  g.charge = { t: 0.6, lock: doomed };
  g.cooldown = 0.4;
  world.player.hp = 0;
  world.player.alive = false;

  const { clearAndPlaceRun, startRun } = await import('./reset-world.js');
  clearAndPlaceRun(world);
  startRun(world);

  assert.equal(g.charge, null, 'the charge is gone with the run that started it');
  assert.equal(g.cooldown, 0, 'and so is the lock-out, like every other fire group');

  // The real proof: step the fresh run past where the stale charge would have completed (0.4 s) without
  // ever pulling the trigger, and assert nothing fired.
  world.events.drain(() => {});
  const seen = [];
  for (let i = 0; i < 2 * CHARGE_TICKS; i++) {
    simTick(world, DT);
    world.events.drain((e) => seen.push(e));
  }
  assert.equal(seen.filter((e) => e.type === 'beamFire').length, 0,
    'no discharge the player never triggered');
  assert.equal(seen.filter((e) => e.type === 'beamCharge').length, 0, 'and no charge either');
});

test('allies and enemies cannot carry a charge across a reset at all — their entities do not survive it', async () => {
  // The other half of the question, recorded so nobody adds a second clearing loop for them. Only the
  // PLAYER's object is reused across a run: `clearAndPlaceRun` empties `world.allies` and `world.enemies`
  // outright, and the next run rebuilds them through `buildGroups`, which mints fresh groups with no
  // `charge` field. So the player's loop is the whole fix.
  const { createSimWorld } = await import('../../../server/src/sim-host.js');
  const { clearAndPlaceRun, startRun } = await import('./reset-world.js');
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  const before = world.allies[0];
  assert.ok(before, 'a wingman is on the field');
  before.groups.gun.charge = { t: 0.9, lock: null };   // whatever he was doing dies with him

  clearAndPlaceRun(world);
  startRun(world);

  assert.ok(!world.allies.includes(before), 'the old ally entity is gone, charge and all');
  for (const a of world.allies) {
    for (const g of Object.values(a.groups)) {
      assert.ok(!g.charge, 'a rebuilt ally starts with no charge');
      assert.equal(g.cooldown, 0);
    }
  }
});

test('the muzzle is the nose — the same derivation fireMount uses, scaled with the hull', () => {
  const s = shooter({ heading: Math.PI / 2, scale: 2 });
  const f = new Vec3(Math.sin(s.heading), 0, Math.cos(s.heading));
  const m = beamMuzzle(s, f);
  assert.ok(Math.abs(m.x - 3.2) < 1e-9, 'noseZ 1.6 × scale 2, along +X at heading π/2');
  assert.ok(Math.abs(m.z) < 1e-9);
});
