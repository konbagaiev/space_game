# Character progression — experience, levels & skills

**Status:** shipped 2026-08-09 (direct edit, not the pipeline). This file is the reference spec the code
comments and SUMMARY/DECISIONS point at. See DECISIONS §93.

## Goal

Make the base-menu **Character** section real: a pilot **level** earned from **experience (XP)**, with
**skill points** spent across five skills whose gameplay effects are live.

## XP economy

- **Per kill:** each enemy grants `xp` = its credit `reward` (25/50/75/125/200/250/500). Data lives in
  `server/src/catalog_seed.js` (`stats.xp`, `stats.dodge`), surfaced onto the enemy entity in
  `client/src/ship-build.js` (`spawnEnemyShip`), summed into `G.earnedXp` in `sim.js` on each kill and
  shown in the kill log (`ui.log.killed`, now `+{amount} · +{xp} XP`).
- **Per mission (one-shot, on victory):** `descriptor.xpReward` — Level 1 **500** · Level 2 **500** ·
  Level 3 **700** · Level 4 **1500** · side missions **1000** (Level 0 intro = 0). Campaign values live on
  the level descriptors in `catalog_seed.js`; side-mission value in `server/src/missions.js` (`MISSION_XP`,
  also exposed as `estXp` for the mission card). Added to `G.earnedXp` in `levelRunner.win()`. Per-kill XP is
  **not** doubled on victory (only credits are).
- **Banking:** `bankRun()` (`net.js`) POSTs `xp` alongside `credits` to `/api/games`; the server banks
  `players.experience += xp` and returns `{ experience, level, leveledUp, xpEarned }`.

## Level curve (`server/src/progression.js`)

Arithmetic ramp: cost to reach level *n* from *n−1* = `XP_BASE + XP_STEP·(n−1)` = `1000 + 500·(n−1)`.
Cumulative: 1000 / 2500 / 4500 / 7000 / 10000 / … New player = **level 0, 0 XP**. One skill point per level.

**Level and unspent points are DERIVED from `experience`, never stored** — the only persisted truth is
`experience` + the five `skill_*` allocation columns. `levelFromXp(xp) → {level, into, span}`;
`unspentSkillPoints(xp, allocated) = level − allocated`. Total points are naturally capped at `level`.

## Skills (5) and effects (per invested point)

Rates + resolution are pure in `client/src/components.js` (`SKILL_RATES`, `skillEffects()`), baked into the
player at `buildPlayer` (`ship-build.js`). Effects apply **only to the real active ship** — previews and
`?playback`/intro overrides pass no skills (deterministic replays; recording reproduces its exact ship).

| Skill | Effect / point | How |
|---|---|---|
| **Kinetic** | +5% kinetic (non-rocket) damage, +0.5° aim-assist cone (additive) | scale cloned weapon `power` + `aimAssistDeg` |
| **Rocket** | +5% rocket damage, +5% rocket speed | scale cloned rocket `power`/`launchSpeed` + player rocket accel in `fireMount` |
| **Shields** | +5% shield capacity | scale `shield.capacity` |
| **Maneuverability** | +5% dodge chance | `p.dodge = 5·pts` |
| **Mobility** | +5% engine & thruster power, +5% max speed | scale `engine.power`/`thruster.power`; `p.maxSpeedMul` at the velocity clamp |
| *(Accuracy)* | future skill | `accuracy = 0` in the dodge formula for now |

Weapons come from the shared catalog — the build **clones** each mount's weapon before scaling so the catalog
is never mutated.

## Dodge (determinism-safe)

Hit chance on a hostile **bullet** connect = `100 / (100 + dodge − accuracy)` (accuracy 0 for now). The roll
is drawn from the **seeded sim RNG** (`sim-random.js`) **only when `dodge > 0`**, so a no-skill run — and every
pre-existing recording — consumes zero extra draws and replays bit-identically (DECISIONS §73). To keep
`collision.js` pure/RNG-free, `resolveHostileBulletHit(player, p0, p1, damage, dodgeRoll)` takes an **injected**
predicate (null when the target can't dodge). A dodge pops an **"EVADE"** popup (reuses the credit-popup pool
via a `text` field) and deals no damage. Dodge is a general ship stat — enemies carry it too (all current
enemies = 0; `catalog_seed.js`). Rocket blasts are **not** dodged this iteration.

## Data model + API

- `players` columns (all `INTEGER DEFAULT 0`, additive `ALTER … IF NOT EXISTS` in `db.js migrate()`):
  `experience`, `skill_kinetic`, `skill_rocket`, `skill_shields`, `skill_maneuver`, `skill_mobility`.
- `getActivePlayerShip` returns `progression = { experience, level, xpIntoLevel, xpForNextLevel, skillPoints,
  skills{…} }` (via `getProgression`).
- `POST /api/players/:id/skills/spend { skill }` → `spendSkillPoint` (row-locked, whitelisted skill,
  unspent>0), returns fresh `{ progression }`. 400 unknown skill, 409 no points. Not shop-gated.
- `resetPlayer` zeroes `experience` + all `skill_*`.

## UI

`renderCharacter()` (`mainwindow.js` → `#mw-view-character`, styles in `styles.css`): level header, XP bar,
unspent-points badge (gold when > 0), five cards (name + effect text from `SKILL_RATES` + point count + a
`+` that POSTs `/skills/spend`). Mission cards/detail show `XP ≈ {xp}` beside the credit reward.

**Always-on progression HUD** (`hud.js updateProgressionHud`, called every frame from the render loop):
- **Free-skill-points badge** on the Character left-menu item (`#mw-char-badge`) — gold count, shown only
  when unspent points > 0 (the label sits in a child `<span>` so i18n's textContent write doesn't wipe it).
- **Bottom XP bar** (`#xp-bar`, yellow, 80% wide, bottom-center, `z-index 13` so it clears `#mainwin`) —
  shown on the base **and** in battle; fill = `(xpIntoLevel + G.earnedXp) / xpForNextLevel` clamped, so it
  previews the current run's unbanked XP live. Hidden with no progression or during a cutscene/replay.
- **"Level up" toast** (`#levelup-toast`, `showLevelUp()`) — centered white text, CSS `levelup-fade` 2s
  ease-out; fired from `bankRun` when a run's banked XP crosses a level (i18n `ui.levelup`).

## Tests / guards

`progression.test.js` (curve/derived math), `components.test.js` (`skillEffects`), `collision.test.js` (dodge
gating), `server.test.js` (XP banking, skill spend guards, reset baseline), visual scenario
`11-character-progression`, and the `22-intro-replay` determinism guard (still green — no extra RNG draws).

## Follow-ups (not in this iteration)

- Accuracy skill (the reserved term in the dodge formula).
- Dodge for rocket blasts; enemies with non-zero dodge.
- Level-up banner/feedback on the victory overlay; per-skill soft caps if balance needs them.
