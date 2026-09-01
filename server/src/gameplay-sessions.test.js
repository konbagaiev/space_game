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

// ---------- the duel referee (docs/plans/2026-09-01-1845-duel-referee.md) ----------

const { recordSessionVerdict } = await import('./datastore.js');
const { makeTrace } = await import('../../client/src/replay.js');
const { DUEL_LOADOUT, DUEL_COMPONENTS } = await import('../../client/src/duel-dev.js');
const { duelAnchorReached } = await import('../../client/src/sim-core/duel-config.js');
const { runTrace } = await import('../tools/sim-replay.mjs');

// An all-idle duel against two aces: the fight settles on the death anchor in about nine seconds of sim.
const duelTrace = (ticks = 1800) => makeTrace({
  id: null, level: 'level-1', seed: 12345, dt: 1 / 60, shipId: 1,
  loadout: DUEL_LOADOUT, components: DUEL_COMPONENTS, skills: null,
  room: { kind: 'duel', aces: 2 }, runs: [[{ k: [], t: null }, ticks]], tickCount: ticks,
});
const honestAnchor = (trace) => {
  const r = runTrace(trace, { stopWhen: duelAnchorReached });
  return { tick: r.ticksRun, hash: r.hash, draws: r.draws };
};
const rowById = async (id) => (await getAdminSessions(500)).find((r) => r.id === id);
// The referee runs on setImmediate AFTER the 204, so the row is written a beat later. Poll rather than
// sleep a fixed amount — the re-simulation itself is ~10 ms.
const waitForVerdict = async (id, ms = 5000) => {
  for (let t = 0; t < ms; t += 25) {
    const row = await rowById(id);
    if (row && row.verdict) return row;
    await new Promise((r) => setTimeout(r, 25));
  }
  return rowById(id);
};

test('POST /api/sessions: a duel session is labelled duel:level-N and records its JS engine', async () => {
  const id = 'gs-duel-label';
  const r = await post('/api/sessions', { id, trace: duelTrace(300), level: 'level-1', outcome: 'death',
    durationMs: 5000, kills: 0, engine: 'WebKit/18.2' });   // no anchor → the referee does not run
  assert.equal(r.status, 204);
  const row = await rowById(id);
  assert.ok(row, 'the row was written');
  assert.equal(row.level, 'duel:level-1',
    'a duel is not a campaign run and must not sit in the campaign funnel under a level it did not play');
  assert.equal(row.jsEngine, 'WebKit/18.2');
  assert.equal(row.verdict, null, 'no anchor claimed → nothing to judge');
});

test('POST /api/sessions: a campaign session is untouched — plain level, no verdict', async () => {
  const id = 'gs-campaign-plain';
  const r = await post('/api/sessions', { id, trace: packedTrace(200), level: 'level-0', outcome: 'win',
    durationMs: 4000, kills: 2, engine: 'Chromium/140.0.0.0' });
  assert.equal(r.status, 204);
  const row = await rowById(id);
  assert.equal(row.level, 'level-0');
  assert.equal(row.verdict, null);
  assert.equal(row.verdictNote, null);
  assert.equal(row.jsEngine, 'Chromium/140.0.0.0');
});

// THE WIRING, end to end through the real route: upload a genuine duel with an honest anchor and the build
// this process is, and the referee's verdict lands on the row on its own. This is the guard on the
// setImmediate hop — an import that is never CALLED looks exactly like a working feature otherwise.
test('POST /api/sessions: an honest duel gets an `agree` verdict written onto its row', async () => {
  const id = 'gs-duel-agree';
  const trace = duelTrace();
  const anchor = honestAnchor(trace);
  const r = await post('/api/sessions', { id, trace, level: 'level-1', outcome: 'death', durationMs: 9000,
    kills: 0, anchor, gameVersion: 'testsha1234', engine: 'Chromium/140.0.0.0' });
  assert.equal(r.status, 204);
  const row = await waitForVerdict(id);
  assert.equal(row.verdict, 'agree', `note=${row.verdictNote}`);
  assert.match(row.verdictNote, /^kills=/);
});

// The build gate is live on this process (SENTRY_RELEASE is set at the top of this file), and a page that
// never learned its build sends null — which must fail to `unverifiable`, not to a judgement. §129's
// failure mode is an honest player being robbed.
test('POST /api/sessions: a duel with no build echo is refused rather than judged', async () => {
  const id = 'gs-duel-nobuild';
  const trace = duelTrace();
  const r = await post('/api/sessions', { id, trace, level: 'level-1', outcome: 'death', durationMs: 9000,
    kills: 0, anchor: honestAnchor(trace) });                 // gameVersion omitted
  assert.equal(r.status, 204);
  const row = await waitForVerdict(id);
  assert.equal(row.verdict, 'unverifiable');
  assert.equal(row.verdictNote, 'build-unknown');
});

test('recordSessionVerdict writes the two columns onto an existing row', async () => {
  await recordSession({ id: 'gs-verdict', playerId: null, level: 'duel:level-1', outcome: 'death',
    durationMs: 1000, kills: 0, s3Key: 'recordings/sessions/gs-verdict.json', gameVersion: 'testsha1234' });
  await recordSessionVerdict({ id: 'gs-verdict', verdict: 'disagree', note: 'draws 41≠38 (kills=0 hp=-3 t=528)' });
  const row = await rowById('gs-verdict');
  assert.equal(row.verdict, 'disagree');
  assert.equal(row.verdictNote, 'draws 41≠38 (kills=0 hp=-3 t=528)');
});

// A session can be uploaded twice (provisional flush when the tab is hidden, then the final one), and the
// referee's answer is written asynchronously in between. The upsert must not wipe it.
test('a re-upload of the same session id does NOT erase an existing verdict', async () => {
  const id = 'gs-verdict-keep';
  await recordSession({ id, playerId: null, level: 'duel:level-1', outcome: 'death', durationMs: 1000,
    kills: 0, s3Key: `recordings/sessions/${id}.json`, gameVersion: 'testsha1234', jsEngine: 'Gecko/133.0' });
  await recordSessionVerdict({ id, verdict: 'agree', note: 'kills=0 hp=-32 t=528' });
  await recordSession({ id, playerId: null, level: 'duel:level-1', outcome: 'death', durationMs: 9500,
    kills: 0, s3Key: `recordings/sessions/${id}.json`, gameVersion: 'testsha1234', jsEngine: 'Gecko/133.0' });
  const row = await rowById(id);
  assert.equal(row.durationMs, 9500, 'the re-upload did land');
  assert.equal(row.verdict, 'agree', 'and it left the verdict alone');
  assert.equal(row.verdictNote, 'kills=0 hp=-32 t=528');
});

test('GET /admin/sessions renders the verdict and engine cells, one <td> per header', async () => {
  const html = await (await get('/admin/sessions', adminAuth)).text();
  assert.match(html, /<th data-col="7">verdict<\/th>/);
  assert.match(html, /<th data-col="8">engine<\/th>/);
  assert.match(html, /<th data-col="9">watch<\/th>/, 'watch stays last, or the sort script points at the wrong column');
  const headers = (html.match(/<th[ >]/g) || []).length;
  const firstRow = html.split('<tbody>')[1].split('</tr>')[0];
  assert.equal((firstRow.match(/<td[ >]/g) || []).length, headers,
    'every row must carry exactly as many cells as there are headers');
  assert.match(html, /disagree|agree|unverifiable/, 'a verdict actually reaches the page');
});
