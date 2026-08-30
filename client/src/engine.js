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
// Matches the map background, so the DEEP speed-field layers fade out into it. NOTE: fog is NOT what hides
// the speed field's wrap edge — THREE.Fog works on VIEW DEPTH, not radial distance, and the shallow layers
// never even reach fogNear; the frustum hides those (see speed-field.js WRAP_SAFE_RADIUS).
//
// These are the planes AT ZOOM 1. Because THREE.Fog measures depth FROM THE CAMERA and camera zoom moves
// the camera away from the ship, both planes are pushed out by that extra distance in applyZoom() below —
// otherwise zooming out drags the SHIP ITSELF past fogNear and the player + stations visibly dim.
const FOG_NEAR = 240, FOG_FAR = 600;
scene.fog = new THREE.Fog(0x0a1624, FOG_NEAR, FOG_FAR);

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

// far = 1300 (was 900): a star-system body fades out at 760 u from the SHIP, and at max zoom the camera sits
// another ~396 u back, so a still-visible body could otherwise be clipped by the far plane mid-fade. Nothing
// else reaches out there — the speed field's deep layer is fully fogged long before (applyZoom clamps fogFar
// well inside this), so the extra range costs only ~0.6 bits of depth precision and changes no visuals.
export const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1300);
export const CAM_OFFSET = new THREE.Vector3(0, 110, 26); // fixed camera offset from the ship

// Subscribers run right AFTER the renderer has been sized, with the logical game size (w, h). The
// post-processing composer (postfx.js) is the only one today: it owns render targets that must follow the
// canvas. Declared HERE, above applyOrientation, because the module calls applyOrientation() immediately
// below — a `const` declared after it would throw a TDZ ReferenceError at boot. postfx imports engine and
// never the other way round, so there is no cycle.
export const onResize = [];

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
  for (const fn of onResize) fn(w, h);
}
applyOrientation(); // correct the initial portrait sizing before the first frame

// --- camera zoom: scale the offset toward/away along its fixed angle (smaller = closer/zoom-in).
//     Input sets a target; camZoom eases toward it over ~ZOOM_SMOOTH s so zoom feels smooth, not snappy. ---
const ZOOM_MIN = 0.35, ZOOM_MAX = 3.5;  // closest / farthest multiples of CAM_OFFSET
const ZOOM_SMOOTH = 0.2;                // seconds to (almost) reach a new zoom target
export const camOffset = CAM_OFFSET.clone();   // effective offset used by the follow code (eased toward the target)
const CAM_DIST0 = CAM_OFFSET.length();         // camera→ship distance at zoom 1 (~113) — the fog reference
const clampZoom = z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
let camZoom = 1;        // current (animated) zoom
let camZoomTarget = 1;  // where zoom is easing toward
export function setZoom(z){
  camZoomTarget = clampZoom(z);
  try { localStorage.setItem('camZoom', camZoomTarget.toFixed(3)); } catch {}
}
export function zoomBy(f){ setZoom(camZoomTarget * f); }

// Rebuild camOffset for the current zoom AND re-anchor the fog to the SHIP rather than to the camera.
// Zoom scales the offset, so at ZOOM_MAX the camera sits ~396 units from the ship — far past the zoom-1
// fogNear of 240, which faded the player ship and the station set-pieces into the background the more you
// zoomed out. Sliding both planes by the extra camera distance keeps "how far past the action does fog
// start" constant at every zoom, and is a no-op at zoom 1 (exactly the original 240..600).
// fogFar is held just inside camera.far so geometry always fades to invisible BEFORE the far plane clips
// it — otherwise the speed field's deep layer would pop at its wrap edge on a wider zoom range.
function applyZoom() {
  camOffset.copy(CAM_OFFSET).multiplyScalar(camZoom);
  const extra = CAM_DIST0 * camZoom - CAM_DIST0;
  scene.fog.far = Math.min(FOG_FAR + extra, camera.far - 20);
  scene.fog.near = Math.min(FOG_NEAR + extra, scene.fog.far - 40);
}
// Ease camZoom -> camZoomTarget each frame (frame-rate independent) and rebuild the offset + fog.
export function tickZoom(dt){
  if (camZoom === camZoomTarget) return;
  const k = 1 - Math.exp(-dt / (ZOOM_SMOOTH / 4)); // ~ZOOM_SMOOTH s to land (~98%)
  camZoom += (camZoomTarget - camZoom) * k;
  if (Math.abs(camZoomTarget - camZoom) < 1e-3) camZoom = camZoomTarget; // snap when close enough
  applyZoom();
}
camZoom = camZoomTarget = clampZoom(parseFloat(localStorage.getItem('camZoom')) || 1); // restore saved zoom
applyZoom();                                                                            // apply at once on load (no ease)

// === TWO INDEPENDENT LIGHTING SETUPS via two render passes ===
// The sky (star + planets, stars) is drawn by a separate scene with its own light,
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
// lights, star + planets, stars) are built from the map descriptor by buildMap() during bootstrap.
export const skyScene = new THREE.Scene();
