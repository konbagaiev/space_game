// Shared engine-exhaust FX — ONE additive, baked-texture-once, shader-driven axis-aligned plume used by
// BOTH the cargo-freighter set-piece (world.js) and every ship's engine trail (player + enemies,
// projectiles.js). Same visual family as bolt-fx.js / flipbook-fx.js: a soft glow texture uploaded to the
// GPU exactly once, one compiled program per mode reused across all plumes, per-plume ShaderMaterial with
// uniforms, and NO per-frame buffer re-uploads (the old freighter/trail systems re-uploaded position+color
// buffers every frame). The plume streams along the model's aft -Z axis (axis-aligned, not a camera-facing
// billboard — a billboard fights the stream under the near-top-down camera).
//
// Two selectable LOOKS, switched GLOBALLY (freighter + all ships at once) by a ?dev dropdown:
//   (a) 'points' — silhouette-preserving baked-glow point plume (default; reproduces the old freighter math)
//   (b) 'flame'  — a bolder continuous noise-scroll flame quad (shared unit geometry)
// Every plume builds BOTH meshes and shows whichever `currentMode` selects; a plume attaching later reads
// `currentMode` so it comes up in the current look.
//
// REPLAY SAFETY: NO Math.random and NO simRandom anywhere here — per-particle seeds are a deterministic
// hash(i) (exhaust-config.js). Pure render: nothing touches sim/damage/collision/economy or the seeded
// stream, so recorded replays/intro re-sim bit-identical (DECISIONS §73/§74).
import * as THREE from 'three';
import { scene } from './engine.js';
import { G } from './state.js';
import { EXHAUST_DEFAULTS, SHIP_DEFAULTS, hash, plumeCfg, decayThrottle, derivePalette } from './exhaust-config.js';

// Re-export the pure seams so callers/tests can reach them from the FX module too.
export { EXHAUST_DEFAULTS, SHIP_DEFAULTS, hash, plumeCfg, decayThrottle, derivePalette };

// GLOBAL active look, shared by ALL plumes (freighter + every ship). Seeded from the shipped default; the
// ?dev mode dropdown flips it and fans it out to every live plume (setGlobalExhaustMode). New plumes read
// this at build time so they come up in the current look.
let currentMode = EXHAUST_DEFAULTS.mode;   // 'points' | 'flame'
export const getCurrentMode = () => currentMode;

// Live-editable copy the ?dev panel mutates (never used by prod; dev session only — Copy JSON is the save).
const EXHAUST_TUNE = structuredClone(EXHAUST_DEFAULTS);

// The freighter plume currently in the scene (best-effort; cleared on dispose) — the ?dev panel retargets
// its palette/shape sliders here.
let activeFreighterPlume = null;
export const getActiveFreighterPlume = () => activeFreighterPlume;

// Every live ship plume — the GLOBAL mode toggle fans out to these, and updateShipExhaust advances them.
const shipPlumes = new Set();

// Live probe offset on every ship's nozzle anchor, in hull-local Z (negative = further aft). 0 = the baked
// value. Shifts the plume AND its light together, because they are the same nozzle.
let nozzleZ = 0;
export const getNozzleZ = () => nozzleZ;
export const setNozzleZ = (v) => { nozzleZ = v; };
export { shipPlumes };

// ---- Shared baked glow texture (built once, lazily): soft round white core → transparent rim ----
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();
  glowTex = new THREE.CanvasTexture(cv);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  glowTex.needsUpdate = true;
  return glowTex;
}

