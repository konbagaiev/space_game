// Mobile hangar: on a short (landscape) viewport the shop bay makes the hangar taller than the screen,
// so it must SCROLL and the Take-off button must be reachable. Also checks the touch-only "Full screen"
// buttons exist and are gated to touch devices (body.touch). Runs last (it shrinks the viewport).
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

  // "Full screen" buttons: present on welcome + hangar + pause overlay + settings overlay, touch-only
  // (hidden unless body.touch)
  const fs = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.fullscreen-btn.touch-only')];
    const hiddenNonTouch = btns.every((b) => getComputedStyle(b).display === 'none');
    document.body.classList.add('touch');
    const revealedOnTouch = btns.every((b) => getComputedStyle(b).display !== 'none');
    document.body.classList.remove('touch');
    return { count: btns.length, hiddenNonTouch, revealedOnTouch };
  });
  assert.equal(fs.count, 4, 'Full screen buttons on welcome + hangar + pause overlay + settings overlay');
  assert.ok(fs.hiddenNonTouch, 'Full screen buttons are hidden on non-touch');
  assert.ok(fs.revealedOnTouch, 'Full screen buttons show under body.touch');
}
