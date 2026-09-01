// THE ACE: the Sentinel wingman, pointed at you.
//
// The duel room (`client/src/duel-dev.js`, `?duel`) is a sparring arena — you against N ships flying the
// wingman's own pilot code. This is what one of them IS and how it arrives; the flying is `step-ally.js`
// `flySentinel`, unchanged and shared, which is the entire point of the room. A copy of that logic tuned
// separately would make the arena a test of the copy.
//
// AN ACE IS AN ENEMY, and that is the load-bearing decision (DECISIONS). It lives in `world.enemies` like
// every other hostile ship, so it inherits — with no special case anywhere — the player's bullets and
// rockets hitting it, its own shield bubble and health bar, the minimap marker, the death explosion,
// `world.kills`, the level's `allEnemiesDead` win condition and the HUD's killed/total. The ONLY two
// places that had to learn the word "ace" are `stepEnemyAI` (which skips it, because it is not flown by
// the stand-off AI) and `stepAces` below (which flies it).
//
// IT IS WORTH NOTHING. `reward: 0, xp: 0` — a dev sparring room must not pay credits or XP into a real
// account. Its loot roll is NOT suppressed (that would mean a dev branch inside `stepEnemyDeaths`), so a
// kill can still drop a part: fly the duel room on a throwaway local player, the same caveat `?ally`
// carries.
//
// DRAWS NOTHING FROM THE SEEDED STREAM on the way in: the spawn geometry below is derived from the
// player's own position and heading, with no RNG at all — exactly like `spawnAlly` (DECISIONS §73).
import { BULLET_PLANE_Y } from './consts.js';
import { headingToDir } from './steering.js';
import { makeSentinelHull } from './ally.js';
import { flySentinel } from './step-ally.js';
import { ENEMY_FIRE_GRACE } from './step-enemies.js';

// The tag on the entity. `stepEnemyAI` skips a ship carrying it and `stepAces` claims it; nothing else in
// the simulation reads it, so a world with no aces behaves exactly as it did before this file existed.
export const ACE_PILOT = 'ace';

export const ACE_NAME = 'Sentinel duelist';  // the event-log kill line (English — the project's one language)
export const ACE_COLOR = 0xff5a4a;           // MINIMAP dot + the primitive placeholder: hostile red, never the
                                             // player's blue (catalog ships are built `tint: false`, so this
                                             // never reaches the .glb — the wings below do).
export const ACE_ACCENT_COLOR = 0xd93025;    // …and the WING repaint, the wingman's blue livery in red. Same
                                             // `Wings_` materials on the same player hull: no new asset, no
                                             // CREDITS row, no content hash.

export const ACE_COUNT_DEFAULT = 2;   // `?duel` with no number: two of them (the maintainer's ask)
export const ACE_COUNT_MAX = 6;       // …and the ceiling `?duel=N` is clamped to
export const ACE_SPAWN_DIST = 90;     // world units AHEAD of the player's nose — outside the 45 u gun range,
                                      // so the fight opens with a closing run rather than at point-blank
export const ACE_SPAWN_SPREAD = 40;   // lateral gap between two of them at the warp-in

// THE ECHELON, and it is not decoration. Aces are identical ships flown by identical, fully deterministic
// code, so a symmetric arrival makes them one ship with two hulls: measured in the browser, two of them
// held the SAME distance to the player tick for tick for the whole fight, came about together, and fired
// their rockets in the same frame — 2 x 60 power arriving at once, which one-shots the 100 HP starter hull
// the room hands the player. Staggering the arrival by a few units of RANGE and a fraction of a second of
// warp is enough to break the lockstep for good: from then on their passes drift apart on their own.
// Deterministic, and still not one draw from the seeded stream.
export const ACE_SPAWN_STAGGER = 14;   // …each one this much further out than the last
export const ACE_WARP_SEC = 1.0;       // the warp-in grow, same rule everything else gets (DECISIONS §54)
export const ACE_WARP_STAGGER = 0.35;  // …and this much slower to form, so they do not enter the fight together

// One ace's numbers. The wingman's hull, gear and gun (`makeSentinelHull`) with a hostile identity bolted
// on: the fields `stepEnemyDeaths`, the loot roll and the kill line read off an enemy.
export function makeAce(catalog) {
  const e = makeSentinelHull(catalog);
  if (!e) return null;
  e.pilot = ACE_PILOT;
  e.name = ACE_NAME;
  e.color = ACE_COLOR;
  e.accent = { color: ACE_ACCENT_COLOR, prefix: 'Wings_' }; // read by the host when it attaches a body
  e.reward = 0; e.xp = 0;   // a sparring partner pays nothing — see the header
  return e;
}

// Arrive. Called from the level runner when a phase carries `aces: N`.
//
// They warp in ahead of the player's nose and facing him — the mirror of `spawnAlly`, which puts the
// wingman astern — spread sideways and ECHELONED in range and in warp time (see the constants above; that
// stagger is what stops two identical pilots flying as one). Deterministic and RNG-free: the whole
// placement is the player's own transform plus those constants, so a duel opens the same way every time
// and the seeded stream is untouched.
export function spawnAces(world, count) {
  const n = Math.max(1, Math.min(ACE_COUNT_MAX, count | 0));
  const p = world.player;
  const d = headingToDir(p.heading);
  const rx = d.z, rz = -d.x;   // the nose's right-hand perpendicular, in the plane
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = makeAce(world.catalog);
    if (!e) break;
    const lateral = (i - (n - 1) / 2) * ACE_SPAWN_SPREAD;
    const ahead = ACE_SPAWN_DIST + i * ACE_SPAWN_STAGGER;
    const x = p.pos.x + d.x * ahead + rx * lateral;
    const z = p.pos.z + d.z * ahead + rz * lateral;
    e.pos.set(x, BULLET_PLANE_Y, z);
    e.heading = Math.atan2(p.pos.x - x, p.pos.z - z);   // nose on the player from the first frame
    e.spawnAge = 0; e.spawnDur = ACE_WARP_SEC + i * ACE_WARP_STAGGER;
    e.warping = true; e.scale = e.fullScale * 0.001;
    world.enemies.push(e);
    world.host.onSpawn('enemy', e);
    out.push(e);
  }
  return out;
}

// Every ace's half of a tick. Returns at once in a fight that has none, which is every level that ships —
// the scan is over `world.enemies`, so nothing new is allocated or stored to keep it cheap.
//
// The ctx is the wingman's, mirrored: he charges the PLAYER (and any wingman the player brought), he has no
// friend to hold fire for, and he obeys the same opening `ENEMY_FIRE_GRACE` every other hostile ship does —
// a duel that opens under fire before the ship has moved is not the fight being tested.
export function stepAces(world, dt) {
  let foes = null;   // built once per tick, and only when there is an ace to fly
  for (const e of world.enemies) {
    if (e.pilot !== ACE_PILOT) continue;
    if (!foes) foes = hostileFoes(world);
    flySentinel(world, e, dt, {
      foes, friend: null, side: 'enemy', leash: Infinity,
      canFire: world.combatElapsed >= ENEMY_FIRE_GRACE,
    });
  }
}

// Who an ace may charge: the player and any live wingman. The same set `nearestHostileTarget` scans for a
// normal enemy — as an ARRAY, because `flySentinel` needs to search, aim at and re-pick within it rather
// than be handed one answer.
export function hostileFoes(world) {
  const foes = [];
  if (world.player && world.player.alive) foes.push(world.player);
  for (const a of world.allies) if (a.alive) foes.push(a);
  return foes;
}