// ---- Mode (a): point-glow plume. Shared vertex/fragment source → one compiled program for all point
// plumes. Reproduces the old freighter math (sp = 1 + t*4; -t*len along aft; hot→mid→end 2-segment lerp)
// so the default look preserves the silhouette. Per-particle seed is packed once into the position buffer. ----
const POINTS_VERT = /* glsl */`
  uniform float uTime, uLen, uSize, uSpeed, uSpread, uTurb, uThrottle;
  uniform vec3 uOrigin;
  varying float vT;
  void main() {
    float seed = position.z;                          // hash(i,3) packed at build
    float t = fract(seed + uTime * uSpeed);           // life fraction 0..1
    float sp = 1.0 + t * 4.0;                         // spread grows downstream (matches world.js)
    float wob = sin((seed + t) * 6.2831853) * uTurb;  // deterministic lateral wobble (turbulence)
    vec3 p = uOrigin + vec3((position.x + wob) * uSpread * sp,
                            (position.y) * uSpread * sp,
                            -t * uLen);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * uThrottle * (300.0 / -mv.z); // perspective-scaled world-ish size
    gl_Position = projectionMatrix * mv;
    vT = t;
  }
`;
const POINTS_FRAG = /* glsl */`
  uniform sampler2D map;
  uniform vec3 uColHot, uColMid, uColEnd;
  uniform float uThrottle, uSoft;
  varying float vT;
  void main() {
    vec3 col = vT < 0.5 ? mix(uColHot, uColMid, vT / 0.5)
                        : mix(uColMid, uColEnd, (vT - 0.5) / 0.5);
    float tex = texture2D(map, gl_PointCoord).a;
    float tailFade = 1.0 - vT;                          // dim toward the far tail
    gl_FragColor = vec4(col, tex * uThrottle * uSoft * tailFade);
  }
`;

// ---- Mode (b): noise-scroll flame quad. ONE shared unit plane (never multiplied across ships) laid flat
// in the model's local XZ plane and extended along -Z entirely in the vertex shader (from uOrigin), so all
// flame plumes reuse this single geometry — only the per-plume ShaderMaterial differs. ----
const FLAME_VERT = /* glsl */`
  uniform float uLen, uSpread;
  uniform vec3 uOrigin;
  varying vec2 vUv;
  void main() {
    float along = uv.y;                 // 0 at the nozzle .. 1 at the tip
    float across = position.x;          // -0.5 .. 0.5 across the plume
    float taper = 1.0 - along * 0.75;   // narrow sharply toward the tip (a pointed jet tongue)
    vec3 p = uOrigin + vec3(across * uSpread * 2.0 * taper, 0.0, -along * uLen);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vUv = uv;
  }
`;
const FLAME_FRAG = /* glsl */`
  uniform float uTime, uSpeed, uThrottle, uSoft;
  uniform vec3 uColHot, uColMid, uColEnd;
  varying vec2 vUv;
  void main() {
    float t = vUv.y;                                    // 0 nozzle .. 1 tip
    // weight the gradient toward the HOT color: a jet is a bright hot core, brief orange, quick to dark
    vec3 col = t < 0.35 ? mix(uColHot, uColMid, t / 0.35)
                        : mix(uColMid, uColEnd, (t - 0.35) / 0.65);
    // fast flicker: sin octaves scrolling down the length (no texture-fetch loop). Higher freq + higher
    // time multipliers than points → an intense, rapidly-churning jet (not a slow shimmer).
    float n1 = sin((t * 11.0 - uTime * uSpeed * 9.0) + sin(vUv.x * 14.0) * 1.6);
    float n2 = sin((t * 23.0 - uTime * uSpeed * 14.0) + 2.0);
    float n = 0.78 + 0.16 * n1 + 0.06 * n2;             // high floor → dense/solid body, not gappy
    float across = abs(vUv.x - 0.5) * 2.0;              // 0 centerline .. 1 side edge
    float edge = 1.0 - across;
    float core = pow(edge, 2.5);                        // tight bright spine down the middle
    float body = 1.0 - t;                               // fade toward the tip
    float a = (0.5 * edge + 1.3 * core) * body * n * uThrottle * uSoft;
    col += uColHot * core * 0.7 * body;                 // additive white-hot center → reads as intense
    gl_FragColor = vec4(col, max(0.0, a));
  }
`;

// Shared module-singleton flame geometry (like flipbook-fx.js quadGeo) — one unit plane for every flame.
const flameGeo = new THREE.PlaneGeometry(1, 1);

const _c = new THREE.Color();
const colVec = (hex) => { _c.set(hex); return new THREE.Vector3(_c.r, _c.g, _c.b); };

