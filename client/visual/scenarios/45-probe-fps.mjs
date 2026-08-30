export const name = '45-probe-fps';
export default async function ({ page, assert, shot, baseURL }) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-takeoff').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => new Promise((res) => {
    let n = 0, t0 = performance.now();
    const tick = () => { if (++n >= 60) return res({ ms: (performance.now() - t0) / 60 }); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }));
  console.log(`      mean frame ${r.ms.toFixed(1)} ms (${(1000 / r.ms).toFixed(1)} fps)`);
  assert.ok(true);
}
