// Unit tests for the star-system geometry + navigation seam (system-map.js — deliberately THREE-free so it
// loads under `node --test`). The load-bearing one is the capLifted invariant: it MUST be false whenever
// roam is off, or a position-based speed cap would desync every recorded replay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EPOCH, SYSTEM, bodyAngle, bodyWorldPos, listBodies, maxBodyCoord,
  inActivityZone, capLifted, arrivedAtPoint, activityZoneCenters, ANCHORS,
  bodyRenderPos, bodyClearance, bodyFade, moonAngle, moonClearance, planetAnchor, listSystemObjects,
  objectForMission, objectForActiveMission, systemRadius, applySystemSpec, ZONE_RADIUS,
  orbitVec, starWorldPos, planetOriginOffset, worldToLocal, localToWorld,
} from './system-map.js';
// The seed's set-pieces are pure data (no DB import), so the anchor↔set-piece invariant is checkable here.
import { MAPS } from '../../server/src/catalog_seed.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BODY_NAMES = ['star', ...SYSTEM.planets.map((p) => p.name)];

test('bodyWorldPos is deterministic for a fixed tNow (Date.now-free)', () => {
  const t = EPOCH + 1234567;
  const a = bodyWorldPos('planet3', t);
  const b = bodyWorldPos('planet3', t);
  assert.deepEqual(a, b);
  assert.equal(Number.isFinite(a.x) && Number.isFinite(a.z), true);
});

test('planet 2 (the base planet) is pinned to the world origin at any time', () => {
  for (const t of [EPOCH, EPOCH + 5e8, EPOCH + 9e11]) {
    const p2 = bodyWorldPos('planet2', t);
    assert.ok(Math.hypot(p2.x, p2.z) < 1e-6, `planet2 at origin (got ${p2.x},${p2.z})`);
  }
});

test('bodyAngle advances by exactly 2π over one period', () => {
  const p = SYSTEM.planets[0];
  const a0 = bodyAngle(p.periodDays, p.phase0, EPOCH);
  const a1 = bodyAngle(p.periodDays, p.phase0, EPOCH + p.periodDays * DAY_MS);
  assert.ok(Math.abs((a1 - a0) - 2 * Math.PI) < 1e-9);
});

test('a body returns to the same position after one full period', () => {
  const t0 = EPOCH + 42;
  // planet3 period = 2 days; advancing planet3 by its period alone is not enough (the star also moves with
  // planet2), so advance by the LCM-ish full turn of both: 6 days = 6×planet1, 4×planet2, 3×planet3.
  const sixDays = 6 * DAY_MS;
  const a = bodyWorldPos('planet3', t0);
  const b = bodyWorldPos('planet3', t0 + sixDays);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1e-3, `same after 6 days (${a.x},${a.z} vs ${b.x},${b.z})`);
});

// ---------- Star-centered frame + the local⇄world transform (docs/plans/heliocentric-coordinate-frame.md) ----------

test('bodyWorldPos == worldToLocal(starWorldPos, planetOriginOffset) for every body — the LOCAL frame IS the star frame shifted by planet 2', () => {
  for (const t of [EPOCH, EPOCH + 7654321, EPOCH + 3e10]) {
    const off = planetOriginOffset(t);
    for (const name of BODY_NAMES) {
      const viaStar = worldToLocal(starWorldPos(name, t), off);
      const local = bodyWorldPos(name, t);
      assert.ok(Math.hypot(viaStar.x - local.x, viaStar.z - local.z) < 1e-6,
        `${name}@${t}: ${viaStar.x},${viaStar.z} vs ${local.x},${local.z}`);
    }
  }
});

test('worldToLocal / localToWorld are exact inverses about any origin', () => {
  const pt = { x: 6971, z: -13949 }, origin = { x: 6350.6, z: -13589.3 };
  const back = localToWorld(worldToLocal(pt, origin), origin);
  assert.equal(back.x, pt.x);
  assert.equal(back.z, pt.z);
});

