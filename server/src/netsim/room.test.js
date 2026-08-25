// A room must be the SAME simulation as the referee, and the protocol must not leak the server's internals.
//
// The first test is the load-bearing one: feed a room the canonical Level-0 input trace, one snapshot per
// tick, and require it to reach the digest `server/tools/sim-replay.mjs` reaches from the same trace. A
// room that drifts from the referee is a third simulation, which is exactly what this whole project exists
// to prevent (docs/plans/server-authoritative-sim.md D1).
//
// The trace is a gitignored S3 asset, so a checkout without it skips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRoom, MAX_QUEUED_INPUTS, INPUT_QUEUE_TARGET, INPUT_HOLD_TICKS } from './room.js';
import { EVENT_FIELDS, wireEvent } from './protocol.js';
import { runTrace } from '../../tools/sim-replay.mjs';
import { hydrateTrace } from '../../../client/src/replay.js';
import { LEVELS } from '../catalog_seed.js';
import { buildCatalog } from '../sim-host.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const INTRO = LEVELS.find((l) => l.name === 'level-0').descriptor.introTrace;
const tracePath = path.join(repoRoot, 'client', INTRO);
const haveTrace = existsSync(tracePath);
const rawTrace = haveTrace ? JSON.parse(readFileSync(tracePath, 'utf8')) : null;
const skip = haveTrace ? false : `intro trace not pulled (${INTRO}) — run \`npm run assets:pull\``;

test('a room replaying the canonical trace matches the headless referee exactly', { skip }, () => {
  const t = hydrateTrace(rawTrace);
  const room = createRoom({ levelName: 'level-0', seed: t.seed,
    ship: { shipId: t.shipId, loadout: t.loadout, components: t.components } });
  // Fed at the NATURAL rate — one input per tick, which is what a healthy client produces. A room that is
  // handed a backlog deliberately fast-forwards through it (INPUT_QUEUE_TARGET), and that is not a replay.
  for (let i = 0; i < t.ticks.length; i++) {
    room.pushInput([{ t: i, k: t.ticks[i].k, a: t.ticks[i].t }]);
    room.stepOnce();
  }
  assert.equal(room.droppedInputs, 0, 'nothing overflowed');
  assert.equal(room.caughtUpInputs, 0, 'and nothing was fast-forwarded, so every input was simulated in order');

  const ref = runTrace(rawTrace);
  const got = room.digest();
  assert.equal(got.summary.kills, ref.summary.kills);
  assert.equal(got.draws, ref.draws, 'the same number of seeded RNG draws');
  assert.equal(got.hash, ref.hash,
    `a room diverged from the referee (room 0x${got.hash.toString(16)}, referee 0x${ref.hash.toString(16)})`);
});

test('a silent client holds its controls rather than dropping them', () => {
  const room = createRoom({ seed: 3 });
  room.pushInput([{ t: 0, k: ['KeyW'], a: null }]);
  room.stepOnce();
  const movingAt1 = room.world.player.vel.length();
  for (let i = 0; i < 30; i++) room.stepOnce(); // nothing pushed: the last input repeats
  assert.ok(room.world.player.vel.length() > movingAt1,
    'thrust kept being applied through the gap (a network stall is not a released key)');
  assert.equal(room.tick, 31);
});

test('the input queue is bounded, and says so', () => {
  const room = createRoom({ seed: 3 });
  room.pushInput(Array.from({ length: MAX_QUEUED_INPUTS + 50 }, (_, i) => ({ t: i, k: [], a: null })));
  assert.equal(room.queued, MAX_QUEUED_INPUTS, 'held at the cap');
  assert.equal(room.droppedInputs, 50, 'and the overflow is counted, not hidden');
  room.stepOnce();
  assert.equal(room.takeSnapshot().dropped, 50, 'the client is told its input was discarded');
});

test('ack echoes the last client tick applied', () => {
  const room = createRoom({ seed: 3 });
  assert.equal(room.takeSnapshot().ack, null, 'nothing applied yet');
  room.pushInput([{ t: 41, k: [], a: null }, { t: 42, k: [], a: null }]);
  room.stepOnce();
  assert.equal(room.takeSnapshot().ack, 41);
  room.stepOnce();
  assert.equal(room.takeSnapshot().ack, 42);
});

