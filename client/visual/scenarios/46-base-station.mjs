// The BASE STATION's .glb: its texture budget, its lit windows, and the ?stationmat measurement ladder.
//
// Why this scenario exists at all. Nothing covered the glb base station before: 09-mission-setpieces covers
// the three PROCEDURAL set-pieces (research station / asteroid field / freighter), 33-space-factory covers
// the OTHER glb station, and 42-hit-feel / 43-expensive-look both deliberately fly AWAY from the base
// station before they measure anything. So the model the player docks against had no guard on it at all —
// which is how it shipped 1.55 MB of UNCOMPRESSED 1024² PNGs under a build preset that read
// `textureSize: 256` (gltf-transform resizes INSIDE its textureCompress stage, so with `textureCompress`
// unset both the resize AND the compression were silently skipped; see scripts/assets-config.mjs
// `checkPreset`, which now throws on that combination).
//
// The two assertions that carry the feature, and why the obvious version of each is not good enough:
//   • THE DOWNLOAD is read off the PERF TIMELINE and the container's own bytes, not off the build config:
//     config is what lied. The station keeps its full 1024² maps deliberately (texture size moves fps by
//     nothing — DECISIONS §140 amendment — and the solar-panel grid is the model's signature detail), so
//     asserting resolution would guard nothing. The regression is FORMAT: `<= 400 KB` and `EXT_texture_webp`
//     with no `image/png` both fail on the pre-fix glb and pass after it.
//   • THE LIT WINDOWS are MEASURED, not tested for existence. `emissiveMap != null` only catches the
//     solid-texture pruner, which the build-time structure check already catches. It is blind to the
//     failure this feature can actually cause: lossy WebP applied to a 99.5%-black map, leaving the map
//     present but dark. So the map is drawn to a canvas and its peak luminance + lit fraction are read.
//
// Plus one boot per ?stationmat rung, asserting the material the flag claims to install and leaving a frame
// to eyeball. The DEFAULT rung is asserted to be a strict no-op (MeshStandardMaterial / DoubleSide /
// normalMap present) — that is what makes the shipped change a memory win with no look change.
export const name = '46-base-station';

// Measured with the same recipe the assertion uses (Rec.709 on raw 8-bit values, no sRGB decode):
// the pre-fix 1024² PNG gives peak 215.9 / lit 0.415%; the shipped 1024² WebP build gives peak 219.9 /
// lit 0.413% — i.e. the lossy re-encode left the windows untouched. (A 256² build, built and rejected on
// looks, gave 204.4 / 0.375%.) The floors sit well under all three, and the LIT quantity is a FRACTION
// rather than a count so the assertion survives a future resolution change either way.
const EMISSIVE_PEAK_MIN = 160;
const EMISSIVE_LIT_FRAC_MIN = 0.002;
// The shipped build is 270 KB; the pre-fix PNG build was 1 551 KB. 400 KB leaves room for a re-encode or a
// small source change while still failing hard the moment the textures revert to source-format PNG.
const MAX_GLB_BYTES = 400 * 1024;

// three.js side constants (three is not exported onto the debug hook).
const FRONT_SIDE = 0, DOUBLE_SIDE = 2;

