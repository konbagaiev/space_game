// The wingman against the REAL catalog seed: what he flies, when he arrives, and what his kills are worth.
//
// `step-ally.test.js` covers his rules with plain objects. This is the other half — the part that breaks
// silently when the CATALOG drifts. A rebalanced hull, a re-weighted gun or a renamed component would leave
// every unit test green while quietly turning a 200 HP corvette into something else, so the loadout is
// pinned here as concrete numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimWorld, buildCatalog } from './sim-host.js';
import { LEVELS } from './catalog_seed.js';
import { simRandomDraws } from '../../client/src/sim-core/sim-random.js';
import { PLAYER_MAX_SPEED } from '../../client/src/sim-core/step-player.js';
import { spawnAlly } from '../../client/src/sim-core/ally.js';
import { stepEnemyDeaths } from '../../client/src/sim-core/step-enemies.js';
import { withAllyAt } from '../../client/src/sim-core/ally-config.js';
import { updateLevelRunner } from '../../client/src/sim-core/level-runner.js';
import { SIM_DT, BULLET_PLANE_Y } from '../../client/src/sim-core/consts.js';
import { stepAlly, stepAllyDeaths } from '../../client/src/sim-core/step-ally.js';
import { ALLY_RETREAT_HP_FRAC } from '../../client/src/sim-core/ally-config.js';
import { applyShieldedDamage } from '../../client/src/sim-core/components.js';
import { simTick } from '../../client/src/sim-core/tick.js';
import { clearAndPlaceRun, startRun } from '../../client/src/sim-core/reset-world.js';
import { stepEnemyAI } from '../../client/src/sim-core/step-enemies.js';
import { stepBullets } from '../../client/src/sim-core/step-projectiles.js';
import { spawnEnemy as spawnEnemyInto } from '../../client/src/sim-core/ship-entity.js';
import { Vec3 } from '../../client/src/sim-core/vec.js';

// Step the level runner until the named phase has been entered (or give up). The ally arrives on a PHASE,
// so a test about his arrival has to get the fight there.
function runToPhase(world, phaseName, maxTicks = 60 * 600) {
  const phases = world.levelRunner.level.phases;
  const want = phases.findIndex((p) => p.name === phaseName);
  assert.ok(want >= 0, `level has no phase "${phaseName}"`);
  for (let i = 0; i < maxTicks && world.levelRunner.phaseIndex < want; i++) {
    // Kill whatever is on the map, so the phase conditions advance without simulating a whole fight.
    for (const e of world.enemies) e.hp = 0;
    stepEnemyDeaths(world);
    world.combatElapsed += SIM_DT;
    updateLevelRunner(world, SIM_DT);
  }
  assert.equal(world.levelRunner.phaseIndex, want, `never reached the "${phaseName}" phase`);
}

test('a level with NO ally phase never produces one', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7 });
  assert.equal(world.allies.length, 0);
  for (const ph of world.catalog.level.phases) assert.equal(ph.ally, undefined, `phase ${ph.name} carries no ally`);
});

test('the ally arrives when his phase starts, exactly once, and never twice', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  assert.equal(world.allies.length, 1, 'wave-1 is the opening phase, so he is there from the start');
  assert.equal(spawnAlly(world), null, 'spawnAlly refuses a second');
  assert.equal(world.allies.length, 1);
});

test('a later ally phase does not spawn him until the fight gets there', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'clear-out' });
  assert.equal(world.allies.length, 0, 'not yet — clear-out is the wave before the boss');
  runToPhase(world, 'clear-out');
  assert.equal(world.allies.length, 1, 'entering the phase IS the arrival');
});

