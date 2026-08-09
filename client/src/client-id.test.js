import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { makeClientId } from './client-id.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('makeClientId: uses randomUUID when available (secure context)', () => {
  assert.equal(makeClientId({ randomUUID: () => 'abc-123' }), 'abc-123');
});

// The regression: over http://<ip> (a NON-secure context) crypto.randomUUID is missing/throws.
test('makeClientId: no randomUUID → getRandomValues yields a valid v4 uuid', () => {
  const c = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 0xff; return a; } };
  assert.match(makeClientId(c), UUID_RE);
});

test('makeClientId: randomUUID that THROWS (insecure) still falls back to a valid id', () => {
  const c = { randomUUID: () => { throw new Error('SecurityError'); }, getRandomValues: (a) => a.fill(7) };
  assert.match(makeClientId(c), UUID_RE);
});

test('makeClientId: no crypto at all → non-empty fallback, never throws', () => {
  const id = makeClientId({});
  assert.ok(typeof id === 'string' && id.length > 8, id);
});

test('makeClientId: real environment returns a usable, non-empty id', () => {
  assert.ok(makeClientId().length > 8);
});
