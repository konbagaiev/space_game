// Snapshot → World, without a browser.
//
// The interesting test is the last one: it runs an actual server room, feeds its actual snapshots into an
// actual client World, and checks the client ends up drawing what the room is simulating. That is the whole
// netsim contract, and it is testable in-process precisely because `netsim-world.js` is THREE-free and the
// room is clock-free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, noopHost } from './sim-core/world.js';
import { createNetState, applySnapshot, renderNet, clearNet, INTERP_DELAY_MS, MAX_EXTRAPOLATION_MS } from './netsim-world.js';
import { createRoom } from '../../server/src/netsim/room.js';
import { buildCatalog } from '../../server/src/sim-host.js';

// A client World with no renderer: the catalog it would have fetched at boot, a host that only counts.
function clientWorld() {
  const attached = [];
  const world = createWorld({
    host: {
      onSpawn: (kind, e) => attached.push({ kind, e }),
      onDespawn: (kind, e) => { const i = attached.findIndex((a) => a.e === e); if (i >= 0) attached.splice(i, 1); },
      onWarmLevel() {},
    },
  });
  world.catalog = buildCatalog('level-0');
  world.player = { pos: { x: 0, y: 0.6, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
                   vel: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
                   heading: 0, scale: 1, hp: 100, maxHp: 100, _shieldValue: 0, alive: true };
  return { world, attached };
}

const snapOf = (over = {}) => ({
  type: 'snap', tick: 1, ack: null, dropped: 0, spawns: [],
  player: { x: 0, y: 0.6, z: 0, h: 0, sc: 1, hp: 100, maxHp: 100, sh: 0, alive: true, thrust: false, oob: 0, vx: 0, vz: 0 },
  enemies: [], bullets: [], rockets: [], drops: [],
  arena: { x: 0, z: 0 },
  run: { kills: 0, enemyTotal: 4, earned: 0, earnedXp: 0, won: false, returning: false, phase: 0, stationActive: false },
  events: [],
  ...over,
});

test('a described entity is spawned through the host, the same path a local spawn takes', () => {
  const { world, attached } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({
    spawns: [{ id: 7, kind: 'enemy', name: 'Basic pirate ship', maxHp: 20, fullScale: 1.8, sizeScale: 1 }],
    enemies: [[7, 10, 20, 1.5, 20, 1.8, 0]],
  }));
  assert.equal(world.enemies.length, 1);
  assert.equal(attached.length, 1, 'the host was asked for a body');
  assert.equal(attached[0].kind, 'enemy');
  // Built from the CATALOG by name, so it carries everything a local enemy carries.
  assert.ok(world.enemies[0].modelUrl, 'resolved its model from the catalog, not from the wire');
  assert.ok(world.enemies[0].engine, 'and its engine, so the exhaust plume works');
});

test('a crate is born where the room has it, not at the world origin', () => {
  // The bug: a drop's spawn description carried no position, so the ghost started at (0,0,0) — and since a
  // crate only moves while being pulled, the client drew it there. Clicking one flew the ship to its REAL
  // position "somewhere else", and the level-1 reward looked like it never dropped.
  const { world } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({
    spawns: [{ id: 4, kind: 'drop', item: { kind: 'weapon', refId: 5 }, special: true, x: -120.5, z: 33.25 }],
    drops: [[4, -120.5, 33.25]],
  }));
  assert.equal(world.drops.length, 1);
  assert.equal(world.drops[0].pos.x, -120.5);
  assert.equal(world.drops[0].pos.z, 33.25);
  assert.equal(world.drops[0].special, true, 'and it knows it is the reward crate, so it gets the green body');
});

test('the room tells the client which crate the Grab is pulling', () => {
  // The client never runs stepDrops, so without this the blue pull beam had no target and never drew.
  const { world } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({
    spawns: [{ id: 4, kind: 'drop', item: { kind: 'weapon', refId: 5 }, x: 1, z: 2 }],
    drops: [[4, 1, 2]], grab: 4,
  }));
  assert.equal(st.grabTarget, world.drops[0]);
  applySnapshot(world, st, snapOf({ tick: 2, drops: [[4, 1, 2]], grab: null }));
  assert.equal(st.grabTarget, null, 'and when nothing is being pulled, the beam has no target');
});

