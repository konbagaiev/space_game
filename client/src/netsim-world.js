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
import { BULLET_PLANE_Y } from './sim-core/consts.js';

// How far behind the newest snapshot we render. One snapshot interval (at 15 Hz, ~67 ms) is the minimum
// that can bracket; 100 ms leaves headroom for one late or reordered packet before we run dry.
export const INTERP_DELAY_MS = 100;
// How much history to keep. Enough to cover the delay several times over, so a burst of jitter cannot
// exhaust it; small enough that it is a handful of objects.
export const MAX_HISTORY = 12;

export function createNetState() {
  return {
    byId: new Map(),   // network id → the World entity it drives
    kinds: new Map(),  // network id → 'enemy' | 'bullet' | 'rocket' | 'drop'
    samples: new Map(),// network id → [{ at, x, z, h, sc, extra }] — newest last
    playerSamples: [], // the same, for the local ship
    history: [],       // [{ at, tick }] — arrival times, for choosing the render moment
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
    e = { pos: new Vec3(0, BULLET_PLANE_Y, 0), vel: new Vec3(), color: desc.color,
          fromPlayer: !!desc.fromPlayer, weaponClass: desc.weaponClass, traveled: 0, alive: true };
    world.bullets.push(e);
  } else if (desc.kind === 'rocket') {
    e = { pos: new Vec3(0, BULLET_PLANE_Y, 0), vel: new Vec3(), heading: 0, color: desc.color,
          fromPlayer: !!desc.fromPlayer, weaponClass: desc.weaponClass, alive: true };
    world.rockets.push(e);
  } else if (desc.kind === 'drop') {
    e = { pos: new Vec3(0, 0.8, 0), item: desc.item, special: !!desc.special, inRange: 0, alive: true };
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
    state.kinds.set(desc.id, desc.kind);
    state.samples.set(desc.id, []);
  }

  const seen = new Set();
  const rows = (list, fn) => { for (const r of list || []) { seen.add(r[0]); const e = state.byId.get(r[0]); if (e) fn(e, r); } };
  rows(snap.enemies, (e, r) => pushSample(state.samples.get(r[0]), { at, x: r[1], z: r[2], h: r[3], hp: r[4], sc: r[5], warping: !!r[6] }));
  rows(snap.bullets, (e, r) => pushSample(state.samples.get(r[0]), { at, x: r[1], z: r[2] }));
  rows(snap.rockets, (e, r) => pushSample(state.samples.get(r[0]), { at, x: r[1], z: r[2], h: r[3] }));
  rows(snap.drops,   (e, r) => pushSample(state.samples.get(r[0]), { at, x: r[1], z: r[2] }));

  // Absence IS the despawn: an entity the room no longer lists is gone. There is no separate message,
  // because a snapshot is a complete statement about the world and a lost "despawn" would leak a mesh.
  for (const [id, e] of [...state.byId]) {
    if (seen.has(id)) continue;
    despawnGhost(world, state.kinds.get(id), e);
    state.byId.delete(id); state.kinds.delete(id); state.samples.delete(id);
  }

  const p = snap.player;
  if (p) {
    pushSample(state.playerSamples, { at, x: p.x, z: p.z, h: p.h, sc: p.sc, vx: p.vx, vz: p.vz });
    // Non-positional player state is applied at once: a health bar lagging 100 ms behind the hull it
    // describes reads as a bug, while a position lagging 100 ms reads as smooth.
    const me = world.player;
    if (me) {
      me.hp = p.hp; me.maxHp = p.maxHp; me._shieldValue = p.sh;
      me.alive = p.alive; me.thrusting = !!p.thrust; me.oobTime = p.oob || 0;
      me.vel.set(p.vx || 0, 0, p.vz || 0);
    }
  }

  if (snap.arena) world.arenaCenter.set(snap.arena.x, 0, snap.arena.z);
  const run = snap.run;
  if (run) {
    world.kills = run.kills; world.enemyTotal = run.enemyTotal;
    world.earned = run.earned; world.earnedXp = run.earnedXp;
    world.levelRunner.won = run.won;
    world.levelRunner.returningToBase = run.returning;
    world.levelRunner.phaseIndex = run.phase;
    world.returnToBase = run.returning;
    if (world.station) world.station.active = !!run.stationActive;
  }

  // The network is just another producer of the event stream the client already drains every tick.
  for (const ev of snap.events || []) world.events.emit(hydrateEvent(state, ev));

  pushSample(state.history, { at, tick: snap.tick });
  return true;
}

// Turn a wire event back into what the adapter expects: an entity id becomes the entity again, so a shield
// ripple binds to the ship it hit.
function hydrateEvent(state, ev) {
  if (ev.enemyId != null) return { ...ev, enemy: state.byId.get(ev.enemyId) || null };
  return ev;
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
export function renderNet(world, state, now = Date.now(), delayMs = INTERP_DELAY_MS) {
  const t = now - delayMs;

  for (const [id, e] of state.byId) {
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
  }

  const me = world.player;
  const pb = bracket(state.playerSamples, t);
  if (me && pb) {
    me.pos.x = lerp(pb.a.x, pb.b.x, pb.k);
    me.pos.z = lerp(pb.a.z, pb.b.z, pb.k);
    me.pos.y = BULLET_PLANE_Y;
    me.heading = lerpAngle(pb.a.h, pb.b.h, pb.k);
    me.scale = lerp(pb.a.sc, pb.b.sc, pb.k);
  }
}

// Drop every ghost and forget the history — leaving netsim, or the socket died.
export function clearNet(world, state) {
  for (const [id, e] of [...state.byId]) despawnGhost(world, state.kinds.get(id), e);
  state.byId.clear(); state.kinds.clear(); state.samples.clear();
  state.playerSamples.length = 0; state.history.length = 0;
  state.lastTick = -1;
}
