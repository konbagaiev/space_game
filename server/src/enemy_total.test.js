import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enemyTotalFromPhases } from './enemy_total.js';
import { LEVELS } from './catalog_seed.js';
import { generateMissions } from './missions.js';

// Behavior oracle: replays the levelRunner's spawn-then-advance loop (client/src/sim.js update +
// shouldAdvance) deterministically — the arena tops up to spawn.maxConcurrent, THEN advance is checked;
// the "player" kills one enemy per step when the phase isn't ready to advance. Returns kills to clear.
function simulateKillsToClear(phases) {
  let idx = 0, kills = 0, killsAtPhaseStart = 0, spawnedThisPhase = 0, alive = 0;
  const shouldAdvance = (ph) => {
    const c = ph.advanceWhen;
    if (!c) return false;
    if (c.kills != null) return kills >= c.kills;
    if (c.killsSincePhase != null) return (kills - killsAtPhaseStart) >= c.killsSincePhase;
    if (c.allCleared) {
      const spawnDone = !ph.spawn || (ph.spawn.total != null && spawnedThisPhase >= ph.spawn.total);
      return alive === 0 && spawnDone;
    }
    return false;
  };
  for (let guard = 0; guard < 100000; guard++) {
    const ph = phases[idx];
    if (!ph || ph.event === 'win') break;             // reached victory
    if (ph.spawn) {                                    // top up to maxConcurrent (respect total cap)
      const cap = ph.spawn.total;
      while (alive < ph.spawn.maxConcurrent && (cap == null || spawnedThisPhase < cap)) {
        alive++; spawnedThisPhase++;
      }
    }
    if (shouldAdvance(ph) && idx < phases.length - 1) { // advance carries leftover `alive` forward
      idx++; killsAtPhaseStart = kills; spawnedThisPhase = 0;
      continue;
    }
    if (alive > 0) { alive--; kills++; }               // else the player destroys one enemy
    else break;                                        // stuck (invalid descriptor) — fail loudly below
  }
  return kills;
}

const EXPECTED = { 'level-1': 14, 'level-2': 17, 'level-3': 21, 'level-4': 22 };

test('enemyTotalFromPhases: campaign totals match the anchors AND the sim oracle', () => {
  const byName = Object.fromEntries(LEVELS.map((l) => [l.name, l.descriptor]));
  for (const [name, want] of Object.entries(EXPECTED)) {
    const d = byName[name];
    assert.equal(d.enemyTotal, want, `${name} stamped enemyTotal`);
    assert.equal(enemyTotalFromPhases(d.phases), want, `${name} formula`);
    assert.equal(simulateKillsToClear(d.phases), want, `${name} actual kills-to-clear`);
  }
});

test('side missions: total 20, stamped, formula and sim agree', () => {
  for (const m of generateMissions()) {
    assert.equal(m.descriptor.enemyTotal, 20);
    assert.equal(enemyTotalFromPhases(m.descriptor.phases), 20);
    assert.equal(simulateKillsToClear(m.descriptor.phases), 20);
  }
});

test('enemyTotalFromPhases: sums every phase spawn.total (no carry), ignores non-spawning phases', () => {
  assert.equal(enemyTotalFromPhases([]), 0);
  assert.equal(enemyTotalFromPhases([
    { spawn: { maxConcurrent: 3, total: 6 }, advanceWhen: { kills: 6 } },
    { spawn: { maxConcurrent: 3, total: 6 }, advanceWhen: { kills: 12 } },
    { spawn: { maxConcurrent: 4, total: 2 }, advanceWhen: { allCleared: true } },
  ]), 14);
  assert.equal(enemyTotalFromPhases([
    { spawn: null, advanceWhen: { allCleared: true } }, // clear-out with no spawn adds 0
    { event: 'win' },                                    // win phase adds 0
  ]), 0);
});
