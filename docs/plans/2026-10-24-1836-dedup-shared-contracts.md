# Shared contracts between client and server (duplication audit C1, C2, C3, C4, C7)

**Date:** 2026-10-24. **Status:** implemented.
**Parent:** Phase 1 of [`2026-10-24-duplication-audit-closeout.md`](2026-10-24-duplication-audit-closeout.md).
Original evidence per item: [`2026-10-20-duplication-audit.md`](2026-10-20-duplication-audit.md) §C1, §C2, §C3,
§C4, §C7. Pattern: DECISIONS §136. There is one pure module under `client/src/`, put in `sim-core/` when the
sim also needs it. The server imports it. A guard test **recomputes** the value instead of asserting a
literal.

Line numbers below were checked on 2026-10-24 in this worktree. If one has drifted, find the place by its
anchor text.

## Goal

Five facts are written separately on the client and the server, and today they are kept in step only by
hand:
- the list of skills;
- the equipment slot lists and the weapon-type → fire-group map;
- the sell rate;
- the progression object returned after a run;
- the shop-unlock level and the starter item ids.

After this change each fact has one source, or one test that ties its copies together. Every guard is first
seen to **fail** against the old code. A player sees almost nothing change. The Character screen's XP bar now
uses the same maths as the in-flight HUD bar, so the two can no longer disagree. One behaviour changes on
purpose: equipping a weapon whose type has no slot is refused with a 409. Before, it was silently put into
the gun slot. No such weapon exists in the catalog today.

## Decisions (already made, do not re-ask)

1. **C2 — unknown weapon type → 409.** `equipItem` refuses a weapon whose `type` has no group in
   `GROUP_WEAPON_TYPE`, with `409 'no slot for this weapon type'`. It no longer falls back to `'gun'`. This
   matches the client, which shows no slot for such a weapon. Record it as DECISIONS §167 (see Docs).
2. **C2 — where the shared lists live.** `REQUIRED_SLOTS` and `COMPONENT_SLOTS` become **arrays** in
   `client/src/sim-core/shop-rules.js`:
   - The client needs arrays: `shop.js` keeps their order when it renders the slot chips, and it uses
     `.includes`.
   - The server wraps them in `Set`s locally.
   - They go in `sim-core/` rather than `shop-slots.js` because a sim-core module needs them too
     (`components.js:17` `shipMass`). The server already imports `shop-rules.js`.
   - `GROUP_WEAPON_TYPE` stays in `client/src/shop-slots.js`, which is pure and node-importable. The server
     imports it from there.
3. **C3 — sell rate.** `SELL_RATE` and `sellPrice(price)` move to `client/src/sim-core/shop-rules.js`.
   - `sellLabel` in `format.js` is used only by its test, so delete it.
   - `sellPrice` uses `Math.floor((price | 0) * SELL_RATE)`, the server's formula. On integer catalog prices
     it is identical to the client's old `(price || 0)` version.
4. **C4 — keep the old response fields.** `POST /api/games` keeps `{gameId, credits, experience, level,
   leveledUp, xpEarned}`, because the itch build and old open tabs read them. It **adds**
   `progression: await getProgression(playerId)`. The client adopts `res.progression` when present. It keeps
   the local recompute only as a fallback for an old server.
5. **C4 — the Character XP bar previews unbanked XP like the HUD.** It calls
   `liveProgress(prog, G.earnedXp)`, the same call `hud.js:108` makes.
   - At base, `G.earnedXp` is 0 once banking has succeeded, so this normally shows the banked state.
   - While a bank is still in flight, or if it failed, the two bars still agree.
   - The fallback for a missing progression is `{ level: 0, xpIntoLevel: 0, skillPoints: 0, skills: {} }`.
     The span then comes from `liveProgress` (`levelUpCost(0)`), so the literal `1000` disappears.
6. **C4 — the XP-curve copy stays.** `client/src/progression.js` mirrors `server/src/progression.js` on
   purpose (DECISIONS §103). It is parity-tested already. Leave it alone.
7. **C7 — no behaviour change** (DECISIONS §90, §95).
   - `STARTER_WEAPON_ID` and the grab/shield backfill ids are **read from the starter ship row** in
     `catalog_seed.js SHIPS`. They resolve to 1, 29 and 31, exactly as today.
   - `FACTORY_GATE` (catalog) and `SIDE_MISSIONS_MIN_LEVEL` (db) both stay. A test pins that they are equal.
     Importing would create a cycle: `db.js` imports `catalog_seed.js`, so the seed cannot import `db.js`.
     The two names are also separate concepts (§91) that happen to fall on the same level today.
