// Snapshot → World, without a browser.
//
// The interesting test is the last one: it runs an actual server room, feeds its actual snapshots into an
// actual client World, and checks the client ends up drawing what the room is simulating. That is the whole
// netsim contract, and it is testable in-process precisely because `netsim-world.js` is THREE-free and the
// room is clock-free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, noopHost } from './sim-core/world.js';
import { createNetState, applySnapshot, renderNet, releaseNetEvents, clearNet, INTERP_DELAY_MS, MAX_EXTRAPOLATION_MS,
         PLAYER_EVENT_BUFFER_MS, MAX_EVENT_QUEUE } from './netsim-world.js';
import { createRoom } from '../../server/src/netsim/room.js';
import { SIM_DT } from './sim-core/consts.js';
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
  releaseNetEvents(world, st, Date.now());
  world.events.drain((e) => drained.push(e));
  assert.equal(drained.length, 2, 'an anchored event still plays on arrival — see eventBudgetMs');
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

test('both shield pools travel — the bar and its purple recharge fill', () => {
  // The HUD's blue strip is `_shieldValue / capacity` and its PURPLE fill is
  // `_shieldRechargeAccum / rechargeSec`. Neither was on the wire: the player's recharge fill never moved,
  // and an enemy's ghost kept the pools it was BORN with, so its blue strip sat full for its whole life.
  const { world } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({
    player: { ...snapOf().player, sh: 3.5, shr: 4.25 },
    spawns: [{ id: 2, kind: 'enemy', name: 'Basic pirate ship', maxHp: 20 }],
    enemies: [[2, 0, 0, 0, 12, 1.8, 0, 0, 6.5]],   // shield broken, 6.5 s banked toward the refill
  }));
  assert.equal(world.player._shieldValue, 3.5);
  assert.equal(world.player._shieldRechargeAccum, 4.25, 'the purple fill has something to read');

  renderNet(world, st, Date.now(), 0);
  assert.equal(world.enemies[0]._shieldValue, 0, 'the enemy really is broken, not full as it was born');
  assert.equal(world.enemies[0]._shieldRechargeAccum, 6.5);

  // Taken outright, never blended: a recharge countdown that lerps is a countdown that lies.
  applySnapshot(world, st, snapOf({ tick: 7, enemies: [[2, 0, 0, 0, 12, 1.8, 0, 10, 0]] }), Date.now() + 100);
  renderNet(world, st, Date.now() + 200, 0);
  assert.equal(world.enemies[0]._shieldValue, 10, 'refilled in one step, as the sim did it');
  assert.equal(world.enemies[0]._shieldRechargeAccum, 0);
});

test('the rocket cooldown travels — the HUD dial is the ROOM\'s countdown', () => {
  // `hud.js:77-79` draws the 🚀 radial from `G.player.groups.rocket.cooldown`, and only the room ever
  // advances the local ship's fire groups (the predictor steps a shadow player, not this one). Unsent, the
  // client's copy sat at 0 and the button read "ready" for the whole fight, rocket in flight or not.
  const room = createRoom({ levelName: 'level-0', seed: 4242 });
  const { world } = clientWorld();
  // The fake player of `clientWorld` with the one thing this test is about.
  world.player.groups = { gun: { name: 'gun', reload: 0.5, cooldown: 0 },
                          rocket: { name: 'rocket', reload: 5, cooldown: 0 } };
  const st = createNetState();
  let at = 1000;
  let sent = null;   // the cooldown carried by the newest snapshot the client applied
  const step = (keys) => {
    room.pushInput([{ t: at, k: keys, a: null }]);
    room.stepOnce();
    if (room.dueForSnapshot()) {
      const snap = room.takeSnapshot();
      sent = snap.player.cd.rocket;
      applySnapshot(world, st, snap, at); at += 67;
    }
  };

  for (let i = 0; i < 30; i++) step(['KeyF']);   // hold the rocket key: one volley, then the reload
  assert.ok(room.world.player.groups.rocket.cooldown > 0, 'the room really did fire a rocket (guard against an empty assertion)');
  const fired = world.player.groups.rocket.cooldown;
  assert.equal(fired, sent, 'the HUD reads the room\'s countdown, not 0');
  assert.ok(fired > 4, `and it is the real reload, mid-countdown (got ${fired})`);

  // …and it keeps counting DOWN. Taken outright, never blended: a lerped countdown is a countdown that lies.
  for (let i = 0; i < 60; i++) step([]);
  assert.ok(world.player.groups.rocket.cooldown < fired, 'the dial fills as the room reloads');
  assert.equal(world.player.groups.rocket.cooldown, sent);
});

