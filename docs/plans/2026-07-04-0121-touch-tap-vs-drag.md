# Touch controls: tap-vs-drag over the whole play area (make chests + base station tappable, fix zoom buttons)

## Goal

On touch devices, on-screen objects — **loot chests** and (during return-to-base) the **base station** —
are not tappable across the left ~58% of the screen. Root cause: `#stick-zone` covers `left:0; width:58%`
with `pointer-events:auto` and swallows every touch there, so a tap meant for a chest/station in that
region becomes steering input and never reaches the canvas `click` handler. This change unifies touch input
as **tap-vs-drag over the whole play area**: a single-finger gesture that stays within a **10px slop**
counts as an **object tap** (runs the exact raycast the desktop click uses — nearest live chest wins over
the station on overlap), while a gesture that travels beyond 10px becomes the floating steering stick
(unchanged). Objects become tappable **anywhere** on screen and steering still works **anywhere**. Same
change also fixes a related regression that expanding the stick zone would otherwise cause/worsen: the
**zoom `+`/`−` buttons** (and the rocket button) must stay tappable during flight, so they must layer
**above** the now-full-screen stick zone.

## Decisions (already settled — do not re-ask)

- **Tap definition:** movement-only **slop of 10px, no time cap**. Any single-finger gesture that never
  travels >10px from its `touchstart` point is a **TAP**; once it exceeds 10px it is a **DRAG** (steering)
  for the rest of that gesture. Matches Android `ViewConfiguration` touch slop (8dp) / Hammer.js (9px);
  time is only used for long-press/double-tap, which we don't need. Threshold is a named const `TAP_SLOP = 10`.
- **Stick visual on touchstart:** **show the stick immediately** on `touchstart` (a tap may briefly flash
  the stick base/knob — acceptable). BUT a tap must **not** engage steering: `touchAim.active`/`thrust`
  must stay unset for any gesture inside the 10px slop (naturally true because 10px is inside the stick's
  dead zone, but the code must guarantee it and must clear the stick visual on release).
- **Pinch:** a **2nd simultaneous finger** switches to **pinch-zoom**, aborting any in-progress stick/tap
  for that gesture (steering + tap suppressed while two fingers are down); single finger = tap-vs-drag +
  steering. Pinch must feel exactly as it does today.
- **2nd-finger tap:** tap-vs-drag applies to the **single primary touch only**; the 2nd finger is reserved
  for pinch (no tap-while-steering).
- **Shared raycast:** factor the desktop click's object-pick (drop-then-station) into **one** function that
  both the desktop `click` and the touch tap call — do not duplicate the raycast.
- **Desktop mouse behavior:** unchanged.

## Background: exact current wiring (read before editing)

- `client/src/main.js:99-197` — the `if (Device.hasTouch) { ... }` block: `#stick-zone` touch handlers
  (`showStick`/`moveKnob`/`clearStick`, `touchstart`/`touchmove`/`endStick`), the fire + rocket buttons,
  and **pinch** (currently three listeners on `renderer.domElement`, lines 179-191, scoped to
  `e.targetTouches.length === 2`). Pinch works today only because touches on the right ~42% of the screen
  reach the canvas; once `#stick-zone` covers the whole area it will swallow them, so pinch **must** move
  into the stick-zone handlers.
- `client/src/main.js:211-237` — the raycast infrastructure: `stationRay`, `dropRay`, `eventNdc(e)`
  (maps `clientX/clientY` → game-space NDC via `toGame` — **rotation-aware**), `dropUnderPointer(e)`
  (nearest live drop or null), and the `renderer.domElement` `click` handler (line 229): a chest under the
  pointer wins (`engageDropAutopilot(drop)`), else the clickable station raycast (`engageAutopilot()` only
  when `G.returnToBase && G.baseStation && G.baseStation.active`).
- `client/styles.css:529-531` — `#touch { inset:0; pointer-events:none; z-index:5 }`, `#stick-zone
  { left:0; top:0; width:58%; height:100%; pointer-events:auto }`. `#fire-btn` is a later **sibling child**
  of `#touch` (so it paints above `#stick-zone` in the same z-index-5 context → stays tappable).
- `client/styles.css:553-562` — `#rocket-btn` is a **body-level** element (outside `#touch`) with **no
  z-index** (auto), so `#touch` (z-index 5) stacks above it. It works today only because `#stick-zone`
  doesn't cover its spot (`right:28px`). After expanding `#stick-zone` to full screen it **would be
  covered** → must be raised above z-index 5.
