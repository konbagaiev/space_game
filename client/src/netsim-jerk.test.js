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
