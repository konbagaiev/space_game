# Seal the economy — the room is the accountant

> **Status: PLANNED (rewritten 2026-08-22 after Phase 0). Phase 0 is DONE and in the tree.**
> Written against `main` @ `8360fff`.
>
> Read first: `docs/plans/server-authoritative-sim.md` §0 and its §4 bullet; `docs/DECISIONS.md` §125
> (trace v4), §129 (what Phase 0 measured), §30 (keep processes simple), §73 (seeded-RNG contract).
>
> **This plan changed direction on 2026-08-22, and the reason is worth reading before the design.** The
> original plan was to re-simulate a submitted input trace and compare its reward to the claim. Phase 0
> measured that idea against production and it does not hold up (§3.1). The replacement is not a better
> way to check the recording — it is not checking a recording at all:
>
> > **The room already simulated the fight. It knows every kill at the moment it happens. Let it do the
> > bookkeeping itself.**
>
> That dissolves both of Phase 0's blocking findings rather than working around them. There is no
> re-simulation, so build drift cannot break it; there is no trace, so a trace that was never recorded
> cannot break it either.

## 1. Where the money comes from today

- `client/src/net.js:64` `bankRun()` POSTs `{ playerId, credits: G.earned, kills, durationMs, xp }` to
  `/api/games`; `server/src/db.js:694` `recordGame` adds it to `players.credits` / `players.experience`.
  **It believes every number in the body.**
- Those numbers are produced inside `sim-core`: `world.earned` per kill (`step-enemies.js:140`),
  `world.earnedXp` (`:141`), and victory doubles the credits and adds the level's one-shot bonus
  (`level-runner.js:109-110`, `winLevel`).
- The other server side effects ride the same victory moment (`client/src/sim.js:316-327`):
  `depositLoot(takeLoot())`, `unlockNextLevel()` / `reportMissionCleared()`, `track('level_clear')`.
- A **netsim room** simulates the whole fight server-side and then… lets the browser bank it
  (`server/src/netsim/room.js:20`). That is the piece this plan removes.

## 2. The decisions taken (2026-08-22 — do not re-open)

**D-a. Victory is a simulation event, not a mouse click.** A level gets an explicit `winCondition`;
today every level and side mission carries `{ type: 'allEnemiesDead' }`, which is what the phase script
already encodes implicitly. Both hosts, and any referee, then reach victory the same way.

**D-b. The mission reward is granted when the win condition is met — at the last enemy's death, not at
the dock.** Flying home stops being a stake and becomes the way out. A player who is killed on the way
back keeps what they cleared the sector for.

**D-c. A room banks its own run; browser single-player keeps banking on trust, and we say so.** Sealing
is therefore partial and deliberately so — `?netsim=1` is opt-in, so today that is a small slice of real
play. Routing all play through rooms was considered and NOT chosen: `server-authoritative-sim.md` D1's
reasons still stand (a network blip would kill a fight in progress rather than lose an unbanked run; itch
is served worldwide from one VPS; N worlds at 60 Hz on the same box as Postgres; and the browser host is
the free divergence oracle that keeps "one simulation" honest). Revisit when rooms are the normal path,
not before.

**D-d. Phase 0's trace verifier stays in the tree as a diagnostic.** It is what found the netsim
recording bug, and it is the path back if browser single-player is ever sealed. It is not on the
critical path any more.

## 3. What Phase 0 found — the evidence that changed the direction (2026-08-21, production)

> Phase 0 was a deliberate first step: measure whether a submitted run can be re-judged at all, before
> building anything that depends on the answer. It was built, run against production, and the answer was
> no. What follows is why — and it is the whole argument for §2's decisions. Referenced elsewhere as §3.1.

**Built and run.** `server/tools/verify-sessions.mjs` (read-only; `--rows` surveys a dumped row set so
production's database — unpublished on the Docker network — never needs a tool copied into a live
container) plus `server/src/seal/verify-run.js` and its tests. Surveyed: all **74** recorded sessions on
`vega.tenony.com`.

