// The duel referee, exercised on a REAL duel rather than a fixture: an idle starter hull dropped into the
// `?duel` sparring room against two aces, which is a fight that settles on its own in about nine seconds.
//
// BE HONEST ABOUT WHAT THIS PROVES. The claim these tests compare against is produced by the same Node
// referee, so what is proved here is the MECHANISM — admission, the comparison and its ordering, the notes,
// persistence. The browser ↔ Node half is proved by `client/visual/scenarios/48-duel-referee.mjs`, and that
// is the test that would catch a real cross-host divergence.
//
// AND ONE GAP, NAMED RATHER THAN LEFT TO BE REDISCOVERED: every fixture here is an idle DEATH, so the
// anchor that ends them is `!player.alive` — which `runTrace` breaks on by itself, with or without
// `stopWhen`. Nothing in this file would notice that option disappearing. The `cleared` half of the anchor
// is guarded in `server/tools/sim-replay.test.js` against the committed Level-0 trace, which is the only
// run in the repository that clears; a winnable-duel fixture would need a recorded input trace that
// actually kills two aces, which is a new committed asset rather than a few lines.
//
// Every assertion carries the re-simulated fight's shape in its message. `no-anchor` alone has several
// causes — a fight that legitimately took longer, an idle player who did not die, a DUEL_VERIFY_MAX_TICKS
// miss, a real divergence — and a failure that prints the bare verdict tells the reader none of them apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyDuel, verifyDuelSession, classifyDuel, DUEL_VERIFY_MAX_TICKS } from './verify-duel.js';
import { runTrace } from '../../tools/sim-replay.mjs';
import { makeTrace } from '../../../client/src/replay.js';
import { DUEL_LOADOUT, DUEL_COMPONENTS } from '../../../client/src/duel-dev.js';
import { duelAnchorReached } from '../../../client/src/sim-core/duel-config.js';

const SEED = 12345;

// An ALL-IDLE duel trace: the player never touches a control, so the aces fly the whole fight themselves
// and it ends on the death anchor. 1800 ticks is a generous ceiling — the surplus is simply never reached.
const duelTrace = ({ aces = 2, ticks = 1800, seed = SEED, ...over } = {}) => makeTrace({
  id: 'duel-test', level: 'level-1', seed, dt: 1 / 60, shipId: 1,
  loadout: DUEL_LOADOUT, components: DUEL_COMPONENTS, skills: null,
  room: { kind: 'duel', aces },
  runs: [[{ k: [], t: null }, ticks]], tickCount: ticks,
  ...over,
});

// The honest claim: what this very fight produced, taken the way the browser takes it (at the anchor).
const honest = (trace) => {
  const r = runTrace(trace, { stopWhen: duelAnchorReached });
  return { anchor: { tick: r.ticksRun, hash: r.hash, draws: r.draws }, ref: r };
};

const shape = (r) => (r.summary
  ? `verdict=${r.verdict} note=${r.note} ticks=${r.ticksRun} draws=${r.draws} `
    + `hash=0x${(r.hash >>> 0).toString(16)} kills=${r.summary.kills} hp=${r.summary.hp} phase=${r.summary.phase}`
  : `verdict=${r.verdict} note=${r.note} (nothing was simulated)`);

test('the idle duel really does settle inside the trace — the fixture this file rests on', () => {
  const { ref } = honest(duelTrace());
  assert.ok(duelAnchorReached(ref.world),
    `the fight must end on its own, or every case below is meaningless (ran ${ref.ticksRun}/${ref.ticksTotal})`);
  assert.ok(ref.ticksRun < 1800, `and well inside the trace (${ref.ticksRun} ticks)`);
});

test('an honest duel agrees', async () => {
  const trace = duelTrace();
  const { anchor } = honest(trace);
  const r = await verifyDuel({ trace, claim: { level: 'level-1', anchor } });
  assert.equal(r.verdict, 'agree', shape(r));
  assert.equal(r.ticksRun, anchor.tick, shape(r));
});

test('a flipped hash disagrees, and the note names the hash', async () => {
  const trace = duelTrace();
  const { anchor } = honest(trace);
  const r = await verifyDuel({ trace, claim: { level: 'level-1', anchor: { ...anchor, hash: anchor.hash ^ 1 } } });
  assert.equal(r.verdict, 'disagree', shape(r));
  assert.match(r.note, /^hash /, shape(r));
});

// DRAWS ARE REPORTED BEFORE THE HASH, deliberately: a draw-count mismatch NAMES the culprit (something drew
// from the seeded gameplay stream on one host and not the other — DECISIONS §73), where a hash mismatch
// only says "different". A wrong draw count also always implies a wrong hash, so the ordering is what
// decides which of the two the maintainer reads off the admin page.
test('a wrong draw count disagrees, and is reported BEFORE the hash', async () => {
  const trace = duelTrace();
  const { anchor } = honest(trace);
  const bad = { ...anchor, draws: anchor.draws + 1, hash: anchor.hash ^ 1 };
  const r = await verifyDuel({ trace, claim: { level: 'level-1', anchor: bad } });
  assert.equal(r.verdict, 'disagree', shape(r));
  assert.match(r.note, /^draws /, shape(r));
});

