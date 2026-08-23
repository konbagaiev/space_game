// The wingman's rules, without a catalog and without a browser.
//
// The helpers take plain objects on purpose, so the interesting cases — "is he still braking?", "is he
// closing on a MOVING player?" — are arithmetic rather than a whole fight. The one thing these tests exist
// to protect above all is that HE FLIES THE PLAYER'S MOVEMENT MODEL, not the enemy's: an earlier draft gave
// him the enemy `DRAG` and a terminal speed of ≈4.8 u/s, which would have made the feature useless (he
// could not have caught anything, escorted anything or escaped anything).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from './vec.js';
import { createWorld } from './world.js';
import {
  stepAlly, nearestEnemyTo, aimedEnemy, holdFireForPlayer, shouldRetreat, shouldRejoin, approachThrust,
} from './step-ally.js';
import { nearestHostileTarget } from './targeting.js';
import { shortestAngleDelta } from './steering.js';
import { PLAYER_MAX_SPEED } from './step-player.js';
import {
  ALLY_SNAP_ANGLE, ALLY_TURN_EXIT_ANGLE, ALLY_MIN_HP, ALLY_RETREAT_HP_FRAC, ALLY_REJOIN_HP_FRAC,
  ALLY_ESCORT_DIST,
} from './ally-config.js';
import { seedSim, simRandomDraws } from './sim-random.js';

const DT = 1 / 60;

// A stand-in ally with the real derived numbers (mass 86 → accel 8.7, turn 1.16) but no catalog behind it.
function ally(over = {}) {
  const a = {
    pos: new Vec3(0, 0.6, 0), vel: new Vec3(), heading: 0,
    acceleration: 8.7, turnRate: 1.16, maxSpeedMul: 1,
    hp: 200, maxHp: 200, alive: true,
    shield: { capacity: 20, rechargeSec: 10 }, _shieldValue: 20, _shieldRechargeAccum: 0,
    repair: null, _repairAccum: 0,
    scale: 1, fullScale: 1, spawnAge: 1, spawnDur: 1, warping: false,
    noseZ: 1.1, sizeScale: 1, class: 'player',
    groups: {}, mounts: [],
    target: null, passArmed: false, retreating: false, thrusting: false, isAlly: true,
  };
  return Object.assign(a, over);
}

function enemy(x, z, over = {}) {
  return Object.assign({ pos: new Vec3(x, 0.6, z), vel: new Vec3(), warping: false, alive: true, hp: 30, maxHp: 30 }, over);
}

// A World with the ally in it and nothing that needs a catalog. `stepAlly` reads only these fields.
function fight({ allies = [], enemies = [], player = null } = {}) {
  const w = createWorld();
  w.player = player || { pos: new Vec3(0, 0.6, 0), vel: new Vec3(), heading: 0, alive: true, class: 'player' };
  w.enemies = enemies;
  w.allies = allies;
  return w;
}

// ---------- target selection ----------

test('nearestEnemyTo picks by distance to the ALLY, not to the player', () => {
  const player = { pos: new Vec3(100, 0.6, 0) };
  const near = enemy(10, 0), far = enemy(90, 0);
  assert.equal(nearestEnemyTo(new Vec3(0, 0.6, 0), [far, near], player), near);
});

test('nearestEnemyTo skips a WARPING enemy (untouchable while forming, §54)', () => {
  const player = { pos: new Vec3(0, 0.6, 0) };
  const forming = enemy(5, 0, { warping: true }), formed = enemy(40, 0);
  assert.equal(nearestEnemyTo(new Vec3(0, 0.6, 0), [forming, formed], player), formed);
});

test('a finite ALLY_TARGET_LEASH only admits enemies near the PLAYER; Infinity ignores it', () => {
  const player = { pos: new Vec3(0, 0.6, 0) };
  const nearAlly = enemy(60, 0);   // 10 u from the ally, 60 u from the player
  const nearPlayer = enemy(5, 0);  // 65 u from the ally, 5 u from the player
  const from = new Vec3(70, 0.6, 0);
  assert.equal(nearestEnemyTo(from, [nearAlly, nearPlayer], player, Infinity), nearAlly);
  assert.equal(nearestEnemyTo(from, [nearAlly, nearPlayer], player, 20), nearPlayer);
});

test('aimedEnemy returns the best-aimed enemy inside the snap cone, and null outside it', () => {
  const dead = enemy(0, 30);                                   // straight ahead at heading 0
  const off = enemy(30 * Math.sin(0.9), 30 * Math.cos(0.9));   // 0.9 rad off the nose
  const pos = new Vec3(0, 0.6, 0);
  assert.equal(aimedEnemy(pos, 0, [off, dead], ALLY_SNAP_ANGLE), dead);
  assert.equal(aimedEnemy(pos, 0, [off], ALLY_SNAP_ANGLE), null);
});

