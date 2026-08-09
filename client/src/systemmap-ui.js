// System-map screen: a top-down overview of the star system, used in TWO hosts —
//   1. the base-menu Map section (interactive: pick a destination → enter roam), and
//   2. an in-world overlay opened out of combat (re-route the autopilot / return to hangar).
// Canvas 2D drawing only (no THREE, no binary assets). All UI strings are English, i18n-keyed.
import { G } from './state.js';
import { t } from './i18n.js';
import { SYSTEM, ANCHORS, bodyWorldPos, listDestinations } from './system-map.js';

// A mission destination is INTERACTIVE only when its offer exists (sideMissionsUnlocked + on the board).
function offerFor(missionOffers, id) { return missionOffers.find((o) => o.id === id) || null; }

// Draw the whole map into a canvas and return the on-screen marker hit-list for click picking. The star is
// pinned to canvas center; planets ride their orbit circles at their wall-clock angle; the base/science/
// mining anchors + the player sit near planet 2. Returns [{ id, kind, missionId, pos, sx, sy, locked }].
export function drawSystemMap(canvas, { missionOffers = [] } = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const outer = SYSTEM.planets[SYSTEM.planets.length - 1].orbitR;
  const scale = (Math.min(W, H) / 2 - 26) / outer;
  const now = Date.now();
  const star = bodyWorldPos('star', now);
  const map = (wx, wz) => [cx + (wx - star.x) * scale, cy + (wz - star.z) * scale]; // world → canvas (star-centered)

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a0e16'; ctx.fillRect(0, 0, W, H);

  // orbit circles
  ctx.strokeStyle = 'rgba(120,150,200,0.22)'; ctx.lineWidth = 1;
  for (const p of SYSTEM.planets) { ctx.beginPath(); ctx.arc(cx, cy, p.orbitR * scale, 0, Math.PI * 2); ctx.stroke(); }
  // asteroid belt (dashed band)
  ctx.strokeStyle = 'rgba(150,140,110,0.30)'; ctx.setLineDash([3, 4]);
  for (const r of [SYSTEM.belt.inner, SYSTEM.belt.outer]) { ctx.beginPath(); ctx.arc(cx, cy, r * scale, 0, Math.PI * 2); ctx.stroke(); }
  ctx.setLineDash([]);

  // star
  ctx.fillStyle = '#ffd9a0'; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();

  // planets
  for (const p of SYSTEM.planets) {
    const [x, y] = map(bodyWorldPos(p.name, now).x, bodyWorldPos(p.name, now).z);
    ctx.fillStyle = `#${(p.color).toString(16).padStart(6, '0')}`;
    ctx.beginPath(); ctx.arc(x, y, p.name === 'planet2' ? 5 : 4, 0, Math.PI * 2); ctx.fill();
  }

  // destination markers (base + mission structures near planet 2)
  const activeId = G.activeMission && G.activeMission.title ? `side-${G.activeMission.title}` : null;
  const hits = [];
  for (const d of listDestinations()) {
    const [x, y] = map(d.pos.x, d.pos.z);
    const locked = d.kind === 'mission' && !offerFor(missionOffers, d.missionId);
    const active = d.missionId && d.missionId === activeId;
    ctx.fillStyle = locked ? 'rgba(150,150,160,0.55)' : (active ? '#ffd24a' : (d.kind === 'base' ? '#6fd0ff' : '#7fff9a'));
    ctx.beginPath(); ctx.arc(x, y, active ? 6 : 4.5, 0, Math.PI * 2); ctx.fill();
    if (locked) { ctx.strokeStyle = 'rgba(200,200,210,0.7)'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke(); }
    hits.push({ ...d, sx: x, sy: y, locked, active });
  }

  // player + heading
  if (G.player) {
    const [px, py] = map(G.player.mesh.position.x, G.player.mesh.position.z);
    ctx.save(); ctx.translate(px, py); ctx.rotate(-(G.player.heading || 0));
    ctx.fillStyle = '#ffffff'; ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  return hits;
}

// Nearest marker within `r` px of (x,y), or null.
export function pickMarker(hits, x, y, r = 16) {
  let best = null, bestD = r;
  for (const h of hits) { const d = Math.hypot(h.sx - x, h.sy - y); if (d <= bestD) { bestD = d; best = h; } }
  return best;
}

// ---------- In-world overlay (opened out of combat by a mini-map tap) ----------
let overlayEl = null, overlayCanvas = null, overlayHits = [], overlayCtx = null;

function buildOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.id = 'systemmap-overlay';
  overlayEl.style.cssText = 'position:fixed;inset:0;z-index:9000;display:none;align-items:center;justify-content:center;'
    + 'background:rgba(4,7,12,0.86);flex-direction:column;gap:14px';
  overlayEl.innerHTML =
    `<div style="color:#cfe6ff;font:700 18px/1 system-ui,sans-serif" data-i18n="ui.systemmap.title">Star system</div>`
    + `<canvas id="systemmap-canvas" width="520" height="520" style="max-width:80vmin;max-height:80vmin;border:1px solid rgba(120,150,200,0.3);border-radius:10px;cursor:crosshair"></canvas>`
    + `<div id="systemmap-hint" style="color:#9fb6d0;font:500 13px/1.4 system-ui,sans-serif;min-height:18px"></div>`
    + `<div style="display:flex;gap:12px">`
    + `<button id="systemmap-return" style="cursor:pointer;font:600 14px system-ui;color:#0b0f14;background:#6fd0ff;border:0;border-radius:8px;padding:8px 16px" data-i18n="ui.systemmap.returnHangar">Return to hangar</button>`
    + `<button id="systemmap-close" style="cursor:pointer;font:600 14px system-ui;color:#cfe6ff;background:rgba(120,150,200,0.18);border:1px solid rgba(120,150,200,0.4);border-radius:8px;padding:8px 16px" data-i18n="ui.systemmap.close">Close</button>`
    + `</div>`;
  document.body.appendChild(overlayEl);
  overlayCanvas = overlayEl.querySelector('#systemmap-canvas');
  overlayCtx = overlayEl.querySelector('#systemmap-hint');
  return overlayEl;
}

