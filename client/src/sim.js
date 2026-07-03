// The simulation: the per-frame fixed-step `update(dt)`, the level runner (DB phase/wave script), the
// cosmetic helpers (forward vector, wing-bank, soft-boundary warp + OOB warning), music routing, and
// pause control. This sits at the TOP of the dependency graph — it touches almost everything — so it
// imports the leaves (state, engine, world, projectiles, ship-build, net, hud-less) and is itself imported
// only by the composition root (the inline script / main). It never imports the loop's callers.
import * as THREE from 'three';
import { G, bullets, explosions, sparks, shockwaves, trail, rockets, smoke, enemies, setPieces, CATALOG, keys, touchAim, SPAWN_GROW_TIME, creditPopups } from './state.js';
import { scene, camera, camOffset } from './engine.js';
import { Device } from './device.js';
import { ARENA, OOB_WARN_DELAY, OOB_RETURN_TIME, arenaCenter, arenaBorder, updateMoons, buildSetPiece } from './world.js';
import { repairTick } from './components.js';
import { headingToDir, shortestAngleDelta, steerToward, enemyThrustFactor } from './steering.js';
import { audio, sfxFor } from './sound-routing.js';
import { spawnExplosion, spawnShipExplosion, emitExhaust, detonateRocket, spawnSmoke } from './projectiles.js';
import { spawnEnemyShip, updateGroups } from './ship-build.js';
import { track, currentLevelLabel, bankRun, unlockNextLevel } from './net.js';
import { t } from './i18n.js';
import { el } from './dom.js';

// ---------- Music ----------
// Music follows game state: the driving combat mood during a live fight, the calmer hangar mood on
// menus / overlays / while paused. refreshMusic() is cheap + idempotent (no-op when the mood is unchanged).
function musicForState() {
  return (G.gameStarted && G.player && G.player.alive && !levelRunner.won && !G.paused) ? 'combat' : 'hangar';
}
export function refreshMusic() { audio.setScene(musicForState()); }

