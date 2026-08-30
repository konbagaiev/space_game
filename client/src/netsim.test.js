import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalNetsim, wsUrl, createUplink, connectNetsim, netsimDefersTo, netsimDeferReason, INPUT_BATCH, isUnroomableSideMission } from './netsim.js';
import { SIM_DT } from './sim-core/consts.js';
import { snapshotInput } from './replay.js';

test('evalNetsim: the flag is opt-in, per visit, and can name a level', () => {
  assert.equal(evalNetsim(''), null);
  assert.equal(evalNetsim('?dev=1'), null);
  // A bare flag means "the level this player is actually on" — NOT level-0. Defaulting to a fixed level
  // put the room in a different world from the one the client had built, which is how it was found.
  assert.deepEqual(evalNetsim('?netsim'), { level: null, seed: null });
  assert.deepEqual(evalNetsim('?netsim=1'), { level: null, seed: null });
  assert.deepEqual(evalNetsim('?netsim=level-2'), { level: 'level-2', seed: null });
  assert.deepEqual(evalNetsim('?netsim&seed=77'), { level: null, seed: 77 });
  assert.equal(evalNetsim('?netsim=off'), null, 'explicitly off');
  assert.equal(evalNetsim('?netsim=0'), null);
});

test('wsUrl swaps the scheme, so an https page cannot open an insecure socket', () => {
  assert.match(wsUrl({ apiBase: '', origin: 'http://localhost:4000', ticket: 'abc' }), /^ws:\/\/localhost:4000\/ws\?/);
  assert.match(wsUrl({ apiBase: '', origin: 'https://vega.tenony.com', ticket: 'abc' }), /^wss:\/\/vega\.tenony\.com\/ws\?/);
});

test('wsUrl carries the ticket, the level and the seed', () => {
  const u = new URL(wsUrl({ apiBase: '', origin: 'http://x', ticket: 't1', level: 'level-3', seed: 9 }));
  assert.equal(u.searchParams.get('ticket'), 't1');
  assert.equal(u.searchParams.get('level'), 'level-3');
  assert.equal(u.searchParams.get('seed'), '9');
});

// THE THREE DEV FLAGS THAT CHANGE THE FIGHT MUST ALL REACH THE ROOM. A dev flag applied only in the browser
// gives the two ends different worlds, and the failure is silent-looking rather than loud: `?beam` used to
// be client-only, so a room flew the account's real machine gun while this tab drew a green beam sight over
// it (fixed 2026-08-25, after the maintainer hit it). Absent flags must add no params at all, so an ordinary
// room's URL is unchanged.
test('wsUrl forwards the dev flags — ally, lancer and beam — and adds nothing when they are absent', () => {
  const plain = new URL(wsUrl({ apiBase: '', origin: 'http://x', ticket: 't1', level: 'level-4' }));
  assert.equal(plain.searchParams.get('ally'), null);
  assert.equal(plain.searchParams.get('lancer'), null);
  assert.equal(plain.searchParams.get('beam'), null, 'a normal room is asked for nothing extra');

  const dev = new URL(wsUrl({ apiBase: '', origin: 'http://x', ticket: 't1', level: 'level-4',
                              ally: 'clear-out', lancer: 'wave-1', beam: true }));
  assert.equal(dev.searchParams.get('ally'), 'clear-out', 'the wingman arrives on a named PHASE');
  assert.equal(dev.searchParams.get('lancer'), 'wave-1', 'the lancers fill a named PHASE');
  assert.equal(dev.searchParams.get('beam'), '1', 'but `beam` is a boolean: mount it on the player');

  // The three compose — `?beam&lancer&level=4` in a room is the full test flight, your beam against theirs.
  assert.equal(new URL(wsUrl({ apiBase: '', origin: 'http://x', ticket: 't', beam: true })).searchParams.get('beam'), '1');
});

