# Fix: enemy bullets pass through the player and deal no damage

**Feature ID:** 2026-07-16-1409-fix-player-damage-import
**Type:** Bug fix (with a pure-seam extraction so a regression test can guard it)

## Goal

On vega.tenony.com and locally, enemy bullets fly straight through the player, deal **no** damage, and the
frame visibly stutters at the instant a shot should connect. Root cause: `applyPlayerDamage` is **called** in
the enemy-bullet→player collision branch of `sim.js` but is **not imported** in that module. It was moved
from `projectiles.js` to `components.js` in commit `51eec94` ("shield-hit ripple FX"); that commit fixed
`projectiles.js`'s own import but left `sim.js` referencing a now-out-of-scope symbol. Every time a hostile
bullet's swept segment intersects the player, `sim.update()` throws a `ReferenceError`: (1) the rest of that
frame's `update()` aborts → the visible stutter; (2) execution never reaches the `bullets.splice(i, 1)` cull
below, so the bullet is not removed and keeps flying "through" the player, dealing no damage. Player→enemy
bullets and rocket-blast damage are unaffected because those paths import `applyPlayerDamage` correctly.

The user-visible effect after the fix: enemy fire again damages the player (shield-first, then hull), the
offending bullet is consumed on impact (with the cyan shield ripple / hit flash), and the per-frame stutter
is gone.

## Decisions (baked in — do not re-ask)

1. **Fix via a pure-seam extraction, not a bare one-line import.** Extract the hostile-bullet→player
   hit-resolution *decision* into a pure, THREE-free helper so a `node --test` unit test can drive it (per
   the bugfix-needs-regression-test rule: a DOM/engine-bound path gets a testable seam, not an "untestable"
   excuse). `sim.js` cannot be imported under `node --test`: it imports `engine.js`, which at module-eval
   does `new THREE.WebGLRenderer(...)` (`engine.js:33`) and `document.body.appendChild(...)` (`engine.js:48`)
   — there is no DOM and no `three` install in the headless runner. `components.js` and `collision.js` are
   deliberately THREE-free (see the header comments and DECISIONS §45), which is why `components.test.js` /
   `collision.test.js` can already exercise them headlessly. The extraction both **removes the bug class**
   (no free `applyPlayerDamage` symbol left in `sim.js`) and **gives a real behavior guard**.

2. **Helper lives in `client/src/collision.js`.** It needs `segmentHitsShip` (already in `collision.js`) plus
   `applyPlayerDamage` (in `components.js`). Placing it in `collision.js` means `collision.js` imports
   `components.js`. **No circular import:** `components.js` imports nothing (it is pure derivation), so
   `collision.js → components.js` is a clean one-way edge; nothing imports `collision.js` from inside
   `components.js`. (The reverse — putting it in `components.js` and importing `collision.js` — would also
   avoid a cycle, but `collision.js` already owns the hit-test concept, so the resolution belongs next to it.)

3. **Helper is side-effect-free and RNG-free.** It only reads the segment geometry and mutates the passed-in
   `player` via `applyPlayerDamage` (which itself only mutates `player.hp` / `player._shieldValue` /
   `player._shieldRechargeAccum`). It must **not** touch `scene`, `audio`, any FX spawner, or the seeded sim
   RNG — so record/playback determinism (the `?record`/`?playback` replay path) is preserved. All scene/audio/FX
   and range-culling stay **inline in `sim.update()`**.

4. **Helper scope = the hostile (enemy→player) side only.** The player→enemy branch (`sim.js:527-533`) and
   the rocket-blast branch (`projectiles.js:305`) are **not** rewired and **not** in scope:
   - Player→enemy: uses `segmentHitsShip` (imported at `sim.js:20`) + `e.hp -= b.damage`; enemies have **no**
     shield routing, and there is no missing import — it is already correct. Extracting it "for symmetry"
     would be gold-plating (DECISIONS §30).
   - Rocket blast: `projectiles.js:305` calls `applyPlayerDamage`, correctly imported at `projectiles.js:10`.
     No bug.
   The helper is named `resolveHostileBulletHit` precisely because it guards the one path that was broken.

