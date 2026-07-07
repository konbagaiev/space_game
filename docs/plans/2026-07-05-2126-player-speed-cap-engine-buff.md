# Player speed cap + engine buff + opening-combat feel

**Feature ID:** 2026-07-05-2126-player-speed-cap-engine-buff
**Status:** ready to implement
**Area:** client movement/sim + server catalog seed (balance)

## Goal

Four small, correlated balance/feel changes to the opening and pacing of combat:

1. **Give the player a flat top speed of 30 world units/s.** Today the player has *no* speed cap
   ("pure inertia: no friction, no speed limit", `client/src/sim.js`) — velocity grows unbounded with
   thrust. A single flat cap makes the ship's handling predictable and bounds the arena traversal time.
2. **Buff every engine component's acceleration by +50%** (the `power` stat → derived acceleration), so
   ships (player *and* engine-sharing enemies) reach their top speed faster. Thrusters (turn) are
   untouched; engine `maxSpeed` values are untouched.
3. **A 5-second "hold fire" grace at the start of each run** during which enemies still spawn, move and
   aim but do **not** shoot — a soft on-ramp so the player isn't taking fire the instant a run begins.
4. **Open each run already gliding:** the player ship begins combat moving forward at 10 % of top speed
   (= 3 u/s) along its initial heading, instead of dead-stopped.

User-visible effect: the ship snaps up to a firm 30 u/s ceiling, accelerates noticeably harder, starts
each fight drifting gently forward, and gets a 5-second breather before enemies open up.

## Decisions (all resolved — do not re-ask)

- **Player cap is a single flat constant (`PLAYER_MAX_SPEED = 30`), not a per-engine `maxSpeed`.** The
  player's engines (Basic id 5) carry `maxSpeed: 0` today; rather than repurpose the engine stat, the cap
  is a movement-system constant applied to the player only. **Enemies keep their existing per-engine
  `maxSpeed` clamp** (`sim.js` enemy loop, `e.engine.maxSpeed`) — do NOT touch enemy caps.
- **Grace timer basis = accumulated sim `dt`, NOT wall clock.** Add `G.combatElapsed`, advanced by `dt`
  inside `update(dt)` (which is *skipped entirely while paused* — `G.paused` freezes the sim). So pausing
  during the opening does **not** consume the grace. Do **not** reuse `G.gameStartTime`
  (`performance.now()`, wall-clock) for this.
