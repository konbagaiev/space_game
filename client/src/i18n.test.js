import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, setSource, setBundle, normalizeLang, resolveLanguage, langButtons } from './i18n.js';

const SRC = {
  'ui.hud.health': { source: 'Health', context: 'x' },
  'ui.gameover.sub': { source: 'Destroyed: {kills} — Score: {score}', context: 'x' },
  'ui.welcome.pick': { source: 'Pick your ship', context: 'x' },
};

test('t: returns the English source when there is no active bundle', () => {
  setSource(SRC); setBundle({});
  assert.equal(t('ui.hud.health'), 'Health');
});

test('t: the active bundle overrides the source', () => {
  setSource(SRC); setBundle({ 'ui.hud.health': 'Здоровье' });
  assert.equal(t('ui.hud.health'), 'Здоровье');
});

test('t: a missing translation falls back to the English source', () => {
  setSource(SRC); setBundle({ 'ui.hud.health': 'Здоровье' }); // no ru for welcome.pick
  assert.equal(t('ui.welcome.pick'), 'Pick your ship');
});

test('t: an unknown key falls back to the key itself (no throw)', () => {
  setSource(SRC); setBundle({});
  assert.equal(t('nope.missing'), 'nope.missing');
});

test('t: interpolates {named} placeholders', () => {
  setSource(SRC); setBundle({});
  assert.equal(t('ui.gameover.sub', { kills: 12, score: 240 }), 'Destroyed: 12 — Score: 240');
});

test('t: interpolation works on translated values too, and leaves unknown vars intact', () => {
  setSource(SRC); setBundle({ 'ui.gameover.sub': 'Уничтожено: {kills} — Очки: {score}' });
  assert.equal(t('ui.gameover.sub', { kills: 3, score: 60 }), 'Уничтожено: 3 — Очки: 60');
  assert.equal(t('ui.gameover.sub', { kills: 3 }), 'Уничтожено: 3 — Очки: {score}'); // {score} left as-is
});

test('normalizeLang: maps tags to supported codes, else English', () => {
  assert.equal(normalizeLang('ru-RU'), 'ru');
  assert.equal(normalizeLang('RU'), 'ru');
  assert.equal(normalizeLang('en-US'), 'en');
  assert.equal(normalizeLang('fr-FR'), 'en'); // unsupported → en
  assert.equal(normalizeLang(''), 'en');
  assert.equal(normalizeLang(undefined), 'en');
});

test('resolveLanguage: explicit > server > browser > en', () => {
  assert.equal(resolveLanguage({ explicit: 'ru', server: 'en', browser: 'en-US' }), 'ru'); // explicit wins
  assert.equal(resolveLanguage({ server: 'ru', browser: 'en-US' }), 'ru');                 // server next
  assert.equal(resolveLanguage({ browser: 'ru-RU' }), 'ru');                               // then browser
  assert.equal(resolveLanguage({ browser: 'fr-FR' }), 'en');                               // fallback en
  assert.equal(resolveLanguage({}), 'en');
  assert.equal(resolveLanguage({ explicit: 'de' }), 'en'); // unsupported explicit ignored → browser(none)→en
});

test('langButtons: marks the active language and lists en then ru', () => {
  assert.deepEqual(langButtons('ru'), [
    { lang: 'en', label: 'EN', active: false },
    { lang: 'ru', label: 'RU', active: true },
  ]);
  assert.deepEqual(langButtons('en').map((b) => b.active), [true, false]);
});