5. **Range culling stays in `sim.js`.** The helper returns only the hit + damage decision; the
   `hit || b.traveled >= b.maxRange` cull and the `scene.remove` / `material.dispose` / `bullets.splice`
   remain in the loop. The helper's `remove` field reflects "this hit consumes the bullet" (true on any
   hostile hit); it is intentionally redundant with `hit` today but documents the removal semantics and is
   what the regression test asserts.

## Steps

### Step 1 — Add the pure helper to `client/src/collision.js`

At the top of `client/src/collision.js`, add the import (the file currently has no imports):

```js
import { applyPlayerDamage } from './components.js';
```

Append the helper at the end of the file (after `segmentHitsShip`):

```js
// Resolve a hostile (enemy) bullet against the player for a single frame: swept-test the bullet's movement
// segment [p0→p1] against the player hull and, on a connect, route the damage through the shield-then-hull
// path (applyPlayerDamage). Deliberately side-effect-free, RNG-free and THREE-free — it mutates ONLY the
// passed-in `player` and never touches scene/audio/FX or the seeded sim RNG — so it is unit-testable under
// `node --test` and record/playback stays deterministic. The caller (sim.update) owns the scene.remove /
// hit-flash / shield-ripple / SFX and the range-based bullet culling. Returns:
//   { hit, damageResult, remove }
//   hit          — the segment connected with the player hull
//   damageResult — the { absorbed, broke } contract from applyPlayerDamage (null when no hit), so the caller
//                  can spawn the cyan shield ripple at the impact point
//   remove       — whether this hit consumes the bullet (true on any hit; range culling stays in sim.update)
export function resolveHostileBulletHit(player, p0, p1, damage) {
  if (!segmentHitsShip(player, p0, p1)) return { hit: false, damageResult: null, remove: false };
  const damageResult = applyPlayerDamage(player, damage);
  return { hit: true, damageResult, remove: true };
}
```

### Step 2 — Wire it into `client/src/sim.js`

- **Import.** At `sim.js:20`, extend the `collision.js` import:
  ```js
  import { pointHitsShip, segmentHitsShip, resolveHostileBulletHit } from './collision.js';
  ```
  Do **not** add `applyPlayerDamage` to the `components.js` import at `sim.js:11` — after this change `sim.js`
  no longer references `applyPlayerDamage` directly (the extraction subsumes the one-line fix). Leave
  `sim.js:11` as `import { repairTick, shieldRecharge } from './components.js';`.

- **Replace the hostile branch** (the `else` block currently at `sim.js:532-538`). Old:
  ```js
    } else {
      if (segmentHitsShip(G.player, _bulletP0, b.mesh.position)) {
        const dr = applyPlayerDamage(G.player, b.damage); hit = true;
        if (dr.absorbed) spawnShieldHit(b.mesh.position, dr.broke); // cyan ripple where the shot connects with the shield
        audio.sfx.hit(sfxFor('ship', G.player.class, 'hit')); // sampled impact when OUR ship is struck
      }
    }
  ```
  New:
  ```js
    } else {
      const res = resolveHostileBulletHit(G.player, _bulletP0, b.mesh.position, b.damage);
      if (res.hit) {
        hit = true;
        if (res.damageResult.absorbed) spawnShieldHit(b.mesh.position, res.damageResult.broke); // cyan ripple where the shot connects with the shield
        audio.sfx.hit(sfxFor('ship', G.player.class, 'hit')); // sampled impact when OUR ship is struck
      }
    }
  ```
  Leave the player→enemy branch, the rocket-interception block, and the `hit || b.traveled >= b.maxRange`
  cull exactly as they are.

### Step 3 — Prove no free symbol remains in `sim.js`

Run, from the worktree root, and confirm **zero** output (no remaining direct reference):

```
grep -n "applyPlayerDamage" client/src/sim.js
```

This is the gate for the original bug class: `sim.js` must not name `applyPlayerDamage` at all after the
extraction.

### Step 4 — Regression test (new cases in `client/src/collision.test.js`)

Add to `client/src/collision.test.js`. Extend the existing import line to include the helper:

```js
import { pointHitsShip, broadRadius, segmentHitsShip, resolveHostileBulletHit } from './collision.js';
```

Use the file's existing `mesh()` stub / `V()` helper. A primitive player (`hitBoxes: null` → the broad sphere
*is* the hitbox, radius `2.6 × sizeScale`) is the simplest fixture. Add:

```js
// --- resolveHostileBulletHit: the enemy-bullet → player damage+cull path (regression for the missing
// applyPlayerDamage import in sim.js, commit 51eec94). ---
const hostilePlayer = (over = {}) => ({
  mesh: mesh(0, 0, 0), sizeScale: 1, hitBoxes: null, broadR: null,
  hp: 100, shield: false, _shieldValue: 0, _shieldRechargeAccum: 0, ...over,
});

test('resolveHostileBulletHit: a swept segment through the hull damages the hull and consumes the bullet', () => {
  const p = hostilePlayer();                       // no shield → full damage to hull
  const r = resolveHostileBulletHit(p, V(-3, 0, 0), V(3, 0, 0), 12); // segment crosses the origin sphere
  assert.equal(r.hit, true);
  assert.equal(r.remove, true);                    // bullet is consumed (would reach sim's splice)
  assert.equal(p.hp, 88);                          // 100 − 12, routed by applyPlayerDamage
  assert.deepEqual(r.damageResult, { absorbed: false, broke: false });
});

test('resolveHostileBulletHit: with a shield, damage is absorbed shield-first (ripple contract)', () => {
  const p = hostilePlayer({ shield: true, _shieldValue: 20 });
  const r = resolveHostileBulletHit(p, V(-3, 0, 0), V(3, 0, 0), 5);
  assert.equal(r.hit, true);
  assert.equal(p._shieldValue, 15);                // absorbed by the shield
  assert.equal(p.hp, 100);                          // hull untouched
  assert.deepEqual(r.damageResult, { absorbed: true, broke: false });
});

test('resolveHostileBulletHit: a segment that misses the hull does nothing and does not consume the bullet', () => {
  const p = hostilePlayer();
  const r = resolveHostileBulletHit(p, V(-3, 5, 0), V(3, 5, 0), 12); // 5 units off-plane → outside the 2.6 sphere
  assert.equal(r.hit, false);
  assert.equal(r.remove, false);
  assert.equal(p.hp, 100);
  assert.equal(r.damageResult, null);
});
```

Why this fails against the current (bug) code: the helper does not exist yet, and the current `sim.js` never
routes damage on a hostile hit (the `ReferenceError` aborts before `hp` changes and before the bullet is
culled). The `hp === 88` + `remove === true` assertions encode exactly the two symptoms the bug caused
(no damage, bullet not removed). If `applyPlayerDamage` were unwired/mis-imported in the helper, the first two
tests would throw / leave `hp` at 100 and fail.

### Step 5 — Run the tests

```
cd client && node --test
```

All of `collision.test.js` and `components.test.js` must pass (the client visual suite is out of scope; note
the known-flaky baseline of ~6 visual scenarios — not relevant to this unit-level fix).

## Intro-replay impact (verified — the fix is safe for the new-player intro cutscene)

The Level-0 intro cutscene is **not** a movie: it re-runs the REAL `sim.update()` from a recorded seed +
per-tick input (`client/src/replay.js` header; `main.js` playback loop ~600-620). So the hostile-bullet→player
branch this fix changes **does execute during the intro**, and there is **no invincibility mode** for the
player-damage path — `G.replayMode` only suppresses progress-advance / credit-banking, not collisions
(`main.js:62`). Restoring the damage path therefore does change the intro from "player takes zero damage"
(the current broken state) back to "player takes real hits". Divergence risk to rule out: the player must not
die or desync mid-intro, or the scripted ending breaks (the re-sim must reach victory → `finishIntro()`
advances progress 1→2 → Level 1 briefing; `main.js:1051,1127`).

**Timeline (verified via git) — the trace was authored under WORKING player-damage and NO shield:**
- Canonical intro trace `assets/recordings/level0-intro.a39d1f46.json` was recorded **2026-07-10** (commit
  `2ebb11c`) and has **never been re-recorded** (the hash is unchanged in `catalog_seed.js:402`).
- The **shield** component landed **2026-07-11** (`c29040a`) — *after* the recording.
- The **import break** landed **2026-07-13** (`51eec94`) — *after* the recording.

