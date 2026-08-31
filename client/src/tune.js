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
import { lightParams, lightStatus } from './engine-lights.js'; // ?lights=N fork
import { getNozzleZ, setNozzleZ } from './exhaust-fx.js'; // live nozzle-anchor probe
import { BLAST } from './engine-lights.js';
import { spawnShipExplosion, spawnBossExplosion, spawnRocketBurst } from './projectiles.js';
import { spawnEnemyShip } from './ship-build.js';
import { CATALOG, enemies } from './state.js';

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
  buildLightsFolder(gui);

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
// The REAL point-light fork (?lights=N). Absent the flag there is no pool and the folder says so rather
// than showing dead sliders.
function buildLightsFolder(gui) {
  const st = lightStatus();
  const f = gui.addFolder('Engine lights (?lights=N)');
  if (!st.pool) {
    f.add({ note: 'off — reload with ?lights=8 or ?lights=16' }, 'note').name('status').disable();
    return;
  }
  const p = lightParams();
  f.add(p, 'power', 0, 800, 5).name('power (overall level)');
  // See the note in engine-lights.js: decay is the knob for "reach a neighbour without frying my own tail".
  f.add(p, 'decay', 1, 2.5, 0.05).name('decay (2 = physical, lower = reaches further)');
  f.add(p, 'distance', 5, 120, 1).name('distance (hard cutoff)');
  f.add(p, 'height', 0, 20, 0.5).name('height above the plane');
  // Where the plume (and therefore its light) starts on the hull. See syncShipPlume for why the baked
  // value is only a mirror of the muzzle and often lands short.
  f.add({ nozzleZ: getNozzleZ() }, 'nozzleZ', -2.5, 1.0, 0.05)
   .name('nozzle Z (− = further aft)').onChange(setNozzleZ);
  // --- BLAST FLASHES, and the buttons that make them tunable at all ---
  // An explosion lasts ~0.2 s, so it cannot be judged by dragging a slider and watching: by the time the
  // eye finds the blast it is over. These fire one ON DEMAND, at the player, with the CURRENT values — drag,
  // click, look, repeat. That loop is the whole reason this folder exists.
  const b = f.addFolder('Blast flashes');
  // POWER: the useful band is small — at 10 units, 100 candela is already full white. Past ~1000 you are
  // only clipping harder, which is why 8000 and 60000 looked identical.
  b.add(BLAST, 'rocket', 0, 1500, 10).name('power: rocket');
  b.add(BLAST, 'ship', 0, 3000, 20).name('power: ship (× size²)');
  b.add(BLAST, 'boss', 0, 6000, 50).name('power: boss (× size²)');
  // REACH: the hard cutoff. THIS is the knob that makes a boss detonation feel big — it decides how far
  // away a hull can be and still be lit at all. Power cannot buy reach.
  b.add(BLAST, 'reachRocket', 5, 120, 1).name('reach: rocket');
  b.add(BLAST, 'reachShip', 5, 200, 1).name('reach: ship (× size)');
  b.add(BLAST, 'reachBoss', 5, 400, 1).name('reach: boss (× size)');
  b.add(BLAST, 'dur', 0.05, 2.0, 0.01).name('duration BASE (s)');
  b.add(BLAST, 'durShip', 1, 8, 0.25).name('× duration: normal');
  b.add(BLAST, 'durMed', 1, 8, 0.25).name('× duration: medium');
  b.add(BLAST, 'durBoss', 1, 12, 0.25).name('× duration: boss');
  b.add(BLAST, 'medAt', 1.0, 3.0, 0.1).name('size ≥ this = medium');
  b.add(BLAST, 'bigAt', 1.0, 4.0, 0.1).name('size ≥ this = boss');
  const at = () => { const p = G.player && G.player.pos; return p ? { x: p.x, y: p.y, z: p.z } : { x: 0, y: 0, z: 0 }; };

  // A TEST RANGE, which is a better rig than the buttons below it: real hulls, real deaths, real spacing,
  // and YOU pick the moment by shooting them. Frozen entirely THROUGH DATA — the spawn is the normal one,
  // and then the entity's own speed/acceleration are zeroed and its mounts emptied. Nothing in sim-core is
  // touched, and nothing here runs unless you press it.
  // Caveat worth knowing: the spawn draws from the seeded stream (§73), so do not record a trace in a
  // session where you have pressed this.
  // Three ranks of three: small / medium / boss-sized. Size drives the blast (power scales as size^2), so
  // this is the whole "does a big hull flash harder than a scout" question in one press.
  const RANGE = { small: 1.0, medium: 1.8, boss: 2.8, spacing: 16, rowGap: 22, hpMul: 1 };
  b.add(RANGE, 'small', 0.5, 2, 0.1).name('rank 1 size (small)');
  b.add(RANGE, 'medium', 0.5, 4, 0.1).name('rank 2 size (medium)');
  b.add(RANGE, 'boss', 0.5, 6, 0.1).name('rank 3 size (boss)');
  b.add(RANGE, 'spacing', 6, 40, 1).name('spacing within a rank');
  b.add(RANGE, 'rowGap', 10, 60, 1).name('gap between ranks');
  b.add(RANGE, 'hpMul', 0.1, 5, 0.1).name('HP multiplier (× size²)');
  b.add({ fire: () => {
    const defs = CATALOG.enemyShips || [];
    if (!defs.length) return;
    const p = at();
    // Pick three DIFFERENT hulls where the catalog has them, so the ranks do not all look alike.
    const pick = [defs[0], defs[Math.min(1, defs.length - 1)], defs[defs.length - 1]];
    const sizes = [RANGE.small, RANGE.medium, RANGE.boss];
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 3; i++) {
        const e = spawnEnemyShip(pick[r]);
        if (!e) continue;
        const x = p.x + (i - 1) * RANGE.spacing * sizes[r];
        const z = p.z - 34 - r * RANGE.rowGap;
        e.pos.x = x; e.pos.z = z; e.pos.y = p.y;
        if (e.vel) { e.vel.x = 0; e.vel.z = 0; }
        e.maxSpeed = 0; e.acceleration = 0;   // frozen: it cannot close on you
        // DISARMED, and BOTH of these are required. Firing walks `ship.groups`, which `makeEnemy`already built
        // from `mounts` at spawn — so emptying `mounts` alone leaves the groups holding live weapon
        // references and the targets shoot back (they did).
        e.mounts = [];
        e.groups = {};
        // THREE fields, and each one does a different job — setting the wrong one is why the first cut
        // spawned nine identical small hulls:
        //   fullScale — the VISIBLE size. `e.scale` is useless here: step-enemies.js rewrites it every frame
        //               from `fullScale` during the spawn-grow animation, so an assignment to it is erased.
        //   sizeScale — what the `kill` event carries, i.e. what sizes the DEATH EXPLOSION (and with it the
        //               blast flash, which scales as size^2).
        //   role      — 'boss' routes the death through spawnBossExplosion instead of the ship one.
        const k = sizes[r];
        e.fullScale = (e.fullScale || 1) * k;
        e.sizeScale = (e.sizeScale || 1) * k;
        // HULL SCALES WITH SIZE TOO, or the rig lies about what it is showing: the first cut made a
        // boss-sized target out of a scout hull, so it died to a single rocket and there was nothing to
        // observe. Squared, matching how the blast itself scales — a 2.8 target takes roughly 8x the
        // punishment, which is long enough to watch it burn and to keep shooting the rank around it.
        const hp = Math.round((e.maxHp || 1) * k * k * RANGE.hpMul);
        e.maxHp = hp; e.hp = hp;
        if (r === 2) e.role = 'boss';
        if (e.mesh) { e.mesh.position.set(x, p.y, z); e.mesh.scale.setScalar(e.fullScale); }
      }
    }
  } }, 'fire').name('▶ spawn 3+3+3 FROZEN targets');
  b.add({ fire: () => { for (const e of [...enemies]) { e.hp = 0; } } }, 'fire').name('▶ clear targets');
  b.add({ fire: () => spawnRocketBurst(at(), 4.5, 0xffb050) }, 'fire').name('▶ test ROCKET blast');
  b.add({ fire: () => spawnShipExplosion(at(), 0xff8030, 1) }, 'fire').name('▶ test SHIP blast (small)');
  b.add({ fire: () => spawnShipExplosion(at(), 0xff8030, 1.8) }, 'fire').name('▶ test SHIP blast (medium)');
  b.add({ fire: () => spawnBossExplosion(at(), 0xff8030, 2.4) }, 'fire').name('▶ test BOSS blast');

  f.add({ note: `pool of ${st.pool}` }, 'note').name('pool').disable();
}

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
