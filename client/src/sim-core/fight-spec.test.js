// The ONE fight spec: one order for the level, one effective player build, and the trace round-trip.
//
// What is load-bearing, and what every case below pins:
//   • IDENTITY OFF — with nothing set the very same object comes back (not a copy): every campaign run and
//     the Level-0 determinism fixture build exactly what they built before the spec existed;
//   • ONE ORDER — brawl replaces everything; else ally, lancer, duel last (duel discards the rest);
//   • NON-MUTATION — a server's `buildCatalog` shares the seed's `phases` array and a fallback loadout is the
//     seed ship's own `mounts`, so a mutation would leak into every later room in the process;
//   • the trace round-trip — an OLD `{kind:'duel',aces}` trace rebuilds exactly today's duel room, and a
//     plain duel still records exactly `{kind:'duel',aces}`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_FIGHT_SPEC, applyFightSpec, resolvePlayerBuild, roomFromFightSpec, fightSpecFromTrace,
} from './fight-spec.js';
import { withAllyAt } from './ally-config.js';
import { withLancersAt } from './lancer-config.js';
import { withDuelRoom, DUEL_LOADOUT, DUEL_COMPONENTS } from './duel-config.js';
import { withBrawlRoom } from './brawl.js';
import { withBeamGun, BEAM_WEAPON_ID } from './beam-config.js';
import { LEVELS, SHIPS } from '../../../server/src/catalog_seed.js';

// level-4 carries both default phases: `wave-1` (lancer) and `clear-out` (ally).
const level4 = () => LEVELS.find((l) => l.name === 'level-4').descriptor;
const spec = (o = {}) => ({ ...NO_FIGHT_SPEC, ...o });
const ALLY = 'clear-out', LANCER = 'wave-1', DUEL = { aces: 2 };

test('NO_FIGHT_SPEC is frozen and all-off', () => {
  assert.ok(Object.isFrozen(NO_FIGHT_SPEC));
  assert.deepEqual(NO_FIGHT_SPEC, { ally: null, lancer: null, beam: false, duel: null, brawl: null });
});

test('applyFightSpec: nothing set hands back the SAME descriptor (identity, not a copy)', () => {
  const d = level4();
  assert.equal(applyFightSpec(d, NO_FIGHT_SPEC), d);
  assert.equal(applyFightSpec(d), d, 'the default spec is NO_FIGHT_SPEC');
  assert.equal(applyFightSpec(d, spec()), d, 'an all-off copy is the identity too');
  assert.equal(applyFightSpec(d, spec({ beam: true })), d, 'beam has no level half');
  assert.equal(applyFightSpec(d, null), d);
});

test('applyFightSpec: each of ally / lancer / duel alone is its single transform', () => {
  const d = level4();
  assert.deepEqual(applyFightSpec(d, spec({ ally: ALLY })), withAllyAt(d, ALLY));
  assert.deepEqual(applyFightSpec(d, spec({ lancer: LANCER })), withLancersAt(d, LANCER));
  assert.deepEqual(applyFightSpec(d, spec({ duel: DUEL })), withDuelRoom(d, 2));
});

test('applyFightSpec: ally + lancer compose in that order', () => {
  const d = level4();
  assert.deepEqual(applyFightSpec(d, spec({ ally: ALLY, lancer: LANCER })), withLancersAt(withAllyAt(d, ALLY), LANCER));
});

test('applyFightSpec: duel is LAST — it discards what ally and lancer wrote', () => {
  const d = level4();
  const duel = withDuelRoom(d, 2);
  assert.deepEqual(applyFightSpec(d, spec({ ally: ALLY, duel: DUEL })), duel);
  assert.deepEqual(applyFightSpec(d, spec({ lancer: LANCER, duel: DUEL })), duel);
  assert.deepEqual(applyFightSpec(d, spec({ ally: ALLY, lancer: LANCER, duel: DUEL })), duel);
  assert.deepEqual(applyFightSpec(d, spec({ ally: ALLY, lancer: LANCER, beam: true, duel: DUEL })), duel);
});

