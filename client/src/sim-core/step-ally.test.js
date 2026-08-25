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
  stepAlly, stepAllyDeaths, nearestEnemyTo, aimedEnemy, holdFireForPlayer, shouldRetreat, shouldRejoin,
  approachThrust, aimWithDrift, bulletDir, gunSpeed, isBallistic,
} from './step-ally.js';
import { nearestHostileTarget } from './targeting.js';
import { stepEnemyAI } from './step-enemies.js';
import { shortestAngleDelta } from './steering.js';
import { PLAYER_MAX_SPEED } from './step-player.js';
import {
  ALLY_SNAP_ANGLE, ALLY_TURN_EXIT_ANGLE, ALLY_RETREAT_HP_FRAC, ALLY_REJOIN_HP_FRAC, ALLY_ESCORT_DIST,
  ALLY_BREAK_OFF_DIST,
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

test('shouldRetreat needs BOTH ≤25% hull and a broken shield', () => {
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

test('crossing the threshold BREAKS THE CHARGE, on the very tick it happens (§2d rule retired)', () => {
  // The inverse of what this file used to assert. "Low health never interrupts a charge" was written while
  // the ally could not die; once he became mortal it meant "die mid-charge", because Level 4's boss deals
  // ~35 dmg/s and the threshold is barely a second wide against a ~6 s pass cycle.
  const a = ally({ hp: 0.6 * 200, _shieldValue: 0 });   // healthy: no reason to leave yet
  const e = enemy(0, 60);                               // dead ahead, and he is charging it
  const w = fight({ allies: [a], enemies: [e] });
  for (let i = 0; i < 60; i++) stepAlly(w, DT);
  assert.equal(a.retreating, false, 'above the threshold he presses the attack');
  assert.equal(a.target, e, 'and he is genuinely mid-charge, with the target held');

  a.hp = ALLY_RETREAT_HP_FRAC * a.maxHp - 1;            // a hit lands and takes him under 25%
  stepAlly(w, DT);                                      // …the very next tick
  assert.equal(a.retreating, true, 'he breaks off AT ONCE — no waiting for the pass to arm');
  assert.equal(a.target, null, 'dropping the charge on the way out');
  assert.equal(a.passArmed, false);
});

test('the threshold is 25% of max hull, and the shield clause still holds', () => {
  const justAbove = ally({ hp: 0.25 * 200 + 1, _shieldValue: 0 });
  assert.equal(shouldRetreat(justAbove), false, 'just above 25% he stays in');
  const atIt = ally({ hp: 0.25 * 200, _shieldValue: 0 });
  assert.equal(shouldRetreat(atIt), true, '…and at 25% he goes');
  // Kept because the maintainer specified "≤25% with the shield down". It is nearly free now: damage routes
  // through the shield first (§76), so at the instant hull damage lands the shield is already down.
  const shielded = ally({ hp: 0.10 * 200, _shieldValue: 20 });
  assert.equal(shouldRetreat(shielded), false, 'a shield still up means he is not taking hull damage');
});

test('rejoining at 40% puts him back in, and nothing has to be re-armed', () => {
  const a = ally({ hp: 20, _shieldValue: 0, retreating: true, pos: new Vec3(0, 0.6, 200) });
  const w = fight({ allies: [a], enemies: [enemy(0, 0)] });   // already well clear of the threat
  stepAlly(w, DT);
  assert.equal(a.retreating, true, 'still hurt: still out');
  a.hp = ALLY_REJOIN_HP_FRAC * a.maxHp; a._shieldValue = a.shield.capacity;
  stepAlly(w, DT);
  assert.equal(a.retreating, false, 'back in at ≥40% with the shield full');
  // …and he does not immediately turn round again: the decision is a live read of his hull, not a latch.
  assert.equal(shouldRetreat(a), false);
});

// ---------- THE BREAK-OFF IS MEASURED FROM THE THREAT ----------
// Every case here fails against the centre-relative retreat it replaced. That version aimed him at a fixed
// radius from `world.arenaCenter`, but enemies SPAWN at 70..130 from that same centre, so the 70 u holding
// point sat on the inner edge of their spawn ring — and because he charges enemies out there, his own
// distance from the centre was normally already past it. `70 − d` went negative, `approachThrust` returned 0
// (correctly: he has no reverse) and he stopped dead in the fight, retreating but going nowhere.

// A hurt ally, mid-fight, already out where the enemies are — the exact geometry of the reported bug.
function breakingOff({ centreDist = 100, enemyGap = 20 } = {}) {
  const a = ally({ hp: 20, _shieldValue: 0, pos: new Vec3(centreDist, 0.6, 0), vel: new Vec3() });
  const e = enemy(centreDist - enemyGap, 0);       // between him and the arena centre
  const w = fight({ allies: [a], enemies: [e] });
  w.player.pos.set(0, 0.6, 0);
  a.heading = Math.atan2(e.pos.x - a.pos.x, e.pos.z - a.pos.z); // nose on it: he is charging
  stepAlly(w, DT);                                 // …and under 25% hull, so he leaves on this very tick
  assert.equal(a.retreating, true, 'he broke off');
  return { a, e, w };
}

const gapTo = (a, e) => Math.hypot(a.pos.x - e.pos.x, a.pos.z - e.pos.z);

test('breaking off OPENS THE GAP TO THE ENEMY — the defect the maintainer reported', () => {
  const { a, e, w } = breakingOff({ centreDist: 100, enemyGap: 20 });
  const before = gapTo(a, e);
  for (let i = 0; i < 60 * 4; i++) stepAlly(w, DT);   // 4 s
  const after = gapTo(a, e);
  assert.ok(after > before + 20,
    `he runs from the ENEMY (gap ${before.toFixed(1)} → ${after.toFixed(1)} u)`);
});

test('…and it works when he is ALREADY beyond the old centre-relative 70 u', () => {
  // The old rule's `70 − d` is negative here, so it produced thrust 0 and he held position in the fight.
  const { a, e, w } = breakingOff({ centreDist: 110, enemyGap: 15 });
  const startCentre = Math.hypot(a.pos.x, a.pos.z);
  assert.ok(startCentre > 70, 'he starts outside the retired holding radius');
  const before = gapTo(a, e);
  const startPos = { x: a.pos.x, z: a.pos.z };
  for (let i = 0; i < 60 * 3; i++) stepAlly(w, DT);
  assert.ok(Math.hypot(a.pos.x - startPos.x, a.pos.z - startPos.z) > 10, 'he MOVED, rather than stopping dead');
  assert.ok(gapTo(a, e) > before, 'and the gap grew');
});

test('he settles AT the break-off distance instead of running for ever', () => {
  const { a, e, w } = breakingOff({ centreDist: 100, enemyGap: 20 });
  for (let i = 0; i < 60 * 30; i++) stepAlly(w, DT);   // 30 s: long past arrival
  const gap = gapTo(a, e);
  assert.ok(gap > ALLY_BREAK_OFF_DIST - 15 && gap < ALLY_BREAK_OFF_DIST + 15,
    `he holds around ALLY_BREAK_OFF_DIST (gap ${gap.toFixed(1)} u)`);
  assert.ok(a.vel.length() < 3, `and comes to rest there (speed ${a.vel.length().toFixed(2)} u/s)`);
});

test('he OUTRUNS a pursuer — breaking contact is a race he wins, not a claim in a comment', () => {
  const { a, e, w } = breakingOff({ centreDist: 100, enemyGap: 20 });
  const before = gapTo(a, e);
  // The fastest Level-4 enemy is the pirate gunner at maxSpeed 15.75 (catalog_seed.js). Fly it straight at
  // him at that speed — the ally caps at PLAYER_MAX_SPEED 30, so the race is his once he is pointed away.
  let worst = Infinity;
  for (let i = 0; i < 60 * 10; i++) {
    const dx = a.pos.x - e.pos.x, dz = a.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
    e.vel.set((dx / d) * 15.75, 0, (dz / d) * 15.75);
    e.pos.addScaledVector(e.vel, DT);
    stepAlly(w, DT);
    worst = Math.min(worst, gapTo(a, e));
  }
  assert.ok(gapTo(a, e) > before + 50,
    `he opens the gap decisively even while chased (${before.toFixed(1)} → ${gapTo(a, e).toFixed(1)} u)`);
  // RECORDED, NOT GUARDED: he breaks off mid-charge now, nose still ON the enemy, so he spends the first
  // ~2.7 s coming about while the pursuer closes — the gap dips to near contact before it opens. That is
  // the price of leaving the instant the threshold is crossed instead of at the end of the pass, and it is
  // the right trade (the alternative killed him). Asserted loosely so it is visible without being brittle.
  assert.ok(worst < before, `the gap first CLOSES during the reversal (down to ${worst.toFixed(1)} u)`);
});

test('retreating with NOTHING to run from falls through to escort, not off into empty space', () => {
  // The contract here is only "there is no threat, so there is no gap to open — go to the player instead".
  // It is deliberately NOT a convergence assertion: from a standing start facing away he has to reverse,
  // and his 26 u turn radius then puts him into a slow orbit of the player rather than onto him (a
  // pre-existing property of the escort rule, not of this fall-through — see the escort tests above, which
  // cover the case where he is already flying at the player). What must be true is that he heads for the
  // player and stays near him, instead of flying outward for ever as a threat-less break-off would.
  const START = 80;
  const a = ally({ hp: 20, _shieldValue: 0, retreating: true, pos: new Vec3(0, 0.6, START) });
  const w = fight({ allies: [a], enemies: [] });     // arena empty: nothing to run from
  w.player.pos.set(0, 0.6, 0);
  let min = Infinity, max = 0;
  for (let i = 0; i < 60 * 20; i++) {
    stepAlly(w, DT);
    const d = Math.hypot(a.pos.x - w.player.pos.x, a.pos.z - w.player.pos.z);
    min = Math.min(min, d); max = Math.max(max, d);
  }
  assert.ok(min < START - 25, `he closes on the player (got within ${min.toFixed(1)} u of ${START})`);
  assert.ok(max < START * 2, `and never runs away (furthest ${max.toFixed(1)} u)`);
  assert.equal(a.retreating, true, 'still healing, still out of the fight');
  // …and the break-off's own rule is what would have sent him outward, so prove it is not running: with a
  // threat present he would be opening a gap, not orbiting the player.
  assert.equal(a.target, null, 'he is not engaging anything either — he is still out');
});

test('he rejoins at ≥40% hull with the shield full, from the break-off hold', () => {
  const { a, w } = breakingOff({ centreDist: 100, enemyGap: 20 });
  for (let i = 0; i < 60 * 5; i++) stepAlly(w, DT);
  assert.equal(a.retreating, true, 'still hurt: still out');
  a.hp = 0.5 * a.maxHp; a._shieldValue = a.shield.capacity;
  stepAlly(w, DT);
  assert.equal(a.retreating, false, 'back in');
});

test('HE DIES, and is gone for the rest of the mission (§2.4 reversed 2026-08-23)', () => {
  const a = ally();
  const w = fight({ allies: [a], enemies: [] });
  const kills0 = w.kills, earned0 = w.earned, xp0 = w.earnedXp;
  a.hp = 0;
  stepAllyDeaths(w);
  assert.equal(w.allies.length, 0, 'removed from the world…');
  assert.equal(a.alive, false, '…and marked gone, so anything still holding him can ask');
  // He is worth NOTHING: a phase's kills threshold, enemyTotal, isLastKillDrop and the cleared payload all
  // behave exactly as if he had never been there.
  assert.equal(w.kills, kills0, 'his death is not a kill');
  assert.equal(w.earned, earned0, 'no credits');
  assert.equal(w.earnedXp, xp0, 'no XP');
  assert.equal(w.drops.length, 0, 'and no loot roll');
  const evs = [];
  w.events.drain((ev) => evs.push(ev));
  assert.deepEqual(evs.map((e) => e.type), ['allyDown'], 'exactly one event, and it is NOT a `kill`');
  assert.ok(evs[0].pos && evs[0].sizeScale, 'carrying what the explosion needs — the FX is the announcement');
  assert.equal(evs[0].reward, undefined, 'and no reward field: there is nothing to bank for him');
});

test('a dead wingman leaves the fight alone: no ally, no ally step, nothing throws', () => {
  const a = ally();
  const w = fight({ allies: [a], enemies: [enemy(0, 40)] });
  a.hp = 0;
  stepAllyDeaths(w);
  for (let i = 0; i < 60; i++) stepAlly(w, DT);   // the step must early-out on an empty list
  assert.equal(w.allies.length, 0);
});

test('the player dying while the wingman lives winds him down rather than throwing', () => {
  const a = ally({ vel: new Vec3(0, 0, 20) });
  const w = fight({ allies: [a], enemies: [enemy(0, 40)] });
  w.player.alive = false;
  for (let i = 0; i < 300; i++) stepAlly(w, DT);
  assert.ok(a.vel.length() < 0.001, 'he coasts to a stop');
  assert.equal(a.thrusting, false);
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

// ---------- AIMING A GUN WHOSE BULLETS INHERIT THE SHOOTER'S VELOCITY ----------
// A kinetic bullet leaves at `nose × projectileSpeed + shipVelocity` (spawn.js; rockets do not inherit,
// §70), so a ship drifting sideways with its nose ON a target misses a STATIONARY one. The wingman is the
// worst case in the game: his whole manoeuvre is a firing pass with heavy lateral drift.

const HEAVY_CANNON_SPEED = 65;   // catalog_seed.js weapon id 6, the ally's gun
const unit = (x, z) => { const l = Math.hypot(x, z); return { x: x / l, z: z / l }; };
const angleOf = (v) => Math.atan2(v.x, v.z);

test('aimWithDrift: the resulting BULLET points at the target, not the nose', () => {
  const u = { x: 0, z: 1 };                       // target dead ahead in +Z
  const vel = { x: 12, z: 4 };                    // drifting hard to the right, and a little forward
  const n = aimWithDrift(u, vel, HEAVY_CANNON_SPEED);
  assert.equal(n.solved, true);
  assert.ok(Math.abs(Math.hypot(n.x, n.z) - 1) < 1e-12, 'the nose is a unit vector');
  assert.ok(n.x < 0, 'and it is canted INTO the drift, away from the target');
  // The whole contract, stated the way the bug was: where does the bullet actually go?
  const bd = bulletDir(n, vel, HEAVY_CANNON_SPEED);
  assert.ok(Math.abs(shortestAngleDelta(angleOf(bd), angleOf(u))) < 1e-9,
    `the shot travels at the target (off by ${shortestAngleDelta(angleOf(bd), angleOf(u))})`);
  // …and the naive nose-on-target aim, which is what the code did before, does NOT.
  const naive = bulletDir(u, vel, HEAVY_CANNON_SPEED);
  assert.ok(Math.abs(shortestAngleDelta(angleOf(naive), angleOf(u))) > 0.15,
    'pointing the nose at it misses by a wide margin — the defect this fixes');
});

test('aimWithDrift: at ZERO ship velocity the correction is a strict no-op', () => {
  for (const u of [{ x: 0, z: 1 }, unit(3, -7), unit(-1, -1)]) {
    const n = aimWithDrift(u, { x: 0, z: 0 }, HEAVY_CANNON_SPEED);
    assert.equal(n.solved, true);
    assert.equal(n.x, u.x); assert.equal(n.z, u.z);
  }
  // …and pure closing/receding drift needs no correction either: it crosses the line by nothing.
  const n = aimWithDrift({ x: 0, z: 1 }, { x: 0, z: 25 }, HEAVY_CANNON_SPEED);
  assert.ok(Math.abs(n.x) < 1e-12 && Math.abs(n.z - 1) < 1e-12);
});

test('aimWithDrift: the SOLVABILITY bound, and the fallback past it', () => {
  const u = { x: 0, z: 1 };
  // The ally can never reach it: his cap is PLAYER_MAX_SPEED against a 65 u/s cannon, so even a fully
  // sideways drift leaves the crossing component well inside the bound.
  assert.ok(PLAYER_MAX_SPEED < HEAVY_CANNON_SPEED, 'a future loadout that broke this would hit the fallback');
  assert.equal(aimWithDrift(u, { x: PLAYER_MAX_SPEED, z: 0 }, HEAVY_CANNON_SPEED).solved, true);
  // Past the bound there is no nose that cancels the drift: aim as close as possible — straight into it.
  const over = aimWithDrift(u, { x: 80, z: 0 }, HEAVY_CANNON_SPEED);
  assert.equal(over.solved, false);
  assert.ok(Math.abs(over.x + 1) < 1e-12 && Math.abs(over.z) < 1e-12, 'nose straight into the drift');
  assert.ok(Math.abs(Math.hypot(over.x, over.z) - 1) < 1e-12, 'still a unit vector');
});

test('gunSpeed picks the BALLISTIC mount, and a homing-only ship gets 0 (aim = nose on target)', () => {
  const shipWith = (mounts) => ({ groups: { g: { mounts } } });
  assert.equal(gunSpeed(shipWith([{ weapon: { type: 'bullet', projectileSpeed: 65 } },
                                  { weapon: { type: 'rocket', projectileSpeed: 999 } }])), 65);
  assert.equal(gunSpeed(shipWith([{ weapon: { type: 'rocket', projectileSpeed: 999 } }])), 0);
  const u = { x: 0, z: 1 };
  assert.deepEqual(aimWithDrift(u, { x: 20, z: 0 }, 0), { x: 0, z: 1, solved: true });
});

// A wingman can be handed the PLAYER's gear, so a beam on an ally is reachable today without arming a
// single pirate — and a hitscan must never be led. `isBallistic` is the load-bearing half: a group holding
// a beam AND a kinetic would otherwise be treated as ballistic and aimed ahead of the target by the OTHER
// gun's projectile speed. `gunSpeed`'s half was already a no-op for beams (no projectileSpeed → the
// comparison is false); it was narrowed for the same intent, not to fix a bug.
test('a BEAM mount is not ballistic and contributes no muzzle speed — a hitscan is never led', () => {
  const beam = { type: 'beam', power: 80, maxRange: 100, chargeTime: 1.0, corridorDeg: 2, fireCooldown: 0.5 };
  const kinetic = { type: 'bullet', projectileSpeed: 40 };
  const shipWith = (mounts) => ({ groups: { g: { mounts } } });

  assert.equal(isBallistic({ mounts: [{ weapon: beam }] }), false, 'a beam group flies down the NOSE');
  assert.equal(gunSpeed(shipWith([{ weapon: beam }])), 0, 'and offers no speed to lead by');

  // The mixed loadout: the beam group is still not ballistic, and the kinetic's 40 does not leak into it.
  assert.equal(isBallistic({ mounts: [{ weapon: beam }, { weapon: kinetic }] }), true,
    'a group that also holds a bullet IS ballistic — for its bullet');
  assert.equal(isBallistic({ mounts: [{ weapon: beam }] }), false);
  assert.equal(gunSpeed({ groups: { gun: { mounts: [{ weapon: beam }] }, alt: { mounts: [{ weapon: kinetic }] } } }), 40,
    'a ship-wide muzzle speed still comes from its real bullets');
});

test('the narrowing to `type === bullet` is NEUTRAL for every bullet/rocket combination that ships today', () => {
  // The S3 claim, asserted rather than left in prose: with no beam in the mix, `type === 'bullet'` and the
  // old `type !== 'rocket'` agree on every group, so nothing about an existing ally run changed.
  const bullet = (sp) => ({ type: 'bullet', projectileSpeed: sp });
  const rocket = { type: 'rocket', projectileSpeed: 999 };
  const combos = [
    [], [{ weapon: bullet(40) }], [{ weapon: rocket }],
    [{ weapon: bullet(40) }, { weapon: rocket }],
    [{ weapon: rocket }, { weapon: bullet(65) }],
    [{ weapon: bullet(40) }, { weapon: bullet(65) }],
    [{ weapon: rocket }, { weapon: rocket }],
  ];
  const oldIsBallistic = (g) => (g.mounts || []).some((m) => m.weapon && m.weapon.type !== 'rocket');
  const oldGunSpeed = (ship) => {
    let best = 0;
    for (const g of Object.values(ship.groups || {})) {
      for (const m of g.mounts || []) {
        if (m.weapon && m.weapon.type !== 'rocket' && m.weapon.projectileSpeed > best) best = m.weapon.projectileSpeed;
      }
    }
    return best;
  };
  for (const mounts of combos) {
    assert.equal(isBallistic({ mounts }), oldIsBallistic({ mounts }),
      `isBallistic changed for ${JSON.stringify(mounts.map((m) => m.weapon.type))}`);
    assert.equal(gunSpeed({ groups: { g: { mounts } } }), oldGunSpeed({ groups: { g: { mounts } } }));
  }
});

test('the ALLY in flight: his bullet flies at a stationary enemy while he drifts across the line', () => {
  // The end-to-end version of the defect. He is 40 u out with the enemy dead ahead and 15 u/s of pure
  // sideways drift; he must settle onto a nose that puts the SHOT on the target, not the nose.
  const a = ally({ pos: new Vec3(0, 0.6, 0), vel: new Vec3(15, 0, 0), heading: 0 });
  a.groups = { gun: { name: 'gun', ai: { range: 45, aimTol: 0.25 }, mounts: [{ weapon: { type: 'bullet', projectileSpeed: HEAVY_CANNON_SPEED } }], reload: 0.6, cooldown: 0, pending: [] } };
  a.mounts = a.groups.gun.mounts;
  const e = enemy(0, 40);
  const w = fight({ allies: [a], enemies: [e] });
  w.player.pos.set(0, 0.6, -200);      // far behind: never in the line of fire
  // Hold him on the spot so the geometry is the only thing under test.
  for (let i = 0; i < 240; i++) { a.pos.set(0, 0.6, 0); a.vel.set(15, 0, 0); stepAlly(w, DT); }
  const u = unit(e.pos.x - a.pos.x, e.pos.z - a.pos.z);
  const fwd = { x: Math.sin(a.heading), z: Math.cos(a.heading) };
  const bd = bulletDir(fwd, a.vel, HEAVY_CANNON_SPEED);
  const off = Math.abs(shortestAngleDelta(angleOf(bd), angleOf(u)));
  assert.ok(off < 0.02, `his SHOT is on the enemy (off by ${off.toFixed(4)} rad)`);
  // And the nose is genuinely NOT on the enemy — which is the point, and what the old gate would have vetoed.
  const noseOff = Math.abs(shortestAngleDelta(a.heading, angleOf(u)));
  assert.ok(noseOff > 0.15, `while the nose is canted off it by ${noseOff.toFixed(3)} rad`);
});

test('an ENEMY is left alone: it still points its nose at the player, flaw and all', () => {
  // Deliberate (DECISIONS §134): correcting enemy aim raises the difficulty of all five levels at once and
  // would move every recorded replay, so it is its own slice with its own balance pass. If someone wires
  // the correction into stepEnemyAI without that pass, this fails and says why.
  const w = createWorld();
  w.player = { pos: new Vec3(0, 0.6, 40), vel: new Vec3(), heading: 0, alive: true, class: 'player' };
  const e = {
    pos: new Vec3(0, 0.6, 0), vel: new Vec3(14, 0, 0), heading: 0,
    acceleration: 0, turnRate: 3, engine: { maxSpeed: 0, exhaust: { color: 0 } },
    hp: 30, maxHp: 30, alive: true, warping: false, spawnAge: 1, spawnDur: 1, scale: 1, fullScale: 1,
    shield: null, _shieldValue: 0, _shieldRechargeAccum: 0, groups: {}, mounts: [], class: 'fighter',
  };
  w.enemies = [e];
  // Hold its pose and its drift each tick — stepEnemyAI applies its own DRAG, which would otherwise bleed
  // the sideways velocity away and leave nothing for the flaw to show up in.
  for (let i = 0; i < 120; i++) { e.pos.set(0, 0.6, 0); e.vel.set(14, 0, 0); stepEnemyAI(w, DT); }
  const u = unit(w.player.pos.x - e.pos.x, w.player.pos.z - e.pos.z);
  assert.ok(Math.abs(shortestAngleDelta(e.heading, angleOf(u))) < 0.01,
    'the enemy nose sits ON the player — no drift compensation, exactly as before');
  const bd = bulletDir({ x: Math.sin(e.heading), z: Math.cos(e.heading) }, e.vel, HEAVY_CANNON_SPEED);
  assert.ok(Math.abs(shortestAngleDelta(angleOf(bd), angleOf(u))) > 0.15,
    'so its shot still misses while it drifts — the known flaw, left for the balance pass');
});
