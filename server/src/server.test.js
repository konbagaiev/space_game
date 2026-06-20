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

test('register: a new player starts at progress 1 (level-1 unlocked)', async () => {
  const j = await (await post('/api/players/register', { playerId: 'prog-1' })).json();
  assert.equal(j.currentProgress, 1);
});

test('language: defaults to en, can be set to ru, rejects unsupported, and is returned with the ship', async () => {
  // a new player defaults to English
  const reg = await (await post('/api/players/register', { playerId: 'lang-1' })).json();
  assert.equal(reg.language, 'en');

  // set to ru
  const set = await post('/api/players/lang-1/language', { language: 'ru' });
  assert.equal(set.status, 200);
  assert.equal((await set.json()).language, 'ru');

  // active-ship carries the stored preference (so the client can adopt it)
  const active = await getJson('/api/players/lang-1/active-ship');
  assert.equal(active.language, 'ru');
  // and so does a re-register
  assert.equal((await (await post('/api/players/register', { playerId: 'lang-1' })).json()).language, 'ru');

  // unsupported language -> 400
  assert.equal((await post('/api/players/lang-1/language', { language: 'de' })).status, 400);
  assert.equal((await post('/api/players/lang-1/language', {})).status, 400);
});

test('progress: current level is level-1, and advancing unlocks the next levels', async () => {
  // a fresh player is on level-1
  const lvl1 = await getJson('/api/players/prog-2/level');
  assert.equal(lvl1.name, 'level-1');
  assert.ok(lvl1.descriptor.phases, 'returns the full descriptor');

  // clearing it unlocks level-2, then level-3
  const a1 = await (await post('/api/players/prog-2/advance', {})).json();
  assert.equal(a1.advanced, true);
  assert.equal((await getJson('/api/players/prog-2/level')).name, 'level-2');

  const a2 = await (await post('/api/players/prog-2/advance', {})).json();
  assert.equal(a2.advanced, true);
  assert.equal((await getJson('/api/players/prog-2/level')).name, 'level-3');

  // already at the last level → no-op
  const a3 = await (await post('/api/players/prog-2/advance', {})).json();
  assert.equal(a3.advanced, false);
  assert.equal((await getJson('/api/players/prog-2/level')).name, 'level-3');

  // progress persists on re-register
  const reg = await (await post('/api/players/register', { playerId: 'prog-2' })).json();
  assert.equal(reg.currentProgress, 3);
});

test('register: missing playerId -> 400', async () => {
  const r = await post('/api/players/register', {});
  assert.equal(r.status, 400);
});

test('record game: stored in history and credits banked into the balance', async () => {
  // p1 starts at the default 1000 balance
  assert.equal((await (await post('/api/players/register', { playerId: 'p1' })).json()).credits, 1000);
  const r = await post('/api/games', { playerId: 'p1', credits: 7, kills: 7, durationMs: 42000 });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Number.isInteger(body.gameId) && body.gameId > 0);
  assert.equal(body.credits, 1007); // earned credits banked → new balance returned

  const history = await getJson('/api/players/p1/games');
  assert.equal(history.length, 1);
  assert.equal(history[0].credits, 7);
  assert.equal(history[0].kills, 7);
  assert.equal(history[0].duration_ms, 42000);
  // the balance persists on re-register
  assert.equal((await (await post('/api/players/register', { playerId: 'p1' })).json()).credits, 1007);
});

test('register: a new player starts with a 1000-credit balance', async () => {
  const j = await (await post('/api/players/register', { playerId: 'rich-1' })).json();
  assert.equal(j.credits, 1000);
});

test('record game: missing playerId -> 400', async () => {
  const r = await post('/api/games', { credits: 1 });
  assert.equal(r.status, 400);
});

test('record game: auto-creates an unknown player', async () => {
  await post('/api/games', { playerId: 'ghost', credits: 1, kills: 1, durationMs: 1000 });
  const history = await getJson('/api/players/ghost/games');
  assert.equal(history.length, 1);
});

