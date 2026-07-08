import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Use a throwaway temp database (must be set before importing the server/db).
const dbPath = path.join(os.tmpdir(), `spacegame-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.NODE_ENV = 'test'; // non-Secure cookies so local-http tests can read/replay them
process.env.ADMIN_USER = 'admin';       // enable the /admin dashboard for the suite (Basic Auth)
process.env.ADMIN_PASSWORD = 'secret';

const { createApp } = await import('./server.js');
const { outbox } = await import('./ses.js');
const { setResetToken, consumeResetToken } = await import('./datastore.js');
const { hashToken } = await import('./auth.js');
const { deviceLabel } = await import('./admin.js');
const app = await createApp();
// The same suite runs against either backend (the backend is chosen by DATABASE_URL in datastore.js).
// SQLite uses a throwaway temp file (fresh every run); Postgres is a persistent server, so wipe the
// player-scoped tables up front for a clean slate (the seeded catalog is kept). This is what lets the
// suite catch Postgres-only regressions — e.g. a boolean written to an INTEGER column — that SQLite's
// loose typing silently accepts. See `npm run test:pg` and the Postgres pass in .github/workflows.
if (process.env.DATABASE_URL) {
  const { resetAllPlayers } = await import('./datastore.js');
  await resetAllPlayers();
}
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
const get = (p, headers = {}) => fetch(base + p, { headers });
const adminAuth = { Authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') };

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

test('register: a new player starts at progress 1 (the intro / Level 0 unlocked)', async () => {
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

test('progress: current level is level-1 (the intro), and advancing unlocks the next levels', async () => {
  // a fresh player is on level-1 (the intro / "Level 0")
  const lvl1 = await getJson('/api/players/prog-2/level');
  assert.equal(lvl1.name, 'level-1');
  assert.ok(lvl1.descriptor.phases, 'returns the full descriptor');

  // clearing the intro unlocks level-2, then level-3
  const a1 = await (await post('/api/players/prog-2/advance', {})).json();
  assert.equal(a1.advanced, true);
  assert.equal((await getJson('/api/players/prog-2/level')).name, 'level-2');

  const a2 = await (await post('/api/players/prog-2/advance', {})).json();
  assert.equal(a2.advanced, true);
  assert.equal((await getJson('/api/players/prog-2/level')).name, 'level-3');

  // clearing level-3 advances into level-4, then level-5 (the last)
  const a3 = await (await post('/api/players/prog-2/advance', {})).json();
  assert.equal(a3.advanced, true);
  assert.equal((await getJson('/api/players/prog-2/level')).name, 'level-4');

  const a4 = await (await post('/api/players/prog-2/advance', {})).json();
  assert.equal(a4.advanced, true);
  assert.equal((await getJson('/api/players/prog-2/level')).name, 'level-5');

  // already at the last level (level-5) → no-op
  const a5 = await (await post('/api/players/prog-2/advance', {})).json();
  assert.equal(a5.advanced, false);
  assert.equal((await getJson('/api/players/prog-2/level')).name, 'level-5');

  // progress persists on re-register
  const reg = await (await post('/api/players/register', { playerId: 'prog-2' })).json();
  assert.equal(reg.currentProgress, 5);
});

test('reset: POST /reset wipes progress to the new-player baseline, keeps the account', async () => {
  // build up FULL progress + credits + an unlocked shop, then reset
  await post('/api/players/register', { playerId: 'reset-1' });
  await clearCampaign('reset-1'); // advance to the last level → unlocks the shop (shop_unlocked = 1)
  await post('/api/games', { playerId: 'reset-1', credits: 50, kills: 5, durationMs: 1000 }); // banks credits, games_played++
  assert.equal((await getJson('/api/players/reset-1/level')).name, 'level-5');
  assert.equal((await getJson('/api/players/reset-1/stash')).shopUnlocked, true); // shop is unlocked pre-reset

  const r = await post('/api/players/reset-1/reset', {});
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });

  // back to baseline: level-1, 1000 credits, games_played 0 — but the account row (and id) remain
  assert.equal((await getJson('/api/players/reset-1/level')).name, 'level-1');
  const reg = await (await post('/api/players/register', { playerId: 'reset-1' })).json();
  assert.equal(reg.isNew, false);            // the player row was kept, not recreated
  assert.equal(reg.currentProgress, 1);
  assert.equal(reg.credits, 1000);
  assert.equal(reg.gamesPlayed, 0);
  // shop_unlocked is reset too. This is the assertion that catches the prod bug: on Postgres,
  // resetPlayer wrote `shop_unlocked = false` into an INTEGER column → the UPDATE threw a 500 and
  // nothing reset. SQLite accepts the boolean, so this only fails under the Postgres test pass.
  assert.equal((await getJson('/api/players/reset-1/stash')).shopUnlocked, false);
  // the starter ship is re-granted so the reset account is immediately playable
  const ship = await getJson('/api/players/reset-1/active-ship');
  assert.ok(ship && ship.ship, 'an active ship exists after reset');
});

test('reset: unknown player -> 404', async () => {
  const r = await post('/api/players/nobody-here/reset', {});
  assert.equal(r.status, 404);
});

test('briefing: the intro has none, then the shifted campaign chain swaps the gun for the Machine Gun', async () => {
  // a fresh player starts on the intro (level-1) with the basic kinetic (weapon 1) as the gun
  const before = await getJson('/api/players/brief-1/active-ship');
  const gunBefore = before.loadout.mounts.find((m) => m.group === 'gun');
  assert.equal(gunBefore.weapon, 1); // Basic kinetic

  // 1st advance (intro id 1 → id 2 = old level-1 content): NO briefing yet, gun still the basic kinetic
  const adv1 = await (await post('/api/players/brief-1/advance', {})).json();
  assert.equal(adv1.advanced, true);
  assert.equal(adv1.briefing, null, 'the intro has no briefing');
  assert.equal((await getJson('/api/players/brief-1/active-ship')).loadout.mounts.find((m) => m.group === 'gun').weapon, 1);

  // 2nd advance (id 2 → id 3): the Machine-Gun briefing (message + replaceWeapon action)
  const adv = await (await post('/api/players/brief-1/advance', {})).json();
  assert.equal(adv.advanced, true);
  assert.equal(adv.briefing.textKey, 'level.2.briefing');
  assert.match(adv.briefing.text, /machine gun/i);

  // the active ship's gun is now the Machine Gun (weapon 5); the rocket is untouched
  const after = await getJson('/api/players/brief-1/active-ship');
  assert.equal(after.loadout.mounts.find((m) => m.group === 'gun').weapon, 5);
  assert.equal(after.loadout.mounts.find((m) => m.group === 'rocket').weapon, 3);
  assert.ok(!after.loadout.mounts.some((m) => m.weapon === 1), 'no basic kinetic remains');

  // 3rd advance (id 3 → id 4): the drone briefing installs the repair drone on the active ship
  const adv2 = await (await post('/api/players/brief-1/advance', {})).json();
  assert.equal(adv2.advanced, true);
  assert.equal(adv2.briefing.textKey, 'level.3.briefing');
  const l3ship = await getJson('/api/players/brief-1/active-ship');
  assert.equal(l3ship.components.repair, 12); // repair drone installed into the 'repair' slot
  assert.equal(l3ship.components.hull, 1);    // existing slots untouched
  assert.equal(l3ship.components.engine, 5);

  // 4th advance (id 4 → id 5, the last level): text-only briefing that OPENS THE SHOP (unlockShop action)
  const beforeShop = (await getJson('/api/players/brief-1/active-ship')).shopUnlocked;
  assert.equal(beforeShop, false, 'shop still locked while on id 4');
  const adv3 = await (await post('/api/players/brief-1/advance', {})).json();
  assert.equal(adv3.advanced, true);
  assert.equal(adv3.briefing.textKey, 'level.4.briefing');
  assert.equal((await getJson('/api/players/brief-1/active-ship')).shopUnlocked, true, 'reaching the last level unlocked the shop');

  // 5th advance (already at the last level, id 5) → no advance, no briefing
  const adv4 = await (await post('/api/players/brief-1/advance', {})).json();
  assert.equal(adv4.advanced, false);
  assert.equal(adv4.briefing, null);
});

test('register: missing playerId -> 400', async () => {
  const r = await post('/api/players/register', {});
  assert.equal(r.status, 400);
});

test('perf: POST /api/perf stores a batch of samples; bad payloads -> 400', async () => {
  const { getPerfSamples } = await import('./datastore.js');
  const sessionId = 'sess-perf-1';
  const samples = [
    { t: 1, scene: 'combat', fps: 42.5, frameMs: { p50: 23, p95: 40, max: 60 }, js: { update: 2, dom: 1, render: 1, total: 4 } },
    { t: 2, scene: 'menu', fps: 60, frameMs: { p50: 16, p95: 18, max: 22 }, js: { update: 0.5, dom: 1, render: 1, total: 2.5 } },
  ];
  const ok = await post('/api/perf', { playerId: 'perf-player', sessionId, samples });
  assert.equal(ok.status, 204);

  const rows = await getPerfSamples(sessionId);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].player_id, 'perf-player');
  // sample round-trips as JSON (newest first → the menu sample is row 0)
  assert.equal(rows[0].sample.scene, 'menu');
  assert.equal(rows[1].sample.fps, 42.5);

  assert.equal((await post('/api/perf', { sessionId, samples })).status, 400); // missing playerId
  assert.equal((await post('/api/perf', { playerId: 'x', sessionId, samples: [] })).status, 400); // nothing accepted
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

test('health reports ok, status, uptime, and aggregate counts', async () => {
  const r = await fetch(base + '/api/health');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.status, 'ok');                 // keyword for UptimeRobot to match
  assert.equal(typeof j.uptimeSec, 'number');   // process uptime for the dashboard
  assert.ok(j.players >= 3); // p1, ghost, p2
  assert.ok(j.games >= 5);
});

test('serves the game client at /', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<canvas|<script type="module"|Vega Sentinels/i);
});

test('config: returns sentry:null when no web DSN is configured (no secrets leaked)', async () => {
  const cfg = await getJson('/api/config');
  assert.equal(cfg.sentry, null); // SENTRY_DSN_WEB unset in tests
});

test('events: records an allowlisted event (204), rejects unknown/junk (400), stores data', async () => {
  // allowlisted single event -> 204
  const ok = await post('/api/events', { playerId: 'ev-1', type: 'level_start', data: { level: 'Level 1' } });
  assert.equal(ok.status, 204);
  // unknown type -> 400 (allowlist), missing playerId -> 400, missing type -> 400
  assert.equal((await post('/api/events', { playerId: 'ev-1', type: 'cheat_enabled' })).status, 400);
  assert.equal((await post('/api/events', { type: 'level_start' })).status, 400);
  assert.equal((await post('/api/events', { playerId: 'ev-1' })).status, 400);
  // a batch with a mix records the valid ones -> 204
  const batch = await post('/api/events', { playerId: 'ev-1', events: [
    { type: 'player_death', data: { level: 'Level 1' } },
    { type: 'nope' },              // dropped
    { type: 'victory' },
  ] });
  assert.equal(batch.status, 204);
});

test('catalog: ships are seeded (player + enemies) with stats', async () => {
  const ships = await getJson('/api/ships');
  assert.equal(ships.length, 9);
  const names = ships.map((s) => s.name);
  assert.deepEqual(names.sort(),
    ['Basic player ship', 'Basic pirate ship', 'pirate mini boss', 'basic rocket pirate', 'first pirate boss',
     'pirate gunner', 'advanced medium pirate', 'second pirate boss', 'advanced rocket pirate'].sort());
  const player = ships.find((s) => s.name === 'Basic player ship');
  assert.equal(player.type, 'player');
  assert.equal(player.modelUrl, 'assets/ships/player_combat.f7171045.glb'); // real "Air & Space Vessel" model (textured)
  assert.equal(player.modelUrlHigh, 'https://d1843uwjdjg4vs.cloudfront.net/ships-hangar/player_hangar.7f573bc5.glb');
  assert.deepEqual(player.components, { hull: 1, engine: 5, thruster: 8, grab: 29 }); // assembled from components (base grab included)
  assert.equal(player.stats.model.yaw, 0);   // model-presentation block (yaw/scale)
  assert.equal(player.stats.model.scale, 1.1);
  // auto-fit OBB hitbox survives the JSON-blob round-trip (seedCatalog → fetch) on SQLite + Postgres
  assert.ok(Array.isArray(player.stats.model.hitBoxes) && player.stats.model.hitBoxes.length >= 1, 'hitBoxes round-trips');
  assert.ok(player.stats.model.hitBoxes.every((b) =>
    ['c', 'h', 'u0', 'u1', 'u2'].every((k) => b[k] &&
      ['x', 'y', 'z'].every((c) => typeof b[k][c] === 'number'))), 'hitBox fields are numbers');
  assert.equal(typeof player.stats.model.broadR, 'number'); // enclosing broad-phase radius
  assert.equal(player.stats.mounts[0].weapon, 1);              // mounts reference weapons BY ID
  assert.ok(player.stats.groups.gun, 'player has a gun group');
  const enemies = ships.filter((s) => s.type === 'enemy');
  assert.equal(enemies.length, 8); // fighter, rocketeer, mini-boss, first boss, pirate gunner, advanced medium pirate, second boss, advanced rocket pirate
  // fighter + rocketeer share the same light hull + scout engine + scout thrusters
  const fighter = ships.find((s) => s.name === 'Basic pirate ship');
  const rocketeer = ships.find((s) => s.name === 'basic rocket pirate');
  assert.deepEqual(fighter.components, { hull: 2, engine: 6, thruster: 9 });
  assert.deepEqual(rocketeer.components, fighter.components);
  const mini = ships.find((s) => s.name === 'pirate mini boss');
  assert.equal(mini.stats.role, 'medium');
  assert.deepEqual(mini.components, { hull: 3, engine: 6, thruster: 10 }); // medium hull + scout engine + weak thrusters
  assert.equal(mini.stats.mounts.length, 2);                 // two staggered rocket launchers
  assert.deepEqual(mini.stats.mounts.map((m) => m.delay).sort(), [0, 0.3]);
  const boss = ships.find((s) => s.name === 'first pirate boss');
  assert.equal(boss.stats.role, 'boss');
  assert.deepEqual(boss.components, { hull: 4, engine: 7, thruster: 11 }); // its own hull + engine + thrusters
  assert.equal(boss.stats.mounts.length, 4); // two guns + two rockets
  // score rewards per enemy type
  assert.equal(fighter.stats.reward, 25);
  assert.equal(rocketeer.stats.reward, 50);
  assert.equal(mini.stats.reward, 125);
  assert.equal(boss.stats.reward, 250);
});

test('catalog: components (hulls + engines + thrusters + repair drone) are seeded', async () => {
  const comps = await getJson('/api/components');
  // 4 hulls + 3 engines + 4 thrusters + 1 repair drone (enemy/starter) + 6 player-shop ladder rows
  // (Heavy hull 13, Solid-fuel 15, Ion 16, Repair II 19, Nanobot 20, Advanced thrusters 21)
  // + 2 Grab components (base 29, advanced 30) = 27
  assert.equal(comps.length, 27);
  const drone = comps.find((c) => c.name === 'Repair drone');
  assert.equal(drone.id, 12);
  assert.equal(drone.type, 'repair');
  assert.equal(drone.weight, 4);
  assert.deepEqual(drone.stats, { repairPerTick: 1, intervalSec: 1, maxFraction: 0.8, model: { yaw: 0, scale: 1 } });
  assert.match(drone.modelUrlHigh, /\/ships-hangar\/repair_drone_hangar\./); // item 3D model (menu icon) wired
  const light = comps.find((c) => c.name === 'Light hull');
  assert.equal(light.type, 'hull');
  assert.equal(light.weight, 8);
  assert.equal(light.stats.durability, 30); // fighter + rocketeer durability equalized to 30
  const scout = comps.find((c) => c.name === 'Scout engine');
  assert.equal(scout.type, 'engine');
  assert.equal(scout.stats.power, 19); // acceleration (no turnPower — that's the thruster's job now)
  const scoutThr = comps.find((c) => c.name === 'Scout thrusters');
  assert.equal(scoutThr.type, 'thruster');
  assert.equal(scoutThr.stats.power, 1.6); // maneuverability (turn rate)
  const medium = comps.find((c) => c.name === 'Medium hull');
  assert.equal(medium.weight, 60);         // heavier hull -> sluggish via mass
});

test('levels: intro Level 0 (no boss), then Level 1-4 served in order (content shifted down one id)', async () => {
  // level-1 is now the INTRO ("Level 0"): 3 basic pirates one at a time → 1 rocket-pirate finale, no boss
  const l1 = await getJson('/api/levels/level-1');
  assert.equal(l1.descriptor.map, 'home-system');
  assert.equal(l1.descriptor.title, 'Level 0');
  assert.equal(l1.descriptor.phases[0].advanceWhen.kills, 3);              // gentle: only 3 kills
  assert.equal(l1.descriptor.phases[0].spawn.pool[0].ship, 'Basic pirate ship'); // fighters only
  assert.equal(l1.descriptor.phases[0].spawn.maxConcurrent, 1);           // one at a time
  assert.equal(l1.descriptor.enemyTotal, 4);
  assert.equal(l1.descriptor.phases.at(-1).event, 'win');
  assert.ok(!JSON.stringify(l1.descriptor).includes('first pirate boss'), 'the intro has no boss');

  // level-2 is now old level-1 content ("Level 1"): rocketeer finale, no boss
  const l2 = await getJson('/api/levels/level-2');
  assert.equal(l2.descriptor.title, 'Level 1');
  assert.equal(l2.descriptor.phases.at(-2).spawn.pool[0].ship, 'basic rocket pirate'); // rocketeer finale
  assert.ok(!JSON.stringify(l2.descriptor).includes('pirate mini boss'), 'old level-1 has no boss');

  // level-3 is now old level-2 content ("Level 2"): the medium IS the boss
  const l3 = await getJson('/api/levels/level-3');
  assert.equal(l3.descriptor.title, 'Level 2');
  assert.equal(l3.descriptor.phases.at(-2).spawn.pool[0].ship, 'pirate mini boss');

  // level-4 is now old level-3 content ("Level 3"): the Sector boss
  const l4 = await getJson('/api/levels/level-4');
  assert.equal(l4.descriptor.title, 'Level 3');
  assert.equal(l4.descriptor.phases.at(-2).spawn.pool[0].ship, 'first pirate boss');

  // level-5 is now old level-4 content ("Level 4", "Find the pirate base"): advanced-medium-pirate waves
  // (8/16 kills), the Second Boss finale, and an unlockShop briefing (docs/plans/level-4-difficulty.md)
  const l5 = await getJson('/api/levels/level-5');
  assert.equal(l5.descriptor.title, 'Level 4');
  assert.equal(l5.descriptor.briefing.textKey, 'level.4.briefing');
  assert.ok(l5.descriptor.briefing.actions.some((a) => a.type === 'unlockShop'), 'the last level opens the shop');
  assert.ok(l5.descriptor.phases[0].spawn.pool.some((p) => p.ship === 'pirate gunner'), 'wave-1 has pirate gunners');
  assert.ok(l5.descriptor.phases[0].spawn.pool.some((p) => p.ship === 'advanced medium pirate'), 'waves use the advanced medium pirate');
  assert.equal(l5.descriptor.phases[0].advanceWhen.kills, 8);
  assert.equal(l5.descriptor.phases.at(-2).spawn.pool[0].ship, 'second pirate boss'); // the Second Boss finale
  assert.equal(l5.descriptor.phases.at(-1).textKey, 'level.4.victory');

  assert.equal((await fetch(base + '/api/levels/nope')).status, 404);
});

test('catalog: weapons are seeded with type bullet/rocket', async () => {
  const weapons = await getJson('/api/weapons');
  // 5 base (ids 1–5) + 3 player-shop ladder weapons (Heavy cannon 6, Heavy Machine Gun 7, Heavy rocket 8)
  // + 2 enemy weapons (ids 9–10) + Triple spiral rocket (11)
  assert.equal(weapons.length, 11);
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
  assert.equal(rocket.stats.power, 60);
  assert.equal(rocket.stats.health, 10);  // HP, reduced by a bullet's damage
  assert.equal(rocket.stats.maxRange, 150);
});

test('catalog: components + weapons carry a rarity tier + matching hex color', async () => {
  const RARITY_COLOR = { trash: '#ffffff', common: '#59e0a0', rare: '#0000ff' };
  const comps = await getJson('/api/components');
  const weapons = await getJson('/api/weapons');
  // every row has a valid rarity and a color that matches its tier
  for (const row of [...comps, ...weapons]) {
    assert.ok(['trash', 'common', 'rare'].includes(row.rarity), `${row.name}: rarity ${row.rarity}`);
    assert.equal(row.color, RARITY_COLOR[row.rarity], `${row.name}: color for ${row.rarity}`);
  }
  const byId = (arr, id) => arr.find((r) => r.id === id);
  // spot cases (derived rule: shop-available → common; enemy/price-0 → trash; explicit override → rare)
  assert.deepEqual({ rarity: byId(weapons, 5).rarity, color: byId(weapons, 5).color }, { rarity: 'common', color: '#59e0a0' }); // Machine Gun
  assert.deepEqual({ rarity: byId(weapons, 11).rarity, color: byId(weapons, 11).color }, { rarity: 'rare', color: '#0000ff' }); // Triple spiral rocket (override)
  assert.deepEqual({ rarity: byId(weapons, 9).rarity, color: byId(weapons, 9).color }, { rarity: 'trash', color: '#ffffff' }); // Pirate machine gun (buyable:false)
  assert.deepEqual({ rarity: byId(comps, 12).rarity, color: byId(comps, 12).color }, { rarity: 'common', color: '#59e0a0' }); // Repair drone
  assert.deepEqual({ rarity: byId(comps, 22).rarity, color: byId(comps, 22).color }, { rarity: 'trash', color: '#ffffff' }); // Pirate hull (buyable:false)
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

// --- Cross-origin (itch.io) bearer-token auth + CORS (docs/plans/2026-07-01-1824-itch-html5-export.md) ---

test('auth: register returns a bearer token that /api/auth/me accepts (cross-origin path)', async () => {
  const j = await (await post('/api/auth/register',
    { playerId: 'bearer-1', email: 'bearer1@example.com', password: 'password123' })).json();
  assert.ok(j.token, 'register response carries a session token');
  const me = await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${j.token}` } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).id, 'bearer-1');
});

