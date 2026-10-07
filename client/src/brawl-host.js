// The bot brawl's BROWSER half (`?brawl`, docs/plans/2026-10-04-2001-bot-brawl-load-test.md): the setup
// panel, the start, the spectator camera, the per-frame measurement and the result card. The fight itself
// is `sim-core/brawl.js`; the numbers are `brawl-stats.js`; the flag is `brawl-dev.js`.
//
// The camera works through ONE seam: `G.viewTarget`. Every render reader of "where is the player" that
// shapes the picture (the camera, the speed field, the star-system bodies' fade, the arena border, the
// radar triangle) asks it first, so the spectator ship can sit parked 5000 u away while the picture is
// framed on the fight. It returns a reused THREE.Vector3 on the bullet plane — never a plain {x,z} and
// never a sim Vec3, because THREE's `lookAt` type-tests its argument (the NaN-camera trap, vec.js).
//
// `?netbrawl` (docs/plans/2026-10-06-1530-server-brawl.md): the SAME panel, camera, measurement and card, but
// the fight runs in a server room. This tab spawns nothing; `world.brawl` is a never-stepped MIRROR
// (`brawl-net.js`) filled from the snapshots, the ships are netsim ghosts, a pick is by network id, and the
// run arms only once the ghosts have arrived AND been warmed (the room arms on the tab's first input, which
// main.js holds back until then — `brawlInputAllowed`). A lost link ends the run on the spot
// (`brawlLinkLost`); there is no local fallback.
import * as THREE from 'three';
import { G, world } from './state.js';
import { camera, renderer, setZoom } from './engine.js';
import { reset } from './sim.js';
import { seedSim } from './sim-core/sim-random.js';
import { BULLET_PLANE_Y } from './sim-core/consts.js';
import {
  BRAWL_SEED, BRAWL_CENTER, BRAWL_N_MIN, BRAWL_N_MAX, BRAWL_N_DEFAULT, BRAWL_WINDOW_TICKS,
  spawnBrawl, brawlOver, brawlSimSec, brawlViewCentre, nextCameraMode,
} from './sim-core/brawl.js';
import {
  windowStats, brawlShouldEnd, buildBrawlResult, formatBrawlCard, serverWindowStats, summarizeSrv,
} from './brawl-stats.js';
import { makeBrawlMirror, applyBrawlBlock, pushSrv, brawlNetErrorText } from './brawl-net.js';
import { brawlDev, parseBrawlCount } from './brawl-dev.js';
import { TIER_ORDER, TIERS } from './graphics.js';
import { jsEngine } from './engine-id.js';

const CAM_EASE_SEC = 0.4;     // centre mode eases toward the centroid with this time constant
const PICK_RADIUS = 25;       // a tap picks the nearest living ship within this many world units

let mode = { kind: 'centre' };
let followId = null;
const _view = new THREE.Vector3(BRAWL_CENTER.x, BULLET_PLANE_Y, BRAWL_CENTER.z);
const _target = { x: 0, z: 0 };
let t0 = 0;                   // performance.now() at arming
let samples = [];             // { ms, tick, inFrame } per armed frame
let frameMs = [];
let stationFrames = 0, stationHits = 0;
let stationSphere = null;     // computed lazily on the first armed frame; null = not yet / unknown
let stationKnown = false;
let interrupted = false;
let result = null;
let cardVisible = false;
let onResult = null;
// How a ship is named for a pick/follow: its pilot ordinal locally, its network id under ?netbrawl (ghosts
// carry no `_aimOrdinal`).
let idOf = (s) => s._aimOrdinal;
let closeLink = null;         // ?netbrawl: main.js's "send bye and close" (Decision 10a)
let linkClosed = false;       // ?netbrawl: the link is gone (closed by us at the card, or lost)
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();
const _p = new THREE.Vector3();

const preserved = () => {
  const p = new URLSearchParams(location.search);
  let s = '';
  for (const k of ['dev', 'debug']) if (p.has(k)) s += `&${k}`;
  if (p.has('sec')) s += `&sec=${encodeURIComponent(p.get('sec'))}`;
  return s;
};

const paramName = () => (brawlDev()?.server ? 'netbrawl' : 'brawl');

