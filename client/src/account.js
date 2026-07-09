// Account / authentication (DECISIONS §11). Anonymous-first: the player always has a localStorage UUID
// (G.playerId). An optional email/password account upgrades that same player row in place (progress
// preserved); logging in on a fresh device adopts the account's player id. Auth is dual-path: the
// same-origin deploy rides an httpOnly session cookie (calls send credentials), while the cross-origin
// itch.io build uses a bearer token in localStorage['authToken'] (third-party cookies are unreliable). See DECISIONS.
//
// Part of the between-battles UI cycle: it calls showMain (mainwindow) + showWelcome (welcome) after a
// login adopts a new player; those import renderAccountBar/openAccount/shouldPromptAccount back. ESM
// resolves the cycle at runtime (all edges are on user actions, never at module init).
import { G, CATALOG } from './state.js';
import { fetchJson } from './net.js';
import { API_BASE } from './api-base.js';
import { buildMap } from './world.js';
import { buildPlayerFor } from './ship-build.js';
import { levelRunner } from './sim.js';
import { t } from './i18n.js';
import { showMain } from './mainwindow.js';
import { showWelcome } from './welcome.js';

let accountPlayer = null;       // the signed-in account (/me, register, or login result) or null
let playerShipsCache = [];      // the player-type ships (for re-rendering the welcome screen on login)
let accountMode = 'login';      // 'prompt' | 'register' | 'login' | 'forgot' | 'reset'
let afterAccount = null;        // run when the dialog closes (e.g. continue to the Hangar)
const accountEl = document.getElementById('account');
const acc = {
  title: document.getElementById('account-title'),
  msg: document.getElementById('account-msg'),
  username: document.getElementById('account-username'),
  creds: document.getElementById('account-creds'),
  email: document.getElementById('account-email'),
  password: document.getElementById('account-password'),
  primary: document.getElementById('account-primary'),
  secondary: document.getElementById('account-secondary'),
  forgot: document.getElementById('account-forgot'),
  err: document.getElementById('account-err'),
};
// bootstrap remembers the player-type ships here so a later login can re-render the welcome screen.
export function setPlayerShipsCache(ships) { playerShipsCache = ships; }
export function getPlayerShips() { return playerShipsCache; } // for the post-victory landing (welcome screen fallback)

const AUTH_TOKEN_KEY = 'authToken'; // bearer session token for cross-origin (itch) auth; see DECISIONS
const getAuthToken = () => { try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; } };
const setAuthToken = (tok) => { try { tok ? localStorage.setItem(AUTH_TOKEN_KEY, tok) : localStorage.removeItem(AUTH_TOKEN_KEY); } catch {} };

// Guest callsign: a guest who names themselves at the level-1 prompt has no account row we track
// client-side (accountPlayer stays null), so mirror the name here + in localStorage. Lets the account
// bar show "Playing as <name>" and survives a reload (the guest identity itself lives in localStorage).
const GUEST_NAME_KEY = 'guestName';
let guestName = (() => { try { return localStorage.getItem(GUEST_NAME_KEY) || null; } catch { return null; } })();
const setGuestName = (name) => {
  guestName = name || null;
  try { name ? localStorage.setItem(GUEST_NAME_KEY, name) : localStorage.removeItem(GUEST_NAME_KEY); } catch {}
};

// Auth requests: prefix API_BASE (empty same-origin, prod origin on the itch build). Send the bearer
// token from localStorage when we have one (the cross-origin itch path — third-party cookies are
// unreliable) AND keep credentials:'include' so the same-origin cookie still rides along.
const authFetch = (path, opts = {}) => {
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const { headers: _drop, ...rest } = opts; // headers already merged above; don't let ...opts clobber them
  return fetch(API_BASE + path, { credentials: 'include', headers, ...rest });
};

