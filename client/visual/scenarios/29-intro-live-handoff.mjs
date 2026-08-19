// Regression guard for the intro→Level-1 dead-controls bug (docs/plans/2026-08-03-1246-record-all-sessions.md).
//
// Always-on recording unified live play onto the record/playback fixed-step accumulator, whose inner loop was
// gated `while (… && !rs.done && …)`. At the real intro's end, cutsceneEnd()→finishIntro()→rs.teardown() reset
// rs.done to false AND nulled rs.play, then the caller set `rs.done = true` AGAIN — so the first LIVE session
// after the intro inherited a stale rs.done=true and the accumulator never stepped: the ship was off-center and
// controls were dead until a page refresh (which builds a fresh rs). This ships the guard that would have caught
// it: reproduce the exact post-intro state, take off into live Level 1, and assert the sim actually advances.
//
// The headless suites can't run the REAL auto-intro (shouldPlayIntro is gated off under ?debug), so we fire the
// production intro-completion sequence via the __game.simulateIntroEnd() seam — it runs the actual
// finishIntro()→teardown→welcome path AND leaves rs.done=true exactly like the accumulator caller does. The
// take-off below is then the real welcome/Main-Window flow (welcome.js takeOff / launchCampaign → beginLiveSession
// → reset). Fix A (live ignores rs.done) makes assertion (a) pass; Fix B (take-off arms the recorder) makes (b).
export const name = 'intro-live-handoff';

export default async function ({ page, assert, shot }) {
  // The runner already navigated to ?debug and left us in the live Level-0 fight with __game.player ready.
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 15000 });

  // 1. Reproduce the production intro-completion sequence: finishIntro (async → teardown → menu) + the stale
  //    rs.done=true. #welcome (or the Main Window) appears once finishIntro's async tail resolves.
  const end = await page.evaluate(() => window.__game.simulateIntroEnd());
  assert.equal(end.playDone, true, 'precondition: the intro left rs.done=true (the state that froze live play)');
  assert.equal(end.playActive, false, 'precondition: playback was torn down (rs.play=null) → the session is now LIVE');

  // 2. Take off into live Level 1 via the REAL post-intro menu. EMPIRICALLY (verified against the seeded DB:
  //    new player → level-0 intro → advanceProgress → level-1, which HAS a briefing) finishIntro lands the
  //    real new player on the MAIN WINDOW (showMain → #mw-takeoff → launchCampaign), NOT the welcome screen — every
  //    campaign level 2+ carries a briefing. We click whichever menu is up (welcome #takeoff / Main Window
  //    #mw-takeoff — both arm beginLiveSession) and assert below that it was the real (Main Window) path.
  await page.waitForFunction(() => {
    const vis = (id) => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none'; };
    return vis('welcome') || vis('mainwin');
  }, null, { timeout: 20000 });
  const via = await page.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none'; };
    if (vis('welcome')) { document.getElementById('takeoff').click(); return 'welcome'; }
    document.getElementById('mw-takeoff').click(); return 'mainwin';
  });
  assert.equal(via, 'mainwin', 'the real post-intro new-player take-off is the Main Window (launchCampaign) — level-1 has a briefing');
  // Take-off is a TAKE-OFF: it launches you at the base and the fight starts when you reach where the level
  // fights (mainwindow.launchCampaign → enterRoam → sim.js checkMissionZone). Level 1 fights at the origin,
  // i.e. the base you just left, so you spawn inside its zone and the countdown runs immediately — but it is
  // still a countdown, and `beginLiveSession` is armed when the FIGHT starts, not when the menu closes. Wait
  // it out rather than racing it; that ordering is exactly what Fix B is about.
  await page.waitForFunction(() => window.__game && window.__game.roam === false, null, { timeout: 15000 });
  await page.waitForTimeout(200); // let the engaged reset() build the fight

  // 3. Hold thrust for ~1 s of real rAF frames and read the LIVE recorder's captured-tick count. The recorder
  //    captures exactly once per accumulator step, so its tick count is a level-/physics-independent measure of
  //    whether the accumulator ACTUALLY STEPPED. A LIVE session steps tens of ticks; the FROZEN engine (stale
  //    rs.done, unfixed) never steps → 0 ticks (verified fail-before). Player movement is logged as corroboration
  //    but not asserted on (travel distance varies by level/frame timing across the suite).
  await page.mouse.click(640, 400); // focus the canvas so key input reaches the game
  const p0 = await page.evaluate(() => { const p = window.__game.player.pos; return { x: p.x, z: p.z }; });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  const live = await page.evaluate((prev) => {
    const p = window.__game.player.pos;
    const rec = window.__game.sessionRec();
    return { moved: Math.hypot(p.x - prev.x, p.z - prev.z), recTicks: rec.ticks, recActive: rec.active, recLevel: rec.level };
  }, p0);
  await shot('level1-live');
  console.log(`      post-intro live (via ${via}): moved=${live.moved.toFixed(2)}u recTicks=${live.recTicks} active=${live.recActive} level=${live.recLevel}`);

  // (a) Fix A — the live accumulator stepped, so the sim advanced and the ship responds to controls. This FAILS
  //     on the unfixed engine (stale rs.done freezes live → 0 ticks captured) and PASSES with `!(rs.play && rs.done)`.
  // (b) Fix B — the post-intro take-off armed the always-on recorder (recorder active), so the funnel's FIRST
  //     live level is captured. Both are proven by a captured-tick count > 0 on the real take-off path.
  assert.ok(live.recActive, `post-intro Level-1 take-off did not arm the recorder (Fix B) — beginLiveSession not called on ${via} take-off`);
  assert.ok(live.recTicks > 0, `post-intro Level 1 sim did not advance — 0 ticks captured under held thrust (live accumulator frozen by stale rs.done, Fix A)`);
}
