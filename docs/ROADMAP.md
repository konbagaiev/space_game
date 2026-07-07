# Vega Sentinels — Roadmap

> The **committed** plan: what we've decided to build next and in what order. Uncommitted "what if"
> directions live in `IDEAS.md` and only enter here once deliberately chosen.
> Per-feature build plans live in `docs/plans/*.md`; rationale in `DECISIONS.md`; current state in
> `SUMMARY.md`; history in `CHANGELOG.md`; raw, uncommitted directional ideas in `IDEAS.md`.
> English only (project rule).

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

## Next up — current focus (in order)
1. **`assets:reconcile`** — the asset GC/sync method (see *Assets pipeline* track below): prune unused
   objects on S3 + the server disk, pull the current ones, so stored assets always match the catalog.

> **DONE — Hangar rework** (was the MAIN item): the between-battles hub shipped as the **Main Window** —
> fixed landscape layout, a **25% live hi-poly CDN ship-model preview** with IBL reflections, and the full
> **shop + stash** loop. See Phase 1 below + `docs/SUMMARY.md`. Only **around-model slot icons** remain (a
> later polish). The separate `docs/plans/hangar-rework.md` was never needed — it was built directly off the
> `main-window-redesign.md` / `hangar-shop.md` / `economy-shop-v2.md` briefs.

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
- [ ] **Arena boundary rework** (friend feedback) — soft visible boundary + "left the battlefield"
      warning + 30 s auto-return; optional mini-map (enemies + bounds). **Spec'd →
      `docs/plans/arena-boundaries.md`** (supersedes DECISIONS §2's hard-wall behavior).
- [x] **Basic sound** — **DONE.** Procedural Web Audio (native API, no asset files): synthesized SFX
      (fire/hit/rocket/explosion/UI/jingles) + **generative** background music that follows state (combat
      vs hangar mood) + an **audio settings menu** (⚙ gear → Master/Music/SFX volumes + on/off toggles,
      persisted). See DECISIONS §22 + the Audio track below.
- [ ] Announce / share the link. **Distribution playbook (where/how/what order to post for feedback)
      spec'd → `docs/plans/launch-distribution.md`** (RU communities first, then EN Reddit/Discord,
      Yandex Games later).

## Phase 1 — Progression core (the grind loop)
The post-level-3 goal: grind to upgrade/buy ships. Needs an economy + a place to spend it.
- [x] **Economy** — **DONE** (credits currency + persistent player balance, DECISIONS §11).
- [x] **Hangar → Main Window — DONE.** Reworked from the basic ship-pick screen into the between-battles
      progression hub: a fixed landscape layout (top bar / left menu Missions·Loadout·Stash·Shop / work
      zone), a **25% live hi-poly ship-model preview** via the CDN (`model_url_high`, lazy-loaded) with
      RoomEnvironment/IBL reflections (DECISIONS §14), and briefing item showcases. See `docs/SUMMARY.md`
      (Main Window) + `docs/plans/main-window-redesign.md`.
- [x] **Hangar shop + stash — DONE.** The "spend" side that closes the grind loop: *storage* (stash table,
      qty model), *upgrades* (equip/unequip from stash), and *shop* (buy/sell) — all server-authoritative +
      transactional; sell = 75% of price; a live ship-stats panel with ▲/▼ deltas; Stash/Loadout show the
      resale value, Shop the buy price. **Spec'd → `docs/plans/hangar-shop.md`**; item ladder + pricing:
      **`docs/plans/catalog-economy.md`** (v1) + **`economy-shop-v2.md`** (v2: price ×2, separate
      Stash/Shop screens, two-pane shop). **Remaining polish:** around-model slot icons (not built yet).
- [ ] **Playtest shop balance (Kostya)** — once catalog prices + shop are live: verify the two purchase
      paths feel right, the Heavy hull (weight 50) isn't too sluggish, and grind length is good. **Needs
      the mission generator (Phase 2)** to earn credits for testing. Ref `docs/plans/catalog-economy.md`.
