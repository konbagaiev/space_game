// Briefing scroll affordance (client/src/scroll-hint.js): a briefing that doesn't fit the panel used to
// end mid-sentence at the edge with no hint it continued — a mobile browser hides the scrollbar until you
// drag, so on a phone the player read half the mission and took off. Two chevrons now sit at the clipped
// edges of #mw-mission-desc: DOWN while there is text below, UP while there is text above, neither when
// the text fits.
// This asserts the affordance the way the player meets it: on a phone viewport, on a real campaign
// briefing, with the chevron actually PAINTED (non-zero opacity, real size, inside the panel) — not merely
// present in the DOM.
export const name = '45-briefing-scroll-hint';

export default async function ({ page, assert, shot }) {
  await page.setViewportSize({ width: 760, height: 360 }); // phone-landscape: the short work zone clips a briefing
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));

  // Land on "Level 2" (advance 2 from a reset) — a real campaign briefing with a granted-item showcase.
  await page.evaluate(async ({ pid }) => {
    await fetch(`/api/players/${pid}/reset`, { method: 'POST' });
    for (let i = 0; i < 2; i++) await fetch(`/api/players/${pid}/advance`, { method: 'POST' });
  }, { pid });
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });
  await page.click('#mw-mission-desc'); // skip the ~5s staged typewriter → the full briefing is in the panel
  await page.waitForFunction('window.__game.briefingStaged === false', null, { timeout: 3000 });
  // Wait for the STATE, then for the fade — the granted-item showcase floats in after its model loads and
  // re-triggers the hint, so a fixed sleep can land mid-transition (opacity .18s).
  const settle = async (cls) => {
    await page.waitForFunction((c) => {
      const h = document.getElementById('mw-mission-scroll');
      return c.every(([name, want]) => h.classList.contains(name) === want);
    }, cls, { timeout: 8000 });
    await page.waitForTimeout(280);
  };
  await settle([['has-more-down', true], ['has-more-up', false]]);

  // Read the panel + both chevrons as the player sees them: painted, sized, and inside the panel's box.
  const read = () => page.evaluate(() => {
    const desc = document.getElementById('mw-mission-desc');
    const host = document.getElementById('mw-mission-scroll');
    const box = desc.getBoundingClientRect();
    const chev = (sel) => {
      const c = host.querySelector(sel);
      if (!c) return null;
      const r = c.getBoundingClientRect(), st = getComputedStyle(c);
      return {
        opacity: parseFloat(st.opacity), w: r.width, h: r.height,
        cx: r.left + r.width / 2, cy: r.top + r.height / 2,
        color: st.borderBottomColor,
      };
    };
    return {
      overflows: desc.scrollHeight > desc.clientHeight + 2,
      scrollH: desc.scrollHeight, clientH: desc.clientHeight,
      atTop: desc.scrollTop <= 2,
      box: { top: box.top, bottom: box.bottom, cx: box.left + box.width / 2 },
      up: chev('.scroll-hint.up'), down: chev('.scroll-hint.down'),
    };
  });

  const a = await read();
  assert.ok(a.overflows,
    `the Level-2 briefing does not fit a 760x360 phone panel (scrollH ${a.scrollH} > clientH ${a.clientH}) — the case this exists for`);
  assert.ok(a.atTop, 'a freshly-shown briefing starts at the top');
  assert.ok(a.down && a.up, 'both chevrons exist in the scroll host');

  // At the top: DOWN is painted, UP is not (it would point at nothing).
  assert.ok(a.down.opacity > 0.3, `at the top the DOWN chevron is painted (opacity ${a.down.opacity})`);
  assert.equal(a.up.opacity, 0, 'at the top the UP chevron stays invisible');
  // It is a real mark on screen, in the panel, near its bottom edge and horizontally centred on it.
  assert.ok(a.down.w >= 8 && a.down.h >= 8, `the DOWN chevron has real size (${a.down.w}x${a.down.h}px)`);
  assert.ok(a.down.cy < a.box.bottom && a.down.cy > a.box.bottom - 40,
    `the DOWN chevron sits at the panel's bottom edge (cy ${Math.round(a.down.cy)}, panel bottom ${Math.round(a.box.bottom)})`);
  assert.ok(Math.abs(a.down.cx - a.box.cx) <= 2, 'the DOWN chevron is centred on the panel');
  // Light on dark: the chevron must contrast with the panel behind it, or it is invisible decoration.
  const rgb = (a.down.color.match(/\d+/g) || []).map(Number);
  assert.ok(rgb.length >= 3 && (rgb[0] + rgb[1] + rgb[2]) / 3 > 140,
    `the chevron is drawn in a light colour against the dark panel (got ${a.down.color})`);
  await shot('phone-briefing-more-below');

  // Scroll to the bottom → the pair swaps: UP appears, DOWN goes out.
  await page.evaluate(() => {
    const d = document.getElementById('mw-mission-desc');
    d.scrollTop = d.scrollHeight;
    d.dispatchEvent(new Event('scroll'));
  });
  await settle([['has-more-up', true], ['has-more-down', false]]);
  const b = await read();
  assert.ok(b.up.opacity > 0.3, `scrolled to the end the UP chevron is painted (opacity ${b.up.opacity})`);
  assert.equal(b.down.opacity, 0, 'at the very end the DOWN chevron goes out — it would point at nothing');
  assert.ok(b.up.cy > b.box.top && b.up.cy < b.box.top + 40,
    `the UP chevron sits at the panel's top edge (cy ${Math.round(b.up.cy)}, panel top ${Math.round(b.box.top)})`);
  await shot('phone-briefing-more-above');

  // Negative: a briefing that FITS shows nothing at all. A desktop viewport gives the same text room.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await settle([['has-more-up', false], ['has-more-down', false]]);
  const c = await read();
  assert.ok(!c.overflows, `at 1440x900 the same briefing fits (scrollH ${c.scrollH} vs clientH ${c.clientH})`);
  assert.equal(c.down.opacity, 0, 'a briefing that fits shows no DOWN chevron');
  assert.equal(c.up.opacity, 0, 'a briefing that fits shows no UP chevron');
  await shot('desktop-briefing-fits-no-hint');
}