8. **Brief corrections** (the closeout plan had these wrong):
   - `liveProgress` lives in `client/src/progression.js:22`, not `hud.js`.
   - The grab 29 / shield 31 grants are the boot backfills at `server/src/db.js:459-468` (DECISIONS §40).
     They are not near `registerPlayer`, which grants neither.
   - The only stale `level-5` comment is `catalog_seed.js:915`. The `level-5` strings at `db.js:37` and
     `:66` are correct history (the legacy names before the 0-based renumbering), so leave them.

## Steps

### C1 — skill list (one source: `client/src/sim-core/skills.js`)

Copies today:
- `server/src/db.js:16-17` (`SKILLS`, `SKILL_COL`), `:30` (the `NEW_PLAYER_DEFAULTS` skill keys) and
  `:349-353` (five hand-written `ALTER TABLE` lines);
- `server/tools/verify-sessions.mjs:74`;
- `client/src/mainwindow.js:215` (`SKILL_CARDS`);
- `client/src/sim-core/components.js:47-68` (`SKILL_RATES`, `skillEffects`);
- the i18n keys `ui.skill.<key>.name` and `.desc` (`mainwindow.js:243-244`).

1. Create `client/src/sim-core/skills.js`. It must be pure, with no imports:
   ```js
   // The five character skills — ONE list for the server (players.skill_* columns, /skills/spend whitelist,
   // new-player defaults), the Character screen (card order) and the tools. Order = Character card order.
   // Lives in sim-core so the server can import it (DECISIONS §136); keep it free of three/DOM.
   export const SKILLS = ['kinetic', 'rocket', 'shields', 'maneuver', 'mobility'];
   export const skillColumn = (s) => `skill_${s}`;
   ```
2. `server/src/db.js`:
   - Add `import { SKILLS, skillColumn } from '../../client/src/sim-core/skills.js';`.
   - Delete the local `export const SKILLS` at `:16`. Nothing outside `db.js` imports it (checked).
   - `SKILL_COL` becomes `Object.fromEntries(SKILLS.map((s) => [s, skillColumn(s)]))`. Rewrite the comment
     at `:14-15` so it points to `skills.js`.
   - In `NEW_PLAYER_DEFAULTS` (`:29-31`), replace the five literal `skill_*: 0` keys with
     `...Object.fromEntries(SKILLS.map((s) => [skillColumn(s), 0]))`. Keep `Object.freeze`, and keep
     `experience` before the spread.
   - Replace the five `ALTER TABLE players ADD COLUMN IF NOT EXISTS skill_*` lines (`:349-353`) with one
     generated interpolation inside the same SQL template:
     `${SKILLS.map((s) => `ALTER TABLE players ADD COLUMN IF NOT EXISTS ${skillColumn(s)} INTEGER NOT NULL DEFAULT ${D[skillColumn(s)]};`).join('\n    ')}`.
     Keep the `experience` line above it as it is.
3. `server/tools/verify-sessions.mjs:74`: import from `'../../client/src/sim-core/skills.js'` and use
   `const SKILL_COLUMNS = SKILLS.map(skillColumn);`. Rename the use at `:87` to match. The header comment at
   `:31-32` describes the SQL in words, so leave it.
4. `client/src/mainwindow.js`:
   - Add `import { SKILLS } from './sim-core/skills.js';`.
   - Delete `SKILL_CARDS` at `:215`.
   - At `:239`, map over `SKILLS`.
   - The card markup does not change.
5. `client/src/sim-core/components.js`: no code change. `SKILL_RATES` and `skillEffects` stay. The new
   guard below pins them.
6. **Client guard:** new file `client/src/sim-core/skills.test.js`.
   - For every `k` in `SKILLS`: `assert.notDeepEqual(skillEffects({ [k]: 1 }), skillEffects({}))`. This
     proves each skill does something.
   - Read `client/locales/source.json` and `client/locales/ru.json` with `fs.readFileSync` and
     `new URL('../../locales/…', import.meta.url)`. For every `k`, assert that `ui.skill.${k}.name` and
     `ui.skill.${k}.desc` are both present in **both** files.
   - The two files have different shapes: `source.json` values are `{source, context}` objects, while
     `ru.json` values are plain strings.
