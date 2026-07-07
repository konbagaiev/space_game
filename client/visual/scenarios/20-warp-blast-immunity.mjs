// Warp-in invulnerability: a player rocket that legitimately detonates on a fully-formed enemy must NOT
// splash-damage a co-located WARPING enemy (it's invulnerable while materializing — DECISIONS §54). This
// exercises the real projectiles path (sim.js detonation trigger + detonateRocket blast loop in
// projectiles.js), which can't load under `node --test`, so the outcome is asserted here.
export const name = '20-warp-blast-immunity';

export default async function ({ page, assert, shot }) {
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(300);

  // Clear the seeded wave, then place a fully-formed enemy (the legitimate detonation trigger) and a
  // warping enemy at the SAME spot — well within the rocket's blast radius. Fire a player rocket at them.
  await page.evaluate(() => {
    const g = window.__game;
    g.enemies.slice().forEach((e) => g.scene.remove(e.mesh));
    g.enemies.length = 0;

    const spot = { x: 0, y: 0.6, z: 6 };
    const formed = g.spawnEnemy('fighter');
    formed.warping = false; formed.spawnAge = formed.spawnDur; // fully formed → normal combatant
    formed.mesh.scale.copy(formed.spawnScale);
    formed.mesh.position.set(spot.x, spot.y, spot.z);

    const warp = g.spawnEnemy('fighter');
    warp.warping = true; warp.spawnDur = 999; warp.spawnAge = 0;  // frozen mid-warp (never finishes here)
    warp.mesh.position.set(spot.x, spot.y, spot.z);
    window.__warpMaxHp = warp.maxHp;

    // Fire a player homing rocket from just behind the pair, aimed at them. Params mirror the starter
    // "Rocket (homing)" weapon (catalog id 3) so it's the real projectile path.
    const from = warp.mesh.position.clone(); from.z -= 5; // 5 units behind, on the combat plane
    const fwd = warp.mesh.position.clone().sub(from); fwd.y = 0; fwd.normalize();
    const weapon = {
      type: 'rocket', power: 60, accel: 10, turnRate: 1.0, launchSpeed: 12, maxRange: 150, health: 10,
      detonateRadius: 0.5, blastRadius: 5, projectileColor: 0xffaa33, class: 'rocket',
    };
    g.spawnRocket(from, fwd, weapon, 10, true, formed);
  });

  // Let the sim run until the rocket detonates (or a safety timeout).
  for (let i = 0; i < 40; i++) {
    const live = await page.evaluate(() => window.__game.rockets.length);
    if (live === 0) break;
    await page.waitForTimeout(80);
  }
  await shot('detonated');

  const out = await page.evaluate(() => {
    const g = window.__game;
    const warp = g.enemies.find((e) => e.warping);
    const formed = g.enemies.find((e) => !e.warping);
    return {
      rocketsLeft: g.rockets.length,
      warpHp: warp ? warp.hp : null,
      warpMaxHp: window.__warpMaxHp,
      formedHp: formed ? formed.hp : null,
      formedMaxHp: formed ? formed.maxHp : null,
      formedGone: !formed,
    };
  });

  assert.equal(out.rocketsLeft, 0, 'the rocket detonated (did not linger)');
  assert.equal(out.warpHp, out.warpMaxHp, 'warping enemy takes NO rocket blast damage (invulnerable while forming)');
  // The blast actually fired: the formed enemy was damaged (or killed & removed). Fails loudly on a
  // vacuous pass where the rocket never reached anything.
  assert.ok(out.formedGone || out.formedHp < out.formedMaxHp, 'the blast fired — the formed enemy was damaged');
}
