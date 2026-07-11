# Canon — world & story spine

Everything below is **established** by shipped text (`client/locales/source.json`) or a recorded
decision, unless it's under **Open threads**. Read `README.md` first for how to use this.

## Premise
The player's **home star system** is under sudden, widespread attack by **pirates**. The player is a
**Vega Sentinel** — the setting's defender corps and the game's namesake (*Vega Sentinels*) — newly
commissioned and flying to a first posting when the raids catch them. The campaign is the push to
drive the pirates back to their source and take it down.

## Setting
- **Vega / the home system.** A defended home system ("our home system"). Fixed installations that
  appear in missions: a **station** (the Level 1 setpiece the player defends), a **weapons factory**
  (Level 2), a **research station** and an **asteroid mining belt** (side missions), and a hidden
  **pirate base** (Levels 4–5 target).
- **The Sentinels.** The corps the player belongs to; "**Sentinel**" is the player's in-game title
  (used in nearly every briefing/victory line). A player picks a **callsign** right after clearing
  Level 1 (`ui.account.prompt_*`); they can stay a guest or make an account.

## Factions
- **Vega Sentinels** — the player's side; the defenders. (Ship tiers exist in-game; the advanced tier
  uses orange models — cosmetic, not yet a story faction.)
- **Pirates** — the antagonists; raiders hitting the home system. They have grunts, a rocket-armed
  variant ("rocket pirate"), mid-bosses, and a fortified base. Their *motive is not yet canon* (see
  Open threads).

## The protagonist
A **rookie Vega Sentinel** — fresh commission, first posting, ambushed on approach. Scared but
holding; learns the ropes in the intro fight. Full card: **`characters/player-sentinel.md`**.

## Story spine (as shipped)
This is the *narrative* order; the actual strings are the source of truth — cross-referenced by key,
not copied.
- **Level 0 — intro cutscene** (`ui.cutscene.p0`–`p4`). The rookie, en route to their first posting,
  is jumped by pirates on approach. Across the fight they learn the tools: dodge enemy fire → down a
  second pirate with the ship's **rockets** → an enemy rocketeer's missiles can be **outrun** and
  **shot down** with the cannon. Survives, reaches the station.
- **Level 1 — defend the station** (`level.1.briefing`, `level.1.victory`). A **station dispatcher**
  greets the just-arrived rookie ("you made it in just in time, and in a ship like that…") and asks
  them to clear the pirates off the station first, questions later. → After clearing, the player is
  asked to name themselves.
- **Level 2 — reach the weapons factory** (`level.2.briefing`, `level.2.victory`). The player now
  carries the **Machine Gun** salvaged from Level 1 (primary — lighter trigger, good vs rockets).
  Contact with the factory (two sectors out) is lost and the lanes to it are held by pirates; **fight
  through and reach it**. Ends with a heavier escort (the medium **mini-boss** — first tougher enemy).
  Victory: the lane's open and the factory's in range, but it's dug in hard — the assault is next.
- **Level 3 — take the factory** (`level.3.briefing`, `level.3.victory`). The player has the **repair
  drone** salvaged in Level 2 (fitted; slow mid-combat hull heal; retreat to let it work). Mission:
  **assault the factory itself**, guarded by the **first genuinely big enemy warship** (the Sector boss).
  Victory: the warship is scrap and the factory is taken; a few pirates flee — setting up the hunt.
- **Level 4 — find the pirate base** (`level.4.briefing`, `level.4.victory`). Follows the fleeing ships
  from the factory; track them, gear up (heavy enemies ahead), find where they're hiding. Victory: the
  base is located.
- **Level 5 — storm the pirate base** (target set up by L4 victory).
- **Side missions** (`mission.*.desc`) — self-contained defend/clear jobs: **mining** belt gone
  quiet, **research** station threatened, **freighter** distress call.
- **Recurring device:** each campaign gear unlock (MG, repair drone) is framed as **battlefield
  salvage** from the previous fight — earned, not issued. Keep this framing; don't hand the player
  gear the story says they haven't recovered yet (e.g. no Machine Gun in the intro).

## Tone & register (DECISIONS §65)
- **The pilot's voice:** grounded rookie — scared but holding, no hero quips, no exclamation-mark
  bravado. Mechanics are taught **through the action**, not narrated as tutorial text.
- **Mission-control voice:** the station dispatcher is relieved, a little wry, practical (matches the
  already-mature Level 4 briefing register). Second-person, addresses "Sentinel."
- **Avoid:** chirpy tutorial tone ("Good news: you've got a fast ship"), lines that exist only to
  explain a mechanic, and the rookie-savant cliché.

## Open threads (NOT yet canon — author before relying on them)
- **Why the pirates are raiding**, who leads them, whether there's a force behind them.
- **Named characters:** the station dispatcher (currently an unnamed voice — a candidate for the next
  character card), any recurring ally or pirate antagonist.
- **Place/proper names:** the station, the system, the pirate base — all currently generic.
- **The protagonist's backstory** beyond "rookie, fresh commission" — deliberately thin so the
  player projects onto their callsign.
- **The campaign's end state (Level 5).** No shipped `level.5.briefing`/`victory` yet — the finale
  ("storm the pirate base") is set up by `level.4.victory` but not written. This is where the
  ending's tone/beats get authored.
