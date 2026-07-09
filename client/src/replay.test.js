import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACE_VERSION, normalizeLevelName, evalRecord, evalPlayback,
  snapshotInput, applyInput, makeTrace, validateTrace,
} from './replay.js';

test('normalizeLevelName maps bare numbers to level-N and passes names through', () => {
  assert.equal(normalizeLevelName('1'), 'level-1');
  assert.equal(normalizeLevelName(3), 'level-3');
  assert.equal(normalizeLevelName('level-2'), 'level-2');
  assert.equal(normalizeLevelName('  4 '), 'level-4');
  assert.equal(normalizeLevelName(''), 'level-1');
  assert.equal(normalizeLevelName(null), 'level-1');
});

test('evalRecord parses ?record + level, honors the off switches', () => {
  assert.deepEqual(evalRecord('?record=1&level=1'), { level: 'level-1' });
  assert.deepEqual(evalRecord('?record&level=level-3'), { level: 'level-3' });
  assert.deepEqual(evalRecord('?record=1'), { level: 'level-1' }); // no level → intro default
  assert.equal(evalRecord('?record=0&level=1'), null);
  assert.equal(evalRecord('?record=false'), null);
  assert.equal(evalRecord('?playback&id=x'), null);
  assert.equal(evalRecord(''), null);
});

test('evalPlayback parses ?playback&id and the ?playback=id shorthand', () => {
  assert.deepEqual(evalPlayback('?playback&id=level-1-123'), { id: 'level-1-123' });
  assert.deepEqual(evalPlayback('?playback=level-1-123'), { id: 'level-1-123' });
  assert.deepEqual(evalPlayback('?playback'), { id: null });       // bare → last recording
  assert.deepEqual(evalPlayback('?playback=1'), { id: null });     // ?playback=1 is the on-flag, not an id
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
  assert.equal(t.ticks.length, 1);
});

test('validateTrace accepts a good trace and flags the broken ones', () => {
  const good = makeTrace({ id: 'r', level: 'level-1', seed: 123, dt: 1 / 60, shipId: 1, ticks: [{ k: ['KeyW'], t: null }] });
  assert.deepEqual(validateTrace(good), []);

  assert.deepEqual(validateTrace(null), ['trace is not an object']);
  assert.ok(validateTrace({ ...good, kind: 'transform' }).some((p) => p.includes('kind')));
  assert.ok(validateTrace({ ...good, seed: NaN }).some((p) => p.includes('seed')));
  assert.ok(validateTrace({ ...good, dt: 0 }).some((p) => p.includes('dt')));
  assert.ok(validateTrace({ ...good, ticks: [] }).some((p) => p.includes('empty')));
  assert.ok(validateTrace({ ...good, version: 99 }).some((p) => p.includes('version')));
});
