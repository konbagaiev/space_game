// Backend glue: anonymous player identity (G.playerId, set in state.js), credit banking, level
// progression, and fire-and-forget product-funnel telemetry. All calls are best-effort — if the backend
// isn't running (e.g. opened via file://) they fail silently and the game still works. Every /api URL is
// prefixed with API_BASE (empty on the same-origin deploy, the prod origin on the itch.io build).
//
// Sits HIGH in the dependency graph (the sim loop + UI flows call these); imports the leaves it needs.
import { G, CATALOG } from './state.js';
import { API_BASE, BUILD_SOURCE } from './api-base.js';
import { updateHud, announceLevel } from './hud.js';
import { levelFromXp } from './progression.js';
import { buildMap } from './world.js';
import { buildPlayerFor } from './ship-build.js';
import { sendSession } from './session-transport.js'; // pure beacon-vs-fetch routing (unit-tested; the no-keepalive win/death fix)

// TEMP client → server debug log (fire-and-forget). Prints to the server console via /api/clientlog so
// on-device flows can be diagnosed without devtools. Remove with the intro-advance debugging.
export function clientLog(event, data = {}) {
  try {
    fetch(API_BASE + '/api/clientlog', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data, ua: navigator.userAgent, t: Date.now() }),
    }).catch(() => {});
  } catch { /* ignore */ }
}

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

// The in-flight bank request, so the post-victory active-ship refetch can WAIT for it (see
// unlockNextLevel). Both touch `activeShip.progression`, and the refetch reads the server BEFORE the bank
// has committed if it wins the race — which would reinstate the pre-run XP and, with `G.earnedXp` still
// set, double-count the run. Null when nothing is banking.
let banking = null;
export function bankingDone() { return banking || Promise.resolve(); }

// Bank the credits earned this run into the account balance and record the game. Runs once per run
// (on victory or death; G.banked guards it); closing the browser before a run ends loses the unbanked
// session credits.
export function bankRun() {
  if (G.banked) return;
  G.banked = true;
  const durationMs = Math.round(performance.now() - G.gameStartTime);
  if (!G.playerId) { G.balance += G.earned; updateHud(); return; } // offline: reflect locally, best-effort
  banking = fetch(API_BASE + '/api/games', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: G.playerId, credits: G.earned, kills: G.kills, durationMs, xp: G.earnedXp }),
  }).then((r) => (r.ok ? r.json() : null))
    .then((res) => {
      if (res && typeof res.credits === 'number') { G.balance = res.credits; updateHud(); }
      // Keep the in-memory progression fresh (level + XP into it + unspent points) so the Character screen
      // is correct even before the hangar refetches the active ship. Newly-gained levels add that many
      // skill points. The run's XP is now BANKED into those fields, so clear `G.earnedXp` in the same
      // breath — otherwise the HUD keeps previewing it on top of the banked total and double-counts (the
      // level-advance refetch of the active ship made that visible as a phantom extra level).
      if (res && typeof res.experience === 'number' && G.activeShip && G.activeShip.progression) {
        const p = G.activeShip.progression;
        const gained = Math.max(0, (res.level || 0) - (p.level || 0));
        const at = levelFromXp(res.experience);
        p.experience = res.experience; p.level = res.level;
        p.xpIntoLevel = at.into; p.xpForNextLevel = at.span;
        if (gained > 0) p.skillPoints = (p.skillPoints || 0) + gained;
        G.earnedXp = 0;
        announceLevel(res.level); // no-op when the live HUD already toasted this level mid-fight
      }
    })
    .catch(() => {}); // best-effort: on failure the balance just isn't updated this run
}

// Upload one finished/abandoned session recording for funnel analytics (docs/plans/2026-08-03-1246-record-all-sessions.md).
// The SERVER uploads the trace to S3 + writes the metadata row + stamps game_version (client never touches AWS).
// Win/death flushes happen while the page STAYS OPEN (the victory/death overlay is up), so they use a PLAIN
// fetch with NO `keepalive` — a keepalive request body is capped at ~64KB in Chrome, which silently threw and
// dropped every completed-level (minutes-of-ticks) trace. The tab-hidden flush is a plain fetch for the same
// reason (the page is still alive when `visibilitychange` fires). Only the `beacon:true` page-unload path uses
// `navigator.sendBeacon` and its ~64KB cap — now a genuine last resort rather than the main mobile path, and
// one that run-length-packed traces mostly fit inside anyway (~24× smaller; see replay.js packTicks).
// `id` is minted by the client so a provisional upload and the later final one UPSERT the same row.
export function postSession({ id, trace, level, outcome, durationMs, kills }, { beacon = false } = {}) {
  const body = JSON.stringify({ id, playerId: G.playerId || null, trace, level, outcome, durationMs, kills });
  try {
    sendSession(API_BASE + '/api/sessions', body, beacon, {
      fetch: (...a) => fetch(...a),
      sendBeacon: navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null,
      Blob,
    });
  } catch { /* recording upload must never break the game */ }
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
    clientLog('adv:resp', { advanced: adv && adv.advanced, cp: adv && adv.currentProgress, hasBriefing: !!(adv && adv.briefing) }); // TEMP debug
    if (adv && !adv.advanced) track('victory', { level: clearedLevel }); // no next level → final win
    if (adv && adv.briefing && (adv.briefing.textKey || adv.briefing.text)) G.pendingBriefing = adv.briefing;
    const level = await fetchJson(`/api/players/${G.playerId}/level`);
    clientLog('adv:level', { name: level && level.name, title: level && level.descriptor && level.descriptor.title, map: level && level.descriptor && level.descriptor.map }); // TEMP debug
    if (level.descriptor.map !== CATALOG.level.map) {
      const map = await fetchJson(`/api/maps/${level.descriptor.map}`);
      buildMap(map.descriptor);
    }
    CATALOG.level = level.descriptor; // reset() restarts CATALOG.level → next Restart is the new level
    CATALOG.levelName = level.name; // the SEED NAME (level-N) — the trace level for session recording
    // a briefing action may have changed the loadout (weapon swap) — reload the active ship + rebuild.
    // Wait for the run's bank POST first: this read would otherwise return the PRE-run experience and
    // overwrite the freshly banked progression with it (see `banking`).
    await bankingDone();
    const refreshed = await fetchJson(`/api/players/${G.playerId}/active-ship`).catch(() => null);
    if (refreshed) { G.activeShip = refreshed; if (refreshed.ship) buildPlayerFor(refreshed.ship); }
    clientLog('adv:done', { catalogLevel: CATALOG.level && CATALOG.level.title, catalogName: CATALOG.levelName }); // TEMP debug
  } catch (e) { clientLog('adv:error', { msg: String((e && e.message) || e), stack: String((e && e.stack) || '').slice(0, 400) }); /* progression is best-effort; on failure the same level replays */ }
}