**Result: 20% agreement. Nobody is cheating — traces do not reproduce.** Three separate causes, and each
one changes this plan.

### (a) A trace only reproduces on the BUILD that recorded it — the constraint §125 did not cover

Every session row already stores `game_version` (the deploy commit). Ignoring it was the plan's biggest
hole. Removing auto-aim (**DECISIONS §124**) changed where a bullet goes, and §124 itself measured the
shipped Level-0 replay moving `tick=2503` → `tick=2474` on identical input. Harmless for a 4-kill intro;
on a 14-kill level it compounds into a different fight. The survey is that in one line:

| every run that AGREED | every run that DISAGREED |
|---|---|
| 4 kills or fewer (7× the Level-0 intro, one 0-kill, one 4-kill) | 12–22 kills |

The divergence scales with fight length. That is the signature of a small per-shot behaviour change, not
of cheating — and it means **verification only ever works for the currently deployed build**, and every
deploy invalidates whatever has not been judged yet. `classifyTrace` now takes the running build and
returns `build-drift` / `build-unknown`; the live verifier must always pass it. Gated on the current
build, 74 sessions reduce to **2** verifiable ones — which is the honest size of the evidence base, and
the reason any trace-based check would have to judge within minutes rather than in a nightly batch.

### (b) A netsim session records a stub, and the row still claims the room's kills

The 2 survivors both re-simulate to **0 kills against a claimed 14**. Not cheating either:
`client/src/main.js:980` computes `live = G.gameStarted && !BENCH && !REC && !rs.play && !netsimDriving`,
so while a server-run room is driving, `sr.captureTick` never fires — but `G.kills` keeps climbing off the
wire and the flush writes it to the row anyway. Measured on session `282b6018`: `duration_ms` **650 s**,
trace **2932 ticks (49 s)**, real input for the first **5 s**. ~92% of the session was never recorded.

Two consequences, one of them nothing to do with the economy:
- **The admin replay viewer plays a 5-second stub for every netsim session** and has since `?netsim`
  shipped. Same class of bug as §125, same symptom (a replay that is fiction), different cause.
- A verifier would call an honest netsim player a cheat on **every single run**. So netsim sessions must be
  excluded — and the right long-term answer is the opposite of a trace: **the room simulated the fight and
  already knows the reward**, so a room should bank directly rather than be re-judged from a recording it
  never made. That observation is what §2 turned into the plan.

It is a bug in shipped behaviour, independent of the economy — see §6.

### (c) A cosmetic third: pre-migration rows and their traces disagree about the level

7 sessions classify `level-mismatch` and 7 `unknown-level` (`level-5`, which does not exist), all with the
row exactly one level BELOW the trace. That is the 0-based level renumbering: `db.js:66` rewrote the level
names stored in `gameplay_sessions`, and the traces already in S3 could not be rewritten with them. Only
pre-migration data is affected. No action beyond knowing it.

### What this changed

Trace re-simulation was abandoned as the route to a sealed economy, and the room took its place (§2). The
findings are not wasted — each one landed somewhere:

1. **`classifyTrace` gained a build gate** (done, tested). It stays with the diagnostic (D-d): any future
   trace-based check must pass the running build, because verification only ever works for the build that
   is deployed, and every deploy invalidates whatever has not been judged yet.
2. **The netsim recording bug is now its own item** (§6). It no longer blocks the economy — a room needs
   no recording — but it is a live defect in the admin replay viewer and must be fixed on its merits.
3. **The reason a referee "can never win"** — victory depends on a mouse click, which lives in the
   interface rather than the simulation — turned out to be the real design problem, and Slice 1 fixes it
   at the source instead of working around it in the verifier.

## 4. Slice 1 — victory becomes a simulation event — ✅ DONE 2026-08-22

