# i18n implementation brief — Space Ninjas

> Self-contained handoff for a fresh session. Implements multi-language support for players.
> The architecture is already decided — see **DECISIONS.md §10**. This file is the build plan.
> Written in English per the project's English-only rule.

## Goal

Add player-facing localization. **English is the canonical source of truth; Russian is the first
locale.** English keys, code, docs, and the default/base UI text stay English; a locale is a derived
layer keyed off the English originals.

Locked decisions (do not re-litigate):
- Languages: **EN + RU** (EN canonical, RU first translation).
- Scope: **UI strings AND DB content** (ship/weapon/component names, level victory text).
- Language selection: explicit choice → `navigator.language` → `en` fallback; **only `en`/`ru`**.
- Persistence: `players.language` column + endpoint, mirrored to `localStorage`.
- Architecture: **one file-based message catalog** as source of truth; **DB stores stable keys, not
  display text**; **resolution is client-side**; **simple `{var}` interpolation only**.
- **Plurals/composite phrases are deferred on purpose** (see DECISIONS §10). Do NOT author phrases that
  need grammatical number; there are none today, and we don't build plural support yet. Keep new
  strings simple (static label + separate number, `N×` notation, value-after-colon). When plurals are
  eventually needed, the chosen mechanism is the built-in `Intl.PluralRules` + a tiny ICU-subset
  formatter — **no `@formatjs`, no runtime dependency**.

## ⚠️ Sequencing — do this AFTER maps/levels merges to `main`

This feature touches `client/index.html`, `server/src/catalog_seed.js`, and adds a migration — the
exact files the maps/levels feature is changing, and both add the next-numbered migration. Land
maps/levels on `main` first, then branch i18n off the updated `main`. Work in its own git worktree.

## Codebase facts you need (verify before relying on them — they were true at planning time)

- **Client is a single file:** `client/index.html` (Three.js via CDN importmap). Pure logic lives in
  `client/src/*.js` (ES modules; the client is served over http, not `file://`).
- **~35–40 user-facing UI strings**, all hardcoded, no central module. Two mechanisms only:
  - **Static HTML text nodes** (~lines 139–177): `Health`, `Score`, `Destroyed`, `Enemies`, the help
    block (key bindings: `W/↑ thrust`, `S/↓ reverse`, `A/D turn`, `Space fire`, `F rocket`),
    `Game over`, `Restart`, `Welcome, Ninja`, the welcome intro paragraph, `Pick your ship`,
    `Take off 🚀`, the `Space Ninjas` wordmark, the perf-overlay template, `FIRE`.
  - **JS-set strings** via `textContent`/`innerHTML`: `Victory!` / `Sector cleared.` (~838–839),
    HUD numerics + `%` suffix (~1081–1086), `Ship destroyed` / `Destroyed: ${kills} — Score: ${score}`
    (~1351–1352), perf string `FPS … · …ms · draw … · tris …` (~1383), ship-card labels
    `${count}× gun` / `${count}× rocket` / `unarmed` / `Hull: ${hp} HP` / `Weapons: ${summary}` (~1519–1533).
  - Line numbers are approximate and WILL drift after maps/levels — search for the literals.
- **DB content strings** (authored in `server/src/catalog_seed.js`, seeded into tables):
  - `ships.name`, `weapons.name`, `components.name` (TEXT UNIQUE).
  - Level victory text: `levels.descriptor.phases[].text` (JSON). Client reads it at ~830/839.
- **Seeding:** `catalog_seed.js` is upserted **idempotently on every startup** (editing it propagates
  on deploy; ids/FKs preserved). Re-seed is the mechanism to push new key columns/values.
- **`players` table:** `id` (browser UUID), `created_at`, `last_seen`, `games_played`,
  `current_progress` (FK→levels, migration 006). **No language/prefs column yet.** Player id is a
  `crypto.randomUUID()` in `localStorage.playerId`, auto-registered on load.
