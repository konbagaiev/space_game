// Pure statistics + verdict for the A/B perf gate (docs/plans/2026-07-04-0949-perf-benchmark-replay.md,
// Component 6). No I/O, no browser — takes the raw per-rep bucket arrays the runner collected and returns
// verdicts + a formatted report. Unit-tested in stats.test.js; run.mjs does the I/O and process.exit().
//
// Method: aggregate the interleaved reps per bucket with the MEDIAN (robust to a stray thermal/GC outlier),
// and put a bootstrap 95% CI on the A→B delta ratio (B/A − 1) by resampling reps with replacement. We flag a
// REGRESSION only when the CI LOWER bound exceeds +2% — i.e. we are confident the true regression is >2%, not
// point-estimate noise. Symmetrically, IMPROVED when the upper bound is below −2%. Else FLAT.

const REGRESSION_THRESHOLD = 0.02; // 2% — the gate boundary (strict >)
const EPS = 1e-9;                  // fp guard so a true 2.0% (e.g. 1.02/1.00−1 = 0.0200…018) doesn't trip the strict >


// Deterministic PRNG so the bootstrap (and therefore the tests) are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function median(arr) {
  if (!arr || !arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Mean — used to aggregate a rep's per-tick timings. Chromium clamps performance.now() to 100µs, so a per-tick
// MEDIAN of quantized samples jumps in coarse steps (a ~0.7ms render ⇒ ±14% CI); the mean of hundreds of
// quantized samples averages back to sub-quantum resolution. GC spikes are diluted over ~780 ticks and further
// contained by taking the MEDIAN *across reps* in bucketVerdict. See DECISIONS §43.
export function mean(arr) {
  if (!arr || !arr.length) return 0;
  let s = 0; for (const x of arr) s += x;
  return s / arr.length;
}

function resample(arr, rnd) {
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[(rnd() * arr.length) | 0];
  return out;
}

// Bucket verdict from the two builds' per-rep aggregates. `aReps[i]` and `bReps[i]` are the SAME interleaved
// round (A and B ran back-to-back, so they share the round's thermal/scheduler state). We therefore work with
// the PAIRED ratio `bReps[i]/aReps[i] − 1`: common-mode machine noise cancels within the pair, which is the
// whole point of interleaving and is what makes the 2% gate feasible on a noisy shared machine (DECISIONS §43;
// the runner also alternates A-then-B vs B-then-A each round to cancel within-pair ordering bias). Returns the
// display medians, the point delta (median paired ratio), the bootstrap 95% CI on it, and the verdict.
export function bucketVerdict(aReps, bReps, opts = {}) {
  const resamples = opts.resamples ?? 2000;
  const rnd = mulberry32(opts.seed ?? 0x9e3779b9);
  const n = Math.min(aReps.length, bReps.length);
  const ratios = [];
  for (let i = 0; i < n; i++) ratios.push(aReps[i] > 0 ? bReps[i] / aReps[i] - 1 : 0);
  const a = median(aReps), b = median(bReps);
  const point = median(ratios);
  const boot = new Array(resamples);
  for (let r = 0; r < resamples; r++) boot[r] = median(resample(ratios, rnd));
  boot.sort((x, y) => x - y);
  const lo = boot[Math.floor(0.025 * resamples)];
  const hi = boot[Math.min(resamples - 1, Math.floor(0.975 * resamples))];
  let verdict = 'FLAT';
  if (lo > REGRESSION_THRESHOLD + EPS) verdict = 'REGRESSION';
  else if (hi < -(REGRESSION_THRESHOLD + EPS)) verdict = 'IMPROVED';
  return { a, b, delta: point, lo, hi, verdict };
}

// Structural load signal (draws/tris/particles/enemies). Integer-ish + near-deterministic, so a small
// consistent rise is a real GPU-cost proxy — flag it. Also annotate when A and B diverge either way
// (a gameplay diff whose inputs yielded a different world despite the load-pin).
export function loadVerdict(aReps, bReps, opts = {}) {
  const tol = opts.tol ?? 0.001; // 0.1% growth floor (ignore fp dust)
  const a = median(aReps), b = median(bReps);
  const grew = b > a * (1 + tol) && b - a > 1e-9;
  const diverged = Math.abs(b - a) > Math.max(1, a) * 0.01; // >1 unit or >1%
  return { a, b, grew, diverged };
}

// pct formatting: +11.9%
const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const ms = (x) => `${x.toFixed(2)}ms`;

// Analyze one trace for one mode ('full' | 'sim'). `A`/`B` carry per-rep arrays per timing bucket and a
// `load` map of per-rep arrays. Returns { rows, load, gateBucket, regression, improved, report }.
// `gateKey` is the bucket the gate keys on for this mode: 'total' for full, 'update' for sim.
export function analyzeMode(name, mode, A, B, opts = {}) {
  const reps = `${(A.total || A.update || []).length}×2`;
  const throttle = opts.throttle ? `, ${opts.throttle}× CPU throttle` : '';
  const timingBuckets = mode === 'sim' ? ['update'] : ['update', 'dom', 'render', 'total'];
  const gateKey = mode === 'sim' ? 'update' : 'total';
  const rows = {};
  for (const bucket of timingBuckets) rows[bucket] = bucketVerdict(A[bucket] || [], B[bucket] || [], opts);
  const load = {};
  for (const key of ['draws', 'tris', 'particles', 'enemies']) {
    load[key] = loadVerdict((A.load && A.load[key]) || [], (B.load && B.load[key]) || [], opts);
  }
  const loadGrew = ['draws', 'tris', 'particles'].some((k) => load[k].grew);
  const loadDiverged = Object.values(load).some((v) => v.diverged);
  const gateReg = rows[gateKey] && rows[gateKey].verdict === 'REGRESSION';
  const regression = gateReg || loadGrew;
  const improved = !regression && rows[gateKey] && rows[gateKey].verdict === 'IMPROVED';

  // report
  const lines = [`trace ${name} [${mode}] (${reps} reps${throttle})`];
  for (const bucket of timingBuckets) {
    const r = rows[bucket];
    lines.push(`  js.${bucket.padEnd(7)} ${ms(r.a)} → ${ms(r.b)}   ${pct(r.delta).padStart(6)}  [${pct(r.lo)}, ${pct(r.hi)}]   ${r.verdict}`);
  }
  const l = load;
  lines.push(`  load.draws ${l.draws.a} → ${l.draws.b} · tris ${l.tris.a} → ${l.tris.b} · particles ${l.particles.a} → ${l.particles.b} · enemies ${l.enemies.a} → ${l.enemies.b}   ${loadGrew ? 'GREW' : 'FLAT'}${loadDiverged ? ' (load diverged — treat Δ as approximate)' : ''}`);
  const verdict = regression ? 'REGRESSION' : improved ? 'IMPROVED' : 'FLAT';
  const why = gateReg ? `js.${gateKey} ${pct(rows[gateKey].delta)}` : loadGrew ? 'load grew' : '';
  lines.push(`  VERDICT: ${verdict}${why ? ` (${why})` : ''}`);

  return { name, mode, rows, load, gateKey, gateBucket: rows[gateKey], regression, improved, loadDiverged, report: lines.join('\n') };
}

export { REGRESSION_THRESHOLD };
