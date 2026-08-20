// The `?netsim` path, end to end in a real browser: the fight is decided by a server room and this tab
// only sends input and draws the answer.
//
// What makes this worth a scenario rather than a unit test: everything between the socket and the screen is
// browser-only — the host attaching meshes, the event adapter, the HUD. `netsim-world.test.js` already
// proves reconciliation in Node; this proves the wiring in the place it has to work.
//
// It asserts BEHAVIOUR, not pixels: the ship must be driven by the room (it moves without any local sim
// step), enemies the room spawned must appear with real bodies, and the HUD must follow the room's score.
// The last assertion is the important one — that no local simulation is running underneath, which is the
// failure mode where everything looks fine and the two worlds have quietly forked.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'netsim';

// Timeouts here are generous on purpose. Unlike every other scenario this one cannot step the simulation:
// the ROOM advances on a 60 Hz wall clock and the client can only feed it as fast as it renders frames.
// Under full-suite load headless software WebGL drops to a couple of frames a second, so a wait that takes
// two seconds alone can take thirty in the suite — it timed out there while passing every single run on its
// own. Waiting longer is the honest fix; the assertions are all on simulation state, not on elapsed time.
const SLOW = 60000;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// The canonical Level-0 trace, resolved from the seed so an asset rename fails here rather than in prod.
function tracePath() {
  const seedSrc = fs.readFileSync(path.join(repoRoot, 'server/src/catalog_seed.js'), 'utf8');
  const m = seedSrc.match(/introTrace:\s*'([^']+)'/);
  return path.join(repoRoot, 'client', m[1]);
}

const status = (page) => page.evaluate(() => {
  const g = window.__game, p = g.player;
  return {
    netsim: !!(window.__netsim && window.__netsim.active),
    connected: !!(window.__netsim && window.__netsim.connected),
    tick: window.__netsim ? window.__netsim.tick : -1,
    px: p.pos.x, pz: p.pos.z,
    speed: Math.hypot(p.vel.x, p.vel.z),
    enemies: g.enemies.length,
    enemyMeshes: g.enemies.filter((e) => !!e.mesh).length,
    kills: g.kills,
    enemyTotal: window.__netsim && window.__netsim.welcome ? window.__netsim.welcome.enemyTotal : null,
    alive: p.alive,
    uplinkTick: window.__netsim ? window.__netsim.uplinkTick : -1,
    ack: window.__netsim ? window.__netsim.ack : null,
    roomLevel: window.__netsim && window.__netsim.welcome ? window.__netsim.welcome.level : null,
    clientLevel: g.levelName,
    bullets: g.bullets.length,
    bulletLook: g.bullets.slice(0, 1).map((x) => ({ color: x.projectileColor, cls: x.class, mesh: !!x.mesh })),
    rockets: g.rockets.length,
    rocketBodies: g.rockets.filter((r) => !!r.obj).length,
    smoke: g.smoke.length,
  };
});

