// Side-mission board (docs/plans/mission-generator.md): after clearing the campaign, three mission
// buttons appear top-right on the menu; clicking one opens a description panel; Take off launches the
// mission via the levelRunner (flagged sideMission → banks credits but doesn't advance the story).
export const name = '10-mission-board';

export default async function ({ page, assert, shot }) {
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  assert.ok(pid, 'a player id is present');

  // ensure the campaign is cleared (unlocks the board, same gate as the shop), then land on the Hangar
  await page.evaluate(async (pid) => {
    for (let i = 0; i < 4; i++) await fetch(`/api/players/${pid}/advance`, { method: 'POST' });
  }, pid);
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });

  // the 3 mission buttons render top-right once /missions loads
  await page.waitForFunction('document.querySelectorAll("#mission-btns button").length === 3', null, { timeout: 6000 });
  const board = await page.evaluate(() => ({
    on: document.body.classList.contains('missions-on'),
    labels: [...document.querySelectorAll('#mission-btns button')].map((b) => b.textContent),
    offers: window.__game.missionOffers.map((m) => m.type).sort(),
  }));
  assert.ok(board.on, 'the board is shown (missions-on)');
  assert.deepEqual(board.offers, ['freighter', 'mining', 'research'], 'three flavored offers');
  assert.ok(/1/.test(board.labels[0]) && /3/.test(board.labels[2]), 'buttons are labelled Mission 1..3');
  await shot('board');

  // clicking a button opens the description panel with title + description + est. reward
  await page.click('#mission-btns button');
  await page.waitForSelector('#mission-panel.on', { timeout: 3000 });
  const panel = await page.evaluate(() => ({
    title: document.getElementById('mp-title').textContent,
    desc: document.getElementById('mp-desc').textContent,
    reward: document.getElementById('mp-reward').textContent,
  }));
  assert.ok(panel.title.length > 0, 'panel shows a mission title');
  assert.ok(panel.desc.length > 20, 'panel shows a flavor description');
  assert.ok(/\d/.test(panel.reward), 'panel shows an est. reward number');
  await shot('panel');

  // Take off launches the side mission via the levelRunner (sideMission flag set, not the campaign level)
  await page.click('#mp-launch');
  await page.waitForFunction('!!(window.__game.activeMission)', null, { timeout: 4000 });
  const playing = await page.evaluate(() => ({
    isMenu: document.body.classList.contains('menu'),
    sideMission: !!window.__game.levelRunner.level && !!window.__game.levelRunner.level.sideMission,
    panelClosed: !document.getElementById('mission-panel').classList.contains('on'),
  }));
  assert.ok(!playing.isMenu, 'the menu is dismissed when the mission starts');
  assert.ok(playing.sideMission, 'the levelRunner is playing a side mission (flagged, no story advance)');
  assert.ok(playing.panelClosed, 'the description panel closes on launch');
  await page.waitForTimeout(400); // let the first wave spawn
  const enemies = await page.evaluate(() => window.__game.enemies.length);
  assert.ok(enemies > 0, 'the side mission spawns enemies');
}
