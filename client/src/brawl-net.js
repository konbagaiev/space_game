// `?netbrawl` — the TAB's side of a server-run bot brawl (docs/plans/2026-10-06-1530-server-brawl.md).
//
// Under `?netbrawl` the fight is simulated by a server room and this tab only renders it. The browser half
// (`brawl-host.js`) still needs a `world.brawl` to read — the ticks, the kills, the fingerprint, who is alive —
// so it keeps a MIRROR, filled from each snapshot's `brawl` block and NEVER stepped: it carries
// `server: true`, and `sim-core/brawl.js brawlTick` returns early on it.
//
// The mirror's own `armed` / `ended` are the TAB's (its wall clock started, its card is up). What the room
// said goes in `serverArmed` / `serverEnded`; the two are never mixed.
//
// Pure, no THREE, no DOM: unit-tested by `brawl-net.test.js`.

// How many per-second `srv` samples a run keeps (a 300 s run plus slack).
export const SRV_SAMPLES_MAX = 400;

export function makeBrawlMirror(n) {
  return {
    n, server: true, armed: false, ended: false, ticks: 0, killsByBlue: 0, killsByRed: 0, fingerprint: [],
    alive: [n, n], ghostsSeen: false, serverArmed: false, serverEnded: false, srv: [],
  };
}

// Copy a snapshot's `brawl` block (`sim-core/brawl.js brawlBlock`) into the mirror. The server's `ticks` is the
// one source of truth for sim seconds; `fp` arrives whole.
export function applyBrawlBlock(mirror, block) {
  if (!mirror || !block) return mirror;
  if (Number.isFinite(block.ticks)) mirror.ticks = block.ticks;
  if (Number.isFinite(block.killsByBlue)) mirror.killsByBlue = block.killsByBlue;
  if (Number.isFinite(block.killsByRed)) mirror.killsByRed = block.killsByRed;
  if (Array.isArray(block.alive)) mirror.alive = [block.alive[0], block.alive[1]];
  if (Array.isArray(block.fp)) mirror.fingerprint = block.fp.map((r) => r.slice());
  mirror.serverEnded = !!block.ended;
  mirror.serverArmed = !!block.armed;
  return mirror;
}

// Keep one per-second `srv` sample, stamped with the brawl tick it arrived at. Samples from before the ROOM
// armed (spawn, warm, the veil) are dropped: they would dilute every average on the card.
export function pushSrv(mirror, srv) {
  if (!mirror || !srv || !mirror.serverArmed) return false;
  mirror.srv.push({ tick: mirror.ticks, ...srv });
  if (mirror.srv.length > SRV_SAMPLES_MAX) mirror.srv.splice(0, mirror.srv.length - SRV_SAMPLES_MAX);
  return true;
}

// The setup panel's text for a join that failed before the run was armed.
export function brawlNetErrorText(code, max = 2) {
  if (code === 'brawl-busy') return `The server is already running ${max} bot brawls — try again in a minute.`;
  return `Could not reach the server room (${code || 'unknown'}).`;
}
