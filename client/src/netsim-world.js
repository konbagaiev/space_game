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

// ---------- One clock ----------
//
// Everything on screen is drawn at `renderTick = nowTick − delay`, interpolated between the two samples
// bracketing that tick, and NOTHING is extrapolated. That is the whole design, and it is the one every
// system that prefers a smooth picture to a fast one arrives at (Valve's entity interpolation, Mirror,
// nengi, Colyseus's `lerp` mode). It replaces a client that drew on four clocks at once — enemies in the
// past, bullets and rockets dead-reckoned into the present, the local ship predicted ahead of the server,
// and despawns applied the instant a packet landed — where every seam between two of them was an artifact.
// See docs/plans/netsim-one-clock-rendering.md; the measured cost of the old design was 7476 breaks in the
// drawn motion per minute, half of them on the frame a packet happened to arrive.
//
// The timeline is TICKS. A snapshot states the tick it describes, and that is the truth; when it turned up
// is not. Packets that a room emits exactly 4 ticks apart arrive 50–79 ms apart, and anything measured from
// their arrival inherits that spread — which is precisely what made the fast things the jerky ones.

// How far behind the newest snapshot we render. Every source gives the same minimum — TWO snapshot
// intervals, so that a single lost packet still leaves a pair to bracket with (Valve's `cl_interp 0.1` at
// 20 Hz, Mirror's `bufferTimeMultiplier = 2`, Colyseus's "1–2 server tick intervals"). We take THREE, which
// is Fiedler's margin for losing two in a row, and it is affordable here because this game has no latency
// requirement worth the trade. At `SNAPSHOT_EVERY = 2` (30 Hz) three intervals is 100 ms.
export const INTERP_DELAY_MS = 100;   // = 3 intervals at SNAPSHOT_EVERY 2; keep the two in step
// An output spring on the drawn local ship. Under one clock there are no corrections left to absorb, so this
// is cosmetic only: a time constant (frame-rate independent) that takes the first-order discontinuity off
// the sample points — the thing Fiedler describes as "your brain detecting 1st order discontinuity" — at the
// cost of a few milliseconds. Colyseus calls the same knob `smoothMs`.
export const VIEW_TAU_S = 0.08;

// How much history to keep. Enough to cover the delay several times over, so a burst of jitter cannot
// exhaust it; small enough that it is a handful of objects.
export const MAX_HISTORY = 12;

// ---------- tick → wall clock ----------
//
// `offset` is the wall-clock instant at which server tick 0 is due; every drawn position is a function of
// it and of the tick numbers in the snapshots, never of an arrival time.
//
// ESTIMATING IT. Each packet observes `at − tick·dt`, which is the offset plus that packet's own delay, and
// the estimate SLEWS toward it a couple of percent at a time. Deliberately not a step, and deliberately not
// a tracker of the minimum-delay packet: that was tried, and every new earliest-ever packet moved the whole
// timeline under the world, which is the same discontinuity this design exists to remove. Slewing toward
// the mean costs about ten milliseconds of extra delay and is perfectly smooth — absorbing the spread is
// what the interpolation buffer is for, and it is far wider than the spread measured in play.
//
// The one case that must NOT be slewed is a changed RELATIONSHIP rather than a jittery link: the room
// paused (a hidden tab, a menu, a death screen) or fell behind its own clock and dropped the excess by
// design. Creeping toward that at 2% a packet would leave the world drawn seconds in the past.
export const CLOCK_FOLLOW = 0.02;    // of the remaining error, per packet
export const CLOCK_RESYNC_MS = 250;  // past this it is a new relationship, not jitter — take it outright

const tickMs = SIM_DT * 1000;

function updateClock(state, snap, at) {
  const obs = at - snap.tick * tickMs;
  const c = state.clock;
  if (c.offset == null || Math.abs(obs - c.offset) > CLOCK_RESYNC_MS) { c.offset = obs; c.resyncs++; }
  else c.offset += (obs - c.offset) * CLOCK_FOLLOW;
}

