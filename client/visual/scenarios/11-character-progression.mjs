// Character screen (docs/plans/2026-08-09-character-progression.md): bank some XP, land on the Main
// Window, open Character — the header shows the derived level + XP bar + unspent skill points, and the
// five skill cards render. Spending a point via "+" increments that skill and decrements the pool.
// Also catches any JS error in the Character render path (the runner fails on any page error).
export const name = '11-character-progression';

export default async function ({ page, assert, shot }) {
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  assert.ok(pid, 'a player id is present');

  // Advance past the intro (level-0) so the reload lands on the Main Window rather than auto-launching the
  // intro cutscene; then bank 2500 XP → character level 2 with 2 unspent skill points (curve: 1000 to L1,
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
}
