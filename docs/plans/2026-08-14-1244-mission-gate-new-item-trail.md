# Mission-gated shop rows + the gold "new item" trail inside the shop

**Status:** planned (2026-08-14). Build brief — self-contained; execute without further questions.

## Goal

Two shop-availability changes on top of the level-gate work already in `main` (`stats.minLevel` +
`FACTORY_GATE` in `server/src/catalog_seed.js`, `buyableNow()` in `client/src/shop.js`, the gold "(new)"
marker on the Loadout menu item and the Shop button).

**Part A — a second gate kind, keyed by a cleared SIDE MISSION.** The **Ion engine** (component 16) and
**Nanobot repair** (component 20) stop being on the shelf from day one: they are hidden from the shop and
refused by the server until the player has **cleared the "Research station" side mission** (`side-research`).
Side-mission completion is not persisted anywhere today (`taken_missions` records what was *accepted*,
`players.active_mission_id` records the *active* one; clearing one only banks credits/XP through
`POST /api/games`), so this feature adds the missing record: a `cleared_missions` table, a victory-path
report, exposure to the client next to `activeShip.reachedLevels`, and a one-shot **grandfather migration**
so no existing player silently loses gear they had already earned. Player-visible effect: two premium
components move from "buy them the moment you can afford them" to "clear the research station first", and
the side-mission board grows a **"Cleared"** badge.

**Part B — the gold trail continues inside the shop.** Today "(new)" leads the player *Loadout menu item →
Shop button* and stops. Now it continues onto the shelf: the shop **type tab** whose section still holds an
unseen unlocked item gets a **gold** frame instead of the usual blue, and inside that section the unseen
item's **row** carries the gold frame. **Clicking the row** is what marks the item seen and drops its gold
(not buying it, not merely opening the detail card). Several sections can be gold at once (today's "Level 3"
tier spans hull + weapon; the research tier spans engine + repair).

---

## Decisions (already made — do not re-ask)

1. **Transport for "mission cleared" — a dedicated endpoint.** `POST /api/players/:id/missions/clear`
   `{ missionId }`, called from the side-mission victory path next to `bankRun()` / `depositLoot()`,
   suppressed under replay/playback (`!G.replayMode`), validated against `SIDE_MISSION_IDS`, idempotent
   (`ON CONFLICT DO NOTHING`), and cleared by `resetPlayer` / `server/src/reset.js` alongside
   `taken_missions` so a progress reset re-arms the gate. Trust model is **client-authoritative**, exactly
   like `bankRun` and `depositLoot` — the server takes the client's word that the fight was won. That is the
   existing standard for run rewards; server-sealed mission results remain a separate, later integrity item
   (see `docs/plans/mission-generator.md`).
2. **Existing players are GRANDFATHERED.** A one-shot migration marks every player whose
   `current_progress` has reached the level named **`level-4`** (`SIDE_MISSIONS_MIN_LEVEL` — the point at
   which the side-mission board unlocks) as having cleared `side-research`. Compared by level **NAME** via
   the same `EXISTS (SELECT 1 FROM levels WHERE name = $1 AND id <= current_progress)` predicate
   `reachedLevel()` uses — never a raw id (DECISIONS §95). Idempotent and safe to re-run (ledger row +
   `ON CONFLICT DO NOTHING`), because the whole schema bootstrap runs on **every** server start.
   *This is deliberately fuzzy:* it grants the unlock to players who reached Level 4 but may never have
   actually flown Research Station. Accepted as the kinder error — nobody who could already buy these two
   items loses them off the shelf. Record this honestly in DECISIONS.
3. **A tab's gold is DERIVED, not its own state.** A type tab is gold **iff** its section still holds an
   unseen unlocked item; the tab's gold clears when the **last** unseen row inside it is clicked. No third
   piece of persisted state. Consequence, accepted on purpose: clicking a gold tab and leaving without
   clicking the item leaves the tab gold — the trail keeps pointing at unfinished business. This also covers
   the case where the unseen item sits in the section that is **already active** when the shop opens (the
   shop opens on `hull`, `client/src/shop.js:21`) — there is no tab click to wait for, so the row simply
   shows its gold immediately.
4. **Two independent pieces of MARKER state (a key split), plus one housekeeping key.**
   - `shopSeenNew:<playerId>` — unchanged meaning: *"the shop has been opened since these items unlocked"*.
     Written by `markShopItemsSeen()` on the `open-shop` action; drives the Loadout menu "(new)" and the
     Shop-button "(new)". Those two keep their current behaviour exactly.
   - `shopItemsClicked:<playerId>` — **new**: *"this specific item's row has been clicked in the shop list"*.
     Drives the gold tab + gold row. Without the split, `markShopItemsSeen()` on `open-shop` would write the
     whole gated set and kill the per-item state before a single gold frame could render.
   - `shopMarkerKinds:<playerId>` — **new**, one small housekeeping key: which **gate kinds** the two
     baselines above were taken under. See decision 10.
   Both keys keep `primeShopItemsSeen()`'s **first-sight baseline** semantics: the first time a device sees a
   player, whatever is unlocked **right then** counts as already seen/clicked. Shipping this must not light
   gold frames for gear players have owned for weeks. Both keys are **pruned to what is unlocked now** on
   every write, so a progress reset or a wipe re-arms rather than swallowing the markers.
10. **A NEW gate kind must not fire the markers on already-owned gear — suppress it, don't accept it.**
    Existing devices already hold `shopSeenNew:<playerId>` with the 3 level-gated refs, and
    `primeShopItemsSeen()` only primes a key that is `null`. On the first load after this ships, a
    grandfathered player's gated set jumps **3 → 5** (Ion engine + Nanobot repair become
    gated-and-*unlocked*), so both "(new)" markers would fire for two items that were purchasable all
    along. That symptom was hit and removed once already; it is not an accepted cost. The fix is general,
    not a hardcode of these two ids: the baselines record the **gate kinds** they were taken under
    (`shopMarkerKinds`), and at prime time any row that is gated+unlocked now but carries **none** of the
    previously-known kinds is folded into the baselines as already-seen. Suppresses this release for
    grandfathered players, still lights the trail for a player who clears Research Station later, and leaves
    a genuine pending marker for an already-known kind untouched. Mechanism in step **B2**.
5. **The "Cleared" badge is in scope, for every side mission** — not special-cased to research. It reuses the
   existing `.mc-badge` family in `renderMissionsBoard`. **Badge precedence: `Cleared` > `Active` > `Taken`**
   (the card still renders at most ONE badge). Rationale: "Active" already has a second tell (the whole card
   gets `.mission-card.active`, a gold frame + tint, `client/styles.css:175`) and "Taken" has one too (its
   action row shows **Defer**), whereas cleared-ness has no other signal anywhere on the card. Simplest rule
   that reads correctly.
6. **Gates are HIDDEN, not greyed out** (DECISIONS §108) — that applies to the mission gate too: the row is
   simply absent from the shop list, no teaser.
7. **Gating is on the PURCHASE only.** A looted `side-research`-gated component still deposits into the
   stash and still equips. Same rule as the level gate.
8. **Both gate kinds compose with AND** and flow through **one** predicate on each side: `itemUnlocked()` →
   `buyableNow()` on the client, `buyItem()` on the server. A row may carry `minLevel`, `minMission`, both,
   or neither; every present gate must pass.
9. **Clearing a mission again later is a no-op** — the unlock is permanent (primary key on
   `(player_id, mission_id)`).

---

## Part A — the `minMission` gate

### A1. Catalog: the gate constant + the two rows

`server/src/catalog_seed.js`

