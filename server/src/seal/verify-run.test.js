// The verdict, and — more importantly — the things it must REFUSE to judge.
//
// Every guard here is negative-tested: a test that only ever sees `agree` cannot tell a working verifier
// from one that returns `agree` unconditionally. The refusals matter more than the agreements, because a
// wrong verdict on a run the server cannot reproduce takes credits off an honest player (DECISIONS §125).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyRun, classifyTrace, MIN_VERIFIABLE_TRACE_VERSION } from './verify-run.js';
import { MAX_SESSION_TICKS, MAX_SESSION_RUNS } from '../../../client/src/session-record.js';
import { LEVELS } from '../catalog_seed.js';

// The Level-0 trace is an ASSET, pulled from S3 and gitignored — CI does not have it, so every test that
// re-simulates has to say so rather than throw ENOENT. Same guard, same wording as `sim-replay.test.js`
// and `room.test.js`; the path comes from the level descriptor so a re-recorded (re-hashed) trace does not
// need this file edited. The tests that only CLASSIFY a trace still run everywhere, which is most of them.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const INTRO = LEVELS.find((l) => l.name === 'level-0').descriptor.introTrace;
const ASSET = path.join(repoRoot, 'client', INTRO);
const haveTrace = existsSync(ASSET);
const raw = haveTrace ? JSON.parse(readFileSync(ASSET, 'utf8')) : null;
const skip = haveTrace ? false : `intro trace not pulled (${INTRO}) — run \`npm run assets:pull\``;

// The shipped Level-0 asset is v3 (recorded before the skills field existed). Reading it AS v4 is sound and
// is exactly the case §125 carves out: it was recorded on a fresh account with nothing spent, so `skills:
// null` is not an assumption about it — it is the truth about it.
const v4trace = (over = {}) => ({ ...raw, version: 4, skills: null, ...over });

// What that trace actually earns when re-simulated — the numbers `sim-replay.mjs` prints for it. The
// credits are DOUBLED because the run clears the arena, and since DECISIONS §130 that is where the reward
// is granted: a headless referee reaches it without docking, so 250 is simply what the fight produced.
const TRUTH = { credits: 250, xp: 125, kills: 4 };

// ---------- refusals ----------

test('a pre-v4 trace is refused, never judged (DECISIONS §125)', { skip }, async () => {
  for (const version of [1, 2, 3]) {
    const r = await verifyRun({ trace: v4trace({ version }), claim: { ...TRUTH, outcome: 'death' } });
    assert.equal(r.verdict, 'unverifiable', `v${version} must not be judged`);
    assert.equal(r.note, `trace-v${version}`);
    assert.equal(r.credits, null, 'a refused trace reports no figures at all');
  }
  assert.equal(MIN_VERIFIABLE_TRACE_VERSION, 4);
});

test('a trace at the recorder cap is refused as truncated (its tail was never recorded)', { skip }, async () => {
  const byTicks = await verifyRun({ trace: v4trace({ tickCount: MAX_SESSION_TICKS }), claim: { outcome: 'death' } });
  assert.equal(byTicks.verdict, 'unverifiable');
  assert.equal(byTicks.note, 'truncated');

  const runs = Array.from({ length: MAX_SESSION_RUNS }, () => [{ k: [], t: null }, 1]);
  const byRuns = await verifyRun({ trace: v4trace({ runs, tickCount: MAX_SESSION_RUNS }), claim: { outcome: 'death' } });
  assert.equal(byRuns.verdict, 'unverifiable');
  assert.equal(byRuns.note, 'truncated');
});

test('a side mission is refused — its descriptor is generated, not a catalog level', { skip }, async () => {
  const r = await verifyRun({ trace: v4trace({ level: 'side-mining' }), claim: { outcome: 'win' } });
  assert.equal(r.verdict, 'unverifiable');
  assert.equal(r.note, 'unknown-level');
});

test('a claim about a different level than the trace is refused', { skip }, async () => {
  const r = await verifyRun({ trace: v4trace(), claim: { ...TRUTH, level: 'level-2', outcome: 'death' } });
  assert.equal(r.verdict, 'unverifiable');
  assert.equal(r.note, 'level-mismatch');
});

test('a missing trace is `no-trace`, which is not the same as a refusal', async () => {
  assert.equal((await verifyRun({ trace: null, claim: {} })).verdict, 'no-trace');
  assert.equal(classifyTrace(undefined), 'no-trace');
});

