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
  const { SHIPS, WEAPONS, MAPS, LEVELS, COMPONENTS, SOUNDS, SOUND_MAP } = await import('./catalog_seed.js');
  const upC = db.prepare(`INSERT INTO components (id, name, type, weight, price, stats) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, weight = excluded.weight, price = excluded.price, stats = excluded.stats`);
  for (const c of COMPONENTS) upC.run(c.id, c.name, c.type, c.weight, c.price ?? 0, JSON.stringify(c.stats));
  const upW = db.prepare(`INSERT INTO weapons (id, name, type, price, stats) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, price = excluded.price, stats = excluded.stats`);
  for (const w of WEAPONS) upW.run(w.id, w.name, w.type, w.price ?? 0, JSON.stringify(w.stats));
  const upS = db.prepare(`INSERT INTO ships (name, type, stats, model_url, model_url_high, components) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET type = excluded.type, stats = excluded.stats, model_url = excluded.model_url, model_url_high = excluded.model_url_high, components = excluded.components`);
  for (const s of SHIPS) upS.run(s.name, s.type, JSON.stringify(s.stats), s.modelUrl ?? null, s.modelUrlHigh ?? null, JSON.stringify(s.components));
  // Prune orphaned ENEMY ships left over from a rename/removal (the upsert above can't delete). Only
  // enemy rows that are no longer in the seed AND owned by no player (enemies never are) — player ships
  // are never pruned so a player can't lose an owned ship.
  const enemyNames = SHIPS.filter((s) => s.type === 'enemy').map((s) => s.name);
  if (enemyNames.length) {
    db.prepare(`DELETE FROM ships WHERE type = 'enemy' AND name NOT IN (${enemyNames.map(() => '?').join(',')})
      AND id NOT IN (SELECT ship_id FROM player_ships)`).run(...enemyNames);
  }
  const upM = db.prepare(`INSERT INTO maps (name, descriptor) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET descriptor = excluded.descriptor`);
  for (const m of MAPS) upM.run(m.name, JSON.stringify(m.descriptor));
  const upL = db.prepare(`INSERT INTO levels (name, descriptor) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET descriptor = excluded.descriptor`);
  for (const l of LEVELS) upL.run(l.name, JSON.stringify(l.descriptor));
  const upSnd = db.prepare(`INSERT INTO sounds (key, url, gain) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET url = excluded.url, gain = excluded.gain`);
  for (const s of (SOUNDS ?? [])) upSnd.run(s.key, s.url, s.gain ?? 1);
  // sound_map is fully derived (and may have multiple rows per entity/class/event) → rebuild it each startup.
  db.exec('DELETE FROM sound_map');
  const insSm = db.prepare('INSERT INTO sound_map (entity, class, event, sound_key) VALUES (?, ?, ?, ?)');
  for (const m of (SOUND_MAP ?? [])) insSm.run(m.entity, m.class, m.event, m.sound);
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
  const existing = db.prepare('SELECT created_at, games_played, current_progress, language, credits, shop_unlocked FROM players WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(now, id);
    ensureDefaultShip(id);
    return { id, isNew: false, gamesPlayed: existing.games_played, currentProgress: existing.current_progress, language: existing.language, credits: existing.credits, shopUnlocked: !!existing.shop_unlocked, createdAt: existing.created_at };
  }
  db.prepare('INSERT INTO players (id, created_at, last_seen) VALUES (?, ?, ?)').run(id, now, now);
  ensureDefaultShip(id);
  return { id, isNew: true, gamesPlayed: 0, currentProgress: 1, language: 'en', credits: 1000, shopUnlocked: false, createdAt: now };
}

