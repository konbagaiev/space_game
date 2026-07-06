# Grab tractor beam — inverse-square pull field + emergent range

**Feature ID:** 2026-07-06-2350-grab-inverse-square-pull
**Area:** loot drops / Grab (tractor) component
**Files:** `client/src/drops-config.js`, `client/src/drops.js`, `client/src/drops.test.js`,
`client/src/shop.js`, `client/locales/source.json`, `server/src/catalog_seed.js`, docs.

---

## Goal

Rebalance the Grab (tractor beam) so its pull is an **inverse-square field** instead of a
constant-speed pull inside a hard radius. Pull strength now falls off with distance
(`field = strength · FIELD_K / dist²`), and the beam **engages only where the field is strong
enough** (`field ≥ FIELD_CUTOFF`). Range therefore becomes **emergent** — it is *derived* from
where the field crosses the cutoff, not a stored stat — and is **weight-independent** (item
weight affects pull *speed* only, never reach). The user-visible effect: drops close to the ship
are yanked in fast and drops near the edge crawl in slowly; the blue pull line appears only while a
drop is inside the field and vanishes the instant it drops below the cutoff. The base Grab reaches
slightly farther than before (≈11.18 u vs the old flat 10), and the Advanced grab reaches √2× the
base (≈15.81 u), not 2×.

---

## Decisions (all settled — do NOT re-open)

- **New model** (confirmed):
  - `field(strength, dist)          = strength · FIELD_K / dist²`
  - engaged when `field ≥ FIELD_CUTOFF` (below → release: not a target, hide the line)
  - `pullSpeed(strength, weight, dist) = field · (10 / weight) = strength · FIELD_K · 10 / (weight · dist²)`
  - `range(strength)                = sqrt(strength · FIELD_K / FIELD_CUTOFF)` — **weight-independent**
- **Constants:** `FIELD_K = 5`, `FIELD_CUTOFF = 0.4`. Fixed for this iteration.
- **Component strength values stay 10 (base) and 20 (Advanced)** — unchanged in `catalog_seed.js`.
  This is deliberate: keeping them equal-ratio makes Advanced reach exactly √2× the base, not 2×.
- **Range is tested against `field`, which has no weight term** → range depends only on strength.
  Do **not** make range weight-dependent.
- **Expected numbers** (use as test anchors):
  - `range(10) = sqrt(10·5/0.4) = sqrt(125) ≈ 11.1803`
  - `range(20) = sqrt(20·5/0.4) = sqrt(250) ≈ 15.8114`; `range(20)/range(10) === Math.SQRT2`.
  - `pullSpeed(10,10,3) = 10·5·10/(10·9) = 500/90 = 50/9 ≈ 5.5556`
  - `pullSpeed(10,10,5) = 10·5·10/(10·25) = 2.0`
  - At the base edge `d≈11.18`: `pullSpeed(10,10,11.18) ≈ 0.4` (≈ `FIELD_CUTOFF·10/weight`).
- **No extra 1/d² clamp near the ship.** Collection happens at `COLLECT_DIST = 3.0` (checked
  *before* the drop can approach `d→0`), and the move step is already capped by
  `Math.min(speed·dt, d)` in `drops.js`, so an over-large near-field speed can never overshoot the
  ship. State this reasoning in-plan (below) so the reviewer can confirm it.
- **Shop stat line (option a, confirmed):** keep displaying the raw `strength` number (10 / 20), but
  stop labeling it "= range in world units". Retitle the meaning to an abstract **"grab strength"**
  in the `shop.js` code comment and the `source.json` translator context. Do **NOT** switch the shop
  to show derived range. The visible English label "Grab" and the ru.json value stay as-is (only the
  translator-facing context string changes).
- **Keep it simple (DECISIONS §30):** no new config UI, no per-item tuning, no per-drop stats.

---

## Steps

### 1. `client/src/drops-config.js` — constants + pure helpers + new pullSpeed signature

