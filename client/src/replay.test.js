import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACE_VERSION, normalizeLevelName, evalRecord, evalPlayback,
  snapshotInput, applyInput, makeTrace, validateTrace, makeReplaySession, stepReplayTick,
  RETURN_HOME_STALL_TICKS, packTicks, unpackTicks, sameInput, hydrateTrace, traceTickCount, traceLevelName,
} from './replay.js';

// A bare number is the campaign level number itself (0 = the intro), so `3` is `level-3` — since the
// 0-based renumbering there is no offset to apply anywhere. Empty/absent still means the intro.
test('normalizeLevelName maps bare numbers to level-N and passes names through', () => {
  assert.equal(normalizeLevelName('1'), 'level-1');
  assert.equal(normalizeLevelName(3), 'level-3');
  assert.equal(normalizeLevelName('level-1'), 'level-1');
  assert.equal(normalizeLevelName('  4 '), 'level-4');
  assert.equal(normalizeLevelName(''), 'level-0');
  assert.equal(normalizeLevelName(null), 'level-0');
});

test('evalRecord parses ?record + level, honors the off switches', () => {
  assert.deepEqual(evalRecord('?record=1&level=1'), { level: 'level-1' });
  assert.deepEqual(evalRecord('?record&level=level-2'), { level: 'level-2' });
  assert.deepEqual(evalRecord('?record=1'), { level: 'level-0' }); // no level → intro default
  assert.equal(evalRecord('?record=0&level=1'), null);
  assert.equal(evalRecord('?record=false'), null);
  assert.equal(evalRecord('?playback&id=x'), null);
  assert.equal(evalRecord(''), null);
});

test('evalPlayback parses ?playback&id, the ?playback=id shorthand, and &finish', () => {
  assert.deepEqual(evalPlayback('?playback&id=level-0-123'), { id: 'level-0-123', finish: false });
  assert.deepEqual(evalPlayback('?playback=level-0-123'), { id: 'level-0-123', finish: false });
  assert.deepEqual(evalPlayback('?playback'), { id: null, finish: false });   // bare → last recording
  assert.deepEqual(evalPlayback('?playback=1'), { id: null, finish: false }); // ?playback=1 is the on-flag, not an id
  assert.deepEqual(evalPlayback('?playback&id=r1&finish'), { id: 'r1', finish: true });
  assert.deepEqual(evalPlayback('?playback&id=r1&finish=1'), { id: 'r1', finish: true });
  assert.deepEqual(evalPlayback('?playback&id=r1&finish=0'), { id: 'r1', finish: false });
  assert.equal(evalPlayback('?record=1'), null);
  assert.equal(evalPlayback(''), null);
});

test('snapshotInput captures held keys + touch aim', () => {
  const keys = { KeyW: true, KeyA: false, Space: true };
  assert.deepEqual(snapshotInput(keys, { active: false }), { k: ['KeyW', 'Space'], t: null });
  assert.deepEqual(
    snapshotInput({}, { active: true, heading: 1.5, thrust: 0.8 }),
    { k: [], t: [1.5, 0.8] },
  );
});

test('applyInput clears then sets keys and restores touch aim in place', () => {
  const keys = { KeyW: true, KeyD: true };
  const touch = { active: true, heading: 9, thrust: 9 };
  applyInput({ k: ['Space'], t: null }, keys, touch);
  assert.equal(keys.KeyW, false);
  assert.equal(keys.KeyD, false);
  assert.equal(keys.Space, true);
  assert.equal(touch.active, false);

  applyInput({ k: [], t: [2.0, 0.5] }, keys, touch);
  assert.equal(keys.Space, false);
  assert.equal(touch.active, true);
  assert.equal(touch.heading, 2.0);
  assert.equal(touch.thrust, 0.5);
});

test('snapshot → apply round-trips the input state', () => {
  const src = { KeyW: true, ShiftLeft: true };
  const snap = snapshotInput(src, { active: true, heading: 0.3, thrust: 1 });
  const dst = {};
  const touch = { active: false, heading: 0, thrust: 0 };
  applyInput(snap, dst, touch);
  assert.equal(dst.KeyW, true);
  assert.equal(dst.ShiftLeft, true);
  assert.deepEqual([touch.heading, touch.thrust], [0.3, 1]);
});

test('makeTrace stamps version/kind and coerces the seed to uint32', () => {
  const t = makeTrace({ id: 'r1', level: '1', seed: -1, dt: 1 / 60, shipId: 2, ticks: [{ k: [], t: null }] });
  assert.equal(t.version, TRACE_VERSION);
  assert.equal(t.kind, 'input-replay');
  assert.equal(t.level, 'level-1');
  assert.equal(t.seed, 4294967295); // -1 >>> 0
  assert.equal(t.shipId, 2);
  assert.equal(traceTickCount(t), 1);
});

