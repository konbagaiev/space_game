import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// This file runs in its own process (node --test), so it can control ADMIN_* env without touching the
// main suite's settings. With ADMIN_USER/ADMIN_PASSWORD unset, /admin must 404 (admin disabled — never
// open on prod), even for a request that carries valid-looking Basic Auth.
delete process.env.ADMIN_USER;
delete process.env.ADMIN_PASSWORD;

const { mountAdmin, adminEnabled } = await import('./admin.js');

const app = express();
mountAdmin(app, async () => []); // injected datastore fn — never reached while disabled
const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const base = `http://localhost:${server.address().port}`;
after(() => server.close());

test('adminEnabled: false when the env vars are unset', () => {
  assert.equal(adminEnabled(), false);
});

test('admin: 404 when disabled (env unset), even with Basic Auth', async () => {
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') };
  const r = await fetch(base + '/admin', { headers: auth });
  assert.equal(r.status, 404);
});

test('adminEnabled: true once both env vars are set', () => {
  process.env.ADMIN_USER = 'admin';
  process.env.ADMIN_PASSWORD = 'secret';
  assert.equal(adminEnabled(), true);
  delete process.env.ADMIN_USER;
  delete process.env.ADMIN_PASSWORD;
});
