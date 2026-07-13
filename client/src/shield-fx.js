// Shield bubble FX: a translucent sphere around the player ship that stays faint while the shield is up
// and FLASHES + ripples outward from the impact point on every absorbed hit (variant B). The look is a
// Fresnel rim glow + one expanding ring per recent impact, additively blended. Pure render/cosmetic — it
// reads sim state (player position, shield value) but NEVER writes it or touches the seeded sim RNG, so
// record/playback stay bit-identical. Impacts are registered from the damage sites via registerShieldImpact
// and the bubble is advanced once per rendered frame by updateShieldBubble (native frame delta, not sim dt).
import * as THREE from 'three';
import { scene } from './engine.js';
import { G } from './state.js';

const MAX_IMPACTS = 6;                          // concurrent ripples (round-robin ring buffer)
const RADIUS = 4.0;                             // bubble radius — encloses the ship (SHIP_MODEL_LEN ≈ 3.4); tune live
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

function ensureBubble() {
  if (bubble) return;
  mat = new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.FrontSide,
    uniforms: {
      uTime: { value: 0 }, uColor: { value: SHIELD_COLOR }, uBreak: { value: BREAK_COLOR }, uBase: { value: 0 }, uReady: { value: 0 },
      uImpactDir: { value: impactDir }, uImpactStart: { value: impactStart }, uImpactBroke: { value: impactBroke },
    },
    vertexShader: vert, fragmentShader: frag,
  });
  bubble = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 32, 24), mat);
  bubble.visible = false;
  bubble.frustumCulled = false; // it tracks the player every frame; never cull it out
  scene.add(bubble);
}

// Register an absorbed hit so the bubble ripples from the impact point. worldPos = where the shot connected;
// the ripple center is the direction from the ship center to that point. No RNG → replay-safe.
export function registerShieldImpact(worldPos, broke = false) {
  ensureBubble();
  const p = G.player && G.player.mesh && G.player.mesh.position;
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
  if (!bubble) return;
  time += dtSec;
  const pl = G.player;
  const show = !!(pl && pl.alive && pl.shield);
  bubble.visible = show;
  if (!show) return;
  bubble.position.copy(pl.mesh.position);
  mat.uniforms.uTime.value = time;
  mat.uniforms.uBase.value = pl._shieldValue > 0 ? 0.12 : 0.0; // faint rim only while the shield holds
  mat.uniforms.uReady.value = Math.max(0, 1 - (time - readyStart) / 0.6); // "back online" flash decays over 0.6s
}