test('auth: login returns a bearer token; a bogus bearer is rejected', async () => {
  await post('/api/auth/register', { playerId: 'bearer-2', email: 'bearer2@example.com', password: 'password123' });
  const j = await (await post('/api/auth/login', { email: 'bearer2@example.com', password: 'password123' })).json();
  assert.ok(j.token);
  assert.equal((await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${j.token}` } })).status, 200);
  assert.equal((await fetch(base + '/api/auth/me', { headers: { Authorization: 'Bearer nope' } })).status, 401);
});

test('auth: logout via Authorization header drops the session', async () => {
  const j = await (await post('/api/auth/register', { playerId: 'bearer-3', email: 'bearer3@example.com', password: 'password123' })).json();
  const h = { Authorization: `Bearer ${j.token}` };
  assert.equal((await fetch(base + '/api/auth/me', { headers: h })).status, 200);
  await post('/api/auth/logout', {}, h);
  assert.equal((await fetch(base + '/api/auth/me', { headers: h })).status, 401);
});

test('cors: /api reflects the Origin, allows Authorization, and never allows credentials', async () => {
  const pre = await fetch(base + '/api/ships', {
    method: 'OPTIONS',
    headers: { Origin: 'https://itch.zone', 'Access-Control-Request-Headers': 'authorization' },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://itch.zone');
  assert.match(pre.headers.get('access-control-allow-headers') || '', /authorization/i);
  assert.equal(pre.headers.get('access-control-allow-credentials'), null); // credentials OFF by design
  const get = await fetch(base + '/api/ships', { headers: { Origin: 'https://itch.zone' } });
  assert.equal(get.headers.get('access-control-allow-origin'), 'https://itch.zone');
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

// Pull the raw reset token out of the last /?reset=… link recorded in the outbox.
function lastResetToken() {
  return new URL(outbox.at(-1).resetUrl).searchParams.get('reset');
}

test('password reset: happy path rotates the password, auto-logs-in, and verifies the email', async () => {
  await post('/api/auth/register', { playerId: 'pr-1', email: 'pr1@example.com', password: 'password123' });
  const forgot = await post('/api/auth/forgot-password', { email: 'pr1@example.com' });
  assert.equal(forgot.status, 200);
  assert.deepEqual(await forgot.json(), { ok: true });
  assert.match(outbox.at(-1).resetUrl, /\/\?reset=/);

  const token = lastResetToken();
  const reset = await post('/api/auth/reset-password', { token, password: 'newpassword1' });
  assert.equal(reset.status, 200);
  assert.ok(sessionCookie(reset));                 // logged in on this device
  const body = await reset.json();
  assert.equal(body.id, 'pr-1');                   // adopts the account's player row
  assert.equal(body.emailVerified, true);          // clicking the link proved ownership

  // the new password works, the old one no longer does
  assert.equal((await post('/api/auth/login', { email: 'pr1@example.com', password: 'newpassword1' })).status, 200);
  assert.equal((await post('/api/auth/login', { email: 'pr1@example.com', password: 'password123' })).status, 401);
});

test('password reset: invalidates all of the player\'s prior sessions', async () => {
  const reg = await post('/api/auth/register', { playerId: 'pr-sess', email: 'prsess@example.com', password: 'password123' });
  const oldToken = sessionCookie(reg);
  assert.equal((await fetch(base + '/api/auth/me', { headers: authHeader(oldToken) })).status, 200);

  await post('/api/auth/forgot-password', { email: 'prsess@example.com' });
  const reset = await post('/api/auth/reset-password', { token: lastResetToken(), password: 'newpassword1' });
  const newToken = sessionCookie(reset);

  assert.equal((await fetch(base + '/api/auth/me', { headers: authHeader(oldToken) })).status, 401); // old session dropped
  assert.equal((await fetch(base + '/api/auth/me', { headers: authHeader(newToken) })).status, 200); // fresh session works
});

test('password reset: forgot-password is enumeration-safe (200, no email sent for unknown account)', async () => {
  const before = outbox.length;
  const r = await post('/api/auth/forgot-password', { email: 'nobody-here@example.com' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(outbox.length, before); // nothing emailed for a non-existent account
});

test('password reset: invalid token -> 400, and a consumed token cannot be replayed', async () => {
  assert.equal((await post('/api/auth/reset-password', { token: 'nope', password: 'whatever12' })).status, 400);

  await post('/api/auth/register', { playerId: 'pr-replay', email: 'prreplay@example.com', password: 'password123' });
  await post('/api/auth/forgot-password', { email: 'prreplay@example.com' });
  const token = lastResetToken();
  assert.equal((await post('/api/auth/reset-password', { token, password: 'newpassword1' })).status, 200);
  assert.equal((await post('/api/auth/reset-password', { token, password: 'newpassword2' })).status, 400); // single-use
});

test('password reset: weak new password -> 400', async () => {
  await post('/api/auth/register', { playerId: 'pr-weak', email: 'prweak@example.com', password: 'password123' });
  await post('/api/auth/forgot-password', { email: 'prweak@example.com' });
  const token = lastResetToken();
  assert.equal((await post('/api/auth/reset-password', { token, password: 'short' })).status, 400);
});

test('password reset: an expired token is rejected at the datastore level (1 h TTL)', async () => {
  await post('/api/auth/register', { playerId: 'pr-exp', email: 'prexp@example.com', password: 'password123' });
  const target = await setResetToken('prexp@example.com', hashToken('rawtok'), Date.now() - 2 * 60 * 60 * 1000);
  assert.ok(target); // stored (sent_at 2 h ago)
  assert.equal(await consumeResetToken(hashToken('rawtok'), 'h', 's'), null); // older than the 1 h TTL
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
  assert.equal(active.ship.modelUrl, 'assets/ships/player_combat.f7171045.glb');
  // empty loadout/components fall back to the ship's defaults
  assert.equal(active.loadout.mounts.length, 2);
  assert.equal(active.loadout.mounts.find((m) => m.group === 'gun').weapon, 1);    // Basic kinetic
  assert.equal(active.loadout.mounts.find((m) => m.group === 'rocket').weapon, 3); // Rocket (homing)
  assert.deepEqual(active.components, { hull: 1, engine: 5, thruster: 8, grab: 29 }); // starter loadout incl. the base grab
});

// ---------- Hangar shop + stash (docs/plans/hangar-shop.md) ----------
// Clear the campaign (advance off the last level) so the shop unlocks for `playerId`.
async function clearCampaign(playerId) {
  for (let i = 0; i < 4; i++) await post(`/api/players/${playerId}/advance`, {});
}

test('shop: locked until the final level is cleared', async () => {
  await getJson('/api/players/shop-lock/active-ship'); // register
  const s = await getJson('/api/players/shop-lock/stash');
  assert.equal(s.shopUnlocked, false);
  assert.deepEqual(s.stash, []);
  // mutations are 403 while locked
  assert.equal((await post('/api/players/shop-lock/buy', { kind: 'weapon', refId: 1 })).status, 403);
  assert.equal((await post('/api/players/shop-lock/equip', { kind: 'weapon', refId: 1 })).status, 403);
});

test('missions: locked until the campaign is cleared, then 3 same-difficulty side missions are offered', async () => {
  await getJson('/api/players/miss-lock/active-ship'); // register
  assert.equal((await fetch(base + '/api/players/miss-lock/missions')).status, 403); // locked until cleared

  await clearCampaign('miss-1');
  const r = await getJson('/api/players/miss-1/missions');
  assert.equal(r.missions.length, 3);
  assert.deepEqual(r.missions.map((m) => m.type).sort(), ['freighter', 'mining', 'research']);
  for (const m of r.missions) {
    assert.ok(m.estReward > 0, 'has an est. reward');
    assert.ok(m.descriptor.sideMission, 'flagged sideMission → banks credits but does not advance the story');
    assert.equal(m.descriptor.map, 'home-system');
    const ph = m.descriptor.phases;
    assert.equal(ph.length, 5);
    assert.ok(ph[0].spawn.pool.some((p) => p.ship === 'pirate gunner'), 'wave 1 includes the pirate gunner');
    const bosses = ph.find((p) => p.name === 'bosses');
    assert.equal(bosses.spawn.total, 2);                 // 2-boss finale
    assert.equal(bosses.spawn.pool[0].ship, 'first pirate boss');
    assert.equal(ph[ph.length - 1].event, 'win');
  }
});

test('catalog: pirate gunner + Pirate machine gun (id 9) are seeded; the boss guns use the MG', async () => {
  const weapons = await getJson('/api/weapons');
  const mg = weapons.find((w) => w.id === 9);
  assert.ok(mg && mg.name === 'Pirate machine gun', 'Pirate machine gun seeded as weapon 9');
  assert.equal(mg.stats.maxRange, 90);
  const ships = await getJson('/api/ships');
  const gunner = ships.find((s) => s.stats.role === 'pirate_gunner');
  assert.ok(gunner, 'pirate gunner ship seeded');
  assert.equal(gunner.components.hull, 22);            // Pirate hull
  assert.equal(gunner.stats.mounts[0].weapon, 9);      // mounts the Pirate MG
  const boss = ships.find((s) => s.stats.role === 'boss');
  const bossGuns = boss.stats.mounts.filter((m) => m.group === 'gun');
  assert.ok(bossGuns.length === 2 && bossGuns.every((m) => m.weapon === 9), 'boss guns swapped to the Pirate MG');
});

test('catalog: marker colors follow the size-tier palette (small=orange, medium=red, boss=maroon)', async () => {
  const ships = await getJson('/api/ships');
  const colorOf = (name) => ships.find((s) => s.name === name).stats.color;
  // small → orange (enemy_1 fighters/gunners + enemy_2 rocketeers)
  for (const n of ['Basic pirate ship', 'pirate gunner', 'basic rocket pirate', 'advanced rocket pirate']) {
    assert.equal(colorOf(n), 0xf4741f, `${n} = small/orange marker`);
  }
  // medium → red (enemy_3)
  for (const n of ['pirate mini boss', 'advanced medium pirate']) assert.equal(colorOf(n), 0xe53935, `${n} = medium/red marker`);
  // boss → maroon (enemy_4)
  for (const n of ['first pirate boss', 'second pirate boss']) assert.equal(colorOf(n), 0x800020, `${n} = boss/maroon marker`);
});

test('catalog: orphaned enemy ships are pruned on re-seed (rename/removal cleanup)', async () => {
  const { backend, migrate } = await import('./datastore.js');
  const STALE = 'zzz stale enemy (test)';
  // insert an enemy row not present in the seed, the same way an old rename left one behind
  if (backend === 'sqlite') {
    const { db } = await import('./db.js');
    db.prepare("INSERT INTO ships (name, type, stats, components) VALUES (?, 'enemy', '{}', '{}') ON CONFLICT(name) DO NOTHING").run(STALE);
  } else {
    const { pool } = await import('./db_postgres.js');
    await pool.query("INSERT INTO ships (name, type, stats, components) VALUES ($1, 'enemy', '{}'::jsonb, '{}'::jsonb) ON CONFLICT (name) DO NOTHING", [STALE]);
  }
  assert.ok((await getJson('/api/ships')).some((s) => s.name === STALE), 'stale enemy inserted');
  await migrate(); // re-run the seed → prune
  assert.ok(!(await getJson('/api/ships')).some((s) => s.name === STALE), 'stale enemy pruned on re-seed');
});

test('catalog: level-4 enemies — advanced medium pirate (300 HP) + Second Boss (550 HP) + Advanced pirate cannon', async () => {
  const weapons = await getJson('/api/weapons');
  const cannon = weapons.find((w) => w.id === 10);
  assert.ok(cannon && cannon.name === 'Advanced pirate cannon', 'Advanced pirate cannon seeded as weapon 10');
  assert.equal(cannon.stats.maxRange, 110);
  const comps = await getJson('/api/components');
  assert.equal(comps.find((c) => c.id === 24).stats.durability, 300); // advanced medium pirate hull
  assert.equal(comps.find((c) => c.id === 28).stats.durability, 550); // second-boss hull (boss buff: 450 → 550)
  const ships = await getJson('/api/ships');
  const amp = ships.find((s) => s.stats.role === 'advanced_medium_pirate');
  assert.ok(amp, 'advanced medium pirate seeded');
  assert.equal(amp.components.hull, 24);
  assert.equal(amp.stats.reward, 200);
  assert.deepEqual(amp.stats.mounts.map((m) => m.weapon).sort((a, b) => a - b), [4, 4, 9]); // 1 MG + 2 rockets
  const sb = ships.find((s) => s.stats.role === 'boss2');
  assert.ok(sb, 'second boss seeded');
  assert.equal(sb.name, 'second pirate boss');
  assert.equal(sb.components.hull, 28);
  assert.deepEqual(sb.stats.mounts.map((m) => m.weapon).sort((a, b) => a - b), [4, 4, 4, 10, 10]); // 3 rockets + 2 cannons
});

test('shop: unlocks on clearing the campaign and backfills the basic gun into the stash', async () => {
  await clearCampaign('shop-1');
  const s = await getJson('/api/players/shop-1/stash');
  assert.equal(s.shopUnlocked, true);
  // the basic kinetic (id 1), swapped out after level 2, is now owned in the stash
  const gun = s.stash.find((it) => it.kind === 'weapon' && it.refId === 1);
  assert.ok(gun, 'basic gun present in stash');
  assert.equal(gun.qty, 1);
  assert.equal(gun.name, 'Basic kinetic');
  assert.equal(gun.price, 800); // priced (economy-shop-v2.md) — sells ~600 toward the Heavy hull
  // active ship is launchable (all required slots filled), with the Machine Gun equipped
  assert.equal(s.activeShip.launchable, true);
  assert.deepEqual(s.activeShip.missingRequired, []);
  assert.equal(s.activeShip.loadout.mounts.find((m) => m.group === 'gun').weapon, 5);
});

test('shop: equip from stash swaps the displaced item back into the stash', async () => {
  await clearCampaign('shop-equip');
  // equip the basic gun (1) → it replaces the Machine Gun (5) in the gun group; the MG returns to stash
  const r = await (await post('/api/players/shop-equip/equip', { kind: 'weapon', refId: 1 })).json();
  assert.equal(r.activeShip.loadout.mounts.find((m) => m.group === 'gun').weapon, 1);
  assert.ok(!r.stash.some((it) => it.refId === 1), 'basic gun left the stash');
  assert.ok(r.stash.some((it) => it.kind === 'weapon' && it.refId === 5), 'Machine Gun is now in the stash');
});

test('shop: buy adds to the stash; sell removes it; credits move by the item price', async () => {
  await clearCampaign('shop-trade');
  const start = (await getJson('/api/players/shop-trade/stash')).credits;
  // buy a Light hull (component 2) — now priced 150 (enemy gear priced for resale; buyable:false only
  // hides it from the CLIENT shop list, the server still allows a direct buy)
  const bought = await (await post('/api/players/shop-trade/buy', { kind: 'component', refId: 2 })).json();
  assert.equal(bought.credits, start - 150); // price 150 deducted
  assert.ok(bought.stash.some((it) => it.kind === 'component' && it.refId === 2));
  // sell it back — credit floor(150 * 0.75) = 112
  const sold = await (await post('/api/players/shop-trade/sell', { kind: 'component', refId: 2 })).json();
  assert.equal(sold.credits, start - 150 + 112);
  assert.ok(!sold.stash.some((it) => it.kind === 'component' && it.refId === 2), 'sold item left the stash');
});

// ---------- Grab (tractor) component + victory loot deposit (grab-tractor-drops) ----------
test('catalog: Grab components (29/30) seeded; enemy parts priced with buyable:false', async () => {
  const comps = await getJson('/api/components');
  const grab = comps.find((c) => c.id === 29);
  assert.ok(grab && grab.name === 'Grab' && grab.type === 'grab', 'base Grab seeded as component 29');
  assert.equal(grab.stats.strength, 10);
  assert.equal(grab.price, 500);
  const adv = comps.find((c) => c.id === 30);
  assert.ok(adv && adv.type === 'grab' && adv.stats.strength === 20 && adv.price === 2000, 'Advanced grab seeded');
  // enemy parts now carry a resale price + a buyable:false flag (hidden from the shop, sellable when looted)
  const scoutEngine = comps.find((c) => c.id === 6);
  assert.equal(scoutEngine.price, 250);
  assert.equal(scoutEngine.stats.buyable, false);
  const weapons = await getJson('/api/weapons');
  const pirateMg = weapons.find((w) => w.id === 9);
  assert.equal(pirateMg.price, 300);
  assert.equal(pirateMg.stats.buyable, false);
  // the player ship starts with the base grab equipped
  const ships = await getJson('/api/ships');
  assert.equal(ships.find((s) => s.type === 'player').components.grab, 29);
});

test('loot: POST /loot deposits collected drops into the stash (victory-only deposit path)', async () => {
  await getJson('/api/players/loot-1/active-ship'); // register (no shop unlock needed — loot isn't gated)
  const r = await post('/api/players/loot-1/loot', { items: [
    { kind: 'component', refId: 6 }, { kind: 'weapon', refId: 9 }, { kind: 'component', refId: 6 },
  ] });
  assert.equal(r.status, 200);
  const stash = (await getJson('/api/players/loot-1/stash')).stash;
  const eng = stash.find((it) => it.kind === 'component' && it.refId === 6);
  const gun = stash.find((it) => it.kind === 'weapon' && it.refId === 9);
  assert.ok(eng && eng.qty === 2, 'the two Scout engines stacked to qty 2');
  assert.ok(gun && gun.qty === 1, 'the Pirate MG is in the stash');
});

test('loot: an empty / absent item list is a no-op 200', async () => {
  await getJson('/api/players/loot-empty/active-ship');
  assert.equal((await post('/api/players/loot-empty/loot', { items: [] })).status, 200);
  assert.equal((await post('/api/players/loot-empty/loot', {})).status, 200);
  assert.deepEqual((await getJson('/api/players/loot-empty/stash')).stash, []);
});

test('grab: a looted grab equips into its optional slot and round-trips through the stash', async () => {
  await clearCampaign('grab-1'); // unlock the shop so equip/unequip mutations are allowed
  // put an Advanced grab (30) in the stash, then equip it (optional 'grab' slot; not required)
  await post('/api/players/grab-1/loot', { items: [{ kind: 'component', refId: 30 }] });
  const equipped = await (await post('/api/players/grab-1/equip', { kind: 'component', refId: 30 })).json();
  assert.equal(equipped.activeShip.components.grab, 30, 'advanced grab equipped');
  // the displaced base grab (29) returned to the stash
  assert.ok(equipped.stash.some((it) => it.kind === 'component' && it.refId === 29), 'base grab returned to stash');
  // sell the equipped grab directly (optional slot → sellable while equipped)
  const sold = await (await post('/api/players/grab-1/sell', { slot: 'grab' })).json();
  assert.equal(sold.activeShip.components.grab, undefined, 'grab slot emptied after selling');
  // flying with no grab is allowed (grab is NOT a required slot)
  assert.equal(sold.activeShip.launchable, true);
  // re-equip the base grab from the stash, then unequip it back
  await post('/api/players/grab-1/equip', { kind: 'component', refId: 29 });
  const unequipped = await (await post('/api/players/grab-1/unequip', { slot: 'grab' })).json();
  assert.equal(unequipped.activeShip.components.grab, undefined, 'grab unequipped back to the stash');
  assert.ok(unequipped.stash.some((it) => it.kind === 'component' && it.refId === 29), 'base grab in the stash');
});

test('shop: selling a stash item you do not own -> 409', async () => {
  await clearCampaign('shop-409');
  const r = await post('/api/players/shop-409/sell', { kind: 'component', refId: 3 });
  assert.equal(r.status, 409);
});

test('shop: optional equipped items sell directly; required ones cannot', async () => {
  await clearCampaign('shop-sell-eq');
  // selling the equipped rocket (optional, group 'rocket') directly from the hangar works
  const sold = await post('/api/players/shop-sell-eq/sell', { slot: 'rocket' });
  assert.equal(sold.status, 200);
  const after = await sold.json();
  assert.ok(!after.activeShip.loadout.mounts.some((m) => m.group === 'rocket'), 'rocket unmounted');
  // a required slot (hull) cannot be sold while equipped
  assert.equal((await post('/api/players/shop-sell-eq/sell', { slot: 'hull' })).status, 409);
});

test('shop: unequipping a required slot blocks take-off (launchable=false)', async () => {
  await clearCampaign('shop-launch');
  const r = await (await post('/api/players/shop-launch/unequip', { slot: 'engine' })).json();
  assert.equal(r.activeShip.launchable, false);
  assert.ok(r.activeShip.missingRequired.includes('engine'));
  // the engine is now sitting in the stash
  assert.ok(r.stash.some((it) => it.kind === 'component' && it.refId === 5));
  // re-equipping it restores launchability
  const back = await (await post('/api/players/shop-launch/equip', { kind: 'component', refId: 5 })).json();
  assert.equal(back.activeShip.launchable, true);
});

test('shop: no double-spend / dupe under repeated sell of a single stash item', async () => {
  await clearCampaign('shop-dupe');
  // own exactly one basic gun (the backfill). Two sells: the first succeeds, the second 409s (qty 0).
  assert.equal((await post('/api/players/shop-dupe/sell', { kind: 'weapon', refId: 1 })).status, 200);
  assert.equal((await post('/api/players/shop-dupe/sell', { kind: 'weapon', refId: 1 })).status, 409);
});

test('shop: equipping a duplicate of the equipped item never loses an item (net-zero)', async () => {
  await clearCampaign('shop-dup-equip');
  // install the basic gun (1) → the Machine Gun (5) is displaced to the stash; the basic gun leaves it
  await post('/api/players/shop-dup-equip/equip', { kind: 'weapon', refId: 1 });
  // own one basic gun again (stash) while an identical basic gun is equipped → two id-1 guns total
  await post('/api/players/shop-dup-equip/buy', { kind: 'weapon', refId: 1 });
  // re-equip the same id: the equipped one returns to the stash as the stash one installs (net-zero)
  const r = await (await post('/api/players/shop-dup-equip/equip', { kind: 'weapon', refId: 1 })).json();
  const stashGun = r.stash.find((it) => it.kind === 'weapon' && it.refId === 1);
  const equipped = r.activeShip.loadout.mounts.filter((m) => m.weapon === 1).length;
  // still exactly one equipped + one in the stash — nothing lost, nothing duplicated
  assert.equal(equipped, 1);
  assert.equal(stashGun ? stashGun.qty : 0, 1, 'no item lost or duplicated on same-id equip');
});

test('shop: real catalog prices — buy deducts, sell refunds 75%, overspend -> 402', async () => {
  await clearCampaign('shop-price');
  const start = (await getJson('/api/players/shop-price/stash')).credits; // fresh player: 1000
  assert.equal(start, 1000);
  // Basic kinetic (weapon 1) costs 800 — affordable from 1000
  const bought = await (await post('/api/players/shop-price/buy', { kind: 'weapon', refId: 1 })).json();
  assert.equal(bought.credits, 200);
  // a second basic kinetic is now owned (the backfill + this purchase), priced 800
  const owned = bought.stash.find((it) => it.kind === 'weapon' && it.refId === 1);
  assert.equal(owned.qty, 2);
  assert.equal(owned.price, 800);
  // sell one back for floor(800 * 0.75) = 600
  const sold = await (await post('/api/players/shop-price/sell', { kind: 'weapon', refId: 1 })).json();
  assert.equal(sold.credits, 800);
  // Heavy hull (component 13) costs 6000 — can't afford from 800 → 402, nothing spent
  const broke = await post('/api/players/shop-price/buy', { kind: 'component', refId: 13 });
  assert.equal(broke.status, 402);
  assert.equal((await getJson('/api/players/shop-price/stash')).credits, 800);
});

test('catalog: the player shop ladder is seeded with prices (components + weapons)', async () => {
  const components = await getJson('/api/components');
  const heavyHull = components.find((c) => c.id === 13);
  assert.equal(heavyHull.name, 'Heavy hull');
  assert.equal(heavyHull.stats.durability, 200);
  assert.equal(heavyHull.weight, 50);
  assert.equal(heavyHull.price, 6000);
  assert.equal(components.find((c) => c.id === 19).price, 1800);  // Repair drone II
  // starter gear is cheap-but-buyable (no longer free/hidden)
  assert.equal(components.find((c) => c.id === 1).price, 300);   // Basic hull
  assert.equal(components.find((c) => c.id === 8).price, 400);   // Basic thrusters
  assert.equal(components.find((c) => c.id === 21).price, 2500); // Advanced thrusters (new shop entry)
  const weapons = await getJson('/api/weapons');
  assert.equal(weapons.find((w) => w.id === 8).name, 'Heavy rocket'); // homing heavy rocket
  assert.equal(weapons.find((w) => w.id === 8).price, 2600);
  assert.equal(weapons.find((w) => w.id === 1).price, 800);          // Basic kinetic now priced
  assert.equal(weapons.find((w) => w.id === 5).price, 1500);        // Machine Gun — strong, so not cheap
});

// ---------- Admin panel + referrer capture (docs/plans/2026-07-02-1352-admin-panel-player-stats.md) ----------

test('referrer: written write-once on the first register, never overwritten', async () => {
  await post('/api/players/register', { playerId: 'ref1', referrer: '{"ref":"twitter"}' });
  await post('/api/players/register', { playerId: 'ref1', referrer: '{"ref":"facebook"}' }); // must NOT overwrite
  const html = await (await get('/admin', adminAuth)).text();
  assert.ok(html.includes('twitter'), 'keeps the first referrer');
  assert.ok(!html.includes('facebook'), 'never overwrites with a later referrer');
});

test('referrer: auto-register (active-ship) creates the player with no referrer', async () => {
  await getJson('/api/players/notaref/active-ship'); // auto-registers, no referrer
  const html = await (await get('/admin', adminAuth)).text();
  // the row exists (id shown, truncated to 8 chars) but carries no referrer text
  assert.ok(html.includes('notaref'), 'the auto-registered player shows up');
});

// ---------- Admin "device" column (docs/plans/2026-07-06-2154-admin-device-column.md) ----------

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

test('deviceLabel: parse ladder (browser · model → OS → raw UA → blank), never throws', () => {
  // Android Chrome + a known device code → marketing name
  assert.equal(deviceLabel(ANDROID_UA, 'SM-A037F'), 'Chrome · Galaxy A03s');
  // Android Chrome + an unknown code → raw-code fallback
  assert.equal(deviceLabel(ANDROID_UA, 'SM-ZZZZ'), 'Chrome · SM-ZZZZ');
  // Android Chrome + no model hint → OS from the UA
  assert.equal(deviceLabel(ANDROID_UA, null), 'Chrome · Android 10');
  // Desktop Chrome/Windows (no model)
  assert.equal(deviceLabel(DESKTOP_UA, null), 'Chrome · Windows');
  // iPhone Safari with an OS version
  assert.equal(deviceLabel(IPHONE_UA, null), 'Safari · iOS 17.4');
  // Empty/junk → never throws, returns a string
  assert.equal(deviceLabel('', null), '');
  assert.equal(deviceLabel('!!!garbage!!!', null), '!!!garbage!!!');
});

test('device: captured at boot register + rendered; latest-wins overwrites the UA', async () => {
  // 1) first boot: Android + model hint (quoted, as browsers send it) → best-case label
  await post('/api/players/register', { playerId: 'devx' }, { 'user-agent': ANDROID_UA, 'sec-ch-ua-model': '"SM-A037F"' });
  let html = await (await get('/admin', adminAuth)).text();
  assert.ok(html.includes('Chrome · Galaxy A03s'), 'renders the best-case browser · model label');
  // 2) latest-wins: same player boots on desktop (no model hint) → user_agent overwritten while
  // device_model is preserved by COALESCE. Prove the UA was overwritten via the cell title= (which
  // carries the raw UA). The label still reads the preserved model — that's the documented behavior.
  await post('/api/players/register', { playerId: 'devx' }, { 'user-agent': DESKTOP_UA });
  html = await (await get('/admin', adminAuth)).text();
  assert.ok(html.includes(DESKTOP_UA), 'user_agent overwritten latest-wins (raw UA in the cell title)');
});

test('device: anonymous auto-register (no device headers) → empty device cell, no crash', async () => {
  await getJson('/api/players/notdev/active-ship'); // auto-registers with no device info
  const r = await get('/admin', adminAuth);
  assert.equal(r.status, 200, 'admin renders fine with a null-UA player');
  const html = await r.text();
  const row = html.split('<tr>').find((rr) => rr.includes('notdev'));
  assert.ok(row, 'the auto-registered player shows up');
  assert.ok(row.includes('class="device" title=""'), 'its device cell is empty (null UA)');
});

test('admin: aggregates sum kills/time/earned across a player\'s games', async () => {
  await post('/api/players/register', { playerId: 'p_stats' });
  await post('/api/games', { playerId: 'p_stats', credits: 100, kills: 3, durationMs: 60000 });
  await post('/api/games', { playerId: 'p_stats', credits: 50, kills: 2, durationMs: 120000 });
  const html = await (await get('/admin', adminAuth)).text();
  const row = html.split('<tr>').find((r) => r.includes('p_stats'));
  assert.ok(row, 'the player row is rendered');
  assert.ok(row.includes('data-sort="5"'), 'total kills summed to 5');       // 3 + 2
  assert.ok(row.includes('data-sort="150"'), 'total earned summed to 150');   // 100 + 50
  assert.ok(row.includes('data-sort="180000"'), 'total time played summed to 180000ms');
  assert.ok(row.includes('0h 3m'), 'total time formatted (180000ms = 3 min)');
  assert.ok(row.includes('data-sort="2"'), 'games_played counter = 2');
});

test('admin: requires auth (401 + WWW-Authenticate when no credentials)', async () => {
  const r = await get('/admin');
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate') || '', /Basic/);
});

test('admin: rejects bad credentials (401)', async () => {
  const r = await get('/admin', { Authorization: 'Basic ' + Buffer.from('admin:wrong').toString('base64') });
  assert.equal(r.status, 401);
});

test('admin: accepts good credentials (200 + table)', async () => {
  const r = await get('/admin', adminAuth);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('<table'), 'renders the players table');
});
