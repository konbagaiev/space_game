// The loop and the PICTURE half of it. The rules themselves have left: every step of `simTick` now lives
// in `sim-core/` and takes the World, which is what lets the same fight run in Node. What is left here is
// the browser's side of that arrangement, and it is a real job:
//
//   • `update(dt)` = `simTick(dt)` + `renderTick(dt)` — the fixed-step tick, under its historical name
//     because main.js's accumulator, the replay stepper and every ?debug hook call it;
//   • the browser HOST — what an entity's body IS here: a Three.js object in the scene (`world.host`);
//   • the ADAPTER — the 19 simulation events turned into FX, audio, the HUD, i18n and the backend;
//   • the scene-graph copy (`syncMeshes`), the cosmetic wing-bank and the FX-ageing steps;
//   • the DOM readouts the fight drives: the banner, the OOB warning, the return arrow/hint, roam nav;
//   • music routing, pause, and the scene half of `reset()` (its simulation half is sim-core/reset-world.js);
//   • thin binds of the sim-core entry points every other module already imports by name from here
//     (`levelRunner`, `warpPlayerToCenter`, the four autopilot verbs).
//
// This sits at the TOP of the dependency graph — it touches almost everything — so it imports the leaves
// (state, engine, world, projectiles, ship-build, net, hud-less) and is itself imported only by the
// composition root (the inline script / main). It never imports the loop's callers.
import * as THREE from 'three';
import { G, bullets, explosions, sparks, shockwaves, rockets, smoke, flipbooks, enemies, allies, setPieces, CATALOG, creditPopups } from './state.js';
import { scene, camera, camOffset } from './engine.js';
import { Device } from './device.js';
import { ARENA, OOB_WARN_DELAY, OOB_RETURN_TIME, arenaCenter, arenaBorder, updateSystemBodies, updateSpeedField, updateBackdropLayer, buildSetPiece } from './world.js';
import { shortestAngleDelta } from './sim-core/steering.js';
import { audio, sfxFor } from './sound-routing.js';
import { spawnExplosion, spawnShipExplosion, spawnBossExplosion, updateDeferredBlasts, clearDeferredBlasts, emitExhaust, spawnSmoke, smokePool, spawnShieldHit, spawnEnemyShieldHit, spawnRocketBurst, HIT_FLASH_SCALE, attachBulletBody, detachBulletBody, attachRocketBody, detachRocketBody } from './projectiles.js';
import { updateFlipbooks, spawnHitSprite, SHIELD_HIT_TINT } from './flipbook-fx.js';
import { updateShipExhaust } from './exhaust-fx.js';
import { spawnShieldReady, clearEnemyShieldBubbles } from './shield-fx.js';
import { preloadLevelShipModels, attachEnemyBody, detachEnemyBody, attachAllyBody, detachAllyBody } from './ship-build.js';
import { simEvents, world } from './state.js'; // the sim's outbound channel + the World it runs in
import { BANNER_FADE, showBanner as showBannerIn } from './sim-core/events.js';
import { PLAYER_MAX_SPEED, warpPlayerToCenter as warpPlayerToCenterIn,
         engageAutopilot as engageAutopilotIn, engageDropAutopilot as engageDropAutopilotIn,
         engagePointAutopilot as engagePointAutopilotIn, cancelAutopilot as cancelAutopilotIn } from './sim-core/step-player.js';
import { startLevel, updateLevelRunner, winLevel, finishMission as finishMissionIn, resetLevelRunnerState, currentPhase } from './sim-core/level-runner.js';
import { clearAndPlaceRun, startRun } from './sim-core/reset-world.js';
import { simTick as simTickIn } from './sim-core/tick.js';
import { drawDrops, preloadRewardModel, ownsReward, hideGrabLine, takeLoot, attachDropBody, detachDropBody } from './drops.js';
import { drawBeamSight, startBeamCharge, startHostileBeamCharge, spawnBeamBolt, hideBeamFx } from './beam-fx.js';
import { track, currentLevelLabel, bankRun, commitLevelAdvance, loadAdvancedLevel, depositLoot,
         reportMissionCleared, refreshAfterRoomBank } from './net.js';
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
  'won', 'cleared', 'finishing', 'winPending', 'winText', 'winTextKey', 'returningToBase'];
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
// Click-to-fly goes to whoever is simulating. In single-player that is this World; under `?netsim` the room
// owns the autopilot and `world.onCommand` forwards the intent to it — engaging it locally would set a flag
// on a World nobody steps, which is exactly why clicking the station did nothing in a room.
const command = (cmd) => { world.onCommand(cmd); return true; };
export const engageAutopilot = () => (world.onCommand ? command({ kind: 'station' }) : engageAutopilotIn(world));
export const engageDropAutopilot = (drop) => (world.onCommand ? command({ kind: 'drop', drop }) : engageDropAutopilotIn(world, drop));
export const engagePointAutopilot = (pos, mission = null) => (world.onCommand
  ? command({ kind: 'point', pos: { x: pos.x, z: pos.z }, mission: mission || null })
  : engagePointAutopilotIn(world, pos, mission));
