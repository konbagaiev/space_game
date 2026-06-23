# Vega Sentinels — decisions and notes

The prototype: a single `index.html` file, Three.js from a CDN (via importmap). Opens with a
double click in the browser, nothing to install.

---

## 1. Engine: Three.js (not Godot/Unity)

**Why:** for "a few 3D ships fighting on a plane" we need the fastest possible start.
Three.js = one HTML file, no installation, instant result, easy to share.
Unity is heavy (Hub, license, C#), Godot needs an editor and installation.

**When to reconsider Godot:** when we get to physics (real collisions),
a visual level editor, or multiplayer — that's where an engine truly pays off.
For now Three.js isn't holding us back.

---

## 2. Ship controls and physics (inertia)

An "Asteroids-like" model:
- `W/S` (or `↑/↓`) — thrust forward/backward along the nose.
- `A/D` (or `←/→`) — turn only the nose, without touching the movement vector.
- `Space` — fire.

Specifics:
- **Pure inertia:** no friction, no speed limit while thrusting — we fly along the accumulated
  vector, wherever the nose is pointing (you can drift sideways and shoot forward).
- **Passive braking:** if NOT a SINGLE control button is pressed — velocity smoothly
  decays (`IDLE_DRAG`). Hold a turn to aim and the inertia is preserved.
- **Arena boundaries (soft, since 2026-06-22):** the player may fly past ±240 freely — there is **no
  hard wall**. Earlier we zeroed the axis velocity at the wall, which read as a bug (the ship "stuck"
  to an invisible edge). Now a faint glowing edge marker shows where the battlefield ends; after the
  ship is **2 s continuously out of bounds** a HUD warning + countdown appears, and after **30 s** out
  the ship is **warped back to center** (velocity zeroed, reusing the enemy warp-in animation). A
  corner mini-map/radar gives spatial awareness. **Nothing is hard-clamped to the arena** — enemies
  chase the player out and spawn around it (no edge clamp), and bullets/rockets fly normally beyond
  ±240 (limited only by range/hits), so combat works fully out of bounds; ±240 only drives the
  boundary UI. (The old `clampToArena` clamp was removed.) See `docs/plans/arena-boundaries.md`.

Knobs: `ACCEL` (acceleration), `TURN` (turning), `IDLE_DRAG` (braking), `ARENA` (size),
`OOB_WARN_DELAY` (warning grace, 2 s), `OOB_RETURN_TIME` (auto-return, 30 s).

---

## 3. Camera

- Nearly vertical (top-down view), **fixed angle**, does NOT rotate with the ship's turn.
- **Rigidly attached to the player** (`CAM_OFFSET`), without smoothing/lag — otherwise switching
  direction caused "jitter" and a slight "floating".

---

## 4. Background: three layers by depth

1. **Stars** — a distant static backdrop, glued to the camera (no parallax). Varying
   brightness (a power-law distribution: many dim ones, rare bright ones).
2. **Asteroids** — a small layer BEHIND the combat plane, in world coordinates (NOT attached
   to the camera). When flying they rush past → giving a sense of speed. A single `InstancedMesh`
   (1 draw call). Knobs: `ROCK_COUNT`, size, `ROCK_SPREAD`.
3. **Planet + 2 moons** — light parallax (`PARALLAX`), so depth is felt.
   The moons orbit the planet (`updateMoons`), they don't rotate themselves → terminators stay consistent.

---

## 5. Lighting — TWO independent lights via two render passes (important!)

**The task:** light the combat with one light, the planet/moons with another (with a real day/night).

**What did NOT work (dead ends):**
- **Light layers (`layers`)** — didn't give a clean separation. At the very least `AmbientLight`
  is global and ignores layers → it flooded the planet flatly, killing the terminator.
- **Baking day/night into vertex colors** (`MeshBasic`) — it worked, but the planet came out
  flat/unrealistic (no volume and no soft terminator from real light).

**What worked (the current solution):** two render passes, each with its own scene and its own light.
- `scene` (combat: ships, rocks, bullets, explosions) — its own light: `AmbientLight` + `sun`.
- `skyScene` (planet, moons, stars) — its own light: a weak ambient (the night side) +
  a side `skySun` (gives a real terminator).
- The loop: `renderer.autoClear=false`; `clear()` → `render(skyScene)` → `clearDepth()` →
  `render(scene)`. The space background is drawn by `skyScene.background`, with `scene.background = null`.

Knobs: planet day — the intensity of `skySun` and its position (= the "sun" direction);
night — the ambient in `skyScene`; combat — the light in `scene` (no need to touch it, it's "correct").

**Stars vs transparency:** the stars are made NON-transparent (`transparent:false`) + `depthWrite:false`
+ `renderOrder:-1`. Otherwise (as transparent) they were drawn AFTER the planet and crept onto its disk.

---

## 6. Combat

- Enemies: **2 hits** (hp 2, shot damage 1). 4 enemies, spawning in a ring around the player.
- Enemy AI: turn toward the player → keep your distance (~14–22) → shoot once aimed.
- A **micro-explosion** at the hit point: a short (`EXPLOSION_LIFE ≈ 0.16s`) fiery flash
  (an additive sphere, quickly expanding and fading).
- A **ship-destruction burst** (`spawnShipExplosion`) when a ship dies — deliberately louder than the
  hit-flash: stacked fireball layers (white core → orange → red, each bigger/slower via the now
  tunable `life`/`color` of `spawnExplosion`), a radial spray of ~22 colored sparks (own pool, with
  drag), and a flat additive shockwave ring expanding on the plane. Tinted by the ship's color.

### Engine trail (exhaust)

The `trail` system (analogous to explosions): when thrusting forward (`W`/`↑`), glowing additive
particles fly out of the nozzle, fading and shrinking over `TRAIL_LIFE` (~0.55s).

The particle physics matters: **the starting velocity = the ship's velocity + ejection backward along the nozzle**
(`shipVel + (-fwd) * EXHAUST_SPEED`). So the exhaust depends on the ship's motion (at speed
it flies along with it rather than lagging behind) and on the nozzle direction (`-fwd`); when turning while drifting
the jet goes along the new nose direction.

The exhaust parameters now live in the **engine** (`engine.exhaust`): `speed` (how fast
the particles separate backward), `life` (trail length), `size` (thickness), `spread` (scatter), `color`.
See section 8 about the component-based model.

---

## 7. How to check the picture (for development)

A regular screen capture is blocked by the system. Instead — a headless render via Playwright
(headless Chromium, software WebGL). This is now a committed, stable suite: **`client/visual/`**
(`npm run test:visual` from `client/`), see `client/visual/README.md`. It boots the real game and
asserts on **simulation state** (particle counts, size ratios, exhaust colors) through a
`?debug`-gated `window.__game` hook, and saves PNG frames to `__screenshots__/` for the eye.

Design choices: **no pixel diffing** (software WebGL differs between machines → flaky baselines;
screenshots are review artifacts, not pass/fail), and the suite is **kept out of CI** (slower, needs
a browser binary) — run it by hand before a larger/rarer release. CI keeps running only the fast unit
tests. For one-off experiments, an ad-hoc script under `/tmp` loading `http://localhost:4000/` works too.
⚠️ Caveat: swiftshader in headless sometimes diverges from a real browser in subtle things
(transparency order) — do the final check in a real browser.

---

## 8. Ship model: data components

**Why:** to move away from a scatter of hardcoded constants toward a structure from which a ship
is assembled — groundwork for upgrades, different ships/enemies, and balance.

Catalogs in `client/index.html`: `ENGINES`, `HULLS`, `WEAPONS`. A ship (player/enemy) references
components (loadout: `hull` / `engine` / `weapon`), and the logic reads stats from there.

- **The engine** includes the **exhaust** (`exhaust`) as its own part — the trail parameters are taken from
  the engine, not from global constants.
- **Projectiles** carry the damage and speed of their weapon — that's why different weapons produce different bullets from
  a single `spawnBullet(from, dir, weapon, fromPlayer)` function.
- Some fields are intentionally **groundwork** and don't affect logic yet: `weight`, `durability`
  (on the engine), `volume`. They're easy to start using (mass → inertia, durability → failures).

The principle: **a new mechanic = first a stat on a component, then reading it in the logic**,
not a new global constant.

---

## 9. Deployment, rollback, and migrations

Live at **https://vega.tenony.com** (legacy **https://space.bagaiev.com** still routed during the
transition — see §12). Docker on a shared Hetzner VPS, behind Traefik, on the shared Postgres.
Details in `server/README.md`. Key decisions:

