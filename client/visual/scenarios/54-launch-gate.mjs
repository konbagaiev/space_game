// One launch gate (docs/plans/2026-10-20-1816-launch-gate.md, audit A1 + A4). With a required slot empty the
// server reports `launchable: false`, and NOTHING in the base menu may take the ship out. Two drifts this
// guards: (A1) on the Map, "Autopilot to destination" ignored the gate — Take off next to it went grey but
// Autopilot still flew a 0-HP ship into the system; (A4) the "can't launch" hint was written into two
// elements (a note under the mission actions + #mw-takeoff-note), so with a side mission active the
// Missions view showed the same red line twice. The scenario removes the hull through the real Loadout UI, then checks every launcher is
// disabled AND refuses a forced click (each handler checks canLaunch() itself), and that the reason shows once.
// It was seen FAILING on the pre-fix code at the Map Autopilot assertion.
export const name = '54-launch-gate';

const VIS = (el) => !!el && el.checkVisibility({ checkOpacityProperty: true, checkVisibilityCSS: true })
  && el.getBoundingClientRect().height > 0;

export default async function ({ page, assert, shot }) {
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  assert.ok(pid, 'a player id is present');

  // 1. a level-4 player (side-mission board unlocked) with a SIDE mission active — the case where the note
  //    used to double. The worker's player is shared, so don't assume where it starts.
  const setup = await page.evaluate(async (pid) => {
    localStorage.setItem('accountPrompted', '1');
    const lvlN = async () => {
      const j = await (await fetch(`/api/players/${pid}/level`)).json();
      return Number(String(j.name || '').replace('level-', ''));
    };
    let n = await lvlN(), guard = 0;
    while (n < 4 && guard++ < 6) { await fetch(`/api/players/${pid}/advance`, { method: 'POST' }); n = await lvlN(); }
    const ms = await (await fetch(`/api/players/${pid}/missions`)).json();
    const id = ms && ms.missions && ms.missions[0] && ms.missions[0].id;
    const post = (path, body) => fetch(`/api/players/${pid}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (id) await post('missions/take', { missionId: id }); // may already be taken by another scenario
    const act = id ? (await post('missions/activate', { missionId: id })).status : 0;
    return { n, id, act };
  }, pid);
  let hullRemoved = false, hullId = null, ok = false;
  try {
    assert.ok(setup.n >= 4, `the player reached the side-mission level (got level-${setup.n})`);
    assert.ok(setup.id, 'a side mission is on offer');
    assert.ok(setup.act >= 200 && setup.act < 300, `the side mission is active (activate → ${setup.act})`);
    await page.goto(page.url(), { waitUntil: 'load' });
    await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
    await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 8000 });

    // 2. remove the hull through the real Loadout UI → the server reports launchable:false
    hullId = await page.evaluate(() => Number((window.__game.activeShip.components || {}).hull));
    assert.ok(Number.isInteger(hullId), `precondition: the ship has a hull (${hullId})`);
    await page.evaluate(() => document.querySelector('.mw-item[data-mw="loadout"]').click());
    await page.waitForSelector('#loadout-slots .slot-chip', { state: 'attached', timeout: 8000 });
    await page.evaluate(() => document.querySelector('#loadout-slots .slot-chip[data-slot="hull"]').click());
    await page.waitForSelector('#loadout-panel [data-act="unequip"]', { state: 'attached', timeout: 5000 });
    await page.evaluate(() => document.querySelector('#loadout-panel [data-act="unequip"]').click());
    hullRemoved = true;
    await page.waitForFunction('window.__game.activeShip.launchable === false', null, { timeout: 8000 });

    // 3. Map (bug A1): Take off AND Autopilot are greyed, the hint matches the launch-bar note, and a
    //    forced Autopilot click still launches nothing
    await page.evaluate(() => document.querySelector('.mw-item[data-mw="map"]').click());
    await page.waitForSelector('#mw-view-map .sysnav-row', { state: 'attached', timeout: 8000 });
    await page.evaluate(() => document.querySelector('#mw-view-map .sysnav-row:not(.locked)').click());
    const map = await page.evaluate(() => ({
      autopilot: document.querySelector('#mw-view-map [data-act="__autopilot"]').disabled,
      takeoff: document.querySelector('#mw-view-map [data-act="takeoff"]').disabled,
      hint: document.querySelector('#mw-view-map .sysnav-hint').textContent.trim(),
      note: document.getElementById('mw-takeoff-note').textContent.trim(),
    }));
    assert.equal(map.autopilot, true, 'Map Autopilot is disabled');
    assert.equal(map.takeoff, true, 'Map Take off is disabled');
    assert.ok(map.hint, 'the Map hint explains why');
    assert.equal(map.hint, map.note, 'the Map hint is the same can\'t-launch text as #mw-takeoff-note');
    await page.evaluate(() => {
      const b = document.querySelector('#mw-view-map [data-act="__autopilot"]');
      b.disabled = false; b.click();
    });
    await page.waitForTimeout(400); // enterRoam is async
    const mapForced = await page.evaluate(() => ({
      roam: window.__game.roam, mainOn: document.getElementById('mainwin').classList.contains('on') }));
    assert.equal(mapForced.roam, false, 'a forced Map Autopilot click does not enter roam');
    assert.ok(mapForced.mainOn, 'the Main Window is still up after the forced Map Autopilot click');

    // 4. Missions (bug A4): the reason shows ONCE, in #mw-takeoff-note, and it is visible
    await page.evaluate(() => document.querySelector('.mw-item[data-mw="missions"]').click());
    if (await page.evaluate(() => document.getElementById('mainwin').classList.contains('briefing-hide-go'))) {
      await page.evaluate(() => document.getElementById('mw-mission-desc').click());
    }
    await page.waitForFunction('!document.getElementById("mainwin").classList.contains("briefing-hide-go")',
      null, { timeout: 8000 });
    const miss = await page.evaluate((visSrc) => {
      const vis = eval(visSrc);
      const go = document.getElementById('mw-go');
      const noteEl = document.getElementById('mw-takeoff-note');
      const text = noteEl.textContent.trim();
      const lines = text ? [...document.body.querySelectorAll('*')]
        .filter((el) => el.children.length === 0 && el.textContent.trim() === text && vis(el)).length : 0;
      return {
        goShown: getComputedStyle(go).display !== 'none',
        text, noteVisible: vis(noteEl), lines,
        go: go.disabled,
        takeoff: document.getElementById('mw-takeoff').disabled,
        nav: document.getElementById('mw-mission-nav').disabled,
      };
    }, VIS.toString());
    assert.ok(miss.goShown, 'precondition: #mw-go is shown (a side mission is active)');
    assert.ok(miss.text, '#mw-takeoff-note carries the can\'t-launch reason');
    assert.ok(miss.noteVisible, '#mw-takeoff-note is visible on Missions');
    assert.equal(miss.lines, 1, `exactly one visible can't-launch line (saw ${miss.lines})`);
    assert.equal(miss.go, true, '#mw-go is disabled');
    assert.equal(miss.takeoff, true, '#mw-takeoff is disabled');
    assert.equal(miss.nav, true, '#mw-mission-nav is disabled');
    // the note must not run under the fixed #xp-bar (z-index 13, floats over #mainwin's bottom edge). The
    // bar is normally shown on the base; if it isn't, show it just for the measurement so the geometry is
    // still checked (reported in the message).
    const xp = await page.evaluate(() => {
      const bar = document.getElementById('xp-bar');
      const forced = getComputedStyle(bar).display === 'none';
      if (forced) bar.style.display = 'block';
      const n = document.getElementById('mw-takeoff-note').getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      if (forced) bar.style.display = '';
      const r = (x) => ({ top: Math.round(x.top * 10) / 10, bottom: Math.round(x.bottom * 10) / 10,
        left: Math.round(x.left), right: Math.round(x.right) });
      return { forced, note: r(n), bar: r(b),
        overlap: n.bottom > b.top && n.top < b.bottom && n.right > b.left && n.left < b.right };
    });
    assert.equal(xp.overlap, false, `#mw-takeoff-note does not overlap #xp-bar (note ${JSON.stringify(xp.note)}, `
      + `bar ${JSON.stringify(xp.bar)}${xp.forced ? ', bar was hidden — shown for the measurement' : ''})`);
    await shot('gated');

    // 5. every launcher checks the gate in its OWN handler — a forced click launches nothing
    for (const id of ['mw-go', 'mw-mission-nav', 'mw-takeoff']) {
      await page.evaluate((id) => { const b = document.getElementById(id); b.disabled = false; b.click(); }, id);
      await page.waitForTimeout(300);
      const s = await page.evaluate(() => ({
        mainOn: document.getElementById('mainwin').classList.contains('on'),
        roam: window.__game.roam, gameStarted: window.__game.gameStarted,
        activeMission: window.__game.activeMission,
      }));
      assert.ok(s.mainOn, `#${id} forced click: the Main Window is still up`);
      assert.equal(s.roam, false, `#${id} forced click: no roam`);
      assert.equal(s.gameStarted, false, `#${id} forced click: no fight started`);
      assert.ok(s.activeMission == null, `#${id} forced click: no mission is being played`);
      await page.evaluate(() => window.__game.updateTakeoffGate(window.__game.activeShip));
    }
    ok = true;
  } finally {
    // 6. leave the shared worker player as found: hull back on, campaign active (53's setup expects that)
    let equip = null;
    try {
      equip = await page.evaluate(async ({ pid, hullRemoved, hullId }) => {
        const post = (path, body) => fetch(`/api/players/${pid}/${path}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        let st = null;
        if (hullRemoved) st = (await post('equip', { kind: 'component', refId: Number(hullId) })).status;
        await post('missions/activate', { missionId: null });
        return st;
      }, { pid, hullRemoved, hullId });
    } catch (e) {
      if (ok) throw e;
    }
    if (ok && hullRemoved) assert.ok(equip >= 200 && equip < 300, `the hull was re-equipped (${equip})`);
  }
}
