# Enemy health bar sits above the model — implementation brief (Vega Sentinels)

> Self-contained handoff for the implementation session. Tiny presentation fix: the over-enemy HP bar
> currently centers on its world anchor, so its lower half dips into / merges with the ship model. Make
> the whole bar sit **above** the anchor with a small gap, and keep clearance proportional to model size.
> Grounded in the current code (file:line refs were accurate at planning time — re-verify). English per
> the project's English-only rule. DECISIONS §30 — smallest change that fully fixes it.

## Goal
For the player, the small translucent-red enemy health bar should always float **above** the enemy ship
model instead of overlapping it. Today `updateEnemyHealthBars` anchors the bar at `e.radius + 2` world
units above the enemy center and the `.enemy-hp` CSS uses `transform: translate(-50%, -50%)`, which
centers the bar on that anchor — so the bar's lower half sinks into the hull and reads as "merged with
the ship", especially on larger models. The fix pins the bar's **bottom edge** to the anchor (screen-space)
and lifts the anchor a touch more for big hulls, so the bar clears the model at any size/zoom.

## Decisions (chosen — do not re-ask)
- **Where the gap lives:** screen-space, via the CSS transform. Switching `translate(-50%, -50%)` →
  `translate(-50%, calc(-100% - 4px))` puts the bar fully above the anchor with a constant 4 px visual
  gap regardless of camera distance. This is the core fix and is robust to perspective (a world-only gap
  shrinks to nothing when the camera is far).
- **Anchor height:** keep it proportional to model size. `e.radius` already scales with model size
  (`radius = 2.6 * mc.scale`, `ship-build.js:93`), so the anchor already grows for heavy enemies. Bump the
  proportional term slightly so the bar clears taller hulls: change the world offset from `e.radius + 2`
  to `e.radius * 1.15 + 1.5`. (Small models: ~radius+1.5; large models: a bit more headroom.) Combined with
  the `-100%` transform the bar's bottom now rests ~that far above the model top.
- **Scope:** presentation only. No change to when the bar shows (still only while `hp < maxHp`), its
  width/fill, pooling, or the overlay-hide behavior.

## Steps

### 1. Pin the bar above its anchor — `client/styles.css:611` (`.enemy-hp`)
Current:
```css
  .enemy-hp {
    position: absolute; transform: translate(-50%, -50%); will-change: transform;
    width: 40px; height: 5px; border-radius: 3px; overflow: hidden;
    background: rgba(120, 20, 20, .28); box-shadow: 0 0 3px rgba(0, 0, 0, .6);
    pointer-events: none; display: none;
  }
```
Change **only** the transform so the anchor is the bar's bottom-center plus a 4 px gap:
```css
    position: absolute; transform: translate(-50%, calc(-100% - 4px)); will-change: transform;
```
Update the leading CSS comment (`styles.css:610`) to note the bar now sits fully above the anchor:
`/* Enemy health bar: a small translucent red bar that sits just above a damaged enemy (bottom edge pinned
to the projected anchor; in #markers, shown once hp < max) */`

### 2. Lift the world anchor proportionally — `client/src/hud.js:190`
In `updateEnemyHealthBars`, current line:
```js
    _hb.copy(e.mesh.position); _hb.y += e.radius + 2; // anchor just above the ship (depth-correct)
```
Change the offset (keep the projection/`_hb.z > 1` skip and everything else untouched):
```js
    _hb.copy(e.mesh.position); _hb.y += e.radius * 1.15 + 1.5; // anchor above the hull; bar's bottom edge pins here (depth-correct, scales with model size)
```

That is the entire code/CSS change.

## Tests
- Client tests run headless with `cd client && node --test`. There is no unit assertion on DOM pixel
  positions, so this is verified visually + by "no regressions":
  - Run the existing client suite (`cd client && node --test`) and confirm the reliably-passing set is
    unchanged and there are **zero page errors** (the visual suite has a known ~6-scenario flaky baseline —
    judge by the reliably-passing set, not an all-green run; see MEMORY "Visual suite flaky baseline").
  - Manual/visual check: load `client/index.html`, engage an enemy so it drops below max HP, and confirm
    the red bar floats clearly **above** the model with a visible gap — for both a small enemy and a large
    (high-`mc.scale`) enemy — and still tracks position as the enemy/camera moves.
- No server changes → no `server/npm test` / SQLite+Postgres parity impact.

## Docs to update
- **`docs/SUMMARY.md`** — the **Enemy health bars** bullet (~line 197). Update the wording so it states the
  bar's **bottom edge is pinned just above the model** (anchor `~e.radius*1.15 + 1.5` world units above
  center, CSS `translate(-50%, calc(-100% - 4px))`) rather than "floats just above". Bump the file's
  `**Updated:**` date.
- **`docs/CHANGELOG.md`** — add a bullet under today's date (`## 2026-07-04`, create/append):
  `**Enemy HP bar clears the model** — the over-enemy health bar now pins its bottom edge above the ship
  (CSS `translate(-50%, -100% - 4px)` + a size-proportional world anchor) instead of centering on the
  anchor, so it no longer merges with / dips into the hull (`hud.js` `updateEnemyHealthBars`, `styles.css`
  `.enemy-hp`).`
- **`docs/DECISIONS.md`** — no entry (no real trade-off; this is a straightforward presentation fix).

## Out of scope / non-goals (DECISIONS §30 — do not gold-plate)
- No change to bar visibility rules, fill color/width, size, pooling, or overlay-hide logic.
- No new player-ship health bar, no HP number/label, no fade/animation, no per-ship-type tuning knobs.
- No occlusion/z-testing against the model — the depth-correct anchor + fixed gap is sufficient.
- No asset/model/catalog changes → **no `/publish-itch` step needed** (nothing content-hashed changes).
