# One clock: uniform snapshot interpolation for the netsim client

> **Status:** proposed, 2026-08-20. Branch `feature/server-sim` (worktree `../ag-wt/server-sim`), local only —
> nothing here ships to prod or itch. Read `docs/plans/server-authoritative-sim.md` §0 first for the state of
> the netsim work; this brief replaces that plan's *rendering* half only. The room, the protocol, the socket
> and the referee are untouched.
>
> **Prerequisite reading:** `docs/DECISIONS.md` §126 (why events are not moved in time), §118 (the sim rate is
> not negotiable across hosts), §73 (the seeded-RNG contract).

## 1. Why

The maintainer stated the requirement outright after a day of chasing stutter:

> "У меня нет жёстких требований к высокой скорости реакции, но мне важно чтобы картинка была плавная без
> артефактов. При этом хотелось бы конечно прикрыться от читеров."

Both halves matter. **Latency is not a constraint here** — this is a top-down shooter against AI, not a
competitive FPS. **Anti-cheat is already satisfied**: the room owns the simulation and the client sends
key presses (the one gap, the client banking its own result, is the *sealed economy* item in the netsim plan
and has nothing to do with rendering).

Everything expensive in the current client exists to buy latency that is not wanted.

### The actual defect: the client draws on four clocks at once

| what | drawn on | file anchor |
|---|---|---|
| enemies, drops | interpolated, `INTERP_DELAY_MS` (100 ms) in the past | `netsim-world.js:272` (`renderNet`), `:255` (`bracket`) |
| bullets | dead-reckoned into the PRESENT off the last sample's arrival time | `netsim-world.js:304` |
| rockets | extrapolated into the PRESENT by finite difference | `netsim-world.js:288` |
| the local ship | client-side PREDICTED — ahead of the server | `netsim-predict.js` (89 lines) |
| despawns | applied the instant the packet arrives | `netsim-world.js` `applySnapshot` |
| events (FX, audio) | played the instant the packet arrives | `applySnapshot` → `world.events.emit` |

Every artifact chased on 2026-08-20 lived on a seam between two of these, and each was individually
"fixed" without touching the cause:

- the gun's doubled-sounding fourth shot — events on the packet clock, not the weapon's;
- a 100 ms event delay that detached rocket trails and put blasts after the rocket had despawned
  (DECISIONS §126) — events moved to the interpolated clock while their subjects lived in the present;
- a rocket freezing at the muzzle for a snapshot interval — extrapolation with no velocity to extrapolate;
- rockets and bullets jerking on every packet — extrapolation anchored to ARRIVAL times.

**Measured baseline** (`?netjerk` probe run headlessly over a real room: 60 s, ~100 fps, delivery jitter
±12 ms, which is milder than the maintainer's captured link):

```
breaks in the drawn motion: 7476      half of them on the frame a packet was applied
kind        n     |Δstep| / the object's own cruise step     nose step
rocket    1815     p50 0.77   p95 1.37                       max 3.00°/frame
bullet    5643     p50 0.77   p95 1.32                       —
enemy       18     p50 0.54   p95 4.14                       p95 1.59°/frame
```

The median projectile is corrected by **three quarters of its own per-frame travel, every time a packet
lands** — over a hundred such corrections a second. From the maintainer's own session capture: arrival gaps
of 50–79 ms (p05 51, p50 68, p95 75) against a nominal 66.7, and enemies producing 736 breaks with a nose
step up to 3.5°/frame while manoeuvring.

**This baseline is the code as it stands after the 2026-08-20 revert (`cc96bf2`)** — i.e. it is what the
maintainer sees today, not something introduced by that day's work. Confirmed by playtest on the reverted
build: "да, действительно всё дёргается".

## 2. What the field does (researched 2026-08-20)

Every system that prioritises a smooth picture over latency converges on the same shape.

- **Valve, Source Multiplayer Networking.** 20 snapshots/s, `cl_interp 0.1` = **two snapshot intervals**, and
  the stated reason is exactly ours: "even if one snapshot is lost, there are always two valid snapshots to
  interpolate between." Rendering runs on a *server-tick* timeline (`render time = client time − lerp`), not
  on arrival times. Extrapolation exists only as a ≤250 ms emergency (`cl_extrapolate_amount`), never as the
  normal path. They accept the 100 ms view lag unconditionally.
- **Mirror (Unity).** `bufferTimeMultiplier = 2` (delay = 2 × send interval), a local timeline that is sped
  up / slowed down rather than jumped (`catchupSpeed 0.02`, `slowdownSpeed 0.04` — deliberately asymmetric,
  "slow down a little faster so we don't encounter empty buffer"), and dynamic sizing from measured jitter.
- **nengi** (JS, the library closest to our problem). v1: `interpDelay = 100` ms default, render time from a
  20-sample rolling average of `now − snapshot.timestamp` — a server clock. v2: a tick-based
  `PlaybackCursor` with rate control (`correctionGain 0.2`, `maxCorrectionRate 0.1`, hard snap past
  2 ticks) and an `AdaptiveDelayPolicy` that ratchets the delay **up fast and down slowly** (30 s of
  stability before shrinking, 5 ms steps). No extrapolation anywhere: on underrun it freezes on the last
  frame.
- **Colyseus 0.18** shipped an interpolation engine (`@colyseus/sdk/predict`) whose default mode is `lerp`
  with `delay: 100`, documented as "size it so jitter rarely makes the buffer underrun (1–2 server tick
  intervals)". Its own implementation comment is the sentence that decides this brief:

  > On underrun or warmup, hold at the newest sample — **don't** extrapolate. Extrapolation here is what
  > produced the "flickery" feel; bracketing changes happen at predictable render-time crossings, not at
  > jittered packet arrivals.

  Their teaching lab grades the modes: `lerp` "never invents positions, so it's never wrong";
  `extrapolate` "overshoots on every turn".