test('the loadout, pinned against catalog drift', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  const a = world.allies[0];
  assert.equal(a.maxHp, 200, 'Heavy hull id 13');
  assert.equal(a.hp, 200);
  assert.equal(a.mass, 86, 'hull 50 + engine 10 + thruster 4 + repair 4 + shield 0 + cannon 10 + rocket 8');
  assert.ok(Math.abs(a.acceleration - 8.7) < 0.05, `accel ≈ 8.7 (got ${a.acceleration})`);
  assert.ok(Math.abs(a.turnRate - 1.16) < 0.01, `turn ≈ 1.16 rad/s (got ${a.turnRate})`);
  assert.equal(a.shield.capacity, 20, 'Base shield id 31');
  assert.ok(a.repair, 'Repair drone id 12');
  assert.equal(a.grab, null, 'NO grab, by design — he does not react to loot at all');
  assert.deepEqual(a.mounts.map((m) => m.weapon.id), [6, 3], 'Heavy cannon + Rocket (homing)');
  assert.ok(a.groups.gun.ai && a.groups.gun.ai.range === 45, 'the player ship row carries the AI fire rules he reads');
  assert.ok(a.groups.rocket.ai);
  // TOP SPEED IS THE SHIP'S, NOT THE ENGINE'S: no skills → maxSpeedMul 1 → exactly the player's flat cap.
  assert.equal(a.maxSpeedMul, 1);
  assert.equal(PLAYER_MAX_SPEED * (a.maxSpeedMul || 1), PLAYER_MAX_SPEED);
  assert.equal(a.isAlly, true);
  assert.equal(a.dodge, 0, 'no skills → dodge 0 → a hostile hit never rolls the seeded stream');
});

test('spawnAlly consumes NO seeded draws (DECISIONS §73)', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7 });
  const before = simRandomDraws();
  const a = spawnAlly(world);
  assert.ok(a);
  assert.equal(simRandomDraws(), before, 'building and placing him is entirely deterministic');
});

test('an ALLY kill advances the mission and pays nothing; a player kill still pays', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7 });
  // Let the opening wave spawn something to kill.
  for (let i = 0; i < 600 && world.enemies.length < 2; i++) { world.combatElapsed += SIM_DT; updateLevelRunner(world, SIM_DT); }
  assert.ok(world.enemies.length >= 2, 'the level put enemies on the map');

  const byAlly = world.enemies[0], byPlayer = world.enemies[1];
  const reward = byPlayer.reward, xp = byPlayer.xp;
  assert.ok(reward > 0 && xp > 0, 'the ship type is worth something in the first place');

  const kills0 = world.kills, earned0 = world.earned, xp0 = world.earnedXp;
  byAlly.hp = 0; byAlly.lastHitBy = 'ally';
  stepEnemyDeaths(world);
  assert.equal(world.kills, kills0 + 1, 'progress counts EVERY death, or a kills-threshold phase would stall');
  assert.equal(world.allyKills, 1, 'and the diagnostic counts his share');
  assert.equal(world.earned, earned0, 'but his kill pays no credits');
  assert.equal(world.earnedXp, xp0, 'and no XP');

  byPlayer.hp = 0; byPlayer.lastHitBy = 'player';
  stepEnemyDeaths(world);
  assert.equal(world.kills, kills0 + 2);
  assert.equal(world.allyKills, 1, 'the player\'s kill is not his');
  assert.equal(world.earned, earned0 + reward, 'a player kill still pays');
  assert.equal(world.earnedXp, xp0 + xp);
});

test('the kill EVENT reports the split, so the client logs and pops nothing for an ally kill', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7 });
  for (let i = 0; i < 600 && world.enemies.length < 1; i++) { world.combatElapsed += SIM_DT; updateLevelRunner(world, SIM_DT); }
  const e = world.enemies[0];
  e.hp = 0; e.lastHitBy = 'ally';
  stepEnemyDeaths(world);
  const kill = [];
  world.events.drain((ev) => { if (ev.type === 'kill') kill.push(ev); });
  assert.equal(kill.length, 1);
  assert.equal(kill[0].byAlly, true);
  assert.equal(kill[0].reward, 0, 'no floating "+xx" credit popup: the adapter guards on reward > 0');
  assert.equal(kill[0].xp, 0);
});

test('withAllyAt never mutates the seeded LEVELS: two worlds, and only one has an ally phase', () => {
  const withFlag = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'clear-out' });
  const without = createSimWorld({ levelName: 'level-4', seed: 7 });
  assert.equal(withFlag.catalog.level.phases.find((p) => p.name === 'clear-out').ally, true);
  assert.equal(without.catalog.level.phases.find((p) => p.name === 'clear-out').ally, undefined,
    'the second world, built AFTER the first, is untouched — buildCatalog shares the seed\'s phases array');
  // …and the module-level seed itself.
  const seedLevel = LEVELS.find((l) => l.name === 'level-4').descriptor;
  for (const ph of seedLevel.phases) assert.equal(ph.ally, undefined, `seed phase ${ph.name} untouched`);
  // A phase name the level does not carry changes nothing at all.
  const cat = buildCatalog('level-4');
  assert.equal(withAllyAt(cat.level, 'no-such-phase'), cat.level);
});

