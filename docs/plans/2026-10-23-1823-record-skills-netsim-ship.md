# Record skills, the room knows what you own, and a stashed reward counts as owned

**Status:** planned 2026-10-23. **Feature id:** `2026-10-23-1823-record-skills-netsim-ship`.
**Parent:** Phase 5 (the last) of [`2026-10-20-base-menu-state-and-drift-fixes.md`](2026-10-20-base-menu-state-and-drift-fixes.md)
— audit items **B5** and **B6** in [`2026-10-20-duplication-audit.md`](2026-10-20-duplication-audit.md).
Every `file:line` below was opened and checked on 2026-10-23 against `main` @ `56da2b7`. Re-check the
lines before you edit; the code shape is what matters.

## Goal

This change has three parts, and the third came out of discovery:

1. **B5: `?record` records the ship that was actually flown, skills included.** The dev recorder
   (`beginRecordCapture` / `stopRecordSession` in `client/src/main.js`) saves the loadout and components
   but not the skills. `buildPlayerFor` *does* apply the account's skills to the recorded ship, so a
   `?record` by an account that has spent skill points plays back on a skill-less ship and the replay
   diverges. Both recorders (`?record` and the live session recorder `beginLiveSession`) currently
   repeat the "what was flown" check by hand, and that duplication is how one of them lost the skills.
   Collapse it into one pure helper, `flownBuild()`, that both call.
2. **B6: a netsim room knows the player's account record.** `server/src/netsim/socket.js` already loads
   the account's active ship but drops it before building the room, so `world.activeShip` is null in a
   room. As a result `ownsReward` is always false there and the last-kill reward crate always drops.
   Pass the record through.
3. **New rule: a reward counts as "owned" if it is equipped OR in the stash.** Today `rewardOwned` only
   looks at what is equipped, so moving the Machine Gun (or the Repair drone) to the stash brings the
   crate back on the next Level 1 (or Level 2) clear. With this change the crate stays away while the
   item is equipped or in the stash, and comes back only after the player sells it. The rule applies in
   **both** hosts: the browser World and the netsim room. They read the same record (see Decisions).

What the player sees: after unequipping the Machine Gun into the stash, replaying Level 1 no longer shows
the green reward crate on the last kill, solo or in a `?netsim=1` room. After selling the gun, the crate
comes back.

## Decisions (settled; do not re-ask)

- **B5 scope: one pure `flownBuild()` that both recorders call** (maintainer answer 1b). It lives in
  `client/src/replay.js`, which has no THREE import and is node-testable. The live recorder keeps
  wrapping the result in `duelBuild` exactly as it does today. `?record` does **not** call `duelBuild`
  (`?record&duel` is not a supported combination: `?record` writes `room: null`, so a duel kit without
  its room would be a wrong trace anyway. Not a goal here). The audit's five-place
  `resolvePlayerBuild` consolidation and moving `?record` onto the `session-record` recorder are both
  **out of scope**.
- **`?beam` stays a known gap** (maintainer answer 2). `buildPlayerFor` swaps in the beam weapon
  (`client/src/ship-build.js:61`), and neither recorder records it. Add one doc note that `?record` has
  the same gap as the live recorder. No code change.
- **Reward ownership is NOT recorded in traces** (maintainer answer 3: reward drops during playback do
  not matter). `?playback` / admin playback and the server referee keep using the viewer's account and
  `null` respectively. One line of doc, nothing more. No trace-format change; `TRACE_VERSION` stays 4.
- **"Owned" = equipped (unchanged rule) OR a stash row with the reward's exact `{kind, refId}` and
  `qty > 0`** (maintainer answer 4). Details:
  - The *equipped* half of `rewardOwned` stays exactly as it is: weapon = some mount has
    `weapon === refId`; component = `components.repair != null`, meaning any repair component, not
    necessarily id 12. Changing that is not asked for.
  - The *stash* half matches the exact item. A stashed **Repair drone II (19)** does not count as owning
    **Repair drone (12)**. Only the item the level actually rewards counts.
  - "Sold" needs no special case. `/sell` decrements `qty`, and the stash read filters `qty > 0`, so
    selling the last copy removes the row from the list.
