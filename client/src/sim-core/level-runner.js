// The level runner: plays a DB level descriptor (an ordered phase/wave script).
//
// Each phase optionally spawns a weighted pool up to `maxConcurrent` (with an optional `total` cap), and
// advances when its condition is met: { kills } (cumulative), { killsSincePhase }, or { allCleared } (map
// empty AND the phase's total fully spawned). A phase with `event: 'win'` ends the level — not with a
// victory overlay, but by opening the return-to-base gate; the mission is won when the player DOCKS.
// The boss phase pool is the boss only, after clear-out empties the arena → the boss always appears alone.
//
// It used to be one object literal in `sim.js` holding its own mutable fields. The fields now live on the
// World (`world.levelRunner`) and the functions take the World, because a server runs many fights in one
// process and a module-level singleton can only run one. `sim.js` keeps an object of the same name whose
// properties proxy onto these fields, so every existing reader — `main.js`, `mainwindow.js`, `settings.js`,
// `account.js`, `replay.js` and three visual scenarios — is unchanged.
//
// See docs/plans/server-authoritative-sim.md (Slice B3d).
import { stepSpawnGate } from './spawn-timing.js';
import { simRandom } from './sim-random.js';
import { spawnEnemy } from './ship-entity.js';
import { canDock } from './autopilot-config.js';
import { showBanner, clearBanner } from './events.js';

// The runner's mutable state for one fight. Lives on the World (see world.js).
export function createLevelRunnerState() {
  return {
    level: null,            // the active level descriptor (null while roaming → update() does nothing)
    phaseIndex: 0,
    killsAtPhaseStart: 0,
    spawnedThisPhase: 0,
    spawnCooldown: 0,
    won: false,
    winPending: 0,          // seconds left before the win phase opens the return-to-base gate
    winText: '',            // English fallback for the victory line
    winTextKey: undefined,  // i18n key for the victory line (resolved by the client adapter)
    returningToBase: false,
  };
}

// Reset the runner's per-run flags + the shared return-to-base/autopilot/banner state. Extracted from
// startLevel() so the roam reset (which runs NO level) clears exactly the same state — otherwise a prior
// mission win's `won: true` would freeze the roaming ship, or a stale `level` would spawn enemies in roam.
export function resetLevelRunnerState(world) {
  const lr = world.levelRunner;
  lr.phaseIndex = 0; lr.won = false; lr.winPending = 0; lr.returningToBase = false;
  world.returnToBase = false; world.autopilot.active = false; world.autopilot.target = null;
  if (world.station) world.station.active = false;
  world.firedBanners.clear(); clearBanner(world); // fresh run: re-arm the milestones, drop any lingering banner
}

export function startLevel(world, level) {
  const lr = world.levelRunner;
  lr.level = level; resetLevelRunnerState(world);
  world.enemyTotal = (level && level.enemyTotal) || 0; // total enemies for the HUD killed/total (0 if not seeded)
  world.host.onWarmLevel(level); // fetch/parse this level's models before the fight, not during it
  enterPhase(world);
}

export function currentPhase(world) {
  const lr = world.levelRunner;
  return lr.level ? lr.level.phases[lr.phaseIndex] : null;
}

export function enterPhase(world) {
  const lr = world.levelRunner;
  lr.killsAtPhaseStart = world.kills; lr.spawnedThisPhase = 0; lr.spawnCooldown = 0;
  const ph = currentPhase(world);
  // "Final Stage" banner: fire when entering the last combat phase — the one right before the
  // `event: 'win'` phase (the boss/finale on every level). Once per run.
  const next = lr.level && lr.level.phases[lr.phaseIndex + 1];
  if (ph && !ph.event && next && next.event === 'win' && !world.firedBanners.has('final')) {
    world.firedBanners.add('final');
    showBanner(world, 'ui.banner.final_stage');
  }
  if (ph && ph.event === 'win') {
    // defer the overlay by `delay` seconds so the boss explosion can play out first
    lr.winTextKey = ph.textKey; lr.winText = ph.text; // i18n key (+ English fallback)
    lr.winPending = ph.delay ?? 0;
    if (lr.winPending <= 0) beginReturn(world);
  }
}

// Return-to-base gate (replaces the immediate win): the last kill lifts OOB, shows the homing arrow +
// hint, and makes the station clickable. Victory fires only once the player docks (see checkArrival).
export function beginReturn(world) {
  world.levelRunner.returningToBase = true;
  world.returnToBase = true;                      // lifts OOB warp, shows arrow + hint (read by sim + HUD)
  if (world.station) world.station.active = true; // station becomes clickable
}

