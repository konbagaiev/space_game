# Mission generator — implementation brief (Vega Sentinels)

> ROADMAP **Phase 2**. Repeatable, generated missions = the grind content that feeds the economy (and
> the backbone of the ~50-sortie campaign). **Reuses the existing level engine** — a mission is just a
> generated level-style descriptor played by the current `levelRunner`. Server-authoritative rewards.
> English-only. Planning window — no code written here.

## Core idea: missions = generated level descriptors
The game already has a data-driven level system: `LEVELS[].descriptor = { title, map, briefing?, phases[] }`,
where each phase has `spawn { maxConcurrent, total?, pool:[{ship,chance}] }` + `advanceWhen { kills |
killsSincePhase | allCleared }` (+ a `win` phase). The client `levelRunner` plays it. **A mission is the
same descriptor, produced by a generator instead of hand-authored.** No new runtime — just a factory that
emits descriptors + a reward.

## Mission types (the player's ask)
1. **Clear the asteroid field** — dense-asteroid map; waves of pirate fighters/rocketeers; objective:
   clear all (`allCleared` after a `total` is spawned). Simplest → MVP.
2. **Hunt the pirate leader** — normal waves, then a single **elite "leader"** enemy that must be killed
   (boss-style single-spawn phase). Objective: kill the leader.
3. **Intercept the convoy** — slow tanky **transport** ships + escorts; objective: destroy the transports.
   (Optional flavor later: they "escape" on a timer.)

MVP can reuse existing ships as stand-ins (e.g. `medium` as the leader, `heavy`/`medium` as transports)
and add proper **leader/transport enemy types + an asteroid-field map** as content (Phase 2b).

## Reward model — server-authoritative
- Each generated mission carries a **credit reward defined server-side**. Reward ≈ sum of enemy
  `reward`s + a small completion bonus; target ~150–250 cr/mission so it paces the catalog prices
  (see `catalog-economy.md`: ~3 grind missions ≈ a small upgrade, the Heavy hull ≈ a real goal).
- **Trust model (now):** the sim is client-side, so completion + credits are client-reported — same trust
  level as the existing `recordGame` (per-kill rewards already client-reported). Acceptable for
  single-player; **server-side validation is the integrity backlog item** (matters once PvP/competitive).
  The server still *owns* the reward amount (client can't pick it).

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
  or a dedicated screen) lists offered missions with type + difficulty + reward; pick one → fly it.
- This is what lets Kostya **playtest shop balance** (earn credits repeatably to test purchases).

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

## Open questions
- Generation: templates as **DB data** (consistent with levels/maps) vs **code**? (Recommend data
  templates + code instantiation.)
- How many missions offered at once on the board (e.g. 3, refreshing)?
- Difficulty curve: fixed per type, or scaling with how many missions cleared / player gear?
- Leader/transport: new enemy types now, or stand-ins for 2a and real content in 2b? (Recommend
  stand-ins first.)

## Acceptance criteria (2a MVP)
- After level 3, a mission board offers repeatable "clear the field" missions (type + reward shown).
- Selecting one plays via the existing `levelRunner`; clearing it banks the **server-owned** reward.
- Rewards pace the catalog prices (≈ a few missions per small upgrade) — tunable.
- Replayable so the player can grind credits to test shop purchases.
