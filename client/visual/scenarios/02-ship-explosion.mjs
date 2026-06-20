// Ship-destruction burst: layered fireball + sparks + shockwave, sized by the ship and tinted
// by its engine's exhaust color. Asserts the construction (counts, scale ratio, colors) rather
// than pixels, then saves a frame at full bloom.
export const name = '02-ship-explosion';

export default async function ({ page, assert, shot }) {
  const data = await page.evaluate(() => {
    const g = window.__game;
    const V = g.player.mesh.position.constructor; // THREE.Vector3
    const base = g.player.mesh.position;
    const before = { ex: g.explosions.length, sp: g.sparks.length, sw: g.shockwaves.length };
    const playerExhaust = g.player.engine.exhaust.color;
    const heavy = g.catalog.enemyShips.find((s) => s.stats.role === 'heavy');
    const heavyExhaust = heavy.stats.engine.exhaust.color;
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

  // each burst = 4 fireball layers + 22 sparks + 1 shockwave
  assert.equal(data.addedExplosions, 8, 'two bursts add 8 fireball layers');
  assert.equal(data.addedSparks, 44, 'two bursts add 44 spark particles');
  assert.deepEqual(data.shockwaveScales, [22, 44], 'shockwave radius scales with ship size (22 and 2×22)');
  // the exhaust-colored glow layer carries the engine's color
  assert.ok(data.explosionColors.includes(data.playerExhaust), 'a layer uses the player exhaust color');
  assert.ok(data.explosionColors.includes(data.heavyExhaust), 'a layer uses the heavy exhaust color');

  await page.waitForTimeout(900); // let the fireball bloom
  await shot('bloom');
}
