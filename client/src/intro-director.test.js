// The scripted intro director (client/src/intro-director.js) — the words over the playable Level 0.
// Pure and DOM-free, so `node --test` drives it directly with a synthetic sim clock at the fixed 1/60 step,
// exactly the way main.js drives it from the accumulator.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { makeIntroDirector } from './intro-director.js';

const DT = 1 / 60;

// The SHIPPED script (server/src/catalog_seed.js level-0 `intro`) — kept in sync by hand on purpose: if
// someone changes a beat there, these assertions describe what the intro used to do and must be re-read.
const SCRIPT = {
  lineHold: 3, lineFade: 2, helpHold: 3.5, helpFly: 0.45,
  beats: [
    { id: 'l0', on: 'start', textKey: 'ui.intro.l0' },
    { id: 'l1', on: 'spawn', n: 2, textKey: 'ui.intro.l1' },
    { id: 'l2', on: 'kill', n: 2, delay: 2, textKey: 'ui.intro.l2' },
    { id: 'l3', on: 'spawn', n: 4, textKey: 'ui.intro.l3' },
    { id: 'l4', on: 'cleared', textKey: 'ui.intro.l4' },
  ],
};

// Drive the director from `t` to `to` at the fixed step, holding the given world state. Returns every
// command emitted along the way (in order), so a test can assert on the one-shots as well as the view.
function run(dir, from, to, state = {}) {
  const cmds = [];
  for (let t = from; t <= to + 1e-9; t += DT) {
    for (const c of dir.tick({ t, kills: 0, alive: 0, cleared: false, ...state })) cmds.push(c);
  }
  return cmds;
}

test('l0 speaks on the first tick, holds 3 s, then fades out by t≈5', () => {
  const dir = makeIntroDirector(SCRIPT);
  const first = dir.tick({ t: 0, kills: 0, alive: 0, cleared: false });
  assert.deepEqual(first, ['line:l0']);
  assert.equal(dir.view.lineKey, 'ui.intro.l0');
  assert.equal(dir.view.lineAlpha, 1);

  run(dir, DT, 2.9);
  assert.equal(dir.view.lineAlpha, 1, 'fully opaque for the whole lineHold');

  run(dir, 2.9 + DT, 4.0);
  const mid = dir.view;
  assert.ok(mid.lineAlpha > 0 && mid.lineAlpha < 1, `mid-fade alpha ${mid.lineAlpha}`);
  assert.equal(mid.lineKey, 'ui.intro.l0', 'still the same line while it fades');

  run(dir, 4.0 + DT, 5.2);
  assert.equal(dir.view.lineAlpha, 0);
  assert.equal(dir.view.lineKey, null, 'nothing on screen once the fade completes');
});

test('the controls card walks idle → hold → fly → done, one command each', () => {
  const dir = makeIntroDirector(SCRIPT);
  assert.equal(dir.help, 'idle');

  let cmds = run(dir, 0, 4.9);
  assert.equal(dir.help, 'idle', 'still idle while the opening line owns the slot');
  assert.equal(cmds.filter((c) => c.startsWith('help:')).length, 0);

  cmds = run(dir, 4.9 + DT, 5.2);              // lineHold + lineFade = 5
  assert.deepEqual(cmds.filter((c) => c.startsWith('help:')), ['help:hold']);
  assert.equal(dir.help, 'hold');

  cmds = run(dir, 5.2 + DT, 8.6);              // + helpHold = 8.5
  assert.deepEqual(cmds.filter((c) => c.startsWith('help:')), ['help:fly']);
  assert.equal(dir.help, 'fly');

  cmds = run(dir, 8.6 + DT, 9.2);              // + helpFly = 8.95
  assert.deepEqual(cmds.filter((c) => c.startsWith('help:')), ['help:done']);
  assert.equal(dir.help, 'done');

  cmds = run(dir, 9.2 + DT, 12);
  assert.equal(cmds.filter((c) => c.startsWith('help:')).length, 0, 'done is terminal — no repeats');
});

