// Enemy spawn stagger: gate every spawn behind a randomized 2–4 s cooldown so phases fill (and refill
// after a kill) one enemy at a time instead of snapping to maxConcurrent. Pure + dependency-free so it
// is unit-testable without the WebGL engine graph; the level runner (sim.js) drives it per fixed step.

export const SPAWN_DELAY_MIN = 2;   // seconds — floor of the post-spawn cooldown
export const SPAWN_DELAY_SPAN = 2;  // seconds — added window (so the delay is 2..4 s)

// Randomized 2..4 s delay to arm after a spawn. `rand` is injectable for deterministic tests.
export function nextSpawnDelay(rand = Math.random) {
  return SPAWN_DELAY_MIN + rand() * SPAWN_DELAY_SPAN;
}

// Advance the stagger gate one fixed step. Returns { spawn, cooldown }:
//   spawn    — may ONE enemy spawn this frame?
//   cooldown — the new cooldown to store back on the runner.
// The cooldown only drains while a slot is open (alive < maxConcurrent AND budget remains); a FULL arena
// freezes the timer, so when a kill frees a slot the remaining 2–4 s still has to elapse (post-kill
// replacements are staggered too, never instant). One spawn per call at most (staggered one at a time).
export function stepSpawnGate({ cooldown, dt, alive, maxConcurrent, capRemaining }, rand = Math.random) {
  const wantSpawn = alive < maxConcurrent && (capRemaining == null || capRemaining > 0);
  if (!wantSpawn) return { spawn: false, cooldown };  // arena full / budget spent → freeze the timer
  const cd = cooldown - dt;
  if (cd <= 0) return { spawn: true, cooldown: nextSpawnDelay(rand) };  // fire + arm the next 2..4 s
  return { spawn: false, cooldown: cd };               // still counting down toward the next spawn
}
