// Star-system geometry + navigation — PURE (THREE-free, node-testable; see system-map.test.js). The
// world is a flat XZ plane: planet 2 (our base planet) is pinned to the world origin, and the star and
// the other three planets sit at fixed session positions derived from wall-clock orbital angles. So the
// base neighbourhood, the mission set-pieces and the missions.js centers all stay origin-relative — no
// combat/mission rewrite. "To-scale" means the TRAVEL distances (orbit radii).
//
// HOW THE BODIES ARE RENDERED (DECISIONS §98). They are REAL 3D spheres at FIXED positions in a "sky
// space" — a copy of the system compressed by `parallax` around the player. Each body's sky direction is
// its TRUE bearing from the origin, resolved ONCE per session (bodySkyDir); its distance/size are
// art-directed (`dist`/`size`) because the true 45 000-unit distances are far outside the camera's far
// plane. world.js then draws them at those fixed local positions inside a group whose origin is
// `camera − skyParallax(player)`, which is exactly how a system compressed by `parallax` projects. So you
// get real perspective, real depth ordering and gentle differential parallax (near bodies slide faster
// than far ones), the bodies NEVER jump, and — because skyParallax saturates at `parallaxMax` — you can
// never fly up to one. An earlier pass re-projected every body by its bearing FROM THE PLAYER every
// frame: flying past a planet flipped that bearing ~180° and the planet visibly jumped. Rejected.
//
// EVERYTHING here is view-layer/navigation math consumed only by buildMap/settleView + the map UI — it
// draws ZERO sim RNG and never runs inside the deterministic tick, so recorded replays stay byte-identical
// (see the capLifted invariant, which is the guard the tests pin).

const DAY_MS = 24 * 60 * 60 * 1000;
export const EPOCH = 1723000000000; // fixed reference timestamp (ms) for orbital phase — deterministic

