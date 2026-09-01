// Composition root for the client (loaded by index.html via `import './src/main.js'`).
// This is the rest of the former inline <script type="module"> — bootstrap/animate/window.__game plus
// the Main Window / shop / welcome / account / settings UI. It imports the extracted modules (sibling
// paths, no `src/` segment) and `three` via the index.html importmap. Slices are peeling cohesive UI
// modules out of here next; for now it is the single composition root.
import { benchMode, isBench, BENCH_DT } from './bench.js'; // ?bench replay perf gate (flag + the fixed 1/60 step)
import { seedSim, isSimSeeded } from './sim-core/sim-random.js'; // the seeded GAMEPLAY stream (opt-in per draw site, DECISIONS §73)
import { worldDigest } from './sim-core/digest.js'; // the World as one comparable value (browser↔Node oracle)
import { evalNetsim, connectNetsim, netsimDeferReason, isUnroomableSideMission } from './netsim.js'; // ?netsim: play a level in a SERVER-run room
import { createNetState, applySnapshot, renderNet, clearNet } from './netsim-world.js';
import { createJerkProbe } from './netsim-jerk.js'; // ?netjerk: catch every break in the DRAWN motion
import * as THREE from 'three';
import { loadLanguage, resolveLanguage, getLanguage, SUPPORTED, DEFAULT_LANG, t } from './i18n.js'; // language load/resolve for bootstrap + t() runtime resolver (the intro director's lines)
import { audio, tracksFor } from './sound-routing.js'; // audio engine + DB-driven music routing (bootstrap)
import { G, world, bullets, explosions, sparks, shockwaves, rockets, smoke, enemies, allies, setPieces, soundMap, CATALOG, keys, touchAim } from './state.js'; // shared state bag + entity collections + catalog + input
import { scene, skyScene, camera, renderer, camOffset, toGame, gameW, gameH, applyOrientation, zoomBy, setZoom, tickZoom } from './engine.js'; // engine singletons + orientation + zoom
import { Device } from './device.js'; // device capabilities (input/form axes + fullscreen/standalone flags)
import { TAP_SLOP, exceedsSlop } from './tap-gesture.js'; // touch tap-vs-drag classification (pure, unit-tested)
import { ARENA, OOB_WARN_DELAY, OOB_RETURN_TIME, arenaCenter, arenaBorder, buildMap, speedFieldLayers, backdropAmp, setBackdropAmp } from './world.js'; // arena + sky/planet/speed field/setpieces + buildMap + the parallax backdrop layer's live knobs
import { keepAliveMaterial as flipbookKeepAliveMaterial } from './flipbook-fx.js'; // one material held for the session so its program is never freed
import { spawnShipExplosion, emitExhaust, liveParticles, bulletGeo, explosionGeo, spawnEnemyShieldHit, smokePool, ringKeepAliveMaterial } from './projectiles.js'; // FX exposed to __game + geos reused by prewarmShaders
import { spawnRocket as spawnRocketInto, spawnBullet as spawnBulletInto } from './sim-core/spawn.js'; // take the World explicitly — __game wraps them below
import { HIT_FX } from './hit-fx-config.js'; // ?debug hook: the live hit-feel tunables a scenario drives
import { updateShieldBubble, updateEnemyShieldBubbles, enemyShieldSlots } from './shield-fx.js'; // player shield bubble (faint idle rim + ripple-on-hit) + the pooled enemy hit-ripples
import { setGlobalExhaustMode, getCurrentMode, getActiveFreighterPlume, updateShipExhaust } from './exhaust-fx.js'; // exhaust global look toggle + debug hooks
import { buildPlayerFor, spawnEnemyShip, spawnEnemy } from './ship-build.js'; // build the player (bootstrap) + enemy spawns exposed to __game
import { shipModelCacheSize } from './ship-factory.js'; // ?debug diagnostic: how many ship glbs have been parsed
import { drops, spawnDrop, pickLoot } from './drops.js'; // loot drops: count for the perf readout + the ?debug stress hook
import { el } from './dom.js'; // single fail-loud inventory of shared index.html nodes
import { updateHud, updateMarkers, updateMiniMap, updatePerf, updateCreditPopups, updateDropMarkers, updateMissionMarker, updateEnemyHealthBars, updateProgressionHud } from './hud.js'; // per-frame HUD draws (readouts/markers/radar/perf/credit popups/off-screen loot arrows/gold mission pointer/enemy health bars/XP bar+skill badge)
import { fetchJson, track, currentLevelLabel, registerBoot, unlockNextLevel, postSession, clientLog } from './net.js'; // JSON fetch (bootstrap) + funnel telemetry (community/pagehide listeners) + boot register (referrer capture) + progress advance (intro → Level 1) + session-recording upload
import { API_BASE } from './api-base.js'; // /api prefix (empty same-origin, prod origin on the itch build)
import { update, renderTick, setGrabTarget, levelRunner, refreshMusic, warpPlayerToCenter, updateOobWarning, engageAutopilot, engageDropAutopilot, engagePointAutopilot, cancelAutopilot, finishMission, updateReturnHint, updateRoamNav, updateBanner, setPaused, togglePause, autoPauseOnBlur, reset, settleView } from './sim.js'; // the simulation loop + level runner + music + pause + restart + return-to-base + roam nav + milestone banner + camera/sky settle
import { openSystemMap, closeSystemMap, isSystemMapOpen } from './systemmap-ui.js'; // system-map overlay (out-of-combat mini-map tap → freeze + pick a destination)
import { SYSTEM, ZONE_RADIUS, inActivityZone, activityZoneCenters, listSystemObjects, planetAnchor } from './sim-core/system-map.js'; // ?roam dev readout: sizing/zone/backdrop live-tuning
import { buildTunePanel } from './tune.js'; // dev-only ?tune palette panel (lil-gui injected by bootstrap)
import { isDev } from './dev.js'; // sticky ?dev flag (perf overlay + telemetry), single source of truth
import { allyDev, allyDevLevel, applyAllyDev } from './ally-dev.js'; // ?ally dev flag: the wingman's arrival phase (+ the level it forces)
import { beamDev, lancerDev, lancerDevLevel, applyLancerDev } from './beam-dev.js'; // ?beam / ?lancer dev flags: the player's beam, the pirate lancer's spawn phase (+ the level it forces)
import { duelDevLevel, applyDuelDev } from './duel-dev.js'; // ?duel dev flag: the sparring room (+ the level it is built over)
import { evalRecord, evalPlayback, normalizeLevelName, traceLevelName, snapshotInput, makeTrace, validateTrace, makeReplaySession, stepReplayTick, hydrateTrace, traceTickCount } from './replay.js'; // ?record/?playback input-replay core (docs/plans/2026-07-09-replay-record.md)
import { makeSessionRecorder } from './session-record.js'; // always-on live-session recorder (funnel analytics)
import { makeIntroDirector } from './intro-director.js'; // the scripted Level-0 intro (the script is data on the descriptor)
import { HITBOXES_DEBUG, syncHitBoxes } from './hitboxes-debug.js'; // dev-only ?hitboxes wireframe hitbox overlay
import { showMain, launchMission, refreshMissions, enterRoam, missionOffers, activeMissionId, mainBriefing, mwItem, stagedActive } from './mainwindow.js'; // between-battles Main Window + model viewers + roam entry
import { shopItemViewer, updateTakeoffGate, primeShopItemsSeen } from './shop.js'; // ?debug diagnostic: the item model spinning in the shop/loadout detail panel + the launch gate (32-star-system drives it) + the "(new)"-marker baseline
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
// One session instance owns the PLAYBACK lifecycle state (extracted for a unit-tested teardown()).
const rs = makeReplaySession();
const sr = makeSessionRecorder(); // always-on live-session recorder (funnel analytics)
rs.play = evalPlayback(typeof location !== 'undefined' ? location.search : ''); // { id, finish } | null
// ---------- Server-run fight (?netsim) ----------
// Opt-in and additive: with the flag the level is simulated by a server ROOM and this tab only sends input
// and draws what comes back; without it nothing below runs and single-player is untouched (plan D1).
// Slice D has no client-side prediction, so the local ship answers the controls about 100 ms late — that is
// expected, and it is the baseline Slice E is measured against.
const NETSIM = evalNetsim(typeof location !== 'undefined' ? location.search : ''); // { level, seed } | null
const netsimActive = !!NETSIM; // the flag is on. NEVER cleared — an unavailable room is per-run (netDown), not forever
// `?netjerk` — a diagnostic that watches the poses renderNet writes and reports every break in them, with
// the delivery fingerprint at that instant. Read it from the console: `__netsim.jerk.report()`. Off by
// default: it walks every drawn entity per frame, and it answers a question, it is not a feature.
// The drawn-motion probe (netsim-jerk.js). ON BY DEFAULT while developing locally, because a diagnostic you
// have to remember to switch on is a diagnostic that is off during the run that mattered — twice already,
// once to a stray comma in the URL and once to simply not typing it. It costs a walk over the drawn entities
// per frame and records only discontinuities, and it never touches the picture.
//
// `?netjerk` forces it on anywhere (a deployed build, a phone); `?netjerk=0` forces it off. Matched against
// the raw query rather than through URLSearchParams, which is strict about the exact parameter name.
const netjerkFlag = typeof location !== 'undefined' && /(^|[?&])netjerk(=([^&]*))?/i.exec(location.search);
const netjerkOff = !!(netjerkFlag && /^(0|false|off)$/i.test(netjerkFlag[3] || ''));
const LOCAL_HOST = typeof location !== 'undefined'
  && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname || '');
