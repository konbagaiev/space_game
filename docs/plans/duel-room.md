# The duel room — sparring against the wingman (`?duel`)

> **Status:** requested and BUILT 2026-09-01, branch `feature/duel-room`. Dev-only, off by default.
> Rationale: DECISIONS **§146**. Current state: `docs/SUMMARY.md` (Gameplay → "The duel room").
> Read first: `docs/plans/combat-ally.md` (the wingman this room points at you) and DECISIONS §73 (the
> seeded-stream contract every spawn has to respect).

## 1. What it is

A dev-only arena where the player fights **N aces** — ships built from the Sentinel wingman's exact hull
and gear and flown by **the same pilot code**, hostile. Asked for as "a room where I fight two of those
bots, give me a basic gun and a basic repair drone".

```
?duel                 two aces, built over level-1
?duel=3               three (clamped to ACE_COUNT_MAX = 6)
?duel&level=4         the same room, over that level's map/centre instead
?duel=0|false|off     off — and no `duel` param at all is off
```

Take off drops you **straight into the fight**, not into roam.

## 2. The three things the flag does

Each is a strict no-op with the flag off — the same object comes back out.

| what | where | effect |
|---|---|---|
| the LEVEL | `duel-dev.js applyDuelDev` → `withDuelRoom` (**the transform itself lives in `client/src/sim-core/duel-config.js`** since the duel referee, re-exported from `duel-dev.js`) | the fetched descriptor's phases are replaced by `[{ name:'duel', aces:N, advanceWhen:{allCleared:true} }, { name:'victory', event:'win' }]`; map and combat centre are kept, `briefing`/`lastKillDrop`/`introTrace`/`intro`/`xpReward` are dropped |
| the SHIP | `duel-dev.js duelBuild`, called in `ship-build.js buildPlayerFor` | forces **Basic kinetic id 1 + Rocket id 3**, **Basic hull id 1 (100 HP)**, **Repair drone id 12**, base shield/grab, **no skills** |
| the LAUNCH | `mainwindow.js takeOff` → `launchCampaign({ direct: true })` | a cold-start `reset()` into combat instead of `enterRoam(null)` |

`applyDuelDev` is applied in all three places a level descriptor enters the catalog (`main.js`, `net.js`,
`account.js`) and runs **last**, after `applyAllyDev`/`applyLancerDev`, because it discards what they write.
`main.js` additionally wraps it in **`applyTraceRoom`**, so `?playback` of a duel trace rebuilds the room
from the recording itself (the URL carries no `?duel`) — the admin ▶ play link on a duel row would otherwise
replay the plain base level.

## 3. The ace

`sim-core/ace.js`. Built by `makeSentinelHull` — the hull extracted out of `makeAlly`, so the wingman and
the ace can never be re-armed apart — plus a hostile identity: `pilot: 'ace'`, `name: 'Sentinel duelist'`,
`color 0xff5a4a` (minimap), `accent { color: 0xd93025, prefix: 'Wings_' }` (the wing repaint) and
`reward: 0, xp: 0`.

**It is an ENEMY** (`world.enemies`), which is the decision the whole feature rests on — see DECISIONS §146.
Everything an enemy already gets, it gets for free. Two places know it exists:

- `stepEnemyAI` skips any enemy with a truthy `e.pilot` — "this ship has a pilot step of its own";
- `stepAces` (`ace.js`) flies it, called in `tick.js` **immediately after `stepAlly`** and before
  `stepEnemyAI`, so the pilot-flown ships move on the same side of the tick the player and wingman do.