// ---------- Level runner: plays a DB level descriptor (an ordered phase/wave script) ----------
// Each phase optionally spawns a weighted pool up to `maxConcurrent` (with an optional `total` cap),
// and advances when its condition is met: { kills } (cumulative), { killsSincePhase }, or
// { allCleared } (map empty AND the phase's total fully spawned). A phase with `event: 'win'` ends
// the level with a victory overlay. The boss phase pool is the boss only, after clear-out empties
// the arena -> the boss always appears alone.
export const levelRunner = {
  level: null, phaseIndex: 0, killsAtPhaseStart: 0, spawnedThisPhase: 0, won: false,
  winPending: 0, winText: '', returningToBase: false,

  start(level) {
    this.level = level; this.phaseIndex = 0; this.won = false; this.winPending = 0;
    // reset the return-to-base gate + shared flags so a Restart starts clean
    this.returningToBase = false;
    G.returnToBase = false; G.autopilot.active = false;
    if (G.baseStation) G.baseStation.active = false;
    G.enemyTotal = (level && level.enemyTotal) || 0; // total enemies for the HUD killed/total (0 if not seeded)
    this.enterPhase();
  },
  get phase() { return this.level ? this.level.phases[this.phaseIndex] : null; },

  enterPhase() {
    this.killsAtPhaseStart = G.kills; this.spawnedThisPhase = 0;
    const ph = this.phase;
    if (ph && ph.event === 'win') {
      // defer the overlay by `delay` seconds so the boss explosion can play out first
      this.winTextKey = ph.textKey; this.winText = ph.text; // i18n key (+ English fallback)
      this.winPending = ph.delay ?? 0;
      if (this.winPending <= 0) this.beginReturn();
    }
  },
  // Return-to-base gate (replaces the immediate win): the last kill lifts OOB, shows the homing arrow +
  // hint, and makes the station clickable. Victory fires only once the player docks (see checkArrival).
  beginReturn() {
    this.returningToBase = true;
    G.returnToBase = true;                          // lifts OOB warp, shows arrow + hint (read by sim + HUD)
    if (G.baseStation) G.baseStation.active = true; // station becomes clickable
  },
  checkArrival() {
    // The dock is a MANDATORY explicit click: victory requires autopilot to be ENGAGED (only the station click
    // sets it) AND the ship within the radius. Proximity alone never wins; any control input cancels the dock
    // (clears G.autopilot.active) so a cancelled approach doesn't complete — the player re-taps to resume.
    if (!G.autopilot.active || !G.baseStation || !G.player || !G.player.alive) return;
    const s = G.baseStation.obj.position;
    const dx = G.player.mesh.position.x - s.x, dz = G.player.mesh.position.z - s.z;
    if (Math.hypot(dx, dz) <= BASE_ARRIVE_RADIUS) this.win();
  },
  win() {
    this.won = true;
    // tear down the return-to-base state so the overlay/arrow/hint clear
    this.returningToBase = false;
    G.returnToBase = false; G.autopilot.active = false;
    if (G.baseStation) G.baseStation.active = false;
    audio.sfx.jingle(true); refreshMusic(); // victory sting + back to the calmer menu music
    G.earned *= 2; // double the credits earned for clearing the level
    el.overlayTitle.textContent = t('ui.overlay.victory');
    // resolve the level's victory line through i18n (key → translation → English fallback)
    const cleared = this.winTextKey ? t(this.winTextKey) : (this.winText || t('ui.overlay.sector_cleared'));
    el.overlaySub.textContent = `${cleared} — ${t('ui.credits.doubled', { credits: G.earned })}`;
    el.restart.textContent = t('ui.button.continue'); // a win continues to the Hangar
    el.backHangar.style.display = 'none'; // Continue already goes to the Hangar — no separate button on a win
    el.overlay.style.display = 'flex';
    track('level_clear', { level: currentLevelLabel() }); // funnel: this level was cleared
    bankRun(); // bank the earned credits into the account balance
    // Side missions are repeatable grind: bank credits but do NOT advance the story counter. Campaign
    // levels advance progression as before.
    if (!this.level.sideMission) unlockNextLevel(); // record progress + load the next level for the next Restart
  },

  pickShip(pool) {
    const total = pool.reduce((s, p) => s + (p.chance || 1), 0); // `chance` = spawn frequency
    let r = Math.random() * total;
    for (const p of pool) { r -= (p.chance || 1); if (r < 0) return p.ship; }
    return pool[0].ship;
  },

  update(dt) {
    const ph = this.phase;
    if (!ph || this.won) return;
    // victory pending: keep the game running (so the boss explosion animates) until the delay ends,
    // then open the return-to-base gate (arrow + hint + clickable station) instead of winning outright
    if (this.winPending > 0) {
      this.winPending -= dt;
      if (this.winPending <= 0) this.beginReturn();
      return;
    }
    // returning to base: no more spawning; just wait for the player to fly home and dock
    if (this.returningToBase) { this.checkArrival(); return; }
    // spawn up to maxConcurrent (respecting an optional total cap for this phase)
    if (ph.spawn) {
      const cap = ph.spawn.total;
      while (enemies.length < ph.spawn.maxConcurrent && (cap == null || this.spawnedThisPhase < cap)) {
        const def = CATALOG.shipByName.get(this.pickShip(ph.spawn.pool));
        if (!def) break;
        spawnEnemyShip(def);
        this.spawnedThisPhase++;
      }
    }
    // advance to the next phase when this one's condition is met
    if (this.shouldAdvance(ph) && this.phaseIndex < this.level.phases.length - 1) {
      this.phaseIndex++;
      this.enterPhase();
    }
  },
  shouldAdvance(ph) {
    const c = ph.advanceWhen;
    if (!c) return false;
    if (c.kills != null) return G.kills >= c.kills;
    if (c.killsSincePhase != null) return (G.kills - this.killsAtPhaseStart) >= c.killsSincePhase;
    if (c.allCleared) {
      const spawnDone = !ph.spawn || (ph.spawn.total != null && this.spawnedThisPhase >= ph.spawn.total);
      return enemies.length === 0 && spawnDone;
    }
    return false;
  },
};

// ---------- Helpers ----------
function forwardVec(heading) {
  // nose points in +Z when heading=0 (math lives in steering.js)
  const d = headingToDir(heading);
  return new THREE.Vector3(d.x, 0, d.z);
}

// ---------- Autopilot (return-to-base click-to-fly) ----------
// Kinematic symmetric-decel brake: bleed the velocity toward 0 at a constant rate equal to the ship's
// thrust `accel` (Decision 2 — the passive IDLE_DRAG is exponential and can't stop cleanly).
function brakeStep(accel, dt) {
  const v = G.player.vel, sp = v.length();
  if (sp <= 1e-4) { v.set(0, 0, 0); return; }
  const dec = Math.min(sp, accel * dt); // symmetric decel == thrust accel
  v.addScaledVector(v.clone().normalize(), -dec);
}

