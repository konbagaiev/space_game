// Dev-only color/lighting tuning panel (?tune). lil-gui is dynamically imported inside the ?tune guard
// in bootstrap and passed to buildTunePanel(GUI), so players never fetch it and the default build is
// unchanged. Sliders mutate the live light/fog/background refs; "Dump" prints a labeled snapshot saying
// where each value goes (seed vs. hardcoded). See docs/plans/color-tuning.md.
import { scene, skyScene, combatAmbient, sun } from './engine.js';
import { G } from './state.js';
import { buildMap } from './world.js';

function dumpPalette() {
  const H = c => '0x' + c.getHexString();
  console.log('— catalog_seed.js  MAPS home-system.descriptor —', {
    background: H(skyScene.background),
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
}

export function buildTunePanel(GUI) {
  const gui = new GUI({ title: 'Palette (?tune)' });
  const hx = c => '#' + c.getHexString();

  const bg = gui.addFolder('Space backdrop');
  const bgC = { background: hx(skyScene.background), fog: hx(scene.fog.color) };
  bg.addColor(bgC, 'background').onChange(v => skyScene.background.set(v));
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
  gui.add({ dump: dumpPalette }, 'dump').name('⤓ Dump palette → console');
}
