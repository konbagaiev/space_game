// ?brawl — the BOT BRAWL: a repeatable N-vs-N Sentinel load test you can run on a phone against production
// (docs/plans/2026-10-04-2001-bot-brawl-load-test.md, DECISIONS §157).
//
//   ?brawl                       the setup panel: bots per side (−/+ 1..30), a graphics tier, Start
//   ?brawl=20&tier=balance       start at once: 20 v 20 on that tier (Start always reloads into this)
//   &sec=N                       the wall-clock limit, clamped 10..300 (default 60) — for tests and soaks
//   ?brawl=0 | false | off       off (and no `brawl` param at all is off)
//
//   ?netbrawl[=N]                the SAME fight, simulated by a SERVER ROOM (the tab only renders the snapshots
//                                it receives, and the card adds the server's own load numbers). Same panel, same
//                                clamps, same `tier`/`sec`; Start reloads into `?netbrawl=N`. It implies the
//                                netsim connection by itself (never add `netsim=1`), and a bare `?netbrawl`
//                                opens NO socket. If both flags are present, `?netbrawl` WINS. Never sticky.
//   ?netbrawl=0 | false | off    off (falls through to `?brawl`, if any)
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
import {
  BRAWL_N_MIN, BRAWL_N_MAX, BRAWL_N_DEFAULT, BRAWL_LEVEL, BRAWL_SEC_DEFAULT, BRAWL_SEC_MIN, BRAWL_SEC_MAX,
  withBrawlRoom,
} from './sim-core/brawl.js';
import { TIER_ORDER } from './graphics.js';

// Moved into the pure `sim-core/brawl.js` (the server builds the same brawl for `?netbrawl`); re-exported so
// every importer of this file is unchanged.
export { BRAWL_LEVEL, BRAWL_SEC_DEFAULT, BRAWL_SEC_MIN, BRAWL_SEC_MAX };

// Pure + storage-free: the URL alone decides. Returns `{ n, tier, sec, server }` or null. `n` is null for a
// bare `?brawl` / `?netbrawl` (show the setup panel). `?netbrawl` is read FIRST and wins over `?brawl`
// (`server: true`); an "off" `?netbrawl` falls through to `?brawl`.
export function evalBrawlDev(search) {
  const p = new URLSearchParams(search || '');
  const off = (x) => x === '0' || x === 'false' || x === 'off';
  const nv = p.get('netbrawl');
  const server = nv != null && !off(nv);
  const v = server ? nv : p.get('brawl');
  if (v == null) return null;
  if (off(v)) return null;
  let n = null;
  if (v !== '') {
    const k = Number.parseInt(v, 10);
    n = Number.isFinite(k) && k > 0 ? Math.max(BRAWL_N_MIN, Math.min(BRAWL_N_MAX, k)) : BRAWL_N_DEFAULT;
  }
  const t = p.get('tier');
  const tier = TIER_ORDER.includes(t) ? t : null;
  const s = Number.parseInt(p.get('sec'), 10);
  const sec = Number.isFinite(s) ? Math.max(BRAWL_SEC_MIN, Math.min(BRAWL_SEC_MAX, s)) : BRAWL_SEC_DEFAULT;
  return { n, tier, sec, server };
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
// The setup panel's typed bot count: digits only, clamped to BRAWL_N_MIN..BRAWL_N_MAX. Anything that is not a
// number (empty, letters, a minus sign) keeps `fallback` — the count the panel already showed — so a stray
// keystroke never resets the choice. Pure; brawl-host.js calls it on Enter / blur / Start.
export function parseBrawlCount(text, fallback = BRAWL_N_DEFAULT) {
  const s = String(text ?? '').trim();
  if (!/^[0-9]+$/.test(s)) return fallback;
  return Math.max(BRAWL_N_MIN, Math.min(BRAWL_N_MAX, Number.parseInt(s, 10)));
}
// The tier this page load runs on, when the URL names one (never saved). Null otherwise.
export function brawlTierOverride() { return BRAWL_DEV ? BRAWL_DEV.tier : null; }
