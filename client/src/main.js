// Composition root for the client (loaded by index.html via `import './src/main.js'`).
// This is the rest of the former inline <script type="module"> — bootstrap/animate/window.__game plus
// the Main Window / shop / welcome / account / settings UI. It imports the extracted modules (sibling
// paths, no `src/` segment) and `three` via the index.html importmap. Slices are peeling cohesive UI
// modules out of here next; for now it is the single composition root.
import * as THREE from 'three';
import { loadLanguage, resolveLanguage, getLanguage, SUPPORTED, DEFAULT_LANG } from './i18n.js'; // language load/resolve for bootstrap
import { audio, tracksFor } from './sound-routing.js'; // audio engine + DB-driven music routing (bootstrap)
import { G, bullets, explosions, sparks, shockwaves, trail, rockets, smoke, enemies, setPieces, soundMap, CATALOG, keys, touchAim } from './state.js'; // shared state bag + entity collections + catalog + input
import { scene, skyScene, camera, renderer, camOffset, isTouch, toGame, applyOrientation, zoomBy, tickZoom } from './engine.js'; // engine singletons + orientation + zoom
import { ARENA, OOB_WARN_DELAY, OOB_RETURN_TIME, arenaCenter, arenaBorder, buildMap } from './world.js'; // arena + sky/planet/setpieces + buildMap
import { spawnShipExplosion, emitExhaust, liveParticles, bulletGeo, explosionGeo } from './projectiles.js'; // FX exposed to __game + geos reused by prewarmShaders
import { buildPlayerFor, spawnEnemyShip, spawnEnemy } from './ship-build.js'; // build the player (bootstrap) + enemy spawns exposed to __game
import { el } from './dom.js'; // single fail-loud inventory of shared index.html nodes
import { updateHud, updateMarkers, updateMiniMap, updatePerf } from './hud.js'; // per-frame HUD draws (readouts/markers/radar/perf)
import { fetchJson, track, currentLevelLabel } from './net.js'; // JSON fetch (bootstrap) + funnel telemetry (community/pagehide listeners)
import { update, levelRunner, refreshMusic, warpPlayerToCenter, updateOobWarning, setPaused, togglePause, autoPauseOnBlur, reset } from './sim.js'; // the simulation loop + level runner + music + pause + restart
import { buildTunePanel } from './tune.js'; // dev-only ?tune palette panel (lil-gui injected by bootstrap)
import { showMain, launchMission, refreshMissions, missionOffers, mainBriefing, mwPreview, mwItem } from './mainwindow.js'; // between-battles Main Window + model viewers
import { showWelcome, applyTranslations } from './welcome.js'; // welcome screen + i18n UI glue
import { initSentry, restoreSession, setPlayerShipsCache } from './account.js'; // auth block (bootstrap session restore + Sentry)

// audio engine + tracksFor/sfxFor routing moved to src/sound-routing.js (imported at top).
let samplesLoaded = false; // one-time guard so the sample preload fires once, after the context unlocks
// SFX + music routing is DB-driven (docs/plans/sound-classes-and-mapping.md): /api/sounds gives the
// registry (key→url) + the map ((entity,class,event)→[keys]), both filled in bootstrap(). No hardcoded routing.
let soundUrls = {};                 // logical key → same-origin url (fed to audio.preloadSamples)

// Graphics quality tier lives in G.gfx (built in state.js, read by engine.js at construction).
const DEV = location.search.includes('dev'); // ?dev → record per-frame perf samples to the server (see devPerf)

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
// (isTouch/gameW/gameH/toGame/applyOrientation, rotation flag on G.rotated) and the camera-zoom
// block (setZoom/zoomBy/tickZoom/camOffset) are imported from engine.js at the top.

