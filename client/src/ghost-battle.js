// Ghost-battle runtime builder — plays the committed backdrop transform track (client/src/backdrop-battle.js)
// as a dumb lerped animation of a small skirmish at a FIXED ABSOLUTE world point, in every mission EXCEPT the
// freighter escort (you're IN that fight there). THREE-dependent (not unit-tested; covered by the pure sampler
// + a manual visual check).
//
// The battle is a CLEARLY VISIBLE distant skirmish: near-opaque, full-color, moderate scale, at y ≈ GHOST_TUNE.y
// (default −60) — a separate layer BELOW the y=0.6 combat plane (so it's unshootable) but a distant landmark the
// player flies toward. It sits at the absolute world coordinate (GHOST_TUNE.ax, y, az) (default the freighter
// start -100,-450) — the same fixed spot regardless of mission, NOT arenaCenter-relative, NOT following any
// object. It reads as a *separate distant* battle through horizontal separation, NOT dimming. Non-interactive:
// no HUD/markers/health-bars, no collision, no targeting, no audio. It NEVER runs a second sim and never touches
// the live world. See the plan + DECISIONS §59.
import * as THREE from 'three';
import { scene } from './engine.js';
import { G, CATALOG, setPieces } from './state.js';
import { makeShip, shipModelCfg } from './ship-factory.js';
import { spawnShipExplosion, bulletGeo } from './projectiles.js';
import { ghostBattlePlan, sampleShip, frameIndex, MAX_GHOST_BULLETS,
         GHOST_TUNE_RANGES, loadGhostTune, saveGhostTune } from './ghost-battle-track.js'; // slotAlive used by tests only
// births: waves come + go over the loop, so one mesh is built per track SLOT (≤16) and only the born-and-alive
// ones up to plan.maxConcurrent are ever visible (hidden meshes don't draw) — see the update loop below.

const GHOST_EXHAUST = 0xff8030; // death-burst tint (generic)
// Live appearance + placement: defaults are the committed source-of-truth in ghost-battle-track.js
// (GHOST_TUNE_DEFAULTS = { y:-60, scale:0.8, opacity:0.9, ax:-100, az:-450 }); the ?dev "Backdrop" panel
// overrides GHOST_TUNE live + persists. entry.update reads GHOST_TUNE every frame so slider changes (look AND
// the absolute anchor ax/az) apply immediately. ax/az are an ABSOLUTE world coordinate, not an offset (no
// arenaCenter). SINGLE module-scope object: buildBackdropPanel mutates it in place (lil-gui) and entry.update
// reads it — same identity, so slider drags reach the runtime (do NOT re-call loadGhostTune).
const GHOST_TUNE = loadGhostTune(window.localStorage);
let activeGhost = null; // { applyOpacity } handle for the ?dev panel (best-effort; may be stale off-mission)

