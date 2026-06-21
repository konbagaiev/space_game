// Data layer: SQLite via the built-in node:sqlite module (no native dependencies).
// Stores players (anonymous, identified by a browser-generated id) and their game history.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { SESSION_TTL_MS, VERIFY_TTL_MS } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DB path is configurable via DB_PATH (tests use a temp file); defaults to data/game.db.
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'game.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Schema is created/updated by the migration runner (see migrate.js + migrations/),
// run at server startup. This module only opens the database and exposes queries.
export const db = new DatabaseSync(dbPath);

// Apply schema migrations, then seed/refresh the catalog (idempotent upsert).
export async function migrate() {
  const { runMigrations } = await import('./migrate.js');
  await runMigrations(db);
  await seedCatalog();
}

// Upsert the ship/weapon catalog from the shared snapshot. Runs on every startup, so editing
// catalog_seed.js updates the rows (ids/foreign keys preserved — weapons keyed by id, ships by name).
async function seedCatalog() {
  const { SHIPS, WEAPONS, MAPS, LEVELS, COMPONENTS } = await import('./catalog_seed.js');
  const upC = db.prepare(`INSERT INTO components (id, name, type, weight, stats) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, weight = excluded.weight, stats = excluded.stats`);
  for (const c of COMPONENTS) upC.run(c.id, c.name, c.type, c.weight, JSON.stringify(c.stats));
  const upW = db.prepare(`INSERT INTO weapons (id, name, type, stats) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, stats = excluded.stats`);
  for (const w of WEAPONS) upW.run(w.id, w.name, w.type, JSON.stringify(w.stats));
  const upS = db.prepare(`INSERT INTO ships (name, type, stats, model_url, components) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET type = excluded.type, stats = excluded.stats, model_url = excluded.model_url, components = excluded.components`);
  for (const s of SHIPS) upS.run(s.name, s.type, JSON.stringify(s.stats), s.modelUrl ?? null, JSON.stringify(s.components));
  const upM = db.prepare(`INSERT INTO maps (name, descriptor) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET descriptor = excluded.descriptor`);
  for (const m of MAPS) upM.run(m.name, JSON.stringify(m.descriptor));
  const upL = db.prepare(`INSERT INTO levels (name, descriptor) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET descriptor = excluded.descriptor`);
  for (const l of LEVELS) upL.run(l.name, JSON.stringify(l.descriptor));
}

// Give a player their starter ship if they don't own one yet: the default 'player' ship,
// active, with an empty loadout (so it uses the ship's default weapons).
function ensureDefaultShip(playerId) {
  const has = db.prepare('SELECT 1 FROM player_ships WHERE player_id = ? LIMIT 1').get(playerId);
  if (has) return;
  const ship = db.prepare("SELECT id FROM ships WHERE type = 'player' ORDER BY id LIMIT 1").get();
  if (!ship) return; // catalog not seeded yet
  db.prepare('INSERT INTO player_ships (player_id, ship_id, is_active, loadout, created_at) VALUES (?, ?, 1, ?, ?)')
    .run(playerId, ship.id, '{}', Date.now());
}

// Auto-register: create the player if new, otherwise just bump last_seen. Either way they end
// up owning their default active ship.
export function registerPlayer(id) {
  const now = Date.now();
  const existing = db.prepare('SELECT created_at, games_played, current_progress, language, credits FROM players WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(now, id);
    ensureDefaultShip(id);
    return { id, isNew: false, gamesPlayed: existing.games_played, currentProgress: existing.current_progress, language: existing.language, credits: existing.credits, createdAt: existing.created_at };
  }
  db.prepare('INSERT INTO players (id, created_at, last_seen) VALUES (?, ?, ?)').run(id, now, now);
  ensureDefaultShip(id);
  return { id, isNew: true, gamesPlayed: 0, currentProgress: 1, language: 'en', credits: 1000, createdAt: now };
}

// Persist a player's language preference (validated to a supported code by the caller/route).
export function setPlayerLanguage(playerId, language) {
  registerPlayer(playerId);
  db.prepare('UPDATE players SET language = ?, last_seen = ? WHERE id = ?').run(language, Date.now(), playerId);
  return { id: playerId, language };
}