- `client/styles.css:563-575` — `#zoom` container is `z-index:6` (already above `#touch`), children
  `pointer-events:auto`. It is nominally above the stick layer, but this plan makes that explicit/verified
  and treats "zoom buttons tappable during flight on touch" as an acceptance requirement.
- `client/index.html:184-191` — DOM order: `#touch` → (`#stick-zone`, `#stick-base`, `#stick-knob`,
  `#fire-btn`) → `#rocket-btn` → `#zoom`.

## Steps

### 1. New pure module for the tap-vs-drag decision (unit-testable)

Create `client/src/tap-gesture.js`:

```js
// Tap-vs-drag classification for touch input. A single-finger gesture is a TAP until it travels beyond
// TAP_SLOP px from its touchstart point; once it does, it's a DRAG (steering) for the rest of the gesture.
// Matches platform touch-slop conventions (Android ViewConfiguration ~8dp, Hammer.js 9px). Pure (no DOM),
// so it's node-testable.
export const TAP_SLOP = 10;
export function exceedsSlop(x0, y0, x1, y1, slop = TAP_SLOP) {
  return Math.hypot(x1 - x0, y1 - y0) > slop;
}
```

**Invariant:** the caller feeds `exceedsSlop` **rotated game-space** coordinates (`toGame` output — the
same space the stick center lives in), so `TAP_SLOP = 10` and the stick's ~12px dead zone (`DEAD*R`) are
measured in one consistent space and are apples-to-apples. Never mix raw `clientX/clientY` with game coords
here.

### 2. Factor the shared object-pick in `client/src/main.js`

Immediately after `dropUnderPointer` (ends at `client/src/main.js:228`), add a single shared pick +
engage helper, then make the desktop `click` handler call it:

```js
// Shared object-pick for a pointer/tap event ({clientX, clientY}). A live chest under the pointer wins
// over the base station on overlap. Used by BOTH the desktop click handler and the touch tap. Returns
// true if it engaged an autopilot. (Rotation handled by eventNdc → toGame.)
function engageObjectAt(e) {
  const drop = dropUnderPointer(e);
  if (drop) { engageDropAutopilot(drop); return true; }
  if (!G.returnToBase || !G.baseStation || !G.baseStation.active) return false;
  stationRay.setFromCamera(eventNdc(e), camera);
  if (stationRay.intersectObject(G.baseStation.obj, true).length) { engageAutopilot(); return true; }
  return false;
}
```

Replace the body of the `click` listener (`client/src/main.js:229-237`) with:

```js
renderer.domElement.addEventListener('click', (e) => { engageObjectAt(e); });
```

Note: `engageObjectAt` only needs `clientX`/`clientY` on `e`, so the touch tap can call it with the raw
touch point `{ clientX: t.clientX, clientY: t.clientY }`.

### 3. Rewrite the touch input block to tap-vs-drag + relocated pinch (`client/src/main.js:99-197`)

Add the import near the other `./` imports at the top of `main.js`:

```js
import { TAP_SLOP, exceedsSlop } from './tap-gesture.js';
```

Replace the stick + pinch wiring inside `if (Device.hasTouch) { ... }` with the tap-vs-drag model. Keep
`showStick`/`moveKnob`/`clearStick`, `R`, `DEAD`, the fire button, and the rocket button as-is. Change the
gesture handlers (`touchstart`/`touchmove`/`endStick`) and **move pinch off `renderer.domElement` into the
stick zone**. Concrete sketch (adjust to match the surrounding code exactly):

