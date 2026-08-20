// Writing a server room's snapshots into THIS tab's World.
//
// The idea that makes netsim cheap: the client does not grow a second rendering path for "remote" ships. It
// keeps the same World it always had, with the same host attaching the same Three.js bodies — only now the
// World is written by the NETWORK instead of by `simTick`. Everything downstream is unchanged and unaware:
// `syncMeshes`, the HUD, the health bars, the markers, the mini-map, and the event adapter all read exactly
// what they read in single-player.
//
// Two consequences worth stating, because they are the whole design:
//   • entities arrive through `world.host.onSpawn` / `onDespawn`, the same lifecycle the simulation uses,
//     so a networked enemy gets its mesh by the same code path a local one does;
//   • wire events are pushed onto `world.events`, so the network becomes just another producer of the
//     event stream `sim.js`'s adapter already drains into FX, audio and the HUD.
//
// **Interpolation, and why it is not optional.** Snapshots arrive at 15 Hz and frames render at 60. Drawing
// the newest snapshot each frame would show four identical frames then a jump. So this keeps a short
// history and renders the world as it was `INTERP_DELAY_MS` ago, between the two snapshots that bracket
// that moment. The cost is that everything on screen — including your own ship, until Slice E adds
// prediction — is about a tenth of a second stale. That is the mush the plan says to expect and measure.
//
// THREE-free on purpose: this file is unit-testable under `node --test` (netsim-world.test.js), which is
// the only way to get real coverage of reconciliation without a browser.
import { Vec3 } from './sim-core/vec.js';
import { makeEnemyShell } from './sim-core/ship-entity.js';
import { shortestAngleDelta } from './sim-core/steering.js';
import { BULLET_PLANE_Y, SIM_DT } from './sim-core/consts.js';
import { MAX_REPLAY_TICKS } from './netsim-predict.js';

// How far a dead-reckoned projectile may be advanced past its newest sample before it is left alone. If
// snapshots stall, a bullet extrapolated indefinitely flies off across the map and then snaps back.
export const MAX_EXTRAPOLATION_MS = 250;

// How far behind the newest snapshot we render. One snapshot interval (at 15 Hz, ~67 ms) is the minimum
// that can bracket; 100 ms leaves headroom for one late or reordered packet before we run dry.
export const INTERP_DELAY_MS = 100;
// How fast the drawn ship converges on the authoritative one. A time constant, not a fraction, so the
// result is frame-rate independent. Small enough that the ship never feels detached from the server;
// large enough to absorb a snapshot's worth of correction without a visible step.
export const VIEW_TAU_S = 0.08;
// …and a much shorter one while PREDICTING. Smoothing exists to absorb the server disagreeing with us; it
// must not also be smoothing the player's own input, which is already correct the instant it is pressed.
// A predicted pose therefore converges nearly at once, leaving just enough give to ease in a correction.
export const VIEW_TAU_PREDICTED_S = 0.03;

// Finite differences are taken over the SERVER TICK span, never over arrival times. Snapshots arrive in
// bursts — two can land in the same millisecond after a slow frame — and dividing by that gap produced an
// angular velocity in the hundreds of rad/s, which spun the ship through 138 revolutions in one test. The
// tick delta is exact and immune to jitter. `span` is in seconds; a non-positive one means "cannot tell".
const sampleSpan = (a, b) => (b.tick > a.tick ? (b.tick - a.tick) * SIM_DT : 0);

// How much history to keep. Enough to cover the delay several times over, so a burst of jitter cannot
// exhaust it; small enough that it is a handful of objects.
export const MAX_HISTORY = 12;

