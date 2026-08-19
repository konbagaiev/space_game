// Shield bubble FX: a translucent sphere around the player ship that stays faint while the shield is up
// and FLASHES + ripples outward from the impact point on every absorbed hit (variant B). The look is a
// Fresnel rim glow + one expanding ring per recent impact, additively blended. Pure render/cosmetic — it
// reads sim state (player position, shield value) but NEVER writes it or touches the seeded sim RNG, so
// record/playback stay bit-identical. Impacts are registered from the damage sites via registerShieldImpact
// and the bubble is advanced once per rendered frame by updateShieldBubble (native frame delta, not sim dt).
import * as THREE from 'three';
import { scene } from './engine.js';
import { G } from './state.js';
import { SHIELD_RADIUS, broadRadius } from './sim-core/collision.js';

const MAX_IMPACTS = 6;                          // concurrent ripples (round-robin ring buffer)
const RADIUS = SHIELD_RADIUS;                   // bubble radius — the same sphere shots are intercepted on (collision.js); encloses the ship (SHIP_MODEL_LEN ≈ 3.4)
const SHIELD_COLOR = new THREE.Color(0x36d1dc); // active (blue) shield tint — matches the HUD bar gradient
const BREAK_COLOR = new THREE.Color(0xdff6ff);  // brighter near-white for the breaking hit

// Persistent uniform-backed state (three re-uploads these arrays every render; no needsUpdate needed).
const impactDir = Array.from({ length: MAX_IMPACTS }, () => new THREE.Vector3(0, 0, 1));
const impactStart = new Array(MAX_IMPACTS).fill(-999); // far in the past → filtered out until written
const impactBroke = new Array(MAX_IMPACTS).fill(0);

let bubble = null, mat = null, time = 0, writeIdx = 0, readyStart = -999;

const vert = /* glsl */`
  varying vec3 vN;   // world-space normal
  varying vec3 vV;   // world-space view direction (fragment → camera)
  varying vec3 vDir; // object-space unit direction from the sphere center (impact math lives here)
  void main() {
    vDir = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const frag = /* glsl */`
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uBreak;
  uniform float uBase;              // idle Fresnel-rim strength (0 while broken)
  uniform float uReady;             // 1→0 pulse when the shield finishes recharging (whole sphere flashes)
  uniform vec3 uImpactDir[${MAX_IMPACTS}];
  uniform float uImpactStart[${MAX_IMPACTS}];
  uniform float uImpactBroke[${MAX_IMPACTS}];
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vDir;
  void main() {
    float fres = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 3.0);
    vec3 col = uColor;
    float ripple = 0.0, flash = 0.0;
    for (int i = 0; i < ${MAX_IMPACTS}; i++) {
      float age = uTime - uImpactStart[i];
      if (age < 0.0 || age > 1.0) continue;            // slot empty or fully faded
      float d = acos(clamp(dot(vDir, uImpactDir[i]), -1.0, 1.0)); // arc distance 0..PI from the impact point
      float reach = smoothstep(1.5708, 0.0, d);        // 1 at the impact point → 0 by the sphere's mid-latitude (near hemisphere only)
      if (reach <= 0.0) continue;                       // skip the far half entirely
      float life = 1.0 - age;                          // linear fade over ~1s
      float front = age * 1.5708;                       // wave front sweeps from the impact to the mid-latitude over its life
      ripple += exp(-pow((d - front) * 3.5, 2.0)) * life * reach;   // bright ring, dimming as it nears the middle
      flash  += exp(-pow(d * 2.2, 2.0)) * exp(-age * 7.0) * reach;  // quick localized bloom at the impact point
      if (uImpactBroke[i] > 0.5) col = uBreak;
    }
    float intensity = fres * uBase + ripple * 1.1 + flash * 0.9 + uReady * (0.5 + fres * 0.5); // uReady fills the WHOLE sphere (uniform blink), brighter at the rim
    if (intensity <= 0.003) discard;                   // most of the bubble is transparent most of the time
    gl_FragColor = vec4(col * intensity, intensity);
  }
