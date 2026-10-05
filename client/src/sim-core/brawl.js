// THE BOT BRAWL (`?brawl`): two teams of Sentinel bots fighting each other over the home station, for a
// repeatable phone load test (docs/plans/2026-10-04-2001-bot-brawl-load-test.md, DECISIONS §157).
//
// Pure and Three-free, so Node can run the whole fight (`brawl.test.js`). The browser half — the setup
// panel, the camera, the frame stats and the result card — is `client/src/brawl-host.js`.
//
// WHAT IT IS, in the sim's own terms:
//   • BLUE is `world.allies` (`makeAlly`, side 'ally'); RED is `world.enemies` (`makeAce`, side 'enemy').
//     The two-sided damage model already does the rest: friendly fire is off both ways, ally-side shots
//     damage only `world.enemies`, hostile shots damage only the player and the allies.
//   • Every bot is flown by `flySentinel` — the same pilot as the wingman and the duel aces — with ctx
//     `{ foes: <the other list>, friend: null, anchor: <the station>, side, leash: BRAWL_FIGHT_LEASH,
//     canFire: true }` — the anchor keeps the melee over the station (see BRAWL_FIGHT_LEASH). The pilot's human
//     error and his reload stagger are his own (SENTINEL_PILOT, DECISIONS §156), so the two teams are
//     literally identical pilots and the fight is symmetric with no brawl-only switch.
//   • THE SPECTATOR is the real player ship, ALIVE, parked `BRAWL_SPECTATOR_PARK` u east of the fight and
//     never stepped. Alive matters: `flySentinel` step 3 winds every pilot down when the player is dead.
//   • DEATHS ONLY DRIVE THE VISUALS. Blue goes through `stepAllyDeaths`; red through `stepBrawlRedDeaths`
//     below, which emits the same `allyDown` event. `stepEnemyDeaths` is never called, so there is no loot
//     roll, no kills/credits/XP, no drop and no shared draw.
//   • DETERMINISM: after `seedSim(BRAWL_SEED)` a brawl takes ZERO draws from the shared stream; each pilot's
//     aim and reload streams are private and keyed to that seed and his ordinal (blue 1+2i, red 2+2i). The
//     same JS engine therefore simulates the same fight tick for tick. Different engines (V8 vs
//     JavaScriptCore) are NOT promised to agree (§151).
import { makeAlly } from './ally.js';
import { makeAce } from './ace.js';
import { flySentinel, stepAllyDeaths, clearAimTarget } from './step-ally.js';
import { stepBullets, stepRockets } from './step-projectiles.js';
import { despawnAt } from './spawn.js';
import { ANCHORS } from './system-map.js';
import { SIM_DT, TICK_HZ, BULLET_PLANE_Y } from './consts.js';

export const BRAWL_SEED = 20261004;
export const BRAWL_N_MIN = 1;
export const BRAWL_N_MAX = 50;
export const BRAWL_N_DEFAULT = 20;
// Fought over the HOME STATION: the worst-case frame is the station plus the bots.
export const BRAWL_CENTER = ANCHORS.base;
export const BRAWL_FRONT_GAP = 60;      // each team's front rank sits this far from the centre
export const BRAWL_COLS = 5;            // ships per rank
export const BRAWL_SPACING = 12;        // lateral and rank spacing inside a team's grid
export const BRAWL_SPECTATOR_PARK = 5000; // the (alive, never stepped) player ship is parked this far east
export const BRAWL_WINDOW_TICKS = 10 * TICK_HZ; // one stats/fingerprint window = 10 sim-seconds
// The camera's centre-mode target is clamped to this radius around the station, which keeps the station's
// centre inside the frame in every direction (the projection table in the plan's §Placement).
export const BRAWL_CAM_LEASH = 55;
// THE FIGHT IS KEPT OVER THE STATION (maintainer, 2026-10-05). Each pilot is handed the station as his
// ANCHOR (a `flySentinel` ctx value): he only picks foes within `BRAWL_FIGHT_LEASH` of it, and with nothing
// to fight he flies back to it. On top of that the brawl DROPS a pilot's target the moment it is beyond the
// leash, because a pilot otherwise keeps his target through a whole pass and chases a fleeing (retreating)
// ship to the arena edge, dragging the melee with him. MEASURED (headless, camera-frustum equivalent,
// DECISIONS §157), 20v20: the fighting centroid within 55 u of the station 87 % of ticks (12 % before),
// within 100 u 100 % (25 %); ships in frame ~5-7 per window from 30 s on, where it was 0. 100 beat 60-80
// (a tighter ring packs both teams onto the station point and the rocket blasts wipe them out together;
// at 40 the whole 20v20 died in 5.6 s) and 120 (the centroid drifts out to a 54 u median).
// NO STALL FALLBACK IS NEEDED: the anchor is SHARED, so every pilot with nothing to fight flies to the same
// point and finds the other side there; one outside the leash is either retreating (it rejoins at 40 % hull)
// or on its way back.
export const BRAWL_FIGHT_LEASH = 100;

