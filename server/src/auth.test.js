import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, newSessionToken, hashToken, parseCookies } from './auth.js';

test('scrypt round-trip: the right password verifies, a wrong one does not', () => {
  const { hash, salt } = hashPassword('correct horse battery');
  assert.ok(hash && salt);
  assert.notEqual(hash, 'correct horse battery'); // never stored in plaintext
  assert.equal(verifyPassword('correct horse battery', hash, salt), true);
  assert.equal(verifyPassword('wrong password', hash, salt), false);
});

test('verifyPassword: a per-user salt makes identical passwords hash differently', () => {
  const a = hashPassword('samepass1');
  const b = hashPassword('samepass1');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
});

test('verifyPassword: safe on missing hash/salt', () => {
  assert.equal(verifyPassword('x', null, null), false);
  assert.equal(verifyPassword('x', '', ''), false);
});

test('session tokens are unique and url-safe; hashToken is stable SHA-256 hex', () => {
  const t1 = newSessionToken();
  const t2 = newSessionToken();
  assert.notEqual(t1, t2);
  assert.match(t1, /^[A-Za-z0-9_-]+$/); // base64url
  const h = hashToken(t1);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, hashToken(t1)); // deterministic
  assert.notEqual(h, t1);         // not the raw token
});

test('parseCookies: parses a Cookie header into name/value pairs', () => {
  assert.deepEqual(parseCookies('session=abc; foo=bar'), { session: 'abc', foo: 'bar' });
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies('session=a%20b'), { session: 'a b' }); // url-decoded
});
