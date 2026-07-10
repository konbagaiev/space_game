// Composition root for the client (loaded by index.html via `import './src/main.js'`).
// This is the rest of the former inline <script type="module"> — bootstrap/animate/window.__game plus
// the Main Window / shop / welcome / account / settings UI. It imports the extracted modules (sibling
// paths, no `src/` segment) and `three` via the index.html importmap. Slices are peeling cohesive UI
// modules out of here next; for now it is the single composition root.
import { benchMode, isBench, installSeededRandom, mulberry32, BENCH_DT } from './bench.js'; // ?bench replay perf gate — imported FIRST so its seeded RNG is installable before any module calls Math.random
import * as THREE from 'three';
import { loadLanguage, resolveLanguage, getLanguage, SUPPORTED, DEFAULT_LANG, t } from './i18n.js'; // language load/resolve for bootstrap + t() runtime resolver (cutscene text)
import { audio, tracksFor } from './sound-routing.js'; // audio engine + DB-driven music routing (bootstrap)
import { G, bullets, explosions, sparks, shockwaves, trail, rockets, smoke, enemies, setPieces, soundMap, CATALOG, keys, touchAim } from './state.js'; // shared state bag + entity collections + catalog + input
import { scene, skyScene, camera, renderer, camOffset, toGame, gameW, gameH, applyOrientation, zoomBy, tickZoom } from './engine.js'; // engine singletons + orientation + zoom
import { Device } from './device.js'; // device capabilities (input/form axes + fullscreen/standalone flags)
import { TAP_SLOP, exceedsSlop } from './tap-gesture.js'; // touch tap-vs-drag classification (pure, unit-tested)
import { ARENA, OOB_WARN_DELAY, OOB_RETURN_TIME, arenaCenter, arenaBorder, buildMap } from './world.js'; // arena + sky/planet/setpieces + buildMap
import { spawnShipExplosion, emitExhaust, liveParticles, bulletGeo, explosionGeo, spawnRocket } from './projectiles.js'; // FX exposed to __game + geos reused by prewarmShaders
import { buildPlayerFor, spawnEnemyShip, spawnEnemy } from './ship-build.js'; // build the player (bootstrap) + enemy spawns exposed to __game
import { drops, spawnDrop, pickLoot } from './drops.js'; // loot drops: count for the perf readout + the ?debug stress hook
import { el } from './dom.js'; // single fail-loud inventory of shared index.html nodes
import { updateHud, updateMarkers, updateMiniMap, updatePerf, updateCreditPopups, updateDropMarkers, updateEnemyHealthBars } from './hud.js'; // per-frame HUD draws (readouts/markers/radar/perf/credit popups/off-screen loot arrows/enemy health bars)
import { fetchJson, track, currentLevelLabel, registerBoot, unlockNextLevel } from './net.js'; // JSON fetch (bootstrap) + funnel telemetry (community/pagehide listeners) + boot register (referrer capture) + progress advance (intro cutscene → Level 1)
import { API_BASE } from './api-base.js'; // /api prefix (empty same-origin, prod origin on the itch build)
import { update, levelRunner, refreshMusic, warpPlayerToCenter, updateOobWarning, engageAutopilot, engageDropAutopilot, updateReturnArrow, updateReturnHint, updateBanner, setPaused, togglePause, autoPauseOnBlur, reset, settleView } from './sim.js'; // the simulation loop + level runner + music + pause + restart + return-to-base + milestone banner + camera/sky settle
import { buildTunePanel } from './tune.js'; // dev-only ?tune palette panel (lil-gui injected by bootstrap)
import { isDev } from './dev.js'; // sticky ?dev flag (perf overlay + telemetry), single source of truth
import { evalRecord, evalPlayback, normalizeLevelName, snapshotInput, applyInput, makeTrace, validateTrace } from './replay.js'; // ?record/?playback input-replay core (docs/plans/2026-07-09-replay-record.md)
import { LEVEL0_CUTSCENE } from './level0-cutscene.js'; // Level-0 intro cutscene pause script (event-driven), overlaid on ?playback&cutscene
import { HITBOXES_DEBUG, syncHitBoxes } from './hitboxes-debug.js'; // dev-only ?hitboxes wireframe hitbox overlay
import { showMain, launchMission, refreshMissions, missionOffers, mainBriefing, mwPreview, mwItem, stagedActive } from './mainwindow.js'; // between-battles Main Window + model viewers
import { showWelcome, applyTranslations, welcomeStaged } from './welcome.js'; // welcome screen + i18n UI glue
import { initSentry, restoreSession, setPlayerShipsCache, getPlayerShips } from './account.js'; // auth block (bootstrap session restore + Sentry) + cached ships (intro → welcome fallback)
import { recenterAndQuantize, MAX_GHOST_SHIPS, MAX_GHOST_BULLETS } from './ghost-battle-track.js'; // ?dev in-game backdrop recorder + synthetic bake

// audio engine + tracksFor/sfxFor routing moved to src/sound-routing.js (imported at top).
let samplesLoaded = false; // one-time guard so the sample preload fires once, after the context unlocks
// SFX + music routing is DB-driven (docs/plans/sound-classes-and-mapping.md): /api/sounds gives the
// registry (key→url) + the map ((entity,class,event)→[keys]), both filled in bootstrap(). No hardcoded routing.
let soundUrls = {};                 // logical key → same-origin url (fed to audio.preloadSamples)

// Graphics quality tier lives in G.gfx (built in state.js, read by engine.js at construction).
const DEV = isDev(); // ?dev → record per-frame perf samples to the server (see devPerf / dev.js)

// ---------- Benchmark harness (?bench): deterministic replay perf gate ----------
// BENCH is the sticky ?bench mode ('record' | 'replay') this load, or null (off — zero overhead for players).
// See docs/plans/2026-07-04-0949-perf-benchmark-replay.md. In record mode animate() snapshots per-tick input;
// in replay mode the window.__bench.replay() hook (built near the ?debug block) drives its own timed loop.
const BENCH = benchMode();
const BENCH_SEED = 1234567;   // record-mode PRNG seed; must match gen-trace.mjs so record == replay
let benchRecording = false;   // record mode: set by __bench.record(), makes animate() push input snapshots
const benchRecord = [];       // captured per-tick { k:[codes], t:[heading,thrust]|null } for __bench.stop()

// ---------- Input-replay record/playback (?record / ?playback) ----------
// The general "record the player's input + seed, replay it on the real engine" mechanism (separate from the
// ?bench perf gate above). Both run the sim at the fixed BENCH_DT step so a tick maps 1:1 to a sim frame.
// docs/plans/2026-07-09-replay-record.md. Zero overhead when neither flag is present.
const REC = evalRecord(typeof location !== 'undefined' ? location.search : '');   // { level } | null
let PLAY = evalPlayback(typeof location !== 'undefined' ? location.search : ''); // { id, cutscene } | null — also SET programmatically by the intro cutscene (bootstrap), reusing the playback machinery
let introMode = false;        // true when bootstrap plays the intro cutscene for a new player (advance + Level-1 briefing on done)
if (REC || PLAY) G.replayMode = true; // dev record/playback sessions are READ-ONLY: the sim must not advance progress / bank credits / deposit loot on a (re)played win
let recSeed = 0;              // mulberry32 seed installed at record start (captured into the trace)
let recShipId = null;         // the player ship id used for the recording (rebuilt on playback)
let recLoadout = null;        // the player loadout at record time (weapons/mounts) — makes the trace account-independent
let recComponents = null;     // the player components at record time (hull/engine/…)
let recCapturing = false;     // true while capturing input (set by startRecordSession)
const recTicks = [];          // captured per-tick input snapshots for the current recording
let playTrace = null;         // the loaded trace during ?playback
let playIndex = 0;            // next playback tick to apply
let playDone = false;         // true once the trace is exhausted (freezes the re-sim on the last frame)
let playArmed = false;        // playback: start stepping the trace only after the ship model has loaded
let replayAcc = 0;            // real-time accumulator (s) driving the fixed-timestep record/playback loop
let modelsReady = false;      // the player ship .glb has loaded (gates record Start + playback arm)
// Record/playback determinism isolation: the seeded stream must feed ONLY the sim, never per-frame cosmetic
// draws (stars/FX/HUD/idle frames). Otherwise, since a frame-rate accumulator makes frames ≠ ticks, cosmetic
// draws would consume the seeded stream by a frame-count that differs between record and playback → divergence.
// So we keep a private seeded PRNG for the sim and swap it in ONLY around update()/reset(); everything else
// (including idle frames before the first tick) uses the native Math.random captured here at module load.
const nativeRandom = Math.random;
let simRand = null;           // the sim's seeded PRNG (set from the trace seed at record begin / playback arm)
// Run fn with Math.random pointed at the seeded sim stream, then restore the cosmetic (native) stream.
function withSimRand(fn) { const prev = Math.random; Math.random = simRand; try { return fn(); } finally { Math.random = prev; } }

// ---------- Level-0 intro cutscene (event-driven text pauses over ?playback&cutscene) ----------
// Active only when ?playback carries &cutscene AND the loaded trace is the intro level. Observes sim EVENTS
// each playback tick (kills / rocketeer warp-in / enemy rocket launches) and freezes the re-sim ~1s later to
// show a localized lower-third card; tap resumes. The freeze is CUTSCENE-LOCAL (never touches G.paused, so the
// combat "Paused" overlay is not popped). See level0-cutscene.js + docs/plans/2026-07-09-replay-record.md.
let CUT = null;               // the active cutscene script (LEVEL0_CUTSCENE) or null; set in startPlaybackSession
let cutFrozen = false;        // cutscene-local freeze (halts the playback accumulator; NOT G.paused)
let cutDone = false;          // true after Skip or the last pause — stops further event observation
let cutReturning = false;     // fight cleared → simulate "Return to base": drop recorded input, autopilot flies home
const cutFired = new Set();   // pause ids already shown
let cutQueue = [];            // scheduled pauses awaiting their +delay: [{ pause, atTick }]
let cutPrevKills = 0;         // G.kills last tick (detect 0→1, 1→2 transitions)
let cutRocketeerSeen = false; // the rocket pirate has warped in
let cutEnemyRockets = 0;      // count of the rocketeer's launched (non-lead) rockets
const cutSeenRockets = new WeakSet(); // rocket objects already counted (detect a NEW launch)
let cutOverlayEl = null, cutCardEl = null, cutSkipEl = null;

// musicForState/refreshMusic moved to src/sim.js (music follows the live game state). refreshMusic is
// imported at the top; tryUnlockAudio below calls it on the first unlocking gesture.
// Autoplay policy: the AudioContext can only start inside a user gesture, and browsers disagree on which
// events count (Chrome accepts pointerdown; Safari wants click/touchend/keydown and a node played in the
// gesture). So listen broadly and KEEP retrying on every gesture until the context is actually running,
// then detach. Each attempt also (re)starts the menu music. A capturing click handler gives every
// <button> a soft UI tick.
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown'];
function tryUnlockAudio() {
  audio.unlock();
  if (!samplesLoaded) { samplesLoaded = true; audio.preloadSamples(soundUrls); } // load samples on first gesture (decode works even while the ctx is still suspended)
  refreshMusic();
  if (audio.isReady()) UNLOCK_EVENTS.forEach((ev) => removeEventListener(ev, tryUnlockAudio));
}
UNLOCK_EVENTS.forEach((ev) => addEventListener(ev, tryUnlockAudio));
addEventListener('click', (e) => { if (e.target.closest('button')) audio.sfx.uiClick(); }, true);

