// The ?ally dev flag, and the descriptor helper it drives.
//
// Two things are worth guarding. The FLAG is not sticky and reads only the URL (the §81 rule dev.js
// follows), so evaluating it is pure. And `withAllyAt` must never MUTATE: `buildCatalog` shallow-copies a
// level, so its `phases` array is shared with the module-level seed — writing `ally: true` into a phase in
// place would give every room in the process a wingman, on every level, forever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalAllyDev } from './ally-dev.js';
import { withAllyAt, DEV_ALLY_DEFAULT_PHASE } from './sim-core/ally-config.js';

test('evalAllyDev: absent or falsy is OFF', () => {
  assert.equal(evalAllyDev(''), null);
  assert.equal(evalAllyDev('?dev'), null);
  assert.equal(evalAllyDev('?ally=0'), null);
  assert.equal(evalAllyDev('?ally=false'), null);
  assert.equal(evalAllyDev('?ally=off'), null);
  assert.equal(evalAllyDev('?level=4'), null, 'a bare level param is not the ally flag');
});

test('evalAllyDev: bare ?ally uses the default phase and forces NO level', () => {
  assert.deepEqual(evalAllyDev('?ally'), { phase: DEV_ALLY_DEFAULT_PHASE, level: null });
  assert.deepEqual(evalAllyDev('?ally=true'), { phase: DEV_ALLY_DEFAULT_PHASE, level: null });
  assert.deepEqual(evalAllyDev('?ally=1'), { phase: DEV_ALLY_DEFAULT_PHASE, level: null });
});

test('evalAllyDev: ?ally=<name> names another phase, alongside other flags', () => {
  assert.deepEqual(evalAllyDev('?ally=wave-1'), { phase: 'wave-1', level: null });
  assert.deepEqual(evalAllyDev('?debug&ally=wave-2&dev'), { phase: 'wave-2', level: null });
});

test('evalAllyDev: `level` names the LEVEL, exactly as ?record=1&level=<id> does', () => {
  // The whole point of the param: Level 3 and Level 4 carry IDENTICAL phase names, so without it a test
  // flight aimed at Level 4 lands on whatever the account's progress happens to be — invisibly.
  assert.deepEqual(evalAllyDev('?ally&level=4'), { phase: DEV_ALLY_DEFAULT_PHASE, level: 'level-4' });
  assert.deepEqual(evalAllyDev('?ally&level=0'), { phase: DEV_ALLY_DEFAULT_PHASE, level: 'level-0' },
    'a bare 0 is Level 0, not "no level"');
  assert.deepEqual(evalAllyDev('?ally&level=level-4'), { phase: DEV_ALLY_DEFAULT_PHASE, level: 'level-4' },
    'an explicit seed name passes through — normalizeLevelName, same as ?record');
});

test('evalAllyDev: the two params COMPOSE, in either order and beside the other flags', () => {
  const want = { phase: 'wave-1', level: 'level-4' };
  assert.deepEqual(evalAllyDev('?ally=wave-1&level=4'), want);
  assert.deepEqual(evalAllyDev('?level=4&ally=wave-1'), want);
  assert.deepEqual(evalAllyDev('?debug&ally=wave-1&level=4&dev'), want);
});

test('evalAllyDev: `level` alone forces nothing when the ally flag is off', () => {
  // `level` is a SHARED param (?record reads it too). It must not turn the wingman on by itself, or a
  // recording session would silently grow a third combatant.
  assert.equal(evalAllyDev('?record=1&level=4'), null);
  assert.equal(evalAllyDev('?ally=off&level=4'), null);
});

test('withAllyAt does not mutate: a NEW descriptor, a NEW phases array, a NEW phase object', () => {
  const phase = { name: 'clear-out', spawn: { total: 5 } };
  const level = { title: 'Level 4', phases: [{ name: 'wave-1' }, phase] };
  const out = withAllyAt(level, 'clear-out');
  assert.notEqual(out, level);
  assert.notEqual(out.phases, level.phases);
  assert.notEqual(out.phases[1], phase);
  assert.equal(out.phases[1].ally, true);
  assert.equal(out.phases[1].spawn, phase.spawn, 'the untouched fields are carried through');
  assert.equal(phase.ally, undefined, 'the ORIGINAL phase is untouched — the seed is shared');
  assert.equal(level.phases[0].ally, undefined);
  assert.equal(out.phases[0], level.phases[0], 'and every other phase is the same object');
});

test('withAllyAt returns the input untouched for an unknown phase name or a phase-less level', () => {
  const level = { phases: [{ name: 'wave-1' }] };
  assert.equal(withAllyAt(level, 'nope'), level);
  assert.equal(withAllyAt(null, 'wave-1'), null);
  const noPhases = { title: 'x' };
  assert.equal(withAllyAt(noPhases, 'wave-1'), noPhases);
});
