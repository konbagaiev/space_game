import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelEnemyTotal, isLastKillDrop, simulateLevel, runCenter, stepMissionZone,
  MISSION_ZONE_RADIUS, MISSION_ZONE_COUNTDOWN } from './level-sim.js';
// The seed is pure data (no DB import), so the campaign level's own centre is checkable here.
import { LEVELS } from '../../server/src/catalog_seed.js';
// …and against the navigation anchors it must agree with (a centre that drifts off its landmark parks the
// player outside the fly-in zone — the whole failure this file guards).
import { ANCHORS } from './system-map.js';

test('isLastKillDrop fires only when kills exactly reaches a positive enemyTotal', () => {
  assert.equal(isLastKillDrop({ kills: 13, enemyTotal: 14 }), false);
  assert.equal(isLastKillDrop({ kills: 14, enemyTotal: 14 }), true);
  assert.equal(isLastKillDrop({ kills: 0, enemyTotal: 0 }), false); // no total known → never
});

// ---------- runCenter: where a run fights ----------
// The bug this seam exists to prevent: sim.js only ever read `G.activeMission.center`, which is null for the
// campaign — so a campaign level could carry a `center` in the seed and be silently ignored, fighting at the
// origin while every comment claimed otherwise.
test('runCenter: a side mission wins, then the campaign level, then the origin', () => {
  const mission = { center: { x: -988, z: 0 } };
  const level = { center: { x: -450, z: -435 } };
  assert.deepEqual(runCenter(mission, level), { x: -988, z: 0 }, 'an active side mission owns the centre');
  assert.deepEqual(runCenter(null, level), { x: -450, z: -435 }, 'else the campaign level names its own');
  assert.deepEqual(runCenter(null, { title: 'Level 1' }), { x: 0, z: 0 }, 'a level with no centre fights at the origin');
  assert.deepEqual(runCenter(null, null), { x: 0, z: 0 });
  assert.deepEqual(runCenter(undefined, undefined), { x: 0, z: 0 });
});

test('runCenter never yields NaN from a half-written descriptor', () => {
  // a NaN centre would propagate into arenaCenter/the player spawn and fling the whole run to nowhere
  for (const bad of [{ center: {} }, { center: { x: -450 } }, { center: { x: 'nope', z: null } }]) {
    const c = runCenter(null, bad);
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z), `${JSON.stringify(bad)} -> ${JSON.stringify(c)}`);
  }
});

test('exactly TWO campaign levels name a centre — the factory and the far belt outpost', () => {
  const withCenter = LEVELS.filter((l) => l.descriptor.center);
  assert.deepEqual(withCenter.map((l) => l.descriptor.title), ['Level 3', 'Level 4'],
    `only these two move off the origin (got ${withCenter.map((l) => l.descriptor.title).join(', ')})`);
  // and every other level still fights at the origin
  for (const l of LEVELS) if (!l.descriptor.center) assert.equal(l.descriptor.center, undefined, `${l.descriptor.title} stays at the origin`);
});

test('"Level 3" fights at the space factory: 30 u up-left of the station', () => {
  const lvl = LEVELS.find((l) => l.descriptor.title === 'Level 3').descriptor;
  // the campaign's own definition of which level that is: the one AFTER the level that drops the repair
  // drone, and the first to field a real boss rather than the mid-boss
  const droneLevel = LEVELS.find((l) => l.descriptor.lastKillDrop?.refId === 12
    && l.descriptor.lastKillDrop?.kind === 'component');
  assert.equal(LEVELS.find((l) => l.descriptor === lvl).id, droneLevel.id + 1, 'it is the level right after the repair-drone drop');
  const bossShips = lvl.phases.flatMap((ph) => (ph.spawn?.pool || []).map((e) => e.ship)).filter((s) => /boss/.test(s));
  assert.ok(bossShips.includes('first pirate boss'), `and the one that fields the first real boss (got ${bossShips})`);
  // 30 u up-left of the space-factory set-piece — pinned so moving the station leaves the fight behind
  const factory = { x: -420, z: -405 }; // the `space-factory` set-piece in catalog_seed.js
  assert.deepEqual(lvl.center, { x: factory.x - 30, z: factory.z - 30 }, '30 u up-left of the station');
});

