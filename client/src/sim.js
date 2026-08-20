// The simulation: the per-frame fixed-step `update(dt)`, the level runner (DB phase/wave script), the
// cosmetic helpers (forward vector, wing-bank, soft-boundary warp + OOB warning), music routing, and
// pause control. This sits at the TOP of the dependency graph — it touches almost everything — so it
// imports the leaves (state, engine, world, projectiles, ship-build, net, hud-less) and is itself imported
// only by the composition root (the inline script / main). It never imports the loop's callers.
import * as THREE from 'three';
import { G, bullets, explosions, sparks, shockwaves, rockets, smoke, flipbooks, enemies, setPieces, CATALOG, SPAWN_GROW_TIME, BULLET_PLANE_Y, creditPopups } from './state.js';
import { scene, camera, camOffset } from './engine.js';
import { Device } from './device.js';
import { ARENA, OOB_WARN_DELAY, OOB_RETURN_TIME, arenaCenter, arenaBorder, updateSystemBodies, updateSpeedField, buildSetPiece } from './world.js';
import { shortestAngleDelta } from './sim-core/steering.js';
import { audio, sfxFor } from './sound-routing.js';
import { spawnExplosion, spawnShipExplosion, spawnBossExplosion, updateDeferredBlasts, clearDeferredBlasts, emitExhaust, spawnSmoke, smokePool, spawnShieldHit, spawnEnemyShieldHit, spawnRocketBurst, HIT_FLASH_SCALE, attachBulletBody, detachBulletBody, attachRocketBody, detachRocketBody } from './projectiles.js';
import { updateFlipbooks, spawnHitSprite, SHIELD_HIT_TINT } from './flipbook-fx.js';
import { updateShipExhaust } from './exhaust-fx.js';
import { spawnShieldReady, clearEnemyShieldBubbles } from './shield-fx.js';
import { preloadLevelShipModels, attachEnemyBody, detachEnemyBody } from './ship-build.js';
import { simEvents, world } from './state.js'; // the sim's outbound channel + the World it runs in
import { BANNER_FADE, showBanner as showBannerIn, clearBanner } from './sim-core/events.js';
import { stepBullets, stepRockets } from './sim-core/step-projectiles.js';
import { stepEnemyAI, stepEnemyDeaths, stepPlayerDeath } from './sim-core/step-enemies.js';
import { stepPlayer, PLAYER_MAX_SPEED, warpPlayerToCenter as warpPlayerToCenterIn,
         engageAutopilot as engageAutopilotIn, engageDropAutopilot as engageDropAutopilotIn,
         engagePointAutopilot as engagePointAutopilotIn, cancelAutopilot as cancelAutopilotIn } from './sim-core/step-player.js';
import { runCenter } from './sim-core/level-sim.js';
import { startLevel, updateLevelRunner, winLevel, resetLevelRunnerState, currentPhase } from './sim-core/level-runner.js';
import { drawDrops, preloadRewardModel, ownsReward, clearDrops, takeLoot, attachDropBody, detachDropBody } from './drops.js';
import { stepDrops } from './sim-core/drops-sim.js';
import { track, currentLevelLabel, bankRun, unlockNextLevel, depositLoot, reportMissionCleared } from './net.js';
import { t } from './i18n.js';
import { el } from './dom.js';
import { logEvent, clearEventLog } from './eventlog.js';

// ---------- Music ----------
// Music follows game state: the driving combat mood during a live fight, the calmer hangar mood on
// menus / overlays / while paused. refreshMusic() is cheap + idempotent (no-op when the mood is unchanged).
function musicForState() {
  return (G.gameStarted && G.player && G.player.alive && !levelRunner.won && !G.paused) ? 'combat' : 'hangar';
}
export function refreshMusic() { audio.setScene(musicForState()); }

// ---------- Transient HUD banner ("10 enemies left", "Final Stage") ----------
// A big, semi-transparent line centered on screen that appears at full opacity and fades to 0 over
// `dur` seconds (opacity = life/maxLife, drawn by updateBanner). One slot: a newer banner overrides
// the current one. `firedBanners` guards each milestone so it shows once per run (reset in reset()).
// BANNER_FADE + the two emit helpers live in sim-core/events.js — three different steps raise banners and
// the server has to be able to raise them too. The sim never translates: it names the string and lets the
// adapter resolve it through i18n.
const showBanner = (key, params = null, dur = BANNER_FADE) => showBannerIn(world, key, params, dur);
// Floating "EVADE" text over the ship when a hostile shot is dodged (Maneuver skill). Reuses the
// credit-popup pool/renderer (hud.updateCreditPopups) via a `text` field instead of a credit `amount`.
function spawnEvadePopup(pos) { simEvents.emit({ type: 'evade', pos: pos.clone() }); }
// Draw: apply the current banner's text + fading opacity; hidden while faded out, on menus/overlays,
// or with no player. Ages in update(dt) (so it freezes on pause), like the credit popups.
export function updateBanner() {
  const b = G.banner;
  const show = b.life > 0 && G.player && el.overlay.style.display === 'none';
  if (!show) { el.banner.style.display = 'none'; return; }
  el.banner.style.display = 'block';
  el.banner.textContent = b.text;
  el.banner.style.opacity = String(b.life / b.maxLife);
}

