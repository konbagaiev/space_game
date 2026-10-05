// The bot brawl (`?brawl`), in an actual browser.
//
// The node tests prove the fight (determinism, nothing escapes); this proves the RUN: the flag boots
// straight into a 1v1 over the home station, the bots get bodies in their liveries, the camera frames the
// FIGHT (not the parked spectator) — the station and a ship project inside the frame and planet 2 has not
// faded — a click follows a bot and a second click returns to the centre, the run ends into a card that
// is on screen and above the controls, and nothing but `/api/perf` leaves the page while it runs, including
// one `brawl-result` sample. And with the flag OFF nothing about it exists.
export const name = '51-bot-brawl';

const stepSim = (page, ticks) => page.evaluate((n) => window.__game.stepSim(n), ticks);

// Everything the assertions read, in one evaluate: positions projected through the LIVE camera.
const probe = (page) => page.evaluate(() => {
  const g = window.__game;
  const P = (x, y, z) => { const v = g.camera.position.clone().set(x, y, z).project(g.camera); return { x: v.x, y: v.y }; };
  const inNdc = (p) => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
  const st = g.baseStation && g.baseStation.obj;
  const sp = st ? st.getWorldPosition(st.position.clone()) : null;
  const ships = [...g.allies, ...g.enemies].map((s) => {
    const p = P(s.pos.x, s.pos.y, s.pos.z);
    return { side: g.allies.includes(s) ? 'blue' : 'red', id: s._aimOrdinal, color: s.color, warping: !!s.warping,
             inScene: !!(s.mesh && s.mesh.parent), ndc: p, onScreen: inNdc(p) };
  });
  const planet2 = (g.systemBodies || []).find((b) => b.name === 'planet2');
  return {
    brawl: g.brawl,
    stationOnScreen: sp ? inNdc(P(sp.x, sp.y, sp.z)) : null,
    ships,
    spectatorDist: Math.hypot(g.player.pos.x - (-10), g.player.pos.z - (-10)),
    spectatorHp: g.player.hp,
    planet2Visible: !!(planet2 && planet2.mesh.visible),
    kills: g.kills,
    bodyBrawl: document.body.classList.contains('brawl'),
  };
});

