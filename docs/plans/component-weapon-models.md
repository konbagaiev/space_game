# Component & weapon 3D models — foundation brief (Vega Sentinels)

> **Goal.** Today only **ships** carry a 3D model (`ships.model_url` / `model_url_high`). This update
> adds the same capability to **components** (hull/engine/thruster/repair) and **weapons**
> (bullets/rockets), plus a **reusable small "item viewer"** (a generalized version of the hangar
> ship preview) so any item's model can be shown in a rotating 3D panel. **Where** item models get
> shown across the UI (shop / loadout / stash) is **deliberately out of scope** — the maintainer hasn't
> decided yet. This brief only builds the *data + display capability*. The first concrete consumer is
> the mission briefing (see the companion **`docs/plans/briefing-item-showcase.md`**), which uses this
> foundation to show the granted item.
>
> **First two real assets** delivered by this brief: the **Repair drone** (component id 12) and the
> **Machine Gun** (weapon id 5). Both sources are on hand (see step 1); both are **CC-BY 4.0** (credit
> rows pre-approved by the maintainer, exact text in step 6).
>
> **Planning window — execute when told.** This file is self-contained; an agent can run it without the
> originating chat.

This extends, and reuses verbatim, the ship-model machinery documented in
**`docs/plans/ship-model-pipeline.md`** (the `assets:*` build/push pipeline) and
**`docs/plans/adding-a-ship-model.md`** (the `stats.model` yaw/scale convention). Read those for the
pipeline details; this brief only describes the *delta* needed to point the same machinery at
components/weapons. English-only (CLAUDE.md).

---

## Design decisions (resolved — don't re-ask)