- **Migrations:** SQLite via `server/src/migrations/NNN_name.js` (`up(db)`, `PRAGMA user_version`),
  run on startup + `npm run migrate`. Postgres uses idempotent `CREATE TABLE IF NOT EXISTS` bootstrap
  in `db_postgres.js`. **Latest migration is 006 — the next is 007** (re-check; maps/levels may have
  added more). Storage is pluggable via `datastore.js` (`db.js` = SQLite honoring `DB_PATH`,
  `db_postgres.js` = Postgres). The local SQLite DB is `server/data/game.db`.
- **DECISIONS §9 caveat:** SQLite cannot `ALTER TABLE ADD COLUMN` with both a `REFERENCES` clause and a
  non-NULL default. `players.language` has no FK, so a plain `TEXT NOT NULL DEFAULT 'en'` is fine in
  both backends.

## Architecture

```
client/locales/source.json      canonical catalog: { key: { source, context } }  (English + translator notes)
client/locales/ru.json          translations:      { key: value }                 (Russian)
client/src/i18n.js              t(key, params), bundle loading, language resolution, ICU formatting
```

- **`source.json`** is the source of truth for English text AND per-string context. `source` = the
  English string; `context` = where it appears / tone / length limits — the note a translator (you, in
  a future session, or a human) reads to translate correctly. English is NOT duplicated into a separate
  `en.json`; the English runtime value comes from `source.json`'s `source` field.
- **`<lang>.json`** holds only `{ key: translatedValue }`. Adding a language = add one file. **No schema
  migration is ever needed to add a language.**
- **DB rows store keys, not display text.** Resolution happens client-side: `t(key)` looks up
  `bundle[key] ?? source[key].source ?? key`. The API stays language-agnostic.

### Key naming convention

Stable, hierarchical, English: `ui.hud.health`, `ui.welcome.intro`, `ui.button.take_off`,
`ship.player_basic.name`, `weapon.kinetic_basic.name`, `level.1.victory`. Keep keys decoupled from
display text so wording changes don't churn keys.

### Catalog entry examples

`source.json`:
```json
{
  "ui.hud.health": { "source": "Health", "context": "HUD label above the health bar. One word, very short." },
  "ui.welcome.intro": { "source": "Pirates are raiding our home system…", "context": "Welcome-screen intro paragraph. 2–3 sentences, motivating, second person." },
  "ship.player_basic.name": { "source": "Basic player ship", "context": "Ship display name on the ship-picker card and HUD target. ≤24 chars. Proper-noun-ish; may stay English if no natural RU form." },
  "level.1.victory": { "source": "Level 1 cleared! Nice flying, Ninja.", "context": "Victory overlay subtitle after level 1. Upbeat. 'Ninja' is the player's in-game title — keep it." },
  "hud.gameover.sub": { "source": "Destroyed: {kills} — Score: {score}", "context": "Game-over subtitle. {kills},{score} are integers placed after labels, so no plural form is needed." }
}
```

`ru.json`:
```json
{
  "ui.hud.health": "Здоровье",
  "ship.player_basic.name": "Базовый корабль",
  "level.1.victory": "Уровень 1 пройден! Отличный полёт, Ниндзя.",
  "hud.gameover.sub": "Уничтожено: {kills} — Очки: {score}"
}
```

## Implementation steps

