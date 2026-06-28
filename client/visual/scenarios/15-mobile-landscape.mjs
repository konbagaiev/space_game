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
}