const NETJERK = !netjerkOff && (!!netjerkFlag || LOCAL_HOST);
const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let netLink = null;           // the socket + uplink, once connected
let netConnecting = false;
let netsimPaused = false;   // __netsim.pause(): stop pumping/applying, freeze on the last known state
let netRoomPaused = false;  // last pause state pushed to the room (so we send only on a change)
let netStarted = false;     // the room has been told to begin (take-off), as opposed to merely joined
let netRunAt = null;        // G.gameStartTime of the run the room is playing (a new one means restart it)
let netLevel = null;        // the level the current room was created for (a change means reconnect)
let netDeferredBy = null;   // 'replay' | 'side-mission' | null — why netsim is standing aside this frame
let netJerkAlive = false;   // ?netjerk: previous frame's alive flag, so death can trigger the dump once
let netRoomIdle = false;    // the ROOM is not stepping (no live fight, a pause, a menu, a hidden tab)
let netDrawing = true;      // this tab is still RENDERING — true even on the death screen
let netFlying = false;      // this tab is at the CONTROLS — false in a menu, on the map, or when hidden
let netDown = false;        // the socket died under us: local for THIS run, retry on the next one
let netDownRunAt = null;    // the run it died in (G.gameStartTime), so the retry waits for a different one
const netState = createNetState();
// Write the whole probe record to a file the maintainer can send on. Called automatically the moment the
// ship dies — "when it lags badly, let it kill me" is a far better trigger than remembering to type
// something, because by the time you have typed it the interesting seconds have scrolled out of the ring
// buffers. Also on `__netsim.jerk.save()` for when you would rather not die.
function saveJerkDump(reason = 'manual') {
  const probe = netState.jerk;
  if (!probe) {
    // Say so rather than returning null into a console: "nothing happened" is the one answer a diagnostic
    // must never give.
    console.warn('[netjerk] the probe is not armed — reload with ?netjerk on the URL '
      + `(this tab's query is "${typeof location !== 'undefined' ? location.search : ''}"). `
      + 'Look for "[netjerk] probe armed" in the console to confirm.');
    return null;
  }
  const data = probe.dump({
    reason,
    savedAt: new Date().toISOString(),
    level: (netState.welcome && netState.welcome.level) || (NETSIM && NETSIM.level) || null,
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    screen: typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio } : null,
    gfx: G.gfx ? { tier: G.gfx.tier } : null,
  });
  const size = `${data.events.length} breaks, ${data.arrivals.length} packets, `
    + `${data.slowFrames.length} slow frames, ${data.marks.length} lifecycle marks`;
  console.info(`[netjerk] dumping (${reason}) — ${size}`);
  const json = JSON.stringify(data);

  // PRIMARY: post it to the dev server, which writes it next to the code that has to read it. The browser
  // download is a poor fit for this — Chrome may not credit a rAF callback with the user gesture a download
  // wants, which is exactly what happened the first time — and a file in ~/Downloads still has to be carried.
  // The sink only exists when the server was started with NETJERK_SINK=1; a 404 is not an error worth noise.
  fetch('/api/netjerk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json })
    .then((r) => r.ok ? r.json() : Promise.reject(new Error(`sink said ${r.status}`)))
    .then((r) => console.info(`[netjerk] written on the server → ${r.file}`))
    .catch((err) => console.warn(`[netjerk] server sink unavailable (${err.message}); use the download or __netsim.jerk.dump()`));

  // SECONDARY: the download, for when there is no dev server behind the page.
  try {
    const name = `netjerk-${data.level || 'room'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const b = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 10_000); // the click is async; do not pull the URL out from under it
    return name;
  } catch (err) { console.warn('[netjerk] could not download the dump', err); return null; }
}

if (NETJERK) {
  // Live line while you play, throttled to one a second so a burst does not bury the console. The full
  // list, with the delivery context of each break, is `__netsim.jerk.report()`.
  let lastLog = 0;
  netState.jerk = createJerkProbe({
    onBreak: (ev) => {
      if (ev.t - lastLog < 1000) return;
      lastLog = ev.t;
      console.warn(`[netjerk] ${ev.kind}#${ev.id} nose ${ev.dTurnDeg}°/frame  step Δ${ev.dStep} (mean ${ev.stepMean})`
        + `  ${ev.onSnapshotFrame ? 'ON a packet' : 'between packets'}`
        + `  arrivalGap ${ev.arrivalGapMs}ms tickGap ${ev.tickGap} sampleSpan ${ev.sampleSpanMs}ms/${ev.sampleTickGap}t`);
    },
  });
  console.info(`[netjerk] probe armed${netjerkFlag ? '' : ' (local dev — ?netjerk=0 to silence it)'}`
    + ' — dying writes the record to the server; __netsim.jerk.report() for the tally');
}
const ROAM = typeof location !== 'undefined' && location.search.includes('roam'); // ?roam dev sandbox: drop straight into the flyable star system (Stage 1 live-tuning)
let introMode = false;        // the Level-0 intro is being ENDED by Skip (finishIntro's own guard: advance 0→1 + Level-1 briefing)
if (REC || rs.play) G.replayMode = true; // dev record/playback sessions are READ-ONLY: the sim must not advance progress / bank credits / deposit loot on a (re)played win
let recSeed = 0;              // mulberry32 seed installed at record start (captured into the trace)
let recShipId = null;         // the player ship id used for the recording (rebuilt on playback)
let recLoadout = null;        // the player loadout at record time (weapons/mounts) — makes the trace account-independent
let recComponents = null;     // the player components at record time (hull/engine/…)
let recCapturing = false;     // true while capturing input (set by startRecordSession)
const recTicks = [];          // captured per-tick input snapshots for the current recording
let replayAcc = 0;            // real-time accumulator (s) driving the fixed-timestep record/playback loop
let modelsReady = false;      // the player ship .glb has loaded (gates record Start + playback arm)
// Record/playback determinism isolation lives in sim-random.js: the seeded stream is OPT-IN, consumed only by
// the enumerated GAMEPLAY draw sites (spawn timing/placement/pick, enemy reload jitter, loot rolls). Cosmetic
// FX + decor keep using the native Math.random, so an FX/decor change can never shift a recorded trace.
// This module just installs (seedSim) and clears (seedSim(null)) the stream around a session — DECISIONS §73.

// ---------- The scripted Level-0 intro (a fight you FLY, with a director talking over it) ----------
// The intro is an ordinary campaign level, played live and session-recorded like every other one. Over it a
// scripted director speaks five first-person lines and flies a controls card into the bottom-left #help
// cheatsheet. The SCRIPT is data on the level descriptor (`CATALOG.level.intro`, server/src/catalog_seed.js);
// the state machine is intro-director.js (pure, unit-tested); the SPAWN half of the same timeline is
// `spawn.earliest` in sim-core/level-runner.js. See docs/plans/2026-08-30-1654-playable-intro.md.
let intro = null;             // the director for THIS run, or null on every level that carries no `intro` script
let introHelpFlown = false;   // the controls card's one-shot flight into #help has been started

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
// Arena (ARENA/OOB consts, arenaCenter, arenaBorder), the starry sky, the star-system backdrop bodies +
// the player-locked speed-field, the mission set-pieces and buildMap()/updateSystemBodies()/updateSpeedField()/
// buildSetPiece() are imported from world.js. The reassigned per-map handles (sky/stars/systemBodies/
// G.skyAmbient/G.skySun/G.currentMapDescriptor/G.mapSetpieces/G.arenaDrift) live on the shared bag G.

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
  // #help used to be HIDDEN here ("keyboard hints not needed"), which left a phone with no controls
  // cheatsheet at all. It now carries a TOUCH variant instead (`ui.help_touch`, swapped in bootstrap), so it
  // stays on screen — and it has to: the intro's controls card flies INTO it, and a display:none target
  // measures as a zero rect, which would send the card to the corner of the screen at minimum scale.

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
  el.returnBtn.addEventListener('touchstart', e => { finishMission(); audio.sfx.uiClick(); e.preventDefault(); }, { passive: false });
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
  el.returnBtn.addEventListener('click', () => { finishMission(); });
}

// Roam bottom-center nav buttons (Return to Base / Autopilot to Mission). Each doubles as its OWN cancel:
// clicking the destination you are already flying to drops the autopilot back to manual; clicking the other
// re-routes in place. Same touch/click split as #return-btn (touchstart + preventDefault on touch, else click).
function roamReturnTap() {
  if (G.autopilot.active && G.autopilot.target?.kind === 'station') cancelAutopilot();
  else engageAutopilot();
}
function roamAutopilotTap() {
  if (G.autopilot.active && G.autopilot.target?.kind === 'point') cancelAutopilot();
  else if (G.roamMission) engagePointAutopilot(G.roamMission.pos, G.roamMission.missionId);
}
if (Device.hasTouch) {
  el.roamReturn.addEventListener('touchstart', e => { roamReturnTap(); audio.sfx.uiClick(); e.preventDefault(); }, { passive: false });
  el.roamAutopilot.addEventListener('touchstart', e => { roamAutopilotTap(); audio.sfx.uiClick(); e.preventDefault(); }, { passive: false });
} else {
  el.roamReturn.addEventListener('click', () => { roamReturnTap(); });
  el.roamAutopilot.addEventListener('click', () => { roamAutopilotTap(); });
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
  // 2) otherwise the clickable station — out of combat only (post-kill return-to-base OR free roam, where
  //    clicking home flies you back and offers to dock; see engageAutopilot)
  if (!G.baseStation || !G.baseStation.active) return false;
  stationRay.setFromCamera(eventNdc(e), camera);
  if (stationRay.intersectObject(G.baseStation.obj, true).length) { engageAutopilot(); return true; }
  return false;
}
renderer.domElement.addEventListener('click', (e) => { engageObjectAt(e); });

// ---------- System-map screen (out-of-combat "Map" button → freeze + pick a destination) ----------
// Context-sensitive corner: during a LIVE fight the #minimap stays the battle radar. Out of combat (roam /
// return-to-base) the radar is pointless (no enemies, no arena), so it is HIDDEN and a visible #map-btn takes
// its place; pressing it opens the system-map overlay, which freezes the game via G.mapOpen (a raw loop-skip,
// NOT setPaused). Picking a destination re-routes the autopilot; "Return to hangar" ends roam. The toggle
// (radar ↔ Map button) is driven per-frame in animate() by refreshMapControl().
// ?roam dev readout (Stage 1e): speed / pos / dist-to-orbit-4-edge / in-zone, plus the backdrop tunables
// exposed on window.__roam.SYSTEM for live console tweaking (`offset`, `fade` and each body's depth/size all
// affect the NEXT frame, since SYSTEM is shared by reference and updateSystemBodies re-reads it every
// frame). Gated strictly behind ?roam — never built in the shipped path.
let roamReadoutEl = null;
function buildRoamReadout() {
  roamReadoutEl = document.createElement('div');
  roamReadoutEl.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;font:600 12px/1.5 monospace;color:#9fe6ff;background:rgba(0,0,0,.62);padding:6px 10px;border-radius:6px;pointer-events:none;white-space:pre';
  document.body.appendChild(roamReadoutEl);
  window.__roam = { SYSTEM, enterRoam, openSystemMap: openSystemMapScreen }; // console live-tuning + shortcuts
}
function updateRoamReadout() {
  if (!roamReadoutEl || !G.player) return;
  const p = G.player.pos;
  const zones = activityZoneCenters(); if (G.activeMission && G.activeMission.center) zones.push(G.activeMission.center);
  const inZone = inActivityZone(p.x, p.z, zones, ZONE_RADIUS);
  const orbit4 = SYSTEM.planets[SYSTEM.planets.length - 1].orbitR;
  // nearest body + how far its anchor still is — the readout you actually want while crossing the system
  let near = '', nearD = Infinity;
  for (const d of listSystemObjects()) {
    const dist = Math.hypot(d.pos.x - p.x, d.pos.z - p.z);
    if (dist < nearD) { nearD = dist; near = d.id; }
  }
  roamReadoutEl.textContent =
    `roam · speed ${G.player.vel.length().toFixed(1)}\n`
    + `pos  ${p.x.toFixed(0)}, ${p.z.toFixed(0)}\n`
    + `orbit-4 edge ${(orbit4 - Math.hypot(p.x, p.z)).toFixed(0)}\n`
    + `${inZone ? 'in-zone' : 'open'} · ${G.autopilot && G.autopilot.active ? 'autopilot (uncapped)' : 'manual (capped)'}\n`
    + `nearest ${near} ${nearD.toFixed(0)}u · OFF ${SYSTEM.offset.x},${SYSTEM.offset.z}`;
}

function outOfCombat() { return !!(G.roam || G.returnToBase); }
function openSystemMapScreen() {
  openSystemMap({
    interactive: outOfCombat(),
    missionOffers,
    activeMissionId,                  // marks the object your current mission is at (campaign → its centre)
    // already flying → re-route the autopilot in place (no re-entry into roam). A mission object carries
    // its offer id so arriving raises the "Start mission?" prompt; every other object just parks there.
    onPick: (obj) => engagePointAutopilot(obj.pos, obj.missionId || null),
    onReturnToHangar: () => {
      G.roam = false; G.gameStarted = false;
      document.body.classList.add('menu');
      showMain(null); // back to the base menu exactly as today
    },
  });
}
window.__openSystemMap = openSystemMapScreen; // test/tool hook (also reachable via __game below)
// The out-of-combat "Map" button (replaces the hidden radar while roaming). Desktop click + touchstart (so a
// second thumb works while a finger holds the stick, like #return-btn — DECISIONS §42). Never opens twice.
const minimapEl = document.getElementById('minimap');
const mapBtnEl = document.getElementById('map-btn');
if (mapBtnEl) {
  const openMap = (e) => { if (e) e.preventDefault(); if (outOfCombat() && !isSystemMapOpen()) openSystemMapScreen(); };
  mapBtnEl.addEventListener('click', openMap);
  mapBtnEl.addEventListener('touchstart', openMap, { passive: false });
}
// Keyboard shortcut: M toggles the same overlay. Gated on `outOfCombat()`, exactly like the button — during
// a live fight the corner is the battle radar and there is no map to open, so M is a no-op there rather than
// a way to freeze a fight. Not device-gated: a keydown simply cannot happen without a keyboard, so this is
// desktop-only by construction and still works on a tablet with one attached.
//
// Deliberately NOT hung off the sim's global keydown (which mirrors every code into `keys` for the recorder):
// this is UI, not input. It ignores a keypress with a MODIFIER held — Cmd+M is "minimise window" on macOS and
// must keep working — and one typed into a field (the account screen's email/password inputs).
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (isSystemMapOpen()) { closeSystemMap(); return; }
  if (outOfCombat()) openSystemMapScreen();
});
// Per-frame corner toggle: in a live fight show the radar; out of combat hide it and show the Map button.
// (body.menu CSS already hides both on the base-menu screen, so this only governs the in-world states.)
function refreshMapControl() {
  const ooc = outOfCombat();
  if (minimapEl) minimapEl.style.display = ooc ? 'none' : '';
  if (mapBtnEl) mapBtnEl.style.display = ooc ? 'block' : 'none';
}

