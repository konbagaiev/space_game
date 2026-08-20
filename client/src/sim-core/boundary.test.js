// The contract of this folder, enforced.
//
// `sim-core/` is meant to be the ONE implementation of the game's rules, running unchanged in two hosts:
// the browser (single-player, and later client-side prediction) and Node (the multiplayer authority, and
// the headless referee that re-simulates a submitted input trace). That only holds while nothing in here
// reaches for Three.js, the DOM, the network, or browser storage — and "we'll be careful" is not a
// mechanism. One import added on a tired afternoon silently makes the module un-runnable in Node, and the
// failure shows up much later as "why can't the server load the sim".
//
// So: scan the folder's own modules and fail loudly. Test files are exempt — they legitimately reach out
// to the server's catalog seed and to client-only modules for fixtures.
//
// See docs/plans/server-authoritative-sim.md and DECISIONS §45 (why collision.js was THREE-free first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const modules = readdirSync(dir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

// Comments talk ABOUT the things we ban (this file's own header does), so strip them before matching —
// otherwise the guard fires on its own documentation.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('sim-core has modules to guard (a rename must not silently empty this suite)', () => {
  assert.ok(modules.length >= 8, `expected the sim-core modules, found ${modules.length}`);
});

for (const file of modules) {
  const code = stripComments(readFileSync(path.join(dir, file), 'utf8'));

  test(`${file} imports no renderer, and nothing outside sim-core`, () => {
    const specifiers = [...code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of specifiers) {
      assert.ok(!/^three(\/|$)/.test(spec), `${file} imports "${spec}" — sim-core must never import three`);
      assert.ok(!spec.startsWith('../'),
        `${file} imports "${spec}" — sim-core must not reach outside itself (that module may be browser-only)`);
      assert.ok(spec.startsWith('./') || spec.startsWith('node:'),
        `${file} imports "${spec}" — only sibling sim-core modules and node: builtins are allowed`);
    }
  });

  test(`${file} touches no browser-only global`, () => {
    // `performance` is deliberately absent from this list: it exists in Node too.
    for (const g of ['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location', 'alert']) {
      assert.ok(!new RegExp(`\\b${g}\\b`).test(code),
        `${file} references \`${g}\` — that makes it un-loadable in Node, where the authority runs`);
    }
    assert.ok(!/\bfetch\s*\(/.test(code), `${file} calls fetch() — sim-core decides, it never talks to a backend`);
  });
}

// Every module actually LOADS in Node — the contract is worthless if it only holds on paper.
//
// This also catches the mistake the folder is most prone to while it is being assembled: importing a name
// from the wrong sibling. ESM resolves named imports at LINK time, so `import { stepPlayerDeath } from
// './step-player.js'` when the function lives in step-enemies.js is a SyntaxError the moment the module is
// loaded — and nothing else in `node --test` loads these modules end to end, so the first sign of it was
// the game booting to a blank page. One dynamic import per module turns that into a unit-test failure.
for (const file of modules) {
  test(`${file} loads in Node (imports resolve, no browser-only global at module scope)`, async () => {
    await import(`./${file}`);
  });
}