export default async function ({ page, assert, shot }) {
  const base = page.url().split('?')[0];

  // The player's SAVED zoom must survive a brawl (it frames every run at zoom 1 for this page only).
  await page.evaluate(() => localStorage.setItem('camZoom', '1.700'));

  // ---- flag ON: one bot per side (the fight wipes out in ~10 sim-s), the cheap tier ----
  await page.goto(`${base}?debug&brawl=1&tier=performance&sec=300`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.brawl && window.__game.brawl.armed)', null, { timeout: 30000 });

  // From the arming on, the only POSTs allowed are perf telemetry — and nothing to the funnel, the session
  // recorder or the game history. (Boot-time POSTs, e.g. the anonymous player, happen before this.)
  const posts = [];
  const onReq = (r) => posts.push({ method: r.method(), url: r.url(), body: r.method() === 'POST' ? (r.postData() || '') : '' });
  page.on('request', onReq);

  await page.evaluate(() => window.__game.setPaused(true));   // stepSim is now the only driver
  {
    const vp = page.viewportSize();
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await page.mouse.wheel(0, -400);                              // zoom input during a brawl is ignored…
    assert.equal(await page.evaluate(() => localStorage.getItem('camZoom')), '1.700',
      '…and neither the run\'s zoom-1 framing nor that input overwrote the saved zoom');
  }
  const opening = await probe(page);
  assert.equal(opening.brawl.n, 1);
  assert.equal(opening.ships.length, 2, 'one blue, one red');
  assert.ok(opening.bodyBrawl, 'body.brawl is set (the input controls are hidden)');
  assert.ok(opening.ships.some((s) => s.onScreen), 'at least one ship is in the frame at the opening');

  const sample = [];
  let first = null;
  for (let i = 0; i < 8; i++) {
    await stepSim(page, 30);
    const s = await probe(page);
    if (!first) first = s;
    sample.push(s);
    if (s.ships.length < 2) break;
    for (const sh of s.ships) {
      assert.ok(sh.inScene, `the ${sh.side} bot has a body in the scene`);
      if (sh.side === 'red') assert.equal(sh.color, 0xff5a4a, 'red flies the hostile livery');
    }
    assert.ok(s.spectatorDist >= 4900, `the spectator stays parked (${s.spectatorDist.toFixed(0)} u)`);
    assert.equal(s.spectatorHp, opening.spectatorHp, 'and is never hit');
    assert.equal(s.brawl.cam, 'centre');
    assert.equal(s.stationOnScreen, true, 'PERCEPTION: in centre mode the station projects inside the frame');
    assert.equal(s.planet2Visible, true, 'planet 2 has not faded — the sky reads the VIEW, not the parked ship');
  }
  await shot('bot-brawl-mid');

  // ONE PASS FOR DOUBLE-SIDED SHIP MATERIALS (DECISIONS §159): three.js draws a transparent DoubleSide
  // material twice and bumps its version before each pass, which re-runs getProgram per ship per frame. Every
  // ship body must carry `forceSinglePass`, and over a few rendered frames no ship material's version moves.
  const glass = await page.evaluate(async () => {
    const g = window.__game, mats = new Set();
    for (const s of [...g.allies, ...g.enemies]) if (s.mesh) s.mesh.traverse((o) => {
      if (o.isMesh && o.material) for (const m of [].concat(o.material)) mats.add(m);
    });
    const twoPass = [...mats].filter((m) => m.side === 2 && !m.forceSinglePass).map((m) => m.name || m.type);
    const sum = () => [...mats].reduce((a, m) => a + m.version, 0);
    const v0 = sum();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
    return { n: mats.size, doubleSided: [...mats].filter((m) => m.side === 2).length, twoPass, bumps: sum() - v0 };
  });
  assert.ok(glass.n > 0 && glass.doubleSided > 0, `the ship bodies really carry double-sided materials (${JSON.stringify(glass)})`);
  assert.deepEqual(glass.twoPass, [], 'no double-sided ship material is drawn in two passes');
  assert.equal(glass.bumps, 0, 'and no ship material is re-versioned (= getProgram re-run) on a plain rendered frame');

  // ---- tap-to-follow: click the blue bot, then anywhere ----
  const now = await probe(page);
  const blue = now.ships.find((s) => s.side === 'blue' && !s.warping && s.onScreen);
  if (blue && now.ships.length === 2) {
    const vp = page.viewportSize();
    await page.mouse.click((blue.ndc.x + 1) / 2 * vp.width, (1 - blue.ndc.y) / 2 * vp.height);
    await page.waitForTimeout(50);
    assert.equal((await page.evaluate(() => window.__game.brawl.cam)), 'bot', 'a click on a bot follows it');
    await page.mouse.click(vp.width * 0.5, vp.height * 0.5);
    await page.waitForTimeout(50);
    assert.equal((await page.evaluate(() => window.__game.brawl.cam)), 'centre', 'a second click goes back to the centre');
  } else {
    assert.fail(`no on-screen, formed blue bot to click (${JSON.stringify(now.ships)})`);
  }

  // ---- end it, then the card ----
  // This seed's 1v1 now runs ~129 sim-s (both pilots retreat to heal), so after a further 10 s of real
  // stepping the scenario ends the fight itself through the debug hook: red's hull to 0, and the brawl's
  // own death step takes it from there (allyDown, no kill, wipe-out on that tick).
  for (let i = 0; i < 20; i++) await stepSim(page, 30);
  await page.evaluate(() => { for (const e of window.__game.enemies) e.hp = 0; window.__game.stepSim(1); });
  await page.waitForFunction('window.__game.brawl.ended && window.__game.brawl.cardVisible', null, { timeout: 5000 });
  const card = await page.evaluate(() => {
    const el = document.getElementById('brawl-card');
    const r = el.querySelector('.brawl-box').getBoundingClientRect();
    return {
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      vw: window.innerWidth, vh: window.innerHeight,
      z: Number(getComputedStyle(el).zIndex),
      text: el.textContent,
      windowRows: el.querySelectorAll('.brawl-win tr').length - 1,
      brawl: window.__game.brawl, kills: window.__game.kills,
    };
  });
  assert.ok(card.rect.left >= 0 && card.rect.top >= 0 && card.rect.right <= card.vw && card.rect.bottom <= card.vh,
    `the card is inside the viewport (${JSON.stringify(card.rect)} in ${card.vw}x${card.vh})`);
  assert.ok(card.z >= 10, `and above the touch controls (z-index ${card.z})`);
  for (const w of ['sim/wall', 'p95', 'full load']) assert.ok(card.text.includes(w), `the card shows "${w}"`);
  assert.ok(card.windowRows >= 1, 'with at least one per-window row');
  assert.equal(card.brawl.interrupted, true, 'paused for the scenario → honestly flagged INTERRUPTED');
  assert.equal(card.kills, 0, 'and a brawl kill is never a campaign kill');

  // The result sample left the page.
  for (let i = 0; i < 50 && !posts.some((p) => p.body.includes('"brawl-result"')); i++) await page.waitForTimeout(100);
  page.off('request', onReq);
  const bad = posts.filter((p) => p.method === 'POST' && !p.url.includes('/api/perf'));
  assert.deepEqual(bad.map((p) => p.url), [], 'no POST but /api/perf after arming');
  assert.ok(!posts.some((p) => /\/api\/(events|sessions|games)/.test(p.url)), 'nothing to events/sessions/games');
  assert.equal(posts.filter((p) => p.body.includes('"brawl-result"')).length, 1, 'exactly one brawl-result sample');
  await shot('bot-brawl-card');

  assert.equal(await page.evaluate(() => localStorage.getItem('camZoom')), '1.700', 'the saved zoom is still the player\'s');
  await page.evaluate(() => localStorage.removeItem('camZoom'));

  // ---- a LANDSCAPE PHONE (800x390, touch): the setup panel and a full 7-window card must stay clear of the
  //      settings gear, the XP bar and the touch-only fullscreen button ----
  {
    const ctx = await page.context().browser().newContext({ viewport: { width: 800, height: 390 }, hasTouch: true, deviceScaleFactor: 1 });
    const phone = await ctx.newPage();
    try {
      const clear = (sel) => phone.evaluate((s) => {
        const box = document.querySelector(`${s} .brawl-box`).getBoundingClientRect();
        const hit = (id) => {
          const e = document.getElementById(id);
          if (!e) return null;
          const r = e.getBoundingClientRect();
          if (!r.width || !r.height || getComputedStyle(e).display === 'none') return null;
          const o = !(r.right <= box.left || r.left >= box.right || r.bottom <= box.top || r.top >= box.bottom);
          return o ? `${id} ${JSON.stringify([r.left, r.top, r.right, r.bottom])}` : null;
        };
        return {
          box: [box.left, box.top, box.right, box.bottom], vw: innerWidth, vh: innerHeight,
          overlaps: ['settings-btn', 'xp-bar', 'fullscreen-btn'].map(hit).filter(Boolean),
        };
      }, sel);
      await phone.goto(`${base}?debug&brawl`, { waitUntil: 'load' });
      await phone.waitForFunction('document.getElementById("brawl-setup").classList.contains("on")', null, { timeout: 15000 });
      const su = await clear('#brawl-setup');
      assert.deepEqual(su.overlaps, [], `phone setup panel overlaps nothing (${JSON.stringify(su)})`);
      assert.ok(su.box[0] >= 0 && su.box[1] >= 0 && su.box[2] <= su.vw && su.box[3] <= su.vh, 'and is on screen');
      await phone.screenshot({ path: 'visual/__screenshots__/51-bot-brawl__phone-setup.png' });
      // Step 72 sim-s of a 5 v 5 (small chunks with a real frame after each: a window row is built from the
      // FRAMES that ended inside it, so the page must draw at least once per window), then end it through
      // the debug hook → a full 8-window card.
      await phone.goto(`${base}?debug&brawl=5&tier=performance&sec=300`, { waitUntil: 'load' });
      await phone.waitForFunction('!!(window.__game && window.__game.brawl && window.__game.brawl.armed)', null, { timeout: 30000 });
      await phone.evaluate(() => window.__game.setPaused(true));
      for (let i = 0; i < 29; i++) {
        await phone.evaluate(() => new Promise((res) => {
          window.__game.stepSim(150);
          requestAnimationFrame(() => requestAnimationFrame(() => res()));
        }));
      }
      await phone.evaluate(() => { for (const e of window.__game.enemies) e.hp = 0; window.__game.stepSim(1); });
      await phone.waitForFunction('window.__game.brawl.cardVisible', null, { timeout: 30000 });
      const rows = await phone.evaluate(() => document.querySelectorAll('#brawl-card .brawl-win tr').length - 1);
      assert.ok(rows >= 7, `a full window table (${rows} rows)`);
      const cd = await clear('#brawl-card');
      assert.deepEqual(cd.overlaps, [], `phone result card overlaps nothing (${JSON.stringify(cd)})`);
      assert.ok(cd.box[0] >= 0 && cd.box[1] >= 0 && cd.box[2] <= cd.vw && cd.box[3] <= cd.vh, 'and is on screen (it scrolls inside)');
      await phone.screenshot({ path: 'visual/__screenshots__/51-bot-brawl__phone-card.png' });
    } finally {
      await ctx.close();
    }
  }

  // ---- a bare ?brawl: the setup panel, on screen, with a working stepper and no run ----
  await page.goto(`${base}?debug&brawl`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && document.getElementById("brawl-setup").classList.contains("on"))', null, { timeout: 8000 });
  await page.click('#brawl-plus'); await page.click('#brawl-plus'); await page.click('#brawl-minus');
  const setup = await page.evaluate(() => {
    const el = document.getElementById('brawl-setup');
    const r = el.querySelector('.brawl-box').getBoundingClientRect();
    return {
      n: document.getElementById('brawl-n').textContent,
      tiers: [...document.querySelectorAll('#brawl-tiers button')].map((b) => b.dataset.tier),
      onTier: document.querySelector('#brawl-tiers button.on')?.dataset.tier,
      inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      z: Number(getComputedStyle(el).zIndex), brawl: window.__game.brawl,
    };
  });
  assert.equal(setup.n, '21', 'the stepper moves from the default 20');
  assert.deepEqual(setup.tiers, ['high', 'balance', 'performance']);
  assert.ok(setup.onTier, 'the saved tier is preselected');
  assert.ok(setup.inside && setup.z >= 10, 'the panel is on screen, above the controls');
  assert.equal(setup.brawl, null, 'and no run has started');

  // ---- flag OFF: nothing of it exists ----
  await page.goto(`${base}?debug`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  const off = await page.evaluate(() => ({
    brawl: window.__game.brawl,
    bodyBrawl: document.body.classList.contains('brawl'),
    planet2Visible: !!((window.__game.systemBodies || []).find((b) => b.name === 'planet2')?.mesh.visible),
  }));
  assert.equal(off.brawl, null, 'no ?brawl → no brawl state');
  assert.equal(off.bodyBrawl, false);
  assert.equal(off.planet2Visible, true);
}