- After the `FACTORY_GATE` block (currently lines **39–45**, the `--- Level-gated shop rows ('stats.minLevel') ---`
  comment ending in `export const FACTORY_GATE = 'level-4';`), add a sibling block:

```js
// --- Mission-gated shop rows (`stats.minMission`) ---
// A row with `minMission` is only BUYABLE once the player has CLEARED the side mission with that ID
// (a stable generator id from missions.js — never a raw row id, same discipline as DECISIONS §95).
// Server-enforced in `buyItem`; the client hides the row (DECISIONS §108). A LOOTED copy still equips —
// the gate is on the purchase, not on ownership. Ties the two premium support parts to actually flying
// the research station instead of to a credit balance.
export const RESEARCH_GATE = 'side-research'; // the "Research station" side mission (missions.js FLAVORS, type 'research')
```

- Row **16** (`server/src/catalog_seed.js:89-91`, Ion engine) — add `minMission: RESEARCH_GATE` to its
  `stats` object (keep everything else identical):

```js
  { id: 16, name: 'Ion engine', type: 'engine', weight: 10, price: 6400,
    modelUrlHigh: ENGINE_MODEL, // menu-only item icon (shared by the family)
    stats: { power: 27, maxSpeed: 14, exhaust: { color: 0xffd24d, speed: 14, life: 0.45, size: 0.45, spread: 0.30 }, model: ENGINE_MODEL_CFG,
             minMission: RESEARCH_GATE } }, // gated: sold only after clearing "Research station"
```

- Row **20** (`server/src/catalog_seed.js:95`, Nanobot repair):

```js
  { id: 20, name: 'Nanobot repair', type: 'repair', weight: 8, price: 7000,
    stats: { repairPerTick: 2, intervalSec: 1, maxFraction: 0.90, minMission: RESEARCH_GATE } }, // gated: after "Research station"
```

Leave **15** (Solid-fuel engine) and **19** (Repair drone II) ungated — the mid-ladder stays reachable.

### A2. Schema: the `cleared_missions` table

`server/src/db.js`, in the `migrate()` DDL block, immediately after the `taken_missions` table +
`idx_taken_missions_player` index + the `active_mission_id` ALTER (currently **lines 282–293**):

```sql
    -- Cleared side missions (docs/plans/2026-08-14-1244-mission-gate-new-item-trail.md). `taken_missions`
    -- records what the player ACCEPTED; this records what they actually CLEARED (won). It is the second
    -- content-gate source next to `current_progress`: a catalog row carrying `stats.minMission` is buyable
    -- only once the named mission id is in here. Permanent + idempotent — re-clearing is a no-op.
    CREATE TABLE IF NOT EXISTS cleared_missions (
      player_id  TEXT   NOT NULL,
      mission_id TEXT   NOT NULL,   -- stable side-mission id (missions.js generateMissions)
      cleared_at BIGINT NOT NULL,
      PRIMARY KEY (player_id, mission_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cleared_missions_player ON cleared_missions(player_id);
```

### A3. The grandfather backfill (one-shot, ledger-guarded, with a testable seam)

Still in `server/src/db.js`. Two pieces:

**(a) An exported, idempotent backfill function** — placed next to the other mission helpers (after
`activateMission`, around **line 637**). It is exported so a test can run it directly; the migration ledger
guard lives outside it, because a test cannot un-claim a ledger row:

```js
// One-shot grandfather backfill (DECISIONS §110): players who were already past the side-mission board
// gate when this feature shipped are credited with `side-research` so the two research-gated shop rows
// (Ion engine 16, Nanobot repair 20) do not vanish off their shelf. Compared by level NAME — the same
// EXISTS predicate `reachedLevel` uses (DECISIONS §95), set-based so it is one statement, not N queries.
// Idempotent: safe to run any number of times (ON CONFLICT DO NOTHING). Exported for the migration guard
// in migrate() AND for the server test that pins the backfill.
export async function backfillResearchClear(db = pool) {
  const { rowCount } = await db.query(
    `INSERT INTO cleared_missions (player_id, mission_id, cleared_at)
     SELECT p.id, $1, $2 FROM players p
     WHERE EXISTS (SELECT 1 FROM levels l WHERE l.name = $3 AND l.id <= p.current_progress)
     ON CONFLICT (player_id, mission_id) DO NOTHING`,
    [RESEARCH_GATE, Date.now(), SIDE_MISSIONS_MIN_LEVEL]);
  return rowCount;
}
```

**Import note (do not skip — this is a boot-path `ReferenceError` if you get it wrong).** `server/src/db.js`
has **no** top-level catalog import: its imports are `pg`, `./auth.js`, `./progression.js`
(`server/src/db.js:3-5`), and the catalog reaches it through a **function-local dynamic**
`const { SHIPS, WEAPONS, ... } = await import('./catalog_seed.js');` **inside** `migrate()`
(`server/src/db.js:333`). Extending that destructure would leave `RESEARCH_GATE` **undefined** in
module-scope `backfillResearchClear()` and in `buyItem()` — and it would blow up on the very boot that
claims the ledger row. So: **add a top-level `import { RESEARCH_GATE } from './catalog_seed.js';`** beside
the other imports at the top of `db.js`, and **leave the dynamic import inside `migrate()` exactly as it
is**. Safe: `catalog_seed.js` imports only `./enemy_total.js`, so there is no cycle back into `db.js`.
`SIDE_MISSIONS_MIN_LEVEL` is already defined in `db.js:24`.

**(b) The ledger-guarded call inside `migrate()`** — right after the existing
`intro_level0_progress_shift` block (`server/src/db.js:384-391`), i.e. **after** the `levels` seed so the
`level-4` row exists and can be resolved by name:

```js
  // One-shot: grandfather `side-research` onto everyone already past the side-mission board gate, so the
  // rows that just became mission-gated stay on their shelf. Ledger-guarded (runs once per database) and
  // internally idempotent anyway. MUST run after the levels seed — it resolves the gate by NAME.
  const gf = await pool.query(
    `INSERT INTO migrations_pg (name, applied_at) VALUES ('grandfather_research_clear', $1)
     ON CONFLICT (name) DO NOTHING RETURNING name`, [Date.now()]);
  if (gf.rows[0]) await backfillResearchClear();
```

### A4. Data layer: read + write the cleared set

`server/src/db.js`, with the other side-mission helpers (`getMissionState` at **line 605**,
`takeMission` / `deferMission` / `activateMission` at **613–637**):

```js
// Every side mission this player has CLEARED (ids, oldest first). Second gate source next to
// `reachedLevels`: shipped with the active ship so the client can mirror `stats.minMission` shop gates.
export async function getClearedMissions(playerId, db = pool) {
  const { rows } = await db.query(
    'SELECT mission_id FROM cleared_missions WHERE player_id = $1 ORDER BY cleared_at, mission_id', [playerId]);
  return rows.map((r) => r.mission_id);
}
// Record a side-mission clear (idempotent — the unlock is permanent; re-clearing is a no-op). Mission-id
// validity is checked by the caller (server.js, against generateMissions ids), like take/defer/activate.
export async function clearMission(playerId, missionId) {
  await registerPlayer(playerId);
  await pool.query(`INSERT INTO cleared_missions (player_id, mission_id, cleared_at) VALUES ($1, $2, $3)
    ON CONFLICT (player_id, mission_id) DO NOTHING`, [playerId, missionId, Date.now()]);
  return getMissionState(playerId);
}
```

- **`getMissionState` (line 605) gains `cleared`** so every mission read/mutation response carries it and the
  board badge needs no extra request:

```js
export async function getMissionState(playerId) {
  await registerPlayer(playerId);
  const [tk, pl, cl] = await Promise.all([
    pool.query('SELECT mission_id FROM taken_missions WHERE player_id = $1 ORDER BY taken_at', [playerId]),
    pool.query('SELECT active_mission_id FROM players WHERE id = $1', [playerId]),
    getClearedMissions(playerId),
  ]);
  return { taken: tk.rows.map((r) => r.mission_id), activeMissionId: (pl.rows[0] && pl.rows[0].active_mission_id) || null, cleared: cl };
}
```

- **`buyItem` (line 889-897)** — add the second gate right after the `minLevel` one, same 403 shape:

```js
  const gate = item.stats && item.stats.minLevel;
  if (gate && !(await reachedLevel(reg.currentProgress, gate))) return { ok: false, status: 403, error: 'item locked' };
  // Mission-gated row (`stats.minMission`, catalog_seed.js RESEARCH_GATE): same rule, keyed on a CLEARED
  // side mission instead of campaign progress. Both gates compose with AND; a looted copy still equips.
  const mGate = item.stats && item.stats.minMission;
  if (mGate && !(await getClearedMissions(playerId)).includes(mGate)) return { ok: false, status: 403, error: 'item locked' };
```

- **`getActivePlayerShip` (line 1160-1196)** — add `clearedMissions` to the parallel fetch and the payload,
  next to `reachedLevels`:

```js
  const [progression, sideMissionsUnlocked, levelsReached, clearedMissions] = await Promise.all([
    getProgression(playerId),
    reachedLevel(reg.currentProgress, SIDE_MISSIONS_MIN_LEVEL),
    reachedLevels(reg.currentProgress),
    getClearedMissions(playerId),                                 // cleared side-mission ids → the client's `minMission` shop filter
  ]);
  ...
    reachedLevels: levelsReached,
    clearedMissions, // cleared side-mission ids; the client hides `minMission` shop rows not in it
```

- **`resetPlayer` (line ~476)** — add `cleared_missions` to the per-player delete list so a progress reset
  re-arms the gate:

```js
    for (const t of ['games', 'player_ships', 'stash', 'events', 'taken_missions', 'cleared_missions'])
```

- **`resetAllPlayers` (line 488)** — add `cleared_missions` to the `TRUNCATE` list.

### A5. API: the clear endpoint

`server/src/server.js`, in the side-missions block, right after the `activate` route (**line 252**):

```js
  // Report a side mission CLEARED (won). Client-authoritative like /api/games + /loot — the client tells us
  // it won; the server records it permanently and idempotently. Unlocks `stats.minMission` shop rows.
  app.post('/api/players/:id/missions/clear', missionMutation((pid, mid) => clearMission(pid, mid)));
```

`missionMutation` (line 231) already gives us: 403 `missions locked` before the board unlocks, 400
`missionId required` for a missing id, 400 `unknown mission` for an id outside `SIDE_MISSION_IDS`, and the
fresh `{ taken, activeMissionId, cleared }` body. Add `clearMission` to the `datastore.js` import list at the
top of `server.js` (it re-exports all of `db.js`, so no change to `datastore.js` itself).

**The board READ must ship `cleared` too — without this the badge can never render.** The GET route
(`server/src/server.js:241-246`) does **not** spread the mission state, it picks fields one by one, so
adding `cleared` to `getMissionState` is invisible to it. Clearing is not a board mutation either (the
client clears at the victory overlay, then lands), so a mutation-only `cleared` would be `undefined` on
every landing and page load. Amend the route:

```js
    const state = await getMissionState(req.params.id);
    res.json({ missions: generateMissions(), taken: state.taken, activeMissionId: state.activeMissionId, cleared: state.cleared });
```

### A6. Client: thread the mission id into the fight, report the clear

1. **Carry the id on the descriptor.** `client/src/mainwindow.js:482-494`, `launchMission(m)` — the
   descriptor built by `generateMissions()` has no id (`title` is only the flavor type):

```js
export function launchMission(m) {
  // Carry the mission's stable id INTO the descriptor: the victory path needs to know WHICH side mission
  // was cleared, and `descriptor` only knows its flavor. Copy, don't mutate the cached offer.
  G.activeMission = { ...m.descriptor, missionId: m.id };
```
   Both launch call sites go through `launchMission` (the `#mw-go` handler at `mainwindow.js:450-455` and the
   roam-arrival prompt `G.onMissionArrival` at `mainwindow.js:543-552`), so this one line covers both. The
   spread preserves everything the sim reads off the descriptor (`title`, `center`, `drift`, `phases`,
   `sideMission`, `xpReward`, `enemyTotal`) — check nothing compares `G.activeMission` by identity
   (`sim.js:1058-1075` and `net.js:138` only read fields).

2. **Report it on victory.** `client/src/net.js`, next to `bankRun` (after `bankingDone`, ~line 42):

```js
// The in-flight side-mission "cleared" POST, so the hangar's shop refetch can WAIT for it (see openBay):
// the unlock it grants must be visible in the very first /stash read after the victory, or the gated rows
// stay hidden until the next landing. Never reset to null — an already-settled promise awaits instantly,
// so keeping the last one costs nothing and saves a null dance.
let clearing = null;
export function missionClearDone() { return clearing || Promise.resolve(); }
// Record that a side mission was CLEARED (won). Permanent + idempotent server-side; unlocks any catalog
// row gated on it (`stats.minMission`). Best-effort like bankRun — a dropped request just means the player
// clears it again. Never called under replay/playback (the caller gates on !G.replayMode).
export function reportMissionCleared(missionId) {
  if (!G.playerId || !missionId) return;
  clearing = fetch(API_BASE + `/api/players/${G.playerId}/missions/clear`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ missionId }),
  }).catch(() => {});
}
```

3. **Call it from the victory path.** `client/src/sim.js` `win()` — inside the existing
   `if (!G.replayMode) { ... }` block (**lines 152-163**), replace the last line with:

```js
      // Side missions are repeatable grind: bank credits but do NOT advance the story counter. Campaign
      // levels advance progression as before.
      if (!this.level.sideMission) unlockNextLevel();   // record progress + load the next level
      else if (this.level.missionId) reportMissionCleared(this.level.missionId); // permanent side-mission clear → `minMission` shop unlocks
```
   Extend the existing import at `client/src/sim.js:26` to
   `import { track, currentLevelLabel, bankRun, unlockNextLevel, depositLoot, reportMissionCleared } from './net.js';`.

4. **Make the hangar see it immediately.** `client/src/shop.js` `openBay()` (**line 510-526**) — await the
   in-flight clear before reading the authoritative state, mirroring `bankingDone()`'s use in
   `net.js unlockNextLevel`:

```js
  try {
    await missionClearDone(); // a just-cleared side mission must be committed before this read, or its
                              // gated rows stay hidden (and the "(new)" trail stays dark) until next landing
    const j = await fetchJson(`/api/players/${G.playerId}/stash`);
```
   Add `missionClearDone` to shop.js's existing `./net.js` import.

### A7. Client: mirror the gate in the one predicate

`client/src/shop.js:143-151` — rewrite the gate comment + `itemUnlocked`, keep `buyableNow()` as the single
list predicate:

```js
// ---------- Gated shop rows (`stats.minLevel` / `stats.minMission`) ----------
// A gated row is simply ABSENT from the shop until its gate opens — the maintainer's call: no greyed-out
// teaser (DECISIONS §108). Two gate kinds, both compared by NAME/ID STRING against what the server ships
// with the active ship (DECISIONS §95 — the client never learns a raw level or mission row id):
//   `minLevel`   → campaign progress   → `activeShip.reachedLevels`   (FACTORY_GATE, "Level 3" cleared)
//   `minMission` → a cleared side mission → `activeShip.clearedMissions` (RESEARCH_GATE, "Research station")
// Both must pass. The server refuses the buy anyway (`buyItem`), so this filter is presentation, not
// enforcement, and a LOOTED copy of a gated item still deposits and equips.
const itemUnlocked = (s) => {
  if (!s) return true;
  if (s.minLevel && !((G.activeShip && G.activeShip.reachedLevels) || []).includes(s.minLevel)) return false;
  if (s.minMission && !((G.activeShip && G.activeShip.clearedMissions) || []).includes(s.minMission)) return false;
  return true;
};
// Every row the shop would list right now (the same predicate renderShopPanel filters by, minus the type).
const buyableNow = () => shopCatalog().filter((n) => (n.price ?? 0) > 0 && n.s?.buyable !== false && itemUnlocked(n.s));
```

Note `s.minLevel`/`s.minMission` reach the client because the catalog endpoints ship `stats` verbatim
(`/api/components`, `/api/weapons`) — no serialization change needed.

### A8. Client: the "Cleared" badge on the mission board

`client/src/mainwindow.js`:

- Beside `takenIds` (declared near `activeMissionId`, **line 38**), add
  `let clearedIds = new Set(); // side missions this player has CLEARED (permanent) — drives the board badge`.
- `refreshMissions()` (**lines 464-477**): set `clearedIds = new Set(data.cleared || [])` next to
  `takenIds`, and reset it to `new Set()` in **both** failure/locked branches (line 467 and the `catch` on
  line 473) so a failed fetch cannot leave a stale badge.
- `missionAction()` (**lines 339-348**) applies the mutation response the same way: `clearedIds = new Set(j.cleared || [])`.
- `renderMissionsBoard()` (**lines 261-274**): pass `cleared: clearedIds.has(m.id)` on each side-mission
  card (the campaign card never gets it).
- `missionCard()` (**lines 240-242**) — badge precedence **Cleared > Active > Taken**, still one badge:

```js
function missionCard(c) {
  // ONE badge per card, in this order: Cleared (permanent, no other tell on the card) > Active (the card
  // itself also goes gold, .mission-card.active) > Taken (its action row already shows Defer).
  const badge = c.cleared ? `<span class="mc-badge cleared">${esc(t('ui.mission.cleared'))}</span>`
    : c.active ? `<span class="mc-badge active">${esc(t('ui.mission.active'))}</span>`
    : (c.taken && c.id != null ? `<span class="mc-badge taken">${esc(t('ui.mission.taken'))}</span>` : '');
```

- **CSS** `client/styles.css`, after **line 185** (`.mc-badge.taken`):

```css
  .mission-card .mc-badge.cleared { background: rgba(89,224,160,.28); color: #b8f0d0; } /* cleared = green, distinct from gold "active" / blue "taken" */
```

- **i18n** — English is the source of truth. `client/locales/source.json`, next to `ui.mission.taken`
  (**line 962**):

```json
  "ui.mission.cleared": {
    "source": "Cleared",
    "context": "Mission-board badge — this side mission has already been won at least once. One word."
  },
```
  and `client/locales/ru.json` next to `ui.mission.taken` (**line 241**): `"ui.mission.cleared": "Пройдена",`.

---

## Part B — the gold trail inside the shop

### B1. A pure module for the marker state

The marker state machine now has two marker keys plus a gate-kinds key, first-sight priming, pruning,
newly-gated absorption, per-item clicks and a per-section derivation — and its last bug ("(new)" for
long-owned gear) was exactly a state-machine bug. `shop.js` is
DOM-bound and cannot be imported by `node --test`, so extract the logic into a **pure** module and keep all
`localStorage`/DOM I/O in `shop.js`.

**New file `client/src/shop-markers.js`:**

```js
// Pure state logic for the gold "(new)" trail (no DOM, no storage — see client/src/shop.js for the I/O).
// TWO independent facts, deliberately: (1) has the player OPENED THE SHOP since these rows unlocked
// (drives the Loadout menu + Shop-button "(new)"), and (2) has the player CLICKED this specific row in the
// shop list (drives the gold type-tab + gold row). Both sets are pruned to what is unlocked NOW on every
// write, so a progress reset re-arms the markers instead of swallowing them forever.

// The stable ref string for a normalized catalog row ("component:16" / "weapon:7").
export const refOf = (n) => `${n.kind}:${n.refId}`;
// EVERY gate kind a catalog row can carry. Adding a kind here IS the version bump that lets an existing
// device absorb rows that just became gated (see absorbRefs) — there is no separate epoch number to
// remember. Order is irrelevant; membership is what matters.
export const GATE_KINDS = ['minLevel', 'minMission'];
// The kinds that existed before the kinds key was introduced — what a device with no stored kinds knew.
export const LEGACY_GATE_KINDS = ['minLevel'];
// A row is trailable when it carries ANY gate — everything else has been on the shelf since the shop
// opened and would make the markers permanent noise.
export const isGatedBy = (n, kinds) => !!(n.s && kinds.some((k) => n.s[k]));
export const isGated = (n) => isGatedBy(n, GATE_KINDS);
export const gatedRefs = (items) => items.filter(isGated).map(refOf);
// Rows that are gated+unlocked NOW but carried NONE of the gate kinds this device's baseline was taken
// under — i.e. rows that were freely buyable here until this release gated them. They must be folded into
// an EXISTING baseline as already-seen, or shipping a new gate kind would tell every player that gear
// they have been buying for weeks is "(new)". Deliberately narrow: a row gated by an ALREADY-KNOWN kind
// is untouched, so a genuine pending marker (e.g. the Level-3 tier unlocked but not yet looked at)
// survives the update. Fully general — it keys off gate KINDS, never off item ids.
export const absorbRefs = (items, knownKinds) =>
  items.filter((n) => isGated(n) && !isGatedBy(n, knownKinds)).map(refOf);
// Which shop type-tab a row lives under (weapons are one tab regardless of their weapon type).
export const sectionOf = (n) => (n.kind === 'weapon' ? 'weapon' : n.type);

// No baseline (null) ⇒ nothing is new: a storage hiccup must never INVENT a marker (see primeShopItemsSeen).
export const hasNew = (gated, seen) => !!seen && gated.some((r) => !seen.has(r));
// Unlocked+gated rows whose row has never been clicked. Same fail-closed rule.
export const unseenItems = (items, clicked) =>
  !clicked ? [] : items.filter((n) => isGated(n) && !clicked.has(refOf(n)));
// The type-tabs that still hold an unseen row — the tab's gold is DERIVED from this, it has no own state.
export const unseenSections = (items, clicked) => new Set(unseenItems(items, clicked).map(sectionOf));
// What to persist for a set: the currently-unlocked gated refs that are in it (prunes stale/relocked refs).
export const prune = (gated, set) => gated.filter((r) => set.has(r));
```

### B2. Wire it into `shop.js`

Replace `client/src/shop.js:153-185` (the `"(new)" marker` block) with the two-key version. Keep the
exported names `hasNewShopItems` / `markShopItemsSeen` / `primeShopItemsSeen` — `mainwindow.js` and `main.js`
import them (`mainwindow.js:~30`, `main.js:37`).

