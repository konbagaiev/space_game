# Mission generator — implementation brief (Vega Sentinels)

> **Progress: 2a MVP done (2026-06-22).** `server/src/missions.js` generates the 3 same-difficulty side
> missions (mining/research/freighter); `GET /api/players/:id/missions` serves them, gated by
> `shop_unlocked`. Client: provisional **3 buttons top-right + a description panel + Take off** (not the
> full hangar board yet); a mission plays via `levelRunner` and **banks per-kill ×2 without advancing the
> story** (`sideMission` flag). Enemy mix/difficulty per `mission-enemies-difficulty.md` (done). See
> DECISIONS §18, CHANGELOG 2026-06-22, server tests + visual `10-mission-board`. **Remaining:** richer
> hangar board UI, server-sealed rewards (integrity), L4/L5 story levels, richer objective types (2b),
> difficulty/reward scaling + anti-repetition (2c), per-mission set-piece environments (mission-maps).

> ROADMAP **Phase 2**. Repeatable, generated missions = the grind content that feeds the economy (and
> the backbone of the ~50-sortie campaign). **Reuses the existing level engine** — a mission is just a
> generated level-style descriptor played by the current `levelRunner`. Rewards via the existing credit
> banking (server-sealed later). English-only. Planning window — no code written here.

## Core idea: missions = generated level descriptors
The game already has a data-driven level system: `LEVELS[].descriptor = { title, map, briefing?, phases[] }`,
where each phase has `spawn { maxConcurrent, total?, pool:[{ship,chance}] }` + `advanceWhen { kills |
killsSincePhase | allCleared }` (+ a `win` phase). The client `levelRunner` plays it. **A mission is the
same descriptor, produced by a generator instead of hand-authored.** No new runtime — just a factory that
emits descriptors + a reward.

## Two kinds of missions
- **Story missions** — hand-authored campaign levels that **advance progression** (`current_progress`),
  like L1–L3. The next two continue the story toward the pirate base:
  - **L4 — "Find the pirate base"** (clearly harder than L3 — exact difficulty TBD by Kostya). The
    briefing introduces the **shop** and foreshadows heavy enemies:
    - EN: *"Several ships bolted from the factory just before we arrived — we tracked their heading, and
      your job is to find where they're hiding. While you're docked, look over the upgrade gear the
      factory has on hand: we counted a lot of heavy ships among the ones that fled, so kit out
      accordingly. Good hunting, Sentinel."*
    - RU: *"Несколько кораблей спешно снялись с фабрики перед самым нашим прибытием — мы отследили их
      курс, и твоя задача выяснить, где они засели. Пока стоишь в доке, присмотрись к оборудованию для
      апгрейда на фабрике: среди удиравших мы насчитали много тяжёлых кораблей, так что снаряжайся
      соответственно. Удачной охоты, Страж."*
  - **L5 — "Storm the pirate base"** — the setpiece assault + a new boss (ROADMAP **Phase 3**).
  - Story missions are authored `LEVELS` entries, **not generated**.
- **Generated side missions** — the repeatable 3-choice board (below). **They do NOT advance the story
  counter** — pure side content for credits/grind; reuse the generator + `levelRunner`.

## Generated side missions — the 3-choice board (2a)
- **Three options offered, ALL the SAME difficulty** (≈ level 3, or just slightly above) — *not*
  Easy/Med/Hard tiers. Same difficulty, different **flavor**. Each needs a **meaningful description**
  (i18n keyed). Mechanically all "clear the field" for 2a; richer objectives come in 2b. The three:
  1. **Mining station** — EN: *"The mining stations in our asteroid belt have stopped shipping metal. Go
     find out what's wrong — and clear out whatever's behind it."* RU: *"Добывающие станции в нашем
     астероидном поясе перестали поставлять металл. Слетай разберись — и зачисти всё, что найдёшь."*
  2. **Research station** — EN: *"A pirate group has been spotted near our research station. Drive them
     off before they get curious."* RU: *"Возле нашей исследовательской станции замечена группа пиратов.
     Отгони их, пока не осмелели."*
  3. **Freighter distress** (proposed third) — EN: *"A civilian freighter is broadcasting a distress
     call — pirates are closing in. Get there and clear them out."* RU: *"Гражданский транспорт шлёт
     сигнал бедствия — к нему приближаются пираты. Прибудь и зачисти их."*

Richer objective types — **hunt the pirate leader** (elite single-spawn) and **intercept a convoy**
(transports + escorts) — are **2b** (need leader/transport enemy types + an asteroid-field map; use
existing ships as stand-ins until then).

## Reward model
- **2a: side missions pay via the existing per-kill ×2 banking** — clearing a mission banks its kill
  rewards, doubled on victory, exactly like a campaign level (no separate reward to design). Bigger/harder
  missions pay more. With the doubled economy a ~level-3-sized mission ≈ **~600+ credits**; tune by mission
  size so the grind paces catalog prices (small upgrade ≈ a few missions; Heavy hull ≈ a real goal).
