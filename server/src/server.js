// Backend server: serves the game client (static) AND the JSON API on one origin
// (so the client can call /api/... without CORS). Storage is PostgreSQL (see db.js).
import { sentryEnabled } from './instrument.js'; // MUST be first: Sentry.init before anything else loads
import * as Sentry from '@sentry/node';
import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { migrate, registerPlayer, setPlayerLanguage, getCurrentLevel, advanceProgress, recordGame, getPlayerGames, stats, getShips, getWeapons, getComponents, getSoundCatalog, getActivePlayerShip, getMap, getLevel, getLevels, backend, resetPlayer,
  getPlayerPublic, setUsername, findPlayerForLogin, registerAccount, setVerifyToken, verifyEmailToken, createSession, getSessionPlayer, deleteSession, recordEvent, recordPerfSample,
  setResetToken, consumeResetToken, deleteSessionsForPlayer,
  getStash, buyItem, sellItem, equipItem, unequipItem, depositLoot, getAdminPlayers,
  getMissionState, takeMission, deferMission, activateMission, clearMission, spendSkillPoint,
  recordSession, getAdminSessions, getSessionS3Key } from './datastore.js';
import { hashPassword, verifyPassword, newSessionToken, hashToken, makeRequireAuth, setSessionCookie, clearSessionCookie, sessionTokenFromReq, RESEND_THROTTLE_MS } from './auth.js';
import { generateMissions } from './missions.js';
import { mountAdmin } from './admin.js';
import { sendVerificationEmail, verificationUrl, sendPasswordResetEmail, passwordResetUrl } from './ses.js';
import { putTrace, getTrace } from './s3.js';
import { createTicketStore } from './netsim/tickets.js';
import crypto from 'node:crypto';

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

// Content-hashed pipeline assets: `<name>.<hash8>.<ext>` (docs/plans/ship-model-pipeline.md). The hash IS
// the version, so the bytes behind one URL can never change — safe to cache forever. Pure + exported so
// the policy is unit-testable without booting express.
const HASHED_ASSET = /\.[0-9a-f]{8}\.(glb|mp3|json)$/;
export const staticCacheControl = (filePath) =>
  (HASHED_ASSET.test(filePath) ? 'public, max-age=31536000, immutable' : null);

