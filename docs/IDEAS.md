# Ideas — the parking lot

> A loose, low-pressure dump for *where the game could go*. Anything goes here: half-formed thoughts,
> "what if", directions we might never take. **No commitment implied.** When an idea earns a real
> decision it graduates to `ROADMAP.md` (scope/order), a `docs/plans/*.md` brief (how to build it), or
> `DECISIONS.md` (why). Until then it just lives here so it isn't lost.
>
> **This does not replace `ROADMAP.md`.** ROADMAP is the *committed* plan — what we've decided to build
> next and in what order. IDEAS is the funnel *into* it: nothing here is planned until it's deliberately
> moved to ROADMAP.
>
> English only (project rule). Newest ideas on top within each section is fine, but order doesn't matter
> much here — this is a notebook, not a spec.

## How to use this file
- Drop an idea under the axis it touches (or **Loose ideas** if it fits nowhere).
- One bullet = one idea. Add a date `(YYYY-MM-DD)` if you want to track when it came up.
- Mark a verdict inline when you have one: `→ pursuing`, `→ parked`, `→ rejected (reason)`,
  `→ graduated to ROADMAP/plans`.
- Don't delete rejected ideas — strike the reason so we don't relitigate. The "why not" is worth keeping.

---

## The big directional question: what *kind* of game is this?
We don't have to pick yet. Capturing the axes so each idea can say where it pulls us.

### Axis 1 — game mode / who you play against
- **Story PvE grind (current).** Single-player campaign: generated missions + story beats + bosses,
  ~50-sortie arc. This is the live build and the current north star.
- **Co-op PvE.** 2–4 players fly the same missions together. Shared loot? Scaled difficulty? Could reuse
  the whole mission/enemy system; the hard part is netcode + server authority.
- **PvP.** Player-vs-player duels or small-team arena. Different balance discipline entirely (symmetric
  fairness vs. power fantasy). Highest infra + anti-cheat cost.
- *(Open: these aren't exclusive — a PvE campaign with optional co-op and a separate PvP arena is a
  classic combo, but it's 3x the surface area.)*

### Axis 2 — pace / feel
- **Arcade & twitchy** — fast, forgiving, dodge-and-shoot, short sorties. (Closest to current feel.)
- **Deliberate & tactical** — slower, positioning matters, manage heat/energy/ammo, fewer enemies but
  each one a threat.
- **Sim-leaning** — Newtonian-ish flight, real momentum, systems to manage. High skill ceiling, smaller
  audience, big control-scheme cost (esp. on mobile/touch).

### Axis 3 — session shape
- **Bite-size sorties** (current) — 2–5 min missions, hangar between. Great for mobile.
- **Long expeditions** — multi-stage runs you can't pause-and-leave, roguelike-ish stakes.
- **Persistent world** — EVE-style, you exist in a shared galaxy; logging off has consequences.

---

## Combat & ship mechanics
- **Wave-clear booster pickup.** After each wave, drop a booster at the spot where the wave's last ship
  went down. Flying through it grants a short-lived bonus — e.g. hull repair, a temporary shield, or a
  weapon buff. Maybe randomized type, or telegraphed by color. → arcade branch only (fits the
  fast/forgiving feel; would feel out of place in a deliberate/sim direction). (2026-06-30)

## Progression, economy & meta
- *(empty)*

## Story & world
- *(empty)*

## Multiplayer (if/when)
- Co-op: shared mission instance, host-authoritative vs. dedicated server — decide before any netcode.
- PvP: ranked arena vs. casual lobbies; matchmaking by ship power or by skill?
- *(empty for more)*

## Tone, art & audio
- *(empty)*

## Monetization / live-ops (far future)
- *(empty)*

## Loose ideas (uncategorized)
- *(empty)*
