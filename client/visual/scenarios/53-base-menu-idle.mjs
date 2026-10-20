// Nothing runs behind the base menu (docs/plans/2026-10-20-1659-base-menu-idle.md). Prod report: die in a
// fight, press Back to base, touch the Loadout — and the fight carried on under the Main Window (the
// "left the battlefield" banner, spawns, a warp back in). Cause: Back to base never cleared
// G.gameStarted/G.roam, and a Loadout action rebuilds an ALIVE G.player, which reopens update()'s gate.
// The invariant is now one transition (mainwindow.js enterMenu): while a menu is up, gameStarted and roam
// are false. This scenario drives the real paths — take off → zone countdown → engage → die → Back to base
// → a Loadout unequip → step the sim — and the victory Continue path, and asserts nothing ticks.
// It was seen FAILING on the pre-fix code (gameStarted still true after Back to base).
export const name = '53-base-menu-idle';

export default async function ({ page, assert, shot }) {
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  assert.ok(pid, 'a player id is present');

  // 1. reach a shop-unlocked level (SHOP_MIN_LEVEL = level-2) with the CAMPAIGN as the active mission — the
  //    worker's player is shared, so don't assume where it starts
  const setup = await page.evaluate(async (pid) => {
    localStorage.setItem('accountPrompted', '1'); // the one-time account prompt must not intercept Continue
    const lvlN = async () => {
      const j = await (await fetch(`/api/players/${pid}/level`)).json();
      return Number(String(j.name || '').replace('level-', ''));
    };
    let n = await lvlN(), guard = 0;
    while (n < 2 && guard++ < 6) { await fetch(`/api/players/${pid}/advance`, { method: 'POST' }); n = await lvlN(); }
    const r = await fetch(`/api/players/${pid}/missions/activate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ missionId: null }) });
    return { n, activate: r.status };
  }, pid);
  assert.ok(setup.n >= 2, `the player reached a shop-unlocked level (got level-${setup.n})`);
  // 403 = the side-mission board is still locked (below level-4) → no side mission can be active anyway
  assert.ok((setup.activate >= 200 && setup.activate < 300) || setup.activate === 403,
    `the campaign is the active mission (activate → ${setup.activate})`);
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 8000 });

  // 2. Take off → roam → fly into the campaign zone → the countdown engages the real fight
  const takeOffIntoFight = async (label) => {
    await page.evaluate(() => document.getElementById('mw-takeoff').click());
    await page.waitForFunction('window.__game.roam === true', null, { timeout: 10000 });
    const r = await page.evaluate(() => {
      const g = window.__game;
      g.setPaused(true);                       // enterRoam's reset() unpaused — keep the live loop out
      const zone = g.missionZone;
      if (!zone) return { zone: false };
      let i = 0;
      while (g.roam && i++ < 400) {
        g.player.pos.set(zone.center.x, 0.6, zone.center.z); g.player.vel.set(0, 0, 0);
        g.stepSim(1);
      }
      g.setPaused(true);                       // the engage reset() unpaused again
      g.stepSim(60);
      return { zone: true, steps: i, gameStarted: g.gameStarted, roam: g.roam,
               paused: document.body.classList.contains('paused') };
    });
    assert.ok(r.zone, `${label}: a campaign mission zone is armed in roam (campaign is active)`);
    assert.equal(r.roam, false, `${label}: the zone countdown engaged the fight (roam off after ${r.steps} ticks)`);
    assert.equal(r.gameStarted, true, `${label}: the fight is running`);
    return r;
  };
  await takeOffIntoFight('first launch');

  // 3. die → Back to base
  await page.evaluate(() => { const g = window.__game; g.player.hp = 0; g.player._shieldValue = 0; g.stepSim(5); });
  const death = await page.evaluate(() => ({
    overlay: getComputedStyle(document.getElementById('overlay')).display !== 'none',
    backBtn: getComputedStyle(document.getElementById('back-hangar')).display !== 'none',
  }));
  assert.ok(death.overlay, 'the death overlay is shown');
  assert.ok(death.backBtn, 'Back to base is offered (shop unlocked)');
  await page.evaluate(() => document.getElementById('back-hangar').click());
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });
  const back = await page.evaluate(() => ({
    gameStarted: window.__game.gameStarted, roam: window.__game.roam,
    oob: window.__game.oobWarnVisible, menu: document.body.classList.contains('menu'),
  }));
  assert.equal(back.gameStarted, false, 'Back to base stops the fight (gameStarted false)');
  assert.equal(back.roam, false, 'Back to base leaves roam off');
  assert.equal(back.oob, false, 'no out-of-bounds banner behind the menu');
  assert.ok(back.menu, 'body.menu is set');

  // 4. a Loadout action rebuilds an ALIVE ship (the precondition that opened the old leak)
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="loadout"]').click());
  await page.waitForSelector('#loadout-slots .slot-chip', { state: 'attached', timeout: 8000 });
  const picked = await page.evaluate(() => {
    const REQUIRED = ['hull', 'engine', 'thruster'];
    const chips = [...document.querySelectorAll('#loadout-slots .slot-chip:not(.empty)')]
      .filter((c) => !REQUIRED.includes(c.dataset.slot));
    const chip = chips.find((c) => c.dataset.slot === 'grab') || chips[0];
    if (!chip) return null;
    const slot = chip.dataset.slot;
    // record what's in the slot (from the authoritative active ship) so step 8 can put it back
    const a = window.__game.activeShip || {};
    let kind = null, refId = null;
    if (a.components && a.components[slot] != null) { kind = 'component'; refId = Number(a.components[slot]); }
    else {
      const m = ((a.loadout && a.loadout.mounts) || []).find((mm) => mm.group === slot);
      if (m) { kind = 'weapon'; refId = Number(m.weapon); }
    }
    window.__deadShip = window.__game.player;
    chip.click();
    return { slot, kind, refId };
  });
  assert.ok(picked, 'an optional slot is filled (needed to drive a Loadout rebuild)');
  assert.ok(picked.kind && Number.isInteger(picked.refId), `the removed item is identified (${JSON.stringify(picked)})`);
  await page.waitForSelector('#loadout-panel [data-act="unequip"]', { state: 'attached', timeout: 5000 });
  await page.evaluate(() => document.querySelector('#loadout-panel [data-act="unequip"]').click());
  await page.waitForFunction('window.__game.player !== window.__deadShip', null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => window.__game.player.alive), true, 'the Loadout rebuild made an alive ship');

  // 5. nothing ticks behind the menu, even with an alive ship
  const idle = await page.evaluate(() => {
    const g = window.__game;
    const t0 = g.combatElapsed, e0 = g.enemyCount;
    g.stepSim(600);
    return { t0, t1: g.combatElapsed, e0, e1: g.enemyCount, oob: g.oobWarnVisible, gameStarted: g.gameStarted,
             mainOn: document.getElementById('mainwin').classList.contains('on') };
  });
  assert.equal(idle.t1, idle.t0, `the sim clock does not advance behind the menu (${idle.t0} → ${idle.t1})`);
  assert.equal(idle.e1, idle.e0, 'no enemies spawn behind the menu');
  assert.equal(idle.oob, false, 'no out-of-bounds banner after stepping');
  assert.equal(idle.gameStarted, false, 'still no fight running');
  assert.ok(idle.mainOn, 'the Main Window is still up (no hidden zone countdown tore it down)');
  await shot('menu-idle');

  // 6. victory Continue path: the menu stops the fight AND drops a pause
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="missions"]').click());
  const second = await takeOffIntoFight('second launch');
  assert.equal(second.paused, true, 'precondition: the fight is paused before the win');
  await page.evaluate(() => {
    window.__game.levelRunner.won = true;
    document.getElementById('overlay').style.display = 'flex';
    document.getElementById('restart').click();
  });
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 8000 });
  const cont = await page.evaluate(() => ({
    gameStarted: window.__game.gameStarted, roam: window.__game.roam,
    paused: document.body.classList.contains('paused'), menu: document.body.classList.contains('menu'),
  }));
  assert.equal(cont.gameStarted, false, 'Continue stops the fight (gameStarted false)');
  assert.equal(cont.roam, false, 'Continue leaves roam off');
  assert.equal(cont.paused, false, 'a pause does not carry into the menu');
  assert.ok(cont.menu, 'body.menu is set after Continue');

  // 8. leave the shared worker player as found: re-equip the removed item
  const re = await page.evaluate(async ({ pid, kind, refId }) => {
    const r = await fetch(`/api/players/${pid}/equip`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, refId: Number(refId) }) });
    return r.status;
  }, { pid, kind: picked.kind, refId: picked.refId });
  assert.ok(re >= 200 && re < 300, `the removed item was re-equipped (${re})`);
}
