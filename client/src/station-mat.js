// `?stationmat=<rung>` — a MEASUREMENT FORK for the BASE STATION's shading, off by default.
//
// Why a fork and not a decision: the base station is the measured frame-rate cliff (ROADMAP), and the two
// obvious cheap-shading moves are BOTH risky on this specific asset, measured on the shipped glb:
//   • the hull is NOT closed — 147 of its 4 157 edges are boundary edges (3.5%) — so FrontSide can punch
//     visible holes rather than just halving the rasterized fragments;
//   • the normal map carries real relief — 22.8% of texels deviate meaningfully from flat, 17.3% strongly —
//     so dropping it visibly flattens roughly a fifth of the surface.
// And `scene.environment` (a RoomEnvironment PMREM) is live on High AND Balance, so a swap away from
// MeshStandardMaterial loses the IBL that currently does much of the lighting on a metalness-1 hull.
// None of that can be settled by argument: it is looked at, and measured on a phone. Hence a URL flag
// (like ?lights=N / ?beam / ?ally) rather than a ?tune slider — lil-gui is unusable on the device where the
// measurement happens, and a perf run wants a clean boot.
//
// The rungs are CUMULATIVE, so each one is a single visible delta:
//   standard (default)  today's material, untouched — a strict no-op
//   lean                side = FrontSide + normalMap = null (still MeshStandardMaterial, keeps the IBL)
//   phong               lean + MeshPhongMaterial (Blinn-Phong per light instead of GGX; NO IBL)
//   basic               MeshBasicMaterial — zero lighting maths, the measurement FLOOR. Note it has no
//                       emissive slot at all, so the station's lit windows go dark on this rung. Expected.
// View-layer only: no sim state, no randomness → replay-neutral by construction (DECISIONS §73).
export const STATION_MAT_RUNGS = ['standard', 'lean', 'phong', 'basic'];

// Pure + storage-free, so it is unit-testable without a DOM: the URL alone decides. `warn` is injectable
// for the test.
export function evalStationMat(search, warn) {
  const v = new URLSearchParams(search || '').get('stationmat');
  if (v == null) return 'standard';
  const s = String(v).toLowerCase();
  if (s === '0' || s === 'off' || s === 'false') return 'standard';
  if (STATION_MAT_RUNGS.includes(s)) return s;
  // A measurement flag that silently does nothing is exactly the bug this whole feature is fixing.
  (warn || ((m) => { try { console.warn(m); } catch { /* no console */ } }))(
    `?stationmat="${v}" is not a rung — expected ${STATION_MAT_RUNGS.join(' | ')}. Falling back to standard.`);
  return 'standard';
}

// Read at IMPORT time, like ?ally / ?lancer: the set-piece glb loads far later than module load, so there
// is no boot-ordering trap here.
const RUNG = evalStationMat(typeof location !== 'undefined' ? location.search : '');
export function stationMat() { return RUNG; }
