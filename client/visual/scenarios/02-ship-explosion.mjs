// Ship-destruction burst: a flipbook (sprite-sheet) fireball + sparks + shockwave, sized by the ship.
// The sparks + ring are tinted by the engine's exhaust color; the flipbook carries its own baked fire.
// Asserts the surviving construction (spark count + shockwave scale ratio) rather than pixels, then
// saves a frame at full bloom.
export const name = '02-ship-explosion';

export default async function ({ page, assert, shot }) {
  const data = await page.evaluate(() => {
    const g = window.__game;
    const V = g.player.mesh.position.constructor; // THREE.Vector3
    const base = g.player.mesh.position;
    const before = { ex: g.explosions.length, sp: g.sparks.length, sw: g.shockwaves.length };
    const playerExhaust = g.player.engine.exhaust.color;
    const medium = g.catalog.enemyShips.find((s) => s.stats.role === 'medium');
    const heavyExhaust = g.catalog.components.get(medium.components.engine).stats.exhaust.color;
    // left: player engine exhaust, size 1 — right: heavy enemy exhaust, size 2
    g.spawnShipExplosion(new V(base.x - 40, 0.6, base.z - 22), playerExhaust, 1);
    g.spawnShipExplosion(new V(base.x + 40, 0.6, base.z - 22), heavyExhaust, 2);
    return {
      addedExplosions: g.explosions.length - before.ex,
      addedSparks: g.sparks.length - before.sp,
      shockwaveScales: g.shockwaves.slice(before.sw).map((w) => w.maxScale).sort((a, b) => a - b),
      explosionColors: g.explosions.map((e) => e.mesh.material.color.getHex()),
      playerExhaust, heavyExhaust,
    };
  });

  // The fireball is now ONE flipbook (sprite-sheet) quad per burst (flipbook-fx.js), not the old 4
  // additive spheres — so a burst no longer feeds the `explosions` pool. Sparks + shockwave remain:
  // each burst = 22 sparks + 1 shockwave.
  assert.equal(data.addedSparks, 44, 'two bursts add 44 spark particles');
  assert.deepEqual(data.shockwaveScales, [22, 44], 'shockwave radius scales with ship size (22 and 2×22)');

  await page.waitForTimeout(900); // let the fireball bloom
  await shot('bloom');
}