// ---------- Engine moved to src/engine.js ----------
// scene, skyScene, renderer, camera, lights (combatAmbient/sun), the orientation block
// (gameW/gameH/toGame/applyOrientation, rotation flag on G.rotated) and the camera-zoom
// block (setZoom/zoomBy/tickZoom/camOffset) are imported from engine.js at the top.

// ---------- Device capabilities moved to src/device.js ----------
// The touch/mouse (input) + phone/tablet/desktop/desktop-lg (form) axes plus the fullscreen/standalone
// flags (FS_API/STANDALONE) live on `Device` (imported at top). device.js owns the body classes
// (input-touch/input-mouse, dev-*, the body.touch alias, standalone/no-fs-api) via applyDevice(), which
// engine.applyOrientation() re-runs on resize. The floating ⛶ button + A2HS hint key off those classes.

// ---------- World moved to src/world.js ----------
// Arena (ARENA/OOB consts, arenaCenter, arenaBorder), the starry sky, planet/moons/asteroids, the
// mission set-pieces and buildMap()/updateMoons()/buildSetPiece() are imported from world.js. The
// reassigned per-map handles (sky/stars/G.skyAmbient/G.skySun/G.currentMapDescriptor/G.mapSetpieces/G.arenaDrift)
// live on the shared state bag G.

// ---------- Ship factory moved to src/ship-factory.js ----------
// shipModelCfg/modelSpec/makeShip/applyShipModel + the shared gltfLoader + SHIP_MODEL_LEN are imported
// at the top. The inline model viewer reuses gltfLoader + SHIP_MODEL_LEN. See docs/plans/adding-a-ship-model.md.

// ---------- Projectiles & combat FX moved to src/projectiles.js ----------
// spawnBullet/spawnExplosion/spawnShipExplosion/emitExhaust/spawnRocket/detonateRocket/spawnSmoke/
// findTargetInSector/liveParticles are imported at the top.

// ---------- Ship building & weapons moved to src/ship-build.js ----------
// resolveWeapon/resolveComponents/buildMounts/buildGroups/buildPlayer/spawnEnemyShip/spawnEnemy +
// fireMount/updateGroups are imported at the top. CATALOG (state.js) is still filled in bootstrap().
// ---------- Level runner moved to src/sim.js ----------
// levelRunner (the DB phase/wave script player) is imported at the top — it lives with the sim loop that
// drives it; reset() calls levelRunner.start(), the loop calls levelRunner.update(), __game exposes it.

// ---------- Weapons (fireMount/updateGroups) moved to src/ship-build.js ----------

// ---------- Input ----------
// keys moved to src/state.js
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });

// ---------- Touch controls (touch devices) ----------
// "steer by touch direction" model: stick angle = desired nose direction,
// the ship turns toward it; the magnitude of the deflection = thrust.
// touchAim moved to src/state.js
if (Device.hasTouch) {
  // body.touch / .standalone / .no-fs-api are set by device.js (applyDevice); here we only wire the DOM.
  document.getElementById('touch').classList.add('on');
  document.getElementById('help').style.display = 'none'; // keyboard hints not needed

  const zone = document.getElementById('stick-zone');
  const base = document.getElementById('stick-base');
  const knob = document.getElementById('stick-knob');
  const fire = document.getElementById('fire-btn');
  const R = 60;          // stick radius
  const DEAD = 0.2;      // dead zone (fraction of radius) - below it no steering/thrust
  // Tap-vs-drag over the whole play area (#stick-zone is now inset:0). A single-finger gesture within
  // TAP_SLOP px = an object TAP (runs the shared object-pick raycast); beyond TAP_SLOP = the floating
  // steering stick. A 2nd finger ON THE ZONE = pinch-zoom, which aborts the in-progress stick/tap.
  let stickId = null;      // id of the touch holding the stick
  let stickCx = 0, stickCy = 0;   // game-space center of the stick (touchstart point)
  let startGX = 0, startGY = 0;   // game-space touchstart point, for slop measurement
  let dragged = false;     // gesture has exceeded TAP_SLOP → it's steering, not a tap
  let pinching = false;    // two fingers ON THE ZONE → pinch-zoom, suppress stick + tap
  let pinchDist = 0;
  const pinchD = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  function showStick(x, y) {
    base.style.left = knob.style.left = x + 'px';
    base.style.top = knob.style.top = y + 'px';
    base.style.display = knob.style.display = 'block';
  }
  function moveKnob(cx, cy, x, y) {
    const dx = x - cx, dy = y - cy;
    const len = Math.hypot(dx, dy);
    const clamped = Math.min(len, R);
    const kx = len > 0 ? dx / len * clamped : 0;
    const ky = len > 0 ? dy / len * clamped : 0;
    knob.style.left = (cx + kx) + 'px';
    knob.style.top = (cy + ky) + 'px';
    const mag = clamped / R; // 0..1
    if (mag > DEAD) {
      touchAim.active = true;
      // screen->world: x->X (right), y->Z (down). heading: forwardVec(h)=(sin h,0,cos h)
      touchAim.heading = Math.atan2(dx, dy);
      touchAim.thrust = (mag - DEAD) / (1 - DEAD); // 0..1 beyond the dead zone
    } else {
      touchAim.active = false; touchAim.thrust = 0;
    }
  }
  function clearStick() {
    stickId = null; dragged = false;
    touchAim.active = false; touchAim.thrust = 0;
    base.style.display = knob.style.display = 'none';
  }
  function beginPinch(e) {
    pinching = true;
    clearStick();                       // abort any in-progress stick/tap so its end never fires a tap
    pinchDist = pinchD(e.targetTouches[0], e.targetTouches[1]);
  }

  zone.addEventListener('touchstart', e => {
    // A 2nd finger ON THE ZONE switches to pinch (aborts stick/tap for this gesture). Count
    // e.targetTouches (fingers on #stick-zone only), NOT e.touches — a finger held on FIRE/rocket (sibling
    // targets with their own handlers) must not be counted, so holding FIRE while steering never trips
    // pinch (see DECISIONS §20/§42).
    if (e.targetTouches.length === 2) { beginPinch(e); e.preventDefault(); return; }
    if (stickId !== null || pinching) return;
    const t = e.changedTouches[0];
    const p = toGame(t.clientX, t.clientY); // map viewport coords into (possibly rotated) game space
    stickId = t.identifier; dragged = false;
    stickCx = startGX = p.x; stickCy = startGY = p.y;
    showStick(stickCx, stickCy);          // stick appears immediately (a tap may briefly flash it)
    moveKnob(stickCx, stickCy, p.x, p.y); // zero deflection → inside dead zone → no steering engaged
    e.preventDefault();
  }, { passive: false });
  zone.addEventListener('touchmove', e => {
    if (pinching && e.targetTouches.length === 2) {
      const d = pinchD(e.targetTouches[0], e.targetTouches[1]);
      if (d > 0 && pinchDist > 0) { zoomBy(pinchDist / d); pinchDist = d; } // fingers apart (d↑) => zoom in
      e.preventDefault(); return;
    }
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        const p = toGame(t.clientX, t.clientY);
        // Slop is measured in the SAME rotated game space as the stick center (toGame coords), so
        // TAP_SLOP=10 and the ~12px dead zone (DEAD*R) are apples-to-apples.
        if (!dragged && exceedsSlop(startGX, startGY, p.x, p.y, TAP_SLOP)) dragged = true;
        moveKnob(stickCx, stickCy, p.x, p.y); // moveKnob only steers beyond the dead zone
        e.preventDefault();
      }
    }
  }, { passive: false });
  function endStick(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        // A gesture that never exceeded the slop is a TAP → run the shared object-pick (chest/station).
        if (!dragged && !pinching) engageObjectAt({ clientX: t.clientX, clientY: t.clientY });
        clearStick();
      }
    }
    if (e.targetTouches.length < 2) { pinching = false; pinchDist = 0; }
  }
  zone.addEventListener('touchend', endStick);
  zone.addEventListener('touchcancel', endStick);

  // fire button
  fire.addEventListener('touchstart', e => { keys['Space'] = true; e.preventDefault(); }, { passive: false });
  fire.addEventListener('touchend', e => { keys['Space'] = false; e.preventDefault(); }, { passive: false });
  fire.addEventListener('touchcancel', () => { keys['Space'] = false; });

  // rocket button
  const rocketBtn = document.getElementById('rocket-btn');
  rocketBtn.addEventListener('touchstart', e => { keys['_rocket'] = true; e.preventDefault(); }, { passive: false });
  rocketBtn.addEventListener('touchend', e => { keys['_rocket'] = false; e.preventDefault(); }, { passive: false });
  rocketBtn.addEventListener('touchcancel', () => { keys['_rocket'] = false; });

  // Zoom +/- buttons on touch: fire directly on touchstart (like FIRE/rocket) instead of relying on a
  // synthesized `click`. A `click` is only synthesized for a single-touch tap — the browser SUPPRESSES it
  // while a 2nd touch point is active — so during flight (a steering finger down) a second-thumb tap on
  // +/- never produced a click and zoom couldn't change (the reported bug; see DECISIONS §42). preventDefault
  // also stops the compat click so a lone tap doesn't double-zoom. The `click` listeners below stay for mouse.
  document.getElementById('zoom-in').addEventListener('touchstart', e => { zoomBy(1 / ZOOM_BTN); e.preventDefault(); }, { passive: false });
  document.getElementById('zoom-out').addEventListener('touchstart', e => { zoomBy(ZOOM_BTN); e.preventDefault(); }, { passive: false });

  // "Return to base" button on touch: fire on touchstart (like FIRE/rocket/zoom), NOT a synthesized
  // `click` — a click is suppressed while a 2nd touch point is down, so a second-thumb tap during flight
  // (steering finger on #stick-zone) would never fire (the DECISIONS §42 bug). preventDefault stops the
  // compat click so a lone tap doesn't double-engage. audio.sfx.uiClick() gives click-sound parity — the
  // global capture-phase click→uiClick (main.js:53) also won't fire during flight for the same reason.
  el.returnBtn.addEventListener('touchstart', e => { engageAutopilot(); audio.sfx.uiClick(); e.preventDefault(); }, { passive: false });
} else {
  // PC: the rocket circle is also clickable (besides the F key)
  const rocketBtn = document.getElementById('rocket-btn');
  rocketBtn.addEventListener('mousedown', () => { keys['_rocket'] = true; });
  addEventListener('mouseup', () => { keys['_rocket'] = false; });
}

// ---------- Zoom controls (both platforms): mouse wheel + on-screen +/- buttons ----------
// ZOOM_BTN is referenced by the touch +/- handlers above (they fire on touchstart; see DECISIONS §42).
const ZOOM_WHEEL = 1.12, ZOOM_BTN = 1.25;
renderer.domElement.addEventListener('wheel', e => {
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 1/ZOOM_WHEEL : ZOOM_WHEEL); // scroll up = zoom in (closer)
}, { passive: false });
// Mouse-only: on touch the +/- buttons fire on `touchstart` (in the touch block above). Binding `click`
// there too would DOUBLE-zoom a single tap — the compat click still fires alongside touchstart in some
// browsers even after preventDefault — so keep the click path off touch entirely.
if (!Device.hasTouch) {
  document.getElementById('zoom-in').addEventListener('click',  () => zoomBy(1/ZOOM_BTN));
  document.getElementById('zoom-out').addEventListener('click', () => zoomBy(ZOOM_BTN));
}

// Mouse-only: on touch the "Return to base" button fires on `touchstart` (in the touch block above).
if (!Device.hasTouch) {
  el.returnBtn.addEventListener('click', () => { engageAutopilot(); });
}

