// Sell confirmation + quantity (docs/plans/2026-08-09-sell-confirm-quantity.md): clicking Sell on a stash
// item opens a confirm dialog showing the sale price; when the stash holds more than one, a slider + number
// choose how many to sell and the total updates live. Confirm sells N and banks N × 75% of price.
export const name = '12-sell-confirm';

export default async function ({ page, assert, shot }) {
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  assert.ok(pid, 'a player id is present');

  // Unlock the shop (clear the campaign) and stock 3× Light hull (component 2, price 150) in the stash.
  await page.evaluate(async (pid) => {
    for (let i = 0; i < 4; i++) await fetch(`/api/players/${pid}/advance`, { method: 'POST' });
    for (let i = 0; i < 3; i++) await fetch(`/api/players/${pid}/buy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'component', refId: 2 }) });
  }, pid);

  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });

  // Loadout → hull slot → pick the Light hull stash row → Sell
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="loadout"]').click());
  await page.waitForSelector('.slot-chip[data-slot="hull"]', { state: 'attached', timeout: 5000 });
  await page.evaluate(() => document.querySelector('.slot-chip[data-slot="hull"]').click());
  await page.waitForSelector('#loadout-panel .lp-row[data-act="pick-stash"][data-ref-id="2"]', { state: 'attached', timeout: 5000 });
  await page.evaluate(() => document.querySelector('#loadout-panel .lp-row[data-act="pick-stash"][data-ref-id="2"]').click());
  await page.waitForSelector('#loadout-panel .lp-item [data-act="sell"]', { state: 'attached', timeout: 5000 });
  const creditsBefore = await page.evaluate(() => window.__game.activeShip.credits);
  await page.evaluate(() => document.querySelector('#loadout-panel .lp-item [data-act="sell"]').click());

  // the confirm dialog is up: qty controls shown (stash > 1), default qty 1 → total = floor(150*0.75) = 112
  await page.waitForFunction('document.getElementById("sell-overlay").classList.contains("on")', null, { timeout: 3000 });
  const opened = await page.evaluate(() => ({
    qtyRowShown: getComputedStyle(document.getElementById('sell-qty-row')).display !== 'none',
    rangeMax: document.getElementById('sell-qty-range').max,
    total: document.getElementById('sell-total-val').textContent,
  }));
  assert.ok(opened.qtyRowShown, 'the quantity row is shown when the stash holds more than one');
  assert.equal(opened.rangeMax, '3', 'the quantity is capped at the owned count');
  assert.ok(/112/.test(opened.total), `default total is one unit's resale (112), got "${opened.total}"`);
  await shot('sell-confirm');

  // drag the slider to 3 → the live total becomes 3 × 112 = 336
  await page.evaluate(() => { const r = document.getElementById('sell-qty-range'); r.value = '3'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  const total3 = await page.evaluate(() => document.getElementById('sell-total-val').textContent);
  assert.ok(/336/.test(total3), `selling 3 shows 336, got "${total3}"`);
  assert.equal(await page.evaluate(() => document.getElementById('sell-qty-num').value), '3', 'the number field mirrors the slider');
  await shot('sell-qty-3');

  // confirm → dialog closes, all 3 sold (row gone), credits += 336
  await page.evaluate(() => document.getElementById('sell-do').click());
  await page.waitForFunction('!document.getElementById("sell-overlay").classList.contains("on")', null, { timeout: 3000 });
  await page.waitForFunction(`window.__game.activeShip.credits === ${creditsBefore + 336}`, null, { timeout: 5000 });
  const gone = await page.evaluate(() => !document.querySelector('#loadout-panel .lp-row[data-act="pick-stash"][data-ref-id="2"]'));
  assert.ok(gone, 'the fully-sold item left the stash');
}