// Render the menu-screen status bar: signed-in identity + verify nudge, or a "log in / sign up" CTA.
export function renderAccountBar() {
  const bar = document.getElementById('account-bar');
  if (!bar) return;
  bar.innerHTML = '';
  const add = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; bar.appendChild(e); return e; };
  if (accountPlayer && accountPlayer.email) {
    add('div', null, t('ui.account.signed_in_as', { who: accountPlayer.username || accountPlayer.email }));
    if (accountVerifiedJustNow) add('span', 'verified-ok', t('ui.account.verified'));
    if (!accountPlayer.emailVerified) {
      add('span', 'verify-nudge', t('ui.account.verify_nudge'));
      const resend = add('button', null, t('ui.account.resend'));
      resend.addEventListener('click', () => resendVerification(resend));
    }
    add('button', null, t('ui.account.log_out')).addEventListener('click', logout);
  } else {
    add('div', null, guestName ? t('ui.account.guest_named', { who: guestName }) : t('ui.account.anon'));
    add('button', null, t('ui.account.sign_in')).addEventListener('click', () => openAccount('login'));
  }
}

// Configure the dialog for a mode (which fields show + the button labels/placeholders).
function setAccountMode(mode) {
  accountMode = mode;
  acc.err.textContent = '';
  acc.primary.style.display = '';   // normalize: doForgot hides it on success (see doForgot); reset every switch
  acc.username.style.display = (mode === 'prompt' || mode === 'register') ? 'block' : 'none';
  // #account-creds wraps BOTH email + password. Keep it shown for every credential mode (login/register/
  // forgot/reset) and toggle the individual inputs inside it — forgot needs the email, reset needs the password.
  acc.creds.style.display = (mode === 'register' || mode === 'login' || mode === 'forgot' || mode === 'reset') ? 'block' : 'none';
  acc.email.style.display = (mode === 'reset') ? 'none' : 'block';       // reset: no email field
  acc.password.style.display = (mode === 'forgot') ? 'none' : 'block';   // forgot: no password field
  acc.secondary.style.display = (mode === 'forgot' || mode === 'reset') ? 'none' : '';
  acc.forgot.style.display = (mode === 'login') ? '' : 'none';
  acc.username.placeholder = t('ui.account.username_ph');
  acc.email.placeholder = t('ui.account.email_ph');
  acc.password.placeholder = t('ui.account.password_ph');
  if (mode === 'prompt') {
    acc.title.textContent = t('ui.account.prompt_title');
    acc.msg.textContent = t('ui.account.prompt_msg');
    acc.primary.textContent = t('ui.account.continue_anon');
    acc.secondary.textContent = t('ui.account.create');
    acc.password.autocomplete = 'new-password';
  } else if (mode === 'register') {
    acc.title.textContent = t('ui.account.create_title');
    acc.msg.textContent = t('ui.account.create_msg');
    acc.primary.textContent = t('ui.account.create');
    acc.secondary.textContent = t('ui.account.have_account');
    acc.password.autocomplete = 'new-password';
  } else if (mode === 'forgot') {
    acc.title.textContent = t('ui.account.forgot_title');
    acc.msg.textContent = t('ui.account.forgot_msg');
    acc.primary.textContent = t('ui.account.forgot_send');
  } else if (mode === 'reset') {
    acc.title.textContent = t('ui.account.reset_title');
    acc.msg.textContent = t('ui.account.reset_msg');
    acc.primary.textContent = t('ui.account.reset_submit');
    acc.password.autocomplete = 'new-password';
  } else { // login
    acc.title.textContent = t('ui.account.login_title');
    acc.msg.textContent = t('ui.account.login_msg');
    acc.primary.textContent = t('ui.account.log_in');
    acc.secondary.textContent = t('ui.account.need_account');
    acc.password.autocomplete = 'current-password';
  }
}

export function openAccount(mode, opts = {}) {
  afterAccount = opts.after || null;
  if (opts.username != null) acc.username.value = opts.username;
  else if (!acc.username.value && guestName) acc.username.value = guestName; // keep the guest callsign on a later register
  if (mode !== 'register') { acc.email.value = ''; acc.password.value = ''; }
  setAccountMode(mode);
  accountEl.style.display = 'flex';
  setTimeout(() => (mode === 'login' ? acc.email : mode === 'reset' ? acc.password : acc.username).focus(), 0);
}
function closeAccount() {
  accountEl.style.display = 'none';
  const after = afterAccount; afterAccount = null;
  if (after) after();
}

// True only the first time the player clears level 1 while still anonymous (prompt once, then never).
export function shouldPromptAccount() {
  if (accountPlayer) return false;                              // already has an account
  if (levelRunner.winTextKey !== 'level.1.victory') return false; // only after level 1
  let prompted = false; try { prompted = localStorage.getItem('accountPrompted') === '1'; } catch {}
  if (prompted) return false;
  try { localStorage.setItem('accountPrompted', '1'); } catch {}
  return true;
}

