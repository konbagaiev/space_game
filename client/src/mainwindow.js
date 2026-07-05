// Main Window (the between-battles / landing screen; was the "Hangar"): fixed landscape layout — a left
// menu (Missions / Loadout / Stash / Shop) + a center work zone + a 25% ship-model preview — plus the two
// spinning-model viewers (right-column ship preview #mw-ship, work-zone briefing item showcase #mw-item).
// Used on page load (homepage for the current level) and after a victory. See docs/plans/main-window-redesign.md.
//
// Part of the between-battles UI cycle: it calls into account (renderAccountBar/openAccount/
// shouldPromptAccount), welcome (requestFullscreen), shop and sim; account calls showMain back. ESM
// resolves the cycle at runtime (edges fire on user actions, not at module init). `missionOffers`/
// `mainBriefing`/`mwPreview`/`mwItem` are `export let` so the ?debug __game hook can read them live.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { G, CATALOG } from './state.js';
import { el } from './dom.js';
import { t } from './i18n.js';
import { fetchJson } from './net.js';
import { reset, levelRunner, refreshMusic } from './sim.js';
import { shipModelCfg, gltfLoader, SHIP_MODEL_LEN } from './ship-factory.js';
import { Device } from './device.js';
import { openBay, showBayView, updateTakeoffGate, renderShipStatsBar, deriveShipStats, resetShipStatsDelta } from './shop.js';
import { renderAccountBar, openAccount, shouldPromptAccount } from './account.js';
import { requestFullscreen } from './welcome.js';
import { typeText } from './typewriter.js';

const mainEl = document.getElementById('mainwin');
export let mainBriefing = null; // the campaign briefing shown as the primary mission ({ textKey, text } or null)
let mwView = 'missions';        // which work-zone view is active: 'missions' | 'bay'
let mwMission = null;           // selected side-mission offer, or null = the campaign (primary) mission
export let missionOffers = [];  // side missions from /api/players/:id/missions (unlocked after the campaign)
export let stagedActive = false; // a staged campaign-briefing reveal is animating (read by ?debug __game)
let briefingRevealDone = false;  // the current landing's campaign briefing is fully revealed (no re-animate)
let stagedFullText = '';         // the briefing text being revealed (also used by skip-to-full)
let stagedCtl = null;            // active typewriter controller
let stagedGoTimer = 0;           // the +0.5s Take-off reveal timeout handle

export function showMain(briefing) {
  // The campaign (primary) row always reflects the CURRENT level's briefing. An explicit briefing
  // (the server-derived one stashed on /advance) wins; otherwise fall back to the current level's
  // descriptor briefing so returning from a side mission (showMain(null)) doesn't blank the campaign
  // mission to the "standby" default. briefingShowcase() reads either shape (showcase or raw actions).
  mainBriefing = briefing || (CATALOG.level && CATALOG.level.briefing) || null;
  resetBriefingReveal();
  el.overlay.style.display = 'none';
  renderAccountBar();
  document.body.classList.add('menu'); // hide the in-game HUD behind the Main Window
  refreshMusic();                      // menu → calmer hangar music
  mainEl.classList.add('on');
  mwMission = null;                    // default to the primary (campaign) mission
  buildMissionList();                  // primary row + any cached secondary rows
  selectMenu('missions');              // open the mission view (renders the campaign briefing)
  openBay();                           // load shop state + gate the Loadout/Stash/Shop menu items
  refreshMissions();                   // (re)load the side missions, then rebuild the list
  // ship-characteristics strip above the model — always, not only when the shop is open (the shop
  // re-renders it with ▲/▼ deltas on each change via renderBay).
  if (G.activeShip && G.activeShip.components) {
    resetShipStatsDelta();
    renderShipStatsBar(deriveShipStats(G.activeShip.components, G.activeShip.loadout && G.activeShip.loadout.mounts));
  }
  startShipPreview();                       // spin up the right-column ship model (hidden by CSS while staging)
  if (!stagedActive) applyPreviewTarget();  // when staging, the reveal defers the preview/showcase itself
}
function launchCampaign() {
  G.pendingBriefing = null;
  G.activeMission = null;                       // the primary "Take off" plays the campaign level, not a side mission
  if (Device.hasTouch) requestFullscreen();          // hide mobile browser chrome (must be in the click gesture)
  mainEl.classList.remove('on');
  stopShipPreview();
  settleBriefingReveal();                    // stop a stray timer/rAF from toggling classes after close
  stopViewer(mwItem);                        // stop the work-zone item showcase too
  document.body.classList.remove('menu');    // restore the in-game HUD
  G.gameStarted = true;                        // first launch from the landing Main Window starts the loop
  reset();                                   // (re)start the current level
}
function leaveOverlay() {
  if (levelRunner.won) {
    // After clearing level 1, prompt once for a username + optional account (DECISIONS §11), then
    // continue to the Main Window. Otherwise (or once prompted/registered) go straight there.
    if (shouldPromptAccount()) { openAccount('prompt', { after: () => showMain(G.pendingBriefing) }); return; }
    showMain(G.pendingBriefing); return; // victory → Main Window
  }
  reset(); // loss → straight retry
}
el.restart.addEventListener('click', leaveOverlay);
// "Back to Main Window" on the death overlay (shop unlocked): banked credits already applied → go back
// to the menu (shop/loadout), where Take off retries the mission.
el.backHangar.addEventListener('click', () => { el.overlay.style.display = 'none'; showMain(null); });

