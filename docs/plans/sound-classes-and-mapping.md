# Sound classes + a DB sound-mapping table (data-driven SFX routing)

**Status:** ✅ implemented (2026-06-24). Architecture: **classes + a sounds table** (normalized) — adding
ships/weapons never touches the client. Shipped: sqlite migration `013_sounds.js` + postgres tables,
`SOUNDS`/`SOUND_MAP` seed + `stats.class` on ships/weapons, `GET /api/sounds`, client `sfxFor()` resolver,
`sfx_manifest.js` deleted. Current state lives in `docs/SUMMARY.md` (Audio); this file is the design brief.

## Goal

Remove **all hardcoded sound routing from the client** so that "with 100 different ships" nothing in
`index.html` knows which ship/weapon makes which sound. Instead:
- Each **ship** and **weapon** has a **`class`** (e.g. ship `fighter`/`capital`, weapon `kinetic`/`rocket`).
- A **`sounds`** table is the asset registry: `key → url (+ gain)`.
- A **`sound_map`** table maps **(entity, class, event) → sound key** (e.g. `(ship, capital, explode) →
  shipBoom`, `(weapon, rocket, fire) → rocket`).
- The client resolves at runtime: *ship of class X fires event `explode` → look up the key → play that
  sample* (falling back to the procedural synth when no mapping/sample exists).

This generalizes what weapons already do (`stats.sfx`) and what ship explosions do NOT (currently the
client hardcodes `size>=2 ? 'shipBoom' : 'blast'`).

## Prerequisite (do FIRST, separately)

The current sampled-SFX work (kinetic re-volume, rocket, cannon, shipHit, shipBoom, blast routing) is
**uncommitted** and blocked on **licenses in `client/assets/CREDITS.md`** (rocket/cannon/shipHit/
shipBoom/blast are `_TBD_`/`_CONFIRM_`). **Commit that as a clean base before this refactor** — otherwise
the schema change lands on top of a tangle. This plan assumes those 6 sounds exist on S3 and are the
baseline to migrate into the new tables.

## Background — how it works now (anchors)

- **Weapons are already data-driven:** `weapon.stats.sfx` (e.g. `kinetic`/`cannon`/`rocket`) in
  `server/src/catalog_seed.js` → flows to the runtime weapon as `w.sfx` (`client/index.html:1487` builds
  `{ id, name, type, ...stats }`) → read at the fire site `fireMount` (`audio.sfx.shoot(w.sfx)` /
  `audio.sfx.rocket(isPlayer ? w.sfx : undefined)`).
- **Ship explosion/hit is hardcoded in the client:**
  - `client/index.html:1508` rocket detonation → `audio.sfx.explosion(0.7, 'blast')`.
  - `client/index.html:2316` enemy death → `audio.sfx.explosion(size, size>=2 ? 'shipBoom' : 'blast')`.
  - `client/index.html:2331` player death → `audio.sfx.explosion(1.5, 'shipBoom')`.
  - `client/index.html:~2178` player hit → `audio.sfx.hit('shipHit')`.
- **Key → URL lives in the client manifest** `client/src/sfx_manifest.js` (`SFX_SOURCES`), loaded once via
  `audio.preloadSamples(SFX_SOURCES)`. The engine plays a sample **by key** (`playSample(key)`); the
  engine itself needs **no change** here.
- **DB layers (mirror each other):** sqlite `server/src/db.js` (schema via numbered migrations in
  `server/src/migrations/`, runner `migrate.js` keyed on `PRAGMA user_version`; seed in `seedCatalog()`
  at `db.js:27`; catalog reads `getShips`/`getWeapons` at `db.js:247/253`) and postgres
  `server/src/db_postgres.js` (schema = `CREATE TABLE IF NOT EXISTS …` inside `migrate()`; seed + reads
  `getShips`/`getWeapons` at `db_postgres.js:364/369`).
- **API:** `server/src/server.js:95-97` exposes `/api/ships`, `/api/weapons`, `/api/components`.
- **Client bootstrap** fetches the catalog at `client/index.html:~3497`
  (`fetchJson('/api/weapons')` etc.) and builds `CATALOG.weapons` at `:3501`.

## Data model

### `sounds` (asset registry — replaces the manifest)
| col | type | notes |
|-----|------|-------|
| `key` | TEXT PK | logical name: `kinetic`, `rocket`, `cannon`, `shipHit`, `shipBoom`, `blast` |
| `url` | TEXT NOT NULL | same-origin content-hashed path, e.g. `assets/sounds/blast.fcd21671.mp3` |
| `gain` | REAL DEFAULT 1 | optional per-sample playback gain (volume is baked into files today, so 1; kept for future) |