test('validateTrace accepts a good trace and flags the broken ones', () => {
  const good = makeTrace({ id: 'r', level: 'level-0', seed: 123, dt: 1 / 60, shipId: 1, ticks: [{ k: ['KeyW'], t: null }] });
  assert.deepEqual(validateTrace(good), []);

  assert.deepEqual(validateTrace(null), ['trace is not an object']);
  assert.ok(validateTrace({ ...good, kind: 'transform' }).some((p) => p.includes('kind')));
  assert.ok(validateTrace({ ...good, seed: NaN }).some((p) => p.includes('seed')));
  assert.ok(validateTrace({ ...good, dt: 0 }).some((p) => p.includes('dt')));
  assert.ok(validateTrace({ ...good, runs: [] }).some((p) => p.includes('empty')));
  assert.ok(validateTrace({ ...good, runs: [[{ k: [], t: null }, 0]] }).some((p) => p.includes('malformed')));
  assert.ok(validateTrace({ ...good, tickCount: 0 }).some((p) => p.includes('tickCount')));
  assert.ok(validateTrace({ ...good, version: 99 }).some((p) => p.includes('version')));
});

// ---- Run-length packed ticks (v2) + v1 back-compat ----------------------------------------------------
// Input changes ~2×/s while we capture 60 ticks/s, so packing is what makes a whole session fit in an
// upload (and keeps the live recorder's retained memory flat on a weak device).

test('packTicks collapses repeats; unpackTicks restores every tick in order', () => {
  const ticks = [
    ...Array.from({ length: 100 }, () => ({ k: [], t: null })),
    ...Array.from({ length: 50 }, () => ({ k: ['KeyW'], t: null })),
    ...Array.from({ length: 10 }, () => ({ k: [], t: null })),
  ];
  const runs = packTicks(ticks);
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((r) => r[1]), [100, 50, 10]);
  assert.deepEqual(unpackTicks(runs), ticks);
});

test('sameInput compares held keys positionally and the touch aim by value', () => {
  assert.ok(sameInput({ k: ['KeyW', 'KeyA'], t: null }, { k: ['KeyW', 'KeyA'], t: null }));
  assert.ok(!sameInput({ k: ['KeyW'], t: null }, { k: ['KeyW', 'KeyA'], t: null }));
  assert.ok(!sameInput({ k: [], t: null }, { k: [], t: [0.5, 1] }));
  assert.ok(sameInput({ k: [], t: [0.5, 1] }, { k: [], t: [0.5, 1] }));
  assert.ok(!sameInput({ k: [], t: [0.5, 1] }, { k: [], t: [0.5, 0.9] }));
});

// The touch aim is quantized before storage — without it an analog stick emits a distinct value every tick
// and the packing (the thing that keeps a tablet's session small enough to upload) does nothing at all.
test('snapshotInput quantizes the touch aim, so a barely-moved stick still packs', () => {
  const a = snapshotInput({}, { active: true, heading: 1.2345678, thrust: 0.876543 });
  const b = snapshotInput({}, { active: true, heading: 1.2345111, thrust: 0.878000 });
  assert.deepEqual(a.t, [1.235, 0.88]);
  assert.ok(sameInput(a, b), 'sub-quantum stick jitter must not start a new run');
  assert.equal(packTicks([a, b]).length, 1);
});

test('hydrateTrace expands a v2 trace and passes a v1 trace through untouched', () => {
  const v2 = makeTrace({ id: 'r', level: 'level-0', seed: 1, dt: 1 / 60, ticks: [{ k: ['KeyW'], t: null }, { k: ['KeyW'], t: null }] });
  assert.equal(v2.runs.length, 1);
  const h = hydrateTrace(v2);
  assert.equal(h.ticks.length, 2);
  assert.equal(hydrateTrace(h), h, 'idempotent: an already-hydrated trace is returned as-is');

  // A v1 trace (the shipped Level-0 intro asset + every session recorded before 2026-08-03) stays playable.
  const v1 = { version: 1, kind: 'input-replay', id: 'old', level: 'level-0', seed: 5, dt: 1 / 60,
    shipId: 1, loadout: null, components: null, ticks: [{ k: [], t: null }] };
  assert.deepEqual(validateTrace(v1), []);
  assert.equal(hydrateTrace(v1), v1);
});

