// Welcome screen (greeting + intro → take off) + the i18n UI glue (apply [data-i18n] chrome, the EN/RU lang
// switch, runtime language change) + the mobile fullscreen helper. Part of the between-battles UI cycle:
// showWelcome renders the account bar (account) and starts the staged L1 intro reveal, setLanguage
// re-localizes the chrome (settings gear, etc.); take-off starts a run via reset (sim). Exports:
// showWelcome (account + bootstrap), applyTranslations (bootstrap), requestFullscreen (mainwindow take-off flows).
import { G } from './state.js';
import { t, loadLanguage, getLanguage, langButtons } from './i18n.js';
import { fetchJson } from './net.js';
import { API_BASE } from './api-base.js';
import { setPaused, refreshMusic, reset } from './sim.js';
import { buildPlayerFor } from './ship-build.js';
import { Device } from './device.js';
import { renderAccountBar } from './account.js';
import { localizeSettings } from './settings.js';
import { localizeCredits } from './credits.js';
import { typeText } from './typewriter.js';

const welcomeEl = document.getElementById('welcome');
let selectedShip = null;
export let welcomeStaged = false; // a staged L1 welcome reveal is animating (read by ?debug __game)
let welcomeCtl = null;            // active typewriter controller
let welcomeGoTimer = 0;           // the +0.5s Take-off reveal timeout handle

function clearWelcomeReveal() {
  if (welcomeCtl) { welcomeCtl.cancel(); welcomeCtl = null; }
  if (welcomeGoTimer) { clearTimeout(welcomeGoTimer); welcomeGoTimer = 0; }
}
// Show the fully-revealed welcome state at once (skip-on-tap + settle when setLanguage re-renders mid-type).
function revealWelcomeNow() {
  clearWelcomeReveal();
  const intro = welcomeEl.querySelector('.intro');
  if (intro) intro.textContent = t('ui.welcome.intro');
  welcomeEl.classList.remove('welcome-hide-go');
  welcomeStaged = false;
}
// Staged L1 reveal: greeting h1 shows immediately → `.intro` types ~5s → +0.5s Take-off fades in.
function startWelcomeReveal() {
  clearWelcomeReveal();
  welcomeStaged = true;
  const intro = welcomeEl.querySelector('.intro');
  welcomeEl.classList.add('welcome-hide-go');
  welcomeCtl = typeText(intro, t('ui.welcome.intro'), { total: 5000, onDone: () => {
    welcomeGoTimer = setTimeout(() => {                    // Take-off 0.5s after the intro finishes
      welcomeGoTimer = 0;
      welcomeEl.classList.remove('welcome-hide-go');
      welcomeStaged = false;
    }, 500);
  }});
}
// Tap the `.intro` while it's typing → skip to full + reveal Take-off at once. `.intro` is static
// markup (client/index.html:40), never rebuilt (only its textContent changes), so bind once at module load.
welcomeEl.querySelector('.intro').addEventListener('click', () => { if (welcomeStaged) revealWelcomeNow(); });

export function showWelcome(playerShips) {
  selectedShip = playerShips[0] || null; // L1 owns exactly one ship; take-off needs a non-null selection
  renderAccountBar();
  document.body.classList.add('menu'); // hide the in-game HUD behind the welcome screen
  refreshMusic(); // menu → calmer hangar music
  welcomeEl.style.display = 'grid';
  startWelcomeReveal();
}