**Shipped as designed, with one deliberate deviation and two surprises worth carrying forward.**

- **The deviation: `unlockNextLevel()` stayed at the dock.** Tracing its consumers found it calls
  `buildPlayerFor` — it rebuilds the PLAYER, and Level 2's briefing swaps a weapon — plus `buildMap` when
  the next level uses a different one. On `cleared` that would change the ship under the pilot in mid-flight.
  So the campaign advance is not a reward and does not move: **clearing the sector pays you, reporting back
  advances you.** Die on the flight home and you keep the credits, the XP and the loot, but you fly the
  level again. DECISIONS §130.
- **No re-baselining was needed after all.** §4.6 predicted the oracles would move. They did not:
  `36-sim-divergence` reports the identical hash on BOTH hosts and the identical 38 draws, and
  `22-intro-replay` held at `tick=2474`. The reward touches no RNG and no entity state, so the simulation
  did not move — only what it is worth at the end. The referee's own output did change, deliberately:
  the Level-0 trace now replays to **250 credits instead of 125**, which is a headless host concluding a
  mission for the first time.
- **Two pre-existing potholes found while verifying** (both reproduce on a clean `main`, so neither is new,
  and both cost time before being pinned): `visual/run.mjs` reads only **one** filter argument
  (`process.argv[2]`), so the three-scenario command in §4.6 and in SUMMARY silently runs only the first;
  and the full visual suite does not finish on this machine — it aborts on an unhandled `waitForFunction`
  timeout after ~13 scenarios. Verify by running scenarios one at a time, and compare any suspicion against
  a stashed tree before believing it.

Result: client **487** (9 new), server **203**, both green; `22-intro-replay`, `36-sim-divergence`,
`37-netsim`, `29-intro-live-handoff`, `32-star-system`, `30-session-upload-on-hide`,
`35-playback-loads-samples` all pass individually.

### Original design (as built)

**This is smaller than it looks, because the moment already exists.** `beginReturn(world)`
(`client/src/sim-core/level-runner.js:83`) fires exactly when the win condition is met: the last combat
phase advances on `allCleared`, the `event: 'win'` phase runs its `delay`, and then the return-to-base
gate opens. That IS "the last enemy died". All this slice does is move the reward to it.

### 4.1 What moves

| today | after |
|---|---|
| `beginReturn` — opens the gate, grants nothing | `beginReturn` — opens the gate **and grants the reward**, emits `cleared` |
| `winLevel` (at dock) — `lr.won = true`, `earned *= 2`, `+= xpReward`, emits `win` | `winLevel` (at dock) — `lr.won = true`, teardown, emits `win` (the overlay + "mission closed") |

So `winLevel` keeps only its mission-closing half, and `lr.won` keeps its current meaning everywhere it
is read (~20 sites: HUD gating, autopilot, pause, the frame loop). **Nothing about the flight home
changes** — the ship is still live, the arrow still points home, the station is still clickable, the
overlay still appears on docking. The only difference is that the credits are already yours.

### 4.2 `winCondition`

- Add `winCondition: { type: 'allEnemiesDead' }` to every level descriptor in
  `server/src/catalog_seed.js` and to `sideMissionPhases()`'s level in `server/src/missions.js`.
- `level-runner.js` evaluates it where the `event: 'win'` phase is handled today (`enterPhase`, `:72-78`).
  For `allEnemiesDead` the evaluation is the condition that already gates the phase, so this is a
  refactor with an explicit name, not new behaviour. A descriptor with no `winCondition` defaults to
  `allEnemiesDead`, so nothing breaks while the seed rows catch up.
- Why bother if it changes nothing today: it takes the victory rule out of the interface and puts it in
  the simulation, where a room and a referee can both reach it. It is also the seam for the next
  condition (survive N, escort X, reach Y) without another special-cased phase.

### 4.3 The new event

