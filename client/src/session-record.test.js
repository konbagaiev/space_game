import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeSessionRecorder, MIN_SESSION_TICKS, MAX_SESSION_TICKS, MAX_SESSION_RUNS,
} from './session-record.js';
import { traceTickCount, unpackTicks } from './replay.js';

const snap = () => ({ k: [], t: null });
const thrust = () => ({ k: ['KeyW'], t: null });

test('begin → 200 ticks → flush(win) returns a full payload', () => {
  const sr = makeSessionRecorder();
  sr.begin({ seed: 12345, level: 'level-1', shipId: 3, loadout: null, components: null, dt: 1 / 60 });
  for (let i = 0; i < 200; i++) sr.captureTick(snap());
  const payload = sr.flush('win', { kills: 3, durationMs: 9000 });
  assert.ok(payload);
  assert.equal(traceTickCount(payload.trace), 200);
  assert.equal(payload.trace.seed, 12345);
  assert.equal(payload.trace.dt, 1 / 60);
  assert.equal(payload.trace.level, 'level-1');
  assert.equal(payload.level, 'level-1');
  assert.equal(payload.outcome, 'win');
  assert.equal(payload.kills, 3);
  assert.equal(payload.durationMs, 9000);
  assert.equal(payload.id, sr.id);
  assert.equal(payload.trace.id, sr.id);
});

test('identical ticks collapse into ONE run (the packing that keeps memory + payload flat)', () => {
  const sr = makeSessionRecorder();
  sr.begin({ seed: 1, level: 'level-0', dt: 1 / 60 });
  for (let i = 0; i < 600; i++) sr.captureTick(snap());     // 10 s idle
  for (let i = 0; i < 600; i++) sr.captureTick(thrust());   // 10 s thrust
  assert.equal(sr.tickCount, 1200);
  assert.equal(sr.runs.length, 2, 'two distinct inputs → two runs, not 1200 retained snapshots');
  const trace = sr.flush('win').trace;
  assert.equal(traceTickCount(trace), 1200);
  assert.equal(unpackTicks(trace.runs).length, 1200, 'the packed trace expands back to every tick');
});

test('below the floor is a trivial bounce → dropped (null)', () => {
  const sr = makeSessionRecorder();
  sr.begin({ seed: 1, level: 'level-0', dt: 1 / 60 });
  for (let i = 0; i < 10; i++) sr.captureTick(snap());
  assert.equal(sr.flush('quit'), null);
});

test('double-flush guard: a second final flush returns null', () => {
  const sr = makeSessionRecorder();
  sr.begin({ seed: 1, level: 'level-0', dt: 1 / 60 });
  for (let i = 0; i < MIN_SESSION_TICKS; i++) sr.captureTick(snap());
  assert.ok(sr.flush('win'));
  assert.equal(sr.flush('quit'), null);
});

// The tab-hidden path: a phone that backgrounds mid-fight must ship what it has AND keep recording, so a
// player who comes back and wins ends up with ONE row (same id) holding the complete session.
test('provisional flush ships the session but keeps recording; the final flush wins under the same id', () => {
  const sr = makeSessionRecorder();
  sr.begin({ seed: 7, level: 'level-2', dt: 1 / 60 });
  for (let i = 0; i < 300; i++) sr.captureTick(snap());
  const provisional = sr.flush('quit', { kills: 0, durationMs: 5000 }, { final: false });
  assert.ok(provisional);
  assert.equal(provisional.outcome, 'quit');
  assert.equal(traceTickCount(provisional.trace), 300);
  assert.ok(sr.active, 'a provisional flush must NOT close the recording');

  for (let i = 0; i < 300; i++) sr.captureTick(thrust());   // the player came back and kept playing
  const final = sr.flush('win', { kills: 4, durationMs: 11000 });
  assert.ok(final);
  assert.equal(final.id, provisional.id, 'same session id → the server upserts one row');
  assert.equal(final.outcome, 'win');
  assert.equal(traceTickCount(final.trace), 600, 'the final trace holds the WHOLE session, not just the tail');
  assert.equal(sr.flush('quit', {}, { final: false }), null, 'nothing more goes out after the final flush');
});

