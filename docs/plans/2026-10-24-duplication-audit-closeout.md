# Duplication audit — close-out (every remaining item)

**Date:** 2026-10-24. **Status:** not started.
**Source:** [`2026-10-20-duplication-audit.md`](2026-10-20-duplication-audit.md) (ids A6–A9, B3–B5, C1–C17 refer
to it; read the matching section there for the original evidence). The first five phases of the clean-up are
done — [`2026-10-20-base-menu-state-and-drift-fixes.md`](2026-10-20-base-menu-state-and-drift-fixes.md) fixed
A1–A5, the menu part of A6, B1, B2, the `?record` part of B5, and B6 (DECISIONS §162–§166).

**Goal:** close every item still open in the audit, so the audit can be marked **done**. Each item is either
fixed (one source + a guard that would have caught the drift) or explicitly closed as "won't fix" with a
reason written into the audit.

**How to execute.** Eight phases, each its own `/feature-pipeline` run (offer it per CLAUDE.md; the maintainer
chose the pipeline for every phase of the previous plan). Phases are independent unless stated; the order
below is the recommended one (cheapest and safest first, the device-dependent CSS work last). After each
phase: mark the items in the audit (`**fixed YYYY-MM-DD** (\`<commit>\`)`), update this file's phase status,
CHANGELOG / SUMMARY / DECISIONS as CLAUDE.md requires, deploy (prod + itch if any client file changed), and
hand the maintainer a live-test checklist.

**Line numbers below were re-checked on 2026-10-24** against `main` @ `2297cab`. They drift; every phase starts
by re-reading the cited code. If an item turns out to be already fixed or wrong, say so in the run and mark it
in the audit rather than inventing work.

**Standing rules for every phase (maintainer preferences, do not re-ask):**
- Ask before running test suites. The full visual suite (`npm run test:visual`) and the perf A/B gate are
  opt-in — ask, default skip. Named single scenarios are fine and expected for the change they guard.
- Visual runner: one invocation at a time, port 4173 (`lsof -i :4173` first — another worktree may hold it).
- Every fix ships a guard that was seen to FAIL on the old code (negative-test it).
- Any sim/replay-path change runs `node visual/run.mjs 22-trace-replay` (determinism) from `client/`; a change
  to the per-tick loop or hit/death logic also runs `36-sim-divergence`.
- English in every file; the chat with the maintainer is in Russian. Keep `AskUserQuestion` questions to one
  short line and put explanations in the chat text (the question text renders unreadable for them).