**1a. Add the two field constants** next to the other tuning constants (after
`WEIGHT_FALLBACK` on line 9). Insert:

```js
// Grab (tractor) inverse-square pull field. The pull FIELD at a drop is strength·FIELD_K/dist²; the
// beam ENGAGES a drop only where field ≥ FIELD_CUTOFF, so the reach is EMERGENT (derived from the
// cutoff), not a stored stat — see range() below. Both are fixed this iteration.
export const FIELD_K      = 5;    // field numerator scale
export const FIELD_CUTOFF = 0.4;  // field threshold: below this the drop leaves the beam (line hides)
```

**1b. Replace the `pullSpeed` header comment + function** (current lines 38–44). The signature gains
a third arg `dist`. New block:

```js
// Grab pull math (inverse-square field). All pure + import-free so drops.test.js runs under node.
//   field(strength, dist)  = strength · FIELD_K / dist²        — pull strength at a given distance
//   engaged                = field ≥ FIELD_CUTOFF               — below this the drop leaves the beam
//   pullSpeed(s, w, dist)  = field · (10 / w)                  — u/s toward the ship (light parts pull faster)
//   range(strength)        = sqrt(strength · FIELD_K / FIELD_CUTOFF)  — EMERGENT, weight-INDEPENDENT reach
// A zero/missing weight falls back to WEIGHT_FALLBACK so the sim never divides by zero. dist is always
// > 0 in practice (collection at COLLECT_DIST=3 fires before dist→0; drops.js caps the step at the gap).
export function field(strength, dist) {
  return (strength * FIELD_K) / (dist * dist);
}
export function pullSpeed(strength, weight, dist) {
  return field(strength, dist) * (10 / (weight || WEIGHT_FALLBACK));
}
export function range(strength) {
  return Math.sqrt((strength * FIELD_K) / FIELD_CUTOFF);
}
```

**Callers of `pullSpeed` (signature change — update every one):**
- `client/src/drops.js:231` — the only runtime caller (updated in Step 2).
- `client/src/drops.test.js:9–22` — the test anchors (rewritten in Step 5).
No other file references `pullSpeed` (verified by grep across `client/src` + `server/src`).

### 2. `client/src/drops.js` — eligibility via field, distance-aware pull, line-hide

**2a. Update the import** on line 14 to pull in the new symbols. Add `field, FIELD_CUTOFF` to the
destructured import from `./drops-config.js` (and keep `pullSpeed`). `range`/`FIELD_K` are **not**
needed here.

**2b. Replace the `updateDrops` body** (current lines 214–236). Key changes vs current code:
- Drop the `const range = grab.strength;` line (line 220) — there is no stored range now.
- Eligibility test changes from `dist <= range` to `field(grab.strength, dist) >= FIELD_CUTOFF`.
- The arm-timer still only advances while eligible; the nearest ARMED eligible drop is the target.
- `pullSpeed` is called with the live `dist` as the third arg.

New body:

```js
export function updateDrops(dt) {
  // 1) rotate every drop (cosmetic) — one turn / ROTATE_PERIOD
  for (const d of drops) d.obj.rotation.y += dt * (Math.PI * 2 / ROTATE_PERIOD);
  const p = G.player, grab = p && p.grab;
  // feature inert with no grab / dead player: hide the line and stop pulling
  if (!p || !p.alive || !grab) { hideLine(); return; }
  const ppos = p.mesh.position;
  // 2) arm timers + find the nearest ARMED, field-eligible drop. Eligibility is the inverse-square
  //    field crossing FIELD_CUTOFF (weight-independent) — the reach is emergent, not a stored radius.
  let target = null, best = Infinity;
  for (const d of drops) {
    const dist = tmp.copy(d.obj.position).sub(ppos).length();
    if (field(grab.strength, dist) >= FIELD_CUTOFF) {
      d.inRange += dt;
      if (d.inRange >= ARM_DELAY && dist < best) { best = dist; target = d; }
    } else d.inRange = 0;
  }
  if (!target) { hideLine(); return; }
  // 3) pull the target toward the ship at the distance-aware, weight-scaled speed
  tmp.copy(ppos).sub(target.obj.position); const d = tmp.length();
  if (d <= COLLECT_DIST) return collect(target);         // arrived → collect + re-target next frame
  const speed = pullSpeed(grab.strength, target.weight, d);
  target.obj.position.addScaledVector(tmp.normalize(), Math.min(speed * dt, d));
  drawLine(ppos, target.obj.position);                   // thin blue activity indicator
}
```