test('an unknown ship name draws nothing rather than crashing the frame', () => {
  const { world } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({ spawns: [{ id: 1, kind: 'enemy', name: 'Nonexistent cruiser' }] }));
  assert.equal(world.enemies.length, 0);
});

test('absence from a snapshot is the despawn', () => {
  const { world, attached } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({
    spawns: [{ id: 7, kind: 'bullet', color: 1, fromPlayer: true }],
    bullets: [[7, 1, 2]],
  }));
  assert.equal(world.bullets.length, 1);
  applySnapshot(world, st, snapOf({ tick: 2, bullets: [] }));
  assert.equal(world.bullets.length, 0, 'the bullet left the world');
  assert.equal(attached.length, 0, 'and its body was released — no leaked mesh');
});

test('an out-of-order snapshot is dropped whole', () => {
  const { world } = clientWorld();
  const st = createNetState();
  assert.equal(applySnapshot(world, st, snapOf({ tick: 10, run: { ...snapOf().run, kills: 3 } })), true);
  assert.equal(applySnapshot(world, st, snapOf({ tick: 9, run: { ...snapOf().run, kills: 1 } })), false);
  assert.equal(world.kills, 3, 'the older snapshot did not roll the run backwards');
});

test('the ship and its bullets share one clock, so the muzzle lines up', () => {
  // The regression this guards: bullets were dead-reckoned into the present while the ship was still drawn
  // 100 ms in the past, so a ship drifting sideways trailed its own muzzle — shots appeared to leave from
  // its flank. Both are extrapolated from the same moment now.
  const { world } = clientWorld();
  const st = createNetState();
  const p = { ...snapOf().player, x: 0, z: 0, vx: 20, vz: 0 };
  applySnapshot(world, st, snapOf({
    player: p,
    spawns: [{ id: 9, kind: 'bullet', projectileColor: 1, class: 'kinetic', fromPlayer: true, x: 0, z: 0, vx: 20, vz: 0 }],
    bullets: [[9, 0, 0]],
  }), 1000);
  renderNet(world, st, 1100, INTERP_DELAY_MS);
  // Both advanced by the same 100 ms at the same 20 u/s, so they are still co-located — the muzzle holds.
  assert.ok(Math.abs(world.player.pos.x - 2) < 1e-6, `ship advanced (got ${world.player.pos.x})`);
  assert.ok(Math.abs(world.bullets[0].pos.x - world.player.pos.x) < 1e-6,
    'the bullet did not run ahead of the ship that fired it');
});

test('positions interpolate between snapshots; health does not', () => {
  const { world } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({
    spawns: [{ id: 7, kind: 'enemy', name: 'Basic pirate ship', maxHp: 20 }],
    enemies: [[7, 0, 0, 0, 20, 1.8, 0]],
  }), 1000);
  applySnapshot(world, st, snapOf({ tick: 2, enemies: [[7, 10, 0, 0, 5, 1.8, 0]] }), 1100);

  // Render the moment exactly halfway between the two samples.
  renderNet(world, st, 1050 + INTERP_DELAY_MS, INTERP_DELAY_MS);
  const e = world.enemies[0];
  assert.ok(Math.abs(e.pos.x - 5) < 1e-9, `halfway between 0 and 10 (got ${e.pos.x})`);
  assert.equal(e.hp, 5, 'health takes the newer value outright — a bar sliding down for 100 ms reads as a bug');
});

