// The "expensive look" render path, measured on a REAL RENDERED FRAME.
//
// WHAT SURVIVED THIS FEATURE, AND THEREFORE WHAT THIS MEASURES. Two glow systems were built here and both
// were deleted after live testing on a real GPU: first a full-frame EffectComposer (bloom + ACES), then an
// additive glow overlay on its own render layer. What ships is the historical two-pass frame drawn STRAIGHT TO THE
// CANVAS with its own MSAA and no tone mapping, real THREE.PointLights on engines/rockets/blasts
// (engine-lights.js), and the PARALLAX BACKDROP LAYER this scenario measures (DECISIONS §138).
//
// Everything the backdrop layer adds is view-layer, which is exactly the class of change that passes every
// logic assertion and ships INVISIBLE (DECISIONS §96, the first speed field). So this scenario reads the
// actual drawing buffer and asserts on luminance, not on the existence of objects.
//
// It runs on its own URL, `?debug&nebula`: the nebula bake (and with it the parallax layer) is normally
// skipped under ?debug so the rest of the suite's backdrop never changes, and `nebula` is the opt-in flag
// that turns it back on. Dropping ?debug entirely would remove `window.__game` — and the world→screen
// projection this scenario needs to find the hull pixels lives there.
//
// Four assertions, and two of them are written carefully because the OBVIOUS formulation is true on a broken
// frame:
//   1. the main renderer never tonemaps (the ACES pass was deleted with the composer — the lighting is
//      authored for direct sRGB output, and ACES multiplies by exposure/0.6 and over-exposed everything);
//   2. the parallax backdrop really CONTRIBUTES — measured differentially (amp 0 vs the shipped amp) in the
//      same frame sequence, because an absolute floor is already satisfied by the baked cube and the stars;
//   3. the backdrop brightness ratio (D13): the nebula's PEAK over the whole sky (bgP99) against the DIMMEST
//      end of the lit hull (hullP25) — the plan's quantities, not a local ring/median. D13's 1.5x CEILING is
//      NOT met (~1.3x) and was already breached by the pre-existing baked cubemap, so what is asserted is a
//      REGRESSION FLOOR at D13_FLOOR. Read the long note at the assertion before touching it;
//   4. nothing is blown out at rest.
//
// All luminances below are sRGB 0..1 — the buffer read is the final image, i.e. what the player actually
// sees (same convention as speed-field.js's BG_LUMA).
export const name = '43-expensive-look';

// D13's REGRESSION FLOOR, RE-MEASURED 2026-08-31 ON THE FRAME THAT ACTUALLY SHIPS.
//
// The number here was 1.25, calibrated against a ~1.30x ratio measured on the FULL-FRAME COMPOSER build
// (bloom + ACES at exposure 1.15, which lifted every hull by exposure/0.6 = 1.67x before the sRGB write).
// That composer was deleted, and so was the additive glow overlay that replaced it, so the frame those
// numbers described no longer exists — the ratio on the shipped two-pass frame is 1.153-1.155x. This was
// confirmed to be a CALIBRATION drift and not a regression from deleting the overlay: the same measurement
// on the last pre-deletion commit gives off=0.1768 on=0.1854 hullP25=0.5075 ratio=1.155x — identical to
// three decimal places. The glow overlay contributed nothing measurable to this frame (its sources are the
// star layer and the corona, and the ship is at rest with its engines idle).
//
// So the floor is re-pinned the same way it was pinned the first time: just under the observed value.
// Observed across three consecutive runs, one of them right after a full page reload: 1.153 / 1.155 / 1.155
// (spread < 0.2%), plus 1.155 on the pre-deletion tree. 1.11 sits ~3.6% under that — the same margin the
// old 1.25-under-1.298 pin used.
//
// MUTATION-CHECKED by raising backdrop.amp, a real and reachable ?tune value (slider range [0, 1.5]):
//   amp 0.25 (shipped) -> ratio 1.155x, hull lit 155 px   PASS
//   amp 0.60           -> ratio 1.160x, hull lit 140 px   PASS
//   amp 1.00           -> ratio 1.146x, hull lit 105 px   FAIL (on HULL_LIT_MIN)
//   amp 1.50           -> ratio 1.090x, hull lit  29 px   FAIL (on both)
// Note what that sweep exposes and record it, because it decides which of the two numbers is doing the
// work: the RATIO is partly self-normalising, since `hullLit` is defined as the ship pixels above bgP99 —
// raise the sky and the surviving subset is a brighter subset, so its p25 rises with it. The COUNT is the
// sensitive half. Both are asserted, and the count is the one that bites first.
const D13_FLOOR = 1.11;