// Hover cursors (mouse only — meaningless on touch). Hovering a clickable station shows a first-party
// "dock here" glyph; hovering a loot chest shows the OS grab hand. A chest hover wins over the dock hover
// on overlap. Reuses the drop + station raycasts, throttled + only re-run on move.
let dockCursorOn = false;
let grabCursorOn = false;
const setDockCursor = (on) => { if (on !== dockCursorOn) { dockCursorOn = on; renderer.domElement.classList.toggle('dock-cursor', on); } };
const setGrabCursor = (on) => { if (on !== grabCursorOn) { grabCursorOn = on; renderer.domElement.classList.toggle('grab-cursor', on); } };
// The station is a click target out of combat: after the last kill (return-to-base) AND while roaming.
// `G.baseStation.active` is the flag both states set — during a live fight it is false, so the hover
// cursor and the click stay off.
const stationClickable = () => !!((G.returnToBase || G.roam) && G.baseStation && G.baseStation.active
  && G.player && G.player.alive && !levelRunner.won);
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
  // Last-resort upload path only (see visibilitychange below, which already sent this session over a normal
  // fetch). Provisional — a pagehide can be a BFCACHE freeze the player returns from, and the session must
  // keep recording if it is.
  flushSession('quit', { beacon: true, final: false });
});
// THE upload path on phones and tablets. `pagehide` routinely never fires there — backgrounding the app or
// locking the screen freezes/discards the page instead — which is why a tablet tester's whole session left
// no row at all. `visibilitychange → hidden` is the one event that reliably lands, and it fires while the
// page is STILL ALIVE, so the trace goes out over a normal fetch with no ~64KB beacon body cap.
//
// Provisional on purpose: the recorder keeps running, so a player who tabs away and comes back and then wins
// re-sends the SAME session id and the server updates that row in place (no duplicate, no truncated trace).
// The `quit` FUNNEL event deliberately stays on pagehide only — firing it on every tab switch would inflate
// drop-off with players who simply came back.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSession('quit', { final: false });
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

  // --- Stall attribution (added after field freezes of 700-1100 ms that our own buckets could not explain:
  // our JS accounted for 12-40 ms of them, the scene was byte-identical before and after, and once even the
  // sampler itself skipped 6 s). Two cheap signals split the remaining suspects:
  //
  //   gpuRes — three.js's live resource counts. A shader PROGRAM, geometry or texture created during a
  //     freeze second means the stall is GPU-resource creation (compile/upload), which is fixable by
  //     warming it ahead of time — the same medicine that cured the first-sighting ship stall.
  //   longTasks — main-thread blocks >50 ms, per the Long Tasks API. Freezes that show up here are OUR
  //     thread (script or GC); freezes that DON'T are outside it (compositor, GPU process, CPU governor /
  //     thermal), which no amount of our own optimisation will fix.
  //
  // Both are diagnostic only and cost nothing per frame: counters read once per sample.
  const gpuRes = () => {
    const m = renderer.info.memory, p = renderer.info.programs;
    return { programs: p ? p.length : null, geometries: m.geometries, textures: m.textures };
  };
  let longTasks = 0, longTaskMs = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { longTasks++; longTaskMs += e.duration; }
    }).observe({ type: 'longtask', buffered: false });
  } catch { /* not supported (Safari/Firefox) → the fields stay 0 and simply carry no signal */ }

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
        gpu: gpuRes(),  // live three.js programs/geometries/textures — a jump here IS the stall's cause
        // main-thread blocks >50 ms in THIS sample window: >0 on a freeze frame = our thread (script/GC);
        // 0 on a freeze frame = the stall happened outside it (compositor / GPU process / thermal).
        longTasks: { n: longTasks, ms: r1(longTaskMs) },
        res: `${renderer.domElement.width}x${renderer.domElement.height}`, device,
      });
    }
    bucket = []; bucketStart = now;
    longTasks = 0; longTaskMs = 0; // per-window counters
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

// Pre-compile shaders + upload GPU resources so a fight doesn't stall while it is being played.
//
// THREE compiles a material's program and uploads its textures LAZILY — on the first frame the object is
// actually drawn. Field telemetry from a weak phone measured what that costs: over the first 15 seconds of
// combat the main thread was blocked for a total of **10+ seconds** (a single 2082 ms frame among them)
// while the live program count climbed 14 -> 33 and geometries 15 -> 43. After ~20 s it settled to 25-35 fps.
// The player's verdict was "I don't even want to play after 5 seconds", which is exactly right: the game is
// unusable for as long as it is building itself.
//
// The fix is WHEN, not what. This used to run once at bootstrap — before a level exists, so it warmed an
// empty scene and everything real compiled later, during play. It now runs again after each level build
// (`G.needsSceneWarm`, set by sim.reset()), which moves that work into the level-load moment where a pause
// reads as loading rather than as a broken fight.
//
// The warm rig is PERMANENT. Effects that are not in the scene between spawns (bullets, explosions) are
// warmed through throwaway meshes matching their program keys — but this used to `dispose()` those
// materials immediately, which hands the freshly compiled programs straight back: THREE frees a program
// when its last material is disposed. Since every FX primitive disposes its material on death, the program
// is then recompiled the next time one spawns — visible in telemetry as the live count sawing 37<->40 with
// 100-300 ms main-thread blocks. Keeping one material of each config alive for the session stops that.
// Parked far off-camera and frustum-culled, so it costs nothing per frame; `compile()` ignores culling.
const quadGeoForWarm = new THREE.PlaneGeometry(1, 1); // carrier for the held FX materials (never drawn: the rig is off-camera)
let warmRig = null;
let warmDeferred = false; // the veil is up; do the blocking compile on the NEXT frame (see animate)
let warmDeadline = 0;
const WARM_MAX_WAIT_MS = 9000; // cap on waiting for assets — a stuck download must not block the game
function prewarmShaders() {
  try {
    if (!warmRig) {
      warmRig = new THREE.Group();
      const addMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }); // explosions/flashes/shockwave
      const fogMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); // bullets/rockets (opaque, scene fog on)
      // Ship-death FX: measured as the one effect still compiling on first use (+3 programs), and it
      // recompiles after every lull because each sprite/ring disposes its material when it finishes.
      warmRig.add(new THREE.Mesh(explosionGeo, addMat), new THREE.Mesh(bulletGeo, fogMat),
        new THREE.Mesh(quadGeoForWarm, flipbookKeepAliveMaterial()),
        new THREE.Mesh(quadGeoForWarm, ringKeepAliveMaterial()));
      warmRig.position.y = -100000; // off-camera; culled every frame, never disposed
      scene.add(warmRig);
    }
    renderer.compile(skyScene, camera);
    renderer.compile(scene, camera);
  } catch { /* best-effort — shader warmup must never break startup or a level load */ }
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
      const bx = e.pos.x, bz = e.pos.z, by = e.heading;
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
  if (G.player && G.player.alive) rec(0, G.player.pos.x, G.player.pos.z, G.player.heading);
  else rec(0, bdRec.last[0].x, bdRec.last[0].z, bdRec.last[0].yaw);       // player always recorded, birth:0/death:-1
  for (let s = 1; s < bdRec.ships.length; s++) {
    const e = bdRec.cast[s];              // cast[s] aligned to slot s (cast[0] = null, the player)
    if (enemies.includes(e)) rec(s, e.pos.x, e.pos.z, e.heading);
    else { if (bdRec.ships[s].death < 0) bdRec.ships[s].death = kf; rec(s, bdRec.last[s].x, bdRec.last[s].z, bdRec.last[s].yaw); }
  }
  let bc = 0; for (const b of bullets) { if (bc >= MAX_GHOST_BULLETS) break; bdRec.bullets.x.push(b.pos.x); bdRec.bullets.z.push(b.pos.z); bc++; }
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

// Join a server-run room for this level. Called once, lazily, on the first frame after the fight starts —
// so the ordinary boot (catalog, ship, take-off) is unchanged and the socket only exists while playing.
//
// A failed handshake FALLS BACK to simulating locally rather than leaving the player staring at a ship that
// does not answer. That is the friendly behaviour and it is nearly free: `netsimActive` is the only thing
// that routes the loop, so clearing it hands the fight back to the local sim mid-frame.
// Leave the room and forget its ghosts, WITHOUT giving up on netsim: `netsimActive` stays true, so the
// next frame that is not owned by a replay reconnects. Used when a replay session arms after the socket
// has already opened.
// Netsim became unavailable — the handshake failed, or the socket went away under us. There is NO permanent
// failure state: this run continues on the local simulation and the next run tries again. A tab that
// disabled itself until a page reload was strictly worse, and it is what a server restart used to do.
function goLocal(why) {
  if (netDown) return;
  console.warn(`[netsim] ${why} — this run continues on the local simulation, will retry on the next one`);
  // This is the loudest thing that can happen to a fight: every ghost is despawned and the LOCAL sim picks
  // the world up mid-flight, which the player sees as the whole battle jumping. It has to be in the record.
  netState.jerk?.mark('go-local', { why }, perfNow());
  netDown = true; netDownRunAt = G.gameStartTime;
  netLink = null; netStarted = false; netRoomPaused = false; netRunAt = null; netLevel = null;
  clearNet(world, netState);
  netState.welcome = null; netState.ack = null;
}

// A click-to-fly intent on its way to the room. A clicked DROP is a server entity, so it travels as the
// network id the room knows it by — the local object means nothing over there.
function sendNetCommand(cmd) {
  if (!netLink) return;
  if (cmd.kind === 'drop') {
    const id = netState.idOf.get(cmd.drop);
    if (id == null) return; // already collected, or never ours to click
    return netLink.command({ kind: 'drop', id });
  }
  netLink.command(cmd);
}

function dropNetsim() {
  netState.jerk?.mark('drop-link', null, perfNow());
  try { netLink.close(); } catch {}
  // `netRunAt` deliberately SURVIVES: it records which run a room was last told to play. Clearing it made
  // a reconnect look like a brand-new run, so winning a level — which advances `CATALOG.levelName` and
  // therefore reconnects — immediately started the NEXT level's fight while the player was still looking at
  // the victory overlay. `G.gameStarted` stays true between fights, so it cannot be the gate.
  netLink = null; netStarted = false; netRoomPaused = false; netLevel = null;
  clearNet(world, netState);
  netState.welcome = null; netState.ack = null;
}

async function startNetsim() {
  netConnecting = true;
  const bail = (err) => goLocal(String((err && err.message) || err));
  try {
    // The room must fight the level this tab has already BUILT — same map, same set-pieces, same arena
    // centre — or the two disagree about where the world is. `CATALOG.levelName` is the seed name the
    // client resolved at boot; an explicit `?netsim=level-N` overrides it deliberately.
    //
    const level = NETSIM.level || CATALOG.levelName;
    netLevel = level;
    netLink = await connectNetsim({
      playerId: G.playerId, level, seed: NETSIM.seed,
      ally: allyDev()?.phase || null,   // ?ally (dev): ask the room to run the wingman on that phase
      lancer: lancerDev()?.phase || null, // ?lancer (dev): ask the room to fly that phase against pirate lancers
      beam: beamDev() || null,            // ?beam (dev): the ROOM must mount the beam too, or it flies the real gun
      onWelcome: (w) => {
        netState.welcome = w;
        netState.jerk?.mark('welcome', { tick: w.tick, level: w.level, snapshotEvery: w.snapshotEvery }, perfNow());
        console.info(`[netsim] room joined: level=${w.level} seed=${w.seed} dt=${w.dt} snapshotEvery=${w.snapshotEvery}`);
        if (w.level !== level) console.warn(`[netsim] the room is fighting ${w.level}, this tab built ${level}`);
      },
      onSnapshot: (snap) => { netState.ack = snap.ack; if (!netsimPaused) applySnapshot(world, netState, snap, performance.now()); },
      // An UNEXPECTED close (server restarted, network died) is not a permanent verdict on netsim. Fall
      // back to the local simulation so the fight carries on rather than freezing — the World is already
      // populated and `simTick` can just continue it — and try again at the next run. Reconnect proper is
      // a documented non-goal for this cut; silently dying until a page reload is worse than the non-goal.
      onClose: (ev) => goLocal(`socket closed (${ev && ev.code})`),
      // Before the handle exists this is a handshake failure; after, a dying socket. Same answer either way.
      onError: bail,
    });
    if (!netLink) bail(new Error('no socket'));
  } catch (err) { bail(err); }
  netConnecting = false;
}

