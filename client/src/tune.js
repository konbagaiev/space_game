// Dev-only color/lighting tuning panel (?tune). lil-gui is dynamically imported inside the ?tune guard
// in bootstrap and passed to buildTunePanel(GUI), so players never fetch it and the default build is
// unchanged. Sliders mutate the live light/fog/background refs; "Dump" prints a labeled snapshot saying
// where each value goes (seed vs. hardcoded). See docs/plans/color-tuning.md.
import { scene, skyScene, combatAmbient, sun } from './engine.js';
import { G } from './state.js';
import { buildMap, backdropAmp, setBackdropAmp, getBackdropFollow, setBackdropFollow } from './world.js';
import { postUniforms, bloomHandle, postStatus } from './postfx.js';
import { POST_DEFAULTS } from './graphics.js';
import { setGlobalExhaustGain } from './exhaust-fx.js';

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
  const u = postUniforms(), b = bloomHandle();
  console.log('— client/src/graphics.js  POST_DEFAULTS —', u ? {
    exposure: u.toneMappingExposure.value,
    bloom: b ? { strength: b.strength, radius: b.radius, threshold: b.threshold } : null,
    vignette: { strength: u.uVigStrength.value, softness: u.uVigSoftness.value },
    grade: { gain: [u.uGain.value.x, u.uGain.value.y, u.uGain.value.z], saturation: u.uSat.value },
    backdrop: { amp: backdropAmp(), follow: getBackdropFollow() },
  } : '(no composer on this tier — nothing to dump)');
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

// The post-processing folder. Every control writes STRAIGHT to a live uniform so a drag is instant (no
// rebuild). Absent on Performance, where there is no composer to tune.
//
// NOTE: there are deliberately NO dust `size` sliders here. Size sliders for all three speed-field layers
// already exist in the ?dev Backdrop → "Speed field" folder; they write the live material.size AND persist
// to localStorage, and theirs is the panel buildMap re-applies. A second, non-persisted set writing the same
// number would be two panels with two behaviours for one value (DECISIONS §30). Tune the dust where it lives.
function buildPostFolder(gui) {
  const u = postUniforms();
  const f = gui.addFolder('Post (bloom / grade / vignette)');
  if (!u) {
    f.add({ note: 'no composer on this quality tier (Performance)' }, 'note').name('status').disable();
    return;
  }
  const b = bloomHandle();
  const st = { exposure: u.toneMappingExposure.value,
               gainR: u.uGain.value.x, gainG: u.uGain.value.y, gainB: u.uGain.value.z,
               saturation: u.uSat.value,
               vigStrength: u.uVigStrength.value, vigSoftness: u.uVigSoftness.value,
               exhaustGain: POST_DEFAULTS.exhaustGain,
               amp: backdropAmp() ?? POST_DEFAULTS.backdrop.amp, follow: getBackdropFollow() };
  f.add(st, 'exposure', 0.4, 2.5, 0.01).onChange((v) => { u.toneMappingExposure.value = v; });
  if (b) {
    f.add(b, 'strength', 0, 2, 0.01).name('bloom strength');
    f.add(b, 'radius', 0, 1.5, 0.01).name('bloom radius');
    // The SHIPPED threshold (0.65) is guarded by a unit test: it must stay above the speed-field dust's
    // linear luma (0.607) or the field turns into sparks, which DECISIONS §96 forbids. Dialing below the
    // dust here is a live experiment; it cannot ship.
    // Write `b.threshold`, NOT the uniform: UnrealBloomPass.render() re-assigns
    // highPassUniforms.luminosityThreshold from this.threshold on every frame, so a uniform write is
    // overwritten before it is ever seen.
    f.add(b, 'threshold', 0.40, 1.20, 0.01).name('threshold (dust glows below 0.61)');
  }
  f.add(st, 'vigStrength', 0, 1, 0.01).name('vignette strength').onChange((v) => { u.uVigStrength.value = v; });
  f.add(st, 'vigSoftness', 0, 1, 0.01).name('vignette softness').onChange((v) => { u.uVigSoftness.value = v; });
  // Grade ships at IDENTITY (D9 hue lock) — these exist to judge a look, not to bake in a tint.
  f.add(st, 'gainR', 0.5, 1.5, 0.01).name('grade gain R').onChange((v) => { u.uGain.value.x = v; });
  f.add(st, 'gainG', 0.5, 1.5, 0.01).name('grade gain G').onChange((v) => { u.uGain.value.y = v; });
  f.add(st, 'gainB', 0.5, 1.5, 0.01).name('grade gain B').onChange((v) => { u.uGain.value.z = v; });
  f.add(st, 'saturation', 0, 2, 0.01).name('saturation').onChange((v) => { u.uSat.value = v; });
  f.add(st, 'exhaustGain', 1, 3, 0.05).name('exhaust HDR gain').onChange(setGlobalExhaustGain);
  f.add(st, 'amp', 0, 1.5, 0.01).name('backdrop amp').onChange(setBackdropAmp);
  f.add(st, 'follow', 0.60, 1.00, 0.005).name('backdrop follow (1 = skybox)').onChange(setBackdropFollow);
  f.add({ note: `composer ${postStatus().active ? 'on' : 'off'}, bloom ${postStatus().bloom ? 'on' : 'off'}` }, 'note')
   .name('chain').disable();
}