const clampN = (n) => Math.max(BRAWL_N_MIN, Math.min(BRAWL_N_MAX, (n | 0) || BRAWL_N_MIN));

// The level the brawl is fought on: the descriptor it is built over, emptied of every campaign promise.
// Non-mutating, like `withDuelRoom`. `center` puts `world.arenaCenter` on the station, so the pilot's
// retreat-to-the-edge rule is measured from the brawl; the single inert phase spawns nothing.
export function withBrawlRoom(descriptor) {
  if (!descriptor) return descriptor;
  return {
    ...descriptor,
    title: 'Bot brawl',
    xpReward: 0,
    enemyTotal: 0,
    finalStageBanner: false,
    briefing: undefined, lastKillDrop: undefined, introTrace: undefined, intro: undefined,
    center: { x: BRAWL_CENTER.x, z: BRAWL_CENTER.z },
    phases: [{ name: 'brawl' }],
  };
}

function warpIn(s) {
  s.spawnAge = 0; s.spawnDur = 1; s.warping = true; s.scale = s.fullScale * 0.001;
}

// Lay the two teams out and park the spectator. The ONLY place `world.brawl` is set. Draws no randomness.
export function spawnBrawl(world, n) {
  n = clampN(n);
  const C = BRAWL_CENTER, Y = BULLET_PLANE_Y;
  const p = world.player;
  if (p) { p.pos.set(C.x + BRAWL_SPECTATOR_PARK, Y, C.z); p.vel.set(0, 0, 0); }
  const cat = world.catalog;
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / BRAWL_COLS), col = i % BRAWL_COLS;
    const lat = (col - (BRAWL_COLS - 1) / 2) * BRAWL_SPACING + (row % 2) * (BRAWL_SPACING / 2);
    const depth = row * BRAWL_SPACING;
    const a = makeAlly(cat);
    a._aimOrdinal = 1 + 2 * i;
    a.pos.set(C.x - BRAWL_FRONT_GAP - depth, Y, C.z + lat);
    a.heading = Math.PI / 2;                 // facing +X, at red
    warpIn(a);
    world.allies.push(a);
    world.host.onSpawn('ally', a);
    const e = makeAce(cat, 2 + 2 * i);
    e.pos.set(C.x + BRAWL_FRONT_GAP + depth, Y, C.z - lat);
    e.heading = -Math.PI / 2;                // facing −X, at blue
    warpIn(e);
    world.enemies.push(e);
    world.host.onSpawn('enemy', e);
  }
  world.brawl = { n, armed: false, ended: false, ticks: 0, killsByBlue: 0, killsByRed: 0, fingerprint: [],
                  leash: BRAWL_FIGHT_LEASH };
  return world.brawl;
}

// A red bot dies: the same `allyDown` FX event blue's death path emits, and nothing else — no loot roll,
// no kill, no credits. Returns how many were removed.
export function stepBrawlRedDeaths(world) {
  let removed = 0;
  const list = world.enemies;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e.hp > 0) continue;
    world.events.emit({
      type: 'allyDown', pos: e.pos.clone(),
      exhaustColor: e.engine && e.engine.exhaust ? e.engine.exhaust.color : e.color,
      sizeScale: e.sizeScale || 1, shipClass: e.class, weightClass: e.weightClass ?? null,
    });
    despawnAt(world, 'enemy', list, i);
    removed++;
  }
  return removed;
}

