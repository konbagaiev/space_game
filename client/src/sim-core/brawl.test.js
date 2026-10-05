// The bot brawl's simulation half: layout, arming, determinism, the "nothing escapes" guarantees, and the
// camera's pure rules. Against the real catalog, headless.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './world.js';
import { makeSentinelHull } from './ally.js';
import { ACE_PILOT } from './ace.js';
import { seedSim, simRandomDraws } from './sim-random.js';
import { SIM_DT } from './consts.js';
import {
  BRAWL_SEED, BRAWL_CENTER, BRAWL_CAM_LEASH, BRAWL_N_MAX,
  withBrawlRoom, spawnBrawl, brawlTick, brawlOver, brawlSimSec, brawlViewCentre, nextCameraMode,
} from './brawl.js';
import { buildCatalog } from '../../../server/src/sim-host.js';

const CAT = buildCatalog('level-1');

function brawlWorld(n) {
  const w = createWorld();
  w.catalog = CAT;
  w.player = makeSentinelHull(CAT, 999);
  w.player.alive = true;
  w.arenaCenter.set(BRAWL_CENTER.x, 0, BRAWL_CENTER.z);
  seedSim(BRAWL_SEED);
  spawnBrawl(w, n);
  return w;
}
const ships = (w) => [...w.allies, ...w.enemies];

test('LAYOUT: N v N, ace-tagged red worth nothing, distinct ordinals, blue west / red east, spectator parked, no draws', () => {
  seedSim(BRAWL_SEED);
  const w = createWorld(); w.catalog = CAT;
  w.player = makeSentinelHull(CAT, 999); w.player.alive = true;
  spawnBrawl(w, 20);
  assert.equal(w.allies.length, 20);
  assert.equal(w.enemies.length, 20);
  for (const e of w.enemies) {
    assert.equal(e.pilot, ACE_PILOT, 'red is an ace, so stepEnemyAI would never fly it');
    assert.equal(e.reward, 0); assert.equal(e.xp, 0);
  }
  const ords = ships(w).map((s) => s._aimOrdinal);
  assert.equal(new Set(ords).size, 40, 'every pilot has his own streams');
  assert.ok(!ords.includes(0), 'and none shares the wingman\'s ordinal 0');
  for (const a of w.allies) assert.ok(a.pos.x < BRAWL_CENTER.x, 'blue west of the station');
  for (const e of w.enemies) assert.ok(e.pos.x > BRAWL_CENTER.x, 'red east of it');
  const d = Math.hypot(w.player.pos.x - BRAWL_CENTER.x, w.player.pos.z - BRAWL_CENTER.z);
  assert.ok(d >= 4900, `the spectator is parked ${d.toFixed(0)} u away`);
  assert.equal(simRandomDraws(), 0, 'the layout draws nothing');
  const w2 = createWorld(); w2.catalog = CAT; w2.player = makeSentinelHull(CAT, 999);
  assert.equal(spawnBrawl(w2, 999).n, BRAWL_N_MAX, '999 clamps to 100');
  const w3 = createWorld(); w3.catalog = CAT; w3.player = makeSentinelHull(CAT, 999);
  assert.equal(spawnBrawl(w3, 0).n, 1, '0 clamps to 1');
  seedSim(null);
});

test('INERT until armed, and again once ended: no ticks, no movement, no draws', () => {
  const w = brawlWorld(3);
  const pos = () => ships(w).map((s) => `${s.pos.x},${s.pos.z}`).join('|');
  const p0 = pos();
  for (let i = 0; i < 120; i++) brawlTick(w, SIM_DT);
  assert.equal(w.brawl.ticks, 0);
  assert.equal(pos(), p0, 'nothing moved before arming');
  w.brawl.armed = true;
  for (let i = 0; i < 120; i++) brawlTick(w, SIM_DT);
  assert.equal(w.brawl.ticks, 120);
  assert.notEqual(pos(), p0, 'armed, it flies');
  w.brawl.ended = true;
  const p1 = pos();
  for (let i = 0; i < 120; i++) brawlTick(w, SIM_DT);
  assert.equal(w.brawl.ticks, 120, 'ended, it stops counting');
  assert.equal(pos(), p1, 'and stops moving');
  assert.equal(simRandomDraws(), 0);
  seedSim(null);
});

