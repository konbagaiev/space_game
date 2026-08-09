// Main Window (the between-battles / landing screen; was the "Hangar"): fixed landscape layout — a left
// menu (Character / Missions / Loadout / Map / Craft) + a center work zone + a PER-VIEW right column
// (the mission list on Missions, the Loadout context panel on Loadout, absent elsewhere). Missions is a
// right-column list of cards + the briefing body in the work zone (this file); Loadout is the ship+slots
// screen (shop.js); the spinning-model viewers live in model-viewer.js (work-zone item showcase #mw-item
// and the Loadout ship/item viewers). Used on page load (current level) and after a victory.
//
// Part of the between-battles UI cycle: it calls into account (renderAccountBar/openAccount/
// shouldPromptAccount), welcome (requestFullscreen), shop and sim; account calls showMain back. ESM
// resolves the cycle at runtime (edges fire on user actions, not at module init). `missionOffers`/
// `mainBriefing`/`mwItem` are `export let` so the ?debug __game hook can read them live.
import { G, CATALOG } from './state.js';
import { el } from './dom.js';
import { t } from './i18n.js';
import { fetchJson, clientLog } from './net.js';
import { API_BASE } from './api-base.js';
import { esc } from './format.js';
import { SKILL_RATES } from './components.js'; // per-point skill rates → Character-card effect text (single source)
import { reset, levelRunner, refreshMusic, engagePointAutopilot } from './sim.js';
import { mountBaseMenuMap, showStartMissionPrompt } from './systemmap-ui.js';
import { buildModelViewer, startViewer, stopViewer, resizeViewer, setViewerModel, itemModelCfg } from './model-viewer.js';
import { Device } from './device.js';
import { openBay, showBayView, updateTakeoffGate, resetShipStatsDelta, stopLoadoutPreview } from './shop.js';
import { renderAccountBar, openAccount, shouldPromptAccount, getPlayerShips } from './account.js';
import { updateMenuCredits } from './hud.js';
import { requestFullscreen, showWelcome } from './welcome.js';
import { typeText } from './typewriter.js';
import { beginLiveSession } from './main.js'; // arm the always-on session recorder at each campaign launch/retry (called on click; ESM cycle resolves by call time)

const mainEl = document.getElementById('mainwin');
export let mainBriefing = null; // the campaign briefing shown as the primary mission ({ textKey, text } or null)
let mwView = 'missions';        // which work-zone view is active: 'missions' | 'bay'
let mwMission = null;           // selected side-mission offer (for the detail view), or null = the campaign
export let missionOffers = [];  // side missions from /api/players/:id/missions (unlocked after "Level 3" — DECISIONS §91)
let takenIds = new Set();       // ids of side missions the player has taken (accepted onto the board)
export let activeMissionId = null; // the ONE mission Take-off flies (null = the campaign / "Main operation")
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
  updateMenuCredits();                 // top-bar balance beside "Ships" (openBay refreshes it from the server)
  document.body.classList.add('menu'); // hide the in-game HUD behind the Main Window
  refreshMusic();                      // menu → calmer hangar music
  mainEl.classList.add('on');
  mwMission = null;                    // default to the primary (campaign) mission
  renderMissionsBoard();               // campaign card + any cached side-mission cards
  updateGoButton();
  selectMenu('missions');              // open the mission view (renders the campaign briefing)
  openBay();                           // load shop state + gate the Loadout/Stash/Shop menu items
  refreshMissions();                   // (re)load the side missions, then rebuild the list
  if (G.activeShip && G.activeShip.components) resetShipStatsDelta(); // Loadout's ▲/▼ baseline starts clean each landing
  if (!stagedActive) applyShowcaseTarget();  // when staging, the reveal defers the granted-item showcase itself
}
function launchCampaign() {
  clientLog('takeoff:campaign', { level: CATALOG.level && CATALOG.level.title, name: CATALOG.levelName }); // TEMP debug: what level reset() will play
  G.pendingBriefing = null;
  G.activeMission = null;                       // the primary "Take off" plays the campaign level, not a side mission
  if (Device.hasTouch) requestFullscreen();          // hide mobile browser chrome (must be in the click gesture)
  mainEl.classList.remove('on');
  stopLoadoutPreview();
  settleBriefingReveal();                    // stop a stray timer/rAF from toggling classes after close
  stopViewer(mwItem);                        // stop the work-zone item showcase too
  document.body.classList.remove('menu');    // restore the in-game HUD
  G.gameStarted = true;                        // first launch from the landing Main Window starts the loop
  beginLiveSession();                          // arm the recorded live session (seeds the sim) BEFORE reset() draws the RNG
  reset();                                   // (re)start the current level
}
function leaveOverlay() {
  if (levelRunner.won) {
    // Land on the now-current level after a victory. A level WITH a briefing → the Main Window briefing; a
    // level WITHOUT one → the Welcome / take-off screen — same rule bootstrap + account use, so Continue
    // matches a page reload (never the "Stand by for new orders" default that showMain(null) would render).
    // NB with current content every campaign level 2+ HAS a briefing (level-1 is the intro/Level 0), so the
    // post-intro Level-1 (seed `level-2`) lands on the Main Window (launchCampaign), NOT welcome; the welcome
    // branch is a fallback for a briefing-less level.
    const brief = G.pendingBriefing || (CATALOG.level && CATALOG.level.briefing) || null;
    const land = () => { if (brief) showMain(brief); else showWelcome(getPlayerShips()); };
    // After clearing level 1, prompt once for a username + optional account (DECISIONS §11), then land.
    if (shouldPromptAccount()) { openAccount('prompt', { after: land }); return; }
    land(); return;
  }
  if (!G.activeMission) beginLiveSession(); // campaign-only: a side-mission retry stays unrecorded (its descriptor isn't refetchable for playback)
  reset(); // loss → straight retry
}
el.restart.addEventListener('click', leaveOverlay);
// "Back to Main Window" on the death overlay (shop unlocked): banked credits already applied → go back
// to the menu (shop/loadout), where Take off retries the mission.
el.backHangar.addEventListener('click', () => { el.overlay.style.display = 'none'; showMain(null); });