// ---- Left-menu navigation + the work-zone views ----
// Show one work-zone view and highlight its menu item. 'missions' → the mission view (description +
// Take-off); 'loadout'|'stash'|'shop' → the shop bay view with that screen selected.
function selectMenu(which) {
  document.querySelectorAll('#mw-menu .mw-item').forEach((b) => b.classList.toggle('active', b.dataset.mw === which));
  const isMissions = which === 'missions';
  mwView = isMissions ? 'missions' : 'bay';
  document.getElementById('mw-view-mission').classList.toggle('active', isMissions);
  document.getElementById('mw-view-bay').classList.toggle('active', !isMissions);
  if (isMissions) { buildMissionList(); renderMissionView(mwMission); }
  else { settleBriefingReveal(); showBayView(which); stopViewer(mwItem); } // bay view hides the mission canvas → idle the loop
}
document.getElementById('mw-menu').addEventListener('click', (e) => {
  const b = e.target.closest('.mw-item');
  if (b) selectMenu(b.dataset.mw);
});
// Collapse/expand the mission sublist (the caret left of "Missions").
document.getElementById('mw-missions-toggle').addEventListener('click', () => {
  const g = document.getElementById('mw-missions-group');
  const collapsed = g.dataset.collapsed === '1';
  g.dataset.collapsed = collapsed ? '0' : '1';
  const tog = document.getElementById('mw-missions-toggle');
  tog.textContent = collapsed ? '▾' : '▸';
  tog.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
});

// Build the mission sublist: the campaign (primary) row, then the side missions (secondary, when
// unlocked). Selecting a row renders it into the work zone via selectMenu('missions').
function buildMissionList() {
  const host = document.getElementById('mw-mission-list');
  if (!host) return;
  host.innerHTML = '';
  const prim = document.createElement('button');
  prim.className = 'mw-sub' + (mwMission == null ? ' active' : '');
  prim.textContent = t('ui.mainwin.primary');
  prim.addEventListener('click', () => { mwMission = null; selectMenu('missions'); });
  host.appendChild(prim);
  missionOffers.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = 'mw-sub' + (mwMission === m ? ' active' : '');
    b.textContent = t('ui.mission.slot', { n: i + 1 });
    b.addEventListener('click', () => { mwMission = m; selectMenu('missions'); });
    host.appendChild(b);
  });
}

