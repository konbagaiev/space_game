// Total enemies destroyed to complete a level/mission — precomputed on the server and stamped onto each
// descriptor (`descriptor.enemyTotal`) so the client HUD can show killed/total. This mirrors the exact
// spawn-then-advance behavior of the levelRunner (client/src/sim.js update/shouldAdvance): the arena is
// topped up to `spawn.maxConcurrent` BEFORE the advance check, so a kills/killsSincePhase phase leaves
// `maxConcurrent` enemies ALIVE when it advances. Those leftovers ("carry") are killed by a later
// `allCleared` field-clearing phase, so they count toward the total — a naive sum-of-thresholds
// undercounts and the HUD would show killed > total (e.g. 16/13). Rules:
//   advanceWhen.kills:N           -> total = max(total, N);  carry = maxConcurrent (leftovers alive)
//   advanceWhen.killsSincePhase:N -> total += N;             carry = maxConcurrent
//   advanceWhen.allCleared        -> add spawn.total (boss/finale new spawns) THEN add carry, reset carry
// Clear-out phases (spawn:null) contribute only their inherited carry; the event:'win' phase adds 0.
export function enemyTotalFromPhases(phases) {
  let total = 0;
  let carry = 0; // enemies still alive (== maxConcurrent) when the last threshold phase advanced;
                 // they are killed by a later allCleared phase and aren't in any threshold count
  for (const ph of phases || []) {
    const c = ph && ph.advanceWhen;
    if (!c) continue;
    if (c.kills != null) {
      total = Math.max(total, c.kills);
      carry = (ph.spawn && ph.spawn.maxConcurrent) || 0;
    } else if (c.killsSincePhase != null) {
      total += c.killsSincePhase;
      carry = (ph.spawn && ph.spawn.maxConcurrent) || 0;
    } else if (c.allCleared) {
      if (ph.spawn && ph.spawn.total != null) total += ph.spawn.total; // boss/finale caps (new spawns)
      total += carry;  // this phase clears the field -> the carried leftovers die here
      carry = 0;
    }
  }
  return total;
}