// Open the in-world system map. Freezes the game via G.mapOpen (raw loop-skip, NOT setPaused).
//   interactive: true  (roam/return-to-base) → picking a destination re-routes the autopilot; Return shown.
//   interactive: false (live fight)          → view-only (no re-route, no Return).
export function openSystemMap({ interactive = true, missionOffers = [], onPick, onReturnToHangar } = {}) {
  buildOverlay();
  applyStrings(overlayEl);
  overlayEl.style.display = 'flex';
  G.mapOpen = true;
  const returnBtn = overlayEl.querySelector('#systemmap-return');
  returnBtn.style.display = interactive ? '' : 'none';
  const redraw = () => { overlayHits = drawSystemMap(overlayCanvas, { missionOffers }); };
  redraw();
  overlayEl._redraw = redraw;
  overlayCanvas.onclick = (e) => {
    if (!interactive) return;
    const rect = overlayCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (overlayCanvas.width / rect.width);
    const y = (e.clientY - rect.top) * (overlayCanvas.height / rect.height);
    const m = pickMarker(overlayHits, x, y);
    if (!m) return;
    if (m.locked) { overlayCtx.textContent = t('ui.systemmap.locked'); return; }
    onPick && onPick(m);
    closeSystemMap();
  };
  returnBtn.onclick = () => { closeSystemMap(); onReturnToHangar && onReturnToHangar(); };
  overlayEl.querySelector('#systemmap-close').onclick = () => closeSystemMap();
}

export function closeSystemMap() {
  if (overlayEl) overlayEl.style.display = 'none';
  G.mapOpen = false;
}
export function isSystemMapOpen() { return !!(overlayEl && overlayEl.style.display !== 'none'); }

