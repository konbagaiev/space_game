// Dev-only color/lighting tuning panel (?tune). lil-gui is dynamically imported inside the ?tune guard
// in bootstrap and passed to buildTunePanel(GUI), so players never fetch it and the default build is
// unchanged. Sliders mutate the live light/fog/background refs; "Dump" prints a labeled snapshot saying
// where each value goes (seed vs. hardcoded). See docs/plans/color-tuning.md.
import { scene, skyScene, combatAmbient, sun } from './engine.js';
import { G } from './state.js';
import { buildMap, backdropAmp, setBackdropAmp, getBackdropFollow, setBackdropFollow } from './world.js';
import { glowParams, postStatus } from './postfx.js';
import { POST_DEFAULTS } from './graphics.js';
import { setGlobalEmitterScale, getEmitterScale, setGlobalExhaustGain } from './exhaust-fx.js';

function dumpPalette() {
  const H = c => '0x' + c.getHexString();
  // With the nebula baked, skyScene.background is a CUBE TEXTURE, not a Color — H() would throw on it
  // (Texture has no getHexString). The flat colour only exists on the ?debug / Performance path.
  const bgLabel = skyScene.background && skyScene.background.isColor
    ? H(skyScene.background) : '(baked nebula cube)';
  console.log('— catalog_seed.js  MAPS home-system.descriptor —', {
    background: bgLabel,
    sky: {
      ambient: { color: H(G.skyAmbient.color), intensity: G.skyAmbient.intensity },
      // `pos` is NOT dumped from the live light: it is re-aimed from the star every frame, so the live
      // value is wherever the star happens to be. The seed's `sun.pos` is only the pre-first-frame
      // placement / the fallback for a map with no star — leave it alone unless that is what you are tuning.
      sun: { color: H(G.skySun.color), intensity: G.skySun.intensity, pos: '(auto — aimed from the star)' },
    },
  });
  console.log('— index.html (currently hardcoded) —', {
    fog: { color: H(scene.fog.color), near: scene.fog.near, far: scene.fog.far },
    combatAmbient: { color: H(combatAmbient.color), intensity: combatAmbient.intensity },
    combatSun: { color: H(sun.color), intensity: sun.intensity },
  });
  // The dialed post values, ready to paste back into graphics.js POST_DEFAULTS.
  const g = glowParams();
  console.log('— client/src/graphics.js  POST_DEFAULTS —', postStatus().active ? {
    bloom: { strength: g.strength, radius: g.radius, threshold: g.threshold, knee: g.knee },
    backdrop: { amp: backdropAmp(), follow: getBackdropFollow() },
  } : '(no glow overlay on this tier — nothing to dump)');
}

export function buildTunePanel(GUI) {
  const gui = new GUI({ title: 'Palette (?tune)' });
  const hx = c => '#' + c.getHexString();

  const bg = gui.addFolder('Space backdrop');
  // Same cube-texture guard as dumpPalette: when the nebula is baked the background is a Texture, and both
  // `hx()` and `.set(v)` throw on it. The picker stays visible but inert on that path.
  const bgIsColor = !!(skyScene.background && skyScene.background.isColor);
  const bgC = { background: bgIsColor ? hx(skyScene.background) : '#000000', fog: hx(scene.fog.color) };
  bg.addColor(bgC, 'background').onChange(v => { if (skyScene.background && skyScene.background.isColor) skyScene.background.set(v); });
  bg.addColor(bgC, 'fog').onChange(v => scene.fog.color.set(v));
  bg.add(scene.fog, 'near', 0, 600);
  bg.add(scene.fog, 'far', 100, 1200);

  const sl = gui.addFolder('Sky light (terminator)');
  const slC = { ambient: hx(G.skyAmbient.color), sun: hx(G.skySun.color) };
  sl.addColor(slC, 'ambient').onChange(v => G.skyAmbient.color.set(v));
  sl.add(G.skyAmbient, 'intensity', 0, 3).name('ambient intensity');
  sl.addColor(slC, 'sun').onChange(v => G.skySun.color.set(v));
  sl.add(G.skySun, 'intensity', 0, 8).name('sun intensity');
  // No position sliders: the sky light is re-aimed FROM THE STAR every frame (world.js aimSkySunAtStar),
  // so anything set here would be overwritten on the next one. Only colour + intensity are authored now.
  sl.add({ from: 'the star (auto)' }, 'from').name('direction').disable();

  const cl = gui.addFolder('Combat light (affects ship readability)');
  const clC = { ambient: hx(combatAmbient.color), sun: hx(sun.color) };
  cl.addColor(clC, 'ambient').onChange(v => combatAmbient.color.set(v));
  cl.add(combatAmbient, 'intensity', 0, 3).name('ambient intensity');
  cl.addColor(clC, 'sun').onChange(v => sun.color.set(v));
  cl.add(sun, 'intensity', 0, 4).name('sun intensity');

  // Ocean is a baked texture (makePlanetTexture), so it only re-tints on a full rebuild.
  gui.add({ rebuild: () => { if (G.currentMapDescriptor) buildMap(G.currentMapDescriptor); } }, 'rebuild')
     .name('↻ Rebuild planet (re-bake ocean)');
  buildPostFolder(gui);

  gui.add({ dump: dumpPalette }, 'dump').name('⤓ Dump palette → console');
}

