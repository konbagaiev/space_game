// HUD draws: the per-frame readouts, off-screen enemy markers, mini-map radar, and the perf overlay.
//
// These are pure draw functions — they READ live state (G, the entity arrays, the engine singletons)
// and write to the DOM; they never mutate game state. The sim loop calls them each frame. Pause control
// (setPaused/togglePause) and the OOB warning stay inline with the sim cluster — they touch the level
// runner + music routing, which haven't been split out yet.
import * as THREE from 'three';
import { G, enemies, creditPopups } from './state.js';
import { drops } from './drops.js'; // off-screen loot markers (no circular dep — drops.js does not import hud.js)
import { camera, renderer, gameW, gameH } from './engine.js';
import { ARENA, arenaCenter } from './world.js';
import { cssColor } from './format.js';
import { t } from './i18n.js';
import { el } from './dom.js';
import { isDev } from './dev.js';

const DEV = isDev(); // ?dev → append live JS-heap usage + ●dev tag to the perf overlay (see dev.js)

// ---------- HUD ----------
export function updateHud() {
  el.earned.textContent = G.earned;
  el.credits.textContent = G.balance;
  el.kills.textContent = G.enemyTotal > 0 ? `${G.kills}/${G.enemyTotal}` : G.kills;
  el.enemies.textContent = enemies.length;
  const hpPct = Math.max(0, G.player.hp / G.player.maxHp * 100);
  el.hpFill.style.width = hpPct + '%';
  el.hpPct.textContent = hpPct.toFixed(1) + '%'; // remaining health, one decimal

  // rocket reload: the 🚀 circle fills up (radial) as the rocket group reloads
  const rg = G.player.groups.rocket;
  const cd = rg ? rg.reload : 1;
  const left = rg ? Math.max(0, rg.cooldown) : 0;
  const ready = left <= 0;
  const deg = Math.round((cd > 0 ? 1 - left / cd : 1) * 360);
  const col = ready ? '#77ee77' : '#ffaa55';
  el.rocketFill.style.background = `conic-gradient(${col} ${deg}deg, rgba(120,90,60,.22) ${deg}deg)`;
  el.rocketBtn.classList.toggle('ready', ready);
}

// ---------- Perf overlay (load) ----------
let perfAccum = 0, perfFrames = 0, perfFps = 0;
export function updatePerf(sec) { // `sec` = the RAW frame interval (not the sim's clamped dt — see animate)
  perfAccum += sec; perfFrames++;
  if (perfAccum >= 0.4) { // update ~2.5 times per sec
    perfFps = Math.round(perfFrames / perfAccum);
    const r = renderer.info.render;
    const tris = r.triangles >= 1e6
      ? (r.triangles / 1e6).toFixed(2) + 'M'
      : Math.round(r.triangles / 1e3) + 'k';
    const ms = (perfAccum / perfFrames * 1000).toFixed(1);
    // Append the real backbuffer size (CSS size × pixelRatio × renderScale) — the actual pixels the GPU
    // fills. Lets a tester confirm whether a tier/renderScale change moved the pixel count at all (a weak
    // phone often reports devicePixelRatio ~1, so the pixelRatioCap is a no-op and only renderScale bites).
    const res = `${renderer.domElement.width}×${renderer.domElement.height}`;
    // In ?dev, append live JS-heap usage (Chrome only) so the tester can eyeball current RAM.
    const devSuffix = DEV ? (performance.memory ? ` · ${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB` : '') + ' ●dev' : '';
    el.perf.textContent = t('ui.perf', { fps: perfFps, ms, calls: r.calls, tris }) + ' · ' + res + devSuffix;
    perfAccum = 0; perfFrames = 0;
  }
}

