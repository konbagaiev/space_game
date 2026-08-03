# Record ALL gameplay sessions → S3 + Postgres → per-session playback in /admin

**Feature ID:** 2026-08-03-1246-record-all-sessions · **Worktree:** `/Users/kbagaiev/Projects/ag-wt/2026-08-03-1246-record-all-sessions`
**Status:** PLANNED

## Goal

Today `/admin` shows only aggregates ("5 players tried it, nobody reached level 2") — we can't see *why*
players drop off. This feature captures **every** gameplay session as a deterministic input-replay
(reusing `replay.js`: player INPUT + RNG seed, NOT a movie of positions), uploads the small trace to S3
via our own server, writes a metadata row to Postgres, and adds a `/admin/sessions` page with a
**▶ play** link per session (`/?playback&id=…`) so the maintainer can watch exactly where each player
struggled or quit. Recording is **always on and invisible** to the player — no opt-in, no consent UI.

The load-bearing enabler: **all live gameplay is unified onto the deterministic fixed-timestep loop**
(the same fixed step `?record`/`?playback`/`?bench` already use) with the sim RNG seeded at level entry.
This is a deliberate strategic move toward a stable "tick" as a foundation (future multiplayer), not a
reluctant cost. A recorded session then replays bit-for-bit on the *same code version* — which is the
hard, inherent constraint of input-replay analytics (see Decisions below).

## Decisions (all settled — implementer must NOT re-ask)

1. **Recording is always on**, transparent to the player, for logged-in AND anonymous players. Starts at
   level entry (each launch/retry = a new session), flushes on session end (win/death) and on page unload
   via `navigator.sendBeacon` to catch tab-closers.
2. **Server-mediated upload.** The client POSTs the trace JSON to `POST /api/sessions`; the **server**
   uploads it to S3 and writes the DB row. No AWS creds on the client, no presigned URLs.
3. **All live play runs the deterministic loop** (fixed step + seeded sim RNG). Priority is **faithful
   reproduction on old/slow devices**: capture is **per sim-tick, decoupled from render frames**, so a
   frame drop / slow-motion stall does NOT corrupt the recording — the accumulator just catches up ticks
   on the next frame (or, on a huge stall, drops wall-clock time but records exactly the ticks that ran,
   which playback re-runs identically).
4. **Single tunable tick constant.** Reuse the existing fixed step (`BENCH_DT`); expose the rate as one
   named constant `TICK_HZ` (default **60**, maintainer may later try 30). Do NOT invent a second number.
5. **`game_version` = the deploy commit, stamped by the SERVER** from `process.env.SENTRY_RELEASE` (already
   the full git SHA — baked in `Dockerfile:22` from CI `--build-arg GIT_SHA`). No CI change needed. The
   admin **displays** it and shows a cheap "matches current deploy ✓/✗". **No automatic client-side
   version gating** in the playback path. Restoring an old engine for an old commit is explicitly
   **DEFERRED** — documented as a known limitation (the commit is stored so a future feature can do it).
6. **New `gameplay_sessions` table** (migration): `id` (server uuid, PK), `player_id` (nullable, logical
   FK only), `level`, `outcome`, `duration_ms`, `kills`, `s3_key`, `game_version`, `created_at`. **NOTE:
   the name `sessions` is already taken** by the auth token-session store (`db.js:129`, with an
   `idx_sessions_player` index) — this table MUST use a distinct name (`gameplay_sessions`) and a distinct
   index prefix (`idx_gsessions_*`), or `CREATE TABLE IF NOT EXISTS` silently no-ops against the wrong
   schema and every insert fails.
7. **New `/admin/sessions` page** (same Basic-Auth guard), columns: created, player (id or `anon`), level,
   outcome, duration, kills, game_version (+ ✓/✗), ▶ play link. The existing players page is untouched.
8. **Skip trivial sessions:** don't record/upload sessions shorter than **180 ticks (~3 s)**. Safety cap
   at **36000 ticks (~10 min)**: stop *appending* beyond that (the game keeps playing) to bound memory +
   upload size. **No TTL/retention job** yet (traffic is tiny — revisit later per §30).
9. **Privacy:** input-replay only, no screen capture, no PII beyond the already-collected anon id. Silent
   recording on our own domain is acceptable — **no consent UI**. (No strong reason to add one.)

### Known limitation to document (not a bug)
A stored trace reproduces faithfully **only on the code version it was recorded on** (`game_version`).
On a version mismatch, playback may diverge (different physics/spawns). We store the commit and surface a
✓/✗ in admin; we do NOT attempt to reconstruct old engines. This is inherent to input-replay analytics.

### Beacon size limitation to document (accepted for v1)
`navigator.sendBeacon` (and `keepalive` fetch) are capped at ~64 KB per request in most browsers. A long
abandoned session's trace can exceed that and will silently fail the unload flush. This is **acceptable
for v1** because the funnel we care about is *early* drop-off ("nobody reached level 2") — those traces
are small (tens of seconds) and fit. Win/death flushes use a normal `fetch` (page stays open) with no
size issue. Chunked streaming + gzip are **deferred** (noted in Out of Scope).

---

## Steps

### Component A — Deterministic tick constant (`client/src/bench.js`)