Note: `d` (the distance-to-ship for the pull) is computed *before* `pullSpeed`, and the
`COLLECT_DIST` early-return runs first, so the singularity is never reached (see 2c). The
`field()` eligibility loop uses its own `dist` scratch off `tmp` — the two are sequential, no alias.

**2c. Singularity safety (state for the reviewer, no code):** `field(s,dist)→∞` as `dist→0`, so
`pullSpeed` can be large very close to the ship. This is safe because (1) the `d <= COLLECT_DIST`
(=3.0) check fires and `collect()`s the drop before it can get near `d=0`, and (2) even for the one
frame between arming and collecting, the move is `Math.min(speed·dt, d)` — capped at the actual gap,
so the drop can never overshoot the ship or jitter past it. No additional clamp is warranted (§30).

**2d. Update the file-header comment** (lines 1–7). Replace the parenthetical
`(range = grab.strength; speed = (strength/2)*(10/itemWeight))` on line 4 with the new model, e.g.:
`(the Grab's inverse-square field pulls a drop in — engaged where field ≥ cutoff, so reach is
emergent; pull speed rises the closer the drop is)`. Keep the surrounding prose.

### 3. `server/src/catalog_seed.js` — Grab comment block (values unchanged)

Update the comment block above the two grab rows (current lines ~69–73, the `--- Grab (tractor
beam) ---` block). Replace the line:

```
//   RANGE (world units) = strength;  PULL SPEED (u/s) = (strength / 2) * (10 / pulledItemWeight).
```

with:

```
//   Inverse-square field: FIELD = strength·5/dist²; the beam engages where FIELD ≥ 0.4, so RANGE is
//   EMERGENT (base strength 10 → ≈11.2 u, Advanced 20 → ≈15.8 u = √2× base) and weight-INDEPENDENT.
//   PULL SPEED (u/s) = FIELD · (10 / pulledItemWeight) — rises the closer the drop is; light parts faster.
```

Leave the two rows `{ id: 29, ... strength: 10 }` and `{ id: 30, ... strength: 20 }` **exactly as
they are** — strength values and everything else unchanged. (No DB migration: `strength` is
unchanged and lives in the JSON `stats`; nothing schema-level changes. `db.js` / `db_postgres.js`
need no edits.)

### 4. `client/src/shop.js` + `client/locales/source.json` — retitle the grab stat (option a)

**4a.** `client/src/shop.js:42` — keep the code, fix the trailing comment. Change:

```js
    else if (type === 'grab') add('ui.shop.stat.grab', s.strength); // tractor: range = strength (world units)
```

to:

```js
    else if (type === 'grab') add('ui.shop.stat.grab', s.strength); // tractor: abstract grab strength (reach is emergent, not equal to this number)
```

The displayed value (`s.strength` → 10 / 20) and the `ui.shop.stat.grab` label are **unchanged**.

**4b.** `client/locales/source.json:65` — the `ui.shop.stat.grab` entry. Keep `"source": "Grab"`;
rewrite only the `context` so it no longer claims strength equals range:

```json
  "ui.shop.stat.grab": { "source": "Grab", "context": "Stat label — abstract grab (tractor) strength (followed by e.g. '10'/'20'). NOT the world-unit reach: actual range is emergent from an inverse-square field. Short." },
```

