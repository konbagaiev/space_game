// Rocket smoke trail is drawn as ONE instanced call, and every puff keeps its OWN fade.
//
// Before this, each puff was a mesh with its own material — a rocket in flight added 25-30 draw calls
// (reported from the field, the biggest per-event cost we found). The pool fixes that, but the failure
// mode it invites is subtler than the draw count: instances share one material, so a naive port would
// fade `material.opacity` and the whole trail would blink out in unison instead of the tail dissolving
// while the head is still dense. Hence the load-bearing assertion here is on the SPREAD of per-instance
// alphas, not on the draw call.
export const name = '27-smoke-instancing';

export default async function ({ page, assert, shot }) {
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(400);

  // Fire a rocket at a lone, un-killable enemy straight ahead so it flies (and smokes) for the whole window.
  await page.evaluate(() => {
    const g = window.__game, V = g.player.mesh.position.constructor;
    g.enemies.slice().forEach((e) => g.scene.remove(e.mesh));
    g.enemies.length = 0;
    g.smoke.length = 0;
    const base = g.player.mesh.position.clone();
    const fwd = new V(0, 0, 1);
    const enemy = g.spawnEnemy('fighter');
    enemy.mesh.position.copy(base).add(new V(0, 0, 90)); // far enough that the rocket flies a while
    enemy.warping = false; enemy.spawnAge = enemy.spawnDur;
    enemy.hp = enemy.maxHp = 9999;
    const w = g.catalog.weapons.get(10) || g.catalog.weapons.get(11); // any rocket weapon
    g.spawnRocket(base.clone().add(new V(0, 0, 2)), fwd, w, w.accel, true, enemy);
  });
  await page.waitForTimeout(2500); // let a trail build and start ageing (headless runs at ~6 fps)

  const r = await page.evaluate(() => {
    const g = window.__game, pool = g.smokePool;
    const a = pool.mesh.geometry.getAttribute('aAlpha').array;
    const live = [...a].slice(0, pool.count);
    return {
      puffs: g.smoke.length,
      poolCount: pool.count,
      capacity: pool.capacity,
      // one InstancedMesh in the scene regardless of how many puffs are alive
      meshesInScene: (() => { let n = 0; g.scene.traverse((o) => { if (o.isInstancedMesh && o.geometry === pool.mesh.geometry) n++; }); return n; })(),
      alphaPatched: pool.alphaPatched, // the shader really uses aAlpha (a silent miss would fake-pass the spread check)
      distinctAlphas: new Set(live.map((v) => v.toFixed(2))).size,
      minA: live.length ? Math.min(...live) : null,
      maxA: live.length ? Math.max(...live) : null,
    };
  });
  await shot('trail');

  assert.ok(r.puffs > 3, `the rocket left a trail (got ${r.puffs} puffs)`);
  assert.equal(r.poolCount, r.puffs, 'every live puff is an instance in the pool');
  assert.ok(r.puffs <= r.capacity, 'the live count stays inside the pool capacity');
  assert.equal(r.meshesInScene, 1, 'the whole trail is ONE instanced mesh in the scene, not one per puff');

  // Writing per-instance alphas is worthless if the shader ignores them, and reading the attribute back
  // cannot tell the difference — so assert the patch itself landed.
  assert.ok(r.alphaPatched, 'the per-instance alpha shader patch compiled in (three.js chunk names still match)');

  // The regression guard: a shared-opacity port would give every instance the same alpha.
  assert.ok(r.distinctAlphas > 2,
    `puffs fade independently (got ${r.distinctAlphas} distinct alphas across ${r.poolCount} puffs — a shared material opacity would give 1)`);
  assert.ok(r.maxA - r.minA > 0.15,
    `the trail has a real fade gradient head-to-tail (spread ${(r.maxA - r.minA).toFixed(2)})`);

  // PIXEL PROOF. The checks above read back the alpha attribute, which cannot tell whether the SHADER
  // honours it — a failed patch would leave the array full of varying numbers that nothing consumes. So
  // render the same puff at three alphas and compare whole frames against an empty pool.
  //
  // Measure summed BRIGHTNESS difference, not the count of changed pixels: coverage is identical for any
  // non-zero alpha (the puff occupies the same area), so a pixel count cannot tell a=1 from a=0.05 — it was
  // the first metric tried here and it reported them as identical. Intensity is what alpha actually drives.
  const px = await page.evaluate(() => {
    const g = window.__game, pool = g.smokePool;
    const V = g.player.mesh.position.constructor;
    g.smoke.length = 0;                                    // stop the sim loop refilling the pool
    const pos = g.player.mesh.position.clone().add(new V(14, 0, 0));
    const gl = g.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const frame = (a) => {
      pool.begin();
      if (a !== null) pool.push(pos, 4, a);
      pool.end();
      // Reproduce the game's real frame: it manages clears itself (autoClear off) and draws sky then
      // combat. Rendering `scene` alone would composite ON TOP of the previous frame, so every sample
      // would differ from every other and the comparison would be meaningless.
      g.renderer.clear();
      g.renderer.render(g.skyScene, g.camera);
      g.renderer.clearDepth();
      g.renderer.render(g.scene, g.camera);
      const b = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
      return b;
    };
    // Gate at 8/pixel so sub-1 rounding differences can't accumulate into a false signal across a million
    // pixels; above the gate it is the puff and nothing else.
    const sumDiff = (x, y) => {
      let s = 0;
      for (let i = 0; i < W * H; i++) {
        const d = Math.abs(x[i*4] - y[i*4]) + Math.abs(x[i*4+1] - y[i*4+1]) + Math.abs(x[i*4+2] - y[i*4+2]);
        if (d > 8) s += d;
      }
      return s;
    };
    const none = frame(null);
    const opaque = sumDiff(none, frame(1.0));
    const faint = sumDiff(none, frame(0.05));
    const zero = sumDiff(none, frame(0));
    pool.begin(); pool.end();                              // leave the pool empty
    return { opaque, faint, zero };
  });
  assert.equal(px.zero, 0, 'a puff at alpha 0 draws nothing at all — the attribute really reaches the shader');
  assert.ok(px.opaque > 20000, `an instanced puff actually draws (gated frame delta ${px.opaque})`);
  assert.ok(px.faint * 3 < px.opaque,
    `per-instance alpha modulates the PIXELS, not just the buffer: a=0.05 must be far dimmer than a=1 (${px.faint} vs ${px.opaque}, noise ${px.zero})`);
}
