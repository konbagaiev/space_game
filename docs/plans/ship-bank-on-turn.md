# Plan: ships bank their wings when turning

## Goal
Every ship (player **and** enemies) should **visually roll/bank its wings** while turning — a smooth
tilt **into** the turn, capped at **20°**, easing back to level when not turning. Purely cosmetic: it
must **not** affect heading, physics, collision, aim, or any gameplay number. One code path should cover
keyboard steering, touch steering, the warp-back, and enemy AI turning.

This is a client-only change in `client/index.html` (plus a tiny helper) and the docs.

## Why this approach
- A ship's **root group** already carries `rotation.y = heading` (and world position + the `1.8` scale).
  We must **not** also write `rotation.z` on that same root — instead add a dedicated **inner "bank"
  group** that holds the visual children. Its local **Z axis is the ship's forward axis** (ships face
  `+Z`), so `bankGroup.rotation.z` is a **pure roll about the nose** — exactly a wing dip — and it never
  fights the heading yaw. Composition becomes: `root.rotation.y` (heading) → `bank.rotation.z` (roll) →
  existing `pivot.rotation.y` (modelYaw) → model. All independent.
- Derive the bank from the **actual per-frame heading change** (current vs previous heading), normalized
  by the ship's max possible turn this frame (`turnRate * dt`). This single signal works for **every**
  turn source (A/D keys, touch `steerToward`, enemy `steerToward`) without special-casing each.

## Constants (add near the other tuning consts in `client/index.html`, e.g. by `SPAWN_GROW_TIME`)
```javascript
const BANK_MAX  = 20 * Math.PI / 180; // max wing bank, radians (~0.349) — hard cap, "20 degrees, no more"
const BANK_TAU  = 0.15;               // smoothing time-constant (s); smaller = snappier, larger = lazier
```

## Step 1 — give each ship an inner "bank" group (`makeShip`, `client/index.html:1320`)
Currently the primitives (`body`, `wing`, `glow`) are added **directly to the root `g`**. Move them into
a child group and remember it on the root.

Replace the body of `makeShip` (lines 1320–1342) so the primitives go into a `bank` group:

```javascript
function makeShip(color, model = null) {
  const g = new THREE.Group();
  const bank = new THREE.Group();         // inner group: holds the visual model, rolls about the nose (+Z)
  g.add(bank);
  g.userData.bankGroup = bank;            // gameplay still references g; the bank group is for cosmetics only
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.5 });
  // hull (nose points in +Z)
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.2, 12), mat);
  body.rotation.x = Math.PI / 2;
  bank.add(body);
  // wings
  const wing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.25, 1.0), mat);
  wing.position.z = -0.4;
  bank.add(wing);
  // engine glow
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 10, 10),
    new THREE.MeshBasicMaterial({ color })
  );
  glow.position.z = -1.6;
  bank.add(glow);
  g.position.y = 0.6;
  g.scale.setScalar(1.8); // larger - the arena is far away, otherwise ships look tiny
  if (model) applyShipModel(g, model, color); // optionally replace the primitive with a .glb
  return g;
}
```
The root still owns `position.y`, `scale`, and (set in the loop) `rotation.y` — unchanged for gameplay.

## Step 2 — load the `.glb` into the bank group (`applyShipModel`, `client/index.html:1289`)
`applyShipModel` removes the placeholder primitives and adds the loaded `pivot`. It must operate on the
**bank group** (where the primitives now live), not the root — otherwise the `.glb` would be added
outside the rolling group and wouldn't bank.

In the `gltfLoader.load(...)` success callback (lines 1307–1316), change the host from `group` to the
bank group:

```javascript
    const pivot = new THREE.Group(); // rotate the centered model without disturbing its centering
    pivot.rotation.y = yaw;
    pivot.add(model);
    const host = group.userData.bankGroup || group; // primitives + model live in the rolling group
    for (let i = host.children.length - 1; i >= 0; i--) { // drop the placeholder primitive
      const c = host.children[i];
      host.remove(c);
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
    host.add(pivot);
```
(Only the three `group.*` references inside this block become `host.*`. Everything above — centering,
scaling, tint — is unchanged and still acts on `model`.)

## Step 3 — a small bank helper (add near `steerToward` / `shortestAngleDelta` in `client/index.html`)
`shortestAngleDelta(from, to)` already exists and handles wrap-around. Use it to get the signed turn this
frame, normalize to `[-1, 1]`, and ease `ship.roll` toward the target. Store the smoothing state on the
ship object.

