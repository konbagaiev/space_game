// Briefing item showcase (docs/plans/briefing-item-showcase.md): the GRANTED item's model spins in the
// work-zone showcase (#mw-item) — Machine Gun on the L2 briefing, Repair drone on L3 — between the text and
// Take-off, while the right column holds the MISSION LIST. It's hidden on L4 (unlockShop, no item) and when
// a side mission is selected. Asserts the work-zone item (window.__game.itemShowcaseTarget) per level.
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
    await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });
    await page.waitForFunction('document.querySelectorAll("#mw-mission-board .mission-card").length >= 1', null, { timeout: 4000 });
  };
  const item = () => page.evaluate(() => window.__game.itemShowcaseTarget);

  await landOn(2); // MG briefing (id 3) → Machine Gun in the work zone, mission list in the right column
  await page.click('#mw-mission-desc'); // skip the L2/L3 staged typewriter so the showcase reveals now
  await page.waitForFunction('!!(window.__game.itemShowcaseTarget)', null, { timeout: 4000 });
  assert.match(await item(), /machine_gun_hangar\./, 'L2 briefing showcases the Machine Gun model');
  assert.ok(await page.evaluate(() => document.querySelectorAll('#mw-mission-board .mission-card').length >= 1),
    'L2: the right column shows the mission list (no ship preview)');
  await shot('L2-machine-gun');

  await landOn(3); // drone briefing (id 4) → Repair drone in the work zone
  await page.click('#mw-mission-desc'); // skip the L2/L3 staged typewriter so the showcase reveals now
  await page.waitForFunction('!!(window.__game.itemShowcaseTarget)', null, { timeout: 4000 });
  assert.match(await item(), /repair_drone_hangar\./, 'L3 briefing showcases the Repair drone model');
  await shot('L3-repair-drone');

  await landOn(4); // unlockShop briefing (id 5, no granted item) → no item
  assert.equal(await item(), null, 'L4 briefing (no item) hides the work-zone showcase');

  // selecting a side mission (campaign cleared) hides the item showcase
  await landOn(5);
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });
  await page.waitForFunction('document.querySelectorAll("#mw-mission-board .mission-card").length === 4', null, { timeout: 6000 });
  await page.evaluate(() => document.querySelectorAll('#mw-mission-board .mission-card')[1].click()); // first side mission
  await page.waitForTimeout(100);
  assert.equal(await item(), null, 'selecting a side mission hides the item showcase');
}
