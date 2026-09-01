// The duel room's ace: a hostile ship flown by the WINGMAN's pilot.
//
// What these tests exist to protect, in order of how much it would cost to get wrong:
//   1. it is an ENEMY in every way that pays off for free — shot, killed, counted, and settled by
//      `stepEnemyDeaths` — while paying no credits and no XP into the account;
//   2. `stepEnemyAI` does NOT also fly it (two sets of controls in one tick), and still flies every
//      ordinary enemy exactly as before;
//   3. it charges the PLAYER the way the wingman charges an enemy — the whole point of the room is that
//      the flying is the same code, so a change to `flySentinel` must show up on both sides;
//   4. it costs the shipped game nothing: no ace anywhere means no ace step, and the arrival draws not one
//      value from the seeded stream (DECISIONS §73).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from './vec.js';
import { createWorld } from './world.js';
import { makeAce, spawnAces, stepAces, hostileFoes, ACE_PILOT, ACE_COUNT_MAX, ACE_SPAWN_DIST } from './ace.js';
import { stepAlly, groupReach, engageBand } from './step-ally.js';
import { stepEnemyAI, stepEnemyDeaths, ENEMY_FIRE_GRACE } from './step-enemies.js';
import { stepBullets, stepRockets } from './step-projectiles.js';
import { spawnRocket } from './spawn.js';
import { shortestAngleDelta } from './steering.js';
import { seedSim, simRandomDraws } from './sim-random.js';
import { buildCatalog } from '../../../server/src/sim-host.js';

const DT = 1 / 60;
const CATALOG = buildCatalog('level-1');

// A World with a player at the origin facing +Z and nothing else. `pos` is a real Vec3 because the ace's
// spawn does vector arithmetic on it.
function fight({ heading = 0 } = {}) {
  const w = createWorld();
  w.catalog = CATALOG;
  w.player = {
    pos: new Vec3(0, 0.6, 0), vel: new Vec3(), heading, alive: true, class: 'player',
    hp: 100, maxHp: 100,
  };
  w.combatElapsed = ENEMY_FIRE_GRACE + 1;   // past the opening grace unless a test says otherwise
  return w;
}

// A plain hostile ship flown by the ordinary stand-off AI, for the "the aces did not break enemies" half.
function pirate(x, z) {
  return {
    pos: new Vec3(x, 0.6, z), vel: new Vec3(), heading: 0, alive: true, hp: 30, maxHp: 30,
    acceleration: 8, turnRate: 1, engine: { maxSpeed: 12, exhaust: { color: 0xff8a5a } },
    groups: {}, mounts: [], warping: false, spawnAge: 1, spawnDur: 1, scale: 1, fullScale: 1,
    shield: null, _shieldValue: 0, _shieldRechargeAccum: 0, sizeScale: 1, reward: 25, xp: 25,
  };
}

// ---------- what an ace IS ----------

test('an ace carries the wingman gear, a pilot tag, and is worth nothing', () => {
  const e = makeAce(CATALOG);
  assert.equal(e.pilot, ACE_PILOT, 'tagged, or stepEnemyAI would fly it too');
  assert.equal(e.maxHp, 200, "the wingman's 200 HP hull (makeSentinelHull)");
  assert.ok(e.repair, 'and his repair drone');
  assert.ok(e.shield && e.shield.capacity > 0, 'and his shield');
  assert.equal(e.reward, 0, 'a sparring partner pays no credits into a real account');
  assert.equal(e.xp, 0, '…and no XP');
  assert.ok(e.hitBoxes && e.broadR > 0, 'a real hull to shoot at (collision reads these)');
  assert.ok(e.radius > 0, 'and a health-bar/minimap anchor');
  assert.equal(e.dodge, 0, 'no skills → no dodge → a hit on it never rolls the seeded stream');
});

