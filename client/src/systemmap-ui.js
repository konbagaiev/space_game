// Star-system NAVIGATION UI — ONE component (`mountSystemNav`) used by every host that lets the player
// choose where to fly:
//   1. the base-menu **Map** section (mainwindow.renderMapView),
//   2. the in-flight **overlay** opened out of combat (main.js #map-btn / mini-map tap), and
//   3. **mission activation** — the mission board's "Autopilot to destination" reuses the same object list
//      + the same enterRoam/engagePointAutopilot handoff (it just skips the map).
//
// Layout: the map canvas is PINNED LEFT (in the base menu it sits right next to the left nav), the OBJECT
// LIST is the panel to its right. Every object in `listSystemObjects()` — the star and all four planets as
// first-class entries alongside the base, the science station and the three mining outposts — is both a
// list row and a map marker; selecting either highlights both, and "Autopilot to destination" flies there.
// Autopilot to a celestial body flies to its ANCHOR on the plane (system-map.js); the body itself stays a
// permanently distant backdrop (DECISIONS §98).
//
// Canvas 2D only (no THREE, no binary assets). Pan/zoom lives in the pure `map-view.js` seam. All UI
// strings are English source + i18n-keyed; object names come from `nameKey`, never a raw id.
import { G, CATALOG } from './state.js';
import { t } from './i18n.js';
import { esc } from './format.js';
import { SYSTEM, bodyWorldPos, listSystemObjects, systemRadius, objectForMission, objectForActiveMission } from './sim-core/system-map.js';
import { DEFAULT_VIEW, clampView, scaleOf, toScreen, panByScreen, zoomAtScreen, centerOn, pickAt } from './map-view.js';
import { TAP_SLOP, exceedsSlop } from './tap-gesture.js';
import { runCenter } from './sim-core/level-sim.js';

// A mission object is INTERACTIVE only when its offer exists (sideMissionsUnlocked + on the board).
function offerFor(missionOffers, id) { return (missionOffers || []).find((o) => o.id === id) || null; }

// Localized mission title for an object that hosts one: prefer the offer's titleKey; fall back to the
// per-type key (`mission.<type>.title`) so a locked site still reads as words, never a raw id.
function missionTitle(offer, missionId) {
  const key = (offer && offer.titleKey) || `mission.${String(missionId).replace(/^side-/, '')}.title`;
  return t(key);
}

// Decorate the raw objects with the per-session UI state the hosts need. `activeMissionId` is the mission
// the player is actually ON (null = the campaign): the object hosting it is flagged `active` and gets the
// dashed gold frame in the list + a dashed gold ring on the map, so "where is my mission?" is answered by
// looking, not by remembering. For the campaign that object is derived from the level's fight centre
// (objectForActiveMission) — a campaign level names a place, not an object.
function describeObjects(missionOffers, activeMissionId = null, tNow = Date.now()) {
  // The centre comes from `runCenter`, the same seam the fly-into-it zone uses: a campaign level that
  // names no centre fights at the ORIGIN — the home planet's own anchor — so that level is marked there
  // rather than nowhere, and "where is my mission?" always has an answer.
  const activeObj = objectForActiveMission(
    { activeMissionId, center: CATALOG.level ? runCenter(null, CATALOG.level) : null }, tNow);
  return listSystemObjects(tNow).map((o) => {
    const offer = o.missionId ? offerFor(missionOffers, o.missionId) : null;
    return {
      ...o,
      name: t(o.nameKey),
      offer,
      locked: !!o.missionId && !offer,                 // hosts a mission that isn't on the board yet
      active: !!activeObj && activeObj.id === o.id,    // your current mission is here
      missionName: o.missionId ? missionTitle(offer, o.missionId) : '',
    };
  });
}

