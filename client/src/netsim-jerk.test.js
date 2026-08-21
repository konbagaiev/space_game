// The jerk probe, without a browser. It is a measuring instrument, so what it must be is CORRECT about
// attribution: a break on a frame that applied a packet and a break between packets have different authors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJerkProbe, TURN_BREAK_DEG } from './netsim-jerk.js';

// The smallest thing the probe can watch: a World with one entity whose pose we write by hand, and the
// pieces of net state it reads to name and date the break.
function rig() {
  const e = { pos: { x: 0, y: 0.6, z: 0 }, heading: 0 };
  const world = { enemies: [e], rockets: [], bullets: [], drops: [] };
  const state = { idOf: new Map([[e, 7]]), kinds: new Map([[7, 'enemy']]),
                  samples: new Map([[7, []]]), jerk: null };
  return { e, world, state };
}
const snapAt = (tick, at) => ({ tick, at });

test('smooth motion produces nothing at all', () => {
  const { e, world, state } = rig();
  const probe = createJerkProbe();
  for (let i = 0; i < 120; i++) {
    e.pos.x += 0.2;                    // constant speed…
    e.heading += 0.004;                // …and a constant, gentle turn
    probe.frame(world, state, i * 16.7);
  }
  assert.equal(probe.events.length, 0, 'a straight, evenly-turning object is not a defect');
});

test('a break is caught, measured, and attributed to the frame that applied a packet', () => {
  const { e, world, state } = rig();
  const probe = createJerkProbe();
  state.samples.set(7, [{ at: 0, tick: 0 }, { at: 66, tick: 4 }]);
  for (let i = 0; i < 30; i++) { e.pos.x += 0.2; probe.frame(world, state, i * 16.7); }

  // A packet lands and the object lurches: half a snapshot of position, corrected in one frame.
  probe.snapshot(snapAt(8, 500), 500);
  e.pos.x += 0.6;
  probe.frame(world, state, 500);

  assert.equal(probe.events.length, 1, 'exactly one break');
  const ev = probe.events[0];
  assert.equal(ev.kind, 'enemy');
  assert.equal(ev.id, 7);
  assert.ok(ev.dStep > 0.35, `the size of the lurch is recorded (got ${ev.dStep})`);
  assert.equal(ev.onSnapshotFrame, true, 'and it is pinned to the packet that caused it');
  assert.equal(ev.sampleSpanMs, 66, 'with the delivery context: how far apart the two samples it is drawn from were');
  assert.equal(ev.sampleTickGap, 4);
  assert.equal(probe.report().byCause.onPacket, 1);
  assert.equal(probe.report().byCause.betweenPackets, 0);
});

test('a break with no packet behind it is reported as the client\'s own', () => {
  // This is the distinction the whole probe exists for. Linear interpolation cutting a corner on a curved
  // path breaks the motion BETWEEN packets — no amount of network work would fix it.
  const { e, world, state } = rig();
  const probe = createJerkProbe();
  probe.snapshot(snapAt(4, 0), 0);
  for (let i = 0; i < 20; i++) { e.pos.x += 0.2; e.heading += 0.002; probe.frame(world, state, i * 16.7); }
  e.heading += 0.05;                                     // the nose steps, mid-interval
  probe.frame(world, state, 20 * 16.7);

  assert.equal(probe.events.length, 1);
  assert.equal(probe.events[0].onSnapshotFrame, false);
  assert.ok(probe.events[0].dTurnDeg > TURN_BREAK_DEG, 'the nose step is measured in degrees per frame');
  assert.equal(probe.report().byCause.betweenPackets, 1);
});

test('the event list is bounded, and clear() resets the tally', () => {
  const { e, world, state } = rig();
  const probe = createJerkProbe({ maxEvents: 5 });
  for (let i = 0; i < 60; i++) { e.pos.x += (i % 2 ? 0.05 : 0.6); probe.frame(world, state, i * 16.7); }
  assert.equal(probe.events.length, 5, 'a long session cannot grow the buffer');
  assert.ok(probe.report().total > 5, 'though the tally counts every one of them');
  probe.clear();
  assert.equal(probe.events.length, 0);
  assert.equal(probe.report().total, 0);
});

test('a despawned entity is forgotten, not measured against its replacement', () => {
  const { e, world, state } = rig();
  const probe = createJerkProbe();
  for (let i = 0; i < 10; i++) { e.pos.x += 0.2; probe.frame(world, state, i * 16.7); }
  world.enemies.length = 0;
  probe.frame(world, state, 200);
  const other = { pos: { x: 999, y: 0.6, z: 999 }, heading: 0 };  // a new ship, far away
  world.enemies.push(other);
  state.idOf.set(other, 8); state.kinds.set(8, 'enemy'); state.samples.set(8, []);
  for (let i = 0; i < 5; i++) { other.pos.x += 0.2; probe.frame(world, state, 220 + i * 16.7); }
  assert.equal(probe.events.length, 0, 'the 999-unit gap between two different ships is not a jerk');
});