// ---------- the setup panel (a bare `?brawl` / `?netbrawl`) ----------
// `error` — a ?netbrawl join that failed before the run armed (the server's brawl cap, an unreachable room).
export function showBrawlSetup({ error = '' } = {}) {
  const root = document.getElementById('brawl-setup');
  if (!root) return;
  const modeEl = root.querySelector('#brawl-mode');
  if (modeEl) modeEl.textContent = `Simulated by: ${brawlDev()?.server ? 'server room' : 'this tab'}`;
  const errEl = root.querySelector('#brawl-error');
  if (errEl) { errEl.textContent = error || ''; errEl.hidden = !error; }
  let n = BRAWL_N_DEFAULT;
  let tier = G.gfx.name;                       // the SAVED tier (state.js resolved it at boot)
  const nEl = root.querySelector('#brawl-n');
  const tiersEl = root.querySelector('#brawl-tiers');
  const buildEl = root.querySelector('#brawl-build');
  const draw = () => {
    if (document.activeElement !== nEl) nEl.value = String(n);   // never rewrite the field while it is being typed in
    for (const b of tiersEl.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tier === tier);
    buildEl.textContent = `Build ${G.buildVersion || 'unknown'} · Hard-refresh after a deploy`;
  };
  tiersEl.innerHTML = '';
  for (const t of TIER_ORDER) {
    const b = document.createElement('button');
    b.dataset.tier = t;
    b.textContent = TIERS[t].label || t[0].toUpperCase() + t.slice(1);
    b.addEventListener('click', () => { tier = t; draw(); });
    tiersEl.appendChild(b);
  }
  root.querySelector('#brawl-minus').onclick = () => { n = Math.max(BRAWL_N_MIN, n - 1); draw(); };
  root.querySelector('#brawl-plus').onclick = () => { n = Math.min(BRAWL_N_MAX, n + 1); draw(); };
  // The count can also be TYPED (maintainer, 2026-10-06): committed on Enter, on blur and on Start, clamped
  // to the brawl's range; anything that is not a number keeps the count already shown (parseBrawlCount).
  const commit = () => { n = parseBrawlCount(nEl.value, n); nEl.value = String(n); };
  nEl.onchange = commit;
  nEl.onblur = commit;
  nEl.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { commit(); nEl.blur(); } };  // keep game keys out of it
  nEl.onfocus = () => nEl.select();
  root.querySelector('#brawl-start').onclick = () => { commit(); location.assign(`?${paramName()}=${n}&tier=${tier}${preserved()}`); };
  root.classList.add('on');
  draw();
  setTimeout(draw, 1500);                      // the build stamp arrives with /api/config, maybe after boot
}

// ---------- the run ----------
// `pushResult` is devPerf's — the one `/api/perf` sink, owned by main.js.
// `idOf` / `closeLink` are ?netbrawl's (main.js passes the network-id lookup and its link closer).
export function startBrawl({ pushResult, idOf: idOfNet = null, closeLink: closeNet = null } = {}) {
  const dev = brawlDev();
  onResult = pushResult || null;
  document.body.classList.remove('menu');
  document.body.classList.add('brawl');
  G.activeMission = null;
  G.gameStarted = true;
  reset();
  if (dev.server) {
    // The ROOM spawns the bots; this tab only mirrors the fight (never stepped — brawlTick skips it).
    world.brawl = makeBrawlMirror(dev.n);
    idOf = idOfNet || ((s) => s._aimOrdinal);
    closeLink = closeNet;
    linkClosed = false;
  } else {
    // Spawned in the SAME frame as reset(), so the level warm that reset() requested compiles the bots too.
    idOf = (s) => s._aimOrdinal;
    seedSim(BRAWL_SEED);
    spawnBrawl(world, dev.n);
  }
  setZoom(1, false);            // gameplay zoom for this run only — the saved zoom is untouched
  mode = { kind: 'centre' }; followId = null;
  _view.set(BRAWL_CENTER.x, BULLET_PLANE_Y, BRAWL_CENTER.z);
  G.viewTarget = () => _view;
}

const shipById = (id) => [...world.allies, ...world.enemies].find((s) => idOf(s) === id && s.alive !== false) || null;

function computeStationSphere() {
  const obj = G.baseStation && G.baseStation.obj;
  let meshes = 0;
  if (obj) obj.traverse((o) => { if (o.isMesh) meshes++; });
  if (!meshes) { stationKnown = false; stationSphere = null; return; }
  const box = new THREE.Box3().setFromObject(obj);
  stationSphere = box.getBoundingSphere(new THREE.Sphere());
  stationKnown = true;
}

