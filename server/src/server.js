// Backend server: serves the game client (static) AND the JSON API on one origin
// (so the client can call /api/... without CORS). Storage is SQLite (see db.js).
import { sentryEnabled } from './instrument.js'; // MUST be first: Sentry.init before anything else loads
import * as Sentry from '@sentry/node';
import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { migrate, registerPlayer, setPlayerLanguage, getCurrentLevel, advanceProgress, recordGame, getPlayerGames, stats, getShips, getWeapons, getComponents, getSoundCatalog, getActivePlayerShip, getMap, getLevel, backend, resetPlayer,
  getPlayerPublic, setUsername, findPlayerForLogin, registerAccount, setVerifyToken, verifyEmailToken, createSession, getSessionPlayer, deleteSession, recordEvent,
  getStash, buyItem, sellItem, equipItem, unequipItem } from './datastore.js';
import { hashPassword, verifyPassword, newSessionToken, hashToken, makeRequireAuth, setSessionCookie, clearSessionCookie, sessionTokenFromReq, RESEND_THROTTLE_MS } from './auth.js';
import { generateMissions } from './missions.js';
import { sendVerificationEmail, verificationUrl } from './ses.js';

const SUPPORTED_LANGUAGES = ['en', 'ru']; // mirror of client SUPPORTED (DECISIONS §10)
// Allowlisted product-funnel event types (docs/plans/monitoring.md). Anything else is dropped.
const EVENT_TYPES = new Set(['game_start', 'level_start', 'level_clear', 'player_death', 'victory', 'quit', 'community_click']);

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

  // Health / uptime endpoint — used by external monitoring (UptimeRobot), the Docker healthcheck, and
  // the CI smoke check. Touches the DB (via stats) so it reports unhealthy when the database is
  // unreachable: 200 + { ok:true, status:'ok', ... } when healthy, 503 + { ok:false, status:'error' }
  // when a dependency is down. `uptimeSec` = process uptime (handy on a monitoring dashboard).
  app.get('/api/health', wrap(async (req, res) => {
    try {
      const s = await stats();
      res.json({ ok: true, status: 'ok', backend, uptimeSec: Math.round(process.uptime()), ...s });
    } catch (e) {
      res.status(503).json({ ok: false, status: 'error', backend, error: String((e && e.message) || e) });
    }
  }));

  // Catalog: ships (player + enemies) and weapons, with their stats. Read-only.
  app.get('/api/ships', wrap(async (req, res) => res.json(await getShips())));
  app.get('/api/weapons', wrap(async (req, res) => res.json(await getWeapons())));
  app.get('/api/components', wrap(async (req, res) => res.json(await getComponents())));
  app.get('/api/sounds', wrap(async (req, res) => res.json(await getSoundCatalog()))); // SFX registry + class routing

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

  // Player-initiated progress reset (the "Reset my progress" control in settings). Per-player reset:
  // clears games/ships/stash/events and resets level/credits/shop to the new-player baseline (re-granting
  // the starter ship), while keeping the account, login session and language. Same op as the admin
  // `reset.js --player`. 404 if the player is unknown.
  app.post('/api/players/:id/reset', wrap(async (req, res) => {
    const r = await resetPlayer(req.params.id);
    if (!r.found) return res.status(404).json({ error: 'player not found' });
    res.json({ ok: true });
  }));

  // Persist the player's language preference (client mirrors it to localStorage). Only en/ru.
  app.post('/api/players/:id/language', wrap(async (req, res) => {
    const { language } = req.body || {};
    if (!SUPPORTED_LANGUAGES.includes(language)) return res.status(400).json({ error: 'unsupported language' });
    res.json(await setPlayerLanguage(req.params.id, language));
  }));

  // ---------- Hangar shop + stash (docs/plans/hangar-shop.md) ----------
  // After any shop mutation, return the fresh state the client re-renders from: the stash, the active
  // ship (loadout/components + launchable), and the credit balance. Server stays authoritative.
  const shopState = async (playerId) => {
    const [stash, activeShip] = await Promise.all([getStash(playerId), getActivePlayerShip(playerId)]);
    return { credits: activeShip ? activeShip.credits : 0, shopUnlocked: !!(activeShip && activeShip.shopUnlocked), stash, activeShip };
  };
  // Run a gated shop mutation: 403 until the shop is unlocked (cleared the final level), then dispatch
  // to `op` and translate its { ok,status,error } into an HTTP response with the refreshed state.
  const shopMutation = (op) => wrap(async (req, res) => {
    const playerId = req.params.id;
    const active = await getActivePlayerShip(playerId);
    if (!active || !active.shopUnlocked) return res.status(403).json({ error: 'shop locked' });
    const result = await op(playerId, req.body || {});
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error || 'shop error' });
    res.json(await shopState(playerId));
  });

  // The player's stash + active ship + balance (and whether the shop is unlocked yet).
  app.get('/api/players/:id/stash', wrap(async (req, res) => res.json(await shopState(req.params.id))));

  // ---------- Side missions (docs/plans/mission-generator.md) ----------
  // The 3-choice side-mission board, unlocked after the campaign (same gate as the shop). Returns the
  // currently-offered missions (each with a full level-style descriptor the client plays via levelRunner).
  // Clearing one banks per-kill ×2 credits like a level and does NOT advance the story counter.
  app.get('/api/players/:id/missions', wrap(async (req, res) => {
    const active = await getActivePlayerShip(req.params.id);
    if (!active || !active.shopUnlocked) return res.status(403).json({ error: 'missions locked' });
    res.json({ missions: generateMissions() });
  }));

  // Buy a catalog item into the stash (credits down). Body: { kind: 'component'|'weapon', refId }.
  app.post('/api/players/:id/buy', shopMutation((playerId, body) => {
    const { kind, refId } = body;
    if ((kind !== 'component' && kind !== 'weapon') || !Number.isInteger(refId)) return { ok: false, status: 400, error: 'kind and refId required' };
    return buyItem(playerId, kind, refId);
  }));

  // Sell a stash item ({ kind, refId }) or an optional equipped item ({ slot }) for 75% of its price.
  app.post('/api/players/:id/sell', shopMutation((playerId, body) => {
    const { kind, refId, slot } = body;
    if (slot) { if (typeof slot !== 'string') return { ok: false, status: 400, error: 'slot must be a string' }; return sellItem(playerId, { slot }); }
    if ((kind !== 'component' && kind !== 'weapon') || !Number.isInteger(refId)) return { ok: false, status: 400, error: 'kind and refId (or slot) required' };
    return sellItem(playerId, { kind, refId });
  }));

  // Equip a stash item onto the active ship (the displaced item, if any, returns to the stash).
  app.post('/api/players/:id/equip', shopMutation((playerId, body) => {
    const { kind, refId } = body;
    if ((kind !== 'component' && kind !== 'weapon') || !Number.isInteger(refId)) return { ok: false, status: 400, error: 'kind and refId required' };
    return equipItem(playerId, kind, refId);
  }));

  // Unequip the item in a slot (component slot or weapon group) back into the stash. Body: { slot }.
  app.post('/api/players/:id/unequip', shopMutation((playerId, body) => {
    const { slot } = body;
    if (typeof slot !== 'string' || !slot) return { ok: false, status: 400, error: 'slot required' };
    return unequipItem(playerId, slot);
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

  // Public client config (no secrets — the browser Sentry DSN is public by design). Lets the client
  // enable Sentry without a build step or a hardcoded DSN; null when unset (client skips Sentry).
  app.get('/api/config', (req, res) => {
    res.json({
      sentry: process.env.SENTRY_DSN_WEB ? {
        dsn: process.env.SENTRY_DSN_WEB,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
        release: process.env.SENTRY_RELEASE || null,
      } : null,
    });
  });

  // Product funnel events (DECISIONS / docs/plans/monitoring.md). Best-effort, fire-and-forget from the
  // client; never blocks gameplay. Accepts one event or a batch ({ events: [...] }). Unknown types are
  // dropped (allowlist). 204 if anything was recorded, 400 if nothing valid was sent.
  app.post('/api/events', wrap(async (req, res) => {
    const body = req.body || {};
    const items = Array.isArray(body.events) ? body.events : [body];
    let accepted = 0;
    for (const e of items.slice(0, 50)) { // cap a batch to bound abuse
      const playerId = e.playerId || body.playerId;
      if (!playerId || typeof playerId !== 'string' || !EVENT_TYPES.has(e.type)) continue;
      try { await recordEvent(playerId, e.type, e.data ?? null); accepted++; } catch { /* best-effort */ }
    }
    res.status(accepted ? 204 : 400).end();
  }));

  // Serve the game client (index.html etc.) from the same origin as the API.
  app.use(express.static(clientDir));

  // Sentry's Express error handler — reports unhandled route errors, then falls through to ours.
  // Must come after the routes and before our own error middleware. No-op when Sentry isn't enabled.
  if (sentryEnabled) Sentry.setupExpressErrorHandler(app);

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
