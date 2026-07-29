export const name = '99-fill';
export default async function ({ page, assert }) {
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    g.enemies.slice().forEach((e) => g.scene.remove(e.mesh)); g.enemies.length = 0;
    const gl = g.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const grab = () => { const b = new Uint8Array(W*H*4); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,b); return b; };
    const changed = (a,b) => { let n=0; for (let i=0;i<W*H;i++) if (Math.abs(a[i*4]-b[i*4])+Math.abs(a[i*4+1]-b[i*4+1])+Math.abs(a[i*4+2]-b[i*4+2])>8) n++; return n; };
    let base = null, out = [], f = 0;
    const tick = () => {
      if (base === null) { base = grab(); g.spawnShipExplosion(g.player.mesh.position.clone(), 0xff8030, 1); }
      else { out.push(+(100*changed(base, grab())/(W*H)).toFixed(1)); }
      if (++f > 14) return resolve({ W, H, cover: out });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  console.log('      экран', r.W+'x'+r.H, '— доля экрана, закрашенная взрывом, по кадрам:');
  console.log('      ', r.cover.join('%  ') + '%');
  assert.ok(true);
}
