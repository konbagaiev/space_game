// The SERVER-RUN bot brawl (`?netbrawl`), in an actual browser against the real local server
// (docs/plans/2026-10-06-1530-server-brawl.md).
//
// The node tests prove the room (it fights the headless brawl tick for tick, the cap, the backstop, the
// slow-link guard, `srv`); this proves the TAB: the flag connects a room by itself, the room's ships arrive
// as ghosts with bodies — red ones as aces with their wing accent, which were invisible before the `ace`
// descriptor — the run arms, the server's per-second load numbers arrive, the card says "server room" and
// shows the server columns, the perf telemetry carries `srv`, nothing but `/api/perf` leaves the page, and at
// the card the link is closed for good (no new room is opened behind it). A bare `?netbrawl` is the setup
// panel and opens no socket at all.
//
// Like 37-netsim this cannot `stepSim`: the ROOM runs on its own 60 Hz wall clock. The waits are generous
// for the same reason (headless software GL draws a few frames a second under load); every assertion is on
// state, never on elapsed time.
export const name = '52-bot-brawl-netsim';

const SLOW = 90000;

export default async function ({ page, assert, shot, baseURL }) {
  const origin = new URL(baseURL).origin;

  // Capture from the start; the "nothing but perf" check filters to after arming below.
  const posts = [];
  let armedAt = Infinity;
  const onReq = (r) => posts.push({ at: Date.now(), method: r.method(), url: r.url(),
                                    body: r.method() === 'POST' ? (r.postData() || '') : '' });
  page.on('request', onReq);

  await page.goto(`${origin}/?debug&netbrawl=2&tier=performance&sec=10`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__netsim && window.__netsim.connected && window.__game && window.__game.brawl && window.__game.brawl.armed)',
    null, { timeout: SLOW });
  armedAt = Date.now();

  const armed = await page.evaluate(() => {
    const g = window.__game;
    const ship = (s) => ({ mesh: !!(s.mesh && s.mesh.parent), accent: s.accent ? s.accent.prefix : null, name: s.name });
    return {
      brawl: g.brawl, netBrawl: window.__netsim.brawl, level: window.__netsim.level,
      allies: g.allies.map(ship), enemies: g.enemies.map(ship),
      bodyBrawl: document.body.classList.contains('brawl'),
    };
  });
  assert.equal(armed.brawl.server, true, 'the tab mirrors a SERVER brawl');
  assert.equal(armed.netBrawl, 2, 'and asked the room for 2 a side');
  assert.equal(armed.level, 'level-1', 'the room fights the brawl level');
  assert.equal(armed.allies.length, 2, `two blue ghosts (${JSON.stringify(armed.allies)})`);
  assert.equal(armed.enemies.length, 2, `two red ghosts (${JSON.stringify(armed.enemies)})`);
  for (const s of [...armed.allies, ...armed.enemies]) assert.ok(s.mesh, `every ghost has a body in the scene (${JSON.stringify(s)})`);
  for (const s of armed.enemies) assert.equal(s.accent, 'Wings_', 'red ghosts are built as aces, with the wing accent');
  assert.ok(armed.bodyBrawl, 'body.brawl is set');
  await shot('netbrawl-armed');

  // The server's per-second load numbers reach the mirror (only after the ROOM armed — the tab's input did that).
  await page.waitForFunction('window.__game.brawl.srvCount > 0', null, { timeout: SLOW });
  const srv = await page.evaluate(() => ({ last: window.__game.brawl.lastSrv, net: window.__netsim.lastSrv }));
  assert.ok(srv.last && typeof srv.last.stepMs.p95 === 'number', `a srv sample with a step p95 (${JSON.stringify(srv.last)})`);
  assert.ok(srv.last.snapBytes.sum > 0, 'and real bytes');
  assert.ok(srv.net, '__netsim.lastSrv is exposed');
  await shot('netbrawl-fight');   // the room has armed: the ships have warped in and are fighting

  // The run ends on its 10 s wall limit (or a wipe-out) into the card.
  await page.waitForFunction('window.__game.brawl.cardVisible', null, { timeout: SLOW });
  const card = await page.evaluate(() => {
    const el = document.getElementById('brawl-card');
    return {
      text: el.textContent,
      head: [...el.querySelectorAll('.brawl-win tr:first-child th')].map((t) => t.textContent),
      result: window.__game.brawl.result,
    };
  });
  assert.ok(card.text.includes('Simulated by') && card.text.includes('server room'), 'the card says who simulated it');
  assert.ok(card.head.includes('srv step p95'), `the window table has the server columns (${JSON.stringify(card.head)})`);
  assert.equal(card.result.server, true);
  assert.ok(card.result.srv, 'the result carries the server summary');
  assert.ok(['time', 'wipeout'].includes(card.result.endedBy), `ended normally (${card.result.endedBy})`);
  await shot('netbrawl-card');

  // The per-second perf sample carried a `srv` block (the driver's window starts with `t`), and the result left.
  for (let i = 0; i < 60 && !posts.some((p) => p.body.includes('"brawl-result"')); i++) await page.waitForTimeout(100);
  assert.ok(posts.some((p) => p.url.includes('/api/perf') && p.body.includes('"srv":{"t":')), 'a /api/perf sample carried the room\'s srv block');
  assert.equal(posts.filter((p) => p.body.includes('"brawl-result"')).length, 1, 'exactly one brawl-result sample');

  // At the card the link is closed (bye) — and STAYS closed: no new brawl room is opened behind the card.
  await page.waitForTimeout(2000);
  assert.equal(await page.evaluate(() => window.__netsim.connected), false, 'the link closed at the card');
  assert.equal(await page.evaluate(() => window.__game.brawl.linkClosed), true);
  await page.waitForTimeout(2000);
  assert.equal(await page.evaluate(() => window.__netsim.connected), false, 'and no reconnect into a new room');

  page.off('request', onReq);
  const after = posts.filter((p) => p.at >= armedAt);
  assert.ok(!after.some((p) => /\/api\/(games|sessions|events)/.test(p.url)), 'nothing to games/sessions/events after arming');
  const bad = after.filter((p) => p.method === 'POST' && !p.url.includes('/api/perf'));
  assert.deepEqual(bad.map((p) => p.url), [], 'no POST but /api/perf after arming');

  // ---- a bare ?netbrawl: the setup panel, saying "server room", and no socket ----
  await page.goto(`${origin}/?debug&netbrawl`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && document.getElementById("brawl-setup").classList.contains("on"))', null, { timeout: 15000 });
  const setup = await page.evaluate(() => ({
    mode: document.getElementById('brawl-mode').textContent,
    errorHidden: document.getElementById('brawl-error').hidden,
    netsim: typeof window.__netsim,
    brawl: window.__game.brawl,
  }));
  assert.equal(setup.mode, 'Simulated by: server room');
  assert.equal(setup.errorHidden, true, 'no error on a fresh panel');
  assert.equal(setup.netsim, 'undefined', 'a bare ?netbrawl opens no socket (it would take a brawl slot)');
  assert.equal(setup.brawl, null, 'and no run has started');
  await page.fill('#brawl-n', '3');
  await Promise.all([page.waitForURL(/[?&]netbrawl=3&/), page.click('#brawl-start')]);   // Start keeps the server flag
}
