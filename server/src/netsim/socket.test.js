// The netsim endpoint end to end: a real HTTP server, a real ticket, a real WebSocket.
//
// What this covers that `room.test.js` cannot: the handshake gate, that a snapshot actually reaches a peer
// as JSON, that input sent over the wire moves the ship, and that a room is torn down when its socket goes.
// The simulation itself is asserted in `room.test.js` against the headless referee — this is the transport.
//
// Everything here is driven by real sockets, so it does wait on I/O; what it must NOT do is wait on the
// SIMULATION clock to reach some state, which would be a CPU test. Waits are for "did a message arrive".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { WebSocket } from 'ws';
import { createTicketStore } from './tickets.js';
import { attachNetsim, WS_PATH, IDLE_TIMEOUT_MS } from './socket.js';

let server, base, wsBase, tickets, netsim;

before(async () => {
  // A bare Express app, not the real one: this suite is about the socket, and the real app wants Postgres.
  const app = express();
  app.use(express.json());
  tickets = createTicketStore();
  app.post('/api/ws-ticket', (req, res) => res.json(tickets.issue(String(req.body.playerId))));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  // A real `warn` here on purpose: a join that throws is otherwise a silent close, and this suite spent a
  // run reporting eight mystery timeouts for a one-line ReferenceError.
  netsim = attachNetsim(server, { tickets, log: { warn: (m) => console.error(m) } });
  base = `http://localhost:${server.address().port}`;
  wsBase = `ws://localhost:${server.address().port}${WS_PATH}`;
});

after(() => { netsim.closeAll(); server.close(); });

// Sockets close asynchronously, so a test that asserts on the ROOM COUNT has to wait for its predecessors
// to be reaped first. Absolute counts were flaky without this as the suite grew.
async function settle(ms = 2000) {
  const deadline = Date.now() + ms;
  while (netsim.rooms > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
}

const getTicket = async (playerId = 'p-test') => (await (await fetch(`${base}/api/ws-ticket`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId }),
})).json()).ticket;

