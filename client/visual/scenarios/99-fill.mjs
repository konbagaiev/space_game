// Explosion screen coverage per frame — how much of the screen one ship death paints, and (since the post
// chain landed) whether the graded frame stays readable while it does. The composed frame has real bloom and
// an ACES curve, so the failure mode to guard is a FX retune that turns a blast into a white sheet: the
// glow AREA grows even where the source brightness is right.
export const name = '99-fill';
export default async function ({ page, assert }) {
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-takeoff').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    g.enemies.slice().forEach((e) => g.scene.remove(e.mesh)); g.enemies.length = 0;
    const gl = g.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const grab = () => { const b = new Uint8Array(W*H*4); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,b); return b; };
    const changed = (a,b) => { let n=0; for (let i=0;i<W*H;i++) if (Math.abs(a[i*4]-b[i*4])+Math.abs(a[i*4+1]-b[i*4+1])+Math.abs(a[i*4+2]-b[i*4+2])>8) n++; return n; };
    // Two readability numbers per frame, on the SAME buffer read: how much of it is blown out (all three
    // channels at 250+) and how much is still DARK (luma below 0.25). A frame can be "covered" by an
    // explosion and still read fine; it cannot if it is a white sheet.
    const blownPct = (b) => { let n=0; for (let i=0;i<b.length;i+=4) if (b[i]>=250&&b[i+1]>=250&&b[i+2]>=250) n++; return 100*n/(W*H); };
    const darkPct = (b) => { let n=0; for (let i=0;i<b.length;i+=4) if ((0.2126*b[i]+0.7152*b[i+1]+0.0722*b[i+2])/255 < 0.25) n++; return 100*n/(W*H); };
    let base = null, out = [], blown = [], dark = [], f = 0;
    const tick = () => {
      if (base === null) { base = grab(); g.spawnShipExplosion(g.player.pos.clone(), 0xff8030, 1); }
      else {
        const b = grab();
        out.push(+(100*changed(base, b)/(W*H)).toFixed(1));
        blown.push(+blownPct(b).toFixed(2));
        dark.push(+darkPct(b).toFixed(1));
      }
      if (++f > 14) return resolve({ W, H, cover: out, blown, dark });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  console.log('      screen', r.W+'x'+r.H, '— share of the screen painted by the explosion, per frame:');
  console.log('      ', r.cover.join('%  ') + '%');
  const peakBlown = Math.max(...r.blown);
  const peakIdx = r.blown.indexOf(peakBlown);
  console.log(`      blown-out (all channels 250+) per frame: ${r.blown.join('%  ')}%`);
  console.log(`      still dark (luma < 0.25) per frame:      ${r.dark.join('%  ')}%`);
  // A BLOWN-OUT CEILING and a WASH FLOOR. The retune's rule (D8) is that source brightness goes UP and glow
  // AREA does not: an FX change that clears these is spending its headroom on area, which is the thing that
  // turns a graded frame into a white patch.
  assert.ok(peakBlown < 2, `the peak frame is not blown out (${peakBlown}% of pixels at 250+ on all channels)`);
  assert.ok(r.dark[peakIdx] >= 60,
    `even the brightest frame is still mostly dark space (${r.dark[peakIdx]}% below luma 0.25)`);
}