// ---------------------------------------------------------------------------
// The shared component
// ---------------------------------------------------------------------------
// mountSystemNav(host, opts) → { refresh, destroy, getSelected }
//   opts.missionOffers      side-mission offers (drives locked rows + the arrival prompt)
//   opts.actions            extra buttons rendered next to "Autopilot to destination":
//                             [{ id, labelKey, primary, onClick, disabled, note }]
//   opts.onAutopilot(obj)   fly to the selected object (host decides enterRoam vs engagePointAutopilot)
//   opts.selectedId         initial selection
//   opts.activeMissionId    the mission the player is ON (null = the campaign) — marks its object
export function mountSystemNav(host, opts = {}) {
  const { missionOffers = [], actions = [], onAutopilot } = opts;
  let activeMissionId = opts.activeMissionId ?? null;
  let objects = describeObjects(missionOffers, activeMissionId);
  let selectedId = opts.selectedId || null;
  let view = { ...DEFAULT_VIEW };
  let frame = { width: 520, height: 520, worldRadius: systemRadius() };

  host.innerHTML =
    `<div class="sysnav">`
    + `<div class="sysnav-mapwrap">`
    + `<canvas class="sysnav-canvas" width="520" height="520"></canvas>`
    + `<div class="sysnav-zoom"><button data-zoom="in" aria-label="+">+</button><button data-zoom="out" aria-label="−">−</button></div>`
    + `</div>`
    + `<div class="sysnav-side">`
    + `<div class="sysnav-title" data-i18n="ui.systemmap.objects">Objects</div>`
    + `<div class="sysnav-list"></div>`
    + `<div class="sysnav-hint"></div>`
    + `<div class="sysnav-actions"></div>`
    + `</div></div>`;

  const canvas = host.querySelector('.sysnav-canvas');
  const listEl = host.querySelector('.sysnav-list');
  const hintEl = host.querySelector('.sysnav-hint');
  const actionsEl = host.querySelector('.sysnav-actions');
  const ctx = canvas.getContext('2d');

  const selected = () => objects.find((o) => o.id === selectedId) || null;

  // ---- object list ----
  function renderList() {
    listEl.innerHTML = objects.map((o) => {
      const cls = ['sysnav-row', `k-${o.kind}`];
      if (o.id === selectedId) cls.push('sel');
      if (o.locked) cls.push('locked');
      if (o.active) cls.push('mission-active');   // dashed gold frame: your current mission is here
      const sub = o.missionId
        ? `<span class="sysnav-mission">${esc(o.missionName)}${o.locked ? ' 🔒' : ''}</span>`
        : `<span class="sysnav-kind">${esc(t('ui.object.kind.' + o.kind))}</span>`;
      return `<button class="${cls.join(' ')}" data-obj="${esc(o.id)}">`
        + `<span class="sysnav-dot" style="background:${esc(o.color)}"></span>`
        + `<span class="sysnav-name">${esc(o.name)}</span>${sub}</button>`;
    }).join('');
  }

  // ---- actions row ----
  function renderActions() {
    const o = selected();
    const canFly = !!o && !o.locked;
    const extra = actions.map((a) => `<button data-act="${esc(a.id)}" class="${esc(a.cls || '')}"`
      + `${a.disabled ? ' disabled' : ''}>${esc(t(a.labelKey))}</button>`).join('');
    actionsEl.innerHTML = extra
      + `<button data-act="__autopilot" class="primary"${canFly ? '' : ' disabled'}>`
      + `${esc(t('ui.systemmap.autopilot'))}</button>`;
    const noted = actions.find((a) => a.note);
    hintEl.textContent = o && o.locked ? t('ui.systemmap.locked')
      : (noted ? noted.note : (o ? t('ui.systemmap.selected', { object: o.name }) : t('ui.systemmap.pick')));
  }

  function select(id) {
    selectedId = id;
    const o = selected();
    if (o) view = centerOn(view, frame, o.pos.x, o.pos.z); // bring an off-screen pick into the middle
    renderList(); renderActions(); draw();
  }

  // ---- canvas ----
  function sizeCanvas() {
    const w = Math.max(160, Math.round(canvas.clientWidth || 520));
    const h = Math.max(160, Math.round(canvas.clientHeight || 520));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    frame = { width: w, height: h, worldRadius: systemRadius() };
    view = clampView(view, frame);
  }

  function draw() {
    const W = frame.width, H = frame.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0e16'; ctx.fillRect(0, 0, W, H);
    const now = Date.now();
    const star = bodyWorldPos('star', now);
    const s = scaleOf(view, frame);
    const sp = toScreen(view, frame, star.x, star.z);

    // orbit circles + the asteroid belt band, all centred on the star
    ctx.strokeStyle = 'rgba(120,150,200,0.22)'; ctx.lineWidth = 1;
    for (const p of SYSTEM.planets) { ctx.beginPath(); ctx.arc(sp.x, sp.y, p.orbitR * s, 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(150,140,110,0.30)'; ctx.setLineDash([3, 4]);
    for (const r of [SYSTEM.belt.inner, SYSTEM.belt.outer]) { ctx.beginPath(); ctx.arc(sp.x, sp.y, r * s, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);

    // objects — one marker each, at the SAME point the list flies to
    for (const o of objects) {
      const p = toScreen(view, frame, o.pos.x, o.pos.z);
      if (p.x < -40 || p.y < -40 || p.x > W + 40 || p.y > H + 40) continue;
      const r = o.kind === 'star' ? 14 : (o.kind === 'planet' ? 10 : 4);
      if (o.active) {                                   // "your mission is here": dashed gold ring, drawn
        ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 1.5; // OUTSIDE the selection ring so both can show at once
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 9, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (o.id === selectedId) {                        // selection ring (matches the highlighted row)
        ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = o.locked ? 'rgba(150,150,160,0.55)' : o.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      if (o.locked) {
        ctx.strokeStyle = 'rgba(200,200,210,0.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2); ctx.stroke();
      }
      // label the selected object always, everything else once there is room to read it
      if (o.id === selectedId || s * 900 > 26) {
        ctx.fillStyle = o.id === selectedId ? '#ffd24a' : 'rgba(207,230,255,0.75)';
        ctx.font = '600 11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
        ctx.fillText(o.name, p.x + r + 5, p.y);
      }
    }

    // the player's ship + heading
    if (G.player && G.player.mesh) {
      const p = toScreen(view, frame, G.player.pos.x, G.player.pos.z);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-(G.player.heading || 0));
      ctx.fillStyle = '#ffffff'; ctx.beginPath();
      ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // ---- input: wheel + pinch zoom, drag pan, tap/click select ----
  const zoomBy = (f, sx, sy) => { view = zoomAtScreen(view, frame, f, sx, sy); draw(); };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    zoomBy(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  }, { passive: false });

  const pointers = new Map();   // active pointers, for pinch
  let dragStart = null, dragged = false, pinchDist = 0;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    } else { dragStart = p; dragged = false; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {                       // pinch: zoom about the midpoint
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0 && d > 0) zoomBy(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinchDist = d;
      dragged = true;
      return;
    }
    if (!dragStart) return;
    if (!dragged && exceedsSlop(dragStart.x, dragStart.y, p.x, p.y, TAP_SLOP)) dragged = true;
    if (dragged) { view = panByScreen(view, frame, p.x - prev.x, p.y - prev.y); draw(); }
  });
  const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (!dragged && dragStart) {                   // a tap, not a pan → pick a marker
        const hit = pickAt(objects, view, frame, p.x, p.y);
        if (hit) select(hit.id);
      }
      dragStart = null; dragged = false; pinchDist = 0;
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  host.querySelector('.sysnav-zoom').addEventListener('click', (e) => {
    const b = e.target.closest('[data-zoom]'); if (!b) return;
    zoomBy(b.dataset.zoom === 'in' ? 1.6 : 1 / 1.6, frame.width / 2, frame.height / 2);
  });
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-obj]'); if (b) select(b.dataset.obj);
  });
  actionsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    if (b.dataset.act === '__autopilot') {
      const o = selected();
      if (!o) return;
      if (o.locked) { hintEl.textContent = t('ui.systemmap.locked'); return; }
      onAutopilot && onAutopilot(o);
      return;
    }
    const a = actions.find((x) => x.id === b.dataset.act);
    a && a.onClick && a.onClick();
  });

  const onResize = () => { sizeCanvas(); draw(); };
  window.addEventListener('resize', onResize);

  sizeCanvas(); renderList(); renderActions(); draw();

  return {
    // re-read offers / re-localize / re-draw (the host calls this when the board or language changes)
    refresh(next = {}) {
      if ('activeMissionId' in next) activeMissionId = next.activeMissionId ?? null;
      objects = describeObjects(next.missionOffers || missionOffers, activeMissionId);
      if (next.actions) actions.splice(0, actions.length, ...next.actions);
      sizeCanvas(); renderList(); renderActions(); draw();
    },
    redraw: draw,
    getSelected: selected,
    select,
    destroy() { window.removeEventListener('resize', onResize); host.innerHTML = ''; },
  };
}

