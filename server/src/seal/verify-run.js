// The verdict: what a recorded run ACTUALLY earned, re-simulated from its input trace.
//
// `POST /api/games` is client-authoritative — the browser says "I earned 640 credits and 900 XP" and the
// server adds it to the balance. This module is the other half: given the trace the client uploaded for the
// same run, re-run the fight in Node with `sim-core` and say what the reward should have been.
//
// It DECIDES NOTHING. It returns a verdict; no caller of this module may change a balance on the strength
// of it until the disagreement rate on honest players has been measured. See docs/plans/seal-the-economy.md.
//
// ── The rule the whole file is built around (DECISIONS §125) ────────────────────────────────────────────
// Only a **v4+** trace reproduces the fight it recorded. v1–v3 omit the SKILL allocation, and skills change
// engine power, weapon damage, shield capacity and — through Maneuver's dodge — whether a hostile hit draws
// from the seeded stream at all. Re-simulating a v3 trace is re-simulating somebody else's fight, so it is
// refused rather than judged: a wrong verdict here takes credits off an HONEST player.
//
// ── The SECOND rule, and it is harsher: a trace only reproduces on the BUILD that recorded it ───────────
// Measured, not theorised (docs/plans/seal-the-economy.md §3.1). Removing auto-aim (DECISIONS §124) changed
// where a bullet goes, and §124 itself measured the shipped Level-0 replay moving from tick 2503 to 2474 on
// the same input. That was harmless for a 4-kill intro; on a 14-kill level the divergence compounds into a
// different fight. Surveying production bore it out exactly — every run recorded on an older build and long
// enough to compound disagreed, and every run that agreed was 4 kills or fewer.
// So `game_version` (already stored on every session row) is part of the admission test, and the practical
// consequence is worth stating plainly: **verification only works for the build currently deployed**, and
// every deploy invalidates whatever has not been judged yet. A trace is evidence about the code that made
// it, and nothing else.
//
// ── One thing that looks like a disagreement and is not ─────────────────────────────────────────────────
//
// **The world digest is the wrong oracle for money.** The last kill's reward drop is gated on
//    `ownsReward` (sim-core/step-enemies.js), which reads account state the trace does not carry, and whose
//    two branches consume a different number of RNG draws. A player who already owned the level's reward
//    legitimately produces a different hash and an identical reward. The digest is the right oracle for
//    `36-sim-divergence`; here we compare credits, XP and kills, and nothing else.
import { runTrace } from '../../tools/sim-replay.mjs';
import { MAX_SESSION_TICKS, MAX_SESSION_RUNS } from '../../../client/src/session-record.js';
import { normalizeLevelName, traceLevelName } from '../../../client/src/replay.js';
import { LEVELS } from '../catalog_seed.js';

// The line below which a trace cannot be re-judged. Bumping this is a decision, not a tidy-up.
export const MIN_VERIFIABLE_TRACE_VERSION = 4;

const VERDICTS = ['agree', 'disagree', 'unverifiable', 'no-trace', 'error'];
export const isVerdict = (v) => VERDICTS.includes(v);

// Why a trace cannot be judged, or null if it can. Pure and cheap — this is what the offline survey tool
// counts, and what keeps the sweeper from re-simulating something it must not.
// `build` is the version this process IS (SENTRY_RELEASE / the deploy commit); pass it and a run recorded by
// any other build is refused. Omit it only for an offline survey that is deliberately looking at drift.
export function classifyTrace(trace, claim = {}, { build = null } = {}) {
  if (!trace || typeof trace !== 'object') return 'no-trace';
  const v = Number(trace.version) || 0;
  if (v < MIN_VERIFIABLE_TRACE_VERSION) return `trace-v${v}`;      // DECISIONS §125 — never re-judged
  // The recorder stops appending at its caps while the game keeps playing, so a capped trace is MISSING its
  // tail and a re-simulation would legitimately under-count the run (client/src/session-record.js).
  const tickCount = Number(trace.tickCount) || (Array.isArray(trace.ticks) ? trace.ticks.length : 0);
  if (tickCount >= MAX_SESSION_TICKS) return 'truncated';
  if (Array.isArray(trace.runs) && trace.runs.length >= MAX_SESSION_RUNS) return 'truncated';
  // A side mission is a generated descriptor (server/src/missions.js), not a catalog level, so `buildCatalog`
  // cannot resolve it and the fight cannot be rebuilt. Roam is not recorded at all. Both are holes, and
  // they are named in docs/plans/seal-the-economy.md §8 rather than papered over here.
  const level = traceLevelName(trace);
  if (!LEVELS.some((l) => l.name === level)) return 'unknown-level';
  // The claim and the trace must be talking about the same run.
  if (claim.level && normalizeLevelName(claim.level) !== level) return 'level-mismatch';
  // ...and the run must have been recorded by THIS build (see the second rule in the header).
  if (build && claim.gameVersion && claim.gameVersion !== build) return 'build-drift';
  if (build && !claim.gameVersion) return 'build-unknown';
  return null;
}

// Judge one run. `claim` = { credits, xp, kills, outcome, level, gameVersion } — what the client banked.
// `run` is the referee, injectable so a caller that must not block a 60 Hz room can pass a chunked one.
// Returns { verdict, credits, xp, kills, note } — `credits`/`xp`/`kills` are the RE-SIMULATED figures
// (null when nothing was simulated).
export async function verifyRun({ trace, claim = {}, run = runTrace, build = null } = {}) {
  const why = classifyTrace(trace, claim, { build });
  if (why === 'no-trace') return { verdict: 'no-trace', credits: null, xp: null, kills: null, note: null };
  if (why) return { verdict: 'unverifiable', credits: null, xp: null, kills: null, note: why };

  const r = await run(trace);
  const world = r.world;
  const notes = [];

  // A claimed win that the simulation never cleared is a real disagreement — and it needs no special
  // handling to detect any more. Until DECISIONS §130 the referee had to APPLY the victory bonus itself,
  // because victory depended on a mouse click and `levelRunner.won` could never become true without one.
  // The reward is now granted by `clearMission` the moment the win condition holds, which a headless run
  // reaches on its own, so what is compared below is simply what the fight produced.
  if (claim.outcome === 'win' && !world.levelRunner.cleared) {
    return { verdict: 'disagree', credits: world.earned, xp: world.earnedXp, kills: world.kills,
      note: 'win-not-earned' };
  }

  const credits = world.earned, xp = world.earnedXp, kills = world.kills;
  const delta = (name, got, said) => (said == null || (said | 0) === got ? null
    : `${name} ${(said | 0) > got ? '+' : ''}${(said | 0) - got}`);
  const diffs = [delta('credits', credits, claim.credits), delta('xp', xp, claim.xp),
    delta('kills', kills, claim.kills)].filter(Boolean);

  return {
    verdict: diffs.length ? 'disagree' : 'agree',
    credits, xp, kills,
    note: [...notes, ...diffs].join(' ') || null,
  };
}
