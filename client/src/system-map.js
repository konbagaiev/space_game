// Star-system geometry + navigation — PURE (THREE-free, node-testable; see system-map.test.js). The
// world is a flat XZ plane: planet 2 (our base planet) is pinned to the world origin, and the star and
// the other three planets sit at fixed session positions derived from wall-clock orbital angles. So the
// base neighbourhood, the mission set-pieces and the missions.js centers all stay origin-relative — no
// combat/mission rewrite. "To-scale" means the TRAVEL distances (orbit radii).
//
// HOW THE BODIES ARE RENDERED (DECISIONS §98). The ship flies ON the ecliptic plane (y = 0) and the camera
// looks DOWN at it from above. Every body — the star and all four planets — is a REAL sphere sitting at its
// OWN TRUE (x,z) on that plane, sunk `depth` BELOW it and shifted by `offset` so it hangs down-and-left of
// the point you arrive at. That is exactly the placement the game's original single home planet used
// (pos [-150,-285,-110], radius 60) — now applied per body, across the whole system.
//
// The consequences are the whole point:
//   • Nothing is attached to the camera, so nothing re-projects and nothing can jump. You simply fly over a
//     fixed world and the perspective/parallax is whatever real 3D gives you.
//   • You DO have to travel. At the base you see planet 2 (and the station) and nothing else; planet 1, 3, 4
//     and the star are thousands of units away, past the camera's far plane, so they are not drawn at all
//     until you fly to them (`fade` ramps a body in near that plane instead of popping it).
//   • A body is PERMANENTLY out of reach even when you are right over it: the ship flies at y = 0 and the
//     body's top is `depth − size` below that. You can never touch, ram or loom into a planet.
//   • `planetAnchor(name)` — where autopilot actually flies — is the body's (x,z) ON the plane. Arrive there
//     and the planet reads exactly the way the home planet reads at the base.
// An earlier pass instead re-projected every body by its bearing FROM THE PLAYER onto a camera-anchored sky
// dome at constant apparent size: flying past a planet flipped that bearing ~180° and the planet visibly
// jumped, a moon's bearing could cross its planet's and slide into the disk, and constant size killed all
// parallax. Rejected — see §98.
//
// EVERYTHING here is view-layer/navigation math consumed only by buildMap/settleView + the map UI — it
// draws ZERO sim RNG and never runs inside the deterministic tick, so recorded replays stay byte-identical
// (see the capLifted invariant, which is the guard the tests pin).

const DAY_MS = 24 * 60 * 60 * 1000;
export const EPOCH = 1723000000000; // fixed reference timestamp (ms) for orbital phase — deterministic