test('the star is the origin of the star frame; planet 2 sits at planetOriginOffset', () => {
  const t = EPOCH + 123456;
  assert.deepEqual(starWorldPos('star', t), { x: 0, z: 0 });
  const p2 = starWorldPos('planet2', t), off = planetOriginOffset(t);
  assert.ok(Math.hypot(p2.x - off.x, p2.z - off.z) < 1e-9);
  // orbitVec is the planet's own star-frame position, so planet 2's is exactly the origin offset.
  assert.deepEqual(planetOriginOffset(t), orbitVec(SYSTEM.planets[1], t));
});

test('a SPACE-FIXED point stays put in the star frame while its LOCAL position drifts as the base orbits', () => {
  const world = { x: 0, z: 1000 };                 // the demo beacon: 1000 u south of the star
  const t0 = EPOCH, t1 = EPOCH + 60_000;           // one minute later
  const l0 = worldToLocal(world, planetOriginOffset(t0));
  const l1 = worldToLocal(world, planetOriginOffset(t1));
  const drift = Math.hypot(l1.x - l0.x, l1.z - l0.z);
  // ~0.51 u/s ⇒ ~31 u over a minute (base linear speed at orbitR 10500); assert it actually moves, on that order.
  assert.ok(drift > 15 && drift < 60, `one-minute local drift of a fixed point ≈ 31 u, got ${drift.toFixed(1)}`);
});

// THE replay invariant, precisely: the cap is never lifted for INPUT-DRIVEN flight. A replay reproduces the
// recorded INPUT stream, so anything the player steers by hand must clamp exactly as it did when recorded.
test('capLifted is FALSE for every manually-flown state — the replay invariant', () => {
  for (const roam of [false, true]) {
    assert.equal(capLifted({ roam, autopilot: false, docking: false }), false,
      `manual flight is capped (roam:${roam}) — this is the leg a replay reproduces`);
  }
});

test('capLifted stays FALSE for a mid-combat autopilot (the drop grab) — top speed is a balance parameter', () => {
  assert.equal(capLifted({ roam: false, autopilot: true, docking: false }), false);
});

test('capLifted in roam: lifted while an autopilot cruises to a destination', () => {
  assert.equal(capLifted({ roam: true, autopilot: false }), false); // manual roam flight → capped
  assert.equal(capLifted({ roam: true, autopilot: true }), true);   // autopilot travel → uncapped
});

// The dock leg is autopilot-driven and is NOT reproduced from a trace (the intro replayer freezes the trace
// index and zeroes input while it flies home), so it may run uncapped in BOTH states without desyncing.
test('capLifted: the return-to-base DOCK autopilot is uncapped, in or out of roam', () => {
  assert.equal(capLifted({ roam: false, autopilot: true, docking: true }), true,
    'end-of-mission "Return to base" flies home at full speed');
  assert.equal(capLifted({ roam: true, autopilot: true, docking: true }), true,
    'and so does clicking the station while roaming');
});

test('inActivityZone boundary behaviour (inclusive at the radius)', () => {
  const zones = [{ x: 100, z: 0 }];
  assert.equal(inActivityZone(100, 0, zones, 50), true);   // dead center
  assert.equal(inActivityZone(150, 0, zones, 50), true);   // exactly on the radius
  assert.equal(inActivityZone(151, 0, zones, 50), false);  // just outside
  assert.equal(inActivityZone(0, 0, [], 50), false);       // no zones
});

test('the base spawn point is inside the base activity zone', () => {
  // the player spawns at (0,0); the base zone is centered at ANCHORS.base within ZONE_RADIUS
  assert.equal(inActivityZone(0, 0, activityZoneCenters(), 360), true);
  assert.deepEqual(activityZoneCenters()[0], ANCHORS.base);
});

test('arrivedAtPoint predicate', () => {
  const dest = { x: 500, z: -200 };
  assert.equal(arrivedAtPoint(dest, { x: 500, z: -200 }, 45), true);
  assert.equal(arrivedAtPoint(dest, { x: 540, z: -200 }, 45), true);  // within radius
  assert.equal(arrivedAtPoint(dest, { x: 560, z: -200 }, 45), false); // outside radius
});

// ---------- Body placement: real world positions on the ecliptic, unreachable, arrive-by-flying ----------