test('the uplink turns elapsed time into whole 60 Hz input ticks', () => {
  const sent = [];
  const up = createUplink({ send: (m) => sent.push(m) });
  const keys = { KeyW: true };
  for (let i = 0; i < 60; i++) up.pump(SIM_DT, keys, { active: false });
  const ticks = sent.flatMap((m) => m.ticks);
  assert.equal(ticks.length, 60, 'one input per sim tick');
  assert.deepEqual(ticks.map((t) => t.t), [...Array(60).keys()], 'numbered in order, with no gaps');
  assert.deepEqual(ticks[0].k, ['KeyW']);
});

test('the uplink batches rather than sending a packet per tick', () => {
  const sent = [];
  const up = createUplink({ send: (m) => sent.push(m) });
  for (let i = 0; i < 30; i++) up.pump(SIM_DT, {}, { active: false });
  assert.equal(sent.length, 30 / INPUT_BATCH, `${INPUT_BATCH} ticks per message`);
});

test('a backgrounded tab does not dump a thousand stale ticks on the room', () => {
  const sent = [];
  const up = createUplink({ send: (m) => sent.push(m) });
  up.pump(30, {}, { active: false }); // thirty seconds in one frame
  const ticks = sent.flatMap((m) => m.ticks);
  assert.ok(ticks.length <= 6, `capped catch-up (sent ${ticks.length})`);
  // And it resumes in the present: the next real frame produces one tick, not a backlog.
  sent.length = 0;
  for (let i = 0; i < 3; i++) up.pump(SIM_DT, {}, { active: false });
  assert.equal(sent.flatMap((m) => m.ticks).length, 3);
});

test('flush sends a partial batch (so releasing a key is not held back)', () => {
  const sent = [];
  const up = createUplink({ send: (m) => sent.push(m) });
  up.pump(SIM_DT, {}, { active: false });
  assert.equal(sent.length, 0, 'below the batch size');
  up.flush();
  assert.equal(sent.length, 1);
  up.flush();
  assert.equal(sent.length, 1, 'flushing an empty buffer sends nothing');
});

test('touch aim rides along in the recorded-tick shape', () => {
  const sent = [];
  const up = createUplink({ send: (m) => sent.push(m), batch: 1 });
  const aim = { active: true, heading: 1.2345, thrust: 0.5 };
  up.pump(SIM_DT, {}, aim);
  // Compared against snapshotInput itself, not against a hardcoded pair: the CONTRACT is that the uplink
  // and the session recorder speak the identical dialect, so the recorder is the right oracle for it.
  assert.deepEqual(sent[0].ticks[0].a, snapshotInput({}, aim).t);
  assert.ok(sent[0].ticks[0].a[0] !== 1.2345, 'and it really is quantized, not passed through raw');
});

test('connectNetsim does not hand back a handle until the socket is OPEN', async () => {
  // A WebSocket starts in CONNECTING, where send() is a silent no-op. Returning a handle then produced one
  // that swallowed the first message — which was `start`, so the room joined and never stepped.
  const events = {};
  let readyState = 0;
  class FakeWS {
    constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 1; readyState = 1; events.open?.(); }, 20); }
    addEventListener(type, fn) { events[type] = fn; }
    send() { this.sentWhileConnecting = this.readyState !== 1; }
    close() {}
  }
  const fetchFn = async () => ({ ok: true, json: async () => ({ ticket: 't' }) });
  const link = await connectNetsim({ playerId: 'p', origin: 'http://x', fetchFn, WebSocketImpl: FakeWS });
  assert.ok(link, 'connected');
  assert.equal(readyState, 1, 'it waited for open');
  link.start();
  assert.notEqual(link.ws.sentWhileConnecting, true, 'start was sent on an OPEN socket, not dropped');
});

test('a socket that dies during the handshake reports an error instead of a half-handle', async () => {
  const events = {};
  class DyingWS {
    constructor() { this.readyState = 0; setTimeout(() => events.close?.(), 10); }
    addEventListener(type, fn) { events[type] = fn; }
    send() {} close() {}
  }
  const fetchFn = async () => ({ ok: true, json: async () => ({ ticket: 't' }) });
  const errors = [];
  const link = await connectNetsim({ playerId: 'p', origin: 'http://x', fetchFn, WebSocketImpl: DyingWS,
                                     onError: (e) => errors.push(e) });
  assert.equal(link, null);
  assert.equal(errors.length, 1);
});

