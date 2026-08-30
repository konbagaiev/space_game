# The playable intro — Level 0 becomes a fight you fly, with a director talking over it

**Feature ID:** 2026-08-30-1654-playable-intro
**Worktree:** `/Users/kbagaiev/Projects/ag-wt/2026-08-30-1654-playable-intro`
**Status:** ready to implement
**Type:** client feature + level-descriptor data + sim-core spawn gate + deletion of the replay cutscene

---

## Goal

Today a brand-new player watches Level 0: the client fetches a canonical **input trace** from S3 and
re-simulates a recorded fight while five full-screen cards freeze the sim and wait for a tap. The player
never touches the controls until Level 1.

After this change the new player **flies Level 0 from the first second**. Same four enemies, same level,
but it is a real, live, recorded session — no playback, no freeze, no tap-to-continue. Over the top of it a
scripted **director** speaks five short first-person lines and, once, flies a **controls card** from the
centre of the screen down into the permanent bottom-left cheatsheet, so the player learns both the controls
and where they live. Progress still advances 0 → 1 and the Level-1 briefing still follows — now through the
ordinary win path every other level uses, so the intro also teaches the mission-end loop.

---

## Decisions (settled — do not re-open)

Maintainer's answers, plus the calls I made where the codebase decided it. Everything here is final.

1. **Voice: the pilot's first-person inner monologue.** Not a handler, not mission control. `docs/narrative/canon.md`
   §"Tone & register" stands: grounded rookie, scared but holding, no bravado, mechanics taught through the
   action. All five lines are rewritten into that voice (Step 7 has the exact English). No new speaking character
   in canon.
2. **New keys `ui.intro.l0` … `ui.intro.l4`** (EN source + RU). The old `ui.cutscene.p0_intro`,
   `p1_first_kill`, `p2_second_kill`, `p3_rocketeer`, `p4_second_rocket`, `skip`, `tap` are **deleted from
   both locale files**. Lines appear **instantly** — no typewriter.
3. **The ending is the normal one, plus a fifth line.** Fight cleared → `cleared` → the bottom-centre
   **"Finish and Return"** button appears → autopilot flies home → dock → victory overlay → Continue →
   Level-1 briefing. `L4` fires on `cleared` and points at the button. Geometry is resolved in Step 4 with
   numbers; the line slot never overlaps `#return-btn`.
4. **The player can die.** Normal rules, normal Game-over overlay, Restart replays Level 0 with **every**
   director beat re-armed. The re-arm is a testable seam (Step 3) with its own unit test.
5. **Skip stays, and it skips the whole intro** — straight to the Level-1 briefing via `finishIntro`
   (progress 0 → 1). It lives **inside the Settings modal** (the ⚙ gear, top-left, which already pauses the
   fight when opened). Rationale + the rejected placements in Step 6.
6. **The controls card flies into `#help`.** It appears in the line's slot, holds, then travels/shrinks into
   the bottom-left cheatsheet. `#help` is **never hidden** — it is visible from the first frame, exactly as
   today, and the card lands on it.
7. **`#help` gets a touch variant.** `ui.help_touch` (EN + RU), branched on `Device.input`. Fixes a real
   pre-existing defect (the keyboard-only string renders on phones today).
8. **The "FINAL STAGE" banner is suppressed on the intro** via a descriptor flag, not a special case in code.
9. **The intro is session-recorded** like every other campaign level (`beginLiveSession()` before `reset()`).
   The funnel finally sees the level where new players actually drop off.
10. **The generic `?record` / `?playback` machinery stays**, but every trace of the word *cutscene* leaves it.
    The one behaviour worth keeping — "a trace cannot record the mouse click that ends a mission, so a
    playback presses it" — becomes an explicit, opt-in `?playback&finish` (Step 8).
11. **`introTrace` keeps its name.** Seven files resolve the canonical trace path from it
    (`sim-replay.test.js`, `netsim/room.test.js`, `seal/verify-run.test.js`, visual 22/35/36/37,
    `scripts/assets-check.mjs`); renaming it is churn with no behavioural value. Its **meaning** changes and
    its comment says so: it is now *the canonical recorded trace the determinism guards replay*, and the
    client never fetches it.
12. **Help hold = 3.5 s, not 2 s** — the one number I am changing from the brief, as invited. Justification:
    the desktop card is 5 bindings / 14 words / ~90 characters. Unfamiliar UI text reads at ~200–250 wpm, so
    14 words is **3.4–4.2 s**; at 2 s a first-time player gets through about half of it while a pirate is
    materialising in front of them, and the card's entire job is to be read *once*. It is a single number in
    the level descriptor (`intro.helpHold`) and the enemy-#2 gate derives from it automatically — set it back
    to `2` and everything else follows.

---

## The timeline — ONE source of truth

Every number below lives **once**, in the `level-0` descriptor in `server/src/catalog_seed.js`, and is read
by both the UI (the director) and the simulation (the spawn gate). Nothing derives it twice.

| t (s, sim clock) | What happens | Driven by |
|---|---|---|
| 0.00 | **L0** appears, fully opaque | director, `beats[0].on: 'start'` |
| 3.00 | **enemy #1 warps in**; L0 starts fading | sim, `spawn.earliest[0] = 3` |
| 5.00 | L0 gone → **controls card** appears in the same slot | director, `lineHold + lineFade` |
| 8.50 | card starts flying to the bottom-left `#help` | director, `+ helpHold` |
| 8.95 | card gone; `#help` is where the controls live now | director, `+ helpFly` |
| ≥ 8.95, and only once enemy #1 is dead | **enemy #2 warps in**, **L1** fires | sim floor `spawn.earliest[1]` **+** the existing `maxConcurrent: 1` rule |
| enemy #2 dies + 2.00 | **L2** | director, `beats[2].delay` |
| enemy #3 dies (next tick) | **enemy #4 (rocketeer)** warps in, **L3** | phase advance (`advanceWhen {kills:3}`) + director `on:'spawn', n:4` |
| all four dead | `cleared` → **L4** + "Finish and Return" appears | director, `on:'cleared'` |

Every line: **fully visible `lineHold` = 3 s, then fades over `lineFade` = 2 s.** A beat that fires while a
line is still up **replaces it immediately** (the fade restarts from full).

**The clock is `world.combatElapsed`** (`sim-core/world.js:77`, incremented in `sim-core/tick.js:29`, zeroed
in `sim-core/reset-world.js:95`, already in `worldDigest`). It is seconds of *unpaused* sim since the run
started. Using it satisfies three constraints at once and adds **no new world state**:
- all director timing is **sim ticks**, never wall clock (it advances only when the accumulator steps);
- the spawn gate and the UI read **the same clock**, so the DOM never tells the sim when to spawn;
- it resets to 0 on every `reset()`, which is what re-arms the director on a death-restart.

Related constant worth knowing: `ENEMY_FIRE_GRACE = 5` (`sim-core/step-enemies.js:33`) — enemies move and aim
but hold fire for the first 5 s of a run. And a **warping enemy is invulnerable and cannot fire**
(`ship-entity.js:163`, `step-projectiles.js:44/173`), so with `earliest[0] = 3` and a 2–4 s materialisation
the first pirate cannot hurt or be hurt before ~5 s.

---

## Step 1 — `server/src/catalog_seed.js`: the level-0 descriptor

Anchors: the `LEVELS` array starts at **line 643**; the level-0 entry is **lines 649–675**; `introTrace` is
**line 655**; the `spawn` for `wave-1` is **line 664**.

**1a.** Immediately above `export const LEVELS = [` (line 643), add the intro timeline constants:

```js
// ---- The Level-0 intro script (docs/plans/2026-08-30-1654-playable-intro.md) ----
// These numbers are the ONLY copy. The client's director (client/src/intro-director.js) reads them off the
// served descriptor to time its lines and the controls card, and the SIMULATION reads the derived floors
// below through `spawn.earliest` — so the words and the fight cannot drift apart. All seconds, measured on
// `world.combatElapsed` (the unpaused sim clock).
const INTRO_LINE_HOLD = 3;     // a line is fully opaque this long…
const INTRO_LINE_FADE = 2;     // …then fades over this long
const INTRO_HELP_HOLD = 3.5;   // the controls card sits in the line slot this long (see the plan decision 12)
const INTRO_HELP_FLY  = 0.45;  // …then flies/shrinks into the bottom-left #help cheatsheet
// Enemy #1 warps in ON the opening line, not before it: the pilot gets three quiet seconds to read.
const INTRO_FIRST_SPAWN = 3;
// Enemy #2 may not arrive while the player is still reading the controls card. Derived, never typed twice.
const INTRO_HELP_GONE = INTRO_LINE_HOLD + INTRO_LINE_FADE + INTRO_HELP_HOLD + INTRO_HELP_FLY; // 8.95
```

**1b.** Rewrite the level-0 descriptor. Keep `id`, `name`, `title`, `xpReward`, `map`, `winCondition` and the
three phases as they are; change only what is listed:

- Replace the `introTrace` comment (lines 651–654) and keep the field:

```js
      // THE CANONICAL RECORDED TRACE, not a cutscene any more. The client no longer fetches or plays it —
      // the intro is a live fight (this plan). It stays here because it is the fixture seven determinism
      // guards resolve their path from: server/tools/sim-replay.test.js, server/src/netsim/room.test.js,
      // server/src/seal/verify-run.test.js, and visual scenarios 22/35/36/37. A gitignored S3 asset pulled
      // by `npm run assets:pull`. RE-RECORD IT WHENEVER LEVEL-0'S PACING CHANGES — see Step 9 of the plan.
      introTrace: 'assets/recordings/level0-intro.<newhash>.json',
```

- Add the director script + the banner flag next to it:

```js
      // The FINAL STAGE banner announces the last combat phase on every level. On the intro that instant is
      // the rocketeer's warp-in, which is exactly when line L3 speaks — two announcements over each other.
      // Stated as data so nothing in level-runner.js special-cases level 0.
      finalStageBanner: false,
      // The scripted intro director (client/src/intro-director.js): the words, their timing, and the
      // controls card. The SPAWN half of the same timeline is `phases[0].spawn.earliest` below.
      intro: {
        lineHold: INTRO_LINE_HOLD, lineFade: INTRO_LINE_FADE,
        helpHold: INTRO_HELP_HOLD, helpFly: INTRO_HELP_FLY,
        beats: [
          { id: 'l0', on: 'start',                    textKey: 'ui.intro.l0' }, // "…something is moving to intercept"
          { id: 'l1', on: 'spawn',  n: 2,             textKey: 'ui.intro.l1' }, // he wasn't alone → the rocket (F)
          { id: 'l2', on: 'kill',   n: 2, delay: 2,   textKey: 'ui.intro.l2' }, // 2 s after the 2nd kill
          { id: 'l3', on: 'spawn',  n: 4,             textKey: 'ui.intro.l3' }, // the rocketeer warps in
          { id: 'l4', on: 'cleared',                  textKey: 'ui.intro.l4' }, // sector clear → Finish and Return
        ],
      },
```

- On `phases[0]` (`wave-1`, line 664) add `earliest` to the spawn block:

```js
        {
          name: 'wave-1', // three basic pirates, one at a time (kill one -> the next warps in)
          // `earliest[n]` = the soonest `world.combatElapsed` at which the (n+1)-th spawn of this phase may
          // happen. It is a FLOOR on top of the ordinary stagger, never a replacement for it: #1 waits for
          // the opening line, #2 additionally waits for the controls card to have flown away. Index 2 is
          // absent, so enemy #3 uses the plain randomized 2–4 s stagger like every other level.
          spawn: { maxConcurrent: 1, total: 3, earliest: [INTRO_FIRST_SPAWN, INTRO_HELP_GONE],
                   pool: [{ ship: 'Basic pirate ship', chance: 100 }] },
          advanceWhen: { kills: 3 }
        },
```