// THE model guarantee, and the regression this replaces: the old backdrop re-projected each body by its
// bearing FROM THE PLAYER, so flying past one swung that bearing ~180° and the body visibly JUMPED. A body's
// render position is now an ABSOLUTE world position — bodyRenderPos does not even take a player position, so
// no amount of flying can move it.
test('bodyRenderPos is an absolute world position — it never depends on where the player is', () => {
  const t = EPOCH + 777;
  for (const name of BODY_NAMES) {
    const a = bodyRenderPos(name, t);
    const b = bodyRenderPos(name, t);
    assert.deepEqual(a, b, `${name} render position is stable for a fixed tNow`);
    // it is its own orbital (x,z) plus the shared framing offset, sunk below the ecliptic
    const w = bodyWorldPos(name, t);
    assert.ok(Math.abs(a.x - (w.x + SYSTEM.offset.x)) < 1e-9, `${name} sits at its true x + offset`);
    assert.ok(Math.abs(a.z - (w.z + SYSTEM.offset.z)) < 1e-9, `${name} sits at its true z + offset`);
    assert.ok(a.y < 0, `${name} is BELOW the plane the ship flies on (y ${a.y})`);
  }
});

test('every body is permanently out of reach — the ship flies at y=0, the body top is below it', () => {
  for (const name of BODY_NAMES) {
    assert.ok(bodyClearance(name) > 0,
      `${name} keeps clearance under the flight plane (depth − size = ${bodyClearance(name)})`);
  }
});

test('you must FLY to a body: only the home planet is drawn from the base', () => {
  const t = EPOCH + 5e7;
  // distance from the SHIP (at the origin — the base), which is what the fade is keyed off
  const distFromBase = (name) => { const p = bodyRenderPos(name, t); return Math.hypot(p.x, p.y, p.z); };
  assert.ok(bodyFade(distFromBase('planet2')) === 1,
    `the home planet is fully drawn at the base (${distFromBase('planet2').toFixed(0)}u)`);
  for (const name of ['star', 'planet1', 'planet3', 'planet4']) {
    assert.ok(bodyFade(distFromBase(name)) === 0,
      `${name} is not drawn at the base — you have to fly to it (${distFromBase(name).toFixed(0)}u)`);
  }
  // and each body is equally solid once you arrive at ITS anchor — the framing is shared
  for (const name of BODY_NAMES) {
    const a = planetAnchor(name, t), p = bodyRenderPos(name, t);
    assert.equal(bodyFade(Math.hypot(p.x - a.x, p.y, p.z - a.z)), 1, `${name} is fully drawn from its anchor`);
  }
});

test('bodyFade ramps a body in by distance from the ship instead of popping it', () => {
  const f = SYSTEM.fade;
  assert.equal(bodyFade(0, f), 1);
  assert.equal(bodyFade(f.full, f), 1);
  assert.equal(bodyFade(f.out, f), 0);
  assert.equal(bodyFade(f.out + 5000, f), 0);
  const mid = bodyFade((f.full + f.out) / 2, f);
  assert.ok(mid > 0.4 && mid < 0.6, `halfway through the ramp is ~0.5 (got ${mid})`);
  // a body must be fully faded out before the camera's far plane could clip it, at ANY zoom (the camera
  // trails up to |CAM_OFFSET| * ZOOM_MAX ≈ 396 u behind the ship). engine.js: far = 1300.
  assert.ok(f.out + 396 < 1300, `the ramp completes inside camera.far even at max zoom (${f.out} + 396 < 1300)`);
});

test('every moon orbits CLEAR of its planet — at every orbital angle', () => {
  let moons = 0;
  for (const p of SYSTEM.planets) {
    for (const m of p.moons || []) {
      moons++;
      assert.ok(moonClearance(p, m) > 0,
        `${p.name}/${m.name}: orbit ${m.orbitR} clears planet ${p.size} + moon ${m.size} (gap ${moonClearance(p, m)})`);
      // the orbit is a circle of radius orbitR in a tilted plane → the centre-to-centre distance is orbitR
      // at EVERY angle; sample the real angle function to prove the render path can't drift inside it.
      for (let i = 0; i < 16; i++) {
        const a = moonAngle(m, i * 1000 * m.periodS / 16);
        const r = m.orbitR;
        const d = Math.hypot(Math.cos(a) * r, Math.sin(a) * r * Math.sin(m.tilt), Math.sin(a) * r * Math.cos(m.tilt));
        assert.ok(d >= p.size + m.size, `${m.name} at angle ${a.toFixed(2)} stays off the planet disk (d ${d.toFixed(1)})`);
      }
    }
  }
  assert.ok(moons >= 1, 'the home planet has moons');
});

