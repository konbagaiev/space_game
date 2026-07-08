// Ghost-battle transform-track helpers — PURE (no THREE/DOM), so they load under bare `node --test` and are
// shared by BOTH the offline bake (client/bench/gen-backdrop.mjs) and the runtime playback
// (client/src/ghost-battle.js) so recording and interpolation agree. See
// docs/plans/2026-07-07-1606-backdrop-ghost-battle.md + DECISIONS §59.
//
// The track is a committed, quantized transform recording of a small skirmish (<=6 ships + bullets),
// baked from the deterministic bench replay. This module owns the tier/?debug gating decision, the
// per-frame sampler (lerp + shortest-arc yaw, clamped at the loop end), and the quantize/dequantize math.

// Tier/debug gating — the single source of truth (unit-tested). `maxConcurrent` = how many ghosts may be
// VISIBLE at once (a draw-call ceiling); the track holds up to MAX_GHOST_SHIPS *slots* over the whole loop
// (waves come and go via birth/death), and the runtime shows only the currently born-and-alive ones, capped
// to maxConcurrent. (Was `maxShips` = "first N slots", which dropped every later-born wave — see births.)
// Performance = off, ?debug = off (so the headless visual suite is not perturbed).
export function ghostBattlePlan(tierName, isDebug) {
  if (isDebug) return { enabled: false, maxConcurrent: 0, bullets: false };
  if (tierName === 'performance') return { enabled: false, maxConcurrent: 0, bullets: false };
  if (tierName === 'balance')     return { enabled: true,  maxConcurrent: 4, bullets: false };
  return { enabled: true, maxConcurrent: 8, bullets: true }; // high + any unknown → full
}

export const MAX_GHOST_SHIPS = 16;   // total track SLOTS over the whole loop (player + up to 15 enemy waves)
export const MAX_GHOST_BULLETS = 24;

// Is slot `sh` alive (born + not yet dead) at keyframe `kf`? Player slot is birth:0/death:-1 → always alive.
// Pre-birth (kf < birth) and post-death (kf >= death) are BOTH excluded — those samples are placeholders/
// frozen and hidden at playback, so they must not enter the re-center centroid or the bounded-formation bound.
export const slotAlive = (sh, kf, frames) => kf >= (sh.birth || 0) && kf < (sh.death < 0 ? frames : sh.death);

// Dequantize one stored int stream value.
export const deq = (v, q) => v / q;