- Next DECISIONS number is **§167** (check the file's tail — parallel sessions may have taken it).

---

## Phase 1 — Shared contracts between client and server (C1, C2, C3, C4, C7)

Size M. Pattern: DECISIONS §136 — one pure module under `client/src/` (`sim-core/` if the sim needs it), the
server imports it; a test recomputes instead of asserting a literal.

### C1 — skill list ×7
Copies today: `server/src/db.js:16` (`SKILLS`), `:30` (`NEW_PLAYER_DEFAULTS` skill_* keys), `:349-353` (the
`ALTER TABLE ... skill_*` columns), `server/tools/verify-sessions.mjs:74`, `client/src/mainwindow.js:215`
(`SKILL_CARDS`, comment "card order = server SKILLS order"), `client/src/sim-core/components.js:47-61`
(`SKILL_RATES`, `skillEffects`), i18n `ui.skill.<key>.*` in `client/locales/source.json` + `ru.json`.
1. New `client/src/sim-core/skills.js`: `export const SKILLS = ['kinetic','rocket','shields','maneuver','mobility'];`
   `export const skillColumn = (s) => \`skill_${s}\`;`
2. `db.js` imports it (drop its own `SKILLS`), generates the `ALTER TABLE` lines and the `NEW_PLAYER_DEFAULTS`
   skill keys from it; `verify-sessions.mjs` maps `SKILLS` through `skillColumn`; `mainwindow.js` uses
   `SKILLS` instead of `SKILL_CARDS`; `components.js` keeps `SKILL_RATES` but a test pins it.
3. Guard `client/src/sim-core/skills.test.js`: every key has an effect in `skillEffects({[k]: 1})` that
   differs from `skillEffects({})`, and both i18n keys the Character card reads exist in `source.json` AND
   `ru.json` (read the card renderer at `mainwindow.js:215-260` for the exact key names).

### C2 — slot lists + weapon-group map
`server/src/db.js:985-990` (`REQUIRED_SLOTS`, `COMPONENT_SLOTS`, `WEAPON_GROUP`, fallback `|| 'gun'` at `:1143`)
vs `client/src/shop-slots.js:13` (`GROUP_WEAPON_TYPE`) and the client slot lists (grep `'thruster'` in
`client/src/shop.js`, `client/src/sim-core/components.js`, `client/src/sim-core/ship-entity.js`).
1. Move `REQUIRED_SLOTS` / `COMPONENT_SLOTS` into `client/src/shop-slots.js` (check it is THREE-free and
   node-importable; if not, put them in `client/src/sim-core/shop-rules.js`, which the server already imports).
2. `db.js` imports them and derives `WEAPON_GROUP` by inverting `GROUP_WEAPON_TYPE`. **Decision (chosen):** an
   unknown weapon type is rejected by the server (409) instead of silently routed to `gun`, matching the
   client, which shows no slot for it.
3. Guard: a server test that inverts `GROUP_WEAPON_TYPE` and equals `WEAPON_GROUP` for every weapon `type` in
   `catalog_seed.js WEAPONS`.

### C3 — sell rate ×3
`client/src/format.js:21-22` (`SELL_RATE`, `sellLabel` — check it is still unused outside tests),
`client/src/shop.js:514` (`sellUnit`), `server/src/db.js:991` (`sellPrice`, literal 0.75);
`client/src/format.test.js:36` asserts the literal.
1. `SELL_RATE` + `sellPrice(price)` live in `client/src/sim-core/shop-rules.js`; `db.js` and `shop.js` import
   them. Delete `sellLabel` if unused; delete the literal assertion.
2. Guard: a server test that selling an item credits exactly `sellPrice(item.price)` imported from shop-rules
   (not a literal).

### C4 — client rebuilds the progression object
`client/src/net.js:95-103` recomputes level/XP with `levelFromXp` and adds skill points because
`POST /api/games` (`recordGame`, `server/src/db.js:789-801`) returns only `{experience, level, leveledUp, xpEarned}`.
`client/src/mainwindow.js:229` falls back to a literal `xpForNextLevel: 1000`; the Character XP bar is
computed differently from `client/src/hud.js` `liveProgress`.
1. `recordGame` also returns `progression: await getProgression(playerId)` (keep the old fields; the itch build
   and old tabs read them). `net.js` adopts `res.progression` when present and keeps the local recompute only
   as a fallback for an old server.
2. Character's XP bar uses `liveProgress` (read `hud.js` for its signature). The `1000` fallback reads the XP
   curve (`client/src/progression.js`) instead of a literal.
3. Guard: a server test that `POST /api/games` returns a `progression` equal to `GET` of the player's
   progression right after. The XP-curve copy itself is intentional (DECISIONS §103) — leave it.

### C7 — shop-unlock triggers and starter ids
`unlockShop` action on level-2's briefing (`server/src/catalog_seed.js:796`), the boot catch-up via
`SHOP_MIN_LEVEL` (`db.js:41`, `:479-482`), the final-level fallback (`db.js:699`); weapon 1 granted at the
catch-up and fallback; grab 29 / shield 31 granted while the starter ship already lists them (grep `29` /
`31` near `registerPlayer` in `db.js` and the starter ship row in `catalog_seed.js`). `FACTORY_GATE`
(`catalog_seed.js`) and `SIDE_MISSIONS_MIN_LEVEL` (`db.js:42`) both say `'level-4'`; stale `level-5` comments
in `catalog_seed.js` (grep `level-5`). Partly intentional (DECISIONS §90, §95) — do not change behaviour.
1. A server test: the level whose briefing carries `unlockShop` is exactly `SHOP_MIN_LEVEL`;
   `FACTORY_GATE === SIDE_MISSIONS_MIN_LEVEL` (or `FACTORY_GATE` imports it).
2. `STARTER_WEAPON_ID` constant; grab/shield grant ids read from the starter ship's `components`.
3. Fix the stale comments.

**Tests:** `npm test` in `server/` (recreates `spacegame_test`) and `node --test` for the touched client
modules. No visual scenario needed unless the Character card markup changes — then run the Character
scenario (grep `ch-cards` in `client/visual/scenarios/`).

---

## Phase 2 — Ship ids in the seed, one catalog builder (B3, C8)

Size M. **Risk: prod data.** Green tests + a fresh seed prove nothing here — prod's row ids can differ from a
freshly-seeded DB (a known past failure mode). The ids must match what prod already stores.

### B3 — `buildShip` matches by an id the seed doesn't have
`server/src/sim-host.js:67-72` matches `s.id === shipId`, but `SHIPS` in `catalog_seed.js` has no `id`, and
ships are upserted by name (`server/src/db.js:397-398`, `ON CONFLICT (name)`), so the DB assigns sequence ids.
Traces and the room handshake carry the DB id. Today every server build falls back to the first player ship;
harmless with one flyable hull, wrong the day a second ships.
1. **Before writing code:** read prod's ship ids read-only:
   `ssh -i ~/.ssh/do_cs root@178.104.91.144 "cd /opt/projects/spacegame && docker compose exec -T app node -e \"...\""`
   or `psql` against `shared_postgres` — `SELECT id, name FROM ships ORDER BY id`. Compare with a fresh local
   `spacegame_test`. Record both in the plan of the run.
2. Give every `SHIPS` row a fixed `id` equal to prod's. Switch the ships upsert to `ON CONFLICT (id)` like
   weapons/components (`db.js:386`, `:392`). Bump the sequence past the max id (same as the other tables do —
   grep `setval` in `db.js`).
3. **Decision (chosen):** if a local or prod row's id disagrees with the seed (a DB seeded in another order),
   the startup migration renames by name → id, once, logged. If that is not safe (FKs on `player_ships.ship_id`
   etc.), stop and ask the maintainer instead of guessing.
4. Guard: a server test that `buildCatalog().shipByName` rows all have ids and that `buildShip(catalog,
   {shipId: <the player ship's DB id from a fresh seed>})` returns that ship, not the fallback (negative-test:
   fails today because the seed has no ids).

### C8 — catalog flattening and row mappers
Flattening: `client/src/main.js:2250` area (search `CATALOG.weapons.set` / `shipByName.set`) and
`server/src/sim-host.js:34-52` (`buildCatalog`). Row→object mappers in `db.js` (the catalog endpoint's mapper vs
`catalogItem` at `db.js:993`, which lacks `rarity`, `color`, model URLs → stash rows poorer than catalog rows);
insert column lists `db.js:386`, `:392`.
1. One `catalogFromRows({ weapons, components, ships, level })` in `client/src/sim-core/` (new file
   `catalog.js`), used by `main.js` (and `account.js` / `net.js` if they rebuild the catalog — grep
   `CATALOG.level =`) and by `sim-host.buildCatalog` (which feeds it the seed arrays).
2. `catalogItem` returns the same fields as the catalog endpoint (one mapper).
3. Guard: a node test that `catalogFromRows` over the seed equals today's `buildCatalog` output (written
   before the swap, so it pins the old behaviour), plus a server test that a stash row carries `rarity` and
   `modelUrl`.

