// Star-system geometry + navigation — PURE (THREE-free, node-testable; see system-map.test.js). The
// world is a flat XZ plane: planet 2 (our base planet) is pinned to the world origin, and the star and
// the other three planets sit at fixed session positions derived from wall-clock orbital angles. So the
// base neighbourhood, the mission set-pieces and the missions.js centers all stay origin-relative — no
// combat/mission rewrite. "To-scale" means the TRAVEL distances (orbit radii); the celestial bodies are
// rendered as constant-apparent-size sky backdrop (bearing-projected) by world.js.
//
// EVERYTHING here is view-layer/navigation math consumed only by buildMap/settleView + the map UI — it
// draws ZERO sim RNG and never runs inside the deterministic tick, so recorded replays stay byte-identical
// (see the capLifted invariant, which is the guard the tests pin).

const DAY_MS = 24 * 60 * 60 * 1000;
export const EPOCH = 1723000000000; // fixed reference timestamp (ms) for orbital phase — deterministic

// Orbit radii are TRAVEL distances on the plane (Stage-1 live-tune targets — see the plan's sizing math);
// body `size` is the geometry radius rendered at a fixed billboard distance → constant apparent size.
export const SYSTEM = {
  // Downward tilt (world −Y) that drops each backdrop body into the near-top-down camera's sky band at the
  // top of the screen (CAM_OFFSET (0,110,26) looks almost straight down; see updateSystemBodies). Bigger =
  // higher/more-centred on screen, smaller = toward the horizon/edges. Live-tuned in ?roam.
  elev: 1.5,
  skyDist: 340,  // fixed billboard distance from the camera (constant apparent size; < the stars' 400) — live-tuned
  belt: { inner: 16000, outer: 24000 }, // asteroid belt just outside planet 2's orbit (map UI only)
  star: { name: 'star', color: 0xffd9a0, size: 34, baseSize: 34 },
  planets: [
    { name: 'planet1', orbitR: 9000,  periodDays: 1.0, phase0: 0.40, color: 0xb08050, size: 24 },
    { name: 'planet2', orbitR: 15000, periodDays: 1.5, phase0: 1.90, color: 0x5a82c0, size: 30, ocean: true }, // base planet (origin)
    { name: 'planet3', orbitR: 22000, periodDays: 2.0, phase0: 3.30, color: 0x7fae86, size: 26 },
    { name: 'planet4', orbitR: 30000, periodDays: 2.5, phase0: 5.10, color: 0xc0b0a0, size: 24 },
  ],
};

// Provisional (= ARENA); re-cap the player within this radius of any activity center. Tunable in ?roam.
export const ZONE_RADIUS = 360;
// Autopilot "arrived at a point" radius (matches BASE_ARRIVE_RADIUS so a point/dock feel consistent).
export const ARRIVE_RADIUS = 45;

const BASE = SYSTEM.planets[1]; // planet 2 — the base planet, pinned to (0,0)

// The orbital angle of a body at wall-clock tNow (pure; Date.now-free — pass tNow explicitly).
export function bodyAngle(periodDays, phase0, tNow) {
  return phase0 + 2 * Math.PI * (tNow - EPOCH) / (periodDays * DAY_MS);
}

function planetByName(name) {
  return SYSTEM.planets.find((p) => p.name === name) || null;
}

// Planar world position {x,z} of a body at wall-clock tNow. The star sits at -orbitVec(planet2), and every
// other body at star + its own orbit vector — so planet 2 is ALWAYS (0,0) and the base stays at the origin.
export function bodyWorldPos(name, tNow) {
  const a2 = bodyAngle(BASE.periodDays, BASE.phase0, tNow);
  const sx = -Math.cos(a2) * BASE.orbitR, sz = -Math.sin(a2) * BASE.orbitR; // star world position
  if (name === 'star') return { x: sx, z: sz };
  const p = planetByName(name);
  if (!p) return { x: 0, z: 0 };
  const a = bodyAngle(p.periodDays, p.phase0, tNow);
  return { x: sx + Math.cos(a) * p.orbitR, z: sz + Math.sin(a) * p.orbitR };
}

// All backdrop bodies (star + planets) with their render params + live world position (for build/bearing).
export function listBodies(tNow = Date.now()) {
  const out = [{ ...SYSTEM.star, isStar: true, pos: bodyWorldPos('star', tNow) }];
  for (const p of SYSTEM.planets) out.push({ ...p, isStar: false, pos: bodyWorldPos(p.name, tNow) });
  return out;
}

// The largest |coordinate| any body reaches over a whole orbit — the Float32-safety bound the test asserts.
export function maxBodyCoord() {
  return SYSTEM.planets.reduce((m, p) => Math.max(m, BASE.orbitR + p.orbitR), BASE.orbitR);
}

// Fixed anchored world coords near the base planet. The FOUR-WAY INVARIANT (see the plan / missions.js):
// map marker pos == catalog_seed.js `home-system` set-piece pos == missions.js center == activity zone —
// all identical (x,z) per body. Changing one WITHOUT the others desyncs spawns / the zone / the map / the fight.
export const ANCHORS = {
  base:    { x: -60,  z: -60 }, // base station (return-to-base dock), near the origin
  science: { x: 928,  z: 0 },   // research/science station — star-ward, 2x its old distance from planet 2
  mining:  { x: -988, z: 0 },   // near mining base (asteroid field) — belt-ward (anti-star)
};

// Map-screen destinations (markers). `missionId` is the offer id the base board would launch, or null.
export function listDestinations() {
  return [
    { id: 'base',          kind: 'base',    missionId: null,             pos: ANCHORS.base },
    { id: 'side-research', kind: 'mission', missionId: 'side-research',  pos: ANCHORS.science },
    { id: 'side-mining',   kind: 'mission', missionId: 'side-mining',    pos: ANCHORS.mining },
  ];
}

// Activity-zone centers where the speed cap is re-applied (base + science + near-mining). The caller adds
// the active mission center (if any). Pure.
export function activityZoneCenters() {
  return [ANCHORS.base, ANCHORS.science, ANCHORS.mining];
}

// True if (px,pz) is within `radius` of any zone center. Pure.
export function inActivityZone(px, pz, zones, radius) {
  for (const z of zones) if (Math.hypot(px - z.x, pz - z.z) <= radius) return true;
  return false;
}

// THE replay-protection invariant: the player speed cap is lifted ONLY in roam — outside every activity
// zone OR while an autopilot is actively cruising to a destination (autopilot travel is out-of-combat
// cruise, so it must not be zone-capped; the kinematic brake still decelerates cleanly into the target).
// It MUST be false whenever `roam` is false, regardless of position OR autopilot state — so every
// recorded/campaign session (roam === false, incl. the return-to-base dock autopilot) clamps exactly as
// today and all replays stay byte-identical.
export function capLifted({ roam, inZone, autopilot }) {
  return !!roam && (!!autopilot || !inZone);
}

// Autopilot arrival predicate: within `radius` (planar) of the destination point. Pure.
export function arrivedAtPoint(pos, playerPos, radius) {
  return Math.hypot(pos.x - playerPos.x, pos.z - playerPos.z) <= radius;
}
