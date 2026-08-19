# Heliocentric coordinate frame (star as origin) + per-object frame tags

**Status:** IMPLEMENTED (slices 1–3, 2026-08-18) on branch `feat/heliocentric-coordinate-frame` — pure
transform layer + `frame` tag + one demo `frame:"world"` object. See DECISIONS §115 / CHANGELOG 2026-08-18.
The multiplayer/zone machinery in §11 remains unbuilt by design.
**Goal owner:** maintainer (decisions below are already made — do not re-ask).

## 1. Goal

Move the game's *canonical* world frame so the **star is the coordinate origin** and the planets are
positioned around it, and introduce a per-object distinction:

- **planet-attached objects** (`frame: "planet:2"`) — authored relative to the base planet, ride its
  orbital motion. **Every object that exists today is this** (no coordinate rewrite).
- **space-fixed objects** (`frame: "world"`) — authored in absolute star-centered coordinates; the base
  planet drifts *past* them over time. These are **interactive** (the player can fly to / fight at them),
  not just backdrop.

This is primarily a **future-proofing / architecture** change, but the effect is *not* invisible: planet 2's
orbit is angularly slow (~0.17°/min) yet its **linear** speed at orbitR 10500 is ~**0.51 u/s**, so a
space-fixed object drifts ~**31 u/min** relative to the base — visible over minutes of roam, and it laps the
whole orbit every ~1.5 days. So "fixed in space" is a real, moving relationship, not a rounding-error nicety.
(Earlier drafts called this negligible — that was wrong; it confused angular with linear speed.)

## 2. The key insight (why this is smaller than it looks)

The heliocentric math **already exists**, just inverted. `bodyWorldPos` in
`client/src/system-map.js:96-104` computes the star's world position as `-orbitVec(planet2)` and places
every other body at `star + its own orbitVec`, *specifically so that planet 2 is always `(0,0)`* and the
whole base neighbourhood / mission set-pieces / `missions.js` centers stay origin-relative with **no
combat/mission rewrite** (see the module header `system-map.js:1-30` and DECISIONS §98).

So the current "planet 2 = origin" frame is *already a floating origin* — one whose working origin happens
to be frozen at planet 2. This plan makes the **canonical** frame star-centered while **keeping the runtime
working frame planet-2-local** (a moving floating origin). That means:

- The entire combat / mission / spawn / autopilot / §98 four-way-invariant / replay machinery stays
  **exactly as-is** — it keeps running in the planet-2-local frame, numerically unchanged.
- The only genuinely new things are: (a) a small pure transform layer `local ⇄ world`, and (b) a new
  object class (`frame: "world"`) whose *local* position is derived from that transform.

This reconciles "everything is in the star frame" (true — the canonical frame is star-centered, and the
base drifts within it) with numerical safety (combat never runs at ~10 500 u from origin; float precision
and the "combat happens near 0" assumptions are preserved).

## 3. Frames & the transform layer

Two frames:

- **World (canonical) frame** — origin at the **star**. `starWorldPos(name, t)` returns a body's position
  here. Space-fixed objects are authored here.
- **Local (runtime) frame** — origin at **planet 2's current world position** `P2(t)`. This is today's
  frame; all gameplay runs here. `P2(t) = orbitVec(planet2, t)` in the world frame.