`;

// One material per bubble (player + each pooled enemy slot). The vert/frag SOURCE is identical for all of
// them, so three.js compiles a single program and reuses it — only the uniform arrays differ.
function makeBubbleMaterial(dirs, starts, brokes) {
  return new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.FrontSide,
    uniforms: {
      uTime: { value: 0 }, uColor: { value: SHIELD_COLOR }, uBreak: { value: BREAK_COLOR }, uBase: { value: 0 }, uReady: { value: 0 },
      uImpactDir: { value: dirs }, uImpactStart: { value: starts }, uImpactBroke: { value: brokes },
    },
    vertexShader: vert, fragmentShader: frag,
  });
}

function ensureBubble() {
  if (bubble) return;
  mat = makeBubbleMaterial(impactDir, impactStart, impactBroke);
  bubble = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 32, 24), mat);
  bubble.visible = false;
  bubble.frustumCulled = false; // it tracks the player every frame; never cull it out
  scene.add(bubble);
}

// Register an absorbed hit so the bubble ripples from the impact point. worldPos = where the shot connected;
// the ripple center is the direction from the ship center to that point. No RNG → replay-safe.
export function registerShieldImpact(worldPos, broke = false) {
  ensureBubble();
  const p = G.player && G.player.pos;
  if (!p) return;
  const dir = impactDir[writeIdx];
  dir.set(worldPos.x - p.x, worldPos.y - p.y, worldPos.z - p.z);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); else dir.normalize();
  impactStart[writeIdx] = time;
  impactBroke[writeIdx] = broke ? 1 : 0;
  writeIdx = (writeIdx + 1) % MAX_IMPACTS;
}

// Fire when the shield finishes recharging (broken → full): the WHOLE sphere flashes once — a quick
// uniform blink over the entire bubble surface (uReady pulse), the "shield back online" cue. No RNG →
// replay-safe.
export function spawnShieldReady() {
  ensureBubble();
  readyStart = time; // kick the whole-sphere flash (decays in updateShieldBubble)
}

// Advance the bubble once per rendered frame: track the ship, tick the shader clock, and set the idle rim
// (faint while the shield is up, off while broken). dtSec is the real frame delta (0 while paused).
export function updateShieldBubble(dtSec) {
  time += dtSec;         // module clock: ALWAYS advances (the enemy bubbles share it; see updateEnemyShieldBubbles)
  if (!bubble) return;   // no player bubble built yet (player never hit) — nothing else to do
  const pl = G.player;
  const show = !!(pl && pl.alive && pl.shield);
  bubble.visible = show;
  if (!show) return;
  bubble.position.copy(pl.pos);
  mat.uniforms.uTime.value = time;
  mat.uniforms.uBase.value = pl._shieldValue > 0 ? 0.12 : 0.0; // faint rim only while the shield holds
  mat.uniforms.uReady.value = Math.max(0, 1 - (time - readyStart) / 0.6); // "back online" flash decays over 0.6s
}

// --- Enemy shield bubbles ------------------------------------------------------------------------
// Enemies get NO idle rim (uBase stays 0): a bubble only exists for the ~1s ripple of an ABSORBED hit,
// so an unengaged wave costs nothing. Slot count is capped by the graphics tier (G.gfx.enemyShieldBubbles:
// High 6 / Balance 3 / Performance 0) and the OLDEST slot is recycled when all are busy. Pure render:
// reads enemy positions, never writes sim state and never touches the seeded sim RNG (DECISIONS §73).
const IMPACT_LIFE = 1.0;                       // must match the shader's `age > 1.0` cutoff
const enemyGeo = new THREE.SphereGeometry(1, 24, 16); // unit sphere, scaled per enemy (cheaper than the player's 32×24)
const enemySlots = [];                          // { mesh, mat, dir[], start[], broke[], writeIdx, enemy, until }

function makeEnemySlot() {
  const dir = Array.from({ length: MAX_IMPACTS }, () => new THREE.Vector3(0, 0, 1));
  const start = new Array(MAX_IMPACTS).fill(-999);
  const broke = new Array(MAX_IMPACTS).fill(0);
  const m = makeBubbleMaterial(dir, start, broke);
  const mesh = new THREE.Mesh(enemyGeo, m);
  mesh.frustumCulled = false; // it tracks a moving enemy every frame; never cull it out
  mesh.visible = false;
  scene.add(mesh);
  const slot = { mesh, mat: m, dir, start, broke, writeIdx: 0, enemy: null, until: -999 };
  enemySlots.push(slot);
  return slot;
}

// Pick the slot this impact should play on: the one already bound to this enemy > a free (expired) one >
// a fresh allocation while under the tier cap > the OLDEST busy slot (smallest `until`).
function acquireSlot(enemy, cap) {
  for (const s of enemySlots) if (s.enemy === enemy) return s;
  for (const s of enemySlots) if (s.until <= time) return s;
  if (enemySlots.length < cap) return makeEnemySlot();
  let oldest = enemySlots[0];
  for (const s of enemySlots) if (s.until < oldest.until) oldest = s;
  return oldest;
}

// Register an absorbed hit on an ENEMY's shield: its bubble flashes + ripples from the impact point for
// ~1s and then disappears (no idle rim). worldPos = where the shot connected. No RNG → replay-safe.
export function registerEnemyShieldImpact(enemy, worldPos, broke = false) {
  const cap = (G.gfx && G.gfx.enemyShieldBubbles) || 0;
  if (!cap || !enemy || !enemy.mesh) return;      // Performance tier: nothing is ever allocated
  const slot = acquireSlot(enemy, cap);
  // REBIND: this slot was showing a DIFFERENT enemy (recycled oldest, or one that died mid-ripple). Its
  // impact ring still holds that enemy's hits, which are < IMPACT_LIFE old and would therefore replay on
  // the new enemy's bubble as phantom ripples. Retire them before writing the new impact.
  if (slot.enemy !== enemy) { slot.start.fill(-999); slot.writeIdx = 0; }
  const p = enemy.pos;
  const d = slot.dir[slot.writeIdx];
  d.set(worldPos.x - p.x, worldPos.y - p.y, worldPos.z - p.z);
  if (d.lengthSq() < 1e-6) d.set(0, 0, 1); else d.normalize();
  slot.start[slot.writeIdx] = time;
  slot.broke[slot.writeIdx] = broke ? 1 : 0;
  slot.writeIdx = (slot.writeIdx + 1) % MAX_IMPACTS;
  // Radius in WORLD units: broadR is group-local, so it must be folded with mesh.scale.x — broadRadius()
  // does exactly that (and handles the primitive fallback). enemyGeo is a UNIT sphere → scale === radius.
  slot.mesh.scale.setScalar(broadRadius(enemy) * 1.05);
  slot.mesh.position.copy(p);
  slot.enemy = enemy;
  slot.until = time + IMPACT_LIFE;
  slot.mesh.visible = true;
}

// Advance the pooled enemy bubbles. Call once per rendered frame, immediately AFTER updateShieldBubble()
// — it owns the shared `time` clock; this function never advances it (hence no dt parameter), so a paused
// frame (dtSec 0) freezes an in-flight ripple instead of expiring it.
export function updateEnemyShieldBubbles() {
  for (const s of enemySlots) {
    if (time >= s.until) { s.mesh.visible = false; s.enemy = null; continue; }
    // The enemy died mid-ripple: unbind so the ripple fades in place instead of following a corpse.
    // The enemy left the World (killed, or cleared by a reset). Ask the ENTITY, not the scene: the mesh
    // is released by the host on despawn and is null afterwards, and on a server there is no mesh at all.
    if (s.enemy && !s.enemy.alive) s.enemy = null;
    if (s.enemy) s.mesh.position.copy(s.enemy.pos);
    s.mat.uniforms.uTime.value = time;
    s.mat.uniforms.uBase.value = 0;   // enemies never get the idle Fresnel rim (player-exclusive read)
    s.mat.uniforms.uReady.value = 0;  // and no "back online" whole-sphere flash
  }
}

// Hide + unbind every pooled enemy bubble (called from sim.reset()). The meshes are KEPT (pooled, ≤ the
// tier cap, bound to the persistent scene) so repeated runs can't accumulate meshes — no leak, no rebuild.
export function clearEnemyShieldBubbles() {
  for (const s of enemySlots) {
    s.mesh.visible = false;
    s.enemy = null;
    s.until = -999;
    s.start.fill(-999);
  }
}

// Diagnostic accessor for the headless tests (exposed on window.__game under ?debug) — the live slot array.
export function enemyShieldSlots() { return enemySlots; }
