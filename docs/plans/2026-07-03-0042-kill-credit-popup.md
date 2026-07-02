# Kill credit popup — implementation brief (Vega Sentinels)

> Self-contained handoff for the implementation session. Adds a short floating **"+xx" credit popup** at
> each destroyed enemy's position, showing the credits earned for that kill. It floats up and fades over
> ~1 s, projected world→screen every frame (mirroring the off-screen enemy markers). Grounded in the
> current code — file:line refs were accurate at planning time; re-verify before editing.
> English/numeric only per the project's English-only rule.

## Goal
When an enemy ship is destroyed the player already gains `e.reward` credits (`client/src/sim.js:451`,
`G.earned += e.reward || 0`), but the gain is silent apart from the top-right counter. Add a small gold
**`+25`** popup that spawns at the dying ship's world position, drifts upward in screen space, and fades
to nothing over ~1 s. It gives immediate, satisfying feedback that a kill paid out, and reads the exact
amount. It's a pure cosmetic HUD overlay — no gameplay, economy, or server changes.

## Decisions (confirmed with maintainer — do not re-ask)
1. **Style:** gold `+25` text (reuse the credits accent `#ffd86b`), ~16 px bold, dark drop-shadow for
   legibility over any background. Screen-space upward drift (~40 px) while opacity fades 1→0 over
   **1.0 s**.
2. **Zero-reward kills:** skip the popup entirely when `reward <= 0` (only show real credit gains).
3. **Projection:** snapshot the dying ship's world position, then re-project that fixed point every frame
   so the popup stays glued to the kill location as the camera follows the player (NOT a CSS-only one-shot
   at a frozen screen pixel). Life is advanced by `dt` in `sim.js` (like `sparks`/`shockwaves`); `hud.js`
   only draws. Hidden/cleared while a **game-over/victory overlay** is up (guard
   `el.overlay.style.display !== 'none'`, mirroring `updateMarkers`), and cleared on restart (`reset()`).
   During **pause** popups **freeze in place** (no extra guard): pause skips the sim `update(dt)`, so
   their `life` stops advancing while the frozen frame keeps rendering — exactly how `updateMarkers`/the
   minimap behave. Note: pause is a **separate** element (`el.pauseOverlay`, id `pause-overlay`), not
   `el.overlay` (id `overlay`), so the overlay guard intentionally does NOT fire on pause.

## Data model — `client/src/state.js`
Add a transient array next to the other FX pools (after `client/src/state.js:62`, the `shockwaves` line):

```js
export const creditPopups = []; // floating "+xx" credit-gain popups at enemy death { pos, amount, life, maxLife }
```

