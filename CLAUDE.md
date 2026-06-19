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

## Project layout
- `client/` — Three.js game (frontend), single `index.html`.
- `server/` — backend (player accounts, multiplayer) — planned.
- `docs/` — `SUMMARY.md` (current state), `CHANGELOG.md` (change log), `DECISIONS.md` (rationale).

## Docs workflow
On each change, update `docs/SUMMARY.md` (current state) and append to `docs/CHANGELOG.md`.
Commit only when the user asks.
