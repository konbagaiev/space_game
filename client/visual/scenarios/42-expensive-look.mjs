// The "expensive look" render path, measured on a REAL RENDERED FRAME.
//
// Everything this feature adds is view-layer, which is exactly the class of change that passes every logic
// assertion and ships INVISIBLE (DECISIONS §96, the first speed field). So this scenario reads the actual
// drawing buffer and asserts on luminance, not on the existence of objects.
//
// It runs on its own URL, `?debug&nebula`: the nebula bake (and with it the new parallax layer) is normally
// skipped under ?debug so the rest of the suite's backdrop never changes, and `nebula` is the opt-in flag
// that turns it back on. Dropping ?debug entirely would remove `window.__game` — and the world→screen
// projection this scenario needs to find the hull pixels lives there.
//
// Four assertions, and two of them are written carefully because the OBVIOUS formulation is true on a broken
// frame:
//   1. the composer is really live (NOT "no page errors + NoToneMapping" — that pair is equally true when
//      createPostFx() threw and the frame fell back to the raw two-pass path);
//   2. the parallax backdrop really CONTRIBUTES — measured differentially (amp 0 vs the shipped amp) in the
//      same frame sequence, because an absolute floor is already satisfied by the baked cube and the stars;
//   3. the backdrop brightness CEILING: the nebula's peak stays below the dimmer end of the lit hull;
//   4. nothing is blown out at rest.
//
// All luminances below are sRGB 0..1 — the buffer read is the FINAL, tonemapped image, i.e. what the player
// actually sees (same convention as speed-field.js's BG_LUMA).
export const name = '42-expensive-look';

