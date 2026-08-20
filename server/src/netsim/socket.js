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
// A room with nobody talking to it is a leak. The client sends input ~15×/s, so silence this long means the
// peer is gone in a way the socket has not noticed yet.
export const IDLE_TIMEOUT_MS = 30_000;
// A cap on concurrent rooms — one box, 60 Hz each. Small on purpose for a first cut; raise by measurement.
export const MAX_ROOMS = 32;

// `loadShip(playerId)` resolves the player's ACTIVE ship from the account — read server-side on purpose.
// The room used to build the catalog's default starter ship for everyone, so a netsim run ignored every
// weapon, hull and skill point the player owned. Taking it from the DB rather than from the client also
// means a client cannot claim a better ship than it has.
export function attachNetsim(httpServer, { tickets, loadShip = null, log = console } = {}) {
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
        room = createRoom({ levelName, seed, ship });
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
        else if (msg.type === 'start') driver.start();
        else if (msg.type === 'restart') { room.restart(); driver.start(); }
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

      const idle = setInterval(() => {
        if (Date.now() - session.lastSeen > IDLE_TIMEOUT_MS) ws.close(1001, 'idle');
      }, 5_000);

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
