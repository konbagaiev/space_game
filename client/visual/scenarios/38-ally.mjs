// The wingman, in an actual browser — the one thing no unit test and neither determinism oracle can see.
//
// `22-trace-replay` and `36-sim-divergence` prove the change is INERT with no ally. They exercise none of
// his own code, because the Level-0 trace has no ally phase. This is the other side: turn the `?ally` dev
// flag on and check he actually ARRIVES, gets a body in the scene, flies, FIGHTS and is drawn — and,
// because a green simulation is not a green picture, that his hull really lands on screen where the
// simulation has him. It also runs the flag-off half, which is the "players see nothing" guarantee.
//
// The player never touches the controls here, so every kill in this scenario is HIS. That makes it the
// cheapest possible check of the economy split: the kill counter climbs and the credits do not.
export const name = '38-ally';

// Boot a fresh page on a given query string and get past the welcome screen — the runner's own boot, redone
// here because it is the URL that carries the flag.
async function boot(page, query) {
  const base = page.url().split('?')[0];
  await page.goto(`${base}?${query}`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.evaluate(() => {
    const w = document.getElementById('welcome');
    if (w && w.style.display !== 'none') document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(150);
}

// Step the SIMULATION rather than waiting on the wall clock: a scenario that sleeps is testing the CPU.
// `__game.stepSim(n)` runs n fixed ticks (main.js BENCH_DT).
const stepSim = (page, ticks) => page.evaluate((n) => window.__game.stepSim(n), ticks);

export default async function ({ page, assert, shot }) {
  // ---- flag OFF: the shipped game, unchanged ----
  await boot(page, 'debug');
  await stepSim(page, 60 * 20);
  const off = await page.evaluate(() => ({
    allies: window.__game.allies.length, allyKills: window.__game.allyKills,
  }));
  assert.equal(off.allies, 0, 'no dev flag → no wingman, on the level the campaign actually ships');
  assert.equal(off.allyKills, 0);

  // ---- flag ON ----
  // `wave-1` is the OPENING phase of the level a fresh account flies, so he is there from tick 0 and the
  // scenario does not have to fight a whole campaign to see him. The mechanism is the real one: a phase
  // carrying `ally: true`, injected by `applyAllyDev` exactly as Level 5 will carry it in the seed.
  await boot(page, 'debug&ally=wave-1');
  const arrived = await page.evaluate(() => {
    const a = window.__game.allies[0];
    return a ? { n: window.__game.allies.length, hasMesh: !!a.mesh, maxHp: a.maxHp,
                 color: a.color, inScene: !!(a.mesh && a.mesh.parent) } : null;
  });
  assert.ok(arrived, 'the wingman arrived because the PHASE said so');
  assert.equal(arrived.n, 1, 'exactly one');
  assert.equal(arrived.maxHp, 200, 'flying the 200 HP heavy hull');
  assert.ok(arrived.hasMesh && arrived.inScene, 'and the browser host gave him a body in the scene');
  assert.equal(arrived.color, 0x3ddc84, 'in the friendly green livery');

  // Sample him through the FIGHT — where he is, how fast, and whether his hull is on screen. Sampling
  // rather than testing one instant is the point: the pass cycle swings him ~50 u out and back, which is
  // comparable to the visible half-extent, so he is EXPECTED to leave the frame mid-reversal. What must not
  // happen is that he is never in it.
  const samples = [];
  for (let i = 0; i < 12; i++) {
    await stepSim(page, 90);   // 1.5 s per sample, 18 s of fight in all
    samples.push(await page.evaluate(() => {
      const g = window.__game, a = g.allies[0];
      const v = a.mesh.position.clone().project(g.camera);   // the MESH, not the sim: this is the picture
      return {
        n: g.allies.length, hp: a.hp, warping: a.warping,
        speed: Math.hypot(a.vel.x, a.vel.z),
        meshAtSim: Math.hypot(a.mesh.position.x - a.pos.x, a.mesh.position.z - a.pos.z),
        x: v.x, y: v.y, z: v.z,
        fighting: !!a.target, enemies: g.enemies.length,
        kills: g.kills, allyKills: g.allyKills, earned: g.earned,
      };
    }));
  }
  await shot('ally-in-the-fight');

  const last = samples[samples.length - 1];
  const alive = samples.filter((s) => s.n === 1);
  // He CAN die now (§2.4 reversed 2026-08-23), so the loop asserts on the samples where he is still flying
  // rather than on immortality. Level 0's four light pirates against a 200 HP hull should never manage it —
  // if this ever drops below the full set, that is a real signal about his survivability, not a flaky test.
  assert.equal(alive.length, samples.length,
    `he survives a Level-0 fight (${alive.length}/${samples.length} samples)`);
  for (const s of alive) {
    assert.ok(s.hp > 0, `while he is in world.allies his hull is above 0 (hp ${s.hp})`);
    assert.ok(s.speed <= 30 + 1e-6, `and never above the player's flat cap (speed ${s.speed})`);
    assert.ok(s.meshAtSim < 0.01, 'his mesh is where the simulation has him (syncMeshes copies him)');
  }
  assert.ok(alive.some((s) => s.speed > 5),
    `he FLIES rather than drifting (peak ${Math.max(...samples.map((s) => s.speed)).toFixed(1)} u/s)`);
  assert.ok(alive.some((s) => s.warping === false), 'he finished forming');

  // ON SCREEN. A ship the simulation is flying can still be drawn nowhere at all, and every assertion above
  // would pass. `|ndc| < 1` on both axes with z < 1 is "inside the frame, in front of the camera".
  const onScreen = alive.filter((s) => s.z < 1 && Math.abs(s.x) < 1 && Math.abs(s.y) < 1);
  assert.ok(onScreen.length >= alive.length / 3,
    `his hull is drawn inside the frame most of the time (${onScreen.length}/${alive.length} samples; `
    + `ndc ys ${alive.map((s) => s.y.toFixed(1)).join(' ')})`);

  // THE WING LIVERY — the only thing that separates him from the PLAYER on screen. He flies the player's
  // own `player_combat` .glb, and catalog ships are built with `tint: false`, so his `color` reaches the
  // minimap dot and nothing else; without the wing repaint he is pixel-identical to your own ship.
  // Asserted on the live material colours, and negatively on the player + an enemy, because the accent has
  // to be a strict NO-OP for every other ship in the game.
  const livery = await page.evaluate(() => {
    const g = window.__game;
    const scan = (mesh) => {
      const out = { wing: [], other: [] };
      mesh.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!m || !m.color) continue;
          (String(m.name || '').startsWith('Wings_') ? out.wing : out.other).push(m.color.getHex());
        }
      });
      return out;
    };
    return { ally: scan(g.allies[0].mesh), player: scan(g.player.mesh),
             enemy: g.enemies.length ? scan(g.enemies[0].mesh) : null };
  });
  assert.ok(livery.ally.wing.length, 'the model really does carry a Wings_-prefixed material');
  for (const c of livery.ally.wing) assert.equal(c, 0x2f6bff, 'the wingman\'s wings are repainted blue');
  assert.ok(livery.ally.other.length, 'and the rest of his hull exists');
  assert.ok(!livery.ally.other.includes(0x2f6bff), 'but is NOT repainted — the accent is wings-only');
  // The no-op half. The player flies the same .glb: his wings must be whatever the artist baked.
  assert.ok(livery.player.wing.length, 'the player flies the same model');
  for (const c of livery.player.wing) assert.notEqual(c, 0x2f6bff, 'the accent must not leak onto the PLAYER');
  if (livery.enemy) for (const c of [...livery.enemy.wing, ...livery.enemy.other]) {
    assert.notEqual(c, 0x2f6bff, 'nor onto an enemy sharing the cached model templates');
  }

  // THE ECONOMY SPLIT. Nothing here touched the controls, so every kill on the board is the wingman's.
  assert.ok(last.kills > 0, `the fight is happening — ${last.kills} kills`);
  assert.equal(last.allyKills, last.kills, 'and with the player idle, all of them are HIS');
  assert.equal(last.earned, 0, 'his kills pay the player no credits (docs/plans/combat-ally.md §2.5)');
  // (The XP half of the split is pinned exactly in server/src/ally-sim.test.js — `earnedXp` is not one of
  // the fields `window.__game` exposes, and adding a debug hook for it is not worth a second reader.)

  // ---- `&level=` forces the LEVEL, not just the phase ----
  // The bug this closes: `?ally` injected into whatever level the ACCOUNT was on, and Level 3 and Level 4
  // carry identical phase names (`wave-1`/`wave-2`/`clear-out`/`boss`/`victory`) — so a flight aimed at
  // Level 4 landed on Level 3 and the URL gave no hint. The scenario's player is fresh (level-0), so
  // forcing level-1 is a change only the param can explain.
  const forced = await page.evaluate(() => window.__game.levelName);
  assert.equal(forced, 'level-0', 'a fresh account flies its own progress level when no level is named');
  await boot(page, 'debug&ally=wave-1&level=1');
  const named = await page.evaluate(() => ({
    level: window.__game.levelName,
    // The DESCRIPTOR is what the two params jointly produce, and it is the right granularity to assert:
    // that the named level was fetched AND its named phase carries the arrival flag. The spawn itself is
    // already proven above (on the level this account actually flies) and in server/src/ally-sim.test.js;
    // asserting it again here would only couple this scenario to Level 1's menu/briefing flow.
    phases: (window.__game.catalog.level.phases || []).map((ph) => `${ph.name}:${!!ph.ally}`),
  }));
  assert.equal(named.level, 'level-1', '`&level=1` overrode the account\'s progress level');
  assert.deepEqual(named.phases, ['wave-1:true', 'wave-2:false', 'finale:false', 'victory:false'],
    'and the phase named by `?ally=` carries the arrival flag — on the level named by `&level=`, and only that phase');

}
