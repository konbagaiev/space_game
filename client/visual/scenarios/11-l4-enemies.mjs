// Level-4 enemies (docs/plans/level-4-difficulty.md): the Advanced medium pirate (red marker, 300 effective
// HP) and the Second Boss (maroon marker, 550 effective HP) build + render with sane derived drive. Marker
// colors follow the size-tier convention (MARKER in catalog_seed.js): medium → red, boss → maroon.
// Since enemy shields, a ship's catalog durability is SPLIT into a 1/3 shield + 2/3 hull (`e.hp` is the hull
// only), so the assertions below check hull + shield capacity = the catalog total.
export const name = '11-l4-enemies';

export default async function ({ page, assert, shot }) {
  // launch from whichever menu is up, then let the world settle
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-takeoff').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(300);

  const info = await page.evaluate(() => {
    const g = window.__game;
    g.enemies.slice().forEach((e) => { g.scene.remove(e.mesh); }); // clear the wave so we see only our two
    g.enemies.length = 0;
    const amp = g.spawnEnemy('advanced_medium_pirate');
    const sb = g.spawnEnemy('boss2');
    if (amp) amp.mesh.position.set(-14, 0.6, 6);
    if (sb) sb.mesh.position.set(16, 0.6, 6);
    const stat = (e) => e && ({
      hp: e.hp, shield: e.shield ? e.shield.capacity : 0, color: e.color,
      accel: Number.isFinite(e.acceleration) && e.acceleration > 0,
      turn: Number.isFinite(e.turnRate) && e.turnRate > 0,
      mounts: e.mounts.length,
    });
    return { amp: stat(amp), sb: stat(sb) };
  });
  assert.ok(info.amp, 'advanced medium pirate spawned');
  assert.equal(info.amp.hp + info.amp.shield, 300, 'advanced medium pirate still totals 300 effective HP (200 hull + 100 shield)');
  assert.equal(info.amp.color, 0xe53935, 'medium tier → red marker');
  assert.ok(info.amp.accel && info.amp.turn, 'advanced medium pirate has sane derived drive');
  assert.equal(info.amp.mounts, 3, 'advanced medium pirate has 3 mounts (1 MG + 2 rockets)');

  assert.ok(info.sb, 'second boss spawned');
  assert.equal(info.sb.hp + info.sb.shield, 550, 'second boss still totals 550 effective HP (367 hull + 183 shield)');
  assert.equal(info.sb.color, 0x800020, 'boss tier → maroon marker');
  assert.ok(info.sb.accel && info.sb.turn, 'second boss has sane derived drive');
  assert.equal(info.sb.mounts, 5, 'second boss has 5 mounts (2 cannons + 3 rockets)');

  await page.waitForTimeout(1200); // let them grow-in (warp) + the camera settle
  await shot('l4-enemies');
}