**Tests:** server `npm test`; client `node --test client/src/sim-core`; `22-trace-replay` (the catalog feeds
the sim). Deploy note: the migration runs at server start on prod — watch the CI deploy log.

---

## Phase 3 — Level reward and mission location as single sources (C5, C6)

Size S–M.

### C5 — the level reward stated three times
`catalog_seed.js:752` (`lastKillDrop` weapon 5) / `:796` (`replaceWeapon 1→5` on the next briefing);
`:792` (`lastKillDrop` component 12) / `:851` (`installComponent repair 12`); the owned check
`client/src/sim-core/drops-config.js` `rewardOwned` hard-codes `comps.repair != null` for any component reward.
1. `rewardOwned` resolves the component's slot from the catalog by `refId` (it needs the catalog's component
   row: pass `catalog` in, or put `slot`/`type` on the `lastKillDrop` record server-side when stamping the
   level — pick the one that keeps `rewardOwned` THREE-free and its callers simple; `drops-sim.js:18` and
   `client/src/drops.js` are the callers).
2. **Decision (chosen):** keep the briefing actions as written (they are the real grant and carry extra steps
   like `unlockShop`), and guard the agreement: a server test that for every level with `lastKillDrop`, the
   NEXT level's briefing grants exactly that `{kind, refId}`. Generating the action from the drop is more
   machinery than one test.