// ---------- His fire, and the two-sided damage routing ----------

test('his gun fires FRIENDLY, ATTRIBUTED and SILENT — and every projectile sits on the combat plane', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  const a = world.allies[0];
  a.warping = false; a.spawnAge = a.spawnDur; a.scale = a.fullScale;
  // An enemy parked dead ahead of his nose, well inside the gun's 45 u range.
  const e = world.catalog.enemyShips.find((s) => s.name === 'pirate gunner');
  const target = spawnEnemyInto(world, e);
  a.pos.set(0, BULLET_PLANE_Y, 0); a.heading = 0; a.vel.set(0, 0, 0); a.target = null; a.passArmed = false;
  target.pos.set(0, BULLET_PLANE_Y, 20); target.warping = false;
  world.player.pos.set(0, BULLET_PLANE_Y, -60);   // behind him: never in the line of fire

  for (let i = 0; i < 30 && !world.bullets.length; i++) stepAlly(world, SIM_DT);
  assert.ok(world.bullets.length, 'he opened fire');
  const b = world.bullets[0];
  assert.equal(b.fromPlayer, true, '`fromPlayer` means the FRIENDLY SIDE — his shots hurt enemies, not you');
  assert.equal(b.fromAlly, true, 'and `fromAlly` says which friendly, for the reward split');
  assert.ok(Number.isFinite(b.pos.y) && Number.isFinite(b.vel.y),
    'the muzzle and the bolt sit on the canonical combat plane (a planar {x,z} nose would put NaN here)');
  const fires = [];
  world.events.drain((ev) => { if (ev.type === 'fire') fires.push(ev); });
  assert.ok(fires.length, 'the fire event was emitted');
  for (const f of fires) assert.equal(f.fromPlayer, false, 'but the EVENT says "not YOUR shot" — his guns are silent');
});

test('he holds fire rather than shooting through the player\'s hull (§2.6)', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  const a = world.allies[0];
  a.warping = false; a.spawnAge = a.spawnDur; a.scale = a.fullScale;
  const def = world.catalog.enemyShips.find((s) => s.name === 'pirate gunner');
  const target = spawnEnemyInto(world, def);
  a.pos.set(0, BULLET_PLANE_Y, 0); a.heading = 0; a.vel.set(0, 0, 0);
  target.pos.set(0, BULLET_PLANE_Y, 30); target.warping = false;
  world.player.pos.set(0, BULLET_PLANE_Y, 12);    // directly between the two
  for (let i = 0; i < 60; i++) stepAlly(world, SIM_DT);
  assert.equal(world.bullets.length, 0, 'never a tracer through your hull');
});

test('an ENEMY fights the nearer of player-or-ally, and its rocket homes on whoever it picked', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  const a = world.allies[0];
  a.warping = false; a.spawnAge = a.spawnDur;
  const def = world.catalog.enemyShips.find((s) => s.name === 'basic rocket pirate');
  const e = spawnEnemyInto(world, def);
  e.warping = false; e.spawnAge = e.spawnDur; e.scale = e.fullScale;
  e.pos.set(0, BULLET_PLANE_Y, 0); e.heading = 0;
  a.pos.set(0, BULLET_PLANE_Y, 12);               // the ally is right there…
  world.player.pos.set(0, BULLET_PLANE_Y, 200);   // …and the player is far away
  world.combatElapsed = 60;                       // past the opening hold-fire grace
  for (let i = 0; i < 240 && !world.rockets.length; i++) stepEnemyAI(world, SIM_DT);
  assert.ok(world.rockets.length, 'it launched');
  assert.equal(world.rockets[0].fromPlayer, false, 'a hostile rocket');
  assert.equal(world.rockets[0].target, a, 'homing on the WINGMAN, because he is the nearer target');
});

