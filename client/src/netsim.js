// The client end of a server-run fight: the `?netsim` flag, the handshake, and the input uplink.
//
// Opt-in and additive. Without the flag nothing here runs and single-player is exactly what it was — which
// is the decision, not an accident: routing single-player through a socket would make a network blip cost a
// fight in progress, and it would let the browser simulation path atrophy, taking the divergence oracle
// with it (docs/plans/server-authoritative-sim.md D1).
//
// This module owns the TRANSPORT. What arrives is handed to `netsim-world.js`, which writes it into the
// World; that split is what keeps reconciliation unit-testable without a browser or a socket.
//
// The uplink deliberately speaks `replay.js`'s recorded-tick shape (`{ k, t }` plus a tick number). The
// client already produces exactly that 60 times a second for session recording, the headless referee
// already consumes it, and a third dialect would be a third thing to keep in sync.
import { API_BASE } from './api-base.js';
import { SIM_DT } from './sim-core/consts.js';
import { snapshotInput } from './replay.js';

// Input ticks per outbound message. 3 → ~20 messages/s carrying 60 ticks/s of input. Batching costs a
// couple of milliseconds of added latency and saves two thirds of the packets; upstream is a handful of
// bytes either way (plan D4).
export const INPUT_BATCH = 3;
// The uplink is deliberately allowed to run ahead of the room a little — see `pump`.
export const MAX_PENDING_TICKS = 240;

// `?netsim` / `?netsim=1` → { level, seed } | null. URL-only, never sticky: this is an experiment you opt
// into per visit, and a flag that survived a reload would silently keep a player on the socket path.
// `?netsim=level-2` names an explicit level; `&seed=N` pins the room's RNG so a session is reproducible.
//
// A bare `?netsim=1` yields `level: null`, meaning "whatever level this player is actually on". It must
// NOT default to level-0: the client builds the map, the set-pieces and the arena centre for the player's
// CURRENT level at take-off, so a room running a different one puts the fight somewhere else entirely —
// enemies spawn around the room's arena centre while the player looks at another level's scenery. That
// reads exactly like "the enemy appeared in the wrong place", which is how it was found.
export function evalNetsim(search) {
  const p = new URLSearchParams(search || '');
  if (!p.has('netsim')) return null;
  const v = p.get('netsim');
  if (v === '0' || v === 'false' || v === 'off') return null;
  const level = (v && v !== '' && v !== '1' && v !== 'true') ? v : null; // null = follow the client's level
  const seedRaw = p.get('seed');
  const seed = seedRaw != null && /^\d+$/.test(seedRaw) ? Number(seedRaw) : null;
  return { level, seed };
}

// Why netsim is NOT driving this frame — or null when it is. Returns a reason string, so the console
// handle can answer "why am I not in a room" without anyone reading the loop.
//
// This must be re-evaluated EVERY FRAME, not once at connect. Both reasons arrive after the socket is
// already open, and both were shipped as bugs by checking too early:
//
//   'replay'      — `?record`, `?playback`, and the Level-0 intro cutscene, which rides the same machinery
//                   and is armed programmatically at bootstrap. They replay the LOCAL simulation from a
//                   seed and a list of inputs and own the tick. A room alongside one steps a second,
//                   invisible fight: the cutscene card froze the replay while the server kept simulating.
//   'side-mission'— a side mission's descriptor is generated per player by `missions.js` and appears in no
//                   room's level table, so there is nothing for a room to fight. The socket opens during
//                   the MENU, when `activeMission` is still null, and the player picks the mission after —
//                   so checking only at connect let the room start the CAMPAIGN level while the tab flew a
//                   side mission, which is the "enemy in the wrong place" failure all over again.
//
// Deferring is not disabling: the link is dropped and netsim reconnects once the reason clears.
export function netsimDeferReason({ record, playback, sideMission }) {
  if (record || playback) return 'replay';
  if (sideMission) return 'side-mission';
  return null;
}

// Back-compat shorthand for the boolean form.
export function netsimDefersTo(state) { return netsimDeferReason(state) !== null; }

// Build the socket URL from the page's origin (or the configured API base), swapping the scheme. Kept pure
// so the mapping http→ws / https→wss is testable; getting it wrong on the itch build would be a silent
// mixed-content failure with no error worth reading.
export function wsUrl({ apiBase = API_BASE, origin, ticket, level, seed }) {
  const base = apiBase || origin;
  const u = new URL('/ws', base);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.searchParams.set('ticket', ticket);
  if (level) u.searchParams.set('level', level);
  if (seed != null) u.searchParams.set('seed', String(seed));
  return u.toString();
}

