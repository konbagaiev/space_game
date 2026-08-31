// REAL point lights on engines and rockets — A MEASUREMENT FORK, not a shipped feature (yet).
//
// The question it exists to answer: the glow overlay is SCREEN-space (its blur is a fixed number of buffer
// texels) while its sources are WORLD-space, so the halo does not scale with zoom and the ship ends up
// inside its own glow when you pull the camera back. A real light has no such mismatch — it is world-space
// by construction. The open question is only what it COSTS on the weakest phone we ship to.
//
// TURN IT ON WITH A URL FLAG: `?lights=8` or `?lights=16`. Absent or 0 → NOTHING is created and the frame
// is byte-identical to today. That default is deliberate: this must not change normal play while it is
// being measured.
//
// TWO CONSTRAINTS SHAPE EVERY LINE BELOW.
//
// 1. THE POOL IS FIXED AND BUILT ONCE, AT MODULE LOAD. three bakes the light count into every lit
//    material's shader as `#define NUM_POINT_LIGHTS n`, so ADDING OR REMOVING A LIGHT RECOMPILES EVERY LIT
//    MATERIAL IN THE SCENE. Creating a light per rocket launch would fire exactly the stall DECISIONS §83
//    documents from the field: the program count climbing 14 -> 33, one frame at 2082 ms, and a player
//    saying "I don't even want to play after 5 seconds". So lights are never added, never removed, never
//    disposed — they are parked, moved, re-tinted and faded to intensity 0. The count is decided by the URL
//    flag before the first material compiles, which is also why the flag needs a reload to change.
//
// 2. IT RUNS IN THE VIEW LAYER, NEVER IN THE TICK. `update()` is called from `settleView` (sim.js),
//    consumes no randomness at all, and touches no gameplay state — so it is replay-neutral by
//    construction (DECISIONS §73), like the speed-field wrap next to it.
//
// COST MODEL, for whoever reads the numbers this produces: three evaluates EVERY point light for EVERY
// fragment of EVERY lit material. `light.distance` zeroes the contribution past its radius but the maths
// still runs — there is no per-object light culling in the standard material. Ship hulls are
// MeshStandardMaterial, i.e. full PBR, so each light costs an attenuation, a normalize, several dots and a
// GGX specular per fragment. Combat today runs ONE directional light plus an ambient (ambient is nearly
// free), so a pool of 16 is roughly 17x the per-fragment lighting maths. That is the number to measure.
import * as THREE from 'three';
import { scene } from './engine.js';
import { shipPlumes, getActiveFreighterPlume } from './exhaust-fx.js';

const MAX_POOL = 32;

// Parsed ONCE. `?lights=N`; anything unparseable or absent is 0 = off.
function readFlag() {
  try {
    const raw = new URLSearchParams(window.location.search).get('lights');
    const n = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(MAX_POOL, n)) : 0;
  } catch { return 0; }
}

export const POOL_SIZE = readFlag();

// The pool itself. Parked far below the play plane at intensity 0 so an unused light is invisible but still
// present in the shader — which is the honest thing to measure, since its cost is paid whether or not it
// contributes.
const PARK_Y = -100000;
const pool = [];
for (let i = 0; i < POOL_SIZE; i++) {
  // distance/decay: a short, physically-decaying falloff so an engine lights its own hull and whatever is
  // right next to it, not the whole arena. Tunable from the ?dev readout below once numbers exist.
  const l = new THREE.PointLight(0xffffff, 0, 26, 2);
  l.position.set(0, PARK_Y, 0);
  l.castShadow = false;          // shadows are a different (much larger) cost question; not part of this fork
  scene.add(l);
  pool.push(l);
}

// Scratch, reused every frame — this runs at 60 Hz and must not allocate.
const _pos = new THREE.Vector3();
const _cam = new THREE.Vector3();
const cands = [];   // { x, y, z, hex, power } — refilled in place, never re-allocated per frame
let candCount = 0;

