import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'admin';       // enable the /admin dashboard for the suite (Basic Auth)
process.env.ADMIN_PASSWORD = 'secret';
process.env.SENTRY_RELEASE = 'testsha1234'; // the deploy commit stamped onto every session row + the ✓/✗ marker

const { createApp } = await import('./server.js');
const { pool, recordSession, getAdminSessions, getSessionS3Key } = await import('./datastore.js');
const app = await createApp();
const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const base = `http://localhost:${server.address().port}`;

after(() => { server.close(); });

const post = (p, body, headers = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (p, headers = {}) => fetch(base + p, { headers });
const adminAuth = { Authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') };

const sampleTrace = (n = 200) => ({
  version: 1, kind: 'input-replay', id: null, level: 'level-1', seed: 42, dt: 1 / 60,
  shipId: 1, loadout: null, components: null, ticks: Array.from({ length: n }, () => ({ k: [], t: null })),
});

test('recordSession + getAdminSessions round-trips numbers and a real playerId', async () => {
  await recordSession({ id: 'gs-real', playerId: 'player-abc', level: 'level-2', outcome: 'win',
    durationMs: 12345, kills: 7, s3Key: 'recordings/sessions/gs-real.json', gameVersion: 'testsha1234' });
  const rows = await getAdminSessions(500);
  const row = rows.find((r) => r.id === 'gs-real');
  assert.ok(row, 'row should be returned');
  assert.equal(row.playerId, 'player-abc');
  assert.equal(row.level, 'level-2');
  assert.equal(row.outcome, 'win');
  assert.strictEqual(row.durationMs, 12345);
  assert.strictEqual(row.kills, 7);
  assert.equal(row.gameVersion, 'testsha1234');
  assert.equal(typeof row.createdAt, 'number');
});

test('recordSession accepts a null playerId (anon)', async () => {
  await recordSession({ id: 'gs-anon', playerId: null, level: 'level-1', outcome: 'death',
    durationMs: 3000, kills: 0, s3Key: 'recordings/sessions/gs-anon.json', gameVersion: null });
  const rows = await getAdminSessions(500);
  const row = rows.find((r) => r.id === 'gs-anon');
  assert.ok(row);
  assert.equal(row.playerId, null);
  assert.equal(row.gameVersion, null);
});

test('getSessionS3Key returns the key, null for an unknown id', async () => {
  assert.equal(await getSessionS3Key('gs-real'), 'recordings/sessions/gs-real.json');
  assert.equal(await getSessionS3Key('does-not-exist'), null);
});

// Guard: gameplay_sessions must be a DISTINCT table from the auth `sessions` token store — a future
// rename that re-collides would silently no-op the CREATE TABLE and break every insert.
test('gameplay_sessions is separate from the auth `sessions` table', async () => {
  await recordSession({ id: 'gs-sep', playerId: null, level: 'level-1', outcome: 'quit',
    durationMs: 5000, kills: 1, s3Key: 'recordings/sessions/gs-sep.json', gameVersion: 'testsha1234' });
  // The auth sessions table has no `id` column and never holds our gameplay row.
  const { rows } = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions'");
  const cols = rows.map((r) => r.column_name);
  assert.ok(cols.includes('token_hash'), 'auth sessions still keyed by token_hash');
  assert.ok(!cols.includes('outcome'), 'auth sessions must not have gameplay columns');
  const authRows = await pool.query('SELECT * FROM sessions');
  assert.ok(!authRows.rows.some((r) => r.token_hash === 'gs-sep'), 'gameplay row never lands in auth sessions');
});

test('POST /api/sessions: valid body → 204 and a DB row (S3 no-ops without creds)', async () => {
  const r = await post('/api/sessions', {
    playerId: 'p-route', trace: sampleTrace(200), level: 'level-3', outcome: 'win', durationMs: 8000, kills: 4,
  });
  assert.equal(r.status, 204);
  const { rows } = await pool.query("SELECT * FROM gameplay_sessions WHERE player_id = 'p-route'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].level, 'level-3');
  assert.equal(rows[0].outcome, 'win');
  assert.equal(rows[0].game_version, 'testsha1234'); // server stamps SENTRY_RELEASE
  assert.match(rows[0].s3_key, /^recordings\/sessions\/.+\.json$/);
});

test('POST /api/sessions: junk body (no ticks) → 400', async () => {
  const r = await post('/api/sessions', { trace: { ticks: [] }, level: 'level-1', outcome: 'win' });
  assert.equal(r.status, 400);
});

test('POST /api/sessions: oversized ticks → 413', async () => {
  const r = await post('/api/sessions', { trace: sampleTrace(40001), level: 'level-1', outcome: 'win' });
  assert.equal(r.status, 413);
});

test('POST /api/sessions: bad outcome → 400', async () => {
  const r = await post('/api/sessions', { trace: sampleTrace(200), level: 'level-1', outcome: 'bogus' });
  assert.equal(r.status, 400);
});

test('GET /admin/sessions: Basic Auth → 200 HTML with a playback link; no auth → 401', async () => {
  const ok = await get('/admin/sessions', adminAuth);
  assert.equal(ok.status, 200);
  const html = await ok.text();
  assert.match(html, /\/\?playback&id=/);
  assert.match(html, /Sessions —/);

  const noAuth = await get('/admin/sessions');
  assert.equal(noAuth.status, 401);
});

test('GET /admin/sessions: admin disabled (env unset) → 404', async () => {
  const savedUser = process.env.ADMIN_USER, savedPass = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_USER; delete process.env.ADMIN_PASSWORD;
  try {
    const r = await get('/admin/sessions', adminAuth);
    assert.equal(r.status, 404);
  } finally {
    process.env.ADMIN_USER = savedUser; process.env.ADMIN_PASSWORD = savedPass;
  }
});
