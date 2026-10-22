// Character screen (docs/plans/2026-08-09-character-progression.md): bank some XP, land on the Main
// Window, open Character — the header shows the derived level + XP bar + unspent skill points, and the
// five skill cards render. Spending a point via "+" increments that skill and decrements the pool.
// Also catches any JS error in the Character render path (the runner fails on any page error).
export const name = '11-character-progression';

export default async function ({ page, assert, shot }) {
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  assert.ok(pid, 'a player id is present');

  // Advance past the intro (level-0) so the reload lands on the Main Window rather than auto-launching the
  // intro level; then bank 2500 XP → character level 2 with 2 unspent skill points (curve: 1000 to L1,
  // +1500 to L2).
  await page.evaluate(async (pid) => {
    for (let i = 0; i < 4; i++) await fetch(`/api/players/${pid}/advance`, { method: 'POST' });
    await fetch('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: pid, credits: 0, kills: 0, durationMs: 100, xp: 2500 }) });
  }, pid);

  // reload → land on the Main Window; wait until the freshly-fetched active ship carries the progression
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });
  await page.waitForFunction(
    'window.__game.activeShip && window.__game.activeShip.progression && window.__game.activeShip.progression.level === 2',
    null, { timeout: 8000 });

  // open the Character screen
  await page.waitForSelector('.mw-item[data-mw="character"]', { state: 'attached', timeout: 5000 });
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="character"]').click());
  await page.waitForFunction('document.querySelectorAll("#mw-character .skill-card").length === 5', null, { timeout: 5000 });

  const base = await page.evaluate(() => ({
    charActive: document.getElementById('mw-view-character').classList.contains('active'),
    cards: document.querySelectorAll('#mw-character .skill-card').length,
    level: (document.querySelector('#mw-character .ch-level-num') || {}).textContent || '',
    points: (document.querySelector('#mw-character .ch-points') || {}).textContent || '',
    xpFillPct: parseFloat((document.querySelector('#mw-character .ch-xpfill') || {}).style?.width || '0'),
    enabledPlus: document.querySelectorAll('#mw-character .ch-plus:not([disabled])').length,
  }));
  assert.ok(base.charActive, 'the Character view is shown in the work zone');
  assert.equal(base.cards, 5, 'all five skill cards render');
  assert.ok(/2/.test(base.level), 'the level header shows level 2');
  assert.ok(/2/.test(base.points), 'two unspent skill points are shown');
  assert.ok(base.xpFillPct === 0, 'the XP bar is empty at an exact level threshold (0 into the level)');
  assert.equal(base.enabledPlus, 5, 'every card\'s "+" is enabled while points remain');
  // the free-skill-points badge on the Character menu item + the always-on bottom XP bar
  const hud = await page.evaluate(() => ({
    badge: (document.getElementById('mw-char-badge') || {}).textContent || '',
    badgeShown: document.getElementById('mw-char-badge').classList.contains('show'),
    xpShown: getComputedStyle(document.getElementById('xp-bar')).display !== 'none',
    xpText: document.getElementById('xp-bar-text').textContent,
  }));
  assert.equal(hud.badge, '2', 'the Character menu badge shows the free skill points');
  assert.ok(hud.badgeShown, 'the badge is visible while points are unspent');
  assert.ok(hud.xpShown, 'the bottom XP bar is shown on the base');
  assert.ok(/2/.test(hud.xpText) && /2000/.test(hud.xpText), 'the XP bar shows level + into/next');
  await shot('character');

  // spend one point on Kinetic → its count goes to 1 and the pool drops to 1
  await page.evaluate(() => document.querySelector('#mw-character .skill-card .ch-plus[data-skill="kinetic"]').click());
  await page.waitForFunction(
    'window.__game.activeShip.progression.skills.kinetic === 1 && window.__game.activeShip.progression.skillPoints === 1',
    null, { timeout: 5000 });
  const after = await page.evaluate(() => ({
    kineticPts: window.__game.activeShip.progression.skills.kinetic,
    pool: window.__game.activeShip.progression.skillPoints,
    cardPts: document.querySelector('#mw-character .skill-card .sc-pts')?.textContent,
  }));
  assert.equal(after.kineticPts, 1, 'the kinetic allocation incremented server-side');
  assert.equal(after.pool, 1, 'the unspent pool decremented');
  assert.equal(after.cardPts, '1', 'the kinetic card shows its new point count');
  // the menu badge dropped to the 1 remaining free point
  assert.equal(await page.evaluate(() => document.getElementById('mw-char-badge').textContent), '1', 'the badge reflects the spent point');
  await shot('character-spent');

  // ---- The Loadout stats bar shows the ship you FLY (docs/plans/2026-10-22-1334-loadout-skill-stats.md) ----
  // Spend the last point on Mobility from the base: the flown ship must be rebuilt at once (skillSpend →
  // buildPlayerFor — the first run after a spend used to fly the OLD allocation), and the Loadout numbers
  // must be that ship's numbers (deriveShipStats → makePlayer, skills included).
  const openLoadout = async () => {
    await page.evaluate(() => document.querySelector('.mw-item[data-mw="loadout"]').click());
    await page.waitForFunction('document.querySelectorAll("#ship-stats .stat").length === 5', null, { timeout: 5000 });
  };
  await openLoadout();
  const before = await page.evaluate(() => ({
    acc: window.__game.player.acceleration, turn: window.__game.player.turnRate, msm: window.__game.player.maxSpeedMul,
  }));
  assert.ok(Math.abs(before.msm - 1) < 1e-9, `no Mobility yet → maxSpeedMul 1 (got ${before.msm})`);
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="character"]').click());
  await page.waitForFunction('document.querySelectorAll("#mw-character .skill-card").length === 5', null, { timeout: 5000 });
  await page.evaluate(() => document.querySelector('#mw-character .ch-plus[data-skill="mobility"]').click());
  await page.waitForFunction('window.__game.activeShip.progression.skills.mobility === 1', null, { timeout: 5000 });
  await openLoadout();
  const mob = await page.evaluate(() => {
    const num = (i) => { const v = document.querySelectorAll('#ship-stats .stat .v')[i]; return v ? v.firstChild.textContent : null; };
    const p = window.__game.player;
    return { acc: p.acceleration, turn: p.turnRate, msm: p.maxSpeedMul,
      accText: num(1), turnText: num(2), topText: num(4),
      topLabel: (document.querySelectorAll('#ship-stats .stat .k')[4] || {}).textContent };
  });
  // Step 4 regression guard: the spend rebuilt the flown ship (before the fix this read 1).
  assert.ok(Math.abs(mob.msm - 1.05) < 1e-9, `the skill spend rebuilt the ship: maxSpeedMul ${mob.msm} ≈ 1.05`);
  const rel = (a, b) => Math.abs(a - b) <= 1e-9 * Math.abs(b);
  assert.ok(rel(mob.acc, before.acc * 1.05), `acceleration rose 5% (${before.acc} → ${mob.acc})`);
  assert.ok(rel(mob.turn, before.turn * 1.05), `turn rate rose 5% (${before.turn} → ${mob.turn})`);
  // …and the Loadout numbers ARE the flown ship's numbers.
  assert.equal(mob.accText, mob.acc.toFixed(1), 'Loadout Accel = the flown ship\'s acceleration');
  assert.equal(mob.turnText, mob.turn.toFixed(2), 'Loadout Turn = the flown ship\'s turn rate');
  assert.equal(mob.topLabel, 'Top speed', 'the fifth stat is Top speed');
  assert.equal(mob.topText, '31.5', 'Top speed = 30 × 1.05 with one Mobility point');
  await shot('loadout-mobility');

  // ---- A spend response that lands AFTER Take off must not rebuild the ship mid-flight ----
  // (it would put a fresh, full-HP ship back at spawn). It is deferred to the next menu entry instead
  // (rebuildActiveShip / flushActiveShipRebuild in ship-build.js), so the next launch still flies it.
  // Bank one more level (cumulative 4500 XP → level 3 → one unspent point) for a third spend.
  await page.evaluate(async (pid) => {
    await fetch('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: pid, credits: 0, kills: 0, durationMs: 100, xp: 2000 }) });
  }, pid);
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="character"]').click());
  await page.waitForFunction('document.querySelectorAll("#mw-character .skill-card").length === 5', null, { timeout: 5000 });
  await page.evaluate(() => {
    window.__flownShip = window.__game.player;            // the ship "in flight"
    document.body.classList.remove('menu');                // the launch left the base menu (leaveMenu)
    // The client still thinks the pool is empty (it was banked server-side only), so the "+" is disabled;
    // enable it to fire the real skillSpend path — the server has the point.
    const b = document.querySelector('#mw-character .ch-plus[data-skill="mobility"]');
    b.disabled = false; b.click();
  });
  await page.waitForFunction('window.__game.activeShip.progression.skills.mobility === 2', null, { timeout: 5000 });
  const midFlight = await page.evaluate(() => ({
    same: window.__game.player === window.__flownShip, msm: window.__game.player.maxSpeedMul }));
  assert.ok(midFlight.same, 'a spend landing off the menu does NOT rebuild (teleport/heal) the ship in flight');
  assert.ok(Math.abs(midFlight.msm - 1.05) < 1e-9, `the in-flight ship keeps its allocation (maxSpeedMul ${midFlight.msm})`);
  // back to the base menu → the deferred rebuild runs before the next launch
  await page.evaluate(() => window.__game.showMain(null));
  const reentered = await page.evaluate(() => ({
    rebuilt: window.__game.player !== window.__flownShip, msm: window.__game.player.maxSpeedMul,
    menu: document.body.classList.contains('menu') }));
  assert.ok(reentered.menu, 'showMain re-entered the base menu');
  assert.ok(reentered.rebuilt, 're-entering the menu ran the deferred rebuild');
  assert.ok(Math.abs(reentered.msm - 1.10) < 1e-9, `the next launch flies the late spend (maxSpeedMul ${reentered.msm} ≈ 1.10)`);
}