function clearStagedReveal() {
  if (stagedCtl) { stagedCtl.cancel(); stagedCtl = null; }
  if (stagedGoTimer) { clearTimeout(stagedGoTimer); stagedGoTimer = 0; }
}
// New landing (showMain): allow the staged reveal to play once.
function resetBriefingReveal() {
  clearStagedReveal();
  mainEl.classList.remove('briefing-hide-ship', 'briefing-hide-go');
  stagedActive = false; briefingRevealDone = false;
}
// Leaving the mission view / launching: stop any animation, drop the hide classes, and mark the briefing
// revealed so returning to the mission view shows the full state (no replay).
function settleBriefingReveal() {
  clearStagedReveal();
  mainEl.classList.remove('briefing-hide-ship', 'briefing-hide-go');
  stagedActive = false; briefingRevealDone = true;
}
// The current campaign level number (1..N) from the descriptor title ("Level 1".."Level 4" — a stable,
// non-localized field set in catalog_seed.js). null if unknown.
function campaignLevelIndex() {
  const m = /(\d+)/.exec((CATALOG.level && CATALOG.level.title) || '');
  return m ? parseInt(m[1], 10) : null;
}
// Staged reveal applies only to the CAMPAIGN (primary) briefing on levels 1-3 (not L4+, not side missions).
function stagedBriefingActive() {
  const lvl = campaignLevelIndex();
  return mwMission == null && lvl != null && lvl <= 3;
}
// Show the fully-revealed state at once (skip-on-tap + re-renders after the reveal has played).
function revealBriefingNow() {
  clearStagedReveal();
  document.getElementById('mw-mission-text').textContent = stagedFullText;
  mainEl.classList.remove('briefing-hide-ship', 'briefing-hide-go');
  applyPreviewTarget();          // ship preview + the granted-item showcase (if any)
  stagedActive = false; briefingRevealDone = true;
}
// Staged sequence: typewriter (~5s) → ship window + showcase in → +0.5s Take-off in.
function startStagedReveal() {
  clearStagedReveal();
  stagedActive = true; briefingRevealDone = false;
  const textEl = document.getElementById('mw-mission-text');
  mainEl.classList.add('briefing-hide-ship', 'briefing-hide-go'); // hide ship window + Take-off while typing
  showShowcaseItem(null);        // hold the work-zone granted-item showcase during typing
  previewShip();                 // preload the ship model behind the hidden panel (no hitch at reveal)
  stagedCtl = typeText(textEl, stagedFullText, { total: 5000, onDone: () => {
    mainEl.classList.remove('briefing-hide-ship');  // ship window fades in…
    applyPreviewTarget();                            // …together with the granted-item showcase (L2/L3)
    stagedGoTimer = setTimeout(() => {               // Take-off 0.5s later
      stagedGoTimer = 0;
      mainEl.classList.remove('briefing-hide-go');
      stagedActive = false; briefingRevealDone = true;
    }, 500);
  }});
}

// Render the selected mission into the work zone. null → the campaign (primary) briefing + launchCampaign;
// otherwise a side mission's flavor + est. reward + launchMission.
function renderMissionView(m) {
  const titleEl = document.getElementById('mw-mission-title');
  const textEl = document.getElementById('mw-mission-text'); // text span beside the floated item canvas
  const rewEl = document.getElementById('mw-mission-reward');
  if (m) {
    titleEl.textContent = t(m.titleKey);
    textEl.textContent = t(m.descKey);
    rewEl.textContent = t('ui.mission.est_reward', { credits: m.estReward });
    rewEl.style.display = '';
    previewShip();            // a side mission grants nothing → show the ship, not a campaign showcase item
    showShowcaseItem(null);   // …and hide the work-zone item showcase
  } else {
    titleEl.textContent = t('ui.mainwin.primary');
    stagedFullText = mainBriefing
      ? (mainBriefing.textKey ? t(mainBriefing.textKey) : (mainBriefing.text || ''))
      : t('ui.hangar.default');
    rewEl.textContent = '';
    rewEl.style.display = 'none';
    if (stagedActive) {
      /* a reveal is already animating this landing — leave it in control of text/preview/showcase */
    } else if (stagedBriefingActive() && !briefingRevealDone) {
      startStagedReveal();
    } else {
      textEl.textContent = stagedFullText;
      applyPreviewTarget();     // primary row → the campaign briefing's showcase item (if any), else the ship
    }
  }
  updateTakeoffGate(G.activeShip);
}
// The single Take-off button in the mission view dispatches on the current selection.
document.getElementById('mw-go').addEventListener('click', () => {
  if (mwMission) launchMission(mwMission);
  else launchCampaign();
});
// Tap the briefing text while it's staging → skip to full text + reveal ship window & Take-off at once.
document.getElementById('mw-mission-desc').addEventListener('click', () => {
  if (stagedActive) revealBriefingNow();
});

