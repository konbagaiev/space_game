// The charged beam's rules, without a catalog and without a browser.
//
// What these tests exist to protect, in order of how expensive the mistake would be:
//   1. PAINT ≡ CORRIDOR ≡ HIT. One hull-aware predicate decides the reticle, the lock and the shot. A ±2°
//      corridor is NARROWER THAN A SHIP at most ranges, so a centre-based test would paint targets it
//      cannot hit — the three drawn lines would lie, which is the one thing they promise not to do.
//   2. THE SIMULATION IS SIDE-AGNOSTIC. Test 7 drives the hostile path directly, with `side: 'enemy'` and
//      no catalog at all. Without it, someone could make the whole weapon player-only and every other test
//      here would stay green — and arming a pirate would stop being a catalog edit. (There IS a beam-armed
//      enemy in the catalog now, the pirate lancer; test 9 pins its real row against the player's.)
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
  updateBeamGroup, corridorRadOf, chargeTimeOf, hullEntryToward,
} from './beam.js';
import { broadRadius, pointHitsShip } from './collision.js';

const DT = 1 / 60;
const DEG = Math.PI / 180;

// The shipped Charged beam (catalog id 12). Copied rather than imported: sim-core tests stay catalog-free,
// and a test that silently followed a retune would stop being a guard. `chargeTime` is 1.0 s (raised from
// 0.5 by the maintainer on 2026-08-25 so the charge is clearly heard and seen) and the cycle is therefore
// chargeTime + fireCooldown = 1.5 s. At 60 Hz a charge takes ~61 ticks, not 30 — every loop below is sized
// against that, and the geometry every "does it still hit?" case rests on was re-derived at 1.0 s.
const BEAM = { type: 'beam', power: 80, maxRange: 100, chargeTime: 1.0, corridorDeg: 2, fireCooldown: 0.5, weight: 12, class: 'beam', projectileColor: 0x3d8bff };
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

// ---------- 7. no dodge, and THE HOSTILE PATH IS THE SAME PATH ----------
//
// Driven with `side: 'enemy'` straight into `updateBeamGroup`, catalog-free: the evidence that arming a
// pirate is a catalog edit plus rendering work, not a simulation change. A `side === 'player'` shortcut
// anywhere in beam.js makes THIS test fail.

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

