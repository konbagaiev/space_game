# Autopilot (click-to-fly) + base-station return-to-base — build brief

> **Status:** planned. Feature ID `2026-07-03-1445-autopilot-return-to-base`.
> Two tightly-coupled features: a click/tap **autopilot** flight mode, and a **base-station** set-piece
> that changes how **every** mission ends — you fly back to the station instead of winning on the last kill.
> Self-contained: exact file paths + anchors below; all maintainer decisions are inlined so you never re-ask.

## Goal

Add a **base station** `.glb` set-piece at the shared world's origin `(0,0)` (the campaign/level-1 start).
Change **all** missions — campaign L1–4 **and** the three repeatable side missions — so that killing the
last enemy no longer wins immediately: instead the out-of-bounds warp-back is **lifted**, a translucent blue
world-space **arrow** points the player home, a centered **"Sector cleared — return to base"** HUD hint
shows, and the station becomes **clickable**. Tapping/clicking the station engages **autopilot**: the ship
brakes, rotates to face the station, accelerates at max, then brakes kinematically to coast to a stop right
next to it. **Clicking the station is a mandatory "dock" action** — once the ship has been sent there this way
and arrives (a proximity radius), the **existing victory** fires (bank credits, ×2 bonus, advance campaign /
repeat side mission); proximity without the click never completes. Enemies now spawn around the **mission zone center**, not around the
hero. Any control input instantly cancels autopilot and returns control to the player. User-visible effect: a
recognizable station to fly back to and a satisfying "warp me home" auto-flight, with side missions no longer
ending awkwardly far from the station they're meant to defend.

## Decisions (maintainer-approved — do NOT re-litigate)

1. **Station placement (Q1).** A **below-plane, non-collidable set-piece** (DECISIONS §17) like the freighter,
   but **raised closer to the combat plane** than the freighter (freighter sits at `y=-48`; the station sits
   higher, ~`y=-30`, tuned so it reads clearly while ships still fly *over* it — **no collision handling**).
   The implementer must check the model's **vertical extent after normalization** (not just its footprint) and
   **lower `y` / shrink `BASE_STATION_LEN` if the station's top breaches the combat plane** (`y ≈ 0.6`), so it
   never pokes through or occludes ships (§17: set-piece tops sit below the ships). Loads its own `.glb` (auto
   center/scale/`yaw`, no exhaust). "Reached" = **horizontal (xz) distance from the player to the station's
   `(0,0)`** ≤ `BASE_ARRIVE_RADIUS` (**default 45 units**, tune to the model footprint). The double-dot source
   is renamed to `base_station.glb` for the pipeline; a CC-BY row is added to CREDITS.md.
7. **The dock is a mandatory explicit click (maintainer clarification).** Proximity alone **never** wins. To
   finish **any** mission the player must **click/tap the station** — the deliberate "dock" action. Victory
   fires only when the ship has been sent to the station via that click **and** has arrived (within
   `BASE_ARRIVE_RADIUS`). Standing next to the station without clicking never completes the mission; if the
   player is already inside the radius when they click, it completes quickly. Any control input cancels the dock
   before arrival (no win) — the player can **re-tap** the station to resume. (Autopilot being engaged is the
   sole path to a win, which also makes any spawn-on-station insta-win impossible.)
