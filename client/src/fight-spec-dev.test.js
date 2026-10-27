// The browser's fight spec, parsed from the URL. The guard that matters most is the first: a page load with
// no fight flag must get `NO_FIGHT_SPEC` ITSELF, so every campaign run takes the identity paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFightSpec, fightSpec, setFightSpec, useTraceFightSpec } from './fight-spec-dev.js';
import { NO_FIGHT_SPEC } from './sim-core/fight-spec.js';

const spec = (o = {}) => ({ ...NO_FIGHT_SPEC, ...o });

test('no fight flag is NO_FIGHT_SPEC itself', () => {
  assert.equal(parseFightSpec(''), NO_FIGHT_SPEC);
  assert.equal(parseFightSpec(undefined), NO_FIGHT_SPEC);
  assert.equal(parseFightSpec('?debug&netsim=1&level=4'), NO_FIGHT_SPEC, 'non-fight flags do not count');
  assert.equal(parseFightSpec('?ally=0&beam=off&duel=false&lancer=0&brawl=0'), NO_FIGHT_SPEC, 'explicitly-off flags are off');
});

test('each flag on its own', () => {
  assert.deepEqual(parseFightSpec('?ally'), spec({ ally: 'clear-out' }));
  assert.deepEqual(parseFightSpec('?lancer&level=4'), spec({ lancer: 'wave-1' }));
  assert.deepEqual(parseFightSpec('?beam'), spec({ beam: true }));
  assert.deepEqual(parseFightSpec('?duel=3'), spec({ duel: { aces: 3 } }));
  assert.deepEqual(parseFightSpec('?duel'), spec({ duel: { aces: 2 } }), 'bare ?duel is the default two aces');
  assert.deepEqual(parseFightSpec('?brawl=10'), spec({ brawl: true }));
});

test('?netbrawl=N is brawl:true — the spec carries a boolean, the room\'s COUNT travels as NETSIM.brawl', () => {
  assert.deepEqual(parseFightSpec('?netbrawl=5'), spec({ brawl: true }));
});

test('a combination keeps every field', () => {
  assert.deepEqual(parseFightSpec('?ally=wave-2&lancer&beam&duel=2&level=4'),
    { ally: 'wave-2', lancer: 'wave-1', beam: true, duel: { aces: 2 }, brawl: null });
});

test('fightSpec() reads the URL lazily (none in Node), and a trace overrides it under ?playback', () => {
  setFightSpec(undefined);
  assert.equal(fightSpec(), NO_FIGHT_SPEC, 'Node has no location: no flags');
  useTraceFightSpec({ room: { kind: 'dev', beam: true } });
  assert.deepEqual(fightSpec(), spec({ beam: true }), 'the trace decides');
  useTraceFightSpec({ room: null });
  assert.equal(fightSpec(), NO_FIGHT_SPEC, 'a campaign trace is the identity spec itself');
  setFightSpec(undefined);
});