test('netsim defers to any record/playback session', () => {
  // The intro rides the ?playback machinery, armed programmatically at bootstrap — so `playback` is truthy
  // without the flag ever appearing in the URL. Running a room alongside it stepped a second fight behind
  // the replay, which is how it was found.
  assert.equal(netsimDefersTo({ record: null, playback: null }), false, 'a plain session is netsim\'s to drive');
  assert.equal(netsimDefersTo({ record: null, playback: { id: 'x' } }), true, '?playback / the intro owns the tick');
  assert.equal(netsimDefersTo({ record: { level: 'level-0' }, playback: null }), true, '?record owns it too');
});

test('netsim stands aside for ROAM — free flight is not a room fight', () => {
  // A room only knows how to run a LEVEL and starts one as soon as it is told to. A tab that took off into
  // roam therefore had the campaign level being fought on the server while the player was still cruising:
  // the fight began with no fly-in countdown, and the roam nav bar sat on top of the combat HUD because the
  // client never left roam. Shared roam is a non-goal for this cut, so netsim waits for the mission.
  assert.equal(netsimDeferReason({ roam: true }), 'roam');
  assert.equal(netsimDeferReason({ roam: false }), null, 'and drives again the moment the mission engages');
  // A replay still outranks it — that conflict is the more fundamental one.
  assert.equal(netsimDeferReason({ roam: true, playback: { id: 'x' } }), 'replay');
});

test('netsim stands aside for a side mission, and says so', () => {
  // A side mission's descriptor is generated per player and is in no room's level table. The socket opens
  // during the MENU, when activeMission is still null, and the mission is picked AFTER — so deciding this
  // once at connect let a room start the campaign level while the tab flew a side mission.
  assert.equal(netsimDeferReason({ sideMission: true }), 'side-mission');
  assert.equal(netsimDeferReason({ playback: { id: 'x' } }), 'replay');
  assert.equal(netsimDeferReason({ record: { level: 'level-0' } }), 'replay');
  assert.equal(netsimDeferReason({}), null, 'a plain campaign run is netsim\'s to drive');
  // A replay wins the reason when both are true — it is the more fundamental conflict.
  assert.equal(netsimDeferReason({ playback: { id: 'x' }, sideMission: true }), 'replay');
  assert.equal(netsimDefersTo({ sideMission: true }), true, 'the boolean shorthand agrees');
});

test('a deliberate close does not look like the socket dying', async () => {
  // THE BUG: leaving a room on purpose (a replay taking over, a side mission, a level change) called
  // close(), which fired onclose, which the caller read as a failure and used to disable netsim for the
  // whole tab. So every planned hand-off to the local sim was permanent — the badge sat on "failed" and
  // only a page reload brought it back.
  const events = {};
  class FakeWS {
    constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 1; events.open?.(); }, 5); }
    addEventListener(type, fn) { events[type] = fn; }
    send() {}
    close() { this.closed = true; this.onclose?.({ code: 1000 }); }
  }
  const fetchFn = async () => ({ ok: true, json: async () => ({ ticket: 't' }) });
  let closes = 0, errors = 0;
  const link = await connectNetsim({ playerId: 'p', origin: 'http://x', fetchFn, WebSocketImpl: FakeWS,
                                     onClose: () => closes++, onError: () => errors++ });
  assert.ok(link);
  link.close();
  assert.equal(link.ws.closed, true, 'the socket really was closed');
  assert.equal(closes, 0, 'but nobody was told it "died" — this teardown was on purpose');
  assert.equal(errors, 0);
});