// Build a plume. Returns a handle with { obj, mode, meshes, setMode, setThrottle, setOrigin, applyCfg,
// rebuild, update, dispose, colorHex, throttle, throttleTarget }. Builds BOTH mode meshes and comes up in
// the global `currentMode`. `cfg` = { count, len, size, speed, spread, palette{hot,mid,end}, turbulence,
// softness }.
export function makePlume(cfg) {
  const obj = new THREE.Group();

  const uniforms = {
    uTime: { value: 0 },
    uLen: { value: cfg.len }, uSize: { value: cfg.size }, uSpeed: { value: cfg.speed },
    uSpread: { value: cfg.spread }, uTurb: { value: cfg.turbulence }, uThrottle: { value: 1 },
    uSoft: { value: cfg.softness },
    uOrigin: { value: new THREE.Vector3(0, 0, 0) },
    uColHot: { value: colVec(cfg.palette.hot) },
    uColMid: { value: colVec(cfg.palette.mid) },
    uColEnd: { value: colVec(cfg.palette.end) },
    map: { value: glowTexture() },
  };

  // --- mode (a): points ---
  let pointsGeo = buildPointsGeo(cfg.count);
  const pointsMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: POINTS_VERT, fragmentShader: POINTS_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  let pointsMesh = new THREE.Points(pointsGeo, pointsMat);
  pointsMesh.frustumCulled = false; // origin can sit far from the plume's own body; don't cull it
  obj.add(pointsMesh);

  // --- mode (b): flame (shares flameGeo + the same uniforms object) ---
  const flameMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    side: THREE.DoubleSide,
  });
  const flameMesh = new THREE.Mesh(flameGeo, flameMat);
  flameMesh.frustumCulled = false;
  obj.add(flameMesh);
  // WHERE THIS PLUME'S LIGHT IS. The plume draws itself in the frame; the LIGHT it casts is a real
  // THREE.PointLight owned by engine-lights.js, and that light needs exactly one thing from here — the
  // nozzle's world position, which is `uOrigin` (the plume's own start point) taken through the plume
  // group's matrix. Tracked as two locals rather than a proxy object: the glow-emitter SPRITE that used to
  // stand in for the light was deleted with the glow overlay (DECISIONS §139) — a real light needs no proxy.
  let lastThrottle = 0;
  let nozzleHex = cfg.palette.hot;   // the engine's hot colour: the tint the real light takes

  const handle = {
    obj,
    mode: currentMode,
    meshes: { points: pointsMesh, flame: flameMesh },
    throttle: 1,          // smoothed thrust 0..1 (freighter stays 1; ships fade — see updateShipExhaust)
    throttleTarget: 0,    // set to 1 by emitExhaust on thrusting frames; zeroed each frame after decay
    colorHex: cfg.palette.mid,  // primary color (= engine exhaust color for ships) — asserted by tests
    setMode(m) {
      handle.mode = m;
      pointsMesh.visible = (m === 'points');
      flameMesh.visible = (m === 'flame');
    },
    setThrottle(v) {
      lastThrottle = v;                 // an idle engine casts no light — engine-lights.js reads this
      uniforms.uThrottle.value = v;
    },
    // Where this engine's LIGHT is, for the real point lights (engine-lights.js). `uOrigin` is the nozzle in
    // the plume group's own space, and the group is scene-parented with a matrix current from the frame just
    // drawn. Writes into the caller's vector; allocates nothing.
    lightSample(out) {
      out.copy(uniforms.uOrigin.value);
      obj.localToWorld(out);
      return { hex: nozzleHex, throttle: lastThrottle };
    },
    setOrigin(vec3, spread) {
      uniforms.uOrigin.value.copy(vec3);   // the light sits AT the nozzle, wherever the plume starts
      if (spread != null) uniforms.uSpread.value = spread;
    },
    applyCfg(c) {
      if (c.len != null) uniforms.uLen.value = c.len;
      if (c.size != null) uniforms.uSize.value = c.size;
      if (c.speed != null) uniforms.uSpeed.value = c.speed;
      if (c.spread != null) uniforms.uSpread.value = c.spread;
      if (c.turbulence != null) uniforms.uTurb.value = c.turbulence;
      if (c.softness != null) uniforms.uSoft.value = c.softness;
      if (c.palette) {
        if (c.palette.hot != null) {
          uniforms.uColHot.value.copy(colVec(c.palette.hot));
          nozzleHex = c.palette.hot;   // …and the real light re-tints with it
        }
        if (c.palette.mid != null) { uniforms.uColMid.value.copy(colVec(c.palette.mid)); handle.colorHex = c.palette.mid; }
        if (c.palette.end != null) uniforms.uColEnd.value.copy(colVec(c.palette.end));
      }
    },
    // Count is baked into the points geometry, so a count change rebuilds it (panel Shape → count).
    rebuild(c) {
      obj.remove(pointsMesh);
      pointsGeo.dispose();
      pointsGeo = buildPointsGeo(c.count);
      pointsMesh = new THREE.Points(pointsGeo, pointsMat);
      pointsMesh.frustumCulled = false;
      obj.add(pointsMesh);
      handle.meshes.points = pointsMesh;
      handle.applyCfg(c);
      handle.setMode(handle.mode);
    },
    update(dt) {
      // advance both materials (they share the uniforms object) so a mode toggle never pops mid-flicker
      uniforms.uTime.value += dt;
    },
    dispose() {
      obj.parent && obj.parent.remove(obj);
      pointsGeo.dispose();          // per-plume points geometry
      pointsMat.dispose();
      flameMat.dispose();
      // keep the shared glow texture + shared flame geometry alive for the session (like bolt/flipbook)
      if (activeFreighterPlume === handle) activeFreighterPlume = null;
    },
  };
  handle.setMode(currentMode);
  return handle;
}

