// Arena boundaries (soft boundary): the player can fly past ±ARENA without stopping; after a grace
// delay an out-of-bounds warning + countdown shows; warpPlayerToCenter() recenters + zeroes velocity.
// Also asserts the in-world edge marker and the corner mini-map exist.
export const name = '08-arena-boundaries';

export default async function ({ page, assert, shot }) {
  // Launch from whichever menu is up (a prior scenario may have advanced progress).
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('hangar')) document.getElementById('hangar-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(300);

  // The edge marker (a Line) is in the combat scene, and the radar/warning DOM exists.
  const present = await page.evaluate(() => {
    const g = window.__game;
    return {
      borderInScene: g.scene.children.includes(g.arenaBorder.line),
      hasMiniMap: !!document.getElementById('minimap'),
      hasWarn: !!document.getElementById('oob-warn'),
      arena: g.ARENA,
    };
  });
  assert.ok(present.borderInScene, 'the arena edge marker (Line) is in the combat scene');
  assert.ok(present.hasMiniMap, 'the mini-map canvas is present');
  assert.ok(present.hasWarn, 'the out-of-bounds warning element is present');

  // Fly the ship far out of bounds; it does NOT get clamped (the hard wall is gone).
  await page.evaluate(() => {
    const g = window.__game;
    g.player.mesh.position.set(g.ARENA + 120, 0.6, 0); // well past the east edge
    g.player.vel.set(0, 0, 0);
  });
  await page.waitForTimeout(150);
  const stillOut = await page.evaluate(() => Math.abs(window.__game.player.mesh.position.x));
  assert.ok(stillOut > present.arena, 'the ship is NOT clamped at the boundary (it flew past freely)');

  // Enemies and weapons keep working out of bounds: a freshly spawned enemy appears next to the
  // (out-of-bounds) player — beyond the arena — and is NOT clamped back inside on the next ticks.
  const oob = await page.evaluate(() => {
    const g = window.__game;
    const e = g.spawnEnemy('fighter');
    const spawnOut = Math.max(Math.abs(e.mesh.position.x), Math.abs(e.mesh.position.z));
    return { spawnOut, arena: g.ARENA, id: g.enemies.indexOf(e) };
  });
  assert.ok(oob.spawnOut > oob.arena, 'a new enemy spawns around the out-of-bounds player (beyond the arena), not clamped to the edge');
  await page.waitForTimeout(300); // let the enemy move under AI
  const stayedOut = await page.evaluate((id) => {
    const e = window.__game.enemies[id];
    return e ? Math.max(Math.abs(e.mesh.position.x), Math.abs(e.mesh.position.z)) : 0;
  }, oob.id);
  assert.ok(stayedOut > oob.arena, 'the enemy is not clamped back inside the arena (it can fight out of bounds)');

  // After the grace delay (OOB_WARN_DELAY = 2s) the warning + countdown appears.
  await page.waitForTimeout(2300);
  const warn = await page.evaluate(() => {
    const el = document.getElementById('oob-warn');
    return { visible: window.__game.oobWarnVisible, text: el.textContent };
  });
  assert.ok(warn.visible, 'the "left the battlefield" warning shows after the grace delay');
  assert.ok(/return/i.test(warn.text) && /\d/.test(warn.text), 'warning includes the message + a countdown');
  await shot('out-of-bounds');

  // warpPlayerToCenter() recenters the ship and zeroes its velocity (the 30s auto-return reuses this).
  await page.evaluate(() => {
    window.__game.player.vel.set(5, 0, 5);
    window.__game.warpPlayerToCenter();
  });
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => {
    const p = window.__game.player;
    return { dist: Math.hypot(p.mesh.position.x, p.mesh.position.z), speed: p.vel.length(), warn: window.__game.oobWarnVisible };
  });
  assert.ok(after.dist < 1, 'warp-back returns the ship to the center');
  assert.equal(after.speed, 0, 'warp-back zeroes the velocity');
  assert.ok(!after.warn, 'the warning clears once the ship is back inside');
  await shot('warped-back');
}
