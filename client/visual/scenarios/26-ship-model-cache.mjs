// Ship models are fetched + parsed ONCE and every spawn is a clone (ship-factory.js shipModelCache).
// Before the cache, `applyShipModel` re-ran the whole GLTFLoader pipeline per spawn — new geometry, a
// fresh texture decode + GPU upload, one VRAM copy per enemy — which stalled the frame at each spawn on
// weak devices and often left an enemy flying as the placeholder primitive until its glb finally landed.
//
// The load-bearing assertion is GEOMETRY IDENTITY: two enemies of the same type must share the very same
// BufferGeometry instance. On the old code each parse produced its own, so this fails.
export const name = '26-ship-model-cache';

export default async function ({ page, assert }) {
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-takeoff').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(300);

  // Clear the wave, then spawn two of the SAME type and one of a different type.
  await page.evaluate(() => {
    const g = window.__game;
    g.enemies.slice().forEach((e) => g.scene.remove(e.mesh));
    g.enemies.length = 0;
    g.spawnEnemy('fighter');
    g.spawnEnemy('fighter');
    g.spawnEnemy('rocketeer');
  });

  // Wait for all three to have swapped their placeholder for a model (mesh count > 1 per ship).
  await page.waitForFunction(() => {
    const g = window.__game;
    if (!g || g.enemies.length < 3) return false;
    return g.enemies.every((e) => { let n = 0; e.mesh.traverse((x) => { if (x.isMesh) n++; }); return n > 1; });
  }, null, { timeout: 30000 });

  const r = await page.evaluate(() => {
    const g = window.__game;
    const geoIds = (e) => { const out = []; e.mesh.traverse((x) => { if (x.isMesh) out.push(x.geometry.uuid); }); return out.sort(); };
    const matIds = (e) => { const out = new Set(); e.mesh.traverse((x) => { if (x.isMesh) out.add(x.material.uuid); }); return [...out].sort(); };
    const [a, b, c] = g.enemies;
    return {
      parsed: g.shipModelsParsed,
      sameTypeGeo: JSON.stringify(geoIds(a)) === JSON.stringify(geoIds(b)),
      sameTypeMat: JSON.stringify(matIds(a)) === JSON.stringify(matIds(b)),
      otherTypeGeo: JSON.stringify(geoIds(a)) === JSON.stringify(geoIds(c)),
      distinctObjects: a.mesh !== b.mesh,
      names: [a.name, b.name, c.name],
    };
  });

  // Two ships of one type reuse the same GPU resources...
  assert.ok(r.sameTypeGeo, `two ${r.names[0]} share one geometry set (got different ones — the model was re-parsed per spawn)`);
  assert.ok(r.sameTypeMat, 'two ships of the same type share their materials (one GPU copy per type)');
  // ...but are still independent scene objects, and a DIFFERENT ship type keeps its own model.
  assert.ok(r.distinctObjects, 'each ship is still its own scene object (clone, not the same node reused)');
  assert.ok(!r.otherTypeGeo, 'a different ship type does not accidentally share the first type\'s geometry');

  // The cache holds one entry per distinct glb, never one per spawn. The level preload
  // (preloadLevelShipModels) may have warmed more types than the three spawned here, so this is an upper
  // bound on ship TYPES, not on spawns — the point is that 3 spawns did not make 3 entries appear.
  assert.ok(r.parsed >= 2 && r.parsed <= 12, `ship glbs parsed is a small per-TYPE count (got ${r.parsed})`);
}