- **Where the sim gets stash data: one new field on the account record, not a second copy.** Both hosts
  already hand `rewardOwned` the same object, the record built by `getActivePlayerShip`
  (`server/src/db.js:1327`):
  - Browser: `G.activeShip` is an alias for `world.activeShip` (`client/src/state.js:173-182`). Every
    full assignment of it comes from `/api/players/:id/active-ship` or from the shop-state
    `activeShip`, and both are `getActivePlayerShip` output (`server/src/server.js:196-200`, `:234-237`).
    The client's assignments are at `client/src/main.js:2274`, `account.js:286`, `net.js:271`,
    `shop.js:492`, `shop.js:605`.
  - Room: `loadShip` *is* `getActivePlayerShip` (`server/src/server.js:673`).
  - So add **`stashRefs: [{ kind, refId }]`** (rows with `qty > 0` only) to `getActivePlayerShip`'s
    return value. It is a light query and does **not** reuse `getStash()`, which runs one catalog query
    per row (`db.js:1043-1049`). `rewardOwned` reads `as.stashRefs`. There is no client-side mirror of
    the stash and no separate `owned` set.
- **Keeping `G.activeShip.stashRefs` fresh.** Most changes to the stash already refresh it:
  - buy / sell / equip / unequip go through `applyShopState` (`shop.js:492`), which replaces
    `G.activeShip`;
  - opening Loadout refetches `/stash` (`shop.js:603-605`);
  - a level advance refetches `/active-ship` (`net.js:270-271`);
  - login refetches (`account.js:285-286`).

  The one path that changes the stash without refreshing the record is the **victory loot deposit**:
  `depositLoot` in `client/src/net.js:160-166` is fire-and-forget. Fix it by chaining a refetch of
  `/active-ship` after a successful POST, and copy **only** `stashRefs` onto the current `G.activeShip`
  (a partial update, the same pattern `refreshAfterRoomBank` uses for `progression` at
  `net.js:114-129`). Copying only that field means it cannot overwrite a newer loadout or progression.
  Also copy `stashRefs` inside `refreshAfterRoomBank`. That is best-effort, because a room deposits its
  own loot server-side and the ordering of that deposit against this fetch was **not verified**. A stale
  value there is harmless: the room itself reads the account fresh from the DB when it is created, and
  the next Loadout open refetches.
- **New DECISIONS entry §166** records the ownership rule (equipped OR exact item in stash; selling
  frees it) and why it is a field on the account record rather than a separate set.

## Verified facts the steps rely on

- `beginRecordCapture` is at `client/src/main.js:1789-1806`; the active-ship check and capture are at
  `:1793-1799`. The module-level lets `recShipId`/`recLoadout`/`recComponents` are at `:196-198`, and
  they are used **only** at `:1793`, `:1798-1799` and `:1813-1814` (grep checked).
- `stopRecordSession` calls `makeTrace` at `main.js:1813-1814` without passing skills.
- `beginLiveSession` repeats the same check at `main.js:1836-1849` (`shipId` at `:1836`, `activeMatches` `:1837`, `duelBuild({…})` `:1844-1849`), then calls
  `sr.begin({ seed, level, shipId, skills, loadout, components, room, dt })` at `:1850-1857`.
- `makeTrace` accepts `skills` (`client/src/replay.js:184`) and writes it (`:199`). Playback passes
  `trace.skills` into `buildPlayerFor` (`main.js:1911`).
- `duelBuild(build)` (`client/src/duel-dev.js:119-122`) returns the same object when the flag is off,
  and otherwise `{ ...build, loadout, components, skills: null }`. It spreads its argument, so extra
  keys (`shipId`) pass straight through.
- In `socket.js:150-157`, `active = await loadShip(playerId)` (`:153`), and then `ship = { shipId,
  loadout, components, skills }` (`:155-156`) with no `activeShip`. `createSimWorld` sets
  `world.activeShip = ship.activeShip || null` (`server/src/sim-host.js:138`).
- `rewardOwned` is at `client/src/sim-core/drops-config.js:39-50`. Its callers:
  - `ownsReward(world, …)` in `sim-core/drops-sim.js:18`, used by `step-enemies.js:171`;
  - `ownsReward(reward)` in `client/src/drops.js:240`, used by `sim.js:497` to decide whether to
    preload the reward model.

  Existing tests are in `client/src/drops.test.js:102-121`.