test('spawnAces places them ahead of the player, facing him, and draws NO randomness', () => {
  const w = fight();
  seedSim(12345);
  const before = simRandomDraws();
  const aces = spawnAces(w, 2);
  assert.equal(simRandomDraws(), before, 'the arrival is derived from the player, never rolled (§73)');
  assert.equal(aces.length, 2);
  assert.equal(w.enemies.length, 2, 'they live in world.enemies like every other hostile ship');
  for (const a of aces) {
    assert.ok(a.pos.z > 0, 'ahead of a player facing +Z');
    assert.ok(Math.abs(Math.hypot(a.pos.x, a.pos.z) - ACE_SPAWN_DIST) < ACE_SPAWN_DIST,
      'out at roughly the spawn distance, not on top of the player');
    assert.ok(Math.abs(shortestAngleDelta(a.heading, Math.atan2(-a.pos.x, -a.pos.z))) < 1e-6,
      'nose already on the player');
    assert.ok(a.warping, 'and it warps in like everything else (§54)');
  }
  assert.ok(aces[0].pos.x !== aces[1].pos.x, 'abreast, not stacked in one place');
  // THE ECHELON. Identical ships flown by identical deterministic code stay in lockstep forever if they
  // start in lockstep — two of them held the same distance tick for tick and fired their rockets in the
  // same frame, which one-shot the starter hull. They must differ in range AND in when they form.
  const range = aces.map((a) => Math.hypot(a.pos.x, a.pos.z));
  assert.ok(Math.abs(range[0] - range[1]) > 1, `staggered in range (${range.map((r) => r.toFixed(1))})`);
  assert.notEqual(aces[0].spawnDur, aces[1].spawnDur, 'and they do not finish forming together');
});

test('spawnAces clamps the count and always gives at least one', () => {
  assert.equal(spawnAces(fight(), 99).length, ACE_COUNT_MAX);
  assert.equal(spawnAces(fight(), 0).length, 1);
});

// ---------- who flies it ----------

test('stepEnemyAI leaves an ace alone, and still flies an ordinary enemy', () => {
  const w = fight();
  const ace = spawnAces(w, 1)[0];
  ace.warping = false; ace.spawnAge = ace.spawnDur;
  const pos = ace.pos.clone();
  const p = pirate(0, 40);
  w.enemies.push(p);

  stepEnemyAI(w, DT);
  assert.deepEqual({ x: ace.pos.x, z: ace.pos.z }, { x: pos.x, z: pos.z },
    'the stand-off AI must not touch a ship that has a pilot of its own');
  assert.ok(p.vel.length() > 0, '…while every ordinary enemy is flown exactly as before');
});

test('stepAces charges the player: it turns onto him and closes the gap', () => {
  const w = fight();
  const ace = spawnAces(w, 1)[0];
  ace.warping = false; ace.spawnAge = ace.spawnDur;
  const start = Math.hypot(ace.pos.x, ace.pos.z);
  for (let i = 0; i < 120; i++) stepAces(w, DT);   // 2 seconds
  const now = Math.hypot(ace.pos.x, ace.pos.z);
  assert.ok(now < start - 10, `it should be closing on the player (${start.toFixed(1)} → ${now.toFixed(1)})`);
  assert.equal(ace.target, w.player, 'and the ship it picked IS the player');
  assert.ok(ace.thrusting, 'engines lit — a charge, not a drift');
});

test('stepAces is inert in a fight with no aces (every level that ships)', () => {
  const w = fight();
  const p = pirate(0, 40);
  w.enemies.push(p);
  const pos = p.pos.clone();
  stepAces(w, DT);
  assert.deepEqual({ x: p.pos.x, z: p.pos.z }, { x: pos.x, z: pos.z });
});

test('stepAlly still flies the wingman when aces are in the world', () => {
  const w = fight();
  const ace = spawnAces(w, 1)[0];
  ace.warping = false; ace.spawnAge = ace.spawnDur;
  const ally = makeAce(CATALOG);       // the same hull; make it the FRIENDLY side instead
  delete ally.pilot; ally.isAlly = true;
  ally.pos.set(0, 0.6, -20); ally.warping = false; ally.spawnAge = ally.spawnDur;
  w.allies.push(ally);

  for (let i = 0; i < 120; i++) stepAlly(w, DT);
  assert.equal(ally.target, ace, 'the wingman charges the hostile ace like any other enemy');
});

