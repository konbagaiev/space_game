# Backdrop ghost battle around the freighter (escort side mission)

**Feature ID:** 2026-07-07-1606-backdrop-ghost-battle
**Status:** planned (executable brief — implement exactly as written; do not re-open the confirmed decisions).

## Goal

Add a **clearly visible, watchable "ghost battle"** — a looping recording of ships fighting, with the recorded
**player ship flying freely** — that plays as a **distinct, plainly-visible distant skirmish** off in the
world, so a mission reads as "there's a battle going on over there." It shows in **every mission EXCEPT the
freighter escort** (flipped from the old freighter-only gate), anchored at a **fixed ABSOLUTE world point**
(default `(−100,−450)`, the freighter start — the same spot every mission), a **distant landmark the player
flies toward** and watches fade in through the fog (off-screen from the mission center is intended, and it's
reachable/viewable from within the arena bounds — see D5). The ghosts sit **below the combat plane (y ≈ −60, below `BULLET_PLANE_Y = 0.6` so
they're a separate layer the player can't shoot)**, near-opaque and full-color at a moderate scale — the design
goal is **"a watchable distant battle," not faint ambiance.** They stay **non-interactive** (no collision, no
targeting, no HUD/markers/health-bars, no audio), so the player understands it is a *different, distant* battle
— not their fight. The battle is a **committed transform track** the runtime plays back as a dumb animation — it
never runs a second sim and never touches the live world (`G`, `enemies`, projectiles); the recorded positions
are re-centered by a **single fixed offset** (the mean of the player's path) so the **player's real free-flight
motion is preserved** and the whole cloud sits near the anchor. **The canonical track is a REAL battle the
maintainer plays and records in-game** (an authoring tool, one committed track all players see); a synthetic
headless generator is kept only as a bootstrap/fallback so the code + tests function before the real recording
is made. The freighter set-piece keeps its `z += 50` reposition (−450 → −400) as nearby scenery. Ghost ships
reuse **existing** ship `.glb`s (no new assets). Tier-gated: full on High, thinned on Balance, **off on
Performance**; the runtime player is skipped under `?debug`.

## Confirmed decisions (do NOT re-open)

1. **Scope = every mission EXCEPT the freighter escort (FLIPPED).** The ghost battle is built whenever the
   active mission is **not** the freighter escort — `G.activeMission?.title !== 'freighter'` (campaign has
   `activeMission === null` → shows; the mining/research side missions → show; the freighter escort → hidden).
   Narrative: in a normal mission you glimpse a distant skirmish "over there" (the freighter's sector is under
   attack, seen from afar); on the freighter mission itself you're IN that fight, so the ghost copy is hidden.
   (Descriptor `title` is `f.type`; see `server/src/missions.js:66`.)
2. **Approach B — transform replay; authored by an IN-GAME live recording.** The runtime just interpolates a
   committed transform track and moves meshes — no second live sim. **The canonical track is authored by
   recording a REAL battle the maintainer plays in-game** (a `?dev` recorder captures per-frame transforms of
   the player + enemies + bullets, then re-centers/quantizes and downloads the track module — an authoring
   tool producing ONE committed track, not a per-player runtime feature). A **synthetic headless generator**
   (`bakeBackdrop` + `gen-backdrop.mjs`, seeded/fixed-dt) is kept **only as a bootstrap/fallback** so the
   runtime + tests work before the real recording exists.
3. **Anchored at a FIXED ABSOLUTE world point — a distant landmark you fly toward; the player ghost flies
   freely.** The group is placed at the absolute world coordinate `(GHOST_TUNE.ax, GHOST_TUNE.y, GHOST_TUNE.az)`
   — **default `(−100, −450)`** (the freighter mission start), the SAME spot regardless of which mission is
   active, NOT `arenaCenter`-relative, NOT camera-anchored, NOT following any object. Being off-screen from the
   mission center is **intended**: it's a far-off skirmish, ~61% fogged from the campaign center, that the
   player **flies toward** and watches **fade in through the fog** (reachable + viewable from within the arena
   bounds — see D5's reachability finding). The recorded **player ship moves naturally** (the track re-centers
   by one fixed offset, not per-frame — see the anchoring section), so it flies within the cloud, not pinned.
   Depth `y (default −60)` keeps it a separate, unshootable layer below the `0.6` combat plane. `(ax, az)` are
   tunable (absolute) in the `?dev` panel.
4. **Track = ships (with births + deaths) + bullets.** Up to `MAX_GHOST_SHIPS = 16` ship *slots* over the
   whole loop (player + up to 15 enemy waves, reusing existing glbs) + their bullets. **~60 s @ 20 fps**
   (recorder default; ~150–250 KB — still low-hundreds of KB, within budget). Each slot carries a `birth` +
   `death` keyframe so enemies that **spawn in waves during the fight join the cast** (fixing the "decays to
   one ship" playtest). Positions quantized to 0.1 u, yaw to 0.01 rad, flat integer arrays. Runtime **lerps**
   ship transforms between keyframes (shortest-arc for yaw); **bullets snap**. Recorded particle/exhaust FX are
   **omitted** (deaths regenerate the real explosion at runtime).
5. **Death = the real small-pirate explosion, regenerated at runtime.** When a ghost ship's recorded
   `death` frame is reached during playback, call the game's `spawnShipExplosion(...)` at the ghost's world
   position (`sizeScale = GHOST_TUNE.scale`), with the shockwave ring pinned to the ghost's own depth (not
   the combat plane). Not stored in the track. (Off on Performance anyway.)
6. **Rendering = below-plane decor group in the MAIN scene** (mirrors how the freighter + base station are
   below-plane non-collidable decor). No separate render pass. Justification below.
7. **Visibility treatment (REVERSES the old "faint ambiance" guardrail — hard requirement):** the battle must
   be **clearly visible from the player's position** — **near-opaque (`opacity ≈ 0.9`), full-color (no
   darken), moderate scale (`≈ 0.8`), depth `y ≈ −60`**, fog on only for a soft far edge. It reads as a
   *separate distant* battle through **spatial separation** (it sits at a fixed world point off from the
   player's own fight) + depth, NOT through dimming. It stays strictly **non-interactive**: NO
   HUD/markers/health-bars, NO collision, NO targeting, NO audio (none are wired to the ghost group by
   construction). Do **not** over-dim it — that was the playtest failure (opacity 0.35 × darken 0.45 × scale
   0.5 × y −48 made it invisible; only the additive death-explosion punched through).
8. **Tier gating (a CONCURRENT-visible ceiling, not "first N slots"):** the track holds all ≤16 slots; the
   tier caps how many ghosts are visible *at once* — High = 8 concurrent + bullets; Balance = 4 concurrent, no
   bullets; **Performance = off entirely** (mirrors `nebulaBake:null`, DECISIONS §23). **Skip under `?debug`**
   (mirrors the nebula bake at `client/src/world.js:721`) so the headless visual suite is not perturbed.
9. **No new assets → no `CREDITS.md` change.** Ghost ships reuse `player_combat` + `enemy_1..4_combat`
   glbs already credited and already bundled into the itch build. No new content-hashed URLs, so **no
   itch-glb-404 risk** (see Deploy note).

## Design decisions settled inline (so the implementer never asks)

### D1 — Freighter reposition: move ONLY the rendered position, keep the mission center (review-gate item)

Change the **freighter set-piece position** `[-100, -48, -450]` → `[-100, -48, -400]`
(`server/src/catalog_seed.js:603`). **Do NOT move the mission center** (`server/src/missions.js:48`
`center: { x: -100, z: -450 }` stays).

Reasoning (this is the coordinator's flagged coherence question — answer it in the PR too):
- The freighter is **non-collidable decor with zero mechanical role** — nothing is mechanically "escorted"
  or damaged. Enemy spawns and the player spawn/soft-boundary key off `arenaCenter` = the mission `center`
  (`ship-build.js:108-116`, `sim.js:416-422`, `sim.js:835-838`), not the freighter.
- Moving **both** would shift the whole mission in world space by a constant the player can't perceive
  (they always spawn relative to `center`) — the reposition would accomplish nothing visible.
- Moving **only** the freighter is what actually changes what the player sees on the freighter mission (the
  freighter now sits `+50 u` in `+z`, ahead of the player's forward-gliding spawn) and is **balance-neutral**
  (enemy/player spawn geometry unchanged). (Note: the ghost battle no longer rides the freighter — this
  reposition now stands on its own as freighter-mission framing, independent of the ghost battle.)
- `50 u` is small vs the `70–130 u` enemy spawn ring (`ship-build.js:111`), so the freighter stays well
  inside the fight — the escort framing still coheres ("thing you protect" is among the enemies).
- Update the now-slightly-stale comment in `server/src/missions.js:53-55` (which claims the center "matches
  the set-piece position") to note the freighter is intentionally offset `+50 z` from center.

### D2 — Rendering approach: in-main-scene decor group (not a separate scene)

The least-complex correct approach (DECISIONS §30) is a **below-plane, non-collidable decor group added to the
main `scene`**, like the freighter and base station (`client/src/world.js` `makeFreighter` /
`makeBaseStation`). It inherits the combat scene's light + fog for free, needs **no extra render pass**, and is
naturally frustum-culled when off-screen. The "distant" read comes from **spatial separation** (a fixed world
point off from the player's own fight) + depth, **not** from dimming: it is near-opaque and full-color so it's
plainly watchable (see D3).

### D3 — Visibility values (concrete defaults; live-tunable via the `?dev` panel)

The committed **defaults** live in `ghost-battle-track.js` as
`GHOST_TUNE_DEFAULTS = { y: −60, scale: 0.8, opacity: 0.9, ax: −100, az: −450 }` (no `darken` — full color;
ghost-bullet dot `opacity = 0.9`). `y` is the depth (range **[−80, 0]**); `ax`/`az` are the **absolute world
coordinate** of the anchor (range **[−600, 600]**, default `(−100,−450)`, see D5). None are hard-coded — the `?dev` "Backdrop
authoring" panel (Step 3b) exposes **Depth / Scale / Opacity / Anchor X / Anchor Z** sliders that override a
live `GHOST_TUNE` object every frame (persisted to `localStorage['ghostTune']`), so placement + look are dialed
in during a real playtest and the final numbers are baked back into `GHOST_TUNE_DEFAULTS`. `applyShipModel`'s
optional `opacity`/`darken` hook is kept, but ghosts pass **only `opacity`** now. Rationale: near-top-down
camera + `y = −48` foreshortened the ships to near-nothing and `0.35 × 0.45` opacity/darken made it invisible;
near-opaque, full-color, larger, at depth `−60` (a first `−14` read "too close"; the maintainer chose `−60`),
`y < 0.6` keeps it a separate, unshootable layer — and the sliders let the maintainer confirm/adjust live.

### D4 — Playback clock

Playback advances on the **sim `dt`** (the ghost group is a set-piece; `setPieces[].update(dt)` is called from
inside `update(dt)` at `client/src/sim.js:775`, which is skipped on pause and on the menu). So the ghost
battle **freezes on pause** and only animates during a live (non-freighter) mission fight — consistent with the
real fight.

### D5 — Placement = an ABSOLUTE world point (a distant landmark you fly toward); REACHABILITY finding

**Placement (maintainer's explicit, thrice-stated choice): a FIXED ABSOLUTE world coordinate, default
`(ax, az) = (−100, −450)`** = the freighter mission's start. NOT `arenaCenter + offset` — the **same world spot
regardless of which mission is active**. The group is placed at `(GHOST_TUNE.ax, GHOST_TUNE.y, GHOST_TUNE.az)`.
The `?dev` **Anchor X/Z sliders set this absolute coordinate directly** (range ±600) so the maintainer nudges
the exact world spot live.

**Being off-screen from the mission center is INTENDED, not a bug.** The design is a *distant landmark you fly
toward*: from the campaign center `(0,0)` the spot is 461 u away and **~61% fogged** (a faint far-off skirmish);
as the player flies "north" toward it, it **fades in through the `Fog(240, 600)`** and becomes a clear, watchable
battle. (Earlier revisions wrongly treated "off-screen from center" as a defect and proposed an offset-from-
center anchor — that is REVERSED here.)

**REACHABILITY (the real risk — investigated; NOT blocking).** The concern: does the OOB soft-boundary /
warp-back pen the player near their own mission center so they can never get close enough to see `(−100,−450)`?
Traced `sim.js:424-436`: the arena is a soft boundary of half-size **`ARENA = 360`** measured from
`arenaCenter`; the player flies **past it freely** (nothing is hard-clamped, DECISIONS §2), only getting an OOB
warning after 2 s and a **warp-back after `OOB_RETURN_TIME = 30 s` CONTINUOUSLY out of bounds** (lifted during
return-to-base). Player top speed is `PLAYER_MAX_SPEED = 30 u/s`. Result — **the battle is reachable AND
clearly viewable from WITHIN the arena bounds** (no OOB needed) in every non-freighter mission:

| mission | center | at-center dist (fog) | nearest IN-BOUNDS point | dist to spot (fog) |
|---|---|---|---|---|
| campaign | `(0,0)` | 461 u (~61% fog) | `(−100,−360)` | **90 u (0% fog — fully clear)** |
| mining | `(−550,0)` | 636 u (100% fog) | `(−190,−360)` | **127 u (0% fog)** |
| research | `(400,0)` | 673 u (100% fog) | `(40,−360)` | **166 u (0% fog)** |

So the player flies toward the north edge of their arena (all in-bounds, no warp-back), the fog clears, and the
battle at `(−100,−450)` reads clearly (it's within the 240 u fog-near clear zone from the arena edge). Flying
right up to it is also possible (OOB) with ~30 s of lingering before a warp-back. **Approach numbers
(campaign):** at 30 u/s, the player reaches the fog-clear edge (spot dist 240 u, ≈ player `z = −210`) in ~7 s
and the north arena edge (`z = −360`, spot 90 u, fully clear, still in-bounds) in ~12 s. **Conclusion: the
absolute `(−100,−450)` placement is fully reachable/viewable — no blocking issue.**

**If the gate still wants a safety net:** the `?dev` Anchor sliders let the maintainer relocate the spot; and
because it's tier/`?debug`/`?bench`-gated decor, an unreachable value would only mean "not seen," never a
crash. No code guard is needed for reachability.

## Files (what to create / change)

**New (client runtime):**
- `client/src/ghost-battle-track.js` — **pure** helpers (no THREE/DOM, unit-testable): the tier/`?debug`
  gating decision, the track sampler (lerp + shortest-arc yaw + loop clamp), quantize/dequantize, the shared
  **`recenterAndQuantize(raw)`** used by BOTH authoring paths, and the **live-tune helpers**
  (`GHOST_TUNE_DEFAULTS`/`GHOST_TUNE_RANGES`/`clampGhostTune`/`loadGhostTune`/`saveGhostTune`).
- `client/src/ghost-battle.js` — the runtime builder (THREE + scene + ship-factory + projectiles): builds the
  ghost group at a fixed ABSOLUTE world anchor (`GHOST_TUNE.ax/y/az`, default `(−100,−450)`), loads the track,
  spawns/animates ghost ships (player flies freely), fires death explosions; also exports
  **`buildBackdropPanel(GUI)`** (the `?dev` authoring panel, Step 3b) which owns the live `GHOST_TUNE` +
  `activeGhost` handle. `buildGhostBattle()` takes **no argument** (not freighter-tied).
- `client/src/backdrop-battle.js` — **committed data module** (`export const BACKDROP_BATTLE = {…}`), the
  canonical track (mirrors the committed `client/src/credits-data.js` pattern). Bootstrapped by the synthetic
  generator, then **replaced by the maintainer's real in-game recording**.

**New (authoring — PRIMARY = in-game recorder + `?dev` panel):**
- `client/src/main.js` — a `?dev`-gated in-game recorder (`window.__backdrop.record()/stop()/status()`) that
  captures a **live-played** battle's transforms and downloads a `backdrop-battle.js` module (Step 3), + a
  `bootstrap()` injection (next to `?tune`) that dynamically imports lil-gui + `buildBackdropPanel` under
  `isDev()` (Step 3b). This is how the canonical track is authored (on-screen Start/Stop-record buttons + REC
  readout + live Depth/Scale/Opacity sliders).

**New (authoring — SECONDARY = synthetic bootstrap/fallback):**
- `client/bench/gen-backdrop.mjs` — node generator: launches headless Chromium (reusing `run.mjs`'s
  server+static+CDP harness), calls `window.__bench.bakeBackdrop(...)`, runs the shared `recenterAndQuantize`,
  writes `client/src/backdrop-battle.js`. Produces a working track so the code + tests function **before** the
  maintainer records the real one; secondary to the live recording.

**Changed:**
- `server/src/catalog_seed.js:603` — freighter `pos` z `-450 → -400`.
- `server/src/missions.js:53-55` — comment note (center intentionally offset from the freighter).
- `client/src/main.js` — add `window.__backdrop` recorder (`isDev()`-gated, captures in `animate()` behind
  `!G.paused`) + `status()`; the `bootstrap()` `?dev` panel injection (lil-gui + `buildBackdropPanel`); and the
  `window.__bench.bakeBackdrop(...)` bootstrap generator inside the existing `if (isBench())` block.
- `client/src/sim.js` — in `reset()`, **after** the set-piece rebuild loop (`sim.js:845`), dynamically import
  + call `buildGhostBattle()` gated on `G.activeMission?.title !== 'freighter'` (Step 6). (Build trigger MOVED
  here from `world.js`; `world.js` `buildSetPiece` is **no longer touched** by this feature.)
- `client/src/ship-factory.js` — `applyShipModel` gains optional `opacity`/`darken` spec keys (ghosts pass
  `opacity` only now); real ships pass neither → unaffected.
- `client/src/projectiles.js` — `spawnShipExplosion` gains an optional `ringY` param; default keeps existing
  callers on the combat plane, the ghost caller relocates the ring to the ghost's below-plane depth.

**New tests:**
- `client/src/ghost-battle-track.test.js` — pure `node --test` for gating + sampling + quantize +
  `recenterAndQuantize` (bounded output) + the **tune helpers** (`clampGhostTune`/`loadGhostTune`/
  `saveGhostTune`) + a shape-guard + bounded-formation guard over the committed `backdrop-battle.js`.

## Step 1 — Freighter reposition (server seed)

`server/src/catalog_seed.js:603`, change:
```js
type: 'freighter', pos: [-100, -48, -450], scale: 0.33, speed: 2,
```
to:
```js
type: 'freighter', pos: [-100, -48, -400], scale: 0.33, speed: 2,
```
`catalog_seed.js` is the **single seed source consumed by both `db.js` (SQLite) and `db_postgres.js`** — no
per-backend edit needed; parity is automatic. **Grep `server/test` and `server/src` for `-450` / `450`** and
update any test/fixture that hard-asserts the old freighter position (there should be none coupling it, but
verify). Leave `server/src/missions.js:48` `center.z: -450` **unchanged**; update only the explanatory comment
at `missions.js:53-55` to state the freighter render position is intentionally offset `+50 z` ahead of the
mission center.

## Step 2 — Transform-track format + the pure helpers (`ghost-battle-track.js`)

Track object shape (dequantized values shown; the file stores the quantized integer arrays):
```js
// backdrop-battle.js  →  export const BACKDROP_BATTLE = {
{
  version: 1,
  name: 'freighter-skirmish',
  seed: 0,              // provenance only (BENCH_SEED for a synthetic bootstrap; 0 for a live recording) — NOT used at playback
  fps: 20,              // playback keyframe rate
  frames: 1200,         // 60 s * 20 fps (recorder default; 15 s bootstrap = 300). ~150–250 KB @ ≤16 slots / ≤24 bullets
  qPos: 10,             // position quantum: stored int = round(v * qPos)  → 0.1 u
  qYaw: 100,            // yaw quantum:      stored int = round(rad * qYaw) → 0.01 rad
  ships: [              // <= MAX_GHOST_SHIPS (16) slots over the whole loop; slot order = order of appearance
    { shipName: 'Air & Space Vessel' /* player */, scale: 1.0, birth: 0, death: -1,
      x: [ /* frames ints */ ], z: [ /* ints */ ], yaw: [ /* ints */ ] },
    { shipName: 'Basic pirate ship', scale: 1.0, birth: 0,  death: 214, x: [...], z: [...], yaw: [...] },
    { shipName: 'Basic pirate ship', scale: 1.0, birth: 520, death: -1,  x: [...], z: [...], yaw: [...] }, // a later wave
    // ...
  ],
  bullets: {            // variable count per frame; flat arrays
    counts: [ /* frames ints, each <= MAX_GHOST_BULLETS */ ],
    x: [ /* sum(counts) ints */ ], z: [ /* ints */ ],
  },
}
```
- `shipName` references a **catalog ship by name** (resolved live at runtime → model URL + `stats.model`), so
  a future glb re-hash does not break the track (no baked hashes).
- `birth` = the keyframe a ship first appears (default `0`); `death` = the keyframe it dies (`-1` = survives
  the whole loop). A ghost renders only for `birth ≤ frame < (death<0 ? frames : death)`; slot 0 / the
  player-model ghost is always `birth:0, death:-1`. This is what keeps a 60 s recording POPULATED — the game
  spawns enemies in waves, so later-born enemies join the ghost cast instead of the clip decaying to one ship.
  Arrays are full length (`frames`): **pre-birth** entries are placeholders (birth position) and **post-death**
  entries hold the **last** position (frozen) — both are hidden at playback and excluded from re-centering.
- **Positions are RE-CENTERED by a SINGLE FIXED OFFSET** (the mean of the player's path) in
  `recenterAndQuantize` — NOT per-keyframe. The player's real free-flight motion is preserved (only a constant
  is subtracted), the cloud is centered near origin, and the runtime places it at the fixed ABSOLUTE world
  anchor (`GHOST_TUNE.ax/y/az`, D5). A single constant means no per-frame dependence → **no birth/death jumps**.
  (Per-keyframe slot-0 subtraction was rejected — it pins the player at origin, but the player must fly freely;
  per-frame centroid subtraction jumps on births/deaths.)

Pure helpers to export from `ghost-battle-track.js` (keep this module free of THREE/DOM imports):

```js
// Tier/debug gating — the single source of truth (unit-tested). `maxConcurrent` = how many ghosts may be
// VISIBLE at once (a draw-call ceiling); the track holds up to MAX_GHOST_SHIPS *slots* over the whole loop
// (waves come and go via birth/death), and the runtime shows only the currently born-and-alive ones, capped
// to maxConcurrent. (Was `maxShips` = "first N slots", which dropped every later-born wave — see Step 5.)
export function ghostBattlePlan(tierName, isDebug) {
  if (isDebug) return { enabled: false, maxConcurrent: 0, bullets: false };
  if (tierName === 'performance') return { enabled: false, maxConcurrent: 0, bullets: false };
  if (tierName === 'balance')     return { enabled: true,  maxConcurrent: 4, bullets: false };
  return { enabled: true, maxConcurrent: 8, bullets: true }; // high + any unknown → full
}

export const MAX_GHOST_SHIPS = 16;   // total track SLOTS over the whole loop (player + up to 15 enemy waves)
export const MAX_GHOST_BULLETS = 24;

// Is slot `sh` alive (born + not yet dead) at keyframe `kf`? Player slot is birth:0/death:-1 → always alive.
export const slotAlive = (sh, kf, frames) => kf >= (sh.birth || 0) && kf < (sh.death < 0 ? frames : sh.death);

// Dequantize one stored int stream value.
export const deq = (v, q) => v / q;

// Sample a ship slot at playback time t (seconds). Returns { x, z, yaw }. Lerps position, shortest-arc
// yaw; clamps at the last frame (no cross-loop interpolation). qPos/qYaw dequantize.
export function sampleShip(ship, t, fps, frames, qPos, qYaw) {
  const f = t * fps;
  let i0 = Math.floor(f) % frames; if (i0 < 0) i0 += frames;
  const i1 = i0 + 1 >= frames ? i0 : i0 + 1;         // clamp at end → no wrap lerp
  const a = i1 === i0 ? 0 : f - Math.floor(f);
  const x = lerp(ship.x[i0] / qPos, ship.x[i1] / qPos, a);
  const z = lerp(ship.z[i0] / qPos, ship.z[i1] / qPos, a);
  const yaw = lerpAngle(ship.yaw[i0] / qYaw, ship.yaw[i1] / qYaw, a);
  return { x, z, yaw };
}
const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) { // shortest-arc
  let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
// Current integer keyframe index (for death checks + bullet snap).
export const frameIndex = (t, fps, frames) => { let i = Math.floor(t * fps) % frames; return i < 0 ? i + frames : i; };

// ---- Live appearance tuning (?dev panel, Step 3b). DEFAULTS are the committed source-of-truth (bake the
// maintainer's dialed-in numbers here); the panel overrides them live + persists to localStorage['ghostTune']. ----
export const GHOST_TUNE_KEY = 'ghostTune';
// y = depth (below the 0.6 combat plane); ax/az = the ABSOLUTE world coordinate of the anchor (D5) — the same
// fixed world spot regardless of which mission is active. Default = the freighter mission center (-100,-450).
export const GHOST_TUNE_DEFAULTS = { y: -60, scale: 0.8, opacity: 0.9, ax: -100, az: -450 };
export const GHOST_TUNE_RANGES = { y: [-80, 0], scale: [0.3, 1.5], opacity: [0.1, 1.0], ax: [-600, 600], az: [-600, 600] };
const _clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export function clampGhostTune(t = {}) {
  const d = GHOST_TUNE_DEFAULTS, r = GHOST_TUNE_RANGES, n = (v, k) => Number.isFinite(+v) ? +v : d[k];
  const out = {};
  for (const k of Object.keys(d)) out[k] = _clamp(n(t[k], k), r[k][0], r[k][1]);
  return out; // { y, scale, opacity, ax, az }
}
export function loadGhostTune(store) {
  try { const s = store && store.getItem(GHOST_TUNE_KEY); if (s) return clampGhostTune(JSON.parse(s)); } catch {}
  return { ...GHOST_TUNE_DEFAULTS };
}
export function saveGhostTune(store, t) {
  const c = clampGhostTune(t);
  try { store && store.setItem(GHOST_TUNE_KEY, JSON.stringify(c)); } catch {}
  return c;
}

export const QPOS = 10, QYAW = 100; // canonical quanta (0.1 u, 0.01 rad)

// Turn a RAW captured battle into the committed quantized track. Shared by the in-game recorder AND the
// synthetic generator so both produce byte-compatible modules. Mutates `raw`'s float arrays in place (throwaway).
//   raw = { name?, seed?, fps, frames, ships:[{shipName, scale, birth, death, x[],z[],yaw[]}], bullets:{counts[],x[],z[]} }
// Steps: (1) RE-CENTER by ONE FIXED OFFSET (not per-keyframe) = the MEAN of the player's (slot-0) positions over
// the whole track. Subtract that single (mx,mz) from ALL ships AND ALL bullets. The player's real free-flight
// motion is PRESERVED (only a constant is removed), and the cloud is centered near origin so it sits at the
// anchor. A single constant → no per-frame membership dependence → NO birth/death jumps. (We do NOT subtract
// slot-0 per-keyframe: that pins the player at origin, which the maintainer rejected — the player must fly
// freely. We also do NOT subtract the per-frame cast centroid: births/deaths step it → the whole formation
// jumps.) (2) Quantize to ints.
export function recenterAndQuantize(raw, { qPos = QPOS, qYaw = QYAW, name = 'freighter-skirmish' } = {}) {
  const { fps, frames, ships, bullets } = raw;
  const p0 = ships[0]; // player slot — mean of its path is the fixed anchor offset
  let mx = 0, mz = 0;
  for (let kf = 0; kf < frames; kf++) { mx += p0.x[kf]; mz += p0.z[kf]; }
  mx /= (frames || 1); mz /= (frames || 1);    // ONE constant offset for the whole track
  for (const sh of ships) for (let kf = 0; kf < frames; kf++) { sh.x[kf] -= mx; sh.z[kf] -= mz; }
  for (let i = 0; i < bullets.x.length; i++) { bullets.x[i] -= mx; bullets.z[i] -= mz; }
  const qp = (v) => Math.round(v * qPos), qy = (v) => Math.round(v * qYaw);
  return {
    version: 1, name, seed: raw.seed ?? 0, fps, frames, qPos, qYaw,
    ships: ships.map((sh) => ({ shipName: sh.shipName, scale: sh.scale ?? 1, birth: sh.birth || 0, death: sh.death,
      x: sh.x.map(qp), z: sh.z.map(qp), yaw: sh.yaw.map(qy) })),
    bullets: { counts: bullets.counts.slice(), x: bullets.x.map(qp), z: bullets.z.map(qp) },
  };
}
```
Keep the exact same `sampleShip` math available so recording, generation and playback agree.

## Step 3 — In-game live recorder (`window.__backdrop`) — PRIMARY authoring path

The canonical track is a **real battle the maintainer plays**. Add a `?dev`-gated recorder to
`client/src/main.js` that captures per-frame transforms during live `animate()` and, on stop, re-centers +
quantizes + **downloads** a `backdrop-battle.js` module. It is an **authoring tool** (like the credits/itch
generators) — the output is committed by hand; the runtime + track format do **not** change. The primary UX
is the **on-screen `?dev` "backdrop authoring" panel** (Step 3b) with Start/Stop-record buttons + a live REC
readout + appearance-tuning sliders; the `window.__backdrop.record()/stop()` console methods are kept as a
trivial secondary trigger.

**How the maintainer uses it (document this in SUMMARY):**
1. Open the game with `?dev` (sticky). Start any fight — you record the player's own live battle; the track is
   re-centered (fixed offset) so it's location-agnostic and can be recorded in any mission.
2. When a good cluster of enemies is engaged, click **Start recording** in the panel (or run
   `__backdrop.record()`). The button becomes **Stop** with a **`REC 12s/60s`** elapsed readout.
3. Fight for ~60 s (auto-stops at `maxSeconds`, default **60**) or click **Stop** / call `__backdrop.stop()`.
4. A `backdrop-battle.js` downloads. Move it to `client/src/backdrop-battle.js`, run `cd client && node --test`
   (shape + bounded guards), and commit it.
5. To dial the LOOK + PLACEMENT, play a **non-freighter mission** (where the ghost battle renders) and use the
   panel's **Depth / Scale / Opacity / Anchor X / Anchor Z** sliders live; when happy, read the numbers off the
   panel and bake them into `GHOST_TUNE_DEFAULTS`, then report the final values.

**Capture rules:**
- Slot 0 = the player ship (`shipName` = its catalog name, `birth:0, death:-1`).
- **Births (the fix): the cast is NOT frozen at record-start.** Each keyframe, every enemy currently in
  `enemies` that doesn't yet own a slot (`e._bdSlot === undefined`) is assigned a NEW slot with
  `birth = current keyframe` (if under the `MAX_GHOST_SHIPS` total-slot cap; enemies appearing after the cap
  is full are ignored) and recorded from then on. So later waves join the ghost cast instead of the clip
  decaying to one ship. **No slot reuse** (a dead slot is never re-assigned; §30).
- Capture at the playback rate (20 fps) via a **dt accumulator** (live play isn't fixed-step).
- Each keyframe: record player + each slotted enemy `(x,z,yaw)`; when a slotted enemy leaves the `enemies`
  array, set its `death` = current keyframe and freeze its last pos. A slot **born at keyframe k** back-fills
  its `x/z/yaw` with `k` placeholder entries (its birth position) so **all slot arrays stay length `frames`**;
  those pre-birth entries get the slot-0 re-center offset like every sample (uniform arrays) but are hidden at
  playback and never affect the anchor (re-centering keys off slot 0 only, not this slot).
- Bullets: snapshot up to `MAX_GHOST_BULLETS (24)` live bullet `(x,z)` per keyframe (player + enemy).
- On stop: assemble `raw`, call the shared `recenterAndQuantize(raw)`, serialize
  `export const BACKDROP_BATTLE = <json>;`, Blob-download `backdrop-battle.js`, log a KB summary.

Imports to add at the top of `main.js`: `recenterAndQuantize, MAX_GHOST_SHIPS, MAX_GHOST_BULLETS` from
`./ghost-battle-track.js` (`isDev`, `G`, `enemies`, `bullets` are already imported/in scope).

```js
// ---- In-game backdrop recorder (?dev authoring tool). Captures a live-played battle → downloads a committed
// backdrop-battle.js. Inert unless isDev(). See docs/plans/2026-07-07-1606-backdrop-ghost-battle.md Step 3. ----
let bdRec = null; // active recording state or null
function backdropCapture(dt) {            // called from animate() after update(), only while recording + live
  if (!bdRec) return;
  bdRec.acc += dt; bdRec.elapsed += dt;
  if (bdRec.acc < 1 / bdRec.fps) return;  // decimate live frames → fps keyframes
  bdRec.acc -= 1 / bdRec.fps;
  const kf = bdRec.ships[0].x.length;     // keyframe index about to be pushed (= current length of every slot)
  // BIRTHS: any enemy without a slot gets one (under the total cap), back-filled to length kf with its birth pos
  for (const e of enemies) {
    if (e._bdSlot === undefined && bdRec.ships.length < MAX_GHOST_SHIPS) {
      const slot = bdRec.ships.length; e._bdSlot = slot;
      const bx = e.mesh.position.x, bz = e.mesh.position.z, by = e.heading;
      const S = { shipName: e.name, scale: e.sizeScale || 1, birth: kf, death: -1, x: [], z: [], yaw: [] };
      for (let i = 0; i < kf; i++) { S.x.push(bx); S.z.push(bz); S.yaw.push(by); } // pre-birth placeholders (hidden + not re-centered)
      bdRec.ships.push(S); bdRec.cast[slot] = e; bdRec.last[slot] = { x: bx, z: bz, yaw: by };
    }
  }
  const rec = (s, x, z, yaw) => { const S = bdRec.ships[s]; S.x.push(x); S.z.push(z); S.yaw.push(yaw); bdRec.last[s] = { x, z, yaw }; };
  if (G.player && G.player.alive) rec(0, G.player.mesh.position.x, G.player.mesh.position.z, G.player.heading);
  else rec(0, bdRec.last[0].x, bdRec.last[0].z, bdRec.last[0].yaw);       // player always recorded, death:-1
  for (let s = 1; s < bdRec.ships.length; s++) {
    const e = bdRec.cast[s];              // cast[s] aligned to slot s (cast[0] = null, the player)
    if (enemies.includes(e)) rec(s, e.mesh.position.x, e.mesh.position.z, e.heading);
    else { if (bdRec.ships[s].death < 0) bdRec.ships[s].death = kf; rec(s, bdRec.last[s].x, bdRec.last[s].z, bdRec.last[s].yaw); }
  }
  let bc = 0; for (const b of bullets) { if (bc >= MAX_GHOST_BULLETS) break; bdRec.bullets.x.push(b.mesh.position.x); bdRec.bullets.z.push(b.mesh.position.z); bc++; }
  bdRec.bullets.counts.push(bc);
  if (bdRec.elapsed >= bdRec.maxSeconds) window.__backdrop.stop();       // auto-stop
}
if (isDev()) window.__backdrop = {
  record({ maxSeconds = 60, fps = 20 } = {}) {   // default 60 s (~150–250 KB @ 20fps / ≤16 slots / ≤24 bullets)
    const p = G.player; if (!p) { console.warn('[backdrop] no player — start a fight first'); return; }
    for (const e of enemies) delete e._bdSlot;   // clear stale slot tags from a prior recording (no reload)
    // start with ONLY the player slot; enemies (current + all later waves) join via births in backdropCapture
    const ships = [{ shipName: G.currentShipName, scale: 1, birth: 0, death: -1, x: [], z: [], yaw: [] }];
    // acc:0 → the remainder-preserving `acc -= 1/fps` decrement yields exactly `fps` keyframes/sec. Do NOT use
    // a large sentinel (e.g. 1e9): the guard would pass EVERY live frame (~60fps) while the track is stamped
    // fps:20, so playback would run 3× too long at 1/3 speed — and no shape/bounded guard would catch it.
    bdRec = { fps, maxSeconds, acc: 0, elapsed: 0, cast: [null], ships, last: [{ x: 0, z: 0, yaw: 0 }], bullets: { counts: [], x: [], z: [] } };
    console.log(`[backdrop] recording (player + up to ${MAX_GHOST_SHIPS - 1} enemy waves, ~${maxSeconds}s @ ${fps}fps)…`);
  },
  stop(name = 'freighter-skirmish') {
    if (!bdRec) return null;
    const raw = { name, seed: 0, fps: bdRec.fps, frames: bdRec.ships[0].x.length, ships: bdRec.ships, bullets: bdRec.bullets };
    bdRec = null;
    const track = recenterAndQuantize(raw, { name });
    const src = `// GENERATED — a real recorded battle (do not hand-edit). See docs/plans/2026-07-07-1606-backdrop-ghost-battle.md\nexport const BACKDROP_BATTLE = ${JSON.stringify(track)};\n`;
    try { const b = new Blob([src], { type: 'text/javascript' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'backdrop-battle.js'; document.body.appendChild(a); a.click(); a.remove(); } catch {}
    console.log(`[backdrop] ${track.frames} frames, ${track.ships.length} ships, ${(src.length / 1024).toFixed(0)} KB → downloaded backdrop-battle.js`);
    return track;
  },
  // Live status for the panel's REC readout + Start/Stop toggle (polled by buildBackdropPanel).
  status() { return { recording: !!bdRec, elapsed: bdRec ? bdRec.elapsed : 0, maxSeconds: bdRec ? bdRec.maxSeconds : 60 }; },
};
```
Add the capture hook in `animate()` right after `if (!G.paused) update(dt);`, near the existing
`benchRecording` push (`main.js:484`). **Gate it on `!G.paused`** — the hook runs after the pause-gated
`update(dt)`, so without the guard a pause mid-record would keep accumulating `dt`/`elapsed`, record frozen
duplicate frames, and could even auto-stop during a pause. With the guard it records only **live, unpaused**
frames:
```js
if (bdRec && !G.paused) backdropCapture(dt);
```
Notes:
- `G.currentShipName` (`state.js:53`) is the built player ship's catalog name → resolves to the model at
  playback via `CATALOG.shipByName`. If ever null, fall back to `G.activeShip?.ship?.name`.
- The recorder does **not** depend on the runtime ghost player or `?debug` — it observes the live fight
  directly. So keep the runtime player's `?debug`-off gate (for the visual suite); recording runs under `?dev`
  (a different flag) during a normal fight. No conflict.
- **Determinism:** a hand-flown battle is NOT re-generable byte-identically — that's fine. The **committed
  JSON is the artifact**; do not require a byte-identical re-run for the recorded track.

## Step 3b — `?dev` "Backdrop authoring" panel (record controls + live appearance sliders)

One compact `?dev`-only DOM panel, built with **lil-gui exactly like the `?tune` palette panel** (`tune.js` +
its dynamic-import injection at `main.js:843-845`) so players never fetch lil-gui and the default build is
unchanged. It hosts BOTH the record controls (request 3) and the live appearance tuning (request 1). No
settings-menu integration, no player-facing surface (§30).

**Injection** — in `bootstrap()`, next to the `?tune` block (`main.js:843`), add (gated on `isDev()`, dynamic
imports so it's zero-cost when off):
```js
if (isDev()) {
  const { default: GUI } = await import('three/addons/libs/lil-gui.module.min.js');
  const { buildBackdropPanel } = await import('./ghost-battle.js');
  buildBackdropPanel(GUI);
}
```

**Live appearance tunables** — move the three appearance constants into a persisted tune object so the panel
can override them live while the module keeps the committed defaults. In `ghost-battle-track.js` (pure, see
Step 2) add `GHOST_TUNE_DEFAULTS = { y: -60, scale: 0.8, opacity: 0.9, ax: -100, az: -450 }`, `GHOST_TUNE_RANGES`,
`clampGhostTune`, `loadGhostTune(store)`, `saveGhostTune(store, t)` (mirrors `graphics.js`'s
`loadTier`/`saveTier` localStorage discipline, key `ghostTune`). In `ghost-battle.js`:
- `const GHOST_TUNE = loadGhostTune(window.localStorage);` is the single live source; `GHOST_TUNE_DEFAULTS` is
  the committed source-of-truth (bake the maintainer's final dialed-in numbers back into it).
- The ghost `entry.update(dt)` reads `GHOST_TUNE` each frame:
  `group.position.set(GHOST_TUNE.ax, GHOST_TUNE.y, GHOST_TUNE.az)` (absolute anchor, D5) and
  `group.scale.setScalar(GHOST_TUNE.scale)` (both cheap) — so the Depth/Scale/Anchor sliders all apply live.
  **Opacity must reach the already-built ghost
  materials** — expose `activeGhost.applyOpacity(v)` that traverses the ghost group's meshes and sets each
  material's `opacity` (+ `transparent = true`); the panel's opacity `onChange` calls it (and it's re-applied
  once when a late-loading glb swaps in, so slider changes reach meshes that finished loading afterwards).
- Each ghost's build spec uses `GHOST_TUNE.opacity` (not a bare constant) so its initial load is already at the
  tuned value.

**The panel** — `buildBackdropPanel(GUI)` in `ghost-battle.js` (mirrors `buildTunePanel`):
```js
export function buildBackdropPanel(GUI) {
  const gui = new GUI({ title: 'Backdrop (?dev)' });
  // -- Appearance (live; only visible effect inside a non-freighter mission where the ghost battle exists) --
  const ap = gui.addFolder('Appearance');
  ap.add(GHOST_TUNE, 'y', GHOST_TUNE_RANGES.y[0], GHOST_TUNE_RANGES.y[1], 0.5).name('Depth (y)')
    .onChange(() => saveGhostTune(window.localStorage, GHOST_TUNE));           // update applied each frame
  ap.add(GHOST_TUNE, 'scale', GHOST_TUNE_RANGES.scale[0], GHOST_TUNE_RANGES.scale[1], 0.05).name('Scale')
    .onChange(() => saveGhostTune(window.localStorage, GHOST_TUNE));
  ap.add(GHOST_TUNE, 'opacity', GHOST_TUNE_RANGES.opacity[0], GHOST_TUNE_RANGES.opacity[1], 0.05).name('Opacity')
    .onChange((v) => { activeGhost?.applyOpacity(v); saveGhostTune(window.localStorage, GHOST_TUNE); });
  // ABSOLUTE world coordinate of the anchor (D5, default (-100,-450)) — dial the exact world spot (±600).
  ap.add(GHOST_TUNE, 'ax', GHOST_TUNE_RANGES.ax[0], GHOST_TUNE_RANGES.ax[1], 5).name('Anchor X (world)')
    .onChange(() => saveGhostTune(window.localStorage, GHOST_TUNE));            // applied each frame (group.position)
  ap.add(GHOST_TUNE, 'az', GHOST_TUNE_RANGES.az[0], GHOST_TUNE_RANGES.az[1], 5).name('Anchor Z (world)')
    .onChange(() => saveGhostTune(window.localStorage, GHOST_TUNE));
  // lil-gui sliders show the numeric value next to each control automatically → maintainer reads off the numbers.
  const hint = { note: '' };
  ap.add(hint, 'note').name('status').listen().disable();   // shows "no ghost battle (play a non-freighter mission)"
  // -- Record --
  const rc = gui.addFolder('Record');
  const st = { label: 'REC 0s/60s' };
  const btn = rc.add({ toggle() { const s = window.__backdrop.status(); s.recording ? window.__backdrop.stop() : window.__backdrop.record(); } }, 'toggle');
  const readout = rc.add(st, 'label').name('elapsed').listen().disable();
  setInterval(() => {                                        // dev-only 4 Hz poll → button label + readout + hint
    const s = window.__backdrop.status();
    btn.name(s.recording ? 'Stop recording' : 'Start recording');
    st.label = s.recording ? `REC ${s.elapsed | 0}s/${s.maxSeconds}s` : '(idle)';
    hint.note = activeGhost ? 'ghost battle live' : 'no ghost battle (play a non-freighter mission)';
  }, 250);
}
```
Notes:
- `activeGhost` is a module-level handle in `ghost-battle.js` set by `buildGhostBattle` (`{ applyOpacity }`) and
  cleared when the ghost group is torn down (guard `applyOpacity` for the no-battle case). The Depth/Scale
  sliders take effect only where a ghost group exists (a non-freighter mission); the `status` line makes that
  obvious when it doesn't.
- Keep it lil-gui (like `?tune`) — sliders render their value inline, buttons + `.listen()`-ed readouts cover
  the REC UI, and it's ~30 lines. Do not hand-roll a bespoke DOM panel.

**DEPTH SLIDER — the maintainer reported "no visible effect"; the implementer MUST live-repro and fix the real
cause (do NOT assume it's fine).** Load `?dev`, play a non-freighter mission (e.g. campaign) on High, drag **Depth (y)** across
its full −80..0 range and watch the battle. Two candidate causes, in priority order:
1. **Shared-object bug (most likely a code fault):** `GHOST_TUNE` must be a **single module-scope object** in
   `ghost-battle.js` that BOTH `buildBackdropPanel` (which lil-gui mutates in place) AND `entry.update` (which
   reads `GHOST_TUNE.y/ax/az`) close over. If either re-calls `loadGhostTune()` and gets its **own** copy, the
   slider mutates one object while `entry.update` reads another → zero effect. Verify identity (e.g. temporarily
   `console.log(GHOST_TUNE)` from both) and ensure exactly one module-scope `const GHOST_TUNE`.
2. **Real-but-subtle (camera geometry):** the camera is near-top-down (`CAM_OFFSET 0,110,26`, `engine.js:51`),
   so **world +Y is nearly parallel to the view axis** — changing `group.position.y` moves the battle mostly
   *toward/away from the camera*, which changes its **apparent size / depth-sorting**, not its screen position.
   So Depth may be working yet read as "barely moves." That's why depth alone can't place the battle on
   screen — **the Anchor X/Z sliders (which move it across the ground plane, clearly visible) are the placement
   control**; Depth is only for layer separation (the maintainer chose `−60`). If repro confirms this (identity
   is correct, Depth changes apparent size while Anchor X/Z clearly moves it across screen), **state so in the
   PR** and keep Depth as-is — do NOT repurpose the Depth slider for screen motion; that's what Anchor X/Z are.

## Step 4 — Synthetic bootstrap generator (`bakeBackdrop` + `gen-backdrop.mjs`) — SECONDARY / fallback

So the runtime + tests function **before** the maintainer records the real battle, ship a synthetic generator
that produces a valid committed track headlessly. It is **secondary** to Step 3 (the maintainer replaces its
output with a real recording), but keeping it means the feature is shippable + CI-green out of the box (§30).

**`bakeBackdrop` in `main.js`** — add inside the existing `if (isBench()) { … }` block (near `window.__bench`,
~`main.js:616`). It reuses `replay()`'s deterministic setup, spawns a **fixed, non-respawning cast** with
stable slots, steps `update(BENCH_DT)`, captures every 3rd tick (60→20 fps), and returns **raw** float arrays
(same `{ fps, frames, ships:[{shipName,scale,death,x,z,yaw}], bullets:{counts,x,z} }` shape the recorder
builds):
```js
async bakeBackdrop({ seconds = 15, fps = 20 } = {}) {
  installSeededRandom(BENCH_SEED);           // deterministic
  const playerDef = shipById(1); if (playerDef) buildPlayerFor(playerDef);
  reset(); G.gameStarted = true;
  const defs = [CATALOG.enemyShips[0], CATALOG.enemyShips[0], CATALOG.enemyShips[1] || CATALOG.enemyShips[0],
                CATALOG.enemyShips[2] || CATALOG.enemyShips[0], CATALOG.enemyShips[0]];
  const cast = defs.map((d) => spawnEnemyShip(d));                     // fixed cast, all born at frame 0
  const ships = [{ shipName: playerDef.name, scale: 1, birth: 0, death: -1, x: [], z: [], yaw: [] }]
    .concat(cast.map((e) => ({ shipName: e.name, scale: e.sizeScale || 1, birth: 0, death: -1, x: [], z: [], yaw: [] })));
  const last = ships.map(() => ({ x: 0, z: 0, yaw: 0 })), bul = { counts: [], x: [], z: [] };
  const rec = (s, x, z, yaw) => { const S = ships[s]; S.x.push(x); S.z.push(z); S.yaw.push(yaw); last[s] = { x, z, yaw }; };
  for (const c in keys) keys[c] = false; keys['KeyW'] = true; keys['Space'] = true;   // seeded player skirmishes
  const step = Math.round((1 / fps) / BENCH_DT) || 3, total = Math.round(seconds / BENCH_DT);
  for (let tick = 0; tick <= total; tick++) {
    update(BENCH_DT);
    if (tick % step) continue;
    const kf = ships[0].x.length;
    if (G.player) rec(0, G.player.mesh.position.x, G.player.mesh.position.z, G.player.heading); else rec(0, last[0].x, last[0].z, last[0].yaw);
    for (let s = 1; s < ships.length; s++) { const e = cast[s - 1];
      if (enemies.includes(e)) rec(s, e.mesh.position.x, e.mesh.position.z, e.heading);
      else { if (ships[s].death < 0) ships[s].death = kf; rec(s, last[s].x, last[s].z, last[s].yaw); } }
    let bc = 0; for (const b of bullets) { if (bc >= MAX_GHOST_BULLETS) break; bul.x.push(b.mesh.position.x); bul.z.push(b.mesh.position.z); bc++; } bul.counts.push(bc);
  }
  return { seed: BENCH_SEED, fps, frames: ships[0].x.length, ships, bullets: bul };  // RAW floats
},
```
(`BENCH_SEED`, `BENCH_DT`, `buildPlayerFor`, `shipById`, `spawnEnemyShip`, `update`, `enemies`, `bullets`,
`keys`, `G`, `CATALOG`, `reset`, `installSeededRandom`, `MAX_GHOST_BULLETS` are imported/in scope.)

**`gen-backdrop.mjs`** — model it on `client/bench/run.mjs` (same isolated server + static server +
headless-Chromium harness):
1. Start the isolated API server + a static server; launch headless Chromium (swiftshader args, `run.mjs:133`).
2. `page.goto('/?bench=replay')`, wait for `window.__bench.ready()`.
3. `const raw = await page.evaluate(() => window.__bench.bakeBackdrop({ seconds: 15, fps: 20 }))`.
4. `const track = recenterAndQuantize(raw)` — **import the SAME pure helper** from
   `../src/ghost-battle-track.js` (do NOT re-implement re-centering here; one source of truth).
5. Write `client/src/backdrop-battle.js`:
   `// GENERATED (synthetic bootstrap) …\nexport const BACKDROP_BATTLE = <JSON.stringify(track)>;\n`.
6. Print a KB summary (target tens–low-hundreds of KB).

Add an npm script next to `"bench"`: `"bench:backdrop": "node bench/gen-backdrop.mjs"`. It's **not** part of
`npm test` (forks Chromium), like `run.mjs`. Its synthetic output IS deterministic (seeded), but that's a
convenience — the **canonical committed track is the real recording** from Step 3.

## Step 5 — Runtime builder (`ghost-battle.js`)

```js
import * as THREE from 'three';
import { scene } from './engine.js';
import { G, CATALOG, setPieces } from './state.js';
import { makeShip, shipModelCfg } from './ship-factory.js'; // modelSpec NOT needed — the ghost spec is built inline (adds opacity)
import { spawnShipExplosion, bulletGeo } from './projectiles.js';
import { ghostBattlePlan, sampleShip, frameIndex, MAX_GHOST_BULLETS,
         GHOST_TUNE_RANGES, loadGhostTune, saveGhostTune } from './ghost-battle-track.js'; // slotAlive used by tests only, not here

const GHOST_EXHAUST = 0xff8030; // death-burst tint (generic)
// Live appearance + placement (Step 3b): defaults are the committed source-of-truth in ghost-battle-track.js
// (GHOST_TUNE_DEFAULTS = { y:-60, scale:0.8, opacity:0.9, ax:-100, az:-450 }); the ?dev panel overrides
// GHOST_TUNE live + persists. entry.update reads GHOST_TUNE every frame so slider changes (look AND the
// absolute anchor) apply live. ax/az are an ABSOLUTE world coordinate (D5), not an offset — no arenaCenter.
const GHOST_TUNE = loadGhostTune(window.localStorage);
let activeGhost = null; // { applyOpacity } handle for the ?dev panel (best-effort; may be stale off-mission)

// Build (async) and register the ghost battle as a set-piece entry anchored at a FIXED ABSOLUTE world point
// (GHOST_TUNE.ax, y, az) — the same spot (default the freighter start (-100,-450)) regardless of mission, a
// distant landmark the player flies toward (D5). Called from sim.js reset() for every NON-freighter mission
// (see Step 6), on an eligible tier. Takes no argument — placement comes from GHOST_TUNE.
export async function buildGhostBattle() {
  // Skip in BOTH headless harnesses: ?debug (visual suite) AND ?bench (perf A/B) — the async glb loads would
  // add nondeterministic draw counts to the benched campaign scenario (the gate now runs with activeMission
  // null → this feature is active there). Real per-frame cost is judged on-device (see the perf section).
  const headless = location.search.includes('debug') || location.search.includes('bench');
  const plan = ghostBattlePlan(G.gfx.name, headless);
  if (!plan.enabled) return;
  const group = new THREE.Group();
  group.scale.setScalar(GHOST_TUNE.scale);
  scene.add(group);
  // register immediately with a no-op update; swap in the real update once loaded (avoids a load race)
  const entry = { obj: group, update: () => {} };
  setPieces.push(entry);

  const { BACKDROP_BATTLE: T } = await import('./backdrop-battle.js');
  const ghostMeshes = [];
  // Build a mesh for EVERY slot (track is already capped to MAX_GHOST_SHIPS). Do NOT slice to a per-tier
  // "first N" — that would drop every later-BORN wave. The tier caps CONCURRENT visible ghosts instead
  // (plan.maxConcurrent), applied per-frame by birth/death visibility below.
  const slots = T.ships.map((sh) => {
    const row = CATALOG.shipByName.get(sh.shipName);            // resolve model live (no baked hashes)
    const mc = row ? shipModelCfg(row.stats) : {};
    const spec = row && row.modelUrl
      ? { url: row.modelUrl, tint: false, yaw: mc.yaw ?? 0, scaleMul: mc.scaleMul ?? 1,
          opacity: GHOST_TUNE.opacity }        // near-opaque, full color — a visible distant battle (live-tunable)
      : null;
    const mesh = makeShip(row ? row.stats.color : 0x8899aa, spec);
    mesh.position.y = 0; mesh.visible = false;                  // group at GHOST_TUNE.y; shown once born (below)
    group.add(mesh); ghostMeshes.push(mesh);
    return { data: sh, mesh, dead: false, wasVisible: false };
  });

  // ?dev live-opacity: traverse the (possibly late-loaded) ghost meshes' materials + set opacity/transparent.
  const applyOpacity = (v) => { for (const m of ghostMeshes) m.traverse((o) => { if (o.isMesh && o.material) {
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((mt) => { mt.transparent = true; mt.opacity = v; }); } }); };
  activeGhost = { applyOpacity };

  // Bullet dot pool (High only)
  let bulletPool = [];
  if (plan.bullets) {
    const bmat = new THREE.MeshBasicMaterial({ color: 0xffd27f, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
    for (let i = 0; i < MAX_GHOST_BULLETS; i++) { const m = new THREE.Mesh(bulletGeo, bmat); m.visible = false; group.add(m); bulletPool.push(m); }
  }

  let t = 0;
  const dur = T.frames / T.fps;
  const _wp = new THREE.Vector3();
  entry.update = (dt) => {
    // FIXED ABSOLUTE world anchor (D5) — same spot every mission (default the freighter start -100,-450).
    // Read each frame so the ?dev Anchor X/Z + Depth + Scale sliders apply live (cheap).
    group.position.set(GHOST_TUNE.ax, GHOST_TUNE.y, GHOST_TUNE.az);
    group.scale.setScalar(GHOST_TUNE.scale);
    t += dt;
    if (t >= dur) { t -= dur; for (const s of slots) s.dead = false; } // loop reset (visibility recomputed below)
    const kf = frameIndex(t, T.fps, T.frames);
    let visible = 0;                       // enforce the per-tier CONCURRENT ceiling
    for (const s of slots) {
      const born = kf >= (s.data.birth || 0);
      const dead = s.data.death >= 0 && kf >= s.data.death;
      if (dead) {
        // explode once, only if this ghost was actually on-screen the previous frame (not capped-out/off)
        if (!s.dead && s.wasVisible) { s.dead = true;
          // real small-pirate explosion, RING pinned to the ghost's own below-plane depth (_wp.y ≈ GHOST_TUNE.y),
          // NOT the combat plane — so no phantom ring appears where the player fights.
          s.mesh.getWorldPosition(_wp); spawnShipExplosion(_wp, GHOST_EXHAUST, GHOST_TUNE.scale, _wp.y); }
        s.mesh.visible = false; s.wasVisible = false; continue;
      }
      if (!born || visible >= plan.maxConcurrent) { s.mesh.visible = false; s.wasVisible = false; continue; }
      s.mesh.visible = true; s.wasVisible = true; visible++;
      const p = sampleShip(s.data, t, T.fps, T.frames, T.qPos, T.qYaw);
      s.mesh.position.set(p.x, 0, p.z);
      s.mesh.rotation.y = p.yaw;
    }
    if (bulletPool.length) {
      const n = T.bullets.counts[kf] || 0;
      let base = 0; for (let i = 0; i < kf; i++) base += T.bullets.counts[i]; // prefix sum
      for (let i = 0; i < bulletPool.length; i++) {
        const on = i < n;
        bulletPool[i].visible = on;
        if (on) bulletPool[i].position.set(T.bullets.x[base + i] / T.qPos, 0, T.bullets.z[base + i] / T.qPos);
      }
    }
  };
}
```
Implementer notes:
- **Visibility treatment requires a small extension to `applyShipModel`** (`client/src/ship-factory.js:51-93`):
  destructure `opacity = null, darken = 0` from the spec, and after the existing `tint` block add a block that
  (when `opacity != null || darken`) clones each mesh material, multiplies `m.color.multiplyScalar(darken)`
  when `darken`, sets `m.transparent = true; m.opacity = opacity` when `opacity != null`, and sets
  `m.fog = true`. Guard both by truthiness so **real ships are unaffected** (they pass neither key). Ghosts
  pass **only `opacity`** now (from `GHOST_TUNE.opacity`) — `darken` support stays for future tuning but is
  unused. This keeps glb normalization in one place instead of duplicating a loader in `ghost-battle.js`.
- **`buildBackdropPanel(GUI)` (Step 3b) is also exported from this module** — it closes over the module-scope
  `GHOST_TUNE` / `activeGhost` / `GHOST_TUNE_RANGES` / `saveGhostTune`, and calls the global
  `window.__backdrop` (main.js) for record/stop. `activeGhost` is best-effort (may be stale after leaving the
  a non-freighter mission); its consumers guard for null.
- **Mesh count vs draw count (births).** One mesh is built per track slot (≤ `MAX_GHOST_SHIPS` = 16), but only
  the born-and-alive ones up to `plan.maxConcurrent` (High 8 / Balance 4) are ever `visible` — hidden meshes
  don't draw, so the weak-device bottleneck (draw-call submit, §23) is bounded by `maxConcurrent`, not 16. The
  ≤16 glb *loads* at mission start reuse repeated URLs (browser HTTP cache dedupes the fetch) and this is off
  on the Performance tier entirely; if the load hitch ever bites, pooling meshes is a follow-up (not v1 — §30).
- The concurrent cap picks the **first** born-and-alive slots by slot order (= order of appearance). That's
  deterministic and simple; it can occasionally hide a just-born ghost until an earlier one dies. Acceptable
  for distant decor (§30) — do not add priority/among-visible juggling.
- Prefix-summing bullet offsets each frame is O(frames) — cheap for `frames=1200` (60 s @ 20 fps) but if you
  prefer, precompute a `bulletOffsets` prefix-sum array once after import.
- **`spawnShipExplosion` needs a `ringY` param (Fold-in 2).** As written, `spawnShipExplosion` pins its
  shockwave *ring* to `y = BULLET_PLANE_Y` (`client/src/projectiles.js:108`), so a below-plane ghost death
  would pop a ~11-radius additive ring at `y≈0.6` at the freighter's `(x,z)` — a phantom ring on the plane the
  player fights on, with no visible source. That brushes the readability hard-requirement. **Extend the
  signature** to `spawnShipExplosion(pos, exhaustColor = 0xff8030, sizeScale = 1, ringY = BULLET_PLANE_Y)` and
  change line 108 to `ring.position.y = ringY;`. The default keeps ALL existing callers
  (`sim.js:705`, `sim.js:748`) unchanged (they still get the combat-plane ring). The ghost caller passes the
  ghost's real depth (`_wp.y ≈ GHOST_TUNE.y`, default −60), so the fireball, sparks AND ring all appear down at
  the ghost layer, not on the `0.6` combat plane — no on-plane phantom. Keep the full explosion
  (flash/particles), only relocate the ring.

## Step 6 — Build trigger in `reset()` (`sim.js`), gated to NON-freighter missions

The build trigger MOVED off the freighter set-piece (it's no longer freighter-tied). Build it once per run,
for every mission **except** the freighter escort, at the fixed ABSOLUTE world anchor. In `client/src/sim.js`
`reset()`, **after** the set-piece rebuild loop (`for (const spec of G.mapSetpieces) buildSetPiece(spec);` at
`sim.js:845`), add:
```js
// Ambient distant ghost battle: shown in every mission EXCEPT the freighter escort (you're IN that fight
// there). Anchored at a fixed ABSOLUTE world point (default the freighter start -100,-450; see ghost-battle.js)
// — a distant landmark the player flies toward. Dynamic import → off the initial bundle; self-gates on tier/?debug/?bench.
if (G.activeMission?.title !== 'freighter') {
  import('./ghost-battle.js').then((m) => m.buildGhostBattle()).catch(() => {}); // async; distant decor
}
```
- `G.activeMission` is `null` on the campaign (→ shows) and the descriptor whose `title` is the side-mission
  `type` otherwise; `!== 'freighter'` shows on campaign + mining/research and hides on the freighter escort.
- Dynamic `import()` keeps `ghost-battle.js` + `backdrop-battle.js` out of the initial bundle.
- Tier/`?debug`/`?bench` gating lives inside `buildGhostBattle`, so on Performance/`?debug`/`?bench` it returns
  early and builds nothing. It takes **no argument** — placement is the absolute `GHOST_TUNE.ax/y/az`.
- **Teardown:** `reset()` already removes every `setPieces` entry's `.obj` from the scene and clears the array
  (`sim.js:843-844`) BEFORE the rebuild loop; `buildGhostBattle` adds its group to `scene` **and** pushes its
  entry to `setPieces`, so the next `reset()` tears it down automatically. Because the build is async, a
  ghost-battle build kicked off by a run that's immediately reset again could resolve after teardown and leave
  a stray group; guard by checking `G.gameStarted` at resolve — but simplest (and matching the prior pattern)
  is to accept it as a dev-negligible edge and rely on the next `reset()` to clean it. **Do NOT import
  `ghost-battle.js` statically into `sim.js`** (keep it a dynamic import so it stays
  out of the initial bundle and avoids a `sim.js ↔ world.js ↔ ghost-battle.js` static cycle).

## Tests

**Add `client/src/ghost-battle-track.test.js`** (pure `node --test`, run: `cd client && node --test`):
- `ghostBattlePlan`: `('performance', false) → enabled:false`; `(x, true) → enabled:false` for every tier;
  `('balance', false) → { enabled:true, maxConcurrent:4, bullets:false }`;
  `('high', false)` and `('unknown', false) → { enabled:true, maxConcurrent:8, bullets:true }`.
- `slotAlive`: player slot (`birth:0, death:-1`) alive at every `kf`; a slot `{birth:5, death:10}` is alive at
  `kf 5..9` and NOT at `kf<5` or `kf>=10`; a `death:-1` slot with `birth:5` is alive for all `kf>=5`.
- `sampleShip`: build a tiny synthetic ship (`frames:3`, `qPos:10`, `qYaw:100`, e.g. x=[0,100,200]) and assert
  the midpoint `t = 0.5/fps` lerps to `x≈5` (dequantized 0.5); assert **yaw takes the shortest arc** across the
  ±π seam (e.g. from `+3.0 rad` to `−3.0 rad` interpolates through π, not through 0); assert the **last frame
  does not lerp into the wrap** (index clamp).
- quantize round-trip: `deq(Math.round(v*10), 10)` within `±0.05` for a few `v`.
- **Tune helpers (`?dev` panel, pure):** `clampGhostTune` clamps out-of-range/NaN inputs to
  `GHOST_TUNE_RANGES` for **all five keys** (e.g. `y:5 → 0`, `y:-99 → -80`, `scale:'x' → default 0.8`,
  `opacity:2 → 1.0`, `az:-999 → -600`, `ax:999 → 600`); `loadGhostTune(store)` returns `GHOST_TUNE_DEFAULTS`
  (incl. `ax:-100, az:-450`) on empty/garbage storage and a clamped object on valid JSON; `saveGhostTune`
  round-trips through a Map-backed fake store (mirror `graphics.test.js`'s `makeStore`).
- **`recenterAndQuantize` (FIXED mean offset — player flies freely):** feed a synthetic `raw` where slot 0
  (the player) **translates** across frames (e.g. `p0.x[kf] = kf*5`) and other slots have their own motion.
  Assert the returned track subtracts the **same constant** (the player's mean, here `mean(kf*5)`) from every
  slot and all bullets — i.e. **slot 0 still moves frame-to-frame** (its motion is preserved, NOT pinned to
  origin) and its mean is ≈0; assert a bullet co-located with a ship stays co-located; assert `birth` preserved
  and output arrays integer. (This guards the reversal: a regression to per-keyframe slot-0 subtraction would
  make slot 0 constant `(0,0)` — assert it is NOT constant.)
- **Born-late slot (births):** include a slot with `birth = frames/2` whose **pre-birth** placeholders are far
  off. Assert the single fixed offset is unaffected by that slot (it's computed from slot 0 only), and that
  from `birth` on it is offset by the same constant as everyone else. Proves births don't shift the anchor.
- **Artifact shape guard:** `import { BACKDROP_BATTLE } from './backdrop-battle.js'` and assert
  `version===1`, `frames>0`, `1 <= ships.length <= 16`, every ship's `x/z/yaw` length `=== frames`,
  every slot has an integer `birth` in `0..frames` and `death` that is `-1` or in `birth..frames` (so
  `birth ≤ deathOrEnd`), `bullets.counts.length === frames`, and `bullets.x.length === sum(counts)`. Guards the
  committed track (synthetic bootstrap OR the maintainer's recording) against a bad file.
- **Runaway sanity guard (loose — the real constraint is visual/manual now):** with a fixed offset the player
  AND enemies both move, so the spread from origin is larger than a player-relative bound; slot 0 is **no
  longer ≡ origin** (dropped that assertion). Assert only that every **born-and-alive** slot
  (`slotAlive(sh, kf, frames)`, dequantized) stays within `Math.hypot(x, z) < 600` u of origin over its live
  frames — a runaway/not-re-centered track (translating thousands of u) fails loudly, but "fits on screen at
  the chosen scale" is a **manual playtest** item (the maintainer tunes `scale`), not a tight automated bound.
  Pre-birth/post-death frozen samples are excluded.

Keep the pure helpers in `ghost-battle-track.js` (no THREE/DOM) so the whole test file loads under bare node.
`ghost-battle.js` (THREE-dependent) is **not** unit-tested; its behavior is covered by the pure sampler +
manual visual check.

**Server:** `cd server && npm test` — the only server change is the freighter `pos` (and a comment).
Confirm no test hard-asserts the freighter `z=-450`; the seed flows identically to SQLite and Postgres from
`catalog_seed.js`, so **no `db.js` / `db_postgres.js` edit and no parity risk**. (Grep both server backends +
`server/test` for `-450` to be sure.)

**Bench gate (informational, not `npm test`):** the pipeline PERF A/B stage (`cd client && node bench/run.mjs`,
DECISIONS §58). The gate flip matters here: the ghost battle now shows in the **campaign** (no active mission),
which is exactly what the bench trace (`combat-heavy.json`, `activeMission` null) exercises — so it WOULD build
during the bench. But `buildGhostBattle` **self-skips under `?bench`** (like `?debug`), because its async glb
loads would add **nondeterministic draw/tri counts** to `load.*` (the meshes may or may not have finished
loading at a given tick), which would make the structural signal flaky. So the bench stays **FLAT** and clean.
The ghost battle's **real per-frame cost is measured on-device**, not by this CPU-only gate: it's bounded by
the concurrent-visible cap (≤8 extra ship draws + ≤24 bullet dots on High, ≤4/no-bullets on Balance, 0 on
Performance) and adds **no sim (`update`) cost** (it never touches `G`/`enemies`/projectiles) — so any real
regression is fill/draw-submit, which the §58 GPU-blind-spot note already defers to real-device `?dev`
telemetry. Flag in the PR that this is deliberately not benched (async-load nondeterminism), with the
on-device draw budget stated.

## Authoring / regeneration procedure

**Canonical (PRIMARY) — record a real battle:**
```
# open the game with ?dev, start any fight (record your own live battle). In the ?dev "Backdrop" panel:
#   click Start recording  → fight ~60 s (auto-stops at 60 s), watch the REC 12s/60s readout, click Stop
#   (or console: __backdrop.record() / __backdrop.stop())
# a backdrop-battle.js downloads → move it to client/src/backdrop-battle.js
cd client && node --test   # shape + bounded-formation guards pass
# commit client/src/backdrop-battle.js
# optionally: use the panel's Depth/Scale/Opacity sliders to dial the look, then bake the final
#   numbers into GHOST_TUNE_DEFAULTS (client/src/ghost-battle-track.js)
```
**Bootstrap/fallback (SECONDARY) — synthetic, so the repo is functional before a recording exists:**
```
cd client && node bench/gen-backdrop.mjs   # writes client/src/backdrop-battle.js (synthetic, seeded)
cd client && node --test                   # guards pass
```
The implementer runs the bootstrap generator once to commit an initial working `backdrop-battle.js`; the
maintainer later replaces it with a real recording. A hand-recorded track is **not** re-generable
byte-identically — the committed JSON itself is the artifact (drop any byte-identical expectation for it).

**MUST RE-RECORD after the fixed-offset re-anchor change:** every prior committed `backdrop-battle.js` baked in
a DIFFERENT re-centering (live-centroid, then per-keyframe slot-0) that **subtracted a per-frame offset — which
destroyed the player's absolute free-flight motion and cannot be recovered** by post-processing. The new
`recenterAndQuantize` removes only a single constant, preserving the player's real motion, but it needs the
raw motion that only a fresh capture has. So after this change the implementer regenerates the bootstrap
(`node bench/gen-backdrop.mjs`, which now uses the fixed-offset re-center) to commit a valid placeholder, and
the **maintainer re-records** the canonical free-flight battle in-game. (There is no automated test that
detects "player was pinned" beyond the recenter unit test asserting slot 0 is NOT constant; a stale track that
predates this change simply plays with the wrong motion until re-recorded.)

## Docs to update

- **`docs/SUMMARY.md`:**
  - Add a **"Ambient ghost battle" subsection** (near the mission set-pieces / freighter area, whose reposition
    to `pos [-100,-48,-400]` also gets noted): a **clearly visible, looping recorded skirmish** shown in
    **every mission EXCEPT the freighter escort**, anchored at a **fixed ABSOLUTE world point** (default
    `(−100,−450)`, the freighter start — the same spot every mission; NOT camera/player/freighter-following) — a
    **distant landmark the player flies toward** and watches fade in through the fog (off-screen from the
    mission center is intended; reachable/viewable from within the arena bounds). The **recorded player ship
    flies freely** (positions re-centered by a single fixed offset, so real motion is preserved, no
    birth/death jump). Up to **16 ship slots with per-slot
    `birth`/`death`** so a 60 s recording stays populated with waves; + bullets. **Near-opaque, full-color,
    moderate scale, depth `y≈−60`** (a separate below-plane layer the player can't shoot); non-interactive (no
    collision/targeting/HUD/markers/audio); a committed transform track (`client/src/backdrop-battle.js`)
    replayed as a dumb lerped animation (no second sim); death → the real small-pirate explosion at the ghost's
    depth; tier-gated by a **concurrent-visible ceiling** (High 8 + bullets / Balance 4, no bullets /
    Performance off), skipped under `?debug` **and `?bench`**; no new assets. The canonical track is a **~60 s
    real free-flight battle authored in-game via the `?dev` "Backdrop" panel** (Start/Stop-record + REC readout,
    or `window.__backdrop`) with live **Depth/Scale/Opacity/Anchor X/Anchor Z** sliders (persisted `ghostTune`)
    + a synthetic `bench/gen-backdrop.mjs` bootstrap. List the new files (`ghost-battle.js`,
    `ghost-battle-track.js`, `backdrop-battle.js`, `bench/gen-backdrop.mjs`) and the `?dev` panel.
  - Bump the top `**Updated:**` line (date + one-line lead summary), per the docs workflow.
- **`docs/CHANGELOG.md`:** add a bullet under today's date — **"Ambient ghost battle"** — a clearly visible
  ~60 s looping recorded skirmish shown in **every mission except the freighter escort**, at a fixed ABSOLUTE
  world point (default `(−100,−450)`, the freighter start) — a distant landmark the player flies toward that
  fades in through fog (player flies freely; up to 16 slots with per-slot birth/death so waves keep it
  populated; near-opaque below-plane decor at `y≈−60`), authored via a new `?dev` "Backdrop" panel
  (Start/Stop-record + REC readout + live Depth/Scale/Opacity/Anchor sliders) + synthetic bootstrap, tier-gated
  by a concurrent-visible ceiling / off on Performance, skipped under `?debug`+`?bench`, + the freighter
  `z +50` reposition.
- **`docs/DECISIONS.md`:** add **§59** (verify §58 is the last existing entry — it is). Title e.g.
  *"Ambient ghost battle = committed transform-replay of a REAL in-game recording, shown in all missions
  except the freighter escort, at a fixed ABSOLUTE world point (a distant landmark you fly toward),
  VISIBLE-distant (not faint)."* Record:
  - **Transform-replay, not a 2nd sim** — the world is module-level singletons; a concurrent `update()` would
    corrupt the live fight. The runtime just interpolates baked transforms.
  - **Authored by an in-game live recording** (a `?dev` `window.__backdrop` recorder captures a real played
    battle → downloads the committed track) — the maintainer wanted to conduct + watch *their* battle; a
    synthetic headless generator is kept only as a bootstrap/fallback. **The canonical track is a hand-flown
    recording, NOT re-generable byte-identically** — the committed JSON is the artifact.
  - **Births + deaths (per-slot), not a frozen cast** — the game spawns enemies in waves over a 60 s fight, so
    the recorder assigns a new slot (with a `birth` keyframe) to each enemy as it appears (up to 16 slots; no
    reuse) and the runtime shows a ghost only for `birth ≤ frame < deathOrEnd`. Without this a real recording
    decayed to a lone ship (the playtest failure). Keep it simple (§30): no slot reuse, no per-segment slots.
  - **Player flies FREELY; re-centered by ONE FIXED OFFSET (the mean of the player's path), not per-frame** —
    two earlier per-frame schemes were rejected in playtests: a live-cast **centroid** jerked the whole
    formation every time a ship was born/died; per-keyframe **slot-0** subtraction pinned the player at center
    (the maintainer wants the player moving naturally). Subtracting a single constant preserves the player's
    real free-flight motion and just centers the cloud near origin — no per-frame membership dependence, no
    jumps. (Each re-center scheme change forced a RE-RECORD; the fixed offset can't be recovered from an
    already-per-frame-re-centered track.)
  - **Shown in ALL missions EXCEPT the freighter escort (flipped), at a FIXED ABSOLUTE world point** —
    `(GHOST_TUNE.ax, y, az)`, default `(−100,−450)` (the freighter start; the same spot every mission), tunable
    via the `?dev` panel; NOT camera/player/freighter-following. **Deliberately off-screen from the mission
    center = a distant landmark you fly toward** — from the campaign center it's 461 u away, ~61% fogged, and
    fades in through `Fog(240,600)` as the player approaches. **Reachability was investigated (D5): it's
    reachable + fog-clear from WITHIN the arena bounds in every non-freighter mission** (e.g. campaign edge
    `(−100,−360)` → 90 u, 0% fog); the OOB warp-back (30 s continuous OOB) doesn't pen the player from seeing
    it. So the absolute placement is the maintainer's chosen, viable design — not the off-screen defect an
    earlier revision wrongly "fixed" with an offset anchor.
  - **VISIBLE-distant, reversing the initial "faint ambiance" guardrail** — a playtest showed opacity 0.35 ×
    darken 0.45 × scale 0.5 × `y −48` made the battle invisible (only the additive death-explosion showed).
    The design goal is now **a watchable distant battle**: near-opaque (`0.9`), full-color, moderate scale
    (`0.8`), depth `y −60`; the "distant/not-mine" read comes from **spatial separation** (a fixed world point
    off from the player's own fight) + depth, not dimming. `y −60 < 0.6` keeps it a separate, unshootable
    layer; ghost death rings are relocated off the combat plane.
  - **D1 trade-off** — move only the freighter render pos (`z −450→−400`), keep the mission center;
    balance-neutral, the freighter is non-collidable decor. (Now independent of the ghost battle.)
  - **Authoring UX = one `?dev` "Backdrop" panel** (lil-gui, mirrors `?tune`) — on-screen Start/Stop-record
    buttons + REC readout replace console calls as the primary trigger, and **live Depth/Scale/Opacity/Anchor
    X/Anchor Z sliders** (persisted `localStorage['ghostTune']`; defaults in `GHOST_TUNE_DEFAULTS`) let the
    maintainer dial look AND the absolute world placement during a real playtest instead of guessing constants
    (depth default `−60`; anchor default `(−100,−450)`, range ±600). Dev-only, zero cost when `?dev` is off; no
    player-facing surface.
  - **Record length 60 s + births** — a 60 s clip must stay populated as the game spawns enemies in waves, so
    slots carry `birth`/`death` and later waves join the cast (up to `MAX_GHOST_SHIPS = 16` slots; ~150–250 KB
    @ 20 fps / ≤24 bullets, still within budget). The tier caps **concurrent-visible** ghosts (High 8 /
    Balance 4), NOT "first N slots" (which would drop later-born waves).
  - **Tier + headless gating** — Performance off; runtime skipped under **`?debug` AND `?bench`** (both headless
    harnesses — the `?bench` skip avoids async-glb-load nondeterminism in `load.*` now that the feature is
    active in the benched campaign scenario; mirrors the nebula bake, §23/§43). The `?dev` recorder/panel is a
    separate flag and observes the live fight directly.

## Deploy / itch note

**No new assets and no changed model hashes** — ghost ships reuse `player_combat` + `enemy_1..4_combat`
glbs already bundled in the itch build; the freighter change is a position, not a `model_url`. So there is
**no itch-glb-404 risk** (the §37 hazard does not apply here). The feature is new **client code** (+ the
`backdrop-battle.js` data module), which `build:itch` bundles from source — so after the prod deploy, run
`/publish-itch` once so itch players receive the new client (this is to ship the new code, not to fix a hash
mismatch).

## Out of scope / non-goals (do not gold-plate — DECISIONS §30)

- **No** ghost battle on the freighter escort mission (it shows in ALL OTHER missions — the flipped gate).
- **No** recorded/procedural exhaust trails, muzzle flashes, or particle FX in the track (ships + bullets
  only; deaths reuse the existing explosion at runtime).
- **No** per-player runtime recordings — the recorder is an **authoring tool**; there is **one** canonical
  committed track all players see.
- **No** slot reuse and **no** per-segment slots — a dead slot is never re-assigned; a late enemy gets a fresh
  slot until the 16-slot cap is full, after which further enemies are ignored (§30).
- **No** player-facing settings toggle (tier gating handles perf).
- **No** camera/player/freighter-following — the anchor is a FIXED ABSOLUTE world point (default `(−100,−450)`,
  same every mission); the player ghost's motion comes from the recording, not live tracking.
- **Do NOT "fix" the off-screen-from-center placement** — being a distant, initially-fogged landmark you fly
  toward is the intended design (an earlier revision wrongly proposed an offset-from-center anchor; reversed).
- **No** separate render pass / separate scene (in-main-scene decor group, D2).
- **No** collision, targeting, HUD, markers, health bars, minimap dots, or audio for the ghosts.
- **No** change to the mission `center`, enemy spawns, drift, or balance (D1).
- **Do NOT over-dim it** (that was the playtest failure). The battle must be plainly visible — near-opaque,
  full-color, moderate scale, depth `y ≈ −60`. It reads as "distant/not mine" through spatial separation +
  depth, not faintness.
- **No** new visual-suite scenario (the runtime ghost battle is skipped under `?debug`; verify manually by
  playing a **non-freighter** mission on the High tier). **Acceptance criteria for the manual check:**
  1. **The battle is a VISIBLE DISTANT LANDMARK you fly toward** in a non-freighter mission (campaign works):
     from the mission center it's a far-off, fogged skirmish; as the player flies "north" toward `(−100,−450)`
     it **fades in through the fog** and becomes a clear, watchable battle by the northern arena edge (all
     in-bounds — no warp-back needed). Off-screen-from-center is EXPECTED, not a defect. (If the maintainer
     wants it elsewhere, nudge the absolute `Anchor X/Z` in the panel.)
  2. **The player ghost flies FREELY** — it is NOT pinned to the center of the cloud; it moves around like a
     real dogfight (this revision's key requirement).
  3. **No formation jump on births/deaths** — a fixed-offset re-center means a ship being born or dying no
     longer steps the anchor; confirm the formation does **not** jump sharply/downward when enemies appear or
     explode.
  4. **It STAYS POPULATED for the whole ~60 s loop** — it does not decay to a lone ship; later-recorded waves
     appear (births) so several ghosts fight throughout.
  5. **It fits on screen at the chosen scale** — the whole skirmish reads as one distant cluster, not sprawling
     past the screen edges; if it's too spread out, lower `scale` (or re-record a tighter fight). This is the
     manual constraint that replaced the tight automated bound.
  6. No HUD/markers/health-bars on any ghost; shooting toward it hits nothing (ghosts at `y≈−60 < 0.6` are a
     separate unshootable layer); a ghost death shows the real explosion **at the ghost's depth** (no ring on
     the combat plane); it reads as a *separate distant* battle, not the player's own fight.
  7. On the **freighter escort mission**, the ghost battle is **absent** (the flipped gate).
  8. **`?dev` authoring panel (manual):** the "Backdrop" panel shows under `?dev`; **Start recording** toggles
     to **Stop** with a live **`REC 12s/60s`** readout and auto-stops at 60 s, then downloads
     `backdrop-battle.js`; in a non-freighter mission the **Depth/Scale/Opacity/Anchor X/Anchor Z** sliders move
     the live ghost group (position, depth, scale, opacity) immediately and show their numeric values; on the
     freighter mission (or before any ghost group exists) the panel shows the "no ghost battle" status. The
     panel is absent without `?dev`.
- **No** crossfade at the loop seam (a fixed-offset track loops from its last pose back to its first; the small
  pop is acceptable — §30).