// Click-to-fly: brake to a stop → rotate to face the station → accelerate at max → kinematic brake so the
// ship coasts to ~0 right at the station. `heading` convention matches forwardVec/touchAim: desired = atan2(dx, dz).
// Arrival isn't handled here — levelRunner.checkArrival() fires the win ONLY while autopilot is engaged, so a
// manual/cancelled approach never completes the mission; autopilot just stalls at the station until arrival.
function autopilotControl(dt, accel, turn) {
  const st = G.baseStation && G.baseStation.obj.position;
  if (!st) { G.autopilot.active = false; return; }
  const pos = G.player.mesh.position;
  const dx = st.x - pos.x, dz = st.z - pos.z;
  const dist = Math.hypot(dx, dz);
  const desired = Math.atan2(dx, dz);
  const ap = G.autopilot;

  if (ap.phase === 'brake0') {                    // 1) full stop first
    brakeStep(accel, dt);
    if (G.player.vel.length() < 0.5) ap.phase = 'rotate';
  } else if (ap.phase === 'rotate') {             // 2) rotate the nose to face the station
    G.player.heading = steerToward(G.player.heading, desired, turn * dt);
    brakeStep(accel, dt);                         // bleed any residual drift while turning
    if (Math.abs(shortestAngleDelta(G.player.heading, desired)) < 0.05) ap.phase = 'cruise';
  } else {                                        // 3/4) accelerate, then kinematic brake
    G.player.heading = steerToward(G.player.heading, desired, turn * dt);
    const speed = G.player.vel.length();
    const stopDist = (speed * speed) / (2 * accel);
    if (dist > stopDist + 0.5) {
      const fwd = forwardVec(G.player.heading);
      G.player.vel.addScaledVector(fwd, accel * dt);
      emitExhaust(G.player.mesh, fwd, G.player.vel, G.player.engine.exhaust);
    } else {
      brakeStep(accel, dt);
    }
  }
}

// Engage autopilot (called by the station click handler in main.js). Only valid while returning to base.
export function engageAutopilot() {
  if (!G.returnToBase || !G.player || !G.player.alive || levelRunner.won) return;
  G.autopilot.active = true; G.autopilot.phase = 'brake0';
}

// ---------- Homing arrow + HUD hint (world-space arrow + DOM hint) ----------
let returnArrow = null;
function ensureReturnArrow() {
  if (returnArrow) return returnArrow;
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.4, fog: false, depthWrite: false });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 7, 8), mat);
  shaft.rotation.x = Math.PI / 2; shaft.position.z = 3.5;   // cylinder axis Y → lay along +Z
  const head = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3, 10), mat);
  head.rotation.x = Math.PI / 2; head.position.z = 8.5;
  g.add(shaft, head); g.visible = false; scene.add(g);
  return (returnArrow = g);
}
export function updateReturnArrow() {
  const on = G.returnToBase && G.player && G.player.alive && !levelRunner.won && G.baseStation;
  if (!on) { if (returnArrow) returnArrow.visible = false; return; }
  const a = ensureReturnArrow();
  const st = G.baseStation.obj.position, pos = G.player.mesh.position;
  a.position.set(pos.x, 2.5, pos.z);                        // anchored to the ship, just above the plane
  a.rotation.y = Math.atan2(st.x - pos.x, st.z - pos.z);    // point at the station (heading convention)
  a.visible = true;
}
export function updateReturnHint() {
  const show = G.returnToBase && G.player && G.player.alive && !levelRunner.won
    && el.overlay.style.display === 'none';
  if (!show) { el.returnHint.style.display = 'none'; return; }
  el.returnHint.style.display = 'block';
  el.returnHint.textContent = t('ui.return.hint');
}

// Soft-boundary auto-return: warp the player back to the center, zero velocity, clear the OOB timer,
// and replay the warp-in animation so the return reads as intentional (not a glitch).
export function warpPlayerToCenter() {
  G.player.mesh.position.set(arenaCenter.x, 0.6, arenaCenter.z); // back to the (possibly drifted) arena center
  G.player.vel.set(0, 0, 0);
  G.player.oobTime = 0;
  if (!G.player.spawnScale) G.player.spawnScale = G.player.mesh.scale.clone(); // capture full size (model is loaded by now)
  G.player.spawnAge = 0;                  // (re)start the grow-from-a-dot animation
  G.player.mesh.scale.setScalar(0.001);
  spawnExplosion(G.player.mesh.position.clone()); // a small flash at the arrival point
}

// "You've left the battlefield" HUD warning + countdown. Shown only after OOB_WARN_DELAY seconds
// continuously out of bounds; hidden while in bounds, on menus, or when a result overlay is up.
export function updateOobWarning() {
  const show = G.player && G.gameStarted && G.player.alive && !levelRunner.won && !G.returnToBase
    && el.overlay.style.display === 'none' && G.player.oobTime >= OOB_WARN_DELAY;
  if (!show) { el.oobWarn.style.display = 'none'; return; }
  const remain = Math.max(0, Math.ceil(OOB_RETURN_TIME - G.player.oobTime));
  el.oobWarn.style.display = 'block';
  el.oobWarn.innerHTML =
    `<div class="oob-title">${t('ui.oob.warning')}</div>` +
    `<div class="oob-count">${t('ui.oob.countdown', { seconds: remain })}</div>`;
}

