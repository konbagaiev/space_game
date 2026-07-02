# Dev diagnostics flag — hide the perf/service overlay behind a sticky `?dev`

**Feature ID:** 2026-07-02-0149-dev-diagnostics-flag
**Worktree:** `/Users/kbagaiev/Projects/ag-wt/2026-07-02-0149-dev-diagnostics-flag`

## Goal
The FPS/service overlay (`#perf` — FPS, frame-ms, draw calls, triangles, backbuffer resolution) is
currently shown to **every** player during a fight. It's a diagnostic tool, not player-facing game info,
so it should be **hidden by default** and appear **only for developers**. Reuse the **existing `?dev`
flag** (the one that already turns on client perf telemetry to `POST /api/perf`) — no new endpoint, no new
flag name. Make the flag **sticky via localStorage** so a developer visits `/?dev` once and keeps the
overlay across page loads without re-appending it to the URL, with an explicit `/?dev=false` off switch.
User-visible effect: normal players never see the FPS/service string; the gameplay HUD, mini-map and edge
markers are unchanged for everyone.

## Decisions (all settled — do not re-ask)
- **One dev flag, reused.** No new endpoint or flag. The change routes the **two existing `?dev` uses**
  (perf-overlay dev suffix in `hud.js`; perf telemetry `devPerf` in `main.js`) and the **new overlay
  visibility gate** through a single shared helper.
- **Flag matching.** Truthy for `?dev`, `?dev=true`, `?dev=1`. Explicit off for `?dev=false`, `?dev=0`.
  This **drops the old loose `location.search.includes('dev')`** substring match (which also matched
  `?developer` etc.).
- **Sticky (localStorage).** Visiting with a **truthy** `?dev` sets the sticky flag; visiting with an
  **explicit-off** `?dev` clears it; with **no `dev` param** (or an unrecognized value) the stored flag
  decides. Key: `localStorage['devMode'] = '1'`. Cleared via `removeItem`.
- **Scope.** Only the `#perf` overlay is gated. Gameplay HUD (Credits/Earned/Destroyed/Enemies/HP),
  mini-map, edge markers, rocket cooldown stay visible for all players. `?tune`, `?debug`, and the perf
  **sampling** each keep their own existing gates (perf sampling is `?dev`-gated and rides the same helper;
  `?tune`/`?debug` are independent and untouched).
- **Independent.** `?dev` does not enable `?tune`/`?debug` and vice-versa.
- **CSS approach.** `#perf` is `display:none` by default; revealed by a `body.dev` class (set by the
  helper) combined with the existing menu-hide, via `body.dev:not(.menu) #perf { display:block }`.

## Steps

### 1. New module `client/src/dev.js` (the single source of truth)
Create `client/src/dev.js`. It exposes a **pure, testable** `evalDev(search, storage)` plus a cached
`isDev()`, and self-applies the `body.dev` class on import (mirroring `client/src/device.js:56`).

```js
// Dev diagnostics flag (?dev) — governs the on-screen perf/service overlay (#perf) + perf telemetry.
// STICKY: a truthy ?dev (?dev, ?dev=true, ?dev=1) turns it ON and remembers it in localStorage;
// an explicit ?dev=false / ?dev=0 turns it OFF and clears the stored flag; no dev param (or an
// unrecognized value) → the stored flag decides. Evaluated ONCE per page load and cached.
// Reuses the existing ?dev flag (perf telemetry) — no new endpoint, no new flag name.
const KEY = 'devMode';

// Pure decision + storage side effect, so it's unit-testable without a DOM. Returns the on/off boolean.
export function evalDev(search, storage) {
  const params = new URLSearchParams(search || '');
  let url = null; // tri-state: true=force on, false=force off, null=no/ignored override
  if (params.has('dev')) {
    const v = params.get('dev');            // '' for a bare ?dev
    if (v === '' || v === 'true' || v === '1') url = true;
    else if (v === 'false' || v === '0') url = false;
    // any other value → leave url null (fall back to stored flag)
  }
  try {
    if (url === true) { storage && storage.setItem(KEY, '1'); return true; }
    if (url === false) { storage && storage.removeItem(KEY); return false; }
    return !!storage && storage.getItem(KEY) === '1';
  } catch { return url === true; } // localStorage blocked (private mode) → honor the URL only
}

const _search = typeof location !== 'undefined' ? location.search : '';
const _storage = typeof localStorage !== 'undefined' ? localStorage : null;
const DEV = evalDev(_search, _storage);

// True when the dev diagnostics flag is on (URL this load, or sticky from a previous ?dev visit).
export function isDev() { return DEV; }

// Set the body.dev gate before first paint (idempotent; #perf is display:none until this lands).
if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('dev', DEV);
```