async function saveUsername(username) {
  if (!G.playerId) return;
  try {
    const r = await authFetch(`/api/players/${G.playerId}/username`, { method: 'POST', body: JSON.stringify({ username }) });
    if (r.ok) {
      const saved = (await r.json()).username; // server-normalized (cleanUsername) name
      if (accountPlayer) accountPlayer.username = saved;
      else setGuestName(saved);                // guest: remember the callsign locally + persist it
      renderAccountBar();
    }
  } catch {}
}

async function accountPrimary() {
  acc.err.textContent = '';
  if (accountMode === 'prompt') {
    const username = acc.username.value.trim();
    if (username) await saveUsername(username); // keep playing anonymously, but save the name
    closeAccount();
    return;
  }
  if (accountMode === 'forgot') return doForgot();
  if (accountMode === 'reset') return doReset();
  if (accountMode === 'register') return doRegister();
  return doLogin();
}
function accountSecondary() {
  if (accountMode === 'prompt') return setAccountMode('register'); // reveal email/password (keep username)
  if (accountMode === 'register') return setAccountMode('login');
  return setAccountMode('register'); // login → register
}

async function doRegister() {
  const username = acc.username.value.trim();
  const email = acc.email.value.trim();
  const password = acc.password.value;
  if (password.length < 8) { acc.err.textContent = t('ui.account.err_password'); return; }
  acc.primary.disabled = true;
  try {
    const r = await authFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ playerId: G.playerId, username, email, password }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409) { acc.err.textContent = t('ui.account.err_email_taken'); return; }
    if (!r.ok) { acc.err.textContent = j.error || t('ui.account.err_generic'); return; }
    accountPlayer = j; // upgraded the current player row in place — same playerId, progress preserved
    if (j.token) setAuthToken(j.token);
    renderAccountBar();
    closeAccount();
  } catch { acc.err.textContent = t('ui.account.err_network'); }
  finally { acc.primary.disabled = false; }
}

async function doLogin() {
  const email = acc.email.value.trim();
  const password = acc.password.value;
  acc.primary.disabled = true;
  try {
    const r = await authFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { acc.err.textContent = t('ui.account.err_credentials'); return; }
    if (!r.ok) { acc.err.textContent = j.error || t('ui.account.err_generic'); return; }
    accountPlayer = j;
    if (j.token) setAuthToken(j.token);
    if (j.id && j.id !== G.playerId) {            // adopt the account's player row (fresh-device login)
      G.playerId = j.id;
      try { localStorage.setItem('playerId', G.playerId); } catch {}
      await reloadPlayerWorld();
    }
    renderAccountBar();
    closeAccount();
  } catch { acc.err.textContent = t('ui.account.err_network'); }
  finally { acc.primary.disabled = false; }
}