// Once per animate frame. `rawSec` is the RAW frame interval; `warmDone` is "the level-load veil is down".
export function brawlFrame(rawSec, warmDone) {
  const b = world.brawl;
  if (!b) return;
  if (!b.armed) {
    if (b.server && !b.ghostsSeen) {
      // ?netbrawl: wait for the room's ships to arrive, then re-warm the scene so the ally and ace hulls
      // compile behind the veil (the brawl level's inert phase warmed no enemy types). The run arms when that
      // warm is done — and only then does main.js start sending input, which is what arms the ROOM.
      if (world.allies.length + world.enemies.length === 0) return;
      b.ghostsSeen = true;
      G.needsSceneWarm = true;
      return;
    }
    if (!warmDone) return;                     // frames behind the veil are not the fight
    b.armed = true;
    t0 = performance.now();
    computeStationSphere();
    return;
  }
  if (b.ended) return;
  // The view target. Bot mode follows rigidly; a dead followed ship sends the camera back to the centre.
  if (mode.kind === 'bot') {
    const s = shipById(mode.id);
    if (s) _view.set(s.pos.x, BULLET_PLANE_Y, s.pos.z);
    else { mode = { kind: 'centre' }; followId = null; }
  }
  if (mode.kind === 'centre') {
    brawlViewCentre(world, _target);
    const k = 1 - Math.exp(-Math.min(rawSec, 0.1) / CAM_EASE_SEC);
    _view.x += (_target.x - _view.x) * k;
    _view.z += (_target.z - _view.z) * k;
  }
  // What the camera saw THIS frame.
  camera.updateMatrixWorld();
  projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);
  let inFrame = 0;
  for (const s of world.allies) if (frustum.containsPoint(_p.set(s.pos.x, s.pos.y, s.pos.z))) inFrame++;
  for (const s of world.enemies) if (frustum.containsPoint(_p.set(s.pos.x, s.pos.y, s.pos.z))) inFrame++;
  samples.push({ ms: rawSec * 1000, tick: b.ticks, inFrame });
  frameMs.push(rawSec * 1000);
  if (stationKnown) { stationFrames++; if (frustum.intersectsSphere(stationSphere)) stationHits++; }
  if (document.hidden || G.paused) interrupted = true;
  const wallMs = performance.now() - t0;
  let endedBy = brawlShouldEnd({ wallMs, secLimit: brawlDev().sec, over: b.server ? !!b.serverEnded : brawlOver(world) });
  // The room ended it while both sides still stand: its backstop fired.
  if (endedBy === 'wipeout' && b.server && b.alive[0] > 0 && b.alive[1] > 0) endedBy = 'server';
  if (endedBy) finish(endedBy, wallMs / 1000);
}

function stationPct() {
  return stationKnown && stationFrames ? Math.round((stationHits / stationFrames) * 1000) / 10 : null;
}

function finish(endedBy, wallSec, { closeCode = null } = {}) {
  const b = world.brawl;
  b.ended = true;
  const fp = b.fingerprint;
  const windows = windowStats(samples, BRAWL_WINDOW_TICKS).map((w) => ({
    ...w,
    alive: fp[w.w] ? [fp[w.w][1], fp[w.w][2]] : (b.server ? b.alive.slice() : [world.allies.length, world.enemies.length]),
  }));
  result = buildBrawlResult({
    n: b.n, tier: G.gfx.name, build: G.buildVersion,
    res: `${renderer.domElement.width}x${renderer.domElement.height}`, dpr: renderer.getPixelRatio(),
    wallSec, simSec: brawlSimSec(world), frameMs, windows, fingerprint: fp,
    killsByBlue: b.killsByBlue, killsByRed: b.killsByRed,
    // Under ?netbrawl the room's count, not the ghosts this tab happens to still be drawing.
    survivors: b.server ? { blue: b.alive[0], red: b.alive[1] } : { blue: world.allies.length, red: world.enemies.length },
    stationInFramePct: stationPct(), interrupted, endedBy, engine: jsEngine(),
    server: !!b.server,
    srv: b.server ? summarizeSrv(b.srv) : null,
    serverWindows: b.server ? serverWindowStats(b.srv, BRAWL_WINDOW_TICKS) : null,
    closeCode,
  });
  try { onResult && onResult(result); } catch {}
  // ?netbrawl: the card is up, so the room has nothing left to do — say `bye` (Decision 10a). Silent: the
  // link's close() detaches its handlers first, so this is not mistaken for a lost link.
  if (b.server && closeLink && !linkClosed) { linkClosed = true; try { closeLink(); } catch {} }
  showCard(result);
}

