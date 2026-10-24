import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKILLS, skillColumn } from './skills.js';
import { skillEffects } from './components.js';

// SKILLS is the one list the server columns, the /skills/spend whitelist, the new-player defaults, the tools
// and the Character cards all read. These guards tie the copies that CANNOT import it (the effect maths and
// the translated card text) to the list, so a sixth skill can't ship half-wired.

test('skills: the column name is skill_<key>', () => {
  assert.equal(skillColumn('kinetic'), 'skill_kinetic');
  assert.equal(new Set(SKILLS).size, SKILLS.length, 'no duplicate skill keys');
});

test('skills: every skill in SKILLS changes the ship (skillEffects reads it)', () => {
  const none = skillEffects({});
  for (const k of SKILLS) {
    assert.notDeepEqual(skillEffects({ [k]: 1 }), none, `skill "${k}" has no effect in skillEffects`);
  }
});

test('skills: every skill has its Character card name + desc in the source AND the Russian locale', () => {
  const read = (f) => JSON.parse(readFileSync(new URL(`../../locales/${f}`, import.meta.url), 'utf8'));
  const source = read('source.json'); // values are { source, context }
  const ru = read('ru.json');         // values are plain strings
  for (const k of SKILLS) {
    for (const part of ['name', 'desc']) {
      const key = `ui.skill.${k}.${part}`;
      assert.ok(source[key] && typeof source[key].source === 'string' && source[key].source, `source.json lacks ${key}`);
      assert.ok(typeof ru[key] === 'string' && ru[key], `ru.json lacks ${key}`);
    }
  }
});
