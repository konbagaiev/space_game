import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCreditsMd, buildModuleFromFile } from '../../scripts/credits-build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const mdPath = path.join(here, '..', 'assets', 'CREDITS.md');
const dataPath = path.join(here, 'credits-data.js');
const md = fs.readFileSync(mdPath, 'utf8');

// A raw file-path / dangling-extension label the credits screen must NEVER show (the anti-regression the
// broken `(`/` — `/`.` slicing rule produced). We check for path-shaped names, not any `/`, because a
// legit courtesy label ("medium/large ship explosion") contains a slash but is not a path.
function isPathShaped(name) {
  return /^(ships|sounds)\//.test(name) || name.includes('<hash>') || name.includes('..') ||
    /\.(glb|mp3)$/.test(name);
}

// ---- Drift check: the committed module must byte-match a fresh regen from CREDITS.md (the CI guard) ----
test('credits-data.js is in sync with CREDITS.md (run `npm run credits:build` if this fails)', () => {
  const generated = buildModuleFromFile(mdPath);
  const committed = fs.readFileSync(dataPath, 'utf8');
  assert.equal(committed, generated,
    'client/src/credits-data.js is out of date — run `npm run credits:build` and commit the result.');
  assert.ok(generated.endsWith('\n') && !generated.endsWith('\n\n'), 'exactly one trailing newline');
});

// ---- Exact labels on the REAL file (a broken path label must FAIL, not pass) ----
test('real CREDITS.md yields the TASL work titles / courtesy labels, never file paths', () => {
  const { models, sounds } = parseCreditsMd(md);

  // The \<hash\> sound row → the parenthetical, NOT "sounds/kinetic..mp3".
  assert.ok(sounds.some((s) => s.name === 'kinetic gun SFX'), 'kinetic gun SFX courtesy label');
  // CC-BY model rows → the verbatim blockquote work title, NOT the file path.
  assert.ok(models.some((m) => m.name === 'Air & Space Vessel'), 'player-ship work title');
  assert.ok(models.some((m) => m.name === 'LowPoly Spaceships'), 'enemy-pack work title');

  for (const a of [...models, ...sounds]) {
    assert.ok(!isPathShaped(a.name), `name must not be a raw path/extension: ${JSON.stringify(a.name)}`);
  }
});

// ---- Compliance invariant on the real file ----
test('every model entry is a compliant CC-BY credit (author + source + license + not a path)', () => {
  const { models } = parseCreditsMd(md);
  assert.ok(models.length > 0, 'there are models to credit');
  for (const m of models) {
    assert.equal(m.requiresAttribution, true, `${m.name} requiresAttribution`);
    assert.ok(m.url, `${m.name} has a source url`);
    assert.ok(m.licenseUrl, `${m.name} has a license url`);
    assert.equal(m.license, 'CC BY 4.0', `${m.name} is CC BY 4.0`);
    assert.equal(m.modified, true, `${m.name} is marked modified`);
    assert.ok(!isPathShaped(m.name), `${m.name} is not a file path`);
  }
});

// ---- Parse-shape assertions from a fixture ----
const FIXTURE = [
  '| Asset (file) | Author | Source URL | License | Date added |',
  '|--------------|--------|------------|---------|------------|',
  '| sounds/beep.\\<hash\\>.mp3 (courtesy label) | Someone Else | https://freesound.org/s/1/ | CC0 1.0 | 2026-01-01 |',
  '| sounds/hush.\\<hash\\>.mp3 (renamed row) | Freesound (CC0 filter) | _id not retained (renamed x.wav)_ | CC0 1.0 | 2026-01-01 |',
  '| ships/foo.\\<hash\\>.glb (a foo) | Someone | https://skfb.ly/ZZ | CC-BY 4.0 | 2026-01-01 |',
  '',
  '<!--',
  'Example row:',
  '| ships/example.glb | Nobody | https://example.com | CC0 1.0 | 2026-01-01 |',
  '-->',
  '',
  '> "Foo Title" (https://skfb.ly/ZZ) by Someone is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).',
].join('\n');

test('fixture: table + blockquote parse into the expected shape; the comment row is ignored', () => {
  const { models, sounds } = parseCreditsMd(FIXTURE);

  // The HTML-comment example row is not parsed.
  assert.ok(![...models, ...sounds].some((a) => a.name.includes('example') || a.author === 'Nobody'),
    'the example row inside the HTML comment is ignored');

  // CC-BY ship row: name from the blockquote title, not the path or the "a foo" parenthetical.
  assert.equal(models.length, 1);
  const foo = models[0];
  assert.equal(foo.name, 'Foo Title');
  assert.equal(foo.author, 'Someone');
  assert.equal(foo.url, 'https://skfb.ly/ZZ');
  assert.equal(foo.license, 'CC BY 4.0');
  assert.equal(foo.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
  assert.equal(foo.modified, true);
  assert.equal(foo.requiresAttribution, true);

  // CC0 sound rows: parenthetical labels, no attribution, url present / null as appropriate.
  assert.equal(sounds.length, 2);
  assert.equal(sounds[0].name, 'courtesy label');
  assert.equal(sounds[0].url, 'https://freesound.org/s/1/');
  assert.equal(sounds[0].modified, false);
  assert.equal(sounds[0].requiresAttribution, false);
  assert.equal(sounds[1].name, 'renamed row');
  assert.equal(sounds[1].url, null); // "_id not retained (renamed x.wav)_" → no http url
});

// ---- Fail-loud: a CC-BY row with no matching verbatim block throws ----
test('a CC-BY row with no verbatim attribution block throws', () => {
  const bad = [
    '| Asset (file) | Author | Source URL | License | Date added |',
    '|--------------|--------|------------|---------|------------|',
    '| ships/orphan.\\<hash\\>.glb (an orphan) | Ghost | https://skfb.ly/NONE | CC-BY 4.0 | 2026-01-01 |',
  ].join('\n');
  assert.throws(() => parseCreditsMd(bad), /no verbatim attribution block/);
});

// ---- Fail-loud: an unknown license type throws (a new license must be handled deliberately) ----
test('an unknown license string throws', () => {
  const bad = [
    '| Asset (file) | Author | Source URL | License | Date added |',
    '|--------------|--------|------------|---------|------------|',
    '| sounds/weird.\\<hash\\>.mp3 (weird) | X | https://example.com | CC-BY-NC 4.0 | 2026-01-01 |',
  ].join('\n');
  assert.throws(() => parseCreditsMd(bad), /Unknown license/);
});
