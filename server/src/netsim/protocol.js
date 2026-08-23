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
  shieldHit:        ['pos', 'broke'],
  enemyShieldHit:   ['pos', 'broke'],
  shieldReady:      [],
  fire:             ['weaponClass', 'isRocket', 'fromPlayer'],
  evade:            ['pos'],
  pickup:           ['item'],
  smoke:            ['pos'],
  detonate:         ['pos', 'weaponClass', 'blastVis', 'blastTint', 'blastTime', 'blastBright'],
  // `byAlly` — the wingman landed the killing blow. Without it a room's client would write his kills into
  // the player's own event log (docs/plans/combat-ally.md).
  kill:             ['pos', 'isBoss', 'exhaustColor', 'sizeScale', 'role', 'shipClass', 'reward', 'xp', 'byAlly', 'name'],
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
export const EVENT_ENTITY_REFS = { enemyShieldHit: ['enemy'] };

const vec = (v) => (v ? { x: v.x, y: v.y, z: v.z } : null);

// One simulation event → one wire event. Returns null for a type nobody wired up, so an unknown event is
// dropped rather than leaked; the test above is what stops that from happening silently.
export function wireEvent(ev, idOf) {
  const fields = EVENT_FIELDS[ev.type];
  if (!fields) return null;
  const out = { type: ev.type };
  for (const f of fields) {
    const v = ev[f];
    if (v === undefined) continue;
    out[f] = (f === 'pos') ? vec(v) : v;
  }
  for (const f of EVENT_ENTITY_REFS[ev.type] || []) {
    const id = ev[f] ? idOf(ev[f]) : null;
    if (id != null) out[`${f}Id`] = id;
  }
  return out;
}
