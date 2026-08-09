// Stable per-browser client id (used as the anonymous player id, stored in localStorage).
//
// MUST work in a NON-secure context: `crypto.randomUUID()` is **secure-context only** — it is `undefined`
// over plain HTTP to an IP (e.g. http://192.168.1.151 on a LAN) and throws when called. That broke the
// intro→Level-1 advance when testing over the LAN IP: id generation threw → `G.playerId` was null →
// `unlockNextLevel()` bailed on `if (!G.playerId) return` → the campaign never advanced (Level 0 replayed).
// `crypto.getRandomValues()` IS available in insecure contexts, so fall back to it (a proper v4 UUID),
// then to a Math.random id as a last resort. Pure + injectable (the `c` arg) so it is unit-testable.
export function makeClientId(c = (typeof crypto !== 'undefined' ? crypto : undefined)) {
  try { if (c && typeof c.randomUUID === 'function') return c.randomUUID(); } catch { /* secure-context only → fall through */ }
  try {
    if (c && typeof c.getRandomValues === 'function') {
      const b = c.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40; // version 4
      b[8] = (b[8] & 0x3f) | 0x80; // variant
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
  } catch { /* fall through */ }
  return 'pid-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