// Build the Express app (runs migrations first). Exported so tests can mount it
// without binding a port.
export async function createApp() {
  await migrate(); // bring the schema up to date before serving (backend chosen by DATABASE_URL)

  const app = express();

  // Ask Chromium browsers to send device Client Hints (UA Reduction hides the device model). The hints
  // arrive on subsequent same-origin requests — e.g. the boot POST /api/players/register — where we read
  // Sec-CH-UA-Model. Best-effort: other browsers ignore it; cross-origin (itch) isn't delegated the hint.
  // See docs/plans/2026-07-06-2154-admin-device-column.md.
  app.use((req, res, next) => {
    res.setHeader('Accept-CH', 'Sec-CH-UA-Model, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version');
    next();
  });

  const jsonParser = express.json();                    // ~100kb default — every normal route
  const sessionJson = express.json({ limit: '3mb' });   // replay traces are larger
  const netjerkJson = express.json({ limit: '8mb' });   // a whole session's netjerk record (dev sink only)
  app.use((req, res, next) => {
    if (req.path === '/api/sessions' && req.method === 'POST') return next();
    if (req.path === '/api/netjerk' && req.method === 'POST') return netjerkJson(req, res, next);
    return jsonParser(req, res, next);
  });

  // CORS for the cross-origin itch.io build (docs/plans/2026-07-01-1824-itch-html5-export.md). We reflect
  // the request Origin and do NOT allow credentials — the itch client authenticates with a bearer token,
  // never a cookie, so no credentials cross the boundary and CSRF stays off the table. Scoped to /api so
  // the same-origin static client serving is unaffected. Same-origin requests carry no Origin header and
  // are unchanged.
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') return res.status(204).end(); // preflight
    next();
  });

  // helper: run an async handler and forward errors to the error middleware
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // Auto-register a player by their browser-generated id (create if new).
  app.post('/api/players/register', wrap(async (req, res) => {
    const { playerId, referrer } = req.body || {};
    if (!playerId || typeof playerId !== 'string') {
      return res.status(400).json({ error: 'playerId (string) required' });
    }
    const model = String(req.headers['sec-ch-ua-model'] || '').replace(/"/g, '').trim() || null; // client-hint device code
    const device = { userAgent: req.headers['user-agent'] || null, model };
    res.json(await registerPlayer(playerId, typeof referrer === 'string' ? referrer : null, device));
  }));

  // Record one finished game and bank the credits earned into the player's balance.
  // ---------- ?netjerk sink (development only) ----------
  //
  // The probe's record, written to disk on THIS machine so a stutter report is a file the maintainer never
  // has to carry anywhere. It exists because the browser's own download is the wrong tool here: it needs a
  // user gesture Chrome may not credit to a rAF callback, and it lands in ~/Downloads rather than next to
  // the code that has to read it.
  //
  // OFF unless `NETJERK_SINK=1` is in the environment, and deliberately so: an endpoint that writes a
  // client-supplied body to disk is not something to leave standing on a public server. The filename is
  // built here, never taken from the request.
  if (process.env.NETJERK_SINK === '1') {
    const sinkDir = path.join(__dirname, '..', '..', '.netjerk');
    app.post('/api/netjerk', wrap(async (req, res) => {
      const body = req.body || {};
      if (body.kind !== 'netjerk') return res.status(400).json({ error: 'not a netjerk record' });
      await fsp.mkdir(sinkDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const name = `netjerk-${String(body.level || 'room').replace(/[^a-z0-9-]/gi, '')}-${stamp}.json`;
      const file = path.join(sinkDir, name);
      await fsp.writeFile(file, JSON.stringify(body));
      const n = (a) => (Array.isArray(a) ? a.length : 0);
      console.log(`[netjerk] ${name}: ${n(body.events)} breaks, ${n(body.arrivals)} packets, `
        + `${n(body.slowFrames)} slow frames, ${n(body.marks)} marks (reason: ${body.reason})`);
      res.json({ ok: true, file });
    }));
    console.log(`[netjerk] sink armed → ${sinkDir}`);
  }

  app.post('/api/games', wrap(async (req, res) => {
    const { playerId, credits, score, kills, durationMs, xp } = req.body || {};
    if (!playerId || typeof playerId !== 'string') {
      return res.status(400).json({ error: 'playerId (string) required' });
    }
    // `credits` is the field name; accept legacy `score` too so older clients still bank correctly.
    // `xp` (character progression) is banked alongside; older clients omit it → 0, harmless.
    res.json(await recordGame(playerId, { credits: credits ?? score, kills, durationMs, xp }));
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

  // TEMP debug sink: client → server log. The client POSTs { event, data, ua, t }; we print it to the
  // server console so on-device issues (e.g. the intro→Level-1 advance) can be diagnosed without a
  // devtools console. Remove once the intro-advance bug is fixed. (Base-menu-redesign debugging.)
  app.post('/api/clientlog', wrap(async (req, res) => {
    console.log('[clientlog]', JSON.stringify(req.body).slice(0, 2000));
    res.json({ ok: true });
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
    return { credits: activeShip ? activeShip.credits : 0, shopUnlocked: !!(activeShip && activeShip.shopUnlocked), sideMissionsUnlocked: !!(activeShip && activeShip.sideMissionsUnlocked), stash, activeShip };
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

  // Dump a mission's collected loot into the stash (client-authoritative, victory only — see DECISIONS).
  // Not gated on the shop unlock: loot is earned in combat and just accumulates in the stash. Body:
  // { items: [{ kind: 'component'|'weapon', refId }] }; malformed entries are skipped, [] is a no-op.
  app.post('/api/players/:id/loot', wrap(async (req, res) => {
    const r = await depositLoot(req.params.id, (req.body && req.body.items) || []);
    res.status(r.ok ? 200 : (r.status || 400)).json(r);
  }));

  // ---------- Side missions (docs/plans/mission-generator.md) ----------
  // The 3-choice side-mission board. Gated separately from the shop: it opens LATER, on reaching the level
  // seeded as `level-4` (`SIDE_MISSIONS_MIN_LEVEL`, the "Level 4" briefing, i.e. after clearing "Level 3" —
  // DECISIONS §91/§95); compared by level NAME, never by a raw id. The shop opens right after the first
  // playable level (DECISIONS §90). Returns the
  // currently-offered missions (each with a full level-style descriptor the client plays via levelRunner).
  // Clearing one banks per-kill ×2 credits like a level and does NOT advance the story counter.
  // Stable set of offered side-mission ids (the generator is deterministic) — used to validate mutations.
  const SIDE_MISSION_IDS = new Set(generateMissions().map((m) => m.id));
  // A gated side-mission mutation: 403 until the board unlocks, then validate the id and run `op` (which
  // returns the fresh mission state { taken, activeMissionId, cleared } the client re-renders from). `allowNull`
  // lets `activate` target the campaign (missionId = null → "Main operation").
  const missionMutation = (op, { allowNull = false } = {}) => wrap(async (req, res) => {
    const playerId = req.params.id;
    const active = await getActivePlayerShip(playerId);
    if (!active || !active.sideMissionsUnlocked) return res.status(403).json({ error: 'missions locked' });
    const missionId = (req.body && req.body.missionId) ?? null;
    if (missionId == null) { if (!allowNull) return res.status(400).json({ error: 'missionId required' }); }
    else if (!SIDE_MISSION_IDS.has(missionId)) return res.status(400).json({ error: 'unknown mission' });
    res.json(await op(playerId, missionId));
  });

  app.get('/api/players/:id/missions', wrap(async (req, res) => {
    const active = await getActivePlayerShip(req.params.id);
    if (!active || !active.sideMissionsUnlocked) return res.status(403).json({ error: 'missions locked' });
    const state = await getMissionState(req.params.id);
    // `cleared` feeds the board's "Cleared" badge on every landing — clearing happens at the victory
    // overlay, not on this board, so a mutation-only field would be undefined here. Ship it explicitly.
    res.json({ missions: generateMissions(), taken: state.taken, activeMissionId: state.activeMissionId, cleared: state.cleared });
  }));

  // Take a side mission onto the board / defer (remove) it / make one the active mission (Take-off flies
  // the active one; activate accepts null = the campaign). All return the fresh
  // { taken, activeMissionId, cleared }.
  app.post('/api/players/:id/missions/take', missionMutation((pid, mid) => takeMission(pid, mid)));
  app.post('/api/players/:id/missions/defer', missionMutation((pid, mid) => deferMission(pid, mid)));
  app.post('/api/players/:id/missions/activate', missionMutation((pid, mid) => activateMission(pid, mid), { allowNull: true }));
  // Report a side mission CLEARED (won). Client-authoritative like /api/games + /loot — the client tells us
  // it won; the server records it permanently and idempotently. Unlocks `stats.minMission` shop rows.
  app.post('/api/players/:id/missions/clear', missionMutation((pid, mid) => clearMission(pid, mid)));

  // Buy a catalog item into the stash (credits down). Body: { kind: 'component'|'weapon', refId }.
  app.post('/api/players/:id/buy', shopMutation((playerId, body) => {
    const { kind, refId } = body;
    if ((kind !== 'component' && kind !== 'weapon') || !Number.isInteger(refId)) return { ok: false, status: 400, error: 'kind and refId required' };
    return buyItem(playerId, kind, refId);
  }));

  // Sell a stash item ({ kind, refId }) or an optional equipped item ({ slot }) for 75% of its price.
  app.post('/api/players/:id/sell', shopMutation((playerId, body) => {
    const { kind, refId, slot, qty } = body;
    if (slot) { if (typeof slot !== 'string') return { ok: false, status: 400, error: 'slot must be a string' }; return sellItem(playerId, { slot }); }
    if ((kind !== 'component' && kind !== 'weapon') || !Number.isInteger(refId)) return { ok: false, status: 400, error: 'kind and refId (or slot) required' };
    if (qty != null && (!Number.isInteger(qty) || qty < 1)) return { ok: false, status: 400, error: 'qty must be a positive integer' };
    return sellItem(playerId, { kind, refId, qty: qty ?? 1 });
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

  // Spend one unspent skill point on a skill (character progression). Body: { skill: 'kinetic'|... }.
  // Not shop-gated — progression is always available. Returns the fresh progression the client re-renders
  // from; 400 on an unknown skill, 409 when the player has no unspent points.
  app.post('/api/players/:id/skills/spend', wrap(async (req, res) => {
    const skill = req.body && req.body.skill;
    try {
      res.json({ progression: await spendSkillPoint(req.params.id, skill) });
    } catch (e) {
      if (e.code === 'BAD_SKILL') return res.status(400).json({ error: 'unknown skill' });
      if (e.code === 'NO_POINTS') return res.status(409).json({ error: 'no skill points' });
      throw e;
    }
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

  // ---------- Netsim handshake (docs/plans/server-authoritative-sim.md §5) ----------
  // A browser cannot set `Authorization` on a WebSocket handshake and `Origin` is not a security control,
  // so the socket is gated by a single-use ticket minted here, over the ordinary HTTP API, and spent within
  // 30 s at `/ws?ticket=…`. The store is exposed on the app so the boot code (and the tests) can hand the
  // same instance to `attachNetsim`.
  const wsTickets = createTicketStore();
  app.set('wsTickets', wsTickets);
  app.post('/api/ws-ticket', rateLimit({ windowMs: 60_000, max: 60 }), wrap(async (req, res) => {
    // Netsim is opt-in and single-player still runs locally (D1), so this deliberately accepts the same
    // anonymous `playerId` every other player-scoped route accepts today — the ticket raises the bar from
    // "anyone may open a socket" to "a caller that just talked to our API may", which is the boundary this
    // cut needs. When accounts become the norm, bind it to `getSessionPlayer` instead and nothing else moves.
    const playerId = String((req.body || {}).playerId || '').trim();
    if (!playerId) return res.status(400).json({ error: 'playerId (string) required' });
    res.json(wsTickets.issue(playerId));
  }));

  // ---------- Authentication (DECISIONS §11) ----------
  const requireAuth = makeRequireAuth(getSessionPlayer);
  const authLimiter = rateLimit({ windowMs: 60_000, max: 10 }); // per-IP, per-minute on auth routes

  // Open a fresh session for a player: random token in an httpOnly cookie, hash stored server-side.
  // MUST await the insert before responding: a fire-and-forget createSession can still be in flight
  // when the client makes its next (authenticated) request, so the session lookup misses and auth
  // fails intermittently.
  const startSession = async (res, playerId, req) => {
    const token = newSessionToken();
    await createSession(playerId, hashToken(token), req.headers['user-agent']);
    setSessionCookie(res, token); // keep the cookie for the same-origin site (backward-compat)
    return token;                 // also hand it back so the JSON body can carry it (cross-origin bearer)
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
    const token = await startSession(res, playerId, req);
    res.json({ ...player, token });
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
    const token = await startSession(res, row.id, req);
    res.json({ ...(await getPlayerPublic(row.id)), token });
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

  // Begin password recovery. Enumeration-safe: ALWAYS 200. If the email maps to a real account (and a
  // send isn't throttled by password_reset_sent_at), store a hashed reset token and email a /?reset=… link.
  app.post('/api/auth/forgot-password', authLimiter, wrap(async (req, res) => {
    const email = normEmail(String((req.body || {}).email || ''));
    if (validEmail(email)) {
      const resetToken = newSessionToken();
      const target = await setResetToken(email, hashToken(resetToken), Date.now());
      if (target) await sendPasswordResetEmail(target.email, passwordResetUrl(resetToken));
    }
    res.json({ ok: true }); // never reveal whether the email exists
  }));

  // Complete password recovery: validate the token, rotate the password, mark the email verified, drop the
  // player's other sessions, and log them in on this device (fresh session cookie). Adopts like login.
  app.post('/api/auth/reset-password', authLimiter, wrap(async (req, res) => {
    const token = (req.body || {}).token;
    const password = (req.body || {}).password;
    if (!token || typeof token !== 'string') return res.status(400).json({ error: 'token required' });
    if (!validPassword(password)) return res.status(400).json({ error: 'password must be at least 8 characters' });
    const { hash, salt } = hashPassword(password);
    const playerId = await consumeResetToken(hashToken(token), hash, salt);
    if (!playerId) return res.status(400).json({ error: 'invalid or expired reset link' });
    await deleteSessionsForPlayer(playerId); // invalidate every existing session for this account
    const sessionToken = await startSession(res, playerId, req);  // …then open one fresh session for this device
    res.json({ ...(await getPlayerPublic(playerId)), token: sessionToken });
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

  // Client perf samples from the `?dev` monitor (docs/plans/perf-low-end-phones.md). Best-effort
  // diagnostic telemetry: a batch of ~1s aggregated samples, one row each. Write-only (no public read).
  app.post('/api/perf', wrap(async (req, res) => {
    const body = req.body || {};
    const { playerId, sessionId } = body;
    if (!playerId || typeof playerId !== 'string' || !sessionId || typeof sessionId !== 'string') {
      return res.status(400).end();
    }
    const samples = Array.isArray(body.samples) ? body.samples : [];
    let accepted = 0;
    for (const s of samples.slice(0, 120)) { // cap a batch to bound abuse
      if (!s || typeof s !== 'object') continue;
      try { await recordPerfSample(playerId, sessionId, s); accepted++; } catch { /* best-effort */ }
    }
    res.status(accepted ? 204 : 400).end();
  }));

  const GAME_VERSION = process.env.SENTRY_RELEASE || null;          // the deploy commit (Dockerfile bakes GIT_SHA)
  const SESSION_OUTCOMES = new Set(['win', 'death', 'quit']);
  // Hard server caps, above the client's own (MAX_SESSION_TICKS/MAX_SESSION_RUNS in session-record.js) so a
  // legitimate at-the-cap session is never rejected: ~33 min of sim, and a run count that bounds the payload
  // even when every tick differs (continuous analog touch input).
  const MAX_SESSION_TICKS = 120000;
  const MAX_SESSION_RUNS = 25000;

  // Store one gameplay session recording (docs/plans/2026-08-03-1246-record-all-sessions.md). The client
  // sends the input-replay trace; we upload it to S3 and write the metadata row. Best-effort, fire-and-forget.
  app.post('/api/sessions', sessionJson, wrap(async (req, res) => {
    const b = req.body || {};
    const { trace, level, outcome, durationMs, kills } = b;
    const playerId = (typeof b.playerId === 'string' && b.playerId) ? b.playerId : null;
    if (!trace || typeof trace !== 'object') return res.status(400).end();
    // Both trace shapes are accepted: v1's flat `ticks`, v2's run-length packed `runs` + `tickCount`.
    const ticks = Array.isArray(trace.ticks) ? trace.ticks.length
      : (Array.isArray(trace.runs) ? (Number.isFinite(trace.tickCount) ? trace.tickCount : 0) : 0);
    if (ticks <= 0) return res.status(400).end();
    if (ticks > MAX_SESSION_TICKS) return res.status(413).end();
    if (Array.isArray(trace.runs) && trace.runs.length > MAX_SESSION_RUNS) return res.status(413).end();
    if (typeof level !== 'string' || !SESSION_OUTCOMES.has(outcome)) return res.status(400).end();
    // The id comes from the CLIENT so the provisional upload (tab hidden) and the final one (win/death) land
    // on the SAME row — the recorder mints a UUID per session. Anything that isn't a plausible id gets a
    // server-side one instead. Guessing another player's UUID to overwrite their row is the same
    // infeasible-by-unguessability trade the unauthenticated trace GET below already makes, and the upsert
    // additionally refuses to cross player_id boundaries (see recordSession).
    const id = (typeof b.id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.id)) ? b.id : crypto.randomUUID();
    const s3Key = `recordings/sessions/${id}.json`;
    try {
      // Row FIRST: its player_id guard is what decides whether this upload may claim `id` at all. Writing S3
      // first would let a colliding id overwrite another player's trace even though their row was protected.
      const { written } = await recordSession({ id, playerId, level, outcome, durationMs, kills, s3Key, gameVersion: GAME_VERSION });
      if (written) await putTrace(s3Key, JSON.stringify(trace));       // no-op when creds absent (row still written)
    } catch { /* best-effort telemetry */ }
    res.status(204).end();
  }));

  // Serve a session's trace for admin playback (/?playback&id=…). INTENTIONALLY UNAUTHENTICATED: a trace
  // is seed + input only (no PII, no screen capture), keyed by an unguessable UUID, so an unauth GET is an
  // acceptable trade for a dead-simple playback page (the client's loadTrace fetches it directly). 404 when
  // unknown or S3 unavailable. (If we ever want it locked down, gate it behind the same Basic-Auth as /admin.)
  app.get('/api/sessions/:id/trace', wrap(async (req, res) => {
    const key = await getSessionS3Key(req.params.id);
    if (!key) return res.status(404).end();
    const trace = await getTrace(key);
    if (!trace) return res.status(404).end();
    res.json(trace);
  }));

  // Admin dashboard (docs/plans/2026-07-02-1352-admin-panel-player-stats.md): server-rendered players +
  // per-player game aggregates, HTTP Basic Auth (ADMIN_USER/ADMIN_PASSWORD; 404 when unset). Mounted
  // outside /api, so the /api-scoped CORS never touches it — /admin stays same-origin only.
  mountAdmin(app, getAdminPlayers, getAdminSessions, process.env.SENTRY_RELEASE || null, getLevels);

  // Serve the game client (index.html etc.) from the same origin as the API.
  //
  // Content-hashed assets are cached FOREVER. `express.static`'s default is `max-age=0`, which makes the
  // browser revalidate on every request: a conditional GET + a 304 round trip per asset. That is a real
  // cost on a weak mobile connection, and the worst case is per ENEMY SPAWN — ship models are re-requested
  // on every spawn (`ship-factory.js` applyShipModel), so a player on slow mobile watched enemies fly
  // around as the untextured placeholder while their model waited on a round trip, every single time.
  // The asset pipeline names these files `<name>.<hash8>.<ext>` (docs/plans/ship-model-pipeline.md), so a
  // new version is always a NEW URL — there is nothing to invalidate and `immutable` is safe by
  // construction. Everything else (index.html, src/*.js, styles.css — no hash in the name) keeps the
  // revalidating default so a deploy is picked up immediately.
  app.use(express.static(clientDir, {
    setHeaders(res, filePath) {
      if (HASHED_ASSET.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));

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
  // The netsim WebSocket rides the same listener (a socket arrives as an `upgrade` on the raw server, not
  // through Express). Nothing changes for a client that never asks for a ticket — single-player stays local.
  const { attachNetsim } = await import('./netsim/socket.js');
  const netsim = attachNetsim(server, {
    tickets: app.get('wsTickets'),
    loadShip: getActivePlayerShip, // the room flies the player's REAL ship, read from the account, not the client
  });
  // Graceful shutdown: on stop, stop accepting new connections and let in-flight
  // requests finish before exiting -> no dropped requests when the old container is
  // removed during a zero-downtime rollout.
  const shutdown = () => {
    netsim.closeAll(); // a live room holds an open socket; close it or `server.close` never resolves
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref(); // hard cap
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
