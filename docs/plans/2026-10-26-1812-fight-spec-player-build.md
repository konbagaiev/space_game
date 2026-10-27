# One fight spec, one player build — duplication audit Phase 4 (B4, B5 remainder, C12, C13)

**Date:** 2026-10-26. **Status:** implemented. **Size:** M, one pipeline run. **Replay-sensitive.**
**Parent brief:** [`2026-10-24-duplication-audit-closeout.md`](2026-10-24-duplication-audit-closeout.md) §Phase 4.
**Evidence:** [`2026-10-20-duplication-audit.md`](2026-10-20-duplication-audit.md) §B4, §B5, §C12, §C13.
Line numbers below were re-read on 2026-10-26 against `main` @ `3dbffa2`. They drift, so check each one before you edit.

## Goal

The dev flags that change the fight (`?ally`, `?lancer`, `?beam`, `?duel`, `?brawl`) are applied in five
places. Each place uses its own subset and its own order. So `?lancer` is lost after a level advance,
`?duel&netsim=1` runs one fight in the tab and a different one in the room, and an `?ally`/`?lancer`/`?beam`
session records as a plain campaign level whose replay diverges. The "effective player build" (beam + duel
overrides) is also written in five places, and the duel kit exists only in `client/src/duel-dev.js`.

After this change there is:
- **one fight spec**, parsed once from the URL (or read from a trace under `?playback`);
- **one `applyFightSpec`** in sim-core, used by the client and by `sim-host`;
- **one `resolvePlayerBuild`** in sim-core, used by the client builder, both recorders and `sim-host.buildShip`;
- traces that record the whole spec in `trace.room`.

The user-visible effects, all dev-only:
- `?duel&netsim=1` now works.
- `?lancer` survives a level advance.
- `?ally`/`?lancer`/`?beam` sessions play back as the fight that was flown, and their admin rows read `dev:level-N`.
- A `?beam` recording captures the beam.

Two small items ride along, both cosmetic for players:
- **C12:** netsim timing constants get one home, and `INTERP_DELAY_MS` is derived from them.
- **C13:** the live tick-deps builder is written once.

Campaign play does not change, and the Level-0 determinism fixture stays bit-identical.

## Decisions (chosen — do not re-ask)

1. **Spec shape.** `{ ally: phaseName|null, lancer: phaseName|null, beam: boolean, duel: {aces:N}|null, brawl: truthy|null }`.
   `NO_FIGHT_SPEC` is the frozen all-off spec. **`applyFightSpec(d, NO_FIGHT_SPEC)` and
   `resolvePlayerBuild(b, NO_FIGHT_SPEC)` return the SAME object** (identity). This is load-bearing for
   determinism and every unit test asserts it.
2. **One order** (the order `main.js:2244` and `sim-host.js:116-123` already use): `brawl` replaces everything
   (when it is set, the others are ignored). Otherwise ally, then lancer, then duel last. Duel discards the
   phase script the other two edit, so ally/lancer are no-ops under duel. That is today's behaviour, kept.
3. **Player build order:** beam first, duel last. Duel overrides `loadout`/`components`/`skills`, so beam is a
   no-op under duel. That is today's client behaviour (`duelBuild(…beamLoadout(…))`, `ship-build.js:63`), kept.
   The `ship` row is never replaced: a duel keeps the hull you fly, as `duelBuild` does today.
   **Brawl is asymmetric, on purpose:** `applyFightSpec` ignores `duel` under `brawl` (the brawl replaces the
   script), but `resolvePlayerBuild` has no brawl branch. So `?netbrawl&duel` hands the parked spectator ship the
   duel kit. That is harmless (it is never stepped) and is not worth a branch.
4. **`trace.room` shape (maintainer, Q1).** The change is additive and `TRACE_VERSION` stays 4:
   - **duel:** `{ kind:'duel', aces:N }` plus optional `ally`, `lancer`, `beam`. Each field is written only
     when set, so a plain duel is byte-identical to today's `{ kind:'duel', aces:N }`. Scenario 49 and the
     server duel fixtures rely on that.
   - **non-duel dev fight:** `{ kind:'dev', ally?, lancer?, beam? }`, with at least one of them set.
   - **campaign:** `room: null`, unchanged.
   - `brawl` is never recorded. Brawl sessions are not recorded at all: `brawl-host.js` never calls the recorder.
5. **Everything duel-specific stays duel-only:**
   - the anchor-digest seal (`main.js:1858`, changed from `sr.room` truthy to `sr.room?.kind === 'duel'`);
   - the referee (`server.js:606` `if (written && duel && anchor)`);
   - `verify-duel.js:48`;
   - the `duel:` row label.
6. **Row label (maintainer, Q2).** A `kind:'dev'` trace's row is labelled `dev:level-N` (`server.js:587-588`).
   Effect, verified: `normalizeLevelName('dev:level-4')` returns the string unchanged (`replay.js:45-49`), so
   `classifyTrace` returns `level-mismatch` and `verify-sessions.mjs` counts the row as unverifiable rather
   than as a false disagreement. That is the same treatment `duel:` gets.
7. **Playback takes the spec from the trace.** URL dev flags are ignored for the fight under `?playback`.
   - `fightSpecFromTrace(trace)`: `room == null` gives `NO_FIGHT_SPEC`; `kind:'duel'` gives `{ duel:{aces}, ally, lancer, beam }`;
     `kind:'dev'` gives `{ ally, lancer, beam }`.
   - An old `{kind:'duel',aces}` trace maps to exactly what `applyTraceRoom` builds today.
   - An old `room:null` trace maps to the identity.
8. **Beam is now recorded** (closes the "recording does not capture `?beam`" gap, audit §D). Both recorders store
   `resolvePlayerBuild(flownBuild(…), spec)`, so a `?beam` trace's `loadout` carries weapon 12 on its gun mounts.
   `room.beam: true` is recorded too. `withBeamGun` is idempotent (`beam-config.js:18-23` maps gun mounts onto
   `BEAM_WEAPON_ID`), so re-applying it on playback/referee is harmless. This gets **DECISIONS §170**.