function run20(ticks) {
  const w = brawlWorld(20);
  w.brawl.armed = true;
  for (let i = 0; i < ticks && !brawlOver(w); i++) { brawlTick(w, SIM_DT); w.events.drain(() => {}); }
  const draws = simRandomDraws();
  seedSim(null);
  return { w, draws };
}

test('DETERMINISM: two fresh 20v20 brawls under BRAWL_SEED are identical for 60 sim-s, with 0 shared draws', () => {
  const a = run20(3600), b = run20(3600);
  assert.equal(a.w.brawl.ticks, b.w.brawl.ticks);
  assert.deepEqual(a.w.brawl.fingerprint, b.w.brawl.fingerprint);
  assert.equal(a.w.brawl.killsByBlue, b.w.brawl.killsByBlue);
  assert.equal(a.w.brawl.killsByRed, b.w.brawl.killsByRed);
  const at = (w) => ships(w).map((s) => [s._aimOrdinal, s.pos.x, s.pos.z, s.hp]);
  assert.deepEqual(at(a.w), at(b.w), 'every survivor in the same place with the same hull');
  assert.equal(a.draws, 0, 'zero shared draws');
  assert.equal(b.draws, 0);
  if (a.w.brawl.ticks === 3600) assert.equal(a.w.brawl.fingerprint.length, 6, 'one fingerprint row per 10 sim-s');
  assert.ok(a.w.brawl.killsByBlue + a.w.brawl.killsByRed > 0, 'and it really was a fight');
});

test('IT ENDS AND NOTHING ESCAPES: 1v1 runs to a wipe-out with no kills, credits, XP, drops or spectator damage', () => {
  const w = brawlWorld(1);
  const hp0 = w.player.hp, sh0 = w.player._shieldValue;
  w.brawl.armed = true;
  let allyDown = 0, kill = 0, ticks = 0;
  // Cap 200 sim-s, generous: a 1v1 can include a heal retreat (and a cornered last stand at the edge).
  while (!brawlOver(w) && ticks < 200 * 60) {
    brawlTick(w, SIM_DT); ticks++;
    w.events.drain((ev) => { if (ev.type === 'allyDown') allyDown++; if (ev.type === 'kill') kill++; });
  }
  assert.ok(brawlOver(w), `the 1v1 ended (at ${brawlSimSec(w).toFixed(1)} sim-s)`);
  const endTick = w.brawl.ticks;
  for (let i = 0; i < 30; i++) brawlTick(w, SIM_DT);
  assert.equal(w.brawl.ticks, endTick, 'the clock stops on the wipe-out tick, however late the host looks');
  assert.equal(w.kills, 0); assert.equal(w.earned, 0); assert.equal(w.earnedXp, 0);
  assert.equal(w.drops.length, 0); assert.equal(w.pendingLoot.length, 0);
  assert.equal(w.player.hp, hp0, 'the parked spectator was never hit');
  assert.equal(w.player._shieldValue, sh0);
  assert.equal(allyDown, w.brawl.killsByBlue + w.brawl.killsByRed, 'one allyDown per death');
  assert.ok(allyDown >= 1 && allyDown <= 2, `one death, or both on the same tick (${allyDown})`);
  assert.equal(kill, 0, 'and never a kill event');
  assert.equal(simRandomDraws(), 0);
  seedSim(null);
});

