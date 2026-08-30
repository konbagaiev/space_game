// Flipbook (sprite-sheet) explosion — a single camera-facing quad that plays a short pre-rendered
// explosion animation, instead of a stack of ~28 additive particle meshes. This is the classic
// "juicy mobile explosion" trick: one draw call per blast, one texture uploaded ONCE for the whole
// session, and it reads like a movie fireball. Cheap enough to stay ON at every graphics tier.
//
// Design notes (why it's cheap on weak phones — the thing we actually care about, DECISIONS §23):
//   - ONE shared sprite-sheet texture (built procedurally on a <canvas>, no asset file, no license).
//     Every explosion references the SAME texture, so it is uploaded to the GPU exactly once.
//   - Each explosion is a fresh ShaderMaterial that reuses the SAME vertex/fragment source, so THREE
//     compiles ONE program and reuses it (materials differ only by their per-blast `uFrame` uniform).
//   - Billboarding + the current frame are done in the shader, so per-frame CPU cost is ~one uniform
//     write. No per-explosion texture clone (that would re-upload MBs and stall exactly the phones we
//     want to help).
//   - Replay-safe: spawn uses NO Math.random (a module counter gives variety deterministically), so
//     it consumes zero RNG draws whether called live or inside a seeded replay tick. See replay.js.
//
// Public API (mirrors the other FX spawners in projectiles.js):
//   spawnFlipbookExplosion(pos, sizeScale)  — add one blast to the combat scene + the `flipbooks` pool
//   updateFlipbooks(dt)                      — advance every live blast; called from sim.update()
import * as THREE from 'three';
import { scene } from './engine.js';
import { flipbooks, G } from './state.js';
import { POST_DEFAULTS, postGain } from './graphics.js'; // the fireball's HDR lift — gated on the composer (D18)
import { markGlow } from './glow-layer.js'; // the fireball is an intended glow source (postfx's additive overlay)

// ---- Tunables (edit + reload to retune live; these become GUI sliders in a later pass) ----
const COLS = 8, ROWS = 8;              // sprite-sheet grid → COLS*ROWS animation frames
const FRAMES = COLS * ROWS;            // 64 frames (more baked frames → smoother, esp. with shader blending)
const SHEET_PX = 2048;                 // full sheet resolution (cell = SHEET_PX/COLS = 256px)
const FPS = 36;                        // frame-advance rate → whole blast lasts FRAMES/FPS ≈ 1.8 s
const BASE_SIZE = 26;                  // world diameter of the quad at sizeScale = 1
const TAIL_FADE = 0.45;               // fraction of the animation over which it fades to nothing at the end
const HIT_SIZE = 5;                    // world diameter of a bullet-hit mini-blast at sizeScale = 1
const HIT_FPS = 90;                    // bullet hits pop fast (a quick spark, not a lingering fireball)

// ---- Shared sprite-sheet texture (built once, lazily) ----
let sheet = null;
function ensureSheet() {
  if (sheet) return sheet;
  const cell = SHEET_PX / COLS;
  const cv = document.createElement('canvas');
  cv.width = cv.height = SHEET_PX;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, SHEET_PX, SHEET_PX);
  for (let i = 0; i < FRAMES; i++) {
    const col = i % COLS, row = (i / COLS) | 0;
    drawFrame(ctx, col * cell, row * cell, cell, i / (FRAMES - 1));
  }
  sheet = new THREE.CanvasTexture(cv);
  sheet.colorSpace = THREE.SRGBColorSpace;
  sheet.needsUpdate = true;
  return sheet;
}

