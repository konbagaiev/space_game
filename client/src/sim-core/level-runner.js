// The level runner: plays a DB level descriptor (an ordered phase/wave script).
//
// Each phase optionally spawns a weighted pool up to `maxConcurrent` (with an optional `total` cap), and
// advances when its condition is met: { kills } (cumulative), { killsSincePhase }, or { allCleared } (map
// empty AND the phase's total fully spawned). The boss phase pool is the boss only, after clear-out empties
// the arena → the boss always appears alone.
//
// ── A mission ends in TWO moments, not one (DECISIONS §130) ─────────────────────────────────────────────
// They used to be the same moment and it cost more than it looked:
//
//   1. **CLEARED** — the level's `winCondition` is met (today, always `allEnemiesDead`). This is where the
//      REWARD is decided and handed over: the credits double, the mission XP bonus lands, and `cleared` goes
//      out for the host to bank. It is a pure consequence of the fight, so a browser, a server-run room and
//      a headless referee all reach it identically, with nobody clicking anything.
//   2. **WON** — the player says the mission is over. This closes it: the remaining salvage is swept up,
//      then the overlay, the sting, the hangar. `lr.won` still means exactly what it always meant.
//
// **Two ways to say it, and they do the same thing** (DECISIONS §132): press "Finish and Return", or fly
// home and dock. Both run `completeMission`, so both sweep the field and pay identically — docking is the
// scenic route, not a better deal. What changed is that docking is no longer the ONLY way: making a cleared
// level depend on completing a flight meant a player who cleared it and then reloaded the tab had to fight
// the whole thing again. Between the two moments the pilot is free in a sector with no enemies left:
// linger, pick over the wreckage, then end it however they like.
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
import { collectAll } from './drops-sim.js';

// The runner's mutable state for one fight. Lives on the World (see world.js).
export function createLevelRunnerState() {
  return {
    level: null,            // the active level descriptor (null while roaming → update() does nothing)
    phaseIndex: 0,
    killsAtPhaseStart: 0,
    spawnedThisPhase: 0,
    spawnCooldown: 0,
    won: false,             // DOCKED — the mission is closed (overlay, hangar). See the header.
    cleared: false,         // the win condition was met and the REWARD has been granted. Once per run.
    winPending: 0,          // seconds left before the win phase tests the win condition
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
  lr.phaseIndex = 0; lr.won = false; lr.cleared = false; lr.winPending = 0; lr.returningToBase = false;
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
    // defer by `delay` seconds so the boss explosion can play out before the reward lands
    lr.winTextKey = ph.textKey; lr.winText = ph.text; // i18n key (+ English fallback)
    lr.winPending = ph.delay ?? 0;
    if (lr.winPending <= 0) clearMission(world);
  }
}

// ---------- The win condition ----------
// What a level asks of you. Stated on the descriptor so it is DATA rather than a special-cased phase, and
// evaluated inside the simulation so every host answers it the same way. Every level and side mission
// carries `allEnemiesDead` today, which is what their phase scripts already encoded implicitly — so this is
// a name for the existing rule, and the seam for the next one (survive N, escort X, reach Y).
export const DEFAULT_WIN_CONDITION = { type: 'allEnemiesDead' };

export function winConditionOf(level) {
  return (level && level.winCondition) || DEFAULT_WIN_CONDITION; // a descriptor without one behaves as before
}

export function winConditionMet(world) {
  const lr = world.levelRunner;
  if (!lr.level) return false;
  const cond = winConditionOf(lr.level);
  switch (cond.type) {
    // The arena is empty and the script has nothing left to spawn. On every level shipped today the phase
    // before `event: 'win'` advances on `allCleared`, so this is already true the moment the win phase is
    // entered — the condition is being made explicit, not tightened.
    case 'allEnemiesDead': return world.enemies.length === 0;
    default: return false;   // an unknown condition can never be met: never pay out on a rule we cannot read
  }
}

