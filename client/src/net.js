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
import { applyAllyDev } from './ally-dev.js';
import { applyDuelDev } from './duel-dev.js'; // ?duel (dev): rebuild the level as the sparring room
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

// The in-flight ADVANCE POST, so the second half of the advance cannot overtake the first (see
// commitLevelAdvance / loadAdvancedLevel). Same shape and same reason as `banking` above: the POST moves the
// account to the next level and the GET reads which level that is, so a GET that wins the race hands the tab
// back the level it just cleared — while the server is already on the next one. The player then takes off
// into the level they have finished, clears it a second time, and the second clear advances the account
// AGAIN, skipping a level and paying out its reward. The stored promise NEVER REJECTS (the body catches its
// own errors), so awaiting it can only ever cost the request's own latency — a failed advance still lets the
// read through, which is the "on failure the same level replays" contract.
let advancing = null;
export function advanceDone() { return advancing || Promise.resolve(); }

// The in-flight side-mission "cleared" POST, so the hangar's shop refetch can WAIT for it (see openBay):
// the unlock it grants must be visible in the very first /stash read after the victory, or the gated rows
// stay hidden until the next landing. Never reset to null — an already-settled promise awaits instantly,
// so keeping the last one costs nothing and saves a null dance.
let clearing = null;
export function missionClearDone() { return clearing || Promise.resolve(); }
// Record that a side mission was CLEARED (won). Permanent + idempotent server-side; unlocks any catalog
// row gated on it (`stats.minMission`). Best-effort like bankRun — a dropped request just means the player
// clears it again. Never called under replay/playback (the caller gates on !G.replayMode).
export function reportMissionCleared(missionId) {
  if (!G.playerId || !missionId) return;
  clearing = fetch(API_BASE + `/api/players/${G.playerId}/missions/clear`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ missionId }),
  }).catch(() => {});
}

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

// A run a ROOM simulated is a run the room BANKED (DECISIONS §131), so this tab must not post its own
// numbers for it — but it still has to catch up with what the server now holds, or the HUD keeps showing a
// stale balance and previews XP that has already been credited. Re-reads the account instead of banking it.
//
// Best-effort like everything else here: on failure the hangar's own refetch corrects it a moment later.
export function refreshAfterRoomBank() {
  if (!G.playerId) return;
  G.banked = true; // the run is settled; nothing else in this tab may bank it
  banking = fetchJson(`/api/players/${G.playerId}/active-ship`).then((active) => {
    if (!active) return;
    if (typeof active.credits === 'number') { G.balance = active.credits; }
    const p = active.progression;
    if (p && G.activeShip) {
      const before = (G.activeShip.progression && G.activeShip.progression.level) || 0;
      G.activeShip.progression = p;
      if (p.level > before) announceLevel(p.level); // no-op when the live HUD already toasted this level
    }
    G.earnedXp = 0; // banked by the room — stop previewing it on top of the account total
    updateHud();
  }).catch(() => {});
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

// Advancing to the next level is TWO steps, and they happen at different moments (DECISIONS §133).
//
// The split exists because the second half is not safe while the ship is flying. `buildPlayerFor` builds a
// brand-new player — a briefing action can swap a weapon, as Level 2's does — and a fresh player starts at
// the spawn point, so rebuilding mid-flight would teleport the ship out from under the autopilot taking it
// home. `buildMap` has the same problem for a level that lives on a different map.
//
// So: COMMIT when the player presses "Finish and Return" (a server call and nothing else, so the progress
// survives reloading the tab during the flight home — which is the exact bug that started all this), and
// LOAD once the ship has arrived and nothing is moving.

// Step 1 — commit the advance server-side. Safe at any moment: it touches the account, never this tab's
// world. Stashes the next level's briefing so the Main Window can show it after landing.
// Callers may fire this and walk away (sim.js does, on "Finish and Return"), so it PUBLISHES its in-flight
// promise on `advancing` rather than relying on being awaited — `loadAdvancedLevel` waits on that.
export function commitLevelAdvance() {
  if (!G.playerId) return Promise.resolve();
  const clearedLevel = currentLevelLabel(); // before anything swaps CATALOG.level out from under us
  advancing = (async () => {
    try {
      const adv = await (await fetch(API_BASE + `/api/players/${G.playerId}/advance`, { method: 'POST' })).json();
      clientLog('adv:resp', { advanced: adv && adv.advanced, cp: adv && adv.currentProgress, hasBriefing: !!(adv && adv.briefing) }); // TEMP debug
      if (adv && !adv.advanced) track('victory', { level: clearedLevel }); // no next level → final win
      if (adv && adv.briefing && (adv.briefing.textKey || adv.briefing.text)) G.pendingBriefing = adv.briefing;
    } catch (e) { clientLog('adv:error', { msg: String((e && e.message) || e) }); /* best-effort: the same level replays */ }
  })();
  return advancing;
}

// Step 2 — load the level the server has already advanced us to into THIS tab: the descriptor (so the next
// Restart plays it), its map if that changed, and the active ship (a briefing action may have swapped a
// weapon). REBUILDS THE PLAYER, so it must only run with the ship at rest.
export async function loadAdvancedLevel() {
  if (!G.playerId) return;
  try {
    // THE ADVANCE POST FIRST, ALWAYS. Both halves are fired without being awaited (sim.js: `finishing` then
    // `win`), and the gap between them is a flight home that can be almost nothing — Level 0's home station
    // sits ~43 u from the arena centre against a 45 u arrival radius, so the pilot can dock on the tick the
    // button is pressed. This read then overtook the POST and set `CATALOG.level` back to the level just
    // cleared. Reported live: the intro's briefing was correctly Level 1, Take-off replayed Level 0, and
    // clearing it again advanced the account a second time — a free level plus Level 1's reward drop.
    await advanceDone();
    const level = await fetchJson(`/api/players/${G.playerId}/level`);
    clientLog('adv:level', { name: level && level.name, title: level && level.descriptor && level.descriptor.title, map: level && level.descriptor && level.descriptor.map }); // TEMP debug
    if (level.descriptor.map !== CATALOG.level.map) {
      const map = await fetchJson(`/api/maps/${level.descriptor.map}`);
      buildMap(map.descriptor);
    }
    CATALOG.level = applyDuelDev(applyAllyDev(level.descriptor)); // reset() restarts CATALOG.level → next Restart is the new level (?ally/?duel re-injects on every level)
    CATALOG.levelName = level.name; // the SEED NAME (level-N) — the trace level for session recording
    // Wait for the run's bank POST first: this read would otherwise return the PRE-run experience and
    // overwrite the freshly banked progression with it (see `banking`).
    await bankingDone();
    const refreshed = await fetchJson(`/api/players/${G.playerId}/active-ship`).catch(() => null);
    if (refreshed) { G.activeShip = refreshed; if (refreshed.ship) buildPlayerFor(refreshed.ship); }
    clientLog('adv:done', { catalogLevel: CATALOG.level && CATALOG.level.title, catalogName: CATALOG.levelName }); // TEMP debug
  } catch (e) { clientLog('adv:error', { msg: String((e && e.message) || e), stack: String((e && e.stack) || '').slice(0, 400) }); /* progression is best-effort; on failure the same level replays */ }
}

// Both halves back to back — for a caller that finishes with the ship already at rest.
export async function unlockNextLevel() {
  await commitLevelAdvance();
  await loadAdvancedLevel();
}
