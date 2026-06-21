// Backend server: serves the game client (static) AND the JSON API on one origin
// (so the client can call /api/... without CORS). Storage is SQLite (see db.js).
import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { migrate, registerPlayer, setPlayerLanguage, getCurrentLevel, advanceProgress, recordGame, getPlayerGames, stats, getShips, getWeapons, getComponents, getActivePlayerShip, getMap, getLevel, backend,
  getPlayerPublic, setUsername, findPlayerForLogin, registerAccount, setVerifyToken, verifyEmailToken, createSession, getSessionPlayer, deleteSession } from './datastore.js';
import { hashPassword, verifyPassword, newSessionToken, hashToken, makeRequireAuth, setSessionCookie, clearSessionCookie, sessionTokenFromReq, RESEND_THROTTLE_MS } from './auth.js';
import { sendVerificationEmail, verificationUrl } from './ses.js';

const SUPPORTED_LANGUAGES = ['en', 'ru']; // mirror of client SUPPORTED (DECISIONS §10)

// Lightweight input validation (no dep). Email is a loose shape check; password ≥ 8.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validEmail = (e) => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e);
const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;
const cleanUsername = (u) => (typeof u === 'string' ? u.trim() : '');
const validUsername = (u) => u.length >= 1 && u.length <= 32;
const normEmail = (e) => e.trim().toLowerCase();

// In-memory per-IP fixed-window rate limiter (v1 — sufficient for a single server). Returns a
// middleware that 429s once a route is hit more than `max` times within `windowMs` from one IP.
function rateLimit({ windowMs, max }) {
  if (process.env.NODE_ENV === 'test') return (req, res, next) => next(); // off under the test suite
  const hits = new Map(); // ip -> { count, resetAt }
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const rec = hits.get(ip);
    if (!rec || now > rec.resetAt) { hits.set(ip, { count: 1, resetAt: now + windowMs }); return next(); }
    if (rec.count >= max) return res.status(429).json({ error: 'too many requests, try again later' });
    rec.count++;
    next();
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, '..', '..', 'client');

