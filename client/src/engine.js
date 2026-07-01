// Engine singletons: the two scenes, renderer, camera, lights, plus the orientation
// (portrait-phone rotation) and camera-zoom helpers. Created once at module-eval and
// exported by reference. `index.html` imports these; they never import back up the tree.
//
// Side effects at import time (renderer creation, env-map PMREM, body.appendChild, the
// initial applyOrientation()) are safe: this module is imported at the top of the page's
// module script, and `<script type="module">` runs after the body is parsed, so the DOM
// exists. Reads the live quality tier + rotation flag from the shared state bag G.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { G } from './state.js';
import { Device, applyDevice } from './device.js';

// ---------- Base scene ----------
export const scene = new THREE.Scene();
scene.background = null; // background is drawn by the sky scene (first pass); combat is transparent on top
scene.fog = new THREE.Fog(0x0a1624, 240, 600); // match the map background so distant rocks fade into the backdrop

// ---------- Mobile landscape: render the game horizontally even when the phone is held in portrait ----------
// The browser can't make its viewport wider than the physical screen, and screen.orientation.lock is
// unsupported on iOS Safari — so on a touch device in portrait we rotate the whole <body> 90° (CSS class
// `rot`) and run the game in the SWAPPED dimensions. `gameW`/`gameH` are the logical game size the renderer,
// camera and all screen-space math use (swapped when rotated); `toGame(x,y)` maps a pointer's viewport
// coords into game space (inverse of the CSS transform). applyOrientation() (defined below the camera)
// flips this on resize/orientation change. The rotation flag lives on G (read by the reset-slider code too).
export const gameW = () => G.rotated ? window.innerHeight : window.innerWidth;
export const gameH = () => G.rotated ? window.innerWidth : window.innerHeight;
// Inverse of CSS `transform: translateX(100vw) rotate(90deg); transform-origin: top left` → game coords.
export function toGame(clientX, clientY) {
  return G.rotated ? { x: clientY, y: window.innerWidth - clientX } : { x: clientX, y: clientY };
}

export const renderer = new THREE.WebGLRenderer({ antialias: G.gfx.antialias });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, G.gfx.pixelRatioCap));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.info.autoReset = false; // count load across both render passes

// Environment map for ship reflections (tier-gated — off on Performance; see graphics.js / DECISIONS §23).
// A PMREM of THREE's RoomEnvironment gives metallic / low-roughness surfaces (the player ship's chrome &
// painted metal, enemy hulls) real reflections — the "shine" a single directional light can't provide.
// Applied to the combat `scene` only; the sky scene keeps its own flat backdrop look. Built once at
// startup (the room is static), so there's no per-frame cost beyond the shader's cubemap lookup.
if (G.gfx.envMap) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}
document.body.appendChild(renderer.domElement);

export const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 900);
export const CAM_OFFSET = new THREE.Vector3(0, 110, 26); // fixed camera offset from the ship

// Toggle the portrait→landscape rotation and size the renderer/camera to the logical game dimensions.
// Called at boot and on every resize/orientationchange (the only place we size the renderer).
export function applyOrientation() {
  applyDevice();                                                  // recompute form axis + body classes
  G.rotated = Device.hasTouch && window.innerHeight > window.innerWidth; // touch device held in portrait
  document.body.classList.toggle('rot', G.rotated);
  const w = gameW(), h = gameH();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
applyOrientation(); // correct the initial portrait sizing before the first frame

// --- camera zoom: scale the offset toward/away along its fixed angle (smaller = closer/zoom-in).
//     Input sets a target; camZoom eases toward it over ~ZOOM_SMOOTH s so zoom feels smooth, not snappy. ---
const ZOOM_MIN = 0.6, ZOOM_MAX = 2.2;   // closest / farthest multiples of CAM_OFFSET
const ZOOM_SMOOTH = 0.2;                // seconds to (almost) reach a new zoom target
export const camOffset = CAM_OFFSET.clone();   // effective offset used by the follow code (eased toward the target)
const clampZoom = z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
let camZoom = 1;        // current (animated) zoom
let camZoomTarget = 1;  // where zoom is easing toward
export function setZoom(z){
  camZoomTarget = clampZoom(z);
  try { localStorage.setItem('camZoom', camZoomTarget.toFixed(3)); } catch {}
}
export function zoomBy(f){ setZoom(camZoomTarget * f); }
// Ease camZoom -> camZoomTarget each frame (frame-rate independent) and rebuild camOffset.
export function tickZoom(dt){
  if (camZoom === camZoomTarget) return;
  const k = 1 - Math.exp(-dt / (ZOOM_SMOOTH / 4)); // ~ZOOM_SMOOTH s to land (~98%)
  camZoom += (camZoomTarget - camZoom) * k;
  if (Math.abs(camZoomTarget - camZoom) < 1e-3) camZoom = camZoomTarget; // snap when close enough
  camOffset.copy(CAM_OFFSET).multiplyScalar(camZoom);
}
camZoom = camZoomTarget = clampZoom(parseFloat(localStorage.getItem('camZoom')) || 1); // restore saved zoom
camOffset.copy(CAM_OFFSET).multiplyScalar(camZoom);                                     // apply at once on load (no ease)

// === TWO INDEPENDENT LIGHTING SETUPS via two render passes ===
// The sky (planet, moons, stars) is drawn by a separate scene with its own light,
// combat by the main scene with its own. Each scene sees only its own sources,
// so lighting is real and does not "leak" between groups.
renderer.autoClear = false;

// COMBAT LIGHT (main scene) - exactly as before
export const combatAmbient = new THREE.AmbientLight(0x405070, 1.2); // named so the ?tune panel can mutate it live
scene.add(combatAmbient);
export const sun = new THREE.DirectionalLight(0xffffff, 1.68); // combat "sun" from above; +20% (was 1.4)
sun.position.set(30, 60, 20);
scene.add(sun);

// SKY SCENE — its own light (real side source -> real terminator). Its contents (background,
// lights, planet, moons, stars) are built from the map descriptor by buildMap() during bootstrap.
export const skyScene = new THREE.Scene();
