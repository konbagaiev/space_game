// Unit tests for the star-system geometry + navigation seam (system-map.js — deliberately THREE-free so it
// loads under `node --test`). The load-bearing one is the capLifted invariant: it MUST be false whenever
// roam is off, or a position-based speed cap would desync every recorded replay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EPOCH, SYSTEM, bodyAngle, bodyWorldPos, listBodies, maxBodyCoord,
  inActivityZone, capLifted, arrivedAtPoint, activityZoneCenters, ANCHORS,
  bodySkyDir, skyParallax, moonAngle, moonClearance, planetAnchor, listDestinations,
  PLANET_ANCHOR_DIST, applySystemSpec,
} from './system-map.js';

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

test('capLifted is FALSE whenever roam is false — for EVERY autopilot state (replay invariant)', () => {
  for (const autopilot of [false, true]) {
    assert.equal(capLifted({ roam: false, autopilot }), false,
      `roam:false must stay capped (autopilot:${autopilot}) — combat + the return-to-base dock stay capped`);
  }
});

test('capLifted in roam: lifted ONLY while an autopilot is traveling; manual flight stays capped', () => {
  assert.equal(capLifted({ roam: true, autopilot: false }), false); // manual roam flight → capped
  assert.equal(capLifted({ roam: true, autopilot: true }), true);   // autopilot travel → uncapped
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

// ---------- Sky placement: fixed bodies + bounded, jump-free parallax ----------

test('bodySkyDir is a unit XZ direction for every body, and takes NO player position', () => {
  const t = EPOCH + 777;
  for (const name of BODY_NAMES) {
    const d = bodySkyDir(name, t);
    assert.ok(Math.abs(Math.hypot(d.x, d.z) - 1) < 1e-9, `${name} direction is unit (got ${d.x},${d.z})`);
  }
  // planet 2 sits AT the origin, so it has no bearing — it must fall back to its art-directed homeDir.
  const home = SYSTEM.planets.find((p) => p.homeDir);
  const hd = bodySkyDir(home.name, t);
  const l = Math.hypot(home.homeDir.x, home.homeDir.z);
  assert.ok(Math.abs(hd.x - home.homeDir.x / l) < 1e-9 && Math.abs(hd.z - home.homeDir.z / l) < 1e-9,
    'the home planet uses homeDir, not a degenerate bearing');
});

test('skyParallax is BOUNDED by parallaxMax — a body can never be reached however far you fly', () => {
  for (const d of [0, 1, 500, 4200, 30000, 1e6]) {
    for (const [x, z] of [[d, 0], [0, -d], [d * 0.6, d * 0.8]]) {
      const p = skyParallax(x, z);
      assert.ok(Math.hypot(p.x, p.z) <= SYSTEM.parallaxMax + 1e-9,
        `|parallax| at (${x},${z}) is ${Math.hypot(p.x, p.z)} <= ${SYSTEM.parallaxMax}`);
    }
  }
  assert.deepEqual(skyParallax(0, 0), { x: 0, z: 0 }); // at the origin the layout sits exactly as built
});

test('skyParallax is linear (≈ distance × parallax) close to the base', () => {
  for (const d of [10, 100, 400]) {
    const p = skyParallax(d, 0);
    const want = d * SYSTEM.parallax;
    assert.ok(Math.abs(p.x - want) / want < 0.02, `parallax at ${d}u ≈ ${want} (got ${p.x.toFixed(3)})`);
    assert.ok(Math.abs(p.z) < 1e-12, 'and stays on the axis it was flown along');
  }
});

// THE regression this model replaces: the old backdrop re-projected each body by its bearing FROM THE
// PLAYER, so flying past a body swung that bearing ~180° in one step and the body visibly JUMPED. The new
// layout is fixed and the only player-dependent term is skyParallax, which is Lipschitz-bounded by
// SYSTEM.parallax — flying a 5-unit step can never move the backdrop more than 5 × parallax units, at ANY
// position, including straight through the origin and far past every anchor.
test('skyParallax never jumps: a small flight step moves the backdrop by at most step × parallax', () => {
  const step = 5, zOff = 30;
  let prev = skyParallax(-8000, zOff), worst = 0;
  for (let x = -8000 + step; x <= 8000; x += step) {
    const cur = skyParallax(x, zOff);
    worst = Math.max(worst, Math.hypot(cur.x - prev.x, cur.z - prev.z));
    prev = cur;
  }
  assert.ok(worst <= step * SYSTEM.parallax * 1.001,
    `worst backdrop step ${worst.toFixed(4)} <= ${(step * SYSTEM.parallax).toFixed(4)} (no re-projection flip)`);
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

test('a planet anchor is a REACHABLE point on the plane along that planet\'s bearing', () => {
  const t = EPOCH + 5e7;
  for (const p of SYSTEM.planets) {
    const a = planetAnchor(p.name, t);
    if (p.homeDir) { // planet 2 == the base neighbourhood: you are already inside its orbit
      assert.deepEqual(a, { x: ANCHORS.base.x, z: ANCHORS.base.z });
      continue;
    }
    assert.ok(Math.abs(Math.hypot(a.x, a.z) - PLANET_ANCHOR_DIST) < 1e-6,
      `${p.name} anchor sits at PLANET_ANCHOR_DIST (got ${Math.hypot(a.x, a.z).toFixed(1)})`);
    const d = bodySkyDir(p.name, t);
    assert.ok(Math.abs(a.x - d.x * PLANET_ANCHOR_DIST) < 1e-6, `${p.name} anchor is along its bearing`);
    // and it must be far closer than the planet's own to-scale orbit — the planet stays a distant backdrop
    assert.ok(PLANET_ANCHOR_DIST < p.orbitR / 2, `${p.name} anchor is nowhere near the body itself`);
  }
});

test('listDestinations carries the base + both side missions + one anchor per non-home planet', () => {
  const t = EPOCH + 5e7;
  const dests = listDestinations(t);
  const byKind = (k) => dests.filter((d) => d.kind === k);
  assert.equal(byKind('base').length, 1);
  assert.equal(byKind('mission').length, 2);
  assert.equal(byKind('planet').length, SYSTEM.planets.filter((p) => !p.homeDir).length);
  for (const d of dests) {
    assert.ok(Number.isFinite(d.pos.x) && Number.isFinite(d.pos.z), `${d.id} has a finite destination point`);
  }
});

test('applySystemSpec merges a descriptor block into SYSTEM by body name', () => {
  const before = { elev: SYSTEM.elev, size: SYSTEM.planets[0].size };
  applySystemSpec({ elev: 2.25, planets: [{ name: 'planet1', size: 99 }, { name: 'nope', size: 1 }] });
  assert.equal(SYSTEM.elev, 2.25);
  assert.equal(SYSTEM.planets[0].size, 99);
  assert.equal(SYSTEM.planets.length, 4, 'an unknown body is ignored, never appended');
  applySystemSpec({ elev: before.elev, planets: [{ name: 'planet1', size: before.size }] }); // restore
  assert.equal(SYSTEM.elev, before.elev);
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