test('history is newest-first, games_played increments, and credits accumulate', async () => {
  await post('/api/players/register', { playerId: 'p2' });
  await post('/api/games', { playerId: 'p2', credits: 10, kills: 1, durationMs: 100 });
  await post('/api/games', { playerId: 'p2', credits: 20, kills: 2, durationMs: 200 });
  await post('/api/games', { playerId: 'p2', credits: 30, kills: 3, durationMs: 300 });

  const history = await getJson('/api/players/p2/games');
  assert.equal(history.length, 3);
  assert.deepEqual(history.map((g) => g.credits), [30, 20, 10]); // newest first

  const reg = await (await post('/api/players/register', { playerId: 'p2' })).json();
  assert.equal(reg.gamesPlayed, 3);
  assert.equal(reg.credits, 1060); // 1000 + 10 + 20 + 30
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
  assert.equal(ships.length, 5);
  const names = ships.map((s) => s.name);
  assert.deepEqual(names.sort(),
    ['Basic player ship', 'basic enemy ship', 'basic mini boss', 'basic rocket enemy', 'first boss'].sort());
  const player = ships.find((s) => s.name === 'Basic player ship');
  assert.equal(player.type, 'player');
  assert.equal(player.modelUrl, 'assets/ships/player.glb');
  assert.deepEqual(player.components, { hull: 1, engine: 5, thruster: 8 }); // assembled from components
  assert.equal(player.stats.mounts[0].weapon, 1);              // mounts reference weapons BY ID
  assert.ok(player.stats.groups.gun, 'player has a gun group');
  const enemies = ships.filter((s) => s.type === 'enemy');
  assert.equal(enemies.length, 4); // fighter, rocketeer, mini-boss, first boss
  // fighter + rocketeer share the same light hull + scout engine + scout thrusters
  const fighter = ships.find((s) => s.name === 'basic enemy ship');
  const rocketeer = ships.find((s) => s.name === 'basic rocket enemy');
  assert.deepEqual(fighter.components, { hull: 2, engine: 6, thruster: 9 });
  assert.deepEqual(rocketeer.components, fighter.components);
  const mini = ships.find((s) => s.name === 'basic mini boss');
  assert.equal(mini.stats.role, 'medium');
  assert.deepEqual(mini.components, { hull: 3, engine: 6, thruster: 10 }); // medium hull + scout engine + weak thrusters
  assert.equal(mini.stats.mounts.length, 2);                 // two staggered rocket launchers
  assert.deepEqual(mini.stats.mounts.map((m) => m.delay).sort(), [0, 0.2]);
  const boss = ships.find((s) => s.name === 'first boss');
  assert.equal(boss.stats.role, 'boss');
  assert.deepEqual(boss.components, { hull: 4, engine: 7, thruster: 11 }); // its own hull + engine + thrusters
  assert.equal(boss.stats.mounts.length, 4); // two guns + two rockets
  // score rewards per enemy type
  assert.equal(fighter.stats.reward, 20);
  assert.equal(rocketeer.stats.reward, 40);
  assert.equal(mini.stats.reward, 100);
  assert.equal(boss.stats.reward, 200);
});

test('catalog: components (hulls + engines + thrusters) are seeded', async () => {
  const comps = await getJson('/api/components');
  assert.equal(comps.length, 11); // 4 hulls + 3 engines + 4 thrusters
  const light = comps.find((c) => c.name === 'Light hull');
  assert.equal(light.type, 'hull');
  assert.equal(light.weight, 8);
  assert.equal(light.stats.durability, 30); // fighter + rocketeer durability equalized to 30
  const scout = comps.find((c) => c.name === 'Scout engine');
  assert.equal(scout.type, 'engine');
  assert.equal(scout.stats.power, 12.6); // acceleration (no turnPower — that's the thruster's job now)
  const scoutThr = comps.find((c) => c.name === 'Scout thrusters');
  assert.equal(scoutThr.type, 'thruster');
  assert.equal(scoutThr.stats.power, 1.6); // maneuverability (turn rate)
  const medium = comps.find((c) => c.name === 'Medium hull');
  assert.equal(medium.weight, 60);         // heavier hull -> sluggish via mass
});

test('levels: level-1 (easy, no boss), level-2 (medium boss), level-3 (Sector boss) are served', async () => {
  const l1 = await getJson('/api/levels/level-1');
  assert.equal(l1.descriptor.map, 'home-system');
  assert.equal(l1.descriptor.phases[0].advanceWhen.kills, 7);              // gentle ramp
  assert.equal(l1.descriptor.phases[0].spawn.pool[0].ship, 'basic enemy ship'); // fighters only
  assert.equal(l1.descriptor.phases.at(-1).event, 'win');
  assert.ok(!JSON.stringify(l1.descriptor).includes('first boss'), 'level-1 has no boss');

  const l2 = await getJson('/api/levels/level-2');
  assert.equal(l2.descriptor.phases.at(-2).spawn.pool[0].ship, 'basic mini boss'); // the medium IS the boss

  const l3 = await getJson('/api/levels/level-3');
  assert.equal(l3.descriptor.phases.at(-2).spawn.pool[0].ship, 'first boss');       // the Sector boss

  assert.equal((await fetch(base + '/api/levels/nope')).status, 404);
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

test('maps: home-system descriptor is served', async () => {
  const map = await getJson('/api/maps/home-system');
  assert.equal(map.name, 'home-system');
  assert.equal(map.descriptor.generator, 'planet-system');
  assert.equal(map.descriptor.planet.radius, 60);
  assert.equal(map.descriptor.moons.length, 2);
  const missing = await fetch(base + '/api/maps/nope');
  assert.equal(missing.status, 404);
});

test('active ship: a new player gets a default active ship (empty loadout -> ship mounts)', async () => {
  // /active-ship auto-registers the player and grants the starter ship
  const active = await getJson('/api/players/ship-test-1/active-ship');
  assert.equal(active.ship.name, 'Basic player ship');
  assert.equal(active.ship.type, 'player');
  assert.equal(active.ship.modelUrl, 'assets/ships/player.glb');
  // empty loadout/components fall back to the ship's defaults
  assert.equal(active.loadout.mounts.length, 2);
  assert.equal(active.loadout.mounts.find((m) => m.group === 'gun').weapon, 1);    // Basic kinetic
  assert.equal(active.loadout.mounts.find((m) => m.group === 'rocket').weapon, 3); // Rocket (homing)
  assert.deepEqual(active.components, { hull: 1, engine: 5, thruster: 8 });
});
