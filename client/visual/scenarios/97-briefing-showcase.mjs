// Briefing item showcase (docs/plans/briefing-item-showcase.md): the model preview shows the GRANTED item
// — Machine Gun on the L2 briefing, Repair drone on L3 — and reverts to the player ship on L4 (unlockShop,
// no item) and when a side mission is selected. Asserts the preview's target glb (window.__game.previewTarget).
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
  const target = () => page.evaluate(() => window.__game.previewTarget);

  await landOn(1); // L2 briefing → Machine Gun
  assert.match(await target(), /machine_gun_hangar\./, 'L2 briefing showcases the Machine Gun model');
  await shot('L2-machine-gun');

  await landOn(2); // L3 briefing → Repair drone
  assert.match(await target(), /repair_drone_hangar\./, 'L3 briefing showcases the Repair drone model');
  await shot('L3-repair-drone');

  await landOn(3); // L4 briefing (unlockShop, no granted item) → the player ship
  assert.match(await target(), /player_hangar\.|player_combat\./, 'L4 briefing (no item) shows the player ship');

  // selecting a side mission (campaign cleared) reverts the preview to the ship
  await landOn(4);
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });
  await page.waitForFunction('window.__game.missionOffers.length === 3', null, { timeout: 6000 });
  await page.evaluate(() => document.querySelectorAll('#mw-mission-list .mw-sub')[1].click()); // first side mission
  await page.waitForTimeout(100);
  assert.match(await target(), /player_hangar\.|player_combat\./, 'selecting a side mission reverts the preview to the ship');
}