7. **Server guard:** add to `server/src/server.test.js`, next to the `NEW_PLAYER_DEFAULTS` test at
   `:1671`:
   - Import `SKILLS` and `skillColumn` from `../../client/src/sim-core/skills.js`.
   - For every `k`, `NEW_PLAYER_DEFAULTS[skillColumn(k)] === 0`.
   - Query `information_schema.columns` for `table_name = 'players'` and assert that the column
     `skillColumn(k)` exists.
   - Register a player and `POST /api/games` with `xp: 10000`. That reaches level 5
     (1000+1500+2000+2500+3000), which gives five unspent points. Then call
     `POST /api/players/<id>/skills/spend` with `{ skill: k }` for each `k` in turn. Each call returns 200
     with `progression.skills[k] === 1`.

**Negative test (do it, and record it in the run log):** write `skills.js` and both guards **first**,
before you touch `db.js`, `mainwindow.js` or `verify-sessions.mjs`. Temporarily append a sixth key
(`'stealth'`) to `SKILLS`.
- The client test must fail: there is no effect and no i18n keys.
- The server test must fail: there is no column, no default, and spend returns 400.

Remove `'stealth'`, then do steps 2–4 and confirm everything is green.

### C2 — slot lists + weapon-group map

Copies today:
- server: `server/src/db.js:985-986` (`REQUIRED_SLOTS` and `COMPONENT_SLOTS`, as `Set`s), `:990`
  (`WEAPON_GROUP`), and the `|| 'gun'` fallback at `:1143` (in `equipItem`);
- client: `client/src/shop.js:31-32`, `client/src/sim-core/components.js:17` (`shipMass`), and
  `client/src/shop-slots.js:13` (`GROUP_WEAPON_TYPE`).

1. `client/src/sim-core/shop-rules.js`: add these.
   ```js
   // Equipment slots. COMPONENT_SLOTS in render order (Loadout chips); REQUIRED_SLOTS can't be empty at take-off
   // and can't be sold while equipped. One list for the shop UI, the sim's mass sum and the server's gates.
   export const REQUIRED_SLOTS = ['hull', 'engine', 'thruster'];
   export const COMPONENT_SLOTS = ['hull', 'engine', 'thruster', 'repair', 'grab', 'shield'];
   ```
2. `client/src/shop-slots.js`: add one pure helper. Also correct the header comment at `:9-10`: the server
   now **derives** its routing from this map.
   ```js
   // Which fire group a catalog weapon `type` installs into, or null when no slot takes it.
   export const weaponGroupOf = (type) =>
     Object.keys(GROUP_WEAPON_TYPE).find((g) => GROUP_WEAPON_TYPE[g].includes(type)) ?? null;
   ```
3. `client/src/shop.js:31-32`: delete the two local arrays. Import `REQUIRED_SLOTS` and `COMPONENT_SLOTS`
   from `./sim-core/shop-rules.js`, which is already imported at `:19`, so extend that import. The uses at
   `:146`, `:315` and `:321` work unchanged.
4. `client/src/sim-core/components.js:17`: import `COMPONENT_SLOTS` from `./shop-rules.js` and loop over
   it. The values and order are identical, and weights are integers, so the mass is unchanged. This module is
   on the sim path, so run `22-trace-replay` (see Tests).
5. `server/src/db.js`:
   - Import `REQUIRED_SLOTS` and `COMPONENT_SLOTS` from shop-rules. Extend the existing import at `:11`. Also
     import `{ GROUP_WEAPON_TYPE, weaponGroupOf }` from `'../../client/src/shop-slots.js'`.
   - Replace `:985-986` with local `Set`s built from the shared arrays. Use distinct names so they do not
     shadow the imports, e.g. `const REQUIRED = new Set(REQUIRED_SLOTS); const COMPONENT = new Set(COMPONENT_SLOTS);`.
     Update the uses at `:1103`, `:1107`, `:1160` and `:1345`. At `:1345`, use `REQUIRED_SLOTS.filter(...)`
     directly.
   - Replace `WEAPON_GROUP` at `:987-990` with a **derived, exported** map, and rewrite its comment:
     ```js
     export const WEAPON_GROUP = Object.fromEntries(
       Object.entries(GROUP_WEAPON_TYPE).flatMap(([g, types]) => types.map((t) => [t, g])));
     ```
   - In `equipItem` at `:1143`, replace the fallback with:
     ```js
     const group = weaponGroupOf(item.type);
     if (!group) return { ok: false, status: 409, error: 'no slot for this weapon type' };
     ```
     The check must happen **before** any mutation. It does: nothing is written before this line in the
     weapon branch. `shopMutation` in `server.js:318` already forwards `{ status, error }`, so confirm the
     409 reaches the response.
