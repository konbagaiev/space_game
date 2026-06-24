# Project rules

## Language: English only

ALL text in this project must be in English. No exceptions.

This applies to:
- **In-game text / UI labels** (HUD, buttons, help, overlays, any on-screen strings).
- **Documentation** — every `.md` file (`README.md`, `docs/*`, this file).
- **Code comments** and identifiers in `client/` and `server/`.
- **Commit messages** and changelog entries.

When adding or changing anything, write it in English. If you encounter
non-English text, translate it to English as part of your change.

**Localization exception (planned, see DECISIONS §10):** English is the *source of truth* — all
code, identifiers, string keys, docs, commits, and the **default/base UI text** stay English. Player
localizations (e.g. Russian) are a separate layer keyed off the English originals; they don't relax
this rule for anything we author or version.

## Project layout
- `client/` — Three.js game (frontend), single `index.html`.
- `server/` — backend (player accounts, multiplayer) — planned.
- `docs/` — `ROADMAP.md` (end-to-end scope & phases), `SUMMARY.md` (current state), `CHANGELOG.md`
  (change log), `DECISIONS.md` (rationale), `plans/*.md` (per-feature build briefs).

## Assets & credits (ALWAYS ask about credits on model changes)

Third-party assets (3D models, sounds) are tracked in **`client/assets/CREDITS.md`** with source +
license. **Whenever you add, replace, or remove a ship/3D model** (e.g. point a ship at a new `.glb`,
swap a model, or drop one that's no longer used), **STOP and ask the maintainer whether `CREDITS.md`
should change** before finishing — don't decide silently. Adding a model from a new source → add its
row; removing the last use of an asset → offer to drop its (now-stale) row; a CC-BY asset's attribution
**must** stay while it's in use. The same applies to sounds. Run the model asset pipeline via the
`assets:*` scripts (see `docs/plans/ship-model-pipeline.md`).

## Locate code via SUMMARY first (before grepping/Explore)

Before searching the codebase or fanning out an Explore/grep for *where a feature lives*, **read
`docs/SUMMARY.md` first** — it is the map. It describes every system as it is now and points at the
exact files (e.g. repair drone → `catalog_seed.js` component id 12 + `repairTick` in
`client/src/components.js`; player data reset → `server/src/reset.js`). Most "where is X?" questions
are answered there in one read. Only fall back to broad code search when SUMMARY (and the relevant
`docs/plans/*.md` brief) doesn't pin it down — and when it doesn't, that's a SUMMARY gap to fix as
part of your change. Skip this only for a one-off lookup where you already know the file/symbol.

## When asked to plan, write the plan to `docs/plans/`

When the user asks you to **plan** a feature/change (rather than implement it), write the plan to a
**`docs/plans/<kebab-case-name>.md`** file — don't leave it only in the chat. The user feeds these
files to another terminal/agent, so each plan must be **self-contained and executable without this
conversation's context**:
- State the goal, then the concrete steps with **exact file paths and line/anchor references**
  (e.g. `client/index.html:2076`), code snippets where helpful, and the affected docs to update.
- Note open questions / decisions and their chosen answers inline, so the executing agent doesn't
  re-ask.
- Match the existing briefs in `docs/plans/` for tone and depth (e.g. `repair-drone.md`,
  `mission-generator.md`).

Planning-only means **write the plan file, change nothing else** (no code edits) unless the user says
to implement.

## Docs workflow

Three docs, three different jobs. On **every** change, update the docs as part of the
change (not as an afterthought). Commit only when the user asks.

### What each file is for / where to look
- **`docs/SUMMARY.md` — current state ("how it works now").** A living snapshot, no history.
  Read it first to understand the system without reading the code. If a fact changes, you
  *edit it in place* (overwrite the old wording) — never append. It must always describe the
  code as it is right now: controls, mechanics, balance numbers, data model, API surface,
  build/run/deploy, tests. If you reverted something, remove it from SUMMARY.
- **`docs/CHANGELOG.md` — history ("what changed and when").** Append-only, newest on top,
  grouped under a `## YYYY-MM-DD` date heading. Read it to learn *why the code got to its
  current state* and the order things happened. Never edit or delete past entries.
- **`docs/DECISIONS.md` — rationale ("why we chose X over Y").** Read it before reopening a
  settled trade-off. Add a numbered entry when a choice has non-obvious reasoning or
  alternatives worth recording.

### How to fill them on a change
1. **CHANGELOG:** add a bullet under today's date (create the date heading if missing).
   Lead with a bold summary phrase, then what changed and the user-visible effect. Include
   *infrastructure/ops/CI/deploy* changes too — these are the ones that get forgotten.
2. **SUMMARY:** edit the affected section(s) to match the new reality. Keep gameplay numbers
   and the data/API model accurate; this is the file a parallel worker trusts. Bump the
   `**Updated:**` date.
3. **DECISIONS:** add an entry only if the change involved a real trade-off.

### Self-check before finishing (catches the common gap)
Run `git log --oneline` for your changes and confirm every commit/feature has a matching
CHANGELOG bullet, and that SUMMARY reflects the end state. Infra and server-side work
historically slipped past the docs — verify those explicitly.
