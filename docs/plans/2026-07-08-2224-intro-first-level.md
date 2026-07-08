# Intro first level ("Level 0") — a gentle, one-at-a-time opening level

**Feature ID:** 2026-07-08-2224-intro-first-level
**Status:** ready to implement
**Type:** campaign content + a one-shot data migration (server + client docs)

## Goal

Add a brand-new **gentle intro level** that becomes the very first level every new player plays.
Enemies appear **one at a time** via the normal staggered-spawn system: 3 basic pirates in sequence
(kill one → the next warps in), then a single **rocket pirate** finale — `enemyTotal 4`, **no boss**.
It is a real, non-skippable campaign level written exactly like the others, so the maintainer can PLAY
it and record a clean playthrough for **Step 2** (the intro cutscene, already built on the parked
branch `feature/2026-07-08-2007-level-0-intro-cutscene` — **do not touch that branch or its files**).

Player-facing, the intro is labeled **"Level 0"**; the existing campaign keeps its **"Level 1"–"Level 4"**
labels, text, rewards and briefings **unchanged** (they just move down one row/id). Existing players are
migrated **+1** so they stay on their exact same content (now relabeled by id, not by title); new players
start on the intro.

## Background: how levels are ordered (read before editing)

- Levels live in a DB table; **ordering is purely `levels.id`** (AUTOINCREMENT / BIGSERIAL, i.e. seed
  insertion order). Advance = `SELECT MIN(id) FROM levels WHERE id > current_progress`
  (`server/src/db.js:230-233`, `server/src/db_postgres.js:397-401`). There is **no** `sort_order` column
  and **no** client-side ordering.
- Seeding is `INSERT ... ON CONFLICT(name) DO UPDATE SET descriptor = ...` keyed by **`name`**
  (`db.js:49-51`, `db_postgres.js:230-235`). On a **fresh** DB, array order = id order. On the **existing
  prod DB**, existing names keep their ids (only their descriptor is rewritten); a **new name is appended**
  with `max(id)+1`.
- `current_progress` is the FK; new-player / reset baseline is hardcoded `= 1`
  (`db.js:104`, `db_postgres.js:299`, schema `DEFAULT 1`).
- **Consequence (the whole trick):** we keep the seed **names `level-1`..`level-4` fixed** (so ids 1-4 are
  stable) and **shift their descriptor CONTENT down by one**, then **append a new name `level-5`** (gets
  id 5 on prod). The intro takes id 1 and is therefore first. Because content (title, textKeys, rewards,
  briefings, actions) travels **with** the descriptor, the campaign's narrative/reward chain is preserved
  exactly, one id lower.

## Decisions (all settled — do not re-ask)

- **Q1 — Label "Level 0"; campaign keeps "Level 1"–"Level 4".** Implement via content shift with the seed
  NAMES fixed (see the shift table below). Intro is a **new** descriptor under name `level-1`.
- **Q2 — One-time `current_progress = current_progress + 1` migration** on BOTH backends, so mid-progression
  players stay on their exact content. New-player / reset baseline **stays `= 1`** (which is now the intro).
- **Q3 — Non-skippable, normal first campaign level.** No skip UI (Step 2 owns the cutscene/skip).
- **Q6 (NEW) — The intro AUTO-LAUNCHES into the fight on first launch: no welcome screen, no "Take off",
  no menu gate.** The ship is visible + controllable immediately. Gated to the intro **only**
  (`level.name === 'level-1'`, served only while `current_progress === 1`); Level 1+ is unchanged. This
  skips the welcome take-off flow, so the intro flies the **default player ship** — accepted, and moot
  since the welcome ship-picker was already removed (see Step 6c). See Step 6 for the bootstrap change.
- **Q4 — No reward on the intro.** The Machine-Gun `lastKillDrop` stays on old-L1 content (now id 2 =
  "Level 1"); the repair-drone stays on old-L2 content (now id 3). The intro has **no** `lastKillDrop`.
- **Q5 — Reuse the `home-system` map; no briefing.** Mirrors the current level-1 so new players land on the
  welcome screen (not the Main Window) and drop straight into the gentle fight. Add a one-line intro
  **victory** text (EN + RU).

## The seed shift table (authoritative)