export default async function ({ page, assert, shot, baseURL }) {
  const origin = new URL(baseURL).origin;
  await page.goto(`${origin}/?netsim=1&seed=4242&debug`, { waitUntil: 'load' });

  // Take off from whichever menu is up, exactly as a player would.
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-takeoff').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });

  // The socket has to connect and the first snapshots have to arrive.
  await page.waitForFunction('!!(window.__netsim && window.__netsim.connected && window.__netsim.tick > 0)',
    null, { timeout: SLOW });
  const joined = await status(page);
  assert.equal(joined.netsim, true, 'the tab is in netsim mode');
  console.log(`      joined a room: tick=${joined.tick} enemyTotal=${joined.enemyTotal} level=${joined.roomLevel}/${joined.clientLevel}`);
  assert.equal(joined.enemyTotal, 4, 'the room told us, on join, how many enemies this level has');
  // THE ROOM AND THIS TAB MUST FIGHT THE SAME LEVEL. The client builds the map, the set-pieces and the
  // arena centre at take-off; a room running a different level puts its enemies around a different centre,
  // in a world the player is not looking at. `?netsim=1` used to hardcode level-0, which did exactly that
  // for any player past the first level, and it reads as "the enemy appeared in the wrong place".
  assert.equal(joined.roomLevel, joined.clientLevel,
    `the room is fighting ${joined.roomLevel} but this tab built ${joined.clientLevel}`);

  // THE BADGE. Three playtests in a row reported "netsim feels great" while actually on the local
  // simulation — the flag is URL-only and nothing on screen said which one was running, so the reports
  // could not be acted on. A room has to be something you can SEE you are in.
  const badge = await page.evaluate(() => {
    const el = document.getElementById('netsim-badge');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const title = document.getElementById('gametitle')?.getBoundingClientRect();
    return { text: el.textContent, colour: getComputedStyle(el).color,
             overlapsTitle: !!title && r.top < title.bottom && r.bottom > title.top && r.left < title.right && r.right > title.left };
  });
  assert.ok(badge, 'the mode badge is on screen whenever ?netsim is on');
  assert.match(badge.text, /^NETSIM ● room/, `it says a room is driving, got "${badge.text}"`);
  assert.equal(badge.overlapsTitle, false, 'and it does not sit on top of the wordmark');

  // Fly. There is NO local sim step in this mode, so any movement at all had to come back over the wire.
  //
  // The wait is on the SIMULATION, never on the clock. Headless software WebGL renders a few frames a
  // second, and the uplink samples input once per rendered frame — so "hold W for 1.5 seconds" delivers a
  // fraction of the input it would on a real display, and a wall-clock assertion here measures the CI box.
  // Waiting for the room's own reported speed to cross a threshold is the same assertion, made properly.
  const before = await status(page);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(
    () => Math.hypot(window.__game.player.vel.x, window.__game.player.vel.z) > 15,
    null, { timeout: SLOW });
  await page.keyboard.up('KeyW');
  const after = await status(page);
  const moved = Math.hypot(after.px - before.px, after.pz - before.pz);
  console.log(`      server-driven flight: moved ${moved.toFixed(1)} u, speed ${after.speed.toFixed(1)} u/s, uplink=${after.uplinkTick} ack=${after.ack}`);
  // Half the 30 u/s cap, from a standing drift of 3 — only sustained thrust gets there, and only the room
  // can apply it, because this tab never calls simTick.
  assert.ok(after.speed > 15, `the room accelerated our ship (${after.speed.toFixed(1)} u/s)`);
  // Distance is deliberately a LOOSE check. The wait above ends the moment the speed crosses the bar, so how
  // far the ship got by then depends on how many frames this machine rendered — and what is drawn trails the
  // room by the interpolation delay on top. The speed assertion is the real one; this only rules out a ship
  // that is somehow at full speed while pinned in place.
  assert.ok(moved > 1, `and it went somewhere (moved ${moved.toFixed(1)} u with no local sim step)`);
  assert.ok(after.ack > before.ack || before.ack == null, 'the room is acknowledging our input');

  // The room spawns the level's enemies; each must arrive with a real body, built from the catalog by name.
  await page.waitForFunction('window.__game.enemies.length > 0', null, { timeout: SLOW });
  await page.waitForTimeout(1200); // let the model resolve
  const withEnemy = await status(page);
  await shot('netsim-fight');
  console.log(`      enemies=${withEnemy.enemies} withMeshes=${withEnemy.enemyMeshes}`);
  assert.ok(withEnemy.enemies > 0, 'the room spawned an enemy and told us');
  assert.equal(withEnemy.enemyMeshes, withEnemy.enemies, 'every networked enemy got a body through the host');

  // --- Weapons. Both paths broke in the first playtest and neither was covered here. ---

  // The gun: a shot must arrive carrying the LOOK of the weapon that fired it. Without `projectileColor`
  // and `class` the host falls through to an untinted dot instead of the weapon's bolt — which is what a
  // netsim fight looked like when the wire carried neither.
  await page.keyboard.down('Space');
  await page.waitForFunction('window.__game.bullets.length > 0', null, { timeout: SLOW });
  const shooting = await status(page);
  await page.keyboard.up('Space');
  console.log(`      bullets=${shooting.bullets} look=${JSON.stringify(shooting.bulletLook[0])}`);
  assert.ok(shooting.bulletLook[0].mesh, 'the bullet got a body');
  assert.ok(Number.isFinite(shooting.bulletLook[0].color), 'and the weapon\'s projectile colour');
  assert.ok(shooting.bulletLook[0].cls, 'and its class, which is what picks the bolt over a plain dot');

  // The rocket: this froze the whole game. Wire events carry `pos` as plain JSON, and the FX layer calls
  // `pos.clone()` on it — a rocket emits a smoke puff about thirty times a second, so the frame threw,
  // the loop died and the last sound played forever. The runner fails on page errors, so simply firing
  // one here is most of the guard; the assertions below are the rest.
  const beforeRocket = await status(page);
  // HELD, not pressed. The uplink samples input once per rendered frame, and headless renders a handful a
  // second — a 10 ms keypress can fall entirely between two samples and never reach the room at all.
  await page.keyboard.down('KeyF');
  await page.waitForFunction('window.__game.smoke.length > 0', null, { timeout: SLOW });
  await page.keyboard.up('KeyF');
  const flying = await status(page);
  console.log(`      rocket: bodies=${flying.rocketBodies}/${flying.rockets} smokePuffs=${flying.smoke}`);
  assert.equal(flying.rocketBodies, flying.rockets, 'every networked rocket has a body');
  assert.ok(flying.smoke > 0, 'its trail is being drawn — the puff path is where the freeze lived');
  assert.ok(flying.tick > beforeRocket.tick, 'and the loop is still running after firing it');

  // Pause must reach the ROOM. A room holds one player, so a real freeze is legitimate — and a button that
  // says "Paused" while the fight keeps running and the ship keeps taking hits is worse than no button.
  await page.evaluate(() => document.getElementById('pause-btn').click());
  await page.waitForTimeout(900);
  const p1 = await status(page);
  await page.waitForTimeout(900);
  const p2 = await status(page);
  console.log(`      paused: ticks ${p1.tick} -> ${p2.tick}`);
  assert.equal(p2.tick, p1.tick, 'the ROOM stopped stepping while paused, not just the drawing');
  await page.evaluate(() => document.getElementById('pause-btn').click());
  await page.waitForFunction((t) => window.__netsim.tick > t, p2.tick, { timeout: SLOW });

  // Nothing is being simulated locally: freeze the uplink and the socket, and the world must go STILL.
  // If a local sim were secretly running, positions would keep changing — the quiet fork this guards.
  const still = await page.evaluate(async () => {
    window.__netsim.pause();                       // stop pumping input and applying snapshots
    const g = window.__game;
    const p0 = { x: g.player.pos.x, z: g.player.pos.z };
    const e0 = g.enemies.map((e) => [e.pos.x, e.pos.z]);
    await new Promise((r) => setTimeout(r, 700));
    const p1 = { x: g.player.pos.x, z: g.player.pos.z };
    const e1 = g.enemies.map((e) => [e.pos.x, e.pos.z]);
    return { playerDrift: Math.hypot(p1.x - p0.x, p1.z - p0.z),
             enemyDrift: e0.length && e1.length === e0.length
               ? Math.max(...e0.map((a, i) => Math.hypot(e1[i][0] - a[0], e1[i][1] - a[1]))) : 0 };
  });
  await page.evaluate(() => window.__netsim.resume()); // …and give the tab back, or every check after this one is measuring a frozen page
  console.log(`      with the room paused: player drifted ${still.playerDrift.toFixed(3)} u, enemies ${still.enemyDrift.toFixed(3)} u`);
  assert.ok(still.playerDrift < 0.01, `no local sim underneath — the ship froze when the room did (drifted ${still.playerDrift})`);
  assert.ok(still.enemyDrift < 0.01, `enemies froze too (drifted ${still.enemyDrift})`);
  // AND IT IS ACTUALLY ON SCREEN. A netsim frame can satisfy every assertion above — right positions, real
  // meshes, a HUD that counts — and still show the player nothing, because "the entity exists at the right
  // coordinates" is not the same claim as "you can see it". So: freeze the room, photograph the middle of
  // the screen (the camera is locked to the player, so that is where the ship is), hide the hull, photograph
  // again, and require the two to differ. Cheap, and it is the only assertion here that a human would make.
  const centre = { x: 560, y: 320, width: 160, height: 160 };
  const withShip = await page.screenshot({ clip: centre });
  await page.evaluate(() => { window.__game.player.mesh.visible = false; });
  await page.waitForTimeout(250);
  const withoutShip = await page.screenshot({ clip: centre });
  await page.evaluate(() => { window.__game.player.mesh.visible = true; });
  assert.ok(Buffer.compare(withShip, withoutShip) !== 0,
    'the player ship is DRAWN at the centre of the screen — hiding it changed no pixels, so nothing was there');

  // --- A ROOM GOING IDLE MUST NOT STOP THE TAB DRAWING ---
  //
  // These were briefly ONE flag, and the game froze the instant you died: the frame after a death is when
  // the explosion plays, the "Ship Destroyed" overlay opens and the run is banked — all of it in
  // `renderTick`, draining the events the room sent. Stopping the render because the ROOM had nothing left
  // to step killed the game at the moment it had the most to say.
  // A HIDDEN TAB is the stable way to make the room idle for a reason that is NOT a pause — poking
  // `player.alive` does not hold, because the next snapshot puts it straight back (which is itself
  // reassuring). The distinction under test is the same one either way.
  const idleStates = await page.evaluate(async () => {
    const n = window.__netsim;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const live = { roomIdle: n.roomIdle, drawing: n.drawing };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    await frame();
    const away = { roomIdle: n.roomIdle, drawing: n.drawing };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    await frame();
    return { live, away, back: { roomIdle: n.roomIdle, drawing: n.drawing } };
  });
  console.log(`      fighting ${JSON.stringify(idleStates.live)} | hidden ${JSON.stringify(idleStates.away)} | back ${JSON.stringify(idleStates.back)}`);
  assert.equal(idleStates.live.roomIdle, false, 'a live, visible fight steps the room');
  assert.equal(idleStates.away.roomIdle, true, 'a hidden tab idles it — the fight must not run unwatched');
  assert.equal(idleStates.away.drawing, true,
    'but the tab keeps DRAWING: gating the render on "is the room stepping" froze the game the instant you died, '
    + 'because the explosion, the overlay and the banking all happen in renderTick');
  assert.equal(idleStates.back.roomIdle, false, 'and coming back resumes it');

  // --- NETSIM MUST STAND ASIDE FOR A REPLAY ---
  //
  // `?record`, `?playback` and the Level-0 intro cutscene (which rides the same machinery, armed at
  // bootstrap without the flag ever appearing in the URL) all replay the LOCAL sim deterministically and
  // own the tick. Running a room alongside one stepped a second fight behind the frozen cutscene card:
  // the text came up, and the game underneath it did not stop. Asserted here with `?playback`, which is
  // the reachable form of the same collision.
  const trace = JSON.parse(fs.readFileSync(tracePath(), 'utf8'));
  await page.evaluate(([id, json]) => localStorage.setItem(`replay:${id}`, json), [trace.id, JSON.stringify(trace)]);
  await page.goto(`${origin}/?playback&id=${encodeURIComponent(trace.id)}&cutscene=1&netsim=1&debug`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__replay && window.__replay.status().armed)', null, { timeout: SLOW });
  await page.waitForTimeout(1500);
  const deferred = await page.evaluate(() => ({
    netsimOn: !!window.__netsim,
    connected: !!(window.__netsim && window.__netsim.connected),
    playbackArmed: window.__replay.status().armed,
  }));
  console.log(`      with ?playback also on: netsim present=${deferred.netsimOn} connected=${deferred.connected}`);
  assert.equal(deferred.netsimOn, true, 'the flag was on, so the handle exists');
  assert.equal(deferred.connected, false,
    'but no room was joined — a replay owns the tick, and a room stepping behind it is a second fight');
  // …and the badge says so rather than leaving the player to guess which simulation they are watching.
  const deferBadge = await page.evaluate(() => document.getElementById('netsim-badge')?.textContent);
  assert.match(deferBadge, /^NETSIM ○ local · replay/, `the badge names the reason, got "${deferBadge}"`);
  await page.evaluate((id) => localStorage.removeItem(`replay:${id}`), trace.id);
}
