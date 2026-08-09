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

  // 2d. THE MODEL GUARD (this is what replaced the bearing-projected sky dome). Every body is a REAL sphere
  //     at a FIXED world position on the ecliptic, so flying can NEVER move one — the old model re-projected
  //     each body by its bearing from the player, and passing one swung that bearing ~180° so it JUMPED.
  //     Fly a long line straight through the origin (the exact path that broke the old model) and assert the
  //     world positions hold, then assert the ship can never reach a body (it flies at y=0, bodies are sunk
  //     below the plane) and that turning does not move them either.
  const flight = await page.evaluate(() => {
    const g = window.__game;
    const at = () => g.systemBodies.map((b) => b.mesh.position.clone());
    g.player.mesh.position.set(-6000, 0, 90); g.settleView();
    const first = at();
    let worstDrift = 0, closestSurface = Infinity;
    for (let x = -6000 + 40; x <= 6000; x += 40) {
      g.player.mesh.position.set(x, 0, 90);
      g.settleView();
      const cur = at();
      for (let i = 0; i < cur.length; i++) {
        worstDrift = Math.max(worstDrift, cur[i].distanceTo(first[i]));
        closestSurface = Math.min(closestSurface,
          cur[i].distanceTo(g.player.mesh.position) - g.systemBodies[i].spec.size);
      }
    }
    // turning the ship: the follow camera holds a fixed orientation and the bodies are world-fixed anyway
    const before = at();
    g.player.heading = 2.4; g.player.mesh.rotation.y = 2.4; g.settleView();
    const after = at();
    let turnShift = 0;
    for (let i = 0; i < before.length; i++) turnShift = Math.max(turnShift, before[i].distanceTo(after[i]));
    return { worstDrift, closestSurface, turnShift };
  });
  assert.ok(flight.worstDrift < 0.5,
    `no body MOVES while flying 12 000u through the system (worst drift ${flight.worstDrift.toFixed(3)}u)`);
  assert.ok(flight.turnShift < 1e-6,
    `turning the ship does not move a body either (max shift ${flight.turnShift})`);
  assert.ok(flight.closestSurface > 100,
    `the ship can never reach a body's surface — it flies above the plane, bodies are sunk below it `
    + `(closest approach ${flight.closestSurface.toFixed(0)}u)`);

  // 2e. YOU HAVE TO FLY THERE. At the base only the home planet is drawn; the star and the outer planets are
  //     thousands of units away and faded out entirely. Autopilot to planet 3's anchor and it becomes the
  //     visible one while the home planet drops out — the whole point of a to-scale system.
  const travel = await page.evaluate(() => {
    const g = window.__game;
    const shown = () => g.systemBodies.filter((b) => b.mesh.visible).map((b) => b.name);
    g.player.mesh.position.set(0, 0, 0); g.settleView();
    const atBase = shown();
    const dest = g.systemAnchor('planet3');
    g.player.mesh.position.set(dest.x, 0, dest.z); g.settleView();  // arrive at planet 3's anchor
    const atPlanet3 = shown();
    const p3 = g.systemBodies.find((b) => b.name === 'planet3');
    g.camera.updateMatrixWorld(true);
    g.camera.matrixWorldInverse.copy(g.camera.matrixWorld).invert();
    const n = p3.mesh.position.clone().project(g.camera);
    return { atBase, atPlanet3, tripLength: Math.hypot(dest.x, dest.z),
             p3InView: Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1 && n.z > -1 && n.z < 1 };
  });
  assert.deepEqual(travel.atBase, ['planet2'],
    `at the base only the home planet is drawn (got ${travel.atBase.join(',') || 'nothing'})`);
  assert.ok(travel.tripLength > 3000,
    `planet 3 is a real crossing away (${travel.tripLength.toFixed(0)}u)`);
  assert.ok(travel.atPlanet3.includes('planet3') && !travel.atPlanet3.includes('planet2'),
    `arriving at planet 3's anchor shows planet 3 and not the home planet (got ${travel.atPlanet3.join(',')})`);
  assert.ok(travel.p3InView, 'and planet 3 projects into the camera frustum from its anchor');
  await shot('roam-at-planet3'); // eyeball frame: planet 3 below/left, framed like the home planet at base

  // 2f. The home planet's moons stay clear of its disk at every point of their orbit.
  const moons = await page.evaluate(() => {
    const g = window.__game;
    g.player.mesh.position.set(0, 0, 0); g.settleView();
    let count = 0, minGap = Infinity;
    for (const body of g.systemBodies) {
      for (const m of body.moons || []) {
        count++;
        for (let i = 0; i < 24; i++) {
          g.settleView(); // wall-clock advances the orbit between samples
          minGap = Math.min(minGap, m.mesh.position.distanceTo(body.mesh.position) - body.spec.size - m.spec.size);
        }
      }
    }
    return { count, minGap };
  });
  assert.ok(moons.count >= 1, `the home planet has moons (got ${moons.count})`);
  assert.ok(moons.minGap > 0, `every moon orbits clear of its planet's disk (closest gap ${moons.minGap.toFixed(1)}u)`);

  // 2g. ZOOM-OUT DIMMING GUARD. THREE.Fog measures VIEW DEPTH, and zoom pushes the camera away from the
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

  // 6. THE IN-ROAM NAVIGATION OVERLAY is the SAME shared component: a full object list, and picking a
  //    destination re-routes the autopilot IN PLACE (no re-entry into roam).
  const overlay = await page.evaluate(() => {
    const g = window.__game;
    g.openSystemMap();
    const rows = [...document.querySelectorAll('#systemmap-overlay .sysnav-row')].map((r) => r.dataset.obj);
    const acts = [...document.querySelectorAll('#systemmap-overlay .sysnav-actions button')].map((b) => b.dataset.act);
    // select a planet in the list, then fly to it
    document.querySelector('#systemmap-overlay .sysnav-row[data-obj="planet3"]').click();
    const selected = document.querySelectorAll('#systemmap-overlay .sysnav-row.sel').length;
    document.querySelector('#systemmap-overlay .sysnav-actions [data-act="__autopilot"]').click();
    return { rows, acts, selected, closed: !g.mapOpen, roam: g.roam,
             active: g.autopilot.active, kind: g.autopilot.target && g.autopilot.target.kind,
             target: g.autopilot.target && g.autopilot.target.pos };
  });
  assert.equal(overlay.rows.length, 10, `the overlay lists every object (got ${overlay.rows.length})`);
  assert.ok(overlay.rows.includes('star') && overlay.rows.includes('planet1') && overlay.rows.includes('mining3'),
    'star, planets and all three mining outposts are selectable objects');
  assert.ok(overlay.acts.includes('return') && overlay.acts.includes('__autopilot'),
    'the overlay carries Return to hangar + Autopilot to destination');
  assert.equal(overlay.selected, 1, 'picking a list row highlights exactly that row');
  assert.equal(overlay.closed, true, 'flying closes the overlay and unfreezes the game');
  assert.equal(overlay.roam, true, 'and it re-routes IN PLACE — still roaming, no re-entry');
  assert.equal(overlay.active, true, 'the autopilot is engaged toward the picked object');
  assert.equal(overlay.kind, 'point', 'as a "point" target (never wins by proximity)');
  const p3 = await page.evaluate(() => window.__game.systemAnchor('planet3'));
  assert.ok(Math.hypot(overlay.target.x - p3.x, overlay.target.z - p3.z) < 1,
    'and it heads for that planet\'s ANCHOR on the plane, not the (unreachable) body');

  // 7. BASE-MENU NAVIGATION: the same component under the Map section, plus "Take off" on EVERY stage.
  const base = await page.evaluate(async () => {
    const g = window.__game;
    g.roam = false;
    g.showMain(null);
    const pick = (w) => document.querySelector(`#mw-menu [data-mw="${w}"]`).click();
    const shown = (id) => { const e = document.getElementById(id); if (!e) return false;
      const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; };
    // Take off is reachable from every stage, not just Missions
    const takeoffOn = {};
    for (const w of ['character', 'missions', 'loadout', 'craft']) { pick(w); takeoffOn[w] = shown('mw-takeoff'); }
    // …and on Map it moves INTO the component's action row, beside "Autopilot to destination"
    pick('map');
    const mapHasGlobalBar = shown('mw-launch');
    const mapActs = [...document.querySelectorAll('#mw-view-map .sysnav-actions button')].map((b) => b.dataset.act);
    const rows = [...document.querySelectorAll('#mw-view-map .sysnav-row')].map((r) => r.dataset.obj);
    // nothing selected yet → autopilot is disabled
    const autoDisabledBefore = document.querySelector('#mw-view-map [data-act="__autopilot"]').disabled;
    document.querySelector('#mw-view-map .sysnav-row[data-obj="mining2"]').click();
    const autoDisabledAfter = document.querySelector('#mw-view-map [data-act="__autopilot"]').disabled;
    const markedRow = document.querySelector('#mw-view-map .sysnav-row.sel').dataset.obj;
    // the mission LAUNCH button is now distinct from Take off
    pick('missions');
    const goText = document.getElementById('mw-go').textContent;
    return { takeoffOn, mapHasGlobalBar, mapActs, rows, autoDisabledBefore, autoDisabledAfter, markedRow, goText };
  });
  for (const [stage, ok] of Object.entries(base.takeoffOn)) {
    assert.ok(ok, `"Take off" is available on the ${stage} stage`);
  }
  assert.equal(base.mapHasGlobalBar, false, 'on Map the global launch bar steps aside…');
  assert.ok(base.mapActs.includes('takeoff') && base.mapActs.includes('__autopilot'),
    '…because Take off sits inside the map\'s action row next to Autopilot to destination');
  assert.equal(base.rows.length, 10, 'the base-menu Map lists the same 10 objects');
  assert.equal(base.autoDisabledBefore, true, 'Autopilot is disabled until something is selected');
  assert.equal(base.autoDisabledAfter, false, 'and enabled once an object is picked');
  assert.equal(base.markedRow, 'mining2', 'the picked row is the highlighted one');
  assert.ok(!/take off/i.test(base.goText),
    `the mission button no longer says "Take off" — it launches the fight (got "${base.goText}")`);
  await shot('base-map');

  // 8. TAKE-OFF GATE: a ship missing a required slot (hull/armor, engine or thrusters) can neither launch a
  //    fight NOR wander off into the system — every launch control greys out together.
  const gate = await page.evaluate(() => {
    const g = window.__game, ship = g.activeShip;
    const was = ship.launchable;
    const read = () => ({ go: document.getElementById('mw-go').disabled,
                          takeoff: document.getElementById('mw-takeoff').disabled });
    ship.launchable = false; g.updateTakeoffGate(ship);
    const blocked = read();
    const note = document.getElementById('mw-takeoff-note').textContent;
    ship.launchable = was === undefined ? true : was; g.updateTakeoffGate(ship);
    return { blocked, open: read(), note };
  });
  assert.equal(gate.blocked.go, true, 'no engine/armor → the mission launch is disabled');
  assert.equal(gate.blocked.takeoff, true, 'no engine/armor → "Take off" is disabled too');
  assert.ok(gate.note.length > 0, `and the player is told why (got "${gate.note}")`);
  assert.equal(gate.open.takeoff, false, 'a launchable ship can take off again');
}
