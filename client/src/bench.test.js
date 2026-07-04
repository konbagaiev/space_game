import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { evalBench, mulberry32 } from './bench.js';

// Map-backed fake sessionStorage: getItem returns null for a missing key (like the real API).
const fake = () => { const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('evalBench: ?bench=record / ?bench=replay set the mode and the sticky flag', () => {
  const s1 = fake();
  assert.equal(evalBench('?bench=record', s1), 'record');
  assert.equal(s1.getItem('benchMode'), 'record');

  const s2 = fake();
  assert.equal(evalBench('?bench=replay', s2), 'replay');
  assert.equal(s2.getItem('benchMode'), 'replay');
});

test('evalBench: ?bench=off / =false / =0 clear the stored flag and return null', () => {
  for (const v of ['off', 'false', '0']) {
    const s = fake(); s.setItem('benchMode', 'replay');
    assert.equal(evalBench(`?bench=${v}`, s), null);
    assert.equal(s.getItem('benchMode'), null);
  }
});

test('evalBench: no bench param → the stored flag decides (stickiness / default off)', () => {
  const rec = fake(); rec.setItem('benchMode', 'record');
  assert.equal(evalBench('', rec), 'record');
  assert.equal(evalBench('', fake()), null); // default off
});

test('evalBench: an unrecognized value falls back to the stored flag', () => {
  const rep = fake(); rep.setItem('benchMode', 'replay');
  assert.equal(evalBench('?bench=bogus', rep), 'replay');
  assert.equal(evalBench('?bench=bogus', fake()), null);
  // a bogus stored value is treated as off, not honored
  const bad = fake(); bad.setItem('benchMode', 'nonsense');
  assert.equal(evalBench('', bad), null);
});

test('mulberry32: same seed reproduces the same sequence; different seeds diverge', () => {
  const a = mulberry32(1234567), b = mulberry32(1234567);
  const seqA = Array.from({ length: 8 }, () => a());
  const seqB = Array.from({ length: 8 }, () => b());
  assert.deepEqual(seqA, seqB);

  const c = mulberry32(7654321);
  const seqC = Array.from({ length: 8 }, () => c());
  assert.notDeepEqual(seqA, seqC);

  // outputs are in [0, 1)
  for (const x of seqA) { assert.ok(x >= 0 && x < 1); }
});