// ---- Left-menu navigation + the work-zone views ----
// Show one work-zone view and highlight its menu item. 'missions' → the mission view (description +
// Take-off); 'loadout'|'stash'|'shop' → the shop bay view with that screen selected.
const STUB_SECTIONS = ['craft']; // not-yet-built sections → a "coming soon" stub panel (Map is now real)
function selectMenu(which) {
  document.querySelectorAll('#mw-menu .mw-item').forEach((b) => b.classList.toggle('active', b.dataset.mw === which));
  const isMissions = which === 'missions';
  const isBay = which === 'loadout';   // Loadout absorbs the former Stash/Shop items as in-bay tabs
  const isCharacter = which === 'character';
  const isMap = which === 'map';
  const isStub = STUB_SECTIONS.includes(which);
  mwView = isBay ? 'bay' : (isMissions ? 'missions' : (isCharacter ? 'character' : (isMap ? 'map' : 'stub')));
  document.getElementById('mw-view-mission').classList.toggle('active', isMissions);
  document.getElementById('mw-view-bay').classList.toggle('active', isBay);
  document.getElementById('mw-view-character').classList.toggle('active', isCharacter);
  document.getElementById('mw-view-map').classList.toggle('active', isMap);
  document.getElementById('mw-view-stub').classList.toggle('active', isStub);
  mainEl.classList.toggle('bay-open', isBay); // Loadout centers the ship + swaps the right column to its panel
  mainEl.classList.toggle('missions-open', isMissions); // Missions shows the mission list in the right column
  // Exactly ONE ship viewer runs per view (DECISIONS §92): Loadout owns the centered-ship + item-model
  // viewers; every other view runs none (the right-column ship preview was removed). Stopping the
  // off-view viewers is what keeps the spin smooth.
  if (!isBay) stopLoadoutPreview();
  if (isMissions) { renderMissionsBoard(); renderMissionView(mwMission); }
  else if (isBay) { settleBriefingReveal(); showBayView('loadout'); stopViewer(mwItem); } // bay hides the mission canvas → idle the loop
  else if (isCharacter) { settleBriefingReveal(); renderCharacter(); stopViewer(mwItem); }
  else if (isMap) { settleBriefingReveal(); renderMapView(); stopViewer(mwItem); }
  else { settleBriefingReveal(); renderStub(which); stopViewer(mwItem); }
}
// Base-menu Map: the flyable star-system overview. "Launch into system" → free roam; each reachable
// mission destination → roam + autopilot there. Both hand off to enterRoam (the one roam entry point).
function renderMapView() {
  mountBaseMenuMap(document.getElementById('mw-view-map'), {
    missionOffers,
    onLaunch: () => enterRoam(null),
    onFlyHere: (dest) => enterRoam(dest),
  });
}
// Render a placeholder panel for a not-yet-built section (Map / Craft — see the redesign plan).
function renderStub(which) {
  document.getElementById('mw-stub-title').textContent = t(`ui.mainwin.${which}`);
  document.getElementById('mw-stub-text').textContent = t(`ui.stub.${which}`);
}