// ---------- Game loop ----------
// Thrust/turn/speed/weapon are taken from the ship's components (engine/weapon).
const DRAG = 1.8;        // friction (enemies)
const IDLE_DRAG = 0.8;   // soft braking for the player when controls are released
const BASE_ARRIVE_RADIUS = 45; // horizontal distance to the station (0,0) that ends autopilot + fires victory
const BANK_MAX  = 20 * Math.PI / 180; // max wing bank, radians (~0.349) — hard cap, "20 degrees, no more"
const BANK_TAU  = 0.15;               // smoothing time-constant (s); smaller = snappier, larger = lazier

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
  const target  = -strength * BANK_MAX;                                 // sign: roll INTO the turn (flip if wrong by eye)
  if (ship.roll === undefined) ship.roll = 0;
  const k = 1 - Math.exp(-dt / BANK_TAU);                               // frame-rate-independent easing
  ship.roll += (target - ship.roll) * k;
  bank.rotation.z = ship.roll;
}

export function update(dt) {
  if (!G.gameStarted || !G.player.alive || levelRunner.won) return; // idle on the welcome screen / frozen on death/victory

  // --- repair drone: passive hull regen, capped at a fraction of max HP (no-op without a drone) ---
  if (G.player.repair) {
    const r = repairTick(G.player.hp, G.player.maxHp, G.player.repair, dt, G.player._repairAccum);
    G.player.hp = r.hp; G.player._repairAccum = r.accum;
  }

  const eng = G.player.engine;         // main engine (for exhaust)
  const accel = G.player.acceleration; // derived: acceleration <- main engine power
  const turn = G.player.turnRate;      // derived: maneuverability <- thruster power

  // Autopilot (return-to-base): ANY control input cancels it and hands control back immediately (DECISIONS §39).
  const manual = touchAim.active
    || keys['KeyW'] || keys['ArrowUp'] || keys['KeyS'] || keys['ArrowDown']
    || keys['KeyA'] || keys['ArrowLeft'] || keys['KeyD'] || keys['ArrowRight']
    || keys['Space'] || keys['KeyF'] || keys['_rocket']; // KeyF = keyboard rocket, _rocket = touch/mouse 🚀 button
  if (G.autopilot.active && manual) G.autopilot.active = false;

  let fwd;
  if (G.autopilot.active) {
    autopilotControl(dt, accel, turn); // sets heading + vel toward the station (brake/rotate/accelerate)
    fwd = forwardVec(G.player.heading);
  } else {
    // --- player: turn ---
    if (keys['KeyA'] || keys['ArrowLeft'])  G.player.heading += turn * dt;
    if (keys['KeyD'] || keys['ArrowRight']) G.player.heading -= turn * dt;

    // touch: turn the nose toward the touch direction (directional steering)
    if (touchAim.active) {
      G.player.heading = steerToward(G.player.heading, touchAim.heading, turn * dt);
    }

    // --- player: thrust ---
    fwd = forwardVec(G.player.heading);
    if (keys['KeyW'] || keys['ArrowUp'])   G.player.vel.addScaledVector(fwd, accel * dt);
    if (keys['KeyS'] || keys['ArrowDown']) G.player.vel.addScaledVector(fwd, -accel * dt);
    if (touchAim.active) G.player.vel.addScaledVector(fwd, accel * touchAim.thrust * dt); // touch thrust

    // passive braking when no control button is pressed
    // (hold the turn to aim while drifting - inertia is preserved)
    const controlling = touchAim.active
                     || keys['KeyW'] || keys['ArrowUp'] || keys['KeyS'] || keys['ArrowDown']
                     || keys['KeyA'] || keys['ArrowLeft'] || keys['KeyD'] || keys['ArrowRight'];
    if (!controlling) G.player.vel.multiplyScalar(Math.max(0, 1 - IDLE_DRAG * dt));
  }

  // pure inertia: no friction, no speed limit - the ship
  // keeps flying in its current direction, no matter where the nose points
  G.player.mesh.position.addScaledVector(G.player.vel, dt);

  // Drifting arena (e.g. freighter escort): slowly pan the combat zone's center; the boundary, warp-back
  // and mini-map all compute relative to it. Static maps (G.arenaDrift null) keep the center at (0,0).
  if (G.arenaDrift) {
    arenaCenter.x += G.arenaDrift.x * dt;
    arenaCenter.z += G.arenaDrift.z * dt;
    arenaBorder.line.position.set(arenaCenter.x, 0, arenaCenter.z);
  }

  // Soft boundary (DECISIONS §2): the player can fly past ±ARENA freely (measured from the arena center).
  // Track how long it's been continuously outside; after a grace delay we warn (HUD), and after
  // OOB_RETURN_TIME we warp it back to the center. Re-entering resets the timer and clears the warning.
  const p = G.player.mesh.position;
  const dxc = p.x - arenaCenter.x, dzc = p.z - arenaCenter.z;
  const oob = Math.abs(dxc) > ARENA || Math.abs(dzc) > ARENA;
  if (oob) {
    G.player.oobTime += dt;
    // OOB warp-back is LIFTED during return-to-base (§39) so side missions fought far from (0,0) can fly home
    if (G.player.oobTime >= OOB_RETURN_TIME && !G.returnToBase) warpPlayerToCenter();
  } else {
    G.player.oobTime = 0;
  }
  // edge marker brightens as the player approaches the wall, brightest while out of bounds
  const edge = Math.max(Math.abs(dxc), Math.abs(dzc));
  const near = Math.min(1, Math.max(0, (edge - (ARENA - 60)) / 60));
  arenaBorder.mat.opacity = 0.12 + near * 0.5 + (oob ? 0.25 : 0);

  // warp-back animation: grow from a dot back to full size (reuses the enemy "warp in")
  if (G.player.spawnAge < SPAWN_GROW_TIME) {
    G.player.spawnAge = Math.min(SPAWN_GROW_TIME, G.player.spawnAge + dt);
    const k = 1 - Math.pow(1 - G.player.spawnAge / SPAWN_GROW_TIME, 3); // ease-out cubic
    G.player.mesh.scale.copy(G.player.spawnScale).multiplyScalar(Math.max(0.001, k));
  }

  G.player.mesh.rotation.y = G.player.heading;
  updateBank(G.player, turn, dt); // cosmetic wing-bank; `turn` = player.turnRate, in scope above

  // --- engine trail (when thrusting forward) ---
  if (keys['KeyW'] || keys['ArrowUp'] || (touchAim.active && touchAim.thrust > 0.1)) {
    emitExhaust(G.player.mesh, fwd, G.player.vel, eng.exhaust);
  }

  // --- player: fire each group when its key is held (the rocket group also via the touch button) ---
  updateGroups(G.player, fwd, true, dt, (g) => !!(keys[g.key] || (g.name === 'rocket' && keys['_rocket'])));

  // --- enemy AI ---
  for (const e of enemies) {
    // spawn animation: grow from a dot to full size over SPAWN_GROW_TIME (ease-out)
    if (e.spawnAge < SPAWN_GROW_TIME) {
      e.spawnAge = Math.min(SPAWN_GROW_TIME, e.spawnAge + dt);
      const t = e.spawnAge / SPAWN_GROW_TIME;
      const k = 1 - Math.pow(1 - t, 3); // ease-out cubic
      e.mesh.scale.copy(e.spawnScale).multiplyScalar(Math.max(0.001, k));
    }

    const toPlayer = G.player.mesh.position.clone().sub(e.mesh.position);
    const dist = toPlayer.length();
    toPlayer.normalize();

    // target angle toward the player
    const desired = Math.atan2(toPlayer.x, toPlayer.z);
    const diff = shortestAngleDelta(e.heading, desired); // used below for aim checks
    e.heading = steerToward(e.heading, desired, e.turnRate * dt);

    const ef = forwardVec(e.heading);
    // keep distance ~20: close in from afar, back off if too close
    const thrust = enemyThrustFactor(dist);
    e.vel.addScaledVector(ef, e.acceleration * thrust * dt);
    e.vel.multiplyScalar(Math.max(0, 1 - DRAG * dt));
    if (e.engine.maxSpeed && e.vel.length() > e.engine.maxSpeed) e.vel.setLength(e.engine.maxSpeed);

    e.mesh.position.addScaledVector(e.vel, dt); // no arena clamp: enemies chase the player out of bounds
    e.mesh.rotation.y = e.heading;
    updateBank(e, e.turnRate, dt); // cosmetic wing-bank for enemies

    // engine trail: same exhaust behavior as the player, when thrusting forward
    if (thrust > 0.1) emitExhaust(e.mesh, ef, e.vel, e.engine.exhaust);

    // fire each group whose AI rule (range + aim tolerance) is satisfied
    updateGroups(e, ef, false, dt, (g) => g.ai && dist < g.ai.range && Math.abs(diff) < g.ai.aimTol);
  }

  // --- projectiles ---
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.traveled += b.vel.length() * dt;
    b.mesh.position.addScaledVector(b.vel, dt);

    let hit = false;
    if (b.fromPlayer) {
      for (const e of enemies) {
        if (b.mesh.position.distanceTo(e.mesh.position) < e.radius) {
          e.hp -= b.damage; hit = true; audio.sfx.hit(); break;
        }
      }
    } else {
      if (G.player.mesh.position.distanceTo(b.mesh.position) < 2.6) {
        G.player.hp -= b.damage; hit = true; audio.sfx.hit(sfxFor('ship', G.player.class, 'hit')); // sampled impact when OUR ship is struck
      }
    }

    // interception: a bullet damages an opposite-side rocket; it's shot down when its hp runs out
    if (!hit) {
      for (let j = rockets.length - 1; j >= 0; j--) {
        const r = rockets[j];
        if (r.fromPlayer === b.fromPlayer) continue; // only rockets of the opposite side
        if (b.mesh.position.distanceTo(r.obj.position) < 2.4) {
          r.hp -= b.damage;
          if (r.hp <= 0) { detonateRocket(r, false); rockets.splice(j, 1); } // destroyed
          hit = true; break;                                                 // else it survives, takes another
        }
      }
    }

    // limited only by range/hits — bullets fly normally beyond the arena (no boundary culling)
    if (hit || b.traveled >= b.maxRange) {
      if (hit) spawnExplosion(b.mesh.position); // micro-flash at the impact point
      scene.remove(b.mesh);
      b.mesh.material.dispose();
      bullets.splice(i, 1);
    }
  }

  // --- rockets: homing (accelerate toward target), detonate near the enemy ---
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    // target lost: for a player rocket - if the enemy died; for an enemy one - if the player died
    if (r.target && (r.fromPlayer ? !enemies.includes(r.target) : !G.player.alive)) r.target = null;
    if (r.target) {
      // maneuver: turn the velocity vector toward the target (turnRate) + accelerate forward (accel)
      const to = r.target.mesh.position.clone().sub(r.obj.position);
      const desired = Math.atan2(to.x, to.z);
      const cur = steerToward(Math.atan2(r.vel.x, r.vel.z), desired, r.turnRate * dt);
      const speed = r.vel.length() + r.accel * dt;
      r.vel.set(Math.sin(cur) * speed, 0, Math.cos(cur) * speed);
    }
    r.traveled += r.vel.length() * dt;
    r.obj.position.addScaledVector(r.vel, dt);
    if (r.vel.lengthSq() > 0.01) r.obj.rotation.y = Math.atan2(r.vel.x, r.vel.z);
    spawnSmoke(r.obj.position); // light smoke trail

    let det = false;
    if (r.fromPlayer) {
      for (const e of enemies) {
        if (e.mesh.position.distanceTo(r.obj.position) <= Math.max(r.detonateR, e.radius)) { det = true; break; }
      }
    } else if (G.player.alive && G.player.mesh.position.distanceTo(r.obj.position) <= r.detonateR) {
      det = true;
    }
    // limited only by range/detonation — rockets fly normally beyond the arena (no boundary culling)
    if (det || r.traveled >= r.maxRange) { detonateRocket(r); rockets.splice(i, 1); }
  }

  // --- micro-explosions (short fiery flash) ---
  for (let i = explosions.length - 1; i >= 0; i--) {
    const x = explosions[i];
    x.life -= dt;
    const t = 1 - Math.max(0, x.life) / x.maxLife; // 0 → 1
    x.mesh.scale.setScalar(0.6 + t * (x.maxScale - 0.6)); // expands quickly
    x.mesh.material.opacity = (1 - t);                  // and fades out
    if (x.life <= 0) {
      scene.remove(x.mesh);
      x.mesh.material.dispose();
      explosions.splice(i, 1);
    }
  }

  // --- engine trail: particles fly backward, fade out and shrink ---
  for (let i = trail.length - 1; i >= 0; i--) {
    const p = trail[i];
    p.mesh.position.addScaledVector(p.vel, dt);
    p.life -= dt;
    const t = 1 - Math.max(0, p.life) / p.maxLife; // 0 → 1
    p.mesh.material.opacity = (1 - t) * 0.85;
    p.mesh.scale.setScalar(p.baseSize * (1.1 - t * 0.8));
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
      trail.splice(i, 1);
    }
  }

  // --- rocket smoke trail: puffs expand and fade away ---
  for (let i = smoke.length - 1; i >= 0; i--) {
    const s = smoke[i];
    s.life -= dt;
    const t = 1 - Math.max(0, s.life) / s.maxLife; // 0 → 1
    s.mesh.material.opacity = (1 - t) * 0.35;
    s.mesh.scale.setScalar(0.4 + t * 1.2); // smoke expands
    if (s.life <= 0) {
      scene.remove(s.mesh);
      s.mesh.material.dispose();
      smoke.splice(i, 1);
    }
  }

  // --- ship-explosion sparks: colored debris flying outward, slowing, fading + shrinking ---
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.mesh.position.addScaledVector(s.vel, dt);
    s.vel.multiplyScalar(1 - 2.5 * dt); // drag
    s.life -= dt;
    const t = 1 - Math.max(0, s.life) / s.maxLife; // 0 → 1
    s.mesh.material.opacity = 1 - t;
    s.mesh.scale.setScalar(s.size * (1 - t * 0.7));
    if (s.life <= 0) {
      scene.remove(s.mesh);
      s.mesh.material.dispose();
      sparks.splice(i, 1);
    }
  }

  // --- ship-explosion shockwave: a flat ring expanding outward on the plane ---
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const w = shockwaves[i];
    w.life -= dt;
    const t = 1 - Math.max(0, w.life) / w.maxLife; // 0 → 1
    w.mesh.scale.setScalar(1 + t * (w.maxScale - 1)); // expands fast
    w.mesh.material.opacity = (1 - t) * 0.9;          // and fades out
    if (w.life <= 0) {
      scene.remove(w.mesh);
      w.mesh.material.dispose();
      shockwaves.splice(i, 1);
    }
  }

  // --- credit popups: "+xx" gold text that floats up and fades over ~1s (drawn by hud.js) ---
  for (let i = creditPopups.length - 1; i >= 0; i--) {
    creditPopups[i].life -= dt;
    if (creditPopups[i].life <= 0) creditPopups.splice(i, 1);
  }

  // --- enemy deaths ---
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies[i].hp <= 0) {
      // colorful death burst: sized to the ship, tinted by its engine's exhaust color
      const e = enemies[i];
      spawnShipExplosion(e.mesh.position, e.engine.exhaust.color, e.sizeScale || 1);
      // Per-size loudness: medium ships + bosses +50% louder; small ships 70% quieter.
      const louderBoom = ['medium', 'boss', 'advanced_medium_pirate', 'boss2'].includes(e.role);
      audio.sfx.explosion(e.sizeScale || 1, sfxFor('ship', e.class, 'explode'), louderBoom ? 1.5 : 0.3); // ship-class map; vol by size

      scene.remove(enemies[i].mesh);
      enemies.splice(i, 1);
      G.kills++;                  // count (drives level thresholds + HUD)
      const reward = e.reward || 0;
      G.earned += reward;         // credits (reward for this ship type)
      if (reward > 0) {           // floating "+xx" green popup at the kill site (cosmetic feedback)
        creditPopups.push({ pos: e.mesh.position.clone(), amount: reward, life: 2.0, maxLife: 2.0 });
      }
    }
  }
  // drive spawning + phase transitions from the active level
  levelRunner.update(dt);

  // --- player death ---
  if (G.player.hp <= 0 && G.player.alive) {
    G.player.alive = false;
    spawnShipExplosion(G.player.mesh.position, G.player.engine.exhaust.color, 1); // tinted by engine exhaust
    audio.sfx.explosion(1.5, sfxFor('ship', G.player.class, 'explode')); audio.sfx.jingle(false); refreshMusic(); // sampled boom + loss sting, back to menu music
    track('player_death', { level: currentLevelLabel(), kills: G.kills }); // funnel: where players die
    bankRun(); // bank the earned credits into the account balance + record the game
    el.overlayTitle.textContent = t('ui.overlay.ship_destroyed');
    el.overlaySub.textContent = t('ui.gameover.sub', { kills: G.kills, credits: G.earned });
    el.restart.textContent = t('ui.button.restart'); // a loss retries the level
    // once the shop is unlocked, offer returning to the hangar (shop/loadout) instead of an instant retry
    el.backHangar.style.display = (G.activeShip && G.activeShip.shopUnlocked) ? 'inline-block' : 'none';
    el.overlay.style.display = 'flex';
  }

  // --- camera: rigidly attached to the player (no lag or "floating" - no jitter),
  //     fixed angle - does NOT rotate with the ship's turn ---
  camera.position.copy(G.player.mesh.position).add(camOffset);
  camera.lookAt(G.player.mesh.position);

  // stars - an infinitely distant backdrop (stuck to the camera, no parallax)
  G.stars.position.copy(camera.position);
  // the planet shifts slightly as the player moves - a light parallax (depth)
  const PARALLAX = 0.6;
  G.sky.position.copy(camera.position).addScaledVector(G.player.mesh.position, -PARALLAX);

  // moons orbit the planet (they do not rotate themselves - the terminator does not "wander")
  updateMoons(dt);

  // mission set-pieces: their own slow animation (station spin, beams, exhaust, …)
  for (const sp of setPieces) sp.update?.(dt);
}

