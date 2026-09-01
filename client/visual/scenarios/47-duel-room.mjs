// The duel room (`?duel`), in an actual browser.
//
// The unit tests prove the ace's rules; this proves the ROOM — that the flag actually assembles a playable
// fight end to end: the level is rebuilt, Take off drops you into it instead of into roam, two hostile
// ships fly the wingman's pilot code, they get bodies in the scene in the hostile livery, they shoot at
// you, and the player is holding the forced starter gun + repair drone rather than whatever the account
// has equipped. And the half that matters more than any of it: with the flag OFF nothing changes.
export const name = '47-duel-room';

// Boot a fresh page on a given query string and get past whichever launch screen this level lands on
// (a level with a briefing lands on the Main Window, one without on Welcome).
async function boot(page, query) {
  const base = page.url().split('?')[0];
  await page.goto(`${base}?${query}`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.evaluate(() => {
    const mw = document.getElementById('mw-takeoff');
    const main = document.getElementById('main-window');
    if (mw && main && main.classList.contains('on')) { mw.click(); return; }
    const w = document.getElementById('welcome');
    if (w && w.style.display !== 'none') document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(200);
}

// Step the SIMULATION rather than waiting on the wall clock: a scenario that sleeps is testing the CPU.
const stepSim = (page, ticks) => page.evaluate((n) => window.__game.stepSim(n), ticks);

export default async function ({ page, assert, shot }) {
  // ---- flag OFF: the shipped game, unchanged ----
  await boot(page, 'debug');
  await stepSim(page, 60 * 5);
  const off = await page.evaluate(() => ({
    level: window.__game.levelName,
    aces: window.__game.enemies.filter((e) => e.pilot).length,
    phases: (window.__game.catalog.level.phases || []).map((p) => p.name),
  }));
  assert.equal(off.aces, 0, 'no dev flag → not one ship with its own pilot');
  assert.equal(off.level, 'level-0', 'and a fresh account still flies its own progress level');
  assert.ok(off.phases.length > 2, 'with its own phase script intact');

  // ---- flag ON ----
  await boot(page, 'debug&duel');
  const room = await page.evaluate(() => {
    const g = window.__game;
    return {
      level: g.levelName,
      phases: (g.catalog.level.phases || []).map((p) => `${p.name}:${p.aces || 0}`),
      enemyTotal: g.catalog.level.enemyTotal,
      enemies: g.enemies.length,
      roam: !!g.roam,
      aces: g.enemies.map((e) => ({
        pilot: e.pilot, maxHp: e.maxHp, color: e.color,
        hasMesh: !!e.mesh, inScene: !!(e.mesh && e.mesh.parent),
        dist: Math.hypot(e.pos.x - g.player.pos.x, e.pos.z - g.player.pos.z),
      })),
      // The forced ship: the starter kinetic + the basic repair drone, whatever the account had.
      player: {
        repair: !!g.player.repair,
        repairPerTick: g.player.repair && g.player.repair.repairPerTick,
        weapons: g.player.mounts.map((m) => m.weapon.name),
        maxHp: g.player.maxHp,
      },
    };
  });
  assert.equal(room.level, 'level-1', '?duel builds the room over its default level, not the intro');
  assert.deepEqual(room.phases, ['duel:2', 'victory:0'], 'one phase that spawns two aces, then the win phase');
  assert.equal(room.enemyTotal, 2, 'and the HUD counts two');
  assert.equal(room.roam, false, 'Take off drops you INTO the fight, never into roam');
  assert.equal(room.enemies, 2, 'both aces are in the world the instant the phase starts');
  for (const a of room.aces) {
    assert.ok(a.pilot, 'each carries the pilot tag, so stepEnemyAI leaves it alone');
    assert.equal(a.maxHp, 200, "and the wingman's own 200 HP hull");
    assert.equal(a.color, 0xff5a4a, 'in the hostile red livery, never the player blue');
    assert.ok(a.hasMesh && a.inScene, 'and the browser host gave it a body in the scene');
    assert.ok(a.dist > 40, `warped in at a distance, not on top of the player (${a.dist.toFixed(1)} u)`);
  }
  assert.equal(room.player.repair && room.player.repairPerTick, 1, 'the player is handed the basic Repair drone');
  assert.deepEqual(room.player.weapons, ['Basic kinetic', 'Rocket (homing)'], '…and the starter gun');
  assert.equal(room.player.maxHp, 100, 'on the starter hull');
  await shot('duel-room-opening');

  // THE FIGHT. The player never touches the controls, so everything below is the aces flying themselves —
  // and an idle starter hull against two of them does not last, so the samples are taken often and the
  // assertions are made over the whole window rather than at one instant.
  const samples = [];
  for (let i = 0; i < 30; i++) {
    await stepSim(page, 30);   // 0.5 s per sample, 15 s in all — past the 5 s opening fire grace
    samples.push(await page.evaluate(() => {
      const g = window.__game;
      const live = g.enemies.filter((e) => e.pilot);
      return {
        n: live.length,
        speed: Math.max(0, ...live.map((e) => Math.hypot(e.vel.x, e.vel.z))),
        dists: live.map((e) => Math.hypot(e.pos.x - g.player.pos.x, e.pos.z - g.player.pos.z)),
        onTarget: live.filter((e) => e.target === g.player).length,
        meshAtSim: Math.max(0, ...live.map((e) => Math.hypot(e.mesh.position.x - e.pos.x, e.mesh.position.z - e.pos.z))),
        hostileShots: g.bullets.filter((b) => !b.fromPlayer).length + g.rockets.filter((r) => !r.fromPlayer).length,
        playerHp: g.player.hp, alive: g.player.alive,
        kills: g.kills, earned: g.earned,
      };
    }));
  }
  await shot('duel-room-fight');

  assert.ok(samples.some((s) => s.speed > 5),
    `they FLY rather than drift (peak ${Math.max(...samples.map((s) => s.speed)).toFixed(1)} u/s)`);
  assert.ok(samples.every((s) => s.speed <= 30 + 1e-6),
    'and never above the player\'s flat cap — they are on his movement model, not the enemy drag');
  assert.ok(samples.some((s) => s.onTarget > 0), 'and they charge the PLAYER, which is who they are here for');
  for (const s of samples) assert.ok(s.meshAtSim < 0.01, 'each hull is drawn where the simulation has it');

  // THE ECHELON. Two identical ships flown by identical deterministic code will fly as ONE unless their
  // arrival is staggered — measured in the browser before the stagger existed, both held the same distance
  // to the player tick for tick and volleyed their rockets in the same frame, one-shotting the starter
  // hull. This is the guard on that: while both are alive their ranges must actually differ.
  const pairs = samples.filter((s) => s.dists.length === 2);
  assert.ok(pairs.length, 'both aces are alive for part of the fight');
  assert.ok(pairs.some((s) => Math.abs(s.dists[0] - s.dists[1]) > 5),
    'the two fly their own passes rather than in lockstep');

  // They SHOOT, and the player takes damage without ever touching a control.
  assert.ok(samples.some((s) => s.hostileShots > 0), 'they open fire once the opening grace is over');
  assert.ok(samples.some((s) => s.playerHp < 100), 'and the hits land');

  // THE ECONOMY. A sparring room must not pay a real account, however the fight goes.
  for (const s of samples) assert.equal(s.earned, 0, 'a duel pays no credits');

  // POINT DEFENCE, in a real fight rather than a fixture. The unit tests prove an ace CAN shoot a rocket
  // down; this proves the rule is ever satisfied in play — a condition that never comes true would pass
  // every structural test and do nothing on screen. The player has to actually shoot for there to be
  // anything to intercept, so this is the one place the scenario touches the controls.
  //
  // On a FRESH boot, because the idle player above is already dead by now — and a dead player is not
  // merely at 0 hp, `tick.js` stops stepping him entirely, so no held key would fire anything.
  await boot(page, 'debug&duel');
  await stepSim(page, 300);          // past the 5 s opening fire grace
  await page.keyboard.down('KeyF');
  const pd = await page.evaluate(() => {
    const g = window.__game;
    let engagedTicks = 0, fired = 0, shotDown = 0;
    const seen = new Map();
    for (let i = 0; i < 3600; i++) {          // 60 s — the ace's rocket reload alone is 5 s
      g.player.hp = g.player.maxHp; g.player.alive = true;   // keep the duel running long enough to sample
      g.stepSim(1);
      const aces = g.enemies.filter((e) => e.pilot);
      if (aces.some((e) => e.intercept)) engagedTicks++;
      const live = new Set();
      for (const r of g.rockets) {
        if (!r.fromPlayer || r.lead) continue;
        live.add(r);
        if (!seen.has(r)) fired++;
        seen.set(r, { d: Math.min(...aces.map((e) => Math.hypot(e.pos.x - r.pos.x, e.pos.z - r.pos.z)), 1e9),
                      spent: r.traveled >= r.maxRange - 5 });
      }
      for (const [r, last] of seen) {
        if (live.has(r)) continue;
        if (!last.spent && last.d >= 5) shotDown++;   // gone in open space = taken out by a bullet
        seen.delete(r);
      }
    }
    return { engagedTicks, fired, shotDown };
  });
  await page.keyboard.up('KeyF');
  assert.ok(pd.fired > 0, 'the player got rockets away, so there was something to intercept');
  assert.ok(pd.engagedTicks > 0,
    `an ace actually engaged an incoming rocket (${pd.engagedTicks} ticks of 3600, ${pd.fired} rockets fired)`);
  assert.ok(pd.shotDown > 0, `and at least one was shot out of the air (${pd.shotDown}/${pd.fired})`);
}