test('l1 fires when kills+alive first reaches 2, whatever the split', () => {
  for (const state of [{ kills: 1, alive: 1 }, { kills: 2, alive: 0 }, { kills: 0, alive: 2 }]) {
    const dir = makeIntroDirector(SCRIPT);
    run(dir, 0, 1, { kills: 0, alive: 1 });
    assert.ok(!dir.fired.includes('l1'), 'one spawned is not two');
    const cmds = run(dir, 1 + DT, 1 + DT, state);
    assert.ok(cmds.includes('line:l1'), `l1 fires for ${JSON.stringify(state)}`);
    assert.equal(dir.view.lineKey, 'ui.intro.l1');
  }
});

test('l2 fires 2 s AFTER the second kill, not on the kill tick', () => {
  const dir = makeIntroDirector(SCRIPT);
  run(dir, 0, 10, { kills: 0, alive: 1 });
  const onKill = run(dir, 10 + DT, 10 + DT, { kills: 2, alive: 0 });
  assert.ok(!onKill.includes('line:l2'), 'the kill only schedules it');
  const before = run(dir, 10 + 2 * DT, 11.9, { kills: 2, alive: 0 });
  assert.ok(!before.includes('line:l2'), 'still pending at +1.9 s');
  const after = run(dir, 11.9 + DT, 12.2, { kills: 2, alive: 0 });
  assert.ok(after.includes('line:l2'), 'speaks at +2 s');
  assert.equal(dir.view.lineKey, 'ui.intro.l2');
});

test('l3 fires on the 4th spawn; l4 fires on `cleared`', () => {
  const dir = makeIntroDirector(SCRIPT);
  run(dir, 0, 5, { kills: 3, alive: 0 });
  assert.ok(!dir.fired.includes('l3'), 'three spawned is not four');
  const spawn4 = run(dir, 5 + DT, 5 + DT, { kills: 3, alive: 1 });
  assert.ok(spawn4.includes('line:l3'));
  const cleared = run(dir, 5 + 2 * DT, 5 + 2 * DT, { kills: 4, alive: 0, cleared: true });
  assert.ok(cleared.includes('line:l4'));
  assert.equal(dir.view.lineKey, 'ui.intro.l4');
  assert.equal(dir.view.lineAlpha, 1);
});

test('a new beat REPLACES a line that is mid-fade, in the same tick', () => {
  const dir = makeIntroDirector(SCRIPT);
  run(dir, 0, 4.0);                                  // l0 is mid-fade
  assert.ok(dir.view.lineAlpha > 0 && dir.view.lineAlpha < 1);
  const cmds = run(dir, 4.0 + DT, 4.0 + DT, { kills: 0, alive: 2 });
  assert.deepEqual(cmds, ['line:l1']);
  assert.equal(dir.view.lineKey, 'ui.intro.l1');
  assert.equal(dir.view.lineAlpha, 1, 'the fade restarts from full — no queue');
});

test('a restart (the sim clock goes backwards) re-arms every beat', () => {
  const dir = makeIntroDirector(SCRIPT);
  run(dir, 0, 12, { kills: 4, alive: 0, cleared: true });
  assert.deepEqual(dir.fired.sort(), ['l0', 'l1', 'l2', 'l3', 'l4']);
  assert.equal(dir.help, 'done');

  const cmds = dir.tick({ t: 0, kills: 0, alive: 0, cleared: false });   // reset() → combatElapsed back to 0
  assert.ok(cmds.includes('line:l0'), 'the opening line speaks again');
  assert.deepEqual(dir.fired, ['l0']);
  assert.equal(dir.help, 'idle');
  assert.equal(dir.view.lineKey, 'ui.intro.l0');
});

test('every beat fires at most once even while its trigger stays true', () => {
  const dir = makeIntroDirector(SCRIPT);
  const cmds = run(dir, 0, 20, { kills: 4, alive: 0, cleared: true });
  const lines = cmds.filter((c) => c.startsWith('line:'));
  assert.deepEqual(lines.sort(), ['line:l0', 'line:l1', 'line:l2', 'line:l3', 'line:l4']);
});