### `sound_map` (routing)
| col | type | notes |
|-----|------|-------|
| `entity` | TEXT | `ship` \| `weapon` |
| `class` | TEXT | the entity's class (see below) |
| `event` | TEXT | ship: `explode` \| `hit`; weapon: `fire` \| `explode` (rocket detonation) |
| `sound_key` | TEXT | FK → `sounds.key` |
| PK | (`entity`,`class`,`event`) | one sound per event per class |

### Class fields (added to existing `stats` JSON — no new columns on ships/weapons)
- **Ship** `stats.class`: assign per ship in the seed. Initial mapping reproducing today's behavior:
  - small ships (current `sizeScale < 2`: fighter, rocketeer, pirate gunner) → class **`fighter`**
  - medium/large (`sizeScale >= 2`: medium, bosses) → class **`capital`**
  - the player ship → class **`player`**
- **Weapon** `stats.class`: `kinetic` (ids 1/5/7), `cannon` (id 6), `rocket` (ids 3/8). Enemy weapons
  (2/4/9/10) may stay unclassed (→ synth, preserving today's player-only sampling) or get classes later.

> Note: `class` could be a separate `ship_classes`/`weapon_classes` table, but a string in `stats` is
> enough — the `sound_map` keys off the string. Promote to a table only if classes grow their own
> attributes. (YAGNI for now.)

## Seed (`server/src/catalog_seed.js`)

Add two exports + `class` on entities:
```js
export const SOUNDS = [
  { key: 'kinetic',  url: 'assets/sounds/kinetic.6d8dda6a.mp3' },
  { key: 'rocket',   url: 'assets/sounds/rocket.0e10b34a.mp3' },
  { key: 'cannon',   url: 'assets/sounds/cannon.689d2b52.mp3' },
  { key: 'shipHit',  url: 'assets/sounds/shipHit.8b58950e.mp3' },
  { key: 'shipBoom', url: 'assets/sounds/shipBoom.dcd028da.mp3' },
  { key: 'blast',    url: 'assets/sounds/blast.fcd21671.mp3' },
];
export const SOUND_MAP = [
  { entity: 'weapon', class: 'kinetic', event: 'fire',    sound: 'kinetic' },
  { entity: 'weapon', class: 'cannon',  event: 'fire',    sound: 'cannon' },
  { entity: 'weapon', class: 'rocket',  event: 'fire',    sound: 'rocket' },
  { entity: 'weapon', class: 'rocket',  event: 'explode', sound: 'blast' },   // rocket detonation
  { entity: 'ship',   class: 'fighter', event: 'explode', sound: 'blast' },
  { entity: 'ship',   class: 'capital', event: 'explode', sound: 'shipBoom' },
  { entity: 'ship',   class: 'player',  event: 'explode', sound: 'shipBoom' },
  { entity: 'ship',   class: 'player',  event: 'hit',     sound: 'shipHit' },
];
```
- Replace each weapon's `stats.sfx: '<key>'` with `stats.class: '<class>'`.
- Add `stats.class` to every ship in `SHIPS`.

## Schema migrations

- **sqlite:** new `server/src/migrations/013_sounds.js` exporting `up(db)` that creates `sounds` and
  `sound_map` (mirror the column tables above; `CREATE TABLE IF NOT EXISTS`). The runner bumps
  `user_version` to 13 automatically.
- **postgres:** add the two `CREATE TABLE IF NOT EXISTS sounds (...)` / `sound_map (...)` blocks inside
  `db_postgres.js migrate()` (alongside the existing weapons/ships tables, ~line 58).

## Seeding both backends

- **sqlite** `db.js seedCatalog()` (line 27): upsert `SOUNDS` (`ON CONFLICT(key) DO UPDATE SET url, gain`)
  and `sound_map` (`ON CONFLICT(entity,class,event) DO UPDATE SET sound_key`). Both run every startup, so
  editing the seed updates rows.
- **postgres** `db_postgres.js`: mirror with `$n::` params + `ON CONFLICT`.

## Read API

- Add `getSounds()` + `getSoundMap()` (or one `getSoundCatalog()` returning `{ sounds, map }`) to **both**
  `db.js` and `db_postgres.js` (mirror `getWeapons`).
- Add route **`server/src/server.js`**: `app.get('/api/sounds', wrap(async (req,res) => res.json(await
  getSoundCatalog())))` near the other catalog routes (`:95-97`). Import the new fn in the `db` import
  list (`server.js:8`).

## Client (`client/index.html` + `client/src/sfx_manifest.js`)

1. **Bootstrap** (`:3497`): also `fetchJson('/api/sounds')`. Build:
   - `SOUND_URLS = Object.fromEntries(sounds.map(s => [s.key, s.url]))`
   - `SOUND_MAP` lookup keyed by `entity|class|event → sound_key`.
   - a resolver `sfxFor(entity, cls, event)` → `sound_key | undefined`.
2. **Preload** from the DB registry: `audio.preloadSamples(SOUND_URLS)` (replaces the
   `SFX_SOURCES` import). **Delete `client/src/sfx_manifest.js`** (its job moves to the `sounds` table).
3. **Replace the hardcoded call sites** with resolver lookups:
   - fire (gun): `audio.sfx.shoot(isPlayer ? sfxFor('weapon', w.class, 'fire') : undefined)`.
   - fire (rocket): `audio.sfx.rocket(isPlayer ? sfxFor('weapon', w.class, 'fire') : undefined)`.
   - rocket detonation (`:1508`): resolve `(weapon, <rocket class>, 'explode')`. **Thread the weapon's
     class onto the rocket object in `spawnRocket`** (store `obj.sfxExplode = sfxFor('weapon', w.class,
     'explode')` at spawn) so detonation can read it without re-looking-up the weapon.
   - enemy death (`:2316`): `audio.sfx.explosion(size, sfxFor('ship', e.class, 'explode'))`.
   - player death (`:2331`): `audio.sfx.explosion(1.5, sfxFor('ship', player.class, 'explode'))`.
   - player hit (`:~2178`): `audio.sfx.hit(sfxFor('ship', player.class, 'hit'))`.
   - `e.class` / `player.class` flow from `ship.stats.class` (already spread onto the runtime ship like
     `role`/`sizeScale`; confirm in `makeShip`/`makeEnemy` and surface `class` if not).
4. **Engine unchanged:** `audio.sfx.shoot/rocket/explosion/hit` already take a sound key and fall back to
   synth when it's `undefined`/unloaded. The size-based pitch in `explosion` stays.

## Tooling + tests

- **`scripts/assets-check.mjs`**: source the sound URLs from `catalog_seed.js` **`SOUNDS`** instead of the
  (deleted) `SFX_SOURCES`; still verify each is on S3 (`PREFIX.sounds`). Update the import.
- **`client/visual/scenarios/12-audio.mjs`**: iterate `SOUNDS` (import from `catalog_seed.js`) instead of
  `SFX_SOURCES`; keep the decode assertion (`dur < 5`).
- **Server tests** (`server/*.test.js`): add a check that `/api/sounds` returns the seeded sounds + map
  and that every `sound_map.sound_key` exists in `sounds` (referential sanity) — mirror the existing
  "catalog seeded" test.
- Run `npm run assets:check`, `cd client && node --test`, `cd server && npm test`, `npm run test:visual`.

## Migration / rollout notes

- **URL now lives in the DB** (the `sounds` table), not the manifest — this supersedes the earlier
  "keep URLs in the manifest" choice. Trade-off: changing a sound's URL now needs a re-seed (server
  restart locally / a deploy in prod), whereas the manifest updated on reload. Acceptable because
  **volume is baked into the files** (so URLs change only when a file is actually swapped — rare).
  Local testing of a swap therefore requires a server restart (re-seed), like any catalog change.