```js
// ---------- The gold "(new)" trail (client/src/shop-markers.js holds the pure logic) ----------
// TWO marker keys, on purpose (DECISIONS §111), plus one housekeeping key:
//   shopSeenNew:<id>      "the shop has been OPENED since these rows unlocked" → the Loadout menu "(new)"
//                         + the Shop-button "(new)"; written by markShopItemsSeen() on `open-shop`.
//   shopItemsClicked:<id> "this specific ROW has been clicked in the shop list" → the gold type-tab + the
//                         gold row; written by markShopItemClicked() on `shop-item`.
// One key could not serve both: opening the shop would mark everything seen and kill every gold frame
// before it could render. A third, non-marker key records which GATE KINDS those baselines were taken
// under (shopMarkerKinds), so a release that introduces a gate kind doesn't announce gear the player
// already owns — see primeShopItemsSeen.
const seenKey = () => `shopSeenNew:${G.playerId || 'anon'}`;
const clickedKey = () => `shopItemsClicked:${G.playerId || 'anon'}`;
const kindsKey = () => `shopMarkerKinds:${G.playerId || 'anon'}`; // the gate kinds this device's baselines were taken under
// null = this device has NO baseline yet (never primed). A corrupt value reads as null too, which
// re-primes rather than re-arming — a storage hiccup must not invent a marker that isn't.
const readSet = (key) => {
  try { const raw = localStorage.getItem(key); return raw == null ? null : new Set(JSON.parse(raw)); }
  catch { return null; }
};
const writeSet = (key, refs) => { try { localStorage.setItem(key, JSON.stringify(refs)); } catch { /* private mode */ } };
const gatedRefsNow = () => gatedRefs(buyableNow());

export function hasNewShopItems() {
  if (!(G.activeShip && G.activeShip.shopUnlocked)) return false; // nothing to look at while the shop is shut
  return hasNew(gatedRefsNow(), readSet(seenKey()));
}
export function markShopItemsSeen() { writeSet(seenKey(), gatedRefsNow()); }   // prune-to-unlocked on every write
// Clicking a row in the shop list IS seeing that item (not buying it, not merely opening its detail card).
function markShopItemClicked(kind, refId) {
  const gated = gatedRefsNow();
  const clicked = readSet(clickedKey()) || new Set();
  clicked.add(`${kind}:${refId}`);
  writeSet(clickedKey(), prune(gated, clicked));
}
// Establish the baseline at bootstrap for BOTH keys: whatever is already unlocked the first time we look
// counts as ALREADY SEEN. Without it, shipping a gate to a live game would tell every player who cleared it
// months ago that their long-owned gear is new — and would light gold frames all over a shop they have
// shopped in for weeks. A player short of a gate baselines to the empty set, so clearing it later still
// lights the trail.
//
// TWO cases, both handled here:
//  (a) NO baseline on this device → adopt everything unlocked right now (the original first-sight rule).
//  (b) An EXISTING baseline taken under FEWER gate kinds than the catalog has today → absorb the rows that
//      just became gated and are already unlocked. Without (b), this very release would fire "(new)" on
//      every grandfathered device: their gated set jumps from 3 rows to 5 (Ion engine + Nanobot repair
//      become gated-and-unlocked), and the stored `shopSeenNew` set only holds the 3. Keyed off gate KINDS,
//      not item ids, so it works for the next gate kind too — and it leaves a pending marker for an
//      already-known kind alone.
export function primeShopItemsSeen() {
  // The gate sources must have arrived, or gatedRefsNow() fails closed to [] and bakes in a baseline that
  // says "nothing was unlocked" for a player who is in fact past the gates.
  if (!(G.activeShip && Array.isArray(G.activeShip.reachedLevels) && Array.isArray(G.activeShip.clearedMissions))) return;
  const unlocked = buyableNow();
  const refs = gatedRefs(unlocked);
  const known = readSet(kindsKey()); // null = a device from before this key existed
  const absorb = absorbRefs(unlocked, known ? [...known] : LEGACY_GATE_KINDS);
  const seen = readSet(seenKey()), clicked = readSet(clickedKey());
  const absorbed = (cur) => prune(refs, new Set([...cur, ...absorb])); // (b) fold in the newly-gated rows
  if (seen === null) writeSet(seenKey(), refs);                 // (a) first sight → adopt what is unlocked
  else if (absorb.length) writeSet(seenKey(), absorbed(seen));
  if (clicked === null) {
    // The clicked key is NEW, so every existing device lands here. Inherit the SEEN baseline rather than
    // adopting everything unlocked: a device whose baseline predates the "Level 3" unlock has a genuinely
    // PENDING "(new)" on the menu, and adopting all unlocked refs here would leave the shop with no gold at
    // all — the trail would dead-end on its first step. A truly fresh device (seen === null) still adopts
    // everything unlocked, so the first-sight rule is untouched.
    writeSet(clickedKey(), seen === null ? refs : absorbed(seen));
  } else if (absorb.length) writeSet(clickedKey(), absorbed(clicked));
  writeSet(kindsKey(), GATE_KINDS); // the baselines now know every gate kind the catalog can carry
}
```

**What each device does on the first load after this ships** (all four cases, verified against the code
above — `seen` is read *before* it is rewritten, so the clicked seed uses the pre-write value; the write is
the same expression either way):

