# Netsim reconnect: a room survives a dropped link for 15 s

> **Status: BRIEF, not started (2026-10-06).** Split out of the server-brawl run
> (`2026-10-06-1530-server-brawl`) by the maintainer. Run it through `/feature-pipeline` as its own
> feature. Everything needed is in this file plus the documents it names.

## Goal

Today a dropped socket ends its room (`server/src/netsim/socket.js` header: "ONE player per room, no
reconnect"), and the client hands the fight to its local sim (`client/src/main.js goLocal`, wired as
`onClose` at `:1054`). Make **reconnect the default behaviour of every server-run room** (`?netsim=1` levels
and `?netbrawl`):

- When the link drops, the room **keeps simulating** for a **15 s grace window**. The player's ship gets
  neutral input (all zeros) for that time.
- If the client comes back within 15 s, it re-attaches to the **same** room and the picture is **rebuilt
  from the server's state**: the ghost world is resynced from a full snapshot. There is no local-sim
  fallback in the meantime.
- If the player **dies during the grace window**, the death is recorded through the normal economy path,
  exactly as if they had been connected.
- If the player does not come back within 15 s and is still alive, the room closes and the run counts as an
  **exit without reward**: no `cleared`, no `death`, nothing banked. This is what closing the tab does today.

## Decisions (settled by the maintainer, 2026-10-06 — do not re-ask)

1. Grace window: **15 s**, one constant in `socket.js`.
2. The room keeps stepping during grace. It does not pause.
3. A death during grace is recorded through the ordinary death/economy path.
4. A timeout while alive means an abandoned run with no reward.
5. On reconnect, the client resyncs from the server. It does not keep or merge its own view.
6. This becomes the default for all netsim rooms, not a brawl-only feature.

## Read first

- `docs/SUMMARY.md` "Playing in a server-run room (`?netsim=1`)". Pay particular attention to: tickets,
  `IDLE_TIMEOUT_MS`/ping liveness, how a run banks today (`socket.js` economy sink near `:33-58` vs the
  client's own `POST /api/games`), and the handshake rule.
- `docs/plans/server-authoritative-sim.md` (§5 tickets, §6 scope; Slice E mentions reconnect/prediction).
- `docs/plans/2026-10-06-1530-server-brawl.md` (the server brawl). Its link-loss path (`endedBy:
  'link-lost'`, no local fallback) is the thing this brief replaces for `?netbrawl`.
- `server/src/netsim/socket.js`, `room.js`, `driver.js`; `client/src/netsim.js`, `netsim-world.js`,
  `client/src/main.js` (`goLocal`, `:992-1056`).

## Open questions for the planner (verify in code; ask the maintainer only if the code can't answer)

- **Resume identity.** Tickets are single-use. Pick between a resume token issued in the server's `hello`
  and a fresh ticket bound to the same room. Either way it must be bound to the authenticated account, so
  that someone else cannot take over the room.
- **Liveness vs grace.** The idle timeout is 30 s (two missed pings). A clean close starts grace at once. A
  silent half-open socket only starts it when the ping fails. Define when grace starts in both cases.
- **The client side during the gap.** What does the screen show: freeze plus a "reconnecting…" overlay? How
  often does the client retry, and how does it give up at 15 s? `goLocal` must stop being the response to a
  drop. Decide what is left of it, if anything: perhaps a refusal at connect time.
- **Hidden tab.** A backgrounded phone tab can lose its socket. Coming back within 15 s should resume.
  Coming back later should show "run ended".
- **Economy.** Find where `death` is banked today for a netsim run, server sink or client POST. Make sure a
  death that happens while the client is away is still banked, exactly once.

## Tests

Room/socket tests with injected clocks. The grace expiry closes the room with no economy call. A resume
within grace re-attaches to the same room and sends a full snapshot. A death during grace fires the death
economy exactly once. A resume attempt by another account is refused. Add one visual scenario that drops the
socket mid-fight and checks that the picture resyncs.
