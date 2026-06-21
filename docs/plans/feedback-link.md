# Feedback / community link — implementation brief (Vega Sentinels)

> Self-contained handoff for the work session. Adds an in-game link to the Telegram community — the
> Phase-0 **feedback channel**. The URL is **locale-dependent** (separate EN / RU groups), so it reuses
> the existing i18n system. English-only docs. Planning-window note: no code written here.

## Goal
A visible in-game link that sends players to the Telegram group to leave feedback/ideas. Picks the
group by current language:
- **EN:** `https://t.me/+DZfK9rUqmVpkYTZi`
- **RU:** `https://t.me/+BwclWW983-U5NWRi`

## i18n model (the clean part)
Both the link **text** and the **URL** are locale values — add two keys to the catalog:

`client/locales/source.json` (EN = source):
```json
"ui.community.label": { "source": "💬 Feedback & community on Telegram", "context": "Link text to the game's Telegram community/feedback group. Shown on the welcome screen and the game-over/victory overlay." },
"ui.community.url":   { "source": "https://t.me/+DZfK9rUqmVpkYTZi", "context": "URL, not prose — do not translate the text. The 'en' value is the English Telegram group; the ru locale overrides it with the Russian group link." }
```
`client/locales/ru.json`:
```json
"ui.community.label": "💬 Отзывы и идеи — наш Telegram",
"ui.community.url": "https://t.me/+BwclWW983-U5NWRi"
```
Keys are abstract (`ui.community.*`); only values differ per locale. `t('ui.community.url')` returns the
right group for the active language; falls back to the EN link if a locale lacks it.

## Rendering — support a localized `href`
The existing `applyTranslations` walks `[data-i18n]` and sets `textContent`. Generalize it (small) to
also handle an **`data-i18n-href`** attribute → `el.setAttribute('href', t(key))`. Then the markup is:
```html
<a class="community-link" data-i18n="ui.community.label" data-i18n-href="ui.community.url"
   target="_blank" rel="noopener">💬 Feedback & community on Telegram</a>
```
On language switch, the existing re-render updates both text and href. (Alternative: set the href in JS
on language change — but `data-i18n-href` keeps it consistent with the rest of the i18n flow.)
- `target="_blank" rel="noopener"` — opens Telegram in a new tab without leaving the game.

## Placement (recommended)
- **Welcome / start screen** — visible to everyone, especially first-time players (primary spot).
- **Game-over / victory overlay** — natural moment to ask for feedback ("enjoyed it? tell us").
Reuse one styled `.community-link`. Keep it tasteful/small; don't cover gameplay. (A persistent HUD
corner link is optional — welcome + overlay is enough for launch.)

## Optional: measure engagement (ties into the new telemetry)
Fire a `community_click` event on click via the existing `track()` helper, and add `community_click` to
the `POST /api/events` allowlist. Lets you see how many players actually open the group. Low effort,
skip if you want the smallest change.

## Coordination
Touches `client/index.html`, `client/src/i18n.js` (the `data-i18n-href` generalization), and
`client/locales/{source,ru}.json` (+ the events allowlist in `server.js` if tracking). Git is currently
clean — low conflict risk.

## Acceptance criteria
- A visible link on the welcome screen (and game-over/victory overlay) opens the **EN** Telegram group
  when the language is English and the **RU** group when Russian, in a new tab.
- Switching language live updates both the link text and the target URL.
- (If tracking) `community_click` lands in the `events` table and is gameplay-safe (fire-and-forget).