**A1.** In `client/src/bench.js` near `export const BENCH_DT = 1 / 60;` (line 42), replace with a single
tunable rate that everything derives from:
```js
// The single tunable sim tick rate. ALL sim stepping — live play, ?record/?playback, ?bench, and the
// Level-0 cutscene — advances at this fixed step so a tick maps 1:1 across record and replay. The
// maintainer may lower this (e.g. 30) — it is not a twitch 3D shooter. Changing it changes every NEW
// recording's dt; old traces carry their own dt and still replay at the rate they were recorded.
export const TICK_HZ = 60;
export const BENCH_DT = 1 / TICK_HZ;   // kept as BENCH_DT so existing importers are unchanged
```
No other file needs to change for the constant — `BENCH_DT` keeps its name and value; `TICK_HZ` is the
knob. (Every current `BENCH_DT` importer — `main.js`, `replay.js` docs — is unaffected.)

### Component B — Session recorder core (new `client/src/session-record.js`)

Pure, DOM-free, engine-free (like `replay.js`) so it is unit-testable under `node --test` (no jsdom).
Holds the per-session capture state + the floor/cap policy + trace assembly. Mirrors the
`makeReplaySession()` factory pattern in `replay.js`.

**B1.** Create `client/src/session-record.js`:
```js
// Always-on gameplay session recorder (docs/plans/2026-08-03-1246-record-all-sessions.md). Every live
// session is captured as a deterministic input-replay (seed + per-tick input, reusing replay.js) and
// uploaded for funnel analytics. This is the PURE half: the capture lifecycle + the floor/cap policy +
// trace assembly. main.js owns the wiring (seed install, the accumulator capture, the network flush).
import { makeTrace, normalizeLevelName } from './replay.js';

// Don't store sub-3s bounces (junk rows). Stop appending past ~10min to bound memory + upload size
// (the game keeps playing; the tail is simply not recorded). Both in sim ticks at the fixed step.
export const MIN_SESSION_TICKS = 180;    // ~3 s at 60 Hz
export const MAX_SESSION_TICKS = 36000;  // ~10 min at 60 Hz

// One live recording. begin() at level entry; captureTick() once per sim tick from the accumulator;
// end(outcome, meta) exactly once (win/death/unload) → the flush payload or null (below floor / already
// flushed / no seed). Kept as one object so the whole cluster resets together on a new session.
export function makeSessionRecorder() {
  return {
    active: false,       // true between begin() and end()
    flushed: false,      // end() ran once → guards win+unload double-send
    seed: 0, level: null, shipId: null, loadout: null, components: null, dt: 0,
    ticks: [],
    begin({ seed, level, shipId, loadout, components, dt }) {
      this.active = true; this.flushed = false;
      this.seed = seed >>> 0; this.level = normalizeLevelName(level);
      this.shipId = shipId ?? null; this.loadout = loadout || null; this.components = components || null;
      this.dt = dt; this.ticks = [];
    },
    captureTick(snapshot) { if (this.active && this.ticks.length < MAX_SESSION_TICKS) this.ticks.push(snapshot); },
    // Returns { trace, level, outcome, durationMs, kills } to POST, or null if nothing should be sent.
    end(outcome, { durationMs = 0, kills = 0 } = {}) {
      if (!this.active || this.flushed) return null;
      this.flushed = true; this.active = false;
      if (this.ticks.length < MIN_SESSION_TICKS) return null; // trivial bounce → drop
      const trace = makeTrace({
        id: null, level: this.level, seed: this.seed, dt: this.dt,
        shipId: this.shipId, loadout: this.loadout, components: this.components, ticks: this.ticks,
      });
      return { trace, level: this.level, outcome, durationMs, kills };
    },
  };
}
```

**B2.** Create `client/src/session-record.test.js` (unit tests, run with `cd client && node --test`):
- `begin()` then 200 `captureTick()`s then `end('win', {kills:3,durationMs:9000})` → returns a payload
  whose `trace.ticks.length === 200`, `trace.seed`/`dt`/`level` set, `outcome==='win'`.
- Below floor: `begin()`, 10 ticks, `end('quit')` → `null` (trivial bounce dropped).
- Double-flush guard: after a successful `end()`, a second `end()` → `null`.
- Cap: `begin()`, push `MAX_SESSION_TICKS + 500` → `ticks.length === MAX_SESSION_TICKS`.
- `end()` before any `begin()` → `null`.

### Component C — Wire always-on capture into the engine (`client/src/main.js`)

**C1.** Near the other replay imports (`main.js:30`), add:
```js
import { makeSessionRecorder } from './session-record.js';
```
and after `const rs = makeReplaySession();` (around `main.js:66`), add:
```js
const sr = makeSessionRecorder(); // always-on live-session recorder (funnel analytics)
```
Export it on the debug hook if convenient (optional): add `sessionRec: () => sr` to the `window.__replay`
object (near `main.js:1292`) for live inspection — not required.

