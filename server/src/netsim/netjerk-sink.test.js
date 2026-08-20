// The ?netjerk sink: a development-only endpoint that writes the client's stutter record to this machine.
//
// Two things are worth a test. It must WORK — the whole point is that a report becomes a file nobody has to
// carry — and it must not EXIST unless it was asked for, because an endpoint that writes a client-supplied
// body to disk has no business standing on a server by default.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';

process.env.NODE_ENV = 'test';

const record = (over = {}) => ({
  kind: 'netjerk', version: 1, reason: 'death', level: 'level-0',
  report: { total: 1 }, marks: [{ t: 1, label: 'death' }],
  events: [{ t: 1, kind: 'rocket', dStep: 0.3 }], arrivals: [{ tick: 4, at: 0, gap: 0 }], slowFrames: [],
  ...over,
});

async function appOn(port0 = 0) {
  const { createApp } = await import('../server.js');
  const app = await createApp();
  const server = await new Promise((r) => { const s = app.listen(port0, () => r(s)); });
  return { server, base: `http://localhost:${server.address().port}` };
}
const post = (base, body) =>
  fetch(base + '/api/netjerk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('the sink is absent unless it was explicitly armed', async () => {
  delete process.env.NETJERK_SINK;
  const { server, base } = await appOn();
  const res = await post(base, record());
  assert.equal(res.status, 404, 'no dev sink on a server that was not asked for one');
  server.close();
});

test('armed, it writes the record to disk and says where', async () => {
  process.env.NETJERK_SINK = '1';
  const { server, base } = await appOn();
  const res = await post(base, record({ level: 'level-2' }));
  assert.equal(res.status, 200);
  const { ok, file } = await res.json();
  assert.equal(ok, true);
  assert.ok(path.basename(file).startsWith('netjerk-level-2-'), `named after the run (${file})`);

  const back = JSON.parse(await fsp.readFile(file, 'utf8'));
  assert.equal(back.kind, 'netjerk');
  assert.equal(back.events.length, 1, 'the raw record survives the trip, not just the summary');
  assert.equal(back.arrivals[0].tick, 4);
  await fsp.rm(file, { force: true });

  // A body that is not a record is refused rather than written: the endpoint is a sink for one thing.
  const bad = await post(base, { kind: 'something-else' });
  assert.equal(bad.status, 400);
  server.close();
  delete process.env.NETJERK_SINK;
});

after(async () => { delete process.env.NETJERK_SINK; });