// ---------- Click-to-fly: tap/click a loot chest OR (return-to-base) the base station ----------
// HUD buttons are separate DOM elements over the canvas, so they don't reach this canvas listener; a
// canvas raycast finds the world model. A chest hover/click always wins over the station on overlap.
const stationRay = new THREE.Raycaster();
const dropRay = new THREE.Raycaster();
// Map a canvas event → the game-space NDC used by every raycast here (accounts for the rotated view).
function eventNdc(e) {
  const p = toGame(e.clientX, e.clientY);
  return new THREE.Vector2((p.x / gameW()) * 2 - 1, -(p.y / gameH()) * 2 + 1);
}
// Nearest live drop under the pointer (null if none). Shared by the click handler AND the hover cursor.
function dropUnderPointer(e) {
  if (!drops.length) return null;
  dropRay.setFromCamera(eventNdc(e), camera);
  let best = null, bestD = Infinity;
  for (const d of drops) {
    const hit = dropRay.intersectObject(d.obj, true);
    if (hit.length && hit[0].distance < bestD) { bestD = hit[0].distance; best = d; }
  }
  return best;
}
// Shared object-pick for a pointer/tap event ({clientX, clientY}). A live chest under the pointer wins
// over the base station on overlap. Used by BOTH the desktop click handler and the touch tap (a slop-gated
// single-finger tap). Returns true if it engaged an autopilot. (Rotation handled by eventNdc → toGame.)
function engageObjectAt(e) {
  // 1) a chest under the pointer wins (works in combat AND return-to-base)
  const drop = dropUnderPointer(e);
  if (drop) { engageDropAutopilot(drop); return true; }
  // 2) otherwise the clickable station (return-to-base only)
  if (!G.returnToBase || !G.baseStation || !G.baseStation.active) return false;
  stationRay.setFromCamera(eventNdc(e), camera);
  if (stationRay.intersectObject(G.baseStation.obj, true).length) { engageAutopilot(); return true; }
  return false;
}
renderer.domElement.addEventListener('click', (e) => { engageObjectAt(e); });

// Hover cursors (mouse only — meaningless on touch). Hovering a clickable station shows a first-party
// "dock here" glyph; hovering a loot chest shows the OS grab hand. A chest hover wins over the dock hover
// on overlap. Reuses the drop + station raycasts, throttled + only re-run on move.
let dockCursorOn = false;
let grabCursorOn = false;
const setDockCursor = (on) => { if (on !== dockCursorOn) { dockCursorOn = on; renderer.domElement.classList.toggle('dock-cursor', on); } };
const setGrabCursor = (on) => { if (on !== grabCursorOn) { grabCursorOn = on; renderer.domElement.classList.toggle('grab-cursor', on); } };
const stationClickable = () => !!(G.returnToBase && G.baseStation && G.baseStation.active && G.player && G.player.alive && !levelRunner.won);
if (!Device.hasTouch) {
  let lastHoverRay = 0;
  renderer.domElement.addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (now - lastHoverRay < 50) return; // cheap throttle: at most ~20 raycasts/sec
    lastHoverRay = now;
    const drop = dropUnderPointer(e);
    if (drop) { setGrabCursor(true); setDockCursor(false); return; } // chest hover wins over station dock
    setGrabCursor(false);
    if (!stationClickable()) { setDockCursor(false); return; }
    stationRay.setFromCamera(eventNdc(e), camera);
    setDockCursor(stationRay.intersectObject(G.baseStation.obj, true).length > 0);
  });
}

// ---------- Backend + telemetry moved to src/net.js ----------
// fetchJson, bankRun, currentLevelLabel, track, unlockNextLevel are imported at the top. The player id
// (G.playerId) is initialized in state.js; the once-per-run / once-per-session guards (G.banked,
// G.gameStartSent, G.quitSent) live on the shared bag. The community-link + pagehide listeners stay here
// (boot wiring) and call the imported track/currentLevelLabel.
// Telemetry: how many players open the community/feedback group (fire-and-forget; navigation continues).
document.querySelectorAll('.community-link').forEach((el) => {
  el.addEventListener('click', () => track('community_click', { lang: getLanguage() }));
});
// Fire `quit` once when the player leaves mid-session (drop-off signal; G.quitSent guard). pagehide is
// more reliable than beforeunload (covers tab close, navigation, and mobile backgrounding).
addEventListener('pagehide', () => {
  if (G.quitSent || !G.gameStarted) return;
  G.quitSent = true;
  track('quit', { level: currentLevelLabel() });
});

// ---------- Sim helpers moved to src/sim.js ----------
// forwardVec, warpPlayerToCenter (soft-boundary auto-return) and updateOobWarning (the "left the
// battlefield" warning, reading #oob-warn via el.oobWarn) are imported at the top; animate() calls
// updateOobWarning, __game exposes warpPlayerToCenter.

// ---------- HUD moved to src/hud.js ----------
// updateHud/updateMarkers/updateMiniMap/updatePerf are imported at the top; the cached HUD/overlay
// nodes live in src/dom.js (`el`). The run/account scalars they read (G.kills/G.earned/G.balance) are
// on the shared state bag. The result-overlay title/sub/buttons (el.overlayTitle/overlaySub/restart/
// backHangar in dom.js) are written by the sim death/win flow (now in sim.js) + the inline restart
// listeners below.

// ---------- Game loop moved to src/sim.js ----------
// The fixed-step update(dt) + the cosmetic wing-bank + DRAG/IDLE_DRAG constants are imported at the top;
// animate() below calls update(dt) (gated on !G.paused). The render clock stays here (animate owns it).
const clock = new THREE.Clock();


// ---------- HUD draws moved to src/hud.js ----------
// updatePerf (perf overlay), updateMarkers (off-screen enemy edge arrows) and updateMiniMap (radar)
// are imported at the top; their cached nodes (#perf/#markers/#minimap) live in src/dom.js (`el`).

// ---------- Pause boot wiring ----------
// setPaused/togglePause/autoPauseOnBlur moved to src/sim.js (they read levelRunner + call refreshMusic).
// The buttons + focus listeners are wired here, calling the imported functions.
document.getElementById('pause-play').addEventListener('click', () => setPaused(false)); // Play = resume
el.pauseBtn.addEventListener('click', togglePause);
setPaused(false); // localize the initial label
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPauseOnBlur(); });
window.addEventListener('blur', autoPauseOnBlur);

// ---------- Dev perf monitor (?dev): sample frame timing + device passport, ship to /api/perf ----------
// Gated on `?dev` (mirrors ?tune/?debug). A single fps number can't tell CPU-bound from GPU/fill-rate-bound
// from externally-governed (thermal/vsync) — the three failure modes a weak phone hits. So each frame we
// time the JS work (sim / DOM overlays / render submit), and once per second emit an aggregated sample
// (fps + frame-time p50/p95/max + the JS breakdown + scene load + a device/GPU passport), batched to the
// server every ~5s (and on tab hide via sendBeacon). Off — zero overhead — for normal players.
// Read: if JS `total` ≪ frame `p50`, the frame isn't CPU-bound → external/GPU. See docs/plans/perf-low-end-phones.md.
const devPerf = (() => {
  if (!DEV) return { frame() {} };
  const sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
  // Device passport — captured once. The real GPU name is the single most useful field for a weak phone.
  let gpu = 'unknown', gpuVendor = 'unknown';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) { gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); gpuVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL); }
  } catch {}
  const device = {
    ua: navigator.userAgent, dpr: window.devicePixelRatio,
    cores: navigator.hardwareConcurrency ?? null, mem: navigator.deviceMemory ?? null,
    screen: `${screen.width}x${screen.height}`, gpu, gpuVendor, tier: G.gfx.name,
    knobs: { pixelRatioCap: G.gfx.pixelRatioCap, antialias: G.gfx.antialias,
             maxParticles: G.gfx.maxParticles === Infinity ? 'inf' : G.gfx.maxParticles },
  };
  let bucket = [], bucketStart = performance.now(), outbox = [], lastFlush = bucketStart;
  const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p / 100 * sorted.length))] : 0;
  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const r1 = (x) => Math.round(x * 10) / 10;
  // JS heap usage (Chrome/Android-Chrome only; non-standard, bucketed for privacy). NOT the process RSS
  // and NOT GPU memory (textures/buffers live in the driver) — but the only in-page memory signal, and it
  // catches JS-side growth/leaks over a session. null where unavailable (Safari/Firefox).
  const MB = 1048576;
  const heapMB = () => {
    const m = performance.memory;
    return m ? { used: Math.round(m.usedJSHeapSize / MB), total: Math.round(m.totalJSHeapSize / MB), limit: Math.round(m.jsHeapSizeLimit / MB) } : null;
  };

  function flush(beacon) {
    if (!outbox.length || !G.playerId) return;
    const body = JSON.stringify({ playerId: G.playerId, sessionId, samples: outbox });
    outbox = [];
    try {
      if (beacon && navigator.sendBeacon) navigator.sendBeacon(API_BASE + '/api/perf', new Blob([body], { type: 'application/json' }));
      else fetch(API_BASE + '/api/perf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    } catch {}
  }
  function finalizeBucket(now) {
    const elapsed = (now - bucketStart) / 1000;
    if (bucket.length && elapsed > 0) {
      const frameMs = bucket.map((f) => f.frame).sort((a, b) => a - b);
      const totals = bucket.map((f) => f.total).sort((a, b) => a - b);
      const p50 = pct(frameMs, 50);
      outbox.push({
        t: Date.now(), scene: !G.gameStarted ? 'menu' : (G.paused ? 'paused' : 'combat'),
        fps: r1(bucket.length / elapsed), frames: bucket.length,
        frameMs: { p50: r1(p50), p95: r1(pct(frameMs, 95)), max: r1(frameMs[frameMs.length - 1]) },
        js: { update: r1(mean(bucket.map((f) => f.update))), dom: r1(mean(bucket.map((f) => f.dom))),
              render: r1(mean(bucket.map((f) => f.render))), total: r1(mean(totals)), totalP95: r1(pct(totals, 95)) },
        jank: frameMs.filter((m) => m > 1.5 * p50).length,
        load: { enemies: enemies.length, drops: drops.length, particles: liveParticles(), draws: renderer.info.render.calls, tris: renderer.info.render.triangles },
        heap: heapMB(), // JS heap (MB) — Chrome only; null elsewhere
        res: `${renderer.domElement.width}x${renderer.domElement.height}`, device,
      });
    }
    bucket = []; bucketStart = now;
    if (now - lastFlush >= 5000) { flush(false); lastFlush = now; }
  }
  const flushNow = () => { finalizeBucket(performance.now()); flush(true); lastFlush = performance.now(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushNow(); });
  window.addEventListener('pagehide', flushNow);
  return {
    // `sec` is the RAW (unclamped) frame interval — frameMs must reflect true frame time, not the sim's
    // clamped dt (which saturates at 50ms and would hide every frame slower than 20fps).
    frame(sec, t0, t1, t2, t3) {
      bucket.push({ frame: sec * 1000, update: t1 - t0, dom: t2 - t1, render: t3 - t2, total: t3 - t0 });
      if (performance.now() - bucketStart >= 1000) finalizeBucket(performance.now());
    },
  };
})();