// Fullscreen capability detection stays here (used by the floating ⛶ button + body classes below).
// iPhone Safari has no Fullscreen API (it exists only on iPad/Android), so the floating ⛶ button is a
// no-op there — the only true full screen on iPhone is the standalone web app from "Add to Home Screen"
// (we ship apple-mobile-web-app-capable). Detect both: no FS API → swap ⛶ for an A2HS hint; already
// launched standalone → no chrome to hide, so show neither. (See requestFullscreen + body.no-fs-api/.standalone.)
const FS_API = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
const STANDALONE = window.navigator.standalone === true ||
  !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

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
if (isTouch) {
  document.body.classList.add('touch'); // gates touch-only UI (e.g. the Full screen button)
  if (STANDALONE) document.body.classList.add('standalone');   // launched from Home Screen — no chrome to hide
  else if (!FS_API) document.body.classList.add('no-fs-api');  // iPhone Safari: ⛶ can't work → show the A2HS hint instead
  document.getElementById('touch').classList.add('on');
  document.getElementById('help').style.display = 'none'; // keyboard hints not needed

  const zone = document.getElementById('stick-zone');
  const base = document.getElementById('stick-base');
  const knob = document.getElementById('stick-knob');
  const fire = document.getElementById('fire-btn');
  const R = 60;          // stick radius
  const DEAD = 0.2;      // dead zone (fraction of radius) - below it no steering/thrust
  let stickId = null;    // id of the touch holding the stick
  let stickCx = 0, stickCy = 0;

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
    stickId = null;
    touchAim.active = false; touchAim.thrust = 0;
    base.style.display = knob.style.display = 'none';
  }

  zone.addEventListener('touchstart', e => {
    if (stickId !== null) return;
    const t = e.changedTouches[0];
    const p = toGame(t.clientX, t.clientY); // map viewport coords into (possibly rotated) game space
    stickId = t.identifier; stickCx = p.x; stickCy = p.y;
    showStick(stickCx, stickCy);
    moveKnob(stickCx, stickCy, p.x, p.y);
    e.preventDefault();
  }, { passive: false });
  zone.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { const p = toGame(t.clientX, t.clientY); moveKnob(stickCx, stickCy, p.x, p.y); e.preventDefault(); }
    }
  }, { passive: false });
  function endStick(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) clearStick();
    }
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

  // Pinch-to-zoom: two fingers over the open canvas area. Scoped to targetTouches so it never fights
  // the steering stick (the stick lives in its own #stick-zone element with its own listeners).
  let pinchDist = 0;
  const pinchD = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  renderer.domElement.addEventListener('touchstart', e => {
    if (e.targetTouches.length === 2) pinchDist = pinchD(e.targetTouches[0], e.targetTouches[1]);
  }, { passive: false });
  renderer.domElement.addEventListener('touchmove', e => {
    if (e.targetTouches.length === 2 && pinchDist > 0) {
      const d = pinchD(e.targetTouches[0], e.targetTouches[1]);
      if (d > 0) { zoomBy(pinchDist / d); pinchDist = d; } // fingers apart (d↑) => ratio<1 => zoom in
      e.preventDefault();
    }
  }, { passive: false });
  renderer.domElement.addEventListener('touchend', e => {
    if (e.targetTouches.length < 2) pinchDist = 0;
  }, { passive: false });
} else {
  // PC: the rocket circle is also clickable (besides the F key)
  const rocketBtn = document.getElementById('rocket-btn');
  rocketBtn.addEventListener('mousedown', () => { keys['_rocket'] = true; });
  addEventListener('mouseup', () => { keys['_rocket'] = false; });
}