test('a rocket flies from the muzzle, not from its second snapshot', () => {
  // A rocket is drawn by finite difference over its last TWO samples, so until the second one arrived it
  // had no velocity: it appeared at the muzzle, sat still for a whole snapshot interval, then jumped ~0.8
  // units to catch up. Once per rocket, at the muzzle, which is exactly where the player is looking when
  // they pull the trigger — the "my rockets stutter" report. Bullets never had it: their launch velocity
  // has always been in the spawn descriptor.
  const room = createRoom({ levelName: 'level-0', seed: 4242 });
  const { world } = clientWorld();
  const st = createNetState();
  st.welcome = { snapshotEvery: 4 };
  const MS = SIM_DT * 1000;

  // Follow ONE rocket for its whole life, one render frame per tick, with a jitter-free network: whatever
  // unevenness is left in the drawn path is the client's own.
  const track = new Map();
  for (let i = 0; i < 400; i++) {
    room.pushInput([{ t: i, k: ['KeyW', 'KeyF'], a: null }]);
    room.stepOnce();
    if (room.dueForSnapshot()) applySnapshot(world, st, room.takeSnapshot(), room.tick * MS);
    renderNet(world, st, room.tick * MS, INTERP_DELAY_MS);
    for (const r of world.rockets) {
      if (!track.has(r)) track.set(r, []);
      track.get(r).push({ x: r.pos.x, z: r.pos.z });
    }
  }

  const lives = [...track.values()].filter((pts) => pts.length > 10);
  assert.ok(lives.length > 0, 'a rocket really did fly (guard against an empty assertion)');
  for (const pts of lives) {
    const steps = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.z - pts[i].z));
    const jumps = steps.slice(1).map((v, i) => Math.abs(v - steps[i]));
    const worst = Math.max(...jumps);
    // The birth hitch measured 0.80 units in one frame against a 0.20 cruise step. Anything of that order
    // is the freeze-then-jump coming back.
    assert.ok(worst < 0.05, `the drawn path has no step change worth seeing (worst ${worst.toFixed(3)})`);
  }
});

test('EVENT TIMING: the gun keeps its own rhythm, not the snapshot grid', () => {
  // The bug, in one line: events ride snapshots, so they used to be PLAYED when their snapshot landed. The
  // starter gun reloads in 0.18 s — 10.8 ticks, so the sim fires every 11, dead even — while snapshots go
  // out every 4. The rounding walked 1->2->3->0 and every fourth shot arrived a whole snapshot early:
  // measured gaps of 200, 133, 200, 200 ms, which the ear reads as one shot in four being doubled.
  const room = createRoom({ levelName: 'level-0', seed: 4242 });
  const { world } = clientWorld();
  const st = createNetState();
  st.welcome = { snapshotEvery: 4 };
  const MS = SIM_DT * 1000;

  // A jitter-free network: a snapshot for tick T is applied at exactly T's own moment. Any rhythm left in
  // the output is therefore ours, not the transport's. The clock is read at sub-tick resolution, because
  // the thing under test is WHEN a sound plays and a whole tick of slop would hide a third of the defect.
  const SUB = 8, played = [];
  for (let i = 0; i < 240; i++) {
    room.pushInput([{ t: i, k: ['Space'], a: null }]);
    room.stepOnce();
    if (room.dueForSnapshot()) applySnapshot(world, st, room.takeSnapshot(), room.tick * MS);
    for (let k = 1; k <= SUB; k++) {
      const now = (room.tick - 1 + k / SUB) * MS;
      releaseNetEvents(world, st, now);
      world.events.drain((e) => { if (e.type === 'fire') played.push(now); });
    }
  }

  assert.ok(played.length > 15, `the gun really did fire a burst (got ${played.length})`);
  const gaps = played.slice(1).map((v, i) => v - played[i]);
  const spread = Math.max(...gaps) - Math.min(...gaps);
  // Slack for the sampling clock itself: each release instant is read to within one sub-step, so a GAP —
  // two instants — can be off by two. That is 4.2 ms against a defect that spread the gaps by 67.
  const SLOP = 2 * MS / SUB + 1e-6;
  assert.ok(spread <= SLOP,
    `every gap the same length — the weapon's rhythm, not the snapshot grid (spread ${spread.toFixed(1)} ms)`);
  // …and it is the RIGHT rhythm: 0.18 s of reload is 10.8 ticks, so the sim fires every 11.
  assert.ok(Math.abs(gaps[0] - 11 * MS) <= SLOP,
    `the delivered rate is the simulated one (got ${gaps[0].toFixed(1)} ms, want ${(11 * MS).toFixed(1)})`);
});