// Pre-compile shaders so the first frames don't stall. Measured on weak phones (DECISIONS §23): the first
// combat frame spent 0.4-2.2s compiling shaders + uploading textures (THREE compiles a material's program
// lazily on its first render). `renderer.compile()` warms every material currently in a scene; the dynamic
// effect programs (particles/bullets — not in the scene until they spawn) are warmed with two throwaway
// off-screen meshes matching their program keys (additive fog-off vs opaque fog-on). Idempotent — THREE
// caches compiled programs, so repeat calls are cheap. Best-effort; must never block startup.
function prewarmShaders() {
  try {
    renderer.compile(skyScene, camera);
    renderer.compile(scene, camera);
    const warm = new THREE.Group();
    const addMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }); // explosions/sparks/trail/shockwave
    const fogMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); // bullets/rockets (opaque, scene fog on)
    warm.add(new THREE.Mesh(explosionGeo, addMat), new THREE.Mesh(bulletGeo, fogMat));
    warm.position.y = -100000; // far off-camera (compile ignores culling, but keep it invisible if a frame slips in)
    scene.add(warm);
    renderer.compile(scene, camera);
    scene.remove(warm);
    addMat.dispose(); fogMat.dispose();
  } catch { /* best-effort — shader warmup must never break startup */ }
}

// ---- In-game backdrop recorder (?dev authoring tool). Captures a live-played battle → downloads a committed
// backdrop-battle.js. Inert unless isDev(). PRIMARY authoring path (the synthetic bake is a bootstrap). See
// docs/plans/2026-07-07-1606-backdrop-ghost-battle.md Step 3. ----
let bdRec = null; // active recording state or null
function backdropCapture(dt) {            // called from animate() after update(), only while recording + live
  if (!bdRec) return;
  bdRec.acc += dt; bdRec.elapsed += dt;
  if (bdRec.acc < 1 / bdRec.fps) return;  // decimate live frames → fps keyframes
  bdRec.acc -= 1 / bdRec.fps;
  const kf = bdRec.ships[0].x.length;     // keyframe index about to be pushed (= current length of every slot)
  // BIRTHS: any enemy without a slot gets one (under the total cap), back-filled to length kf with its birth pos
  // so all slot arrays stay length `frames`. Later waves join the ghost cast instead of the clip decaying to
  // one ship. No slot reuse (a dead slot is never re-assigned); enemies appearing after the cap is full are ignored.
  for (const e of enemies) {
    if (e._bdSlot === undefined && bdRec.ships.length < MAX_GHOST_SHIPS) {
      const slot = bdRec.ships.length; e._bdSlot = slot;
      const bx = e.mesh.position.x, bz = e.mesh.position.z, by = e.heading;
      const S = { shipName: e.name, scale: e.sizeScale || 1, birth: kf, death: -1, x: [], z: [], yaw: [] };
      for (let i = 0; i < kf; i++) { S.x.push(bx); S.z.push(bz); S.yaw.push(by); } // pre-birth placeholders (hidden + not re-centered)
      bdRec.ships.push(S); bdRec.cast[slot] = e; bdRec.last[slot] = { x: bx, z: bz, yaw: by };
    }
  }
  const rec = (s, x, z, yaw) => { const S = bdRec.ships[s]; S.x.push(x); S.z.push(z); S.yaw.push(yaw); bdRec.last[s] = { x, z, yaw }; };
  // Slot 0 = the player. recenterAndQuantize subtracts ONE FIXED offset (the MEAN of the player's path) from
  // everything, so the player's real free-flight motion is preserved (it visibly flies) and the cloud centers
  // near the anchor. AUTHORING NOTE: don't OOB-warp / return-to-base mid-record — a teleport skews the player's
  // mean and shifts the whole cloud off the anchor (nudge it back with the ?dev Anchor X/Z sliders). Fly normally.
  if (G.player && G.player.alive) rec(0, G.player.mesh.position.x, G.player.mesh.position.z, G.player.heading);
  else rec(0, bdRec.last[0].x, bdRec.last[0].z, bdRec.last[0].yaw);       // player always recorded, birth:0/death:-1
  for (let s = 1; s < bdRec.ships.length; s++) {
    const e = bdRec.cast[s];              // cast[s] aligned to slot s (cast[0] = null, the player)
    if (enemies.includes(e)) rec(s, e.mesh.position.x, e.mesh.position.z, e.heading);
    else { if (bdRec.ships[s].death < 0) bdRec.ships[s].death = kf; rec(s, bdRec.last[s].x, bdRec.last[s].z, bdRec.last[s].yaw); }
  }
  let bc = 0; for (const b of bullets) { if (bc >= MAX_GHOST_BULLETS) break; bdRec.bullets.x.push(b.mesh.position.x); bdRec.bullets.z.push(b.mesh.position.z); bc++; }
  bdRec.bullets.counts.push(bc);
  if (bdRec.elapsed >= bdRec.maxSeconds) window.__backdrop.stop();       // auto-stop
}
if (isDev()) window.__backdrop = {
  record({ maxSeconds = 60, fps = 20 } = {}) {   // default 60 s (~150–250 KB @ 20fps / ≤16 slots / ≤24 bullets)
    const p = G.player; if (!p) { console.warn('[backdrop] no player — start a fight first'); return; }
    for (const e of enemies) delete e._bdSlot;   // clear stale slot tags from a prior recording (enemies persist without a reload)
    // start with ONLY the player slot; enemies (current + all later waves) join via births in backdropCapture
    const ships = [{ shipName: G.currentShipName || G.activeShip?.ship?.name, scale: 1, birth: 0, death: -1, x: [], z: [], yaw: [] }];
    // acc:0 → the remainder-preserving `acc -= 1/fps` decrement yields exactly `fps` keyframes/sec. Do NOT use
    // a large sentinel (e.g. 1e9): the guard would pass EVERY live frame (~60fps) while the track is stamped
    // fps:20, so playback would run 3× too long at 1/3 speed — and no shape/bounded guard would catch it.
    bdRec = { fps, maxSeconds, acc: 0, elapsed: 0, cast: [null], ships, last: [{ x: 0, z: 0, yaw: 0 }], bullets: { counts: [], x: [], z: [] } };
    console.log(`[backdrop] recording (player + up to ${MAX_GHOST_SHIPS - 1} enemy waves, ~${maxSeconds}s @ ${fps}fps)…`);
  },
  stop(name = 'freighter-skirmish') {
    if (!bdRec) return null;
    const raw = { name, seed: 0, fps: bdRec.fps, frames: bdRec.ships[0].x.length, ships: bdRec.ships, bullets: bdRec.bullets };
    bdRec = null;
    const track = recenterAndQuantize(raw, { name });
    const src = `// GENERATED — a real recorded battle (do not hand-edit). See docs/plans/2026-07-07-1606-backdrop-ghost-battle.md\nexport const BACKDROP_BATTLE = ${JSON.stringify(track)};\n`;
    try { const b = new Blob([src], { type: 'text/javascript' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'backdrop-battle.js'; document.body.appendChild(a); a.click(); a.remove(); } catch {}
    console.log(`[backdrop] ${track.frames} frames, ${track.ships.length} ships, ${(src.length / 1024).toFixed(0)} KB → downloaded backdrop-battle.js`);
    return track;
  },
  // Live status for the panel's REC readout + Start/Stop toggle (polled by buildBackdropPanel).
  status() { return { recording: !!bdRec, elapsed: bdRec ? bdRec.elapsed : 0, maxSeconds: bdRec ? bdRec.maxSeconds : 60 }; },
};

function animate() {
  // ?bench=replay drives its own timed tick loop (window.__bench.replay). Keep the rAF loop idle so leftover
  // combat state can't churn/render (under software GL) between measurements and stall the next navigation.
  if (BENCH === 'replay') return;
  requestAnimationFrame(animate);
  const rawSec = clock.getDelta();        // true frame interval (unclamped) — for the perf metrics
  const dt = (BENCH || REC || PLAY) ? BENCH_DT : Math.min(rawSec, 0.05); // bench/record/playback: fixed step for determinism; else clamped for sim stability
  const t0 = DEV ? performance.now() : 0;
  tickZoom(dt); // ease the camera zoom toward its target every frame (independent of the pause freeze)
  if (REC || PLAY) {
    // Fixed-timestep ACCUMULATOR: advance the sim at BENCH_DT as many WHOLE steps as real elapsed time allows,
    // so record + playback run at real-time speed on ANY display refresh (a 120 Hz screen would otherwise run
    // 2× because one fixed step ran per frame). Each tick stays a deterministic fixed dt; we capture (record)
    // or apply (playback) exactly one tick per step. Only runs once armed (record: after "Start"; playback:
    // once models loaded) — before that the ship sits idle with the real model on screen (no placeholder flash).
    if ((recCapturing || playArmed) && !G.paused && !cutFrozen) {
      replayAcc += Math.min(rawSec, 0.1); // clamp: after a stall/tab-throttle, don't fast-forward a huge burst
      let steps = 0;
      while (replayAcc >= BENCH_DT && steps < 6 && !playDone && !cutFrozen) {
        if (cutReturning) {
          for (const c in keys) keys[c] = false; touchAim.active = false; // no recorded input → autopilot isn't cancelled (sim manual-input check)
        } else if (PLAY && playTrace) {
          if (playIndex < playTrace.ticks.length) applyInput(playTrace.ticks[playIndex], keys, touchAim);
          else { playDone = true; break; }
        }
        withSimRand(() => update(BENCH_DT));       // seed feeds ONLY the sim; cosmetic frame work uses native RNG
        if (PLAY && playTrace && !cutReturning) playIndex++;
        if (recCapturing) recTicks.push(snapshotInput(keys, touchAim));
        if (CUT) cutsceneObserve();                // may freeze (fire a pause), engage return-to-base, or end
        replayAcc -= BENCH_DT;
        steps++;
      }
      if (recCapturing) updateRecordHud();
      if (PLAY) updatePlaybackHud();
      if (PLAY && playDone && CUT && !cutDone) cutsceneEnd(); // uncover the victory overlay when the fight ends
    }
  } else {
    if (!G.paused) update(dt); // pause freezes the whole fight (enemies, bullets, cooldowns, repair, spawns)
    // ?bench record: snapshot the resolved input AFTER update() so the trace replays identically (see bench.js)
    if (benchRecording) benchRecord.push({ k: Object.keys(keys).filter((c) => keys[c]), t: touchAim.active ? [touchAim.heading, touchAim.thrust] : null });
  }
  // ?dev backdrop recorder: capture live-played transforms → backdrop-battle.js. Gate on !G.paused so a pause
  // mid-record can't accumulate dt/elapsed, record frozen duplicate frames, or auto-stop during a pause.
  if (bdRec && !G.paused) backdropCapture(dt);
  if (HITBOXES_DEBUG) syncHitBoxes(scene, G.player, enemies); // dev-only hitbox wireframe overlay
  const t1 = DEV ? performance.now() : 0; // end of sim
  updateHud();
  updateMarkers();
  updateDropMarkers(); // green edge arrows toward off-screen loot drops (nearest 6)
  updateCreditPopups(); // floating "+xx" gold credit popups at kill sites
  updateEnemyHealthBars(); // translucent red health bars above damaged enemies
  updateOobWarning(); // soft-boundary "left the battlefield" warning + countdown
  updateReturnArrow();  // world-space blue homing arrow toward the base station (return-to-base)
  updateReturnHint();   // centered "return to base" HUD hint
  updateBanner();       // transient centered milestone banner ("10 enemies left", "Final Stage")
  if (dockCursorOn && !stationClickable()) setDockCursor(false); // drop the dock cursor when the station stops being clickable (no raycast)
  if (grabCursorOn && !drops.length) setGrabCursor(false); // drop the grab cursor when the last chest is gone (no raycast)
  updateMiniMap();    // corner radar: arena bounds, player, enemies
  const t2 = DEV ? performance.now() : 0; // end of DOM overlays
  // two passes: first the sky backdrop (with its own light), then combat on top
  renderer.info.reset();
  renderer.clear();
  renderer.render(skyScene, camera);
  renderer.clearDepth();
  renderer.render(scene, camera);
  const t3 = DEV ? performance.now() : 0; // end of render submit (GPU exec is async — this is CPU submit cost)
  updatePerf(rawSec); // perf metrics use the RAW interval (clamped dt would cap fps/ms on slow devices)
  if (DEV) devPerf.frame(rawSec, t0, t1, t2, t3);
}

// ---------- Restart (reset) moved to src/sim.js ----------
// reset() clears entities/FX, recenters the arena, rebuilds set-pieces, respawns the player + (re)starts
// the level. Imported at the top; the take-off + overlay Restart/Continue flows call it.

// ---------- Main Window + model viewers moved to src/mainwindow.js ----------
// showMain/selectMenu/mission board/launchCampaign/launchMission/refreshMissions + the ship-preview
// and briefing-item showcase viewers are imported at the top; __game (below) reads its live state
// (missionOffers/mainBriefing/mwPreview/mwItem).

// ---------- Hangar shop + stash moved to src/shop.js ----------
// openBay/showBayView/updateTakeoffGate/renderShipStatsBar/deriveShipStats/resetShipStatsDelta are
// imported at the top; the shop bay is a self-contained leaf (server-authoritative buy/sell/equip).

// ---------- Dev color/lighting tuning panel moved to src/tune.js ----------
// buildTunePanel(GUI) is imported at the top; bootstrap dynamically imports lil-gui under ?tune and
// calls it (so players never fetch the GUI lib).

// Test/inspection hook for the headless visual tests (client/visual/). Inert during normal
// play — only attached when the page is opened with `?debug`. It exposes simulation internals
// so a scenario can seed entities and assert on state (counts, colors) instead of diffing pixels.
if (location.search.includes('debug')) {
  window.__game = {
    scene, camera, enemies, bullets, rockets,
    explosions, sparks, shockwaves, trail, smoke,
    spawnEnemy, spawnEnemyShip, spawnShipExplosion, emitExhaust, spawnRocket, reset, levelRunner,
    drops, // the live loot-drop array (count/positions assertable in headless)
    // Stress hook: spawn a metal-box drop near the player carrying a random real item. Measure on a phone
    // with `?dev` — start a fight, run `for (let i=0;i<40;i++) __game.spawnTestDrop()`, watch the perf FPS.
    spawnTestDrop(item) {
      const p = G.player; if (!p) return null;
      const items = [{ kind: 'component', refId: 6 }, { kind: 'component', refId: 9 }, { kind: 'weapon', refId: 9 }, { kind: 'weapon', refId: 4 }];
      const chosen = item || items[(Math.random() * items.length) | 0]; // optional explicit item → deterministic (tests)
      const pos = p.mesh.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30));
      spawnDrop(pos, chosen);
      return chosen;
    },
    pickLoot, // expose for tests (loot-pool selection off an enemy)
    audio, // procedural audio engine (settings + scene); SFX/music are inaudible in headless but state is assertable
    warpPlayerToCenter, arenaBorder, ARENA, OOB_WARN_DELAY, OOB_RETURN_TIME,
    setPieces, arenaCenter, // mission set-pieces + the (drifting) arena center
    setArenaDrift(x, z) { G.arenaDrift = new THREE.Vector3(x, 0, z); }, // test/tool: enable a drifting zone
    get activeMission() { return G.activeMission; }, // the side mission being played (null = campaign)
    get missionOffers() { return missionOffers; },
    get previewTarget() { return mwPreview && mwPreview.url; }, // the glb url in the right-column ship preview
    // the granted-item showcase (work zone): the glb url shown, or null when the showcase is hidden
    get itemShowcaseTarget() { const d = document.getElementById('mw-mission-desc'); return d && d.classList.contains('show-item') ? (mwItem && mwItem.url) : null; },
    get briefingStaged() { return stagedActive; },   // Main Window staged reveal animating (L2/L3)
    get welcomeStaged() { return welcomeStaged; },   // welcome-screen staged reveal animating (L1)

    launchMission, refreshMissions, showMain, // test/tool: drive the side-mission board + the Main Window
    get mainBriefing() { return mainBriefing; }, // the campaign (primary) briefing currently shown
    get oobWarnVisible() { return el.oobWarn.style.display === 'block'; },
    get player() { return G.player; },   // built asynchronously in bootstrap()
    get catalog() { return CATALOG; }, // ships/weapons/level loaded from the DB
    get earned() { return G.earned; },   // credits earned this run
    get balance() { return G.balance; }, // persistent account balance
    get kills() { return G.kills; },
    get touchAim() { return touchAim; }, // touch steering state (active/heading/thrust) — assert tap-vs-drag in headless
  };
}

