# An ally who fights with you

> **Status:** requested 2026-08-21, design open. Nothing implemented. ROADMAP Phase 4.5 — deliberately
> **before** Phase 5 (multiplayer). This file is the brief-in-progress: §2 is the part the maintainer still
> owns, and it should be answered before §3 is turned into an executable plan.
>
> Read first: `docs/SUMMARY.md` (enemy AI, fire groups, the netsim room), `docs/narrative/` before writing
> any player-facing line, `docs/DECISIONS.md` §124 (auto-aim was removed — the player aims, and so does the
> AI) and §127 (one clock; anything new on screen is drawn on it like everything else).

## 1. Why this, and why now

A friendly ship that flies with the player and helps in combat — **with logic of its own, not an enemy bot
pointed the other way.**

It comes before multiplayer for two reasons, and the first is the interesting one.

**It is the dress rehearsal for co-op.** A second combatant in a room that is not the player exercises
nearly everything co-op needs, minus everything that makes co-op hard:

| co-op needs | the ally exercises it | the ally skips |
|---|---|---|
| a ship on the wire the client does not own | yes — spawned, streamed, drawn as a ghost | two humans' input, matchmaking |
| per-ship targeting decided server-side | yes — the ally picks targets in `sim-core` | reconnect, socket draining on deploy |
| a room holding more than one fighter | yes | shared roam, shared level scripts |
| friendly fire, shared loot, shared XP | yes — all become real questions | PvP, spectating |
| more entities per snapshot | yes — the measured cost is in `server-authoritative-sim.md` | — |

If the ally reads well, co-op is mostly plumbing. If it does not, co-op would not have rescued it — two
humans in a badly-legible fight is the same fight, twice as confusing.

**And it is worth having on its own**, in single-player, with no netcode attached. The sim is one module
(`client/src/sim-core/`) and runs identically in the browser and in a room, so an ally written there works
in both without a second implementation.

## 2. Decisions the maintainer owns

**These are not for the implementer to guess.** Each changes what gets built, and several change the
narrative and the economy. Answer inline in this file.

1. **Where does it come from?** A wingman the Sentinels assign (story), a mercenary hired with credits per
   mission (economy), a drone unlocked as a component (progression), or something the player builds?
2. **One, or several?** One companion, or a wing the player composes? Does the player choose which?
3. **Does the player command it?** Autonomous only, or orders — *attack that*, *hold*, *on me*? The netsim
   command channel (`world.onCommand`, already carrying click-to-fly) would take orders unchanged, and the
   click-to-fly UI already knows how to name a target on screen.
4. **Can it die?** For the rest of the mission, permanently, or does it retreat at low health? Does losing
   it cost credits, progress, or a story beat?
5. **Does it take?** Loot crates, XP, kill credit. Every "yes" changes the reward curve; every "no" needs a
   reason the player can see.
6. **Friendly fire.** Can its shots hit you, and yours hit it? (Today enemy fire is silent and the player's
   is not — DECISIONS on audio — so an ally's fire needs its own answer for sound as well as damage.)
7. **Every mission, or some?** Campaign only, side missions too, roam?
8. **Does it exist in single-player from the start**, or only inside a room? (Recommendation: single-player
   first — the sim is shared, and it is far easier to judge feel without a socket in the way.)

## 3. What "logic of its own" has to mean

The design content of this feature is here, and it is why "reuse `stepEnemyAI`" is the wrong answer.

`stepEnemyAI` (`client/src/sim-core/step-enemies.js:39`) is: fly at the player, fire when in range and
roughly aimed. That is correct for a threat. An ally has a different job — **be useful and be legible** —
and every difference below follows from one of those two.

- **It positions relative to the PLAYER, not to its target.** A wingman holds a station off your flank and
  fights from there; a bot that beelines at whatever it is shooting reads as a stranger who happens to be
  nearby. This is also what makes it feel like an ally at all, before it fires a shot.
- **It targets what threatens YOU**, not what is nearest to it: the enemy shooting at the player, or the one
  closest to the player. A companion that wanders off to the far side of the arena is not helping, however
  many kills it gets.
- **It must not steal the fight.** If it out-kills the player, the player is a spectator; if it does
  nothing, it is decoration. This is a tuning problem with a real answer — cap its damage share, or give it
  a role that is not damage (drawing fire, finishing wounded ships, screening the player while shields
  recharge).
- **Fire discipline.** It must not shoot through the player, both because of friendly fire and because a
  tracer crossing your own hull reads as a bug. It holds fire when the player is on the line — which is a
  check enemies have never needed.
- **It must be legible at a glance.** The player has to be able to tell what it is doing and why, from the
  screen alone: what it is attacking, whether it is hurt, whether it is coming when called. An ally whose
  behaviour is opaque reads as broken even when it is working. (Memory of this project: a new element has to
  read correctly on *every* player-facing surface, not merely simulate correctly.)
- **It reacts to the player's state, not only the enemy's.** Player at low health → screen and draw fire.
  Player winning → stay out of the way. This is the behaviour no enemy has, and it is where the feature
  either earns its place or does not.

**Where it lives.** `sim-core` — a new `step-ally.js` beside `step-enemies.js`, drawn on the same clock as
everything else, spawned through the host like any other entity (§127). It must not draw from the seeded
gameplay RNG in a way that reorders existing draws (DECISIONS §73: new draws go at the END, never inserted),
or every recorded trace and the intro replay break.

## 4. Open technical questions

- **Does the ally count toward `enemyTotal` / level completion?** No, but kills it makes must count
  somewhere or the "kills === total" drop trigger breaks. (This project has broken that trigger before by
  changing what feeds it — check every consumer.)
- **Collision.** Can the player ram it? Do enemy rockets home on it? `findTargetInSector` currently seeks
  `world.player` for enemies; an ally is a second candidate and that is a balance change, not a detail.
- **The wire.** A new entity kind in the snapshot, its static half in `staticOf`, its rows in the column
  list, and a `kind` the client's `spawnGhost` knows how to build. Straightforward, but it is where the
  co-op rehearsal actually happens.
- **The intro replay guard.** Any change to sim ordering or RNG draws needs
  `node visual/run.mjs 22-intro-replay` green (4 kills, p0..p4, win).

## 5. Not in this brief

Multiplayer, matchmaking, a second human, PvP. The point of doing this first is that none of them are here.