**Zero-downtime deploys (blue-green).** The container has a Docker `healthcheck` — Traefik only
routes to it once `/api/health` passes (i.e. after migrations run on startup). Deploy uses
`docker rollout -w 10 app`: new container up → healthy → Traefik picks it up → old removed.
A failed migration ⇒ container never becomes healthy ⇒ rollout keeps the old one. Verified by
polling during a rollout (0 dropped requests). Deploys that change `docker-compose.yml` itself may
blip once (the old container gets recreated for the config change).

**Rollback = swap the image, not the DB.** Each deploy tags the image `spacegame:<git-sha>`; the
CI keeps the 3 newest (current + 2 to roll back to). `rollback.sh` re-tags a previous version to
`:latest` and runs `docker rollout` — zero-downtime, no rebuild.

**Migrations are forward-only.** We do NOT run down-migrations in production (rolling back a
destructive change = data loss). Instead, schema changes follow **expand/contract**: add new
columns/tables (backward-compatible) → ship code that uses them → remove the old ones only in a
LATER release, once the old code can no longer come back. This keeps a code rollback always safe
(the schema works for both versions). Catastrophes are handled by restoring a DB backup, not by
reversing a migration. Current migrations are additive/idempotent, so already backward-compatible.

**Player progress is a FK to `levels(id)`, enforced only in Postgres.** `players.current_progress`
points at the player's highest unlocked level. Postgres declares it as a real `REFERENCES levels(id)`
FK (prod gets referential integrity). SQLite **can't** `ALTER TABLE ... ADD COLUMN` with both a
`REFERENCES` clause and a non-NULL default (it errors regardless of `PRAGMA foreign_keys`), and we'd
rather not do a full table rebuild for the dev/test backend — which doesn't enforce FKs anyway. So the
SQLite column is a plain `INTEGER NOT NULL DEFAULT 1`, treated as the same logical FK in queries (the
JOIN works either way). Advancing uses `MIN(id) WHERE id > current` rather than `current + 1`, so it
tolerates non-contiguous level ids (the local DB has gaps from re-seed history). The default `1` assumes
`level-1` is the first seeded level (id 1) — true by seed order in every backend.

