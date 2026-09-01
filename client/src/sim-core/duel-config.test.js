// The duel room's descriptor transform, and the ANCHOR the duel referee compares at.
//
// `withDuelRoom` itself is covered nine ways over in `client/src/duel-dev.test.js`, which reaches it
// through the re-export — the move into sim-core is supposed to have changed nothing, and that suite
// passing unedited is the proof. What is new here is `duelAnchorReached`, and the reason it is not simply
// "is the mission over": a mission ends TWICE (DECISIONS §130), and only the FIRST ending is reachable by a
// headless referee. `won` needs a mouse click and a dock, which an input trace cannot carry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDuelRoom, DUEL_PHASES, duelAnchorReached } from './duel-config.js';
import { winConditionOf, shouldAdvance } from './level-runner.js';
import { ACE_COUNT_MAX } from './ace.js';

// A level-shaped fixture, not the real descriptor: this file lives in sim-core and must not reach out to
// the server's catalog seed. `duel-dev.test.js` runs the same transform against the real Level 1.
const baseLevel = () => ({
  map: 'map-1', center: [0, 0], enemyTotal: 12, xpReward: 500, finalStageBanner: true,
  briefing: 'Clear the sector', lastKillDrop: { kind: 'weapon', refId: 4 }, intro: { lines: [] },
  phases: [{ name: 'wave-1', spawn: {} }, { name: 'wave-2', spawn: {} }, { name: 'victory', event: 'win' }],
});

const worldAt = ({ cleared = false, alive = true } = {}) =>
  ({ levelRunner: { cleared }, player: { alive } });

test('duelAnchorReached: a live fight is NOT the anchor', () => {
  assert.equal(duelAnchorReached(worldAt()), false);
});

test('duelAnchorReached: the instant levelRunner.cleared flips, the fight has settled', () => {
  const w = worldAt();
  assert.equal(duelAnchorReached(w), false);
  w.levelRunner.cleared = true;
  assert.equal(duelAnchorReached(w), true, 'cleared is decided inside sim-core — both hosts reach it alike');
});

test('duelAnchorReached: a dead player is the other anchor, and both together still count once', () => {
  assert.equal(duelAnchorReached(worldAt({ alive: false })), true);
  assert.equal(duelAnchorReached(worldAt({ cleared: true, alive: false })), true);
});

// The anchor deliberately does NOT read `won`/`returningToBase`: those need the "Finish and Return" click
// and the dock at the station, neither of which is in an input trace (DECISIONS §129). Reading them would
// mark every honest winning duel `disagree`.
test('duelAnchorReached ignores the SECOND ending — a won, docking world is anchored by `cleared` alone', () => {
  const w = { levelRunner: { cleared: false, won: true, returningToBase: true }, player: { alive: true } };
  assert.equal(duelAnchorReached(w), false, 'winning without clearing is not a thing the sim can produce alone');
  w.levelRunner.cleared = true;
  assert.equal(duelAnchorReached(w), true);
});

// The smoke test that the move into sim-core changed nothing about the room itself.
test('withDuelRoom still produces a level the runner can play to the end', () => {
  const base = baseLevel();
  const room = withDuelRoom(base, 2);
  assert.equal(room.map, base.map, 'fought in a real place, with the level scenery');
  assert.equal(room.enemyTotal, 2);
  assert.equal(room.xpReward, 0);
  assert.equal(room.lastKillDrop, undefined,
    'and no last-kill drop — which is what keeps the loot roll a single seeded draw (referee §3.3)');
  assert.deepEqual(room.phases, DUEL_PHASES(2));
  assert.equal(winConditionOf(room).type, 'allEnemiesDead');
  const world = { levelRunner: { spawnedThisPhase: 0 }, enemies: [{}, {}], kills: 0 };
  assert.equal(shouldAdvance(world, room.phases[0]), false, 'two aces alive → the fight is on');
  world.enemies = [];
  assert.equal(shouldAdvance(world, room.phases[0]), true, 'both dead → the win phase');
  assert.notEqual(room.phases, base.phases, 'a NEW array — the seed descriptor must not be mutated');
  assert.equal(base.phases.length, 3, 'and the level it was built from still has its own script');
});

test('withDuelRoom clamps the ace count at both ends', () => {
  assert.equal(withDuelRoom(baseLevel(), 99).phases[0].aces, ACE_COUNT_MAX);
  assert.equal(withDuelRoom(baseLevel(), 0).phases[0].aces, 1);
  assert.equal(withDuelRoom(null, 2), null, 'and a missing descriptor is handed straight back');
});