// ---------- Pause ----------
// G.paused freezes the fight by skipping the sim update (rendering keeps running, so the frozen frame
// stays on screen). The button toggles between ⏸ (playing) and ▶ (paused). NOTE: this is a purely
// client-side, single-player freeze — when multiplayer lands, pause must be reworked server-side (a
// client can't stop a shared world). See DECISIONS §16. The buttons + focus listeners are wired in the
// inline boot, which calls setPaused/togglePause/autoPauseOnBlur.
export function setPaused(p) {
  G.paused = p;
  el.pauseBtn.textContent = p ? '▶' : '⏸';
  const label = t(p ? 'ui.pause.resume' : 'ui.pause.pause');
  el.pauseBtn.setAttribute('aria-label', label);
  el.pauseBtn.title = label;
  el.pauseOverlay.classList.toggle('on', p); // centered "Paused" + Play while paused
  document.body.classList.toggle('paused', p); // gates the settings gear (shown on menus + while paused)
  refreshMusic(); // duck to the calmer menu mood while paused
}
// Toggle only while a fight is actually running (no-op on menus / after death/victory).
export function togglePause() {
  if (!G.gameStarted || !G.player || !G.player.alive || levelRunner.won) return;
  setPaused(!G.paused);
}
// Mobile: auto-pause when the browser/tab loses focus, so a backgrounded fight doesn't keep running.
export function autoPauseOnBlur() {
  if (Device.hasTouch && G.gameStarted && G.player && G.player.alive && !levelRunner.won && !G.paused) setPaused(true);
}