// ---------- When an event is PLAYED ----------
//
// Events are batched into snapshots, so they arrive on the snapshot grid rather than at the tick they
// happened on. Played on arrival that puts the SNAPSHOT RATE into the game: the starter gun reloads in
// 0.18 s — 10.8 ticks, so the sim fires every 11, dead even — while snapshots go out every 4. The rounding
// error walks 1→2→3→0, and every fourth shot lands a whole snapshot early. Measured gaps between delivered
// shots: **200, 133, 200, 200 ms**, which the ear reads as one shot in four being doubled.
//
// Each event carries the tick it happened on (`tk`, stamped by the room), so the fix is to hold it for
// `budget − (how late it already is)`: it then waits exactly `budget` from its OWN tick and the rhythm
// comes back. The buffer must cover a full snapshot interval or the tail of each batch is still early; the
// room states that interval in the `welcome` (`snapshotEvery`), and this is the fallback for before it
// arrives — 4 ticks at 60 Hz, the room's own default.
export const PLAYER_EVENT_BUFFER_MS = 4 * SIM_DT * 1000;

// ONLY the player's own `fire` is re-timed, and the reason is a rule worth keeping:
//
//   **an event that is ANCHORED to something on screen may not be moved in time, because the client draws
//   different things on different clocks and none of them is the event's.**
//
// This was learned the expensive way. The first cut of this scheduler also held the room's events for
// `INTERP_DELAY_MS`, reasoning that enemies are drawn a tenth of a second in the past so their events
// belong there too. It made rockets stutter, because:
//   • bullets and rockets are drawn in the PRESENT (dead-reckoned), so their `smoke`, `bulletImpact` and
//     `detonate` were suddenly 100 ms behind the object laying them — the trail detached from its rocket;
//   • worse, a ghost DESPAWNS on the arrival clock (`applySnapshot` removes it the moment the room stops
//     listing it) while its farewell FX was being held: the rocket vanished, and a tenth of a second later
//     its blast went off in the empty space it used to be. Same for a killed enemy and its explosion.
// `fire` is the one event with neither a position nor an entity — it is a sound — so moving it in time
// costs nothing and buys back the weapon's rhythm. Everything else plays on arrival, as it always did.
export const eventBudgetMs = (state, ev) => {
  if (ev.type !== 'fire' || !ev.fromPlayer) return 0;
  const every = state.welcome && state.welcome.snapshotEvery;
  return every ? every * SIM_DT * 1000 : PLAYER_EVENT_BUFFER_MS;
};

// A ceiling on the pending queue. A tab that is not rendering — paused, hidden, in a menu — never drains
// it, and an event is worth releasing late but never worth losing. Past the cap the oldest are marked due
// and go out in the next drain, which is exactly what used to happen to every event, always.
export const MAX_EVENT_QUEUE = 512;

export function createNetState() {
  return {
    byId: new Map(),   // network id → the World entity it drives
    idOf: new WeakMap(),// the reverse: a clicked entity → the id the room knows it by
    kinds: new Map(),  // network id → 'enemy' | 'bullet' | 'rocket' | 'drop'
    samples: new Map(),// network id → [{ at, x, z, h, sc, extra }] — newest last
    playerSamples: [], // the same, for the local ship
    grabTarget: null,  // the crate the room's Grab is pulling, so renderTick can draw its beam
    // The DRAWN pose of the local ship, integrated continuously and pulled toward the server's. Kept apart
    // from the samples because it must be a smooth function of real time, not of snapshot arrivals.
    view: null,        // { x, z, h } | null until the first snapshot
    viewAt: 0,         // when `view` was last advanced
    // The newest authoritative player block and the tick it acknowledged — the state client-side
    // prediction re-simulates from (netsim-predict.js).
    playerBlock: null,
    ack: null,
    arena: { x: 0, z: 0 },
    history: [],       // [{ at, tick }] — arrival times, for choosing the render moment
    eventQueue: [],    // [{ due, ev }] — wire events waiting for their moment (see PLAYER_EVENT_BUFFER_MS)
    lastTick: -1,      // newest server tick applied (an out-of-order snapshot is dropped)
    welcome: null,
  };
}

// ---------- Applying a snapshot ----------

