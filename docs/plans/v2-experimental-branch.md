# v2 — experimental client sandbox at `vega.tenony.com/v2`

**Status:** **LIVE** — the `/v2` static sandbox is deployed at https://vega.tenony.com/v2 and the
FX-polish work happens on the `v2` git branch. **Owner:** maintainer.

**As built (2026-07-25):** a standalone `nginx:1.27-alpine` container (`docker-compose.v2.yml` +
`deploy/v2/{Dockerfile,nginx.conf}` on the `v2` branch) serves the v2 client; Traefik routes
`Host(vega.tenony.com) && PathPrefix(/v2)` to it at **priority 100** (above the host-only `spacegame`
router) with a `redirectregex` trailing-slash fix + `stripprefix` `/v2`. It joins ONLY the `proxy`
network; the prod `app` container/router are untouched. First bring-up was manual (assets pulled from
S3, rsynced to `/opt/projects/spacegame-v2/`, `docker compose -f docker-compose.v2.yml up -d --build`).
**Still TODO:** the `.github/workflows/v2.yml` auto-deploy on push to `v2` (below) — currently redeploy
is the same manual rsync + compose-up.

## Goal

A live, shareable sandbox to prototype the **FX polish pass** (juicier shots / hits / explosions —
"point 2" of the visuals discussion: flipbook explosions, instanced particles, tier-gated bloom) and
other **look-and-feel** experiments, deployed at `https://vega.tenony.com/v2` so it can be tested on a
real weak device (e.g. a Galaxy A03s) without touching production.

## Hard rule — v2 changes the CLIENT ONLY

**v2 is a client-only branch.** It MUST NOT change anything that writes to or reshapes shared state:

- No `server/` code changes, no new/edited API endpoints.
- No DB schema / migration changes, no `catalog_seed.js` changes.
- No changes to the persisted **sim** contract (progress writes, reward/credit persistence).

Why this is a hard rule: v2 **shares the production Postgres and the production `/api`** (see Topology).
Any server/schema/catalog/persistence change in v2 would hit **real players' data**. The FX work in scope
is **pure render** (particle emitters, materials, post-processing) — it touches no sim RNG and no
persisted state, so it is safe under this rule. Keep it that way. If an experiment ever *needs* a server
or schema change, it does not belong on v2 — promote it to a normal `feature-pipeline` branch first.

## Topology (decisions, locked)

| Question | Choice | Consequence |
|---|---|---|
| Subpath vs subdomain | **Subpath** `vega.tenony.com/v2` | Same origin as prod → shared cookie/session, `/api` needs no CORS. |
| Database | **Shared production Postgres** | Test on your real account/progress. Safe ONLY because v2 is client-only (rule above). |
| Scope | **Client only** | See hard rule. |

Key mechanic that makes "shared prod DB" automatic and free: the v2 client runs in the browser at
`vega.tenony.com/v2/` but its API calls are `fetch('/api/...')` — an **absolute-from-root** path
(`API_BASE = ''`, same-origin; see `client/src/api-base.js`). `/api` has **no `/v2` prefix**, so Traefik
routes it to the **production `app` container**. Only the *static client files* under `/v2` are served by
a separate container. No CORS, no second backend, no second DB.

## Deploy mechanism

Production today (see `docker-compose.yml`, `Dockerfile`, `.github/workflows/ci-cd.yml`):
- One `app` container (Node serves `client/` static + `/api` on port 4000), built from `main`.
- **Traefik** reverse proxy, router rule `Host(vega.tenony.com) || Host(space.bagaiev.com)`, TLS via
  Let's Encrypt. Blue-green rollout via `docker-rollout`.

Add for v2 (do NOT modify the `app` service):

1. **A static container `app-v2`** serving *only* the v2 branch's built `client/` (recommend a tiny
   `nginx:alpine` with the client copied in — no Node, no DB connection; leaner than reusing the full
   `app` image). New service in `docker-compose.yml` (or a dedicated `docker-compose.v2.yml`):
   - Traefik labels: router `Host(vega.tenony.com) && PathPrefix(/v2)`, **higher priority** than the
     `spacegame` router so it wins for `/v2*`; `entrypoints=websecure`; reuse the `letsencrypt`
     certresolver (same host → same cert).
   - A **StripPrefix `/v2`** middleware so the static server sees `/styles.css`, not `/v2/styles.css`
     (the client references assets relatively — `styles.css`, `./src/main.js` — and serves from root).
   - A **trailing-slash redirect** `/v2` → `/v2/` (redirectregex middleware) OR set `<base href="/v2/">`
     in the v2 `index.html`. Without it, `vega.tenony.com/v2` (no slash) resolves relative assets against
     `/` and leaks to the prod app. Pick one; the `<base>` tag is the simplest and container-agnostic.
   - Join the `proxy` (Traefik) network. It does **not** need the `backend` (Postgres) network.

2. **A separate CI workflow** `.github/workflows/v2.yml`, triggered `on: push: branches: [v2]`, that
   builds + rolls out **only** `app-v2` (independent of the `main` prod deploy). Mirror the SSH + rsync +
   `docker rollout` shape of `ci-cd.yml`, but target the `app-v2` service and a separate dir
   (e.g. `/opt/projects/spacegame-v2/`). No migrations, no `/api/health` smoke on v2 (it has no API);
   smoke-check `https://vega.tenony.com/v2/` returns 200 instead.

Rollback: v2 is disposable. To take it down, remove the `app-v2` container / router — prod `app` is
untouched and keeps serving everything (including anyone who bookmarked `/v2` gets a 404, acceptable).

## Guardrails / self-check before deploying v2

- `git diff main..v2 -- server/ docs/DECISIONS.md client/src/api-base.js` should show **no server or API
  changes**; a diff touching `server/`, migrations, or `catalog_seed.js` means the client-only rule was
  broken — stop.
- The FX work stays **replay-safe**: no writes to the sim's seeded RNG (FX read the native RNG / render
  clock only), matching the existing shield-FX and ghost-battle conventions (pure render, no sim/RNG
  writes). This keeps the intro cutscene + `?playback` replays reproducible.
- Perf is validated **on a real weak device** (the A03s), not just locally — the whole point of `/v2`.

## Docs to update when v2 first ships something

- `docs/CHANGELOG.md`: bullet under today's date (infra: v2 sandbox stood up).
- `docs/SUMMARY.md`: only once a v2 experiment is **promoted to prod** (`main`); `/v2` itself is a
  sandbox, not part of the shipped product's "current state".
- `docs/DECISIONS.md`: §72 records the topology trade-off (already added).

## Open items

- Which FX technique first? Recommended order: (1) flipbook sprite-sheet explosion (one draw call,
  highest ROI), (2) single **instanced** particle renderer to collapse per-burst draw calls (our measured
  bottleneck is CPU draw-call submit, DECISIONS §23), (3) tier-gated `UnrealBloomPass` — prototype +
  measure on the A03s before committing.
- Decide the v2 static image: `nginx:alpine` (recommended, leanest) vs reuse the `app` image.