test('hostile fire lands on the ally: a bullet takes his shield, then his hull', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  const a = world.allies[0];
  a.warping = false; a.spawnAge = a.spawnDur; a.scale = a.fullScale;
  a.pos.set(0, BULLET_PLANE_Y, 0);
  world.player.pos.set(500, BULLET_PLANE_Y, 500); // far away: only the ally is in reach
  world.bullets.push({
    pos: new Vec3(0, BULLET_PLANE_Y, -6), vel: new Vec3(0, 0, 200), traveled: 0, maxRange: 88,
    fromPlayer: false, damage: 60, class: 'kinetic',
  });
  const hp0 = a.hp, sh0 = a._shieldValue;
  for (let i = 0; i < 10 && world.bullets.length; i++) stepBullets(world, SIM_DT);
  assert.ok(a._shieldValue < sh0, 'the shield absorbed first');
  assert.ok(a.hp < hp0, 'and the excess spilled to the hull in the same tick (one router, §76)');
  const hits = [];
  world.events.drain((ev) => { if (ev.type === 'hit') hits.push(ev); });
  assert.deepEqual(hits.map((h) => h.target), ['ally'], 'reported as a hit on the ALLY, not on you');
});

// ---------- He dies (§2.4, reversed 2026-08-23) ----------

test('the wingman DIES and pays nothing: no kill, no credits, no XP, no loot, mission unaffected', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  const a = world.allies[0];
  a.warping = false; a.spawnAge = a.spawnDur;
  for (let i = 0; i < 600 && world.enemies.length < 1; i++) { world.combatElapsed += SIM_DT; updateLevelRunner(world, SIM_DT); }
  const kills0 = world.kills, earned0 = world.earned, xp0 = world.earnedXp;
  const total0 = world.enemyTotal, drops0 = world.drops.length, enemies0 = world.enemies.length;
  world.events.drain(() => {});          // clear the spawn-time noise

  a.hp = 0;
  stepAllyDeaths(world);
  assert.equal(world.allies.length, 0, 'gone for the rest of the mission');
  assert.equal(a.alive, false);
  assert.equal(world.kills, kills0, 'his death is not a kill — a phase\'s kills threshold cannot notice');
  assert.equal(world.enemyTotal, total0);
  assert.equal(world.earned, earned0, 'no credits');
  assert.equal(world.earnedXp, xp0, 'no XP');
  assert.equal(world.drops.length, drops0, 'no loot roll');
  assert.equal(world.enemies.length, enemies0, 'and the fight in front of the player is untouched');
  assert.equal(world.levelRunner.won, false, 'his death does not end the mission');
  assert.equal(world.levelRunner.cleared, false);

  const evs = []; world.events.drain((ev) => evs.push(ev));
  assert.deepEqual(evs.map((e) => e.type), ['allyDown']);
  assert.equal(evs[0].reward, undefined, 'the event carries no reward — there is nothing to bank for him');
});

test('a full tick with a DEAD wingman still runs, and the level keeps going', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  world.allies[0].hp = 0;
  for (let i = 0; i < 600; i++) simTick(world, SIM_DT);   // must not throw with allies emptied mid-run
  assert.equal(world.allies.length, 0);
  assert.ok(world.enemies.length > 0 || world.kills > 0, 'the fight carried on without him');
});

test('a fresh run brings him BACK — he is lost for the mission, not for the campaign', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  world.allies[0].hp = 0;
  stepAllyDeaths(world);
  assert.equal(world.allies.length, 0);
  clearAndPlaceRun(world);
  startRun(world);                        // the retry re-enters the phase that carries `ally: true`
  assert.equal(world.allies.length, 1, 'the next mission gets a wingman again');
});