**C2.** Add `beginLiveSession()` (place it right after `startPlaybackSession`, ~`main.js:1079`). It seeds
the sim + arms `sr`, mirroring `beginRecordCapture` but for real play (NOT read-only — real progress
runs). It is a **no-op in every dev/headless mode** so it never fights the intro/record/playback/bench:
```js
// Begin a real, recorded live session. Called by the launch/retry flows JUST BEFORE their reset()
// (reset() draws the sim RNG for spawn timing, so the seed must be installed first — same ordering as
// beginRecordCapture). No-op under ?record/?playback/?bench and during the intro cutscene: those own the
// seed/loop, and a (re)played fight must never be re-recorded.
export function beginLiveSession() {
  if (REC || rs.play || BENCH || G.replayMode) return;
  const seed = (Date.now() >>> 0);
  seedSim(seed); // install the seeded gameplay stream for THIS session
  const shipId = (CATALOG.shipByName.get(G.currentShipName) || {}).id ?? 1;
  const activeMatches = G.activeShip && G.activeShip.ship && G.activeShip.ship.name === G.currentShipName;
  sr.begin({
    seed, level: CATALOG.levelName || 'level-1', shipId,   // the SEED NAME (level-N), stashed at each CATALOG.level set (C2a)
    loadout: activeMatches ? G.activeShip.loadout : null,
    components: activeMatches ? G.activeShip.components : null,
    dt: BENCH_DT,
  });
  replayAcc = 0;
}
```