// The pilots' anchor: a fixed point at the home station (never a ship — `friend` stays null, so neither
// the §2.6 tracer gate nor point defence treats a point in space as something to protect).
const STATION_ANCHOR = Object.freeze({ pos: Object.freeze({ x: BRAWL_CENTER.x, y: BULLET_PLANE_Y, z: BRAWL_CENTER.z }),
                                       vel: Object.freeze({ x: 0, y: 0, z: 0 }), alive: true });
const outside = (s, L) => Math.hypot(s.pos.x - BRAWL_CENTER.x, s.pos.z - BRAWL_CENTER.z) > L;

// One brawl tick. Inert until the host arms it, and again once it has ended. Returns null (no grab target).
export function brawlTick(world, dt) {
  const b = world.brawl;
  if (!b || !b.armed || b.ended) return null;
  // A wiped-out side stops the clock HERE, on the tick it happened, not when the host next looks: the host
  // only checks once per frame, and up to six ticks (or a `stepSim` chunk) can run in between, which would
  // make "sim-seconds reached" depend on the frame rate.
  if (brawlOver(world)) return null;
  world.combatElapsed += dt;
  const L = b.leash;
  // A target that has left the leash is dropped (and the aim history with it, so the next pick is a fresh
  // acquisition): the pilot re-picks inside the leash, or flies back to the station.
  for (const list of [world.allies, world.enemies]) for (const s of list) {
    if (s.target && outside(s.target, L)) { s.target = null; s.passArmed = false; clearAimTarget(s); }
  }
  for (const a of world.allies) flySentinel(world, a, dt, { foes: world.enemies, friend: null, anchor: STATION_ANCHOR, side: 'ally', leash: L, canFire: true });
  for (const e of world.enemies) flySentinel(world, e, dt, { foes: world.allies, friend: null, anchor: STATION_ANCHOR, side: 'enemy', leash: L, canFire: true });
  stepBullets(world, dt);
  stepRockets(world, dt);
  b.killsByBlue += stepBrawlRedDeaths(world);
  const before = world.allies.length;
  stepAllyDeaths(world);
  b.killsByRed += before - world.allies.length;
  b.ticks++;
  if (b.ticks % BRAWL_WINDOW_TICKS === 0) b.fingerprint.push([b.ticks / TICK_HZ, world.allies.length, world.enemies.length]);
  return null;
}

export const brawlOver = (world) => !world.allies.length || !world.enemies.length;
export const brawlSimSec = (world) => (world.brawl ? world.brawl.ticks * SIM_DT : 0);

// Where the centre-mode camera looks: the mean of the living ships that are neither retreating nor warping
// (falling back to every living ship, then to the station), clamped to `BRAWL_CAM_LEASH` around the station.
// Writes x/z into `out` and returns it.
export function brawlViewCentre(world, out) {
  const ships = [...world.allies, ...world.enemies].filter((s) => s.alive !== false);
  let use = ships.filter((s) => !s.retreating && !s.warping);
  if (!use.length) use = ships;
  let x = BRAWL_CENTER.x, z = BRAWL_CENTER.z;
  if (use.length) {
    x = 0; z = 0;
    for (const s of use) { x += s.pos.x; z += s.pos.z; }
    x /= use.length; z /= use.length;
  }
  const dx = x - BRAWL_CENTER.x, dz = z - BRAWL_CENTER.z, d = Math.hypot(dx, dz);
  if (d > BRAWL_CAM_LEASH) { x = BRAWL_CENTER.x + dx * (BRAWL_CAM_LEASH / d); z = BRAWL_CENTER.z + dz * (BRAWL_CAM_LEASH / d); }
  out.x = x; out.z = z;
  return out;
}

// Tap handling: centre + a picked ship → follow it; centre + nothing picked → stay; following + any tap →
// back to centre.
export function nextCameraMode(mode, pickedId) {
  if (mode && mode.kind === 'bot') return { kind: 'centre' };
  return pickedId != null ? { kind: 'bot', id: pickedId } : { kind: 'centre' };
}