- [x] **Repair-drone component (4th component type)** — **DONE/shipped.** Base: heal 1 HP / 1 s up to
      80% max HP, installed via the level-3 briefing (spec: `docs/plans/repair-drone.md`). Regen knobs
      are data-driven — tune from playtests/feedback.

## Phase 2 — Content engine (repeatable grind)
- [ ] **Mission generator** — procedural missions feeding the economy: clear an asteroid field of
      pirates, hunt the pirate leader, intercept a pirate convoy. **Spec'd → `docs/plans/mission-generator.md`**
      (missions = generated level descriptors reusing `levelRunner`; server-owned rewards; phased 2a MVP
      → 2b more types → 2c scaling). **2a MVP unblocks shop-balance playtesting** (repeatable credits).
      Side-mission enemies/difficulty (new **pirate gunner** + boss buff + 2-boss finale):
      **`docs/plans/mission-enemies-difficulty.md`**.
- [ ] **One giant map, missions at different points** — keep one world (the planet) and place
      **procedural** set-pieces around it (research station, asteroid field + mining station with a
      particle mining beam, drifting transport with a fiery trail); combat plane sits/drifts ~500 m above
      each. **Spec'd → `docs/plans/mission-maps.md`.** Set-pieces code-generated for now (not CDN .glb).
      Not a 2a blocker.

## Phase 3 — Setpiece (story missions L4–L5)
- [ ] **L4 — "Find the pirate base"** — authored campaign level after L3 (clearly harder; difficulty TBD).
      **Implementing it fixes the current "L3 victory text lingers" symptom** — L4's briefing then shows
      after L3 (briefing-on-advance), telling the player to **gear up first** (heavy ships). After L3 the
      **hangar is the hub** (L4 + side missions launch on choice; not auto-replay).
      **Spec'd → `docs/plans/level-4-find-the-pirate-base.md`** (+ Post-L3 flow in `mission-generator.md`);
      **L4 balance/difficulty (Advanced medium pirate, Advanced pirate cannon, Second Boss, waves) →
      `docs/plans/level-4-difficulty.md`**.
