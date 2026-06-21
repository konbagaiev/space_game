# Vega Sentinels — Roadmap

> The end-to-end scope and the order we build it. A living doc: capture ideas here so they're not lost.
> Per-feature build plans live in `docs/plans/*.md`; rationale in `DECISIONS.md`; current state in
> `SUMMARY.md`; history in `CHANGELOG.md`. English only (project rule).

## Vision
A space combat game in the lineage of Space Rangers / Elite / EVE: pilot a nimble ship, grind
missions to earn credits, upgrade or buy ships in a hangar, and push back escalating enemy factions.

## Post-launch north star — the ~50-sortie campaign
After the feedback launch, the main content goal is an **addictive ~50-sortie campaign that blends grind
and storytelling**: generated grind missions interleaved with story beats, briefings, and setpiece
bosses, so progression *and* narrative pull the player forward. This is the through-line that Phases 1–3
serve (economy/hangar → mission generator → setpieces) — they're the systems; the campaign is the
content that strings ~50 sorties into a story worth finishing. Storytelling reuses the existing
data-driven briefing system (DECISIONS §13).

## Live now
Deployed at **https://vega.tenony.com** (Hetzner VPS, Docker/Traefik, Postgres). Has: 3 data-driven
levels with a boss, multi-weapon ships, anonymous + email/password accounts (SES verification ready),
EN/RU localization, between-level briefings. Asset CDN provisioned (S3 + CloudFront).

## Guiding principles
- **Ship for feedback early.** The build is already playable/live — don't gate feedback behind the full
  roadmap. Launch a minimal v0, then iterate on what real players tell us.
- **Data-driven.** New content/mechanics = data first (DB/seed/JSON), code reads it — so balance is
  tunable without a release.
- **English is the source of truth** (locales layer on top, see DECISIONS §10).

---

## Phase 0 — Launch v0 for feedback (NOW, days not weeks)
The goal of launching is *feedback*, so the missing pieces are the ones that capture it:
- [ ] **Feedback channel** — in-game link to the Telegram community (locale-dependent EN/RU group via
      i18n). **Spec'd → `docs/plans/feedback-link.md`.** *Without this, launching yields nothing.*
- [x] **Light funnel telemetry (DB events)** — **DONE** (`events` table, migration 010, `POST /api/events`,
      client `track()`; `quit` via sendBeacon).
- [x] **Monitoring** — **Sentry built** (server `@sentry/node` + browser via `/api/config` DSN; errors
      only). ⚠️ **To go live in prod: set `SENTRY_DSN_SERVER` + `SENTRY_DSN_WEB` in the server `.env`**
      (no-ops until set). **UptimeRobot** owned by Kostya (separate). Grafana deferred.
- [ ] **First-time onboarding check** — make sure a stranger understands controls (esp. mobile/touch)
      in the first minute.
- [ ] **Basic sound** (optional but high-impact polish) — shot, explosion, one combat track + one
      hangar track, mute toggle. See the Audio track below.
- [ ] Announce / share the link.

## Phase 1 — Progression core (the grind loop)
The post-level-3 goal: grind to upgrade/buy ships. Needs an economy + a place to spend it.
- [x] **Economy** — **DONE** (credits currency + persistent player balance, DECISIONS §11).
- [~] **Hangar** — **basic screen shipped** (ship-pick + victory "Continue"). Still TODO: detailed
      hi-poly model via the CDN (`model_url_high`, lazy load) + PBR/IBL scene (DECISIONS §14).
- [ ] **Hangar shop + stash** — consolidates *storage* (stash table), *upgrades* (equip/unequip from
      stash), and *shop* (buy/sell). Server-authoritative; sell = 75% of price; prices seeded 0 first.
      **Spec'd → `docs/plans/hangar-shop.md`** (phased: data+server → stash UI → shop + around-model
      slot icons). This is the "spend" side that closes the grind loop. Item ladder + pricing draft:
      **`docs/plans/catalog-economy.md`** (tuned in parallel while the shop mechanic is built).
- [x] **Repair-drone component (4th component type)** — **DONE/shipped.** Base: heal 1 HP / 3 s up to
      80% max HP, installed via the level-3 briefing (spec: `docs/plans/repair-drone.md`). Regen knobs
      are data-driven — tune from playtests/feedback.

## Phase 2 — Content engine (repeatable grind)
- [ ] **Mission generator** — procedural missions feeding the economy: clear an asteroid field of
      pirates, hunt the pirate leader, intercept a pirate convoy. Needs variety params + anti-repetition
      + reward scaling so grind doesn't feel samey.

## Phase 3 — Setpiece
- [ ] **Pirate base assault** — a harder mission with a new boss (destroy the pirate base).