test('applyFightSpec: brawl replaces everything, alone and with each of the others', () => {
  const d = level4();
  const brawl = withBrawlRoom(d);
  for (const extra of [{}, { ally: ALLY }, { lancer: LANCER }, { beam: true }, { duel: DUEL },
    { ally: ALLY, lancer: LANCER, duel: DUEL }]) {
    assert.deepEqual(applyFightSpec(d, spec({ brawl: true, ...extra })), brawl, JSON.stringify(extra));
  }
});

test('applyFightSpec never mutates the input descriptor or its phases array', () => {
  const d = level4();
  const before = JSON.stringify(d);
  const phases = d.phases;
  for (const s of [{ ally: ALLY }, { lancer: LANCER }, { duel: DUEL }, { ally: ALLY, lancer: LANCER },
    { ally: ALLY, lancer: LANCER, duel: DUEL }, { brawl: true }]) {
    const out = applyFightSpec(d, spec(s));
    assert.notEqual(out, d, JSON.stringify(s));
    assert.notEqual(out.phases, phases, 'a NEW phases array');
  }
  assert.equal(d.phases, phases);
  assert.equal(JSON.stringify(d), before, 'the shared seed descriptor is untouched');
});

// ---------- resolvePlayerBuild ----------

const starter = () => SHIPS.find((s) => s.id === 1);
const gunLoadout = () => ({ mounts: [{ group: 'gun', weapon: 1, offset: 0, delay: 0 }, { group: 'rocket', weapon: 3, offset: 0, delay: 0 }], shipName: 'Scout' });

test('resolvePlayerBuild: nothing set hands back the SAME build', () => {
  const b = { ship: starter(), loadout: gunLoadout(), components: { hull: 1 }, skills: { mobility: 2 } };
  assert.equal(resolvePlayerBuild(b, NO_FIGHT_SPEC), b);
  assert.equal(resolvePlayerBuild(b), b);
  assert.equal(resolvePlayerBuild(b, spec({ ally: ALLY, lancer: LANCER })), b, 'the LEVEL-only flags leave the ship alone');
  assert.equal(resolvePlayerBuild(null, spec({ beam: true })), null);
});

test('resolvePlayerBuild: beam swaps ONLY the gun mount and never mutates the caller', () => {
  const loadout = gunLoadout();
  const b = { ship: starter(), loadout, components: { hull: 1 }, skills: null };
  const out = resolvePlayerBuild(b, spec({ beam: true }));
  assert.notEqual(out, b);
  assert.notEqual(out.loadout, loadout, 'a NEW loadout — the input may be the account\'s live G.activeShip.loadout');
  assert.deepEqual(out.loadout.mounts.map((m) => m.weapon), [BEAM_WEAPON_ID, 3], 'the rocket is left alone');
  assert.equal(out.loadout.shipName, 'Scout', 'the rest of the loadout rides along');
  assert.equal(loadout.mounts[0].weapon, 1, 'the ORIGINAL is untouched');
  assert.equal(out.components, b.components);
  // "The room applies the same swap": the build's loadout is exactly what withBeamGun makes of it.
  assert.deepEqual(out.loadout, withBeamGun(loadout));
});

test('resolvePlayerBuild: beam with no loadout falls back to the ship\'s catalog mounts — without touching them', () => {
  const ship = starter();
  const seedMounts = JSON.stringify(ship.stats.mounts);
  const out = resolvePlayerBuild({ ship, shipId: 1, loadout: null, components: null, skills: null }, spec({ beam: true }));
  assert.deepEqual(out.loadout.mounts.map((m) => m.weapon), [BEAM_WEAPON_ID, 3]);
  assert.equal(JSON.stringify(ship.stats.mounts), seedMounts, 'the module-level seed array is never mutated');
  // …and with no ship to fall back to, nothing can be swapped.
  const bare = { loadout: null };
  assert.equal(resolvePlayerBuild(bare, spec({ beam: true })), bare);
});

