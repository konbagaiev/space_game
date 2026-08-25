// The charged beam: a shot that takes time, has no projectile, and announces itself before it lands.
//
// THE RULE, in one sentence: at RELEASE, the beam hits the target it painted at charge start if ANY PART of
// that target is still between the two drawn corridor edges — otherwise it hits whatever is in the corridor
// at that instant (the nearest), otherwise nothing.
//
// Why a CORRIDOR and not a lock (DECISIONS §135; the argument is the maintainer's):
//   • A bare lock guarantees the hit, which is the mechanic §124 deleted wearing a hat.
//   • A bare nose-line misses every circling enemy, and enemies circle constantly.
//   • The corridor is the middle, and it is ESCAPABLE BY MANOEUVRE — the thing the player controls. It is
//     also drawn, for the whole second it charges, which is what makes it not the invisible aim-assist
//     §124 cut: §124 removed a cone that silently REDIRECTED a shot; this corridor never moves the shot.
//
// Why the corridor is attached to the NOSE AT RELEASE rather than frozen at charge start: so the three lines
// drawn on screen are exactly the hit test. They are glued to the hull, they rotate with it, and what the
// player sees is what the simulation will do. Turning away breaks the shot (a ~1 rad/s turn sweeps ~57° in
// the 1.0 s charge, against a corridor only ±2° wide); turning TOWARD the target tracks it and keeps the
// hit. That makes turn rate the beam's skill stat — and the player out-turns every enemy in the game. At
// 1.0 s every target drifts twice as far as it did at the original 0.5 s, so ACTIVE tracking is mandatory
// rather than optional: even a 5 u/s crosser escapes at close range.
//
// EVERY NUMBER COMES OFF THE WEAPON ROW, never a module-level object: `maxRange`, `chargeTime`,
// `corridorDeg`, `power` and `fireCooldown` are read per-mount, so two ships can carry differently-tuned
// beams. (The throwaway spike shared one mutable `beamTuning` so a slider could move it mid-fight; that was
// the spike's one real cheat and it dies here.)
//
// SIDE-AGNOSTIC BY CONSTRUCTION. Nothing below asks whether the shooter is the player: `side` selects who
// the hostiles are and which damage router runs, exactly as `step-projectiles` does. No ship in the shipped
// catalog carries a beam today — it is a player purchase — but arming an ally or a pirate is a catalog edit,
// not a change here. (Rendering a HOSTILE's corridor is deferred and gated; see the plan's §2d.)
//
// RNG: none. This module never calls simRandom(), so a ship carrying a beam consumes no gameplay randomness
// and every recorded trace stays bit-identical (DECISIONS §73).
import { Vec3 } from './vec.js';
import { shortestAngleDelta } from './steering.js';
import { segmentHitsShip, resolveHostileBulletHit, broadRadius } from './collision.js';
import { applyShieldedDamage } from './components.js';

const DEG = Math.PI / 180;
const DEFAULT_CORRIDOR_DEG = 2;
const DEFAULT_CHARGE_TIME = 0.5;

// Scratch. The read-only queries (`beamCandidate` / `inCorridor` / `corridorEnds`) share one set; the
// discharge keeps its OWN pair, because it calls those queries and would otherwise be reading vectors they
// had just rewritten.
const _muzzle = new Vec3();
const _endC = new Vec3();
const _endL = new Vec3();
const _endR = new Vec3();
const _shotFrom = new Vec3();
const _shotTo = new Vec3();
const _through = new Vec3();

// ---------- the group ----------

// Is this fire group a beam group? `some`, not `mounts[0]`: a group that holds a beam ANYWHERE must take
// the beam path, never fall through to the bullet path with the beam mount silently along for the ride.
// (`catalog_beam.test.js` asserts no seeded ship authors a mixed group in the first place, which is what
// keeps `fireMount` from ever seeing a beam.)
export const isBeamGroup = (g) => (g.mounts || []).some((m) => m.weapon && m.weapon.type === 'beam');

// The beam group a ship carries, if any — what the renderer asks for to know whether to draw a sight.
export function beamGroupOf(ship) {
  if (!ship || !ship.groups) return null;
  for (const g of Object.values(ship.groups)) if (isBeamGroup(g)) return g;
  return null;
}