1. **DB-driven, mirror ships.** Items get model URLs as **DB columns + seed fields**, exactly like
   ships — no client hardcoding (the project's standing rule; cf. DB-driven sound routing). Same
   `stats.model { yaw, scale }` convention as ships for per-item presentation.
2. **Hangar (CloudFront) model only — no combat/same-origin copy for items.** Components/weapons are
   **never rendered in the combat scene** (they're part of the ship there); their model is a **menu-only
   icon**. So we wire **only `model_url_high`** (the high-poly CloudFront glb, lazy-loaded) and leave
   `model_url` (combat) **null/omitted**. This keeps the deploy image lean (no `ships-combat/` → bake
   step for items) and avoids touching the CI pull/bake path. The build still *produces* both glbs
   (harmless); we just paste only the hangar URL. The item viewer loads `model_url_high`.
3. **Reuse the `ships-hangar/` S3 prefix** for item hangar glbs rather than adding an `items-hangar/`
   prefix — it's just "high-poly menu glbs", and a new prefix would mean pipeline surgery
   (`assets-config.mjs` + push/check). Minor naming wart, noted as a future-cleanup candidate; not worth
   the churn now.
4. **Add the columns for ALL items now, wire only the two assets we have.** Repair drone (12) +
   Machine Gun (5) get a `model_url_high`; every other component/weapon keeps it **null**. The viewer
   degrades gracefully when an item has no model.
5. **Generalize the existing preview into a reusable model viewer** rather than building a second
   Three.js context — the hangar ship preview (`startShipPreview` / `loadPreviewModel`) already has the
   renderer/scene/light/RoomEnvironment/auto-rotate/resize machinery. We make the loader accept an
   arbitrary `{ url, yaw, scale }` so it can show a ship **or** an item.

---

## Step 1 — Stage the source models

Two sources are on the maintainer's machine:
- Repair drone → `/Users/kbagaiev/Downloads/repair_drone_-_xyz_homework_detailing.glb` (~5.9 MB)
- Machine gun  → `/Users/kbagaiev/Downloads/machine_gun.glb` (~351 KB)

Copy them into the pipeline's drop-in dir with clean base names (the base name becomes the output name):
```
cp "/Users/kbagaiev/Downloads/repair_drone_-_xyz_homework_detailing.glb" assets-src/repair_drone.glb
cp "/Users/kbagaiev/Downloads/machine_gun.glb"                            assets-src/machine_gun.glb
```
(`assets-src/` is the gitignored source drawer; `assets:push` later backs the originals up to S3
`source/`.)

**Orientation check (do this first, per `adding-a-ship-model.md`):** drag each `.glb` into
`gltf-viewer.donmccurdy.com` and note which way it faces / its natural up-axis. There is no "+Z nose"
requirement for a static icon — but a sensible resting pose matters. Record the `yaw` (and if it lies
flat/on its side, you may want a small extra rotation; see step 4 on `stats.model`). For an icon we only
need it to read clearly while slowly spinning about Y.

## Step 2 — Build the glbs

```
npm run assets:build repair_drone machine_gun
```
`scripts/assets-build.mjs` emits content-hashed `*_combat.<hash>.glb` + `*_hangar.<hash>.glb` into
`assets-dist/` and prints `modelUrl: …, modelUrlHigh: …` lines (`scripts/assets-build.mjs:39-72`). We
use **only the `modelUrlHigh`** (CloudFront) value per decision #2.

- The machine gun is tiny (351 KB) → default `PRESET.hangar` (1024px WebP + meshopt) is fine.
- The repair drone source is ~5.9 MB → **check the hangar output size**. If it lands above ~4 MB, add a
  per-source **`PRESET_OVERRIDES`** entry in `scripts/assets-config.mjs:45-50` (mirror the existing
  `player` override — e.g. drop hangar textures to 512px WebP). A menu icon doesn't need full PBR.

## Step 3 — Push to S3

```
npm run assets:push
```
Uploads `assets-dist/*_hangar.<hash>.glb` → `s3://vega-sentinels-assets/ships-hangar/` (CloudFront) and
backs up the sources → `source/` (`scripts/assets-push.mjs:38-46`). (It also pushes the unused combat
glbs to `ships-combat/`; harmless.)

## Step 4 — DB schema: add `model_url` / `model_url_high` to `components` and `weapons`

Mirror how `model_url_high` was added to `ships` (migration `012_ship_model_high.js`).

**SQLite — new numbered migration** `server/src/migrations/013_item_models.js` (next free number; the
runner `server/src/migrate.js` applies `NNN_*.js` where `NNN > PRAGMA user_version`, each in a
transaction). Export `up(db)`:
```js
// Item 3D models: components/weapons gain the same model fields ships already have.
// We populate only model_url_high (hangar, CloudFront) for now — items are menu-only icons,
// never rendered in combat — so model_url (combat/same-origin) stays nullable & unused. See
// docs/plans/component-weapon-models.md.
module.exports.up = (db) => {
  db.exec('ALTER TABLE components ADD COLUMN model_url TEXT;');
  db.exec('ALTER TABLE components ADD COLUMN model_url_high TEXT;');
  db.exec('ALTER TABLE weapons ADD COLUMN model_url TEXT;');
  db.exec('ALTER TABLE weapons ADD COLUMN model_url_high TEXT;');
};
```
(Match the exact export shape of the other migrations — check `012_ship_model_high.js` for whether they
use `module.exports.up = …` vs `exports.up = …` and copy it.)

**Postgres — parity (do NOT skip; tests are SQLite-only).** `server/src/db_postgres.js` adds columns via
idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` inside its monolithic `migrate()` (the components
block ~`db_postgres.js:38-65`, weapons ~`:58-64`, mirroring how `ships.model_url_high`/`price` are added
there). Add the four `ADD COLUMN IF NOT EXISTS model_url / model_url_high` statements for
`components` and `weapons`. **This file has no test coverage** (see the `backend-parity-sqlite-postgres`
note) — eyeball it against the SQLite migration column-for-column.

## Step 5 — Seed + getters + API + client bootstrap (thread the new fields through)

**(a) Seed** — `server/src/catalog_seed.js`. Add `modelUrlHigh` to the two rows that now have an asset,
and a `stats.model` block for presentation. (Use the hashed URLs printed in step 2.)
- Repair drone (component id 12, in COMPONENTS `catalog_seed.js:19-64`):
  ```js
  { id: 12, name: 'Repair drone', type: 'repair', weight: 4, price: 500,
    modelUrlHigh: 'https://d1843uwjdjg4vs.cloudfront.net/ships-hangar/repair_drone_hangar.<hash>.glb',
    stats: { repairPerTick: 1, intervalSec: 1, maxFraction: 0.8, model: { yaw: 0, scale: 1 } } }
  ```
- Machine Gun (weapon id 5, in WEAPONS `catalog_seed.js:73-134`):
  ```js
  { id: 5, name: 'Machine Gun', type: 'bullet', price: 1500,
    modelUrlHigh: 'https://d1843uwjdjg4vs.cloudfront.net/ships-hangar/machine_gun_hangar.<hash>.glb',
    stats: { power: 7, projectileSpeed: 50, maxRange: 100, fireCooldown: 0.1, weight: 8,
             projectileColor: 0xffe066, class: 'kinetic', model: { yaw: 0, scale: 1 } } }
  ```
  Tune `yaw`/`scale` after the visual check (step 7). Decide the `model` placement to match how the seed
  carries ships' `stats.model` — for items it lives **inside `stats`** (consistent with ships).

   > **Seed-key casing:** ships use camelCase `modelUrl`/`modelUrlHigh` in the seed even though the DB
   > columns are snake_case `model_url*` — the seed→DB upsert maps them. Use the **same camelCase keys**
   > on the item rows; confirm by reading how the ships upsert reads `modelUrlHigh` in `catalog_seed`'s
   > consumer (the seed/upsert code in `db.js` / `db_postgres.js`) and mirror it for components/weapons.

**(b) Getters** — `server/src/db.js` (and the Postgres twin). `getComponents` (`db.js:288-291`) and
`getWeapons` (`db.js:283-286`) must **select + return** `modelUrl` / `modelUrlHigh` (currently they
return `{id,name,type,(weight,)price,stats}`). Match how `getShips` (`db.js:277-281`) maps
`model_url`→`modelUrl` and `model_url_high`→`modelUrlHigh`. Do the same in `db_postgres.js`.

**(c) API** — no change. `/api/components` + `/api/weapons` (`server/src/server.js:96-97`) just return
the getters' output.

**(d) Client bootstrap** — `client/index.html` (~`:4062-4076`). Two different mapping styles today:
- Components are stored **whole**: `for (const c of components) CATALOG.components.set(c.id, c)` — so
  `modelUrlHigh` flows through automatically. ✅
- Weapons are **flattened**: `CATALOG.weapons.set(w.id, { id, name, type, price, ...w.stats })` — this
  **drops** top-level `modelUrl`/`modelUrlHigh`. **Fix:** include them:
  ```js
  CATALOG.weapons.set(w.id, { id: w.id, name: w.name, type: w.type, price: w.price,
                              modelUrl: w.modelUrl, modelUrlHigh: w.modelUrlHigh, ...w.stats });
  ```
  Note `...w.stats` spreads `stats.model` to a top-level `model` key on the weapon entry — fine for the
  viewer cfg helper (step 6b), but be aware components keep `model` nested under `c.stats.model`. The
  viewer's cfg helper must read both shapes.

## Step 6 — Generalize the preview into a reusable item viewer

In `client/index.html`, the hangar ship preview already has everything (renderer + scene + key/ambient
light + optional RoomEnvironment PMREM + auto-rotate loop + resize): `startShipPreview`
(`:3071-3101`), `loadPreviewModel` (`:3115-3139`), `stopShipPreview` (`:3102-3104`), `resizePreview`
(`:3105-3112`), canvas `#mw-ship` (`:604`). `loadPreviewModel` currently hardcodes the **active ship**:
`const url = ship.modelUrlHigh || ship.modelUrl` (`:3118`) and `shipModelCfg(ship.stats)` (`:3121`).

**(a)** Refactor `loadPreviewModel` to load from a small state object instead of always the ship —
e.g. `mwPreview.target = { url, cfg }`, defaulting to the active ship. Extract the
load-glb-into-`mwPreview.group` body (Box3 normalize to `SHIP_MODEL_LEN` 3.4 + recenter + yaw pivot,
`:3124-3138`) into a helper `setPreviewModel(url, cfg)` so a caller can show **either** the ship or an
arbitrary item. Keep the no-op-if-same-url guard (`:3118-3120`).

**(b)** Add a cfg helper that reads `stats.model` from any item, tolerant of the two shapes from step
5d — components have `model` under `.stats.model`, the flattened weapon entry has it at `.model`:
```js
// yaw/scale for an item (weapon/component) preview; mirrors shipModelCfg's defaults
const itemModelCfg = (item) => {
  const m = (item && (item.model || (item.stats && item.stats.model))) || {};
  return { yaw: m.yaw ?? 0, scale: m.scale ?? 1, scaleMul: m.scaleMul ?? 1 };
};
```
(Reuse `shipModelCfg` for ships; this is its item sibling. If you prefer, fold both into one helper.)

**This step only adds the *capability*** to point the existing preview at an item. The actual call
("show the granted item during a briefing") lives in the companion brief, which calls
`setPreviewModel(item.modelUrlHigh, itemModelCfg(item))`.

## Step 7 — Drift-check + verify

**Extend the deploy guard** `scripts/assets-check.mjs` (currently validates only SHIPS `modelUrl*` +
SOUNDS, `:45-67`) to also iterate **COMPONENTS** and **WEAPONS** and assert every non-null
`modelUrlHigh` (and `modelUrl`, if ever set) exists on S3 — so a wired-but-unpushed item model fails the
build the same way a ship does. Reuse the same content-hash skip + `head-object` check.
```
npm run assets:check    # must report OK
```

**Run + look:** restart the local server (catalog reseeds **only on startup** — a stale server serves
the old catalog; this is the #1 "why is my model missing" gotcha, per the `update-ship-model` skill),
then open the game. The viewer capability has no default UI yet, so verify via the companion briefing
brief, or temporarily point the ship preview at an item to confirm the glb loads, is centered/sized
sanely, and spins. Adjust `stats.model.yaw`/`scale` in the seed and restart until it reads well.

## Step 8 — Credits (pre-approved by the maintainer)

Add two rows to the table in `client/assets/CREDITS.md` and a short note in its **Models** section.
The maintainer supplied the exact attribution text (CLAUDE.md asset-credits rule satisfied — no need to
re-ask):

Table rows:
```
| ships/repair_drone_hangar.<hash>.glb (Repair drone item icon) | Ivan Potupin | https://skfb.ly/pGPyp | CC-BY 4.0 | <date> |
| ships/machine_gun_hangar.<hash>.glb (Machine Gun item icon)   | suvee10      | https://skfb.ly/oHLZB | CC-BY 4.0 | <date> |
```
Required attribution (verbatim, for an in-game credits screen):
> "Repair Drone - XYZ Homework (Detailing)" (https://skfb.ly/pGPyp) by Ivan Potupin is licensed under
> Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).
> "machine gun" (https://skfb.ly/oHLZB) by suvee10 is licensed under Creative Commons Attribution
> (http://creativecommons.org/licenses/by/4.0/).

(Both are **CC-BY** — commercial use is fine; attribution must stay while in use.)

## Step 9 — Docs + commit + deploy

- **CHANGELOG.md** — bullet under today's date: components/weapons gained `model_url*`
  (schema + seed + getters + client), the reusable item viewer, and the first two item models (repair
  drone, machine gun) on CloudFront. Include the migration + Postgres-parity note.
- **SUMMARY.md** — in the "Ship model (DB-driven)" section, note that components/weapons now also carry
  an optional `model_url_high` (menu-only icon, hangar/CloudFront) and that the hangar preview
  (`startShipPreview`/`setPreviewModel`) is now a general ship-or-item viewer. Bump `**Updated:**`.
- **DECISIONS.md** — short entry: *why item models are hangar-only (no combat/same-origin copy) and
  reuse the `ships-hangar/` prefix* (decisions #2/#3 above).
- Commit `catalog_seed.js` + migration + db/db_postgres + client + check-script + CREDITS + docs (**no
  binaries** — S3 is canonical). On deploy, CI runs `assets:check` (now covering items) and the hangar
  glbs are already on CloudFront, so nothing to bake.

---

## Files this touches (quick map)

| Concern | File:anchor |
|---|---|
| SQLite migration | `server/src/migrations/013_item_models.js` (new); pattern from `012_ship_model_high.js`, runner `migrate.js` |
| Postgres parity | `server/src/db_postgres.js` (components ~`:38-65`, weapons ~`:58-64`) |
| Seed rows | `server/src/catalog_seed.js` (COMPONENTS `:19-64`, WEAPONS `:73-134`) |
| Getters | `server/src/db.js` `getComponents` `:288-291`, `getWeapons` `:283-286` (+ Postgres twins); pattern `getShips` `:277-281` |
| Client bootstrap | `client/index.html` `:4062-4076` (weapons map needs `modelUrl*`) |
| Viewer | `client/index.html` `loadPreviewModel` `:3115-3139`, `startShipPreview` `:3071-3101`, `SHIP_MODEL_LEN` `:1461` |
| Drift guard | `scripts/assets-check.mjs` `:45-67` |
| Credits | `client/assets/CREDITS.md` |