// Reset ONE player's progress, keeping their account and active login intact. Identity/auth
// columns (id, created_at, username, email, password_*, email_verified) and `sessions` rows are
// preserved, as is the language preference; everything that represents *progress* is wiped:
// game history, owned/active ships, stash and events, with games_played/current_progress/credits/
// shop_unlocked reset to a brand-new player's baseline. The starter ship is re-granted so the
// account stays immediately playable. Returns { found } — false (no-op) if the player is unknown.
export function resetPlayer(playerId) {
  const exists = db.prepare('SELECT 1 FROM players WHERE id = ?').get(playerId);
  if (!exists) return { found: false };
  db.exec('BEGIN');
  try {
    for (const t of ['games', 'player_ships', 'stash', 'events'])
      db.prepare(`DELETE FROM ${t} WHERE player_id = ?`).run(playerId);
    db.prepare('UPDATE players SET games_played = 0, current_progress = 1, credits = 1000, shop_unlocked = 0 WHERE id = ?').run(playerId);
    ensureDefaultShip(playerId); // re-grant the starter ship so the reset account is playable
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { found: true };
}

// Reset ALL players: wipe every player-scoped table (accounts, sessions, game history, ships,
// stash, events), leaving only the seeded reference catalog (ships/weapons/components/maps/levels).
// Equivalent to a fresh database; the catalog is re-seeded idempotently on the next startup, so
// it is intentionally left untouched here. Autoincrement counters are reset for a clean slate.
export function resetAllPlayers() {
  db.exec('BEGIN');
  try {
    for (const t of ['perf_samples', 'sessions', 'events', 'stash', 'player_ships', 'games', 'players'])
      db.exec(`DELETE FROM ${t}`);
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('games', 'player_ships', 'events', 'perf_samples')");
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
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
  const mounts = loadout.mounts ?? stats.mounts ?? [];
  const replaced = mounts.some((m) => m.weapon === fromId); // was the gun actually mounted?
  loadout.mounts = mounts.map((m) => (m.weapon === fromId ? { ...m, weapon: toId } : m));
  db.prepare('UPDATE player_ships SET loadout = ? WHERE player_id = ? AND is_active = 1')
    .run(JSON.stringify(loadout), playerId);
  if (replaced) depositStash(playerId, 'weapon', fromId); // the removed weapon is now owned (→ stash)
}

// Add one item to a player's stash (qty++), creating the row if absent. The single place items enter
// the stash. Caller runs it inside the surrounding mutation (briefing/buy/equip/unequip).
function depositStash(playerId, kind, refId, qty = 1) {
  db.prepare(`INSERT INTO stash (player_id, kind, ref_id, qty) VALUES (?, ?, ?, ?)
    ON CONFLICT(player_id, kind, ref_id) DO UPDATE SET qty = qty + excluded.qty`).run(playerId, kind, refId, qty);
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
    if (a.type === 'unlockShop') unlockShop(playerId); // e.g. reaching level-4 opens the hangar shop + side missions
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
  // No next level → the player just cleared the final level: unlock the hangar shop (once) and
  // backfill the basic gun (id 1) that was swapped out earlier, so it's owned in the stash.
  unlockShop(playerId);
  return { currentProgress: p.current_progress, advanced: false, briefing: null };
}

// Flip the shop_unlocked flag (idempotent) and, the first time, seed the basic kinetic gun (weapon 1)
// into the stash if it isn't already there (uniform whether or not replaceWeapon deposited it).
function unlockShop(playerId) {
  const row = db.prepare('SELECT shop_unlocked FROM players WHERE id = ?').get(playerId);
  if (row && row.shop_unlocked) return false;
  db.prepare('UPDATE players SET shop_unlocked = 1 WHERE id = ?').run(playerId);
  db.prepare(`INSERT INTO stash (player_id, kind, ref_id, qty) VALUES (?, 'weapon', 1, 1)
    ON CONFLICT(player_id, kind, ref_id) DO NOTHING`).run(playerId);
  return true;
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

// Record one aggregated client perf sample (best-effort diagnostic telemetry from the ?dev monitor;
// docs/plans/perf-low-end-phones.md). `sample` is an arbitrary JSON object (1s of frame stats + device).
export function recordPerfSample(playerId, sessionId, sample) {
  db.prepare('INSERT INTO perf_samples (player_id, session_id, sample, created_at) VALUES (?, ?, ?, ?)')
    .run(playerId, sessionId, JSON.stringify(sample ?? null), Date.now());
}

// Read perf samples (newest first) — for analysis / tests; not exposed via a public route.
export function getPerfSamples(sessionId = null, limit = 500) {
  const rows = sessionId
    ? db.prepare('SELECT * FROM perf_samples WHERE session_id = ? ORDER BY id DESC LIMIT ?').all(sessionId, limit)
    : db.prepare('SELECT * FROM perf_samples ORDER BY id DESC LIMIT ?').all(limit);
  return rows.map((r) => ({ ...r, sample: JSON.parse(r.sample) }));
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
  return db.prepare('SELECT id, name, type, stats, model_url, model_url_high, components FROM ships ORDER BY id').all()
    .map((r) => ({ id: r.id, name: r.name, type: r.type, stats: JSON.parse(r.stats), modelUrl: r.model_url, modelUrlHigh: r.model_url_high,
      components: r.components ? JSON.parse(r.components) : null }));
}

export function getWeapons() {
  return db.prepare('SELECT id, name, type, price, stats FROM weapons ORDER BY id').all()
    .map((r) => ({ id: r.id, name: r.name, type: r.type, price: r.price, stats: JSON.parse(r.stats) }));
}

export function getComponents() {
  return db.prepare('SELECT id, name, type, weight, price, stats FROM components ORDER BY id').all()
    .map((r) => ({ id: r.id, name: r.name, type: r.type, weight: r.weight, price: r.price, stats: JSON.parse(r.stats) }));
}

// SFX catalog: the sounds registry (key->url) + the class-based routing map. The client preloads the
// sounds and resolves (entity, class, event) -> key at runtime (no hardcoded routing).
export function getSoundCatalog() {
  const sounds = db.prepare('SELECT key, url, gain FROM sounds ORDER BY key').all();
  const map = db.prepare('SELECT entity, class, event, sound_key FROM sound_map ORDER BY entity, class, event').all()
    .map((r) => ({ entity: r.entity, class: r.class, event: r.event, sound: r.sound_key }));
  return { sounds, map };
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

// ---------- Hangar shop + stash (docs/plans/hangar-shop.md) ----------
// All mutations here are server-authoritative + transactional (no double-spend / item dupe).
const REQUIRED_SLOTS = new Set(['hull', 'engine', 'thruster']); // a ship can't take off without these
const COMPONENT_SLOTS = new Set(['hull', 'engine', 'thruster', 'repair']);
const WEAPON_GROUP = { bullet: 'gun', rocket: 'rocket' }; // which fire-group a weapon type slots into
const sellPrice = (price) => Math.floor((price | 0) * 0.75); // resale value (server-computed)

// Catalog lookup for a stash/shop item (component or weapon), with parsed stats. null if missing.
function catalogItem(kind, refId) {
  if (kind === 'component') {
    const r = db.prepare('SELECT id, name, type, weight, price, stats FROM components WHERE id = ?').get(refId);
    return r ? { kind, refId: r.id, name: r.name, type: r.type, weight: r.weight, price: r.price, stats: JSON.parse(r.stats) } : null;
  }
  if (kind === 'weapon') {
    const r = db.prepare('SELECT id, name, type, price, stats FROM weapons WHERE id = ?').get(refId);
    return r ? { kind, refId: r.id, name: r.name, type: r.type, price: r.price, stats: JSON.parse(r.stats) } : null;
  }
  return null;
}

// Remove one unit of an item from the stash (and drop the row when it hits 0).
function decStash(playerId, kind, refId) {
  db.prepare('UPDATE stash SET qty = qty - 1 WHERE player_id = ? AND kind = ? AND ref_id = ?').run(playerId, kind, refId);
  db.prepare('DELETE FROM stash WHERE player_id = ? AND kind = ? AND ref_id = ? AND qty <= 0').run(playerId, kind, refId);
}
const stashQty = (playerId, kind, refId) =>
  db.prepare('SELECT qty FROM stash WHERE player_id = ? AND kind = ? AND ref_id = ?').get(playerId, kind, refId)?.qty ?? 0;
const credit = (playerId, amount) =>
  db.prepare('UPDATE players SET credits = credits + ? WHERE id = ?').run(amount | 0, playerId);

// The active ship's effective loadout (mounts) + components, materialized from the override or the
// ship defaults, ready to mutate + save back.
function activeLoadoutComponents(playerId) {
  const row = db.prepare(`SELECT ps.loadout, ps.components AS ps_components, s.stats, s.components AS ship_components
    FROM player_ships ps JOIN ships s ON s.id = ps.ship_id WHERE ps.player_id = ? AND ps.is_active = 1 LIMIT 1`).get(playerId);
  if (!row) return null;
  const stats = JSON.parse(row.stats);
  const loadout = JSON.parse(row.loadout || '{}');
  return {
    mounts: loadout.mounts ?? stats.mounts ?? [],
    components: JSON.parse(row.ps_components || row.ship_components || '{}'),
  };
}
const saveActiveLoadout = (playerId, mounts) =>
  db.prepare('UPDATE player_ships SET loadout = ? WHERE player_id = ? AND is_active = 1')
    .run(JSON.stringify({ mounts }), playerId);
const saveActiveComponents = (playerId, components) =>
  db.prepare('UPDATE player_ships SET components = ? WHERE player_id = ? AND is_active = 1')
    .run(JSON.stringify(components), playerId);

const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

// The player's stash, joined to the catalog (name/type/stats/price). Empty rows (qty 0) excluded.
export function getStash(playerId) {
  registerPlayer(playerId);
  return db.prepare('SELECT kind, ref_id, qty FROM stash WHERE player_id = ? AND qty > 0 ORDER BY kind, ref_id').all(playerId)
    .map((r) => { const it = catalogItem(r.kind, r.ref_id); return it ? { ...it, qty: r.qty } : null; })
    .filter(Boolean);
}

// Buy a catalog item into the stash: price ≤ balance → deduct credits → stash qty++. Transactional.
export function buyItem(playerId, kind, refId) {
  registerPlayer(playerId);
  const item = catalogItem(kind, refId);
  if (!item) return { ok: false, status: 400, error: 'no such item' };
  const price = item.price | 0;
  return tx(() => {
    const { credits } = db.prepare('SELECT credits FROM players WHERE id = ?').get(playerId);
    if (price > credits) return { ok: false, status: 402, error: 'insufficient credits' };
    credit(playerId, -price);
    depositStash(playerId, kind, refId);
    return { ok: true };
  });
}

// Sell an item for floor(price*0.75). From the stash (kind+refId), or — when `slot` is given — an
// OPTIONAL equipped item (weapon group / repair) directly from the ship. Required slots can't be sold.
export function sellItem(playerId, { kind, refId, slot } = {}) {
  registerPlayer(playerId);
  if (slot) return sellEquipped(playerId, slot);
  const item = catalogItem(kind, refId);
  if (!item) return { ok: false, status: 400, error: 'no such item' };
  return tx(() => {
    if (stashQty(playerId, kind, refId) <= 0) return { ok: false, status: 409, error: 'not in stash' };
    decStash(playerId, kind, refId);
    credit(playerId, sellPrice(item.price));
    return { ok: true };
  });
}

// Sell an optional equipped item directly (no unequip step). `slot` is a component slot ('repair') or
// a weapon group ('gun'/'rocket'). Required component slots (hull/engine/thruster) are rejected.
function sellEquipped(playerId, slot) {
  if (REQUIRED_SLOTS.has(slot)) return { ok: false, status: 409, error: 'required slot can\'t be sold while equipped' };
  return tx(() => {
    const cfg = activeLoadoutComponents(playerId);
    if (!cfg) return { ok: false, status: 404, error: 'no active ship' };
    if (COMPONENT_SLOTS.has(slot)) {
      const refId = cfg.components[slot];
      if (refId == null) return { ok: false, status: 409, error: 'slot is empty' };
      const item = catalogItem('component', refId);
      delete cfg.components[slot];
      saveActiveComponents(playerId, cfg.components);
      credit(playerId, sellPrice(item ? item.price : 0));
      return { ok: true };
    }
    // weapon group: sell the first mount in that group
    const idx = cfg.mounts.findIndex((m) => m.group === slot);
    if (idx < 0) return { ok: false, status: 409, error: 'slot is empty' };
    const item = catalogItem('weapon', cfg.mounts[idx].weapon);
    cfg.mounts.splice(idx, 1);
    saveActiveLoadout(playerId, cfg.mounts);
    credit(playerId, sellPrice(item ? item.price : 0));
    return { ok: true };
  });
}

// Equip an item from the stash onto the active ship; the previously-equipped item (if any) returns to
// the stash. Components slot by their type (hull/engine/thruster/repair); weapons by their fire-group.
export function equipItem(playerId, kind, refId) {
  registerPlayer(playerId);
  const item = catalogItem(kind, refId);
  if (!item) return { ok: false, status: 400, error: 'no such item' };
  return tx(() => {
    if (stashQty(playerId, kind, refId) <= 0) return { ok: false, status: 409, error: 'not in stash' };
    const cfg = activeLoadoutComponents(playerId);
    if (!cfg) return { ok: false, status: 404, error: 'no active ship' };
    if (kind === 'component') {
      const slot = item.type; // hull/engine/thruster/repair
      const prev = cfg.components[slot];
      cfg.components[slot] = refId;
      saveActiveComponents(playerId, cfg.components);
      decStash(playerId, kind, refId);
      if (prev != null) depositStash(playerId, 'component', prev); // displaced item → stash (net-zero if same id)
      return { ok: true };
    }
    // weapon: replace the first mount in its group, or add one if the group has none
    const group = WEAPON_GROUP[item.type] || 'gun';
    const idx = cfg.mounts.findIndex((m) => m.group === group);
    let prev = null;
    if (idx >= 0) { prev = cfg.mounts[idx].weapon; cfg.mounts[idx] = { ...cfg.mounts[idx], weapon: refId }; }
    else cfg.mounts.push({ weapon: refId, group, offset: 0, delay: 0 });
    saveActiveLoadout(playerId, cfg.mounts);
    decStash(playerId, kind, refId);
    if (prev != null) depositStash(playerId, 'weapon', prev); // displaced weapon → stash (net-zero if same id)
    return { ok: true };
  });
}

// Unequip the item in a slot back into the stash. `slot` is a component slot or a weapon group.
// Allowed even for required slots (emptying one just blocks take-off; see getActivePlayerShip).
export function unequipItem(playerId, slot) {
  registerPlayer(playerId);
  return tx(() => {
    const cfg = activeLoadoutComponents(playerId);
    if (!cfg) return { ok: false, status: 404, error: 'no active ship' };
    if (COMPONENT_SLOTS.has(slot)) {
      const refId = cfg.components[slot];
      if (refId == null) return { ok: false, status: 409, error: 'slot is empty' };
      delete cfg.components[slot];
      saveActiveComponents(playerId, cfg.components);
      depositStash(playerId, 'component', refId);
      return { ok: true };
    }
    const idx = cfg.mounts.findIndex((m) => m.group === slot);
    if (idx < 0) return { ok: false, status: 409, error: 'slot is empty' };
    const refId = cfg.mounts[idx].weapon;
    cfg.mounts.splice(idx, 1);
    saveActiveLoadout(playerId, cfg.mounts);
    depositStash(playerId, 'weapon', refId);
    return { ok: true };
  });
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
           s.id AS ship_id, s.name, s.type, s.stats, s.model_url, s.model_url_high, s.components AS ship_components
    FROM player_ships ps JOIN ships s ON s.id = ps.ship_id
    WHERE ps.player_id = ? AND ps.is_active = 1 LIMIT 1`).get(playerId);
  if (!row) return null;
  const stats = JSON.parse(row.stats);
  const loadout = JSON.parse(row.loadout || '{}');
  const shipComponents = row.ship_components ? JSON.parse(row.ship_components) : null;
  const psComponents = row.ps_components ? JSON.parse(row.ps_components) : null;
  const components = psComponents ?? shipComponents ?? {};
  const missingRequired = [...REQUIRED_SLOTS].filter((s) => components[s] == null); // empty required slots
  return {
    playerShipId: row.player_ship_id,
    ship: { id: row.ship_id, name: row.name, type: row.type, stats, modelUrl: row.model_url, modelUrlHigh: row.model_url_high, components: shipComponents },
    // effective loadout/components: a player override falls back to the ship's defaults
    loadout: { mounts: loadout.mounts ?? stats.mounts ?? [] },
    components,
    language: reg.language, // the player's stored language preference (client adopts it if unset locally)
    credits: reg.credits,   // the player's persistent credit balance
    shopUnlocked: reg.shopUnlocked, // hangar shop gate (cleared the final level)
    launchable: missingRequired.length === 0, // false ⇒ a required slot is empty (block take-off)
    missingRequired,
  };
}
