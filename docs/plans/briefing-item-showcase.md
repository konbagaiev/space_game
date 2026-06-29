# Mission-briefing item showcase — brief (Vega Sentinels)

> **Goal.** Make the early mission briefings more enticing by showing the **3D model of the gear the
> mission grants you**, spinning, next to the briefing text — so the eye-catching item draws the player
> into reading the description. Scoped to the **two early campaign levels that hand a free item**:
> - **Level 2** — grants the **Machine Gun** (weapon id 5; `replaceWeapon 1→5`).
> - **Level 3** — grants the **Repair drone** (component id 12; `installComponent repair→12`).
>
>   (These are "the first two missions" where the MG and drone are given free. Level 1 grants nothing;
>   Level 4 grants no item — its briefing only unlocks the shop — so it shows no item, just the player
>   ship as today. This is the intended reading; flagged so the executing agent doesn't widen scope.)
>
> **Depends on `docs/plans/component-weapon-models.md`** (the foundation): components/weapons must
> already carry `model_url_high` and the preview must already be a reusable ship-or-item viewer
> (`setPreviewModel(url, cfg)` + `itemModelCfg`). Do that brief first.
>
> **Planning window — execute when told.** Self-contained.

English-only (CLAUDE.md).

---

## The one hard constraint: actions don't reach the client

A level descriptor's `briefing` is `{ textKey, text, actions[] }` in the seed
(`server/src/catalog_seed.js`: level-2 `:369-376`, level-3 `:405-411`). But the server runs the actions
**server-side** and **only serializes `{ textKey, text }`** back to the client —
`runLevelBriefing` (`server/src/db.js:187-194`) returns the text, never the `actions`. The client
(`client/index.html`) stores that as `pendingBriefing` (`:2166`, set from `adv.briefing` `:2173`) →
`mainBriefing` (`showMain` `:2930`) → rendered into `#mw-mission-desc` by `renderMissionView`
(`:3015-3033`, text at `:3026-3027`).

**So the client cannot, by itself, know which item a briefing grants.** The fix: have the **server
include a `showcase` descriptor** in the briefing object it returns, derived from the briefing's own
actions. The client looks the item up in the catalog it already has (`CATALOG.weapons` /
`CATALOG.components`, which carry `modelUrlHigh` after the foundation brief) and renders it.

## Design decisions (resolved)

1. **Server derives `showcase` from the briefing's actions** — single source of truth, no duplicated
   data in the seed. `replaceWeapon {to}` → `{ kind:'weapon', id:to }`; `installComponent {component}` →
   `{ kind:'component', id:component }`; anything else (e.g. `unlockShop`) → no showcase. An **optional
   explicit `briefing.showcase` in the seed wins** if present (escape hatch for a future briefing that
   wants to show something other than what it grants). The server sends only `{ kind, id }` — **not** the
   model URL — because the client already has the catalog with the URLs.
2. **Render the item in the existing right-column preview panel** (`#mw-ship`, the 25% live preview),
   swapping it from the player ship to the granted item while a showcase briefing is on screen; revert
   to the ship when there's no showcase (level 4, side missions, post-briefing). This reuses the
   foundation's `setPreviewModel` with **zero new Three.js context** and the panel is already a
   prominent, labeled "here's your kit" slot. *(Alternative considered: a second dedicated canvas inside
   the work zone right beside the text — more adjacent to the description but needs a second viewer or
   DOM relocation. Not worth it for v1; revisit if the side panel doesn't pull the eye enough.)*

## Step 1 — Server: attach `showcase` to the returned briefing

In `server/src/db.js` `runLevelBriefing` (`:187-194`), after running the actions, compute a `showcase`
from the briefing's actions (or its explicit `briefing.showcase`) and include it in the returned object:
```js
function showcaseFromBriefing(b) {
  if (b.showcase) return b.showcase;                       // explicit override
  for (const a of (b.actions || [])) {
    if (a.type === 'replaceWeapon')   return { kind: 'weapon', id: a.to };
    if (a.type === 'installComponent') return { kind: 'component', id: a.component };
  }
  return null;
}
// …return { textKey: b.textKey, text: b.text, showcase: showcaseFromBriefing(b) };
```
**Postgres parity:** if `db_postgres.js` has its own `runLevelBriefing` / briefing-return path, apply the
identical change there (the `backend-parity-sqlite-postgres` rule — Postgres is untested). If both files
share one helper, factor `showcaseFromBriefing` so both use it.

> `showcase` is computed each time the briefing is fetched; it does **not** depend on whether the
> server-side actions actually ran (those run once, progress-forward). Showing the item is purely
> cosmetic, so deriving it every time is correct and idempotent.

No new API endpoint — `showcase` rides the existing advance/briefing response the client already reads.

## Step 2 — Client: render the showcased item in the preview

In `client/index.html`:

**(a)** `showMain(briefing)` already stores `mainBriefing = briefing` (`:2930`) and calls
`startShipPreview()` (`:2941`). After the preview starts, decide what it shows:
```js
// in showMain, after startShipPreview():
applyPreviewTarget();
```

**(b)** Add `applyPreviewTarget()` — picks the showcased item if the current briefing has one, else the
ship:
```js
function applyPreviewTarget() {
  const sc = mainBriefing && mainBriefing.showcase;
  if (sc) {
    const item = sc.kind === 'weapon' ? CATALOG.weapons.get(sc.id)
                                      : CATALOG.components.get(sc.id);
    const url = item && item.modelUrlHigh;          // items are hangar-only (foundation brief)
    if (url) { setPreviewModel(url, itemModelCfg(item)); return; }
  }
  // default: the active ship (existing behavior)
  setPreviewModel(activeShip.ship.modelUrlHigh || activeShip.ship.modelUrl,
                  shipModelCfg(activeShip.ship.stats));
}
```
(Adjust to the exact field access produced by the foundation refactor — `setPreviewModel(url, cfg)` and
`itemModelCfg` come from `docs/plans/component-weapon-models.md` step 6. `CATALOG.weapons` carries
`modelUrlHigh` only after that brief's step 5d fix.)

**(c)** Re-assert the target on the relevant transitions so the panel doesn't get stuck on an item:
- when the player **selects a side mission** in the menu, or the **primary** row — the item showcase is
  campaign-briefing-only, so `renderMissionView(m)` (`:3015-3033`) should set the preview back to the
  ship when `m` is a side mission (or when the primary briefing has no `showcase`). Call
  `applyPreviewTarget()` from `renderMissionView` (it already keys off `mwMission`/`mainBriefing`).
- on **take-off** the preview stops anyway (`launchCampaign` `:2948` / `launchMission` `:3058` call
  `stopShipPreview`), so no revert needed there.

**(d)** Graceful fallback: if the item has no `modelUrlHigh` (not yet authored) or the glb fails to load
(`gltfLoader` error path already `console.warn`s and keeps the prior content), the panel simply shows
the ship — no crash, no blank. The briefing text is unaffected.

## Step 3 — (optional polish) a caption / framing

To reinforce "this is the gear you're getting," consider a small localized caption under/over the
preview while a showcase is active — e.g. `ui.briefing.showcase` = "New: {item}" with the item name from
the catalog. i18n keys go in `client/locales/source.json` (+ `ru.json`), per the i18n convention. Keep it
optional — the spinning model alone meets the goal. If added, hide it when the preview shows the ship.

## Step 4 — Verify

Restart the local server (catalog reseed) and:
1. Reach the **level-2** briefing (clear level 1, or reset progress + advance) → the right preview panel
   shows the **Machine Gun** spinning; the description reads as today; **Take off** launches level 2.
2. Reach the **level-3** briefing → preview shows the **Repair drone**.
3. **Level-4** briefing (unlockShop) → preview shows the **player ship** (no item) — confirms the
   no-showcase path.
4. Select a **side mission** (after unlock) → preview reverts to the ship.
5. Confirm no console errors; confirm the item is centered/sized/oriented well (tune `stats.model` in
   the seed if not — that lives in the foundation brief's seed rows).

Use the visual harness if helpful (`client/visual/run.mjs`); a headless render of the Main Window in the
two briefing states is the cheapest check (see the `visual-verify-headless` convention).

## Step 5 — Docs

- **CHANGELOG.md** — bullet: mission briefings for level 2/3 now showcase the granted item's 3D model in
  the preview panel; server attaches a `showcase {kind,id}` (derived from the briefing actions) to the
  briefing response.
- **SUMMARY.md** — in "Between-level briefings" + "Ship-model preview": note the briefing response now
  carries `showcase`, and the preview panel shows the granted item (MG on L2, repair drone on L3) instead
  of the ship while such a briefing is up. Bump `**Updated:**`.
- **DECISIONS.md** — short entry: *why `showcase` is server-derived from actions and sent as `{kind,id}`*
  (the actions-don't-reach-the-client constraint above).

---

## Files this touches (quick map)

| Concern | File:anchor |
|---|---|
| Derive + return `showcase` | `server/src/db.js` `runLevelBriefing` `:187-194` (+ Postgres twin) |
| Briefing data (read-only ref) | `server/src/catalog_seed.js` L2 `:369-376`, L3 `:405-411` |
| Client briefing flow | `client/index.html` `pendingBriefing` `:2166-2173`, `showMain` `:2929-2942`, `renderMissionView` `:3015-3033` |
| Preview retarget | `client/index.html` `startShipPreview` `:3071-3101`, `setPreviewModel`/`itemModelCfg` (added by foundation brief) |
| i18n (optional caption) | `client/locales/source.json`, `ru.json` |