6. **Client guard:** add to the existing `client/src/shop-slots.test.js`:
   - `weaponGroupOf('bullet') === 'gun'`, `('beam') === 'gun'`, `('rocket') === 'rocket'`,
     `('laser') === null`;
   - every entry of `REQUIRED_SLOTS` is in `COMPONENT_SLOTS`;
   - in the existing test at `shop-slots.test.js:25` ("a COMPONENT slot key is not a weapon slot…"), loop
     over `COMPONENT_SLOTS` imported from `./sim-core/shop-rules.js`, not the literal six-name list.
7. **Server guard:** new file `server/src/shared-contracts.test.js`. It is pure: it imports `db.js`, but
   only to read exports, and never queries. C7's tests go in the same file.
   - Invert `GROUP_WEAPON_TYPE` by hand in the test and `assert.deepEqual` it with `WEAPON_GROUP` from
     `./db.js`.
   - For **every** `type` in `catalog_seed.js WEAPONS` (`new Set(WEAPONS.map((w) => w.type))`), assert
     that `weaponGroupOf(type) !== null` and `WEAPON_GROUP[type]` is defined. This is the guard that matters
     on the new code: adding a new weapon type to the seed without a slot now fails here, instead of
     becoming an unequippable shop item.
   - The 409 path is covered by `weaponGroupOf('laser') === null` plus the `if (!group)` line. Do **not**
     insert a weapon row with an unknown type into `spacegame_test`. `node --test` runs the server test
     files concurrently against the same database, and other files read the catalog.

**Negative test:**
- With the old `db.js`, the new server test fails: `WEAPON_GROUP` is not exported, and `weaponGroupOf`
  does not exist.
- Stronger: export the old literal `WEAPON_GROUP` temporarily, then remove `'beam'` from
  `GROUP_WEAPON_TYPE.gun`. The inversion test must fail, because the old server still routes beam to gun.
  So must the "every seed weapon type has a group" test, because the seed has a beam.

Revert the mutation, then implement.

### C3 — sell rate (one source: `shop-rules.js`)

Copies today: `client/src/format.js:19-22` (`SELL_RATE`, `sellLabel`), `client/src/shop.js:514`
(`sellUnit`) and `server/src/db.js:991` (`sellPrice`, literal `0.75`). `client/src/format.test.js:35-40`
asserts the literal.

1. `client/src/sim-core/shop-rules.js`: add these.
   ```js
   // Resale: the credits a sale pays per unit. ONE rate for the server's /sell and the client's resale labels.
   export const SELL_RATE = 0.75;
   export const sellPrice = (price) => Math.floor((price | 0) * SELL_RATE);
   ```
2. `server/src/db.js:991`: delete the local `sellPrice` and import it from shop-rules (same import line).
   The uses at `:1094`, `:1113` and `:1121` stay.
3. `client/src/format.js`: delete `SELL_RATE`, `sellLabel` and their comment (`:19-22`).
   `client/src/format.test.js`: delete the `sellLabel` test (`:35-40`) and drop both names from the import at
   `:4`.
4. `client/src/shop.js`:
   - Drop `SELL_RATE` from the `format.js` import at `:6`.
   - Import `sellPrice` from shop-rules.
   - Replace `sellUnit` at `:514` with `sellPrice`, keeping its one use at `:528`.
   - Fix the comment at `:511` to say "via `sellPrice`".
5. **Guards:**
   - Client, in `client/src/sim-core/shop-rules.test.js`: `sellPrice(300) === Math.floor(300 * SELL_RATE)`,
     `sellPrice(0) === 0`, `sellPrice(undefined) === 0`. The test recomputes from `SELL_RATE`; it does not
     restate `0.75`.
   - Server, in `server/src/server.test.js`: edit the existing tests at `:1047` and `:1101` so the expected
     credit is `sellPrice(300)` and `n × sellPrice(150)`, using `sellPrice` imported from
     `../../client/src/sim-core/shop-rules.js`. Replace the literals `225` and `112`/`224` with these
     expressions, and update their comments. Do the same at `:1426-1427` (the `shop-price` test). Its comment
     says `floor(800 * 0.75) = 600`, and it asserts `sold.credits === 800`. Rewrite the assertion as
     `200 + sellPrice(800)`, where 200 is the balance after the purchase that `:1421` asserts, and fix the
     comment. Run `grep -n "0\.75\|\* 0\.75" server/src/*.test.js` and convert any other literal resale
     you find the same way.