Notes:
- Guards on `typeof location/localStorage/document` keep the module importable under `node --test`
  (no DOM) — `evalDev` is called with `('', null)` there and returns `false`, no class toggle.
- The class is toggled at module eval. Modules load deferred, so `document.body` exists then (same as
  `device.js:44,56`). Because `#perf` starts `display:none` in CSS, there is **no flash** even if the
  class lands a tick late.

### 2. Route `client/src/hud.js` through the helper
`client/src/hud.js:15` currently:
```js
const DEV = location.search.includes('dev'); // ?dev → append live JS-heap usage to the perf overlay
```
Replace with an import + call. Add to the import block (after the existing `import { el } from './dom.js';`
at `hud.js:13`):
```js
import { isDev } from './dev.js';
```
and change line 15 to:
```js
const DEV = isDev(); // ?dev → append live JS-heap usage + ●dev tag to the perf overlay (see dev.js)
```
The `devSuffix` logic in `updatePerf` (`hud.js:53-55`) is unchanged — it still reads `DEV` to append heap +
`●dev`. (That whole overlay is now hidden by CSS unless `body.dev`, so the suffix only ever shows to devs.)

### 3. Route `client/src/main.js` through the helper
`client/src/main.js:32` currently:
```js
const DEV = location.search.includes('dev'); // ?dev → record per-frame perf samples to the server (see devPerf)
```
Add `isDev` to the imports near the other `./` imports at the top of `main.js` (e.g. beside
`import { buildTunePanel } from './tune.js';` at `main.js:20`):
```js
import { isDev } from './dev.js';
```
and change line 32 to:
```js
const DEV = isDev(); // ?dev → record per-frame perf samples to the server (see devPerf / dev.js)
```
`devPerf` (`main.js:261-332`) is gated on `DEV` (`main.js:262 if (!DEV) return { frame() {} };`) and now
rides the shared, sticky flag — no other change. `?tune` (`main.js:523`) and `?debug` (`main.js:400,520`)
keep their own separate `location.search.includes(...)` checks — **do not touch them**.

### 4. CSS: hide `#perf` by default, reveal under `body.dev`
In `client/styles.css`, the `#perf` rule at `styles.css:518-523` currently has no `display` (defaults to
`block`). Add `display: none;` as the first declaration and add a reveal rule right after the block:
```css
  /* Perf/diagnostics overlay: dev-only, gated by the sticky ?dev flag (body.dev, see client/src/dev.js).
     Hidden for normal players. body.dev:not(.menu) beats the menu-hide so it never shows on menus. */
  #perf {
    display: none;
    position: fixed; top: 34px; left: 50%; transform: translateX(-50%);
    font-family: ui-monospace, Menlo, monospace; font-size: 12px;
    color: #9fe8b0; background: rgba(0,0,0,.45); padding: 4px 10px; border-radius: 6px;
    pointer-events: none; white-space: nowrap; letter-spacing: .3px;
  }
  body.dev:not(.menu) #perf { display: block; }
```
Leave the existing menu-hide rule at `styles.css:335` (`body.menu ... #perf ... { display: none; }`)
**unchanged** — it still lists `#perf` (now redundant given the default `display:none`, but harmless and it
also hides other elements). The `:not(.menu)` on the reveal rule keeps the overlay off on menus even for
devs, independent of source order.