- Only **`level-1`** (weapon 5, `catalog_seed.js:752`) and **`level-2`** (component 12, `:792`) carry
  `lastKillDrop`. `withDuelRoom` (`sim-core/duel-config.js:31`) and the brawl room (`sim-core/brawl.js:82`)
  remove it.
- The stash table has columns `(player_id, kind, ref_id, qty)`; `getStash` already reads it with
  `qty > 0` (`db.js:1045`).

## Steps

### 1. `flownBuild()` in `client/src/replay.js` (B5)

Add it next to `makeTrace` (around `replay.js:184`):

```js
// What ship was ACTUALLY flown, as the trace must record it: the active ship's persisted
// loadout/components/skills when the built ship IS the active ship, else nulls (the bootstrap built the
// ship's catalog defaults, and playback falls back to those too). The ONE copy of this check — both
// recorders (?record and the live session recorder) call it; the copy that drifted dropped skills (audit B5).
export function flownBuild({ activeShip, shipName, shipByName }) {
  const shipId = ((shipByName && shipByName.get(shipName)) || {}).id ?? 1;
  const active = !!(activeShip && activeShip.ship && activeShip.ship.name === shipName);
  return {
    shipId,
    loadout: active ? activeShip.loadout : null,
    components: active ? activeShip.components : null,
    skills: (active && activeShip.progression) ? activeShip.progression.skills : null,
  };
}
```

`?? 1` keeps the current fallback (`main.js:1793`, `:1836`). Leave `makeTrace` unchanged.

### 2. `?record` uses it (`client/src/main.js`)

- Import `flownBuild` in the existing `replay.js` import line at `main.js:47`.
- Replace the three lets at `:196-198` with one:
  `let recBuild = null; // flownBuild() at record start: { shipId, loadout, components, skills } — rebuilt on playback`
- In `beginRecordCapture`, replace `:1793` and `:1794-1799` (the `recShipId` line, the comment and
  `activeMatches` / `recLoadout` / `recComponents`) with:
  `recBuild = flownBuild({ activeShip: G.activeShip, shipName: G.currentShipName, shipByName: CATALOG.shipByName });`
  Keep a one-line comment saying skills are included now.
- In `stopRecordSession` (`:1813-1814`):
  `const trace = makeTrace({ id, level: REC.level, seed: recSeed, dt: BENCH_DT, ...recBuild, ticks: recTicks });`

### 3. The live recorder uses it too (`main.js:1828-1859`)

Replace the `shipId` line (`:1836`), `activeMatches` (`:1837`) and the `duelBuild({...})` argument object
(`:1844-1849`) with:

```js
const built = duelBuild(flownBuild({ activeShip: G.activeShip, shipName: G.currentShipName, shipByName: CATALOG.shipByName }));
```

Keep the long "THE SHIP THAT WAS ACTUALLY FLOWN" comment. In `sr.begin`, pass `shipId: built.shipId`
(currently the local `shipId`); `skills`/`loadout`/`components` already read from `built`. Live traces
come out exactly the same as before; this step only removes the duplicated logic.

### 4. `stashRefs` on the account record (`server/src/db.js`)

- Add a small helper near `getStash` (`db.js:1043`):
  ```js
  // What the player holds in the stash, as bare refs — the ownership half the sim reads (rewardOwned,
  // DECISIONS §166). Cheap on purpose: getActivePlayerShip runs on every shop mutation and room join.
  async function getStashRefs(playerId) {
    const { rows } = await pool.query('SELECT kind, ref_id FROM stash WHERE player_id = $1 AND qty > 0 ORDER BY kind, ref_id', [playerId]);
    return rows.map((r) => ({ kind: r.kind, refId: Number(r.ref_id) }));
  }
  ```
- In `getActivePlayerShip` (`db.js:1339-1344`), add `getStashRefs(playerId)` to the `Promise.all` and
  return `stashRefs` in the object at `:1345-1359`, right after `components`, with a short comment.

### 5. `rewardOwned` honours the stash (`client/src/sim-core/drops-config.js:39-50`)

