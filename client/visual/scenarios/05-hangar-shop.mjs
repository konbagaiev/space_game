// Loadout screen (docs/plans/2026-08-08-base-menu-redesign.md, Slice C): unlock the shop (clear the
// campaign), land on the Main Window, open Loadout — the ship sits centered with its slot chips around it;
// selecting a slot opens the right panel (equipped info + Remove + stash replacements → Install), and the
// Shop button swaps the panel to the shop (type list → buyable items). Also catches any JS error in the
// shop module (the runner fails on any page error).
export const name = '05-hangar-shop';

export default async function ({ page, assert, shot }) {
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  assert.ok(pid, 'a player id is present');

  // unlock: advance off the final level (clears the campaign → shop_unlocked + basic gun backfilled)
  await page.evaluate(async (pid) => {
    for (let i = 0; i < 4; i++) await fetch(`/api/players/${pid}/advance`, { method: 'POST' });
  }, pid);

  // reload → the client lands on the Main Window; the Loadout item opens the centered-ship screen
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });
  await page.waitForSelector('.mw-item[data-mw="loadout"]', { state: 'attached', timeout: 5000 });

  const statsOnMissions = await page.evaluate(() => getComputedStyle(document.getElementById('ship-stats')).display);
  assert.equal(statsOnMissions, 'none', 'ship characteristics are Loadout-only (hidden on Missions)');

  // the campaign is cleared, so the "Level 3" gear (Heavy hull / Heavy Machine Gun / Triple spiral rocket)
  // has just unlocked → the gold "(new)" marker sits beside Loadout until the player opens the screen
  await page.waitForFunction('document.getElementById("mw-loadout-new").classList.contains("show")', null, { timeout: 5000 });
  const marker = await page.evaluate(() => {
    const n = document.getElementById('mw-loadout-new');
    return { text: n.textContent.trim(), color: getComputedStyle(n).color };
  });
  assert.ok(/new/i.test(marker.text), 'the Loadout menu item carries a "(new)" marker');
  assert.equal(marker.color, 'rgb(255, 207, 90)', 'the marker is the same gold as the free-skill-points badge');
  await shot('loadout-new-marker');

  // open the Loadout screen
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="loadout"]').click());
  await page.waitForFunction('document.querySelectorAll("#loadout-slots .slot-chip").length >= 6', null, { timeout: 5000 });
  const base = await page.evaluate(() => ({
    bayActive: document.getElementById('mw-view-bay').classList.contains('active'),
    slots: document.querySelectorAll('#loadout-slots .slot-chip').length,
    hasShipCanvas: !!document.getElementById('loadout-ship'),
    stats: document.querySelectorAll('#ship-stats .stat').length,
    hasGunSlot: !!document.querySelector('.slot-chip[data-slot="gun"]'),
  }));
  assert.ok(base.bayActive, 'the Loadout screen is shown in the work zone');
  assert.ok(base.slots >= 8, 'the ship shows its slot chips (6 components + weapon groups)');
  assert.ok(base.hasShipCanvas, 'the centered ship canvas is present');
  assert.equal(base.stats, 4, 'four live ship-stats are shown (HP / accel / turn / weight)');
  assert.ok(base.hasGunSlot, 'the gun weapon slot is present');
  // opening Loadout no longer clears the marker — it leads the player on to the Shop button, which carries
  // the same gold "(new)". Both persist through the Loadout screen until the shop is actually opened.
  assert.ok(await page.evaluate(() => document.getElementById('mw-loadout-new').classList.contains('show')),
    'the Loadout menu "(new)" persists after opening Loadout');
  const shopBtnNew = await page.evaluate(() => {
    const n = document.querySelector('#loadout-panel [data-act="open-shop"] .mw-new');
    return n ? { text: n.textContent.trim(), color: getComputedStyle(n).color } : null;
  });
  assert.ok(shopBtnNew && /new/i.test(shopBtnNew.text), 'the Shop button inside Loadout carries a "(new)" marker');
  assert.equal(shopBtnNew.color, 'rgb(255, 207, 90)', 'the Shop-button marker is the same gold as the menu marker');
  // it survives leaving and re-entering Loadout (the shop is still unopened)
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="missions"]').click());
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="loadout"]').click());
  await page.waitForFunction('document.querySelectorAll("#loadout-slots .slot-chip").length >= 6', null, { timeout: 5000 });
  assert.ok(await page.evaluate(() => document.getElementById('mw-loadout-new').classList.contains('show')),
    'the marker stays lit after leaving and re-entering Loadout (shop still unopened)');
  await shot('loadout');

  // select the gun slot → the panel shows the equipped weapon + Remove, and the backfilled basic gun as a
  // stash replacement
  await page.evaluate(() => document.querySelector('.slot-chip[data-slot="gun"]').click());
  await page.waitForTimeout(80);
  const slotPanel = await page.evaluate(() => ({
    name: (document.querySelector('#loadout-panel .lp-item .lp-name') || {}).textContent || '',
    hasRemove: !!document.querySelector('#loadout-panel [data-act="unequip"]'),
    hasModel: !!document.getElementById('shop-model'),
    stashRows: [...document.querySelectorAll('#loadout-panel .lp-row[data-act="pick-stash"]')].map((b) => b.textContent),
    hasShopBtn: !!document.querySelector('#loadout-panel [data-act="open-shop"]'),
  }));
  assert.ok(slotPanel.name.length > 0, 'the selected slot shows the equipped item info');
  assert.ok(slotPanel.hasModel, 'the equipped Machine Gun shows its 3D model in the slot panel');
  assert.ok(slotPanel.hasRemove, 'the equipped item can be Removed');
  assert.ok(slotPanel.stashRows.some((t) => /Basic kinetic/.test(t)), 'the backfilled basic gun shows as a stash replacement');
  assert.ok(slotPanel.hasShopBtn, 'the Shop button is present in the panel');
  await page.waitForTimeout(120);
  await shot('slot-detail');

  // pick the basic gun from storage → an Install/Replace button → install it → the player is rebuilt
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#loadout-panel .lp-row[data-act="pick-stash"]')].find((b) => /Basic kinetic/.test(b.textContent));
    row.click();
  });
  await page.waitForFunction('!!document.querySelector("#loadout-panel [data-act=\'install\']")', null, { timeout: 3000 });
  // the picked storage item's row has both Install/Replace and a Sell button
  const picked = await page.evaluate(() => ({
    install: !!document.querySelector('#loadout-panel .lp-item [data-act="install"]'),
    sell: !!document.querySelector('#loadout-panel .lp-item [data-act="sell"]'),
  }));
  assert.ok(picked.install, 'the picked storage item offers Install/Replace');
  assert.ok(picked.sell, 'the picked storage item offers Sell');
  await shot('stash-picked');
  await page.evaluate(() => document.querySelector('#loadout-panel [data-act="install"]').click());
  await page.waitForTimeout(400);
  const gun = await page.evaluate(() => window.__game.player.groups.gun.mounts.map((m) => m.weapon.name));
  assert.ok(gun.includes('Basic kinetic'), 'installing the basic gun from storage rebuilt the player');
  await shot('after-install');

  // open the shop panel → Weapon type → the buyable weapon ladder shows with prices + an owned badge
  await page.evaluate(() => document.querySelector('#loadout-panel [data-act="open-shop"]').click());
  // opening the shop IS seeing the new gear → the Loadout menu "(new)" clears now (not on entering Loadout)
  assert.ok(await page.evaluate(() => !document.getElementById('mw-loadout-new').classList.contains('show')),
    'opening the shop clears the Loadout menu "(new)" marker');
  // The gold trail continues INSIDE the shop: the type tab whose section still holds a never-clicked
  // unlocked item is gold instead of blue, and so is that item's row. The shop opens on `hull`, which is
  // exactly where the newly unlocked Heavy hull sits — so this runs BEFORE the weapon-tab click below.
  const goldTabs = await page.evaluate(() => {
    const tab = (tp) => document.querySelector(`#loadout-panel .lp-type[data-type="${tp}"]`);
    const read = (tp) => ({ gold: tab(tp).classList.contains('new'), border: getComputedStyle(tab(tp)).borderColor });
    return { hull: read('hull'), weapon: read('weapon'), grab: read('grab') };
  });
  assert.ok(goldTabs.hull.gold, 'the hull tab (the default section, holding the new Heavy hull) is gold');
  assert.equal(goldTabs.hull.border, 'rgb(255, 207, 90)', 'and it renders the trail gold, not the active blue');
  assert.ok(goldTabs.weapon.gold, 'the weapon tab is gold too — two sections carry unseen items at once');
  assert.equal(goldTabs.weapon.border, 'rgb(255, 207, 90)');
  assert.ok(!goldTabs.grab.gold, 'an ungated section (grab) is NOT gold — the gold means something');
  const goldRows = await page.evaluate(() => [...document.querySelectorAll('#loadout-panel .lp-shop-item')]
    .map((r) => ({ name: r.querySelector('.lp-name').textContent, gold: r.classList.contains('new'), border: getComputedStyle(r).borderColor })));
  const heavy = goldRows.find((r) => /Heavy hull/.test(r.name));
  const basic = goldRows.find((r) => /Basic hull/.test(r.name));
  assert.ok(heavy && heavy.gold, 'the newly unlocked Heavy hull row carries the gold frame');
  assert.equal(heavy.border, 'rgb(255, 207, 90)');
  assert.ok(basic && !basic.gold, 'an ungated row in the same section stays blue-grey');
  await shot('shop-new-tab');

  // Clicking the ROW is what marks that item seen: its gold clears (and its tab's, since it was the last
  // unseen row there) while the weapon section — untouched — stays gold. Per-item state, not per-shop.
  await page.evaluate(() => {
    [...document.querySelectorAll('#loadout-panel .lp-shop-item[data-act="shop-item"]')]
      .find((c) => /Heavy hull/.test(c.textContent)).click();
  });
  await page.waitForTimeout(80);
  await page.evaluate(() => document.querySelector('#loadout-panel [data-act="shop-list"]').click());
  await page.waitForTimeout(80);
  const afterClick = await page.evaluate((pid) => ({
    hullGold: document.querySelector('#loadout-panel .lp-type[data-type="hull"]').classList.contains('new'),
    weaponGold: document.querySelector('#loadout-panel .lp-type[data-type="weapon"]').classList.contains('new'),
    rowGold: [...document.querySelectorAll('#loadout-panel .lp-shop-item')]
      .some((r) => /Heavy hull/.test(r.textContent) && r.classList.contains('new')),
    clicked: JSON.parse(localStorage.getItem(`shopItemsClicked:${pid}`) || 'null'),
  }), pid);
  assert.ok(!afterClick.rowGold, 'clicking the row cleared its gold frame');
  assert.ok(!afterClick.hullGold, 'and the hull tab with it (its last unseen row is gone)');
  assert.ok(afterClick.weaponGold, 'the weapon tab is still gold — clicking one row is not "seen everything"');
  assert.ok(Array.isArray(afterClick.clicked) && afterClick.clicked.includes('component:13'),
    'the clicked item is persisted per player (shopItemsClicked)');
  await shot('shop-new-row');

  await page.evaluate(() => document.querySelector('#loadout-panel .lp-type[data-type="weapon"]').click());
  await page.waitForTimeout(80);
  const shop = await page.evaluate(() => ({
    items: document.querySelectorAll('#loadout-panel .lp-shop-item').length,
    names: [...document.querySelectorAll('#loadout-panel .lp-shop-item')].map((c) => c.textContent),
    hasPrice: !!document.querySelector('#loadout-panel .lp-shop-item .price'),
    hasBuy: !!document.querySelector('#loadout-panel .lp-shop-item [data-act="buy"]'),
    ownedBadges: [...document.querySelectorAll('#loadout-panel .owned-badge')].map((b) => b.textContent.trim()),
  }));
  assert.ok(shop.items >= 3, 'the Weapon type lists the buyable weapon ladder');
  // the campaign is cleared, so the "Level 3"-gated weapons are on the shelf (before it they are absent)
  assert.ok(shop.names.some((n) => /Heavy Machine Gun/.test(n)), 'the gated Heavy Machine Gun is listed once "Level 3" is cleared');
  assert.ok(shop.names.some((n) => /Triple spiral rocket/.test(n)), 'the gated Triple spiral rocket is listed once "Level 3" is cleared');
  assert.ok(shop.hasPrice, 'shop items show a price');
  assert.ok(shop.hasBuy, 'shop items have a Buy button');
  assert.ok(shop.ownedBadges.some((t) => /\(owned ×\d+\)/.test(t)), 'an owned weapon shows an "(owned ×N)" badge');
  await shot('shop-weapons');

  // click the Machine Gun entry (it has a glb) → the detail card: stats at top, the 3D model, Buy, Back
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#loadout-panel .lp-shop-item[data-act="shop-item"]')].find((c) => /Machine Gun/.test(c.textContent) && !/Pirate/.test(c.textContent));
    card.click();
  });
  await page.waitForTimeout(120);
  const detail = await page.evaluate(() => ({
    model: !!document.getElementById('shop-model'),
    stats: !!document.querySelector('#loadout-panel .lp-detail .lp-stats'),
    buy: !!document.querySelector('#loadout-panel .lp-detail [data-act="buy"]'),
    back: !!document.querySelector('#loadout-panel [data-act="shop-list"]'),
  }));
  assert.ok(detail.stats, 'the detail card shows the item stats');
  assert.ok(detail.model, 'the detail card shows the 3D model canvas (Machine Gun has a glb)');
  assert.ok(detail.buy, 'the detail card has a Buy button');
  assert.ok(detail.back, 'the detail card has a Back button');
  await shot('shop-detail');

  // Back → the item list, then Back again → the slot detail
  await page.evaluate(() => document.querySelector('#loadout-panel [data-act="shop-list"]').click());
  await page.waitForTimeout(60);
  assert.ok(await page.evaluate(() => !!document.querySelector('#loadout-panel .lp-shop-item')), 'Back returns to the shop item list');
  await page.evaluate(() => document.querySelector('#loadout-panel [data-act="close-shop"]').click());
  await page.waitForTimeout(60);
  const backToSlot = await page.evaluate(() => !!document.querySelector('#loadout-panel [data-act="open-shop"]'));
  assert.ok(backToSlot, 'Back returns from the shop to the slot panel');
  // the shop has been opened → the Shop button no longer carries the "(new)" marker
  assert.ok(await page.evaluate(() => !document.querySelector('#loadout-panel [data-act="open-shop"] .mw-new')),
    'the Shop-button "(new)" is gone once the shop has been opened');

  // launch the mission (the mission view's Take-off), then die → the death overlay offers "Back to Hangar"
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="missions"]').click());
  await page.waitForTimeout(80);
  await page.evaluate(() => document.getElementById('mw-takeoff').click());
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

  // clicking it returns to the Main Window with the Loadout section available
  await page.evaluate(() => document.getElementById('back-hangar').click());
  await page.waitForTimeout(200);
  const backHome = await page.evaluate(() => ({
    mainOn: document.getElementById('mainwin').classList.contains('on'),
    loadoutItem: !!document.querySelector('.mw-item[data-mw="loadout"]'),
  }));
  assert.ok(backHome.mainOn, 'Back to Hangar returns to the Main Window');
  assert.ok(backHome.loadoutItem, 'the Loadout section is available from the menu');

  // ---- The MISSION gate, end to end (docs/plans/2026-08-14-1244-mission-gate-new-item-trail.md) ----
  // Ion engine (16) + Nanobot repair (20) carry `stats.minMission` = 'side-research': hidden from the shop
  // (not greyed — DECISIONS §108) until the "Research station" side mission has been CLEARED.
  const openShopSection = async (type) => {
    await page.evaluate(() => document.querySelector('.mw-item[data-mw="loadout"]').click());
    await page.waitForFunction('!!document.querySelector("#loadout-panel [data-act=\'open-shop\']")', null, { timeout: 5000 });
    await page.evaluate(() => document.querySelector('#loadout-panel [data-act="open-shop"]').click());
    await page.waitForFunction('!!document.querySelector("#loadout-panel .lp-types")', null, { timeout: 5000 });
    await page.evaluate((tp) => document.querySelector(`#loadout-panel .lp-type[data-type="${tp}"]`).click(), type);
    await page.waitForTimeout(80);
  };
  const shopRowNames = () => page.evaluate(() =>
    [...document.querySelectorAll('#loadout-panel .lp-shop-item .lp-name')].map((n) => n.textContent));
  await openShopSection('engine');
  assert.ok(!(await shopRowNames()).some((n) => /Ion engine/.test(n)),
    'the mission-gated Ion engine is ABSENT from the engine list before "Research station" is cleared');

  // clear the mission the way the victory path does (POST /missions/clear), then land again
  await page.evaluate(async (pid) => {
    await fetch(`/api/players/${pid}/missions/clear`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ missionId: 'side-research' }) });
  }, pid);
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });
  // two just-unlocked rows → the trail restarts at the Loadout menu item…
  await page.waitForFunction('document.getElementById("mw-loadout-new").classList.contains("show")', null, { timeout: 5000 });
  // …and the board records the clear permanently (Cleared takes precedence over Active/Taken)
  await page.waitForFunction('!!document.querySelector(\'.mission-card[data-msel="side-research"]\')', null, { timeout: 5000 });
  const clearedBadge = await page.evaluate(() => {
    const card = document.querySelector('.mission-card[data-msel="side-research"]');
    const b = card.querySelector('.mc-badge');
    return b ? { cleared: b.classList.contains('cleared'), text: b.textContent.trim() } : null;
  });
  assert.ok(clearedBadge && clearedBadge.cleared, 'the Research station card carries the "Cleared" badge');
  assert.ok(/cleared/i.test(clearedBadge.text), 'and it reads "Cleared"');

  await openShopSection('engine');
  assert.ok((await shopRowNames()).some((n) => /Ion engine/.test(n)), 'clearing the mission puts the Ion engine on the shelf');
  const unlockedTrail = await page.evaluate(() => {
    const tab = (tp) => document.querySelector(`#loadout-panel .lp-type[data-type="${tp}"]`);
    return {
      engine: tab('engine').classList.contains('new'), repair: tab('repair').classList.contains('new'),
      engineBorder: getComputedStyle(tab('engine')).borderColor,
      ionGold: [...document.querySelectorAll('#loadout-panel .lp-shop-item')]
        .some((r) => /Ion engine/.test(r.textContent) && r.classList.contains('new')),
    };
  });
  assert.ok(unlockedTrail.engine, 'the engine tab is gold — it holds a never-clicked new item');
  assert.ok(unlockedTrail.repair, 'and so is the repair tab (Nanobot repair unlocked with it)');
  assert.equal(unlockedTrail.engineBorder, 'rgb(255, 207, 90)', 'the tab is the trail gold');
  assert.ok(unlockedTrail.ionGold, 'the Ion engine row itself carries the gold frame');
  await shot('mission-gate-unlocked');

  // Regression: a player who was ALREADY past the gate the first time this device saw them must NOT be
  // told their long-owned gear is "(new)" — that is what a live rollout of the gate looks like for every
  // existing save. `primeShopItemsSeen` adopts what is unlocked at bootstrap as the baseline instead.
  // Simulated with a fresh player id advanced past the factory BEFORE its first page load.
  const pastGate = 'visual-past-gate';
  await page.evaluate(async (pid) => {
    await fetch(`/api/players/${pid}/active-ship`);                                  // register
    for (let i = 0; i < 4; i++) await fetch(`/api/players/${pid}/advance`, { method: 'POST' });
    localStorage.setItem('playerId', pid);
  }, pastGate);
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });
  const primed = await page.evaluate((pid) => ({
    baseline: JSON.parse(localStorage.getItem(`shopSeenNew:${pid}`) || 'null'),
    clicked: JSON.parse(localStorage.getItem(`shopItemsClicked:${pid}`) || 'null'),
    markerShown: document.getElementById('mw-loadout-new').classList.contains('show'),
  }), pastGate);
  // still 3: this fresh player has cleared no side mission, so the two `minMission` rows are locked and are
  // correctly not in the baseline (the gold trail fires for them only once they are earned).
  assert.ok(Array.isArray(primed.baseline) && primed.baseline.length === 3,
    'bootstrap baselines the three already-unlocked gated items as seen');
  assert.ok(Array.isArray(primed.clicked) && primed.clicked.length === 3,
    'the per-item clicked key is baselined with the same three refs');
  assert.ok(!primed.markerShown, 'a player already past the gate on first sight gets no "(new)" marker');
  // …and no gold anywhere in the shop either — the guard now covers the whole trail, not just its first step
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="loadout"]').click());
  await page.waitForFunction('!!document.querySelector("#loadout-panel [data-act=\'open-shop\']")', null, { timeout: 5000 });
  await page.evaluate(() => document.querySelector('#loadout-panel [data-act="open-shop"]').click());
  await page.waitForFunction('!!document.querySelector("#loadout-panel .lp-types")', null, { timeout: 5000 });
  const noGold = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('#loadout-panel .lp-type')];
    let rows = 0;
    for (const tab of tabs) { tab.click(); rows += document.querySelectorAll('#loadout-panel .lp-shop-item.new').length; }
    return { goldTabs: document.querySelectorAll('#loadout-panel .lp-type.new').length, goldRows: rows };
  });
  assert.equal(noGold.goldTabs, 0, 'no type tab is gold for a player who was past the gate on first sight');
  assert.equal(noGold.goldRows, 0, 'and no shop row is gold in any section');
}
