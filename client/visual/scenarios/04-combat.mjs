// Combat smoke: hold fire while sweeping the aim for a couple of seconds. Asserts the sim stays
// healthy (no errors — checked by the runner — enemy count maintained, score tracked) and saves a
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
    return { enemies: g.enemies.length, score: g.score, bulletsIsArray: Array.isArray(g.bullets) };
  });
  assert.equal(data.enemies, 4, 'enemy count is maintained at 4');
  assert.equal(typeof data.score, 'number', 'score is tracked');
  assert.ok(data.bulletsIsArray, 'bullets pool exists');
}