| device state at prime | `seen` after | `clicked` after | result |
|---|---|---|---|
| fresh (`seen === null`) | all unlocked gated refs | same | nothing new (the past-gate visual guard's `baseline.length === 3` still holds for **both** keys) |
| grandfathered, shop already opened after "Level 3" (`seen` = the 3 level refs) | 3 + the 2 absorbed | same 5 | no marker, no gold |
| baseline predates the "Level 3" unlock (`seen` = `[]`), mission rows still locked | `[]` (absorb is empty) | `[]` | menu "(new)" **and** the gold trail both fire, agreeing with each other |
| past "Level 3", short of the research gate | unchanged | seeded from `seen` | silent now; clearing Research Station later lights `engine` + `repair` |

**Why this shape and not "just accept one noisy release":** the maintainer hit exactly this symptom on the
previous gate rollout and had it removed — `primeShopItemsSeen()`'s first-sight baseline exists because of
it. The kinds key is the smallest thing that suppresses it **in both directions**:
- a **grandfathered** player (past `level-4`, backfilled by A3) has Ion + Nanobot unlocked at prime time →
  `absorbRefs` returns both → they land in the baseline → **no marker, no gold**. Correct.
- a player **short of the gate** has them locked at prime time → `absorbRefs` returns `[]` → they are not in
  the baseline → clearing Research Station later still lights the whole trail. Correct.
- a player with a **pending** Level-3 marker keeps it: those rows carry `minLevel`, a kind the stored
  baseline already knew, so `absorbRefs` skips them.

Import at the top of `shop.js`:
`import { gatedRefs, hasNew, prune, unseenSections, unseenItems, refOf, absorbRefs, GATE_KINDS, LEGACY_GATE_KINDS } from './shop-markers.js';`

> **Note the `primeShopItemsSeen` guard change:** it now also requires `clearedMissions` to be an array.
> That field ships from `getActivePlayerShip` (step A4), so it is present on every real payload; the extra
> condition just keeps the fail-closed rule honest for an older/partial cached shape.

### B3. Render the gold

`client/src/shop.js` `renderShopPanel()` (**lines 362-372**) and `shopRow()` (**lines 329-337**):

```js
function renderShopPanel() {
  if (selectedShopItem) return renderShopDetail();
  disposeViewer(shopModelViewer); shopModelViewer = null;
  const host = document.getElementById('loadout-panel');
  const all = buyableNow();
  // The gold trail's last leg: a type tab is gold while its section still holds a row the player has never
  // clicked (DERIVED — the tab has no state of its own), and that row is gold inside the section.
  const clicked = readSet(clickedKey());
  const goldSections = unseenSections(all, clicked);
  const goldRefs = new Set(unseenItems(all, clicked).map(refOf));
  const types = SHOP_TYPES.map((tp) => `<button class="lp-type${tp === shopType ? ' active' : ''}${goldSections.has(tp) ? ' new' : ''}" data-act="type" data-type="${tp}">${esc(t(`ui.shop.filter.${tp}`))}</button>`).join('');
  const items = all.filter((n) => (shopType === 'weapon' ? n.kind === 'weapon' : n.type === shopType));
  for (const n of items) n.owned = ownedCount(n.kind, n.refId);
  const list = items.length ? items.map((n) => shopRow(n, goldRefs.has(refOf(n)))).join('') : `<div class="lp-hint">${esc(t('ui.shop.empty_shop'))}</div>`;
  ...
}
```

and `shopRow(n, gold = false)` opens with
`<div class="lp-shop-item${gold ? ' new' : ''}" data-act="shop-item" ...>`.

**Mark on click** — `onLoadoutClick`, the `shop-item` branch (**client/src/shop.js:496**):

```js
  if (act === 'shop-item') {
    // Clicking the ROW is what marks the item seen (the maintainer's call: not buying it, not the detail
    // card) — do it before rendering so returning to the list shows the gold already gone.
    markShopItemClicked(el.dataset.kind, Number(el.dataset.refId));
    selectedShopItem = { kind: el.dataset.kind, refId: Number(el.dataset.refId) };
    renderShopPanel(); return;
  }
```

**CSS** `client/styles.css` — the gold is `#ffcf5a`, the same gold as `.mw-new` (line 1032), the active
mission card (175) and the active badge (184), so the trail reads as one colour end to end. Both rules must
come **after** the blue ones they override:

- after **line 251** (`.lp-shop-item:hover`):
```css
  /* gold "new item" frame: an unlocked row the player has never clicked (client/src/shop-markers.js) */
  .lp-shop-item.new { border-color: #ffcf5a; box-shadow: 0 0 0 1px rgba(255,207,90,.35); }
```
- after **line 273** (`.lp-type.active`, which sets `border-color: #4a7dff`):
```css
  /* a section that still holds an unclicked new item — gold instead of the usual blue, active or not */
  .lp-type.new, .lp-type.active.new { border-color: #ffcf5a; color: #ffe1a0; box-shadow: 0 0 0 1px rgba(255,207,90,.35); }
```

**Perception acceptance criterion (not just geometry).** The gold must be *obviously* different from its
neighbours at a glance: `#ffcf5a` on the panel's `rgba(20,30,55,.5)` background beside blue-grey
`rgba(140,175,255,.2-.25)` borders is a strong hue + luminance contrast, and the extra 1px ring keeps a 1px
border from reading as a subtle tint on a high-DPI screen. **Verify by eye on the screenshots the visual
scenario captures** (`shop-new-tab`, `shop-new-row` below) — a passing computed-style assertion is not proof
that the frame is visible.

**The one combination to actually look at: the ACTIVE + new tab.** `.lp-type.active` also sets a blue
**fill** (`background: rgba(74,125,255,.35)`, `client/styles.css:273`) which the rule above deliberately does
**not** override — so the default `hull` tab, when it holds an unseen row, is a thin gold border on a blue
field: the weakest contrast in this change, and the exact state a returning player sees first (decision 3).
Look at it in `shop-new-tab`. If it does not read as gold at a glance, neutralise the active fill for that
case — `.lp-type.active.new { background: rgba(255,207,90,.18); }` — rather than thickening the border
(the tabs are 12px chips; a 2px border shifts their layout).

---

## Replay / intro impact

Required check (DECISIONS discipline for anything near the sim): **this feature does not touch the sim.**
No damage, collision, hitbox, movement, spawn or gameplay-RNG change; nothing new runs inside `update()`.
The only new call site inside `sim.js` is `reportMissionCleared()` — pure network I/O, placed **inside** the
existing `if (!G.replayMode)` block in `win()` that already suppresses `bankRun` / `depositLoot` /
`unlockNextLevel`, and it can only fire for a `sideMission` descriptor (the Level-0 intro trace is a campaign
level). Deterministic re-sims (the intro cutscene, `?playback` traces, the perf bench) are unaffected.
Still run the guard once: `cd client && node visual/run.mjs 22-intro-replay` (asserts 4 kills + p0..p4 + win).

---

## Tests

### Server — `server/src/server.test.js`

Run: `cd server && npm test` (the pretest drops + recreates a local `spacegame_test`).

Add a block after the existing `---------- Level-gated shop rows ----------` section (**line 1055-1097**),
following the same shape as `shop: the "Level 3" tier is refused before the factory is cleared and sells after`:

1. **`catalog: Ion engine + Nanobot repair carry minMission 'side-research'`** — `/api/components`:
   `comps.find(c => c.id === 16).stats.minMission === 'side-research'`, same for 20; and the mid-ladder stays
   ungated (`15` and `19` have `stats.minMission === undefined`). Also assert 16/20 have **no** `minLevel`
   (the two gate kinds are independent).
2. **`shop: the research tier is refused until "Research station" is cleared, and sells after`** — register a
   fresh pid, `POST /advance` ×4 (progress → `level-4`, the board unlocks), set credits to 50000 directly via
   `pool.query`. Assert `GET /stash` → `activeShip.clearedMissions` is `[]` and both buys return **403**
   `item locked`. `POST /missions/clear { missionId: 'side-research' }` → 200 with
   `cleared: ['side-research']`. Then both buys return 200 and land in the stash, and
   `activeShip.clearedMissions` includes `side-research`. **Also assert the board READ carries it** —
   `GET /api/players/<pid>/missions` returns `cleared: ['side-research']` (and `[]` before the clear). That
   is the outcome test for the "Cleared" badge on the server side: the badge is fed by this route on every
   landing, not by the mutation response, so a route that quietly drops the field must fail here rather than
   only in the visual scenario.
3. **`missions: clear is idempotent, validated and board-gated`** — clearing twice leaves exactly one row
   (`cleared` has length 1); `{ missionId: 'side-nope' }` → 400 `unknown mission`; a missing `missionId` →
   400; a player who has NOT reached `level-4` → 403 `missions locked`.
4. **`shop: the mission gate is on the PURCHASE only`** — with the gate shut,
   `POST /loot { items: [{ kind: 'component', refId: 16 }] }` → the Ion engine lands in the stash, and
   `POST /equip { kind: 'component', refId: 16 }` → 200 (equipped). Mirrors DECISIONS §108 for the new gate.
5. **`migration: the grandfather backfill credits players past the board gate with side-research`** — import
   `backfillResearchClear` from `./db.js` (the level-gate test already does `const { pool } = await import('./db.js')`).
   Player A: `/advance` ×4 (reached `level-4`); player B: `/advance` ×2 (`level-2`). Run
   `await backfillResearchClear()`. Assert A can buy component 16 (200) and `clearedMissions` contains
   `side-research`; B still gets 403 and an empty `clearedMissions`. Run it a **second** time and assert the
   returned `rowCount === 0` and A's `cleared` is still exactly `['side-research']` (idempotent, safe to
   re-run on every boot).
   > **Blast radius — read before writing this test.** `backfillResearchClear()` is **set-based over the
   > whole shared `spacegame_test` database**, so it also credits every *other* test player already past
   > `level-4` (e.g. `gate-l3` from the level-gate test above). That is safe because `node:test` runs the
   > top-level tests in this file **sequentially**, so the mutation happens at a known point in the order —
   > but it does constrain what comes after: **scope every assertion to the fresh ids A and B**, and **no
   > later test in this file may assume a `level-4` player lacks `side-research`**. If a later test needs a
   > research-locked player, it must use a player short of `level-4` (or delete that player's
   > `cleared_missions` row explicitly). Assert `rowCount >= 1` on the first run rather than an exact count,
   > for the same reason.
