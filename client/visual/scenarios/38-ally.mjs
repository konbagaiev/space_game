// The wingman, in an actual browser — the one thing no unit test and neither determinism oracle can see.
//
// `22-intro-replay` and `36-sim-divergence` prove the change is INERT with no ally. They exercise none of
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
  for (const s of samples) {
    assert.equal(s.n, 1, 'still exactly one, every sample — there is no ally death path anywhere');
    assert.ok(s.hp > 0, `he is never dead (hp ${s.hp})`);
    assert.ok(s.speed <= 30 + 1e-6, `and never above the player's flat cap (speed ${s.speed})`);
    assert.ok(s.meshAtSim < 0.01, 'his mesh is where the simulation has him (syncMeshes copies him)');
  }
  assert.ok(samples.some((s) => s.speed > 5),
    `he FLIES rather than drifting (peak ${Math.max(...samples.map((s) => s.speed)).toFixed(1)} u/s)`);
  assert.ok(samples.some((s) => s.warping === false), 'he finished forming');

  // ON SCREEN. A ship the simulation is flying can still be drawn nowhere at all, and every assertion above
  // would pass. `|ndc| < 1` on both axes with z < 1 is "inside the frame, in front of the camera".
  const onScreen = samples.filter((s) => s.z < 1 && Math.abs(s.x) < 1 && Math.abs(s.y) < 1);
  assert.ok(onScreen.length >= samples.length / 3,
    `his hull is drawn inside the frame most of the time (${onScreen.length}/${samples.length} samples; `
    + `ndc ys ${samples.map((s) => s.y.toFixed(1)).join(' ')})`);

  // THE ECONOMY SPLIT. Nothing here touched the controls, so every kill on the board is the wingman's.
  assert.ok(last.kills > 0, `the fight is happening — ${last.kills} kills`);
  assert.equal(last.allyKills, last.kills, 'and with the player idle, all of them are HIS');
  assert.equal(last.earned, 0, 'his kills pay the player no credits (docs/plans/combat-ally.md §2.5)');
  // (The XP half of the split is pinned exactly in server/src/ally-sim.test.js — `earnedXp` is not one of
  // the fields `window.__game` exposes, and adding a debug hook for it is not worth a second reader.)
}