test('resolvePlayerBuild: duel forces the kit, clears skills and keeps the hull; duel + beam IS the duel', () => {
  const ship = starter();
  const b = { ship, shipId: 1, loadout: gunLoadout(), components: { hull: 7 }, skills: { mobility: 3 } };
  const duel = resolvePlayerBuild(b, spec({ duel: DUEL }));
  assert.equal(duel.loadout, DUEL_LOADOUT);
  assert.equal(duel.components, DUEL_COMPONENTS);
  assert.equal(duel.skills, null);
  assert.equal(duel.ship, ship, 'a duel keeps the hull you fly');
  assert.equal(duel.shipId, 1);
  assert.deepEqual(resolvePlayerBuild(b, spec({ duel: DUEL, beam: true })), duel, 'the beam is a no-op under a duel');
  assert.deepEqual(b.skills, { mobility: 3 }, 'the input is untouched');
});

// ---------- the trace round-trip ----------

test('roomFromFightSpec / fightSpecFromTrace: nothing set is null, and null is NO_FIGHT_SPEC itself', () => {
  assert.equal(roomFromFightSpec(NO_FIGHT_SPEC), null);
  assert.equal(roomFromFightSpec(spec({ brawl: true })), null, 'a brawl is never recorded');
  assert.equal(roomFromFightSpec(null), null);
  assert.equal(fightSpecFromTrace({ room: null }), NO_FIGHT_SPEC, 'the SAME object, so the identity paths hold under playback');
  assert.equal(fightSpecFromTrace({}), NO_FIGHT_SPEC);
  assert.equal(fightSpecFromTrace(null), NO_FIGHT_SPEC);
  assert.equal(fightSpecFromTrace({ room: { kind: 'brawl' } }), NO_FIGHT_SPEC, 'an unknown kind is no room');
});

test('an OLD duel trace maps to {duel:{aces}} and rebuilds exactly the pre-spec duel room', () => {
  const s = fightSpecFromTrace({ room: { kind: 'duel', aces: 2 } });
  assert.deepEqual(s, spec({ duel: { aces: 2 } }));
  const d = level4();
  assert.deepEqual(applyFightSpec(d, s), withDuelRoom(d, 2), 'what applyTraceRoom built');
});

test('a plain duel records EXACTLY {kind:\'duel\', aces} — no extra keys', () => {
  const room = roomFromFightSpec(spec({ duel: { aces: 2 } }));
  assert.deepEqual(room, { kind: 'duel', aces: 2 });
  assert.deepEqual(Object.keys(room), ['kind', 'aces']);
  assert.equal(JSON.stringify(room), '{"kind":"duel","aces":2}', 'byte-identical to every duel trace before the spec');
});

test('a non-duel dev fight records kind:\'dev\' with only the fields that are set', () => {
  assert.deepEqual(roomFromFightSpec(spec({ ally: ALLY, beam: true })), { kind: 'dev', ally: ALLY, beam: true });
  assert.deepEqual(roomFromFightSpec(spec({ lancer: LANCER })), { kind: 'dev', lancer: LANCER });
  assert.deepEqual(roomFromFightSpec(spec({ beam: true })), { kind: 'dev', beam: true });
  assert.deepEqual(roomFromFightSpec(spec({ duel: DUEL, ally: ALLY, beam: true })), { kind: 'duel', aces: 2, ally: ALLY, beam: true });
});

test('the round-trip holds for every recordable spec', () => {
  for (const s of [{ duel: DUEL }, { ally: ALLY }, { lancer: LANCER }, { beam: true }, { ally: ALLY, beam: true },
    { ally: ALLY, lancer: LANCER, beam: true }, { duel: DUEL, ally: ALLY, lancer: LANCER, beam: true }]) {
    const full = spec(s);
    assert.deepEqual(fightSpecFromTrace({ room: roomFromFightSpec(full) }), full, JSON.stringify(s));
  }
});