`{ type: 'cleared', credits, xp, kills, loot }` on `world.events` — the 20th event in `events.js`. The
host does the banking off it. The `win` event stays exactly as it is and keeps doing the overlay.

### 4.4 Client wiring (`client/src/sim.js`)

Split the victory case in two:
- **`cleared`** → `bankRun()`, `G.flushSession('win')`, `depositLoot(takeLoot())`,
  `unlockNextLevel()` / `reportMissionCleared()`, `track('level_clear')`. All still gated on
  `!G.replayMode`.
- **`win`** → the overlay, the sting, the music, the Continue button. No server side effects at all.

**Loot has one wrinkle worth deciding rather than discovering.** The grab keeps pulling crates in during
the flight home, so `pendingLoot` can grow after `cleared`. Rule: drain and deposit at `cleared`, and
drain and deposit again when the run ENDS (dock or death). `takeLoot()` empties what it takes, so a
second deposit cannot double-count and nothing collected on the way home is lost.

**Death after `cleared` must not re-bank.** `G.banked` already guards `bankRun`, and it is now set at
`cleared`, so the `death` case's `bankRun()` becomes a no-op. Assert that in a test rather than trusting
the read.

### 4.5 The referee stops needing a hack

`server/src/seal/verify-run.js` currently applies `winLevel` itself, because a headless referee cannot
click a station and so could never reach the victory bonus. After this slice it does not have to: the
reward is granted at `cleared`, which a headless run reaches on its own (Slice C already prints
`returning true` for the Level-0 trace). Delete the completion branch and its `win-not-earned` verdict;
keep the tests, inverted.

### 4.6 Tests

- `level-runner` unit tests: the reward lands at `beginReturn`, not at the dock; `winLevel` no longer
  touches `earned`/`earnedXp`; the doubling and `xpReward` happen exactly once.
- **Death on the way home keeps the reward** — the behaviour change D-b asks for, asserted directly.
- A `cleared` event carries the same figures the `win` overlay used to read.
- `winCondition` defaulting: a descriptor without one behaves identically to one with `allEnemiesDead`.
- `server/tools/sim-replay.mjs` on the Level-0 trace now prints the DOUBLED credits and reaches
  `cleared` headlessly. Its expected output changes — update `sim-replay.test.js` deliberately.
- **The two oracles must be re-baselined on purpose.** `22-intro-replay` asserts `won=true` and a tick
  count; `36-sim-divergence` asserts a world hash. Credit totals move, so the hash moves. Run both, read
  the new numbers, and record them in the plan — a changed hash here is expected exactly once.

## 4b. Slice 1b — the flight home is gone; the player ends the mission — ✅ DONE 2026-08-22

Came straight out of play. §130 moved the reward to the last kill but left CLOSING the mission at the dock,
and the maintainer hit the consequence the same day: cleared Level 3, pressed "Return to base", reloaded the
tab, and had to fly the level again — credits kept, level lost.

- **"Finish and Return"** replaces "Return to base": pressing it sweeps the field's remaining crates into
  the run and closes the mission. Refuses unless the sector is cleared. Docking ends nothing any more; the
  homing arrow is roam-only.
