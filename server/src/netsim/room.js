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
// **The room banks its own runs** (DECISIONS §131). It simulated the fight, so it knows what the run was
// worth without asking anyone: when the simulation says `cleared` or `death`, the room reports the totals
// through `onEconomy` and the socket writes them under the playerId it took from the handshake TICKET.
// Nothing in that path came from the client. The room itself stays free of the database — it reports, it
// does not persist — which is what keeps it unit-testable with a spy and clock-free.
//
// Non-goals for this cut (docs/plans/server-authoritative-sim.md §6): several players, reconnect, delta
// encoding. Campaign PROGRESSION (`/advance`) is still the client's call — it is not currency, and it has
// to reload the next level into the tab either way.
import { createSimWorld } from '../sim-host.js';
import { clearAndPlaceRun, startRun } from '../../../client/src/sim-core/reset-world.js';
import { simTick } from '../../../client/src/sim-core/tick.js';
import { worldDigest } from '../../../client/src/sim-core/digest.js';
import { SIM_DT } from '../../../client/src/sim-core/consts.js';
import { applyInput } from '../../../client/src/replay.js';
import { engageAutopilot, engageDropAutopilot, engagePointAutopilot, cancelAutopilot }
  from '../../../client/src/sim-core/step-player.js';
import { finishMission } from '../../../client/src/sim-core/level-runner.js';
import { wireEvent } from './protocol.js';

// Ticks between snapshots. 2 → 30 Hz at TICK_HZ 60. The SIM rate is not negotiable across hosts
// (DECISIONS §118); the SNAPSHOT rate is the knob that actually costs bandwidth and is tuned on its own.
//
// It was 4 (15 Hz), and that is too coarse for the one thing linear interpolation is bad at: a curve. A
// small enemy swinging its nose to track the player had its rotation drawn as fifteen straight segments a
// second, each ending in a step of up to 3.5° in a single frame, which is exactly what the maintainer
// reported seeing. The error scales with the interval, so halving it halves the step — and it buys back the
// delay too, since three snapshot intervals of buffer is 100 ms at 30 Hz where it would be 200 at 15.
// Bandwidth is not the constraint at one player per room; the alternative (splining the samples) needs
// velocity on the wire and is not shipped by any comparable library.
export const SNAPSHOT_EVERY = 2;

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

// How long the last input is repeated when the client goes quiet.
//
// Repeating it at all is right for the gap a dropped packet leaves — a held key must not stutter because
// one message was late. It is wrong for a client that has stopped talking altogether: a browser renders
// nothing in a hidden tab, so a player who switched tabs mid-flight had the room fly their ship on a held
// thruster until it left the arena. Half a second is far more than any packet gap and far less than a
// pause a human would notice; past it the controls are simply released and the ship coasts to a stop on
// its own drag, which is what letting go looks like.
export const INPUT_HOLD_TICKS = 30;

