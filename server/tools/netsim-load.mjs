// A synthetic browser for a netsim room: mint a ticket, join, play at 60 Hz, and measure when snapshots
// actually arrive. It exists to answer one question that a report from a real session cannot — is the ROOM
// stalling, or is something else on the machine?
//
// It settled exactly that on 2026-08-20. A playtest showed three delivery stalls of 300–750 ms, each
// carrying a single snapshot interval of simulation, with the tab rendering happily throughout (one slow
// frame in a whole run). This tool then drove the same level for a minute — p50 34 ms, p95 37, max 75, zero
// stalls — and again while the server was serving 1.5 MB models on repeat, with the same result. So the room
// and the file serving are both innocent, and the search moved to what else is competing for the machine.
//
//   node server/tools/netsim-load.mjs [--level level-2] [--seconds 60] [--port 4010]
//
// Requires a server started with that port. Deliberately dependency-free beyond `ws`, which the server
// already has.
import WebSocket from 'ws';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const PORT = arg('port', '4010');
const LEVEL = arg('level', 'level-2');
const SECONDS = Number(arg('seconds', '60'));
const BASE = `http://localhost:${PORT}`;
const t = await (await fetch(BASE + '/api/ws-ticket', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ playerId: 'loadtest' }),
})).json();

const ws = new WebSocket(`ws://localhost:${PORT}/ws?ticket=${t.ticket}&level=${LEVEL}`);
const arrivals = [];
let last = null, started = false, tick = 0;

ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.type === 'welcome') {
    console.log(`joined: level=${m.level} dt=${m.dt} snapshotEvery=${m.snapshotEvery}`);
    ws.send(JSON.stringify({ type: 'start' }));
    started = true;
    return;
  }
  if (m.type !== 'snap') return;
  const now = performance.now();
  if (last != null) arrivals.push({ gap: now - last, tick: m.tick });
  last = now;
});

ws.on('open', () => console.log('socket open'));
ws.on('error', (e) => console.log('socket error', e.message));

// Input at 60 Hz, batched by 3 like the browser does: hold thrust + both triggers, so the fight is busy.
const t0 = performance.now();
const timer = setInterval(() => {
  if (!started) return;
  const batch = [];
  for (let i = 0; i < 3; i++) batch.push({ t: tick++, k: ['KeyW', 'Space', 'KeyF'], a: null });
  ws.send(JSON.stringify({ type: 'input', ticks: batch }));
}, 50);

setTimeout(() => {
  clearInterval(timer);
  ws.close();
  const gaps = arrivals.map((a) => a.gap).sort((x, y) => x - y);
  const q = (p) => gaps[Math.floor((gaps.length - 1) * p)];
  console.log(`\n${arrivals.length} snapshots over ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`gaps ms: p05 ${q(0.05).toFixed(0)}  p50 ${q(0.5).toFixed(0)}  p95 ${q(0.95).toFixed(0)}  max ${q(1).toFixed(0)}`);
  const stalls = arrivals.filter((a) => a.gap > 100);
  console.log(`stalls over 100 ms: ${stalls.length}`);
  for (const s of stalls.slice(0, 12)) console.log(`   tick ${s.tick}  gap ${s.gap.toFixed(0)} ms`);
  process.exit(0);
}, SECONDS * 1000);
