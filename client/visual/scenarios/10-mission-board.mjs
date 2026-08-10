// Side-mission board (docs/plans/mission-generator.md + 2026-08-08-base-menu-redesign.md, Slice B): after
// clearing the campaign the Main Window "Missions" view shows the mission list in the RIGHT column — the
// campaign card plus three side-mission cards with Take / Defer / Set-active. Selecting a card shows its
// briefing in the center work zone; Take-off flies the ACTIVE mission (server-persisted), which is the
// campaign until a side mission is made active. Also asserts the right-column layout (the list is in the
// column, no cards/ship preview/ship-stats in the work zone) and the two-column collapse on Character.
export const name = '10-mission-board';

export default async function ({ page, assert, shot }) {
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  assert.ok(pid, 'a player id is present');

  // clear the campaign (4 advances → `level-4`, which unlocks the side-mission board), then land on the Main Window
  await page.evaluate(async (pid) => {
    for (let i = 0; i < 4; i++) await fetch(`/api/players/${pid}/advance`, { method: 'POST' });
  }, pid);
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });

  // board = 1 campaign card + 3 side-mission cards once /missions loads; campaign active by default
  await page.waitForFunction('document.querySelectorAll("#mw-mission-board .mission-card").length === 4', null, { timeout: 6000 });
  const board = await page.evaluate(() => ({
    cards: document.querySelectorAll('#mw-mission-board .mission-card').length,
    offers: window.__game.missionOffers.map((m) => m.type).sort(),
    activeInitial: window.__game.activeMissionId,
    campaignActive: document.querySelectorAll('#mw-mission-board .mission-card')[0].classList.contains('active'),
  }));
  assert.equal(board.cards, 4, 'campaign card + 3 side-mission cards');
  assert.deepEqual(board.offers, ['freighter', 'mining', 'research'], 'three flavored offers');
  assert.equal(board.activeInitial, null, 'the campaign is the active mission by default');
  assert.ok(board.campaignActive, 'the campaign card is flagged active');
  // the Missions menu item carries a count badge (offers only — the campaign card isn't counted)
  const badge = await page.evaluate(() => {
    const b = document.getElementById('mw-missions-badge');
    return { text: b.textContent, shown: getComputedStyle(b).display !== 'none' };
  });
  assert.ok(badge.shown, 'the Missions menu item shows its count badge');
  assert.equal(badge.text, '3', 'the badge counts the three offers');
  await shot('board');

  // the list lives in the RIGHT column now; the work zone holds only the mission body
  const layout = await page.evaluate(() => {
    const col = document.getElementById('mw-ship-col').getBoundingClientRect();
    const board = document.getElementById('mw-mission-board').getBoundingClientRect();
    const work = document.getElementById('mw-work').getBoundingClientRect();
    return {
      inColumn: board.left >= col.left - 1 && board.right <= col.right + 1,
      rightOfWork: board.left >= work.right - 1,
      cardsInWork: document.querySelectorAll('#mw-work .mission-card').length,
      shipCanvas: !!document.getElementById('mw-ship'),
      statsShown: getComputedStyle(document.getElementById('ship-stats')).display !== 'none',
      workW: work.width,
    };
  });
  assert.ok(layout.inColumn, 'the mission list renders inside the right column');
  assert.ok(layout.rightOfWork, 'the mission list sits to the right of the work zone');
  assert.equal(layout.cardsInWork, 0, 'no mission cards are left in the center work zone');
  assert.ok(!layout.shipCanvas, 'the right-column ship preview canvas is gone');
  assert.ok(!layout.statsShown, 'ship characteristics are hidden outside Loadout');

  // Character / Map / Craft have no right-column content → the grid collapses to two columns
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="character"]').click());
  await page.waitForTimeout(80);
  const collapsed = await page.evaluate(() => ({
    col: getComputedStyle(document.getElementById('mw-ship-col')).display,
    workW: document.getElementById('mw-work').getBoundingClientRect().width,
  }));
  assert.equal(collapsed.col, 'none', 'Character hides the right column');
  assert.ok(collapsed.workW > layout.workW + 50, 'the work zone takes over the freed width');
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="missions"]').click());
  await page.waitForFunction('document.querySelectorAll("#mw-mission-board .mission-card").length === 4', null, { timeout: 4000 });

  // selecting the first side-mission card renders its title + description + est. reward in the detail area
  await page.evaluate(() => document.querySelectorAll('#mw-mission-board .mission-card')[1].click());
  await page.waitForTimeout(100);
  const panel = await page.evaluate(() => ({
    title: document.getElementById('mw-mission-title').textContent,
    desc: document.getElementById('mw-mission-desc').textContent,
    reward: document.getElementById('mw-mission-reward').textContent,
    missionView: document.getElementById('mw-view-mission').classList.contains('active'),
  }));
  assert.ok(panel.missionView, 'the mission view is shown in the work zone');
  assert.ok(panel.title.length > 0, 'the work zone shows a mission title');
  assert.ok(panel.desc.length > 20, 'the work zone shows a flavor description');
  assert.ok(/\d/.test(panel.reward), 'the work zone shows an est. reward number');
  await shot('panel');

  // Take the first side mission → its card gains a "Taken" badge + a "Set active" button
  const firstId = await page.evaluate(() => window.__game.missionOffers[0].id);
  await page.evaluate(() => document.querySelectorAll('#mw-mission-board .mission-card')[1].querySelector('[data-mact="take"]').click());
  await page.waitForFunction('!!document.querySelectorAll("#mw-mission-board .mission-card")[1].querySelector("[data-mact=\'activate\']")', null, { timeout: 4000 });
  const took = await page.evaluate(() => ({
    taken: window.__game.activeMissionId, // still null — taking doesn't activate
    badge: !!document.querySelectorAll('#mw-mission-board .mission-card')[1].querySelector('.mc-badge.taken'),
  }));
  assert.equal(took.taken, null, 'taking a mission does not change the active one');
  assert.ok(took.badge, 'the taken mission shows a "Taken" badge');
  assert.equal(await page.evaluate(() => document.getElementById('mw-missions-badge').textContent), '3',
    'the menu badge counts every offer, so taking one does not change it');

  // Set it active → it becomes the mission Take-off flies (one active at a time)
  await page.evaluate(() => document.querySelectorAll('#mw-mission-board .mission-card')[1].querySelector('[data-mact="activate"]').click());
  await page.waitForFunction((id) => window.__game.activeMissionId === id, firstId, { timeout: 4000 });
  const marked = await page.evaluate(() => ({
    sideActive: document.querySelectorAll('#mw-mission-board .mission-card')[1].classList.contains('active'),
    campaignActive: document.querySelectorAll('#mw-mission-board .mission-card')[0].classList.contains('active'),
  }));
  assert.ok(marked.sideActive, 'the chosen side mission is now flagged active');
  assert.ok(!marked.campaignActive, 'the campaign is no longer active (one active at a time)');

  // Take off launches the ACTIVE side mission via the levelRunner (flagged sideMission, no story advance)
  await page.evaluate(() => document.getElementById('mw-go').click());
  await page.waitForFunction('!!(window.__game.activeMission)', null, { timeout: 4000 });
  const playing = await page.evaluate(() => ({
    isMenu: document.body.classList.contains('menu'),
    sideMission: !!window.__game.levelRunner.level && !!window.__game.levelRunner.level.sideMission,
    mainHidden: !document.getElementById('mainwin').classList.contains('on'),
  }));
  assert.ok(!playing.isMenu, 'the menu is dismissed when the mission starts');
  assert.ok(playing.sideMission, 'the levelRunner is playing a side mission (flagged, no story advance)');
  assert.ok(playing.mainHidden, 'the Main Window is dismissed on launch');
  await page.waitForTimeout(400); // let the first wave spawn
  const enemies = await page.evaluate(() => window.__game.enemies.length);
  assert.ok(enemies > 0, 'the side mission spawns enemies');
}
