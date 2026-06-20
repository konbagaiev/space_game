// Smoke test: the game boots, renders a canvas, and seeds the arena with enemies.
export const name = '01-smoke';

export default async function ({ page, assert, shot }) {
  await page.waitForTimeout(200); // let the first frames run (the level runner fills the first wave)
  const info = await page.evaluate(() => {
    const g = window.__game;
    const cap = g.catalog.level.phases[0].spawn.maxConcurrent; // level-1 wave-1 = 3
    return { enemies: g.enemies.length, cap, hasCanvas: !!document.querySelector('canvas') };
  });
  assert.ok(info.hasCanvas, 'a WebGL canvas is present');
  assert.equal(info.enemies, info.cap, "the arena fills to the first wave's maxConcurrent");
  await shot('start');
}
