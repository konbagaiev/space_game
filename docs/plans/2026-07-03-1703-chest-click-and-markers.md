# Chest click-to-autopilot, hand cursor, glint & off-screen chest markers

**Feature ID:** `2026-07-03-1703-chest-click-and-markers`
**Scope:** client-only. No server / API / DB / migration change (drops, autopilot, markers, cursor are
all client-side). No new asset → **no `CREDITS.md` change** (glint is a runtime material tweak of the
existing `metal_box_combat.*.glb`).

---

## Goal

Make loot **chests (drops)** interactive and discoverable, in four parts: (1) **click a chest → engage
autopilot** that flies the ship to it (the existing Grab then collects it in range); (2) **hand cursor**
(`cursor: grab`) while hovering a chest, mirroring the station `dock-cursor`; (3) **glint** — the drop
material is made near-chrome so it catches the scene's env-map + sun and reads as a shiny crate; (4)
**off-screen chests get a green edge arrow** reusing the enemy edge-marker projection math, in a
separate green-tinted pool. The user-visible effect: chests are easy to spot on- and off-screen, and one
click flies you over to grab them — during combat and during the return-to-base phase alike.

The load-bearing correctness change: **autopilot gains a `target`** (the station *or* a specific drop).
The station win-condition (`checkArrival`) must fire **only when the target is the station**, so a
chest-aimed autopilot can never trip the dock/victory.

---

## Decisions (all resolved — implement exactly these)

1. **Chest-click autopilot works in BOTH combat and return-to-base** — whenever a drop exists. Any
   control input cancels it (the existing §39 `manual` guard in `sim.js` already covers this).
2. **After the targeted chest is collected/removed → autopilot CANCELS** (ship coasts to a stop, control
   returns to the player). Do **not** auto-chain to another chest, and do **not** hand off to the station.
3. **`G.autopilot` carries a target.** New shape: `{ active, phase, target }` where
   `target ∈ { kind:'station' } | { kind:'drop', drop:<dropRef> }`. `checkArrival` / the station win fire
   **only** when `G.autopilot.active && target.kind === 'station'` && within `BASE_ARRIVE_RADIUS`. A
   drop-target autopilot is structurally incapable of winning the mission.
4. **Off-screen chest markers:** a single green `0x59e0a0` for all chest arrows, in their **own** DOM pool
   inside the existing `#markers` container, **capped to the nearest 6** off-screen drops. Reuse a shared
   edge-projection helper; keep the chest markers a distinct function + pool from the enemy markers.
5. **Glint = static material tweak.** Override the loaded drop glb's materials (and the fallback box) to
   `metalness ≈ 1, roughness ≈ 0.25`. No sparkle animation, no new machinery.
6. **Hand cursor = built-in `cursor: grab`** via a new `canvas.grab-cursor` CSS class, toggled by a
   throttled `pointermove` drop raycast (mirrors `setDockCursor`). Mouse only (gated on `!Device.hasTouch`).
   **Overlap priority:** a chest hover wins over station-dock hover; a chest click wins over a station click.
7. **Touch:** no hover cursor, but **tap-to-autopilot on a chest still works** (the `click` handler runs
   on touch too — a tap fires a synthetic click). Only the cursor is gated to mouse.

---

## Reuse map (existing code this builds on — cite, don't reinvent)

- Autopilot: `G.autopilot` in `client/src/state.js:58`; `engageAutopilot()` `sim.js:199`;
  `autopilotControl(dt,accel,turn)` `sim.js:168`; `checkArrival()` `sim.js:67`; `beginReturn()`
  `sim.js:62`; `BASE_ARRIVE_RADIUS` `sim.js:263`; the `manual`-cancel guard `sim.js:298–303`; the win
  teardown `win()` `sim.js:76`; start reset `sim.js:43`. DECISIONS §39.
- Station click + dock cursor: `main.js:208–238` (`stationRay`, the `click` listener, `setDockCursor`,
  `stationClickable`, the throttled `pointermove`). CSS `canvas.dock-cursor` `styles.css:611`.
- Drops: `drops[]` (`{ obj, item, weight, inRange }`) `client/src/drops.js:15`; `updateDrops(dt)`
  `drops.js:64` (arm timers + Grab pull + `collect`); `collect(d)` `drops.js:88`; `clearDrops()`
  `drops.js:97`; `fallbackBox()` `drops.js:42`; `normalize()` `drops.js:29`; material constants live in
  `drops-config.js`. DECISIONS §40.