test('the dump carries the raw record, not just the summary', () => {
  // The summary is for reading; the raw lists are for diagnosing. An arrival timeline is the only thing
  // that can tell a clock estimator whether it would have survived, and a lifecycle mark is the only thing
  // that can explain a one-off "the whole world jumped".
  const { e, world, state } = rig();
  const probe = createJerkProbe();
  probe.snapshot({ tick: 4 }, 0);
  probe.snapshot({ tick: 8 }, 66);
  probe.snapshot({ tick: 12 }, 133);
  probe.mark('go-local', { why: 'socket closed' }, 140);
  probe.snapshot({ tick: 16 }, 1400);         // a long silence: the stall must be marked by itself
  for (let i = 0; i < 5; i++) { e.pos.x += 0.2; probe.frame(world, state, 1400 + i * 16.7); }

  const d = probe.dump({ reason: 'death', level: 'level-0' });
  assert.equal(d.kind, 'netjerk');
  assert.equal(d.reason, 'death');
  assert.equal(d.level, 'level-0');
  assert.equal(d.arrivals.length, 4, 'every packet is in the file, not only the ones that hurt');
  assert.deepEqual(d.arrivals[1], { tick: 8, at: 66, gap: 66, tickGap: 4 });
  assert.ok(d.marks.some((m) => m.label === 'go-local'), 'the lifecycle is in the file');
  assert.ok(d.marks.some((m) => m.label === 'delivery-stall' && m.data.gapMs > 1000),
    'a 1.3 s silence marks itself — this is what a "the whole world jumped" report looks like in the data');
  assert.equal(d.report.arrival.stalls, 1);
  assert.equal(d.report.arrival.p50 > 0, true);
});

test('a frame the TAB lost is recorded apart from the room\'s faults', () => {
  // "It lagged" is ambiguous: the renderer stalling and the room stalling look identical to a player, and
  // only one of them is netcode. Frame time is therefore its own column.
  const { e, world, state } = rig();
  const probe = createJerkProbe();
  let t = 0;
  for (let i = 0; i < 10; i++) { t += 16.7; e.pos.x += 0.2; probe.frame(world, state, t); }
  t += 250;                                   // the tab went away for a quarter of a second
  e.pos.x += 0.2; probe.frame(world, state, t);
  for (let i = 0; i < 5; i++) { t += 16.7; e.pos.x += 0.2; probe.frame(world, state, t); }

  const r = probe.report();
  assert.equal(r.frames.slow, 1, 'one frame the tab lost');
  assert.ok(r.frames.worstDtMs >= 250);
  assert.ok(r.frames.meanDtMs > 16 && r.frames.meanDtMs < 40);
});

test('uneven FRAMES are not reported as uneven motion', () => {
  // The flaw this closes cost a real capture its credibility: the probe measured per-frame displacement, so
  // an object moving perfectly correctly in time was flagged whenever the browser's frame pacing wobbled.
  // A bullet flies straight at a constant speed and cannot break at all; the first real session logged 3041
  // breaks on bullets.
  const { e, world, state } = rig();
  const probe = createJerkProbe();
  const V = 40;                       // units per second, dead constant
  let t = 0;
  const frames = [10, 16, 9, 21, 11, 8, 25, 12, 10, 17, 9, 14, 30, 10, 11];  // a browser, honestly
  for (const dt of frames) {
    t += dt;
    e.pos.x += V * (dt / 1000);
    probe.frame(world, state, t);
  }
  assert.equal(probe.events.length, 0,
    `constant speed through wobbling frames is not a defect (${probe.events.length} reported)`);

  // …and a REAL break is still caught through the same wobble: one frame where it covers nothing.
  t += 12;
  probe.frame(world, state, t);        // the object did not move at all this frame
  assert.equal(probe.events.length, 1, 'a genuine stall in the motion still registers');
});

test('a reconnect is not a six-minute stall', () => {
  // Room tick counters restart at 0 on every join. Without noticing that, a client that spent six minutes in
  // the menus and then reconnected recorded a `delivery-stall` of 509 seconds with a tickGap of -7470 — and
  // poisoned the arrival and frame statistics of the whole capture with it.
  const { world, state } = rig();
  const probe = createJerkProbe();
  probe.snapshot({ tick: 7468 }, 1000);
  probe.snapshot({ tick: 7470 }, 1033);
  probe.snapshot({ tick: 2 }, 510_000);          // a different room, six minutes later

  const stalls = probe.marks.filter((m) => m.label === 'delivery-stall');
  assert.equal(stalls.length, 0, 'the join is not a stall');
  const last = probe.arrivals[probe.arrivals.length - 1];
  assert.equal(last.tick, 2);
  assert.equal(last.gap, 0, 'and it starts a fresh timeline rather than measuring against the old one');
  assert.equal(last.tickGap, 0);
});