export function createRoom({ levelName = 'level-0', seed = 1, ship = {}, snapshotEvery = SNAPSHOT_EVERY,
                             onEconomy = null, ally = null, lancer = null, beam = false } = {}) {
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

  const world = createSimWorld({ levelName, seed, ship, host, ally, lancer, beam });

  const queue = [];            // pending client input snapshots, oldest first
  let lastInput = EMPTY_INPUT; // repeated across a short gap: one late packet must not stutter a held key
  let sinceInput = 0;          // ticks since a real one arrived — past INPUT_HOLD_TICKS the controls let go
  let ack = null;              // the client tick of the most recently applied input
  let tick = 0;                // server ticks stepped
  let pendingEvents = [];      // drained since the last snapshot
  let dropped = 0;             // inputs discarded by the queue cap (a diagnostic, reported in the snapshot)
  let caughtUp = 0;            // inputs fast-forwarded to keep the queue shallow (a diagnostic)
  let grabTarget = null;       // the crate the Grab is pulling this tick, so the client can draw its beam
  let banked = false;          // this run's reward has been reported — exactly once, whatever else happens
  let salvaged = false;        // …and the end-of-mission salvage sweep, likewise once
  let runStartTick = 0;        // for the run's duration; `restart()` re-stamps it

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
    // The WINGMAN. Same shape as an enemy minus the role — the client resolves the model from the NAME plus
    // the catalog it already has (it builds the ghost through the very same `makeAlly`); only the COLOUR is
    // extra, because his livery is the one thing that separates three ships sharing one silhouette.
    if (kind === 'ally') {
      return { id, kind, name: e.name, shipClass: e.class, color: e.color,
               fullScale: e.fullScale, maxHp: e.maxHp, sizeScale: e.sizeScale };
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
    // WITH its position: a crate described without one is born at the world origin and, since drops only
    // move while being pulled, the client drew it there — metres from where the room actually had it. That
    // is why clicking a crate sent the ship somewhere else entirely.
    if (kind === 'drop') return { id, kind, item: e.item, special: !!e.special, x: e.pos.x, z: e.pos.z };
    return { id, kind };
  }

  // What the run was worth, reported ONCE, off the simulation's own verdict.
  //
  // Two moments end a run and both pay what was earned up to them: `cleared` (the win condition held — the
  // credits are already doubled and the mission XP added, see DECISIONS §130) and `death` (whatever the
  // pilot banked before dying, exactly as the browser has always done). Whichever comes first wins; the
  // `banked` guard is what makes a reconnect, a late duplicate event or a second death unable to pay twice.
  //
  // A run that simply STOPS — a disconnect, an abandoned tab — reports nothing and is worth nothing, which
  // is the same rule single-player has always had for closing the browser mid-fight.
  function reportEconomy(ev) {
    if (!onEconomy) return;
    // The salvage sweep happens when the player ENDS the mission, which is after `cleared` has already been
    // reported — so those crates need a report of their own or they would never reach the stash in a room.
    // No money rides on it: the run was paid at `cleared`.
    if (ev.type === 'finishing' && !salvaged) {
      salvaged = true;
      const loot = world.pendingLoot.map((it) => ({ kind: it.kind, refId: it.refId }));
      if (loot.length) onEconomy({ kind: 'salvage', credits: 0, xp: 0, kills: world.kills, durationMs: 0, loot });
      return;
    }
    if (banked) return;
    if (ev.type !== 'cleared' && ev.type !== 'death') return;
    banked = true;
    onEconomy({
      kind: ev.type,
      credits: world.earned,
      xp: world.earnedXp,
      kills: world.kills,
      durationMs: Math.round((tick - runStartTick) * SIM_DT * 1000),
      // Crates reach the stash only on a CLEARED run — dying with them still in the hold loses them, which
      // is what the browser does and the one bit of the flight home that is still a stake.
      loot: ev.type === 'cleared' ? world.pendingLoot.map((it) => ({ kind: it.kind, refId: it.refId })) : [],
    });
  }

  return {
    world,
    get tick() { return tick; },
    // Whether this run has already been paid. A diagnostic, and what the tests assert on.
    get banked() { return banked; },
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
      if (next) { lastInput = next; ack = next.t; sinceInput = 0; } else sinceInput++;
      // Held across a short gap, released across a long one. A client that has gone quiet is not flying.
      const applied = sinceInput > INPUT_HOLD_TICKS ? EMPTY_INPUT : lastInput;
      // `applyInput` takes the recorded tick shape: `{ k, t }` where `t` is the touch aim.
      applyInput({ k: applied.k, t: applied.a }, world.input.keys, world.input.touchAim);
      // simTick hands back whatever the Grab is pulling — presentation only, but only the room knows it.
      grabTarget = simTick(world, SIM_DT);
      tick++;
      // Every event is stamped with the tick it happened on. The client draws the whole world at
      // `renderTick − delay`, so an event played when its PACKET lands fires against a picture a tenth of a
      // second younger than the thing it describes — a rocket's smoke laid ahead of the rocket, a hit spark
      // before the ship reaches the pose it was hit in. With the stamp it simply rides the same clock.
      world.events.drain((ev) => {
        const w = wireEvent(ev, idOf); if (w) { w.tk = tick; pendingEvents.push(w); }
        reportEconomy(ev);
      });
      return tick;
    },

    // Whether this tick should carry a snapshot. Kept here so the driver and the tests agree.
    dueForSnapshot() { return tick % snapshotEvery === 0; },

    // The downstream message. Column order is documented in protocol.js COLUMNS.
    takeSnapshot() {
      const p = world.player;
      const spawns = spawnQueue.splice(0, spawnQueue.length);
      // What the Grab is currently pulling. Only the room knows — the client never runs stepDrops — and
      // without it the blue pull beam simply never drew.
      const grabId = grabTarget ? (ids.get(grabTarget) ?? null) : null;
      const events = pendingEvents; pendingEvents = [];
      const lr = world.levelRunner;
      return {
        type: 'snap',
        tick, ack, dropped,
        spawns,
        player: {
          x: p.pos.x, y: p.pos.y, z: p.pos.z, h: p.heading, sc: p.scale,
          hp: p.hp, maxHp: p.maxHp, sh: p._shieldValue, alive: p.alive,
          // The seconds banked toward the next recharge. The HUD's PURPLE fill is this over `rechargeSec`,
          // so without it a broken shield showed an empty bar that never filled.
          shr: p._shieldRechargeAccum,
          thrust: !!p.thrusting, oob: p.oobTime,
          vx: p.vel.x, vz: p.vel.z, // the client extrapolates between snapshots; velocity is what it needs
          // Fire-group cooldowns, keyed by group name. The ROOM owns them — the client never advances its
          // own ship's groups in a room — so without this the HUD's rocket dial sat at 0 and the button
          // read "ready" the whole fight. Clamped at 0 because `updateGroups` keeps subtracting past zero,
          // and an unbounded negative on the wire says nothing the HUD does not already read as ready.
          cd: Object.fromEntries(Object.entries(p.groups).map(([k, g]) => [k, Math.max(0, g.cooldown)])),
        },
        // …plus the shield pools. Neither was sent, so an enemy's blue strip sat at full for its whole life
        // and its purple recharge fill never moved: the client's ghost kept the values it was BORN with.
        enemies: world.enemies.map((e) => [idOf(e), e.pos.x, e.pos.z, e.heading, e.hp, e.scale,
                                           e.warping ? 1 : 0, e._shieldValue, e._shieldRechargeAccum]),
        // …and the friendly ship that is not the player, in the SAME column order as `enemies` so the
        // client's row reader is the same code. Empty in every level that ships today.
        allies: world.allies.map((a) => [idOf(a), a.pos.x, a.pos.z, a.heading, a.hp, a.scale,
                                         a.warping ? 1 : 0, a._shieldValue, a._shieldRechargeAccum]),
        bullets: world.bullets.map((b) => [idOf(b), b.pos.x, b.pos.z]),
        rockets: world.rockets.map((r) => [idOf(r), r.pos.x, r.pos.z, r.heading]),
        drops:   world.drops.map((d) => [idOf(d), d.pos.x, d.pos.z]),
        arena: { x: world.arenaCenter.x, z: world.arenaCenter.z },
        grab: grabId,
        run: {
          kills: world.kills, enemyTotal: world.enemyTotal,
          earned: world.earned, earnedXp: world.earnedXp,
          won: lr.won, returning: lr.returningToBase, phase: lr.phaseIndex,
          stationActive: !!(world.station && world.station.active),
          // What the Grab has picked up this run. The room holds it, but the CLIENT is still the one that
          // banks a victory (sealing the economy is a later slice), and it deposits from its own
          // `world.pendingLoot` — which nothing was filling, so every crate collected in a room was lost.
          loot: world.pendingLoot.map((it) => ({ kind: it.kind, refId: it.refId })),
        },
        // What the ship is being flown to, if anything — the roam nav buttons and the return-to-base HUD
        // read it, and only the room knows.
        autopilot: { active: world.autopilot.active, phase: world.autopilot.phase,
                     kind: world.autopilot.target ? world.autopilot.target.kind : null },
        events,
      };
    },

    // Click-to-fly is a COMMAND, not input: the player clicks the station, a loot crate, or a point on the
    // map, and the ship flies there. It reaches the room as its own message because the room owns the
    // autopilot — a client that set its own `world.autopilot` was talking to a World nobody simulates, which
    // is why the station could not be clicked, drops could not be collected, and a mission could not be
    // FINISHED at all (winning requires docking under an engaged station autopilot).
    //
    // A drop is named by its network id, since that is the only handle the client has on a server entity.
    command(cmd) {
      if (!cmd || typeof cmd !== 'object') return;
      if (cmd.cancel) return cancelAutopilot(world);
      // "Finish and Return" — the player ending a cleared run (DECISIONS §132/§133). It is a command for
      // the same reason click-to-fly is: the ROOM owns the world, and a client that ended the mission in a
      // World nobody simulates would end nothing. `finishMission` refuses unless the sector is actually
      // cleared, so this cannot be used to walk out of a live fight with the credits — and it engages the
      // autopilot rather than winning outright, so the ship flies home under the room's own simulation.
      if (cmd.kind === 'finish') return finishMission(world);
      if (cmd.kind === 'station') return engageAutopilot(world);
      if (cmd.kind === 'point' && cmd.pos) return engagePointAutopilot(world, cmd.pos, cmd.mission || null);
      if (cmd.kind === 'drop') {
        // Resolve the id back to the live entity; a crate collected in the meantime simply no-ops.
        for (const d of world.drops) if (ids.get(d) === cmd.id) return engageDropAutopilot(world, d);
      }
    },

    // Start the run over in the SAME World — a retry, or the next level's fight after an advance. Cheaper
    // and less disruptive than a reconnect: the socket, the ids and the tick counter all keep going, and
    // the client's reconciliation heals itself because every old entity simply stops being listed.
    //
    // The seeded stream is deliberately NOT re-seeded: it carries on, which is what live play does (an
    // unseeded run draws from Math.random). Re-seeding would make every retry identical.
    // `pose` = start the run WITHOUT moving the ship, from exactly where the client's ship already is. A
    // mission entered by flying into it is meant to be seamless: the fight begins around you. Placing the
    // ship at the arena centre instead turned the fly-in countdown into a teleport.
    restart(pose = null) {
      clearAndPlaceRun(world);
      if (pose) {
        world.player.pos.set(pose.x, world.player.pos.y, pose.z);
        world.player.heading = pose.h;
        world.player.vel.set(pose.vx || 0, 0, pose.vz || 0);
      }
      startRun(world, { keepPlayer: !!pose });
      queue.length = 0; lastInput = EMPTY_INPUT; ack = null; sinceInput = 0;
      pendingEvents = [];
      // A retry is a NEW run: re-arm the payout and re-stamp the clock, or the second fight in this room
      // would be worth nothing and the first one's duration would keep growing.
      banked = false; salvaged = false; runStartTick = tick;
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