- **Trust model (now):** sim is client-side, so credits are client-reported — same trust as the campaign.
  **Server-sealed per-mission rewards + validation = the integrity backlog item** (matters for PvP).

## Architecture
- **Templates (data) + generator (code).** A small set of mission-type templates (param ranges: enemy
  mix, counts, `maxConcurrent`, difficulty, map, reward formula) — store like `LEVELS`/`MAPS`
  (data-driven) or in code; the generator instantiates a concrete descriptor with randomized-within-bands
  composition (anti-repetition) scaled by difficulty.
- **Endpoints (server):** `GET /api/players/:id/missions` → a few currently-offered missions (type,
  difficulty, reward, an opaque mission id); `POST /api/players/:id/missions/:mid/complete` → validate +
  bank the sealed reward. Server holds each offered mission's reward so it can't be forged.
- **Client:** the existing `levelRunner` plays the returned descriptor; on victory, call `complete`.
- **Maps:** missions pick a map (reuse `home-system`; add an **asteroid-field** map variant for type 1 —
  `buildMap` is parametric, so it's a new MAPS entry / params).

## Gating & placement
- Unlocked **after level 3** (same gate as the shop). A **mission board / "sortie" menu** (in the hangar
  or a dedicated screen) lists the **3 offered side missions** (flavor description + est. reward) — all
  the same difficulty; pick one → fly it. Clearing one **does not advance the story counter**; the board
  refreshes (per visit / on completion).
- This is what lets Kostya **playtest shop balance** (earn credits repeatably to test purchases).

## Post-L3 flow — the hangar hub (fixes the "L3 text lingers" issue)
**Current symptom:** clearing L3 (the last level) has no next level, so L3's victory text stays and
nothing leads the player onward. **Cause: L4 isn't implemented** (not a text bug).

**Fix — implement L4 as the next campaign level**, so the standard *briefing-on-advance* shows **L4's
briefing** after L3 (exactly how L2's briefing shows after L1). After clearing L3 the player lands in the
**hangar hub** (NOT auto-thrown into the next level):
- **L4 briefing is shown** — "find the pirate base, but **gear up first** (heavy ships ahead)". The
  drafted L4 text (above) already says this; it is the lead-in, **replacing the lingering L3 victory text**.
- **Side missions + shop are available** in the hub to grind credits and upgrade.
- The player **launches L4 (the story mission) when ready** — not forced straight in.

This is the "implement missions differently" change: **after L3 the hangar is the hub**; the story
mission (L4) and the side missions both launch from it on the player's choice, instead of auto-replaying
the next level on Restart. L4 itself is clearly harder than L3 (heavy ships) — content/difficulty TBD.

## Phasing
- **2a (MVP, unblocks balance testing):** mission board + **one type (clear the field)** reusing
  `levelRunner`, server-owned reward, repeatable. Enough to grind credits and test the shop.
- **2b:** add **hunt-leader** + **intercept-convoy** types + their content (asteroid-field map,
  leader/transport enemy types in `catalog_seed`).
- **2c:** difficulty/reward **scaling** with progression + anti-repetition tuning; then weave missions
  with story beats → the ~50-sortie campaign (ROADMAP north star, reuses the briefing system §13).

## Coordination
Touches `catalog_seed.js` (templates/new enemies/map), `db.js`/`db_postgres.js`/`datastore.js` (mission
offer + reward + complete), `server.js` (endpoints), `client/index.html` (mission board + levelRunner
hookup). Coordinate migration number if any table is added (stash took 011 → next 012; re-check). Reuses
the level/phase engine — keep changes additive.

## Resolved
- **3 missions on the board, all the SAME difficulty** (≈ L3 or slightly above) — not tiers.
- **Side missions don't advance the story counter** (repeatable, credits only).
- **Templates = data-driven** (like LEVELS/MAPS) + code instantiation.
- **Side-mission enemy mix + difficulty** (the new **pirate gunner** + a boss buff + the
  40/40/20 → 35/35/30 → **2-boss finale** composition) → **`docs/plans/mission-enemies-difficulty.md`**.
  Richer objective types (hunt leader / intercept convoy) = 2b.
- **Reward = per-kill ×2** (like a level) for 2a; server-sealed reward = integrity backlog.

## Still open
- Exact **L4 difficulty** ("find the pirate base", clearly > L3) — Kostya to set.
- Board **refresh cadence** (per hangar visit vs on completion).
- Asteroid-field **map variant** (2b content).

## Acceptance criteria (2a MVP)
- After level 3, the mission board offers **3 same-difficulty** side missions, each with a flavor
  description (mining station / research station / freighter distress) + est. reward.
- Selecting one plays via the existing `levelRunner`; clearing it banks the per-kill ×2 credits and
  **does not advance the story counter**; the board can be replayed/refreshed.
- Rewards pace the catalog prices (tunable) so the player can grind credits to test shop purchases.
