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

// v1 (flat ticks) — still accepted: traces recorded before 2026-08-03 and the shipped intro asset use it.
const sampleTrace = (n = 200) => ({
  version: 1, kind: 'input-replay', id: null, level: 'level-0', seed: 42, dt: 1 / 60,
  shipId: 1, loadout: null, components: null, ticks: Array.from({ length: n }, () => ({ k: [], t: null })),
});
// v2 (run-length packed) — what the client sends now.
const packedTrace = (n = 200, runs = 1) => ({
  version: 2, kind: 'input-replay', id: null, level: 'level-0', seed: 42, dt: 1 / 60,
  shipId: 1, loadout: null, components: null, tickCount: n,
  runs: Array.from({ length: runs }, (_, i) => [{ k: i % 2 ? ['KeyW'] : [], t: null }, Math.ceil(n / runs)]),
});

test('recordSession + getAdminSessions round-trips numbers and a real playerId', async () => {
  await recordSession({ id: 'gs-real', playerId: 'player-abc', level: 'level-1', outcome: 'win',
    durationMs: 12345, kills: 7, s3Key: 'recordings/sessions/gs-real.json', gameVersion: 'testsha1234' });
  const rows = await getAdminSessions(500);
  const row = rows.find((r) => r.id === 'gs-real');
  assert.ok(row, 'row should be returned');
  assert.equal(row.playerId, 'player-abc');
  assert.equal(row.level, 'level-1');
  assert.equal(row.outcome, 'win');
  assert.strictEqual(row.durationMs, 12345);
  assert.strictEqual(row.kills, 7);
  assert.equal(row.gameVersion, 'testsha1234');
  assert.equal(typeof row.createdAt, 'number');
});

test('recordSession accepts a null playerId (anon)', async () => {
  await recordSession({ id: 'gs-anon', playerId: null, level: 'level-0', outcome: 'death',
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
  await recordSession({ id: 'gs-sep', playerId: null, level: 'level-0', outcome: 'quit',
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
    playerId: 'p-route', trace: sampleTrace(200), level: 'level-2', outcome: 'win', durationMs: 8000, kills: 4,
  });
  assert.equal(r.status, 204);
  const { rows } = await pool.query("SELECT * FROM gameplay_sessions WHERE player_id = 'p-route'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].level, 'level-2');
  assert.equal(rows[0].outcome, 'win');
  assert.equal(rows[0].game_version, 'testsha1234'); // server stamps SENTRY_RELEASE
  assert.match(rows[0].s3_key, /^recordings\/sessions\/.+\.json$/);
});

test('POST /api/sessions: a run-length packed (v2) trace is accepted → 204 and a row', async () => {
  const r = await post('/api/sessions', {
    playerId: 'p-packed', trace: packedTrace(600, 3), level: 'level-1', outcome: 'death', durationMs: 10000, kills: 2,
  });
  assert.equal(r.status, 204);
  const { rows } = await pool.query("SELECT * FROM gameplay_sessions WHERE player_id = 'p-packed'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'death');
});

// THE regression this route change exists for: a phone/tablet ships the session provisionally when the tab
// goes hidden, then again (complete, with a real outcome) if the player comes back and finishes. Same
// client-minted id → ONE row that moves forward, not two rows or a stuck 'quit'.
test('POST /api/sessions: re-posting the same client id UPSERTS one row instead of duplicating', async () => {
  const id = 'client-session-abc123';
  const provisional = await post('/api/sessions', {
    id, playerId: 'p-upsert', trace: packedTrace(300), level: 'level-3', outcome: 'quit', durationMs: 5000, kills: 0,
  });
  assert.equal(provisional.status, 204);
  const final = await post('/api/sessions', {
    id, playerId: 'p-upsert', trace: packedTrace(900), level: 'level-3', outcome: 'win', durationMs: 15000, kills: 6,
  });
  assert.equal(final.status, 204);

  const { rows } = await pool.query("SELECT * FROM gameplay_sessions WHERE player_id = 'p-upsert'");
  assert.equal(rows.length, 1, 'one session → one row');
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].outcome, 'win', 'the final outcome replaces the provisional quit');
  assert.equal(Number(rows[0].duration_ms), 15000);
  assert.equal(Number(rows[0].kills), 6);
});

// The upsert must not let one player's re-post rewrite another player's row (client-supplied ids). The
// `written:false` it reports is also what stops the route from overwriting that session's S3 trace.
test('recordSession: an id owned by another player is never overwritten', async () => {
  const mine = await recordSession({ id: 'gs-owned', playerId: 'owner', level: 'level-0', outcome: 'win',
    durationMs: 1000, kills: 1, s3Key: 'recordings/sessions/gs-owned.json', gameVersion: null });
  assert.equal(mine.written, true);
  const theirs = await recordSession({ id: 'gs-owned', playerId: 'intruder', level: 'level-9', outcome: 'death',
    durationMs: 9999, kills: 99, s3Key: 'recordings/sessions/hijack.json', gameVersion: null });
  assert.equal(theirs.written, false, 'a rejected upsert must report it, so the route skips the S3 write too');
  const { rows } = await pool.query("SELECT * FROM gameplay_sessions WHERE id = 'gs-owned'");
  assert.equal(rows[0].player_id, 'owner');
  assert.equal(rows[0].outcome, 'win');
  assert.equal(rows[0].s3_key, 'recordings/sessions/gs-owned.json');
});

test('POST /api/sessions: junk body (no ticks) → 400', async () => {
  const r = await post('/api/sessions', { trace: { ticks: [] }, level: 'level-0', outcome: 'win' });
  assert.equal(r.status, 400);
});

test('POST /api/sessions: a packed trace with no runs → 400', async () => {
  const r = await post('/api/sessions', { trace: { ...packedTrace(200), runs: [], tickCount: 0 }, level: 'level-0', outcome: 'win' });
  assert.equal(r.status, 400);
});

test('POST /api/sessions: oversized ticks → 413', async () => {
  const r = await post('/api/sessions', { trace: { ...packedTrace(200), tickCount: 120001 }, level: 'level-0', outcome: 'win' });
  assert.equal(r.status, 413);
});

test('POST /api/sessions: too many runs → 413', async () => {
  const trace = { ...packedTrace(200), runs: Array.from({ length: 25001 }, () => [{ k: [], t: null }, 1]), tickCount: 25001 };
  const r = await post('/api/sessions', { trace, level: 'level-0', outcome: 'win' });
  assert.equal(r.status, 413);
});

test('POST /api/sessions: bad outcome → 400', async () => {
  const r = await post('/api/sessions', { trace: sampleTrace(200), level: 'level-0', outcome: 'bogus' });
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
