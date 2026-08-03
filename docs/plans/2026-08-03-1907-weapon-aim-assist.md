# Weapon aim assist — implementation brief (Vega Sentinels)

> Self-contained handoff for the implementation session. Adds a small **auto-aim cone** to every
> non-rocket bullet weapon. When a valid target is inside the shooter's forward cone **at fire time**,
> the bullet is redirected to fire straight at that target instead of straight along the nose. It is a
> per-weapon, data-driven stat (`aimAssistDeg`), applies to WHOEVER fires the weapon (player AND enemy
> guns), and is shown in the shop stat line as e.g. `Aim assist 2°`. Rockets are untouched (they keep
> their existing homing). File:line refs were accurate at planning time — re-verify before editing.
> English per the project's English-only rule.

## What & why

Bullets currently fly dead-straight along the shooter's nose (`fwd`), so hitting anything but a
stationary target dead-ahead needs manual aim. Aim assist gives each bullet weapon a **narrow cone**:
if an enemy (for player guns) or the player (for enemy guns) sits inside that cone off the nose at the
moment of firing, the bullet's launch direction is rotated to point straight at that target's current
position. The cone is small on purpose — it forgives near-misses and makes combat feel responsive
without turning bullets into homing missiles. It's a **weapon property**, so enemy kinetic/cannon guns
auto-aim toward the player exactly as player guns auto-aim toward enemies.

The value is stored per-weapon in the catalog (`aimAssistDeg`, degrees), so different weapons can carry
different cones later; **all bullet weapons currently get `2`**. It surfaces to the player in the
weapon's characteristics (shop/loadout stat line) reading `Aim assist 2°`.

## Settled decisions (do NOT re-open — answered by the maintainer)

1. **Cone angle = HALF-ANGLE.** `aimAssistDeg: 2` is the **half-angle** (±2° off the nose = a 4°-wide
   cone total), **not** the full width. The acquisition test uses the half-angle directly:
   `fwd.dot(toTarget) >= Math.cos(2° in radians)`. Convert degrees→radians at fire time
   (`deg * Math.PI / 180`). The shop stat line shows the stored number verbatim: **`2°`**.
2. **Velocity inheritance is unchanged.** Aim assist only rotates the base launch `dir` toward the
   target. `spawnBullet` still adds the shooter's velocity (`vel = dir*speed + shooterVel`) exactly as
   today — do **not** touch that. (The cone is tiny, so the perturbation is negligible; this is the
   minimal, lowest-risk change.)
3. **No target leading.** Aim at the target's **current position at fire time**. No intercept math, no
   velocity extrapolation.
4. **Tie-break = nearest by distance.** When two targets are in-cone, pick the nearest. Reuse the
   existing nearest-in-cone semantics. Respect existing guards: **skip warping enemies**
   (`e.warping`), and for enemy shooters require the player to be **alive** (`G.player.alive`).

## Determinism / replay safety (mandatory constraint)

The whole selection runs inside the seeded fixed-timestep sim and touches **no** `Math.random` and no
`simRandom()` — it is a pure scan of the current entity positions, so it is bit-deterministic given the
sim state. This is what keeps `?record`/`?playback` and the Level-0 intro re-sim reproducible. Do not
introduce any RNG. (This DOES change the recorded intro's outcome — see the Replay/intro impact section;
that is expected and handled by re-recording, never by weakening the guard.)

---

## Step 1 — catalog: add `aimAssistDeg: 2` to every bullet weapon

**File:** `server/src/catalog_seed.js`, the `WEAPONS` array (starts ~line 94). Add `aimAssistDeg: 2`
inside the `stats: { … }` object of **every `type: 'bullet'` row** — player AND enemy — and **only**
those. Do **not** add it to any `type: 'rocket'` row (ids 3, 4, 8, 11).

The seven bullet rows to touch (each is `type: 'bullet'`):