- **The campaign advance moved onto the button**, which is what fixes the reported bug. §130 had to leave it
  at the dock (`unlockNextLevel` rebuilds the player — Level 2's briefing swaps a weapon), and a button
  restores the very condition that made docking safe: the fight is frozen first.
- **The button releases a netsim room too** — nothing left to simulate — and travels as a
  `{kind:'complete'}` command so the ROOM ends the mission it is simulating.
- **The loot sweep is the point, not a convenience.** The last enemy's crate spawns at the instant the fight
  ends; without the flight-home window no ship can reach it.
- The label was measured: the first draft was ~390 px, wider than a 360 px phone, with the centring
  transform pushing it off both edges. Rendered and checked at desktop / phone-landscape / rotated-portrait.

DECISIONS §132. Client 491, server 213; `22-intro-replay` held at `tick=2474` and `36-sim-divergence` still
agrees on both hosts.

## 5. Slice 2 — the room banks its own run — ✅ DONE 2026-08-22

Built as designed. Two things worth carrying forward:

- **An identity bug caught in my own glue before it shipped.** The sink was first written
  `bankRun({ playerId, ...run })` — with the spread AFTER the identity, so a `playerId` on the run object
  would have overridden the one from the handshake ticket. The room composes that object, not a client, so
  it was not exploitable today; it was still exactly backwards for the one property a server-run economy
  exists to hold. It is now `{ ...run, level, playerId }`, extracted into an exported `makeEconomySink` so
  the property can be asserted directly, and the assertion is negative-tested against the old ordering.
- **The client had no way to know a room was driving it.** `netsimDriving` was a local in the frame loop.
  It is now published as `G.netDriving` each frame — deliberately not "is the netsim flag on", because a
  deferred or dropped link means the tab is back on its own simulation and owns its own banking again.

Result: server **211** (8 new), client **487**, `37-netsim`, `22-intro-replay`, `36-sim-divergence` and
`01-smoke` all green.

### Original design (as built)

1. **`server/src/netsim/room.js` drains `cleared` and the player-death event** and writes the reward
   itself: `recordGame(playerId, { credits, kills, durationMs, xp })`, `depositLoot`, and the progress
   advance / mission-clear. The room knows `playerId` from its ticket (`netsim/tickets.js`), never from
   the client.
2. **The client must stop banking under netsim.** The wire events run through the same adapter, so
   without a gate the run banks twice. Gate the server side effects in `sim.js` on "this tab is not
   netsim-driven", and test that a room run banks exactly once.
3. **Idempotency:** one bank per room, per run. A reconnect must not re-bank.
4. **A room that ends without `cleared`** (disconnect, abandon) banks nothing — the same rule as today,
   where closing the tab mid-run loses the unbanked credits.
5. `POST /api/games` stays exactly as it is for browser single-player.

## 6. Blocking bug, independent of all of the above

**Session recording captures a stub under `?netsim=1`** (§3.1b). `client/src/main.js:980` computes
`live = … && !netsimDriving`, so `captureTick` never fires while a room drives — yet the row still stores
the room's kills and the real duration. Session `282b6018`: 650 s and 14 kills claimed, 49-second trace,
5 seconds of real input.

This is a live defect in the admin replay viewer (it has been playing a 5-second stub for every netsim
session) and it is not about the economy at all. Fix it on its own merits, with its own regression test.
Either capture input under netsim too, or stop writing a session row for a run that was not recorded —
**a row whose `kills` describe a fight its trace does not contain is the indefensible part.**

## 7. What this does NOT seal — say it plainly

1. **Browser single-player** (everything without `?netsim=1`, which today is nearly all real play) still
   banks on its own word. That is D-c, chosen deliberately, and it must not be described as sealed.
2. **Side missions and roam** are unrecorded (`mainwindow.js:114`, `:509`) — irrelevant to a room, which
   needs no recording, but still relevant to any future trace-based check.
3. **Pre-v4 traces are never re-judged** (§125), and traces from any other build are refused (§129).

## 8. Docs to update as part of the change

- **CHANGELOG** — a bullet per slice, including the behaviour change in D-b (players will feel it).
- **SUMMARY** — the victory rule (`winCondition`, reward at the last kill), what a room banks, and the
  honest scope of the seal. Bump `**Updated:**`.
- **DECISIONS** — one entry: *the room is the accountant, not the referee* — why re-simulating a trace
  was abandoned after being measured, why the reward moved to the last kill, and why browser
  single-player stays on trust for now. It supersedes the direction in §129 without contradicting its
  findings.
- **`docs/plans/server-authoritative-sim.md`** §0 / §4 — point here.