test('heading interpolates the short way around the circle', () => {
  const { world } = clientWorld();
  const st = createNetState();
  const almostFull = Math.PI * 2 - 0.1;
  applySnapshot(world, st, snapOf({
    spawns: [{ id: 7, kind: 'enemy', name: 'Basic pirate ship' }],
    enemies: [[7, 0, 0, almostFull, 20, 1.8, 0]],
  }), 1000);
  applySnapshot(world, st, snapOf({ tick: 2, enemies: [[7, 0, 0, 0.1, 20, 1.8, 0]] }), 1100);
  renderNet(world, st, 1050 + INTERP_DELAY_MS, INTERP_DELAY_MS);
  const h = world.enemies[0].heading;
  // The short way crosses zero: the midpoint is ~2π (or ~0), never ~π.
  const wrapped = ((h % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  assert.ok(wrapped < 0.05 || wrapped > Math.PI * 2 - 0.05,
    `turned the short way (heading ${h}) — the long way would put it near π`);
});

test('past the newest sample the world holds still rather than guessing', () => {
  const { world } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({
    spawns: [{ id: 7, kind: 'enemy', name: 'Basic pirate ship' }],
    enemies: [[7, 0, 0, 0, 20, 1.8, 0]],
  }), 1000);
  applySnapshot(world, st, snapOf({ tick: 2, enemies: [[7, 10, 0, 0, 20, 1.8, 0]] }), 1100);
  renderNet(world, st, 5000, 0); // far past the last sample
  assert.equal(world.enemies[0].pos.x, 10, 'held at the last known position, not extrapolated past it');
});

test('wire events reach the World event queue, with entity ids rehydrated', () => {
  const { world } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({
    spawns: [{ id: 7, kind: 'enemy', name: 'Basic pirate ship' }],
    enemies: [[7, 0, 0, 0, 20, 1.8, 0]],
    events: [{ type: 'enemyShieldHit', enemyId: 7, pos: { x: 1, y: 0.6, z: 2 }, broke: false },
             { type: 'kill', pos: { x: 3, y: 0.6, z: 4 }, reward: 25 }],
  }));
  const drained = [];
  world.events.drain((e) => drained.push(e));
  assert.equal(drained.length, 2);
  assert.equal(drained[0].enemy, world.enemies[0], 'the id became the entity again, so the bubble binds');
  assert.equal(drained[1].type, 'kill');
});

test('clearNet releases every body', () => {
  const { world, attached } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({
    spawns: [{ id: 1, kind: 'enemy', name: 'Basic pirate ship' }, { id: 2, kind: 'bullet' }],
    enemies: [[1, 0, 0, 0, 20, 1.8, 0]], bullets: [[2, 1, 1]],
  }));
  assert.equal(attached.length, 2);
  clearNet(world, st);
  assert.equal(attached.length, 0);
  assert.equal(world.enemies.length + world.bullets.length, 0);
});

test('END TO END: a real room drives a real client World', () => {
  const room = createRoom({ levelName: 'level-0', seed: 4242 });
  const { world, attached } = clientWorld();
  const st = createNetState();
  let at = 1000;

  // Fly forward and shoot, so the run produces enemies, bullets and hits to reconcile.
  for (let i = 0; i < 900; i++) {
    room.pushInput([{ t: i, k: ['KeyW', 'Space'], a: null }]);
    room.stepOnce();
    if (room.dueForSnapshot()) { applySnapshot(world, st, room.takeSnapshot(), at); at += 67; }
  }
  renderNet(world, st, at, 0);

  assert.equal(world.enemies.length, room.world.enemies.length, 'the client draws every enemy the room has');
  assert.equal(world.bullets.length, room.world.bullets.length, 'and every bullet');
  assert.equal(world.kills, room.world.kills, 'and agrees on the score');
  assert.equal(attached.length, world.enemies.length + world.bullets.length + world.rockets.length + world.drops.length,
    'exactly one body per drawn entity — no leaks, no missing meshes');
  // Rendered at the newest sample, positions should be the room's own.
  for (const e of world.enemies) {
    const near = room.world.enemies.some((r) => Math.abs(r.pos.x - e.pos.x) < 1e-6 && Math.abs(r.pos.z - e.pos.z) < 1e-6);
    assert.ok(near, 'each drawn enemy sits where the room says it is');
  }
  assert.ok(room.world.enemies.length > 0, 'the fight actually happened (guard against an empty assertion)');
});