```js
export function rewardOwned(activeShip, reward) {
  const as = activeShip; if (!as || !reward) return false;
  // In the stash counts as owned (DECISIONS §166): exactly this item, any qty > 0 (the server lists only
  // those, so a sold-out row is simply absent).
  if ((as.stashRefs || []).some((s) => s.kind === reward.kind && s.refId === reward.refId)) return true;
  …existing weapon / component equipped checks, unchanged…
}
```

Update the comment above the function (and the `drops.js:238-240` comment) to say "equipped or in the
stash". Records without `stashRefs` (old in-memory state, test fixtures) still work through the `|| []`.

### 6. Room passes the record (`server/src/netsim/socket.js:155-156`) (B6)

```js
ship = { shipId: active.ship.id, loadout: active.loadout, components: active.components,
         skills: active.progression && active.progression.skills,
         activeShip: active }; // ownsReward reads it (equipped OR stashed reward → no crate), DECISIONS §166
```

Brawl rooms keep `active = null` (`:153`), so nothing changes for them.

### 7. Keep the client's `stashRefs` fresh after a loot deposit (`client/src/net.js`)

- `depositLoot` (`net.js:160-166`): chain onto the existing fetch:
  ```js
  .then((r) => (r.ok ? fetchJson(`/api/players/${G.playerId}/active-ship`) : null))
  .then((a) => { if (a && G.activeShip) G.activeShip.stashRefs = a.stashRefs; })
  .catch(() => {});
  ```
  Copy only that one field (see Decisions). `fetchJson` is already used throughout `net.js`.
- `refreshAfterRoomBank` (`net.js:117-128`): inside the `.then`, add
  `if (G.activeShip && active.stashRefs) G.activeShip.stashRefs = active.stashRefs;`. This is
  best-effort and the ordering is unverified, as noted in Decisions.

## Replay / intro / determinism impact

- **Level 0 / the 22-trace-replay fixture: not affected.** The fixture is the Level-0 trace (the
  `introTrace` on the `level-0` descriptor, read by `client/visual/scenarios/22-trace-replay.mjs:26-30`).
  Level 0 has no `lastKillDrop`, so the `ownsReward` branch at `step-enemies.js:171` short-circuits on
  `lkd` before it ever reads ownership. **Do not run 22** for this change.
- **Browser play on L1/L2 does change, and that is intended.** When an account has the reward in the
  stash but not equipped, the last kill now skips the green crate and takes the
  `simRandom() < DROP_CHANCE` loot roll, which is one extra seeded draw. This happens only at the last
  kill, after the fight is decided. Live sessions record input plus seed, and playback in the same
  account re-sims the same draw.
- **Server referee (`server/tools/sim-replay.mjs:50-58`, `verify-sessions`):** unchanged. It still
  passes no `activeShip`, so it treats every reward as not owned. That gap already existed for anyone
  with the reward equipped, and SUMMARY already says campaign checks compare credits/XP/kills, never the
  digest (`SUMMARY.md:3868`). The maintainer decided not to record ownership in traces (Decisions).
- **Duel referee: unaffected.** `withDuelRoom` removes `lastKillDrop` (`duel-config.js:31`).
- **B5** only changes traces written by `?record` from now on. Every existing trace plays back the same.
- **Netsim rooms:** the last kill of L1/L2 now follows the owner's account (step 6), which is the fix.

## Tests

Run: `cd client && node --test` and `cd server && npm test` (Postgres; `pretest` recreates
`spacegame_test`).

1. **`client/src/drops.test.js`** (next to the `rewardOwned` tests at `:102-121`), a new test
   `rewardOwned: a reward in the stash counts as owned; sold (absent) does not`:
   - weapon 5 equipped, no `stashRefs` → `true` (equipped, unchanged);
   - only basic gun mounted, `stashRefs: [{kind:'weapon', refId:5}]` → `true` (stash);
   - only basic gun mounted, `stashRefs: [{kind:'weapon', refId:1}]` → `false` (neither);
   - only basic gun mounted, `stashRefs: []` → `false` (sold: the server omits `qty 0` rows);
   - component reward 12: `components:{}` + `stashRefs:[{kind:'component', refId:12}]` → `true`;
     `components:{}` + `stashRefs:[{kind:'component', refId:19}]` → `false` (exact item only);
     `stashRefs:[{kind:'weapon', refId:12}]` → `false` (kind must match).

   The existing tests at `:103-121` must still pass unchanged.
