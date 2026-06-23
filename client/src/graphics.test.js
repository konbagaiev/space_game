import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTier, loadTier, saveTier,
  GRAPHICS_STORAGE_KEY, GRAPHICS_DEFAULT, TIERS,
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