At record time (07-10), `applyPlayerDamage` lived in `projectiles.js` and `sim.js` imported it correctly, so
the player took **real hull damage** during the recorded fight, **and still reached victory** (the trace ends
in a win). Playback pins the **record-time** ship/loadout/components (`replay.js` `makeTrace`; `main.js:951`
"Force the recorded ship+loadout"), and no shield existed on 07-10, so the replayed intro ship has **no
shield** and takes raw hull damage — exactly the condition the run was authored under.

**Conclusion: safe.** This fix *restores* the damage conditions the intro was recorded under; it does not
introduce new ones. Because the same seed + same input + same pinned ship + same damage path deterministically
reproduce the recorded winning run, the player survives and the ending is intact. The 07-13→now window in
which the intro played with an invincible player was itself a side effect of this very bug (unintended free
protection); the fix returns the intro to its authored behavior. Since the intro ship has **no shield**, the
visible change during the intro is enemy bullets now **connecting** (hull hit-flash + hp loss) instead of
tunneling through — **not** a shield ripple. No safeguard/code change to the intro is needed. Residual risk is
limited to some *other* balance change since 07-10 raising incoming damage enough to kill the recorded run;
none was found, but the Stage-9 live-test below confirms end-to-end regardless.

## Tests

- **New:** three cases in `client/src/collision.test.js` covering the hostile-bullet→player helper (hull
  damage + cull, shield-first absorb, clean miss). Run with `cd client && node --test`.
- No server tests are affected (this is client-only). Do not run `server && npm test` for this change.

## Docs to update

- **`docs/CHANGELOG.md`** — under today's date (`## 2026-07-16`, create if missing), add a bullet:
  **"Fix: enemy bullets dealt no damage and stuttered the frame"** — `applyPlayerDamage` was called but not
  imported in `sim.js` after the shield-ripple refactor (commit 51eec94), throwing a `ReferenceError` that
  aborted the frame and left the bullet uncorrected; extracted the enemy-bullet→player hit-resolution into a
  pure, THREE-free `resolveHostileBulletHit` helper in `collision.js` (unit-tested) and wired `sim.js` to it.
- **`docs/SUMMARY.md`** — in the collision/damage section (the paragraph describing the swept
  bullet-vs-hull test and shield-first player damage), note that the hostile-bullet→player hit resolution now
  goes through `resolveHostileBulletHit` in `collision.js` (pure, THREE-free, unit-tested); FX/audio/culling
  stay in `sim.update()`. Bump the `**Updated:**` date. Keep it to the one or two sentences that changed —
  the collision model itself is unchanged.
- **`docs/DECISIONS.md`** — **no new entry required.** The seam is a small, obvious testability extraction
  covered by the existing DECISIONS §45 (keep combat-math modules THREE-free so they're `node --test`-able)
  and the bugfix-regression rule; it is not a new trade-off. (If you disagree and add one, keep it to a
  single line cross-referencing §45.)

## Stage-9 live-test (after deploy — manual, in the browser)

1. **Combat damage restored:** start any live level, let an enemy fire at you, and confirm enemy bullets now
   **connect** — hp drops (and the cyan shield ripple shows if your ship carries a shield) — with **no**
   per-frame stutter at the moment of impact. Before the fix, bullets passed through and the frame hitched.
2. **Intro cutscene intact:** reset progress (so the server serves the `introTrace`), reload as a new player,
   and watch the Level-0 intro cutscene **end-to-end**. Confirm it still (a) reaches victory, (b) advances
   progress 1→2, and (c) lands on the **Level 1 briefing** — and that during the intro enemy bullets now
   visibly **connect with the player** (hull hit-flash / hp loss) instead of passing through. The intro ship
   has no shield, so expect hull hits, not a shield ripple.

## Out of scope / non-goals (DECISIONS §30)

- Do **not** rewire or "symmetrize" the player→enemy bullet branch or the rocket-blast branch — both are
  already correctly wired and the enemy side has no shield routing to share.
- Do **not** make `engine.js`/`sim.js` headless-importable or add jsdom — the pure seam is the whole point;
  do not try to drive `sim.update()` in a test.
- Do **not** change collision geometry, damage numbers, shield behavior, FX, audio, or the bullet range-cull.
- Do **not** add a `remove`-based early cull or otherwise move range culling into the helper.
- No new npm deps, no server changes, no catalog/model/asset changes (so no `publish-itch` step needed).