// ---------- In-world overlay (opened out of combat by the Map button / a mini-map tap) ----------
let overlayEl = null, overlayNav = null;

function buildOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.id = 'systemmap-overlay';
  overlayEl.innerHTML =
    `<div class="sysnav-head" data-i18n="ui.systemmap.title">Star system</div>`
    + `<div id="systemmap-host"></div>`;
  document.body.appendChild(overlayEl);
  return overlayEl;
}

// Open the in-world navigation screen. Freezes the game via G.mapOpen (raw loop-skip, NOT setPaused).
//   interactive: true  (roam/return-to-base) → picking a destination re-routes the autopilot; Return shown.
//   interactive: false (live fight)          → view-only (no re-route, no Return).
export function openSystemMap({ interactive = true, missionOffers = [], activeMissionId = null, onPick, onReturnToHangar } = {}) {
  buildOverlay();
  overlayEl.style.display = 'flex';
  G.mapOpen = true;
  const acts = [];
  if (interactive) {
    acts.push({ id: 'return', labelKey: 'ui.systemmap.returnHangar',
      onClick: () => { closeSystemMap(); onReturnToHangar && onReturnToHangar(); } });
  }
  acts.push({ id: 'close', labelKey: 'ui.systemmap.close', onClick: () => closeSystemMap() });
  if (overlayNav) overlayNav.destroy();
  overlayNav = mountSystemNav(document.getElementById('systemmap-host'), {
    missionOffers,
    activeMissionId,                  // marks the object your current mission is at (see describeObjects)
    actions: acts,
    onAutopilot: (obj) => { if (!interactive) return; onPick && onPick(obj); closeSystemMap(); },
  });
  applyStrings(overlayEl);
}