test('moonAngle advances by exactly 2π over one period', () => {
  const m = SYSTEM.planets.find((p) => p.moons)?.moons[0];
  const a0 = moonAngle(m, 0), a1 = moonAngle(m, m.periodS * 1000);
  assert.ok(Math.abs((a1 - a0) - 2 * Math.PI) < 1e-9);
});

// ---------- Planet anchors: what autopilot actually flies to ----------

test('a body anchor is the point ON THE PLANE directly at that body — a real to-scale trip', () => {
  const t = EPOCH + 5e7;
  for (const name of BODY_NAMES) {
    const a = planetAnchor(name, t);
    const w = bodyWorldPos(name, t);
    assert.ok(Math.abs(a.x - w.x) < 1e-9 && Math.abs(a.z - w.z) < 1e-9,
      `${name} anchor is its own (x,z) on the ecliptic`);
    // arriving frames the body exactly the way the home planet is framed at the base
    const rp = bodyRenderPos(name, t);
    assert.ok(Math.abs((rp.x - a.x) - SYSTEM.offset.x) < 1e-9, `${name} hangs at the shared framing offset`);
  }
  // planet 2's anchor IS the world origin — the base neighbourhood, no travel needed
  const home = planetAnchor('planet2', t);
  assert.ok(Math.hypot(home.x, home.z) < 1e-6, 'the home planet anchor is the origin (the base)');
});

test('reaching another body is a real crossing (thousands of units), not a hop', () => {
  const t = EPOCH + 5e7;
  for (const name of ['star', 'planet1', 'planet3', 'planet4']) {
    const a = planetAnchor(name, t);
    assert.ok(Math.hypot(a.x, a.z) > 3000,
      `${name} is a genuine trip from the base (${Math.hypot(a.x, a.z).toFixed(0)}u)`);
  }
});

// ---------- The navigation object model (what the map UI draws + lists + flies to) ----------

test('listSystemObjects carries every selectable place: star + 4 planets + base + science + 3 mining + factory + freighter', () => {
  const t = EPOCH + 5e7;
  const objs = listSystemObjects(t);
  const byKind = (k) => objs.filter((o) => o.kind === k);
  assert.equal(byKind('star').length, 1, 'the star is a first-class object, not just scenery');
  assert.equal(byKind('planet').length, SYSTEM.planets.length, 'every planet is listed, home included');
  assert.equal(byKind('base').length, 1);
  assert.equal(byKind('station').length, 1);
  assert.equal(byKind('mining').length, 3, 'all three belt outposts');
  assert.equal(byKind('factory').length, 1, 'the space factory');
  assert.equal(byKind('freighter').length, 1, 'the freighter in distress (side-freighter mission site)');
  assert.equal(objs.length, 12);
  const ids = objs.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique (they key selection + the map markers)');
});

test('every object is a valid, finite autopilot destination with a localizable name', () => {
  for (const o of listSystemObjects(EPOCH + 5e7)) {
    assert.ok(Number.isFinite(o.pos.x) && Number.isFinite(o.pos.z), `${o.id} has a finite destination point`);
    assert.equal(o.marker, o.pos, `${o.id} draws its marker exactly where autopilot flies (list == map)`);
    assert.ok(/^ui\.object\./.test(o.nameKey), `${o.id} is named by an i18n key, never a raw id`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(o.color), `${o.id} has a marker colour (got ${o.color})`);
  }
});

