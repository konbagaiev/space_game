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
import { simRandomDraws, seedSim } from '../../client/src/sim-core/sim-random.js';
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
import { stepBullets, stepRockets } from '../../client/src/sim-core/step-projectiles.js';
import { spawnRocket } from '../../client/src/sim-core/spawn.js';
import { segmentHitsShip, broadRadius } from '../../client/src/sim-core/collision.js';
import { makeAlly } from '../../client/src/sim-core/ally.js';
import { perceivedBearing, clearAimTarget } from '../../client/src/sim-core/step-ally.js';
import {
  ALLY_AIM_HIT_FRAC, ALLY_FIRE_BLOCK_HALF_ANGLE, ALLY_AIM_MAX, ALLY_AIM_KICK, ALLY_AIM_JITTER,
  ALLY_AIM_TAU_SEC,
} from '../../client/src/sim-core/ally-config.js';
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
  // THE AIM ERROR CANNOT REACH THIS, and the margin is recorded so the next reader does not re-derive it:
  // at this fixture's 30 u the pilot's total error is capped at
  // ALLY_AIM_MAX × (ALLY_AIM_HIT_FRAC × broadRadius) / 30 rad, far inside the 0.35 rad block cone, so the
  // nose can never swing out of it.
  const errCap = ALLY_AIM_MAX * (ALLY_AIM_HIT_FRAC * broadRadius(target)) / 30;
  assert.ok(errCap < 0.5 * ALLY_FIRE_BLOCK_HALF_ANGLE,
    `the aim error (±${errCap.toFixed(3)} rad) is nowhere near the ${ALLY_FIRE_BLOCK_HALF_ANGLE} rad block cone`);
});