test('hostileFoes is the player plus every live wingman', () => {
  const w = fight();
  assert.deepEqual(hostileFoes(w), [w.player]);
  const ally = { alive: true, pos: new Vec3(5, 0.6, 0) };
  w.allies.push(ally);
  assert.deepEqual(hostileFoes(w), [w.player, ally]);
  ally.alive = false;
  assert.deepEqual(hostileFoes(w), [w.player], 'a dead wingman is not a target');
  w.player.alive = false;
  assert.deepEqual(hostileFoes(w), [], 'and neither is a dead player');
});

// ---------- the opening grace ----------

test('an ace holds fire through the opening grace, exactly like every other hostile ship', () => {
  const w = fight();
  w.combatElapsed = 0;
  const ace = spawnAces(w, 1)[0];
  ace.warping = false; ace.spawnAge = ace.spawnDur;
  ace.pos.set(0, 0.6, 20);            // inside the gun's 45 u range, nose on the player
  ace.heading = Math.PI;
  for (let i = 0; i < 120; i++) { stepAces(w, DT); w.combatElapsed += DT; }
  assert.equal(w.bullets.length, 0, `nothing fired inside the ${ENEMY_FIRE_GRACE} s grace`);

  w.combatElapsed = ENEMY_FIRE_GRACE + 1;
  for (let i = 0; i < 120; i++) stepAces(w, DT);
  assert.ok(w.bullets.length > 0, '…and it opens up once the grace is over');
  assert.equal(w.bullets[0].fromPlayer, false, 'its shots are HOSTILE — they damage the player');
});

// ---------- the death ----------

test('a dead ace settles through stepEnemyDeaths: it counts, and it pays nothing', () => {
  const w = fight();
  const ace = spawnAces(w, 1)[0];
  ace.warping = false; ace.spawnAge = ace.spawnDur;
  ace.hp = 0;
  stepEnemyDeaths(w);
  assert.equal(w.enemies.length, 0, 'gone from the world');
  assert.equal(w.kills, 1, 'and counted, so the room can end on allEnemiesDead');
  assert.equal(w.earned, 0, 'no credits');
  assert.equal(w.earnedXp, 0, 'no XP');
  const out = []; w.events.drain((e) => out.push(e));
  const kill = out.find((e) => e.type === 'kill');
  assert.ok(kill, 'it dies through the ordinary kill event — the explosion, the log line, the FX');
  assert.equal(kill.reward, 0);
});

// ---------- point defence: shooting an incoming rocket out of the air ----------
//
// The mechanic underneath already existed — a bullet within 2.4 u takes a rocket's hp down and detonates
// it (`step-projectiles.js`) — but nothing in the game ever AIMED at one. These are the reachability
// tests for the pilot doing it: a rule that is never satisfiable would pass every structural check and do
// nothing in play.

// A live rocket flying at `at`, on the side that is hostile to it.
function incoming(world, at, from, { fromPlayer = true } = {}) {
  const w = CATALOG.weapons.get(3);   // Rocket (homing), health 10
  const dir = new Vec3(at.pos.x - from.x, 0, at.pos.z - from.z).normalize();
  return spawnRocket(world, new Vec3(from.x, 0.6, from.z), dir, w, w.accel, fromPlayer, at)[0];
}

