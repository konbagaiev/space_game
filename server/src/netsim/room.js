// A room: one server-run fight. One World, stepped by the server, fed by a client's input.
//
// The room is deliberately **clock-free**. `stepOnce()` advances exactly one tick and `takeSnapshot()`
// builds one message; who calls them and how often is somebody else's problem (`driver.js` owns the 60 Hz
// interval, a test owns a for-loop). That split is not tidiness — a room that stepped itself on a timer
// could only be tested by waiting on the wall clock, and a scenario that waits on the wall clock is
// asserting something about the CPU, not about the game. It is also what lets `room.test.js` feed the
// canonical Level-0 input trace through a room and require the SAME digest the headless referee produces:
// a room that is not bit-identical to `runTrace` is not the same simulation.
//
// What the room adds on top of `sim-core`:
//   • network ids for entities, assigned through the World's HOST — the hook that exists precisely for
//     "what does an entity mean to this host". Ids live in a WeakMap, so nothing is written onto a sim
//     entity and the world digest is untouched.
//   • an input queue, so a client that is ahead, behind or briefly silent still produces one input per
//     tick, in order.
//   • snapshots: transforms, run state, and the events drained since the last one.
//
// Non-goals for this cut (docs/plans/server-authoritative-sim.md §6): several players, reconnect, delta
// encoding, and the sealed economy — a netsim run still banks through the client's own `POST /api/games`.
import { createSimWorld } from '../sim-host.js';
import { clearAndPlaceRun, startRun } from '../../../client/src/sim-core/reset-world.js';
import { simTick } from '../../../client/src/sim-core/tick.js';
import { worldDigest } from '../../../client/src/sim-core/digest.js';
import { SIM_DT } from '../../../client/src/sim-core/consts.js';
import { applyInput } from '../../../client/src/replay.js';
import { wireEvent } from './protocol.js';

// Ticks between snapshots. 4 → 15 Hz at TICK_HZ 60. The SIM rate is not negotiable across hosts
// (DECISIONS §118); the SNAPSHOT rate is the knob that actually costs bandwidth and is tuned on its own.
export const SNAPSHOT_EVERY = 4;

// How many unconsumed inputs a room will hold — 4 s at 60 Hz. Past this the OLDEST are dropped: a client
// that floods must not be able to grow the server's memory, and stale input is the least useful input.
export const MAX_QUEUED_INPUTS = 240;

// How deep the input queue is allowed to sit before the room starts catching up.
//
// The room consumes exactly one input per tick and the client produces about sixty a second, so the two
// are balanced ONLY on average. Any burst — a slow client frame emits up to six ticks at once — leaves a
// backlog that never drains, because the room has no way to go faster. Every later input then waits
// `queue.length` ticks before it is simulated, which the player feels as input latency stacked on top of
// the interpolation delay: measured at 8–11 ticks (130–180 ms) after a minute of ordinary play.
//
// So while the queue is deeper than this, a tick retires two inputs instead of one. The skipped input's
// dt is never simulated — that is the point, it is a fast-forward — which is invisible for held keys and
// bounds the queueing delay at ~3 ticks (50 ms). It also means a live room is NOT bit-identical to a trace
// replay when the client is bursty, which is correct and is why `stepOnce` only does it when behind.
export const INPUT_QUEUE_TARGET = 3;

const EMPTY_INPUT = { k: [], t: null };

