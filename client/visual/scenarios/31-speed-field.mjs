// Player-locked speed field (the parallax backdrop): a fixed pool of point sprites in 3 depth layers that is
// re-wrapped into a ±radius box around the PLAYER every frame from settleView (client/src/world.js
// updateSpeedField + the pure math in src/speed-field.js).
//
// THE OUTCOME TEST. speed-field.test.js only proves the helpers are self-consistent; wiring the wrap to the
// CAMERA instead of the player, wrapping x but not z, calling it before the camera is placed, or forgetting
// the settleView line entirely would leave every unit test green and still leave the player flying through
// empty space once they roam. So: teleport 4000 units out and assert the field is STILL centred on the ship,
// on both axes, with the pool size and the layer depths untouched.
//
// THREE objects can't cross the Playwright boundary — every read and every max/compare happens inside
// page.evaluate and only plain numbers/arrays come back (see 08-arena-boundaries.mjs).
export const name = '31-speed-field';

const FAR_X = 4000, FAR_Z = -4000;
// Float32 storage rounds the wrapped coordinate, so |d| can land a fraction past `half`. Way below the 26-unit
// camera z-offset a camera-centred wrap would show.
const EPS = 0.01;

export default async function ({ page, assert, shot }) {
  // Launch from whichever menu is up (a prior scenario may have advanced progress).
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(300);

  // The layers exist and are sane: a positive wrap half-box and a non-empty xyz buffer each.
  const before = await page.evaluate(() => {
    const L = window.__game.speedFieldLayers;
    return L.map((l) => ({
      half: l.half,
      len: l.pos.length,
      inScene: window.__game.scene.children.includes(l.points),
      y: Array.from(l.pos).filter((_, i) => i % 3 === 1), // the depth column — the wrap must never touch it
    }));
  });
  assert.ok(before.length >= 1, 'the speed field built at least one depth layer');
  for (const [i, l] of before.entries()) {
    assert.ok(l.half > 0, `layer ${i}: a positive wrap half-box`);
    assert.ok(l.len > 0 && l.len % 3 === 0, `layer ${i}: a non-empty xyz position buffer (${l.len})`);
    assert.ok(l.inScene, `layer ${i}: its Points object is in the combat scene`);
  }

  // Roam far out of the arena — the whole point of the feature (the old ring was anchored to the origin, so
  // out here the player flew through empty space).
  await page.evaluate(([x, z]) => {
    const g = window.__game;
    g.player.mesh.position.set(x, 0.6, z);
    g.player.vel.set(0, 0, 0);
  }, [FAR_X, FAR_Z]);
  // Wait for the VIEW to settle on the new position instead of a fixed sleep: the camera follow and the
  // field wrap happen in the same settleView() call, and under software WebGL a frame can take a few hundred
  // ms, so a short timeout would read the field before a single frame had run.
  await page.waitForFunction(([x, z]) => {
    const c = window.__game.camera.position;
    return Math.abs(c.x - x) < 50 && Math.abs(c.z - z) < 50;
  }, [FAR_X, FAR_Z], { timeout: 8000 });

  const after = await page.evaluate(() => {
    const g = window.__game;
    const px = g.player.mesh.position.x, pz = g.player.mesh.position.z;
    return {
      px, pz,
      layers: g.speedFieldLayers.map((l) => {
        let maxDx = 0, maxDz = 0;
        for (let i = 0; i < l.pos.length; i += 3) {
          const dx = Math.abs(l.pos[i] - px), dz = Math.abs(l.pos[i + 2] - pz);
          if (dx > maxDx) maxDx = dx;
          if (dz > maxDz) maxDz = dz;
        }
        return { half: l.half, len: l.pos.length, maxDx, maxDz, y: Array.from(l.pos).filter((_, i) => i % 3 === 1) };
      }),
    };
  });

  assert.ok(Math.abs(after.px - FAR_X) < 5 && Math.abs(after.pz - FAR_Z) < 5, 'the ship really is 4000 units out');
  assert.equal(after.layers.length, before.length, 'the same layers — roaming builds nothing new');
  for (const [i, l] of after.layers.entries()) {
    // x AND z: the z bound catches a camera-centred wrap (the camera sits +26 z from the player, so a
    // camera-centred box pushes points to half+26 and with ~900 points that band is reliably populated); the
    // x bound catches "wrapped z only"; either catches a missing settleView call (points ~4000 away).
    assert.ok(l.maxDx <= l.half + EPS, `layer ${i}: every point is within ±${l.half} of the ship on x (max ${l.maxDx.toFixed(2)})`);
    assert.ok(l.maxDz <= l.half + EPS, `layer ${i}: every point is within ±${l.half} of the ship on z (max ${l.maxDz.toFixed(2)})`);
    assert.equal(l.len, before[i].len, `layer ${i}: a FIXED pool — roaming allocates and frees nothing`);
    assert.deepEqual(l.y, before[i].y, `layer ${i}: the depth column is untouched (the wrap is XZ-only)`);
  }

  await shot('speed-field-far');
}