Each entry is `{ pos: THREE.Vector3, amount: number, life: number, maxLife: number }`. `pos` is a
**cloned** snapshot of the death position (the enemy mesh is removed right after), so no `scene`/mesh
disposal is needed for these (they're DOM-only, unlike `sparks`).

## Spawn — `client/src/sim.js`
1. **Import** the new array. Extend the existing state import at `client/src/sim.js:7`:
   ```js
   import { G, bullets, explosions, sparks, shockwaves, trail, rockets, smoke, enemies, setPieces, CATALOG, keys, touchAim, SPAWN_GROW_TIME, creditPopups } from './state.js';
   ```

2. **Spawn at the kill site.** In the enemy-death loop, at `client/src/sim.js:451`
   (`G.earned += e.reward || 0;`), append after that line — before `scene.remove` already ran at
   line 448, but `e.mesh.position` was captured for the explosion at line 443, so read the reward and
   snapshot the position from `e` (still in scope):
   ```js
   const reward = e.reward || 0;
   G.earned += reward;           // credits (reward for this ship type)
   if (reward > 0) {             // floating "+xx" gold popup at the kill site (cosmetic feedback)
     creditPopups.push({ pos: e.mesh.position.clone(), amount: reward, life: 1.0, maxLife: 1.0 });
   }
   ```
   (Replace the existing `G.earned += e.reward || 0;` line with this block. Note the enemy mesh is already
   removed from the scene at line 448 but the object `e` and its `mesh.position` are still valid — clone
   before `enemies.splice`. Verify line numbers on read; the death loop is `for (let i = enemies.length-1
   ...)` around `sim.js:439`.)

3. **Advance + cull** each frame. Add a block alongside the other FX life loops (the `sparks` loop is at
   `client/src/sim.js:409`, `shockwaves` at `:425`). Add right after the `shockwaves` loop ends
   (`client/src/sim.js:436`), before the `// --- enemy deaths ---` comment:
   ```js
   // --- credit popups: "+xx" gold text that floats up and fades over ~1s (drawn by hud.js) ---
   for (let i = creditPopups.length - 1; i >= 0; i--) {
     creditPopups[i].life -= dt;
     if (creditPopups[i].life <= 0) creditPopups.splice(i, 1);
   }
   ```

4. **Clear on restart.** In `reset()` (`client/src/sim.js`, transient-clear block ~`:520`–`:534`), add
   after the `shockwaves.length = 0;` line (`client/src/sim.js:534`):
   ```js
   creditPopups.length = 0; // DOM-only, no scene meshes to dispose
   ```
   (`hud.js` also hides stale pool elements when the array is empty, but clearing keeps state tidy across
   runs.)

## Draw — `client/src/hud.js`
This mirrors `updateMarkers` (`client/src/hud.js:73`): a pooled DOM overlay, projected with
`THREE.Vector3.project(camera)` and positioned in game (rotated) dims via `gameW()`/`gameH()`.

1. **Import** the new array. Extend `client/src/hud.js:8`:
   ```js
   import { G, enemies, creditPopups } from './state.js';
   ```

2. **Add the pool + updater**, right after `updateMarkers` ends (`client/src/hud.js:94`):
   ```js
   // ---------- Credit popups: "+xx" gold text floating up from each kill, fading over ~1s ----------
   const popupPool = [];
   const _pp = new THREE.Vector3();
   function getPopup(i) {
     while (popupPool.length <= i) {
       const d = document.createElement('div');
       d.className = 'credit-popup';
       el.markers.appendChild(d); // reuse the fixed, full-screen, non-interactive markers container
       popupPool.push(d);
     }
     return popupPool[i];
   }
   export function updateCreditPopups() {
     // hide everything while there's no player or an overlay (game over / victory / pause) is up
     if (!G.player || el.overlay.style.display !== 'none') { for (const p of popupPool) p.style.display = 'none'; return; }
     const w = gameW(), h = gameH();
     let used = 0;
     for (const cp of creditPopups) {
       _pp.copy(cp.pos).project(camera);
       if (_pp.z > 1) continue;                    // behind the camera -> skip
       const t = 1 - Math.max(0, cp.life) / cp.maxLife; // 0 -> 1 over its life
       const x = (_pp.x * 0.5 + 0.5) * w;
       const y = (-_pp.y * 0.5 + 0.5) * h - t * 40; // drift up ~40px in screen space
       const p = getPopup(used++);
       p.style.display = 'block';
       p.style.left = x + 'px';
       p.style.top = y + 'px';
       p.style.opacity = String(1 - t);            // fade 1 -> 0
       p.textContent = '+' + cp.amount;
     }
     for (let i = used; i < popupPool.length; i++) popupPool[i].style.display = 'none';
   }
   ```
   Notes: popups are drawn even for on-screen positions (unlike markers, which only show off-screen). The
   pool grows to the max concurrent popup count and is reused. It lives in the same `#markers` container
   (fixed, full-screen, `pointer-events:none`, `z-index:4`) — no new DOM element needed in `index.html`.

3. **Pause behavior:** `updateCreditPopups` hides only while the game-over/victory overlay `el.overlay`
   is visible. Pause is a **separate** element (`el.pauseOverlay`, id `pause-overlay`), so the overlay
   guard does NOT fire on pause — and that's intentional: the sim loop skips `update(dt)` when `G.paused`
   (`client/src/main.js:363`), so popup `life` stops advancing and each popup **freezes in place** on the
   still-rendered frame until unpause, then resumes floating up and fading. This matches how
   `updateMarkers`/the minimap stay drawn-but-frozen during pause. Do **not** add a `G.paused` guard.

## Wire into the frame loop — `client/src/main.js`
1. **Import.** Extend `client/src/main.js:16`:
   ```js
   import { updateHud, updateMarkers, updateMiniMap, updatePerf, updateCreditPopups } from './hud.js';
   ```
2. **Call** it in the per-frame DOM-overlay pass, right after `updateMarkers();` (`client/src/main.js:366`):
   ```js
   updateMarkers();
   updateCreditPopups(); // floating "+xx" gold credit popups at kill sites
   ```

## Styles — `client/styles.css`
Add a `.credit-popup` rule next to the `.marker` block (`client/styles.css:578`), inside the same
`#markers` overlay:
```css
  .credit-popup {
    position: absolute; transform: translate(-50%, -50%); will-change: transform, opacity;
    color: #ffd86b; font-family: system-ui, sans-serif; font-weight: 700; font-size: 16px;
    letter-spacing: .3px; text-shadow: 0 0 4px rgba(0,0,0,.9); white-space: nowrap;
    pointer-events: none; display: none;
  }
```
(Gold `#ffd86b` matches the existing credits accent used at `client/styles.css:114`,`206`,`289`. The
container `#markers` already has `body.menu` hiding at `client/styles.css:335`, so popups stay hidden in
menus for free.)

## Tests
- **Run the existing client suite and keep it green:** `cd client && node --test`. No new unit test is
  added: the popup is DOM-projection glue analogous to `updateMarkers`, which has **no** unit test
  because `hud.js` imports the DOM (`dom.js` → `document`) and the Three renderer, so it isn't importable
  under `node --test` (there's no `document`). Extracting the two-line fade/drift math into a testable
  helper module would be over-engineering (DECISIONS §30). Confirm the suite still passes and that
  `state.js`/`sim.js`/`main.js`/`hud.js` still parse (a failed import would break every test).
- **Visual/manual smoke:** the client visual suite (`cd client && node --test:visual` /
  `node visual/run.mjs`) has a known-flaky ~6-scenario baseline (MEMORY: visual-suite-flaky-baseline) —
  judge by the reliably-passing set and **zero new page errors**. Manually: start a game, destroy an
  enemy, confirm a gold `+25` (matching that ship's reward) floats up from the kill point and fades in
  ~1 s; confirm no popup appears for any reward-0 kill; confirm popups vanish on death/victory overlay and
  don't survive a restart. Pause mid-popup → the popup holds frozen in place; unpause → it resumes
  floating up and fades out.
- **No server changes** → no `server` test run needed; `db.js`/`db_postgres.js` untouched.

## Docs to update
- **`docs/SUMMARY.md` — HUD section:** after the "Off-screen enemy markers" bullet
  (`docs/SUMMARY.md:118`–120), add a bullet:
  *"**Kill credit popups** — a gold `+xx` popup floats up from each destroyed enemy's position showing
  the credits earned, fading over ~1 s (`updateCreditPopups`, a pooled DOM overlay in the `#markers`
  container; `creditPopups` FX array spawned in `sim.js` on enemy death, skipped when reward ≤ 0). Hidden
  while an overlay is up and cleared on restart."* Bump the `**Updated:**` date at the top.
- Optionally cross-reference from the **Ship destruction** entry (`docs/SUMMARY.md:576`) that the death
  also spawns the credit popup.
- **`docs/CHANGELOG.md`:** add a bullet under today's date (`## 2026-07-03`, create if missing), e.g.
  *"**Kill credit popups** — destroying an enemy now shows a short gold `+xx` popup floating up from the
  kill site (credits earned), fading over ~1 s; pooled DOM overlay projected each frame like the enemy
  edge markers. Cosmetic only; skipped for reward-0 kills."*
- **`docs/DECISIONS.md`:** no new entry — this is a straightforward cosmetic overlay with no non-obvious
  trade-off.

## Out of scope / non-goals (do not gold-plate — DECISIONS §30)
- No sound for the popup (ship-explosion audio already plays).
- No stacking/merging, queuing, or de-dup of overlapping popups — simple overlap is fine.
- No popup for player death, level-complete `earned ×2` doubling, or shop/economy events — enemy kills only.
- No world-space (3D sprite) rendering, easing curves, scale-pop, or color-by-amount — linear rise +
  linear fade, single gold color.
- No new i18n string key — the text is pure numeric (`'+' + amount`), no translatable copy.
- No server, catalog, or `reward` value changes.