## Tests
- **New:** `client/src/dev.test.js` (`node:test`, mirroring `client/src/format.test.js`). Import
  `{ evalDev }` from `./dev.js` and drive it with a `Map`-backed fake storage:
  ```js
  const fake = () => { const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  ```
  Cover:
  - `evalDev('?dev', s)` → `true`, and `s.getItem('devMode') === '1'` (sticky set).
  - `evalDev('?dev=true', s)` and `evalDev('?dev=1', s)` → `true`.
  - `evalDev('?dev=false', s)` and `evalDev('?dev=0', s)` → `false`, and the stored flag is cleared (seed
    `s.setItem('devMode','1')` first, assert `getItem` is `null` after).
  - `evalDev('', s)` with `devMode` set → `true`; with it unset → `false` (stickiness / default off).
  - `evalDev('?dev=bogus', s)` → falls back to the stored flag (unrecognized value = no override).
  - `evalDev('?dev', null)` → `true` without throwing (localStorage-blocked / private mode).
- **Run:** `cd client && node --test` (all client tests, includes the new file).
- **Server:** no server change — no `server && npm test` needed. (Confirm the diff touches only
  `client/`; `db.js` / `db_postgres.js` are untouched, so the SQLite/Postgres parity note doesn't apply.)
- **Manual smoke:** open `/` → no `#perf` overlay in a fight. Open `/?dev` → overlay appears with the
  `●dev` suffix; reload plain `/` → overlay still shows (sticky). Open `/?dev=false` → overlay gone;
  reload `/` → still gone.
- **Visual suite note:** the visual harness uses `?debug`, not `?dev`, so `#perf` is now **absent** from
  non-dev screenshots (previously present during a fight). This is the intended change, not a regression;
  judge the suite by the reliably-passing set + zero page errors (visual baseline is known-flaky).

## Docs to update
- **`docs/SUMMARY.md`** — in the **Tools** section, the **Perf overlay** bullet (`SUMMARY.md:84-90`):
  state that it is **dev-only**, hidden by default and shown only under the sticky `?dev` flag
  (`body.dev`, `client/src/dev.js`), truthy for `?dev`/`?dev=true`/`?dev=1`, sticky via
  `localStorage['devMode']`, cleared by `?dev=false`/`?dev=0`. Note `client/src/dev.js` / `isDev()` is the
  single source for the `?dev` flag (also gates the `devPerf` telemetry). Bump the `**Updated:**` date
  line (`SUMMARY.md:6`).
- **`docs/CHANGELOG.md`** — add a bullet under today's date (`## 2026-07-02`, create the heading if
  missing): **"Perf/FPS overlay is now dev-only."** Hidden for normal players; shown only under the
  existing `?dev` flag, now **sticky** via `localStorage['devMode']` (truthy `?dev`/`?dev=true`/`?dev=1`
  turns it on and remembers it; `?dev=false`/`?dev=0` clears it). New shared `client/src/dev.js` / `isDev()`
  replaces two loose `location.search.includes('dev')` checks in `hud.js`/`main.js`; the `?dev` perf
  telemetry rides the same helper.
- **`docs/DECISIONS.md`** — **add a short numbered entry** (next free number). Trade-off worth recording:
  the FPS/perf string is a diagnostic tool, so it's gated to developers rather than shown to players;
  it **reuses the existing `?dev` flag** (which already gates perf telemetry) instead of inventing a new
  one, and is made **sticky in localStorage** (with an explicit `?dev=false` off switch) so a dev doesn't
  re-append it every load. Reference DECISIONS §21 (dev tools `?tune` convention) and §30 (keep it simple).

## Out of scope / non-goals (DECISIONS §30)
- No new endpoint, route, or server change.
- No new dev flag name; do **not** merge/umbrella `?tune` or `?debug` into `?dev`.
- No in-game toggle/UI for dev mode (URL + localStorage only); no on-screen indicator beyond the existing
  `●dev` suffix on the overlay itself.
- Do **not** gate or restyle any gameplay HUD element, the mini-map, edge markers, or rocket cooldown.
- No change to what the overlay measures or to the `devPerf` telemetry payload/schedule.