export function createRoom({ levelName = 'level-0', seed = 1, ship = {}, snapshotEvery = SNAPSHOT_EVERY } = {}) {
  const ids = new WeakMap();   // entity → network id. WeakMap: the sim never learns it has one.
  let nextId = 1;
  const spawnQueue = [];       // static descriptions of entities the client has not been told about yet

  const host = {
    onSpawn(kind, e) {
      const id = nextId++;
      ids.set(e, id);
      spawnQueue.push(describe(kind, id, e));
    },
    onDespawn(kind, e) { ids.delete(e); },
    onWarmLevel() {}, // a server parses no models
  };

  const world = createSimWorld({ levelName, seed, ship, host });

  const queue = [];            // pending client input snapshots, oldest first
  let lastInput = EMPTY_INPUT; // repeated when the client is silent: a gap holds the controls, never drops them
  let ack = null;              // the client tick of the most recently applied input
  let tick = 0;                // server ticks stepped
  let pendingEvents = [];      // drained since the last snapshot
  let dropped = 0;             // inputs discarded by the queue cap (a diagnostic, reported in the snapshot)
  let caughtUp = 0;            // inputs fast-forwarded to keep the queue shallow (a diagnostic)

  const idOf = (e) => ids.get(e) ?? null;

  // The static half of an entity: what it IS, sent once. Everything that changes goes in the per-tick rows.
  //
  // A ship is named, not described. The client holds the same catalog (it fetches `/api` at boot), so it
  // resolves the model, the yaw, the lift and the scale from the NAME itself — and the fields it would
  // otherwise be sent include `hitBoxes`, dozens of oriented boxes per hull. That is collision geometry the
  // server alone uses in a netsim room; putting it on the wire would be tens of kilobytes of the server's
  // internals, repeated. `room.test.js` asserts no snapshot ever carries it.
  function describe(kind, id, e) {
    if (kind === 'enemy') {
      return { id, kind, name: e.name, shipClass: e.class, color: e.color,
               fullScale: e.fullScale, maxHp: e.maxHp, role: e.role, sizeScale: e.sizeScale };
    }
    // A projectile's LOOK travels with it: `projectileColor` + `class` decide whether the client draws the
    // weapon's bolt or an untinted dot, and `lead`/`spiralOf` decide whether a rocket has a mesh at all
    // (a spiral volley's leader is invisible). The birth POSITION rides along too — a bullet lives well
    // under a second, so waiting for the next snapshot row to place it is a visible pop.
    if (kind === 'bullet') {
      return { id, kind, projectileColor: e.projectileColor, class: e.class, fromPlayer: e.fromPlayer,
               x: e.pos.x, z: e.pos.z, vx: e.vel.x, vz: e.vel.z };
    }
    if (kind === 'rocket') {
      return { id, kind, projectileColor: e.projectileColor, weaponClass: e.weaponClass,
               fromPlayer: e.fromPlayer, lead: !!e.lead, spiralOf: !!e.spiralOf,
               x: e.pos.x, z: e.pos.z, h: e.heading };
    }
    if (kind === 'drop') return { id, kind, item: e.item, special: !!e.special };
    return { id, kind };
  }

  return {
    world,
    get tick() { return tick; },
    get queued() { return queue.length; },
    get droppedInputs() { return dropped; },
    get caughtUpInputs() { return caughtUp; },

    // Accept a batch of per-tick input snapshots, `replay.js snapshotInput()` shape plus the client's tick.
    pushInput(ticks) {
      for (const t of ticks || []) {
        queue.push({ t: t.t ?? null, k: t.k || [], a: t.a || null });
        if (queue.length > MAX_QUEUED_INPUTS) { queue.shift(); dropped++; }
      }
    },

    // Exactly one tick. Consumes one queued input, or repeats the last one if the client is silent —
    // holding the controls rather than dropping them, which is what a brief network gap should feel like.
    // While the queue has grown past INPUT_QUEUE_TARGET it retires an extra one, so a burst cannot become
    // permanent input lag.
    stepOnce() {
      while (queue.length > INPUT_QUEUE_TARGET + 1) {
        const skipped = queue.shift();
        lastInput = skipped; ack = skipped.t; caughtUp++;
      }
      const next = queue.shift();
      if (next) { lastInput = next; ack = next.t; }
      // `applyInput` takes the recorded tick shape: `{ k, t }` where `t` is the touch aim.
      applyInput({ k: lastInput.k, t: lastInput.a }, world.input.keys, world.input.touchAim);
      simTick(world, SIM_DT);
      world.events.drain((ev) => { const w = wireEvent(ev, idOf); if (w) pendingEvents.push(w); });
      tick++;
      return tick;
    },

    // Whether this tick should carry a snapshot. Kept here so the driver and the tests agree.
    dueForSnapshot() { return tick % snapshotEvery === 0; },

    // The downstream message. Column order is documented in protocol.js COLUMNS.
    takeSnapshot() {
      const p = world.player;
      const spawns = spawnQueue.splice(0, spawnQueue.length);
      const events = pendingEvents; pendingEvents = [];
      const lr = world.levelRunner;
      return {
        type: 'snap',
        tick, ack, dropped,
        spawns,
        player: {
          x: p.pos.x, y: p.pos.y, z: p.pos.z, h: p.heading, sc: p.scale,
          hp: p.hp, maxHp: p.maxHp, sh: p._shieldValue, alive: p.alive,
          thrust: !!p.thrusting, oob: p.oobTime,
          vx: p.vel.x, vz: p.vel.z, // the client extrapolates between snapshots; velocity is what it needs
        },
        enemies: world.enemies.map((e) => [idOf(e), e.pos.x, e.pos.z, e.heading, e.hp, e.scale, e.warping ? 1 : 0]),
        bullets: world.bullets.map((b) => [idOf(b), b.pos.x, b.pos.z]),
        rockets: world.rockets.map((r) => [idOf(r), r.pos.x, r.pos.z, r.heading]),
        drops:   world.drops.map((d) => [idOf(d), d.pos.x, d.pos.z]),
        arena: { x: world.arenaCenter.x, z: world.arenaCenter.z },
        run: {
          kills: world.kills, enemyTotal: world.enemyTotal,
          earned: world.earned, earnedXp: world.earnedXp,
          won: lr.won, returning: lr.returningToBase, phase: lr.phaseIndex,
          stationActive: !!(world.station && world.station.active),
        },
        events,
      };
    },

    // Start the run over in the SAME World — a retry, or the next level's fight after an advance. Cheaper
    // and less disruptive than a reconnect: the socket, the ids and the tick counter all keep going, and
    // the client's reconciliation heals itself because every old entity simply stops being listed.
    //
    // The seeded stream is deliberately NOT re-seeded: it carries on, which is what live play does (an
    // unseeded run draws from Math.random). Re-seeding would make every retry identical.
    restart() {
      clearAndPlaceRun(world);
      startRun(world);
      queue.length = 0; lastInput = EMPTY_INPUT; ack = null;
      pendingEvents = [];
      return tick;
    },

    // Sent once on join: everything static about this fight.
    welcome() {
      return {
        type: 'welcome',
        tick, dt: SIM_DT, snapshotEvery,
        level: world.catalog.levelName,
        enemyTotal: world.enemyTotal,
        station: world.station ? { x: world.station.pos.x, y: world.station.pos.y, z: world.station.pos.z } : null,
        arena: { x: world.arenaCenter.x, z: world.arenaCenter.z },
      };
    },

    // For the tests and the divergence oracle — a room must be bit-identical to the referee.
    digest() { return worldDigest(world); },
  };
}
