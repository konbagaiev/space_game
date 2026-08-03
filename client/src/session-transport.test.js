import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendSession } from './session-transport.js';

// Stub the injected transport primitives, recording what was called.
function stubEnv() {
  const calls = { fetch: [], beacon: [] };
  return {
    calls,
    fetch: (url, init) => { calls.fetch.push({ url, init }); return { catch: () => {} }; },
    sendBeacon: (url, blob) => { calls.beacon.push({ url, blob }); return true; },
    Blob: class { constructor(parts, opts) { this.parts = parts; this.opts = opts; } },
  };
}

const URL = '/api/sessions';
const BODY = JSON.stringify({ trace: { ticks: [] }, outcome: 'win' });

// THE regression: win/death flush (beacon:false) must use a PLAIN fetch with NO `keepalive` — a keepalive
// request body is capped at ~64KB in Chrome, which silently dropped every completed-level (win) trace.
test('win/death flush (beacon:false) uses fetch WITHOUT keepalive (no 64KB body cap)', () => {
  const env = stubEnv();
  const route = sendSession(URL, BODY, false, env);
  assert.equal(route, 'fetch');
  assert.equal(env.calls.fetch.length, 1, 'exactly one fetch issued');
  assert.equal(env.calls.beacon.length, 0, 'no beacon on the win/death path');
  const init = env.calls.fetch[0].init;
  assert.equal(init.method, 'POST');
  assert.equal(init.body, BODY);
  // The load-bearing assertion — this FAILS if the code sets keepalive:true (the bug that dropped win traces).
  assert.ok(!('keepalive' in init), 'the win/death fetch must NOT set keepalive (that caps the body at ~64KB)');
});

// The unload path stays on sendBeacon (its ~64KB cap is an accepted v1 limit for tab-closers).
test('unload flush (beacon:true) uses sendBeacon, not fetch', () => {
  const env = stubEnv();
  const route = sendSession(URL, BODY, true, env);
  assert.equal(route, 'beacon');
  assert.equal(env.calls.beacon.length, 1, 'exactly one beacon issued');
  assert.equal(env.calls.fetch.length, 0, 'no fetch on the unload path');
  assert.equal(env.calls.beacon[0].url, URL);
});

// Falls back to fetch when sendBeacon is unavailable, even on the unload path.
test('beacon:true with no sendBeacon falls back to fetch (still no keepalive)', () => {
  const env = stubEnv();
  env.sendBeacon = null;
  const route = sendSession(URL, BODY, true, env);
  assert.equal(route, 'fetch');
  assert.ok(!('keepalive' in env.calls.fetch[0].init));
});