// ---------- Off-screen enemy markers: edge arrows pointing toward enemies that are off-screen ----------
const markerPool = [];
const _ndc = new THREE.Vector3();
function getMarker(i) {
  while (markerPool.length <= i) {
    const d = document.createElement('div');
    d.className = 'marker';
    el.markers.appendChild(d);
    markerPool.push(d);
  }
  return markerPool[i];
}
export function updateMarkers() {
  // hide everything while there's no player or an overlay (game over / victory) is up
  if (!G.player || el.overlay.style.display !== 'none') { for (const m of markerPool) m.style.display = 'none'; return; }
  const w = gameW(), h = gameH(), margin = 0.92; // game (rotated) screen size, not the raw viewport
  let used = 0;
  for (const e of enemies) {
    _ndc.copy(e.mesh.position).project(camera);
    const behind = _ndc.z > 1;            // point is behind the camera -> NDC is mirrored
    let x = _ndc.x, y = _ndc.y;
    if (behind) { x = -x; y = -y; }
    if (!behind && x >= -1 && x <= 1 && y >= -1 && y <= 1) continue; // on screen -> no marker
    const k = margin / Math.max(Math.abs(x), Math.abs(y), 1e-4);     // clamp dir to the edge box
    const cx = x * k, cy = y * k;
    const m = getMarker(used++);
    m.style.display = 'block';
    m.style.left = ((cx * 0.5 + 0.5) * w) + 'px';
    m.style.top = ((-cy * 0.5 + 0.5) * h) + 'px';
    m.style.borderLeftColor = cssColor(e.color ?? 0xffffff);          // tint by enemy type
    m.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(-cy, cx) * 180 / Math.PI}deg)`;
  }
  for (let i = used; i < markerPool.length; i++) markerPool[i].style.display = 'none';
}

// ---------- Off-screen loot markers: green edge arrows toward off-screen drops (nearest N) ----------
const dropMarkerPool = [];
const DROP_MARKER_MAX = 6;                 // cap: only the nearest few, so the edges don't clutter
function getDropMarker(i) {
  while (dropMarkerPool.length <= i) {
    const d = document.createElement('div');
    d.className = 'marker drop-marker';    // reuse the .marker arrow shape; .drop-marker sets the green
    el.markers.appendChild(d);
    dropMarkerPool.push(d);
  }
  return dropMarkerPool[i];
}
export function updateDropMarkers() {
  if (!G.player || el.overlay.style.display !== 'none') { for (const m of dropMarkerPool) m.style.display = 'none'; return; }
  const w = gameW(), h = gameH(), margin = 0.92;
  // collect off-screen drops with their edge position + squared distance, keep the nearest DROP_MARKER_MAX
  const ppos = G.player.mesh.position, offs = [];
  for (const d of drops) {
    _ndc.copy(d.obj.position).project(camera);
    const behind = _ndc.z > 1;
    let x = _ndc.x, y = _ndc.y;
    if (behind) { x = -x; y = -y; }
    if (!behind && x >= -1 && x <= 1 && y >= -1 && y <= 1) continue; // on screen → no marker
    const k = margin / Math.max(Math.abs(x), Math.abs(y), 1e-4);
    const dx = d.obj.position.x - ppos.x, dz = d.obj.position.z - ppos.z;
    offs.push({ cx: x * k, cy: y * k, d2: dx * dx + dz * dz });
  }
  offs.sort((a, b) => a.d2 - b.d2);
  const n = Math.min(offs.length, DROP_MARKER_MAX);
  for (let i = 0; i < n; i++) {
    const { cx, cy } = offs[i];
    const m = getDropMarker(i);
    m.style.display = 'block';
    m.style.left = ((cx * 0.5 + 0.5) * w) + 'px';
    m.style.top = ((-cy * 0.5 + 0.5) * h) + 'px';
    m.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(-cy, cx) * 180 / Math.PI}deg)`;
  }
  for (let i = n; i < dropMarkerPool.length; i++) dropMarkerPool[i].style.display = 'none';
}

