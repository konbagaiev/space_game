import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { median, bucketVerdict, loadVerdict, analyzeMode } from './stats.mjs';

// Scale an array by a factor (B = A * (1+delta)) to synthesize a known regression/improvement.
const scale = (arr, f) => arr.map((x) => x * f);
const A = [1.00, 1.00, 1.00, 1.00, 1.00, 1.00]; // clean baseline (zero within-build variance → tight CI)

test('median: odd + even length', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
});

test('bucketVerdict: B +11% → REGRESSION', () => {
  const v = bucketVerdict(A, scale(A, 1.11));
  assert.equal(v.verdict, 'REGRESSION');
  assert.ok(v.lo > 0.02, `lo ${v.lo} should exceed 2%`);
});

test('bucketVerdict: B +1% → FLAT (below the 2% gate)', () => {
  assert.equal(bucketVerdict(A, scale(A, 1.01)).verdict, 'FLAT');
});

test('bucketVerdict: exactly +2% → FLAT (strict >, boundary not tripped)', () => {
  const v = bucketVerdict(A, scale(A, 1.02));
  assert.ok(Math.abs(v.lo - 0.02) < 1e-9); // CI collapses to the point estimate (no within-build variance)
  assert.equal(v.verdict, 'FLAT'); // a true 2% must NOT trip (fp guard)
});

test('bucketVerdict: +2.5% → REGRESSION (clearly above the boundary)', () => {
  assert.equal(bucketVerdict(A, scale(A, 1.025)).verdict, 'REGRESSION');
});

test('bucketVerdict: B −11% → IMPROVED', () => {
  const v = bucketVerdict(A, scale(A, 0.89));
  assert.equal(v.verdict, 'IMPROVED');
  assert.ok(v.hi < -0.02);
});

test('bucketVerdict: equal arrays → FLAT with a zero-width CI', () => {
  const v = bucketVerdict(A, A.slice());
  assert.equal(v.verdict, 'FLAT');
  assert.equal(v.lo, 0);
  assert.equal(v.hi, 0);
});

test('bucketVerdict: noisy reps whose true delta is ~0 stay FLAT (CI straddles 0)', () => {
  const a = [1.00, 1.05, 0.95, 1.02, 0.98, 1.01];
  const b = [1.01, 0.96, 1.04, 0.99, 1.03, 0.97];
  assert.equal(bucketVerdict(a, b).verdict, 'FLAT');
});

test('loadVerdict: a draws bump is flagged as grew', () => {
  assert.equal(loadVerdict([74, 74, 74], [75, 75, 75]).grew, true);
  assert.equal(loadVerdict([74, 74, 74], [74, 74, 74]).grew, false);
  assert.equal(loadVerdict([74, 74, 74], [73, 73, 73]).grew, false); // a drop is not a regression
});

test('loadVerdict: a large divergence is annotated', () => {
  assert.equal(loadVerdict([6, 6, 6], [9, 9, 9]).diverged, true);
  assert.equal(loadVerdict([6, 6, 6], [6, 6, 6]).diverged, false);
});

test('analyzeMode: full mode flags REGRESSION when js.total regresses', () => {
  const build = (f) => ({
    update: scale(A, f), dom: A.slice(), render: A.slice(), total: scale(A, f),
    load: { draws: [74, 74, 74], tris: [66000, 66000, 66000], particles: [40, 40, 40], enemies: [6, 6, 6] },
  });
  const res = analyzeMode('combat-heavy', 'full', build(1.0), build(1.12));
  assert.equal(res.regression, true);
  assert.equal(res.gateBucket.verdict, 'REGRESSION');
  assert.match(res.report, /REGRESSION/);
});

test('analyzeMode: a load.draws growth alone trips the gate even when timings are FLAT', () => {
  const base = {
    update: A.slice(), dom: A.slice(), render: A.slice(), total: A.slice(),
    load: { draws: [74, 74, 74], tris: [66000, 66000, 66000], particles: [40, 40, 40], enemies: [6, 6, 6] },
  };
  const bumped = { ...base, load: { ...base.load, draws: [80, 80, 80] } };
  const res = analyzeMode('combat-heavy', 'full', base, bumped);
  assert.equal(res.regression, true); // structural GPU-cost proxy
  assert.equal(res.gateBucket.verdict, 'FLAT'); // ...even though timings are clean
});

test('analyzeMode: identical builds → FLAT verdict', () => {
  const build = {
    update: A.slice(), dom: A.slice(), render: A.slice(), total: A.slice(),
    load: { draws: [74, 74, 74], tris: [66000, 66000, 66000], particles: [40, 40, 40], enemies: [6, 6, 6] },
  };
  const res = analyzeMode('combat-heavy', 'full', build, { ...build });
  assert.equal(res.regression, false);
  assert.equal(res.improved, false);
  assert.match(res.report, /VERDICT: FLAT/);
});