// Build the entity a network id refers to, and give it a body through the host — the same call the
// simulation makes, so the browser attaches the same mesh it would for a local spawn.
function spawnGhost(world, desc) {
  let e;
  if (desc.kind === 'enemy') {
    const shipDef = world.catalog.shipByName.get(desc.name);
    if (!shipDef) return null; // an unknown ship name is the server's bug; drawing nothing beats crashing
    e = makeEnemyShell(world.catalog, shipDef);
    e.maxHp = desc.maxHp ?? e.maxHp;
    world.enemies.push(e);
  } else if (desc.kind === 'bullet') {
    // `projectileColor` + `class` are what make a shot look like the weapon that fired it: the class picks
    // its BOLT_SCALE, and without one `attachBulletBody` falls through to a plain untinted dot. That is
    // exactly what a netsim fight looked like before these were carried.
    e = { pos: new Vec3(desc.x ?? 0, BULLET_PLANE_Y, desc.z ?? 0), vel: new Vec3(desc.vx || 0, 0, desc.vz || 0),
          projectileColor: desc.projectileColor, class: desc.class,
          fromPlayer: !!desc.fromPlayer, traveled: 0, alive: true };
    world.bullets.push(e);
  } else if (desc.kind === 'rocket') {
    // `lead` marks the invisible leader of a spiral volley (no mesh at all) and `spiralOf` picks the
    // warhead geometry — both decide what `attachRocketBody` builds, so both have to survive the wire.
    // The launch velocity is what carries it through its first snapshot interval — see below.
    e = { pos: new Vec3(desc.x ?? 0, BULLET_PLANE_Y, desc.z ?? 0),
          vel: new Vec3(desc.vx || 0, 0, desc.vz || 0), heading: desc.h || 0,
          projectileColor: desc.projectileColor, weaponClass: desc.weaponClass,
          lead: !!desc.lead, spiralOf: desc.spiralOf ? true : undefined,
          fromPlayer: !!desc.fromPlayer, alive: true };
    world.rockets.push(e);
  } else if (desc.kind === 'drop') {
    // Born where the room has it. A crate only moves while the Grab is pulling it, so one placed at the
    // origin stayed there — drawn metres from the crate the room actually had.
    e = { pos: new Vec3(desc.x ?? 0, 0.8, desc.z ?? 0), item: desc.item, special: !!desc.special,
          inRange: 0, alive: true };
    world.drops.push(e);
  } else {
    return null;
  }
  world.host.onSpawn(desc.kind, e);
  return e;
}

function despawnGhost(world, kind, e) {
  const list = kind === 'enemy' ? world.enemies
    : kind === 'bullet' ? world.bullets
    : kind === 'rocket' ? world.rockets
    : kind === 'drop' ? world.drops : null;
  if (!list) return;
  const i = list.indexOf(e);
  if (i >= 0) list.splice(i, 1);
  e.alive = false;
  world.host.onDespawn(kind, e);
}

const pushSample = (arr, s) => { arr.push(s); if (arr.length > MAX_HISTORY) arr.shift(); };