test('an entity is described once, then addressed by id', () => {
  const room = createRoom({ seed: 3 });
  const seen = new Map();
  let firstSnapWithEnemy = null;
  for (let i = 0; i < 400; i++) {
    room.stepOnce();
    if (!room.dueForSnapshot()) continue;
    const s = room.takeSnapshot();
    for (const sp of s.spawns) {
      assert.ok(!seen.has(sp.id), `entity ${sp.id} was described twice`);
      seen.set(sp.id, sp);
    }
    if (!firstSnapWithEnemy && s.enemies.length) firstSnapWithEnemy = s;
  }
  assert.ok(firstSnapWithEnemy, 'the level spawned something within 400 ticks');
  const spawnedEnemies = [...seen.values()].filter((s) => s.kind === 'enemy');
  assert.ok(spawnedEnemies.length > 0, 'the level spawned enemies');
  // A ship is NAMED, not described: the client resolves the model/yaw/scale from the catalog it already
  // holds. So the contract is that the name is a real catalog key — a typo here would leave the client
  // drawing placeholder cones with no error anywhere.
  const catalog = buildCatalog('level-0');
  for (const sp of spawnedEnemies) {
    assert.ok(catalog.shipByName.get(sp.name), `spawn named '${sp.name}', which is not in the catalog`);
    assert.ok(sp.maxHp > 0 && sp.fullScale > 0, 'plus the per-entity numbers the catalog cannot give');
  }
  for (const row of firstSnapWithEnemy.enemies) assert.ok(seen.has(row[0]), 'every row id was described first');
});

test('a snapshot is JSON, and small', () => {
  const room = createRoom({ seed: 3 });
  for (let i = 0; i < 400; i++) room.stepOnce();
  const s = room.takeSnapshot();
  const json = JSON.stringify(s);
  assert.ok(json.length > 0);
  assert.deepEqual(JSON.parse(json).run, s.run, 'round-trips');
  // A guard against an entity graph leaking into the wire: a live enemy carries hitBoxes (dozens of OBBs),
  // so a snapshot that accidentally serialized one would be tens of kilobytes, 15 times a second.
  assert.ok(json.length < 20000, `snapshot is ${json.length} bytes — something big leaked in`);
  assert.ok(!json.includes('hitBoxes'), 'no collision geometry on the wire');
});

// --- the protocol allowlist ---

