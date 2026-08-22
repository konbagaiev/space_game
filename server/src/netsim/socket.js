// The WebSocket endpoint: one socket, one room, for as long as the socket lives.
//
// Attached to the HTTP server rather than to Express, because a WebSocket arrives as an `upgrade` on the
// raw server. `attachNetsim(httpServer, { tickets })` is called once at boot (and by the tests, on their
// own ephemeral listener).
//
// The connection is gated by a single-use ticket the client fetched over the ordinary authenticated HTTP
// API (`tickets.js`, plan §5). `Origin` is logged, never trusted.
//
// Scope for this cut: ONE player per room, no reconnect, no matchmaking (plan §6). A dropped socket ends
// its room — there is nothing to preserve, since single-player still banks through the client's own
// `POST /api/games`.
import { WebSocketServer } from 'ws';
import { createRoom } from './room.js';
import { createDriver } from './driver.js';

export const WS_PATH = '/ws';
// A room with nobody on the other end is a leak, and liveness is measured at the TRANSPORT, not in the game
// loop. That distinction is the whole of a bug that reached production: the client's keep-alive was sent
// from its render loop, and a browser stops rendering a hidden tab completely — so a player who switched
// tabs for half a minute was declared abandoned, had their socket closed, and came back to a run whose
// enemies had been swept away and whose level script was waiting for kills that could no longer happen.
//
// A WebSocket PING is answered by the browser's network stack without running a line of the page's
// JavaScript, so it stays true while the tab is frozen — which is exactly the property "is anyone there"
// needs and "is the page running" does not.
export const PING_EVERY_MS = 10_000;
// Two missed pings. Long enough to ride out a slow network, short enough that a dead socket is not a room
// stepping at 60 Hz for nobody.
export const IDLE_TIMEOUT_MS = 30_000;
// A cap on concurrent rooms — one box, 60 Hz each. Small on purpose for a first cut; raise by measurement.
export const MAX_ROOMS = 32;

// `loadShip(playerId)` resolves the player's ACTIVE ship from the account — read server-side on purpose.
// The room used to build the catalog's default starter ship for everyone, so a netsim run ignored every
// weapon, hull and skill point the player owned. Taking it from the DB rather than from the client also
// means a client cannot claim a better ship than it has.
// `bankRun({ playerId, kind, credits, xp, kills, durationMs, loot, level })` persists what a room's run was
// worth. Injected rather than imported so this file stays free of the database and the tests can watch it.
// Called with a playerId that came from the handshake TICKET — the client never names itself — and with
// figures the ROOM's own simulation produced, which is the whole point of DECISIONS §131.
// What a room does with the run it just decided. Its own function because the ONE property that matters
// here is a property of this code and not of the room: **the identity is the server's, never the payload's.**
// `playerId` comes from the redeemed handshake ticket and is written LAST, so no field arriving with the
// run — however it got there — can substitute another account. The rest is deliberately boring.
export function makeEconomySink({ playerId, level, bankRun, log = console }) {
  if (!bankRun) return null;   // no banker wired (tests, a bare app) → the room simply reports to nobody
  return (run) => {
    // Best-effort and never in the room's way: a failed write must not kill a live fight, and the player
    // has already been shown what they earned. Logged loudly, because quietly losing somebody's credits is
    // the one failure here that nobody would ever notice.
    Promise.resolve(bankRun({ ...run, level, playerId }))
      .then(() => log.info?.(`[netsim] banked player=${playerId} ${run.kind} `
        + `credits=${run.credits} xp=${run.xp} kills=${run.kills} loot=${(run.loot || []).length}`))
      .catch((err) => log.warn?.(`[netsim] BANK FAILED player=${playerId}: ${err && err.message}`));
  };
}

