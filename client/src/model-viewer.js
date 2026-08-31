// Self-contained spinning-model 3D viewer (extracted from mainwindow.js so the Main Window's ship/item
// previews AND the Loadout screen's centered ship can share one implementation). Each viewer owns its own
// renderer + scene + camera on a given canvas; its render loop runs only while started (menus only), so it
// costs nothing during a fight. Pure leaf module — no cycle with mainwindow/shop.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { G } from './state.js';
import { gltfLoader, SHIP_MODEL_LEN } from './ship-factory.js';

// Build a viewer on a canvas: renderer + scene + key/ambient light + optional RoomEnvironment PMREM + a
// rotating group. `opts.autoRotate` (default true) → the render loop slowly spins the model; pass false for
// a static/drag-orbited viewer (see setTopDownView + enableOrbit). Returns the viewer object.
export function buildModelViewer(canvas, opts = {}) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: G.gfx.antialias, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio, G.gfx.pixelRatioCap));
  // NO TONE MAPPING HERE, and none in the fight either. The full-frame ACES pass was dropped with the
  // composer (DECISIONS §139 "the pivot"): the game's lighting is authored for direct sRGB output, and ACES
  // — which multiplies by exposure/0.6, a 1.67x lift — was what over-exposed the station and the ships. The
  // hangar matches the fight by doing exactly what the fight does: nothing.
  const sc = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  cam.position.set(0, 1.4, 7);
  cam.lookAt(0, 0, 0);
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 5, 4); sc.add(key);
  sc.add(new THREE.AmbientLight(0x4a5878, 1.4));
  if (G.gfx.envMap) { // same RoomEnvironment reflections as the combat scene (a fresh PMREM per GL context)
    const pm = new THREE.PMREMGenerator(r);
    sc.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
  }
  const group = new THREE.Group(); sc.add(group);
  return { renderer: r, scene: sc, camera: cam, group, raf: 0, url: null, mixer: null, autoRotate: opts.autoRotate !== false };
}
// Start a viewer's render loop (idempotent). Auto-rotates unless the viewer was built with autoRotate:false
// (then the loop just renders — the pose comes from setTopDownView + enableOrbit drag). Rotation is
// TIME-BASED (rad/sec), not per-frame, so it stays smooth when the phone drops/uneven frames (the
// per-frame `+= 0.01` looked jerky under variable frame rate).
export function startViewer(v) {
  if (!v || v.raf) return;
  let last = 0;
  const loop = (ts) => {
    v.raf = requestAnimationFrame(loop);
    const dt = last ? Math.min((ts - last) / 1000, 0.1) : 0; // clamped: a backgrounded tab must not jump
    if (v.autoRotate) v.group.rotation.y += dt * 0.6; // ~0.6 rad/s (≈ the old 0.01/frame @60fps)
    if (v.mixer) v.mixer.update(dt);                  // looping glb animation, if the model ships one
    last = ts;
    v.renderer.render(v.scene, v.camera);
  };
  v.raf = requestAnimationFrame(loop);
}
// Point a viewer's camera straight down (top-down), with the model's nose (+Z) toward the top of the
// screen (camera up = +Z). Used for the Loadout ship. Call once after building.
export function setTopDownView(v) {
  if (!v) return;
  v.camera.position.set(0, 7, 0);
  v.camera.up.set(0, 0, 1);
  v.camera.lookAt(0, 0, 0);
}
// Let the user orbit the model by dragging (mouse or touch). Horizontal drag spins about the vertical
// (screen) axis, vertical drag tilts; the tilt is clamped so the model can't flip. Idempotent per viewer.
export function enableOrbit(v) {
  if (!v || v._orbit) return;
  v._orbit = true;
  const el = v.renderer.domElement;
  let dragging = false, lastX = 0, lastY = 0;
  const down = (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; el.setPointerCapture?.(e.pointerId); el.style.cursor = 'grabbing'; };
  const move = (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    v.group.rotation.y += dx * 0.01;
    v.group.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, v.group.rotation.x + dy * 0.01));
  };
  const end = (e) => { dragging = false; el.releasePointerCapture?.(e.pointerId); el.style.cursor = 'grab'; };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointerleave', end);
  el.style.touchAction = 'none'; // let drag rotate on touch instead of scrolling the page
  el.style.cursor = 'grab';
}
export function stopViewer(v) { if (v && v.raf) { cancelAnimationFrame(v.raf); v.raf = 0; } }
// Fully tear a viewer down (its canvas is being removed) — free the WebGL context so we don't leak one
// per rebuild. Safe to call with null / an already-disposed viewer.
export function disposeViewer(v) {
  if (!v) return;
  stopViewer(v);
  v.mixer = null;
  try { v.renderer.dispose(); v.renderer.forceContextLoss(); } catch { /* context already gone */ }
}
export function resizeViewer(v) {
  if (!v) return;
  const canvas = v.renderer.domElement;
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
  v.renderer.setSize(w, h, false); // false: don't override the CSS-driven canvas size
  v.camera.aspect = w / h;
  v.camera.updateProjectionMatrix();
}
// yaw/scale for an ITEM (weapon/component) preview; mirrors shipModelCfg's defaults. Tolerant of both
// catalog shapes: components keep `stats.model`, the flattened weapon entry has `model` at the top level.
export const itemModelCfg = (item) => {
  const m = (item && (item.model || (item.stats && item.stats.model))) || {};
  return { yaw: m.yaw ?? 0, pitch: m.pitch ?? 0, scale: m.scale ?? 1, scaleMul: m.scaleMul ?? 1 };
};
// Show an arbitrary glb in a viewer — a ship OR an item. Normalizes the longest axis to SHIP_MODEL_LEN,
// recenters, applies the cfg yaw + scale; tint stays off (glbs bake their own colors). No-op if the same
// url is already shown. cfg = { yaw, scale, scaleMul }.
// If the glb carries animation clips, the FIRST one is played on loop (the thruster component's flame —
// see THRUSTER_MODEL in catalog_seed.js). Models without clips behave exactly as before: `v.mixer` stays
// null and the render loop skips it.
export function setViewerModel(v, url, cfg = {}) {
  if (!v || !url || url === v.url) return;
  v.url = url;
  const clear = () => {
    v.mixer = null; // drop the outgoing model's mixer with it (it references the removed scene graph)
    for (let i = v.group.children.length - 1; i >= 0; i--) v.group.remove(v.group.children[i]);
  };
  clear();
  gltfLoader.load(url, (gltf) => {
    if (!v || v.url !== url) return; // target changed mid-load
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = (SHIP_MODEL_LEN / (Math.max(size.x, size.y, size.z) || 1)) * (cfg.scale ?? 1) * (cfg.scaleMul ?? 1);
    model.scale.setScalar(s);
    model.position.copy(center).multiplyScalar(-s);
    // Two nested groups, not one: `pivot` yaws about the VERTICAL axis (the same axis the render loop
    // auto-rotates), while `tilt` pitches the model about X inside it. Folding pitch into the same group
    // would tilt the spin axis too, so a laid-down model would wobble instead of turning like a rotisserie.
    const tilt = new THREE.Group();
    tilt.rotation.x = cfg.pitch || 0;
    tilt.add(model);
    const pivot = new THREE.Group();
    pivot.rotation.y = cfg.yaw || 0;
    pivot.add(tilt);
    clear();
    v.group.add(pivot);
    // Animated glb → drive clip 0 on loop. The mixer must be built AFTER clear() (which nulls it), and it
    // targets `model` (the loaded root), so the normalize/recenter transforms applied above stay intact —
    // glTF animation channels address nodes *inside* the scene, never the root container.
    if (gltf.animations && gltf.animations.length) {
      v.mixer = new THREE.AnimationMixer(model);
      v.mixer.clipAction(gltf.animations[0]).reset().play();
    }
  }, undefined, (err) => console.warn('Preview model failed to load:', url, err));
}
