// Mobile Main Window: on a short (landscape) viewport the redesigned Main Window is a fixed full-height
// grid — left menu | work zone | ship-model preview — so nothing relies on page scroll and the Take-off
// button is on-screen without scrolling. Also checks the single touch-only floating "Full screen" button
// is gated to touch menus (body.touch + body.menu). Runs late (it shrinks the viewport).
export const name = '07-mobile-hangar';

export default async function ({ page, assert, shot }) {
  await page.setViewportSize({ width: 760, height: 360 }); // mobile-landscape-ish, short height

  // the shared player is campaign-cleared (scenario 05) → reload lands on the Main Window
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });

  // the 3-column grid lays out left→right: menu, work zone, ship preview — and Take-off is on-screen
  const m = await page.evaluate(() => {
    const main = document.getElementById('mainwin');
    const menu = document.getElementById('mw-menu').getBoundingClientRect();
    const work = document.getElementById('mw-work').getBoundingClientRect();
    const ship = document.getElementById('mw-ship-col').getBoundingClientRect();
    const go = document.getElementById('mw-go').getBoundingClientRect();
    return {
      isGrid: getComputedStyle(main).display === 'grid',
      ordered: menu.left < work.left && work.left < ship.left,
      shipQuarter: ship.width / window.innerWidth, // ~25%
      goInView: go.top >= 0 && go.bottom <= window.innerHeight && go.width > 0,
    };
  });
  assert.ok(m.isGrid, 'the Main Window is a fixed grid (no page-scroll column)');
  assert.ok(m.ordered, 'columns are laid out left→right: menu, work zone, ship preview');
  assert.ok(m.shipQuarter > 0.18 && m.shipQuarter < 0.32, 'the ship-model column is ~25% of the width');
  assert.ok(m.goInView, 'the Take-off button is on-screen without scrolling');
  await shot('mobile-main-window');

  // Only the mission description scrolls (not the whole frame): it has its own overflow.
  const descScrolls = await page.evaluate(() => getComputedStyle(document.getElementById('mw-mission-desc')).overflowY === 'auto');
  assert.ok(descScrolls, 'the mission description is the independent scroller');

  // Single floating "Full screen" button: hidden on non-touch; shown on touch menus (the Main Window adds
  // body.menu); hidden once fullscreen (body.fs). It carries the translated words on aria-label/title.
  const fs = await page.evaluate(() => {
    const btn = document.getElementById('fullscreen-btn');
    const disp = () => getComputedStyle(btn).display;
    const hiddenNonTouch = disp() === 'none';
    document.body.classList.add('touch'); // the Main Window already set body.menu
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