// `orbitR`/`periodDays`/`phase0` are the TRUE orbital geometry — the travel distances you actually fly, and
// what the map screen and the anchors are built from. `size`/`depth` are the render placement: sphere radius
// and how far BELOW the ecliptic the body is sunk. Apparent size is size/depth, so the two move together —
// the star reads ~1.2x a planet by design.
export const SYSTEM = {
  // Where a body hangs relative to the point on the plane you arrive at. Copied from the original single
  // home planet ([-150, -285, -110]) so arriving at ANY body frames it the same familiar way: down and to
  // the left, below the plane. Live-tuned in ?roam.
  offset: { x: -150, z: -110 },
  // Opacity ramp by distance FROM THE SHIP (not from the camera — otherwise zooming out, which moves the
  // camera away, would fade the planet you are parked at). `full` is comfortably past the 340 u a body sits
  // from its own anchor, so a body stays solid across its whole neighbourhood; `out` completes the ramp
  // before the body could ever enter the frustum, so approaching one fades it in instead of popping it.
  fade: { full: 520, out: 760 },
  belt: { inner: 16000, outer: 24000 }, // asteroid belt just outside planet 2's orbit (map UI only)
  star: { name: 'star', color: 0xffd9a0, size: 74, depth: 300 },
  planets: [
    { name: 'planet1', orbitR: 9000,  periodDays: 1.0, phase0: 0.40, color: 0xb08050, size: 54, depth: 285 },
    // Base planet — pinned to the world origin, so its anchor IS the base neighbourhood and it is the one
    // body you see without travelling. Its moons orbit it in world space, clear of its limb (moonClearance).
    { name: 'planet2', orbitR: 15000, periodDays: 1.5, phase0: 1.90, color: 0x5a82c0, size: 60, depth: 285,
      ocean: true,
      moons: [
        { name: 'moon1', size: 10, orbitR: 112, periodS: 96,  phase0: 0.60, tilt: 0.28,  color: 0x9aa2ad },
        { name: 'moon2', size: 7,  orbitR: 158, periodS: 171, phase0: 3.40, tilt: -0.18, color: 0x8b8f98 },
      ] },
    { name: 'planet3', orbitR: 22000, periodDays: 2.0, phase0: 3.30, color: 0x7fae86, size: 58, depth: 285 },
    { name: 'planet4', orbitR: 30000, periodDays: 2.5, phase0: 5.10, color: 0xc0b0a0, size: 52, depth: 285 },
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

// ---------- Render placement (a real world position per body — nothing is camera-anchored) ----------

function bodySpec(name) {
  return name === 'star' ? SYSTEM.star : planetByName(name);
}

// Where a body's SPHERE actually sits in the world: its true (x,z) on the ecliptic, sunk `depth` below the
// plane the ship flies on, shifted by SYSTEM.offset so it frames down-and-left of the arrival point. This is
// an absolute world position — the renderer writes it once and it never depends on where the player is,
// which is precisely why a body can never jump.
export function bodyRenderPos(name, tNow = Date.now()) {
  const spec = bodySpec(name);
  const w = bodyWorldPos(name, tNow);
  return { x: w.x + SYSTEM.offset.x, y: -(spec ? spec.depth : 285), z: w.z + SYSTEM.offset.z };
}

// How far the ship (which flies at y = 0) clears a body's surface when it is directly over it. Positive by
// construction — a body is sunk `depth` and its top reaches `depth − size` below the plane — so a planet is
// permanently out of reach no matter how precisely you park on its anchor. Pinned by a test.
export function bodyClearance(name) {
  const spec = bodySpec(name);
  return spec ? spec.depth - spec.size : 0;
}

// Opacity for a body `dist` from the SHIP: 1 out to `fade.full`, then a linear ramp to 0 at `fade.out`, so a
// body you are flying toward FADES IN rather than popping into existence, and one you leave fades out.
export function bodyFade(dist, fade = SYSTEM.fade) {
  if (dist <= fade.full) return 1;
  if (dist >= fade.out) return 0;
  return (fade.out - dist) / (fade.out - fade.full);
}

// A moon's orbital angle around its planet at wall-clock tNow (view-only, seconds-scale period). Pure.
export function moonAngle(moon, tNow = Date.now()) {
  return moon.phase0 + 2 * Math.PI * (tNow / 1000) / moon.periodS;
}

// Gap (world units) between a moon's orbit and the planet's surface — how much clear space the moon keeps
// at its CLOSEST approach. Must stay > 0 or the moon would clip into / overlap the planet disk (the bug
// this replaces). Pinned by a test for every moon of every planet.
export function moonClearance(planet, moon) {
  return moon.orbitR - planet.size - moon.size;
}

// Merge a map descriptor's `system` block into SYSTEM (by body name) so there is ONE live source of truth
// for both the render (world.js) and the map screen / ?roam tunables — previously the renderer read the
// descriptor while the map UI read this constant, and the two could silently disagree. Unknown bodies are
// ignored; absent keys keep their defaults. Returns SYSTEM.
export function applySystemSpec(spec) {
  if (!spec) return SYSTEM;
  if (spec.offset) Object.assign(SYSTEM.offset, spec.offset);
  if (spec.fade) Object.assign(SYSTEM.fade, spec.fade);
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
  // Two further mining outposts, belt-ward like the first but spread around planet 2 so the map has real
  // destinations to pick between. They carry NO mission (only `mining` does) — they are places you can fly
  // to. Each has a matching `asteroid-field` set-piece in catalog_seed.js at the SAME (x,z), so arriving
  // finds rigs rather than empty space.
  mining2: { x: -1480, z: -1180 },
  mining3: { x: -760,  z: 1560 },
};

// The point ON THE PLANE that autopilot flies to for a body — its own true (x,z). Arrive there and the body
// hangs below you framed exactly the way the home planet is framed at the base (that is what SYSTEM.offset
// buys). The body itself is never the flight target: it is `depth` below the plane and unreachable. Pure.
export function planetAnchor(name, tNow = Date.now()) {
  const w = bodyWorldPos(name, tNow);
  return { x: w.x, z: w.z };
}

// EVERY selectable thing in the system, in map/list order — the single source the navigation UI draws
// markers from, fills its object list from, and hands to autopilot. Celestial bodies are first-class
// objects here: a star or planet is listed and selectable exactly like a station, and `pos` is always the
// REACHABLE point on the plane (a body's own anchor — the body itself stays permanently distant, §98).
//
//   kind    'star' | 'planet' | 'base' | 'station' | 'mining'
//   pos     where autopilot flies (world x,z on the ecliptic)
//   marker  where the map draws it — the same point for every object, so list and map agree
//   missionId  the side-mission offer this object hosts, or null (drives the locked/greyed state + the
//              "Start mission?" arrival prompt; only ONE science + ONE mining site carry a mission)
//   nameKey    i18n key for the display name — never a raw id
export function listSystemObjects(tNow = Date.now()) {
  const out = [
    { id: 'star', kind: 'star', nameKey: 'ui.object.star', missionId: null,
      pos: planetAnchor('star', tNow), color: '#ffd9a0' },
  ];
  for (const p of SYSTEM.planets) {
    out.push({ id: p.name, kind: 'planet', nameKey: `ui.object.${p.name}`, missionId: null,
      pos: planetAnchor(p.name, tNow), color: `#${p.color.toString(16).padStart(6, '0')}` });
  }
  out.push(
    { id: 'base',    kind: 'base',    nameKey: 'ui.object.base',    missionId: null,
      pos: ANCHORS.base,    color: '#6fd0ff' },
    { id: 'science', kind: 'station', nameKey: 'ui.object.science', missionId: 'side-research',
      pos: ANCHORS.science, color: '#7fff9a' },
    { id: 'mining',  kind: 'mining',  nameKey: 'ui.object.mining',  missionId: 'side-mining',
      pos: ANCHORS.mining,  color: '#e8c07a' },
    { id: 'mining2', kind: 'mining',  nameKey: 'ui.object.mining2', missionId: null,
      pos: ANCHORS.mining2, color: '#e8c07a' },
    { id: 'mining3', kind: 'mining',  nameKey: 'ui.object.mining3', missionId: null,
      pos: ANCHORS.mining3, color: '#e8c07a' },
  );
  for (const o of out) o.marker = o.pos;
  return out;
}

// The object hosting a given side-mission offer id (so the mission board can autopilot to "its" place), or
// null. Pure.
export function objectForMission(missionId, tNow = Date.now()) {
  if (!missionId) return null;
  return listSystemObjects(tNow).find((o) => o.missionId === missionId) || null;
}

// How far out the outermost object sits — the radius the map fits at zoom 1 (map-view.js `worldRadius`).
export function systemRadius(tNow = Date.now()) {
  let r = SYSTEM.belt.outer;
  for (const o of listSystemObjects(tNow)) r = Math.max(r, Math.hypot(o.pos.x, o.pos.z));
  return r;
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