**C2a — stash the seed level NAME (critical: without this every level-2+ row is mislabeled AND replays the
wrong fight).** The server's level payload is `{ name, descriptor }`: `name` is the seed name (`level-2`,
`level-3`, …), `descriptor` is the map/enemy data. Today only `descriptor` survives — `CATALOG.level =
level.descriptor` **discards `level.name`** at all three assignment sites. The trace `level` must be that
seed name (playback's bootstrap does `fetchJson('/api/levels/' + trace.level)` → `reset()` rebuilds it),
so stash `level.name` on `CATALOG` next to every `CATALOG.level = …`:
- `client/src/main.js:1402` — `CATALOG.level = level.descriptor;` → add `CATALOG.levelName = level.name;`
- `client/src/net.js:114` — `CATALOG.level = level.descriptor;` (in `unlockNextLevel`) → add
  `CATALOG.levelName = level.name;`
- `client/src/account.js:280` — `CATALOG.level = level.descriptor;` → add `CATALOG.levelName = level.name;`
Add `levelName: null, // the active level's SEED NAME (level-N) — the trace level for session recording`
to the `CATALOG` object in `client/src/state.js` (after `level: null,` at line 103) so the field exists
before the first assignment. **No `level-1` fallback masks a real campaign level** — the
three sites above always set it before any live launch; `'level-1'` only guards the impossible pre-boot
case. Do NOT use `net.js currentLevelLabel()` (a human display string like `"mission:…"`, unusable as a
seed name).

- `beginLiveSession` must be **exported** from `main.js` so `mainwindow.js` can call it.

**C3.** Broaden the `animate()` fixed-timestep block so **live play uses the accumulator** and is captured.
In `main.js` change the outer gate at line 645 and the inner arming/capture. Current:
```js
  if (REC || rs.play) {
    ...
    if ((recCapturing || rs.armed) && !G.paused && !cutFrozen) {
```
Change to:
```js
  const live = G.gameStarted && !BENCH && !REC && !rs.play; // real player session → deterministic loop
  if (REC || rs.play || live) {
    ...
    if ((recCapturing || rs.armed || live) && !G.paused && !cutFrozen) {
```
Inside the `while` loop, the input branch currently is `if (rs.cutReturning) {…} else if (rs.play && rs.trace) {…}`.
For `live`, do NOT touch `keys`/`touchAim` (use the operator's real input as-is) — no extra branch needed;
just fall through to `update(BENCH_DT)`. After the existing dev capture line
`if (recCapturing) recTicks.push(snapshotInput(keys, touchAim));` add the live capture:
```js
        if (live) sr.captureTick(snapshotInput(keys, touchAim));
```
Leave the `else { … update(dt) … benchRecording … }` branch as-is — it now only handles the **menu**
(`!G.gameStarted`, sim idles) and **`?bench` record**. **Verify** the bench record path (`benchRecording`)
still hits the `else` branch: `live` is false when `BENCH` is truthy, so bench is unaffected.

Guard against a frozen game: because `live` is in the outer gate AND the inner arm condition, a live
session always steps even if `sr` failed to arm — recording is a passive rider, never a gate on play.

**C4.** Add a network flush helper in `main.js` (near the pagehide listener, ~`main.js:382`), and call it
on win, death, and unload. Import `postSession` from `net.js` (Component D):
```js
// Flush the current live recording exactly once (win/death → fetch; unload → sendBeacon). Reads live
// duration/kills at flush time. Below-floor / already-flushed sessions send nothing (sr.end returns null).
export function flushSession(outcome, { beacon = false } = {}) {
  const payload = sr.end(outcome, {
    durationMs: Math.round(performance.now() - G.gameStartTime),
    kills: G.kills,
  });
  if (payload) postSession(payload, { beacon });
}
```
Wire the unload flush into the existing `pagehide` listener (`main.js:382`), after the `track('quit', …)`
call — best-effort beacon:
```js
addEventListener('pagehide', () => {
  if (G.quitSent || !G.gameStarted) return;
  ...
  track('quit', { level: currentLevelLabel() });
  flushSession('quit', { beacon: true }); // best-effort: large traces may exceed the ~64KB beacon cap (documented)
});
```
Also flush on `visibilitychange → hidden` for mobile backgrounding is **not** added (pagehide covers tab
close + mobile background; avoid double flush). Keep it to pagehide + win/death.

**Seed lifecycle (invariant now changed).** `flushSession`/`sr.end()` intentionally do **NOT** call
`seedSim(null)` — under always-on recording, live play is now *always* seeded, and the next
`beginLiveSession` reseeds before the next `reset()`. A stale seed lingering on the post-win/death menu is
harmless: menu/backdrop cosmetics draw plain `Math.random` (DECISIONS §73), never `simRandom`, so nothing
consumes the leftover stream. **Update the now-outdated comment at `main.js:1042`** (`stopRecordSession`'s
`seedSim(null) // … never leave live play on a stale seeded stream`): that "always clear the seed for live
play" rule no longer holds — live play is seeded by design; only the *dev* `?record` session clears its
seed on stop (it returns the operator to an unseeded menu). Reword it to say the dev record path clears its
own seed on stop, while normal play stays seeded per session.

**C5.** Extend `loadTrace` (`main.js:972`) so an admin `/?playback&id=<sessionId>` can resolve a session
trace from the server (localStorage miss → static `/recordings/` miss → the new API route):
```js
async function loadTrace(id) {
  const key = id || 'last';
  try { const s = localStorage.getItem(`replay:${key}`); if (s) return JSON.parse(s); } catch {}
  if (id) {
    try { const r = await fetch(`/recordings/${id}.json`); if (r.ok) return await r.json(); } catch {}
    try { const r = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(id)}/trace`); if (r.ok) return await r.json(); } catch {}
  }
  return null;
}
```
`API_BASE` is already imported in `main.js` (used elsewhere); confirm and reuse. On the prod origin it is
`''` so the fetch is same-origin, matching where `/admin` runs.

### Component D — Client network flush (`client/src/net.js`)

**D1.** Add `postSession` to `client/src/net.js` (after `bankRun`, ~line 38). Best-effort, never throws,
never blocks gameplay (matches the other telemetry senders):
```js
// Upload one finished/abandoned session recording for funnel analytics (docs/plans/2026-08-03-1246-record-all-sessions.md).
// The SERVER uploads the trace to S3 + writes the metadata row + stamps game_version (client never touches AWS).
// `beacon` (unload path) uses sendBeacon — best-effort; large traces may exceed the ~64KB cap and drop.
export function postSession({ trace, level, outcome, durationMs, kills }, { beacon = false } = {}) {
  const body = JSON.stringify({ playerId: G.playerId || null, trace, level, outcome, durationMs, kills });
  try {
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(API_BASE + '/api/sessions', new Blob([body], { type: 'application/json' }));
    } else {
      fetch(API_BASE + '/api/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
      }).catch(() => {});
    }
  } catch { /* recording upload must never break the game */ }
}
```

**D2.** In `client/src/sim.js`, import `flushSession` from `main.js`? — **No.** `sim.js` already imports
from `net.js` but `flushSession` lives in `main.js` (it holds `sr`). Avoid a `sim.js → main.js` import
(main.js imports sim.js → cycle used at init). Instead, expose the flush via the shared bag `G`: in
`main.js` `beginLiveSession`/wiring, set `G.flushSession = flushSession;` once at boot (e.g. right after
defining it). Then in `sim.js`:
- Victory: inside the `if (!G.replayMode) { … }` block at `sim.js:142`, after `bankRun()`, add
  `G.flushSession && G.flushSession('win');`.
- Death: at `sim.js:793` after `bankRun()`, add `G.flushSession && G.flushSession('death');`.
This keeps `sim.js` dependency-free of `main.js`. (Precedent: the codebase already hangs shared runtime
handles on `G`.)

### Component E — Start a session at each live launch/retry (`client/src/mainwindow.js`)

**E1.** Import `beginLiveSession` in `client/src/mainwindow.js` (it already imports from `main.js`? — check;
if not, add `import { beginLiveSession } from './main.js';`). **If a `mainwindow.js → main.js` import
would create a load-time cycle** (main.js imports mainwindow.js at `main.js:33`), it is safe here because
`beginLiveSession` is only *called* on a click, not at module init — ES module cyclic live-bindings
resolve by call time. Verify no other `mainwindow.js` top-level code uses the binding at init.

**E2.** Call `beginLiveSession()` immediately **before** each `reset()` that starts a real **campaign**
fight — **NOT** side missions:
- `launchCampaign()` — before `reset();` at `mainwindow.js:73`.
- `leaveOverlay()` loss-retry — before `reset(); // loss → straight retry` at `mainwindow.js:87`.

**Do NOT wire `launchMission()` (`mainwindow.js:260`) in v1.** A side-mission descriptor is generated
server-side inline (`server/src/missions.js`, DECISIONS §18) and is **not refetchable** via
`/api/levels/:name`, so a `/?playback&id=…` bootstrap would `fetch('/api/levels/mission-…')` → 404 → the
`Promise.all` load dies and playback shows nothing. Side missions are post-endgame grind, outside the
"nobody reaches level 2" funnel we care about, so **skip them entirely for v1** (§30). (A future iteration
that wants them must persist the generated descriptor alongside the trace and reconstruct it on playback —
explicitly out of scope here.)

