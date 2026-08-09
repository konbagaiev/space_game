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

  // 3. No enemies in roam, and the runner is not "won" (so update() ticks the roaming ship).
  const roamState = await page.evaluate(() => ({ enemies: window.__game.enemies.length, won: window.__game.levelRunner.won }));
  assert.equal(roamState.enemies, 0, 'no enemies spawn in roam');
  assert.equal(roamState.won, false, 'the runner is not frozen (won === false) in roam');

  // 4. Autopilot to a point: engage toward a destination and step the sim deterministically (software-GL
  //    rAF is far too slow to advance the live accumulator in a few seconds), confirming it closes the gap.
  const nav = await page.evaluate(() => {
    const g = window.__game, p = g.player.mesh.position;
    const target = { x: p.x, z: p.z + 300 }; // 300u ahead
    const dist0 = Math.hypot(target.x - p.x, target.z - p.z);
    g.engagePointAutopilot(target, null);
    const active = g.autopilot.active, kind = g.autopilot.target && g.autopilot.target.kind;
    g.stepSim(360); // 6 sim-seconds of brake → rotate → cruise → brake
    const closed = Math.hypot(target.x - g.player.mesh.position.x, target.z - g.player.mesh.position.z);
    return { active, kind, dist0, closed };
  });
  assert.equal(nav.active, true, 'point autopilot engaged');
  assert.equal(nav.kind, 'point', 'autopilot target kind is "point"');
  assert.ok(nav.closed < nav.dist0 - 20, `autopilot flew the ship toward the point (dist ${nav.dist0.toFixed(0)} → ${nav.closed.toFixed(0)})`);

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