2. **Autopilot braking (Q2).** The sim's release-brake (`IDLE_DRAG`) is **exponential decay** (`vel *= 1 −
   0.8·dt`) — it asymptotes and never fully stops — so the literal "brake at the midpoint" cannot stop cleanly.
   Autopilot instead uses a **kinematic brake with symmetric deceleration**: begin braking when remaining
   distance ≤ current stopping distance `v²/(2·accel)`, decelerating at a **constant rate equal to thrust
   `accel`**, so velocity reaches ~0 at the station. Autopilot ends when within `BASE_ARRIVE_RADIUS` (which
   also fires victory).
3. **Cancel (Q3).** **Any control input cancels autopilot** — movement (`W/S/A/D`, arrows, touch stick) **and**
   fire (`Space`/FIRE) **and** rocket (`F`/🚀). The literal reading: touch any control element → autopilot drops
   and the player has control the same frame. The station tap itself is a **canvas raycast**, ignored when the
   pointer lands on a HUD button (buttons are separate DOM elements over the canvas).
4. **Arrow + HUD hint (Q4).** A thin translucent **blue** 3D arrow (`opacity 0.4`, `fog:false`,
   `depthWrite:false`) lying just above the combat plane, **anchored to the ship** and re-pointed at the
   station each frame (~length 10 units), shown from the last kill until victory; **plus** a centered HUD hint
   styled like the OOB warning, new i18n key `ui.return.hint`, EN **"Sector cleared — return to base"**.
5. **Enemy spawn zone.** Enemies spawn in a ring around `arenaCenter` (the mission/arena center) instead of
   around the player (`ship-build.js`), keeping the existing 70–130u ring radius. Early in a fight the player
   is at center, so behaviour is unchanged then; after the player wanders, waves still originate at the zone.
6. **One runner change covers campaign + side missions.** Both play through the same `levelRunner`
   (`sim.js`), so intercepting the `win` phase there flips *every* mission to return-to-base with no per-level
   or per-mission descriptor edits. The `win` phase's existing `delay` (watch the boss explode) is preserved —
   the return prompt appears *after* the delay.

All text/comments/keys are **English** (CLAUDE.md).

---

## Part 1 — Base-station asset (pipeline)

Run from the worktree root `/Users/kbagaiev/Projects/ag-wt/2026-07-03-1445-autopilot-return-to-base`. See
`docs/plans/ship-model-pipeline.md`; scripts live in `scripts/`.

1. **Copy + rename the source** (the double-dot name → clean base name; `assets-src/` is gitignored and
   per-worktree, so copy from the main checkout):
   ```
   mkdir -p assets-src
   cp "/Users/kbagaiev/Projects/another_game_attempt/assets-src/future stations/base station/low_poly_space_station..glb" assets-src/base_station.glb
   ```
2. **Preview orientation** in a web glTF viewer (`gltf-viewer.donmccurdy.com`) — note which way it faces.
   Orientation matters far less here than for a ship (a station has no "nose"), but set `yaw` so the model
   reads well from the top-down camera. Default `yaw: 0`.
3. `npm run assets:build base_station` — emits `assets-dist/base_station_combat.<hash>.glb` (+ a hangar glb
   you can ignore — a set-piece is never shown in the menu preview). Low-poly pack model → default `combat`
   preset (heavy decimate + meshopt); no `PRESET_OVERRIDES` entry needed. Note the printed combat path
   `assets/ships/base_station_combat.<hash>.glb`.
4. `npm run assets:push` — uploads `assets-dist/` + source to S3 (`vega-sentinels-assets`), so CI's deploy-time
   `assets:pull` bakes the combat glb into prod.
5. Copy the built combat glb where the server serves it same-origin so it loads locally:
   `cp assets-dist/base_station_combat.<hash>.glb client/assets/ships/` (this dir is gitignored).
6. **`assets:check` is NOT affected** — a set-piece `modelUrl` lives on the map spec, not on
   `SHIPS`/`COMPONENTS`/`WEAPONS`, so `scripts/assets-check.mjs` does not validate it (same as the freighter,
   DECISIONS §38). `assets:pull` syncs the whole `ships-combat/` prefix regardless. Do **not** edit
   `assets-check.mjs`.

---

## Part 2 — Server: wire the station into the shared map (`server/src/catalog_seed.js`)

Add a `base-station` set-piece to the `home-system` map's `setpieces` array. It's at **`server/src/
catalog_seed.js:526`** (the array; freighter entry ends at **L539**). Add after the freighter entry (fill the
real hash from Part 1.3; set `yaw` from the Part 1.2 preview):

```js
// Base station set-piece at the world origin (0,0) = campaign/level-1 start. A below-plane, NON-collidable
// .glb decor (like the freighter) but raised closer to the combat plane so it reads clearly. It is the
// return-to-base target: after the last kill the client lifts OOB, shows a homing arrow + hint, and makes
// this station clickable (autopilot flies here → victory). y = -30 keeps it just under the plane (ships fly
// over it — no collision handling). See DECISIONS §39.
{
  type: 'base-station', pos: [0, -30, 0], scale: 1.0, spin: 0.03,
  modelUrl: 'assets/ships/base_station_combat.<hash>.glb',
  yaw: 0, // set from the glTF-viewer preview if a specific facing reads better top-down
},
```

`spin` is an optional slow idle rotation (0.03 rad/s) so the station has life; omit or set 0 for static. The
spec passes through the map API as plain JSON — no schema/migration/validation changes. **`db.js` /
`db_postgres.js` are untouched** (seed data only), so no backend-parity work is needed.

Catalog reseeds only on server startup → **restart the local server** after editing this file, or
`/api/maps/home-system` keeps serving the old spec.

**No `win`-phase edits** in `catalog_seed.js` (L371/L407/L447/L490) or `missions.js` (L29) — the return-to-base
gate is a `levelRunner` change (Part 4), so every existing `event: 'win'` phase becomes return-to-base for free
with its `delay` preserved.

---

## Part 3 — Client: build the station set-piece + track it (`client/src/world.js`)

`gltfLoader` is already imported (`world.js:8`); `buildSetPiece` is at **L535**; `makeFreighter` at **L463**
is the pattern to mirror (drop the exhaust).

**(a)** Add a `makeBaseStation(spec)` builder near the other set-piece helpers (e.g. just before
`buildSetPiece`, ~L534). Mirror the freighter's async center/scale/`yaw` normalization, no exhaust:

**Vertical-extent check (required):** after normalizing, verify the station's **top** (max world `y`, =
`spec.pos[1] + halfHeight` after the scale below) stays **below the combat plane** (`y ≈ 0.6`). A tall model can
breach the plane and occlude ships even when its footprint fits. If it does, **lower `spec.pos[1]` and/or reduce
`BASE_STATION_LEN`** until the top sits below the ships (§17). This is an eyeball tune during manual verify.

```js
const BASE_STATION_LEN = 160; // normalize the glb's longest axis; tune so the station reads clearly near the
                              // plane AND its top stays below y≈0.6 (don't let it poke through / occlude ships)