// ---------- Localization (i18n) UI glue ----------
// Every mounted EN/RU toggle host (welcome + settings + intro cutscene). Rebuilt on every language
// re-render (applyTranslations) so each host's active button reflects the active language.
const langHosts = new Set();
// Apply every [data-i18n] element's text (or innerHTML for [data-i18n-html]) for the active language.
// Also resolves [data-i18n-href] → href, so links (e.g. the locale-specific community group) follow
// the active language like the rest of the i18n flow.
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (el.hasAttribute('data-i18n-html')) el.innerHTML = t(key);
    else el.textContent = t(key);
  });
  root.querySelectorAll('[data-i18n-href]').forEach((el) => {
    el.setAttribute('href', t(el.getAttribute('data-i18n-href')));
  });
  // Floating fullscreen button: icon-only in markup, so the words live in aria-label/title (not text).
  const fsBtn = document.getElementById('fullscreen-btn');
  if (fsBtn) {
    const fsLabel = t('ui.fullscreen').replace(/^⛶\s*/, ''); // strip any leading glyph; words only
    fsBtn.setAttribute('aria-label', fsLabel);
    fsBtn.setAttribute('title', fsLabel);
  }
  document.documentElement.lang = getLanguage();
  // Re-render every mounted EN/RU toggle so its active button matches the active language. Prune
  // detached hosts (the intro cutscene host is removed on teardown) so the set doesn't leak.
  for (const h of [...langHosts]) { if (h.isConnected) mountLangSwitch(h); else langHosts.delete(h); }
}
// Render the EN/RU buttons into `host` and register it so a later language re-render refreshes it.
// stopPropagation: the intro cutscene overlay has a whole-overlay click→advance listener; a button
// click must switch language WITHOUT advancing/skipping a card.
export function mountLangSwitch(host) {
  if (!host) return;
  langHosts.add(host);
  host.innerHTML = '';
  for (const { lang, label, active } of langButtons(getLanguage())) {
    const b = document.createElement('button');
    b.textContent = label;
    if (active) b.className = 'active';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (getLanguage() !== lang) setLanguage(lang);
    });
    host.appendChild(b);
  }
}
// Switch language at runtime: load the bundle, re-render static + dynamic strings, persist both ways.
export async function setLanguage(lang) {
  await loadLanguage(lang, fetchJson);
  try { localStorage.setItem('lang', getLanguage()); } catch {}
  applyTranslations(); // re-localizes static [data-i18n] chrome + the cutscene card + ALL toggle hosts
  setPaused(G.paused); // re-localize the pause button's aria-label/tooltip (JS-set, not data-i18n)
  localizeSettings(); // re-localize the settings gear + audio toggles
  localizeCredits(); // re-render the credits panel if it's open (chrome labels change)
  if (G.playerId) fetch(API_BASE + `/api/players/${G.playerId}/language`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: getLanguage() }),
  }).catch(() => {}); // best-effort: persist the preference server-side
  if (welcomeStaged) revealWelcomeNow(); // a language switch re-renders `.intro` (applyTranslations) — settle to full
}
// Mount the two static toggle hosts once at module init (both exist in index.html before this deferred
// module runs). The dynamic intro-cutscene host is mounted from main.js when the overlay is built.
// Every applyTranslations() (incl. bootstrap's initial localize) refreshes them, so the active button
// reflects the loaded language on first paint.
mountLangSwitch(document.getElementById('lang-switch'));   // welcome screen
mountLangSwitch(document.getElementById('settings-lang')); // settings modal
// Go fullscreen so the mobile browser chrome (address bar) doesn't eat the screen — must run inside
// the click gesture. Works on Android/iPad; silently ignored where unsupported (e.g. iPhone Safari).
// (Landscape is enforced by the CSS body rotation, not orientation.lock, so nothing extra to do here.)
export function requestFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req || document.fullscreenElement) return;
  try { const r = req.call(el); if (r && r.catch) r.catch(() => {}); } catch {}
}
// Single floating "Full screen" button (touch, bottom-right, menus only): re-enter fullscreen on
// demand, e.g. after minimizing the app brought the browser chrome (URL bar, tabs) back. Tap gesture.
document.getElementById('fullscreen-btn').addEventListener('click', requestFullscreen);
// Hide the floating button once we're actually fullscreen (toggles body.fs; CSS hides it).
function syncFsClass() {
  document.body.classList.toggle('fs', !!document.fullscreenElement);
}
document.addEventListener('fullscreenchange', syncFsClass);
document.addEventListener('webkitfullscreenchange', syncFsClass);
// Mobile browsers often DON'T deliver fullscreenchange while the tab is backgrounded, so after a
// minimize→restore `body.fs` can be stale-true (document.fullscreenElement is null but the class stuck),
// which hides the ⛶ button just when the player needs it. Re-sync whenever the page returns to the
// foreground so the button reliably reappears.
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncFsClass(); });
window.addEventListener('pageshow', syncFsClass);
window.addEventListener('focus', syncFsClass);
syncFsClass(); // initial state

// ---------- Take off ----------
function takeOff() {
  if (!selectedShip) return;
  if (Device.hasTouch) requestFullscreen(); // hide the browser chrome on mobile (landscape especially)
  if (selectedShip.name !== G.currentShipName) buildPlayerFor(selectedShip);
  welcomeEl.style.display = 'none';
  document.body.classList.remove('menu'); // restore the in-game HUD
  G.gameStarted = true;
  reset(); // position the player + start the level
}
document.getElementById('takeoff').addEventListener('click', takeOff);