- [ ] **L5 — "Storm the pirate base"** — the setpiece assault + a new boss (destroy the base).
      (Generated side missions are separate, don't advance this story counter — see Phase 2.)

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
- **DONE (v1, procedural).** Engine decided: **native Web Audio API** (no dep, project ethos) — not
  Howler. **Source decided: fully procedural** (synthesized SFX + generative music, **no asset files /
  CDN / licensing**), matching the procedural-first ethos. Built: `client/src/audio.js`, autoplay-unlock
  on first gesture, combat↔hangar music with a duck-and-switch transition, and a persisted **audio
  settings menu** (Master/Music/SFX volumes + on/off toggles). See DECISIONS §22.
- **Follow-up (optional, kept open): real music track via the CDN.** The swap is "add a `BufferSource`
  on `musicGain`" — no call-site changes. When a licensed track is chosen: host SFX/music on S3 +
  CloudFront, consider an audio sprite + compressed ogg/mp3, and license every asset in
  `client/assets/CREDITS.md` (freesound / OpenGameArt / commissioned).

### Telemetry & balance
- Funnel events (Phase 0) → drop-off analysis. Keep economy/difficulty numbers data-driven and tune
  from real data.

### Integrity (backlog)
- The sim + credits are client-side; with a real economy on a public site they're tamperable. Add
  server-side validation/sanity-checks on results before the economy carries real weight.

### Assets pipeline
- Source vs runtime split, budgets, optimize step, CDN delivery — DECISIONS §14.
- **Ship-model pipeline** — **no binaries in git**; S3 canonical. Local script builds (gltf-transform
  simplify/optimize) + pushes; **CI pulls combat models from S3 at deploy** (baked into image, served
  same-origin), hangar high-poly on CloudFront; URLs in `catalog_seed.js`; CI drift-check. **`docs/plans/ship-model-pipeline.md`**.
- [ ] **`assets:reconcile` — one method that makes stored assets match the catalog (GC + sync).** Today
      `assets:check` only *verifies* referenced assets exist on S3; nothing *removes* superseded/unused
      ones, and the deploy's `aws s3 sync` + `rsync` run **without `--delete`**, so an asset deleted from
      S3 still **lingers on the prod server's disk** (re-baked into the image each deploy) and old hashes
      pile up on S3. We currently clean this by hand (atomic `aws s3api delete-objects` — and the naive
      `for f in $LIST` loop silently no-ops in zsh). Build a single command that, from the referenced set
      already computed by `assets:check` (`model_url`/`model_url_high` + `SOUNDS` urls in `catalog_seed.js`):
      **(1)** prunes orphaned/superseded objects on **S3** (`ships-combat/`, `ships-hangar/`, `sfx/`),
      **(2)** mirrors the **server/local serve dirs** to the referenced set (drop files no longer
      referenced so they stop being baked in — i.e. give the deploy a scoped `--delete` for
      `client/assets/ships/` + `client/assets/sounds/`, which is safe because those dirs hold only assets
      + in-git primitives, never `.env`), and **(3)** pulls any missing referenced asset from S3. Keep a
      `--dry-run`; never touch `source/` originals; decide whether to keep *current-but-unwired* assets
      (single-version, no ship points at them yet) vs delete them. Folds the manual cleanup + the
      `update-ship-model` skill's delete step into the pipeline. See `docs/plans/ship-model-pipeline.md`.

---

## Open questions
- Repair drone: "mission 3" = existing level 3, or a generated Phase-2 mission?
- ~~Audio: native Web Audio vs Howler.js?~~ **Resolved: native Web Audio, fully procedural (DECISIONS §22).**
- Feedback channel: in-game form (own DB) vs Discord/Telegram webhook vs external link?
- Custom CDN domain (`cdn.vega.tenony.com`) now or later?

## Backlog / parking lot
(Ideas not yet scheduled — add freely.)
- Daily/repeatable missions for retention.
- Leaderboards.
- More ship classes / visual variety.
- Weapon icons / 3D models (for the hangar shop stash + around-model slot icons).
- **Ship-explosion overhaul (visual).** The current death burst (`spawnShipExplosion` in
  `client/src/projectiles.js`) reads as a big single-color blob — fine as a first pass, but not the
  "gorgeous explosion" we want. Wanted: fire that actually *burns* (more natural, layered flame — not one
  flat sphere) and/or *tears the ship into debris chunks* that fly apart, ideally tinted the ship's own
  color (`stats.color`). Debris shards after the blast is the headline ask. Likely needs real particle/
  fragment work (and possibly an animated-fire approach) rather than stacked additive spheres.
- **Hitbox y=0 aim-plane coverage.** Bullets fly in the combat plane (y≈0 = a ship's centre of mass), but
  the OBB hitboxes hug the model's real 3D geometry — so model elements that sit **off** y=0 don't get hit
  by centre-aimed shots. Two known cases: the **player's wings** hang ~0.27 below centre (all wing boxes are
  entirely below y=0 → a y=0 bullet flies over them → the wings read as "transparent"), and the **advanced
  medium pirate** (enemy_3) has a drooped nose below y=0 (a shot registers deep in the body at a fixed spot).
  Not a surface hole or tunneling — a vertical (Y) offset between the aim plane and the box cluster; the
  near-top-down camera flattens Y so it looks wrong. **Accepted for now** (see SUMMARY) — the shot still hits
  the body, and it's a factor in choosing ship models. Proper fix when scheduled: make the fitter guarantee
  the OBB set spans the y=0 plane across the XZ footprint — **extend each box's Y so it crosses y=0** (pull
  off-plane boxes to the plane + a small band for muzzle-Y wobble); data-only regeneration, no runtime
  change, fixes both cases. (Alternative: make bullet collision test the XZ footprint only.) Deferred from the
  OBB hitbox work (2026-07-04).
