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

// `blocked` is the level-0 intro's `spawn.earliest` floor ("not before t seconds of combat"). It must
// behave exactly like a FULL ARENA — freeze, never drain — or the floor would leak into the cooldown the
// level runner hands the enemy as its warp-in duration, and a 3 s floor would become a 3 s materialisation.
test('a BLOCKED gate never spawns and FREEZES the cooldown (the intro spawn floor)', () => {
  const held = stepSpawnGate({ cooldown: 0, dt: 1 / 60, alive: 0, maxConcurrent: 1, capRemaining: 3, blocked: true });
  assert.equal(held.spawn, false, 'a script floor holds the spawn even at cooldown 0 with an empty arena');
  assert.equal(held.cooldown, 0, 'and the cooldown is untouched');

  let cd = 2.5;
  for (let i = 0; i < 600; i++) { // 10 s of blocked frames
    const g = stepSpawnGate({ cooldown: cd, dt: 1 / 60, alive: 0, maxConcurrent: 1, capRemaining: 3, blocked: true });
    assert.equal(g.spawn, false);
    cd = g.cooldown;
  }
  assert.equal(cd, 2.5, 'ten seconds of being blocked drained nothing');

  // …and the moment the floor lifts, the ordinary stagger resumes from exactly where it was.
  const resumed = stepSpawnGate({ cooldown: cd, dt: 1 / 60, alive: 0, maxConcurrent: 1, capRemaining: 3, blocked: false });
  assert.equal(resumed.spawn, false);
  assert.ok(Math.abs(resumed.cooldown - (2.5 - 1 / 60)) < 1e-12, 'it drains again once unblocked');
});

test('blocked defaults to false — a phase with no floor behaves exactly as before', () => {
  const g = stepSpawnGate({ cooldown: 0, dt: 1 / 60, alive: 0, maxConcurrent: 1, capRemaining: null }, () => 0);
  assert.equal(g.spawn, true);
  assert.equal(g.cooldown, SPAWN_DELAY_MIN);
});
