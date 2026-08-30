// The netsim wire protocol: what a client sends up, what a room sends down, and — the part that needs a
// guard rather than good intentions — how a simulation event becomes something safe to serialize.
//
// See docs/plans/server-authoritative-sim.md (Slice D).

// ---------- Upstream (client → room) ----------
//   { type: 'input', ticks: [ { t, k, a } … ] }   a batch of per-tick input snapshots
//     t — the client's tick number (echoed back as `ack` so the client can discard acked inputs)
//     k — held key codes, exactly `replay.js snapshotInput().k`
//     a — touch aim as [heading, thrust], or null; exactly `snapshotInput().t`
//   { type: 'hello', … }                          sent once after the socket opens
//   { type: 'bye' }                               leave the room
//
// The shape is `replay.js`'s recorded tick on purpose: the client already produces it 60 times a second for
// session recording, the referee already consumes it, and a room that spoke a different dialect would be a
// third format to keep in sync.

// ---------- Downstream (room → client) ----------
//   { type: 'welcome', tick, dt, level, run }     once, on join
//   { type: 'snap', … }                           see `snapshot()` in room.js
//
// Entity rows are positional arrays with a documented column order. Not for the bytes — binary/delta
// encoding is an explicit non-goal for this cut — but because a snapshot is the one message that repeats
// 15 times a second, and `[7,12.5,-3.1]` stays readable in a log where `{id:7,x:12.5,z:-3.1}` becomes noise.
export const COLUMNS = {
  enemies: 'id, x, z, heading, hp, scale, warping, shieldValue, shieldRecharge',
  allies:  'id, x, z, heading, hp, scale, warping, shieldValue, shieldRecharge',
  bullets: 'id, x, z',
  rockets: 'id, x, z, heading',
  drops:   'id, x, z',
};

// ---------- Events ----------
// Which fields of each simulation event cross the wire.
//
// This is an explicit allowlist, and it exists because of one event: `enemyShieldHit` carries a live
// ENTITY reference (`enemy`) so the browser can bind a pooled bubble to a specific ship. Serializing that
// naively would push a whole enemy — engine, hitboxes, mounts, the lot — down the socket 15 times a second,
// and it would hand a client the server's internal state for free. `entityRefs` names the fields that must
// be swapped for a network id instead.
//
// A copy list also fails LOUDLY when a new event type is added and nobody wires it up: `protocol.test.js`
// parses the catalogue at the top of `sim-core/events.js` and asserts every type appears here.
export const EVENT_FIELDS = {
  hit:              ['target', 'shipClass'],
  bulletImpact:     ['pos', 'weaponClass', 'absorbed'],
  // The victim of a projectile that reached a HULL. The `ship` entity ref is added by `wireEvent`'s second
  // loop off EVENT_ENTITY_REFS (as `shipId`), not listed here. NOTE: the local player has no network id, so
  // a hit on your OWN ship in a netsim room arrives without one — the flash simply does not draw there,
  // while `target: 'player'` still crosses so the camera shudder works.
  hullHit:          ['target', 'dirHeading', 'weaponClass', 'toHull', 'pos'],
  shieldHit:        ['pos', 'broke'],
  enemyShieldHit:   ['pos', 'broke'],
  shieldReady:      [],
  fire:             ['weaponClass', 'isRocket', 'fromPlayer'],
  evade:            ['pos'],
  // The charged beam, two events per shot and nothing else: the start of the charge and the release. A
  // charge is per-ship state that changes every tick and an aiming corridor is per-ship geometry — neither
  // is broadcast. The corridor's WIDTH is this weapon's lag compensation, which is why it needs no rewind.
  // It DOES carry one entity reference, and only one: the SHOOTER, added by `wireEvent`'s second loop as
  // `shipId` off `EVENT_ENTITY_REFS` rather than listed here. A remote shooter's fire group is never ticked
  // in this tab, so its corridor is underivable without a name for the hull to draw it from. The player's
  // own charge needs none — he is `world.player`, and `idOf` returns null for him anyway.
  beamCharge:       ['pos', 'dur', 'weaponClass', 'color', 'fromPlayer'],
  beamFire:         ['from', 'to', 'hit', 'absorbed', 'weaponClass', 'color', 'fromPlayer'],
  pickup:           ['item'],
  smoke:            ['pos'],
  detonate:         ['pos', 'weaponClass', 'blastVis', 'blastTint', 'blastTime', 'blastBright'],
  // `byAlly` — the wingman landed the killing blow. Without it a room's client would write his kills into
  // the player's own event log (docs/plans/combat-ally.md).
  kill:             ['pos', 'isBoss', 'exhaustColor', 'sizeScale', 'role', 'shipClass', 'reward', 'xp', 'byAlly', 'name'],
  // The wingman was destroyed. Carries only what the explosion needs — he is worth nothing, so there is no
  // reward field to leak and nothing for a client to bank.
  allyDown:         ['pos', 'exhaustColor', 'sizeScale', 'shipClass'],
  warpFlash:        ['pos'],
  banner:           ['key', 'params', 'dur'],
  bannerClear:      [],
  missionArrival:   ['missionId'],
  baseArrival:      [],
  missionZoneEnter: [],
  cleared:          ['credits', 'xp', 'kills'],
  finishing:        [],
  win:              ['textKey', 'text'],
  death:            [],
};

// Every wire event also carries `tk` — the server tick it happened on — added by the room, not listed here
// because it is not a field of any simulation event. The client holds each event until its render clock
// reaches that tick, so FX and audio land on the frame that shows what they describe.

// Fields holding a live entity, replaced by that entity's network id under the same name + `Id`.
// ONE TABLE, TWO READERS — it lives in host-neutral `sim-core/events.js` because the client cannot import
// from `server/` (the browser is served `client/` alone), and a server-side table shadowed by a hardcoded
// rehydration line on the client is how the third reference gets forgotten on the way back (DECISIONS §136).
// Re-exported here so `protocol.js` stays the one place the wire's shape is read from.
export { EVENT_ENTITY_REFS } from '../../../client/src/sim-core/events.js';
import { EVENT_ENTITY_REFS } from '../../../client/src/sim-core/events.js';

const vec = (v) => (v ? { x: v.x, y: v.y, z: v.z } : null);

// Fields holding a POSITION, vec-serialized explicitly on the way out. Explicit rather than "whatever
// JSON.stringify makes of a Vec3": that happens to be `{x,y,z}` today only because the constructor assigns
// three own enumerable fields — an implicit dependency on a class's field layout, in the one file whose job
// is to make what crosses the wire explicit. The beam's `from`/`to` are the second and third members.
const VEC_FIELDS = new Set(['pos', 'from', 'to']);

// One simulation event → one wire event. Returns null for a type nobody wired up, so an unknown event is
// dropped rather than leaked; the test above is what stops that from happening silently.
export function wireEvent(ev, idOf) {
  const fields = EVENT_FIELDS[ev.type];
  if (!fields) return null;
  const out = { type: ev.type };
  for (const f of fields) {
    const v = ev[f];
    if (v === undefined) continue;
    out[f] = VEC_FIELDS.has(f) ? vec(v) : v;
  }
  for (const f of EVENT_ENTITY_REFS[ev.type] || []) {
    const id = ev[f] ? idOf(ev[f]) : null;
    if (id != null) out[`${f}Id`] = id;
  }
  return out;
}