// Boot the game on `?debug<query>` and report everything about the base station's first material.
const readStation = async (page, origin, query) => {
  // PIN THE VIEWPORT: the worker's page is shared and the phone-layout scenarios resize it without putting
  // it back, so the review-gate screenshots would otherwise arrive at 844x390.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${origin}/?debug${query}`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 20000 });
  // Take off from whichever screen is up: welcome on a fresh profile, the Main Window once an earlier
  // scenario in this worker has written progress (the two-branch click 43-expensive-look uses).
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-takeoff').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  // The runner's own boot gate silences the intro (run.mjs), but this scenario navigates itself, so it has
  // to do it too — otherwise all four rung screenshots, which ARE the review-gate artefact, carry the intro
  // director's line and card over the base station.
  await page.evaluate(() => window.__game && window.__game.silenceIntro && window.__game.silenceIntro());
  // Wait for the ASYNC glb to be parented and its textures decoded — a state, never a wall clock.
  await page.waitForFunction(() => {
    const s = window.__game && window.__game.baseStation;
    if (!s) return false;
    let mesh = null;
    s.obj.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    return !!(mesh && mesh.material && mesh.material.map && mesh.material.map.image);
  }, null, { timeout: 30000 });
  // AND wait for the level-load veil to be down FOR GOOD before anyone screenshots — the four rung frames
  // ARE the review-gate artefact, and a veiled frame shows nothing of the material it exists to show.
  //
  // Two weaker gates were tried and BOTH let veiled frames through, so do not "simplify" this back:
  //   • `getComputedStyle(veil).opacity === '0'` — reads 0 while the veil is on its way UP (it fades in over
  //     .18s after a .09s delay). This is the probe scenarios 39/40 still use.
  //   • a bare `!classList.contains('on')` — passes trivially when the veil has not been raised YET. The
  //     warm is requested by the glb's own onLoad callback, so at that instant the veil is legitimately off
  //     and comes up a frame later, right under the screenshot.
  // The honest signal is `needsSceneWarm === false` AND the veil down, held for several consecutive frames:
  // `28-scene-warm` documents that late async set-piece arrivals re-raise the flag, so the state oscillates
  // for a moment after a level build and a single sample can catch either edge.
  await page.waitForFunction(() => {
    const g = window.__game, v = document.getElementById('levelwarm');
    const settled = !!g && g.needsSceneWarm === false && !!v && !v.classList.contains('on');
    window.__veilSettled = settled ? (window.__veilSettled || 0) + 1 : 0;
    return window.__veilSettled >= 12;
  }, null, { timeout: 30000, polling: 'raf' });

  return page.evaluate(async () => {
    const g = window.__game;
    // The .glb as it actually came over the wire, plus its texture FORMAT — the two things the build can
    // silently regress. The URL comes from the perf timeline rather than the catalog, so this asserts what
    // the running game really fetched. The glTF container is parsed straight from the bytes: a 12-byte
    // header, then length-prefixed chunks, the first of which is the JSON.
    const entry = performance.getEntriesByType('resource').find((e) => e.name.includes('base_station_combat'));
    const glbBytes = entry ? (entry.encodedBodySize || entry.transferSize || 0) : 0;
    let webp = false, hasPng = false;
    if (entry) {
      const buf = await (await fetch(entry.name)).arrayBuffer();
      const dv = new DataView(buf);
      let off = 12;
      while (off + 8 <= buf.byteLength) {
        const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
        if (type === 0x4e4f534a) {               // 'JSON'
          const j = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
          const exts = [...(j.extensionsUsed || []), ...(j.extensionsRequired || [])];
          webp = exts.includes('EXT_texture_webp');
          hasPng = (j.images || []).some((im) => (im.mimeType || '').includes('png'));
          break;
        }
        off += 8 + len + ((4 - (len % 4)) % 4);
      }
    }
    let mesh = null, meshes = 0;
    g.baseStation.obj.traverse((o) => { if (o.isMesh) { meshes++; if (!mesh) mesh = o; } });
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const px = (t) => (t && t.image ? { w: t.image.width, h: t.image.height } : null);
    // The emissive map, MEASURED. `image` is an ImageBitmap or an HTMLImageElement — both are drawable.
    let emissive = null;
    const img = mat.emissiveMap && mat.emissiveMap.image;
    if (img) {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g2 = c.getContext('2d', { willReadFrequently: true });
      g2.drawImage(img, 0, 0);
      const d = g2.getImageData(0, 0, c.width, c.height).data;
      const n = c.width * c.height;
      let peak = 0, lit = 0;
      for (let i = 0; i < n; i++) {
        const L = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]; // Rec.709 on raw 8-bit
        if (L > peak) peak = L;
        if (L >= 128) lit++;
      }
      emissive = { peak, litFrac: lit / n, w: c.width, h: c.height };
    }
    return {
      meshes,
      glbBytes, webp, hasPng,
      type: mat.type,
      side: mat.side,
      hasNormalMap: !!mat.normalMap,
      hasEmissiveMap: !!mat.emissiveMap,
      hasMap: !!mat.map,
      maps: {
        map: px(mat.map), emissiveMap: px(mat.emissiveMap), normalMap: px(mat.normalMap),
        roughnessMap: px(mat.roughnessMap), metalnessMap: px(mat.metalnessMap),
      },
      emissive,
    };
  });
};

