// HUD overhaul + event log + item rarity color (docs/plans/2026-07-05-1844-touch-hud-log-item-colors.md).
// Asserts the HUD reformat (single credits line, Enemies counter removed), the fading event log
// (kill line on a death, color-tinted pickup line on a grab), the world-drop rarity glow color, and the
// touch-only bottom-center zoom relocation. Screenshots are saved for a human to eyeball.
export const name = '19-hud-log';

export default async function ({ page, assert, shot }) {
  // Launch from whichever menu is up (by scenario order the throwaway player may land on the Main
  // Window/hangar, not the welcome screen), then focus the canvas so the game is live.
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(250);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(150);

  // 1) the live "Enemies" counter is gone entirely
  const hasEnemies = await page.evaluate(() => !!document.getElementById('enemies'));
  assert.equal(hasEnemies, false, 'the #enemies live counter is removed');

  // 2) credits readout is the single "credits {total}/{earned} earned" line
  const creditsText = await page.evaluate(() => document.getElementById('credits').textContent);
  assert.match(creditsText, /^credits \d+\/\d+ earned$/, `credits line format (got "${creditsText}")`);

  // 3) killing an enemy pushes a kill line into the event log
  await page.evaluate(() => window.__game.spawnEnemy());
  await page.waitForTimeout(150);
  await page.evaluate(() => { window.__game.enemies.forEach((e) => { e.hp = 0; }); }); // force death → sim processes it next frame
  await page.waitForFunction(() => document.querySelectorAll('#event-log .event-line').length > 0, null, { timeout: 4000 });
  const killLine = await page.evaluate(() => {
    const el = document.querySelector('#event-log .event-line');
    return { text: el.textContent, color: el.style.color };
  });
  assert.match(killLine.text, /killed \+\d+$/, `kill line text (got "${killLine.text}")`);
  assert.equal(killLine.color, '', 'kill line uses the default text color (no inline color)');
  await shot('kill-line');

  // 4) a world drop glows in its rarity color, and collecting it logs a pickup line tinted that color.
  //    Machine Gun (weapon 5) = common/green (#59e0a0). Spawn one, snap it onto the player so the grab
  //    pulls it in, then assert both the halo sprite color AND the pickup event-line color.
  const haloHex = await page.evaluate(() => {
    window.__game.spawnTestDrop({ kind: 'weapon', refId: 5 }); // deterministic common/green item
    const d = window.__game.drops[window.__game.drops.length - 1];
    const p = window.__game.player;
    d.obj.position.set(p.mesh.position.x + 5, 0.8, p.mesh.position.z); // in grab range so it gets pulled
    // find the additive halo sprite child and read its tint
    let hex = null;
    d.obj.traverse((o) => { if (o.isSprite && o.material && o.material.color) hex = o.material.color.getHexString(); });
    return hex;
  });
  assert.equal(haloHex, '59e0a0', `world-drop halo is tinted the item's rarity color (got "#${haloHex}")`);

  // let the grab arm (0.3s) + pull it to within COLLECT_DIST, then collect
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#event-log .event-line')].some((l) => /picked up/.test(l.textContent)),
    null, { timeout: 6000 });
  const pickup = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#event-log .event-line')].find((l) => /picked up/.test(l.textContent));
    return { text: el.textContent, color: el.style.color };
  });
  assert.match(pickup.text, /^picked up /, `pickup line text (got "${pickup.text}")`);
  assert.equal(pickup.color, 'rgb(89, 224, 160)', `pickup line is tinted the item's color (got "${pickup.color}")`); // #59e0a0
  await shot('pickup-line');

  // 5) touch profile: the zoom pair relocates to the bottom-center — measured by on-screen geometry
  //    (computed `right:auto` resolves to a used px value, so we check the actual rect, not the string).
  //    Desktop baseline is right-edge + vertically centered; touch must be horizontally centered + near
  //    the bottom, and the DOM order [＋, −] must render as − (left) then ＋ (right).
  const zoom = await page.evaluate(() => {
    const z = document.getElementById('zoom');
    const desktop = z.getBoundingClientRect();
    document.body.classList.add('touch');
    const rect = z.getBoundingClientRect();
    const minus = document.getElementById('zoom-out').getBoundingClientRect();
    const plus = document.getElementById('zoom-in').getBoundingClientRect();
    const r = {
      desktopCenterX: desktop.left + desktop.width / 2,
      centerX: rect.left + rect.width / 2,
      vpW: window.innerWidth,
      vpBottom: window.innerHeight - rect.bottom, // distance from the viewport bottom
      minusLeftOfPlus: minus.left < plus.left,
    };
    document.body.classList.remove('touch');
    return r;
  });
  assert.ok(zoom.desktopCenterX > zoom.vpW * 0.8, `desktop baseline: zoom sits at the right edge (centerX=${zoom.desktopCenterX})`);
  assert.ok(Math.abs(zoom.centerX - zoom.vpW / 2) < 40, `touch: zoom pair is horizontally centered (centerX=${zoom.centerX}, half-vp=${zoom.vpW / 2})`);
  assert.ok(zoom.vpBottom >= 0 && zoom.vpBottom < 120, `touch: zoom pair is anchored near the bottom (${zoom.vpBottom}px from bottom)`);
  assert.ok(zoom.minusLeftOfPlus, 'touch: laid out "−  +" — minus renders left of plus');
  await shot('touch-zoom');
}