// The regression this format exists for: a long session used to serialize past the ~64KB unload-beacon cap
// after ~34 seconds of play, and was silently dropped. Packed, ten minutes fits with room to spare.
test('a 10-minute session serializes far under the 64KB beacon cap', () => {
  const ticks = [];
  for (let i = 0; i < 36000; i++) ticks.push(i % 300 < 150 ? { k: ['KeyW'], t: null } : { k: ['KeyW', 'Space'], t: null });
  const trace = makeTrace({ id: 'long', level: 'level-0', seed: 1, dt: 1 / 60, ticks });
  const bytes = JSON.stringify(trace).length;
  assert.equal(traceTickCount(trace), 36000);
  assert.ok(bytes < 65536, `packed 10-minute trace should fit a beacon, got ${bytes} bytes`);
});

test('makeReplaySession: fresh session is inactive; teardown clears every field', () => {
  const s = makeReplaySession();
  assert.equal(s.active, false);

  // simulate an ACTIVE ?playback&finish session flying home (the state a teardown must fully clear)
  s.play = { id: 'level-0-abc', finish: true };
  s.trace = { ticks: [{}, {}] };
  s.armed = true; s.index = 5; s.done = true;
  s.autoFinish = true; s.returning = true; s.stallTicks = 42;
  assert.equal(s.active, true);

  s.teardown();
  assert.equal(s.active, false);
  // deepEqual the owned fields back to a fresh session's defaults — this is what catches a forgotten reset
  const fresh = makeReplaySession();
  for (const k of ['play', 'trace', 'armed', 'index', 'done', 'autoFinish', 'returning', 'stallTicks'])
    assert.deepEqual(s[k], fresh[k], `teardown must reset ${k}`);
});

test('makeReplaySession: return-home watchdog counts consecutive stalled ticks and trips at the limit', () => {
  const s = makeReplaySession();
  assert.equal(s.stallTicks, 0);
  assert.equal(s.stalled(), false);

  // returning home without a win → the counter climbs
  assert.equal(s.noteTick(true), 1);
  assert.equal(s.noteTick(true), 2);
  // any tick that is NOT "returning and not won" resets it (a fight in progress can't trip the watchdog)
  assert.equal(s.noteTick(false), 0);
  assert.equal(s.stalled(), false);

  // it trips exactly AT the limit, not before
  for (let i = 0; i < RETURN_HOME_STALL_TICKS - 1; i++) s.noteTick(true);
  assert.equal(s.stallTicks, RETURN_HOME_STALL_TICKS - 1);
  assert.equal(s.stalled(), false);
  s.noteTick(true);
  assert.equal(s.stalled(), true);
  // 900 ticks == 15 s of sim time at the fixed 1/60 step — must clear a legitimate flight home (~7-8 s)
  assert.equal(RETURN_HOME_STALL_TICKS, 900);
  assert.ok(RETURN_HOME_STALL_TICKS / 60 >= 15);
  // an explicit limit is honored (the callers use the default)
  assert.equal(s.stalled(RETURN_HOME_STALL_TICKS + 1), false);

  s.teardown();
  assert.equal(s.stalled(), false);
});

// ---------- stepReplayTick: the ONE per-tick body both drivers in main.js run -------------------------
// The fixed-timestep accumulator in animate() and the window.__replay.step(n) hook used to carry two hand-
// written copies of this ("mirror the accumulator"), so an edit to one silently desynced replays. These are
// the only automated guard the de-duplication can have — the accumulator itself is DOM/rAF-bound.
// A real makeReplaySession() is used throughout so noteTick/stalled are exercised for real.
function tickHarness(over = {}) {
  const log = [];
  const rs = makeReplaySession();
  const keys = {};
  const touchAim = { active: false, heading: 0, thrust: 0 };
  const deps = {
    rs, keys, touchAim, dt: 1 / 60,
    update: (dt) => log.push(`update:${dt}`),
    capture: () => log.push('capture'),
    onTick: () => log.push('onTick'),
    isCleared: () => false,
    isWon: () => false,
    finish: () => log.push('finish'),
    ...over,
  };
  return { rs, keys, touchAim, deps, log, calls: (name) => log.filter((e) => e.split(':')[0] === name).length };
}

test('stepReplayTick: finished playback is a no-op (the entry guard)', () => {
  const h = tickHarness();
  h.rs.play = {}; h.rs.trace = { ticks: [{ k: ['KeyW'] }] }; h.rs.done = true; h.rs.index = 0;
  assert.equal(stepReplayTick(h.deps), 'stop');
  assert.equal(h.calls('update'), 0);
  assert.equal(h.rs.index, 0);
});

