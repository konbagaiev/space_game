// `?stationmat=` rung parsing (client/src/station-mat.js). Pure — no three, no DOM, so `node --test` can
// actually load it. What matters here beyond the happy path is the TYPO case: a measurement flag that
// silently does nothing is the exact class of bug this whole feature exists to fix (the combat preset's
// `textureSize: 256` was a silent no-op for the base station's entire life).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalStationMat, STATION_MAT_RUNGS } from './station-mat.js';

// Collects the warnings so a test can assert the flag SAID something rather than shrugging.
const spy = () => { const calls = []; const fn = (m) => calls.push(m); fn.calls = calls; return fn; };

test('absent / explicit-off values all mean the default rung, silently', () => {
  for (const search of ['', '?debug', '?stationmat=standard', '?stationmat=0', '?stationmat=off',
                        '?stationmat=false', '?stationmat=OFF']) {
    const warn = spy();
    assert.equal(evalStationMat(search, warn), 'standard', search);
    assert.equal(warn.calls.length, 0, `${search} must not warn — it is a legitimate way to say "default"`);
  }
});

test('each rung resolves to itself, case-insensitively', () => {
  const warn = spy();
  for (const rung of STATION_MAT_RUNGS) assert.equal(evalStationMat(`?stationmat=${rung}`, warn), rung);
  assert.equal(evalStationMat('?stationmat=LEAN', warn), 'lean');
  assert.equal(evalStationMat('?debug&stationmat=phong&lights=16', warn), 'phong');
  assert.equal(warn.calls.length, 0);
});

test('a typo (and a bare ?stationmat) falls back to standard AND warns, naming the rungs', () => {
  for (const search of ['?stationmat=cheap', '?stationmat', '?stationmat=']) {
    const warn = spy();
    assert.equal(evalStationMat(search, warn), 'standard', search);
    assert.equal(warn.calls.length, 1, `${search} must warn exactly once`);
    for (const rung of STATION_MAT_RUNGS) assert.match(warn.calls[0], new RegExp(rung));
  }
});

test('the default is itself a rung name, so a driver can walk the ladder from the exported list', () => {
  assert.equal(STATION_MAT_RUNGS[0], 'standard');
  assert.deepEqual(STATION_MAT_RUNGS, ['standard', 'lean', 'phong', 'basic']);
});