// Draw one explosion frame into the [x0,y0,cell,cell] cell. f in [0,1] = animation progress.
// Additive-friendly: bright fire drawn on transparent black, accumulated with 'lighter' so overlapping
// glows add up like real fire. A hot white core early → orange fireball → dim red as it dissipates.
function drawFrame(ctx, x0, y0, cell, f) {
  const cx = x0 + cell / 2, cy = y0 + cell / 2;
  const maxR = cell * 0.46;
  const grow = Math.min(1, f * 1.8);                 // fireball expands, full by f≈0.55
  const bodyR = maxR * (0.35 + 0.65 * grow);
  const overall = f < 0.12 ? f / 0.12                 // quick flash in
    : Math.max(0, 1 - Math.max(0, f - (1 - TAIL_FADE)) / TAIL_FADE); // hold, then fade out at the tail
  const coreA = Math.max(0, 1 - Math.max(0, f - 0.08) / 0.5); // hot core is gone by f≈0.58

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Outer fireball body: orange → red → transparent.
  radial(ctx, cx, cy, bodyR, overall, [
    [0.0, 255, 200, 90], [0.35, 255, 120, 40], [0.7, 210, 45, 15], [1.0, 60, 10, 5],
  ]);

  // Turbulent lobes to break up the smooth gradient (deterministic per (cell,frame) → sheet is stable).
  const lobes = 7;
  for (let k = 0; k < lobes; k++) {
    const ang = (k / lobes) * Math.PI * 2 + f * 1.6 + k * 2.3999; // golden-angle-ish swirl over frames
    const dist = bodyR * (0.25 + 0.6 * grow) * (0.6 + 0.4 * hash(k, row0(cell, y0), f));
    const lr = bodyR * (0.28 + 0.18 * hash(k + 3, x0, f));
    radial(ctx, cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, lr, overall * 0.7, [
      [0.0, 255, 170, 70], [0.5, 230, 80, 25], [1.0, 40, 8, 4],
    ]);
  }

  // Hot white core (fades first).
  radial(ctx, cx, cy, bodyR * 0.5, overall * coreA, [
    [0.0, 255, 255, 240], [0.4, 255, 220, 150], [1.0, 255, 120, 40],
  ]);

  ctx.restore();
}

