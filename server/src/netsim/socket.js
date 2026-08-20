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

export function attachNetsim(httpServer, { tickets, log = console } = {}) {
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
    const levelName = params.get('level') || 'level-0';
    const seed = (Number(params.get('seed')) >>> 0) || (Math.random() * 0xffffffff) >>> 0;
    let room;
    try {
      room = createRoom({ levelName, seed });
    } catch (err) {
      // An unknown level is the client's mistake, not a crash: say so and close.
      send(ws, { type: 'error', error: String(err.message || err) });
      return ws.close(1008, 'bad room');
    }

    const driver = createDriver(room, { onSnapshot: (snap) => send(ws, snap) });
    const session = { ws, room, driver, playerId, lastSeen: Date.now() };
    sessions.add(session);

    send(ws, { ...room.welcome(), seed, playerId });
    driver.start();

    ws.on('message', (data) => {
      session.lastSeen = Date.now();
      let msg;
      try { msg = JSON.parse(data); } catch { return; } // a malformed frame is dropped, never fatal
      if (msg && msg.type === 'input') room.pushInput(msg.ticks);
      else if (msg && msg.type === 'bye') ws.close(1000, 'bye');
    });

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