**1c.** Fix the now-stale comments at **lines 171–174** (they say "the intro cutscene … re-simulate it. Do not
finish the job by putting them on these rows without re-recording the cutscene"). Reword: the two intro ships
stay fast because the **canonical trace** and `36-sim-divergence` re-simulate them, and changing them means
re-recording that trace (Step 9). The constraint is unchanged; only the word "cutscene" goes.

**Nothing else in the descriptor moves.** `enemyTotal` stays **4** (`enemyTotalFromPhases` re-stamps it;
`server/src/enemy_total.test.js:42` `EXPECTED` is unchanged), `advanceWhen {kills:3}` is unchanged, the
`allCleared` finale is unchanged, `winCondition` is unchanged, there is still no `lastKillDrop` and no
briefing on level 0.

---

## Step 2 — `sim-core`: the spawn floor and the banner flag

Both changes are **purely additive** and invisible to every level that does not carry the new fields, so the
browser, a netsim room and the headless referee all get them from one place.

**2a. `client/src/sim-core/spawn-timing.js` — one new input to `stepSpawnGate`.**

```js
export function stepSpawnGate({ cooldown, dt, alive, maxConcurrent, capRemaining, blocked = false }, rand = Math.random) {
  // `blocked` — a script says "not yet" (level-0's `spawn.earliest` floors). Treated exactly like a full
  // arena: the cooldown FREEZES rather than draining, so the floor can never leak into the delay that the
  // level runner hands the enemy as its warp-in duration.
  const wantSpawn = !blocked && alive < maxConcurrent && (capRemaining == null || capRemaining > 0);
  if (!wantSpawn) return { spawn: false, cooldown };
  const cd = cooldown - dt;
  if (cd <= 0) return { spawn: true, cooldown: nextSpawnDelay(rand) };
  return { spawn: false, cooldown: cd };
}
```

This is the answer to the brief's constraint 4. `updateLevelRunner` does `e.spawnDur = gate.cooldown` — the
cooldown it stores is *always* `nextSpawnDelay()` (2–4 s), because the floor never touches `cooldown`. A 3 s
floor therefore **cannot** become a 3 s materialisation. `enterPhase` still sets `spawnCooldown = 0`, so the
first spawn of the phase fires on the first tick at or after the floor.

**2b. `client/src/sim-core/level-runner.js`.**

In `updateLevelRunner`, inside the `if (ph.spawn)` block (**lines 244–258**), compute the floor and pass it:

```js
  if (ph.spawn) {
    const cap = ph.spawn.total;
    const capRemaining = cap == null ? null : cap - lr.spawnedThisPhase;
    // A phase may state the SOONEST moment each of its spawns is allowed (seconds of unpaused combat since
    // the run began). Level 0's intro uses it to hold the first pirate until the opening line has been read
    // and the second until the controls card has flown away; every other level omits the field entirely.
    const floor = ph.spawn.earliest && ph.spawn.earliest[lr.spawnedThisPhase];
    const gate = stepSpawnGate({
      cooldown: lr.spawnCooldown, dt,
      alive: world.enemies.length, maxConcurrent: ph.spawn.maxConcurrent, capRemaining,
      blocked: floor != null && world.combatElapsed < floor,
    }, simRandom);
    …unchanged…
  }
```

In `enterPhase` (**line 97**), honour the descriptor flag:

```js
  if (ph && !ph.event && next && next.event === 'win'
      && lr.level.finalStageBanner !== false          // level 0's intro speaks its own line at that instant
      && !world.firedBanners.has('final')) {
```

**Digest safety.** Neither change adds World state. `world.firedBanners` and `world.banner` are **not** in
`worldDigest` (`sim-core/digest.js:55–88` hashes `run`/`lr`/`arena`/`ap`/`p`/entities only), and
`world.combatElapsed` was already hashed. So the browser↔Node oracle is untouched by the *mechanism*; what
does move is the level-0 **fight** itself, which is Step 9.

**2c. Tests.** Extend `sim-core/spawn-timing.test.js` and `sim-core/level-runner.test.js`:
- `stepSpawnGate` with `blocked: true` never spawns and returns the cooldown **unchanged** (the freeze);
- a phase with `earliest: [3]` spawns nothing while `combatElapsed < 3` and spawns on the first tick at ≥ 3;
- the enemy created at that spawn gets `spawnDur` in **[2, 4]** — the constraint-4 guard, asserted directly;
- `earliest[1]` holds the second spawn even with the arena empty and the cooldown drained;
- a phase with **no** `earliest` behaves exactly as before (the existing tests cover this — confirm green);
- `enterPhase` fires `ui.banner.final_stage` normally, and does **not** when `level.finalStageBanner === false`.

---

## Step 3 — `client/src/intro-director.js` (new) + delete `level0-cutscene.js`

A pure, DOM-free, engine-free state machine. It imports nothing. `node --test` can load it (unlike anything
that imports `three`), which is the whole point of the seam.

**Delete `client/src/level0-cutscene.js`.**

**Create `client/src/intro-director.js`:**

```js
// The scripted intro director — the words over the playable Level 0.
//
// PURE and DOM-FREE on purpose: it is fed one call per SIM TICK and returns what should be on screen, so it
// can be unit-tested without a browser and it can never fall out of step with the simulation the way a
// wall-clock animation would. main.js owns the single instance, calls tick() from the fixed-step loop, and
// writes `view` to the DOM once per frame.
//
// The SCRIPT is data on the level descriptor (`descriptor.intro`, server/src/catalog_seed.js) — the same
// object whose numbers the SPAWN GATE derives its floors from, so the lines and the fight share one
// timeline. See docs/plans/2026-08-30-1654-playable-intro.md.

export const HELP_STATES = ['idle', 'hold', 'fly', 'done'];

export function makeIntroDirector(script) {
  const beats = script.beats || [];
  const { lineHold = 3, lineFade = 2, helpHold = 3.5, helpFly = 0.45 } = script;
  const helpAt = lineHold + lineFade;      // the card takes the slot the moment the opening line has gone

  let fired, pending, line, lastT, help;
  function reset() {
    fired = new Set();      // beat ids already spoken (once per run)
    pending = [];           // [{ beat, dueAt }] — beats with a `delay`
    line = null;            // { key, at } — what is on screen
    help = 'idle';
    lastT = 0;
  }
  reset();

  // One sim tick. `t` is world.combatElapsed; `spawned` is derived by the caller as kills + enemies alive,
  // which is exact (every enemy that ever spawned is either alive or dead) and needs nothing new in the sim.
  // Returns the one-shot commands fired THIS tick, for the DOM layer + tests: 'line:<id>' | 'help:hold' |
  // 'help:fly' | 'help:done'.
  function tick({ t, kills, alive, cleared }) {
    // A run RESTARTED (death → Restart, or a fresh take-off): the sim clock went backwards. Re-arm
    // everything. This is the whole of the restart contract, and it has a test.
    if (t < lastT) reset();
    lastT = t;
    const out = [];
    const spawned = kills + alive;

    for (const b of beats) {
      if (fired.has(b.id) || pending.some((p) => p.beat.id === b.id)) continue;
      const hit = b.on === 'start'   ? true
                : b.on === 'spawn'   ? spawned >= b.n
                : b.on === 'kill'    ? kills   >= b.n
                : b.on === 'cleared' ? !!cleared
                : false;
      if (!hit) continue;
      if (b.delay > 0) pending.push({ beat: b, dueAt: t + b.delay });
      else { speak(b, t, out); }
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      if (t >= pending[i].dueAt) { const { beat } = pending.splice(i, 1)[0]; speak(beat, t, out); }
    }

    const nextHelp = t < helpAt ? 'idle'
                   : t < helpAt + helpHold ? 'hold'
                   : t < helpAt + helpHold + helpFly ? 'fly' : 'done';
    if (nextHelp !== help) { help = nextHelp; if (help !== 'idle') out.push(`help:${help}`); }
    return out;
  }
  // A new line REPLACES whatever is up, immediately — no queue, no waiting for a fade.
  function speak(beat, t, out) { fired.add(beat.id); line = { key: beat.textKey, at: t }; out.push(`line:${beat.id}`); }

  return {
    reset, tick,
    get fired() { return [...fired]; },
    get help() { return help; },
    // What the DOM should show right now. alpha 1 while held, then a linear fade; 0 → nothing on screen.
    get view() {
      if (!line) return { lineKey: null, lineAlpha: 0, help };
      const age = lastT - line.at;
      const alpha = age <= lineHold ? 1 : Math.max(0, 1 - (age - lineHold) / lineFade);
      return { lineKey: alpha > 0 ? line.key : null, lineAlpha: alpha, help };
    },
  };
}
```

**Create `client/src/intro-director.test.js`** (`cd client && node --test`). Assert, driving `tick()` with a
synthetic clock at 1/60 s:

1. `l0` fires on the first tick; `view.lineAlpha === 1` for 3 s, then decays, and `lineKey` is `null` once
   the fade completes (t ≈ 5).
2. `help` goes `idle → hold` at t ≈ 5, `hold → fly` at t ≈ 8.5, `fly → done` at t ≈ 8.95, each emitting
   exactly one command.
3. `l1` fires when `kills + alive` first reaches 2, whatever the split (1+1 and 2+0 both work).
4. `l2` fires **2 s after** `kills` reaches 2, not on the kill tick.
5. `l3` fires when `spawned` reaches 4; `l4` fires on `cleared`.
6. **Replacement:** firing a beat while a line is mid-fade snaps `lineAlpha` back to 1 and swaps `lineKey`
   in the same tick — no queue.
7. **Restart re-arm (decision 4):** run the script to completion, then feed `t = 0` again → `fired` is empty,
   `help === 'idle'`, `view.lineKey === null`, and `l0` speaks again on the next tick.
8. Each beat fires **at most once** per run even if its trigger stays true for hundreds of ticks.

---

## Step 4 — the DOM: `client/index.html`, `client/styles.css`

**Every node added here is `pointer-events: none`.** The old cutscene overlay was a full-screen
`pointer-events: auto` layer with a click→advance handler; on a playable fight that would swallow steering
and fire taps, because `#stick-zone` (`client/index.html:278`) is a full-screen `pointer-events: auto` layer
underneath. Nothing the director draws is interactive. The Skip control is the sole exception, and it lives
in the Settings modal (Step 6), not on the battlefield.

**4a. `client/index.html`** — directly after the `#help` div (**lines 25–27**), add:

```html
<!-- Scripted intro (Level 0 only): the director's line, and the controls card that flies into #help.
     Both are NON-INTERACTIVE (pointer-events:none) — the player is flying underneath them. -->
<div id="intro-line"></div>
<div id="intro-help" data-i18n-html></div>
```

**4b. `client/styles.css`** — after the `#help` rules (**lines 24–29**):

```css
  /* The intro director's line, and the controls card that starts in the same slot.
     THE BOTTOM BAND IS CROWDED. Every occupant, measured from the bottom edge:
       #return-btn  — bottom:34, padding 12+12, line-height 1.2*16px = 19.2   →  top edge  77.2
       #rocket-btn  — bottom:40, 84px tall                                    →  top edge 124
       #fire-btn    — bottom:34, 96px tall (touch only)                       →  top edge 130
       #event-log   — bottom:132, up to 4 kill lines of ~19px + 2px gaps      →  top edge ~214
                      …and it is 240px wide at right:22, i.e. it spans x ∈ [vw-262, vw-22]
     The slot sits at bottom:96 on desktop (19px of air above "Finish and Return", which appears at the same
     instant as line L4) and bottom:150 on touch (20px above the FIRE button). Both clear the buttons.
     #event-log is the one that cannot be cleared HORIZONTALLY: the card is centred with max-width
     min(760px, 88vw), so its right edge passes x = vw-262 whenever the card is wider than vw-524 — true at
     the 1280px suite viewport (760 > 756) and on every phone. And vertically the desktop card (bottom
     96 → ~191 for two lines) runs straight into the log's 132→214 band. See 4d: during the intro the kill
     log yields. Everything here is pointer-events:none, so none of it could steal a tap even if it did
     overlap. */
  #intro-line, #intro-help {
    position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 7;
    pointer-events: none; opacity: 0; display: none;
    max-width: min(760px, 88vw); padding: 16px 22px; border-radius: 14px; text-align: center;
    background: rgba(6,10,16,.82); border: 1px solid rgba(255,255,255,.14);
    color: #eaf2ff; font: 500 clamp(15px,2.4vw,21px)/1.5 system-ui, sans-serif;
    box-shadow: 0 10px 40px rgba(0,0,0,.5);
  }
  body.touch #intro-line, body.touch #intro-help { bottom: 150px; }
  /* transform-origin: left top — flyIntroHelp() moves the card's LEFT/TOP onto #help's left/top and then
     scales about that same corner. With any other origin the scale would drag the corner off the target. */
  #intro-help { font-size: clamp(14px,2vw,18px); transform-origin: left top; }
  #intro-help b { color: #cfe6ff; }
  /* The flight into the corner: main.js measures the two rects, composes the translate+scale (KEEPING the
     -50% centring inside it) and drives opacity itself. This class supplies ONLY the transition — putting
     `opacity: 0` here would lose to the inline opacity main.js sets, and the card would never fade.
     Cosmetic; nothing in the sim watches it. */
  #intro-help.fly { transition: transform .45s cubic-bezier(.4,0,.2,1), opacity .45s ease; }
```

Add `#intro-line, #intro-help` to the `body.menu` hide list at **line 652** (a menu must never show them).

**4d. The kill log yields to the director.** `body.intro` is set by `updateIntro()` while a director is armed
(Step 5b) and cleared when it is not. Add beside the rules above:

```css
  /* THE KILL LOG YIELDS DURING THE INTRO. #event-log occupies bottom 132→~214 at the right edge and the
     line slot is 96→~191 (desktop) / 150→~245 (touch), so they overlap in both axes on the suite viewport
     and on every phone — and the intro's lines fire AROUND KILLS, which is exactly when the log is full,
     so this is the common case and not an edge one. Moving the log up puts it near the top of a landscape
     phone; narrowing the card cannot separate them (they would only clear at a card width under ~280px).
     So for the ~40 s of the intro the log is simply not drawn: one message at a time is the whole point of
     a tutorial, and every kill is still reported by the floating "+xx" credit popup at the kill site and by
     the HUD's credits + Destroyed counters. Scoped to the intro; every other level is untouched. */
  body.intro #event-log { display: none; }
```

**4c. `client/src/dom.js`** — add to the `el` inventory (after `perf`, ~line 31):

```js
  help: byId('help'),            // the permanent bottom-left controls cheatsheet (gets a touch variant)
  introLine: byId('intro-line'), // the intro director's current line
  introHelp: byId('intro-help'), // the intro's controls card, which flies into #help
```

---

## Step 5 — `client/src/main.js`

### 5a. Delete the cutscene runtime

Remove, in full:

| What | Anchor |
|---|---|
| `import { LEVEL0_CUTSCENE } from './level0-cutscene.js'` | line **41** |
| the `// ---------- Level-0 intro cutscene ----------` block: `cutFrozen`, `cutFired`, `cutQueue`, `cutPrevKills`, `cutRocketeerSeen`, `cutEnemyRockets`, `cutSeenRockets`, `cutOverlayEl`/`cutCardEl`/`cutSkipEl`/`cutLangEl` | lines **195–208** |
| `startIntroCutscene()` | lines **1760–1777** |
| `cutsceneStart` / `cutsceneObserve` / `cutsceneAdvance` / `cutsceneSkip` / `cutsceneEnd` / `cutsceneShowCard` / `cutsceneHideCard` / `buildCutsceneOverlay` | lines **1798–1900** |
| the `rs.play.cutscene && traceLevelName(...)` branch in `startPlaybackSession` | lines **1694–1700** → always `buildPlaybackUI(trace)` (the auto-finish is now flag-driven, Step 8) |
| `cutFrozen` in the accumulator guard + `while` condition; `cutObserve`/`cutEnd` in `tickDeps`; the post-loop `if (rs.play && rs.done && rs.cut && !rs.cutDone) cutsceneEnd();` | lines **1084**, **1094–1095**, **1103**, **1110** |
| the same three in the `window.__replay` step hook | lines **1930**, **1936**, **1944–1945**, **1952–1955** |
| `shouldPlayIntro` from the `./replay.js` import list | line **39** |

`finishIntro()` (**lines 1778–1796**) and `introMode` (**line 180**) **stay** — they are now the Skip path
(Step 6). Rewrite their comments accordingly: `rs.teardown()` + `seedSim(null)` + `G.replayMode = false` are now
defensive no-ops on a live intro, kept because `finishIntro` is also reached from `simulateIntroEnd()`.

Also purge the word from the comments at **72–73, 195–202, 884, 969, 1099, 1347–1350, 1621, 2036, 2095–2101**
and in `client/src/hud.js:98`, `client/src/sim.js:648,761`, `client/src/netsim.js:51–54`,
`client/src/sim-core/sim-random.js:3`, `client/src/sim-core/beam.test.js:691`, `client/src/netsim.test.js:139`,
`client/src/welcome.js:67,97,101,122,133`, `client/visual/README.md:33,61`. (Step 10 has the grep that proves it.)

### 5b. Arm the director

Near the top, beside the other module state:

```js
import { makeIntroDirector } from './intro-director.js'; // the scripted Level-0 intro (data on the descriptor)
let intro = null;         // the director for THIS run, or null on every level that carries no `intro` script
let introHelpFlown = false; // the controls card's one-shot flight into #help has been started
```

One function, called once per **sim tick** from the fixed-step loop, and one called once per **frame** from
the render half:

```js
// One sim tick of the intro director. `spawned` is derived as kills + enemies alive — exact, and it needs
// nothing new in the World. Nothing here can touch the simulation; the director only speaks.
function introTick() {
  if (!intro) return;
  for (const cmd of intro.tick({ t: world.combatElapsed, kills: G.kills,
                                 alive: enemies.length, cleared: levelRunner.cleared })) {
    if (cmd === 'help:hold') showIntroHelp();
    else if (cmd === 'help:fly') flyIntroHelp();
    else if (cmd === 'help:done') { el.introHelp.style.display = 'none'; }
  }
}
// Once per FRAME: push the director's view into the DOM. Cheap and idempotent. `body.intro` is what makes
// the kill log yield for the duration (see 4d).
function updateIntro() {
  document.body.classList.toggle('intro', !!intro);
  if (!intro) { if (el.introLine.style.display !== 'none') el.introLine.style.display = 'none'; return; }
  const v = intro.view;
  if (!v.lineKey) { el.introLine.style.display = 'none'; return; }
  if (el.introLine.getAttribute('data-i18n') !== v.lineKey) {
    el.introLine.setAttribute('data-i18n', v.lineKey);       // so a live EN/RU switch re-localizes it in place
    el.introLine.textContent = t(v.lineKey);
  }
  el.introLine.style.display = 'block';
  el.introLine.style.opacity = String(v.lineAlpha);
}
```

The card and its flight (a FLIP: measure both rects, then transition a translate+scale onto the card so it
visibly *becomes* the corner cheatsheet). **Two things here are load-bearing and easy to get wrong:**

1. **The `-50%` centring must stay INSIDE the composed transform.** `getBoundingClientRect()` reports the
   card where it is *already drawn*, i.e. with `translateX(-50%)` applied. Writing a bare
   `translate(dx, dy)` therefore drops the centring and the card jumps right by half its width the instant
   the flight starts. Compose it: `translate(calc(-50% + <dx>px), <dy>px)`.
2. **Opacity is driven from JS, not from the `.fly` class.** `showIntroHelp` sets an inline `opacity: 1`,
   which beats any class rule — an `opacity: 0` inside `.fly` would simply never apply and the card would
   land on `#help` at full opacity and sit there.

```js
function showIntroHelp() {
  introHelpFlown = false;
  el.introHelp.classList.remove('fly');
  el.introHelp.style.transition = 'none';
  el.introHelp.style.transform = 'translateX(-50%)';   // the base state the rects below are measured in
  const key = Device.input === 'touch' ? 'ui.help_touch' : 'ui.help';
  el.introHelp.innerHTML = t(key);
  el.introHelp.setAttribute('data-i18n', key);         // a live EN/RU switch re-localizes the card in place
  el.introHelp.style.display = 'block';
  el.introHelp.style.opacity = '1';
}
// The card flies into #help — the animation IS the lesson: "this is where the controls live from now on".
// Screen-space by construction (two getBoundingClientRect calls), so no camera reasoning is involved.
function flyIntroHelp() {
  if (introHelpFlown) return;
  introHelpFlown = true;
  const a = el.introHelp.getBoundingClientRect(), b = el.help.getBoundingClientRect();
  const s = Math.max(0.25, b.width / Math.max(1, a.width));
  const dx = b.left - a.left, dy = b.top - a.top;
  el.introHelp.style.transition = '';                  // hand the transition back to the .fly class rule
  el.introHelp.classList.add('fly');
  // KEEP the -50%: `a` was measured WITH it applied, so dx/dy are a delta on top of the centred position.
  // transform-origin is left top (styles.css), so the scale shrinks the card onto the corner it just landed on.
  el.introHelp.style.transform = `translate(calc(-50% + ${dx}px), ${dy}px) scale(${s})`;
  el.introHelp.style.opacity = '0';                    // inline, so it actually wins (see note 2 above)
}
```

`#help` itself is **never touched** — it is visible from the first frame exactly as today (decision 6).

Wire the ticks:
- in `animate()`'s `tickDeps` (**~line 1090**) add `onTick: introTick` (the new dep from Step 8);
- in the `window.__replay.step` deps (**~line 1940**) add the same;
- in `__game.stepSim` (**~line 1360**) call `introTick()` after each `update(BENCH_DT)` — otherwise a headless
  scenario that steps the sim deterministically would never advance the director;
- call `updateIntro();` in the render half of `animate()`, next to `updateBanner()` (**~line 1130**).

**New `window.__game` hooks** (all in the same object, ~lines 1286–1380). Four of them exist so the visual
suite can drive and observe this deterministically instead of racing it:

```js
    get combatElapsed() { return world.combatElapsed; }, // THE sim clock the director and the spawn floors share
    get enemyCount() { return enemies.length; },         // cheaper than enemies.length for a waitForFunction
    get gameStarted() { return G.gameStarted; },         // "is a fight running at all" (the runner's boot gate)
    setPaused,                                           // freeze the LIVE accumulator so stepSim is the only driver
    get intro() { return intro && { fired: intro.fired, help: intro.help, view: intro.view }; },
    // The suite boots into level-0 for every scenario, so the director's line/card would sit in the bottom
    // band of every screenshot and every rect measurement, and #skip-intro would widen the settings modal
    // that 14-reset-progress measures. Only 42-playable-intro is testing the director; everyone else asks
    // for the arena. THE SIMULATION IS NOT TOUCHED — the spawn floors still apply, because the suite must
    // fight the same level-0 production does. This silences the DOM half only.
    silenceIntro() { intro = null; G.skipIntro = null; updateIntro(); },
```

### 5c. Bootstrap: launch the intro as a live, recorded fight

Replace the intro branch (**lines 2094–2103**):

```js
    } else if (level.name === 'level-0') {
      // THE INTRO IS A FIGHT YOU FLY. The server serves the level-0 descriptor only while
      // current_progress === 0 (a new or freshly reset player), so `level.name` is the whole one-time gate —
      // no localStorage flag, so a genuine progress reset replays it (DECISIONS §63's rule survives its
      // cutscene). It is an ordinary campaign level from here: recorded like any other session, advancing
      // through the normal win path, with the scripted director talking over it.
      if (CATALOG.level.intro) { intro = makeIntroDirector(CATALOG.level.intro); G.skipIntro = skipIntro; }
      document.body.classList.remove('menu');
      G.gameStarted = true;
      beginLiveSession(); // arm the always-on recorder + seed the sim BEFORE reset() draws the spawn RNG
      reset();
    } else if (CATALOG.level.briefing) {
```

Ordering is load-bearing and mirrors `welcome.js:173` / `mainwindow.js:94`: `beginLiveSession()` seeds the
sim stream, `reset()` draws from it. `beginLiveSession` already no-ops under `REC`/`rs.play`/`BENCH`/
`G.replayMode`, so `?record`/`?playback` on level-0 are unaffected.

The director must also re-arm when the intro level is **re-entered** rather than restarted in place. The
`t < lastT` rule inside the director covers death → Restart (`mainwindow.js:114` → `reset()` → `combatElapsed`
back to 0) and any later take-off. No other wiring is needed.

### 5d. `skipIntro()` — the Skip path

The only guard is `introMode` — deliberately **not** a `CATALOG.levelName === 'level-0'` check. `skipIntro` is
also the body of the `simulateIntroEnd()` test seam, which `29-intro-live-handoff` and
`30-session-upload-on-hide` call on a shared throwaway player that an earlier scenario may already have
advanced past level-0; a level check there would make both scenarios hang waiting for a menu that never
opens. Reachability is enforced where it belongs — the Settings row only exists while `G.skipIntro` is
published, which happens only on the level-0 branch of bootstrap.

```js
// Skip the whole intro: end it here and land on the Level-1 briefing, through exactly the same finishIntro
// path the cutscene used (progress 0 → 1, server-authoritative). Reached from the Settings modal, which has
// already paused the fight — so this can never be triggered by a stray tap while flying — and from the
// simulateIntroEnd() test seam.
function skipIntro() {
  if (introMode) return;
  introMode = true;                 // finishIntro's own guard
  intro = null; G.skipIntro = null;
  el.introLine.style.display = 'none'; el.introHelp.style.display = 'none';
  flushSession('quit');             // the abandoned intro session still reaches the funnel
  G.gameStarted = false; G.roam = false;
  document.body.classList.add('menu');
  setPaused(false);
  finishIntro();                    // advance 0 → 1, then showMain(level-1 briefing)
}
```

`finishIntro` already clears `introMode`, calls `unlockNextLevel()` and lands on `showMain(briefing)`.
Clear `G.skipIntro = null` in `finishIntro` too, so the Settings row cannot survive the intro.

### 5e. Keep the `simulateIntroEnd` seam

`__game.simulateIntroEnd()` (**line 1351**) becomes:

```js
    simulateIntroEnd() { skipIntro(); rs.done = true; return { playDone: rs.done, playActive: !!rs.play }; },
```

It still reproduces the exact state `29-intro-live-handoff` guards (a live session inheriting a stale
`rs.done`). That invariant is still real — `stepReplayTick` must keep stepping when `rs.play === null` — and
it is pinned by both the scenario and the unit test in `replay.test.js`.

### 5f. `#help`'s touch variant

In bootstrap, immediately **before** `applyTranslations()` (**line 2077**):

```js
    // #help has always rendered the KEYBOARD cheatsheet, on phones too (styles.css carries no body.touch
    // rule for it) — visible nonsense on a device with no keys, and glaring now that the intro's controls
    // card flies into it. Device.input is constant per session, so swapping the key once here is enough.
    if (Device.input === 'touch') el.help.setAttribute('data-i18n', 'ui.help_touch');
```

---

## Step 6 — `client/src/settings.js`: the Skip control

**Placement, and why not on the battlefield.** Every screen edge is already taken during the intro:
top-left is the ⚙ gear (`12,11`, 36×36) with the shield/HP bars starting at x ≈ 62; top-centre-right is
`#pause-btn` (`left:50%` + 108px); top-right is `#hud .right` (credits + "Destroyed", y ≈ 14–85) — which is
exactly where the old cutscene Skip sat, and it only worked because `body.cutscene` hid the HUD; the right
edge is `#zoom`; bottom-left is `#help`; bottom-centre is the line slot and `#return-btn`; bottom-right is
`#rocket-btn` and, on touch, `#fire-btn`. A button squeezed into any of them is either overlapping HUD or one
thumb-width from the fire controls.

So Skip lives **in the Settings modal**, reached by the ⚙ gear — which is always available, sits above every
overlay, and **already pauses a live fight when opened** (`settings.js:54–60`). Two deliberate acts are needed
to skip, and the fight is frozen while you decide: it cannot be hit accidentally, and it needs no confirm
dialog of its own.

**6a. `client/index.html`** — inside `.settings-box`, immediately before `#credits-open` (**line 209**):

```html
    <!-- Shown only while the scripted intro (Level 0) is running — main.js publishes G.skipIntro -->
    <button id="skip-intro" class="ghost" data-i18n="ui.intro.skip" style="display:none">Skip the intro</button>
```

**6b. `client/src/settings.js`** — in `openSettings()` (line **54**), before `settingsOverlay.classList.add('on')`:

```js
  // The intro is skippable from here and nowhere else: the gear is the one control that is always reachable
  // and that pauses the fight on the way in, so a skip is always deliberate. main.js publishes the handler
  // while the intro runs and clears it when the intro ends.
  skipIntroBtn.style.display = typeof G.skipIntro === 'function' ? 'block' : 'none';
```

and, beside the other listeners (~line 66):

```js
skipIntroBtn.addEventListener('click', () => { const go = G.skipIntro; closeSettings(); if (go) go(); });
```

`closeSettings()` runs first so its `setPaused(false)` cannot un-pause a menu the skip is about to open.

---

## Step 7 — i18n

**7a. `client/locales/source.json`** — delete the seven `ui.cutscene.*` entries (**lines 610–637**) and add,
in their place, the five intro lines. English is the source of truth; keep the translator `context` notes in
the established style.

```json
  "ui.intro.l0": {
    "source": "First posting, fresh commission, an easy hop out to the station. …Contact on approach — no transponder, no answer to my hails. Whatever that is, it's swinging onto me.",
    "context": "Opening line of the PLAYABLE Level-0 intro, shown over the fight from the first second (the player is already flying). First-person narration by a rookie Vega Sentinel on the way to a first posting, ambushed on approach by something that looks like a pirate. Grounded and a little scared, NOT a quipping hero. Two short sentences."
  },
  "ui.intro.l1": {
    "source": "He wasn't alone out here. Rockets, then — pod's live on F.",
    "context": "Line fired when the SECOND pirate warps in, during the playable Level-0 intro. First-person; the pilot realizes there is more than one enemy and brings the ship's rocket launcher online. Teaches the rocket through the action, not as a tutorial instruction. 'F' is the keyboard binding and must stay as-is; on touch the player uses the on-screen rocket button, so do not translate 'F' into words. Very short."
  },
  "ui.intro.l2": {
    "source": "That's two. …How many more of these are out here?",
    "context": "Line fired 2 s after the SECOND pirate is destroyed, during the playable Level-0 intro. First-person, wry and a little uneasy — the fight is not ending. Very short."
  },
  "ui.intro.l3": {
    "source": "This one hits back with rockets. A rocket only turns so hard — stay off its line, or put a round through it.",
    "context": "Line fired when the rocket-armed pirate warps in (the last enemy of the playable Level-0 intro). First-person; the two answers to an incoming rocket are dodging it and shooting it down. Teaches through the action. Short."
  },
  "ui.intro.l4": {
    "source": "Sector's quiet. Nothing left out here — take her home.",
    "context": "Line fired the moment the last enemy of the intro dies and the 'Finish and Return' button appears at the bottom of the screen. First-person; points the player at ending the mission and flying home. Short."
  },
  "ui.intro.skip": {
    "source": "Skip the intro",
    "context": "Button inside the Settings modal, shown only during the intro level, that ends the intro and moves the player straight to the first real mission briefing. Short."
  },
  "ui.help_touch": {
    "source": "<b>Left side</b> — drag to steer · <b>FIRE</b> — shoot · <b>🚀</b> — rocket",
    "context": "TOUCH version of the on-screen controls cheatsheet (HTML), shown instead of ui.help on phones/tablets. The player steers by dragging anywhere on the left of the screen and taps the on-screen FIRE and rocket buttons. Keep the 🚀 glyph and the word FIRE (it is the label printed on the button itself); translate the action words."
  },
```

**7b. `client/locales/ru.json`** — delete lines **154–160** (`ui.cutscene.*`) and add RU for
`ui.intro.l0…l4`, `ui.intro.skip`, `ui.help_touch`, keeping the first-person register of the existing RU
cutscene lines (they are the maintainer's own voice for this pilot — mine them for tone, don't reuse
verbatim, since the beats have changed). Suggested:

```json
  "ui.intro.l0": "Первое назначение, свежий патент, короткий прыжок до станции. …Метка на подлёте — без транспондера, на запросы молчит. И разворачивается на меня.",
  "ui.intro.l1": "Он был тут не один. Тогда ракеты — пусковая на F.",
  "ui.intro.l2": "Это два. …И сколько их тут ещё?",
  "ui.intro.l3": "У этого — ракеты. Ракета доворачивает не бесконечно: держись вне её линии или сбей её.",
  "ui.intro.l4": "В секторе тихо. Здесь больше никого — веди её домой.",
  "ui.intro.skip": "Пропустить вступление",
  "ui.help_touch": "<b>Слева</b> — веди пальцем, чтобы рулить · <b>FIRE</b> — огонь · <b>🚀</b> — ракета",
```

Keep JSON commas valid. `level.0.victory` is unchanged and still fires on the win overlay.

---

## Step 8 — `client/src/replay.js`: take "cutscene" out of the generic machinery

The mechanism stays; only the intro's use of it goes. One behaviour is worth keeping and is genuinely
generic: **a trace records keys and touch, never a mouse click, so the "Finish and Return" that ends a
mission is not in it** — a playback of a winning run would otherwise sit in a cleared arena forever. That
becomes an explicit, opt-in flag instead of a cutscene side effect.

- `evalPlayback` (**lines 69–79**): the `cutscene` flag becomes **`finish`** (`?playback&id=…&finish=1`).
  Same parsing, same `0/false/off` handling.
- `makeReplaySession` (**lines 205–228**): drop `cut`, `cutDone`, `cutReturning`; add `autoFinish` (bool,
  set from `rs.play.finish` at playback start) and `returning`. Update `teardown()` to clear both — the
  "reset every field" invariant the existing unit test pins.
- `CUTSCENE_STALL_TICKS` (**line 168**) → **`RETURN_HOME_STALL_TICKS`**, same value (900) and same comment
  logic, reworded off the cutscene.
- `stepReplayTick` (**lines 254–274**): replace the injected `cutObserve` / `cutEnd` with `onTick` (called
  every tick after `capture`, for the intro director and any future per-tick observer) plus `isCleared` /
  `isWon` / `finish`, and move the auto-finish logic **into** this module:

```js
  update(dt);
  if (rs.play && rs.trace && !rs.returning) rs.index++;
  if (capture) capture();
  if (onTick) onTick();
  // ?playback&finish — press "Finish and Return" for the pilot when the sector clears, and stop the re-sim
  // on the victory overlay. A trace cannot carry that click, so without this a winning replay never ends.
  if (rs.autoFinish && !rs.done) {
    if (!rs.returning && isCleared()) {
      rs.returning = true;
      for (const c in keys) keys[c] = false; touchAim.active = false; // no input → the autopilot isn't cancelled
      finish();
    } else if (rs.returning && isWon()) { rs.done = true; return 'stop'; }
    if (rs.noteTick(rs.returning && !isWon()) >= RETURN_HOME_STALL_TICKS) { rs.done = true; return 'stop'; }
  }
```

`isCleared` is main.js's `() => G.returnToBase && !levelRunner.won` (the old predicate, unchanged) and
`finish` is `finishMission`. The `rs.returning` key-clear at the **top** of `stepReplayTick` (line 256) stays.

- `shouldPlayIntro` (**lines 276–285**) is **deleted** — the bootstrap gate is `level.name === 'level-0'`.
- Update `client/src/replay.test.js`: the `evalPlayback` cases (**lines 30–37**) for `&finish`, the session
  teardown case (**165–166**) for the new field names, and **delete** the `shouldPlayIntro` test
  (**313–318**). **Keep** the `rs.play === null, rs.done === true` → *steps* test — that is the intro→Level-1
  dead-controls invariant and it outlives the cutscene.

---

## Step 9 — the canonical trace (READ THIS BEFORE TOUCHING ANYTHING ELSE)

**The hazard.** Level-0's *fight* changes: enemy #1 now warps in at t = 3 instead of t = 0. The canonical
trace `client/assets/recordings/level0-intro.6674d840.json` is a recording of the OLD level-0, and its player
input will no longer clear the new one. Seven files ride on that trace, and **three of them pin the
outcome**:

| Consumer | Pins the outcome? | Effect of the pacing change |
|---|---|---|
| `server/tools/sim-replay.test.js:43-59` | **yes** — `kills 4`, `earned 250`, `cleared`, `returning`, `alive`, `ticksRun === ticksTotal` | **fails** until re-recorded |
| `server/src/seal/verify-run.test.js:38` | **yes** — `TRUTH = { credits: 250, xp: 125, kills: 4 }`, used by most tests in the file | **fails** until re-recorded |
| `client/visual/scenarios/22-intro-replay.mjs` | **yes** — `kills 4`, `won`, and five cards | **rewritten** (Step 9c) |
| `client/visual/scenarios/36-sim-divergence.mjs` | no — browser vs Node **agreement** | safe |
| `client/visual/scenarios/37-netsim.mjs` | no — proves netsim defers to a replay | safe (drop `&cutscene=1`) |
| `client/visual/scenarios/35-playback-loads-samples.mjs` | no — asserts `.mp3` samples load within 600 ticks | safe (the recorded input still fires the guns) |
| `server/src/netsim/room.test.js:29-45` | no — room vs referee agreement | safe |

CI never has the trace (it is gitignored, and every server test `{ skip }`s when it is absent), so the
pipeline's own gate cannot go red from this — but a machine that has run `npm run assets:pull` will see it,
and shipping a stale fixture would rot three real guards.

**Cost note for the maintainer, stated once:** this is the price of the 3 s first-spawn delay. If at review
you would rather keep the fixture untouched, delete `spawn.earliest` from Step 1b and the `blocked` plumbing
from Step 2 — the director then simply narrates over the existing pacing (enemy #1 spawns at t = 0 and
materialises over 2–4 s, so it *arrives* at 2–4 s), and steps 9a–9c disappear. Everything else in this plan
is unaffected. I am planning the delay as instructed.

### 9a. Regenerate the trace — the cheap path first

The old fight is preserved *exactly* by a 3-second shift: the seeded draw **sequence** is unchanged (the
spawn gate draws when it fires, whenever that is), the player's ship does not drift while no key is held, and
`blocked` freezes rather than drains the cooldown. So prepend **180 idle ticks** to the packed runs:

```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-08-30-1654-playable-intro
npm run assets:pull                       # the trace is a gitignored S3 asset
node -e '
  const fs=require("fs");
  const src="client/assets/recordings/level0-intro.6674d840.json";
  const t=JSON.parse(fs.readFileSync(src,"utf8"));
  t.runs.unshift([{k:[],t:null},180]);     // 3.00 s of the pilot sitting still, reading the opening line
  t.tickCount=(t.tickCount||0)+180;
  fs.writeFileSync("/tmp/level0-intro.json",JSON.stringify(t));
'
node server/tools/sim-replay.mjs /tmp/level0-intro.json --json
```

**180 IS EXACT — DO NOT "FIX" IT TO 181.** `180 × (1/60)` sums in floating point to
`2.9999999999999942`, which is `< 3`, so the floor is still blocking on the last idle tick and unblocks on
the **first recorded tick** — leaving the spawn on the same relative tick it had in the original recording.
181 would spawn the enemy one tick before the recorded input resumes and shift the whole fight.

**Accept it only if that prints `kills 4`, `earned 250`, `earnedXp 125`, `cleared true`, `returning true`,
`won false`, `enemies 0`, `hp 100` and `ticksRun === ticksTotal`.** Print `hash` and `draws` too and record
both in the PR — they are the numbers a future desync will be diffed against. **Two expectations to hold
loosely:** `draws` came out at 38 in the verification run, but a matching count is not by itself proof (the
first pirate now forms *after* `ENEMY_FIRE_GRACE` has lapsed rather than during it, so the draw **order**
permutes even where the count does not); and `loot` legitimately moves **1 → 0** for the same reason. **A
changed `loot` is not "diverged, re-record"** — the load-bearing fields are the six above.

The one way this can genuinely fail is worth naming: `ENEMY_FIRE_GRACE` is measured from the run start, not
from the spawn, so after the shift the first pirate is formed (at 5–7 s) *after* the grace has already
lapsed, where before it was formed during it. If a shifted enemy happened to be in gun range (45 u) at that
moment the fight would diverge outright. The command above answers that in about a second.

**If it diverges**, record a real one — the intro is now playable, so this is a 60-second job and it produces
a genuine playthrough of the shipped level:

```
# local server running (see the run-local skill), then in a browser:
#   http://localhost:4000/?record&level=level-0
# → "Start recording" → clear all four → "Stop & Save" (downloads level-0-<seed>.json)
node server/tools/sim-replay.mjs ~/Downloads/level-0-<seed>.json --json   # must show kills 4 / cleared true
```

Equivalently, take the maintainer's own live-test run from `/admin/sessions` — every intro session is now
recorded (Step 5c), which is the point.

### 9b. Publish it

```bash
H=$(shasum -a 256 /tmp/level0-intro.json | cut -c1-8)
cp /tmp/level0-intro.json client/assets/recordings/level0-intro.$H.json
aws s3 cp client/assets/recordings/level0-intro.$H.json \
  s3://<bucket>/recordings/level0-intro.$H.json \
  --cache-control 'public, max-age=31536000, immutable' --content-type application/json
# bucket + profile: scripts/assets-config.mjs (PREFIX.recordings, awsArgs)
npm run assets:check      # must resolve the new introTrace URL
```

Then set `introTrace: 'assets/recordings/level0-intro.<H>.json'` in `catalog_seed.js` (Step 1b).

**No `/publish-itch` is required for this hash.** The learned rule covers content-hashed URLs the *client
fetches*; after this change the client never fetches the trace (only tests and Node tools resolve it), so a
stale copy in the itch bundle cannot 404 anything a player sees. Do publish itch for the *feature* if the
maintainer ships it there, but not on account of the trace.

### 9c. Rewrite `client/visual/scenarios/22-intro-replay.mjs`

It keeps its job — *the canonical trace must still re-sim to a cleared level, so a change that shifts the
seeded gameplay stream is caught* — and loses the five cards. Change the header comment (it is a
determinism guard on a canned trace, not an intro guard), the URL to
`?playback&id=…&finish=1&debug`, drop the `if (r.cut().frozen) r.advance()` loop and the `cards` assertion,
and keep `kills === 4` + `won === true` (the `&finish` flag is what produces the dock). Rename the scenario
to `trace-replay` and the file to `22-trace-replay.mjs`.

---

## Step 10 — the consumer sweep (run this; it is the gate)

Two sweeps, because there are two changes: a **deletion** (the word *cutscene*) and a **pacing change** (the
3 s / 8.95 s spawn floors). The second one has the wider blast radius, and it is 10b.

### 10a. The deletion sweep

```bash
cd /Users/kbagaiev/Projects/ag-wt/2026-08-30-1654-playable-intro
grep -rn -i -e cutscene -e LEVEL0_CUTSCENE -e shouldPlayIntro -e startIntroCutscene -e cutFrozen \
  client server scripts docs/SUMMARY.md docs/narrative | grep -v node_modules
```

After the change this must return **nothing** outside `docs/CHANGELOG.md`, `docs/DECISIONS.md` (history — never
edited) and `docs/plans/` (historical briefs). Concept words, not just symbols: `cutscene`, `tap to continue`,
`pause card`, `introSeen`.

Verified-unaffected, do **not** "fix" them:
- `enemyTotal` stays 4 → `server/src/enemy_total.test.js:42` unchanged; the HUD killed/total still reads `/4`.
- `advanceWhen {kills:3}` unchanged → the phase-2 rocketeer trigger is unchanged.
- level 0 has **no** `lastKillDrop`, so the `kills === enemyTotal` reward-drop trigger is not involved.
- `winCondition: { type: 'allEnemiesDead' }` unchanged.
- `server/src/server.test.js:109-119,159-161` assert `introTrace` present on level-0 / absent on level-1 /
  present for a reset player. All three **still hold** (the field stays on level-0 only). Rewrite their
  *comments*: they no longer describe a client cutscene gate, they describe the fixture living on level 0.
- `scripts/assets-check.mjs:72-75`, `assets-pull.mjs:24`, `assets-config.mjs:18,148` keep working — only
  their "intro cutscene" wording needs updating to "the canonical Level-0 trace".
- `29-intro-live-handoff.mjs` keeps running via the `simulateIntroEnd` seam; update its header comment (the
  stale-`rs.done` state now comes from Skip, not from a cutscene ending).
- `11-character-progression.mjs:12` and `18-briefing-staged-reveal.mjs` mention the intro in comments only.
- `client/src/netsim.test.js:139` — title/comment only.

### 10b. The PACING sweep — the whole visual suite boots into level-0

**This is the one that bites.** `client/visual/run.mjs:32` sets `BASE_URL = http://localhost:PORT/?debug`
and **every** scenario is navigated to it at line 109, on a shared throwaway player who starts at
`current_progress = 0`. With `shouldPlayIntro` deleted, that boot is the level-0 fight for every scenario in
the suite — and it now has **no enemy for the first 3 s of sim**, with #2 floored to ≥ 8.95 s.

Worse than it sounds: on the harness's software GL the accumulator caps at 6 steps/frame, so at ~6 fps the
**sim clock runs BEHIND wall clock** (~0.6 s of sim per second real). A 3 s sim-time floor can be 5+ s of
wall clock. Any fix built on `waitForTimeout` is therefore wrong twice over.

**The fix, applied once, centrally** — in `run.mjs`, immediately after the existing take-off click and its
`waitForTimeout(150)` (**lines 113–119**), replace that sleep with a state gate:

```js
        // The arena may not have an enemy yet. Level-0 — the level the throwaway player boots into for
        // EVERY scenario — now holds its first spawn until combatElapsed >= 3 s so the intro's opening line
        // can be read. Scenarios have always been handed a live arena, so wait for that STATE. Never a
        // sleep: on software GL the sim runs behind wall clock, so a fixed delay is both flaky and wrong.
        await page.waitForFunction(() => {
          const g = window.__game;
          if (!g || !g.player) return false;
          if (!g.gameStarted || g.levelRunner.won) return true; // a menu or a finished fight: nothing to wait for
          return g.enemyCount > 0;
        }, null, { timeout: 20000 }).catch(() => {});           // a scenario that legitimately never spawns proceeds
        // …and hand every scenario the ARENA rather than the intro's chrome (see __game.silenceIntro).
        // 42-playable-intro re-arms the director with its own page.goto.
        await page.evaluate(() => window.__game && window.__game.silenceIntro && window.__game.silenceIntro());
```

**Every scenario that boots into level-0 without injecting its own enemies, and its verdict:**

| Scenario | Depends on the default wave? | Verdict |
|---|---|---|
| `01-smoke` | **yes** — `assert.equal(info.enemies, 1)` after 200 ms (line 17) | **fixed by the gate** (exactly 1 enemy exists when it is satisfied — #2 needs #1 dead *and* t ≥ 8.95). Update the assertion message from "the arena seeds one enemy immediately" to "the arena's first enemy has arrived — level-0 holds it until the intro's opening line has been read; the runner waits for it". |
| `04-combat` | **yes** — `enemies > 0 \|\| earned > 0` after 2.5 s of firing (line 19) | **fixed by the gate**; would otherwise fail outright (2.5 s wall ≈ 1.5 s sim < 3). |
| `06-pause` | **yes** — `enemies > 0` after 400 ms (line 24) | **fixed by the gate**; `worldSig` still changes with one enemy. |
| `19-hud-log` | **no** — spawns its own via `__game.spawnEnemy()` (line 25) before zeroing every enemy's hp | **safe as written** (I disagree with the critic's read here: the kill line comes from its own spawn, so it never needed the default wave). It *does* assert on `#event-log`, which `body.intro` hides — `silenceIntro()` in the gate clears that class, so it is unaffected. **Do not** hide the event log without the silence hook. |
| `13-ship-bank` | no — spawns two of its own before `enemies.length > 0` (line 68) | safe |
| `24-freighter-exhaust`, `26-ship-model-cache`, `27-smoke-instancing`, `16-enemy-health-bar`, `17-triple-spiral-rocket`, `20-warp-blast-immunity`, `25-enemy-shield`, `11-l4-enemies`, `99-fill`, `08-arena-boundaries` | no — each clears `g.enemies` and/or spawns exactly what it needs | safe |
| `02-ship-explosion`, `12-audio`, `23-topbar-credits-radar`, `28-scene-warm`, `31-speed-field`, `03-exhaust-trail` | no enemy dependency (23 measures only the top-left cluster + Main Window) | safe |
| `37-netsim`, `41-enemy-beam-netsim`, `40-enemy-beam`, `39-charge-beam`, `38-ally` | the ROOM runs the same descriptor, so the floors apply server-side too — but all of them already `waitForFunction(enemies.length > 0)` with a long timeout | safe; `37:76`'s `enemyTotal === 4` is unchanged |
| `10-mission-board` | a side mission, its own descriptor | safe |
| `30-session-upload-on-hide` | uses `simulateIntroEnd()` then takes off | **safe, comment stale.** Its step-1 comment says "the recorder is armed by the take-off flow" — the intro is now recorded from boot, so update it. `skipIntro`'s `flushSession('quit')` adds one earlier POST; the scenario reads `posts[posts.length - 1]` (the post-hide one) and asserts `posts.length >= 1`, so both still hold. |
| `29-intro-live-handoff` | `simulateIntroEnd()` seam | safe — and see 5d: this is why `skipIntro` has no level check |
| `14-reset-progress` | opens Settings and asserts `boxH <= winH` (line 45) | **would break without `silenceIntro`**: a progress-0 player publishes `G.skipIntro`, so `#skip-intro` renders and the modal grows. The gate's `silenceIntro()` clears `G.skipIntro` before every scenario body, so the row is hidden here. `42` asserts the fit **with** the row visible (see Tests). |
| `05`, `07`, `09`, `12-sell`, `15`, `18`, `21`, `32`, `33`, `34`, `96`, `97` | menu/map/roam scenarios; none reads the default wave | safe |
| `22-trace-replay`, `35`, `36` | own `page.goto` with `?playback` | safe (and see Step 9) |

---

## Tests

**`cd client && node --test`**
- **new** `client/src/intro-director.test.js` — the eight assertions in Step 3, including the restart re-arm.
- `client/src/sim-core/spawn-timing.test.js` — `blocked` freezes the cooldown; unblocked behaviour unchanged.
- `client/src/sim-core/level-runner.test.js` — the `earliest` floors, the `spawnDur ∈ [2,4]` guard, and
  `finalStageBanner: false`.
- `client/src/replay.test.js` — `&finish` parsing, the renamed session fields, teardown clears them, and the
  retained `rs.play === null && rs.done === true` → steps test. Delete the `shouldPlayIntro` test.

**`cd server && npm test`** (Postgres; `pretest` drops/recreates `spacegame_test`)
- `enemy_total.test.js` unchanged (level-0 is still 4).
- `server.test.js` — comment rewrites only, assertions unchanged.
- `server/tools/sim-replay.test.js` + `server/src/seal/verify-run.test.js` — **must pass with the regenerated
  trace present** (Step 9a). Confirm they still `{ skip }` cleanly when it is absent.

**Client visual suite** (`cd client && node visual/run.mjs`, needs `npm run assets:pull` first). Baseline is
~6 flaky scenarios — judge by the reliably-passing set and **zero page errors**.
- `22-trace-replay` (rewritten, Step 9c) — `kills === 4`, `won === true`.
- `36-sim-divergence`, `37-netsim` (drop `&cutscene=1`), `35-playback-loads-samples` — must still pass.
- `29-intro-live-handoff` — must still pass through the reworked seam.
- **new** `client/visual/scenarios/42-playable-intro.mjs`. **Its clock discipline is the thing to get right.**
  `__game.stepSim(n)` calls `update(BENCH_DT)` directly, but the **live rAF accumulator is stepping the sim
  at the same time** (`main.js:987` `const live = G.gameStarted && !BENCH && !REC && !rs.play &&
  !netsimDriving`), so a bare step count asserts against an unknown clock — real frames have already
  advanced `combatElapsed` by an unbounded amount before the first `stepSim` call. So: **freeze the live
  loop, make `stepSim` the only driver, and assert on `__game.combatElapsed`, never on a step count.**
  `setPaused(true)` stops the accumulator (`animate()` gates its loop on `!G.paused`) while leaving
  `stepSim` — a direct `update()` call — and the render half (`updateIntro()`) running.

  ```js
  // Reset the shared throwaway player to progress 0 (the same endpoint 14-reset-progress mocks and
  // 97-briefing-showcase drives), then boot the intro on a fresh page.
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  await page.evaluate((pid) => fetch(`/api/players/${pid}/reset`, { method: 'POST' }), pid);
  await page.goto(baseURL, { waitUntil: 'load' });   // ?debug — the intro is NOT gated off headless any more
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 15000 });
  await page.evaluate(() => window.__game.setPaused(true));   // stepSim is now the ONLY driver of the clock
  const stepTo = (t) => page.evaluate((t) => {                // advance the SIM CLOCK to t seconds
    const g = window.__game;
    let guard = 0;
    while (g.combatElapsed < t && guard++ < 20000) g.stepSim(1);
    return g.combatElapsed;
  }, t);
  ```

  1. **Live and recorded.** `__game.sessionRec().active === true` and `.level === 'level-0'` — proves Step 5c
     armed the recorder, which is the funnel value of the whole change. `__game.levelName === 'level-0'`.
  2. **The opening line, and it does not eat input.** `#intro-line` is displayed and its text equals the EN
     `ui.intro.l0`; `document.elementFromPoint(cx, cy)` at its own centre returns the **canvas**, not
     `#intro-line` — the `pointer-events: none` hard constraint, asserted rather than assumed.
  3. **The spawn floor, end to end.** `await stepTo(2.9)` → `__game.enemyCount === 0`;
     `await stepTo(3.1)` → `enemyCount === 1`. (`combatElapsed` may already exceed 2.9 from the frames
     before the pause; read it first and skip the sub-assertion if so rather than failing on a race — the
     `3.1` assertion is the load-bearing one.)
  4. **The card.** `await stepTo(5.2)` → `#intro-help` displayed, its text matches the desktop `ui.help`
     (i.e. contains "thrust" and "rocket"). `await stepTo(8.7)` → it carries `fly`.
  5. **The flight lands — an OUTCOME, not a class.** The CSS transition runs on wall clock, so poll the rect
     (this is DOM, not sim): `await page.waitForFunction(() => { const a =
     document.getElementById('intro-help').getBoundingClientRect(), b =
     document.getElementById('help').getBoundingClientRect(); return Math.abs(a.left - b.left) <= 4 &&
     Math.abs(a.top - b.top) <= 4 && Math.abs(a.width - b.width) <= 0.15 * b.width; }, null, { timeout: 3000 })`
     — this is what fails if the `-50%` is dropped from the composed transform (the card would land half its
     own width to the right). Then assert the card faded: computed `opacity < 0.05` — this is what fails if
     `opacity` is left to the class rule. Finally `await stepTo(9.2)` → `display === 'none'`.
  6. **The bottom band does not collide.** With `#intro-line` visible and `#return-btn` forced visible
     (`el.style.display = 'block'`), assert `#intro-line`'s rect intersects **none** of `#return-btn`,
     `#rocket-btn`, `#event-log` — and that `#event-log` is not rendered at all while `body.intro` is set
     (the rule in 4d). Keeping the rect check as well as the display check is deliberate: if someone
     un-hides the log later, the geometry is still guarded. Repeat the three-way check once at
     `page.setViewportSize({ width: 812, height: 375 })` with `body.touch` applied, which is where the
     overlap is worst.
  7. **Skip.** Open Settings (`#settings-btn`) → `#skip-intro` is visible **and the modal still fits**
     (`.settings-box` height ≤ `window.innerHeight`, the same assertion `14-reset-progress:45` makes — this
     is the only place it is checked with the intro row present, because the runner's `silenceIntro()` hides
     it everywhere else). Click it → the page lands on the Main Window with the Level-1 briefing and
     `__game.levelName === 'level-1'`.
  8. **Restart re-arms.** `page.evaluate(() => { window.__game.player.hp = 0; })`, step until the Game-over
     overlay shows, click `#restart`, then `stepTo(0.5)` → `__game.intro.fired` contains `l0` again and
     `__game.intro.help === 'idle'`. This is the in-browser half of the director's unit-tested restart
     contract.

  Restore the viewport (`1280×800`) and remove `body.touch` before returning, so the next scenario in the
  worker's queue is not left on a phone layout. The scenario ends with the shared player at progress 1
  (step 7 skipped the intro, which advances) — that is fine and is what `18` and `97` already do: the
  runner's boot clicks take-off on whichever menu is up.

**Live test (Stage 9, the maintainer):** reset progress → load → you are flying immediately with L0 on
screen → the first pirate warps in at ~3 s → the controls card appears, holds, flies into the bottom-left →
kill #1 → #2 arrives with L1 → L2 two seconds after #2 dies → the rocketeer arrives with L3 and **no
"FINAL STAGE" banner** → clear it → L4 + "Finish and Return" → fly home → victory → Continue → Level-1
briefing. Then: die on purpose → Restart → **every line plays again from the top**. Then: ⚙ → "Skip the
intro" → straight to the Level-1 briefing. Then on a phone: the cheatsheet reads the touch variant, and the
card lands on it. Finally `/admin/sessions` shows the intro run and plays it back.

---

## Docs to update

- **`docs/SUMMARY.md`**
  - **Replace the whole `### Level-0 intro cutscene (on the playback) — ?playback&id={id}&cutscene=1`
    section (lines 617–640)** with a `### The scripted intro (Level 0)` section: it is a live, recorded
    campaign level; the director script is descriptor data (`intro.beats` + the four timing numbers); the
    clock is `world.combatElapsed`; the spawn floors are `spawn.earliest`; the lines hold 3 s / fade 2 s and
    a new line replaces the old one; the controls card holds 3.5 s and flies into `#help`; Skip lives in
    Settings; progress advances through the normal win path; `finalStageBanner: false`.
  - **`### Combat record/playback` (line 492)** — `&cutscene` is now `&finish` and means "press Finish and
    Return when the sector clears"; `shouldPlayIntro` is gone.
  - **Landing screen (lines 1371–1383)** — the intro auto-launch now also arms the session recorder and the
    director; it is a fight, not a cutscene.
  - **Level flow, `level-0` bullet (lines 1826–1830)** — the 3 s first spawn, the help-gone floor, no FINAL
    STAGE banner, no kill log, and that `introTrace` is now only a test fixture.
  - **Controls (line 266 area)** — `#help` has a touch variant (`ui.help_touch`).
  - **The event log** (wherever the HUD section describes it) — it is not drawn during the intro
    (`body.intro`), because it shares the bottom band with the director's line; every kill is still reported
    by the credit popup and the Destroyed counter.
  - **Language switching** — the EN/RU toggle now has **two** hosts, not three: the welcome screen and the
    Settings modal (the cutscene host went with the cutscene). Fix wherever SUMMARY repeats §64's list.
  - **Client module layout (line 3227)** — `intro-director.js` in, `level0-cutscene.js` out.
  - **Tests (line 3922)** — the new unit test + `42-playable-intro`, `22-intro-replay` → `22-trace-replay`,
    and the visual runner's new boot gate (it waits for the arena to have an enemy and calls
    `__game.silenceIntro()`, because every scenario boots into level-0).
  - Bump **`**Updated:**`** (line 6) and lead it with this change.