2. **`client/src/replay.test.js`**, a new test `flownBuild + makeTrace round-trip the flown skills`:
   - with an active ship named `'Falcon'`, `progression.skills = { kinetic: 2, maneuver: 1 }`, and a
     loadout/components, plus `shipByName = new Map([['Falcon', { id: 3 }]])`, calling
     `makeTrace({ …, ...flownBuild({…, shipName:'Falcon'}), ticks: [] })` gives `trace.skills`
     deep-equal to that allocation, `trace.shipId === 3`, and the same loadout/components;
   - with `shipName: 'Other'` (not the active ship) → `loadout`, `components` and `skills` are all
     `null`, and `shipId` comes from the map or falls back to `1`;
   - with `activeShip: null` → all nulls, no throw.

   This guards B5: had the live recorder and `?record` shared this helper, the skills field could not
   have gone missing from one of them.
3. **`server/src/netsim/socket.test.js`**, a new test `the room is handed the ACCOUNT record (ownsReward reads it)`:
   start a separate server with `attachNetsim(server, { tickets, loadShip: async () => REC, createRoomFn: spy })`.
   Follow the `listen()` helper pattern in `server/src/netsim/socket-brawl.test.js:18-32`, or make a
   copy of it. `REC` is a minimal record with `ship.id` and `stashRefs`; `spy` records its argument and
   delegates to the real `createRoom`. Open a socket with a ticket and `level=level-1`, wait for
   `welcome`, and assert `spy.args.ship.activeShip === REC`. A second assertion: a `brawl=2` join gets
   `activeShip` unset (brawl skips the account read). Close the sockets and server in `after`.
4. **Sim-host last-kill test**, a new file `server/src/reward-drop.test.js`. It is pure, no DB; it runs
   under `npm test`'s `node --test` glob, so it needs no wiring. Build a world with
   `createSimWorld({ levelName: 'level-1', seed: 7, ship: { activeShip } })`, set
   `world.kills = world.enemyTotal - 1`, spawn one enemy via
   `spawnEnemy(world, world.catalog.enemyShips.find((s) => s.name === 'pirate gunner'))` (import from
   `client/src/sim-core/ship-entity.js`, as `server/src/ally-sim.test.js:33,162` does), set its
   `hp = 0`, call `stepEnemyDeaths(world)` (`client/src/sim-core/step-enemies.js`), and count
   `world.drops.filter((d) => d.special)`. Cases:
   - `activeShip` absent → **1** special drop (today's behaviour; proves the test reaches the branch);
   - `{ loadout: { mounts: [{ weapon: 5 }] } }` → **0**;
   - `{ loadout: { mounts: [{ weapon: 1 }] }, stashRefs: [{ kind: 'weapon', refId: 5 }] }` → **0**;
   - same as the previous case but `stashRefs: []` → **1** (sold).

   If `enemyTotal` is 0 for `level-1` in the built world, assert that first and fix the setup; don't
   weaken the test. `isLastKillDrop` needs `enemyTotal > 0`.
5. **`server/src/server.test.js`**, a new test in the shop section (around `:1038`):
   `active-ship lists stash refs; a sold-out row drops off`. Use a fresh player: deposit
   `[{kind:'component', refId:2}]` via `/loot`, then `GET /api/players/<id>/active-ship` →
   `stashRefs` contains `{kind:'component', refId:2}`. Unlock the shop the way the neighbouring sell
   tests do (`:1098-1112`), sell it via `/sell`, and the `stashRefs` in the response
   (`body.activeShip.stashRefs`) no longer contains it.

**Visual:** none is required. No scenario asserts reward ownership or exercises `?record`
(grep checked: `50-warm-completeness` explicitly does not cover the reward drop). As an optional smoke
test for the larger `activeShip` record, run `node visual/run.mjs 12-sell-confirm` from `client/`.
**Do not** run the full suite, and do not run 22 (see above).

**Live test (stage 9, maintainer):**
- Level 1 is **not replayable in normal campaign play**, so the reachable live case is **Level 2**: with
  the Repair drone (12) in the stash and the repair slot empty, clearing Level 2 shows no green crate on the
  last kill; sell the drone and replay: the crate is back. Repeat once with `?netsim=1`.
- Level 1 via dev flags: `?netsim=level-1` (room) or `?record=1&level=1` (solo), with the Machine Gun in the
  stash → no crate; sold → the crate is back.
- Known harmless race: after a victory, `loadAdvancedLevel`'s full `/active-ship` refetch (`net.js`) may land
  after the `depositLoot` refetch and restore the pre-deposit `stashRefs`, so a just-looted reward can drop
  once more until the next Loadout open.
- On an account with spent skill points, run `?record=1&level=1`, Stop & Save, then Play it: the
  playback ship shows the same hull/shield as the recorded one.

## Docs to update

- **`docs/SUMMARY.md`**
  - `:6` **Updated:** add today's entry ("Phase 5: `?record` captures skills via `flownBuild`; a room
    gets the account record; a reward in the stash counts as owned").
  - `:646-651` (`?record` "Known gap (audit B5, open)"): replace it with "captures the flown ship via
    `flownBuild()` (`replay.js`), skills included — the same helper the live recorder uses", plus the
    note "`?beam` is not captured (same known gap as the live recorder)".
  - `:1950-1951` (L1/L2 reward drops): the ownership rule becomes "equipped (L1: a mount with
    `weapon === 5`; L2: `components.repair` filled) **or** the exact reward in the stash
    (`activeShip.stashRefs`); selling it brings the crate back".
  - `:3780-3782` (`?beam` hole): add "the dev `?record` recorder has the same hole".
  - `:3868` neighbourhood: add the one line saying reward ownership is not recorded in traces, so
    playback uses the viewer's account and the referee treats every reward as unowned. Maintainer:
    drops in playback do not matter.
  - `:3705-3708` (`getActivePlayerShip` fields): add **`stashRefs`** (`[{kind, refId}]`, `qty > 0`).
  - `:4742-4746` (netsim "Known gap (audit B6, open)"): rewrite as "…and the account record itself
    (`activeShip`), so `ownsReward` in a room sees what the player has equipped or stashed".
