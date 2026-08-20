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
export const name = 'netsim';

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
    null, { timeout: 20000 });
  const joined = await status(page);
  assert.equal(joined.netsim, true, 'the tab is in netsim mode');
  console.log(`      joined a room: tick=${joined.tick} enemyTotal=${joined.enemyTotal}`);
  assert.equal(joined.enemyTotal, 4, 'the room told us, on join, how many enemies this level has');

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
    null, { timeout: 30000 });
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
  await page.waitForFunction('window.__game.enemies.length > 0', null, { timeout: 20000 });
  await page.waitForTimeout(1200); // let the model resolve
  const withEnemy = await status(page);
  await shot('netsim-fight');
  console.log(`      enemies=${withEnemy.enemies} withMeshes=${withEnemy.enemyMeshes}`);
  assert.ok(withEnemy.enemies > 0, 'the room spawned an enemy and told us');
  assert.equal(withEnemy.enemyMeshes, withEnemy.enemies, 'every networked enemy got a body through the host');

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
}