// Messages are BUFFERED from construction, not from `open`. The server sends `welcome` the instant the
// upgrade completes, so a listener attached after the client's `open` event races it and loses the message
// — which is a test artifact, not a protocol flaw (a real client sets `onmessage` before the socket opens),
// but it is a race that would have made this whole suite flaky.
const openSocket = (query) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${wsBase}?${query}`);
  ws.inbox = [];
  ws.on('message', (data) => { ws.inbox.push(JSON.parse(data)); ws.emit('inbox'); });
  ws.once('open', () => resolve(ws));
  ws.once('error', reject);
  ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error('handshake refused'), { status: res.statusCode })));
});

// Resolve on the first buffered-or-future message matching `pred`, or reject after `ms`.
function waitFor(ws, pred, ms = 5000) {
  const found = () => ws.inbox.find(pred);
  const already = found();
  if (already) return Promise.resolve(already);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('timed out waiting for a message')); }, ms);
    const onInbox = () => { const m = found(); if (m) { cleanup(); resolve(m); } };
    const onClose = () => { const m = found(); cleanup(); m ? resolve(m) : reject(new Error('socket closed while waiting')); };
    function cleanup() { clearTimeout(timer); ws.off('inbox', onInbox); ws.off('close', onClose); }
    ws.on('inbox', onInbox); ws.on('close', onClose);
  });
}

test('a socket without a ticket is refused', async () => {
  await assert.rejects(() => openSocket('level=level-0'), (e) => e.status === 401);
});

test('a ticket cannot be used twice', async () => {
  const ticket = await getTicket();
  const ws = await openSocket(`ticket=${ticket}`);
  await assert.rejects(() => openSocket(`ticket=${ticket}`), (e) => e.status === 401);
  ws.close();
});

test('a joined room does not step until the client says start', async () => {
  const ws = await openSocket(`ticket=${await getTicket()}&seed=5`);
  await waitFor(ws, (m) => m.type === 'welcome');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(ws.inbox.filter((m) => m.type === 'snap').length, 0,
    'no snapshots before `start` — a client connects while the player is still on a menu, and the level '
    + 'must not spawn enemies into an empty hangar');
  ws.send(JSON.stringify({ type: 'start' }));
  const snap = await waitFor(ws, (m) => m.type === 'snap');
  assert.ok(snap.tick > 0, 'and it begins the moment we ask');
  ws.close();
});

test('a joined client gets a welcome, then snapshots', async () => {
  const ws = await openSocket(`ticket=${await getTicket()}&level=level-0&seed=1234`);
  const welcome = await waitFor(ws, (m) => m.type === 'welcome');
  ws.send(JSON.stringify({ type: 'start' }));
  assert.equal(welcome.level, 'level-0');
  assert.equal(welcome.seed, 1234, 'the room used the seed we asked for — replayable');
  assert.equal(welcome.enemyTotal, 4);
  assert.ok(welcome.dt > 0 && welcome.dt < 0.02, 'the fixed sim step, shared with the browser');
  assert.ok(welcome.station, 'the home station is placed — docking decides the win');

  const snap = await waitFor(ws, (m) => m.type === 'snap');
  assert.ok(snap.tick > 0);
  assert.ok(Number.isFinite(snap.player.x) && Number.isFinite(snap.player.z));
  assert.equal(snap.player.alive, true);
  assert.equal(snap.run.enemyTotal, 4);
  ws.close();
});

test('input sent over the wire is applied, and acked', async () => {
  const ws = await openSocket(`ticket=${await getTicket()}&seed=99`);
  await waitFor(ws, (m) => m.type === 'welcome');
  ws.send(JSON.stringify({ type: 'start' }));
  const before = await waitFor(ws, (m) => m.type === 'snap');
  const speed = (p) => Math.hypot(p.vx, p.vz);
  // A run opens gliding forward at 10% of top speed, and with NO input that drift decays (IDLE_DRAG). So
  // "the ship moved" proves nothing — "the ship SPED UP" is what only thrust can do. 40 ticks is enough to
  // separate the two clearly and keeps this to ~0.7 s of real time.
  // Fed the way a real client feeds — a small batch every frame. Dumping 60 ticks at once would be a
  // BURST, and the room deliberately fast-forwards through a backlog (INPUT_QUEUE_TARGET), so most of that
  // thrust would be retired without ever being simulated. That is correct behaviour; it just is not this
  // test's subject.
  let sent = 0;
  const feeder = setInterval(() => {
    ws.send(JSON.stringify({ type: 'input',
      ticks: [0, 1, 2].map((n) => ({ t: sent + n, k: ['KeyW'], a: null })) }));
    sent += 3;
  }, 50);
  const acked = await waitFor(ws, (m) => m.type === 'snap' && Math.hypot(m.player.vx, m.player.vz) > 12, 15000);
  clearInterval(feeder);
  assert.ok(acked.ack != null && acked.ack > 0, 'the room acked our input so the client can drop it from its buffer');
  assert.ok(speed(acked.player) > speed(before.player) * 2,
    `held thrust accelerated the ship (${speed(before.player).toFixed(2)} → ${speed(acked.player).toFixed(2)} u/s)`);
  assert.equal(acked.dropped, 0, 'no input was discarded');
  ws.close();
});

test('an idle client coasts to a stop — the drift decays, so the thrust test above means something', async () => {
  const ws = await openSocket(`ticket=${await getTicket()}&seed=99`);
  await waitFor(ws, (m) => m.type === 'welcome');
  ws.send(JSON.stringify({ type: 'start' }));
  const before = await waitFor(ws, (m) => m.type === 'snap');
  const speed = (p) => Math.hypot(p.vx, p.vz);
  let sent = 0;
  const feeder = setInterval(() => {
    ws.send(JSON.stringify({ type: 'input', ticks: [0, 1, 2].map((n) => ({ t: sent + n, k: [], a: null })) }));
    sent += 3;
  }, 50);
  const acked = await waitFor(ws, (m) => m.type === 'snap' && m.ack != null && m.ack >= 40, 15000);
  clearInterval(feeder);
  assert.ok(speed(acked.player) < speed(before.player),
    `no input means no thrust (${speed(before.player).toFixed(2)} → ${speed(acked.player).toFixed(2)} u/s)`);
  ws.close();
});

test('a malformed frame is ignored, not fatal', async () => {
  const ws = await openSocket(`ticket=${await getTicket()}`);
  await waitFor(ws, (m) => m.type === 'welcome');
  ws.send(JSON.stringify({ type: 'start' }));
  ws.send('not json at all');
  ws.send(JSON.stringify({ type: 'nonsense' }));
  const snap = await waitFor(ws, (m) => m.type === 'snap');
  assert.ok(snap.tick > 0, 'the room kept running');
  ws.close();
});

test('closing the socket tears the room down', async () => {
  await settle();
  const ws = await openSocket(`ticket=${await getTicket()}`);
  await waitFor(ws, (m) => m.type === 'welcome');
  assert.equal(netsim.rooms, 1);
  // The CLIENT's close event says nothing about when the SERVER noticed. Poll the server's own count.
  ws.close();
  const deadline = Date.now() + 2000;
  while (netsim.rooms > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  assert.equal(netsim.rooms, 0, 'no orphaned room left stepping at 60 Hz');
});

test('an unknown level is reported, not crashed', async () => {
  const ws = await openSocket(`ticket=${await getTicket()}&level=level-does-not-exist`);
  const err = await waitFor(ws, (m) => m.type === 'error');
  assert.match(err.error, /level-does-not-exist/);
});

test('pause really stops the room, and resume restarts it', async () => {
  const ws = await openSocket(`ticket=${await getTicket()}&seed=7`);
  await waitFor(ws, (m) => m.type === 'welcome');
  ws.send(JSON.stringify({ type: 'start' }));
  const running = await waitFor(ws, (m) => m.type === 'snap');

  ws.send(JSON.stringify({ type: 'pause' }));
  await new Promise((r) => setTimeout(r, 300));   // let any in-flight snapshot land
  const atPause = ws.inbox.filter((m) => m.type === 'snap').length;
  await new Promise((r) => setTimeout(r, 500));
  const afterWaiting = ws.inbox.filter((m) => m.type === 'snap').length;
  assert.equal(afterWaiting, atPause,
    'no snapshots at all while paused — the room stopped stepping, it did not merely stop being drawn');

  ws.send(JSON.stringify({ type: 'resume' }));
  const resumed = await waitFor(ws, (m) => m.type === 'snap' && m.tick > running.tick + 1);
  assert.ok(resumed.tick > running.tick, 'and it picks up where it left off');
  ws.close();
});

test('a ping keeps a paused room alive', async () => {
  // A paused client sends no input, and the idle reaper drops a socket that has said nothing. Without a
  // heartbeat a long pause would silently end the session and drop the player back to local play.
  await settle();
  const ws = await openSocket(`ticket=${await getTicket()}`);
  await waitFor(ws, (m) => m.type === 'welcome');
  ws.send(JSON.stringify({ type: 'start' }));
  ws.send(JSON.stringify({ type: 'pause' }));
  assert.ok(IDLE_TIMEOUT_MS >= 10_000, 'the reaper is slow enough that a heartbeat every 5 s covers it');
  const closed = [];
  ws.on('close', (code) => closed.push(code));
  for (let i = 0; i < 4; i++) { ws.send(JSON.stringify({ type: 'ping' })); await new Promise((r) => setTimeout(r, 120)); }
  assert.equal(closed.length, 0, 'still connected');
  assert.equal(netsim.rooms, 1, 'and the room is still there');
  ws.close();
});

test('a silent tab is kept alive by the transport, not by the game loop', async () => {
  // The bug this pins reached production. The client's keep-alive was sent from its RENDER LOOP, and a
  // browser stops rendering a hidden tab entirely — so switching tabs for half a minute got the socket
  // closed as "idle", and the player came back to a run whose enemies had been swept away and whose level
  // script was waiting for kills that could no longer happen. "Everything froze."
  //
  // Liveness belongs to the transport: a WebSocket PING is answered by the peer's network stack without a
  // line of page JavaScript running. This test is that claim — a client that sends NOTHING survives well
  // past the idle timeout, because `ws` answers pings for it exactly as a frozen browser would.
  const own = http.createServer(express());
  await new Promise((r) => own.listen(0, r));
  const store = createTicketStore();
  const net = attachNetsim(own, { tickets: store, pingEveryMs: 20, idleTimeoutMs: 150,
                                  log: { warn: () => {} } });
  const url = `ws://localhost:${own.address().port}${WS_PATH}?ticket=${store.issue('quiet').ticket}`;
  const ws = new WebSocket(url);
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });

  let closed = null;
  ws.on('close', (code) => { closed = code; });
  await new Promise((r) => setTimeout(r, 750));   // five idle timeouts' worth of saying nothing at all

  assert.equal(closed, null, `a quiet peer that answers pings is not abandoned (closed with ${closed})`);
  assert.equal(ws.readyState, WebSocket.OPEN);
  ws.close();
  net.closeAll();
  own.close();
});
