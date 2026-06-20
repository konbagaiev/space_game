// Smoke test: the game boots, renders a canvas, and seeds the arena with enemies.
export const name = '01-smoke';

export default async function ({ page, assert, shot }) {
  await page.waitForTimeout(200); // let the first frames run (enemy count is maintained in update)
  const info = await page.evaluate(() => {
    const g = window.__game;
    return { enemies: g.enemies.length, hasCanvas: !!document.querySelector('canvas') };
  });
  assert.ok(info.hasCanvas, 'a WebGL canvas is present');
  assert.equal(info.enemies, 4, 'the arena starts with 4 enemies');
  await shot('start');
}