test('a hostile beamCharge names the SHOOTER, so a client can draw a corridor it never ticked', () => {
  // The wire's one entity reference (EVENT_ENTITY_REFS, sim-core/events.js). In a netsim room a remote
  // shooter's fire group is never ticked — the ghost keeps its `groups`, but nothing advances `g.charge` —
  // so without a name for the hull there is nothing to hang the corridor on. Side-agnostic: it is the same
  // field on the player's own charge, and the RENDERER decides whose sight it becomes.
  const hostile = shooter({ heading: 0, class: 'fighter' });
  const victim = target(0, 40, { class: 'player' });
  const w = fight({ player: victim, enemies: [] });
  const events = [];
  for (let i = 0; i < 5; i++) {
    updateBeamGroup(w, hostile, hostile.groups.gun, FWD, 'enemy', DT, () => true);
    w.events.drain((e) => events.push(e));
  }
  const charge = events.find((e) => e.type === 'beamCharge');
  assert.ok(charge, 'the hostile charge is announced at all');
  assert.equal(charge.ship, hostile, 'and it carries the SHOOTER entity, not a copied position');
  assert.equal(charge.fromPlayer, false);
  assert.ok(charge.pos instanceof Vec3, 'the muzzle position still rides along, cloned as ever');

  // The player's own charge carries the same field — no `side` branch in the emit.
  const p = shooter({ heading: 0, class: 'player' });
  const w2 = fight({ player: p, enemies: [target(0, 40)] });
  const own = [];
  for (let i = 0; i < 5; i++) {
    updateBeamGroup(w2, p, p.groups.gun, FWD, 'player', DT, () => true);
    w2.events.drain((e) => own.push(e));
  }
  const mine = own.find((e) => e.type === 'beamCharge');
  assert.equal(mine.ship, p, 'the player\'s charge names him too — the emit is side-agnostic');
  assert.equal(mine.fromPlayer, true);
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

// THE IMPACT FLASH. The beam used to draw its own bloom in `beam-fx.js` — the one weapon in the game whose
// hit looked like nothing else's. It now emits `bulletImpact` exactly as a bullet does and the shared
// hit-sprite path draws it (maintainer, 2026-08-26: "take the kinetic one for now"). These are the tests
// that replace the scenario's old `beamFlash` assertion, which could only ever check that an object existed.
test('a hit emits `bulletImpact`, at the point the beam visibly stops', () => {
  const s = shooter();
  const t = offNose(s, 0, 30);
  const w = fight({ enemies: [t] });
  const events = [];
  for (let i = 0; i < CHARGE_TICKS; i++) {
    updateBeamGroup(w, s, s.groups.gun, FWD, 'player', DT, () => i === 0);
    w.events.drain((e) => events.push(e));
  }
  const impact = events.filter((e) => e.type === 'bulletImpact');
  assert.equal(impact.length, 1, 'one flash per discharge, like one flash per bullet');
  assert.equal(impact[0].weaponClass, BEAM.class, 'carrying the ROW\'s class, so a future beam class picks its own scale');
  assert.equal(impact[0].absorbed, false, 'a hull hit, not a shield one');
  // THE FLASH IS ON THE HULL SURFACE, NOT AT ITS CENTRE — and that is the whole point of this assertion.
  // The bolt's endpoint IS the centre (that is what makes it read as striking the ship), but the hit sprite
  // is ~4 u across against a ~4 u hull and its material keeps `depthTest` on, so a flash at the centre is
  // swallowed by the ship's own depth and the player sees NOTHING. That shipped once, on 2026-08-26, and
  // was found by flying rather than by any test — this is the test that would have caught it.
  const fired = events.find((e) => e.type === 'beamFire');
  const m = beamMuzzle(s, FWD);
  const dCentre = Math.hypot(t.pos.x - m.x, t.pos.z - m.z);
  const dFlash = Math.hypot(impact[0].pos.x - m.x, impact[0].pos.z - m.z);
  assert.ok(Math.hypot(fired.to.x - t.pos.x, fired.to.z - t.pos.z) < 1e-9,
    'the BOLT still ends at the hull centre (unchanged look)');
  assert.ok(dFlash < dCentre - 1,
    `the FLASH sits nearer the shooter than the centre — on the surface, not buried in the hull `
    + `(flash at ${dFlash.toFixed(2)} u, centre at ${dCentre.toFixed(2)} u)`);
  // AND IT IS ON THE HULL, not on the bounding sphere. That distinction is invisible on a round little
  // pirate and fatal on a heavy one: the broad radius is half the hull's LENGTH, so a side-on hit on a
  // heavy pirate (extent x ±4.05, radius 7.57) put the flash 3.5 u out in empty space beside the ship.
  assert.ok(pointHitsShip(t, impact[0].pos),
    'the flash sits ON the hull — the same OBB test a bullet collides against, not a sphere approximation');
});

// THE ONE THAT CAUGHT THE REAL DEFECT. Every other impact test here uses a PRIMITIVE target, whose hull IS
// its broad sphere — so a sphere approximation and a hull test agree and neither can be told from the other.
// The bug only existed on a MODELLED, ELONGATED hull hit from the SIDE: the heavy pirate is 8.1 u wide and
// 12.4 u long, so its bounding radius is 7.57 — and a flash placed one radius back from the centre landed
// 3.5 u out in empty space beside the ship. Nose-on it looked fine, which is exactly what the maintainer
// reported: "when I hit a heavy pirate in the side I see no impact animation, only on the nose."
test('a SIDE hit on a modelled heavy pirate flashes ON its hull, not out beside it', async () => {
  const { createSimWorld } = await import('../../../server/src/sim-host.js');
  const { makeEnemyShell } = await import('./ship-entity.js');
  const w = createSimWorld({ levelName: 'level-4', seed: 7 });
  const row = w.catalog.shipByName.get('pirate mini boss');
  assert.ok(row, 'the heavy is in the catalog');

  const heavy = makeEnemyShell(w.catalog, row, new Vec3(0, 0.6, 0), 0);
  heavy.scale = heavy.fullScale; heavy.warping = false; heavy.spawnAge = heavy.spawnDur;
  heavy.pos.set(0, 0.6, 0);
  heavy.heading = 0;                       // its NOSE points +Z, so we come at its FLANK along +X
  assert.ok(heavy.hitBoxes && heavy.hitBoxes.length, 'and it is modelled, not a primitive — the whole point');

  // Shoot it broadside: the shooter sits on -X aiming +X, across the hull's short axis.
  const s = shooter({ heading: Math.PI / 2 });
  s.pos.set(-40, 0.6, 0);
  const fwd = new Vec3(Math.sin(s.heading), 0, Math.cos(s.heading));
  const world = fight({ enemies: [heavy] });
  const events = [];
  for (let i = 0; i < CHARGE_TICKS; i++) {
    updateBeamGroup(world, s, s.groups.gun, fwd, 'player', DT, () => i === 0);
    world.events.drain((e) => events.push(e));
  }
  const impact = events.find((e) => e.type === 'bulletImpact');
  assert.ok(impact, 'the broadside hit landed');

  // The assertion that fails on the sphere version: the flash is inside the real geometry.
  assert.ok(pointHitsShip(heavy, impact.pos),
    `the flash is ON the modelled hull (got x=${impact.pos.x.toFixed(2)}, z=${impact.pos.z.toFixed(2)}; `
    + `the bounding sphere would have put it at x=${(-broadRadius(heavy)).toFixed(2)}, metres off the flank)`);
  // ...and stated the other way round, so the failure message names the cause rather than the symptom.
  assert.ok(Math.abs(impact.pos.x) < broadRadius(heavy) - 1,
    'well inside the bounding radius - a sphere-based placement would sit exactly ON that radius');
});

// THE COLOUR IS THE WEAPON'S, NOT THE SHOOTER'S (maintainer, 2026-08-30). This is the test that keeps the
// renderer from ever going back to a side test: the same row fired by the player, by the wingman and by a
// pirate produces the SAME hue, and two different rows produce two different ones — so handing the pirates'
// beam to the wingman really does make his shot theirs.
test('both beam events carry the WEAPON\'s colour, identical for every side that fires it', () => {
  const RED = { ...BEAM, projectileColor: 0xff6b4a };
  const run = (side, weapon) => {
    const ship = shooter({ groups: { gun: beamGroup(weapon) }, heading: 0, class: 'fighter' });
    const world = side === 'enemy'
      ? fight({ player: target(0, 40, { class: 'player' }) })
      : fight({ enemies: [target(0, 30)] });
    const evs = [];
    for (let i = 0; i < CHARGE_TICKS; i++) {
      updateBeamGroup(world, ship, ship.groups.gun, FWD, side, DT, () => i === 0);
      world.events.drain((e) => evs.push(e));
    }
    return { charge: evs.find((e) => e.type === 'beamCharge'), fire: evs.find((e) => e.type === 'beamFire') };
  };

  // Guard the fixture first: without this the colour assertions below compare undefined to undefined and
  // pass while testing nothing — the fixture briefly HAD no projectileColor and they did exactly that.
  assert.equal(typeof BEAM.projectileColor, 'number', 'the fixture carries a real colour to assert on');
  assert.notEqual(BEAM.projectileColor, RED.projectileColor, 'and the two rows really differ');

  for (const side of ['player', 'ally', 'enemy']) {
    const r = run(side, BEAM);
    assert.equal(r.fire.color, BEAM.projectileColor, `${side} firing the blue row emits the blue`);
    assert.equal(r.charge.color, BEAM.projectileColor, `${side}'s charge dust burns it too`);
  }
  // …and the ROW is what changes it. The wingman firing the pirates' beam fires THEIR colour.
  const allyWithPirateBeam = run('ally', RED);
  assert.equal(allyWithPirateBeam.fire.color, 0xff6b4a,
    'the wingman handed the pirates\' row fires red — it is the same gun');
  assert.notEqual(allyWithPirateBeam.fire.color, run('ally', BEAM).fire.color,
    'two rows, two colours — the hue tracks the weapon and nothing else');
  // The side split stays on the event for the AUDIO rule ("only your own shots are audible"), untouched.
  assert.equal(run('player', BEAM).fire.fromPlayer, true);
  assert.equal(run('enemy', BEAM).fire.fromPlayer, false);
});

test('a MISS emits no `bulletImpact` — nothing was struck', () => {
  const s = shooter();
  const w = fight({ enemies: [] });
  const events = [];
  for (let i = 0; i < CHARGE_TICKS; i++) {
    updateBeamGroup(w, s, s.groups.gun, FWD, 'player', DT, () => i === 0);
    w.events.drain((e) => events.push(e));
  }
  assert.ok(events.some((e) => e.type === 'beamFire'), 'the shot still went out (the tap commits)');
  assert.equal(events.filter((e) => e.type === 'bulletImpact').length, 0);
});

test('an ABSORBED hit says so, so the flash can be tinted for the shield (§75)', () => {
  const hostile = shooter({ heading: 0, class: 'fighter' });
  const victim = target(0, 40, { class: 'player', shield: { capacity: 200, rechargeSec: 10 }, _shieldValue: 200 });
  const w = fight({ player: victim });
  const events = [];
  for (let i = 0; i < CHARGE_TICKS; i++) {
    updateBeamGroup(w, hostile, hostile.groups.gun, FWD, 'enemy', DT, () => true);
    w.events.drain((e) => events.push(e));
  }
  const impact = events.find((e) => e.type === 'bulletImpact');
  assert.ok(impact, 'a shielded hit still flashes');
  assert.equal(impact.absorbed, true, 'and it is marked absorbed — this is what makes the sprite cyan');
  // On the bubble, in front of the hull: the same endpoint the bolt was already asserted to stop at.
  assert.ok(impact.pos.z < victim.pos.z, `the flash is on the sphere at z=${impact.pos.z.toFixed(2)}, not at the hull's 40`);
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

// ---------- 9. TWO REAL CATALOG BEAMS, differently tuned, in the same catalog ----------
//
// Test 8 proves the rule against synthetic rows. This one proves the SHIPPED rows actually differ, which is
// the whole reason the pirate lancer got its own weapon id instead of borrowing the player's: the enemy beam
// is 45 damage over 67 u, the player's is 80 over 100, and nothing shared can make them agree.
test('the pirate lancer carries weapon 13 in its OWN single-mount group, tuned apart from the player\'s 12', async () => {
  const { WEAPONS, SHIPS } = await import('../../../server/src/catalog_seed.js');
  const lancer = SHIPS.find((sh) => sh.name === 'pirate lancer');
  assert.ok(lancer, 'the catalog has a pirate lancer');
  const mounts = lancer.stats.mounts.filter((m) => m.group === 'gun');
  assert.equal(mounts.length, 1,
    'a beam group must hold EXACTLY one mount — isBeamGroup uses `some`, so any other mount in it goes silent');
  assert.equal(mounts[0].weapon, 13);
  assert.deepEqual(Object.keys(lancer.stats.groups), ['gun'], 'and it carries nothing else at all');

  const theirs = WEAPONS.find((w) => w.id === 13).stats;
  const ours = WEAPONS.find((w) => w.id === 12).stats;
  assert.equal(theirs.power, 45); assert.equal(ours.power, 80);
  assert.equal(theirs.maxRange, 67); assert.equal(ours.maxRange, 100);
  assert.equal(theirs.chargeTime, ours.chargeTime, 'the telegraph length is NOT the lever — both are 1.0 s');
  assert.equal(theirs.corridorDeg, ours.corridorDeg);
  // THE COOLDOWN IS THE SECOND LEVER, and it is 4x the player's. Set by the maintainer after flying the
  // first pass (2026-08-25): 1.0 s charge + 2.0 s cooldown = a 3.0 s cycle = 15 sustained DPS, which is
  // BELOW the pirate machine gun's 16.7 — the beam trades rate of fire for a big announced hit.
  assert.equal(theirs.fireCooldown, 2.0);
  assert.equal(ours.fireCooldown, 0.5, 'and the PLAYER\'s row is untouched by that retune');
  assert.equal(theirs.power / (theirs.chargeTime + theirs.fireCooldown), 15, 'sustained DPS is 15');
  assert.equal(theirs.buyable, false, 'enemy gear: never in the shop');
  assert.equal(theirs.minLevel, undefined, 'a hidden row needs no level gate');
});

// THE TURN RATE IS A BALANCE NUMBER, so it gets an assertion — it is DERIVED (thruster power × mass), which
// means it can be changed from three different places by accident: the thruster row, the hull/engine
// weights, or the beam's own weight. This pins the OUTCOME, in the unit the maintainer chose it in.
test('the pirate lancer turns at 50 deg/s, ties the other two slow fighters, and is slower than the player', async () => {
  const { COMPONENTS, WEAPONS, SHIPS } = await import('../../../server/src/catalog_seed.js');
  const { deriveDrive, REFERENCE_MASS } = await import('./components.js');
  const byId = Object.fromEntries(COMPONENTS.map((c) => [c.id, c]));
  const part = (id) => (id ? { weight: byId[id].weight, ...byId[id].stats } : null);
  const build = (sh) => deriveDrive({
    hull: part(sh.components.hull), engine: part(sh.components.engine), thruster: part(sh.components.thruster),
    repair: part(sh.components.repair), grab: part(sh.components.grab), shield: part(sh.components.shield),
    mounts: sh.stats.mounts.map((m) => ({ weapon: { weight: WEAPONS.find((w) => w.id === m.weapon).stats.weight } })),
  });
  const byName = (n) => build(SHIPS.find((sh) => sh.name === n));
  const deg = (r) => r * 180 / Math.PI;

  const lancer = byName('pirate lancer');
  assert.equal(lancer.mass, 31, 'hull 10 + engine 6 + thrusters 3 + the beam\'s own 12');
  assert.ok(Math.abs(deg(lancer.turnRate) - 50) < 0.1,
    `50 deg/s, the maintainer's number after flying it (got ${deg(lancer.turnRate).toFixed(2)})`);
  // ACCELERATION IS DELIBERATELY UNCHANGED: he asked to slow the TURN, not the ship, which is why the
  // thruster rows keep the Scout thrusters' weight 3 and the masses stay put.
  assert.ok(Math.abs(lancer.acceleration - (19 * REFERENCE_MASS / 31)) < 1e-9);
  assert.ok(Math.abs(lancer.acceleration - 30.645) < 0.01, `accel 30.6 (got ${lancer.acceleration.toFixed(3)})`);

  // NO SUPERLATIVE HERE, ON PURPOSE. "The slowest enemy" was false (the heavy capitals are slower), and
  // "the slowest fighter" became a TIE the moment the gunner and the advanced rocket pirate were brought
  // down to 50 as well (2026-08-25). The ladder is the durable fact, so the ladder is what is asserted.
  const slowTier = ['pirate lancer', 'pirate gunner', 'advanced rocket pirate'];
  for (const n of slowTier) {
    assert.ok(Math.abs(deg(byName(n).turnRate) - 50) < 0.1,
      `${n} is in the 50 deg/s tier (got ${deg(byName(n).turnRate).toFixed(2)}) — note a thruster row hits `
      + '50 at ONE mass only, so these three need two different rows (32 at mass 31, 33 at mass 25)');
  }

  // THE SAFETY PROPERTY OF THAT RETUNE, AND THE REASON IT WAS ALLOWED TO SHIP HERE: the INTRO's two ships
  // are excluded and stay fast. Level-0's pool is exactly these two and level-0 carries `introTrace`, which
  // the cutscene AND `36-sim-divergence` re-simulate — slowing either would move the recorded archive
  // (DECISIONS §73). If someone "finishes the job" by putting them on the 50 deg/s rows, this fails first
  // and says why, instead of the gates failing later with a bare hash mismatch.
  assert.ok(deg(byName('Basic pirate ship').turnRate) > 210,
    `the intro's basic pirate stays FAST (${deg(byName('Basic pirate ship').turnRate).toFixed(0)} deg/s) — it is in level-0's pool`);
  assert.ok(deg(byName('basic rocket pirate').turnRate) > 165,
    `and so does the intro's rocket pirate (${deg(byName('basic rocket pirate').turnRate).toFixed(0)} deg/s)`);

  // The capitals are slower still, on MASS alone — which is why "slowest enemy" was never true.
  const mini = byName('pirate mini boss');
  assert.ok(deg(mini.turnRate) < deg(lancer.turnRate),
    `a heavy capital turns SLOWER than the 50 deg/s tier (mini boss ${deg(mini.turnRate).toFixed(0)} deg/s)`);

  const fighters = SHIPS.filter((sh) => sh.type === 'enemy' && sh.stats.class === 'fighter').map(build);
  // `[].every()` is TRUE, so the check below would go green testing nothing if `stats.class` were ever
  // renamed. Pin the population first — the same guard `boundary.test.js` puts in front of its own loop.
  assert.equal(fighters.length, 5,
    `expected the catalog's 5 enemy fighters, found ${fighters.length} — a rename of \`stats.class\` must `
    + 'not silently empty this check');
  assert.ok(fighters.every((f) => deg(f.turnRate) >= 50 - 0.1),
    'and 50 deg/s is the FLOOR of the fighter tier — no fighter turns slower than it');

  // THE POINT OF THE NUMBER: it turns slower than a player's bearing sweep at the AI's 14-22 u standoff
  // (PLAYER_MAX_SPEED 30 / 18 u = 1.67 rad/s = 96 deg/s), so the corridor can be escaped during the charge.
  const player = byName('Basic player ship');
  assert.ok(Math.abs(deg(player.turnRate) - 114.6) < 0.5,
    `the player is untouched at ~115 deg/s (got ${deg(player.turnRate).toFixed(2)})`);
  assert.ok(deg(lancer.turnRate) < deg(player.turnRate), 'the lancer turns slower than the player');
  const sweepDeg = deg(30 / 18);
  assert.ok(deg(lancer.turnRate) < sweepDeg,
    `50 < the player's ~${sweepDeg.toFixed(0)} deg/s bearing sweep, so the beam is genuinely escapable`);
});

test('a lancer built from the REAL catalog reloads in 2.0 s and draws a 67 u corridor, not 100', async () => {
  // Built the way the simulation builds it (`buildGroups` → `reload = max(mount.fireCooldown)`), so the
  // 1.0 + 2.0 = 3.0 s cycle is read off the real row rather than asserted about it.
  const { createSimWorld } = await import('../../../server/src/sim-host.js');
  const { makeEnemyShell } = await import('./ship-entity.js');
  const world = createSimWorld({ levelName: 'level-4', seed: 3 });
  const row = world.catalog.shipByName.get('pirate lancer');
  assert.ok(row, 'the room\'s catalog resolves the lancer by name — this is how a spawn pool names it');
  const e = makeEnemyShell(world.catalog, row, new Vec3(0, 0.6, 0), 0);

  const g = beamGroupOf(e);
  assert.ok(g, 'its gun group takes the BEAM path');
  assert.equal(g.mounts.length, 1);
  assert.equal(g.reload, 2.0, 'the post-discharge lock-out, off the mount\'s own fireCooldown');
  assert.equal(g.ai.range, 50, 'the BEAM preset gates the START of a charge at 50 u — not the fighting distance');
  assert.equal(g.ai.aimTol, 0.12);

  const w = beamWeaponOf(g);
  assert.equal(w.maxRange, 67);
  assert.equal(chargeTimeOf(w), 1.0);

  // THE DRAWN CORRIDOR IS THIS WEAPON'S REACH. The sight is drawn from exactly these endpoints, so a
  // corridor built off the player's 100 would be a telegraph that promised a shot 33 u longer than the one
  // it can take.
  const fwd = new Vec3(0, 0, 1);
  const muzzle = new Vec3(), endC = new Vec3(), endL = new Vec3(), endR = new Vec3();
  beamMuzzle(e, fwd, muzzle);
  corridorEnds(e, fwd, w.maxRange, corridorRadOf(w), endC, endL, endR);
  const len = Math.hypot(endC.x - muzzle.x, endC.z - muzzle.z);
  assert.ok(Math.abs(len - 67) < 1e-6, `the centre line spans the row's 67 u (got ${len.toFixed(3)})`);
  assert.notEqual(Math.round(len), 100, 'and emphatically not the player row\'s 100');
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
