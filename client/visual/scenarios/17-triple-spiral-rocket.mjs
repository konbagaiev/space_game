// Triple spiral rocket lifecycle: firing the spiral weapon spawns 1 invisible leader + 3 visible
// warheads into the shared `rockets` pool; after homing + detonation the whole volley must drain to 0
// (the leader self-removes once its last child is gone). Asserts the pool bookkeeping rather than pixels,
// then saves a mid-flight frame of the three cyan warheads corkscrewing toward the enemy.
export const name = '17-triple-spiral-rocket';

export default async function ({ page, assert, shot }) {
  // Launch from whichever menu is up (welcome or main window) so the sim loop actually runs — the runner's
  // default takeoff only dismisses the welcome screen (mirrors 16-enemy-health-bar's launch).
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(300);

  // Fire one spiral rocket at a lone enemy placed just ahead; assert the pool spawns exactly 4 (1 leader
  // + 3 warheads). A fresh load has an empty `rockets` pool; clear stray campaign enemies for determinism.
  const fired = await page.evaluate(() => {
    const g = window.__game;
    g.enemies.slice().forEach((e) => g.scene.remove(e.mesh));
    g.enemies.length = 0;
    const V = g.player.mesh.position.constructor; // THREE.Vector3
    const base = g.player.mesh.position.clone();
    const fwd = new V(0, 0, 1);
    const enemy = g.spawnEnemyShip(g.catalog.enemyShips.find((s) => s.stats.role === 'fighter'));
    enemy.mesh.position.set(base.x, 0.6, base.z + 24); // ~24u ahead, within the seek cone & reachable
    enemy.mesh.scale.copy(enemy.spawnScale);          // skip the warp-in grow so it's full size / full hit radius
    enemy.hp = enemy.maxHp = 9999; // survive all three 40-dmg warheads so the WHOLE volley connects &
    // detonates (a 30-HP fighter would die to the first hit, orphaning the other two → they'd only expire
    // at maxRange, past this 4s window). 'fighter' has a gun only (no rocket mount → clean `rockets` pool).
    const w = g.catalog.weapons.get(11);          // resolved Triple spiral rocket (spiral:true)
    const muzzle = base.clone().add(new V(0, 0, 2));
    g.spawnRocket(muzzle, fwd, w, w.accel, true, enemy);
    return {
      total: g.rockets.length,
      leaders: g.rockets.filter((r) => r.lead).length,
      warheads: g.rockets.filter((r) => r.spiralOf).length,
    };
  });
  assert.equal(fired.total, 4, 'one spiral fire spawns 4 rocket entries (1 leader + 3 warheads)');
  assert.equal(fired.leaders, 1, 'exactly one invisible leader');
  assert.equal(fired.warheads, 3, 'exactly three visible warheads');

  await shot('inflight'); // three cyan warheads spiraling toward the enemy

  // Let them home + detonate; the whole volley must drain (leader self-removes when children gone). Count
  // only spiral entries so a late campaign-wave enemy rocket can't skew the check.
  await page.waitForTimeout(4000); // 24u at speed ~14 → homing + detonation well within 4s
  const drained = await page.evaluate(() => ({
    spiral: window.__game.rockets.filter((r) => r.lead || r.spiralOf).length,
    leaders: window.__game.rockets.filter((r) => r.lead).length,
  }));
  assert.equal(drained.leaders, 0, 'no immortal invisible leader left behind');
  assert.equal(drained.spiral, 0, 'the whole spiral volley drains from the pool (no leaked entries)');
}