- **`docs/CHANGELOG.md`** — one bullet under today's date:
  > **The intro is a fight you fly.** Level 0 is no longer a replayed cutscene: the player controls the ship
  > from the first second while a scripted **director** speaks five first-person lines over the fight and
  > flies a **controls card** into the bottom-left cheatsheet. The pause cards, the tap-to-continue freeze,
  > the S3 trace fetch and the whole `LEVEL0_CUTSCENE` runtime are **deleted**; the generic `?record`/
  > `?playback` machinery stays (its `&cutscene` flag is now `&finish` — "press Finish and Return when the
  > sector clears"). The script is **descriptor data** (`intro.beats` + four timing numbers on `level-0`),
  > and the same numbers drive a new **`spawn.earliest`** floor in `sim-core` so the first pirate waits 3 s
  > for the opening line and the second waits for the controls card to fly away — one timeline, read by both
  > the words and the fight. The intro is now **session-recorded** like every other level (the funnel finally
  > sees the level new players drop off on), advances 0 → 1 through the **normal** win path, and is
  > **skippable from the Settings gear**. `#help` finally has a **touch variant** (`ui.help_touch`) instead
  > of showing keyboard bindings on phones; the kill log stands down for the intro (it shares the bottom band
  > with the director's line, and on a phone they overlapped outright); and the "FINAL STAGE" banner is
  > suppressed on the intro via a
  > descriptor flag. The canonical Level-0 trace was **re-recorded** for the new pacing; it is now purely a
  > determinism-guard fixture.
- **`docs/DECISIONS.md`** — one new entry at the next free number:
  > **The intro is played, not watched — and its script is level data, not UI state.** The cutscene bought a
  > guaranteed-good first 40 seconds at the price of a player who had not touched the controls when Level 1
  > started, plus a fragile machine (an S3 trace, a re-sim, a freeze, five taps) that a single gameplay
  > change could desync. Replacing it with a live fight costs the guarantee and buys a tutorial. Two things
  > made it safe. **One timeline:** the beat timings live on the level descriptor and the *simulation* reads
  > the derived floors (`spawn.earliest`) off the same object, so the DOM never tells the sim when to spawn
  > and a recorded intro session replays exactly. **One clock:** `world.combatElapsed`, already in the
  > digest, already reset by `reset()` — the director needed no new World state and re-arms on a restart for
  > free. Rejected: a DOM-driven director (a recorded session would not reproduce), and a `levelTime` field
  > of its own (a second clock to keep in step). The known cost is that changing Level-0's pacing invalidates
  > the canonical input trace that three determinism guards pin an outcome on; it was re-recorded, and that
  > is the standing price of touching the intro's fight (cross-ref §73). **Amends §64:** the cutscene overlay
  > was one of the three hosts of the EN/RU toggle, and it is gone — the surface is now the welcome screen
  > and the Settings modal, which is what covers the RU-browser player who lands straight in the intro,
  > since the gear is on screen and reachable throughout the fight. Also cross-ref §63 (the intro's
  > one-time-ness is still `current_progress` alone — a reset replays it — the cutscene it was written
  > about is simply no longer what gets replayed).
- **`docs/narrative/canon.md`** — the story-spine bullet for Level 0 (**lines 35–38**) still says "intro
  cutscene (`ui.cutscene.p0`–`p4`)". Update it: the intro is a **playable** ambush with five first-person
  lines (`ui.intro.l0`–`l4`); the beats are unchanged (ambushed on approach → rockets for the ones that
  follow → an enemy rocket can be dodged or shot down → survive and head for the station). No new character.

---

## Out of scope / non-goals (DECISIONS §30)

- **No** change to the four enemies, their ships, stats, spawn positions, or `enemyTotal`. No difficulty
  tuning of Level 0 beyond the two spawn floors.
- **No** invulnerability, no retry-count logic, no "you died in the tutorial" special case — death is death,
  Restart replays the level.
- **No** typewriter reveal, no voice-over, no camera moves, no letterboxing, no `body.cutscene`-style HUD
  hiding. The HUD is fully visible throughout: the intro is a level. The **one** exception is `#event-log`
  (4d), and it is scoped to `body.intro` — do not extend the idea to the radar, the bars or the counters,
  and do not "improve" it by repositioning `#event-log` globally (moving it up puts the kill log near the
  top of a landscape phone for the whole game, to fix 40 seconds of it).
- **No** change to the visual suite beyond what Step 10b lists: the one central boot gate in `run.mjs`, the
  new `42-playable-intro`, the rewritten `22`, and the named comment/URL edits. Do **not** rewrite scenarios
  the sweep marks safe, and do **not** make the suite dodge the spawn floors by giving the harness a
  different level-0 — the whole value of the suite is that it fights the level production ships.
- **No** generalisation of the director to other levels. It arms iff the served descriptor carries `intro`;
  do not add the field to another level in this change.
- **No** rework of the record/playback machinery beyond the rename + moving the auto-finish inside
  `stepReplayTick`. No new trace version, no format change.
- **No** headless "bot" trace generator. It was prototyped while planning and a naive
  turn-toward-nearest-and-fire policy cleared 0–1 of the 4 enemies in 90 s of sim across six seeds — it is a
  project of its own, not a step in this one. Step 9a's tick-shift plus a real `?record` fallback is the path.
- **No** rename of `introTrace`, and no move of the trace out of S3 into git.
- **No** change to the welcome screen, the Main Window, the briefing flow, or any level above 0.