test('VIEW CENTRE: excludes retreating and warping ships, falls back, clamps to the leash', () => {
  const s = (x, z, o = {}) => ({ pos: { x, z }, alive: true, retreating: false, warping: false, ...o });
  const out = {};
  const w = { allies: [s(-20, -10), s(-10, -10, { retreating: true })], enemies: [s(0, -10), s(500, 500, { warping: true })] };
  brawlViewCentre(w, out);
  assert.deepEqual(out, { x: -10, z: -10 }, 'mean of the two fighting ships only');
  const allWarping = { allies: [s(-20, -10, { warping: true })], enemies: [s(0, -10, { warping: true })] };
  brawlViewCentre(allWarping, out);
  assert.deepEqual(out, { x: -10, z: -10 }, 'every ship warping → all living ships');
  brawlViewCentre({ allies: [], enemies: [] }, out);
  assert.deepEqual(out, { x: BRAWL_CENTER.x, z: BRAWL_CENTER.z }, 'no ships → the station');
  brawlViewCentre({ allies: [s(BRAWL_CENTER.x + 300, BRAWL_CENTER.z)], enemies: [] }, out);
  assert.ok(Math.abs(Math.hypot(out.x - BRAWL_CENTER.x, out.z - BRAWL_CENTER.z) - BRAWL_CAM_LEASH) < 1e-9,
    'a centroid 300 u out clamps to exactly the leash');
});

test('nextCameraMode: centre → bot → centre; a tap on nothing stays in centre', () => {
  const c = { kind: 'centre' };
  assert.deepEqual(nextCameraMode(c, null), c);
  const b = nextCameraMode(c, 7);
  assert.deepEqual(b, { kind: 'bot', id: 7 });
  assert.deepEqual(nextCameraMode(b, 9), c, 'any tap while following goes back');
  assert.deepEqual(nextCameraMode(b, null), c);
});

test('withBrawlRoom: non-mutating, pays nothing, no campaign promises, centred on the station, map kept', () => {
  const d = { name: 'level-1', map: 'home-system', xpReward: 100, briefing: { x: 1 }, lastKillDrop: { y: 1 },
              intro: {}, introTrace: 'x', phases: [{ name: 'wave-1' }] };
  const copy = JSON.parse(JSON.stringify(d));
  const r = withBrawlRoom(d);
  assert.deepEqual(d, copy, 'input untouched');
  assert.equal(r.xpReward, 0);
  assert.equal(r.briefing, undefined); assert.equal(r.lastKillDrop, undefined); assert.equal(r.intro, undefined);
  assert.deepEqual(r.center, { x: BRAWL_CENTER.x, z: BRAWL_CENTER.z });
  assert.equal(r.map, 'home-system');
  assert.deepEqual(r.phases, [{ name: 'brawl' }]);
});

// THE FIGHT STAYS OVER THE STATION (DECISIONS §157). Measured on the fighting centroid — the ships that
// are fighting (not retreating, or retreating but cornered) and not warping, i.e. what the centre camera
// follows before its 55 u clamp. Pilots engage within their own 150 u and, idle, gather over the station.
function centroidShare(ticks = 3600) {
  const w = brawlWorld(20);
  w.brawl.armed = true;
  let n = 0, in55 = 0, in150 = 0;
  for (let i = 0; i < ticks && !brawlOver(w); i++) {
    brawlTick(w, SIM_DT); w.events.drain(() => {});
    const f = ships(w).filter((s) => (!s.retreating || s.cornered) && !s.warping);
    if (!f.length) continue;
    const cx = f.reduce((a, s) => a + s.pos.x, 0) / f.length, cz = f.reduce((a, s) => a + s.pos.z, 0) / f.length;
    const d = Math.hypot(cx - BRAWL_CENTER.x, cz - BRAWL_CENTER.z);
    n++; if (d <= BRAWL_CAM_LEASH) in55++; if (d <= 150) in150++;
  }
  seedSim(null);
  return { in55: in55 / n, in150: in150 / n };
}

test('THE MELEE STAYS OVER THE STATION: the fighting centroid is inside the camera leash most of the time', () => {
  const r = centroidShare();
  assert.ok(r.in55 >= 0.7, `within the 55 u camera leash on ${(r.in55 * 100).toFixed(0)} % of ticks`);
  assert.ok(r.in150 >= 0.9, `within 150 u on ${(r.in150 * 100).toFixed(0)} % of ticks`);
});
