// Mobile landscape enforcement (docs/plans/mobile-landscape-and-fullscreen-button.md):
//   - the #rotate-cover fills the screen on a touch device held in PORTRAIT, and is gone in landscape;
//   - it never shows on a non-touch device (no body.touch);
//   - the floating #fullscreen-btn is gated to menus, so during a live fight it's hidden and can't
//     overlap the bottom-right rocket button.
// NOTE: auto-pause-on-portrait is NOT asserted here — it gates on `isTouch`, computed once at page load
// from pointer/touch support, which headless Chromium doesn't emulate in this runner. It mirrors the
// existing autoPauseOnBlur (also not auto-tested); the rotate cover (below) is the user-visible guarantee.
export const name = '15-mobile-landscape';

export default async function ({ page, assert, shot }) {
  // The shared player is campaign-cleared (scenario 05), so a reload may land on the Hangar and the
  // runner's auto-takeoff (welcome only) won't have fired — launch from whichever menu is up.
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('hangar')) document.getElementById('hangar-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(400); // let the fight start (the rocket button is only shown in combat)
  // Mark the device as touch (the gate the feature uses).
  await page.evaluate(() => document.body.classList.add('touch'));

  // --- landscape: no cover, rocket button visible, floating fullscreen hidden (it's gated to menus) ---
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(50);
  const land = await page.evaluate(() => {
    const disp = (id) => getComputedStyle(document.getElementById(id)).display;
    return { cover: disp('rotate-cover'), rocket: disp('rocket-btn'), fs: disp('fullscreen-btn') };
  });
  assert.equal(land.cover, 'none', 'rotate cover is hidden in landscape');
  assert.notEqual(land.rocket, 'none', 'the rocket button is visible during a fight');
  assert.equal(land.fs, 'none', 'the floating fullscreen button is hidden during a fight (no rocket overlap)');
  await shot('landscape');

  // --- portrait: the rotate cover fills the whole screen ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(50);
  const port = await page.evaluate(() => {
    const c = document.getElementById('rotate-cover');
    const r = c.getBoundingClientRect();
    return {
      display: getComputedStyle(c).display,
      coversScreen: r.left <= 0 && r.top <= 0 && r.right >= window.innerWidth && r.bottom >= window.innerHeight,
      hasIcon: !!c.querySelector('.rotate-icon'),
    };
  });
  assert.notEqual(port.display, 'none', 'rotate cover is shown in portrait on touch');
  assert.ok(port.coversScreen, 'rotate cover fills the screen');
  assert.ok(port.hasIcon, 'rotate cover shows its rotate icon');
  await shot('portrait-cover');

  // --- non-touch: the cover never shows, even in portrait ---
  const nonTouch = await page.evaluate(() => {
    document.body.classList.remove('touch');
    const d = getComputedStyle(document.getElementById('rotate-cover')).display;
    document.body.classList.add('touch'); // restore for any later scenario sharing the page
    return d;
  });
  assert.equal(nonTouch, 'none', 'rotate cover never shows on a non-touch device');

  // leave the viewport/body as a neutral desktop-ish state for subsequent scenarios
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => document.body.classList.remove('touch'));
}
