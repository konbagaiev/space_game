// The data layer — PostgreSQL (the only storage engine). All functions are async.
// Connects via DATABASE_URL; defaults to a local Postgres for zero-config dev/test.
import pg from 'pg';
import { SESSION_TTL_MS, VERIFY_TTL_MS, RESET_TTL_MS, RESEND_THROTTLE_MS } from './auth.js';

// DATABASE_URL in prod/CI; a local Postgres default so `npm start` / reset.js work with zero env.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/spacegame',
});

// Idempotent schema bootstrap + the migrations_pg one-shot ledger — the single, forward-only
// migration story (DECISIONS §9). Safe to run on every boot: CREATE TABLE IF NOT EXISTS + guarded
// ALTER/one-shots, then an upsert of the catalog from catalog_seed.js.
export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id           TEXT PRIMARY KEY,
      created_at   BIGINT  NOT NULL,
      last_seen    BIGINT  NOT NULL,
      games_played INTEGER NOT NULL DEFAULT 0,
      language     TEXT    NOT NULL DEFAULT 'en',  -- UI/content language preference (resolution is client-side)
      credits      INTEGER NOT NULL DEFAULT 1000,  -- persistent credit balance (new players start at 1000)
      referrer     TEXT,                           -- where the player first came from (write-once at row creation)
      user_agent   TEXT,                           -- raw UA from the boot register call (latest-wins)
      device_model TEXT                            -- Sec-CH-UA-Model device code, latest-wins
    );
    ALTER TABLE players ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';
    ALTER TABLE players ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 1000;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS referrer TEXT;   -- where the player first came from (write-once)
    ALTER TABLE players ADD COLUMN IF NOT EXISTS user_agent   TEXT;   -- raw UA from the boot register call (latest-wins)
    ALTER TABLE players ADD COLUMN IF NOT EXISTS device_model TEXT;   -- Sec-CH-UA-Model device code, latest-wins
    CREATE TABLE IF NOT EXISTS games (
      id          BIGSERIAL PRIMARY KEY,
      player_id   TEXT    NOT NULL REFERENCES players(id),
      credits     INTEGER NOT NULL DEFAULT 0,  -- credits earned that game (renamed from score)
      kills       INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      ended_at    BIGINT  NOT NULL
    );
    -- rename the legacy games.score → credits on databases created before this change (idempotent)
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'score') THEN
        ALTER TABLE games RENAME COLUMN score TO credits;
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_games_player ON games(player_id);

    CREATE TABLE IF NOT EXISTS components (
      id     BIGINT  PRIMARY KEY,  -- stable explicit ids (referenced from ships/player_ships)
      name   TEXT    NOT NULL UNIQUE,
      type   TEXT    NOT NULL,     -- 'hull' | 'engine'
      weight INTEGER NOT NULL,     -- contributes to ship mass
      price  INTEGER NOT NULL DEFAULT 0,  -- credits (hangar shop); 0 until real prices are set
      stats  JSONB   NOT NULL      -- hull {durability,volume} / engine {power,turnPower,maxSpeed,exhaust}
    );
    ALTER TABLE components ADD COLUMN IF NOT EXISTS price INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE components ADD COLUMN IF NOT EXISTS model_url TEXT;       -- item 3D model (combat; unused for items)
    ALTER TABLE components ADD COLUMN IF NOT EXISTS model_url_high TEXT;  -- item hangar model (CloudFront, menu icon)
    ALTER TABLE components ADD COLUMN IF NOT EXISTS rarity TEXT;          -- rarity tier: trash|common|rare (drop glow + pickup-log tint)
    ALTER TABLE components ADD COLUMN IF NOT EXISTS color  TEXT;          -- hex color for the rarity (source for both the glow & the tint)
    CREATE TABLE IF NOT EXISTS ships (
      id         BIGSERIAL PRIMARY KEY,
      name       TEXT  NOT NULL UNIQUE,
      type       TEXT  NOT NULL,   -- 'player' | 'enemy'
      stats      JSONB NOT NULL,   -- role/color/sizeScale, groups + mounts (weapons by id)
      model_url  TEXT,             -- combat (low-poly, same-origin) 3D model link (nullable; primitive if null)
      model_url_high TEXT,         -- hangar (high-poly, CloudFront, lazy-loaded) model link (nullable)
      components JSONB             -- { hull: <id>, engine: <id> }
    );
    ALTER TABLE ships ADD COLUMN IF NOT EXISTS components JSONB;
    ALTER TABLE ships ADD COLUMN IF NOT EXISTS model_url_high TEXT;
    CREATE TABLE IF NOT EXISTS weapons (
      id    BIGINT PRIMARY KEY,   -- stable explicit ids (referenced from ships/loadout)
      name  TEXT  NOT NULL UNIQUE,
      type  TEXT  NOT NULL,       -- 'bullet' | 'rocket'
      price INTEGER NOT NULL DEFAULT 0,  -- credits (hangar shop); 0 until real prices are set
      stats JSONB NOT NULL        -- damage/speed/cooldown/...
    );
    ALTER TABLE weapons ADD COLUMN IF NOT EXISTS price INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE weapons ADD COLUMN IF NOT EXISTS model_url TEXT;       -- item 3D model (combat; unused for items)
    ALTER TABLE weapons ADD COLUMN IF NOT EXISTS model_url_high TEXT;  -- item hangar model (CloudFront, menu icon)
    ALTER TABLE weapons ADD COLUMN IF NOT EXISTS rarity TEXT;          -- rarity tier: trash|common|rare (drop glow + pickup-log tint)
    ALTER TABLE weapons ADD COLUMN IF NOT EXISTS color  TEXT;          -- hex color for the rarity (source for both the glow & the tint)
    CREATE TABLE IF NOT EXISTS player_ships (
      id         BIGSERIAL PRIMARY KEY,
      player_id  TEXT    NOT NULL REFERENCES players(id),
      ship_id    BIGINT  NOT NULL REFERENCES ships(id),
      is_active  BOOLEAN NOT NULL DEFAULT false,
      loadout    JSONB   NOT NULL DEFAULT '{}'::jsonb,  -- may override mounts ({} = ship defaults)
      meta       JSONB,                                 -- future data/overrides
      components JSONB,                                 -- override the ship's components (null = ship defaults)
      created_at BIGINT  NOT NULL
    );
    ALTER TABLE player_ships ADD COLUMN IF NOT EXISTS components JSONB;
    CREATE INDEX IF NOT EXISTS idx_player_ships_player ON player_ships(player_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_player_active_ship ON player_ships(player_id) WHERE is_active;

    CREATE TABLE IF NOT EXISTS maps (
      id         BIGSERIAL PRIMARY KEY,
      name       TEXT  NOT NULL UNIQUE,
      descriptor JSONB NOT NULL   -- { generator, ...params } describing the scene
    );
    CREATE TABLE IF NOT EXISTS levels (
      id         BIGSERIAL PRIMARY KEY,
      name       TEXT  NOT NULL UNIQUE,
      descriptor JSONB NOT NULL   -- { title, map, phases:[...] }
    );
    -- player progress: the currently-available level (FK into levels). Added after the
    -- levels table exists; defaults to 1 (level-1). On an existing DB the levels rows
    -- already exist from prior startups, so the FK default validates.
    ALTER TABLE players ADD COLUMN IF NOT EXISTS current_progress INTEGER NOT NULL DEFAULT 1 REFERENCES levels(id);

    -- authentication (DECISIONS §11): optional email/password credentials attached in place to the
    -- anonymous players row. Username is a non-unique display name; login is by email. Passwords are
    -- scrypt-hashed (auth.js). Email uniqueness via a partial unique index (NULLs excluded).
    ALTER TABLE players ADD COLUMN IF NOT EXISTS username TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS password_hash TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS password_salt TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS email_verified INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS email_verify_token_hash TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS email_verify_sent_at BIGINT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS password_reset_sent_at BIGINT;
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_players_email ON players(email) WHERE email IS NOT NULL;

    -- server-side sessions: the cookie holds the raw token, the DB stores only its SHA-256 hash
    -- (a DB leak doesn't expose live sessions). Real FK on player_id here (Postgres path).
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT   PRIMARY KEY,
      player_id  TEXT   NOT NULL REFERENCES players(id),
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);

    -- product funnel events (docs/plans/monitoring.md). Best-effort telemetry — NO FK on player_id
    -- (logical FK; kept plain so a stray/early event never fails the insert). data is JSONB context.
    CREATE TABLE IF NOT EXISTS events (
      id         BIGSERIAL PRIMARY KEY,
      player_id  TEXT   NOT NULL,
      type       TEXT   NOT NULL,
      data       JSONB,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_player ON events(player_id);

    -- client perf samples (docs/plans/perf-low-end-phones.md). Diagnostic telemetry from the ?dev perf
    -- monitor: one row per ~1s aggregated sample (fps + frame-time percentiles + JS frame-cost breakdown
    -- + device/GPU passport). Best-effort, NO FK (logical FK). sample is the full JSONB payload.
    CREATE TABLE IF NOT EXISTS perf_samples (
      id         BIGSERIAL PRIMARY KEY,
      player_id  TEXT   NOT NULL,
      session_id TEXT   NOT NULL,
      sample     JSONB  NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_perf_session ON perf_samples(session_id);
    CREATE INDEX IF NOT EXISTS idx_perf_time ON perf_samples(created_at);
    CREATE INDEX IF NOT EXISTS idx_perf_player ON perf_samples(player_id);

    -- hangar shop + stash (docs/plans/hangar-shop.md). Player inventory (qty model), keyed by
    -- (player_id, kind, ref_id); kind ∈ {component, weapon} → components.id / weapons.id. The shop
    -- unlocks only after the player clears the final level → players.shop_unlocked.
    CREATE TABLE IF NOT EXISTS stash (
      player_id TEXT    NOT NULL,
      kind      TEXT    NOT NULL,   -- 'component' | 'weapon'
      ref_id    BIGINT  NOT NULL,   -- components.id / weapons.id
      qty       INTEGER NOT NULL DEFAULT 1,
      UNIQUE (player_id, kind, ref_id)
    );
    CREATE INDEX IF NOT EXISTS idx_stash_player ON stash(player_id);
    ALTER TABLE players ADD COLUMN IF NOT EXISTS shop_unlocked INTEGER NOT NULL DEFAULT 0;

    -- SFX (docs/plans/sound-classes-and-mapping.md): sounds = asset registry (key->url+gain);
    -- sound_map = class-based routing (entity, class, event) -> sound key. Rows seeded below.
    CREATE TABLE IF NOT EXISTS sounds (
      key  TEXT PRIMARY KEY,
      url  TEXT NOT NULL,
      gain REAL NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS sound_map (
      entity    TEXT NOT NULL,   -- 'ship' | 'weapon' | 'scene'
      class     TEXT NOT NULL,   -- entity's stats.class, or the scene name for music
      event     TEXT NOT NULL,   -- ship 'explode'/'hit'; weapon 'fire'/'explode'; scene 'music'
      sound_key TEXT NOT NULL REFERENCES sounds(key),
      PRIMARY KEY (entity, class, event, sound_key)
    );
    -- widen the PK to allow several sounds per (entity,class,event) (e.g. random music tracks per scene);
    -- idempotent so an existing DB created with the old 3-col PK migrates in place.
    ALTER TABLE sound_map DROP CONSTRAINT IF EXISTS sound_map_pkey;
    ALTER TABLE sound_map ADD CONSTRAINT sound_map_pkey PRIMARY KEY (entity, class, event, sound_key);
    -- one-shot migration ledger (Postgres has no versioned migrations; this records applied one-offs).
    CREATE TABLE IF NOT EXISTS migrations_pg (
      name       TEXT   PRIMARY KEY,
      applied_at BIGINT NOT NULL
    );
  `);

  // Upsert the catalog from the shared snapshot on every startup, so editing catalog_seed.js
  // propagates on deploy (ids/foreign keys preserved — weapons keyed by id, ships/maps/levels by name).
  const { SHIPS, WEAPONS, MAPS, LEVELS, COMPONENTS, SOUNDS, SOUND_MAP } = await import('./catalog_seed.js');
  for (const c of COMPONENTS) {
    await pool.query(
      `INSERT INTO components (id, name, type, weight, price, stats, model_url, model_url_high, rarity, color) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, weight = EXCLUDED.weight, price = EXCLUDED.price, stats = EXCLUDED.stats, model_url = EXCLUDED.model_url, model_url_high = EXCLUDED.model_url_high, rarity = EXCLUDED.rarity, color = EXCLUDED.color`,
      [c.id, c.name, c.type, c.weight, c.price ?? 0, JSON.stringify(c.stats), c.modelUrl ?? null, c.modelUrlHigh ?? null, c.rarity, c.color]);
  }
  for (const w of WEAPONS) {
    await pool.query(
      `INSERT INTO weapons (id, name, type, price, stats, model_url, model_url_high, rarity, color) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, price = EXCLUDED.price, stats = EXCLUDED.stats, model_url = EXCLUDED.model_url, model_url_high = EXCLUDED.model_url_high, rarity = EXCLUDED.rarity, color = EXCLUDED.color`,
      [w.id, w.name, w.type, w.price ?? 0, JSON.stringify(w.stats), w.modelUrl ?? null, w.modelUrlHigh ?? null, w.rarity, w.color]);
  }
  for (const s of SHIPS) {
    await pool.query(
      `INSERT INTO ships (name, type, stats, model_url, model_url_high, components) VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb)
       ON CONFLICT (name) DO UPDATE SET type = EXCLUDED.type, stats = EXCLUDED.stats, model_url = EXCLUDED.model_url, model_url_high = EXCLUDED.model_url_high, components = EXCLUDED.components`,
      [s.name, s.type, JSON.stringify(s.stats), s.modelUrl ?? null, s.modelUrlHigh ?? null, JSON.stringify(s.components)]);
  }
  // Prune orphaned ENEMY ships left over from a rename/removal (the upsert above can't delete). Only
  // enemy rows no longer in the seed AND owned by no player (enemies never are) — player ships are never
  // pruned so a player can't lose an owned ship.
  const enemyNames = SHIPS.filter((s) => s.type === 'enemy').map((s) => s.name);
  if (enemyNames.length) {
    await pool.query(
      `DELETE FROM ships WHERE type = 'enemy' AND name <> ALL($1::text[])
       AND id NOT IN (SELECT ship_id FROM player_ships)`,
      [enemyNames]);
  }
  for (const m of MAPS) {
    await pool.query(
      `INSERT INTO maps (name, descriptor) VALUES ($1, $2::jsonb)
       ON CONFLICT (name) DO UPDATE SET descriptor = EXCLUDED.descriptor`,
      [m.name, JSON.stringify(m.descriptor)]);
  }
  for (const l of LEVELS) {
    await pool.query(
      `INSERT INTO levels (name, descriptor) VALUES ($1, $2::jsonb)
       ON CONFLICT (name) DO UPDATE SET descriptor = EXCLUDED.descriptor`,
      [l.name, JSON.stringify(l.descriptor)]);
  }
  // One-shot: intro "Level 0" progress shift (+1). ON CONFLICT DO NOTHING
  // makes it run exactly once; RETURNING tells us whether this run is the one that claimed it. Runs AFTER
  // the levels seed so the new final level (id 5) exists and the FK on current_progress validates.
  const shift = await pool.query(
    `INSERT INTO migrations_pg (name, applied_at) VALUES ('intro_level0_progress_shift', $1)
     ON CONFLICT (name) DO NOTHING RETURNING name`, [Date.now()]);
  if (shift.rows[0]) {
    await pool.query('UPDATE players SET current_progress = current_progress + 1');
  }
  for (const s of (SOUNDS ?? [])) {
    await pool.query(
      `INSERT INTO sounds (key, url, gain) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET url = EXCLUDED.url, gain = EXCLUDED.gain`,
      [s.key, s.url, s.gain ?? 1]);
  }
  // sound_map is fully derived (possibly multiple rows per entity/class/event) → rebuild it each startup.
  await pool.query('DELETE FROM sound_map');
  for (const m of (SOUND_MAP ?? [])) {
    await pool.query(
      'INSERT INTO sound_map (entity, class, event, sound_key) VALUES ($1, $2, $3, $4)',
      [m.entity, m.class, m.event, m.sound]);
  }
  // Backfill the base Grab (component 29) onto existing players (DECISIONS §40; one-shot backfill, idempotent via the `NOT (components ? 'grab')` guard).
  // Players created before the Grab feature whose ship has an explicit `components` override predating Grab
  // have no 'grab' slot → grant them 29. NULL-components players inherit the reseeded ship default (grab:29),
  // so they need no change. Idempotent: the `NOT (components ? 'grab')` guard skips rows already carrying it.
  await pool.query(`UPDATE player_ships SET components = jsonb_set(components, '{grab}', '29'::jsonb)
    WHERE components IS NOT NULL AND NOT (components ? 'grab')`);
  // Backfill the Base shield (component 31) onto existing players. NEW
  // players get it from the reseeded ship default; players with an explicit pre-shield `components`
  // override don't. Idempotent: the `NOT (components ? 'shield')` guard skips rows already carrying it.
  await pool.query(`UPDATE player_ships SET components = jsonb_set(components, '{shield}', '31'::jsonb)
    WHERE components IS NOT NULL AND NOT (components ? 'shield')`);

  console.log('[migrate] postgres schema ready');
}

// Give a player their starter ship if they don't own one yet (default 'player' ship, active).
async function ensureDefaultShip(playerId, db = pool) {
  const has = await db.query('SELECT 1 FROM player_ships WHERE player_id = $1 LIMIT 1', [playerId]);
  if (has.rows[0]) return;
  const ship = await db.query("SELECT id FROM ships WHERE type = 'player' ORDER BY id LIMIT 1");
  if (!ship.rows[0]) return;
  await db.query(
    'INSERT INTO player_ships (player_id, ship_id, is_active, loadout, created_at) VALUES ($1, $2, true, $3::jsonb, $4)',
    [playerId, ship.rows[0].id, '{}', Date.now()]);
}

export async function registerPlayer(id, referrer = null, device = null) {
  const now = Date.now();
  const ua = device && device.userAgent ? String(device.userAgent).slice(0, 512) : null;
  const model = device && device.model ? String(device.model).slice(0, 128) : null;
  const { rows } = await pool.query('SELECT created_at, games_played, current_progress, language, credits, shop_unlocked FROM players WHERE id = $1', [id]);
  if (rows[0]) {
    // last_seen bump + latest-wins device (COALESCE keeps a prior value when this call has none); referrer untouched (write-once).
    await pool.query('UPDATE players SET last_seen = $1, user_agent = COALESCE($2, user_agent), device_model = COALESCE($3, device_model) WHERE id = $4', [now, ua, model, id]);
    await ensureDefaultShip(id);
    return { id, isNew: false, gamesPlayed: rows[0].games_played, currentProgress: rows[0].current_progress, language: rows[0].language, credits: rows[0].credits, shopUnlocked: !!rows[0].shop_unlocked, createdAt: Number(rows[0].created_at) };
  }
  const ref = referrer ? String(referrer).slice(0, 512) : null;
  await pool.query('INSERT INTO players (id, created_at, last_seen, referrer, user_agent, device_model) VALUES ($1, $2, $3, $4, $5, $6)', [id, now, now, ref, ua, model]);
  await ensureDefaultShip(id);
  return { id, isNew: true, gamesPlayed: 0, currentProgress: 1, language: 'en', credits: 1000, shopUnlocked: false, createdAt: now };
}

// Reset ONE player's progress, keeping their account and active login intact.
// Identity/auth columns and `sessions` rows are preserved, as is the
// language preference; game history, ships, stash and events are wiped and the gameplay columns
// reset to a new player's baseline, then the starter ship is re-granted. Returns { found }.
export async function resetPlayer(playerId) {
  const { rows } = await pool.query('SELECT 1 FROM players WHERE id = $1', [playerId]);
  if (!rows[0]) return { found: false };
  // One transaction so a failure can't leave the account half-wiped (games/ships gone, progress kept).
  // shop_unlocked is an INTEGER column (see migration) — write 0, not a boolean, or the UPDATE throws.
  await withTx(async (client) => {
    for (const t of ['games', 'player_ships', 'stash', 'events'])
      await client.query(`DELETE FROM ${t} WHERE player_id = $1`, [playerId]);
    await client.query('UPDATE players SET games_played = 0, current_progress = 1, credits = 1000, shop_unlocked = 0 WHERE id = $1', [playerId]);
    await ensureDefaultShip(playerId, client); // re-grant the starter ship so the reset account is playable
  });
  return { found: true };
}

// Reset ALL players: TRUNCATE every player-scoped table (CASCADE handles the FKs, RESTART IDENTITY
// resets the serial counters), leaving the seeded reference catalog untouched — it is re-upserted
// idempotently on the next startup. Single atomic statement.
export async function resetAllPlayers() {
  await pool.query('TRUNCATE players, games, player_ships, stash, events, sessions, perf_samples RESTART IDENTITY CASCADE');
}

// Persist a player's language preference (validated to a supported code by the caller/route).
export async function setPlayerLanguage(playerId, language) {
  await registerPlayer(playerId);
  await pool.query('UPDATE players SET language = $1, last_seen = $2 WHERE id = $3', [language, Date.now(), playerId]);
  return { id: playerId, language };
}

// The level a player is currently on (their highest unlocked level).
export async function getCurrentLevel(playerId) {
  await registerPlayer(playerId); // make sure the player exists (new players default to level-1)
  const { rows } = await pool.query(
    'SELECT l.name, l.descriptor FROM players p JOIN levels l ON l.id = p.current_progress WHERE p.id = $1',
    [playerId]
  );
  if (!rows[0]) return null;
  return { name: rows[0].name, descriptor: rows[0].descriptor };
}

// Unlock the next level after the player's current one. No-op at the last level.
// Replace a mounted weapon on the player's active ship (idempotent; no-op if `fromId` isn't mounted).
async function replaceActiveShipWeapon(playerId, fromId, toId) {
  const { rows } = await pool.query(`SELECT ps.loadout, s.stats FROM player_ships ps JOIN ships s ON s.id = ps.ship_id
    WHERE ps.player_id = $1 AND ps.is_active LIMIT 1`, [playerId]);
  if (!rows[0]) return;
  const loadout = rows[0].loadout || {};   // JSONB → already parsed
  const stats = rows[0].stats;
  const mounts = loadout.mounts ?? stats.mounts ?? [];
  const replaced = mounts.some((m) => m.weapon === fromId);
  loadout.mounts = mounts.map((m) => (m.weapon === fromId ? { ...m, weapon: toId } : m));
  await pool.query('UPDATE player_ships SET loadout = $1::jsonb WHERE player_id = $2 AND is_active',
    [JSON.stringify(loadout), playerId]);
  if (replaced) await depositStash(playerId, 'weapon', fromId); // the removed weapon is now owned (→ stash)
}

// Add one item to a player's stash (qty++), creating the row if absent. `client` runs it inside a
// transaction; otherwise it uses the pool. The single place items enter the stash.
async function depositStash(playerId, kind, refId, qty = 1, client = pool) {
  await client.query(`INSERT INTO stash (player_id, kind, ref_id, qty) VALUES ($1, $2, $3, $4)
    ON CONFLICT (player_id, kind, ref_id) DO UPDATE SET qty = stash.qty + EXCLUDED.qty`, [playerId, kind, refId, qty]);
}

// Install a component into a slot on the player's active ship (idempotent; sets components[slot]).
async function installActiveShipComponent(playerId, slot, componentId) {
  const { rows } = await pool.query(`SELECT ps.components AS ps_components, s.components AS ship_components
    FROM player_ships ps JOIN ships s ON s.id = ps.ship_id
    WHERE ps.player_id = $1 AND ps.is_active LIMIT 1`, [playerId]);
  if (!rows[0]) return;
  const components = rows[0].ps_components || rows[0].ship_components || {}; // JSONB → already parsed
  components[slot] = componentId;
  await pool.query('UPDATE player_ships SET components = $1::jsonb WHERE player_id = $2 AND is_active',
    [JSON.stringify(components), playerId]);
}

// Run a level briefing's actions (extend with new action types as the game grows).
async function applyBriefingActions(playerId, actions) {
  for (const a of (actions || [])) {
    if (a.type === 'replaceWeapon') await replaceActiveShipWeapon(playerId, a.from, a.to);
    if (a.type === 'installComponent') await installActiveShipComponent(playerId, a.slot, a.component);
    if (a.type === 'unlockShop') await unlockShop(playerId); // e.g. reaching level-4 opens the hangar shop + side missions
  }
}

// Derive the showcase item ({ kind, id }) from a briefing's grant actions, or an explicit
// briefing.showcase override. Cosmetic only — the client resolves the id in its catalog.
function showcaseFromBriefing(b) {
  if (b.showcase) return b.showcase;
  for (const a of (b.actions || [])) {
    if (a.type === 'replaceWeapon') return { kind: 'weapon', id: a.to };
    if (a.type === 'installComponent') return { kind: 'component', id: a.component };
  }
  return null;
}

// The briefing for a level (message + actions run server-side), or null. Returns { textKey, text, showcase }.
async function runLevelBriefing(playerId, levelId) {
  const { rows } = await pool.query('SELECT descriptor FROM levels WHERE id = $1', [levelId]);
  if (!rows[0]) return null;
  const briefing = rows[0].descriptor.briefing;
  if (!briefing) return null;
  await applyBriefingActions(playerId, briefing.actions);
  return { textKey: briefing.textKey ?? null, text: briefing.text ?? null, showcase: showcaseFromBriefing(briefing) };
}

export async function advanceProgress(playerId) {
  await registerPlayer(playerId);
  const cur = await pool.query('SELECT current_progress FROM players WHERE id = $1', [playerId]);
  const next = await pool.query('SELECT MIN(id) AS id FROM levels WHERE id > $1', [cur.rows[0].current_progress]);
  if (next.rows[0] && next.rows[0].id != null) {
    const id = Number(next.rows[0].id);
    await pool.query('UPDATE players SET current_progress = $1 WHERE id = $2', [id, playerId]);
    const briefing = await runLevelBriefing(playerId, id);
    return { currentProgress: id, advanced: true, briefing };
  }
  // No next level → the player just cleared the final level: unlock the hangar shop (once) + backfill
  // the basic gun (id 1) into the stash so it's owned.
  await unlockShop(playerId);
  return { currentProgress: cur.rows[0].current_progress, advanced: false, briefing: null };
}

// Flip shop_unlocked (idempotent) and seed the basic kinetic gun (weapon 1) into the stash the first
// time, if it isn't already there.
async function unlockShop(playerId) {
  const { rows } = await pool.query('SELECT shop_unlocked FROM players WHERE id = $1', [playerId]);
  if (rows[0] && rows[0].shop_unlocked) return false;
  await pool.query('UPDATE players SET shop_unlocked = 1 WHERE id = $1', [playerId]);
  await pool.query(`INSERT INTO stash (player_id, kind, ref_id, qty) VALUES ($1, 'weapon', 1, 1)
    ON CONFLICT (player_id, kind, ref_id) DO NOTHING`, [playerId]);
  return true;
}

export async function recordGame(playerId, { credits = 0, kills = 0, durationMs = 0 } = {}) {
  const now = Date.now();
  await registerPlayer(playerId); // make sure the player exists
  const earned = credits | 0;
  const ins = await pool.query(
    'INSERT INTO games (player_id, credits, kills, duration_ms, ended_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [playerId, earned, kills | 0, durationMs | 0, now]
  );
  // bank the earned credits into the player's balance and read back the new total
  const upd = await pool.query(
    'UPDATE players SET games_played = games_played + 1, credits = credits + $1, last_seen = $2 WHERE id = $3 RETURNING credits',
    [earned, now, playerId]
  );
  return { gameId: Number(ins.rows[0].id), credits: upd.rows[0].credits };
}

// Record one product-funnel event (best-effort; type allowlisted by the API). data is JSONB context.
export async function recordEvent(playerId, type, data) {
  await pool.query('INSERT INTO events (player_id, type, data, created_at) VALUES ($1, $2, $3::jsonb, $4)',
    [playerId, type, data != null ? JSON.stringify(data) : null, Date.now()]);
}

// Record one aggregated client perf sample (best-effort diagnostic; docs/plans/perf-low-end-phones.md).
export async function recordPerfSample(playerId, sessionId, sample) {
  await pool.query('INSERT INTO perf_samples (player_id, session_id, sample, created_at) VALUES ($1, $2, $3::jsonb, $4)',
    [playerId, sessionId, JSON.stringify(sample ?? null), Date.now()]);
}

// Read perf samples (newest first) — for analysis / tests; not exposed via a public route.
export async function getPerfSamples(sessionId = null, limit = 500) {
  const { rows } = sessionId
    ? await pool.query('SELECT * FROM perf_samples WHERE session_id = $1 ORDER BY id DESC LIMIT $2', [sessionId, limit])
    : await pool.query('SELECT * FROM perf_samples ORDER BY id DESC LIMIT $1', [limit]);
  return rows; // sample is already a JS object (JSONB)
}

export async function getPlayerGames(playerId, limit = 50) {
  const { rows } = await pool.query(
    'SELECT id, credits, kills, duration_ms, ended_at FROM games WHERE player_id = $1 ORDER BY id DESC LIMIT $2',
    [playerId, limit]
  );
  return rows.map((r) => ({
    id: Number(r.id), credits: r.credits, kills: r.kills,
    duration_ms: r.duration_ms, ended_at: Number(r.ended_at),
  }));
}

export async function stats() {
  const p = await pool.query('SELECT COUNT(*)::int AS n FROM players');
  const g = await pool.query('SELECT COUNT(*)::int AS n FROM games');
  return { players: p.rows[0].n, games: g.rows[0].n };
}

// All players joined to their aggregated game history (admin panel). Postgres returns
// BIGINT/SUM as strings and email_verified as an INTEGER → coerce every numeric with Number(...) and
// email_verified with !!Number(...).
export async function getAdminPlayers(limit = 1000) {
  const { rows } = await pool.query(`
    SELECT p.id, p.username, p.email, p.email_verified, p.created_at, p.last_seen,
           p.current_progress, p.credits, p.games_played, p.referrer, p.user_agent, p.device_model,
           COALESCE(SUM(g.duration_ms), 0) AS total_time_ms,
           COALESCE(SUM(g.kills), 0)       AS total_kills,
           COALESCE(SUM(g.credits), 0)     AS total_earned
    FROM players p LEFT JOIN games g ON g.player_id = p.id
    GROUP BY p.id
    ORDER BY p.last_seen DESC
    LIMIT $1`, [limit]);
  return rows.map((r) => ({
    id: r.id, username: r.username ?? null, email: r.email ?? null,
    emailVerified: !!Number(r.email_verified), createdAt: Number(r.created_at), lastSeen: Number(r.last_seen),
    currentProgress: Number(r.current_progress), credits: Number(r.credits), gamesPlayed: Number(r.games_played),
    referrer: r.referrer ?? null,
    userAgent: r.user_agent ?? null, deviceModel: r.device_model ?? null,
    totalTimeMs: Number(r.total_time_ms), totalKills: Number(r.total_kills), totalEarned: Number(r.total_earned),
  }));
}

// Catalog: ships, weapons, components. JSONB columns come back already parsed.
export async function getShips() {
  const { rows } = await pool.query('SELECT id, name, type, stats, model_url, model_url_high, components FROM ships ORDER BY id');
  return rows.map((r) => ({ id: Number(r.id), name: r.name, type: r.type, stats: r.stats, modelUrl: r.model_url, modelUrlHigh: r.model_url_high, components: r.components }));
}

export async function getWeapons() {
  const { rows } = await pool.query('SELECT id, name, type, price, stats, model_url, model_url_high, rarity, color FROM weapons ORDER BY id');
  return rows.map((r) => ({ id: Number(r.id), name: r.name, type: r.type, price: r.price, stats: r.stats, modelUrl: r.model_url, modelUrlHigh: r.model_url_high, rarity: r.rarity, color: r.color }));
}

export async function getComponents() {
  const { rows } = await pool.query('SELECT id, name, type, weight, price, stats, model_url, model_url_high, rarity, color FROM components ORDER BY id');
  return rows.map((r) => ({ id: Number(r.id), name: r.name, type: r.type, weight: r.weight, price: r.price, stats: r.stats, modelUrl: r.model_url, modelUrlHigh: r.model_url_high, rarity: r.rarity, color: r.color }));
}

// SFX catalog: sounds registry (key->url) + class-based routing map.
export async function getSoundCatalog() {
  const s = await pool.query('SELECT key, url, gain FROM sounds ORDER BY key');
  const m = await pool.query('SELECT entity, class, event, sound_key FROM sound_map ORDER BY entity, class, event');
  return { sounds: s.rows, map: m.rows.map((r) => ({ entity: r.entity, class: r.class, event: r.event, sound: r.sound_key })) };
}

export async function getMap(name) {
  const { rows } = await pool.query('SELECT name, descriptor FROM maps WHERE name = $1', [name]);
  return rows[0] ? { name: rows[0].name, descriptor: rows[0].descriptor } : null;
}

export async function getLevel(name) {
  const { rows } = await pool.query('SELECT name, descriptor FROM levels WHERE name = $1', [name]);
  return rows[0] ? { name: rows[0].name, descriptor: rows[0].descriptor } : null;
}

// ---------- Hangar shop + stash (docs/plans/hangar-shop.md) ----------
// Server-authoritative + transactional (a checked-out client wraps each multi-step mutation).
const REQUIRED_SLOTS = new Set(['hull', 'engine', 'thruster']);
const COMPONENT_SLOTS = new Set(['hull', 'engine', 'thruster', 'repair', 'grab', 'shield']);
const WEAPON_GROUP = { bullet: 'gun', rocket: 'rocket' };
const sellPrice = (price) => Math.floor((price | 0) * 0.75);

async function catalogItem(kind, refId, client = pool) {
  if (kind === 'component') {
    const { rows } = await client.query('SELECT id, name, type, weight, price, stats FROM components WHERE id = $1', [refId]);
    const r = rows[0];
    return r ? { kind, refId: Number(r.id), name: r.name, type: r.type, weight: r.weight, price: r.price, stats: r.stats } : null;
  }
  if (kind === 'weapon') {
    const { rows } = await client.query('SELECT id, name, type, price, stats FROM weapons WHERE id = $1', [refId]);
    const r = rows[0];
    return r ? { kind, refId: Number(r.id), name: r.name, type: r.type, price: r.price, stats: r.stats } : null;
  }
  return null;
}

async function decStash(playerId, kind, refId, client) {
  await client.query('UPDATE stash SET qty = qty - 1 WHERE player_id = $1 AND kind = $2 AND ref_id = $3', [playerId, kind, refId]);
  await client.query('DELETE FROM stash WHERE player_id = $1 AND kind = $2 AND ref_id = $3 AND qty <= 0', [playerId, kind, refId]);
}
async function stashQty(playerId, kind, refId, client) {
  const { rows } = await client.query('SELECT qty FROM stash WHERE player_id = $1 AND kind = $2 AND ref_id = $3', [playerId, kind, refId]);
  return rows[0]?.qty ?? 0;
}
const credit = (playerId, amount, client) =>
  client.query('UPDATE players SET credits = credits + $1 WHERE id = $2', [amount | 0, playerId]);

// The active ship's effective loadout (mounts) + components, materialized for mutation.
async function activeLoadoutComponents(playerId, client) {
  const { rows } = await client.query(`SELECT ps.loadout, ps.components AS ps_components, s.stats, s.components AS ship_components
    FROM player_ships ps JOIN ships s ON s.id = ps.ship_id WHERE ps.player_id = $1 AND ps.is_active LIMIT 1`, [playerId]);
  const row = rows[0];
  if (!row) return null;
  const loadout = row.loadout || {};
  return {
    mounts: loadout.mounts ?? row.stats.mounts ?? [],
    components: row.ps_components ?? row.ship_components ?? {},
  };
}
const saveActiveLoadout = (playerId, mounts, client) =>
  client.query('UPDATE player_ships SET loadout = $1::jsonb WHERE player_id = $2 AND is_active', [JSON.stringify({ mounts }), playerId]);
const saveActiveComponents = (playerId, components, client) =>
  client.query('UPDATE player_ships SET components = $1::jsonb WHERE player_id = $2 AND is_active', [JSON.stringify(components), playerId]);

// Run `fn(client)` inside a transaction (BEGIN/COMMIT, ROLLBACK on throw).
async function withTx(fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const r = await fn(client); await client.query('COMMIT'); return r; }
  catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

export async function getStash(playerId) {
  await registerPlayer(playerId);
  const { rows } = await pool.query('SELECT kind, ref_id, qty FROM stash WHERE player_id = $1 AND qty > 0 ORDER BY kind, ref_id', [playerId]);
  const out = [];
  for (const r of rows) { const it = await catalogItem(r.kind, Number(r.ref_id)); if (it) out.push({ ...it, qty: r.qty }); }
  return out;
}

export async function buyItem(playerId, kind, refId) {
  await registerPlayer(playerId);
  const item = await catalogItem(kind, refId);
  if (!item) return { ok: false, status: 400, error: 'no such item' };
  const price = item.price | 0;
  return withTx(async (client) => {
    const { rows } = await client.query('SELECT credits FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    if (price > rows[0].credits) return { ok: false, status: 402, error: 'insufficient credits' };
    await credit(playerId, -price, client);
    await depositStash(playerId, kind, refId, 1, client);
    return { ok: true };
  });
}

export async function sellItem(playerId, { kind, refId, slot } = {}) {
  await registerPlayer(playerId);
  if (slot) return sellEquipped(playerId, slot);
  const item = await catalogItem(kind, refId);
  if (!item) return { ok: false, status: 400, error: 'no such item' };
  return withTx(async (client) => {
    if (await stashQty(playerId, kind, refId, client) <= 0) return { ok: false, status: 409, error: 'not in stash' };
    await decStash(playerId, kind, refId, client);
    await credit(playerId, sellPrice(item.price), client);
    return { ok: true };
  });
}

async function sellEquipped(playerId, slot) {
  if (REQUIRED_SLOTS.has(slot)) return { ok: false, status: 409, error: 'required slot can\'t be sold while equipped' };
  return withTx(async (client) => {
    const cfg = await activeLoadoutComponents(playerId, client);
    if (!cfg) return { ok: false, status: 404, error: 'no active ship' };
    if (COMPONENT_SLOTS.has(slot)) {
      const refId = cfg.components[slot];
      if (refId == null) return { ok: false, status: 409, error: 'slot is empty' };
      const item = await catalogItem('component', refId, client);
      delete cfg.components[slot];
      await saveActiveComponents(playerId, cfg.components, client);
      await credit(playerId, sellPrice(item ? item.price : 0), client);
      return { ok: true };
    }
    const idx = cfg.mounts.findIndex((m) => m.group === slot);
    if (idx < 0) return { ok: false, status: 409, error: 'slot is empty' };
    const item = await catalogItem('weapon', cfg.mounts[idx].weapon, client);
    cfg.mounts.splice(idx, 1);
    await saveActiveLoadout(playerId, cfg.mounts, client);
    await credit(playerId, sellPrice(item ? item.price : 0), client);
    return { ok: true };
  });
}

export async function equipItem(playerId, kind, refId) {
  await registerPlayer(playerId);
  const item = await catalogItem(kind, refId);
  if (!item) return { ok: false, status: 400, error: 'no such item' };
  return withTx(async (client) => {
    if (await stashQty(playerId, kind, refId, client) <= 0) return { ok: false, status: 409, error: 'not in stash' };
    const cfg = await activeLoadoutComponents(playerId, client);
    if (!cfg) return { ok: false, status: 404, error: 'no active ship' };
    if (kind === 'component') {
      const slot = item.type;
      const prev = cfg.components[slot];
      cfg.components[slot] = refId;
      await saveActiveComponents(playerId, cfg.components, client);
      await decStash(playerId, kind, refId, client);
      if (prev != null) await depositStash(playerId, 'component', prev, 1, client); // displaced item → stash
      return { ok: true };
    }
    const group = WEAPON_GROUP[item.type] || 'gun';
    const idx = cfg.mounts.findIndex((m) => m.group === group);
    let prev = null;
    if (idx >= 0) { prev = cfg.mounts[idx].weapon; cfg.mounts[idx] = { ...cfg.mounts[idx], weapon: refId }; }
    else cfg.mounts.push({ weapon: refId, group, offset: 0, delay: 0 });
    await saveActiveLoadout(playerId, cfg.mounts, client);
    await decStash(playerId, kind, refId, client);
    if (prev != null) await depositStash(playerId, 'weapon', prev, 1, client); // displaced weapon → stash
    return { ok: true };
  });
}

export async function unequipItem(playerId, slot) {
  await registerPlayer(playerId);
  return withTx(async (client) => {
    const cfg = await activeLoadoutComponents(playerId, client);
    if (!cfg) return { ok: false, status: 404, error: 'no active ship' };
    if (COMPONENT_SLOTS.has(slot)) {
      const refId = cfg.components[slot];
      if (refId == null) return { ok: false, status: 409, error: 'slot is empty' };
      delete cfg.components[slot];
      await saveActiveComponents(playerId, cfg.components, client);
      await depositStash(playerId, 'component', refId, 1, client);
      return { ok: true };
    }
    const idx = cfg.mounts.findIndex((m) => m.group === slot);
    if (idx < 0) return { ok: false, status: 409, error: 'slot is empty' };
    const refId = cfg.mounts[idx].weapon;
    cfg.mounts.splice(idx, 1);
    await saveActiveLoadout(playerId, cfg.mounts, client);
    await depositStash(playerId, 'weapon', refId, 1, client);
    return { ok: true };
  });
}

// Deposit a mission's collected loot into the stash (one row per item). Client-authoritative, called on
// mission VICTORY only (see DECISIONS). Skips malformed entries; an empty list is a no-op { ok: true }.
// Uses the transaction API (withTx + a `client` passed to depositStash).
export async function depositLoot(playerId, items) {
  await registerPlayer(playerId);
  await withTx(async (client) => {
    for (const it of (items || [])) {
      if (it && (it.kind === 'component' || it.kind === 'weapon') && it.refId != null) {
        await depositStash(playerId, it.kind, it.refId, 1, client); // pass `client` → runs inside the tx
      }
    }
  });
  return { ok: true };
}

// ---------- Authentication (DECISIONS §11) ----------
// Public player view: never includes password fields. BIGINT columns come back as strings → Number().
function playerSummary(r) {
  if (!r) return null;
  return {
    id: r.id, username: r.username ?? null, email: r.email ?? null,
    emailVerified: !!r.email_verified, currentProgress: r.current_progress,
    credits: r.credits, gamesPlayed: r.games_played, language: r.language,
    createdAt: Number(r.created_at),
    emailVerifySentAt: r.email_verify_sent_at != null ? Number(r.email_verify_sent_at) : null,
  };
}
const PLAYER_COLS = 'id, username, email, email_verified, current_progress, credits, games_played, language, created_at, email_verify_sent_at';

export async function getPlayerPublic(id) {
  const { rows } = await pool.query(`SELECT ${PLAYER_COLS} FROM players WHERE id = $1`, [id]);
  return playerSummary(rows[0]);
}

export async function setUsername(playerId, username) {
  await registerPlayer(playerId);
  await pool.query('UPDATE players SET username = $1, last_seen = $2 WHERE id = $3', [username, Date.now(), playerId]);
  return getPlayerPublic(playerId);
}

export async function findPlayerForLogin(email) {
  const { rows } = await pool.query('SELECT id, password_hash, password_salt FROM players WHERE email = $1', [email]);
  return rows[0] || null;
}

export async function emailInUse(email, exceptPlayerId) {
  const { rows } = await pool.query('SELECT id FROM players WHERE email = $1', [email]);
  return !!(rows[0] && rows[0].id !== exceptPlayerId);
}

export async function registerAccount(playerId, { username, email, passwordHash, passwordSalt, verifyTokenHash, verifySentAt }) {
  await registerPlayer(playerId);
  if (await emailInUse(email, playerId)) { const e = new Error('email already in use'); e.code = 'EMAIL_TAKEN'; throw e; }
  await pool.query(`UPDATE players SET username = $1, email = $2, password_hash = $3, password_salt = $4,
      email_verified = 0, email_verify_token_hash = $5, email_verify_sent_at = $6, last_seen = $7 WHERE id = $8`,
    [username ?? null, email, passwordHash, passwordSalt, verifyTokenHash, verifySentAt, Date.now(), playerId]);
  return getPlayerPublic(playerId);
}

export async function setVerifyToken(playerId, verifyTokenHash, verifySentAt) {
  await pool.query('UPDATE players SET email_verify_token_hash = $1, email_verify_sent_at = $2 WHERE id = $3',
    [verifyTokenHash, verifySentAt, playerId]);
}

export async function verifyEmailToken(tokenHash) {
  const minSentAt = Date.now() - VERIFY_TTL_MS;
  const { rows } = await pool.query(
    'SELECT id FROM players WHERE email_verify_token_hash = $1 AND email_verify_sent_at >= $2', [tokenHash, minSentAt]);
  if (!rows[0]) return null;
  await pool.query('UPDATE players SET email_verified = 1, email_verify_token_hash = NULL WHERE id = $1', [rows[0].id]);
  return rows[0].id;
}

// Begin a password reset for `email`. Enumeration-safe caller.
export async function setResetToken(email, tokenHash, sentAt) {
  const { rows } = await pool.query(
    'SELECT id, email, password_hash, password_reset_sent_at FROM players WHERE email = $1', [email]);
  const r = rows[0];
  if (!r || !r.password_hash) return null;
  const prevSent = r.password_reset_sent_at != null ? Number(r.password_reset_sent_at) : 0;
  if (prevSent && sentAt - prevSent < RESEND_THROTTLE_MS) return null;
  await pool.query('UPDATE players SET password_reset_token_hash = $1, password_reset_sent_at = $2 WHERE id = $3',
    [tokenHash, sentAt, r.id]);
  return { id: r.id, email: r.email };
}

// Consume a reset token: rotate password, verify email, clear tokens.
export async function consumeResetToken(tokenHash, passwordHash, passwordSalt) {
  const minSentAt = Date.now() - RESET_TTL_MS;
  const { rows } = await pool.query(
    'SELECT id FROM players WHERE password_reset_token_hash = $1 AND password_reset_sent_at >= $2',
    [tokenHash, minSentAt]);
  if (!rows[0]) return null;
  await pool.query(`UPDATE players SET password_hash = $1, password_salt = $2, email_verified = 1,
      email_verify_token_hash = NULL, password_reset_token_hash = NULL, password_reset_sent_at = NULL
      WHERE id = $3`, [passwordHash, passwordSalt, rows[0].id]);
  return rows[0].id;
}

// Invalidate all of a player's sessions (used on password reset). No-op if the player has none.
export async function deleteSessionsForPlayer(playerId) {
  await pool.query('DELETE FROM sessions WHERE player_id = $1', [playerId]);
}

export async function createSession(playerId, tokenHash, userAgent) {
  const now = Date.now();
  await pool.query(
    'INSERT INTO sessions (token_hash, player_id, created_at, expires_at, user_agent) VALUES ($1, $2, $3, $4, $5)',
    [tokenHash, playerId, now, now + SESSION_TTL_MS, userAgent ?? null]);
}

export async function getSessionPlayer(tokenHash) {
  const cols = PLAYER_COLS.split(', ').map((c) => 'p.' + c).join(', ');
  const { rows } = await pool.query(`SELECT ${cols} FROM sessions s JOIN players p ON p.id = s.player_id
    WHERE s.token_hash = $1 AND s.expires_at > $2`, [tokenHash, Date.now()]);
  return playerSummary(rows[0]);
}

export async function deleteSession(tokenHash) {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

// The player's active ship: ship template + effective loadout (loadout falls back to ship defaults).
export async function getActivePlayerShip(playerId) {
  const reg = await registerPlayer(playerId);
  const { rows } = await pool.query(`
    SELECT ps.id AS player_ship_id, ps.loadout, ps.components AS ps_components,
           s.id AS ship_id, s.name, s.type, s.stats, s.model_url, s.model_url_high, s.components AS ship_components
    FROM player_ships ps JOIN ships s ON s.id = ps.ship_id
    WHERE ps.player_id = $1 AND ps.is_active LIMIT 1`, [playerId]);
  const row = rows[0];
  if (!row) return null;
  const stats = row.stats, loadout = row.loadout || {};
  const components = row.ps_components ?? row.ship_components ?? {};
  const missingRequired = [...REQUIRED_SLOTS].filter((s) => components[s] == null);
  return {
    playerShipId: Number(row.player_ship_id),
    ship: { id: Number(row.ship_id), name: row.name, type: row.type, stats, modelUrl: row.model_url, modelUrlHigh: row.model_url_high, components: row.ship_components },
    loadout: { mounts: loadout.mounts ?? stats.mounts ?? [] },
    components,
    language: reg.language, // the player's stored language preference (client adopts it if unset locally)
    credits: reg.credits,   // the player's persistent credit balance
    shopUnlocked: reg.shopUnlocked, // hangar shop gate (cleared the final level)
    launchable: missingRequired.length === 0,
    missingRequired,
  };
}
