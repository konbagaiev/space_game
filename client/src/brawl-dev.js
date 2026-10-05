// ?brawl — the BOT BRAWL: a repeatable N-vs-N Sentinel load test you can run on a phone against production
// (docs/plans/2026-10-04-2001-bot-brawl-load-test.md, DECISIONS §157).
//
//   ?brawl                       the setup panel: bots per side (−/+ 1..30), a graphics tier, Start
//   ?brawl=20&tier=balance       start at once: 20 v 20 on that tier (Start always reloads into this)
//   &sec=N                       the wall-clock limit, clamped 10..300 (default 60) — for tests and soaks
//   ?brawl=0 | false | off       off (and no `brawl` param at all is off)
//
// WHAT IT DOES: two teams of N bots, all flown by the Sentinel pilot (`flySentinel`), fight over the home
// station while the player only watches. The camera follows the middle of the fight (a tap follows one bot,
// another tap goes back). It lasts 60 s of WALL time — or less if a side is wiped out — and then shows a
// result card (frame-time avg/p95/worst overall and per 10-sim-second window, sim seconds reached, sim/wall
// ratio, a fight fingerprint). `?brawl` alone turns on perf telemetry to `/api/perf` (each per-second sample
// plus one `kind: 'brawl-result'` sample). It pays nothing, records no session and never meets the referee.
//
// `tier` applies to THIS page load only and is never saved — the flag is NOT STICKY (DECISIONS §81). The
// light pool is baked into lit shaders at boot, so a tier change needs a reload, which is why Start always
// reloads.
//
// DETERMINISM IS PER JS ENGINE: the seed is fixed, so every device on the SAME engine simulates the same
// fight tick for tick for as far as it gets. Android Chrome (V8) and an iPhone (JavaScriptCore) are not
// promised to agree (§151) — compare fingerprints only between runs on one engine.
//
// AFTER A DEPLOY, HARD-REFRESH on the phone: client modules have fixed names, so a cached old module is the
// usual reason a fix "does not work". The setup panel shows the build so that can be checked.
//
// Must NOT import `state.js` — `state.js` imports this file (for the tier override).
import { BRAWL_N_MIN, BRAWL_N_MAX, BRAWL_N_DEFAULT, withBrawlRoom } from './sim-core/brawl.js';
import { TIER_ORDER } from './graphics.js';

export const BRAWL_LEVEL = 'level-1';  // the map it is built over (the room keeps its map, centres on the station)
export const BRAWL_SEC_DEFAULT = 60;
export const BRAWL_SEC_MIN = 10;
export const BRAWL_SEC_MAX = 300;

// Pure + storage-free: the URL alone decides. Returns `{ n, tier, sec }` or null. `n` is null for a bare
// `?brawl` (show the setup panel).
export function evalBrawlDev(search) {
  const p = new URLSearchParams(search || '');
  const v = p.get('brawl');
  if (v == null) return null;
  if (v === '0' || v === 'false' || v === 'off') return null;
  let n = null;
  if (v !== '') {
    const k = Number.parseInt(v, 10);
    n = Number.isFinite(k) && k > 0 ? Math.max(BRAWL_N_MIN, Math.min(BRAWL_N_MAX, k)) : BRAWL_N_DEFAULT;
  }
  const t = p.get('tier');
  const tier = TIER_ORDER.includes(t) ? t : null;
  const s = Number.parseInt(p.get('sec'), 10);
  const sec = Number.isFinite(s) ? Math.max(BRAWL_SEC_MIN, Math.min(BRAWL_SEC_MAX, s)) : BRAWL_SEC_DEFAULT;
  return { n, tier, sec };
}

const BRAWL_DEV = evalBrawlDev(typeof location !== 'undefined' ? location.search : '');

export function brawlDev() { return BRAWL_DEV; }
export function brawlActive() { return !!BRAWL_DEV; }
// The level the brawl is built over, or null with the flag off.
export function brawlDevLevel() { return BRAWL_DEV ? BRAWL_LEVEL : null; }
// Wrap a level descriptor: the brawl room with the flag on, the SAME object with it off.
export function applyBrawlDev(descriptor, dev = BRAWL_DEV) {
  return dev ? withBrawlRoom(descriptor) : descriptor;
}
// The tier this page load runs on, when the URL names one (never saved). Null otherwise.
export function brawlTierOverride() { return BRAWL_DEV ? BRAWL_DEV.tier : null; }
