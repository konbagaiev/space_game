// The HUD must never read the live viewport (docs/plans/hud-viewport-layout-thrash.md, DECISIONS §149).
//
// `window.innerWidth`/`innerHeight` are layout-inducing reads: with a dirty layout Blink flushes style +
// layout synchronously before answering. Five per-frame HUD updaters call `gameW()`/`gameH()` interleaved
// with their own style writes, so the frame used to be write → read → write → read and every read forced a
// mid-frame recalc (a real Redmi 15C: 1.82 forced recalcs and 0.99 ms per frame). The fix caches the
// logical size in `engine.js` and refreshes it in `applyOrientation()` — the one choke point that sizes the
// renderer. This scenario is the guard for that, and it has two halves, because either alone is passable
// by a broken build:
//   Case 1 — ZERO viewport reads across 8 real rAF frames in steady state (with an anti-vacuity check that
//           `updateMarkers` really ran inside the counted window; a frame that ran no HUD code would pass a
//           zero-read assertion trivially).
//   Case 2 — after a real resize the cache TRACKS the new size and every edge marker lands on the NEW
//           viewport's 0.92 edge box. A frozen cache passes Case 1 perfectly and puts every HUD marker off
//           screen on a phone rotation — that is the failure this half exists for.
//
// Why the counter is an own-property shadow on `window` rather than a hook in engine.js: the five HUD
// updaters were written from ONE template (`const w = gameW(), h = gameH(), margin = 0.92;`), so a sixth
// overlay will be too. Counting reads from ANY caller anywhere in the page is what makes that sixth
// function fail the suite when it is written against `window.innerWidth` directly. A sixth function that
// calls `gameW()` reads the cache, produces no window read, and correctly passes.
//
// Honest limit: this covers the `window.innerWidth`/`innerHeight` pattern — the template actually in
// question. A future function forcing layout through `getBoundingClientRect()` or
// `documentElement.clientWidth` would not be caught. (`hud.js`'s `void n.offsetWidth` is a deliberate
// reflow on the hud-log path, not per-frame, and is explicitly out of scope.)
export const name = '48-hud-viewport-cache';

const FRAMES = 8;
const VIEW_B = { width: 900, height: 600 };

