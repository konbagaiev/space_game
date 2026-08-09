// Unit tests for the star-system geometry + navigation seam (system-map.js — deliberately THREE-free so it
// loads under `node --test`). The load-bearing one is the capLifted invariant: it MUST be false whenever
// roam is off, or a position-based speed cap would desync every recorded replay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EPOCH, SYSTEM, bodyAngle, bodyWorldPos, listBodies, maxBodyCoord,
  inActivityZone, capLifted, arrivedAtPoint, activityZoneCenters, ANCHORS,
} from './system-map.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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

test('capLifted is FALSE whenever roam is false — for EVERY inZone/autopilot combo (replay invariant)', () => {
  for (const inZone of [false, true]) {
    for (const autopilot of [false, true]) {
      assert.equal(capLifted({ roam: false, inZone, autopilot }), false,
        `roam:false must stay capped (inZone:${inZone}, autopilot:${autopilot}) — return-to-base dock stays capped`);
    }
  }
});

test('capLifted in roam: lifted outside a zone OR while an autopilot is traveling', () => {
  assert.equal(capLifted({ roam: true, inZone: false, autopilot: false }), true);  // open cruise
  assert.equal(capLifted({ roam: true, inZone: true,  autopilot: false }), false); // parked in a zone → capped
  assert.equal(capLifted({ roam: true, inZone: true,  autopilot: true }), true);   // autopilot travel through a zone → uncapped
  assert.equal(capLifted({ roam: true, inZone: false, autopilot: true }), true);   // autopilot in open space → uncapped
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