// The beam weapon inside a beam group — the row every number below is read from.
export const beamWeaponOf = (g) => {
  const m = (g.mounts || []).find((x) => x.weapon && x.weapon.type === 'beam');
  return m ? m.weapon : null;
};

// The corridor's HALF-angle in radians, from the weapon row.
export const corridorRadOf = (w) => ((w && w.corridorDeg != null ? w.corridorDeg : DEFAULT_CORRIDOR_DEG) * DEG);
// How long this weapon charges for, from the weapon row.
export const chargeTimeOf = (w) => (w && w.chargeTime != null ? w.chargeTime : DEFAULT_CHARGE_TIME);

// ---------- geometry ----------

// The heading that points from `pos` at `ship` — the same convention as forwardVec/touchAim: atan2(dx, dz).
export function bearingTo(pos, ship) {
  return Math.atan2(ship.pos.x - pos.x, ship.pos.z - pos.z);
}

// A ship's muzzle: its nose, in world space. Same derivation fireMount uses, so the beam leaves where the
// bullets leave. Writes into `out` (a reused scratch Vec3 on the hot paths).
export function beamMuzzle(ship, fwd, out = new Vec3()) {
  const sc = ship.scale || 1;
  return out.copy(ship.pos).addScaledVector(fwd, (ship.noseZ ?? 1.6) * sc);
}

// THE THREE DRAWN ENDPOINTS — centre, left edge, right edge — all from the muzzle, at `range`.
//
// ONE definition, used by the hit test, by the renderer and by the tests. That is the point of it living
// here: the picture on screen cannot drift from the rule, because they are the same three points.
export function corridorEnds(ship, fwd, range, halfRad, outC, outL, outR) {
  beamMuzzle(ship, fwd, outC);
  const mx = outC.x, my = outC.y, mz = outC.z;
  outC.set(mx + fwd.x * range, my, mz + fwd.z * range);
  for (const [out, a] of [[outL, ship.heading + halfRad], [outR, ship.heading - halfRad]]) {
    out.set(mx + Math.sin(a) * range, my, mz + Math.cos(a) * range);
  }
  return outC;
}

// Does the corridor around the ship's CURRENT nose REACH this target's hull?
//
// HULL-AWARE ON PURPOSE, and this is the SAME predicate the reticle, the charge-start lock and the release
// all use — so what is painted is exactly what can be hit. At ±2° the corridor is NARROWER THAN A SHIP at
// most ranges (half-width 0.70 u at 20 u, 1.57 u at 45 u, 3.14 u at 90 u, against a hull roughly 2 u
// across), so a centre-based test would mark a target the shot then misses inside ~60 u — the reticle would
// lie, which is the one thing the three drawn lines promise not to do. It also widens the effective window
// from ±2° to ~3.3°, which is what keeps the weapon honest against the ~1.0° of staleness a 100 ms
// interpolation delay costs at 90 u (DECISIONS §127) without a rewind.
//
// EXHAUSTIVE for a convex wedge: a hull overlapping it either crosses the centre line, or crosses one of
// the two edge lines, or lies WHOLLY between them — and in that last case its centre bearing is inside the
// half-angle. Each of the first three cases is literally "one of the drawn lines touches the hull".
export function inCorridor(ship, fwd, target, range, halfRad) {
  if (!target || !target.alive || target.warping) return false;
  corridorEnds(ship, fwd, range, halfRad, _endC, _endL, _endR);
  beamMuzzle(ship, fwd, _muzzle);
  const dx = target.pos.x - _muzzle.x, dz = target.pos.z - _muzzle.z;
  // Range is measured to the hull, not to the centre, for the same reason the angle is.
  if (Math.hypot(dx, dz) > range + broadRadius(target)) return false;
  if (segmentHitsShip(target, _muzzle, _endC)) return true;
  if (segmentHitsShip(target, _muzzle, _endL)) return true;
  if (segmentHitsShip(target, _muzzle, _endR)) return true;
  // The wedge's apex is the MUZZLE, which is where all three lines are drawn from — so the bearing is
  // measured from there too, not from ship.pos. The difference is ≤0.2°, but "the drawn lines are the hit
  // test" is a promise made literally, and mixing two apexes would break it on paper.
  return Math.abs(shortestAngleDelta(ship.heading, Math.atan2(dx, dz))) <= halfRad;
}

