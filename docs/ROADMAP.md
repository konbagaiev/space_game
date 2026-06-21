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
- [ ] **Feedback channel** — in-game "Send feedback" button → DB table or a Discord/Telegram webhook,
      and/or a visible community link. *Without this, launching yields nothing.*
- [ ] **Light funnel telemetry** — extend the existing game-history post with a few events (level
      started, level cleared, died, quit) so we can see where players drop. Answers "what to fix next".
- [ ] **First-time onboarding check** — make sure a stranger understands controls (esp. mobile/touch)
      in the first minute.
- [ ] **Basic sound** (optional but high-impact polish) — shot, explosion, one combat track + one
      hangar track, mute toggle. See the Audio track below.
- [ ] Announce / share the link.

## Phase 1 — Progression core (the grind loop)
The post-level-3 goal: grind to upgrade/buy ships. Needs an economy + a place to spend it.
- [ ] **Economy** — credits, earned-per-run vs persistent balance (DECISIONS §11). Persisted per player
      (tie to accounts; anonymous keeps localStorage, synced on login).
- [ ] **Hangar** — player ship centered, detailed (hi-poly) model via the CDN (`model_url_high`, lazy
      load); PBR/IBL scene (see DECISIONS §14, hangar plan TBD).
- [ ] **Shop** — buy stronger weapons, reinforce hull; data-driven prices/payouts.
- [ ] **Storage / inventory** — owned ships, weapons, components persisted per player.
- [ ] **Upgrades** — weapon swaps + hull reinforcement (extends the existing component/loadout model).
- [x] **Repair-drone component (4th component type)** — base: heal 1 HP / 3 s up to 80% max HP.
      **Spec'd → `docs/plans/repair-drone.md`** (ready to implement in the work session). Resolved: it's
      **installed via the level-3 briefing** (player has it going *into* level 3), not awarded after.
      Regen changes combat balance — knobs are data-driven, tune from playtests.

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