**Negative test:** after step 1, but **before** step 2 (so `db.js` still has its own `0.75`), temporarily
set `SELL_RATE = 0.5`. The edited server tests must fail. For example, the server credits 225 against an
expected 150. Revert to `0.75`, do step 2, and confirm green.

### C4 — `POST /api/games` returns the progression; Character uses `liveProgress`

Today:
- `client/src/net.js:95-103` rebuilds level, XP and skill points by hand from
  `{experience, level, leveledUp, xpEarned}`, which is all `recordGame` (`server/src/db.js:784-801`) returns.
- `client/src/mainwindow.js:228-231` computes its own bar, with a literal `xpForNextLevel: 1000` fallback.

1. `server/src/db.js` `recordGame`: after the `UPDATE`, add
   `progression: await getProgression(playerId)` to the returned object. Keep every existing field. Update
   the function comment.
2. `client/src/progression.js`: add a pure seam. `net.js` imports `hud.js`, which imports three, so it can't
   be loaded under `node --test`.
   ```js
   // The progression to hold after a run is banked. A server that returns `progression` (the same object
   // GET active-ship returns) is the authority. An OLD server (or the itch build hitting one) only returns
   // the flat { experience, level } — rebuild from the curve, adding one skill point per level gained.
   export function adoptBankedProgression(prev, res) {
     if (res && res.progression) return { ...res.progression };
     const p = { ...(prev || {}) };
     const gained = Math.max(0, (res.level || 0) - (p.level || 0));
     const at = levelFromXp(res.experience);
     p.experience = res.experience; p.level = res.level;
     p.xpIntoLevel = at.into; p.xpForNextLevel = at.span;
     if (gained > 0) p.skillPoints = (p.skillPoints || 0) + gained;
     return p;
   }
   ```
3. `client/src/net.js:95-103`: keep the guard `res && G.activeShip && G.activeShip.progression`, widened to
   `(res.progression || typeof res.experience === 'number')`. Then:
   ```js
   G.activeShip.progression = adoptBankedProgression(G.activeShip.progression, res);
   G.earnedXp = 0;
   announceLevel(G.activeShip.progression.level);
   ```
   - Replacing the object instead of mutating it is the established pattern: `skillSpend` in
     `mainwindow.js` does `G.activeShip.progression = j.progression`.
   - Swap the `levelFromXp` import for `adoptBankedProgression`. Check that nothing else in `net.js` uses
     `levelFromXp`.
   - Keep the long comment, trimmed to describe the new flow.
4. `client/src/mainwindow.js` `renderCharacter` (`:225-233`):
   - Import `liveProgress` from `./progression.js`.
   - `const prog = (G.activeShip && G.activeShip.progression) || { level: 0, xpIntoLevel: 0, skillPoints: 0, skills: {} };`
   - `const live = liveProgress(prog, G.earnedXp);`
   - The bar width is `Math.max(0, Math.min(100, Math.round(100 * live.into / (live.span || 1))))`.
   - The level label uses `live.level`. The XP text uses `{ into: Math.round(live.into), span: live.span }`,
     the same rounding as `hud.js:110`.
   - `skillPoints` and `skills` still come from `prog`.
   - The markup, ids and classes do not change.
5. **Guards:**
   - Server, in `server/src/server.test.js`, next to the progression test at `:280`: register a player,
     `POST /api/games` with `xp: 2500`, then read `GET /api/players/<id>/active-ship`. Assert
     `body.progression` deep-equals `ship.progression`. Also spend one point and post a second game with
     `xp: 0`, so `skills` and `skillPoints` are non-trivial, and assert equality again. Assert that the old
     fields `experience`, `level`, `leveledUp` and `xpEarned` are still present.
   - Client, in `client/src/progression.test.js`:
     1. With `res.progression`, the result deep-equals it, **even when** it disagrees with the local
        recompute. For example, the server says `skillPoints: 1` after a spend, where the recompute would
        give 2. That is exactly the drift being removed.
     2. Without `res.progression`, the fallback reproduces the old behaviour: level, XP fields, and +N skill
        points for N levels gained.
     3. The input `prev` is not mutated.

