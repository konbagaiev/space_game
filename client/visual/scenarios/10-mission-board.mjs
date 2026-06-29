// Side missions (docs/plans/mission-generator.md + main-window-redesign.md): after clearing the campaign,
// the Main Window's "Missions" list shows the campaign (primary) row plus three side-mission (secondary)
// rows; selecting one renders its description + est. reward into the work zone; Take off launches it via
// the levelRunner (flagged sideMission → banks credits but doesn't advance the story).
export const name = '10-mission-board';

export default async function ({ page, assert, shot }) {
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  assert.ok(pid, 'a player id is present');

  // ensure the campaign is cleared (unlocks the side missions, same gate as the shop), then land on the
  // Main Window (the mission view is the default)
  await page.evaluate(async (pid) => {
    for (let i = 0; i < 4; i++) await fetch(`/api/players/${pid}/advance`, { method: 'POST' });
  }, pid);
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });

  // the Missions list = 1 primary (campaign) row + 3 secondary (side-mission) rows once /missions loads
  await page.waitForFunction('document.querySelectorAll("#mw-mission-list .mw-sub").length === 4', null, { timeout: 6000 });
  const board = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#mw-mission-list .mw-sub')];
    return {
      labels: rows.map((b) => b.textContent),
      offers: window.__game.missionOffers.map((m) => m.type).sort(),
    };
  });
  assert.deepEqual(board.offers, ['freighter', 'mining', 'research'], 'three flavored offers');
  // labels[0] = primary (campaign); labels[1..3] = "Mission 1..3"
  assert.ok(/1/.test(board.labels[1]) && /3/.test(board.labels[3]), 'side rows are labelled Mission 1..3');
  await shot('board');

  // selecting a side row renders its title + description + est. reward into the work zone
  await page.evaluate(() => document.querySelectorAll('#mw-mission-list .mw-sub')[1].click());
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

  // Take off launches the side mission via the levelRunner (sideMission flag set, not the campaign level)
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