function makeBaseStation(spec) {
  const g = new THREE.Group();
  if (spec.modelUrl) gltfLoader.load(spec.modelUrl, (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size3 = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = BASE_STATION_LEN / (Math.max(size3.x, size3.y, size3.z) || 1);
    model.scale.setScalar(s);
    model.position.copy(center).multiplyScalar(-s); // recenter at group origin
    const pivot = new THREE.Group();
    pivot.rotation.y = spec.yaw ?? 0;
    pivot.add(model);
    g.add(pivot);
  }, undefined, (err) => console.warn('Base station model failed to load:', spec.modelUrl, err));
  const spin = spec.spin ?? 0;
  return { obj: g, update: (dt) => { if (spin) g.rotation.y += spin * dt; } };
}
```

**(b)** Register the type + store a gameplay reference. In `buildSetPiece` (L535–L547), add a case and, after
`entry.obj.position.set(...)`, stash the station on `G` so the sim/HUD/click code can find it:

```js
case 'base-station':     entry = makeBaseStation(spec); break;
```
and after `scene.add(entry.obj); setPieces.push(entry);`:
```js
if (spec.type === 'base-station') G.baseStation = { obj: entry.obj, active: false }; // return-to-base target
```

`buildMap` (L554) rebuilds set-pieces each run (clearing `setPieces` at L558–L559), so also **reset the
reference** there. Near `arenaCenter.set(0,0,0)` (**L562**) add:
```js
G.baseStation = null; // rebuilt by buildSetPiece below when the map has a base-station set-piece
```

Its `update(dt)` is already driven each frame by the existing set-piece loop (same contract as the freighter).

---

## Part 4 — Client: return-to-base flow + autopilot (`client/src/sim.js`)

### 4a. New shared state (`client/src/state.js`, the `G` bag at L17)

Add three fields **inside** the `G` object literal, next to the run-lifecycle scalars (approx L58 — that line
number was just past the object's closing brace; put them *inside* the braces, e.g. after `paused:`):
```js
returnToBase: false,                             // true after the last kill: OOB lifted, arrow + hint on, station clickable
autopilot: { active: false, phase: 'brake0' },   // click-to-fly to the base station (active == the mandatory "dock" gate)
baseStation: null,                               // { obj, active } — set by buildSetPiece; .active = clickable this run
```

### 4b. `levelRunner`: intercept the win phase with a return-to-base gate

In `sim.js`, `levelRunner` is at **L34**. Add a `returningToBase` flag to its initial fields (L35–L36) and:

- **`start(level)` (L38):** reset the gate + shared flags so a Restart starts clean:
  ```js
  this.returningToBase = false;
  G.returnToBase = false; G.autopilot.active = false;
  if (G.baseStation) G.baseStation.active = false;
  ```
- **`enterPhase()` win branch (L48–L53):** replace the `this.win()` calls with `this.beginReturn()`:
  ```js
  if (this.winPending <= 0) this.beginReturn();
  ```
- **`update(dt)` (L80):** in the `winPending` countdown (L84–L88) call `beginReturn()` instead of `win()`, and
  add an early return-to-base branch **before** the spawn block:
  ```js
  if (this.winPending > 0) { this.winPending -= dt; if (this.winPending <= 0) this.beginReturn(); return; }
  if (this.returningToBase) { this.checkArrival(); return; } // no more spawning; wait for the player to fly home
  ```
- **Add two methods** to `levelRunner`:
  ```js
  beginReturn() {
    this.returningToBase = true;
    G.returnToBase = true;                       // lifts OOB warp, shows arrow + hint (read by sim + HUD)
    if (G.baseStation) G.baseStation.active = true; // station becomes clickable
  },
  checkArrival() {
    // The dock is a MANDATORY explicit click: victory requires autopilot to be ENGAGED (only the station click
    // sets it) AND the ship within the radius. Proximity alone never wins; any control input cancels the dock
    // (clears G.autopilot.active) so a cancelled approach doesn't complete — the player re-taps to resume.
    if (!G.autopilot.active || !G.baseStation || !G.player || !G.player.alive) return;
    const s = G.baseStation.obj.position;
    const dx = G.player.mesh.position.x - s.x, dz = G.player.mesh.position.z - s.z;
    if (Math.hypot(dx, dz) <= BASE_ARRIVE_RADIUS) this.win();
  },
  ```
  `G.autopilot.active` is the "return engaged / docking" flag: it is set **only** by `engageAutopilot()` (the
  station click) and cleared by any control input, so it doubles as the mandatory-click gate — no separate flag
  is needed. If the player clicks while already inside the radius, `engageAutopilot()` sets it and `checkArrival`
  wins on the next frame (the autopilot controller is just braking).
- **`win()` (L55):** at the top, tear down the return-to-base state so the overlay/arrow/hint clear:
  ```js
  this.returningToBase = false;
  G.returnToBase = false; G.autopilot.active = false;
  if (G.baseStation) G.baseStation.active = false;
  ```
  The rest of `win()` (overlay, `bankRun`, `unlockNextLevel` for campaign only) is unchanged — this reuses the
  existing victory handling for both campaign and side missions.

Add a module constant near `IDLE_DRAG` (L153):
```js
const BASE_ARRIVE_RADIUS = 45; // horizontal distance to the station (0,0) that ends autopilot + fires victory
```

### 4c. OOB lift after the last kill

In `update(dt)`, the OOB block is L228–L233. Gate the warp on the return flag:
```js
if (G.player.oobTime >= OOB_RETURN_TIME && !G.returnToBase) warpPlayerToCenter();
```
And in `updateOobWarning()` (L139–L142) add `&& !G.returnToBase` to the `show` condition so the "left the
battlefield" warning hides while returning home.

### 4d. Autopilot controller

Add to the player-control section of `update(dt)`. Compute manual-input first (Q3: any input cancels), then
either run autopilot or the existing manual block. Replace the turn/thrust/brake region (L188–L208) structure
with:

```js
// Autopilot (return-to-base): ANY control input cancels it and hands control back immediately (DECISIONS §39).
const manual = touchAim.active
  || keys['KeyW'] || keys['ArrowUp'] || keys['KeyS'] || keys['ArrowDown']
  || keys['KeyA'] || keys['ArrowLeft'] || keys['KeyD'] || keys['ArrowRight']
  || keys['Space'] || keys['_rocket'];