// `orbitR`/`periodDays`/`phase0` are the TRUE orbital geometry (travel distances on the plane, used by the
// map screen, the anchors and each body's sky bearing). `dist`/`size` are the RENDER placement in sky space:
// the fixed distance from the camera and the sphere radius. Apparent angular size is size/dist — the star is
// ~1.2x a planet by design; the home planet is the big familiar backdrop the game had before this feature.
export const SYSTEM = {
  // Downward tilt of the sky layout: each body's local position is (dir.x, −elev, dir.z) normalized × dist.
  // The near-top-down camera (CAM_OFFSET (0,110,26)) looks almost straight down, so bodies must sit BELOW it
  // to land in frustum. Bigger = higher/more-centred on screen, smaller = toward the edges. Live-tuned in ?roam.
  elev: 1.5,
  // Sky-space compression: 1 unit of flight shifts the backdrop `parallax` units against the fixed bodies.
  // 0.02 → crossing 1000 units slides the backdrop 20 units, ~2.7° against the home planet: gentle, visible.
  parallax: 0.020,
  // Saturation bound for that shift (skyParallax). Guarantees a body is NEVER reached however far you fly,
  // and keeps every body inside the camera's 900-unit far plane (max dist 700 + 90 < 900).
  parallaxMax: 90,
  belt: { inner: 16000, outer: 24000 }, // asteroid belt just outside planet 2's orbit (map UI only)
  star: { name: 'star', color: 0xffd9a0, size: 54, dist: 700 },
  planets: [
    { name: 'planet1', orbitR: 9000,  periodDays: 1.0, phase0: 0.40, color: 0xb08050, size: 36, dist: 560 },
    // Base planet: pinned to the world origin, so it has no bearing of its own — `homeDir` art-directs where
    // it hangs in the sky (matching the old single-planet backdrop, down/left of the ship). Its moons orbit
    // it in sky space; `orbitR` there is a SKY-space radius, kept clear of the planet limb (see moonClearance).
    { name: 'planet2', orbitR: 15000, periodDays: 1.5, phase0: 1.90, color: 0x5a82c0, size: 58, dist: 430,
      ocean: true, homeDir: { x: -0.81, z: -0.59 },
      moons: [
        { name: 'moon1', size: 9, orbitR: 104, periodS: 96,  phase0: 0.60, tilt: 0.28,  color: 0x9aa2ad },
        { name: 'moon2', size: 6, orbitR: 150, periodS: 171, phase0: 3.40, tilt: -0.18, color: 0x8b8f98 },
      ] },
    { name: 'planet3', orbitR: 22000, periodDays: 2.0, phase0: 3.30, color: 0x7fae86, size: 34, dist: 620 },
    { name: 'planet4', orbitR: 30000, periodDays: 2.5, phase0: 5.10, color: 0xc0b0a0, size: 30, dist: 680 },
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

// ---------- Sky placement (fixed, resolved once per session) ----------

// The unit XZ direction a body hangs in, as seen from the ORIGIN (== the base neighbourhood the player
// roams). Resolved ONCE at build time and then never recomputed — that is what keeps a body from jumping;
// the player's own motion is expressed by skyParallax instead. Planet 2 sits AT the origin, so it has no
// bearing: it uses its art-directed `homeDir`.
export function bodySkyDir(name, tNow = Date.now()) {
  const p = name === 'star' ? null : planetByName(name);
  if (p && p.homeDir) {
    const l = Math.hypot(p.homeDir.x, p.homeDir.z) || 1;
    return { x: p.homeDir.x / l, z: p.homeDir.z / l };
  }
  const w = bodyWorldPos(name, tNow);
  const l = Math.hypot(w.x, w.z);
  if (l < 1e-6) return { x: 0, z: -1 }; // degenerate → the top-of-screen direction
  return { x: w.x / l, z: w.z / l };
}

// How far the whole (fixed) sky layout slides against the player at planar position (px,pz). Linear in the
// player's distance from the origin for small distances — `k` units of shift per unit flown, i.e. real
// parallax for a system compressed by `k` — then SATURATES smoothly at `max`. The saturation is what makes
// the bodies permanently distant: no matter how far you fly the backdrop only ever slides `max` units, so
// you never close on a body, and every body stays inside the camera's far plane. Pure, monotone, C¹.
export function skyParallax(px, pz, k = SYSTEM.parallax, max = SYSTEM.parallaxMax) {
  const d = Math.hypot(px, pz);
  if (d < 1e-9 || max <= 0 || k <= 0) return { x: 0, z: 0 };
  const len = max * Math.tanh((d * k) / max);
  return { x: (px / d) * len, z: (pz / d) * len };
}

// A moon's orbital angle around its planet at wall-clock tNow (view-only, seconds-scale period). Pure.
export function moonAngle(moon, tNow = Date.now()) {
  return moon.phase0 + 2 * Math.PI * (tNow / 1000) / moon.periodS;
}

// Gap (sky-space units) between a moon's orbit and the planet's surface — how much clear space the moon
// keeps at its CLOSEST approach on screen. Must stay > 0 or the moon would clip into / overlap the planet
// disk (the bug this replaces). Pinned by a test for every moon of every planet.
export function moonClearance(planet, moon) {
  return moon.orbitR - planet.size - moon.size;
}

// Merge a map descriptor's `system` block into SYSTEM (by body name) so there is ONE live source of truth
// for both the render (world.js) and the map screen / ?roam tunables — previously the renderer read the
// descriptor while the map UI read this constant, and the two could silently disagree. Unknown bodies are
// ignored; absent keys keep their defaults. Returns SYSTEM.
export function applySystemSpec(spec) {
  if (!spec) return SYSTEM;
  for (const key of ['elev', 'parallax', 'parallaxMax']) {
    if (typeof spec[key] === 'number') SYSTEM[key] = spec[key];
  }
  if (spec.belt) Object.assign(SYSTEM.belt, spec.belt);
  if (spec.star) Object.assign(SYSTEM.star, spec.star);
  for (const p of spec.planets || []) {
    const target = planetByName(p.name);
    if (target) Object.assign(target, p);
  }
  return SYSTEM;
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

// How far out a planet's ANCHOR sits — the reachable transfer point on the plane you actually fly to when
// you pick that planet on the map. The planet itself is a permanently distant backdrop and is never a flight
// destination; the anchor is its approach corridor, out along its true bearing. Sized so the trip reads as a
// real crossing (~4x the science/mining anchors) while staying well inside Float32-safe coordinates.
export const PLANET_ANCHOR_DIST = 4200;

// The reachable point that stands in for a planet as a destination. Planet 2 is the base planet — you are
// already inside its orbit — so its anchor IS the base anchor. Pure.
export function planetAnchor(name, tNow = Date.now()) {
  const p = planetByName(name);
  if (!p) return { x: 0, z: 0 };
  if (p.homeDir) return { x: ANCHORS.base.x, z: ANCHORS.base.z };
  const d = bodySkyDir(name, tNow);
  return { x: d.x * PLANET_ANCHOR_DIST, z: d.z * PLANET_ANCHOR_DIST };
}

// Map-screen destinations (markers). `missionId` is the offer id the base board would launch, or null.
// `kind: 'planet'` entries are the per-planet anchors above (planet 2 omitted — its anchor is the base).
export function listDestinations(tNow = Date.now()) {
  const out = [
    { id: 'base',          kind: 'base',    missionId: null,             pos: ANCHORS.base },
    { id: 'side-research', kind: 'mission', missionId: 'side-research',  pos: ANCHORS.science },
    { id: 'side-mining',   kind: 'mission', missionId: 'side-mining',    pos: ANCHORS.mining },
  ];
  for (const p of SYSTEM.planets) {
    if (p.homeDir) continue; // planet 2 == the base neighbourhood, already listed
    out.push({ id: p.name, kind: 'planet', missionId: null, pos: planetAnchor(p.name, tNow) });
  }
  return out;
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

// THE replay-protection invariant: the player speed cap is lifted ONLY in roam AND ONLY while an autopilot
// is actively cruising to a destination (autopilot travel is out-of-combat cruise — uncapped so you can
// cross the system fast; the kinematic brake still decelerates cleanly into the target). Manual roam flight
// stays capped. It MUST be false whenever `roam` is false, regardless of autopilot state — so every
// recorded/campaign session (roam === false, incl. the return-to-base dock autopilot) clamps exactly as
// today and all replays stay byte-identical.
export function capLifted({ roam, autopilot }) {
  return !!roam && !!autopilot;
}

// Autopilot arrival predicate: within `radius` (planar) of the destination point. Pure.
export function arrivedAtPoint(pos, playerPos, radius) {
  return Math.hypot(pos.x - playerPos.x, pos.z - playerPos.z) <= radius;
}