// Fold one snapshot into the World. Spawns and despawns take effect IMMEDIATELY (a mesh must exist before
// the frame that draws it); transforms are only recorded — `renderNet` decides what is actually shown.
// Returns false for a stale/out-of-order snapshot, which is dropped whole.
export function applySnapshot(world, state, snap, at = Date.now()) {
  if (snap.tick <= state.lastTick) return false;
  state.lastTick = snap.tick;

  for (const desc of snap.spawns || []) {
    if (state.byId.has(desc.id)) continue;
    const e = spawnGhost(world, desc);
    if (!e) continue;
    state.byId.set(desc.id, e);
    state.idOf.set(e, desc.id);
    state.kinds.set(desc.id, desc.kind);
    state.samples.set(desc.id, []);
  }

  const seen = new Set();
  const rows = (list, fn) => { for (const r of list || []) { seen.add(r[0]); const e = state.byId.get(r[0]); if (e) fn(e, r); } };
  const tick = snap.tick;
  rows(snap.enemies, (e, r) => pushSample(state.samples.get(r[0]),
    { at, tick, x: r[1], z: r[2], h: r[3], hp: r[4], sc: r[5], warping: !!r[6], sh: r[7], shr: r[8] }));
  rows(snap.bullets, (e, r) => pushSample(state.samples.get(r[0]), { at, tick, x: r[1], z: r[2] }));
  rows(snap.rockets, (e, r) => pushSample(state.samples.get(r[0]), { at, tick, x: r[1], z: r[2], h: r[3] }));
  rows(snap.drops,   (e, r) => pushSample(state.samples.get(r[0]), { at, tick, x: r[1], z: r[2] }));

  // Absence IS the despawn: an entity the room no longer lists is gone. There is no separate message,
  // because a snapshot is a complete statement about the world and a lost "despawn" would leak a mesh.
  for (const [id, e] of [...state.byId]) {
    if (seen.has(id)) continue;
    despawnGhost(world, state.kinds.get(id), e);
    state.byId.delete(id); state.kinds.delete(id); state.samples.delete(id);
  }

  state.ack = snap.ack;
  if (snap.arena) state.arena = { x: snap.arena.x, z: snap.arena.z };
  const p = snap.player;
  if (p) {
    state.playerBlock = p;
    pushSample(state.playerSamples, { at, tick: snap.tick, x: p.x, z: p.z, h: p.h, sc: p.sc, vx: p.vx, vz: p.vz });
    // Non-positional player state is applied at once: a health bar lagging 100 ms behind the hull it
    // describes reads as a bug, while a position lagging 100 ms reads as smooth.
    const me = world.player;
    if (me) {
      me.hp = p.hp; me.maxHp = p.maxHp; me._shieldValue = p.sh; me._shieldRechargeAccum = p.shr || 0;
      me.alive = p.alive; me.thrusting = !!p.thrust; me.oobTime = p.oob || 0;
      me.vel.set(p.vx || 0, 0, p.vz || 0);
      // Fire-group cooldowns, taken outright rather than interpolated — a cooldown is a countdown, and
      // interpolating one would run it backwards whenever a snapshot arrived late. Nothing on the client
      // advances the local ship's groups in a room, so this is the only thing that ever moves the HUD's
      // rocket dial off "ready".
      if (p.cd && me.groups) for (const k in p.cd) { const g = me.groups[k]; if (g) g.cooldown = p.cd[k]; }
    }
  }

  if (snap.arena) world.arenaCenter.set(snap.arena.x, 0, snap.arena.z);
  // Which crate the Grab is pulling — presentation only, but the client cannot know it (the room owns the
  // Grab), so without this the blue pull beam never drew at all.
  state.grabTarget = snap.grab != null ? (state.byId.get(snap.grab) || null) : null;
  // The room owns the autopilot, so the HUD has to read the room's copy: the roam nav buttons show which
  // destination is engaged, and the return-to-base hint hides once the ship is on its way.
  if (snap.autopilot) {
    world.autopilot.active = snap.autopilot.active;
    world.autopilot.phase = snap.autopilot.phase;
    // A `kind` is all the HUD needs; the client has no server entity to point `target` at.
    world.autopilot.target = snap.autopilot.kind ? { kind: snap.autopilot.kind } : null;
  }
  const run = snap.run;
  if (run) {
    world.kills = run.kills; world.enemyTotal = run.enemyTotal;
    world.earned = run.earned; world.earnedXp = run.earnedXp;
    world.levelRunner.won = run.won;
    world.levelRunner.returningToBase = run.returning;
    world.levelRunner.phaseIndex = run.phase;
    // Mirror the room's collected loot into this World's own list, IN PLACE (takeLoot slices it). The
    // victory path then deposits exactly as it does in single-player and needs to know nothing about rooms.
    if (run.loot) { world.pendingLoot.length = 0; for (const it of run.loot) world.pendingLoot.push(it); }
    world.returnToBase = run.returning;
    if (world.station) world.station.active = !!run.stationActive;
  }

  // The network is just another producer of the event stream the client already drains every tick. Almost
  // all of them go straight through; the player's own `fire` is held briefly so the gun keeps its own
  // rhythm instead of the snapshot grid's. See PLAYER_EVENT_BUFFER_MS.
  for (const ev of snap.events || []) scheduleEvent(state, snap, ev, at);

  pushSample(state.history, { at, tick: snap.tick });
  return true;
}

