// Single-use tickets for the netsim WebSocket handshake.
//
// A browser cannot set `Authorization` on a WebSocket handshake, and `Origin` is not a security control —
// any non-browser client forges it, and itch's rotating `*.itch.zone` / `*.hwcdn.net` subdomains make an
// allowlist a permanent chore (`client/src/api-base.js` says as much). Both problems close with one move:
// the client asks the ordinary, already-authenticated HTTP API for a short-lived ticket and then connects
// to `/ws?ticket=…`. See docs/plans/server-authoritative-sim.md §5.
//
// In memory on purpose. A ticket lives 30 seconds and the game runs on one box; persisting it would buy
// nothing and cost a table. If netsim ever runs on more than one instance, this is the piece that moves to
// Redis or a table — and it is deliberately small so that move is a page of code, not a refactor.
import crypto from 'node:crypto';

export const TICKET_TTL_MS = 30_000;
// A hard cap so a caller that hammers the endpoint cannot grow the map without bound. Sweeping happens on
// issue (cheap: the map is tiny), and the cap is the backstop for a burst inside one TTL window.
export const MAX_LIVE_TICKETS = 10_000;

export function createTicketStore({ ttlMs = TICKET_TTL_MS, now = () => Date.now() } = {}) {
  const live = new Map(); // token → { playerId, expiresAt }

  function sweep() {
    const t = now();
    for (const [token, e] of live) if (e.expiresAt <= t) live.delete(token);
  }

  return {
    get size() { return live.size; },

    // Mint a ticket for `playerId`. Returns { ticket, expiresInMs }.
    issue(playerId) {
      sweep();
      if (live.size >= MAX_LIVE_TICKETS) throw new Error('too many outstanding ws tickets');
      const ticket = crypto.randomBytes(24).toString('base64url');
      live.set(ticket, { playerId, expiresAt: now() + ttlMs });
      return { ticket, expiresInMs: ttlMs };
    },

    // Redeem exactly once. Returns { playerId } or null (unknown, already used, or expired). The delete
    // happens before the expiry check so a stale token cannot be probed twice for a timing difference.
    redeem(ticket) {
      if (!ticket) return null;
      const e = live.get(ticket);
      if (!e) return null;
      live.delete(ticket);
      if (e.expiresAt <= now()) return null;
      return { playerId: e.playerId };
    },
  };
}