// Who this shooter may hit. Mirrors step-projectiles: a friendly beam scans the enemies, a hostile beam
// scans the player and then every ally in list order. Deterministic, and allocation-free for the common
// (friendly) case.
export function beamHostiles(world, side) {
  if (side !== 'enemy') return world.enemies;
  const out = [];
  if (world.player && world.player.alive) out.push(world.player);
  for (const a of world.allies) if (a.alive) out.push(a);
  return out;
}

// WHAT THE CORRIDOR IS TOUCHING right now — the reticle's target, the target a charge locks, and the
// fallback at release. All three ask this ONE function, so paint ≡ corridor ≡ hit.
//
// Nearest first (muzzle→centre), ties broken by list order: the beam stops at the first hull. Pure — no
// RNG, no scene graph, no mutation.
export function beamCandidate(world, ship, fwd, side, range, halfRad) {
  let best = null, bestD = Infinity;
  for (const t of beamHostiles(world, side)) {
    if (!inCorridor(ship, fwd, t, range, halfRad)) continue;
    // inCorridor rewrote the shared scratch, so re-derive the muzzle rather than caching it across the loop.
    beamMuzzle(ship, fwd, _muzzle);
    const d = Math.hypot(t.pos.x - _muzzle.x, t.pos.z - _muzzle.z);
    if (d < bestD) { best = t; bestD = d; }
  }
  return best;
}

// ---------- the tick ----------

// One beam group's tick. Replaces the volley/cooldown machinery for beam-typed groups only; every other
// group goes down `updateGroups`' original path untouched.
//
// THE TRIGGER IS A TAP THAT COMMITS. Releasing fire mid-charge does NOT cancel: a charge, once begun, always
// discharges. Three reasons, and they all point the same way — touch has a fire BUTTON rather than a held
// key, so "keep holding" is not a thing every device can express (a rule that only exists on desktop is not
// a rule); an AI's `wantsFire` is a per-tick predicate that flickers as it steers; and it means there is no
// "charge spoiled" state to invent, put on the wire, or reconcile between hosts. Nothing interrupts a charge
// — not damage, not the locked target dying. The corridor test at release IS the rule.
export function updateBeamGroup(world, ship, g, fwd, side, dt, wantsFire) {
  const w = beamWeaponOf(g);
  if (!w) return;
  const range = w.maxRange;
  const halfRad = corridorRadOf(w);
  const chargeTime = chargeTimeOf(w);

  g.cooldown -= dt;
  if (g.charge) {
    g.charge.t += dt;
    // A lock whose ship died or warped out mid-charge simply stops being a lock; the charge still fires and
    // falls back to whatever the corridor holds at release. (The shot is committed — see the note above.)
    if (g.charge.lock && (!g.charge.lock.alive || g.charge.lock.warping)) g.charge.lock = null;
    if (g.charge.t >= chargeTime) {
      fireBeam(world, ship, g, fwd, side, w, range, halfRad);
      g.charge = null;
      g.cooldown = g.reload;   // buildGroups already set `reload` to the mount's fireCooldown
    }
    return;
  }
  if (g.cooldown <= 0 && wantsFire(g)) {
    g.charge = { t: 0, lock: beamCandidate(world, ship, fwd, side, range, halfRad) };
    beamMuzzle(ship, fwd, _muzzle);
    world.events.emit({
      // `weaponClass` rides along for the same reason `beamFire` carries it: the swell is routed through
      // SOUND_MAP by (weapon, class, 'charge'), so a SECOND beam row with its own class must get its own
      // charge sample rather than the first one's. Cheap now, and it removes the only place the adapter
      // would otherwise have had to hardcode 'beam'.
      //
      // `ship` is the SHOOTER, and it is an entity REFERENCE rather than a value — the one exception the
      // event catalogue names, alongside `enemyShieldHit`'s. The wire turns it into a network id and back
      // (`EVENT_ENTITY_REFS`, sim-core/events.js), because a remote client never ticks that ship's fire
      // group and so cannot derive its corridor from anything it holds. Side-agnostic: the renderer, not
      // the simulation, decides whose sight this becomes. Still two events per shot.
      type: 'beamCharge', ship, pos: _muzzle.clone(), dur: chargeTime, weaponClass: w.class,
      fromPlayer: side === 'player',
    });
  }
}