// The parallax layer's contribution, as a FRACTION of the sky's mean luminance rather than an absolute
// number of levels — measured 0.1768 -> 0.1855, i.e. +4.9%, dead stable across runs. Relative because that
// is the quantity that stays meaningful if the backdrop art or the exposure of the frame ever changes,
// which is exactly what invalidated the absolute 0.01 this replaces.
const LAYER_LIFT_MIN = 0.03;
// How many pixels of the ship box must out-shine the sky's peak for the hull to read as a silhouette at
// all. Measured 155-156 out of a 77x77 box; 120 is a real floor, not a formality — see the amp sweep above,
// where it is the assertion that fires first as the backdrop is brightened.
const HULL_LIT_MIN = 120;

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
  await page.waitForFunction('!!(window.__game.backdrop && window.__game.backdrop.amp !== null)', null, { timeout: 45000 });
  await page.waitForTimeout(1500);

  // 1. THE FRAME IS THE PLAIN ONE, and the parallax layer exists. There is no chain to assert live any
  //    more — the composer and the glow overlay were both deleted — so what is guarded here is the thing
  //    that replaced them: the renderer must NEVER be given a tone-mapping curve. ACES multiplies by
  //    exposure/0.6 (a 1.67x lift) and this game's lighting is authored for direct sRGB output, so switching
  //    it on over-exposes the station and every hull. `model-viewer.js` (the hangar) must match — it does
  //    nothing either.
  const chain = await page.evaluate(() => ({
    ...window.__game.backdrop,
    toneMapping: window.__game.renderer.toneMapping,   // THREE.NoToneMapping === 0
  }));
  assert.equal(chain.toneMapping, 0, 'the renderer stays NoToneMapping — the frame goes straight to the canvas');
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
    // PIN THE ZOOM, for the same reason the viewport is pinned above: `camZoom` PERSISTS TO localStorage,
    // so whatever an earlier scenario in this worker left behind decides how many pixels the hull covers —
    // and every number below is measured on those pixels. Unpinned, the ceiling ratio drifts 1.155x when
    // this scenario runs alone to 1.118x when it runs after the rest of the suite, which is enough to make a
    // tight regression floor read as a flake. `tick(5)` skips the 0.2 s ease (it snaps within 1e-3).
    g.zoom.set(1);
    g.zoom.tick(5);
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
    // near-white ROCK (DECISIONS §96: it reads by size and contrast, never by glow), and being sparse it
    // lands in the top percentile of any background sample.
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
        const f0 = split(grab());                                   // the reference frame
        out.skyOff = mean(f0.sky);
        // The layer-OFF sky peak: the floor `amp` cannot reduce, because it is the baked cube plus the
        // bright-star layer. Printed so that if the ceiling below ever fails, it is immediately clear
        // whether dialling `amp` can still fix it or whether the BASE backdrop is what is too bright.
        out.skyP99Off = pct(f0.sky, 0.99);
        g.setBackdropAmp(shippedAmp);
        step = 3;
      } else if (step === 3) { step = 4; }                          // let the restored amp reach the screen
      else {
        const f = split(grab());
        out.skyOn = mean(f.sky);
        // bgP99 — the 99th percentile of the WHOLE sky, i.e. the nebula's PEAK on screen. D13's ceiling is
        // asserted against this and not against a local ring: a ring measures only the sky the ship happens
        // to be sitting in front of right now, so a bright mass two hundred pixels away — exactly what a
        // player flies into a second later — would never enter the number.
        out.bgP99 = pct(f.sky, 0.99);
        out.ringP95 = pct(f.ring, 0.95);   // diagnostics only: the local sky, for retuning by eye
        out.ringP99 = pct(f.ring, 0.99);
        const lit = f.ship.filter((l) => l > out.bgP99);
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
  console.log(`      bgP99=${r.bgP99.toFixed(4)} (layer off: ${r.skyP99Off.toFixed(4)}) ringP95=${r.ringP95.toFixed(4)} ringP99=${r.ringP99.toFixed(4)}`
    + ` · hull lit px=${r.hullLit} p25=${r.hullP25.toFixed(4)} p50=${r.hullP50.toFixed(4)} max=${r.hullMax.toFixed(4)}`
    + ` · ceiling ratio ${(r.hullP25 / (r.bgP99 || 1)).toFixed(3)}x (D13 ideal 1.50x, shipped regression floor ${D13_FLOOR.toFixed(2)}x) · blown=${r.blownPct.toFixed(3)}%`);

  // The frame itself — saved BEFORE the assertions, so a failure still leaves the picture to look at. The
  // automated numbers below cannot replace a human deciding whether this looks expensive or blown out.
  await shot('frame');

  // 2. THE PARALLAX LAYER REALLY CONTRIBUTES. Differential, not absolute: an absolute floor like
  //    `skyP99 >= 0.02` is already satisfied by the baked cube and the star field, so it would say nothing
  //    whatsoever about the layer this feature adds. Measured over the WHOLE sky, because a structured layer
  //    (which is the point — see D17) leaves the void alone and lifts only its masses, so a fixed small
  //    rectangle can easily land in a gap and read zero on a perfectly good layer.
  assert.ok((r.skyOn - r.skyOff) / (r.skyOff || 1) >= LAYER_LIFT_MIN,
    `the backdrop layer adds real light to the frame (sky mean luma ${r.skyOff.toFixed(4)} → ${r.skyOn.toFixed(4)}`
    + `, +${(100 * (r.skyOn - r.skyOff) / (r.skyOff || 1)).toFixed(1)}%, need >= ${100 * LAYER_LIFT_MIN}%)`);

  // 3. THE BACKDROP BRIGHTNESS CEILING (D13) — MEASURED HONESTLY, PINNED AS A REGRESSION FLOOR.
  //
  //    D13 asked for `hullP25 >= 1.5 x bgP99`: the nebula's PEAK over the whole sky staying a factor of 1.5
  //    below the DIMMEST end of the lit hull. That ideal is NOT met and never was — 1.30x under the ACES
  //    composer, 1.155x on the frame that actually ships (the composer's exposure was flattering the hull,
  //    not the sky). What is asserted here is the same quantities, measured the same way, against a floor
  //    just under the measured value, so the ratio can never silently get WORSE. Maintainer's call,
  //    2026-08-30, re-pinned 2026-08-31. See DECISIONS §138.
  //
  //    WHY THE IDEAL IS NOT THIS FEATURE'S DEBT. Attributed on a real frame by switching contributors off:
  //      everything on 0.4770 | this layer at amp 0 -> 0.4555 | + star layers hidden -> 0.4549
  //      | + the baked nebula cubemap removed -> 0.0000
  //    The PRE-EXISTING baked cubemap (docs/plans/2026-07-04-0933-procedural-nebula-sky.md) is ~95% of the
  //    sky peak; this feature's parallax layer is ~4.5% and the stars ~0.1%. The amp sweep confirms the knob
  //    is powerless: amp 0.00 -> 1.36x | 0.08 -> 1.35x | 0.15 -> 1.33x | 0.25 -> 1.30x. The WHOLE range is
  //    worth 0.05x and 0.19x is missing, so deleting the layer outright would still fail 1.50x. Meeting it
  //    would mean dimming shipped backdrop art, or raising hulls — and raising hulls was REJECTED because a
  //    hull must not become a standing light source (the hull emissive floor ships at 0 for the same reason:
  //    at 0.25 it flattened the hulls and killed their glint).
  //
  //    THE METRIC IS DELIBERATELY UNCHANGED. Two weaker formulations were tried and rejected, both of which
  //    pass on a frame the honest one rejects:
  //      • `hullP50` instead of `hullP25` — the median lit facet instead of the dimmest. A hull's shadowed
  //        side is the half that disappears against a bright sky, so the median is the wrong half to ask
  //        about; p25 is the promise "even the dim facets survive the backdrop".
  //      • `ringP95` (a 130 px annulus) instead of `bgP99` (the whole sky) — that only measures the patch of
  //        sky the ship is parked in front of at this instant. The nebula's masses are structured, so the
  //        ring can sit in a void while a mass two hundred pixels away is twice as bright; the player flies
  //        into that mass a second later.
  //    Lowering the THRESHOLD while keeping the honest measurement is a different act from quietly measuring
  //    something easier, and only the first one is happening here.
  assert.ok(r.hullLit >= HULL_LIT_MIN,
    `the hull reads as a silhouette at all (${r.hullLit} pixels in the ship box are brighter than the sky peak ${r.bgP99.toFixed(4)}, need >= ${HULL_LIT_MIN})`);
  assert.ok(r.hullP25 >= D13_FLOOR * r.bgP99,
    `THE BACKDROP GOT BRIGHTER RELATIVE TO THE HULL — this is a REGRESSION FLOOR, not the D13 ideal. `
    + `hullP25 ${r.hullP25.toFixed(4)} >= ${D13_FLOOR}x bgP99 ${r.bgP99.toFixed(4)} = ${(D13_FLOOR * r.bgP99).toFixed(4)}; `
    + `measured ${(r.hullP25 / (r.bgP99 || 1)).toFixed(3)}x, was 1.153-1.155x across three runs when pinned. `
    + `NOTE the approved D13 ideal (1.50x) is NOT met either and never was: with this feature's parallax layer `
    + `switched fully OFF the sky peak is still ${r.skyP99Off.toFixed(4)} (ratio ~${(r.hullP25 / (r.skyP99Off || 1)).toFixed(3)}x), `
    + `so the layer contributes only ${(r.bgP99 - r.skyP99Off).toFixed(4)} of it and DIALLING backdrop.amp CANNOT FIX EITHER NUMBER — `
    + `the pre-existing baked nebula cubemap is ~95% of the sky peak. If THIS floor breaks, something made the `
    + `backdrop brighter or the hulls darker; look there, not at backdrop.amp. See DECISIONS §138(k).`);

  // 4. Nothing is blown out on a frame with no explosion.
  assert.ok(r.blownPct < 0.5, `nothing is blown out at rest (${r.blownPct.toFixed(3)}% of pixels at 250+ on all channels)`);
}
