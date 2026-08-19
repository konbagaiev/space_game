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

// WHERE this run fights: the (x,z) the arena, its border and the player spawn are centred on (sim.js
// reset()). Two sources, in priority order, because the campaign and the side missions arrive by different
// routes and only one of them was ever wired:
//   • an active SIDE MISSION always carries its own `center` — it fights over its own set-piece;
//   • a CAMPAIGN level may now name one too (`CATALOG.level.center`). `G.activeMission` is null for the
//     campaign, so before this fallback existed every campaign level was pinned to (0,0) no matter what its
//     descriptor said — a seed-side `center` was silently ignored.
// Absent/partial input falls back to the origin per axis, so a half-written descriptor can't produce NaN
// and fling the arena to infinity. Pure — unit-tested in level-sim.test.js.
export function runCenter(activeMission, levelDescriptor) {
  const c = (activeMission && activeMission.center) || (levelDescriptor && levelDescriptor.center) || null;
  const num = (v) => (Number.isFinite(v) ? v : 0);
  return { x: num(c && c.x), z: num(c && c.z) };
}

// ---------- Roam → combat: flying into a mission's neighbourhood starts the fight ----------
// A campaign level that names a `center` ("Level 3" at the Space Factory, "Level 4" at the far belt
// outpost) becomes a place you can FLY INTO while roaming: cross into its neighbourhood and a short
// countdown runs, then the fight begins there. No confirm dialog — the countdown IS the confirmation, and
// leaving cancels it.
//
// MISSION_ZONE_RADIUS must comfortably exceed the distance from the destination the map parks you at to the
// level's centre, or arriving by autopilot would sit just outside the zone and nothing would happen: the
// factory anchor (-350,-350) is ~131 u from the Level 3 centre (-450,-435), so 200 leaves real margin while
// still keeping the station in frame when the count starts. Level 4's centre sits exactly ON its outpost
// anchor (an asteroid field is below-plane decor, nothing to frame around), so its margin is the full 200.
// The "every relocated level parks you inside its own fly-in zone" test in level-sim.test.js pins this for
// every centre, so a new one can't be dropped somewhere autopilot never reaches.
export const MISSION_ZONE_RADIUS = 200;
export const MISSION_ZONE_COUNTDOWN = 3; // seconds from crossing in to the fight starting

// One step of the countdown. `state.t` is the seconds left, or null when disarmed. Pure — the caller owns
// the clock and the distance, so this is unit-testable without a world.
//   outside the zone      → disarmed (so flying back out cancels a count in progress)
//   crossing in           → armed at `seconds`
//   inside, counting      → ticks down; `fire` goes true on the step that reaches zero, exactly once
// After firing it stays at 0 (`fire` false) until the player leaves and re-enters, so a host that ignores
// the first fire can't be re-triggered every frame.
export function stepMissionZone(state, { dist, dt, radius = MISSION_ZONE_RADIUS, seconds = MISSION_ZONE_COUNTDOWN }) {
  const prev = state && Number.isFinite(state.t) ? state.t : null;
  if (!(dist <= radius)) return { t: null, fire: false };       // outside (or dist is NaN) → disarm
  if (prev == null) return { t: seconds, fire: seconds <= 0 };  // just crossed in → arm
  if (prev <= 0) return { t: 0, fire: false };                  // already fired; wait for a re-entry
  const t = prev - dt;
  return { t: Math.max(0, t), fire: t <= 0 };
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
