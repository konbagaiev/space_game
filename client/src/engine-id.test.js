// The JS engine a simulation ran on, parsed off a User-Agent (docs/plans/2026-09-01-1845-duel-referee.md
// §3.2). The one that matters and is easy to get wrong is Chrome on an iPhone: it is `CriOS`, it is WebKit,
// and recording it as Chromium would name an engine that never ran — which is the exact confusion this
// column exists to remove when the first honest `disagree` shows up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEngine } from './engine-id.js';

const UA = {
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.3405.86',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.7204.63 Mobile Safari/537.36',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.100 Mobile/15E148 Safari/604.1',
  firefoxIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
};

test('parseEngine names the family and the version for the engines we actually see', () => {
  assert.equal(parseEngine(UA.chromeMac), 'Chromium/140.0.0.0');
  // Edge reports BOTH `Chrome/139.0.0.0` and `Edg/139.0.3405.86`; the Chromium version is the one that
  // names the ENGINE, which is all this column is about, and it is the earlier match.
  assert.equal(parseEngine(UA.edge), 'Chromium/139.0.0.0');
  assert.equal(parseEngine(UA.chromeAndroid), 'Chromium/138.0.7204.63');
  assert.equal(parseEngine(UA.safariMac), 'WebKit/18.2');
  assert.equal(parseEngine(UA.firefox), 'Gecko/133.0');
});

// EVERY browser on iOS is WebKit, by App Store rule. Matching Chrome/Firefox first would file a WebKit run
// under Chromium and make the resulting `disagree` unreadable.
test('parseEngine: on iOS every browser is WebKit, Chrome and Firefox included', () => {
  assert.equal(parseEngine(UA.safariIphone), 'WebKit/18.2');
  // A CriOS/FxiOS UA carries no `Version/` at all, so the AppleWebKit build number is the fallback — still
  // WebKit, which is the fact the column exists to record. The failure mode this pins is reporting these
  // two as `Chromium/140…` and `Gecko/133…`, engines that never ran.
  assert.ok(parseEngine(UA.chromeIphone).startsWith('WebKit/'), 'CriOS is Chrome the shell, WebKit the engine');
  assert.equal(parseEngine(UA.chromeIphone), 'WebKit/605.1.15');
  assert.equal(parseEngine(UA.firefoxIphone), 'WebKit/605.1.15');
});

test('parseEngine: anything it cannot read is null, never a guess', () => {
  assert.equal(parseEngine('curl/8.4.0'), null);
  assert.equal(parseEngine(''), null);
  assert.equal(parseEngine(null), null);
  assert.equal(parseEngine(undefined), null);
});

test('parseEngine caps the label at 64 characters (it is a TEXT column and a table cell)', () => {
  const long = 'Mozilla/5.0 (X) AppleWebKit/537.36 Chrome/' + '9'.repeat(200) + ' Safari/537.36';
  assert.ok(parseEngine(long).length <= 64);
  assert.ok(parseEngine(long).startsWith('Chromium/9'));
});