- Deploy guard unaffected (still S3 existence). Prod deploy re-seeds on startup (`migrate()` →
  `seedCatalog`), so the new tables + map go live with the deploy.

## Docs to update on implementation

- **SUMMARY.md** "Audio" + "Asset pipeline": describe the `sounds`/`sound_map` tables, `class` on
  ships/weapons, `/api/sounds`, and that routing is fully DB-driven (no client hardcoding); note the
  manifest is gone.
- **CHANGELOG.md**: the schema + routing refactor.
- **DECISIONS.md §22 amendment**: SFX routing normalized into DB tables (classes + sound_map); URL moved
  from the manifest to the `sounds` table; rationale (scales to many ships without client edits).
- **CREDITS.md**: unchanged content, but the per-file rows now correspond to `sounds` rows.

## Open questions — resolved inline

- **Per-entity field vs normalized tables?** → normalized (`sounds` + `sound_map` + `class`), owner's call.
- **`class` as a column/table vs string in `stats`?** → string in `stats` (key off it); promote later if
  classes gain attributes.
- **URL in DB vs manifest?** → DB `sounds` table (supersedes the earlier manifest choice); volume baked in
  files keeps URL changes rare, so the re-seed cost is fine.
- **Enemy weapon fire sounds?** → keep player-only for now (`isPlayer` gate); enemy classes can map later.