export default async function ({ page, assert, shot, baseURL }) {
  const origin = new URL(baseURL).origin;

  // ---- 1. THE DEFAULT: today's material, untouched. The shipped change must not alter the look. ----
  const std = await readStation(page, origin, '');
  assert.ok(std.meshes > 0, `the base-station .glb loaded and attached meshes (got ${std.meshes})`);
  assert.equal(std.type, 'MeshStandardMaterial',
    'the DEFAULT rung must leave MeshStandardMaterial in place (scene.environment IBL lights this hull)');
  assert.equal(std.side, DOUBLE_SIDE,
    'the DEFAULT rung keeps doubleSided — the hull has 147 boundary edges, FrontSide can punch holes in it');
  assert.ok(std.hasNormalMap, 'the DEFAULT rung keeps the normal map (22.8% of its texels carry real relief)');

  // ---- 2. THE DOWNLOAD BUDGET. The regression test for the whole feature. ----
  // NOT texture RESOLUTION: the station deliberately keeps its full 1024² maps (the solar-panel cell grid is
  // its signature detail and texture size was measured to move fps by nothing — DECISIONS §140 amendment).
  // What broke, and what this guards, is the FORMAT: the source ships uncompressed PNGs, and without
  // `textureCompress` the build silently emits them verbatim at 1.55 MB. WebP at the same 1024² is ~270 KB.
  assert.ok(std.maps.map, 'the base-station baseColor map survived the build');
  assert.ok(std.glbBytes > 0, 'the base-station .glb was fetched as its own resource (perf timeline)');
  assert.ok(std.glbBytes <= MAX_GLB_BYTES,
    `base-station .glb is ${(std.glbBytes / 1024).toFixed(0)} KB — must be <= ${MAX_GLB_BYTES / 1024} KB. `
    + 'The pre-fix build was 1 551 KB of uncompressed 1024² PNGs. Check base_station in '
    + 'scripts/assets-config.mjs: `textureSize` is a SILENT no-op unless `textureCompress` is set '
    + 'alongside it, and without it the textures ship as source-format PNG.');
  assert.ok(std.webp && !std.hasPng,
    `base-station textures must ship as WebP (EXT_texture_webp=${std.webp}, any image/png=${std.hasPng}). `
    + 'PNG here means the textureCompress stage did not run — the exact silent regression this feature fixed.');

  // ---- 3. THE LIT WINDOWS ARE STILL LIT — measured, not merely present. ----
  assert.ok(std.hasEmissiveMap,
    'the base-station emissive map was PRUNED away — optimize\'s solid-texture heuristic flattened a '
    + '99.5%-black map. `pruneSolidTextures: false` in the base_station preset is what prevents this.');
  assert.ok(std.emissive.peak >= EMISSIVE_PEAK_MIN,
    `emissive peak ${std.emissive.peak.toFixed(1)} — the lit windows went out (measured 219.9 on the shipped `
    + `1024² WebP, 215.9 on the 1024² PNG source; floor ${EMISSIVE_PEAK_MIN}). A present-but-dark map is `
    + 'what lossy compression of a 99.5%-black texture can produce.');
  assert.ok(std.emissive.litFrac >= EMISSIVE_LIT_FRAC_MIN,
    `emissive lit fraction ${(100 * std.emissive.litFrac).toFixed(3)}% — the windows faded (measured 0.413% `
    + `on the shipped build, 0.415% on the source; floor ${(100 * EMISSIVE_LIT_FRAC_MIN).toFixed(2)}%).`);
  await shot('default');

  // ---- 4. THE LADDER. One boot per rung; each is exactly one visible delta on the previous. ----
  const lean = await readStation(page, origin, '&stationmat=lean');
  assert.equal(lean.type, 'MeshStandardMaterial', 'lean stays MeshStandardMaterial, so the IBL look survives');
  assert.equal(lean.side, FRONT_SIDE, 'lean backface-culls (side = FrontSide)');
  assert.equal(lean.hasNormalMap, false, 'lean drops the normal map');
  await shot('lean');

  const phong = await readStation(page, origin, '&stationmat=phong');
  assert.equal(phong.type, 'MeshPhongMaterial', 'phong swaps to Blinn-Phong (and loses scene.environment IBL)');
  assert.equal(phong.side, FRONT_SIDE, 'phong is cumulative on lean — still FrontSide');
  assert.ok(phong.hasEmissiveMap, 'phong keeps the emissive map, so the lit windows stay lit on this rung');
  await shot('phong');

  const basic = await readStation(page, origin, '&stationmat=basic');
  assert.equal(basic.type, 'MeshBasicMaterial', 'basic is the measurement floor — zero lighting maths');
  assert.equal(basic.side, FRONT_SIDE, 'basic is cumulative on lean — still FrontSide');
  assert.ok(basic.hasMap, 'basic keeps the baseColor map (it is the only thing left to see)');
  // MeshBasicMaterial has no emissive slot at all: the lit windows go dark on this rung, on purpose.
  assert.equal(basic.hasEmissiveMap, false,
    'MeshBasicMaterial carries no emissive slot — the dark windows on this rung are expected, not a bug');
  await shot('basic');

  // ---- 5. A TYPO NEVER HALF-APPLIES. The flag falls all the way back to the untouched material. ----
  const bogus = await readStation(page, origin, '&stationmat=nonsense');
  assert.equal(bogus.type, 'MeshStandardMaterial', 'an unknown rung falls back to the default material');
  assert.equal(bogus.side, DOUBLE_SIDE, 'an unknown rung does not leave FrontSide behind — no half-apply');
  assert.ok(bogus.hasNormalMap, 'an unknown rung keeps the normal map');
}
