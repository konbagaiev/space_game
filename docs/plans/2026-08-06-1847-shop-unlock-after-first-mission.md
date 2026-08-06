# Shop unlocks right after the first mission (not at the final level)

## Goal

Today the hangar shop and its bundled side missions only open at the **last** campaign level: the
`unlockShop` briefing action lives on the final level's briefing. This makes the whole upgrade/shop
economy dead weight for a first-time player until they've cleared the entire story. Move the unlock
**earlier** — the shop + side missions become available the moment the player clears **Level 1 / "first
flight"** (the first real mission). Concretely: append `{ type: 'unlockShop' }` to the briefing shown on
**reaching the next level after "first flight"** (the "Level 2" briefing), remove it from the final
level's briefing, and add a one-time DB backfill so every existing player who has already passed "first
flight" gets the shop opened retroactively (with the basic gun seeded into their stash, exactly as the
live unlock does). Player-visible effect: a new player finishes their first mission, lands in the hangar,
and the shop + side missions are already open — instead of being locked until the campaign is over.

## Critical naming: descriptor `name` vs player-facing "Level N" vs `textKey`

The codebase has a deliberate **off-by-one** between the internal level `name`/id and the player-facing
title (see the intro "Level 0" shift, `db.js:271-278`). Get this right or you will edit the wrong level.

| descriptor `name` (catalog_seed.js) | levels.id | player-facing title | briefing `textKey`      | role |
|-------------------------------------|-----------|---------------------|-------------------------|------|
| `level-1`                           | 1         | Level 0             | (intro cutscene)        | intro replay |
| `level-2`                           | 2         | Level 1             | `level.1.briefing`      | **"first flight"** — first real mission |
| `level-3`                           | 3         | Level 2             | `level.2.briefing`      | **← add `unlockShop` HERE** |
| `level-4`                           | 4         | Level 3             | `level.3.briefing`      | repair drone install |
| `level-5`                           | 5         | Level 4             | `level.4.briefing`      | **← remove `unlockShop` from here** |

- The `unlockShop` action runs on **advancing INTO** a level (`applyBriefingActions`, `db.js:419-425`, via
  `runLevelBriefing`, `db.js:439-446`). A player clears "first flight" (`level-2`, id 2) → their
  `current_progress` advances to **id 3** (`level-3`) → that advance runs `level-3`'s briefing actions →
  shop unlocks. So the backfill predicate for "already past first flight" is **`current_progress >= 3`**.
- **Watch out:** `docs/SUMMARY.md` prose refers to briefings by their **player-facing / `textKey` number**,
  NOT the descriptor `name`. In SUMMARY, "`level-2`'s briefing" means `textKey: 'level.2.briefing'` =
  descriptor `name: 'level-3'`, and "`level-4`'s briefing" means `textKey: 'level.4.briefing'` = descriptor
  `name: 'level-5'`. When you edit SUMMARY, keep its existing convention; when you edit `catalog_seed.js`,
  target the descriptor `name`.

## Decisions (already made — do not re-open)

- **Unlock point:** on reaching `level-3` (id 3, player-facing "Level 2"), i.e. right after clearing "first
  flight" (`level-2` / "Level 1"). Append `{ type: 'unlockShop' }` to `level-3`'s briefing `actions`.
- **Side missions stay bundled** with the shop: the missions endpoint gates on the *same*
  `players.shop_unlocked` flag (`server/src/server.js:215`), so moving `unlockShop` moves both together. No
  split, no separate action.
- **Final-level fallback stays:** the `advanceProgress` "no next level → `unlockShop`" fallback
  (`db.js:458-461`) is left untouched, and `unlockShop` remains idempotent (`db.js:466-473`).
- **Existing players: backfill YES.** A one-time DB backfill opens the shop for every registered player with
  `current_progress >= 3` and seeds weapon 1 into their stash. Idempotent (guarded UPDATE + `ON CONFLICT DO
  NOTHING`), safe to run on every boot — matches the existing Grab/shield backfills (`db.js:293-303`), which
  also run every boot without a ledger because they are self-guarding. We deliberately do **not** use the
  `migrations_pg` ledger here (the intro shift uses it only because `+1` is non-idempotent; our operation is
  naturally idempotent, so a ledger would be redundant ceremony — DECISIONS §30).