- Off-screen markers: `updateMarkers()` `hud.js:73` (projection + edge-clamp math; `m.style.borderLeftColor
  = cssColor(e.color)` at `hud.js:90`); pool via `getMarker(i)` `hud.js:64`; container `#markers`
  (`dom.js:30`, CSS `.marker` `styles.css:578`). Called from the animate loop `main.js:399`.
- Env-map for glint: `scene.environment` PMREM of `RoomEnvironment` `engine.js:43–45`; combat `sun`
  `engine.js:99`. A low-roughness/high-metalness `MeshStandardMaterial` reflects both automatically.

---

## Steps

### 1. Generalize the autopilot target (state) — `client/src/state.js:58`

Change:
```js
autopilot: { active: false, phase: 'brake0' },   // click-to-fly to the base station (active == the mandatory "dock" gate)
```
to:
```js
// click-to-fly autopilot. target = the base station (return-to-base dock) OR a loot drop (fly to grab it).
// active + target.kind==='station' is the mandatory "dock" gate (only the station target can win the mission).
autopilot: { active: false, phase: 'brake0', target: null },
```
`target` is `{ kind:'station' }` or `{ kind:'drop', drop }` where `drop` is the element from `drops[]`.

### 2. Autopilot flies to its target, not always the station — `client/src/sim.js`

**2a. `autopilotControl` reads the target position** (`sim.js:168–170`). Replace the station lookup:
```js
function autopilotControl(dt, accel, turn) {
  const st = G.baseStation && G.baseStation.obj.position;
  if (!st) { G.autopilot.active = false; return; }
  const pos = G.player.mesh.position;
  const dx = st.x - pos.x, dz = st.z - pos.z;
```
with a helper that resolves the current target and **cancels cleanly if the drop is gone**:
```js
// Resolve the autopilot's current world-space goal. Returns null if the target vanished (drop collected
// by the passive Grab, drops cleared on reset) → the caller cancels the autopilot.
function autopilotTargetPos() {
  const tgt = G.autopilot.target;
  if (!tgt) return null;
  if (tgt.kind === 'station') return G.baseStation ? G.baseStation.obj.position : null;
  // kind === 'drop': valid only while the drop object is still in the live drops[] array
  return (tgt.drop && drops.includes(tgt.drop)) ? tgt.drop.obj.position : null;
}
```
Then in `autopilotControl`:
```js
function autopilotControl(dt, accel, turn) {
  const goal = autopilotTargetPos();
  if (!goal) { G.autopilot.active = false; G.autopilot.target = null; return; }
  const pos = G.player.mesh.position;
  const dx = goal.x - pos.x, dz = goal.z - pos.z;
  const dist = Math.hypot(dx, dz);
  const desired = Math.atan2(dx, dz);
  ...
```
Import `drops` at the top of `sim.js` — line 16 already imports from `./drops.js`
(`import { updateDrops, spawnDrop, pickLoot, clearDrops, takeLoot, DROP_CHANCE } from './drops.js';`);
add `drops` to that list. The rest of the brake/rotate/cruise phases are unchanged (they already work off
`dx/dz/dist/desired`). A drop-target autopilot naturally coasts to a stop next to the chest; the Grab's
in-range pull (`updateDrops`, arm delay `ARM_DELAY`, `COLLECT_DIST`) then collects it, `drops[]` shrinks,
`autopilotTargetPos()` returns null next frame, and the autopilot cancels — decision 2, no special-casing.

**2b. `engageAutopilot` takes a target** (`sim.js:199–202`). Replace:
```js
export function engageAutopilot() {
  if (!G.returnToBase || !G.player || !G.player.alive || levelRunner.won) return;
  G.autopilot.active = true; G.autopilot.phase = 'brake0';
}
```
with two entry points sharing one engage core:
```js
// Fly to the base station to dock (return-to-base only; this is the target that can WIN the mission).
export function engageAutopilot() {
  if (!G.returnToBase || !G.player || !G.player.alive || levelRunner.won) return;
  engage({ kind: 'station' });
}
// Fly to a loot drop to grab it. Valid whenever a live drop is clicked — combat AND return-to-base.
export function engageDropAutopilot(drop) {
  if (!G.player || !G.player.alive || levelRunner.won || !drops.includes(drop)) return;
  engage({ kind: 'drop', drop });
}
function engage(target) {
  G.autopilot.active = true; G.autopilot.phase = 'brake0'; G.autopilot.target = target;
}
```
Export `engageDropAutopilot` (add to the module's exports; it's used by `main.js`).