// Hold one wire event until its moment. `late` is how much of its budget the trip already spent: an event
// from the first tick of a batch is three ticks old by the time its snapshot is built, one from the last
// tick is brand new, and paying the difference back is the whole trick.
function scheduleEvent(state, snap, ev, at) {
  const budget = eventBudgetMs(state, ev);
  const late = Math.max(0, snap.tick - (ev.tk ?? snap.tick)) * SIM_DT * 1000;
  state.eventQueue.push({ due: at + Math.max(0, budget - late), ev });
  // Never grow without bound: release the excess at once rather than lose it.
  for (let i = 0, over = state.eventQueue.length - MAX_EVENT_QUEUE; i < over; i++) state.eventQueue[i].due = 0;
}

// Release every event whose moment has come, in the order the room produced them. Called from `renderNet`,
// which runs before the frame's event drain, so a released event reaches FX and audio in the same frame.
//
// Entity ids are resolved HERE rather than on arrival: a ghost can despawn during the wait, and a shield
// ripple bound to a ship that is already gone would paint a bubble on a corpse. `null` simply draws nothing.
export function releaseNetEvents(world, state, now) {
  if (!state.eventQueue.length) return;
  const held = [];
  for (const q of state.eventQueue) {
    if (q.due <= now) world.events.emit(hydrateEvent(state, q.ev));
    else held.push(q);
  }
  state.eventQueue = held;
}

// Turn a wire event back into what the adapter expects.
//
// TWO conversions, and the second one is not optional. JSON flattens a `Vec3` into a bare `{x,y,z}`, and
// the FX layer does not merely READ a position — `spawnSmoke`, `spawnBossExplosion` and the credit popups
// all call `pos.clone()` on it, because a puff has to keep the point it was born at after the emitter has
// moved on. A plain object throws there, once per puff, which a rocket produces about thirty times a
// second: the frame dies, the loop stops, and the last sound left playing loops forever. So every
// positional field comes back as a real `Vec3` before the adapter ever sees it.
//
// The other conversion is the reverse of the wire's entity-id swap, so a shield ripple binds to the ship
// it hit rather than to a number.
function hydrateEvent(state, ev) {
  const out = ev.pos ? { ...ev, pos: new Vec3(ev.pos.x, ev.pos.y, ev.pos.z) } : { ...ev };
  if (ev.enemyId != null) out.enemy = state.byId.get(ev.enemyId) || null;
  return out;
}

// ---------- Rendering a moment in the past ----------

const lerp = (a, b, t) => a + (b - a) * t;
// Angles wrap: interpolating 350° → 10° the naive way spins the ship the long way round.
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Find the pair of samples bracketing `t`, and how far between them it falls. Before the first sample we
// hold the first; past the last we hold the LAST rather than extrapolating — a wrong guess that has to be
// taken back looks worse than a hundred milliseconds of stillness.
function bracket(samples, t) {
  if (!samples || samples.length === 0) return null;
  if (samples.length === 1 || t <= samples[0].at) return { a: samples[0], b: samples[0], k: 0 };
  for (let i = samples.length - 1; i > 0; i--) {
    const a = samples[i - 1], b = samples[i];
    if (t >= a.at && t <= b.at) {
      const span = b.at - a.at;
      return { a, b, k: span > 0 ? (t - a.at) / span : 0 };
    }
  }
  const last = samples[samples.length - 1];
  return { a: last, b: last, k: 0 };
}