**Negative test:**
- The new server test fails on the old `recordGame`, because `body.progression` is undefined.
- The client test fails before the seam exists, on the import. Stronger: temporarily make the seam ignore
  `res.progression`, which is the old behaviour. Test (1) must fail.

### C7 — shop-unlock triggers and starter ids (behaviour unchanged)

Today:
- `unlockShop` is in the `level-2` briefing actions (`server/src/catalog_seed.js:796`).
- `SHOP_MIN_LEVEL = 'level-2'` is at `db.js:41`, with its boot catch-up at `:478-482`.
- The final-level fallback `unlockShop` is at `db.js:699`.
- Weapon `1` is hard-coded at `db.js:481` and `:709`, and in the briefing's `replaceWeapon from: 1`
  (`catalog_seed.js:796`).
- Grab `29` and shield `31` are hard-coded in the backfills at `db.js:459-468`. The starter ship row lists
  them at `catalog_seed.js:465`. Its gun mount is weapon 1 at `:471`. Note that the mounts live under
  **`stats.mounts`**; only `components` is a top-level field of a `SHIPS` row.
- `FACTORY_GATE = 'level-4'` is at `catalog_seed.js:51`, and `SIDE_MISSIONS_MIN_LEVEL = 'level-4'` at
  `db.js:42`.
- There is a stale `` `level-5` `` in the comment at `catalog_seed.js:915`.

1. `server/src/catalog_seed.js`, right after `SHIPS` (it must sit **before** `LEVELS` at `:678`, which uses
   it):
   ```js
   // The new player's ship, and the gun it flies with. The shop unlock, its boot catch-up and the Level-2
   // Machine-Gun swap all name this gun; the grab/shield backfills (db.js) name its components.
   export const STARTER_SHIP = SHIPS.find((s) => s.type === 'player');
   export const STARTER_WEAPON_ID = STARTER_SHIP.stats.mounts.find((m) => m.group === 'gun').weapon;
   ```
   - Read the gun from `STARTER_SHIP.stats.mounts`, not `STARTER_SHIP.mounts`. A ship row has no top-level
     `mounts`, so the wrong path throws at module load.
   - Check that `ensureDefaultShip` (`db.js:492-500`) picks the same row: the lowest-id `type = 'player'`
     ship. The seed lists the starter ship first, so `find` agrees with it.
   - Use `from: STARTER_WEAPON_ID` in the level-2 `replaceWeapon` action at `:796`.
   - Fix the comment at `:915`: replace `` `level-5` `` with
     `` `level-4` = SIDE_MISSIONS_MIN_LEVEL ``.
2. `server/src/db.js`:
   - Extend the `catalog_seed.js` import at `:9` with `STARTER_SHIP` and `STARTER_WEAPON_ID`.
   - `:481`: pass `STARTER_WEAPON_ID` as a second parameter (`$2`) instead of the literal `1`.
   - `:709` (`unlockShop`): use the parameter `$2 = STARTER_WEAPON_ID`, and fix the comments at `:697-698`
     and `:703-704`.
   - `:463` and `:468` (the backfills): parameterise as `jsonb_set(components, '{grab}', to_jsonb($1::int))`
     with `STARTER_SHIP.components.grab`, and likewise for the shield with `STARTER_SHIP.components.shield`.
     Keep the `NOT (components ? 'grab')` guards, and keep the DECISIONS §40 comment.
3. **Server guards**, in `server/src/shared-contracts.test.js`. These are pure: they read the seed and the
   `db.js` exports.
   - `LEVELS.filter((l) => (l.descriptor.briefing?.actions || []).some((a) => a.type === 'unlockShop')).map((l) => l.name)`
     deep-equals `[SHOP_MIN_LEVEL]`.
   - `FACTORY_GATE === SIDE_MISSIONS_MIN_LEVEL`. Its message should say that the two gates share a level
     today (§91), and that if a design change separates them, the test must be edited deliberately.
   - `STARTER_WEAPON_ID` is the `from` of the `replaceWeapon` action in the `SHOP_MIN_LEVEL` briefing.
   - `STARTER_SHIP.components.grab` and `.shield` are defined and exist as `COMPONENTS` rows with types
     `grab` and `shield`.
   - The existing DB-level tests already pin the behaviour and must stay green unchanged: the shop unlock at
     `server.test.js:847`, the "basic gun in stash" assertions, and the briefing actions at `:497-515`.