test('drifting across his own line of fire, his Heavy cannon still HITS a stationary enemy', () => {
  // The defect end to end, against the real catalog and the real projectile step: bullets inherit the
  // shooter's velocity (spawn.js; rockets do not, §70), so a ship with 15 u/s of sideways drift and its
  // nose ON the target used to miss a motionless one. The ally is the worst case in the game because his
  // whole manoeuvre is a firing pass with heavy lateral drift.
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  const a = world.allies[0];
  a.warping = false; a.spawnAge = a.spawnDur; a.scale = a.fullScale;
  const def = world.catalog.enemyShips.find((s) => s.name === 'pirate gunner');
  const target = spawnEnemyInto(world, def);
  target.warping = false; target.spawnAge = target.spawnDur; target.scale = target.fullScale;
  target.vel.set(0, 0, 0);
  world.player.pos.set(0, BULLET_PLANE_Y, -300);   // far behind: never in the line of fire

  const hp0 = target.hp + target._shieldValue;
  for (let i = 0; i < 60 * 8; i++) {
    // Pin the geometry: he sits 30 u short of the enemy, sliding sideways at 15 u/s. Only the AIM is
    // under test, so his position and drift are held rather than simulated.
    a.pos.set(0, BULLET_PLANE_Y, 0); a.vel.set(15, 0, 0);
    target.pos.set(0, BULLET_PLANE_Y, 30);
    stepAlly(world, SIM_DT);
    stepBullets(world, SIM_DT);
  }
  assert.ok(target.hp + target._shieldValue < hp0,
    `his shots connect while he drifts (took ${(hp0 - target.hp - target._shieldValue).toFixed(0)} damage)`);
  // …and the nose is deliberately NOT on the enemy, which is exactly why the fire gate had to move with it.
  const noseOff = Math.abs(a.heading - 0);
  assert.ok(noseOff > 0.15, `while his nose is canted ${noseOff.toFixed(3)} rad off the bearing`);
});

// ---------- §2.6 UNDER DRIFT: the safety rule follows the SHOT, not the nose ----------
//
// The plain §2.6 case above flies him at ZERO velocity, where `aimWithDrift` is a strict no-op and the shot
// runs straight down the nose — so it exercises the OLD nose-based rule and would pass even if the moved
// gate were wrong. These two are its mirror image: with real lateral drift the nose and the bullet point in
// measurably different directions (up to ~0.48 rad apart at his 30 u/s cap against a 65 u/s cannon), so
// "which line do we test the player against?" has two different answers and only one is safe.
//
// Both cases run the REAL step, the REAL catalog weapon and the REAL fire gate; the ally's pose and drift
// are pinned each tick so the geometry is the only variable.
function driftFireCase({ playerAt, drift = 30, settleTicks = 120, observeTicks = 360 }) {
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  const a = world.allies[0];
  a.warping = false; a.spawnAge = a.spawnDur; a.scale = a.fullScale;
  const def = world.catalog.enemyShips.find((s) => s.name === 'pirate gunner');
  const target = spawnEnemyInto(world, def);
  target.warping = false; target.spawnAge = target.spawnDur; target.scale = target.fullScale;
  const tick = () => {
    a.pos.set(0, BULLET_PLANE_Y, 0);
    a.vel.set(drift, 0, 0);                    // lateral drift: what splits the nose from the bullet's line
    target.pos.set(0, BULLET_PLANE_Y, 40);     // dead ahead in +Z → the BULLET's line is +Z
    world.player.pos.set(playerAt.x, BULLET_PLANE_Y, playerAt.z);
    stepAlly(world, SIM_DT);
  };
  // SETTLE FIRST, then count. He starts facing +Z, which IS the true bearing here, so a rocket launched on
  // the opening ticks is perfectly correct and says nothing about the gate under test — the nose has to
  // reach the drift-corrected aim before the two lines differ at all. The observation window is 6 s, longer
  // than the rocket's 5 s cooldown, so it gets a real chance to fire inside it.
  for (let i = 0; i < settleTicks; i++) tick();
  world.bullets.length = 0; world.rockets.length = 0;
  for (let i = 0; i < observeTicks; i++) tick();
  return { bullets: world.bullets.length, rockets: world.rockets.length, nose: a.heading };
}

test('§2.6 under drift: the SHOT crosses the player (the nose does not) → he holds fire', () => {
  // The player sits ON the bullet's line, 15 u out — nearer than the 40 u target. The NOSE is canted
  // ~0.48 rad away from him, so a nose-based test would see a clear line and let the shot go straight
  // through him. That is exactly the loosening this guards.
  const r = driftFireCase({ playerAt: { x: 0, z: 15 } });
  assert.ok(Math.abs(r.nose) > 0.35,
    `the nose is canted clear of the player (${r.nose.toFixed(3)} rad, outside the 0.35 block cone)`);
  assert.equal(r.bullets, 0, 'and he still holds fire, because the BULLET would cross the player');
});

