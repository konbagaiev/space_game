// Pause button: freezes the whole fight (skips the sim update) and flips its label ⏸ ⇄ ▶; resuming
// re-animates. Asserts a "world signature" (enemy positions + projectile counts) stays frozen while
// paused and changes again after resume.
export const name = '06-pause';

// Sum of enemy positions + projectile counts — changes only when the simulation advances.
const worldSig = (page) => page.evaluate(() => {
  const g = window.__game;
  const pos = g.enemies.reduce((a, e) => a + e.mesh.position.x + e.mesh.position.z, 0);
  return pos + g.bullets.length * 1000 + g.rockets.length * 100;
});

export default async function ({ page, assert, shot }) {
  // The shared player may sit on the Welcome OR the Hangar (a prior scenario advanced progress), so the
  // runner's auto-takeoff may not have fired — launch from whichever screen is up.
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('hangar')) document.getElementById('hangar-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(400); // let the first wave spawn + start moving
  const btn = '#pause-btn';
  const enemies = await page.evaluate(() => window.__game.enemies.length);
  assert.ok(enemies > 0, 'enemies are present and moving');
  assert.ok(await page.evaluate(() => getComputedStyle(document.querySelector('#pause-btn')).display !== 'none'),
    'pause button is visible during play');

  // pause → label becomes ▶, and the world stops changing
  await page.click(btn);
  assert.equal(await page.evaluate(() => document.querySelector('#pause-btn').textContent), '▶', 'shows the play icon when paused');
  const atPause = await worldSig(page);
  await page.waitForTimeout(500);
  assert.equal(await worldSig(page), atPause, 'the fight is frozen while paused');
  await shot('paused');

  // resume → label becomes ⏸, and the world advances again
  await page.click(btn);
  assert.equal(await page.evaluate(() => document.querySelector('#pause-btn').textContent), '⏸', 'shows the pause icon again after resuming');
  await page.waitForTimeout(400);
  assert.notEqual(await worldSig(page), atPause, 'the fight resumes (world advances) after pressing play');
}
