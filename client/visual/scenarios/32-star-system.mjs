// Flyable star-system roam sandbox: the speed-field + bearing-projected backdrop bodies exist, autopilot
// flies the real ship toward a picked point, and — the regression this guards — entering roam AFTER a
// mission win does NOT freeze the ship or leak enemies into roam (the two failure modes of a naive
// `!G.roam` reset skip). Pure SIMULATION-STATE assertions (counts + positions), no pixel diffing.
export const name = '32-star-system';

export default async function ({ page, assert, shot }) {
  // The harness already Took off into the playable Level 0. Switch to roam via the real entry point.
  await page.evaluate(async () => { await window.__game.enterRoam(null); });
  await page.waitForFunction(() => window.__game.roam === true, null, { timeout: 5000 });

  // 1. Main's player-locked wrapping speed field is live (THREE.Points layers). We reuse main's field
  //    unchanged; this just confirms the star-system roam build still has it (via __game.speedFieldLayers).
  const field = await page.evaluate(() => {
    const layers = window.__game.speedFieldLayers; // a getter → the live layer array
    let points = 0;
    for (const L of layers) if (L.points && L.points.isPoints) points += L.points.geometry.attributes.position.count;
    return { layers: layers.length, points };
  });
  assert.ok(field.layers >= 2, `speed field has ≥2 THREE.Points layers (got ${field.layers})`);
  assert.ok(field.points >= 100, `speed field has a real point pool (got ${field.points})`);

  // 2. The star + 4 planet backdrop bodies exist (≥5).
  const bodies = await page.evaluate(() => (window.__game.systemBodies || []).map((b) => b.name));
  assert.ok(bodies.length >= 5, `≥5 backdrop bodies exist (got ${bodies.length}: ${bodies.join(',')})`);
  assert.ok(bodies.includes('star') && bodies.includes('planet2'), 'the star + base planet are present');

  // 2b. The backdrop bodies actually PROJECT INTO THE CAMERA FRUSTUM (the F1 fix). The near-top-down camera
  //     looks down, so a body must be placed BELOW it along its bearing; the first pass lifted them by +Y and
  //     they rendered off-screen. The home planet (planet 2 == origin == spawn) must be visible by the base.
  const vis = await page.evaluate(() => {
    const g = window.__game;
    g.stepSim(2); // settleView positions the bodies + camera for the current (roam) frame
    g.camera.updateMatrixWorld(true);
    g.camera.matrixWorldInverse.copy(g.camera.matrixWorld).invert();
    const proj = (name) => {
      const b = (g.systemBodies || []).find((x) => x.name === name);
      if (!b) return null;
      const n = b.mesh.position.clone().project(g.camera);
      return { x: +n.x.toFixed(2), y: +n.y.toFixed(2), z: +n.z.toFixed(2),
               inView: Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1 && n.z > -1 && n.z < 1 };
    };
    const bodies = (g.systemBodies || []).map((b) => b.name);
    let anyInView = 0;
    for (const nm of bodies) { const q = proj(nm); if (q && q.inView) anyInView++; }
    return { home: proj('planet2'), anyInView };
  });
  assert.ok(vis.home && vis.home.inView,
    `the home planet projects into the camera frustum in roam (got ${JSON.stringify(vis.home)})`);
  assert.ok(vis.anyInView >= 1, `≥1 backdrop body is on-screen in roam (got ${vis.anyInView})`);
  await shot('roam-at-base'); // eyeball frame: the home planet should read as a backdrop near the base

  // 2c. The out-of-combat "Map" button is visible and OPENS the system-map overlay (F2). In roam the radar
  //     is hidden and this button takes its place; a live fight keeps the radar and hides the button.
  await page.waitForTimeout(120); // let a real animate frame run refreshMapControl (toggles the corner control)
  const mapUi = await page.evaluate(() => {
    const btn = document.getElementById('map-btn');
    const mini = document.getElementById('minimap');
    const btnShown = btn && getComputedStyle(btn).display !== 'none';
    const miniHidden = mini && getComputedStyle(mini).display === 'none';
    btn.click();
    return { btnShown, miniHidden, open: window.__game.mapOpen };
  });
  assert.ok(mapUi.btnShown, 'the "Map" button is visible while roaming');
  assert.ok(mapUi.miniHidden, 'the battle radar (#minimap) is hidden while roaming');
  assert.equal(mapUi.open, true, 'pressing "Map" opens the system-map overlay (G.mapOpen)');
  await page.evaluate(() => window.__game.closeSystemMap()); // close so the remaining steps run unfrozen

  // 3. No enemies in roam, and the runner is not "won" (so update() ticks the roaming ship).
  const roamState = await page.evaluate(() => ({ enemies: window.__game.enemies.length, won: window.__game.levelRunner.won }));
  assert.equal(roamState.enemies, 0, 'no enemies spawn in roam');
  assert.equal(roamState.won, false, 'the runner is not frozen (won === false) in roam');

  // 4. Autopilot to a point: engage toward a FAR destination and step the sim deterministically (software-GL
  //    rAF is far too slow to advance the live accumulator in a few seconds). Confirm it (a) closes the gap
  //    and (b) travels UNCAPPED — its peak speed exceeds the combat cap (PLAYER_MAX_SPEED = 30), the F3 fix.
  const nav = await page.evaluate(() => {
    const g = window.__game, p = g.player.mesh.position;
    const target = { x: p.x, z: p.z + 12000 }; // far ahead → sustained uncapped cruise
    const dist0 = Math.hypot(target.x - p.x, target.z - p.z);
    g.engagePointAutopilot(target, null);
    const active = g.autopilot.active, kind = g.autopilot.target && g.autopilot.target.kind;
    let maxV = 0;
    for (let i = 0; i < 8; i++) { g.stepSim(60); maxV = Math.max(maxV, g.player.vel.length()); }
    const closed = Math.hypot(target.x - g.player.mesh.position.x, target.z - g.player.mesh.position.z);
    return { active, kind, dist0, closed, maxV };
  });
  assert.equal(nav.active, true, 'point autopilot engaged');
  assert.equal(nav.kind, 'point', 'autopilot target kind is "point"');
  assert.ok(nav.closed < nav.dist0 - 20, `autopilot flew the ship toward the point (dist ${nav.dist0.toFixed(0)} → ${nav.closed.toFixed(0)})`);
  assert.ok(nav.maxV > 35, `autopilot travel is UNCAPPED (peak speed ${nav.maxV.toFixed(1)} > combat cap 30)`);

  await shot('roam');

  // 5. POST-WIN ROAM GUARD (the regression): simulate a mission win + return-to-base state, THEN enter roam
  //    with a destination. The roam reset() must clear `won` (so the ship isn't frozen) and start NO
  //    levelRunner (so no enemies leak in), and the point-autopilot must advance the ship.
  const guard = await page.evaluate(async () => {
    const g = window.__game;
    // stamp a prior mission win + its return-to-base state (what win()/beginReturn set)
    g.levelRunner.won = true; g.levelRunner.returningToBase = true;
    // enter roam toward a point AHEAD (+Z, aligned with the fresh heading so it cruises quickly)
    await g.enterRoam({ pos: { x: 0, z: 300 }, missionId: null });
    const p0 = { x: g.player.mesh.position.x, z: g.player.mesh.position.z };
    g.stepSim(180); // 3 sim-seconds under autopilot
    const p1 = { x: g.player.mesh.position.x, z: g.player.mesh.position.z };
    return {
      won: g.levelRunner.won,
      enemies: g.enemies.length,
      moved: Math.hypot(p1.x - p0.x, p1.z - p0.z),
    };
  });
  assert.equal(guard.won, false, 'entering roam after a win clears levelRunner.won (ship not frozen)');
  assert.equal(guard.enemies, 0, 'no enemies leak into roam after a win');
  assert.ok(guard.moved > 2, `the ship advances under autopilot in post-win roam (moved ${guard.moved.toFixed(1)}u)`);
}
