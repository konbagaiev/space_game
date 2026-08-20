// Loot drops: the simulation half.
//
// A drop is a position, an item and a weight; the Grab (tractor) pulls the nearest ARMED one toward the
// ship along an inverse-square field, and collects it on contact. All of that is gameplay. The crate model,
// its slow rotation, the blue pull line and the pickup blip are not — they belong to the host, which is why
// `drops.js` keeps them and this file keeps the decisions.
//
// The reach is EMERGENT, not a stored radius: a drop is eligible while the field crosses `FIELD_CUTOFF`,
// which is weight-independent, and the pull speed then ramps with distance and weight (drops-config.js).
//
// See docs/plans/server-authoritative-sim.md (Slice B3c).
import { Vec3 } from './vec.js';
import { ARM_DELAY, COLLECT_DIST, FIELD_CUTOFF, MAX_DROPS, WEIGHT_FALLBACK,
         field, pullSpeed, shouldDeposit, rewardOwned } from './drops-config.js';

// Does the player already have this reward? A level's last-kill drop appears only if not — there is
// exactly one copy of it, ever. Pure; the account record lives on the World.
export function ownsReward(world, reward) { return rewardOwned(world.activeShip, reward); }

// A drop's data. `special` marks the cosmetic reward drop, which deposits NOTHING when collected — the real
// copy is server-installed on victory, so there is exactly one of it.
export function makeDrop(pos, item, weight, special = false) {
  return {
    pos: new Vec3(pos.x, 0.8, pos.z), // drops float slightly above the combat plane
    item,
    weight: weight || WEIGHT_FALLBACK,
    inRange: 0,   // seconds continuously inside the grab field — arms the pull at ARM_DELAY
    special,
    alive: true,
  };
}

// Add a drop to the World and ask the host for a body. Returns null when the arena is already at its cap.
export function spawnDrop(world, pos, item, weight, special = false) {
  if (!item) return null;
  if (world.drops.length >= MAX_DROPS) return null; // perf guard: a hard ceiling on simultaneous crates
  const d = makeDrop(pos, item, weight, special);
  world.drops.push(d);
  world.host.onSpawn('drop', d);
  return d;
}

// Advance the Grab: arm timers, pick the nearest eligible drop, pull it, collect on contact.
// Returns the drop currently being pulled (so the host can draw its beam) or null.
//
// Emits `pickup` on a collect; the collected item is pushed onto `world.pendingLoot`, which the victory
// path drains. Inert with no grab component or a dead player — the feature simply does not exist then.
export function stepDrops(world, dt) {
  const p = world.player, grab = p && p.grab;
  if (!p || !p.alive || !grab) return null;

  let target = null, best = Infinity;
  for (const d of world.drops) {
    const dist = Math.hypot(d.pos.x - p.pos.x, d.pos.y - p.pos.y, d.pos.z - p.pos.z);
    if (field(grab.strength, dist) >= FIELD_CUTOFF) {
      d.inRange += dt;
      if (d.inRange >= ARM_DELAY && dist < best) { best = dist; target = d; }
    } else d.inRange = 0;
  }
  if (!target) return null;

  const to = new Vec3(p.pos.x - target.pos.x, p.pos.y - target.pos.y, p.pos.z - target.pos.z);
  const dist = to.length();
  if (dist <= COLLECT_DIST) { collect(world, target); return null; } // arrived → collect, re-target next tick
  target.pos.addScaledVector(to.normalize(), Math.min(pullSpeed(target.weight, dist) * dt, dist));
  return target;
}

function collect(world, d) {
  const i = world.drops.indexOf(d);
  if (i < 0) return;
  d.alive = false;
  world.host.onDespawn('drop', d);
  world.drops.splice(i, 1);
  if (shouldDeposit(d)) world.pendingLoot.push(d.item);
  world.events.emit({ type: 'pickup', item: d.item });
}

// Hand the run's collected loot to the caller (the victory deposit), clearing it.
export function takeLoot(world) {
  const l = world.pendingLoot.slice();
  world.pendingLoot.length = 0;
  return l;
}

// Drop everything: bodies released, and any uncollected loot DISCARDED (a fresh run keeps nothing).
export function clearDrops(world) {
  for (const d of world.drops) { d.alive = false; world.host.onDespawn('drop', d); }
  world.drops.length = 0;
  world.pendingLoot.length = 0;
}