export function checkArrival(world) {
  // Victory requires an ENGAGED autopilot whose target is the STATION (a chest-aimed autopilot must never
  // win). canDock() encodes that + the arrive-radius; proximity alone never wins; any control input
  // cancels the dock (clears autopilot.active) so a cancelled approach doesn't complete — the player
  // re-taps to resume.
  const p = world.player;
  if (!world.station || !p || !p.alive) return;
  const s = world.station.pos;
  const dx = p.pos.x - s.x, dz = p.pos.z - s.z;
  if (canDock(world.autopilot, Math.hypot(dx, dz))) winLevel(world);
}

export function winLevel(world) {
  const lr = world.levelRunner;
  lr.won = true;
  // tear down the return-to-base state so the overlay/arrow/hint clear
  lr.returningToBase = false;
  world.returnToBase = false; world.autopilot.active = false; world.autopilot.target = null;
  if (world.station) world.station.active = false;
  // Rules stay here; the sting, the overlay and every backend side effect are the adapter's job.
  world.earned *= 2; // double the credits earned for clearing the level
  world.earnedXp += lr.level.xpReward || 0; // one-shot mission XP bonus on victory (per-kill XP is NOT doubled)
  world.events.emit({ type: 'win', textKey: lr.winTextKey, text: lr.winText });
}

export function pickShip(pool) {
  const total = pool.reduce((s, p) => s + (p.chance || 1), 0); // `chance` = spawn frequency
  let r = simRandom() * total;   // GAMEPLAY draw (which enemy spawns) → the seeded stream
  for (const p of pool) { r -= (p.chance || 1); if (r < 0) return p.ship; }
  return pool[0].ship;
}

export function updateLevelRunner(world, dt) {
  const lr = world.levelRunner;
  const ph = currentPhase(world);
  if (!ph || lr.won) return;
  // victory pending: keep the game running (so the boss explosion animates) until the delay ends,
  // then open the return-to-base gate (arrow + hint + clickable station) instead of winning outright
  if (lr.winPending > 0) {
    lr.winPending -= dt;
    if (lr.winPending <= 0) beginReturn(world);
    return;
  }
  // returning to base: no more spawning; just wait for the player to fly home and dock
  if (lr.returningToBase) { checkArrival(world); return; }
  // Staggered spawn: one enemy at a time on a randomized 2–4 s cooldown (see spawn-timing.js). The
  // first enemy of a phase is immediate (cooldown reset to 0 in enterPhase); every spawn re-arms 2–4 s.
  // A full arena freezes the timer, so a kill's replacement still waits 2–4 s (never instant).
  if (ph.spawn) {
    const cap = ph.spawn.total;
    const capRemaining = cap == null ? null : cap - lr.spawnedThisPhase;
    const gate = stepSpawnGate({
      cooldown: lr.spawnCooldown, dt,
      alive: world.enemies.length, maxConcurrent: ph.spawn.maxConcurrent, capRemaining,
    }, simRandom);   // the spawn cooldown is a GAMEPLAY draw — inject the seeded stream explicitly
    lr.spawnCooldown = gate.cooldown;
    if (gate.spawn) {
      const def = world.catalog.shipByName.get(pickShip(ph.spawn.pool));
      // The enemy materializes over its armed stagger delay: "the delay IS the arrival animation"
      // (DECISIONS §54). spawnEnemy already set e.warping = true; override the 1 s default here.
      if (def) { const e = spawnEnemy(world, def); e.spawnDur = gate.cooldown; lr.spawnedThisPhase++; }
    }
  }
  // advance to the next phase when this one's condition is met
  if (shouldAdvance(world, ph) && lr.phaseIndex < lr.level.phases.length - 1) {
    lr.phaseIndex++;
    enterPhase(world);
  }
}

export function shouldAdvance(world, ph) {
  const lr = world.levelRunner;
  const c = ph.advanceWhen;
  if (!c) return false;
  if (c.kills != null) return world.kills >= c.kills;
  if (c.killsSincePhase != null) return (world.kills - lr.killsAtPhaseStart) >= c.killsSincePhase;
  if (c.allCleared) {
    const spawnDone = !ph.spawn || (ph.spawn.total != null && lr.spawnedThisPhase >= ph.spawn.total);
    return world.enemies.length === 0 && spawnDone;
  }
  return false;
}