export function attachNetsim(httpServer, { tickets, loadShip = null, bankRun = null, log = console,
                                          pingEveryMs = PING_EVERY_MS, idleTimeoutMs = IDLE_TIMEOUT_MS } = {}) {
  const wss = new WebSocketServer({ noServer: true });
  const sessions = new Set();

  httpServer.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return destroy(socket, 400); }
    if (url.pathname !== WS_PATH) return; // not ours — leave it for anything else listening
    const redeemed = tickets.redeem(url.searchParams.get('ticket'));
    if (!redeemed) return destroy(socket, 401);
    if (sessions.size >= MAX_ROOMS) return destroy(socket, 503);
    wss.handleUpgrade(req, socket, head, (ws) => {
      log.info?.(`[netsim] join player=${redeemed.playerId} origin=${req.headers.origin || '-'}`);
      open(ws, redeemed, url.searchParams);
    });
  });

  function open(ws, { playerId }, params) {
    // MESSAGES ARE BUFFERED FROM THE FIRST INSTANT. Setting the room up needs a database read, and a client
    // sends `start` the moment it sees `welcome` — so anything that arrives during the await would be lost
    // if the listener were attached afterwards. It was: the room joined and then never stepped a single
    // tick, because `start` fell into the gap.
    const pending = [];
    let deliver = (msg) => pending.push(msg);
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; } // a malformed frame is dropped, never fatal
      deliver(msg);
    });

    (async () => {
      const levelName = params.get('level') || 'level-0';
      const seed = (Number(params.get('seed')) >>> 0) || (Math.random() * 0xffffffff) >>> 0;
      // The player's real ship, from their account. A lookup failure is not fatal — the room falls back to
      // the catalog default, which is what every room used to fly.
      let ship = {};
      try {
        const active = loadShip ? await loadShip(playerId) : null;
        if (active && active.ship) {
          ship = { shipId: active.ship.id, loadout: active.loadout, components: active.components,
                   skills: active.progression && active.progression.skills };
        }
      } catch (err) { log.warn?.(`[netsim] could not load the ship for ${playerId}: ${err.message}`); }

      let room;
      try {
        room = createRoom({ levelName, seed, ship,
          onEconomy: makeEconomySink({ playerId, level: levelName, bankRun, log }) });
      } catch (err) {
        // An unknown level is the client's mistake, not a crash: say so and close.
        send(ws, { type: 'error', error: String(err.message || err) });
        return ws.close(1008, 'bad room');
      }

      const driver = createDriver(room, { onSnapshot: (snap) => send(ws, snap) });
      const session = { ws, room, driver, playerId, lastSeen: Date.now() };
      sessions.add(session);

      send(ws, { ...room.welcome(), seed, playerId });
      // The room does NOT start stepping on join. A client connects while the player is still on a menu —
      // the handshake takes a couple of seconds on a cold page, and paying that after take-off left the ship
      // dead and unresponsive for exactly that long. So the socket is established early and the fight begins
      // when the client says `start`; otherwise the level would also be spawning enemies into an empty hangar.

      deliver = (msg) => {
        session.lastSeen = Date.now();
        if (msg.type === 'input') room.pushInput(msg.ticks);
        // Both begin a run; `start` is simply the first one on this link. Either may carry a pose, which
        // means "the fight begins around the ship where it already is" (a mission flown into).
        else if (msg.type === 'start') { room.restart(msg.pose || null); driver.start(); }
        else if (msg.type === 'restart') { room.restart(msg.pose || null); driver.start(); }
        else if (msg.type === 'autopilot') room.command(msg.cmd);
        // Pause is a REAL freeze here, and it is legitimate precisely because a room holds one player
        // (DECISIONS §123 forbids it for a SHARED world — when rooms hold more than one, this must go).
        else if (msg.type === 'pause') driver.stop();
        else if (msg.type === 'resume') driver.start();
        else if (msg.type === 'ping') { /* `lastSeen` above is the whole point of it */ }
        else if (msg.type === 'bye') ws.close(1000, 'bye');
      };
      for (const m of pending) deliver(m);   // whatever arrived while the ship was being read
      pending.length = 0;

      // Liveness: ping the peer, and let the PONG (or any message) count as being alive. A hidden tab sends
      // nothing of its own and still answers this.
      ws.on('pong', () => { session.lastSeen = Date.now(); });
      const idle = setInterval(() => {
        if (Date.now() - session.lastSeen > idleTimeoutMs) return ws.close(1001, 'idle');
        if (ws.readyState === ws.OPEN) { try { ws.ping(); } catch { /* the close path will deal with it */ } }
      }, pingEveryMs);
      // A liveness timer must never be the reason a process stays alive. Without this the test runner hangs
      // after the last assertion has passed — which is a worse failure than a red test, because it looks
      // like the suite is still working.
      idle.unref?.();

      const teardown = () => {
        clearInterval(idle);
        driver.stop();
        sessions.delete(session);
        log.info?.(`[netsim] leave player=${playerId} ticks=${room.tick} behind=${driver.behind}`);
      };
      ws.on('close', teardown);
      ws.on('error', teardown);
    })().catch((err) => {
      log.warn?.(`[netsim] join failed for ${playerId}: ${err && err.message}`);
      try { ws.close(1011, 'join failed'); } catch {}
    });
  }

  return {
    get rooms() { return sessions.size; },
    // Stop every room — used by the tests, and by a graceful shutdown.
    closeAll(code = 1001, reason = 'server closing') {
      for (const s of [...sessions]) { s.driver.stop(); try { s.ws.close(code, reason); } catch {} }
      sessions.clear();
      wss.close();
    },
  };
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function destroy(socket, status) {
  const text = { 400: 'Bad Request', 401: 'Unauthorized', 503: 'Service Unavailable' }[status] || 'Error';
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