// The server tick this instant corresponds to, as a fraction. Null until a packet has been seen.
export const tickAt = (state, now) => (state.clock.offset == null ? null : (now - state.clock.offset) / tickMs);

export function createNetState() {
  return {
    byId: new Map(),   // network id → the World entity it drives
    idOf: new WeakMap(),// the reverse: a clicked entity → the id the room knows it by
    kinds: new Map(),  // network id → 'enemy' | 'bullet' | 'rocket' | 'drop'
    arriving: new Map(),// network id → the tick it was born on; attached when the render clock reaches it
    leaving: new Map(),// network id → the tick it stopped being listed; despawned when the clock reaches it
    samples: new Map(),// network id → [{ at, x, z, h, sc, extra }] — newest last
    playerSamples: [], // the same, for the local ship
    grabTarget: null,  // the crate the room's Grab is pulling, so renderTick can draw its beam
    // The DRAWN pose of the local ship, integrated continuously and pulled toward the server's. Kept apart
    // from the samples because it must be a smooth function of real time, not of snapshot arrivals.
    view: null,        // { x, z, h } | null until the first snapshot
    viewAt: 0,         // when `view` was last advanced
    // The newest authoritative player block and the tick it acknowledged. `ack` is still reported upstream
    // (it is how the uplink retires input it no longer needs); nothing re-simulates from it any more.
    playerBlock: null,
    ack: null,
    arena: { x: 0, z: 0 },
    history: [],       // [{ at, tick }] — arrival times, for choosing the render moment
    lastTick: -1,      // newest server tick applied (an out-of-order snapshot is dropped)
    welcome: null,
    clock: { offset: null, resyncs: 0 }, // tick → wall clock; every drawn position is a function of this
    jerk: null,        // ?netjerk diagnostic probe (netsim-jerk.js) — null unless the flag is on, and it
                       // only ever READS: nothing about the picture depends on whether it is armed.
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
  } else if (desc.kind === 'bullet') {
    // `projectileColor` + `class` are what make a shot look like the weapon that fired it: the class picks
    // its BOLT_SCALE, and without one `attachBulletBody` falls through to a plain untinted dot. That is
    // exactly what a netsim fight looked like before these were carried.
    e = { pos: new Vec3(desc.x ?? 0, BULLET_PLANE_Y, desc.z ?? 0), vel: new Vec3(desc.vx || 0, 0, desc.vz || 0),
          projectileColor: desc.projectileColor, class: desc.class,
          fromPlayer: !!desc.fromPlayer, traveled: 0, alive: true };
  } else if (desc.kind === 'rocket') {
    // `lead` marks the invisible leader of a spiral volley (no mesh at all) and `spiralOf` picks the
    // warhead geometry — both decide what `attachRocketBody` builds, so both have to survive the wire.
    e = { pos: new Vec3(desc.x ?? 0, BULLET_PLANE_Y, desc.z ?? 0), vel: new Vec3(), heading: desc.h || 0,
          projectileColor: desc.projectileColor, weaponClass: desc.weaponClass,
          lead: !!desc.lead, spiralOf: desc.spiralOf ? true : undefined,
          fromPlayer: !!desc.fromPlayer, alive: true };
  } else if (desc.kind === 'drop') {
    // Born where the room has it. A crate only moves while the Grab is pulling it, so one placed at the
    // origin stayed there — drawn metres from the crate the room actually had.
    e = { pos: new Vec3(desc.x ?? 0, 0.8, desc.z ?? 0), item: desc.item, special: !!desc.special,
          inRange: 0, alive: true };
  } else {
    return null;
  }
  return e;
}

