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
  assert.match(html, /<canvas|<script type="module"|Space Ninjas/i);
});

test('catalog: ships are seeded (player + enemies) with stats', async () => {
  const ships = await getJson('/api/ships');
  assert.equal(ships.length, 4);
  const names = ships.map((s) => s.name);
  assert.deepEqual(names.sort(), ['Basic player ship', 'basic enemy ship', 'basic mini boss', 'basic rocket enemy'].sort());
  const player = ships.find((s) => s.name === 'Basic player ship');
  assert.equal(player.type, 'player');
  assert.equal(player.modelUrl, 'assets/ships/player.glb');
  assert.equal(player.stats.hull.durability, 100);     // stats parsed from JSON
  assert.equal(player.stats.mounts[0].weapon, 1);      // mounts reference weapons BY ID
  assert.ok(player.stats.groups.gun, 'player has a gun group');
  const enemies = ships.filter((s) => s.type === 'enemy');
  assert.equal(enemies.length, 3);
  const boss = ships.find((s) => s.name === 'basic mini boss');
  assert.equal(boss.stats.sizeScale, 2);
  assert.equal(boss.stats.unlockAfterKills, 10);       // spawn rules live in the data
  assert.equal(boss.stats.spawnWeight, 2);
  // the mini-boss has TWO rocket launchers (the multi-weapon showcase), staggered
  assert.equal(boss.stats.mounts.length, 2);
  assert.ok(boss.stats.mounts.every((m) => m.weapon === 4 && m.group === 'rocket'));
  assert.deepEqual(boss.stats.mounts.map((m) => m.delay).sort(), [0, 0.2]);
});

test('catalog: weapons are seeded with type bullet/rocket', async () => {
  const weapons = await getJson('/api/weapons');
  assert.equal(weapons.length, 4);
  const types = new Set(weapons.map((w) => w.type));
  assert.deepEqual([...types].sort(), ['bullet', 'rocket']);
  const basic = weapons.find((w) => w.name === 'Basic kinetic');
  assert.equal(basic.type, 'bullet');
  assert.equal(basic.stats.power, 10);
  assert.equal(basic.id, 1);            // stable id, referenced by ship mounts
  assert.equal(basic.stats.maxRange, 88); // bullet range is data-driven now
  const rocket = weapons.find((w) => w.name === 'Rocket (homing)');
  assert.equal(rocket.type, 'rocket');
  assert.equal(rocket.id, 3);
  assert.equal(rocket.stats.power, 50);
  assert.equal(rocket.stats.health, 30);  // HP, reduced by a bullet's damage
  assert.equal(rocket.stats.maxRange, 150);
});

test('active ship: a new player gets a default active ship (empty loadout -> ship mounts)', async () => {
  // /active-ship auto-registers the player and grants the starter ship
  const active = await getJson('/api/players/ship-test-1/active-ship');
  assert.equal(active.ship.name, 'Basic player ship');
  assert.equal(active.ship.type, 'player');
  assert.equal(active.ship.modelUrl, 'assets/ships/player.glb');
  // empty loadout falls back to the ship's default mounts
  assert.equal(active.loadout.mounts.length, 2);
  assert.equal(active.loadout.mounts.find((m) => m.group === 'gun').weapon, 1);    // Basic kinetic
  assert.equal(active.loadout.mounts.find((m) => m.group === 'rocket').weapon, 3); // Rocket (homing)
});
