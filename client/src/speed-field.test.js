// Pure unit tests for the player-locked speed field's math, defaults and tune persistence. No THREE/DOM →
// runs under bare `node --test`. These are MECHANISM tests; the feature's OUTCOME (the field still surrounds
// the player after roaming) is asserted by client/visual/scenarios/31-speed-field.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WRAP_SAFE_RADIUS, SPEED_FIELD_DEFAULTS, SPEED_FIELD_RANGES, SPEED_TUNE_KEY,
  MIN_CONTRAST, BG_LUMA, layerLuma, contrastRatio,
  wrapDelta, wrapField, scatterLayer, scatterColors, normalizeSpeedField,
  loadSpeedTune, saveSpeedTune } from './speed-field.js';

// A Map-backed fake localStorage (mirrors ghost-battle-track.test.js / graphics.test.js).
const makeStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

// A deterministic rng stub that also counts its draws (the RNG-contract assertion).
function countingRng(seq = [0.5]) {
  let i = 0;
  const fn = () => { fn.calls++; return seq[i++ % seq.length]; };
  fn.calls = 0;
  return fn;
}

test('wrapDelta: 0 and any value inside the box are returned unchanged', () => {
  const half = 620;
  assert.equal(wrapDelta(0, half), 0);
  for (const d of [-619.5, -300, -1, 1, 300, 619.5]) assert.equal(wrapDelta(d, half), d, `${d} is inside`);
});

test('wrapDelta: +half wraps to -half (the range is [-half, half))', () => {
  assert.equal(wrapDelta(620, 620), -620);
});

test('wrapDelta: just outside either edge lands back inside', () => {
  const half = 620;
  for (const d of [-621, 621, -1240, 1240.5]) {
    const w = wrapDelta(d, half);
    assert.ok(w >= -half && w < half, `${d} → ${w} inside [-${half}, ${half})`);
  }
});

test('wrapDelta: a huge delta (7.3 spans) lands inside in ONE call — a teleport settles in one frame', () => {
  const half = 620, span = 2 * half;
  const d = 7.3 * span;
  const w = wrapDelta(d, half);
  assert.ok(w >= -half && w < half, `${w} inside`);
  assert.ok(Number.isInteger(Math.round((d - w) / span)), 'displacement is a whole number of spans');
  assert.ok(Math.abs((d - w) / span - Math.round((d - w) / span)) < 1e-9, 'displacement is an EXACT multiple of the span');
});

test('wrapField: every point already inside → 0 moved (the no-upload path) and the array is untouched', () => {
  const half = 100;
  const pos = new Float32Array([10, -5, -20, -90, -5, 99, 0, -5, 0]);
  const before = Array.from(pos);
  assert.equal(wrapField(pos, 0, 0, half), 0);
  assert.deepEqual(Array.from(pos), before);
});

test('wrapField: a point past +half comes back inside, displaced by an EXACT multiple of the span', () => {
  const half = 100, span = 2 * half, cx = 30, cz = -10;
  const pos = new Float32Array([260, -5, 0]); // 230 right of cx → outside
  const x0 = pos[0];
  assert.equal(wrapField(pos, cx, cz, half), 1, 'only x moved');
  assert.ok(pos[0] >= cx - half && pos[0] < cx + half, 'x is inside the box around cx');
  assert.equal((x0 - pos[0]) % span, 0, 'the treadmill translates by whole spans (the pattern must not drift)');
});

test('wrapField: idempotent — a second call with the same centre moves nothing', () => {
  const half = 620;
  const pos = new Float32Array([2000, -18, -3000, -1500, -20, 900]);
  assert.ok(wrapField(pos, 100, -50, half) > 0, 'the first call moves points');
  assert.equal(wrapField(pos, 100, -50, half), 0, 'the second call is a no-op');
});

test('wrapField: a 10-span teleport brings ALL points into range in one call', () => {
  const half = 620, span = 2 * half;
  const pos = new Float32Array(300);
  for (let i = 0; i < 100; i++) { pos[i * 3] = (i % 50) * 12 - 300; pos[i * 3 + 1] = -18; pos[i * 3 + 2] = (i % 37) * 30 - 500; }
  const cx = 10 * span, cz = -10 * span;
  wrapField(pos, cx, cz, half);
  for (let i = 0; i < pos.length; i += 3) {
    assert.ok(Math.abs(pos[i] - cx) <= half, `x[${i}] within half of the new centre`);
    assert.ok(Math.abs(pos[i + 2] - cz) <= half, `z[${i}] within half of the new centre`);
  }
});

