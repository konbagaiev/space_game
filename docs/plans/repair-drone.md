# Repair drone — implementation brief (Vega Sentinels)

> Self-contained handoff for the implementation session. Adds a 4th component type (repair drone),
> installed on the player's ship via the **level-3 briefing**, that passively repairs the hull in
> combat. Grounded in the current code (file:line refs were accurate at planning time — re-verify).
> English per the project's English-only rule. Part of ROADMAP Phase 1.

## What & why
A 4th ship component type alongside hull/engine/thruster: a **repair drone**. Base version:
**heal 1 HP every 3 s, up to a cap of 80% of max HP** (it tops you up to 80%, never higher; if you're
above 80%, it does nothing until you drop below). The player receives it **going into level 3** — the
level-3 briefing narrates the install and an `installComponent` action puts it on the active ship
(server-authoritative, persists). It then ticks passively during combat.

Design intent: makes the harder level-3 attrition fight more forgiving and rewards disengaging when hurt
(narrative hint: "peel off to a quiet corner"). Base version is **passive regen** — no "only when not
recently hit" gate yet (note that as a possible later upgrade tier).

## Briefing copy (replaces level-3 briefing text)
- **EN (`source.json` + inline `text:` fallback in catalog_seed):**
  "Good news, Sentinel — we salvaged a spare repair drone and fitted it to your ship. It'll patch up
  your hull mid-fight, a little at a time. If you take heavy damage, peel off to a quiet corner of the
  map and let it work."
- **RU (`ru.json`):** "Хорошие новости, Страж — мы нашли запасной ремонтный дрон и установили его на
  твой корабль. Он понемногу латает корпус прямо в бою. Если получишь серьёзные повреждения — отойди в
  тихий угол карты и дай ему поработать."

(Currently level-3 briefing is text-only with a machine-gun tactical hint; this copy replaces it and the
briefing gains an action. Keep "Sentinel"/"Страж".)

## Data model — `server/src/catalog_seed.js` (clean file)
1. **New component** in `COMPONENTS` (next free id; ids 1–11 used, so **id 12**):
   ```js
   { id: 12, name: 'Repair drone', type: 'repair', weight: 4,
     stats: { repairPerTick: 1, intervalSec: 3, maxFraction: 0.8 } },
   ```
   (`weight: 4` so it adds to mass like other components — tune. `type: 'repair'` is the new 4th type.)
2. **Level-3 briefing** (`LEVELS` → `level-3` → `descriptor.briefing`): it currently has only
   `textKey`/`text`. Add the new copy and an action:
   ```js
   briefing: {
     textKey: 'level.3.briefing',
     text: "Good news, Sentinel — we salvaged a spare repair drone ...",   // EN copy above
     actions: [ { type: 'installComponent', slot: 'repair', component: 12 } ],
   },
   ```

## Server — apply the action (server-authoritative, runs once on advance)
`server/src/db.js`:
- `applyBriefingActions` (≈ line 105) switch currently handles `replaceWeapon`
  (`replaceActiveShipWeapon`). Add a case:
  ```js
  if (a.type === 'installComponent') installActiveShipComponent(playerId, a.slot, a.component);
  ```
- Add `installActiveShipComponent(playerId, slot, componentId)` mirroring `replaceActiveShipWeapon`:
  set the active `player_ships` ship's `components[slot] = componentId` (persist the JSON). Follow
  exactly how `replaceActiveShipWeapon` reads/writes the active ship's loadout/components.
- **Mirror in `server/src/db_postgres.js`** — storage is pluggable, so the Postgres backend needs the
  same `installComponent` handling + setter. (Prod is Postgres.)
- **No DB migration needed** — `player_ships.components` already holds the loadout; we just set a slot.

## Client
`client/src/components.js` (clean, pure, unit-tested):
- Add `'repair'` to the slot list in `shipMass` so its `weight` counts toward mass.
- Add a pure helper, e.g.:
  ```js
  // Returns the new hp after dt seconds, given a repair component (or null) and an accumulator.
  // Heals repairPerTick every intervalSec, capped at maxFraction*maxHp; never reduces hp; no-op if
  // hp already >= cap or no drone. Caller holds the accumulator (seconds since last tick).
  export function repairTick(hp, maxHp, repairComp, dt, accum) { ... return { hp, accum }; }
  ```
  Keep it pure/stateless (accumulator passed in/out) so it's testable like `deriveDrive`.

`client/index.html`:
- **Build:** where the player ship is assembled (≈ line 842, `hp: hull.durability, maxHp: ...`), read
  the repair component from the ship's components via `CATALOG.components.get(ship.components?.repair)`
  (CATALOG.components is a Map, see ≈ line 1671) and stash `player.repair = comp?.stats || null` plus
  `player._repairAccum = 0`.
- **Tick:** in the game loop, while the game is active and `player.alive`, call `repairTick(...)` with
  the frame `dt`, updating `player.hp` and `player._repairAccum`. Respect the 80% cap. HUD at ≈ line
  1194 (`player.hp / player.maxHp`) will reflect it automatically.
- Gate: only tick during live combat (not on menus/hangar/overlays/paused).

## i18n
Update the `level.3.briefing` value in `client/locales/source.json` (+ its `context` note: now describes
the repair drone, not the machine-gun hint) and `client/locales/ru.json`, plus the inline `text:`
fallback in `catalog_seed.js`. Key stays `level.3.briefing` (abstract key, only the value changes).

## Tests
- **`server/src/server.test.js`:** the existing test asserts the level-3 briefing is *action-less*
  (≈ line 122) — **update it**: advancing into level-3 now returns a briefing whose action installs the
  repair drone; assert the active ship's `components.repair === 12` afterward.
- **`client/src/components.test.js`:** add `repairTick` cases — heals 1 per 3 s; clamps at 80% of maxHp;
  no-op when hp ≥ cap or when no drone; mass includes the repair weight.

## Balance note
1 HP / 3 s = ~0.33 HP/s, cap 80 HP on the 100-HP player. Slow on purpose. All knobs are data-driven in
the component stats (`repairPerTick`/`intervalSec`/`maxFraction`) — tune from playtests. Future tiers:
faster regen, higher cap, or "only when not hit for N s".

## Acceptance criteria
- Reaching level 3 shows the new briefing and installs the repair drone on the active ship
  (persisted server-side, both SQLite + Postgres).
- During level-3 combat the hull slowly repairs to 80% max and no higher; damage still works normally.
- Mass/handling reflect the added component weight.
- EN + RU briefing copy updated; key unchanged. All tests (incl. updated level-3 briefing test) pass.

## Coordination
Touches `catalog_seed.js` + `components.js` (clean) and `index.html` + `locales` + `db.js` +
`db_postgres.js` + `server.test.js` (some of these are in the in-flight **auth** session's uncommitted
set). Land it without clobbering that work — coordinate commit boundaries. No migration, so no migration-
number collision.
