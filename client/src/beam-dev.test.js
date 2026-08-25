// The ?beam dev flag.
//
// Two things are worth guarding, and they mirror `ally-dev.test.js`. The FLAG is not sticky and reads only
// the URL (the §81 rule `dev.js` follows), so evaluating it is pure. And `beamLoadout` must be a STRICT
// no-op with the flag off — it is called on the way into every player build, including the account's live
// `G.activeShip.loadout`, so a copy or a mutation there would show up in every real player's ship.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalBeamDev, beamLoadout, setBeamDev } from './beam-dev.js';

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

test('evalBeamDev: there is NO enemy half — arming a hostile is gated behind DECISIONS §135', () => {
  // The spike had `?beam=enemy` / `?beam=only-enemy`. An enemy beam is a 0.5 s unanswerable hit until the
  // HOSTILE SIGHT exists, so the flag must not offer a way to turn one on by accident. Any unrecognised
  // value simply means "the player carries it" — never "the enemies do".
  assert.equal(evalBeamDev('?beam=enemy'), true, 'not an enemy mode — just the player, as any other value');
  assert.equal(evalBeamDev('?beam=only-enemy'), true);
});

test('beamLoadout with the flag OFF returns the very same object, untouched', () => {
  setBeamDev(null);
  const loadout = { mounts: [{ group: 'gun', weapon: 1, offset: 0, delay: 0 }] };
  assert.equal(beamLoadout(loadout), loadout, 'identity — not a copy, not a rebuild');
  assert.equal(loadout.mounts[0].weapon, 1);
  assert.equal(beamLoadout(null), null);
});

test('beamLoadout with the flag ON swaps ONLY the gun mount, and never mutates the caller\'s loadout', () => {
  setBeamDev(true);
  const gun = { group: 'gun', weapon: 1, offset: 0, delay: 0 };
  const rocket = { group: 'rocket', weapon: 3, offset: 0, delay: 0 };
  const loadout = { mounts: [gun, rocket], shipName: 'Scout' };

  const out = beamLoadout(loadout);
  assert.notEqual(out, loadout, 'a NEW loadout');
  assert.equal(out.mounts[0].weapon, 12, 'the gun slot now carries the Charged beam (catalog id 12)');
  assert.equal(out.mounts[1].weapon, 3, 'the rocket is left alone — a beam-armed ship keeps its rockets');
  assert.equal(out.mounts[0].offset, 0, 'the rest of the mount is carried through');
  assert.equal(out.shipName, 'Scout', 'and the rest of the loadout with it');

  assert.equal(loadout.mounts[0].weapon, 1, 'the ORIGINAL is untouched — it may be the live account object');
  assert.equal(gun.weapon, 1);
  setBeamDev(null);
});

test('beamLoadout copes with a loadout that has no gun mount at all', () => {
  setBeamDev(true);
  const loadout = { mounts: [{ group: 'rocket', weapon: 3 }] };
  assert.deepEqual(beamLoadout(loadout).mounts, [{ group: 'rocket', weapon: 3 }]);
  assert.deepEqual(beamLoadout({}).mounts, []);
  setBeamDev(null);
});
