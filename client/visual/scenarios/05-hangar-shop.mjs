// Hangar shop + stash (docs/plans/hangar-shop.md + economy-shop-v2.md): unlock the shop (clear the
// campaign), reload onto the Hangar, and assert the reworked bay — nav-switched Loadout / Stash / Shop
// screens, a two-pane Shop (type list → items), the live ship-stats panel — then exercise an install.
// Also catches any JS error in the shop module (the runner fails a scenario on any page error).
export const name = '05-hangar-shop';

export default async function ({ page, assert, shot }) {
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  assert.ok(pid, 'a player id is present');

  // unlock: advance off the final level (clears the campaign → shop_unlocked + basic gun backfilled)
  await page.evaluate(async (pid) => {
    for (let i = 0; i < 4; i++) await fetch(`/api/players/${pid}/advance`, { method: 'POST' });
  }, pid);

  // reload → level-3 has a briefing, so the client lands on the Hangar; the bay opens (unlocked now)
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForSelector('#hangar-bay', { state: 'visible', timeout: 5000 });

  // opens on the Loadout screen by default
  const base = await page.evaluate(() => ({
    nav: document.querySelectorAll('#bay-nav button').length,
    loadoutActive: document.getElementById('view-loadout').classList.contains('active'),
    loadout: document.querySelectorAll('#loadout-list .bay-item').length,
    stash: document.querySelectorAll('#stash-list .bay-item').length,
    stats: document.querySelectorAll('#ship-stats .stat').length,
    types: document.querySelectorAll('#shop-types button').length,
  }));
  assert.equal(base.nav, 3, 'three nav screens: Loadout / Stash / Shop');
  assert.ok(base.loadoutActive, 'opens on the Loadout screen');
  assert.ok(base.loadout >= 4, 'the loadout shows the equipped slots');
  assert.ok(base.stash >= 1, 'the stash holds the backfilled basic gun');
  assert.equal(base.stats, 4, 'four live ship-stats are shown (HP / accel / turn / weight)');
  assert.equal(base.types, 5, 'shop type list: Hull / Engine / Thrusters / Repair / Weapon');
  await shot('loadout');

  // Shop screen → Weapon type → the buyable weapon ladder shows on the right pane
  await page.evaluate(() => document.querySelector('#bay-nav [data-view="shop"]').click());
  await page.evaluate(() => document.querySelector('#shop-types [data-type="weapon"]').click());
  await page.waitForTimeout(100);
  const shop = await page.evaluate(() => ({
    shopActive: document.getElementById('view-shop').classList.contains('active'),
    items: document.querySelectorAll('#shop-list .bay-item').length,
    hasPrice: !!document.querySelector('#shop-list .price'),
  }));
  assert.ok(shop.shopActive, 'the Shop screen is active');
  assert.ok(shop.items >= 3, 'the Weapon type lists the buyable weapon ladder');
  assert.ok(shop.hasPrice, 'shop items show a price');
  // the hover/(i) characteristics list every stat — incl. bullet speed + max range
  const wstats = await page.evaluate(() =>
    [...document.querySelectorAll('#shop-list .bay-item .stats')].map((s) => s.textContent).join(' | '));
  assert.match(wstats, /Speed \d/, 'weapon stats include projectile speed');
  assert.match(wstats, /Range \d/, 'weapon stats include max range');
  // characteristics are hidden until the (i) button is tapped (no hover reveal)
  const hiddenBefore = await page.evaluate(() => document.querySelector('#shop-list .bay-item .stats').classList.contains('hidden'));
  assert.ok(hiddenBefore, 'stats are hidden by default');
  await page.evaluate(() => document.querySelector('#shop-list .bay-item .info-btn').click());
  const shownAfter = await page.evaluate(() => !document.querySelector('#shop-list .bay-item .stats').classList.contains('hidden'));
  assert.ok(shownAfter, 'tapping (i) reveals the characteristics');
  await page.waitForTimeout(100);
  await shot('shop-weapons');

  // Stash screen → install the basic gun → the player is rebuilt with it equipped
  await page.evaluate(() => document.querySelector('#bay-nav [data-view="stash"]').click());
  await page.evaluate(() => {
    const btn = document.querySelector('#stash-list [data-act="equip"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(400);
  const gun = await page.evaluate(() => window.__game.player.groups.gun.mounts.map((m) => m.weapon.name));
  assert.ok(gun.includes('Basic kinetic'), 'installing the basic gun from the stash rebuilt the player');
  await shot('after-install');

  // launch the mission, then die → the death overlay offers "Back to Hangar" (shop is unlocked)
  await page.evaluate(() => document.getElementById('hangar-go').click());
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__game.player.hp = 0; });
  await page.waitForTimeout(400);
  const death = await page.evaluate(() => ({
    overlay: getComputedStyle(document.getElementById('overlay')).display !== 'none',
    backBtn: getComputedStyle(document.getElementById('back-hangar')).display !== 'none',
  }));
  assert.ok(death.overlay, 'death overlay is shown');
  assert.ok(death.backBtn, 'Back to Hangar is offered on death once the shop is unlocked');
  await shot('death-back-to-hangar');

  // clicking it returns to the Hangar (with the bay), not an instant retry
  await page.evaluate(() => document.getElementById('back-hangar').click());
  await page.waitForTimeout(200);
  const backHome = await page.evaluate(() => ({
    hangar: getComputedStyle(document.getElementById('hangar')).display !== 'none',
    bay: getComputedStyle(document.getElementById('hangar-bay')).display !== 'none',
  }));
  assert.ok(backHome.hangar && backHome.bay, 'Back to Hangar returns to the hangar with the shop bay');
}
