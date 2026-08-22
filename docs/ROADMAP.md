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

## Phase 4.5 — An ALLY who fights with you (before multiplayer, deliberately)

Requested 2026-08-21. A friendly ship that flies with the player and helps in combat, **with logic of its
own rather than an enemy bot pointed the other way**. Brief: `docs/plans/combat-ally.md`.

Two reasons it comes before Phase 5 rather than after:

- **It is the dress rehearsal.** A second combatant in a room that is not the player exercises almost
  everything co-op needs — a ship on the wire that the client does not own, per-ship targeting decided
  server-side, a room holding more than one fighter, friendly fire, and shared loot — while the hard parts
  of multiplayer (matchmaking, reconnect, two humans' input, draining sockets on deploy) stay out of it. If
  the ally reads well, co-op is mostly plumbing. If it does not, co-op would not have saved it.
- **It is worth having on its own**, single-player, with no netcode attached.

- [ ] Ally logic distinct from `stepEnemyAI` — see the brief for what "distinct" has to mean
- [ ] Design decisions the maintainer still owns (origin, command, death, loot — listed in the brief)

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
- ~~**Client-side head start — the "ghost battle" is already a remote-entity renderer.**~~ **SUPERSEDED
  (2026-08-20).** The plan was to generalize `ghost-battle.js`'s transform-lerp into the MP remote-entity
  renderer, on the reasoning that a real second world was impossible because `sim.js update()` mutated ~20
  module-level singletons with no world context. **That reasoning no longer holds** — the World context
  exists (`sim-core/world.js`), so netsim did the better thing instead: the client keeps its OWN World and
  lets the network write it, so remote entities arrive through the same `world.host.onSpawn` local spawns
  use and get the same meshes, HUD, health bars and FX for free (DECISIONS §121). There is no second
  renderer to build and none was built. Interpolation lives in `netsim-world.js`.
  **The backdrop ghost battle stays exactly as-is** and is now unrelated to multiplayer — it is decor with a
  committed track, and merging the two would buy nothing.
- **Godot only if/when fast competitive PvP needs it.** The browser's transport ceiling is WebSocket
  (TCP) / WebRTC; real-time PvP wants UDP/ENet, which only a native (downloaded) client gives — that's
  the real reason to reconsider Godot (DECISIONS §1), at the cost of the frictionless browser client.
  So the engine decision tracks **co-op vs competitive PvP**, not anti-cheat. A major re-platforming
  decision, not a feature bolt-on. Sequenced **after** the ~50-sortie campaign.

### Server-authoritative sim — ✅ SHIPPED (merged, deployed, on itch; 2026-08-21/22)

Phase 5's first move landed far ahead of schedule. The rules live in `client/src/sim-core/` and run
unchanged in the browser and in Node; a headless referee replays input traces server-side; and
**`?netsim=1` plays a level in a real server-run room over a WebSocket**, live on `vega.tenony.com` and on
itch. See `docs/plans/server-authoritative-sim.md` (§0 is a self-contained pick-up brief).

- [x] **The room banks its own run — the economy is sealed for fights the server ran** (2026-08-22,
  DECISIONS §131, `docs/plans/seal-the-economy.md`). A room reports what its own simulation decided and the
  server writes it under the playerId from the handshake ticket; the tab no longer banks a run the room is
  banking. **Scope, stated honestly: netsim is opt-in, so nearly all real play is still browser-hosted and
  still banks on trust.** That is the *Integrity* backlog item below, and it is now half-closed rather than
  open. The route not taken — re-simulating the client's uploaded input trace — was measured against
  production and abandoned: a trace reproduces only on the BUILD that recorded it (§129).
- [x] **A mission can be concluded by a host without a mouse** (§130, §132, §133). Victory used to require
  a docking CLICK, so a room could simulate an entire fight and still not finish it. A level now states a
  `winCondition`, the reward lands when it holds, and the player ends the mission with "Finish and Return".
  This was a prerequisite for the room owning the economy, not a cosmetic change.

- [x] **AIM ASSIST — flagged from the first full playthrough, then REMOVED (2026-08-20).** The auto-aim cone
  was the one mechanic that depended on *where the player saw the enemy*, so in a room it corrected toward a
  position the screen was not showing. Rather than lag-compensate it (the plan's D5), the mechanic was
  deleted for player and enemies alike — it decided where a shot went from information the shooter does not
  have, and the player could not see it working. DECISIONS §124. Measured first: the shipped intro cutscene
  still clears (oracle moved 2503 → 2474 ticks, no re-recording), and enemies lose ~0.2% lethality because
  their AI already aims itself. **D5 (lag compensation) is no longer needed for this**; it comes back into
  scope only if auto-aim, or any other see-what-the-client-saw mechanic, returns.

### Netcode notes — status against the 2026-08-20 branch

The original design discussion is preserved below with its verdict. Several items are simply done.

- [x] **Prereq work, not perf:** decouple the sim from Three.js + a deterministic fixed-step loop. **Done** —
  `sim-core/`, `TICK_HZ = 60` in `sim-core/consts.js` (60, not 30: both hosts must agree or the same input
  produces different outcomes, DECISIONS §118).
- [x] **Hits are server-authoritative.** **Done** in a room — the server simulates everything and the client
  reports nothing. It also removes the "aimbot / fabricated hit" hole by construction.
- [x] **Transport: co-op ~15–20 Hz over WebSocket + interpolation.** **Done** — 15 Hz snapshots, ~100 ms
  interpolation buffer.
- [x] **Server-side fire-rate cap.** **Done implicitly** — the room owns the fire-group cooldowns; a client
  can only hold a key down.
- [ ] **Don't stream bullets — send fire events instead, and let clients fly them deterministically.**
  **NOT done, deliberately deferred.** The room streams bullet transforms today, which is the simple thing
  and is fine for one player. It is the first real bandwidth item when a room holds several, and it pairs
  naturally with prediction (a client that can simulate its own bullets is most of the way to Slice E).
- [ ] **Client prediction + reconciliation.** Slice E in the plan. Not urgent by playtest evidence — the
  ~100 ms input delay drew no complaint across three levels — but it is what makes the netsim path feel
  equal to local.
- [ ] **Binary encoding + quantized floats + deltas.** Untouched; JSON snapshots are ~2–5 KB and nowhere
  near a problem at this scale.
- **Co-op can be simpler:** client-side hit handling is fine for PvE (cheating barely matters). Server-
  authoritative hits + lag-comp are only mandatory for **PvP** — and we got the strict version anyway,
  because it fell out of running the whole sim server-side.
- **Fast PvP** still wants ~30–60 Hz and UDP/ENet (native client, or WebRTC data channels) — TCP/WebSocket
  head-of-line blocking is the limiter. Unchanged; it is the Godot decision above.

### Still open for multiplayer proper (none of it started)

- [ ] **More than one player in a room.** Everything so far is one player: no join/leave, no per-player
  input routing, no interest management. This is the actual co-op work.
- [ ] **Rooms, matchmaking, invites** — no UI, no lifecycle beyond "one socket, one room".
- [ ] **Reconnect.** A dropped socket ends the room today.
- [ ] **Socket draining across the blue-green deploy swap** — a deploy currently kills live rooms.
- [ ] **Shared roam and side missions over the network** — side missions are refused in a room at all,
  since their descriptors are generated per player and no room can resolve one by name.
- [ ] **Pause must change when a room holds two people** (DECISIONS §123) — today it really freezes the
  room, which is only legitimate while there is exactly one player in it.
- [ ] **Netsim runs record a STUB, which is worse than recording nothing** (measured 2026-08-21,
  `docs/plans/seal-the-economy.md` §3.1b and §6). `live` in `main.js` excludes `netsimDriving`, so
  `captureTick` never fires while a room drives — but the flush still writes a `gameplay_sessions` row, with
  the kills and duration the ROOM produced. Session `282b6018` claims 650 s and 14 kills against a
  49-second trace holding 5 seconds of real input. So the admin replay viewer has been playing a
  five-second stub for every netsim session since the flag shipped. **A row whose `kills` describe a fight
  its trace does not contain is the indefensible part** — fix by capturing under netsim too, or by not
  writing the row at all.

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
- **Half-closed (2026-08-22).** A run fought in a server-run room is now banked BY that room, from its own
  simulation, under an identity the client never supplies (DECISIONS §131). But `?netsim=1` is opt-in, so
  **browser single-player — nearly all real play — still banks on its own word** through `POST /api/games`.
  Closing the rest means either routing all play through rooms (deliberately NOT chosen; see D1 in
  `docs/plans/server-authoritative-sim.md`) or making trace verification work, which today it does not
  (§129). Also still client-authoritative: loot deposit, side-mission clears, and `/advance`.

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
- **Freighter trade route across the star system.** With the map becoming a real star system (star + 4
  orbiting planets + an asteroid belt with mining bases + a science station; see the star-system-map work),
  the freighter should stop being a fixed backdrop set-piece and instead follow a **route** through the
  system — e.g. hauling between the mining bases / stations / planets, moving along a path over time. Design
  the route (waypoints, speed, whether it's purely cosmetic traffic or a future escort/raid mission target)
  once the orbital layout lands. Deferred by the maintainer during the star-system-map discussion
  (2026-08-09) — not decided yet. Current freighter: `catalog_seed.js` `freighter` set-piece + the ambient
  backdrop battle near it (`client/src/backdrop-battle.js`).
- **Aim assist: target by hitbox spheres, not ship center.** Bullet auto-aim (`findBulletAimTarget` →
  `nearestInConeIndex` in `steering.js`) currently picks the nearest target whose **center** falls inside the
  forward cone, so the stream won't bend toward a large ship until its *center* enters the cone — even when
  its hull already overlaps the line of fire (confirmed in play 2026-08-09 with a tripled cone). Rework the
  pick to test the ship's **hitbox spheres / broad radius** (or the nearest point on the hull) against the
  cone, not just the center point. Watch **performance**: this runs per bullet per shot, so a naive
  all-spheres-per-bullet test could get expensive with many enemies + high rate-of-fire — budget it (broad
  radius pre-filter, cap candidates, etc.). The Kinetic skill's aim-assist bonus feeds the same code, so
  this improves both. (Aim-assist cone numbers were briefly ×3'd for a feel test then reverted to 2°
  weapon / 0.5°-per-point skill — DECISIONS §89/§93.)
- **General visual/UX live-tuning panel (with save-to-file).** A unified in-game panel to live-tune the
  look/feel knobs we currently hardcode or scatter across one-off `?dev`/`?tune` panels: background color,
  starfield, the speed field / parallax "sense of flight", lighting, camera position/offset, effects, etc. — with a
  **save-the-tuned-config-to-file** step so the tuned numbers become the new committed defaults (not just a
  clipboard paste). Frame as a future phase. The exhaust `?dev` panel (`exhaust-fx.js buildExhaustPanel`,
  2026-07 — global look toggle + freighter palette/shape sliders + **Copy JSON**) is the first small
  instance of this pattern; the ghost-battle "Backdrop" panel (persisted `ghostTune`) is another. The
  general version generalizes them into one panel and adds a real save path. See DECISIONS §74/§30.
- **Feature-pipeline: review the planner sessions.** The `/feature-pipeline` planner has been the slowest
  and most revision-prone stage (e.g. the 2026-07-26-2114 exhaust run: ~15 min across discovery + write +
  2 revisions, and it once shipped an incomplete edit-list — a removed pool's third importer was missed and
  only the critic caught it). Go back over recorded planner sessions and tighten its discovery/plan-write:
  exhaustive consumer sweeps for any *removal*, tighter time budget, fewer round-trips. Data source:
  `docs/pipeline-runs.jsonl` + the agent transcripts.
- **Feature-pipeline: make the visual/UI test run OPTIONAL.** The visual-scenario harness (software-WebGL)
  dominates implementer wall-clock (~27 min on the exhaust run) and is baseline-flaky on ~6 scenarios. Make
  running the visual suite an opt-in gate (like the perf A/B gate) — default to the fast unit suite +
  the mandatory replay guard, and only run the broader visual scenarios on request or when the change is
  visual. Keep the intro replay guard (`22-intro-replay`) always-on.
- Daily/repeatable missions for retention.
- Leaderboards.
- More ship classes / visual variety.
- Weapon icons / 3D models (for the hangar shop stash + around-model slot icons).
- **Distinct shield-absorb sound (player + enemy).** Absorbed hits currently share the hull-hit audio
  (`audio.sfx.hit()` synth tick for enemies; the sampled `shipHit` for the player) — only the *visual*
  distinguishes them (cyan flash + bubble ripple). Two options were scoped: a **synthesized voice** in
  `client/src/audio.js` (a short bright filtered ping next to `hit()`; asset-free, no `SOUNDS`/`SOUND_MAP`
  rows, ships instantly) or a **sampled clip** (new CC0 asset → `client/assets/sounds/` → S3 + hash →
  `SOUNDS` + `SOUND_MAP` rows in `server/src/catalog_seed.js` → `CREDITS.md`). Apply it to **both** sides so
  "a shield absorb sounds like a shield" regardless of who is hit. (Deferred out of the enemy-shields
  change, DECISIONS §74.)
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
- **Re-record the freighter backdrop battle WITH rockets.** The shipped ambient "ghost battle" backdrop
  (near the freighter, `client/src/backdrop-battle.js`) was recorded before the transform recorder captured
  the `rockets` array — so its rocketeers never fire visible rockets. Once the Level-0 cutscene work adds
  **rocket capture to the shared recorder** (Step 2 of the intro cutscene, 2026-07-09), re-record the
  backdrop clip via `/record-backdrop-clip` so the distant skirmish shows rockets too. Data-only (a new
  committed track); no runtime change beyond the shared rocket render already added for the cutscene.