### C6 — mission-location invariant half tested
`server/src/missions.js:69-85` (centres; the "FOUR-WAY INVARIANT" comment), `client/src/sim-core/system-map.js:226`
(`ANCHORS`) and its mission-id mapping (grep `objectForMission`), set-pieces in `catalog_seed.js` `home-system`.
`client/src/sim-core/system-map.test.js` checks anchors vs set-pieces only.
1. `missions.js` imports `ANCHORS` for mining/research centres (the freighter keeps its documented +50 z
   offset — express it as `ANCHORS.x + offset` if it has an anchor, else leave it and test it).
2. Guard: a server test that for every generated mission type, `objectForMission(id).pos` equals the mission's
   `center` (± the documented freighter offset), and the roam activity-zone centre matches.

**Tests:** server `npm test`; `node --test client/src/sim-core/drops*.test.js client/src/sim-core/system-map.test.js`;
`22-trace-replay` only if `rewardOwned`'s call signature changes inside the sim.

---

## Phase 4 — One fight spec, one player build (B4, B5 remainder, C12, C13)

Size M. Replay-sensitive.

### B4 — dev fight flags applied in five places
`client/src/main.js:2250` (ally → lancer → duel → trace-room → brawl), `client/src/account.js:283` (no lancer),
`client/src/net.js:276` (no lancer, no brawl), `server/src/sim-host.js:115-131`. Forwarded to a netsim room as
ally/lancer/beam/brawl — **not duel**, so `?duel&netsim=1` fights a different fight in the tab and the room. A
`?ally`/`?lancer` session records as the plain level (only duel is recorded).
1. `client/src/sim-core/fight-spec.js`: `applyFightSpec(descriptor, {ally, lancer, duel, brawl})` with the
   one order (ally, lancer, duel last; brawl replaces all). The client parses the URL once into a spec
   (`parseFightSpec(location.search)` in a client module next to the `*-dev.js` files); `main.js`, `account.js`,
   `net.js` call `applyFightSpec(level.descriptor, FIGHT_SPEC)`; `sim-host.createSimWorld` calls the same.
2. The socket handshake (`client/src/netsim.js` → `server/src/netsim/socket.js`) forwards `duel` too.
3. **Decision (chosen):** traces record the whole spec in `trace.room` (today only duel). Old traces without
   it play as before. Bump nothing else in the trace format.
4. Guard: a node test that the three client call sites produce the same descriptor as `sim-host` for each flag
   combination (test `applyFightSpec` once and assert the call sites import it — a grep-style test is fine);
   a socket test that `duel` reaches `createSimWorld`.

### B5 remainder — `resolvePlayerBuild`
Today: `client/src/ship-build.js:44-63` (`buildPlayerFor`: beam + duel overrides), `client/src/replay.js:181`
(`flownBuild`), `client/src/main.js:1792` (`?record`), `:1835` (live recorder, duel not beam — documented),
the playback path (grep `trace.skills` in `main.js`), `server/src/sim-host.js:67-93` (`buildShip`: beam only).
The duel kit lives only in `client/src/duel-dev.js:65-69` (`DUEL_LOADOUT`, `DUEL_COMPONENTS`).
1. Move `DUEL_LOADOUT` / `DUEL_COMPONENTS` / the body of `duelBuild` into `client/src/sim-core/duel-config.js`.
2. `resolvePlayerBuild({ ship, loadout, components, skills }, spec)` in sim-core applies beam and duel; used by
   `buildPlayerFor`, both recorders (on top of `flownBuild`) and `sim-host.buildShip`. Keep the documented
   "recording does not capture `?beam`" behaviour (audit §D) unless the spec from B4 now records it — if it
   does, record beam too and say so in DECISIONS.

