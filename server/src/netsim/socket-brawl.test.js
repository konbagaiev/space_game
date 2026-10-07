// The bot-brawl room over a real socket (`?netbrawl`, docs/plans/2026-10-06-1530-server-brawl.md): the
// handshake clamp, the 2-room cap, the backstop, the slow-link guard, a join that throws, and `srv`.
//
// Its own file (and its own listeners) because three of these need test-only `attachNetsim` options —
// a 200 ms backstop, a session hook, a throwing room factory — that must not leak into socket.test.js's
// shared server. Waits are for messages and closes, never for the simulation clock to reach a state.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { WebSocket } from 'ws';
import { createTicketStore } from './tickets.js';
import { attachNetsim, WS_PATH, MAX_BRAWL_ROOMS, BRAWL_MAX_BUFFERED, BRAWL_ROOM_MAX_MS } from './socket.js';

const servers = [];
after(() => { for (const s of servers) { s.netsim.closeAll(); s.server.close(); } });

async function listen(opts = {}) {
  const app = express();
  app.use(express.json());
  const tickets = createTicketStore();
  app.post('/api/ws-ticket', (req, res) => res.json(tickets.issue(String(req.body.playerId))));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const warns = [];
  const netsim = attachNetsim(server, { tickets, pingEveryMs: 50,
    log: { warn: (m) => warns.push(m), info: () => {}, log: () => {} }, ...opts });
  const port = server.address().port;
  const s = { server, netsim, warns, base: `http://localhost:${port}`, wsBase: `ws://localhost:${port}${WS_PATH}` };
  servers.push(s);
  return s;
}

const getTicket = async (s, playerId = 'p-brawl') => (await (await fetch(`${s.base}/api/ws-ticket`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId }),
})).json()).ticket;