if (G.autopilot.active && manual) G.autopilot.active = false;

if (G.autopilot.active) {
  autopilotControl(dt, accel, turn);   // sets heading + vel toward the station
} else {
  // --- existing manual turn / thrust / passive-brake block (L189–L208) stays here verbatim ---
}
```

(`accel`/`turn` are already in scope at L185–L186; the `controlling` var + passive brake at L205–L208 stay
inside the `else`.) Add the helpers near `forwardVec` (L119):

```js
function brakeStep(accel, dt) {
  const v = G.player.vel, sp = v.length();
  if (sp <= 1e-4) { v.set(0, 0, 0); return; }
  const dec = Math.min(sp, accel * dt);          // symmetric decel == thrust accel (Decision 2)
  v.addScaledVector(v.clone().normalize(), -dec);
}

// Click-to-fly: brake to a stop → rotate to face the station → accelerate at max → kinematic brake so the
// ship coasts to ~0 right at the station. `heading` convention matches forwardVec/touchAim: desired = atan2(dx, dz).
function autopilotControl(dt, accel, turn) {
  const st = G.baseStation && G.baseStation.obj.position;
  if (!st) { G.autopilot.active = false; return; }
  const pos = G.player.mesh.position;
  const dx = st.x - pos.x, dz = st.z - pos.z;
  const dist = Math.hypot(dx, dz);
  const desired = Math.atan2(dx, dz);
  const ap = G.autopilot;

  if (ap.phase === 'brake0') {                    // 1) full stop first
    brakeStep(accel, dt);
    if (G.player.vel.length() < 0.5) ap.phase = 'rotate';
  } else if (ap.phase === 'rotate') {             // 2) rotate the nose to face the station
    G.player.heading = steerToward(G.player.heading, desired, turn * dt);
    brakeStep(accel, dt);                         // bleed any residual drift while turning
    if (Math.abs(shortestAngleDelta(G.player.heading, desired)) < 0.05) ap.phase = 'cruise';
  } else {                                        // 3/4) accelerate, then kinematic brake
    G.player.heading = steerToward(G.player.heading, desired, turn * dt);
    const speed = G.player.vel.length();
    const stopDist = (speed * speed) / (2 * accel);
    if (dist > stopDist + 0.5) {
      const fwd = forwardVec(G.player.heading);
      G.player.vel.addScaledVector(fwd, accel * dt);
      emitExhaust(G.player.mesh, fwd, G.player.vel, G.player.engine.exhaust);
    } else {
      brakeStep(accel, dt);
    }
  }
}
```

`steerToward`, `shortestAngleDelta`, `emitExhaust`, `THREE` are already imported in `sim.js`. Arrival isn't
handled here — `levelRunner.checkArrival()` fires the win **only while autopilot is engaged** (i.e. after the
dock click, when the ship reaches the radius under autopilot). A **manual or cancelled approach does NOT
complete the mission** — the player must re-tap the station to resume the dock (the `!G.autopilot.active` guard
in `checkArrival` enforces this; do not remove it). Autopilot naturally stalls at the station until arrival.

Add an exported engage entry point (called by the click handler in Part 5):
```js
export function engageAutopilot() {
  if (!G.returnToBase || !G.player || !G.player.alive || levelRunner.won) return;
  G.autopilot.active = true; G.autopilot.phase = 'brake0';
}
```

### 4e. Homing arrow + HUD hint (world-space arrow + DOM hint)

Add to `sim.js` (it imports `scene`), and call both from the render loop (Part 6):

```js
let returnArrow = null;
function ensureReturnArrow() {
  if (returnArrow) return returnArrow;
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.4, fog: false, depthWrite: false });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 7, 8), mat);
  shaft.rotation.x = Math.PI / 2; shaft.position.z = 3.5;   // cylinder axis Y → lay along +Z
  const head = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3, 10), mat);
  head.rotation.x = Math.PI / 2; head.position.z = 8.5;
  g.add(shaft, head); g.visible = false; scene.add(g);
  return (returnArrow = g);
}
export function updateReturnArrow() {
  const on = G.returnToBase && G.player && G.player.alive && !levelRunner.won && G.baseStation;
  if (!on) { if (returnArrow) returnArrow.visible = false; return; }
  const a = ensureReturnArrow();
  const st = G.baseStation.obj.position, pos = G.player.mesh.position;
  a.position.set(pos.x, 2.5, pos.z);                        // anchored to the ship, just above the plane
  a.rotation.y = Math.atan2(st.x - pos.x, st.z - pos.z);    // point at the station (heading convention)
  a.visible = true;
}
export function updateReturnHint() {
  const show = G.returnToBase && G.player && G.player.alive && !levelRunner.won
    && el.overlay.style.display === 'none';
  if (!show) { el.returnHint.style.display = 'none'; return; }
  el.returnHint.style.display = 'block';
  el.returnHint.textContent = t('ui.return.hint');
}
```

---

## Part 5 — Client: tap/click the station → autopilot (`client/src/main.js`)

The canvas has no gameplay raycaster today (input is only the touch stick + fire/rocket buttons + wheel/pinch).
Add a single `click` listener on `renderer.domElement` (fires for canvas clicks on PC and canvas taps on touch;
HUD buttons are separate DOM elements, so they don't reach the canvas). The touch stick lives in its own
`#stick-zone` div (left 58%), so a tap there steers instead — acceptable; the player taps the station when it's
in the open canvas area.