export const cancelAutopilot = () => (world.onCommand ? command({ cancel: true }) : cancelAutopilotIn(world));

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
// The homing arrow, pointing at the station. Still shown in a cleared sector: flying home is one of the two
// ways to end a mission (DECISIONS §132), so the direction is real information, not an instruction.
export function updateReturnArrow() {
  const on = (G.returnToBase || G.roam) && G.player && G.player.alive && !levelRunner.won && G.baseStation;
  if (!on) { if (returnArrow) returnArrow.visible = false; return; }
  const a = ensureReturnArrow();
  const st = G.baseStation.pos, pos = G.player.pos;
  a.position.set(pos.x, 2.5, pos.z);                        // anchored to the ship, just above the plane
  a.rotation.y = Math.atan2(st.x - pos.x, st.z - pos.z);    // point at the station (heading convention)
  a.visible = true;
}
// The cleared-sector prompt and its button. The button ENDS the mission outright (DECISIONS §132) rather
// than flying the ship home, so unlike the old "Return to base" it stays up for as long as the mission is
// open — including while the ship IS flying home under autopilot, where it is the shortcut past the trip.
export function updateReturnHint() {
  const show = G.returnToBase && G.player && G.player.alive && !levelRunner.won
    && el.overlay.style.display === 'none';
  if (!show) { el.returnHint.style.display = 'none'; } else {
    el.returnHint.style.display = 'block';
    el.returnHint.textContent = t('ui.return.hint');
  }
  el.returnBtn.style.display = show ? 'block' : 'none';
}