// Build a count-sized points geometry whose single `position` attribute packs the per-particle seed once:
// position[i] = (lateralX, lateralY, seed) — deterministic hash(i,·) (no RNG). The shader reads these.
function buildPointsGeo(count) {
  const n = Math.max(1, count | 0);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3]     = hash(i, 1, 0) - 0.5; // lateral X
    pos[i * 3 + 1] = hash(i, 2, 0) - 0.5; // lateral Y
    pos[i * 3 + 2] = hash(i, 3, 0);       // life seed 0..1
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return geo;
}

// GLOBAL look toggle: set currentMode and fan it out to every live plume (freighter + all ships). The ?dev
// panel wires this once; future callers reuse it. New plumes attaching later read currentMode at build.
export function setGlobalExhaustMode(v) {
  currentMode = v;
  activeFreighterPlume?.setMode(v);
  for (const p of shipPlumes) p.setMode(v);
}

// ---- Freighter helper: build a full-throttle plume from spec.exhaust merged over EXHAUST_DEFAULTS. ----
export function makeFreighterExhaust(spec) {
  const cfg = plumeCfg(spec, EXHAUST_DEFAULTS);
  const plume = makePlume(cfg);
  plume.setThrottle(1);           // the freighter engines are always on
  plume.throttle = 1;
  activeFreighterPlume = plume;   // retarget the ?dev palette/shape sliders here
  return {
    obj: plume.obj,
    plume,
    setOrigin: (vec3, spread) => plume.setOrigin(vec3, spread),
    update: (dt) => plume.update(dt),
    dispose: () => plume.dispose(),
  };
}

// ---- Ship helper + registry: one plume per ship, SCENE-parented and tracked to the hull each frame with a
// yaw LAG (so a fast turn whips the tail behind the ship naturally instead of the rigid tail snapping around
// with the nose). Built lazily on first thrust and cached on mesh.userData.exhaustPlume. ----
const _wp = new THREE.Vector3();
const _wq = new THREE.Quaternion();

// Track a ship plume to its hull: orient with a smoothed yaw lag, then position AT the world-space nozzle.
// `alpha` in [0,1] is the per-frame slerp toward the hull's orientation (1 = snap, used on attach).
function syncShipPlume(p, alpha) {
  const m = p.mesh;
  if (!m) return;
  m.getWorldQuaternion(_wq);        // hull's current world orientation (also refreshes its world matrix)
  if (alpha >= 1) p.obj.quaternion.copy(_wq);
  else p.obj.quaternion.slerp(_wq, alpha);
  // NOZZLE PROBE (?tune "Engine lights" -> nozzle Z). The baked `exhaust` anchor in catalog_seed.js is
  // auto-generated as exactly -muzzle, i.e. MIRRORED from the gun rather than measured off the model — so on
  // a hull whose engines sit further aft (or on the wings) the plume, and the light with it, start too far
  // forward and read as coming from the ship's middle. This offset exists to FIND the right number live;
  // once found it belongs in the model config (regenerate with `npm run assets:muzzle`, or override outside
  // the auto markers — a hand edit inside them is overwritten).
  _wp.set(0, 0, p.tailZ + nozzleZ);
  m.localToWorld(_wp);              // world-space nozzle (includes hull scale + position + rotation)
  p.obj.position.copy(_wp);
}