test('an anchor tick one either side of the truth disagrees', async () => {
  const trace = duelTrace();
  const { anchor } = honest(trace);
  for (const d of [-1, +1]) {
    const r = await verifyDuel({ trace, claim: { level: 'level-1', anchor: { ...anchor, tick: anchor.tick + d } } });
    assert.equal(r.verdict, 'disagree', shape(r));
    assert.match(r.note, /^tick /, shape(r));
  }
});

// The loudest signal the mechanism can produce: the input the player uploaded does not end the fight it
// claims to have ended.
test('a trace that stops short of the death never reaches the anchor → disagree / no-anchor', async () => {
  const full = duelTrace();
  const { anchor } = honest(full);
  const short = duelTrace({ ticks: anchor.tick - 100 });
  const r = await verifyDuel({ trace: short, claim: { level: 'level-1', anchor } });
  assert.equal(r.verdict, 'disagree', shape(r));
  assert.match(r.note, /^no-anchor /, shape(r));
});

// The room really is rebuilt FROM THE TRACE: rebuild a different room and it is a different fight.
test('a 3-ace room judged against a 2-ace claim disagrees', async () => {
  const { anchor } = honest(duelTrace({ aces: 2 }));
  const r = await verifyDuel({ trace: duelTrace({ aces: 3 }), claim: { level: 'level-1', anchor } });
  assert.equal(r.verdict, 'disagree', shape(r));
});

// The referee stops when the fight settles and ignores whatever input follows. In production the two
// coincide, but a trace with extra ticks — a provisional upload, or a future flow that keeps recording the
// flight home — must still verify. (And the stop point is never derived from `claim.anchor.tick`, or the
// client would be grading its own homework.)
test('extra ticks after the anchor change nothing — the referee finds the anchor itself', async () => {
  const short = duelTrace({ ticks: 700 });
  const long = duelTrace({ ticks: 1800 });
  const { anchor } = honest(short);
  const r = await verifyDuel({ trace: long, claim: { level: 'level-1', anchor } });
  assert.equal(r.verdict, 'agree', shape(r));
});

test('the admission rules refuse rather than judge', async () => {
  const trace = duelTrace();
  const { anchor } = honest(trace);
  const claim = { level: 'level-1', anchor };
  const refuse = async (t, c, opts, expected) => {
    const r = await verifyDuel({ trace: t, claim: c, ...opts });
    assert.equal(r.verdict, 'unverifiable', shape(r));
    assert.equal(r.note, expected, shape(r));
  };
  await refuse({ ...trace, version: 3 }, claim, {}, 'trace-v3');           // DECISIONS §125
  await refuse({ ...trace, room: null }, claim, {}, 'not-a-duel');
  await refuse({ ...trace, room: { kind: 'duel', aces: 0 } }, claim, {}, 'bad-room');
  await refuse(trace, { level: 'level-1' }, {}, 'no-anchor-claim');
  await refuse(trace, { ...claim, gameVersion: 'abc' }, { build: 'def' }, 'build-drift');
  await refuse(trace, claim, { build: 'def' }, 'build-unknown');
  await refuse(duelTrace({ ticks: DUEL_VERIFY_MAX_TICKS + 1 }), claim, {}, 'too-long');
});

test('classifyDuel admits a good duel, and DUEL_VERIFY_MAX_TICKS is the boundary', () => {
  const { anchor } = honest(duelTrace());
  const claim = { level: 'level-1', anchor };
  assert.equal(classifyDuel(duelTrace(), claim), null);
  assert.equal(classifyDuel(duelTrace({ ticks: DUEL_VERIFY_MAX_TICKS }), claim), null, 'exactly at the cap is allowed');
  assert.equal(classifyDuel(duelTrace({ ticks: DUEL_VERIFY_MAX_TICKS + 1 }), claim), 'too-long');
});

test('a referee that throws is an `error`, never a disagreement', async () => {
  const trace = duelTrace();
  const { anchor } = honest(trace);
  const r = await verifyDuel({ trace, claim: { level: 'level-1', anchor },
    run: () => { throw new Error('boom'); } });
  assert.equal(r.verdict, 'error', shape(r));
  assert.equal(r.note, 'boom', shape(r));
});

test('verifyDuelSession saves the verdict exactly once', async () => {
  const trace = duelTrace();
  const { anchor } = honest(trace);
  const saved = [];
  const r = await verifyDuelSession({ id: 'sess-1', trace, claim: { level: 'level-1', anchor },
    save: async (row) => { saved.push(row); } });
  assert.equal(saved.length, 1, shape(r));
  assert.equal(saved[0].id, 'sess-1');
  assert.equal(saved[0].verdict, 'agree', shape(r));
  assert.equal(saved[0].note, r.note);
});

test('verifyDuelSession persists a refusal too — an unjudgeable duel is a recorded fact', async () => {
  const saved = [];
  const r = await verifyDuelSession({ id: 'sess-2', trace: { ...duelTrace(), room: null },
    claim: { level: 'level-1', anchor: { tick: 1, hash: 0, draws: 0 } },
    save: async (row) => { saved.push(row); } });
  assert.equal(r.verdict, 'unverifiable', shape(r));
  assert.deepEqual(saved, [{ id: 'sess-2', verdict: 'unverifiable', note: 'not-a-duel' }]);
});