export default async function ({ page, assert, shot }) {
  // --- 0. Make the boot state unambiguous. The runner shares one spacegame_test player across runs AND
  //     across worktrees, so leftover DB state can leave the page on the Welcome or the Hangar with no
  //     fight running (same fallback as 06-pause). The guard's reliability must not rest on shared state.
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-takeoff').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForFunction(() => !!(window.__game && window.__game.gameStarted && window.__game.player), null, { timeout: 10000 });
  assert.ok(await page.evaluate(() => window.__game.gameStarted), 'a fight is running (the HUD path is live)');

  // --- 1. Freeze the world and seed one enemy far off-screen, so at least one edge marker is placed every
  //     frame. The DOM block of animate() runs regardless of G.paused, so the HUD keeps updating while the
  //     world stands still; setPaused shows #pause-overlay, NOT the result overlay the HUD early-returns on.
  await page.evaluate(() => {
    const g = window.__game, p = g.player;
    g.setPaused(true);
    const e = g.spawnEnemy('fighter');
    e.pos.x = p.pos.x + 400; e.pos.z = p.pos.z + 150;   // leave e.pos.y on the bullet plane
  });

  // --- 2. Instrument window.innerWidth/innerHeight with counting getters that DELEGATE to the originals
  //     (behavior unchanged), plus a self-check so the instrumentation can never silently stop counting.
  const counted = await page.evaluate(() => {
    const findDesc = (obj, key) => {
      for (let o = obj; o; o = Object.getPrototypeOf(o)) {
        const d = Object.getOwnPropertyDescriptor(o, key);
        if (d) return d;
      }
      return null;
    };
    const probe = { n: 0, orig: {} };
    for (const key of ['innerWidth', 'innerHeight']) {
      const d = findDesc(window, key);
      if (!d || !d.get) throw new Error(`no getter for window.${key}`);
      probe.orig[key] = d;
      Object.defineProperty(window, key, {
        configurable: true, enumerable: true, set: d.set,
        get() { probe.n++; return d.get.call(window); },
      });
    }
    window.__vpProbe = probe;
    const before = probe.n;
    void window.innerWidth;                 // self-check: one deliberate read must be counted
    const n = probe.n - before;
    probe.n = 0;
    return n;
  });
  assert.equal(counted, 1, 'the read counter is actually installed (one deliberate read counts as one)');

  // --- 3. Case 1: zero viewport reads across FRAMES real animation frames. Driven by chained rAF inside a
  //     single evaluate — never a wall-clock wait, and never stepSim (the HUD updaters live in animate()'s
  //     DOM block, not in the sim step).
  const case1 = await page.evaluate(async (FRAMES) => {
    // A signature over EVERY visible edge arrow, deliberately independent of marker-pool ordering: pool
    // slots go to enemies in `enemies` order and the seeded enemy is pushed LAST, so "the first visible
    // marker" would be the pre-existing (and, under pause, stationary) level-0 pirate and would never move.
    const markerSig = () => [...document.querySelectorAll('#markers .marker')]
      .filter((n) => n.style.display === 'block')
      .map((n) => n.style.transform)
      .join('|');
    const frame = () => new Promise((r) => requestAnimationFrame(r));

    await frame();                                  // land on a frame boundary
    const t0 = markerSig();                         // proof-of-life sample
    window.__vpProbe.n = 0;                         // zero AFTER the boundary frame
    for (let i = 0; i < FRAMES / 2; i++) await frame();
    window.__game.enemies.at(-1).pos.z += 400;      // move the seeded enemy: forces its arrow to re-place
    for (let i = 0; i < FRAMES / 2; i++) await frame();
    return { reads: window.__vpProbe.n, t0, t1: markerSig() };
  }, FRAMES);

  assert.ok(case1.t0.length > 0, 'an edge marker is being placed before the counted window (the HUD path runs)');
  assert.ok(case1.t1.length > 0, 'an edge marker is still being placed at the end of the counted window');
  // ANTI-VACUITY. Without this the whole test could pass by measuring nothing: the HUD updaters early-return
  // when there is no player or the result overlay is up, and a zero-read assertion over frames that ran no
  // HUD code passes trivially. The world is paused, so the only thing that can move an arrow is the
  // deliberate pos.z bump above — deterministic, not AI drift. Do NOT weaken this if it goes red.
  assert.notEqual(case1.t1, case1.t0, 'updateMarkers really executed inside the counted window (the seeded enemy\'s arrow moved)');
  assert.equal(case1.reads, 0, `zero window.innerWidth/innerHeight reads across ${FRAMES} frames (got ${case1.reads})`);

  // --- 4. Case 2: a real resize must refresh the cache, and the markers must follow it onto the NEW
  //     viewport's edge box. VIEW_B is smaller AND a different aspect — the shrink reproduces the
  //     phone-rotation symptom, where a stale cache puts markers outside the visible area.
  const before = await page.evaluate(() => {
    const markers = [...document.querySelectorAll('#markers .marker')].filter((n) => n.style.display === 'block');
    window.__vpProbe.n = 0;   // zero immediately before the resize: the next count means "caused by THIS resize"
    return { count: markers.length, gameW: window.__game.gameW, gameH: window.__game.gameH };
  });
  assert.ok(before.count > 0, 'edge markers are on screen before the resize');
  assert.equal(before.gameW, 1280, 'the cache holds the runner\'s viewport width before the resize');
  assert.equal(before.gameH, 800, 'the cache holds the runner\'s viewport height before the resize');

  await page.setViewportSize(VIEW_B);
  const after = await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    for (let i = 0; i < 3; i++) await frame();   // let the HUD re-place its markers at the new size
    // The harness context is not touch, so G.rotated is false and game space == viewport space: the
    // translate3d numbers are raw game-space px.
    const markers = [...document.querySelectorAll('#markers .marker')]
      .filter((n) => n.style.display === 'block')
      .map((n) => /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(n.style.transform))
      .filter(Boolean)
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    return { reads: window.__vpProbe.n, gameW: window.__game.gameW, gameH: window.__game.gameH, markers };
  });

  assert.equal(after.gameW, VIEW_B.width, `the cached game width tracks the resize (got ${after.gameW})`);
  assert.equal(after.gameH, VIEW_B.height, `the cached game height tracks the resize (got ${after.gameH})`);
  // Positive proof the refresh came from a FRESH window read inside applyOrientation (applyDevice() reads
  // it too — which is exactly why the zero-read window of Case 1 is scoped before the resize).
  assert.ok(after.reads > 0, `the resize path DID read the live viewport to refresh the cache (got ${after.reads})`);

  // Behavioral, with teeth. Enemy, drop and mission arrows all share one rule (margin = 0.92, and
  // k = margin / max(|x|,|y|) normalizes the dominant axis to exactly 0.92), so every visible arrow must
  // sit on the NEW viewport's 0.92 edge box. With a FROZEN cache (still 1280×800) a right-edge marker is
  // placed at 0.96 × 1280 = 1228.8 px — outside the 900-px viewport, and 2 × 1228.8 / 900 − 1 = 1.73,
  // nowhere near 0.92: both assertions below fire. place() rounds to toFixed(1), ~30× inside the tolerance.
  assert.ok(after.markers.length > 0, 'edge markers are still on screen after the resize');
  for (const m of after.markers) {
    assert.ok(m.x >= 0 && m.x <= VIEW_B.width && m.y >= 0 && m.y <= VIEW_B.height,
      `edge marker is inside the NEW viewport (got ${m.x},${m.y} in ${VIEW_B.width}x${VIEW_B.height})`);
    const edge = Math.max(Math.abs(2 * m.x / VIEW_B.width - 1), Math.abs(2 * m.y / VIEW_B.height - 1));
    assert.ok(Math.abs(edge - 0.92) < 0.02, `edge marker sits on the 0.92 edge box of the NEW viewport (got ${edge.toFixed(3)})`);
  }
  await shot('after-resize');

  // --- 5. Cleanup. Hygiene only — the runner reloads the page for every scenario.
  await page.evaluate(() => {
    const probe = window.__vpProbe;
    for (const key of ['innerWidth', 'innerHeight']) Object.defineProperty(window, key, probe.orig[key]);
    delete window.__vpProbe;
  });
}
