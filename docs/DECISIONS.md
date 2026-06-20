# Space Ninjas — decisions and notes

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
- **Arena boundaries:** at the wall the velocity along the axis is zeroed (no bounce). Arena ±240.

Knobs: `ACCEL` (acceleration), `TURN` (turning), `IDLE_DRAG` (braking), `ARENA` (size).

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

Live at **https://space.bagaiev.com** (Docker on a shared Hetzner VPS, behind Traefik, on the
shared Postgres). Details in `server/README.md`. Key decisions:

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

---

## Future ideas

sound · solid asteroids with bounce ·
bot behavior (evasion, arc flybys) · custom `.glb` models · multiplayer (WebSocket) ·
engine trails on enemies.