**Arrival** (`spawnAces`, from a phase's `aces: N`): ahead of the player's nose, facing him,
`ACE_SPAWN_DIST 90` out, `ACE_SPAWN_SPREAD 40` apart, and **echeloned** — each one `ACE_SPAWN_STAGGER 14`
further out and `ACE_WARP_STAGGER 0.35 s` slower to form. All derived from the player's transform: **zero
draws from the seeded stream**.

> **Why the echelon exists.** Measured in a browser without it: two identical ships flown by identical
> deterministic code held the *same* distance to the player tick for tick for the whole fight and volleyed
> their rockets in the same frame — 2 × 60 power at once, a guaranteed one-shot on the 100 HP hull. Do not
> "simplify" the stagger away. Determinism plus symmetry is a formation, not a fight.

## 4. One pilot, two sides

`step-ally.js`'s per-ship body is now **`flySentinel(world, ship, dt, ctx)`**:

| ctx field | wingman | ace |
|---|---|---|
| `foes` | `world.enemies` | `hostileFoes(world)` — the player + any live wingman |
| `friend` | `world.player` | `null` → the §2.6 hold-fire gate is skipped |
| `side` | `'ally'` | `'enemy'` → hostile projectiles, and rockets handed `a.target` |
| `leash` | `ALLY_TARGET_LEASH` | `Infinity` |
| `canFire` | `true` | `world.combatElapsed >= ENEMY_FIRE_GRACE` (the shared 5 s opening grace) |

`stepAlly(world, dt)` keeps its signature and makes exactly the call it always made, so every existing
constant, comment and test in that file still describes the wingman.

## 5. Balance, as measured

The ace **is** the wingman: 200 HP, Heavy cannon (35 power / 0.6 s) + homing Rocket (**60 power**), repair
drone, shield — and it **retreats at ≤25 % hull to heal and comes back at 40 %**, exactly as he does. The
player is on the starter kit: 100 HP, Basic kinetic, a 1 HP/s drone.

An **idle** player dies in well under 15 s. This is the configuration that was asked for ("exactly like the
wingman"); the knobs, if it needs softening, are all one-liners:

- `?duel=1` — one of them;
- drop the rocket from `ALLY_MOUNTS` **for the ace only** (it would need its own mount list — today the
  ace deliberately shares the wingman's);
- give the player a heavier hull in `DUEL_COMPONENTS` (`duel-dev.js`).

## 6. Point defence — shooting a rocket down (added 2026-09-01)

The pilot (both sides) now engages **incoming rockets** with the gun. Rationale and every gate:
DECISIONS **§147**. In short:

- **acquire** only while the ship it is charging is outside `engageBand(ship)` (the max `ai.range` over its
  ballistic groups — 45 u here, NOT the 140 u the gun reaches; see §6a), or there is no ship to charge
  (escorting);
- **hold** (`a.intercept`) until the rocket is gone or out of reach, so the nose cannot dither;
- **gun only**; defends **itself and its friend** only; **never while retreating**.

**Measured, live, 60 s of a real duel with the player on the trigger:** 13 rockets fired, **5 shot out of
the air**, 1 reaching a hull, 6 expiring at max range; an ace was engaged on **18.6 %** of ticks. The binding
limit is the **turn rate** — at 1.16 rad/s a beam-on rocket 20 u out arrives before the nose comes round.

## 6a. The gun fires as far as the GUN fires (changed 2026-09-01)

The maintainer's suspicion was that the pilot does not fire the gun with a target in reach. **Measured
before touching anything** — 60 s of a real duel, one ace, 3600 ticks: a target on **every** tick, aimed on
**66 %**, inside the gun group's `ai.range` on **63 %**, both at once on **31 %**, firing on essentially all
of those. The predicate was correct; the number was too small:

| group | `ai.range` | `ai.aimTol` | the weapon's own `maxRange` |
|---|---|---|---|
| `GUN` | **45** | 0.25 | Heavy cannon **140** |
| `ROCKET` | **80** | 0.40 | Rocket 150 |

**The rule now (maintainer, 2026-09-01): fire from whatever range the weapon allows.** `groupReach(g)` is
the **minimum** `maxRange` over a group's ballistic mounts — minimum, because one trigger fires every mount
in the group. **Ballistic groups only:** the rocket group keeps its 80 u band. Measured effect: **25 → 46
shots** in the same 60 s. Rationale and the alternatives rejected: DECISIONS **§148**.

It lives in the PILOT, not in `catalog_seed.js`, because **`GUN.ai` is shared with the pirate ships** —
raising it there would rebalance every enemy in the game. `stepEnemyAI` is untouched.

### The number this split in two — do not merge them again

| helper | question | value here |
|---|---|---|
| `groupReach(g)` | can this group's shot get there? | the weapon, **140** |
| `engageBand(ship)` | is that ship close enough to be my priority? | the AI band, **45** |

Point defence (§6) keys off `engageBand`. Keying it off the reach instead would mean "the ship is too far
to shoot" is essentially never true — a ship is almost always within 140 u — and interception would
silently stop working the day it shipped. After the split it measured **better**, not worse: 5 of 13 player
rockets shot out of the air against 4, an ace engaged on 18.6 % of ticks against 13 %.

## 7. Tests

- `client/src/sim-core/ace.test.js` (21) — driven against the real catalog via `server/src/sim-host.js
  buildCatalog`: what an ace is, the RNG-free staggered arrival, `stepEnemyAI` leaving it alone while still
  flying an ordinary pirate, `stepAces` charging the player, inertness with no ace, the wingman still
  charging it, the fire grace, and the death settling through `stepEnemyDeaths` for 0 credits and 0 XP.
  Plus 7 on point defence, including the rocket actually being **destroyed** (driven through `stepBullets`,
  not merely aimed at) and the wingman doing it while **escorting**; and 4 on the firing range — the two
  numbers staying apart, a shot taken at 100 u where the old band held fire, none at 200 u, and the rocket
  group keeping its own band.
- `client/src/duel-dev.test.js` (9) — the flag's URL-only parsing and clamp; `withDuelRoom` producing a
  level the runner can finish, without mutating the seed descriptor.
- `client/visual/scenarios/47-duel-room.mjs` — the room assembled end to end in a browser, both halves
  (flag off changes nothing / flag on is a playable fight), the echelon guard, and a **live-fire** section
  that holds the rocket trigger for 60 s of sim and asserts an ace really intercepts.
- Unchanged and re-run: `server/tools/sim-replay.test.js` (the Level-0 intro trace still replays
  bit-identically), the netsim room and seal suites, and all 686 pre-existing client tests
  (716 total now).

## 8. Known / deliberately not done

- **Loot still drops.** An ace pays no credits or XP, but its death rolls the ordinary 20 % drop, deposited
  on victory. Suppressing it would mean a dev branch inside `stepEnemyDeaths`. Fly the room on a throwaway
  local player — the same caveat `?ally` carries.
- **A `?duel` session is judged on its own terms** (`docs/plans/2026-09-01-1845-duel-referee.md`). Its row is
  labelled `duel:level-N`, so the campaign survey (`server/tools/verify-sessions.mjs`) reports it as
  `unverifiable` (`level-mismatch`) rather than re-simulating it into a false disagreement — a duel is not a
  campaign run and must not pollute that survey. Where it *is* judged is the **`verdict` column on
  `/admin/sessions`**, written by `server/src/seal/verify-duel.js`. The trace carries
  `room: { kind:'duel', aces:N }` and the forced loadout, so the referee rebuilds the same room and the same
  ship. **Nothing binds to a verdict.**
- **The ROOM is now the likely answer for VALIDATING a duel, not just a nice-to-have (DECISIONS §151).**
  The referee route shipped (`docs/plans/2026-09-01-1845-duel-referee.md`) and its first production session
  measured the thing that undermines it: the player's browser and the server's Node do not agree
  bit-for-bit, so an oracle comparing two independent simulations is hostage to the player's browser build.
  A room has no second host to agree with. If duels ever need to pay anything, read §151 before choosing.
- **`?duel` must NOT be combined with `?netsim=1`** — and it fails messily rather than cleanly, so this is
  worth knowing before someone tries it. `?ally`, `?lancer` and `?beam` are forwarded on the netsim
  handshake (`netsim.js wsUrl` → `createRoom` → `createSimWorld`); `?duel` is not — the flag is read from
  `location.search` and never travels. **Measured** (`?debug&duel&netsim=1`, local
  server): the tab joins a room running the plain `level-1`, and both fights run at once — **4 ships on
  screen** (2 aces spawned by the tab's own level runner + 2 `Basic pirate ship` ghosts streamed from the
  room) against an `enemyTotal` of 2, with `duelBuild` forcing the loadout only in the tab while the room
  flies the account's real ship.
  **THE `sim-core` MOVE IS DONE.** `DUEL_PHASES` + `withDuelRoom` now live in
  `client/src/sim-core/duel-config.js` beside `ally-config.js withAllyAt` and `lancer-config.js`, and
  `createSimWorld({ duel: { aces: N } })` applies them server-side (the duel referee rebuilds a whole duel
  from a trace this way). `spawnAces` and `stepAces` were already in `sim-core` and RNG-free. **What is
  left** is the handshake hop — `netsim.js wsUrl` carrying the flag, `createRoom` passing `duel` through —
  plus a server-side `aces` path for the room's own player build. Deliberately not done: the sparring room
  is a local tool, and a half-forwarded dev flag is worse than an absent one.
  **Cheap alternative if it keeps catching people:** refuse the combination at boot (a console error and
  one of the two ignored), which is a few lines in `main.js` where both flags are already read.
- **The aces do not hold fire for each other.** `friend: null`, so an ace will put a tracer through the
  other one — which is what every enemy in the game already does, and their fire cannot hurt each other.