- Extend the engine import (L10) to add `gameW, gameH`.
- Extend the sim import (L19) to add `engageAutopilot, updateReturnArrow, updateReturnHint`.
- After the zoom controls (~L205), add:
  ```js
  // Return-to-base: tap/click the base station to fly there on autopilot (only while the station is clickable).
  const stationRay = new THREE.Raycaster();
  renderer.domElement.addEventListener('click', (e) => {
    if (!G.returnToBase || !G.baseStation || !G.baseStation.active) return;
    const p = toGame(e.clientX, e.clientY);                 // map into (possibly rotated) game space
    const ndc = new THREE.Vector2((p.x / gameW()) * 2 - 1, -(p.y / gameH()) * 2 + 1);
    stationRay.setFromCamera(ndc, camera);
    if (stationRay.intersectObject(G.baseStation.obj, true).length) engageAutopilot();
  });
  ```
  (`G`, `THREE`, `camera`, `toGame` are already imported in `main.js`.)

---

## Part 6 — Client: DOM + CSS + i18n + render-loop wiring

- **`client/index.html:180`** — after `<div id="oob-warn"></div>` add: `<div id="return-hint"></div>`.
- **`client/styles.css:592`** — after the `#oob-warn` rules (through L600) add a matching style:
  ```css
  /* "Sector cleared — return to base" hint (return-to-base). Centered near the top, non-interactive. */
  #return-hint {
    position: fixed; top: 70px; left: 50%; transform: translateX(-50%); z-index: 5;
    display: none; text-align: center; pointer-events: none; max-width: 90vw;
    font-family: system-ui, sans-serif; text-shadow: 0 0 8px rgba(0,0,0,.9);
    color: #7ec8ff; font-weight: 700; font-size: 17px; letter-spacing: .5px;
  }
  ```
  Also add `#return-hint` to the `body.menu … { display:none }` list at **L335** (hide it on menus, like
  `#oob-warn`).