// THE GEOMETRY IS THE REALISTIC ONE, and it is chosen rather than convenient: the rocket comes from the
// direction of the ship being charged — which is where the player is, and therefore where the pilot's nose
// already roughly points. That matters, because the turn is the binding constraint: at 1.16 rad/s a beam-on
// rocket 20 u out closing at 12+ u/s arrives BEFORE the nose can come round. Interception is a real
// capability with a real limit, not a guarantee.
test('an ace whose target is TOO FAR turns onto an incoming rocket and shoots it down', () => {
  const w = fight();
  const ace = spawnAces(w, 1)[0];
  ace.warping = false; ace.spawnAge = ace.spawnDur;
  ace.pos.set(0, 0.6, 90);            // 90 u from the player: well beyond the gun's 45 u engagement range
  ace.heading = Math.PI;              // nose on the player
  const rocket = incoming(w, ace, { x: 20, z: 55 });   // 40 u out, 30° off the nose — inside gun range

  stepAces(w, DT);
  assert.equal(ace.intercept, rocket, 'the rocket is acquired: nothing else is in reach');

  // Fly it out. `stepBullets` is what actually destroys the rocket, so the whole loop has to run.
  let shot = false;
  for (let i = 0; i < 60 * 6 && w.rockets.length; i++) {
    stepAces(w, DT);
    stepBullets(w, DT);
    stepRockets(w, DT);
    if (w.bullets.length) shot = true;
  }
  assert.ok(shot, 'it opened fire on the rocket');
  assert.equal(w.rockets.length, 0, 'and the rocket is gone — shot down, not merely aimed at');
  assert.equal(ace.hp, ace.maxHp, 'without taking the hit itself');
});

test('a rocket is NEVER worth turning away from a shot the pilot already has', () => {
  const w = fight();
  const ace = spawnAces(w, 1)[0];
  ace.warping = false; ace.spawnAge = ace.spawnDur;
  ace.pos.set(0, 0.6, 30);            // 30 u — INSIDE the 45 u gun range, so the player is shootable
  ace.heading = Math.PI;
  incoming(w, ace, { x: 20, z: 30 });
  stepAces(w, DT);
  assert.equal(ace.intercept, null, 'it presses the attack instead');
});

test('the intercept is HELD once committed, so the nose cannot dither', () => {
  const w = fight();
  const ace = spawnAces(w, 1)[0];
  ace.warping = false; ace.spawnAge = ace.spawnDur;
  ace.pos.set(0, 0.6, 90);
  ace.heading = Math.PI;
  const rocket = incoming(w, ace, { x: 20, z: 55 });
  stepAces(w, DT);
  assert.equal(ace.intercept, rocket);
  ace.pos.set(0, 0.6, 30);            // the player is suddenly in range — the commitment stands
  stepAces(w, DT);
  assert.equal(ace.intercept, rocket, 'it finishes the job it started');
  w.rockets.length = 0;               // …and lets go the moment the rocket is gone
  stepAces(w, DT);
  assert.equal(ace.intercept, null);
});

test('it only defends ITSELF and its friend — a rocket chasing a third ship is not its problem', () => {
  const w = fight();
  const ace = spawnAces(w, 1)[0];
  ace.warping = false; ace.spawnAge = ace.spawnDur;
  ace.pos.set(0, 0.6, 90);
  ace.heading = Math.PI;
  const bystander = { pos: new Vec3(60, 0.6, 90), alive: true };
  incoming(w, bystander, { x: 25, z: 90 });   // passes right by the ace, aimed at somebody else
  stepAces(w, DT);
  assert.equal(ace.intercept, null, 'not its rocket, not its pass to throw away');
});

test('it will not shoot its OWN side\'s rocket down', () => {
  const w = fight();
  const ace = spawnAces(w, 1)[0];
  ace.warping = false; ace.spawnAge = ace.spawnDur;
  ace.pos.set(0, 0.6, 90);
  ace.heading = Math.PI;
  incoming(w, ace, { x: 25, z: 90 }, { fromPlayer: false });   // hostile-side rocket: the ace's own team
  stepAces(w, DT);
  assert.equal(ace.intercept, null);
});

test('a RETREATING pilot holds fire — it does not break off to intercept', () => {
  const w = fight();
  const ace = spawnAces(w, 1)[0];
  ace.warping = false; ace.spawnAge = ace.spawnDur;
  ace.pos.set(0, 0.6, 90);
  ace.hp = 1; ace._shieldValue = 0;   // ≤25 % hull with the shield down → the break-off
  incoming(w, ace, { x: 25, z: 90 });
  stepAces(w, DT);
  assert.equal(ace.retreating, true);
  assert.equal(ace.intercept, null, 'a pilot leaving the fight is leaving the fight');
  assert.equal(w.bullets.length, 0);
});