export function attachShipExhaust(mesh, exhaust) {
  const existing = mesh.userData.exhaustPlume;
  if (existing) return existing;
  const scale = (G.gfx && G.gfx.particleScale != null) ? G.gfx.particleScale : 1;
  const count = Math.max(1, Math.round((exhaust.count ?? SHIP_DEFAULTS.count) * scale)); // tier-scaled once
  const cfg = {
    ...SHIP_DEFAULTS,
    count,
    palette: derivePalette(exhaust.color),
  };
  const plume = makePlume(cfg);
  plume.colorHex = exhaust.color;                          // the engine's single exhaust color (test contract)
  plume.mesh = mesh;                                       // back-ref: the plume tracks this hull each frame
  plume.tailZ = mesh.userData.tailZ ?? -1.6;               // ship-local nozzle (world-scaled in syncShipPlume)
  plume.setOrigin(new THREE.Vector3(0, 0, 0));             // obj is world-placed AT the nozzle; plume streams from its own origin
  plume.throttle = 0;                                      // starts invisible; rises with thrust
  plume.setThrottle(0);
  scene.add(plume.obj);                                    // SCENE-parented (not the hull) so its yaw can lag
  syncShipPlume(plume, 1);                                 // snap to the hull's current pose (no first-frame pop)
  mesh.userData.exhaustPlume = plume;
  shipPlumes.add(plume);
  return plume;
}

export function disposeShipExhaust(mesh) {
  const plume = mesh && mesh.userData && mesh.userData.exhaustPlume;
  if (!plume) return;
  plume.dispose();
  delete mesh.userData.exhaustPlume;
  shipPlumes.delete(plume);
}

// Advance every ship plume: decay its smoothed throttle toward the per-frame target (set by emitExhaust),
// push it into the shader, track it to the hull with a yaw lag, then zero the target so a ship that stops
// thrusting fades out. The lag (k) makes the tail trail behind on fast turns instead of snapping rigidly.
export function updateShipExhaust(dt) {
  const k = 1 - Math.exp(-8 * dt); // yaw-lag catch-up per frame (higher = snappier; frame-rate independent)
  for (const p of shipPlumes) {
    p.throttle = decayThrottle(p.throttle, p.throttleTarget, dt);
    p.throttleTarget = 0;
    p.setThrottle(p.throttle);
    syncShipPlume(p, k);
    p.update(dt);
  }
}