- **`client/src/dom.js:42`** — after `oobWarn: byId('oob-warn'),` add `returnHint: byId('return-hint'),`.
- **`client/locales/source.json`** — add after the `ui.oob.countdown` entry (L8):
  ```json
  "ui.return.hint": { "source": "Sector cleared — return to base", "context": "HUD hint shown after the last enemy is destroyed, directing the player to fly back to the base station to complete the mission." },
  ```
- **`client/locales/ru.json`** — add after `ui.oob.countdown` (L8): `"ui.return.hint": "Сектор зачищен — вернитесь на базу",`.
- **`client/src/main.js:365`** — in `animate()`, after `updateOobWarning();` (L368) add:
  ```js
  updateReturnArrow();  // world-space blue homing arrow toward the base station (return-to-base)
  updateReturnHint();   // centered "return to base" HUD hint
  ```

---

## Part 7 — Client: enemies spawn in the mission zone (`client/src/ship-build.js`)

`spawnEnemyShip` is at **L78**; the spawn-position block is **L100–L108** (ring around
`G.player.mesh.position`). Import `arenaCenter` and spawn around it instead:

- Add to the imports (after L5 `import { scene } from './engine.js';`):
  `import { arenaCenter } from './world.js';`
- Replace L100–L108:
  ```js
  // spawn in a ring around the MISSION ZONE center (arenaCenter), not the hero — waves originate at the
  // arena/set-piece even after the player wanders. No arena clamp (enemies fight fine out of bounds).
  const ang = Math.random() * Math.PI * 2;
  const d = 70 + Math.random() * 60; // 70..130 from the zone center
  e.mesh.position.set(
    arenaCenter.x + Math.cos(ang) * d,
    0.6,
    arenaCenter.z + Math.sin(ang) * d
  );
  ```

