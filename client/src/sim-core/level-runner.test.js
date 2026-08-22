// WHEN a mission pays out, and what "won" still means.
//
// A mission used to end in one moment: you docked at the station, and only then did the credits double and
// the XP bonus land. That coupled the reward to a MOUSE CLICK — the docking autopilot is engaged by one —
// which is why no host without a mouse could ever conclude a mission, and why the flight home was a stake
// that could take a whole cleared level away from you. DECISIONS §130 split it in two:
//
//   cleared — the win condition holds. THE REWARD IS DECIDED HERE.
//   finishing — the player pressed "Finish and Return": salvage swept, advance committed, flying home. (§133)
//   won       — the ship arrived. The mission is closed. Nothing is earned.
//
// The four tests about WHEN the payout happens were negative-tested by moving the reward back into
// `winLevel`; all four fail there. The rest cover the `winCondition` data and API, which did not exist
// before at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './world.js';
import { startLevel, updateLevelRunner, clearMission, finishMission, checkArrival, winLevel,
         winConditionMet, winConditionOf, DEFAULT_WIN_CONDITION } from './level-runner.js';
import { LEVELS } from '../../../server/src/catalog_seed.js';

const DT = 1 / 60;

// A world parked at the level's LAST phase — the `event: 'win'` one — with the arena already empty, which
// is the state every shipped level reaches (each one's final combat phase advances on `allCleared`).
function atWinPhase({ level = 'level-2', earned = 100, earnedXp = 40 } = {}) {
  const descriptor = LEVELS.find((l) => l.name === level).descriptor;
  const world = createWorld({});
  world.catalog = { level: descriptor, levelName: level, shipByName: new Map() };
  world.station = { pos: { x: 0, y: 0, z: 0 }, active: false };
  world.player = { alive: true, pos: { x: 0, y: 0, z: 0 } };
  startLevel(world, descriptor);
  world.levelRunner.phaseIndex = descriptor.phases.length - 1;   // the win phase
  world.levelRunner.winPending = descriptor.phases[descriptor.phases.length - 1].delay ?? 0;
  world.earned = earned; world.earnedXp = earnedXp; world.kills = 17;
  world.events.clear();
  return { world, descriptor };
}

const drain = (world) => { const out = []; world.events.drain((e) => out.push(e)); return out; };

// ---------- the win condition ----------

test('every shipped level and side mission asks for allEnemiesDead, explicitly', async () => {
  for (const l of LEVELS) {
    assert.deepEqual(l.descriptor.winCondition, { type: 'allEnemiesDead' }, `${l.name} states its condition`);
  }
  const { generateMissions } = await import('../../../server/src/missions.js');
  for (const m of generateMissions()) assert.deepEqual(m.descriptor.winCondition, { type: 'allEnemiesDead' });
});

test('a descriptor with no winCondition behaves exactly as one that asks for allEnemiesDead', () => {
  assert.deepEqual(winConditionOf({ phases: [] }), DEFAULT_WIN_CONDITION);
  assert.deepEqual(winConditionOf(null), DEFAULT_WIN_CONDITION);
  assert.deepEqual(winConditionOf({ winCondition: { type: 'survive' } }), { type: 'survive' });
});

test('allEnemiesDead means the arena is empty — and an unreadable condition can NEVER be met', () => {
  const { world } = atWinPhase();
  world.enemies = [{ alive: true }];
  assert.equal(winConditionMet(world), false, 'a live enemy holds the payout');
  world.enemies = [];
  assert.equal(winConditionMet(world), true);
  // Never pay out on a rule we cannot read: a future condition type must be implemented, not assumed.
  world.levelRunner.level = { ...world.levelRunner.level, winCondition: { type: 'escortTheFreighter' } };
  assert.equal(winConditionMet(world), false);
});

// ---------- the reward moment ----------

test('the reward lands when the condition holds, before the player ends anything', () => {
  const { world, descriptor } = atWinPhase({ earned: 100, earnedXp: 40 });
  // run out the boss-explosion delay
  for (let i = 0; i < Math.ceil((descriptor.phases.at(-1).delay ?? 0) / DT) + 1; i++) updateLevelRunner(world, DT);

  assert.equal(world.levelRunner.cleared, true, 'the mission is cleared');
  assert.equal(world.levelRunner.won, false, 'and NOT won — nobody has docked');
  assert.equal(world.earned, 200, 'credits doubled');
  assert.equal(world.earnedXp, 40 + descriptor.xpReward, "plus the level's one-shot XP bonus");
  assert.equal(world.returnToBase, true, 'and the sector is free to wander');

  const ev = drain(world).find((e) => e.type === 'cleared');
  assert.ok(ev, 'a `cleared` event went out for the host to bank');
  assert.deepEqual({ credits: ev.credits, xp: ev.xp, kills: ev.kills },
    { credits: 200, xp: 40 + descriptor.xpReward, kills: 17 });
});

