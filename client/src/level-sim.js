// Deterministic headless replay of the staggered levelRunner (client/src/sim.js update/shouldAdvance),
// plus the last-kill drop predicate — pure + dependency-light so it is unit-testable without the WebGL
// engine graph. Proves the destroyed counter reaches enemyTotal exactly and the reward drop fires on the
// true last kill under staggered spawns (the regression 2026-07-06-1738 fixed).
import { stepSpawnGate } from './spawn-timing.js';

// enemyTotal is the sum of every spawning phase's `total` (mirrors server/src/enemy_total.js).
export function levelEnemyTotal(phases) {
  return (phases || []).reduce((s, ph) => s + ((ph.spawn && ph.spawn.total) || 0), 0);
}

// The last-kill reward drop condition (extracted from sim.js so it is testable).
export function isLastKillDrop({ kills, enemyTotal }) {
  return enemyTotal > 0 && kills === enemyTotal;
}

// Replay a level to completion. Deterministic: fixed dt, mid-range (rand→0.5) stagger delays, the "player"
// destroys one available enemy per step. Returns the total kills to clear and the kill index the drop
// fires on. Warp invulnerability only delays WHEN an enemy is killable, never the final count, so it isn't
// modeled here — the count/drop determinism is what this guards; sim.js guards + the live test cover warp.
export function simulateLevel(phases, { dt = 1 / 60, rand = () => 0.5 } = {}) {
  const enemyTotal = levelEnemyTotal(phases);
  let idx = 0, kills = 0, killsAtPhaseStart = 0, spawnedThisPhase = 0, cooldown = 0, alive = 0;
  let dropKill = null;
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
  for (let guard = 0; guard < 1e6; guard++) {
    const ph = phases[idx];
    if (!ph || ph.event === 'win') break;
    if (ph.spawn) {
      const cap = ph.spawn.total;
      const capRemaining = cap == null ? null : cap - spawnedThisPhase;
      const g = stepSpawnGate({ cooldown, dt, alive, maxConcurrent: ph.spawn.maxConcurrent, capRemaining }, rand);
      cooldown = g.cooldown;
      if (g.spawn) { alive++; spawnedThisPhase++; }
    }
    if (shouldAdvance(ph) && idx < phases.length - 1) {
      idx++; killsAtPhaseStart = kills; spawnedThisPhase = 0; cooldown = 0; continue;
    }
    if (alive > 0) {
      alive--; kills++;
      if (dropKill == null && isLastKillDrop({ kills, enemyTotal })) dropKill = kills;
    }
  }
  return { enemyTotal, totalKills: kills, dropKill };
}