`ship-build.js` doesn't import `world.js` today; `world.js` doesn't import `ship-build.js`, so there's no import
cycle (`sim.js` already imports `arenaCenter` from `world.js` the same way).

---

## Tests

- **Server** (`cd server && npm test`): confirms the seed loads and `/api/maps/home-system` serves the
  descriptor with the new `base-station` set-piece. Server tests run on **both SQLite and Postgres** — this
  change is seed data + client code only (no `db.js`/`db_postgres.js` schema), so both suites just need to stay
  green; no parity work.
- **Client unit** (`cd client && node --test`): run the suite; nothing asserts on autopilot, but it guards
  against syntax/import breakage in `sim.js` / `world.js` / `ship-build.js` / `main.js`.
- **Visual harness** (`cd client && node visual/run.mjs`): known-flaky baseline (~6 scenarios fail regardless)
  — judge by the reliably-passing set + **zero page errors**. With the combat glb copied into
  `client/assets/ships/` (Part 1.5) the station resolves locally; confirm no `Base station model failed to
  load` warning and no page errors.
- **Manual verification (the real check).** Load the game, clear level 1, and confirm, after the last kill:
  1. the OOB warp-back no longer fires (fly far out — no "returning in Ns" / no warp);
  2. the blue arrow appears anchored to the ship, pointing at `(0,0)`, and the "Sector cleared — return to
     base" hint shows;
  3. **standing next to the station without clicking never wins** — the mission completes only after you
     **click/tap the station**, which engages autopilot; the ship brakes, rotates to face it, accelerates, then
     coasts to a stop next to it, and **victory fires** on arrival (credits banked, ×2, Continue → Main Window).
     Clicking while already inside the radius completes quickly;
  4. pressing any key / touching the stick / firing during autopilot **cancels** it and returns control, and a
     cancelled approach does **not** win — **re-tapping** the station resumes the dock;
  5. a **side mission** (e.g. mining at `-550,0`): the fight is at the zone, enemies spawn there, and after the
     last kill you can fly the full ~550u back to the station at `(0,0)` and win (repeatable, no story advance);
  6. enemies spawn around the **zone center**, not around the player, when you've wandered off.

---

## Docs to update

- **`docs/SUMMARY.md`** — bump `**Updated:**` and the top-of-file summary line. Update:
  - **Gameplay → set-pieces / world:** add the **base station** at `(0,0)` (below-plane, non-collidable
    `.glb` set-piece raised near the plane; the return-to-base target).
  - **Level flow / Victory:** rewrite so **all missions** end on **return-to-base**, not the last kill — after
    the last enemy dies the OOB warp is lifted, a blue homing arrow + "return to base" hint appear, and the
    station becomes clickable. The mission completes only when the player **clicks/taps the station** (mandatory
    dock) and the ship arrives (`BASE_ARRIVE_RADIUS ≈ 45u` from `(0,0)`), firing the existing victory —
    proximity alone never wins. Note the `win` phase's `delay` still runs first.
  - **Controls / Tools:** add **Autopilot** (click/tap the station → brake → rotate → accelerate → kinematic
    brake to a stop; any control input cancels).
  - **Enemy types / spawning:** enemies now spawn in a ring around the **mission zone center (`arenaCenter`)**,
    not the hero.
  - **Soft arena boundary:** note the OOB warp is **disabled during return-to-base**.
