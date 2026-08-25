// Snapshot → World, without a browser.
//
// The interesting test is the last one: it runs an actual server room, feeds its actual snapshots into an
// actual client World, and checks the client ends up drawing what the room is simulating. That is the whole
// netsim contract, and it is testable in-process precisely because `netsim-world.js` is THREE-free and the
// room is clock-free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, noopHost } from './sim-core/world.js';
import { createNetState, applySnapshot, renderNet, clearNet, INTERP_DELAY_MS, tickAt } from './netsim-world.js';
import { SIM_DT } from './sim-core/consts.js';
import { createRoom } from '../../server/src/netsim/room.js';
import { createJerkProbe } from './netsim-jerk.js';
import { buildCatalog } from '../../server/src/sim-host.js';
import { Vec3 } from './sim-core/vec.js';

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

// An arrival consistent with a tick. The client draws on the TICK timeline, so a test that wants to name a
// moment names a tick; base 1000 is arbitrary and becomes the clock's offset. `renderAt` adds the
// interpolation delay, i.e. "the wall-clock instant at which tick T is the thing being shown".
const MS = SIM_DT * 1000;
const atOf = (tick) => 1000 + tick * MS;
const renderAt = (tick, delayMs = INTERP_DELAY_MS) => atOf(tick) + delayMs;

