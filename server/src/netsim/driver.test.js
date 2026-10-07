// The driver's per-room load measurement (`srv`, docs/plans/2026-10-06-1530-server-brawl.md S5), on a fake
// clock and a fake room — nothing here waits on the wall clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDriver, SRV_LOG_EVERY } from './driver.js';

function fakeRoom({ onStep = () => {} } = {}) {
  let tick = 0;
  return {
    world: { brawl: { n: 7 } },
    get tick() { return tick; },
    stepOnce() { onStep(); tick++; return tick; },
    dueForSnapshot() { return tick % 2 === 0; },
    takeSnapshot() { return { type: 'snap', tick }; },
  };
}

function rig({ onStep, bytes = 1000 } = {}) {
  const clock = { t: 0 };
  const snaps = [];
  const logs = [];
  const room = fakeRoom({ onStep: () => onStep?.(clock) });
  const driver = createDriver(room, {
    onSnapshot: (s) => { snaps.push(s); return bytes; },
    now: () => clock.t, hrNow: () => clock.t,
    healthFn: () => ({ latest: () => ({ cpuPct: 12.5, rssMB: 99 }), line: () => 'h' }),
    procStats: () => ({ rooms: 3, brawlRooms: 1, clients: 3 }),
    bufferedAmount: () => 4242,
    label: 9, log: { log: (l) => logs.push(l) },
  });
  return { clock, snaps, logs, driver, room };
}

test('srv rides on exactly one snapshot per second, with the window\'s ticks, snapshots, bytes and proc', () => {
  const { clock, snaps, driver } = rig();
  // A window closes on the first pump at least 1000 ms after it opened, i.e. every ~61 pumps.
  for (let i = 1; i <= 190; i++) { clock.t = i * (1000 / 60); driver.pump(); }   // ~3.2 s of pumps
  const withSrv = snaps.filter((s) => s.srv);
  assert.equal(withSrv.length, 3, 'exactly one per second');
  const at = withSrv.map((s) => s.tick);
  assert.ok(Math.abs(at[1] - at[0] - 60) <= 2 && Math.abs(at[2] - at[1] - 60) <= 2, `a second apart (ticks ${at})`);
  const srv = withSrv[0].srv;
  assert.ok(Math.abs(srv.ticks - 60) <= 1, `ticks ${srv.ticks}`);
  assert.ok(Math.abs(srv.snapPerSec - 30) <= 1, `snapPerSec ${srv.snapPerSec}`);
  assert.ok(Math.abs(srv.snapBytes.sum - 30000) <= 1000, `bytes ${srv.snapBytes.sum}`);
  assert.equal(srv.snapBytes.max, 1000);
  assert.equal(typeof srv.stepMs.p95, 'number');
  assert.equal(srv.bufMax, 4242);
  assert.equal(srv.behind, 0);
  assert.deepEqual(srv.proc, { cpuPct: 12.5, rssMB: 99, rooms: 3, brawlRooms: 1, clients: 3 });
  assert.ok(driver.lastSrv, 'exposed for the tests');
});

test('a slow step shows: fewer ticks and a non-zero behind in the next srv', () => {
  // Each step advances the shared fake clock by 40 ms — over twice a tick's budget.
  const { clock, snaps, driver } = rig({ onStep: (c) => { c.t += 40; } });
  for (let i = 0; i < 200 && snaps.filter((s) => s.srv).length < 2; i++) { clock.t += 1000 / 60; driver.pump(); }
  const srv = snaps.filter((s) => s.srv)[1].srv;
  assert.ok(srv.ticks < 60, `ticks ${srv.ticks}`);
  assert.ok(srv.behind > 0, `behind ${srv.behind}`);
  assert.ok(srv.stepMs.avg >= 39, `step avg ${srv.stepMs.avg}`);
});

test('the JSON log line is emitted once per 10 windows', () => {
  const { clock, logs, driver } = rig();
  const perWindow = 61;
  for (let i = 1; i <= perWindow * (SRV_LOG_EVERY * 2) + 5; i++) { clock.t = i * (1000 / 60); driver.pump(); }
  assert.equal(logs.length, 2, `two lines for ~20 windows (got ${logs.length})`);
  const line = JSON.parse(logs[0]);
  assert.equal(line.evt, 'netsim-room');
  assert.equal(line.room, 9);
  assert.equal(line.brawl, 7);
  assert.equal(typeof line.stepMs.p95, 'number');
  assert.equal(line.max10.snapBytes, 1000);
});

test('start() opens a fresh window, so an idle pause is not one long second', () => {
  let handleFn = null;
  const clock = { t: 0 };
  const snaps = [];
  const room = fakeRoom();
  const driver = createDriver(room, {
    onSnapshot: (s) => { snaps.push(s); return 10; }, now: () => clock.t, hrNow: () => clock.t,
    setIntervalFn: (fn) => { handleFn = fn; return 1; }, clearIntervalFn: () => {},
    healthFn: () => ({ latest: () => null, line: () => '' }), log: {},
  });
  driver.start();
  for (let i = 0; i < 30; i++) { clock.t += 1000 / 60; handleFn(); }
  driver.stop();
  clock.t += 60_000;   // a long pause
  driver.start();
  for (let i = 0; i < 70; i++) { clock.t += 1000 / 60; handleFn(); }
  const srv = snaps.filter((s) => s.srv).map((s) => s.srv);
  assert.equal(srv.length, 1);
  assert.ok(srv[0].ticks >= 59, `the first window after resume is a real second (${srv[0].ticks} ticks)`);
});
