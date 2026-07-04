// Welcome screen (pick a ship → take off) + the i18n UI glue (apply [data-i18n] chrome, the EN/RU lang
// switch, runtime language change) + the mobile fullscreen helper. Part of the between-battles UI cycle:
// showWelcome renders the account bar (account), setLanguage re-localizes the settings gear (settings) and
// re-renders the ship cards; take-off starts a run via reset (sim). Exports: showWelcome (account +
// bootstrap), applyTranslations (bootstrap), requestFullscreen (mainwindow take-off flows).
import { G, CATALOG } from './state.js';
import { cssColor } from './format.js';
import { t, loadLanguage, getLanguage, SUPPORTED } from './i18n.js';
import { fetchJson } from './net.js';
import { API_BASE } from './api-base.js';
import { setPaused, refreshMusic, reset } from './sim.js';
import { buildPlayerFor } from './ship-build.js';
import { Device } from './device.js';
import { renderAccountBar } from './account.js';
import { localizeSettings } from './settings.js';

// A ship's hull HP for the welcome card (resolved from its hull component).
const shipHullHp = (ship) => CATALOG.components.get(ship.components?.hull)?.stats.durability ?? '?';

const welcomeEl = document.getElementById('welcome');
let selectedShip = null;

function mountSummary(stats) { // "2× gun · 2× rocket" from the ship's mounts
  const count = (type) => stats.mounts.filter((m) => CATALOG.weapons.get(m.weapon)?.type === type).length;
  const parts = [];
  if (count('bullet')) parts.push(t('ui.mount.gun', { n: count('bullet') }));
  if (count('rocket')) parts.push(t('ui.mount.rocket', { n: count('rocket') }));
  return parts.join(' · ') || t('ui.mount.unarmed');
}
let lastPlayerShips = []; // remembered so a language switch can re-render the (DB-sourced) cards
function renderShipCards(playerShips) {
  const wrap = document.getElementById('ship-choices');
  wrap.innerHTML = '';
  if (!selectedShip || !playerShips.includes(selectedShip)) selectedShip = playerShips[0] || null;
  playerShips.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'ship-card' + (s === selectedShip ? ' selected' : '');
    card.innerHTML =
      `<div class="ship-name"><span class="ship-dot" style="background:${cssColor(s.stats.color)}"></span>${shipName(s)}</div>` +
      `<div class="ship-stat">${t('ui.card.hull', { hp: shipHullHp(s) })}</div>` +
      `<div class="ship-stat">${t('ui.card.weapons', { summary: mountSummary(s.stats) })}</div>`;
    card.addEventListener('click', () => {
      selectedShip = s;
      [...wrap.children].forEach((c, i) => c.classList.toggle('selected', playerShips[i] === s));
    });
    wrap.appendChild(card);
  });
}
export function showWelcome(playerShips) {
  lastPlayerShips = playerShips;
  renderShipCards(playerShips);
  buildLangSwitch();
  renderAccountBar();
  document.body.classList.add('menu'); // hide the in-game HUD behind the welcome screen
  refreshMusic(); // menu → calmer hangar music
  welcomeEl.style.display = 'flex';
}

// ---------- Localization (i18n) UI glue ----------
// Resolve a ship's display name through i18n (key → translation → English fallback).
function shipName(s) { return s.stats.nameKey ? t(s.stats.nameKey) : s.name; }
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
}
// EN/RU toggle on the welcome screen.
function buildLangSwitch() {
  const host = document.getElementById('lang-switch');
  if (!host) return;
  host.innerHTML = '';
  SUPPORTED.forEach((lang) => {
    const b = document.createElement('button');
    b.textContent = lang.toUpperCase();
    if (getLanguage() === lang) b.className = 'active';
    b.addEventListener('click', () => { if (getLanguage() !== lang) setLanguage(lang); });
    host.appendChild(b);
  });
}
// Switch language at runtime: load the bundle, re-render static + dynamic strings, persist both ways.
async function setLanguage(lang) {
  await loadLanguage(lang, fetchJson);
  try { localStorage.setItem('lang', getLanguage()); } catch {}
  applyTranslations();
  setPaused(G.paused); // re-localize the pause button's aria-label/tooltip (JS-set, not data-i18n)
  localizeSettings(); // re-localize the settings gear + audio toggles
  buildLangSwitch();
  if (lastPlayerShips.length) renderShipCards(lastPlayerShips); // re-render DB-sourced ship names
  if (G.playerId) fetch(API_BASE + `/api/players/${G.playerId}/language`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: getLanguage() }),
  }).catch(() => {}); // best-effort: persist the preference server-side
}
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