| id | name | class | line (approx) | side |
|----|------|-------|---------------|------|
| 1 | Basic kinetic | kinetic | 96–98 | player |
| 2 | Kinetic pirate | kinetic | 101–103 | enemy |
| 5 | Machine Gun | kinetic | 122–128 | player |
| 6 | Heavy cannon | cannon | 131–133 | player |
| 7 | Heavy Machine Gun | kinetic | 136–138 | player |
| 9 | Pirate machine gun | kinetic | 151–153 | enemy |
| 10 | Advanced pirate cannon | cannon | 157–159 | enemy |

Example (id 1, `server/src/catalog_seed.js:96-98`):

```js
id: 1, name: 'Basic kinetic', type: 'bullet', price: 800, stats: { // granted into the stash on shop unlock; sells ~600 to help fund the Heavy hull
  power: 10, projectileSpeed: 40, maxRange: 88, fireCooldown: 0.18, weight: 6, projectileColor: 0x6fe6ff, class: 'kinetic', aimAssistDeg: 2
}
```

Do the same for the other six rows. Keep `buyable: false` where present (ids 2, 9, 10). Units: degrees,
interpreted as the cone **half-angle**. Add a short one-line comment on the WEAPONS-block header or the
first row explaining the field, e.g. `// aimAssistDeg = auto-aim cone HALF-angle (deg); a bullet fired
with a target within ±this off the nose is redirected straight at it (findBulletAimTarget).`

> The seed is the single source: the server serves it to the client `CATALOG`, so `mount.weapon.aimAssistDeg`
> is available in `fireMount` and `s.aimAssistDeg` in the shop `statLine` with no schema change (weapon
> stats are passed through wholesale — see `normWeapon` in `client/src/shop.js:25`).

---

## Step 2 — pure, testable selection primitive in `steering.js`

**File:** `client/src/steering.js`. It already holds the pure XZ cone helper `inForwardSector(fwd,
toTarget, halfAngle)` (line ~34) and is unit-tested in `client/src/steering.test.js`. Add a sibling
pure function that returns the **index of the nearest in-cone target**, so the aim-assist selection has
a Node-testable seam (no THREE, no DOM):

```js
// Index of the NEAREST target within a forward cone (half-angle, radians), or -1 if none.
// All args are plain XZ: `from` {x,z} (muzzle), `fwd` {x,z} UNIT nose direction, `targets` array of
// {x,z} positions. Ties broken by distance (nearest wins). Deterministic — no RNG. Used by
// projectiles.js findBulletAimTarget to pick a bullet's auto-aim target.
export function nearestInConeIndex(from, fwd, targets, halfAngle) {
  const cos = Math.cos(halfAngle);
  let best = -1, bestD = Infinity;
  for (let i = 0; i < targets.length; i++) {
    const dx = targets[i].x - from.x, dz = targets[i].z - from.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) continue;                       // co-located → skip (matches findTargetInSector)
    const dot = (fwd.x * dx + fwd.z * dz) / d;    // fwd assumed unit; toTarget normalized by /d
    if (dot >= cos && d < bestD) { best = i; bestD = d; }
  }
  return best;
}
```

