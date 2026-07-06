// Combat smoke: hold fire while sweeping the aim for a couple of seconds. Asserts the sim stays
// healthy (no errors — checked by the runner — combat is live, credits tracked) and saves a
// mid-fight frame.
export const name = '04-combat';

export default async function ({ page, assert, shot }) {
  await page.mouse.click(640, 400); // focus the canvas
  await page.keyboard.down('Space'); // fire
  await page.keyboard.down('KeyD');  // sweep the nose so shots rake the circling enemies
  await page.waitForTimeout(2500);
  await shot('firing');
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyD');

  const data = await page.evaluate(() => {
    const g = window.__game;
    return { enemies: g.enemies.length, earned: g.earned, bulletsIsArray: Array.isArray(g.bullets) };
  });
  assert.ok(data.enemies > 0 || data.earned > 0, 'combat is live: enemies present or being destroyed');
  assert.equal(typeof data.earned, 'number', 'credits earned are tracked');
  assert.ok(data.bulletsIsArray, 'bullets pool exists');
}