---

## 10. Localization (i18n) — English is the source, translations layer on top (planned)

**Decision.** English is the **canonical, source-of-truth language**; multi-language support is a
**localization layer added on top**, not a replacement. **Russian is the first localization language.**

**How this reconciles the "English only" project rule (`CLAUDE.md`).** That rule governs the
*source of truth* — code, identifiers, string **keys**, docs, commits, and the **default/base UI
text** all stay English. It does **not** forbid showing a player translated text: a localized string
is a derived artifact keyed off the English original. So English-only stands for everything we author
and version; locales are generated views of it.

**Planned approach (queued — see sequencing below):**
- **Client UI (~35–40 strings, `client/index.html`):** centralize into a keyed dictionary
  (`client/src/i18n.js`, `t(key, params)`); `en` values are the current English text, so the English
  source is preserved. DOM via `data-i18n` attributes + `t()` for JS-set strings.
- **All translatable text (UI + DB content) flows through ONE file-based message catalog** — the
  source of truth, version-controlled, English-only-rule friendly:
  - `client/locales/source.json` — the canonical catalog: `{ key: { source, context } }`. `source` is
    the English text; `context` is the per-string note for the translator (where it appears, tone,
    length limits) — authored once, travels to the translator (human or AI) automatically. This is the
    gettext `#.` / FormatJS `description` pattern, and it's the whole reason we reject per-column
    translations (a column has nowhere to hold context, and adding a language ALTERs every table).
  - `client/locales/<lang>.json` (e.g. `ru.json`) — `{ key: value }`, the translations. English is NOT
    duplicated here; it comes from `source.json`. **Adding a language = add one file, zero schema change.**
  - **DB content stores stable keys, not display text.** A row carries an i18n key (e.g.
    `ship.player_basic.name`); the canonical English `name`/`text` stays for fallback/debug. Level
    victory `descriptor.phases[].text` becomes `textKey`.
  - **Resolution is client-side:** the client loads `source.json` + the active `<lang>.json` and
    resolves everything through one `t(key, params)` — UI labels and DB content identically. The DB and
    API stay language-agnostic (keys only); the server never resolves content.
  - **Interpolation:** values support simple named placeholders (`Score: {score}`). That's all the
    runtime formatter needs for now.
  - **Plurals/composite phrases — deferred on purpose.** Grammatical number (esp. Russian: 1 враг /
    2 врага / 5 врагов) is the hard part of i18n. **For now we avoid authoring such phrases at all** —
    prefer designs that sidestep grammatical number: a static label next to a separate number
    (`Enemies` + `4`), the `N×` notation (`2× gun`), or a value after a colon (`Destroyed: 12`). At
    planning time **no string requires plurals**, so we don't build plural support yet.
  - **When we do need plurals** (revisit once copy/scale demands it): the chosen mechanism is the
    **built-in `Intl.PluralRules`** (`new Intl.PluralRules('ru').select(5) === 'many'`) — correct CLDR
    categories for free, **zero dependencies** — plus a tiny ICU-subset formatter to pick the branch.
    We will NOT hand-code language plural rules, and NOT add `@formatjs`/any runtime dep (keeps the
    project's built-in-only ethos). Keep new translatable strings simple until then.
- **Language selection:** explicit choice (`players.language`, persisted via a new migration +
  endpoint, mirrored to `localStorage`) → `navigator.language` → `en` fallback. Only `en`/`ru` for now.
  The server stores only the *preference*; resolution stays on the client.

**Sequencing (parallel-work hazard).** i18n heavily overlaps the maps/levels feature in the exact same
files (`index.html`, `catalog_seed.js`, and the migrations sequence — both would add the next `00N`
migration). Do i18n **after** maps/levels merges to `main`, to avoid a large merge-conflict surface.

**As built (deviations from the plan above).** Three small, deliberate divergences:
1. **DB content keys ride in the existing JSON columns, not a new `name_key` column.** The player ship's
   key lives in `ships.stats.nameKey` and the victory line's in `levels.descriptor.phases[].textKey` —
   both upsert with the catalog on startup, so **no content migration** was needed (only `players.language`,
   migration 007, required one). Same architecture (rows carry keys, English stays as fallback), less schema churn.
2. **Only player-visible content is keyed.** Just the player ship gets a `nameKey` (it's the only ship name
   shown — the picker lists player ships only; enemy names never render). Weapon/component names aren't
   displayed, so they aren't keyed yet; adding one later = a key in its JSON + a `source.json`/`ru.json` entry.
3. **The server preference adopts only when non-default.** `players.language` defaults to `'en'`, which is
   indistinguishable from an explicit "I chose English". So the client adopts the server value only when it's
   **non-default** — otherwise a brand-new player's `navigator.language` would be wrongly overridden by the
   `'en'` default. A chosen language still survives a `localStorage` clear (it's a non-default value on the server).

---

## 11. Economy — credits, earned-this-run vs persistent balance

**Decision.** The game currency is **credits**. There are two distinct quantities, intentionally separate:
- **Earned** — credits accrued during the current run (each kill adds the enemy's `reward`; the level-clear
  bonus doubles it). This is the former "score". It's provisional and lives only in the client.
- **Credits** (balance) — the player's persistent account, `players.credits` (default **1000** for new
  players). Server-authoritative.

**Banking happens once, at run end.** On death OR victory the client posts the earned credits to
`/api/games`; the server records the game and atomically adds them to `players.credits`, returning the new
balance (the client trusts that number, never its own arithmetic). A `banked` guard + the server being the
source of truth prevent double-counting. **Closing the browser mid-run loses the unbanked Earned** — by
design: credits are only real once a run completes. Dying still pays out (you keep what you earned), and the
×2 victory bonus is applied to Earned *before* banking.

**Why a persistent balance now** (vs. just renaming score): it's the foundation for spending — buying
hulls/engines/thrusters/weapons from the components catalog. The balance is a plain `INTEGER` column (no FK).

**`games.score` was renamed to `games.credits`** (migration 008; Postgres via an idempotent
`information_schema`-guarded rename) so the history table speaks the same currency. The `/api/games` body
field is `credits`, but the route still accepts a legacy `score` field so an old cached client keeps working.

---

## 11. Player authentication (anonymous-first, optional email/password account) (planned)

**Flow.** Stay anonymous-first. A player keeps the localStorage UUID and auto-registers as today.
**After clearing level 1**, prompt for a **username** (display name) and offer to **register**. Decline →
keep playing anonymously (the username is still saved). Accept → email + password upgrade the *same*
player row in place (progress preserved). Cross-device **progress sync requires a verified email**.

**Decisions:**
- **Password hashing: built-in `crypto.scrypt`** (no dependency — matches the project ethos). Per-user
  random salt; compare with `crypto.timingSafeEqual`.
- **Session: server-side token in an httpOnly, Secure, SameSite cookie.** The DB stores a hash of the
  token (a DB leak doesn't expose live sessions); the cookie holds the raw token. Same-origin + HTTPS
  (Traefik) already in place. No `cookie-parser` dep — parse the `Cookie` header with a small helper.
- **Username = display name; login is by email.** Not unique, not a credential. (Unique handles can come
  later.)
- **Identity model:** the `players.id` UUID stays the stable game identity; credentials attach to that
  row (in-place upgrade preserves progress). On login from a fresh device the client **adopts the
  account's player row**; merging two non-trivial anonymous progresses is out of scope for v1.
- **Email: Amazon SES** (us-east-1, account `140065018525`), outbound only. Sender identity
  `vega.tenony.com`, from `noreply@vega.tenony.com`. A scoped IAM user (`vega-sentinels-mailer`, only
  `ses:SendEmail`/`SendRawEmail`) supplies keys via the server-only `.env` (like `DATABASE_URL`).
  - **SES is called via hand-rolled AWS SigV4 over the built-in `fetch`**, isolated in its own file
    (`server/src/ses.js`) — **no `@aws-sdk` dependency for now**, keeping the built-in-only ethos.
    **Future:** if SigV4-by-hand becomes a maintenance burden (more AWS calls, signing edge cases), we
    may add `@aws-sdk/client-ses` — the isolated module is the single swap point.
  - **✅ SES production access granted** (2026-06-21) — the account is out of sandbox, so verification
    emails can be sent to arbitrary player addresses (no per-recipient verification). Production access
    is account-level (shared with the TendNook/Salesforce project). Dev/test still works without creds
    (the `ses.js` no-creds path logs/records the link).

**Sequencing.** Like i18n, this adds a migration and touches `server.js` + `client/index.html` — land it
relative to the other in-flight features deliberately and coordinate migration numbers (don't let two
branches both grab the same `00N`).

---

## 12. Project name & domain — Vega Sentinels / vega.tenony.com

Renamed from the working title **Space Ninjas** to **Vega Sentinels** (Vega = a well-known star;
"Sentinels" = the player archetype, replacing the "ninja" theme). The player's in-game title becomes
**Sentinel** (was "Ninja"). Canonical domain **https://vega.tenony.com** (a subdomain of `tenony.com`),
replacing `space.bagaiev.com`.

**Why this name:** an exact "Vega Sentinels" is unclaimed on stores; bare star `.com`s are all long
taken, so we host on the `tenony.com` subdomain — store/trademark uniqueness matters more than owning
the `.com`. Both words are common individually ("Sentinels" especially; `Astra Sentinel` is a near
neighbour) — accepted as a working brand.

**Execution order:** the rename is done **first**, before auth/email — see
`docs/plans/rename-vega-sentinels.md`. It splits into **Phase A** (user-facing text + docs — small now
that i18n centralized strings into `client/locales/`) and **Phase B** (infra: the `spacegame`
container/image/Traefik router, the `space.bagaiev.com` host rule, `/opt/projects/spacegame`, DNS) — a
coordinated production/domain migration done with the deploy, not a text edit.

---

## 13. Between-level briefings — data-driven message + server-side actions

**Decision.** Progression beats (a story message + state changes) between levels are **data on the
level**, not hardcoded. A level descriptor carries an optional `briefing = { textKey, text, actions[] }`
shown when the player advances **into** that level (i.e. after clearing the previous one — "what's next").

**Actions run server-side, on advance, exactly once.** `advanceProgress` dispatches each action through a
typed switch (`replaceWeapon` today; `addCredits` / `addToStash` later). They mutate authoritative player
state (`player_ships.loadout` for a weapon swap), so they must be server-side — the client can't be trusted
and the change must persist. Because `current_progress` only moves **forward** (monotonic), advancing into a
given level happens once, so its actions run once; individual actions are also written to be **idempotent**
(`replaceWeapon` is a no-op if the `from` weapon isn't mounted), so a retry can't double-apply.

**Why on the *next* level (not an `onComplete` of the finished one):** the narrative is "here's a tougher
mission and a better weapon for it", which belongs to the upcoming level; it also means the last level needs
no briefing (there's no "next"). On a win the result overlay shows a **Continue** button (a loss shows
Restart/retry) that opens the **Hangar** screen — the between-battles screen (future home for ship
management) — which displays the returned briefing (large text) and launches the next level; the client
also reloads the active ship so the swap is visible.

**Side fix:** `buildPlayerFor` now uses the active ship's **persisted loadout/components** (it previously
always used catalog defaults), which is what makes a stored weapon swap actually take effect in-game.

---

## 14. Asset management (ship/weapon models)

**Split source from runtime.**
- **Runtime, committed:** only web-optimized `.glb` in `client/assets/<kind>/` (KB-scale). Served
  statically by Express, referenced from the DB by `model_url` (e.g. `assets/ships/player.glb`). The 5
  in-use ships (`player/fighter/rocketeer/heavy/boss.glb`) are 11–28 KB.
- **Source/heavy, NOT committed:** Blender files, downloaded packs, high-poly / 4k-texture originals go
  in `client/assets/**/_source/` — **gitignored**, local-only. Keep your own backup; they're not
  versioned (too big — would bloat git history forever). Moved the 7–31 MB originals
  (`lowpoly_spaceships`, `spaceship_colaid1_50k*`) there out of the served `ships/` dir.

**Why:** top-down arena game, ships are tiny on screen; 50k-poly / 4k-texture models (7–31 MB) are
overkill and kill browser load. Budgets: ~1–5k tris, textures ≤512–1024 px, file size tens of KB. Run
source → runtime through `gltf-transform` / `gltfpack` (Draco/meshopt + texture downscale) before
committing the runtime `.glb`.

**`model_url` indirection stays** — the DB points at a path/URL, so swapping/relocating a model is a
data change, not code. **Scale path:** when assets grow, host runtime `.glb` on **S3 + CloudFront** (AWS
account already in use) and point `model_url` at the CDN — deploys stop carrying asset weight, cache is
effectively permanent. `model_url` already accepts absolute URLs.

**Licensing:** every third-party asset's source + license goes in `client/assets/CREDITS.md` (packs in
`_source/` need their license verified before any runtime use).

**LOD per ship — combat (low) vs hangar (high).** A ship can carry two models: the tiny combat `.glb`
(`model_url`, loaded at game start) and an optional detailed hangar `.glb` (`model_url_high`, **lazy-
loaded only when the hangar opens**). Rendering one hi-poly hero model up close is no problem for
Three.js (the bottleneck is download size, not draw calls) — so the detailed model can be 100k+ tris
with PBR/IBL in the hangar, while combat stays minimal. Even the "detailed" model is optimized
(`gltf-transform` meshopt/Draco + KTX2 textures → ~1–4 MB, not the raw 7–31 MB originals).

**Heavy/hangar models are delivered via S3 + CloudFront, not git/deploy.** This is the first real use of
the CDN path: high-detail `.glb` are uploaded to an S3 bucket (`vega-sentinels-assets`, us-east-1) and
served through a CloudFront distribution (private bucket + Origin Access Control; CORS allows the app
origin). `model_url_high` points at the CloudFront URL. The app repo/deploy never carries these files;
cache is effectively permanent. The tiny combat `.glb` stay committed in `client/assets/` as before.

**Live CDN coordinates (provisioned):** bucket `vega-sentinels-assets` (us-east-1, public access
blocked) → CloudFront `d1843uwjdjg4vs.cloudfront.net` (distribution `E10277HTPK8ESK`, OAC
`E1V1952Q4QWOXJ`, cache policy CachingOptimized, origin-request CORS-S3Origin). Upload:
`aws s3 cp model.glb s3://vega-sentinels-assets/ships/<name>_hangar.glb` → URL
`https://d1843uwjdjg4vs.cloudfront.net/ships/<name>_hangar.glb`. A custom domain
(e.g. `cdn.vega.tenony.com` via ACM) can be added later.

**Asset pipeline (`docs/plans/ship-model-pipeline.md`) — partially implemented (2026-06-23).** How models
are sourced, optimized, stored and kept in sync:
- **No binaries in git — S3 is canonical** (revised from "commit the tiny combat glb"): high-poly
  **sources → S3 `source/`**, **combat low-poly → S3 `ships-combat/`**, **hangar high-poly → S3
  `ships-hangar/`** (served via CloudFront). The repo carries only **URLs/paths in the seed**, not bytes.
  (The handful of existing primitive `.glb` stay in git as a fallback; the pipeline is for real sourced
  models.)
- **Combat models are pulled onto the server at DEPLOY (CI), not runtime** — CI `aws s3 sync ships-combat/
  → client/assets/ships/` before `docker build`, baked into the image → runtime stays same-origin (no
  CORS / no startup S3 dependency; the blue-green healthcheck isn't gated on S3). Hangar high-poly stays
  lazy-loaded from CloudFront.
- **Content-hashed filenames** (`<ship>_combat.<hash>.glb`) — hash = version; caches forever, new model =
  new URL, no invalidation. Bytes on S3 + hashed URL in git ⇒ they can't drift.
- **Drift-check / deploy guard:** every pipeline `model_url*` in the seed must exist on S3 or the
  deploy fails (no ghost ships) — `npm run assets:check`.
- **Tooling:** local `npm run assets:build` (gltf-transform via npx → combat + hangar, content-hashed) /
  `assets:push` (→ S3, `claude_admin`) / `assets:pull` (S3 → local) / `assets:check`. Generation stays
  **local** (needs the source + human judgment on decimation). **Implemented:** the schema field
  `ships.model_url_high` (migration 012 / PG bootstrap); the four `scripts/assets-*.mjs` + root
  `package.json` scripts (build verified end-to-end); the scoped **read-only IAM user `vega-assets-ci-read`**
  (S3 `GetObject`/`ListBucket` on the bucket only — verified read-allowed / write-denied) with its access key
  stored as GitHub secrets `ASSETS_AWS_ACCESS_KEY_ID`/`ASSETS_AWS_SECRET_ACCESS_KEY`; and the **CI deploy
  job** runs `assets:check` (guard) + `assets:pull` (S3 → `client/assets/ships/`, baked into the image)
  before the rsync/build, gated on the secret. All a **safe no-op today** (in-git primitives, empty
  `ships-combat/`). **Compression policy:** **combat glbs are vanilla** (no meshopt, no GPU-instancing
  extension, textures in their original format) so they load in the plain `GLTFLoader` AND preview in macOS
  Quick Look — size comes from decimation + small textures; **hangar glbs use meshopt + WebP** (the client
  wires `setMeshoptDecoder` so they load; too compressed for Quick Look — inspect in a web glTF viewer).
  **Remaining:** produce the first real sourced model (run build → push → paste URLs → commit). No ship has
  a `model_url_high` yet.

## 15. Hangar shop & stash (the "spend" side of the economy)

See `docs/plans/hangar-shop.md` for the full brief. Key choices:

- **Server-authoritative + transactional, from day one.** Buy/sell/equip/unequip all mutate credits +
  the persistent loadout via endpoints, each wrapped in a DB transaction (SQLite `BEGIN/COMMIT`; Postgres
  a checked-out client with `SELECT … FOR UPDATE` on the balance). This is the first place real money is
  spent, so no client trust and no double-spend / item-dupe window — even under repeated/parallel calls.
- **Stash = qty model**, keyed by `(player_id, kind, ref_id)`, `kind ∈ {component, weapon}` (two separate
  catalogs / id-spaces). One-row-per-instance is deferred until items gain individual state (upgrades/wear).
- **Unlock gate = a `shop_unlocked` flag, not progress.** The shop opens only after the player **clears the
  final level**. `current_progress` can't move past the last level, so reached-vs-cleared the final level is
  indistinguishable from it — hence a dedicated flag, flipped when `advanceProgress` runs with no next level
  (advance is only POSTed on a win, so that *is* the clear). On the first flip we **backfill the basic gun
  (id 1)** into the stash, and `replaceWeapon` briefings now deposit the replaced weapon too; the backfill
  uses `INSERT … ON CONFLICT DO NOTHING` so the two paths converge to exactly one owned gun (uniform whether
  or not the deposit already ran).
- **Required slots block take-off, they don't block unequip.** `hull`/`engine`/`thruster` are required;
  `repair` + weapons are optional. We **allow** emptying a required slot into the stash but report
  `launchable=false` + `missingRequired` on the active-ship payload, and the client greys out Take-off. This
  is simpler than a launch endpoint (there isn't one — the client just loads the level) and keeps the server
  authoritative on the *config* while the client enforces the *gate*. Optional equipped items (weapons,
  repair drone) **sell directly** from the hangar (no unequip step); required ones can't be sold while
  equipped (would strand the ship with no replacement).
- **Weapons slot by fire-group, components by type.** A component's slot = its `type` (`hull`/`engine`/…);
  a weapon's slot = its fire-group (`bullet`→`gun`, `rocket`→`rocket`), replacing the first mount in that
  group (or appending). Enough for the single-gun/single-rocket player ship; multi-mount curation comes with
  real weapon variants. **Same-id equip is net-zero** (the displaced item is always returned to the stash,
  even when it equals the installed id) so it can never silently lose or dupe an item.
- **`price` seeded 0 (economy inert).** A top-level `price` column on `components` + `weapons` (sibling of
  `weight`); sell = `floor(price*0.75)`, server-computed. With everything at 0 the flows work (buy free, sell
  for 0); real prices + a curated/`buyable` shop list + around-model slot icons slot in later.

---

## 16. Pause — client-side freeze (revisit for multiplayer)

The pause button freezes the fight by **skipping the simulation `update()` in the render loop** (the frame
keeps rendering, so the scene just holds). It's a single-player convenience: cheap, no state to snapshot,
and it doubles as a **mobile auto-pause** when the tab/app loses focus (`visibilitychange`/`blur`, gated to
touch devices) so a backgrounded fight doesn't run on.

**This does NOT survive the move to multiplayer.** In a shared, server-authoritative world a client cannot
stop time for everyone — "pause" there is a different feature (e.g. a host/lobby pause, a per-player
ready/AFK state, or simply disabled in live matches), and the **mobile-blur auto-pause becomes a
disconnect/AFK concern**, not a freeze. So when multiplayer lands: **re-evaluate pause** — decide whether
it's host-authoritative, lobby-only, or removed in PvP, and replace blur-auto-pause with an AFK/grace
policy. Until then the client-side freeze is the right, simplest thing.

---

## 17. Mission set-pieces — procedural decor in the COMBAT scene, not collidable

Mission environments (research station, asteroid field, freighter) are the **near "battle environment"
we fight around**, so they go in the **combat `scene`, lit from above by the combat sun** — the same way
we see the ships. This contrasts with §5 (the **planet & moons** live in `skyScene`, lit by a distant sun
with a day/night terminator; **stars** are unlit): those are the far cosmic backdrop, the set-pieces are
local. They sit **just below the combat plane** (close, so you fly over them with strong parallax like the
background asteroids — tops ~20 below the ships so they don't poke through / occlude), with **`fog: false`**
materials so they stay readable. (They started ~500 below as a backdrop; pulled close on playtest feedback.)

Key call: **being in the combat scene does NOT make a mesh collidable.** Hit-tests and AI iterate the
**gameplay entity arrays** (enemies / bullets / rockets / player), never "everything in the scene" — so a
set-piece added as a plain visual mesh and **left out of those arrays** is pure decor: bullets pass
through, the AI ignores it. To make an element collidable later (asteroid cover, a destructible base),
register THAT element in the relevant gameplay array (scope B).

They're **procedurally generated in code** (no CDN/`.glb`, no license; like the planet/moons/primitive
ships) for now — swap to real `.glb` later (§14). Data-driven via a `setpieces` array on the **map**: there
is **ONE shared world** (`home-system`) holding all the set-pieces at fixed, far-apart positions, so they
exist on every level/mission. A side mission only changes **where you fight** — its `center` spawns the
player + arena over the matching structure; the others sit at a distance. (An earlier iteration built only
the active mission's set-piece at its center; the player asked for a single unified map differing only by
combat location, so they moved back into the shared world — spread far enough apart that they don't pile
up.) They're rebuilt each run so the cruising freighter resets. The **off-center / drifting-arena** coupling is
**implemented**: the soft boundary/warp/mini-map compute relative to a movable `arenaCenter` (a side
mission sets it to its `center`); a descriptor `drift` `{x,z}` can also pan it with a `sync` set-piece
following — but **set-pieces are static today** (no mission turns drift on; it's for a future escort
mission). Three builders exist: `research-station`,
`asteroid-field` (irregular/cratered rocks + a mining station + a particle mining beam), and `freighter`
(fiery exhaust). See `docs/plans/mission-maps.md`.

---

## 18. Side missions — generated level descriptors, repeatable, no story advance

A "mission" **reuses the level engine**: it's the same `{ title, map, phases[] }` descriptor the campaign
uses, played by the same client `levelRunner` — emitted by a generator (`server/src/missions.js`) instead
of hand-authored. No new runtime. The board offers **three flavors** (mining / research / freighter) that
are **identical in difficulty/composition** and differ only in flavor text (i18n) — *not* Easy/Med/Hard
tiers (a deliberate call from `docs/plans/mission-generator.md`).

Two decisions worth recording:
- **Side missions don't advance the story counter** (`current_progress`). They're repeatable grind for
  credits to fund the shop; the descriptor carries `sideMission: true` and the client's `win()` banks the
  per-kill ×2 credits (via the existing `/api/games`) but **skips `unlockNextLevel()`**. Campaign levels
  still advance as before.
- **Reward = per-kill ×2, like a level** (2a). The generator is **stateless** and returns full descriptors
  inline; the client plays them directly. **Server-sealed per-mission rewards** (so the payout can't be
  forged) are deliberately deferred to the **integrity backlog** — it only matters once the sim isn't
  client-trusted (PvP). The endpoint is still server-owned + gated by `shop_unlocked` (same gate as the
  shop), so the *offering* is authoritative even though the reward isn't sealed yet.

The **UI is provisional**: 3 buttons top-right + a description panel (not the eventual richer hangar board).
Enemy mix/difficulty (the pirate gunner + the boss MG buff + the 2-boss finale) is
`docs/plans/mission-enemies-difficulty.md`. Richer objectives + per-mission set-piece environments + reward
sealing are later slices.

---

## Future ideas

sound · solid asteroids with bounce ·
bot behavior (evasion, arc flybys) · custom `.glb` models · multiplayer (WebSocket) ·
engine trails on enemies.
