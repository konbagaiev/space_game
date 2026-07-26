// Unit tests for the shared exhaust FX pure seams (exhaust-config.js — imported here as the testable
// core of exhaust-fx.js, which itself pulls in `three` and can't load under `node --test`). Covers the
// config-merge / fade / palette / hash invariants that guard the plume without WebGL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash, plumeCfg, decayThrottle, derivePalette, EXHAUST_DEFAULTS } from './exhaust-config.js';

test('hash is deterministic and in [0,1)', () => {
  for (const [a, b, c] of [[0, 0, 0], [3, 1, 0], [42, 2, 7], [1000, 0, 0]]) {
    const v = hash(a, b, c);
    assert.equal(v, hash(a, b, c), 'same inputs → same output');
    assert.ok(v >= 0 && v < 1, `hash(${a},${b},${c})=${v} in [0,1)`);
  }
  assert.notEqual(hash(1, 0, 0), hash(2, 0, 0), 'different indices → different seeds');
});

test('plumeCfg merges spec.exhaust over defaults (nested palette per-key)', () => {
  // absent spec.exhaust → all defaults (deep-equal, not same reference)
  assert.deepEqual(plumeCfg({}), EXHAUST_DEFAULTS);
  assert.deepEqual(plumeCfg(undefined), EXHAUST_DEFAULTS);

  // provided keys override; missing keys fall back
  const merged = plumeCfg({ exhaust: { count: 40, speed: 2 } });
  assert.equal(merged.count, 40);
  assert.equal(merged.speed, 2);
  assert.equal(merged.len, EXHAUST_DEFAULTS.len, 'unset key keeps default');

  // nested palette merges per-key (setting only hot keeps default mid/end)
  const pal = plumeCfg({ exhaust: { palette: { hot: 0x123456 } } });
  assert.equal(pal.palette.hot, 0x123456);
  assert.equal(pal.palette.mid, EXHAUST_DEFAULTS.palette.mid);
  assert.equal(pal.palette.end, EXHAUST_DEFAULTS.palette.end);

  // pure: inputs untouched
  const spec = { exhaust: { count: 7 } };
  plumeCfg(spec);
  assert.deepEqual(spec, { exhaust: { count: 7 } });
});

test('decayThrottle rises toward 1 and decays toward 0, never negative', () => {
  let v = 0;
  for (let i = 0; i < 200; i++) v = decayThrottle(v, 1, 1 / 60);
  assert.ok(v > 0.99, `reaches ~1 while target=1 (got ${v})`);

  for (let i = 0; i < 200; i++) v = decayThrottle(v, 0, 1 / 60);
  assert.ok(v < 0.01, `decays toward 0 when target=0 (got ${v})`);
  assert.ok(v >= 0, 'never negative');

  // a single step moves partway, not instantly
  assert.ok(decayThrottle(0, 1, 1 / 60) > 0 && decayThrottle(0, 1, 1 / 60) < 1);
  // huge dt is clamped (can't overshoot past target)
  assert.equal(decayThrottle(0, 1, 100), 1);
});

test('derivePalette: mid === input, hot brighter, end darker', () => {
  const mid = 0x808080;
  const p = derivePalette(mid);
  assert.equal(p.mid, mid, 'mid is the input color');
  const lum = (c) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
  assert.ok(lum(p.hot) > lum(mid), 'hot is brighter');
  assert.ok(lum(p.end) < lum(mid), 'end is darker');

  // pure color channels stay in range
  const red = derivePalette(0xff2010);
  for (const c of [red.hot, red.mid, red.end]) {
    assert.ok((c >> 16 & 255) <= 255 && (c >> 8 & 255) <= 255 && (c & 255) <= 255);
    assert.ok(c >= 0);
  }
});