- **Briefing copy YES:** the "Level 2" briefing (`level.2.briefing`) gains a sentence telling the player the
  hangar shop + side missions are now open; the "Level 4" briefing (`level.4.briefing`) drops its
  now-misleading "look over the upgrade gear the factory has on hand" line. English is the source of truth
  (`client/locales/source.json`); the Russian layer (`client/locales/ru.json`) is updated to match.

## Steps

### 1. Move the `unlockShop` action (`server/src/catalog_seed.js`)

**Add** `unlockShop` to `level-3`'s briefing. Currently (`catalog_seed.js:460-464`):

```js
      briefing: {
        textKey: 'level.2.briefing',
        text: 'You pulled a Machine Gun out of the wreckage back there, Sentinel — lighter on the trigger and a real help for shooting down incoming rockets. Now push the pirates off our weapons factory before they arm their fleet.',
        actions: [{ type: 'replaceWeapon', from: 1, to: 5 }], // Basic kinetic -> Machine Gun
      },
```

becomes (append `unlockShop` to the `actions` array, and update `text` per Step 3):

```js
      briefing: {
        textKey: 'level.2.briefing',
        text: '<new text from Step 3>',
        actions: [{ type: 'replaceWeapon', from: 1, to: 5 }, { type: 'unlockShop' }], // MG swap + open the hangar shop + side missions
      },
```

- **`showcaseFromBriefing` is unaffected** (`db.js:429-436`): it only reads `replaceWeapon` /
  `installComponent` (returns the first one). `replaceWeapon` still comes first, so the showcase item stays
  the Machine Gun (weapon 5). `unlockShop` is never a showcase source. No change needed there.

**Remove** `unlockShop` from `level-5`'s briefing. Currently (`catalog_seed.js:546-550`):

```js
      briefing: {
        textKey: 'level.4.briefing',
        text: "Several ships bolted from the factory just before we arrived ... Good hunting, Sentinel.",
        actions: [{ type: 'unlockShop' }], // reaching L4 (after clearing L3) opens the shop + side missions
      },
```

becomes an **empty actions list** (text-only briefing; update `text` per Step 3):

```js
      briefing: {
        textKey: 'level.4.briefing',
        text: "<trimmed text from Step 3>",
        actions: [], // text-only: the shop was opened back on reaching "Level 2"
      },
```

Also update the block comment above the `level-5` descriptor (`catalog_seed.js:539-542`) so it no longer
claims this level "OPENS THE HANGAR SHOP + side missions" — the shop is now opened on reaching `level-3`.

### 2. Backfill migration (`server/src/db.js`)

Add two idempotent statements in `migrate()` immediately **after** the Base-shield backfill
(`db.js:302-303`, right before the `console.log('[migrate] postgres schema ready')` at `db.js:305`).
Placement after the levels seed (`db.js:265-269`) matters so the `current_progress` FK targets exist.

```js
  // Backfill: the hangar shop + side missions now unlock on reaching level-3 (id 3, player-facing
  // "Level 2" — right after clearing "first flight"/"Level 1"), not at the final level (DECISIONS §90).
  // Retroactively open the shop for existing players who already advanced past "first flight"
  // (current_progress >= 3) and seed the basic kinetic gun (weapon 1) into their stash, exactly as
  // unlockShop() does. Idempotent: the `shop_unlocked = 0` guard and ON CONFLICT DO NOTHING make this a
  // no-op once applied (and for players who reach level-3 going forward, unlockShop already did the work),
  // so it is safe to run on every boot — matching the Grab/shield backfills above.
  await pool.query('UPDATE players SET shop_unlocked = 1 WHERE current_progress >= 3 AND shop_unlocked = 0');
  await pool.query(`INSERT INTO stash (player_id, kind, ref_id, qty)
    SELECT id, 'weapon', 1, 1 FROM players WHERE current_progress >= 3
    ON CONFLICT (player_id, kind, ref_id) DO NOTHING`);
```

