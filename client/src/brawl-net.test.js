// The ?netbrawl tab mirror (brawl-net.js): filled from snapshots, never stepped, and the server's own
// armed/ended never overwrite the tab's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBrawlMirror, applyBrawlBlock, pushSrv, brawlNetErrorText, SRV_SAMPLES_MAX } from './brawl-net.js';
import { brawlTick } from './sim-core/brawl.js';

test('makeBrawlMirror: a server mirror, un-armed, both sides full', () => {
  const m = makeBrawlMirror(7);
  assert.equal(m.server, true);
  assert.equal(m.armed, false); assert.equal(m.ended, false);
  assert.equal(m.serverArmed, false);
  assert.deepEqual(m.alive, [7, 7]);
  assert.deepEqual(m.fingerprint, []);
  assert.deepEqual(m.srv, []);
});

test('applyBrawlBlock copies the server fields and never touches the tab\'s armed/ended', () => {
  const m = makeBrawlMirror(3);
  const fp = [[10, 3, 2]];
  applyBrawlBlock(m, { n: 3, armed: true, ended: true, ticks: 601, alive: [3, 0], killsByBlue: 3, killsByRed: 1, fp });
  assert.equal(m.ticks, 601);
  assert.equal(m.killsByBlue, 3); assert.equal(m.killsByRed, 1);
  assert.deepEqual(m.alive, [3, 0]);
  assert.deepEqual(m.fingerprint, fp);
  assert.notEqual(m.fingerprint, fp, 'a copy, not the wire object');
  assert.equal(m.serverArmed, true);
  assert.equal(m.serverEnded, true);
  assert.equal(m.armed, false, 'the TAB arms its own run');
  assert.equal(m.ended, false, 'and ends it');
});

test('pushSrv drops samples until the ROOM has armed, then keeps a bounded list stamped with the tick', () => {
  const m = makeBrawlMirror(2);
  assert.equal(pushSrv(m, { ticks: 60 }), false, 'pre-arm seconds would dilute the averages');
  assert.equal(m.srv.length, 0);
  applyBrawlBlock(m, { armed: true, ended: false, ticks: 120, alive: [2, 2], killsByBlue: 0, killsByRed: 0, fp: [] });
  assert.equal(pushSrv(m, { ticks: 60 }), true);
  assert.deepEqual(m.srv[0], { tick: 120, ticks: 60 });
  for (let i = 0; i < SRV_SAMPLES_MAX + 10; i++) pushSrv(m, { ticks: i });
  assert.equal(m.srv.length, SRV_SAMPLES_MAX, 'bounded');
});

test('a mirror is never stepped by brawlTick', () => {
  const m = makeBrawlMirror(2);
  m.armed = true;
  const world = { brawl: m, allies: [{}], enemies: [{}] };
  assert.equal(brawlTick(world, 1 / 60), null);
  assert.equal(m.ticks, 0);
});

test('brawlNetErrorText: the cap in plain English, anything else as "could not reach"', () => {
  assert.equal(brawlNetErrorText('brawl-busy'), 'The server is already running 2 bot brawls — try again in a minute.');
  assert.equal(brawlNetErrorText('ws-ticket 500'), 'Could not reach the server room (ws-ticket 500).');
});
