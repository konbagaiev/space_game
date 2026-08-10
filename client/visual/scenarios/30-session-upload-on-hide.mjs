// Regression guard: BACKGROUNDING the tab must upload the recorded session.
//
// The bug this ships against (2026-08-03): the always-on session recorder flushed only on `pagehide`. On
// phones and tablets that event routinely never fires — the browser freezes or discards a backgrounded page
// instead — so a tablet tester's entire 20-minute session left no row at all, and neither did any desktop
// quit longer than ~34 s (the trace blew past sendBeacon's ~64KB body cap and was silently refused).
//
// The fix flushes on `visibilitychange → hidden`, while the page is still alive, over a plain fetch. This
// scenario asserts the request ACTUALLY GOES OUT, and that the flush is PROVISIONAL — the recorder keeps
// running, so a player who comes back and finishes re-sends the same session id (the server upserts it).
//
// Fail-before: without the listener, no /api/sessions request is made on hide and the assertion trips.
export const name = 'session-upload-on-hide';

export default async function ({ page, assert, shot }) {
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 15000 });

  // Collect every session upload the page makes.
  const uploads = [];
  page.on('request', (r) => { if (r.url().includes('/api/sessions')) uploads.push({ method: r.method(), body: r.postData() }); });

  // 1. Get a LIVE recorded session going: the runner's ?debug page is already in the Level-0 fight, but the
  //    recorder is armed by the take-off flow, so drive the real one (same seam scenario 29 uses).
  await page.evaluate(() => window.__game.simulateIntroEnd());
  await page.waitForFunction(() => {
    const vis = (id) => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none'; };
    return vis('welcome') || vis('mainwin');
  }, null, { timeout: 20000 });
  await page.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none'; };
    if (vis('welcome')) document.getElementById('takeoff').click();
    else document.getElementById('mw-takeoff').click();
  });

  // 2. Play past the trivial-session floor (MIN_SESSION_TICKS = 180 ticks = 3 s of sim). Hold thrust so the
  //    session is real input, not an idle screen.
  await page.mouse.click(640, 400); // focus the canvas
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.sessionRec().ticks > 200, null, { timeout: 20000 });
  await page.keyboard.up('KeyW');
  const before = await page.evaluate(() => window.__game.sessionRec());
  console.log(`      recorded before hide: ticks=${before.ticks} runs=${before.runs} active=${before.active}`);
  assert.ok(before.active, 'precondition: a live session is being recorded');
  assert.ok(before.runs < before.ticks, 'ticks are run-length packed, not stored one object per tick');

  // 3. Background the tab exactly as a phone does. Playwright cannot toggle real page visibility, so override
  //    the property the handler reads and fire the event the browser would.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(500);
  await shot('after-hide');

  const posts = uploads.filter((u) => u.method === 'POST');
  console.log(`      /api/sessions uploads after hide: ${posts.length}`);
  assert.ok(posts.length >= 1, 'backgrounding the tab must upload the session (it used to be dropped entirely on mobile)');

  const body = JSON.parse(posts[posts.length - 1].body || '{}');
  assert.ok(body.id, 'the upload carries a client-minted session id, so a later final flush upserts the same row');
  assert.equal(body.trace.version, 2, 'the uploaded trace is the packed v2 shape');
  assert.ok(Array.isArray(body.trace.runs) && body.trace.runs.length > 0, 'packed runs are present');
  assert.ok(body.trace.tickCount > 200, `the whole session went out, got tickCount=${body.trace.tickCount}`);

  // 4. Provisional: the recorder is still running, so returning and finishing yields ONE complete row.
  const after = await page.evaluate(() => window.__game.sessionRec());
  assert.ok(after.active, 'the hide flush must NOT close the recording — the player may come back and finish');
  assert.equal(after.final, false, 'only a win/death flush is final');
}