| Seed `name` (stable id) | New content | `descriptor.title` | Reward / briefing carried |
|---|---|---|---|
| `level-1` (id 1) | **NEW intro** (this plan) | **"Level 0"** | none; new `level.0.victory` text |
| `level-2` (id 2) | old **level-1** content verbatim | "Level 1" | MG `lastKillDrop {weapon,5}`; no briefing |
| `level-3` (id 3) | old **level-2** content verbatim | "Level 2" | drone `lastKillDrop {component,12}`; MG-replace briefing |
| `level-4` (id 4) | old **level-3** content verbatim | "Level 3" | first-boss; drone-install briefing |
| `level-5` (id 5, **NEW name**) | old **level-4** content verbatim | "Level 4" | Second Boss; `unlockShop` briefing |

`enemyTotal` per id after the shift (via `enemyTotalFromPhases`): id1 **4**, id2 **14**, id3 **17**,
id4 **21**, id5 **22**.

Nothing in the campaign descriptors' text/titles/keys changes — you are **moving whole descriptor objects
down one array slot** and **renaming only the seed `name` field** so ids stay stable. Only the intro object
is authored new.

---

## Steps

### 1. Rewrite the `LEVELS` array in `server/src/catalog_seed.js` (385-549)

Replace the whole `LEVELS = [ ... ]` array (lines **385-549**, ending just before the
`for (const l of LEVELS) l.descriptor.enemyTotal = ...` line at 552) so that:

- The **first** entry is `{ name: 'level-1', descriptor: { ...intro... } }` (authored below).
- The entry currently `name: 'level-1'` (old L1, the fighters/rocketeers no-boss level) is renamed
  **`name: 'level-2'`** — **descriptor content untouched** (keep `title: 'Level 1'`, `level.1.victory`,
  the `lastKillDrop: { kind: 'weapon', refId: 5 }`, all phases).
- The entry currently `name: 'level-2'` → **`name: 'level-3'`** (content untouched: `title: 'Level 2'`,
  the MG-replace briefing `level.2.briefing`, `level.2.victory`, `lastKillDrop {component,12}`).
- The entry currently `name: 'level-3'` → **`name: 'level-4'`** (content untouched: `title: 'Level 3'`,
  drone-install briefing `level.3.briefing`, `level.3.victory`).
- The entry currently `name: 'level-4'` → **`name: 'level-5'`** (content untouched: `title: 'Level 4'`,
  `unlockShop` briefing `level.4.briefing`, `level.4.victory`).

**Only the `name:` strings change on the four existing entries; every other field stays byte-for-byte.**

Prepend this new intro entry as the first element:

```js
export const LEVELS = [
  // Level 0 — the intro patrol. Gentle, non-skippable FIRST level for new players (the campaign's
  // "Level 1"-"Level 4" moved down one id — see docs/plans/2026-07-08-2224-intro-first-level.md).
  // Enemies warp in ONE AT A TIME (maxConcurrent 1) so it plays as a calm, recordable opener.
  // No boss, no reward, no briefing. On first launch the client auto-launches this level straight into
  // the fight (no welcome screen / Take-off) — see the client bootstrap change in Step 6.
  {
    name: 'level-1', descriptor: {
      title: 'Level 0', map: 'home-system',
      phases: [
        {
          name: 'wave-1', // three basic pirates, one at a time (kill one -> the next warps in)
          spawn: { maxConcurrent: 1, total: 3, pool: [{ ship: 'Basic pirate ship', chance: 100 }] },
          advanceWhen: { kills: 3 }
        },
        {
          name: 'finale', // a single rocket pirate to close it out
          spawn: { maxConcurrent: 1, total: 1, pool: [{ ship: 'basic rocket pirate', chance: 100 }] },
          advanceWhen: { allCleared: true }
        },
        { name: 'victory', event: 'win', delay: 2, textKey: 'level.0.victory', text: 'First patrol clear, Sentinel.' },
      ]
    }
  },
  // Level 1 (old content, now id 2) — beginner-friendly: gentle ramp, no boss.
  { name: 'level-2', descriptor: { /* ...UNCHANGED old level-1 descriptor: title 'Level 1', lastKillDrop weapon 5, level.1.victory... */ } },
  // Level 2 (old content, now id 3) — medium; MG-replace briefing + repair-drone drop.
  { name: 'level-3', descriptor: { /* ...UNCHANGED old level-2 descriptor: title 'Level 2', level.2.briefing, lastKillDrop component 12, level.2.victory... */ } },
  // Level 3 (old content, now id 4) — the full fight; drone-install briefing + Sector boss.
  { name: 'level-4', descriptor: { /* ...UNCHANGED old level-3 descriptor: title 'Level 3', level.3.briefing, first pirate boss, level.3.victory... */ } },
  // Level 4 (old content, now id 5) — "Find the pirate base"; unlockShop briefing + Second Boss.
  { name: 'level-5', descriptor: { /* ...UNCHANGED old level-4 descriptor: title 'Level 4', level.4.briefing, second pirate boss, level.4.victory... */ } },
];
```