test('wrapField: x and z wrap independently and y is NEVER written', () => {
  const half = 100;
  //             x outside / z inside            x inside / z outside
  const pos = new Float32Array([500, -18, 10, 20, -222, 640]);
  const moved = wrapField(pos, 0, 0, half);
  assert.equal(moved, 2, 'exactly one coordinate moved per point');
  assert.equal(pos[1], -18, 'y of the first point is untouched');
  assert.equal(pos[4], -222, 'y of the second point is untouched');
  assert.equal(pos[2], 10, 'the in-range z is untouched');
  assert.equal(pos[3], 20, 'the in-range x is untouched');
});

test('scatterLayer: length, bounds, and the RNG CONTRACT (only the injected rng, 3 draws per point)', () => {
  const layer = { count: 50, size: 0.9, radius: 620, depth: 18, depthVar: 20, opacity: 0.9 };
  const rng = countingRng([0.0, 0.25, 0.5, 0.75, 0.99]);
  const pos = scatterLayer(layer, rng);
  assert.equal(pos.length, layer.count * 3);
  // production passes the NATIVE Math.random; the injected stub proves nothing else is consulted
  assert.equal(rng.calls, layer.count * 3, 'exactly x, z, y per point — all from the injected rng');
  for (let i = 0; i < pos.length; i += 3) {
    assert.ok(pos[i] >= -layer.radius && pos[i] < layer.radius, 'x within ±radius');
    assert.ok(pos[i + 2] >= -layer.radius && pos[i + 2] < layer.radius, 'z within ±radius');
    assert.ok(pos[i + 1] <= -layer.depth + 1e-4 && pos[i + 1] >= -(layer.depth + layer.depthVar) - 1e-4,
      `y ${pos[i + 1]} sunk into [-(depth+depthVar), -depth]`);
  }
});

test('scatterColors: one draw per point, tint × a 0.55..1.0 brightness jitter', () => {
  const layer = { count: 40, radius: 620, depth: 18, depthVar: 20, size: 1, opacity: 1 };
  const rng = countingRng([0, 0.5, 1]);
  const col = scatterColors(layer, { r: 1, g: 0.5, b: 0.25 }, rng);
  assert.equal(col.length, layer.count * 3);
  assert.equal(rng.calls, layer.count, 'one brightness draw per point');
  for (let i = 0; i < col.length; i += 3) {
    assert.ok(col[i] >= 0.55 - 1e-6 && col[i] <= 1 + 1e-6, 'red = 1.0 × b ∈ [0.55, 1]');
    assert.ok(col[i + 1] <= col[i] && col[i + 2] <= col[i + 1], 'the tint ratio is preserved per point');
  }
});

test('normalizeSpeedField(undefined) → the complete defaults (an old DB row with no speedField)', () => {
  const s = normalizeSpeedField(undefined);
  assert.equal(s.color, SPEED_FIELD_DEFAULTS.color);
  assert.equal(s.layers.length, SPEED_FIELD_DEFAULTS.layers.length);
  assert.deepEqual(s.layers, SPEED_FIELD_DEFAULTS.layers);
  s.layers[0].count = 1; // and it is a COPY — mutating the result must not poison the defaults
  assert.equal(SPEED_FIELD_DEFAULTS.layers[0].count, 420);
});

test('normalizeSpeedField: a partial layer is filled per key and every number is clamped', () => {
  const s = normalizeSpeedField({ layers: [{ count: 5 }] });
  assert.equal(s.layers.length, 1, 'the spec keeps its own layer count');
  assert.equal(s.layers[0].count, 5);
  assert.equal(s.layers[0].size, SPEED_FIELD_DEFAULTS.layers[0].size, 'missing keys fall back to the defaults');
  assert.equal(s.color, SPEED_FIELD_DEFAULTS.color);
  const wild = normalizeSpeedField({ color: -5, layers: [{ count: 99999, size: -3, radius: 1e9, depth: 'x', depthVar: 999, opacity: 4 }] });
  const L = wild.layers[0];
  assert.equal(L.count, SPEED_FIELD_RANGES.count[1]);
  assert.equal(L.size, SPEED_FIELD_RANGES.size[0]);
  assert.equal(L.radius, SPEED_FIELD_RANGES.radius[1]);
  assert.equal(L.depth, SPEED_FIELD_DEFAULTS.layers[0].depth, 'a non-numeric value falls back, it does not clamp to 0');
  assert.equal(L.depthVar, SPEED_FIELD_RANGES.depthVar[1]);
  assert.equal(L.opacity, SPEED_FIELD_RANGES.opacity[1]);
  assert.equal(wild.color, 0, 'colour clamped into 0..0xffffff');
});