6. **Reset re-arms the gate** — extend the existing reset test (`server/src/server.test.js:~140-175`) or add a
   short one: clear `side-research`, `POST /reset`, then `activeShip.clearedMissions` is `[]` and buying 16
   is 403 again.

### Client unit — `client/src/shop-markers.test.js` (new)

Run: `cd client && node --test`.

Cover the state machine that shipped a regression once already:
- `gatedRefs` picks up **both** gate kinds (`minLevel`-only, `minMission`-only, both) and ignores ungated rows.
- `hasNew(gated, null) === false` — **no baseline ⇒ nothing is new** (the corrupt-storage rule).
- `unseenItems(items, null)` is `[]` for the same reason.
- Baseline semantics: with `clicked` = all currently gated refs, `unseenSections` is empty (a player who has
  owned this gear for weeks gets no gold).
- A newly unlocked ref (not in `clicked`) puts exactly its section into `unseenSections`, and **two** unseen
  rows in different sections yield **two** sections (hull + weapon, engine + repair).
- `sectionOf` maps every weapon to `'weapon'` and a component to its `type`.
- `prune(gated, set)` drops refs that are no longer unlocked (a progress reset re-arms rather than
  swallowing the marker) and keeps the ones that are.
- **The live-rollout shape — a PRE-EXISTING baseline plus a row that just became gated** (this is the case
  nothing else in the suite covers, and it is exactly what shipping this looks like on a real device). Build
  `items` as the 3 `minLevel` rows plus the 2 `minMission` rows, and a stored baseline of only the 3
  `minLevel` refs with `knownKinds = LEGACY_GATE_KINDS`:
  - **grandfathered** (all 5 rows unlocked, i.e. all in `items`): `absorbRefs(items, LEGACY_GATE_KINDS)`
    returns exactly the 2 mission refs; after folding them in, `hasNew(gatedRefs(items), baseline)` is
    **false** and `unseenSections(items, baseline)` is **empty** — no marker, no gold.
  - **short of the gate** (the 2 mission rows are NOT in `items`, since `items` is `buyableNow()`):
    `absorbRefs` returns `[]`, the baseline stays at 3; then feed the post-clear `items` (all 5) and assert
    `hasNew` is **true** and `unseenSections` holds `engine` + `repair` — the trail still fires when the
    player earns it.
  - **a pending marker survives an absorb**: baseline `[]` (taken before "Level 3" was cleared), `items` =
    the 3 `minLevel` rows now unlocked + the 2 mission rows locked → `absorbRefs` returns `[]` and `hasNew`
    stays **true**. The suppression must not swallow a marker the player genuinely has not seen.
- `GATE_KINDS` contains both kinds and `LEGACY_GATE_KINDS` is `['minLevel']` — pin them, because
  `GATE_KINDS` *is* the version bump for future gate kinds.

### Client visual — `client/visual/scenarios/05-hangar-shop.mjs` (EXTEND, do not rewrite)

Run: `cd client && node visual/run.mjs 05-hangar-shop` (the suite has a flaky baseline of ~6 scenarios —
judge by the reliably-passing set and zero page errors).

The scenario already covers the marker end to end (`:47-62` menu + Shop-button "(new)"; `:155-161` it clears
when the shop opens; `:186-208` the past-gate baseline guard). Insert the new legs **before** the past-gate
block at the end (that block switches `localStorage.playerId`, so anything after it runs as a different
player):

