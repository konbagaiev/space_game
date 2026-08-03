import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeSessionRecorder, MIN_SESSION_TICKS, MAX_SESSION_TICKS,
} from './session-record.js';

const snap = () => ({ k: [], t: null });

test('begin → 200 ticks → end(win) returns a full payload', () => {
  const sr = makeSessionRecorder();
  sr.begin({ seed: 12345, level: 'level-2', shipId: 3, loadout: null, components: null, dt: 1 / 60 });
  for (let i = 0; i < 200; i++) sr.captureTick(snap());
  const payload = sr.end('win', { kills: 3, durationMs: 9000 });
  assert.ok(payload);
  assert.equal(payload.trace.ticks.length, 200);
  assert.equal(payload.trace.seed, 12345);
  assert.equal(payload.trace.dt, 1 / 60);
  assert.equal(payload.trace.level, 'level-2');
  assert.equal(payload.level, 'level-2');
  assert.equal(payload.outcome, 'win');
  assert.equal(payload.kills, 3);
  assert.equal(payload.durationMs, 9000);
});

test('below the floor is a trivial bounce → dropped (null)', () => {
  const sr = makeSessionRecorder();
  sr.begin({ seed: 1, level: 'level-1', dt: 1 / 60 });
  for (let i = 0; i < 10; i++) sr.captureTick(snap());
  assert.equal(sr.end('quit'), null);
});

test('double-flush guard: a second end() returns null', () => {
  const sr = makeSessionRecorder();
  sr.begin({ seed: 1, level: 'level-1', dt: 1 / 60 });
  for (let i = 0; i < MIN_SESSION_TICKS; i++) sr.captureTick(snap());
  assert.ok(sr.end('win'));
  assert.equal(sr.end('quit'), null);
});

test('cap: appends stop at MAX_SESSION_TICKS', () => {
  const sr = makeSessionRecorder();
  sr.begin({ seed: 1, level: 'level-1', dt: 1 / 60 });
  for (let i = 0; i < MAX_SESSION_TICKS + 500; i++) sr.captureTick(snap());
  assert.equal(sr.ticks.length, MAX_SESSION_TICKS);
});

test('end() before any begin() returns null', () => {
  const sr = makeSessionRecorder();
  assert.equal(sr.end('quit'), null);
});
