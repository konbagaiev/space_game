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
- `W` (or `↑`) — thrust forward along the nose; `S` (or `↓`) — brake to a stop (no reverse, see §113).
- `A/D` (or `←/→`) — turn only the nose, without touching the movement vector.
- `Space` — fire.

Specifics:
- **Pure inertia:** no friction, no speed limit while thrusting — we fly along the accumulated
  vector, wherever the nose is pointing (you can drift sideways and shoot forward).
- **Passive braking:** if NOT a SINGLE control button is pressed — velocity smoothly
  decays (`IDLE_DRAG`). Hold a turn to aim and the inertia is preserved.
- **Arena boundaries (soft, since 2026-06-22):** the player may fly past ±360 freely — there is **no
  hard wall**. Earlier we zeroed the axis velocity at the wall, which read as a bug (the ship "stuck"
  to an invisible edge). Now a faint glowing edge marker shows where the battlefield ends; after the
  ship is **2 s continuously out of bounds** a HUD warning + countdown appears, and after **30 s** out
  the ship is **warped back to center** (velocity zeroed, reusing the enemy warp-in animation). A
  corner mini-map/radar gives spatial awareness. **Nothing is hard-clamped to the arena** — enemies
  chase the player out and spawn around it (no edge clamp), and bullets/rockets fly normally beyond
  ±360 (limited only by range/hits), so combat works fully out of bounds; ±360 only drives the
  boundary UI. (The old `clampToArena` clamp was removed.) See `docs/plans/arena-boundaries.md`.

Knobs: `ACCEL` (acceleration), `TURN` (turning), `IDLE_DRAG` (braking), `ARENA` (size),
`OOB_WARN_DELAY` (warning grace, 2 s), `OOB_RETURN_TIME` (auto-return, 30 s).

**Amendment (§39, 2026-07-03):** two clauses above are now qualified by the return-to-base flow. Enemies
spawn around **`arenaCenter`** (the mission zone center), **not** "around the player" — early in a fight
the player is at center so it reads the same, but after they wander the waves still originate at the zone.
And the **30 s OOB auto-warp is suspended while returning to base** (after the last kill), so a side mission
fought far from `(0,0)` can fly the whole way home without being yanked back. See §39.

**Amendment (§51, 2026-07-05):** the "no speed limit" clause above is now narrowed for the PLAYER
only — player velocity is capped at a flat `PLAYER_MAX_SPEED = 30` u/s (a movement-system constant,
not a per-engine stat). §2's inertia otherwise still holds: no friction while thrusting, passive
`IDLE_DRAG` braking on release, and free drift. **Enemies are unchanged** — they still clamp to their
per-engine `maxSpeed`. See §51.

---

## 3. Camera

- Nearly vertical (top-down view), **fixed angle**, does NOT rotate with the ship's turn.
- **Rigidly attached to the player** (`CAM_OFFSET`), without smoothing/lag — otherwise switching
  direction caused "jitter" and a slight "floating".

---

## 4. Background: three layers by depth

1. **Stars** — a distant static backdrop, glued to the camera (no parallax). Varying
   brightness (a power-law distribution: many dim ones, rare bright ones). **A bright ~2% are a
   separate point layer** (`makeStars`, `brightFraction`): for a ~1px point, raw color value caps at
   white and barely reads as "brighter," so the bright subset uses the three cues that actually work —
   **bigger size** (5 vs 1.4 px), a **soft additive glow sprite** (radial-gradient `CanvasTexture` → a
   round bloom, not a hard square), and a **near-white, full-luminance color**. Considered but rejected
   for now: a bloom post-process (`UnrealBloomPass`) — real HDR glow, but a whole extra pass that would
   entangle the two-pass sky/combat split and risk combat readability (§5), overkill for a backdrop.
   The bright layer is `depthTest: true` (the dim layer is `depthTest: false`) so the planet/moons
   occlude it; this is the transparency-friendly alternative to the "make stars opaque" fix in §5 — it
   keeps the additive glow from creeping onto the planet disk.
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

Live at **https://vega.tenony.com** — the long-standing canonical prod host; the cutover is done (the
old **https://space.bagaiev.com** is a retired legacy host that may still route — see §12). Docker on a
shared Hetzner VPS, behind Traefik, on the shared Postgres.
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
which **replaced** `space.bagaiev.com` — the cutover has long since completed and vega.tenony.com is the
established production host.

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

**A ship's look comes from its MODEL, never from a tint.** `applyShipModel` loads the `.glb` with
`tint: false` — the model's own materials/colors are what you see. **We do NOT recolor a ship by its
`stats.color`** (a brief experiment that tinted enemy models by `color` was reverted). When a design note
asks for a differently-colored enemy ("maroon medium", "crimson boss"), that means **author a model in
that color**, not set a `color` value. Consequence: enemies that currently *reuse* a base model
(`advanced_medium_pirate` → `heavy.glb`, `second boss` → `boss.glb`, `pirate gunner` → `fighter.glb`) look
like that base model until a distinct model exists — they're only mechanically different for now.
`stats.color` survives **only as metadata** for the off-screen edge markers + mini-map dots, the ship
explosion tint, and the placeholder primitive shown while the `.glb` loads — it never paints the model.

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
  `ships-combat/`). **Compression policy:** **combat glbs are built as light as possible for battle** —
  aggressive decimation **+ meshopt geometry compression** (the ship is tiny on a top-down screen, so heavy
  simplification is invisible); **hangar glbs keep full detail with meshopt + WebP**. Both use meshopt, so
  both need the client's `setMeshoptDecoder` (wired) to load; inspect either in a web glTF viewer.
  **First real sourced model shipped:** `enemy_1` (combat + hangar) is on S3 and wired to `basic enemy
  ship` (`model_url` + `model_url_high`) — the pipeline is proven end-to-end, not just a no-op.

**Model orientation is fixed in DATA (`stats.modelYaw`), not by re-exporting.** Our ships face `+Z`
(`makeShip`'s primitive nose); `applyShipModel` already auto-centers and auto-scales every loaded `.glb`
without trusting the asset's own transform, and **orientation joins that same set of runtime
normalizations**. A model exported facing the wrong way (the `enemy_1` combat+hangar pair was authored
nose-toward `-Z`, so the basic enemy flew engine-first) is corrected with a per-ship `stats.modelYaw`
(radians; `Math.PI` for `-Z`), threaded seed → `modelSpec(url, yaw)` → `applyShipModel`'s pivot. **Why
data over re-export:** one field corrects both the combat and hangar models (same source), needs no
Blender/source round-trip or S3 re-push, and survives swapping in a differently-oriented source later.
The knob is the documented escape hatch — it had silently regressed when ships went DB-driven
(`modelSpec` dropped `yaw`), which is how the bug shipped. **Prevention:** before `assets:push`, eyeball
the nose (= `+Z`) in a web glTF viewer (e.g. `gltf-viewer.donmccurdy.com`), then confirm in-game (see
`client/assets/README.md`).

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

## 19. Player-data reset — per-player DELETE vs full wipe, kept out of the catalog path

**Decision.** Two explicit reset operations, implemented per-backend (`resetPlayer` /
`resetAllPlayers` in `db.js` + `db_postgres.js`) and driven by a CLI (`server/src/reset.js`) +
a `reset-progress` skill — rather than the ad-hoc "delete `server/data/game.db`" we used before.

- **One player** uses targeted `DELETE … WHERE player_id = ?` on the player-scoped tables plus an
  `UPDATE players` back to the new-player baseline, then re-grants the starter ship. The **account,
  auth columns, active `sessions` and language preference are deliberately kept** — "reset progress"
  should leave the player able to log straight back in. It is *not* a row delete of `players`.
- **All players** clears every player-scoped table and lets the **catalog** (`ships`/`weapons`/
  `components`/`maps`/`levels`) re-seed on the next startup — never deleting catalog rows, consistent
  with the seeding-is-upsert rule ("Catalog seeding" in SUMMARY). SQLite has no `TRUNCATE`, so it
  uses `DELETE` + a `sqlite_sequence` reset; Postgres uses `TRUNCATE … RESTART IDENTITY CASCADE`
  (one atomic statement, FK order handled by `CASCADE`).

**Why not just delete the DB file?** That only works for local SQLite, loses the schema, and has no
production analogue. Backend-symmetric functions work identically against prod Postgres, are unit-
testable, and keep the destructive "all" path behind an explicit `--yes`. Backend is auto-selected by
`DATABASE_URL`, so the same command is safe locally (SQLite) and intentional in prod (only if set).

---

## 20. Camera zoom — scale the offset, not FOV / camera swap

**Decision.** Zoom multiplies the fixed `CAM_OFFSET` vector along its existing angle (clamped
`0.6–2.2×`, persisted in `localStorage`), rather than changing the camera FOV or swapping camera type.
This preserves the game's defining camera character — near-vertical, rigidly player-attached, no
rotation (DECISIONS on the fixed camera) — so the change is minimal and can't distort the view. Inputs
are platform-tuned: **PC** = wheel + ＋/− buttons, **mobile** = ＋/− buttons + two-finger pinch.

**Why offset-scaling.** FOV zoom warps perspective and the perceived ship size non-uniformly; a camera
swap (e.g. orthographic) would change the whole look. Scaling the offset just slides the same camera
nearer/farther along its fixed ray — identical framing, only the distance changes.

**Pinch vs. the steering stick.** Pinch listeners are on the canvas (`renderer.domElement`) and counted
via `e.targetTouches`, which only includes fingers targeting the canvas. The stick lives in its own
`#stick-zone` element (left 58%, `pointer-events:auto`) that captures its own touches, so a stick
finger is never counted toward the two-finger pinch. The wheel listener is likewise on the canvas, so
on menus (where the hangar/welcome DOM overlays the canvas) the wheel scrolls the shop instead of
zooming.

**Amendment 2026-07-04 (see §42).** Pinch listeners **moved off `renderer.domElement` onto `#stick-zone`**,
which now covers the **whole play area** (`inset:0`), not left 58% — because the stick zone would otherwise
swallow the two-finger touches it used to leave for the canvas. The `e.targetTouches` scoping is
**unchanged** and is exactly why a finger held on **FIRE/rocket** (sibling targets with their own handlers)
isn't counted toward pinch, so holding FIRE while steering is preserved — that reasoning still holds, only
the host element changed. Separately, the mobile zoom `+`/`−` buttons **no longer fire on a synthesized
`click`** (which the browser suppresses while a second touch point is active, so they were dead during
flight) — they fire on **`touchstart`** like FIRE/rocket; the `click` path is now mouse-only.

## 21. Color/lighting tuning — a dev tool (`?tune`), not a player setting

**Decision.** Dialing in the space-backdrop palette + lighting is done with a **dev-only** lil-gui panel
gated by `?tune` (dynamically imported inside the guard, so players never fetch it and the default build
is unchanged), **not** a player-facing brightness slider. The panel gives per-element control
(background, fog, sky ambient/sun, combat ambient/sun) and a "Dump palette → console" export of exact
`0x`-hex/intensity values, which are then **baked** into the seed/code by hand. A narrow, clamped player
"space brightness" setting can come later, but the dev panel is a prerequisite for choosing its safe
range anyway.

**Why.** A player slider can only move 1–2 global knobs, can't pick specific colors or read off exact
values, and risks washing out bullets/exhaust/markers against the carefully-tuned near-black palette —
which would break the two-pass lighting invariant (§5: combat and sky are lit by separate scenes so
ship readability is independent of the backdrop). The dev tool gives exact, per-element control with
zero combat-readability risk and produces paste-ready values. Fog + combat lights are still hardcoded in
`index.html` (sky/background already live in the `catalog_seed.js` map descriptor); a later refactor can
make the whole palette data-driven so the dump is one object to paste (color-tuning.md Step 4, deferred).

## 22. Audio — procedural Web Audio (synthesized SFX + generative music), no asset files

**Decision.** Game audio is **fully procedural**, built on the **native Web Audio API** — no library, no
audio files, nothing on the CDN, no licensing. SFX are **synthesized** (oscillators + filtered white
noise + gain envelopes); the background music is **generative** (sustained pad triads + an arpeggio over
a slow Am–F–C–G progression, scheduled with a look-ahead timer). It lives in `client/src/audio.js`.

**Why procedural (not Howler / not real files), resolving the two ROADMAP open questions:**
- **Native Web Audio over Howler.js** — same reason as every other dependency call in this project
  (built-in `node:sqlite`, hand-rolled SES SigV4, canvas planet textures, code-generated set-pieces): the
  browser API is enough and adds zero deps. Howler mainly buys autoplay-unlock + buffer juggling, which we
  don't need without files.
- **Synthesis over sourced audio files** — keeps the "**no binaries in git**, procedural-first" ethos
  (DECISIONS §14/§17). Real SFX/music would mean sourcing + **licensing** (CC0/CC-BY tracked in
  `CREDITS.md`), an audio sprite, and hosting on S3+CloudFront — real infra/curation work for a feedback
  prototype. Synthesis ships **immediately, in one PR, with nothing to find or host**. The trade-off is
  fidelity: the music is atmospheric/ambient, not a scored track, and SFX read "arcade" — acceptable (often
  fitting) for a top-down space shooter. (The user, unfamiliar with game-audio sourcing, chose this after a
  walkthrough of the three options — procedural / hybrid / all-files.)

**Swap path (kept open).** Every call site goes through `audio.sfx.*` / `audio.setScene(...)`, and all
sound flows through named buses (`sfxGain`, `musicGain`, an internal `moodGain` for the scene crossfade).
Replacing the generative music with a **real track is "add a `BufferSource` on `musicGain`"** — no call-site
changes. So the **hybrid option (procedural SFX + a real music file on the CDN)** remains a small follow-up
when a licensed track is chosen, without rework.

**Mechanics worth recording:**
- **Autoplay policy (cross-browser):** the `AudioContext` is created **lazily on the first user gesture**.
  Browsers disagree on which event counts — **Chrome accepts `pointerdown`; Safari (esp. iOS) ignores it
  for audio**, wants `click`/`touchend`/`keydown`, and stays suspended until a node actually *plays* in the
  gesture. So `unlock()` plays a one-sample **silent "kick" buffer** (the standard Safari wake), and the
  client listens on **all of `pointerdown`/`touchend`/`click`/`keydown` and retries on every gesture until
  `isReady()`** (rather than detaching after the first, possibly-rejected, attempt). Importing the module
  never touches the DOM/AudioContext, so it's safe under `node:test` (pure settings helpers are tested; the
  engine is browser-only). *(This was the cause of an initial "no sound on macOS/Safari" report.)*
- **Mix safety:** a `DynamicsCompressor` on the master bus + a **polyphony cap** (skip new SFX past ~28 live
  voices) keep machine-gun fire and stacked explosions from clipping. Enemy fire is low-passed and
  **distance-attenuated** so a swarm doesn't drown the player's own gun.
- **Music = game state:** `combat` mood (faster, with a bass pulse) during a live fight; `hangar` mood
  (slow, sparse) on menus / overlays / while paused. Transitions duck-and-switch over ~1 s.
- **Settings:** Master/Music/SFX **volumes** + Music/SFX **on-off toggles**, persisted to `localStorage`
  (keys `audio*`) and applied live. The audio-only **settings modal** (a ⚙ gear on the welcome/hangar
  screens + while paused) is the project's first dedicated settings menu; language/zoom intentionally stay
  where they are for now (scope kept to audio).

**Amendment (2026-06-23) — the swap path is now partly realized: a sampled SFX layer.** The synth stays the
default, but a weapon can now opt into a **real recorded sound**. Why hybrid-for-SFX (not just music): the
user disliked the synthesized gun reports and preferred sourcing real shots; samples and synth coexist on the
same `sfxGain` bus, so the mix safety (compressor + ~28-voice cap) and call sites are unchanged. Mechanics:
`audio.preloadSamples(map)` decodes content-hashed mp3s into a buffer cache (loaded once after unlock from
`client/src/sfx_manifest.js`); `sfx.shoot(kind)` plays the named buffer as a `BufferSource` with a subtle
per-shot pitch jitter (rapid machine-gun fire reusing one clip would otherwise sound robotic), and falls back
to the synth zap when the buffer is absent — so a missing/failed asset is never a hard error. Routing is
**data-driven**: a weapon's `stats.sfx` key (in `catalog_seed.js`) flows to the runtime weapon as `w.sfx`,
read at the fire site — no client hardcoding. **Distribution** reuses the ship-model pipeline (DECISIONS §14):
the mp3 bytes are content-hashed, pushed to S3 (`sfx/`), pulled same-origin into `client/assets/sounds/`
(gitignored, no binaries in git), and verified by the `assets:check` deploy guard. **Extraction stays manual
/ agent-driven** ("a source file + a comment" → pick + clean the shot with ffmpeg) rather than an automated
splitter, since judging which take and how much reverb tail to keep needs an ear. First sound: a CC0 glock
shot (Freesound) on the kinetic guns. Format **mp3** (smallest, universal `decodeAudioData`). Full process:
`docs/plans/audio-sample-pipeline.md`.

**Amendment (2026-06-24) — SFX routing normalized into DB tables (sound classes).** With more sounds it
became clear the client shouldn't name them inline ("100 different ships"). Routing now lives in two seeded
tables: **`sounds`** (`key → url + gain`) and **`sound_map`** (`(entity, class, event) → key`); each ship/
weapon carries a **`stats.class`**, and the client resolves at runtime via `sfxFor(entity, class, event)`
(fetched from **`GET /api/sounds`**). **This supersedes the manifest** — `client/src/sfx_manifest.js` is
gone; key→url is the `sounds` table (URL changes now need a re-seed/deploy, fine because volume is baked
into the files). Chosen the normalized tables over a per-entity field (owner's call) so adding ships/weapons
never edits client code. Full design + schema: `docs/plans/sound-classes-and-mapping.md`.

**Amendment (2026-06-24) — generative music dropped for sampled looping tracks.** The generative synth
music (chord-progression scheduler) is **removed**; background music is now **real looping mp3 tracks**,
one per scene, routed through the same `sound_map` under **`entity: 'scene'`** (so it's data-driven like
SFX, as the owner asked). The map allows **multiple tracks per scene** (PK widened to include `sound_key`)
played at **random** (no immediate repeat); the engine crossfades on scene change and loops a lone track.
Why drop generative entirely (owner's call): with curated tracks it added nothing and was dead code. The
"procedural-first / no asset files" stance in this section is now firmly relaxed for audio — both SFX and
music are curated CC0 samples on S3, the engine keeps only the synth SFX as a per-sound fallback.

## 23. Performance quality tiers — High / Balance / Performance

**Decision.** A player-facing **graphics quality** selector (3 tiers) in the settings menu, persisted in
`localStorage` (`gfxTier`). The knob table + persistence live in a pure, tested module
`client/src/graphics.js` (mirrors `audio.js`). **Default High** for everyone, except a **touch device's
first run defaults to Balance** so a phone doesn't open in the heaviest mode.

**Why this, and what each tier changes.** Profiling intuition: the perf overlay shows `draw 74 · tris
66k` — both trivial even for an entry mobile GPU. The real bottleneck on a weak phone (e.g. Galaxy A14)
is **fragment fill rate**: `setPixelRatio(min(devicePixelRatio, 2))` renders at up to 2× resolution, the
scene is drawn in **two full-screen passes** (sky + combat, §5), and **additive particles**
(explosions/sparks/exhaust/shockwave/bright-star glow) multiply overdraw. So the tiers turn the
fill-rate knobs, not geometry: **pixel-ratio cap** (2 / 1.5 / 1 — the dominant lever), **antialias** (on
/ off / off), **star density** (×1 / .6 / .35), **particle density** (×1 / .6 / .4 — fewer sparks, drops
the 2 middle fireball layers + the shockwave ring, thins the per-frame exhaust). Draw calls and triangle
count are deliberately **not** touched — they aren't the bottleneck.

**Applied via reload (not live).** Picking a tier saves it and **reloads the page**. The first cut tried
live-applying pixel ratio + density while leaving antialias for "the next reload" — but `antialias` is a
`WebGLRenderer` constructor argument (can't change on a live renderer), and rebuilding the GL context
mid-game is messy (re-uploading textures, and the zoom/pinch listeners live on `renderer.domElement`, so
a new canvas would lose them). The half-applied state was also confusing on a phone — a tester on a
Galaxy A03s reported "switching quality doesn't change anything," partly because antialias (a real cost)
never turned off without a manual reload. Reloading is the simplest guarantee: on startup the renderer is
built with the tier's `antialias` + `pixelRatio`, and `buildMap`/particle spawns read the tier's
star/particle scales from the start. Server-side progress is untouched, so a reload just returns to the
welcome/hangar. **Measurement caveat (documented for testers):** FPS is vsync-capped (≈60) and the
settings gear **pauses** the fight, so the perf overlay reads ≈60 on every tier *in the menu* — the
tiers' benefit is fewer dips below 60 in heavy combat and less thermal throttling over time, observed
**during gameplay**, not a higher peak in the paused menu.

**Follow-up (2026-06-25): `renderScale` + a particle ceiling + a resolution readout, after a tester
reported the same 15-25 fps in *combat* on BOTH High and Performance.** That is the key datum: dropping
Performance from High is a ~4× pixel cut (pixelRatioCap 2→1) plus AA/envMap/particles off, yet combat fps
didn't move. Two hypotheses survive: **(1)** the device's `devicePixelRatio` is ~1, so `min(DPR, 2)` and
`min(DPR, 1)` are *identical* — the cap never reduced pixels — or **(2)** the frame is **CPU-bound** (the
per-frame `update` + the DOM HUD/markers/minimap work, or the fixed two-pass overhead), where resolution
is irrelevant. The change tests both, measurement-first:
- **`renderScale` — TRIED AND REMOVED (2026-06-27); this bullet is a FINDING, not a live knob.** It was a
  tier knob (Performance 0.7; 1.0 = off on High/Balance) multiplying into `setPixelRatio`, rendering the
  backbuffer **below native** and letting the browser upscale the full-size canvas — the only lever that
  bites *below* a pixelRatioCap of 1, and therefore the first genuine fill-rate test of hypothesis (1). It
  answered the question and the answer was **no**: measured on two real GPUs (PowerVR GE8320, Mali-G52) a
  5.5–7× backbuffer-pixel cut moved fps by *nothing*, so it only blurred the image. **Resolution levers are
  a dead end here** — the wall is CPU draw-call submit plus the GPU/compositor governor, not fragment fill.
  The knob is gone from `client/src/graphics.js` and `graphics.test.js` asserts it stays gone. This finding
  is why §138's real-light pool is tiered by **per-fragment cost** (and by giving the weakest tier a clean
  off-path), never by resolution.
- **`maxParticles`** (Performance 300; `Infinity` off on High/Balance) is a hard ceiling on live additive
  particles (exhaust trail + sparks) — new emits are skipped over budget. Cuts both overdraw and
  per-frame JS, so it also helps under hypothesis (2). Layered on top of the existing `particleScale`.
- **Resolution readout:** the perf overlay appends the real backbuffer size
  (`renderer.domElement.width×height` = CSS × pixelRatio — `renderScale` is no longer in that product). A
  tester can see whether a tier change moved the pixel count *at all* — directly distinguishing hypothesis
  (1) from (2). A possible 4th "Potato" tier stays deferred-until-measured; see
  `docs/plans/perf-low-end-phones.md`.

**Follow-up #2 (2026-06-25): a `?dev` perf monitor + `perf_samples` telemetry — we were flying blind.** A
second tester (Redmi 10c) reported fps **independent of the graphics tier AND of scene load**: High gave a
*higher* fps than Performance (impossible if our knobs were the bottleneck — almost certainly a test-order
thermal artifact), and brief dips happened while simply turning with nothing on screen, not during a heavy
fight with two explosions + a station. That is the signature of **external governing** — thermal/DVFS clock
scaling + browser frame-pacing (vsync/compositor) + occasional GC — none of which our settings touch. A
single vsync-capped fps number can't prove it, so we built a measurement tool:
- **`?dev` (dev-gated, like `?tune`/`?debug`)** turns on `devPerf` in `index.html`: each frame it times the
  JS work in three buckets — **`update`** (the sim), **`dom`** (HUD + markers + minimap + OOB overlays),
  **`render`** (the two-pass `renderer.render` *submit* cost; true GPU exec is async and not directly
  measurable in a browser — `EXT_disjoint_timer_query` is disabled on mobile) — and once a second emits an
  aggregated sample (see SUMMARY for the shape) with a one-time device/GPU passport. **Off → zero overhead**
  for normal players (the per-frame `performance.now()` marks are guarded by the `DEV` flag).
- **The decisive read:** if `js.total` is far below `frameMs.p50` (e.g. 6 ms of JS in a 28 ms frame), the
  frame is **not CPU-bound** → it's external/GPU-governed and *no graphics setting will move it much*; if
  `js.total ≈ frameMs.p50`, it's **CPU-bound** → cut per-frame JS (throttle the DOM overlays, profile
  `update`). The `device.gpu` string finally tells us the real chip.
- **Storage:** a **dedicated `perf_samples` table**, not the funnel `events` table — perf samples are
  higher-volume, structurally different, and shouldn't pollute the funnel's allowlist/indexes or be wiped
  by a player reset. **`POST /api/perf`** is write-only over HTTP (no public read route); analysis is plain
  SQL. Sampling is once/sec, batched every ~5 s (+ `sendBeacon` on tab-hide) to avoid the monitor itself
  adding jank. We give a friend a `/?dev` link and read the rows later.

**Verdict from the first real capture (2026-06-25, ~500 samples, PowerVR Rogue GE8320 / A03s-class):** the
data settled the question — **this device is governed externally (GPU driver / thermal-DVFS / compositor),
not by anything our render path controls.** Three independent proofs: (1) **Performance renders 7× fewer
pixels than High** (597×268 vs 1601×720 — `min(dpr,1)×0.7` vs `min(dpr,2)×1.0`) yet **fps is unchanged** →
*not* fill-rate bound, so resolution levers (renderScale, a sky-pass throttle) can't help here; (2) **fps is
uncorrelated with scene load** (140 draws → 41 fps, 60 draws → 20 fps) → not draw/particle bound — the same
load yields wildly different fps across thermal windows; (3) **heap is flat at 11-18 MB** (limit ~1020) →
no memory leak / GC pressure. Steady-state JS is cheap (`update` 1.8 ms, `dom` 1.8 ms); the only sizeable JS
chunk is the **render submit ~12 ms**, and even that doesn't scale with draw count. **Consequence: stop
adding graphics tiers / fill-rate levers for this class — they're proven ineffective.** **Lever B (sky-pass
throttle) is cancelled** (fill rate isn't the wall). **`renderScale` was REMOVED (2026-06-27):** the initial
verdict kept it ("harmless, marginally cooler"), but on review it only **blurred the image for zero fps gain**
(the 5.5-7× pixel cut on Mali/GE8320 changed nothing), so it's a pure quality regression — gone. The resolution
levers that remain (`pixelRatioCap`, `antialias`) are kept as cosmetic-quality knobs, not perf knobs. The one real, addressable defect the data exposed is **startup**: the first 1-4 frames of
every session spend **0.8-2.2 s** in render submit (shader compilation + texture upload). **Confirmed on a
second device** (Mali-G52 tablet: ~0.4 s first-frame spike, but otherwise a healthy 44 fps vs the GE8320's
26 fps — and the same fill-rate-independence: a 5.5× pixel cut moved its fps by nothing either). So the
startup hitch is the one cross-device win — **now built** as a shader pre-warm (next paragraph).

**Shader pre-warm (built 2026-06-25).** `prewarmShaders()` compiles both scenes (`renderer.compile`) plus
two throwaway off-screen meshes that match the dynamic effect program keys (additive fog-off for
particles/explosions; opaque fog-on for bullets/rockets), so those programs are ready before the first
spawn instead of compiling lazily mid-fight. **Runs once, deferred two `requestAnimationFrame`s** after the
loop starts (a synchronous compile on the critical path would block first paint), during the menu — where
the player ship + sky already compile behind the welcome screen anyway. **Gated off under the `?debug`
inspection hook:** `renderer.compile` is very slow on the headless visual suite's software GL (swiftshader)
and, even deferred, blocked the main thread enough to flake the startup-sensitive scenarios (`01-smoke`,
`03-exhaust-trail` — proven: 5/5 clean vs ~2/8 flaky with prewarm on). Prewarm is perf-only and behaviorally
inert (it compiles shaders that would compile anyway), so skipping it under the test hook costs the suite
nothing; real users always get it. On-device effect is validated via the `?dev` first-sample render time.

**Measurement fix (same day):** `frameMs`/FPS were fed the sim's **clamped** `dt` (`min(getDelta, 0.05)`),
so `frameMs` saturated at 50 ms and the overlay FPS was *overstated* on slow devices — every GE8320 session
read `frameMs.max = 50` exactly. The perf path now reads the **raw** `clock.getDelta()`; the sim keeps the
clamp. (GPU execution time is still not directly measurable — `EXT_disjoint_timer_query` is disabled on
mobile — but a low `js.total` against a high *raw* frame interval is enough to localize "not our JS".)

**Particle batching — tried (2026-06-27) and REVERTED the same day.** The one data-supported CPU lever
(draw-call submit): trail + sparks were batched into one `THREE.Points` cloud each (Performance only). The
`?dev` telemetry was unambiguous: it **lowered per-particle draw cost** (~0.9 → ~0.5 draws/particle) but
**combat fps didn't move** (~22-24, governor-capped) and **`js.render` rose ~1 ms** with particles present —
the dynamic Points fields re-uploaded their whole buffer every frame (`needsUpdate` on the full capacity,
not the live range), which on this weak GPU cost more bandwidth than the handful of draw calls it saved.
Net: a custom-shader Points system + an un-prewarmed shader hitch for **zero measurable gain**. **Removed**
(per "if you reverted it, remove it"); the mesh-per-particle path is restored everywhere. This is the **5th
independent proof** that the GE8320's *combat* fps is set by its GPU/compositor governor, not anything we
render: (1) 7× pixel cut, (2) load-independence, (3) tier-independence, (4) flat across the whole tier table,
(5) a real draw-call reduction — all moved combat fps by nothing. **Conclusion: stop optimizing this
device's combat fps; the ceiling is hardware.** The shippable wins were the **shader pre-warm** (startup
freeze) and **`renderScale` removal** (sharpness) — both perceptible, both kept.

## 24. Wing-bank on turn — an inner "bank" group, not `rotation.z` on the root

**Decision.** The cosmetic wing-roll (ships tilt into a turn, capped 20°) is applied as
`bankGroup.rotation.z` on a **dedicated inner group** that holds each ship's visual children, **not** by
writing `rotation.z` on the ship's root group. The root keeps owning only `rotation.y` (heading),
position and scale. Roll is derived from the **actual per-frame heading change** (vs `turnRate*dt`), so
one code path (`updateBank`) covers keyboard, touch, warp-back and enemy AI turning. Cosmetic only —
no gameplay reads it.

**Why.** The root already carries `rotation.y = heading`; setting `rotation.z` on the *same* object makes
the final orientation depend on Euler order (yaw and roll would interact, and a roll could subtly skew the
heading the sim trusts). A child group whose local Z is the ship's forward axis (ships face `+Z`) gives a
**pure roll about the nose** that composes cleanly with the parent's heading yaw and the model's `model.yaw`
pivot — independent axes, no order risk. The primitives **and** the loaded `.glb` live in this group (so a
ship banks whether or not its model has loaded), and the spawn-grow / warp-back scale animations write the
**root** scale, so roll and grow don't interact. The sign (roll *into* the turn) was confirmed by eye /
the `13-ship-bank` visual scenario.

## 25. Per-ship model presentation — a grouped `stats.model` block, not loose keys

**Decision.** The per-ship model-presentation knobs live in **one JSON sub-object** `stats.model`
(`{ yaw, scale, scaleMul?, muzzle?, exhaust? }`) in the seed, not as loose top-level `stats.*` keys.
`yaw`/`scale` are the renames of the old `modelYaw`/`sizeScale`; `muzzle`/`exhaust` are new optional
overrides for the projectile/exhaust spawn point (group-local units, same as `userData.noseZ`/`tailZ`;
`null` → auto-derive from the glb bounds). The client resolves it through `shipModelCfg(s)`, which still
**falls back to the old loose keys** if `stats.model` is absent.

**Why.** Discoverability + a documented onboarding path: a grouped block has one place to look and one
doc (`docs/plans/adding-a-ship-model.md`) describing every knob, so adding a model is "fill this block,
no code reading"; future model-only knobs land here instead of growing the flat `stats` namespace. The
back-compat fallback costs nothing and protects against a stale/legacy `player_ships` row or a cached
`/api/ships` response carrying the old keys — so the migration of all 8 seed ships can't break an
already-loaded client. Muzzle/exhaust units are **group-local** (independent of `scale`, which is
re-applied at spawn via `mesh.scale.x`) so they read like the primitive's ±1.6 reference.

## 26. Force landscape on phones by rotating the whole body 90° (not a cover, not `orientation.lock`)

**Decision.** On a touch device held in **portrait**, the entire `<body>` is rotated 90° in CSS
(`body.rot`, `transform: translateX(100vw) rotate(90deg); transform-origin: top left`) and the game runs in
the **swapped** dimensions, so it renders horizontally on the portrait screen. `applyOrientation()` (boot +
`resize`/`orientationchange`) toggles the class and is the single place the renderer/camera are sized — to
`gameW()/gameH()` (innerHeight/innerWidth swapped when rotated). Pointer/touch coords are mapped into the
rotated frame by `toGame()` (the algebraic inverse of the transform); pinch distance is rotation-invariant.
The single Full-screen button is **gated to touch menus** (`body.touch.menu`) and a `fullscreenchange`
listener hides it once fullscreen (`body.fs`).

**Why.** Three options were considered: (a) a "rotate your device" cover, (b) `screen.orientation.lock`,
(c) CSS-rotating the content. (b) is not portable — it needs fullscreen and is **unsupported on iOS
Safari**, so iPhones would still render the landscape-tuned HUD squashed into portrait. (a) works
everywhere but is a dead-end screen the user must act on. The maintainer chose (c): the browser physically
cannot make its viewport wider than the screen, so the *only* way to actually play in landscape on a
portrait-held phone is to rotate the content — which (c) does, with no extra tap. The cost is real but
contained: the renderer/camera must size to swapped dims and touch math must be un-rotated (`toGame`), both
centralized so the rest of the code is oblivious. A key bonus: when auto-rotate is on and the user turns the
phone to true landscape, `rotated` flips to false and the **native** landscape viewport takes over
seamlessly — the CSS rotation only fills the held-portrait / rotation-locked case. The earlier cover +
`orientation.lock` + auto-pause-on-portrait approach was removed entirely (there's no unseen portrait fight
to pause once the game itself is landscape). The button stays menu-gated because the bottom-right corner is
the **rocket button** mid-fight; re-entering fullscreen is a menu-time action anyway.

*Open follow-up:* the rotation direction (game-top lands on the screen's right) is a one-line flip
(`translateY(100vh) rotate(-90deg)` + invert `toGame`) if it reads backwards on a real device.

## 27. Main Window redesign — drop "Hangar"; a fixed landscape layout with a dedicated ship preview

**Amendment (§97, 2026-08-09).** The dedicated right-column ship preview described here was removed; the
right column is now per-view content (mission list / Loadout panel). The viewer machinery it introduced
lives on in the work-zone item showcase and the Loadout viewers.

**Decision.** The between-battles / landing screen (formerly the **Hangar**) became the **Main Window**:
a fixed CSS-grid landscape layout (top bar | left menu | work zone | 25% ship-model preview) instead of a
centered, vertically-scrolling column. Two sub-decisions are worth recording:

**(a) The "Missions" menu unifies the campaign briefing with the side missions.** The old UI split them —
the campaign briefing was the big centered hangar text + Take-off, while the three side missions were a
separate top-right button board opening a modal. The redesign folds both into **one left-menu list**: the
campaign mission as the **primary** row, the side missions as **secondary** rows; selecting any row renders
its description + Take-off into the work zone. *Why:* they are the same kind of thing (a launchable mission
descriptor played by the `levelRunner`) presented two different ways; one list is simpler to build, one
work-zone renderer (`renderMissionView`) serves both, and the top-right corner frees up for the (inactive)
"Ships" entry. The old `#mission-btns` board + `#mission-panel` modal were deleted, not hidden.

**(b) The ship preview is a dedicated mini Three.js view, not a hole punched in the menu to the battlefield.**
The combat scene renders *behind* the menu's opaque gradient; showing the ship in the right 25% could either
(i) make that region transparent and position the player ship in the live scene, or (ii) render a separate
small scene. We chose **(ii)**: `#mw-ship` gets its own `WebGLRenderer` + scene + camera + light + a fresh
RoomEnvironment PMREM, loads the player's `_hangar` glb, and auto-rotates — its rAF loop gated to Main-Window
visibility. *Why:* (i) entangles the menu with the battlefield camera/arena state and the parallax backdrop
for a simple "turntable" of one ship; (ii) is self-contained, reuses the existing hangar glbs (no new asset
→ no `CREDITS.md` change), and is trivially start/stoppable so it costs nothing in a fight. The known cost is
a **second GL context** on weak phones; if profiling shows it hurts, the fallback is a **scissored second
viewport on the existing renderer** (same context), not a new renderer. See
`docs/plans/main-window-redesign.md`.

**Naming.** "Hangar" was dropped from on-screen text and from the code/DOM/i18n identifiers
(`showHangar`→`showMain`, `launchFromHangar`→`launchCampaign`, `openHangarShop`→`openBay`, `#hangar`→
`#mainwin`, `#hangar-go`→`#mw-go`, …). The i18n **string keys** (`ui.shop.*`, `ui.hangar.default`) were left
alone — renaming keys ripples through every locale file for zero user benefit. The death-overlay button keeps
`ui.gameover.back_to_hangar` for the same reason.

## 28. Item (component/weapon) 3D models — hangar-only icons, reuse the ship pipeline & prefix

**Decision.** Components and weapons get the **same** `model_url` / `model_url_high` columns + `stats.model`
convention as ships, fed by the **same `assets:*` pipeline**. But we wire **only `model_url_high`** (the
hangar/CloudFront glb) and leave `model_url` (combat/same-origin) null, and the item hangar glbs reuse the
existing **`ships-hangar/`** S3 prefix rather than a new `items-hangar/` one.

**Why.** Items are **never rendered in the combat scene** — there they're part of the ship — so an item
model is a **menu-only icon** (shown spinning in the preview). Wiring the combat path would mean baking item
glbs into the deploy image (the CI `ships-combat/` pull/bake step) for no gameplay use, and a new S3 prefix
would mean pipeline surgery (`assets-config.mjs` + push/check) for what is just "another high-poly menu glb".
So we reuse the ship machinery wholesale and only paste the hangar URL. The build still *emits* the unused
combat glb (harmless). Minor naming wart (a machine-gun glb under `ships-hangar/`) accepted over churn;
flagged as a future cleanup. The hangar **ship preview** was generalized to a ship-or-item viewer
(`setPreviewModel`) rather than standing up a second Three.js context. See
`docs/plans/component-weapon-models.md`.

## 29. Briefing item showcase — server-derived `showcase {kind,id}`, client-derived on reload

**Decision.** A level briefing that **grants gear** shows that item's spinning 3D model in the preview. The
server attaches a **`showcase {kind,id}`** to the briefing it returns, **derived from the briefing's own
grant actions** (`replaceWeapon`→weapon, `installComponent`→component; an explicit `briefing.showcase` in the
seed overrides). It sends only `{kind,id}` — not a model URL — because the client already has the catalog
(with the URLs). The **client also derives** the same `{kind,id}` from the briefing `actions` on the
page-reload landing path.

**Why.** The hard constraint: a briefing's `actions` run **server-side** and the advance response
deliberately strips them, returning only `{textKey,text}` — so the client can't, by itself, know what an
*advance* granted. Deriving `showcase` from the actions server-side (single source of truth, no seed
duplication) and shipping `{kind,id}` solves that without a new endpoint (it rides the existing response).
The reload-landing path is different: there the client receives the **raw level descriptor** (which still
carries `actions`, but no server-computed `showcase`), so the client derives the same mapping itself — one
small helper makes **both** entry paths show the item. Sending `{kind,id}` (not the URL) keeps the server
ignorant of asset URLs (they live in the catalog/seed the client already loads). See
`docs/plans/briefing-item-showcase.md`.

**Update (placement).** The granted item now renders in a **dedicated viewer in the work zone**
(`#mw-item`) at **full size** (`ITEM_SHOWCASE_SCALE = 1`), **not** in the right-column ship preview — the ship
preview keeps showing the player's ship at all times. The original plan (decision #2 in
`briefing-item-showcase.md`) put the item *in* the right preview, replacing the ship; the maintainer asked
for the item beside the briefing text **without** displacing the ship. **Layout (final):** the canvas is
**floated into the bottom-right corner of the mission text, with the text wrapping around it** — it lives
**inside `#mw-mission-desc`** next to a `#mw-mission-text` span and a 0-width strut (`#mw-item-strut`), both
floats preceding the text in source. Bottom-right-with-wrap is the **classic CSS strut-float trick**: the
strut floats right with `height: calc(100% − var(--gun-h))` to reserve the **top** of the right column (text
flows full-width past the 0-width strut), then the canvas `clear: right` drops **below** it into the
bottom-right corner — the text then wraps full-width above the item and down its left side. (A plain
`float: right` can't anchor to the bottom; absolute positioning would pin the corner but kill the text wrap —
the strut gives both.) Earlier iterations were rejected by the maintainer: a full-width block stacked above
Take-off **stole the description's vertical space and pushed the mission text off-screen on phones**; a
half-width `flex` block (bottom-left, then bottom-right) **occupied a full horizontal band** instead of
tucking into the corner. The viewer
machinery was factored into `buildModelViewer`/`startViewer`/`stopViewer`/`resizeViewer` +
`setViewerModel(viewer,…)` so the same code drives **two** small GL contexts (ship preview + item showcase);
the second is built lazily and its rAF loop is stopped on launch / when the bay view hides the mission
canvas, so it costs nothing outside an active briefing.

## 30. Keep processes simple until a real problem forces otherwise (YAGNI for workflow)

**Decision.** When designing *workflow / tooling / process* (not just code), default to the **simplest
thing that works for how we operate today**, and only add structure once we've hit a concrete problem —
or a problem is clearly, imminently likely. We deliberately do **not** pre-build for hypothetical future
scale.

**Why.** Recorded while designing the multi-agent development pipeline (`docs/plans/multi-agent-pipeline.md`,
the `feature-pipeline` skill + planner/critic/implementer/reviewer agents). Two concrete calls made under
this principle:
- **Feature IDs = timestamp prefix `YYYY-MM-DD-HHMM-slug`** (e.g. `2026-06-30-1612-laser-cannon`), used for
  the plan filename, git branch, worktree dir, and CHANGELOG bucket. We **rejected** a sequential-number +
  shared `REGISTRY.md` ledger: sequential numbers only collide under *parallel allocation*, which is a
  multi-author concern, and the ledger added moving parts (allocation commits, `[skip ci]` hygiene,
  rebase-before-write) we don't need yet. A timestamp is collision-free for a single author and needs no
  central state.
- **Single-author assumption is explicit.** We are not onboarding other developers now; when that changes,
  *that* is the trigger to revisit ID allocation, locking, and review gating — not before.

**How to apply.** Before adding a registry, a locking scheme, a queue, a config layer, an abstraction, or a
multi-step process step, ask: *which real, present problem does this solve?* If the answer is "a future one
that may not arrive," don't build it — note it as a future trigger and move on. This applies to the agents
and the pipeline skill themselves: grow their rubrics from **actual** feedback (the retro step), not
speculation.

---

## 31. Client split into native ES modules — buildless, no bundler

**Decision.** Break the ~3500-line inline `<script type="module">` in `client/index.html` into cohesive
ES modules under `client/src/`, loaded **natively by the browser with no build step**. `three` keeps
coming from the CDN **importmap** in `index.html`; each module does `import * as THREE from 'three'` and
the browser resolves it through that same importmap. The server keeps serving `client/` as plain static
files — no Vite, no bundler, no transpile in CI/deploy.

**Why.** The project ethos is plain static hosting (the server just `express.static(clientDir)`); adding a
bundler would put a build artifact between source and what ships, plus a build step in CI and deploy that
doesn't exist today. Native ESM over HTTP/2 is fine for our size (the modules are small, same-origin; the
one CDN fetch for `three` is unchanged). The cost — many small module requests — is acceptable now; if
startup latency ever measurably regresses we can revisit Vite *then*, not speculatively (see §30).

**The `G` state-bag pattern.** Native ESM shares an exported `const` array/object **by reference** (mutating
its contents is visible everywhere) but an exported `let` scalar is a **read-only view** in importers (you
can't reassign it from another module). So: entity collections + the catalog are exported `const` in
`state.js`; **reassigned cross-module scalars** (`player`, `gfx`, `sky`, `stars`, `arenaDrift`, …) live as
properties on a single mutable bag `export const G = {…}` — write `G.player = …`, read `G.player`. Scalars
are promoted onto `G` lazily, as the domain that owns them is split out, rather than all up front. Engine
singletons (`renderer`/`scene`/`camera`/lights) are exported `const` from `engine.js`.

**Rollout.** Incremental — one safe slice per commit, the existing unit + visual suites green between each
(the visual suite asserts on simulation state and zero page errors, so a broken import surfaces immediately).
See `docs/plans/client-code-structure.md` for the slice sequence and the target module layout.

---

## 32. Password reset is enumeration-safe (always 200), auto-verifies + purges sessions

`POST /api/auth/forgot-password` **always** returns `200 { ok:true }` and the client shows an identical
"if that email has an account, a reset link is on its way" confirmation **whether or not the email exists**.
This means the endpoint can't be used to probe which emails have accounts (a login/register endpoint that
distinguished "no such account" would leak that). The accepted cost: a user who mistypes their email gets
no "no such account" feedback — they just never receive the mail. Standard practice, and consistent with
DECISIONS §30 (keep it simple).

The emailed `/?reset=TOKEN` link, when consumed, **marks the email verified** — clicking it already proves
the player controls that inbox, so requiring a separate verification afterward would be redundant. Reset
also **invalidates every existing session** for the account (`deleteSessionsForPlayer`) before opening a
fresh one for this device: if the reset was prompted by a compromised/leaked session, that session is
killed as a side effect.

**Residual timing side channel (accepted).** A request for an *existing* email awaits the SES round-trip
(and the scrypt-free token store) before responding 200, while a *non-existent* email returns almost
immediately — so response latency can still leak account existence to a determined observer. We accept
this: it mirrors the existing verification/resend flow, and closing it (async-queueing the send, or padding
to a constant-time response) isn't worth the added complexity per §30. Revisit if abuse appears.

---

## 33. itch.io "Online" export — a static client pointed at the prod API, bearer auth, reflect-any CORS

We ship an **itch.io HTML5 export** as an *online* build: a static ZIP served from itch's CDN that calls
the **existing production backend** at `https://vega.tenony.com`. Several sub-choices:

**Online build, not an offline bundle.** itch serves only static files, so a fully offline build would need
the whole server + DB bundled client-side (a second codebase) and would carry no shared progression. Pointing
the static client at the existing prod API reuses one backend and one player database — guest and account
progress sync with the web deploy. The cost is a hard runtime dependency on `vega.tenony.com` being up, which
is already true for the web deploy, so it's acceptable.

**Bearer tokens over `SameSite=None` cookies for cross-origin iframe auth.** A third-party cookie inside an
iframe is blocked/unreliable across modern browsers regardless of `SameSite=None; Secure`, and flipping the
primary same-origin deploy to `SameSite=None` would weaken its CSRF posture for no gain. Instead, login/
register/reset **also** return the raw session token in the JSON body; the client stores it in
`localStorage['authToken']` and sends it as `Authorization: Bearer`, which `sessionTokenFromReq` accepts
(header first, then the cookie). This works cross-origin deterministically. Trade-off: a `localStorage` token
is XSS-exposed like any SPA token — accepted (game progress only, no sensitive data). The change is
**additive**: the cookie path is untouched for the same-origin site, and no `db.js`/`db_postgres.js` change
was needed (the token, its SHA-256 hashing, and the session table already exist), so SQLite/Postgres parity
holds by construction.

**Reflect-any CORS is safe here because credentials are off.** The `/api` CORS middleware reflects the
request `Origin` and deliberately does **not** set `Access-Control-Allow-Credentials`. With bearer (not
cookie) auth cross-origin and no credentials allowed, reflecting an arbitrary `Origin` can't be leveraged
for a credentialed cross-site request, so an allowlist of itch's *rotating* CDN subdomains
(`*.itch.zone`/`*.hwcdn.net`) would add maintenance for no security benefit.

**API base is baked at build time, not detected at runtime.** `client/src/api-base.js` exports `API_BASE`
(empty = same-origin); `scripts/build-itch.mjs` overwrites only the *staged* copy with the prod origin. No
hostname sniffing (itch's rotating subdomains + empty `file://` hostname make runtime detection fragile), no
query-param/config toggle. The build uses the system `zip` binary (no new dependency) and is manual, not
wired into CI (§30). Guest play always works on itch via the localStorage `playerId`; account login now works
via the bearer token.

---

## 34. Client device support — two independent axes (`input` / `form`), phased over two iterations

**Decision.** Replace the single `isTouch` boolean with a two-axis device model in one module
(`client/src/device.js`): **`input` = `touch | mouse`** (capability, ~constant per session — drives
interaction-bound behavior: touch controls, auto-pause on blur, fullscreen-on-tap, hover-vs-tap reveal)
and **`form` = `phone | tablet | desktop | desktop-lg`** (derived from the viewport's longest edge,
recomputed on resize — drives layout/CSS + forced rotation). Each axis has a single source of truth and
projects onto mutually-exclusive body classes (`input-touch|input-mouse`, `dev-phone|dev-tablet|
dev-desktop|dev-desktop-lg`); `body.touch` is kept as a compatibility alias so existing touch CSS isn't
rewritten. Breakpoints (longest edge): `phone < 900 ≤ tablet < 1280 ≤ desktop < 1920 ≤ desktop-lg`.

**Why two axes.** `isTouch` conflated capability with size. New profiles (tablet, foldable, big monitor)
are almost entirely a *form* concern, not an *input* one. Separating them means a resize recomputes only
`form` (it never re-inits touch controls), and adding a profile = one `classify()` rule + its CSS.

**Why two iterations.** Iteration 1 (this change) builds the architecture + a set of desktop-browser CSS
fixes to the Main Window ONLY. It deliberately does **NOT** implement full resize-driven adaptation of
every screen — that is iteration 2. The structure is built so iteration 2 drops in cleanly: `form`
already recomputes on resize/orientationchange (via `applyDevice()` inside `applyOrientation`), and
layout keys off `body.dev-*`, never raw `isTouch`. Guard rail: right structure now, full adaptation
deferred — not over-built, not under-built.

**No `isTouch` re-export from `engine.js`.** The plan allowed one "for back-compat", but every consumer
(`state.js`, `sim.js`, `mainwindow.js`, `welcome.js`, `main.js`, `engine.js` itself) migrated to
`Device.hasTouch`, so a re-export would be dead code (§30). `canHover` (`matchMedia('(hover: hover)')`) is
exposed on `Device` for iteration 2 but **not** wired to anything yet — the shop `(i)`/hover reveal stays
on the `body.touch` alias for now.

---

## 35. Perf overlay is dev-only, reusing a sticky `?dev` flag (not a new one)

**Decision.** The top-center FPS/service string (`#perf`) is a **diagnostic tool**, not player-facing game
info, so it's **hidden by default** (`#perf { display: none }`) and revealed only for developers via
`body.devmode:not(.menu) #perf`. Rather than invent a new flag, it **reuses the existing `?dev` flag**
(which already gates the `devPerf` perf telemetry) — one shared source of truth, `client/src/dev.js` /
`isDev()`, drives the overlay visibility, the `●dev`/JS-heap suffix, and the telemetry. The flag is made
**sticky in localStorage** (`devMode`): a truthy `?dev`/`?dev=true`/`?dev=1` turns it on and remembers it;
an explicit `?dev=false`/`?dev=0` turns it off and clears it; no `dev` param → the stored flag decides.

**Why.** Players never asked for a load meter; showing it clutters the HUD and confuses. Reusing `?dev`
avoids a second flag to reason about (cf. §21, the `?tune` dev-tool convention) and keeps things simple
(§30 — no new endpoint, no in-game toggle). Sticky-with-off-switch means a developer types `/?dev` once
instead of re-appending it every load, while `?dev=false` gives a clean, explicit way out. The
tri-state parse also **drops the old loose `location.search.includes('dev')`** substring match (which
matched `?developer` and any `…dev…` param). `?tune`/`?debug` stay independent — `?dev` doesn't umbrella
them.

**Class name.** The reveal class is `body.devmode`, deliberately **not** `body.dev`: the device-profile
classes already use a `dev-` prefix for *device form* (`body.dev-desktop`/`body.dev-phone`, §34), so a bare
`body.dev` would conceptually overload that prefix. `devmode` keeps the diagnostics gate unambiguous.

---

## 36. Admin panel — env-gated HTTP Basic Auth (404 when unset); referrer as one opaque JSON column

**Decision.** The `/admin` dashboard (server-rendered players + per-player game aggregates) is protected by
**HTTP Basic Auth** with credentials from the server `.env` (`ADMIN_USER` / `ADMIN_PASSWORD`, compared with
`crypto.timingSafeEqual`) — **no admin user table, no bespoke login page, no session**. When either env var
is unset the route returns **404** (admin disabled — indistinguishable from "no such route"), so it is never
wide open on prod even if someone forgets to configure it. The referrer captured per player is stored as
**one opaque nullable `TEXT` column** (`players.referrer`, a compact JSON string of `document.referrer` +
`?ref=`/UTM), **written once on row creation** and never overwritten, **not** parsed into per-param columns.

**Why.** For a single maintainer eyeballing "who registered and how they play" (§30 — keep it simple), Basic
Auth over TLS is the least machinery that is safe: the browser handles the credential prompt, there's no
new auth surface to maintain, and the 404-when-unset default fails closed. A dedicated admin account
model / RBAC would be gold-plating for one operator. The referrer is for **eyeballing, not querying** —
funnels/UTM analytics are out of scope — so a single verbatim JSON blob (truncated to 512 chars, rendered
raw in the panel) avoids schema churn and per-param columns that nothing yet reads. **Write-once at INSERT**
(never on the `last_seen` UPDATE) gives "first-referrer-only" for free and means the many later auto-register
calls (active-ship/level/games) can keep passing no referrer. Basic Auth is also written to guard any future
`/api/admin/*` JSON endpoints, though none are added now. `/admin` is mounted **outside `/api`**, so the
`/api`-scoped CORS never applies — it stays same-origin only.

---

## 37. A prod model/asset hash change also needs a `publish-itch` (itch bundles glbs, reads catalog live)

**Context.** The itch.io export (§33) is an *online* build: its ZIP **bundles the combat `.glb` files**
(served same-origin from itch's CDN) but fetches the **ship catalog LIVE** from `vega.tenony.com`
(`API_BASE` baked by `scripts/build-itch.mjs`). Those two facts are independently sensible but **coupled**:
the bundled glbs are a point-in-time snapshot, the catalog is always current.

**Consequence (the bug this documents).** When a model changes on prod via the ship-model pipeline (§14),
its **content hash changes**, so the live catalog immediately serves the *new* hash. The already-published
itch ZIP still contains the *old* glb, so the itch client requests the new hash from itch's CDN → **404 →
generic primitive cone** for exactly the changed ships (other ships are unaffected). This bit us on the
basic-pirate metallic-hull change (2026-07-02): the fighter + pirate gunner showed cones on itch until
re-published.

**Decision.** Any model/asset change that reaches prod is **not done until the itch build is re-published**
too — run `/publish-itch` (`assets:pull` → `build:itch` → `butler push dist/itch-staging
bagaiev/vega-sentinels:html5`) after the prod deploy. This is now step 11 + a checklist item in the
`update-ship-model` skill and a lesson in the feature-planner's guidance, so it can't be forgotten.

**Alternatives rejected.** (a) *Rewrite `modelUrl` to absolute prod/CDN URLs in the itch build* so itch
always pulls the exact glb the live catalog names — would make itch immune to this drift, but adds a
build-time URL rewrite + a hard runtime dependency on the prod origin (or CDN) for *every* combat model
(today they're same-origin/offline-cacheable on itch), and re-introduces CORS for model fetches. Deferred
as over-engineering (§30) until model changes are frequent enough to justify it. (b) *Bundle the catalog
into the itch ZIP too* — kills shared progression / live balance updates, the whole point of the online
build (§33). So the accepted cost is a manual re-publish step, enforced by the skill + planner guidance.

## 38. First `.glb` set-piece — standalone loader in `world.js`; the exhaust made server-configurable

**Context.** The "save the transport" freighter was the project's only fully procedural mission set-piece
(a stack of `BoxGeometry`: spine + bridge + window + 4 cargo containers + engine block + 4 nozzles). We
replaced its hull with a real sourced `.glb` (CC-BY "Freighter - Spaceship"), keeping the animated fiery
particle exhaust.

**Decisions.**
1. **The freighter is the first `.glb`-backed set-piece.** Every other set-piece stays procedural; this is
   the one that gains a model. It loads `freighter_combat` (auto center/scale/`yaw`-oriented like a ship
   model), with the exhaust built synchronously so a trail shows during the async load — and **no
   procedural-box fallback** (on load error the exhaust just keeps running).
2. **Standalone loader in `world.js`, not shared with `applyShipModel`.** `makeFreighter` reuses only the
   exported shared `gltfLoader` instance (so meshopt-compressed combat glbs decode) plus the same
   `Box3` center/scale/`yaw` normalization pattern — but writes its own small load path. `applyShipModel`
   is coupled to combat-ship semantics the freighter doesn't share (`bankGroup`, tint, `SHIP_MODEL_LEN`
   normalization, `noseZ`/`tailZ` userData for muzzle/exhaust spawn), so generalizing it would add coupling
   for one caller. Kept simple (§30).
3. **The fiery exhaust became a spec/server-configurable effect.** Its palette (`hot`/`mid`/`end`) and
   particle params (`count`, `len`, `size`, `speed`) are read from an **optional `exhaust: {…}` object on
   the set-piece spec** in `catalog_seed.js`, delivered to the client via the existing map descriptor
   (server → `/api/maps/:name` → `buildMap` → `makeFreighter`), falling back to the current hardcoded fiery
   look. This is the deliberate, **light** seed for future server-driven model effects — **no** effect
   registry, multiple effect types, or generic abstraction was built (§30). Because the exhaust is built
   synchronously but the model loads async, the emitter origin (`emit` `Vector3` + `spread` scalar) is
   **mutable**: the loader overwrites it from the model's real group-local rear bounds once resolved, and
   the update loop reads it each frame — so fire streams from behind the actual engines.

**Alternatives rejected.** (a) *Generalize `applyShipModel`* to serve both ships and set-pieces — rejected
as coupling for a single extra caller (see decision 2). (b) *Build an effect framework now* (effect
registry / multiple effect types / per-particle turbulence) — rejected as speculative gold-plating (§30);
made only the one existing exhaust spec-configurable with safe defaults.

---

## 39. Autopilot + return-to-base mission end

**Context.** Every mission (campaign L1–4 + the three repeatable side missions) used to win the instant the
last enemy died — which for side missions ended awkwardly far out at the mission zone, and gave the shared
world's base station nothing to *do*. We added a **base station** `.glb` set-piece at the world origin `(0,0)`
and made **all** missions end by flying home to it.

**Decisions.**
1. **One `levelRunner` intercept covers everything.** Both campaign levels and side missions play through the
   same `levelRunner` (`sim.js`). The `win` phase's `this.win()` is replaced by `this.beginReturn()`, so *every*
   `event: 'win'` phase becomes return-to-base with **no per-level or per-descriptor edits**. The phase's existing
   `delay` (watch the boss explode) still runs first; the return prompt appears after it. Rejected: per-mission
   descriptor fields — needless duplication.
2. **The station is below-plane, NON-collidable decor** (maintainer's explicit call), like the freighter (§17):
   no hit-tests, no gameplay array, ships fly *over* it. It is raised closer to the plane than the freighter
   (center `y = -42` vs the freighter's `-48`) so it reads clearly top-down. The source model is tall
   (y ≈ 0.78 of its longest axis), so with `BASE_STATION_LEN = 100` the normalized half-height is ~39; at
   `y = -42` the station's **top sits at ~y = -2.9**, safely below the ships' `y ≈ 0.6` (§17 — set-piece tops
   stay below the ships so they never occlude). NB: the plan's strawman defaults (`LEN 160`, `y = -30`) would
   have breached the plane at `y ≈ +32`; the implementer lowered them per the §17 check. "Reached" = **horizontal
   (xz) distance to `(0,0)` ≤ `BASE_ARRIVE_RADIUS` (45u)**, just inside the station's ~50u footprint half-width.
3. **The dock is a mandatory explicit station click.** Proximity **alone never wins**. Victory requires
   `G.autopilot.active` (set **only** by the station click via `engageAutopilot()`) **and** the ship within
   `BASE_ARRIVE_RADIUS`. `checkArrival()`'s `!G.autopilot.active` guard is load-bearing: it means a manual or
   *cancelled* approach never completes the mission — the player re-taps the station to resume the dock. Standing
   next to the station without clicking never finishes; clicking while already inside the radius completes on the
   next frame. This also makes any spawn-on-station insta-win impossible. Rejected: a proximity auto-win (would
   fire on a manual fly-by / spawn overlap).
4. **Autopilot uses a kinematic symmetric-decel brake.** The passive release-brake (`IDLE_DRAG`) is *exponential*
   decay (`vel *= 1 − 0.8·dt`) — it asymptotes and never fully stops — so a literal "brake at the midpoint" can't
   stop cleanly at the station. Instead autopilot: (1) brakes to a full stop, (2) rotates the nose to face the
   station, (3) accelerates at max, then (4) begins a **constant-rate brake (decel == thrust `accel`)** once the
   remaining distance ≤ the stopping distance `v²/(2·accel)`, so velocity reaches ~0 right at the station.
   Rejected: the literal brake-at-midpoint (can't stop under exponential drag).
5. **Any control input cancels autopilot** (literal reading): movement (`W/S/A/D`, arrows, touch stick), fire
   (`Space`/FIRE), and rocket (`F`/🚀) — the same frame, control returns to the player. The station tap is a
   canvas raycast, ignored on HUD buttons (separate DOM elements over the canvas).
6. **Enemies spawn around `arenaCenter`, not the hero** (`ship-build.js`, same 70–130u ring) so waves originate
   at the mission zone even after the player wanders. See the §2 amendment.
7. **The OOB warp-back is lifted after the last kill** (`&& !G.returnToBase`) — required so a side mission fought
   far from `(0,0)` can fly the full distance home instead of being warped back mid-return.

A translucent **blue** homing arrow (anchored to the ship, re-pointed at the station each frame) + a centered
**"Sector cleared — return to base"** HUD hint (i18n `ui.return.hint`) show from the last kill until victory.

**Amendment (2026-07-03):** the station was moved off the world origin to **`(-20, -42, -20)`** (screen top-left
of the arena center) for composition. This is safe because the dock/win never hard-codes `(0,0)` — `checkArrival`
measures the horizontal distance from the player to `G.baseStation.obj.position` (the station's live position),
and the homing arrow already points at that object. So references to "`(0,0)`" above should read as "the station's
position". `pos.y` is unchanged (−42), so the §17 vertical-extent guarantee still holds.

---

## 40. Grab (tractor) component + enemy equipment drops — units, no hulls, victory-only, client-trusted

**Context.** Added a light loot loop on top of the kill→credits economy: enemies sometimes drop a piece of
their gear as a metal-box, a new **Grab** component pulls in-range drops to the ship, and collected drops
deposit into the Stash. A handful of design calls were resolved up front (see the plan
`docs/plans/2026-07-03-1412-grab-tractor-drops.md`).

**Decisions.**
1. **World units, not a "cell" abstraction.** Grab **range = `strength`** (units) and **pull speed =
   `(strength/2)·(10/itemWeight)`** (u/s). Concrete formulas over an invented grid: light parts pull fast
   (weight 2 → 25 u/s at strength 10), heavy parts slow, and a zero/missing weight falls back to 10 so the
   sim never divides by zero (defensive — the audit found no weightless item).
2. **The base grab's short range (10) is intentional; the Advanced grab (20) is the real tractor.** The base
   is a "vacuum assist" that snaps loot in over the last few units (enemies die ~14–25 units away, so you
   still fly most of the way onto it); the upgrade is the incentive. Not a bug — do not "fix" it.
3. **`REFERENCE_MASS` bumped 48 → 50 to absorb the base grab's weight.** The player now auto-owns the base
   grab (weight 2). Leaving `REFERENCE_MASS` at 48 would knock ~4% off the documented baseline accel 10 /
   turn 2.0; setting it to the new starter-loadout sum (50) keeps `massFactor = 1` at the baseline. A
   **deliberate neutralization, not a silent nerf** — the player's feel is unchanged.
4. **Hulls are NEVER droppable.** `pickLoot` draws only from the enemy's engine/thruster components + mounted
   weapons — never `e.hull`. A looted 550-HP boss hull would be equippable-from-stash and wreck progression.
   Engines/thrusters/weapons stay both droppable **and** equippable (accepted under infinite inventory +
   §30 — no further equip gate).
5. **Drops deposit on VICTORY only.** Collected loot banks into the Stash only when the mission is won
   (`levelRunner.win` → `depositLoot`); on death or restart the haul (and any un-grabbed drops) is lost.
   Parallels how credits bank at run end, but stricter (credits bank on death too). No despawn timer, no
   mid-mission persistence — nothing about a run persists until it's won.
6. **Pirate parts priced with `stats.buyable:false`.** Enemy components/weapons gained a resale `price` so
   looted gear sells for `floor(price·0.75)`, but a `buyable:false` flag keeps them **out of the shop** (the
   client filter hides them). A boss hull must never be buyable; this gives resale value without opening
   enemy gear for purchase. (The server `buyItem` doesn't enforce `buyable` — it's a client-shop concern —
   which is fine since no UI path offers those items.)
7. **Client-authoritative loot (roll + deposit).** The 20% roll and the pull run client-side; the victory
   deposit is a trusted client call (`POST /api/players/:id/loot`). A modified client could forge loot —
   the same posture as unsealed rewards (§18). Server-side sealing is deferred; the limitation is noted, not
   fixed. The endpoint is **not** shop-gated (loot is earned in combat, independent of the shop unlock).
8. **One shared metal-box model, single URL source of truth.** Every drop reuses one `DROP_MODEL_URL` (in the
   import-free `drops-config.js`, so `assets:check` validates it and node tests import the pure
   `pullSpeed`/`pickLoot` without pulling in THREE). No per-component drop models, no contested-loot/
   multiplayer authority, no inventory cap, no dedicated pickup SFX asset (a tiny synth blip) — all §30.

**Alternatives rejected.** (a) *A "cell" grid for range/speed* — rejected for concrete world-unit formulas
(decision 1). (b) *Make hulls droppable with an equip gate* — rejected; excluding hulls from the pool is
simpler and closes the exploit outright (decision 4). (c) *Server-side roll/sealing now* — deferred as an
integrity item, consistent with §18 (decision 7). (d) *Deposit loot on death too* — rejected to keep a real
stake on surviving the mission (decision 5).

**(Grab pull model superseded by §57 — the flat `range = strength` radius + distance-independent pull speed
described in decisions 1–2 above were replaced by an inverse-square field with emergent, weight-independent
range; the strength values, weight-scaled speed, hull/deposit/pricing decisions here still hold.)**

---

## 41. Autopilot generalized to a typed target (station or loot drop); win gated to the station

**Context.** Extends §39/§40. To make loot chests one-click reachable (click a chest → the ship flies over
and the passive Grab collects it), we needed a "fly-to-a-point" behavior — which the return-to-base autopilot
(§39) already is. Rather than build a second parallel fly-to system, we **generalized `G.autopilot` to carry
a typed `target`**: `{ kind:'station' }` (the return-to-base dock) or `{ kind:'drop', drop }` (a specific
loot drop). `autopilotControl` resolves the target's world position each frame and cancels cleanly if a drop
target vanishes (collected by the Grab, or cleared on reset — the `drops.includes(tgt.drop)` liveness check).

**Decisions.**
1. **The win is gated to the station target, not just "autopilot active".** With a chest-aimed autopilot able
   to run during return-to-base (a chest can overlap the station's arrive radius), `checkArrival`'s old
   `G.autopilot.active` guard was no longer sufficient — a chest fly-in could trip the dock. The dock/win now
   goes through a pure predicate **`canDock(autopilot, dist)` = active AND `target.kind==='station'` AND
   `dist ≤ BASE_ARRIVE_RADIUS`**. A chest-aimed autopilot is **structurally incapable** of winning the mission,
   at any distance. Rejected: a second, separate "grab autopilot" variable — more state to keep in sync, same
   brake/rotate/cruise code duplicated.
2. **Pure, unit-tested predicate module.** `BASE_ARRIVE_RADIUS` + `canDock` moved out of `sim.js` (not
   node-loadable — it imports THREE/engine) into an import-free **`client/src/sim-core/autopilot-config.js`** (mirrors
   `drops-config.js`), covered by `autopilot-config.test.js` — the "a drop never docks" invariant is the one
   correctness-critical piece and now has a test, without needing a headless sim harness.
3. **A collected/removed drop cancels the autopilot** (ship coasts to a stop, control returns) — no
   auto-chaining to another chest, no hand-off to the station (§30: the simplest thing that reads well).
   `target` is cleared everywhere `active` is reset (`start`, `win`, the manual-cancel, the internal cancels,
   and defensively in `reset()`), so no dangling drop reference survives a run.
4. **Discoverability is client-only cosmetics:** a `cursor: grab` hand on chest hover (mouse only, mirrors the
   §39 dock cursor; chest wins over station on overlap), a near-chrome **glint** material tweak on the drop
   glb + fallback box, and **green off-screen edge arrows** (own pool, nearest 6) reusing the enemy-marker
   projection math. No new asset (glint is a runtime material change), so no `CREDITS.md`/publish-itch.

## 42. Touch input unified as tap-vs-drag over the whole canvas (10px slop), not a fixed left-58% stick zone

**Problem.** The old `#stick-zone` (`left:0; width:58%; pointer-events:auto`) claimed the entire left region
for steering and **swallowed every touch there**, so on-screen objects (loot chests, the return-to-base
station) were **untappable across most of the screen** — the desktop click-to-fly (chest/station raycast)
had no touch equivalent on the left ~58%.

**Decision.** Expand `#stick-zone` to the **full play area** (`inset:0`) and disambiguate **per gesture by
movement slop**: a single-finger gesture that never travels **>`TAP_SLOP = 10px`** from its touchstart point
is an **object TAP** that reuses the desktop click's raycast (factored into one shared `engageObjectAt` — a
live chest wins over the station on overlap), while a gesture beyond 10px becomes the **floating steering
stick** for the rest of that gesture. Objects and steering both work **anywhere** on screen. The pure
classifier (`exceedsSlop`) lives in `client/src/tap-gesture.js` and is unit-tested.

**Why 10px, distance-only.** Matches platform touch-slop conventions (Android `ViewConfiguration` ~8dp,
Hammer.js 9px). No time cap (§30 — simplest): a hold-still-then-release still counts as a tap, and time is
only needed for long-press/double-tap, which we don't have. Slop is measured in the **rotated game space**
(`toGame` coords), the same space the stick center and its ~12px dead zone live in, so the two thresholds
are apples-to-apples on a rotated phone.

**Trade-offs accepted.** (a) The stick base/knob is **shown on touchstart**, so a tap may briefly flash it
(deferring the visual until the threshold was rejected as extra state for no real gain). A ≤10px tap never
engages steering — it's inside the dead zone and `dragged` gates it. (b) Taps and steering now share the
whole surface, so the **2nd finger is reserved for pinch** (no tap-while-steering). Pinch **moved from
`renderer.domElement` onto `#stick-zone`** (the canvas no longer receives the touches) but still counts
**`e.targetTouches`** (per §20), so a finger held on FIRE/rocket (sibling targets) isn't counted — holding
FIRE while steering is preserved. `=== 2` (not `>= 2`) keeps today's pinch feel.

**Zoom `+`/`−` during flight — the real cause, found by reproduction (not the z-index keep).** The full-screen
zone would cover the rocket/zoom buttons, so `#rocket-btn`/`#zoom` are raised to `z-index:6` — a **necessary
companion**, but reproduction on a Playwright+CDP multitouch touch harness showed the buttons were **already
dead during flight before that**: the player steers with one finger, and tapping `+`/`−` with a second thumb
did nothing. **Root cause:** the buttons fired on a synthesized **`click`**, and the browser **only
synthesizes a click for a single-touch tap** — it suppresses the compat click while a second touch point (the
steering finger) is active. **Fix:** the zoom buttons fire on **`touchstart`** (mirroring FIRE/rocket, which
always worked during flight); the `click` path is kept **mouse-only** (empirically, the compat click still
fires alongside `touchstart` in some browsers even after `preventDefault`, which would double-zoom a lone
tap). Verified empirically that the zoom visibly changes when tapped mid-flight on touch.

**Alternative rejected.** Keep the 58% zone and add tap detection only on the right 42% canvas — that leaves
objects untappable on the left, which is the whole bug.

---

## 43. Nebula sky: bake procedural GLSL once to a cubemap (vs live per-frame shader-sphere vs third-party cubemap assets)

We wanted a real nebula backdrop without a per-frame cost or a shipped binary asset. **Live
shader-sphere** (an fbm fragment shader drawn every frame behind the fight) was rejected: the two-pass
sky/combat split (§5) already pays a full sky pass each frame, and a 6-octave fbm over every background
fragment is exactly the fill-rate work weak phones can't spare. **Third-party cubemap PNGs** (the CC0
StumpyStrust evaluation set we trialed) were rejected: they add shipped binary weight, a `CREDITS.md`
attribution obligation, and can't be re-tinted per-map. **Chosen:** render the procedural shader **once**
into a `WebGLCubeRenderTarget` at `buildMap` time and use it as `skyScene.background` — per-frame cost
collapses to a flat background draw (identical to today), the look stays fully procedural +
palette-driven from the descriptor, and nothing ships as an asset. The one-time bake is **tier-gated**
(Performance keeps the flat color — a 6-face shader bake can hitch the weakest phones, matching the
"Performance strips premium visuals" line from §23) and **skipped under `?debug`** (software-GL bake is
slow/flaky and would churn visual baselines — same reasoning as the `prewarmShaders` skip). The bake
`ShaderMaterial` must set `depthTest`/`depthWrite: false` (with `side: BackSide`): the bake runs under the
engine's global `renderer.autoClear = false` and `CubeCamera.update` doesn't clear the shared depth buffer
between the 6 faces, so with default depth test the stale face-0 depths would reject later faces' fragments
and bake the wrong direction. The sRGB output path makes the baked cube read slightly brighter/greyer than
a raw-canvas preview; the maintainer accepted the baked in-engine result as the baseline.

---

## 44. Full-screen affordance shown over live combat (not menus-only), gated by `body.menu`, with a foreground `body.fs` re-sync

**Context.** On a phone, backgrounding the browser and returning silently drops the tab out of
fullscreen — the address bar/chrome reappears — but the floating `⛶` button (and, on iPhone, the
Add-to-Home-Screen pill) was CSS-gated to **menus only** (`body.touch.menu`), so mid-battle the player had
no way to re-enter fullscreen and was stuck with a shrunken screen. Two bugs compounded: (1) the menus-only
gate, and (2) `body.fs` (which hides the button once fullscreen) was only re-synced on `fullscreenchange`,
an event mobile browsers frequently **don't deliver to a backgrounded tab** — so after restore
`document.fullscreenElement` is `null` but `body.fs` stuck true, hiding the button exactly when it was
needed.

**Decision.** Surface the fullscreen affordance **whenever the HUD/menu is up — active combat AND pause,
not just menus** — as long as we're not already fullscreen. Reuse the **existing `body.menu`** signal
(menu = `body.touch.menu`, in-game = `body.touch:not(.menu)`) rather than inventing a `body.paused`-based
gate: paused is a subset of in-game and the real failure mode (chrome returns on background/restore) hits
active play too, so a paused-only fix (the original narrower request) was rejected. The `⛶` keeps its
bottom-right menu placement and moves **left of the rocket, raised above the bottom chrome** in-game
(`right:124; bottom:58`), with an explicit ~12px horizontal gap from the rocket hit area so it never sits
under the thumb's fire/boost path. On iPhone (no Fullscreen API, so "not fullscreen" ≈ "not standalone")
the a2hs pill now shows in-game too (`body.touch.no-fs-api:not(.standalone)`), tucked under the top-left
gear; it stays **non-interactive** (`pointer-events:none`).

**Trade-off.** This puts a control (and, on iPhone, a persistent pill) over live combat — extra HUD
clutter we'd normally avoid. Accepted because the harm from a stray tap is low (the button only re-enters
fullscreen, a no-op if already fullscreen) and the explicit rocket gap keeps it off the thumb path, while
the upside — recovering full screen without leaving the fight — directly addresses the failure mode.

**Stale-`body.fs` fix.** `body.fs` now re-syncs whenever the page returns to the foreground —
`visibilitychange` (only when `!document.hidden`), plus `pageshow` and window `focus` as
belt-and-suspenders — in `welcome.js`, independent of the existing `fullscreenchange` listener and of the
`autoPauseOnBlur` logic in `sim.js`. We deliberately **do not** try to force fullscreen programmatically on
restore (browsers block it without a user gesture); the fix is to make the button reappear so the player
taps it.

## 45. Ship hitbox via convex decomposition → one OBB per part (vs multi-sphere / hand-authored / a physics engine)

Every ship used to collide as **one fat sphere** (`2.6 × scale` for enemies, a hardcoded `2.6` for the
player, and the player↔rocket test ignored size entirely). On elongated hulls that both over-covers the
sides (visual misses still hit) and under-covers the nose/tail (`2.6 < 3.06`, the model's real half-length),
so tip shots miss. We replaced it with a **per-part oriented-bounding-box (OBB) hitbox** auto-fit to each
hull by convex decomposition.

**Inscribed/packed spheres were the first cut, and were superseded.** The initial iteration on this branch
fit a chain of axis-slice spheres (`docs/plans/multi-sphere-hitbox-fit-research.md`). Spheres cannot wrap a
thin swept wing — a per-cross-section sphere is "a ball with bulges" that either over-covers the empty gap
between wings or under-covers the wingtips. So we moved to convex decomposition + one box per part.

**Fit = V-HACD convex decomposition, one PCA-OBB per part.** The fitter (`scripts/assets-hitboxes.mjs`)
decomposes the normalized hull into near-convex parts with **V-HACD** (`vhacd-js`) — each wing (incl. its tip
pod) becomes its own part — then wraps each hull's vertex cloud in a tight **PCA oriented box**: centroid +
symmetric covariance → eigenvectors (a small deterministic Jacobi solver) = box axes, project verts per axis
for the half-extents. Stored per box as `{c,h,u0,u1,u2}` (center, half-extents, three orthonormal group-local
axes). Chosen over inscribed/packed spheres (can't wrap a wing), hand-authored boxes, and a physics engine
because the game is a top-down arcade shooter where "does this point touch the hull" is the only query
(DECISIONS §30 — keep it simple): a handful of cheap OBB projection tests behind the broad sphere, no runtime
BVH/physics.

**`vhacd-js` is build-time only, and memory-safe.** A prior local spike OOM-froze the maintainer's Mac —
that was an unbounded dense distance-transform path, **not** V-HACD. V-HACD's `voxelResolution` is a bounded
voxel *count* (a few MB), so the fitter runs it at the library default **`voxelResolution: 400000`** — needed
to voxelize thin wings/noses that a coarser 100k grid skipped entirely. `maxVerticesPerHull: 32` and
`fillMode: 'raycast'` (the combat glbs are non-watertight — raycast interior test, no repair needed). Do not
go to an unbounded voxel/distance path. `vhacd-js` has no `main`/`exports`, only `"module"`, so it is
imported by the subpath `vhacd-js/lib/vhacd.js`; it never ships to the browser (the fitter runs in Node).

**Budget: `maxHulls` 48 + `minVolumePercentError` 0.5, to cover the wings (the "wing is transparent" fix).**
`maxHulls` is only a **part-count cap** — it does not grow the voxel grid, so raising it costs nothing
(empirically ~2 s/ship at 16 vs 64 hulls). At 16 hulls / error 1, V-HACD spent its budget unevenly and
**merged one wing into a body hull** whose tight OBB stopped at x≈±1.5 while the wing reached ±1.7 → the
player's outer +X wing was **~16% covered** (the rest of the ship ~99%), so shots passed straight through
it. Raising to **48 hulls + `minVolumePercentError: 0.5`** (refine each hull to within 0.5% volume) gives the
wing panels/tips their own hulls → **100% surface coverage** on every ship; 64/0.3 over-splits into slivers
whose OBBs leave gaps (the boss nose regressed to ~96%). A `node --test` surface-coverage guard (below) is
the gate that catches an under-covered fit — the size/union-span sanity all *passed* while the wing was 16%
open, because a hole doesn't change the overall bounds.

**Tight fit, with a min-thickness floor, and deterministic.** OBBs are meant to be tight — the whole point is
that a bullet through the empty gap **beyond a thin wing** misses — so the fitter adds only a tiny additive
`HITBOX_MARGIN = 0.05` (group-local, ~1.5% of length) to each half-extent, not the old multiplicative `1.1`
bubble. But a razor-thin part (a swept wing / a pointed nose fits an `h ≈ 0.02-0.06` slab) is **transparent**
to a discrete moving bullet: bullets step ~1 world unit/frame (speed 48-65 × dt, world scale 1.8×sizeScale),
so they tunnel through a slab thinner than a step between frames. So each box's per-axis half-extent is
**floored at `MIN_HALF = 0.1`** (group-local) — this only bumps the thin axis of a thin box (the boss's
chunky boxes, min ~0.09, are barely touched), turning a thin wing/nose into a hittable slab. A little slop on
a wing edge is the maintainer's arcade tolerance; transparent is not. PCA eigenvector order/sign is otherwise
arbitrary, so each OBB is **canonicalized** (axes sorted by descending half-extent, each flipped so its
largest-magnitude component is ≥ 0); with fixed V-HACD options + fixed rounding this makes running the script
twice byte-identical (asserted by the unit test). `broadR` is the exact farthest OBB corner from the origin
(~1.9-2.2, near the model half-length). Two `node --test` guards (`scripts/assets-hitboxes.test.mjs`): a
**size-sanity** test asserts every modeled ship's `broadR ≤ ~2.4`, each half-extent ≤ half-length, **every
box's min half-extent ≥ `MIN_HALF`** (so a transparent thin fit fails), and the **union full span** along
its longest axis sits `3.0 ≤ span ≤ 4.3` (≈ `SHIP_MODEL_LEN` 3.4, headroom for rotated-OBB overhang + the
clamp); and a **surface-coverage** test that decodes each ship's real combat glb, puts its vertices into the
exact runtime frame (the fitter's `gatherMesh`+`normalize`, mirroring `ship-factory.js`), and asserts **≥97%
of surface points overall + ≥90% per extremity (wingtips / nose / tail) are inside the fitted boxes** — the
gate that catches an under-covered fit (the wing hole was invisible to every bounds-based test). It requires
the combat glbs locally (`npm run assets:pull`) and skips cleanly without them (gitignored — same
precondition as the fitter). This also validates **placement**: if the fitter's frame ever drifts from
ship-factory's, coverage collapses and the test fails.

**Runtime point-vs-OBB test.** At runtime (`client/src/sim-core/collision.js`) collision is **broad-phase** (one
enclosing `broadR × mesh.scale.x` sphere at `mesh.position`) → **narrow-phase** (point-vs-OBB): each box
center is transformed by `mesh.matrixWorld` (affine), each axis `uᵢ` is rotated by the matrix's upper-3×3 and
**renormalized** (world scale is uniform `sc = mesh.scale.x`), and the point is inside iff
`|dot(p − c, uᵢ)| ≤ hᵢ·sc + pad` for **all three** axes. `pad` (the rocket proximity fuse / blast reach)
expands every half-extent — a square-cornered Minkowski inflate, exact enough for a fuse. Transforming by
`matrixWorld` folds in position + heading + the 1.8× world scale but **not** the child `bankGroup` roll, so
collisions correctly ignore the cosmetic bank. `collision.js` is intentionally **THREE-free** (inline
matrix/vector math) so it's importable under `node --test`.

**Bullets are SWEPT (segment-vs-OBB), or they tunnel (the "bullets pass through thin wings" fix).** The
narrow-phase point test only samples the projectile's *end-of-frame* position (`sim.js`). A bullet steps
~1-3 world units/frame (`projectileSpeed` 48-65 × `dt` up to 0.05, × the 1.8×sizeScale world scale), which is
larger than a thin box's half-extent **along the travel axis** — so a wingtip/nose box (~0.1-0.2 world thick
in Z) sits entirely *between* two consecutive sample points and both land outside it → the bullet is
transparent to it. This is orthogonal to `MIN_HALF` (which is the *perpendicular* thickness) and to
resolution (the boxes are present — verified), so neither fixed it. The fix is `segmentHitsShip(ship, p0, p1,
pad)`: the bullet's movement segment (pre-move `p0` → post-move `p1`) vs each OBB — both endpoints are
transformed into the box's local frame (the same renormalized-axes/scale math), then a **slab test** clips
the segment against `±(hᵢ·sc + pad)` per axis; a segment-vs-enclosing-sphere broad phase gates the box loop.
It reduces to `pointHitsShip` when `p0==p1` (a strict superset). `sim.js` captures `p0` before
`b.mesh.position.addScaledVector(b.vel, dt)` and passes `p1 =` the moved position, for both bullet→enemy and
bullet→player. Rockets keep the point test — they're slow, homing (steer toward center) and carry a 0.5
`detonateR` pad (a large capture region), so they don't tunnel. Broad-phase gates the swept loop, so only
bullets already near a ship pay for it (mobile-safe). Why not just a bigger box / smaller bullet step: a
uniform inflate slops up the tight fit (re-opening BUG A's over-cover), and a fixed sub-step multiplies the
per-bullet cost; the analytic segment test is exact and cheap.

**Rocket blast damage is hull-relative too (the "rockets deal no damage" fix).** A rocket's detonation is
*triggered* hull-relative (`pointHitsShip(ship, pos, detonateR)`), so the detonation point lands on a
hull box — off the ship's center. The blast *damage* loop in `projectiles.js:detonateRocket`
originally still used `distanceTo(center) ≤ blastR`, so with the offset detonation point (and any offset
hitbox) it matched **nobody**: the rocket exploded visually but dealt zero damage, for both player and enemy
rockets. Fixed by making the damage loop hull-relative as well — `pointHitsShip(ship, pos, blastR)`. Since
`blastR ≥ detonateR`, a rocket that reaches a hull to detonate always deals its damage. A regression test
(`client/src/collision.test.js`) covers player→enemy and enemy→player, including a detonation point beyond
`blastR` of the center that the old test would have missed. **`detonateRadius` was also retuned down**
(rockets id 3/4/8: ~3.2–3.5 → **0.5**): since the trigger is now a `pad` measured from the *hull surface*
(not the center as before), the old large values made rockets detonate a full ship-length away. `0.5` is
near contact with the hull boxes while staying ≥ ~one frame of rocket travel (rockets accelerate to ~56 u/s,
~0.9 world unit/frame at 60fps) so a fast rocket can't tunnel past the ship without detonating — and the
broad-phase region (~4 world units) spans many samples as the rocket crosses it, so contact is reliable.

**Frame.** Boxes live in the **group-local noseZ frame** (after ship-factory's auto-scale to
`SHIP_MODEL_LEN` 3.4 + recenter + `yaw`), same frame as `userData.noseZ`. The fitter replicates that exact
normalization (including the merged triangle indices V-HACD needs) on the glb verts before decomposing, so
the boxes drop straight into the runtime frame.

**Config lands in the seed by auto-rewrite, not by hand.** `assets:hitboxes` writes the boxes into each
ship's `model:{}` block in `catalog_seed.js` via a **marker-delimited, idempotent** surgical edit
(`/* hitboxes:auto:start */ … /* hitboxes:auto:end */`); the same edit also **consumes any legacy
`/* hitspheres:auto:* */` span**, so one run migrates the seed off the old data. It preserves comments/key
order, then verifies by re-importing the seed and deep-comparing. Hand-authoring was rejected — the fit is
bounds math no human should transcribe, and a marked span keeps re-runs deterministic (running twice yields
an identical file).

**No meshopt decoder shipped.** The combat glbs are meshopt-compressed and reading them via `NodeIO`
needs a decoder we don't depend on. Rather than add `meshoptimizer`, the fitter decodes each glb to a plain
temp glb with the `@gltf-transform/cli` via `npx` (the same "no hard dep" pattern as `assets:build`), then
reads that. We fit the **combat** glb (what actually renders in battle), not the high-poly source/hangar.

**Fallback.** Primitive/un-modeled ships (no `hitBoxes`) keep the legacy single `2.6 × sizeScale` broad
sphere — unchanged behavior. `e.radius` is retained purely as the over-enemy health-bar / marker anchor.
## 46. Triple spiral rocket = 1 invisible homing leader + 3 real child rockets (not a single leader-detonation)

The triple spiral rocket (weapon id 11) is modeled as **four `rockets`-pool entries per fire**: an
**invisible leader** that carries all the homing (steer + accelerate toward the target, no damage, not
shootable) and **three visible warheads** that ride it, each a full rocket with its own `power`, `health`,
proximity `detonateRadius` (0.5, hull-relative — see §45), and blast.

- **Alternative considered:** one homing rocket that, on detonation, deals 3× damage (or spawns three
  cosmetic sub-rockets). Rejected — the headline feature is that **each warhead is real**: it deals its own
  damage, can be **individually shot down** by gunfire, and connects independently (1–3 hits land depending
  on how many survive). A single-detonation model can't express "shoot one down, the other two still hit."
- **Why the split (leader vs. warheads):** it keeps the **homing logic in exactly one place** (the leader
  reuses the existing rocket steering block verbatim) while the three warheads reuse the **existing
  rocket-vs-bullet interception and `detonateRocket` code paths untouched** — they already have `hp`,
  `obj.position`, `fromPlayer`, and blast fields, so no new pool, no per-warhead guidance, no bespoke
  collision code (§30 simplicity). The warheads' positions are derived each frame from the leader
  (`spiralOffset` corkscrew), so they don't steer themselves.
- **Lifecycle bookkeeping:** the leader counts live `children`; every warhead-removal path (proximity
  detonation, bullet shoot-down, out-of-range) funnels through one `removeRocket` helper that decrements it,
  and the leader self-removes when the count hits 0 or it reaches `maxRange`. The leader is never passed to
  `detonateRocket` (no mesh child / blast fields) — it's skipped in the interception + detonation loops and
  cleaned up in its own branch.

---

## 47. Off-plane hulls: per-model `lift` workaround, not a global collision fix (yet)

The game is top-down and bullets fly in the world **y≈0.6 plane** (the ship group's origin, group-local
y=0). Models are auto-centered on their bounding box, so a ship whose visual mass sits **below** its bbox
centre (tall turrets pulling the centre up, a drooped nose) leaves the hull below the bullet plane —
centre-aimed shots pass *over* it. Reported concretely on **enemy_3** (shots flew over the nose). §45's
tight OBB fit is faithful to the model, so it faithfully reproduces this miss.

**Decision:** a per-model **`model.lift`** (group-local +Y, pre-scale) that raises the **visual model and
its hitboxes together** into the bullet plane, rather than a global collision change.

- **Alternatives (deferred to ROADMAP):** (a) flatten every hitbox onto the y=0 plane / give bullets a tall
  vertical capsule — changes collision feel for *all* ships and hides genuine vertical structure; (b) fix it
  at export time by re-centering each glb — re-runs the whole asset pipeline per model and isn't trusted
  (§ model transforms are runtime-normalized, not baked). Both are heavier than the problem, which today is
  a handful of models.
- **Why lift is safe:** it's a single value that drives **both** `pivot.position.y` (visual) **and** every
  hitbox `c.y` (plus `broadR += |lift|`), so the model and its collision boxes can never desync — the class
  of bug that a "shift the hitboxes only" fix would invite. Default `0` leaves every other ship untouched.
- **Why not just accept the limitation:** it's a per-model *tuning* knob, not a mechanic — cheap to set
  (`enemy_3: 0.2`, player `0.18`), verified per model, and reversible. The general fix stays scheduled; this
  removes the visible sting on the ships that have it now (§30 keep-it-simple).

**The bullet plane is a formalized invariant, not a scattered `0.6`.** The move-the-model (never the
bullets) rule only holds if there's exactly one bullet plane. So `client/src/state.js` exports
**`BULLET_PLANE_Y = 0.6`** as the single source of truth: every ship group sits at this world Y, and since
muzzle/exhaust spawn from `mesh.position` + a **planar** (y=0) forward/right vector, ALL bullets — player
and enemy, every model — fly in exactly this plane. Ship spawn/recenter Y (`ship-factory`, `ship-build`,
`sim`) and the flat hit-ring FX (`projectiles`) reference the constant, never a bare literal. (We kept the
plane at 0.6 rather than shifting to literal world 0 — 0.6 is already model-independent, and re-zeroing
would be cosmetic churn across exhaust/HP-bar/ring code with shadow/ground regressions for no gameplay
gain.) `lift` is then simply "the signed offset that anchors a model's hull onto this invariant plane."

**`lift` is signed, and the fitter warns when a model needs one.** A hull can sit *above* the plane
(bbox centre below the deck) as easily as below, so `lift` is a signed group-local Y offset (positive
raises, negative lowers). To stop a freshly-fit model from silently shipping see-through from above, the
`assets:hitboxes` generator prints a **bullet-plane coverage** report — how many hitboxes the plane crosses
at the current `lift`, and the lift that maximises it — and flags any ship that could seat ≥2 more boxes.
Coverage is `|c.y + lift| ≤ Σ|uᵢ.y|·hᵢ`, which is exact and **invariant to heading and scale** (rotation
about Y preserves each axis's Y component; uniform scale cancels through the origin). `bestLift` scans a
**fine grid** and returns the **centre of the peak plateau**, not the plane-crossing extremum: a lift
exactly on a box edge grazes that box on a razor line (not a real hit), so the plateau centre — where the
plane passes *through* the seated boxes with margin on both sides — is the robust suggestion. It's a
*warning, not a build failure*: over-shifting to grab one more box can float/sink the model, so the
maintainer sets `lift` deliberately (see the `update-ship-model` skill). All 9 modeled ships are tuned to
their robust max (player `0.18`; enemy_1 `0.21`, enemy_2 `0.17`, enemy_3 `0.2`, enemy_4 `-0.132` — the boss
hull sat above the plane, so it's the one *lowered*).

---

## 48. In-game credits screen: legal obligation + parse-at-build committed module (vs runtime fetch)

Every 3D model we ship is **CC-BY 4.0**, whose license text *requires* attribution be shown to the people
who receive the work — i.e. **players**, not just a repo doc. Keeping the credits only in
`client/assets/CREDITS.md` (which players never see) left us formally out of compliance, so we added a
player-facing **Credits & attributions** screen (opened from the Settings gear — the one chrome surface
reachable on menus *and* in-game, and both distribution surfaces need it: vega.tenony.com and itch.io).

**Data path = parse-at-build into a committed module, NOT a runtime fetch.** The client is buildless
(§31 — raw ES modules; the vega/local serve has no build step, and `build-itch.mjs` only *copies*
`client/`). A runtime `fetch('CREDITS.md')` would need the raw md served same-origin on **both** builds and
still require filtering the repo-internal prose out of a compliance UI. Instead `npm run credits:build`
(`scripts/credits-build.mjs`) parses `CREDITS.md` → a **committed** `client/src/credits-data.js` the client
imports; both builds consume the committed module (and `build:itch` regenerates it into the staged tree as
a belt-and-suspenders guard). A `--check` mode wired into `client/src/credits-data.test.js` fails CI if the
committed module drifts from `CREDITS.md` — the same deploy-guard shape as `assets:check`.

**Two STRUCTURED parts of `CREDITS.md` are parsed; the narrative prose is ignored.** (1) the 5-column asset
table gives the asset SET + each row's author, source URL, license and group (`ships/` → models,
`sounds/` → sounds); (2) the **verbatim CC-BY blockquote attribution lines** (`> "TITLE" (URL) by AUTHOR
…`) give the TASL-correct **work title**, matched to its table row by Source URL. The Asset cell is a
repo file path, so slicing it yields a broken label (`sounds/kinetic..mp3`, a dangling `.glb`) — a
non-compliant credit — hence CC-BY rows take the blockquote title, courtesy rows take the parenthetical
description, and a cleaned-filename fallback guarantees a label is never a raw path. **A CC-BY row with no
matching verbatim block is a hard error** (throws): the verbatim block is itself required for compliance, so
a missing one is a real bug, never a silent path fallback. An unknown license string also throws (a new
license type must be handled deliberately).

**Chrome i18n, attribution content literal.** Panel title, section headings, "Modified", "Source", "Close",
"by {author}" are i18n keys (`ui.credits.*`, EN+RU); author names, work titles, license names and URLs come
straight from the generated data and are never translated (they are literal/legal text). Scope is a plain
scrollable list — no thumbnails/search/pagination (§30).

## 49. L1/L2 reward is server-installed (unchanged); the battlefield drop is COSMETIC to guarantee exactly one copy

The L1 Machine Gun / L2 repair drone reveal now happens as a glowing drop on the battlefield when the level's
last enemy dies, but the **one guaranteed copy is still delivered solely by the existing, idempotent server
force-install on victory** (clearing L1 runs L2's briefing `replaceWeapon 1→5`; clearing L2 runs L3's
`installComponent repair 12`). The battlefield drop **deposits nothing** to the stash.

**Why cosmetic-only.** If the drop *also* deposited into the stash, any player who grabbed it would end up with
**two** Machine Guns / repair drones (one from the grab, one from the server install). Leaving the guaranteed
copy exclusively with the idempotent server path keeps "grab it or not — doesn't matter" literally true and is
**dupe-proof on replays** (the install is a no-op when the item is already mounted/installed). The single
load-bearing line is `collect()` gating the `pendingLoot` push on `shouldDeposit(d)` = `!d.special`.

**Why not refactor the reward path** (a `reward.actions` block, a `/claim-reward` endpoint, moving the grants
off the briefings): the existing briefing actions already deliver exactly one copy at the right time and are
idempotent, so the smallest correct change (DECISIONS §30) is a **client-side cosmetic drop** plus an
ownership gate (`ownsReward` — don't spawn the drop if the reward is already owned, so replays show at most a
normal loot box). The showcase + grant actions on the L2/L3 briefings are untouched; only their **text** was
reworded to a "you recovered it" framing to match the new reveal.

---

## 50. Item rarity is DERIVED from price/buyable, not hand-authored per row (one explicit override)

The new `rarity`/`color` on `components`/`weapons` are stamped by a single classifier in `catalog_seed.js`
(`rarity = explicit override ?? ((price>0 && stats.buyable !== false) ? 'common' : 'trash')`), not written
out per row. The **only** hand-set value is `rarity: 'rare'` on the Triple spiral rocket. Colors are a fixed
map (trash `#ffffff`, common `#59e0a0`, rare `#0000ff`).

**Why derived.** The intended semantics *already exist* in the data: shop-available items (priced +
buyable) should read common; every pirate/enemy part (`buyable:false`) and price-0 boss part should read
trash. Deriving from those fields makes rarity **self-consistent by construction** — a new catalog row gets
the right tier for free, and there's no risk of a hand-typed rarity drifting out of sync with a row's
price/`buyable` flags. The escape hatch (a per-row `rarity`) covers the one case the rule can't infer (a
priced, buyable, but "special" weapon), keeping the smallest surface area (DECISIONS §30).

**Trade-off / when to revisit.** If rarity ever needs to diverge from price/buyable for many rows (e.g. a
premium-but-cheap cosmetic, or a tiering that isn't price-monotonic), the derived rule stops paying off and
the honest move is to hand-author `rarity` per row (or add a dedicated design column) rather than pile on
overrides. Today, with one override, the rule is the simpler and safer choice.

---

## 51. Flat player top speed + engine buff + pause-safe opening-combat grace (supersedes §2's "no speed limit" for the player)

Four correlated pacing/feel changes to the opening of a run (`docs/plans/2026-07-05-2126-player-speed-cap-engine-buff.md`):

**Flat `PLAYER_MAX_SPEED = 30` for the player, per-engine `maxSpeed` for enemies.** The player was
previously *uncapped* (§2's "no speed limit"), so velocity grew unbounded with thrust and arena traversal
time was unpredictable. We cap the player at a single flat movement-system constant clamped in `sim.js`
(after thrust/autopilot converge, before position integration — so both control paths obey it). We did
**not** repurpose the player's engine `maxSpeed` for this: the Basic engine (id 5) carries `maxSpeed: 0`, so
there was no per-engine cap to reuse, and a flat constant keeps player handling **predictable independent of
engine choice**. Enemies are untouched — they still clamp to `e.engine.maxSpeed`. This **supersedes §2's
"no speed limit" clause for the player** (mirrored by the §2 amendment); §2's inertia/no-friction/drift model
otherwise stands. Cosmetic wrinkle (left as-is): the per-engine `maxSpeed` shop stat is now decorative for
the player — but it already was, since the player was uncapped before.

**+50% engine `power` (acceleration), `maxSpeed` untouched.** Every engine's `power` is buffed ×1.5 (Basic
10→15, Scout 12.6→19, Boss 19→29, Solid-fuel 14→21, Ion 18→27, Pirate 12.6→19, Second-boss 30→45) so ships
(player *and* engine-sharing enemies) reach top speed faster — snappier acceleration without raising the
ceiling. Thrusters (turn) and all `maxSpeed`/`exhaust`/`weight`/`price` values are unchanged.

**5 s enemy hold-fire grace, timed on accumulated sim `dt` (pause-safe) not wall-clock.** Enemies spawn,
move and aim from frame one but hold fire until `G.combatElapsed >= 5`. The clock advances by `dt` inside
`update(dt)`, which is skipped entirely while paused — so **pausing during the on-ramp does not burn the
breather** (a wall-clock `performance.now()` timer would). Deliberately **silent** (no HUD/countdown/banner,
DECISIONS §30). The player also **opens each run gliding forward at 3 u/s** (10% of top speed) instead of
dead-stopped; the drift is momentary by design (bleeds off via `IDLE_DRAG` if no control is held).

---

## 52. L1 welcome drops the ship picker (single-ship level) + pins Take off via grid

At Level 1 the player owns **exactly one ship** (extra hulls are bought in the Main Window shop at L2+), so
the welcome-screen ship picker (`.pick` label + `#ship-choices` cards) offered no real choice — it was
decorative. Removing it loses no functionality (take-off still needs a non-null `selectedShip`, now defaulted
directly to `playerShips[0]` in `showWelcome`) and, on its own, already relieved the *visible* symptom by
shrinking the content.

Separately, `#welcome` moved from a **centered-flex column** (`overflow-y:auto`, whose `justify-content:center`
+ overflow **clips the unreachable *top*** of the greeting/intro on short viewports — the classic
centering-in-a-scroll-container trap, where the overflowed top can't be scrolled into reach) to a
**`1fr/auto` CSS grid**: a scrollable greeting/intro cell over a **pinned footer** (Take off + community link).
The scroll cell keeps the "centered when it fits, top-aligned + scrolls when it overflows" behavior via the
flexbox auto-margin trick (`:first-child{margin-top:auto}` / `:last-child{margin-bottom:auto}`), which does
NOT clip the top.

**Why.** This makes the Take-off on-screen invariant **structural** — guaranteed by the layout, not a
content-dependent side effect of how tall the intro happens to render — mirroring the Main Window's
already-pinned Take off. It's a minimal robustness fix (a few lines of CSS remove a whole class of "the
button drifted off-screen" fragility), **not** §30 over-engineering. A committed regression guard (scenario
18 at 900×360) asserts both that the scroll region genuinely overflows and that the footer is flush to the
content bottom, so a revert to the flex column fails loudly.

---

## 53. Enemy spawns are staggered (2–4 s cooldown), first-of-phase immediate

The level runner previously refilled the arena to `maxConcurrent` **every frame**: a phase's opening wave
snapped to full instantly and a killed enemy was replaced on the very next frame. That felt cramped and
spawn-camped — the arena was always packed and refills were invisible.

**Decision.** Gate **every** enemy spawn behind a randomized **2–4 s** cooldown (`2 + Math.random()*2`) so
enemies trickle in one at a time and a phase populates 1→2→3… toward its `maxConcurrent`. The **first** enemy
of each phase is **immediate** (the cooldown resets to 0 on `enterPhase()`), so no phase ever shows an empty
arena at its start — and the boss/finale (which spawns alone after its clear-out phase empties the arena)
still appears the instant its phase begins, **with no special-case**. Each spawn arms a fresh 2–4 s delay.

**Post-kill replacements are staggered too.** The cooldown only counts down while a slot is actually open
(`alive < maxConcurrent` and budget remains); while the arena is **full the timer is frozen**, so the moment
a kill frees a slot the remaining 2–4 s must still elapse — a kill never triggers an instant refill. This is
deliberate (a future reader must not "fix" it back to a per-frame top-up); the unit test pins it down.

**Scope/shape.** Simplest form per §30: an inline `2 + rand()*2` in one tiny pure helper
(`client/src/sim-core/spawn-timing.js` — `stepSpawnGate`/`nextSpawnDelay`), unit-tested by injecting a stub RNG. **No**
seeded-RNG system, **no** per-phase/per-level tuning of the window. The helper is a separate leaf (not inline
in `sim.js`) because `sim.js` imports `engine.js`, which builds a `WebGLRenderer` at import and can't load
headless — mirroring why `server/src/enemy_total.js` exists as a testable oracle. **No server/`enemyTotal`
change:** staggering changes *pacing*, not the total number of enemies that eventually spawn, so the
per-level totals and the `allCleared` advance condition are unaffected (clear-out phases just take a little
longer to fully spawn). The `win` / return-to-base flow is untouched.

---

## 54. Deterministic spawn totals (explicit per-phase `total`) + warp-in IS the stagger delay

§53's staggering **broke** the assumption §53 claimed to preserve. The precomputed `enemyTotal`
(`server/src/enemy_total.js`) modeled the *old* instant-fill runner: a `kills`/`killsSincePhase` threshold
phase snapped to `maxConcurrent` and so left exactly `maxConcurrent` enemies **alive** ("carry") when it
advanced, which a later `allCleared` clear-out phase then killed. Staggering trickles enemies in one at a
time, so a threshold phase now advances with **far fewer** than `maxConcurrent` alive — the actual kills to
clear a level came out variable (e.g. L1 14/15 instead of the precomputed 16). The HUD "destroyed X/Y"
counter stopped short and the single drop trigger `kills === enemyTotal` (§30) never fired, so the L1
Machine Gun and L2 Repair-drone reward drops silently vanished. A carry-based oracle can't survive a
non-deterministic fill rate.

**Decision.** Make counts **deterministic**: every spawning phase carries an explicit `spawn.total` cap. A
threshold phase's `total` equals its kill-delta (so it leaves **0** alive at advance — a larger cap leaves
survivors; a smaller cap deadlocks), and the "carry" remainder becomes a **real spawning clear-out/finale
wave** (drawn from that level's wave-2 pool; L1, which has no clear-out, folds it into its finale). So
`enemyTotal` is simply the **sum of every phase's `spawn.total`** — `enemy_total.js` collapses to that sum,
the counter reaches N/N, and the drop fires on the true last kill. Per-level totals are preserved except
**L1 intentionally drops 16→14** (two fewer finale rocketeers): L1=14, L2=17, L3=21, L4=22, side=20. **No
second/structural drop trigger** (§30) — the one deterministic condition stays, extracted into a pure
`isLastKillDrop({kills, enemyTotal})` and guarded by a new headless full-level replay
(`client/src/sim-core/level-sim.js` + test) that proves the counter reaches `enemyTotal` and the drop fires on the
last kill. That missing coverage is what let the regression ship.

**Warp-in becomes the arrival animation.** Rather than an empty 2–4 s gap then a separate 1 s pop, a spawned
enemy appears **immediately** as a dot and **materializes over its stagger interval** — the armed 2–4 s
cooldown, carried per-instance on `e.spawnDur` (the global `SPAWN_GROW_TIME` 1 s stays as the default and
the player warp-back). While forming (`e.warping`) it is **invulnerable, cannot fire, and is not a valid
homing-rocket target**, so the staggered trickle can't be spawn-camped mid-materialize; it still counts
toward `maxConcurrent` (preserving §53's pacing) and shows its edge marker so the arrival reads. All three
player→enemy damage paths skip warping enemies (bullet collision + rocket detonation trigger in `sim.js`,
and the **separate** blast-splash loop in `projectiles.js`), so a warping enemy's hp stays `maxHp` and no
health bar ever shows on a dot. The shot-down rocket path (`detonateRocket(r,false)`) is unaffected. This
supersedes §53's "No server/`enemyTotal` change" claim.

## 55. Pipeline run history = committed JSONL journal, not an observability platform

The `/feature-pipeline` orchestrator now persists every run to `docs/pipeline-runs.jsonl` (one JSONL line
per run: per-agent tokens/tool-calls/time, loop counters, critic/reviewer findings, review-gate decision,
live-test outcome) to enable longitudinal analysis of agent effectiveness — chiefly the **escaped-defect
rate** (bugs the live test caught that critic *and* reviewer both passed), plus token cost trends.

**Decision.** Store it as a **committed, append-only JSONL file in `docs/`**, queried with `jq`/DuckDB —
not a hosted observability platform. Rationale: this is a single-author repo with a few pipeline runs at a
time; a git-diffable, human-readable journal is the simplest thing that answers "how good is the critic /
reviewer, and what did this cost" without standing up Langfuse/OTel + ClickHouse/Redis (§30). Rates are
**derived at query time**, not stored, so metric definitions can evolve without a migration.

**Alternatives considered.** *CSV* — rejected: records are nested (per-agent objects, findings arrays)
and the schema will grow; CSV forces flattening. *Committed SQLite* — deferred: JSONL suffices until SQL
with indexes is actually needed. *SaaS/self-hosted observability (Langfuse, Arize Phoenix, OTel collector
→ Grafana)* — rejected **for now** as over-engineering for one author, but kept as the documented **escape
hatch**: Claude Code emits OTel GenAI spans/metrics natively (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, per-subagent
tokens/cost, delegation chain as one trace), so the upgrade path is real if run volume or a dashboard need
ever justifies it. The **review gate** (Stage 4.5) shipped in the same change is the standard
human-in-the-loop interrupt, deliberately placed on the least-reversible step (implementation + deploy) per
"don't interrupt on reversible steps." Full spec: `docs/plans/pipeline-review-gate-and-run-log.md`.

---

## 56. Admin device label = hand-rolled UA parse + curated code→marketing-name lookup, no dependency

The `/admin` "device" column needs to turn a raw `User-Agent` + a `Sec-CH-UA-Model` device **code** into a
readable `Browser · Device/OS` label. We deliberately **skip** `ua-parser-js` / a full device database and
hand-roll it: a few robust regexes (`parseBrowser`/`parseOS`) plus a small curated `DEVICE_NAMES` map
(common Samsung/Xiaomi/Pixel/Apple codes → marketing names) with a **raw-code fallback** for anything
unknown. Rationale: the admin panel has a **no-new-deps precedent** and DECISIONS §30 (keep-it-simple,
single author) — a device DB is heavy, needs updating, and this is a maintainer-only eyeballing aid, not
analytics. The trade-off is accepted: unknown device codes show the raw code, and browser/OS detection is
approximate. The signal is **deliberately partial**: the model only arrives from **Chromium same-origin**
visits (opt-in via the `Accept-CH: Sec-CH-UA-Model` header — modern Android's UA hides the model), so
Safari/Firefox and the cross-origin itch embed degrade to UA-only, and existing rows stay `NULL` until the
player next boots (no retroactive data, no backfill). We store the **raw** UA + model code and do all
parsing/formatting at **render time**, so the label (and the `DEVICE_NAMES` map) can improve later with **no
migration or backfill**. Capture is **latest-wins** (unlike write-once `referrer`, §36): device metadata
reflects the player's *current* device, and `resetPlayer` intentionally leaves it in place (it's not
progress).

---

## 57. Grab tractor = inverse-square field with emergent, weight-independent range

The Grab (tractor) used to pull any drop inside a hard radius (`range = strength`) at a constant,
distance-independent speed (`(strength/2)·(10/weight)`). We replaced it with an **inverse-square field**:
`field(strength, dist) = strength·FIELD_K/dist²` (`FIELD_K = 5`), and the beam **engages a drop only where
`field ≥ FIELD_CUTOFF`** (`0.4`). Pull speed is `field·(10/weight)` — it now **rises the closer a drop is**,
so near drops snap in and far ones crawl, which reads like a real tractor beam.

Two consequences are deliberate. (1) **Range is emergent, not a stored stat:** the reach is wherever the
field crosses the cutoff, `range(strength) = sqrt(strength·FIELD_K/FIELD_CUTOFF)`, so there is no separate
range number to store, tune, or keep in sync — one `strength` value drives both reach and speed. (2) **Range
is weight-independent:** the cutoff test uses `field`, which has **no weight term**; weight scales only the
speed. A heavy item is pulled from just as far as a light one, only slower — item weight can never change how
far the beam reaches.

We **kept the strength values at 10 (base) / 20 (Advanced)** rather than retuning them. Because range scales
with `sqrt(strength)`, the equal 2× ratio makes the Advanced grab reach exactly **√2× the base** (≈15.8 vs
≈11.2 u) — a modest, believable reach upgrade instead of doubling it, while still doubling the field strength
(and thus pull speed) at any given distance. No DB/schema change: `strength` lives in the catalog `stats`
JSON and is untouched.

The **shop keeps showing the raw `strength` number** (10/20), relabeled as an abstract "grab strength"
rather than claiming to equal the world-unit range (option a). Per §30 (keep-it-simple, single author) this
is one existing surface with minimal churn; showing the derived range would add a computed display for a
maintainer-facing tuning aid nobody asked for. Near-ship singularity (`field→∞` as `dist→0`) needs **no
clamp**: collection at `COLLECT_DIST = 3` fires before a drop nears `dist=0`, and the per-frame move is
capped at `Math.min(speed·dt, d)`, so an over-large near-field speed can never overshoot the ship.
Constants `FIELD_K = 5` and `FIELD_CUTOFF = 0.4` are fixed for this iteration (no player-facing tuning UI).

**Follow-up (2026-07-07): reel-in speed is a linear ramp, not the field.** Two rounds of live play refined the
*speed* (the reach was right from the start and never changed). First we decoupled speed from reach with a
scalar `PULL_SPEED_SCALE = 0.67` (since `FIELD_K` scaled both), slowing the pull ~1.5×. But the `1/dist²` speed
still spiked near the ship — drops crawled far out then snapped in, which read as a jerk. So we **replaced the
speed model entirely with a linear ramp by distance**: `pullSpeed(weight, dist)` rises linearly from
`PULL_SPEED_FAR = 1` u/s (far, and the floor at/beyond `PULL_FAR_DIST = 11`) to `PULL_SPEED_NEAR = 4` u/s at the
ship (both weight-10 refs), then `·(10/weight)`. A constant slope is deliberately un-physical but has **no
near-ship jerk** and plays better — the maintainer explicitly preferred playability over physical correctness
here. `PULL_SPEED_SCALE` was retired (folded into the near/far anchors). **Reach is untouched** — it still comes
only from `field`/`FIELD_CUTOFF` (the range tests did not move), so the emergent √2 advanced-vs-base ratio holds.
A consequence: **pull speed no longer depends on `strength`** (it dropped out of the `pullSpeed` signature) —
strength drives reach only; the speed profile is uniform across grabs. `PULL_SPEED_NEAR`/`PULL_SPEED_FAR`/
`PULL_FAR_DIST` are the speed knobs, `FIELD_K`/`FIELD_CUTOFF` the reach knobs.

---

## 58. Perf regression gate is a relative A/B (same job), not an absolute threshold

**Problem.** Weak phones (A03s/Redmi, DECISIONS §23) are the floor, but a code change that quietly adds ~2%
per-frame CPU cost is invisible in review and only surfaces as "the game feels heavier" much later. We want to
catch a **>2% CPU regression before it lands** — but 2% is far below the noise of any single wall-clock
number (vsync/compositor jitter, thermal drift, GC pauses swamp it), and it's device- and browser-specific, so
there is no meaningful *absolute* budget ("update must be < 0.5ms") to assert against.

**Decision.** Measure it as a **relative A/B**: replay a fixed input **trace** identically on the **merge-base
build (A)** and the **feature build (B)** on the **same machine, same headless Chromium, same job**, interleave
the reps (`A,B,A,B,…`, cancels slow thermal drift), and compare each JS-work bucket's **median across reps**
with a **bootstrap 95% CI on the ratio `(B/A−1)`**. Flag **REGRESSION** only when the CI *lower bound* exceeds
**+2%** — i.e. we are statistically confident the true delta is >2%, not point-estimate noise. Because both
builds run on one browser binary, transcendental last-bit FP differences never enter the comparison, and the
absolute machine speed cancels in the ratio. Determinism is bought by pinning the three nondeterminism sources
(seeded `Math.random`, a fixed `1/60` `dt`, a recorded per-tick input snapshot) — the game sim is already a
pure function of `(state, keys, touchAim, dt, random)` with **no wall-clock in the math**.

**Metric = `js.*`, never `fps`/`frameMs`.** Wall-clock frame time is vsync/compositor-noisy and never
2%-detectable (per `perf-low-end-phones.md`). The gate keys on the CPU/JS buckets `update`/`dom`/`render`/
`total` that `devPerf` already produces — the half that *can* be measured deterministically on a desktop. Two
resolution details the implementation forced (both from measuring on the swiftshader dev machine): (1) Chromium
clamps `performance.now()` to 100µs, so a per-tick **median** of quantized samples jumps in coarse steps — each
rep is aggregated by the **mean** (of ~780 ticks, which averages back to sub-quantum resolution), with the
**median taken *across* reps** for GC robustness. (2) On **software GL the `render` bucket rasterizes on the
CPU** and is genuinely ~10–20% noisy, dominating `full.js.total`; the tight 2%-sensitive signal is therefore
**`sim`-mode `js.update`** (a pure `update(dt)` loop, no render). The gate fires on **either** `sim.js.update`
**or** `full.js.total`, so a real CPU regression is caught by the clean `sim` signal even when `full` is too
noisy to resolve 2% (on real-GPU CI the `full` bucket tightens). This is why the CI is **paired** — `A[i]`/`B[i]`
run back-to-back (order flipped each round) so common-mode machine noise cancels in the ratio.

**Scope: CPU-only — the GPU blind spot is explicit.** A green gate is **not** "no A03s regression": a change
that only adds GPU cost (an extra additive-particle layer, a render pass, a bigger backbuffer, a heavier
shader) can regress a real phone while `js.*` stays flat, because browsers don't expose GPU execution time on
mobile. The perf-low-end work found those devices were largely **fill-rate/thermal/compositor-governed**, which
no desktop run reproduces. So the gate additionally tracks structural signals from the per-tick `load` snapshot
(`draws`/`tris`/`particles`) and flags growth — but states plainly it is a **proxy, not a GPU measurement**.
Real-device `?dev` telemetry (§23) remains the source of truth for the GPU/thermal half.

**Load-pinning for gameplay diffs.** A trace replays *inputs*, not the world; a diff that changes gameplay
(turn rate, damage, spawn timing) could yield a different entity population on B and contaminate the delta with
"different amount of work." The canonical trace is **load-pinned** (`setup.maintainEnemies`): the replayer
respawns to hold a fixed enemy count each tick, so the per-frame workload is structurally constant regardless
of who wins the fight. The runner also reports per-build `load.*` and annotates "load diverged — treat Δ as
approximate" when A and B drift apart.

**Standalone tool + documented pipeline prose, NOT a CI hard-fail (§30).** Ship the runnable
`node client/bench/run.mjs` + the `?bench` hooks, and **document** the PERF A/B stage in the feature pipeline
(`multi-agent-pipeline.md` + the skill prompt) as prose the pipeline Claude executes — no GitHub Actions job,
no orchestrator code. On a REGRESSION the pipeline **surfaces the per-bucket table to the maintainer as a
blocking question** (accept the intended cost / send back / abandon), the same posture as the reviewer
returning CHANGES. Rationale: the gate needs a merge-base build to compare against (materialized per-PR), it is
inherently advisory (a 2% CPU cost can be a deliberate trade), and a single author doesn't need CI machinery
to enforce it (§30). Because build A is always the merge-base, on the first branch *after* the harness lands
build A has no `window.__bench` → the runner prints `gate inactive` and exits 0; real A/B activates on the
next feature. Cross-references §23 (the `?dev` monitor this reuses) and `docs/plans/perf-low-end-phones.md`.

## 59. Ambient ghost battle = committed transform-replay of a REAL in-game recording, a FIXED-world-anchor landmark shown in every mission except the freighter escort, re-centered by the player's mean path (player flies freely)

**Problem.** We want a small, *watchable* far-off skirmish — a distant space battle you can see raging as you
fly a mission — cheap enough to ship, that never perturbs the real fight. (It began as decor for the "save the
transport" freighter escort, hence the freighter reposition + the default anchor at that mission's spot, but
pivoted: it now reads better as a **distant landmark in the OTHER missions** — showing it inside the freighter
escort would compete with the player's own fight, so that mission is exactly where it's hidden.)

**Transform-replay, not a second sim.** The game world is **module-level singletons** (`G`, `enemies`,
`bullets`, the projectile pools in `state.js`); a concurrent second `update()` to animate a live ghost fight
would corrupt the player's actual fight. So we play a **committed transform track** at runtime as a **dumb
lerped animation** (ship transforms lerp with shortest-arc yaw; bullets snap) — no live sim, no
collision/targeting/HUD/audio wired to the ghosts by construction. The track records **transforms, not
inputs** (unlike the §58 perf trace): inputs would require re-running the sim at playback (the thing we're
avoiding), and transforms are trivially interpolable and never diverge.

**Authored by a REAL in-game recording (the primary path).** The maintainer wanted to conduct + watch *their*
battle, so the canonical track is captured by a **`?dev` recorder** (`window.__backdrop.record()/stop()/
status()` in `main.js`) that observes a live-played fight — the player (slot 0) + every enemy that appears
(each joins as a new `birth` slot, up to 16 slots) + ≤24 bullets, at 20 fps via a **dt accumulator initialized
`acc:0`** (a large sentinel would pass every ~60 fps frame while
the track is stamped `fps:20` → playback 3× too long at ⅓ speed; the `acc -= 1/fps` remainder-preserving
decrement yields exactly 20 keyframes/s) — then re-centers/quantizes and downloads a `backdrop-battle.js`
module (an authoring tool, like the credits/itch generators; the output is committed by hand). **A hand-flown
recording is NOT re-generable byte-identically — the committed JSON is the artifact** (no byte-identical
expectation). A **synthetic headless generator** (`window.__bench.bakeBackdrop` + `client/bench/
gen-backdrop.mjs`, seeded/fixed-dt via the §58 harness) is kept **only as a bootstrap/fallback** so the
runtime + tests function before the real recording exists; its output *is* deterministic, but that's a
convenience, not a requirement.

**VISIBLE-distant — reversing the initial "faint ambiance" guardrail (the playtest fix).** The first build
over-dimmed the battle into invisibility (`opacity 0.35 × darken 0.45 × scale 0.5 × y −48` — the near-top-down
camera foreshortened the ships to nothing and only the additive death-explosion punched through). The design
goal is now **a watchable distant battle**: near-opaque (`opacity 0.9`), **full color (no darken)**, moderate
scale (`0.8`), on a **lower layer at `y ≈ −60`**. The "distant / not-mine" read comes from **horizontal
separation** (a landmark off across the arena you fly toward) plus the depth separation, NOT from dimming.
`y −60 < 0.6` keeps it a **separate, unshootable layer** below the combat plane, and ghost death rings are
relocated off the combat plane (`spawnShipExplosion` gained an optional `ringY` param; the truthiness-guarded
`opacity`/`darken` hook on `applyShipModel` leaves real ships byte-unaffected — ghosts now pass `opacity` only).
All five values are **live-tunable**: a `?dev` "Backdrop" panel (lil-gui, mirrors `?tune`) exposes
**Depth / Scale / Opacity / Anchor X / Anchor Z** sliders that drive a persisted `GHOST_TUNE` object
(`localStorage['ghostTune']`, key + clamp/load/save mirror `graphics.js`'s tier discipline; committed defaults
in `GHOST_TUNE_DEFAULTS`) applied live each frame — so placement is dialed in during a real playtest, then the
final numbers are baked back into the defaults. **Depth default −14 → −30 → −60**: the maintainer reported the
Depth slider "does nothing", diagnosed **live** (camera projection) as **camera geometry**, not a bug — under
the near-top-down camera (`CAM_OFFSET 0,110,26`, world +Y ~97% along the view axis) moving `group.position.y`
moves the battle almost entirely **into depth** (apparent size / layer separation: ~19 px on screen per 16 u Δy
vs ~97 px for an equal Δz). So **Depth controls the layer only; the new absolute Anchor X/Z sliders are the
across-screen placement control** (they move the group across the ground plane, clearly visible) — Depth was NOT
repurposed for screen motion. `GHOST_TUNE` is a **single module-scope object** that both the panel (lil-gui
mutates in place) and the runtime `entry.update` (reads `GHOST_TUNE.y/ax/az` each frame) share — identity
confirmed, so slider drags reach the runtime; `loadGhostTune()` is called exactly once.

**Births + deaths, not a frozen cast (the second playtest fix).** The first recorder froze the cast at
record-start (nearest N enemies) — so over a 60 s clip every ghost eventually died and the loop decayed to a
lone player ship (the game spawns enemies in waves). Fix: each ship slot carries a **`birth`** (keyframe it
first appears, default 0) alongside **`death`** (−1 or a keyframe); a slot renders only for
`birth ≤ frame < death`. The recorder starts **player-only** and assigns a NEW `birth` slot to every enemy as
it appears — **including later waves** — up to a **16-slot total cap** (`MAX_GHOST_SHIPS`), back-filling
pre-birth placeholder samples so every slot array stays length `frames`. Slots are never reused (§30). This is
what keeps a long recording populated. Because the track can now hold 16 slots but a weak phone must not draw
16 ships, the tier gate became a **CONCURRENT-visible ceiling** (`maxConcurrent`, not "first N slots"): the
runtime builds one mesh per slot but shows only the born-and-alive ones up to `maxConcurrent` (hidden meshes
don't draw, so the draw-call cost §23 is bounded by the ceiling, not 16). A death only fires the explosion if
that ghost was **on-screen the prior frame** (`wasVisible`), so a capped-out or never-shown slot never pops a
sourceless burst. *(Playtest watch-item: on the **Balance** tier — concurrent cap 4 — if >4 slots are alive
when a visible ghost dies, a waiting slot pops in to fill the vacancy; it's masked by the coincident death
explosion and does not occur on High/8. Confirm it doesn't read as a jarring spawn.)*

**Re-center by a SINGLE FIXED OFFSET = the player's mean path → the player flies FREELY (the final anchoring
model, reversing two rejected ones).** The shared pure helper `recenterAndQuantize` (used by BOTH authoring
paths — one source of truth) subtracts **one constant** `(mean(p0.x), mean(p0.z))` (the mean of slot-0's / the
player's positions over the whole track) from every ship AND every bullet. Because only a **constant** is
removed: the player's real free-flight motion is **preserved** (it visibly flies, which the maintainer
required), enemies move naturally, and there is **no per-frame membership dependence → no birth/death jumps**.
Two earlier anchors were rejected: (a) the **per-frame cast centroid** stepped at every birth/death (~15
membership events), jerking the whole formation "downward" (a +Z step reads as downward on the top-down
camera); (b) **per-keyframe slot-0 subtraction** removed the drift jump-free but **pinned the player at origin**
(it stopped flying) — the maintainer rejected that too. The fixed mean offset is the synthesis: bounded like a
re-center, but the player keeps its motion. The cloud centers on the player's mean *path* (not the cast
centroid), so an enemy-biased formation sits slightly off the anchor — that's what the Anchor X/Z sliders nudge.
The committed track's bounded guard drops the old `slot0 ≡ (0,0)` assertion and instead asserts slot 0 is **NOT
constant** (its coords vary, its mean ≈ 0 — guards against regressing to pinning) and a loose `< 600 u` runaway
bound over live frames; a stale (old slot-0-pinned) committed track fails the "not constant" check, forcing a
re-record.

**Fixed ABSOLUTE world anchor + gate flipped to non-freighter missions.** The group is placed at the absolute
world coordinate `(GHOST_TUNE.ax, y, az)` (default `(−100,−450)`, the freighter mission's start) — the **same
world spot regardless of mission**, NOT `arenaCenter`-relative and NOT following any object; it's a **distant
landmark the freely-flying player heads toward**, fading in through the scene fog. It shows in **every mission
EXCEPT the freighter escort** (`G.activeMission?.title !== 'freighter'`: campaign `null` → shows, mining/
research → show, freighter → hidden because you're IN that fight). The build trigger MOVED off the freighter
set-piece into **`sim.js reset()`** (after the set-piece rebuild loop): a dynamic `import('./ghost-battle.js')`
(keeps it off the initial bundle + avoids a `sim.js↔world.js↔ghost-battle.js` static cycle) calls
`buildGhostBattle()` (no argument), which adds its group to `scene` AND pushes a `setPieces` entry so the
universal teardown at the next `reset()` removes it (no double-build). It **self-skips under both `?debug` AND
`?bench`** (`headless = search.includes('debug') || search.includes('bench')`) — the gate flip means the
feature now fires in the campaign, which the §58 perf trace exercises (`activeMission` null), and the async glb
loads would add nondeterministic draw/tri counts to `load.*`; skipping keeps the gate FLAT/deterministic. Its
real per-frame cost (≤8 extra ship draws + ≤24 bullet dots on High, less on Balance, 0 on Performance, and
**zero `update` cost** — it never touches `G`/`enemies`/projectiles) is a draw/fill matter judged on-device
(§58 GPU blind spot), deliberately not benched.

**Freighter reposition (render only).** The freighter render position moved **+50 z (−450 → −400)** while its
**mission `center` stays at −450**. The freighter is non-collidable decor with zero mechanical role
(enemy/player spawns + soft boundary key off `arenaCenter` = the mission center, not the freighter). Moving
both would shift the whole mission by a constant the player can't perceive; moving **only** the freighter is
what actually changes what the player sees (it now sits ahead of the forward-gliding spawn) and is
balance-neutral. 50 u is small vs the 70–130 u enemy spawn ring, so the freighter stays inside the fight.
(The ghost battle's default anchor `(−100,−450)` is the freighter mission's spot, but the ghost battle no
longer *shows* in that mission — it's the campaign/other-mission landmark; the two just share a default coord.)

**Record length 60 s** (~150–250 KB @ 20 fps / ≤16 slots / ≤24 bullets) — a longer, more watchable loop, still
within the KB budget.

**Tier / `?debug` / `?bench` gating** (the pure `ghostBattlePlan(tierName, headless)`): Performance = off
entirely (mirrors `nebulaBake:null`, §23); the **runtime** is skipped under `?debug` (headless visual suite,
mirroring the nebula bake §43) AND under `?bench` (the perf gate now runs the campaign where this fires — skip
so async glb loads don't flake `load.*`); `maxConcurrent` = **High/unknown 8 + bullets, Balance 4 / no bullets,
Performance 0**. The `?dev` recorder + panel are a separate flag and observe the live fight directly (no
conflict with the `?debug`/`?bench`-off runtime). **No new assets** (ghost ships reuse `player_combat` +
`enemy_*_combat`), so no CREDITS change and no itch-glb-404 risk (§37). Cross-references §38 (freighter
set-piece), §43/§23 (gating), §58 (the bench harness the bootstrap reuses + the gate this self-skips).
---

## 61. Intro "Level 0" via content-shift on stable seed names + one-shot `current_progress` +1, not a `sort_order` column or a full renumber

Level order is `levels.id` (insertion order) with name-keyed upserts, so a new *first* level needs the
lowest id. Rather than add a `sort_order` column (over-engineering, §30) or renumber every campaign title,
we keep the seed names `level-1`..`level-4` (stable ids 1-4), shift their descriptor CONTENT down one, and
append `level-5`. The campaign keeps its "Level 1"-"Level 4" labels/rewards/briefings intact (content
travels with the descriptor); only new players see the "Level 0" intro. Existing players are bumped `+1`
once (SQLite migration `022_intro_level0_shift.js`; a guarded `migrations_pg` one-shot on Postgres, run
after the levels seed so the FK on `current_progress` validates) so nobody is shoved onto different content.
The guard is load-bearing: Postgres has no versioned migrations, so a bare `+1` on every boot would keep
incrementing each deploy — the `INSERT ... ON CONFLICT (name) DO NOTHING RETURNING name` sentinel makes it
run exactly once. Trade-off: the intro is labeled "Level 0" (a prologue) rather than a renumbered "Level 1",
accepted to avoid relabeling the whole campaign and touching every title/textKey. The intro also
**auto-launches** on first load (no welcome screen / Take-off, gated to `level.name === 'level-1'`) so a
brand-new player is dropped straight into the gentle fight; this skips the welcome take-off flow (default
ship only, no picker — which the welcome screen no longer offers anyway).

**§-number collision hazard (parallel-merge doc-conflict pattern):** on `main` the next free number was §60,
but the **parked** branch `feature/2026-07-08-2007-level-0-intro-cutscene` already claims `## 60.` (the
intro-cutscene decision). To avoid a collision when that branch later merges, this entry uses **§61**. If
§61 is somehow taken by merge time, renumber to the next free slot; whoever merges second reconciles. Do not
reuse §60.
---

## 62. Combat replay = deterministic INPUT-replay (record input + seed, re-run the real sim), NOT a transform "movie of positions"

We need to replay real fights — first for the Level-0 intro cutscene, later for alt-angle views and video
capture. The pre-existing ambient ghost-battle (§59) bakes per-frame **transforms** and dumb-replays them on
ghost meshes. That was fine for a distant backdrop but is structurally wrong for a hero close-up: bullets are
an anonymous position stream (can't be colored by owner → enemy bullets came out blue), there are no real
collisions, and 20 fps samples teleport (jerky). So combat replay uses **deterministic input-replay**:
record the player's per-tick input + the mulberry32 seed; replay by re-running the actual `sim`. Everything
is then native and free — real projectile colors, smooth physics, real FX, real collisions ("you see your
fire shoot down the rocket because it *is* the game"). The whole recording is `{seed, dt, shipId, level,
ticks:[{k,t}]}` — the determinism audit found the sim needs only the seed (spawn timing/positions/loot/reload
jitter all draw the global `Math.random`; no wall-clock or Map/Set-iteration-order deps in the sim path).
Reuses the `?bench` foundation (`installSeededRandom`/`mulberry32`/`BENCH_DT`). This mechanism is intended to
**supersede** the transform-replay for the foreground (§59's backdrop can migrate onto it later).
*(Amended 2026-07-26 — §73: the seeded stream is no longer a global `Math.random` override; gameplay sites
call `simRandom()` from `sim-random.js` explicitly and cosmetic code keeps the native RNG.)*

Two load-bearing sub-decisions surfaced in live testing:
- **Fixed-timestep accumulator, not one-step-per-frame.** Advancing one `BENCH_DT` step per rAF frame ran 2×
  on a 120 Hz screen. Both record and playback accumulate real elapsed time and take whole `BENCH_DT` steps,
  so pacing is real-time on any refresh rate while each tick stays a fixed dt. Frames ≠ ticks by design.
- **The seeded RNG must feed the sim ONLY.** Because frames ≠ ticks, any cosmetic per-frame `Math.random`
  (stars/FX/HUD/idle frames — and audio, which only runs when the ctx is unlocked) would consume the seeded
  stream by a count that differs between record and playback → divergence. Fix: keep a private seeded PRNG
  and swap it into `Math.random` **only around `update()`/`reset()`**, restoring a native (cosmetic) RNG for
  everything else; `audio.js` randomness moved to its own module-local PRNG. This is a stricter contract than
  §58's `?bench` (which runs headless with no cosmetic frames between ticks, so a bare global override
  sufficed there). Verified bit-for-bit (rounded-position state hash) across frame rate / audio / model-load
  timing. Also: record/playback wait for the ship `.glb` before the first tick (a **Start recording** button;
  playback holds the idle frame) so a run never opens on the blue placeholder.

**Storage:** recordings are treated as an **S3 asset** (like ship `.glb`s — off git, synced prod↔local via
`assets:pull`, referenced from seed when promoted to prod), chosen over committing traces to git or a DB
table. The current build uses `localStorage` (`replay:{id}`/`replay:last`) + a `{id}.json` download as the
same-browser dev loop, and the canonical intro trace ships as a content-hashed S3 asset (`recordings/`
prefix in `assets-config`/`assets-pull`, referenced from the `level-1` descriptor's `introTrace`, bundled
into the itch build). See `docs/plans/2026-07-09-replay-record.md`
and the `/record-playback` skill. **Testing caveat (bit us once):** the `localStorage` store is per-browser,
and Claude's `claude-in-chrome` automation drives the maintainer's REAL Chrome — so automated test recordings
write to the same `replay:last`/`replay:{id}` and can clobber the maintainer's own recording (they'd then see
a test clip on `?playback&cutscene=1` and think it's broken). When testing via automation, use throwaway ids
and clean up afterward; restore `replay:last`. Cross-ref §59 (transform-replay backdrop this supersedes for
foreground), §58 (`?bench` seeded-replay foundation reused), §30 (simplest-thing-that-works).
---

## 63. Intro cutscene is gated by server progress alone (no client `introSeen`), so `reset-progress` replays it

The intro's one-time-ness comes from **`current_progress`**: the server serves the `introTrace`-carrying
`level-1` descriptor only while `current_progress === 1`, and `finishIntro` → `unlockNextLevel` advances
1→2 (thereafter the served level has no `introTrace`). So the bootstrap gate is now a pure
`shouldPlayIntro(location.search, CATALOG.level.introTrace)` — "the served level carries `introTrace`" +
the existing headless check — and nothing else. We **dropped the redundant client
`localStorage['introSeen']` guard**: it persisted across a server-side progress reset and permanently
suppressed the cutscene on that browser, so `reset-progress` dropped the player straight into the playable
Level 0 instead of replaying the intro (the exact bug found in live-test). **Trade-off accepted:** if
`finishIntro`'s server advance fails (e.g. a network error) progress stays 1, so a reload replays the
cutscene — acceptable, because the replay is READ-ONLY (`G.replayMode`) and skippable and correctly
reflects "you have not actually advanced." Single source of truth, simpler (§30). Cross-ref §61 (the
`current_progress` +1 intro model) and §62 (the input-replay the cutscene rides on).
---

## 64. Language switching is surfaced only on the welcome screen, the Settings modal, and the intro cutscene — one re-localize entry point drives all toggle hosts via a small registry

**Problem.** A player whose browser defaulted to Russian (common on itch.io) could only change language via
the EN/RU toggle on the **welcome screen** — which a brand-new player never sees (the intro drops them straight
into the Level-0 cutscene) and returning players skip (they land on the Main Window / a live fight). They were
stuck in the wrong language with no escape.

**Decision.** Surface the same EN/RU toggle in two more places — the **Settings modal** (`#settings-lang`, the
single post-intro path, reachable anywhere incl. mid-fight since the gear pauses) and the **intro cutscene**
(`#cutscene-lang`, a persistent top-left toggle beside Skip) — and **not** as a persistent in-combat HUD control
or on the Main Window / hangar / shop (Settings is the one place, keeping the chrome uncluttered; §30). No new
i18n framework: this is pure wiring of the existing mechanism (§10) into two more hosts.

**How.** A **single re-localize entry point** — `applyTranslations()`, called by both bootstrap's initial load
and `setLanguage()` — re-renders **every** mounted toggle host from a module-scoped `langHosts` registry (via the
pure `langButtons(current)` helper + `mountLangSwitch()`). Putting the host rebuild in `applyTranslations()` (not
only in `setLanguage`) is load-bearing: bootstrap resolves + loads the real language and then calls
`applyTranslations()` **without** ever calling `setLanguage`, so a non-`en` initial load (the RU-on-itch target
user) highlights the right button on **first paint** instead of staying stuck on EN. To avoid an import cycle
(`welcome.js` already imports from `settings.js`/`credits.js`), the static `#settings-lang` host is mounted from
the i18n-glue module (`welcome.js`) rather than importing `setLanguage` into `settings.js`; the dynamic cutscene
host is mounted from `main.js` (which already imports from `welcome.js`).

**Cutscene safety.** `cutOverlayEl` has a whole-overlay click→advance listener, so the cutscene toggle host is a
separate `<body>` sibling (its clicks don't bubble through the overlay) **and** each button `stopPropagation`s
(belt-and-suspenders) — tapping it re-localizes the visible card in place without advancing/skipping. Its
lifecycle is tied to the cutscene overlay (built in `buildCutsceneOverlay()`, removed in `cutsceneEnd()`), so it
can't leak into the playable-Level-0 fallback (which never builds the overlay) nor live Level 1. Cross-ref §10
(single i18n path), §30 (no gold-plating), §63 (the intro cutscene it rides on).
---

## 65. Narrative register: grounded rookie + diegetic mechanic-teaching, not chirpy tutorial voice

**Problem.** The original intro/first-mission copy read naive: the briefing tone-shifted from "pirates are
raiding our home system" straight into chirpy tutorial-speak ("**Good news:** you've got a fast, nimble ship");
the cutscene was a string of hero quips ("Heh —", "So this is what all those years of training were for",
`!!!`) with no fear or cost; and lines existed transparently to explain mechanics ("mine just cut out" to
justify disabled rockets).

**Decision.** The pilot is a **rookie Vega Sentinel** ambushed on approach to their first posting — **scared but
holding**, no quips, no exclamation-mark bravado. Mechanics are taught **diegetically through the beats** rather
than narrated as tutorial: dodge enemy fire (p1) → the ship's own **rocket launcher** downs the second pirate
(p1→p2) → an enemy rocketeer's missiles can be **outrun** (p3) and **shot down** with the cannon (p4). The
Level 1 briefing switched POV to a **station dispatcher** (relieved, a little wry) who asks the player to clear
the pirates off the station **first** and sort out the rest later — this is the register to keep for later
briefings (it matches the already-good Level 4 voice; the Level 2/3 salvage framing already fit). Keep the
starter weapon the **cannon** (+ rockets) so the Machine Gun stays the Level-1 salvage reward (don't hand the
rookie an MG in the intro — it breaks the L2 "pulled it out of the wreckage" arc). English stays the source of
truth (§10); RU mirrors. Cross-ref §63 (the intro cutscene), §64 (its i18n plumbing).
---

## 66. Shield = break-then-recharge (partial holds; recharge only on FULL depletion, refills to full), one damage router, weight 0

**Problem.** Adding a regenerating damage buffer to the starter ship opened several independent choices:
the recharge model, how many damage sites to touch, and how much the base emitter should weigh.

**Decision.**
- **Mechanic = break-then-recharge, not a continuous regen.** The shield holds its remaining value
  **indefinitely** until a hit **fully depletes** it; only then does it go inactive and recharge over
  `rechargeSec`, refilling to **full** capacity and reactivating. Partial damage never starts a recharge.
  This is one clear player-legible state machine (active ↔ broken) rather than a fiddly always-trickling
  bar, and it mirrors the repair-drone's pure/stateless shape (`absorbDamage`/`shieldRecharge` in
  `components.js`, caller holds `_shieldValue`/`_shieldRechargeAccum`, ticked off the sim `dt`).
- **One damage router.** Every incoming player-damage site (enemy bullets in `sim.js`, rocket blast in
  `projectiles.js`) goes through a single `applyPlayerDamage(player, dmg)` helper (shield-first absorb,
  overflow spills to the hull), so shielding can never be forgotten at one site. The player entity is
  passed **explicitly** (not read from a module global) so the routing branch is state-independent /
  testable. `applyPlayerDamage` itself is untested glue (projectiles.js pulls in Three at module top → not
  Node-importable); the required coverage is on the pure functions it calls, per the repair-drone precedent.
- **Base shield `weight: 0`.** The shield sits on the *starter* ship, so any nonzero weight would silently
  nerf starter accel/turn (mass 50 → 54) **and** force a `REFERENCE_MASS` bump (which also buffs every
  enemy's `massFactor`) plus mass-test churn. Weight 0 keeps starter handling + all enemy balance
  byte-for-byte unchanged — thematically "the base emitter is negligible; heavier capacitor tiers add mass
  later." `'shield'` is still in the `shipMass` loop so future weighted tiers count.
- **HUD "Health" label dropped.** With a shield bar stacked directly above the health bar, one label can't
  correctly name both; the colour-coded bars (blue/purple shield over a red hull) are self-descriptive.

Optional slot + a buyable base tier mirror the grab precedent, incl. the SQLite-migration + Postgres
back-fill for existing players. Cross-ref §30 (keep it simple — no FX / tiers / enemy shields this pass),
§40 (grab back-fill this mirrors), §57 (grab as the optional-component precedent).
---

## 67. Backend is Postgres-only — the SQLite layer was dropped to kill dual-implementation drift

The data layer was written twice by hand — `db.js` (SQLite via `node:sqlite`) and `db_postgres.js`
(Postgres via `pg`) — selected at runtime by `datastore.js` on `DATABASE_URL`. Every schema/query change
had to land in **both** files, and the test suite only ran the SQLite copy for free, so Postgres-only
bugs (a JS boolean into an INTEGER column; a missing transaction) repeatedly slipped through until a
separate `test:pg` pass. That parity tax is the documented recurring risk (was the
`backend-parity-sqlite-postgres` memory note).

**Decision:** Postgres is the single storage engine. Deleted `db.js` (SQLite), `migrate.js`, and
`migrations/001…023`; renamed `db_postgres.js → db.js`; `datastore.js` is now a static façade over it.
The idempotent bootstrap + `migrations_pg` one-shot ledger is the single forward-only migration story.

**What replaced SQLite's one real benefit — zero local setup:** the test suite drops+recreates a local
`spacegame_test` DB in a `pretest` step (matching CI's throwaway `postgres:16` container), and the pool
defaults to `postgres://localhost:5432/spacegame` so `npm start`/`reset.js` still work with no env. This
is cheap now that Postgres runs locally (Homebrew `postgresql@16`, same major as prod/CI).

**No runtime change:** prod already ran Postgres; forward-only migrations (§9) mean the prod schema is
untouched. Cross-ref §30 (keep it simple — one backend, not two).

## 68. Shield-hit FX = a hand-written shader bubble, not a flat ring or a bought flipbook

The shield was mechanically complete (§66) but had **no visual** — hits and recharge were invisible except
for the HUD bar. We wanted "a wave rippling out from the impact point." Three approaches were on the table:
**(A)** cheap additive **primitives** in the existing FX vocabulary (a flat expanding ring on the combat
plane, like the ship-death shockwave); **(B)** a **shader bubble** — a translucent sphere around the ship
with a Fresnel rim and a per-impact ripple in the fragment shader; **(C)** a bought/free **flipbook** VFX
sprite sheet (pre-rendered hex-shield frames played as a billboard).

**Decision:** ship **B**. Reasoning, confirmed by live iteration in the maintainer's hands (not on paper):
- **A read as "a small explosion," not "a force field."** A flat plane ring under our near-top-down camera
  looks like a decal, and it doesn't convey a *sphere* around the ship. We prototyped A first and rejected it
  live. (A survives in one spot: the recharge-complete cue started as a plane ring but the maintainer wanted
  the **whole sphere** to flash, so that too became a bubble effect — `uReady`.)
- **C (flipbook) clashes with our art + camera and is rigid.** Our entire FX language is clean additive glow;
  a painted hex-texture sprite reads as a foreign asset, can't be re-tinted/re-timed live (baked frames), and
  billboards flat under the top-down camera. It would also add a **third-party asset** (CREDITS.md +
  attribution upkeep) for a look we can get procedurally.
- **B is 3D-correct, fully tunable live, and asset-free.** The sphere genuinely wraps the ship; every knob
  (radius, ripple speed/width, hemisphere reach, idle-rim strength, colors, flash duration) is a uniform/const
  we tuned in real time. Being an authored shader, it needs **no CREDITS.md** entry.

**Constraints honored:** the FX is **pure render** — it reads sim state (player pos, shield value) but never
writes it and uses **no seeded RNG**, so record/playback + the intro cutscene stay bit-identical (the same
rule that governs all cosmetic frame work, per the record/playback design). `applyPlayerDamage` was moved to
`components.js` and made to return `{ absorbed, broke }` so the trigger contract is unit-tested rather than
buried in the FX path (renamed `applyShieldedDamage` when enemies got shields too, and extended to
`{ absorbed, broke, toHull }` by §137 — `absorbed` alone cannot tell you whether the hull was hurt). Scoped to the **base/starter shield** for now; higher shield tiers can diverge later.
Cross-ref §66 (shield mechanics), §30 (keep it simple — no asset pipeline for a shader we can write).

**Follow-up (2026-07-16): intercept the shot ON the sphere, not just draw the ripple there.** The FX above
computed the ripple *direction* from the impact point but the collision still resolved against the **hull**,
so the bullet flew through the visible bubble and its hit-flash spawned at the ship inside it — the shield
didn't read as *stopping* the shot. Fixed by making the hitbox match the bubble **while the shield is up**:
`resolveHostileBulletHit` now swept-tests the shot against the shield **sphere** (`SHIELD_RADIUS`, exported
from `collision.js` and imported by `shield-fx.js` for the drawn geometry — one source of truth) and returns
the sphere-entry `impact` point; `sim.js` snaps the bullet there before the hit-flash + ripple, so both land
on the sphere surface. A **broken/absent** shield still falls back to the hull swept test (unchanged reach).
This is a **sim/collision** change, not pure FX: while shielded the effective hitbox is the radius-4 sphere
(wider and rounder than the hull OBB), so a few near-misses are now caught by the shield — a deliberate,
readable "the field is bigger than the ship" trade. We kept the sphere test pure/THREE-free (a standard
ray-sphere) so it stays unit-tested and record/playback deterministic, and **verified the recorded Level-0
intro still wins and reaches the Level-1 briefing** under the wider shielded hitbox (headless playback) — the
mandatory sim-change check (a collision change re-runs through the intro/replays).
---

## 69. Music is too loud → a baked `MUSIC_TRIM = 0.5` on the bus, not a lower slider default or remaster

Players consistently reported the background music as too loud. The Music slider already defaulted to 45%
(≈ middle), so the perceived loudness came from the **tracks themselves being mastered hot** relative to the
SFX — the slider position wasn't the lever. Three options:
- **(a)** lower the slider *default* (0.45 → ~0.22). Only helps players who never touched the slider; anyone
  who had already raised it (the ones complaining loudest) stays loud. Also fights the maintainer's wish that
  the slider sit ≈ middle.
- **(b)** re-master / re-encode the mp3 tracks quieter. Touches binary S3 assets + content hashes + the itch
  bundle for a pure gain change; heavy and irreversible-ish.
- **(c)** a baked gain trim on the whole music bus, behind the slider.

**Decision:** (c) — `export const MUSIC_TRIM = 0.5` in `audio.js`, applied in both `effectiveGain('music')`
(the pure, unit-tested seam) and `applyVolumes` (the live WebAudio graph). Music is ~2× quieter for
**everyone** — new and existing, including players who had raised their slider — while the slider stays the
user's control at its ≈-middle default (45%); 100% now simply means half the old 100%. This mirrors the
existing per-SFX `gain` trims (e.g. kinetic fire at 0.7, §—the sound-map gain), so it's a familiar pattern,
and it's a one-constant change with no asset churn (DECISIONS §30, keep it simple). If music needs to reach
its old ceiling again, raise `MUSIC_TRIM`; the constant is the single knob. Guarded by an `audio.test.js`
case asserting the trim applies to music only (SFX/master untouched).

## 70. Rockets launch straight along the nose — they do NOT inherit the ship's velocity (gun does; rocket must not)

The gun (`spawnBullet`) inherits the shooter's velocity: a bullet's launch velocity is
`nose·projectileSpeed + shipVel`, so shots track with your motion — this feels right for a fast, dumb
kinetic round. It's tempting to make **rockets** consistent ("start at the ship's speed, like the gun").
We tried it locally and it does **not** play well.

What we tested:
- **(a)** add `shipVel` to the rocket's launch velocity, exactly like the gun. Because a homing rocket's
  motion model in `sim.js` collapses velocity to a pure *heading* vector each frame (`vel = headingDir ·
  (|vel| + accel·dt)`), the inherited sideways momentum doesn't read as graceful drift — it just **tilts
  the rocket's nose off the launch direction** (orientation is derived from `vel` via
  `atan2(vel.x, vel.z)`), so rockets visibly fire "crabbed" sideways when you're moving.
- **(b)** decouple it: keep **thrust** strictly along the nose (drives orientation + homing) and carry the
  ship's velocity as a separate constant `drift` added to position. Nose then points correctly, and the net
  initial velocity matches the gun's. But the constant lateral drift makes rockets **slide past** a target
  you're strafing and the flight arcs feel floaty/unpredictable — a "more realistic" model that's simply
  less fun to aim.

**Decision:** keep the original behavior — `spawnRocket`/`spawnSpiralRocket` set launch velocity to
`nose·launchSpeed` with **no** velocity inheritance (the existing `// start direction - strictly along the
ship's nose (without the ship's inertia)` comment stays). Realistic inherited-inertia physics is explicitly
rejected for rockets on **playability** grounds: a homing rocket wants a clean, readable launch heading, not
momentum drift. The gun keeps inheriting velocity; the asymmetry is intentional. No code shipped — this entry
exists so we don't re-attempt it.

## 71. Asteroids: real `.glb` model for the mission FIELD only — the distant backdrop stays procedural

> **Superseded for the distant BACKDROP half by §96** (the backdrop is now a player-locked wrapping
> `THREE.Points` speed field — no rocks at all, procedural or modelled); the mission `asteroid-field` half
> below still stands (real `.glb` rocks up close).

The asteroids were procedural (noise-deformed icosahedra + `makeMoonTexture`): the parallax **backdrop**
field (`makeAsteroids`) and the mission **`asteroid-field`** set-piece. We put a real CC-BY model pack
("Wandering Asteroids Of Andromeda" by ARCTIC WOLVES™, **3 rock meshes** in one `.glb`) into the mission
field, and **deliberately left the backdrop procedural**.

- **Why the split (the load-bearing call).** We first wired the model into BOTH. The mission field is only
  ~24 rocks + 2 host rocks (~20–25k tris, rendered only when you're actually in the field) — the model
  there is basically free and looks great up close. But the **backdrop** is a full-disk field of **2000**
  instanced rocks: at ~800 tris/mesh that's **~1.6M tris on screen** (vs a ~70–100k budget), and at that
  distance each rock is a **sub-pixel speck** where the model detail is wasted. Instancing collapses draw
  calls but not triangle count, so it's pure cost for no visible gain. So the backdrop reverted to the
  procedural low-poly icosahedra (`IcosahedronGeometry(1,0)` = 20 faces × 2000 ≈ **40k tris**). Rejected
  alternatives: a heavily-simplified backdrop LOD (~40–70 tris/rock → ~100–140k tris, still over budget and
  more build complexity for a two-asset pipeline) and texturing the procedural backdrop (a texture doesn't
  read on a sub-pixel dot).
- **The shared loader.** `loadAsteroidPack(url)` (cached per URL) loads the pack once and returns 3
  variants, each geometry **re-centered on its bounding sphere and scaled to unit radius**, so the field
  sizes a rock by a single scale factor (matching the old `radius` arg). The field **clones** a variant per
  rock with fog **OFF** (readable up close), set on a material clone so the pack's material isn't mutated.
- **Keep the procedural path as a fallback.** Under `?debug` (the visual-test hook) or if the model fails
  to load, the field falls back to the original procedural rocks — so the headless visual baseline is
  unchanged and a CDN/asset hiccup degrades gracefully instead of emptying the field.
- **Async build like the freighter.** The model loads async, so the field returns an empty group now and
  populates on load; the random scatter/tumble list is **precomputed synchronously** so the tumble
  animation matches whatever ends up rendering (procedural now, or model-on-load).
- **Build preset (the fiddly part).** The source is a 4.5 MB textured pack; the combat build is ~171 KB.
  Three non-obvious steps: (1) three.js r160 **dropped `KHR_materials_pbrSpecularGlossiness`**, so the source
  is converted spec-gloss → **metal-rough** (`gltf-transform metalrough`) or the rocks render untextured;
  (2) `gltf-transform optimize` **prunes "solid-color" textures by default**, and the low-contrast rock
  diffuse maps trip that heuristic — baking them to a flat dark `baseColorFactor` and dropping ALL surface
  detail. Fixed by threading a **`--prune-solid-textures`** flag through `assets-build.mjs` and setting
  `pruneSolidTextures: false` in the `asteroids` preset. (3) **meshopt compression must be OFF for this
  pack** (`compress: false`): `EXT_meshopt_compression` + `KHR_mesh_quantization` **shreds these meshes'
  geometry and normals into a shattered, spiky mess** in-game (the raw model coordinates quantize badly;
  the ships survive the same pipeline, these don't). Diagnosed by rendering source vs built geometry with
  `MeshNormalMaterial` — the source is smooth, the meshopt build is chaos. Disabling meshopt keeps the
  geometry raw float32 (~171 KB, fine for a set-piece). Geometry is **not** simplified either (the source is
  already ~700–870 tris/mesh; simplifying shreds the rounded silhouette into angular shards). Textures →
  256px WebP.

Note the asteroids stay **non-collidable decor** (like before) — "solid asteroids with bounce" remains a
separate future idea.

## 72. The `/v2` experimental sandbox is a SUBPATH on shared prod DB — safe only because it is client-only

We want a live, shareable URL to prototype the FX-polish visuals ("juicier" shots/hits/explosions) and
test them on a real weak phone (a Galaxy A03s), without risking production. Two axes were decided:
**subpath `vega.tenony.com/v2`** (over a `v2.` subdomain) and **shared production Postgres** (over a
separate `spacegame_v2` DB). See `docs/plans/v2-experimental-branch.md` for the build brief.

- **Why subpath over subdomain.** Same origin → the v2 client shares the prod cookie/session and its
  `fetch('/api/...')` is an **absolute-from-root** path (`API_BASE = ''`), which has no `/v2` prefix, so
  Traefik routes it to the **production `app` container** with **no CORS and no second backend**. Only the
  static client files under `/v2` are served by a separate `app-v2` container (Traefik `PathPrefix(/v2)` +
  StripPrefix). A subdomain would have made `/api` cross-origin (solvable via our existing Origin-reflecting
  CORS + Bearer auth, like the itch build) but for no benefit here — the subpath is strictly simpler.
- **Why shared prod DB is acceptable — and the load-bearing constraint.** It is acceptable **only because
  v2 is a hard client-only branch**: no `server/` code, no API/schema/migration changes, no
  `catalog_seed.js` changes, no persisted-sim changes. The in-scope FX work is **pure render** (particle
  emitters, materials, post-processing) — it touches no sim RNG and no persisted state — so sharing the
  live DB lets us test on our real account with zero data risk. If an experiment ever needs a server or
  schema change it does **not** belong on `/v2`: promote it to a normal `feature-pipeline` branch first.
  The accepted downside of the subpath choice: the `app-v2` router lives in the same Traefik/compose, so
  standing v2 up is a (one-time) touch of the prod host — but the prod `app` service itself is never
  modified, and v2 is disposable (drop the container → prod is untouched).

## 73. Seeded sim RNG is OPT-IN (`simRandom()`), not an opt-out global `Math.random` swap

Amends §62 (which established the seeded-stream isolation by *swapping* a private PRNG into `Math.random`
around `update()`/`reset()`). The mechanism changed; the goal — record↔playback reproducing a fight
bit-for-bit — did not.

- **The problem the swap created.** Under the opt-out model, *every* draw made anywhere inside
  `update()`/`reset()` consumed the seeded stream — including purely cosmetic ones: explosion sparks
  (~5 randoms × up to 22 sparks per kill), exhaust puffs (2-3 per ship per tick), rocket smoke, and all of
  `world.js`'s decor/set-piece scatter (rebuilt *inside* `reset()`, i.e. **before tick 0**). So any FX or
  decor change shifted the stream and desynced the canonical Level-0 intro trace. It shipped **three times**
  in three weeks — `db78736` (shield sphere → extra absorbed hits → extra spark draws), `7d8fa50`
  (asteroid-field `.glb` → different decor draw count inside `reset()`), `0e5766a` (flipbook/bolt FX → the
  explosion path again) — each time turning a new player's *first* impression into a broken cutscene that
  shot at empty space and never cleared. The reviews couldn't catch it: nothing in an FX diff *looks* like
  it touches replay.
- **Bonus: the old model made a trace device-dependent.** Spark/exhaust counts are gated on the graphics
  tier (`G.gfx.particleScale`/`maxParticles`), so the same trace consumed a *different* number of seeded
  values on a Performance-tier phone than on a High-tier desktop — the intro could desync on a weak device
  with no code change at all. Opt-in removes that class of bug too.
- **The decision.** The stream lives in `client/src/sim-core/sim-random.js` (`simRandom()`/`seedSim()`/`isSimSeeded()`
  + `mulberry32`, imports nothing). Roughly **8 gameplay draw sites** opt in explicitly (which enemy spawns,
  the spawn cooldown injected into `stepSpawnGate`, spawn angle/distance, initial enemy heading, enemy reload
  stagger, the drop roll, `pickLoot`); everything cosmetic keeps the native `Math.random` and is
  replay-neutral **by default**. `withSimRand`/`installSeededRandom` are deleted, so the trap cannot be
  re-armed by new FX code.
- **Alternative considered — keep the swap, move the cosmetic modules onto a captured native RNG.** Rejected:
  it inverts the same trap rather than removing it. Every future FX/decor addition would have to *remember*
  to import the cosmetic RNG, and forgetting is silent (it only surfaces weeks later as a broken intro). The
  opt-in direction fails safe: forgetting means "cosmetic", which is the common case and is harmless.
- **Accepted costs.** (a) A *missed gameplay* site now degrades determinism **non**-deterministically (a
  replay drifts) instead of deterministically — mitigated by the site list being short, enumerated and
  commented, plus the new committed guard test (`client/visual/scenarios/22-intro-replay.mjs`) that re-sims
  the canonical intro trace and asserts 4 kills / cards `p0..p4` / win. (b) Decor/asteroid layout now varies
  between two playbacks of the same trace — cosmetic, and in normal play it already varied run to run.
- **Purification invalidates every pre-existing trace** (cosmetic draws vastly outnumbered gameplay draws, so
  the stream is necessarily different) — there was no salvage path. The intro trace was **re-recorded**;
  older local `?playback` clips in `localStorage` are invalid too. To make a failed re-sim harmless in the
  meantime, the same change added a **return-home watchdog** (`CUTSCENE_STALL_TICKS` ≈ 15 s of sim time) and
  mirrored `animate()`'s end-of-trace exit into `__replay.step()`: both route through
  `cutsceneEnd()` → `finishIntro()`, so a broken re-sim ends on the Level 1 briefing instead of hanging.
- **Unaffected.** The `?bench` perf gate (§58) stays valid — it is load-pinned and compares medians, not
  state hashes (its `finalHash` legitimately differs across this change, since the two builds simulate
  different fights). The ghost-battle backdrop (§59) is a transform replay and is never re-simmed. Live play
  is unchanged: with no seed installed, `simRandom()` delegates to `Math.random()`. Consistent with §30
  (simplest thing that works: one leaf module, no framework).

## 74. Exhaust FX = one shared shader plume with a GLOBAL look toggle; ship trails go straight (curve dropped)

**Context.** The game had **two** independent engine-exhaust systems, both per-frame CPU particle clouds:
the cargo-freighter set-piece (`world.js`, a `THREE.Points` cloud re-uploading position **and** color
buffers every frame) and the per-ship engine trail (`projectiles.js`, a growing pool of additive sphere
puffs — a curved *history* of past emit positions). The recent FX pass (`bolt-fx.js` / `flipbook-fx.js`)
established a house style: bake a texture **once**, compile **one** program per look, per-instance material
with uniforms, no per-frame allocations. This unifies both exhaust systems onto that style.

**Decisions.**
1. **One shared plume module (`exhaust-fx.js`), both systems.** Freighter + every ship use the same
   `makePlume` factory: a baked-once glow texture, an axis-aligned plume streaming along the model's aft
   `-Z` (NOT a camera-facing billboard — a billboard fights the stream under the near-top-down camera).
   Freighter reads `spec.exhaust` merged over module defaults; ships derive a 3-stop palette from the
   engine's single `exhaust.color`. `spec.exhaust` + engine `stats.exhaust` schemas are **unchanged** (new
   `turbulence`/`softness` are optional client-side defaults) — no server/catalog change.
2. **Ship the (a) point-glow + (b) noise-scroll flame looks BEHIND a GLOBAL `?dev` toggle; decide the final
   one on a live build.** Every plume (freighter + all ships) builds **both** meshes and renders whichever
   the shared `currentMode` selects. The `?dev` Exhaust panel's Mode dropdown flips **all** plumes at once
   (`setGlobalExhaustMode`); palette/shape sliders are **freighter-only** (ships keep their engine-derived
   palettes). Per-ship cost stays sane — one Points mesh + one flame quad that reuses a **module-singleton
   geometry** (N ships don't multiply geometry). Why a live toggle vs. picking one now: visual/feel calls
   only settle in play (the maintainer picks by eye) — `visual-features-need-early-playable-build`.
   **Amended 2026-07-27 (live-tuning outcome):** on a live build the maintainer rejected `points` (reads as
   slow drifting particles, not engine thrust) and picked **`flame` as the shipped default** — an intense,
   fiery-orange (default until exotic/ion engines), short, dense jet with a bright hot core and fast flicker.
   `points` stays as a `?dev`-only legacy option (full removal is a parked follow-up). The freighter runs a
   longer, hotter plume than ships (its own `len`/`softness` uniforms).
3. **Ship trails go straight (no curved position-history) but with a YAW LAG.** The old trail *curved*
   because it was a history of past emit positions; we intentionally dropped that history. **Amended
   2026-07-27:** the first cut parented the plume rigidly to the hull, so a fast turn snapped the whole tail
   around with the nose — unnatural on a small ship with a long tail. The ship plume is now **scene-parented
   and tracked to the hull each frame** with a smoothed yaw **slerp** (`syncShipPlume`, catch-up `k = 1 −
   e^(−8·dt)`), so the tail trails behind on a fast turn and settles straight in level flight — natural jet
   inertia, still no per-position history. A ship fades its plume via a smoothed `throttle` (thrust flags
   `throttleTarget = 1`; `updateShipExhaust` decays it + syncs the transform), so stopping thrust fades out.
   Because it's scene-parented, the flame length is now in world units (independent of hull scale). The
   `trail` particle pool is removed entirely.
4. **Tuning = live `?dev` edit + Copy-JSON export, no persistence.** The panel mutates an in-memory copy and
   the runtime `currentMode` only; **Copy JSON** is the save path (paste tuned numbers into the module
   defaults). Prod behavior is driven only by `spec.exhaust` + defaults, never a dev-session tune. The
   general "unified visual/UX live-tuning panel + save-to-file" is **deferred to ROADMAP** (§30 — build the
   smallest thing that delivers; this `?dev` panel is the first small instance).

**Replay safety (cross-ref §73).** The FX use **no** `Math.random` and **no** `simRandom` — per-particle
seeds are a deterministic `hash(i)` (like `flipbook-fx.js`). Pure render: nothing touches
sim/damage/collision/economy or the seeded stream, so the recorded Level-0 intro re-sim is bit-identical
(the `22-intro-replay` guard passes). Tier gating (§23) moves from per-frame particle thinning to a
one-time count scale at plume attach. No model/asset change → no `CREDITS.md` change, no `/publish-itch`.

**Testable-seam split.** The pure config/fade/palette/hash helpers live in `exhaust-config.js` (no `three`
import) so `node --test` can cover them without the browser importmap — same pattern as
`ghost-battle-track.js` ↔ `ghost-battle.js`.

## 75. Explosions/rings/hits unified onto the flipbook+shader family; CPU spark spray dropped; boss chain-detonation

**Context.** After the exhaust unification (§74), the ship-death burst was still a hybrid: the flipbook
fireball (§72) **plus** a CPU-simulated **spark spray** (`sparks` pool) **plus** a hard `RingGeometry`
shockwave, and the bullet hit-flash was a separate additive **sphere** (`explosions` pool). The maintainer
wanted the whole hit/explosion family to read as one thing — the flipbook look — and dropped the sparks.

**Decisions.**
1. **Ship death = flipbook fireball + a soft shockwave RING only; the CPU spark spray is GONE.** The radial
   spark particles (`sparks.push` in `spawnShipExplosion`) are deleted. (The rocket burst also dropped its
   sparks in decision 6, so the `sparks` pool ends up producerless — see there.)
2. **Shockwave ring → a baked soft-ring TEXTURE on an additive quad** (`ringTexture()` + `ringQuadGeo` +
   `spawnShockRing`), replacing the hard `RingGeometry`. Same bake-once-texture family as flipbook/bolt; it
   reuses the existing `shockwaves` pool (grow-scale + fade in `sim.update`). Both ship death and rocket
   burst share it.
3. **Bullet hit-flash → a small flipbook mini-blast** (`spawnHitSprite`, reusing the SAME baked fire sheet,
   small + fast), replacing the additive sphere. So a hit reads as a tiny explosion in the same family.
   (Muzzle flash + player-arrival flash keep the cheap `spawnExplosion` sphere — not worth converting.)
4. **Bosses get a STAGED chain detonation** (`spawnBossExplosion`, gated on role `boss`/`boss2`): an
   oversized primary fireball + a big ring NOW, a brighter **yellow** SECONDARY detonation a beat later
   (the reactor going up, `uTint` > 1 under additive blending) + its own ring, and a few small pops
   scattered around the wreck. Timing is a deferred queue (`deferredBlasts` + `updateDeferredBlasts(dt)`,
   cleared in `reset()`); offsets/delays are DETERMINISTIC (a local `bhash`, NO `Math.random`).
5. **Flipbook smoothness = more baked frames + shader frame-blending, NOT a faster playback.** The sheet
   went 6×6=36 → **8×8=64** frames (1024→2048 px) and the fragment shader **cross-fades** the current
   baked frame into the next by `fract(uFrame)` (`uFrames` uniform) — synthesized in-between frames make
   the blast buttery at any duration. FPS (frame-advance) sets duration only (~1.8 s); a slower blast stays
   smooth because of the blend.
6. **Rocket detonation joins the family; the blast look is WEAPON-DRIVEN.** `spawnRocketBurst` now spawns
   the same flipbook fireball (`spawnFlipbookExplosion` gained `tint` + `speed` args) + soft `spawnShockRing`
   — smaller, faster (`speed = 1/blastTimeScale`) and **brighter** (a white-hot `uTint` > 1). The old layered
   additive spheres + spark spray are dropped. Every visual knob comes from the **rocket weapon's stats** in
   `catalog_seed.js` — `blastVisual` (size), `blastTimeScale` (speed), `blastTint` (ring color), **`blastBright`**
   (fireball brightness) — threaded weapon → `spawnRocket` → `detonateRocket` → `spawnRocketBurst`. So a
   NEW weapon type gets its own blast display by setting those keys, no FX-code change. `blastBright` defaults
   to `1.6` **in code** (like `spec.exhaust`) so the look is correct even before a catalog reseed; the catalog
   value is the per-weapon override. Net effect of §75: the **`sparks` pool now has no producers** — it's left
   declared (empty, harmless); full removal touches `main.js`/`state.js` and is deferred behind in-flight
   parallel work.

**Replay safety (cross-ref §73).** All of this is pure render: no `simRandom`, no `Math.random` in the FX
timing/placement (deterministic hashes), no sim/damage/collision/economy change. The intro (Level 0) has no
boss, and the `22-intro-replay` guard asserts sim state (kills/cards/win), which stays bit-identical.

**Perf note.** The flipbook sheet is now 2048² (one shared texture, uploaded once) — a deliberate
quality-over-footprint call for the flagship explosion; the draw-call win (§72) is unchanged. Ring/hit are
still one additive quad each.
## 76. Enemy shields carve HP out of the existing pool instead of adding a new layer

Every enemy ship now has a shield with the player's exact semantics, but it is **carved out of the HP it
already had** — `shieldCap = Math.round(durability / 3)`, `hullMax = durability − shieldCap` — not stacked on
top.

- **Carve, not add.** A shield *added* on top would have raised every enemy's effective HP by a third,
  silently re-tuning the whole campaign (time-to-kill, level pacing, the "N enemies left" beats) **and**
  desynced the recorded Level-0 intro, which is an input replay on the real sim: if the Nth bullet no longer
  kills on the same tick, the trace runs out of input with enemies alive. Carving keeps the **first kill
  window** costing exactly the damage it cost before shields. The split is integer and exact
  (`shieldCap + hullMax === durability`) and the damage router is **lossless** — the shield absorbs and the
  excess spills to the hull **in the same tick**, no rounding, no clamping, no per-hit cap, death test still
  `hp <= 0` — which is what makes "same hits to kill" a provable invariant (unit-tested across every enemy
  durability × per-hit power) rather than a hope. The intro guard `22-intro-replay` still passes.
- **The regen half of the trade-off, stated honestly.** The recharge is **player-identical**: it runs from the
  **breaking hit** and **keeps banking under continuous fire** (hull damage never resets the timer, and a
  *partial* shield never recharges at all). So an enemy that survives 10 s past a break gets its **whole**
  shield back: **+183 HP per 10 s for the second boss, +103 for the first boss, +100 for the advanced medium
  pirate, +50 for the mini boss, +10/+12 for the small pirates.** "Total effective HP is unchanged" is
  therefore true only of the first kill window — **long fights ARE harder than before.** The maintainer was
  shown these exact numbers and the intro-desync risk and chose this deliberately ("shields come back"), and
  the **player's** shield semantics were deliberately left untouched (the asymmetry is accepted). Framing it
  as "only matters if you disengage" or "sustained burst" would misdescribe the code — there is no
  timer-reset-on-hit anywhere.
- **Hull hitbox kept for enemies**, unlike the player's `SHIELD_RADIUS = 4` sphere interception (§68). Widening
  every enemy's hitbox by a sphere would change aim feel across the entire game — the one thing a combat
  change must not do incidentally. The drawn enemy bubble is therefore sized **snug to the hull**
  (`broadRadius(enemy) × 1.05`, world units) so the "the shot stopped at the surface" mismatch stays small.
- **Derived, not a DB component.** The shield is computed at spawn from the hull's `durability`, so there is
  no migration, no new catalog column, and no side effects on loot drops / resale / the `Pirate hull` item.
  One knob (`ENEMY_SHIELD_FRACTION`) governs every enemy, and the derived object deliberately has **no
  `weight`** so `shipMass` skips it and enemy mass/accel/turn are bit-identical (another intro-desync vector,
  closed with a unit test). Per-ship shield tuning is a future balance pass, not this change (§30).
- **`applyPlayerDamage` is now `applyShieldedDamage`** — one router for both sides. A second copy for enemies
  is exactly how the lossless invariant would have silently drifted; the rename makes the shared ownership
  obvious. (§68 keeps the old name as history.)
- **Enemy bubbles are ripple-only and tier-capped** (High 6 / Balance 3 / Performance 0, oldest slot
  recycled): N always-on transparent spheres would be a weak-phone additive-overdraw tax for no readability
  gain, and the always-on Fresnel rim stays a **player-exclusive** read ("that one is me"). An enemy that
  can't get a slot still shows the HP-bar shield strip and the cyan hit flash, so the mechanic never becomes
  invisible. The bubble pool is pure render (no sim writes, no seeded RNG) per §73. A **recycled** slot
  retires its old impact ring on rebind, so a previous enemy's sub-second ripples can't replay on the new
  enemy's bubble.
- **The absorbed-hit flash reuses the unified FX family (§75) rather than a bespoke effect.** `spawnHitSprite`
  gained an optional per-blast `tint`, and an absorbed hit is the same flipbook mini-blast at 0.7× scale with
  `SHIELD_HIT_TINT` — one more `uTint` value on the already-shared program/texture (the same mechanism §75
  uses for the boss secondary detonation), so it costs no new draw-call family, no new texture and no new
  shader, while still reading unmistakably different from the orange hull spark.
- **Sound deferred.** An absorbed hit currently shares the hull-hit audio; a distinct absorb voice would apply
  to *both* sides and is scoped in the ROADMAP backlog rather than bolted on here.

## 77. The combat build FLATTENS a model's per-part materials; the hangar build keeps them

**Problem.** Telemetry from a real weak phone (Samsung SM-A037F / PowerVR Rogue GE8320, `?dev` →
`perf_samples`) showed the frame spending 42-67 ms in `js.render` — our own draw-call submit — with 45-69
draw calls in a fight. Counting primitives per asset found the cause: the **player ship alone was 31 draw
calls, 31 materials and 79 textures**, against **3-5 primitives** for every other ship in the game. It is a
Sketchfab model split "part x material" (110 meshes over 36 materials): the same material kind is repeated
per body part — `Body_Chrome`, `Gun_Chrome`, `Canopy_Chrome`, `Thrusters_Chrome` — each with its own
base/metallic-roughness/normal/occlusion set. `gltf-transform`'s `join` can only merge primitives that
SHARE a material, so the build collapsed 110 meshes to 31 and stopped there. This is the §23 bottleneck
(CPU draw-call submit, not fill rate) coming from a single asset.

**Decision.** The **combat** build gets a pre-pass (`scripts/assets-flatten.mjs`, opted in per model with
`flattenMaterials` in the preset) that replaces each material with flat factors — base colour, metallic,
roughness, emissive — **sampled from that material's own maps**. `optimize --palette` then merges the
factor-only materials into one palette-textured material and `--join` collapses the mesh. The **hangar**
build is untouched and keeps the full textured material set: it is one lazy-loaded model on a menu screen,
where detail is the whole point and draw calls are free.

**Why sample rather than hand-group.** The obvious approach — bucket the materials into a few visual
families by name and hand-pick their colours — was tried first and got the ship visibly wrong (the red
engine nacelles came out grey). Sampling each material's own average needs no judgement, generalises to any
future model, and costs the same draw calls, because the palette merges N factor-only materials just as
happily as 8.

**Why some materials stay textured.** Averaging is only lossless for a map that is one colour with shading.
Several of this model's maps paint SEVERAL colours onto one material: the red nacelles live inside an
otherwise-grey `Thrusters_Material` atlas, the yellow wing chevrons inside `Wings_Material`. Flattening
everything deletes the ship's livery — it reads grey with thin red stripes. So the sampler also records
`spread` (how far the most-deviant 5% of a map's texels sit from its mean colour) and `keepTexturedAbove`
leaves the base map on the few materials above the threshold. Measured on this ship, **34** is the value
that keeps every visible marking. Even a kept material loses its normal / metallic-roughness / occlusion
maps — each is a texture bind and a heavier shader permutation, and none of it is visible on a ~50px
top-down ship.

**Result:** player combat model **31 -> 15 draw calls in-game, 79 -> 16 textures, 371 -> 178 KB**, with the
ship visually near-identical. The size drop matters on its own: the 371 KB model intermittently failed to
load on the reporting device, which silently falls back to the placeholder primitive
(`ship-factory.js` — "Ship model failed to load, keeping primitive").

**Geometry is never touched** — the pre-pass rewrites only the glb's JSON chunk and passes the BIN chunk
through — so the catalog's generated `model.hitBoxes` / `broadR` stay valid, collision is unchanged, and the
recorded Level-0 intro still replays (guard re-run green).

**Cost.** The sidecar (`assets-src/<base>.materials.json`) must be re-sampled with `npm run assets:materials`
whenever a source model changes, and sampling drives headless Chromium (reusing `client/`'s playwright)
because the maps are jpeg/png/webp inside the glb and we did not want an image-decoding dependency. The
sidecar is the one thing under `assets-src/` that IS committed — it is generated numbers, not a binary, and
the build is not reproducible without it.

## 78. Content-hashed assets are served `immutable` — so there is deliberately NO "reload assets" command

**Problem.** `app.use(express.static(clientDir))` used express's default `Cache-Control: public, max-age=0`,
which does not mean "don't cache" but "cache, then **revalidate every time**". Every asset request therefore
cost a conditional GET and a 304 round trip. The worst case is not page load: ship models are re-requested
on **every enemy spawn** (`ship-factory.js` `applyShipModel` calls `gltfLoader.load` per spawn, there is no
model cache), so a player on a weak mobile connection paid a network round trip per spawned pirate — and
watched enemies fly around as the untextured procedural placeholder until it came back. Reported from the
field; confirmed with `curl -H 'If-None-Match: ...'` against prod returning `304` on `max-age=0`.

**Decision.** Files matching `<name>.<hash8>.<ext>` (`.glb` / `.mp3` / `.json` — the asset pipeline's naming,
DECISIONS 14 + docs/plans/ship-model-pipeline.md) are served `public, max-age=31536000, immutable`.
Everything un-hashed — `index.html`, `src/*.js`, `styles.css` — keeps the revalidating default, so a deploy is
picked up on the next load. The policy is a pure exported `staticCacheControl(filePath)`, unit-tested
(including the near-misses: 7-char, uppercase and non-hex "hashes" must NOT be treated as hashed).

**Why there is no cache-busting / "reload assets" command — and why we don't want one.** The hash IS the
version: change a model and the pipeline emits a *new filename*, the seed points at the new URL, and clients
fetch it because they have never seen that URL. The old file is not stale, it is simply unreferenced. So
there is nothing to invalidate, and an invalidation channel would be a mechanism with no job (DECISIONS 30).
The catalog itself is served from `/api` (never cached), which is what makes this work: the client learns the
new URL on its next catalog fetch, no client-side version pinning involved.

**The one thing that would change this:** if we ever precache with a **Service Worker** (durable Cache
Storage, survives eviction — the natural next step if weak-connection players still lose assets), the SW
script itself is un-hashed and its cached copies are ours to manage. *That* would need a version + update
flow. Until then, don't add one.

**Not fixed by this:** the client still re-PARSES the glb on every spawn (new geometry, fresh texture upload,
one VRAM copy per instance) because there is no parsed-model cache — see the `drops.js` `rewardModelCache`
precedent for the shape of that fix. Headers remove the network round trip; only an in-code cache removes the
work.

## 79. Ship models are parsed ONCE and cloned per spawn — so a live ship's materials are CLONED PER INSTANCE

**Problem.** `applyShipModel` called `gltfLoader.load(url, ...)` on **every spawn**, and nothing cached the
result. The bytes came from the browser cache, but three.js re-ran the full pipeline each time: a new
`BufferGeometry`, a fresh texture decode and GPU upload, and therefore **one VRAM copy per enemy instance**.
Field telemetry from a weak phone showed the cost plainly — in the first seconds of a fight, one frame took
**864 ms**, another second spent **242 ms inside `js.render`**, and `draws` climbed 12 -> 36 as the scene
assembled itself *during* combat. Enemies frequently lived their whole life as the untextured placeholder
primitive because their model had not finished loading yet. (Cache headers, DECISIONS 78, removed the
network round trip; they cannot remove the parse.)

**Decision.** `ship-factory.js` keeps a `shipModelCache` (url -> parsed template + in-flight waiters) and
hands out `template.clone(true)` per ship, and `levelRunner.start` warms every model the level's spawn pools
can produce (`preloadLevelShipModels`). This is the same shape as `drops.js`'s `rewardModelCache` /
`preloadRewardModel`, which already solved exactly this for the last-kill reward drop — we simply never
applied it to ships.

**The constraint this creates.** `Object3D.clone(true)` shares **geometry and materials** with the template.
The geometry sharing is the point — one GPU copy per ship *type* instead of per instance — but the material
sharing meant **mutating a live ship's material would leak to every other ship of that type**. Two paths
already cloned before mutating (the `tint` recolour, and the ghost-battle `darken`/`opacity` readability
treatment), and this section closed with: *anything new that wants a per-ship visual state (a damage flash,
a cloak, a team colour) must clone the material for that instance too*.

**AMENDED 2026-08-30 (§137): that case-by-case clone became ALWAYS-ON at attach.** The damage flash arrived,
and it wants a per-ship visual state on *every* modelled ship, so `applyShipModel` now clones **every**
material of **every** instance immediately before parenting the model, recording each one's baked
`emissive`/`emissiveIntensity` in `group.userData.flashMats` for the flash to restore. The live clone path
therefore **shares no materials at all**, and the per-path `tint` / ghost-battle clones are now redundant
rather than load-bearing — harmless, and left in place. What is still **one copy per ship TYPE** is
**geometry + textures + the compiled shader program**: a clone has identical parameters, so three.js reuses
the program, and nothing is re-uploaded. The rule that survives is the one about the **template**: the
cached template's materials must never be mutated — everything a live ship touches is its own copy.

**Safe on teardown:** a dead enemy only disposes its attached exhaust plume (`sim.js`), never the model's
geometry or materials, so sharing cannot leave another instance with disposed GPU resources. This is also
why the §137 per-instance material clones cost nothing: nothing frees them, so they are simply
garbage-collected with the mesh — and nothing frees the shared compiled program either, which is what §83
depends on. Do **not** add a dispose pass for them: a program dies with its last material, and freeing it
would force a recompile on the next spawn.

**Parsing is only half of it — the model must also be WARMED onto the GPU.** three.js uploads geometry and
textures, and compiles a material's shader program, **lazily: on the first frame the object is actually
drawn**. So the cache + level-start preload above removed the re-parse but still left the frame to pay for
the upload the first time each ship TYPE appeared — field telemetry caught **215 ms inside `js.render`** on
such a frame, and the player reported "a new ship shows up somewhere on the map and it's instantly 2 fps".
`requestShipModel` therefore calls `warmModel()` right after parsing: it parks the template far off-camera
in the **real** scene, runs `renderer.compile()`, and pushes every texture up with `renderer.initTexture()`.
The real scene matters — a program depends on the scene's lights and fog, so compiling against a bare
throwaway scene would build a program that gets thrown away and recompiled on first draw. `compile()`
covers shaders only, hence the explicit texture pass. This mirrors `prewarmShaders()` in `main.js`, which
does the same for the FX materials but runs at startup, long before any ship model exists.

**Guard:** `client/visual/scenarios/26-ship-model-cache.mjs` spawns two ships of one type and one of
another, and asserts the pair shares a **geometry** set while having **per-instance materials** (that
assertion was inverted by §137, deliberately) and remaining distinct scene objects, and that a different
type shares neither. Mutation-verified: with the cache bypassed it still fails, on the shared-geometry
assertion **and** on the `parsed >= 2` cache-size floor — the two checks that actually catch a per-spawn
re-parse. `42-hit-feel.mjs` covers the other direction, on screen: with the per-instance clone removed, the
control ship brightens along with the one that was shot and the pixel assertion fails. The GPU warm itself has no headless guard — software WebGL does not reproduce
the stall — so its verification is the field telemetry (`js.render` spikes on first-sighting frames).

## 80. Per-frame HUD overlays position via `transform`, and never write a DOM value that has not changed

**Problem.** Field telemetry from a weak phone put the HUD at a **fixed ~8 ms per frame** (`js.dom`)
regardless of what was happening in the fight — 40% of a 50fps budget spent before the sim (1-2 ms) or the
renderer even ran. Two habits paid for it:

1. **Rewriting unchanged values.** `updateHud` ran `innerHTML` — an HTML parse plus a child rebuild — sixty
   times a second for a credits line that changes on a kill, and rewrote the same percentages, bar widths
   and `display` values every frame across every pooled element.
2. **Positioning with `left`/`top`.** Every floating overlay (enemy health/shield bars, off-screen enemy and
   loot arrows, credit popups) wrote pixel `left`/`top` each frame, which invalidates **layout** for that
   element. `transform` does not: the compositor moves the box and layout is never consulted.

**Decision.** `hud.js` owns three tiny helpers — `setText` / `setHTML` / `setStyle` cache the last written
value on the node and skip identical writes, and `place(node, x, y, extra)` writes a single
`translate3d(...)` transform. The pooled overlays are pinned at `left: 0; top: 0` in CSS and their own
centring/anchor offsets (`translate(-50%, calc(-100% - 4px))` and friends) moved **into** the JS transform
string, because a JS `style.transform` would otherwise override the CSS one. The radar, which is a full 2D
canvas repaint, is throttled to ~20 Hz (`MINI_INTERVAL_MS`) — nothing on a radar moves fast enough to read
at 60 Hz.

**What was deliberately NOT throttled:** anything anchored to a moving ship — the health/shield bars, the
edge arrows, the credit popups. At 20 Hz they visibly lag behind a ship flying at 60 fps. They stay
per-frame; they are just cheap now.

**The convention this sets.** New per-frame HUD code must go through the helpers: position with `place`,
write with `setText`/`setStyle`. Writing `style.left`/`style.top` in a per-frame path, or assigning
`textContent`/`innerHTML` unconditionally, silently reintroduces the cost. A test that reads back
`style.top` to check placement is now wrong by construction — assert on `getBoundingClientRect()` instead
(scenario `16-enemy-health-bar` was updated for exactly this reason).

**Behaviour is unchanged** — the DOM ends in the same state, the same elements in the same places; only the
redundant work is gone.

## 81. `?dev` is not sticky — diagnostics never outlive the page load they were asked for

**Problem.** The dev flag persisted in `localStorage['devMode']`: a truthy `?dev` turned diagnostics on and
*remembered* it, so every later visit to the same origin kept them on. Convenient for a developer on
localhost, wrong everywhere else — one `?dev` visit left the **perf overlay** (fps / frame ms / draw calls /
triangles / backbuffer size / ship speed / JS heap), the right-docked **lil-gui authoring panels**, the
`window.__backdrop` hooks and the **per-second telemetry POST** running on **vega.tenony.com forever**. That
hit the maintainer on his own desktop and every playtester handed a `?dev` link — the panels visible in a
tester's screenshots were exactly this. Service information does not belong in a live game, and the only way
out was knowing to visit `?dev=0`.

**Decision.** The flag governs the **current page load only**, on every device and every host. `evalDev`
takes the query string and nothing else — no storage is read or written — and the retired `devMode` key is
removed on load so an old visit stops haunting a browser. A developer keeps `?dev` in the URL (or a
bookmark), which is a trivial cost next to diagnostics stuck on the live site.

**Rejected: stickiness only on localhost.** It would have preserved the local convenience, but it makes the
flag's behaviour depend on the host — two environments, two rules, and a bug class that only reproduces on
prod. `?dev` meaning exactly "this load" everywhere is one rule you can hold in your head.

**Consequence for measuring.** Telemetry now requires `?dev` in the URL for **each** session. A tester can
no longer be set up once and left reporting; that is the honest trade — the previous behaviour was
collecting from people who had long forgotten they enabled it.

**Supersedes** the touch-only non-stickiness added just before this (`evalDevForDevice`): with no
stickiness anywhere, the device axis is moot and the helper is gone. The other half of that change — never
building the right-docked lil-gui panels on touch, since they are mouse-only tools — **stays**, and is
independent of this flag.

**Guard:** `client/src/dev.test.js` pins that only the documented truthy forms turn it on, that everything
else (including an unknown value) is off, and that the decision is storage-free — a fake storage returning
a set flag cannot turn diagnostics on, and `evalDev.length === 1` fails if a storage argument creeps back.

## 82. High-volume FX goes through an instanced pool — one draw call per particle KIND, not per particle

**Problem.** Every FX primitive was its own `THREE.Mesh` with its own `MeshBasicMaterial`, so every particle
cost a draw call. A draw call carries a fixed cost almost independent of what it draws (measured at ~0.25 ms
on a PowerVR GE8320), so hundreds of tiny puffs cost hundreds of times the setup and nothing else. The
maintainer spotted it in the field: **a rocket in flight added 25-30 draw calls**, the largest per-event cost
we found. It also multiplies overdraw, which is the other half of that device's frame.

This is the rendering equivalent of an **N+1 query**, and it is worth naming as a defect rather than a
hardware-specific tuning issue. It survived not because it was invisible but because of **how it spread**:
the first FX primitive (a single explosion) was written that way, which was reasonable for one object, and
every later effect copied it. By the sixth, "a mesh per particle" had stopped being a decision and become
the file's style — so a review of any one addition saw code consistent with its neighbours and passed it.
Catching it would have required arguing against the established pattern, not against the diff.

**Decision.** `client/src/particle-pool.js` provides `makeParticlePool({ geometry, color, opacity, blending,
max })`: one `InstancedMesh` per particle KIND, filled per frame (`begin` / `push(pos, size, alpha)` / `end`).
The rocket smoke trail — the only high-volume kind left — goes through it. **New high-volume FX must use a
pool and must not create a mesh per particle.** One-off effects that are only ever a handful on screen (the
warp flash, a death shockwave ring) stay plain meshes; instancing them would be machinery for no gain.

**Per-instance alpha is the load-bearing detail.** Instances share one material, so `material.opacity` is a
single value for all of them: fading it makes the entire trail blink out together instead of the tail
dissolving while the head is still dense. Alpha therefore travels as an instanced attribute (`aAlpha`) that
a small `onBeforeCompile` patch multiplies into the fragment alpha. The patch verifies its own anchors and
exposes `alphaPatched`, because a three.js upgrade that renames a shader chunk would break the fade
**silently** — the attribute would still be written, so any test that only reads the buffer back would keep
passing.

**Particle caps are now finite on every tier.** `maxParticles` was `Infinity` on High and Balance — an
unbounded resource on the two tiers most people play. A pool has a fixed capacity, so the caps are now 640 /
480 / 300, at or under it.

**Guard:** `client/visual/scenarios/27-smoke-instancing.mjs` asserts the trail is ONE instanced mesh, that
puffs carry distinct alphas with a real head-to-tail gradient, that the shader patch compiled, and — the
part that actually proves it — reads the **framebuffer**: the same puff at alpha 0 draws nothing, at alpha 1
draws a lot, and at 0.05 is far dimmer. Two earlier versions of that check were wrong in instructive ways:
counting *changed pixels* measures coverage, which is identical at any non-zero alpha; and rendering
`scene` alone composites on top of the previous frame, because the game manages its own clears and draws sky
then combat.

## 83. Warm a level AFTER it is built, and never let the last material of a program config be disposed

**Problem.** `?dev` telemetry gained stall attribution (`gpu` resource counts + Long Tasks) and immediately
explained the field freezes. Over the first 15 seconds of combat on a weak phone the **main thread was
blocked for more than 10 seconds** — one frame took **2082 ms** — while the live shader-program count climbed
**14 → 33** and geometries **15 → 43**. After ~20 s it settled to 25-35 fps. The player's words were "I don't
even want to play after 5 seconds". A second, smaller pattern ran all session: the program count sawing
**37 ↔ 40** with 100-300 ms blocks.

Both are THREE compiling a material's program and uploading its textures **lazily, on the first frame the
object is drawn**.

**Decision, part 1 — warm when the level is built, not when the page loads.** `prewarmShaders()` ran once at
bootstrap, before any level exists, so it warmed an empty scene and everything real compiled during play.
`sim.reset()` now raises `G.needsSceneWarm` and the render loop consumes it at the top of the next frame,
ahead of that frame's draw; the async set-piece loaders in `world.js` raise it again when a model lands.
This does not remove the work, it **moves** it into the level-load moment, where a pause reads as loading
rather than as a broken fight.

**Decision, part 2 — the FX warm rig is permanent.** Effects absent from the scene between spawns (bullets,
explosions) are warmed via throwaway meshes matching their program keys. That code then `dispose()`d those
materials immediately — and THREE frees a program when its last material is disposed. Since every FX
primitive disposes its material on death, the program was freed and **recompiled on the next spawn**: the
37 ↔ 40 saw. The rig now stays in the scene for the session, parked off-camera and frustum-culled (no
per-frame cost; `compile()` ignores culling).

**The rule this sets:** if a material configuration is created and destroyed repeatedly, something must hold
one instance of it alive for the session, or every lull in that effect buys a recompile.

**The case that rule was written for, found later in the field.** The player reported a half-second lag
whenever a ship blew up — verified three times, and initially blamed on flying *through* the blast, which
suggested overdraw. Measurement killed that: a ship explosion covers at most **6.7% of the screen** over its
whole life, nowhere near enough. The telemetry told the real story — freeze frames creating **7 shader
programs in a single second** — and a local probe pinned it exactly: a ship death compiled **+3 programs on
first use**, while a rocket, its smoke and an enemy spawn compiled none (already warmed). The death FX is
the flipbook fireball plus the shockwave ring, and each disposes its material when it finishes, so the
programs died with them and the *next* death recompiled. `flipbook-fx.js` and `projectiles.js` now export
`keepAliveMaterial()` / `ringKeepAliveMaterial()`, held by the warm rig. Same probe after: **0 programs**.

**The warm is hidden behind a veil, raised one frame EARLIER.** Concentrating the work at level build is
right, but on the weak phone it is a single blocking render call of ~3.2 s, and the player reported the
picture "just hanging at 1 fps for 5 seconds". `#levelwarm` covers the canvas while it runs. The ordering
matters and is easy to get wrong: the browser cannot paint anything until the current frame ends, so
showing the veil and compiling in the same frame paints nothing. The frame that takes the request therefore
only raises the veil and returns; the next frame does the work and lowers it. The veil fades in after a
90 ms delay, so a machine that finishes the warm in a frame or two never shows it.

**Verification is field telemetry, not a headless test.** Software WebGL does not reproduce the stall and
compiles almost everything at bootstrap, so the same probe reports "1 program compiled during play" on both
the old and the new code. `client/visual/scenarios/28-scene-warm.mjs` therefore pins the **wiring** — reset
raises the request, a frame consumes it, the rig stays undisposed — which is the part that can break
silently. The effect itself is read from `perf_samples`: `gpu.programs` at combat start versus 15 s in.

## 84. The level-load veil waits for the ASSETS too, not just the shader warm

**Problem.** The veil (§83) covered the compile/upload, then dropped — but the `.glb` files load
asynchronously and independently. On the itch build, whose first load pulls ~20 MB, that meant the fight
began with the player flying the **procedural placeholder cone** and the base station popping in seconds
later, with no loading screen while it happened. Reported from the field exactly that way.

**Decision.** `G.pendingAssets` counts essential `.glb` loads in flight — ship models
(`ship-factory.js requestShipModel`) and set-pieces (`world.js`) — incremented when a fetch starts and
decremented on success **and on error**. The veil stays up while the count is above zero, and only then is
the shader warm run and the veil dropped.

**A hard cap, deliberately — anchored to the FIRST raise of the wait.** `WARM_MAX_WAIT_MS` (9 s) bounds it.
Late arrivals re-raise the warm request, and an earlier version reset the deadline on each one, which
pushed it forward indefinitely: verified under an emulated 300 kbit/s link, where the veil simply never came
down. Anchoring it to the first raise keeps the promise. A wedged or failed download must
never lock a player out of their game; when the cap trips they simply start with placeholders, which is
exactly the old behaviour. The error paths decrement too, so one failed asset cannot leave the counter
poisoned for every later level.

**Measured under an emulated bad link** (300 kbit/s, 300 ms RTT, cache disabled — the conditions the report
came from, which the maintainer could not reproduce on his own connection): the veil holds for the 8.5 s cap
and then lifts with the player's ship carrying its **real model**, three loads still in flight for enemies
and set-pieces. Exactly the intent — the thing the player looks at is there, the rest catches up.

**Cheap on a warm cache.** Content-hashed assets are served `immutable` (§78), so on any load after the
first the fetches resolve from cache and the veil is gone within a frame or two — the wait is paid once,
where it belongs.

**Watch the loop's shape here.** `animate()` schedules its own next frame at the TOP, so the early return
that holds the veil must be a bare `return` — an added `requestAnimationFrame` would double the loop every
frame and take the tab down. Caught while writing this; noted because the shape invites the mistake.

## 85. Deterministic tick + always-on session recording (funnel analytics)

We want to see **why** players drop off ("5 tried, nobody reached level 2"), not just the aggregate. So
**every live campaign session is now recorded, always-on and invisibly**, as a deterministic input-replay
(seed + per-tick input, reusing `replay.js`) and uploaded for later playback in `/admin/sessions`.

**Unify all live play onto the fixed-step seeded loop.** Recording faithfully requires the same
determinism `?record`/`?playback`/`?bench` already have, so live play now runs the **fixed-timestep
accumulator** (`TICK_HZ`, default 60; `BENCH_DT = 1/TICK_HZ`) with the sim RNG seeded at level entry
(`beginLiveSession()`), instead of stepping one clamped real-time `dt` per frame. This is a deliberate
strategic move toward a stable "tick" as a foundation (future multiplayer), not a reluctant cost. Priority:
**faithful reproduction on old/slow devices over exact real-time under load** — capture is per sim-tick,
decoupled from render frames; the accumulator caps at 6 steps/frame, so a frame drop yields brief
slow-motion, never a corrupted recording (the ticks that ran are exactly what playback re-runs).

**Server-mediated S3 upload.** The client POSTs the trace to `POST /api/sessions`; the **server** uploads
to S3 (`s3.js`, hand-rolled SigV4 mirroring `ses.js` — no `@aws-sdk`) and writes the metadata row. No AWS
creds on the client, no presigned URLs. `s3.js` **no-ops without creds** so `npm test`/misconfigured envs
never crash the route (the DB row still writes with the computed `s3_key`).

**`game_version` = the deploy commit, server-stamped** from `process.env.SENTRY_RELEASE`. The inherent
constraint of input-replay analytics: a trace reproduces faithfully **only on the code version it was
recorded on** (different physics/spawns otherwise). We store the commit and surface a ✓/✗ match in admin;
restoring an old engine for an old commit is **deferred** (documented, not built).

**New table named `gameplay_sessions`, NOT `sessions`.** `sessions` is already the auth token-session store
(`db.js`) with `idx_sessions_player`; reusing the name would silently no-op `CREATE TABLE IF NOT EXISTS`
against the wrong schema and fail every insert. So a distinct name + `idx_gsessions_*` index prefix.

**Campaign levels only in v1.** Side missions' descriptors are generated server-side inline
(`missions.js`, §18) and aren't refetchable via `/api/levels/:name`, so a `/?playback&id=…` bootstrap would
404 and show nothing. Side missions are post-endgame grind, outside the early-drop-off funnel — skipped
(persisting the generated descriptor alongside the trace is a future item).

**Accepted v1 limits.** `sendBeacon` (unload flush) is capped ~64 KB — a long *abandoned* trace can exceed
it and silently drop; acceptable because the funnel we care about is early drop-off, whose traces are
small. *(That reasoning was wrong and is **superseded by §87** — the cap dropped every quit longer than ~34
seconds, and on phones/tablets the unload event usually never fired at all.)* Win/death flush via normal
`fetch` (page stays open) has no size issue. `GET /api/sessions/:id/trace`
is **intentionally unauthenticated** — a trace is seed+input only (no PII, no screen capture), keyed by an
unguessable UUID, a fair trade for a dead-simple playback page. **No consent UI** (input-replay on our own
domain). No TTL/retention job, no gzip/chunked upload, no client-side version gating — all deferred (§30).

## 86. `migrate()` serializes behind a Postgres advisory lock

Two overlapping `CREATE TABLE IF NOT EXISTS` on the same database race in `pg_type` ("duplicate key …
pg_type_typname_nsp_index") — a latent bug that surfaced once a second test file started calling
`createApp()` → `migrate()` concurrently under `node --test`. `migrate()` now takes a session advisory lock
(`pg_advisory_lock`) on a dedicated pool client before running its DDL and releases it in a `finally`, so
concurrent callers serialize (the losers then find the tables already present — idempotent). Cheap, no new
dependency, and also correct for a future multi-instance boot.

## 87. Sessions upload when the tab is HIDDEN, and traces are run-length packed

§85 shipped always-on recording with a single upload trigger — `pagehide` — and wrote off `sendBeacon`'s
~64 KB body cap as harmless. Both assumptions failed in the field within a day. A tablet tester played
Level 3 for 20+ minutes and produced **no session row and no `quit` event at all**; the maintainer's own
hour-long Level-4 quit produced the `quit` event but **no session row**. Two independent causes:

1. **`pagehide` is not a mobile event.** Phones and tablets freeze or discard a backgrounded page — locking
   the screen or switching apps often fires nothing. `visibilitychange → hidden` is the one signal that
   reliably lands, and the perf monitor was already using it while the session recorder was not.
2. **~34 seconds was the real beacon ceiling.** At ~32 bytes/tick, 64 KB is ~2000 ticks. "Tab-closers' traces
   are small" is exactly backwards: a player who plays five minutes and closes the tab is the drop-off we
   most want to watch, and their trace is 10× over the cap. `sendBeacon` refuses it silently (no throw).

**Flush on hidden, over a plain `fetch`.** `visibilitychange` fires while the page is *still alive*, so the
upload is an ordinary request with no body cap — the beacon is demoted to a last-resort `pagehide` path.
The flush is **provisional**: the recorder keeps running, so a player who tabs away and comes back and then
wins re-sends the same session under the same id. The `quit` *funnel event* deliberately stays on `pagehide`
only — firing it on every tab switch would inflate drop-off with players who simply came back.

**Client-minted session id + server UPSERT.** A session is now uploaded more than once by design, so the id
is minted client-side at `begin()` and `recordSession` upserts (`ON CONFLICT (id) DO UPDATE … WHERE
player_id IS NOT DISTINCT FROM EXCLUDED.player_id`, so a colliding id can never rewrite another player's
row). One session = one row that moves forward (provisional `quit` → final `win`), never duplicates.

**Trace v2: run-length packed ticks.** Input changes ~2×/second while we capture 60 ticks/second, so a flat
tick array is ~97% redundant. `runs: [[tickSnapshot, repeatCount], …]` + `tickCount` measured **23.8×**
smaller on a real 131 s session (7867 ticks → 279 runs, 254 KB → 10.7 KB), which (a) puts a 10-minute
session inside even the beacon cap, and (b) — the reason the recorder packs *as it captures* rather than at
flush — keeps retained memory at a few hundred objects instead of tens of thousands on exactly the weak
devices we are trying to observe. The touch aim is **quantized** (heading 1e-3 rad ≈ 0.06°, thrust 1e-2)
before storage: an analog stick emits a distinct float every tick and would defeat the packing entirely on
touch devices, and the step is far below what a finger can express. v1 traces (the shipped Level-0 intro
asset, every session recorded before this) stay readable forever — `hydrateTrace()` normalizes both shapes
at load, so nothing downstream knows the difference.

**Caps are now on RUNS as well as ticks** (`MAX_SESSION_TICKS` 108000 ≈ 30 min, `MAX_SESSION_RUNS` 20000).
On touch the run count, not the tick count, is what actually bounds memory and payload size.

## 88. A frame-pacing probe that measures the PLATFORM, not our renderer

A tester's 90 Hz tablet (Mali-G52 MC2, Chrome, desktop UA) sits at a ruler-flat **22.2 ms/frame — exactly
half of 90 Hz** — and stays there whether one enemy is on screen or four, with 0 or 68 particles. Our own
`?dev` telemetry cannot explain it: across 2335 of his samples our JS costs a steady 9–10 ms while the
frame swings 11 → 30 ms (no correlation — the *worst* frames have the *cheapest* JS), and `longTasks` is 0.

Two hypotheses were killed by evidence, one of them mine:

- **"Our new fixed-timestep sim did it"** — no. The same 22.2 ms p50 is in his samples from **2026-06-25**,
  six weeks before that change; `js.update` is 0.7 ms.
- **"It's fill rate, drop the quality tier"** — no, and §23 already said so: a **5.5–7× backbuffer-pixel
  cut moved fps by nothing** on this very GPU model. Proposing a 2.7× cut afterwards was reopening a
  settled, measured trade-off without reading it.

What is NOT explained: ~11 ms per frame that is outside our JS, independent of our load and of resolution.
And his device demonstrably *can* run our combat at 90 fps — 36 samples at p50 10.9–11.9 ms. So "weak
device" is not the answer either; he is balanced right on the 11.1 ms edge, and a 90 Hz panel makes that
edge twice as unforgiving as the 60 Hz ones everyone else tests on.

Every remaining hypothesis is about what the platform gives a browser tab, which cannot be measured from
inside a page that is also running the game. Hence **`client/raf-probe.html`**: a dependency-free single
file (no modules, no imports — it must not measure our bundle) that runs three ~3 s phases, cheapest
first — **blank** (rAF callbacks, nothing drawn), **triangle** (one WebGL draw, ~no pixels), **fill** (one
draw covering the full backbuffer). Same single draw call in the last two, so the only variable is
fragments: that isolates fill rate from draw-call count without touching the game. The decision tree:

| blank | triangle | fill | reading |
|---|---|---|---|
| ~45 | — | — | the browser never calls rAF faster; **nothing we optimise can matter** |
| 90 | ~45 | — | the WebGL/compositor path itself costs the half-rate drop |
| 90 | 90 | ~45 | genuinely fill-bound → §23's "resolution is a dead end" needs revisiting |
| 90 | 90 | 90 | the device is fine and the missing ~11 ms is ours to find |

Results **POST to the existing `/api/perf` sink** tagged `probe:'raf'` (no new table, no new route) keyed by
the same localStorage `playerId` the game uses, so a run ties to the player row and is read with SQL
instead of asking a tester to screenshot numbers. It never *creates* a `playerId` (a probe must not mint a
player who has never played — anonymous runs land under `probe-anon`), and `?dry=1` measures without
uploading. Each phase also carries a frame-interval **histogram**: a half-rate lock is one tight spike at
22 ms, generic slowness is a smear, and no average can tell those apart.

## 89. Aim assist is a per-weapon cone that applies to whoever fires the weapon (enemies included)

Bullets fly dead-straight along the shooter's nose, so hitting a moving target off-center needs manual
lead. We added a small **auto-aim cone**: at fire time, if an opposing-side target sits within the
shooter's forward cone, the bullet's launch direction is rotated to point straight at that target's
**current** position instead of straight down the nose.

- **What it does.** In `fireMount`'s bullet branch we look up the nearest opposing target in a cone of
  half-angle `aimAssistDeg` off the muzzle (`findBulletAimTarget` → the pure `nearestInConeIndex`), then
  set the launch `dir` toward its current position (planar XZ, `y=0`). Velocity inheritance is untouched —
  `spawnBullet` still adds the shooter's velocity; only the base `dir` is rotated. Rockets are untouched
  (they keep `findTargetInSector` homing) — `aimAssistDeg` is only on the seven `type:'bullet'` rows.
- **Why a weapon property, not a player-only aid.** It's stored on the weapon (`aimAssistDeg` in the
  catalog), so the rule is symmetric and lives in one place: equipping or looting a weapon changes both
  sides' behavior consistently, and enemy kinetic/cannon guns auto-aim at the player exactly as the
  player's guns auto-aim at enemies. No side-specific branch, no separate "player assist" toggle.
- **Half-angle 2°, in degrees, per-weapon.** `aimAssistDeg: 2` is the **half-angle** (±2° = a 4°-wide
  cone), deliberately narrow: it forgives near-misses without turning bullets into homing missiles. Stored
  in degrees per-weapon so different weapons can carry different cones later; every current bullet gets 2.
  No target leading (aim at the current position only) — the cone is tiny, so intercept math isn't worth it.
- **Determinism / replay.** The whole selection is a pure scan of current entity positions — no
  `Math.random`, no `simRandom` — so it's bit-deterministic and replay-safe. Because it changes bullet
  directions inside the seeded sim, it CAN invalidate the recorded Level-0 intro (the re-sim would desync);
  the fix for a red `22-intro-replay` guard is a maintainer **re-record**, never weakening the guard. In
  practice the 2° cone was small enough that the recorded intro re-simmed to the same 4 kills / cards
  p0..p4 / win unchanged, so no re-record was forced this time.

## 90. The shop unlocks right after the first mission, not at the campaign's end

**Decision.** Move the `unlockShop` briefing action from the final level (descriptor `level-5`,
player-facing "Level 4") to the "Level 2" briefing (descriptor `level-3`), which runs on **advancing into
level-3** — i.e. right after the player clears "first flight" (`level-2`, "Level 1"). The hangar shop **and**
the side missions (both gated on the same `players.shop_unlocked` flag) now become available early in the
campaign instead of only after it is finished.

**Why.** With the unlock on the last level, the whole upgrade/shop economy — buying gear, selling loot,
side-mission credit runs — was dead weight for a first-time player until the story was over, which is when
they least need it. Opening it after the first real mission makes the economy a mid-campaign tool: land in
the hangar after the first fight and the shop + side jobs are already there to kit out with before pushing
on. The `unlockShop` action, its idempotent body, and the final-level `advanceProgress` fallback are reused
verbatim — no new level, action type, or DB column.

**Existing players: retroactive open via a plain idempotent boot backfill (not a `migrations_pg` ledger
entry).** A one-time backfill in `migrate()` sets `shop_unlocked = 1` and seeds the basic gun (weapon 1)
into the stash for every registered player with `current_progress >= 3` (already past the first flight), so
long-time players aren't left with a shop that "should" already be open. We deliberately did **not** record
this in the `migrations_pg` ledger: the operation is **naturally idempotent** (the `shop_unlocked = 0`
guard + `ON CONFLICT DO NOTHING`), so it's a no-op once applied and safe to run on every boot — exactly
like the Grab/shield backfills above it (DECISIONS §30, §40). A ledger entry is only needed for a
non-idempotent step (e.g. the intro `current_progress + 1` shift), so adding one here would be redundant
ceremony. `shop_unlocked` is an INTEGER column, so the backfill writes `1`, never a boolean (a mis-typed
boolean throws on Postgres — the bug the reset test guards).

**Copy.** The "Level 2" briefing (`level.2.briefing`) gains a sentence announcing the open hangar; the
"Level 4" briefing (`level.4.briefing`) drops its now-misleading "look over the upgrade gear" line
(the shop is no longer new there). English is the source of truth (`source.json` + the `catalog_seed.js`
`text` fallback); the Russian layer (`ru.json`) mirrors both.

**Amendment (§95).** The backfill's threshold form was corrected to name-based
(`SHOP_MIN_LEVEL = 'level-3'`) — the `current_progress >= 3` written above is the original, buggy form on a
drifted DB. Semantics unchanged.

## 91. Side missions unlock after "Level 3" — decoupled from the shop

**Decision.** Split the side-mission board off the shop's unlock. The shop still opens right after the
first flight (§90, keyed off `players.shop_unlocked`). The **side-mission board** now opens **later** — on
reaching the "Level 4" briefing (descriptor `level-5`, id 5), i.e. after the player clears "Level 3" —
gated on `players.current_progress >= SIDE_MISSIONS_MIN_PROGRESS` (=5), a new exported constant in
`server/src/db.js`. `getActivePlayerShip()` returns a `sideMissionsUnlocked` boolean derived from
progress; `GET /api/players/:id/missions` and the client's `refreshMissions()` gate on it instead of
`shopUnlocked`.

**Why.** §90 had opened the shop *and* the side missions together, right after the first mission — but
dropping a repeatable grind board on a brand-new player at the same moment as the shop is a lot of surface
at once, and it competes with the campaign's momentum during the early story beats. The shop is the piece
worth having early (kit out mid-campaign); the side jobs are better introduced once the player has some
footing and gear — after "Level 3". Keeping the shop early but the board later needed the two gates
separated. This is part of the base-menu redesign (docs/plans/2026-08-08-base-menu-redesign.md, Slice 0).

**No new DB column / migration / backfill.** The side-mission gate is *derived live* from
`current_progress` (a column that already exists and is always accurate), so there is nothing to persist
or backfill — every existing player's board availability is recomputed correctly on the next request. This
is deliberately lighter than §90's `shop_unlocked` flag, which needs to persist because it's set by a
one-shot briefing action; a progress threshold has no such need.

**Copy.** `level.2.briefing` drops its "a few side jobs" clause (only the shop opens there now);
`level.4.briefing` gains a line announcing the side-job board. English is the source of truth
(`source.json` + the `catalog_seed.js` `text` fallback); the Russian layer (`ru.json`) mirrors both. No
`unlockShop`-style action is added for side missions — the announcement briefing is text-only; the gate is
the progress threshold.

**Amendment (§95).** The threshold form was corrected to name-based
(`SIDE_MISSIONS_MIN_LEVEL = 'level-5'` via `reachedLevel()`); `SIDE_MISSIONS_MIN_PROGRESS = 5` above is the
original, buggy form on a drifted DB. Semantics unchanged.

## 92. At most ONE Main Window 3D viewer render-loop runs at a time

**Rule.** On the Main Window (the between-missions base screen) **at most one 3D model viewer render-loop
is active at any time**, and it belongs to the currently-open view. Switching views (`selectMenu` in
`client/src/mainwindow.js`) MUST stop the viewers that don't belong to the new view:

- **Missions / Character / Map / Craft** → only the right-column ship preview (`mwPreview`, `#mw-ship`);
  the Loadout viewers are stopped (`stopLoadoutPreview()` → the centered ship `loadoutViewer` + the item
  model `shopModelViewer`).
- **Loadout** → the centered ship (`#loadout-ship`) + the selected item's model (`#shop-model`); the
  right-column preview is stopped (`stopShipPreview()`).

Model **auto-rotation is time-based** (rad/sec in `startViewer`, `model-viewer.js`), not a per-frame
increment, so a dropped frame doesn't make the spin jerk.

**Why.** Each viewer is its own `WebGLRenderer` (a separate GL context) with its own `requestAnimationFrame`
loop. When a Loadout viewer was left running after navigating back to Missions, 2–3 loops rendered
concurrently and the visible ship preview **stuttered on a phone** (the base-menu redesign, Slice C,
introduced the extra Loadout viewers). Keeping exactly one loop alive per view is what keeps the spin
smooth. The enforcement point is the `if (isBay) stopShipPreview(); else { startShipPreview();
stopLoadoutPreview(); }` in `selectMenu`, plus `launchCampaign`/`launchMission` stopping all viewers on
take-off. If viewer count grows, centralize this in one `activateView(view)` helper rather than scattering
start/stop calls.

**Amendment (§97, 2026-08-09).** The first bullet is obsolete: the right-column ship preview (`mwPreview`,
`#mw-ship`) was deleted, so **Missions / Character / Map / Craft run NO viewer at all** — `selectMenu` only
stops the Loadout viewers (`if (!isBay) stopLoadoutPreview();`), and the work-zone granted-item showcase
(`mwItem`) is the sole viewer the Missions view can run. The one-loop-at-a-time rule itself stands.

## 93. Character progression: XP → derived level, 5 skills, and a determinism-safe dodge

The Character section became real: experience, a character level, and five skills (Kinetic, Rocket,
Shields, Maneuverability, Mobility; Accuracy reserved for later). Several non-obvious choices:

- **Client-authoritative XP, like credits.** The server never computed per-kill rewards — the client
  sums each enemy's `reward` and POSTs the total to `/api/games` (see §earlier reward model). XP rides the
  exact same path: the client sums each enemy's `xp` (= its credit reward) plus a one-shot mission bonus on
  victory, and posts `xp`; the server just banks `experience += xp`. Server-sealed rewards remain a later
  integrity item — doing XP any other way would have been an inconsistent special case.
- **Level & unspent points are DERIVED from XP, never stored.** The only persisted truth is `experience`
  plus the five `skill_*` allocation columns. `level = levelFromXp(experience)`, `unspent = level −
  Σ(allocations)` (progression.js). Storing the level too invites drift the day we retune the curve; a
  pure function can't disagree with itself. Total points are naturally capped at `level` (no separate cap).
- **Arithmetic curve** — cost to reach level *n* = `1000 + 500·(n−1)` (1000, 1500, 2000, … cumulatively
  1000/2500/4500/7000). Chosen over an exponential/power curve so the *first* campaign run yields a felt
  ~5 levels rather than 2 or 15; steepness is one constant (`XP_STEP`) away if it needs retuning.
- **Skills are baked at ship-build time, applied only to the REAL active ship.** `buildPlayer` scales the
  player's engine/thruster power, shield capacity, and *cloned* weapon copies (never the shared catalog
  objects), and stamps `dodge`/`maxSpeedMul`. Previews and — critically — `?playback`/intro overrides pass
  **no** skills, so a recording reproduces the exact ship it was made with and stays deterministic.
- **Dodge is determinism-safe by construction.** Hit chance is `100/(100+dodge−accuracy)` (accuracy 0 for
  now). The roll is drawn from the seeded sim RNG (sim-random.js) **only when `dodge>0`** — a no-skill run,
  and therefore every pre-existing recording, consumes **zero** extra draws and replays bit-identically
  (the opt-in-per-draw contract, §73). To keep collision.js pure/RNG-free, the roll is an *injected*
  predicate `resolveHostileBulletHit(..., dodgeRoll)` the caller supplies (null when the target can't
  dodge). Dodge is a general ship stat (enemies carry it too; all current enemies = 0) and applies to
  hostile **bullets** this iteration — rocket blasts are not dodged yet. Aim-assist from Kinetic is
  additive degrees onto the existing per-weapon cone (consistent with §89).

## 94. Inter-point travel: autopilot via a system-map route selector + uncapped manual cruise (planned)

As the world becomes a to-scale, flyable star system (star + 4 orbiting planets + an asteroid belt with
mining bases + a science station; see the star-system-map work), the player needs to cover large distances
between activity points without fighting the inertial flight model the whole way. Two extremes were weighed
— full autopilot (removes tedium but also control/agency) vs pure manual inertial travel (§2 model with the
out-of-combat speed cap lifted; keeps control but makes long empty transits a chore, since our no-friction
inertia is exactly what's tiring over distance).

**Decision (planned):** build **both** — an explicit **autopilot** driven by a **system-map screen**, on
top of **uncapped manual cruise**:

- **Out of combat the speed cap is lifted** (§2 inertia, no cap) so free manual flight across the system is
  possible; **entering an activity/combat zone re-applies the cap and full inertia**, so combat feel is
  untouched.
- **A system-map screen** (top-down overview of the star, the 4 planets at their wall-clock orbital
  positions, the belt, mining bases, the science station, our base, and the player) is opened from the
  in-battle map button AND from the base menu (same screen). The player **selects a destination on the map
  and autopilot flies the real ship there**; the **active mission is highlighted** on the map.

Rationale: at to-scale distances manual inertial flight across the void is tedious, so autopilot to a chosen
destination removes it while the map gives spatial context + mission targeting; manual uncapped cruise stays
available for free flight, and a player-locked parallax speed-field (see the Points speed-field work) makes
that flight *feel* fast rather than like floating. This **supersedes the earlier lean** in this section
toward a "cruise assist instead of autopilot" — the maintainer decided (2026-08-09) to build the autopilot
after all, since a to-scale system needs real point-to-point navigation.

**Revisit if:** playtests show autopilot removes too much agency, or the manual cruise alone is enough — then
trim one side. A "decide on feel" item, tuned from an early playable build.

## 95. Progress thresholds are level NAMES, never raw serial ids

**Decision.** Any "has the player reached story point X" gate compares `players.current_progress` against
`(SELECT id FROM levels WHERE name = '<seed name>')` via the single helper `reachedLevel()` in
`server/src/db.js`, never against a hardcoded number.

**Why.** `levels.id` is a `BIGSERIAL` and the idempotent startup seed's `INSERT ... ON CONFLICT (name) DO
UPDATE` still evaluates `nextval()` before it detects the conflict, so **every deploy burns five sequence
values** and level rows added at different times drift arbitrarily far apart (production: 1, 6, 7, 71, 564
for `level-1`..`level-5`). A numeric threshold is therefore only correct on a freshly-seeded DB — and it
fails **open**, silently unlocking content early: the "Level 1" briefing sits at id 6 on prod, which
satisfied both the board's `>= 5` and the shop's `>= 3`, so 32 players who had not yet flown the first
playable level were handed the repeatable side-job board and the hangar shop. That is the worst failure
direction, and it was invisible in tests because `pretest` recreates the DB and always yields contiguous
ids 1..5. Name-based comparison fails **closed** instead (a missing row → locked).

**Rejected alternatives.** *Ordinal rank* (`COUNT(*) FROM levels WHERE id <= progress >= 5`) — correct
today, but perturbed by any extra `levels` row: it would silently re-anchor the gate a level earlier the
day a level is inserted mid-campaign. *Renumbering the ids / stopping the sequence burn* — pure churn:
nothing depends on contiguous ids (`advanceProgress` walks `MIN(id) > current`), the FK on
`current_progress` has no `ON UPDATE CASCADE`, and it would not fix the already-drifted production DB
(§30). `name` is already the seed's stable identity key (`ON CONFLICT (name)`).

**Consequences.** §90's shop threshold is `SHOP_MIN_LEVEL = 'level-3'` and §91's board threshold is
`SIDE_MISSIONS_MIN_LEVEL = 'level-5'` (semantics unchanged: shop after the first playable level, board
after "Level 3"). The boot shop backfill uses the same lookup and re-runs on every boot, so the fix reaches
everyone on the next deploy — and the early-granted `shop_unlocked` flags are **not** revoked (no
down-migration; those players keep the shop). The board simply re-locks for players below `level-5`, which
is inert: a stale `players.active_mission_id` is never read while the board is locked, and Take-off falls
back to the campaign. `resetPlayer`'s `current_progress = 1` and the column's `DEFAULT 1` stay raw ids
deliberately — `level-1` is id 1 on every live DB and the FK would fail loudly, not silently (§30) — with
comments recording that. Covered by `server/src/levels_drift.test.js`, which runs on **its own database**
(`spacegame_test_drift`) because the FK on `current_progress` makes re-numbering impossible once players
exist and mutating the shared `spacegame_test` would race the parallel test files. Cross-ref §90, §91,
§30, §67.

## 96. The parallax backdrop is a PLAYER-LOCKED WRAPPING POINT FIELD, not an origin-anchored rock ring

The backdrop's only job is to sell **motion** — without something sweeping past, the ship reads as floating
in place. The old implementation (§71's backdrop half) was an `InstancedMesh` of **2000 low-poly rocks**
scattered **once, in an annulus around world origin** (`makeAsteroids`). Two problems, one fatal:

- **It is anchored to the origin.** The moment the player roams — and §94's to-scale star system, autopilot
  and uncapped manual cruise are exactly that direction — they fly *out* of the ring into genuinely empty
  space, i.e. the speed
  cue disappears precisely where it matters most (long transits). Growing the ring to cover the system is a
  quadratic-cost non-answer.
- **It is heavy for what it delivers.** ~40k tris and a full-disk scatter to render sub-pixel specks under a
  near-top-down camera, where the rock silhouettes were never actually visible.

**Decision:** replace it with a **fixed pool of ~920 `THREE.Points` sprites in 3 depth layers (3 draw
calls)** that is **re-wrapped into a ±`radius` box centred on the player every frame**. Points stay static in
world space and are translated by *whole box spans* only when they leave the box (a treadmill), so parallax
remains true perspective — deeper layers sweep slower — and the same specks surround the player **anywhere in
the system at constant cost**. No growth, no rebuild, no per-distance scaling.

- **Points over instanced rock meshes.** At this camera the rocks were sub-pixel; the detail was pure cost.
  A textured point sprite (the *existing procedural* canvas dot, shared with the bright-star layer — no new
  asset) reads identically and costs one draw call per layer.
- **Client-only render decor, driven from the VIEW layer.** The wrap runs in `settleView` (`sim.js`), never
  in the deterministic tick; the field is in no gameplay array, is not collidable, and nothing about it is
  sent to or read from the server. Its one-time scatter draws the **native `Math.random`** and the per-frame
  wrap draws **no randomness at all**, so it is replay-neutral by construction (**§73**) — the recorded
  Level-0 intro re-sims bit-identically.
- **THE NO-POP-IN RULE, AND THE TRAP IN IT.** A recycled point must reappear where the player cannot see it.
  It is tempting (the plan's first draft did exactly this) to derive that from `scene.fog.far` — **that is
  wrong**. `THREE.Fog` fogs on **view depth** (`-mvPosition.z`), not radial distance, and this camera is
  near-top-down (`CAM_OFFSET 0,110,26`, `ZOOM_MAX 3.5`): a **shallow** point 620 units out sits only ~413
  deep in view space at max zoom-out — barely past `fogNear` (240), i.e. clearly visible. What hides the
  shallow layers is the **frustum** (the near layer's visible patch tops out at |Δx| ≈ 459 / |Δz| ≈ 274 at
  16:9). The **deep** layer is the opposite case: it *does* out-reach the frustum horizontally, but its view
  depth there is ≥ 668 > `fogFar` (600), so fog finishes the job. **`radius ≥ 600` (`WRAP_SAFE_RADIUS`,
  shipped 620) clears both ends** — and the margin is **aspect-ratio dependent** (it runs out around aspect
  ≈ 2.4, so an ultra-wide layout must grow the *shallow* layers' radius, never the fog). This is documented
  and unit-asserted against the shipped values rather than silently clamped, because the `?dev` panel must
  stay free to explore a smaller box.
- **Live-tunable instead of argued about.** The look constants (count/size/radius/depth/opacity per layer +
  a shared colour) live in the map descriptor's **`speedField`** and are dialled in the `?dev` "Speed field"
  folder, which dumps a paste-ready block for `catalog_seed.js`. The committed numbers are a starting point.
- **`asteroids` compatibility shim — SHIPPED, THEN REMOVED 2026-08-09 (both conditions met).** The dead
  `asteroids: {…}` block stayed in the descriptor for exactly one release. `db.js` upserts every map
  descriptor **on every server start**, so the moment this deploys, the already-published **itch** bundle and
  the **`/v2`** sandbox — older clients reading the *live* catalog — would call the removed `makeAsteroids(undefined)`
  and throw inside `buildMap` (black scene, not a graceful degrade). **Remove it** in the first change *after*
  the itch build has been re-published (`/publish-itch`) and `/v2` redeployed from a `main` containing
  `speedField`. **Both conditions were met the same day** — the itch build was re-published (butler build
  #1868869, v52) and `/v2` was redeployed from a `main` containing `speedField` (the sandbox branch was 70
  commits stale; `main` was merged into it, its two FX prototypes having already been promoted to `main`
  earlier) — so the key is **gone**. `server/src/maps_speedfield.test.js` no longer pins the shim's presence;
  it now asserts the **opposite**, so the dead key cannot creep back in via a copy-pasted descriptor.

**Amendment (shipped invisible, then fixed — the part worth reading).** The field went to production
geometrically perfect and **impossible to see**, and the only thing that caught it was a human looking at
the game. Three compounding causes, and the lesson is in the third:

1. **Dark tint on a dark sky.** Grey `0x6b6f78` at opacity 0.55–0.90 over the map background `0x0a1624`
   composites to within a few percent of the background.
2. **The wrong sprite.** It reused the star layer's `getStarGlowTexture` — a soft radial glow *designed* to
   bloom a point into a halo, averaging ~25% alpha across its face. The first correction (bigger + whiter)
   made it visible and immediately wrong: *"there are no white blobs like that in space."* The real fix was
   a **separate hard-edged dot** (`getSpeedDotTexture`), opaque across its face, which reads as a lit speck
   at sub-1-unit size and a natural rock tone. **The two textures must stay separate** — merging them back
   re-creates the bug. Final look: `0xd2ccc1`, sizes 0.8/1.3/2.0, density weighted to the near layer.
3. **Nobody asked "will you see it".** The plan reasoned carefully about density, pixel counts, frustum
   geometry, draw calls and replay-neutrality. Ten unit tests, an outcome scenario that teleports the player
   5.6k units out, a critic round and a reviewer round — all green, because every one of them tested that the
   field is *where it should be*, never that it is *perceptible*. **A visual feature needs an assertion about
   perception, not only about geometry.** Hence `MIN_CONTRAST`/`contrastRatio` and the `size × contrast ≥ 5`
   visibility budget in `speed-field.js` — deliberately calibrated from the escaped defect (which scores
   2.39×) rather than derived, and documented as a "go look at a real frame" tripwire, not a truth.

Superseded: the **backdrop half of §71** (its mission-`asteroid-field` half still stands — the `.glb` rock
pack is still used up close, and its CC-BY attribution stays). Motivated by **§94** (inter-point travel):
fast manual travel only *feels* fast if something sweeps past you the whole way. Warp/velocity-stretch
streaking is deliberately **out of scope** — `updateSpeedField` is documented as the single hook for it.
A **foreground** layer (negative `depth`, between camera and ships) is likewise not shipped, but the slider
range reaches −110 so it can be judged live; adopting one would revisit the "below-plane only" call above.

## 97. The Main Window right column is per-view content, not a permanent ship preview

**Decision.** The Main Window's right ~25% column (`#mw-ship-col`) stopped being a permanent **ship
turntable + characteristics strip** and became **per-view content**: on **Missions** it holds the
**mission list** (campaign + side-mission cards), on **Loadout** the `#ship-stats` strip + the slot/shop
context panel (widened to 30%), and on **Character / Map / Craft** it holds **nothing** — the column is
`display: none` and the grid drops to **two** tracks. The `#mw-ship` canvas, its viewer (`mwPreview`) and
the `previewTarget` debug hook were deleted outright, not parked. Gated by two classes on `#mainwin`:
`missions-open` (new) and `bay-open` (existing).

**(i) Why the ship preview went.** It was decoration holding the widest, most valuable strip of the
landing screen: the model never changed (always the player's active ship), carried no decision-relevant
information, and competed with the briefing for attention. The ship is already inspectable **full size and
interactive** on **Loadout**, where its stats belong too — so `#ship-stats` moved with it (Loadout-only)
rather than floating over an unrelated view. Removing it also drops one `WebGLRenderer` context from every
menu landing (cheap on weak phones — cross-ref §92).

**(ii) Why the mission list moved there instead of a taller center stack.** The board used to sit **above**
the briefing in the centre work zone, capped at `max-height: 42%` — so with four cards it ate nearly half
the briefing's height, and both the list and the text were cramped and scrolling. Side by side, the list
gets the full column height with its own scroller and the briefing gets the full centre width and height.
Selecting a mission no longer pushes the text around, which was the worst of the old behaviour.

**(iii) Why Character / Map / Craft collapse rather than keep an empty column.** Those views have nothing
to put there. An empty 25% gutter reads as a rendering bug, and the alternative — inventing filler content
(a ship card, a stats panel, art) — is scope we explicitly rejected (§30). Collapsing to two columns hands
the width to the work zone, which is what those (largely stub) screens actually need.

**(iv) Why the staged reveal lost its "ship window fades in" beat.** The L1-L3 campaign-briefing reveal used
to hide the whole right column for the ~5 s the text types out, then fade it in. On L1-L3 side missions are
still locked, so the list holds **exactly one** card (the campaign one): blanking the column for five
seconds every landing bought no drama and now just looked like a broken list. The reveal keeps
**typewriter → granted-item showcase → Take off +0.5 s**; `.briefing-hide-ship` (CSS + JS) is gone,
`.briefing-hide-go` is unchanged.

**Kept deliberately.** The id `#mw-ship-col` is **not** renamed — it would churn `index.html`, four CSS
rules, a visual scenario and several SUMMARY lines for zero behaviour change; the HTML/CSS comments say
what it really is. Mission-card *content* and the take/defer/activate API are untouched; only the card's
CSS box restacks (title + badge / reward sub-line / right-aligned actions) for the narrow column.

Cross-ref §27 (the preview this removes), §28 (the viewer machinery that lives on), §92 (one viewer loop
per view). Brief: `docs/plans/2026-08-09-1534-missions-list-right-column.md`.

## 98. Star system: compact Float32-safe coordinates (no floating-origin) + real bodies laid out on the ecliptic

Building the flyable star system (§94) forced two model choices — how far apart the bodies really sit in
world coordinates, and how they are rendered. (The distant parallax that sells *speed* is the player-locked
wrapping speed field of **§96**, unchanged; this entry covers only the star-system geometry + the sky bodies.)

- **Coordinate model — compact, Float32-safe, no floating-origin.** Planet 2 (our base planet) is **pinned
  to the world origin**, so `arenaCenter`, the set-pieces and the `missions.js` centers stay origin-relative
  (no combat/mission rewrite). The star sits at `-orbitVec(planet2)` and the other planets at
  `star + orbitVec(planetᵢ)`, from pure wall-clock angles (`bodyWorldPos`, `system-map.js`; periods 1/1.5/2/2.5
  real days, fixed `EPOCH`). **"To-scale" means the travel distances only** — the provisional orbit radii are
  **9k / 15k / 22k / 30k** (planet 2 = orbit 2 at 15k), so the **outermost body reaches |coord| ≈ 45,000 u**
  (`maxBodyCoord`, unit-asserted ≤ 1e5). At 45k, Float32 relative precision `2^-23` gives ~**0.005 u** jitter
  vs a ~2 u ship — safe with wide margin, so **no floating-origin** is needed. One star system per server =
  one shared coordinate space (future MP). *(These radii are Stage-1 live-tune values; the FINAL measured
  orbit-4 diameter / `max|coord|` after tuning should be recorded here — the numbers above are the shipped
  provisional set.)*
- **Rendering — every body is a REAL sphere at its own TRUE position ON the ecliptic.** The ship flies on the
  plane (y = 0) and the camera looks **down** at it, so a body is placed at its own true (x,z), **sunk
  `depth` below the plane** and shifted by the shared `SYSTEM.offset` — precisely the placement the game's
  original single home planet used (`pos [-150,-285,-110]`, radius 60), now applied per body across the whole
  system (`bodyRenderPos`). Nothing is attached to the camera, so nothing re-projects and nothing can jump;
  the perspective and parallax are simply what real 3D gives you as you fly over a fixed world. Three
  properties fall straight out of this and are the whole point:
  - **You have to travel.** At the base you see planet 2 and the station and *nothing else* — planet 1, 3, 4
    and the star are 9k–45k units away. `planetAnchor(name)` (where autopilot actually flies) is the body's
    own (x,z) on the plane, so reaching planet 3 is a real ~15 000 u crossing, and arriving frames it exactly
    the way the home planet is framed at the base. Bodies **fade in/out by distance from the SHIP**
    (`bodyFade`, 520→760 u) rather than popping at the far plane; keying the fade to the ship rather than the
    camera is what stops zoom-out from fading the planet you are parked at.
  - **A planet is permanently out of reach even directly overhead** — the ship flies at y = 0 and the body's
    top is `depth − size` below it (`bodyClearance`, unit-asserted > 0 for every body). No looming, no ramming,
    and no "home is near" special case: the home planet is a backdrop at the base like every other body.
  - **Moons** orbit the home planet in world units at radii kept clear of its limb (`moonClearance`,
    unit-asserted > 0 at every orbital angle).
  - **Rejected: a camera-anchored sky dome (two earlier passes).** First bodies were re-projected every frame
    by the bearing **from the player** at constant apparent size — flying *past* one swings that bearing
    through ~180°, so it visibly **jumped**; a moon's projected bearing could cross its planet's and slide
    *into* the disk; and constant size killed parallax. A second pass fixed the jumping by freezing the
    bearings and sliding the whole dome by a saturating parallax — but that still put every body in the sky
    at all times, which is *not* the system: with a fixed near-top-down camera you could never see a body
    whose bearing pointed behind the ship, bodies sharing a bearing stacked into one blob, and nothing was
    ever somewhere you could fly *to*. Both are gone. `32-star-system` pins the replacement: over a 12 000 u
    flight no body may move (drift < 0.5 u), turning must not move one, the ship may never get within 100 u
    of a body's surface, only `planet2` is drawn at the base, and flying to planet 3's anchor must show
    planet 3 and hide planet 2.
  - **Note on `camera.far`:** raised 900 → **1300**, so a body still fading at 760 u from the ship can't be
    clipped when max zoom puts the camera another ~396 u back. Nothing else reaches that far (fog covers the
    speed field long before), so it costs ~0.6 bits of depth precision and changes no visuals.
- **All of the above is VIEW layer** (buildMap/settleView), consumes **zero sim RNG**, and roam
  (`capLifted` false whenever `G.roam` is false) is never recorded — so recorded/campaign replays stay
  byte-identical (§73).
- **Geometry tunables** live in the client `SYSTEM` constants for fast live-tuning (§30). The `home-system`
  descriptor's `system` block is **merged into** `SYSTEM` at build (`applySystemSpec`), so the renderer, the
  map screen and the `?roam` tunables all read **one** object — previously the renderer read the descriptor
  while the map UI read the constant, and the two could silently disagree.

## 99. Fog is anchored to the SHIP, not to the camera (zoom-out no longer dims the game)

`THREE.Fog` fades by **view depth from the camera**, but camera zoom scales `CAM_OFFSET` — at `ZOOM_MAX`
(3.5) the camera sits ~**396 u** from the ship, far past the zoom-1 `fogNear` of **240**. So zooming out
dragged the *player ship and the station set-pieces themselves* into the fog and visibly **dimmed** them
(~43 % fog on the ship at max zoom); nothing was wrong with the lighting, which is distance-independent
(a `DirectionalLight` + ambient).

`applyZoom()` (engine.js) therefore slides **both** fog planes by the extra camera distance
(`|CAM_OFFSET|·zoom − |CAM_OFFSET|`), so "how far *past the action* does fog start" is constant at every
zoom and the change is an exact **no-op at zoom 1** (still 240..600 — no visual/replay diff at the default).
The same "anchor it to the ship, not the camera" reasoning applies to the star-system bodies' distance fade
(§98) — keyed to the camera, zooming out faded the planet you were parked at.

Alternatives rejected: **capping zoom** (loses the wide tactical view the zoom-out is for) and **decoupling
lighting from distance** (lighting was never the cause). `fogFar` is additionally clamped to
`camera.far − 20` so geometry always fades to invisible *before* the far plane clips it — otherwise widening
the zoom range would pop the speed field's deep layer at its wrap edge. Guarded by `32-star-system` (at max
zoom the ship stays in front of `fogNear`; `fogFar` stays inside `camera.far`).

## 100. One navigation component for three hosts; "Take off" and "Launch mission" are different buttons

Choosing where to fly now happens in three places — the base-menu **Map** section, the in-flight **overlay**,
and **mission activation** — and all three run the *same* `mountSystemNav` (systemmap-ui.js) over the *same*
`listSystemObjects()` (system-map.js). Hosts differ only by the extra buttons they pass in and by what they
do with the chosen object: from the base `enterRoam({pos, missionId})`, already flying
`engagePointAutopilot(...)`. The alternative — a small picker per host — is what we had, and it had already
drifted: the base menu offered "Fly here" only for missions while the overlay let you pick any marker, and
the map UI read the client `SYSTEM` constant while the renderer read the map descriptor (§98 fixes that half).

- **Celestial bodies are first-class destinations.** The star and all four planets are ordinary rows in the
  same list as the base, the research station and the three belt outposts; picking one routes to its
  *anchor* on the plane, since the body itself is permanently distant (§98). Objects carry an i18n
  `nameKey`, never a raw id, so the list localizes with everything else.
- **Pan/zoom is a pure seam** (`map-view.js`, unit-tested) rather than canvas-local state: zoom is bounded
  and the centre is clamped inside the system disc, so a drag can never fling the map into empty space with
  no way back — the classic failure of a naive drag-to-pan.
- **"Take off" ≠ "Launch mission".** Take off (free flight into the system, `enterRoam(null)`) is now on
  **every** base stage, so the hangar is never a dead end. That collided with the old `#mw-go`, which said
  "Take off" but dropped you straight into the *fight*. Rather than overload one label, the fight button was
  renamed **"Launch mission ⚔"** and keeps its behaviour — the campaign flow for levels 2–4 is untouched —
  while the mission briefing gained **"Autopilot to destination"** for the fly-there-and-be-asked path.
  *Rejected:* removing the direct launch entirely (cleaner, but it forces a transit before every campaign
  level) and a single context-sensitive Take off (fewer buttons, but the same label doing two different
  things). Revisit if the transit becomes the intended campaign pacing.
- **One gate for every launch control.** `updateTakeoffGate` disables the fight launch, Take off and
  Autopilot together from the server's `launchable` flag (a required slot — hull/armor, engine or thruster —
  is empty): a ship that can't fight must not be able to wander off either.
- Fixed in passing: `body.menu` hid `#rocket-btn`/`#zoom` individually but not the `#touch` layer, so on a
  phone the **FIRE button stayed live over the base menu** and overlapped the new object list.

## 101. The speed cap protects REPLAYS, not autopilots — so flying home is uncapped

§98/§100 carried the rule "`capLifted` must be false whenever `roam` is false", which made the
end-of-mission **"Return to base"** flight crawl at the combat cap (`PLAYER_MAX_SPEED` 30) across whatever
distance the fight ended at. That rule was a **conservative proxy**. The thing replays actually reproduce is
the recorded **INPUT stream**, so the real invariant is narrower:

> **The cap is never lifted for input-driven flight.** An autopilot leg is not input-driven.

The intro replayer makes this explicit: while the dock autopilot flies home it **freezes the trace index and
zeroes the key state** (`rs.cutReturning`, main.js) precisely because that leg is not replayed from input.
Measured before changing anything: lifting the cap for the dock leg leaves `22-intro-replay` **byte-identical**
(kills=4, cards p0..p4, won=true, tick 2213/2730 unchanged). So two legs run uncapped and only these — roam +
autopilot (cross the system without a chore), and the **dock** autopilot in *either* state. Manual flight
stays capped everywhere, and a mid-combat **drop-grab** autopilot stays capped too (top speed is a balance
parameter inside a fight). Unit tests pin each cell of that table.

**Clicking the home station now works while roaming**, not just after the last kill: `engageAutopilot` accepts
`G.roam`, `reset()` marks the station clickable for the whole roam, and arriving raises a **"Dock at the
station?"** confirm (`G.onBaseArrival`) — the flown counterpart of the map overlay's teleporting "Return to
hangar". It can win nothing: `levelRunner.returningToBase` is false in roam, so `canDock`/`win` never run.

**Terminal brake (the bug uncapping exposed).** `autopilotControl` chased its goal until the *kinematic*
brake distance said otherwise, so a fast arrival overshot, re-accelerated and settled into a ~10 u/s **orbit
around the target** — an arrival predicate waiting for the ship to come to rest then never fired, and a roam
destination could never raise its prompt. The autopilot now simply brakes once inside `ARRIVE_RADIUS`.
Excluded for a **drop**, whose own pickup radius owns that endgame and whose trajectory is combat-tuned. The
dock/win path is unaffected either way — `canDock` fires on the first tick inside the radius, regardless of
speed.

## Future ideas

solid asteroids with bounce ·
bot behavior (evasion, arc flybys) · custom `.glb` models · multiplayer (WebSocket) ·
engine trails on enemies.

## 102. Levels are 0-based, and a level's id, name and title are the SAME number

**Context.** A level carried three numbers that disagreed. The DB row was named `level-4`, its
player-facing title was `Level 3`, and `players.current_progress` held `4` — because `current_progress`
is a raw `levels.id` and the whole campaign had been shifted down one id when the intro ("Level 0") was
inserted in front of it (§95 era). On top of that `levels.id` was a `BIGSERIAL` and the startup upsert
(`INSERT ... ON CONFLICT (name) DO UPDATE`) burned a sequence value on **every boot**, so production ids
had drifted to 1, 6, 7, 71, 564 — ids that meant nothing at all.

That was tolerable while nothing read the numbers. It stopped being tolerable the day a level needed to be
named in conversation: in one session the ambiguity cost two wrong answers — a feature was built on the
wrong level, and a debugging pass concluded a gate was broken when the player was simply one level further
along than the raw progress number suggested.

**Decision.** One number per level, 0-based, with 0 = the intro. `levels.id`, `levels.name`
(`level-0`..`level-4`) and `descriptor.title` (`Level 0`..`Level 4`) all carry it, and
`players.current_progress` — still an FK to `levels.id` — therefore reads as the level number too. Ids are
written **explicitly** in `catalog_seed.js` and upserted `ON CONFLICT (id)`, which both pins them and stops
the sequence drift (an explicit id never touches the sequence).

**Alternatives rejected.**
- *Rename the rows only, leave ids alone.* Cheaper and lower-risk, but it fixes the two numbers nobody was
  confused by and leaves the one that actually caused the confusion — the progress field.
- *Never show raw numbers anywhere instead of renumbering.* Would have fixed the admin column, but not the
  ambiguity in code, in a psql session, or in a conversation between maintainer and agent, which is where
  it hurt.

**Consequences.**
- A one-shot migration (`levels_zero_based_ids`, db.js) maps by NAME, never arithmetic, because the drifted
  prod ids are not a shift of anything. It parks both `id` and `name` clear of their targets before
  assigning (both collide mid-move; `name` is UNIQUE), moves `players.current_progress` in lockstep with the
  FK dropped, rewrites `gameplay_sessions.level`, then restores the FK and sets the column default to 0.
  Pinned end-to-end by `levels_drift.test.js`, which builds a legacy-shaped database and migrates it.
- **Content gates stay name-based** (§95 still holds). Ids are stable now, but a name is still the thing
  that says *which content*, and fail-closed lookups by name cost nothing.
- Recorded traces store the level NAME they were made on, so every pre-existing recording — the shipped
  intro asset included — names a level one too high. The trace format went to **v3** purely as a marker:
  `traceLevelName()` shifts v1/v2 traces down one at the single boundary where a stored name is read.
  A blanket alias in `normalizeLevelName` was rejected — `level-1` is a perfectly good *current* name, so
  aliasing it would break the live campaign to fix the archive. Nothing on S3 was rewritten (the intro
  asset is content-hashed; rewriting it forces a re-upload and an itch republish for no gameplay gain).

## 103. Level-ups happen live in the fight, so the client mirrors the XP curve

**Context.** Character level was resolved in exactly one place: `bankRun`, after a run ends. Everything
before that was a preview — the HUD's XP bar drew `xpIntoLevel + G.earnedXp` against the *banked* level's
span, so a player who earned enough XP to level mid-fight watched the bar sit pinned at 100% for the rest
of the mission and only saw the "Level up" toast minutes later, back at base, next to the credits summary.
The moment that earned the level and the feedback for it were nowhere near each other.

**Decision.** The HUD resolves the level itself, every frame: `liveProgress(progression, G.earnedXp)` rolls
the banked state forward through the curve, so the bar shows the *live* level, empties toward the next one
the instant a threshold is crossed, and toasts right there in combat. That requires the XP curve on the
client, and the client is served as plain static ES modules — it cannot import from `server/`. So the two
constants and the cost function are **duplicated** in `client/src/progression.js`, with
`client/src/progression.test.js` importing *both* implementations and asserting they agree across the
range. The server stays the authority: it banks the XP and its returned `level`/`experience` overwrite the
client's view at `bankRun`.

**Alternatives rejected.**
- *Serve `server/src/progression.js` to the browser (or symlink/copy it at build).* The duplication would
  be gone, but the client's static-module layout has no shared directory today and inventing one for two
  constants is more machinery than the parity test it replaces.
- *Ask the server for the live level.* A network round-trip per kill, in the middle of a fight, to
  recompute arithmetic the client already has the inputs for.
- *Keep the toast in `bankRun` only and just reset the bar visually.* The bar is the small half of the
  feedback; the toast is the reward. Splitting them would be worse than the status quo.

**Consequences.**
- The toast is deduped by level (`announceLevel` in `hud.js`), not by call site: whichever of the live HUD
  and `bankRun` reaches a given level first shows it, the other is a no-op. `bankRun` still calls it, so a
  level gained while the bar was hidden is not silently lost.
- `bankRun` now writes `xpIntoLevel`/`xpForNextLevel` back and **zeroes `G.earnedXp`**. It has to: with the
  run's XP banked into `experience`, the post-victory active-ship refetch would otherwise return the fresh
  `xpIntoLevel` while `G.earnedXp` still held the same XP, and the HUD would add it twice — visible as a
  phantom extra level-up. That double-count existed before this change and was **observed on production**
  (950 banked XP displayed as `Level 0 · 1900/1000`); only the toast made it worth chasing. The same
  refetch now awaits the bank POST (`bankingDone()`), because the two race for the same
  `activeShip.progression` and a refetch that wins reinstates the pre-run experience.
- A retune of `XP_BASE`/`XP_STEP` on the server is now a two-file change, and the parity test fails loudly
  if only one file moves.

## 104. The campaign has no "Launch mission" button — taking off IS launching it

**Context.** §100 gave the base menu two launch controls: `#mw-go` ("Launch mission ⚔") for the active
mission, and the always-available `#mw-takeoff` ("Take off 🚀") for free flight into the system. Then every
campaign level moved to *fly-to-start*: `launchCampaign()` stopped dropping the player into the arena and
started calling `enterRoam(null)` — spawn at the home base, fly to the level's centre, and the fight begins
when you arrive (`checkMissionZone`). Which is exactly what `takeOff()` does: `enterRoam(null)`.

So on the campaign the two buttons had become the same call, sitting next to each other with different
labels — a difference the player is invited to reason about and cannot find, because there isn't one.

**Decision.** `#mw-go` is hidden whenever the campaign is the active mission, on **every** level. Take off
is the campaign's single launch control. The button (and its `#mw-go-note` hint) returns only for an active
**side mission**, where it still means something distinct: side missions launch straight into their own
level, so "Launch mission: <name>" and "Take off" genuinely differ.

**Alternatives rejected.**
- *Hide it only on the first few levels.* The redundancy is not level-specific — `launchCampaign` and
  `takeOff` are the same call on Level 4 too.
- *Drop "Take off" instead and keep "Launch mission".* Take off is available on every base-menu stage
  (§100 — the hangar must never be a dead end); the mission button only exists inside the Missions view.
- *Keep both and reword the campaign one.* Two controls that run the same function is the problem; better
  copy would only describe it more accurately.

**Consequences.**
- The button starts hidden in `index.html`, so the campaign default never flashes it before the first
  `updateGoButton()`.
- The staged briefing reveal (§ the L1–L3 typewriter) is unaffected: `.briefing-hide-go` hides the global
  Take-off bar `#mw-launch` too, which is now the control being revealed after the briefing types out.

## 105. The campaign mission's map object is DERIVED from its fight centre, not declared

**Context.** Side missions each hang off a system object (`listSystemObjects()` carries their `missionId`),
so "where is this mission?" is a lookup. The campaign doesn't work that way: a level names a **place** —
`descriptor.center`, the point the fight happens at (§100, the fly-into-it trigger) — and nothing ties that
place to an object. So the map had no way to show that the mission you are actually on is at the Space
Factory, which is the one thing a player wants from that screen.

**Decision.** Derive it. `objectForActiveMission({activeMissionId, center})` returns the object hosting the
current mission: an active side mission by its id, otherwise the object **nearest the campaign level's
`runCenter`, within `MISSION_ZONE_RADIUS`** — the same 200 u that starts the fight when you fly in. If a
centre is close enough to trigger the mission, it is close enough to be "that place". The factory anchor
sits 131 u from the factory level's centre; a level naming no centre fights at the origin, which is the home
planet's own anchor, so that level marks the home planet rather than nothing.

**Alternatives rejected.**
- *Add an `object: 'factory'` field to the level descriptor.* One more thing to keep in sync with `center`,
  and it can silently disagree with where the fight actually is — the number that already decides the
  trigger is the honest source.
- *Mark by proximity with its own radius.* A second radius would drift from the zone radius, and then the
  map could point at an object you fly to without the mission starting (or the reverse).
- *Only mark side missions (leave the campaign unmarked).* That is the mission most players are on.

**Consequences.**
- The mark is a **dashed gold frame** on the list row plus a dashed gold ring outside the map marker —
  deliberately distinct from the SOLID gold selection frame/ring, so a selected mission object shows both.
- `system-map.js` gains its only import (`MISSION_ZONE_RADIUS` from `level-sim.js`) rather than restating
  the radius; it stays THREE-free and node-testable.
- Both hosts pass `activeMissionId` into `mountSystemNav` — the base-menu Map and the in-flight overlay mark
  the same object, because they are the same component.

## 106. "Level 4" moves off the origin — its fight centre sits EXACTLY on the far belt outpost

**Context.** Only "Level 3" had left the origin (§100: it fights 30 u up-left of the Space Factory, and you
fly into it to start it). Every other campaign level fought at (0,0), so four levels out of five began the
instant you took off and the flyable star system was scenery you visited between missions. "Level 4" is
narratively the level that *should* be a trip: "Find the pirate base" — you track the ships that fled the
factory. The third mining outpost, meanwhile, was pure navigation filler at `(-760,1560)` with nothing to do
there.

**Decision.** Move that outpost out to `(-900,2800)` — the system's most distant destination (~2941 u from
the base, past `mining2`'s 1893) — and give "Level 4" a `center` at that **exact** point. The trail leads
somewhere far, and the far place already has a reason to exist.

**Why the centre is ON the anchor, with no framing offset.** The factory level is deliberately offset 30 u
because a 120 u ring station centred on the arrival point swallows the ~15 u ship. An `asteroid-field` is
the opposite kind of set-piece: 18 rocks scattered over a 210 u spread, 100 u **below** the combat plane.
There is nothing to frame around and nothing to hide behind, so the natural read is fighting *inside* the
field — and a 0 u offset also means autopilot parks you dead on the centre, giving the fly-in countdown the
full `MISSION_ZONE_RADIUS` (200 u) of margin instead of spending part of it on framing.

**Alternatives rejected.**
- *Centre near the field but not on it (the first sketch: field `(-900,2800)`, centre `(-750,2650)`).*
  212 u apart — just **outside** the 200 u fly-in zone. Autopilot would park you at the outpost and nothing
  would happen: no countdown, no gold "your mission is here" frame, the level unreachable by the intended
  route. This is the failure mode the new `level-sim.test.js` guard now pins for every relocated level
  (nearest `ANCHORS` entry must be < `MISSION_ZONE_RADIUS`).
- *Raise `MISSION_ZONE_RADIUS` to fit.* It is shared by every level and every side mission; widening it
  everywhere to accommodate one placement makes fights start earlier system-wide.
- *Leave the outpost where it was and fight there.* 1735 u vs 2941 u is not a meaningfully different trip
  from `mining2`; the point of this level is that it is the long haul.

**Consequences.**
- Take off on "Level 4" launches you at the **home base**, not into the fight — same as "Level 3". The run
  out is the longest in the game; the roam autopilot is uncapped (§ speed cap), so it is a cruise.
- The map's dashed gold mission frame lands on the outpost automatically (§105 derives it from the centre).
- `ANCHORS.mining3` now has three consumers that must agree: the anchor, the `asteroid-field` set-piece
  `pos`, and the level's `center`. The set-piece pairing was already test-pinned; the centre now is too.

## 107. The star is a .glb, and only the YELLOW half of it is drawn

**Decision.** Vega is a real model (`sun_combat.<hash>.glb`, CC-BY "Sun" by SebastianSosnowski) rather than
the emissive sphere + glow sprite it replaced. The asset ships **two concentric spheres** — an orange
emissive core inside a slightly larger yellow shell whose material carries `KHR_materials_transmission` —
and the game draws **only the shell** (`system.star.yellowOnly` hides the core).

**Why not draw both, as the asset intends.** The shell is see-through face-on, so the orange core reads
through the middle while the shell's long grazing path at the limb reads yellow. The result is a disk that
looks like two halves of different oranges, with a hard seam at the terminator of the effect. Whatever that
is meant to look like in a turntable render, in a top-down game where you park beside it, it reads as a
rendering bug.

**Why not just tint the core yellow.** Its colour is an orange emissive **texture**, and a material colour
only ever *multiplies* the texture. Multiplication cannot raise a channel, so no colour makes an orange map
yellow — the green channel simply is not there to scale up. Recolouring would mean editing the texture in the
build (a real option, see below), not a runtime knob.

**Why the transmission material stays, despite being the priciest one in the game.** `transmission: 1` costs
three.js an extra render target per frame. We tried replacing the shell with an unlit `MeshBasicMaterial`
carrying its emissive map: it rendered **orange**, because the yellow is produced by the transmission itself,
not by any texture (the shell's emissive map is the same orange image the core uses). Keeping it is
affordable for one specific reason: the distance fade **hides the entire star** outside `SYSTEM.fade.out`
(760 u), so at the base — and everywhere except the star's own neighbourhood, which is 15 000 u from
anywhere you normally play — the pass never runs at all. If that fade ever widens, this becomes a real cost.

**Left on the table.** Baking a yellow-tinted texture in `assets:build` would let the shell be an unlit
material and delete the transmission pass. Not done because the current cost is provably zero in normal play
and the bake is a new pipeline pre-pass; revisit if the star ever becomes visible from the base.

**Also decided here.** The hidden core is **not** stripped from the asset. It is never drawn, but its texture
is the SAME 556 KB image the shell uses as its emissive map, so removing the mesh would free only a sphere's
worth of geometry — not worth a build pre-pass. And the core mesh is **hidden, not removed, at runtime**:
`buildSystemBodies` captured the procedural sphere's material for the distance fade, and removing it would
leave that list pointing at a disposed material.

## 108. The mid-game gear tier is gated by campaign progress, and locked rows are HIDDEN, not greyed out

**Decision.** Three shop rows — **Heavy hull** (component 13), **Heavy Machine Gun** (weapon 7) and
**Triple spiral rocket** (weapon 11) — carry `stats.minLevel = 'level-4'` (`FACTORY_GATE`) and only go on
sale once the player has **cleared "Level 3"**, the weapons factory. Until then they are **absent from the
shop list entirely**; there is no greyed-out row, no "unlocks after Level 3" tooltip.

**Why gate them at all.** Credits are earnable off the campaign — side missions unlock at the same beat and
are repeatable — so without a gate the whole mid-game power tier was purchasable by grinding, at whatever
point in the story the player felt like grinding. Two things go wrong: the levels tuned around the starter
ladder get trivialised by gear from two acts later, and the factory — the first boss, the level the tier is
*named after* — stops being the thing that earns it. The gate makes the story beat the unlock, and the
credit balance only the second condition.

**Why hidden rather than shown-and-locked.** A locked-but-visible row is the standard "teaser" pattern and it
was the other candidate. The maintainer's call was hidden: the shop is a *list of what you can buy*, and a
row you cannot buy makes every list scan a two-step read. The teaser job is done instead by the **"(new)"
marker** on the Loadout menu item when the tier unlocks — which advertises the gear at the moment the player
can actually act on it, rather than nagging for three levels beforehand.

**Why the gate is on the PURCHASE, not on ownership.** A gated item that *drops* still deposits into the
stash and equips normally. Loot is earned in the fight that dropped it; taking it away because the story
counter is behind would punish the player for winning. The shop is the economy lever, so that is where the
lever sits.

**Why by level NAME.** Same rule as §95 — the gate is `'level-4'`, resolved against the `levels` table, never
a raw id. Enforcement is server-side (`buyItem` → 403 `item locked`); the client filter is presentation only.
The client mirrors it from `activeShip.reachedLevels` (a list of level *names*), so it never learns an id.

## 109. The roam nav buttons STAY visible during autopilot (switch/cancel), unlike #return-btn

**Decision.** The roam bottom-center bar (`#roam-nav`: "Return to Base" + "Autopilot to Mission") keeps **both
buttons on screen while an autopilot is flying**. Clicking the destination you are already flying to **cancels**
the autopilot back to manual; clicking the other **re-routes** in place. The live one carries an `.engaged`
outline. This is the **opposite** of the return-to-base `#return-btn` (§ / return-to-base section), which
**hides the moment its autopilot engages**.

**Why the divergence is deliberate.** `#return-btn` has exactly one destination (home), so once it's engaged
there is nothing left to offer — hiding it is correct. Roam has **two** destinations, so the bar's job is not
just "go" but "which of the two, and stop": with both always present the player can switch targets or bail out
of an autopilot with one tap, and the `.engaged` outline shows which trip is currently running. Hiding the
engaged button here would strand the player mid-flight with no visible cancel. A future refactor tempted to
"unify" the two bars should not — they answer different questions.

**Pointer + button share one source.** Both the gold off-screen mission pointer and the "Autopilot to Mission"
button read `G.roamMission`, snapshotted at `enterRoam` via `objectForActiveMission` (§105's resolver: side
mission → its object, campaign → the object nearest its fight centre). When it is null both hide, so the HUD
never points at or offers travel to a mission that isn't there. The bar reuses `#return-btn`'s bottom-center
slot, which is safe because `G.roam` and `G.returnToBase` are never both true.

**Also decided here.** The Heavy Machine Gun's stats moved with the gate: **weight 8 → 15** (the heaviest gun
in the game, above the Heavy cannon's 10) and **aim assist 2° → 3°**. It is meant to be the endgame bullet
weapon, and mass is the price of admission — mounting it on a light hull costs real acceleration and turn, so
it pairs with the Heavy hull that unlocks alongside it rather than being a free upgrade.

---

## 110. A cleared SIDE MISSION is a content gate, and existing players are grandfathered into it

§108 tied the mid-game power tier to campaign progress. This adds a **second gate kind**: the Ion engine (16)
and Nanobot repair (20) are sold only after the player has **cleared the "Research station" side mission**
(`stats.minMission`, `RESEARCH_GATE = 'side-research'`). Why a second kind rather than just another
`minLevel`: the reasoning of §108 (a story beat should be what earns a power spike, not a credit balance)
applies, but the beat here is **optional content the player chooses to fly**. A `minLevel` can only say "keep
going down the main road"; `minMission` can say "go do that thing over there", which is what makes the two
premium support parts feel earned rather than bought. Both kinds compose with **AND** through one predicate on
each side (`itemUnlocked()` → `buyableNow()` on the client, `buyItem()` on the server), so a row may carry
either, both or neither.

**Compared by the mission's stable id string, never a row id** — the same discipline as §95. The catalog names
`'side-research'`, the generator names `'side-research'`, and nothing anywhere learns a `cleared_missions`
row id.

**Completion needed new persistence.** `taken_missions` records what the player **accepted** and
`players.active_mission_id` what is **active**; clearing a side mission banked credits/XP through
`POST /api/games` and left no trace. So the feature adds `cleared_missions (player_id, mission_id,
cleared_at)` with a PK on the pair — permanent and idempotent, since re-clearing must be a no-op (the unlock
cannot be "used up", and the offers are repeatable grind).

**The clear report is client-authoritative**, posted from the victory path to
`POST /api/players/:id/missions/clear` next to `bankRun()`/`depositLoot()` and suppressed under
replay/playback. That is parity with every other run reward, not a new hole: the server already takes the
client's word for credits, XP and looted items. Server-sealed mission results remain a separate, later
integrity item (`docs/plans/mission-generator.md`) — doing it for this one endpoint alone would buy nothing.

**Existing players are grandfathered, and the rule is deliberately fuzzy.** A one-shot ledger-guarded
migration (`grandfather_research_clear` → `backfillResearchClear()`) credits `side-research` to every player
whose `current_progress` has reached `SIDE_MISSIONS_MIN_LEVEL` (`level-4`, resolved by NAME via the same
`EXISTS` predicate `reachedLevel` uses). That grants the unlock to players who reached Level 4 but may never
actually have flown Research Station. Accepted knowingly as the **kinder error**: the alternative is silently
pulling a 6400- and a 7000-credit item off the shelf of players who could already buy them, which is a
regression they would experience as the shop breaking. Over-granting affects only the small set of accounts
that predate this release; every player after it earns the unlock properly. The backfill is one set-based
statement with `ON CONFLICT DO NOTHING`, so it is safe to re-run — which matters, because the whole schema
bootstrap runs on **every** server start.

---

## 111. The "(new)" trail needs TWO pieces of state, a tab's gold is DERIVED, and a new GATE KIND must never announce itself on gear you already own

The gold "(new)" led the player *Loadout menu item → Shop button* and stopped. It now continues onto the
shelf: the shop **type tab** whose section still holds an unseen unlocked row is gold instead of blue, and so
is that row.

**Two localStorage keys, not one.** `shopSeenNew:<playerId>` keeps its meaning — *"the shop has been opened
since these rows unlocked"* — and still drives the menu + Shop-button markers. The gold frames need a second,
finer fact: *"this specific row has been clicked"* (`shopItemsClicked:<playerId>`). One key cannot serve both,
because `markShopItemsSeen()` fires on `open-shop` and would write the whole gated set — killing every gold
frame before it could render. Both keep the first-sight baseline semantics and are pruned to what is unlocked
now on every write, so a progress reset re-arms them.

**The clear trigger is the ROW CLICK**, not the purchase and not merely opening the detail card. The trail is
about *noticing* new gear, not about spending: a player who looks at an item and decides against it has
still seen it, and leaving it gold until they buy it would turn the marker into a nag.

**A tab's gold is derived, not stored.** A tab is gold **iff** its section still holds an unseen row
(`unseenSections`), so there is no third piece of persisted state to keep in sync, and the case where the
unseen row sits in the section that is *already active* when the shop opens (it opens on `hull`) needs no
special handling — there is no tab click to wait for, the row just shows its gold. Accepted consequence:
visiting a gold tab without clicking the row leaves it gold. That is wanted — the trail keeps pointing at
unfinished business.

**`shopMarkerKinds`: a new gate KIND must not fire the markers on gear you already own.** This is the second
time this symptom had to be designed out. The first-sight baseline (`primeShopItemsSeen`) fixed it for a
device that had never been primed, but it does nothing for a device whose baseline was taken **before a gate
kind existed**: on the first load after this release a grandfathered player's gated set jumps 3 → 5 (Ion
engine + Nanobot repair become gated-and-unlocked) and the stored set holds only the 3, so both "(new)"
markers would fire for items that had been purchasable all along. The fix records which **gate kinds** the
baselines were taken under, and at prime time folds any row that is gated+unlocked now but carries **none** of
those kinds into the baselines as already-seen (`absorbRefs`).

Keyed on gate **KINDS**, not on this release's item ids, for two reasons: it works for the next gate kind with
no edit (adding to `GATE_KINDS` *is* the version bump — there is no separate epoch number to remember), and it
is narrow enough to leave a genuine pending marker alone (a row gated by an already-known kind is untouched,
so a player who unlocked the "Level 3" tier but never looked at it keeps their marker). Consequently
`shopMarkerKinds` is **not** cleared by a progress reset or a marker re-arm, and a corrupt read of it errs
toward swallowing (it re-runs the absorb under `LEGACY_GATE_KINDS`) — the opposite of the two marker keys,
which err toward silence. Clearing it would make the next prime swallow a legitimately pending `minMission`
marker.

The whole state machine lives in a pure module (`client/src/shop-markers.js`) with `shop.js` holding the
`localStorage`/DOM I/O, precisely because its last bug was a state-machine bug that `node --test` could not
reach through DOM-bound code.

## 112. Aim assist tests the HULL SPHERE, not 48 box centres — and picks the best-AIMED target, not the nearest

The auto-aim cone modelled every ship as a point at `mesh.position`. With `aimAssistDeg: 2` that cone is
0.35 u wide at 10 u — narrower than a wing. Flying head-on at a pirate, the player's bullets streamed past
its wing with the launch angle never changing; hits happened only when the wing wandered into the line of
fire. The assist looked broken because, for anything but a dead-centre target, it never fired at all.

**Why not the per-part hitboxes.** The obvious fix — test the cone against the parts we already register hits
on — was considered and rejected on both counts. Ships carry **48 OBBs** each (`assets:hitboxes` budget), not
"a few spheres"; the single sphere in the `?hitboxes` view is the broad-phase one. Testing them means
`updateMatrixWorld` plus 48 affine transforms **per candidate, per spawned bullet** — `findBulletAimTarget`
runs on every bullet of every mount, and an HMG group fires several every 0.12 s. That is ~100× the work of
the point test for a result that is also *worse*: box centres sit **inside** the hull, so the union of them
**under**-covers the silhouette (the wingtip box's centre is inboard of the wingtip), and aiming at the
nearest box centre would put the shot on a wingtip and graze. The enclosing sphere covers the silhouette by
construction, is one number, and is already maintained by the collision broad-phase.

**Exact sphere-vs-cone, no trig in the loop.** Widening the cone by `asin(r/d)` blows up at point-blank and
costs a trig call per candidate. Instead: at axial distance `along` the cone's radius is `along·tan(half)`
and a sphere of radius `r` reaches `r/cos(half)` further out laterally, so the hull overlaps iff the centre's
lateral offset is within their sum. `tan`/`cos` hoist out of the loop, making this **cheaper** than the old
normalize-and-dot — and it needs no arbitrary close-range cap, because the near-range term is a constant
lateral padding, not an exploding angle. The condition stays geometrically honest at every range: *the hull
overlaps the cone*.

**Best-aimed beats nearest.** Ranking by distance was safe while the cone was a needle at most one ship could
occupy. With hull radii several ships qualify at once, and nearest-wins would hand the shot to a closer
bystander clipping the cone edge — the assist would bend the player's fire **off** the ship they chose, which
is worse than no assist. The winner is now the lowest `(perp − r/cos(half)) / along`: the angle from the aim
axis to the hull's near edge, negative once the axis is inside the hull. Distance breaks a score tie only.

**The aim point is still the hull CENTRE.** The radius decides *whether* the assist engages; it must not
decide *where* it shoots. Aiming at the near edge that let the target in would convert every marginal
engagement into a graze — the exact failure being fixed.

**Accepted cost: the recorded intro trace desynced and was re-recorded.** Any change to bullet direction
shifts the seeded gameplay stream, so `22-intro-replay` (the Level-0 cutscene input replay) dropped to 3/4
kills with the trace running out and one pirate alive. Verified as caused by this change: the same guard
passed 4/4 with the three files stashed. That is the standing price of a sim change, not a defect in this one
— the guard exists to make it visible (see §73 and the guard's own header). Re-recorded as
`level0-intro.6674d840.json` (green: 4 kills, `p0..p4`, win at tick 2503/3490). Cheap to redo precisely
because the cutscene's pauses fire on SIM EVENTS, not fixed ticks — that design choice paid for itself here.

---

## 113. No reverse thruster: `S`/`↓` brakes, and the ship can never fly backwards

`S`/`↓` used to apply `-accel` along the nose (`stepPlayer`), the mirror image of `W`. It is gone. The key
now runs the same kinematic `brakeStep` the autopilot uses: the velocity bleeds toward 0 at the ship's own
acceleration and stops there — it never crosses zero into reverse.

**Why.** Two reasons, and the first is the one that settles it:

- **It was a keyboard-only ability.** Touch steering has no reverse and cannot get one: the virtual stick
  turns the nose toward the finger and thrusts along it, and `touchAim.thrust` is a magnitude in `0..1`
  (`main.js`, `state.js`). The phone player's only way to kill speed is to turn around — so every fight was
  balanced twice, once for a ship that can back off and once for a ship that can't.
- **It broke combat balance.** Enemies close in and hold a band (`enemyThrustFactor`), while the player's
  weapons all fire forward. Reverse let the player retreat with the nose — and the guns — still on the
  target, holding an enemy at its worst range indefinitely. That is a kite, not a dogfight, and it is
  precisely the pressure the enemy AI's approach is supposed to create.

**Why a brake and not simply a dead key.** Strict touch parity argues for ignoring `S` entirely, and the
choice was made deliberately the other way: killing inertia is a real manoeuvre a keyboard should express,
and a brake grants no positioning the ship couldn't already reach — it only removes speed. It also keeps
`S` cancelling the autopilot as before (any control input hands control back, §39). The residual asymmetry
is that a phone player must turn around to stop; that is far smaller than the one being removed.

**`W`+`S` thrusts forward.** Whichever way the two were composed, the outcome would depend on the order they
land in the tick. Forward simply wins (`keyboardThrust`), so the combination is a plain accelerate.

**The rule lives in a pure seam.** `keyboardThrust(keys)` in `steering.js` returns a **non-negative** thrust
multiplier plus a brake flag; `sim.js` is DOM/Three-bound and untestable in Node, so the invariant is guarded
there instead — a test asserts no combination of movement keys can yield `thrust < 0`.

**Replays are unaffected.** A trace stores held key codes, so a change to what a key MEANS would desync any
recording containing it. The shipped Level-0 intro trace (`level0-intro.6674d840.json`) contains no `KeyS` /
`ArrowDown` — checked before the change, and `22-intro-replay` stays green. Archived *session* recordings
that used reverse will replay differently in `/admin/sessions`; accepted, they are diagnostic material.

## 114. The `phone` form factor is decided by the SHORTEST edge, not the longest

`classifyForm` used to key every tier off the viewport's **longest** edge, with `phone` below 900 CSS px —
chosen so orientation never flips the form (`max(w,h)` is symmetric, §34). It has one failure the maintainer
hit on a Galaxy Fold: the cover screen is ≈ 369×905 CSS px, so its **long** edge sits right at the 900
boundary. Entering fullscreen hides the browser chrome, the long edge grows past 900, and the form flips
`phone→tablet` mid-session — the whole `dev-phone` shrink pass (slot chips, right-panel fonts) drops and the
loadout balloons. The S21 (360×800) never crosses 900 in either state, so it never showed the bug.

**The fix: classify `phone` by `min(w,h) < 600`; the larger tiers keep the longest edge.** The short edge is
the honest discriminator — a handheld's shorter dimension is ≤ ~450 CSS px (S21 360, iPhone Pro Max 430, Fold
cover 369) while a tablet's is ≥ ~740 (iPad mini 744), a gap no phone approaches. It is still
orientation-invariant (`min` is symmetric), and — unlike the long edge — it barely moves when the browser
chrome hides, so the classification is stable across the fullscreen toggle. As a bonus it corrects large
phones (iPhone Pro Max, long edge 932) that the old rule already mislabelled tablet.

**Why not aspect ratio or User-Agent** (both raised and rejected). *Aspect ratio* fails on desktop: a 16:9
browser window (1.78) is indistinguishable from a phone in landscape (~2.2), and an iPad in landscape (1.33)
from a narrow desktop window — it needs a size gate anyway, which is what the short edge already gives.
*User-Agent sniffing* is brittle (spoofed UAs, desktop-mode on phones, unknown new devices) and redundant: the
capability signal we actually need — "is this a handheld touch device" — is already the separate `input`
axis (`pointer: coarse`), not something to re-derive from a UA string.

**Scope.** `classifyForm(longest, shortest)` (two-arg; `shortest` defaults to `longest` for the square-ish
single-arg test cases). A local `formOf(w, h)` feeds it `max`/`min` at both call sites (`Device.form`,
`applyDevice`). CSS and the `dev-phone|dev-tablet|…` classes are unchanged — only *which* devices land in
`dev-phone`. The only side effect is that a small desktop *window* (short edge ≥ 600 but long edge < 900,
e.g. 800×700) is now `tablet` rather than `phone`; that layout is roomier, not smaller, so it is a
non-issue. Guarded by `device.test.js` (Fold-cover both chrome states, Pro Max, iPad mini).

## 115. Canonical star frame, but combat runs in a planet-2 FLOATING ORIGIN; objects tag a `frame`

The world was authored with **planet 2 pinned to `(0,0)`** — the base, all set-pieces, mission centers and
the four-way invariant (§98) live in that one origin-pinned frame, and `system-map.js`'s `bodyWorldPos`
achieves it by placing the star at `−orbitVec(planet2)`. The maintainer wants the **star** to be the
coordinate origin, planets orbiting it, and objects that are either *attached to a planet* or *fixed in
space* — as a first stepping-stone toward the roadmap's Phase-5 multiplayer (a server-authoritative
persistent overworld + isolated combat instances). See `docs/plans/heliocentric-coordinate-frame.md`.

**Decision: make the CANONICAL frame star-centered, but keep the runtime working frame a planet-2 FLOATING
ORIGIN.** The heliocentric math already existed, just inverted; we expose it (`starWorldPos`,
`planetOriginOffset`, `worldToLocal`/`localToWorld`) and keep `bodyWorldPos` returning **local** coords, so
`bodyWorldPos(n,t) === worldToLocal(starWorldPos(n,t), planetOriginOffset(t))` and every gameplay consumer is
numerically unchanged.

**Why not run combat in raw star coords** (the literal reading of "everything in the star frame"). The base
sits ~10 500 u from the star, so combat would run far from the numeric origin — Float32 precision loss on the
GPU, and a pile of code that assumes "the fight is near 0". A floating origin gives the maintainer what they
actually asked (the base *does* drift within the star frame — space-fixed objects move relative to it at
~0.51 u/s, lapping the orbit every ~1.5 days) while combat stays near 0. The base's linear drift is real and
visible over minutes of roam; only the *angular* rate is slow (~0.17°/min) — an easy thing to misjudge.
(orbitR here is 10 500 after the 2026-08-18 0.7× orbit compaction; it was 15 000 / ~0.73 u/s when first written.)

**Why not keep planet 2 as the canonical origin** (the safe non-change). Then a "fixed in space" object is
physically indistinguishable from a planet-attached one — they never move relative to each other — so the
maintainer's core requirement (interactive objects the planet drifts past) is impossible. The distinction
*requires* two frames that move relative to each other.

**A "zone" is just an origin point, kept a parameter.** `worldToLocal(pt, origin)` takes the zone origin as
an argument rather than hardcoding planet 2. Today the only origin is `planetOriginOffset(t)` (the base); an
isolated combat instance later passes its own zone center. **No `Zone` type, registry, networking or server
sim is built** — that generalization is the whole Phase-5 concession taken now, and it is authority-agnostic
(the transform is identical whether client or server owns the sim), so this change does not commit us to
client-vs-server authority. (Ethos §30: don't pre-build for scale — the parameter is free, the machinery is not.)

**Determinism.** Space-fixed set-pieces are **decor not read by the sim**, so re-deriving their local
position from `Date.now()` each frame is replay-neutral exactly like the sky bodies (§73) — the
`22-intro-replay` guard stays byte-identical. The moment a `frame:"world"` object becomes **sim-facing**
(collidable / a fight center), it must instead **snapshot `planetOriginOffset` at level entry** and hold it
constant through the deterministic tick, or wall-clock would leak into the seeded stream and desync replays.
That snapshot rule is specified in the plan and is a prerequisite for any future interactive world-fixed
combat object — the current demo object is decor and deliberately does not need it.

## 116. Single-player keeps simulating in the browser; the server authority is for multiplayer only

**Context.** Moving combat to a server-authoritative simulation raises the obvious question of whether
single-player should also run through it — it would be one code path, and it would close the
client-authoritative economy hole (`POST /api/games {credits, kills}`).

**Decision.** Single-player continues to run the simulation locally in the browser. The server-run instance
is opt-in and additive (`?netsim=1` in the first cut).

**Why.**
- The failure mode changes in kind, not degree. Today a network blip costs an unbanked run; a socket-bound
  fight dies with the blip. The game already needs the backend to *boot* (the catalog fetches in `main.js`
  have no fallback), but after boot the fight is entirely local, and that is worth keeping.
- itch is served worldwide from rotating CDN subdomains; the VPS is one box in one datacentre. 200–300 ms
  RTT is a loading delay today and would become the feel of the controls.
- Server load shifts from "tens of requests per session" to "N concurrent worlds at 60 Hz" on the box that
  also runs Postgres and the static client.
- **The decisive reason is engineering.** With single-player on the browser host and multiplayer on the Node
  host, one shared `sim-core` running in two places gives a permanent divergence oracle: the same input
  trace must produce the same outcome on both, as a test. Route single-player through the server and the
  browser path atrophies, the two implementations drift, and "one simulation" becomes a slogan.

**The economy hole is closed differently, and better.** Every session is already recorded as an input trace,
so the server can re-simulate a submitted trace headless with the same `sim-core` and seal the reward — exact
anti-cheat with no socket attached to the fight. Deferred to its own slice.

## 117. The sim owns `pos`/`heading`/`scale`; `syncMeshes()` is the only bridge to Three.js

**Context.** Simulation state lived inside Three.js objects: position was `entity.mesh.position`, velocity a
`THREE.Vector3`, and `mesh.scale` *was* gameplay — the warp-in grow drove `e.warping` (invulnerable, can't
fire, not homing-targetable). `collision.js` was deliberately THREE-free (§45) but still read
`mesh.matrixWorld.elements`, so even hit tests needed a live scene graph.

**Decision.** Entities carry plain `pos` / `vel` / `heading` / `scale` (`sim-core/vec.js`), warp-in is
simulation state (`warping`/`spawnAge`/`spawnDur`), and a single one-way `sim.js syncMeshes(dt)` copies that
into the scene graph once per tick. Nothing in the simulation reads a mesh back. `collision.js` composes the
ship matrix itself from the entity's own state.

**Why decouple the player too, not just enemies.** Half-decoupled is the worst state: with enemies on `pos`
and the player on `mesh.position`, every interaction (enemy aiming, `resolveHostileBulletHit`, autopilot,
docking) needs a bridge that is written and then deleted. `stepPlayer` is also exactly what client-side
prediction will re-run, so leaving it entangled means doing the work twice.

**Alternative rejected: keep the Three objects and mirror into plain data.** Two representations of one
truth, with an ordering rule nobody can enforce. The whole point is that there is one authority.

**Cost accepted.** `Vec3` duplicates a slice of `THREE.Vector3`'s API. That is deliberate: identical method
names keep the sim code readable after the move, and since both sides only ever read `.x/.y/.z`, a `Vec3`
and a `THREE.Vector3` can be handed to each other freely.

**Where that duck-typing ends — learned the hard way.** `THREE.Object3D.lookAt(v)` does not read `v.x`; it
branches on `v.isVector3` and otherwise falls through to `set(v, undefined, undefined)`. Passing a `Vec3`
therefore NaN'd the camera's quaternion — **nothing rendered, nothing threw**, and every simulation-state
assertion still passed, including the intro replay down to its exact tick count. Call sites now pass
components (`camera.lookAt(p.x, p.y, p.z)`).

We deliberately do **not** set `isVector3 = true` on `Vec3`. It would fix `lookAt` in one line and claim the
entire `Vector3` API — turning a loud, greppable boundary into a silent one that fails further out, at
`.project()` or `.applyMatrix4()`. The boundary is documented at the top of `vec.js`, and `01-smoke` now
asserts the camera has a finite position and orientation: the cheapest guard for the whole class, verified
by reintroducing the bug and watching it fail.

**Known stopgap.** `noseZ` — where bullets are born — is measured off the loaded `.glb` at runtime, so a
piece of *simulation input* is derived from an asset a headless server would never parse (and a shot fired
before the model lands uses the `1.6` primitive default — a latent replay wobble that predates this change,
mitigated today by `preloadLevelShipModels`). `syncMeshes` copies it back sim-ward each tick as an explicit,
labelled stopgap; the real fix is to bake it into the catalog alongside `hitBoxes`/`broadR`.

## 118. The server tick stays 60 Hz; only the snapshot rate drops to 15–20 Hz

**Context.** The natural instinct for a server-authoritative sim is a 30 Hz tick — it halves server CPU and
is plenty for a game that is not a twitch shooter.

**Decision.** Both hosts step at `TICK_HZ = 60` (`client/src/bench.js`). The *snapshot* rate to clients is a
separate knob, starting at 15–20 Hz.

**Why.** Integration is dt-dependent (`vel *= 1 - DRAG*dt`, thrust accumulation, `spawnAge`), so 30 Hz in
Node against 60 Hz in the browser produces **different outcomes for the same input trace** — which destroys
the cross-host divergence oracle that §116 is built on, and makes client-side reconciliation worse for no
gain. Upstream cost is negligible (`{tick, keys}` is a handful of bytes, batchable), and simulating ~10
enemies and ~50 bullets at 60 Hz is microseconds per tick.

If per-room CPU ever becomes real, the tick drops **on both hosts at once** — it is one constant — by
measurement, and lowering it re-derives every timing-tuned count, so it is a change with its own test pass.

## 119. The World is threaded through the sim as an argument, and `sim.js` keeps proxies rather than moving call sites

**Context.** Extracting the simulation meant every step function had to stop reading the module singletons
in `client/src/state.js`. There were two ways to pay for that: rewrite the ~200 call sites across the client
that say `G.kills`, `enemies`, `levelRunner.won`, `engageAutopilot()`, or thread the World in and keep the
old names pointing at it.

**Decision.** The World arrives as the **first argument** of every sim-core function, and the client keeps
its historical names as thin bindings onto this tab's World:
- `state.js` defines getter/setter proxies so `G.player`, `G.kills`, `G.autopilot`, `G.baseStation` and the
  rest read and write `world.*` — one copy, two names;
- `sim.js` exports `levelRunner` as an object whose ten fields proxy onto `world.levelRunner` and whose
  `start`/`update`/`win` delegate to `sim-core/level-runner.js`;
- `sim.js` exports `warpPlayerToCenter`, `engageAutopilot`, `engageDropAutopilot`, `engagePointAutopilot`
  and `cancelAutopilot` as one-line binds;
- `ship-build.js` keeps `updateGroups`, `resolveComponents`, `spawnEnemyShip` bound to the same World.

**Why.** There is no real alternative to the argument itself: `state.js` runs `window.localStorage` at
import time, so sim-core can never reach it in Node — the collections *have* to arrive as a parameter, and
one process then holds many Worlds, which is what a server needs (§116).

The proxies are the deliberate part. Rewriting every call site would have made a 6000-line diff out of a
behaviour-neutral refactor, and behaviour-neutral is the only property that made the intro-replay oracle
(`tick=2503/3490`, unmoved across every refactor commit) meaningful evidence. Every call site changed is a place
the oracle cannot see. The cost is one indirection and a small amount of "this looks like a singleton but
isn't" — paid once, in two files, both of which say so at the top.

**Consequence worth knowing.** A proxy is not free of ordering: `world.station` is a *set-piece*, so the
client's scenery rebuild replaces the object the sim holds. That is why starting a run is two sim-core calls
with the rebuild between them (`clearAndPlaceRun` → scenery → `startRun`) rather than one.

## 120. The browser↔Node divergence oracle compares a world digest AND the seeded-RNG draw count

**Context.** §116 keeps single-player simulating in the browser precisely so that two hosts running one
module give a permanent, free divergence oracle. An oracle nobody runs is a slogan, so it had to become a
test — and the test had to decide what "the same fight" means.

**Decision.** `36-sim-divergence` replays the canonical Level-0 input trace in a real browser and headlessly
in Node (`server/tools/sim-replay.mjs`) and asserts three things: the same **world digest**
(`sim-core/digest.js`, FNV-1a over the full-precision state), the same **run summary**, and the same
**number of `simRandom()` draws** consumed (`sim-random.js` counts them; `seedSim` resets the counter).

**Why the draw count, separately from the hash.** The hash answers "did they diverge"; the draw count
answers "why". The failure this project actually keeps having is a §73 violation — a cosmetic path reaching
into the seeded gameplay stream. That shifts one host's stream and not the other's, and a bare hash
difference gives no clue where to look, whereas `seeded RNG draws differ (browser 3525, node 38)` names the
class of bug in the message. Verified by injecting exactly that bug.

**Why full precision.** Both hosts run the same code over IEEE doubles in the same order, so bit-identical
is the correct expectation, not an optimistic one. Rounding first would hide a real divergence during the
window where it is still small — which is the window where it is cheap to find.

**What it deliberately does not cover.** The browser side runs plain `?playback`, never the intro cutscene:
the cutscene freezes on cards and fakes a "Return to base" click, and a trace records keys and touch, never
a mouse. That is browser-only machinery a headless referee has no business reproducing. `22-intro-replay`
guards the cutscene path; this guards the simulation. Neither sees the *picture* — a NaN camera passes both
(§117's lesson), which is what the full visual suite is for.

## 121. A netsim client re-uses its own World; the network is just another producer of the event stream

**Context.** With the server able to run a fight (§116, Slice D), the browser needed a way to draw one it is
not simulating. The obvious shape is a separate "remote entity" renderer — the plan itself suggested
generalizing `ghost-battle.js` for it.

**Decision.** There is no second rendering path. `?netsim` keeps the same `World` the tab always had and
lets the NETWORK write it instead of `simTick`:
- entities arrive through **`world.host.onSpawn` / `onDespawn`**, the same lifecycle hook the simulation
  uses, so a networked enemy gets its mesh from exactly the code a local one does;
- wire events are pushed onto **`world.events`**, so the adapter in `sim.js` turns them into FX, audio, the
  HUD, i18n and the overlays without knowing where the fight was decided;
- `renderTick(dt)` runs unchanged.

**Why.** The alternative duplicates the half of the client that is hardest to keep correct — health bars,
markers, the mini-map, kill FX, the event log, the victory overlay — and it duplicates it in the path that
gets played LESS, so it rots first. The host and the event queue were built for precisely this asymmetry
("what does an entity mean to this host", "what happened, for someone else to act on"); a netsim client is
just a third host answering the same two questions. The practical cost was about 250 lines
(`netsim-world.js`) and it is THREE-free, so reconciliation is unit-tested in Node against a real room.

**What this buys later.** Slice E's prediction is then a small change rather than a new subsystem: the World
is already there and already steppable by `sim-core/tick.js`, so predicting is "re-run my unacked inputs on
it", which is what `replay.js` already does.

**The trap it creates, and the guard.** Because the netsim path looks identical downstream, a local
simulation still running underneath would produce a screen that looks perfectly right while the two worlds
silently diverge. `37-netsim` pauses the room and asserts the world FREEZES; that is the only cheap way to
prove nothing else is moving it.

## 122. Snapshots name a ship; they never describe it

**Context.** A client must build a mesh for an enemy the server spawned. The direct approach is to put what
the renderer needs into the spawn message.

**Decision.** The wire carries the catalog **name** plus the few per-entity numbers the catalog cannot give
(`maxHp`, `fullScale`, `role`). The client resolves the model, yaw, lift, scale and everything else from the
catalog it already fetched at boot.

**Why.** The first draft sent `modelCfg`, which is `shipModelCfg(stats)` — and that carries `hitBoxes`,
dozens of oriented bounding boxes per hull. It is collision geometry only the server uses in a netsim room,
it would have been tens of kilobytes repeated 15 times a second, and it hands a client the authority's
internal state for free. The guard that caught it before it ever ran is a snapshot-size assertion in
`server/src/netsim/room.test.js` plus an explicit `assert(!json.includes('hitBoxes'))` — worth keeping,
because the leak arrived by copying a field list, which is how it will arrive again.

**Corollary.** The same reasoning produced `protocol.js`'s explicit event allowlist. `enemyShieldHit` carries
a live entity reference (deliberately — it binds a pooled bubble to a ship), so events cannot be serialized
naively. A test parses the catalogue at the top of `sim-core/events.js` and fails when a new event type has
no wire entry, because the alternative failure is an event that is silently dropped on the way to a client.

## 123. Pause stays real in a netsim room — because a room holds exactly one player

**Context.** §16 rules out a client-side pause once multiplayer lands: a client cannot freeze a shared
world, so the button has to go. Slice D put a real server-run room behind `?netsim`, and the first instinct
was to treat that as the multiplayer case and drop pause.

**Decision.** Pause (and opening the system map) sends `pause` / `resume` to the room, which stops and
restarts its driver. The fight genuinely stops: no spawns, no enemy fire, no cooldowns ticking.

**Why.** §16's objection is about a SHARED world, and a Slice D room holds one player. Nothing is being
frozen out from under anyone. The alternative shipped and was immediately reported as a bug: the overlay
said "Paused" while the fight ran on and the ship kept taking hits — a button that lies is worse than a
button that is absent, and *absent* was also wrong, since a solo player has every right to stop.

**When this must change.** The moment a room can hold more than one player. At that point pause becomes a
local menu that does not stop the world (the plan's original first cut), and the ship stays vulnerable —
which needs its own hands-on evaluation, because it changes what stepping away from the keyboard costs.

**A consequence that is easy to miss.** A paused client sends no input, and the room drops a socket that has
been silent for 30 s. Pausing therefore has to keep talking: the client heartbeats every 5 s while paused,
or a long pause silently ends the session and drops the player back to the local simulation.

## 124. Auto-aim is removed — the player aims, and so does the enemy AI

**Supersedes §89 (per-weapon cone, applies to whoever fires) and §112 (cone tests the hull sphere, picks the
best-aimed target).** Both remain accurate descriptions of the mechanic that existed; the mechanic does not.

**Context.** Bullet weapons carried `aimAssistDeg`, a cone half-angle: a shot fired with an opposing-side
target within ±that of the nose was silently redirected straight at it. It was symmetric — enemy guns
auto-aimed at the player too — and the Kinetic skill widened the player's cone by +0.5°/point. It surfaced
as a problem in a server-run room (`?netsim`), where the assist resolves against the server's *present*
while the screen shows the world ~100 ms in the past, so it corrected toward a position the player was not
being shown.

**Decision.** Remove it: the stat from every weapon, the branch from `fireMount`, `findBulletAimTarget` from
`targeting.js`, and the aim-assist half of the Kinetic skill (with its Character-card text, EN and RU).
A bullet now always leaves along the ship's nose. Rockets are untouched — they keep their homing, which is
a *visible* mechanic the player buys deliberately.

**Why remove rather than lag-compensate.** Lag compensation (the plan's D5) would have made the assist
correct in a room, and it is still the right fix if the mechanic ever comes back. But netsim only exposed
something that was already true: the assist decides where a shot goes using information the shooter does not
have, and the player cannot see it working or not working. "The game quietly aims for you" is a design
choice, not a networking detail — and once it was visible as one, it was not the one we wanted.

**Measured before committing to it,** because two things could have made this expensive and neither did:
- **The shipped intro cutscene still clears.** Changing bullet direction changes the recorded Level-0
  replay: it moved from `tick=2503/3490` to `tick=2474/3490` but still ends 4 kills / `p0..p4` / `won=true`,
  so no re-recording was needed (contrast §112, where a similar change *did* force one).
- **Enemies barely notice.** A parked player circling under fire dies in a mean 8570 ticks with the assist
  and 8551 without — 0.2%. The enemy AI already steers to face the player before firing, so its cone was
  almost never the thing that landed a shot. There is no enemy rebalance to do.

**Left deliberately un-rebalanced:** the Kinetic skill is now damage-only and is straightforwardly worth
less per point. Padding `kineticDmgPct` to hide that would be a balance change smuggled inside a mechanic
removal; if the skill needs to be worth more, that is its own decision with its own playtest.

## 125. A session trace records the SKILL allocation — without it a replay is a different fight

**Context.** Every campaign session is recorded as an input trace (seed + per-tick input) and replayed by
the admin session viewer. The maintainer, watching real player replays, reported that the pilot looked like
it was "fighting ghosts" — shooting where nothing was — and guessed enemy spawning was broken.

**Cause.** Spawning was fine. `makeTrace` recorded `shipId`, `loadout` and `components` but **not
`skills`**, and `buildPlayerFor` forced `skills: null` for any playback override — with a comment claiming
that this "keeps replays deterministic". It does the opposite. Skills change engine power, weapon damage,
shield capacity, and through Maneuver they give the ship a `dodge`, whose roll **draws from the seeded
gameplay stream** on every hostile hit. Measured on the Level-0 trace by re-simulating it headlessly with
different allocations:

| allocation | kills | RNG draws | ends at | hp |
|---|---|---|---|---|
| none (what playback used) | 4 | 38 | −36.7, 22.2 | 100 |
| Maneuver 3 | 3 | **59** | −36.7, 22.2 | **−4 (dies)** |
| Mobility 3 | **1** | 15 | **−164, 356** | 100 |

Maneuver's extra draws shift the stream, so **every later enemy spawn angle and distance changes** — the
replayed enemies are genuinely somewhere else than the ones the recorded player was shooting at. Mobility
makes the ship faster, so identical inputs fly a different path. Either way the replay is fiction, and the
more a player had invested, the more fictional it was.

**Decision.** `skills` is part of the trace (**v4**), the live recorder captures the allocation in force,
and playback — including the admin viewer — rebuilds the ship with it. `TRACE_VERSION` is what tells a
consumer whether a trace can be trusted to reproduce: **v4 and up can; v1–v3 can only be trusted for a
player who had spent nothing** (which is why the shipped Level-0 intro, recorded on a fresh account, was
always fine and its oracle never caught this).

**Why the version bump matters beyond bookkeeping.** Sealing the economy — re-simulating a submitted trace
server-side and deciding the reward from it instead of trusting `POST /api/games` — is only sound on a
trace that reproduces. v4 is the line: below it, a re-simulation would disagree with an honest player and
punish them.

**Not fixed retroactively.** Every trace already in S3 stays unreproducible; nothing can recover an
allocation that was never written down. The admin viewer will keep showing ghosts for old sessions.

## 126. Wire events are scheduled, not played on arrival — and on two clocks, not one

**Context.** A room batches its simulation events into snapshots, 15 times a second, and the client played
each batch the moment it landed. The maintainer, playtesting `?netsim=1`, reported that the machine gun
"sounds doubled on about every third shot in a long burst".

**Cause.** The rhythm the player heard was the SNAPSHOT RATE, not the weapon. `Basic kinetic` reloads in
0.18 s — 10.8 ticks, so the simulation fires every **11** ticks, perfectly even — while snapshots go out
every **4**. Rounding each shot up to the next snapshot walks the error 1→2→3→0, and every fourth shot
arrives a whole snapshot early. Measured by driving a real room with the trigger held:

| gaps between delivered shots | 200 | 133 | 200 | 200 | 200 | 133 | … |
|---|---|---|---|---|---|---|---|

Two shots 133 ms apart after a run of 200 ms gaps is exactly what a flam sounds like. In single-player the
same weapon is a metronome at 183 ms.

**Decision.** Each wire event carries `tk`, the tick it happened on, and the **player's own `fire`** is held
for `budget − (how late it already is)` before it is emitted — so it waits exactly one snapshot interval
from its own tick and the weapon's rhythm survives the transport. Everything else plays on arrival.

**The wider version was tried, shipped, and taken back the same hour.** The first cut also held the room's
events for `INTERP_DELAY_MS`, on the reasoning that enemies are drawn a tenth of a second in the past so
their events belong there too — which also promised to fix sound and FX running ahead of the picture. In
playtest it made **rockets stutter**, for two reasons that the reasoning had missed:

- **Bullets and rockets are drawn in the PRESENT** (dead-reckoned, precisely so their trails do not lag), so
  `smoke`, `bulletImpact` and `detonate` were suddenly 100 ms behind the object they belong to. The trail
  detached from its rocket.
- **A ghost despawns on the ARRIVAL clock**, not the render clock: `applySnapshot` removes an entity the
  moment the room stops listing it, while its farewell FX was being held. The rocket vanished and its blast
  went off a tenth of a second later in the empty space it used to occupy. A killed enemy and its explosion
  are the same shape.

So the rule is narrower than "one event, one clock", and it is the rule to keep:

> **An event ANCHORED to something on screen may not be moved in time.** The client draws different classes
> of thing on different clocks — enemies interpolated, bullets and rockets extrapolated, the local ship
> predicted, despawns immediate — and an event's own budget cannot be right for all of them.

`fire` is the one event with neither a position nor an entity: it is a sound. Re-timing it costs nothing.

**Alternative rejected: raise the snapshot rate.** It shrinks the artifact without removing it — any rate
that does not divide the reload leaves a beat — and it spends bandwidth on the one message that repeats 15
times a second.

**Alternative deferred: predict the player's own fire.** The predictor already runs the real `stepPlayer`,
which fires; keeping its `fire` event instead of discarding it would make your gun answer the keypress with
zero latency and perfect spacing, and would retire the buffer above entirely. That is the sound half of the
local-bullets slice.

**Still open, and now understood.** Sound and FX for the room's own entities do run ahead of the interpolated
picture, and that is real. Fixing it means making the DESPAWN clock agree with the render clock first —
holding a ghost until the moment it is drawn dying — not holding the events on their own.

## 127. One clock: the netsim client interpolates everything, and buys smoothness with latency

**Context.** A day of playtesting `?netsim=1` produced a stream of stutter reports — a doubled gun sound, a
rocket hitching at the muzzle, projectiles jerking, a small enemy's nose stepping as it tracked the player —
and each got its own plausible local fix. The reports kept coming. A full revert settled it: on the original
code the picture stuttered exactly as much, so none of the fixes was the cause and none was the cure.

**Cause.** The client drew on **four clocks at once**: enemies and drops interpolated `INTERP_DELAY_MS` in
the past, bullets dead-reckoned into the present, rockets extrapolated into the present, the local ship
client-side predicted *ahead* of the server, and spawns and despawns applied the instant a packet arrived.
Every artifact lived on a seam between two of them:

| symptom | seam |
|---|---|
| the gun sounded doubled on one shot in four | events played on the packet clock, not the weapon's |
| rocket trails detached, blasts fired after the rocket vanished | events moved to the past clock while their subjects lived in the present (the previous entry, §126) |
| a rocket froze at the muzzle for a snapshot interval | extrapolation with no velocity to extrapolate from |
| projectiles jerked on every packet | extrapolation measured from ARRIVAL times, and packets a room emits 4 ticks apart arrive 50–79 ms apart |
| a small enemy's nose stepped up to 3.5°/frame | linear interpolation of a curve at 15 Hz |

Measured with the `?netjerk` probe over 60 s of fight at the delivery jitter captured from real play:
**7476 discontinuities in the drawn motion, half of them landing on the frame a packet was applied.**

**Decision.** One timeline, made of server ticks. Everything is interpolated at `renderTick − delay`;
nothing is extrapolated; spawns and despawns are events on that same timeline; client-side prediction is
deleted. The snapshot rate doubles to 30 Hz, which halves the curve error and makes the 100 ms buffer three
snapshot intervals instead of one and a half.

Result on the same harness: **6 breaks, none on a packet frame.**

**What it costs, and why that is the right trade *for this game*.** The ship answers the controls about
100 ms later, because it is drawn where the server had it rather than where the client predicts it will be.
The maintainer stated the requirement directly — a smooth picture matters, reaction time does not, and this
is neither a shooter against humans nor a driving sim. Prediction is the machinery you build when the feel
depends on the millisecond; it is not what keeps cheating out. **Server authority does that, and it is
untouched**: the room owns the simulation and the client sends key presses.

**This is the reversible half.** If the ship ever reads as too heavy, the way back is NOT extrapolation but a
second, explicit timeline for the local ship with its own despawn rule — the two-timeline model Unity NetCode
documents (interpolated ghosts despawn on the interpolation tick, predicted ones on the server tick). It
should be re-opened only once the picture is smooth, and never at the same time.

**Where the numbers come from.** Every system that prefers a smooth picture to a fast one converges on this
shape, and three of our numbers were wrong against theirs:

- **Delay ≥ 2 snapshot intervals.** Valve's `cl_interp 0.1` at 20 Hz, reasoned as "even if one snapshot is
  lost, there are always two valid snapshots to interpolate between"; Mirror's `bufferTimeMultiplier = 2`;
  Colyseus's "1–2 server tick intervals". Ours was 1.5. Fiedler's margin for losing two in a row is 3×, which
  is what we now take.
- **No extrapolation on the normal path.** Colyseus's own implementation comment: "On underrun or warmup,
  hold at the newest sample — don't extrapolate. Extrapolation here is what produced the 'flickery' feel."
  Valve extrapolates only as a ≤250 ms emergency. Their teaching lab grades `extrapolate` as "overshoots on
  every turn".
- **Despawn on the render clock is a rule, not a preference.** Unity Netcode for Entities: "the client must
  wait until the `InterpolationTick` is greater or equal the despawning tick"; lightyear shipped the same as
  a fix; nengi does it structurally in both major versions.

**Alternative rejected: adopt a framework** (Colyseus, nengi, Geckos). Our transport, protocol, room and
referee already work and are covered by tests, and none of these libraries would have prevented any of the
artifacts above — they all live in the rendering layer, which the libraries leave to you. What they actually
offer is the doctrine, and the doctrine is what this entry copies. Worth revisiting only if we need
something they solve and we have not built: matchmaking, reconnection, or delta-encoded state.

**Alternative rejected: spline interpolation** (Hermite / Catmull-Rom) for the curve error. It needs velocity
on the wire and no comparable JS library ships it — and, as the correction below establishes, there is no
curve error left to spend it on.

### Correction, 2026-08-21: the snapshot rate was raised for the wrong reason, and is right anyway

The rate went from 15 Hz to 30 Hz to halve the chord-cutting on a curve, measured on a synthetic constant-
curvature path where it plainly did. In a REAL fight it does nothing at all:

| rate | interpolation delay | bandwidth | breaks / 60 s | nose step p95 / max |
|---|---|---|---|---|
| 15 Hz | 100 ms | 25 KB/s | 15 | 2.14° / 2.14° |
| 30 Hz | 100 ms | 40 KB/s | 22 | 1.99° / 2.01° |
| 60 Hz | 100 ms | 70 KB/s | 27 | 2.10° / 2.10° |
| 60 Hz | 50 ms | 70 KB/s | 24 | 2.12° / 2.12° |

**The residual is not the network's, and not the interpolation's — it is the SIMULATION's own.** Measured on
the room's internal state, with no client involved, an enemy's change of turn rate per tick is p50 0.000°,
p95 0.002°, p99 0.021° — and **max 3.64°**. A frame at 100 fps is 0.6 of a tick, and 3.64 × 0.6 = 2.2°,
which is the drawn nose step to two decimal places. The AI occasionally changes how fast it is turning in a
single tick (a manoeuvre ends, a target changes), the client draws that faithfully, and the eye catches it.
**Single-player has exactly the same artifact**, since it runs the same steering — it has simply never been
looked for there. Smoothing it means limiting angular acceleration in `steerToward`, which is a gameplay
change and belongs nowhere near this entry.

So 30 Hz stays, on the other argument, which was always the stronger one and is unaffected: at 15 Hz our
100 ms buffer is **1.5 snapshot intervals**, below the two that Valve, Mirror and Colyseus all give as the
minimum for surviving one lost packet. At 30 Hz it is three. The bandwidth is the price of the buffer, not
of smoothness.

60 Hz remains available and measured: it would allow a 50 ms buffer at the same three intervals, halving the
input lag for 70 KB/s. Held in reserve — the maintainer tried the 100 ms and reported it fine.

## 128. A server-run fight does not stop because one tab looked away (supersedes §123's pause)

**Context.** §123 allowed a real pause in a netsim room, reasoning that a room holds exactly one player so
freezing the world harms nobody — and a button reading "Paused" while the ship keeps taking hits is worse
than no button. Under that rule the room also stopped for the system map and for a hidden tab, the last one
justified as "coming back to a ship that had been shot at by an enemy you could neither see nor answer".

**What it cost.** Every stop is a *"the world is frozen, now resume it"* moment, and that moment is where a
day of freeze reports lived. The one that reached production: complete a level, start the next, switch tabs,
come back — and the game is dead. A hidden tab renders nothing, so the client's keep-alive (sent from the
render loop) stopped, the server declared the peer abandoned, and the fallback to the local simulation
handed the player an emptied arena and a level script waiting for kills that could no longer happen.

The transport-level fix for the keep-alive was necessary and is kept. It is not sufficient, because the
class of bug is the resume, not the socket.

**Decision, on the maintainer's call.** A running simulation is not stopped by what one tab is doing.
`roomIdle` is now exactly "is there a live fight", and nothing else — no pause, no map, no hidden tab.
Three questions, three flags, and they are never merged:

| flag | question | false when |
|---|---|---|
| `roomIdle` | should the ROOM step? | there is no live fight — between runs, in the hangar, after a death |
| `flying` | should this tab send INPUT? | a menu, the system map, or a hidden tab |
| `drawing` | should this tab RENDER? | an explicit pause or the map (never a death — that frame has the most to say) |

**The cost is real and was chosen: leave a fight and you are still in it.** Walk away and you can be shot;
open the menu and the fight continues under it. What the room does *not* do is fly your ship for you — a
client that goes quiet has its controls released after `INPUT_HOLD_TICKS` (30 ticks, half a second), so the
ship coasts to a stop on its own drag instead of running on a held thruster into the arena wall. Repeating
the last input is right for the gap one late packet leaves and wrong for a client that has stopped talking;
half a second is far more than any packet gap and far less than a human pause.

**Alternative considered: end the run when the client goes quiet** (treat leaving as leaving, and return the
player to base). Cleaner than letting an unattended ship be shot to pieces, and it is what networked games
do with disconnects. Rejected for now because it makes "I looked away" a *run-ending* event, which is a
harsher rule than being shot at; revisit if playtest says the current version punishes ordinary distraction.

**This is also the rule multiplayer requires**, so it is the honest version arriving early: §123 permitted
the pause only because a room holds one player, and that premise expires the moment a room holds two.

## 129. A trace is evidence about the build that made it — and the verdict is recorded long before it binds

**Context.** `POST /api/games` is client-authoritative: the browser says what it earned and the server adds
it to the balance. Every campaign run is already recorded as an input trace, and `runTrace()` can re-simulate
one headlessly, so the obvious move is to let the server decide the reward. §125 had already set one limit —
only **v4+** traces carry the skill allocation, so only those reproduce. The question this entry answers is
what happened when that was actually measured instead of assumed.

**Measured, 2026-08-21, on all 74 production sessions: 20% agreement.** Not one of the disagreements was a
cheat.

**The finding §125 did not cover: a trace only reproduces on the BUILD that recorded it.** Removing auto-aim
(§124) changed where a bullet goes; §124 itself measured the shipped Level-0 replay moving from tick 2503 to
2474 on identical input, and judged that harmless because the intro still cleared. On a longer fight it is
not harmless — it compounds. The survey shows the shape exactly:

| runs that agreed | runs that disagreed |
|---|---|
| ≤ 4 kills (7× the Level-0 intro, one 0-kill, one 4-kill) | 12–22 kills |

**Decision.** `game_version` — already stored on every session row and previously ignored — is part of the
admission test. A run recorded by any other build is `build-drift` and is refused, exactly as a pre-v4 trace
is refused. The practical consequence is worth stating plainly rather than discovering later:
**verification only ever works for the currently deployed build**, and every deploy invalidates whatever has
not yet been judged. Judging must therefore be prompt, and any dashboard over it is scoped to a build, not
to a rolling window.

**And the verdict is recorded before it is allowed to bind.** The first cut writes a verdict onto the run
and changes no balance, because the failure mode of getting this wrong is not "a cheat gets through" — it is
"an honest player is robbed", which is the same failure §125 exists to prevent. Enforcement waits on the
observed disagreement rate, and when it comes it will be *bank after the trace* (verify synchronously,
award the computed figure) rather than *correct afterwards*: a game that quietly takes credits back minutes
later is worse than one that can be cheated.

**Two smaller rules that came out of the same work.**
- **The world digest is the wrong oracle for money.** The last kill's reward drop is gated on `ownsReward`
  (`sim-core/step-enemies.js`), which reads account state a trace does not carry, and whose two branches
  consume a different number of RNG draws. A player who already owned the level's reward legitimately
  produces a different hash and an identical reward. The digest stays the right oracle for
  `36-sim-divergence`; the verdict compares credits, XP and kills, and nothing else.
- **A headless referee can never win, so it must be told to finish the job.** Victory needs the docking
  autopilot, engaged by a mouse click, which a trace does not record — `levelRunner.won` is always false in
  Node. Left alone the referee under-counts every winning run by half (`winLevel` doubles the credits). A
  claimed win whose re-simulation reached return-to-base — the arena cleared, the only thing that makes the
  station dockable — has the victory bonus applied by the verifier. A claimed win that never cleared the
  arena is a real disagreement, and the loudest signal the whole mechanism can produce.

**Superseded in DIRECTION, not in findings (2026-08-22).** Re-simulating a submitted trace was abandoned
as the route to a sealed economy the day after this was measured: a server-run room already simulates the
fight and knows every kill as it happens, so it can do the bookkeeping itself — no recording, no
re-simulation, and therefore nothing for build drift to break. Everything measured above stays true and
still governs any trace-based check (the build gate above all). See `docs/plans/seal-the-economy.md`.

**Full write-up, including the netsim recording bug the survey exposed:**
`docs/plans/seal-the-economy.md` §3.1.

## 130. A mission ends TWICE — clearing the sector pays you, reporting back advances you

**Context.** Victory was one moment: the player flew home after the last kill and DOCKED, and only then did
the credits double and the mission's XP bonus land. Two problems came out of that, and they look unrelated
until you notice they are the same problem.

- **The reward depended on a mouse click.** Docking is engaged by clicking the station (`canDock` requires an
  engaged autopilot). A click is not simulation state: it is not in an input trace, and it does not exist at
  all for a headless host. So `levelRunner.won` could never become true in Node, and §129's referee had to
  re-apply `winLevel` itself just to work out what a winning run was worth. A server-run room had the same
  hole from the other side — it simulated the whole fight and still could not conclude the mission.
- **The flight home could take a whole cleared level away from you.** Killed by a stray shot on the way
  back, and the sector you had just cleared paid nothing.

**Decision. Split the moment in two, and put the rule in the simulation.**

1. A level states a **`winCondition`** on its descriptor — today `{ type: 'allEnemiesDead' }` on every
   campaign level and side mission, which is what their phase scripts already encoded implicitly.
2. **CLEARED** — the condition holds. `clearMission()` doubles the credits, adds the one-shot XP bonus, opens
   the way home, and emits `cleared` with the totals. **This is where the reward is decided**, and it is a
   pure consequence of the fight, so the browser, a room and a headless referee all reach it identically.
3. **WON** — the player docked. `winLevel()` closes the mission: the overlay, the sting, the hangar. It earns
   nothing. `lr.won` keeps the meaning all ~20 of its readers already assume.

**What a player feels.** Flying home stops being a stake on the wallet: die on the way back and you keep the
credits, the XP and the loot you had banked. It is not free, though — see below.

**The campaign advance deliberately did NOT move.** `unlockNextLevel()` stays on the dock, and not for
symmetry: it is not a reward, it is "load the next mission into this tab", and it is **unsafe while the ship
is flying**. It calls `buildPlayerFor` — rebuilding the player, including a briefing's weapon swap, as
Level 2's does — and `buildMap` when the next level uses a different one. Running that mid-flight would
change the ship under the pilot on the way home. So the two moments end up meaning different things, and the
difference is legible in play:

> **Clearing the sector pays you. Reporting back advances you.**

Die on the flight home and you keep everything you earned, but you fly the level again.

**What it costs.** `winCondition` changes no behaviour today — every level's last combat phase already
advances on `allCleared`, so the condition holds the instant the win phase is entered. It is a name for the
existing rule and the seam for the next one (survive N, escort X, reach Y). An **unreadable** condition can
never be met: we do not pay out on a rule we cannot evaluate.

**Measured.** The Level-0 trace now replays headlessly to 250 credits instead of 125 — a referee concluding a
mission with no browser and no click, which before this was structurally impossible. `36-sim-divergence`
reports the identical world hash and the identical 38 RNG draws on both hosts, so the simulation itself did
not move; `22-intro-replay` held at `tick=2474`. Nine tests in `sim-core/level-runner.test.js` guard the
split, and the four about payout timing were negative-tested by moving the reward back into `winLevel`.

**This is what replaced trace re-simulation as the route to a sealed economy** (§129, and
`docs/plans/seal-the-economy.md`): the next step is a room banking its own run off the `cleared` event,
with no recording in the loop at all.

## 131. A room banks its own run — the economy is sealed for the fights the server actually ran

**Context.** `POST /api/games` takes the browser's word for what a run earned. §129 measured the obvious
alternative — re-simulate the submitted input trace and compare — and it does not hold up: a trace only
reproduces on the build that recorded it, and under `?netsim=1` the recorder captures a stub anyway. The
maintainer's observation cut through it: **a server-run room already simulated the fight and knows every
kill as it happens.** There is nothing to reconstruct.

**Decision.** A room reports what its own simulation decided, and the server writes it.

- `createRoom({ onEconomy })` — the room calls it once per run, on the simulation's `cleared` (the win
  condition held; credits already doubled, mission XP added — §130) or `death` (whatever was earned before
  it). A `banked` guard makes a duplicate event, a second death or a reconnect unable to pay twice; a
  `restart()` re-arms it because a retry is a new run.
- **The room stays out of the database.** It reports; it does not persist. That is what keeps it clock-free
  and unit-testable with a spy, which is the same discipline that let `room.test.js` require bit-identity
  with the headless referee.
- `makeEconomySink({ playerId, level, bankRun })` in `socket.js` does the writing, and **`playerId` comes
  from the redeemed handshake ticket and is applied LAST**, so no field arriving with the run can substitute
  another account. (Written the other way round first — `{ playerId, ...run }` — where a `playerId` on the
  payload would have overridden it. Caught before it shipped, and the guard is negative-tested.)
- A run that simply STOPS — a disconnect, an abandoned tab — is worth nothing, the same rule single-player
  has always had for closing the browser mid-fight. Crates still in the hold on death are lost.
- The client stops banking a run the room is banking: `G.netDriving` (published each frame by the loop) gates
  `bankRun`/`depositLoot`, and `refreshAfterRoomBank()` re-reads the account instead, so the HUD catches up
  with a balance it did not write.

**What is sealed and what is not — the honest line.** Credits, XP and loot are sealed **for fights a room
ran**, which today means `?netsim=1` only: it is opt-in, so nearly all real play is still browser-hosted and
still banks on trust. Routing everything through rooms was considered and NOT chosen — `server-authoritative-sim.md`
D1's reasons stand (a blip would kill a fight in progress rather than lose an unbanked run; itch is served
worldwide from one VPS; N worlds at 60 Hz beside Postgres; and the browser host is the free divergence oracle
that keeps "one simulation" honest). Campaign PROGRESSION (`/advance`) also stays a client call: it is not
currency, and it must reload the next level into the tab either way (§130).

**Why this and not the trace verifier.** The verifier had to reconstruct a fight the server never watched,
which made it hostage to build drift, to recording gaps, and to a trace format that has already been wrong
twice (§125, §129). A room needs none of that. The verifier survives as a diagnostic — it is what found the
netsim recording bug — but it is off the critical path.

## 132. A mission ends when the player says so — "Finish and Return", not a docking approach

**Context.** §130 moved the REWARD to the moment the win condition holds, and left CLOSING the mission where
it had always been: flying home and completing a docking approach. The maintainer hit the consequence within
a day of it shipping — cleared Level 3, pressed "Return to base", reloaded the tab, and had to fly the whole
level again. The credits had survived; the level had not.

That is the shape of the problem, not a bug in the fix: **a mission you have already won should not be
losable by closing a tab, and finishing it should not depend on completing a flight.**

**Decision.** The last enemy's death clears the sector; the PLAYER ends the mission, with a button.

- Once cleared, the bottom-centre HUD button reads **"Finish and Return"** (it used to read "Return to
  base" and engage an autopilot). Pressing it is the only thing that closes a mission.
- `completeMission(world)` sweeps every crate still on the field into the run, then `winLevel`. It refuses
  unless the sector is actually cleared, so a stray tap can never walk out of a live fight with the credits.
  **(Renamed and re-shaped by §133 the same day: it is `finishMission`, and it engages the autopilot home
  rather than winning on the spot. There is no `completeMission` in the code.)**
- **Docking still ends a mission — it is just no longer the ONLY way.** (Amended the same day: the first cut
  removed the docking route entirely, and the maintainer put it back. It was over-correction — the bug was
  "you MUST fly home", not "you may".) `checkArrival` routes through the same settle-then-close the button
  does (`finishMission` → `winLevel`, see §133),
  so the two cannot drift apart: same sweep, same payout, same close. The station is clickable on a clear
  and the homing arrow still points at it. Roam keeps its own docking (`checkStationArrival`) untouched, and
  proximity alone still never ends anything — `canDock` requires an engaged STATION autopilot.
- Between the two moments the pilot is simply free in a quiet sector: linger, pick over the wreckage, then
  end it. That is what makes the loot sweep a safety net rather than a substitute — **the crate the last
  enemy drops appears at the exact instant the fight ends, and no amount of skill gets a ship to it in
  time.** The `special` reward crate still deposits nothing; its real copy is installed server-side.
- **The button also releases a server-run room** (§131). Once the mission is closed there is nothing left
  for a room to simulate, and leaving it stepping means a room flying a ship nobody is playing. The menu
  reconnects for the next run by itself.
- In a room the press travels as a `{kind:'complete'}` COMMAND, for the same reason click-to-fly does: the
  room owns the world, and a client that ended the mission in a World nobody simulates would end nothing.

**Where the campaign advance went, and why it could move now.** §130 kept `unlockNextLevel()` at the dock
because it rebuilds the player (`buildPlayerFor` — Level 2's briefing swaps a weapon) and the map, which is
not safe while the ship is flying. Ending the mission on a button restores exactly the condition that made
docking safe: `lr.won` freezes the fight first. So the advance rides the button, and the maintainer's
reload-after-clearing bug closes with it.

**The label was measured, not guessed.** The first draft, "Complete mission and return to base", renders
~390 px at 16 px bold — wider than a 360 px phone, and the centring transform would have pushed it off BOTH
edges. "Finish and Return" is 200 px and fits every form factor; the wrap and viewport cap stay anyway,
because a translation is free to be longer than its source and the Russian one already is.

**What this costs.** The flight home stops being *required* — it is now a choice between a button and a
trip, and the denouement between "last kill" and "hangar" is whatever the player wants to do with a quiet
sector. That is the same trade §130 half-made: a mission is worth what it was fought for, not what was
survived on the way back. Since both routes sweep the field, flying home buys atmosphere rather than loot.

## 133. "Finish and Return" flies you home — settling the mission is what survives the trip, not the trip

**Context.** §132 made a cleared mission end on a button press. It ended it *instantly*: the victory overlay
appeared where the ship was standing. The maintainer's note was one line — *"надо не телепортировать на базу,
а включить автопилот туда"* — and it is right. The flight home is the denouement of a mission; deleting it
was never the ask. The ask was that finishing must not **depend** on completing it.

**Decision.** Split what the press does from where the ship ends up. A mission now ends in three moments:

1. **CLEARED** — the last enemy dies. The reward is granted (§130).
2. **FINISHING** — the player presses "Finish and Return" (or docks without pressing). `finishMission`
   sweeps the field's salvage into the run, emits `finishing`, and **engages the autopilot home**. The host
   uses that event to deposit the loot and to **commit the campaign advance server-side**.
3. **WON** — the ship arrives. `checkArrival` → `winLevel`: overlay, sting, hangar, and only now the
   tab-side half of the advance.

**Everything that must survive a reload happens at 2, everything that needs a stationary ship happens at 3.**
That line is the whole design, and it is drawn where it is for a concrete reason: `unlockNextLevel` was one
function doing both, and its second half calls `buildPlayerFor`, which builds a **brand-new player** — a
briefing action can swap a weapon, as Level 2's does — and a fresh player starts at the spawn point. Running
it mid-flight would teleport the ship out from under the autopilot bringing it home. So `net.js` splits into
`commitLevelAdvance()` (a server call, safe at any moment) and `loadAdvancedLevel()` (descriptor, map,
rebuilt ship — at rest only), with `unlockNextLevel()` kept as both back to back for callers that finish
standing still.

**What this preserves from §132.** Press the button and reload the tab mid-flight: the credits were banked at
the clear, the salvage was deposited and the progress was committed at the press. Nothing is lost. That was
the bug — cleared Level 3, pressed return, reloaded, had to fly it again — and it stays fixed while the
flight home comes back.

**A guard the tests found, not the design.** `checkArrival` first called `winLevel` unconditionally after
trying to settle, so a docking approach could have closed an *uncleared* level. In practice unreachable —
`updateLevelRunner` only calls it once the fight is over — but "arriving can win a live mission" is not a
guard to leave to the caller. It now bails when settling is refused, and a test asserts it.

**In a room** the press travels as `{kind:'finish'}` and the ROOM engages its own autopilot, so the flight
home is simulated where everything else is. The salvage swept at step 2 gets its own economy report
(`kind:'salvage'`, no money — the run was paid at `cleared`), because the room's banking already happened
and those crates would otherwise never reach the stash.

## 134. The simulation is three-sided in TARGETING and two-sided in DAMAGE ROUTING

**2026-08-23.** The fight was binary end to end: a bullet either scanned `world.enemies` or struck
`world.player`, a rocket branched on `r.fromPlayer`, and `stepEnemyAI` read `world.player` directly. The
Sentinel wingman (`docs/plans/combat-ally.md`) is a friendly ship that is **not** the player, so something
had to give.

**We made the simulation three-sided where it decides WHO to fight, and left it two-sided where it decides
WHO takes damage.** Concretely: `nearestHostileTarget(world, pos)` hands a hostile ship the nearer of the
player and the allies to steer, aim, fire and home at; a hostile projectile now tests the player **and**
every ally. But a projectile still carries only `fromPlayer`, and its meaning is widened from *"the player
fired it"* to **"the friendly side fired it"**. One extra boolean, `fromAlly`, rides along for the single
rule that needs to tell the two friendlies apart: an ally's kill pays no credits and no XP.

**Why not a general N-team / faction model.** Because friendly fire is off in both directions by design
(§2.6 of the brief), a projectile never needs to know more than "friendly" or "hostile" — a `teamId` on
every entity and a friend-or-foe matrix would be machinery with exactly two values in it. §30 says build the
smallest thing that fully delivers.

**What it buys.** Every branch this adds is one the code does not take when `world.allies` is empty, which
is every level that ships. With no ally, `nearestHostileTarget` returns `world.player` verbatim and a
hostile rocket's `!r.target.alive` is the old `!world.player.alive`, so both expressions are algebraically
identical; the ally step returns on its first line; the digest appends nothing; the enemy reload jitter is
the only `simRandom()` call in `updateGroups` and it is now explicitly `side === 'enemy'`, identical for the
player. The Level-0 intro oracle still logs tick **2474** and `36-sim-divergence` still agrees on hash
`0x2a36f8d9` with **38** draws. The recorded archive is untouched (§73).

**What it costs.** Co-op and PvP will have to generalise it — a second human means friendly fire is a real
question and "the friendly side" stops being one team. That is deliberately deferred to when there is a
second human to ask about, rather than guessed at now.

**Rejected alternative: making a RETREATING ally invisible to enemy target selection.** An earlier draft did
exactly that, so a wingman breaking off to heal could not drag half a wave off screen with him. **Vetoed by
the maintainer at the review gate (2026-08-23):** it is artificial, and the ally must behave as close to a
real player as possible, because this whole feature is a rehearsal for actual multiplayer — nothing makes a
fleeing human stop being a target. If enemies latch onto him and follow him out of the fight, that is
accepted; the minimap shows where everyone is. It also costs him nothing, because he shares the player's
flat speed cap and every Level-4 pirate is slower, so a chased retreat is still a retreat he wins. A test
named for the veto (`step-ally.test.js`) fails if anyone re-adds the exclusion.

**Also settled here, because both fall out of the same shape.** The `fire` EVENT keeps meaning *"your own
shot"* (`fromPlayer: side === 'player'`) while the PROJECTILE means *"the friendly side"*
(`fromPlayer: side !== 'enemy'`) — without the split the client adapter would play the wingman's guns as if
they were yours, and his fire must be silent. ~~And **he cannot die**: `hp` floors at `ALLY_MIN_HP` and there
is no ally death path anywhere, which is what keeps `world.allies` from ever shrinking mid-run and keeps the
digest and the wire simple.~~

**AMENDED 2026-08-23 — he DIES.** The maintainer flew the branch and reversed the no-death rule
(`combat-ally.md` §2.4): an immortal wingman sat at a sliver of hull soaking three boss rockets and would
not leave, which reads as a prop rather than as a pilot. He is now destroyed for the rest of the MISSION and
returns in the next one — `sim-core/step-ally.js stepAllyDeaths`, which runs after the projectile steps for
the same reason `stepEnemyDeaths` does.

*What that cost, since the original entry leaned on the opposite.* `world.allies` **can** now shrink mid-run.
The digest is unaffected in practice: both hosts run the same step in the same tick order, so they remove him
on the same tick, and an empty `allies` still appends nothing. The wire needed nothing new either — absence
IS the despawn there, and the client's `leaving` path already retires a ghost the room stops listing.

*He is worth nothing.* No credits, no XP, no loot roll, and `world.kills` does not move, so a phase's
`advanceWhen: {kills:N}`, `world.enemyTotal`, `isLastKillDrop` and the `cleared` payload all behave exactly
as if he had never been there. His death does not end the mission.

*Why a new `allyDown` event rather than reusing `kill`.* `kill` is built for enemies and carries
`reward`/`xp`/`role`, which the client's adapter reads; borrowing it would mean emitting a reward of zero for
something that is not a kill, and every later reader would have to work out which of the two a given event
was. `allyDown` carries only what the explosion needs. **The FX is the entire announcement** — no banner, no
log line, no new string, because player-facing copy for the wingman is out of scope in this step — but a
friendly ship that vanished in silence would read as a bug.

*And the explosion is required on its own merits, not merely as feedback* (maintainer, 2026-08-23): **this is
preparation for real multiplayer.** In co-op the ship that blows up is another PERSON's, and the destruction
of a ship this client does not own is exactly the event `allyDown` already is — emitted by whoever simulates,
carried on the wire (`EVENT_FIELDS.allyDown`, `protocol.js:60`), and played by the adapter that draws every
other explosion (`sim.js:298`). So it must not be treated as an optional flourish that could be dropped to
keep the ally quiet, and it must not be folded back into `kill` later for tidiness: it is the seam a remote
player's destruction will arrive through. The local player's own death keeps its separate path (the
"Ship Destroyed" overlay), because that one is about ending YOUR run rather than about drawing a wreck.

*The retreat became load-bearing, and it took THREE goes to make it work.* It is now the only thing between
low hull and a dead wingman.

  1. **Sampled once per pass** — `shouldRetreat` needs ≤20 % hull *and* a broken shield, but the shield
     refills all-or-nothing 10 s after breaking, so the condition oscillates on a ~10 s cycle and was being
     read at exactly one tick per pass. Against a boss re-breaking the shield it essentially never held at
     the sampled instant.
  2. **Latched every tick, acted on at the next pass** — fixed the sampling, but still waited for the pass.
  3. **Taken the instant it is true** (the shipped rule, and §2d's *"low health never interrupts a charge"*
     is **RETIRED** with it).

**Why the rule had to go, with the number that settled it.** It was written while the ally could not die,
when interrupting a charge bought nothing — the retreat was purely about finding time to heal. Once he became
mortal, the same words meant "die mid-charge". Level 4's boss mounts 2× weapon 10 (power 10, cooldown 1.0)
and 3× weapon 4 (power 20, cooldown 4): about **35 damage per second**. Against 200 HP the old 20 % threshold
is 40 HP, so **crossing it to dead is about one second**, against a ~6 s pass cycle — the decision landed
inside the fatal window about one time in six, which is exactly what the maintainer kept watching.

**The shipped rule:** break off at **≤25 %** hull with the shield down, evaluated every tick and acted on
immediately; rejoin at **≥40 %**, unchanged. Evaluating per tick rather than hooking the damage router is
behaviourally identical — `shouldRetreat` can only newly become true when damage lands, because the repair
drone only raises hp and `shieldRecharge` only refills — and it needs no second path through the damage
router to keep in step. The `wantsRetreat` latch is deleted rather than left inert: with no gap between
"true" and "acted on" there is nothing to bridge.

**Two things this deliberately does NOT do.** It does not protect him — he still dies if the fire does not
stop, and there is a test asserting exactly that. And it does not make the break-off free: he now turns with
his nose still on the enemy, so he spends the first ~2.7 s coming about while a pursuer closes, and the gap
dips to near contact before it opens. That is the price of leaving at once instead of at the end of the
pass, and it is the better trade.

**The shield clause survives but no longer gates anything.** Damage routes through the shield before the hull
(§76), so at the instant hull damage lands the shield is already down by construction. It is kept because the
maintainer specified "≤25 % with the shield down" and it still states something true — a wingman whose shield
came back up is not taking hull damage — but it can essentially never be the thing that blocks a retreat now.

*Known and accepted:* the player has **no orders** in this cut (§2.3), so they cannot defend him or call him
off — his death will read as bad luck rather than as their mistake. The maintainer chose this knowingly. It
is the argument for orders in a later cut, not a defect.

**AMENDED again 2026-08-23 — two defects the live play found, both in things that looked justified.**

*1. The break-off was measured from the wrong point.* `ALLY_RETREAT_DIST = 70` was a distance from the
**arena centre**, justified as "well outside the 45 u gun range". That was reasoning about the wrong
reference: enemies **spawn at 70..130 from that same centre** (`ship-entity.js`, `70 + simRandom() * 60`), so
the holding point was the inner edge of their spawn ring. Worse, because he charges enemies sitting out
there, his own distance from the centre was normally already **past** 70 when the break-off fired — the
remaining distance went negative, `approachThrust` correctly returned 0 (he has no reverse), and he stopped
dead in the middle of the fight: retreating, holding fire, going nowhere. That is precisely what the
maintainer reported as "the break-off does not work". It is now **threat-relative**: fly directly away from
the nearest enemy, recomputed each tick, until that gap reaches `ALLY_BREAK_OFF_DIST = 120` (past
`GUN_LONG`'s 90 u reach, not merely past the 45 u basic gun), then hold. With no enemy at all there is
nothing to break from and he falls through to the escort. **The lesson is the reference point, not the
number**: a distance is only meaningful relative to the thing it is protecting him from. And the arrival
rule is again judged on the CLOSING speed — the rate the GAP is opening, since the destination moves — which
is the third time that distinction has decided whether a rule in this file works.

*2. His shots did not go where his nose pointed.* Kinetic bullets inherit the shooter's velocity
(`spawn.js makeBullet`; rockets deliberately do **not**, §70), so a ship drifting across its own line of fire
misses even a **stationary** enemy, and only hits while flying straight down its nose. The wingman is the
worst case in the game — his whole manoeuvre is a firing pass with heavy lateral drift. `aimWithDrift`
(`step-ally.js`) now picks the nose so the RESULTING bullet velocity points at the target, and the fire gate
moved with it: judging the shot on the raw nose-vs-bearing would have suppressed his fire for exactly as
long as the correction was working.

**One nose, two ballistics — so every gate is asked PER GROUP, of the path that group's projectile actually
takes.** The nose is optimised for the gun (0.6 s cooldown against the rocket's 5 s), which means the two
weapons on the same hull fly down different lines: a bullet's is `fwd × speed + vel`, a rocket's is the bare
nose (it inherits nothing, §70, and homes afterwards). Both the AIM gate and the §2.6 player-safety gate read
that same per-group path. Getting this half-right is worse than not doing it: gating the rocket on the
*corrected* line lets it launch ~0.5 rad off the true bearing while the gate reports "aligned", and testing
its safety against the *bullet's* line quietly LOOSENS "never a tracer through your hull" for the one weapon
that still flies down the nose. Both mistakes were made and both are now pinned by tests that fail in either
direction.

Unsolvable when the crossing drift exceeds the muzzle speed (65 against his 30 u/s cap — never, for him, and
there is a test on the bound); the fallback aims straight into the drift. The bearing is taken from the hull
CENTRE rather than the muzzle: that is ~3-4° of parallax at 20 u, it is the same parallax the player's and
every enemy's aim already carries, and correcting it exactly would need an iteration because the muzzle's
position depends on the nose being solved for. It corrects the SHOOTER's drift only — **leading a moving
target is a separate problem and is not attempted**.

**ENEMY AIMING HAS THE SAME FLAW AND IS DELIBERATELY LEFT ALONE.** Do not "fix" the asymmetry when you find
it. Correcting enemy aim makes every enemy in the game hit harder, which would raise the difficulty of all
five levels at once and move every recorded replay. That is why `aimWithDrift` lives in `step-ally.js` beside
its one caller rather than in `steering.js`, and why a test named for it asserts an enemy still points its
nose at the player, flaw and all.

**Amended 2026-08-23 — the retrofit is not scheduled, it is CANCELLED.** The maintainer's decision after
playing it: **the enemies that exist today keep the flaw permanently — the intro's above all — and the
Level 5 base pirates get the corrected aim from birth.** That dissolves the problem rather than deferring
it: no campaign-wide rebalance, no recorded replay moves, and the new enemies are tuned against corrected
aim from their first playtest instead of being retuned after it. The practical constraint this puts on the
Level 5 work: whatever carries the correction must be **opt-in per ship or per enemy type**, never a change
to the shared firing path. `22-intro-replay` must still hold at tick 2474.

**Three more follow-ups the maintainer CLOSED rather than scheduled (2026-08-23).** Each looks like an
obvious defect to a fresh reader, which is exactly why each is written down:

- **The escort's standing-start orbit is accepted.** Reversing from rest, the closing-speed rule reads a
  circling ship as "not closing" and keeps thrusting, so he drifts outward (80 u → orbiting 40–95 u over
  ~40 s) instead of settling at `ALLY_ESCORT_DIST`. It happens only while the player is stationary and the
  wingman has nothing to do, and it is bounded. Judged fine in play. **Do not "fix" it** — the maintainer
  will say so if it becomes a problem.
- **Ally-through-ally fire is accepted for now.** §2.6's "never a tracer through a friendly hull" is
  enforced against the PLAYER only; ally-on-ally shots are unchecked. It becomes visible only with more than
  one wingman on the field, and that is when it will be revisited.
- **"Does he steal the fight?" (`combat-ally.md` §3) is CLOSED.** Played on Level 4: he clears a wave
  unaided and cannot take the boss alone, and the balance was judged acceptable — while being tuned for
  **Level 5**, not Level 4. Do not re-open it, and do not ask for the kill-share number again.

## 135. A charged beam has a visible corridor, and that is why it is not the auto-aim §124 deleted

**Date:** 2026-08-25. **Context:** the Charged beam (`docs/plans/2026-08-25-1056-charge-beam-weapon.md`).
At release the beam hits the ship it painted at charge start **if any part of it is still within ±2° of the
nose** — a *corridor*, chosen by the maintainer over both a hard lock and a bare nose-line. Shipped numbers:
power 80, range 100, **charge 1.0 s**, cooldown 0.5 s, weight 12, price 5500, gated at Level 4.

**The tension, stated honestly: a corridor WITHOUT a lock is the deleted aim-assist cone, verbatim.** §124
removed `aimAssistDeg` on purpose, from the player and from enemies, because a cone that silently redirects
a shot means the game is aiming for you. Three things make this not that, and **all three are on screen**:

- **the target is NAMED at charge start**, not chosen at the instant of fire;
- **the reticle shows which one** it is — a diamond, on the ship the shot is committed to;
- **the corridor is DRAWN for the whole 1.0 s**, so the player watches a target leave it.

§124's actual complaint was *"the player cannot see it working or not working."* Here, seeing it work **is**
the mechanic. It is also why the weapon survives PvP, where an invisible lock reads as an aimbot: this one is
visibly escapable, and a fast crosser really does escape — 15.75 u/s drifts the full 15.75 u through the
1.0 s charge and ends **8.95° off the nose at 100 u**, against a ±2° corridor whose effective (hull-aware)
window there is 6.09 u.

**A terminology note, because the shorthand would collapse the argument.** The maintainer calls the corridor
"aim assist", and colloquially that is what it feels like. The recorded rationale stays precise anyway:
**§124 removed a cone that silently REDIRECTED a shot at a target the player never chose. This corridor never
moves the shot** — it is a hit test the player keeps a target inside by TURNING, drawn on screen for the
whole charge. That distinction is the entire reconciliation; do not let "aim assist" erase it.

**The corridor is attached to the NOSE AT RELEASE, not frozen at charge start.** So the three drawn lines
are literally the hit test rather than an illustration of it: they are glued to the hull and rotate with it.
Turning away breaks the shot (~1 rad/s sweeps ~57° in a second); turning toward the target tracks it and
keeps the hit — which makes **turn rate the beam's skill stat**, a thing the Mobility skill already buys. A
frozen corridor would have to either detach from the hull on screen or lie about where the beam will go.

**The charge is 1.0 s, raised from 0.5 s (maintainer, 2026-08-25) so the charge sound and the build-up
animation are clearly heard and seen** — it is a look-and-feel weapon first. The consequence is not
cosmetic: **every target drifts twice as far during the charge**, so ACTIVE tracking with A/D became
mandatory rather than optional. A mere 5 u/s crosser at 20 u drifted 2.5 u at 0.5 s and stayed inside the
~3.30 u effective window; at 1.0 s it drifts 5.0 u and escapes. Anything tuned against the old half second
has to be re-derived, not merely re-timed.

**SUSTAINED DPS IS 53, AND THAT IS THE DESIGN — do not "fix" it.** The cycle is `chargeTime + fireCooldown`
= 1.5 s, so 80 damage is 53 DPS: *below* the 800-credit starter gun (56) and beside Heavy cannon (58 at
2000 cr). Offered both ways to restore 80 DPS — zero cooldown, or damage 120 — the maintainer **declined
both**, and then kept the 5500 price and the Level-4 gate after being told the stat line would read as a
trap purchase next to Heavy MG's. His reasoning, and it answers the objection rather than waving it away:
*"Pure DPS is not that important. It is compensated by the range and by the aim assist."* **Nominal DPS
assumes every shot lands.** A kinetic round has travel time and must be LED, so a large share of it misses a
manoeuvring target; the beam has zero flight time and lands on whatever stayed in the corridor. Its
*effective* damage against a moving target is therefore far closer to a kinetic's than 53-vs-56 suggests,
and it reaches 100 u where the starter gun reaches 88. **Any future rebalance must compare EFFECTIVE
damage-on-target, not the stat line.** The shop tells the truth about the rate, which is the other half of
this being honest rather than a trap: `RoF` is `1 / (chargeTime + fireCooldown)` = **0.7/s**, never
`1 / fireCooldown`, which would claim 2.0/s for a weapon that spends a whole second charging.

**The corridor's WIDTH is this weapon's lag compensation.** §127's shipped 100 ms interpolation delay makes a
top-speed crosser 1.0° stale at 90 u (0.9° at the shipped 100 u reach); the hull-aware window is ~3.3°.
That is why the beam needs no D5 rewind
in a server-run room, and why a hard lock (zero tolerance) would have re-created exactly the problem the
discarded 2026-08-19 spike measured — 14 % of client hit reports rejected at 0 ms, 55 % at 300 ms. The test
being **hull-aware** rather than centre-based is what buys that margin, and it is also a plain correctness
requirement: at ±2° the corridor is *narrower than a ship* inside ~60 u (half-width 0.70 u at 20 u, 1.57 u at
45 u, against a hull ~2 u across), so a centre-based test would paint targets the shot cannot hit — the
reticle would lie, which is the one thing the three lines promise not to do.

**No dodge roll — and the RETRACTION that goes with it.** An earlier draft argued that a beam dodge roll
would break the recorded archive under §73. **That was wrong, and it is retracted here rather than quietly
dropped.** `dodgeRoll` is an injected predicate consulted only AFTER a geometric connect
(`collision.js:208`) and passed only from `step-projectiles.js:58`; no archived trace mounts a beam, so a
beam dodge would have drawn nothing in any recorded fight. §73 does not decide this. The real reason is a
design one: **the corridor IS the dodge.** You escape a beam by flying out of the drawn lines — a skill the
player exercises directly — rather than by a percentage. The weapon stays entirely RNG-free and the drawn
lines never lie: if the corridor showed a hit, you took a hit. **Accepted cost:** a Maneuver-heavy build gets
no statistical protection from a beam.

**THE GATE — no enemy may be armed with a beam until two things are built. MET on 2026-08-25; the rule is
kept verbatim below because a rule that was met still explains why the thing exists.** The weapon shipped
first as a *player* purchase and no ship in the game carried one (maintainer, 2026-08-25: *"Don't waste time
for enemy beam before I asked"*); the **pirate lancer** now does — see "The gate, and what was built to meet
it" below. The simulation is side-agnostic — the whole mechanic sits behind one branch
in `updateGroups`, there is **no `side === 'player'` test anywhere in `sim-core`**, and
`sim-core/beam.test.js` drives the hostile path directly to prove it — so arming a pirate stays a catalog
edit. But:

> **An enemy beam is a 1.0 s unanswerable hit unless its telegraph is on screen. Before any enemy is ever
> armed with one, two things must exist first: (1) the hostile-sight rendering — the three lines drawn from
> a charging hostile hull, in a hostile colour, for the duration of its charge — and (2) the wire entity
> reference on `beamCharge` that lets a client draw a REMOTE shooter's corridor in a room.** An aiming line
> the player never sees is not a warning; it is an unfair attack.

### The gate, and what was built to meet it (2026-08-25)

Writing that gate down is what made taking the deferral safe. It was met the same day, by exactly the two
things it names — and by nothing else:

1. **The hostile sight** — a pooled per-shooter corridor in `client/src/beam-fx.js` (`beamHostileSight*`),
   four entries so several lancers can charge at once, cleared by the four endings a telegraph has (its
   `dur` expires, which is also "the shooter fired"; the shooter dies; a room despawns the ghost, which sets
   `alive = false`; the run ends via `hideBeamFx`).
2. **The wire entity reference** — `beamCharge` now carries the **shooter**. Still two events per shot: no
   per-tick charge fraction, no snapshot column, no digest field.

**The structural trap, recorded because it nearly shipped:** `drawBeamSight` returned early three times
before drawing anything, and the ordinary player carries no beam — so the hostile pass has to run **first
and unconditionally**, or it never runs at all. `client/visual/scenarios/40-enemy-beam.mjs` fails if it is
moved behind those returns.

**The hostile/friendly decision is a RENDERING scope call**, made in `beam-fx.js` by asking whether the
shooter is in `world.enemies`. The event carries `fromPlayer`, not `side`, so an ally handed a beam would
otherwise draw a red corridor on a friendly — and the standing constraint holds: **no `side === 'player'`
test anywhere in `sim-core`**.

**The carrier: a NEW ship, the `pirate lancer` — not a weapon id swapped onto an existing pirate.** A beam
must never share a fire group: `isBeamGroup` uses `some`, so a group holding a beam takes the beam path and
every other mount in it goes silent. Six multi-mount groups exist across four enemy ships (twin guns /
rocket pods on both bosses, the mini boss and the advanced medium), and `equipItem` replaces only the FIRST
mount of a group. The lancer sidesteps all of it by construction — one group, one mount —
and `server/src/catalog_beam.test.js` now asserts that **exactly one** seeded ship carries a beam and names
it. It reuses the pirate gunner's `.glb` and its baked model block verbatim, so no asset changed and
`client/assets/CREDITS.md` is untouched; it is therefore **visually identical to a pirate gunner**, and the
red corridor is the identification — accepted knowingly by the maintainer.

**Its numbers: `power` 45, `maxRange` 67, `chargeTime` 1.0, `fireCooldown` 2.0 (weapon id 13); turn rate
50°/s, via its own thruster row (component 32).** The telegraph length is deliberately not the lever, and a
second weapon row rather than a shared one is exactly what "every behaviour number lives in the weapon row"
was built for. The cycle is **3.0 s → 15 sustained DPS**, which is *below* the pirate machine gun's 16.7 and
above the advanced pirate cannon's 10; **45 is still 2.25× the biggest single hit that exists** (the
20-damage pirate rocket, which is dodgeable *and* shootable-down, while a hitscan is neither). That is the
weapon's shape: **a big, rare, announced hit rather than a stream.**

**THE COOLDOWN AND THE TURN RATE WERE BOTH SET BY FLYING IT, AND THE SEQUENCE IS THE USEFUL PART — so it is
recorded rather than tidied away.**

*What the first pass shipped, and why it was defensible.* `fireCooldown` 0.5 (a 1.5 s cycle, 30 DPS — then
the highest of any enemy) and Scout thrusters giving **2.58 rad/s ≈ 148°/s**. The reachability was measured
from the catalog rather than assumed: `turnRate = thruster.power × REFERENCE_MASS / mass`
(`sim-core/components.js`), mass 31 → 148°/s, against a player's *best* bearing sweep at the AI's 14–22 u
standoff of `PLAYER_MAX_SPEED` 30 / 18 u = 1.67 rad/s ≈ **96°/s**. `steerToward` clamps the nose to the
target every tick rather than overshooting and `ef` is re-derived from the freshly steered heading in the
same tick, so the residual at release was one tick of target motion, ~1.6°, inside the ±2° corridor: **the
corridor held through the charge and the lancer practically never missed.** Shown that measurement, the
maintainer accepted it deliberately for the first pass — *"for now we leave everything as it is, let them
not miss"* — with the turn rate booked as a ROADMAP follow-up. **That was a decision, not an oversight**,
and it is written down here because a reader finding a never-missing enemy in the history should see it was
known.

*What he did after flying it, the same day.* Both levers, at once:
- **`fireCooldown` 0.5 → 2.0** — *"1 second charge, 2 seconds cooldown"*. 30 DPS → **15**.
- **turn rate 148°/s → 50°/s** — *"let's give the lancer a turn rate of 50"*. Implemented as a new thruster
  row (**component 32, `Pirate fighter thruster`, power 0.541**) rather than a new stat, because `turnRate` is
  derived: `0.541 × 50/31 = 0.8726 rad/s = 50.0°/s`. It keeps the Scout thrusters' **weight 3**, so mass
  stays 31 and **acceleration is untouched at 30.6** — he asked to slow the turn, not the ship. This is the
  same per-ship-thruster pattern as `Pirate medium thruster` (25) and `Second-boss thruster` (27).

*What that means now, and it is the opposite of the first pass.* **At 50°/s the lancer can no longer hold
the corridor.** It turns slower than the player's ~96°/s bearing sweep at the standoff and slower than the
player's own ~115°/s, so a player who keeps flying pulls out of the ±2° wedge during the 1.0 s charge:
**the beam is genuinely escapable, which is what the corridor design always assumed.** The counter-play is
now both halves of the design — break the line of fire *or* kill it inside its window — rather than the
telegraph alone. **The ROADMAP follow-up that asked for this is CLOSED by the same change.**

*And a standing correction, still standing.* **Do not write "a moving player escapes most charges" as though
it were true of the FIRST pass:** an early draft of the plan claimed that off a turn rate wrong by ~7×, and
that claim is retracted. It is true of the shipped 50°/s, and it is true *because the number was changed*.

### 50°/s becomes a TIER, not one ship's number (later the same day, 2026-08-25)

Having flown the slowed lancer, the maintainer generalised it: *"everyone except me whose turn rate is
higher — lower it to 50, via pirate thrusters"*, narrowed once he was shown the cost to **"make it 50 for
everyone except those in the intro."**

**Who that turned out to be — two ships, and only ONE of them is in shipped play.**

- **`pirate gunner`** 183°/s → 50 (component 9 → **33**). This is the only shipped enemy affected: it flies
  in **Level 4** and in the **side missions** (`server/src/missions.js`).
- **`advanced rocket pirate`** 148°/s → 50 (component 9 → **32**). **Zero live impact** — it is in no
  level's pool and no mission's, a catalog row kept for a future harder rocketeer wave. It was included so
  the fighter tier is consistent the day it is fielded.
- **Untouched:** the four capitals (already 21–31°/s on mass alone, nothing to lower); the player (115°/s,
  explicitly excluded); and **the intro's two ships**.

**"Levels 0–3 are unchanged" is the accurate summary. "We slowed all the pirates" would be false** — the
basic pirate (218°/s) and basic rocket pirate (170°/s) are most of the early campaign and both stay fast.

**WHY THE INTRO IS EXCLUDED, AND WHY THAT IS THE WHOLE REASON THIS WAS SAFE TO DO HERE.** Level-0 carries
`introTrace` and its pool is exactly those two ships. The Level-0 cutscene and `36-sim-divergence` both
re-simulate that trace, so changing either ship's turn rate would move the **recorded replay archive**
(§73) and demand a re-recorded cutscene. Excluding them keeps both determinism gates bit-identical **by
construction** — verified, not assumed: `22-intro-replay` still prints tick 2474 and `36-sim-divergence`
still hashes `0x2a36f8d9` with 38 draws. `sim-core/beam.test.js` now asserts both intro ships stay fast, so
"finishing the job" fails there first with a readable message rather than as a bare hash mismatch.

**A CONSEQUENCE THAT IS RECORDED, NOT FIXED — and the distinction matters.** Recorded gameplay **SESSIONS**
covering Level 4 or the side missions will now re-simulate into divergence in
`server/tools/verify-sessions.mjs`, because the gunner they contain no longer turns the way it did. That is
expected and already covered by **§129: a trace is evidence about the build that made it.** **This is NOT
the §73 replay archive**, which is intact precisely because the intro ships were excluded. Conflating the
two is how someone later concludes the archive is broken; they are different artifacts with different
guarantees.

**Two rows for three ships, because a thruster hits 50°/s at exactly one MASS.** `power = 0.8727 × mass / 50`,
so component **32 `Pirate fighter thruster`** (0.541) serves mass 31 — the lancer and the advanced rocket
pirate — and **33 `Pirate skirmisher thruster`** (0.4363) serves the mass-25 gunner. A future fighter at any
other mass needs a third row; it cannot reuse these and land on 50. Both are **weight 3**, matching the
`Scout thrusters` they replace, so no carrier's mass moved and **no acceleration changed** — the instruction
was to slow the turn, not the ship. Id 32 was renamed from `Lancer thrusters` because component names are
player-facing (enemy gear is hidden from the shop but still drops as loot and shows its name in the stash),
and a rocket pirate carrying "Lancer thrusters" reads wrong.

**STOP CLAIMING A SUPERLATIVE ABOUT TURN RATE.** It has now been wrong three times in one day: "the slowest
enemy in the game" (false — four capitals are slower), then "the slowest FIGHTER in the game" (true for
about an hour, then a three-way tie). The docs state **the ladder** instead, and `beam.test.js` asserts the
tier and its floor rather than a ranking. Turn rate falls out of mass, so any ranking is one catalog edit
from being false.

**A hostile's engagement range is a SEPARATE number from the weapon's reach**, and the `BEAM` preset is
`ai.range` **50** / `aimTol` **0.12**. `ai.range` gates only the START of a charge and is **not the fighting
distance**: every enemy closes to a 14–22 u standoff via `enemyThrustFactor`, whatever it says. 50 is chosen
against the frame on its BINDING AXIS — **the vertical, ±57 u on the combat plane on every device** (camera
`(0,110,26)`, 55° FOV) — so a lancer that starts a charge is on frame, hull and all. It also sits inside the
weapon's own 67 u reach on purpose, so the lancer closes to fight rather than sniping at its edge. `aimTol`
0.12 (~7°) rather than `GUN`'s 0.25 (~14°) because 14° of slop against a ±2° corridor produces telegraphs
with no shot behind them, which teaches the player to ignore the lines.

> **CORRECTION, 2026-08-25 — the frame this bullet used to reason from does not exist.** It justified a short
> hostile `ai.range` with *"only ±32 u horizontally on a phone in portrait"*. A touch device held in portrait
> renders **LANDSCAPE**: `applyOrientation()` rotates the whole `<body>` 90° in CSS and swaps `gameW`/`gameH`
> (§26), so a modern handset ends up at aspect ~2.16 — roughly **±124 u horizontally, the WIDEST frame in the
> game**, not the narrowest. The binding axis is the **vertical ±57 u**, identical on every device, and every
> conclusion drawn from "keep the enemy on frame" survives against that — more strongly, not less.

**The telegraph is the player's sight reproduced, and that was a choice.** Maintainer, 2026-08-25:
*"Change nothing. As soon as they start shooting at me, I see all the lines."* Same three lines, same dash
rhythms, same 0.22 + 0.38 opacity ramp — differing only in the hue (**`#ff6b4a`**) and in being
**CHARGE-ONLY**, because lines from a hostile hull must always mean "a shot is coming right now". A muzzle
bead, a reticle, a marker on the player's ship, a distinct dash rhythm and a brighter ramp were all proposed
and all declined: smallest thing first (§30), judged in flight. Two consequences worth naming:

- **The hostile charge is SILENT.** "Only your own shots are audible" is unchanged and the beam gets no
  `SOUND_MAP` exception — the gate names the sight and the wire ref, not a sound. (The discharge BOLT is
  drawn whoever fired it, as it always was.)
- **The corridor is drawn to the weapon's FULL `maxRange`, never clipped to the shooter's vicinity.** The
  reason is the reading, not the frame: from a lancer at its 14–22 u standoff, ~45 u of the corridor runs
  *past the player's own ship*, and that far half is the part he actually uses. A sight clipped short would
  hide exactly the half that is the warning.
- **Known deferral, not a third design difference: the hostile dashes do not FLOW.** They show the right
  pattern, held still, because `dashPhase` is advanced inside the player's own pass, which returns early for
  a player with no beam — the usual case. One line moved fixes it, but it retimes the player's own sight
  too, so the maintainer left it for the live-tuning pass. On the ROADMAP beside the turn rate.

**Where it spawns: nowhere yet.** The lancer is behind the `?lancer` dev flag until Level 5 fields it —
editing a shipped level's pool would move `enemyTotal` and break recorded traces. One consequence to pick up
that day: **a looted lancer beam is equippable.** Enemy weapons drop into the stash and the `gun` slot
accepts `beam`, so killing a lancer would hand the player a 45-power beam without paying 5500 or clearing
the Level-4 gate. Unreachable in shipped play today, and a real question the moment Level 5 fields one.

**Also settled, and not to be re-opened:** the trigger is a **tap that COMMITS** (nothing interrupts a
charge — not releasing fire, not damage, not the locked target dying; touch has a fire *button*, an AI's
`wantsFire` flickers, and there is no "charge spoiled" state to invent or put on the wire); the shot is a
**hitscan**, which also dissolves §134's enemy-aim flaw for this weapon *by construction* — a hitscan has no
projectile velocity to inherit — without touching the shared firing path, so §134's cancellation holds; and
**every behaviour number lives in the WEAPON ROW**, never a shared module object, so two ships can carry
differently-tuned beams.

---

## 136. The wire's entity-ref table has ONE home, in `sim-core` — because the client cannot import from `server/`

**Context.** Almost everything a simulation event carries is a copied *value*: the queue is drained at the
end of the tick, by which time a bullet's `pos` has moved on and its entity may be gone. There are exactly
two exceptions, and both are **identity rather than a value** — `enemyShieldHit` binds a pooled shield
bubble to a specific ship, and (from 2026-08-25) `beamCharge` names the SHOOTER, because a corridor has to be
redrawn from that hull's pose every frame for a whole second and a position copied at charge start would be
a lie by the time the shot lands.

An entity cannot cross a socket, so the room swaps each such field for a network id on the way out
(`protocol.js wireEvent` → `shipId`) and a netsim client swaps it back for the ghost that id names
(`netsim-world.js hydrateEvent`). **Two ends, one rule — and they were kept in two places:** the table
`EVENT_ENTITY_REFS` lived in `server/src/netsim/protocol.js`, while the client's rehydration was a single
hardcoded line, `if (ev.enemyId != null) out.enemy = …`.

**Decision.** `EVENT_ENTITY_REFS` moves to **`client/src/sim-core/events.js`**, beside the event catalogue it
annotates, and `protocol.js` imports and re-exports it. Both ends now loop over the same table.

**Why not the obvious alternative — leave the table on the server and add a second hardcoded line on the
client?** Because **no client module may import from `server/`**: the browser is served `client/` alone, so
the dependency can only run the other way. That is not a style preference, it is the deployment. With the
table unreachable from the client, every new reference would have to be remembered twice, in two files, in
opposite directions — and the failure mode is silent. A `shipId` that nothing rehydrates does not throw; it
arrives as a number, `ev.ship` is `undefined`, the adapter's `else if (ev.ship)` never fires, and the
telegraph simply never appears in a room while every local test stays green. That exact mutation was run
against `client/visual/scenarios/41-enemy-beam-netsim.mjs`: **40-enemy-beam still passed, 41 failed** — which
is also why the room scenario exists.

**Why `sim-core` rather than a third shared folder.** `sim-core` is already the host-neutral half: `server/`
imports it (`sim-host.js`, `room.js`), it is `THREE`-free and Node-loadable, `boundary.test.js` enforces
that, and `server/src/netsim/room.test.js` already parses `events.js` to check every event type is wired.
The table is a property of the event catalogue, so it belongs with it.

**Cost.** One more file `server/src/netsim/protocol.js` reaches across into `client/`, which reads oddly the
first time. It is the direction the codebase already runs in, and it is re-exported from `protocol.js` so
that file stays the one place the wire's shape is read from.

## 137. A hit is felt on the RECEIVER — and `toHull > 0`, not `absorbed`, is what "felt" means

**Problem.** Every signal in a firefight belonged to the SHOOTER: a muzzle flash at your barrel, a bolt
leaving it, a spark where the bolt died. **Nothing on the ship you shot changed.** Combat read limp because
the target never acknowledged being hit — you could empty a magazine into a pirate and the only evidence was
a health bar ticking down.

**Decision.** The simulation emits one new describing event, **`hullHit`** (`ship`, `target`, `pos`,
`dirHeading`, `weaponClass`, `toHull`), from the six sites that already call `applyShieldedDamage`, and the
renderer (`client/src/hit-fx.js`) turns it into three things: a **hull flash** on the victim, a **model
punch** from rockets and the heavy cannon, and a **camera shudder** when a rocket reaches the player's hull.
It is the one sim-side addition and it carries no new state — it describes damage that already happened.

**(a) The predicate is `toHull > 0`, not `!absorbed`.** `applyShieldedDamage` returned `{ absorbed, broke }`
and now returns `{ absorbed, broke, toHull }`. The third field exists because **`absorbed: true` does not
mean nothing got through**: a shield that breaks spills the excess to the hull *in the same tick*. A Heavy
rocket (power 80) into the player's Base shield (capacity 20) returns `{ absorbed: true, broke: true,
toHull: 60 }` — the single biggest hit in the game. A naive `if (!absorbed)` would have silently skipped
exactly the moment that most needs to be felt. **One predicate drives both the flash and the shudder**; a
hit a shield absorbs entirely (`toHull === 0`) still gets only the existing cyan bubble ripple, and there is
deliberately no shield-flash knob — it would be a control that could never fire (§30). One consequence is
worth stating so nobody "fixes" it later: a pirate rocket (power 20) into a FULL Base shield (capacity 20)
breaks it with **exactly 0 spilling**, so that hit is silent. The shield is then down for 10 s while rockets
arrive every 4 s, so the *next* one is felt. First rocket strips the shield, second one hurts — that
escalation reads well and is intended.

**Guard for (a), and it has to be end-to-end.** Rewriting the six emit sites to the naive `if (!dr.absorbed)`
leaves the whole client suite, the whole server suite and every other visual scenario **green** — the unit
tests can pin the `{ absorbed, broke, toHull }` contract, but not what the call sites do with it. So
`42-hit-feel.mjs` fires a real pirate rocket (power 20) into a **partial 10-point shield**: the shield
BREAKS, 10 spills to the hull, `absorbed` comes back `true`, and the camera must still shudder. That is the
one test that fails under the regression this section exists to warn about. A `reachedHull` predicate in
`hit-fx-config.js` was tried and **deleted**: nothing in production called it (sim-core must not import a
client render-config module), so it read like coverage of those call sites while guarding nothing — §30.

**(b) Three punch rules are requirements, not tunables.** Per-shot weapon/camera recoil was cut from scope
because it degenerates into constant jitter, and the punch is one bad decision away from the same fate. So:
**instant displacement out with a smooth ease back** (easing out *and* back reads as jelly — `impulse01` is
1 at t=0 and decays with a vanishing slope, so the model settles rather than wobbles); **refresh, never
accumulate** (a new hit resets the impulse, it never sums with one in flight, so a burst cannot compound);
and **a cooldown** (0.15 s), so the Triple spiral rocket's three real warheads punch once instead of
vibrating the hull. These live in the THREE-free `hit-fx-config.js` and are unit-tested, precisely because
they are the difference between "impact" and "noise".

**(c) The punch rides the cosmetic child group, never the ship's transform.** It writes `bankGroup.position`
and `bankGroup.scale` — the same child the wing bank already rolls, which "never affected hits"
(`collision.js`) — and never `ship.pos`, `ship.heading` or `ship.scale`. `ship.scale` in particular is
simulation state: it feeds the hitboxes *and* the muzzle offset, so shoving the model through it would move
where bullets spawn and what they can hit. The shove is stored as a world yaw and rotated into the group's
local frame **every frame**, so a ship that turns mid-punch keeps being shoved the way the shot travelled.

**(d) Per-instance material clones — §79's case-by-case rule became always-on.** Catalog ships load with
`tint: false`, so none of the existing clone paths ran for them: their materials came straight from the
shared template, and setting `emissive` on one enemy would have flashed **every enemy of that type at once**.
`applyShipModel` now clones every material of every instance at attach. §79 already blessed this ("anything
new that wants a per-ship visual state must clone the material for that instance too"); all that changed is
that it moved from case-by-case to always-on. **It costs nothing on the GPU**: a clone carries the same
geometry and the same textures and has identical parameters, so three.js reuses the compiled program — and
nothing disposes any of it, so there is no recompile risk (§83). The known limitation we chose to live with:
where a material has an `emissiveMap`, three.js multiplies emissive by that map, so it glows only where the
map is non-black (measured: 0 of the materials on either enemy hull, 2 of 15 on the player's). Nulling the
map would "fix" it and force a **shader recompile mid-fight**, which is precisely the freeze §83 exists to
prevent; the answer if a hull reads weak is to raise the intensity in the panel.

**Render-only, and the intro proves it.** Nothing here writes entity state or draws from the seeded stream —
all the randomness (the per-shot tracer look, the shudder angle) is the native `Math.random` on the render
side, which §73 keeps out of the simulation. The Level-0 intro re-sim lands on the same tick (2474) with the
same 4 kills and the same win. The recorded pilot now flashes and shudders on screen; that is accepted.

**Every magnitude is a placeholder.** None of these numbers can be guessed from a desk — a shove that reads
as unnatural jitter and one that reads as impact differ by a factor no one can name in advance. So both
punch channels (a directional shove and a scale pop) ship at **0**, a `?dev` "Hit feel" panel exposes all of
them, and whatever the maintainer tunes in a real fight becomes the committed default. Dead UI being worse
than no UI, the panel has exactly the sliders that can do something.

## 138. Two glow systems were built for the "expensive look" — and the one that shipped is REAL LIGHTS

The game reads by light, silhouette and glow, not by polygon count. This pass went after that look three
times: a **full-frame `EffectComposer`** (bloom + ACES), then an **additive glow overlay** on its own render
layer, and finally a **fixed pool of real `THREE.PointLight`s**. The first two were built, live-tested on a
real GPU and a Redmi 15C, and **deleted**. Everything below is the reasoning that survived, including the
measurements — those are the expensive part of this work and they must not vanish with the code.

**What ships (2026-08-31):**

- The frame is the **historical two-pass one**, drawn **straight to the canvas**: `renderer.info.reset()` →
  `clear()` → `render(skyScene, camera)` → `clearDepth()` → `render(scene, camera)`, in `main.js animate()`
  and duplicated verbatim in the `?bench` `fullFrame`. Native canvas MSAA (`WebGLRenderer({ antialias })`),
  **no tone mapping**, no offscreen buffer, no full-screen pass of any kind.
- **Glow is real point lights** (`client/src/engine-lights.js`): a fixed pool on engine nozzles, rockets in
  flight and explosion flashes. Tier knob `post.lights` — High 16 / Balance 4 / Performance 0 — with
  `?lights=N` as an override and a `?tune` "Engine lights" folder (power / decay / distance / height /
  nozzle Z / blast power-reach-duration tiers / a frozen test range).
- The **parallax backdrop layer** stays (see (e) below). The **hull emissive floor** stays wired and ships at
  **0** (see (d)). FX colours are the **authored** ones — every HDR gain above 1.0 is gone (see (c)).

**(a) A composer with MSAA renders BLACK on ANGLE Metal, and routing the frame through one throws away the
MSAA you already had.** Measured on the maintainer's machine (macOS Chrome, ANGLE Metal, Apple M1 Pro, WebGL2,
`MAX_SAMPLES` 4, RGBA16F reporting 4-sample support, **no GL error**), 240-frame controlled runs changing one
variable at a time, reporting the share of the frame that came out black:

| bloomScale | RT samples | frame black |
|---|---|---|
| 0.5 | 0 | 0.0% |
| 1.0 | 0 | 0.0% |
| 0.5 | 4 | **100.0%** |
| 1.0 | 4 | **90–94%** |
| — (bloom pass OFF) | 4 | 0.1% |

It needs **both** the multisampled target and the bloom pass. Moving the MSAA onto the scene pass's own
target and resolving into a plain buffer did not help (93% black); forcing a framebuffer unbind between
passes did not help. So on that hardware a composer cannot have MSAA — and a composer is precisely what
**discards the free canvas MSAA the game already had**. Supersampling was tried as the replacement and
rejected: it buys back at **2.25× the fill** what used to cost nothing. `graphics.test.js` asserts no
`samples` / `superSample` knob comes back.

**(b) ACES over-exposed everything, because the lighting was authored for direct sRGB output.** three's
`ACESFilmicToneMapping` multiplies by `toneMappingExposure / 0.6` — a 1.67× lift at exposure 1.0 before the
curve. The scene's lights (sun 1.68, combat ambient 1.2, plus a PMREM environment) were dialled in over years
against a straight sRGB write, so switching a filmic curve on top blew the base station's white modules into
featureless blobs. **`renderer.toneMapping` is `NoToneMapping` everywhere, including the hangar**
(`model-viewer.js` does nothing either, so the two match by doing the same nothing), and
`43-expensive-look` asserts it. Related and still true if a chain ever returns: three's `OutputPass` reads
`renderer.toneMapping` at *render* time and sets `material.needsUpdate` on a mismatch, so toggling the mode
per frame would recompile a shader **every frame** — own the curve in your own pass or not at all.

**(c) An HDR gain is a property of the thing that maps HDR back to the display. With nothing doing that, a
gain above 1.0 is only clipping.** Pushing a source above 1.0 in linear HDR is what makes it bloom — but only
where a threshold/blur/composite exists to turn that extra light into glow. With the overlay deleted, a >1
colour merely clamps **per channel** at the 8-bit sRGB write: `0xffb050 × 1.5` clips R and G but not B, which
is both a flat white patch **and a hue shift**. So `POST_DEFAULTS.fxGain`, `exhaustGain`, `postGain()`,
`fxColor()`/`hdrColor()` and the plume's `uGain` uniform were **all deleted**, and every FX is back to the
colour its author chose. (The mechanism was right while it lasted: brightness was only ever changed by a
**scalar multiply** on an existing colour, never by a new hex, so no hue ever moved.)

**(d) The hull emissive floor is kept, wired, and set to 0.** Each ship `.glb` template gets a one-time
emissive equal to its own base colour (`ship-factory.js applyHullEmissiveFloor`), so a hull need never go
fully black against the backdrop. At the planned 0.25 it **flattened the hulls and killed their glint** on a
real screen, so it ships at **0** — live but off. It is not deleted, for two reasons: it is the value §137's
hull flash **restores to** (`applyShipModel` clones every material per instance and `flashMats` captures the
baked emissive; the floor is applied to the template FIRST so the captured value IS the floor), and turning it
back on is a one-line experiment. Two placement traps are worth keeping recorded: it must **not** live in
`applyShipModel`'s tint traverse (that block is `if (tint)` and every ship with a real `.glb` loads with
`tint: false` — a silent no-op that passes every test), and a value copied from `color` is **lost wherever
`color` is later re-assigned**, which is why the tint and accent passes re-copy it (`floorMark`/`reFloor`,
keyed on `emissive.equals(color)` — the floor's own signature — rather than on a `userData` tag). Without
that, the wingman's accent-repainted `Wings_` materials would self-light in the *player's* hull hue and wash
the blue out of the only thing that distinguishes the two ships; `38-ally` asserts the wing emissive hue and
the shipped intensity.

**(e) The parallax backdrop layer survived both deletions, because it is geometry, not a screen-space pass.**
A second, coarser nebula bake on an **additive, camera-tracking sphere** in front of the fixed cube
(`world.js buildBackdropLayer`). Three things about it are load-bearing:

- **It is not a skybox, and the guarantee rests on the OPAQUE RENDER LIST — not on `renderOrder`.** three
  splits a scene into two render lists (an object goes to the transparent list iff `material.transparent ===
  true`) and draws **all** opaque objects before **any** transparent one; `renderOrder` only sorts *within* a
  list. Every ecliptic body — star core, planets, moons, the dim star layer — is opaque. A `transparent: true`
  backdrop sphere would therefore be drawn **after** all of them and, being full-screen, additive and
  depth-test-free, would wash nebula over the planet disks and the terminator and slide across them as the
  player flies. Hence `transparent: false`, which lands it in the opaque list where `renderOrder: -3` draws it
  first; additive blending survives that flag (three forces `NoBlending` only for `NormalBlending` +
  `transparent: false`), and `depthTest/depthWrite: false` mean it can never occlude or depth-reject a body.
- **Its own seed and its own noise scale** (`NEBULA2_FALLBACK`). The obvious `{ ...baseNebula, octaves: n-1 }`
  is wrong in a way that passes every test: an fbm truncated to `n-1` octaves is literally the first `n-1`
  terms of the same sum, so the coarse wisps land exactly on the base cube's and the composite is "the
  existing nebula × ~1.35" — the invisible-first-speed-field failure of §96 in new numbers.
- **Parallax accumulated from the camera DELTA and clamped**, never from `|camPos|`: the star system spans
  ~21 000 u and Level 4 fights 11 200–16 800 u out, so an absolute-position formula would drift the sphere's
  centre thousands of units off, the camera would exit it, and the backdrop would simply vanish.

**(f) The backdrop-vs-hull ceiling (D13) is NOT met, was already breached before this feature, and ships as a
REGRESSION FLOOR.** D13 promised "the nebula's peak on-screen luminance stays below the dimmest lit hull
facet", tested as `hullP25 >= 1.5 × bgP99` on a real frame. Implemented in exactly that form in
`43-expensive-look`, it measured **1.30x** on the composer build and measures **1.155x** on the frame that
actually ships (the composer's 1.67× exposure was flattering the hull, not the sky). Attributed on a real
frame by switching each contributor off in turn (whole-sky p99, ship box excluded):

| sky peak (p99) | |
|---|---|
| everything on | **0.4770** |
| this feature's parallax layer at `amp` 0 | 0.4555 |
| …and the bright/dim star layers hidden too | 0.4549 |
| …and the baked nebula cubemap removed | **0.0000** |

The **baked procedural nebula cubemap — shipped 2026-07-04, long before this change — is ~95% of the sky
peak**; the parallax layer is ~4.5% and the stars ~0.1%. Deleting this feature's layer outright would still
fail 1.50x. The two ways to reach the ideal were both rejected by the maintainer: *dimming the baked cube* is
a look change to already-shipped art nobody asked for, and *raising the hulls* is worse — a hull must not
become a standing light source (which is also why the emissive floor ships at 0). **What ships is the same
measurement** — whole-sky `bgP99` against `hullP25` — against a **regression floor just under the observed
value** (1.11x, re-pinned 2026-08-31 from 1.25x when the composer's numbers were retired), plus a
`hullLit >= 120` silhouette count. Mutation-checked on the shipped frame by raising `backdrop.amp` through
its real `?tune` range: 0.25 → 155 lit px pass, 0.60 → 140 pass, 1.00 → 105 **fail**, 1.50 → 29 **fail**. The
sweep also exposed which half does the work: the RATIO is partly self-normalising (`hullLit` is the ship
pixels above `bgP99`, so raising the sky leaves a brighter subset behind), and the COUNT is the sensitive
one. **Lowering a threshold is not the same act as weakening a metric, and only the first has happened
here** — an earlier cut asserted `hullP50 >= 1.5 × ringP95` (the *median* facet against a 130 px *local*
annulus) and passed with 16% headroom on the very frame the honest form rejects.

**(g) Why the glow OVERLAY was deleted too, after it fixed the composer's problems.** The overlay re-rendered
only objects on a glow layer into a small buffer, thresholded and blurred them once H+V, and added the result
over the finished frame — cheap, MSAA-preserving, and with "the dust must not glow" made structural (the
speed field was simply not on the layer) rather than numeric. It still lost, for a reason no tuning could
reach: **the blur is a fixed number of BUFFER TEXELS, i.e. a fixed size on SCREEN, while its sources are sized
in WORLD units.** Zoom out and the ship shrinks but the halo does not — the ship ends up sitting inside its
own glow spot — and the source shrinks toward sub-texel size, where the separable 5-tap kernel (taps at
±1.385 and ±3.231 steps) stops smearing and instead **reproduces the source once per tap**. Because the last
pass is vertical, the leftover comb reads as **vertical stripes like a diffraction grating**, screen-aligned
however the ship is turned. It got *worse* when the emitter was halved to dim it, which is the tell: dimming
by SIZE is what causes it, so brightness and size had to be separate knobs. A real light has none of this by
construction — it is world-space, needs no proxy sprite, no threshold and no blur — so the correct move was to
remove the artifact class, not to keep tuning around it. Related casualties of the same deletion: the plume's
glow-emitter sprite (`lightSample()` survives it, reading the nozzle straight off `uOrigin` through the plume
group's matrix), the `?glow=` URL flag and the `?tune` "Post" folder.

**(h) The light pool is FIXED, built once, and tiered from a measured device result.** three bakes the light
count into every lit material's shader as `#define NUM_POINT_LIGHTS n`, so adding or removing a light
**recompiles every lit material in the scene** — exactly §83's field-observed stall (program count 14 → 33,
one frame at 2082 ms, "I don't even want to play after 5 seconds"). So lights are never created, destroyed or
disposed at runtime: they are parked below the play plane at intensity 0, then moved, re-tinted and faded.
The count is decided before the first material compiles, which is why `?lights=N` needs a reload.
The ladder is measured, not guessed — **Redmi 15C (Mali-G52), 2026-08-31: 0 lights holds ~60 fps; 16 drops,
worst ZOOMED IN at the station and mild once the station is small on screen.** That shape is the whole
finding: three evaluates every point light for every fragment of every lit material (`light.distance` zeroes
the contribution past its radius but the maths still runs — there is no per-object light culling in the
standard material), so **the cost tracks LIT PIXELS**, not light count alone. Hence High 16 / Balance 4 /
Performance **0**, which is also §23's conclusion about weak phones: give them a clean off-path, not a
smaller version of the expensive thing. Blast flashes compete for the same fixed pool rather than adding to
it, and `reach` (the hard `distance` cutoff) — not power — is what makes a big detonation feel big; raising
power alone only pushes already-saturated near surfaces further past white, which is why 8000 and 60000
looked identical.

**(i) Tiering is by pass count / per-fragment cost, never by resolution.** §23 measured on two real GPUs that
a 5.5–7× backbuffer-pixel cut moved fps by *nothing*: weak devices are bound by CPU draw-call submit and the
GPU/compositor governor, not by fragment fill. `renderScale` was removed for that reason and `graphics.test.js`
asserts it stays gone.

**(j) The speed-field dust reads by SIZE, and that is now the only thing it can read by.** Sizes went up ~30%
in this pass (0.8/1.3/2.0 → 1.04/1.69/2.6, in both `speed-field.js` and the `home-system` descriptor). While
a bloom threshold existed it was deliberately set at 0.65, above the dust's 0.6079 linear Rec.601 luma, so
the field could never turn into sparks (§96's settled "dim rocks, not stars"); with no threshold anywhere the
rule is structural instead of numeric, and the `linearLuma601` helper that existed only to police it was
deleted with the rest.