// ---------- ?netbrawl: the wire ----------
// Input is held back until the TAB has armed (ghosts seen, scene warmed) and stops at the card: the room arms
// on the first input, so this is what starts the server's clock at the same moment as the tab's.
export function brawlInputAllowed() {
  const b = world.brawl;
  return !b || !b.server || (b.armed && !b.ended);
}

// Fold a snapshot's `brawl` and `srv` blocks into the mirror (a no-op for anything but a ?netbrawl run).
export function brawlNetSnapshot(snap) {
  const b = world.brawl;
  if (!b || !b.server || !snap) return;
  if (snap.brawl) applyBrawlBlock(b, snap.brawl);
  if (snap.srv) pushSrv(b, snap.srv);
}

// THE one link-loss path (Decision 11). Before the run armed: back to the setup panel with the reason (the
// server's brawl cap, an unreachable room). During the run: end it NOW, with what was measured, as
// `endedBy: 'link-lost'` and the close code. Idempotent. A later general reconnect for every room replaces
// this (docs/plans/2026-10-06-1530-server-brawl.md "Next").
export function brawlLinkLost({ code = null, reason = '' } = {}) {
  const b = world.brawl;
  const wasClosed = linkClosed;
  linkClosed = true;
  if (!b || !b.server || wasClosed) return;
  if (!b.armed) {
    const card = document.getElementById('brawl-card');
    if (card) card.classList.remove('on');
    showBrawlSetup({ error: brawlNetErrorText(reason || (code != null ? `closed ${code}` : '')) });
    return;
  }
  if (!b.ended) finish('link-lost', (performance.now() - t0) / 1000, { closeCode: code });
}

// Whether the ?netbrawl link is gone for good (main.js must not open a new room).
export function brawlLinkClosed() { return linkClosed; }

function showCard(r) {
  const root = document.getElementById('brawl-card');
  if (!root) return;
  const c = formatBrawlCard(r);
  const rows = c.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const head = `<tr>${c.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const body = c.table.body.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('');
  root.querySelector('.brawl-card-body').innerHTML =
    // The per-window table FIRST: it is the comparison the run exists for, and on a ~390 px-tall landscape
    // phone the box scrolls, so whatever comes first is what is seen without scrolling.
    `<table class="brawl-win">${head}${body}</table><table class="brawl-kv">${rows}</table><p class="brawl-note">${esc(c.note)}</p>`;
  root.querySelector('#brawl-again').onclick = () => location.reload();
  root.querySelector('#brawl-setup-btn').onclick = () => location.assign(`?${paramName()}${preserved()}`);
  root.classList.add('on');
  cardVisible = true;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// A tap/click (already in game-space NDC): follow the ship nearest the point, or go back to the centre.
const tapRay = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BULLET_PLANE_Y);
const _hit = new THREE.Vector3();
export function brawlTap(ndc) {
  if (!world.brawl || world.brawl.ended) return;
  let picked = null;
  if (mode.kind === 'centre') {
    tapRay.setFromCamera(ndc, camera);
    if (tapRay.ray.intersectPlane(plane, _hit)) {
      let best = PICK_RADIUS;
      for (const s of [...world.allies, ...world.enemies]) {
        if (s.alive === false || s.warping) continue;
        const id = idOf(s);
        if (id == null) continue;
        const d = Math.hypot(s.pos.x - _hit.x, s.pos.z - _hit.z);
        if (d <= best) { best = d; picked = id; }
      }
    }
  }
  mode = nextCameraMode(mode, picked);
  followId = mode.kind === 'bot' ? mode.id : null;
}

// For `?debug` (`__game.brawl`) and the per-second telemetry sample.
export function brawlDebugState() {
  const b = world.brawl;
  if (!b) return null;
  const armed = b.armed;
  const wallSec = armed ? (result ? result.wallSec : (performance.now() - t0) / 1000) : 0;
  const simSec = brawlSimSec(world);
  return {
    ...b,
    fingerprint: b.fingerprint.slice(),
    simSec, wallSec, ratio: wallSec > 0 ? Math.round((simSec / wallSec) * 100) / 100 : 0,
    alive: b.server ? b.alive.slice() : [world.allies.length, world.enemies.length],
    cam: mode.kind, followId,
    stationInFramePct: stationPct(),
    frames: samples.length,
    windows: result ? result.windows : null,
    cardVisible, interrupted,
    result,
    server: !!b.server,
    srvCount: b.srv ? b.srv.length : 0,
    lastSrv: b.srv && b.srv.length ? b.srv[b.srv.length - 1] : null,
    linkClosed,
  };
}
