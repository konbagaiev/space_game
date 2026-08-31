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

function pushCand(x, y, z, hex, power, dist) {
  if (power <= 0.001) return;                 // an idle engine emits nothing; do not spend a slot on it
  const c = cands[candCount] || (cands[candCount] = { x: 0, y: 0, z: 0, hex: 0xffffff, power: 0, dist: 26, d2: 0 });
  c.x = x; c.y = y; c.z = z; c.hex = hex; c.power = power; c.dist = dist;
  const dx = x - _cam.x, dy = y - _cam.y, dz = z - _cam.z;
  c.d2 = dx * dx + dy * dy + dz * dz;
  candCount++;
}

// `rockets` is passed in rather than imported so this module stays free of the state bag (and so a test or
// a scenario can drive it with a stub).
export function update(camera, rockets, dt = 0) {
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
      pushCand(p.x, p.y, p.z, ROCKET_HEX, window.__rocketPower, engineReach);
    }
  }

  collectFlashes(dt);   // explosions last, but they out-power everything so the sort promotes them anyway

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
    // REACH IS PER-SOURCE, and it is the knob that was missing. `distance` is a HARD cutoff — past it the
    // contribution is exactly zero no matter how large `intensity` is. With one fixed 26-unit radius for
    // the whole pool, a boss blast could not light anything further than a scout could, and raising its
    // power only pushed already-saturated nearby surfaces further past white. Both of the maintainer's
    // symptoms ("no change in brightness, no change in how far it reaches" between 8000 and 60000) were
    // this one line.
    l.distance = c.dist;
  }
}

const byDistance = (a, b) => a.d2 - b.d2;
const ROCKET_HEX = 0xffa257;
let engineReach = 26;   // engines/rockets-in-flight: a short radius; the ?tune 'distance' slider drives it

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
window.__lightPower = readNum('lightpow', 300);
// HEIGHT OFFSET, and it may be the whole ballgame. The camera is near-top-down (CAM_OFFSET 0,110,26), so it
// sees mostly the TOP faces of a hull — while a nozzle light sits on the play plane at y~0 and illuminates
// SIDES. A physically-correct light in the right place can therefore be almost invisible FROM THIS ANGLE.
// `?lighty=N` lifts every source above the plane so the same light falls on the surfaces the camera can
// actually see. If lifting it is what makes engines read, that is a finding about the camera, not the light.
window.__lightY = readNum('lighty', 0);
window.__rocketPower = readNum('rocketpow', 150);

function collectPlume(p) {
  const s = p.lightSample && p.lightSample(_pos);
  if (!s) return;
  pushCand(_pos.x, _pos.y, _pos.z, s.hex, window.__lightPower * s.throttle, engineReach);
}

// ---- TRANSIENT FLASHES: explosions are brief, very bright sources ----
// A detonation is the one place a light should genuinely overpower everything for a moment, so these peak
// far above an engine and fall off fast. They are NOT extra lights: a flash competes for the same fixed
// pool as the engines (nearest-to-camera wins), which is what keeps NUM_POINT_LIGHTS constant and avoids
// the §83 recompile. The falloff is quadratic-out, not linear — a linear fade reads as a lamp being turned
// down, while a blast should be gone almost before you register it.
export const BLAST = {
  // POWER IS IN CANDELA AND FALLS OFF AS 1/d^2, so the useful band is much smaller than it looks: at 10
  // units, power 100 already contributes 1.0 — full white. The first cut shipped 3000/12000, which meant
  // everything inside the radius was saturated and raising the number changed nothing visible. These are
  // sized so a blast reads as bright without being clipped flat.
  ship: 400, boss: 1200, rocket: 200,
  // REACH, in world units — how far the flash can light anything at all (a hard cutoff, see update()).
  // This, not power, is what makes a boss detonation feel big: it touches ships a scout's death cannot.
  reachShip: 45, reachBoss: 110, reachRocket: 30,
  dur: 0.22,          // the BASE flash length; every ship class multiplies it (below)
  // How long the light lingers, by hull class — a bigger ship burns longer, not just brighter. Set from
  // live play: normal x2, medium x3, boss x5. `medAt`/`bigAt` are the sizeScale thresholds that sort a
  // death into a class; the boss ROLE always takes `durBoss` whatever its size.
  durShip: 2, durMed: 3, durBoss: 5,
  medAt: 1.4, bigAt: 2.2,
};

// Duration multiplier for a hull of this size. Kept here (not at the call sites) so every explosion path
// classifies the same way.
export function blastDurMul(sizeScale = 1, isBoss = false) {
  if (isBoss) return BLAST.durBoss;
  if (sizeScale >= BLAST.bigAt) return BLAST.durBoss;
  if (sizeScale >= BLAST.medAt) return BLAST.durMed;
  return BLAST.durShip;
}
const flashes = [];   // { x, y, z, hex, peak, t, dur } — a small pool, reused in place

export function addFlash(pos, peak, hex = 0xffb060, dur = BLAST.dur, reach = BLAST.reachShip) {
  if (!POOL_SIZE || !pos || peak <= 0) return;      // flag off: explosions cost nothing
  let f = flashes.find((e) => e.t <= 0);
  if (!f) { f = { x: 0, y: 0, z: 0, hex: 0, peak: 0, t: 0, dur: 1, reach: 45 }; flashes.push(f); }
  f.x = pos.x; f.y = pos.y; f.z = pos.z; f.hex = hex; f.peak = peak; f.dur = dur; f.t = dur; f.reach = reach;
}

function collectFlashes(dt) {
  for (const f of flashes) {
    if (f.t <= 0) continue;
    f.t -= dt;
    if (f.t <= 0) continue;
    const k = f.t / f.dur;                          // 1 -> 0
    pushCand(f.x, f.y, f.z, f.hex, f.peak * k * k, f.reach); // quadratic out: a flash, not a dimmer
  }
}

// ---- live knobs (?tune "Engine lights") ----
// `power` and `falloff` do DIFFERENT things and the difference matters when the ask is "a bit brighter but
// don't blow it out". Intensity is divided by d^2, so raising POWER brightens what is CLOSE far more than
// what is far: the ship's own tail saturates long before a passing hull gets brighter. Softening DECAY
// (2 = physical, 1 = linear) flattens that curve instead — the near surface gains little, the neighbour you
// fly past gains a lot. So: power for overall level, decay for reach, distance for the hard cutoff.
export const lightParams = () => ({
  get power() { return window.__lightPower; },   set power(v) { window.__lightPower = v; },
  get height() { return window.__lightY; },      set height(v) { window.__lightY = v; },
  get distance() { return engineReach; },
  set distance(v) { engineReach = v; },   // per-frame now, so it survives a flash borrowing the same light
  get decay() { return pool.length ? pool[0].decay : 2; },
  set decay(v) { for (const l of pool) l.decay = v; },   // a uniform, not a #define — safe to change live
});

// Diagnostic for the ?dev overlay / the console: what the fork is actually doing this frame.
export const lightStatus = () => ({
  pool: POOL_SIZE,
  used: Math.min(POOL_SIZE, candCount),
  candidates: candCount,
});
