// Enemy health bars: a translucent red bar appears above an enemy only once it drops below full health.
// Asserts no bar at full HP, then a visible partial-width bar after damaging one enemy.
export const name = '16-enemy-health-bar';

export default async function ({ page, assert, shot }) {
  // launch from whichever menu is up (welcome or main window), then clear the wave and spawn one enemy
  // in front of the camera so its bar projects on-screen (mirrors 11-l4-enemies' deterministic setup).
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const g = window.__game;
    g.enemies.slice().forEach((e) => g.scene.remove(e.mesh));
    g.enemies.length = 0;
    const e = g.spawnEnemy('fighter');
    e.mesh.position.set(0, 0.6, 6); // just ahead of the player/camera
    e.mesh.scale.copy(e.spawnScale); // skip the warp-in grow so it's full size this frame
  });
  await page.waitForTimeout(120); // one HUD frame at full HP

  // At full health, no health bar should be rendered.
  const before = await page.evaluate(() =>
    [...document.querySelectorAll('#markers .enemy-hp')].filter((b) => b.style.display !== 'none').length
  );
  assert.equal(before, 0, 'no health bar while the enemy is at full HP');

  // Damage the enemy to 40% and let one frame draw the bar.
  await page.evaluate(() => {
    const e = window.__game.enemies[0];
    e.hp = e.maxHp * 0.4;
  });
  await page.waitForTimeout(120);
  await shot('damaged');

  const after = await page.evaluate(() => {
    const bars = [...document.querySelectorAll('#markers .enemy-hp')].filter((b) => b.style.display !== 'none');
    return { count: bars.length, fill: bars[0] ? bars[0].firstChild.style.width : null };
  });
  assert.ok(after.count >= 1, 'a health bar appears once the enemy is below full HP');
  assert.equal(after.fill, '40%', 'the fill width tracks the remaining health fraction');

  // The bar must sit ABOVE the enemy on the 2D screen (smaller `top` = higher). The anchor is offset
  // along the camera's screen-up axis, so this holds regardless of the near-top-down camera angle.
  const pos = await page.evaluate(() => {
    const g = window.__game; const e = g.enemies[0];
    const v = e.mesh.position.clone().project(g.camera);
    const enemyCenterPx = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const bar = [...document.querySelectorAll('#markers .enemy-hp')].find((b) => b.style.display !== 'none');
    return { enemyCenterPx, barTopPx: parseFloat(bar.style.top) };
  });
  assert.ok(pos.barTopPx < pos.enemyCenterPx - 20, 'bar sits clearly above the enemy center on screen');
}