9. **`?duel` is forwarded on the netsim handshake** as `duel=<aces>`. The room builds the duel room AND the duel
   kit (through `resolvePlayerBuild` in `buildShip`). Aces already travel on the wire (`room.js:139` `ace: 1`,
   `netsim-world.js:122` `makeAce`). That is verified by reading, not run, so a live check is on the checklist.
   **Forwarding alone is not enough — the tab also spawns its own aces** (critic): `reset()` → `startRun` →
   `startLevel` → `enterPhase` → `spawnAces` (`sim-core/level-runner.js:113`) puts 2 LOCAL aces in
   `world.enemies` the instant the run starts, and `applySnapshot` (`netsim-world.js:200-246`) only ever
   removes entities it created, so the tab would show 2 local + 2 room aces. **Fixed in step 5b**: when a
   room starts or restarts a run, the tab drops every enemy/ally that carries no network id. The same hole
   exists for an `?ally=<phase-0 name>` under netsim (`spawnAlly` on the first phase), and the same fix covers it.
   **Economy in a netsim duel** is the room's ordinary sink (`socket.js:166` `makeEconomySink`), and the duel
   room pays what the local duel pays: `xpReward: 0`, the aces carry no credit bounty, and only the normal
   20 % per-kill loot roll is deposited on victory. No special-casing.
10. **The per-flag URL parsers stay** (`evalAllyDev`, `evalLancerDev`, `evalBeamDev`, `evalDuelDev`,
    `evalBrawlDev`, with their tests and the `*DevLevel()` level-forcing helpers). The **per-flag apply
    wrappers go**, because the call-site guard forbids them and keeping them would leave five places that can
    still drift:
    - `applyAllyDev`, `applyLancerDev`, `applyDuelDev`, `applyTraceRoom`, `applyBrawlDev`;
    - `duelBuild`, `beamLoadout`, `setBeamDev`;
    - `allyDev()`/`lancerDev()`/`beamDev()` if they end up with no caller (grep).

    Keep `duelDev()`: `mainwindow.js:374` uses it for the direct launch. Keep `brawlDev()`/`brawlActive()`.
    The beam-dev comment "keep the two shapes as they are — do not unify them" (`beam-dev.js:89-91`) is about
    the parsers' import-time vs lazy resolution. The new client module resolves lazily, which covers both.
11. **One run, no split** (coordinator). B4 and B5 depend on each other, and C12/C13 are about 40 mechanical lines
    whose guards (22, 36) this run needs anyway.
12. **C12 frame clamp.** `MAX_FRAME_SEC = MAX_CATCHUP_STEPS * SIM_DT`, which is exactly `0.1` in IEEE doubles
    (verified: `node -e "console.log(6*(1/60))"` prints `0.1`). It replaces the two `0.1` literals at
    `main.js:1233,1245`. The **`0.05`** clamp at `main.js:1122` is a different thing (display dt for unfixed
    frames). Leave it alone.

## Steps

### 1. `client/src/sim-core/duel-config.js` — the duel kit moves in

`sim-core/duel-config.js` already exists: it holds `DUEL_PHASES`, `withDuelRoom` and `duelAnchorReached`.
Move these out of `client/src/duel-dev.js:58-69` and add them:
- `DUEL_LOADOUT`
- `DUEL_COMPONENTS`, with their comment block

Then add `withDuelKit(build)`, the body of `duelBuild` (`duel-dev.js:119-122`) without the flag check:

```js
export function withDuelKit(build) {
  return { ...build, loadout: DUEL_LOADOUT, components: DUEL_COMPONENTS, skills: null };
}
```

Move the `skills: null` / "a fleeing ace cannot be caught" comment (`duel-dev.js:110-118`) with it.
`duel-dev.js` re-exports `DUEL_LOADOUT`/`DUEL_COMPONENTS`, like it already re-exports `DUEL_PHASES`/`withDuelRoom`
(`duel-dev.js:52`), because `server/src/gameplay-sessions.test.js:190` and `server/src/seal/verify-duel.test.js:24`
import them from there. Alternatively,
repoint both imports to `sim-core/duel-config.js` and skip the re-export. The cleaner option is to repoint them.

### 2. `client/src/sim-core/fight-spec.js` — new, pure, host-neutral

Imports: `withAllyAt` (`ally-config.js:297`), `withLancersAt` (`lancer-config.js:15`), `withDuelRoom`/`withDuelKit`
(`duel-config.js`), `withBrawlRoom` (`brawl.js:74`), `withBeamGun` (`beam-config.js:18`), `ACE_COUNT_MAX` (`ace.js:45`).
It must not import anything from outside `sim-core` (DECISIONS §136; `sim-core/boundary.test.js` enforces this).

Exports (the snippet is illustrative; keep the semantics, not necessarily these exact lines):

```js
export const NO_FIGHT_SPEC = Object.freeze({ ally: null, lancer: null, beam: false, duel: null, brawl: null });

// The ONE order. Identity (same object) when nothing is set.
export function applyFightSpec(descriptor, spec = NO_FIGHT_SPEC) {
  if (!spec) return descriptor;
  if (spec.brawl) return withBrawlRoom(descriptor);
  let d = descriptor;
  if (spec.ally) d = withAllyAt(d, spec.ally);
  if (spec.lancer) d = withLancersAt(d, spec.lancer);
  if (spec.duel) d = withDuelRoom(d, spec.duel.aces);   // LAST: replaces the script the other two edit
  return d;
}

// The ONE effective player build. `build` = { ship?, shipId?, loadout, components, skills } (extra fields pass
// through). With beam on and no loadout, falls back to `ship.stats.mounts` — the recorder hands a null
// loadout when the flown ship is not the active ship (replay.js flownBuild), and the bootstrap built that
// ship's catalog mounts with the beam swapped in. Identity when nothing applies.
export function resolvePlayerBuild(build, spec = NO_FIGHT_SPEC) {
  if (!spec || !build) return build;
  let out = build;
  if (spec.beam) {
    const base = build.loadout || (build.ship?.stats?.mounts ? { mounts: build.ship.stats.mounts } : null);
    if (base) out = { ...out, loadout: withBeamGun(base) };
  }
  if (spec.duel) out = withDuelKit(out);                 // LAST: the duel forces the whole kit
  return out;
}

// spec → trace.room (Decision 4). Fields written only when set, so a plain duel is exactly {kind,aces}.
export function roomFromFightSpec(spec) { … }

// trace → spec (Decision 7). null/absent room → NO_FIGHT_SPEC; old {kind:'duel',aces} → {duel:{aces}}.
export function fightSpecFromTrace(trace) { … }
```

`fightSpecFromTrace` must return `NO_FIGHT_SPEC` itself (not a copy) for `room == null`, so the identity
fast-paths hold under playback of the intro and of every campaign trace.