Guard note: the loss-retry `leaveOverlay()` `reset()` at `mainwindow.js:87` also fires after a *side
mission* loss. To keep v1 strictly campaign-only, gate that call on `!G.activeMission` (a side mission sets
`G.activeMission`; the campaign clears it in `launchCampaign` at `mainwindow.js:65`). So: `if
(!G.activeMission) beginLiveSession(); reset();`. `beginLiveSession` itself also early-returns in dev
modes, but the `!G.activeMission` guard is what keeps side-mission retries unrecorded.

(Victory does not immediately reset into a new fight — it lands on the Main Window; the next campaign
Take-off runs `launchCampaign` → a fresh session. So these sites cover every recorded campaign session.)

### Component F — Server: S3 upload/fetch (new `server/src/s3.js`)

**F1.** Create `server/src/s3.js` — hand-rolled SigV4 (mirror `server/src/ses.js`'s pattern; **no
`@aws-sdk` dependency**). Reads creds from env (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`,
`AWS_REGION`|`AWS_DEFAULT_REGION`, `ASSETS_BUCKET`). Degrades gracefully when creds/bucket are absent
(returns `{ ok:false }` for put; `null` for fetch) so `npm test` (no AWS creds) and any misconfigured env
never crash the route.
```js
// Minimal S3 PutObject/GetObject over hand-rolled SigV4 (no @aws-sdk dep — same approach as ses.js).
// Used to store/serve gameplay session recordings (docs/plans/2026-08-03-1246-record-all-sessions.md).
import crypto from 'node:crypto';

const REGION = () => process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const BUCKET = () => process.env.ASSETS_BUCKET || 'vega-sentinels-assets';
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();
function signingKey(secret, date, region, service) {
  return hmac(hmac(hmac(hmac('AWS4' + secret, date), region), service), 'aws4_request');
}
const haveCreds = () => !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
// Encode each key segment but keep the '/' separators.
const encKey = (key) => key.split('/').map(encodeURIComponent).join('/');

// Sign + send one S3 request (virtual-hosted style). body is a Buffer (PUT) or null (GET). Returns the fetch Response.
async function s3Request(method, key, body) {
  const region = REGION(), bucket = BUCKET(), service = 's3';
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const now = new Date();
  const amzdate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');       // YYYYMMDDTHHMMSSZ
  const dateStamp = amzdate.slice(0, 8);
  const payloadHash = body ? crypto.createHash('sha256').update(body).digest('hex') : sha256hex('');
  const canonicalUri = '/' + encKey(key);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzdate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzdate}\n${scope}\n${sha256hex(canonicalRequest)}`;
  const signature = hmac(signingKey(process.env.AWS_SECRET_ACCESS_KEY, dateStamp, region, service), stringToSign).toString('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${process.env.AWS_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const headers = { 'X-Amz-Date': amzdate, 'X-Amz-Content-Sha256': payloadHash, Authorization: authorization };
  if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(body.length); }
  return fetch(`https://${host}${canonicalUri}`, { method, headers, body: body || undefined });
}

// Upload a JSON trace. Returns { ok, key }. No-op (ok:false) when creds/bucket are absent.
export async function putTrace(key, jsonString) {
  if (!haveCreds()) return { ok: false, key };
  try {
    const res = await s3Request('PUT', key, Buffer.from(jsonString, 'utf8'));
    return { ok: res.ok, key };
  } catch (e) { console.warn('[s3] putTrace failed:', e?.message); return { ok: false, key }; }
}

