// The duel referee: the server re-simulates a `?duel` fight and says whether it happened the way the
// browser said it did (docs/plans/2026-09-01-1845-duel-referee.md).
//
// IT DECIDES NOTHING. It returns a verdict and writes it onto the session row; no credits, no XP, no
// progression and no gate may read it. That is DECISIONS §129's own rule — "the verdict is recorded long
// before it is allowed to bind" — and no caller may bind money to this until the disagreement rate on
// HONEST players has been measured. A survey of 74 production campaign sessions found 20% agreement and not
// one cheat; a mechanism with that error rate would rob honest players, not catch cheats.
//
// ── The anchor: the end of the FIGHT, not the end of the trace ──────────────────────────────────────────
// A mission ends twice (DECISIONS §130). `cleared`/death are decided inside `sim-core` as a pure
// consequence of the fight; `won` needs a mouse click and a dock, and a trace records keys and touch, never
// a click. So the comparison point is `duelAnchorReached` (sim-core/duel-config.js) — and the referee finds
// that point ITSELF rather than being told where it is: never derive the stop tick from `claim.anchor.tick`
// or the client is grading its own homework. It also does NOT require the trace to end at the anchor; a
// trace carrying extra ticks (a provisional upload, a future flow that keeps recording the flight home)
// must still verify.
//
// ── Why the FULL digest is a sound oracle here, where §129 says it is the wrong one for money ───────────
// §129's objection is `ownsReward`: the last kill's reward drop reads account state a trace does not carry,
// and its two branches consume a different number of RNG draws. **That branch cannot be reached in a duel.**
// `withDuelRoom` drops `lastKillDrop` from the descriptor, and `step-enemies.js` reads
//   `if (lkd && isLastKillDrop(...) && !ownsReward(world, lkd)) { … } else if (simRandom() < DROP_CHANCE)`
// — `lkd` is undefined, JS short-circuits, `ownsReward` is never called, and the kill falls through to a
// single seeded draw. The duel's loot roll is therefore fully deterministic from the seed. An ace also pays
// 0 credits and 0 XP, so comparing the reward instead would be comparing `0 === 0` and proving nothing.
//
// The standing proof that cross-host bit-identity is achievable at all is `36-sim-divergence` (browser and
// Node agreeing on the full digest AND the draw count for the canonical Level-0 trace);
// `49-duel-referee` is that same guard applied to a LIVE duel.
import { runTrace } from '../../tools/sim-replay.mjs';
import { classifyTrace } from './verify-run.js';
import { traceTickCount } from '../../../client/src/replay.js';
import { ACE_COUNT_MAX } from '../../../client/src/sim-core/ace.js';
import { duelAnchorReached } from '../../../client/src/sim-core/duel-config.js';

// ~3.3 min of duel at 60 Hz. Past that we refuse rather than block the loop: re-simulating is synchronous
// CPU on the API process, and a duel that long is not the short fight this mechanism was justified by.
export const DUEL_VERIFY_MAX_TICKS = 12000;

// Why this duel cannot be judged, or null if it can. `classifyTrace` carries the shared admission rules
// (v4+, not truncated, a catalog level, the claim's level matches, the build gate); everything below is
// duel-specific.
export function classifyDuel(trace, claim = {}, { build = null } = {}) {
  const why = classifyTrace(trace, claim, { build });        // v4 / truncated / unknown-level / build-drift …
  if (why) return why;
  const room = trace.room;
  if (!room || room.kind !== 'duel') return 'not-a-duel';
  if (!Number.isInteger(room.aces) || room.aces < 1 || room.aces > ACE_COUNT_MAX) return 'bad-room';
  if (!claim.anchor || !Number.isInteger(claim.anchor.tick) || claim.anchor.tick <= 0) return 'no-anchor-claim';
  if (traceTickCount(trace) > DUEL_VERIFY_MAX_TICKS) return 'too-long';
  return null;
}

// A human-readable tail for a note: what the re-simulated fight actually looked like.
const shape = (r) => `kills=${r.summary.kills} hp=${r.summary.hp} t=${r.ticksRun}`;

// Judge one duel. Returns { verdict, note, ticksRun, hash, draws, summary } — verdict is one of
// agree | disagree | unverifiable | error. `run` is the referee, injectable for tests.
export async function verifyDuel({ trace, claim = {}, build = null, run = runTrace } = {}) {
  const why = classifyDuel(trace, claim, { build });
  if (why) return { verdict: 'unverifiable', note: why, ticksRun: null, hash: null, draws: null, summary: null };
  let r;
  try {
    r = await run(trace, { stopWhen: duelAnchorReached });
  } catch (e) {
    return { verdict: 'error', note: String(e && e.message).slice(0, 200), ticksRun: null, hash: null, draws: null, summary: null };
  }
  const out = { ticksRun: r.ticksRun, hash: r.hash, draws: r.draws, summary: r.summary };
  const a = claim.anchor;
  // THE LOUDEST SIGNAL THIS MECHANISM CAN PRODUCE: the input the player uploaded does not end the fight it
  // claims to have ended. Reported before anything else, because every comparison below is meaningless
  // when the referee never reached the moment it was supposed to compare.
  if (!duelAnchorReached(r.world)) {
    return { ...out, verdict: 'disagree',
      note: `no-anchor (ran ${r.ticksRun}/${r.ticksTotal} ticks, ${shape(r)})` };
  }
  if (r.ticksRun !== a.tick) return { ...out, verdict: 'disagree', note: `tick ${r.ticksRun}≠${a.tick} (${shape(r)})` };
  // DRAWS BEFORE HASH, deliberately: a draw-count mismatch NAMES the culprit — something drew from the
  // seeded gameplay stream on one host and not the other (DECISIONS §73) — where a hash mismatch only says
  // "different".
  if (r.draws !== a.draws) return { ...out, verdict: 'disagree', note: `draws ${r.draws}≠${a.draws} (${shape(r)})` };
  if (r.hash !== a.hash) {
    return { ...out, verdict: 'disagree',
      note: `hash 0x${r.hash.toString(16)}≠0x${(a.hash >>> 0).toString(16)} (${shape(r)})` };
  }
  return { ...out, verdict: 'agree', note: shape(r) };
}

// Verify + persist. `save({ id, verdict, note })` is injected (db.recordSessionVerdict in production), so
// the route is testable without HTTP and this module never imports the datastore.
// It logs one line so the cost of a re-simulation is MEASURED rather than assumed.
export async function verifyDuelSession({ id, trace, claim, build = null, save }) {
  const t0 = Date.now();
  const r = await verifyDuel({ trace, claim, build });
  console.log(`[referee] duel ${id} ${r.verdict} (${r.note}) in ${Date.now() - t0} ms`);
  if (save) await save({ id, verdict: r.verdict, note: r.note });
  return r;
}