// A trace is evidence about the code that recorded it. Surveying production found every long run recorded
// on an older build disagreeing, and every agreement being 4 kills or fewer — the compounding signature of
// removing auto-aim (DECISIONS §124), not of cheating. Plan §3.1.
test('a run recorded by a different build is refused, not judged', { skip }, async () => {
  const claim = { ...TRUTH, level: 'level-0', outcome: 'death', gameVersion: 'oldsha' };
  const r = await verifyRun({ trace: v4trace(), claim, build: 'newsha' });
  assert.equal(r.verdict, 'unverifiable');
  assert.equal(r.note, 'build-drift');

  const same = await verifyRun({ trace: v4trace(), claim: { ...claim, gameVersion: 'newsha' }, build: 'newsha' });
  assert.equal(same.verdict, 'agree', 'the same build is judged normally');
});

test('a run whose build is unknown is refused when the verifier knows its own', { skip }, async () => {
  const r = await verifyRun({ trace: v4trace(), claim: { ...TRUTH, outcome: 'death' }, build: 'newsha' });
  assert.equal(r.verdict, 'unverifiable');
  assert.equal(r.note, 'build-unknown');
});

// ---------- the judgement itself ----------

test('an honest death claim agrees with the re-simulation', { skip }, async () => {
  const r = await verifyRun({ trace: v4trace(), claim: { ...TRUTH, level: 'level-0', outcome: 'death' } });
  assert.equal(r.verdict, 'agree', `note: ${r.note}`);
  assert.deepEqual({ credits: r.credits, xp: r.xp, kills: r.kills }, TRUTH);
  assert.equal(r.note, null);
});

test('an inflated claim disagrees, and the note says by how much', { skip }, async () => {
  const r = await verifyRun({ trace: v4trace(), claim: { ...TRUTH, credits: TRUTH.credits + 500, outcome: 'death' } });
  assert.equal(r.verdict, 'disagree');
  assert.match(r.note, /credits \+500/);
  assert.equal(r.credits, TRUTH.credits, 'the verdict reports what the run REALLY earned');
});

test('each of credits, xp and kills is compared — none is along for the ride', { skip }, async () => {
  for (const [field, delta] of [['credits', 1], ['xp', -1], ['kills', 3]]) {
    const claim = { ...TRUTH, outcome: 'death', [field]: TRUTH[field] + delta };
    const r = await verifyRun({ trace: v4trace(), claim });
    assert.equal(r.verdict, 'disagree', `${field} must be checked`);
    assert.match(r.note, new RegExp(`${field} [+-]`));
  }
});

// Before DECISIONS §130 the referee had to apply the victory bonus itself, because victory depended on a
// mouse click it could not make. Now the simulation grants the reward when the arena empties, so a claimed
// win and a claimed death on the SAME cleared trace produce the same figures — and the referee needs no
// special case at all.
test('a cleared run is worth the same to the referee whether the pilot docked or died on the way home', { skip }, async () => {
  const died = await verifyRun({ trace: v4trace(), claim: { ...TRUTH, outcome: 'death' } });
  const won = await verifyRun({ trace: v4trace(), claim: { ...TRUTH, outcome: 'win' } });
  assert.equal(won.verdict, 'agree');
  assert.equal(died.verdict, 'agree');
  assert.deepEqual({ c: won.credits, x: won.xp }, { c: died.credits, x: died.xp });
  assert.equal(won.note, null, 'no completion hack is needed any more');
  // The doubling is real, and it is the level's own one-shot XP that rides with it (level-0 pays 0).
  const xpReward = LEVELS.find((l) => l.name === 'level-0').descriptor.xpReward || 0;
  assert.equal(won.credits, 250);
  assert.equal(won.xp, 125 + xpReward);
});

test('a win claimed on a run that never cleared the arena is a real disagreement', { skip }, async () => {
  // Cut the trace off mid-fight: the arena is still full, so return-to-base never opens and no honest
  // player could have docked.
  const short = v4trace();
  short.runs = short.runs.slice(0, 8);
  short.tickCount = short.runs.reduce((n, r) => n + r[1], 0);
  const r = await verifyRun({ trace: short, claim: { credits: 999, xp: 999, kills: 40, outcome: 'win' } });
  assert.equal(r.verdict, 'disagree');
  assert.equal(r.note, 'win-not-earned');
});

test('the referee is injectable, so a caller that must not block a room can chunk it', { skip }, async () => {
  let called = 0;
  const run = async (t) => { called++; const { runTrace } = await import('../../tools/sim-replay.mjs'); return runTrace(t); };
  const r = await verifyRun({ trace: v4trace(), claim: { ...TRUTH, outcome: 'death' }, run });
  assert.equal(called, 1);
  assert.equal(r.verdict, 'agree');
});