1. **Gold tab + gold row** — **exact insertion point: between `05-hangar-shop.mjs:113` and `:114`.** Line 110
   clicks `[data-act="open-shop"]`, 112-113 assert the menu "(new)" cleared, and **:114 clicks the
   `.lp-type[data-type="weapon"]` tab**. Legs 1-2 need the **default `hull`** section still selected (Heavy
   hull's row, the hull tab), so they go **after the open-shop assertions and BEFORE that weapon-tab click**
   — inserting them after `:114` would run the hull assertions with the weapon section on screen and fail:
   - The `hull` tab (the default section, holding the newly unlocked Heavy hull) has class `new` and
     `getComputedStyle(...).borderColor === 'rgb(255, 207, 90)'`; the `weapon` tab is gold too (HMG + triple
     rocket) — **two sections at once**.
   - An ungated section's tab (e.g. `grab`) is **not** gold — the gold means something.
   - The Heavy hull row (`.lp-shop-item.new`) carries the same gold border; a non-gated row in the same
     section (e.g. Basic hull) does not. `await shot('shop-new-tab')`.
2. **Clicking the row clears its gold** — click the Heavy hull row (opens the detail card), then
   `[data-act="shop-list"]` back to the list: the hull tab is **no longer** gold, the row is no longer gold,
   and the **weapon** tab is **still** gold (per-item state, not per-shop). `await shot('shop-new-row')`.
   Also assert `localStorage['shopItemsClicked:<pid>']` now contains `component:13`.
3. **The mission gate, end to end** — this leg **reloads the page**, so it goes **after** the existing
   death → "Back to Hangar returns to the Main Window" block (`:180-185`) and **before** the past-gate
   baseline block (`:186`). Still on this pid (already advanced ×4, so the board is unlocked): re-open
   Loadout → Shop → the `engine` tab and assert the Ion engine row is **absent** (hidden, not greyed —
   assert no row whose name matches `/Ion engine/`). Then
   `await fetch('/api/players/<pid>/missions/clear', { method: 'POST', headers: {...}, body: JSON.stringify({ missionId: 'side-research' }) })`,
   reload the page, land on the Main Window, open Loadout → Shop: the Ion engine row is now **present** in
   `engine`, the `engine` + `repair` tabs are gold, and the Loadout menu `#mw-loadout-new` was showing again
   before the shop was opened. Also assert the Research Station card on the Missions view carries
   `.mc-badge.cleared`. `await shot('mission-gate-unlocked')`.
4. **Extend the past-gate baseline guard** (`:186-208`) — keep its existing assertions (the `shopSeenNew`
   baseline has the 3 level-gated refs; no `#mw-loadout-new`). That count stays **3** because the fresh
   `visual-past-gate` player has cleared no side mission, so the two `minMission` rows are not unlocked and
   are correctly not in the baseline. **Add:** `shopItemsClicked:visual-past-gate` is primed with the same 3
   refs, and after opening Loadout → Shop **no** `.lp-type.new` and **no** `.lp-shop-item.new` exist anywhere
   — the live-rollout regression guard now covers the gold frames too.

---

## Docs to update

- **`docs/SUMMARY.md`** (bump `**Updated:**`):
  - The **components / player shop ladder** bullet (**~line 574-583**, "Level-gated shop rows
    (`stats.minLevel`)"): retitle to cover **two** gate kinds, describe `stats.minMission` +
    `RESEARCH_GATE = 'side-research'` on Ion engine (16) + Nanobot repair (20), the server enforcement in
    `buyItem`, the client mirror through `activeShip.clearedMissions`, hidden-not-greyed, purchase-only.
  - The **Ion engine / Nanobot repair** entries in the ladder bullet just above it (**~line 570-573**) — note
    they are now mission-gated.
  - The **base-menu / mission board** section (**~line 1105-1113**): the new **Cleared** badge, its
    precedence over Active/Taken, and that `GET /api/players/:id/missions` now returns `cleared`.
  - The **"(new)" marker** section (**~line 1113-1133**): the **two-key split**
    (`shopSeenNew:<playerId>` = shop opened, `shopItemsClicked:<playerId>` = row clicked), the new pure
    module `client/src/shop-markers.js`, the gold tab (derived) + gold row inside the shop, that a **row
    click** marks an item seen, that `primeShopItemsSeen()` baselines **both** keys (a device that has a
    `seen` baseline but no `clicked` one seeds `clicked` **from `seen`**, so a pending menu marker always has
    matching gold in the shop), and the third housekeeping key `shopMarkerKinds:<playerId>` — the gate kinds
    a baseline was taken under, which lets an existing device absorb rows that a new release just made gated
    instead of announcing them as "(new)". State explicitly that **`shopMarkerKinds` is deliberately NOT
    cleared by a progress reset or a marker re-arm**: clearing it would make the next prime re-run
    `absorbRefs` under `LEGACY_GATE_KINDS` and silently swallow a legitimately pending `minMission` marker.
    Do not "fix" it — the same reason a corrupt read of that key errs toward swallowing rather than
    re-arming, unlike the two marker keys.
  - The **Backend / data model** section: the `cleared_missions` table, `POST /api/players/:id/missions/clear`,
    `clearedMissions` on the active-ship payload, `cleared` in the mission state, and the
    `grandfather_research_clear` one-shot migration in the `migrations_pg` ledger list.
  - The **client file map**: `client/src/shop-markers.js` (+ its test).
- **`docs/CHANGELOG.md`** — one bullet under `## 2026-08-14`:
  > **Ion engine + Nanobot repair unlock by clearing "Research station"; the gold "(new)" trail now reaches
  > the shelf.** Second shop-gate kind (`stats.minMission`, catalog `RESEARCH_GATE`) enforced server-side in
  > `buyItem` and mirrored by the client's single `buyableNow()` predicate; side-mission **completion is now
  > persisted** (`cleared_missions` + `POST /api/players/:id/missions/clear`, reported from the victory path)
  > and shipped to the client as `activeShip.clearedMissions`. Players already past the side-mission board
  > gate are **grandfathered** by a one-shot migration so nobody loses gear off their shelf. The mission
  > board shows a **Cleared** badge. Inside the shop, the type tab holding a never-clicked newly unlocked
  > item goes **gold** instead of blue, and so does the item's row — clicking the row clears it; the menu +
  > Shop-button "(new)" keep clearing on shop-open (separate localStorage keys, both first-sight baselined).
  > A baseline taken **before** a gate kind existed absorbs the rows that kind just gated, so grandfathered
  > players are not told that gear they have been buying for weeks is "(new)".
- **`docs/DECISIONS.md`** — the highest entry in this worktree is **§109**; add **§110** and **§111** (if a
  parallel session has taken them by merge time, renumber to the next free slots — the file states that
  convention at line ~2205):
  - **§110 — A cleared SIDE MISSION is a content gate, and existing players are grandfathered into it.**
    Why a second gate kind at all (a story beat, not a credit balance — same reasoning as §108, but the beat
    is optional content the player chooses); why the id string and never a raw row id (§95); why completion
    needed new persistence (`taken_missions` = accepted, not cleared); why the report is client-authoritative
    (parity with `bankRun`/`depositLoot`, server-sealed results deferred); and the **honest fuzziness** of the
    backfill: `reached level-4` ≠ `flew Research Station`, deliberately chosen as the kinder error over
    silently pulling two 6400/7000-credit items off the shelf of players who could already buy them.
  - **§111 — The "(new)" trail needs TWO pieces of state, a tab's gold is derived, and a new GATE KIND must
    never announce itself on gear you already own.** Why one key cannot serve both (opening the shop would
    kill every gold frame before it rendered); why the item's clear trigger is the **row click** rather than
    the purchase (the trail is about *noticing*, not spending); why the tab's gold is **derived** from its
    unseen rows instead of a third "visited" flag (one less state, and it handles the already-active default
    tab with no click to wait for), plus the accepted consequence that visiting a tab without clicking the
    row leaves it gold; and the **`shopMarkerKinds` rule**: a stored baseline records which gate kinds it was
    taken under, and any row that is gated+unlocked now but carries none of those kinds is folded in as
    already-seen. Record *why* it is keyed on gate KINDS rather than on the release's item ids (it works for
    the next gate kind with no edit, and it is narrow enough to leave a genuine pending marker alone), and
    that this is the second time the live-rollout symptom had to be designed out — the first-sight baseline
    alone does not cover a baseline that predates a gate kind.

---

## Out of scope / non-goals (DECISIONS §30)

- **No server-sealed mission results.** The clear report stays client-authoritative, like every other run
  reward. Do not add signing, replay verification or a server-side kill audit.
- **No greyed-out teaser rows, no "locked" tooltip, no hint about *why* an item is missing** (§108).
- **No third gate kind, no generic gate DSL.** Exactly two: `minLevel` and `minMission`.
- **No new gated items** beyond 16 and 20; do not re-tune their prices, stats or the rest of the ladder.
- **No change to the Loadout/Shop-button "(new)" behaviour** — they still clear on shop-open, nothing else.
- **No animation** on the gold frames (no pulse/glow loop) — a static gold border, one colour.
- **No cleared-count / "cleared N times" tracking, no rewards for re-clearing**, no changes to side-mission
  offers, difficulty or payout.
- **No admin-panel surface** for cleared missions.
- **No new model or sound assets** → `client/assets/CREDITS.md` is untouched and no `/publish-itch`
  re-publish is required (nothing content-hashed changes).

---

## Final gate — run before calling it done

1. `cd server && npm test` — all green (Postgres; the pretest recreates `spacegame_test`).
2. `cd client && node --test` — all green, including the new `shop-markers.test.js`.
3. `cd client && node visual/run.mjs 05-hangar-shop` — green, and **look at** `shop-new-tab`,
   `shop-new-row`, `mission-gate-unlocked`: the gold must be unmistakable, not a tint.
4. `cd client && node visual/run.mjs 22-intro-replay` — the sim/replay guard still passes.
5. **Concept sweep** (not just symbols): `rg -n 'minLevel|minMission|shopSeenNew|shopItemsClicked|shopMarkerKinds|gated|\(new\)|cleared_missions|clearedMissions' docs client server` — every hit must describe the code as it is now. In
   particular check `docs/SUMMARY.md`'s shop-ladder + "(new)"-marker prose, the `catalog_seed.js` gate comment
   block, and `client/src/shop.js`'s header comments; stale prose describing a **single** gate kind or a
   **single** localStorage key is a bug in this change.
6. Restart the server against an existing local database and confirm the boot log is clean and
   `migrations_pg` gained exactly one `grandfather_research_clear` row; restart **again** and confirm nothing
   changes (idempotent).
7. Live-test after deploy, **both directions**:
   - **Grandfathered (the silent path):** on a browser profile that has already played past "Level 3" (a
     real pre-update `shopSeenNew` in localStorage), load the new build and land in the hangar — there must
     be **no** Loadout "(new)", **no** gold tab and **no** gold row, and the Ion engine + Nanobot repair must
     still be **on the shelf** (the backfill credited them). This is the regression decision 10 exists for;
     do not skip it just because the tests are green.
   - **Earned (the loud path):** reset a test player → clear Research Station → land in the hangar → the
     Loadout "(new)" is back, the shop's `engine` + `repair` tabs are gold, the Ion engine row is gold,
     clicking the row clears just that row (the `repair` tab stays gold), and the Research Station card on
     the board shows **Cleared**.