// ---------- Credit popups: "+xx" green text floating up from each kill, holding then fading over ~2s ----------
const popupPool = [];
const _pp = new THREE.Vector3();
function getPopup(i) {
  while (popupPool.length <= i) {
    const d = document.createElement('div');
    d.className = 'credit-popup';
    el.markers.appendChild(d); // reuse the fixed, full-screen, non-interactive markers container
    popupPool.push(d);
  }
  return popupPool[i];
}
export function updateCreditPopups() {
  // hide everything while there's no player or an overlay (game over / victory) is up
  if (!G.player || el.overlay.style.display !== 'none') { for (const p of popupPool) p.style.display = 'none'; return; }
  const w = gameW(), h = gameH();
  let used = 0;
  for (const cp of creditPopups) {
    _pp.copy(cp.pos).project(camera);
    if (_pp.z > 1) continue;                    // behind the camera -> skip
    const t = 1 - Math.max(0, cp.life) / cp.maxLife; // 0 -> 1 over its life
    const x = (_pp.x * 0.5 + 0.5) * w;
    const y = (-_pp.y * 0.5 + 0.5) * h - t * 40; // drift up ~40px in screen space
    const p = getPopup(used++);
    p.style.display = 'block';
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.opacity = String(Math.min(1, Math.max(0, cp.life))); // hold full, then fade over the last ~1s
    p.textContent = '+' + cp.amount;
  }
  for (let i = used; i < popupPool.length; i++) popupPool[i].style.display = 'none';
}

// ---------- Mini-map / radar: arena bounds, the player (with heading), and type-colored enemy dots ----------
// Complements the edge arrows (arrows = immediate threat direction; the radar = spatial overview, useful
// now that the player can wander out of bounds). The shown range slightly exceeds the arena so an
// out-of-bounds player still reads near the edge.
const miniCtx = el.minimap.getContext('2d');
const MINI_VIEW = ARENA * 1.18; // world half-extent the radar shows (a touch beyond the arena)
export function updateMiniMap() {
  if (!G.player || el.overlay.style.display !== 'none') { el.minimap.style.visibility = 'hidden'; return; }
  el.minimap.style.visibility = 'visible';
  const S = el.minimap.width, c = S / 2, scale = (c - 6) / MINI_VIEW;
  // map world → radar relative to the arena center (so the boundary square stays centered when it drifts)
  const toX = (x) => c + (x - arenaCenter.x) * scale, toY = (z) => c + (z - arenaCenter.z) * scale;
  miniCtx.clearRect(0, 0, S, S);

  // arena boundary square
  const a = ARENA * scale;
  miniCtx.strokeStyle = 'rgba(73,224,255,.65)';
  miniCtx.lineWidth = 1;
  miniCtx.strokeRect(c - a, c - a, a * 2, a * 2);

  // enemies as dots, tinted by type color (same palette as the edge arrows)
  for (const e of enemies) {
    const ex = toX(e.mesh.position.x), ey = toY(e.mesh.position.z);
    if (ex < 1 || ex > S - 1 || ey < 1 || ey > S - 1) continue; // off the radar
    miniCtx.fillStyle = cssColor(e.color ?? 0xffffff);
    miniCtx.beginPath();
    miniCtx.arc(ex, ey, 2.4, 0, Math.PI * 2);
    miniCtx.fill();
  }

  // player as a heading triangle (red while out of bounds), clamped to the radar edge so it stays
  // visible even when the ship flies far outside the boundary
  const px = Math.max(6, Math.min(S - 6, toX(G.player.mesh.position.x)));
  const py = Math.max(6, Math.min(S - 6, toY(G.player.mesh.position.z)));
  const fx = Math.sin(G.player.heading), fz = Math.cos(G.player.heading); // forward dir (headingToDir)
  miniCtx.fillStyle = G.player.oobTime > 0 ? '#ff7a5a' : '#9fe8ff';
  miniCtx.beginPath();
  miniCtx.moveTo(px + fx * 6, py + fz * 6);                       // nose
  miniCtx.lineTo(px - fx * 4 - fz * 4, py - fz * 4 + fx * 4);     // back-left
  miniCtx.lineTo(px - fx * 4 + fz * 4, py - fz * 4 - fx * 4);     // back-right
  miniCtx.closePath();
  miniCtx.fill();
}