test('every event in the sim-core catalogue is wired for the network', () => {
  const src = readFileSync(path.join(repoRoot, 'client/src/sim-core/events.js'), 'utf8');
  const catalogue = [...src.matchAll(/^\/\/\s+\{\s*type:\s*'([a-zA-Z]+)'/gm)].map((m) => m[1]);
  assert.ok(catalogue.length >= 19, `parsed ${catalogue.length} event types from the catalogue — parser drifted`);
  for (const type of catalogue) {
    assert.ok(EVENT_FIELDS[type], `event '${type}' is in sim-core/events.js but not in protocol.js EVENT_FIELDS `
      + '— it would be silently dropped on the way to a client');
  }
});

test('an entity reference becomes an id, never the entity', () => {
  const enemy = { name: 'x', hitBoxes: [1, 2, 3], engine: {}, pos: { x: 1, y: 0, z: 2 } };
  const w = wireEvent({ type: 'enemyShieldHit', enemy, pos: { x: 5, y: 0.6, z: 6 }, broke: true }, () => 42);
  assert.deepEqual(w, { type: 'enemyShieldHit', pos: { x: 5, y: 0.6, z: 6 }, broke: true, enemyId: 42 });
  assert.ok(!JSON.stringify(w).includes('hitBoxes'));
});

test('a beam discharge crosses the wire as two plain points, and leaks no entity graph', () => {
  // `wireEvent` used to vec-serialize only a field literally named `pos`; the beam's two endpoints would
  // then have crossed as whatever JSON.stringify makes of a Vec3 INSTANCE — which happens to be {x,y,z}
  // today only because the constructor assigns three own enumerable fields. That is an implicit dependency
  // on a class's field layout, in the one file whose job is to make the wire explicit.
  const from = { x: 1.5, y: 0.6, z: 2.5, clone() { return this; } };  // Vec3-shaped, with methods on it
  const to = { x: 3.5, y: 0.6, z: 42.5, clone() { return this; } };
  const w = wireEvent({
    type: 'beamFire', from, to, hit: true, absorbed: false, weaponClass: 'beam', fromPlayer: true,
  }, () => 7);
  assert.deepEqual(w, {
    type: 'beamFire',
    from: { x: 1.5, y: 0.6, z: 2.5 }, to: { x: 3.5, y: 0.6, z: 42.5 },
    hit: true, absorbed: false, weaponClass: 'beam', fromPlayer: true,
  });
  assert.equal(typeof w.from.clone, 'undefined', 'a bare point, not the live vector object');
  // beamFire carries NO entity reference, and that is correct rather than pending: the ref rides on
  // `beamCharge` alone, because a sight that knows when a charge STARTED and how long it lasts needs nothing
  // from the release — the entry ends on its own `dur`, which IS the sim's chargeTime.
  assert.equal(w.enemyId, undefined, 'beamFire carries no entity reference — the ref rides on beamCharge');
  assert.equal(w.shipId, undefined);
});

test('a beam charge crosses as pos + dur + fromPlayer + the SHOOTER\'s id, and nothing per-tick', () => {
  // Two events per shot IS the whole protocol for this weapon: a charge is per-ship state that changes
  // every tick and an aiming corridor is per-ship geometry — neither is broadcast. The one addition is the
  // shooter's ID, which is what lets a client draw a corridor for a ship it never simulates.
  const shooter = { name: 'pirate lancer', hitBoxes: [1, 2, 3], groups: {}, pos: { x: 0, y: 0, z: 0 } };
  const w = wireEvent({ type: 'beamCharge', ship: shooter, pos: { x: 0, y: 0.6, z: 1.6 }, dur: 1.0, weaponClass: 'beam', fromPlayer: false }, () => 7);
  assert.deepEqual(w, { type: 'beamCharge', pos: { x: 0, y: 0.6, z: 1.6 }, dur: 1.0, weaponClass: 'beam', fromPlayer: false, shipId: 7 });
  assert.equal(w.weaponClass, 'beam', 'the class rides along so a second beam row routes its OWN swell');
  assert.ok(!JSON.stringify(w).includes('hitBoxes'), 'an id, never the entity — no collision geometry leaks');

  // The PLAYER is never host.onSpawn'ed, so `idOf` returns null for him and his own charge simply carries
  // no ref. Harmless: `fromPlayer` already routes it.
  const mine = wireEvent({ type: 'beamCharge', ship: {}, pos: { x: 0, y: 0.6, z: 1.6 }, dur: 1.0, weaponClass: 'beam', fromPlayer: true }, () => null);
  assert.equal(mine.shipId, undefined);
});

// --- THE GATE: a room's hostile charge names a ship the client can find (DECISIONS §135) ---
//
// The whole reason `beamCharge` carries an entity ref. In a room the shooter is a remote ghost NOBODY
// simulates locally — its fire group is never ticked, so `g.charge` never advances and there is nothing to
// derive a corridor from. The only thing that can hang the three lines on a hull is a name for the hull.
//
// This asserts the SERVER half: the room really runs lancers when asked, they really charge, and every
// charge crosses the wire with a `shipId` the client was already told about by a `spawn`. The client half
// (that id resolving back to a ghost) is `netsim-world.test.js`; the two together are the wire.
test('a room running pirate lancers emits beamCharge with a shipId the client has been told about', () => {
  const room = createRoom({ levelName: 'level-4', seed: 5, lancer: 'wave-1' });
  const described = new Map();   // network id → the spawn description the client received
  const charges = [];
  // 1600 ticks ≈ 27 s: the wave has to spawn, warp in, close to its standoff and clear the 5 s
  // ENEMY_FIRE_GRACE before the first charge can start.
  for (let i = 0; i < 1600; i++) {
    room.stepOnce();
    const snap = room.takeSnapshot();
    if (!snap) continue;
    for (const sp of snap.spawns || []) described.set(sp.id, sp);
    for (const ev of snap.events || []) if (ev.type === 'beamCharge') charges.push(ev);
  }

  const lancers = [...described.values()].filter((sp) => sp.name === 'pirate lancer');
  assert.ok(lancers.length >= 1,
    `the ?lancer handshake param reached createSimWorld — the room spawned ${lancers.length} lancers `
    + `(described: ${[...described.values()].map((sp) => sp.name).join(', ')})`);

  assert.ok(charges.length >= 1, 'and at least one of them started a charge inside the run');
  for (const ev of charges) {
    assert.equal(ev.fromPlayer, false, 'these are HOSTILE charges — the room flies no player beam');
    assert.ok(ev.shipId != null, 'every hostile charge names its shooter (the gate: DECISIONS §135)');
    const sp = described.get(ev.shipId);
    assert.ok(sp, `shipId ${ev.shipId} was described to the client before it was referenced`);
    assert.equal(sp.name, 'pirate lancer', 'and it resolves to the ship that actually carries the beam');
    assert.equal(ev.dur, 1.0, 'with the telegraph window the sight must fill');
    assert.ok(!JSON.stringify(ev).includes('hitBoxes'), 'an id, never the entity graph');
  }
});

// --- THE OTHER HALF OF "a dev flag must reach the room": ?beam arms the PLAYER ---
//
// The bug this guards, reported from a live flight of `?beam&netsim=level-4&lancer&level=4`: "I have a
// machine gun installed, but I have the aiming dashes and the lock animation". `?beam` was a browser-only
// loadout swap, so the ROOM — which builds the authoritative player — flew the account's real gun while the
// tab drew a green beam sight over it. The sight was telling the truth about the local copy and lying about
// the authority, which is precisely what an aiming line must never do.
test('a room asked for ?beam builds a player whose gun group really IS a beam group', async () => {
  const { isBeamGroup, beamWeaponOf } = await import('../../../client/src/sim-core/beam.js');

  const armed = createRoom({ levelName: 'level-4', seed: 5, beam: true });
  const g = armed.world.player.groups.gun;
  assert.ok(g, 'the player has a gun group at all');
  assert.ok(isBeamGroup(g), 'and it takes the BEAM path, so the room simulates a charge, not a kinetic');
  assert.equal(g.mounts.length, 1, 'still exactly one mount — a beam must never share a group');
  assert.equal(beamWeaponOf(g).id, 12, 'the PLAYER\'s Charged beam (12), never the lancer\'s enemy row (13)');
  assert.equal(beamWeaponOf(g).maxRange, 100, 'with the player\'s reach, not the lancer\'s 67');

  // THE ORDER OF THESE TWO IS LOAD-BEARING — do not swap them. The unflagged room is built AFTER the armed
  // one, in the same process, so this doubles as the catalog-poisoning guard: on the fallback path
  // `buildShip` resolves the loadout to `ship.stats.mounts`, the module-level SEED array, and a swap that
  // mutated in place would leave every later room in the process flying a beam.
  const plain = createRoom({ levelName: 'level-4', seed: 5 });
  assert.ok(!isBeamGroup(plain.world.player.groups.gun),
    'and a room WITHOUT the flag flies the ordinary loadout — the flag is opt-in at every hop, and the '
    + 'armed room above did not poison the shared catalog row');
});

test('?beam reaches the room even when the account lookup gives no loadout', () => {
  // The fallback hole this deliberately closes: `buildShip` falls back to the catalog default when the
  // account row is missing (`ship = {}`), so a swap applied to the account's loadout upstream would have
  // silently done nothing in exactly that case — the same shape of bug as the one being fixed. The swap is
  // therefore applied to the EFFECTIVE loadout inside `buildShip`.
  const room = createRoom({ levelName: 'level-4', seed: 5, ship: {}, beam: true });
  const mounts = room.world.player.groups.gun.mounts;
  assert.equal(mounts[0].weapon.id, 12, 'the catalog-default ship still gets the beam');
});

test('a room asked for NO lancers runs the level exactly as shipped', () => {
  // The dev flag is opt-in at every hop; a room with no `lancer` param must be the shipped fight.
  const room = createRoom({ levelName: 'level-4', seed: 5 });
  const names = new Set();
  for (let i = 0; i < 600; i++) {
    room.stepOnce();
    const snap = room.takeSnapshot();
    for (const sp of (snap && snap.spawns) || []) names.add(sp.name);
  }
  assert.ok(names.size > 0, 'the wave spawned at all');
  assert.ok(!names.has('pirate lancer'), `no lancer without the flag (saw: ${[...names].join(', ')})`);
});

test('an unknown event is dropped, not forwarded raw', () => {
  assert.equal(wireEvent({ type: 'somethingNew', secret: 1 }, () => null), null);
});

test('a bursty client does not build permanent input lag', () => {
  const room = createRoom({ seed: 11 });
  // 60 ticks arrive at once — a client that stalled for a second and caught up in one frame.
  room.pushInput(Array.from({ length: 60 }, (_, i) => ({ t: i, k: [], a: null })));
  for (let i = 0; i < 40; i++) room.stepOnce();
  assert.ok(room.queued <= INPUT_QUEUE_TARGET + 1,
    `the queue drained to ${room.queued}, not left as standing latency`);
  assert.ok(room.caughtUpInputs > 0, 'and it says how many it fast-forwarded');
  assert.equal(room.droppedInputs, 0, 'nothing was lost to the overflow cap — this is catch-up, not loss');
});

test('a client feeding at the natural rate is never fast-forwarded', () => {
  const room = createRoom({ seed: 11 });
  for (let i = 0; i < 200; i++) { room.pushInput([{ t: i, k: [], a: null }]); room.stepOnce(); }
  assert.equal(room.caughtUpInputs, 0, 'no catch-up when there is nothing to catch up on');
  assert.equal(room.queued, 0);
});

test('a run can begin AROUND the ship, not by teleporting it to the arena centre', () => {
  // A mission entered by flying into it is meant to be seamless — the fight starts where you already are.
  // The room placed the ship at the arena centre instead, so the fly-in countdown ended in a teleport.
  const room = createRoom({ levelName: 'level-1', seed: 3 });
  const pose = { x: 240.5, z: -180.25, h: 1.75, vx: 12, vz: -4 };
  room.restart(pose);
  const p = room.world.player;
  assert.equal(p.pos.x, pose.x);
  assert.equal(p.pos.z, pose.z);
  assert.equal(p.heading, pose.h, 'heading kept, so the fight does not open facing +Z');
  assert.equal(p.vel.x, pose.vx, 'and the ship is still moving — it opens mid-flight, as it should');
  assert.equal(p.vel.z, pose.vz);
  assert.equal(room.world.levelRunner.phaseIndex, 0, 'the level script still started from the top');

  // Without a pose it is the ordinary placement at the run centre.
  room.restart();
  assert.notEqual(room.world.player.pos.x, pose.x, 'a plain restart centres the ship as before');
});

test('restart begins a fresh run in the same room', () => {
  const room = createRoom({ seed: 21 });
  for (let i = 0; i < 900; i++) { room.pushInput([{ t: i, k: ['KeyW'], a: null }]); room.stepOnce(); }
  const mid = room.digest().summary;
  assert.ok(mid.enemies > 0 || mid.kills > 0, 'the fight actually got going (guard against an empty assertion)');
  const tickBefore = room.tick;
  const p = room.world.player;
  p.hp = 5; // pretend the run went badly

  room.restart();

  const after = room.digest().summary;
  assert.equal(after.enemies, 0, 'the arena was emptied');
  assert.equal(after.kills, 0, 'and the score reset');
  assert.equal(after.earned, 0);
  assert.equal(room.world.player.hp, room.world.player.maxHp, 'the ship is repaired for the retry');
  assert.equal(room.world.levelRunner.phaseIndex, 0, 'the level script starts over');
  assert.equal(room.queued, 0, 'the old run\'s queued input was dropped');
  // The tick counter deliberately keeps climbing: the client drops any snapshot whose tick is not newer
  // than the last one it applied, so a restart that rewound it would make the whole next run invisible.
  assert.equal(room.tick, tickBefore, 'the tick counter is not rewound');
  room.stepOnce();
  assert.equal(room.tick, tickBefore + 1);
});

test('a mission can be FINISHED in a room — cleared, ended by command, flown home by the room', () => {
  // The gap this closes: an end-of-mission click was applied to the CLIENT's World, which nobody steps in
  // netsim, so drops could not be collected and no mission could ever be completed. The room takes the
  // command — and since DECISIONS §133 the command ENGAGES THE AUTOPILOT rather than winning outright, so
  // the flight home is simulated by the room like everything else.
  const room = createRoom({ levelName: 'level-0', seed: 99 });
  const w = room.world;
  let t = 0;
  const step = () => { room.pushInput([{ t: t++, k: [], a: null }]); room.stepOnce(); };

  for (let i = 0; i < 20000 && !w.levelRunner.cleared; i++) {
    for (const e of w.enemies) if (!e.warping) e.hp = 0; // clear the level without simulating marksmanship
    step();
  }
  assert.equal(w.kills, 4, 'the level was cleared');
  assert.equal(w.earned, 250, 'the reward landed on the clear, not on any arrival (§130)');
  assert.equal(w.levelRunner.won, false, 'but the mission is still open — the player has not ended it');

  room.command({ kind: 'finish' });
  assert.equal(w.levelRunner.finishing, true, 'the button reached the room and SETTLED the mission');
  assert.equal(w.levelRunner.won, false, 'but it is not closed yet — the ship still has to get home');
  assert.equal(w.autopilot.active, true, 'the room is flying it there');
  assert.equal(w.autopilot.target.kind, 'station');

  for (let i = 0; i < 40000 && !w.levelRunner.won; i++) step();
  assert.equal(w.levelRunner.won, true, 'and on arrival the mission closes');
  assert.equal(w.earned, 250, 'the journey pays nothing further');

  // The state the HUD reads has to come back too, or the player cannot see what the ship is doing.
  assert.ok('autopilot' in room.takeSnapshot(), 'the snapshot reports the autopilot');
});

test('…and flying home WITHOUT pressing the button finishes it too', () => {
  // Both ways to end a mission (DECISIONS §132) have to work where the ROOM owns the world, or clicking the
  // station in a netsim run would engage an autopilot that flies to a dock that does nothing.
  const room = createRoom({ levelName: 'level-0', seed: 99 });
  const w = room.world;
  let t = 0;
  const step = () => { room.pushInput([{ t: t++, k: [], a: null }]); room.stepOnce(); };
  for (let i = 0; i < 20000 && !w.levelRunner.cleared; i++) {
    for (const e of w.enemies) if (!e.warping) e.hp = 0;
    step();
  }
  assert.ok(w.station.active, 'a cleared sector opens the station');

  room.command({ kind: 'station' });
  assert.equal(w.autopilot.active, true, 'the click reached the room');
  assert.equal(w.autopilot.target.kind, 'station');

  for (let i = 0; i < 40000 && !w.levelRunner.won; i++) step();
  assert.equal(w.levelRunner.won, true, 'the ship flew home and docked — the mission is COMPLETABLE that way');
  assert.equal(w.earned, 250, 'worth exactly what the button would have paid');
});

test('a room refuses to end a mission that is not cleared — no walking out with the credits', () => {
  const room = createRoom({ levelName: 'level-0', seed: 99 });
  const w = room.world;
  room.pushInput([{ t: 0, k: [], a: null }]); room.stepOnce();
  w.earned = 500;                                   // mid-fight, with something worth leaving with

  room.command({ kind: 'finish' });
  assert.equal(w.levelRunner.finishing, false, 'refused: the sector is not cleared');
  assert.equal(w.levelRunner.won, false);
  assert.equal(w.autopilot.active, false, 'and it did not quietly fly the player out of the fight');
  assert.equal(room.banked, false, 'and nothing was banked');
});

test('ending a mission sweeps the crates still on the field into the run', () => {
  const room = createRoom({ levelName: 'level-0', seed: 99 });
  const w = room.world;
  let t = 0;
  const step = () => { room.pushInput([{ t: t++, k: [], a: null }]); room.stepOnce(); };
  for (let i = 0; i < 20000 && !w.levelRunner.cleared; i++) {
    for (const e of w.enemies) if (!e.warping) e.hp = 0;
    step();
  }
  const before = w.pendingLoot.length;
  // One crate a long way off, plus whatever the fight itself left lying about — all of it unreachable in
  // the flight-home window this replaced, and the point of sweeping at all.
  w.drops.push({ pos: { x: 900, y: 0.8, z: 900 }, item: { kind: 'component', refId: 12 },
                 weight: 1, inRange: 0, special: false, alive: true });
  const onField = w.drops.filter((d) => !d.special).length;
  assert.ok(onField >= 1);

  room.command({ kind: 'finish' });
  assert.equal(w.drops.length, 0, 'the field is cleared');
  assert.equal(w.pendingLoot.length, before + onField, 'and every depositable crate went into the run');
});

test('a drop is claimed by its network id, and a stale id is harmless', () => {
  const room = createRoom({ levelName: 'level-0', seed: 5 });
  room.command({ kind: 'drop', id: 999999 });      // nothing by that id
  assert.equal(room.world.autopilot.active, false, 'an unknown drop id does nothing rather than throwing');
  room.command({ cancel: true });
  assert.equal(room.world.autopilot.active, false);
  room.command(null);                               // malformed
  room.command({ kind: 'nonsense' });
  assert.equal(room.world.autopilot.active, false, 'and neither does a malformed command');
});

test('the Grab collects, and the snapshot reports what was collected', () => {
  const room = createRoom({ levelName: 'level-1', seed: 7 });
  const w = room.world;
  assert.ok(w.player.grab, 'the ship the room built has a Grab at all');
  let t = 0;
  const step = () => { room.pushInput([{ t: t++, k: [], a: null }]); room.stepOnce(); };
  for (let i = 0; i < 30000 && !w.levelRunner.returningToBase; i++) {
    for (const e of w.enemies) if (!e.warping) e.hp = 0;
    step();
  }
  assert.ok(w.drops.length > 0, 'the run left crates on the field');

  // Click one, the way the client does — by the network id from its spawn description.
  let id = null;
  for (const sp of room.takeSnapshot().spawns) if (sp.kind === 'drop') id = sp.id;
  assert.ok(id != null, 'a crate is addressable by network id');
  const before = w.drops.length;
  room.command({ kind: 'drop', id });
  assert.equal(w.autopilot.target.kind, 'drop', 'the click reached the room');
  for (let i = 0; i < 8000 && w.drops.length === before; i++) step();
  assert.equal(w.drops.length, before - 1, 'the Grab pulled it in and collected it');

  // Non-special loot is reported so the client can bank it at the victory screen.
  const collectedNormal = w.pendingLoot.length > 0;
  assert.deepEqual(room.takeSnapshot().run.loot, w.pendingLoot.map((i) => ({ kind: i.kind, refId: i.refId })));
  if (!collectedNormal) {
    // The reward crate is `special`: cosmetic, deposits nothing — the real copy is installed on victory.
    assert.equal(w.pendingLoot.length, 0, 'a special reward deposits nothing, by design');
  }
});

test('a client that goes quiet lets go of the controls', async () => {
  // Repeating the last input across a gap is right for one late packet and wrong for a client that has
  // stopped talking. A browser renders nothing in a hidden tab, so a player who switched tabs mid-flight
  // had the room fly their ship on a held thruster until it left the arena — and since the room no longer
  // pauses for a hidden tab (that pause was itself the source of a day of freeze reports), this is what
  // stands between "you are still in the fight" and "your ship flew into the wall while you were away".
  const room = createRoom({ levelName: 'level-0', seed: 4242 });
  for (let i = 0; i < 60; i++) { room.pushInput([{ t: i, k: ['KeyW'], a: null }]); room.stepOnce(); }
  const flying = room.world.player.vel.length();
  assert.ok(flying > 5, `the ship really was under thrust (${flying.toFixed(1)} u/s)`);

  // Now silence. Well inside the hold, the ship must still be flying — one late packet is not letting go.
  for (let i = 0; i < INPUT_HOLD_TICKS - 5; i++) room.stepOnce();
  assert.ok(room.world.player.vel.length() > flying * 0.8,
    'a short gap holds the controls, so a dropped packet does not stutter a held key');

  // Past it, the controls are released and the ship coasts down on its own drag.
  for (let i = 0; i < 300; i++) room.stepOnce();
  const coasted = room.world.player.vel.length();
  assert.ok(coasted < flying * 0.2, `it let go and coasted (${flying.toFixed(1)} → ${coasted.toFixed(1)} u/s)`);
});

// ---------- The room banks its own run (DECISIONS §131) ----------
//
// The point of a server-run room is that nothing about the reward has to be taken on the client's word.
// These assert the room reports what IT simulated, once, and stays out of the database while doing it.

// A room parked one tick away from clearing: the arena is empty and the win phase's delay has run out.
function roomAtTheEnd(onEconomy) {
  const room = createRoom({ levelName: 'level-1', seed: 7, onEconomy });
  const w = room.world;
  const lr = w.levelRunner;
  lr.phaseIndex = w.catalog.level.phases.length - 1;   // the `event: 'win'` phase
  lr.winPending = 0;
  w.enemies.length = 0;
  w.earned = 300; w.earnedXp = 90; w.kills = 14;
  return room;
}

test('a cleared run is reported once, with the figures the ROOM simulated', () => {
  const seen = [];
  const room = roomAtTheEnd((r) => seen.push(r));
  room.world.pendingLoot.push({ kind: 'component', refId: 12 }, { kind: 'weapon', refId: 5 });

  for (let i = 0; i < 5; i++) room.stepOnce();

  assert.equal(seen.length, 1, 'exactly one payout');
  const r = seen[0];
  assert.equal(r.kind, 'cleared');
  assert.equal(r.credits, 600, 'the doubled credits the simulation decided (§130), not anything a client said');
  assert.equal(r.xp, 90 + LEVELS.find((l) => l.name === 'level-1').descriptor.xpReward);
  assert.equal(r.kills, 14);
  assert.deepEqual(r.loot, [{ kind: 'component', refId: 12 }, { kind: 'weapon', refId: 5 }]);
  assert.ok(r.durationMs > 0, 'and how long the run took, from the room\'s own tick count');
  assert.equal(room.banked, true);
});

test('a death pays what was earned before it, and loses the crates still in the hold', () => {
  const seen = [];
  const room = createRoom({ levelName: 'level-1', seed: 7, onEconomy: (r) => seen.push(r) });
  room.world.earned = 120; room.world.earnedXp = 40; room.world.kills = 5;
  room.world.pendingLoot.push({ kind: 'component', refId: 12 });
  room.world.player.hp = -1;                      // killed by the next tick's death check
  for (let i = 0; i < 3; i++) room.stepOnce();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'death');
  assert.equal(seen[0].credits, 120, 'undoubled — nothing was cleared');
  assert.deepEqual(seen[0].loot, [], 'dying with loot in the hold loses it');
});