// The level a player is currently on (their highest unlocked level). Joins the
// player's current_progress FK to the levels table; null if the player/level is gone.
export function getCurrentLevel(playerId) {
  registerPlayer(playerId); // make sure the player exists (new players default to level-1)
  const row = db.prepare(
    'SELECT l.name, l.descriptor FROM players p JOIN levels l ON l.id = p.current_progress WHERE p.id = ?'
  ).get(playerId);
  if (!row) return null;
  return { name: row.name, descriptor: JSON.parse(row.descriptor) };
}

// Replace a mounted weapon on the player's active ship (materializes the effective mounts into the
// loadout override with `fromId` swapped to `toId`). Idempotent: a no-op if `fromId` isn't mounted.
function replaceActiveShipWeapon(playerId, fromId, toId) {
  const row = db.prepare(`SELECT ps.loadout, s.stats FROM player_ships ps JOIN ships s ON s.id = ps.ship_id
    WHERE ps.player_id = ? AND ps.is_active = 1 LIMIT 1`).get(playerId);
  if (!row) return;
  const loadout = JSON.parse(row.loadout || '{}');
  const stats = JSON.parse(row.stats);
  loadout.mounts = (loadout.mounts ?? stats.mounts ?? []).map((m) => (m.weapon === fromId ? { ...m, weapon: toId } : m));
  db.prepare('UPDATE player_ships SET loadout = ? WHERE player_id = ? AND is_active = 1')
    .run(JSON.stringify(loadout), playerId);
}

// Install a component into a slot on the player's active ship (materializes the effective components
// into the override with `slot` set to `componentId`). Idempotent: re-running sets the same slot.
function installActiveShipComponent(playerId, slot, componentId) {
  const row = db.prepare(`SELECT ps.components AS ps_components, s.components AS ship_components
    FROM player_ships ps JOIN ships s ON s.id = ps.ship_id
    WHERE ps.player_id = ? AND ps.is_active = 1 LIMIT 1`).get(playerId);
  if (!row) return;
  const components = JSON.parse(row.ps_components || row.ship_components || '{}');
  components[slot] = componentId;
  db.prepare('UPDATE player_ships SET components = ? WHERE player_id = ? AND is_active = 1')
    .run(JSON.stringify(components), playerId);
}

// Run a level briefing's actions (server-authoritative, persistent). Extend the switch with new
// action types as the game grows (e.g. addCredits, addToStash). Unknown types are ignored.
function applyBriefingActions(playerId, actions) {
  for (const a of (actions || [])) {
    if (a.type === 'replaceWeapon') replaceActiveShipWeapon(playerId, a.from, a.to);
    if (a.type === 'installComponent') installActiveShipComponent(playerId, a.slot, a.component);
  }
}

// The briefing attached to a level (message + actions), or null. Returns only what the client needs
// to display ({ textKey, text }); actions are run server-side, not sent to the client.
function runLevelBriefing(playerId, levelId) {
  const row = db.prepare('SELECT descriptor FROM levels WHERE id = ?').get(levelId);
  if (!row) return null;
  const briefing = JSON.parse(row.descriptor).briefing;
  if (!briefing) return null;
  applyBriefingActions(playerId, briefing.actions);
  return { textKey: briefing.textKey ?? null, text: briefing.text ?? null };
}

// Unlock the next level after the player's current one (smallest level id greater than the current).
// On a real advance, runs the newly-unlocked level's briefing (actions + message). No-op (already at
// the last level) returns advanced:false. Because progress only moves forward, each briefing runs once.
export function advanceProgress(playerId) {
  registerPlayer(playerId);
  const p = db.prepare('SELECT current_progress FROM players WHERE id = ?').get(playerId);
  const next = db.prepare('SELECT MIN(id) AS id FROM levels WHERE id > ?').get(p.current_progress);
  if (next && next.id != null) {
    db.prepare('UPDATE players SET current_progress = ? WHERE id = ?').run(next.id, playerId);
    const briefing = runLevelBriefing(playerId, next.id);
    return { currentProgress: next.id, advanced: true, briefing };
  }
  return { currentProgress: p.current_progress, advanced: false, briefing: null };
}