test('a celestial object flies to its ANCHOR — the body itself is never the destination', () => {
  const t = EPOCH + 5e7;
  for (const o of listSystemObjects(t)) {
    if (o.kind !== 'star' && o.kind !== 'planet') continue;
    const a = planetAnchor(o.id, t);
    assert.ok(Math.abs(o.pos.x - a.x) < 1e-9 && Math.abs(o.pos.z - a.z) < 1e-9,
      `${o.id} routes to its plane anchor`);
  }
});

// Every side mission the server offers MUST have a host object here, or the mission is unreachable: the
// board takes it, then roam finds no marker, no autopilot target and no zone (this is exactly how
// `side-freighter` was stranded when the flyable star system moved the other two sites and left it behind).
test('exactly the three mission sites carry a missionId, and each resolves back to its object', () => {
  const t = EPOCH + 5e7;
  const withMission = listSystemObjects(t).filter((o) => o.missionId);
  assert.deepEqual(withMission.map((o) => o.missionId).sort(), ['side-freighter', 'side-mining', 'side-research']);
  assert.equal(objectForMission('side-mining', t).id, 'mining');
  assert.equal(objectForMission('side-research', t).id, 'science');
  assert.equal(objectForMission('side-freighter', t).id, 'freighter');
  assert.equal(objectForMission(null, t), null);
  assert.equal(objectForMission('nope', t), null);
  // the two extra belt outposts + the factory are places you can fly to, with no mission attached
  for (const id of ['mining2', 'mining3', 'factory']) {
    assert.equal(listSystemObjects(t).find((o) => o.id === id).missionId, null);
  }
});

test('the space factory is the system\'s SHORT hop: past the base zone, well inside the belt run', () => {
  const f = ANCHORS.factory;
  const d = Math.hypot(f.x, f.z); // from the home planet, which is pinned to (0,0)
  assert.ok(d > ZONE_RADIUS, `the factory sits outside the base activity zone (${d.toFixed(0)}u > ${ZONE_RADIUS})`);
  assert.ok(d < Math.hypot(ANCHORS.mining.x, ANCHORS.mining.z),
    'and is a shorter trip than the belt outposts — it is the "two screens away" destination');
  assert.ok(f.x < 0 && f.z < 0, 'up-left of the home planet on the map (screen top-left = -x/-z)');
});

// The failure this catches is silent and only visible in play: move an ANCHOR (or the seed's `pos`) without
// the other and the map still lists the place, autopilot still flies there — and parks you in empty space,
// because the model is somewhere else. The four-way invariant (missions.js) pins the two MISSION sites;
// this pins the physical set-pieces, mission or not.
test('every navigation anchor with a physical set-piece matches the seed position exactly', () => {
  const home = MAPS.find((m) => m.name === 'home-system');
  assert.ok(home, 'the home-system map exists');
  // anchor id → [set-piece type, framing offset from the anchor]. The offset is 0 for everything you park
  // ON (the base dock, an asteroid field you fight inside); the space factory alone is pushed up-left so
  // arriving frames it beside the ship instead of swallowing the ship in its middle (see catalog_seed.js).
  const PHYSICAL = {
    base:      ['base-station',     0,   0],
    science:   ['research-station', 0,   0],
    mining:    ['asteroid-field',   0,   0],
    mining2:   ['asteroid-field',   0,   0],
    mining3:   ['asteroid-field',   0,   0],
    factory:   ['space-factory',  -70, -55],
    // the freighter renders +50 z AHEAD of its anchor so it sits in front of the forward-gliding spawn
    freighter: ['freighter',        0,  50],
  };
  for (const [id, [type, dx, dz]] of Object.entries(PHYSICAL)) {
    const a = ANCHORS[id];
    // a set-piece pos is [x, y, z] — y is the below-plane depth and is deliberately NOT an anchor concern
    const hit = home.descriptor.setpieces.filter((s) => s.type === type)
      .find((s) => s.pos[0] === a.x + dx && s.pos[2] === a.z + dz);
    assert.ok(hit, `ANCHORS.${id} (${a.x},${a.z}) has a '${type}' set-piece at (${a.x + dx},${a.z + dz})`);
    // whatever the framing offset, you must arrive AT the place — never in visibly empty space
    assert.ok(Math.hypot(dx, dz) < 120, `ANCHORS.${id}'s set-piece stays within arrival framing`);
  }
});