// The post-processing folder: the additive GLOW OVERLAY's live knobs. Every control writes STRAIGHT to the
// shared params object postfx.js reads each frame, so a drag is instant (no rebuild). Absent on Performance,
// where there is no overlay to tune.
//
// There are deliberately no exposure / grade / vignette controls: those lived in the full-frame pass that
// was dropped at the pivot (DECISIONS §138). The frame is written straight to the canvas now — there is no
// full-screen pass to hang a curve on, and the game's lighting is authored for direct sRGB output.
//
// NOTE: there are also deliberately NO dust `size` sliders here. Size sliders for all three speed-field
// layers already exist in the ?dev Backdrop → "Speed field" folder; they write the live material.size AND
// persist to localStorage, and theirs is the panel buildMap re-applies. A second, non-persisted set writing
// the same number would be two panels with two behaviours for one value (DECISIONS §30).
function buildPostFolder(gui) {
  const f = gui.addFolder('Post (glow overlay)');
  const st = postStatus();
  if (!st.active) {
    f.add({ note: 'no glow overlay on this quality tier (Performance)' }, 'note').name('status').disable();
    return;
  }
  const g = glowParams();
  f.add(g, 'strength', 0, 3, 0.01).name('glow strength (0 = off)');
  f.add(g, 'radius', 0.2, 4, 0.05).name('glow radius (blur texels)');
  // The SHIPPED threshold (0.65) is guarded by a unit test: it must stay above the speed-field dust's linear
  // luma (0.607). Since the pivot the dust is not on the glow layer at all, so dialing below it is safe to
  // TRY — but the margin still ships, so a future re-tint of the dust fails a test instead of relying on the
  // layer. What dialing this down really does is let dimmer FX into the glow.
  f.add(g, 'threshold', 0.10, 1.20, 0.01).name('threshold (dust luma 0.61)');
  f.add(g, 'knee', 0, 1, 0.01).name('threshold knee (soft edge)');
  f.add({ exhaustGain: POST_DEFAULTS.exhaustGain }, 'exhaustGain', 1, 3, 0.05)
   .name('engine light BRIGHTNESS').onChange(setGlobalExhaustGain);
  // SIZE, separate from brightness. The blur is a fixed number of glow-buffer TEXELS, i.e. a fixed size on
  // SCREEN, while the emitter is sized in WORLD units — so zooming out shrinks the ship but not the halo,
  // and far enough out the ship sits inside its own glow. That is what this knob is for.
  f.add({ engineLightSize: getEmitterScale() }, 'engineLightSize', 0.1, 3, 0.05)
   .name('engine light SIZE').onChange(setGlobalEmitterScale);
  f.add({ amp: backdropAmp() ?? POST_DEFAULTS.backdrop.amp }, 'amp', 0, 1.5, 0.01)
   .name('backdrop amp').onChange(setBackdropAmp);
  f.add({ follow: getBackdropFollow() }, 'follow', 0.60, 1.00, 0.005)
   .name('backdrop follow (1 = skybox)').onChange(setBackdropFollow);
  f.add({ note: `glow buffer at ${Math.round(st.scale * 100)}% of the canvas` }, 'note').name('overlay').disable();
}