// Write the interpolated transforms into the World, ready for `syncMeshes`. Called once per rendered frame.
// `predictor` + `unacked` are optional: without them the ship is drawn from the snapshot alone, which is
// what single-player-free clients and the tests do.
export function renderNet(world, state, now = Date.now(), delayMs = INTERP_DELAY_MS,
                          predictor = null, unacked = () => []) {
  const t = now - delayMs;
  // First: hand the frame the events whose moment has come. Before anything is drawn, because the adapter
  // that turns them into FX and audio runs after this call and must see them in the same frame.
  releaseNetEvents(world, state, now);

  for (const [id, e] of state.byId) {
    // BULLETS ARE DEAD-RECKONED, not interpolated. A bullet flies in a straight line at a constant speed —
    // it is the one entity whose future is exactly known — so there is no reason to show it a tenth of a
    // second in the past like everything else. Anchored on its newest sample and advanced by its own
    // velocity, it is drawn where it actually IS, which is also where the hit flash will happen.
    // (Rockets home, so their future is not known; they keep the interpolation buffer.)
    // ROCKETS ARE DRAWN IN THE PRESENT TOO, for the same reason bullets are — with a twist. Their smoke
    // puffs arrive as EVENTS and are placed the moment they land, i.e. at the rocket's current position,
    // while the rocket itself was being drawn a tenth of a second in the past. The trail therefore ran
    // AHEAD of the rocket that was laying it. A rocket homes, so its future is not exactly known, but its
    // recent past is: velocity and turn rate by finite difference over the last two samples are close
    // enough over ~100 ms, and far better than a trail that leads.
    if (state.kinds.get(id) === 'rocket') {
      const ss = state.samples.get(id);
      const last = ss && ss[ss.length - 1];
      if (!last) continue;
      const prev = ss[ss.length - 2];
      const el = Math.min(now - last.at, MAX_EXTRAPOLATION_MS) / 1000;
      const span = prev ? sampleSpan(prev, last) : 0;
      if (span > 0) {
        e.pos.x = last.x + ((last.x - prev.x) / span) * el;
        e.pos.z = last.z + ((last.z - prev.z) / span) * el;
        e.heading = last.h + (shortestAngleDelta(prev.h, last.h) / span) * el;
      } else {
        // ONE sample so far: no finite difference to take, so fly it on the velocity it was launched with.
        // Holding it still instead is a freeze at the muzzle followed by a jump — the whole first snapshot
        // interval of every rocket's life, right where the player is looking when they pull the trigger.
        e.pos.x = last.x + e.vel.x * el;
        e.pos.z = last.z + e.vel.z * el;
        e.heading = last.h;
      }
      continue;
    }
    if (state.kinds.get(id) === 'bullet') {
      const ss = state.samples.get(id);
      const last = ss && ss[ss.length - 1];
      if (!last) continue;
      const dtms = Math.min(now - last.at, MAX_EXTRAPOLATION_MS);
      e.pos.x = last.x + e.vel.x * (dtms / 1000);
      e.pos.z = last.z + e.vel.z * (dtms / 1000);
      continue;
    }
    const br = bracket(state.samples.get(id), t);
    if (!br) continue;
    e.pos.x = lerp(br.a.x, br.b.x, br.k);
    e.pos.z = lerp(br.a.z, br.b.z, br.k);
    if (br.a.h !== undefined) e.heading = lerpAngle(br.a.h, br.b.h, br.k);
    if (br.a.sc !== undefined) e.scale = lerp(br.a.sc, br.b.sc, br.k);
    // Health and the warp flag are STATE, not motion: take the newer of the pair outright. Lerping a hit
    // would draw a health bar sliding down over 100 ms, which reads as a bug rather than as smoothing.
    if (br.b.hp !== undefined) e.hp = br.b.hp;
    if (br.b.warping !== undefined) e.warping = br.b.warping;
    // The shield pools are STATE like health — take the newer of the pair, never a blend. A bar sliding
    // between two values reads as a bug; and the purple fill is a countdown, which must not be smoothed.
    if (br.b.sh !== undefined) e._shieldValue = br.b.sh;
    if (br.b.shr !== undefined) e._shieldRechargeAccum = br.b.shr;
  }

  // THE LOCAL SHIP IS INTEGRATED, THEN CORRECTED — it is never simply read off a snapshot.
  //
  // It has to share one clock with its bullets, or a ship drifting sideways trails its own muzzle and shots
  // appear to leave from its flank. But dead-reckoning alone is not enough: taking the newest HEADING each
  // time made the nose turn in 15 Hz steps, which reads exactly like the game dropping to 15 fps whenever
  // you turn — while the position, being a continuous function of time, stayed smooth.
  //
  // So the drawn pose is its own continuously integrated thing: advanced every frame by the ship's reported
  // velocity and by the angular velocity observed between the last two samples, then pulled toward the
  // authoritative pose with a time constant. Corrections arrive as a gentle convergence instead of a step,
  // and nothing in the picture happens at the snapshot rate.
  const me = world.player;
  const ps = state.playerSamples;
  const last = ps[ps.length - 1];
  if (me && last) {
    const prev = ps[ps.length - 2];
    // Angular velocity by finite difference — the wire carries no turn rate, and this is exactly as good.
    const span = prev ? sampleSpan(prev, last) : 0;
    const omega = span > 0 ? shortestAngleDelta(prev.h, last.h) / span : 0;
    const el = Math.min(now - last.at, MAX_EXTRAPOLATION_MS) / 1000;
    let predicting = false;
    let target = {
      x: last.x + (last.vx || 0) * el,
      z: last.z + (last.vz || 0) * el,
      h: last.h + omega * el,
    };
    // CLIENT-SIDE PREDICTION. Where extrapolation guesses the ship's future from its last reported motion,
    // prediction KNOWS it: it re-simulates the player's own unacknowledged input through the same
    // `sim-core` step the room runs. The result is the ship answering the controls at once instead of a
    // round trip later. It stands down whenever the ship is not the player's to author (autopilot, death),
    // where the snapshot is simply the better answer.
    if (predictor && state.playerBlock && predictor.predictable(world.autopilot, world.player.alive)) {
      predictor.reset(state.playerBlock, world.autopilot, state.arena);
      const pending = unacked(state.ack);
      for (let i = Math.max(0, pending.length - MAX_REPLAY_TICKS); i < pending.length; i++) predictor.step(pending[i]);
      target = predictor.pose;
      predicting = true;
    }
    if (!state.view) { state.view = { ...target }; state.viewAt = now; }
    const frameDt = Math.max(0, Math.min((now - state.viewAt) / 1000, 0.1));
    state.viewAt = now;
    const v = state.view;
    v.x += (last.vx || 0) * frameDt;      // integrate first, so motion is continuous at frame rate…
    v.z += (last.vz || 0) * frameDt;
    v.h += omega * frameDt;
    const k = 1 - Math.exp(-frameDt / (predicting ? VIEW_TAU_PREDICTED_S : VIEW_TAU_S)); // …then converge
    v.x += (target.x - v.x) * k;
    v.z += (target.z - v.z) * k;
    v.h += shortestAngleDelta(v.h, target.h) * k;
    me.pos.x = v.x; me.pos.z = v.z; me.pos.y = BULLET_PLANE_Y;
    me.heading = v.h;
    me.scale = last.sc;
  }
}

// Drop every ghost and forget the history — leaving netsim, or the socket died.
export function clearNet(world, state) {
  for (const [id, e] of [...state.byId]) despawnGhost(world, state.kinds.get(id), e);
  state.byId.clear(); state.kinds.clear(); state.samples.clear();
  state.playerSamples.length = 0; state.history.length = 0;
  state.view = null; state.viewAt = 0;
  state.eventQueue.length = 0; // a new run does not want the last one's pending FX
  state.lastTick = -1;
}