### C12 — timing constants across the boundary
`INTERP_DELAY_MS = 100` (`client/src/netsim-world.js:51`) "keep in step" with `SNAPSHOT_EVERY = 2`
(`server/src/netsim/room.js:52`); catch-up cap 6 (`server/src/netsim/driver.js:16` `MAX_CATCHUP_STEPS`,
`client/src/netsim.js:164` area, the live loop in `main.js` — grep `6` near "catch-up"); `1 / 60` hard-coded in
`client/src/sim-core/level-sim.js:68`, `client/src/brawl-stats.js`, `server/tools/brawl-capacity.mjs`.
1. `SNAPSHOT_EVERY`, `MAX_CATCHUP_STEPS` and the frame clamp move to `client/src/sim-core/consts.js` (next to
   `TICK_HZ` / `SIM_DT`); `INTERP_DELAY_MS = 3 * SNAPSHOT_EVERY * 1000 / TICK_HZ`; the `1 / 60`s read `SIM_DT`.
2. Guard: a node test that `INTERP_DELAY_MS` equals the formula (fails if someone edits one side).

### C13 — live tick deps twice in `main.js`
`liveTickDeps()` at `client/src/main.js:1100` vs the inline deps in `window.__replay.step` (`main.js:2119+`);
stale `noseZ` comment near `:2128`. One `makeTickDeps({ capture })`; fix the comment. `main.js` is DOM-bound:
the guard is `22-trace-replay` + the replay scenario that drives `__replay.step` (grep `__replay` in
`client/visual/scenarios/`).

**Tests:** client `node --test`; server `npm test` (socket + sim-host); scenarios `22-trace-replay`,
`36-sim-divergence`, and the duel/brawl scenarios if their entry changed (grep `duel`/`brawl` in
`client/visual/scenarios/`).

---

## Phase 5 — One hit path, one warp/sustain path in the sim (C9, C10)

Size M. **Highest replay risk in this plan** — every change here must keep the intro digest bit-identical.

### C10 — hit handling and death events ~8×
Shield-then-hull + events: `client/src/sim-core/step-projectiles.js` (grep `shieldHit`), `spawn.js` splash
(emits no `hit` — decide if that is a bug: **Decision (chosen):** keep today's events exactly, the refactor is
behaviour-neutral; list the splash gap in the audit as a separate finding for the maintainer), `beam.js`.
Deaths: `step-enemies.js:132-149` (reads `e.engine.exhaust.color` **unguarded** — a latent crash for an engine
row without `exhaust`), `step-ally.js:864`, `brawl.js:133` (both guarded).
1. `applyHit(world, victim, side, dmg, pos, heading, weaponClass)` and `emitShipDown(world, e, type)` in a new
   `client/src/sim-core/hits.js`; every site calls them in the SAME operation order (RNG draws included).
2. Guard: a node test with an engine row without `exhaust` that kills an enemy without throwing (fails today),
   plus `22-trace-replay` and `36-sim-divergence` unchanged.

### C9 — per-tick warp/repair/shield logic per ship kind
`step-player.js:236-247` (shield recharge + `shieldReady`), `step-enemies.js`, `step-ally.js` (grep `repair` /
`shieldValue`); warp-in setup copied at `ally.js:69`, `ace.js:99`, `brawl.js:89`, `ship-entity.js:99`
(player writes `spawnDur` and never reads it). Differences to preserve unless a test proves them dead:
`shieldReady` is player-only, `enemyShieldRefills` doesn't count aces.
1. `beginWarp(ship, dur)` / `stepWarp` / `stepSustain(world, ship, dt, {emitReady, countRefill})` keeping the
   per-kind order. Remove the player's dead `spawnDur` write if nothing reads it (grep).
2. Guard: `22-trace-replay`, `36-sim-divergence`, and a unit test per kind that one second of sustain yields the
   same shield/hull numbers as before (pin with a test written BEFORE the refactor).

