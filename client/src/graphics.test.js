import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTier, loadTier, saveTier,
  GRAPHICS_STORAGE_KEY, GRAPHICS_DEFAULT, TIERS,
  POST_DEFAULTS, BLOOM_DUST_MARGIN, postGain,
} from './graphics.js';
import { SPEED_FIELD_DEFAULTS, linearLuma601 } from './speed-field.js';

// A tiny localStorage-like store backed by a Map (only get/setItem are used).
function makeStore(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    _map: m,
  };
}

// A store whose get/set throw (e.g. localStorage blocked) — must never throw out of our functions.
const throwingStore = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('resolveTier returns the tier knobs with its name attached', () => {
  const p = resolveTier('performance');
  assert.equal(p.name, 'performance');
  assert.equal(p.pixelRatioCap, 1);
  assert.equal(p.antialias, false);
  assert.equal(p.starScale, TIERS.performance.starScale);
});

test('every tier caps live particles, tightening as the tier weakens (no renderScale knob — removed)', () => {
  // maxParticles is the hard live-particle ceiling. It used to be Infinity on High and Balance — an
  // unbounded resource on the two tiers most people play — which is now finite everywhere: the particles
  // are drawn from a fixed-capacity instanced pool (DECISIONS §82), so a cap above that capacity would
  // silently drop pushes. renderScale was removed (measured useless on real GPUs) — assert it stays gone.
  const caps = ['high', 'balance', 'performance'].map((t) => resolveTier(t).maxParticles);
  for (const c of caps) assert.ok(Number.isFinite(c) && c > 0, `every tier has a finite cap (got ${c})`);
  assert.ok(caps[0] >= caps[1] && caps[1] >= caps[2], `the cap tightens as the tier weakens (got ${caps})`);
  assert.equal(resolveTier('performance').renderScale, undefined);
});

test('nebulaBake: High/Balance bake, Performance keeps the flat color', () => {
  const hi = resolveTier('high').nebulaBake;
  const ba = resolveTier('balance').nebulaBake;
  assert.deepEqual(hi, { cube: 1024, octaves: 6 });
  assert.deepEqual(ba, { cube: 512, octaves: 4 });
  assert.equal(resolveTier('performance').nebulaBake, null);
});

test('post: High/Balance run the composer, Performance runs none', () => {
  // Tiered by PASS COUNT, not resolution: §23 measured that cutting backbuffer pixels 5.5-7x moved fps by
  // nothing on real weak phones, so the only lever that protects one is "build no chain at all".
  assert.deepEqual(resolveTier('high').post, { bloom: true, bloomScale: 1.0, samples: 4 });
  assert.deepEqual(resolveTier('balance').post, { bloom: true, bloomScale: 0.5, samples: 0 });
  assert.equal(resolveTier('performance').post, null);
  // Balance keeps the bloom but pays less fill for it; High is the only tier with MSAA on the composer RT
  // (the composer bypasses the canvas's own AA).
  assert.ok(resolveTier('balance').post.bloomScale < resolveTier('high').post.bloomScale);
  assert.ok(resolveTier('balance').post.samples < resolveTier('high').post.samples);
});

test('the bloom threshold clears the speed-field dust (it must not glow)', () => {
  // three's LuminosityHighPassShader thresholds on the LINEAR Rec.601 luma of the frame. The speed field is
  // an opaque, unlit, near-white-grey dot at opacity 1.0 — its linear luma is ~0.608, which is the highest
  // value in the frame that must NOT bloom. Below the threshold the field turns into sparks, re-opening
  // DECISIONS §96's settled "dim rocks, not stars". The margin is thin, hence this assertion.
  const dust = linearLuma601(SPEED_FIELD_DEFAULTS.color);
  assert.ok(Math.abs(dust - 0.6079) < 0.001, `the dust's linear luma is ~0.608 (got ${dust})`);
  assert.ok(POST_DEFAULTS.bloom.threshold >= dust * BLOOM_DUST_MARGIN,
    `bloom threshold ${POST_DEFAULTS.bloom.threshold} must clear the dust (${dust}) by >= ${BLOOM_DUST_MARGIN}x`);
});

test('the hull emissive floor stays below the bloom threshold (hulls must not glow)', () => {
  // NECESSARY, NOT SUFFICIENT: this proves only that the EMISSIVE TERM ALONE cannot reach the threshold —
  // the shaded result is emissive + direct + ambient + env. The real proof that hulls do not glow is the
  // rendered frame (visual/scenarios/42-expensive-look.mjs + a human looking at it).
  assert.ok(POST_DEFAULTS.hullEmissive < POST_DEFAULTS.bloom.threshold,
    `emissive floor ${POST_DEFAULTS.hullEmissive} must stay under the bloom threshold ${POST_DEFAULTS.bloom.threshold}`);
});

test('postGain pins every HDR gain to 1 without a composer (no clipping, no hue shift)', () => {
  // With no composer the frame goes straight to an 8-bit sRGB canvas with no tone mapping, so a >1 colour
  // clamps PER CHANNEL: 0xffb050 x 1.5 clips R and G but not B — a flat white patch AND a hue shift. So on
  // Performance every gain must resolve to exactly 1.
  assert.equal(postGain(false, 1.6), 1);
  assert.equal(postGain(true, 1.6), 1.6);
  assert.equal(postGain(false, POST_DEFAULTS.exhaustGain), 1);
  for (const [k, g] of Object.entries(POST_DEFAULTS.fxGain)) {
    assert.ok(g > 1, `${k}: an HDR gain is above 1 by design (it must clear the bloom threshold)`);
    assert.equal(postGain(!!resolveTier('performance').post, g), 1, `${k} is pinned to 1 on Performance`);
    assert.equal(postGain(!!resolveTier('high').post, g), g, `${k} is spent on High`);
  }
});

test('resolveTier falls back to the default for an unknown name', () => {
  const r = resolveTier('nonsense');
  assert.equal(r.name, GRAPHICS_DEFAULT); // 'high'
  assert.equal(r.antialias, true);
  assert.equal(r.pixelRatioCap, 2);
});

test('loadTier: empty store → high on desktop, balance on a touch first run', () => {
  assert.equal(loadTier(makeStore()), 'high');
  assert.equal(loadTier(makeStore(), true), 'balance');
});

test('loadTier: a saved tier wins over the touch default', () => {
  const store = makeStore({ [GRAPHICS_STORAGE_KEY]: 'performance' });
  assert.equal(loadTier(store, true), 'performance');
});

test('loadTier: a garbage saved value falls back to the default', () => {
  assert.equal(loadTier(makeStore({ [GRAPHICS_STORAGE_KEY]: 'ultra' })), 'high');
});

test('saveTier persists a valid tier and clamps an invalid one to the default', () => {
  const store = makeStore();
  assert.equal(saveTier(store, 'balance'), 'balance');
  assert.equal(store._map.get(GRAPHICS_STORAGE_KEY), 'balance');
  assert.equal(loadTier(store), 'balance');
  assert.equal(saveTier(store, 'bogus'), 'high'); // clamped
  assert.equal(store._map.get(GRAPHICS_STORAGE_KEY), 'high');
});

test('load/save tolerate a throwing store (localStorage blocked)', () => {
  assert.doesNotThrow(() => assert.equal(loadTier(throwingStore), 'high'));
  assert.doesNotThrow(() => assert.equal(saveTier(throwingStore, 'performance'), 'performance'));
});