// ---- Character screen (docs/plans/2026-08-09-character-progression.md) ----
// Level + XP bar + unspent skill points, then the five skill cards. Effect NUMBERS come from
// components.js SKILL_RATES (single source shared with the sim); the "+" buttons POST /skills/spend.
const SKILL_CARDS = ['kinetic', 'rocket', 'shields', 'maneuver', 'mobility']; // card order = server SKILLS order
// The interpolation params for the localized card descriptions (percent rates are stored as fractions).
function skillDescParams() {
  return {
    kineticDmg: Math.round(SKILL_RATES.kineticDmgPct * 100), aim: SKILL_RATES.aimAssistDeg,
    rocketDmg: Math.round(SKILL_RATES.rocketDmgPct * 100), rocketSpeed: Math.round(SKILL_RATES.rocketSpeedPct * 100),
    shield: Math.round(SKILL_RATES.shieldPct * 100), dodge: SKILL_RATES.dodgePctPerPt,
    mobility: Math.round(SKILL_RATES.mobilityPct * 100),
  };
}
function renderCharacter() {
  const host = document.getElementById('mw-character');
  if (!host) return;
  const prog = (G.activeShip && G.activeShip.progression)
    || { level: 0, xpIntoLevel: 0, xpForNextLevel: 1000, skillPoints: 0, skills: {} };
  const p = skillDescParams();
  const pct = prog.xpForNextLevel > 0 ? Math.max(0, Math.min(100, Math.round(100 * prog.xpIntoLevel / prog.xpForNextLevel))) : 0;
  const header = `<div id="ch-head">
    <div class="ch-level"><span class="ch-level-num">${esc(t('ui.character.level', { level: prog.level }))}</span>
      <span class="ch-points${prog.skillPoints > 0 ? ' has' : ''}">${esc(t('ui.character.points', { points: prog.skillPoints }))}</span></div>
    <div class="ch-xpbar"><div class="ch-xpfill" style="width:${pct}%"></div>
      <span class="ch-xptext">${esc(t('ui.character.xp', { into: prog.xpIntoLevel, span: prog.xpForNextLevel }))}</span></div>
  </div>`;
  const canSpend = prog.skillPoints > 0;
  const cards = SKILL_CARDS.map((key) => {
    const lvl = (prog.skills && prog.skills[key]) || 0;
    const plus = `<button class="ch-plus" data-skill="${esc(key)}"${canSpend ? '' : ' disabled'}>+</button>`;
    return `<div class="skill-card">
      <div class="sc-top"><span class="sc-name">${esc(t('ui.skill.' + key + '.name'))}</span><span class="sc-pts">${lvl}</span></div>
      <div class="sc-desc">${esc(t('ui.skill.' + key + '.desc', p))}</div>
      <div class="sc-foot">${plus}</div>
    </div>`;
  }).join('');
  host.innerHTML = header + `<div id="ch-cards">${cards}</div>`;
}
// Spend one skill point → POST, adopt the fresh progression from the response, re-render.
async function skillSpend(skill) {
  if (!G.playerId) return;
  try {
    const r = await fetch(API_BASE + `/api/players/${G.playerId}/skills/spend`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skill }) });
    if (!r.ok) return; // no points / unknown skill → ignore
    const j = await r.json().catch(() => ({}));
    if (j.progression && G.activeShip) G.activeShip.progression = j.progression;
    renderCharacter();
  } catch { /* network hiccup → leave the panel as-is */ }
}
document.getElementById('mw-character').addEventListener('click', (e) => {
  const btn = e.target.closest('.ch-plus');
  if (btn && !btn.disabled) skillSpend(btn.dataset.skill);
});
document.getElementById('mw-menu').addEventListener('click', (e) => {
  const b = e.target.closest('.mw-item');
  if (b) selectMenu(b.dataset.mw);
});
// ---- Mission board (docs/plans/2026-08-08-base-menu-redesign.md, Slice B) ----
// A central board of cards — the campaign ("Main operation") + the side missions — each with
// Take / Defer / Set-active controls + status badges. Clicking a card shows its briefing in the detail
// area below; Take-off flies the ACTIVE mission (server-persisted, one at a time).
function mcBtn(act, id, labelKey, cls = '') {
  return `<button data-mact="${act}"${id ? ` data-mid="${esc(id)}"` : ''} class="${cls}">${esc(t(labelKey))}</button>`;
}
function missionCard(c) {
  const badge = c.active ? `<span class="mc-badge active">${esc(t('ui.mission.active'))}</span>`
    : (c.taken && c.id != null ? `<span class="mc-badge taken">${esc(t('ui.mission.taken'))}</span>` : '');
  const acts = [];
  if (c.id == null) {                                   // campaign: only "Set active" when not active
    if (!c.active) acts.push(mcBtn('activate', null, 'ui.mission.set_active', 'primary'));
  } else if (!c.taken) {                                 // side, not taken → Take
    acts.push(mcBtn('take', c.id, 'ui.mission.take', 'primary'));
  } else {                                               // side, taken → Set active (if not) + Defer
    if (!c.active) acts.push(mcBtn('activate', c.id, 'ui.mission.set_active', 'primary'));
    acts.push(mcBtn('defer', c.id, 'ui.mission.defer'));
  }
  const sub = c.subtitle ? `<div class="mc-sub">${esc(c.subtitle)}</div>`
    : (c.reward != null ? `<div class="mc-sub">${esc(t('ui.mission.est_reward', { credits: c.reward }))}${c.xp != null ? ' · ' + esc(t('ui.mission.est_xp', { xp: c.xp })) : ''}</div>` : '');
  return `<div class="mission-card${c.active ? ' active' : ''}${c.selected ? ' selected' : ''}" data-msel="${c.id == null ? 'campaign' : esc(c.id)}">
    <div class="mc-main"><div class="mc-title">${esc(c.title)}</div>${sub}</div>
    ${badge}
    <div class="mc-actions">${acts.join('')}</div>
  </div>`;
}
// Render the board: the campaign card, then each side-mission offer (present once the board unlocks).
function renderMissionsBoard() {
  const host = document.getElementById('mw-mission-board');
  if (!host) return;
  const cards = [missionCard({
    id: null, title: t('ui.mainwin.primary'), subtitle: (CATALOG.level && CATALOG.level.title) || '',
    reward: null, taken: true, active: activeMissionId == null, selected: mwMission == null,
  })];
  for (const m of missionOffers) cards.push(missionCard({
    id: m.id, title: t(m.titleKey), reward: m.estReward, xp: m.estXp,
    taken: takenIds.has(m.id), active: activeMissionId === m.id, selected: mwMission === m,
  }));
  host.innerHTML = cards.join('');
}
// Take-off launches the ACTIVE mission — reflect which one that is on the button.
function updateGoButton() {
  const btn = document.getElementById('mw-go');
  if (!btn) return;
  const m = activeMissionId == null ? null : missionOffers.find((o) => o.id === activeMissionId);
  btn.textContent = m ? t('ui.button.take_off_mission', { mission: t(m.titleKey) }) : t('ui.button.take_off');
}
// Take / defer / activate a mission → POST, then re-render the board + Take-off from the fresh state.
async function missionAction(act, missionId) {
  if (!G.playerId) return;
  try {
    const r = await fetch(API_BASE + `/api/players/${G.playerId}/missions/${act}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ missionId }) });
    if (!r.ok) return;                                   // locked / unknown id → ignore (v1)
    const j = await r.json().catch(() => ({}));
    takenIds = new Set(j.taken || []);
    activeMissionId = j.activeMissionId ?? null;
    renderMissionsBoard();
    updateGoButton();
  } catch { /* network hiccup → leave the board as-is */ }
}
// Board clicks: an action button (take/defer/activate) or selecting a card (shows its detail).
document.getElementById('mw-mission-board').addEventListener('click', (e) => {
  const actBtn = e.target.closest('[data-mact]');
  if (actBtn) { e.stopPropagation(); missionAction(actBtn.dataset.mact, actBtn.dataset.mid || null); return; }
  const card = e.target.closest('.mission-card');
  if (!card) return;
  const sel = card.dataset.msel;
  mwMission = sel === 'campaign' ? null : (missionOffers.find((m) => m.id === sel) || null);
  renderMissionsBoard();
  renderMissionView(mwMission);
});

function clearStagedReveal() {
  if (stagedCtl) { stagedCtl.cancel(); stagedCtl = null; }
  if (stagedGoTimer) { clearTimeout(stagedGoTimer); stagedGoTimer = 0; }
}
// New landing (showMain): allow the staged reveal to play once.
function resetBriefingReveal() {
  clearStagedReveal();
  mainEl.classList.remove('briefing-hide-go');
  stagedActive = false; briefingRevealDone = false;
}
// Leaving the mission view / launching: stop any animation, drop the hide classes, and mark the briefing
// revealed so returning to the mission view shows the full state (no replay).
function settleBriefingReveal() {
  clearStagedReveal();
  mainEl.classList.remove('briefing-hide-go');
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
  mainEl.classList.remove('briefing-hide-go');
  applyShowcaseTarget();         // the granted-item showcase (if any)
  stagedActive = false; briefingRevealDone = true;
}
// Staged sequence: typewriter (~5s) → granted-item showcase in → +0.5s Take-off in (the mission list
// stays visible throughout).
function startStagedReveal() {
  clearStagedReveal();
  stagedActive = true; briefingRevealDone = false;
  const textEl = document.getElementById('mw-mission-text');
  mainEl.classList.add('briefing-hide-go'); // hide Take-off while typing (the mission list stays visible)
  showShowcaseItem(null);        // hold the work-zone granted-item showcase during typing
  stagedCtl = typeText(textEl, stagedFullText, { total: 5000, onDone: () => {
    applyShowcaseTarget();                           // the granted item (L2/L3) fades into the work zone…
    stagedGoTimer = setTimeout(() => {               // …Take-off 0.5s later
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
    rewEl.textContent = t('ui.mission.est_reward', { credits: m.estReward })
      + (m.estXp != null ? ' · ' + t('ui.mission.est_xp', { xp: m.estXp }) : '');
    rewEl.style.display = '';
    showShowcaseItem(null);   // a side mission grants nothing → hide the work-zone item showcase
  } else {
    titleEl.textContent = t('ui.mainwin.primary');
    stagedFullText = mainBriefing
      ? (mainBriefing.textKey ? t(mainBriefing.textKey) : (mainBriefing.text || ''))
      : t('ui.hangar.default');
    rewEl.textContent = '';
    rewEl.style.display = 'none';
    if (stagedActive) {
      /* a reveal is already animating this landing — leave it in control of the text/showcase */
    } else if (stagedBriefingActive() && !briefingRevealDone) {
      startStagedReveal();
    } else {
      textEl.textContent = stagedFullText;
      applyShowcaseTarget();    // primary row → the campaign briefing's showcase item (if any)
    }
  }
  updateTakeoffGate(G.activeShip);
}
// The single Take-off button launches the ACTIVE mission (not the merely-selected one): the campaign
// when nothing is active, else the active side mission (find its offer for the descriptor to play).
document.getElementById('mw-go').addEventListener('click', () => {
  if (activeMissionId == null) return launchCampaign();
  const m = missionOffers.find((o) => o.id === activeMissionId);
  if (m) launchMission(m); else launchCampaign();       // active offer missing (stale) → safe fallback
});
// Tap the briefing text while it's staging → skip to full text + reveal ship window & Take-off at once.
document.getElementById('mw-mission-desc').addEventListener('click', () => {
  if (stagedActive) revealBriefingNow();
});

// Reload the side-mission board (offers + taken set + active), then re-render the board + detail.
export async function refreshMissions() {
  // Side missions open LATER than the shop (after "Level 3" — DECISIONS §91), so gate on the dedicated
  // `sideMissionsUnlocked` flag the server derives from progress, not on `shopUnlocked`. (The server
  // derives it by level name, not by a raw progress id — DECISIONS §95.)
  const unlocked = !!(G.playerId && G.activeShip && G.activeShip.sideMissionsUnlocked);
  if (!unlocked) { missionOffers = []; takenIds = new Set(); activeMissionId = null; renderMissionsBoard(); updateGoButton(); return; }
  try {
    const data = await fetchJson(`/api/players/${G.playerId}/missions`);
    missionOffers = data.missions || [];
    takenIds = new Set(data.taken || []);
    activeMissionId = data.activeMissionId ?? null;
  } catch { missionOffers = []; takenIds = new Set(); activeMissionId = null; }
  // Default the detail to the active mission (campaign if none). Side missions only exist at L≥4, where
  // the campaign staged reveal never plays, so this can't interrupt a reveal.
  if (activeMissionId != null) { const act = missionOffers.find((m) => m.id === activeMissionId); if (act) mwMission = act; }
  renderMissionsBoard();
  updateGoButton();
  if (mwView === 'missions') renderMissionView(mwMission);
}
// Launch a chosen side mission (mirrors launchCampaign, but plays the mission descriptor).
export function launchMission(m) {
  G.activeMission = m.descriptor;
  G.pendingBriefing = null;
  if (Device.hasTouch) requestFullscreen();
  mainEl.classList.remove('on');
  stopLoadoutPreview();
  settleBriefingReveal();              // stop a stray timer/rAF from toggling classes after close
  stopViewer(mwItem);                  // stop the work-zone item showcase too
  document.getElementById('welcome').style.display = 'none';
  document.body.classList.remove('menu');
  G.gameStarted = true;
  reset();
}

// enterRoam(dest) — THE one entry into the interactive out-of-combat flight state (roam). Mirrors
// launchMission's menu-teardown but starts NO level (the G.roam guard in reset() skips levelRunner + the
// ghost battle → world up, player controllable, no enemies). dest = {pos:{x,z}, missionId} → drop in +
// autopilot there; null → free manual cruise. beginLiveSession is intentionally NOT called (roam unrecorded).
export async function enterRoam(dest) {
  G.activeMission = null; G.pendingBriefing = null;
  if (Device.hasTouch) requestFullscreen();
  mainEl.classList.remove('on');
  document.getElementById('welcome').style.display = 'none';
  stopLoadoutPreview();
  settleBriefingReveal();
  stopViewer(mwItem);
  document.body.classList.remove('menu');
  await refreshMissions();           // ensure missionOffers is current for arrival prompts (Stage 3)
  G.gameStarted = true; G.roam = true;
  reset();                           // rebuilds world + player at planet 2, NO levelRunner (G.roam guard)
  if (dest) engagePointAutopilot(dest.pos, dest.missionId || null); // else: free manual cruise
}

// Roam arrival: the sim fires this (via G.onMissionArrival) when a point-autopilot carrying a mission id
// comes to rest at its destination. Show "Start mission?" ONLY when the offer actually exists (unlocked +
// on the board); a locked/stale id just parks (no prompt). Yes → clear roam and launch the real fight.
G.onMissionArrival = (missionId) => {
  const offer = missionOffers.find((o) => o.id === missionId);
  if (!offer) return; // locked / not offered / stale → park, no prompt
  showStartMissionPrompt({
    titleText: t(offer.titleKey || 'mission.mining.title'),
    onYes: () => { G.roam = false; launchMission(offer); }, // clearing roam first makes reset() start the levelRunner
    onNo: () => {},                                          // park (stay in roam)
  });
};
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
// Point the work-zone showcase at the item this briefing grants (Machine Gun on L2, Repair drone on L3 —
// the server attaches `showcase {kind,id}`), or hide it when the briefing grants nothing.
function applyShowcaseTarget() { showShowcaseItem(briefingShowcase(mainBriefing)); }

// ---------- Work-zone briefing item showcase (#mw-item) ----------
// A viewer floated into the BOTTOM-RIGHT corner of the mission text (the text wraps around it), showing the
// 3D model of the gear a campaign briefing grants — Machine Gun on L2, Repair drone on L3 — at full size.
// Hidden when the briefing grants nothing.
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
// Keep the showcase canvas crisp as the layout reflows (the grid columns resize with window/rotation).
function resizeViewers() { resizeViewer(mwItem); }
window.addEventListener('resize', resizeViewers);
window.addEventListener('orientationchange', resizeViewers);