// ---------- Base-menu Map section ----------
// Mounts the map + a "Launch into system" button and, per REACHABLE mission destination, a "Fly here"
// button. onLaunch() enters free roam; onFlyHere({pos, missionId}) enters roam + autopilots there.
export function mountBaseMenuMap(hostEl, { missionOffers = [], onLaunch, onFlyHere } = {}) {
  hostEl.innerHTML =
    `<div class="mw-stub-title" data-i18n="ui.mainwin.map">Map</div>`
    + `<canvas id="mw-systemmap" width="440" height="440" style="max-width:52vmin;max-height:52vmin;border:1px solid rgba(120,150,200,0.3);border-radius:10px;display:block;margin:10px auto"></canvas>`
    + `<div id="mw-map-actions" style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center"></div>`;
  applyStrings(hostEl);
  const canvas = hostEl.querySelector('#mw-systemmap');
  drawSystemMap(canvas, { missionOffers });
  const actions = hostEl.querySelector('#mw-map-actions');
  const launch = document.createElement('button');
  launch.className = 'btn';
  launch.textContent = t('ui.systemmap.launch');
  launch.style.cssText = 'cursor:pointer;font:600 14px system-ui;color:#0b0f14;background:#6fd0ff;border:0;border-radius:8px;padding:8px 16px';
  launch.onclick = () => onLaunch && onLaunch();
  actions.appendChild(launch);
  for (const d of listDestinations()) {
    if (d.kind !== 'mission') continue;
    const reachable = !!offerFor(missionOffers, d.missionId);
    const b = document.createElement('button');
    b.textContent = `${t('ui.systemmap.flyHere')} — ${d.missionId}`;
    b.disabled = !reachable;
    b.style.cssText = 'cursor:pointer;font:600 13px system-ui;color:#cfe6ff;background:rgba(120,150,200,0.18);border:1px solid rgba(120,150,200,0.4);border-radius:8px;padding:8px 14px'
      + (reachable ? '' : ';opacity:0.45;cursor:not-allowed');
    if (reachable) b.onclick = () => onFlyHere && onFlyHere({ pos: d.pos, missionId: d.missionId });
    actions.appendChild(b);
  }
}

// ---------- "Start mission?" arrival prompt ----------
let promptEl = null;
export function showStartMissionPrompt({ titleText, onYes, onNo } = {}) {
  if (!promptEl) {
    promptEl = document.createElement('div');
    promptEl.id = 'systemmap-prompt';
    promptEl.style.cssText = 'position:fixed;inset:0;z-index:9500;display:none;align-items:center;justify-content:center;background:rgba(4,7,12,0.7)';
    promptEl.innerHTML =
      `<div style="background:#0e141d;border:1px solid rgba(120,150,200,0.4);border-radius:12px;padding:22px 26px;text-align:center;display:flex;flex-direction:column;gap:14px">`
      + `<div id="systemmap-prompt-title" style="color:#cfe6ff;font:700 18px system-ui" data-i18n="ui.systemmap.startMission">Start mission?</div>`
      + `<div id="systemmap-prompt-sub" style="color:#9fb6d0;font:500 14px system-ui"></div>`
      + `<div style="display:flex;gap:12px;justify-content:center">`
      + `<button id="systemmap-prompt-yes" style="cursor:pointer;font:600 14px system-ui;color:#0b0f14;background:#7fff9a;border:0;border-radius:8px;padding:8px 20px" data-i18n="ui.systemmap.startYes">Start</button>`
      + `<button id="systemmap-prompt-no" style="cursor:pointer;font:600 14px system-ui;color:#cfe6ff;background:rgba(120,150,200,0.18);border:1px solid rgba(120,150,200,0.4);border-radius:8px;padding:8px 20px" data-i18n="ui.systemmap.startNo">Not yet</button>`
      + `</div></div>`;
    document.body.appendChild(promptEl);
  }
  applyStrings(promptEl);
  promptEl.querySelector('#systemmap-prompt-sub').textContent = titleText || '';
  promptEl.style.display = 'flex';
  const close = () => { promptEl.style.display = 'none'; };
  promptEl.querySelector('#systemmap-prompt-yes').onclick = () => { close(); onYes && onYes(); };
  promptEl.querySelector('#systemmap-prompt-no').onclick = () => { close(); onNo && onNo(); };
}
export function isStartMissionPromptOpen() { return !!(promptEl && promptEl.style.display !== 'none'); }

// Localize any [data-i18n] nodes inside `root` (the overlays are built in JS, so applyTranslations in
// welcome.js doesn't see them at bootstrap).
function applyStrings(root) {
  root.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.getAttribute('data-i18n')); });
}
