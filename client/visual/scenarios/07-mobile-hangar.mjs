// Mobile hangar: on a short (landscape) viewport the shop bay makes the hangar taller than the screen,
// so it must SCROLL and the Take-off button must be reachable. Also checks the single touch-only floating
// "Full screen" button is gated to touch menus (body.touch + body.menu). Runs last (it shrinks the viewport).
export const name = '07-mobile-hangar';

export default async function ({ page, assert, shot }) {
  await page.setViewportSize({ width: 760, height: 360 }); // mobile-landscape-ish, short height

  // the shared player is campaign-cleared (scenario 05) → reload lands on the Hangar with the shop bay
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForSelector('#hangar', { state: 'visible', timeout: 5000 });

  // content overflows the short viewport → the hangar scrolls, and Take-off lives below the shop bay
  const m = await page.evaluate(() => {
    const h = document.getElementById('hangar');
    return { scrollable: h.scrollHeight > h.clientHeight + 4, hasGo: !!document.getElementById('hangar-go') };
  });
  assert.ok(m.scrollable, 'the hangar scrolls when content exceeds a short viewport');
  assert.ok(m.hasGo, 'the Take-off button is present');

  // Take-off can be scrolled fully into view (the reported bug: it was clipped / unreachable)
  const inView = await page.evaluate(() => {
    const go = document.getElementById('hangar-go');
    go.scrollIntoView({ block: 'center' });
    const r = go.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });
  assert.ok(inView, 'Take-off scrolls fully into view');
  await shot('mobile-hangar-takeoff');

  // Single floating "Full screen" button: hidden on non-touch; shown on touch menus (the Hangar adds
  // body.menu); hidden once fullscreen (body.fs). It carries the translated words on aria-label/title.
  const fs = await page.evaluate(() => {
    const btn = document.getElementById('fullscreen-btn');
    const disp = () => getComputedStyle(btn).display;
    const hiddenNonTouch = disp() === 'none';
    document.body.classList.add('touch'); // hangar already set body.menu
    const shownOnTouchMenu = disp() !== 'none';
    document.body.classList.add('fs');
    const hiddenWhenFs = disp() === 'none';
    document.body.classList.remove('fs', 'touch');
    return {
      exists: !!btn,
      hiddenNonTouch,
      shownOnTouchMenu,
      hiddenWhenFs,
      label: btn.getAttribute('aria-label'),
      text: btn.textContent.trim(),
    };
  });
  assert.ok(fs.exists, 'a single floating #fullscreen-btn exists');
  assert.ok(fs.hiddenNonTouch, 'the floating Full screen button is hidden on non-touch');
  assert.ok(fs.shownOnTouchMenu, 'it shows on touch menus (body.touch + body.menu)');
  assert.ok(fs.hiddenWhenFs, 'it hides once fullscreen (body.fs)');
  assert.equal(fs.text, '⛶', 'the button is icon-only (⛶ glyph, no words)');
  assert.ok(fs.label && /full screen/i.test(fs.label), 'the words live on aria-label/title');
}