test('stepReplayTick: an exhausted trace stops the loop and marks the session done, without stepping', () => {
  const h = tickHarness();
  h.rs.play = {}; h.rs.trace = { ticks: [{ k: [] }, { k: [] }] }; h.rs.index = 2;
  assert.equal(stepReplayTick(h.deps), 'stop');
  assert.equal(h.rs.done, true);
  assert.equal(h.calls('update'), 0);
});

test('stepReplayTick: a normal playback tick applies the recorded input, steps once, advances the index', () => {
  const h = tickHarness();
  h.rs.play = {}; h.rs.trace = { ticks: [{ k: ['KeyA'], t: null }, { k: ['KeyD'], t: null }] };
  assert.equal(stepReplayTick(h.deps), 'ok');
  assert.equal(h.keys.KeyA, true);       // the recorded tick reached the shared key map
  assert.deepEqual(h.log.filter((e) => e.startsWith('update')), ['update:' + (1 / 60)]); // exactly once, with the passed dt
  assert.equal(h.rs.index, 1);
});

test('stepReplayTick: rs.returning clears the input and freezes the trace index (autopilot flies home)', () => {
  const h = tickHarness();
  h.rs.play = {}; h.rs.trace = { ticks: [{ k: ['KeyW'], t: null }] };
  h.rs.returning = true;
  h.keys.KeyW = true; h.keys.Space = true; h.touchAim.active = true;
  assert.equal(stepReplayTick(h.deps), 'ok');
  assert.equal(h.keys.KeyW, false);      // NOT re-applied from the trace — every held key is released
  assert.equal(h.keys.Space, false);
  assert.equal(h.touchAim.active, false);
  assert.equal(h.calls('update'), 1);
  assert.equal(h.rs.index, 0);           // the index is frozen while flying home
});

test('stepReplayTick: the per-tick order is update → capture → onTick', () => {
  const h = tickHarness();
  assert.equal(stepReplayTick(h.deps), 'ok');
  assert.deepEqual(h.log, ['update:' + (1 / 60), 'capture', 'onTick']);
});

// ?playback&finish — a trace records keys and touch, never the MOUSE CLICK that ends a mission, so a
// winning replay would sit in a cleared sector forever. This is the whole of that behaviour.
test('stepReplayTick: &finish presses Finish and Return when the sector clears, and stops on the win', () => {
  let cleared = false, won = false;
  const h = tickHarness({ isCleared: () => cleared, isWon: () => won });
  h.rs.play = { id: 'r1', finish: true }; h.rs.autoFinish = true;
  h.rs.trace = { ticks: Array.from({ length: 10 }, () => ({ k: [], t: null })) };

  assert.equal(stepReplayTick(h.deps), 'ok');
  assert.equal(h.calls('finish'), 0, 'nothing is pressed while the fight is live');
  assert.equal(h.rs.returning, false);

  cleared = true;
  assert.equal(stepReplayTick(h.deps), 'ok');
  assert.equal(h.calls('finish'), 1, 'the button is pressed the tick the sector clears');
  assert.equal(h.rs.returning, true);

  assert.equal(stepReplayTick(h.deps), 'ok');
  assert.equal(h.calls('finish'), 1, 'and exactly once');

  won = true;
  assert.equal(stepReplayTick(h.deps), 'stop', 'the docking ends the playback');
  assert.equal(h.rs.done, true);
});

test('stepReplayTick: WITHOUT &finish nothing is pressed — a plain playback just freezes on the last frame', () => {
  const h = tickHarness({ isCleared: () => true, isWon: () => false });
  h.rs.play = { id: 'r1', finish: false };   // autoFinish stays false
  h.rs.trace = { ticks: [{ k: [], t: null }, { k: [], t: null }] };
  assert.equal(stepReplayTick(h.deps), 'ok');
  assert.equal(h.calls('finish'), 0);
  assert.equal(h.rs.returning, false);
  assert.equal(h.rs.stallTicks, 0, 'and the watchdog does not run at all');
});

test('stepReplayTick: live/record mode (rs.play === null) applies no trace input but still captures', () => {
  const h = tickHarness();
  h.rs.trace = { ticks: [{ k: ['KeyW'], t: null }] }; // a stale trace with no rs.play must not drive live play
  assert.equal(stepReplayTick(h.deps), 'ok');
  assert.equal(h.keys.KeyW, undefined);
  assert.equal(h.rs.index, 0);
  assert.equal(h.calls('capture'), 1);
});

