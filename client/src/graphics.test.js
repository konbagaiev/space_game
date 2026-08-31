import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTier, loadTier, saveTier,
  GRAPHICS_STORAGE_KEY, GRAPHICS_DEFAULT, TIERS,
  LOOK_DEFAULTS,
} from './graphics.js';

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

test('post: High/Balance carry a real-light pool, Performance carries none', () => {
  // `post` is the REAL POINT LIGHTS (engine-lights.js), not a post-processing chain — there is no chain.
  // The pool size is baked into every lit material's shader (#define NUM_POINT_LIGHTS), so it is decided
  // here, once, before the first material compiles.
  assert.deepEqual(resolveTier('high').post, { lights: 16 });
  assert.deepEqual(resolveTier('balance').post, { lights: 4 });
  assert.equal(resolveTier('performance').post, null,
    'Performance runs no lights at all — the one clean off-path (§23)');

  // MEASURED, not guessed (Redmi 15C / Mali-G52, 2026-08-31): 0 lights held ~60 fps; 16 dropped, and the
  // drop was worst ZOOMED IN AT THE STATION and mild once the station shrank on screen. Three evaluates
  // every point light for every fragment of every lit material, so the cost tracks LIT PIXELS.
  assert.ok(resolveTier('high').post.lights > resolveTier('balance').post.lights,
    'a weaker tier must never carry MORE per-fragment lighting than a stronger one');

  // NO `samples`/`superSample` KNOB MAY COME BACK HERE, and no bloom/glow buffer either. The frame is drawn
  // straight to the canvas, so AA is the canvas's own MSAA again (`antialias` above) — which is exactly what
  // the abandoned full-frame composer threw away, and what supersampling was rejected for buying back at
  // 2.25x the fill (DECISIONS §139).
  for (const t of ['high', 'balance']) {
    assert.equal(resolveTier(t).post.samples, undefined, `${t}: AA is the canvas's, not a render target's`);
    assert.equal(resolveTier(t).post.superSample, undefined, `${t}: no supersampling`);
    assert.equal(resolveTier(t).post.bloom, undefined, `${t}: there is no bloom/glow pass any more`);
    assert.equal(resolveTier(t).post.glowScale, undefined, `${t}: and no glow buffer to scale`);
  }
});

test('the hull emissive floor is a floor, not a light', () => {
  // It SHIPS AT 0 (the floor is off): at 0.25 it flattened hulls and killed their glint on a real screen.
  // The mechanism stays wired because it is the value hit-fx's hull flash restores to — that flash
  // deliberately drives the same emissive to white at HIT_FX.flash.intensity (1.6) for 0.12 s, which is a
  // HIT lighting up, not a hull standing there glowing.
  assert.equal(LOOK_DEFAULTS.hullEmissive, 0, 'the emissive floor ships OFF (see DECISIONS §139)');
  assert.ok(LOOK_DEFAULTS.hullEmissive < 1,
    'and can never be raised to a self-lit hull without failing here first');
});

test('the parallax backdrop layer keeps its geometry sane', () => {
  // radius + offsetMax must stay inside camera.far (1300, engine.js) or the layer leaves the frustum, and
  // the sphere's near wall must stay outside the camera-locked star sphere (stars.radius 400).
  const { amp, follow, offsetMax, radius } = LOOK_DEFAULTS.backdrop;
  assert.ok(amp > 0, 'the layer ships visible (amp 0 would be a silently invisible feature)');
  assert.ok(follow > 0 && follow < 1, 'follow 1 would make it a skybox, follow 0 a world-fixed wall');
  assert.ok(radius + offsetMax < 1300, 'the layer stays inside camera.far');
  assert.ok(radius - offsetMax > 400, 'and its near wall stays outside the camera-locked star sphere');
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
