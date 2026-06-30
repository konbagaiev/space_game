// Backend glue: anonymous player identity (G.playerId, set in state.js), credit banking, level
// progression, and fire-and-forget product-funnel telemetry. All calls are best-effort — if the backend
// isn't running (e.g. opened via file://) they fail silently and the game still works. Served
// same-origin, so the API is always reachable via relative /api URLs.
//
// Sits HIGH in the dependency graph (the sim loop + UI flows call these); imports the leaves it needs.
import { G, CATALOG } from './state.js';
import { updateHud } from './hud.js';
import { buildMap } from './world.js';
import { buildPlayerFor } from './ship-build.js';

// Small JSON fetch helper: throws on a non-2xx so callers can .catch() a bad response.
export const fetchJson = async (url) => {
  const r = await fetch(url);
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
  fetch('/api/games', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: G.playerId, credits: G.earned, kills: G.kills, durationMs }),
  }).then((r) => (r.ok ? r.json() : null))
    .then((res) => { if (res && typeof res.credits === 'number') { G.balance = res.credits; updateHud(); } })
    .catch(() => {}); // best-effort: on failure the balance just isn't updated this run
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
      navigator.sendBeacon('/api/events', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
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
    const adv = await (await fetch(`/api/players/${G.playerId}/advance`, { method: 'POST' })).json();
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