// Record one finished game in the player's history AND bank the credits earned into the player's
// balance (this is the only place credits are awarded). Returns the new balance.
export function recordGame(playerId, { credits = 0, kills = 0, durationMs = 0 } = {}) {
  const now = Date.now();
  registerPlayer(playerId); // make sure the player exists
  const earned = credits | 0;
  const info = db.prepare(
    'INSERT INTO games (player_id, credits, kills, duration_ms, ended_at) VALUES (?, ?, ?, ?, ?)'
  ).run(playerId, earned, kills | 0, durationMs | 0, now);
  db.prepare('UPDATE players SET games_played = games_played + 1, credits = credits + ?, last_seen = ? WHERE id = ?')
    .run(earned, now, playerId);
  const { credits: balance } = db.prepare('SELECT credits FROM players WHERE id = ?').get(playerId);
  return { gameId: Number(info.lastInsertRowid), credits: balance };
}

// Record one product-funnel event (best-effort telemetry; type is allowlisted by the API). `data` is
// optional JSON context. No registerPlayer (events are higher-volume and don't need the FK).
export function recordEvent(playerId, type, data) {
  db.prepare('INSERT INTO events (player_id, type, data, created_at) VALUES (?, ?, ?, ?)')
    .run(playerId, type, data != null ? JSON.stringify(data) : null, Date.now());
}

export function getPlayerGames(playerId, limit = 50) {
  // id is autoincrement, so DESC = newest first (deterministic even within the same ms).
  return db.prepare(
    'SELECT id, credits, kills, duration_ms, ended_at FROM games WHERE player_id = ? ORDER BY id DESC LIMIT ?'
  ).all(playerId, limit);
}

export function stats() {
  return {
    players: db.prepare('SELECT COUNT(*) AS n FROM players').get().n,
    games: db.prepare('SELECT COUNT(*) AS n FROM games').get().n,
  };
}

// Catalog: ships (player + enemies), weapons, components. JSON columns parsed on read.
export function getShips() {
  return db.prepare('SELECT id, name, type, stats, model_url, components FROM ships ORDER BY id').all()
    .map((r) => ({ id: r.id, name: r.name, type: r.type, stats: JSON.parse(r.stats), modelUrl: r.model_url,
      components: r.components ? JSON.parse(r.components) : null }));
}

export function getWeapons() {
  return db.prepare('SELECT id, name, type, stats FROM weapons ORDER BY id').all()
    .map((r) => ({ id: r.id, name: r.name, type: r.type, stats: JSON.parse(r.stats) }));
}

export function getComponents() {
  return db.prepare('SELECT id, name, type, weight, stats FROM components ORDER BY id').all()
    .map((r) => ({ id: r.id, name: r.name, type: r.type, weight: r.weight, stats: JSON.parse(r.stats) }));
}

// A map's scene descriptor (the client renders it via buildMap).
export function getMap(name) {
  const row = db.prepare('SELECT name, descriptor FROM maps WHERE name = ?').get(name);
  return row ? { name: row.name, descriptor: JSON.parse(row.descriptor) } : null;
}

// A level's descriptor (map + phase/wave script; the client's level runner plays it).
export function getLevel(name) {
  const row = db.prepare('SELECT name, descriptor FROM levels WHERE name = ?').get(name);
  return row ? { name: row.name, descriptor: JSON.parse(row.descriptor) } : null;
}

// ---------- Authentication (DECISIONS §11) ----------
// Public player view: never includes password fields. `emailVerifySentAt` drives resend throttling.
function playerSummary(r) {
  if (!r) return null;
  return {
    id: r.id, username: r.username ?? null, email: r.email ?? null,
    emailVerified: !!r.email_verified, currentProgress: r.current_progress,
    credits: r.credits, gamesPlayed: r.games_played, language: r.language,
    createdAt: r.created_at, emailVerifySentAt: r.email_verify_sent_at ?? null,
  };
}
const PLAYER_COLS = 'id, username, email, email_verified, current_progress, credits, games_played, language, created_at, email_verify_sent_at';

export function getPlayerPublic(id) {
  return playerSummary(db.prepare(`SELECT ${PLAYER_COLS} FROM players WHERE id = ?`).get(id));
}

// Set the display name on a (possibly still anonymous) player.
export function setUsername(playerId, username) {
  registerPlayer(playerId);
  db.prepare('UPDATE players SET username = ?, last_seen = ? WHERE id = ?').run(username, Date.now(), playerId);
  return getPlayerPublic(playerId);
}

