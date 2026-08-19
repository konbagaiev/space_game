// The event queue's contract. Small surface, but two properties the whole sim/presentation split rests on:
// events arrive in the order they were decided, and a drain leaves nothing behind for the next tick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventQueue } from './events.js';

test('events drain in emit order — the sim decided them in that order and sound follows sight', () => {
  const q = createEventQueue();
  q.emit({ type: 'hit' });
  q.emit({ type: 'kill', name: 'a' });
  q.emit({ type: 'win' });
  const seen = [];
  q.drain((e) => seen.push(e.type));
  assert.deepEqual(seen, ['hit', 'kill', 'win']);
});

test('a drain empties the queue, so the next tick cannot replay this tick', () => {
  const q = createEventQueue();
  q.emit({ type: 'smoke' });
  q.drain(() => {});
  assert.equal(q.length, 0);
  let again = 0;
  q.drain(() => { again++; });
  assert.equal(again, 0, 'a second drain fires nothing');
});

test('the consumer receives the event object itself (adapters read its payload)', () => {
  const q = createEventQueue();
  const sent = { type: 'kill', reward: 25, pos: { x: 1, y: 0, z: 2 } };
  q.emit(sent);
  const got = [];
  q.drain((e) => got.push(e));
  assert.equal(got.length, 1);
  assert.equal(got[0], sent);
  assert.equal(got[0].reward, 25);
});

test('clear() drops undelivered events — a reset must not inherit the old run\'s tail', () => {
  const q = createEventQueue();
  q.emit({ type: 'win' });
  q.emit({ type: 'kill' });
  q.clear();
  assert.equal(q.length, 0);
  let fired = 0;
  q.drain(() => { fired++; });
  assert.equal(fired, 0, 'a cleared win event can never reach the adapter and bank a phantom run');
});

test('each queue is independent — one process will host several worlds', () => {
  const a = createEventQueue(), b = createEventQueue();
  a.emit({ type: 'hit' });
  assert.equal(a.length, 1);
  assert.equal(b.length, 0, 'a second world must not see the first world\'s events');
  const seenB = [];
  b.drain((e) => seenB.push(e));
  assert.deepEqual(seenB, []);
  assert.equal(a.length, 1, 'and draining one must not empty the other');
});