// End the mission — "Finish and Return". Settles it (salvage + the campaign advance) and flies the ship
// home; arrival closes it. In a server-run room the ROOM owns the world, so this travels as a command
// exactly like click-to-fly does. Returns whether it took (false before the sector is cleared, or if the
// player has already pressed it).
export function finishMission() {
  if (world.onCommand) { command({ kind: 'finish' }); return true; }
  return finishMissionIn(world);
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
  for (const a of allies) syncShipMesh(a, dt); // the wingman is a ship like any other (empty in every shipped level)
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

// How much of the `beamCharge` SAMPLE is the CHARGE — and this is NOT the file's length.
//
// The file is 1.400 s: three concatenated pieces whose first 1.0 s is the build-up and whose last 0.4 s is
// a tail deliberately cut to run OVER AND AFTER the discharge. Divided by the weapon's own `chargeTime`
// this gives the playback rate that fits the build to the charge window exactly (1.0 at the shipped 1.0 s
// charge), leaving the overrun to ring out across the shot.
//
// **Using the file's 1.4 s here would be the bug this constant exists to prevent:** the clip would play
// 40 % fast and the source's own crack — which sits precisely at the 1.0 s mark — would land ahead of the
// beam leaving the ship. Tied to the CUT, not to the weapon: if the clip is ever re-cut, measure where its
// build ends and move this number with it.
const BEAM_CHARGE_CLIP_SEC = 1.0;

function applySimEvent(ev) {
  switch (ev.type) {
    case 'hit':
      // OUR OWN hull struck → the ship-class sampled impact. Anything else — an enemy, or the wingman's
      // hull ('ally') — gets the generic zap: only the player's own ship is worth a sampled sound.
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
    // THE CHARGED BEAM, in two beats. `beamCharge` opens the 1.0 s swell; `beamFire` is the release. Both
    // resolve their sample through the event's OWN `weaponClass` — never a hardcoded 'beam' — so a second
    // beam row with its own class gets its own charge and discharge samples.
    //
    // The PLAYER's charge clock and the audio are both gated on `ev.fromPlayer`. The audio for the usual
    // reason — only your own shots are audible, and the beam makes no exception. The clock because the
    // player's own sight is a single always-on corridor: a wingman handed a beam must not brighten it and
    // stop it again on his own release. A HOSTILE's charge is no longer that problem — it has its own
    // per-shooter pool in `beam-fx.js`, keyed on the shooter the event now carries (DECISIONS §135's gate).
    case 'beamCharge':
      if (ev.fromPlayer) {
        startBeamCharge(ev.dur);
        // The clip is stretched to fill the charge window exactly: `rate = clip length / chargeTime`, so
        // retuning chargeTime can never desync the bang from the shot. An EXPLICIT rate also suppresses the
        // random per-shot pitch jitter sfx.shoot applies by default — a timing cue must sound identical
        // every time.
        audio.sfx.shoot(sfxFor('weapon', ev.weaponClass, 'charge'), { rate: BEAM_CHARGE_CLIP_SEC / (ev.dur || 1) });
      } else if (ev.ship) {
        // A HOSTILE is charging: draw its corridor, in the hostile hue, for exactly its `dur`. SILENT — only
        // your own shots are audible, and the beam makes no exception (DECISIONS §135's gate names the sight
        // and the wire ref, not a sound). `ev.ship` is the live entity locally and the rehydrated GHOST in a
        // room; beam-fx accepts it only if it is in world.enemies, so an ally's beam never draws red.
        startHostileBeamCharge(ev.ship, ev.dur);
      }
      break;
    case 'beamFire':
      spawnBeamBolt(ev.from, ev.to, !!ev.fromPlayer); // the bolt is drawn whoever fired it
      if (ev.fromPlayer) audio.sfx.shoot(sfxFor('weapon', ev.weaponClass, 'fire'), { rate: 1 });
      break;
    case 'smoke':          spawnSmoke(ev.pos); break;
    case 'detonate':
      spawnRocketBurst(ev.pos, ev.blastVis, ev.blastTint, ev.blastTime, ev.blastBright); // flipbook fireball + ring
      audio.sfx.explosion(0.7, sfxFor('weapon', ev.weaponClass, 'explode'), 0.3); // 70% quieter than a ship
      break;
    // THE WINGMAN WENT DOWN. The FX is the entire announcement: no banner, no log line and no new string —
    // player-facing copy for him is out of scope (docs/plans/combat-ally.md §2) — but a friendly ship that
    // simply vanished would read as a bug. Same explosion + boom an enemy of his size gets; no credit popup,
    // because he was never worth anything.
    case 'allyDown':
      spawnShipExplosion(ev.pos, ev.exhaustColor, ev.sizeScale);
      audio.sfx.explosion(ev.sizeScale, sfxFor('ship', ev.shipClass, 'explode'), 1.5);
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
      // The event log is the PLAYER's own tally, so an ally's kill writes no line: "X destroyed +0 · +0 XP"
      // would be a lie, and there is no new string to describe a wingman's kill in this step. One-line flip
      // if the maintainer wants it back (docs/plans/combat-ally.md).
      if (!ev.byAlly) logEvent(t('ui.log.killed', { name: ev.name, amount: ev.reward, xp: ev.xp })); // event-log kill line
      break;
    }
    // THE REWARD LANDS HERE — the win condition was met (DECISIONS §130). Everything with a server side
    // effect hangs off `cleared`, not off docking, so a pilot shot down on the flight home keeps what they
    // cleared the sector for. The overlay is NOT here: the mission is not over, the ship is still flying.
    case 'cleared': {
      // A ?record/?playback dev session is READ-ONLY: replay the fight but do NOT mutate the server —
      // otherwise a (re)played clear banks credits, deposits loot AND advances current_progress, silently
      // skipping the level for the real player.
      if (!G.replayMode) {
        track('level_clear', { level: currentLevelLabel() }); // funnel: this level was cleared
        G.flushSession && G.flushSession('win'); // upload the recorded session (funnel analytics)
        // WHO banks depends on who simulated the fight (DECISIONS §131). A server-run room decided the
        // reward itself from the same `cleared` event and has already written it, under a playerId it took
        // from the handshake ticket rather than from anything this tab said — so here we only catch up with
        // the account. Everything else in this block is progression, not currency, and stays the tab's job.
        if (G.netDriving) {
          refreshAfterRoomBank();
        } else {
          bankRun(); // bank the earned credits + XP into the account balance
          const loot = takeLoot(); if (loot.length) depositLoot(loot); // the run's collected drops → the stash
        }
        const lvl = levelRunner.level;
        // A side mission's permanent clear flag is a reward too (it unlocks `minMission` shop rows) and
        // costs nothing to record now. The CAMPAIGN advance is deliberately NOT here — see the `win` case.
        if (lvl && lvl.sideMission && lvl.missionId) reportMissionCleared(lvl.missionId);
      }
      break;
    }
    // The player ended it: the salvage is swept and the ship is flying home. Everything that must survive a
    // reload of the tab happens HERE (DECISIONS §133) — the stash deposit and the server-side half of the
    // campaign advance. The tab-side half waits for the ship to stop; see `win`.
    case 'finishing': {
      if (!G.replayMode) {
        if (!G.netDriving) { const loot = takeLoot(); if (loot.length) depositLoot(loot); } // a room deposits its own
        const lvl = levelRunner.level;
        if (lvl && !lvl.sideMission) commitLevelAdvance(); // progress is now safe even if the flight is abandoned
      }
      break;
    }
    // The ship ARRIVED — the mission is closed. Ceremony, exit, and only now the half of the advance that
    // rebuilds the ship and the map, which needs everything standing still.
    case 'win': {
      audio.sfx.jingle(true); refreshMusic(); // victory sting + back to the calmer menu music
      el.overlayTitle.textContent = t('ui.overlay.victory');
      // resolve the level's victory line through i18n (key → translation → English fallback)
      const clearedLine = ev.textKey ? t(ev.textKey) : (ev.text || t('ui.overlay.sector_cleared'));
      el.overlaySub.textContent = `${clearedLine} — ${t('ui.credits.doubled', { credits: G.earned })}`;
      el.restart.textContent = t('ui.button.continue'); // a win continues to the Hangar
      el.backHangar.style.display = 'none'; // Continue already goes to the Hangar — no separate button on a win
      el.overlay.style.display = 'flex';
      if (!G.replayMode) {
        // Anything still pending reaches the stash — `takeLoot` drains what it takes, so this cannot
        // double-count what `finishing` already deposited. In a room the crates are the room's to deposit.
        if (!G.netDriving) { const late = takeLoot(); if (late.length) depositLoot(late); }
        // The tab-side half of the advance, and it waits for HERE deliberately: `loadAdvancedLevel`
        // rebuilds the PLAYER (`buildPlayerFor` — Level 2's briefing swaps a weapon) and a fresh player
        // starts at the spawn point, so running it mid-flight would teleport the ship out from under the
        // autopilot bringing it home. The server-side half was committed at `finishing`, so the progress
        // is already safe whether or not this ever runs.
        const lvl = levelRunner.level;
        if (lvl && !lvl.sideMission) loadAdvancedLevel();
      }
      // The mission is over, so a server-run room has nothing left to simulate — release it (§132). The
      // menu reconnects for the next run by itself. Outside the replay gate deliberately: a link is a link
      // whether or not this tab is allowed to mutate the account.
      if (G.netDriving && G.dropNetsim) G.dropNetsim();
      break;
    }
    case 'death': {
      spawnShipExplosion(G.player.pos, G.player.engine.exhaust.color, 1); // tinted by engine exhaust
      audio.sfx.explosion(1.5, sfxFor('ship', G.player.class, 'explode')); audio.sfx.jingle(false); refreshMusic(); // sampled boom + loss sting, back to menu music
      track('player_death', { level: currentLevelLabel(), kills: G.kills }); // funnel: where players die
      // Both are no-ops when the mission was already CLEARED (shot down on the flight home): `G.banked`
      // guards the bank and the recorder is closed after its final flush. That is the point of §130 — the
      // reward was secured at the last kill and the way home cannot take it back. Loot the grab pulled in
      // AFTER the clear is lost, though, the same as anything unbanked has always been.
      if (G.netDriving) refreshAfterRoomBank(); else bankRun(); // the room banks its own runs (§131)
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
    else if (kind === 'ally') attachAllyBody(e);
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
    else if (kind === 'ally') detachAllyBody(e);
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
// as tidying. It was reordered deliberately, and the reason it is safe is that no presentation step reads
// or writes simulation state: the FX pools only age themselves. What DOES shift is when FX created during
// this tick first age — by one tick, ~16 ms, on effects that live 0.06–2 s. The recorded intro trace is
// the check that the simulation itself did not move.
//
// The game half is `sim-core/tick.js` now and takes the World; this binds it to THIS tab's fight and keeps
// the grab target for renderTick. Kept exported under its own name — the ?debug hooks step it directly.
export function simTick(dt) { grabTarget = simTickIn(world, dt); }

// Whatever the Grab is currently pulling, handed from simTick to renderTick. Presentation only. Under
// `?netsim` the Grab runs in the room, so the target arrives in a snapshot instead — main.js sets it.
let grabTarget = null;
export function setGrabTarget(t) { grabTarget = t; }

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
  // The charged beam's green aiming sight (three lines + reticle + muzzle bead). A no-op when the player
  // has no beam mounted — but it still ages the bolt/bloom/charge transients, so a discharge finishes
  // fading even if the ship dies in the same instant.
  drawBeamSight(dt);

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
  updateBackdropLayer();                   // the additive nebula layer: tracks the camera at a FRACTION of its motion (real parallax)
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
// The fight's half of this is sim-core's, in TWO calls with the set-piece rebuild between them
// (clearAndPlaceRun → scenery → startRun); reset-world.js explains why that order is not negotiable.
// `keepPlayer` — start the level WITHOUT moving the ship. Used when a mission begins because you FLEW to
// it: you are already at the fight, and yanking the ship to the arena centre would undo the trip you just
// made. Everything else about the run is still fresh (enemies, drops, counters, hp, the seeded stream).
// `keepWorld` — do not tear down and rebuild the map's set-pieces. They are shared, fixed-position decor
// that is IDENTICAL before and after, so rebuilding them re-fetches and re-parses every `.glb` in the map
// (7 of them here) for no visible change — which is exactly the hitch you feel when a mission starts under
// you. Only used when the fight begins in a world that is already standing (the roam → combat handover);
// a cold start still rebuilds, which is what resets the cruising freighter to its start.
export function reset({ keepPlayer = false, keepWorld = false } = {}) {
  // --- the picture: FX pools, the event log and the pooled bodies this tab owns ---
  // (The entity collections are the World's and are emptied by clearAndPlaceRun below, through the host.)
  for (const x of explosions) { scene.remove(x.mesh); x.mesh.material.dispose(); }
  explosions.length = 0;
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
  hideGrabLine();            // the Grab's pull beam has no drop to point at any more
  hideBeamFx();              // and the charged beam's sight has no fight left to aim into
  clearEventLog(); // start a fresh run with an empty event log

  // Remember HOW this run started. A mission entered by flying into it keeps the ship exactly where it is
  // — that seamlessness is the whole point of the fly-in — and a room has to be told, or it places the ship
  // at the arena centre and the countdown ends in a teleport.
  world.runKeepPlayer = keepPlayer;

  // --- the fight, part 1: empty the world and decide where this run is fought ---
  const { x: cx, z: cz } = clearAndPlaceRun(world);

  arenaBorder.line.position.set(cx, 0, cz);
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
  // The level's scene is now built (set-pieces, arena, player). Ask the render loop to compile + upload it
  // BEFORE the fight instead of during it — a weak phone otherwise spends 10+ s of the first 15 blocked on
  // lazy shader compiles and texture uploads (see prewarmShaders in main.js).
  G.needsSceneWarm = true;
  G.gameStartTime = performance.now(); // start timing a new game (for history)
  arenaBorder.line.visible = !G.roam; // the soft-boundary edge marker is a combat cue only — hidden while roaming

  // --- the fight, part 2: the ship, the counters, the level script ---
  // AFTER the set-piece rebuild, and that is load-bearing: the home station is a set-piece, so `world.station`
  // is a brand-new object by now, and a roam has to arm THAT one (see reset-world.js).
  startRun(world, { keepPlayer });
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