test('§2.6 is judged on the REAL path, so the live aim error cannot walk a shot into the player', () => {
  // The gate compares the projectile's actual path to the line to the player — not the perceived bearing —
  // so perturbing where he THINKS the enemy is cannot loosen it. Here the player sits 12 u out, well off the
  // firing line but nearer than the target: he fires, and every shot he fires is clear of the player.
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  const a = world.allies[0];
  a.warping = false; a.spawnAge = a.spawnDur; a.scale = a.fullScale;
  const def = world.catalog.enemyShips.find((sh) => sh.name === 'pirate gunner');
  const target = spawnEnemyInto(world, def);
  target.warping = false; target.spawnAge = target.spawnDur; target.scale = target.fullScale;
  const OFF = 0.8;                                 // radians off the firing line — outside the 0.35 cone
  seedSim(31);
  const seen = new Set();
  let fired = 0;
  for (let i = 0; i < 60 * 10; i++) {
    a.pos.set(0, BULLET_PLANE_Y, 0); a.vel.set(0, 0, 0);
    target.pos.set(0, BULLET_PLANE_Y, 40);
    world.player.pos.set(Math.sin(OFF) * 12, BULLET_PLANE_Y, Math.cos(OFF) * 12);
    target.hp = target.maxHp;                      // keep him shooting at a live ship
    stepAlly(world, SIM_DT);
    for (const b of world.bullets) {
      if (seen.has(b)) continue;
      seen.add(b); fired++;
      const path = Math.atan2(b.vel.x, b.vel.z);
      const toPlayer = Math.atan2(world.player.pos.x - a.pos.x, world.player.pos.z - a.pos.z);
      const off = Math.abs(Math.atan2(Math.sin(path - toPlayer), Math.cos(path - toPlayer)));
      assert.ok(off > ALLY_FIRE_BLOCK_HALF_ANGLE,
        `a shot he fired passes ${off.toFixed(3)} rad from the player — inside the §2.6 cone`);
    }
    stepBullets(world, SIM_DT);
  }
  seedSim(null);
  assert.ok(fired > 5, `and he really was shooting (${fired} rounds)`);
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
  // AND IT IS NOW ALSO A GUARD ON THE SETTLED-LANDS GUARANTEE. The pilot carries a human tracking error,
  // so this only stays true because a settled solution still connects (ally-config.js: the standing jitter
  // is 0.245 of broadRadius against a measured narrowest hit half-width of 0.373). The 8 s window is ~13
  // shots and only the first can be lost to the acquisition kick. The seed is installed explicitly, because
  // `seedSim` is process-global and `pilotRandom` reads it lazily — without this line the seed some earlier
  // test left behind would decide the outcome, and test ORDER would be a hidden input.
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  seedSim(11);   // AFTER createSimWorld, which installs its own seed (sim-host.js) and would overwrite it
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
  seedSim(null);
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
    // A TEST ABOUT A GATE PINS THE AIM ERROR TO ZERO. This is required, not cosmetic: at this fixture's
    // 40 u the pilot's human tracking error reaches ±0.109 rad (ALLY_AIM_MAX × (0.35 × 4.153)/40, the figure
    // ally-config.js derives), and the ROCKET case below turns on the nose sitting 0.48 − 0.40 = 0.08 rad
    // clear of the rocket's aimTol — so the error is MORE than enough to flip it at random.
    // `Infinity` on the timer also suppresses the lazy first roll (step-ally.js `perceivedBearing`).
    a._aimJitter = 0; a._aimKick = 0; a._aimJitterT = Infinity;
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

test('the ROCKET is gated on ITS OWN PATH (the nose), not on the gun\'s drift-corrected line', () => {
  // At full drift the nose sits ~0.48 rad off the bearing the pilot is aiming at — outside the rocket's own
  // 0.40 aimTol. A gate that compared the nose to the CORRECTED aim would read ~0 and launch it wildly off
  // that bearing while reporting "aligned", which is what the round-1 comment claimed was not happening.
  // (The bearing the gate compares against is the PERCEIVED one since the pilot got a human aim; here the
  // error is pinned to zero by `driftFireCase`, so the two coincide and this test is about the PATH.)
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

// ---------- THE HUMAN AIM, MEASURED AS AN OUTCOME (real catalog, real bullets) ----------
//
// `client/src/sim-core/step-ally.test.js` pins the aim ANGLE against `thetaHit`. Everything there could
// pass while the game misses settled shots, because the thing a bullet has to hit is a per-part OBB at the
// bullet plane, not an angle. These three run the real projectile step against real hulls.
//
// `seedSim` is PROCESS-GLOBAL and `pilotRandom` reads it lazily, so every test here installs its own seed
// before the first step and aggregates over several of them — otherwise test ORDER would be a hidden input.

// One settled firing solution against one hull at one ASPECT. The pilot is pinned (only the aim is under
// test), the target is held at 30 u on a fixed heading, and the ROCKET group is removed: a homing rocket
// corrects its own aim afterwards and would mask exactly what this measures. Drift is deliberately ZERO —
// `aimWithDrift` is pinned elsewhere, and the muzzle parallax it leaves behind (uncorrected by design, see
// step-ally.js) is not this feature's budget.
function settledFire({ enemyName, targetHeading, seeds = 10, settle = 120, observe = 60 * 8 }) {
  let fired = 0, hits = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
    // AFTER `createSimWorld`, which installs its OWN seed (sim-host.js) and would otherwise overwrite this
    // one — the pilot's private stream is keyed off whatever is installed when it first draws.
    seedSim(seed);
    const a = world.allies[0];
    a.warping = false; a.spawnAge = a.spawnDur; a.scale = a.fullScale;
    delete a.groups.rocket;
    const def = world.catalog.enemyShips.find((sh) => sh.name === enemyName);
    const target = spawnEnemyInto(world, def);
    target.warping = false; target.spawnAge = target.spawnDur; target.scale = target.fullScale;
    world.player.pos.set(0, BULLET_PLANE_Y, -300);   // far behind: the §2.6 gate is not the variable
    const shield0 = target._shieldValue;
    const seen = new Set();
    const pin = () => {
      a.pos.set(0, BULLET_PLANE_Y, 0); a.vel.set(0, 0, 0);
      target.pos.set(0, BULLET_PLANE_Y, 30); target.vel.set(0, 0, 0); target.heading = targetHeading;
    };
    const resolve = (counting) => {
      const before = target.hp + target._shieldValue;
      stepBullets(world, SIM_DT);
      if (counting && target.hp + target._shieldValue < before) hits++;
      target.hp = target.maxHp; target._shieldValue = shield0;   // he must not kill it and lose the window
    };
    for (let i = 0; i < settle; i++) { pin(); stepAlly(world, SIM_DT); resolve(false); }
    world.bullets.length = 0;                       // the acquisition kick is a separate rule (§153)
    for (let i = 0; i < observe; i++) {
      pin();
      stepAlly(world, SIM_DT);
      for (const b of world.bullets) if (!seen.has(b)) { seen.add(b); fired++; }
      resolve(true);
    }
    // DRAIN: stop firing and let the rounds already in flight arrive, or the last one or two would be
    // counted as fired and never as hits.
    for (let i = 0; i < 60 && world.bullets.length; i++) { pin(); resolve(true); }
    seedSim(null);
  }
  return { fired, hits };
}

test('a SETTLED solution connects with REAL bullets, on the narrow aspect and the wide one alike', () => {
  // THE PROMISE THIS FEATURE IS NOT ALLOWED TO BREAK, measured rather than reasoned about. The first case
  // is the pirate gunner at its NARROWEST heading; the third is the `advanced medium pirate`, the hull that
  // BINDS `ALLY_AIM_HIT_FRAC` at 0.373 of broadRadius — the worst case the promise has to survive. This is
  // the test that fails if the yardstick ever regresses to `broadRadius` itself.
  for (const cas of [
    { enemyName: 'pirate gunner', targetHeading: 0.46, what: 'the narrowest aspect of a pirate gunner' },
    { enemyName: 'pirate gunner', targetHeading: 1.57, what: 'its widest' },
    { enemyName: 'advanced medium pirate', targetHeading: 0.24, what: 'the hull that binds ALLY_AIM_HIT_FRAC' },
  ]) {
    const r = settledFire(cas);
    assert.ok(r.fired >= 60, `he really was shooting at ${cas.what} (${r.fired} rounds over 10 seeds)`);
    assert.equal(r.hits, r.fired, `EVERY settled shot connects with ${cas.what} (${r.hits}/${r.fired})`);
  }
});

test('POINT DEFENCE in a CLOSING engagement: ~50 % per shot, and most rockets still die', () => {
  // Not a rocket parked at a fixed range: a real homing Rocket spawned at the 45 u engagement band and
  // closing, run to resolution. The per-shot rate is what the closing-geometry correction buys — the
  // tolerance is measured where the bullet MEETS the rocket (0.64-0.84 of the range the error was computed
  // at), so the 50 % is independent of how fast the rocket is coming (ally-config.js).
  const SEEDS = 40;
  let fired = 0, killed = 0, engaged = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
    seedSim(seed);                                   // after createSimWorld, which installs its own seed
    const a = world.allies[0];
    a.warping = false; a.spawnAge = a.spawnDur; a.scale = a.fullScale;
    a.pos.set(0, BULLET_PLANE_Y, 0); a.vel.set(0, 0, 0); a.heading = 0;   // nose on +Z
    world.enemies.length = 0;                        // nothing to charge → point defence is free to acquire
    world.player.pos.set(0, BULLET_PLANE_Y, -20);
    const wep = world.catalog.weapons.get(3);        // Rocket (homing)
    // 30° OFF THE NOSE, at the 45 u engagement band, flying straight at him. Off-nose on purpose: a rocket
    // the nose is ALREADY exactly on is a degenerate case — the gun is cold, the fire gate passes on the
    // first tick and the shot leaves before the nose has swung onto the perturbed aim at all, which
    // measures nothing. A real acquisition comes from the flank, as the duel-room tests also model it.
    const from = new Vec3(Math.sin(0.52) * 45, BULLET_PLANE_Y, Math.cos(0.52) * 45);
    const rocket = spawnRocket(world, from, new Vec3(-from.x, 0, -from.z).normalize(),
                               wep, wep.accel, false, a)[0];
    engaged++;
    const seen = new Set();
    for (let i = 0; i < 60 * 8 && world.rockets.includes(rocket); i++) {
      a.pos.set(0, BULLET_PLANE_Y, 0); a.vel.set(0, 0, 0);   // pinned: the intercept is the only variable
      stepAlly(world, SIM_DT);
      for (const b of world.bullets) if (!seen.has(b)) { seen.add(b); fired++; }
      stepBullets(world, SIM_DT);
      stepRockets(world, SIM_DT);
    }
    // SHOT DOWN, not merely gone: only an intercepting bullet takes a rocket's hp down.
    if (rocket.hp <= 0) killed++;
    seedSim(null);
  }
  // MEASURED: 93 shots over 40 engagements, 35 rockets shot down — 0.376 kills per shot and 0.88 per
  // rocket. The per-shot figure sits BELOW the formula's 0.50 and that is honest rather than a defect: the
  // fire gate opens as soon as the shot is within the group's 0.25 rad `aimTol`, so a round can leave while
  // the nose is still swinging onto the perturbed aim. The dispersion is the dominant term (before it, this
  // fixture's rockets died to the first shot every time) but it is not the only one.
  const perShot = killed / fired;
  assert.ok(fired > SEEDS, `he spends more than one round per rocket (${fired} over ${SEEDS} engagements)`);
  assert.ok(perShot >= 0.35 && perShot <= 0.65,
    `about half his intercept shots connect (${perShot.toFixed(3)} kills per shot, design point 0.50)`);
  const perRocket = killed / engaged;
  assert.ok(perRocket >= 0.55 && perRocket <= 0.95,
    `and most closing rockets still die (${killed}/${engaged} = ${perRocket.toFixed(2)}, design point 0.75-0.88)`);
});

// THE YARDSTICK GUARD. `ALLY_AIM_HIT_FRAC` is a claim about geometry that lives in a config file, and
// nothing else in the codebase would notice if a re-exported model, a new `lift`, a new enemy row or a
// re-scaled hull made it false — every other test would stay green while "a settled solution lands" quietly
// stopped being true. So it is re-measured here, on every run, exactly as it was derived.
//
// The measurement is the CONTIGUOUS hit half-width at the bullet plane: sweep a `segmentHitsShip` probe
// laterally past the hull and take the largest offset that still connects BEFORE the first gap, over the
// whole circle of headings. `broadRadius` is only the broad-phase enclosing sphere and overstates a real
// hull by up to 2.7×, which is the trap this closes.
function narrowestHalfWidth(ship, headings = 144, step = 0.05) {
  const limit = broadRadius(ship);          // the enclosing sphere is an upper bound by construction
  const y = BULLET_PLANE_Y;
  ship.pos.set(0, y, 0);
  let worst = Infinity, worstHeading = 0;
  for (let k = 0; k < headings; k++) {
    ship.heading = (k / headings) * Math.PI * 2;
    let contiguous = 0;
    for (let off = step; off <= limit; off += step) {
      const p0 = { x: off, y, z: -limit * 4 }, p1 = { x: off, y, z: limit * 4 };
      if (!segmentHitsShip(ship, p0, p1, 0)) break;
      contiguous = off;
    }
    if (contiguous < worst) { worst = contiguous; worstHeading = ship.heading; }
  }
  return { half: worst, heading: worstHeading };
}

test('THE YARDSTICK: ALLY_AIM_HIT_FRAC is still true of EVERY hull the pilot shoots at', () => {
  const world = createSimWorld({ levelName: 'level-4', seed: 7 });
  // ALL NINE enemy rows, not the ones a given level fields: both `sim-host.js` and `client/src/main.js`
  // build `enemyShips` as `type === 'enemy'` with NO level filter, so every one of them is in scope. A
  // three-hull sample suggests ~0.42 and is wrong — the floor is the `pirate mini boss` /
  // `advanced medium pirate` pair at 0.373.
  const ships = world.catalog.enemyShips.map((def) => {
    const e = spawnEnemyInto(world, def);
    e.warping = false; e.spawnAge = e.spawnDur; e.scale = e.fullScale;
    return { name: def.name, ship: e };
  });
  const sentinel = makeAlly(world.catalog);         // …and the hull both pilots FLY, which an ace shoots at
  sentinel.warping = false; sentinel.scale = sentinel.fullScale;
  ships.push({ name: 'Sentinel hull (Basic player ship)', ship: sentinel });

  const report = [];
  let floor = Infinity;
  for (const { name, ship } of ships) {
    const { half, heading } = narrowestHalfWidth(ship);
    const ratio = half / broadRadius(ship);
    floor = Math.min(floor, ratio);
    report.push(`${name}: ${ratio.toFixed(3)} (${half.toFixed(2)} u at heading ${heading.toFixed(2)})`);
    assert.ok(ALLY_AIM_HIT_FRAC * broadRadius(ship) <= half,
      `ALLY_AIM_HIT_FRAC ${ALLY_AIM_HIT_FRAC} overstates ${name}: `
      + `${(ALLY_AIM_HIT_FRAC * broadRadius(ship)).toFixed(2)} u of yardstick against a ${half.toFixed(2)} u `
      + `hit half-width at heading ${heading.toFixed(2)}.\n  measured: ${report.join('\n            ')}`);
  }
  assert.equal(ships.length, 10, 'nine enemy rows plus the Sentinel hull');
  // The floor is grid-sensitive (0.374 at 1.25° heading steps, 0.378 at 2.5°), which is part of why
  // ALLY_AIM_HIT_FRAC is 0.35 and not 0.37. Recorded so a future tightening is a deliberate act.
  assert.ok(floor > ALLY_AIM_HIT_FRAC,
    `measured floor ${floor.toFixed(3)}:\n  ${report.join('\n  ')}`);
});

// ---------- THE FIRST SHOT, measured against a REAL HULL ----------
//
// THE GAP THIS CLOSES. "The first shot at a newly acquired target misses" is the headline behaviour of the
// pilot's human aim, and until this existed nothing measured it end to end: the settled-lands test above
// deliberately throws the acquisition round away (`world.bullets.length = 0`), and the angle tests in
// `client/src/sim-core/step-ally.test.js` measure the error against the WORST-ASPECT yardstick, which is not
// a miss. A real hull is wider than its worst aspect at almost every heading and its per-part boxes catch a
// round past a gap, so the yardstick figure (currently 56.5 %) is about three times the real rate.
//
// THE MEASUREMENT IS THE MAINTAINER'S OWN DEFINITION: `segmentHitsShip(ship, p0, p1)` with **no pad** — the
// exact swept call `stepBullets` makes to decide whether a round connected — against the real catalog hull,
// swept over the target's headings and over the acquisition-tick error the REAL `perceivedBearing` produces
// (so ALLY_AIM_KICK, ALLY_AIM_JITTER, ALLY_AIM_MAX and ALLY_AIM_HIT_FRAC all genuinely participate, through
// the real pilot entity and its real `broadRadius`). The segment is the bullet's own path: from the shooter,
// down the perceived bearing, past the target.
//
// NOTE WHAT THIS IS NOT. It is the rate the acquisition ERROR produces, which is the number that was tuned.
// The rate a player FEELS is about two points lower — **measured as-actually-fired: 15.9 % / 15.8 % / 17.5 %
// against the three hulls below** — because the fire gate opens as soon as the round is within the group's
// 0.25 rad `aimTol`, so the first round can leave one tick before the nose has reached the kicked bearing.
// That is a property of the gate, not of the aim, and it is recorded in the point-defence test above for the
// same reason. The tuned figure is the one quoted in the docs; this is the one a player experiences.
const FIRST_SHOT_DIST = 30;

function firstShotMissRate({ hull, seeds = 20, headings = 24, reps = 24 }) {
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  const a = world.allies[0];
  a.warping = false; a.spawnAge = a.spawnDur; a.scale = a.fullScale;
  a.pos.set(0, BULLET_PLANE_Y, 0);
  let target;
  if (hull === null) {                       // the Sentinel hull itself: what an ACE shoots at
    target = makeAlly(world.catalog);
    target.warping = false; target.scale = target.fullScale;
  } else {
    const def = world.catalog.enemyShips.find((sh) => sh.name === hull);
    assert.ok(def, `no catalog hull named ${hull}`);
    target = spawnEnemyInto(world, def);
    target.warping = false; target.spawnAge = target.spawnDur; target.scale = target.fullScale;
  }
  target.pos.set(0, BULLET_PLANE_Y, FIRST_SHOT_DIST);
  const trueDir = { x: 0, z: 1 };
  const p0 = { x: 0, y: BULLET_PLANE_Y, z: 0 };
  const p1 = { x: 0, y: BULLET_PLANE_Y, z: 0 };
  let shots = 0, misses = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    seedSim(seed);                           // after createSimWorld, which installs its own (deviation 5)
    for (let h = 0; h < headings; h++) {
      target.heading = (h / headings) * Math.PI * 2;
      for (let rep = 0; rep < reps; rep++) {
        // A FRESH ACQUISITION, exactly as a re-pick or a come-about exit produces one — and force the
        // standing jitter to re-roll on the same tick, so each sample draws an independent (j, k) pair
        // instead of sharing one j for the 48 ticks of ALLY_AIM_JITTER_SEC.
        clearAimTarget(a);
        a._aimJitterT = SIM_DT;
        const seen = perceivedBearing(a, target, trueDir, FIRST_SHOT_DIST, SIM_DT);
        p1.x = seen.x * FIRST_SHOT_DIST * 2;
        p1.z = seen.z * FIRST_SHOT_DIST * 2;
        shots++;
        if (!segmentHitsShip(target, p0, p1, 0)) misses++;
      }
    }
  }
  seedSim(null);
  return { rate: misses / shots, shots };
}

test('THE FIRST SHOT at a freshly acquired target misses ~18 % of the time, against a real hull', () => {
  // THREE HULLS, because the per-hull spread is real (8-20 % across the catalog) and one number would hide
  // it: an ordinary pirate, the hull that BINDS ALLY_AIM_HIT_FRAC, and the Sentinel hull an ace shoots at —
  // which is the surface the maintainer live-tests in `?duel`, and the highest of the three.
  //
  // THE BAND IS [15 %, 25 %], wide enough to survive re-tuning and tight enough to fail on the two ways this
  // silently reverts: at the previous ALLY_AIM_KICK 2.00 these same three hulls measure 11.7 / 12.0 / 13.6 %,
  // all BELOW the floor, and lowering ALLY_AIM_MAX enough to clip the kick pushes them below it too.
  const cases = [
    { hull: 'pirate gunner', what: 'an ordinary pirate' },
    { hull: 'advanced medium pirate', what: 'the hull that binds ALLY_AIM_HIT_FRAC' },
    { hull: null, what: 'the Sentinel hull an ace shoots at' },
  ];
  const rates = [];
  for (const c of cases) {
    const { rate, shots } = firstShotMissRate({ hull: c.hull });
    rates.push(rate);
    assert.ok(shots >= 10000, `enough samples to pin a rate (${shots})`);
    assert.ok(rate >= 0.15 && rate <= 0.25,
      `the first shot at ${c.what} must miss 15-25 % of the time (got ${(rate * 100).toFixed(1)} %, target ~18 %)`);
  }
  const mean = rates.reduce((x, y) => x + y, 0) / rates.length;
  assert.ok(mean >= 0.16 && mean <= 0.22,
    `and the three average ~18 % (got ${(mean * 100).toFixed(1)} %: `
    + `${rates.map((r) => (r * 100).toFixed(1)).join(' / ')} %)`);
});

test('…and the SECOND shot still lands: the kick is capped by one `fireCooldown` of decay', () => {
  // THE CONSTRAINT THAT DECIDES HOW BIG ALLY_AIM_KICK MAY BE, and it is asserted from LIVE inputs on all
  // three sides rather than from literals — which is the whole point of it being here instead of in the
  // client's own copy. `ALLY_AIM_KICK`, `ALLY_AIM_JITTER` and `ALLY_AIM_TAU_SEC` are imported, and the decay
  // COUNT is derived from the gun's real `fireCooldown` off the built ally, read out of the catalog.
  //
  // WHY THAT LAST ONE MATTERS MORE THAN IT LOOKS. The margin is one tick wide. The pilot's rounds leave at
  // ticks 1, 37, 73, 109 — gaps of exactly 36 — so the second shot really gets 37 decays (residual 0.1207,
  // worst case 0.977) and this assertion's 36 is deliberately one tick pessimistic. But at 35 decays the
  // bound is VIOLATED (0.1353 → 1.0111 > 1), so a catalog edit taking weapon 6's `fireCooldown` from 0.6 s
  // to 0.583 s — a single tick — would break "the second shot lands" with every other test still green.
  // `fireCooldown` was the one input no guard read. It is read here now.
  const world = createSimWorld({ levelName: 'level-4', seed: 7, ally: 'wave-1' });
  const gun = world.allies[0].groups.gun;
  const cooldown = gun.mounts[0].weapon.fireCooldown;
  assert.ok(cooldown > 0, `the ally's gun must carry a real fireCooldown (got ${cooldown})`);
  const ticks = Math.round(cooldown / SIM_DT);
  const residual = Math.pow(1 - SIM_DT / ALLY_AIM_TAU_SEC, ticks);
  const worst = ALLY_AIM_KICK * residual + ALLY_AIM_JITTER;
  assert.ok(worst < 1,
    `KICK × ${residual.toFixed(6)} + JITTER must stay inside one hit half-width after one cooldown `
    + `(${cooldown} s = ${ticks} ticks at τ=${ALLY_AIM_TAU_SEC}): got ${worst.toFixed(4)}`);
  // The headroom is recorded rather than asserted: 0.006 at KICK 2.30, where it was 0.045 at KICK 2.00. It
  // is still a PROOF and not a probability, but there is no slack — which is why the three constants and the
  // weapon are all read live above instead of being copied here.
  assert.ok(ALLY_AIM_KICK + ALLY_AIM_JITTER <= ALLY_AIM_MAX + 1e-9,
    `and the kick must not be clipped by ALLY_AIM_MAX (${ALLY_AIM_KICK} + ${ALLY_AIM_JITTER} vs ${ALLY_AIM_MAX})`);
  // THE OTHER PROMISE, untouched by the first-shot tuning: a SETTLED solution still lands every shot.
  assert.ok(ALLY_AIM_JITTER * ALLY_AIM_HIT_FRAC <= 0.373,
    'the standing jitter must stay inside the measured narrowest hit half-width (0.373 of broadRadius)');
});
