// The Space Factory set-piece: fly to its anchor and prove the station is actually THERE, actually
// VISIBLE, and actually below the ships. A navigation destination can pass every unit test and still ship
// broken in the three ways that only show up on a real frame:
//   • the anchor and the seed `pos` drift apart → autopilot parks you in empty space (unit-pinned too, but
//     this is the end-to-end version: the model really is where the map says it is);
//   • the model loads but is normalized so small it reads as a speck, or so large it swallows the frame —
//     `STATION_LEN` is a blind number until someone measures the projected size;
//   • the model pokes THROUGH the flight plane and occludes the ship (the §17 vertical-extent trap).
// Simulation/view-state assertions only — no pixel diffing — plus a frame to eyeball.
export const name = '33-space-factory';

const ANCHOR = { x: -350, z: -350 };                     // ANCHORS.factory — where autopilot parks you
const FACTORY = { x: -420, y: -28, z: -405 };            // the set-piece itself: (-70,-55) off the anchor
const LEVEL2_CENTER = { x: -450, z: -435 };              // campaign "Level 2" fights 30 u up-left of it

export default async function ({ page, assert, shot }) {
  // The harness already Took off into the playable Level 0. Switch to roam via the real entry point.
  await page.evaluate(async () => { await window.__game.enterRoam(null); });
  await page.waitForFunction(() => window.__game.roam === true, null, { timeout: 5000 });
  // The set-piece .glb is an essential asset (it holds the level-load veil), so wait for it to land before
  // measuring anything — otherwise every assertion below just races the fetch.
  await page.waitForFunction(() => window.__game.pendingAssets === 0, null, { timeout: 15000 });

  // 1. The station exists as a real object at the seeded position, with its model attached.
  const built = await page.evaluate((F) => {
    const g = window.__game;
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    const hit = g.setPieces.find((s) =>
      near(s.obj.position.x, F.x) && near(s.obj.position.y, F.y) && near(s.obj.position.z, F.z));
    if (!hit) return { found: false, at: g.setPieces.map((s) => `(${s.obj.position.x},${s.obj.position.z})`) };
    let meshes = 0;
    hit.obj.traverse((o) => { if (o.isMesh) meshes++; });
    return { found: true, meshes };
  }, FACTORY);
  assert.ok(built.found,
    `the space-factory set-piece sits at (${FACTORY.x},${FACTORY.z}); `
    + `the map's set-pieces are at ${(built.at || []).join(' ')}`);
  assert.ok(built.meshes > 0, `the factory .glb loaded and attached meshes (got ${built.meshes})`);

  // 2. Park the ship on the anchor (what autopilot does) and measure the station ON SCREEN. This is the
  //    perception check: `fracH` is the fraction of the viewport HEIGHT its projected bounds cover. Too
  //    small and it reads as a speck you would fly straight past; too large and it swallows the frame.
  const seen = await page.evaluate((F) => {
    const g = window.__game;
    g.player.mesh.position.set(F.a.x, 0, F.a.z); // arrive at the ANCHOR — the point the map flies you to
    g.settleView();
    g.camera.updateMatrixWorld(true);
    g.camera.matrixWorldInverse.copy(g.camera.matrixWorld).invert();
    g.scene.updateMatrixWorld(true);
    // three.js is not exported onto the debug hook; borrow the Vector3 constructor off a live vector.
    const V3 = g.camera.position.constructor;
    const hit = g.setPieces.find((s) =>
      Math.abs(s.obj.position.x - F.x) < 1e-6 && Math.abs(s.obj.position.z - F.z) < 1e-6);
    let top = -Infinity;
    let sxMin = Infinity, sxMax = -Infinity, syMin = Infinity, syMax = -Infinity, projected = 0;
    hit.obj.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const pos = o.geometry.attributes.position;
      // sample the geometry rather than walking every vertex — plenty for bounds, cheap in software WebGL
      const step = Math.max(1, Math.floor(pos.count / 120));
      for (let i = 0; i < pos.count; i += step) {
        const p = o.localToWorld(new V3(pos.getX(i), pos.getY(i), pos.getZ(i)));
        top = Math.max(top, p.y);
        const n = p.project(g.camera); // NDC: -1..1 on each axis
        if (n.z <= -1 || n.z >= 1) continue;
        projected++;
        sxMin = Math.min(sxMin, n.x); sxMax = Math.max(sxMax, n.x);
        syMin = Math.min(syMin, n.y); syMax = Math.max(syMax, n.y);
      }
    });
    return {
      top, projected,
      fracH: projected ? (syMax - syMin) / 2 : 0, // NDC spans 2 units → /2 gives a viewport fraction
      fracW: projected ? (sxMax - sxMin) / 2 : 0,
      onScreen: projected > 0 && sxMax > -1 && sxMin < 1 && syMax > -1 && syMin < 1,
    };
  }, { ...FACTORY, a: ANCHOR });

  assert.ok(seen.onScreen, 'arriving at the factory anchor puts the station in frame, not off-camera');
  assert.ok(seen.fracH > 0.35,
    `the station reads as a facility, not a speck (covers ${(seen.fracH * 100).toFixed(0)}% of the viewport height)`);
  assert.ok(seen.fracH < 1.3,
    `and it does not swallow the frame (covers ${(seen.fracH * 100).toFixed(0)}% of the viewport height)`);
  // §17: the whole station stays BELOW the plane the ships fly on, so it can never occlude one.
  assert.ok(seen.top < 0.6,
    `the station's top stays below the flight plane (top y=${seen.top.toFixed(1)}, ships fly at y≈0.6)`);

  // eyeball frame: the ring station filling the upper-left, the ship clear of it and readable
  await shot('space-factory');

  // 3. A CAMPAIGN level can now name its own combat centre — "Level 2" fights at the factory. Before the
  //    `runCenter` seam, sim.js read only `G.activeMission.center`, which is null for the campaign, so a
  //    level's `center` was accepted by the seed and silently ignored: every campaign run started at (0,0).
  //    Drive it through the real reset() rather than trusting the descriptor.
  await page.evaluate((C) => {
    const g = window.__game;
    g.catalog.level.center = { x: C.x, z: C.z }; // what the seed sets on the factory level's descriptor
    // Out of roam on purpose: this checks the COLD start (a retry, or any level that begins where you
    // already are), which is the one case that still centres the ship on the level's own centre. Taking
    // off leaves you at the base instead — asserted in section 4.
    g.roam = false;
    g.reset();
  }, LEVEL2_CENTER);
  // reset() tears down and REBUILDS every set-piece, so the factory .glb is fetched again — measure only
  // once it has landed, or the frame shows empty space where the station will be.
  await page.waitForFunction(() => window.__game.pendingAssets === 0, null, { timeout: 15000 });
  const campaign = await page.evaluate(() => {
    const g = window.__game;
    g.settleView();
    return {
      arena: { x: g.arenaCenter.x, z: g.arenaCenter.z },
      player: { x: g.player.mesh.position.x, z: g.player.mesh.position.z },
      mission: g.activeMission, // still the campaign — this is NOT the side-mission path
    };
  });
  assert.equal(campaign.mission, null, 'this is the campaign path, not a side mission');
  assert.deepEqual(campaign.arena, LEVEL2_CENTER, 'the combat arena centres on the campaign level\'s own centre');
  // the ship spawns forward-gliding, so it has drifted a few units by the time the frame settles — what
  // matters is that a COLD start puts it HERE and not at the origin, ~620 u away
  const off = Math.hypot(campaign.player.x - LEVEL2_CENTER.x, campaign.player.z - LEVEL2_CENTER.z);
  assert.ok(off < 10,
    `the player spawns at the level's centre, not the origin (${off.toFixed(1)}u off after the spawn glide)`);

  // eyeball frame: the Level 2 spawn — you start beside the factory instead of in empty space at (0,0)
  await shot('level2-spawn-at-factory');

  // 4. ROAM → COMBAT. Flying into the active campaign mission's neighbourhood starts it: a countdown runs,
  //    then the fight begins there. Gated on the campaign being the active choice AND its level naming a
  //    centre, so the factory stays a place you can simply visit on every other level.
  const armed = await page.evaluate(async (C) => {
    const g = window.__game;
    g.catalog.level.center = { x: C.x, z: C.z }; // stand in for the factory level's descriptor
    await g.enterRoam(null);                     // the real entry point — this is what Take off does
    const p = g.player.mesh.position;
    return { zone: g.missionZone && { center: g.missionZone.center, t: g.missionZone.t },
             ship: { x: p.x, z: p.z } };
  }, LEVEL2_CENTER);
  assert.ok(armed.zone, 'entering roam on a level that names a centre arms the mission zone');
  assert.deepEqual(armed.zone.center, LEVEL2_CENTER, 'armed on the level\'s own centre');
  assert.equal(armed.zone.t, null, 'and starts disarmed — nothing counts until you fly in');
  // TAKE OFF IS NOT A TELEPORT. You launch from the home station and fly to the mission yourself (or by
  // autopilot from the map); the level's own centre must NOT drag the spawn out there with it.
  assert.ok(Math.hypot(armed.ship.x, armed.ship.z) < 100,
    `taking off leaves you at the home station, not at the mission (${Math.hypot(armed.ship.x, armed.ship.z).toFixed(0)}u from the base)`);
  const toMission = Math.hypot(armed.ship.x - LEVEL2_CENTER.x, armed.ship.z - LEVEL2_CENTER.z);
  assert.ok(toMission > 500, `and the mission is still a real trip away (${toMission.toFixed(0)}u)`);

  // Park just OUTSIDE the zone: nothing happens, however long you sit there.
  const outside = await page.evaluate((C) => {
    const g = window.__game;
    g.player.mesh.position.set(C.x + 260, 0, C.z); // > MISSION_ZONE_RADIUS away
    g.player.vel.set(0, 0, 0);
    g.stepSim(240); // four seconds — longer than the countdown
    return { t: g.missionZone && g.missionZone.t, roam: g.roam };
  }, LEVEL2_CENTER);
  assert.equal(outside.t, null, 'sitting outside the zone never starts a countdown');
  assert.equal(outside.roam, true, 'and never drops you into combat');

  // Cross IN: the countdown runs, and the HUD actually SAYS so. The banner is written by updateBanner() in
  // the RENDER pass, not by update() — stepSim alone advances the count but never paints it — so let real
  // frames run for a moment and read the DOM the player looks at.
  await page.evaluate((C) => {
    const g = window.__game;
    g.player.mesh.position.set(C.x + 100, 0, C.z);
    g.player.vel.set(0, 0, 0);
    g.stepSim(30); // half a second inside, then hand back to the live loop
  }, LEVEL2_CENTER);
  await new Promise((r) => setTimeout(r, 120)); // a few real frames → updateBanner paints the count
  const counting = await page.evaluate(() => {
    const g = window.__game;
    const b = document.getElementById('banner');
    return { t: g.missionZone && g.missionZone.t, roam: g.roam,
             banner: b.textContent, shown: b.style.display !== 'none', opacity: Number(b.style.opacity || 0) };
  });
  assert.ok(counting.t > 0 && counting.t < 3, `the countdown is running (${counting.t})`);
  assert.equal(counting.roam, true, 'still roaming while it counts');
  assert.ok(counting.shown, 'the countdown banner is displayed');
  assert.match(counting.banner, /\d/, `the HUD shows the count (got "${counting.banner}")`);
  assert.ok(counting.opacity > 0.9,
    `and holds full opacity instead of fading out mid-count (got ${counting.opacity})`);

  // Fly back out mid-count: it cancels rather than dragging you into a fight you left.
  const bailed = await page.evaluate((C) => {
    const g = window.__game;
    g.player.mesh.position.set(C.x + 400, 0, C.z);
    g.stepSim(2);
    return { t: g.missionZone && g.missionZone.t, roam: g.roam };
  }, LEVEL2_CENTER);
  assert.equal(bailed.t, null, 'leaving the zone cancels the countdown');
  assert.equal(bailed.roam, true, 'and you are still roaming, not fighting');

  // Now go in and stay: the countdown runs out and the level actually starts, at its own centre.
  const engaged = await page.evaluate((C) => {
    const g = window.__game;
    // park OFF the exact centre: if the engage re-centred the ship, `moved` would jump by this offset
    g.player.mesh.position.set(C.x + 120, 0, C.z + 60);
    g.player.vel.set(0, 0, 0);
    const setPiecesBefore = g.setPieces.length;
    let before = null, moved = 0, assetsAtEngage = -1, parsedAtEngage = -1, parsedBefore = -1;
    for (let i = 0; i < 260; i++) {
      const wasRoam = g.roam;
      const p0 = g.player.mesh.position.clone();
      g.stepSim(1);
      if (wasRoam) { parsedBefore = g.shipModelsParsed; }
      if (wasRoam && !g.roam) {                       // the engage step
        before = p0; moved = g.player.mesh.position.distanceTo(p0);
        assetsAtEngage = g.pendingAssets;             // >0 ⇒ the handover kicked off .glb fetches
        parsedAtEngage = g.shipModelsParsed;
      }
    }
    const p = g.player.mesh.position;
    return { roam: g.roam, won: g.levelRunner.won, arena: { x: g.arenaCenter.x, z: g.arenaCenter.z },
             engaged: !!before, moved, assetsAtEngage, parsedAtEngage, parsedBefore,
             setPiecesBefore, setPiecesAfter: g.setPieces.length,
             off: Math.hypot(p.x - (C.x + 120), p.z - (C.z + 60)) };
  }, LEVEL2_CENTER);
  assert.equal(engaged.roam, false, 'the countdown ran out and roam ended — the fight is on');
  assert.equal(engaged.won, false, 'the level runner is live, not frozen');
  assert.ok(engaged.engaged, 'the roam→combat handover actually happened during the stepping');
  assert.deepEqual(engaged.arena, LEVEL2_CENTER, 'and the fight is centred at the factory, not the origin');
  // ARRIVING MUST NOT MOVE THE SHIP. The countdown ends where you flew to; enemies come to you. Snapping the
  // ship to the arena centre would undo the trip the player just made — visible as a jump on the frame.
  assert.ok(engaged.moved < 1e-6,
    `the ship is left exactly where it was flying when the fight began (moved ${engaged.moved.toFixed(3)}u)`);
  // NO HITCH ON THE HANDOVER. The world is already standing and the countdown has already warmed the enemy
  // models, so the frame the mission starts must not kick off a single fetch/parse. Both of these were >0
  // before the fix and are what the jerk was made of.
  assert.equal(engaged.assetsAtEngage, 0,
    `the handover starts no .glb loads — the map's set-pieces are kept, not rebuilt (got ${engaged.assetsAtEngage} in flight)`);
  assert.equal(engaged.parsedAtEngage, engaged.parsedBefore,
    `and no enemy model is parsed on that frame — the countdown warmed them (${engaged.parsedBefore} → ${engaged.parsedAtEngage})`);
  assert.equal(engaged.setPiecesAfter, engaged.setPiecesBefore,
    'the set-pieces are the same objects, neither dropped nor duplicated');

  // 5. THE SAME RULE ON A LEVEL WITH NO CENTRE. Its fight is at the origin — the base neighbourhood you
  //    take off into — so taking off must put you INSIDE the zone straight away and the mission must start.
  //    This is the case that shipped broken: the zone was armed only for levels naming their own centre, so
  //    "Take off" on the first playable level dropped the player into free flight with nothing to fly to.
  const atBase = await page.evaluate(async () => {
    const g = window.__game;
    delete g.catalog.level.center;      // an ordinary campaign level
    await g.enterRoam(null);            // ← what the "Take off" button does
    const armed = g.missionZone && { ...g.missionZone.center };
    const start = { x: g.player.mesh.position.x, z: g.player.mesh.position.z };
    g.stepSim(260);                     // past the countdown
    return { armed, start, roam: g.roam, arena: { x: g.arenaCenter.x, z: g.arenaCenter.z } };
  });
  assert.deepEqual(atBase.armed, { x: 0, z: 0 }, 'a level with no centre arms the zone at the origin');
  assert.ok(Math.hypot(atBase.start.x, atBase.start.z) < 200,
    `taking off spawns you inside that zone (${Math.hypot(atBase.start.x, atBase.start.z).toFixed(0)}u out)`);
  assert.equal(atBase.roam, false, 'so the mission starts on take-off instead of leaving you in free flight');
  assert.deepEqual(atBase.arena, { x: 0, z: 0 }, 'and it fights at the origin, by the station');
}
