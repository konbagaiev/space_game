# Plan: Camera Zoom-In / Zoom-Out (PC + mobile)

**Goal.** Let the player zoom the combat camera in/out on both desktop and mobile browsers, in a way
that's convenient on each. Keep the existing camera character: nearly vertical, rigidly attached to
the player, no rotation (see `docs/SUMMARY.md` "Controls"/"Visuals" + DECISIONS on the fixed camera).

**Input methods (decided with the user):**
- **PC:** mouse **wheel** + on-screen **＋/−** buttons.
- **Mobile:** on-screen **＋/−** buttons + **pinch** (two-finger).

All edits are in `client/index.html` (single-file client) unless noted. There is no camera unit test;
logic lives inline in `index.html`.

---

## Approach

Zoom = scale the camera offset vector `CAM_OFFSET` along its fixed angle. Smaller multiplier → camera
closer (zoom-in); larger → farther (zoom-out). This preserves the fixed, non-rotating, near-vertical
angle (no FOV change, no camera-type swap), so it's minimally invasive.

`CAM_OFFSET` is defined at **`client/index.html:513`**:
```js
const CAM_OFFSET = new THREE.Vector3(0, 110, 26); // fixed camera offset from the ship
```

---

## Step 1 — Zoom state + helpers (after `client/index.html:513`)

```js
// --- camera zoom: scale the offset toward/away along its fixed angle (smaller = closer/zoom-in) ---
const ZOOM_MIN = 0.6, ZOOM_MAX = 2.2;   // closest / farthest multiples of CAM_OFFSET
const camOffset = CAM_OFFSET.clone();   // effective offset used by the follow code (recomputed on zoom)
let camZoom = 1;
function setZoom(z){
  camZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  camOffset.copy(CAM_OFFSET).multiplyScalar(camZoom);
  try { localStorage.setItem('camZoom', camZoom.toFixed(3)); } catch {}
}
function zoomBy(f){ setZoom(camZoom * f); }
setZoom(parseFloat(localStorage.getItem('camZoom')) || 1); // restore saved zoom (clamped)
```

**Defaults (adjust if desired):** range `0.6–2.2`; steps — wheel `×1.12`/notch, button `×1.25`/press,
pinch continuous. Zoom is **persisted** across runs via `localStorage` key `camZoom`.

Range sanity at FOV 55: zoom-out ≈ half the ±240 arena in view (camera height ~242, far-plane 900 is
fine); zoom-in is a tight aiming view (height ~66).

## Step 2 — Use `camOffset` at the two follow sites

Both `client/index.html:2076` (per-frame follow) and `client/index.html:3125` (initial menu placement)
contain the identical line:
```js
camera.position.copy(player.mesh.position).add(CAM_OFFSET);
```
Replace `CAM_OFFSET` → `camOffset` at **both** (a `replace_all` on that exact line hits exactly these
two). Sky/stars parallax (`client/index.html:2080-2083`) reads `camera.position` and needs no change.

## Step 3 — HTML: zoom buttons (after `#rocket-btn`, `client/index.html:482`)

```html
<div id="zoom">
  <button id="zoom-in"  aria-label="Zoom in"  title="Zoom in">＋</button>
  <button id="zoom-out" aria-label="Zoom out" title="Zoom out">−</button>
</div>
```
`aria-label`/`title` are hardcoded English (matches `#pause-btn` at `client/index.html:466`; satisfies
the English-only rule).

## Step 4 — CSS (near `#rocket-btn`, around `client/index.html:345`)

```css
/* Zoom controls (+/-): PC + mobile. Hidden on menus like the rest of the HUD. */
#zoom {
  position: fixed; right: 16px; top: 50%; transform: translateY(-50%); z-index: 6;
  display: flex; flex-direction: column; gap: 8px; pointer-events: none;
}
#zoom button {
  pointer-events: auto; cursor: pointer; touch-action: manipulation; user-select: none;
  width: 44px; height: 44px; line-height: 1; font-size: 24px; font-weight: 700; color: #cfe0ff;
  background: rgba(20,30,55,.6); border: 1px solid rgba(140,175,255,.35); border-radius: 9px;
  display: flex; align-items: center; justify-content: center; text-shadow: 0 0 6px rgba(0,0,0,.8);
}
#zoom button:hover { background: rgba(40,60,100,.7); }
#zoom button:active { filter: brightness(1.3); }
```
Placement: right edge, vertically centered — clear of minimap (left edge center) and rocket/fire
(bottom-right). `z-index:6` sits above the touch layer (`#touch` is z5).