test('"Level 4" fights INSIDE the far belt outpost — centre exactly on the mining3 anchor', () => {
  const lvl = LEVELS.find((l) => l.descriptor.title === 'Level 4').descriptor;
  // Zero offset is the point: an asteroid field is scattered decor 100 u below the plane, so there is no
  // "swallowed by the model" problem to frame around — and autopilot parking dead on the centre means the
  // fly-in countdown can never fail to arm. A drift here is invisible until you fly out and nothing happens.
  assert.deepEqual(lvl.center, { x: ANCHORS.mining3.x, z: ANCHORS.mining3.z },
    'the fight centre IS the outpost you fly to');
  const bossShips = lvl.phases.flatMap((ph) => (ph.spawn?.pool || []).map((e) => e.ship)).filter((s) => /boss/.test(s));
  assert.ok(bossShips.includes('second pirate boss'), `and it is the second-boss level (got ${bossShips})`);
});

// The invariant that actually keeps a relocated fight playable: fly to the level's landmark by autopilot and
// you must come to rest INSIDE the zone that starts the fight, or you park in silence and the level is
// unreachable. Checked for every level that names a centre, against its nearest navigation anchor.
test('every relocated level parks you inside its own fly-in zone', () => {
  for (const l of LEVELS.filter((x) => x.descriptor.center)) {
    const c = l.descriptor.center;
    let best = Infinity, at = '';
    for (const [id, a] of Object.entries(ANCHORS)) {
      const d = Math.hypot(a.x - c.x, a.z - c.z);
      if (d < best) { best = d; at = id; }
    }
    assert.ok(best < MISSION_ZONE_RADIUS,
      `${l.descriptor.title}: nearest anchor '${at}' is ${best.toFixed(0)}u from the centre — autopilot would park OUTSIDE the ${MISSION_ZONE_RADIUS}u fly-in zone`);
  }
});

// ---------- stepMissionZone: fly into the active mission's neighbourhood → countdown → fight ----------
const DT = 1 / 60;
// Fly a straight run of frames at a fixed distance and return every step's state.
function run(state, dists, dt = DT) {
  const out = [];
  for (const dist of dists) { state = stepMissionZone(state, { dist, dt }); out.push(state); }
  return out;
}

test('stepMissionZone: crossing in arms the countdown, and it fires exactly once at zero', () => {
  const inside = MISSION_ZONE_RADIUS - 50;
  const frames = Math.ceil(MISSION_ZONE_COUNTDOWN / DT) + 5;
  const steps = run({ t: null }, Array(frames).fill(inside));
  assert.equal(steps[0].t, MISSION_ZONE_COUNTDOWN, 'the first frame inside arms the full countdown');
  assert.equal(steps[0].fire, false, 'and does not fire immediately');
  const fired = steps.filter((s) => s.fire);
  assert.equal(fired.length, 1, `fires exactly once (got ${fired.length})`);
  const idx = steps.findIndex((s) => s.fire);
  assert.ok(Math.abs(idx * DT - MISSION_ZONE_COUNTDOWN) < 0.05,
    `fires after ~${MISSION_ZONE_COUNTDOWN}s (fired at ${(idx * DT).toFixed(2)}s)`);
  // and it stays quiet afterwards rather than re-firing every frame
  assert.equal(steps[steps.length - 1].fire, false);
});

test('stepMissionZone: leaving the zone cancels a count in progress, and re-entering restarts it', () => {
  let s = { t: null };
  s = run(s, Array(30).fill(MISSION_ZONE_RADIUS - 10)).pop(); // half a second inside
  assert.ok(s.t > 0 && s.t < MISSION_ZONE_COUNTDOWN, 'counting');
  s = stepMissionZone(s, { dist: MISSION_ZONE_RADIUS + 1, dt: DT });
  assert.equal(s.t, null, 'one frame outside disarms it — you can fly away from the fight');
  assert.equal(s.fire, false);
  s = stepMissionZone(s, { dist: 0, dt: DT });
  assert.equal(s.t, MISSION_ZONE_COUNTDOWN, 're-entering starts a fresh full countdown, not a resumed one');
});