// Build the Express app (runs migrations first). Exported so tests can mount it
// without binding a port.
export async function createApp() {
  await migrate(); // bring the schema up to date before serving (backend chosen by DATABASE_URL)

  const app = express();
  app.use(express.json());

  // helper: run an async handler and forward errors to the error middleware
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // Auto-register a player by their browser-generated id (create if new).
  app.post('/api/players/register', wrap(async (req, res) => {
    const { playerId } = req.body || {};
    if (!playerId || typeof playerId !== 'string') {
      return res.status(400).json({ error: 'playerId (string) required' });
    }
    res.json(await registerPlayer(playerId));
  }));

  // Record one finished game and bank the credits earned into the player's balance.
  app.post('/api/games', wrap(async (req, res) => {
    const { playerId, credits, score, kills, durationMs } = req.body || {};
    if (!playerId || typeof playerId !== 'string') {
      return res.status(400).json({ error: 'playerId (string) required' });
    }
    // `credits` is the field name; accept legacy `score` too so older clients still bank correctly
    res.json(await recordGame(playerId, { credits: credits ?? score, kills, durationMs }));
  }));

  // A player's game history (handy for testing / future UI).
  app.get('/api/players/:id/games', wrap(async (req, res) => {
    res.json(await getPlayerGames(req.params.id));
  }));

  app.get('/api/health', wrap(async (req, res) => res.json({ ok: true, backend, ...(await stats()) })));

  // Catalog: ships (player + enemies) and weapons, with their stats. Read-only.
  app.get('/api/ships', wrap(async (req, res) => res.json(await getShips())));
  app.get('/api/weapons', wrap(async (req, res) => res.json(await getWeapons())));
  app.get('/api/components', wrap(async (req, res) => res.json(await getComponents())));

  // The player's active ship (template + effective loadout). Auto-registers + gives a default ship.
  app.get('/api/players/:id/active-ship', wrap(async (req, res) => {
    const active = await getActivePlayerShip(req.params.id);
    if (!active) return res.status(404).json({ error: 'no active ship' });
    res.json(active);
  }));

  // The level the player is currently on (their highest unlocked level). Auto-registers.
  app.get('/api/players/:id/level', wrap(async (req, res) => {
    const level = await getCurrentLevel(req.params.id);
    if (!level) return res.status(404).json({ error: 'no current level' });
    res.json(level);
  }));

  // Unlock the next level (called by the client when the player clears their current level).
  app.post('/api/players/:id/advance', wrap(async (req, res) => {
    res.json(await advanceProgress(req.params.id));
  }));

  // Persist the player's language preference (client mirrors it to localStorage). Only en/ru.
  app.post('/api/players/:id/language', wrap(async (req, res) => {
    const { language } = req.body || {};
    if (!SUPPORTED_LANGUAGES.includes(language)) return res.status(400).json({ error: 'unsupported language' });
    res.json(await setPlayerLanguage(req.params.id, language));
  }));

  // A map's scene descriptor (the client renders it via buildMap). Read-only.
  app.get('/api/maps/:name', wrap(async (req, res) => {
    const map = await getMap(req.params.name);
    if (!map) return res.status(404).json({ error: 'no such map' });
    res.json(map);
  }));

  // A level's descriptor (map + phase/wave script; the client's level runner plays it). Read-only.
  app.get('/api/levels/:name', wrap(async (req, res) => {
    const level = await getLevel(req.params.name);
    if (!level) return res.status(404).json({ error: 'no such level' });
    res.json(level);
  }));

  // ---------- Authentication (DECISIONS §11) ----------
  const requireAuth = makeRequireAuth(getSessionPlayer);
  const authLimiter = rateLimit({ windowMs: 60_000, max: 10 }); // per-IP, per-minute on auth routes

  // Open a fresh session for a player: random token in an httpOnly cookie, hash stored server-side.
  const startSession = (res, playerId, req) => {
    const token = newSessionToken();
    createSession(playerId, hashToken(token), req.headers['user-agent']);
    setSessionCookie(res, token);
  };

  // Set the display name on a (still anonymous) player — the level-1 "name yourself" step.
  app.post('/api/players/:id/username', wrap(async (req, res) => {
    const username = cleanUsername((req.body || {}).username);
    if (!validUsername(username)) return res.status(400).json({ error: 'username (1-32 chars) required' });
    res.json(await setUsername(req.params.id, username));
  }));

  // Upgrade an anonymous player in place with email/password credentials. Sends a verification email
  // and logs the player in (session cookie). Progress on the row is preserved.
  app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
    const { playerId } = req.body || {};
    const username = cleanUsername((req.body || {}).username);
    const email = normEmail(String((req.body || {}).email || ''));
    const password = (req.body || {}).password;
    if (!playerId || typeof playerId !== 'string') return res.status(400).json({ error: 'playerId required' });
    if (username && !validUsername(username)) return res.status(400).json({ error: 'username must be 1-32 chars' });
    if (!validEmail(email)) return res.status(400).json({ error: 'valid email required' });
    if (!validPassword(password)) return res.status(400).json({ error: 'password must be at least 8 characters' });

    const { hash, salt } = hashPassword(password);
    const verifyToken = newSessionToken();
    let player;
    try {
      player = await registerAccount(playerId, {
        username: username || null, email, passwordHash: hash, passwordSalt: salt,
        verifyTokenHash: hashToken(verifyToken), verifySentAt: Date.now(),
      });
    } catch (e) {
      if (e.code === 'EMAIL_TAKEN') return res.status(409).json({ error: 'email already in use' });
      throw e;
    }
    await sendVerificationEmail(email, verificationUrl(verifyToken));
    startSession(res, playerId, req);
    res.json(player);
  }));

  // Log in by email + password; opens a session. The client adopts the returned player id.
  app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
    const email = normEmail(String((req.body || {}).email || ''));
    const password = (req.body || {}).password;
    if (!validEmail(email) || typeof password !== 'string') return res.status(400).json({ error: 'email and password required' });
    const row = await findPlayerForLogin(email);
    if (!row || !verifyPassword(password, row.password_hash, row.password_salt)) {
      return res.status(401).json({ error: 'invalid email or password' });
    }
    startSession(res, row.id, req);
    res.json(await getPlayerPublic(row.id));
  }));

  // Log out: drop the server-side session and clear the cookie.
  app.post('/api/auth/logout', wrap(async (req, res) => {
    const token = sessionTokenFromReq(req);
    if (token) await deleteSession(hashToken(token));
    clearSessionCookie(res);
    res.json({ ok: true });
  }));

  // The current session's player (or 401).
  app.get('/api/auth/me', requireAuth, wrap(async (req, res) => res.json(req.player)));

  // Verify an email via the link in the message; flips email_verified, then redirects into the game.
  app.get('/api/auth/verify', wrap(async (req, res) => {
    const token = req.query.token;
    const ok = token ? await verifyEmailToken(hashToken(token)) : null;
    res.redirect(ok ? '/?verified=1' : '/?verified=0');
  }));

  // Resend the verification email (authed). Throttled per account by email_verify_sent_at.
  app.post('/api/auth/resend-verification', requireAuth, authLimiter, wrap(async (req, res) => {
    if (req.player.emailVerified) return res.status(400).json({ error: 'email already verified' });
    if (!req.player.email) return res.status(400).json({ error: 'no email on this account' });
    const sentAt = req.player.emailVerifySentAt || 0;
    if (Date.now() - sentAt < RESEND_THROTTLE_MS) return res.status(429).json({ error: 'please wait before requesting another email' });
    const verifyToken = newSessionToken();
    await setVerifyToken(req.player.id, hashToken(verifyToken), Date.now());
    await sendVerificationEmail(req.player.email, verificationUrl(verifyToken));
    res.json({ ok: true });
  }));

  // Serve the game client (index.html etc.) from the same origin as the API.
  app.use(express.static(clientDir));

  // Error handler — log and return the message (so failures are visible).
  app.use((err, req, res, next) => {
    console.error('API error:', err);
    res.status(500).json({ error: String((err && err.message) || err) });
  });

  return app;
}

// CLI: `node src/server.js` builds the app and starts listening.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await createApp();
  const PORT = process.env.PORT || 4000;
  const server = app.listen(PORT, () => {
    console.log(`Space game server running: http://localhost:${PORT}`);
  });
  // Graceful shutdown: on stop, stop accepting new connections and let in-flight
  // requests finish before exiting -> no dropped requests when the old container is
  // removed during a zero-downtime rollout.
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref(); // hard cap
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
