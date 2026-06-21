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