Leave `for (const l of LEVELS) l.descriptor.enemyTotal = enemyTotalFromPhases(l.descriptor.phases);`
(line 552) exactly as-is — it re-stamps `enemyTotal` for all five automatically (intro = 4).

Verify ship names against the SHIPS seed: `'Basic pirate ship'` and `'basic rocket pirate'` are the
existing enemy names used by the current level-1 (see the old level-1 phases). Do not invent new ships.

### 2. Add the intro victory string to i18n (EN source + RU)

- `client/locales/source.json` — after the `"level.1.victory"` entry (line **139**), add:
  ```json
  "level.0.victory": { "source": "First patrol clear, Sentinel.", "context": "Victory overlay subtitle after the intro level (Level 0), the gentle opening patrol. Short, warm, encouraging. 'Sentinel' is the player's in-game title — keep it." },
  ```
- `client/locales/ru.json` — after the `"level.1.victory"` entry (line **139**), add:
  ```json
  "level.0.victory": "Первый патруль зачищен, Страж.",
  ```
  (Keep JSON comma placement valid.)

The English `text` fallback is also inlined in the descriptor (`text: 'First patrol clear, Sentinel.'`)
so the overlay works even before translations load (`sim.js:95` stores `winTextKey` + `winText`).

### 3. SQLite one-time progress bump — new migration `server/src/migrations/022_intro_level0_shift.js`

Migrations run **before** `seedCatalog` (`db.js:19-22`) and SQLite has **FK enforcement off**
(`migrations/006` comment), so bumping a maxed player from id 4→5 before the new `level-5` row is seeded
is safe. Create:

```js
// 022 — intro "Level 0": shift every existing player's progress +1. A new gentle intro level is
// prepended (seed name 'level-1', title "Level 0"); the campaign's descriptors moved down one id, so a
// player's OLD content now lives at their current id + 1. Bumping keeps every existing player on their
// exact same content (just relabeled by id); new players keep the DEFAULT 1 = the intro.
// One-shot by construction: the migration runner applies each file at most once (PRAGMA user_version).
// See docs/plans/2026-07-08-2224-intro-first-level.md.
export const up = (db) => {
  db.exec('UPDATE players SET current_progress = current_progress + 1;');
};
```

No schema change — just the data bump. On a fresh test DB the players table is empty when this runs
(0 rows affected); new registrations then get `DEFAULT 1` = the intro. Nothing else in db.js changes
(baseline `current_progress = 1` at line 104 is correct — that is now the intro).

### 4. Postgres parity — idempotent one-shot bump in `server/src/db_postgres.js`

Postgres uses an **idempotent bootstrap** (no version tracking) and **enforces the FK**, so:
- the bump **must run AFTER the levels are seeded** (so `level-5` / id 5 exists — otherwise bumping a
  maxed player to id 5 violates `current_progress REFERENCES levels(id)`), and
- it must be **guarded so it runs exactly once** (a bare `+1` on every startup would keep incrementing).

Add a tiny one-shot ledger + guarded bump. In the `migrate()` schema `pool.query(\`...\`)` block, alongside
the other `CREATE TABLE IF NOT EXISTS` statements (before the closing backtick at line **191**), add:

```sql
    -- one-shot migration ledger (Postgres has no versioned migrations; this records applied one-offs).
    CREATE TABLE IF NOT EXISTS migrations_pg (
      name       TEXT   PRIMARY KEY,
      applied_at BIGINT NOT NULL
    );
```

Then, **after the levels seed loop** (after line **235**, i.e. after `for (const l of LEVELS) { ... }`,
and before the sounds seed) add the guarded bump — placed here so `level-5` already exists:

```js
  // One-shot: intro "Level 0" progress shift (+1). Mirrors SQLite migration 022. ON CONFLICT DO NOTHING
  // makes it run exactly once; RETURNING tells us whether this run is the one that claimed it. Runs AFTER
  // the levels seed so the new final level (id 5) exists and the FK on current_progress validates.
  const shift = await pool.query(
    `INSERT INTO migrations_pg (name, applied_at) VALUES ('intro_level0_progress_shift', $1)
     ON CONFLICT (name) DO NOTHING RETURNING name`, [Date.now()]);
  if (shift.rows[0]) {
    await pool.query('UPDATE players SET current_progress = current_progress + 1');
  }
```