// Request a password-reset email. Enumeration-safe: shows the same confirmation whether or not the
// email has an account. On success, hide the email input + send button and show the confirmation.
async function doForgot() {
  const email = acc.email.value.trim();
  acc.primary.disabled = true;
  try {
    await authFetch('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    acc.err.textContent = '';
    acc.msg.textContent = t('ui.account.forgot_sent');
    acc.email.style.display = 'none';
    acc.primary.style.display = 'none';   // hide the send button on the confirmation screen; setAccountMode
                                          // restores it (leading acc.primary.style.display='') on the next
                                          // mode switch, so a later openAccount('login') isn't broken.
  } catch { acc.err.textContent = t('ui.account.err_network'); }
  finally { acc.primary.disabled = false; }
}

// Submit a new password with the raw token from the /?reset=… link; on success the server rotates the
// password, drops other sessions, and logs us in on this device. Adopt the returned player row like login.
async function doReset() {
  const password = acc.password.value;
  if (password.length < 8) { acc.err.textContent = t('ui.account.err_password'); return; }
  acc.primary.disabled = true;
  try {
    const r = await authFetch('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: resetToken, password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { acc.err.textContent = t('ui.account.err_reset_invalid'); return; }
    accountPlayer = j;
    if (j.token) setAuthToken(j.token);
    if (j.id && j.id !== G.playerId) {          // adopt the account's player row (fresh-device reset)
      G.playerId = j.id;
      try { localStorage.setItem('playerId', G.playerId); } catch {}
      await reloadPlayerWorld();
    }
    renderAccountBar();
    closeAccount();
  } catch { acc.err.textContent = t('ui.account.err_network'); }
  finally { acc.primary.disabled = false; acc.primary.style.display = ''; }
}

// After adopting a different player (login), reload that player's level + active ship and re-render
// the landing screen for their progress.
async function reloadPlayerWorld() {
  try {
    const level = await fetchJson(`/api/players/${G.playerId}/level`);
    if (level.descriptor.map !== CATALOG.level.map) {
      const map = await fetchJson(`/api/maps/${level.descriptor.map}`);
      buildMap(map.descriptor);
    }
    CATALOG.level = level.descriptor;
    const active = await fetchJson(`/api/players/${G.playerId}/active-ship`).catch(() => null);
    G.activeShip = active;
    if (active && typeof active.credits === 'number') G.balance = active.credits;
    if (active && active.ship) buildPlayerFor(active.ship);
    if (CATALOG.level.briefing) showMain(CATALOG.level.briefing);
    else showWelcome(playerShipsCache);
  } catch {}
}

async function logout() {
  try { await authFetch('/api/auth/logout', { method: 'POST' }); } catch {}
  setAuthToken(null);
  accountPlayer = null;
  accountVerifiedJustNow = false;
  // Keep the local anonymous id (don't clear localStorage.playerId): play continues on this device
  // under the same row; a later login restores the session.
  renderAccountBar();
}

async function resendVerification(btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await authFetch('/api/auth/resend-verification', { method: 'POST' });
    if (btn) btn.textContent = r.ok ? t('ui.account.resent') : t('ui.account.resend');
  } catch {} finally { if (btn) setTimeout(() => { btn.disabled = false; }, 2000); }
}

let accountVerifiedJustNow = false; // set when returning from the email verify link (?verified=1)
let resetToken = null; // raw token from the /?reset=… link, held for the reset submit
acc.primary.addEventListener('click', accountPrimary);
acc.secondary.addEventListener('click', accountSecondary);
acc.forgot.addEventListener('click', () => setAccountMode('forgot'));
document.getElementById('account-close').addEventListener('click', closeAccount);
for (const el of [acc.username, acc.email, acc.password]) {
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); accountPrimary(); } });
}

// Restore a signed-in session on boot: prefer the httpOnly-cookie account over the local anonymous UUID,
// so a logged-in account is restored even after a localStorage clear and adopts its own player row. Also
// clears the ?verified=1 flag left by the email verification redirect. Called from bootstrap().
export async function restoreSession() {
  try {
    const me = await authFetch('/api/auth/me');
    if (me.ok) {
      accountPlayer = await me.json();
      if (accountPlayer && accountPlayer.id) {
        G.playerId = accountPlayer.id;
        try { localStorage.setItem('playerId', G.playerId); } catch {}
      }
    }
  } catch {}
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('verified') === '1') accountVerifiedJustNow = true;
    const rt = params.get('reset');
    if (rt) { resetToken = rt; openAccount('reset'); }
    if (params.has('verified') || params.has('reset')) {
      params.delete('verified'); params.delete('reset');
      history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : ''));
    }
  } catch {}
}

// Browser error monitoring (Sentry), errors-only. Enabled only when the server returns a public DSN
// from /api/config — loaded from the CDN on demand (no build step; nothing shipped when disabled).
// Best-effort: any failure here must never break the game. See docs/plans/monitoring.md.
export async function initSentry() {
  let cfg = null;
  try { cfg = (await (await fetch(API_BASE + '/api/config')).json()).sentry; } catch { return; }
  if (!cfg || !cfg.dsn || window.Sentry) return;
  await new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://browser.sentry-cdn.com/10.59.0/bundle.min.js';
    s.crossOrigin = 'anonymous';
    s.onload = resolve; s.onerror = resolve; // resolve either way — never block boot
    document.head.appendChild(s);
  });
  if (!window.Sentry) return;
  try {
    window.Sentry.init({ dsn: cfg.dsn, environment: cfg.environment, release: cfg.release || undefined, tracesSampleRate: 0 });
    if (G.playerId) window.Sentry.setUser({ id: G.playerId }); // the localStorage/account player id
  } catch { /* best-effort */ }
}
