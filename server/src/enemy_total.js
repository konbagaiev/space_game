// Total enemies destroyed to complete a level/mission — precomputed on the server and stamped onto each
// descriptor (`descriptor.enemyTotal`) so the client HUD can show killed/total. With deterministic
// staggered spawns (DECISIONS §54) EVERY spawning phase carries an explicit `total` cap: a threshold
// (kills/killsSincePhase) phase's total equals its kill-delta so it leaves 0 enemies alive at advance,
// and clear-out/finale (`allCleared`) phases carry the remainder. So the total is simply the sum of every
// phase's spawn.total. Phases with no spawn (event:'win') contribute 0.
export function enemyTotalFromPhases(phases) {
  let total = 0;
  for (const ph of phases || []) {
    if (ph && ph.spawn && ph.spawn.total != null) total += ph.spawn.total;
  }
  return total;
}
