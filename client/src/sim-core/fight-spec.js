// THE FIGHT SPEC: which dev flags change this fight, applied in ONE order by every host.
//
// Five dev flags change the fight — `?ally`, `?lancer`, `?beam`, `?duel`, `?brawl` — and they used to be
// applied in five places (the tab's boot, the login reload, the level advance, the netsim room and the
// headless referee), each with its own subset and its own order. So `?lancer` was lost after a level advance,
// `?duel&netsim=1` ran one fight in the tab and a different one in the room, and an `?ally`/`?lancer`/`?beam`
// session recorded as a plain campaign level whose replay diverged (duplication audit §B4/§B5).
//
// Now there is one value, the SPEC, and two pure functions over it:
//   • `applyFightSpec(descriptor, spec)` — the LEVEL half (the phase script);
//   • `resolvePlayerBuild(build, spec)` — the SHIP half (the effective player build).
// The browser parses its spec from the URL once (`client/src/fight-spec-dev.js`), or reads it from the trace
// under `?playback`; a room gets it from the handshake (`server/src/sim-host.js createSimWorld`); the referee
// gets it from the trace (`fightSpecFromTrace`). Every one of them calls these two functions.
//
// Shape: `{ ally: phaseName|null, lancer: phaseName|null, beam: boolean, duel: {aces:N}|null, brawl: truthy|null }`.
//
// IDENTITY WHEN NOTHING IS SET, AND THAT IS LOAD-BEARING. `applyFightSpec(d, NO_FIGHT_SPEC)` returns `d`
// itself and `resolvePlayerBuild(b, NO_FIGHT_SPEC)` returns `b` itself — not copies. Every campaign run, the
// Level-0 intro and its determinism fixture therefore build exactly the objects they built before this
// module existed.
//
// NON-MUTATING, ALSO LOAD-BEARING. A server's `buildCatalog` shallow-copies a level, so `descriptor.phases` is
// the module-level seed array shared by every room in the process, and a fallback loadout's `mounts` is the
// seed ship's own array. Every transform below COPIES; mutating in place would hand every later room an ally,
// a wave of lancers or a beam-armed player.
//
// Pure and host-neutral (DECISIONS §136): sibling imports only — `boundary.test.js` enforces it.
import { withAllyAt } from './ally-config.js';
import { withLancersAt } from './lancer-config.js';
import { withDuelRoom, withDuelKit } from './duel-config.js';
import { withBrawlRoom } from './brawl.js';
import { withBeamGun } from './beam-config.js';

// The all-off spec. Frozen, and returned AS ITSELF wherever "no dev fight" is the answer, so the identity
// fast-paths above hold.
export const NO_FIGHT_SPEC = Object.freeze({ ally: null, lancer: null, beam: false, duel: null, brawl: null });

// The LEVEL half, in the ONE order:
//   • `brawl` replaces everything — with it set, the others are ignored;
//   • otherwise `ally`, then `lancer`, then `duel` LAST. The duel discards the phase script the other two
//     edit, so ally/lancer are no-ops under a duel (they are still RECORDED, see `roomFromFightSpec`).
// `beam` has no level half.
export function applyFightSpec(descriptor, spec = NO_FIGHT_SPEC) {
  if (!spec || !descriptor) return descriptor;
  if (spec.brawl) return withBrawlRoom(descriptor);
  let d = descriptor;
  if (spec.ally) d = withAllyAt(d, spec.ally);
  if (spec.lancer) d = withLancersAt(d, spec.lancer);
  if (spec.duel) d = withDuelRoom(d, spec.duel.aces);   // LAST: replaces the script the other two edit
  return d;
}

// The SHIP half: the one effective player build. `build` = `{ ship?, shipId?, loadout, components, skills }`
// (extra fields pass through untouched). Order: `beam` first, `duel` LAST — the duel forces the whole kit, so
// the beam is a no-op under a duel. The `ship` row is never replaced: a duel keeps the hull you fly.
//
// With the beam on and NO loadout, the swap falls back to `ship.stats.mounts`: the recorder hands a null
// loadout when the flown ship is not the account's active ship (`replay.js flownBuild`), and the tab built
// that ship's catalog mounts with the beam swapped in — so that is what was flown, and what is recorded.
//
// There is deliberately no `brawl` branch: a brawl's parked spectator ship is never stepped, so handing it a
// duel kit under `?netbrawl&duel` is harmless and not worth a branch.
export function resolvePlayerBuild(build, spec = NO_FIGHT_SPEC) {
  if (!spec || !build) return build;
  let out = build;
  if (spec.beam) {
    const base = build.loadout || (build.ship && build.ship.stats && build.ship.stats.mounts
      ? { mounts: build.ship.stats.mounts } : null);
    if (base) out = { ...out, loadout: withBeamGun(base) };   // withBeamGun copies — never the caller's mounts
  }
  if (spec.duel) out = withDuelKit(out);                       // LAST: the duel forces the whole kit
  return out;
}

// spec → `trace.room` (DECISIONS §170). Each field is written only when set, so a plain duel is EXACTLY
// `{ kind:'duel', aces:N }` — byte-identical to every duel trace recorded before this module existed — and a
// campaign run is `null`. `brawl` is never recorded (a brawl records no session at all).
//   • duel:              `{ kind:'duel', aces, ally?, lancer?, beam? }`
//   • other dev fight:   `{ kind:'dev', ally?, lancer?, beam? }` (at least one of them)
//   • nothing set:       `null`
export function roomFromFightSpec(spec) {
  if (!spec) return null;
  const extra = {};
  if (spec.ally) extra.ally = spec.ally;
  if (spec.lancer) extra.lancer = spec.lancer;
  if (spec.beam) extra.beam = true;
  if (spec.duel) return { kind: 'duel', aces: spec.duel.aces, ...extra };
  return Object.keys(extra).length ? { kind: 'dev', ...extra } : null;
}

// trace → spec: the fight a recording was ACTUALLY fought in. A null/absent room is `NO_FIGHT_SPEC` itself (so
// the identity fast-paths hold under playback of the intro and of every campaign trace); an old
// `{ kind:'duel', aces }` trace maps to `{ duel:{aces} }`, which builds exactly the room the pre-spec
// `applyTraceRoom` built. An unknown kind is treated as no room (`validateTrace` rejects it before playback).
export function fightSpecFromTrace(trace) {
  const room = trace && trace.room;
  if (!room || (room.kind !== 'duel' && room.kind !== 'dev')) return NO_FIGHT_SPEC;
  return {
    ally: room.ally || null,
    lancer: room.lancer || null,
    beam: room.beam === true,
    duel: room.kind === 'duel' ? { aces: room.aces } : null,
    brawl: null,
  };
}
