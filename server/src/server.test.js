import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Use a throwaway temp database (must be set before importing the server/db).
const dbPath = path.join(os.tmpdir(), `spacegame-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.NODE_ENV = 'test'; // non-Secure cookies so local-http tests can read/replay them

const { createApp } = await import('./server.js');
const { outbox } = await import('./ses.js');
const app = await createApp();
const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const base = `http://localhost:${server.address().port}`;

after(() => {
  server.close();
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
    try { fs.rmSync(f); } catch {}
  }
});

const post = (p, body, headers = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const getJson = async (p) => (await fetch(base + p)).json();

// Pull the raw `session` cookie value out of a response's Set-Cookie header(s).
function sessionCookie(res) {
  for (const c of (res.headers.getSetCookie?.() || [])) {
    const m = /^session=([^;]*)/.exec(c);
    if (m) return m[1];
  }
  return null;
}
const authHeader = (token) => (token ? { Cookie: `session=${token}` } : {});

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

test('briefing: advancing into level-2 returns its message and swaps the basic gun for the Machine Gun', async () => {
  // a fresh player starts with the basic kinetic (weapon 1) as the gun
  const before = await getJson('/api/players/brief-1/active-ship');
  const gunBefore = before.loadout.mounts.find((m) => m.group === 'gun');
  assert.equal(gunBefore.weapon, 1); // Basic kinetic

  // clearing level-1 advances to level-2 → runs its briefing (message + replaceWeapon action)
  const adv = await (await post('/api/players/brief-1/advance', {})).json();
  assert.equal(adv.advanced, true);
  assert.equal(adv.briefing.textKey, 'level.2.briefing');
  assert.match(adv.briefing.text, /machine gun/i);

  // the active ship's gun is now the Machine Gun (weapon 5); the rocket is untouched
  const after = await getJson('/api/players/brief-1/active-ship');
  assert.equal(after.loadout.mounts.find((m) => m.group === 'gun').weapon, 5);
  assert.equal(after.loadout.mounts.find((m) => m.group === 'rocket').weapon, 3);
  assert.ok(!after.loadout.mounts.some((m) => m.weapon === 1), 'no basic kinetic remains');

  // advancing to level-3 returns its briefing and installs the repair drone on the active ship
  const adv2 = await (await post('/api/players/brief-1/advance', {})).json();
  assert.equal(adv2.advanced, true);
  assert.equal(adv2.briefing.textKey, 'level.3.briefing');
  const l3ship = await getJson('/api/players/brief-1/active-ship');
  assert.equal(l3ship.components.repair, 12); // repair drone installed into the 'repair' slot
  assert.equal(l3ship.components.hull, 1);    // existing slots untouched
  assert.equal(l3ship.components.engine, 5);

  // already at the last level → no advance, no briefing
  const adv3 = await (await post('/api/players/brief-1/advance', {})).json();
  assert.equal(adv3.advanced, false);
  assert.equal(adv3.briefing, null);
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
  assert.match(html, /<canvas|<script type="module"|Vega Sentinels/i);
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

test('catalog: components (hulls + engines + thrusters + repair drone) are seeded', async () => {
  const comps = await getJson('/api/components');
  assert.equal(comps.length, 12); // 4 hulls + 3 engines + 4 thrusters + 1 repair drone
  const drone = comps.find((c) => c.name === 'Repair drone');
  assert.equal(drone.id, 12);
  assert.equal(drone.type, 'repair');
  assert.equal(drone.weight, 4);
  assert.deepEqual(drone.stats, { repairPerTick: 1, intervalSec: 3, maxFraction: 0.8 });
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
  assert.equal(weapons.length, 5);
  const types = new Set(weapons.map((w) => w.type));
  assert.deepEqual([...types].sort(), ['bullet', 'rocket']);
  const basic = weapons.find((w) => w.name === 'Basic kinetic');
  assert.equal(basic.type, 'bullet');
  assert.equal(basic.stats.power, 10);
  assert.equal(basic.id, 1);            // stable id, referenced by ship mounts
  assert.equal(basic.stats.maxRange, 88); // bullet range is data-driven now
  // Machine Gun: rapid-fire kinetic (low damage, fast cooldown)
  const mg = weapons.find((w) => w.name === 'Machine Gun');
  assert.equal(mg.id, 5);
  assert.equal(mg.type, 'bullet');
  assert.equal(mg.stats.power, 7);
  assert.equal(mg.stats.fireCooldown, 0.1);
  assert.equal(mg.stats.projectileSpeed, 50);
  assert.equal(mg.stats.maxRange, 100);
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

// ---------- Authentication (DECISIONS §11) ----------

test('username: set a display name on a (still anonymous) player', async () => {
  const r = await post('/api/players/name-1/username', { username: 'Ace' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).username, 'Ace');
  // re-register shows the player row is unchanged otherwise (still anonymous: no email)
  const me = (await (await post('/api/players/register', { playerId: 'name-1' })).json());
  assert.equal(me.id, 'name-1');
});

test('username: empty/too-long -> 400', async () => {
  assert.equal((await post('/api/players/name-2/username', { username: '   ' })).status, 400);
  assert.equal((await post('/api/players/name-2/username', { username: 'x'.repeat(33) })).status, 400);
});

test('register: upgrades an anonymous player in place, preserves progress, sends a verify email, logs in', async () => {
  // build an anonymous player with some progress first
  await post('/api/players/acc-1/advance', {}); // -> level-2
  const before = await (await post('/api/players/register', { playerId: 'acc-1' })).json();
  assert.equal(before.currentProgress, 2);

  const r = await post('/api/auth/register', { playerId: 'acc-1', username: 'Neo', email: 'Neo@Example.com', password: 'hunter2hunter' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.email, 'neo@example.com');   // normalized lower-case
  assert.equal(j.username, 'Neo');
  assert.equal(j.emailVerified, false);
  assert.equal(j.currentProgress, 2);          // progress preserved through the upgrade
  assert.ok(sessionCookie(r), 'a session cookie is set on register');
  // a verification email was "sent" (no-creds dev path records it to the outbox)
  const sent = outbox.at(-1);
  assert.equal(sent.to, 'neo@example.com');
  assert.match(sent.verifyUrl, /\/api\/auth\/verify\?token=/);
});

test('register: duplicate email -> 409', async () => {
  await post('/api/auth/register', { playerId: 'dup-a', email: 'dup@example.com', password: 'password123' });
  const r = await post('/api/auth/register', { playerId: 'dup-b', email: 'dup@example.com', password: 'password123' });
  assert.equal(r.status, 409);
});

test('register: weak password -> 400, bad email -> 400', async () => {
  assert.equal((await post('/api/auth/register', { playerId: 'weak-1', email: 'a@b.com', password: 'short' })).status, 400);
  assert.equal((await post('/api/auth/register', { playerId: 'weak-2', email: 'not-an-email', password: 'password123' })).status, 400);
});

test('login: correct password opens a session; wrong password -> 401', async () => {
  await post('/api/auth/register', { playerId: 'login-1', email: 'login@example.com', password: 'password123' });
  const ok = await post('/api/auth/login', { email: 'login@example.com', password: 'password123' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).id, 'login-1'); // login returns the account's player row
  assert.ok(sessionCookie(ok));

  const bad = await post('/api/auth/login', { email: 'login@example.com', password: 'wrongpass1' });
  assert.equal(bad.status, 401);
  // login is by lower-cased email (case-insensitive)
  assert.equal((await post('/api/auth/login', { email: 'LOGIN@example.com', password: 'password123' })).status, 200);
});

test('me: authed returns the player; no cookie -> 401; after logout -> 401', async () => {
  const reg = await post('/api/auth/register', { playerId: 'me-1', email: 'me@example.com', password: 'password123' });
  const token = sessionCookie(reg);

  const me = await fetch(base + '/api/auth/me', { headers: authHeader(token) });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).id, 'me-1');

  assert.equal((await fetch(base + '/api/auth/me')).status, 401); // no cookie

  const out = await post('/api/auth/logout', {}, authHeader(token));
  assert.equal(out.status, 200);
  assert.equal((await fetch(base + '/api/auth/me', { headers: authHeader(token) })).status, 401); // session gone
});

test('verify: the email link flips email_verified', async () => {
  const reg = await post('/api/auth/register', { playerId: 'verify-1', email: 'verify@example.com', password: 'password123' });
  const token = sessionCookie(reg);
  assert.equal((await (await fetch(base + '/api/auth/me', { headers: authHeader(token) })).json()).emailVerified, false);

  // pull the raw verify token out of the outbox link and hit the verify route
  const url = new URL(outbox.at(-1).verifyUrl);
  const verifyToken = url.searchParams.get('token');
  const v = await fetch(base + `/api/auth/verify?token=${encodeURIComponent(verifyToken)}`, { redirect: 'manual' });
  assert.ok(v.status >= 300 && v.status < 400);
  assert.match(v.headers.get('location'), /verified=1/);

  assert.equal((await (await fetch(base + '/api/auth/me', { headers: authHeader(token) })).json()).emailVerified, true);

  // a bad token redirects with verified=0
  const bad = await fetch(base + '/api/auth/verify?token=nope', { redirect: 'manual' });
  assert.match(bad.headers.get('location'), /verified=0/);
});

test('cross-device: a second client can log in and adopt the same progress', async () => {
  await post('/api/players/sync-1/advance', {}); // sync-1 -> level-2
  await post('/api/auth/register', { playerId: 'sync-1', email: 'sync@example.com', password: 'password123' });
  // a "fresh device" logs in by email and gets the account's player row + progress
  const login = await post('/api/auth/login', { email: 'sync@example.com', password: 'password123' });
  const j = await login.json();
  assert.equal(j.id, 'sync-1');
  assert.equal(j.currentProgress, 2);
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
