// Every ship leaves an engine exhaust trail colored by its engine. Seed enemies on-screen in the
// "approach" band so they thrust toward the player, then assert trail particles exist in an enemy
// exhaust color (the player is idle, so the trail is purely from enemies).
export const name = '03-exhaust-trail';

export default async function ({ page, assert, shot }) {
  await page.evaluate(() => {
    const g = window.__game;
    g.enemies.forEach((e) => g.scene.remove(e.mesh));
    g.enemies.length = 0; // clear the default ring (mostly off-screen)
    const base = g.player.mesh.position;
    ['fighter', 'heavy'].forEach((k, i) => {
      g.spawnEnemy(k);
      const e = g.enemies[g.enemies.length - 1];
      e.mesh.position.set(base.x + (i ? 34 : -34), 0.6, base.z - 34); // ~48 away → thrust toward player
      e.vel.set(0, 0, 0);
    });
  });

  await page.waitForTimeout(450); // let them fire engines and shed exhaust

  const data = await page.evaluate(() => {
    const g = window.__game;
    return {
      trailCount: g.trail.length,
      colors: [...new Set(g.trail.map((t) => t.mesh.material.color.getHex()))],
      scout: g.ENGINES.scout.exhaust.color,
      heavy: g.ENGINES.heavy.exhaust.color,
    };
  });

  assert.ok(data.trailCount > 0, 'enemies emit exhaust trail particles while thrusting');
  const usesEnemyColor = data.colors.includes(data.scout) || data.colors.includes(data.heavy);
  assert.ok(usesEnemyColor, `trail uses an enemy exhaust color (saw ${data.colors.map((c) => '0x' + c.toString(16))})`);
  await shot('thrusting');
}