// ---------- fire discipline ----------

test('holdFireForPlayer: only when the player is in the cone AND nearer than the target', () => {
  const fwd = { x: 0, z: 1 };
  // player dead ahead at 10 u, target at 40 u → blocked
  assert.equal(holdFireForPlayer(fwd, { x: 0, z: 10 }, 10, 40), true);
  // player dead ahead but BEYOND the target → not in the way
  assert.equal(holdFireForPlayer(fwd, { x: 0, z: 50 }, 50, 40), false);
  // player nearer but off to the side, outside the cone → the shot misses him
  assert.equal(holdFireForPlayer(fwd, { x: 10, z: 2 }, 10.2, 40), false);
  // player BEHIND him → never blocked
  assert.equal(holdFireForPlayer(fwd, { x: 0, z: -10 }, 10, 40), false);
});

// ---------- retreat / rejoin thresholds ----------

test('shouldRetreat needs BOTH ≤20% hull and a broken shield', () => {
  const low = ALLY_RETREAT_HP_FRAC * 200 - 1;
  assert.equal(shouldRetreat(ally({ hp: low, _shieldValue: 0 })), true);
  assert.equal(shouldRetreat(ally({ hp: low, _shieldValue: 20 })), false); // shield up → stays in
  assert.equal(shouldRetreat(ally({ hp: 120, _shieldValue: 0 })), false);  // healthy → stays in
});

test('shouldRejoin needs BOTH ≥40% hull and a FULL shield', () => {
  const ok = ALLY_REJOIN_HP_FRAC * 200 + 1;
  assert.equal(shouldRejoin(ally({ hp: ok, _shieldValue: 20 })), true);
  assert.equal(shouldRejoin(ally({ hp: ok, _shieldValue: 12 })), false);  // partial shield → keeps healing
  assert.equal(shouldRejoin(ally({ hp: 40, _shieldValue: 20 })), false);  // still too hurt
});

// ---------- the pass ----------

test('the pass: he closes on an enemy dead ahead, and arms the re-search once it is behind him', () => {
  const a = ally();
  const e = enemy(0, 60);
  const w = fight({ allies: [a], enemies: [e] });
  for (let i = 0; i < 30; i++) stepAlly(w, DT);
  assert.equal(a.target, e);
  assert.equal(a.passArmed, false);
  assert.ok(a.vel.length() > 0, 'he is accelerating at it');
  assert.ok(a.pos.z > 0, 'and moving toward it');

  // Put the enemy behind him: the pass is over.
  e.pos.set(0, 0.6, a.pos.z - 40);
  stepAlly(w, DT);
  assert.equal(a.passArmed, true, 'the target is >120° behind → the re-search (and the retreat check) arm');
});

test('once armed, a NEARER second enemy takes the target', () => {
  const a = ally();
  const far = enemy(0, -80);            // behind him → arms the pass
  const near = enemy(3, -6);
  const w = fight({ allies: [a], enemies: [far] });
  stepAlly(w, DT);
  assert.equal(a.target, far);
  stepAlly(w, DT);
  assert.equal(a.passArmed, true);
  w.enemies.push(near);
  stepAlly(w, DT);
  assert.equal(a.target, near, 'the nearer one after the pass');
});

// ---------- THE MOVEMENT MODEL IS THE PLAYER'S ----------

test('he accelerates PAST the enemy terminal speed and settles at PLAYER_MAX_SPEED, never above', () => {
  const a = ally();
  const e = enemy(0, 100000);           // far ahead: he charges in a straight line for the whole test
  const w = fight({ allies: [a], enemies: [e] });
  let peak = 0;
  for (let i = 0; i < 60 * 5; i++) {    // 5 s of sim time
    stepAlly(w, DT);
    peak = Math.max(peak, a.vel.length());
  }
  assert.ok(peak > 4.8, `speed must climb past the enemy drag-limited 4.8 u/s (got ${peak})`);
  const cap = PLAYER_MAX_SPEED;         // no skills → maxSpeedMul 1
  assert.ok(a.vel.length() > cap - 1e-6, `he tops out AT the player's flat cap (got ${a.vel.length()})`);
  assert.ok(peak <= cap + 1e-9, 'and never exceeds it');
});