test('ending the mission earns NOTHING — the pre-§130 doubling is gone from winLevel', () => {
  const { world } = atWinPhase();
  clearMission(world);
  const afterClear = { earned: world.earned, xp: world.earnedXp };
  drain(world);

  winLevel(world);
  assert.equal(world.levelRunner.won, true);
  assert.equal(world.earned, afterClear.earned, 'docking does not double anything a second time');
  assert.equal(world.earnedXp, afterClear.xp);
  assert.equal(world.returnToBase, false, 'the arrow + hint are torn down');
  assert.equal(world.station.active, false);
  const types = drain(world).map((e) => e.type);
  assert.deepEqual(types, ['win'], 'only the overlay event — no second payout');
});

// THE behaviour change players will feel: flying home stops being a stake.
test('being shot down in the cleared sector keeps the reward', () => {
  const { world, descriptor } = atWinPhase({ earned: 100, earnedXp: 40 });
  clearMission(world);

  world.player.alive = false;                 // killed while picking over the cleared sector
  updateLevelRunner(world, DT);

  // Asserted against the ABSOLUTE figures, not against "whatever it was a moment ago": the pre-§130 runner
  // also leaves `earned` untouched on the way home — it just never granted anything in the first place.
  assert.equal(world.earned, 200, 'the doubled credits survive dying before the dock');
  assert.equal(world.earnedXp, 40 + descriptor.xpReward, 'and so does the mission XP bonus');
  assert.equal(world.levelRunner.cleared, true);
  assert.equal(world.levelRunner.won, false, 'the mission was never closed, but it was paid');
});

test('the payout happens exactly once, however often the runner asks', () => {
  const { world } = atWinPhase({ earned: 100, earnedXp: 40 });
  clearMission(world); clearMission(world);
  for (let i = 0; i < 30; i++) updateLevelRunner(world, DT);
  assert.equal(world.earned, 200, 'still doubled once');
  const cleared = drain(world).filter((e) => e.type === 'cleared');
  assert.equal(cleared.length, 1, 'and ONE `cleared` event, so a host cannot bank the run twice');
});

test('a condition that does not hold yet withholds the reward, and the runner keeps asking', () => {
  const { world, descriptor } = atWinPhase({ earned: 100 });
  world.enemies = [{ alive: true }];           // a straggler nothing in the script accounts for
  for (let i = 0; i < Math.ceil((descriptor.phases.at(-1).delay ?? 0) / DT) + 10; i++) updateLevelRunner(world, DT);
  assert.equal(world.levelRunner.cleared, false, 'no payout while the condition fails');
  assert.equal(world.earned, 100, 'and nothing doubled');

  world.enemies = [];                          // it dies
  updateLevelRunner(world, DT);
  assert.equal(world.levelRunner.cleared, true, 'the runner was still asking, so it pays now');
  assert.equal(world.earned, 200);
});

test('a fresh run clears the cleared flag — a second mission must be payable', () => {
  const { world, descriptor } = atWinPhase();
  clearMission(world);
  assert.equal(world.levelRunner.cleared, true);
  startLevel(world, descriptor);
  assert.equal(world.levelRunner.cleared, false);
  assert.equal(world.levelRunner.won, false);
});

// ---------- Ending it is the player's call, and only theirs (DECISIONS §132) ----------

test('a cleared mission stays open until the player ends it', () => {
  const { world, descriptor } = atWinPhase();
  for (let i = 0; i < Math.ceil((descriptor.phases.at(-1).delay ?? 0) / DT) + 600; i++) updateLevelRunner(world, DT);
  assert.equal(world.levelRunner.cleared, true);
  assert.equal(world.levelRunner.won, false, 'ten seconds of quiet later it is STILL open — nothing ends it on its own');
});