// Login lookup: the credential row for an email (or null). Carries the hash/salt for verifyPassword.
export function findPlayerForLogin(email) {
  return db.prepare('SELECT id, password_hash, password_salt FROM players WHERE email = ?').get(email) || null;
}

// True if `email` belongs to a different player (duplicate-email guard).
export function emailInUse(email, exceptPlayerId) {
  const r = db.prepare('SELECT id FROM players WHERE email = ?').get(email);
  return !!(r && r.id !== exceptPlayerId);
}

// Attach credentials to an existing player row in place (progress preserved). Throws EMAIL_TAKEN
// if the email already belongs to another player.
export function registerAccount(playerId, { username, email, passwordHash, passwordSalt, verifyTokenHash, verifySentAt }) {
  registerPlayer(playerId);
  if (emailInUse(email, playerId)) { const e = new Error('email already in use'); e.code = 'EMAIL_TAKEN'; throw e; }
  db.prepare(`UPDATE players SET username = ?, email = ?, password_hash = ?, password_salt = ?,
      email_verified = 0, email_verify_token_hash = ?, email_verify_sent_at = ?, last_seen = ? WHERE id = ?`)
    .run(username ?? null, email, passwordHash, passwordSalt, verifyTokenHash, verifySentAt, Date.now(), playerId);
  return getPlayerPublic(playerId);
}

// Replace the email-verify token (resend flow).
export function setVerifyToken(playerId, verifyTokenHash, verifySentAt) {
  db.prepare('UPDATE players SET email_verify_token_hash = ?, email_verify_sent_at = ? WHERE id = ?')
    .run(verifyTokenHash, verifySentAt, playerId);
}

// Consume a verify token: if it matches an unexpired token, flip email_verified and clear it.
// Returns the player id on success, or null.
export function verifyEmailToken(tokenHash) {
  const minSentAt = Date.now() - VERIFY_TTL_MS;
  const r = db.prepare('SELECT id FROM players WHERE email_verify_token_hash = ? AND email_verify_sent_at >= ?')
    .get(tokenHash, minSentAt);
  if (!r) return null;
  db.prepare('UPDATE players SET email_verified = 1, email_verify_token_hash = NULL WHERE id = ?').run(r.id);
  return r.id;
}

export function createSession(playerId, tokenHash, userAgent) {
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, player_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
    .run(tokenHash, playerId, now, now + SESSION_TTL_MS, userAgent ?? null);
}

// The (unexpired) session's player, as a public summary, or null.
export function getSessionPlayer(tokenHash) {
  const cols = PLAYER_COLS.split(', ').map((c) => 'p.' + c).join(', ');
  const r = db.prepare(`SELECT ${cols} FROM sessions s JOIN players p ON p.id = s.player_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(tokenHash, Date.now());
  return playerSummary(r);
}

export function deleteSession(tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

// The player's active ship: the ship template + the effective loadout (explicit loadout falls
// back to the ship's default weapon ids). Registers the player (and their default ship) first.
export function getActivePlayerShip(playerId) {
  const reg = registerPlayer(playerId);
  const row = db.prepare(`
    SELECT ps.id AS player_ship_id, ps.loadout, ps.components AS ps_components,
           s.id AS ship_id, s.name, s.type, s.stats, s.model_url, s.components AS ship_components
    FROM player_ships ps JOIN ships s ON s.id = ps.ship_id
    WHERE ps.player_id = ? AND ps.is_active = 1 LIMIT 1`).get(playerId);
  if (!row) return null;
  const stats = JSON.parse(row.stats);
  const loadout = JSON.parse(row.loadout || '{}');
  const shipComponents = row.ship_components ? JSON.parse(row.ship_components) : null;
  const psComponents = row.ps_components ? JSON.parse(row.ps_components) : null;
  return {
    playerShipId: row.player_ship_id,
    ship: { id: row.ship_id, name: row.name, type: row.type, stats, modelUrl: row.model_url, components: shipComponents },
    // effective loadout/components: a player override falls back to the ship's defaults
    loadout: { mounts: loadout.mounts ?? stats.mounts ?? [] },
    components: psComponents ?? shipComponents,
    language: reg.language, // the player's stored language preference (client adopts it if unset locally)
    credits: reg.credits,   // the player's persistent credit balance
  };
}