// Reload the side missions (gated to the shop being unlocked), then rebuild the list + re-render if
// the mission view is open.
export async function refreshMissions() {
  const unlocked = !!(G.playerId && G.activeShip && G.activeShip.shopUnlocked);
  if (!unlocked) { missionOffers = []; buildMissionList(); return; }
  try {
    const data = await fetchJson(`/api/players/${G.playerId}/missions`);
    missionOffers = data.missions || [];
  } catch { missionOffers = []; }
  buildMissionList();
  if (mwView === 'missions') renderMissionView(mwMission);
}
// Launch a chosen side mission (mirrors launchCampaign, but plays the mission descriptor).
export function launchMission(m) {
  G.activeMission = m.descriptor;
  G.pendingBriefing = null;
  if (Device.hasTouch) requestFullscreen();
  mainEl.classList.remove('on');
  stopShipPreview();
  settleBriefingReveal();              // stop a stray timer/rAF from toggling classes after close
  stopViewer(mwItem);                  // stop the work-zone item showcase too
  document.getElementById('welcome').style.display = 'none';
  document.body.classList.remove('menu');
  G.gameStarted = true;
  reset();
}

// ---------- Main Window ship-model preview (right column) ----------
// A small, self-contained Three.js view (its own scene/camera/renderer on #mw-ship) that shows the
// player's active ship — the high-poly `_hangar` glb (model_url_high), falling back to the combat model.
// Its render loop only runs while the Main Window is visible (started/stopped by showMain/launch*), so it
// costs nothing during a fight. See docs/plans/main-window-redesign.md (§ ship preview) + DECISIONS.
// Build a self-contained spinning-model viewer on a canvas: renderer + scene + key/ambient light +
// optional RoomEnvironment PMREM + a rotating group. Two instances exist — the right-column ship
// preview (#mw-ship) and the work-zone briefing item showcase (#mw-item). Returns the viewer object.
function buildModelViewer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: G.gfx.antialias, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio, G.gfx.pixelRatioCap));
  const sc = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  cam.position.set(0, 1.4, 7);
  cam.lookAt(0, 0, 0);
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 5, 4); sc.add(key);
  sc.add(new THREE.AmbientLight(0x4a5878, 1.4));
  if (G.gfx.envMap) { // same RoomEnvironment reflections as the combat scene (a fresh PMREM per GL context)
    const pm = new THREE.PMREMGenerator(r);
    sc.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
  }
  const group = new THREE.Group(); sc.add(group);
  return { renderer: r, scene: sc, camera: cam, group, raf: 0, url: null };
}
// Start a viewer's auto-rotate render loop (idempotent — no-op if already running).
function startViewer(v) {
  if (!v || v.raf) return;
  const loop = () => {
    v.raf = requestAnimationFrame(loop);
    v.group.rotation.y += 0.01; // slow auto-rotate
    v.renderer.render(v.scene, v.camera);
  };
  loop();
}
function stopViewer(v) { if (v && v.raf) { cancelAnimationFrame(v.raf); v.raf = 0; } }
function resizeViewer(v) {
  if (!v) return;
  const canvas = v.renderer.domElement;
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
  v.renderer.setSize(w, h, false); // false: don't override the CSS-driven canvas size
  v.camera.aspect = w / h;
  v.camera.updateProjectionMatrix();
}

