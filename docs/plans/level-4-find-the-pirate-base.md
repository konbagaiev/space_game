# Level 4 — "Find the pirate base" — brief (Vega Sentinels)

> **Implemented 2026-06-23.** `level-4` seeded in `catalog_seed.js` (briefing text + new `unlockShop`
> action; waves of pirate gunners + heavies → upgraded boss → victory that sets up L5). Clearing L3 now
> advances into L4 (fixes the lingering-L3-text symptom) and the `unlockShop` action opens the shop + side
> missions at that point. EN+RU `level.4.briefing`/`level.4.victory`; server tests updated. The skeleton
> wave numbers / one-boss finale are a first pass — tune freely. **Next:** L5 "Storm the pirate base".

> The next **story** (campaign) level after L3. Authored `LEVELS` entry (not generated). Implementing it
> fixes the "L3 victory text lingers" symptom — once L4 exists, the standard *briefing-on-advance* shows
> L4's briefing after clearing L3. English-only. Planning window — no code here.
> Related: `mission-generator.md` (Post-L3 hub flow), `mission-enemies-difficulty.md` (pirate gunner),
> `mission-maps.md` (setting). L5 ("Storm the pirate base") is the sequel (ROADMAP Phase 3).

## Placement & flow
- L4 is the campaign level **after L3** (`current_progress`). Clearing L3 advances into L4 → its
  **briefing shows automatically** (like L2's briefing after L1).
- After L3 the player is in the **hangar hub** (see `mission-generator.md`): the L4 briefing is shown,
  side missions + shop are available to gear up, and the player **launches L4 when ready** (not forced).
- Shop is already unlocked on the L3 clear (`shop_unlocked`), so the **L4 briefing needs no server
  action** — it's text-only (unlike L2's `replaceWeapon`).

## Briefing (shown after L3 — the lead-in)
Already drafted; it directs the player to **gear up first** (heavy ships ahead) and introduces the shop:
- **EN** (`level.4.briefing`): *"Several ships bolted from the factory just before we arrived — we
  tracked their heading, and your job is to find where they're hiding. While you're docked, look over
  the upgrade gear the factory has on hand: we counted a lot of heavy ships among the ones that fled, so
  kit out accordingly. Good hunting, Sentinel."*
- **RU**: *"Несколько кораблей спешно снялись с фабрики перед самым нашим прибытием — мы отследили их
  курс, и твоя задача выяснить, где они засели. Пока стоишь в доке, присмотрись к оборудованию для
  апгрейда на фабрике: среди удиравших мы насчитали много тяжёлых кораблей, так что снаряжайся
  соответственно. Удачной охоты, Страж."*

## Mission content (combat level themed as the search)
Mechanically a wave level (same engine); narratively "track the fugitives → find the base." **Clearly
harder than L3.** **Real balance (new Advanced medium pirate enemy + Advanced pirate cannon + the Second
Boss + the 40/40/20 → 35/35/30 → boss waves) → `docs/plans/level-4-difficulty.md`** — that supersedes
the skeleton below:
- **wave-1:** pirate gunner + rocketeer + a couple of heavies → ~12 kills.
- **wave-2:** more heavies in the mix → ~24 cumulative.
- **clear-out** → then a **boss** (or two — TBD) using the upgraded boss (2× pirate MG).
- **victory** → sets up L5.

## Victory text (sets up L5 "Storm the pirate base")
- **EN** (`level.4.victory`): *"Tracked. The pirate base just lit up our long-range scan — they're dug
  in deep. Rearm and regroup, Sentinel; next, we take it down."*
- **RU**: *"Засекли. Пиратская база только что вспыхнула на дальнем сканере — окопались всерьёз.
  Перевооружайся и приходи в себя, Страж; дальше — берём её штурмом."*
- After L4 victory the player is back in the hub (gear up) before L5.

## Setting / map
Per `mission-maps.md`: a point in the one big map or a far "new sector" anchor — **TBD**. Can reuse
`home-system` for a first pass; a dedicated set-piece (en-route / approach to the base) is polish.

## Data & i18n
- New `LEVELS` entry **`level-4`** in `catalog_seed.js` (descriptor: title, map, `briefing`, `phases`).
  Re-seed is idempotent. No migration (the `levels` table exists).
- i18n keys: **`level.4.briefing`**, **`level.4.victory`** (+ any new wave/title strings) in
  `source.json` + `ru.json`.
- Enemies: the **pirate gunner** + heavies (+ upgraded boss) already exist per
  `mission-enemies-difficulty.md`.

## Open (Kostya)
- **L4 difficulty / wave numbers** + **one boss or two** at the finale.
- **Map/setting** for L4 (reuse home-system vs a new-sector set-piece).
- Whether L4 ends by "locating" the base (victory text above) → straight into L5, or there's an
  intermediate beat.

## Acceptance criteria
- Clearing L3 advances into L4 and shows the **L4 briefing** (gear-up + find-the-base) — **no more
  lingering L3 victory text**.
- L4 is launchable from the hangar hub when the player chooses; side missions + shop usable first.
- L4 is clearly harder than L3 (pirate gunners + heavies + upgraded boss); its victory sets up L5.
- EN + RU for `level.4.briefing` / `level.4.victory`.