test('stepReplayTick: the return-home watchdog trips exactly at RETURN_HOME_STALL_TICKS, and a win resets it', () => {
  const h = tickHarness({ isWon: () => false });
  h.rs.autoFinish = true; h.rs.returning = true;
  for (let i = 0; i < RETURN_HOME_STALL_TICKS - 1; i++) assert.equal(stepReplayTick(h.deps), 'ok');
  assert.equal(h.rs.done, false);
  assert.equal(stepReplayTick(h.deps), 'stop');   // the limit tick
  assert.equal(h.rs.done, true);

  // while the level IS won the counter never climbs, so the watchdog can't fire on a healthy flight home…
  const w = tickHarness({ isWon: () => true });
  w.rs.autoFinish = true; w.rs.returning = true;
  assert.equal(stepReplayTick(w.deps), 'stop', 'a won flight home ends the playback on the spot');
  assert.equal(w.rs.stallTicks, 0);
});

// Live play after the intro (finishIntro → rs.teardown() nulled rs.play, THEN the caller set rs.done = true)
// must keep stepping — the old bare `!rs.done` guard in the step() hook would have frozen it (the
// intro→Level-1 dead-controls bug, guarded live by visual/scenarios/29-intro-live-handoff.mjs). This is the
// one claim the unified entry guard rests on, so it gets a test rather than an argument.
test('stepReplayTick: the post-intro teardown state (rs.play=null, rs.done=true) still steps', () => {
  const h = tickHarness();
  h.rs.play = null; h.rs.done = true;
  assert.equal(stepReplayTick(h.deps), 'ok');
  assert.equal(h.calls('update'), 1);
});

// ---------- traceLevelName: replaying archives recorded before the 0-based renumbering ----------
// A trace stores the level NAME it was recorded on. When the campaign went 0-based every level moved down
// one, so a v1/v2 trace's stored name points at the wrong level today — replaying the shipped intro asset
// ("level-1") would have loaded "Level 1" and re-simmed a fight its recorded input never fought. That is a
// silent failure: the replay runs, it just runs the wrong level.
test('traceLevelName shifts a pre-v3 trace down one, and leaves v3+ alone', () => {
  assert.equal(traceLevelName({ version: 1, level: 'level-1' }), 'level-0', 'the shipped v1 intro asset');
  assert.equal(traceLevelName({ version: 2, level: 'level-4' }), 'level-3', 'a v2 session recording');
  assert.equal(traceLevelName({ version: TRACE_VERSION, level: 'level-1' }), 'level-1', 'a trace recorded today means what it says');
  assert.equal(traceLevelName({ version: 99, level: 'level-2' }), 'level-2', 'and so does a future one');
});

test('traceLevelName never shifts below the intro, or mangles an unexpected shape', () => {
  assert.equal(traceLevelName({ version: 1, level: 'level-0' }), 'level-0', 'no legacy trace named level-0 — pass it through');
  assert.equal(traceLevelName({ version: 1, level: 'side-mining' }), 'side-mining', 'a non level-N name is not a campaign level');
  assert.equal(traceLevelName({ version: 1 }), 'level-0', 'a missing level falls back to the intro');
  assert.equal(traceLevelName(null), 'level-0');
});

test('a trace written today is v4 — the marker consumers key off', () => {
  const t = makeTrace({ id: 'r', level: 'level-2', seed: 1, dt: 1 / 60, ticks: [{ k: [], t: null }] });
  assert.equal(t.version, 4, 'bumping TRACE_VERSION is what tells old recordings apart from new ones');
  assert.equal(traceLevelName(t), 'level-2', 'so a fresh recording is never shifted (the v3 renumbering)');
});

test('a trace carries the skill allocation the run was played with', () => {
  // Without this a replay rebuilds a DIFFERENT ship: skills change engine power, weapon damage, shield
  // capacity and — through Maneuver's dodge — whether the hostile-hit roll draws from the seeded stream at
  // all. Measured on the Level-0 trace: Maneuver 3 turns 4 kills into 3 and kills the player.
  const skills = { kinetic: 2, maneuver: 3 };
  const t = makeTrace({ id: 'r', level: 'level-1', seed: 1, dt: 1 / 60, shipId: 1, skills, ticks: [{ k: [], t: null }] });
  assert.deepEqual(t.skills, skills);
  assert.equal(validateTrace(t).length, 0);
  // Absent is legal and means "none spent" — that is how every pre-v4 recording has to be read.
  const none = makeTrace({ id: 'r', level: 'level-1', seed: 1, dt: 1 / 60, ticks: [{ k: [], t: null }] });
  assert.equal(none.skills, null);
  assert.equal(validateTrace(none).length, 0);
  assert.deepEqual(validateTrace({ ...none, skills: 'three' }), ['skills is present but not an object']);
});
