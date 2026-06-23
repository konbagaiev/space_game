import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp01, loadAudioSettings, saveAudioSettings, effectiveGain,
  AUDIO_DEFAULTS, AUDIO_STORAGE_KEYS,
} from './audio.js';

// A tiny localStorage-like store backed by a Map (the engine only needs get/setItem).
function makeStore(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    _map: m,
  };
}

test('clamp01 clamps to [0,1] and rejects garbage', () => {
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(-3), 0);
  assert.equal(clamp01(9), 1);
  assert.equal(clamp01('0.25'), 0.25);
  assert.equal(clamp01('nope'), 0);
  assert.equal(clamp01(undefined), 0);
});

test('loadAudioSettings returns defaults for an empty store', () => {
  assert.deepEqual(loadAudioSettings(makeStore()), AUDIO_DEFAULTS);
});

test('loadAudioSettings reads + clamps stored values and parses toggles', () => {
  const s = loadAudioSettings(makeStore({
    [AUDIO_STORAGE_KEYS.master]: '0.3',
    [AUDIO_STORAGE_KEYS.music]: '2',       // out of range → clamped to 1
    [AUDIO_STORAGE_KEYS.sfx]: 'junk',      // unparseable → 0
    [AUDIO_STORAGE_KEYS.musicOn]: '0',
    [AUDIO_STORAGE_KEYS.sfxOn]: '1',
  }));
  assert.equal(s.master, 0.3);
  assert.equal(s.music, 1);
  assert.equal(s.sfx, 0);
  assert.equal(s.musicOn, false);
  assert.equal(s.sfxOn, true);
});

test('save → load round-trips settings through a store', () => {
  const store = makeStore();
  const original = { master: 0.6, music: 0.2, sfx: 0.9, musicOn: false, sfxOn: true };
  saveAudioSettings(store, original);
  const loaded = loadAudioSettings(store);
  assert.equal(loaded.master, 0.6);
  assert.equal(loaded.music, 0.2);
  assert.equal(loaded.sfx, 0.9);
  assert.equal(loaded.musicOn, false);
  assert.equal(loaded.sfxOn, true);
});

test('effectiveGain multiplies master × channel and honors the on-toggle', () => {
  const s = { master: 0.5, music: 0.4, sfx: 0.8, musicOn: true, sfxOn: true };
  assert.equal(effectiveGain(s, 'music'), 0.2);          // 0.5 × 0.4
  assert.equal(effectiveGain(s, 'sfx'), 0.4);            // 0.5 × 0.8
  assert.equal(effectiveGain(s, 'master'), 0.5);        // master itself
  assert.equal(effectiveGain({ ...s, musicOn: false }, 'music'), 0); // muted channel ⇒ 0
  assert.equal(effectiveGain({ ...s, sfxOn: false }, 'sfx'), 0);
});