**2c. Win only when the target is the station** — `checkArrival()` `sim.js:67–75`. Route the dock
decision through the pure `canDock(autopilot, dist)` predicate extracted in **Tests** below (so the
station-target guard is unit-tested). Replace the body's guard + arrival check:
```js
if (!G.autopilot.active || !G.baseStation || !G.player || !G.player.alive) return;
const s = G.baseStation.obj.position;
const dx = G.player.mesh.position.x - s.x, dz = G.player.mesh.position.z - s.z;
if (Math.hypot(dx, dz) <= BASE_ARRIVE_RADIUS) this.win();
```
with:
```js
// Victory requires an ENGAGED autopilot whose target is the STATION (a chest-aimed autopilot must never
// win). canDock() encodes that + the arrive-radius; proximity alone never wins; any control input
// cancels the dock (clears G.autopilot.active).
if (!G.baseStation || !G.player || !G.player.alive) return;
const s = G.baseStation.obj.position;
const dx = G.player.mesh.position.x - s.x, dz = G.player.mesh.position.z - s.z;
if (canDock(G.autopilot, Math.hypot(dx, dz))) this.win();
```
Import `{ BASE_ARRIVE_RADIUS, canDock }` from the new pure `./autopilot-config.js` (see **Tests**) and
**remove** the local `const BASE_ARRIVE_RADIUS = 45;` at `sim.js:263` (it now lives in that module).
(`checkArrival` is only *called* while `this.returningToBase` — `sim.js:117` — so a combat-phase chest
autopilot never reaches it anyway; `canDock` is the belt-and-braces for the return-to-base overlap case.)

**2d. Clear `target` everywhere `active` is reset**, so no dangling reference survives a run:
- `levelRunner.start()` `sim.js:43`: `G.returnToBase = false; G.autopilot.active = false;` →
  append `G.autopilot.target = null;`
- `win()` `sim.js:80`: `G.returnToBase = false; G.autopilot.active = false;` →
  append `G.autopilot.target = null;`
- The `manual`-cancel line `sim.js:303` (`if (G.autopilot.active && manual) G.autopilot.active = false;`)
  → `if (G.autopilot.active && manual) { G.autopilot.active = false; G.autopilot.target = null; }`
- The two internal `G.autopilot.active = false` cancels in `autopilotControl` already set `target = null`
  (see 2a).

### 3. Click a chest → engage drop autopilot — `client/src/main.js:208–218`

The existing station click listener is gated on `G.returnToBase && G.baseStation.active`. Add a **drop
raycast first** (chest wins over station on overlap), and make it fire regardless of phase:
```js
const stationRay = new THREE.Raycaster();
const dropRay = new THREE.Raycaster();
// Map a canvas event → the game-space NDC used by every raycast here (accounts for the rotated view).
function eventNdc(e) {
  const p = toGame(e.clientX, e.clientY);
  return new THREE.Vector2((p.x / gameW()) * 2 - 1, -(p.y / gameH()) * 2 + 1);
}
// Nearest live drop under the pointer (null if none). Shared by the click handler AND the hover cursor.
function dropUnderPointer(e) {
  if (!drops.length) return null;
  dropRay.setFromCamera(eventNdc(e), camera);
  let best = null, bestD = Infinity;
  for (const d of drops) {
    const hit = dropRay.intersectObject(d.obj, true);
    if (hit.length && hit[0].distance < bestD) { bestD = hit[0].distance; best = d; }
  }
  return best;
}
renderer.domElement.addEventListener('click', (e) => {
  // 1) a chest under the pointer wins (works in combat AND return-to-base)
  const drop = dropUnderPointer(e);
  if (drop) { engageDropAutopilot(drop); return; }
  // 2) otherwise the clickable station (return-to-base only)
  if (!G.returnToBase || !G.baseStation || !G.baseStation.active) return;
  stationRay.setFromCamera(eventNdc(e), camera);
  if (stationRay.intersectObject(G.baseStation.obj, true).length) engageAutopilot();
});
```
Imports in `main.js`: add `engageDropAutopilot` to the `./sim.js` import (`main.js:20`); `drops` is
already imported (`main.js:15`). `toGame/gameW/gameH/camera` already imported. Reuse `eventNdc` to also
tidy the existing station raycast (optional but keeps one source of the NDC math).

### 4. Hand cursor on chest hover — `main.js:220–238` + `styles.css`

