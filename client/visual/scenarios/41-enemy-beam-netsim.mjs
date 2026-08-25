// THE ROOM HALF OF THE GATE, AND THE REASON THE GATE EXISTS (DECISIONS §135).
//
// `40-enemy-beam` proves the telegraph is drawn for a shooter this tab SIMULATES. That is necessary and it
// is not sufficient. In a netsim room the shooter is a remote ghost: its fire group is never ticked here, so
// `g.charge` never advances and there is nothing local to derive a corridor from. Without the wire's shooter
// reference the lines simply never appear, and an enemy beam becomes a 1.0 s unanswerable hit — which is
// exactly the outcome §135 exists to forbid.
//
// So this scenario is the proof that the whole chain works for a fight nobody here is running: the room's
// `beamCharge` crossed the wire carrying a `shipId`, `hydrateEvent` resolved it back to a ghost, and
// `beam-fx.js` drew that ghost's corridor from its interpolated pose.
//
// TWO THINGS IT HAS TO HANDLE, AND BOTH SANK AN EARLIER DRAFT.
//
//   • THE SUPPLY OF TELEGRAPHS IS FINITE. An idle player takes 45 from each lancer every 3.0 s (a 1.0 s
//     charge + a 2.0 s cooldown) against a 100 HP hull + 20 shield — and the instant `!player.alive`,
//     `stepEnemyAI` cuts the engines and holds ALL fire (`sim-core/step-enemies.js`), so charges stop
//     entirely. Only a handful of 1.0 s windows ever exist, and this scenario CANNOT step the simulation:
//     the room owns the clock (`37-netsim.mjs`). Hence: send no input, and start polling before the first
//     charge can happen. (The 2026-08-25 retune from a 0.5 s to a 2.0 s cooldown made this budget LOOSER,
//     not tighter — the idle player now survives about twice as long — but the lancer's 50 deg/s turn also
//     means it takes longer to line up the first shot, so neither the polling nor the timeout was relaxed.)
//
//   • A HIDDEN LINE KEEPS ITS GEOMETRY. `setLine` leaves `position`, `lineDistance` and the material colour
//     intact when a line is later hidden, so a reading taken in a SEPARATE `page.evaluate` after the window
//     closed would pass off a stale buffer with nothing on screen. The reading is therefore captured INSIDE
//     the single polled wait, on the frame the sight is visible.
export const name = '41-enemy-beam-netsim';

const HOSTILE_ORANGE = 0xff6b4a;
const PLAYER_GREEN = 0x5ad17f;
const LANCER_RANGE = 67;
// Generous on purpose, for `37-netsim.mjs`'s reason: this scenario cannot step the sim, and headless
// software WebGL under suite load renders a couple of frames a second.
const SLOW = 60000;