**Do not touch `client/locales/ru.json`** — its value `"Захват"` translates the label "Grab", which
is unchanged. `source.json` `context` is translator guidance only (not shown in-game); no locale
value keys off it.

### 5. Tests — `client/src/drops.test.js`

**5a.** Extend the import on line 5 to add `field` and `range`:

```js
import { pullSpeed, field, range, pickLoot, WEIGHT_FALLBACK, DROP_CHANCE, ARM_DELAY, shouldDeposit, rewardOwned } from './drops-config.js';
```

**5b.** Replace the four tests on lines 7–30 (the old `pullSpeed` anchors, the heavier/stronger
comparison, the zero-weight fallback, and the old `range = strength` test) with the new suite. Use a
small tolerance helper for the irrational values.

```js
const approx = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

// --- pull speed: strength·FIELD_K·10 / (weight·dist²), in world units/sec (distance-aware) ---
test('pullSpeed: anchor cases (distance-aware inverse-square)', () => {
  approx(pullSpeed(10, 10, 3), 50 / 9);    // ≈5.556 u/s at d=3
  approx(pullSpeed(10, 10, 5), 2.0);       // slower farther out
  assert.ok(pullSpeed(10, 10, 3) > pullSpeed(10, 10, 5)); // closer = faster
});

test('pullSpeed: lighter items pull faster; the stronger grab pulls faster at the same distance', () => {
  assert.ok(pullSpeed(10, 2, 5) > pullSpeed(10, 50, 5));  // lighter = faster (same grab, same dist)
  assert.ok(pullSpeed(20, 10, 5) > pullSpeed(10, 10, 5)); // stronger grab = faster
});

test('pullSpeed: a zero/undefined weight falls back to WEIGHT_FALLBACK (never divides by zero)', () => {
  assert.equal(pullSpeed(10, 0, 5), pullSpeed(10, WEIGHT_FALLBACK, 5));
  assert.equal(pullSpeed(10, undefined, 5), pullSpeed(10, WEIGHT_FALLBACK, 5));
  assert.ok(Number.isFinite(pullSpeed(10, 0, 5)));
});

// --- field: inverse-square; the FIELD_CUTOFF boundary is what defines the emergent range ---
test('field: falls off as 1/dist² and crosses FIELD_CUTOFF exactly at range()', () => {
  approx(field(10, 5), 10 * 5 / 25);                 // = 2.0
  assert.ok(field(10, 3) > field(10, 5));            // stronger closer in
  const r = range(10);
  approx(field(10, r), 0.4);                         // at the emergent edge the field == FIELD_CUTOFF
  assert.ok(field(10, r - 0.01) > 0.4);              // just inside → engaged
  assert.ok(field(10, r + 0.01) < 0.4);              // just outside → released
});

// --- range: EMERGENT (sqrt(strength·FIELD_K/FIELD_CUTOFF)), weight-INDEPENDENT ---
test('range: base ≈11.18, advanced ≈15.81, advanced/base === sqrt(2)', () => {
  approx(range(10), Math.sqrt(125));   // ≈ 11.1803
  approx(range(20), Math.sqrt(250));   // ≈ 15.8114
  approx(range(20) / range(10), Math.SQRT2, 1e-9); // advanced reaches √2× the base, not 2×
});
```

Leave every other test in the file (`pickLoot`, `config` DROP_CHANCE/ARM_DELAY, `shouldDeposit`,
`rewardOwned`) untouched — none reference `pullSpeed`/`field`/`range`.

**5c.** `server/src/server.test.js:843–846` asserts `grab.stats.strength === 10` and the Advanced
grab `strength === 20` / `price === 2000`. These are **unchanged** and must keep passing — do not
edit them; run the suite to confirm.

**Run:**
- `cd client && node --test` (drops.test.js + the rest).
- `cd server && npm test` (runs on **both SQLite and Postgres** — no schema change here, but the
  grab-seed assertions must still pass on both).