test('slowing down is LINEAR at his own acceleration, not an exponential drag', () => {
  // Come-about: target behind, passArmed → thrust 0 → brakeVel every tick.
  const a = ally({ vel: new Vec3(0, 0, 25), heading: 0, turnRate: 0 }); // turnRate 0: isolate the speed
  const e = enemy(0, -100);
  const w = fight({ allies: [a], enemies: [e] });
  stepAlly(w, DT);                       // arms the pass
  assert.equal(a.passArmed, true);
  const v0 = a.vel.length();
  stepAlly(w, DT);
  const v1 = a.vel.length();
  stepAlly(w, DT);
  const v2 = a.vel.length();
  const d1 = v0 - v1, d2 = v1 - v2;
  assert.ok(Math.abs(d1 - a.acceleration * DT) < 1e-9, `decel per tick = accel*dt (got ${d1})`);
  assert.ok(Math.abs(d2 - d1) < 1e-9, 'and it is CONSTANT — an exponential drag would shrink it');
});

test('the come-about BRAKES AND TURNS TOGETHER, then re-accelerates the moment the nose arrives', () => {
  const a = ally({ vel: new Vec3(0, 0, 25), heading: 0 });
  const e = enemy(0, -100);              // dead astern
  const w = fight({ allies: [a], enemies: [e] });
  stepAlly(w, DT);
  assert.equal(a.passArmed, true);

  const vBefore = a.vel.length(), hBefore = a.heading;
  stepAlly(w, DT);
  assert.ok(Math.abs((vBefore - a.vel.length()) - a.acceleration * DT) < 1e-9, 'it brakes…');
  assert.ok(Math.abs(Math.abs(a.heading - hBefore) - a.turnRate * DT) < 1e-9, '…while turning at turnRate');
  assert.equal(a.thrusting, false, 'the engine is out through the come-about');

  // Run the turn to completion, then check he charges again.
  for (let i = 0; i < 60 * 6 && a.passArmed; i++) stepAlly(w, DT);
  assert.equal(a.passArmed, false, 'the come-about ends when the nose reaches the target');
  const gap = Math.abs(shortestAngleDelta(a.heading, Math.atan2(e.pos.x - a.pos.x, e.pos.z - a.pos.z)));
  assert.ok(gap <= ALLY_TURN_EXIT_ANGLE + 1e-6, 'and it ends INSIDE the exit angle — already able to fire');
  // The very next tick lights the engine again. NOT `|vel|` — he comes out of the reversal still carrying
  // a few u/s of OLD-direction drift (braking outlasts the turn), so thrusting along the new nose bleeds
  // that off first and the SPEED briefly falls. What must grow is the component ALONG the nose.
  const alongNose = () => a.vel.x * Math.sin(a.heading) + a.vel.z * Math.cos(a.heading);
  const fwdExit = alongNose();
  stepAlly(w, DT);
  assert.equal(a.thrusting, true, 'the engine is lit again');
  assert.ok(alongNose() > fwdExit + a.acceleration * DT * 0.5,
    `he accelerates along the new heading (${fwdExit.toFixed(3)} → ${alongNose().toFixed(3)})`);
});

test('a SNAP switch ends the come-about at once; a merely NEARER one does not', () => {
  // Snap: the new target is already inside the aim cone → charge it immediately.
  {
    const a = ally({ vel: new Vec3(0, 0, 25), heading: 0 });
    const behind = enemy(0, -100);
    const w = fight({ allies: [a], enemies: [behind] });
    stepAlly(w, DT);
    assert.equal(a.passArmed, true);
    const snap = enemy(0, a.pos.z + 30);            // dead ahead of the nose
    w.enemies.push(snap);
    stepAlly(w, DT);
    assert.equal(a.target, snap);
    assert.equal(a.passArmed, false, 'a target already inside the aim cone: accelerate at it now');
  }
  // Nearer-but-off-axis: he keeps braking until the nose comes round.
  {
    const a = ally({ vel: new Vec3(0, 0, 25), heading: 0 });
    const behind = enemy(0, -100);
    const w = fight({ allies: [a], enemies: [behind] });
    stepAlly(w, DT);
    assert.equal(a.passArmed, true);
    const nearer = enemy(20, a.pos.z - 20);          // nearer, but well off the nose
    w.enemies.push(nearer);
    stepAlly(w, DT);
    assert.equal(a.target, nearer);
    assert.equal(a.passArmed, true, 'a merely NEARER target does not end the come-about');
    assert.equal(a.thrusting, false);
  }
});

// ---------- ESCORT ON A MOVING PLAYER (the closing-speed rule) ----------

test('escort, FORMATION: matched velocities → he THRUSTS, he does not brake', () => {
  // 40 u behind a player flying at the cap, at the same speed. Judged on GROUND speed the rule reads
  // "remaining 30 u against a 51.7 u stopping distance" and brakes — which is the bug this locks out.
  const player = { pos: new Vec3(0, 0.6, 40), vel: new Vec3(0, 0, PLAYER_MAX_SPEED), heading: 0, alive: true };
  const a = ally({ vel: new Vec3(0, 0, PLAYER_MAX_SPEED), heading: 0 });
  const w = fight({ allies: [a], enemies: [], player });
  const before = a.vel.length();
  stepAlly(w, DT);
  assert.equal(a.thrusting, true, 'flying in formation, the gap is not shrinking → full thrust');
  assert.ok(a.vel.length() >= before - 1e-9, 'and his speed does not drop');
});