### 3. `client/src/fight-spec-dev.js` — new, the browser's spec (next to the `*-dev.js` files)

```js
import { evalAllyDev } from './ally-dev.js';
import { evalBeamDev, evalLancerDev } from './beam-dev.js';
import { evalDuelDev } from './duel-dev.js';
import { evalBrawlDev } from './brawl-dev.js';
import { NO_FIGHT_SPEC, fightSpecFromTrace } from './sim-core/fight-spec.js';

// Pure: the URL alone decides. Returns NO_FIGHT_SPEC (same object) when no fight flag is present.
export function parseFightSpec(search) { … ally: evalAllyDev(s)?.phase ?? null, lancer: evalLancerDev(s)?.phase ?? null,
  beam: !!evalBeamDev(s), duel: evalDuelDev(s) ? { aces: evalDuelDev(s).count } : null, brawl: evalBrawlDev(s) ? true : null … }

let SPEC;   // resolved lazily on first ask (the ship builder asks mid-boot — beam-dev.js's reason for laziness)
export function fightSpec() { if (SPEC === undefined) SPEC = parseFightSpec(typeof location === 'undefined' ? '' : location.search); return SPEC; }
// ?playback: the fight is the one the TRACE was fought in, not the URL's (Decision 7).
export function useTraceFightSpec(trace) { SPEC = fightSpecFromTrace(trace); }
export function setFightSpec(s) { SPEC = s; }   // test seam
```

Check for import cycles. `brawl-dev.js` must not import `state.js` (its header says so), and this module
imports nothing from `state.js` either. Keep it that way.

### 4. Client call sites (B4)

- **`client/src/main.js:2244-2245`.** Replace the five-deep `applyBrawlDev(applyTraceRoom(applyDuelDev(applyLancerDev(applyAllyDev(…)))))`
  with `CATALOG.level = applyFightSpec(level.descriptor, fightSpec());`. Rewrite the comment above it
  (`:2238-2243`) to describe the one order and say that under playback the spec is the trace's.
- **`client/src/main.js:2200-2207`** (playback load). Right after `validateTrace` passes and before any level
  apply or `buildPlayerFor`, call `useTraceFightSpec(rs.trace)`.
- **`client/src/account.js:283`.** `CATALOG.level = applyFightSpec(level.descriptor, fightSpec());`. This fixes the
  missing lancer. Update the trailing comment.
- **`client/src/net.js:273`.** The same change. This fixes the missing lancer and brawl. Update the comment.
- **`client/src/main.js:1063-1068`** (`connectNetsim`). Read the spec once:
  `const spec = fightSpec();` then pass `ally: spec.ally, lancer: spec.lancer, beam: spec.beam || null,
  duel: spec.duel, brawl: NETSIM.brawl || null`. `brawl` stays `NETSIM.brawl`: it is the count that
  `?netbrawl` asks for, not the spec's boolean.
- Fix the imports at `main.js:39-42`, `account.js:15-17` and `net.js:13-14`. Remove every now-unused import.

### 5. Netsim handshake forwards `duel` (B4.2)

- **`client/src/netsim.js:118-136` `wsUrl`.** Add `duel` to the destructured args and add
  `if (duel) u.searchParams.set('duel', String(duel.aces));` next to `beam`. Update the comment.
- **`client/src/netsim.js:193` `connectNetsim`.** Add `duel = null` and pass it into `wsUrl(...)` at `:207`.
- **`server/src/netsim/socket.js:137-146`.** Parse it the way `brawl` is parsed at `:121-122`:
  `const duelRaw = Number.parseInt(params.get('duel'), 10);
  const duel = Number.isFinite(duelRaw) && duelRaw > 0 ? { aces: Math.min(ACE_COUNT_MAX, duelRaw) } : null;`
  (import `ACE_COUNT_MAX` from `../../../client/src/sim-core/ace.js`). Pass `duel` into `createRoomFn({ … })` at `:165`.
  Add `duel=` to the join log line at `:99` the way `brawl=` is logged.
- **`server/src/netsim/room.js:84-85` and `:104`.** Accept `duel = null` and pass it to `createSimWorld`.

### 5b. A room-driven run keeps no local combatants (`?duel&netsim=1` shows 2 ships, not 4)

- **New pure helper in `client/src/netsim-world.js`** (next to `clearNet`, `:465`):
  ```js
  // A run the ROOM drives has no local combatants. The tab's own reset() still runs the level script's
  // first phase, and a phase that spawns on ENTRY (`aces: N`, `ally: true`) puts real local ships in the
  // World that the room never described. Drop every enemy/ally with no network id. Ghosts (ids in
  // state.idOf) are untouched. Returns how many were dropped (a diagnostic, and what the test asserts).
  export function dropLocalCombatants(world, state) { … for each of ['enemy', world.enemies], ['ally', world.allies],
    walk the list backwards and despawnAt(world, kind, list, i) when !state.idOf.has(list[i]) … }
  ```
  Use `despawnAt` from `sim-core/spawn.js:143` (it sets `alive = false`, calls `host.onDespawn` so the mesh is
  freed, and splices). Bullets, rockets and drops are not touched: none exist at run start.
- **Call site: `client/src/main.js:1166-1176`**, the "Begin — or begin AGAIN" block. Call
  `dropLocalCombatants(world, netState)` right after `netRunAt = G.gameStartTime;`, before
  `netLink.start(pose)` / `netLink.restart(pose)`.
  - **Retry/restart:** a retry runs `reset()` again, which stamps a new `G.gameStartTime` and re-spawns local
    aces. The block fires again (`netRunAt !== G.gameStartTime`) and drops them again before `restart`.
  - **Late link:** if the socket connects after take-off, the block first fires on the frame the link appears.
    The local aces sit frozen until then (the tab does not step while `netsimDriving`) and are dropped then.
  - **Not touched:** the non-netsim duel (no `netLink`, so the block never runs), every `?record`/`?playback`
    path (`netsimDeferReason` drops the link at `main.js:1137`), and every campaign level under netsim. Their
    first phase spawns nothing on entry, so the helper is a no-op there (it returns 0). The intro is untouched.
    (`?bench` is **not** one of `netsimDeferReason`'s cases — it takes `record`/`playback`/`roam`/`sideMission`
    only. `?bench=replay` returns from `animate()` before the netsim block ever runs, and `?bench` combined
    with `?netsim` is not a supported path; nothing here changes either.)
  - **Known limit, stated not fixed (verified by reading `level-runner.js`, implementer 2026-10-27):** if a
    netsim duel falls back to local mid-run (`goLocal`/`netDown`), `clearNet` removes the room's ghost aces
    and the local aces were already dropped, so `world.enemies` is empty. The tab's level runner is still on
    the `duel` phase, whose `advanceWhen: { allCleared: true }` has no `spawn` (so `spawnDone` is true): on
    the first local tick the phase advances and the run ends at once on an **unearned "Sparring complete"**
    (the duel pays nothing beyond loot rolls, and **never advances campaign progress** — `withDuelRoom` marks the
    descriptor `campaign: false` and `sim.js` gates the advance on `campaign-advance.js advancesCampaign`, added in
    fix mode after the reviewer found any won duel POSTed `/advance`). It does not hang. A fresh run (retry/next
    launch) recovers: the new `G.gameStartTime` clears `netDown`, the tab reconnects, and the run-start block
    drops that run's fresh local aces before the room starts. Dev-only.