- `shop_unlocked` is an **INTEGER** column (`db.js:201`) — write `1`, never a boolean, or the UPDATE throws
  on Postgres (the exact prod bug the reset test at `server.test.js:167-170` guards).
- Threshold rationale (state it in the plan-reader's head): a player still ON "first flight" is at
  `current_progress = 2` (`level-2`) → excluded → shop stays locked. A player who cleared it is at
  `current_progress >= 3` → included. Correct boundary.

### 3. Briefing copy (English source of truth + Russian layer + `catalog_seed.js` fallback)

The client displays `t(textKey)` and only falls back to the descriptor `text` if the key is missing
(`client/src/mainwindow.js:216`; `t()` resolves `client/locales/source.json` for English,
`client/locales/ru.json` for Russian — `client/src/i18n.js:41-48`). So the **authoritative** display text is
`source.json`; keep `catalog_seed.js` `text` in sync as the fallback.

**3a. `level.2.briefing` — add a shop sentence.** Update `source` at `client/locales/source.json:607` and the
matching descriptor `text` at `catalog_seed.js:462`. Add one sentence pointing the player at the now-open
hangar. Suggested English (mission-control voice, keep "Machine Gun" + "Sentinel"; the existing text ends at
the weapons-factory line — append the shop line, e.g.):

> "That Machine Gun you pulled from the wreck is fitted, Sentinel — lighter trigger, and it'll knock rockets
> out of the air. And now that you're back at the station, the hangar's open to you: the shop and a few side
> jobs are yours to take between missions — kit out before you push on. We've lost contact with our weapons
> factory, two sectors out, and every lane to it is crawling with pirates. Cut your way through and reach it
> — and watch the heavier one holding the door; it won't go down like the rest."

Also update the `context` note for `level.2.briefing` (`source.json:608`) to mention it now announces the
shop/side-missions unlock.

**3b. `level.4.briefing` — trim the shop reference.** Update `source` at `client/locales/source.json:651` and
the descriptor `text` at `catalog_seed.js:548`. Remove the "While you're docked, look over the upgrade gear
the factory has on hand …" clause (the shop is no longer new here) while keeping the find-the-base direction
and the "heavy ships ahead, kit out accordingly" nudge. Suggested English:

> "Those ships that ran when the factory fell — we tracked their heading, and your job is to find where
> they're hiding. We counted a lot of heavy ships among the ones that fled, so rearm at the hangar and kit
> out accordingly. Good hunting, Sentinel."

Update the `context` note for `level.4.briefing` (`source.json:652`) so it no longer says this briefing
"directs the player to gear up at the shop" as a first-time unlock (it's a reminder now, not the unlock).

**3c. Russian layer (`client/locales/ru.json`).** Mirror both edits so RU players see the same meaning:
- `ru.json:152` (`level.2.briefing`): add a sentence stating the hangar shop + side missions are now open.
- `ru.json:163` (`level.4.briefing`): drop the "присмотрись к оборудованию для апгрейда на заводе" clause.
- This is a translation of author-approved English; if unsure of phrasing, keep RU faithful to the English
  above. (English remains the source of truth per CLAUDE.md / DECISIONS §10 — do not let RU drift in meaning.)

## Tests (`server/src/server.test.js`)

Run with: `cd server && npm test` (the `pretest` drops + recreates `spacegame_test` and `migrate()` runs on
server boot, so the catalog reseeds and the backfill path executes every run).

### T1 — Rewrite the `briefing:` advance test (currently `server.test.js:181-227`)

The shop now unlocks on the **2nd** advance (reaching `level-3` / `level.2.briefing`), not the 4th. Edit:

- After the **1st** advance (`server.test.js:189-192`, lands on `level.1.briefing` / "Level 1"): assert the
  shop is still locked —
  `assert.equal((await getJson('/api/players/brief-1/active-ship')).shopUnlocked, false, 'shop locked during the first flight');`
- After the **2nd** advance (`server.test.js:194-204`, `level.2.briefing`, MG swap): assert the shop is now
  **unlocked** —
  `assert.equal((await getJson('/api/players/brief-1/active-ship')).shopUnlocked, true, 'reaching Level 2 (after the first flight) opens the shop');`
- Delete the old lines `server.test.js:215-221` (the "4th advance unlocks the shop" block). The 4th advance
  still runs (`level.4.briefing`) — keep it if you like, but assert `shopUnlocked` **stays** `true` (unlock is
  idempotent), not that it flips here.

### T2 — New focused unlock-point test

Add a small test near the shop suite (after `server.test.js:759`):

```js
test('shop: unlocks on reaching "Level 2" (id 3) — right after the first flight, not the final level', async () => {
  await getJson('/api/players/shop-early/active-ship');                 // register (progress 1)
  await post('/api/players/shop-early/advance', {});                    // → level-2 ("first flight")
  assert.equal((await getJson('/api/players/shop-early/stash')).shopUnlocked, false, 'still locked during the first flight');
  await post('/api/players/shop-early/advance', {});                    // → level-3 (id 3): unlockShop runs
  const s = await getJson('/api/players/shop-early/stash');
  assert.equal(s.shopUnlocked, true, 'shop opens right after clearing the first flight');
  assert.ok(s.stash.some((it) => it.kind === 'weapon' && it.refId === 1), 'basic gun seeded into the stash');
});
```

### T3 — New backfill-migration regression test

Add near the shop suite. Uses the established `migrate()`-rerun pattern (`server.test.js:811-819`).

```js
test('migration: backfills shop_unlocked + basic gun for players past the first flight (progress >= 3)', async () => {
  const { pool } = await import('./db.js');
  const { migrate } = await import('./datastore.js');
  await post('/api/players/bf-past', {}).catch(() => {});               // ensure row exists (or use register)
  await post('/api/players/register', { playerId: 'bf-past' });
  await post('/api/players/register', { playerId: 'bf-early' });
  // simulate the pre-change state: advanced past the first flight but shop still locked (old behavior)
  await pool.query("UPDATE players SET current_progress = 3, shop_unlocked = 0 WHERE id = 'bf-past'");
  await pool.query("UPDATE players SET current_progress = 2, shop_unlocked = 0 WHERE id = 'bf-early'");
  await pool.query("DELETE FROM stash WHERE player_id = 'bf-past' AND kind = 'weapon' AND ref_id = 1");
  await migrate();                                                      // idempotent re-run exercises the backfill
  const past = await pool.query('SELECT shop_unlocked FROM players WHERE id = $1', ['bf-past']);
  assert.equal(past.rows[0].shop_unlocked, 1, 'past-first-flight player retroactively unlocked');
  const gun = await pool.query("SELECT qty FROM stash WHERE player_id = 'bf-past' AND kind = 'weapon' AND ref_id = 1");
  assert.equal(gun.rows[0].qty, 1, 'basic gun backfilled into the stash');
  const early = await pool.query('SELECT shop_unlocked FROM players WHERE id = $1', ['bf-early']);
  assert.equal(early.rows[0].shop_unlocked, 0, 'a player still on the first flight stays locked');
});
```

(Drop the stray `post('/api/players/bf-past', {})` line if `register` alone creates the row — use whichever
matches how other tests register. The point: register → force progress+lock → `migrate()` → assert.)

### T4 — Rename/adjust stale assertions & names

- `shop: locked until the final level is cleared` (`server.test.js:751`): the freshly-registered `shop-lock`
  player is at progress 1, so the 403s still hold — but the **name/comment are now wrong**. Rename to e.g.
  `shop: locked for a new player (before the first flight); mutations 403` and keep the assertions.
- `missions: locked until the campaign is cleared…` (`server.test.js:761`): `miss-lock` (progress 1) is still
  locked (403) — assertions hold. Update the **name/comment** to "locked before the first flight" (missions
  now unlock at the same earlier point as the shop). `clearCampaign('miss-1')` still ends unlocked.
- `shop: unlocks on clearing the campaign…` (`server.test.js:843`): `clearCampaign` (4 advances) still passes
  the `level-3` unlock point, so it stays unlocked — assertions hold. Update the comment to note the shop
  actually unlocks earlier now (this test just confirms it's still unlocked after a full clear).
- The `clearCampaign` helper (`server.test.js:747-749`) and its comment "so the shop unlocks for `playerId`"
  are fine (a full clear still unlocks); optionally soften the comment.

## Docs to update

- **`docs/SUMMARY.md`** (bump `**Updated:**` to `2026-08-06`; remember SUMMARY's "level-N" = `textKey`
  number, per the table above):
  - Between-level briefings (`SUMMARY.md:1101-1106`): move the `unlockShop` narration — "`level-2`'s
    briefing" (the MG swap) now **also opens the hangar shop + side missions**; "`level-4`'s briefing" is now
    text-only (directs the player to the base; the shop was already opened).
  - Level-4 descriptor blurb (`SUMMARY.md:1145-1148`): drop "**opens the hangar shop + side missions**" from
    the final level's description.
  - Stash & hangar shop gate (`SUMMARY.md:1717-1722`): change "flipped by `level-4`'s `unlockShop` briefing
    action (i.e. on **clearing `level-3`**, the original campaign end)" → flipped by "`level-2`'s
    `unlockShop` briefing action (on **reaching player-facing 'Level 2'**, i.e. right after clearing the
    first flight)", still with the final-level fallback. Add a sentence: a **one-time boot backfill** opens
    the shop + seeds the basic gun for existing players with `current_progress >= 3`.
  - Side missions gate (`SUMMARY.md:1736-1740`): "403 until the campaign is cleared" → "403 until the shop
    unlocks (right after the first flight)".
  - Test-inventory line (`SUMMARY.md:2183-2187`): "lock until the final level is cleared, unlock +
    basic-gun backfill" → "lock before the first flight, unlock on reaching 'Level 2' + basic-gun backfill,
    plus the existing-player backfill migration".
- **`docs/CHANGELOG.md`** — add under a `## 2026-08-06` heading (create if missing), newest on top:
  > **Shop opens after the first mission, not at the end.** The hangar shop + side missions now unlock the
  > moment a player clears "first flight" (reaching player-facing "Level 2") instead of at the final level —
  > `unlockShop` moved from the last briefing to the "Level 2" briefing. A one-time idempotent boot backfill
  > opens the shop and seeds the basic gun for existing players already past the first flight
  > (`current_progress >= 3`). Briefing copy updated (EN + RU): the "Level 2" briefing announces the open
  > hangar; the "Level 4" briefing drops its now-stale "look over the upgrade gear" line. See DECISIONS §90.
- **`docs/DECISIONS.md`** — add **§90** (next free number; current max is §89) recording the trade-off:
  earlier shop unlock (economy is reachable during the campaign, not just after it) + why a plain idempotent
  boot backfill was chosen over a `migrations_pg` ledger entry (the op is naturally idempotent; matches the
  Grab/shield backfills — DECISIONS §30) + the retroactive-open decision for existing players.

## Out of scope / non-goals (do not gold-plate)

- **No client code changes.** The client is already fully data-driven off `shopUnlocked` (`shop.js:297-298`,
  `mainwindow.js:244`, `sim.js:799-800`) — do not add any "shop just unlocked" toast, animation, or gating
  logic. Copy changes live only in the locale JSON + the `catalog_seed.js` `text` fallback.
- **Do not touch** the `advanceProgress` final-level fallback (`db.js:458-461`), the `unlockShop` body
  (`db.js:466-473`), the shop mutation gate (`server.js:192`), or the missions gate (`server.js:215`).
- **No new level, action type, migration ledger, or DB column.** Reuse the existing `shop_unlocked` flag and
  the `unlockShop` action verbatim.
- **No economy/price/side-mission rebalancing.** The shop simply becomes available earlier; its contents,
  prices, and the side-mission generator are unchanged.
- **No asset/model changes** → no `CREDITS.md` review and no `/publish-itch` step needed (this ships via the
  normal prod deploy only).