function animate() {
  // ?bench=replay drives its own timed tick loop (window.__bench.replay). Keep the rAF loop idle so leftover
  // combat state can't churn/render (under software GL) between measurements and stall the next navigation.
  if (BENCH === 'replay') return;
  requestAnimationFrame(animate);
  const rawSec = clock.getDelta();        // true frame interval (unclamped) — for the perf metrics
  const dt = (BENCH || REC || rs.play) ? BENCH_DT : Math.min(rawSec, 0.05); // bench/record/playback: fixed step for determinism; else clamped for sim stability
  const t0 = DEV ? performance.now() : 0;
  tickZoom(dt); // ease the camera zoom toward its target every frame (independent of the pause freeze)
  // A record/playback session replays the LOCAL sim and owns the tick, so netsim stands aside for as long
  // as one is running (see netsimDefersTo).
  // Why a room is not driving this frame (null = it is). Re-decided every frame on purpose — see
  // netsimDeferReason; both reasons arrive AFTER the socket is already open.
  netDeferredBy = netsimDeferReason({
    record: REC, playback: rs.play, roam: G.roam,
    sideMission: isUnroomableSideMission(NETSIM, G.activeMission),
  });
  // A dropped socket is local until a NEW run starts — retrying mid-fight would swap the simulation out
  // from under the player, and retrying every frame would hammer the endpoint.
  if (netDown && G.gameStarted && G.gameStartTime !== netDownRunAt) netDown = false;
  const netsimDriving = netsimActive && !netDeferredBy && !netDown;
  if (netsimActive && netLink && netDeferredBy) dropNetsim();
  // Route click-to-fly to whoever is simulating. Installed only while a room actually drives the fight, so
  // the moment netsim defers or drops, clicking the station goes back to engaging the LOCAL autopilot.
  world.onCommand = (netsimDriving && netLink && netStarted) ? sendNetCommand : null;
  // Published for the victory path: a run a ROOM is simulating is a run the room banks (DECISIONS §131).
  G.netDriving = netsimDriving;
  const live = G.gameStarted && !BENCH && !REC && !rs.play && !netsimDriving; // real player session → deterministic accumulator loop (always-on recording)
  if (netsimDriving) {
    // The server owns the fight: no local sim step at all. Send this frame's input, draw the world as the
    // room described it ~100 ms ago (netsim-world.js interpolates between snapshots), and run the ordinary
    // render half — which drains the wire events through the SAME adapter local events go through, so FX,
    // audio, the HUD and the overlays all work without knowing where the fight is being decided.
    // THE ROOM MUST MATCH THE RUN THIS TAB IS ABOUT TO PLAY, in both level and freshness.
    //   • Level: the client builds the map, set-pieces and arena centre per level, so a room on another one
    //     fights somewhere the player is not looking. Advancing after a win changes it under us.
    //   • Freshness: `reset()` stamps `G.gameStartTime` per run. A retry needs the room's world emptied and
    //     the level script restarted, or the second fight plays out in the first one's leftovers.
    // Connecting happens during the MENU so take-off does not pay the handshake (it cost ~2.6 s of a ship
    // that would not answer); a level change is the one case that has to reconnect and eat it.
    const wantLevel = NETSIM.level || CATALOG.levelName;
    if (netLink && netLevel !== wantLevel) dropNetsim();
    if (!netConnecting && !netLink && wantLevel) startNetsim();
    // Begin — or begin AGAIN — only when a run actually starts, so a room does not spawn into an empty
    // hangar while the player reads a briefing.
    if (netLink && G.gameStarted && netRunAt !== G.gameStartTime) {
      netRunAt = G.gameStartTime;
      // A fresh LINK starts; an existing one restarts its world. Keyed to `netStarted` (per link) rather
      // than to whether we have ever seen a run, because a level change reconnects mid-session.
      const pose = world.runKeepPlayer ? {
        x: world.player.pos.x, z: world.player.pos.z, h: world.player.heading,
        vx: world.player.vel.x, vz: world.player.vel.z,
      } : null;
      netState.jerk?.mark(netStarted ? 'run-restart' : 'run-start', { level: netLevel }, perfNow());
      if (!netStarted) { netStarted = true; netLink.start(pose); } else netLink.restart(pose);
      netRoomPaused = false; // both messages start the driver server-side
    }
    // Pause and the system map both have to reach the ROOM, or the button lies: the local overlay would say
    // "Paused" while the fight kept running and the ship kept taking hits. One player per room makes a real
    // freeze legitimate (DECISIONS §16).
    // EXIT POINTS. A room must not keep stepping when there is no fight to step: after a death or a
    // victory the player is looking at an overlay, and after "back to the hangar" they are in a menu — but
    // the room went on simulating, so the badge still read green in the hangar and the server kept a 60 Hz
    // world alive for nobody. Same predicate the game uses everywhere else for "a fight is running".
    const fightLive = G.gameStarted && G.player && G.player.alive && !levelRunner.won;
    // ?netjerk: dying is the save button. The record covers the seconds that just went wrong, which is
    // exactly what a ring buffer loses if you go and type a command instead.
    if (NETJERK && netState.jerk) {
      const aliveNow = !!(G.gameStarted && G.player && G.player.alive);
      if (netJerkAlive && !aliveNow) { netState.jerk.mark('death', null, perfNow()); saveJerkDump('death'); }
      netJerkAlive = aliveNow;
    }
    // A HIDDEN TAB pauses the room too. The browser throttles rAF to nothing in a background tab, so the
    // client stops sampling input and stops drawing — but the room kept stepping at 60 Hz, which means
    // coming back to a ship that had been shot at by an enemy you could neither see nor answer. (The
    // audible symptom is the reverse: the sounds stop, because the tab does, while the fight does not.)
    // Single-player has the same instinct — `autoPauseOnBlur` — and one player per room makes it honest.
    const hidden = typeof document !== 'undefined' && document.hidden;
    // THREE SEPARATE QUESTIONS. Conflating the first two froze the game on the death screen; conflating the
    // first and third froze it on coming back to a tab.
    //
    //   `roomIdle`   — should the ROOM step? Only "is there a live fight", and nothing else. **A running
    //                  simulation is not stopped by what one tab is doing.** It used to stop for a hidden
    //                  tab, an open menu and the system map, and every one of those created a moment of
    //                  "the world is frozen, now resume it" to get wrong — which is where a day of freeze
    //                  reports lived. It is also the rule multiplayer requires (DECISIONS §123 allowed the
    //                  pause only because a room holds one player), so this is the honest version arriving
    //                  early. The cost is deliberate and was chosen: leave a fight and you are still IN it,
    //                  being shot at. The room releases your controls when you go quiet (INPUT_HOLD_TICKS)
    //                  so the ship coasts rather than flying on, but it does not protect you.
    //   `flying`     — should this tab send INPUT? Only while the player is actually at the controls. A
    //                  menu, the map or a hidden tab all mean "not flying", and the room hears the silence.
    //   `drawing`    — should this tab still RENDER? Almost always yes. The frame after you die is when the
    //                  explosion plays, the "Ship Destroyed" overlay opens and the run is banked — all of
    //                  which happen in `renderTick`, draining the events the room sent. Gating rendering on
    //                  "is a fight running" therefore stopped the game dead at the exact moment it had the
    //                  most to say.
    const roomIdle = !fightLive;
    const flying = fightLive && !G.paused && !G.mapOpen && !hidden;
    const drawing = !G.paused && !G.mapOpen && !netsimPaused;
    netRoomIdle = roomIdle; netDrawing = drawing; netFlying = flying; // on __netsim: never one flag
    if (netLink && roomIdle !== netRoomPaused) {
      netRoomPaused = roomIdle; netLink.setPaused(roomIdle);
      netState.jerk?.mark('room-idle', { on: roomIdle }, perfNow());
    }
    // A client that is not flying still says hello — though the room no longer depends on it for liveness
    // (the server pings, and a frozen tab answers that without running any code at all).
    if (netLink && !flying) netLink.keepAlive();
    if (netLink && netStarted && drawing) {
      // Input only while the player is actually at the controls. A dead ship must not fire a held key, and
      // a menu is not flying — the room hears the silence and lets go of the controls on its own.
      if (flying) netLink.pump(Math.min(rawSec, 0.1), keys, touchAim);
      renderNet(world, netState, performance.now());
      setGrabTarget(netState.grabTarget); // the room owns the Grab; this is only its beam
      renderTick(dt);
    }
  } else if (REC || rs.play || live) {
    // Fixed-timestep ACCUMULATOR: advance the sim at BENCH_DT as many WHOLE steps as real elapsed time allows,
    // so record + playback run at real-time speed on ANY display refresh (a 120 Hz screen would otherwise run
    // 2× because one fixed step ran per frame). Each tick stays a deterministic fixed dt; we capture (record)
    // or apply (playback) exactly one tick per step. Only runs once armed (record: after "Start"; playback:
    // once models loaded) — before that the ship sits idle with the real model on screen (no placeholder flash).
    if ((recCapturing || rs.armed || live) && !G.paused && !G.mapOpen) {
      replayAcc += Math.min(rawSec, 0.1); // clamp: after a stall/tab-throttle, don't fast-forward a huge burst
      let steps = 0;
      // The per-tick body is shared with window.__replay.step(n) (replay.js stepReplayTick) so the two
      // drivers can no longer drift apart. Built once per frame: `live`/`recCapturing` are read inside the
      // closures, so the values stay current.
      const tickDeps = {
        rs, keys, touchAim, dt: BENCH_DT, update,
        capture: () => {
          if (recCapturing) recTicks.push(snapshotInput(keys, touchAim));
          if (live) sr.captureTick(snapshotInput(keys, touchAim)); // always-on: capture the real operator input per sim tick
        },
        onTick: introTick,                          // the Level-0 intro director speaks off the SIM clock
        isCleared: () => G.returnToBase && !levelRunner.won,
        isWon: () => levelRunner.won,
        finish: finishMission,
      };
      // `rs.done` (trace exhausted) must gate PLAYBACK only, never live play. The Skip path sets
      // `rs.done = true` right AFTER finishIntro()→rs.teardown() already reset it to false + nulled rs.play,
      // so a live session inheriting that stale `rs.done` would never step — the ship never centers and
      // controls are dead until a refresh builds a fresh rs. Ignore rs.done when rs.play is null (live):
      // for ?playback rs.play is truthy so freeze-on-exhaustion is unchanged.
      while (replayAcc >= BENCH_DT && steps < 6 && !(rs.play && rs.done)) {
        if (stepReplayTick(tickDeps) === 'stop') break; // exhausted trace / stalled return-home: no time consumed
        replayAcc -= BENCH_DT;
        steps++;
      }
      if (recCapturing) updateRecordHud();
      if (rs.play) updatePlaybackHud();
    }
  } else {
    if (!G.paused && !G.mapOpen) update(dt); // pause / open system map freezes the whole fight (enemies, bullets, cooldowns, repair, spawns)
    // ?bench record: snapshot the resolved input AFTER update() so the trace replays identically (see bench.js)
    if (benchRecording) benchRecord.push({ k: Object.keys(keys).filter((c) => keys[c]), t: touchAim.active ? [touchAim.heading, touchAim.thrust] : null });
  }
  // ?dev backdrop recorder: capture live-played transforms → backdrop-battle.js. Gate on !G.paused so a pause
  // mid-record can't accumulate dt/elapsed, record frozen duplicate frames, or auto-stop during a pause.
  if (bdRec && !G.paused) backdropCapture(dt);
  if (HITBOXES_DEBUG) syncHitBoxes(scene, G.player, enemies); // dev-only hitbox wireframe overlay
  const t1 = DEV ? performance.now() : 0; // end of sim
  updateHud();
  if (NETSIM) updateNetBadge(); // which simulation is actually running this fight
  updateProgressionHud(); // always-on bottom XP bar + free-skill-points badge on the Character menu item
  updateMarkers();
  updateDropMarkers(); // green edge arrows toward off-screen loot drops (nearest 6)
  updateMissionMarker(); // gold edge arrow toward the active mission while roaming (off-screen only)
  updateCreditPopups(); // floating "+xx" gold credit popups at kill sites
  updateEnemyHealthBars(); // translucent red health bars above damaged enemies
  updateOobWarning(); // soft-boundary "left the battlefield" warning + countdown
  updateReturnHint();   // centered "return to base" HUD hint
  updateRoamNav();      // roam bottom-center nav: Return to Base + Autopilot to Mission
  updateBanner();       // transient centered milestone banner ("10 enemies left", "Final Stage")
  updateIntro();        // the scripted Level-0 intro: push the director's current line into the DOM
  if (dockCursorOn && !stationClickable()) setDockCursor(false); // drop the dock cursor when the station stops being clickable (no raycast)
  if (grabCursorOn && !drops.length) setGrabCursor(false); // drop the grab cursor when the last chest is gone (no raycast)
  updateMiniMap();    // corner radar: arena bounds, player, enemies
  refreshMapControl(); // out of combat: hide the radar, show the "Map" button (and vice-versa in a fight)
  if (ROAM) updateRoamReadout(); // ?roam dev sizing/zone/backdrop readout (never built in the shipped path)
  updateShieldBubble(G.paused ? 0 : Math.min(rawSec, 0.05)); // advances the shared FX clock + tracks the ship (frozen while paused)
  updateEnemyShieldBubbles(); // enemy hit-ripples (pooled, tier-capped) — MUST run after updateShieldBubble (shared clock)
  const t2 = DEV ? performance.now() : 0; // end of DOM overlays
  // A level was just (re)built: compile its materials and upload its textures NOW, in one hit, rather than
  // letting them trickle in over the first seconds of the fight (sim.reset sets the flag).
  //
  // That work BLOCKS the main thread — measured at ~3.2 s in a single render call on a weak phone — so it
  // runs one frame LATE, behind a veil. Showing the veil and compiling in the same frame would be useless:
  // the browser cannot paint the veil until the frame ends, i.e. until after the block. So frame N raises
  // the veil and returns; frame N+1 (with the veil already on screen) does the work and takes it down.
  // Without this the player sees the game sitting at 1 fps and assumes it is broken.
  if (G.needsSceneWarm) {
    G.needsSceneWarm = false;
    el.levelWarm.classList.add('on');
    // Anchor the cap on the FIRST raise of this wait. Late arrivals re-raise the warm request, and resetting
    // the deadline each time would push it forward indefinitely — on a genuinely slow link the veil then
    // never comes down and the player is locked out, which is worse than starting with placeholders.
    if (!warmDeferred) warmDeadline = performance.now() + WARM_MAX_WAIT_MS;
    warmDeferred = true;
  } else if (warmDeferred) {
    // Also wait out the .glb loads still in flight (ship models, set-pieces). Without this the veil drops
    // as soon as the shaders are warm and the player starts the fight looking at PROCEDURAL PLACEHOLDER
    // cones while the real models trickle in — reported on the itch build, where the first load fetches
    // ~20 MB. `WARM_MAX_WAIT_MS` is a hard cap: a wedged or failed download must never lock anyone out of
    // the game, it just means they start with placeholders as before.
    if (G.pendingAssets > 0 && performance.now() < warmDeadline) return; // next frame is already scheduled (top of animate)
    warmDeferred = false;
    prewarmShaders();
    el.levelWarm.classList.remove('on');
  }
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
// showMain/selectMenu/mission list/launchCampaign/launchMission/refreshMissions + the briefing-item
// showcase viewer are imported at the top; __game (below) reads its live state
// (missionOffers/mainBriefing/mwItem).

// ---------- Hangar shop + stash moved to src/shop.js ----------
// openBay/showBayView/updateTakeoffGate/renderShipStatsBar/deriveShipStats/resetShipStatsDelta are
// imported at the top; the shop bay is a self-contained leaf (server-authoritative buy/sell/equip).

// ---------- Dev color/lighting tuning panel moved to src/tune.js ----------
// buildTunePanel(GUI) is imported at the top; bootstrap dynamically imports lil-gui under ?tune and
// calls it (so players never fetch the GUI lib).

// A VISIBLE mode badge, shown whenever `?netsim` is on. It exists because the flag is URL-only and not
// sticky (deliberately — a flag surviving a reload would silently keep a player on the socket path), so it
// is easy to end up on the local simulation without noticing. That happened three playtests running: every
// "netsim feels great" report turned out to be the local path, which is exactly the report that cannot be
// acted on. A room is now something you can SEE you are in.
//
// Placed below the wordmark rather than at top-centre, where the record HUD lives — that spot already holds
// "VEGA SENTINELS" and the pause button.
let netBadgeEl = null;
function updateNetBadge() {
  if (!NETSIM) return;
  if (!netBadgeEl) {
    netBadgeEl = document.createElement('div');
    netBadgeEl.id = 'netsim-badge';
    netBadgeEl.style.cssText = 'position:fixed;top:40px;left:50%;transform:translateX(-50%);z-index:99998;'
      + 'font:600 11px/1.4 system-ui,sans-serif;letter-spacing:.06em;background:rgba(0,0,0,.72);'
      + 'padding:3px 10px;border-radius:7px;pointer-events:none;user-select:none;white-space:nowrap';
    document.body.appendChild(netBadgeEl);
  }
  // Green ONLY while a room is actually driving this tab; amber for every flavour of "you are local".
  const driving = netsimActive && !netDeferredBy && !!netLink && netStarted && !netRoomPaused;
  const reason = netDeferredBy ? `local · ${netDeferredBy}`
    : netDown ? 'local · disconnected'
    : !netLink ? (netConnecting ? 'connecting…' : 'local · no room')
    : !netStarted ? 'room joined'
    : netRoomPaused ? 'room idle'   // joined, but no fight to step — an overlay or a menu is up
    : `room · ${netState.welcome ? netState.welcome.level : '?'}`;
  const colour = driving ? '#4dff88' : '#ffb454';
  netBadgeEl.style.color = colour;
  netBadgeEl.style.border = `1px solid ${colour}`;
  netBadgeEl.textContent = `NETSIM ${driving ? '●' : '○'} ${reason}`;
}

// Netsim inspection handle. Unlike `__game` this is attached whenever the flag is on, `?debug` or not: the
// first question about a server-run fight is always "am I actually connected", and it should be answerable
// from the console during a real playtest, not only under a test flag.
if (NETSIM) {
  window.__netsim = {
    get active() { return netsimActive; },
    get connected() { return !!netLink; },
    get started() { return netStarted; },
    get deferredBy() { return netDeferredBy; }, // why we are on the LOCAL sim right now (null = we are not)
    get down() { return netDown; },             // the socket died; local until the next run
    // The ship is INTERPOLATED like everything else now (docs/plans/netsim-one-clock-rendering.md); nothing
    // in this tab predicts. Kept as a field so a test or a console reading it gets a straight answer.
    get predicting() { return false; },
    get clock() { return netState.clock; },   // tick → wall clock, the one timeline the picture is drawn on
    get roomIdle() { return netRoomIdle; },
    get flying() { return netFlying; },   // is this tab at the controls (menus and hidden tabs are not)
    get drawing() { return netDrawing; },
    get tick() { return netState.lastTick; },
    get level() { return (netState.welcome && netState.welcome.level) || NETSIM.level; },
    get welcome() { return netState.welcome; }, // what the room said about this fight when we joined
    get uplinkTick() { return netLink ? netLink.uplink.tick : -1; },
    // Round-trip health at a glance: how far the room's acknowledgement trails the input we have sent.
    get ack() { return netState.ack; },
    get behind() { return netState.ack == null ? null : (netLink ? netLink.uplink.tick - netState.ack : null); },
    get lastSent() { return netLink ? netLink.uplink.lastSent : null; },
    // Stop talking to the room WITHOUT tearing anything down: the world freezes on its last known state.
    // A test uses it to prove nothing is being simulated locally underneath; a human uses it to look at a
    // still frame. `resume()` puts it back.
    pause() { netsimPaused = true; },
    resume() { netsimPaused = false; },
    get paused() { return netsimPaused; },
    // ?netjerk only. `.report()` is the summary — the headline is `byCause`: a break on a frame where no
    // packet was applied is not the network's fault, it is the client drawing a curve as a straight line.
    get jerk() { return netState.jerk; },
    // `?netjerk` only: write the record to a file. Happens by itself when the ship dies.
    saveJerk: (reason = 'manual') => saveJerkDump(reason),
  };
}

// Test/inspection hook for the headless visual tests (client/visual/). Inert during normal
// play — only attached when the page is opened with `?debug`. It exposes simulation internals
// so a scenario can seed entities and assert on state (counts, colors) instead of diffing pixels.
if (location.search.includes('debug')) {
  window.__game = {
    // `skyScene` + `renderer` are here for headless PERF probes: the frame is two full passes (sky, then
    // combat), and reasoning about fill cost needs to walk both scenes and read renderer.info.
    scene, skyScene, renderer, camera, enemies, allies, bullets, rockets,
    explosions, sparks, shockwaves, smoke,
    // Exhaust FX debug hooks: the GLOBAL (a)/(b) look toggle + read the current mode / live freighter plume.
    exhaust: {
      setGlobalExhaustMode,
      get currentMode() { return getCurrentMode(); },
      get activeFreighterPlume() { return getActiveFreighterPlume(); },
      pump: updateShipExhaust, // headless-test hook: step every ship plume's throttle fade by a fixed dt (deterministic, no reliance on the software-WebGL frame rate)
    },
    spawnEnemy, spawnEnemyShip, spawnShipExplosion, emitExhaust, reset, levelRunner,
    // Debug/test shim: spawnRocket now takes the World first (sim-core/spawn.js). Bind this tab's World so
    // the visual scenarios keep their historical 6-argument call.
    spawnRocket: (from, fwd, weapon, accel, fromPlayer, target) => spawnRocketInto(world, from, fwd, weapon, accel, fromPlayer, target),
    // Bullet spawn bound to this tab's World — mirrors the spawnRocket shim above.
    spawnBullet: (from, dir, weapon, fromPlayer) => spawnBulletInto(world, from, dir, weapon, fromPlayer, null),
    // Hit feel (hit-fx.js): the live tunables + each ship's own flash/punch impulse state, so a scenario can
    // drive real hits and read what the FX did instead of guessing at pixels alone.
    hitFx: { HIT_FX, flashOf: (ship) => ship?.mesh?.userData?.hitFlash || null,
             punchOf: (ship) => ship?.mesh?.userData?.hitPunch || null },
    spawnEnemyShieldHit, // test/tool hook: fire an enemy shield ripple at a world point
    get enemyShieldSlots() { return enemyShieldSlots(); }, // diagnostic: the pooled enemy bubble slots
    get enemyShieldRefills() { return G.enemyShieldRefills; }, // diagnostic: completed enemy shield refills this run (replay triage)
    get allyKills() { return G.allyKills; }, // diagnostic: how many of this run's kills the WINGMAN took — the
                                             // number the ?ally dev flag exists to produce (nothing else on
                                             // screen reveals it, by design; docs/plans/combat-ally.md §3)
    get shipModelsParsed() { return shipModelCacheSize(); }, // diagnostic: distinct ship glbs parsed (cache size — must NOT grow per spawn)
    // The parallax backdrop layer's live brightness (null until the layer is built — it only exists where
    // the nebula is baked). `amp` + `setBackdropAmp` are what let 43-expensive-look measure the layer
    // DIFFERENTIALLY on a frozen scene: the same frame with the layer off and on, which is the only honest
    // way to prove a backdrop is actually contributing light.
    get backdrop() { return { amp: backdropAmp() }; },
    setBackdropAmp,
    get levelName() { return CATALOG.levelName; },     // the SEED NAME (level-N) this tab resolved at boot
    get combatElapsed() { return world.combatElapsed; }, // THE sim clock the director and the spawn floors share
    get enemyCount() { return enemies.length; },         // cheaper than enemies.length for a waitForFunction
    get gameStarted() { return G.gameStarted; },         // "is a fight running at all" (the runner's boot gate)
    setPaused,                                           // freeze the LIVE accumulator so stepSim is the only driver
    // Reads through `introArmed()`, so a test sees the director go away the instant its level does
    // (the win path advances the level in page, with no reload).
    get intro() { return introArmed() ? { fired: intro.fired, help: intro.help, view: intro.view } : null; },
    // The suite boots into level-0 for every scenario, so the director's line/card would sit in the bottom
    // band of every screenshot and every rect measurement, and #skip-intro would widen the settings modal
    // that 14-reset-progress measures. Only 44-playable-intro is testing the director; everyone else asks
    // for the arena. THE SIMULATION IS NOT TOUCHED — the spawn floors still apply, because the suite must
    // fight the same level-0 production does. This silences the DOM half only.
    silenceIntro() { intro = null; G.skipIntro = null; updateIntro(); },
    get needsSceneWarm() { return G.needsSceneWarm; }, // diagnostic: a level build is waiting to be compiled/uploaded
    get pendingAssets() { return G.pendingAssets; }, // diagnostic: essential .glb loads still in flight (veil gate)
    smokePool, // diagnostic: the instanced rocket-trail pool (live count + per-instance alphas)
    drops, // the live loot-drop array (count/positions assertable in headless)
    get speedFieldLayers() { return speedFieldLayers(); }, // diagnostic: the wrapping backdrop layers (31-speed-field)
    // Stress hook: spawn a metal-box drop near the player carrying a random real item. Measure on a phone
    // with `?dev` — start a fight, run `for (let i=0;i<40;i++) __game.spawnTestDrop()`, watch the perf FPS.
    spawnTestDrop(item) {
      const p = G.player; if (!p) return null;
      const items = [{ kind: 'component', refId: 6 }, { kind: 'component', refId: 9 }, { kind: 'weapon', refId: 9 }, { kind: 'weapon', refId: 4 }];
      const chosen = item || items[(Math.random() * items.length) | 0]; // optional explicit item → deterministic (tests)
      const pos = p.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30));
      spawnDrop(pos, chosen);
      return chosen;
    },
    pickLoot, // expose for tests (loot-pool selection off an enemy)
    audio, // procedural audio engine (settings + scene); SFX/music are inaudible in headless but state is assertable
    warpPlayerToCenter, arenaBorder, ARENA, OOB_WARN_DELAY, OOB_RETURN_TIME,
    setPieces, arenaCenter, // mission set-pieces + the (drifting) arena center
    setArenaDrift(x, z) { world.arenaDrift = { x, z }; }, // test/tool: enable a drifting zone
    get activeMission() { return G.activeMission; }, // the side mission being played (null = campaign)
    get missionZone() { return G.missionZone; },     // diagnostic: the armed fly-into-it zone + its live countdown
    get missionOffers() { return missionOffers; },
    get activeMissionId() { return activeMissionId; }, // the persisted active mission id (null = campaign) — Slice B board
    // the granted-item showcase (work zone): the glb url shown, or null when the showcase is hidden
    get itemShowcaseTarget() { const d = document.getElementById('mw-mission-desc'); return d && d.classList.contains('show-item') ? (mwItem && mwItem.url) : null; },
    // the glb url in the shop/loadout item detail panel (#shop-model), or null when nothing is shown
    get shopItemTarget() { const v = shopItemViewer(); return (v && v.url) || null; },
    // whether that glb has finished LOADING (the url is set synchronously, the model arrives later) — a
    // scenario must gate on this before asserting anything about the mixer, or it just races the fetch
    get shopItemLoaded() { const v = shopItemViewer(); return !!(v && v.group.children.length); },
    // the animation clock of that item's glb (seconds), or null if the model carries no clip — a scenario
    // asserts it ADVANCES to prove the flame is actually playing and not frozen in its bind pose
    get shopItemClipTime() { const v = shopItemViewer(); return v && v.mixer ? v.mixer.time : null; },
    get briefingStaged() { return stagedActive; },   // Main Window staged reveal animating (L2/L3)
    get welcomeStaged() { return welcomeStaged; },   // welcome-screen staged reveal animating (L1)

    launchMission, refreshMissions, showMain, // test/tool: drive the side-mission board + the Main Window
    get mainBriefing() { return mainBriefing; }, // the campaign (primary) briefing currently shown
    get oobWarnVisible() { return el.oobWarn.style.display === 'block'; },
    get player() { return G.player; },   // built asynchronously in bootstrap()
    get activeShip() { return G.activeShip; }, // the active-ship record incl. `progression` (level/xp/skills)
    get catalog() { return CATALOG; }, // ships/weapons/level loaded from the DB
    get earned() { return G.earned; },   // credits earned this run
    get balance() { return G.balance; }, // persistent account balance
    get kills() { return G.kills; },
    get touchAim() { return touchAim; }, // touch steering state (active/heading/thrust) — assert tap-vs-drag in headless
    sessionRec: () => ({ active: sr.active, final: sr.final, ticks: sr.tickCount, runs: sr.runs.length, level: sr.level }), // always-on live-recorder state (funnel-analytics guard)
    // Regression seam for the intro→Level-1 dead-controls bug (docs/plans/2026-08-03-1246-record-all-sessions.md).
    // Fires the production intro-END sequence directly — the same skipIntro() the Settings row calls
    // (finishIntro: async → teardown → menu) — and then leaves rs.done=true exactly as the accumulator caller
    // does. A scenario then Takes off into live Level 1 and proves the accumulator still steps (Fix A) and the
    // session is recorded (Fix B).
    simulateIntroEnd() { skipIntro(); rs.done = true; return { playDone: rs.done, playActive: !!rs.play }; },
    // --- star-system roam / navigation hooks (32-star-system scenario) ---
    enterRoam, engagePointAutopilot,
    engageAutopilot,                                // what a click on the home station does
    cancelAutopilot,                                // roam nav buttons cancel their own autopilot
    get roamMission() { return G.roamMission; },     // { pos, missionId } | null — the roam HUD's mission target
    set roamMission(v) { G.roamMission = v; },
    updateRoamNav, updateMissionMarker,              // drive the roam HUD deterministically in headless tests
    get baseStation() { return G.baseStation; },    // { obj, active } — `active` = clickable right now
    set onBaseArrival(fn) { G.onBaseArrival = fn; }, // stands in for the "Dock at the station?" prompt
    // Deterministic sim stepping for headless roam tests (software-GL rAF is too slow to advance the live
    // accumulator meaningfully in a few seconds). Steps update(dt) N times at the fixed sim step — same
    // fixed dt the live loop uses, so it exercises the real per-tick sim (autopilot, cap, arrival).
    stepSim(n = 1) { for (let i = 0; i < n; i++) { update(BENCH_DT); introTick(); } },
    openSystemMap: openSystemMapScreen, closeSystemMap,
    // Re-place the camera + the whole sky backdrop for the CURRENT player position without stepping the sim
    // — lets 32-star-system teleport the ship and read the backdrop's response directly.
    settleView,
    systemAnchor: planetAnchor, // the point ON THE PLANE a body is reached at (32-star-system flies to one)
    updateTakeoffGate,          // re-apply the launch gate after a test flips activeShip.launchable
    // Rebuild the scene from the live descriptor WITHOUT running a frame — 32-star-system uses this to pin
    // that buildMap alone places the backdrop (the hangar renders while the sim is not ticking).
    rebuildMap() { buildMap(G.currentMapDescriptor); },
    // Camera zoom, for the zoom-out dimming guard: setZoom sets the target, tickZoom(dt) eases + re-anchors
    // the fog to the ship (engine.js applyZoom).
    zoom: { set: setZoom, tick: tickZoom },
    get roam() { return G.roam; },
    set roam(v) { G.roam = v; },
    get mapOpen() { return G.mapOpen; },
    get systemBodies() { return G.systemBodies; }, // [{ mesh, name, spec, dir, moons }] star + 4 planets + moons
    get autopilot() { return G.autopilot; },       // { active, phase, target } — assert point-nav in headless
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
    for (const e of enemies) { mix(e.pos.x); mix(e.pos.z); }
    if (G.player) { mix(G.player.pos.x); mix(G.player.pos.z); mix(G.player.heading); }
    mix(enemies.length);
    return h >>> 0;
  };
  // One full frame's work, reusing animate()'s exact call sequence (minus tickZoom / dock+grab raycasts /
  // updatePerf — none feed the sim; dropped consistently on A and B, see plan Component 3 step 2).
  const fullFrame = (dt) => {
    const t0 = performance.now();
    update(dt);
    const t1 = performance.now();
    updateHud(); updateMarkers(); updateDropMarkers(); updateMissionMarker(); updateCreditPopups();
    updateEnemyHealthBars(); updateOobWarning(); updateReturnHint(); updateRoamNav(); updateMiniMap();
    const t2 = performance.now();
    // The SAME four lines animate() draws — the bench must measure the real frame, and there is no shared
    // entry point to route it through: the frame is these two passes, straight to the canvas.
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
      seedSim(trace.seed);
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
      seedSim(BENCH_SEED);                       // deterministic
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
        if (G.player) rec(0, G.player.pos.x, G.player.pos.z, G.player.heading); else rec(0, last[0].x, last[0].z, last[0].yaw);
        for (let s = 1; s < ships.length; s++) { const e = cast[s - 1];
          if (enemies.includes(e)) rec(s, e.pos.x, e.pos.z, e.heading);
          else { if (ships[s].death < 0) ships[s].death = kf; rec(s, last[s].x, last[s].z, last[s].yaw); } }
        let bc = 0; for (const b of bullets) { if (bc >= MAX_GHOST_BULLETS) break; bul.x.push(b.pos.x); bul.z.push(b.pos.z); bc++; } bul.counts.push(bc);
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
// Every path goes through hydrateTrace, so callers always get a trace with a flat `.ticks` array whether the
// stored shape is v1 (flat) or v2 (run-length packed).
async function loadTrace(id) {
  const key = id || 'last';
  try { const s = localStorage.getItem(`replay:${key}`); if (s) return hydrateTrace(JSON.parse(s)); } catch {}
  if (id) {
    try { const r = await fetch(`/recordings/${id}.json`); if (r.ok) return hydrateTrace(await r.json()); } catch {}
    // Admin playback of a recorded session (/?playback&id=<sessionId>): resolve the trace from the server.
    try { const r = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(id)}/trace`); if (r.ok) return hydrateTrace(await r.json()); } catch {}
  }
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
// Seed BEFORE reset() (reset() draws the sim RNG for spawn timing) so the whole run is reproducible from
// (seed + input). animate()'s accumulator then captures one tick per fixed step while the operator flies.
function beginRecordCapture() {
  if (recCapturing) return;
  recSeed = (Date.now() >>> 0);                 // the one wall-clock touch — captured into the trace (determinism preserved)
  seedSim(recSeed);                              // install the sim's seeded stream (gameplay draws only)
  recShipId = (CATALOG.shipByName.get(G.currentShipName) || {}).id ?? 1;
  // Capture the loadout/components actually used, so the trace reproduces this exact ship independent of the
  // account later. Only when the built ship IS the active ship (else the bootstrap used the ship's defaults →
  // leave null so playback falls back to catalog defaults too).
  const activeMatches = G.activeShip && G.activeShip.ship && G.activeShip.ship.name === G.currentShipName;
  recLoadout = activeMatches ? G.activeShip.loadout : null;
  recComponents = activeMatches ? G.activeShip.components : null;
  G.gameStarted = true;
  replayAcc = 0;
  reset();                                        // position the player + start REC.level from tick 0 (seeded)
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
  showRecordDone(id, traceTickCount(trace));   // v2 traces carry packed runs, not a flat ticks array
  // The DEV ?record session clears its own seed on stop (it hands the operator back an unseeded menu). Normal
  // live play is now ALWAYS seeded per session (always-on recording): beginLiveSession reseeds before each
  // reset(), and a stale seed lingering on the post-win/death menu is harmless (menu cosmetics use Math.random).
  seedSim(null);
}

// Begin a real, recorded live session. Called by the launch/retry flows JUST BEFORE their reset() (reset()
// draws the sim RNG for spawn timing, so the seed must be installed first — same ordering as
// beginRecordCapture). No-op under ?record/?playback/?bench: those own the seed/loop, and a (re)played
// fight must never be re-recorded. The LEVEL-0 INTRO is recorded like every other campaign level.
export function beginLiveSession() {
  if (REC || rs.play || BENCH || G.replayMode) return;
  // A session that is still open here was ABANDONED (left mid-fight, then another level launched) — win/death
  // already closed theirs. Ship it before begin() throws the ticks away, or that drop-off never leaves a row.
  // Runs before reset(), which is what re-stamps G.gameStartTime, so the duration is still the OLD session's.
  flushSession('quit');
  const seed = (Date.now() >>> 0);
  seedSim(seed); // install the seeded gameplay stream for THIS session
  const shipId = (CATALOG.shipByName.get(G.currentShipName) || {}).id ?? 1;
  const activeMatches = G.activeShip && G.activeShip.ship && G.activeShip.ship.name === G.currentShipName;
  sr.begin({
    seed, level: CATALOG.levelName || 'level-0', shipId,   // the SEED NAME (level-N), stashed at each CATALOG.level set (C2a)
    // The allocation this run is actually being played with — the ship the replay has to rebuild.
    skills: (activeMatches && G.activeShip.progression) ? G.activeShip.progression.skills : null,
    loadout: activeMatches ? G.activeShip.loadout : null,
    components: activeMatches ? G.activeShip.components : null,
    dt: BENCH_DT,
  });
  replayAcc = 0;
}

// Upload the current live recording. Reads live duration/kills at flush time. Below-floor / already-closed
// sessions send nothing (sr.flush returns null).
//   final:true  (win/death) — closes the session; nothing is ever sent for it again.
//   final:false (tab hidden / unload) — provisional: the same session id may be re-sent later with more
//                                       ticks and a real outcome, and the server upserts that one row.
// `beacon` is the unload-only transport (sendBeacon, ~64KB body cap); every other path uses a plain fetch.
export function flushSession(outcome, { beacon = false, final = true } = {}) {
  const payload = sr.flush(outcome, {
    durationMs: Math.round(performance.now() - G.gameStartTime),
    kills: G.kills,
  }, { final });
  if (payload) postSession(payload, { beacon });
}
G.flushSession = flushSession; // exposed on the shared bag so sim.js can flush on win/death without a main.js import cycle
// Same trick, same reason: the victory path lives in sim.js and has to RELEASE THE ROOM when a mission ends
// (DECISIONS §132). There is nothing left for a server-run fight to simulate once the player has closed the
// mission, and leaving it stepping means a room flying a ship nobody is playing. The menu reconnects for the
// next run on its own (see the connect gate in animate()).
G.dropNetsim = () => { if (netLink) dropNetsim(); };

// Start the PLAYBACK session from an already-loaded, validated trace: re-seed, rebuild the recorded ship,
// launch the recorded level. animate() then steps the trace one tick per frame (see the rs.play block there).
function startPlaybackSession(trace) {
  rs.trace = trace; rs.index = 0; rs.done = false;
  // Rebuild the recorded ship BEFORE seeding — record built the player during bootstrap (pre-seed), so any
  // sim-RNG draw inside buildPlayerFor must NOT come out of the seeded stream, or the sim RNG offsets and the
  // whole replay diverges. Install the seed only after, so reset()+the fight draw from an identical stream.
  const shipDef = trace.shipId != null ? shipByIdGlobal(trace.shipId) : null;
  if (shipDef) {
    // Force the recorded ship+loadout+SKILLS (NEVER the current account's) so a replay is faithful
    // regardless of what the player has equipped or spent now. Old traces (no captured loadout/skills) fall
    // back to the ship's catalog defaults and no skills — correct for the intro, which was recorded on the
    // fresh starter loadout by a player with nothing spent. Uses native RNG (cosmetic).
    //
    // Skills are NOT cosmetic here: they change engine power, weapon damage, shield capacity and — through
    // Maneuver's dodge — whether the hostile-hit roll draws from the seeded stream at all. Replaying a
    // skilled player's run on a skill-less ship was why admin session playback looked like the pilot was
    // fighting ghosts (see the v4 note in replay.js).
    buildPlayerFor(shipDef, {
      loadout: trace.loadout || { mounts: shipDef.stats.mounts },
      components: trace.components || shipDef.components,
      skills: trace.skills || null,
    });
  }
  seedSim(trace.seed);                           // install the sim's seeded stream (gameplay draws only)
  document.body.classList.remove('menu');
  G.gameStarted = true;
  replayAcc = 0;
  reset();
  settleView(); // frame the camera + sky on the (reset) player NOW, so the first frame doesn't jump on play
  // `?playback&finish` — press "Finish and Return" for the pilot when the sector clears (a trace cannot
  // carry that mouse click), so a winning replay ends on the victory overlay instead of orbiting forever.
  rs.autoFinish = !!(rs.play && rs.play.finish);
  buildPlaybackUI(trace);
  // Hold on the idle frame until the real ship model has loaded, then start stepping the trace — so playback
  // opens on the real ship, not the placeholder. animate()'s accumulator only advances once rs.armed.
  watchModelsReady(() => { rs.armed = true; });
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
  if (!playHudEl || !rs.trace) return;
  const p = playHudEl.querySelector('#play-progress');
  if (p) p.textContent = `${Math.min(rs.index, rs.trace.ticks.length)} / ${rs.trace.ticks.length}${rs.done ? ' ✓' : ''}`;
}

// The intro was SKIPPED → advance the player 0→1 (server-authoritative, so the intro is one-time +
// cross-device) and land on the Level 1 Main Window briefing (shop stays gated until unlocked). Winning the
// intro does NOT come here: that is the ordinary campaign win path in `sim.js`, which advances by itself.
async function finishIntro() {
  if (!introMode) return;
  introMode = false;
  G.skipIntro = null;      // the Settings row must not survive the intro
  // Defensive no-ops on a LIVE intro (nothing is playing back any more), kept because the same three lines
  // are what put animate() back on the live path from any state that ever set rs.play / a seeded stream /
  // replayMode — and because a partial reset is exactly the bug that once left the post-intro controls dead.
  rs.teardown();
  seedSim(null); // clear the seeded stream too — live Level-1 play must run off the native RNG
  G.replayMode = false;
  clientLog('intro:finish', { before: CATALOG.level && CATALOG.level.title }); // TEMP debug
  try { await unlockNextLevel(); } catch (e) { console.error('[intro] advance failed', e); clientLog('intro:advanceThrew', { msg: String(e && e.message || e) }); }
  const land = (CATALOG.level && CATALOG.level.briefing) ? 'showMain' : 'showWelcome';
  clientLog('intro:land', { via: land, level: CATALOG.level && CATALOG.level.title, name: CATALOG.levelName }); // TEMP debug
  if (CATALOG.level && CATALOG.level.briefing) showMain(CATALOG.level.briefing);
  else showWelcome(getPlayerShips());
}

// Skip the whole intro: end it here and land on the Level-1 briefing (progress 0 → 1,
// server-authoritative). This is the SKIP path ONLY — winning the intro ends it the way every other level
// ends, through `sim.js`'s victory handler (`commitLevelAdvance` at "Finish and Return", then
// `loadAdvancedLevel()` on the dock), and never comes through here. Reached from the Settings modal, which
// has already paused the fight — so this can never be triggered by a stray tap while flying — and from the
// simulateIntroEnd() test seam.
//
// The only guard is `introMode`, deliberately NOT a `CATALOG.levelName === 'level-0'` check: the test seam
// runs on a shared throwaway player an earlier scenario may already have advanced past level-0, and a level
// check there would hang both scenarios waiting for a menu that never opens. Reachability is enforced where
// it belongs — the Settings row only exists while `G.skipIntro` is published, which happens only on the
// level-0 branch of bootstrap.
function skipIntro() {
  if (introMode) return;
  introMode = true;                 // finishIntro's own guard
  intro = null; G.skipIntro = null;
  el.introLine.style.display = 'none'; el.introHelp.style.display = 'none';
  flushSession('quit');             // the abandoned intro session still reaches the funnel
  G.gameStarted = false; G.roam = false;
  document.body.classList.add('menu');
  setPaused(false);
  finishIntro();                    // advance 0 → 1, then showMain(level-1 briefing)
}

// --- The intro director's runtime half: one call per SIM TICK, one per FRAME ---
// Nothing here can touch the simulation; the director only speaks. All of its timing comes off
// `world.combatElapsed` (sim ticks), never the wall clock — so a recorded intro session replays identically.

// THE DIRECTOR LIVES EXACTLY AS LONG AS THE SERVED DESCRIPTOR CARRIES ITS SCRIPT, and not one frame longer.
// Deriving that from `CATALOG.level` instead of latching a module flag is what stops it outliving its level
// BY CONSTRUCTION: the normal ending (clear → "Finish and Return" → dock) advances the campaign IN PAGE —
// `sim.js` win → `loadAdvancedLevel()` swaps `CATALOG.level` with no reload — so a sticky `intro` survived
// into Level 1, re-armed itself on that level's `reset()` (the clock going backwards is the restart signal),
// replayed the whole script over it and left the Settings "Skip the intro" row live, where it would have
// granted a free level advance. Checked from both
// halves (the sim tick and the render frame), because either may run first in a frame.
function introArmed() {
  if (intro && !(CATALOG.level && CATALOG.level.intro)) { intro = null; G.skipIntro = null; }
  return !!intro;
}
function introTick() {
  if (!introArmed()) return;
  for (const cmd of intro.tick({ t: world.combatElapsed, kills: G.kills,
                                 alive: enemies.length, cleared: levelRunner.cleared })) {
    if (cmd === 'help:hold') showIntroHelp();
    else if (cmd === 'help:fly') flyIntroHelp();
    else if (cmd === 'help:done') { el.introHelp.style.display = 'none'; }
  }
}
// Once per FRAME: push the director's view into the DOM. Cheap and idempotent. `body.intro` is a state hook
// for "a director is armed" — no CSS hangs off it any more (it used to hide the kill log, back when the line
// sat in the bottom band with it), but it is what a test reads to see the director come and go.
function updateIntro() {
  const armed = introArmed();
  document.body.classList.toggle('intro', armed);
  if (!armed) {
    // No director (every other level, and the moment Skip / silenceIntro ends this one): make sure BOTH
    // nodes are gone and the card is back in its pre-flight state, so a later run starts clean.
    if (el.introLine.style.display !== 'none') el.introLine.style.display = 'none';
    if (el.introHelp.style.display !== 'none') {
      el.introHelp.style.display = 'none';
      el.introHelp.classList.remove('fly'); el.introHelp.style.transform = 'translateX(-50%)';
      introHelpFlown = false;
    }
    return;
  }
  const v = intro.view;
  // The controls card belongs to the 'hold' and 'fly' states only. A death-Restart drops the director
  // straight back to 'idle' WITHOUT emitting a command (`reset()` only re-arms state), so nothing else
  // would take a mid-flight card down — it sat stacked on the re-armed opening line, both illegible.
  if (v.help === 'idle' && el.introHelp.style.display !== 'none') {
    el.introHelp.style.display = 'none';
    el.introHelp.classList.remove('fly'); el.introHelp.style.transform = 'translateX(-50%)';
    introHelpFlown = false;
  }
  if (!v.lineKey) { el.introLine.style.display = 'none'; return; }
  if (el.introLine.getAttribute('data-i18n') !== v.lineKey) {
    el.introLine.setAttribute('data-i18n', v.lineKey);       // so a live EN/RU switch re-localizes it in place
    el.introLine.textContent = t(v.lineKey);
  }
  el.introLine.style.display = 'block';
  el.introLine.style.opacity = String(v.lineAlpha);
}
// The controls card takes the line's slot the moment the opening line has gone.
function showIntroHelp() {
  introHelpFlown = false;
  el.introHelp.classList.remove('fly');
  el.introHelp.style.transition = 'none';
  el.introHelp.style.transform = 'translateX(-50%)';   // the base state the rects below are measured in
  const key = Device.input === 'touch' ? 'ui.help_touch' : 'ui.help';
  el.introHelp.innerHTML = t(key);
  el.introHelp.setAttribute('data-i18n', key);         // a live EN/RU switch re-localizes the card in place
  el.introHelp.style.display = 'block';
  el.introHelp.style.opacity = '1';
}
// The card flies into #help — the animation IS the lesson: "this is where the controls live from now on".
// Screen-space by construction (two getBoundingClientRect calls), so no camera reasoning is involved.
//
// TWO THINGS HERE ARE LOAD-BEARING AND EASY TO GET WRONG:
//  1. The `-50%` centring must stay INSIDE the composed transform. getBoundingClientRect() reports the card
//     where it is ALREADY DRAWN, i.e. with translateX(-50%) applied, so a bare `translate(dx, dy)` drops the
//     centring and the card jumps right by half its width the instant the flight starts.
//  2. Opacity is driven from JS, not from the `.fly` class: showIntroHelp sets an inline `opacity: 1`, which
//     beats any class rule — an `opacity: 0` inside `.fly` would never apply and the card would land on
//     #help at full opacity and sit there.
// Both are negatively tested by visual/scenarios/44-playable-intro.mjs.
function flyIntroHelp() {
  if (introHelpFlown) return;
  introHelpFlown = true;
  const a = el.introHelp.getBoundingClientRect(), b = el.help.getBoundingClientRect();
  const s = Math.max(0.25, b.width / Math.max(1, a.width));
  const dx = b.left - a.left, dy = b.top - a.top;
  el.introHelp.style.transition = '';                  // hand the transition back to the .fly class rule
  el.introHelp.classList.add('fly');
  // KEEP the -50%: `a` was measured WITH it applied, so dx/dy are a delta on top of the centred position.
  // transform-origin is left top (styles.css), so the scale shrinks the card onto the corner it just landed on.
  el.introHelp.style.transform = `translate(calc(-50% + ${dx}px), ${dy}px) scale(${s})`;
  el.introHelp.style.opacity = '0';                    // inline, so it actually wins (see note 2 above)
}

// Console / automation hook (only under the dev replay flags). Lets the maintainer stop from the console and
// lets an automated smoke check compare a deterministic state hash between record and playback (same seed +
// same input ⇒ same hash at the same tick — the determinism guarantee input-replay stands on).
if (REC || rs.play) {
  const stateHash = () => {
    let h = 2166136261 >>> 0;
    const mix = (n) => { h = Math.imul(h ^ (Math.round(n * 100) | 0), 16777619) >>> 0; };
    for (const e of enemies) { mix(e.pos.x); mix(e.pos.z); }
    if (G.player) { mix(G.player.pos.x); mix(G.player.pos.z); mix(G.player.heading); }
    mix(enemies.length);
    return h >>> 0;
  };
  window.__replay = {
    mode: REC ? 'record' : 'playback',
    begin: () => beginRecordCapture(),  // record: seed + reset + start capturing (what the Start button does)
    stop: () => stopRecordSession(),
    hash: stateHash,
    // The browser half of the browser↔Node divergence oracle (sim-core/digest.js): the whole World reduced
    // to one number, plus how many seeded RNG draws this run consumed. server/tools/sim-replay.mjs computes
    // the same thing headlessly from the same trace, and 36-sim-divergence asserts the two agree.
    digest: () => worldDigest(world),
    // `armed` is the models-ready gate: the ship .glb sets mesh.userData.noseZ/tailZ (where bullets spawn), so
    // stepping before it resolves changes the sim — automated stepping MUST wait on it.
    status: () => ({ recording: recCapturing, armed: rs.armed, ticks: recTicks.length, playIndex: rs.index, playDone: rs.done, total: rs.trace ? rs.trace.ticks.length : 0 }),
    // The ?playback&finish lifecycle (for tests / console): has the sector cleared into a flight home, and
    // did that flight end in a win. 22-trace-replay's terminal-state check reads this.
    play: () => ({ returning: rs.returning, done: rs.done, won: levelRunner.won }),
    state: { G, enemies, rockets, camera, camOffset }, // live sim refs (dev-flag only) — for forcing events + framing checks
    // Synchronous sim stepping WITHOUT the render/rAF — for automated determinism checks and console use (a
    // background tab throttles rAF to ~0, so live ticks stall). It no longer *mirrors* animate()'s sim block:
    // it runs the very same per-tick body (replay.js stepReplayTick), so the two drivers cannot drift apart.
    // Uses whatever input is currently held (none under automation → a deterministic no-input run). The one
    // deliberate difference from the accumulator is the `capture` callback: there is no live session under
    // ?record/?playback, so this hook feeds recTicks only (never sr.captureTick) — which is exactly why
    // capture is caller-supplied.
    step(n = 1) {
      if (!isSimSeeded()) return this.status(); // record: not started yet (call begin() first); playback seeds on arm
      const tickDeps = {
        rs, keys, touchAim, dt: BENCH_DT, update,
        capture: () => { if (recCapturing) recTicks.push(snapshotInput(keys, touchAim)); },
        onTick: introTick,
        isCleared: () => G.returnToBase && !levelRunner.won,
        isWon: () => levelRunner.won,
        finish: finishMission,
      };
      for (let i = 0; i < n; i++) if (stepReplayTick(tickDeps) === 'stop') break;
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
  if (BENCH) seedSim(BENCH_SEED); // deterministic sim RNG for record/replay (replay() re-seeds per trace)
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
    // level-0 if the player isn't identified (e.g. localStorage blocked).
    // ?playback: load the recorded trace up front so the recorded LEVEL drives the level fetch below.
    if (rs.play) {
      rs.trace = await loadTrace(rs.play.id);
      const problems = rs.trace ? validateTrace(rs.trace) : [`no recording found for id "${rs.play.id || 'last'}"`];
      if (problems.length) {
        console.error('[playback] invalid/missing trace:', problems);
        document.body.innerHTML = `<pre style="color:#ff6b6b;font:14px/1.5 monospace;padding:24px">Playback failed:\n- ${problems.join('\n- ')}</pre>`;
        return;
      }
    }
    // ?record forces the requested level; ?playback uses the recorded level; `?ally&level=N` and
    // `?lancer&level=N` force one too (same `level` param, same normalization — a dev test flight must not
    // depend on campaign progress, and Level 3 and Level 4 have identical phase NAMES, so aiming at one and
    // landing on the other was invisible from the URL). Otherwise the player's progress level.
    const devLevel = allyDevLevel() || lancerDevLevel() || duelDevLevel();
    const levelUrl = REC ? `/api/levels/${REC.level}`
      : rs.play ? `/api/levels/${traceLevelName(rs.trace)}`  // pre-v3 traces name the pre-renumbering level
      : devLevel ? `/api/levels/${devLevel}`
      : G.playerId ? `/api/players/${G.playerId}/level` : '/api/levels/level-0';
    const [weapons, components, ships, level, sounds] = await Promise.all([
      fetchJson('/api/weapons'), fetchJson('/api/components'),
      fetchJson('/api/ships'), fetchJson(levelUrl), fetchJson('/api/sounds').catch(() => ({ sounds: [], map: [] })),
    ]);
    // Sound catalog → preload registry + the routing map (sfxFor/tracksFor). A failed fetch ⇒ all-synth/silent.
    soundUrls = Object.fromEntries((sounds.sounds || []).map((s) => [s.key, s.url]));
    audio.setSampleGains(Object.fromEntries((sounds.sounds || []).map((s) => [s.key, s.gain ?? 1]))); // per-sound playback gain (DB sounds.gain)
    for (const m of (sounds.map || [])) { const k = `${m.entity}|${m.class}|${m.event}`; (soundMap.get(k) || soundMap.set(k, []).get(k)).push(m.sound); }
    audio.setMusicTracks({ hangar: tracksFor('scene', 'hangar', 'music'), combat: tracksFor('scene', 'combat', 'music') }); // looping bg music per scene
    // Load the samples as soon as we know their URLs — NOT only when a gesture already happened. Decoding
    // needs an AudioContext but not a RUNNING one (preloadSamples calls ensure(), and a suspended ctx
    // decodes fine), so gating this on a gesture bought nothing and cost us every sound on any page that
    // starts playing without one. That is exactly `?playback`: it is reached by NAVIGATION from the record
    // page's "Play it ▶" link, so no gesture ever lands on it, the replay auto-starts, and every shot fell
    // back to its synth voice. Idempotent (already-decoded names are skipped), so the gesture handler
    // re-calling it is free.
    samplesLoaded = true;
    audio.preloadSamples(soundUrls);
    // Weapons are flattened (stats spread to top level); keep the model URLs too (the `...w.stats` spread
    // also lifts `stats.model` to a top-level `model` key — read by itemModelCfg). Components are stored
    // whole, so their `modelUrlHigh` + nested `stats.model` flow through as-is.
    for (const w of weapons) CATALOG.weapons.set(w.id, { id: w.id, name: w.name, type: w.type, price: w.price, modelUrl: w.modelUrl, modelUrlHigh: w.modelUrlHigh, rarity: w.rarity, color: w.color, ...w.stats });
    for (const c of components) CATALOG.components.set(c.id, c);
    CATALOG.enemyShips = ships.filter((s) => s.type === 'enemy');
    for (const s of ships) CATALOG.shipByName.set(s.name, s);
    // ?ally / ?lancer / ?duel (dev): inject the wingman's arrival phase, swap a phase's pool for pirate
    // lancers, and/or replace the whole script with the sparring room. Each is a strict no-op with its own
    // flag off (the same object back out); `?duel` runs last because it discards what the others wrote.
    CATALOG.level = applyDuelDev(applyLancerDev(applyAllyDev(level.descriptor)));   // ?duel is LAST: it replaces the phase script the other two edit
    CATALOG.levelName = level.name; // the SEED NAME (level-N) — the trace level for session recording

    const map = await fetchJson(`/api/maps/${level.descriptor.map}`); // the level chooses its map
    buildMap(map.descriptor); // build the scene backdrop: star + 4 planets, stars, speed-field, sky light

    // the player's active ship (auto-registers) decides the default selection
    let active = null;
    if (G.playerId) active = await fetchJson(`/api/players/${G.playerId}/active-ship`).catch(() => null);
    G.activeShip = active; // drives the persisted loadout in buildPlayerFor (weapon swaps, etc.)
    primeShopItemsSeen();  // first sight on this device = the baseline, so already-unlocked gear isn't "(new)"
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
    camera.position.copy(G.player.pos).add(camOffset);
    camera.lookAt(G.player.pos.x, G.player.pos.y, G.player.pos.z); // components — see settleView in sim.js
    // #help has always rendered the KEYBOARD cheatsheet, on phones too (styles.css carries no body.touch
    // rule for it) — visible nonsense on a device with no keys, and glaring now that the intro's controls
    // card flies into it. Device.input is constant per session, so swapping the key once here is enough.
    if (Device.input === 'touch') el.help.setAttribute('data-i18n', 'ui.help_touch');
    applyTranslations(); // localize all static [data-i18n] chrome for the active language
    // The intro ("Level 0", seed name 'level-0', served only while current_progress === 0) has NO menu
    // gate: drop the new player straight into the fight — ship visible + controllable at once, no welcome
    // screen, no Take-off. Everything else lands as before (Level 1 → welcome, level 2+ → Main Window
    // briefing). The default player ship was already built above (buildPlayerFor), so we just start the sim.
    if (ROAM) {
      // ?roam dev sandbox: drop straight into the flyable star system (no menu, no level). Same G.roam
      // state the real base-menu Map path (enterRoam) lands in — the player spawns at planet 2 with NO
      // enemies (the !G.roam guard in reset() skips levelRunner). For live-tuning sizing / speed-field / feel.
      document.body.classList.remove('menu');
      G.gameStarted = true; G.roam = true;
      reset();
      buildRoamReadout();
    } else if (REC) {
      enterRecordMode(); // idle on the real ship; "Start recording" begins capture from tick 0
    } else if (rs.play) {
      startPlaybackSession(rs.trace); // re-run the recorded fight on the real engine
    } else if (level.name === 'level-0') {
      // THE INTRO IS A FIGHT YOU FLY. The server serves the level-0 descriptor only while
      // current_progress === 0 (a new or freshly reset player), so `level.name` is the whole one-time gate —
      // no localStorage flag, so a genuine progress reset replays it (DECISIONS §63's rule survives its
      // cutscene). It is an ordinary campaign level from here: recorded like any other session, advancing
      // through the normal win path, with the scripted director talking over it.
      if (CATALOG.level.intro) { intro = makeIntroDirector(CATALOG.level.intro); G.skipIntro = skipIntro; }
      document.body.classList.remove('menu');
      G.gameStarted = true;
      beginLiveSession(); // arm the always-on recorder + seed the sim BEFORE reset() draws the spawn RNG
      reset();
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
    // Skipped on touch: the right-docked lil-gui panels (colors here, backdrop/record below) are
    // mouse-only tools that just clutter a phone/tablet screen — never build them there.
    if (location.search.includes('tune') && Device.input !== 'touch') {
      const { default: GUI } = await import('three/addons/libs/lil-gui.module.min.js');
      buildTunePanel(GUI);
    }
    // ?dev "Backdrop authoring" panel: Start/Stop-record controls + a REC readout + live Depth/Scale/Opacity
    // sliders for the freighter ghost battle. Dynamic imports → zero cost (no lil-gui fetch) when ?dev is off.
    // Also skipped on touch (see the tune panel above) — the perf overlay still shows under ?dev, just not this.
    if (isDev() && Device.input !== 'touch') {
      const { default: GUI } = await import('three/addons/libs/lil-gui.module.min.js');
      const { buildBackdropPanel } = await import('./ghost-battle.js');
      buildBackdropPanel(GUI);
      // Exhaust tuning panel: GLOBAL points/flame toggle + freighter-only palette/shape sliders + Copy JSON.
      const { buildExhaustPanel } = await import('./exhaust-fx.js');
      buildExhaustPanel(GUI);
      // Hit-feel panel: hull flash / model punch / camera shudder / tracer variation + Copy JSON.
      const { buildHitFxPanel } = await import('./hit-fx.js');
      buildHitFxPanel(GUI);
    }
  } catch (err) {
    console.error('Failed to load the game from the API:', err);
  }
}
bootstrap();