export function closeSystemMap() {
  if (overlayEl) overlayEl.style.display = 'none';
  G.mapOpen = false;
}
export function isSystemMapOpen() { return !!(overlayEl && overlayEl.style.display !== 'none'); }

// ---------- Arrival prompts ("Start mission?" / "Dock at the station?") ----------
// Both are the same two-button confirm; only the strings differ.
export function showDockPrompt({ onYes, onNo } = {}) {
  showStartMissionPrompt({ titleKey: 'ui.systemmap.dock', yesKey: 'ui.systemmap.dockYes', onYes, onNo });
}

let promptEl = null;
export function showStartMissionPrompt({ titleText, titleKey, yesKey, onYes, onNo } = {}) {
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
  // applyStrings just wrote the defaults from [data-i18n]; a caller-supplied key overrides them.
  promptEl.querySelector('#systemmap-prompt-title').textContent = t(titleKey || 'ui.systemmap.startMission');
  promptEl.querySelector('#systemmap-prompt-yes').textContent = t(yesKey || 'ui.systemmap.startYes');
  promptEl.querySelector('#systemmap-prompt-sub').textContent = titleText || '';
  promptEl.style.display = 'flex';
  const close = () => { promptEl.style.display = 'none'; };
  promptEl.querySelector('#systemmap-prompt-yes').onclick = () => { close(); onYes && onYes(); };
  promptEl.querySelector('#systemmap-prompt-no').onclick = () => { close(); onNo && onNo(); };
}
export function isStartMissionPromptOpen() { return !!(promptEl && promptEl.style.display !== 'none'); }

// Re-export the mission→object lookup so the mission board can route "Autopilot to destination" without
// importing the geometry module directly.
export { objectForMission };

// Localize any [data-i18n] nodes inside `root` (the overlays are built in JS, so applyTranslations in
// welcome.js doesn't see them at bootstrap).
function applyStrings(root) {
  root.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.getAttribute('data-i18n')); });
}