test('§2.6 under drift: the NOSE crosses the player but the shot does not → he fires', () => {
  // The mirror. The player sits on the NOSE line at 15 u, so a nose-based test would freeze his gun for the
  // whole pass — but the bullet flies down +Z at the enemy and never goes near him. Holding fire here is a
  // wingman who never shoots; firing is correct and safe.
  const nose = -Math.asin(30 / 65);                       // where aimWithDrift puts it for this geometry
  const r = driftFireCase({ playerAt: { x: Math.sin(nose) * 15, z: Math.cos(nose) * 15 } });
  assert.ok(r.bullets > 0, 'he fires: the shot is on the enemy and clear of the player');
});

test('§2.6 under drift: with the player far behind, the same setup fires (the control)', () => {
  // Proves the two cases above differ ONLY in where the player is — not in whether he ever lined up at all.
  const r = driftFireCase({ playerAt: { x: 0, z: -300 } });
  assert.ok(r.bullets > 0, 'nothing else in the setup is suppressing his fire');
});

// ---------- The ROCKET flies down the NOSE, so both of its gates are asked about the nose ----------
// A rocket inherits no velocity (§70): it launches along the nose and homes afterwards. So "is it aligned?"
// must compare the NOSE to the true bearing, and "does it cross the player?" must test the NOSE — even
// though the gun on the same hull is judged on a line up to ~0.48 rad away from it.

test('the ROCKET is gated on the RAW bearing, not on the drift-corrected aim', () => {
  // At full drift the nose sits ~0.48 rad off the true bearing — outside the rocket's own 0.40 aimTol. A
  // gate that compared the nose to the CORRECTED aim would read ~0 and launch it wildly off the bearing
  // while reporting "aligned", which is what the round-1 comment claimed was not happening.
  const r = driftFireCase({ playerAt: { x: 0, z: -300 } });     // player far away: safety is not the variable
  assert.ok(Math.abs(r.nose) > 0.40, `the nose is ${Math.abs(r.nose).toFixed(3)} rad off the bearing`);
  assert.ok(r.bullets > 0, 'the GUN fires — its own line is on the enemy');
  assert.equal(r.rockets, 0, 'but the rocket holds: where it would actually fly is not on the enemy');
});

test('§2.6 under drift: the ROCKET is blocked by the player on the NOSE line, even when the gun is not', () => {
  // The one case that separates "test each group's own path" from "test the bullet's path for everything".
  // Drift 24 puts the nose ~0.377 rad off the bearing: inside the rocket's 0.40 aimTol (so it wants to
  // fire), outside the 0.35 block cone measured from the BULLET's line (so the gun is clear). Put the
  // player on the NOSE line and the rocket would go straight through him while the gun is safely clear.
  const drift = 24;
  const nose = -Math.asin(drift / 65);
  assert.ok(Math.abs(nose) > 0.35 && Math.abs(nose) < 0.40, 'the geometry really does sit between the two');
  const r = driftFireCase({ drift, playerAt: { x: Math.sin(nose) * 15, z: Math.cos(nose) * 15 } });
  assert.equal(r.rockets, 0, 'the rocket holds — its path is the nose, and the player is on it');
  assert.ok(r.bullets > 0, 'while the gun fires, because ITS path is clear of him');
});

// ---------- THE BREAK-OFF IS TAKEN WHEN THE DAMAGE LANDS, NOT ONCE PER PASS ----------
//
// The reported defect, end to end. §2d's "low health never interrupts a charge" was written while the ally
// COULD NOT DIE; once he became mortal it meant "die mid-charge". Level 4's boss (`catalog_seed.js`) mounts
// 2× weapon 10 (Advanced pirate cannon, power 10, cooldown 1.0) and 3× weapon 4 (Rocket pirate, power 20,
// cooldown 4) — about **35 damage per second** on target. Against a 200 HP hull the old 20 % threshold was
// therefore ~1 s wide, while the decision was taken once per ~6 s pass cycle: it landed inside the fatal
// window about one time in six, and the maintainer watched him press on and die.
const BOSS_DPS = 2 * (10 / 1.0) + 3 * (20 / 4);      // = 35, the real Level-4 boss loadout