### 6. Docs

**6a. `docs/SUMMARY.md`** — two spots:
- **Grab & loot drops** section (lines 593–600). Replace `range = strength world units` and
  `speed = (strength/2)·(10/itemWeight)` with the inverse-square description: the Grab pulls drops in
  via an **inverse-square field** (`field = strength·5/dist²`); a drop must sit where **field ≥ 0.4**
  (`FIELD_CUTOFF`) for **0.3 s** (`ARM_DELAY`) to arm, then the nearest armed drop is pulled at
  **speed = field·(10/itemWeight)** u/s (`pullSpeed` — faster the closer it is; light parts faster;
  zero/missing weight falls back to 10). Reach is **emergent + weight-independent**: base strength 10
  → **≈11.2 u**, Advanced strength 20 → **≈15.8 u (= √2× base, not 2×)**. The blue line hides the
  instant a drop drops below the cutoff. Update the "base grab's short range (10)" sentence to
  "≈11.2".
- **Components** paragraph (line 335): change "`{ strength }` → its loot pull range/speed" to
  "`{ strength }` → scales its inverse-square loot-pull field (reach is emergent, ≈11.2 u base /
  ≈15.8 u advanced; see **Grab & loot drops**)". The id-29/id-30 strength/weight/price line (339–340)
  stays accurate as-is.
- The top **`**Updated:**`** line (line 6) is already dated `2026-07-06`; leave the date and replace
  its parenthetical note with (or extend it to mention) the Grab inverse-square/emergent-range
  rebalance.

**6b. `docs/CHANGELOG.md`** — add a bullet under the existing `## 2026-07-06` date heading (newest on
top). Lead bold, e.g.: **Grab tractor = inverse-square field with emergent range** — the pull is now
`strength·5/dist²`, engaging where field ≥ 0.4; pull speed rises the closer a drop is, and the blue
line hides below the cutoff. Range is derived (not stored) and weight-independent: base ≈11.2 u,
Advanced ≈15.8 u (√2× base). Shop still shows the abstract strength number (10/20), relabeled so it
no longer claims to be the range. No DB/schema change.

**6c. `docs/DECISIONS.md`** — add **§57** (next free number; §56 is the last one). Record the
rationale: why an inverse-square field with a field-based cutoff (feels like a real tractor — near
drops snap in, far ones crawl — and makes range **emergent** so it doesn't need its own stat); why
range is **weight-independent** (the cutoff tests `field`, which has no weight term — weight scales
only speed); why the strength values were **kept at 10/20** (equal ratio → Advanced reaches exactly
√2× the base, a modest reach upgrade, not double); and why the shop keeps showing the raw strength
number relabeled as abstract "grab strength" rather than the derived range (§30 keep-it-simple — one
existing surface, minimal churn). Note constants `FIELD_K=5`, `FIELD_CUTOFF=0.4` are fixed this
iteration.

---

## Tests to run (summary)

- `cd client && node --test` — drops.test.js rewritten anchors + new field/range tests pass.
- `cd server && npm test` — grab-seed assertions (strength 10/20) still pass on SQLite **and**
  Postgres.

## Out of scope / non-goals (DECISIONS §30)

- No new config UI, no per-item / per-drop tuning, no exposing FIELD_K/FIELD_CUTOFF to players.
- Do **not** change the strength values (10/20) or add a DB migration — `stats` JSON is untouched.
- Do **not** switch the shop to show derived range (maintainer chose option a).
- Do **not** add a near-ship velocity clamp — the COLLECT_DIST early-return + `Math.min(speed·dt, d)`
  cap already make the singularity harmless.
- No changes to drop spawning, pickLoot, the reward-drop lifecycle, deposit-on-victory, or the
  autopilot-to-chest behavior.
- No asset/model changes → **no `/publish-itch` step needed** (nothing content-hashed changes).
