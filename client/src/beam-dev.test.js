// The ?beam dev flag.
//
// The FLAG is not sticky and reads only the URL (the §81 rule `dev.js` follows), so evaluating it is pure.
// The pure swap (`withBeamGun`) is unconditional and never mutates. The "strict no-op with the flag off" guard
// moved with the flag into the fight spec (`sim-core/fight-spec.test.js`, `resolvePlayerBuild`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalBeamDev, evalLancerDev } from './beam-dev.js';
import { withBeamGun, BEAM_WEAPON_ID } from './sim-core/beam-config.js';

test('evalBeamDev: absent or falsy is OFF', () => {
  assert.equal(evalBeamDev(''), null);
  assert.equal(evalBeamDev('?dev'), null);
  assert.equal(evalBeamDev('?beam=0'), null);
  assert.equal(evalBeamDev('?beam=false'), null);
  assert.equal(evalBeamDev('?beam=off'), null);
  assert.equal(evalBeamDev(undefined), null);
});

test('evalBeamDev: bare ?beam (and its truthy spellings) arms the PLAYER', () => {
  assert.equal(evalBeamDev('?beam'), true);
  assert.equal(evalBeamDev('?beam=1'), true);
  assert.equal(evalBeamDev('?beam=true'), true);
  assert.equal(evalBeamDev('?debug&beam&level=4'), true, 'it composes with the other flags');
});

test('evalBeamDev: ?beam never arms the ENEMIES — the enemy half has its own param', () => {
  // The spike had `?beam=enemy` / `?beam=only-enemy` as a MODE of this flag. It is not one: arming a hostile
  // is `?lancer`, a separate param with its own phase argument, so no spelling of `?beam` can turn enemies
  // on by accident. Any unrecognised value simply means "the player carries it".
  assert.equal(evalBeamDev('?beam=enemy'), true, 'not an enemy mode — just the player, as any other value');
  assert.equal(evalBeamDev('?beam=only-enemy'), true);
  assert.equal(evalLancerDev('?beam=enemy'), null, 'and it arms no lancers either — that needs ?lancer');
});

test('evalLancerDev: absent or falsy is OFF', () => {
  assert.equal(evalLancerDev(''), null);
  assert.equal(evalLancerDev('?dev'), null);
  assert.equal(evalLancerDev('?beam'), null, 'the player half alone arms no enemy');
  assert.equal(evalLancerDev('?lancer=0'), null);
  assert.equal(evalLancerDev('?lancer=false'), null);
  assert.equal(evalLancerDev('?lancer=off'), null);
  assert.equal(evalLancerDev(undefined), null);
});

test('evalLancerDev: bare ?lancer (and its truthy spellings) means the DEFAULT phase, no forced level', () => {
  // `level: null` and not 'level-0': `normalizeLevelName(null)` is the intro level, which would silently
  // drag every bare ?lancer run back to it. The param has to actually be present to force a level.
  assert.deepEqual(evalLancerDev('?lancer'), { phase: 'wave-1', level: null });
  assert.deepEqual(evalLancerDev('?lancer=1'), { phase: 'wave-1', level: null });
  assert.deepEqual(evalLancerDev('?lancer=true'), { phase: 'wave-1', level: null });
});

test('evalLancerDev: a value names the PHASE, and `level` forces the level', () => {
  assert.deepEqual(evalLancerDev('?lancer=clear-out'), { phase: 'clear-out', level: null });
  assert.deepEqual(evalLancerDev('?lancer&level=4'), { phase: 'wave-1', level: 'level-4' });
  assert.deepEqual(evalLancerDev('?lancer=clear-out&level=4'), { phase: 'clear-out', level: 'level-4' });
});

test('?beam and ?lancer COMPOSE, and are read independently', () => {
  // The full test flight: your beam against theirs. Neither param can switch the other on or off.
  const search = '?beam&lancer&level=4';
  assert.equal(evalBeamDev(search), true);
  assert.deepEqual(evalLancerDev(search), { phase: 'wave-1', level: 'level-4' });
  assert.equal(evalBeamDev('?lancer&level=4'), null, 'lancers alone leave the player unarmed');
  assert.deepEqual(evalLancerDev('?beam&level=4'), null, 'and the player alone arms no lancers');
});

// THE PURE HALF, which a netsim ROOM applies (a server cannot read `location.search`). It is UNCONDITIONAL
// — no flag inside it — because the flag is the browser's concern and the room is told `beam=1` instead.
// This split is what stopped the two ends disagreeing about the player's weapon in a room.
test('withBeamGun swaps every gun mount unconditionally, and never mutates the caller\'s loadout', () => {
  const gun = { group: 'gun', weapon: 1, offset: 0, delay: 0 };
  const rocket = { group: 'rocket', weapon: 3, offset: 0, delay: 0 };
  const loadout = { mounts: [gun, rocket], shipName: 'Scout' };

  const out = withBeamGun(loadout);
  assert.notEqual(out, loadout, 'a NEW loadout — in a room the input is the row just read from the DB');
  assert.equal(out.mounts[0].weapon, BEAM_WEAPON_ID);
  assert.equal(BEAM_WEAPON_ID, 12, 'the player\'s Charged beam, never the lancer\'s enemy row 13');
  assert.equal(out.mounts[1].weapon, 3, 'the rocket is left alone');
  assert.equal(out.mounts[0].offset, 0, 'the rest of the mount is carried through');
  assert.equal(out.shipName, 'Scout');
  assert.equal(loadout.mounts[0].weapon, 1, 'the ORIGINAL is untouched');
  assert.equal(gun.weapon, 1);

  assert.deepEqual(withBeamGun({ mounts: [{ group: 'rocket', weapon: 3 }] }).mounts, [{ group: 'rocket', weapon: 3 }]);
  assert.deepEqual(withBeamGun({}).mounts, []);
  assert.equal(withBeamGun(null), null);
});

// The flag-gated half (`beamLoadout`) is gone: the beam is the fight spec's `beam` field, applied by
// `resolvePlayerBuild` — its identity-off, non-mutation and "the room applies the same swap" cases are in
// `sim-core/fight-spec.test.js`.