test('a socket that dies on its own DOES notify', async () => {
  // The other half: an unexpected death has to reach the caller, or the tab sits on a dead room.
  const events = {};
  class FakeWS {
    constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 1; events.open?.(); }, 5); }
    addEventListener(type, fn) { events[type] = fn; }
    send() {} close() {}
  }
  const fetchFn = async () => ({ ok: true, json: async () => ({ ticket: 't' }) });
  let closes = 0;
  const link = await connectNetsim({ playerId: 'p', origin: 'http://x', fetchFn, WebSocketImpl: FakeWS,
                                     onClose: () => closes++ });
  link.ws.onclose({ code: 1006 });   // the server went away
  assert.equal(closes, 1);
});

// The ?netjerk flag is matched against the raw query, not through URLSearchParams — see main.js. A flag a
// human has to retype from a chat window will pick up punctuation, and a diagnostic that silently does not
// arm is worse than no diagnostic. Kept here as the contract, next to the other flag parsing.
// The drawn-motion probe arms itself on a local dev host and takes a flag everywhere else — the rule lives
// in main.js, which no test can import, so the predicate is mirrored here. It exists because a diagnostic
// that has to be switched on by hand was off for both of the runs that mattered: once because the URL had
// picked up a trailing comma, once because it simply was not typed.
const netjerkArmed = (search, hostname) => {
  const m = /(^|[?&])netjerk(=([^&]*))?/i.exec(search);
  const off = !!(m && /^(0|false|off)$/i.test((m[3] || '')));
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(hostname || '');
  return !off && (!!m || local);
};

test('the netjerk probe is on by default locally, and off in the wild without asking', () => {
  assert.equal(netjerkArmed('?netsim=1', 'localhost'), true, 'no flag needed while developing');
  assert.equal(netjerkArmed('', '127.0.0.1'), true);
  assert.equal(netjerkArmed('?netsim=1', 'vega.tenony.com'), false, 'and never a cost a player pays silently');
  assert.equal(netjerkArmed('?netsim=1&netjerk', 'vega.tenony.com'), true, 'unless it is asked for');
});

test('the netjerk flag survives the punctuation a URL picks up in transit, and can be switched off', () => {
  assert.equal(netjerkArmed('?netsim=1&netjerk,', 'vega.tenony.com'), true, 'a trailing comma is what actually happened');
  assert.equal(netjerkArmed('?netjerk&netsim=1', 'vega.tenony.com'), true);
  assert.equal(netjerkArmed('?netjerk=1', 'vega.tenony.com'), true);
  assert.equal(netjerkArmed('?netsim=1&netjerk=0', 'localhost'), false, 'and the local default can be silenced');
  assert.equal(netjerkArmed('?netjerk=off', 'localhost'), false);
  assert.equal(netjerkArmed('?nonetjerk=1', 'vega.tenony.com'), false, 'not matched inside another name');
});

test('a player without ?netsim is not thrown at when a side mission is active', () => {
  // The bug this pins, which reached `main` and was caught by the visual suite on three scenarios at once:
  // the frame loop read `NETSIM.level` unconditionally, and `NETSIM` is null for everyone who has not put
  // the flag on their URL. Short-circuiting hid it until a mission was ACTIVE — and then it threw once per
  // frame and took the rest of the frame with it. Every playtest had the flag on, so no playtest saw it.
  assert.doesNotThrow(() => isUnroomableSideMission(null, { id: 'side-mining' }));
  assert.equal(isUnroomableSideMission(null, { id: 'side-mining' }), true,
    'no room exists at all, so a mission is certainly not one a room can fight');
  assert.equal(isUnroomableSideMission(null, null), false, 'and no mission is no reason to stand aside');

  // With the flag: a bare `?netsim=1` follows the client's level, so a side mission is the reason to defer…
  assert.equal(isUnroomableSideMission({ level: null, seed: null }, { id: 'side-research' }), true);
  // …while an explicit `?netsim=level-2` names a campaign level, and a mission alongside it does not.
  assert.equal(isUnroomableSideMission({ level: 'level-2', seed: null }, { id: 'side-research' }), false);
  assert.equal(isUnroomableSideMission({ level: 'level-2', seed: null }, null), false);
});