// ---------- Zoom controls (both platforms): mouse wheel + on-screen +/- buttons ----------
const ZOOM_WHEEL = 1.12, ZOOM_BTN = 1.25;
renderer.domElement.addEventListener('wheel', e => {
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 1/ZOOM_WHEEL : ZOOM_WHEEL); // scroll up = zoom in (closer)
}, { passive: false });
document.getElementById('zoom-in').addEventListener('click',  () => zoomBy(1/ZOOM_BTN));
document.getElementById('zoom-out').addEventListener('click', () => zoomBy(ZOOM_BTN));

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
      if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/perf', new Blob([body], { type: 'application/json' }));
      else fetch('/api/perf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
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
        load: { enemies: enemies.length, particles: liveParticles(), draws: renderer.info.render.calls, tris: renderer.info.render.triangles },
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

function animate() {
  requestAnimationFrame(animate);
  const rawSec = clock.getDelta();        // true frame interval (unclamped) — for the perf metrics
  const dt = Math.min(rawSec, 0.05);      // clamped — for the sim only (stability on a long/background frame)
  const t0 = DEV ? performance.now() : 0;
  tickZoom(dt); // ease the camera zoom toward its target every frame (independent of the pause freeze)
  if (!G.paused) update(dt); // pause freezes the whole fight (enemies, bullets, cooldowns, repair, spawns)
  const t1 = DEV ? performance.now() : 0; // end of sim
  updateHud();
  updateMarkers();
  updateOobWarning(); // soft-boundary "left the battlefield" warning + countdown
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
    scene, enemies, bullets, rockets,
    explosions, sparks, shockwaves, trail, smoke,
    spawnEnemy, spawnEnemyShip, spawnShipExplosion, emitExhaust, reset, levelRunner,
    audio, // procedural audio engine (settings + scene); SFX/music are inaudible in headless but state is assertable
    warpPlayerToCenter, arenaBorder, ARENA, OOB_WARN_DELAY, OOB_RETURN_TIME,
    setPieces, arenaCenter, // mission set-pieces + the (drifting) arena center
    setArenaDrift(x, z) { G.arenaDrift = new THREE.Vector3(x, 0, z); }, // test/tool: enable a drifting zone
    get activeMission() { return G.activeMission; }, // the side mission being played (null = campaign)
    get missionOffers() { return missionOffers; },
    get previewTarget() { return mwPreview && mwPreview.url; }, // the glb url in the right-column ship preview
    // the granted-item showcase (work zone): the glb url shown, or null when the showcase is hidden
    get itemShowcaseTarget() { const d = document.getElementById('mw-mission-desc'); return d && d.classList.contains('show-item') ? (mwItem && mwItem.url) : null; },

    launchMission, refreshMissions, showMain, // test/tool: drive the side-mission board + the Main Window
    get mainBriefing() { return mainBriefing; }, // the campaign (primary) briefing currently shown
    get oobWarnVisible() { return el.oobWarn.style.display === 'block'; },
    get player() { return G.player; },   // built asynchronously in bootstrap()
    get catalog() { return CATALOG; }, // ships/weapons/level loaded from the DB
    get earned() { return G.earned; },   // credits earned this run
    get balance() { return G.balance; }, // persistent account balance
    get kills() { return G.kills; },
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
// showWelcome/renderShipCards/take-off + applyTranslations/the EN-RU lang switch + requestFullscreen
// are imported at the top. The audio-settings modal is src/settings.js.

// ---------- Account / authentication moved to src/account.js ----------
// renderAccountBar/openAccount/shouldPromptAccount + login/register/logout + initSentry/restoreSession
// are in account.js; bootstrap calls restoreSession()/initSentry(), the Main Window opens the dialog.

async function bootstrap() {
  initSentry(); // fire-and-forget: don't delay the game waiting on the monitoring SDK
  try {
    // Pick the language and load the message catalogs before the first render. Initial guess from
    // the explicit local choice → browser language → en; the server preference is adopted below.
    let explicitLang = null; try { explicitLang = localStorage.getItem('lang'); } catch {}
    let browserLang = ''; try { browserLang = navigator.language || (navigator.languages || [])[0] || ''; } catch {}
    await loadLanguage(resolveLanguage({ explicit: explicitLang, browser: browserLang }), fetchJson);

    // Restore an authenticated session (httpOnly cookie) over the anon UUID + clear the ?verified=1 flag.
    await restoreSession();

    // The level comes from the player's progress (their highest unlocked level); fall back to
    // level-1 if the player isn't identified (e.g. localStorage blocked).
    const levelUrl = G.playerId ? `/api/players/${G.playerId}/level` : '/api/levels/level-1';
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
    for (const w of weapons) CATALOG.weapons.set(w.id, { id: w.id, name: w.name, type: w.type, price: w.price, modelUrl: w.modelUrl, modelUrlHigh: w.modelUrlHigh, ...w.stats });
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
    // Homepage reflects the current level: if it has a briefing (level 2+), land on the Hangar showing
    // it; otherwise (level 1 / new player) show the welcome screen with the ship picker + intro.
    if (CATALOG.level.briefing) showMain(CATALOG.level.briefing);
    else showWelcome(playerShips);
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
  } catch (err) {
    console.error('Failed to load the game from the API:', err);
  }
}
bootstrap();
