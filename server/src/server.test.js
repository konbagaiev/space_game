import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Use a throwaway temp database (must be set before importing the server/db).
const dbPath = path.join(os.tmpdir(), `spacegame-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

const { createApp } = await import('./server.js');
const app = await createApp();
const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const base = `http://localhost:${server.address().port}`;

after(() => {
  server.close();
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
    try { fs.rmSync(f); } catch {}
  }
});

const post = (p, body) =>
  fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const getJson = async (p) => (await fetch(base + p)).json();

test('register: new player is created', async () => {
  const r = await post('/api/players/register', { playerId: 'p1' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.id, 'p1');
  assert.equal(j.isNew, true);
  assert.equal(j.gamesPlayed, 0);
});

test('register: same id again is not new', async () => {
  const j = await (await post('/api/players/register', { playerId: 'p1' })).json();
  assert.equal(j.isNew, false);
});

test('register: missing playerId -> 400', async () => {
  const r = await post('/api/players/register', {});
  assert.equal(r.status, 400);
});

test('record game: stored and returned in history', async () => {
  const r = await post('/api/games', { playerId: 'p1', score: 7, kills: 7, durationMs: 42000 });
  assert.equal(r.status, 200);
  const { gameId } = await r.json();
  assert.ok(Number.isInteger(gameId) && gameId > 0);

  const history = await getJson('/api/players/p1/games');
  assert.equal(history.length, 1);
  assert.equal(history[0].score, 7);
  assert.equal(history[0].kills, 7);
  assert.equal(history[0].duration_ms, 42000);
});

test('record game: missing playerId -> 400', async () => {
  const r = await post('/api/games', { score: 1 });
  assert.equal(r.status, 400);
});

test('record game: auto-creates an unknown player', async () => {
  await post('/api/games', { playerId: 'ghost', score: 1, kills: 1, durationMs: 1000 });
  const history = await getJson('/api/players/ghost/games');
  assert.equal(history.length, 1);
});

test('history is newest-first and games_played increments', async () => {
  await post('/api/players/register', { playerId: 'p2' });
  await post('/api/games', { playerId: 'p2', score: 1, kills: 1, durationMs: 100 });
  await post('/api/games', { playerId: 'p2', score: 2, kills: 2, durationMs: 200 });
  await post('/api/games', { playerId: 'p2', score: 3, kills: 3, durationMs: 300 });

  const history = await getJson('/api/players/p2/games');
  assert.equal(history.length, 3);
  assert.deepEqual(history.map((g) => g.score), [3, 2, 1]); // newest first

  const reg = await (await post('/api/players/register', { playerId: 'p2' })).json();
  assert.equal(reg.gamesPlayed, 3);
});

test('health reports ok and aggregate counts', async () => {
  const j = await getJson('/api/health');
  assert.equal(j.ok, true);
  assert.ok(j.players >= 3); // p1, ghost, p2
  assert.ok(j.games >= 5);
});

test('serves the game client at /', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<canvas|<script type="module"|Space Combat/i);
});
