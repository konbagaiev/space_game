// THE PLAYABLE LEVEL-0 INTRO — the fight you fly, with a scripted director talking over it.
// docs/plans/2026-08-30-1654-playable-intro.md.
//
// This is the one scenario that runs WITH the director armed: the runner silences it for everyone else
// (`__game.silenceIntro()`), so every assertion about the line, the controls card and the Skip row lives
// here. It re-boots on its own page after resetting this page's throwaway player to progress 0, which is
// what makes the server serve the level-0 descriptor (and therefore the director script) at all.
//
// CLOCK DISCIPLINE IS THE THING TO GET RIGHT. `__game.stepSim(n)` calls update(BENCH_DT) directly, but the
// live rAF accumulator is stepping the sim at the same time, so a bare step COUNT asserts against an unknown
// clock. So: freeze the live loop with `setPaused(true)` (animate() gates its accumulator on !G.paused while
// leaving stepSim and the render half running), make stepSim the only driver, and assert on
// `__game.combatElapsed` — never on a number of steps, and never on a wall-clock sleep.
export const name = 'playable-intro';

const EN_L0 = "First posting, fresh commission, an easy hop out to the station. …Contact on approach — "
  + "no transponder, no answer to my hails. Whatever that is, it's swinging onto me.";

export default async function ({ page, assert, shot, baseURL }) {
  // Reset this page's throwaway player to progress 0 (the same endpoint 14-reset-progress mocks and
  // 97-briefing-showcase drives), then boot the intro on a fresh page. The fetch is awaited INSIDE the
  // evaluate so Playwright is never handed a Response to serialize (mirrors 18-briefing-staged-reveal),
  // and the reset is CONFIRMED against the served level before reloading — the server is what decides
  // whether this boot gets the intro at all, and a reload that races an in-flight write lands on level-1
  // with no director and fails several assertions down.
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  const resetToIntro = () => page.evaluate(async (id) => {
    for (let i = 0; i < 10; i++) {
      await fetch(`/api/players/${id}/reset`, { method: 'POST' });
      const lvl = await (await fetch(`/api/players/${id}/level`)).json();
      if (lvl && lvl.name === 'level-0') return lvl.name;
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  }, pid);
  assert.equal(await resetToIntro(), 'level-0', 'the player is back at progress 0, so the server serves the intro');
  await page.goto(baseURL, { waitUntil: 'load' });   // ?debug — the intro is NOT gated off headless any more
  // Freeze the live accumulator INSIDE the wait, so no frame can slip between the two. It must also wait for
  // `gameStarted`, not just `player`: bootstrap builds the ship well before the level-0 branch, and that
  // branch's reset() calls setPaused(false) — pausing too early would simply be undone.
  await page.waitForFunction(() => {
    const g = window.__game;
    if (!g || !g.player || !g.gameStarted) return false;
    g.setPaused(true);   // stepSim is now the ONLY driver of the clock
    return true;
  }, null, { timeout: 15000 });

  // Advance the SIM CLOCK to `t` seconds. Returns where it actually landed.
  const stepTo = (t) => page.evaluate((target) => {
    const g = window.__game;
    let guard = 0;
    while (g.combatElapsed < target && guard++ < 20000) g.stepSim(1);
    return g.combatElapsed;
  }, t);
  // The director's LINE is written to the DOM by updateIntro() in the render half, ONCE PER FRAME — so after
  // stepping the sim we wait for the DOM to catch up rather than reading it on the next tick of our own
  // clock. Under a loaded machine the harness renders at a few fps, and a fixed number of rAFs is not a
  // guarantee. (The controls card is different: its show/fly commands run inside introTick, synchronously
  // with the tick that emits them.) `lineShown(false)` waits for the slot to be EMPTY.
  const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const lineShown = (want = true) => page.waitForFunction(
    (w) => (getComputedStyle(document.getElementById('intro-line')).display !== 'none') === w, want, { timeout: 10000 });

  // ---- 1. Live and recorded ----------------------------------------------------------------
  // The funnel value of the whole change: the level new players drop off on is finally a recorded session.
  const boot = await page.evaluate(() => ({ rec: window.__game.sessionRec(), level: window.__game.levelName,
                                            started: window.__game.gameStarted }));
  assert.equal(boot.level, 'level-0', 'a progress-0 player boots into the intro level');
  assert.equal(boot.started, true, 'and straight into the fight — no welcome screen, no Take-off');
  assert.equal(boot.rec.active, true, 'the always-on session recorder is armed (beginLiveSession in bootstrap)');
  assert.equal(boot.rec.level, 'level-0', 'and it is recording the INTRO, not some later level');

  // ---- 2. The opening line, and it does not eat input --------------------------------------
  // One tick is all L0 needs: it is the `on: 'start'` beat. (The live accumulator is frozen, so without
  // this the director has never been ticked at all.)
  await page.evaluate(() => window.__game.stepSim(1));
  // Assert the SIM state first — deterministic, and it names the cause if the director never armed…
  const armed = await page.evaluate(() => window.__game.intro);
  assert.ok(armed, 'the director is armed on level-0 (CATALOG.level.intro came off the served descriptor)');
  assert.deepEqual(armed.fired, ['l0'], 'and L0 fires on the very first sim tick');
  assert.equal(armed.view.lineAlpha, 1);
  // …then wait for the render half to publish it, rather than assuming a fixed number of frames.
  await lineShown(true);
  const line = await page.evaluate(() => {
    const el = document.getElementById('intro-line');
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { display: cs.display, opacity: Number(cs.opacity), text: el.textContent,
             hitTag: hit && hit.tagName, hitId: hit && hit.id };
  });
  assert.equal(line.display, 'block', 'L0 is on screen from the first second');
  assert.ok(line.opacity > 0.9, `and fully opaque (got ${line.opacity})`);
  assert.equal(line.text, EN_L0, 'showing the English ui.intro.l0');
  // THE HARD CONSTRAINT: the player is flying UNDERNEATH this. #stick-zone is a full-screen
  // pointer-events:auto layer, so an interactive overlay here would swallow steering and fire taps.
  assert.equal(line.hitTag, 'CANVAS', `the point at the line's own centre hits the canvas, not #${line.hitId} `
    + '— every intro node is pointer-events:none');

  // ---- 3. The spawn floor, end to end ------------------------------------------------------
  const at = await stepTo(2.9);
  if (at < 3) {   // read it first rather than racing the frames that ran before the pause
    const n = await page.evaluate(() => window.__game.enemyCount);
    assert.equal(n, 0, `nothing has warped in at ${at.toFixed(2)} s — the first pirate waits for the opening line`);
  }
  await stepTo(3.1);
  assert.equal(await page.evaluate(() => window.__game.enemyCount), 1,
    'the first pirate warps in the moment the 3 s floor lifts (spawn.earliest[0])');

  // ---- 4. The controls card ----------------------------------------------------------------
  await stepTo(5.2);   // lineHold 3 + lineFade 2 → the card takes the slot the line has vacated
  await lineShown(false);   // the opening line has faded out of the slot the card is taking
  const card = await page.evaluate(() => {
    const el = document.getElementById('intro-help');
    return { display: getComputedStyle(el).display, opacity: Number(getComputedStyle(el).opacity),
             text: el.textContent, help: window.__game.intro.help,
             lineGone: getComputedStyle(document.getElementById('intro-line')).display };
  });
  assert.equal(card.display, 'block', 'the controls card appears once the opening line has faded');
  assert.equal(card.help, 'hold');
  assert.ok(card.opacity > 0.9, `and is fully opaque while it holds (got ${card.opacity})`);
  assert.ok(/thrust/i.test(card.text) && /rocket/i.test(card.text),
    `it carries the desktop cheatsheet (ui.help): "${card.text}"`);
  assert.equal(card.lineGone, 'none', 'and the line slot it took is empty');
  await shot('card-held');

  await stepTo(8.7);   // + helpHold 3.5 → the flight begins
  assert.ok(await page.evaluate(() => document.getElementById('intro-help').classList.contains('fly')),
    'at 8.5 s the card starts flying into the bottom-left cheatsheet');

  // ---- 5. The flight LANDS — an outcome, not a class ---------------------------------------
  // The CSS transition runs on WALL clock (this is DOM, not sim), so poll the rect. This is what fails if
  // the `-50%` centring is dropped from the composed transform: the card would land half its own width to
  // the right of #help.
  await page.waitForFunction(() => {
    const a = document.getElementById('intro-help').getBoundingClientRect();
    const b = document.getElementById('help').getBoundingClientRect();
    return Math.abs(a.left - b.left) <= 4 && Math.abs(a.top - b.top) <= 4
        && Math.abs(a.width - b.width) <= 0.15 * b.width;
  }, null, { timeout: 3000 });
  // …and it FADED on the way. This is what fails if opacity is left to the .fly class rule — the inline
  // `opacity: 1` showIntroHelp sets would beat it and the card would sit on #help at full opacity forever.
  // Polled rather than read once: the rect converges at ~80–90 % of the 450 ms `ease` transition.
  await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('intro-help')).opacity) < 0.05,
    null, { timeout: 2000 });
  await shot('card-landed');
  await stepTo(9.5);   // + helpFly 0.9 → the card is taken down for good
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('intro-help')).display), 'none',
    'and is removed once it has arrived — #help is where the controls live from now on');

  // ---- 6. The TOP band does not collide, on desktop and on a landscape phone ----------------
  // The line slot sits at `top: max(14vh, 76px)`, centred. Its neighbours up there are the two HUD corner
  // clusters, the settings gear, the pause button, the battle radar (top-LEFT, 132px square) and — on touch
  // only — the zoom column (top-RIGHT). Every one of them is measured, not assumed: the slot is centred
  // BETWEEN the radar and the zoom column rather than moved away from them, and 9px of that clearance is all
  // there is on an 812px-wide phone, so this is the assertion that catches a width or offset change.
  //
  // `#banner` is deliberately not in the list: it shares this band (top: 26%) but cannot fire on the intro —
  // FINAL STAGE is suppressed by the descriptor and the "N enemies left" milestones only fire at 10 and 5
  // remaining, against an enemyTotal of 4. Asserting on an element that is never displayed would be vacuous.
  const bandCheck = () => page.evaluate(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
    const hits = (a, b) => !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);
    const line = document.getElementById('intro-line');
    const hudKids = [...document.querySelectorAll('#hud > div')];
    const others = {
      hudLeft: rect(hudKids[0]),                                  // shield / HP / percent
      hudRight: rect(hudKids[1]),                                 // credits / Destroyed
      minimap: rect(document.getElementById('minimap')),          // the battle radar
      settingsBtn: rect(document.getElementById('settings-btn')),
      pauseBtn: rect(document.getElementById('pause-btn')),
      zoom: rect(document.getElementById('zoom')),
    };
    const L = rect(line);
    return { lineShown: getComputedStyle(line).display !== 'none', L, others,
             view: { w: window.innerWidth, h: window.innerHeight },
             introBody: document.body.classList.contains('intro'),
             logShown: getComputedStyle(document.getElementById('event-log')).display !== 'none',
             overlaps: Object.fromEntries(Object.entries(others).map(([k, v]) => [k, hits(L, v)])) };
  });
  // Name the rects in any failure — a bare `true !== false` on a geometry check says nothing.
  const where = (b, k) => `line ${JSON.stringify(b.L)} vs ${k} ${JSON.stringify(b.others[k])} `
    + `on a ${b.view.w}x${b.view.h} viewport`;
  const assertBand = (b, tag) => {
    for (const k of Object.keys(b.overlaps)) {
      assert.equal(b.overlaps[k], false, `${tag}: the line clears ${k} — ${where(b, k)}`);
    }
  };
  // Put a line back on screen the way the game does: kill pirate #1 (the same hp=0 trick 19-hud-log uses),
  // let #2 arrive, and L1 fires on that second spawn.
  await page.evaluate(() => { for (const e of window.__game.enemies) e.hp = 0; });
  await page.evaluate(() => {                                     // step until the death is registered…
    const g = window.__game;
    let guard = 0;
    while (g.kills === 0 && guard++ < 300) g.stepSim(1);
  });
  await page.evaluate(() => {                                     // …and again until #2 has warped in
    const g = window.__game;
    let guard = 0;
    while (g.enemyCount === 0 && guard++ < 3000) g.stepSim(1);
  });
  await lineShown(true);   // L1 fired on the 2nd spawn — a line is up for the geometry check
  // Pin the viewport for the geometry check: the worker reuses ONE page across scenarios, and a mobile
  // scenario that failed before restoring its own viewport would otherwise decide this one's layout.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(120);
  await frame();
  let band = await bandCheck();
  assert.equal(band.introBody, true, 'body.intro is set while the director is armed');
  assert.equal(band.lineShown, true, 'a line is on screen for the geometry check (L1 fired on the 2nd spawn)');
  // THE KILL LOG RUNS DURING THE INTRO. It was hidden while the line lived in the bottom band beside it;
  // with the line at the top there is no reason to take a HUD element away from the player, and the intro is
  // a level, not a cutscene. `19-hud-log` would not catch a regression here — the runner silences the
  // director before every other scenario.
  assert.equal(band.logShown, true, 'the kill log is drawn during the intro, like on every other level');
  assertBand(band, 'desktop');
  await shot('top-band');

  // …and now the PHONE widths, which is where this nearly shipped broken. The first version of the top slot
  // was asserted at 812x375 only, and it cleared the radar there by 9px — but the clearance was an accident
  // of that width, not a rule: `position: fixed; left: 50%` with no `right` caps a shrink-to-fit box at
  // 50vw, so the left edge was always 25vw and `max-width` was dead code. 25vw only clears the radar's fixed
  // 194px right edge above ~776px of viewport: at 780 it cleared by 1px, at 736 it OVERLAPPED by 10 and at
  // 667 by 27 — the opaque card painting over the battle radar mid-fight. Both asserted viewports sat on the
  // clearing side of a boundary nobody had noticed, which is exactly how it escaped. So the widths below
  // straddle it deliberately, and 667 is the narrowest landscape phone worth shipping to.
  //
  // WHAT THIS BLOCK DOES AND DOES NOT PROVE, stated plainly. The runner's page is a DESKTOP context, so
  // `Device.hasTouch` is false and adding `body.touch` by hand only switches the CSS — `#touch` is never
  // given its `.on` class, so `#stick-zone` and `#fire-btn` are not rendered and would measure as zero
  // rects. A rect test against those would be vacuous and is not made. Everything asserted below DOES render
  // on this layout. A real device is the maintainer's live test (Stage 9 of the plan).
  const atPhone = async (w, h) => {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);   // let the resize settle FIRST: engine.applyOrientation re-runs
    // device.js's applyDevice() on every resize, and that strips a `body.touch` added before it — which
    // silently measures the DESKTOP rule and passes. Add it after, then ASSERT it survived.
    await page.evaluate(() => document.body.classList.add('touch'));
    await frame();
    const b = await bandCheck();
    const css = await page.evaluate(() => ({
      touchOn: document.body.classList.contains('touch'),
      lineTopCss: getComputedStyle(document.getElementById('intro-line')).top,
      cardTopCss: getComputedStyle(document.getElementById('intro-help')).top,
      help: (() => { const e = document.getElementById('help'); const r = e.getBoundingClientRect();
                     return { display: getComputedStyle(e).display, w: r.width, bottom: window.innerHeight - r.bottom }; })(),
      xpTop: (() => { const r = document.getElementById('xp-bar').getBoundingClientRect();
                      return window.innerHeight - r.bottom + r.height; })(),
    }));
    assert.equal(css.touchOn, true, `${w}x${h}: body.touch survived the resize — without it this measures the desktop rule`);
    return { b, css };
  };

  for (const [w, h] of [[812, 375], [736, 414], [667, 375]]) {
    const { b, css } = await atPhone(w, h);
    if (w === 812) await shot('touch-band');
    // 14vh of a 375px-tall screen is 52px, which cut into the HP bars (they end at y 63): the
    // `max(…, 76px)` floor is what holds the slot clear of a HUD block whose height is in PIXELS, not %.
    assert.equal(css.lineTopCss, '76px', `${w}x${h}: the slot falls back to the 76px floor, not 14vh`);
    assert.equal(css.cardTopCss, '76px', `${w}x${h}: and so does the controls card that shares the slot`);
    assertBand(b, `${w}x${h}`);
    assert.equal(b.logShown, true, `${w}x${h}: the kill log runs here too`);
    // #help must STAY ON SCREEN on touch: it used to be hidden outright ("keyboard hints not needed"), and a
    // display:none element measures as a zero rect — the card would fly to the corner of the screen at
    // minimum scale instead of landing on the cheatsheet.
    assert.notEqual(css.help.display, 'none', `${w}x${h}: the bottom-left cheatsheet is on screen on touch too`);
    assert.ok(css.help.w > 0, `${w}x${h}: and has a real rect for the card to fly onto`);
    assert.ok(css.help.bottom >= css.xpTop,
      `${w}x${h}: and it sits clear of the XP bar (#help bottom edge ${css.help.bottom}px vs the bar's ${css.xpTop}px top edge)`);
  }
  await page.evaluate(() => document.body.classList.remove('touch'));
  await page.setViewportSize({ width: 1280, height: 800 });   // hand the worker back a desktop layout
  await page.waitForTimeout(80);

  // ---- 7. Skip lives in Settings, and the modal still fits ---------------------------------
  await page.click('#settings-btn');
  await page.waitForTimeout(120);
  const settings = await page.evaluate(() => {
    const box = document.querySelector('#settings-overlay .settings-box');
    const r = box.getBoundingClientRect();
    const skip = document.getElementById('skip-intro');
    return { skipShown: getComputedStyle(skip).display !== 'none', skipText: skip.textContent,
             boxH: r.height, winH: window.innerHeight, clipped: box.scrollHeight - box.clientHeight };
  });
  await shot('settings-skip');
  assert.equal(settings.skipShown, true, 'the Skip row is published while the intro runs');
  assert.equal(settings.skipText, 'Skip the intro');
  // The only place the modal fit is checked WITH this row present — 14-reset-progress measures it with the
  // row hidden, because the runner's silenceIntro() clears G.skipIntro everywhere else.
  assert.ok(settings.boxH <= settings.winH + 1, `the settings box still fits (box ${settings.boxH} <= win ${settings.winH})`);
  assert.ok(settings.clipped <= 1, `and does not scroll internally (overflow ${settings.clipped})`);

  await page.click('#skip-intro');
  await page.waitForFunction(() => {
    const vis = (id) => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none'; };
    return vis('mainwin') || vis('welcome');
  }, null, { timeout: 20000 });
  const afterSkip = await page.evaluate(() => ({
    level: window.__game.levelName, intro: window.__game.intro,
    line: getComputedStyle(document.getElementById('intro-line')).display,
    card: getComputedStyle(document.getElementById('intro-help')).display,
    body: document.body.classList.contains('intro'),
  }));
  assert.equal(afterSkip.level, 'level-1', 'Skip advances progress 0 → 1 through the normal finishIntro path');
  assert.equal(afterSkip.intro, null, 'the director is disarmed');
  assert.equal(afterSkip.line, 'none', 'and neither of its nodes survives into the menu');
  assert.equal(afterSkip.card, 'none');
  assert.equal(afterSkip.body, false, 'body.intro is cleared, so the kill log comes back for every other level');

  // ---- 8. Restart re-arms every beat -------------------------------------------------------
  // The in-browser half of the director's unit-tested restart contract. Boot the intro again (the player is
  // at progress 1 now, so reset first), fly it a little, then die and press Restart.
  assert.equal(await resetToIntro(), 'level-0', 'back to progress 0 for the restart check');
  await page.goto(baseURL, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const g = window.__game;
    if (!g || !g.player || !g.gameStarted) return false;
    g.setPaused(true);
    return true;
  }, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.__game.levelName), 'level-0', 'and it booted the intro again');
  assert.ok(await page.evaluate(() => !!window.__game.intro), 'with the director re-armed for this run');
  await stepTo(6);
  await frame();
  assert.ok((await page.evaluate(() => window.__game.intro.fired)).includes('l0'), 'L0 spoke on this run too');
  assert.equal(await page.evaluate(() => window.__game.intro.help), 'hold', 'and the card is up');
  // Restarting WHILE THE CARD IS UP is the case that matters: the director's reset() drops straight back to
  // 'idle' and emits no command, so nothing on the DOM side would take the card down on its own.
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('intro-help')).display),
    'block', 'precondition: the controls card is on screen at the moment we die');

  // Die: the sim is frozen, so step it a few ticks by hand — stepPlayerDeath is what raises the overlay.
  await page.evaluate(() => { window.__game.player.hp = 0; window.__game.stepSim(5); });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('overlay')).display !== 'none',
    null, { timeout: 10000 });
  await page.click('#restart');   // reset() → unpauses AND zeroes combatElapsed
  // Re-freeze the clock the instant the new run starts, in the SAME evaluate as the check, so the live
  // accumulator cannot run past the first beat between the poll and the pause.
  await page.waitForFunction(() => {
    const g = window.__game;
    if (g.combatElapsed >= 1) return false;
    g.setPaused(true);
    return true;
  }, null, { timeout: 10000 });
  await stepTo(0.5);
  await frame();
  const rearmed = await page.evaluate(() => window.__game.intro);
  assert.deepEqual(rearmed.fired, ['l0'], 'Restart re-armed the director: the opening line plays again from the top');
  assert.equal(rearmed.help, 'idle', 'and the controls card is back to waiting for its slot');
  assert.equal(rearmed.view.lineKey, 'ui.intro.l0');
  // …and the card is actually GONE from the screen, not merely 'idle' in the director's own state. It kept
  // its inline `display:block; opacity:1` from the previous run and sat stacked on the re-armed opening
  // line, both illegible, and the state-only assertion above passed on that frame.
  await lineShown(true);
  const restartDom = await page.evaluate(() => ({
    card: getComputedStyle(document.getElementById('intro-help')).display,
    line: getComputedStyle(document.getElementById('intro-line')).display,
  }));
  await shot('restarted');
  assert.equal(restartDom.card, 'none', 'the controls card is taken down by the restart, not left on the new L0');
  assert.equal(restartDom.line, 'block', 'and the re-armed opening line has the slot to itself');

  // ---- 9. THE WIN ENDING disarms the director — the path the whole feature is FOR ----------
  // Skip is not how most players leave the intro. Clearing it advances the campaign IN PAGE (sim.js win →
  // loadAdvancedLevel, no reload), so a director latched in a module variable survived into Level 1, re-armed
  // itself on that level's reset() and replayed the whole script over it — while `body.intro` kept the kill
  // log hidden for the rest of the session and the Settings "Skip the intro" row stayed live, where it
  // would have granted a free level advance.
  assert.equal(await resetToIntro(), 'level-0', 'back to progress 0 for the win check');
  await page.goto(baseURL, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const g = window.__game;
    if (!g || !g.player || !g.gameStarted) return false;
    g.setPaused(true);
    return true;
  }, null, { timeout: 15000 });
  // Fight it: kill whatever has warped in, tick, repeat, until the sector clears. The spawn floors still
  // apply, so this walks the real ~15 s timeline rather than short-circuiting it.
  const fight = await page.evaluate(() => {
    const g = window.__game;
    let guard = 0;
    while (!g.levelRunner.cleared && guard++ < 20000) { for (const e of g.enemies) e.hp = 0; g.stepSim(1); }
    return { cleared: g.levelRunner.cleared, kills: g.kills, t: g.combatElapsed, fired: g.intro.fired };
  });
  assert.equal(fight.cleared, true, `the sector cleared (${fight.kills} kills at ${fight.t.toFixed(1)} s)`);
  assert.equal(fight.kills, 4, 'all four enemies of the intro');
  assert.ok(fight.fired.includes('l4'), 'and L4 spoke on `cleared`, with the whole script behind it');
  assert.deepEqual(fight.fired.slice().sort(), ['l0', 'l1', 'l2', 'l3', 'l4'], 'every beat fired across the run');
  // "Finish and Return" appears at the same instant as L4 — the geometry those two share is checked in 6.
  await page.waitForSelector('#return-btn', { state: 'visible', timeout: 10000 });
  await shot('cleared');
  // "Finish and Return" commits the SERVER-side half of the advance (sim.js `finishing` →
  // `commitLevelAdvance`, a fire-and-forget POST `/advance`) and the DOCK runs the tab-side half
  // (`loadAdvancedLevel`, a GET `/level`). THIS IS THE REGRESSION GUARD FOR THE RACE BETWEEN THEM, and it
  // reproduces the worst case rather than avoiding it: the pilot docks FROM THE ARENA CENTRE, where the home
  // station is ~43 u away against a 45 u arrival radius, so the arrival lands on the very tick the button is
  // pressed. Reported live on this branch: the intro's briefing was correctly Level 1, Take-off replayed
  // LEVEL 0, and clearing it a second time advanced the account again — a free level plus Level 1's machine
  // gun. `net.js` now publishes the POST on `advancing` and `loadAdvancedLevel` awaits `advanceDone()`, so
  // the GET can no longer overtake it. The bug is PRE-EXISTING on main for every level, not intro-only; the
  // intro merely made it the common case. `net.js` cannot be unit-tested (it imports `hud.js` → `three`), so
  // this is the guard.
  //
  // AND IT IS MADE DETERMINISTIC. Docking instantly is necessary but not sufficient: on localhost the POST
  // usually answers first anyway, so the unfixed code passes by luck (verified — the mutation below did not
  // fail until this delay was added). So HOLD THE POST for 1.5 s. Fixed, `loadAdvancedLevel` waits for it and
  // reads level-1; unfixed, the GET goes out immediately and reads back the level just cleared.
  let held = 0;   // …and COUNT the holds: a glob that stops matching (a changed API_BASE, a renamed route)
  // would turn page.route into a silent no-op and quietly demote this to the version that passes against the
  // UNFIXED code. The count is what makes the guard's own machinery observable.
  await page.route('**/api/players/*/advance', async (route) => {
    held++;
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const pressedAt = Date.now();
  try {
    await page.click('#return-btn');
    const flewHome = await page.evaluate(() => {
      const g = window.__game;
      let guard = 0;
      while (!g.levelRunner.won && guard++ < 40000) g.stepSim(1);
      return { won: g.levelRunner.won, ticks: guard, dist: Math.hypot(g.player.pos.x, g.player.pos.z) };
    });
    assert.equal(flewHome.won, true, 'the autopilot docked — the ordinary win path');
    assert.ok(flewHome.ticks <= 2, `and it docked essentially instantly from the arena centre (${flewHome.ticks} tick(s)) `
      + '— the worst case for the advance race, which is why this scenario does NOT fly a long way home first');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('overlay')).display !== 'none',
      null, { timeout: 10000 });
    // THE TWO ASSERTIONS THIS STEP EXISTS FOR. (1) The tab ends up on the level the SERVER advanced it to,
    // even though the POST answered long after the dock — the race that handed the maintainer a free level.
    await page.waitForFunction(() => window.__game.levelName === 'level-1', null, { timeout: 20000 });
    const elapsed = Date.now() - pressedAt;
    assert.equal(held, 1, `the /advance POST was actually intercepted and held (route hits: ${held}) — `
      + 'without that this scenario passes against the unfixed code too');
    assert.ok(elapsed >= 1400, `and the tab waited for it before reading the level back (${elapsed} ms >= the 1500 ms hold)`);
  } finally {
    await page.unroute('**/api/players/*/advance');   // never leak a route into the next scenario
  }
  // (2) …and the level advancing in page is what takes the director with it.
  await frame();
  const afterWin = await page.evaluate(() => ({
    intro: window.__game.intro, body: document.body.classList.contains('intro'),
    line: getComputedStyle(document.getElementById('intro-line')).display,
    card: getComputedStyle(document.getElementById('intro-help')).display,
    log: getComputedStyle(document.getElementById('event-log')).display,
  }));
  assert.equal(afterWin.intro, null, 'winning the intro disarms the director (it does not outlive its level)');
  assert.equal(afterWin.body, false, 'body.intro is cleared…');
  assert.notEqual(afterWin.log, 'none', '…so the kill log comes back for the rest of the session');
  assert.equal(afterWin.line, 'none', 'and neither intro node is left on screen');
  assert.equal(afterWin.card, 'none');
  // The Settings row must be gone too — it runs finishIntro(), which on Level 1 would advance the campaign
  // for free.
  await page.click('#restart');                       // "Continue" → the Level-1 Main Window briefing
  await page.waitForFunction(() => {
    const vis = (id) => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none'; };
    return vis('mainwin') || vis('welcome');
  }, null, { timeout: 20000 });
  await page.click('#settings-btn');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('skip-intro')).display), 'none',
    'the "Skip the intro" row is gone once the intro is over — on Level 1 it would grant a free advance');
  await page.click('#settings-close');
  await page.waitForTimeout(100);

  // …and finally the symptom itself: take off into Level 1 and prove the script does NOT play over it.
  // `reset()` zeroes combatElapsed, which is the director's own restart signal — the exact trigger.
  await page.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-takeoff').click();
    else document.getElementById('takeoff').click();
  });
  await page.waitForFunction(() => window.__game && window.__game.gameStarted && window.__game.roam === false,
    null, { timeout: 25000 });
  await page.waitForTimeout(400);   // let the engaged reset() build the fight (DOM/rAF, not sim)
  await frame();
  const level1 = await page.evaluate(() => ({
    level: window.__game.levelName, intro: window.__game.intro,
    t: window.__game.combatElapsed,
    line: getComputedStyle(document.getElementById('intro-line')).display,
    body: document.body.classList.contains('intro'),
  }));
  await shot('level1-clean');
  assert.equal(level1.level, 'level-1');
  assert.equal(level1.intro, null, 'no director on Level 1');
  assert.equal(level1.line, 'none',
    `and no intro line drawn over it (combatElapsed ${level1.t.toFixed(2)} s into the fresh run)`);
  assert.equal(level1.body, false);
}