test('finishMission settles the run and FLIES HOME — it does not close it on the spot', () => {
  const { world } = atWinPhase();
  world.levelRunner.winPending = 99;             // still mid-fight as far as the runner is concerned
  world.enemies = [{ alive: true }];
  assert.equal(finishMission(world), false, 'no walking out of a live fight');
  assert.equal(world.autopilot.active, false, 'and no quiet exit flight either');

  world.enemies = [];
  clearMission(world);
  world.events.drain(() => {});
  assert.equal(finishMission(world), true);
  assert.equal(world.levelRunner.finishing, true, 'settled');
  assert.equal(world.levelRunner.won, false, 'but NOT closed — the ship has to get home first (§133)');
  assert.equal(world.autopilot.active, true, 'the autopilot is taking it there');
  assert.equal(world.autopilot.target.kind, 'station');
  const evs = drain(world).map((e) => e.type);
  assert.ok(evs.includes('finishing'), 'and the host is told to commit the campaign advance NOW');
  assert.equal(finishMission(world), false, 'it cannot be pressed twice');
});

test('ending the mission sweeps the field — including a crate no ship could have reached', () => {
  const { world } = atWinPhase();
  clearMission(world);
  const before = world.pendingLoot.length;
  world.drops.push({ pos: { x: 5000, y: 0.8, z: 5000 }, item: { kind: 'weapon', refId: 5 },
                     weight: 1, inRange: 0, special: false, alive: true });
  // The cosmetic reward crate deposits nothing — its real copy is installed server-side — and must not
  // start doing so just because the sweep collects it.
  world.drops.push({ pos: { x: 10, y: 0.8, z: 10 }, item: { kind: 'component', refId: 12 },
                     weight: 1, inRange: 0, special: true, alive: true });

  finishMission(world);
  assert.equal(world.drops.length, 0, 'the field is empty');
  assert.equal(world.pendingLoot.length, before + 1, 'the ordinary crate banked, the special one did not');
});

test('a cleared sector lifts the bounds AND opens the station — flying home is the other way out', () => {
  const { world } = atWinPhase();
  clearMission(world);
  assert.equal(world.returnToBase, true, 'the out-of-bounds warp lifts, so the pilot may wander');
  assert.equal(world.station.active, true, 'and the station is clickable — docking still ends the mission');
});

// The two routes must not drift apart: a player who never presses the button and just flies home has to end
// up with exactly the world the button would have produced.
test('docking without pressing the button settles AND closes it, identically', () => {
  const byDock = atWinPhase({ earned: 100, earnedXp: 40 }).world;
  const byButton = atWinPhase({ earned: 100, earnedXp: 40 }).world;
  for (const w of [byDock, byButton]) {
    clearMission(w);
    w.drops.push({ pos: { x: 3000, y: 0.8, z: 3000 }, item: { kind: 'weapon', refId: 5 },
                   weight: 1, inRange: 0, special: false, alive: true });
  }

  // The button settles it and starts the flight; park it home and let arrival close it.
  finishMission(byButton);
  byButton.player.pos.x = byButton.station.pos.x; byButton.player.pos.z = byButton.station.pos.z;
  checkArrival(byButton);

  // The other never presses anything — it just flies home manually and docks.
  byDock.player.pos.x = byDock.station.pos.x; byDock.player.pos.z = byDock.station.pos.z;
  byDock.autopilot.active = true; byDock.autopilot.target = { kind: 'station' };
  checkArrival(byDock);

  assert.equal(byDock.levelRunner.won, true, 'docking closed it');
  assert.equal(byButton.levelRunner.won, true, 'so did the button plus the trip');
  assert.equal(byDock.earned, byButton.earned, 'and both are worth the same');
  assert.equal(byDock.earnedXp, byButton.earnedXp);
  assert.deepEqual(byDock.pendingLoot, byButton.pendingLoot, 'docking sweeps the field too');
  assert.equal(byDock.drops.length, 0);
});

test('proximity alone never ends a mission — the autopilot has to be flying you IN', () => {
  const { world } = atWinPhase();
  clearMission(world);
  world.player.pos.x = world.station.pos.x; world.player.pos.z = world.station.pos.z; // parked on top of it
  world.autopilot.active = false;                                                      // …but flown manually
  checkArrival(world);
  assert.equal(world.levelRunner.won, false, 'drifting through the station is not docking');

  world.autopilot.active = true; world.autopilot.target = { kind: 'drop' };  // a chest-aimed autopilot
  checkArrival(world);
  assert.equal(world.levelRunner.won, false, 'and neither is arriving at a crate that happens to be here');
});

test('docking before the sector is cleared does nothing at all', () => {
  const { world } = atWinPhase();
  world.enemies = [{ alive: true }];
  world.player.pos.x = world.station.pos.x; world.player.pos.z = world.station.pos.z;
  world.autopilot.active = true; world.autopilot.target = { kind: 'station' };
  checkArrival(world);
  assert.equal(world.levelRunner.won, false, 'completeMission refuses, so the approach lands on nothing');
  assert.equal(world.levelRunner.cleared, false);
});