**Negative test:**
- Temporarily set `SHOP_MIN_LEVEL = 'level-3'` on the old code. The unlock-level test must fail. Revert.
- Temporarily set `SIDE_MISSIONS_MIN_LEVEL = 'level-3'`. The gate-equality test must fail. Revert.
- The starter-id tests fail on old code because the exports do not exist.

## Tests

Run these in this order. Ask the maintainer before the **visual** ones, per the standing rule. Unit and
server tests are expected.

- **Client unit:**
  `cd /Users/kbagaiev/Projects/ag-wt/2026-10-24-1836-dedup-shared-contracts/client && node --test`.
  The touched or new files are `src/sim-core/skills.test.js` (new), `src/sim-core/shop-rules.test.js`,
  `src/shop-slots.test.js`, `src/progression.test.js`, `src/format.test.js` and
  `src/sim-core/components.test.js`.
- **Server:**
  `cd /Users/kbagaiev/Projects/ag-wt/2026-10-24-1836-dedup-shared-contracts/server && npm test`. `pretest`
  drops and recreates `spacegame_test`. All worktrees share this local Postgres, so never run two
  `npm test`s at once.
- **Named visual scenarios.** `mainwindow.js`, `shop.js` and `net.js` import three, so `node --test` cannot
  load them. A broken import or a renamed constant there would be invisible to every unit test. Run
  `lsof -i :4173` first, use one invocation at a time, and run from `client/`:
  - `node visual/run.mjs 11-character-progression` — Character cards and XP bar (C1, C4);
  - `node visual/run.mjs 12-sell-confirm` — the sell dialog's per-unit price (C3);
  - `node visual/run.mjs 22-trace-replay` — determinism, required because `components.js` `shipMass` (C2)
    is on the sim path.

  Read what 11 and 12 assert before running them. If either pins the old `1000` fallback text or a
  `sellLabel` string, edit the scenario to the new source of truth, and list that edit in the run log.
- **Do not run** the full visual suite or the perf gate. Both are opt-in, and the default is to skip.

**Replay impact:** none expected.
- The only sim-core code change is `shipMass` iterating the same six slot names from an import.
- `SKILL_RATES` and `skillEffects` are untouched.
- `22-trace-replay` above confirms it.
- The intro is a live fight (DECISIONS §138), and nothing here touches damage, movement or RNG.

## Docs to update

- **CHANGELOG** (`docs/CHANGELOG.md`, under the existing `## 2026-10-24`, on top): one bullet, led by
  **Shared client/server contracts (duplication audit C1, C2, C3, C4, C7)**. It should cover:
  - the skill list in `sim-core/skills.js`, which the server columns, defaults, tools and Character cards
    all read;
  - the slot lists and sell rate in `sim-core/shop-rules.js`;
  - the server deriving `WEAPON_GROUP` from `GROUP_WEAPON_TYPE`, and refusing a weapon type with no slot
    (409, DECISIONS §167);
  - `POST /api/games` now also returning `progression`, which the client adopts;
  - the Character XP bar using `liveProgress` like the HUD;
  - the starter weapon and the grab/shield ids being read from the starter ship row;
  - the guard tests.
