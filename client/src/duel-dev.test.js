// ?duel — the sparring room's URL flag and the level it builds.
//
// The two things worth pinning: the flag is OFF unless it is really there (a dev room that leaks into a
// normal page load would change every fight), and the descriptor it produces is a level the runner can
// actually play to the end — one phase that spawns aces, one phase that wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalDuelDev, withDuelRoom, applyDuelDev, duelBuild, DUEL_DEFAULT_LEVEL, DUEL_COMPONENTS } from './duel-dev.js';
import { ACE_COUNT_DEFAULT, ACE_COUNT_MAX } from './sim-core/ace.js';
import { LEVELS } from '../../server/src/catalog_seed.js';
import { winConditionOf, shouldAdvance } from './sim-core/level-runner.js';

test('evalDuelDev: no param, or an explicit off, means off', () => {
  assert.equal(evalDuelDev(''), null);
  assert.equal(evalDuelDev('?debug&level=4'), null, 'a bare level param is not the duel flag');
  assert.equal(evalDuelDev('?duel=0'), null);
  assert.equal(evalDuelDev('?duel=false'), null);
  assert.equal(evalDuelDev('?duel=off'), null);
});

test('evalDuelDev: bare ?duel is two aces on the default level', () => {
  assert.deepEqual(evalDuelDev('?duel'), { count: ACE_COUNT_DEFAULT, level: DUEL_DEFAULT_LEVEL });
  assert.deepEqual(evalDuelDev('?debug&duel&dev'), { count: ACE_COUNT_DEFAULT, level: DUEL_DEFAULT_LEVEL });
});

test('evalDuelDev: ?duel=N names the count, clamped, and a bad number falls back', () => {
  assert.equal(evalDuelDev('?duel=1').count, 1);
  assert.equal(evalDuelDev('?duel=3').count, 3);
  assert.equal(evalDuelDev('?duel=99').count, ACE_COUNT_MAX, 'clamped, never an arena of 99');
  assert.equal(evalDuelDev('?duel=lots').count, ACE_COUNT_DEFAULT);
  assert.equal(evalDuelDev('?duel=-2').count, ACE_COUNT_DEFAULT, 'a nonsense count is the default, never zero aces');
});

test('evalDuelDev: &level= names the level the room is built over', () => {
  assert.deepEqual(evalDuelDev('?duel&level=4'), { count: ACE_COUNT_DEFAULT, level: 'level-4' });
  assert.deepEqual(evalDuelDev('?level=4&duel=3'), { count: 3, level: 'level-4' });
});

test('withDuelRoom: the room is one ace phase and one win phase, over the level it is built on', () => {
  const base = LEVELS.find((l) => l.name === 'level-1').descriptor;
  const room = withDuelRoom(base, 2);
  assert.equal(room.map, base.map, 'the room is fought in a real place, with the level scenery');
  assert.equal(room.enemyTotal, 2, 'the HUD killed/total counts the aces');
  assert.equal(room.xpReward, 0, 'a sparring room grants no mission XP');
  assert.equal(room.phases.length, 2);
  assert.equal(room.phases[0].aces, 2, 'the phase field the level runner reads');
  assert.equal(room.phases[1].event, 'win');
  assert.equal(winConditionOf(room).type, 'allEnemiesDead', 'killing them both ends it');
  assert.notEqual(room.phases, base.phases, 'a NEW array — the seed descriptor must not be mutated');
  assert.equal(base.phases.length > 2, true, 'and the level it was built from still has its own script');
});

test('withDuelRoom: the ace phase advances only once the arena is empty', () => {
  const room = withDuelRoom(LEVELS.find((l) => l.name === 'level-1').descriptor, 2);
  const world = { levelRunner: { spawnedThisPhase: 0 }, enemies: [{}, {}], kills: 0 };
  assert.equal(shouldAdvance(world, room.phases[0]), false, 'two aces alive → the fight is on');
  world.enemies = [];
  assert.equal(shouldAdvance(world, room.phases[0]), true, 'both dead → the win phase');
});

test('withDuelRoom clamps its count the same way the flag does', () => {
  const base = LEVELS.find((l) => l.name === 'level-1').descriptor;
  assert.equal(withDuelRoom(base, 99).phases[0].aces, ACE_COUNT_MAX);
  assert.equal(withDuelRoom(base, 0).phases[0].aces, 1);
});

test('the forced ship is the starter gun plus the basic Repair drone', () => {
  assert.equal(DUEL_COMPONENTS.repair, 12, 'component 12 = Repair drone (catalog_seed.js)');
  assert.equal(DUEL_COMPONENTS.hull, 1, 'and the starter Basic hull, not a bought upgrade');
});

// With no `location` (Node), the module-level flag is off — which is exactly the state a normal page load
// without the param is in, so this is the "changes nothing" guard for both.
test('with the flag off, both wrappers hand the very same object back', () => {
  const descriptor = LEVELS.find((l) => l.name === 'level-1').descriptor;
  assert.equal(applyDuelDev(descriptor), descriptor);
  const build = { ship: {}, loadout: {}, components: {}, skills: null };
  assert.equal(duelBuild(build), build);
});