```javascript
// Cosmetic wing-bank: roll the ship into its turn (capped at BANK_MAX), ease back to level when straight.
// Reads the ACTUAL heading change this frame, so it covers keyboard, touch and AI turning uniformly.
// Does not touch heading/physics. Call once per frame per ship, after heading is updated.
function updateBank(ship, turnRate, dt) {
  const bank = ship.mesh.userData.bankGroup;
  if (!bank) return;
  if (ship._prevHeading === undefined) ship._prevHeading = ship.heading;
  const delta   = shortestAngleDelta(ship._prevHeading, ship.heading); // signed radians turned this frame
  ship._prevHeading = ship.heading;
  const maxStep = (turnRate || 0) * dt;                                 // most it could turn this frame
  const strength = maxStep > 1e-6 ? Math.max(-1, Math.min(1, delta / maxStep)) : 0;
  const target  = -strength * BANK_MAX;                                 // sign: see note below
  if (ship.roll === undefined) ship.roll = 0;
  const k = 1 - Math.exp(-dt / BANK_TAU);                               // frame-rate-independent easing
  ship.roll += (target - ship.roll) * k;
  bank.rotation.z = ship.roll;
}
```
**Sign note:** ship faces `+Z` and the camera looks down. The `-strength` sign makes the ship roll **into**
the turn; if it banks the wrong way during a visual check, flip the sign to `+strength * BANK_MAX`. This is
the one thing to confirm by eye (Step 6).

## Step 4 — call it for the player (`client/index.html`, after line 2129)
The player's heading is finalized by line 2129 (`player.mesh.rotation.y = player.heading;`). Right after
it, add:
```javascript
  updateBank(player, turn, dt); // `turn` = player.turnRate, already in scope at line 2069
```

## Step 5 — call it for each enemy (`client/index.html`, after line 2166)
Each enemy's heading is finalized at line 2166 (`e.mesh.rotation.y = e.heading;`). Right after it, inside
the `for (const e of enemies)` loop, add:
```javascript
    updateBank(e, e.turnRate, dt);
```

That's the whole behavior — no other call sites. Ships built but not yet turning start level
(`roll` defaults to 0); `_prevHeading` seeds itself on first call so there's no startup jolt. The
warp-back doesn't need special handling (heading is continuous through it).

## Edge cases / non-goals (already handled — don't add code for these)
- **Enemy initial random heading** (`heading = Math.random()*2π`, `:1607`): `_prevHeading` seeds to the
  current heading on the first `updateBank` call, so frame 1 produces `delta = 0` → no spurious roll.
- **Spawn-grow + warp-back scale animations** write `mesh.scale` on the **root** group; the bank group is
  a child, so roll and grow compose cleanly — no interaction.
- **`.glb` still loading:** the placeholder primitives are already inside the bank group (Step 1), so they
  bank too; when the model swaps in (Step 2) it lands in the same group and keeps banking. No flicker.
- **Gameplay invariance:** nothing reads `bankGroup.rotation.z`. Aim/forward vectors use `heading`
  (`forwardVec(heading)`), collisions use `mesh.position` — all untouched.
- **No DB / server / asset changes.** Cosmetic, client-only.

## Step 6 — verify (visual)
Run the client and watch a turn: per the headless-render note, `screencapture` is blocked — use the
Playwright render of `client/index.html`. Confirm: (a) holding `A`/`D` rolls the ship smoothly and it
**levels out** when released; (b) the roll **never exceeds ~20°** (eyeball against the wing); (c) it banks
**into** the turn (flip the Step 3 sign if not); (d) enemies bank as they chase. Check both a primitive
fallback ship and a `.glb` ship (e.g. the basic enemy) so Step 2 is exercised.

## Docs to update (required by the project docs workflow)
1. **`docs/SUMMARY.md` → "Visuals" (and/or "Ship model")**: add that **ship visual-model rendering lives
   in `client/index.html`** — `makeShip` (builds the root group + an inner **bank group** holding the
   primitives/`.glb`) and `applyShipModel` (swaps the loaded `.glb` into the bank group, applies
   `modelYaw`), with per-frame heading written as `mesh.rotation.y` in the update loop (player ~`:2129`,
   enemies ~`:2166`). Then document the new behavior: **every ship rolls its wings into a turn, smoothly,
   capped at 20°** (`updateBank` — derived from the per-frame heading delta vs `turnRate*dt`, eased with
   `BANK_TAU`, applied as `bankGroup.rotation.z`; cosmetic only, no gameplay effect). *(This SUMMARY
   "where the visual model is rendered" pointer is an explicitly requested gap-fill.)* Bump `**Updated:**`.
2. **`docs/CHANGELOG.md`**: add a bullet under today's date — **"Ship wing-bank on turn"**: all ships now
   roll up to 20° into their turns (smooth, eases back to level), via a new inner bank group +
   `updateBank`; purely cosmetic, player + enemies.
3. **`docs/DECISIONS.md`**: optional — only if worth recording the "inner bank group vs writing
   `rotation.z` on the root / vs Euler-order risk" trade-off. A one-liner is enough; skip if it feels too
   small.

## Tuning knobs (for the executing agent / future tweaks)
- `BANK_MAX` — the hard cap (spec: 20°, don't exceed).
- `BANK_TAU` — feel: lower (~0.10) = crisper, higher (~0.22) = lazier/floatier. 0.15 is a calm default
  matching "плавный".
- Sign in `updateBank` `target` — into-vs-out-of the turn (confirm visually).