**Tests:** client `node --test client/src/sim-core`; `22-trace-replay`; `36-sim-divergence`; server
`npm test` (the referee re-simulates traces). Ask about the perf gate here — this touches the per-entity hot
path (default skip still applies).

---

## Phase 6 — Netsim wire format in one place (C11)

Size S. `server/src/netsim/protocol.js:41-47` (docs), encoder `server/src/netsim/room.js` (grep `encode` /
the snapshot row builder), positional decoder `client/src/netsim-world.js` (enemy/ally decoders copy-pasted);
ghost bullets/rockets/drops hand-built in `netsim-world.js` (drop height `0.8` in two places). Already guarded by
`client/src/netsim-world.test.js` (room→client column order).
1. `client/src/sim-core/wire.js`: `ROW_SCHEMA` per entity kind + `encodeRow` / `decodeRow`; room and client use
   them; `protocol.js` doc points at it.
2. Ghost drop height → one constant (from `drops-config.js` if it has one).
3. Guard: the existing round-trip test now iterates `ROW_SCHEMA`; add a negative case (a reordered schema
   fails it).

**Tests:** `node --test client/src/netsim-world.test.js`; server `npm test` (netsim). Live check: `?netsim=1`.

---

## Phase 7 — Dead keys and small constants (C16, C17)

Size S–M. Mechanical; split into two runs if the diff grows.

