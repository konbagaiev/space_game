// Freighter set-piece exhaust → the shared shader plume (exhaust-fx.js), and the GLOBAL (a)/(b) look
// toggle. Launch the freighter mission (its set-piece cruises at the arena center), wait for the plume,
// assert it exists in the default 'points' look, then flip the GLOBAL mode to 'flame' and assert the flame
// mesh becomes visible on BOTH the freighter plume AND a thrusting ship plume (the toggle is global).
export const name = '24-freighter-exhaust';

export default async function ({ page, assert, shot }) {
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  // clear the campaign so side missions are offered, then land on the Hangar with the mission board
  await page.evaluate(async (pid) => {
    for (let i = 0; i < 4; i++) await fetch(`/api/players/${pid}/advance`, { method: 'POST' });
  }, pid);
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForFunction('window.__game.missionOffers.length === 3', null, { timeout: 6000 });

  // launch the freighter escort mission → its freighter set-piece + plume are built at the arena center
  await page.evaluate(() => {
    const g = window.__game;
    g.launchMission(g.missionOffers.find((o) => o.type === 'freighter'));
    // seed an enemy near the player + flag thrust so a SHIP plume attaches too (the global toggle must flip
    // it). emitExhaust attaches + caches the plume deterministically (no reliance on the AI / frame rate).
    const base = g.player.mesh.position;
    g.spawnEnemy('fighter');
    const e = g.enemies[g.enemies.length - 1];
    e.mesh.position.set(base.x + 30, 0.6, base.z - 30);
    e.vel.set(0, 0, 0);
    g.emitExhaust(e.mesh, e.vel, e.vel, e.engine.exhaust);
  });
  await page.waitForTimeout(600); // let the freighter glb + plume load/settle

  const before = await page.evaluate(() => {
    const g = window.__game;
    const fp = g.exhaust.activeFreighterPlume;
    const ship = g.enemies.map((e) => e.mesh.userData.exhaustPlume).find(Boolean);
    return {
      hasFreighter: !!fp,
      mode: g.exhaust.currentMode,
      freighterPointsVisible: fp ? fp.meshes.points.visible : null,
      freighterFlameVisible: fp ? fp.meshes.flame.visible : null,
      hasShipPlume: !!ship,
      shipMode: ship ? ship.mode : null,
    };
  });
  assert.ok(before.hasFreighter, 'the freighter mission builds an active freighter plume');
  assert.equal(before.mode, 'points', 'the global look defaults to the point plume');
  assert.equal(before.freighterPointsVisible, true, 'freighter shows the point mesh by default');
  assert.equal(before.freighterFlameVisible, false, 'freighter flame mesh is hidden by default');
  assert.ok(before.hasShipPlume, 'a thrusting enemy has an attached plume');
  assert.equal(before.shipMode, 'points', 'the ship plume comes up in the global point look');
  await shot('points');

  // flip the GLOBAL look → flame; it must retarget the freighter AND every ship plume at once
  const after = await page.evaluate(() => {
    const g = window.__game;
    g.exhaust.setGlobalExhaustMode('flame');
    const fp = g.exhaust.activeFreighterPlume;
    const ship = g.enemies.map((e) => e.mesh.userData.exhaustPlume).find(Boolean);
    return {
      mode: g.exhaust.currentMode,
      freighterFlameVisible: fp.meshes.flame.visible,
      freighterPointsVisible: fp.meshes.points.visible,
      shipMode: ship ? ship.mode : null,
    };
  });
  assert.equal(after.mode, 'flame', 'the global mode switched to flame');
  assert.equal(after.freighterFlameVisible, true, 'freighter flame mesh is visible after the global toggle');
  assert.equal(after.freighterPointsVisible, false, 'freighter point mesh is hidden in flame mode');
  assert.equal(after.shipMode, 'flame', 'the GLOBAL toggle also flipped the ship plume to flame');
  await shot('flame');
}