Rationale for XZ/planar: the game is a top-down planar shooter — bullets fly at `y ≈ 0` and `fwd` is
horizontal (`forwardVec` in `sim.js:210` sets `y: 0`). Selecting and aiming in the XZ plane keeps the
redirected bullet on the combat plane and avoids the off-plane-center miss trap (see the "top-down
planar collision" project note).

---

## Step 3 — shooter-aware target finder in `projectiles.js`

**File:** `client/src/projectiles.js`. Leave the existing `findTargetInSector` (line 277, used by the
rocket path) **unchanged**. Add a new exported helper next to it that dispatches by side and returns the
target OBJECT (or `null`), built on the Step-2 primitive:

```js
import { nearestInConeIndex } from './steering.js'; // add to the existing import line (headingToDir etc. not needed)
```

```js
// Aim-assist target for a BULLET shot: the nearest valid OPPOSING-side target within the forward cone
// (halfAngle, radians). Player guns pick the nearest non-warping enemy; enemy guns pick the player (if
// alive). Returns the target ship object or null. Deterministic (pure scan; no RNG). Planar (XZ).
// Rockets do NOT use this — they keep findTargetInSector.
export function findBulletAimTarget(pos, fwd, halfAngle, fromPlayer) {
  const from = { x: pos.x, z: pos.z };
  const f = { x: fwd.x, z: fwd.z };            // fwd is horizontal (y=0) → its XZ is unit
  if (fromPlayer) {
    const cands = [];
    for (const e of enemies) if (!e.warping) cands.push(e); // skip enemies still forming
    const idx = nearestInConeIndex(from, f, cands.map((e) => ({ x: e.mesh.position.x, z: e.mesh.position.z })), halfAngle);
    return idx >= 0 ? cands[idx] : null;
  }
  if (!G.player || !G.player.alive) return null;
  const p = G.player.mesh.position;
  const idx = nearestInConeIndex(from, f, [{ x: p.x, z: p.z }], halfAngle);
  return idx >= 0 ? G.player : null;
}
```

`enemies` and `G` are already imported at the top of `projectiles.js` (line 12).

---

## Step 4 — apply aim assist in `fireMount`

**File:** `client/src/ship-build.js`, function `fireMount` (line 159), the **`else` (bullet) branch**
(lines 171–176). Import the new helper:

```js
// line 10 currently: import { spawnBullet, spawnRocket, findTargetInSector } from './projectiles.js';
import { spawnBullet, spawnRocket, findTargetInSector, findBulletAimTarget } from './projectiles.js';
```

Replace the bullet branch body so it computes an effective direction, without mutating `fwd` (the same
`fwd` is reused for every mount in the volley — do not alter it):

```js
} else {
  let dir = fwd; // default: straight along the nose (spawnBullet clones+normalizes, so fwd is not mutated)
  if (w.aimAssistDeg) {
    const target = findBulletAimTarget(muzzle, fwd, w.aimAssistDeg * Math.PI / 180, isPlayer);
    if (target) {
      const aim = target.mesh.position.clone().sub(muzzle); // toward the target's CURRENT position (no leading)
      aim.y = 0;                                            // keep the shot on the combat plane
      if (aim.lengthSq() > 1e-6) dir = aim.normalize();     // unit; spawnBullet re-normalizes anyway
    }
  }
  spawnBullet(muzzle, dir, w, isPlayer, ship.vel);
  // The weapon's class → its 'fire' sound via the DB map (sfxFor); unset → synthesized zap.
  // Enemy fire makes no sound at all (intentional — only the player's own shots are audible).
  if (isPlayer) audio.sfx.shoot(sfxFor('weapon', w.class, 'fire'));
}
```

Notes:
- The cone is measured **from `muzzle`** (the actual spawn point, already computed at line 162), matching
  how the rocket path passes `muzzle` to `findTargetInSector` (line 167).
- The rocket branch (lines 166–170) is untouched.
- `w.aimAssistDeg` is falsy (undefined) for any weapon without the stat → behavior is identical to today
  for such weapons; only the seven bullet rows opt in.

---

## Step 5 — shop stat line: show `Aim assist 2°`

**File:** `client/src/shop.js`, function `statLine` (line 31), the **weapon branch** (lines 44–54).
Add the aim-assist line, guarded so it only shows for bullet weapons that carry the stat (never for
rockets or components). Insert after the `range`/`blast` lines, before the weight line:

```js
} else { // weapon
  // Triple spiral rocket fires 3 real warheads … (existing comment)
  add('ui.shop.stat.dmg', s.spiral ? `${s.power}×3` : s.power);
  if (s.fireCooldown) parts.push(type === 'rocket'
    ? `${t('ui.shop.stat.reload')} ${s.fireCooldown}s`
    : `${t('ui.shop.stat.rof')} ${(1 / s.fireCooldown).toFixed(1)}/s`);
  add('ui.shop.stat.speed', s.projectileSpeed);
  add('ui.shop.stat.range', s.maxRange);
  add('ui.shop.stat.blast', s.blastRadius);
  if (s.aimAssistDeg) parts.push(`${t('ui.shop.stat.aimassist')} ${s.aimAssistDeg}°`); // bullet auto-aim cone (half-angle)
}
```

Do **not** use the `add(label, val)` helper here — `add` suppresses `0` and appends a bare `val`; we
want the explicit `°` suffix and to only show when the stat is present, so `parts.push` with an explicit
guard is correct. The result renders as e.g. `DMG 10 · RoF 5.6/s · Speed 40 · Range 88 · Aim assist 2°`.

---

## Step 6 — i18n key (English source of truth)

**File:** `client/locales/source.json`. This is where every `ui.shop.stat.*` key is defined (verified:
`ui.shop.stat.dmg` at line 226, `.speed` 238, `.range` 242, `.blast` 246). Add a new key next to the
other weapon stat labels (e.g. right after the `ui.shop.stat.blast` block, ~line 249):

```json
"ui.shop.stat.aimassist": {
  "source": "Aim assist",
  "context": "Stat label — bullet weapon auto-aim cone; followed by a degree value like '2°'. Short."
},
```

The stat line composes `t('ui.shop.stat.aimassist')` + ` ` + `2°` → **`Aim assist 2°`**.

**RU / other locales are out of scope.** `client/locales/ru.json` need not be updated: `i18n.t` falls
back to the English source when a bundle key is missing (see `client/src/i18n.test.js` "a missing
translation falls back to the English source"), and there is no test forcing locale parity. English is
the source of truth (CLAUDE.md); the RU layer is a separate future pass.

---

## Tests

Run from the worktree.

### (a) Unit test the pure selection primitive — `client/src/steering.test.js`

`node --test` has no jsdom, so `steering.js` (pure math) is the testable surface. Add a test for
`nearestInConeIndex` mirroring the existing `inForwardSector` test (line ~35). Cover:

- **In-cone, single target → index 0.** `from {x:0,z:0}`, `fwd {x:0,z:1}` (nose +Z), target
  `{x:0,z:10}` (dead ahead), `halfAngle = 2*Math.PI/180` → `0`.
- **Just outside the cone → -1.** Same `from/fwd`, a target at ~3° off-axis (e.g. `{x:0.52,z:10}` →
  `atan2(0.52,10) ≈ 2.98°`, outside a 2° half-angle) → `-1`.
- **Just inside the cone → 0.** target at ~1° off-axis (`{x:0.17,z:10}` ≈ `0.97°`) → `0`.
- **Behind → -1.** `{x:0,z:-10}` → `-1`.
- **Nearest wins among two in-cone.** two dead-ahead targets `{x:0,z:20}` (i=0) and `{x:0,z:8}` (i=1),
  wide `halfAngle` (e.g. `Math.PI/6`) → `1` (the closer one).
- **Co-located target skipped.** target equal to `from` → not selected.

Update the import line at the top of `steering.test.js` to include `nearestInConeIndex`.

Run: `cd client && node --test src/steering.test.js` (and the full `cd client && node --test` to confirm
nothing else regressed).

> `findBulletAimTarget` / `fireMount` themselves depend on THREE + live sim state and have no jsdom seam;
> their behavior is exercised end-to-end by the intro-replay guard below. The pure primitive above is the
> regression guard for the cone math (per the project's "every change ships an automated guard" rule).

### (b) Server tests — sanity that the catalog still loads

`cd server && npm test` (drops+recreates `spacegame_test`). No new server logic; this just confirms the
edited `catalog_seed.js` still parses and seeds. No server assertion change is expected.

### (c) MANDATORY — the Level-0 intro replay guard (this is a SIM change)

Aim assist changes bullet launch directions inside the deterministic sim, so the recorded Level-0 intro
(an input replay re-run through the real `sim.update`) will very likely **desync** — both the player's
and the rocketeer's kinetic shots now curve toward their targets, changing what gets hit and when.

1. `npm run assets:pull` (repo root) FIRST — the intro trace + ship `.glb`s are gitignored S3 assets;
   without them the scenario stops at its `assets:pull` assertion.
2. Run: `cd client && node visual/run.mjs 22-intro-replay`.
3. **Expected before re-recording:** the run reaches a terminal state on **trace exhaustion** and fails
   `assert.equal(out.kills, 4)` — console reads roughly `kills=<n<4> … won=false playDone=true
   tick=T/T`. That means the plumbing works and only the *outcome* diverged (a genuine desync from the
   new aim behavior). This is the SIGNAL to re-record — it is **NOT** a bug to "fix" by touching the
   scenario. **Under no circumstances weaken the `4 kills` / `p0..p4` / `won` assertions** in
   `client/visual/scenarios/22-intro-replay.mjs`.
4. If instead the run passes unchanged, note that (possible if the shots already tracked closely enough)
   and no re-record is needed — but treat a pass as the exception and verify the console line.

**How the implementer reports a guard break:** in the PR / run notes, paste the exact
`intro re-sim: kills=… cards=… won=… playDone=… tick=…` console line from the failing run, and state
plainly: *"intro guard fails by design (aim-assist is a sim change); the intro trace must be re-recorded
by the maintainer at the live-test stage — see Re-record below. Do not weaken the guard assertions."*
The implementer does **not** re-record (it needs a human flying the fight).

### (d) Re-record the intro trace (maintainer, at the live-test stage)

This mirrors Step 9 of `docs/plans/2026-07-26-0009-fix-intro-replay-desync.md` — follow that checklist
verbatim. Summary:

1. `npm run assets:pull`; start the local server (`cd server && PORT=4000 node src/server.js`).
2. Open `http://localhost:4000/?record=1&level=1`, wait for **"Start recording"**, click it, and fly the
   intro fight: 3 basic pirates then the rocket pirate — **4 kills**, the rocketeer must launch **≥2
   rockets** (P4 fires on its 2nd), survive comfortably, and **keep flying ~1–2 s after the last kill**
   near home (avoids the trace-exhaustion race + sizes the return-home watchdog).
3. **Stop & Save** → `{id}.json` downloads; **Play it ▶** and confirm cards p0..p4, fight cleared,
   autopilot flies home, victory. While watching, **measure the return-home flight** (console snippet in
   that plan's Step 9.4); if it lands within 2× of `CUTSCENE_STALL_TICKS` (`client/src/replay.js:76`,
   currently 900), raise the constant to ~3× and update its comment + `replay.test.js`.
4. Content-hash + copy to `client/assets/recordings/level0-intro.<hash>.json`, `aws s3 cp` it up
   (immutable, `application/json`), then update the `introTrace` string in
   `server/src/catalog_seed.js:402` to the new hash. Commit **only that string** (trace bytes stay out
   of git). Delete the stale local trace copy.
5. `npm run assets:check` (root) → `intro:level-1` must read `ok`.
6. `cd client && node visual/run.mjs 22-intro-replay` → **must pass** (4 kills, p0..p4, won). This is the
   merge gate.

### (e) Publish-itch after deploy

Per DECISIONS §37 and the "re-publish itch after model change" project note: the itch ZIP bundles
`client/assets/` (including `assets/recordings/`) but reads the catalog **live from prod**, so a new
`introTrace` hash 404s the old bundled trace on itch until republished. **After the prod deploy, run
`/publish-itch`** so the itch intro plays the new trace. (No ship-model hash changes here, so this is the
only itch-relevant asset — but the re-recorded intro trace still requires it.)

---

## Replay / intro impact (mandatory analysis)

- **The canonical intro trace is invalidated by design.** Aim assist alters bullet directions in the
  seeded sim, and the Level-0 intro re-sims recorded input through the real `sim.update` (only
  progress-advance is gated by `G.replayMode`, not the damage/aim path), so the recorded fight diverges.
  This is expected and is resolved by the re-record in Testing (d) — **not** by weakening the guard.
- **Player-death risk during re-sim of the OLD trace:** enemy kinetic guns now auto-aim at the player, so
  the rocketeer/pirate shots land more often than at record time. On the OLD trace this simply causes the
  fight to diverge/exhaust (a failed guard, as expected). The **new** recording is flown live under the
  new behavior, so its input already accounts for the tighter enemy fire — the re-recorded trace is
  self-consistent. Confirm in Testing (d) step 3 that the fresh recording clears the fight and reaches
  victory (survives the intro).
- **`?record`/`?playback` and `?bench`** are all the same deterministic loop; no separate handling — the
  new logic runs identically in live play, recording, and playback because it reads only sim state.

---

## Docs to update

- **`docs/SUMMARY.md`** — in the **Weapons** bullet (lines ~791–816): note that every bullet weapon now
  carries `aimAssistDeg` (auto-aim cone **half-angle** in degrees; `2` for all current bullets), that a
  bullet fired with an opposing-side target within ±`aimAssistDeg` of the nose at fire time is redirected
  straight at that target's current position (planar, no leading, nearest-in-cone; skips warping
  enemies / requires the player alive), that it applies to enemy guns too (they auto-aim at the player),
  and that rockets are unaffected. In the shop/stat-line description (same section / line ~812) add that
  the bullet stat line now shows `Aim assist 2°`. Bump the **`Updated:`** date (line 6) and prepend a
  one-line summary of this change to that header, matching the existing "Previously:" chaining style.
- **`docs/CHANGELOG.md`** — add a bullet under the `## 2026-08-03` heading (create nothing; the heading
  exists). Lead bold, e.g. **"Bullet weapons get aim assist."** Describe: every non-rocket bullet weapon
  gains a data-driven `aimAssistDeg` (2° half-angle) auto-aim cone; a shot with an opposing target in the
  cone at fire time is redirected straight at it; applies to player AND enemy guns; shown as `Aim assist
  2°` in the shop; rockets unchanged; deterministic (no RNG). Note that this is a **sim change** that
  required **re-recording the Level-0 intro trace** (so nobody "fixes" the guard by reverting).
- **`docs/DECISIONS.md`** — add **§87** (next number; §86 is the last, line ~3092). Title e.g.
  *"Aim assist is a per-weapon cone that applies to whoever fires it (enemies included)."* Record: (a)
  the mechanic (redirect the bullet's launch dir at the nearest opposing target within the cone at fire
  time; velocity inheritance and rockets untouched); (b) **why a weapon property, not a player-only
  aid** — it is symmetric, so equipping/looting a weapon changes both sides' behavior consistently and
  keeps the sim rule in one place; (c) the **half-angle `2°`** choice (±2°, a deliberately narrow cone —
  forgiving, not homing) and why it's stored in degrees per-weapon (future per-weapon tuning); (d)
  determinism (no RNG → replay-safe) and that it forced an intro re-record.

---

## Out of scope / non-goals (DECISIONS §30 — keep it simple)

- **No rocket changes.** Rockets keep their existing homing / `findTargetInSector` path; do not add
  `aimAssistDeg` to rocket rows or touch `spawnRocket`.
- **No target leading / intercept math.** Aim at the current position only.
- **No velocity-inheritance rework.** `spawnBullet` stays as-is; only the base `dir` is rotated.
- **No new per-weapon values** beyond `2` — every bullet weapon gets the same default now; per-weapon
  variation is enabled by the data field but not exercised here.
- **No visual/telegraph** for the cone (no reticle, no tracer bend beyond the redirected launch), no
  audio change, no HUD indicator.
- **No RU/localization** beyond the English source key.
- **No balance retuning** of `power`/`fireCooldown`/etc. — aim assist ships at existing weapon stats.
- Do **not** weaken or edit the `22-intro-replay` guard assertions; the fix for a red guard is the
  re-record, done by the maintainer.