// ---------- Level runner (the object is a proxy; the runner itself is sim-core/level-runner.js) ----------
// The phase/wave script's state lives on the World and its rules are pure functions of it. This object
// exists because eight modules and three visual scenarios read (and one writes) `levelRunner.<field>` —
// so the historical shape is kept and every property forwards to `world.levelRunner`.
const LEVEL_RUNNER_FIELDS = ['level', 'phaseIndex', 'killsAtPhaseStart', 'spawnedThisPhase', 'spawnCooldown',
  'won', 'winPending', 'winText', 'winTextKey', 'returningToBase'];
export const levelRunner = {
  start(level) { startLevel(world, level); },
  update(dt) { updateLevelRunner(world, dt); },
  win() { winLevel(world); },
  resetLevelRunnerState() { resetLevelRunnerState(world); },
  get phase() { return currentPhase(world); },
};
for (const k of LEVEL_RUNNER_FIELDS) {
  Object.defineProperty(levelRunner, k, {
    get: () => world.levelRunner[k],
    set: (v) => { world.levelRunner[k] = v; },
    enumerable: true,
    configurable: true,
  });
}

// ---------- The player step + the autopilot: entry points into sim-core/step-player.js ----------
// The rules moved to sim-core (they must run in Node); these bind THIS tab's World so main.js and
// mainwindow.js keep calling them by their historical names and signatures.
export { PLAYER_MAX_SPEED };
export const warpPlayerToCenter = () => warpPlayerToCenterIn(world);
export const engageAutopilot = () => engageAutopilotIn(world);
export const engageDropAutopilot = (drop) => engageDropAutopilotIn(world, drop);
export const engagePointAutopilot = (pos, mission = null) => engagePointAutopilotIn(world, pos, mission);
export const cancelAutopilot = () => cancelAutopilotIn(world);

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
  const st = G.baseStation.pos, pos = G.player.pos;
  a.position.set(pos.x, 2.5, pos.z);                        // anchored to the ship, just above the plane
  a.rotation.y = Math.atan2(st.x - pos.x, st.z - pos.z);    // point at the station (heading convention)
  a.visible = true;
}
export function updateReturnHint() {
  const show = G.returnToBase && G.player && G.player.alive && !levelRunner.won
    && el.overlay.style.display === 'none';
  if (!show) { el.returnHint.style.display = 'none'; } else {
    el.returnHint.style.display = 'block';
    el.returnHint.textContent = t('ui.return.hint');
  }
  // Bottom-center "Return to base" tap button: same availability as the hint, but ALSO requires the
  // station to be clickable AND the autopilot NOT already engaged (hide it once the ship is flying home;
  // it re-appears if the player cancels the autopilot mid-flight — accepted). Mirrors stationClickable().
  const btnShow = show && G.baseStation && G.baseStation.active && !G.autopilot.active;
  el.returnBtn.style.display = btnShow ? 'block' : 'none';
}
// Roam bottom-center navigation: "Return to Base" (dock autopilot) + "Autopilot to Mission" (fly to the
// active mission). Shown only while roaming. Each button doubles as its OWN cancel — clicking the
// destination you are already flying to drops the autopilot back to manual (main.js), and the `.engaged`
// class marks which one is live so the switch/cancel state reads at a glance. The mission button hides when
// there is no active mission target (G.roamMission null), leaving just "Return to Base".
export function updateRoamNav() {
  const show = G.roam && G.player && G.player.alive && !levelRunner.won && el.overlay.style.display === 'none';
  el.roamNav.style.display = show ? 'flex' : 'none';
  if (!show) return;
  const ap = G.autopilot;
  el.roamReturn.textContent = t('ui.roam.return');
  el.roamReturn.classList.toggle('engaged', ap.active && ap.target?.kind === 'station');
  const hasMission = !!G.roamMission;
  el.roamAutopilot.style.display = hasMission ? 'block' : 'none';
  if (hasMission) {
    el.roamAutopilot.textContent = t('ui.roam.autopilot');
    el.roamAutopilot.classList.toggle('engaged', ap.active && ap.target?.kind === 'point');
  }
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

// ---------- Sim state → scene graph ----------
// The ONE place the simulation's transforms are copied into Three.js. Everything above this line owns
// `pos` / `heading` / `scale` as plain data; everything below (renderer, HUD, FX, camera) reads the meshes.
// The copy is strictly one-way: nothing in the sim reads a mesh back, which is what lets sim-core run
// headless in Node. See docs/plans/server-authoritative-sim.md (Slice A).
//
// Called once per tick from update(), right after the movement steps and BEFORE anything render-side
// (exhaust plumes, FX, the camera) samples a hull pose — so no consumer ever sees a stale transform.
// Entities spawned LATER in the tick (levelRunner enemies, drops) seed their own mesh at spawn.
function syncShipMesh(ship, dt) {
  ship.mesh.position.set(ship.pos.x, ship.pos.y, ship.pos.z);
  ship.mesh.rotation.y = ship.heading;
  ship.mesh.scale.setScalar(ship.scale);
  updateBank(ship, ship.turnRate, dt); // cosmetic wing-bank: a render consequence of how hard it turned
  // Engine plume: the sim flags `thrusting` for this tick, the renderer decides what that looks like.
  // (It used to call emitExhaust mid-step, which meant the simulation reached into the FX layer to say
  // "still burning" — the same coupling the event queue exists to remove.)
  if (ship.thrusting && ship.engine && ship.engine.exhaust) emitExhaust(ship.mesh, null, ship.vel, ship.engine.exhaust);
}

export function syncMeshes(dt = 0) {
  if (G.player) syncShipMesh(G.player, dt);
  for (const e of enemies) syncShipMesh(e, dt);
  for (const b of bullets) b.mesh.position.set(b.pos.x, b.pos.y, b.pos.z); // bolt orientation is baked at spawn
  for (const r of rockets) {
    r.obj.position.set(r.pos.x, r.pos.y, r.pos.z);
    r.obj.rotation.y = r.heading;
  }
}


// ---------- Client adapter: simulation events → presentation ----------
// The sim describes what happened (sim-core/events.js); everything that ACTS on that description lives
// here — FX, audio, the HUD, i18n and the backend. This is the half a headless server replaces with
// "broadcast it to the room", which is why the sim must never do any of it inline.
//
// Drained once per tick at the end of update(). Events therefore land AFTER this tick's FX-ageing steps,
// so a hit flash spawned now is first aged next tick — one frame (~16 ms) later than before, which is
// below anything perceivable and buys a single, predictable ordering point.
//
// Moves to its own `sim-view.js` in Slice B3, once levelRunner's state lives on the World and this file's
// simulation half can leave for sim-core/ without dragging a circular import along.
function applySimEvent(ev) {
  switch (ev.type) {
    case 'hit':
      // enemy struck → the generic zap; our own hull struck → the ship-class sampled impact
      audio.sfx.hit(ev.target === 'player' ? sfxFor('ship', ev.shipClass, 'hit') : undefined);
      break;
    case 'bulletImpact':
      spawnHitSprite(ev.pos, (HIT_FLASH_SCALE[ev.weaponClass] ?? 0.8) * (ev.absorbed ? 0.7 : 1),
        ev.absorbed ? SHIELD_HIT_TINT : null);
      break;
    case 'shieldHit':      spawnShieldHit(ev.pos, ev.broke); break;
    case 'enemyShieldHit': spawnEnemyShieldHit(ev.enemy, ev.pos, ev.broke); break;
    case 'shieldReady':    spawnShieldReady(); break;
    // Handovers back to the UI: the prompts and screen changes these open are the host's, not the sim's.
    case 'missionArrival':   G.onMissionArrival?.(ev.missionId); break;
    case 'baseArrival':      G.onBaseArrival?.(); break;
    case 'missionZoneEnter': G.onMissionZoneEnter?.(); break;
    case 'pickup': {
      audio.sfx.pickup?.(); // small feedback blip
      const it = ev.item;
      const cat = it.kind === 'component' ? CATALOG.components.get(it.refId) : CATALOG.weapons.get(it.refId);
      if (cat) logEvent(t('ui.log.picked_up', { name: cat.name }), cat.color); // pickup line, tinted by the item
      break;
    }
    case 'fire':
      // Enemy fire makes no sound at all — intentional, only your own shots are audible. The weapon's
      // class picks the sample through the DB map; unset falls back to a synthesized zap.
      if (ev.fromPlayer) {
        const sample = sfxFor('weapon', ev.weaponClass, 'fire');
        if (ev.isRocket) audio.sfx.rocket(sample); else audio.sfx.shoot(sample);
      }
      break;
    case 'smoke':          spawnSmoke(ev.pos); break;
    case 'detonate':
      spawnRocketBurst(ev.pos, ev.blastVis, ev.blastTint, ev.blastTime, ev.blastBright); // flipbook fireball + ring
      audio.sfx.explosion(0.7, sfxFor('weapon', ev.weaponClass, 'explode'), 0.3); // 70% quieter than a ship
      break;
    case 'warpFlash':      spawnExplosion(ev.pos); break;
    case 'evade':
      creditPopups.push({ pos: ev.pos, text: t('ui.evade'), evade: true, life: 1.2, maxLife: 1.2 });
      break;
    case 'bannerClear':    G.banner.life = 0; break;
    case 'banner': {
      const dur = ev.dur ?? BANNER_FADE;
      G.banner.text = ev.params ? t(ev.key, ev.params) : t(ev.key);
      G.banner.life = dur; G.banner.maxLife = dur;
      break;
    }
    case 'kill': {
      if (ev.isBoss) spawnBossExplosion(ev.pos, ev.exhaustColor, ev.sizeScale);
      else spawnShipExplosion(ev.pos, ev.exhaustColor, ev.sizeScale);
      // Per-size loudness: medium ships + bosses +50% louder; small ships 70% quieter.
      const louderBoom = ['medium', 'boss', 'advanced_medium_pirate', 'boss2'].includes(ev.role);
      audio.sfx.explosion(ev.sizeScale, sfxFor('ship', ev.shipClass, 'explode'), louderBoom ? 1.5 : 0.3);
      if (ev.reward > 0) { // floating "+xx" green popup at the kill site (cosmetic feedback)
        creditPopups.push({ pos: ev.pos, amount: ev.reward, life: 2.0, maxLife: 2.0 });
      }
      logEvent(t('ui.log.killed', { name: ev.name, amount: ev.reward, xp: ev.xp })); // event-log kill line
      break;
    }
    case 'win': {
      audio.sfx.jingle(true); refreshMusic(); // victory sting + back to the calmer menu music
      el.overlayTitle.textContent = t('ui.overlay.victory');
      // resolve the level's victory line through i18n (key → translation → English fallback)
      const cleared = ev.textKey ? t(ev.textKey) : (ev.text || t('ui.overlay.sector_cleared'));
      el.overlaySub.textContent = `${cleared} — ${t('ui.credits.doubled', { credits: G.earned })}`;
      el.restart.textContent = t('ui.button.continue'); // a win continues to the Hangar
      el.backHangar.style.display = 'none'; // Continue already goes to the Hangar — no separate button on a win
      el.overlay.style.display = 'flex';
      // A ?record/?playback dev session is READ-ONLY: show the victory overlay but do NOT mutate the server —
      // otherwise a (re)played win banks credits, deposits loot AND advances current_progress, silently skipping
      // the level for the real player. All server side effects below are gated on !G.replayMode.
      if (!G.replayMode) {
        track('level_clear', { level: currentLevelLabel() }); // funnel: this level was cleared
        bankRun(); // bank the earned credits into the account balance
        G.flushSession && G.flushSession('win'); // upload the recorded session (funnel analytics)
        const loot = takeLoot(); if (loot.length) depositLoot(loot); // victory only: dump the run's collected drops into the stash
        // Side missions are repeatable grind: bank credits but do NOT advance the story counter. Campaign
        // levels advance progression as before.
        const lvl = levelRunner.level;
        if (lvl && !lvl.sideMission) unlockNextLevel(); // record progress + load the next level for the next Restart
        else if (lvl && lvl.missionId) reportMissionCleared(lvl.missionId); // permanent side-mission clear → `minMission` shop unlocks
      }
      break;
    }
    case 'death': {
      spawnShipExplosion(G.player.pos, G.player.engine.exhaust.color, 1); // tinted by engine exhaust
      audio.sfx.explosion(1.5, sfxFor('ship', G.player.class, 'explode')); audio.sfx.jingle(false); refreshMusic(); // sampled boom + loss sting, back to menu music
      track('player_death', { level: currentLevelLabel(), kills: G.kills }); // funnel: where players die
      bankRun(); // bank the earned credits into the account balance + record the game
      G.flushSession && G.flushSession('death'); // upload the recorded session (funnel analytics)
      el.overlayTitle.textContent = t('ui.overlay.ship_destroyed');
      el.overlaySub.textContent = t('ui.gameover.sub', { kills: G.kills, credits: G.earned });
      el.restart.textContent = t('ui.button.restart'); // a loss retries the level
      // once the shop is unlocked, offer returning to the hangar (shop/loadout) instead of an instant retry
      el.backHangar.style.display = (G.activeShip && G.activeShip.shopUnlocked) ? 'inline-block' : 'none';
      el.overlay.style.display = 'flex';
      break;
    }
    default: break; // an unknown event is not worth crashing a frame over
  }
}

// ---------- The browser's host: what a World entity's body IS here ----------
// sim-core creates entities as data and asks its host to give them a body (sim-core/world.js). In this tab
// that means a Three.js object in the scene; in Node it means nothing at all, which is the entire point —
// the same spawn code runs in both places and only this object differs. Installed at module load, before
// any gameplay can start (main.js imports this file during bootstrap).
world.host = {
  onSpawn(kind, e) {
    if (kind === 'bullet') attachBulletBody(e);
    else if (kind === 'rocket') attachRocketBody(e);
    else if (kind === 'enemy') attachEnemyBody(e);
    else if (kind === 'drop') attachDropBody(e);
  },
  // Fetch + parse every model this level can put on screen, BEFORE the fight: the enemy ships and the
  // last-kill reward drop. Without it the first spawn of each type pays for a CloudFront fetch, a parse and
  // a texture upload on the frame it appears, which a weak phone feels as a freeze.
  onWarmLevel(level) {
    if (!level) return;
    preloadLevelShipModels(level);
    const lkd = level.lastKillDrop;
    if (lkd && !ownsReward(lkd)) preloadRewardModel(lkd);
  },
  onDespawn(kind, e) {
    if (kind === 'bullet') detachBulletBody(e);
    else if (kind === 'rocket') detachRocketBody(e);
    else if (kind === 'enemy') detachEnemyBody(e);
    else if (kind === 'drop') detachDropBody(e);
  },
};

// The tick, in two halves.
//
// `simTick` is the game: everything that decides what happened. `renderTick` is the picture: the scene
// graph copy, the queued events turned into sight and sound, the FX ageing, the camera. Only the first
// half will exist on a server, which is the whole point of separating them.
//
// The two used to be INTERLEAVED — FX ageing sat between the movement steps and the deaths — and that
// order was preserved through Slices A–B3b on purpose, because reordering is a behaviour change dressed up
// as tidying. It is reordered here deliberately, and the reason it is safe is that no presentation step
// reads or writes simulation state: the FX pools only age themselves. What DOES shift is when FX created
// during this tick first age — by one tick, ~16 ms, on effects that live 0.06–2 s. The recorded intro
// trace is the check that the simulation itself did not move.
export function simTick(dt) {
  world.combatElapsed += dt; // unpaused combat clock (skipped while paused) — drives the enemy hold-fire grace

  stepPlayer(world, dt);   // repair/shield, control or autopilot, speed cap, arena drift + soft boundary, firing
  stepEnemyAI(world, dt);
  stepBullets(world, dt);
  stepRockets(world, dt);
  stepEnemyDeaths(world);
  grabTarget = stepDrops(world, dt); // the Grab: arm, pull, collect (drawn in renderTick)
  levelRunner.update(dt);            // spawning + phase transitions from the active level
  stepPlayerDeath(world);
}

// Whatever the Grab is currently pulling, handed from simTick to renderTick. Presentation only.
let grabTarget = null;

// The soft-boundary edge marker: it sits at the (possibly drifting) arena centre and brightens as the ship
// approaches the wall, brightest while outside. Pure presentation derived from where the ship IS — it used
// to be written from inside stepPlayer, which meant the simulation was setting a material's opacity.
function drawArenaBorder() {
  const p = world.player.pos;
  arenaBorder.line.position.set(arenaCenter.x, 0, arenaCenter.z);
  const dxc = p.x - arenaCenter.x, dzc = p.z - arenaCenter.z;
  const edge = Math.max(Math.abs(dxc), Math.abs(dzc));
  const near = Math.min(1, Math.max(0, (edge - (ARENA - 60)) / 60));
  const oob = Math.abs(dxc) > ARENA || Math.abs(dzc) > ARENA;
  arenaBorder.mat.opacity = 0.12 + near * 0.5 + (oob ? 0.25 : 0);
}

export function renderTick(dt) {
  syncMeshes(dt);                 // sim transforms → scene graph
  drawArenaBorder();
  simEvents.drain(applySimEvent); // everything the sim decided this tick, turned into sight and sound
  drawDrops(grabTarget, dt);      // crate spin + the blue pull beam

  stepMicroExplosions(dt);
  updateFlipbooks(dt);            // sprite-sheet explosions: advance frame, fade + drop when finished
  updateDeferredBlasts(dt);       // boss chain-detonations: fire each staged blast when its delay elapses
  // engine exhaust: advance every ship's attached plume (uTime) + decay its thrust throttle so a ship that
  // stops thrusting fades out. Fixed-cost render objects, not a growing pool (exhaust-fx.js).
  updateShipExhaust(dt);
  stepSparks(dt);
  stepShockwaves(dt);
  stepBannerFade(dt);
  stepCreditPopups(dt);
  // AFTER the drain, deliberately: stepSmokeTrail rebuilds the instanced puff pool from `smoke[]`, so it
  // has to run once the adapter has actually created this tick's puffs, or the newest puff is never drawn.
  stepSmokeTrail(dt);

  settleView(dt); // camera rigid-follow + stars + system-body bearings + speed-field wrap
  for (const sp of setPieces) sp.update?.(dt); // set-pieces animate themselves (station spin, beams, …)
}

// One tick of the live game. Kept under its historical name and signature — main.js's accumulator, the
// replay stepper and every ?debug hook call this.
export function update(dt) {
  if (!G.gameStarted || !G.player.alive || levelRunner.won) return; // idle on the welcome screen / frozen on death/victory
  simTick(dt);
  renderTick(dt);
}

function stepMicroExplosions(dt) {
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
}

function stepSmokeTrail(dt) {
  // --- rocket smoke trail: fixed-size puffs that only fade (a thin dissipating line, not a cone) ---
  // Drawn as ONE instanced call for the whole trail (particle-pool.js), so the cost no longer scales with
  // puff count. Each puff keeps its OWN position, size and alpha — the fade rides a per-instance attribute,
  // which is what stops the trail from blinking out in unison. Puffs never move after birth: the trail's
  // shape is simply the sequence of points the rocket passed through, so a curving flight curves the trail.
  smokePool.begin();
  for (let i = smoke.length - 1; i >= 0; i--) {
    const s = smoke[i];
    s.life -= dt;
    const t = 1 - Math.max(0, s.life) / s.maxLife; // 0 → 1
    if (s.life <= 0) { smoke.splice(i, 1); continue; }
    // no scale change — fixed-size puffs form a thin dissipating line (baseSize set once at spawn)
    smokePool.push(s.pos, s.baseSize, 1 - t);       // fade out only (the pool's material carries the 0.4 base)
  }
  smokePool.end();
}

function stepSparks(dt) {
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
}

function stepShockwaves(dt) {
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
}

function stepBannerFade(dt) {
  // --- transient banner: fade the centered announcement toward invisible (drawn by updateBanner) ---
  if (G.banner.life > 0) G.banner.life = Math.max(0, G.banner.life - dt);
}

function stepCreditPopups(dt) {
  // --- credit popups: "+xx" gold text that floats up and fades over ~1s (drawn by hud.js) ---
  for (let i = creditPopups.length - 1; i >= 0; i--) {
    creditPopups[i].life -= dt;
    if (creditPopups[i].life <= 0) creditPopups.splice(i, 1);
  }
}

// Position the camera + sky backdrop (stars, the fixed-position star-system bodies) AND the player-locked
// speed field on the player. Called at the end of every update(), AND once right after reset() by the
// replay/cutscene start so a FROZEN pre-fight frame (the Level-0 opening card) is already correctly framed —
// otherwise the camera/backdrop sit at the pre-reset spot and visibly JUMP when the re-sim's first tick runs.
//
// This is the VIEW layer: everything here is render-only and MUST stay out of the deterministic tick. The
// star-system backdrop placement and the speed-field wrap both draw no randomness and touch no sim state
// (DECISIONS §73/§96/§98).
export function settleView(dt = 0) {
  // camera: rigidly attached to the player (no lag/floating), fixed angle (does NOT rotate with the ship's turn)
  camera.position.copy(G.player.pos).add(camOffset);
  // Components, NOT the vector: THREE's Object3D.lookAt branches on `x.isVector3` and silently falls
  // through to `set(x, undefined, undefined)` for anything else — which NaNs the camera's quaternion and
  // renders nothing, with no error thrown. A sim-core Vec3 is duck-compatible with everything that merely
  // READS x/y/z (`copy`, `Matrix4.compose`, …) but not with THREE APIs that type-test. See vec.js.
  camera.lookAt(G.player.pos.x, G.player.pos.y, G.player.pos.z);
  G.stars.position.copy(camera.position); // stars: an infinitely distant backdrop stuck to the camera (no parallax)
  updateSystemBodies();                    // star + 4 planets + moons: fixed bodies, group rides camera − parallax
  updateSpeedField(G.player.pos.x, G.player.pos.z); // player-locked backdrop (view-only, no RNG)
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
// `keepPlayer` — start the level WITHOUT moving the ship. Used when a mission begins because you FLEW to
// it: you are already at the fight, and yanking the ship to the arena centre would undo the trip you just
// made. Everything else about the run is still fresh (enemies, drops, counters, hp, the seeded stream).
// `keepWorld` — do not tear down and rebuild the map's set-pieces. They are shared, fixed-position decor
// that is IDENTICAL before and after, so rebuilding them re-fetches and re-parses every `.glb` in the map
// (7 of them here) for no visible change — which is exactly the hitch you feel when a mission starts under
// you. Only used when the fight begins in a world that is already standing (the roam → combat handover);
// a cold start still rebuilds, which is what resets the cruising freighter to its start.
export function reset({ keepPlayer = false, keepWorld = false } = {}) {
  for (const b of bullets) world.host.onDespawn('bullet', b);
  bullets.length = 0;
  for (const x of explosions) { scene.remove(x.mesh); x.mesh.material.dispose(); }
  explosions.length = 0;
  for (const r of rockets) world.host.onDespawn('rocket', r);
  rockets.length = 0;
  smoke.length = 0; smokePool.clear(); // pooled: the instanced mesh + material are kept, only the live count resets
  for (const s of sparks) { scene.remove(s.mesh); s.mesh.material.dispose(); }
  sparks.length = 0;
  for (const w of shockwaves) { scene.remove(w.mesh); w.mesh.material.dispose(); }
  shockwaves.length = 0;
  for (const fb of flipbooks) { scene.remove(fb.mesh); fb.mat.dispose(); }
  flipbooks.length = 0;
  clearDeferredBlasts(); // drop any pending boss chain-detonations so a restart can't fire stale blasts
  creditPopups.length = 0; // DOM-only, no scene meshes to dispose
  clearEnemyShieldBubbles(); // hide + unbind pooled enemy shield bubbles (no cross-run leaks)
  clearDrops(); // remove drop meshes + the pull line; DISCARD any uncollected/un-deposited loot on a fresh run
  clearEventLog(); // start a fresh run with an empty event log
  simEvents.clear(); // and no events left over from an aborted tick (e.g. a win drained into a teardown)
  G.autopilot.active = false; G.autopilot.target = null; // defensive: no dangling drop-target autopilot into the new run

  for (const e of enemies) world.host.onDespawn('enemy', e);
  enemies.length = 0;
  // Where this run fights: a side mission's own `center`, else the campaign level's (most use the default
  // (0,0); "Level 3" fights at the space factory, "Level 4" inside the far belt outpost). Resolved by the
  // pure `runCenter` seam — see level-sim.js.
  const { x: cx, z: cz } = runCenter(G.activeMission, CATALOG.level);
  arenaCenter.set(cx, 0, cz);             // fresh run: center the (possibly drifting) combat zone
  arenaBorder.line.position.set(cx, 0, cz);
  // a mission may drift its zone (the freighter escort); the campaign and other missions stay static
  world.arenaDrift = (G.activeMission && G.activeMission.drift)
    ? { x: G.activeMission.drift.x || 0, z: G.activeMission.drift.z || 0 } : null;
  // rebuild the shared world's set-pieces fresh each run (resets the cruising freighter to its start)
  if (!keepWorld) {
    for (const sp of setPieces) { sp.dispose?.(); scene.remove(sp.obj); } // dispose() frees the freighter plume's materials (no-op for others)
    setPieces.length = 0;
    for (const spec of G.mapSetpieces) buildSetPiece(spec);
  }
  // Ambient distant ghost battle: shown in every mission EXCEPT the freighter escort (you're IN that fight
  // there). Anchored at a fixed ABSOLUTE world point (default -100,-450, once the freighter's spot; ghost-battle.js)
  // — a distant landmark the player flies toward. Dynamic import → off the initial bundle + avoids a static
  // sim.js↔world.js↔ghost-battle.js cycle; self-gates on tier/?debug/?bench. It adds its group to scene AND
  // pushes a setPieces entry, so the teardown loop above removes it on the next reset (universal cleanup path).
  if (!G.roam && G.activeMission?.title !== 'freighter') {
    import('./ghost-battle.js').then((m) => m.buildGhostBattle()).catch(() => {}); // async; distant decor (never in roam)
  }
  // WHERE THE SHIP GOES. Three cases, and only one of them moves it:
  //   • roam (Take off) — you launch from your HOME STATION and fly to the mission yourself, so the spawn is
  //     the origin no matter where this level fights. Take off is never a teleport to the mission.
  //   • `keepPlayer` — the mission just started because you ARRIVED: leave the ship exactly where it is and
  //     let the enemies come to you. Heading and velocity are kept too, so the fight opens mid-flight
  //     instead of snapping you to a standstill facing +Z.
  //   • otherwise — a normal level start (retry, or a level that begins where you already are): centre it.
  if (!keepPlayer) {
    const spawn = G.roam ? { x: 0, z: 0 } : { x: cx, z: cz };
    G.player.pos.set(spawn.x, BULLET_PLANE_Y, spawn.z);
    G.player.heading = 0;                                // forward = +Z (forwardVec(0) = (0,0,1))
    G.player.vel.set(0, 0, PLAYER_MAX_SPEED * 0.1);      // open the fight already gliding forward at 10% of top speed (3 u/s)
  }
  G.player.hp = G.player.maxHp;
  G.player.oobTime = 0;             // fresh run: clear the out-of-bounds timer
  G.player.spawnAge = SPAWN_GROW_TIME; // and any in-progress warp-back animation (back to full size)
  G.player.scale = G.player.fullScale;  // and any in-progress warp shrink
  G.player._repairAccum = 0; // fresh run: clear banked repair-drone time
  G.player._shieldValue = G.player.shield ? G.player.shield.capacity : 0; // fresh run: shield full & active
  G.player._shieldRechargeAccum = 0;
  for (const g of Object.values(G.player.groups)) { g.cooldown = 0; g.pending.length = 0; } // reset fire groups
  G.player.alive = true;
  G.earned = 0; G.earnedXp = 0; G.kills = 0; G.banked = false; // new run: reset session credits/XP + the bank-once guard (balance persists)
  G.enemyShieldRefills = 0; // diagnostic: completed enemy shield refills this run (replay triage)
  // The level's scene is now built (set-pieces, arena, player). Ask the render loop to compile + upload it
  // BEFORE the fight instead of during it — a weak phone otherwise spends 10+ s of the first 15 blocked on
  // lazy shader compiles and texture uploads (see prewarmShaders in main.js).
  G.needsSceneWarm = true;
  G.gameStartTime = performance.now(); // start timing a new game (for history)
  G.combatElapsed = 0;  // fresh run: restart the enemy hold-fire grace clock
  arenaBorder.line.visible = !G.roam; // the soft-boundary edge marker is a combat cue only — hidden while roaming
  // ROAM: no levelRunner (level = null → its update() early-returns → NO spawns), but clear the SAME shared
  // return-to-base/win/banner state start() would (so a prior mission win's `won:true` can't freeze the
  // roaming ship). COMBAT: start() the chosen mission / campaign level exactly as before.
  if (G.roam) {
    levelRunner.level = null; levelRunner.resetLevelRunnerState();
    // …and make the home station clickable for the whole roam, the way beginReturn() does after the last
    // kill: while flying freely you can always click home to be flown back and offered a dock.
    if (G.baseStation) G.baseStation.active = true;
  } else levelRunner.start(G.activeMission || CATALOG.level); // a chosen side mission overrides the campaign level
  // Push the fresh sim state into the scene graph NOW, before a single frame is drawn. reset() teleports
  // the ship (and restores its full scale), and the very next thing a replay/cutscene start does is call
  // settleView() to frame a FROZEN pre-fight card — with no sync the camera would sit at the new position
  // while the hull was still drawn at the old one. No test asserts on that frame, so it has to be reasoned
  // about rather than caught. dt=0 → the cosmetic bank is re-based without rolling the ship.
  syncMeshes(0);
  setPaused(false); // a fresh run always starts unpaused (and resets the button to ⏸)
  refreshMusic();   // a live fight → combat music
  el.overlay.style.display = 'none';
  // funnel telemetry: game_start once per session, level_start per run; tag Sentry's scope with the level
  const level = currentLevelLabel();
  if (!G.gameStartSent) { G.gameStartSent = true; track('game_start', { level }); }
  track('level_start', { level });
  if (window.Sentry) try { window.Sentry.setTag('level', level); } catch {}
}