- **`docs/CHANGELOG.md`**: one bullet under `## 2026-10-23`, starting with the bold phrase
  **Drift-fix Phase 5: `?record` keeps skills, rooms know what you own, a stashed reward counts as
  owned**. It covers `flownBuild` shared by both recorders (B5), `socket.js` passing `activeShip` (B6),
  `stashRefs` on the active-ship record plus `rewardOwned` equipped-OR-stash, and the loot-deposit
  refresh.
- **`docs/DECISIONS.md`**: **§166 "A reward in the stash is owned"**. Check that the number is still
  free at merge; parallel branches collide. It records the rule (equipped OR exact item in stash; selling
  frees it; the equipped component half stays "any repair"), why it is a field on the one account record
  (both hosts already consume `getActivePlayerShip`, so there is no second copy to drift), and that
  ownership is deliberately not recorded in traces.
- **`docs/plans/2026-10-20-base-menu-state-and-drift-fixes.md`**: header `:5` and Phase 5 `:325` →
  **Done 2026-10-23**, link to this plan, and note the scope extension (stash ownership).
- **`docs/plans/2026-10-20-duplication-audit.md`**: `:7-8`, the table rows `:72-73`, and §B5/§B6
  (`:252-269`) → mark B5 (the `?record` part; the five-place `resolvePlayerBuild` stays open) and B6 as
  **Fixed 2026-10-23** (this plan). Add them to the "Fixed-by index" `:16-19`; the orchestrator fills in
  the hash.

**Final gate (implementer):**
`grep -rn "recShipId\|recLoadout\|recComponents\|audit B6, open\|audit B5, open" client/src server/src docs/SUMMARY.md`
must return nothing.

## Out of scope / non-goals

- The audit's `resolvePlayerBuild` (five places) and moving `DUEL_LOADOUT` into sim-core.
- Recording reward ownership (or `stashRefs`) in traces. Changing the referee. Any `TRACE_VERSION` bump.
- Fixing the `?beam` recording gap. Making `?record` honour `?duel`.
- Changing the *equipped* half of `rewardOwned`, e.g. making "any repair" an exact-id check.
- Any change to the server's force-install of the reward on victory, or to `getStash`.
- No model/asset/content-hash changes, so no `/publish-itch` step.
