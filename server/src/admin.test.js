import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// This file runs in its own process (node --test), so it can control ADMIN_* env without touching the
// main suite's settings. With ADMIN_USER/ADMIN_PASSWORD unset, /admin must 404 (admin disabled — never
// open on prod), even for a request that carries valid-looking Basic Auth.
delete process.env.ADMIN_USER;
delete process.env.ADMIN_PASSWORD;

const { mountAdmin, adminEnabled, progressCell } = await import('./admin.js');

const app = express();
mountAdmin(app, async () => []); // injected datastore fn — never reached while disabled
const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const base = `http://localhost:${server.address().port}`;
after(() => server.close());

test('adminEnabled: false when the env vars are unset', () => {
  assert.equal(adminEnabled(), false);
});

test('admin: 404 when disabled (env unset), even with Basic Auth', async () => {
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') };
  const r = await fetch(base + '/admin', { headers: auth });
  assert.equal(r.status, 404);
});

test('adminEnabled: true once both env vars are set', () => {
  process.env.ADMIN_USER = 'admin';
  process.env.ADMIN_PASSWORD = 'secret';
  assert.equal(adminEnabled(), true);
  delete process.env.ADMIN_USER;
  delete process.env.ADMIN_PASSWORD;
});

// The players-table "progress" cell (pure render helper, no DB). `current_progress` is a raw level id
// that is off by one from the player-facing title, so the cell shows the title + a bar + n/N.
const LEVELS = [
  { id: 1, title: 'Level 0' }, { id: 2, title: 'Level 1' }, { id: 3, title: 'Level 2' },
  { id: 4, title: 'Level 3' }, { id: 5, title: 'Level 4' },
];

test('progressCell: title + bar + n/N, sortable by the raw id', () => {
  const first = progressCell(1, LEVELS);
  assert.ok(first.includes('data-sort="1"'), 'sorts by the raw progress id');
  assert.ok(first.includes('class="prog"'), 'took the bar markup path');
  assert.ok(first.includes('Level 0'), 'shows the level title');
  assert.ok(first.includes('1/5'), 'n/N fraction');
  assert.ok(first.includes('width:20%'), 'bar fill is 1/5');
  assert.ok(!first.includes('✔'), 'no check mark before the last level');

  const third = progressCell(3, LEVELS);
  assert.ok(third.includes('data-sort="3"'), 'sorts by the raw progress id');
  assert.ok(third.includes('class="prog"'), 'took the bar markup path');
  assert.ok(third.includes('Level 2'), 'id 3 is the level TITLED "Level 2"');
  assert.ok(!third.includes('Level 3'), 'never shows the raw id as a title');
  assert.ok(!third.includes('level-3'), 'never shows the levels.name column');
  assert.ok(third.includes('3/5'), 'n/N fraction');
  assert.ok(third.includes('width:60%'), 'bar fill is 3/5');
  assert.ok(!third.includes('✔'), 'no check mark before the last level');
});

test('progressCell: ✔ only on the final level', () => {
  const last = progressCell(5, LEVELS);
  assert.ok(last.includes('Level 4'), 'shows the last level title');
  assert.ok(last.includes('5/5'), 'n/N fraction');
  assert.ok(last.includes('width:100%'), 'bar is full');
  assert.ok(last.includes('✔'), 'the last level is marked');
  // the ✔ sits INSIDE .lvl so the fixed-width title keeps every bar column-aligned
  assert.match(last, /<span class="lvl">Level 4 <span class="done">✔<\/span><\/span>/);
});

test('progressCell: N and n are derived, not hardcoded', () => {
  const three = [{ id: 1, title: 'Level 0' }, { id: 2, title: 'Level 1' }, { id: 3, title: 'Level 2' }];
  const mid = progressCell(2, three);
  assert.ok(mid.includes('2/3'), 'N is the number of level rows');
  assert.ok(!mid.includes('2/5'), 'N is never hardcoded to 5');

  // Non-contiguous ids: n is the ORDINAL position, so a future id gap can never render "5/3".
  const gappy = [{ id: 2, title: 'A' }, { id: 5, title: 'B' }, { id: 9, title: 'C' }];
  const gap = progressCell(5, gappy);
  assert.ok(gap.includes('>B'), 'resolves the title by id, not by array index');
  assert.ok(gap.includes('2/3'), 'n is the ordinal position, not the raw id');
  assert.ok(gap.includes('data-sort="5"'), 'still sorts by the raw id');
});

test('progressCell: unknown progress falls back to the bare number', () => {
  assert.equal(progressCell(7, LEVELS), '<td data-sort="7" class="num">7</td>');
  assert.equal(progressCell(1, []), '<td data-sort="1" class="num">1</td>');
});

test('progressCell: escapes the level title', () => {
  const cell = progressCell(1, [{ id: 1, title: '<script>x</script>' }]);
  assert.ok(cell.includes('&lt;script&gt;'), 'the title is HTML-escaped');
  assert.ok(!cell.includes('<script>'), 'no raw script tag');
});
