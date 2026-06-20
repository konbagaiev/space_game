# Rename to "Vega Sentinels" — implementation brief

> Self-contained handoff. Decided in **DECISIONS.md §12**. Rename the game from the working title
> **Space Ninjas** to **Vega Sentinels**, and the player's in-game title from **Ninja** to **Sentinel**.
> English per the project's English-only rule.

## Sequencing
- Do this **before** the auth/email feature (`docs/plans/auth-implementation.md`) — the rename must
  land first so accounts/emails ship under the final name and domain.
- **Phase A (text) is safe and small** — i18n already centralized user-facing strings into
  `client/locales/`, so most of the rename is editing the catalog, not hunting scattered literals.
- **Phase B (infra) is a coordinated production/domain migration** (Traefik host rule, container/image
  names, DNS) — do it deliberately with a deploy; it is NOT a text edit.
- Coordinate with any in-flight work on `client/index.html` / `catalog_seed.js` (avoid a parallel branch
  editing the same lines). i18n has already merged; confirm nothing else is mid-flight there.

## Naming decisions (apply consistently)
- Brand / wordmark: **Space Ninjas → Vega Sentinels**. The brand stays Latin in every locale (incl. RU).
- Player title: **Ninja → Sentinel** (EN); **Ниндзя → Страж** (RU).
- i18n **keys do NOT change** (`ui.title`, `ui.welcome.greeting`, `level.1.victory`, …) — they're
  abstract by design; only the **values** and the `context` notes change.

---

## Phase A — user-facing text + docs (do first)

### Locale catalog (the main work)
`client/locales/source.json` (English source + context):
- `ui.title` → `"Vega Sentinels"` (context already says "may stay English in any locale" — fine)
- `ui.welcome.greeting` → `"Welcome, Sentinel"`; update context: `'Sentinel' is the player's title`
- `level.1.victory` → `"Level 1 cleared! Nice flying, Sentinel."`; context: `'Sentinel' is the player's title`
- `level.3.victory` → `"Sector cleared. Congratulations, Sentinel!"`; context likewise

`client/locales/ru.json` (Russian values):
- `ui.title` → `"Vega Sentinels"` (brand stays Latin)
- `ui.welcome.greeting` → `"Привет, Страж"`
- `level.1.victory` → `"Уровень 1 пройден! Отличный полёт, Страж."`
- `level.3.victory` → `"Сектор зачищен. Поздравляем, Страж!"`

### Client fallbacks (must match the source values)
`client/index.html`:
- `<title>Space Ninjas</title>` → `<title>Vega Sentinels</title>`
- `<h1 data-i18n="ui.welcome.greeting">Welcome, Ninja</h1>` → `Welcome, Sentinel`
- `<div id="gametitle" data-i18n="ui.title">Space Ninjas</div>` → `Vega Sentinels`

### Server
`server/src/catalog_seed.js` — the `text:` **fallback** fields (the `textKey` stays):
- `'Level 1 cleared! Nice flying, Ninja.'` → `'... Nice flying, Sentinel.'`
- `'Sector cleared. Congratulations, Space Ninja!'` → `'... Congratulations, Sentinel!'`
  (Re-seed is idempotent on startup, so this propagates.)

`server/src/server.test.js` — the served-client assertion:
- `/<canvas|<script type="module"|Space Ninjas/i` → `…|Vega Sentinels/i`

### Docs
- `README.md` — `# Space Ninjas` → `# Vega Sentinels` (and any body mentions).
- `docs/SUMMARY.md` — the name line and the "Welcome, Ninja" quote; bump `**Updated:**`.
- `docs/DECISIONS.md` — the H1 `# Space Ninjas — decisions and notes` → `# Vega Sentinels — …`.
- `docs/plans/*.md` — the "(Space Ninjas)" / "— Space Ninjas" in brief titles (cosmetic).
- `docs/CHANGELOG.md` — **do NOT edit history.** The "Named the game Space Ninjas" / "Welcome, Ninja"
  entries are historical facts. Add a **new** dated entry: *"Renamed the game to Vega Sentinels; player
  title Ninja→Sentinel (Ниндзя→Страж)."*

### Phase A acceptance
- `grep -rniI 'ninja\|ниндзя' --exclude-dir=node_modules --exclude-dir=.git .` returns **only**
  historical `docs/CHANGELOG.md` entries and example snippets in `docs/plans/i18n-implementation.md`.
- No "Space Ninjas" remains in user-facing UI, code, or current-state docs (history excepted).
- Client + server test suites pass (the served-client test now matches "Vega Sentinels").

---

## Phase B — infra / domain migration (separate, coordinated with a deploy)

This touches the **live deployment** identifiers and domain. Plan it with the domain move; expect a
controlled deploy, not a text commit.

- **Domain / Traefik (production):** add a router rule for **`Host(\`vega.tenony.com\`)`** with the
  `letsencrypt` certresolver in `docker-compose.yml`, get the cert, cut over. Keep `space.bagaiev.com`
  during transition (optionally 301 → new host), then retire it. **DNS:** point `vega.tenony.com` at the
  server IP (`178.104.91.144`) in the `tenony.com` zone. (`docker-compose.yml` labels:
  `traefik.http.routers.spacegame.rule=Host(\`space.bagaiev.com\`)` → new host.)
- **Container / image / router names** (`spacegame`): in `docker-compose.yml` (`image: spacegame`,
  router/service label key `spacegame`), `rollback.sh` (`docker images spacegame …`, tags), and
  `.github/workflows/ci-cd.yml` (`docker tag spacegame:latest …`, image prune). Renaming the image/router
  is optional cosmetic churn — if done, update all three together so rollback/CI stay consistent.
- **Deploy path** `/opt/projects/spacegame/` (in `ci-cd.yml` rsync target + `cd`, and `server/README.md`):
  renaming the server dir means moving it on the host during a deploy — coordinate, don't just edit text.
- **Postgres role/db `spacegame`** (`DATABASE_URL`): **leave as-is** unless there's a strong reason —
  renaming a live DB role/database is risky and user-invisible. If migrated, do it as its own DB task.
- **Docs describing infra** (`docs/SUMMARY.md`, `docs/DECISIONS.md §9`, `server/README.md`,
  `docs/CHANGELOG.md`): update to match whatever Phase B actually changes — only after the deploy lands.

### Phase B note
Anything that renames live resources (host, container, dir, role) is a deployment migration with
rollback implications — do it on its own, verify `/api/health` through the cutover (blue-green, per
DECISIONS §9), and update docs to the new reality afterward.
