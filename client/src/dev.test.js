import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { evalDev } from './dev.js';

// `?dev` is deliberately NOT sticky (DECISIONS §81): it governs diagnostics for the current page load and
// nothing else. These cases pin that. The flag used to persist in localStorage, which left the perf
// overlay, the right-docked lil-gui panels and the per-second telemetry running on the LIVE SITE forever
// after a single `?dev` visit — for the maintainer and for any playtester handed a `?dev` link.

test('evalDev: a truthy ?dev in the URL turns diagnostics on', () => {
  assert.equal(evalDev('?dev'), true);           // bare flag
  assert.equal(evalDev('?dev=true'), true);
  assert.equal(evalDev('?dev=1'), true);
  assert.equal(evalDev('?level=3&dev=1'), true); // alongside other params
});

test('evalDev: no dev param means off', () => {
  assert.equal(evalDev(''), false);
  assert.equal(evalDev('?playback&id=x'), false);
});

test('evalDev: an explicit off value is off', () => {
  assert.equal(evalDev('?dev=false'), false);
  assert.equal(evalDev('?dev=0'), false);
});

test('evalDev: an unrecognized value is off — only the documented truthy forms count', () => {
  assert.equal(evalDev('?dev=yes'), false);
  assert.equal(evalDev('?dev=2'), false);
});

test('evalDev: the decision is storage-free, so nothing can make it sticky again', () => {
  // The URL is the ONLY input. A leftover `devMode` key (or any future storage argument) must not be able
  // to turn diagnostics on, which is the whole point of §81.
  assert.equal(evalDev.length, 1, 'evalDev takes only the query string');
  const stuck = { getItem: () => '1', setItem: () => { throw new Error('must never write'); } };
  assert.equal(evalDev('', stuck), false);
});