function pushCand(x, y, z, hex, power) {
  if (power <= 0.001) return;                 // an idle engine emits nothing; do not spend a slot on it
  const c = cands[candCount] || (cands[candCount] = { x: 0, y: 0, z: 0, hex: 0xffffff, power: 0, d2: 0 });
  c.x = x; c.y = y; c.z = z; c.hex = hex; c.power = power;
  const dx = x - _cam.x, dy = y - _cam.y, dz = z - _cam.z;
  c.d2 = dx * dx + dy * dy + dz * dz;
  candCount++;
}

// `rockets` is passed in rather than imported so this module stays free of the state bag (and so a test or
// a scenario can drive it with a stub).
export function update(camera, rockets) {
  if (!POOL_SIZE) return;                    // flag off: not one line of per-frame work
  _cam.copy(camera.position);
  candCount = 0;

  // --- engines: every live plume, weighted by throttle ---
  const freighter = getActiveFreighterPlume();
  if (freighter) collectPlume(freighter);
  for (const p of shipPlumes) collectPlume(p);

  // --- rockets in flight: a small, always-on source at the body ---
  if (rockets) {
    for (const r of rockets) {
      const p = r && r.pos;
      if (!p || r.alive === false) continue;
      pushCand(p.x, p.y, p.z, ROCKET_HEX, window.__rocketPower);
    }
  }

  // Nearest-first: with more sources than slots, the ones next to the camera are the ones worth lighting.
  // A partial selection would be cheaper, but `cands` is a couple of dozen entries at most — the sort is
  // noise next to the per-fragment cost this fork exists to measure.
  cands.length = candCount;
  cands.sort(byDistance);

  for (let i = 0; i < POOL_SIZE; i++) {
    const l = pool[i];
    const c = i < candCount ? cands[i] : null;
    if (!c) { l.intensity = 0; l.position.y = PARK_Y; continue; }
    l.position.set(c.x, c.y + window.__lightY, c.z);
    l.color.setHex(c.hex);
    l.intensity = c.power;
  }
}

const byDistance = (a, b) => a.d2 - b.d2;
const ROCKET_HEX = 0xffa257;

// INTENSITY IS IN CANDELA AND FALLS OFF AS 1/d^2 (three r155+ is physically correct, `decay: 2`). The first
// cut used 4.0 and was invisible: at 3 world units that contributes ~0.44 and at 8 units ~0.06, against a
// 1.68 sun, a 1.2 ambient AND a PMREM environment. So the numbers have to be large to read at all — and
// because "how bright is right" is exactly what this fork exists to find out, both are LIVE:
//   ?lightpow=N  engine power (default 120)   ·   ?rocketpow=N  rocket power (default 90)
// and `window.__lightPower` / `__rocketPower` can be poked from the console mid-fight.
function readNum(key, dflt) {
  try {
    const n = Number.parseFloat(new URLSearchParams(window.location.search).get(key) ?? '');
    return Number.isFinite(n) && n >= 0 ? n : dflt;
  } catch { return dflt; }
}
window.__lightPower = readNum('lightpow', 120);
// HEIGHT OFFSET, and it may be the whole ballgame. The camera is near-top-down (CAM_OFFSET 0,110,26), so it
// sees mostly the TOP faces of a hull — while a nozzle light sits on the play plane at y~0 and illuminates
// SIDES. A physically-correct light in the right place can therefore be almost invisible FROM THIS ANGLE.
// `?lighty=N` lifts every source above the plane so the same light falls on the surfaces the camera can
// actually see. If lifting it is what makes engines read, that is a finding about the camera, not the light.
window.__lightY = readNum('lighty', 0);
window.__rocketPower = readNum('rocketpow', 90);

function collectPlume(p) {
  const s = p.lightSample && p.lightSample(_pos);
  if (!s) return;
  pushCand(_pos.x, _pos.y, _pos.z, s.hex, window.__lightPower * s.throttle);
}

// Diagnostic for the ?dev overlay / the console: what the fork is actually doing this frame.
export const lightStatus = () => ({
  pool: POOL_SIZE,
  used: Math.min(POOL_SIZE, candCount),
  candidates: candCount,
});
