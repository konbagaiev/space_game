// Engine + thruster item models: every `engine` component shares one menu-only glb and every `thruster`
// component another (catalog_seed.js ENGINE_MODEL / THRUSTER_MODEL), shown in the shop/loadout detail
// panel's #shop-model viewer. The engine glb is SKINNED and carries a looping flame clip, so this also
// guards the AnimationMixer support added to client/src/model-viewer.js — a model with clips must actually
// be clocked (the mixer time advances), and a model without clips must leave the mixer null exactly as
// before. Regression target: a silently frozen flame, or a model that stops resolving for a whole family.
export const name = '96-item-models-engine-thruster';

export default async function ({ page, assert, shot }) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  assert.ok(pid, 'a player id is present');
  // click by selector, failing with the selector name (a bare querySelector(...).click() reports only
  // "cannot read properties of null", which says nothing about WHICH step of the flow broke)
  const click = async (sel) => {
    await page.waitForSelector(sel, { state: 'attached', timeout: 6000 }).catch(() => { throw new Error(`no element for ${sel}`); });
    await page.evaluate((s) => document.querySelector(s).click(), sel);
  };

  // unlock the shop (clear the campaign), then land on the Main Window
  await page.evaluate(async (pid) => {
    for (let i = 0; i < 4; i++) await fetch(`/api/players/${pid}/advance`, { method: 'POST' });
  }, pid);
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });

  // every engine/thruster in the served catalog carries the family model (the seed wires all 14, including
  // the enemy-only ones that never reach the shop — assert on the catalog, not just the two we click)
  const families = await page.evaluate(async () => {
    const all = await fetch('/api/components').then((r) => r.json());
    const rows = all.filter((c) => c.type === 'engine' || c.type === 'thruster');
    const urls = (type) => [...new Set(rows.filter((c) => c.type === type).map((c) => c.modelUrlHigh || null))];
    return { engines: urls('engine'), thrusters: urls('thruster'), counts: { engine: rows.filter((c) => c.type === 'engine').length, thruster: rows.filter((c) => c.type === 'thruster').length } };
  });
  assert.equal(families.counts.engine, 7, 'the catalog still has 7 engine components');
  assert.equal(families.counts.thruster, 7, 'the catalog still has 7 thruster components');
  assert.equal(families.engines.length, 1, 'every engine shares exactly one model url (no unwired engine)');
  assert.equal(families.thrusters.length, 1, 'every thruster shares exactly one model url (no unwired thruster)');
  assert.match(families.engines[0] || '', /maneuver_thruster_hangar\./, 'engines use the animated nozzle glb');
  assert.match(families.thrusters[0] || '', /engine_thruster_hangar\./, 'thrusters use the turbine glb');

  // open Loadout → a slot → the shop panel
  await click('.mw-item[data-mw="loadout"]');
  await page.waitForFunction('document.querySelectorAll("#loadout-slots .slot-chip").length >= 6', null, { timeout: 5000 });
  await click('.slot-chip[data-slot="gun"]');
  await click('#loadout-panel [data-act="open-shop"]');
  await page.waitForSelector('#loadout-panel .lp-type[data-type="engine"]', { state: 'attached', timeout: 5000 });

  // Open a shop type tab and click its first item card → the detail card spins that item's glb.
  // The detail card REPLACES the type tabs + list, so step back to the list first when one is already open.
  const openFirstItemOfType = async (type) => {
    if (await page.evaluate(() => !!document.querySelector('#loadout-panel [data-act="shop-list"]'))) {
      await click('#loadout-panel [data-act="shop-list"]');
      await page.waitForTimeout(60);
    }
    await click(`#loadout-panel .lp-type[data-type="${type}"]`);
    await page.waitForTimeout(80);
    await page.waitForFunction('!!document.querySelector("#loadout-panel .lp-shop-item[data-act=\'shop-item\']")', null, { timeout: 4000 });
    const name = await page.evaluate(() => {
      const card = document.querySelector('#loadout-panel .lp-shop-item[data-act="shop-item"]');
      card.click();
      return (card.querySelector('.lp-name') || card).textContent.trim();
    });
    // gate on the glb actually being PARSED — the url is set synchronously, so waiting on it alone would
    // race the CloudFront fetch and make every mixer assertion below meaningless
    await page.waitForFunction('!!window.__game.shopItemLoaded', null, { timeout: 20000 });
    return name;
  };

  // --- thruster: static glb → shown, and the mixer stays null (unchanged behaviour for clip-less models)
  const thrusterName = await openFirstItemOfType('thruster');
  assert.match(await page.evaluate(() => window.__game.shopItemTarget), /engine_thruster_hangar\./,
    `the shop detail for "${thrusterName}" spins the turbine model`);
  assert.equal(await page.evaluate(() => window.__game.shopItemClipTime), null,
    'the turbine glb has no animation clip → no mixer is created (clip-less models behave exactly as before)');
  await page.waitForTimeout(400);
  await shot('thruster-model');

  // --- engine: skinned + animated glb, laid on its side by `pitch` → shown AND actually clocked
  const engineName = await openFirstItemOfType('engine');
  assert.match(await page.evaluate(() => window.__game.shopItemTarget), /maneuver_thruster_hangar\./,
    `the shop detail for "${engineName}" spins the animated nozzle model`);
  const t0 = await page.evaluate(() => window.__game.shopItemClipTime);
  assert.ok(typeof t0 === 'number', 'the engine glb carries an animation clip → a mixer drives it');
  await page.waitForTimeout(600);
  const t1 = await page.evaluate(() => window.__game.shopItemClipTime);
  assert.ok(t1 > t0, `the flame animation is running (mixer clock advanced ${t0.toFixed(2)}s → ${t1.toFixed(2)}s), not frozen in its bind pose`);
  await shot('engine-model-animated');

  // swapping back to a clip-less item must drop the mixer with the outgoing model (no stale clock)
  await click('#loadout-panel [data-act="shop-list"]');
  await page.waitForTimeout(60);
  await openFirstItemOfType('thruster');
  assert.equal(await page.evaluate(() => window.__game.shopItemClipTime), null,
    'switching from the animated engine back to a static thruster clears the mixer');
}
