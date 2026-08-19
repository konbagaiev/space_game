// Flyable star-system roam sandbox: the speed-field + the FIXED-POSITION backdrop bodies exist, the bodies
// stay put as you fly (no bearing re-projection, no looming), the moons keep clear of their planet, zooming
// out does not fog the ship, autopilot flies the real ship toward a picked point, and — the regression this
// guards — entering roam AFTER a mission win does NOT freeze the ship or leak enemies into roam (the two
// failure modes of a naive `!G.roam` reset skip). Pure SIMULATION/VIEW-STATE assertions, no pixel diffing.
export const name = '32-star-system';

export default async function ({ page, assert, shot }) {
  // 0. THE M SHORTCUT IS INERT IN A LIVE FIGHT. The harness has taken off into Level 0, so this runs while a
  //    fight is actually running — the corner is the battle radar and there is no map to open. M must not be
  //    a way to freeze a fight (the overlay stops the sim via G.mapOpen).
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__game.mapOpen), false,
    'M does nothing during a live fight — the map overlay would freeze the sim');

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

  // 2c-bis. BUILD-TIME PLACEMENT (regression). The base menu renders the scene while the sim is NOT ticking
  //     (G.gameStarted false), so the backdrop has to be correct the moment buildMap finishes — it cannot
  //     wait for a settleView. It once did: every body kept its default (0,0,0), which stacked the emissive
  //     star, its additive glow and the ocean planet exactly where the camera looks, washing the whole
  //     hangar backdrop yellow-and-blue. Rebuild the map and assert placement WITHOUT running a frame.
  const built = await page.evaluate(() => {
    const g = window.__game;
    g.rebuildMap();                       // buildMap only — no settleView, no stepSim
    return g.systemBodies.map((b) => ({
      name: b.name,
      atOrigin: b.mesh.position.lengthSq() < 1e-6,
      visible: b.mesh.visible,
      dist: Math.round(b.mesh.position.length()),
    }));
  });
  assert.ok(built.every((b) => !b.atOrigin),
    `buildMap alone places every body — none is left at the world origin (${JSON.stringify(built)})`);
  assert.deepEqual(built.filter((b) => b.visible).map((b) => b.name), ['planet2'],
    `and the fade is applied at build time too, so the hangar shows only the home planet `
    + `(got ${JSON.stringify(built.filter((b) => b.visible).map((b) => b.name))})`);

  // 2d. THE MODEL GUARD (this is what replaced the bearing-projected sky dome). Every body is a REAL sphere
  //     at a FIXED world position on the ecliptic, so flying can NEVER move one — the old model re-projected
  //     each body by its bearing from the player, and passing one swung that bearing ~180° so it JUMPED.
  //     Fly a long line straight through the origin (the exact path that broke the old model) and assert the
  //     world positions hold, then assert the ship can never reach a body (it flies at y=0, bodies are sunk
  //     below the plane) and that turning does not move them either.
  const flight = await page.evaluate(() => {
    const g = window.__game;
    const at = () => g.systemBodies.map((b) => b.mesh.position.clone());
    g.player.pos.set(-6000, 0, 90); g.settleView();
    const first = at();
    let worstDrift = 0, closestSurface = Infinity;
    for (let x = -6000 + 40; x <= 6000; x += 40) {
      g.player.pos.set(x, 0, 90);
      g.settleView();
      const cur = at();
      for (let i = 0; i < cur.length; i++) {
        worstDrift = Math.max(worstDrift, cur[i].distanceTo(first[i]));
        closestSurface = Math.min(closestSurface,
          cur[i].distanceTo(g.player.pos) - g.systemBodies[i].spec.size);
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
  // NOT 1e-6 (which this was until 2026-08-10, and which made the scenario intermittently red). The two
  // samples are taken at different WALL-CLOCK times and the bodies also drift along their orbits between
  // them — the star alone moves ~0.73 u/s — while Date.now() only ticks in whole milliseconds. So the floor
  // here is ~7e-4 u whenever the two reads straddle a millisecond, i.e. the old threshold could only pass by
  // luck. 0.5 u still proves the thing that matters: the bug this guards (a camera-anchored re-projection)
  // swings bodies by HUNDREDS of units when the ship turns, not by fractions of one.
  assert.ok(flight.turnShift < 0.5,
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
    g.player.pos.set(0, 0, 0); g.settleView();
    const atBase = shown();
    const dest = g.systemAnchor('planet3');
    g.player.pos.set(dest.x, 0, dest.z); g.settleView();  // arrive at planet 3's anchor
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
    g.player.pos.set(0, 0, 0); g.settleView();
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
    g.player.pos.set(0, 0, 0);
    const read = () => {
      g.settleView();
      return { camDist: g.camera.position.distanceTo(g.player.pos),
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
    const g = window.__game, p = g.player.pos;
    const target = { x: p.x, z: p.z + 12000 }; // far ahead → sustained uncapped cruise
    const dist0 = Math.hypot(target.x - p.x, target.z - p.z);
    g.engagePointAutopilot(target, null);
    const active = g.autopilot.active, kind = g.autopilot.target && g.autopilot.target.kind;
    let maxV = 0;
    for (let i = 0; i < 8; i++) { g.stepSim(60); maxV = Math.max(maxV, g.player.vel.length()); }
    const closed = Math.hypot(target.x - g.player.pos.x, target.z - g.player.pos.z);
    return { active, kind, dist0, closed, maxV };
  });
  assert.equal(nav.active, true, 'point autopilot engaged');
  assert.equal(nav.kind, 'point', 'autopilot target kind is "point"');
  assert.ok(nav.closed < nav.dist0 - 20, `autopilot flew the ship toward the point (dist ${nav.dist0.toFixed(0)} → ${nav.closed.toFixed(0)})`);
  assert.ok(nav.maxV > 35, `autopilot travel is UNCAPPED (peak speed ${nav.maxV.toFixed(1)} > combat cap 30)`);

  await shot('roam');

  // 4b. THE ROAM NAVIGATION HUD: a gold off-screen pointer toward the active mission + two bottom-center
  //     buttons (Return to Base / Autopilot to Mission). Each button doubles as its OWN cancel (switch/cancel),
  //     and with no active mission the pointer + Autopilot button drop out, leaving just Return to Base.
  const roamHud = await page.evaluate(() => {
    const g = window.__game;
    const shown = (e) => !!e && getComputedStyle(e).display !== 'none';
    const $ = (id) => document.getElementById(id);
    // a known mission target far from the ship, so the pointer is off-screen and the arrow shows
    g.player.pos.set(0, 0, 0); g.settleView();
    g.roamMission = { pos: { x: 4000, z: 0 }, missionId: null };
    g.cancelAutopilot();
    g.updateRoamNav(); g.updateMissionMarker();
    const nav = $('roam-nav'), ret = $('roam-return'), auto = $('roam-autopilot');
    const before = { navShown: shown(nav), retShown: shown(ret), autoShown: shown(auto),
                     markerShown: shown(document.querySelector('#markers .mission-marker')),
                     retText: ret.textContent.trim(), autoText: auto.textContent.trim() };
    // click Autopilot to Mission → a point autopilot toward the target; the button reads engaged
    auto.click(); g.updateRoamNav();
    const engaged = { active: g.autopilot.active, kind: g.autopilot.target && g.autopilot.target.kind,
                      tx: g.autopilot.target && g.autopilot.target.pos.x,
                      autoEngaged: auto.classList.contains('engaged') };
    // click it again → cancels back to manual (switch/cancel)
    auto.click(); g.updateRoamNav();
    const cancelled = { active: g.autopilot.active, autoEngaged: auto.classList.contains('engaged') };
    // Return to Base → the DOCK autopilot; its button reads engaged
    ret.click(); g.updateRoamNav();
    const home = { active: g.autopilot.active, kind: g.autopilot.target && g.autopilot.target.kind,
                   retEngaged: ret.classList.contains('engaged') };
    g.cancelAutopilot();
    // with NO active mission, the pointer + Autopilot button hide; Return to Base stays
    g.roamMission = null; g.updateRoamNav(); g.updateMissionMarker();
    const noMission = { autoShown: shown($('roam-autopilot')), retShown: shown($('roam-return')),
                        markerShown: shown(document.querySelector('#markers .mission-marker')) };
    return { before, engaged, cancelled, home, noMission };
  });
  assert.ok(roamHud.before.navShown, 'the roam nav bar is shown while roaming');
  assert.ok(roamHud.before.retShown && roamHud.before.autoShown,
    'both Return to Base and Autopilot to Mission are shown in roam');
  assert.ok(/base/i.test(roamHud.before.retText) && /mission/i.test(roamHud.before.autoText),
    `the two roam buttons are labelled (got "${roamHud.before.retText}" / "${roamHud.before.autoText}")`);
  assert.ok(roamHud.before.markerShown, 'the gold off-screen mission pointer shows while the mission is off-screen');
  assert.ok(roamHud.engaged.active && roamHud.engaged.kind === 'point',
    'clicking Autopilot to Mission engages a point autopilot');
  assert.ok(Math.abs(roamHud.engaged.tx - 4000) < 1, 'and it heads for the active mission target');
  assert.ok(roamHud.engaged.autoEngaged, 'the engaged mission button is marked .engaged');
  assert.equal(roamHud.cancelled.active, false,
    'clicking Autopilot to Mission again cancels it (each button is its own cancel)');
  assert.ok(!roamHud.cancelled.autoEngaged, 'and the .engaged mark clears on cancel');
  assert.ok(roamHud.home.active && roamHud.home.kind === 'station',
    'Return to Base engages the DOCK autopilot');
  assert.ok(roamHud.home.retEngaged, 'and the Return button reads engaged while flying home');
  assert.ok(!roamHud.noMission.autoShown && !roamHud.noMission.markerShown,
    'with no active mission the Autopilot button + gold pointer hide');
  assert.ok(roamHud.noMission.retShown, 'and Return to Base stays available');

  // 5. POST-WIN ROAM GUARD (the regression): simulate a mission win + return-to-base state, THEN enter roam
  //    with a destination. The roam reset() must clear `won` (so the ship isn't frozen) and start NO
  //    levelRunner (so no enemies leak in), and the point-autopilot must advance the ship.
  const guard = await page.evaluate(async () => {
    const g = window.__game;
    // stamp a prior mission win + its return-to-base state (what win()/beginReturn set)
    g.levelRunner.won = true; g.levelRunner.returningToBase = true;
    // enter roam toward a point AHEAD (+Z, aligned with the fresh heading so it cruises quickly)
    await g.enterRoam({ pos: { x: 0, z: 300 }, missionId: null });
    const p0 = { x: g.player.pos.x, z: g.player.pos.z };
    g.stepSim(180); // 3 sim-seconds under autopilot
    const p1 = { x: g.player.pos.x, z: g.player.pos.z };
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
  assert.equal(overlay.rows.length, 12, `the overlay lists every object (got ${overlay.rows.length})`);
  assert.ok(overlay.rows.includes('star') && overlay.rows.includes('planet1') && overlay.rows.includes('mining3')
    && overlay.rows.includes('factory') && overlay.rows.includes('freighter'),
    'star, planets, all three mining outposts, the space factory and the freighter are selectable objects');
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
    // on the CAMPAIGN there is no mission-launch button at all — Take off is the only launch control
    // (DECISIONS §104); #mw-go comes back only for an active side mission.
    pick('missions');
    const goShown = getComputedStyle(document.getElementById('mw-go')).display !== 'none';
    return { takeoffOn, mapHasGlobalBar, mapActs, rows, autoDisabledBefore, autoDisabledAfter, markedRow, goShown };
  });
  for (const [stage, ok] of Object.entries(base.takeoffOn)) {
    assert.ok(ok, `"Take off" is available on the ${stage} stage`);
  }
  assert.equal(base.mapHasGlobalBar, false, 'on Map the global launch bar steps aside…');
  assert.ok(base.mapActs.includes('takeoff') && base.mapActs.includes('__autopilot'),
    '…because Take off sits inside the map\'s action row next to Autopilot to destination');
  assert.equal(base.rows.length, 12, 'the base-menu Map lists the same 12 objects');
  assert.equal(base.autoDisabledBefore, true, 'Autopilot is disabled until something is selected');
  assert.equal(base.autoDisabledAfter, false, 'and enabled once an object is picked');
  assert.equal(base.markedRow, 'mining2', 'the picked row is the highlighted one');
  assert.equal(base.goShown, false,
    'the campaign carries NO "Launch mission" button — taking off is how you launch it');
  await shot('base-map');

  // 7a. "WHERE IS MY MISSION?" — the object hosting the ACTIVE mission carries a dashed gold frame. The
  //     campaign names a fight CENTRE rather than an object, so the mark is derived from it: the factory
  //     level fights 131 u from the factory anchor, inside the fly-in radius, so the factory is marked.
  const marked = await page.evaluate(async () => {
    const g = window.__game;
    const read = () => [...document.querySelectorAll('#mw-view-map .sysnav-row.mission-active')].map((r) => r.dataset.obj);
    const pick = (w) => document.querySelector(`#mw-menu [data-mw="${w}"]`).click();
    const remount = async () => { pick('missions'); pick('map'); await new Promise((r) => setTimeout(r, 150)); };
    const before = read();                                   // the seeded level fights at the origin → home planet
    g.catalog.level = { ...g.catalog.level, center: { x: -450, z: -435 } }; // …now at the Space Factory
    await remount();
    const atFactory = read();
    g.catalog.level = { ...g.catalog.level, center: null };
    await remount();
    return { before, atFactory, backAtOrigin: read() };
  });
  assert.deepEqual(marked.atFactory, ['factory'],
    'the campaign level fought at the factory marks the FACTORY row (and only it)');
  assert.deepEqual(marked.before, ['planet2'],
    'a level with no centre fights at the origin, so the home planet is what gets marked');
  assert.deepEqual(marked.backAtOrigin, marked.before,
    'and dropping the centre again puts the mark back on that origin landmark');
  await shot('base-map-mission-marked');

  // 7b. CLICK HOME WHILE ROAMING → flown back, UNCAPPED, then offered a dock. Two separate fixes: the
  //     station is a click target during roam (not just after the last kill), and the dock autopilot runs
  //     without the combat speed cap so the trip home is quick. Arriving parks and asks — it must NOT win
  //     anything (there is no mission in roam).
  const home = await page.evaluate(async () => {
    const g = window.__game;
    await g.enterRoam(null);
    // start far out so the cap would be clearly binding on the way home
    g.player.pos.set(1100, 0, -900);
    g.player.vel.set(0, 0, 0);
    const clickable = g.baseStation && g.baseStation.active;
    g.engageAutopilot();                       // exactly what a click on the station does
    const kind = g.autopilot.target && g.autopilot.target.kind;
    let maxV = 0, docked = false, ticks = 0;
    g.onBaseArrival = () => { docked = true; };  // stand in for the "Dock at the station?" prompt
    for (let i = 0; i < 120 && !docked; i++) { g.stepSim(30); ticks += 30; maxV = Math.max(maxV, g.player.vel.length()); }
    const s = g.baseStation.pos, p = g.player.pos;
    return { clickable, kind, maxV, docked, ticks, won: g.levelRunner.won, roam: g.roam,
             dist: Math.hypot(p.x - s.x, p.z - s.z) };
  });
  assert.equal(home.clickable, true, 'the home station is clickable while roaming, not only after a fight');
  assert.equal(home.kind, 'station', 'clicking it engages the DOCK autopilot');
  assert.ok(home.maxV > 35, `the trip home is UNCAPPED (peak ${home.maxV.toFixed(1)} > the combat cap 30)`);
  assert.equal(home.docked, true,
    `the ship reaches the station and the dock prompt is raised (after ${home.ticks} ticks, ${home.dist.toFixed(0)}u out)`);
  assert.ok(home.dist <= 45, `and it actually parks at the station (${home.dist.toFixed(1)}u)`);
  assert.equal(home.won, false, 'arriving in roam wins NOTHING — there is no mission to complete');
  assert.equal(home.roam, true, 'and it stays in roam until the player accepts the dock');

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

  // 9. THE STAR IS A .glb SUN, and only its YELLOW half is drawn. The asset ships two concentric spheres —
  //    an orange emissive core inside a slightly larger yellow transmissive shell — and the shell is
  //    see-through face-on, so leaving the core visible gives an orange disk with a yellow rim. The whole
  //    look therefore rests on two things a refactor can silently break: the model actually loading (a bad
  //    hash → the procedural sphere, no error), and the core staying hidden. Both are asserted on the REAL
  //    scene after flying out to the star, not on the spec.
  const star = await page.evaluate(async () => {
    const g = window.__game;
    const b = g.systemBodies.find((x) => x.isStar);
    g.player.pos.set(b.mesh.position.x + 150, 0, b.mesh.position.z + 110); // park on its anchor
    g.settleView();
    await new Promise((r) => setTimeout(r, 1200));
    g.settleView();
    const drawn = [], hidden = [];
    if (b.starModel) b.starModel.traverse((o) => {
      if (o.isMesh) (o.visible ? drawn : hidden).push({ transmissive: (o.material.transmission ?? 0) > 0 });
    });
    const corona = [];
    b.mesh.traverse((o) => { if (o.isSprite) corona.push(o.scale.x / b.spec.size); });
    return { hasModel: !!b.starModel, visible: b.mesh.visible, drawn, hidden,
             corona: corona.sort((a, c) => a - c), size: b.spec.size, fadeMats: b.mats.length };
  });
  assert.equal(star.hasModel, true, 'the star loaded its .glb (a bad hash would silently leave the sphere)');
  assert.equal(star.visible, true, 'and it is drawn once you have flown to it');
  assert.equal(star.drawn.length, 1, `exactly ONE of the model's spheres is drawn (got ${star.drawn.length})`);
  assert.equal(star.drawn[0].transmissive, true, 'and it is the YELLOW transmissive shell, not the orange core');
  assert.equal(star.hidden.length, 1, 'the orange core is present but hidden (never removed — the fade holds its material)');
  assert.equal(star.corona.length, 2, 'both corona layers exist');
  // the shared glow texture's falloff sits at 0.275 of the sprite WIDTH from centre, so a layer narrower
  // than ~3.6 star-radii falls entirely behind the disk and reads as a rim, not a corona
  assert.ok(star.corona[0] > 3.6,
    `the tight corona clears the disk instead of hiding behind it (${star.corona[0].toFixed(1)} radii wide)`);
  assert.ok(star.corona[1] > star.corona[0], 'and the outer bloom is the wider of the two');
  assert.ok(star.fadeMats >= 3,
    `the model's materials are registered for the distance fade (${star.fadeMats}) — else the sun stays lit in the void`);

  // 10. THE LIGHT COMES FROM THE STAR. The sky light used to sit at an authored fixed position, which put
  //     the terminator 64° off the star's real bearing (and inverted along z), so the home planet's lit limb
  //     faced AWAY from Vega. It is now re-aimed every frame from the star's world position. Asserted at the
  //     BASE and again after flying 15 000 u to another planet — a per-body constant would pass the first
  //     and fail the second.
  const lit = await page.evaluate(() => {
    const g = window.__game;
    const sun = g.skyScene.children.find((o) => o.isDirectionalLight);
    const star = g.systemBodies.find((b) => b.isStar);
    // Measured IMMEDIATELY after settleView, with no await in between: the sim keeps running in roam, so a
    // ship parked here and read a few hundred ms later has flown off and the parallax it adds is real, not a
    // regression. settleView re-runs updateSystemBodies synchronously, which is what aims the light.
    const offAt = (x, z, bodyName) => {
      g.player.pos.set(x, 0, z);
      g.settleView();
      const body = g.systemBodies.find((b) => b.name === bodyName);
      const travels = sun.target.position.clone().sub(sun.position).normalize();      // light's direction
      const fromStar = body.mesh.position.clone().sub(star.mesh.position).normalize(); // star -> that body
      const deg = (Math.acos(Math.max(-1, Math.min(1, travels.dot(fromStar)))) * 180) / Math.PI;
      return { deg: +deg.toFixed(2), shipToBody: Math.round(g.player.pos.distanceTo(body.mesh.position)) };
    };
    const base = offAt(0, 0, 'planet2');
    const p3 = g.systemBodies.find((b) => b.name === 'planet3');
    const away = offAt(p3.mesh.position.x + 150, p3.mesh.position.z + 110, 'planet3'); // park on its anchor
    // The sky lights are recreated on every map build; a leak here is what made this very measurement read
    // a STALE light (whose target never moved) while the live one was aimed correctly — so count them.
    const lights = { dir: g.skyScene.children.filter((o) => o.isDirectionalLight).length,
                     ambient: g.skyScene.children.filter((o) => o.isAmbientLight).length };
    return { base, away, lights };
  });
  // not 0: the light is aimed at the SHIP, and the body it lights hangs ~340 u off that point (SYSTEM.offset
  // + depth) — about 1° of parallax at the star's 15 000–22 000 u range. The bug this guards was 64° off.
  assert.ok(lit.base.shipToBody < 500 && lit.away.shipToBody < 500,
    `the probe actually parked at each body (${lit.base.shipToBody}u / ${lit.away.shipToBody}u)`);
  assert.ok(lit.base.deg < 5,
    `at the base, the sky light arrives from the star (${lit.base.deg}° off the star's true bearing)`);
  assert.ok(lit.away.deg < 5,
    `and still does 22 000u away at planet 3 (${lit.away.deg}° off) — the direction is derived, not fixed`);
  // The scenario has rebuilt the map several times by now (2c-bis, level starts, roam entry). Until
  // 2026-08-10 buildMap created a new ambient + directional light per build and never removed the old ones,
  // so they accumulated: the sky got brighter the longer a session ran, and the stale fixed-direction lights
  // kept lighting the planet from the old authored angle alongside the aimed one.
  assert.equal(lit.lights.dir, 1, `exactly ONE sky directional light survives repeated map builds (got ${lit.lights.dir})`);
  assert.equal(lit.lights.ambient, 1, `and exactly one ambient (got ${lit.lights.ambient})`);

  // 11. THE SPEED FIELD GETS OUT OF THE SUN'S WAY. Its specks are rock-grey and deliberately non-additive,
  //     and it lives in the COMBAT scene, which draws on top of the sky — so over the sun's smooth bright
  //     disk they read as dirt on the lens (measured: ~15 000 speck pixels on the disk alone). It fades out
  //     as you close on the star. Read synchronously right after settleView: updateSpeedField runs inside
  //     it, just after updateSystemBodies computes the dim, so this is always the current frame's value.
  const dust = await page.evaluate(() => {
    const g = window.__game;
    const star = g.systemBodies.find((b) => b.isStar);
    const read = (x, z) => {
      g.player.pos.set(x, 0, z);
      g.settleView();
      return { dist: Math.round(star.mesh.position.distanceTo(g.player.pos)),
               visible: g.speedFieldLayers.filter((L) => L.points.visible).length,
               maxOpacity: Math.max(...g.speedFieldLayers.map((L) => L.points.material.opacity)) };
    };
    return { atStar: read(star.mesh.position.x + 150, star.mesh.position.z + 110), atBase: read(0, 0) };
  });
  assert.equal(dust.atStar.visible, 0,
    `parked at the star (${dust.atStar.dist}u) the speed field is gone — no specks on the disk`);
  assert.ok(dust.atBase.visible >= 2 && dust.atBase.maxOpacity > 0.5,
    `and it is back at full strength at the base (${dust.atBase.visible} layers, max opacity `
    + `${dust.atBase.maxOpacity.toFixed(2)}) — the fade is local to the star, not a global dimming`);

  // 12. THE M SHORTCUT, out of combat this time: it TOGGLES the same overlay the Map button opens. Driven
  //     through real key events, because the interesting failures are all in the wiring, not the logic —
  //     the first cut of this shortcut crashed the whole client on load (a duplicate `Device` import in
  //     welcome.js), which no unit test sees and only loading the page catches.
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.__game.mapOpen), true, 'M opens the system map out of combat');
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.__game.mapOpen), false, 'and M again closes it');
  // Cmd+M is "minimise window" on macOS and Ctrl+M is bound in some browsers — a modifier must pass through.
  for (const mod of ['Meta', 'Control', 'Alt']) {
    await page.keyboard.down(mod); await page.keyboard.press('KeyM'); await page.keyboard.up(mod);
  }
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.__game.mapOpen), false,
    'a modifier + M is NOT the shortcut (Cmd+M must stay "minimise window")');
  // …and neither is typing an "m" into a field (the account screen has email/password inputs).
  const typed = await page.evaluate(async () => {
    const inp = document.createElement('input');
    document.body.appendChild(inp);
    inp.focus();
    inp.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const v = window.__game.mapOpen;
    inp.remove();
    return v;
  });
  assert.equal(typed, false, 'typing "m" into a text field does not open the map');
  // The button that appears exactly when the shortcut works advertises it (mouse devices only).
  assert.equal(await page.evaluate(() => document.getElementById('map-btn').getAttribute('title')), 'Map (M)',
    'the Map button names its shortcut in the tooltip');
}
