import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSpawnDelay, stepSpawnGate, SPAWN_DELAY_MIN } from './spawn-timing.js';

test('nextSpawnDelay maps the RNG onto 2..4 s', () => {
  assert.equal(nextSpawnDelay(() => 0), 2);
  assert.equal(nextSpawnDelay(() => 0.5), 3);
  assert.equal(nextSpawnDelay(() => 1), 4);
});

test('first spawn of a phase is immediate (cooldown 0 → spawn now, then arms 2..4 s)', () => {
  const g = stepSpawnGate({ cooldown: 0, dt: 1 / 60, alive: 0, maxConcurrent: 3, capRemaining: null }, () => 0);
  assert.equal(g.spawn, true);
  assert.equal(g.cooldown, SPAWN_DELAY_MIN); // armed to 2 s with rand()==0
});

test('one spawn, then NO spawn until the armed delay elapses', () => {
  // just spawned; cooldown armed to 2 s, arena not full
  let cd = 2, spawns = 0;
  for (let i = 0; i < 100; i++) {           // ~1.6 s of frames — under the 2 s delay
    const g = stepSpawnGate({ cooldown: cd, dt: 1 / 60, alive: 1, maxConcurrent: 3, capRemaining: null });
    cd = g.cooldown; if (g.spawn) spawns++;
  }
  assert.equal(spawns, 0, 'no spawn before the 2 s delay elapses');
  // push past 2 s of accumulated dt → exactly one spawn fires and re-arms
  let fired = 0;
  for (let i = 0; i < 40; i++) {
    const g = stepSpawnGate({ cooldown: cd, dt: 1 / 60, alive: 1, maxConcurrent: 3, capRemaining: null }, () => 0.5);
    cd = g.cooldown; if (g.spawn) { fired++; }
  }
  assert.equal(fired >= 1, true, 'a spawn fires once the delay elapses');
});

test('a FULL arena freezes the timer so post-kill refill still waits (not instant)', () => {
  // cooldown mid-count while arena is full → unchanged, no spawn
  const full = stepSpawnGate({ cooldown: 2.5, dt: 1, alive: 3, maxConcurrent: 3, capRemaining: null });
  assert.equal(full.spawn, false);
  assert.equal(full.cooldown, 2.5, 'timer is frozen while the arena is full');
  // a kill frees a slot but the remaining 2.5 s must still elapse before the replacement
  const afterKill = stepSpawnGate({ cooldown: 2.5, dt: 1, alive: 2, maxConcurrent: 3, capRemaining: null });
  assert.equal(afterKill.spawn, false, 'replacement is NOT instant after a kill');
  assert.equal(afterKill.cooldown, 1.5);
});

test('total-cap budget exhausted → no spawn even at cooldown 0', () => {
  const g = stepSpawnGate({ cooldown: 0, dt: 1, alive: 0, maxConcurrent: 3, capRemaining: 0 });
  assert.equal(g.spawn, false);
});