export default async function ({ page, assert, shot, baseURL }) {
  const origin = new URL(baseURL).origin;
  // PIN THE VIEWPORT. This scenario measures PIXELS, and the worker's page is shared across scenarios — the
  // phone-layout ones resize it and never put it back, so without this line the frame arrives at 844x390 and
  // every percentile shifts (the ship covers half as many pixels and a 130 px ring covers a third of the
  // frame height). Setting it to the runner's own default also un-pollutes the page for whatever runs next.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${origin}/?debug&nebula`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 20000 });
  // TAKE OFF FROM WHICHEVER SCREEN IS UP. On a fresh profile that is the welcome screen; once an earlier
  // scenario in the same worker has written progress to localStorage it is the Main Window instead, and a
  // welcome-only click silently does nothing — the game then sits in the menu, `update()` never runs, and the
  // camera stays where it was while the ship is teleported away below. (That is exactly how this scenario
  // failed in the full suite while passing on its own.) Same two-branch click 99-fill.mjs uses.
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-takeoff').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  // The bake is a 6-face shader render; on software WebGL it is not instant. Wait for the layer to EXIST
  // rather than for a wall-clock guess.
  await page.waitForFunction('!!(window.__game.postfx && window.__game.postfx.amp !== null)', null, { timeout: 45000 });
  await page.waitForTimeout(1500);

  // 1. THE COMPOSER IS REALLY LIVE, and the main renderer never tonemaps (D3 — ACES belongs in the final
  //    pass, after bloom; tonemapping the scene first would make the bloom threshold meaningless).
  const chain = await page.evaluate(() => ({
    ...window.__game.postfx,
    toneMapping: window.__game.renderer.toneMapping,   // THREE.NoToneMapping === 0
  }));
  assert.equal(chain.active, true, 'the EffectComposer is built and driving the frame');
  assert.equal(chain.bloom, true, 'the bloom pass is in the chain');
  assert.equal(chain.toneMapping, 0, 'the MAIN renderer stays NoToneMapping — the grade pass owns ACES (D3)');
  assert.ok(chain.amp > 0, `the parallax backdrop layer was built (amp ${chain.amp})`);

  // Clear the enemies so nothing is exploding while we measure "at rest", and MOVE THE SHIP OFF THE BASE.
  // The level starts docked at the base station, whose white modules fill the middle of the frame — a "ship
  // box" measured there would be measuring the STATION, and the background rectangle would be measuring its
  // glow. Out in open space the ship is the only lit thing on screen, which is what the silhouette assertion
  // is actually about. (View-layer only: the sim is not being asserted on here.)
  await page.evaluate(() => {
    const g = window.__game;
    g.enemies.slice().forEach((e) => g.scene.remove(e.mesh));
    g.enemies.length = 0;
    g.player.pos.set(3000, 0, 3000);
    g.player.vel.set(0, 0, 0);
    g.stepSim(3);   // settleView re-frames the camera + the backdrop on the new position
  });
  await page.waitForTimeout(800);

  // 2 + 3 + 4 in ONE frame sequence: the drawing buffer is not preserved, so every read happens INSIDE a
  // requestAnimationFrame callback (the technique 99-fill.mjs uses). Note readPixels sees the WebGL canvas
  // ONLY — the HUD is DOM and never enters these numbers.
  const r = await page.evaluate((shippedAmp) => new Promise((resolve) => {
    const g = window.__game;
    const gl = g.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const grab = () => { const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
    const pct = (arr, p) => { const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    const mean = (arr) => { let a = 0; for (const v of arr) a += v; return a / (arr.length || 1); };

    // THE SPEED-FIELD DUST IS HIDDEN FOR THE WHOLE MEASUREMENT, and that is not a dodge. What is asserted
    // here is the SKY's ceiling — the nebula against the hull. The dust is deliberately bright, crisp,
    // near-white ROCK (DECISIONS §96: it reads by size and contrast, and the bloom threshold is set ABOVE it
    // precisely so it never glows), and being sparse it lands in the top percentile of any background sample.
    // Leaving it in would turn this into a measurement of the dust: a few point-sized specks brighter than a
    // hull facet cost nothing in readability, a bright NEBULA costs everything.
    const dust = g.speedFieldLayers.map((L) => L.points);
    for (const pt of dust) pt.visible = false;

    // The ship box: the player projected to screen, ±HALF px, and a RING around it. Contrast is a LOCAL
    // property — what makes a hull readable is the sky immediately behind it, not the frame average — so the
    // ceiling is asserted against the ring, and the layer's contribution against the whole frame.
    // Projected from the camera's own matrices so the scenario needs no THREE import. readPixels is bottom-up
    // and NDC y points up too, so NDC maps to buffer coords with no flip.
    g.camera.updateMatrixWorld(true);
    g.camera.matrixWorldInverse.copy(g.camera.matrixWorld).invert();
    const e = g.camera.projectionMatrix.clone().multiply(g.camera.matrixWorldInverse).elements;
    const p = g.player.pos;
    const cw = e[3] * p.x + e[7] * p.y + e[11] * p.z + e[15];
    const ndcX = (e[0] * p.x + e[4] * p.y + e[8] * p.z + e[12]) / cw;
    const ndcY = (e[1] * p.x + e[5] * p.y + e[9] * p.z + e[13]) / cw;
    const cx = Math.round((ndcX * 0.5 + 0.5) * W), cy = Math.round((ndcY * 0.5 + 0.5) * H);
    const HALF = 38, RING = 130;
    const inShip = (x, y) => Math.abs(x - cx) <= HALF && Math.abs(y - cy) <= HALF;
    const inRing = (x, y) => Math.abs(x - cx) <= RING && Math.abs(y - cy) <= RING && !inShip(x, y);

    // One pass over a frame → the three populations (ship box / ring / everything but the ship).
    const split = (b) => {
      const ship = [], ring = [], sky = [];
      let blown = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const l = (0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2]) / 255;
        if (b[i] >= 250 && b[i + 1] >= 250 && b[i + 2] >= 250) blown++;
        if (inShip(x, y)) ship.push(l);
        else { sky.push(l); if (inRing(x, y)) ring.push(l); }
      }
      return { ship, ring, sky, blown };
    };

    // Fail LOUDLY if the ship is not on screen. Without this the ring comes back empty, every percentile is
    // `undefined`, and the scenario dies in a `toFixed` TypeError that says nothing about the real cause.
    if (cx < RING || cy < RING || cx > W - RING || cy > H - RING) {
      resolve({ W, H, offScreen: { cx, cy } });
      return;
    }

    const out = { W, H, box: { cx, cy, half: HALF, ring: RING }, amp: shippedAmp };
    let step = 0;
    const tick = () => {
      if (step === 0) { g.setBackdropAmp(0); step = 1; }            // switch the layer off …
      else if (step === 1) { step = 2; }                            // … let that reach the screen
      else if (step === 2) {
        out.skyOff = mean(split(grab()).sky);                       // the reference frame
        g.setBackdropAmp(shippedAmp);
        step = 3;
      } else if (step === 3) { step = 4; }                          // let the restored amp reach the screen
      else {
        const f = split(grab());
        out.skyOn = mean(f.sky);
        out.skyP99 = pct(f.sky, 0.99);
        out.ringP95 = pct(f.ring, 0.95);
        out.ringP99 = pct(f.ring, 0.99);
        const lit = f.ship.filter((l) => l > out.ringP95);
        out.hullLit = lit.length;
        out.hullP25 = lit.length ? pct(lit, 0.25) : 0;
        out.hullP50 = lit.length ? pct(lit, 0.50) : 0;
        out.hullMax = f.ship.length ? Math.max(...f.ship) : 0;
        out.blownPct = 100 * f.blown / (W * H);
        for (const pt of dust) pt.visible = true;   // put the field back
        resolve(out);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), chain.amp);

  assert.ok(!r.offScreen,
    `the ship must be framed for any of this to mean anything (projected to ${JSON.stringify(r.offScreen)} on a ${r.W}x${r.H} buffer — did take-off actually happen?)`);

  console.log(`      frame ${r.W}x${r.H} · ship @${r.box.cx},${r.box.cy} · sky mean luma off=${r.skyOff.toFixed(4)} on=${r.skyOn.toFixed(4)} (delta ${(r.skyOn - r.skyOff).toFixed(4)})`);
  console.log(`      skyP99=${r.skyP99.toFixed(4)} ringP95=${r.ringP95.toFixed(4)} ringP99=${r.ringP99.toFixed(4)} · hull lit px=${r.hullLit} p25=${r.hullP25.toFixed(4)} p50=${r.hullP50.toFixed(4)} max=${r.hullMax.toFixed(4)} · blown=${r.blownPct.toFixed(3)}%`);

  // The frame itself — saved BEFORE the assertions, so a failure still leaves the picture to look at. The
  // automated numbers below cannot replace a human deciding whether this looks expensive or blown out.
  await shot('composed');

  // 2. THE PARALLAX LAYER REALLY CONTRIBUTES. Differential, not absolute: an absolute floor like
  //    `skyP99 >= 0.02` is already satisfied by the baked cube and the star field, so it would say nothing
  //    whatsoever about the layer this feature adds. Measured over the WHOLE sky, because a structured layer
  //    (which is the point — see D17) leaves the void alone and lifts only its masses, so a fixed small
  //    rectangle can easily land in a gap and read zero on a perfectly good layer.
  assert.ok(r.skyOn - r.skyOff >= 0.01,
    `the backdrop layer adds real light to the frame (sky mean luma ${r.skyOff.toFixed(4)} → ${r.skyOn.toFixed(4)})`);

  // 3. THE BACKDROP BRIGHTNESS CEILING (D13): the sky IMMEDIATELY AROUND THE SHIP must stay below the lit
  //    hull, or the backdrop out-brightens the ships and the silhouette is gone. Local, because that is what
  //    readability is: contrast against what is behind the ship, not against the frame average.
  assert.ok(r.hullLit >= 150, `the hull reads as a silhouette at all (${r.hullLit} lit pixels in the ship box)`);
  assert.ok(r.hullP50 >= 1.5 * r.ringP95,
    `the lit hull (median ${r.hullP50.toFixed(4)}) stays >= 1.5x the sky right around it (${r.ringP95.toFixed(4)})`);

  // 4. Nothing is blown out on a frame with no explosion.
  assert.ok(r.blownPct < 0.5, `nothing is blown out at rest (${r.blownPct.toFixed(3)}% of pixels at 250+ on all channels)`);
}
