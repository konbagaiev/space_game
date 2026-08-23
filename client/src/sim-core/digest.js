// A World, reduced to one comparable value.
//
// The reason this exists: single-player runs the simulation in the browser and multiplayer will run it in
// Node, from ONE module. That is only true for as long as somebody checks — so the same input trace is
// replayed on both hosts and the two digests must match. A mismatch means the hosts disagree about the
// rules, which is the failure this whole project is arranged to prevent (D1).
//
// Two things are digested, and the second is the subtle one:
//   • the state — where everything is, how much of it there is, what the run has scored;
//   • the number of `simRandom()` draws consumed. A cosmetic path that reaches into the seeded gameplay
//     stream (DECISIONS §73) desyncs every recording in the archive; a browser-only FX path doing it would
//     shift the browser's stream and not Node's, and the draw count catches that immediately — with a clear
//     cause — where a state hash would just say "different".
//
// `world.allyKills` is in NEITHER the digest nor the summary, deliberately: it is a maintainer's readout of
// the wingman's share of a run, not simulation state the two hosts must agree on, and putting it in either
// would move hashes and summaries for no benefit.
//
// Positions are hashed at FULL precision on purpose. Both hosts run the same code over IEEE doubles in the
// same order, so bit-identical is the correct expectation; rounding first would hide a real early
// divergence that has not grown large yet.
//
// See docs/plans/server-authoritative-sim.md (Slice C).
import { simRandomDraws } from './sim-random.js';

// FNV-1a over the canonical string. `String(x)` round-trips a double exactly in JS, so the text carries
// every bit the number has.
function fnv1a(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

function pushVec(parts, v) { parts.push(String(v.x), String(v.y), String(v.z)); }

// The human-readable half: the numbers a person reads off a failing comparison to see WHAT diverged.
export function worldSummary(world) {
  const p = world.player, lr = world.levelRunner;
  return {
    kills: world.kills, earned: world.earned, earnedXp: world.earnedXp,
    enemyShieldRefills: world.enemyShieldRefills,
    enemies: world.enemies.length, allies: world.allies.length, bullets: world.bullets.length,
    rockets: world.rockets.length, drops: world.drops.length, loot: world.pendingLoot.length,
    phase: lr.phaseIndex, spawned: lr.spawnedThisPhase, won: lr.won, cleared: lr.cleared,
    returning: lr.returningToBase,
    hp: p ? p.hp : null,
    px: p ? Math.round(p.pos.x * 1000) / 1000 : null,
    pz: p ? Math.round(p.pos.z * 1000) / 1000 : null,
    draws: simRandomDraws(),
  };
}

export function worldDigest(world) {
  const parts = [];
  const p = world.player, lr = world.levelRunner;
  parts.push('run', String(world.kills), String(world.earned), String(world.earnedXp),
    String(world.banked), String(world.enemyShieldRefills), String(world.combatElapsed),
    String(world.returnToBase), String(world.roam));
  parts.push('lr', String(lr.phaseIndex), String(lr.killsAtPhaseStart), String(lr.spawnedThisPhase),
    String(lr.spawnCooldown), String(lr.won), String(lr.cleared), String(lr.winPending),
    String(lr.returningToBase));
  parts.push('arena', String(world.arenaCenter.x), String(world.arenaCenter.z));
  parts.push('ap', String(world.autopilot.active), String(world.autopilot.phase),
    String(world.autopilot.target && world.autopilot.target.kind));
  if (p) {
    parts.push('p');
    pushVec(parts, p.pos); pushVec(parts, p.vel);
    parts.push(String(p.heading), String(p.hp), String(p._shieldValue), String(p.oobTime),
      String(p.spawnAge), String(p.scale), String(p.alive));
  }
  for (const e of world.enemies) {
    parts.push('e');
    pushVec(parts, e.pos); pushVec(parts, e.vel);
    parts.push(String(e.heading), String(e.hp), String(e._shieldValue), String(e.spawnAge), String(e.warping));
  }
  // The friendly side that is not the player. An EMPTY `allies` pushes nothing, so every existing hash is
  // unchanged — which is what keeps the recorded archive and both oracles untouched (DECISIONS §73).
  for (const a of world.allies) {
    parts.push('al');
    pushVec(parts, a.pos); pushVec(parts, a.vel);
    parts.push(String(a.heading), String(a.hp), String(a._shieldValue), String(a.spawnAge),
      String(a.warping), String(a.retreating), String(world.enemies.indexOf(a.target))); // -1 = no target
  }
  for (const b of world.bullets) { parts.push('b'); pushVec(parts, b.pos); parts.push(String(b.traveled)); }
  for (const r of world.rockets) { parts.push('r'); pushVec(parts, r.pos); parts.push(String(r.heading), String(r.hp)); }
  for (const d of world.drops) { parts.push('d'); pushVec(parts, d.pos); parts.push(String(d.inRange)); }
  for (const it of world.pendingLoot) parts.push('l', String(it.kind), String(it.refId));
  return { hash: fnv1a(parts.join('|')), draws: simRandomDraws(), summary: worldSummary(world) };
}
