// Flyable star-system roam sandbox: the speed-field + the FIXED-POSITION backdrop bodies exist, the bodies
// stay put as you fly (no bearing re-projection, no looming), the moons keep clear of their planet, zooming
// out does not fog the ship, autopilot flies the real ship toward a picked point, and — the regression this
// guards — entering roam AFTER a mission win does NOT freeze the ship or leak enemies into roam (the two
// failure modes of a naive `!G.roam` reset skip). Pure SIMULATION/VIEW-STATE assertions, no pixel diffing.
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
  //     looks down, so a body must sit BELOW it; an early pass lifted them by +Y and they rendered off-screen.
  //     The home planet (planet 2) must be visible by the base. NOTE: a body's `mesh.position` is LOCAL to
  //     the sky group (which rides at camera − parallax), so everything here goes through world positions.
  const vis = await page.evaluate(() => {
    const g = window.__game;
    g.stepSim(2); // settleView positions the bodies + camera for the current (roam) frame
    g.camera.updateMatrixWorld(true);
    g.camera.matrixWorldInverse.copy(g.camera.matrixWorld).invert();
    g.skyScene.updateMatrixWorld(true);
    const proj = (name) => {
      const b = (g.systemBodies || []).find((x) => x.name === name);
      if (!b) return null;
      const n = b.mesh.getWorldPosition(b.mesh.position.clone()).project(g.camera);
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

  // 2d. THE MODEL GUARD (this is what replaced the bearing-projected backdrop). Fly the ship along a long
  //     straight line that passes THROUGH the origin — the exact path that made the old backdrop flip ~180°
  //     and jump, because every body was re-projected each frame by its bearing FROM THE PLAYER. With fixed
  //     bodies + a bounded parallax the on-screen motion must be small and SMOOTH at every step, and the
  //     apparent size must never grow (a planet is permanently distant — you can't loom up to it).
  const flight = await page.evaluate(() => {
    const g = window.__game;
    const sample = () => {
      g.camera.updateMatrixWorld(true);
      g.skyScene.updateMatrixWorld(true);
      const out = {};
      for (const b of g.systemBodies) {
        const wp = b.mesh.getWorldPosition(b.mesh.position.clone());
        const dist = wp.distanceTo(g.camera.position);
        const n = wp.project(g.camera);
        out[b.name] = { x: n.x, y: n.y, dist };
      }
      return out;
    };
    const step = 40, from = -6000, to = 6000;   // straight through the origin, well past every anchor
    g.player.mesh.position.set(from, 0, 90); g.settleView(); // land the backdrop on the start point
    let prev = sample();
    const first = prev;
    const worst = { step: 0, name: '' };
    const range = {}; // per-body min/max camera distance over the whole flight
    for (const n of Object.keys(first)) range[n] = { min: first[n].dist, max: first[n].dist };
    for (let x = from + step; x <= to; x += step) {
      g.player.mesh.position.set(x, 0, 90);
      g.settleView();
      const cur = sample();
      for (const name of Object.keys(cur)) {
        const d = Math.hypot(cur[name].x - prev[name].x, cur[name].y - prev[name].y);
        if (d > worst.step) { worst.step = d; worst.name = name; }
        range[name].min = Math.min(range[name].min, cur[name].dist);
        range[name].max = Math.max(range[name].max, cur[name].dist);
      }
      prev = cur;
    }
    // total on-screen travel over the whole 12 000-unit flight — must be real (parallax exists) but bounded
    const totalHome = Math.hypot(prev.planet2.x - first.planet2.x, prev.planet2.y - first.planet2.y);
    let closest = Infinity, widest = 0;
    for (const n of Object.keys(range)) {
      closest = Math.min(closest, range[n].min);
      widest = Math.max(widest, range[n].max - range[n].min);
    }
    return { worstStep: worst.step, worstName: worst.name, totalHome, closest, widest,
             farthest: Math.max(...Object.values(range).map((r) => r.max)), camFar: g.camera.far };
  });
  // a 40-unit flight step may only slide a body a hair on screen; the old bearing model produced ~2 NDC
  // (a full-screen flip) as the ship passed a body.
  assert.ok(flight.worstStep < 0.05,
    `no body JUMPS while flying through the system (worst NDC step ${flight.worstStep.toFixed(4)} by ${flight.worstName})`);
  // …but the backdrop is not welded to the camera either: it must actually slide (that is the parallax).
  assert.ok(flight.totalHome > 0.05,
    `the home planet visibly parallaxes over a 12 000-unit flight (NDC travel ${flight.totalHome.toFixed(3)})`);
  // PERMANENTLY DISTANT: flying 6 000 units at a body may only close the (bounded) parallax slack, never
  // approach it — the closest any body ever gets stays a real backdrop distance away.
  assert.ok(flight.closest > 250,
    `no body is ever loomed up to — closest approach over the whole flight ${flight.closest.toFixed(0)}u`);
  assert.ok(flight.widest < 200,
    `and the distance to a body barely breathes (widest swing ${flight.widest.toFixed(0)}u — gentle parallax, not looming)`);
  assert.ok(flight.farthest < flight.camFar,
    `every body stays inside camera.far at all times (${flight.farthest.toFixed(0)} < ${flight.camFar})`);

  // 2e. Turning the ship must not move the sky at all (the follow camera keeps a fixed orientation), and the
  //     moons must stay clear of their planet's disk at every point of their orbit.
  const turnAndMoons = await page.evaluate(() => {
    const g = window.__game;
    g.player.mesh.position.set(0, 0, 0); g.settleView();
    const at = () => {
      g.skyScene.updateMatrixWorld(true);
      return g.systemBodies.map((b) => b.mesh.getWorldPosition(b.mesh.position.clone()));
    };
    const a = at();
    g.player.heading = 2.4; g.player.mesh.rotation.y = 2.4; g.settleView();
    const b = at();
    let turnShift = 0;
    for (let i = 0; i < a.length; i++) turnShift = Math.max(turnShift, a[i].distanceTo(b[i]));
    // moons: sample the live render positions over a while and take the closest approach to the planet
    let moons = 0, minGap = Infinity;
    for (const body of g.systemBodies) {
      for (const m of body.moons || []) {
        moons++;
        for (let i = 0; i < 24; i++) {
          g.settleView(); // wall-clock advances the orbit between samples
          minGap = Math.min(minGap, m.mesh.position.distanceTo(body.mesh.position) - body.spec.size - m.spec.size);
        }
      }
    }
    return { turnShift, moons, minGap };
  });
  assert.ok(turnAndMoons.turnShift < 1e-6,
    `turning the ship does not move the backdrop (max shift ${turnAndMoons.turnShift})`);
  assert.ok(turnAndMoons.moons >= 1, `the home planet has moons (got ${turnAndMoons.moons})`);
  assert.ok(turnAndMoons.minGap > 0,
    `every moon orbits clear of its planet's disk (closest gap ${turnAndMoons.minGap.toFixed(1)}u)`);

  // 2f. ZOOM-OUT DIMMING GUARD. THREE.Fog measures VIEW DEPTH, and zoom pushes the camera away from the
  //     ship — so a fixed fogNear swallowed the player + the station set-pieces at strong zoom-out. Fog is
  //     now re-anchored to the ship (engine.js applyZoom), so at MAX zoom the ship is still in front of
  //     fogNear, and fogFar stays inside camera.far so nothing pops at the clip plane.
  const zoomFog = await page.evaluate(() => {
    const g = window.__game;
    g.player.mesh.position.set(0, 0, 0);
    const read = () => {
      g.settleView();
      return { camDist: g.camera.position.distanceTo(g.player.mesh.position),
               near: g.scene.fog.near, far: g.scene.fog.far, camFar: g.camera.far };
    };
    g.zoom.set(1); g.zoom.tick(5); const at1 = read();
    g.zoom.set(99); g.zoom.tick(5); const out = read();   // clamped to ZOOM_MAX
    g.zoom.set(1); g.zoom.tick(5);                        // restore for the rest of the run
    return { at1, out };
  });
  assert.ok(zoomFog.at1.near === 240 && zoomFog.at1.far === 600,
    `zoom 1 keeps the original fog planes (got ${zoomFog.at1.near}..${zoomFog.at1.far})`);
  assert.ok(zoomFog.out.camDist > zoomFog.at1.camDist * 2,
    `max zoom really pushes the camera back (${zoomFog.at1.camDist.toFixed(0)} → ${zoomFog.out.camDist.toFixed(0)}u)`);
  assert.ok(zoomFog.out.near > zoomFog.out.camDist + 80,
    `the ship stays IN FRONT of the fog at max zoom-out (camera ${zoomFog.out.camDist.toFixed(0)}u, fogNear ${zoomFog.out.near.toFixed(0)})`);
  assert.ok(zoomFog.out.far <= zoomFog.out.camFar - 20,
    `fog still fades geometry out before the far plane clips it (${zoomFog.out.far.toFixed(0)} <= ${zoomFog.out.camFar - 20})`);

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