const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) { // shortest-arc
  let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

// Sample a ship slot at playback time t (seconds). Returns { x, z, yaw }. Lerps position, shortest-arc
// yaw; clamps at the last frame (no cross-loop interpolation). qPos/qYaw dequantize.
export function sampleShip(ship, t, fps, frames, qPos, qYaw) {
  const f = t * fps;
  let i0 = Math.floor(f) % frames; if (i0 < 0) i0 += frames;
  const i1 = i0 + 1 >= frames ? i0 : i0 + 1;         // clamp at end → no wrap lerp
  const a = i1 === i0 ? 0 : f - Math.floor(f);
  const x = lerp(ship.x[i0] / qPos, ship.x[i1] / qPos, a);
  const z = lerp(ship.z[i0] / qPos, ship.z[i1] / qPos, a);
  const yaw = lerpAngle(ship.yaw[i0] / qYaw, ship.yaw[i1] / qYaw, a);
  return { x, z, yaw };
}

// Current integer keyframe index (for death checks + bullet snap).
export const frameIndex = (t, fps, frames) => { let i = Math.floor(t * fps) % frames; return i < 0 ? i + frames : i; };

// ---- Live appearance tuning (?dev panel). DEFAULTS are the committed source-of-truth (bake the maintainer's
// dialed-in numbers here); the panel overrides them live + persists to localStorage['ghostTune']. Mirrors the
// graphics.js loadTier/saveTier localStorage discipline. The old build over-dimmed the battle into invisibility
// (opacity 0.35 × darken 0.45 × scale 0.5 × y −48); the new defaults make it a watchable distant battle. ----
export const GHOST_TUNE_KEY = 'ghostTune';
// y = depth (below the 0.6 combat plane); ax/az = the ABSOLUTE world coordinate of the anchor — the same fixed
// world spot regardless of which mission is active (NOT arenaCenter-relative, NOT following anything). Default
// = the freighter mission center (-100,-450), a distant landmark the player flies toward.
export const GHOST_TUNE_DEFAULTS = { y: -60, scale: 0.8, opacity: 0.9, ax: -100, az: -450 };
export const GHOST_TUNE_RANGES = { y: [-80, 0], scale: [0.3, 1.5], opacity: [0.1, 1.0], ax: [-600, 600], az: [-600, 600] };
const _clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export function clampGhostTune(t = {}) {
  const d = GHOST_TUNE_DEFAULTS, r = GHOST_TUNE_RANGES, n = (v, k) => Number.isFinite(+v) ? +v : d[k];
  const out = {};
  for (const k of Object.keys(d)) out[k] = _clamp(n(t[k], k), r[k][0], r[k][1]);
  return out; // { y, scale, opacity, ax, az }
}
export function loadGhostTune(store) {
  try { const s = store && store.getItem(GHOST_TUNE_KEY); if (s) return clampGhostTune(JSON.parse(s)); } catch {}
  return { ...GHOST_TUNE_DEFAULTS };
}
export function saveGhostTune(store, t) {
  const c = clampGhostTune(t);
  try { store && store.setItem(GHOST_TUNE_KEY, JSON.stringify(c)); } catch {}
  return c;
}

export const QPOS = 10, QYAW = 100; // canonical quanta (0.1 u, 0.01 rad)

// Turn a RAW captured battle into the committed quantized track. Shared by the in-game recorder AND the
// synthetic generator so both produce byte-compatible modules. Mutates `raw`'s float arrays in place (throwaway).
//   raw = { name?, seed?, fps, frames, ships:[{shipName, scale, birth, death, x[],z[],yaw[]}], bullets:{counts[],x[],z[]} }
// Steps: (1) RE-CENTER by ONE FIXED OFFSET (not per-keyframe) = the MEAN of the player's (slot-0) positions over
// the whole track. Subtract that single (mx,mz) from ALL ships AND ALL bullets. The player's real free-flight
// motion is PRESERVED (only a constant is removed), and the cloud is centered near origin so it sits at the
// anchor. A single constant → no per-frame membership dependence → NO birth/death jumps. (We do NOT subtract
// slot-0 per-keyframe: that pins the player at origin, which the maintainer rejected — the player must fly
// freely. We also do NOT subtract the per-frame cast centroid: births/deaths step it → the whole formation
// jumps.) The cloud centers on the player's mean PATH (not the cast centroid), so enemies biased to one side
// sit slightly off the anchor — that's what the ?dev Anchor X/Z sliders nudge. (2) Quantize to ints.
export function recenterAndQuantize(raw, { qPos = QPOS, qYaw = QYAW, name = 'freighter-skirmish' } = {}) {
  const { fps, frames, ships, bullets } = raw;
  const p0 = ships[0]; // player slot — mean of its path is the fixed anchor offset
  let mx = 0, mz = 0;
  for (let kf = 0; kf < frames; kf++) { mx += p0.x[kf]; mz += p0.z[kf]; }
  mx /= (frames || 1); mz /= (frames || 1);    // ONE constant offset for the whole track
  for (const sh of ships) for (let kf = 0; kf < frames; kf++) { sh.x[kf] -= mx; sh.z[kf] -= mz; }
  for (let i = 0; i < bullets.x.length; i++) { bullets.x[i] -= mx; bullets.z[i] -= mz; }
  const qp = (v) => Math.round(v * qPos), qy = (v) => Math.round(v * qYaw);
  return {
    version: 1, name, seed: raw.seed ?? 0, fps, frames, qPos, qYaw,
    ships: ships.map((sh) => ({ shipName: sh.shipName, scale: sh.scale ?? 1, birth: sh.birth || 0, death: sh.death,
      x: sh.x.map(qp), z: sh.z.map(qp), yaw: sh.yaw.map(qy) })),
    bullets: { counts: bullets.counts.slice(), x: bullets.x.map(qp), z: bullets.z.map(qp) },
  };
}