// Fetch a JSON trace by key. Returns the parsed object or null.
export async function getTrace(key) {
  if (!haveCreds()) return null;
  try {
    const res = await s3Request('GET', key, null);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { console.warn('[s3] getTrace failed:', e?.message); return null; }
}
```
**Ops prerequisite (call out in the deploy step / SUMMARY):** the server's IAM key (the one already used
for SES) needs `s3:PutObject` + `s3:GetObject` on `arn:aws:s3:::vega-sentinels-assets/recordings/sessions/*`,
and the server `.env` must include `ASSETS_BUCKET` (+ region). If the current SES key is SES-scoped only,
grant it these S3 permissions or add a dedicated key. Without them, uploads no-op silently (rows still
write with the computed `s3_key`, but the trace won't be in S3 and playback 404s).

### Component G — Server: DB table + queries (`server/src/db.js`)

**G1.** In `migrate()` (add near the `perf_samples` block, ~`db.js:153-166`), create the table. **The name
`sessions` is ALREADY the auth token-session store (`db.js:129`), and `idx_sessions_player` already exists
(`db.js:136`)** — so this table uses `gameplay_sessions` + `idx_gsessions_*`. Reusing either name is a
silent `IF NOT EXISTS` no-op → zero rows stored. Do NOT touch the existing `sessions` table.
```sql
    -- gameplay session recordings (docs/plans/2026-08-03-1246-record-all-sessions.md). One row per
    -- recorded session; the trace itself lives in S3 (s3_key). player_id nullable + logical FK only
    -- (anon players; matches perf_samples/events). game_version = the deploy commit (SENTRY_RELEASE).
    -- NB: NOT named `sessions` — that name is the auth token store (see above). Distinct index prefix too.
    CREATE TABLE IF NOT EXISTS gameplay_sessions (
      id           TEXT    PRIMARY KEY,
      player_id    TEXT,
      level        TEXT    NOT NULL,
      outcome      TEXT    NOT NULL,          -- win | death | quit
      duration_ms  INTEGER NOT NULL DEFAULT 0,
      kills        INTEGER NOT NULL DEFAULT 0,
      s3_key       TEXT    NOT NULL,
      game_version TEXT,
      created_at   BIGINT  NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gsessions_created ON gameplay_sessions(created_at);
    CREATE INDEX IF NOT EXISTS idx_gsessions_player  ON gameplay_sessions(player_id);
```

**G2.** Add datastore functions (near `recordPerfSample`/`getPerfSamples`, ~`db.js:462-480`). They are
auto-exported by `datastore.js` (`export * from './db.js'`):
```js
// Insert one recorded-session metadata row (the trace lives in S3 at s3_key). Best-effort caller.
export async function recordSession({ id, playerId, level, outcome, durationMs, kills, s3Key, gameVersion }) {
  await pool.query(
    `INSERT INTO gameplay_sessions (id, player_id, level, outcome, duration_ms, kills, s3_key, game_version, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
    [id, playerId ?? null, level, outcome, durationMs | 0, kills | 0, s3Key, gameVersion ?? null, Date.now()]);
  return { id };
}

// Recent sessions for the /admin/sessions page (newest first).
export async function getAdminSessions(limit = 500) {
  const { rows } = await pool.query(
    `SELECT id, player_id, level, outcome, duration_ms, kills, s3_key, game_version, created_at
     FROM gameplay_sessions ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({
    id: r.id, playerId: r.player_id ?? null, level: r.level, outcome: r.outcome,
    durationMs: Number(r.duration_ms), kills: Number(r.kills), s3Key: r.s3_key,
    gameVersion: r.game_version ?? null, createdAt: Number(r.created_at),
  }));
}

// One session's s3_key (for the trace-serving route).
export async function getSessionS3Key(id) {
  const { rows } = await pool.query('SELECT s3_key FROM gameplay_sessions WHERE id = $1', [id]);
  return rows[0]?.s3_key ?? null;
}
```

### Component H — Server: API routes (`server/src/server.js`)

**H1.** Import the new pieces. Add to the `datastore.js` import list (`server.js:8-11`):
`recordSession, getAdminSessions, getSessionS3Key`. Add near the other module imports:
`import { putTrace, getTrace } from './s3.js';`.

**H2.** The global body parser (`server.js:71` `app.use(express.json());`) defaults to ~100 KB — a replay
trace is larger. Scope a bigger limit to just this route without enlarging every endpoint:
```js
const jsonParser = express.json();                    // ~100kb default — every normal route
const sessionJson = express.json({ limit: '3mb' });   // replay traces are larger
app.use((req, res, next) =>
  (req.path === '/api/sessions' && req.method === 'POST') ? next() : jsonParser(req, res, next));
```
(Replaces line 71.)

**H3.** Add the routes (near `/api/perf`, ~`server.js:406`). Stamp `game_version` from the server env;
generate the id + s3_key server-side; reject junk + oversized traces:
```js
  const GAME_VERSION = process.env.SENTRY_RELEASE || null;          // the deploy commit (Dockerfile bakes GIT_SHA)
  const SESSION_OUTCOMES = new Set(['win', 'death', 'quit']);

  // Store one gameplay session recording (docs/plans/2026-08-03-1246-record-all-sessions.md). The client
  // sends the input-replay trace; we upload it to S3 and write the metadata row. Best-effort, fire-and-forget.
  app.post('/api/sessions', sessionJson, wrap(async (req, res) => {
    const b = req.body || {};
    const { trace, level, outcome, durationMs, kills } = b;
    const playerId = (typeof b.playerId === 'string' && b.playerId) ? b.playerId : null;
    if (!trace || typeof trace !== 'object' || !Array.isArray(trace.ticks) || trace.ticks.length === 0) return res.status(400).end();
    if (trace.ticks.length > 40000) return res.status(413).end();     // hard server cap (~11 min at 60Hz)
    if (typeof level !== 'string' || !SESSION_OUTCOMES.has(outcome)) return res.status(400).end();
    const id = crypto.randomUUID();
    const s3Key = `recordings/sessions/${id}.json`;
    try {
      await putTrace(s3Key, JSON.stringify(trace));                    // no-op when creds absent (row still written)
      await recordSession({ id, playerId, level, outcome, durationMs, kills, s3Key, gameVersion: GAME_VERSION });
    } catch { /* best-effort telemetry */ }
    res.status(204).end();
  }));

  // Serve a session's trace for admin playback (/?playback&id=…). INTENTIONALLY UNAUTHENTICATED: a trace
  // is seed + input only (no PII, no screen capture), keyed by an unguessable UUID, so an unauth GET is an
  // acceptable trade for a dead-simple playback page (the client's loadTrace fetches it directly). 404 when
  // unknown or S3 unavailable. (If we ever want it locked down, gate it behind the same Basic-Auth as /admin.)
  app.get('/api/sessions/:id/trace', wrap(async (req, res) => {
    const key = await getSessionS3Key(req.params.id);
    if (!key) return res.status(404).end();
    const trace = await getTrace(key);
    if (!trace) return res.status(404).end();
    res.json(trace);
  }));