### C16 — dead i18n keys
Verified unreferenced on 2026-10-24 (zero hits in `client/src` + `client/index.html`, tests excluded):
`ui.button.take_off_mission` (SUMMARY still names it, `docs/SUMMARY.md:2086`), `ui.card.hull`,
`ui.card.weapons`, `ui.mount.gun`, `ui.mount.rocket`, `ui.mount.unarmed`, `ui.hangar.title`,
`ui.briefing.title`, `ui.shop.stash`, `ui.shop.empty_stash`, `ui.shop.action.unequip`, `ui.shop.filter.all`,
`ui.shop.tab.ship`, `ui.mission.slot`, `ui.stub.character`, `ui.stub.map`.
1. Before deleting, grep for template-built keys (`` `ui.${`` , `'ui.' +`, `t(\`ui.mount.`) so a dynamic use
   isn't missed. Delete from `client/locales/source.json` and `ru.json`; fix the SUMMARY line.
2. Guard: a node test that every key in `source.json` is referenced somewhere in `client/src`, `client/index.html`
   or `server/src` (string literal, `data-i18n`, or a listed dynamic prefix — keep an explicit allow-list of
   prefixes the code builds at runtime, e.g. `ui.skill.`, `mission.`), and every key in `ru.json` exists in
   `source.json`. Negative-test by re-adding one dead key.

### C17 — small constants and leftovers (each S)
- **Server ↔ client limits:** `SUPPORTED_LANGUAGES` (`server/src/server.js:24`, mirror of `client/src/i18n.js`
  — documented §10: import the client list instead), `EVENT_TYPES` (`server.js:26` vs client `track('…')`
  calls — guard: a test that every `track('x')` literal in `client/src` is in `EVENT_TYPES`), username max 32
  (`server.js:33` vs `client/index.html:152 maxlength`), password minimum (grep `length < 8` / `8` in
  `server.js` and `client/src/account.js`). Move the limits to a small shared `client/src/account-rules.js`
  (THREE-free) that the server imports; `index.html`'s `maxlength` gets a test.
- **Enemy-total rule:** `server/src/enemy_total.js:7` vs `client/src/sim-core/level-sim.js` — make
  `enemy_total.js` re-export the sim-core one (check they are equivalent first; the audit says they are).
- **Enemy `xp` = `reward` by hand** on every enemy in `catalog_seed.js SHIPS` — default `xp` to `reward` where
  the catalog is built (one place) and drop the duplicated literals; a test that every enemy's effective xp is
  unchanged.
- **Legacy radius 2.6 / nose 1.6:** `collision.js:19` (`LEGACY_R`), literals at `ship-entity.js:155`,
  `ally.js:34`, `client/src/hitboxes-debug.js`, `client/src/beam-fx.js`; nose `1.6` in `ship-entity.js`,
  `beam.js`, `client/src/ship-factory.js:339`. Export `LEGACY_R` / `LEGACY_NOSE` from `collision.js` and use
  them. Dead `userData.noseZ` write at `ship-factory.js:275` — delete only if nothing reads it (grep
  `noseZ`; `main.js:2128` reads it per its comment — verify).
- **Ally angles = catalog `aimTol`:** `client/src/sim-core/ally-config.js:33-34` — read `aimTol` from the
  ally's weapon row, or a test that they agree.
- **Input key lists:** `step-player.js` / `steering.js` — one exported key table; fire keys from the catalog
  groups (`catalog_seed.js` group `key`s).
- **Map drift / station position:** `world.js:1371` sets `arenaDrift` then `reset-world.js:47` overwrites it
  every reset — delete the dead write in `world.js` if `reset-world` is always called after it (check
  `resetWorld` order). Station position browser (mesh) vs server (`spec.pos`, `sim-host.js:56-62`): a test that
  the base station set-piece is not `frame: 'world'` (the assumption that makes them equal).
- **`staticCacheControl`** (`server.js:59`) is tested but the static middleware writes the header itself
  (grep `Cache-Control` in `server.js`): make the middleware call `staticCacheControl`.

**Tests:** client `node --test`; server `npm test`; `22-trace-replay` (radius/nose/xp/drift touch the sim).

---

## Phase 8 — The CSS/UI system (A6 remainder, A7, A8, A9, C14, C15)

Size L — one layout-focused change, **needs a device check** (memory: "Mobile verify needs hard refresh",
"Static-frame tests miss render bugs"). Propose YES to the opt-in visual suite here, and give the maintainer
an early playable build (memory: "Visual features need early playable build"). Split into 8a (tokens + money,
A9 + C14) and 8b (layout, A7 + A8 + C15 + A6 reveal) if the planner judges it too big for one run.

**Discovery must ask the maintainer explicitly** (these are look/flow calls, not defaults):
- A9: drop the Loadout header "Credits: N" readout (the top bar already shows it)? One unit: "N cr." vs "N ◈"?
- C14: "Autopilot to destination" is secondary/grey on Missions and primary/cyan on Map — which one?
- A6: unify the two staged text reveals into one helper (no visible change) — confirm Welcome stays (§162).

### A9 — money display
Units: top bar `client/index.html:170` ("N cr.", `ui.mainwin.credits_unit`); prices `"N ◈"` hard-coded and
unlocalised at `client/src/format.js:17` (`priceLabel`) and `:22`; Loadout header `#mw-view-bay .bay-credits`
(`styles.css:600`). Golds: `#ffd27a` (`styles.css:717`, `:729`, `:1092`), `#ffd86b` (`:401`, `:600`),
`#ffcf5a` (≈15 uses: `:227`, `:236`, `:256`, `:267`, `:306`, `:319`, `:335`, `:876`, `:1014`, `:1039`, `:1046`,
`:1053`, `:1137`), map gold `#ffd24a` (`:455-456` + canvas in `client/src/systemmap-ui.js`).
Fix: one `formatCredits(n)` with an i18n unit; one `--credit-gold` (and `--accent-gold` if the maintainer wants
the "active/new" gold kept distinct from money); per the maintainer's answer, drop the header readout.

### C14 — button styles and colours
Orange launch gradient, cyan primary, `#4a7dff` ×~23, inline-styled arrival prompt in `systemmap-ui.js`
(unreachable by phone rules). Fix: `:root` colour tokens + `.btn-launch` / `.btn-primary` / `.btn-secondary`;
the arrival prompt gets a class. Re-grep the counts — the audit's line numbers predate the 2026-10-22 dead-CSS
removal.

### A8 — `#mainwin` column widths ×6, hand-derived clearances
`client/styles.css:172`, `:187`, `:189-192` (three stage modes × phone/desktop). Clearances derived by hand
from `#xp-bar` (`styles.css:1047+`): `#help` `bottom: 26px` (`:24-30`), `#mw-view-map` `padding-bottom: 16px`
(`:432`, comment `:416-431`), `.brawl-panel`, `#mw-launch` `padding-bottom: 10px`. Fix:
`grid-template-columns: minmax(var(--mw-left-min), 18%) 1fr var(--mw-right, )`; stages set only
`--mw-right`; the form sets `--mw-left-min`; one `--xp-bar-clear` variable used by every clearance. Guard:
`54-launch-gate` (Take off position) and `53-base-menu-idle` still pass; a layout check that `#help`,
`#mw-takeoff-note` and the map actions don't intersect `#xp-bar` on desktop and phone.

### C15 — phone vs desktop sizing in opposite directions
`.lp-*`, `.mission-card`, `.slot-chip` written desktop-size with hand-halved phone copies; `#ship-stats` the
reverse; briefing a third way; Character has no phone rules. Fix: one convention — a `--ui-scale` per form
(`body.dev-phone` etc.) used by these blocks. Measure before/after on phone and desktop (screenshots in the run).

### A7 — three breakpoint systems; vw/vh under forced rotation
`body.dev-*` from `client/src/device.js:46` (`FORM_CLASSES`); `@media (max-width: 760px)` (`styles.css:614`,
briefing + welcome); `@media (max-width: 780px)` (`:721`, wordmark); `4.5vw` (`:741`); intro card `100vw` /
`14vh` (`:44-86`). Upright phones get `body.rot` (`client/src/engine.js:97`) — the page is rotated but media
queries and vw/vh still measure the upright screen. Fix: phone layout only from `body.dev-*`; JS sets
`--game-w` / `--game-h` from `gameW()` / `gameH()` (grep in `engine.js`) and the fixed overlays use them instead
of vw/vh. **Needs a real phone held upright** — the maintainer's live test; headless can't fake `rot` faithfully.

### A6 remainder — staged text reveal written twice
`client/src/welcome.js:26-56` (`welcomeGoTimer`, `typeText(... total: 5000)`, +0.5 s Take-off) vs
`client/src/mainwindow.js:43-47`, `:434-506` (`stagedGoTimer`, same 5000 / 500 ms); CSS `.25s` copies. Fix: one
`stagedReveal(textEl, text, { onShowGo })` helper (new `client/src/staged-reveal.js`) both call; timings as named
constants. Welcome's direct launch (no roam) stays — kept deliberately (§162, audit A6 "Known drift").

**Tests:** the scenarios that cover the base menu and briefing (`53-base-menu-idle`, `54-launch-gate`,
`97-briefing-showcase`, `10-mission-board`, the welcome scenario — grep `welcome` in `client/visual/scenarios/`)
and, with the maintainer's yes, the full visual suite judged by the reliably-passing set (memory: "Visual suite
flaky baseline"). No sim impact → no `22-trace-replay`.

---

## Closing the audit

After the last phase:
1. `docs/plans/2026-10-20-duplication-audit.md`: every row in the summary table says **fixed** (commit) or
   **won't fix** (reason); the top status says "closed YYYY-MM-DD"; §E's order is struck through.
2. This file: status "done", one line per phase with its run id and merge commit.
3. `docs/SUMMARY.md`: the shared modules this plan created (`sim-core/skills.js`, `catalog.js`,
   `fight-spec.js`, `hits.js`, `wire.js`, `account-rules.js`, `staged-reveal.js`, …) are listed where SUMMARY
   maps systems to files.
4. Any new findings the phases surfaced (e.g. the splash `hit` gap in C10) go into a new short audit file, not
   into this one.

| Phase | Items | Size | Main risk / guard |
|---|---|---|---|
| 1 | C1, C2, C3, C4, C7 | M | server contract — server `npm test` |
| 2 | B3, C8 | M | prod ship ids — read prod first; `22-trace-replay` |
| 3 | C5, C6 | S–M | reward ownership — drops tests |
| 4 | B4, B5 rest, C12, C13 | M | replay/netsim — `22`, `36`, socket tests |
| 5 | C9, C10 | M | determinism — `22`, `36`, pinned unit tests |
| 6 | C11 | S | wire format — netsim round-trip test |
| 7 | C16, C17 | S–M | many small edits — `22-trace-replay` |
| 8 | A6, A7, A8, A9, C14, C15 | L | device layout — visual suite (opt-in) + phone live test |