// ---------- Restart ----------
// Clear all transient entities/FX, recenter the (possibly drifting) arena, rebuild the map's set-pieces,
// respawn the player at full health, and (re)start the level. Called by the UI flows (take-off, the
// overlay Restart/Continue) — imported by them from here.
export function reset() {
  for (const b of bullets) { scene.remove(b.mesh); b.mesh.material.dispose(); }
  bullets.length = 0;
  for (const x of explosions) { scene.remove(x.mesh); x.mesh.material.dispose(); }
  explosions.length = 0;
  for (const p of trail) { scene.remove(p.mesh); p.mesh.material.dispose(); }
  trail.length = 0;
  for (const r of rockets) { scene.remove(r.obj); r.obj.children[0].material.dispose(); }
  rockets.length = 0;
  for (const s of smoke) { scene.remove(s.mesh); s.mesh.material.dispose(); }
  smoke.length = 0;
  for (const s of sparks) { scene.remove(s.mesh); s.mesh.material.dispose(); }
  sparks.length = 0;
  for (const w of shockwaves) { scene.remove(w.mesh); w.mesh.material.dispose(); }
  shockwaves.length = 0;
  creditPopups.length = 0; // DOM-only, no scene meshes to dispose
  for (const e of enemies) scene.remove(e.mesh);
  enemies.length = 0;
  // A side mission fights over its own location in the world (its set-piece); the campaign uses (0,0).
  const cx = (G.activeMission && G.activeMission.center && G.activeMission.center.x) || 0;
  const cz = (G.activeMission && G.activeMission.center && G.activeMission.center.z) || 0;
  arenaCenter.set(cx, 0, cz);             // fresh run: center the (possibly drifting) combat zone
  arenaBorder.line.position.set(cx, 0, cz);
  // a mission may drift its zone (the freighter escort); the campaign and other missions stay static
  G.arenaDrift = (G.activeMission && G.activeMission.drift)
    ? new THREE.Vector3(G.activeMission.drift.x || 0, 0, G.activeMission.drift.z || 0) : null;
  // rebuild the shared world's set-pieces fresh each run (resets the cruising freighter to its start)
  for (const sp of setPieces) scene.remove(sp.obj);
  setPieces.length = 0;
  for (const spec of G.mapSetpieces) buildSetPiece(spec);
  G.player.mesh.position.set(cx, 0.6, cz);
  G.player.vel.set(0, 0, 0);
  G.player.heading = 0;
  G.player.hp = G.player.maxHp;
  G.player.oobTime = 0;             // fresh run: clear the out-of-bounds timer
  G.player.spawnAge = SPAWN_GROW_TIME; // and any in-progress warp-back animation (back to full size)
  if (G.player.spawnScale) G.player.mesh.scale.copy(G.player.spawnScale);
  G.player._repairAccum = 0; // fresh run: clear banked repair-drone time
  for (const g of Object.values(G.player.groups)) { g.cooldown = 0; g.pending.length = 0; } // reset fire groups
  G.player.alive = true;
  G.earned = 0; G.kills = 0; G.banked = false; // new run: reset session credits + the bank-once guard (balance persists)
  G.gameStartTime = performance.now(); // start timing a new game (for history)
  levelRunner.start(G.activeMission || CATALOG.level); // a chosen side mission overrides the campaign level
  setPaused(false); // a fresh run always starts unpaused (and resets the button to ⏸)
  refreshMusic();   // a live fight → combat music
  el.overlay.style.display = 'none';
  // funnel telemetry: game_start once per session, level_start per run; tag Sentry's scope with the level
  const level = currentLevelLabel();
  if (!G.gameStartSent) { G.gameStartSent = true; track('game_start', { level }); }
  track('level_start', { level });
  if (window.Sentry) try { window.Sentry.setTag('level', level); } catch {}
}