- **Despawn on the render clock is not a tuning choice, it is the documented rule.** Unity Netcode for
  Entities' `GhostDespawnSystem`: "the client must wait until the `InterpolationTick` is greater or equal
  the despawning tick to actually despawn the ghost" — and predicted ghosts despawn immediately *because
  they live on the present timeline*. Two timelines, two rules. lightyear (Bevy) shipped the same as a fix.
  nengi does it structurally in both major versions. Colyseus is the counter-example — it detaches on
  decode — and it is also the only one of these whose interpolation is per-field rather than a timeline.
- **The one thing uniform lerp costs at a low snapshot rate is curve fidelity.** Gaffer On Games measured it
  at 10 pps: a "subtle position jitter … your brain detecting 1st order discontinuity at the sample points",
  and rotating clusters "interpolating *through*" the centre because a straight line between two points on a
  circle cuts the chord. Mitigations, in his order: raise the send rate (10→30 pps drops the needed delay
  350→150 ms); use angle-correct interpolation for rotation (slerp — "we don't need to send angular
  velocity"); Hermite splines last, because they require velocity on the wire. No JS networking library
  ships spline interpolation.

Sources: Valve wiki *Source Multiplayer Networking*; gafferongames.com *Snapshot Interpolation*;
`github.com/timetocode/nengi` (v1 `core/client/Interpolator.js`, v2 `FixedStepInterpolator`/`PlaybackCursor`/
`EntityHistory`); `@colyseus/sdk@0.18.2` `src/predict/Predictor.ts` + `colyseus/prediction-playground`;
Mirror `SnapshotInterpolationSettings.cs`; Unity `GhostDespawnSystem` docs; lightyear release notes.

## 3. The decisions

Each is stated with its number, so the implementer does not have to re-derive them.

1. **One clock. Everything is interpolated; nothing is extrapolated.** Enemies, drops, bullets, rockets and
   the local ship are all drawn at `renderTick = serverTick − delay`. On underrun, hold the newest sample.
2. **The timeline is TICKS, not arrival times.** A snapshot states a tick; the tick is the truth. Delivery
   jitter must move nothing. (This is the single change that kills the 7476 breaks: half of them land on the
   frame a packet arrives, which under a tick clock is not a special frame at all.)
3. **Delay = 3 snapshot intervals = 200 ms**, at `SNAPSHOT_EVERY = 4` (15 Hz). Two intervals is the
   documented minimum (Valve, Mirror, Colyseus); a third is Fiedler's loss margin, and it is affordable
   precisely because latency is not a requirement here. Today's 100 ms is **1.5 intervals** — below the
   minimum every source gives, which is why a single late packet already shows.
4. **Raise the snapshot rate to 30 Hz (`SNAPSHOT_EVERY = 2`)** and keep the delay at 3 intervals — which then
   costs only **100 ms**. This is the cheapest fix for the chord-cutting that makes a small enemy's nose step
   while it tracks you, and at one player per room the bandwidth is free. *Decision: do this, and measure it;
   if the drawn nose is smooth at 30 Hz, Hermite/Catmull-Rom is not needed and must not be built.*
5. **Despawn on the render clock.** An entity removed from a snapshot is held until the render tick passes
   its last sample, then despawned. This is what makes a kill explosion land on the ship and a rocket's blast
   land on the rocket.
6. **Events ride the same clock as everything else** — they become simply correct, and DECISIONS §126's
   "an event anchored to something on screen may not be moved in time" stops being a constraint to respect
   and becomes a property of the design. The gun-rhythm fix (`tk` stamps, reverted in `cc96bf2`) comes back
   for free: an event fires when the render clock reaches its tick.
7. **Delete client-side prediction** (`netsim-predict.js`, 89 lines, plus its wiring at `main.js:12`,
   `:1047`, `:1050`). The local ship is interpolated like everything else. It costs 200 ms of input lag,
   which is the trade the maintainer explicitly asked for. **This is the reversible one**: if the ship feels
   unacceptably heavy in the hand, the sanctioned way back is NOT extrapolation but *predicted spawns* /
   prediction on the present timeline with its own despawn rule (Unity's two-timeline model) — and it should
   be re-opened only after the picture is smooth, never at the same time.
8. **Keep `?netjerk`.** It is the instrument that turned this from opinion into numbers, and it is how the
   result is judged.

**Not in this brief:** the sealed economy, lag compensation (D5 — its consumer left with auto-aim), local
bullets, side missions, roam. Nothing here is a prerequisite for those.

## 4. Implementation

All in `client/src/netsim-world.js` unless stated. Order matters: each step leaves the suite green.

### Step 1 — the tick clock (a partial implementation is parked in `git stash` on this branch)

`createNetState()` (`:55`) gains:

```js
clock: { offset: null, resyncs: 0 },   // wall-clock instant at which server tick 0 is due
```

`applySnapshot` (`:138`) updates it before anything reads a sample:

```js
const tickMs = SIM_DT * 1000;
function updateClock(state, snap, at) {
  const obs = at - snap.tick * tickMs;            // this packet's offset, including its own delay
  const c = state.clock;
  if (c.offset == null || Math.abs(obs - c.offset) > CLOCK_RESYNC_MS) { c.offset = obs; c.resyncs++; }
  else c.offset += (obs - c.offset) * CLOCK_FOLLOW;
}
export const tickAt = (state, now) =>
  (state.clock.offset == null ? null : (now - state.clock.offset) / tickMs);
```

`CLOCK_FOLLOW = 0.02` per packet, `CLOCK_RESYNC_MS = 250`.

**Slew, never step.** A tracker of the minimum-delay packet was tried on 2026-08-20 and rejected: every new
earliest-ever packet moved the whole timeline under the world, which is the same discontinuity this change
exists to remove. Slewing toward the mean costs ~10 ms of extra delay and is smooth. The estimate's time
constant is ~3.3 s at 15 packets/s — a test must let it settle before asserting steady-state numbers.
`clearNet` resets `offset` to null: a new run is a new relationship.

**Consider adopting nengi 2's asymmetric rate control instead** (advance a playback cursor by elapsed ticks ×
a rate of 1 ± 10%, hard-snap past 2 ticks) if the exponential offset proves to drift audibly. Start with the
simpler one; it is measurable either way.

### Step 2 — interpolate on ticks

`bracket()` (`:255`) takes a fractional TICK and compares `sample.tick`, not `sample.at`. Ticks are exactly
`snapshotEvery` apart by construction, so the parameter is uniform.

In `renderNet` (`:272`):

```js
const nowTick = tickAt(state, now);
const t = nowTick == null ? -Infinity : nowTick - delayMs / tickMs;
```

### Step 3 — delete the extrapolation branches

Remove the rocket branch (`:288`) and the bullet branch (`:304`) entirely; both kinds fall through to the
same interpolation path as enemies. `MAX_EXTRAPOLATION_MS` (`:31`) goes with them.

The rocket branch's long comment about smoke trails leading their rocket must go too — under one clock the
trail and the rocket are on the same timeline by construction, which is the comment's own wish.

Rocket **heading** needs angle-correct interpolation, which `lerpAngle` already is.

### Step 4 — the local ship

Delete `client/src/netsim-predict.js` and its three call sites in `main.js` (`:12`, `:1047`, `:1050` — the
`predictor` and `unacked` parameters of `renderNet` go with them, as do `VIEW_TAU_PREDICTED_S` at `:43` and
`MAX_REPLAY_TICKS`'s import). The ship interpolates from `state.playerSamples` exactly like an enemy.

Keep `VIEW_TAU_S` smoothing? **No** — it exists to absorb corrections that no longer happen. Remove it and
measure; if the ship reads as stiff, an *output spring* of ~25 ms (Colyseus `smoothMs`) is the sanctioned
minimal re-addition, not a return of the integrate-and-converge view.

`sim-core` is untouched: the predictor is the only consumer of `stepPlayer` on the client, and `replay.js`
keeps its own use.

### Step 5 — despawn and events on the render clock

`applySnapshot` currently despawns on absence (`state.byId` sweep) and emits events immediately. Both move:

- Give each entity a `despawnTick` when it first goes missing from a snapshot (= the snapshot's tick), keep
  drawing it from its samples, and only call `despawnGhost` from `renderNet` once `renderTick` passes it.
- Restore the `tk` stamp on wire events (`server/src/netsim/room.js` `stepOnce`, reverted in `cc96bf2`) and
  release each event when `renderTick` reaches `ev.tk`. The queue machinery from `cc96bf2`'s parent commits
  is the right shape — one budget now, not two.

### Step 6 — the snapshot rate

`SNAPSHOT_EVERY = 4 → 2` (`server/src/netsim/room.js:33`) and `INTERP_DELAY_MS = 100 → 100` (which is now
**3 intervals** rather than 1.5). Note `room.test.js` and `netsim-world.test.js` construct snapshots with
explicit ticks — check every test that hard-codes 4.

## 5. How it is judged

**The number to beat is 7476 breaks / 60 s, median 0.77 cruise steps.** Re-run the same probe harness (§1)
after each step; it is the only honest comparison, because the eye that reported "everything jerks" also
reported "no lag at all" about the identical code an hour earlier.

New tests (in `client/src/netsim-world.test.js` unless noted):

1. **Delivery jitter moves nothing.** Deliver one real room's fight twice — a perfect link and a ±12 ms one —
   sample both at identical instants, and demand the same picture. Allow for the clock's settling time
   (~3.3 s) and assert on the settled window. *A version of this exists in the parked stash; it failed at
   0.08 units against a 0.02 threshold because the runs were still converging — lengthen the run rather than
   loosen the bound.*
2. **Nothing is extrapolated.** Stop delivering snapshots mid-flight and assert every entity holds its last
   sample rather than flying on.
3. **A despawned entity survives until the render clock reaches it** — and its `kill`/`detonate` event
   arrives while it is still drawn, not after.
4. **The gun keeps its own rhythm** (restore from `cc96bf2`'s parent — it passes for free under one clock).
5. **A rocket flies from the muzzle** (restore likewise; under interpolation it needs no launch velocity at
   all, so the `vx`/`vz` fields added to the rocket spawn descriptor can stay reverted).
6. Negative-test every one of them against the pre-change code, as this branch's convention requires.

Run the visual suite against a `main` baseline before merging (memory: it fails ~6 scenarios at baseline;
judge by the reliably-passing set and zero page errors), plus `node visual/run.mjs 22-intro-replay`, which is
unaffected in principle — the local sim path is untouched — but is cheap insurance.

## 6. Docs to update on landing

- `docs/SUMMARY.md` — the netsim rendering section is rewritten wholesale: one clock, the delay in
  intervals, no extrapolation, despawn timing, and the removal of prediction.
- `docs/CHANGELOG.md` — one entry, leading with what the player gets.
- `docs/DECISIONS.md` — a new entry for the trade (smoothness bought with 100–200 ms of view lag, and why
  that is the right trade for THIS game), superseding §126, whose rule becomes structural rather than a
  constraint to remember. Record the rejected alternatives: framework adoption (Colyseus/nengi — the
  transport and protocol we have already work and are tested; what these libraries actually offer is the
  doctrine, and the doctrine is what this brief copies), and spline interpolation (not needed if 30 Hz
  smooths the nose; costs velocity on the wire).
- `docs/plans/server-authoritative-sim.md` §0 — point at this brief and mark the rendering half superseded.