// ---------- Benchmark hooks (?bench): recorder + deterministic replayer on window.__bench ----------
// Attached only under ?bench (record or replay), independent of ?debug. Inert for normal players.
// The replayer is the perf gate's engine: it re-seeds the RNG, resets to a clean load-pinned fight, then
// drives trace.ticks through the exact per-frame work animate() does — timed into the same three buckets
// devPerf uses — and returns the raw per-tick arrays for client/bench/run.mjs to compare A vs B.
// See docs/plans/2026-07-04-0949-perf-benchmark-replay.md (Component 3).
if (isBench()) {
  const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const shipById = (id) => { for (const s of CATALOG.shipByName.values()) if (s.id === id) return s; return null; };
  // cheap deterministic state hash (rounded entity positions) — the self-check compares it across reps
  const stateHash = () => {
    let h = 2166136261 >>> 0;
    const mix = (n) => { h = Math.imul(h ^ (Math.round(n * 100) | 0), 16777619) >>> 0; };
    for (const e of enemies) { mix(e.mesh.position.x); mix(e.mesh.position.z); }
    if (G.player) { mix(G.player.mesh.position.x); mix(G.player.mesh.position.z); mix(G.player.heading); }
    mix(enemies.length);
    return h >>> 0;
  };
  // One full frame's work, reusing animate()'s exact call sequence (minus tickZoom / dock+grab raycasts /
  // updatePerf — none feed the sim; dropped consistently on A and B, see plan Component 3 step 2).
  const fullFrame = (dt) => {
    const t0 = performance.now();
    update(dt);
    const t1 = performance.now();
    updateHud(); updateMarkers(); updateDropMarkers(); updateCreditPopups();
    updateEnemyHealthBars(); updateOobWarning(); updateReturnArrow(); updateReturnHint(); updateMiniMap();
    const t2 = performance.now();
    renderer.info.reset();
    renderer.clear();
    renderer.render(skyScene, camera);
    renderer.clearDepth();
    renderer.render(scene, camera);
    const t3 = performance.now();
    return { update: t1 - t0, dom: t2 - t1, render: t3 - t2, total: t3 - t0,
             draws: renderer.info.render.calls, tris: renderer.info.render.triangles };
  };
  // 'sim' mode: only update(dt) — tightest, lowest-noise, most 2%-sensitive for pure-sim diffs.
  const simFrame = (dt) => {
    const t0 = performance.now();
    update(dt);
    const t1 = performance.now();
    return { update: t1 - t0, dom: 0, render: 0, total: t1 - t0, draws: 0, tris: 0 };
  };

  window.__bench = {
    // True once the catalog + player exist (bootstrap resolved) — the runner waits on this before replay().
    ready: () => !!(G.player && CATALOG.enemyShips && CATALOG.enemyShips.length),
    // ---- Recorder (drives the deferred human authoring flow; see client/bench/README.md) ----
    record() { benchRecord.length = 0; benchRecording = true; },
    stop(name = 'combat-heavy', setup) {
      benchRecording = false;
      const trace = { version: 1, name, seed: BENCH_SEED, dt: BENCH_DT, warmupTicks: 120,
        ticks: benchRecord.slice(),
        setup: setup || { shipId: 1, spawns: [{ atTick: 0, count: 6 }], maintainEnemies: 6 } };
      try {
        const blob = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `${name}.json`;
        document.body.appendChild(a); a.click(); a.remove();
      } catch { /* headless / no DOM download — the trace object is still returned */ }
      return trace;
    },
    // ---- Replayer (the gate's engine) ----
    async replay(trace, { mode = 'full' } = {}) {
      const setup = trace.setup || {};
      // 1. deterministic setup: re-seed, build the fixed ship, reset to a clean fight, spawn the fixed waves.
      installSeededRandom(trace.seed);
      const shipDef = setup.shipId != null ? shipById(setup.shipId) : null;
      if (shipDef) buildPlayerFor(shipDef);
      reset();
      // PRECONDITION (plan Component 3 step 1): reset() does NOT set G.gameStarted — the launch flows do, and
      // the headless ?bench=replay page never runs them. Without this, every timed update(dt) early-returns
      // at sim.js:305 and the benchmark measures nothing. Set it, then assert the sim will actually run.
      G.gameStarted = true;
      for (const w of (setup.spawns || [])) if ((w.atTick || 0) === 0) for (let i = 0; i < (w.count || 0); i++) spawnEnemyShip(CATALOG.enemyShips[0]);
      if (!(G.player && G.player.alive === true && levelRunner.won === false)) {
        throw new Error(`bench replay precondition failed (alive=${G.player && G.player.alive}, won=${levelRunner.won}) — sim would not run`);
      }
      const maintain = setup.maintainEnemies || 0;
      const dt = trace.dt || BENCH_DT;
      const frame = mode === 'sim' ? simFrame : fullFrame;
      const warmup = trace.warmupTicks || 0;
      const upd = [], dom = [], render = [], total = [], draws = [], tris = [], particles = [], enemyCount = [];
      // 2. run the trace in order. Synchronous loop → no rAF interleaving mid-measurement.
      for (let i = 0; i < trace.ticks.length; i++) {
        const tick = trace.ticks[i];
        for (const c in keys) keys[c] = false;
        for (const c of (tick.k || [])) keys[c] = true;
        if (tick.t) { touchAim.active = true; touchAim.heading = tick.t[0]; touchAim.thrust = tick.t[1]; }
        else touchAim.active = false;
        while (maintain && enemies.length < maintain) spawnEnemyShip(CATALOG.enemyShips[0]); // load-pin (deterministic on A and B)
        const f = frame(dt);
        if (i >= warmup) { // 3. discard warmup ticks from timing
          upd.push(f.update); dom.push(f.dom); render.push(f.render); total.push(f.total);
          draws.push(f.draws); tris.push(f.tris); particles.push(liveParticles()); enemyCount.push(enemies.length);
        }
      }
      // 4. medians (robust to a stray GC pause) + raw per-tick arrays (runner's bootstrap CI) + the state hash.
      return {
        mode, name: trace.name,
        update: median(upd), dom: median(dom), render: median(render), total: median(total),
        load: { draws: median(draws), tris: median(tris), particles: median(particles), enemies: median(enemyCount) },
        ticks: { update: upd, dom, render, total },
        loadTicks: { draws, tris, particles, enemies: enemyCount },
        finalEnemies: enemies.length, finalHash: stateHash(),
      };
    },
    // ---- Ghost-battle backdrop baker (SECONDARY / bootstrap; see client/bench/gen-backdrop.mjs +
    // docs/plans/2026-07-07-1606-backdrop-ghost-battle.md Step 4) ----
    // Runs the REAL sim headless & deterministically (seeded RNG + fixed dt), dumps per-keyframe ship + bullet
    // transforms for a fixed, non-respawning cast. Returns RAW floats in the SAME shape the in-game recorder
    // builds; gen-backdrop.mjs runs the shared recenterAndQuantize + writes client/src/backdrop-battle.js. This
    // is a bootstrap so the runtime + tests work before the maintainer records the real battle (Step 3).
    // Thrust-only seeded player: with the FIXED-mean-offset re-center (player flies freely) + the loose < 600 u
    // runaway guard, the natural drift stays in bounds — no circling/warmup needed (that was for the old
    // slot-0-pinning guard, now reverted). Deterministic; the canonical track is a real in-game recording anyway.
    async bakeBackdrop({ seconds = 15, fps = 20 } = {}) {
      installSeededRandom(BENCH_SEED);           // deterministic
      const playerDef = shipById(1); if (playerDef) buildPlayerFor(playerDef);
      reset(); G.gameStarted = true;
      const defs = [CATALOG.enemyShips[0], CATALOG.enemyShips[0], CATALOG.enemyShips[1] || CATALOG.enemyShips[0],
                    CATALOG.enemyShips[2] || CATALOG.enemyShips[0], CATALOG.enemyShips[0]];
      const cast = defs.map((d) => spawnEnemyShip(d));                     // fixed cast, all born at frame 0
      const ships = [{ shipName: playerDef.name, scale: 1, birth: 0, death: -1, x: [], z: [], yaw: [] }]
        .concat(cast.map((e) => ({ shipName: e.name, scale: e.sizeScale || 1, birth: 0, death: -1, x: [], z: [], yaw: [] })));
      const last = ships.map(() => ({ x: 0, z: 0, yaw: 0 })), bul = { counts: [], x: [], z: [] };
      const rec = (s, x, z, yaw) => { const S = ships[s]; S.x.push(x); S.z.push(z); S.yaw.push(yaw); last[s] = { x, z, yaw }; };
      for (const c in keys) keys[c] = false; keys['KeyW'] = true; keys['Space'] = true;   // seeded player skirmishes
      const step = Math.round((1 / fps) / BENCH_DT) || 3, total = Math.round(seconds / BENCH_DT);
      for (let tick = 0; tick <= total; tick++) {
        update(BENCH_DT);
        if (tick % step) continue;
        const kf = ships[0].x.length;
        if (G.player) rec(0, G.player.mesh.position.x, G.player.mesh.position.z, G.player.heading); else rec(0, last[0].x, last[0].z, last[0].yaw);
        for (let s = 1; s < ships.length; s++) { const e = cast[s - 1];
          if (enemies.includes(e)) rec(s, e.mesh.position.x, e.mesh.position.z, e.heading);
          else { if (ships[s].death < 0) ships[s].death = kf; rec(s, last[s].x, last[s].z, last[s].yaw); } }
        let bc = 0; for (const b of bullets) { if (bc >= MAX_GHOST_BULLETS) break; bul.x.push(b.mesh.position.x); bul.z.push(b.mesh.position.z); bc++; } bul.counts.push(bc);
      }
      return { seed: BENCH_SEED, fps, frames: ships[0].x.length, ships, bullets: bul };  // RAW floats
    },
  };
}