// Discharge. Resolves the hit, applies the damage, and emits the one event the renderer needs to draw a
// beam from A to B. Attribution follows DECISIONS §134 exactly: the damage router is two-sided (friendly /
// hostile) and `lastHitBy` is the one field that separates the two friendlies for credit and XP.
function fireBeam(world, ship, g, fwd, side, w, range, halfRad) {
  const friendly = side !== 'enemy';

  // The locked target if it is still in the corridor; otherwise whatever the corridor holds right now.
  // The fallback is what keeps a beam fired at nothing honest — it is a real shot down a real corridor.
  // (Resolved BEFORE the muzzle is taken: both helpers write the query scratch.)
  const target = g.charge && inCorridor(ship, fwd, g.charge.lock, range, halfRad)
    ? g.charge.lock
    : beamCandidate(world, ship, fwd, side, range, halfRad);

  beamMuzzle(ship, fwd, _shotFrom);
  // The DRAWN beam stops at the hull it struck (or on the shield bubble — see below), or runs the full
  // range into empty space.
  if (target) _shotTo.copy(target.pos);
  else _shotTo.copy(_shotFrom).addScaledVector(fwd, range);

  let hit = false, absorbed = false;
  if (target) {
    if (friendly) {
      target.lastHitBy = side === 'ally' ? 'ally' : 'player';  // WHO gets paid (combat-ally.md §2.5)
      const dr = applyShieldedDamage(target, w.power);
      if (dr.absorbed) {
        absorbed = true;
        world.events.emit({ type: 'enemyShieldHit', enemy: target, pos: _shotTo.clone(), broke: dr.broke });
      }
      hit = true;
      world.events.emit({ type: 'hit', target: 'enemy' });
    } else {
      // A hostile beam routes through the SAME shield-then-hull resolver a hostile bullet uses (§76), so the
      // shield catches it on the bubble and the impact lands on the sphere rather than the hull inside it.
      //
      // NO DODGE ROLL — `null` on purpose (DECISIONS §135). Not for determinism (a beam dodge would draw
      // nothing in any archived trace): the CORRIDOR IS THE DODGE. The weapon stays RNG-free and the drawn
      // lines never lie — if the corridor showed a hit, you took a hit.
      //
      // The `to` handed to the resolver is extended ONE BROAD RADIUS PAST the hull centre, not stopped at
      // it: the resolver re-tests the segment itself, and a segment ending exactly at the centre can miss a
      // modeled ship whose origin falls in a gap between its OBBs — the corridor would say hit and the
      // damage would silently not land. Sweeping through also passes cleanly through the shield sphere.
      const bx = _shotTo.x - _shotFrom.x, bz = _shotTo.z - _shotFrom.z;
      const bl = Math.hypot(bx, bz) || 1;
      const over = broadRadius(target);
      _through.set(_shotTo.x + (bx / bl) * over, _shotTo.y, _shotTo.z + (bz / bl) * over);
      const res = resolveHostileBulletHit(target, _shotFrom, _through, w.power, null);
      if (res.hit) {
        hit = true;
        // The DRAWN endpoint stays on the hull or on the bubble — the player must not see the beam come out
        // the far side of what it struck.
        if (res.impact) _shotTo.copy(res.impact);
        if (res.damageResult && res.damageResult.absorbed) {
          absorbed = true;
          const isPlayer = target === world.player;
          world.events.emit(isPlayer
            ? { type: 'shieldHit', pos: _shotTo.clone(), broke: res.damageResult.broke }
            : { type: 'enemyShieldHit', enemy: target, pos: _shotTo.clone(), broke: res.damageResult.broke });
        }
        world.events.emit({ type: 'hit', target: target === world.player ? 'player' : 'ally', shipClass: target.class });
      }
    }
  }

  world.events.emit({
    type: 'beamFire',
    from: _shotFrom.clone(), to: _shotTo.clone(),
    hit, absorbed,
    weaponClass: w.class,
    fromPlayer: side === 'player',   // the EVENT means "your own shot" (§134's split) — the ally's is silent
  });
}
