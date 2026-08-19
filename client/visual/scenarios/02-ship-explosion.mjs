// Ship-destruction burst: a flipbook (sprite-sheet) fireball + a soft expanding shockwave ring, sized by
// the ship — the old CPU spark spray is GONE (DECISIONS §75). The ring is tinted by the engine's exhaust
// color and now a baked ring TEXTURE on an additive quad (not a hard RingGeometry). Asserts the surviving
// construction (no sparks; ring scale ratio + textured ring) rather than pixels, then saves a frame.
export const name = '02-ship-explosion';

export default async function ({ page, assert, shot }) {
  const data = await page.evaluate(() => {
    const g = window.__game;
    const V = g.player.pos.constructor; // sim-core Vec3
    const base = g.player.pos;
    const before = { sp: g.sparks.length, sw: g.shockwaves.length };
    const playerExhaust = g.player.engine.exhaust.color;
    const medium = g.catalog.enemyShips.find((s) => s.stats.role === 'medium');
    const heavyExhaust = g.catalog.components.get(medium.components.engine).stats.exhaust.color;
    // left: player engine exhaust, size 1 — right: heavy enemy exhaust, size 2
    g.spawnShipExplosion(new V(base.x - 40, 0.6, base.z - 22), playerExhaust, 1);
    g.spawnShipExplosion(new V(base.x + 40, 0.6, base.z - 22), heavyExhaust, 2);
    const added = g.shockwaves.slice(before.sw);
    return {
      addedSparks: g.sparks.length - before.sp,
      shockwaveScales: added.map((w) => w.maxScale).sort((a, b) => a - b),
      ringsTextured: added.every((w) => !!w.mesh.material.map), // soft baked ring texture, not RingGeometry
    };
  });

  // The death is now the flipbook fireball + a soft ring only — no spark particles feed the `sparks` pool.
  assert.equal(data.addedSparks, 0, 'ship death no longer spawns spark particles');
  assert.deepEqual(data.shockwaveScales, [22, 44], 'shockwave radius scales with ship size (22 and 2×22)');
  assert.ok(data.ringsTextured, 'shockwave rings use the baked soft-ring texture (additive quad)');

  await page.waitForTimeout(900); // let the fireball bloom
  await shot('bloom');
}