test('escort, CONVERGENCE: he closes on a player flying at 0.8× the cap', () => {
  const pv = 0.8 * PLAYER_MAX_SPEED;
  const player = { pos: new Vec3(0, 0.6, 60), vel: new Vec3(0, 0, pv), heading: 0, alive: true };
  const a = ally({ vel: new Vec3(0, 0, PLAYER_MAX_SPEED), heading: 0 });
  const w = fight({ allies: [a], enemies: [], player });
  for (let i = 0; i < 60 * 10; i++) {          // 10 s of sim time
    stepAlly(w, DT);
    player.pos.addScaledVector(player.vel, DT); // stepAlly does not move the player
  }
  const gap = Math.hypot(player.pos.x - a.pos.x, player.pos.z - a.pos.z);
  // Ground speed would park him at ALLY_ESCORT_DIST + 24²/(2·8.7) ≈ 43 u and never cross 20.
  assert.ok(gap < 20, `the gap converges toward ALLY_ESCORT_DIST (got ${gap.toFixed(1)} u)`);
  assert.ok(gap > ALLY_ESCORT_DIST - 5, 'and he does not fly through him');
});

test('approachThrust clamps an OPENING (negative) closing speed to zero — full thrust is all he can do', () => {
  assert.equal(approachThrust(-30, 5, 8.7), 1);
  assert.equal(approachThrust(0, 5, 8.7), 1);
  assert.equal(approachThrust(30, 5, 8.7), 0);   // 51.7 u of allowance against 5 u remaining
});

// ---------- the retreat ----------

test('the retreat is NEVER taken mid-charge: it flips only on the tick the pass arms', () => {
  const a = ally({ hp: 20, _shieldValue: 0 });   // 10% hull, shield down — every reason to run
  const e = enemy(0, 60);                        // …but dead ahead: he is mid-charge
  const w = fight({ allies: [a], enemies: [e] });
  for (let i = 0; i < 60; i++) stepAlly(w, DT);
  assert.equal(a.retreating, false, 'low health never interrupts a charge (§2d)');
  e.pos.set(0, 0.6, a.pos.z - 40);               // now it is behind him: the pass is over
  stepAlly(w, DT);
  assert.equal(a.retreating, true);
  assert.equal(a.target, null, 'and he drops the target on the way out');
});

test('HE CANNOT DIE: 10^6 damage still leaves him at ALLY_MIN_HP and in world.allies', () => {
  const a = ally();
  const w = fight({ allies: [a], enemies: [] });
  a.hp -= 1e6;
  stepAlly(w, DT);
  assert.equal(a.hp, ALLY_MIN_HP);
  assert.equal(w.allies.length, 1);
  assert.equal(w.allies[0], a);
});

test('targeting: nearestHostileTarget still returns a RETREATING ally (veto 2026-08-23)', () => {
  // Lives here because it belongs to the ally's rules, but it exercises sim-core/targeting.js. An earlier
  // draft made a retreating ally invisible to enemy target selection so he could not drag part of the wave
  // off screen; that was VETOED — he must behave as close to a real player as possible, and nothing makes a
  // fleeing human stop being a target. If someone re-adds the exclusion, this test fails and says why.
  const a = ally({ retreating: true, pos: new Vec3(10, 0.6, 0) });
  const w = fight({ allies: [a], enemies: [] });
  w.player.pos.set(100, 0.6, 0);
  assert.equal(nearestHostileTarget(w, new Vec3(0, 0.6, 0)), a);
});

test('nearestHostileTarget is world.player VERBATIM when there is no ally', () => {
  const w = fight({ allies: [], enemies: [] });
  assert.equal(nearestHostileTarget(w, new Vec3(50, 0.6, -20)), w.player);
});

// ---------- the RNG guarantee (DECISIONS §73) ----------

test('ZERO RNG: 600 ticks of a fight WITH an ally draw nothing from the seeded stream', () => {
  const a = ally();
  const enemies = [enemy(0, 60), enemy(-30, 20), enemy(45, -50, { warping: true })];
  const w = fight({ allies: [a], enemies });
  seedSim(12345);
  const before = simRandomDraws();
  for (let i = 0; i < 600; i++) {
    stepAlly(w, DT);
    if (i === 200) enemies[2].warping = false;                 // the third one finishes forming
    if (i === 400) enemies.splice(0, 1);                        // and one dies: he re-picks
  }
  assert.equal(simRandomDraws(), before, 'stepAlly consumes no gameplay randomness at all');
});
