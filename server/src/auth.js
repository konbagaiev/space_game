// Authentication helpers — no dependencies (built-in node:crypto only). See DECISIONS §11.
// Passwords: scrypt with a per-user random salt, compared in constant time. Sessions: a random
// token in an httpOnly cookie; the DB stores only the token's SHA-256 hash.
import crypto from 'node:crypto';

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;       // email-verify token lifetime: 24 h
export const RESET_TTL_MS = 60 * 60 * 1000;             // password-reset token lifetime: 1 h
export const RESEND_THROTTLE_MS = 60 * 1000;            // min gap between verification/reset resends
const COOKIE_NAME = 'session';

// Hash a plaintext password: returns { hash, salt } as hex strings (salt is per-user random).
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString('hex');
  return { hash, salt };
}

// Verify a plaintext password against a stored hash+salt, in constant time. Safe on bad/empty input.
export function verifyPassword(plain, hash, salt) {
  if (!hash || !salt) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// A fresh, URL-safe session/verification token (raw — goes to the client only).
export function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// SHA-256 hex of a token — what we store in the DB (session token + email-verify token).
export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Parse a Cookie request header into { name: value }. Tiny, no dependency.
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (name) out[name] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Secure is required by browsers over HTTPS (production) but blocks cookies over plain http
// (local dev / tests). Gate it off only outside production.
const cookieSecure = () => process.env.NODE_ENV !== 'test';

// Set the session cookie (raw token). HttpOnly + SameSite=Lax + Path=/; Secure in prod.
export function setSessionCookie(res, token, maxAgeMs = SESSION_TTL_MS) {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (cookieSecure()) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

// Clear the session cookie (logout). Mirror the attributes so the browser drops it.
export function clearSessionCookie(res) {
  const attrs = [`${COOKIE_NAME}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (cookieSecure()) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

// Read the raw session token from a request: an Authorization: Bearer header (the cross-origin itch
// path) OR the session cookie (the same-origin site). Header first so an explicit bearer wins.
export function sessionTokenFromReq(req) {
  const auth = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
}

// Express middleware factory: resolve the session cookie to a player via the datastore's
// getSessionPlayer, attach it as req.player, or 401. `getSessionPlayer` is injected so this stays
// backend-agnostic via the datastore façade.
export function makeRequireAuth(getSessionPlayer) {
  return async function requireAuth(req, res, next) {
    try {
      const token = sessionTokenFromReq(req);
      if (!token) return res.status(401).json({ error: 'not authenticated' });
      const player = await getSessionPlayer(hashToken(token));
      if (!player) return res.status(401).json({ error: 'not authenticated' });
      req.player = player;
      next();
    } catch (e) { next(e); }
  };
}