```
`crypto` is imported in `admin.js` but not `server.js` — add `import crypto from 'node:crypto';` at the
top of `server.js` if absent.

### Component I — Admin `/admin/sessions` page (`server/src/admin.js`)

**I1.** Add a `renderSessionsPage(sessions, currentVersion)` function and mount `GET /admin/sessions`. Reuse
the existing `esc`/`fmtDate`, the `checkAuth` guard, the same `<style>` block, and the column-sort script.
```js
const fmtDur = (ms) => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}m ${s % 60}s`; };

function renderSessionsPage(sessions, currentVersion) {
  const rows = sessions.map((s) => {
    const v = s.gameVersion || '';
    const match = v && currentVersion ? (v === currentVersion ? ' ✓' : ' ✗') : '';
    return `
    <tr>
      <td data-sort="${s.createdAt}">${fmtDate(s.createdAt)}</td>
      <td title="${esc(s.playerId || '')}"><code>${s.playerId ? esc(s.playerId.slice(0, 8)) : 'anon'}</code></td>
      <td>${esc(s.level)}</td>
      <td>${esc(s.outcome)}</td>
      <td data-sort="${s.durationMs}" class="num">${fmtDur(s.durationMs)}</td>
      <td data-sort="${s.kills}" class="num">${s.kills}</td>
      <td title="${esc(v)}"><code>${esc(v.slice(0, 8))}</code>${match}</td>
      <td><a href="/?playback&id=${esc(s.id)}" target="_blank" rel="noopener">▶ play</a></td>
    </tr>`;
  }).join('');
  const headers = ['created', 'player', 'level', 'outcome', 'duration', 'kills', 'version', 'watch'];
  const ths = headers.map((h, i) => `<th data-col="${i}">${esc(h)}</th>`).join('');
  // ... same <html>/<style>/<script> shell as renderPage, title "Vega Sentinels — sessions",
  //     heading `Sessions — ${sessions.length}`, table id="t" with ths + rows.
}
```
**I2.** Extend `mountAdmin` to accept + mount the sessions view. Change the signature to inject both
datastore fns and the current version:
```js
export function mountAdmin(app, getAdminPlayers, getAdminSessions, currentVersion) {
  app.get('/admin', async (req, res, next) => { /* unchanged */ });
  app.get('/admin/sessions', async (req, res, next) => {
    try {
      if (!checkAuth(req, res)) return;
      const sessions = await getAdminSessions(500);
      res.type('html').send(renderSessionsPage(sessions, currentVersion));
    } catch (e) { next(e); }
  });
}
```
Add a small nav link on the existing `/admin` players page (in `renderPage`, near the `<h1>`): 
`<p><a href="/admin/sessions">→ session recordings</a></p>` so the two pages cross-link.

**I3.** Update the call site in `server.js` (`server.js:mountAdmin(app, getAdminPlayers);`) to:
```js
mountAdmin(app, getAdminPlayers, getAdminSessions, process.env.SENTRY_RELEASE || null);
```

---

## Replay / intro impact

This change alters the deterministic re-sim path (it seeds live play + routes it through the accumulator),
so per the "sim change → run the intro guard" rule, verify the intro is unaffected:
- `beginLiveSession` is a **no-op** under `?record`/`?playback`/`?bench` and while `G.replayMode` is set
  (the intro cutscene runs via `startPlaybackSession` → `rs.play` truthy + `G.replayMode`). The intro
  never installs a live seed and is never captured/uploaded.
- The `animate()` gate uses `live = G.gameStarted && !BENCH && !REC && !rs.play`, so the intro (rs.play)
  and bench stay on their existing branches — the cutscene/return-to-base/stall logic is untouched.
- **Run `node visual/run.mjs 22-intro-replay`** (asserts 4 kills + p0..p4 + win) after implementing.
- **Stage-9 live check:** reset progress → play the intro end-to-end → confirm it still reaches victory +
  the Level 1 briefing, then take off into Level 1 and confirm a `gameplay_sessions` row appears with a working
  ▶ play link.

## Tests

- **Client unit:** `client/src/session-record.test.js` (Component B2). Run `cd client && node --test`
  (expect the existing green suite + the new file). No jsdom — `session-record.js` is pure.
- **Client visual — FULL suite before AND after (required, not just the intro).** Unifying live play onto
  the fixed-step accumulator changes the sim stepping for **every** `?debug` playable scenario — roughly
  half of the ~28 visual scenarios drive the real `animate()` rAF loop (e.g. `04-combat`, `08-arena`,
  `11-l4-enemies`, `16-enemy-health-bar`, `17-triple-spiral-rocket`, `20-warp-blast`, `25-enemy-shield`,
  …), so the timing change is global. **Run the full suite (`node visual/run.mjs`) on the base commit
  first to record the baseline pass/flake set, then again after the change**, and confirm the
  **reliably-passing set is unchanged** with zero page errors. The suite has a known-flaky baseline (~6
  scenarios flake at baseline — judge by the stable set, not a raw count; re-run a lone failure once before
  calling it a regression, per the stale-module-flake note).
- **Intro guard:** `node visual/run.mjs 22-intro-replay` (asserts 4 kills + p0..p4 + win) — the intro must
  still reach victory + the Level 1 briefing (the intro path is deliberately excluded from live recording).