Add a grab-cursor toggle mirroring `setDockCursor`, and have the throttled `pointermove` prefer a chest
over the station:
```js
let grabCursorOn = false;
const setGrabCursor = (on) => { if (on !== grabCursorOn) { grabCursorOn = on; renderer.domElement.classList.toggle('grab-cursor', on); } };
```
In the existing `if (!Device.hasTouch) { ... pointermove ... }` block (`main.js:226–238`), after the
throttle, resolve the chest first (hand wins over dock):
```js
    lastHoverRay = now;
    const drop = dropUnderPointer(e);
    if (drop) { setGrabCursor(true); setDockCursor(false); return; } // chest hover wins over station dock
    setGrabCursor(false);
    if (!stationClickable()) { setDockCursor(false); return; }
    stationRay.setFromCamera(eventNdc(e), camera);
    setDockCursor(stationRay.intersectObject(G.baseStation.obj, true).length > 0);
```
Move the `if (!stationClickable()) { setDockCursor(false); return; }` guard that currently sits at the
top of the handler (`main.js:229`) to below the drop check (so hovering a chest still shows the hand even
when the station isn't clickable, e.g. mid-combat). Keep the early throttle `if (now - lastHoverRay < 50) return;`.

In the animate loop, the existing dock-cleanup line `main.js:404`
(`if (dockCursorOn && !stationClickable()) setDockCursor(false);`) — add a symmetric drop-cleanup so the
hand clears when the last chest is gone without a mouse move:
```js
  if (grabCursorOn && !drops.length) setGrabCursor(false);
```

CSS — after `canvas.dock-cursor` (`styles.css:611`) add:
```css
  /* "Grab this chest" cursor: hovering a clickable loot drop shows the OS grab hand (mouse only; the
     class is toggled on the WebGL canvas by main.js). Built-in cursor — no asset needed. */
  canvas.grab-cursor { cursor: grab; }
```

### 5. Glint — shinier drop material — `client/src/drops.js`

**5a. Fallback box** (`drops.js:44`): change
```js
const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.9, roughness: 0.4 });
```
to
```js
const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 1.0, roughness: 0.25 });
```

**5b. Loaded glb** — in `normalize(obj)` (`drops.js:29–39`), after recenter/scale, override each mesh
material so the crate catches `scene.environment` + the sun. Add before the `wrap`:
```js
  obj.traverse((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if ('metalness' in m) m.metalness = 1.0;   // catch the RoomEnvironment env-map (engine.js) + sun
        if ('roughness' in m) m.roughness = 0.25;  // low roughness → a crisp specular glint
        m.needsUpdate = true;
      }
    }
  });
```
This mutates the single shared `template` once at load (every drop clones it) — cheap, no per-frame cost.
Keep it in `drops.js` (not `drops-config.js`, which stays THREE-free for node tests). Add a one-line
comment noting the glint values.

### 6. Off-screen green chest markers — `client/src/hud.js` + wiring

**6a.** Add a new pooled draw function after `updateMarkers()` (`hud.js:94`). Reuse the projection/edge
math but a separate pool + green + a nearest-6 cap. First factor the shared per-point projection into a
tiny helper (used by both), or inline-copy — keep it simple:
```js
// ---------- Off-screen loot markers: green edge arrows toward off-screen drops (nearest N) ----------
const dropMarkerPool = [];
const DROP_MARKER_MAX = 6;                 // cap: only the nearest few, so the edges don't clutter
const DROP_MARKER_COLOR = '#59e0a0';
function getDropMarker(i) {
  while (dropMarkerPool.length <= i) {
    const d = document.createElement('div');
    d.className = 'marker drop-marker';    // reuse the .marker arrow shape; .drop-marker sets the green
    el.markers.appendChild(d);
    dropMarkerPool.push(d);
  }
  return dropMarkerPool[i];
}
export function updateDropMarkers() {
  if (!G.player || el.overlay.style.display !== 'none') { for (const m of dropMarkerPool) m.style.display = 'none'; return; }
  const w = gameW(), h = gameH(), margin = 0.92;
  // collect off-screen drops with their edge position + squared distance, keep the nearest DROP_MARKER_MAX
  const ppos = G.player.mesh.position, offs = [];
  for (const d of drops) {
    _ndc.copy(d.obj.position).project(camera);
    const behind = _ndc.z > 1;
    let x = _ndc.x, y = _ndc.y;
    if (behind) { x = -x; y = -y; }
    if (!behind && x >= -1 && x <= 1 && y >= -1 && y <= 1) continue; // on screen → no marker
    const k = margin / Math.max(Math.abs(x), Math.abs(y), 1e-4);
    const dx = d.obj.position.x - ppos.x, dz = d.obj.position.z - ppos.z;
    offs.push({ cx: x * k, cy: y * k, d2: dx * dx + dz * dz });
  }
  offs.sort((a, b) => a.d2 - b.d2);
  const n = Math.min(offs.length, DROP_MARKER_MAX);
  for (let i = 0; i < n; i++) {
    const { cx, cy } = offs[i];
    const m = getDropMarker(i);
    m.style.display = 'block';
    m.style.left = ((cx * 0.5 + 0.5) * w) + 'px';
    m.style.top = ((-cy * 0.5 + 0.5) * h) + 'px';
    m.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(-cy, cx) * 180 / Math.PI}deg)`;
  }
  for (let i = n; i < dropMarkerPool.length; i++) dropMarkerPool[i].style.display = 'none';
}
```
Import `drops` in `hud.js` — it is exported by `./drops.js` (`export const drops` at `drops.js:15`),
**not** by `state.js`. Add a **new import line** near the other `hud.js` imports (top of file, after
`import { G, enemies, creditPopups } from './state.js';` at `hud.js:8`):
```js
import { drops } from './drops.js'; // off-screen loot markers (no circular dep — drops.js does not import hud.js)
```
Do **not** add `drops` to the `./state.js` import — `state.js` has no such export, and doing so throws a
module-load `SyntaxError` ("does not provide an export named 'drops'") that breaks the whole client.
`_ndc`, `camera`, `gameW`, `gameH`, `el` are already in scope.

**6b.** Import + call it in the animate loop. `main.js:17` — add `updateDropMarkers` to the `./hud.js`
import. After `updateMarkers();` (`main.js:399`) add:
```js
  updateDropMarkers(); // green edge arrows toward off-screen loot drops (nearest 6)
