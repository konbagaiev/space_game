// Mobile landscape (docs/plans/mobile-landscape-and-fullscreen-button.md):
//   When a touch phone is held in PORTRAIT the whole <body> is rotated 90° (class `rot`) so the game
//   plays in landscape — the browser can't widen its viewport past the screen and orientation.lock is
//   unsupported on iOS Safari, so a CSS rotation is the only cross-browser way.
// This runner's context is NOT a touch device (isTouch=false → applyOrientation won't auto-rotate), so we
// assert the rotation GEOMETRY directly by toggling `body.rot` on a portrait viewport: the rotated body
// must still cover the whole screen, and its layout box must be landscape (wider than tall). The real
// touch+portrait render is eyeballed separately (a touch-emulated Playwright context).
export const name = '15-mobile-landscape';

export default async function ({ page, assert, shot }) {
  await page.setViewportSize({ width: 390, height: 844 }); // a phone in portrait

  const geo = await page.evaluate(() => {
    const noCover = !document.getElementById('rotate-cover'); // the old rotate-to-landscape cover is gone
    document.body.classList.add('rot');
    const b = document.body.getBoundingClientRect();          // on-screen AABB of the rotated body
    const r = {
      noCover,
      // layout box (ignores the transform) is landscape: width 100vh, height 100vw
      layoutLandscape: document.body.offsetWidth > document.body.offsetHeight,
      // the rotated body still fills the portrait viewport (no black gaps)
      coversViewport: b.left <= 1 && b.top <= 1 && b.right >= window.innerWidth - 1 && b.bottom >= window.innerHeight - 1,
    };
    document.body.classList.remove('rot');
    return r;
  });
  assert.ok(geo.noCover, 'the old rotate-to-landscape cover element is removed');
  assert.ok(geo.layoutLandscape, 'rotated body lays out in landscape (wider than tall)');
  assert.ok(geo.coversViewport, 'rotated body still covers the whole portrait viewport');
  await shot('portrait-rotated-geometry');

  // --- Full-screen button: available in-game (not just menus), hidden when fullscreen, and body.fs
  //     re-syncs on foreground (DECISIONS §44 / this plan). ---
  const fsBtn = await page.evaluate(() => {
    const body = document.body;
    const btn = document.getElementById('fullscreen-btn');
    const rocket = document.getElementById('rocket-btn');
    const disp = () => getComputedStyle(btn).display;
    // simulate an in-game touch device: touch on, not a menu, not fullscreen, FS API present
    body.classList.add('touch');
    body.classList.remove('menu', 'fs', 'no-fs-api', 'standalone');
    const shownInGame = disp() !== 'none';
    const bRect = btn.getBoundingClientRect();
    const rRect = rocket.getBoundingClientRect();
    // ⛶ sits to the LEFT of the rocket with a gap (no overlap)
    const leftOfRocketWithGap = bRect.right < rRect.left;
    // on a menu it still shows (bottom-right)
    body.classList.add('menu');
    const shownOnMenu = disp() !== 'none';
    body.classList.remove('menu');
    // hidden once fullscreen
    body.classList.add('fs');
    const hiddenWhenFs = disp() === 'none';
    // stale-fs fix: with body.fs set but no real fullscreenElement, a foreground visibilitychange must
    // clear body.fs (syncFsClass toggles off since document.fullscreenElement is null in this context)
    document.dispatchEvent(new Event('visibilitychange'));
    const fsClearedOnForeground = !body.classList.contains('fs');
    // no-fs-api (iPhone): ⛶ hidden, a2hs pill shown in-game
    body.classList.remove('fs');
    body.classList.add('no-fs-api');
    const hiddenNoFsApi = disp() === 'none';
    const a2hsShownInGame = getComputedStyle(document.getElementById('a2hs-hint')).display !== 'none';
    // cleanup
    body.classList.remove('touch', 'no-fs-api');
    return { shownInGame, leftOfRocketWithGap, shownOnMenu, hiddenWhenFs, fsClearedOnForeground, hiddenNoFsApi, a2hsShownInGame };
  });
  assert.ok(fsBtn.shownInGame, 'fullscreen button shows in-game on touch (not just menus)');
  assert.ok(fsBtn.leftOfRocketWithGap, 'in-game fullscreen button sits left of the rocket, no overlap');
  assert.ok(fsBtn.shownOnMenu, 'fullscreen button still shows on touch menus');
  assert.ok(fsBtn.hiddenWhenFs, 'fullscreen button hides once fullscreen (body.fs)');
  assert.ok(fsBtn.fsClearedOnForeground, 'body.fs is re-synced (cleared) when the page returns to foreground');
  assert.ok(fsBtn.hiddenNoFsApi, 'no-fs-api hides the ⛶ button');
  assert.ok(fsBtn.a2hsShownInGame, 'no-fs-api shows the Add-to-Home-Screen pill in-game');
}