// A radial-gradient filled disc. stops = [[t, r,g,b], …]; alpha of each stop scaled by `a`.
function radial(ctx, cx, cy, r, a, stops) {
  if (a <= 0 || r <= 0) return;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [t, r8, g8, b8] of stops) {
    const alpha = a * (1 - t); // fade toward the rim
    g.addColorStop(t, `rgba(${r8},${g8},${b8},${alpha.toFixed(3)})`);
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

// Cheap stable pseudo-hash in [0,1) — used only to texture the baked sheet (NOT sim RNG).
function hash(a, b, c) {
  const s = Math.sin(a * 12.9898 + b * 0.017 + c * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
function row0(cell, y0) { return (y0 / cell) | 0; }

// ---- Billboard shader (shared source → one compiled program for all blasts) ----
const VERT = /* glsl */`
  uniform float uSize;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); // blast center in view space
    mv.xy += position.xy * uSize;                          // billboard: offset in screen-aligned plane
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */`
  uniform sampler2D map;
  uniform float uCols, uRows, uFrames, uFrame, uOpacity;
  uniform vec3 uTint;                                        // per-blast color multiplier (1,1,1 = the baked fire; >1 = brighter/tinted)
  varying vec2 vUv;
  vec2 cellUv(float f) {                                     // UV into the sprite-sheet cell for frame index f
    float col = mod(f, uCols);
    float row = floor(f / uCols);
    return vec2((col + vUv.x) / uCols, 1.0 - (row + 1.0 - vUv.y) / uRows);
  }
  void main() {
    // Frame BLENDING: cross-fade the current baked frame into the next by the fractional part of uFrame,
    // so the animation looks smooth (synthesized in-between frames) even at a slow frame-advance rate.
    float f0 = floor(uFrame);
    float f1 = min(f0 + 1.0, uFrames - 1.0);
    vec4 tx = mix(texture2D(map, cellUv(f0)), texture2D(map, cellUv(f1)), uFrame - f0);
    gl_FragColor = vec4(tx.rgb * uTint, tx.a * uOpacity);    // AdditiveBlending (SRC_ALPHA, ONE) uses the alpha
  }
`;

const quadGeo = new THREE.PlaneGeometry(1, 1);

function makeMaterial(size, tint) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: ensureSheet() },   // SHARED texture — referenced, never cloned
      uCols: { value: COLS }, uRows: { value: ROWS }, uFrames: { value: FRAMES },
      uFrame: { value: 0 }, uOpacity: { value: 1 }, uSize: { value: size },
      // The fireball is THE bloom source among the FX: uTint is lifted above 1.0 in linear HDR so the core
      // clears the bloom threshold and glows instead of being a flat bright patch. A SCALAR on whatever tint
      // the caller passed, so an authored tint (rocket-burst white-hot, SHIELD_HIT_TINT cyan) keeps its
      // ratios and its hue (D9). It MUST go through postGain: with no composer a >1 value clips per channel
      // at the 8-bit sRGB write (D18). This is also where spawnRocketBurst's `fireTint` gets its lift — the
      // gain is applied ONCE, here, so callers must not pre-multiply it.
      uTint: { value: (tint ? tint.clone() : new THREE.Vector3(1, 1, 1))
        .multiplyScalar(postGain(!!G.gfx.post, POST_DEFAULTS.fxGain.explosion)) },
    },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

let spawnCount = 0; // deterministic variety source (no Math.random → replay-safe)

export function spawnFlipbookExplosion(pos, sizeScale = 1, tint = null, speed = 1) {
  const size = BASE_SIZE * sizeScale;
  const mat = makeMaterial(size, tint);
  const m = new THREE.Mesh(quadGeo, mat);
  m.position.copy(pos);
  m.renderOrder = 3;             // draw over ships/bullets (additive, no depth write)
  // A small deterministic per-blast frame skew so simultaneous deaths don't animate in lockstep.
  const skew = (spawnCount++ % 5) * 0.6;
  markGlow(m);   // the fireball is THE glow source among the FX
  scene.add(m);
  flipbooks.push({ mesh: m, mat, frame: skew, fps: FPS * speed }); // speed > 1 → quicker (e.g. rocket blast)
}

// One material of this config, created once and NEVER disposed, so THREE can't free the compiled program.
// Every flipbook sprite disposes its own material when it finishes, and a program dies with its last
// material — so without this the first explosion after a lull recompiles, blocking the main thread. Field
// telemetry caught exactly that: freeze frames with +7 programs created in the same second (DECISIONS §83).
// The rig in main.js parks it off-camera so `renderer.compile()` reaches it.
export const keepAliveMaterial = () => makeMaterial(BASE_SIZE, null);

// Cyan tint for a hit ABSORBED BY A SHIELD (player or enemy): the same baked fire sprite pushed cold —
// red multiplied down to near-zero, green/blue up — so an absorbed hit reads as "the field stopped it"
// instead of an orange hull spark, without leaving the one FX family. Matches the shield-bubble /
// HUD-bar blue (#36d1dc). Same uTint mechanism as BOSS_SECONDARY_TINT in projectiles.js.
export const SHIELD_HIT_TINT = new THREE.Vector3(0.18, 1.25, 1.5);

// A bullet-hit mini-blast: the SAME baked fire flipbook as the ship death, just small and fast — so a hit
// reads as a tiny explosion in the same visual family (one draw call, shared texture). `sizeScale` comes
// from the weapon-class HIT_FLASH_SCALE (kinetic spark vs. heavier cannon flash); optional `tint` is the
// per-blast color multiplier (null = the baked orange fire, SHIELD_HIT_TINT = an absorbed shield hit).
export function spawnHitSprite(pos, sizeScale = 1, tint = null) {
  const size = HIT_SIZE * sizeScale;
  const mat = makeMaterial(size, tint);
  const m = new THREE.Mesh(quadGeo, mat);
  m.position.copy(pos);
  m.renderOrder = 3;
  const skew = (spawnCount++ % 5) * 0.6;
  markGlow(m);
  scene.add(m);
  flipbooks.push({ mesh: m, mat, frame: skew, fps: HIT_FPS });
}

// Advance every live blast one frame-step; drop + dispose when the animation finishes.
export function updateFlipbooks(dt) {
  for (let i = flipbooks.length - 1; i >= 0; i--) {
    const fb = flipbooks[i];
    fb.frame += dt * fb.fps;
    if (fb.frame >= FRAMES) {
      scene.remove(fb.mesh);
      fb.mat.dispose();          // keep the SHARED sheet texture alive
      flipbooks.splice(i, 1);
      continue;
    }
    fb.mat.uniforms.uFrame.value = fb.frame;
    // fade the last stretch so the sprite doesn't pop off at full brightness
    const f = fb.frame / FRAMES;
    fb.mat.uniforms.uOpacity.value = f < 1 - TAIL_FADE ? 1 : Math.max(0, (1 - f) / TAIL_FADE);
  }
}
