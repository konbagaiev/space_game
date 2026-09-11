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
    if (amp) amp.pos.set(-14, 0.6, 6);
    if (sb) sb.pos.set(16, 0.6, 6);
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

  // THE SECOND BOSS'S CANNON FIRES A TRACER (maintainer, 2026-09-06): every `class: 'cannon'` round — this
  // boss's Advanced pirate cannon and the player's Heavy cannon — is drawn head-and-tail (`bolt-fx.js`
  // `TRACER`), while a kinetic round keeps the capsule. Step the SIM until the boss has fired, then read the
  // named meshes: the shape is asserted on the texture and the drawn proportions, not on "a mesh exists".
  const fire = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const sb = g.enemies.find((e) => e.role === 'boss2') || g.enemies.find((e) => e.mounts && e.mounts.length === 5);
    let tracer = null, capsule = null, ticks = 0;
    for (let i = 0; i < 900 && !tracer; i++) {
      // Hold the boss 16 u off the player's nose so its gun is in range and on target the whole time.
      if (sb) { sb.pos.x = p.pos.x + 16; sb.pos.z = p.pos.z + 6; sb.vel.x = 0; sb.vel.z = 0; }
      p.vel.x = 0; p.vel.z = 0;
      g.stepSim(1); ticks++;
      g.scene.traverse((o) => {
        if (o.name === 'tracer:cannon' && !tracer) tracer = { len: o.scale.x, wid: o.scale.y, tex: o.material.map && o.material.map.name, w: o.material.map && o.material.map.image.width };
        if (o.name === 'bolt' && !capsule) capsule = { len: o.scale.x, wid: o.scale.y, tex: o.material.map && o.material.map.name };
      });
    }
    return { tracer, capsule, ticks, boss: !!sb };
  });
  assert.ok(fire.boss, 'the second boss is still in the fight');
  assert.ok(fire.tracer, `the boss's cannon fired a TRACER within ${fire.ticks} ticks`);
  assert.equal(fire.tracer.tex, 'tracer', 'drawn with the head-and-tail tracer texture, not the capsule');
  assert.ok(fire.tracer.len >= 7 && fire.tracer.len <= 14,
    `a long round — ~10.5 u ± the per-shot jitter (drawn ${fire.tracer.len.toFixed(1)})`);
  assert.ok(fire.tracer.len / fire.tracer.wid > 7,
    `and thin: length/width > 7 (${(fire.tracer.len / fire.tracer.wid).toFixed(1)}), so it reads as a streak, not a slug`);
  if (fire.capsule) {
    assert.notEqual(fire.capsule.tex, 'tracer', 'a kinetic round still draws the capsule');
    assert.ok(fire.capsule.len < fire.tracer.len, 'and is the shorter of the two');
  }
  await shot('cannon-tracer');
}
