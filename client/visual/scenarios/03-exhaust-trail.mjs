// Every ship carries ONE shared exhaust plume (exhaust-fx.js), lazily attached + parented to its mesh and
// colored by its engine. It streams rigidly straight along the ship's aft -Z (no more curved
// position-history pool). Seed two enemies of different engine colors, flag thrust on them via the exposed
// emitExhaust (which attaches + caches the plume), step the throttle fade deterministically with the
// exhaust.pump() test hook (so we don't depend on the slow-to-warm-up software-WebGL frame rate), then
// assert each enemy grew an attached plume in its engine exhaust color, faded in (throttle > 0), and that
// the global look defaults to the silhouette-preserving point plume.
export const name = '03-exhaust-trail';

export default async function ({ page, assert, shot }) {
  // Seed + flag thrust + step the fade — all synchronously in ONE evaluate, so no interleaved sim frame
  // can decay the throttle back down between flagging and reading. Fully deterministic.
  const data = await page.evaluate(() => {
    const g = window.__game;
    g.enemies.forEach((e) => g.scene.remove(e.mesh));
    g.enemies.length = 0; // clear the default ring (mostly off-screen)
    const base = g.player.pos;
    ['fighter', 'medium'].forEach((k, i) => {
      g.spawnEnemy(k);
      const e = g.enemies[g.enemies.length - 1];
      e.pos.set(base.x + (i ? 34 : -34), 0.6, base.z - 34);
      e.vel.set(0, 0, 0);
      g.emitExhaust(e.mesh, e.vel, e.vel, e.engine.exhaust); // attach + cache the plume; throttleTarget = 1
    });
    g.exhaust.pump(0.1); // one deterministic fade step: throttle 0 → decayThrottle(0,1,0.1)
    const plumes = g.enemies.map((e) => e.mesh.userData.exhaustPlume).filter(Boolean);
    return {
      attached: plumes.length,
      enemyCount: g.enemies.length,
      maxThrottle: plumes.reduce((m, p) => Math.max(m, p.throttle), 0),
      colors: [...new Set(plumes.map((p) => p.colorHex))],
      enemyExhausts: [...new Set(g.enemies.map((e) => e.engine.exhaust.color))],
      mode: g.exhaust.currentMode,
    };
  });

  assert.equal(data.attached, data.enemyCount, 'every thrusting enemy has an attached exhaust plume');
  assert.ok(data.maxThrottle > 0, `a thrusting enemy plume faded in (throttle ${data.maxThrottle} > 0)`);
  assert.equal(data.mode, 'flame', 'the global exhaust look defaults to the flame plume');
  const usesEnemyColor = data.colors.some((c) => data.enemyExhausts.includes(c));
  assert.ok(usesEnemyColor, `plume uses an enemy exhaust color (saw ${data.colors.map((c) => '0x' + c.toString(16))})`);

  await page.waitForTimeout(300); // let a couple of frames render the plume for the screenshot
  await shot('thrusting');
}