- **Automated outcome check: extend `client/visual/scenarios/47-duel-room.mjs`** with a third pass after the
  flag-ON one:
  - `boot(page, 'debug&duel&netsim=1')`;
  - `waitForFunction` on `window.__netsim.connected && window.__netsim.tick > 0 && window.__game.enemyCount >= 2`
    (timeout ~15 s, as `37-netsim.mjs`'s `SLOW`);
  - then `page.waitForTimeout(1000)`. This is acceptable here: a room is wall-clock-driven and `stepSim` does
    not apply under netsim.
  - Assert:
    - **`window.__game.enemyCount === 2`**, and every enemy has a `pilot` (aces, not pirates);
    - `window.__netsim` welcome `enemyTotal === 2` (`room.js:382`; read it through whatever `__netsim`
      exposes, as 37 does via its `status()` helper);
    - `__game.player.mounts.map(m => m.weapon.id)` deepEquals `[1, 3]`.
  - Negative-test on old code. Expected red: `enemyCount` is 4 or more (2 local aces + the plain level's
    pirate ghosts) and the room's `enemyTotal` is the plain level-1 total. The tab-side `[1, 3]` holds on old
    code too, because the tab applies the duel kit locally. The **room-side** kit is guarded by test 5.
- **Unit test (`client/src/netsim-world.test.js`):** build a fake world with two local enemies, one ghost enemy
  registered in `state.idOf`, and one local ally. Assert `dropLocalCombatants` removes the 2 local enemies and
  the ally, keeps the ghost, calls `host.onDespawn` for each dropped one, and returns 3. Also assert it returns
  0 on an empty world. Fails on old code: the helper doesn't exist.

### 6. `server/src/sim-host.js` uses the shared spec + build (B4.1, B5)

- **`createSimWorld` (`:110-138`).** Keep its public signature: `{ ally, lancer, beam, duel, brawl }` has many
  callers, including tests, `room.js` and `sim-replay.mjs`. Build `const spec = { ally, lancer, beam: !!beam, duel, brawl };`
  internally, replace `:116-123` with `catalog.level = applyFightSpec(catalog.level, spec);`, and pass `spec` to
  `buildShip`. Move the non-mutation comment (`:111-114`) to `fight-spec.js` if it isn't already said there.
- **`buildShip` (`:60-85`).** Change the signature to `buildShip(catalog, { shipId, loadout, components, skills } = {}, spec = NO_FIGHT_SPEC)`
  and drop the `beam` field. Then:
  ```js
  const effective = loadout || { mounts: ship.stats.mounts };
  return makePlayer(catalog, resolvePlayerBuild({ ship, loadout: effective, components: components || ship.components, skills }, spec));
  ```
  Keep the "on that fallback path the mounts are the module-level seed array" comment. It explains why
  `withBeamGun`'s non-mutation matters. grep `buildShip(` for callers that pass `beam:` and convert them;
  `sim-host.test.js` calls it without beam.
- Remove the now-unused imports (`withAllyAt`, `withLancersAt`, `withBeamGun`, `withDuelRoom`, `withBrawlRoom`)
  from `:27-31`. `BRAWL_LEVEL`, `BRAWL_SEED`, `spawnBrawl` and `clampBrawlN` stay.
- **`server/tools/sim-replay.mjs:47-53` `runTrace`.** Build the world from the whole trace spec:
  `const spec = fightSpecFromTrace(t); const room = duel !== undefined ? duel : spec.duel;` then
  `createSimWorld({ …, ally: spec.ally, lancer: spec.lancer, beam: spec.beam, duel: room })`. For a
  `room:null` trace every field is null/false, so the call is bit-for-bit the same as today, and 36 re-proves it.
  Update the comment.

### 7. The client player build and both recorders (B5)

- **`client/src/ship-build.js:59-63`.** Replace `buildPlayer(duelBuild({ ship, loadout: beamLoadout(loadout), components, skills }))`
  with `buildPlayer(resolvePlayerBuild({ ship, loadout, components, skills }, fightSpec()))`. The loadout there is
  never null (`:51`), so the ship fallback doesn't trigger. Fix the imports at `:22-23` and the comment at `:59-62`.
- **The live recorder, `client/src/main.js:1826-1841` (`beginLiveSession`).** Compute
  ```js
  const spec = fightSpec();
  const built = resolvePlayerBuild({ ...flownBuild({…}), ship: CATALOG.shipByName.get(G.currentShipName) }, spec);
  ```
  `sr.begin` destructures only its known fields, so the extra `ship` is dropped. Set `room: roomFromFightSpec(spec)`.
  Rewrite the comment at `:1826-1832`: the `?beam` hole is closed.
- **The dev `?record` recorder, `main.js:1789-1790` (`beginRecordCapture`).** Apply the same
  `resolvePlayerBuild(…, fightSpec())`, and in `stopRecordSession` (`:1804`) pass `room: roomFromFightSpec(fightSpec())`
  to `makeTrace`. `makeTrace` destructures named fields, so `...recBuild` carrying `ship` is harmless, but strip
  it to be explicit. This closes SUMMARY's "`?record&duel` is unsupported" note (`SUMMARY.md:651`).
- **`main.js:1858` anchor seal.** `if (sr.active && sr.room?.kind === 'duel' && !sr.anchor && duelAnchorReached(world))`.
  Without this, a `kind:'dev'` session would seal and upload an anchor it doesn't need. The server ignores it
  (the referee is gated on `duel`), but `session-record.js:40-42` promises "nothing pays for a digest it will not use".
- **Playback (`main.js:1876-1896` `startPlaybackSession`).** No code change. `buildPlayerFor(shipDef, override)`
  now runs through `resolvePlayerBuild(…, fightSpec())`, and that is the trace's spec after step 4. For a duel
  trace the forced kit equals the recorded kit (every trace with a `room` was recorded through `duelBuild`
  since the duel-referee change). For a `room:null` trace it is the identity.
- **`client/src/replay.js:178-179` `flownBuild` comment.** Replace "`?beam`'s swapped-in weapon is NOT captured here
  (known gap, see SUMMARY)" with "the fight spec's overrides are applied on top by `resolvePlayerBuild`".
- **`client/src/session-record.js:37-38`.** Update the `room` comment to describe the new shape.

### 8. `validateTrace` and the server row label (Decisions 4, 6)

- **`client/src/replay.js:325-331`.** Accept both kinds:
  - `kind:'duel'`: the existing `aces` range check.
  - `kind:'dev'`: at least one of `ally`/`lancer`/`beam`.
  - either kind: `ally`/`lancer`, when present, are non-empty strings, and `beam`, when present, is `true`.
  - anything else: `'room is present but is neither a duel nor a dev room'`.
  
  Update the comment at `:325-326` and at `makeTrace` (`:216-221`).
- **`server/src/server.js:583-588`.** Compute the label:
  `const kind = trace.room && trace.room.kind; const duel = kind === 'duel' ? trace.room : null;
  const rowLevel = duel ? \`duel:${level}\` : (kind === 'dev' ? \`dev:${level}\` : level);`
  Also **replace the stale referee comment at `server.js:597-601`**. It says "`?duel` … cannot be combined with
  `?netsim=1` … so this can never block a live 60 Hz room". The new reason it is still safe enough: a
  netsim-driven duel captures no ticks (the live recorder's `live` excludes `G.netDriving`), so it normally
  uploads nothing. The only netsim duel that reaches the referee is a mid-fight fallback to local, which
  uploads a partial trace and gets a `disagree`. That is dev-only, and the re-simulation (~2-10 ms) is the
  only time a room in the same process can be delayed.
  Keep the `duel` const for the referee gate at `:606`. Extend the comment: `dev:` rows are dev fights, are
  kept out of the campaign funnel, and `classifyTrace` treats them as unverifiable.
- **`server/src/db.js:85-87`.** Extend the "NB for a FUTURE level rename" note to `dev:` rows.

### 9. C12 — timing constants in `client/src/sim-core/consts.js`

Add these after `SIM_DT` (`consts.js:35`):
- `SNAPSHOT_EVERY = 2`, moved from `server/src/netsim/room.js:44-52`. Move its rationale comment too.
- `MAX_CATCHUP_STEPS = 6`, moved from `server/src/netsim/driver.js:16`, with a one-line comment saying it is the
  cap for the local accumulator, the uplink pump and the room driver alike.
- `MAX_FRAME_SEC = MAX_CATCHUP_STEPS * SIM_DT` (exactly 0.1; see Decision 12).

Then:
- `room.js` and `driver.js` import these from consts and **re-export** them (`export { SNAPSHOT_EVERY }`), so any
  server importer keeps working. grep says the only importer outside the defining files is
  `client/src/netsim-world.test.js` (for `INTERP_DELAY_MS`).
- **`client/src/netsim-world.js:45-51`.**
  `export const INTERP_SNAPSHOTS = 3; export const INTERP_DELAY_MS = INTERP_SNAPSHOTS * SNAPSHOT_EVERY * 1000 / TICK_HZ;`
  The value is exactly 100. Reword "keep the two in step" to "derived".
- **`client/src/netsim.js:166`.** `steps < MAX_CATCHUP_STEPS`.
- **`client/src/main.js:1252`.** `steps < MAX_CATCHUP_STEPS`.
- **`main.js:1233,1245`.** `Math.min(rawSec, MAX_FRAME_SEC)`.
- **`client/src/sim-core/level-sim.js:68`.** `dt = SIM_DT`.
- **`client/src/brawl-stats.js:33`.** `ticksPerSec = TICK_HZ`.
- **`server/tools/brawl-capacity.mjs:47,48,64`.** Use `TICK_HZ` and `TICK_HZ / SNAPSHOT_EVERY` instead of `60`/`30`,
  and update the header comments at `:9,12`. The `--sec 60` default at `:36` is seconds of wall time, not a
  tick rate. Leave it.

### 10. C13 — one tick-deps builder in `main.js`

Replace `liveTickDeps()` (`main.js:1096-1114`) and the inline deps in `window.__replay.step` (`:2142-2149`) with
the code below. **Also unify the live predicate** (critic): today it is written twice, at `main.js:1102` (with
`G.netDriving`) and `:1146` (with the frame-local `netsimDriving`). `G.netDriving = netsimDriving` is assigned at
`:1141`, immediately before `:1146`, so the two are equal there.

```js
// "A real player session is on the deterministic accumulator loop" — the ONE copy (animate() and liveTickDeps).
const isLivePlay = () => G.gameStarted && !BENCH && !REC && !rs.play && !G.netDriving;
function makeTickDeps({ capture }) {
  return { rs, keys, touchAim, dt: BENCH_DT, update, capture, onTick: introTick,
    isCleared: () => G.returnToBase && !levelRunner.won, isWon: () => levelRunner.won, finish: finishMission };
}
function liveTickDeps() {
  const live = isLivePlay(); // read ONCE per build, as today
  return makeTickDeps({ capture: () => {
    if (recCapturing) recTicks.push(snapshotInput(keys, touchAim));
    if (live) sr.captureTick(snapshotInput(keys, touchAim));
  } });
}
```

`__replay.step` uses `makeTickDeps({ capture: () => { if (recCapturing) recTicks.push(snapshotInput(keys, touchAim)); } })`.
In `animate()`, `main.js:1146` becomes `const live = isLivePlay();`. It must stay **after** the `G.netDriving =
netsimDriving` line (`:1141`). Delete both "keep … identical" comments (`main.js:1100` "Keep this predicate identical to animate()'s" and
`:1143-1145` "Keep the two identical"), keeping the rest of the `:1096-1100` explanation of why `live` is recomputed and not hardcoded and replace them with one line at `isLivePlay` naming its two callers.
**Keep `live` evaluated when the deps are built** (once per frame or per `stepLive` call), not per tick.
Re-evaluating it inside `capture` would change which ticks are recorded on the frame where `G.gameStarted` flips.

**Stale `noseZ` comment (`main.js:2126-2127`).** It says "the ship .glb sets mesh.userData.noseZ/tailZ (where
bullets spawn)". That is false now. `noseZ` comes from the catalog's baked `model.muzzle`
(`client/src/sim-core/ship-entity.js:84`, `noseZ: mc.muzzle ?? 1.6`; the guard is `server/src/catalog_muzzle.test.js`),
and `noseZ` appears nowhere else in `client/src`. Before writing the replacement, grep what `watchModelsReady`/`rs.armed`
still gates (`main.js:1910`). Then reword the comment to say what it actually protects. Do **not** remove the `armed` gate.

### 11. Comments and headers that describe the old wiring

- `client/src/duel-dev.js:9-17`: "three separate places": the LEVEL and SHIP halves are now `applyFightSpec`/`resolvePlayerBuild`.
- `duel-dev.js:28-33`: the label paragraph.
- `client/src/ally-dev.js:28-35` and `client/src/beam-dev.js:40-41`: the "a recorded session re-simulates into a
  divergence" caveat. Now these sessions are labelled `dev:` and rebuilt from `trace.room`.
- `client/src/netsim.test.js:32-36`: "THE THREE DEV FLAGS" is now four, with `duel`.

## Tests

Run the client tests with `cd client && node --test`. Run the server tests with `cd server && npm test`
(drops/recreates `spacegame_test`). **Every new guard must be seen to FAIL on the old code**: stash the
implementation, run the test, see it red, restore. Record that in the run log.

**New tests:**
1. **`client/src/sim-core/fight-spec.test.js`** (new):
   - **`applyFightSpec` over the flag combinations on the `level-4` descriptor.** level-4 has `wave-1`
     (lancer default) and `clear-out` (ally default); verified from `catalog_seed.js` LEVELS. Cases:
     - `{}` returns the identity (same object);
     - each of ally / lancer / duel alone matches its single transform;
     - ally+lancer equals `withLancersAt(withAllyAt(d))`;
     - ally+duel, lancer+duel and all three equal `withDuelRoom(d)` (duel discards the rest);
     - `brawl` (alone and with each of the others) equals `withBrawlRoom(d)`;
     - the input descriptor and its `phases` array are never mutated.
   - **`resolvePlayerBuild`:**
     - identity off;
     - beam swaps gun mounts and never mutates the input;
     - beam with `loadout:null` falls back to `ship.stats.mounts`;
     - duel forces `DUEL_LOADOUT`/`DUEL_COMPONENTS`/`skills:null` and keeps `ship`;
     - duel+beam equals duel.
   - **`roomFromFightSpec` / `fightSpecFromTrace`:**
     - `NO_FIGHT_SPEC` gives `null`, and `room:null` / absent gives `NO_FIGHT_SPEC` (same object);
     - **an old `{kind:'duel', aces:2}` trace maps to `{duel:{aces:2}}`, and `applyFightSpec` with it equals
       today's `withDuelRoom(d, 2)`**;
     - a plain duel spec gives exactly `{kind:'duel', aces:2}` (no extra keys);
     - an ally+beam spec gives `{kind:'dev', ally, beam:true}`;
     - the round-trip holds for each case.
2. **`client/src/fight-spec-dev.test.js`** (new): `parseFightSpec` for `''` (returns `NO_FIGHT_SPEC` itself), `?ally`,
   `?lancer&level=4`, `?beam`, `?duel=3`, `?brawl=10`, `?netbrawl=5` (expects **`brawl: true`**: the spec carries a
   boolean, and the room's count travels separately as `NETSIM.brawl`), and a combination.
3. **Call-site guard** (new; a grep-style test is fine), split across two files:
   - **`client/src/fight-spec-callsites.test.js`.** Read the source of `main.js`, `account.js`, `net.js` and `ship-build.js`:
     - each of the first three contains `applyFightSpec(`, and `ship-build.js` contains `resolvePlayerBuild(`;
     - none contains `applyAllyDev|applyLancerDev|applyDuelDev|applyTraceRoom|applyBrawlDev|duelBuild|beamLoadout|withAllyAt|withLancersAt|withDuelRoom|withBrawlRoom|withBeamGun`.
     - `main.js` additionally:
       - contains `roomFromFightSpec(` and at least **two** `resolvePlayerBuild(` calls (the live recorder and `?record`);
       - contains `sr.room?.kind === 'duel'`;
       - **does not** contain the old literal `room: duelDev() ?`;
       - contains `useTraceFightSpec(` **inside the playback load block**: its index is after
         `rs.trace = await loadTrace(` and before the first `applyFightSpec(`.
   - **`server/src/sim-host.test.js`.** The same check on `sim-host.js`: it imports `applyFightSpec` and `resolvePlayerBuild`,
     and doesn't import the five `with*` transforms.
4. **`server/src/sim-host.test.js`** (extend):
   - **Equivalence check (not a fail-on-old guard):** for each combination in test 1,
     `createSimWorld({ levelName:'level-4', …spec }).catalog.level` deepEquals `applyFightSpec(buildCatalog('level-4').level, spec)`.
     Old `sim-host` already applied the same order, so this half passes on old code by construction. It pins
     "client and server produce the same descriptor" going forward. The fail-on-old half of B4.4 is test 3's
     source check plus test 5.
   - `createSimWorld({ levelName:'level-1', ship:{ shipId:1, loadout:<a beam loadout>, components:<non-duel> }, duel:{aces:2} })`
     flies the duel kit: `world.player.mounts.map(m => m.weapon.id)` equals `[1, 3]`, and `world.player.repair` is set.
     Fails on old code: `buildShip` ignores `duel`.
5. **`server/src/netsim/socket.test.js`** (extend the spy test at `:287-322`, or add a sibling). Open
   `ticket=…&level=level-1&duel=2`, then assert:
   - `seen[n].duel` deepEquals `{ aces: 2 }`;
   - the room returned by the spy (`createRoom(args)`; `.world` is exposed at `room.js:204`) has
     `world.player.mounts` weapon ids `[1, 3]`;
   - `world.catalog.level.phases[0]` is `{ name:'duel', aces:2, … }`.
   
   Also check that `duel=0` and an absent `duel` give `duel: null`. This fails on old code because `socket.js`
   never reads `duel`.
6. **`client/src/netsim.test.js:37-53`** (extend): `wsUrl({ duel:{aces:2} })` sets `duel=2`. The plain URL carries no `duel` param.
7. **`client/src/replay.test.js:426-432`** (extend `validateTrace`):
   - accepts `{kind:'dev', ally:'clear-out'}` and `{kind:'duel', aces:2, beam:true}`;
   - rejects `{kind:'dev'}` (nothing set), `{kind:'brawl'}` and `{kind:'dev', beam:'yes'}`.
8. **`server/src/gameplay-sessions.test.js`** (beside `:216`): a `kind:'dev'` trace posted as `level-4` gets the row
   label `dev:level-4` and `verdict: null`. The referee doesn't run, even with an anchor in the body.
9. **`client/src/netsim-world.test.js`** (C12): `INTERP_DELAY_MS === 3 * SNAPSHOT_EVERY * 1000 / TICK_HZ` and `=== 100`.
   Also `MAX_FRAME_SEC === MAX_CATCHUP_STEPS * SIM_DT` and `=== 0.1`. In the server (`server/src/netsim/room.test.js` or
   `driver.test.js`), `SNAPSHOT_EVERY`/`MAX_CATCHUP_STEPS` re-exported from room/driver `===` the consts values.
   These fail on old code because the consts don't export them.

**Tests to migrate when the wrappers are deleted (Decision 10):**
- `client/src/duel-dev.test.js:8,66-79`: the identity checks on `applyDuelDev`/`duelBuild`, plus the `DUEL_COMPONENTS` id
  checks. Move them to `sim-core/duel-config.test.js` (kit ids) and `fight-spec.test.js` (identity off).
- `client/src/beam-dev.test.js:69-135`: the `beamLoadout`/`setBeamDev` cases. Port the non-mutation and the
  "the room applies the same swap" points to `fight-spec.test.js`. The `evalBeamDev`/`evalLancerDev` tests stay.
- `client/src/brawl-dev.test.js:3,32-38`: drop the `applyBrawlDev` identity lines (now covered by `fight-spec.test.js`).
  Keep the `brawlActive` lines.
- `server/src/gameplay-sessions.test.js:190` and **`server/src/seal/verify-duel.test.js:24`**: repoint the
  `DUEL_LOADOUT, DUEL_COMPONENTS` import to `client/src/sim-core/duel-config.js` (step 1).

**Named visual scenarios** (from `client/`, **one invocation at a time**, check `lsof -i :4173` first; never the full suite):
- `node visual/run.mjs 22-trace-replay`: determinism. The plain-trace path must be the identity.
- `36-sim-divergence`: browser and Node agree. It re-proves the `sim-replay.mjs` change.
- `35-playback-loads-samples` and `37-netsim`: they drive `__replay` / playback-with-netsim (C13, playback spec).
- `47-duel-room` (now including the new `?duel&netsim=1` pass, step 5b) and `49-duel-referee`: the duel room and kit.
  49 asserts `trace.room` is exactly `{kind:'duel', aces:2}` (`:73`).
- `51-bot-brawl` and `52-bot-brawl-netsim`: the brawl branch of `applyFightSpec`, local and room.
- `38-ally`, `39-charge-beam`, `40-enemy-beam` and `41-enemy-beam-netsim`. **Added beyond the coordinator's list**:
  these are the `?ally`, `?beam`, `?lancer` and `?lancer`-over-netsim entries whose call sites this change rewires (step 4).
  41 is the only automated check that `lancer` still reaches a room.

The full visual suite and the perf gate are **opt-in, default skip** (maintainer's call at the visual gate).

## Replay / intro impact

- **The Level-0 intro trace / determinism fixture** has `room: null`, so `fightSpecFromTrace` gives `NO_FIGHT_SPEC` and
  `applyFightSpec` / `resolvePlayerBuild` return the same objects. The world is built exactly as today. No sim
  code changes: `level-sim.js`'s `dt` default is the same value, `MAX_FRAME_SEC` equals the old `0.1`, and
  `MAX_CATCHUP_STEPS` equals the old `6`. That is guarded by 22 and 36. The intro is a live fight (DECISIONS §138),
  and a campaign session's recorder fields are the identity of today's.
- **Old duel traces** (`{kind:'duel', aces}`): same descriptor (test 1), and the same kit (recorded = forced).
  Guarded by 49 and the server duel fixtures (`verify-duel.test.js`, `gameplay-sessions.test.js`), which must stay green unchanged.
- **Old `?ally`/`?lancer`/`?beam` sessions on prod** have `room: null` because they were recorded before this
  change. They still play back as the plain level, exactly as today (they were already wrong; nothing gets worse).
  Only new recordings carry the spec.
- **C13** is a pure refactor of the closure builder plus one shared predicate (`isLivePlay`), which is equal at
  both call sites (step 10). `live` is still evaluated when the deps are built.
- **Step 5b** (`dropLocalCombatants`) runs only in the netsim run-start block, which never runs under
  record/playback/bench or without a socket. No replay is affected.
- **The itch build** keeps posting traces in the old format until it is re-published. Old shapes stay valid.

## Docs to update

- **CHANGELOG** (`## 2026-10-26`, newest on top): one bullet, **"One fight spec, one player build (duplication audit
  B4, B5, C12, C13)"**. It names:
  - `applyFightSpec`/`resolvePlayerBuild` in sim-core;
  - `?duel&netsim=1` now works (forwarded on the handshake, and the tab drops its own local aces when a room drives);
  - `?lancer` survives a level advance;
  - `trace.room` records the whole spec (`kind:'dev'`) and dev rows read `dev:level-N`;
  - `?beam` is recorded;
  - the timing constants are in `consts.js` and `INTERP_DELAY_MS` is derived;
  - one `makeTickDeps` and one `isLivePlay` predicate.
- **SUMMARY** (bump `**Updated:**`, edit in place):
  - `:645-652` (Record section): remove "`?record&duel` is unsupported" and "`?beam` is not captured". Both recorders apply `resolvePlayerBuild`.
  - `:497-505` (dev-flag "they compose, with one exception" note): `?duel` and `?netsim` now compose; `duel` is forwarded.
  - `:1782-1791` (duel: "recorded, and JUDGED" + **"NOT usable with `?netsim=1`"**): rewrite. The second bullet becomes
    "works under `?netsim=1` — the room builds the duel room and kit".
  - `:1793`: `applyDuelDev`/`duelBuild` are now `applyFightSpec`/`resolvePlayerBuild`.
  - `:3838-3842` (trace `room`): the new shape, the `dev:` label, and **delete the "`?beam` … records the account's
    gear … Known, named here, not fixed" sentence**.
  - `:3943` and `:4597-4600` (referee / `runTrace`): `runTrace` builds from the whole trace spec, and the referee is still duel-only.
  - `:4627`: `liveTickDeps()` is built on `makeTickDeps`.
  - `:4816-4817` (ONE CLOCK): `SNAPSHOT_EVERY` lives in `sim-core/consts.js` and `INTERP_DELAY_MS` is derived.
  - `:5092` (`?beam` dev flag wiring): via the fight spec.
  - The file map: add `client/src/sim-core/fight-spec.js` and `client/src/fight-spec-dev.js`.
- **DECISIONS §170** (check the tail first; §169 is the last one taken as of `3dbffa2`). Title: "Dev fights are recorded
  as what they were: the whole fight spec in `trace.room`, and the beam in the loadout". Record:
  - the additive `kind:'dev'` shape over a format bump;
  - duel stays exactly `{kind,aces}` when plain;
  - `dev:` labels keep dev fights out of the campaign funnel and out of verification;
  - playback trusts the trace over the URL;
  - the beam gap is closed (reversing the audit §D "keep" note) because the spec now carries it;
  - the referee stays duel-only;
  - `?duel` now composes with `?netsim=1`: the handshake forwards `duel`, the room builds the duel room and kit,
    and the tab drops its own entry-spawned combatants when a room drives the run (step 5b). The economy is the
    room's ordinary sink, which pays a duel nothing beyond the normal 20 % loot rolls, the same as a local duel.
- **`docs/plans/duel-room.md:175-189`**: rewrite the "**`?duel` must NOT be combined with `?netsim=1`**" bullet to
  "**forwarded since 2026-10-26**" (handshake `duel=<aces>` → `createRoom` → `createSimWorld({duel})`; the kit via
  `resolvePlayerBuild`). Keep the measured history in one sentence.
- **Audit** (`docs/plans/2026-10-20-duplication-audit.md` §B4 `:255`, §B5 `:264`, §C12 `:381`, §C13 `:388`): mark each
  `**fixed 2026-10-26** (\`<commit>\`)`. For §B5, note that the "recording does not capture `?beam`" line in §D is reversed by DECISIONS §170.
- **Closeout** (`docs/plans/2026-10-24-duplication-audit-closeout.md:3` status line, and the Phase 4 heading): Phases 1–4 done.

## Final gate (re-run before handing back)

Sweep for every stale symbol and every stale concept word across code, docs, skills and agent instructions:

```
grep -rnE "applyAllyDev|applyLancerDev|applyDuelDev|applyTraceRoom|applyBrawlDev|duelBuild|beamLoadout|setBeamDev|liveTickDeps\(\)|INTERP_DELAY_MS = 100|steps < 6|rawSec, 0\.1" client/src client/visual server docs .claude
grep -rniE "keep the two identical|keep this predicate identical|not (be )?combined with .?\?netsim|NOT usable with .?\?netsim|beam.{0,40}not captured|records the account's gear|record&duel. is unsupported|THE THREE DEV FLAGS|kind !== 'duel'" client server docs .claude
```

What should remain afterwards:
- history: CHANGELOG, past plan briefs, the audit's original evidence text;
- `liveTickDeps()` as a name built on `makeTickDeps`;
- `kind !== 'duel'` in `verify-duel.js:48` (duel-only by design).

Anything else is stale.

## Live-test checklist (Stage 9, after deploy)

1. A plain campaign launch on prod, still recorded: the admin row reads `level-N` and ▶ play matches.
2. Reset progress, then play the intro (Level 0) end to end. It must still reach victory and the Level 1 briefing.
3. `?debug&duel` (local): two aces, the starter kit. The admin row reads `duel:level-1` with a verdict.
4. **`?debug&duel&netsim=1`** (local or prod):
   - exactly **2 ships** on screen (the room's aces, no superimposed pirates);
   - `enemyTotal` 2;
   - the player flies Basic kinetic + Rocket (the room's kit, not the account's);
   - killing both clears the room.
5. `?debug&beam&level=4`: fly briefly. The admin row reads `dev:level-4`, and ▶ play shows the **beam** firing.
6. `?debug&lancer&level=4`: clear the level, then advance. The next level's waves still contain lancers (the `net.js` fix).
7. `?debug&ally`: the wingman arrives on `clear-out`. The row reads `dev:level-N`, and ▶ play shows the wingman.

## Deploy

Deploy to prod via the normal CI. Client files change, so **re-publish itch** (`/publish-itch`) after the prod
deploy, per the closeout's standing rule. No asset hashes change.

## Out of scope / non-goals (DECISIONS §30)

- No trace-format version bump. The referee and verify-duel are not extended to `kind:'dev'` rows.
- No new visual scenario for `?duel&netsim=1`: the socket test plus live check 4 cover it.
- Don't unify the per-flag URL parsers or the `*DevLevel()` level-forcing chain (`main.js:2212`). Don't add
  `?brawl` to `trace.room`.
- No refusal of `?duel&netsim=1` at boot: forwarding replaces that idea.
- Don't touch the C9/C10/C11 sim paths (Phases 5–6).

## Run log (implementer, 2026-10-27)

- **Negative tests on old code** (implementation stashed, new tests kept): `fight-spec-callsites` 6/6 red;
  `wsUrl` duel red; `validateTrace` dev rooms red; `netsim-world` / `fight-spec` red on missing exports; socket
  `duel=2` red ("the room factory is asked for the duel"); driver re-export red; `dev:` row label red; old
  `sim-host` duel world flies `[12, 3]` with no repair drone; `47-duel-room` netsim pass red ("saw 4"). Fix mode:
  `campaign-advance.test.js` red on old `sim.js` + an unmarked duel descriptor (2 of 3 fail).
- **Intro determinism:** `sim-replay` on `level0-intro.9fc4402d.json` gives hash `0x8d802ca2` on `main` and on
  this branch; 22 and 36 green.
- **C12 sweep leftover, intentional:** `client/src/brawl-host.js:183` `Math.min(rawSec, 0.1)` is the brawl
  spectator CAMERA's easing clamp, not the sim catch-up / frame clamp — not a C12 constant, left alone.