// Tab-switching re-fires the hidden flush, and the game auto-pauses while hidden, so the trace is usually
// unchanged — re-uploading it every time would be pure waste on a metered mobile connection.
test('a provisional flush with no new ticks since the last one sends nothing', () => {
  const sr = makeSessionRecorder();
  sr.begin({ seed: 1, level: 'level-0', dt: 1 / 60 });
  for (let i = 0; i < 200; i++) sr.captureTick(snap());
  assert.ok(sr.flush('quit', {}, { final: false }));
  assert.equal(sr.flush('quit', {}, { final: false }), null, 'nothing changed → no second upload');
  sr.captureTick(thrust());
  assert.ok(sr.flush('quit', {}, { final: false }), 'a new tick makes it worth re-sending');
  assert.ok(sr.flush('win'), 'a FINAL flush always goes out — the outcome itself is the news');
});

// A provisional flush hands the transport a trace while the recorder keeps mutating its runs — the trace
// must be a copy, or the uploaded payload would grow behind the transport's back.
test('a flushed trace is not mutated by continued recording', () => {
  const sr = makeSessionRecorder();
  sr.begin({ seed: 1, level: 'level-0', dt: 1 / 60 });
  for (let i = 0; i < 200; i++) sr.captureTick(snap());
  const trace = sr.flush('quit', {}, { final: false }).trace;
  for (let i = 0; i < 500; i++) sr.captureTick(snap());     // same input → would extend the shared run
  assert.equal(traceTickCount(trace), 200);
});

test('cap: appends stop at MAX_SESSION_TICKS', () => {
  const sr = makeSessionRecorder();
  sr.begin({ seed: 1, level: 'level-0', dt: 1 / 60 });
  for (let i = 0; i < MAX_SESSION_TICKS + 500; i++) sr.captureTick(snap());
  assert.equal(sr.tickCount, MAX_SESSION_TICKS);
});

// Continuous analog input (a finger on the virtual stick) never repeats, so the TICK cap would not bind
// before memory did — the run cap is what bounds it there.
test('cap: an all-distinct input stream stops at MAX_SESSION_RUNS', () => {
  const sr = makeSessionRecorder();
  sr.begin({ seed: 1, level: 'level-0', dt: 1 / 60 });
  for (let i = 0; i < MAX_SESSION_RUNS + 500; i++) sr.captureTick({ k: [], t: [i / 1000, 1] });
  assert.equal(sr.runs.length, MAX_SESSION_RUNS);
  assert.equal(sr.tickCount, MAX_SESSION_RUNS);
});

test('flush() before any begin() returns null', () => {
  const sr = makeSessionRecorder();
  assert.equal(sr.flush('quit'), null);
});

test('the recorder carries the run\'s skill allocation into the trace', () => {
  // The plumbing half of the v4 fix. A session recorded without `skills` replays on a different ship —
  // Maneuver alone shifts the seeded stream and moves every later enemy spawn — which is what made admin
  // session playback look like the pilot was fighting ghosts.
  const sr = makeSessionRecorder();
  sr.begin({ seed: 7, level: 'level-2', shipId: 1, loadout: { mounts: [] }, components: {},
             skills: { kinetic: 2, maneuver: 3 }, dt: 1 / 60 });
  for (let i = 0; i < 300; i++) sr.captureTick({ k: [], t: null });
  const out = sr.flush('win', { durationMs: 1000, kills: 3 });
  assert.ok(out, 'flushed');
  assert.deepEqual(out.trace.skills, { kinetic: 2, maneuver: 3 });

  // …and a player with nothing spent records null, which is also how pre-v4 traces read.
  const bare = makeSessionRecorder();
  bare.begin({ seed: 7, level: 'level-2', shipId: 1, dt: 1 / 60 });
  for (let i = 0; i < 300; i++) bare.captureTick({ k: [], t: null });
  assert.equal(bare.flush('win', { durationMs: 1000, kills: 0 }).trace.skills, null);
});