// ---- ?dev tuning panel (mirrors ghost-battle.js buildBackdropPanel). Two SCOPES: the Mode toggle is
// GLOBAL (every plume); Palette + Shape sliders are FREIGHTER-ONLY (activeFreighterPlume). Ships derive
// their own palette from each engine color, so recoloring/resizing the freighter does NOT touch ships. ----
export function buildExhaustPanel(GUI) {
  const gui = new GUI({ title: 'Exhaust (?dev)' });

  // -- Mode (GLOBAL: retargets the freighter AND every ship plume at once) --
  const md = gui.addFolder('Mode (global)');
  md.add(EXHAUST_TUNE, 'mode', ['points', 'flame']).name('Look (all plumes)')
    .onChange((v) => setGlobalExhaustMode(v));

  // -- Palette (freighter-only) --
  const pal = gui.addFolder('Palette (freighter)');
  const applyPal = () => activeFreighterPlume?.applyCfg({ palette: EXHAUST_TUNE.palette });
  pal.addColor(EXHAUST_TUNE.palette, 'hot').name('Hot').onChange(applyPal);
  pal.addColor(EXHAUST_TUNE.palette, 'mid').name('Mid').onChange(applyPal);
  pal.addColor(EXHAUST_TUNE.palette, 'end').name('End').onChange(applyPal);

  // -- Shape (freighter-only) --
  const sh = gui.addFolder('Shape (freighter)');
  sh.add(EXHAUST_TUNE, 'count', 4, 300, 1).name('Count (rebuild)')
    .onChange(() => activeFreighterPlume?.rebuild(EXHAUST_TUNE));
  const applyShape = () => activeFreighterPlume?.applyCfg(EXHAUST_TUNE);
  sh.add(EXHAUST_TUNE, 'len', 4, 160, 1).name('Length').onChange(applyShape);
  sh.add(EXHAUST_TUNE, 'size', 0.5, 24, 0.5).name('Size').onChange(applyShape);
  sh.add(EXHAUST_TUNE, 'speed', 0.1, 6, 0.1).name('Speed').onChange(applyShape);
  sh.add(EXHAUST_TUNE, 'spread', 0.2, 24, 0.2).name('Spread').onChange(applyShape);
  sh.add(EXHAUST_TUNE, 'turbulence', 0, 3, 0.05).name('Turbulence').onChange(applyShape);
  sh.add(EXHAUST_TUNE, 'softness', 0.1, 3, 0.05).name('Softness').onChange(applyShape);

  // -- Export tuned numbers → paste back into EXHAUST_DEFAULTS --
  gui.add({ copy() {
    const json = JSON.stringify(EXHAUST_TUNE, null, 2);
    navigator.clipboard?.writeText(json);
    console.log('[exhaust tune]', json); // fallback when clipboard is blocked
  } }, 'copy').name('Copy JSON');

  // -- status hint (freighter present?) — poll like the Backdrop panel's REC readout. The Mode toggle
  //    still works with no freighter (it retargets the ship plumes). --
  const hint = { note: '' };
  gui.add(hint, 'note').name('status').listen().disable();
  setInterval(() => {
    hint.note = activeFreighterPlume ? 'freighter plume live' : 'no freighter (play the freighter mission)';
  }, 250);
}

// ---- Level-start warm ---------------------------------------------------------------------------------
// The two plume programs (points mode + flame mode) used to compile the first time a ship applied THRUST —
// an event mid-play, not a level boundary. Field telemetry from a Redmi 15C on 2026-09-02 named them
// exactly, on every graphics tier, via `gpu.late`: `Points/ShaderMaterial/transparent` (pointsMat) and
// `Mesh/ShaderMaterial/transparent` (flameMat). See docs/plans/warm-geometry-buffer-uploads.md (addendum).
//
// Both modes are built because `setGlobalExhaustMode` can switch between them at any time, and each mode is
// its own program (different shader source). The plume is a REAL one from `makePlume` — the same
// constructor every ship uses — so the compiled program is the one the live draw asks for; a look-alike
// would compile a different key. The palette and count are uniforms/geometry size, neither of which enters
// a program cache key, so any ship-shaped cfg warms the right programs.
//
// It is never removed and never disposed: THREE frees a program when its last material is disposed
// (DECISIONS §83), and every real plume disposes its materials when its ship dies.
//
// BOTH MESHES STAY `visible = false` FOREVER. `makePlume` sets `frustumCulled = false` on them (a real
// plume's origin can sit far from its body), so a visible warm plume would be submitted as two draw calls
// every frame for the whole session even parked off-camera. Warming a surface must never make it appear,
// and must never cost a draw — check `load.draws` in the ?dev perf sample if you change this.
let warmPlume = null;
export function warmExhaust() {
  if (!warmPlume) {
    warmPlume = makePlume({ ...SHIP_DEFAULTS, palette: derivePalette(0xffffff) });
    warmPlume.obj.name = 'exhaustWarmRig';   // named so a test can find it without guessing at coordinates
    warmPlume.obj.position.y = -100000;      // off-camera as well, belt and braces
    warmPlume.meshes.points.visible = false;
    warmPlume.meshes.flame.visible = false;
    scene.add(warmPlume.obj);
  }
  return [warmPlume.obj];
}

// Diagnostic for the headless guard: the parked warm plume's two meshes (or null before the first warm).
export function warmExhaustMeshes() { return warmPlume ? warmPlume.meshes : null; }