// Build (async) and register the ghost battle as a set-piece entry anchored at a FIXED ABSOLUTE world point
// (GHOST_TUNE.ax, y, az) — the same spot (default the freighter start -100,-450) regardless of mission, a
// distant landmark the player flies toward. Called from sim.js reset() for every NON-freighter mission on an
// eligible tier. Takes NO argument — placement comes from GHOST_TUNE.
export async function buildGhostBattle() {
  // Skip in BOTH headless harnesses: ?debug (visual suite) AND ?bench (perf A/B) — the feature now fires in the
  // campaign (activeMission null), which the bench trace exercises, and the async glb loads would add
  // nondeterministic draw/tri counts to load.*. Check BEFORE building any scene object or importing the track.
  const headless = location.search.includes('debug') || location.search.includes('bench');
  const plan = ghostBattlePlan(G.gfx.name, headless);
  if (!plan.enabled) return;
  const group = new THREE.Group();
  group.scale.setScalar(GHOST_TUNE.scale);
  scene.add(group);
  // register immediately with a no-op update; swap in the real update once loaded (avoids a load race)
  const entry = { obj: group, update: () => {} };
  setPieces.push(entry);

  const { BACKDROP_BATTLE: T } = await import('./backdrop-battle.js');
  const ghostMeshes = [];
  // Build a mesh for EVERY slot (the track is already capped to MAX_GHOST_SHIPS). Do NOT slice to a per-tier
  // "first N" — that would drop every later-BORN wave. The tier caps CONCURRENT visible ghosts instead
  // (plan.maxConcurrent), applied per-frame by birth/death visibility below.
  const slots = T.ships.map((sh) => {
    const row = CATALOG.shipByName.get(sh.shipName);            // resolve model live (no baked hashes)
    const mc = row ? shipModelCfg(row.stats) : {};
    const spec = row && row.modelUrl
      ? { url: row.modelUrl, tint: false, yaw: mc.yaw ?? 0, scaleMul: mc.scaleMul ?? 1,
          opacity: GHOST_TUNE.opacity }        // near-opaque, full color — a visible distant battle (live-tunable)
      : null;
    const mesh = makeShip(row ? row.stats.color : 0x8899aa, spec);
    mesh.position.y = 0; mesh.visible = false;                  // group at GHOST_TUNE.y; shown once born (below)
    group.add(mesh); ghostMeshes.push(mesh);
    return { data: sh, mesh, dead: false, wasVisible: false };
  });

  // ?dev live-opacity: traverse the (possibly late-loaded) ghost meshes' materials + set opacity/transparent.
  const applyOpacity = (v) => { for (const m of ghostMeshes) m.traverse((o) => { if (o.isMesh && o.material) {
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((mt) => { mt.transparent = true; mt.opacity = v; }); } }); };
  activeGhost = { applyOpacity };

  // Bullet dot pool (High only)
  let bulletPool = [];
  if (plan.bullets) {
    const bmat = new THREE.MeshBasicMaterial({ color: 0xffd27f, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
    for (let i = 0; i < MAX_GHOST_BULLETS; i++) { const m = new THREE.Mesh(bulletGeo, bmat); m.visible = false; group.add(m); bulletPool.push(m); }
  }

  let t = 0;
  const dur = T.frames / T.fps;
  const _wp = new THREE.Vector3();
  entry.update = (dt) => {
    // FIXED ABSOLUTE world anchor — the same spot every mission (default the freighter start -100,-450). Read
    // each frame so the ?dev Anchor X/Z + Depth + Scale sliders apply live (cheap). NOT arenaCenter-relative.
    group.position.set(GHOST_TUNE.ax, GHOST_TUNE.y, GHOST_TUNE.az);
    group.scale.setScalar(GHOST_TUNE.scale);
    t += dt;
    if (t >= dur) { t -= dur; for (const s of slots) s.dead = false; } // loop reset (visibility recomputed below)
    const kf = frameIndex(t, T.fps, T.frames);
    let visible = 0;                       // enforce the per-tier CONCURRENT ceiling
    for (const s of slots) {
      const born = kf >= (s.data.birth || 0);
      const dead = s.data.death >= 0 && kf >= s.data.death;
      if (dead) {
        // explode once, only if this ghost was actually on-screen the previous frame (not capped-out/off) — a
        // never-shown or capped-out ghost must not pop a sourceless explosion. Dead slots don't consume a cap slot.
        if (!s.dead && s.wasVisible) { s.dead = true;
          // real small-pirate explosion, RING pinned to the ghost's own below-plane depth (_wp.y ≈ GHOST_TUNE.y),
          // NOT the combat plane — so no phantom ring appears where the player fights.
          s.mesh.getWorldPosition(_wp); spawnShipExplosion(_wp, GHOST_EXHAUST, GHOST_TUNE.scale, _wp.y); }
        s.mesh.visible = false; s.wasVisible = false; continue;
      }
      if (!born || visible >= plan.maxConcurrent) { s.mesh.visible = false; s.wasVisible = false; continue; }
      s.mesh.visible = true; s.wasVisible = true; visible++;
      const p = sampleShip(s.data, t, T.fps, T.frames, T.qPos, T.qYaw);
      s.mesh.position.set(p.x, 0, p.z);
      s.mesh.rotation.y = p.yaw;
    }
    if (bulletPool.length) {
      const n = T.bullets.counts[kf] || 0;
      let base = 0; for (let i = 0; i < kf; i++) base += T.bullets.counts[i]; // prefix sum
      for (let i = 0; i < bulletPool.length; i++) {
        const on = i < n;
        bulletPool[i].visible = on;
        if (on) bulletPool[i].position.set(T.bullets.x[base + i] / T.qPos, 0, T.bullets.z[base + i] / T.qPos);
      }
    }
  };
}

// ---- ?dev "Backdrop authoring" panel (lil-gui, mirrors the ?tune palette panel). Hosts BOTH the live
// appearance sliders (Depth/Scale/Opacity → GHOST_TUNE, persisted) AND the record controls (Start/Stop +
// a live REC readout that polls window.__backdrop, defined in main.js). Injected in bootstrap() under isDev(),
// via a dynamic lil-gui import → zero cost when ?dev is off. See the plan Step 3b. ----
export function buildBackdropPanel(GUI) {
  const gui = new GUI({ title: 'Backdrop (?dev)' });
  // -- Appearance + placement (live; only visible in a non-freighter mission where the ghost battle exists) --
  const ap = gui.addFolder('Appearance');
  ap.add(GHOST_TUNE, 'y', GHOST_TUNE_RANGES.y[0], GHOST_TUNE_RANGES.y[1], 0.5).name('Depth (y)')
    .onChange(() => saveGhostTune(window.localStorage, GHOST_TUNE));           // applied each frame by entry.update
  ap.add(GHOST_TUNE, 'scale', GHOST_TUNE_RANGES.scale[0], GHOST_TUNE_RANGES.scale[1], 0.05).name('Scale')
    .onChange(() => saveGhostTune(window.localStorage, GHOST_TUNE));
  ap.add(GHOST_TUNE, 'opacity', GHOST_TUNE_RANGES.opacity[0], GHOST_TUNE_RANGES.opacity[1], 0.05).name('Opacity')
    .onChange((v) => { activeGhost?.applyOpacity(v); saveGhostTune(window.localStorage, GHOST_TUNE); });
  // ABSOLUTE world coordinate of the anchor (default (-100,-450)) — dial the exact world spot (±600). These
  // move the battle across the ground plane (clearly visible), unlike Depth which only changes apparent size.
  ap.add(GHOST_TUNE, 'ax', GHOST_TUNE_RANGES.ax[0], GHOST_TUNE_RANGES.ax[1], 5).name('Anchor X (world)')
    .onChange(() => saveGhostTune(window.localStorage, GHOST_TUNE));           // applied each frame (group.position)
  ap.add(GHOST_TUNE, 'az', GHOST_TUNE_RANGES.az[0], GHOST_TUNE_RANGES.az[1], 5).name('Anchor Z (world)')
    .onChange(() => saveGhostTune(window.localStorage, GHOST_TUNE));
  const hint = { note: '' };
  ap.add(hint, 'note').name('status').listen().disable();   // shows "no ghost battle (play a non-freighter mission)"
  // -- Record (drives the global window.__backdrop recorder in main.js) --
  const rc = gui.addFolder('Record');
  const st = { label: '(idle)' };
  const btn = rc.add({ toggle() { const s = window.__backdrop?.status(); if (!s) return; s.recording ? window.__backdrop.stop() : window.__backdrop.record(); } }, 'toggle');
  rc.add(st, 'label').name('elapsed').listen().disable();
  setInterval(() => {                                        // dev-only 4 Hz poll → button label + readout + hint
    const s = window.__backdrop?.status() || { recording: false, elapsed: 0, maxSeconds: 60 };
    btn.name(s.recording ? 'Stop recording' : 'Start recording');
    st.label = s.recording ? `REC ${s.elapsed | 0}s/${s.maxSeconds}s` : '(idle)';
    hint.note = activeGhost ? 'ghost battle live' : 'no ghost battle (play a non-freighter mission)';
  }, 250);
}
