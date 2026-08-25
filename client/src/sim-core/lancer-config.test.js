// `withLancersAt` — the `?lancer` dev flag's one transform on a level descriptor.
//
// Two things are worth guarding, and one of them is a trap that hangs the level.
//
// (1) IT TOUCHES `spawn.pool` AND `spawn.maxConcurrent`, AND NOTHING ELSE. An earlier draft also clamped
//     `spawn.total` to 4, which breaks two independent things: `advanceWhen: { kills: N }` is CUMULATIVE
//     kills (`level-runner.js` reads `world.kills >= c.kills`, not kills-since-phase), so a phase that
//     spawns fewer enemies than its own threshold stalls the level forever; and `enemyTotal` is the sum of
//     every phase's `total` (`server/src/enemy_total.js`), which drives the HUD's killed/total and the
//     last-kill reward drop. Both are asserted here directly, against a real Level-4-shaped descriptor.
//
// (2) IT DOES NOT MUTATE. `buildCatalog` shallow-copies a level, so its `phases` array is SHARED with the
//     module-level seed — mutating a phase in place would give every room in the process lancers. Same
//     trap as `withAllyAt`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withLancersAt, LANCER_SHIP_NAME, DEV_LANCER_MAX_CONCURRENT, DEV_LANCER_DEFAULT_PHASE } from './lancer-config.js';

// A Level-4-SHAPED fixture, not a copy of the real descriptor — deliberately, and it must stay that way.
// It reproduces only the two properties these tests turn on: `wave-1` is exactly Level 4's real opening
// phase (`maxConcurrent` 5, `total` 8, a multi-ship pool) and its `advanceWhen` threshold **equals its own
// total**, which is the arithmetic that makes clamping `total` hang the level. Everything else is trimmed —
// the real Level 4 has four spawning phases (8+8+5+1 = 22, which is what `enemyTotal` sums) and a different
// `wave-2` pool. Do NOT "correct" this toward `server/src/catalog_seed.js`: a fixture that tracked the real
// descriptor would make these assertions move whenever the level is retuned, and the reference-equality
// checks below (which phases come back as the SAME object) are about the transform, not about Level 4.
const level4 = () => ({
  map: 'system-1',
  phases: [
    { name: 'wave-1',
      spawn: { maxConcurrent: 5, total: 8, pool: [
        { ship: 'pirate gunner', chance: 40 },
        { ship: 'basic rocket pirate', chance: 40 },
        { ship: 'advanced medium pirate', chance: 20 }] },
      advanceWhen: { kills: 8 } },
    { name: 'wave-2',
      spawn: { maxConcurrent: 5, total: 8, pool: [{ ship: 'pirate gunner', chance: 100 }] },
      advanceWhen: { kills: 16 } },
    { name: 'victory', textKey: 'level.4.victory' },
  ],
});

test('withLancersAt: the named phase spawns 100% pirate lancers, and its concurrency is clamped to 2', () => {
  const out = withLancersAt(level4(), 'wave-1');
  const ph = out.phases[0];
  assert.deepEqual(ph.spawn.pool, [{ ship: LANCER_SHIP_NAME, chance: 100 }]);
  assert.equal(LANCER_SHIP_NAME, 'pirate lancer', 'the name must match the catalog ship row exactly');
  assert.equal(ph.spawn.maxConcurrent, DEV_LANCER_MAX_CONCURRENT);
  assert.equal(ph.spawn.maxConcurrent, 2, 'two simultaneous 1-second telegraphs is legible; five is a lattice');
  assert.equal(DEV_LANCER_DEFAULT_PHASE, 'wave-1', 'the default phase is the FIRST wave — a lancer in seconds');
});

test('withLancersAt: `spawn.total` and `advanceWhen` come through BYTE-IDENTICAL — the level must still advance', () => {
  // THE TRAP. `advanceWhen: { kills: 8 }` is CUMULATIVE kills, so clamping this phase's `total` to 4 would
  // spawn 4, let the player kill 4, and leave `world.kills` stalled at 4 < 8 forever. And `enemyTotal` is
  // the sum of every phase's `total` (server/src/enemy_total.js → the HUD's killed/total and isLastKillDrop),
  // so lowering one silently breaks the counter and the last-kill reward drop.
  const before = level4();
  const out = withLancersAt(before, 'wave-1');
  assert.equal(out.phases[0].spawn.total, 8, 'the total is UNTOUCHED');
  assert.deepEqual(out.phases[0].advanceWhen, { kills: 8 }, 'and so is the advance condition');
  // Every phase's total, so `enemyTotal` cannot move at all.
  assert.deepEqual(out.phases.map((p) => p.spawn && p.spawn.total), before.phases.map((p) => p.spawn && p.spawn.total));
});

test('withLancersAt: only the NAMED phase changes; the others are the same objects', () => {
  const before = level4();
  const out = withLancersAt(before, 'wave-1');
  assert.equal(out.phases[1], before.phases[1], 'wave-2 is passed straight through by reference');
  assert.equal(out.phases[2], before.phases[2], 'and so is the spawn-less victory phase');
  assert.deepEqual(out.phases[1].spawn.pool, [{ ship: 'pirate gunner', chance: 100 }]);
});

test('withLancersAt does NOT mutate its input — the seed is shared with every other room in the process', () => {
  const before = level4();
  const phase0 = before.phases[0];
  const pool0 = phase0.spawn.pool;
  const out = withLancersAt(before, 'wave-1');
  assert.notEqual(out, before, 'a NEW descriptor');
  assert.notEqual(out.phases, before.phases, 'with a NEW phases array');
  assert.notEqual(out.phases[0], phase0, 'and a NEW phase object');
  assert.equal(before.phases[0], phase0, 'the caller\'s phase is the same object it was');
  assert.equal(before.phases[0].spawn.pool, pool0, 'with its original pool still in place');
  assert.equal(before.phases[0].spawn.maxConcurrent, 5);
});

test('withLancersAt: an unknown phase, a spawn-less phase, or no descriptor changes NOTHING', () => {
  const before = level4();
  assert.equal(withLancersAt(before, 'no-such-phase'), before, 'the SAME object comes back out');
  assert.equal(withLancersAt(before, 'victory'), before, 'a phase with no `spawn` is not a place to spawn');
  assert.equal(withLancersAt(null, 'wave-1'), null);
  const bare = { map: 'system-1' };
  assert.equal(withLancersAt(bare, 'wave-1'), bare, 'a descriptor with no phases array');
});

test('withLancersAt: a phase already below the cap keeps its own concurrency — the clamp never RAISES it', () => {
  const lvl = { phases: [{ name: 'wave-1', spawn: { maxConcurrent: 1, total: 3, pool: [{ ship: 'x', chance: 100 }] } }] };
  assert.equal(withLancersAt(lvl, 'wave-1').phases[0].spawn.maxConcurrent, 1);
});