const openSocket = (s, query) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${s.wsBase}?${query}`);
  ws.inbox = [];
  ws.closed = new Promise((r) => ws.once('close', (code, reason) => r({ code, reason: String(reason) })));
  ws.on('message', (data) => { ws.inbox.push(JSON.parse(data)); ws.emit('inbox'); });
  ws.on('error', () => {});
  ws.once('open', () => resolve(ws));
  ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error('handshake refused'), { status: res.statusCode })));
});

function waitFor(ws, pred, ms = 8000) {
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

async function until(fn, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!fn() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  return fn();
}

test('the backstop is the longest run plus 30 s', () => {
  assert.equal(BRAWL_ROOM_MAX_MS, 330_000);
  assert.equal(MAX_BRAWL_ROOMS, 2);
});

test('the handshake clamps the count: brawl=999 → 100, brawl=abc → no brawl', async () => {
  const s = await listen();
  const a = await openSocket(s, `ticket=${await getTicket(s)}&brawl=999`);
  assert.equal((await waitFor(a, (m) => m.type === 'welcome')).brawl, 100);
  assert.equal((await waitFor(a, (m) => m.type === 'welcome')).level, 'level-1', 'a brawl forces its level');
  a.close();
  const b = await openSocket(s, `ticket=${await getTicket(s)}&brawl=abc`);
  assert.equal((await waitFor(b, (m) => m.type === 'welcome')).brawl, null);
  b.close();
  assert.ok(await until(() => s.netsim.rooms === 0 && s.netsim.brawlRooms === 0));
});

test('at most two brawl rooms: the third is refused with brawl-busy / 4002, a campaign room still joins, a freed slot is reused', async () => {
  const s = await listen();
  const a = await openSocket(s, `ticket=${await getTicket(s)}&brawl=2`);
  const b = await openSocket(s, `ticket=${await getTicket(s)}&brawl=2`);
  await waitFor(a, (m) => m.type === 'welcome'); await waitFor(b, (m) => m.type === 'welcome');
  assert.equal(s.netsim.brawlRooms, 2);
  const c = await openSocket(s, `ticket=${await getTicket(s)}&brawl=2`);
  const err = await waitFor(c, (m) => m.type === 'error');
  assert.equal(err.error, 'brawl-busy');
  assert.equal(err.max, 2);
  assert.equal((await c.closed).code, 4002);
  const camp = await openSocket(s, `ticket=${await getTicket(s)}&seed=3`);
  assert.equal((await waitFor(camp, (m) => m.type === 'welcome')).brawl, null, 'a campaign room is not capped by it');
  camp.close();
  a.close();
  assert.ok(await until(() => s.netsim.brawlRooms === 1), 'the closed room released its slot');
  const d = await openSocket(s, `ticket=${await getTicket(s)}&brawl=2`);
  assert.equal((await waitFor(d, (m) => m.type === 'welcome')).brawl, 2, 'and a new brawl joins');
  b.close(); d.close();
  assert.ok(await until(() => s.netsim.brawlRooms === 0 && s.netsim.rooms === 0));
});

test('the backstop: a final ended snapshot, then close 4001, and the slot is released', async () => {
  const s = await listen({ brawlMaxMs: 200 });
  const ws = await openSocket(s, `ticket=${await getTicket(s)}&brawl=2`);
  await waitFor(ws, (m) => m.type === 'welcome');
  const closed = await ws.closed;
  assert.equal(closed.code, 4001);
  assert.equal(closed.reason, 'brawl-expired');
  const last = ws.inbox.filter((m) => m.type === 'snap').pop();
  assert.ok(last, 'a final snapshot arrived');
  assert.equal(last.brawl.ended, true);
  assert.ok(await until(() => s.netsim.brawlRooms === 0 && s.netsim.rooms === 0));
});

test('the slow-link guard terminates a hopeless brawl link (abnormal close 1006) and releases the slot', async () => {
  let session = null;
  const s = await listen({ onSession: (x) => { session = x; } });
  const ws = await openSocket(s, `ticket=${await getTicket(s)}&brawl=2`);
  await waitFor(ws, (m) => m.type === 'welcome');
  assert.ok(session && session.brawl === 2);
  Object.defineProperty(session.ws, 'bufferedAmount', { get: () => BRAWL_MAX_BUFFERED + 1 });
  ws.send(JSON.stringify({ type: 'start' }));
  const closed = await ws.closed;
  assert.equal(closed.code, 1006, 'terminated, not closed: no close frame queued behind the backlog');
  assert.equal(ws.inbox.filter((m) => m.type === 'snap').length, 0, 'not one snapshot was queued past the cap');
  assert.ok(await until(() => s.netsim.brawlRooms === 0 && s.netsim.rooms === 0));
  assert.equal(s.warns.filter((w) => /slow link/.test(w)).length, 1, 'logged once');
});

test('a campaign room is never cut by the slow-link guard', async () => {
  let session = null;
  const s = await listen({ onSession: (x) => { session = x; } });
  const ws = await openSocket(s, `ticket=${await getTicket(s)}&seed=4`);
  await waitFor(ws, (m) => m.type === 'welcome');
  Object.defineProperty(session.ws, 'bufferedAmount', { get: () => BRAWL_MAX_BUFFERED + 1 });
  ws.send(JSON.stringify({ type: 'start' }));
  assert.ok(await waitFor(ws, (m) => m.type === 'snap'));
  ws.close();
});

test('a brawl join that throws does not leak a slot', async () => {
  const s = await listen({ createRoomFn: () => { throw new Error('boom'); } });
  for (let i = 0; i < 3; i++) {
    const ws = await openSocket(s, `ticket=${await getTicket(s)}&brawl=3`);
    const err = await waitFor(ws, (m) => m.type === 'error');
    assert.equal(err.error, 'boom');
    await ws.closed;
  }
  assert.ok(await until(() => s.netsim.brawlRooms === 0), `slots: ${s.netsim.brawlRooms}`);
});

test('a started brawl room\'s snapshots carry the brawl block and, once a second, srv', async () => {
  const s = await listen();
  const ws = await openSocket(s, `ticket=${await getTicket(s)}&brawl=2`);
  await waitFor(ws, (m) => m.type === 'welcome');
  ws.send(JSON.stringify({ type: 'start' }));
  ws.send(JSON.stringify({ type: 'input', ticks: [{ t: 0, k: [] }] }));
  const first = await waitFor(ws, (m) => m.type === 'snap');
  assert.equal(first.brawl.n, 2);
  assert.equal(first.spawns.filter((d) => d.kind === 'enemy' && d.ace === 1).length, 2, 'red rides as aces');
  const withSrv = await waitFor(ws, (m) => m.type === 'snap' && m.srv);
  assert.equal(typeof withSrv.srv.stepMs.p95, 'number');
  assert.ok(withSrv.srv.snapBytes.sum > 0, 'the bytes actually sent are counted');
  assert.equal(withSrv.srv.proc.brawlRooms, 1);
  assert.ok(withSrv.brawl.armed, 'the input armed it');
  ws.close();
});
