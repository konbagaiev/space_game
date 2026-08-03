// Backend glue: anonymous player identity (G.playerId, set in state.js), credit banking, level
// progression, and fire-and-forget product-funnel telemetry. All calls are best-effort — if the backend
// isn't running (e.g. opened via file://) they fail silently and the game still works. Every /api URL is
// prefixed with API_BASE (empty on the same-origin deploy, the prod origin on the itch.io build).
//
// Sits HIGH in the dependency graph (the sim loop + UI flows call these); imports the leaves it needs.
import { G, CATALOG } from './state.js';
import { API_BASE, BUILD_SOURCE } from './api-base.js';
import { updateHud } from './hud.js';
import { buildMap } from './world.js';
import { buildPlayerFor } from './ship-build.js';

// Small JSON fetch helper: throws on a non-2xx so callers can .catch() a bad response.
export const fetchJson = async (url) => {
  // Prefix API_BASE for /api calls only. `fetchJson` is ALSO used for bundled same-origin assets
  // (client/src/i18n.js loadLanguage fetches 'locales/source.json' + `locales/${lang}.json`), which
  // MUST stay relative — on the itch build they load same-origin from the ZIP, and /locales gets no
  // CORS header (CORS is scoped to /api). Prefixing those would produce a malformed cross-origin URL.
  const r = await fetch(url.startsWith('/api') ? API_BASE + url : url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
};

// Bank the credits earned this run into the account balance and record the game. Runs once per run
// (on victory or death; G.banked guards it); closing the browser before a run ends loses the unbanked
// session credits.
export function bankRun() {
  if (G.banked) return;
  G.banked = true;
  const durationMs = Math.round(performance.now() - G.gameStartTime);
  if (!G.playerId) { G.balance += G.earned; updateHud(); return; } // offline: reflect locally, best-effort
  fetch(API_BASE + '/api/games', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: G.playerId, credits: G.earned, kills: G.kills, durationMs }),
  }).then((r) => (r.ok ? r.json() : null))
    .then((res) => { if (res && typeof res.credits === 'number') { G.balance = res.credits; updateHud(); } })
    .catch(() => {}); // best-effort: on failure the balance just isn't updated this run
}

// Dump a mission's collected loot into the stash (victory only — see DECISIONS). Best-effort, like
// bankRun: the Main Window re-fetches the stash when opened, so a dropped request just isn't banked.
export function depositLoot(items) {
  if (!G.playerId || !items || !items.length) return;
  fetch(API_BASE + `/api/players/${G.playerId}/loot`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  }).catch(() => {});
}

// Build a compact referrer string (document.referrer + ?ref=/UTM params), omitting empty keys. Sent once
// at boot so the server can store it write-once on player-row creation (admin panel; DECISIONS: referrer).
export function referrerPayload() {
  try {
    const p = new URLSearchParams(location.search);
    const out = {};
    if (document.referrer) out.referrer = document.referrer;
    for (const [k, key] of [['ref', 'ref'], ['utm_source', 'utm_source'], ['utm_medium', 'utm_medium'], ['utm_campaign', 'utm_campaign']]) {
      const v = p.get(k); if (v) out[key] = v;
    }
    // Tag non-web builds (e.g. the itch.io export) so we can tell where a player came from even when
    // document.referrer is blank (itch runs in a sandboxed CDN iframe). Organic web stays untagged.
    if (BUILD_SOURCE && BUILD_SOURCE !== 'web') out.source = BUILD_SOURCE;
    return Object.keys(out).length ? JSON.stringify(out) : null;
  } catch { return null; }
}

// Register the current player early in boot, sending the referrer. The server writes referrer only when
// it creates the row (write-once); this is a no-op enrichment for a returning player. Best-effort.
export async function registerBoot() {
  if (!G.playerId) return;
  try {
    await fetch(API_BASE + '/api/players/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: G.playerId, referrer: referrerPayload() }),
    });
  } catch { /* best-effort: offline / file:// still plays */ }
}

// A short label for the current level (e.g. "Level 3"); used as event context + the Sentry `level` tag.
// A chosen side mission (G.activeMission) overrides the campaign level (null = campaign).
export const currentLevelLabel = () => G.activeMission ? ('mission:' + (G.activeMission.title || 'side'))
  : ((CATALOG.level && (CATALOG.level.title || CATALOG.level.map)) || 'unknown');

// Fire-and-forget a gameplay event. `quit` uses sendBeacon so it survives tab close; others use fetch
// with keepalive. Never throws, never blocks gameplay (the endpoint is best-effort server-side too).
export function track(type, data) {
  if (!G.playerId) return;
  const payload = JSON.stringify({ playerId: G.playerId, type, data });
  try {
    if (type === 'quit' && navigator.sendBeacon) {
      navigator.sendBeacon(API_BASE + '/api/events', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(API_BASE + '/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
    }
  } catch { /* telemetry must never break the game */ }
}

// On victory: tell the server to unlock the next level, then load that level so the next Restart plays it
// (rebuilding the map if it changed). The advance may return a `briefing` (message + the server already
// ran its actions, e.g. a weapon swap) and may have changed the active ship — so we reload the active
// ship and rebuild the player, and stash the briefing (G.pendingBriefing) to show before the next run.
export async function unlockNextLevel() {
  if (!G.playerId) return;
  const clearedLevel = currentLevelLabel(); // before CATALOG.level is swapped to the next level
  try {
    const adv = await (await fetch(API_BASE + `/api/players/${G.playerId}/advance`, { method: 'POST' })).json();
    if (adv && !adv.advanced) track('victory', { level: clearedLevel }); // no next level → final win
    if (adv && adv.briefing && (adv.briefing.textKey || adv.briefing.text)) G.pendingBriefing = adv.briefing;
    const level = await fetchJson(`/api/players/${G.playerId}/level`);
    if (level.descriptor.map !== CATALOG.level.map) {
      const map = await fetchJson(`/api/maps/${level.descriptor.map}`);
      buildMap(map.descriptor);
    }
    CATALOG.level = level.descriptor; // reset() restarts CATALOG.level → next Restart is the new level
    // a briefing action may have changed the loadout (weapon swap) — reload the active ship + rebuild
    const refreshed = await fetchJson(`/api/players/${G.playerId}/active-ship`).catch(() => null);
    if (refreshed) { G.activeShip = refreshed; if (refreshed.ship) buildPlayerFor(refreshed.ship); }
  } catch { /* progression is best-effort; on failure the same level replays */ }
}
