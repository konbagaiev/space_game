// Briefing item showcase (docs/plans/briefing-item-showcase.md): the GRANTED item's model spins in the
// work-zone showcase (#mw-item) — Machine Gun on the L2 briefing, Repair drone on L3 — between the text and
// Take-off, WITHOUT replacing the ship in the right-column preview. It's hidden on L4 (unlockShop, no item)
// and when a side mission is selected. Asserts both the work-zone item (window.__game.itemShowcaseTarget)
// and that the ship preview (window.__game.previewTarget) keeps showing the player ship throughout.
export const name = '97-briefing-showcase';

export default async function ({ page, assert, shot }) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.unroute('**/api/players/*/reset').catch(() => {}); // clear any leaked mock from 14-reset-progress
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  // Roll progress back to L1, then advance `n` levels, and reload onto that level's briefing.
  const landOn = async (n) => {
    await page.evaluate(async ({ pid, n }) => {
      await fetch(`/api/players/${pid}/reset`, { method: 'POST' });
      for (let i = 0; i < n; i++) await fetch(`/api/players/${pid}/advance`, { method: 'POST' });
    }, { pid, n });
    await page.goto(page.url(), { waitUntil: 'load' });
    await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
    await page.waitForFunction('!!(window.__game.previewTarget)', null, { timeout: 4000 });
  };
  const ship = () => page.evaluate(() => window.__game.previewTarget);
  const item = () => page.evaluate(() => window.__game.itemShowcaseTarget);
  const isShip = (u) => /player_hangar\.|player_combat\./.test(u || '');

  await landOn(1); // L2 briefing → Machine Gun in the work zone, ship still in the right preview
  await page.waitForFunction('!!(window.__game.itemShowcaseTarget)', null, { timeout: 4000 });
  assert.match(await item(), /machine_gun_hangar\./, 'L2 briefing showcases the Machine Gun model');
  assert.ok(isShip(await ship()), 'L2: the ship preview still shows the player ship (item does not replace it)');
  await shot('L2-machine-gun');

  await landOn(2); // L3 briefing → Repair drone in the work zone, ship still in the right preview
  await page.waitForFunction('!!(window.__game.itemShowcaseTarget)', null, { timeout: 4000 });
  assert.match(await item(), /repair_drone_hangar\./, 'L3 briefing showcases the Repair drone model');
  assert.ok(isShip(await ship()), 'L3: the ship preview still shows the player ship (item does not replace it)');
  await shot('L3-repair-drone');

  await landOn(3); // L4 briefing (unlockShop, no granted item) → no item, ship preview unchanged
  assert.equal(await item(), null, 'L4 briefing (no item) hides the work-zone showcase');
  assert.ok(isShip(await ship()), 'L4: the ship preview shows the player ship');

  // selecting a side mission (campaign cleared) hides the item showcase and keeps the ship preview
  await landOn(4);
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });
  await page.waitForFunction('window.__game.missionOffers.length === 3', null, { timeout: 6000 });
  await page.evaluate(() => document.querySelectorAll('#mw-mission-list .mw-sub')[1].click()); // first side mission
  await page.waitForTimeout(100);
  assert.equal(await item(), null, 'selecting a side mission hides the item showcase');
  assert.ok(isShip(await ship()), 'selecting a side mission keeps the ship preview');
}