// THE WINGMAN'S HALF, and the case the maintainer asked for first: no enemy to fight at all, but a rocket
// is inbound at the player. He escorts, sees it, and shoots it down.
test('the wingman intercepts while ESCORTING — no enemy in reach, but a rocket is', () => {
  const w = fight();
  const ally = makeAce(CATALOG);
  delete ally.pilot; ally.isAlly = true;
  ally.pos.set(0, 0.6, 12); ally.heading = 0;   // holding station ahead of the player, facing out
  ally.warping = false; ally.spawnAge = ally.spawnDur;
  w.allies.push(ally);
  assert.equal(w.enemies.length, 0, 'nothing to fight — he is escorting');
  // Inbound at the PLAYER from out in front, which is where the enemies would be — and so roughly where
  // the wingman's nose already is. See the note on the ace's test above: the turn is the binding limit.
  const rocket = incoming(w, w.player, { x: 12, z: 50 }, { fromPlayer: false });

  stepAlly(w, DT);
  assert.equal(ally.intercept, rocket, 'he defends the player from it');
  let shot = false;
  for (let i = 0; i < 60 * 6 && w.rockets.length; i++) {
    stepAlly(w, DT); stepBullets(w, DT); stepRockets(w, DT);
    if (w.bullets.length) shot = true;
  }
  assert.ok(shot, 'he opened fire');
  assert.equal(w.rockets.length, 0, 'and the player is not hit');
  assert.equal(w.player.hp, w.player.maxHp);
});

// ---------- the gun shoots as far as the GUN shoots ----------
//
// The maintainer's rule (2026-09-01): the Sentinel pilot fires from whatever range the weapon allows, not
// from the group's AI band. `GUN.ai.range` is 45 while the Heavy cannon reaches 140 — and `GUN.ai` is
// shared with the pirate ships, so the change lives in the pilot and rebalances nobody else.

test('the two ranges stay apart: the gun REACHES 140, the engagement BAND is 45', () => {
  const e = makeAce(CATALOG);
  assert.equal(groupReach(e.groups.gun), 140, "the Heavy cannon's own maxRange");
  assert.equal(e.groups.gun.ai.range, 45, '…while the shared AI band is still 45');
  assert.equal(engageBand(e), 45, 'and point defence keys off the BAND, or it could never acquire again');
});

test('it opens fire at 100 u — outside the AI band, inside the gun', () => {
  const w = fight();
  const ace = spawnAces(w, 1)[0];
  ace.warping = false; ace.spawnAge = ace.spawnDur;
  ace.pos.set(0, 0.6, 100);       // 100 u: more than double the 45 u band, well inside the cannon's 140
  ace.heading = Math.PI;          // nose already on the player
  ace.vel.set(0, 0, 0);
  // Two ticks: `updateGroups` queues the volley on the trigger tick and drains it on the next (each mount
  // waits out its own `delay`, 0 here) — one tick would test the queue, not the decision.
  stepAces(w, DT); stepAces(w, DT);
  const shots = w.bullets.filter((b) => !b.fromPlayer);
  assert.equal(shots.length, 1, 'it shoots — under the old band it held fire for the whole approach');
});

test('…and holds fire at 200 u, where the bullet could not arrive', () => {
  const w = fight();
  const ace = spawnAces(w, 1)[0];
  ace.warping = false; ace.spawnAge = ace.spawnDur;
  ace.pos.set(0, 0.6, 200);
  ace.heading = Math.PI;
  ace.vel.set(0, 0, 0);
  stepAces(w, DT); stepAces(w, DT);
  assert.equal(w.bullets.length, 0, 'beyond the weapon, not merely beyond the band');
});

test('a rocket group keeps its AI band — how far to launch a homing weapon was not the question', () => {
  const e = makeAce(CATALOG);
  assert.equal(e.groups.rocket.ai.range, 80);
  assert.equal(e.groups.rocket.mounts[0].weapon.maxRange, 150, 'the rocket reaches further than it is launched');
});