- **Server:** add a test (e.g. `server/test/gameplay-sessions.test.js`, following the existing db/route
  test style) that runs against Postgres (`cd server && npm test` drops+recreates `spacegame_test` via
  pretest). Include a guard asserting the new `gameplay_sessions` table is distinct from the auth
  `sessions` table (e.g. `recordSession` writes a row that a `SELECT … FROM sessions` never returns) so a
  future rename can't silently re-collide:
  - `recordSession(...)` then `getAdminSessions()` returns the row with coerced numbers + nullable
    `playerId` (test both a real id and `null`).
  - `getSessionS3Key(id)` returns the key; unknown id → `null`.
  - Route test for `POST /api/sessions`: a valid body → 204 and a row exists (S3 `putTrace` no-ops without
    creds — assert the DB row, not S3). Junk body (no ticks) → 400; oversized ticks (>40000) → 413.
  - `GET /admin/sessions` with Basic Auth → 200 HTML containing a `/?playback&id=` link; without auth →
    401; admin disabled (env unset) → 404. (Follow the existing admin test if present.)
- **Manual/live (Stage 9) — MUST verify the NEW live-recording path end-to-end (the unit + intro tests
  cover only the OLD record→re-sim path; nothing else exercises `beginLiveSession`):**
  1. Reset progress → play the intro end-to-end → confirm it reaches victory + the Level 1 briefing.
  2. Take off into **Level 1** and win it → confirm a `gameplay_sessions` row appears with `level=level-1`,
     `outcome=win`, correct kills, and the deploy `game_version` (✓ match).
  3. Advance to **Level 2** (or later) and confirm the recorded row's `level` is `level-2` (not `level-1`) —
     this is the Fix-2 regression check (mislabeled level = broken funnel).
  4. Open `/admin/sessions`, click **▶ play** on the Level-1 row, and **assert the live-recorded replay
     reproduces the same outcome/kills** as the original run (same enemies die, same win/death). This is the
     only test that verifies a `beginLiveSession`-captured trace is faithful — do not skip it.
  5. Close the tab mid-Level-1 fight after >3 s → confirm a `quit` row appears (small trace → beacon fits).

## Docs to update

- **`docs/SUMMARY.md`:**
  - Backend section (near the `/api/games` bullet ~line 1668 and the `perf_samples` description ~line 143):
    add a **"Session recordings"** bullet — always-on input-replay capture of every live **campaign**
    session (side missions excluded in v1), server S3 upload + the **`gameplay_sessions`** table (schema;
    note it is distinct from the auth `sessions` token table), `POST /api/sessions` +
    `GET /api/sessions/:id/trace` (**intentionally unauthenticated** — seed+input, no PII, unguessable
    UUID), `game_version` = deploy commit, the trivial-session floor (180 ticks) + cap (36000), and the
    version-match limitation.
  - Admin dashboard section (~line 1725): add the new `/admin/sessions` page (columns + ▶ play link +
    ✓/✗ version match).
  - Combat record/playback section (~line 353): note that **all live play now runs the deterministic
    fixed-step loop** (seeded at level entry), `TICK_HZ` is the single tunable tick rate, and every live
    session is recorded (not just `?record`).
  - Bump the `**Updated:**` line/date.
- **`docs/CHANGELOG.md`:** add a dated bullet under `## 2026-08-03` — **"Record all sessions for funnel
  analytics"**: always-on deterministic capture, S3 + `gameplay_sessions` table, `/admin/sessions` playback links,
  and the unification of live play onto the fixed tick (`TICK_HZ`). Note the ops prerequisite (server IAM
  key needs S3 Put/Get on `recordings/sessions/*` + `ASSETS_BUCKET` in the server `.env`).
- **`docs/DECISIONS.md`:** add **§85 — Deterministic tick + always-on session recording**. Record the
  trade-off: unify all live play onto the fixed-step seeded loop (toward a stable tick for future
  multiplayer; faithful old-device reproduction over exact real-time under load — the accumulator caps
  steps/frame → slow-motion, never a corrupted recording); server-mediated S3 upload (no client creds);
  the input-replay analytics constraint (faithful only on matching `game_version`; old-engine restoration
  deferred); the beacon ~64KB limit accepted for v1 (early drop-off traces are small); no consent UI
  (input-replay, own domain). Record **campaign levels only** in v1 (side missions' server-generated
  descriptors aren't refetchable for playback). New table named **`gameplay_sessions`** to avoid colliding
  with the existing auth `sessions` table.

## Out of scope / non-goals (do NOT gold-plate — DECISIONS §30)

- **No multiplayer netcode.** The fixed tick is groundwork only; build nothing beyond capture/upload/admin.
- **Side missions are NOT recorded in v1** (their server-generated descriptors aren't refetchable for
  playback; they're post-endgame grind, outside the drop-off funnel). Do not add descriptor persistence.
- **No chunked/streamed upload and no gzip** — v1 flushes the whole trace on end (fetch) or a best-effort
  beacon on unload. Accept that very long *abandoned* sessions may exceed the beacon cap and drop.
- **No TTL / retention / cleanup job**, no S3 lifecycle rules — revisit when volume matters.
- **No automatic client-side version gating** and **no old-engine restoration** — store the commit, show
  ✓/✗, stop there.
- **No consent UI / cookie banner.**
- **No new admin analytics/aggregation** (drop-off charts, per-level funnels) — just the raw sessions list
  with playback links. Aggregation is a later feature.
- **Do not change** the `?record`/`?playback`/`?bench`/intro-cutscene behavior beyond routing them through
  the shared `TICK_HZ`-derived `BENCH_DT` (unchanged value).