### 1. `client/src/i18n.js`
- Load `source.json` and the active `<lang>.json` (fetch on startup, before first render).
- `t(key, params)` → resolve `bundle[key] ?? source[key]?.source ?? key`, then substitute simple
  named placeholders (`{score}` → `params.score`). **That's the whole formatter for now** — no plural
  logic, no ICU `{count, plural, …}` parsing, no dependency. (When plurals are eventually needed, add a
  branch using the built-in `Intl.PluralRules`; see DECISIONS §10. Don't build it preemptively.)
- `resolveLanguage()`: explicit (`localStorage.lang` / `players.language`) → `navigator.language`
  (map `ru*`→`ru`, else `en`) → `en`. Clamp to `{en, ru}`.
- `setLanguage(lang)`: set `localStorage.lang`, re-render, POST to the server (step 4).
- Unit-testable (`client/src/i18n.test.js`): resolution order, missing-key fallback to source,
  `{var}` interpolation, browser-lang mapping.

### 2. Refactor `client/index.html`
- Static text nodes → `data-i18n="key"` (and `data-i18n-attr` for attributes if any). A single
  `applyTranslations(root)` walks `[data-i18n]` and sets `textContent` from `t()`.
- JS-set strings → replace literals with `t('key', params)` (Victory/Game over/ship-card labels/perf
  string). Re-run `applyTranslations()` + refresh dynamic strings on language change.
- The `<html lang="en">` attribute should track the active language.

### 3. DB content → keys
- `catalog_seed.js`: give each ship/weapon/component a stable i18n key and add a nullable key column
  (`name_key`) via the migration; keep `name` as canonical English fallback. Add the matching
  `source.json` entries (with context) + `ru.json` values.
- Level victory: change `descriptor.phases[].text` to `textKey` (keep `text` as fallback if you prefer
  a gentler migration). Update the client (~830/839) to `t(phase.textKey)`.
- The client already fetches ships/levels; it now resolves their keys through `t()`.

### 4. `players.language` + endpoint
- Migration `007_player_language.js` (re-check the number): SQLite
  `ALTER TABLE players ADD COLUMN language TEXT NOT NULL DEFAULT 'en'`; mirror in the Postgres
  bootstrap (`db_postgres.js`). No FK (so the SQLite ADD COLUMN is safe — DECISIONS §9).
- `datastore.js` + `db.js` + `db_postgres.js`: `setPlayerLanguage(id, lang)` /
  include `language` in the player fetch.
- `server.js`: `POST /api/players/:id/language` (validate `lang ∈ {en, ru}`, 400 otherwise). Return
  `language` from the register / active-ship response so the client can seed its choice.
- Client: on load, prefer server `players.language` if set; on switch, persist both ways.

### 5. Language switcher (UI)
- Small EN/RU toggle on the welcome screen (and optionally a corner control in-game). Calls
  `setLanguage()`.

## Tests
- **Client** `client/src/i18n.test.js` (built-in `node:test`): resolution order, fallback, `{var}`
  interpolation, browser-lang mapping. (No plural tests — plurals are deferred, see DECISIONS §10.)
- **Server** `server/src/server.test.js`: `POST /api/players/:id/language` happy path + 400 on bad lang;
  player fetch returns `language`. (Server suite currently grows on each feature — add, don't replace.)
- **Visual** (optional, `client/visual/`): a scenario booting with `?lang=ru` (or localStorage) and
  asserting a known RU label renders.

## Docs to update (per CLAUDE.md docs workflow)
- `docs/SUMMARY.md` — add a "Localization" subsection (current state); bump `**Updated:**`.
- `docs/CHANGELOG.md` — new dated bullet (include the migration + endpoint + locale files).
- `docs/DECISIONS.md` §10 already records the rationale — update only if the build deviates.

## Acceptance criteria
- Switching EN↔RU re-renders all UI chrome AND DB-sourced content (ship names, victory text) with no
  reload, no leftover English (except strings deliberately marked "keep English" in `source.json`).
- A fresh browser with `navigator.language = ru-RU` starts in Russian; an explicit choice overrides and
  persists across reloads and (via `players.language`) across `localStorage` clears.
- Adding a hypothetical third language would require only a new `client/locales/<lang>.json` — confirm
  no schema/code change is needed for that.
- All existing tests pass; new client + server tests cover i18n.
- English remains the source of truth: every key's English value lives in `source.json`; no Russian in
  code, comments, commits, or keys.
