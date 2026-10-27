// The duel room's descriptor transform, and the ANCHOR the duel referee compares at.
//
// `withDuelRoom` itself is covered nine ways over in `client/src/duel-dev.test.js`, which reaches it
// through the re-export — the move into sim-core is supposed to have changed nothing, and that suite
// passing unedited is the proof. What is new here is `duelAnchorReached`, and the reason it is not simply
// "is the mission over": a mission ends TWICE (DECISIONS §130), and only the FIRST ending is reachable by a
// headless referee. `won` needs a mouse click and a dock, which an input trace cannot carry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDuelRoom, DUEL_PHASES, duelAnchorReached, DUEL_LOADOUT, DUEL_COMPONENTS, withDuelKit } from './duel-config.js';
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

// THE DUEL KIT (moved here from duel-dev.js with the kit itself). Catalog ids, matching catalog_seed.js.
test('the forced ship is the starter gun plus the basic Repair drone', () => {
  assert.equal(DUEL_COMPONENTS.repair, 12, 'component 12 = Repair drone (catalog_seed.js)');
  assert.equal(DUEL_COMPONENTS.hull, 1, 'and the starter Basic hull, not a bought upgrade');
  assert.deepEqual(DUEL_LOADOUT.mounts.map((m) => m.weapon), [1, 3], 'Basic kinetic + Rocket, as the aces carry');
});

test('withDuelKit forces loadout/components/no skills, keeps the hull, and never mutates its input', () => {
  const ship = { name: 'Scout' };
  const build = { ship, shipId: 2, loadout: { mounts: [{ group: 'gun', weapon: 12 }] }, components: { hull: 7 }, skills: { mobility: 3 } };
  const out = withDuelKit(build);
  assert.notEqual(out, build);
  assert.equal(out.loadout, DUEL_LOADOUT);
  assert.equal(out.components, DUEL_COMPONENTS);
  assert.equal(out.skills, null, 'no skills — the duel is about the flying');
  assert.equal(out.ship, ship, 'the hull you fly is kept');
  assert.equal(out.shipId, 2);
  assert.equal(build.loadout.mounts[0].weapon, 12, 'the input is untouched');
  assert.deepEqual(build.skills, { mobility: 3 });
});