**Visibility:** add `#zoom` to the `body.menu … { display: none }` list at **`client/index.html:194`**
so it hides on the hangar/welcome menus like the rest of the in-fight HUD.

## Step 5 — Inputs: wheel + buttons (both platforms; place near the Input section, ~`client/index.html:1614`)

```js
// ---------- Zoom controls ----------
const ZOOM_WHEEL = 1.12, ZOOM_BTN = 1.25;
renderer.domElement.addEventListener('wheel', e => {
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 1/ZOOM_WHEEL : ZOOM_WHEEL); // scroll up = zoom in (closer)
}, { passive: false });
document.getElementById('zoom-in').addEventListener('click',  () => zoomBy(1/ZOOM_BTN));
document.getElementById('zoom-out').addEventListener('click', () => zoomBy(ZOOM_BTN));
```
Wheel is on the **canvas** (`renderer.domElement`): on menus the hangar/welcome DOM overlays sit above
the canvas, so wheel scrolls the shop there and only zooms over the bare in-fight canvas. The
transparent HUD layers (`#hud`, `#markers`, `#touch` container) are `pointer-events:none`, so wheel
passes through to the canvas during a fight.

## Step 6 — Pinch (mobile; inside the `if (isTouch)` block, after the stick/rocket wiring ~`client/index.html:1609`)

```js
// Pinch-to-zoom: two fingers over the open canvas area. Scoped to targetTouches so it never fights
// the steering stick (the stick lives in its own #stick-zone element with its own listeners).
let pinchDist = 0;
const pinchD = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
renderer.domElement.addEventListener('touchstart', e => {
  if (e.targetTouches.length === 2) pinchDist = pinchD(e.targetTouches[0], e.targetTouches[1]);
}, { passive: false });
renderer.domElement.addEventListener('touchmove', e => {
  if (e.targetTouches.length === 2 && pinchDist > 0) {
    const d = pinchD(e.targetTouches[0], e.targetTouches[1]);
    if (d > 0) { zoomBy(pinchDist / d); pinchDist = d; } // fingers apart (d↑) => ratio<1 => zoom in
    e.preventDefault();
  }
}, { passive: false });
renderer.domElement.addEventListener('touchend', e => {
  if (e.targetTouches.length < 2) pinchDist = 0;
}, { passive: false });
```
**Why no stick conflict:** `#stick-zone` covers the left 58% with `pointer-events:auto` and captures
those touches; the open right area of `#touch` is `pointer-events:none`, so touches there fall through
to the canvas. `targetTouches` counts only canvas-targeted fingers, so a stick finger is never counted
in the pinch, and pinch needs two fingers on the canvas.

---

## Docs to update (per project rules)

- **`docs/SUMMARY.md`** — "Controls": add zoom (PC: wheel + ＋/−; mobile: ＋/− + pinch; persisted). In
  the camera line (~`SUMMARY.md:152`): note the offset is scaled by zoom within `0.6–2.2`. Bump
  `**Updated:**`.
- **`docs/CHANGELOG.md`** — bullet under today's date: zoom controls added (inputs per platform,
  offset-scaling approach, persisted).
- **`docs/DECISIONS.md`** — short entry (next number): zoom via **offset scaling** (not FOV / camera
  swap) to preserve the fixed near-vertical angle; pinch scoped via `targetTouches` to avoid the
  steering-stick conflict.

## Verification

- `client/visual` Playwright render of `index.html` at 2–3 zoom levels → frame valid, ships in view
  (far-plane 900 covers max height ~242).
- Manual: PC wheel + buttons zoom; mobile buttons + pinch zoom; pinch doesn't break steering; the
  hangar shop still scrolls with the wheel on menus.
- No existing tests touch this (pure inline camera logic).

## Open items (defaults chosen above; change if you disagree)

1. Range `0.6–2.2` and steps (wheel 1.12 / button 1.25 / pinch continuous).
2. Button position: right edge, vertically centered (alt: stacked above the bottom-right rocket).
3. Persist zoom across runs via `localStorage` (currently: yes).