export let mwPreview = null; // right-column ship viewer — built lazily on the first showMain
function startShipPreview() {
  const canvas = document.getElementById('mw-ship');
  if (!canvas) return;
  if (!mwPreview) mwPreview = buildModelViewer(canvas);
  loadPreviewModel();
  resizeViewer(mwPreview);
  startViewer(mwPreview);
}
function stopShipPreview() { stopViewer(mwPreview); }
// yaw/scale for an ITEM (weapon/component) preview; mirrors shipModelCfg's defaults. Tolerant of both
// catalog shapes: components keep `stats.model`, the flattened weapon entry has `model` at the top level.
const itemModelCfg = (item) => {
  const m = (item && (item.model || (item.stats && item.stats.model))) || {};
  return { yaw: m.yaw ?? 0, scale: m.scale ?? 1, scaleMul: m.scaleMul ?? 1 };
};
// Show an arbitrary glb in a viewer — a ship OR an item. Normalizes the longest axis to SHIP_MODEL_LEN,
// recenters, applies the cfg yaw + scale; tint stays off (glbs bake their own colors). No-op if the same
// url is already shown. cfg = { yaw, scale, scaleMul }.
function setViewerModel(v, url, cfg = {}) {
  if (!v || !url || url === v.url) return;
  v.url = url;
  const clear = () => { for (let i = v.group.children.length - 1; i >= 0; i--) v.group.remove(v.group.children[i]); };
  clear();
  gltfLoader.load(url, (gltf) => {
    if (!v || v.url !== url) return; // target changed mid-load
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = (SHIP_MODEL_LEN / (Math.max(size.x, size.y, size.z) || 1)) * (cfg.scale ?? 1) * (cfg.scaleMul ?? 1);
    model.scale.setScalar(s);
    model.position.copy(center).multiplyScalar(-s);
    const pivot = new THREE.Group();
    pivot.rotation.y = cfg.yaw || 0;
    pivot.add(model);
    clear();
    v.group.add(pivot);
  }, undefined, (err) => console.warn('Preview model failed to load:', url, err));
}
// The right-column ship preview is the default consumer of the viewer setter.
function setPreviewModel(url, cfg = {}) { setViewerModel(mwPreview, url, cfg); }
// Default the preview to the player's active ship (the briefing showcase swaps in an item via setPreviewModel).
function loadPreviewModel() {
  if (!mwPreview || !G.activeShip || !G.activeShip.ship) return;
  const ship = G.activeShip.ship;
  setPreviewModel(ship.modelUrlHigh || ship.modelUrl, shipModelCfg(ship.stats));
}
// Point the preview at the right thing: the item a showcase briefing grants (Machine Gun on L2, Repair
// drone on L3 — server attaches `showcase {kind,id}` to the briefing), else the active ship. The catalog
// already carries the item model URLs (foundation brief). Falls back to the ship if the item has no model.
function previewShip() {
  if (G.activeShip && G.activeShip.ship) setPreviewModel(G.activeShip.ship.modelUrlHigh || G.activeShip.ship.modelUrl, shipModelCfg(G.activeShip.ship.stats));
}
// The showcased item for a briefing. The server attaches `showcase {kind,id}` on the /advance path (where
// it strips `actions`); on a fresh page-load landing the client gets the raw descriptor briefing instead
// (has `actions`, no `showcase`), so derive it from the actions as a fallback — both paths then work.
function briefingShowcase(b) {
  if (!b) return null;
  if (b.showcase) return b.showcase;
  for (const a of (b.actions || [])) {
    if (a.type === 'replaceWeapon') return { kind: 'weapon', id: a.to };
    if (a.type === 'installComponent') return { kind: 'component', id: a.component };
  }
  return null;
}
function applyPreviewTarget() {
  previewShip();                                    // the right-column preview ALWAYS shows the active ship
  showShowcaseItem(briefingShowcase(mainBriefing)); // the granted item (if any) shows in the work zone instead
}

// ---------- Work-zone briefing item showcase (#mw-item) ----------
// A second viewer floated into the BOTTOM-RIGHT corner of the mission text (the text wraps around it),
// showing the 3D model of the gear a campaign briefing grants — Machine Gun on L2, Repair drone on L3 — at
// full size, WITHOUT replacing the ship in the right-column preview. Hidden when the briefing grants nothing.
const ITEM_SHOWCASE_SCALE = 1; // full size — the model fills the bottom-right showcase canvas
export let mwItem = null; // work-zone item viewer — built lazily the first time a showcase item is shown
// Show the granted item in the work-zone viewer, or hide it when there's none (side mission / L1 / L4).
function showShowcaseItem(sc) {
  const canvas = document.getElementById('mw-item');
  const desc = document.getElementById('mw-mission-desc');
  if (!canvas) return;
  const item = sc ? (sc.kind === 'weapon' ? CATALOG.weapons.get(sc.id) : CATALOG.components.get(sc.id)) : null;
  if (item && item.modelUrlHigh) {
    if (!mwItem) mwItem = buildModelViewer(canvas);
    const cfg = itemModelCfg(item);
    setViewerModel(mwItem, item.modelUrlHigh, { ...cfg, scaleMul: (cfg.scaleMul ?? 1) * ITEM_SHOWCASE_SCALE });
    if (desc) desc.classList.add('show-item'); // reveals the strut + canvas (CSS) → floats into the corner
    resizeViewer(mwItem);
    startViewer(mwItem);
  } else {
    if (desc) desc.classList.remove('show-item');
    stopViewer(mwItem);
  }
}
// Keep both preview canvases crisp as the layout reflows (the grid columns resize with window/rotation).
function resizeViewers() { resizeViewer(mwPreview); resizeViewer(mwItem); }
window.addEventListener('resize', resizeViewers);
window.addEventListener('orientationchange', resizeViewers);