test('stepMissionZone: the radius boundary is inclusive, and a NaN distance never arms it', () => {
  assert.equal(stepMissionZone({ t: null }, { dist: MISSION_ZONE_RADIUS, dt: DT }).t, MISSION_ZONE_COUNTDOWN);
  assert.equal(stepMissionZone({ t: null }, { dist: MISSION_ZONE_RADIUS + 0.001, dt: DT }).t, null);
  // a missing/!==finite centre would make dist NaN; comparisons with NaN are false, so it must disarm
  assert.equal(stepMissionZone({ t: 1 }, { dist: NaN, dt: DT }).t, null);
  assert.equal(stepMissionZone({ t: 1 }, { dist: NaN, dt: DT }).fire, false);
});

test('stepMissionZone: the zone reaches the map destination the player is parked at', () => {
  // autopilot parks at ANCHORS.factory (-350,-350); the Level 2 centre is (-450,-435). If the radius did
  // not cover that gap, arriving by autopilot would sit just outside and nothing would ever start.
  const parked = Math.hypot(-350 - -450, -350 - -435);
  assert.ok(parked < MISSION_ZONE_RADIUS,
    `parking at the factory (${parked.toFixed(0)}u from the centre) is inside the ${MISSION_ZONE_RADIUS}u zone`);
});

// Level-shaped phase scripts (mirror catalog_seed.js / missions.js; totals verified by the server test).
const L1 = [
  { spawn: { maxConcurrent: 3, total: 6 }, advanceWhen: { kills: 6 } },
  { spawn: { maxConcurrent: 3, total: 6 }, advanceWhen: { kills: 12 } },
  { spawn: { maxConcurrent: 4, total: 2 }, advanceWhen: { allCleared: true } },
  { event: 'win' },
];
const L2 = [
  { spawn: { maxConcurrent: 4, total: 5 }, advanceWhen: { kills: 5 } },
  { spawn: { maxConcurrent: 4, total: 7 }, advanceWhen: { kills: 12 } },
  { spawn: { maxConcurrent: 4, total: 4 }, advanceWhen: { allCleared: true } },
  { spawn: { maxConcurrent: 1, total: 1 }, advanceWhen: { allCleared: true } },
  { event: 'win' },
];
// NOTE: use the REAL maxConcurrent so every threshold phase is the mc < total shape (e.g. 4 < 8) — that's
// the deadlock-risk case the sim must clear (a phase must spawn more than one wave-worth without the gate
// or advance stalling). Keep these arrays mirrored with catalog_seed.js / missions.js.
const L3 = [
  { spawn: { maxConcurrent: 4, total: 8 }, advanceWhen: { kills: 8 } },
  { spawn: { maxConcurrent: 4, total: 8 }, advanceWhen: { kills: 16 } },
  { spawn: { maxConcurrent: 4, total: 4 }, advanceWhen: { allCleared: true } },
  { spawn: { maxConcurrent: 1, total: 1 }, advanceWhen: { allCleared: true } },
  { event: 'win' },
];
const L4 = [
  { spawn: { maxConcurrent: 5, total: 8 }, advanceWhen: { kills: 8 } },
  { spawn: { maxConcurrent: 5, total: 8 }, advanceWhen: { kills: 16 } },
  { spawn: { maxConcurrent: 5, total: 5 }, advanceWhen: { allCleared: true } },
  { spawn: { maxConcurrent: 1, total: 1 }, advanceWhen: { allCleared: true } },
  { event: 'win' },
];
const SIDE = [
  { spawn: { maxConcurrent: 4, total: 7 }, advanceWhen: { kills: 7 } },
  { spawn: { maxConcurrent: 4, total: 7 }, advanceWhen: { kills: 14 } },
  { spawn: { maxConcurrent: 4, total: 4 }, advanceWhen: { allCleared: true } },
  { spawn: { maxConcurrent: 4, total: 2 }, advanceWhen: { allCleared: true } },
  { event: 'win' },
];

for (const [name, phases, total] of [['L1', L1, 14], ['L2', L2, 17], ['L3', L3, 21], ['L4', L4, 22], ['SIDE', SIDE, 20]]) {
  test(`${name}: staggered runner reaches enemyTotal exactly and the drop fires on the last kill`, () => {
    assert.equal(levelEnemyTotal(phases), total, 'summed enemyTotal');
    const r = simulateLevel(phases);
    assert.equal(r.totalKills, total, 'destroyed counter reaches enemyTotal exactly');   // (a)
    assert.equal(r.dropKill, total, 'last-kill reward drop fires on the final kill');     // (b)
  });
}