test('a run that just STOPS is worth nothing — no clear, no death, no payout', () => {
  const seen = [];
  const room = createRoom({ levelName: 'level-1', seed: 7, onEconomy: (r) => seen.push(r) });
  room.world.earned = 400;
  for (let i = 0; i < 120; i++) room.stepOnce();   // two seconds of ordinary fighting, then the tab closes
  assert.equal(seen.length, 0, 'an abandoned run banks nothing, exactly as single-player has always done');
  assert.equal(room.banked, false);
});

test('a retry re-arms the payout, and its duration starts over', () => {
  const seen = [];
  const room = roomAtTheEnd((r) => seen.push(r));
  for (let i = 0; i < 5; i++) room.stepOnce();
  assert.equal(seen.length, 1);
  const firstDuration = seen[0].durationMs;

  room.restart();
  assert.equal(room.banked, false, 'the second fight in this room must be payable');
  const w = room.world;
  w.levelRunner.phaseIndex = w.catalog.level.phases.length - 1;
  w.levelRunner.winPending = 0;
  w.enemies.length = 0; w.earned = 50; w.earnedXp = 10; w.kills = 2;
  for (let i = 0; i < 5; i++) room.stepOnce();

  assert.equal(seen.length, 2, 'and it pays');
  assert.equal(seen[1].credits, 100);
  assert.ok(seen[1].durationMs < firstDuration + 200, 'the clock restarted rather than kept accumulating');
});

test('a room with no economy hook still runs — the seam is optional, not load-bearing', () => {
  const room = roomAtTheEnd(null);
  for (let i = 0; i < 5; i++) room.stepOnce();
  assert.equal(room.world.levelRunner.cleared, true, 'the fight concluded regardless');
  assert.equal(room.banked, false);
});