- **SUMMARY** (`docs/SUMMARY.md`). Bump `**Updated:**` (line 6) with a lead phrase for this change. Then
  edit in place:
  - `:2575`. This sentence is stale, because banking posts `xp` too. Make it say the client posts
    `{ credits, kills, durationMs, xp }` and the server returns the new balance plus the full `progression`.
  - `:3670-3674` (Game history & credits). The response is now `{ gameId, credits, experience, level,
    leveledUp, xpEarned, progression }`. The flat fields are kept for old clients.
  - `:2597-2598`. The resale value is computed client-side via `sellPrice` from `sim-core/shop-rules.js`,
    the same function the server's `/sell` uses. Remove `sellLabel`/`SELL_RATE`. Keep `:930`, `:2623` and
    `:3710` accurate: `floor(price·0.75)` is still the value, so add "(`SELL_RATE`, shop-rules.js)" where it
    helps.
  - `:1387` and `:5054` (`shop-slots.js`). `WEAPON_GROUP` is now *derived* from `GROUP_WEAPON_TYPE` on the
    server. Add `weaponGroupOf`, and say that an unknown type gets a 409 at `/equip`.
  - `:927` (shop-rules.js) and the sim-core file-map entry. List what `shop-rules.js` now holds:
    `isShopItem`, `REQUIRED_SLOTS`, `COMPONENT_SLOTS`, `SELL_RATE` and `sellPrice`. Add the new
    `sim-core/skills.js` (`SKILLS`, `skillColumn`) next to the `components.js` / `SKILL_RATES` mention
    around `:2240`.
  - `:2262` (the HUD XP bar via `liveProgress`): the Character screen's bar uses the same call.
  - The tests section around `:5170`: add the new guard files `skills.test.js` and
    `server/src/shared-contracts.test.js`.
- **DECISIONS** (`docs/DECISIONS.md`). Check the tail first: §166 is the last entry today, so §167 is free
  unless a parallel session took it. Add **§167. The server refuses a weapon type no slot takes**, with
  this content:
  - **Context:** duplication audit C2. The server routed unknown types to `gun`, while the client showed no
    slot.
  - **Choice:** derive `WEAPON_GROUP` from `GROUP_WEAPON_TYPE`, and return 409 for an unknown type.
  - **Alternatives:**
    - keep the `gun` fallback — rejected, because it lets the server install what the client can't show;
    - give every new type a slot automatically — rejected, because the slot is a design call.
  - **Consequence:** a new weapon type must be added to `GROUP_WEAPON_TYPE`, and
    `shared-contracts.test.js` fails until it is.

  Mention briefly that C3's `sellLabel` deletion and C4's keeping of the flat fields are recorded here and
  need no entry of their own.
- **Audit** (`docs/plans/2026-10-20-duplication-audit.md`):
  - In the summary table (`:78-84`), set the Status cell of C1, C2, C3, C4 and C7 to
    `**fixed 2026-10-24** (`<commit>`)`. Add `, §167` after the commit for C2. Leave the literal
    placeholder `<commit>`, which the orchestrator fills in after the merge.
  - Append ` — **fixed 2026-10-24** (`<commit>`)` to each section heading (`### C1.`, `### C2.`, `### C3.`,
    `### C4.`, `### C7.`), plus a one-line note under each pointing to this plan.
  - In the header status block at `:3-12`, move C1, C2, C3, C4 and C7 out of "Not planned yet".
- **Closeout plan** (`docs/plans/2026-10-24-duplication-audit-closeout.md`): under the `## Phase 1` heading,
  add `**Status:** done 2026-10-24 (`<commit>`), [plan](2026-10-24-1836-dedup-shared-contracts.md)`. Update
  the top `**Status:**` line (`:3`) to `Phase 1 done; Phases 2–8 not started.`

## Deploy and live-test (the orchestrator runs these after merge)

Client files change, so deploy to prod **and** re-publish itch (`/publish-itch`).

The itch build reads the catalog and API live from prod. Because the old response fields are kept, an itch
build that is not yet re-published still banks correctly against the new server.

Live-test checklist for the maintainer:
1. Fly any level, then return to base. The Character screen's level, XP bar and points match the HUD bar
   seen in flight.
2. Spend a point, fly again, return. The points count is right, with no phantom extra point.
3. In Loadout or Stash, a card's resale price equals what the sell actually credits.
4. Equip and unequip a gun, a beam (if owned) and a rocket. They go to the same slots as before.

## Out of scope / non-goals

- `client/src/sim-core/ship-entity.js:34` `resolveComponents`. It is an explicit object literal over the six
  slots. Rewriting it as a loop over `COMPONENT_SLOTS` buys nothing and touches every caller's
  destructuring, so leave it.
- `shop.js:153` `SHOP_TYPES`. These are shop tabs, not slots: they add `weapon`, and the order is different.
  Leave them.
- The XP-curve copy in `client/src/progression.js` vs `server/src/progression.js` (DECISIONS §103).
- Any change to when the shop unlocks, to what is granted, or to the side-mission gate (§90, §91, §95).
- C5, C6 and every other audit item. They belong to later phases of the closeout plan.
- Sending a server-computed `sellPrice` per stash row (the audit's alternative fix). The shared function is
  enough.