Keep this in sync conceptually with the SQLite migration (backend parity — the tests only exercise
SQLite, so the Postgres path must be reviewed by hand).

### 5. Update server tests

Server tests run on **SQLite** (`server && npm test`). Fix the now-shifted expectations:

- **`server/src/enemy_total.test.js:42`** — change `EXPECTED` to:
  ```js
  const EXPECTED = { 'level-1': 4, 'level-2': 14, 'level-3': 17, 'level-4': 21, 'level-5': 22 };
  ```
  (The sim-oracle + formula assertions in the same test then verify each stamped `enemyTotal`; the intro's
  4 = 3 + 1.)

- **`server/src/server.test.js:95-124`** ("progress: current level is level-1, and advancing unlocks the
  next levels") — the chain now has **five** levels. Update so: `level-1` (intro) → advance → `level-2` →
  `level-3` → `level-4` → `level-5` (now the last; the extra `advance` is the no-op), and the final
  `reg.currentProgress` is **5**. Add the one extra advance+assert step and change the last-level asserts
  from `level-4` to `level-5`.

- **`server/src/server.test.js:125-140`** (reset test) — `clearCampaign` does 4 advances; from id 1 that
  now lands on id 5 (`level-5`, the last level, which still fires `unlockShop`). Change the two `level-4`
  assertions to **`level-5`**, and the post-clear `reg.currentProgress` expectation (if asserted) to
  **5**. Reset still returns to baseline `level-1` (the intro) — keep those `level-1` / `currentProgress
  1` assertions.

- **`server/src/server.test.js:385-411`** ("levels: level-1 (easy, no boss)...", the `l1`/`l2`/`l3`/`l4`
  block runs to ~411 including the `l4 = getJson('/api/levels/level-4')` + `unlockShop` asserts at
  401-403) — the content moved, so rewrite the per-name checks to the shifted mapping:
  - `level-1` is now the **intro**: `l1.descriptor.map === 'home-system'`,
    `l1.descriptor.phases[0].advanceWhen.kills === 3` (was 6),
    `l1.descriptor.phases[0].spawn.pool[0].ship === 'Basic pirate ship'`,
    `l1.descriptor.phases[0].spawn.maxConcurrent === 1`, `l1.descriptor.enemyTotal === 4`,
    `l1.descriptor.title === 'Level 0'`, `l1.descriptor.phases.at(-1).event === 'win'`, and the no-boss
    assertion `!JSON.stringify(l1.descriptor).includes('first pirate boss')` still holds.
  - `level-2` is now **old level-1** (no boss): assert its finale is rocketeers, e.g.
    `l2.descriptor.phases.at(-2).spawn.pool[0].ship === 'basic rocket pirate'` and it does **not** include
    a boss; `l2.descriptor.title === 'Level 1'`.
  - `level-3` is now **old level-2** (mini boss): `l3.descriptor.phases.at(-2).spawn.pool[0].ship ===
    'pirate mini boss'`; `title === 'Level 2'`.
  - `level-4` is now **old level-3** (Sector boss): `phases.at(-2).spawn.pool[0].ship === 'first pirate
    boss'`; `title === 'Level 3'`.
  - `level-5` is now **old level-4** (Second Boss + unlockShop): the existing `l4` block fetches
    `/api/levels/level-4` (line 401) and asserts the `second pirate boss` finale + the `unlockShop` action
    (line 403). **Change that fetch to `/api/levels/level-5`** and keep those two asserts (they now belong
    to id 5); `title === 'Level 4'`.
  Rename the test title string accordingly (e.g. "levels: intro Level 0 (no boss), then Level 1-4 served
  in order").

- **`server/src/server.test.js:158-197`** ("briefing: advancing into level-2 returns its message and swaps
  the basic gun for the Machine Gun") — **the whole briefing/reward chain shifts down one advance** because
  the FIRST advance is now intro (id 1) → id 2 (old-L1 content, which has **no** briefing). The existing
  test asserts `adv.briefing.textKey === 'level.2.briefing'` on the **first** advance (line ~167), which
  would now be `null` and throw. Restructure it to the intended new chain (do **not** give the intro a
  briefing — the intro correctly has none):
  - **1st advance** (intro id 1 → id 2): `adv.advanced === true`, **`adv.briefing === null`** (no briefing
    yet; the gun is still weapon 1 — assert `active-ship` gun still `weapon === 1` here). Replace the old
    "clearing level-1 advances to level-2 → runs its briefing" block + its `level.2.briefing`/`/machine
    gun/i`/weapon-5 asserts with this no-briefing assert.
  - **2nd advance** (id 2 → id 3): `adv.advanced === true`, `adv.briefing.textKey === 'level.2.briefing'`,
    `assert.match(adv.briefing.text, /machine gun/i)`; **then** assert the active ship's gun is now the
    Machine Gun (`weapon === 5`), the rocket is untouched (`weapon === 3`), and no basic kinetic remains
    (the replaceWeapon MG action fires on THIS advance now). Move the old "gun is now weapon 5" assertions
    down to follow this advance.
  - **3rd advance** (id 3 → id 4): `adv.advanced === true`, `adv.briefing.textKey === 'level.3.briefing'`;
    then `active-ship.components.repair === 12` (repair drone installed), `hull === 1`, `engine === 5`.
  - **4th advance** (id 4 → id 5): first assert `shopUnlocked === false` (still locked on id 4);
    `adv.advanced === true`, `adv.briefing.textKey === 'level.4.briefing'`; then
    `active-ship.shopUnlocked === true` — update the assertion message from "reaching level-4 unlocked the
    shop" to "reaching the last level unlocked the shop".
  - **5th advance** (id 5 → n/a): `adv.advanced === false`, `adv.briefing === null` (campaign complete at
    the last level, now id 5).
  Net: insert one leading no-briefing advance and push each existing briefing assertion down by one advance;
  the shop-unlock moves from the 3rd to the 4th advance. The `brief-1` player starts with weapon 1 and only
  gets the MG on the 2nd advance — confirm the initial `gunBefore.weapon === 1` assert stays before the 1st
  advance and add a `weapon === 1` recheck after the 1st (no-briefing) advance.

- **`server/src/server.test.js:778`** ("catalog: level-4 enemies — advanced medium pirate + Second Boss +
  Advanced pirate cannon") — **checked; leave untouched.** It reads `/api/weapons`, `/api/components`,
  `/api/ships` by weapon id / component id / ship `role`, none of which change with the level shift (it does
  NOT fetch `/api/levels/level-4`). No edit needed.

- **`server/src/server.test.js:69-72`** ("new player starts at progress 1") — the assertion
  `j.currentProgress === 1` is still correct (1 is now the intro). Optionally update the inline comment
  from "(level-1 unlocked)" to "(the intro / Level 0 unlocked)". No behavioral change.

Run `cd server && npm test` and confirm green.

### 6. Client — AUTO-LAUNCH the intro fight (no welcome screen, no Take-off) + verify the rest

**New maintainer requirement (overrides the earlier "intro lands on the welcome screen — no client
change"):** on first launch (a new player still at the intro level) the game must go **straight into the
Level-0 fight** — the ship visible + controllable immediately, **no welcome screen, no "Take off"
button, no menu gate**. Scope: **the intro level only**. Once the player clears the intro and advances
to id 2 ("Level 1"), the normal flow resumes unchanged (Level 1 → welcome screen; level 2+ → Main
Window briefing). Returning players / other levels are untouched.

**6a. How to detect "at the intro level".** The bootstrap already fetches the level object
`level` (destructured at `client/src/main.js:827`), and `level.name` is the seed name of the row the
server served (`/api/players/:id/level` JOINs on `current_progress`; the unidentified fallback fetches
`/api/levels/level-1`). The server serves **`name: 'level-1'` only when the player's `current_progress`
is 1** — i.e. exactly when they haven't cleared the intro. So gate on **`level.name === 'level-1'`** —
robust, no title parsing, no `localStorage` flag. (A refresh mid-intro re-serves `level-1` → re-launches
the intro cleanly; that's acceptable — there is no partial-intro state to preserve.)

**6b. The bootstrap change** (`client/src/main.js`, the branch at **~872-873**). Today it reads:

```js
    // Homepage reflects the current level: if it has a briefing (level 2+), land on the Hangar showing
    // it; otherwise (level 1 / new player) show the welcome screen (greeting + intro).
    if (CATALOG.level.briefing) showMain(CATALOG.level.briefing);
    else showWelcome(playerShips);
```

Change it to auto-launch the intro before the existing landing branches:

```js
    // The intro ("Level 0", seed name 'level-1', served only while current_progress === 1) has NO menu
    // gate: drop the new player straight into the fight — ship visible + controllable at once, no welcome
    // screen, no Take-off. Everything else lands as before (Level 1 → welcome, level 2+ → Main Window
    // briefing). The default player ship was already built above (buildPlayerFor), so we just start the sim.
    if (level.name === 'level-1') {
      document.body.classList.remove('menu'); // ensure the in-game HUD (never a menu) — safety no-op
      G.gameStarted = true;
      reset(); // position the player + start the level (mirrors welcome.js takeOff, minus the welcome UI)
    } else if (CATALOG.level.briefing) {
      showMain(CATALOG.level.briefing);
    } else {
      showWelcome(playerShips);
    }
```

Notes for the implementer:
- `reset` is already imported into `main.js` (used elsewhere in bootstrap); confirm the import and add it
  if missing. `G` and `G.gameStarted` are the same globals `takeOff()`/`launchCampaign()` set
  (`welcome.js:148-149`, `mainwindow.js:70-71`).
- **Do NOT `requestFullscreen()` here** — bootstrap is not a user gesture, so the call would be rejected;
  touch users re-enter fullscreen via the always-available ⛶ button. This differs from `takeOff()`, which
  runs inside a click.
- `body.menu` is only ever *added* by `showWelcome`/`showMain` (`welcome.js:58`, `mainwindow.js:44`) and is
  absent from `<body>` in `index.html`; the `remove('menu')` is a defensive no-op on first boot.
- `animate()` (called immediately after this branch, unchanged) runs the render/update loop; with
  `gameStarted = true` and `reset()` done, the fight is live.

**6c. Ship-selection consequence (accepted decision).** Skipping the welcome screen skips its take-off
flow. This loses **no** ship choice: the recent change *"Welcome screen: dropped the L1 ship picker +
pinned Take off"* (SUMMARY) means the welcome screen no longer offers a picker — a brand-new player owns
exactly the one default player ship, which the bootstrap already built via
`buildPlayerFor((active && active.ship) || playerShips[0])`. The intro therefore flies the **default
player ship**; the player customizes later at the Main Window / hangar (reached after the intro). This is
acceptable and intended for a gentle first-contact level.

**6d. Verify these existing behaviors are still correct** (they key off descriptor fields that travel with
content, not off ids — **do not "fix" them**):

- **Signup-prompt gate** (`client/src/account.js:150`): `shouldPromptAccount()` fires only when
  `levelRunner.winTextKey === 'level.1.victory'`. That textKey belongs to **old-L1 content = now id 2
  ("Level 1")**, so the account nudge now fires after the player clears **"Level 1"**, NOT the intro —
  which is the intended behavior (no signup nag on the gentle intro). **Leave this string as-is.**
- **Staged briefing reveal** (`client/src/mainwindow.js:152-159`): `campaignLevelIndex()` parses the digit
  from `descriptor.title`. The intro has no briefing so staging never runs for it; the campaign titles
  ("Level 1"–"Level 4") are unchanged, so staging still applies to titles 2/3 exactly as before. No change.
- **Telemetry label** (`client/src/net.js:81` `currentLevelLabel()`): it emits
  `CATALOG.level.title || CATALOG.level.map` for `level_start` / Sentry `level` tags, so the intro reports
  the new label value **`"Level 0"`**. Harmless — it is just a new distinct label in analytics, not a bug.
  **No code change.**

**6e. Step-2 coordination hazard (note only — do NOT solve here).** The parked branch
`feature/2026-07-08-2007-level-0-intro-cutscene` autoplays an intro **cutscene** on first launch. Both
Step 1's auto-launch and Step 2's cutscene intercept the same first-launch moment, so they will conflict
on merge and must be reconciled **in Step 2** (the cutscene is what a first-time player sees; the
auto-launched intro fight is what the maintainer records to build that cutscene). **Step 1 only does the
auto-launch** — leave the reconciliation, any "already-seen" gating, and the cutscene entirely to Step 2.
Do not touch that branch.

### 7. Docs

- **`docs/SUMMARY.md`**:
  - Level-flow list (**827-840**): change "Four campaign levels are seeded" → "Five levels are seeded (an
    intro + four campaign levels)"; add a leading bullet for the intro
    (**`level-1` (id 1) — "Level 0", the intro patrol:** 3 basic pirates one at a time → 1 rocket pirate
    finale, `maxConcurrent 1`, no boss, no reward, `enemyTotal 4`); and note that the campaign "Level 1"–
    "Level 4" now occupy seed names/ids `level-2`..`level-5` while keeping their titles/rewards.
  - Progression paragraph (**750-753**): "A new player starts on `level-1`" is still literally true —
    clarify that `level-1` is now the intro ("Level 0"); existing players were bumped `+1` by the one-shot
    migration so they stayed on their same content.
  - Landing-screen section (around **659-667**): rewrite for the auto-launch — the intro ("Level 0",
    served while `current_progress === 1`) **auto-launches straight into the fight on load** (no welcome
    screen, no "Take off"; the ship is controllable immediately, flying the default player ship). Once the
    intro is cleared, the normal landing resumes unchanged: **"Level 1" (id 2) → welcome screen**
    (no briefing), **level 2+ → Main Window** showing the briefing. Update the `main.js:872` code comment
    the section quotes to match the new three-way branch.
  - Bump the `**Updated:**` date (line 6) to today and lead its "current state" line with the intro-level
    summary.
- **`docs/CHANGELOG.md`**: add a bullet under today's date, e.g.:
  > **Intro "Level 0" first level** — a gentle, non-skippable opening level (3 basic pirates one at a time
  > → 1 rocket-pirate finale, `maxConcurrent 1`, no boss, no reward, `enemyTotal 4`) is now the first level
  > every new player plays. Implemented by keeping the seed names `level-1`..`level-4` stable (stable ids)
  > and shifting the campaign descriptors down one id + appending `level-5` (old L4). Existing players were
  > migrated `+1` (SQLite migration 022 + an idempotent one-shot on Postgres) so they stayed on their exact
  > same content (campaign titles/rewards/briefings unchanged). New EN+RU `level.0.victory` string. **On
  > first launch the intro auto-launches straight into the fight — no welcome screen, no "Take off"** (the
  > ship is controllable at once, flying the default player ship); Level 1+ landing is unchanged. The
  > maintainer will record a playthrough of this level for the parked intro cutscene (Step 2).
- **`docs/DECISIONS.md`**: add **§61** (use §61, NOT §60 — see the collision hazard below):
  > ## 61. Intro "Level 0" via content-shift on stable seed names + one-shot `current_progress` +1, not a
  > `sort_order` column or a full renumber
  > Level order is `levels.id` (insertion order) with name-keyed upserts, so a new *first* level needs the
  > lowest id. Rather than add a `sort_order` column (over-engineering, §30) or renumber every campaign
  > title, we keep the seed names `level-1`..`level-4` (stable ids 1-4), shift their descriptor CONTENT down
  > one, and append `level-5`. The campaign keeps its "Level 1"-"Level 4" labels/rewards/briefings intact
  > (content travels with the descriptor); only new players see the "Level 0" intro. Existing players are
  > bumped `+1` once (SQLite migration 022; a guarded `migrations_pg` one-shot on Postgres, run after the
  > levels seed so the FK validates) so nobody is shoved onto different content. Trade-off: the intro is
  > labeled "Level 0" (a prologue) rather than a renumbered "Level 1", accepted to avoid relabeling the
  > whole campaign and touching every title/textKey. The intro also **auto-launches** on first load (no
  > welcome screen / Take-off, gated to `level.name === 'level-1'`) so a brand-new player is dropped
  > straight into the gentle fight; this skips the welcome take-off flow (default ship only, no picker —
  > which the welcome screen no longer offers anyway).

  > **§-number collision hazard (parallel-merge doc-conflict pattern):** on `main` today the next free
  > number is §60, but the **parked** branch `feature/2026-07-08-2007-level-0-intro-cutscene` already claims
  > `## 60.` (the intro-cutscene decision). To avoid a collision when that branch later merges, this plan
  > uses **§61**. If §61 is somehow taken by merge time, renumber this entry to the next free slot; whoever
  > merges second reconciles. Do not reuse §60.

### 8. Deploy-critical (call out in the PR / hand-off)

- **Reseed + migration run on deploy.** The change is only live once the server restarts and (a) re-seeds
  the catalog — rewriting ids 1-4 descriptors and inserting `level-5` — and (b) runs the `+1` bump
  (SQLite migration 022 / the Postgres one-shot). Verify on prod after deploy: `GET /api/levels/level-1`
  returns `title: "Level 0"`, and an existing player's `current_progress` moved up by one.
- **Backend parity.** SQLite (tests + local) and Postgres (prod) must agree; the tests only cover SQLite,
  so the Postgres one-shot in step 4 must be reviewed by hand (guard + FK ordering).
- **Prod-is-only-test-accounts fallback (optional, NOT the default).** If the maintainer confirms prod has
  only throwaway test accounts, `node server/src/reset.js --all --yes` would also produce a clean state
  (everyone restarts at the intro) and makes the `+1` migration moot. **Implement the safe `+1` regardless**
  — the reset-all path is a manual ops fallback, not part of this change.
- **No asset/model change** → **no `/publish-itch` step needed** (no catalog model hashes change; only level
  descriptors + a string).

## Tests

- `cd server && npm test` — updated `enemy_total.test.js` (5-level EXPECTED) and `server.test.js`
  (progress chain to `level-5`, reset to `level-5`, the shifted per-level content asserts, intro values).
  Remember server tests run on SQLite only; hand-verify the Postgres bump.
- `cd client && node --test` — the unit tests don't exercise the bootstrap (needs DOM/WebGL), so they
  should be unaffected; run to confirm no regressions (the i18n JSON must stay valid — a broken comma
  fails the locale/drift tests).
- **Client visual suite** (`cd client && node visual/run.mjs`) — the auto-launch + level shift break two
  scenarios that reset-to-baseline then advance (baseline is now the intro, id 1, which auto-launches
  instead of showing a screen). Fix both:
  - **`client/visual/scenarios/18-briefing-staged-reveal.mjs`** — `landWelcome()` (lines **19-25**) resets
    progress then reloads expecting the **welcome** screen at `#welcome` (line 23). After the shift a reset
    player is at the intro (id 1) → auto-launch → no welcome → the `waitForSelector('#welcome', visible)`
    times out. Fix: after the reset POST, **advance once** (`POST /api/players/:pid/advance`) so the player
    is on id 2 ("Level 1", no briefing → welcome screen), THEN reload. The welcome staged-reveal
    (`welcomeStaged`) still fires (it plays for any no-briefing non-intro level). Verify the `#welcome`
    assertions (28-39) and the layout guards (4a/4b, 41-84) pass on id 2. **Also apply the same +1 shift**
    to any reset+advance navigation this scenario uses for its later L2/L3/L4 Main Window section (audit
    below line 76) — each advance count goes up by one because reset now lands on the intro, not old-L1.
  - **`client/visual/scenarios/97-briefing-showcase.mjs`** — `landOn(n)` (lines **12-21**) = reset (to
    id 1) + advance `n` + reload. After the shift the campaign content is one id lower, so **every
    `landOn(n)` argument must be +1**: `landOn(1)`→`landOn(2)` (MG briefing, id 3, line 26),
    `landOn(2)`→`landOn(3)` (repair drone, id 4, line 33), `landOn(3)`→`landOn(4)` (unlockShop / no item,
    id 5, line 40), `landOn(4)`→`landOn(5)` (campaign cleared → side missions, id 5, line 45). The MG /
    drone / unlockShop assertions and the `previewTarget`/`itemShowcaseTarget` checks are otherwise
    unchanged (the descriptors travel with their content).
  - **`client/visual/scenarios/14-reset-progress.mjs`** and the harness default-boot launch
    (`client/visual/run.mjs:97-99`) use the guarded "if welcome/mainwin visible, click take-off" pattern,
    which tolerates auto-launch (on an intro boot the arena is already up → the guarded click is a no-op).
    No edit expected; **re-run and confirm zero new page errors**. Judge the suite by the reliably-passing
    set + zero page errors (the baseline has ~6 flaky scenarios — see the visual-suite note).
- Manual: fresh player (progress reset) → **loads straight into the intro fight, no welcome screen / Take
  off**, ship controllable immediately → 3 basic pirates arrive one at a time → 1 rocket pirate → "First
  patrol clear, Sentinel." victory → advancing enters "Level 1" (old L1 content, welcome screen, MG drop on
  its last kill). The killed/total HUD reads **/4** on the intro.

## Out of scope / non-goals (DECISIONS §30)

- **No** intro cutscene, skip button, or any coupling to the parked `2026-07-08-2007-level-0-intro-cutscene`
  branch — that is Step 2; do not touch it.
- **No** `sort_order` column / ordering-engine change; **no** renumbering of campaign titles or textKeys.
- **No** new enemy ships, models, maps, briefing, or reward on the intro. No balance changes to the existing
  campaign (its descriptors move verbatim).
- **No** client changes beyond the single auto-launch bootstrap branch (Step 6b) — no new HUD, no skip
  button, no cutscene, no menu redesign. The auto-launch is gated to the intro only (`level.name ===
  'level-1'`); do NOT extend it to other levels or add an "already-seen"/localStorage gate (that's Step 2).
- **No** change to the new-player / reset baseline (`current_progress = 1`), which is now the intro.
