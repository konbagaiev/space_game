# Narrative canon

The home for **story canon, characters, and tone** — the reference future text content
(briefings, cutscene lines, mission flavor, dialogue) is generated *from*, so the writing stays
consistent as the game grows.

## What this is / isn't
- **This is reference, not shipped text.** The actual player-facing strings live in
  `client/locales/source.json` (English, source of truth) + `client/locales/<lang>.json`
  (translations). These docs describe the *world and voice behind* those strings — do **not**
  duplicate the strings here; point at them.
- **English only, like every other doc** (see `CLAUDE.md`). Player localizations are a separate
  layer keyed off the English originals; canon is authored in English.
- **Keep it to what's established.** Record canon that is *already fixed* by shipped text or a
  recorded decision. Mark anything speculative under "Open threads" — don't quietly invent lore that
  the game hasn't committed to. (DECISIONS §30: don't over-build; this is a seed, not a bible.)

## Structure
- **`canon.md`** — the world: premise, setting, factions, the story spine (level by level), and the
  tone/register. The single doc to read first.
- **`characters/`** — one file per character (a "character card"): role, what's established, voice,
  and what's still open. Today: `player-sentinel.md` (the protagonist). Add cards here as named
  characters get authored (e.g. the station dispatcher, a pirate leader).

## How to use it for content
When writing or generating new player-facing text: read `canon.md` (world + tone) and the relevant
character card, write the English string into `client/locales/source.json` with a translator
`context` note, add the `<lang>.json` translations, then — if it establishes something new about the
world or a character — fold that fact back into these docs so the canon stays current.

## Status
Seed stage (2026-07-11). Deliberately minimal. The far-reaching pieces — a full setting bible, named
supporting cast, faction histories — are **not needed yet** and are intentionally deferred; this
folder exists so the canon that *does* exist (chiefly: the hero is a rookie Vega Sentinel) is captured
and reusable.