- **`docs/CHANGELOG.md`** — one bullet under a `## 2026-07-03` heading (newest on top): **"Autopilot +
  return-to-base mission end."** — base-station `.glb` set-piece at `(0,0)`; every mission (campaign + side) now
  ends by flying back to it instead of on the last kill (OOB lifted, blue homing arrow + HUD hint, clickable
  station → autopilot: brake/rotate/accelerate/kinematic-brake); enemies spawn at the mission-zone center. Note
  the CREDITS addition and that a `/publish-itch` is needed once on prod (model/hash change, DECISIONS §37).
- **`docs/DECISIONS.md`** — add **§39** ("Autopilot + return-to-base mission end"). Record: (1) return-to-base
  is a single `levelRunner` intercept so it covers campaign **and** side missions with no descriptor edits;
  (2) the station is a **below-plane, non-collidable** set-piece (no collision handling — maintainer's explicit
  call), kept below `y≈0.6` per §17, and the dock is a **horizontal proximity** test to `(0,0)`; (3) the dock
  requires a **mandatory explicit station click** — proximity alone never wins; victory = autopilot engaged
  (only the click sets it) **and** within `BASE_ARRIVE_RADIUS`, and any control input cancels the dock without
  completing (re-tap to resume); (4) autopilot uses a **kinematic symmetric-decel brake** (not the literal
  midpoint — `IDLE_DRAG` is exponential and can't stop cleanly); (5) **any** control input cancels autopilot
  (literal reading); (6) enemies spawn at `arenaCenter`, not the hero; (7) OOB warp is lifted after the last
  kill (needed so side missions fought far from `(0,0)` can return). Note the rejected alternatives (proximity
  auto-win; literal brake-at-midpoint; per-mission descriptor edits).
- **`docs/DECISIONS.md` §2** — add a one-line amendment/cross-reference to §2 (which currently says enemies
  "spawn around the player" and describes the 30s OOB warp as unconditional), pointing at §39: enemies now spawn
  around `arenaCenter` (the mission zone), and the OOB auto-warp is **suspended during return-to-base**. This
  keeps §2 from contradicting the new behaviour.
- **`client/assets/CREDITS.md`** — add the CC-BY row (after the `freighter_combat` row) and an attribution
  paragraph under `## Models`:
  ```
  | ships/base_station_combat.\<hash\>.glb (Base station set-piece — return-to-base target) | MisterH | https://skfb.ly/ozESS | CC-BY 4.0 | 2026-07-03 |
  ```
  ```
  The **base station** set-piece (`base_station_combat`) is **"Low Poly space station."** by **MisterH**
  (Sketchfab, **CC-BY 4.0** — attribution required, so this entry must stay while in use).

  **Required attribution (use verbatim, e.g. in an in-game credits screen):**

  > "Low Poly space station." (https://skfb.ly/ozESS) by MisterH is licensed under Creative Commons
  > Attribution (http://creativecommons.org/licenses/by/4.0/).
  ```

## Publish-itch reminder

This is a **prod model/hash change**. Per **DECISIONS §37**, once it lands on prod run `/publish-itch` so the
itch.io bundle (which bundles glbs but reads the catalog live) doesn't 404 the new station glb. Call this out in
the CHANGELOG bullet. (Post-deploy step, not part of the local implementation.)

## Out of scope / non-goals (DECISIONS §30 — do not gold-plate)

- **No collision handling.** The station is decor below the plane; ships fly over it. Do not add hit-tests,
  physical blocking, or register it in any gameplay array.
- **Only the base station is a clickable autopilot target** this iteration. No general "click any object to fly
  to it", no enemy/set-piece targeting, no path planning / obstacle avoidance — fly straight at `(0,0)`.
- **No new mission types, no descriptor changes.** The return-to-base gate is entirely in `levelRunner`; do not
  add `win`-phase fields or per-mission set-piece wiring.
- **No autopilot for anything but return-to-base.** It's engaged only while `G.returnToBase` is true.
- **No effect/registry framework** for the arrow or station; a single arrow mesh + a single set-piece builder.
- **No hangar/menu view** for the station (a set-piece is never inspected in the item preview); ignore the
  hangar glb from `assets:build`, don't wire `modelUrlHigh`.
- **No schema/migration/`db.js` work** and **no `assets-check.mjs` change** (set-piece `modelUrl` lives on the
  map spec).
- **No commit/push** unless the maintainer asks.