Transform (all pure, `Date.now`-free). **Parameterise by an explicit origin point**, not by "planet 2" —
a "zone" is simply *an origin in the world frame*. Today there is exactly one origin (planet 2's base), but
keeping the origin a parameter costs nothing now and makes the model directly reusable for isolated combat
zones later (see §11) without a rewrite:

```
worldToLocal(pt, originWorld) = { x: pt.x - originWorld.x, z: pt.z - originWorld.z }
localToWorld(pt, originWorld) = { x: pt.x + originWorld.x, z: pt.z + originWorld.z }
```

Today the only origin passed is `P2(t)` (planet 2's world position). Do **not** build a `Zone` type or a
zone registry in this pass — the origin parameter is the whole generalisation; a real zone system is Phase-5
work and explicitly out of scope here.

A **planet-attached** object stores a local offset `off`; its world position is `localToWorld(off, P2(t))`, and
its runtime (renderable) position is simply `off` (unchanged from today). A **space-fixed** object stores a
world position `w`; its runtime position is `worldToLocal(w, P2(t))` — which **drifts** as `P2(t)` moves. That
drift is exactly the "planet floats past the fixed object" effect the maintainer wants; slow orbits make it
tiny per session but architecturally real.

### 3.1 Implementation in `client/src/system-map.js` (the pure core)

Add, without breaking existing exports (the map UI + tests consume them):

- `export function starWorldPos(name, t)` — the star-centered position of a body. Concretely: today's
  `bodyWorldPos` returns *local* (planet-2-pinned) positions; the star-frame version drops the
  `-orbitVec(planet2)` shift. Cleanest: introduce `orbitVec(spec, t)` (the `{x,z}` for a planet's own
  orbit) and express both:
  - `planetOriginOffset(t)` ≡ `P2(t)` ≡ `orbitVec(planet2, t)` — planet 2's position **in the star frame**.
  - `starWorldPos(name, t)`: star ⇒ `(0,0)`; planet ⇒ `orbitVec(planet, t)`.
  - Keep `bodyWorldPos(name, t)` returning **local** coords (subtract `planetOriginOffset(t)`) so every
    current caller (`listBodies`, `bodyRenderPos`, `planetAnchor`, `listSystemObjects`, `systemRadius`)
    is byte-for-byte unchanged. `bodyWorldPos(name,t) === worldToLocal(starWorldPos(name,t), t)`.
- `export function worldToLocal(pt, t)` / `export function localToWorld(pt, t)` as above.
- Keep the `EPOCH`, `bodyAngle`, `SYSTEM` machinery as the single source of the orbital geometry.

Note the existing safety export `maxBodyCoord()` (`system-map.js:175-177`) is the Float32 bound the test
asserts on **local** coords; space-fixed objects authored far out in the **world** frame need their own
bound check (they still render in local coords near the player, so this is about authoring sanity, not GPU
precision).

## 4. Determinism — the one hard constraint

`system-map.js` today "draws ZERO sim RNG and never runs inside the deterministic tick, so recorded replays
stay byte-identical" (`system-map.js:28-30`). Space-fixed **interactive** objects threaten this: their
*local* position depends on `P2(t)` which depends on wall-clock, and if the deterministic tick reads that,
replays desync (would break the `22-intro-replay` guard — see memory *sim-change-check-replay-intro*).

**Decision (made): snapshot `P2` at level/mission entry and hold it constant for the whole deterministic
fight.** Concretely:

- On entering a mission/level (fight start), compute `P2(tEntry)` once and store it on run state (e.g.
  alongside `runCenter` in `client/src/sim-core/level-sim.js` / wherever the run is seeded).
- Every space-fixed object's **local** position for that fight is `worldToLocal(w, tEntry)` — computed once,
  then **constant** during the tick. The deterministic sim therefore never reads wall-clock; replays stay
  byte-identical.
- During **free roam** (not the deterministic tick), space-fixed objects may update live against
  `Date.now()` (cosmetic, like the sky bodies already do in `updateSystemBodies`) — roam is not recorded
  frame-by-frame, so this is safe.
- Because orbits are slow, the intra-fight "freeze" is imperceptible; drift accumulates *between* fights
  (each level re-snapshots), which is the intended long-horizon behaviour.

This preserves DECISIONS §98 (nothing camera-anchored, nothing jumps) and the replay invariant. **Add a
DECISIONS entry** recording: canonical star frame + planet-2 floating origin + per-level `P2` snapshot, and
*why* (precision + replay determinism).

## 5. Data model — the `frame` tag

Give position-bearing authored objects an optional `frame` field, defaulting to `"planet:2"`:

- **Set-pieces** — `server/src/catalog_seed.js` `setpieces` array (`catalog_seed.js:796-865`). Each entry
  gets `frame: "planet:2"` implied by default; a space-fixed one is authored with `frame: "world"` and its
  `pos` interpreted in the star frame. The build path `buildSetPiece` (`world.js:1129-1144`) converts
  `frame:"world"` → local via `worldToLocal(pos, tEntry)` before placing; `frame:"planet:2"` places `pos`
  directly as today. (Note the existing `spec.sync`/`G.arenaDrift` follow-arenaCenter path at
  `world.js:1071` — keep it for planet-attached; it does not apply to world-fixed.)
- **Missions / fight centers** — `runCenter` (`client/src/sim-core/level-sim.js:26-30`) and the campaign/side
  `center` fields (`catalog_seed.js:590`, `:649`, etc.) stay `planet:2`. A future space-fixed mission would
  set `frame:"world"` on its center and be converted at entry (§4).
- **Anchors** (`system-map.js:182-208`, `ANCHORS`) — all stay `planet:2` (they *are* the base
  neighbourhood). The four-way invariant (`system-map.js:179-181`) is unaffected because it lives entirely
  in the local frame.
- **The `system` block** (`catalog_seed.js:736-774`, merged via `applySystemSpec`) is the orbital geometry
  itself — unchanged; it now feeds `starWorldPos` too.

No existing coordinate value changes. The migration is: **add the default tag, add the world-frame code
path, author new content with `frame:"world"`.**

## 6. Rendering

- Sky bodies (`updateSystemBodies`, `world.js:544-581`) already place each body at
  `bodyRenderPos(name, Date.now())` in absolute local coords — unchanged. If desired, they can switch to
  the same `starWorldPos → worldToLocal` path for clarity, but it is numerically identical, so **leave as
  is** in the first slice.
- The terminator light `aimSkySunAtStar` (`world.js:600-606`) reads the star's rendered position — still
  correct (star's local position = `worldToLocal(starWorldPos('star'))` = today's `bodyWorldPos('star')`).
- Space-fixed set-pieces render through the normal `buildSetPiece` path once converted to local (§5).

## 7. Suggested build order (slices)

1. **Pure transform layer + tests** — add `orbitVec`, `planetOriginOffset`/`P2`, `starWorldPos`,
   `worldToLocal`, `localToWorld` to `system-map.js`; assert round-trip
   `worldToLocal(starWorldPos(n,t),t) === bodyWorldPos(n,t)` and `localToWorld(worldToLocal(p,t),t)===p` in
   `client/src/system-map.test.js`. **No behaviour change** — pure addition. Run the node test + the
   `22-intro-replay` guard to prove replays untouched.
2. **`frame` tag plumbing** — default `"planet:2"` everywhere; `buildSetPiece` handles `frame:"world"` via
   `worldToLocal(pos, entrySnapshot)`; thread the per-level `P2(tEntry)` snapshot from run seeding into the
   set-piece build + any space-fixed spawn. Still no *content* change (nothing is `world` yet) ⇒ still a
   no-op at runtime; guard stays byte-identical.
3. **Proof-of-concept space-fixed object** — add ONE interactive `frame:"world"` set-piece (e.g. a derelict
   or beacon) authored in star coords, reachable/fightable, to exercise the whole path end-to-end. Live-test
   locally (`/run-local`). This is where the maintainer confirms feel.

Ship slices 1–2 first (safe, invisible); slice 3 is the first player-visible use and where design tuning
happens.

## 8. Blast radius / files to touch

- `client/src/system-map.js` — transform layer (`:85-104`, add near there), keep all existing exports.
- `client/src/system-map.test.js` — round-trip + snapshot-determinism assertions.
- `server/src/catalog_seed.js` — `setpieces` (`:796-865`) `frame` field; system block unchanged (`:736`).
- `client/src/world.js` — `buildSetPiece` (`:1129-1144`) world→local conversion; leave `updateSystemBodies`
  (`:544-581`) numerically as-is.
- `client/src/sim-core/level-sim.js` — `runCenter` (`:26-30`) + store the per-level `P2(tEntry)` snapshot on run
  state; feed it to set-piece build.
- `client/src/sim.js` — only if a space-fixed object needs a local-position refresh in roam (cosmetic).
- `client/src/state.js` — a field to hold the per-run `P2` snapshot if not already carried with `runCenter`.
- **Replay**: verify `22-intro-replay` stays byte-identical after each slice (`node visual/run.mjs
  22-intro-replay` — memory *sim-change-check-replay-intro*). If a *world*-frame object ever enters the
  recorded sim, the replay must also pin `tEntry` (snapshot makes this automatic since the fight reads a
  constant, not the clock).

## 9. Docs to update on implementation (per CLAUDE.md docs workflow)

- **SUMMARY.md** — the star-system section: describe the canonical star frame, the planet-2 floating origin,
  and the `frame: "planet:2" | "world"` object distinction with the per-level snapshot rule.
- **CHANGELOG.md** — bullet under the date: heliocentric canonical frame + space-fixed object support.
- **DECISIONS.md** — new numbered entry: *why* star-canonical-with-planet-2-floating-origin over both
  "keep planet-2 as canonical origin" and "run combat in raw star coords" — precision + replay determinism
  + slow orbits; and the per-level `P2` snapshot.

## 10. Open decisions — resolved inline (do not re-ask)

- **Does the base drift?** Yes — canonically it does (planet 2 moves in the star frame). Runtime uses a
  floating origin so combat stays near 0; the drift shows up as space-fixed objects moving relative to the
  base, per-level. (Maintainer chose "everything in the star frame".)
- **Orbit speed?** Keep slow (as today). Effect is future-proofing, not a per-session spectacle.
- **Are space-fixed objects interactive?** Yes — reachable/fightable; converted to local at fight entry.
- **Determinism?** Snapshot `P2` per level; deterministic tick never reads wall-clock (§4).
- **Re-author existing coordinates?** No. All current content stays `frame:"planet:2"` with its existing
  local coordinates; only new `frame:"world"` content is authored in star coords.

## 11. Multiplayer trajectory (CONTEXT ONLY — nothing here is built in this pass)

This coordinate change is deliberately shaped as **step 1** toward the roadmap's Phase-5 multiplayer
(ROADMAP §"Phase 5 — Multiplayer (FAR future, not soon)"). It is recorded here so the coordinate work does
not paint into a corner — **none of the multiplayer machinery below is implemented in this pass; this pass
touches coordinates only.**

How the two frames map onto the eventual architecture:

- **World frame (star-centered)** ⇒ the persistent, server-authoritative **overworld**: ships (players +
  bots) travelling between planets, objects around other planets. A real *simulation* of that overworld
  (traveling ships, bot AI, low-Hz server tick, WebSocket state sync) does **not exist today** — the
  system-map is a navigation/view layer only — and building it is the actual Phase-5 lift, separate from
  and after this change.
- **Zone-local frame** ⇒ an **isolated combat instance**, whose origin is the zone/fight center (exactly the
  maintainer's "center of coordinates for a fight = center of that zone"). The planet-2 base is simply
  today's single always-on zone; each future fight is a zone that passes its own origin to the same pure
  transforms (§3).

Why this is safe to build now under the "keep it simple / don't pre-build for scale" ethos (DECISIONS §30):

- **Authority-agnostic.** The transform math is identical whether the client (today) or the server (Phase 5)
  owns the sim. This change does not commit us to client-vs-server authority.
- **Zero speculative infrastructure.** The only generalisation taken now is making the transform origin a
  *parameter* instead of hardcoding planet 2 (§3). No `Zone` type, no registry, no networking, no server
  sim — those arrive with Phase 5, not here.
- **Prereq alignment.** Phase 5's stated prerequisite is decoupling the sim from rendering; this change keeps
  the pure position math in the already-decoupled, node-testable `system-map.js`, reinforcing that seam.