```js
  let stickId = null;      // id of the touch holding the stick
  let stickCx = 0, stickCy = 0;   // game-space center of the stick (touchstart point)
  let startGX = 0, startGY = 0;   // game-space touchstart point, for slop measurement
  let dragged = false;     // gesture has exceeded TAP_SLOP → it's steering, not a tap
  let pinching = false;    // two fingers ON THE ZONE → pinch-zoom, suppress stick + tap
  let pinchDist = 0;
  const pinchD = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  // ... showStick / moveKnob / clearStick unchanged, EXCEPT clearStick also resets dragged:
  function clearStick() {
    stickId = null; dragged = false;
    touchAim.active = false; touchAim.thrust = 0;
    base.style.display = knob.style.display = 'none';
  }

  function beginPinch(e) {
    pinching = true;
    clearStick();                       // abort any in-progress stick/tap so its end never fires a tap
    pinchDist = pinchD(e.targetTouches[0], e.targetTouches[1]);
  }

  zone.addEventListener('touchstart', e => {
    // A 2nd finger ON THE ZONE switches to pinch (aborts stick/tap for this gesture). Count
    // e.targetTouches (fingers on #stick-zone only), NOT e.touches — a finger held on FIRE/rocket must
    // not be counted (holding fire while steering is a core two-thumb scheme; see DECISIONS §20/§42).
    if (e.targetTouches.length === 2) { beginPinch(e); e.preventDefault(); return; }
    if (stickId !== null || pinching) return;
    const t = e.changedTouches[0];
    const p = toGame(t.clientX, t.clientY);
    stickId = t.identifier; dragged = false;
    stickCx = startGX = p.x; stickCy = startGY = p.y;
    showStick(stickCx, stickCy);        // stick appears immediately (a tap may briefly flash it)
    moveKnob(stickCx, stickCy, p.x, p.y); // zero deflection → inside dead zone → no steering engaged
    e.preventDefault();
  }, { passive: false });

  zone.addEventListener('touchmove', e => {
    if (pinching && e.targetTouches.length === 2) {
      const d = pinchD(e.targetTouches[0], e.targetTouches[1]);
      if (d > 0 && pinchDist > 0) { zoomBy(pinchDist / d); pinchDist = d; }
      e.preventDefault(); return;
    }
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        const p = toGame(t.clientX, t.clientY);
        // Slop is measured in the SAME rotated game space as the stick center (toGame coords), so
        // TAP_SLOP=10 and the ~12px dead zone (DEAD*R) are apples-to-apples.
        if (!dragged && exceedsSlop(startGX, startGY, p.x, p.y, TAP_SLOP)) dragged = true;
        moveKnob(stickCx, stickCy, p.x, p.y);  // moveKnob only steers beyond the dead zone
        e.preventDefault();
      }
    }
  }, { passive: false });

  function endStick(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        // A gesture that never exceeded the slop is a TAP → run the shared object-pick.
        if (!dragged && !pinching) engageObjectAt({ clientX: t.clientX, clientY: t.clientY });
        clearStick();
      }
    }
    if (e.targetTouches.length < 2) { pinching = false; pinchDist = 0; }
  }
  zone.addEventListener('touchend', endStick);
  zone.addEventListener('touchcancel', endStick);
```

Then **delete** the three `renderer.domElement` pinch listeners (`client/src/main.js:179-191`) — pinch now
lives in the stick zone above. It counts **`e.targetTouches`** (fingers targeting `#stick-zone` only), the
same discipline DECISIONS §20 established on the canvas: a finger held on `#fire-btn`/`#rocket-btn` (their
own `pointer-events:auto` handlers) is a *sibling* target and is **not** in `#stick-zone`'s `targetTouches`,
so holding FIRE while steering never trips pinch. Do **not** use `e.touches` (all fingers on screen) — that
would count the fire finger and abort steering. Use `=== 2` (not `>= 2`) to match today's feel.
(`engageObjectAt` is defined later in the file at module scope, so it's in scope by the time a touch fires;
if hoisting/order is a concern, keep `engageObjectAt` as a `function` declaration — as written in Step 2 —
so it hoists.)

Notes for the implementer:
- `moveKnob` already leaves `touchAim.active=false` while deflection ≤ dead zone (`DEAD*R = 12px`), so a
  ≤10px tap never engages steering — the Decision's companion rule holds. Do not add steering on touchstart.
- `engageObjectAt` reuses `eventNdc`→`toGame`, so tap raycasts are rotation-correct on rotated phones.
- Keep the fire and rocket **button** handlers exactly as they are (lines ~165-173).

### 4. CSS: expand the stick zone, keep fire/rocket/zoom above it (`client/styles.css`)

- `client/styles.css:531` — make the stick zone cover the whole play area:

  ```css
  #stick-zone { position: absolute; inset: 0; pointer-events: auto; }
  ```

- `#fire-btn` needs no change (later sibling child of `#touch`, same z-index-5 context → already above
  `#stick-zone`).
- `#rocket-btn` (`client/styles.css:553`) — currently z-index auto, so the expanded `#stick-zone` (z-index
  5) would cover it. Raise it above the touch layer:

  ```css
  #rocket-btn { /* ...existing... */ z-index: 6; }
  ```