## Phase 4 — New factions (post-feedback content expansion)
- [ ] Next enemies: automatons / aliens.
- [ ] Corporate-war faction conflict.
(Deliberately after we have real feedback — don't build this blind.)

## Phase 5 — Multiplayer (FAR future, not soon)
- [ ] **Co-op first** — players fly missions together.
- [ ] **PvP later** — *maybe* (uncertain, decide based on demand).
- **Anti-cheat = server authority, not an engine feature.** Cheat resistance comes from running the
  authoritative simulation on the server (clients send inputs, render only) — achievable in *either*
  stack. Switching engines does not by itself stop cheating.
- **Planned first attempt: extract the simulation into Node.js (server-authoritative), keep the browser
  client.** When we commit to multiplayer, the first move is to move the game sim to the Node backend
  and have clients send inputs / receive state over WebSocket — no engine switch up front. We already
  have a head start: the pure logic is extracted into `client/src/*.js` (`components.js`, `steering.js`),
  which is groundwork for a shared/server simulation. This path keeps the "open in browser, no install"
  advantage and is well-suited to **co-op (PvE)**.
- **Godot only if/when fast competitive PvP needs it.** The browser's transport ceiling is WebSocket
  (TCP) / WebRTC; real-time PvP wants UDP/ENet, which only a native (downloaded) client gives — that's
  the real reason to reconsider Godot (DECISIONS §1), at the cost of the frictionless browser client.
  So the engine decision tracks **co-op vs competitive PvP**, not anti-cheat. A major re-platforming
  decision, not a feature bolt-on. Sequenced **after** the ~50-sortie campaign.

### Netcode notes (parked — far future, from design discussion)
- **Prereq work, not perf:** the bottleneck to *getting* server-authoritative MP is decoupling the sim
  from Three.js (own vectors/structs, no `mesh.position`) + a **fixed-step loop** (~30 Hz via
  accumulator, separate from rendering, deterministic). CPU for one 5v5 @30 Hz is trivial.
- **Don't stream bullets.** Replicating every bullet 30×/s (esp. machine-gun fire, in JSON) is the real
  bandwidth/GC hog. Instead send **fire events**; clients simulate the deterministic flight locally.
- **Hits: server-authoritative, same bandwidth.** The *server* also simulates the same deterministic
  bullets and **decides hits itself** (clients send inputs/fire+aim, not "I hit X"). Client may predict
  the hit for feel; the server verdict wins. Hitscan → lag-compensated rewind to the shooter's view-time.
  Avoid client-reported hits + mere position-plausibility checks (aimbot/fabricated-hit hole).
- **Co-op can be simpler:** client-side hit handling is fine for PvE (cheating barely matters). Server-
  authoritative hits + lag-comp are only mandatory for **PvP**.
- **Transport:** co-op ~15–20 Hz over WebSocket + interpolation is fine. Fast PvP wants ~30–60 Hz and
  UDP/ENet (native client, or WebRTC data channels in-browser) — TCP/WebSocket head-of-line blocking is
  the limiter. Also: server-side fire-rate cap, client prediction + reconciliation.
- Binary encoding + quantized floats + deltas when state *is* sent (ships), to cut size/serialization.

---

## Cross-cutting tracks (slot in across phases)

### Audio
- Engine: native **Web Audio API** (no dep, project ethos) vs **Howler.js** (tiny lib, handles
  autoplay-unlock + cross-browser). **Open decision.**
- Autoplay policy: start audio only on the first user gesture (click/tap).
- Combat vs hangar music with crossfade on scene change; **mute/volume** persisted (localStorage /
  player settings).
- SFX as short files (consider an audio sprite); music as loops; compressed ogg/mp3.
- **Host SFX/music on the CDN** (S3 + CloudFront — good fit, audio is heavyish).
- License every asset in `client/assets/CREDITS.md` (freesound / OpenGameArt / commissioned).

### Telemetry & balance
- Funnel events (Phase 0) → drop-off analysis. Keep economy/difficulty numbers data-driven and tune
  from real data.

### Integrity (backlog)
- The sim + credits are client-side; with a real economy on a public site they're tamperable. Add
  server-side validation/sanity-checks on results before the economy carries real weight.

### Assets pipeline
- Source vs runtime split, budgets, optimize step, CDN delivery — DECISIONS §14.

---

## Open questions
- Repair drone: "mission 3" = existing level 3, or a generated Phase-2 mission?
- Audio: native Web Audio vs Howler.js?
- Feedback channel: in-game form (own DB) vs Discord/Telegram webhook vs external link?
- Custom CDN domain (`cdn.vega.tenony.com`) now or later?

## Backlog / parking lot
(Ideas not yet scheduled — add freely.)
- Daily/repeatable missions for retention.
- Leaderboards.
- More ship classes / visual variety.
- Weapon icons / 3D models (for the hangar shop stash + around-model slot icons).