// ---------- Input-replay: record + playback sessions (?record / ?playback) ----------
// The engine-facing half of replay.js. A recording captures the seed + per-tick input; playback re-runs the
// REAL sim from it (animate() applies the recorded input each frame). Both force the fixed BENCH_DT step above.

const shipByIdGlobal = (id) => { for (const s of CATALOG.shipByName.values()) if (s.id === id) return s; return null; };

// Load a trace by id: the same-browser dev cache first (zero-friction record→playback loop), then a static
// /recordings/{id}.json (the pulled S3 asset). Returns the parsed trace or null. `id` null → the 'last' slot.
async function loadTrace(id) {
  const key = id || 'last';
  try { const s = localStorage.getItem(`replay:${key}`); if (s) return JSON.parse(s); } catch {}
  if (id) { try { const r = await fetch(`/recordings/${id}.json`); if (r.ok) return await r.json(); } catch {} }
  return null;
}

// Trigger a JSON download of the trace (same pattern as __bench.stop). No-op if there's no DOM.
function downloadTrace(trace, filename) {
  try {
    const blob = new Blob([JSON.stringify(trace)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  } catch { /* headless / download blocked — the trace still lives in localStorage */ }
}

// Resolve when the player ship .glb has loaded (or a short fallback), so record/playback don't begin on the
// blue PLACEHOLDER primitive. The glb loads via the shared THREE.DefaultLoadingManager; onLoad fires when the
// queue drains. The timeout covers "it finished before we hooked" and the load-failed-to-primitive case.
function watchModelsReady(cb) {
  if (modelsReady) { cb(); return; }
  const done = () => { if (modelsReady) return; modelsReady = true; cb(); };
  try {
    const mgr = THREE.DefaultLoadingManager;
    const prev = mgr.onLoad;
    mgr.onLoad = () => { if (prev) { try { prev(); } catch {} } done(); };
  } catch {}
  setTimeout(done, 2500);
}

// Enter record mode: drop into the level with the REAL ship idle, no capture yet. The operator waits for the
// model to load (Start unlocks then), positions, then clicks Start → beginRecordCapture. Capture MUST begin at
// the sim's first tick (reset), or a playback that starts from reset() won't line up — so Start owns reset().
function enterRecordMode() {
  document.body.classList.remove('menu');
  buildRecordUI();
  watchModelsReady(() => { if (recStartBtn) { recStartBtn.disabled = false; recStartBtn.textContent = 'Start recording'; recStartBtn.style.opacity = '1'; } });
}
// Seed BEFORE reset() (reset() draws Math.random for spawn timing) so the whole run is reproducible from
// (seed + input). animate()'s accumulator then captures one tick per fixed step while the operator flies.
function beginRecordCapture() {
  if (recCapturing) return;
  recSeed = (Date.now() >>> 0);                 // the one wall-clock touch — captured into the trace (determinism preserved)
  simRand = mulberry32(recSeed);                 // the sim's seeded stream (swapped in only around update()/reset())
  recShipId = (CATALOG.shipByName.get(G.currentShipName) || {}).id ?? 1;
  // Capture the loadout/components actually used, so the trace reproduces this exact ship independent of the
  // account later. Only when the built ship IS the active ship (else the bootstrap used the ship's defaults →
  // leave null so playback falls back to catalog defaults too).
  const activeMatches = G.activeShip && G.activeShip.ship && G.activeShip.ship.name === G.currentShipName;
  recLoadout = activeMatches ? G.activeShip.loadout : null;
  recComponents = activeMatches ? G.activeShip.components : null;
  G.gameStarted = true;
  replayAcc = 0;
  withSimRand(() => reset());                     // position the player + start REC.level from tick 0 (seeded)
  settleView();                                   // frame camera + sky on the reset player (no jump when capture begins)
  recTicks.length = 0; recCapturing = true;
  setRecordUIRecording();
}

// Stop recording: assemble + persist the trace (dev cache + a JSON download), then show the playback link.
function stopRecordSession() {
  if (!recCapturing) return;
  recCapturing = false;
  const id = `${REC.level}-${recSeed.toString(36)}`;
  const trace = makeTrace({ id, level: REC.level, seed: recSeed, dt: BENCH_DT, shipId: recShipId,
    loadout: recLoadout, components: recComponents, ticks: recTicks });
  try { localStorage.setItem(`replay:${id}`, JSON.stringify(trace)); localStorage.setItem('replay:last', JSON.stringify(trace)); } catch {}
  downloadTrace(trace, `${id}.json`);
  showRecordDone(id, trace.ticks.length);
}

// Start the PLAYBACK session from an already-loaded, validated trace: re-seed, rebuild the recorded ship,
// launch the recorded level. animate() then steps the trace one tick per frame (see the PLAY block there).
function startPlaybackSession(trace) {
  playTrace = trace; playIndex = 0; playDone = false;
  // Rebuild the recorded ship BEFORE seeding — record built the player during bootstrap (pre-seed), so any
  // Math.random buildPlayerFor draws must NOT come out of the seeded stream, or the sim RNG offsets and the
  // whole replay diverges. Install the seed only after, so reset()+the fight draw from an identical stream.
  const shipDef = trace.shipId != null ? shipByIdGlobal(trace.shipId) : null;
  if (shipDef) {
    // Force the recorded ship+loadout (NEVER the current account's) so a replay is faithful regardless of what
    // the player has equipped now. Old traces (no captured loadout) fall back to the ship's catalog defaults —
    // correct for the intro, which was recorded on the fresh starter loadout. Uses native RNG (cosmetic).
    buildPlayerFor(shipDef, {
      loadout: trace.loadout || { mounts: shipDef.stats.mounts },
      components: trace.components || shipDef.components,
    });
  }
  simRand = mulberry32(trace.seed);              // the sim's seeded stream (swapped in only around update()/reset())
  document.body.classList.remove('menu');
  G.gameStarted = true;
  replayAcc = 0;
  withSimRand(() => reset());
  settleView(); // frame the camera + sky on the (reset) player NOW, so the frozen P0 frame doesn't jump on play
  // ?playback&cutscene on the intro level → overlay the event-driven Level-0 pauses (freeze + localized card)
  // instead of the plain playback bar; the opening card (P0) freezes before the first tick until tapped.
  if (PLAY.cutscene && normalizeLevelName(trace.level) === LEVEL0_CUTSCENE.level) {
    CUT = LEVEL0_CUTSCENE;
    cutsceneStart();
  } else {
    buildPlaybackUI(trace);
  }
  // Hold on the idle frame until the real ship model has loaded, then start stepping the trace — so playback
  // opens on the real ship, not the placeholder. animate()'s accumulator only advances once playArmed.
  watchModelsReady(() => { playArmed = true; });
}

// --- Minimal on-screen chrome for the two dev modes (inline-styled; no styles.css coupling) ---
let recHudEl = null, playHudEl = null, recStartBtn = null;
const HUD_BASE = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99999;font:600 13px/1.4 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.72);padding:6px 12px;border-radius:8px;display:flex;gap:12px;align-items:center;pointer-events:auto;user-select:none';

// State 1 — ARMING: real ship idle, a disabled "Loading model…" that watchModelsReady unlocks to "Start recording".
function buildRecordUI() {
  recHudEl = document.createElement('div');
  recHudEl.style.cssText = HUD_BASE + ';border:1px solid #4dff88';
  recHudEl.innerHTML = `<span style="opacity:.7">record</span><span style="opacity:.7">${REC.level}</span>`
    + `<button id="rec-start" disabled style="cursor:pointer;font:inherit;color:#0b0f14;background:#4dff88;border:0;border-radius:6px;padding:3px 10px;opacity:.5">Loading model…</button>`;
  document.body.appendChild(recHudEl);
  recStartBtn = recHudEl.querySelector('#rec-start');
  recStartBtn.addEventListener('click', () => { if (!recStartBtn.disabled) beginRecordCapture(); });
}
// State 2 — RECORDING: red REC dot + live tick counter + "Stop & Save".
function setRecordUIRecording() {
  if (!recHudEl) return;
  recHudEl.style.borderColor = '#ff4d4d';
  recHudEl.innerHTML = `<span style="color:#ff4d4d">● REC</span><span style="opacity:.7">${REC.level}</span>`
    + `<span id="rec-ticks" style="font-variant-numeric:tabular-nums">0 ticks</span>`
    + `<button id="rec-stop" style="cursor:pointer;font:inherit;color:#fff;background:#ff4d4d;border:0;border-radius:6px;padding:3px 10px">Stop &amp; Save</button>`;
  recHudEl.querySelector('#rec-stop').addEventListener('click', stopRecordSession);
  recStartBtn = null;
}
function updateRecordHud() {
  if (!recHudEl) return;
  const t = recHudEl.querySelector('#rec-ticks');
  if (t) t.textContent = `${recTicks.length} ticks`;
}
function showRecordDone(id, ticks) {
  if (!recHudEl) return;
  const url = `?playback&id=${encodeURIComponent(id)}`;
  recHudEl.style.borderColor = '#4dff88';
  recHudEl.innerHTML = `<span style="color:#4dff88">✓ Saved</span><span style="opacity:.7">${id}</span>`
    + `<span style="opacity:.7">${ticks} ticks</span>`
    + `<a href="${url}" style="cursor:pointer;color:#0b0f14;background:#4dff88;border-radius:6px;padding:3px 10px;text-decoration:none">Play it ▶</a>`;
}

function buildPlaybackUI(trace) {
  playHudEl = document.createElement('div');
  playHudEl.style.cssText = HUD_BASE + ';border:1px solid #4da3ff';
  playHudEl.innerHTML = `<span style="color:#4da3ff">▶ PLAYBACK</span><span style="opacity:.7">${trace.id || 'last'}</span>`
    + `<span id="play-progress" style="font-variant-numeric:tabular-nums">0 / ${trace.ticks.length}</span>`
    + `<button id="play-restart" style="cursor:pointer;font:inherit;color:#0b0f14;background:#4da3ff;border:0;border-radius:6px;padding:3px 10px">Restart</button>`;
  document.body.appendChild(playHudEl);
  playHudEl.querySelector('#play-restart').addEventListener('click', () => location.reload());
}
function updatePlaybackHud() {
  if (!playHudEl || !playTrace) return;
  const p = playHudEl.querySelector('#play-progress');
  if (p) p.textContent = `${Math.min(playIndex, playTrace.ticks.length)} / ${playTrace.ticks.length}${playDone ? ' ✓' : ''}`;
}

// Start the INTRO cutscene for a new player: fetch the canonical recording (a same-origin S3 asset named on
// the level descriptor's `introTrace`), then reuse the playback machinery. READ-ONLY — the sim never advances
// progress; the advance is explicit in finishIntro() when the cutscene ends. Returns false if the trace is
// missing/invalid so bootstrap can fall back to the playable Level 0.
async function startIntroCutscene() {
  const url = CATALOG.level && CATALOG.level.introTrace;
  if (!url) return false;
  let trace = null;
  try { trace = await (await fetch(url)).json(); } catch (e) { console.error('[intro] trace fetch failed', e); }
  const problems = trace ? validateTrace(trace) : ['intro trace missing/unfetchable'];
  if (problems.length) { console.error('[intro] invalid trace:', problems); return false; }
  playTrace = trace;
  PLAY = { id: trace.id, cutscene: true };   // drive the playback accumulator + cutscene like ?playback&cutscene
  introMode = true;
  G.replayMode = true;                        // read-only — win() won't advance; finishIntro() does it explicitly
  startPlaybackSession(trace);
  return true;
}
// The intro cutscene finished (won or Skip) → advance the player 1→2 (server-authoritative, so the intro is
// one-time + cross-device) and land on the Level 1 Main Window briefing (shop stays gated until unlocked).
async function finishIntro() {
  if (!introMode) return;
  introMode = false;
  try { localStorage.setItem('introSeen', '1'); } catch {}
  try { await unlockNextLevel(); } catch (e) { console.error('[intro] advance failed', e); }
  if (CATALOG.level && CATALOG.level.briefing) showMain(CATALOG.level.briefing);
  else showWelcome(getPlayerShips());
}

// --- Level-0 cutscene runtime: event detection + freeze + localized card (see level0-cutscene.js) ---
function cutsceneStart() {
  buildCutsceneOverlay();
  cutPrevKills = G.kills;                            // baseline (reset() zeroed kills)
  const p0 = CUT.pauses.find((p) => p.on === 'opening');
  if (p0) { cutFrozen = true; cutFired.add(p0.id); cutsceneShowCard(p0.textKey); } // opening card before the fight
}
// Called each playback tick AFTER update(): detect sim events, schedule each pause ~delaySec later, fire the
// earliest due one (which freezes the re-sim). Only one card at a time — the freeze halts further stepping.
function cutsceneObserve() {
  if (cutDone) return;
  const dueAt = playIndex + Math.round(CUT.delaySec / BENCH_DT);
  const fresh = (id) => !cutFired.has(id) && !cutQueue.some((q) => q.pause.id === id);
  if (G.kills !== cutPrevKills) {                    // kills: schedule the nth-kill pause(s)
    for (let kn = cutPrevKills + 1; kn <= G.kills; kn++) {
      const p = CUT.pauses.find((pp) => pp.on === 'kill' && pp.n === kn && fresh(pp.id));
      if (p) cutQueue.push({ pause: p, atTick: dueAt });
    }
    cutPrevKills = G.kills;
  }
  if (!cutRocketeerSeen && enemies.some((e) => e.name === CUT.rocketeerShip)) { // rocketeer warp-in
    cutRocketeerSeen = true;
    const p = CUT.pauses.find((pp) => pp.on === 'rocketeer' && fresh(pp.id));
    if (p) cutQueue.push({ pause: p, atTick: dueAt });
  }
  for (const r of rockets) {                         // rocketeer rocket launches (skip spiral leaders + player)
    if (r.lead || r.fromPlayer || cutSeenRockets.has(r)) continue;
    cutSeenRockets.add(r); cutEnemyRockets++;
    const p = CUT.pauses.find((pp) => pp.on === 'enemyRocket' && pp.n === cutEnemyRockets && fresh(pp.id));
    if (p) cutQueue.push({ pause: p, atTick: dueAt });
  }
  if (cutQueue.length && playIndex >= cutQueue[0].atTick) {
    const { pause } = cutQueue.shift();
    cutFrozen = true; cutFired.add(pause.id); cutsceneShowCard(pause.textKey);
    return;
  }
  // Fight cleared (all enemies down → G.returnToBase) → simulate the "Return to base" button. That is a CLICK
  // (engageAutopilot), never captured in the key trace, so playback would otherwise never complete the level.
  // Drop the recorded input (cutReturning; the accumulator clears keys so the sim's manual-input check can't
  // cancel the autopilot) and let it fly home; on docking the sim fires the win → victory overlay, then we end.
  if (!cutReturning && G.returnToBase && !levelRunner.won) {
    cutReturning = true;
    for (const c in keys) keys[c] = false; touchAim.active = false;
    engageAutopilot();
  } else if (cutReturning && levelRunner.won) {
    cutsceneEnd(); playDone = true; // docked home → level complete; stop the re-sim on the victory overlay
  }
}
function cutsceneAdvance() { // tap/click while a card is up → resume the re-sim
  if (!cutFrozen) return;
  cutFrozen = false; replayAcc = 0; cutsceneHideCard();
}
function cutsceneSkip() { // end the cutscene now (no more pauses); the playback plays out to the victory overlay
  cutDone = true; cutFrozen = false; cutQueue = [];
  CUT.pauses.forEach((p) => cutFired.add(p.id));
  cutsceneEnd();
}
function cutsceneEnd() { // tear down the overlay so the normal HUD / victory overlay show
  cutDone = true; cutFrozen = false; cutReturning = false; cutsceneHideCard();
  document.body.classList.remove('cutscene');
  if (cutSkipEl) { cutSkipEl.remove(); cutSkipEl = null; }
  if (introMode) finishIntro(); // real intro: advance 1→2 + land on the Level 1 briefing
}
function cutsceneShowCard(textKey) { if (cutOverlayEl) { cutCardEl.textContent = t(textKey); cutOverlayEl.style.display = 'flex'; } }
function cutsceneHideCard() { if (cutOverlayEl) cutOverlayEl.style.display = 'none'; }
function buildCutsceneOverlay() {
  const style = document.createElement('style');
  style.textContent = `
    body.cutscene #hud, body.cutscene #help, body.cutscene #perf, body.cutscene #rocket-btn, body.cutscene #event-log, body.cutscene #markers, body.cutscene #oob-warn, body.cutscene #return-hint, body.cutscene #return-btn, body.cutscene #banner, body.cutscene #minimap, body.cutscene #pause-btn, body.cutscene #zoom { display: none !important; }
    #cutscene-overlay { position: fixed; inset: 0; z-index: 99998; display: none; align-items: flex-end; justify-content: center; pointer-events: auto; }
    #cutscene-card { max-width: min(760px, 88vw); margin: 0 0 12vh; padding: 20px 26px; background: rgba(6,10,16,.82); border: 1px solid rgba(255,255,255,.14); border-radius: 14px; color: #eaf2ff; font: 500 clamp(15px,2.4vw,21px)/1.5 system-ui, sans-serif; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
    #cutscene-tap { margin-top: 12px; font-size: 13px; opacity: .55; letter-spacing: .4px; }
    #cutscene-skip { position: fixed; top: 14px; right: 16px; z-index: 99999; cursor: pointer; font: 600 13px system-ui, sans-serif; color: #eaf2ff; background: rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.2); border-radius: 8px; padding: 6px 12px; }
  `;
  document.head.appendChild(style);
  document.body.classList.add('cutscene');
  cutOverlayEl = document.createElement('div');
  cutOverlayEl.id = 'cutscene-overlay';
  cutOverlayEl.innerHTML = `<div id="cutscene-card"><div id="cutscene-text"></div><div id="cutscene-tap">${t('ui.cutscene.tap')}</div></div>`;
  cutOverlayEl.addEventListener('click', cutsceneAdvance);
  document.body.appendChild(cutOverlayEl);
  cutCardEl = cutOverlayEl.querySelector('#cutscene-text');
  cutSkipEl = document.createElement('button');
  cutSkipEl.id = 'cutscene-skip'; cutSkipEl.textContent = t('ui.cutscene.skip');
  cutSkipEl.addEventListener('click', (e) => { e.stopPropagation(); cutsceneSkip(); });
  document.body.appendChild(cutSkipEl);
  addEventListener('keydown', (e) => {
    if (!CUT || cutDone) return;
    if (e.code === 'Escape') cutsceneSkip();
    else if (cutFrozen && (e.code === 'Space' || e.code === 'Enter')) cutsceneAdvance();
  });
}

// Console / automation hook (only under the dev replay flags). Lets the maintainer stop from the console and
// lets an automated smoke check compare a deterministic state hash between record and playback (same seed +
// same input ⇒ same hash at the same tick — the determinism guarantee input-replay stands on).
if (REC || PLAY) {
  const stateHash = () => {
    let h = 2166136261 >>> 0;
    const mix = (n) => { h = Math.imul(h ^ (Math.round(n * 100) | 0), 16777619) >>> 0; };
    for (const e of enemies) { mix(e.mesh.position.x); mix(e.mesh.position.z); }
    if (G.player) { mix(G.player.mesh.position.x); mix(G.player.mesh.position.z); mix(G.player.heading); }
    mix(enemies.length);
    return h >>> 0;
  };
  window.__replay = {
    mode: REC ? 'record' : 'playback',
    begin: () => beginRecordCapture(),  // record: seed + reset + start capturing (what the Start button does)
    stop: () => stopRecordSession(),
    hash: stateHash,
    status: () => ({ recording: recCapturing, ticks: recTicks.length, playIndex, playDone, total: playTrace ? playTrace.ticks.length : 0 }),
    // Cutscene state (for tests / console): is a card up, which pauses fired, the visible card text.
    cut: () => ({ on: !!CUT, frozen: cutFrozen, done: cutDone, returning: cutReturning, won: levelRunner.won,
      fired: [...cutFired], queued: cutQueue.length,
      card: cutOverlayEl && cutOverlayEl.style.display === 'flex' ? cutCardEl.textContent : null }),
    advance: () => cutsceneAdvance(),  // dismiss the current cutscene card (== tapping it)
    state: { G, enemies, rockets, camera, camOffset }, // live sim refs (dev-flag only) — for forcing events + framing checks in cutscene tests
    // Synchronous sim stepping that mirrors animate()'s sim block WITHOUT the render/rAF — for automated
    // determinism checks and console use (a background tab throttles rAF to ~0, so live ticks stall). Uses
    // whatever input is currently held (none under automation → a deterministic no-input run). Stops on a
    // cutscene freeze (call advance() to continue), mirroring the accumulator.
    step(n = 1) {
      if (!simRand) return this.status(); // record: not started yet (call begin() first); playback sets it on arm
      for (let i = 0; i < n; i++) {
        if (cutFrozen) break;
        if (cutReturning) {                 // mirror the accumulator: no recorded input while flying home
          for (const c in keys) keys[c] = false; touchAim.active = false;
        } else if (PLAY && playTrace) {
          if (playIndex < playTrace.ticks.length) applyInput(playTrace.ticks[playIndex], keys, touchAim);
          else { playDone = true; break; }
        }
        if (!playDone) withSimRand(() => update(BENCH_DT));
        if (PLAY && playTrace && !cutReturning && !playDone) playIndex++;
        if (recCapturing) recTicks.push(snapshotInput(keys, touchAim));
        if (CUT) cutsceneObserve();
      }
      return this.status();
    },
  };
}

// Re-evaluate the portrait→landscape rotation and resize the renderer/camera to the game dimensions.
// (applyOrientation is the single place we size the renderer; see its definition near the camera.)
addEventListener('resize', applyOrientation);
addEventListener('orientationchange', applyOrientation);

// (Graphics-tier changes reload the page so the whole preset — antialias + pixel ratio + star/particle
// density — applies cleanly from startup; see the settings wiring + DECISIONS §23.)

// ---------- Bootstrap: build the world from the DB, then start ----------
// Fetch the ship/weapon catalog and the player's active ship from the API, build the runtime
// catalog + the player, then start the game. Served same-origin, so the API is always available.
// fetchJson lives in src/net.js (imported at the top).

// buildPlayerFor (rebuild the player ship + swap it into the scene) moved to src/ship-build.js;
// imported at the top. It reads/writes G.activeShip + G.currentShipName on the shared bag.
// ---------- Welcome screen + i18n UI glue moved to src/welcome.js ----------
// showWelcome/take-off + applyTranslations/the EN-RU lang switch + requestFullscreen
// are imported at the top. The audio-settings modal is src/settings.js.

// ---------- Account / authentication moved to src/account.js ----------
// renderAccountBar/openAccount/shouldPromptAccount + login/register/logout + initSentry/restoreSession
// are in account.js; bootstrap calls restoreSession()/initSentry(), the Main Window opens the dialog.

async function bootstrap() {
  if (BENCH) installSeededRandom(BENCH_SEED); // deterministic RNG for record/replay (replay() re-seeds per trace)
  initSentry(); // fire-and-forget: don't delay the game waiting on the monitoring SDK
  try {
    // Pick the language and load the message catalogs before the first render. Initial guess from
    // the explicit local choice → browser language → en; the server preference is adopted below.
    let explicitLang = null; try { explicitLang = localStorage.getItem('lang'); } catch {}
    let browserLang = ''; try { browserLang = navigator.language || (navigator.languages || [])[0] || ''; } catch {}
    await loadLanguage(resolveLanguage({ explicit: explicitLang, browser: browserLang }), fetchJson);

    // Restore an authenticated session (httpOnly cookie) over the anon UUID + clear the ?verified=1 flag.
    await restoreSession();

    // Ensure the player row exists (write-once referrer capture) before the level/active-ship fetches,
    // which also auto-register but carry no referrer.
    await registerBoot();

    // The level comes from the player's progress (their highest unlocked level); fall back to
    // level-1 if the player isn't identified (e.g. localStorage blocked).
    // ?playback: load the recorded trace up front so the recorded LEVEL drives the level fetch below.
    if (PLAY) {
      playTrace = await loadTrace(PLAY.id);
      const problems = playTrace ? validateTrace(playTrace) : [`no recording found for id "${PLAY.id || 'last'}"`];
      if (problems.length) {
        console.error('[playback] invalid/missing trace:', problems);
        document.body.innerHTML = `<pre style="color:#ff6b6b;font:14px/1.5 monospace;padding:24px">Playback failed:\n- ${problems.join('\n- ')}</pre>`;
        return;
      }
    }
    // ?record forces the requested level; ?playback uses the recorded level; otherwise the player's progress level.
    const levelUrl = REC ? `/api/levels/${REC.level}`
      : PLAY ? `/api/levels/${normalizeLevelName(playTrace.level)}`
      : G.playerId ? `/api/players/${G.playerId}/level` : '/api/levels/level-1';
    const [weapons, components, ships, level, sounds] = await Promise.all([
      fetchJson('/api/weapons'), fetchJson('/api/components'),
      fetchJson('/api/ships'), fetchJson(levelUrl), fetchJson('/api/sounds').catch(() => ({ sounds: [], map: [] })),
    ]);
    // Sound catalog → preload registry + the routing map (sfxFor/tracksFor). A failed fetch ⇒ all-synth/silent.
    soundUrls = Object.fromEntries((sounds.sounds || []).map((s) => [s.key, s.url]));
    audio.setSampleGains(Object.fromEntries((sounds.sounds || []).map((s) => [s.key, s.gain ?? 1]))); // per-sound playback gain (DB sounds.gain)
    for (const m of (sounds.map || [])) { const k = `${m.entity}|${m.class}|${m.event}`; (soundMap.get(k) || soundMap.set(k, []).get(k)).push(m.sound); }
    audio.setMusicTracks({ hangar: tracksFor('scene', 'hangar', 'music'), combat: tracksFor('scene', 'combat', 'music') }); // looping bg music per scene
    if (samplesLoaded) audio.preloadSamples(soundUrls); // a gesture already unlocked the ctx before bootstrap finished
    // Weapons are flattened (stats spread to top level); keep the model URLs too (the `...w.stats` spread
    // also lifts `stats.model` to a top-level `model` key — read by itemModelCfg). Components are stored
    // whole, so their `modelUrlHigh` + nested `stats.model` flow through as-is.
    for (const w of weapons) CATALOG.weapons.set(w.id, { id: w.id, name: w.name, type: w.type, price: w.price, modelUrl: w.modelUrl, modelUrlHigh: w.modelUrlHigh, rarity: w.rarity, color: w.color, ...w.stats });
    for (const c of components) CATALOG.components.set(c.id, c);
    CATALOG.enemyShips = ships.filter((s) => s.type === 'enemy');
    for (const s of ships) CATALOG.shipByName.set(s.name, s);
    CATALOG.level = level.descriptor;

    const map = await fetchJson(`/api/maps/${level.descriptor.map}`); // the level chooses its map
    buildMap(map.descriptor); // build the scene backdrop: planet, moons, stars, asteroids, sky light

    // the player's active ship (auto-registers) decides the default selection
    let active = null;
    if (G.playerId) active = await fetchJson(`/api/players/${G.playerId}/active-ship`).catch(() => null);
    G.activeShip = active; // drives the persisted loadout in buildPlayerFor (weapon swaps, etc.)
    if (active && typeof active.credits === 'number') G.balance = active.credits; // account balance for the HUD
    const playerShips = ships.filter((s) => s.type === 'player');
    setPlayerShipsCache(playerShips); // remembered so a login can re-render the welcome screen
    buildPlayerFor((active && active.ship) || playerShips[0]); // idle ship behind the welcome screen

    // Adopt the player's server-stored language if they made no explicit local choice — but only a
    // real, non-default preference (the column defaults to 'en', which must not override browser
    // detection for a brand-new player). This is what restores a chosen language after a localStorage clear.
    if (!explicitLang && active && SUPPORTED.includes(active.language)
        && active.language !== DEFAULT_LANG && active.language !== getLanguage()) {
      await loadLanguage(active.language, fetchJson);
    }

    // position the camera once (update() doesn't run until take-off), then show the landing screen
    camera.position.copy(G.player.mesh.position).add(camOffset);
    camera.lookAt(G.player.mesh.position);
    applyTranslations(); // localize all static [data-i18n] chrome for the active language
    // The intro ("Level 0", seed name 'level-1', served only while current_progress === 1) has NO menu
    // gate: drop the new player straight into the fight — ship visible + controllable at once, no welcome
    // screen, no Take-off. Everything else lands as before (Level 1 → welcome, level 2+ → Main Window
    // briefing). The default player ship was already built above (buildPlayerFor), so we just start the sim.
    if (REC) {
      enterRecordMode(); // idle on the real ship; "Start recording" begins capture from tick 0
    } else if (PLAY) {
      startPlaybackSession(playTrace); // re-run the recorded fight on the real engine
    } else if (level.name === 'level-1') {
      // Intro. A REAL new player (not headless, not already-seen) with a canonical recording → WATCH the
      // CUTSCENE, then finishIntro advances to Level 1. Headless (?debug/?bench visual/perf suites),
      // already-seen, or no recording → the PLAYABLE Level 0 (the arena the harnesses expect + ?dev re-record).
      const headless = location.search.includes('debug') || location.search.includes('bench');
      let seen = false; try { seen = !!localStorage.getItem('introSeen'); } catch {}
      let started = false;
      if (!headless && !seen && CATALOG.level.introTrace) started = await startIntroCutscene();
      if (!started) { document.body.classList.remove('menu'); G.gameStarted = true; reset(); }
    } else if (CATALOG.level.briefing) {
      showMain(CATALOG.level.briefing);
    } else {
      showWelcome(playerShips);
    }
    animate(); // render loop (idle until Take off)
    // Warm shaders a couple frames in — OFF the critical path (a synchronous compile here would block
    // first paint / startup readiness). The menu renders meanwhile, and the player ship + sky already
    // compile behind the welcome screen; this just makes the combat-effect programs explicit before the
    // first take-off. The user spends seconds on the menu, so a deferred compile is invisible.
    // Skipped under the `?debug` inspection hook: `renderer.compile` is very slow on the headless visual
    // suite's software GL (swiftshader) and would flake its startup-sensitive scenarios. Prewarm is
    // perf-only and behaviorally inert (it compiles shaders that would compile lazily anyway), so there's
    // nothing for the suite to test, and headless can't measure the benefit. Real users always get it.
    if (!location.search.includes('debug')) requestAnimationFrame(() => requestAnimationFrame(prewarmShaders));

    // Dev-only palette tuning panel; lil-gui is fetched only here so players never download it.
    if (location.search.includes('tune')) {
      const { default: GUI } = await import('three/addons/libs/lil-gui.module.min.js');
      buildTunePanel(GUI);
    }
    // ?dev "Backdrop authoring" panel: Start/Stop-record controls + a REC readout + live Depth/Scale/Opacity
    // sliders for the freighter ghost battle. Dynamic imports → zero cost (no lil-gui fetch) when ?dev is off.
    if (isDev()) {
      const { default: GUI } = await import('three/addons/libs/lil-gui.module.min.js');
      const { buildBackdropPanel } = await import('./ghost-battle.js');
      buildBackdropPanel(GUI);
    }
  } catch (err) {
    console.error('Failed to load the game from the API:', err);
  }
}
bootstrap();