test('EVENT TIMING: only the sound is re-timed — anchored events still play on arrival', () => {
  // The rule, and it was learned by breaking it: an event tied to something on screen may NOT be moved in
  // time. Holding the room's events for INTERP_DELAY_MS made rockets stutter — `smoke` and `detonate` fell
  // 100 ms behind a rocket that is drawn in the PRESENT, and a ghost despawns on the arrival clock, so the
  // rocket vanished and its blast went off a tenth of a second later in empty space. `fire` is the one
  // event with neither a position nor an entity.
  const { world } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({
    tick: 8,
    events: [{ type: 'fire', weaponClass: 'kinetic', isRocket: false, fromPlayer: true, tk: 8 },
             { type: 'smoke', pos: { x: 1, y: 0.6, z: 2 }, tk: 8 },
             { type: 'detonate', pos: { x: 1, y: 0.6, z: 2 }, tk: 8 },
             { type: 'warpFlash', pos: { x: 3, y: 0.6, z: 4 }, tk: 8 }],
  }), 1000);

  const drained = [];
  releaseNetEvents(world, st, 1000);
  world.events.drain((e) => drained.push(e));
  assert.deepEqual(drained.map((e) => e.type), ['smoke', 'detonate', 'warpFlash'],
    'everything with a position goes out at once, exactly as it did before the scheduler existed');

  releaseNetEvents(world, st, 1000 + PLAYER_EVENT_BUFFER_MS);
  world.events.drain((e) => drained.push(e));
  assert.deepEqual(drained.map((e) => e.type), ['smoke', 'detonate', 'warpFlash', 'fire'],
    'the shot alone waits, and only long enough to undo the batching');
});

test('EVENT TIMING: an event is released late rather than lost', () => {
  // A tab that is not rendering never drains the queue. Bound it — but by RELEASING the excess, never by
  // dropping it: a lost event is a banner that never showed or a pickup that never logged.
  const { world } = clientWorld();
  const st = createNetState();
  for (let i = 0; i < MAX_EVENT_QUEUE + 20; i++) {
    applySnapshot(world, st, snapOf({ tick: i + 1,
      events: [{ type: 'fire', weaponClass: 'kinetic', isRocket: false, fromPlayer: true, tk: i + 1 }] }), 1000);
  }
  const drained = [];
  releaseNetEvents(world, st, 1000); // nothing is "due" yet at the arrival instant…
  world.events.drain((e) => drained.push(e));
  assert.equal(drained.length, 20, '…except the overflow, which goes out at once');
  releaseNetEvents(world, st, 1000 + PLAYER_EVENT_BUFFER_MS);
  world.events.drain((e) => drained.push(e));
  assert.equal(drained.length, MAX_EVENT_QUEUE + 20, 'and every single one is eventually played');
});

test('a snapshot of cooldowns is harmless to a World that has no fire groups', () => {
  // The wire names groups the receiver may not have — a ship swapped between snapshots, or (as in most of
  // this file) a stub player with no `groups` at all. Neither may throw in the middle of applySnapshot.
  const { world } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({ player: { ...snapOf().player, cd: { gun: 0.2, rocket: 4 } } }));
  assert.equal(world.player.hp, 100, 'the rest of the block still applied');

  world.player.groups = { gun: { name: 'gun', reload: 0.5, cooldown: 0 } };
  applySnapshot(world, st, snapOf({ tick: 9, player: { ...snapOf().player, cd: { gun: 0.2, rocket: 4 } } }));
  assert.equal(world.player.groups.gun.cooldown, 0.2);
});

test('PREDICTION: the ship answers input the server has not acknowledged yet', async () => {
  // The whole point, stated as a test: hold a key, and the drawn ship turns NOW — not a round trip later.
  const { createPredictor } = await import('./netsim-predict.js');
  const { buildCatalog } = await import('../../server/src/sim-host.js');
  const catalog = buildCatalog('level-0');
  const ship = [...catalog.shipByName.values()].find((s) => s.type === 'player');
  const predictor = createPredictor(catalog, { ship, loadout: { mounts: ship.stats.mounts },
                                               components: ship.components, progression: null });

  const { world } = clientWorld();
  world.catalog = catalog;
  const st = createNetState();
  applySnapshot(world, st, snapOf({ ack: 10 }), 1000);

  // Nothing unacknowledged: the drawn ship is simply the authoritative one.
  renderNet(world, st, 1010, INTERP_DELAY_MS, predictor, () => []);
  const still = world.player.heading;

  // Now the player has been holding LEFT for twenty ticks the server has not applied yet.
  const held = Array.from({ length: 20 }, (_, i) => ({ t: 11 + i, k: ['KeyA'], a: null }));
  for (let f = 0; f < 8; f++) renderNet(world, st, 1020 + f * 16, INTERP_DELAY_MS, predictor, () => held);
  assert.ok(Math.abs(world.player.heading - still) > 0.1,
    `the ship turned on unacknowledged input alone (${still} -> ${world.player.heading})`);

  // …and it stands down for an autopilot, where the room is flying to a target this World does not have.
  world.autopilot.active = true;
  const beforeAuto = world.player.heading;
  for (let f = 0; f < 8; f++) renderNet(world, st, 1200 + f * 16, INTERP_DELAY_MS, predictor, () => held);
  assert.ok(Math.abs(world.player.heading - beforeAuto) < 0.6,
    'with the autopilot engaged it follows the snapshot instead of predicting');
});
