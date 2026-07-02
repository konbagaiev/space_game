import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { evalDev } from './dev.js';

// Map-backed fake localStorage: getItem returns null for a missing key (like the real API).
const fake = () => { const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('evalDev: bare ?dev turns on and sets the sticky flag', () => {
  const s = fake();
  assert.equal(evalDev('?dev', s), true);
  assert.equal(s.getItem('devMode'), '1'); // sticky set
});

test('evalDev: ?dev=true and ?dev=1 are truthy', () => {
  assert.equal(evalDev('?dev=true', fake()), true);
  assert.equal(evalDev('?dev=1', fake()), true);
});

test('evalDev: ?dev=false / ?dev=0 turn off and clear the stored flag', () => {
  const s1 = fake(); s1.setItem('devMode', '1');
  assert.equal(evalDev('?dev=false', s1), false);
  assert.equal(s1.getItem('devMode'), null); // cleared

  const s2 = fake(); s2.setItem('devMode', '1');
  assert.equal(evalDev('?dev=0', s2), false);
  assert.equal(s2.getItem('devMode'), null);
});

test('evalDev: no dev param → the stored flag decides (stickiness / default off)', () => {
  const on = fake(); on.setItem('devMode', '1');
  assert.equal(evalDev('', on), true);
  assert.equal(evalDev('', fake()), false); // default off
});

test('evalDev: an unrecognized value falls back to the stored flag', () => {
  const on = fake(); on.setItem('devMode', '1');
  assert.equal(evalDev('?dev=bogus', on), true);
  assert.equal(evalDev('?dev=bogus', fake()), false);
});

test('evalDev: ?dev with no storage returns true without throwing (private mode)', () => {
  assert.equal(evalDev('?dev', null), true);
});
