import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelEnemyTotal, isLastKillDrop, simulateLevel } from './level-sim.js';

test('isLastKillDrop fires only when kills exactly reaches a positive enemyTotal', () => {
  assert.equal(isLastKillDrop({ kills: 13, enemyTotal: 14 }), false);
  assert.equal(isLastKillDrop({ kills: 14, enemyTotal: 14 }), true);
  assert.equal(isLastKillDrop({ kills: 0, enemyTotal: 0 }), false); // no total known → never
});

// Level-shaped phase scripts (mirror catalog_seed.js / missions.js; totals verified by the server test).
const L1 = [
  { spawn: { maxConcurrent: 3, total: 6 }, advanceWhen: { kills: 6 } },
  { spawn: { maxConcurrent: 3, total: 6 }, advanceWhen: { kills: 12 } },
  { spawn: { maxConcurrent: 4, total: 2 }, advanceWhen: { allCleared: true } },
  { event: 'win' },
];
const L2 = [
  { spawn: { maxConcurrent: 4, total: 5 }, advanceWhen: { kills: 5 } },
  { spawn: { maxConcurrent: 4, total: 7 }, advanceWhen: { kills: 12 } },
  { spawn: { maxConcurrent: 4, total: 4 }, advanceWhen: { allCleared: true } },
  { spawn: { maxConcurrent: 1, total: 1 }, advanceWhen: { allCleared: true } },
  { event: 'win' },
];
// NOTE: use the REAL maxConcurrent so every threshold phase is the mc < total shape (e.g. 4 < 8) — that's
// the deadlock-risk case the sim must clear (a phase must spawn more than one wave-worth without the gate
// or advance stalling). Keep these arrays mirrored with catalog_seed.js / missions.js.
const L3 = [
  { spawn: { maxConcurrent: 4, total: 8 }, advanceWhen: { kills: 8 } },
  { spawn: { maxConcurrent: 4, total: 8 }, advanceWhen: { kills: 16 } },
  { spawn: { maxConcurrent: 4, total: 4 }, advanceWhen: { allCleared: true } },
  { spawn: { maxConcurrent: 1, total: 1 }, advanceWhen: { allCleared: true } },
  { event: 'win' },
];
const L4 = [
  { spawn: { maxConcurrent: 5, total: 8 }, advanceWhen: { kills: 8 } },
  { spawn: { maxConcurrent: 5, total: 8 }, advanceWhen: { kills: 16 } },
  { spawn: { maxConcurrent: 5, total: 5 }, advanceWhen: { allCleared: true } },
  { spawn: { maxConcurrent: 1, total: 1 }, advanceWhen: { allCleared: true } },
  { event: 'win' },
];
const SIDE = [
  { spawn: { maxConcurrent: 4, total: 7 }, advanceWhen: { kills: 7 } },
  { spawn: { maxConcurrent: 4, total: 7 }, advanceWhen: { kills: 14 } },
  { spawn: { maxConcurrent: 4, total: 4 }, advanceWhen: { allCleared: true } },
  { spawn: { maxConcurrent: 4, total: 2 }, advanceWhen: { allCleared: true } },
  { event: 'win' },
];

for (const [name, phases, total] of [['L1', L1, 14], ['L2', L2, 17], ['L3', L3, 21], ['L4', L4, 22], ['SIDE', SIDE, 20]]) {
  test(`${name}: staggered runner reaches enemyTotal exactly and the drop fires on the last kill`, () => {
    assert.equal(levelEnemyTotal(phases), total, 'summed enemyTotal');
    const r = simulateLevel(phases);
    assert.equal(r.totalKills, total, 'destroyed counter reaches enemyTotal exactly');   // (a)
    assert.equal(r.dropKill, total, 'last-kill reward drop fires on the final kill');     // (b)
  });
}