test('systemRadius covers every object, so the map fits them all at zoom 1', () => {
  const t = EPOCH + 5e7;
  const r = systemRadius(t);
  for (const o of listSystemObjects(t)) {
    assert.ok(Math.hypot(o.pos.x, o.pos.z) <= r + 1e-9, `${o.id} is inside the fitted radius`);
  }
  assert.ok(r >= SYSTEM.belt.outer, 'and the belt stays visible too');
});

test('applySystemSpec merges a descriptor block into SYSTEM by body name', () => {
  const before = { offX: SYSTEM.offset.x, size: SYSTEM.planets[0].size };
  applySystemSpec({ offset: { x: -222 }, planets: [{ name: 'planet1', size: 99 }, { name: 'nope', size: 1 }] });
  assert.equal(SYSTEM.offset.x, -222);
  assert.equal(SYSTEM.planets[0].size, 99);
  assert.equal(SYSTEM.planets.length, 4, 'an unknown body is ignored, never appended');
  applySystemSpec({ offset: { x: before.offX }, planets: [{ name: 'planet1', size: before.size }] }); // restore
  assert.equal(SYSTEM.offset.x, before.offX);
  assert.equal(SYSTEM.planets[0].size, before.size);
});

test('Float32 safety: every body stays well under the ~1e5 jitter threshold', () => {
  assert.ok(maxBodyCoord() <= 1e5, `maxBodyCoord ${maxBodyCoord()} <= 1e5`);
  // and the live positions across a range of times never blow past it either
  for (const t of [EPOCH, EPOCH + 3e8, EPOCH + 7e11]) {
    for (const b of listBodies(t)) {
      assert.ok(Math.abs(b.pos.x) <= 1e5 && Math.abs(b.pos.z) <= 1e5,
        `${b.name} |coord| under 1e5 (got ${b.pos.x},${b.pos.z})`);
    }
  }
});

// ---- objectForActiveMission: "where is the mission I am on?" (the map's dashed gold frame) ----
test('objectForActiveMission: an active SIDE mission is its own host object', () => {
  assert.equal(objectForActiveMission({ activeMissionId: 'side-research' }).id, 'science');
  assert.equal(objectForActiveMission({ activeMissionId: 'side-mining' }).id, 'mining');
  assert.equal(objectForActiveMission({ activeMissionId: 'side-nope' }), null); // unknown id marks nothing
});

test('objectForActiveMission: the campaign resolves through its fight CENTRE, not an id', () => {
  // the factory level fights at (-450,-435); the factory anchor (-350,-350) is ~131 u away — inside the
  // fly-in radius, so that is the object the mission is "at"
  assert.equal(objectForActiveMission({ center: { x: -450, z: -435 } }).id, 'factory');
  // the Level 4 centre IS the far belt outpost's anchor — 0 u away, so that outpost is marked
  assert.equal(objectForActiveMission({ center: { x: ANCHORS.mining3.x, z: ANCHORS.mining3.z } }).id, 'mining3');
  // a level with no centre fights at the ORIGIN — which is exactly the home planet's anchor, so the home
  // planet is the landmark that gets marked (the base station, 14 u away, is the runner-up)
  assert.equal(objectForActiveMission({ center: { x: 0, z: 0 } }).id, 'planet2');
  // a centre out in empty space belongs to nothing — better unmarked than wrongly marked
  assert.equal(objectForActiveMission({ center: { x: 4000, z: 4000 } }), null);
  // no level / no centre at all
  assert.equal(objectForActiveMission({}), null);
});

test('objectForActiveMission: the side mission wins over the campaign centre', () => {
  const o = objectForActiveMission({ activeMissionId: 'side-mining', center: { x: -450, z: -435 } });
  assert.equal(o.id, 'mining', 'you are on the side mission — that is the mission being marked');
});

test('objectForActiveMission: picks the NEAREST object when several are in range', () => {
  // pulled toward the base station, it wins over the home planet's anchor at the origin
  assert.equal(objectForActiveMission({ center: { x: -30, z: -30 } }).id, 'base');
});