// Deliver a snapshot and advance the render clock to the tick it describes. Under one clock a spawn is an
// event on the RENDER timeline — the body appears when the player's moment reaches it, not when the packet
// did — so a test that wants to see an entity has to say when it is looking.
const deliver = (world, st, snap) => {
  applySnapshot(world, st, snap, atOf(snap.tick));
  renderNet(world, st, renderAt(snap.tick), INTERP_DELAY_MS);
};

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
  deliver(world, st, snapOf({
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
  deliver(world, st, snapOf({
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
  deliver(world, st, snapOf({
    spawns: [{ id: 4, kind: 'drop', item: { kind: 'weapon', refId: 5 }, x: 1, z: 2 }],
    drops: [[4, 1, 2]], grab: 4,
  }));
  assert.equal(st.grabTarget, world.drops[0]);
  deliver(world, st, snapOf({ tick: 2, drops: [[4, 1, 2]], grab: null }));
  assert.equal(st.grabTarget, null, 'and when nothing is being pulled, the beam has no target');
});

test('an unknown ship name draws nothing rather than crashing the frame', () => {
  const { world } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({ spawns: [{ id: 1, kind: 'enemy', name: 'Nonexistent cruiser' }] }));
  assert.equal(world.enemies.length, 0);
});

test('absence from a snapshot is the despawn — but not before the render clock gets there', () => {
  // The body is drawn `INTERP_DELAY_MS` behind the newest snapshot, so retiring it the moment the room stops
  // listing it takes it off screen before the player has watched it arrive — and its own death FX, which
  // ride the same clock, then go off in the space it used to occupy. Unity NetCode gates despawn on the
  // interpolation tick for exactly this reason; nengi releases deletions when the render clock crosses them.
  //
  // The moment it goes is its LAST SAMPLE, not the snapshot that failed to mention it: the room dropped it
  // somewhere in between, and the difference is a whole snapshot interval of standing still at its final
  // position. That interval was worth 322 measured breaks a minute on bullets alone.
  const { world, attached } = clientWorld();
  const st = createNetState();
  deliver(world, st, snapOf({
    tick: 4,
    spawns: [{ id: 7, kind: 'bullet', color: 1, fromPlayer: true }],
    bullets: [[7, 1, 2]],
  }));
  assert.equal(world.bullets.length, 1, 'on screen once the render clock reached the tick it was born on');

  applySnapshot(world, st, snapOf({ tick: 6, bullets: [[7, 3, 2]] }), atOf(6));
  applySnapshot(world, st, snapOf({ tick: 8, bullets: [] }), atOf(8));   // gone from the room at some point after 6

  renderNet(world, st, renderAt(5), INTERP_DELAY_MS);
  assert.equal(world.bullets.length, 1, 'still flying at tick 5 — the player has not watched it get there yet');

  renderNet(world, st, renderAt(6), INTERP_DELAY_MS);
  assert.equal(world.bullets.length, 0, 'gone the instant the clock reaches its last sample, not a moment later');
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
  // The regression this guards used to need arguing: bullets were dead-reckoned into the present while the
  // ship was drawn 100 ms in the past, so a ship drifting sideways trailed its own muzzle. Under one clock
  // it is structural — both are interpolated at the same tick from the same samples — and the test is kept
  // because "structural" is a claim about code that can be edited.
  const { world } = clientWorld();
  const st = createNetState();
  const at = (tick, x) => applySnapshot(world, st, snapOf({
    tick,
    player: { ...snapOf().player, x, z: 0, vx: 20, vz: 0 },
    spawns: st.byId.has(9)
      ? []
      : [{ id: 9, kind: 'bullet', projectileColor: 1, class: 'kinetic', fromPlayer: true, x, z: 0, vx: 20, vz: 0 }],
    bullets: [[9, x, 0]],
  }), atOf(tick));
  at(4, 0);
  at(8, 20 * 4 * SIM_DT);     // both travelled the same 4 ticks at 20 u/s
  at(12, 20 * 8 * SIM_DT);

  renderNet(world, st, renderAt(6), INTERP_DELAY_MS);   // halfway between the first two samples
  assert.ok(Math.abs(world.player.pos.x - world.bullets[0].pos.x) < 1e-6,
    `the bullet did not run ahead of the ship that fired it (ship ${world.player.pos.x}, bullet ${world.bullets[0].pos.x})`);
  assert.ok(world.bullets[0].pos.x > 0, 'and the pair actually moved (guard against an empty assertion)');
});

test('positions interpolate between snapshots; health does not', () => {
  const { world } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({
    tick: 4,
    spawns: [{ id: 7, kind: 'enemy', name: 'Basic pirate ship', maxHp: 20 }],
    enemies: [[7, 0, 0, 0, 20, 1.8, 0]],
  }), atOf(4));
  applySnapshot(world, st, snapOf({ tick: 8, enemies: [[7, 10, 0, 0, 5, 1.8, 0]] }), atOf(8));

  // Render the moment exactly halfway between the two samples — tick 6.
  renderNet(world, st, renderAt(6), INTERP_DELAY_MS);
  const e = world.enemies[0];
  assert.ok(Math.abs(e.pos.x - 5) < 1e-9, `halfway between 0 and 10 (got ${e.pos.x})`);
  assert.equal(e.hp, 5, 'health takes the newer value outright — a bar sliding down for 100 ms reads as a bug');
});

test('heading interpolates the short way around the circle', () => {
  const { world } = clientWorld();
  const st = createNetState();
  const almostFull = Math.PI * 2 - 0.1;
  applySnapshot(world, st, snapOf({
    tick: 4,
    spawns: [{ id: 7, kind: 'enemy', name: 'Basic pirate ship' }],
    enemies: [[7, 0, 0, almostFull, 20, 1.8, 0]],
  }), atOf(4));
  applySnapshot(world, st, snapOf({ tick: 8, enemies: [[7, 0, 0, 0.1, 20, 1.8, 0]] }), atOf(8));
  renderNet(world, st, renderAt(6), INTERP_DELAY_MS);
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
  deliver(world, st, snapOf({
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

test('a hostile beamCharge rehydrates its shipId into the GHOST — the remote-corridor gate', () => {
  // THE POINT OF THE WHOLE WIRE REF (DECISIONS §135). A remote shooter's fire group is never ticked in this
  // tab, so `g.charge` never advances and the corridor is underivable — the only thing that can hang it on
  // a hull is a name for the hull. `hydrateEvent` walks EVENT_ENTITY_REFS (sim-core/events.js), the same
  // table `protocol.js wireEvent` reads on the way out, so a ref cannot be forgotten on the way back.
  const { world } = clientWorld();
  const st = createNetState();
  deliver(world, st, snapOf({
    spawns: [{ id: 7, kind: 'enemy', name: 'pirate lancer' }],
    enemies: [[7, 0, 0, 0, 24, 2.1, 0]],
    events: [{ type: 'beamCharge', shipId: 7, pos: { x: 1, y: 0.6, z: 2 }, dur: 1.0,
               weaponClass: 'beam', fromPlayer: false }],
  }));
  const drained = [];
  world.events.drain((e) => drained.push(e));
  assert.equal(drained.length, 1);
  assert.equal(drained[0].ship, world.enemies[0], 'the id became the ghost again, so the corridor has a hull');
  assert.equal(drained[0].shipId, undefined, 'and the raw id is consumed, not left beside it');
  assert.ok(drained[0].pos instanceof Vec3, 'the muzzle still hydrates as a Vec3');
  assert.equal(drained[0].dur, 1.0);
});

test('a beamCharge whose ghost is already retired hydrates to null rather than throwing', () => {
  // A charge from a ship the render clock has since despawned: the FX must simply have nothing to draw.
  const { world } = clientWorld();
  const st = createNetState();
  deliver(world, st, snapOf({
    events: [{ type: 'beamCharge', shipId: 999, pos: { x: 0, y: 0.6, z: 0 }, dur: 1.0,
               weaponClass: 'beam', fromPlayer: false }],
  }));
  const drained = [];
  world.events.drain((e) => drained.push(e));
  assert.equal(drained[0].ship, null);
});

test("the PLAYER's own beamCharge carries no shipId, and comes through untouched", () => {
  // `idOf(world.player)` is null — the player is never host.onSpawn'ed — so his charge simply has no ref,
  // and `fromPlayer` is what routes it. The generalised rehydration must not invent a `ship: null` for it.
  const { world } = clientWorld();
  const st = createNetState();
  deliver(world, st, snapOf({
    events: [{ type: 'beamCharge', pos: { x: 0, y: 0.6, z: 0 }, dur: 1.0, weaponClass: 'beam', fromPlayer: true }],
  }));
  const drained = [];
  world.events.drain((e) => drained.push(e));
  assert.equal(drained[0].fromPlayer, true);
  assert.ok(!('ship' in drained[0]), 'no ship key at all — the adapter\'s `else if (ev.ship)` must not fire');
});

test('a beam discharge comes back with from/to as real Vec3s, not bare objects', () => {
  // The FX calls `.clone()` on positional fields, so a bare `{x,y,z}` is not a style point — it throws,
  // the frame dies, the loop stops and the last sound left playing loops forever. `pos` was already
  // hydrated; the beam added two more positional fields and they need the same treatment.
  const { world } = clientWorld();
  const st = createNetState();
  deliver(world, st, snapOf({
    events: [{ type: 'beamFire', from: { x: 1, y: 0.6, z: 2 }, to: { x: 3, y: 0.6, z: 40 },
               hit: true, absorbed: false, weaponClass: 'beam', fromPlayer: true }],
  }));
  const drained = [];
  world.events.drain((e) => drained.push(e));
  assert.equal(drained.length, 1);
  assert.ok(drained[0].from instanceof Vec3, 'from is a Vec3 — .clone() must not throw');
  assert.ok(drained[0].to instanceof Vec3, 'and so is to');
  assert.equal(drained[0].to.z, 40);
  assert.equal(typeof drained[0].from.clone, 'function');
  assert.equal(drained[0].weaponClass, 'beam', 'the non-positional fields pass through untouched');
});

test('clearNet releases every body', () => {
  const { world, attached } = clientWorld();
  const st = createNetState();
  deliver(world, st, snapOf({
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


test('ONE CLOCK: delivery jitter moves nothing', () => {
  // The measurement this design exists to fix: packets a room emits exactly `snapshotEvery` ticks apart
  // arrive 50–79 ms apart in real play, and anything drawn from ARRIVAL times inherits that spread. It cost
  // 7476 breaks in the drawn motion per minute, half of them landing on the frame a packet happened to
  // arrive. Stated here as an identity: the same fight delivered over a perfect link and a nasty one must
  // draw the same picture at the same instants.
  const run = (jitterAt, probe = null) => {
    const room = createRoom({ levelName: 'level-0', seed: 4242 });
    const { world } = clientWorld();
    const st = createNetState();
    st.jerk = probe;
    const drawn = [];
    for (let i = 0; i < 1100; i++) {
      room.pushInput([{ t: i, k: ['KeyW', 'Space', 'KeyF'], a: null }]);
      room.stepOnce();
      if (room.dueForSnapshot()) applySnapshot(world, st, room.takeSnapshot(), jitterAt(room.tick));
      renderNet(world, st, 1000 + room.tick * MS, INTERP_DELAY_MS);   // identical instants in both runs
      const shot = [];
      for (const list of [world.enemies, world.bullets, world.rockets]) {
        for (const e of list) shot.push(+e.pos.x.toFixed(6), +e.pos.z.toFixed(6));
      }
      drawn.push(shot);
    }
    return drawn;
  };

  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const probe = createJerkProbe({ maxEvents: 5000 });
  const clean = run((tick) => 1000 + tick * MS);
  const nasty = run((tick) => 1000 + tick * MS + rnd() * 24 - 12, probe);

  // Skip the warm-up: the clock is seeded from the first packet, jitter and all, then slews toward the mean
  // at CLOCK_FOLLOW a packet. During it the timelines differ by that seed's error — a slow drift of a few
  // milliseconds, not a jerk. What is asserted is the settled state.
  let worst = 0, frames = 0;
  for (let i = 700; i < clean.length; i++) {
    if (clean[i].length !== nasty[i].length) continue;  // spawn/despawn edges are the other tests' business
    frames++;
    for (let k = 0; k < clean[i].length; k++) worst = Math.max(worst, Math.abs(clean[i][k] - nasty[i][k]));
  }
  assert.ok(frames > 250, `the two runs really are comparable (${frames} frames)`);

  // The two timelines do not coincide exactly, and are not meant to: the clock estimate is a filter over a
  // noisy observation, so it performs a slow random walk of well under a millisecond — a few hundredths of a
  // unit on a 40 u/s bullet. On the arrival-time timeline this replaced, the same measurement put 0.83 of a
  // unit between the two runs, and it arrived in single frames.
  assert.ok(worst < 0.15, `a jittery link draws effectively the same picture (worst gap ${worst.toFixed(4)} units)`);

  // …and the assertion with teeth: that the drawn motion of the JITTERY run has no discontinuities in it.
  // The probe is the instrument this was diagnosed with, so it is also the one it is judged by. The same
  // measurement over the arrival-time timeline reported thousands.
  const r = probe.report();
  assert.ok(r.total < 40, `and it is smooth doing it (${r.total} breaks in the drawn motion)`);
  // Deliberately no assertion about WHERE the survivors land. Half the frames in this run are packet frames,
  // so with a handful of breaks the attribution is a coin flip — and that it has become meaningless is the
  // result: on the old timeline half of several thousand breaks landed on packet frames, every time.
  assert.ok(r.total >= 0);
});

test('ONE CLOCK: nothing is extrapolated — a stalled link holds still', () => {
  // Every library that has tried the alternative says the same thing, most bluntly in Colyseus's own source:
  // "On underrun, hold at the newest sample — don't extrapolate. Extrapolation here is what produced the
  // 'flickery' feel." Bullets and rockets used to be the exception here, and they were the jerky ones.
  const { world } = clientWorld();
  const st = createNetState();
  deliver(world, st, snapOf({
    tick: 4,
    spawns: [{ id: 9, kind: 'bullet', projectileColor: 1, class: 'kinetic', fromPlayer: true, x: 0, z: 0, vx: 40, vz: 0 }],
    bullets: [[9, 0, 0]],
  }));
  applySnapshot(world, st, snapOf({ tick: 6, bullets: [[9, 40 * 2 * SIM_DT, 0]] }), atOf(6));

  renderNet(world, st, renderAt(6), INTERP_DELAY_MS);
  const reached = world.bullets[0].pos.x;
  assert.ok(reached > 1, `it flew while it had samples to fly between (got ${reached})`);

  // …and now the link dies. Ten seconds of frames, no packets.
  renderNet(world, st, renderAt(6) + 10_000, INTERP_DELAY_MS);
  assert.ok(Math.abs(world.bullets[0].pos.x - reached) < 1e-9,
    `held at its last sample rather than guessing a future (moved ${world.bullets[0].pos.x - reached})`);
});

test('ONE CLOCK: a spawn is an event on the render timeline too', () => {
  // Symmetry with the despawn above, and it is not cosmetic: attaching a body when the PACKET arrives means
  // it stands at its spawn point for the whole interpolation delay before it starts moving — a stutter at
  // the birth of every bullet and every rocket, which is what "my rockets jerk" turned out to be.
  const { world, attached } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({
    tick: 8,
    spawns: [{ id: 5, kind: 'rocket', projectileColor: 1, weaponClass: 'rocket', fromPlayer: true, x: 0, z: 0, h: 0 }],
    rockets: [[5, 0, 0, 0]],
  }), atOf(8));
  assert.equal(world.rockets.length, 0, 'the packet arrived, but the moment it describes has not');
  assert.equal(attached.length, 0, 'so no mesh was built for a body nobody can see yet');

  renderNet(world, st, renderAt(7), INTERP_DELAY_MS);
  assert.equal(world.rockets.length, 0, 'still not at tick 7');

  renderNet(world, st, renderAt(8), INTERP_DELAY_MS);
  assert.equal(world.rockets.length, 1, 'and it appears exactly when the clock reaches the tick it was born on');
  assert.equal(attached.length, 1);
});

test('ONE CLOCK: an event waits for the frame that shows what it describes', () => {
  // The maintainer's report, twice in one day and from opposite directions: a rocket's smoke trail running
  // AHEAD of the rocket. Smoke arrives as an event carrying the position the rocket had at some tick, and
  // playing it when its PACKET lands puts the puff a full interpolation delay in front of the body that is
  // supposed to be laying it. The event carries `tk`; it waits for the same clock as everything else.
  const { world } = clientWorld();
  const st = createNetState();
  applySnapshot(world, st, snapOf({
    tick: 8,
    events: [{ type: 'smoke', pos: { x: 1, y: 0.6, z: 2 }, tk: 8 },
             { type: 'warpFlash', pos: { x: 3, y: 0.6, z: 4 }, tk: 4 }],
  }), atOf(8));

  const drained = [];
  world.events.drain((e) => drained.push(e));
  assert.equal(drained.length, 0, 'nothing plays on arrival any more');

  renderNet(world, st, renderAt(4), INTERP_DELAY_MS);
  world.events.drain((e) => drained.push(e));
  assert.deepEqual(drained.map((e) => e.type), ['warpFlash'], 'the older event goes first, at its own tick');

  renderNet(world, st, renderAt(8), INTERP_DELAY_MS);
  world.events.drain((e) => drained.push(e));
  assert.deepEqual(drained.map((e) => e.type), ['warpFlash', 'smoke'], 'and the newer one when the clock gets there');
  assert.ok(drained[1].pos.clone, 'positions come back as real Vec3s — the FX layer clones them');
});

test('ONE CLOCK: the muzzle stays on the nose while the ship drifts sideways', () => {
  // A short output spring on the drawn ship was tried and removed the same evening: it lags the interpolated
  // pose by its own time constant, so a ship sliding sideways sits a little behind its own muzzle and the
  // shots appear to leave from beside the nose. Bullets are interpolated at exactly this tick, so the ship
  // has to be too — no smoothing, no exceptions, one clock.
  const { world } = clientWorld();
  const st = createNetState();
  const V = 25;                                    // drifting right at 25 u/s, nose still pointing +z
  const place = (tick) => {
    const x = V * tick * SIM_DT;
    applySnapshot(world, st, snapOf({
      tick,
      player: { ...snapOf().player, x, z: 0, vx: V, vz: 0 },
      spawns: st.byId.has(3) ? [] : [{ id: 3, kind: 'bullet', projectileColor: 1, class: 'kinetic',
                                       fromPlayer: true, x, z: 0, vx: V, vz: 0 }],
      bullets: [[3, x, 0]],
    }), atOf(tick));
  };
  for (const tick of [2, 4, 6, 8, 10, 12]) place(tick);

  // Sample every frame across several snapshot intervals: a spring shows up as a gap that grows and shrinks,
  // not as a constant one, so one instant would not catch it.
  let worst = 0;
  for (let ms = renderAt(4); ms <= renderAt(10); ms += 8) {
    renderNet(world, st, ms, INTERP_DELAY_MS);
    worst = Math.max(worst, Math.abs(world.player.pos.x - world.bullets[0].pos.x));
  }
  assert.ok(worst < 1e-9, `the muzzle never leaves the nose (worst gap ${worst})`);
  assert.ok(world.player.pos.x > 0, 'and the ship really was moving (guard against an empty assertion)');
});

// ---------- The third combatant on the wire ----------

test('an ALLY ghost lands in world.allies, with a body, built by the simulation\'s own constructor', () => {
  const { world, attached } = clientWorld();
  const st = createNetState();
  deliver(world, st, snapOf({
    spawns: [{ id: 9, kind: 'ally', name: 'Basic player ship', shipClass: 'player',
               color: 0x3ddc84, fullScale: 1.1, maxHp: 200, sizeScale: 1.1 }],
    allies: [[9, 4, -8, 0.5, 200, 1.1, 0, 20, 0]],
  }));
  assert.equal(world.allies.length, 1, 'the wingman is in the ALLY list, not among the enemies');
  assert.equal(world.enemies.length, 0);
  const a = world.allies[0];
  assert.equal(a.isAlly, true, 'built through sim-core makeAlly — there is no second, render-only ally');
  assert.equal(a.maxHp, 200);
  assert.equal(a.color, 0x3ddc84, 'his livery is the one thing the wire has to carry');
  assert.ok(a.radius > 0, 'and he carries the health-bar anchor the HUD loop reads');
  assert.deepEqual(attached.map((x) => x.kind), ['ally'], 'the host gave him a body under the ally kind');
});

test('an ally is INTERPOLATED between samples; hp and the shield are taken outright', () => {
  const { world } = clientWorld();
  const st = createNetState();
  const spawns = [{ id: 9, kind: 'ally', name: 'Basic player ship', color: 0x3ddc84, maxHp: 200 }];
  applySnapshot(world, st, snapOf({ tick: 10, spawns, allies: [[9, 0, 0, 0, 200, 1, 0, 20, 0]] }), atOf(10));
  applySnapshot(world, st, snapOf({ tick: 20, allies: [[9, 10, 20, 1, 140, 1, 0, 0, 3.5]] }), atOf(20));
  // Halfway between the two ticks.
  renderNet(world, st, renderAt(15), INTERP_DELAY_MS);
  const a = world.allies[0];
  assert.ok(Math.abs(a.pos.x - 5) < 1e-6, `x lerps to the midpoint (got ${a.pos.x})`);
  assert.ok(Math.abs(a.pos.z - 10) < 1e-6, `z lerps to the midpoint (got ${a.pos.z})`);
  assert.equal(a.hp, 140, 'health is STATE: the newer of the pair, never a slide');
  assert.equal(a._shieldValue, 0);
  assert.equal(a._shieldRechargeAccum, 3.5, 'and the purple recharge fill has something to read');
});

test('an ally the room stops listing is despawned when the render clock reaches it', () => {
  const { world, attached } = clientWorld();
  const st = createNetState();
  const spawns = [{ id: 9, kind: 'ally', name: 'Basic player ship', color: 0x3ddc84, maxHp: 200 }];
  deliver(world, st, snapOf({ tick: 10, spawns, allies: [[9, 0, 0, 0, 200, 1, 0, 20, 0]] }));
  assert.equal(world.allies.length, 1);
  applySnapshot(world, st, snapOf({ tick: 20, allies: [] }), atOf(20));
  renderNet(world, st, renderAt(20), INTERP_DELAY_MS);
  assert.equal(world.allies.length, 0, 'gone from the list…');
  assert.equal(attached.length, 0, '…and his body released through the host');
});
