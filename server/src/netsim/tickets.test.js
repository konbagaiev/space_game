import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTicketStore, TICKET_TTL_MS } from './tickets.js';

test('a ticket redeems once and only once', () => {
  const s = createTicketStore();
  const { ticket } = s.issue('player-1');
  assert.deepEqual(s.redeem(ticket), { playerId: 'player-1' });
  assert.equal(s.redeem(ticket), null, 'a replayed ticket is refused');
});

test('an expired ticket is refused, and swept', () => {
  let t = 1000;
  const s = createTicketStore({ now: () => t });
  const { ticket } = s.issue('player-1');
  t += TICKET_TTL_MS + 1;
  assert.equal(s.redeem(ticket), null);
  assert.equal(s.size, 0, 'and does not linger in the map');
});

test('expired tickets are swept on the next issue, not left to accumulate', () => {
  let t = 0;
  const s = createTicketStore({ now: () => t });
  for (let i = 0; i < 50; i++) s.issue(`p${i}`);
  assert.equal(s.size, 50);
  t += TICKET_TTL_MS + 1;
  s.issue('late');
  assert.equal(s.size, 1, 'only the fresh one survives');
});

test('an unknown or empty ticket is refused without throwing', () => {
  const s = createTicketStore();
  assert.equal(s.redeem('nope'), null);
  assert.equal(s.redeem(''), null);
  assert.equal(s.redeem(undefined), null);
});

test('tickets are unguessable and distinct', () => {
  const s = createTicketStore();
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const { ticket } = s.issue('p');
    assert.ok(ticket.length >= 32, 'at least 24 random bytes worth');
    assert.ok(!seen.has(ticket), 'no collisions');
    seen.add(ticket);
  }
});