```

**6c.** CSS — after `.marker` (`styles.css:584`) add the green override (fixed color, so no per-frame
`borderLeftColor` write like the enemy markers need):
```css
  /* Off-screen loot-drop arrows: same arrow shape as .marker, a fixed green so chests read as loot, not enemies */
  .drop-marker { border-left-color: #59e0a0; }
```

### 7. Reset / lifecycle safety

- `clearDrops()` (`drops.js:97`) already empties `drops[]` on `reset()` (`sim.js:675`). Because
  `autopilotTargetPos()` (step 2a) checks `drops.includes(tgt.drop)`, a reset mid-flight leaves the
  autopilot pointing at a removed drop → it cancels next frame. `reset()` doesn't touch `G.autopilot`
  today; the `levelRunner.start()` reset (step 2d) clears `active`/`target` on the new run. Confirm
  `reset()` path: if `reset()` runs without `levelRunner.start()` clearing autopilot, add
  `G.autopilot.active = false; G.autopilot.target = null;` in `reset()` (`sim.js:659`) alongside the
  existing `clearDrops()` call for defensiveness.
- Marker pools (`markerPool`, `dropMarkerPool`) are hidden — not destroyed — when there's no player /
  an overlay is up (the `el.overlay.style.display !== 'none'` guard), matching the enemy markers. No
  explicit teardown needed; the DOM nodes are reused across runs.

---

## Tests

`drops-config.js` stays THREE-free (glint lives in `drops.js`), so its node tests are unaffected. Add
pure-logic coverage where it's cheap and meaningful — do **not** try to test raycasts/DOM/cursors
headlessly (that's the `?debug`/visual suite's job).

- **Autopilot dock guard (new, node) — extract a pure predicate.** `sim.js` is **not** node-loadable
  (it imports THREE + `engine.js`/`world.js`), and there is no existing sim/autopilot test. So do **not**
  try to unit-test `checkArrival` directly. Instead extract the dock condition into a small THREE-free
  helper and test that. Put `BASE_ARRIVE_RADIUS` + the predicate in a pure module — the natural home is a
  new `client/src/autopilot-config.js` (import-free, like `drops-config.js`), or reuse `drops-config.js`
  if you prefer one pure-constants file:
  ```js
  export const BASE_ARRIVE_RADIUS = 45; // horizontal distance to the station that ends autopilot + wins
  // The dock/win predicate: true ONLY for a station-targeted, engaged autopilot within the arrive radius.
  // A drop-targeted autopilot can never dock. Pure (no THREE) → node-testable.
  export function canDock(autopilot, dist) {
    return !!autopilot && autopilot.active && autopilot.target?.kind === 'station' && dist <= BASE_ARRIVE_RADIUS;
  }
  ```
  Then `sim.js` imports `{ BASE_ARRIVE_RADIUS, canDock }` from it (replacing the local `BASE_ARRIVE_RADIUS`
  const at `sim.js:263`), and `checkArrival` (step 2c) becomes:
  ```js
  if (!G.baseStation || !G.player || !G.player.alive) return;
  const s = G.baseStation.obj.position;
  const dx = G.player.mesh.position.x - s.x, dz = G.player.mesh.position.z - s.z;
  if (canDock(G.autopilot, Math.hypot(dx, dz))) this.win();
  ```
  Add `client/src/autopilot-config.test.js` (`node --test`) asserting:
  - `canDock` is **false** when `target.kind === 'drop'` even at `dist = 0` (a chest-aimed autopilot
    never docks).
  - `canDock` is **false** when `active` is `false`, and when `dist > BASE_ARRIVE_RADIUS`.
  - `canDock` is **true** when `active`, `target.kind === 'station'`, and `dist <= BASE_ARRIVE_RADIUS`.
- **Nearest-N marker selection (optional, node):** if the sort/cap logic is extracted into a pure helper
  (e.g. `nearestOffscreen(list, max)`), unit-test it; otherwise skip (it's trivial inline DOM code).
- **Run:** `cd client && node --test`. Full manual/visual pass in a **real browser** (per DECISIONS §7,
  swiftshader diverges on hover/cursor): verify (a) clicking a chest flies the ship over and the Grab
  collects it, autopilot then stops; (b) the hand cursor on chest hover, dock cursor on station hover,
  chest winning on overlap; (c) the green off-screen arrows; (d) the glint under the combat sun; (e) the
  return-to-base case: clicking a chest during return does **not** win the mission, and clicking the
  station still docks. Server tests (`server && npm test`) are **not** affected — no server change — but
  the pipeline may still run them; they should pass untouched.

---

## Docs to update

- **`docs/SUMMARY.md`** — in the loot-drops/Grab section: add that a **drop is clickable → engages
  autopilot to fly to it (combat and return-to-base), with a `cursor: grab` hand on hover**, that drops
  now **glint** (near-chrome material catching the env-map/sun), and that **off-screen drops show green
  `0x59e0a0` edge arrows (nearest 6)**. In the return-to-base/autopilot section: note **`G.autopilot`
  now carries a `target` (station or drop); the dock/win fires only when the target is the station**.
  Bump the `**Updated:**` date.
- **`docs/CHANGELOG.md`** — under `## 2026-07-03`, a bullet: **"Chests are interactive"** — click a loot
  drop to autopilot over and grab it (combat + return-to-base), a grab-hand cursor on hover, a metallic
  glint, and green off-screen edge arrows; autopilot generalized to a station-or-drop target with the
  win gated to the station target.
- **`docs/DECISIONS.md`** — extend the story of §39/§40: a short entry (or an amendment note on §39)
  recording **autopilot target generalization** (station *or* drop) and the **win-only-when-target-is-
  station** guard — the trade-off being one shared autopilot with a typed target rather than a second
  parallel fly-to system, and why the guard is mandatory (a chest click must not complete the dock).
  Note the dock predicate + `BASE_ARRIVE_RADIUS` now live in a pure, unit-tested
  `client/src/autopilot-config.js` (extracted from `sim.js`).
- **No `CREDITS.md` change** (no new asset; glint reuses the existing `metal_box_combat.*.glb`).

---

## Out of scope / non-goals (DECISIONS §30 — don't gold-plate)

- **No new cursor PNG** — built-in `cursor: grab` only.
- **No sparkle/animation** for the glint — a static material tweak only.
- **No auto-chaining** between chests, no "queue of drops", no auto-collect-all. One click = one target;
  when it's collected the autopilot stops.
- **No drop despawn/lifetime changes**, no Grab-range/formula changes, no reward/loot-pool changes.
- **No mini-map dot for drops**, no on-screen (in-view) chest highlight/outline — only the off-screen
  arrow and the hover cursor.
- **No server/API/DB/migration change**, no publish-itch step (no content-hashed asset URL changed —
  the drop glb URL in `drops-config.js` is untouched; only its runtime material is tweaked).