// A charging wingman taking boss-grade damage. Returns the tick he crossed the threshold on, the tick he
// broke off on, and the world.
function underFire({ startFrac = 0.30, ticks = 600, stopAfterRetreat = false }) {
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  const a = world.allies[0];
  a.warping = false; a.spawnAge = a.spawnDur; a.scale = a.fullScale;
  a.hp = startFrac * a.maxHp; a._shieldValue = 0;    // shield already down: hull damage is landing
  const def = world.catalog.enemyShips.find((s) => s.name === 'second pirate boss');
  const boss = spawnEnemyInto(world, def);
  boss.warping = false; boss.spawnAge = boss.spawnDur; boss.scale = boss.fullScale;
  boss.pos.set(0, BULLET_PLANE_Y, 60);
  a.pos.set(0, BULLET_PLANE_Y, 0); a.heading = 0;     // nose on it: mid-charge
  world.player.pos.set(0, BULLET_PLANE_Y, -300);

  const threshold = ALLY_RETREAT_HP_FRAC * a.maxHp;
  let crossedAt = null, brokeAt = null;
  for (let i = 0; i < ticks; i++) {
    stepAlly(world, SIM_DT);
    if (brokeAt == null && a.retreating) brokeAt = i;
    if (!(stopAfterRetreat && brokeAt != null)) {
      applyShieldedDamage(a, BOSS_DPS * SIM_DT);      // the boss keeps working on him
      if (crossedAt == null && a.hp <= threshold) crossedAt = i;
    }
    stepAllyDeaths(world);
    if (!world.allies.length) break;                  // he died
  }
  return { world, a, crossedAt, brokeAt, alive: world.allies.length === 1, threshold };
}

test('under boss-grade fire he breaks off WITHIN A FRACTION OF A SECOND of crossing 25 %', () => {
  const r = underFire({ startFrac: 0.30, stopAfterRetreat: true });
  assert.ok(r.crossedAt != null, 'the damage really did take him under the threshold');
  assert.ok(r.brokeAt != null, 'he broke off at all — against the old code he pressed on and died');
  const lagTicks = r.brokeAt - r.crossedAt;
  assert.ok(lagTicks >= 0 && lagTicks <= 2,
    `he leaves on the crossing tick, not at the next pass (lag ${lagTicks} ticks = ${(lagTicks / 60).toFixed(3)} s)`);
  // A ~6 s pass cycle at 60 Hz is ~360 ticks; anything of that order is the defect.
  assert.ok(lagTicks < 30, 'and nowhere near a pass cycle');
});

test('…and if the fire then stops, he survives — which is the whole point of leaving', () => {
  const r = underFire({ startFrac: 0.30, stopAfterRetreat: true });
  assert.equal(r.alive, true, 'still in world.allies');
  assert.ok(r.a.hp > 0, `and still has hull (${r.a.hp.toFixed(1)} HP)`);
  assert.equal(r.a.retreating, true, 'running, and healing while he runs');
  assert.equal(r.a.target, null, 'the charge was dropped mid-pass');
});

test('…but he STILL DIES if it does not stop: this is a chance, not protection', () => {
  const r = underFire({ startFrac: 0.30, stopAfterRetreat: false });
  assert.ok(r.brokeAt != null, 'he tried to leave');
  assert.equal(r.alive, false, 'and was killed anyway — nothing here protects him');
});

test('above the threshold he presses the attack: the break-off is not a general timidity', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  const a = world.allies[0];
  a.warping = false; a.spawnAge = a.spawnDur; a.scale = a.fullScale;
  a.hp = 0.60 * a.maxHp; a._shieldValue = 0;
  const def = world.catalog.enemyShips.find((s) => s.name === 'pirate gunner');
  const e = spawnEnemyInto(world, def);
  e.warping = false; e.spawnAge = e.spawnDur;
  e.pos.set(0, BULLET_PLANE_Y, 40);
  a.pos.set(0, BULLET_PLANE_Y, 0); a.heading = 0;
  world.player.pos.set(0, BULLET_PLANE_Y, -300);
  for (let i = 0; i < 300; i++) stepAlly(world, SIM_DT);
  assert.equal(a.retreating, false, 'at 60 % hull he stays in the fight');
  assert.equal(a.target, e, 'and keeps his target');
});