// The uplink's clock: turn real elapsed time into whole 60 Hz input ticks and batch them.
//
// Separate from the room's clock on purpose — the client cannot know the server's tick, and does not need
// to: it numbers its own ticks, the room echoes the last one it applied as `ack`, and that is enough for
// Slice E to know which inputs are still unacknowledged. Running slightly AHEAD of the room is normal and
// desirable: the room's queue should never be empty when it steps, or it repeats stale input.
export function createUplink({ send, batch = INPUT_BATCH }) {
  let acc = 0;
  let tick = 0;
  let pending = [];
  let lastSent = null; // the most recent batch, for the ?netsim console handle
  return {
    get tick() { return tick; },
    get pendingCount() { return pending.length; },
    get lastSent() { return lastSent; },
    // Advance by `dtSeconds` of real time, sampling `keys`/`touchAim` for each whole tick that elapsed.
    pump(dtSeconds, keys, touchAim) {
      acc += dtSeconds;
      // A tab that was backgrounded comes back with a huge dt. Sending a thousand identical input ticks
      // would just overflow the room's queue and get the oldest dropped, so cap the catch-up the same way
      // the local accumulator does.
      let steps = 0;
      while (acc >= SIM_DT && steps < 6) {
        const s = snapshotInput(keys, touchAim);
        pending.push({ t: tick++, k: s.k, a: s.t });
        acc -= SIM_DT;
        steps++;
      }
      if (acc >= SIM_DT) acc = 0; // fell behind: resume in the present rather than fast-forwarding input
      if (pending.length >= batch) this.flush();
      if (pending.length > MAX_PENDING_TICKS) pending = pending.slice(-MAX_PENDING_TICKS);
    },
    flush() {
      if (!pending.length) return;
      lastSent = pending;
      send({ type: 'input', ticks: pending });
      pending = [];
    },
  };
}

// Fetch a ticket, open the socket, and hand messages to the caller. Returns a handle with `close()`.
//
// Failure is quiet and total: if the ticket or the socket fails there is no half-connected state to reason
// about, `onError` fires once, and the caller decides what the player sees.
export async function connectNetsim({ playerId, level, seed, origin = location.origin,
                                      onWelcome, onSnapshot, onClose, onError,
                                      fetchFn = fetch, WebSocketImpl = WebSocket } = {}) {
  let res;
  try {
    res = await fetchFn(`${API_BASE}/api/ws-ticket`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });
  } catch (err) { onError?.(err); return null; }
  if (!res.ok) { onError?.(new Error(`ws-ticket ${res.status}`)); return null; }
  const { ticket } = await res.json();

  const ws = new WebSocketImpl(wsUrl({ origin, ticket, level, seed }));
  // Attached BEFORE the socket opens: the room sends `welcome` the instant the upgrade completes, so a
  // handler installed on `open` races it and loses the message.
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'welcome') onWelcome?.(msg);
    else if (msg.type === 'snap') onSnapshot?.(msg);
    else if (msg.type === 'error') onError?.(new Error(msg.error));
  };
  ws.onclose = (ev) => onClose?.(ev);
  ws.onerror = (err) => onError?.(err);

  // WAIT FOR THE SOCKET TO OPEN before handing back a handle. A `WebSocket` is constructed in CONNECTING
  // state and anything sent then is dropped on the floor — silently, since `send` can only check
  // `readyState`. Returning early therefore produced a handle that looked connected and swallowed the
  // first message sent through it, which was `start`: the room joined and then never stepped, and the
  // player sat in a fight that was not running. A handle means USABLE.
  const opened = await new Promise((resolve) => {
    if (ws.readyState === 1) return resolve(true);
    ws.addEventListener?.('open', () => resolve(true), { once: true });
    ws.addEventListener?.('close', () => resolve(false), { once: true });
    if (!ws.addEventListener) { const prev = ws.onopen; ws.onopen = (e) => { prev?.(e); resolve(true); }; }
  });
  if (!opened) { onError?.(new Error('socket closed before it opened')); return null; }

  const uplink = createUplink({ send: (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); } });
  const send = (m) => { try { if (ws.readyState === 1) ws.send(JSON.stringify(m)); } catch {} };
  let lastPing = 0;
  return {
    ws, uplink,
    pump: (dt, keys, touchAim) => uplink.pump(dt, keys, touchAim),
    // Begin the fight. Connecting and starting are separate so the handshake can happen while the player
    // is still on a menu — paying it after take-off is two seconds of a ship that does not answer.
    start() { send({ type: 'start' }); },
    // Begin a FRESH run in the same room — a retry, or the next level after an advance.
    restart() { uplink.flush(); send({ type: 'restart' }); },
    // Ask the room to stop / resume stepping. A room holds one player, so this is a true freeze rather
    // than the lie a pause button in a shared world would be (DECISIONS §16).
    setPaused(paused) { uplink.flush(); send({ type: paused ? 'pause' : 'resume' }); },
    // A paused client sends no input, and the room drops a socket that has said nothing for 30 s — so a
    // long pause would silently end the session and drop the player back to the local simulation. Called
    // every frame while paused; rate-limits itself.
    keepAlive(now = Date.now()) { if (now - lastPing > 5000) { lastPing = now; send({ type: 'ping' }); } },
    // A DELIBERATE teardown is silent: the close/error handlers are detached first, so leaving a room on
    // purpose (a replay taking over the tick, a side mission, a level change) cannot be mistaken for the
    // socket dying. It was — `close()` fired `onclose`, the caller treated that as a failure and disabled
    // netsim for the whole tab, so every planned hand-off to the local sim was permanent.
    close() {
      uplink.flush();
      send({ type: 'bye' });
      ws.onclose = null; ws.onerror = null;
      try { ws.close(); } catch {}
    },
  };
}