test('a bullet is dead-reckoned into the present, not shown a tenth of a second late', () => {
  const { world } = clientWorld();
  const st = createNetState();
  // Born at x=0 flying +x at 40 u/s — the one entity whose future is exactly known.
  applySnapshot(world, st, snapOf({
    spawns: [{ id: 9, kind: 'bullet', projectileColor: 1, class: 'kinetic', fromPlayer: true, x: 0, z: 0, vx: 40, vz: 0 }],
    bullets: [[9, 0, 0]],
  }), 1000);

  // 50 ms after that sample, with the usual 100 ms interpolation delay in force. An interpolated bullet
  // would still be sitting at the muzzle (the render moment is BEFORE its only sample); a dead-reckoned one
  // has travelled 40 × 0.05 = 2 units.
  renderNet(world, st, 1050, INTERP_DELAY_MS);
  assert.ok(Math.abs(world.bullets[0].pos.x - 2) < 1e-6,
    `flew with its own velocity (got ${world.bullets[0].pos.x})`);

  // …and it is not extrapolated forever if snapshots stop arriving.
  renderNet(world, st, 1000 + 60_000, INTERP_DELAY_MS);
  assert.ok(world.bullets[0].pos.x <= 40 * (MAX_EXTRAPOLATION_MS / 1000) + 1e-6,
    'capped rather than flying off the map on a stall');
});

test('loot the room collected reaches this World, so a victory can bank it', () => {
  // The gap: the ROOM's Grab fills the room's `pendingLoot`, but the client banks a win from its OWN list,
  // which nothing filled — so every crate picked up in a room was silently lost at the victory screen.
  const { world } = clientWorld();
  const st = createNetState();
  const loot = [{ kind: 'component', refId: 6 }, { kind: 'weapon', refId: 5 }];
  applySnapshot(world, st, snapOf({ run: { ...snapOf().run, loot } }));
  assert.deepEqual(world.pendingLoot, loot);

  // Mutated IN PLACE, because `takeLoot()` slices this exact array — replacing it would leave the victory
  // path holding the old one.
  const same = world.pendingLoot;
  applySnapshot(world, st, snapOf({ tick: 2, run: { ...snapOf().run, loot: [{ kind: 'weapon', refId: 9 }] } }));
  assert.equal(world.pendingLoot, same, 'still the same array object');
  assert.deepEqual(world.pendingLoot, [{ kind: 'weapon', refId: 9 }]);
});

test('a rocket is drawn in the present, so its smoke trail does not run ahead of it', () => {
  // Smoke puffs arrive as EVENTS and are placed where the rocket is NOW; the rocket itself was drawn a
  // tenth of a second in the past, so the trail led the rocket that was laying it.
  const { world } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({
    spawns: [{ id: 3, kind: 'rocket', projectileColor: 1, fromPlayer: true, x: 0, z: 0, h: 0 }],
    rockets: [[3, 0, 0, 0]],
  }), 1000);
  // SIX server ticks later — 6 × 1/60 s = exactly 100 ms of simulation, which is what a snapshot interval
  // looks like. The span is taken from the TICK delta, never from arrival times: snapshots arrive in bursts
  // and dividing by that gap once inferred a rocket doing 600 u/s.
  applySnapshot(world, st, snapOf({ tick: 7, rockets: [[3, 0, 10, 0]] }), 1100); // 10 units in 100 ms

  // 50 ms past the newest sample: a present-time rocket has gone another 5 units, an interpolated one
  // would still be short of the sample it already passed.
  renderNet(world, st, 1150, INTERP_DELAY_MS);
  assert.ok(Math.abs(world.rockets[0].pos.z - 15) < 1e-6,
    `carried on at its own speed (got ${world.rockets[0].pos.z})`);

  // With only one sample there is no velocity to infer — it sits still rather than guessing.
  const st2 = createNetState();
  const w2 = clientWorld();
  applySnapshot(w2.world, st2, snapOf({
    spawns: [{ id: 3, kind: 'rocket', x: 4, z: 5, h: 1 }], rockets: [[3, 4, 5, 1]],
  }), 1000);
  renderNet(w2.world, st2, 1200, INTERP_DELAY_MS);
  assert.equal(w2.world.rockets[0].pos.z, 5);
});
