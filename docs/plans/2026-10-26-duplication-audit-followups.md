# Duplication audit — follow-ups (2026-10-26)

**Date:** 2026-10-26. Findings surfaced while closing the
[2026-10-20 duplication audit](2026-10-20-duplication-audit.md) (close-out plan
[`2026-10-24-duplication-audit-closeout.md`](2026-10-24-duplication-audit-closeout.md)); **not part of it**.
Each row is a candidate for its own change.

| Id | Finding | Status | Found by | Size |
|---|---|---|---|---|
| F1 | A briefing `installComponent` destroys the part it replaces | open | Phase 3 ([plan](2026-10-26-1616-reward-and-mission-anchors.md)) | S |

## F1. A briefing `installComponent` destroys the part it replaces

**Code.** `server/src/db.js:720-729` `installActiveShipComponent` sets `components[slot] = componentId` and
writes the loadout back — the part that was in the slot is not deposited anywhere. Compare
`replaceActiveShipWeapon` (`db.js:698-710`), which stashes the weapon it removes (`depositStash`). Called from
`applyBriefingActions` (`db.js:732-738`) for the Level 3 briefing (`catalog_seed.js:862`,
`installComponent repair 12`).

**Repro.** A player clears Level 1 (the shop opens on the Level 2 briefing), buys and equips Repair drone II
(id 19, 1800 cr) or Nanobot repair (id 20) before clearing Level 2, then clears Level 2 → the Level 3 briefing
sets `components.repair = 12`; drone 19/20 is in neither the loadout nor the stash. Reproducible directly in a
server test: give a fresh player `components.repair = 19`, run the Level 3 briefing, assert the stash holds 19.

**Suggested fix (not decided).** Deposit the replaced component like the weapon path does (only when the slot
held a different part). **Status:** open.