export default async function ({ page, assert, shot, baseURL }) {
  const origin = new URL(baseURL).origin;
  // `?netsim=level-4` puts the fight in a room on Level 4; `&lancer` rides the handshake so the ROOM swaps
  // wave-1's pool (socket.js → createRoom → createSimWorld → withLancersAt); `&level=4` makes this tab build
  // the same level, so the ghosts arrive around the arena centre the player is actually looking at.
  await page.goto(`${origin}/?netsim=level-4&lancer&level=4&debug`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: SLOW });
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-takeoff').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });

  // NETSIM DELIBERATELY STANDS ASIDE IN ROAM (the badge says "local · roam"), and a mid-campaign level
  // carries a briefing, so "Take off" from the Main Window lands in the star system rather than the fight.
  // So this does what a player does: fly into the campaign's armed zone and let its 3 s countdown hand over
  // (`step-player.js checkMissionZone` → `launchCampaign`). Roam IS locally simulated, so it is stepped
  // rather than waited on — only after the handover does the room own the clock.
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const g = window.__game, z = g.missionZone;
    if (z && g.player) { g.player.pos.x = z.center.x; g.player.pos.z = z.center.z; g.player.vel.x = 0; g.player.vel.z = 0; }
  });
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => !!(window.__netsim && window.__netsim.connected))) break;
    await page.evaluate(() => window.__game.stepSim(30));
    await page.waitForTimeout(60);
  }

  await page.waitForFunction('!!(window.__netsim && window.__netsim.connected && window.__netsim.tick > 0)',
    null, { timeout: SLOW });
  const joined = await page.evaluate(() => ({
    roomLevel: window.__netsim.welcome && window.__netsim.welcome.level,
    clientLevel: window.__game.levelName,
  }));
  console.log(`      joined a room: room=${joined.roomLevel} tab=${joined.clientLevel}`);
  assert.equal(joined.roomLevel, 'level-4', 'the room is fighting the level the URL named');

  // SEND NO INPUT AT ALL. Every telegraph this scenario can ever see arrives in the few seconds between the
  // first lancer closing and the idle player dying, so the tab must already be watching.
  await page.waitForFunction('window.__game.enemies.length > 0', null, { timeout: SLOW });
  const ghosts = await page.evaluate(() => window.__game.enemies.map((e) => ({ name: e.name, mesh: !!e.mesh })));
  console.log(`      ghosts: ${JSON.stringify(ghosts)}`);
  assert.ok(ghosts.length > 0, 'the room spawned enemies and told us');
  assert.ok(ghosts.every((gh) => gh.name === 'pirate lancer'),
    `the ROOM is running lancers — the handshake param reached createSimWorld (saw ${JSON.stringify(ghosts.map((x) => x.name))})`);

  // ONE POLLED READ THAT BOTH WAITS AND MEASURES.
  //
  // An explicit 100 ms timer rather than the default `raf` polling, so sampling is independent of a 2 fps
  // render loop while a visible 1.0 s window still spans ~10 samples. The function returns null until a
  // `beamHostileSightCentre` is VISIBLE, and on the frame it is, it returns the whole reading captured then
  // and there. THIS SINGLE WAIT IS THE GATE'S PROOF.
  let captured = null;
  try {
    captured = await page.waitForFunction(() => {
      const g = window.__game;
      const centres = [], edges = [];
      g.scene.traverse((o) => {
        if (o.name === 'beamHostileSightCentre') centres.push(o);
        else if (o.name === 'beamHostileSightEdge') edges.push(o);
      });
      const read = (o) => {
        const a = o.geometry.attributes.position;
        return {
          color: o.material.color.getHex(), opacity: o.material.opacity,
          dashed: !!o.material.isLineDashedMaterial, dashSize: o.material.dashSize,
          ax: a.getX(0), az: a.getZ(0), bx: a.getX(1), bz: a.getZ(1),
        };
      };
      const centre = centres.find((o) => o.visible);
      if (!centre) return null;
      const c = read(centre);
      // TWO LANCERS CAN BE CHARGING AT ONCE (`?lancer` clamps concurrency to 2), and the pool is flat — so
      // the two edges belonging to THIS telegraph are the ones starting at the same muzzle as its centre,
      // not simply the first two visible ones.
      const mine = edges.filter((o) => o.visible).map(read)
        .filter((e) => Math.hypot(e.ax - c.ax, e.az - c.az) < 0.01);
      if (mine.length < 2) return null;

      // The SHOOTER: the ghost whose muzzle these lines start at. Matched by proximity rather than assumed.
      let shooter = null, best = Infinity;
      for (const e of g.enemies) {
        const mx = e.pos.x + Math.sin(e.heading) * ((e.noseZ ?? 1.6) * (e.scale || 1));
        const mz = e.pos.z + Math.cos(e.heading) * ((e.noseZ ?? 1.6) * (e.scale || 1));
        const d = Math.hypot(mx - c.ax, mz - c.az);
        if (d < best) { best = d; shooter = { name: e.name, x: e.pos.x, z: e.pos.z, heading: e.heading,
                                              noseZ: e.noseZ ?? 1.6, scale: e.scale || 1, mx, mz }; }
      }
      return {
        centre: c, edges: mine.slice(0, 2),
        shooter, muzzleErr: best,
        playerAlive: g.player.alive, enemies: g.enemies.length,
      };
    }, null, { polling: 100, timeout: SLOW }).then((h) => h.jsonValue());
  } catch (err) {
    // FAIL LOUDLY ON THE RACE RATHER THAN MYSTERIOUSLY. A bare timeout here reads as "the wire is broken",
    // which is the opposite of what a dead idle player means.
    const why = await page.evaluate(() => ({
      alive: window.__game.player.alive, hp: window.__game.player.hp,
      enemies: window.__game.enemies.length, tick: window.__netsim && window.__netsim.tick,
    })).catch(() => null);
    assert.fail(`no hostile telegraph was captured in the room (${err.message}). State: ${JSON.stringify(why)}. `
      + 'If the player is dead, the room killed the idle player before a telegraph was captured — enemies '
      + 'hold fire once the player is dead (sim-core/step-enemies.js). The cheap lever is a SHORTER run to '
      + 'the first charge, not a longer timeout.');
  }
  await shot('room-hostile-charging'); // nice-to-have: at 2 fps the shutter may open after the window shut

  console.log(`      captured a REMOTE corridor: shooter=${captured.shooter && captured.shooter.name} `
    + `muzzleErr=${captured.muzzleErr.toFixed(2)} playerAlive=${captured.playerAlive}`);

  const lines = [captured.centre, ...captured.edges];
  for (const l of lines) {
    assert.equal(l.color, HOSTILE_ORANGE, 'the remote shooter\'s corridor is the hostile #ff6b4a');
    assert.notEqual(l.color, PLAYER_GREEN, 'and never the player\'s green');
    assert.equal(l.opacity, captured.centre.opacity, 'one opacity across all three');
    assert.ok(l.dashed, 'all three are LineDashedMaterial');
  }
  assert.ok(captured.centre.dashSize > captured.edges[0].dashSize,
    `centre = long strokes, edges = short ticks (${captured.centre.dashSize} vs ${captured.edges[0].dashSize})`);

  // THE GEOMETRY, off the GHOST's interpolated pose — the proof the corridor was derived from a hull this
  // tab never simulated, and not from the event's frozen muzzle position.
  assert.equal(captured.shooter && captured.shooter.name, 'pirate lancer', 'drawn from a lancer ghost');
  assert.ok(captured.muzzleErr < 3,
    `and it starts at that ghost's own muzzle (off by ${captured.muzzleErr.toFixed(2)} u)`);
  for (const [i, l] of lines.entries()) {
    const len = Math.hypot(l.bx - l.ax, l.bz - l.az);
    assert.ok(Math.abs(len - LANCER_RANGE) < 2,
      `line ${i} spans the remote weapon's full ${LANCER_RANGE} u (drawn ${len.toFixed(1)}) — the client read `
      + 'the range off the GHOST\'s own catalog groups, never the player\'s 100');
  }
}
