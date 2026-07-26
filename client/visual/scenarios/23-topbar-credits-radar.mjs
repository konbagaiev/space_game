// Top-bar credit balance + mini-map relocation (docs/CHANGELOG 2026-07-26).
//   1. The Main Window top-right shows "<balance> cr." beside the inactive "Ships" label, it tracks the
//      real balance, and (the failure mode this guards) it does NOT collide with the centered wordmark —
//      neither on desktop nor on a phone-landscape viewport, where the wordmark scales with 4.5vw.
//   2. The in-fight radar no longer floats at the vertical center of the left edge: it sits directly
//      under the shield/health bars, left-aligned with them, with a small gap.
export const name = '23-topbar-credits-radar';

const overlaps = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);

export default async function ({ page, assert, shot }) {
  // --- 2. in-fight radar placement (the runner already took off, so the HUD is live) ---
  const radar = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    return { map: r('minimap'), hp: r('hpbar'), pct: r('hppct'), shield: r('shieldbar') };
  });
  assert.ok(radar.map.top > radar.hp.bottom, `radar sits below the health bar (map top ${radar.map.top} > hp bottom ${radar.hp.bottom})`);
  assert.ok(radar.map.top >= radar.pct.bottom, `radar clears the % readout under the bars (map top ${radar.map.top} >= pct bottom ${radar.pct.bottom})`);
  assert.ok(radar.map.top - radar.pct.bottom < 30, `…with only a small gap (got ${Math.round(radar.map.top - radar.pct.bottom)}px)`);
  assert.ok(Math.abs(radar.map.left - radar.hp.left) <= 1, `radar is left-aligned with the bars (map ${radar.map.left} vs hp ${radar.hp.left})`);
  assert.equal(radar.shield.left, radar.hp.left, 'shield + health bars share the left edge (sanity)');
  await shot('radar-under-bars');

  // --- 1. Main Window top bar: credits beside Ships ---
  await page.evaluate(() => window.__game.showMain(null));
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });
  await page.waitForTimeout(150);

  const top = await page.evaluate(() => {
    const val = document.getElementById('mw-credits-val');
    const credits = document.getElementById('mw-credits');
    return {
      text: credits.textContent.replace(/\s+/g, ' ').trim(),
      val: val.textContent,
      balance: String(window.__game.balance),
      shown: getComputedStyle(document.getElementById('mw-topright')).display !== 'none',
      credRect: credits.getBoundingClientRect(),
      shipsRect: document.getElementById('mw-ships').getBoundingClientRect(),
      titleRect: document.getElementById('gametitle').getBoundingClientRect(),
    };
  });
  assert.ok(top.shown, 'the top-right block is visible on the Main Window');
  assert.match(top.text, /^\d+ cr\.$/, `credits read "<n> cr." (got "${top.text}")`);
  assert.equal(top.val, top.balance, 'the readout matches the live credit balance');
  assert.ok(!overlaps(top.credRect, top.shipsRect), 'credits and the Ships label do not overlap');
  assert.ok(!overlaps(top.credRect, top.titleRect), 'credits do not overlap the centered wordmark (desktop)');
  await shot('mainwin-topbar-credits');

  // phone-landscape: the wordmark grows with the viewport — the pair must still clear it
  await page.setViewportSize({ width: 667, height: 375 });
  await page.waitForTimeout(200);
  const narrow = await page.evaluate(() => ({
    credRect: document.getElementById('mw-credits').getBoundingClientRect(),
    shipsRect: document.getElementById('mw-ships').getBoundingClientRect(),
    titleRect: document.getElementById('gametitle').getBoundingClientRect(),
  }));
  assert.ok(!overlaps(narrow.credRect, narrow.titleRect), 'credits clear the wordmark on a phone-landscape viewport');
  assert.ok(!overlaps(narrow.shipsRect, narrow.titleRect), 'the Ships label clears the wordmark on a phone-landscape viewport');
  assert.ok(!overlaps(narrow.credRect, narrow.shipsRect), 'credits and Ships still do not overlap when stacked');
  await shot('mainwin-topbar-narrow');
  await page.setViewportSize({ width: 1280, height: 800 }); // restore for the next scenario
}