- **Grace is SILENT.** No HUD element, no countdown, no banner. Enemies visibly close in and aim but hold
  fire. (DECISIONS §30 — don't gold-plate.)
- **Opening glide = `PLAYER_MAX_SPEED * 0.1` = 3 u/s** along heading 0. Heading 0 → `forwardVec(0) =
  (sin0, 0, cos0) = (0,0,1)` = **+Z** (convention noted in `client/src/main.js:139`), so the initial
  velocity is `(0, 0, 3)`.
- **Engine `power` rounding (given):** id5 10→**15**, id6 12.6→**19**, id7 19→**29** (28.5→29),
  id15 14→**21**, id16 18→**27**, id23 12.6→**19**, id26 30→**45**. Only `power` changes; `maxSpeed`,
  `exhaust`, `weight`, `price` unchanged. Thrusters untouched.

---

## Steps

### 1) `PLAYER_MAX_SPEED` constant + velocity clamp (`client/src/sim.js`)

**1a. Declare the constant** in the movement-constants block. It currently reads (around
`client/src/sim.js:318-319`):

```js
const DRAG = 1.8;        // friction (enemies)
const IDLE_DRAG = 0.8;   // soft braking for the player when controls are released
```

Add directly beneath:

```js
// Flat top speed for the PLAYER only (world units/s). Enemies use their per-engine `maxSpeed` instead.
// Applied after thrust, before position integration, on BOTH the manual and autopilot paths.
export const PLAYER_MAX_SPEED = 30;
```

(Export it so the opening-glide code and any test can reference the single source of truth.)

**1b. Clamp the player's velocity** after the thrust/autopilot branch converges and *before* position
integration. Both control paths (`if (G.autopilot.active) { autopilotControl(...) } else { ...manual
thrust... }`) have written `G.player.vel` by the time control reaches the "pure inertia" comment at
`client/src/sim.js:389-391`:

```js
  // pure inertia: no friction, no speed limit - the ship
  // keeps flying in its current direction, no matter where the nose points
  G.player.mesh.position.addScaledVector(G.player.vel, dt);
```

Change it to clamp first, and fix the now-stale comment:

```js
  // Flat top speed: pure inertia, but the player never exceeds PLAYER_MAX_SPEED (manual + autopilot alike).
  if (G.player.vel.length() > PLAYER_MAX_SPEED) G.player.vel.setLength(PLAYER_MAX_SPEED);
  // the ship keeps flying in its current direction, no matter where the nose points
  G.player.mesh.position.addScaledVector(G.player.vel, dt);
```

Because the clamp sits after `autopilotControl(dt, accel, turn)`, the autopilot path is capped too.

**Known cosmetic wrinkle (leave as-is, do not "fix"):** with a flat player cap, the per-engine `maxSpeed`
shop stat (Ion 14, Solid-fuel 12, Basic 0, etc.) is now *decorative for the player* — every player engine
tops out at the same flat 30, which no shop/HUD surface displays. This is **pre-existing** (the player was
uncapped before, so `maxSpeed` was already meaningless for them) and **not** part of this request. Flagged
here only so the reviewer/live-test isn't surprised that swapping player engines changes acceleration but
not top speed. No shop-copy change in scope.

**Autopilot stop-distance math stays correct — no change to `autopilotControl`.** The kinematic brake at
`client/src/sim.js:236` uses `stopDist = (speed*speed)/(2*accel)` computed from the *current* (now
≤ 30) speed, then brakes by `accel`. With the buffed player engine `accel ≈ 15` and capped `speed ≤ 30`,
worst-case `stopDist ≈ 900/30 = 30` u — well within arena scale; the ship still coasts to a stop next to
the station. The cap only *lowers* the speed the brake must plan for, so the existing math remains valid.

### 2) Buff engine `power` by +50 % (`server/src/catalog_seed.js`)

Edit **only** the `power` field of each engine component and any comment citing the old value. Exact
current lines (from `server/src/catalog_seed.js`):

- **id 5 — line 26** `{ id: 5, name: 'Basic engine', ... stats: { power: 10, maxSpeed: 0, ... } }`
  → `power: 15`.
- **id 6 — line 27** `Scout engine ... power: 12.6 ...` → `power: 19`.
- **id 7 — line 28** `Boss engine ... power: 19 ...` → `power: 29`.
- **id 15 — line 45** `Solid-fuel engine ... power: 14 ...` → `power: 21`.
- **id 16 — line 46** `Ion engine ... power: 18 ...` → `power: 27`.
- **id 23 — line 57** `Pirate engine ... power: 12.6 ...` → `power: 19`. The trailing comment
  `// maxSpeed 10.5 × 1.5; same accel as Scout; enemy gear: resale-only` still reads true ("same accel as
  Scout" — both are now 19); leave that clause but it stays consistent.
- **id 26 — line 65** `Second-boss engine ... power: 30 ...` → `power: 45`.

**Only `power` changes.** Leave `maxSpeed`, `exhaust`, `weight`, `price`, `buyable` exactly as-is. Update
any inline comment that *names* the old power number (e.g. if a comment says "power 14"). Seeds upsert on
server restart (`ON CONFLICT DO UPDATE`), so no migration is needed.

**No `db.js` / `db_postgres.js` edit required.** Both backends seed from the shared
`server/src/catalog_seed.js`; editing it there keeps SQLite and Postgres in sync automatically.

### 3) 5-second enemy "hold fire" grace (`client/src/state.js` + `client/src/sim.js`)

**3a. Declare the accumulator** in `client/src/state.js`. Next to the run-lifecycle timing field
(`gameStartTime: performance.now(),` at `client/src/state.js:46`) add:

```js
  combatElapsed: 0,           // seconds of UNPAUSED combat since run start; gates the enemy hold-fire grace (see sim.js)
```

**3b. Advance it each unpaused sim frame.** `update(dt)` begins at `client/src/sim.js:341` with an early
return (`if (!G.gameStarted || !G.player.alive || levelRunner.won) return;`). Immediately after that
guard, add:

```js
  G.combatElapsed += dt; // unpaused combat clock (update() is skipped while paused) — drives the enemy hold-fire grace
```

Placement after the guard means it only accrues during a live, unpaused fight — pause, death, victory and
the welcome screen never advance it.

**3c. Reset it at run start.** In the spawn/take-off block, next to
`G.gameStartTime = performance.now();` (`client/src/sim.js:828`), add:

```js
  G.combatElapsed = 0;  // fresh run: restart the enemy hold-fire grace clock
```

**3d. Gate enemy firing.** Add a named grace constant beside `PLAYER_MAX_SPEED` (step 1a):

```js
const ENEMY_FIRE_GRACE = 5; // seconds at run start during which enemies move/aim but hold fire
```

Then extend the enemy fire predicate at `client/src/sim.js:471`:

```js
    // fire each group whose AI rule (range + aim tolerance) is satisfied
    updateGroups(e, ef, false, dt, (g) => g.ai && dist < g.ai.range && Math.abs(diff) < g.ai.aimTol);
```

to also require the grace to have elapsed:

```js
    // fire each group whose AI rule (range + aim tolerance) is satisfied — and only after the opening grace
    updateGroups(e, ef, false, dt,
      (g) => G.combatElapsed >= ENEMY_FIRE_GRACE && g.ai && dist < g.ai.range && Math.abs(diff) < g.ai.aimTol);
```

This suppresses **all** enemy weapon groups (bullets and rockets) for the first 5 s. Enemy movement,
turning and aiming above this line are untouched, so they still visibly close in.

### 4) Opening forward glide (`client/src/sim.js`)

In the spawn block the player is currently zeroed and pointed forward
(`client/src/sim.js:818-819`):

```js
  G.player.vel.set(0, 0, 0);
  G.player.heading = 0;
```

Replace with (set heading first so the intent is explicit; heading 0 → forward +Z):

```js
  G.player.heading = 0;                                  // forward = +Z (forwardVec(0) = (0,0,1))
  G.player.vel.set(0, 0, PLAYER_MAX_SPEED * 0.1);        // open the fight already gliding forward at 10% of top speed (3 u/s)
```

Uses the same `PLAYER_MAX_SPEED` constant so the "10 %" stays correct if the cap ever changes.

**Note — the glide is momentary, by design.** If the player holds no control, the 3 u/s bleeds off via
`IDLE_DRAG` within ~1-2 s (the standard passive braking). The requirement is "starts the fight already
moving forward," i.e. non-zero velocity **at spawn / the first frames**, not a sustained cruise. Do not add
any mechanism to *sustain* the drift — that would fight `IDLE_DRAG` and is out of scope.

---

## Tests

Run both suites (server tests exercise **both** backends):

```
cd client && npm test
cd server && npm test          # SQLite
cd server && npm run test:pg   # Postgres — same catalog_seed, must also pass
```

**Existing tests that MUST be updated (they assert the pre-buff numbers):**

- **`server/src/server.test.js:376`** — `assert.equal(scout.stats.power, 12.6);` → **`19`**. (This is the
  only engine `power` the server suite pins. Line 421's `basic.stats.power, 10` is the *Basic kinetic
  weapon*, not the engine — leave it. No other engine `power`/`maxSpeed` is asserted.)
- **`client/src/components.test.js`** — the synthetic fixtures are explicitly labelled "mirroring the DB
  seed", so keep the mirror faithful:
  - line 13 `basic: { weight: 10, power: 10 }` → `power: 15`.
  - line 14 `scout: { weight: 6, power: 12.6 }` → `power: 19`.
  - line 45 `assert.equal(s.acceleration, 10);  // engine.power, massFactor = 1` → **`15`** (playerShip
    uses the basic engine at reference mass). Update the comment's number too.
  - line 68 `assert.ok(light.acceleration > ENGINE.scout.power);` needs **no** change — it's relative and
    holds for any positive `scout.power`.

**New coverage (keep it minimal — DECISIONS §30):**

- The sim behaviours (velocity clamp, opening glide, hold-fire grace) live inside `update(dt)`, which
  pulls in THREE + DOM globals and is not unit-testable without heavy mocking; do **not** add a brittle
  fake-DOM harness for them. Instead:
  - **Optional visual assertion** in `client/visual/` (Playwright, not in CI): the existing combat/
    arena boot exposes `window.__game`. If adding a scenario, assert `|G.player.vel| <= 30` after
    sustained thrust and that no enemy bullet spawns before `G.combatElapsed >= 5`. This is *optional*
    — the catalog buff is fully covered by the two unit-test edits above, and the three sim changes are
    each a one-line, self-evident clamp/assignment/predicate.
  - **Manual smoke** (record in the PR/live-test): thrust to top speed and confirm the HUD-independent
    ceiling holds at ~30; start a run and confirm the ship is **already drifting forward at spawn (the
    first frames)** — assert the drift *at spawn*, NOT persistently, since it bleeds off via `IDLE_DRAG`
    within ~1-2 s if no control is held; and confirm enemies hold fire for ~5 s, then open up.

Confirm the full client suite (`client && npm test`) and both server runs are green after the fixture
edits.

---

## Docs to update

- **`docs/SUMMARY.md`:**
  - **Controls / Gameplay (movement, ~lines 116-135 and the "Inertial physics" bullet at ~528):** note
    the player now has a **flat top speed of 30 u/s**, each run **opens already gliding forward at 3 u/s
    (10 % of top speed)**, and **enemies hold fire for the first 5 s of a run** (they still spawn/move/aim).
  - **Ship model → drive model (~lines 337-339):** the derived-accel example "keeps the player at accel
    10 / turn 2.0" → **accel 15** (Basic engine `power` 15 at reference mass); turn 2.0 unchanged. Do not
    confuse this with the "engine 10" *weight* term in the `REFERENCE_MASS` breakdown — that's the Basic
    engine's `weight`, which is unchanged.
  - **Ship model → shop ladder (~lines 316-317):** "Solid-fuel engine (id 15: power **21** / 1400)" and
    "Ion engine (id 16: power **27**, light / 6400)".
  - Bump the `**Updated:**` date.
- **`docs/CHANGELOG.md`:** add one bullet under today's date (`## 2026-07-05`), e.g.:
  **"Combat pacing + engine buff"** — flat player top speed 30 u/s; all engine `power` (acceleration)
  +50 % (Basic 10→15, Scout 12.6→19, Boss 19→29, Solid-fuel 14→21, Ion 18→27, Pirate 12.6→19,
  Second-boss 30→45; thrusters untouched); enemies hold fire for the first 5 s of each run
  (`G.combatElapsed` gate); the player now opens each run gliding forward at 3 u/s (10 % of top speed).
- **`docs/DECISIONS.md` — TWO edits (a flat cap directly contradicts §2, which must be reconciled, not
  just supplemented):**
  1. **Amend §2 in place.** §2 ("Ship controls and physics (inertia)") currently states at
     `docs/DECISIONS.md:28`: "**Pure inertia:** no friction, no speed limit while thrusting — we fly along
     the accumulated vector...". Do **not** delete §2. Following the existing amendment style (§2 already
     ends with an "**Amendment (§39, 2026-07-03):**" note at `docs/DECISIONS.md:45`), append a second
     amendment note at the end of §2, immediately after the §39 amendment block:

     ```
     **Amendment (§51, 2026-07-05):** the "no speed limit" clause above is now narrowed for the PLAYER
     only — player velocity is capped at a flat `PLAYER_MAX_SPEED = 30` u/s (a movement-system constant,
     not a per-engine stat). §2's inertia otherwise still holds: no friction while thrusting, passive
     `IDLE_DRAG` braking on release, and free drift. **Enemies are unchanged** — they still clamp to their
     per-engine `maxSpeed`. See §51.
     ```

     This keeps §2 authoritative for "no friction / inertial drift" while removing the now-false
     "no speed limit" absolute for the player.
  2. **Add the new numbered entry `## 51.`** at the end of `docs/DECISIONS.md` (after §50). It records the
     real trade-offs and explicitly supersedes §2's no-speed-limit clause for the player. Cover:
     **flat `PLAYER_MAX_SPEED = 30` for the player vs. per-engine `maxSpeed` for enemies** (predictable
     player handling independent of engine choice; the player's engines carry `maxSpeed: 0` so there was no
     per-engine cap to reuse); the **+50 % engine `power` buff** (snappier acceleration for player and
     engine-sharing enemies, `maxSpeed` untouched); and the **5 s enemy hold-fire grace timed on
     accumulated sim `dt` (pause-safe) rather than wall-clock** (a pause during the on-ramp must not burn
     the breather). State plainly that this entry **supersedes §2's "no speed limit" clause for the
     player** (mirrored by the §2 amendment above).

---

## Out of scope / non-goals (DECISIONS §30)

- **Do NOT** change enemy speed caps, thruster `power`, engine `maxSpeed`/`exhaust`/`weight`/`price`, or
  any weapon stat.
- **Do NOT** add any HUD/countdown/banner for the grace — it is deliberately silent.
- **Do NOT** repurpose the player's engine `maxSpeed` for the cap; the flat constant is the single source.
- **Do NOT** rework `deriveDrive`/mass math, autopilot phases, or the `db.js`/`db_postgres.js` schema.
- **Do NOT** add the perf-overlay `spd` readout (an unrelated uncommitted change on `main`, not part of
  this feature).
- No new models/assets are touched, so **no** `CREDITS.md` change and **no** itch re-publish step.