- `#zoom` (`client/styles.css:565`) is already `z-index: 6` (above `#touch`'s 5). Keep it 6 so the `+`/`−`
  buttons sit above the expanded `#stick-zone`; its buttons keep `pointer-events:auto`. **This layering is
  a *necessary companion* — it prevents the new full-screen-zone from covering the buttons — but it is NOT
  by itself proven to fix the maintainer's reported "can't press zoom during flight."** `#zoom` is already
  z-index 6 at `right:16px`, entirely outside today's left-58% zone, so keeping it 6 does not change zoom's
  relationship to the touch layer versus today. The actual current cause must be diagnosed in Step 5 before
  the fix is finalized.

No `index.html` change is required (DOM order already puts `#fire-btn` after `#stick-zone`, and `#rocket-btn`/`#zoom` outside `#touch`).

### 5. Zoom-during-flight bug — REPRODUCE + DIAGNOSE + FIX (do this before finalizing Step 4's zoom fix)

The maintainer confirmed the `+`/`−` buttons cannot be pressed during flight on touch. The full-screen
stick-zone layering (Step 4) is a *necessary companion* but may be a **no-op** for the actual cause — do
not ship on the z-index assertion. Instead:

1. **Reproduce** the failure on the touch harness/profile (or device): start a run, in active flight tap
   `+` and `−`, confirm the zoom does **not** change.
2. **Diagnose** the real DOM/event cause — check these candidates explicitly:
   - an element overlapping `#zoom` during flight (inspect the stacking/hit-test at the button's screen
     point: `document.elementFromPoint` at the button center during flight);
   - the buttons use a **`click`** listener (`client/src/main.js:205-206`) — a synthesized click may be
     suppressed by a `touchstart`/`touchmove` `preventDefault` on an ancestor/overlay, or by `touch-action`;
   - `pointer-events` on an ancestor (`#touch` is `pointer-events:none`, but confirm nothing else covers it);
   - the **rotation transform** (`body.rot`) shifting the buttons' hit region vs. their painted position;
   - the finger landing on `#stick-zone`/`#touch` instead of the button (before this change's expansion).
3. **Fix that cause** concretely. Likely remedies (apply the one the diagnosis points to): raise/confirm
   `#zoom` above the touch layer (companion fix above); and/or add touch handlers to the zoom buttons that
   call `zoomBy` directly on `touchstart`/`touchend` (mirroring `#fire-btn`/`#rocket-btn`, which already
   work during flight) instead of relying on a synthesized `click`; and/or `e.stopPropagation()` so the tap
   doesn't reach the zone. Keep it minimal (§30) — apply only what the diagnosis requires.
4. **Acceptance criterion (explicit, verified empirically):** *the zoom `+`/`−` buttons visibly change the
   zoom when tapped during active flight on touch.* Do not mark this done on reasoning alone.

### 6. Manual sanity (touch harness / device)

Verify on a touch profile (or the Playwright touch render): (a) tap a chest anywhere → autopilot flies to
it; (b) during return-to-base, tap the station anywhere → docks/wins; a chest overlapping the station still
wins; (c) drag anywhere → steering stick appears and steers; (d) **holding FIRE while steering** with a
second thumb still steers (does NOT become pinch); (e) fire, rocket, **zoom `+`/`−`** (Step 5 acceptance),
and two-finger pinch on the play area all work during flight; (f) a quick tap does not leave the ship
drifting (no steering engaged).

## Tests

- **Add** `client/src/tap-gesture.test.js` (mirror `client/src/autopilot-config.test.js` style — `node:test`
  + `node:assert/strict`), covering `exceedsSlop`:
  - within slop (e.g. `exceedsSlop(0,0,7,0)` and diagonal `exceedsSlop(0,0,7,7)` ≈ 9.9px) → `false`;
  - beyond slop (`exceedsSlop(0,0,11,0)`, `exceedsSlop(0,0,0,20)`) → `true`;
  - exactly at 10px is not "exceeds" (`> slop`, so `exceedsSlop(0,0,10,0)` → `false`);
  - `TAP_SLOP === 10`.
- **Run** the client unit suite: `cd client && node --test`.
- **Client visual suite** is known-flaky (~6 scenarios fail at baseline — see the visual-suite note): judge
  by the reliably-passing set + **zero page errors**, not a green board. This change is touch-gesture logic
  (no desktop-render change), so the visual baseline should be unaffected; confirm no new page errors.
- Server tests are untouched by this change (no `server/` edits) — no `db.js`/`db_postgres.js` work.

## Docs to update

- **`docs/SUMMARY.md`:**
  - Controls → **Touch** bullet (`~line 84-86`): replace the "steer toward direction" description to state
    the unified **tap-vs-drag** model — a single-finger gesture within **10px slop = an object tap** (runs
    the same raycast as the desktop click: nearest live loot chest wins over the base station →
    `engageDropAutopilot` / `engageAutopilot`), beyond 10px = the floating steering stick; steering + object
    taps both work **anywhere** on screen; a 2nd finger = pinch-zoom (aborts the stick/tap); fire/rocket/zoom
    buttons layer above the full-screen stick zone. Note `#stick-zone` now covers the whole play area
    (`inset:0`), not the old left 58%.
  - Controls → **Autopilot** bullet (`~line 68-79`) and **Return-to-base** section (`~line 454-469`):
    update "clicking/tapping it" wording to note that on touch, tapping the station/chest is the same
    slop-gated tap (not a raw touch-anywhere), and that taps reach the shared `engageObjectAt` pick.
  - Controls → **Zoom** bullet (`~line 80-83`): note the mobile `+`/`−` buttons and pinch remain usable
    during flight now that the stick zone is full-screen (buttons layered above it).
  - Bump the `**Updated:**` date.
- **`docs/CHANGELOG.md`:** add a bullet under `## 2026-07-04` (create the date heading above
  `## 2026-07-03` if missing). Lead bold, e.g. **"Touch tap-vs-drag."** — chests and the return-to-base
  station are now tappable anywhere on touch (the left-58% stick zone no longer swallows taps); single-finger
  <10px = object tap via the shared raycast, >10px = steering; a 2nd finger **on the play area** = pinch
  (holding FIRE while steering is unaffected — pinch counts `targetTouches`, not all fingers); the rocket +
  zoom buttons are layered above the now-full-screen stick zone; and the zoom `+`/`−` buttons are fixed so
  they visibly change zoom when tapped during active flight on touch (diagnosed cause per the plan's Step 5,
  not z-index alone). Record the actual root cause found for zoom in this bullet when known.
- **`docs/DECISIONS.md`:**
  - Add **§42** (next free number) recording the trade-off (see below).
  - **Amend §20** ("Camera zoom", `docs/DECISIONS.md:610`): its "Pinch vs. the steering stick" paragraph
    (`~line 622`) now goes stale — it says pinch listeners live on `renderer.domElement` and the stick zone
    is "left 58%", both false after this change. Append a short dated amendment (the file already uses that
    pattern) rather than rewriting the paragraph: e.g. *"Amendment 2026-07-04 (see §42): pinch listeners
    moved off `renderer.domElement` onto `#stick-zone`, which now covers the whole play area (`inset:0`),
    not left 58%. The `e.targetTouches` scoping is unchanged and is exactly why a finger held on
    FIRE/rocket isn't counted toward pinch — that reasoning still holds."* Preserve §20's original
    `targetTouches` rationale (Blocking-1's fix depends on it).

### DECISIONS §42 (write this entry)

Title: **Touch input unified as tap-vs-drag over the whole canvas (10px slop) instead of a fixed left-58%
stick zone.** Record: the old `#stick-zone` (`left:0; width:58%; pointer-events:auto`) claimed the left
region for steering and swallowed taps there, so on-screen objects (loot chests, the base station) were
untappable across most of the screen. Chosen: expand the stick zone to the full play area and disambiguate
per-gesture by **movement slop** — ≤10px travel = an object tap (reuses the desktop click's raycast),
>10px = steering. **Why 10px:** matches platform touch-slop conventions (Android `ViewConfiguration` ~8dp,
Hammer.js 9px); distance-only (no time cap) keeps it simple (§30) and lets a hold-still-then-release still
count as a tap. **Trade-off accepted:** a tap briefly flashes the stick base/knob (we show the stick on
touchstart rather than deferring), and taps + steering now share the whole surface, so a 2nd finger is
reserved for pinch (no tap-while-steering). Pinch moved from `renderer.domElement` onto the full-screen
`#stick-zone` but still counts **`e.targetTouches`** (per §20), so a finger held on FIRE/rocket is not
counted and holding fire while steering is preserved. Alternative rejected: keep the 58% zone and add tap detection
only on the right 42% canvas — that leaves objects untappable on the left, which is the whole bug.

## Out of scope / non-goals (do not gold-plate — DECISIONS §30)

- **No** time-based gestures (long-press, double-tap) — slop distance only.
- **No** deferring the stick visual until threshold — show it on touchstart (decided).
- **No** 2nd-finger tap-while-steering; the 2nd finger is pinch only.
- **No** change to desktop mouse behavior, hover cursors, the raycast math, or `engageAutopilot`/
  `engageDropAutopilot`/`canDock` logic — only the input plumbing changes.
- **No** new controls, gesture config, or settings; **no** server/DB changes.
- **No** model/asset/catalog change → **no** `/publish-itch` step needed for this feature.
