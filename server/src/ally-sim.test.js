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
import { stepAlly } from '../../client/src/sim-core/step-ally.js';
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