// THE NO-POP-IN INVARIANT. 600 is NOT a fog distance — do not "simplify" it back to scene.fog.far.
// THREE.Fog fogs on VIEW DEPTH (-mvPosition.z), and with this near-top-down camera (CAM_OFFSET 0,110,26,
// ZOOM_MAX 3.5) that is nothing like radial distance: a SHALLOW point 620 units out sits only ~413 deep in
// view space at max zoom-out, i.e. barely fogged — what hides it is the FRUSTUM (the near layer's visible
// patch tops out at |dx| ~ 459 at 16:9). The DEEP layer is the opposite: it out-reaches the frustum but its
// view depth there is >= 668 > fogFar (600), so fog finishes the job. Every shipped layer must clear 600.
test('every default layer respects WRAP_SAFE_RADIUS (the recycled point reappears off-screen)', () => {
  assert.equal(WRAP_SAFE_RADIUS, 600);
  for (const [i, l] of SPEED_FIELD_DEFAULTS.layers.entries()) {
    assert.ok(l.radius >= WRAP_SAFE_RADIUS, `layer ${i} radius ${l.radius} >= ${WRAP_SAFE_RADIUS}`);
    assert.ok(l.count > 0, `layer ${i} has points`);
  }
});

test('loadSpeedTune/saveSpeedTune: clamped round-trip through a fake store', () => {
  const store = makeStore();
  const fallback = normalizeSpeedField(undefined);
  assert.equal(loadSpeedTune(store, fallback), fallback, 'nothing stored → the passed default (by reference)');
  const saved = saveSpeedTune(store, { color: 0x112233, layers: [{ count: 99999, size: 2, radius: 700, depth: 30, depthVar: 10, opacity: 0.5 }] });
  assert.equal(saved.layers[0].count, SPEED_FIELD_RANGES.count[1], 'the write is clamped too');
  assert.ok(store.getItem(SPEED_TUNE_KEY), 'stored under the documented key');
  const back = loadSpeedTune(store, fallback);
  assert.deepEqual(back, saved, 'round-trips');
});

test('loadSpeedTune: malformed JSON and a throwing store both fall back (no crash)', () => {
  const fallback = normalizeSpeedField(undefined);
  const bad = makeStore(); bad.setItem(SPEED_TUNE_KEY, '{not json');
  assert.equal(loadSpeedTune(bad, fallback), fallback);
  const thrower = { getItem() { throw new Error('private mode'); }, setItem() { throw new Error('private mode'); } };
  assert.equal(loadSpeedTune(thrower, fallback), fallback);
  assert.doesNotThrow(() => saveSpeedTune(thrower, fallback), 'a throwing store must not break the panel');
  assert.equal(loadSpeedTune(null, fallback), fallback, 'no store at all (non-browser) → the default');
});

// ---- REGRESSION GUARD (the escaped defect): the shipped field must actually be VISIBLE ----
// The first release was geometrically perfect and invisible — dark grey sprites over a dark sky. Every unit
// test and the outcome scenario passed; only a human looking at prod caught it. These assertions encode the
// contrast lesson so a re-tune can't silently sink back under the floor. See speed-field.js MIN_CONTRAST.

test('contrast: every shipped layer is clearly brighter than the map background', () => {
  for (const [i, l] of SPEED_FIELD_DEFAULTS.layers.entries()) {
    const c = contrastRatio(SPEED_FIELD_DEFAULTS.color, l.opacity);
    assert.ok(c >= MIN_CONTRAST,
      `layer ${i} contrast ${c.toFixed(2)}x is below the ${MIN_CONTRAST}x floor — it will read as empty sky`);
  }
});

test('contrast: the original invisible values would FAIL this guard', () => {
  // The exact combination that shipped and was reported as "I see nothing" on prod.
  const c = contrastRatio(0x6b6f78, 0.55);
  assert.ok(c < MIN_CONTRAST, `the known-invisible grey scores ${c.toFixed(2)}x — the guard must reject it`);
  assert.ok(layerLuma(0x6b6f78, 0.55) > 0, 'sanity: luminance is still positive, just too low to see');
  assert.ok(BG_LUMA > 0, 'sanity: the background reference is set');
});

test('contrast: the shipped sizes are big enough to have a visible core, and fit the slider range', () => {
  const [lo, hi] = SPEED_FIELD_RANGES.size;
  for (const [i, l] of SPEED_FIELD_DEFAULTS.layers.entries()) {
    // ~size * (canvasHeight/2) / distance px; the glow sprite's bright core is the inner ~25% of the radius,
    // so a sub-3-unit near layer is what produced the sub-pixel core that vanished.
    assert.ok(l.size >= 3, `layer ${i} size ${l.size} is too small for the soft sprite's core to survive`);
    assert.ok(l.size >= lo && l.size <= hi, `layer ${i} size ${l.size} must fit SPEED_FIELD_RANGES.size`);
  }
});

test('normalizeSpeedField does not clamp the shipped defaults away', () => {
  const n = normalizeSpeedField(SPEED_FIELD_DEFAULTS);
  assert.deepEqual(n, SPEED_FIELD_DEFAULTS,
    'a default that gets clamped on read means the ranges and the shipped look disagree');
});