// …and PUTTING IT IN THE WORLD is a separate act, because it happens at a different time. The descriptor
// arrives with the packet; the body may only appear when the render clock reaches the tick it was born on —
// otherwise an entity stands frozen at its spawn point for the whole interpolation delay before it starts
// moving, which is a stutter at the birth of every bullet and rocket. Spawn and despawn are symmetric: both
// are events on the render timeline, not on the arrival one.
function attachGhost(world, kind, e) {
  const list = kind === 'enemy' ? world.enemies
    : kind === 'bullet' ? world.bullets
    : kind === 'rocket' ? world.rockets
    : kind === 'drop' ? world.drops : null;
  if (!list) return;
  list.push(e);
  world.host.onSpawn(kind, e);
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
    state.arriving.set(desc.id, snap.tick); // shown when the render clock gets here, not when the packet did
  }

  updateClock(state, snap, at); // where this snapshot's tick sits in wall time, before anything reads it

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
  //
  // But it is not gone YET. The body is being drawn `delay` behind this snapshot, so removing it now takes
  // it off the screen before the player has watched it get there — and its own death FX, which ride the same
  // clock, would then go off in the space it used to occupy. It is noted as leaving, keeps being drawn from
  // the samples it already has, and `renderNet` retires it when the render clock reaches this tick. Every
  // system with a real interpolation timeline does exactly this (Unity NetCode gates despawn on the
  // interpolation tick; nengi releases deletions when the render clock crosses them).
  for (const id of state.byId.keys()) {
    if (seen.has(id) || state.leaving.has(id)) continue;
    // Retire it at its LAST SAMPLE, not at the snapshot that failed to mention it. The room dropped it
    // somewhere in between, and the difference is a whole snapshot interval of the body standing still at
    // its final position before it vanishes — the one visible artifact left after the clock was unified.
    const ss = state.samples.get(id);
    state.leaving.set(id, ss && ss.length ? ss[ss.length - 1].tick : snap.tick);
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

  // The network is just another producer of the event stream the client already drains every tick.
  for (const ev of snap.events || []) world.events.emit(hydrateEvent(state, ev));

  pushSample(state.history, { at, tick: snap.tick });
  if (state.jerk) state.jerk.snapshot(snap, at); // ?netjerk: the delivery fingerprint of this packet
  return true;
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

// Find the pair of samples bracketing tick `t` (a fraction), and how far between them it falls. The axis is
// the SERVER TICK: ticks are exactly `snapshotEvery` apart by construction, so the parameter is uniform,
// while arrival times wobble by tens of milliseconds and used to wobble the motion with them.
//
// Before the first sample we hold the first; past the last we hold the LAST and never extrapolate. That is
// not caution, it is the finding of everyone who has tried the alternative: a guess that has to be taken
// back reads worse than stillness, and bracketing changes belong at predictable render-time crossings
// rather than at jittered packet arrivals.
function bracket(samples, t) {
  if (!samples || samples.length === 0) return null;
  if (samples.length === 1 || t <= samples[0].tick) return { a: samples[0], b: samples[0], k: 0 };
  for (let i = samples.length - 1; i > 0; i--) {
    const a = samples[i - 1], b = samples[i];
    if (t >= a.tick && t <= b.tick) {
      const span = b.tick - a.tick;
      return { a, b, k: span > 0 ? (t - a.tick) / span : 0 };
    }
  }
  const last = samples[samples.length - 1];
  return { a: last, b: last, k: 0 };
}

// Write the interpolated transforms into the World, ready for `syncMeshes`. Called once per rendered frame.
export function renderNet(world, state, now = Date.now(), delayMs = INTERP_DELAY_MS) {
  // The render moment, in TICKS. A packet that is twenty milliseconds late moves nothing: it arrives with
  // the tick it always had, and the buffer is what absorbs its lateness.
  const nowTick = tickAt(state, now);
  if (nowTick == null) return;              // nothing has arrived yet; there is nothing to draw
  const t = nowTick - delayMs / tickMs;

  // Bring in what the render clock has reached. Its samples have been accumulating since the packet
  // arrived, so it is drawn moving from its first frame rather than standing at its spawn point.
  for (const [id, tick] of [...state.arriving]) {
    if (t < tick - 1e-6) continue;
    const e = state.byId.get(id);
    if (e) attachGhost(world, state.kinds.get(id), e);
    state.arriving.delete(id);
  }

  for (const [id, e] of state.byId) {
    if (state.arriving.has(id)) continue;   // born, but not yet in the moment being drawn
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

  // Retire what the render clock has finished watching. An entity noted as leaving keeps being drawn until
  // `t` reaches the tick it stopped being listed at — so a ship is still on screen for its own explosion,
  // and a rocket for its own blast.
  for (const [id, tick] of [...state.leaving]) {
    // `t` is an integer tick reached through two divisions, so it lands a few parts in 10^15 short of the
    // boundary as often as past it. The epsilon is 16 nanoseconds of tick time: it decides nothing except
    // which side of an exact tick a float rounds to.
    if (t < tick - 1e-6) continue;
    const e = state.byId.get(id);
    // A body that never became visible — it lived and died inside one interpolation delay — is simply
    // forgotten; there is nothing to release, and nothing was ever shown.
    if (e && !state.arriving.has(id)) despawnGhost(world, state.kinds.get(id), e);
    state.byId.delete(id); state.kinds.delete(id); state.samples.delete(id);
    state.leaving.delete(id); state.arriving.delete(id);
  }

  // THE LOCAL SHIP IS DRAWN LIKE EVERYTHING ELSE — from the same samples, on the same clock, at the same
  // moment in the past. It used to be client-side PREDICTED: a shadow World re-simulating the player's own
  // unacknowledged input through the real `stepPlayer`, so the ship answered the controls at once instead of
  // a round trip later. That is the right machinery for a game whose feel depends on the millisecond, and
  // this one's does not — the maintainer asked for a smooth picture and said outright that reaction time is
  // not a requirement here. Prediction put the ship on a THIRD clock, ahead of the world it was flying
  // through, and every seam between the two produced artifacts that cost a day to chase one at a time.
  //
  // What remains is a short output spring, purely cosmetic: it takes the corner off the sample points
  // without moving the ship anywhere the server did not put it.
  const me = world.player;
  const ps = state.playerSamples;
  if (me && ps.length) {
    const br = bracket(ps, t);
    const target = br
      ? { x: lerp(br.a.x, br.b.x, br.k), z: lerp(br.a.z, br.b.z, br.k), h: lerpAngle(br.a.h, br.b.h, br.k) }
      : null;
    if (target) {
      if (!state.view) { state.view = { ...target }; state.viewAt = now; }
      const frameDt = Math.max(0, Math.min((now - state.viewAt) / 1000, 0.1));
      state.viewAt = now;
      const v = state.view;
      const k = 1 - Math.exp(-frameDt / VIEW_TAU_S);
      v.x += (target.x - v.x) * k;
      v.z += (target.z - v.z) * k;
      v.h += shortestAngleDelta(v.h, target.h) * k;
      me.pos.x = v.x; me.pos.z = v.z; me.pos.y = BULLET_PLANE_Y;
      me.heading = v.h;
      const last = ps[ps.length - 1];
      me.scale = last.sc;
    }
  }

  // LAST: the ?netjerk probe reads the poses that were just written, so it measures exactly what the
  // player sees rather than what the network delivered.
  if (state.jerk) state.jerk.frame(world, state, now);
}

// Drop every ghost and forget the history — leaving netsim, or the socket died.
export function clearNet(world, state) {
  for (const [id, e] of [...state.byId]) despawnGhost(world, state.kinds.get(id), e);
  state.byId.clear(); state.kinds.clear(); state.samples.clear();
  state.leaving.clear(); state.arriving.clear();
  state.clock.offset = null; // a new run is a new tick→wall-clock relationship, not a drift to slew toward
  state.playerSamples.length = 0; state.history.length = 0;
  state.view = null; state.viewAt = 0;
  state.lastTick = -1;
}