// MOMENT 1: the win condition is met — the reward is granted and the way home opens.
//
// Everything the run is worth is decided HERE, not at the dock: the credits double, the mission's one-shot
// XP bonus lands, and `cleared` carries the totals out to whoever does the banking (the browser's adapter
// today, a room itself next). From this point the flight home cannot take any of it back.
//
// Retried each tick until the condition holds (see updateLevelRunner) and guarded by `lr.cleared`, so it
// pays out exactly once however often it is called.
export function clearMission(world) {
  const lr = world.levelRunner;
  if (lr.cleared) return;
  if (!winConditionMet(world)) return;            // not yet — the runner asks again next tick
  lr.cleared = true;

  // The sector is quiet: the out-of-bounds warp lifts (nothing left to fight, so wandering is allowed), the
  // HUD offers "Finish and Return", and the station becomes clickable — flying home still ends the mission,
  // it just is not the only way any more.
  lr.returningToBase = true;
  world.returnToBase = true;
  if (world.station) world.station.active = true;

  // The rules stay here; banking, the stash deposit and the progress advance are the host's job.
  world.earned *= 2;                              // clearing the level doubles the credits earned in it
  world.earnedXp += (lr.level && lr.level.xpReward) || 0; // one-shot mission bonus (per-kill XP is NOT doubled)
  world.events.emit({ type: 'cleared', credits: world.earned, xp: world.earnedXp, kills: world.kills });
}

// The old name for moment 1, kept because "begin the return" is still half of what it does and three
// scenarios talk about it that way. Prefer `clearMission`.
export const beginReturn = clearMission;

// MOMENT 2: the player ends it — the "Finish and Return" button, or docking at home (checkArrival). Both
// land here, so the two routes cannot drift apart.
//
// A cleared mission waits for one of them rather than for a docking approach ALONE, so it cannot be lost by
// reloading the tab, and the salvage sweep, the campaign advance and the ship rebuild all happen at an
// instant the PLAYER chose — with the fight already over, which is what makes rebuilding the ship safe at
// all (`unlockNextLevel` can swap a weapon).
//
// Refuses before the sector is cleared: there is no early exit from a mission, and a button that sometimes
// ended a live fight would be a bug waiting to be found by a stray tap.
// Flying home and docking — the scenic way to say the same thing. Requires an ENGAGED autopilot whose
// target is the STATION (`canDock`), so proximity alone never ends a mission and a chest-aimed autopilot
// never can; any control input cancels the dock, and the player re-taps to resume. Routed through
// `completeMission` so docking and the button are the same act, salvage sweep included.
export function checkArrival(world) {
  const p = world.player;
  if (!world.station || !p || !p.alive) return;
  const s = world.station.pos;
  const dx = p.pos.x - s.x, dz = p.pos.z - s.z;
  if (canDock(world.autopilot, Math.hypot(dx, dz))) completeMission(world);
}

export function completeMission(world) {
  const lr = world.levelRunner;
  if (!lr.cleared || lr.won) return false;
  collectAll(world);   // the wreckage is yours — see drops-sim.collectAll
  winLevel(world);
  return true;
}

// MOMENT 2: the player docked — the mission is closed.
//
// Nothing is earned here any more (see clearMission). This is the ceremony and the exit: the overlay, the
// sting, the way back to the hangar. `lr.won` keeps the meaning every one of its ~20 readers already
// assumes — "the fight is over, stop running it".
export function winLevel(world) {
  const lr = world.levelRunner;
  lr.won = true;
  // tear down the return-to-base state so the overlay/arrow/hint clear
  lr.returningToBase = false;
  world.returnToBase = false; world.autopilot.active = false; world.autopilot.target = null;
  if (world.station) world.station.active = false;
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
  // victory pending: keep the game running (so the boss explosion animates) until the delay ends, then
  // test the win condition and pay out
  if (lr.winPending > 0) {
    lr.winPending -= dt;
    if (lr.winPending <= 0) clearMission(world);
    return;
  }
  // cleared: no more spawning. The mission ends when the player says so — the button, or by flying home,
  // which is what this still watches for.
  if (lr.returningToBase) { checkArrival(world); return; }
  // The win phase is up but the condition has not been met yet — ask again. No level shipped today can
  // reach this (each one's last combat phase advances on `allCleared`, so the arena is already empty), but
  // a win condition that is only a rename cannot be tested, and one that can wait is a real gate.
  if (ph.event === 'win') { clearMission(world); return; }
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
