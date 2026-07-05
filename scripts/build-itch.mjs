// Build the itch.io HTML5 export: a static ZIP with index.html at its root that runs on itch.io and
// talks to the live backend at https://vega.tenony.com. See docs/plans/2026-07-01-1824-itch-html5-export.md.
//
// It stages an allowlist of client files (index.html at the root so itch can serve it), overwrites the
// STAGED copy of src/api-base.js with the prod API_BASE (the source tree keeps API_BASE=''), and zips the
// staging dir's contents via the system `zip` binary. Manual, on-demand: `npm run build:itch`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildModuleFromFile } from './credits-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(root, 'client');
const distDir = path.join(root, 'dist');
const staging = path.join(distDir, 'itch-staging');
const zipPath = path.join(distDir, 'vega-sentinels-itch.zip');

const MAX_FILES = 1000;
const MAX_BYTES = 500 * 1024 * 1024; // itch limit: 500 MB extracted

// Drop files we never want in the export (tests, editor/OS cruft, dependency dirs).
const skip = (src) => {
  const b = path.basename(src);
  return b === 'node_modules' || b === '.DS_Store' || b.endsWith('.test.js');
};
const filter = (src) => !skip(src);

// Fresh staging dir.
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

// Allowlist copied from client/ into the staging root (so index.html sits at the ZIP root).
const files = ['index.html', 'styles.css', 'favicon.svg'];
const dirs = ['src', 'locales', 'assets'];
for (const f of files) fs.cpSync(path.join(clientDir, f), path.join(staging, f));
for (const d of dirs) fs.cpSync(path.join(clientDir, d), path.join(staging, d), { recursive: true, filter });

// Regenerate the credits data into the STAGED tree from CREDITS.md, so the itch export always carries
// fresh attributions even if the committed client/src/credits-data.js drifted (the source tree is
// untouched — same pattern as the api-base.js override below). See the credits-screen plan.
fs.writeFileSync(
  path.join(staging, 'src', 'credits-data.js'),
  buildModuleFromFile(path.join(clientDir, 'assets', 'CREDITS.md')),
);

// Bake the production API base + build source into the STAGED api-base.js only (source tree stays
// same-origin '' / 'web'). BUILD_SOURCE='itch' lets registerBoot() tag itch players (see net.js).
const PROD =
  "// Baked by scripts/build-itch.mjs for the itch.io export — the client runs on itch's CDN and calls\n" +
  "// the API cross-origin at the production origin. The source tree keeps API_BASE=''. See\n" +
  "// docs/plans/2026-07-01-1824-itch-html5-export.md.\n" +
  "export const API_BASE = 'https://vega.tenony.com';\n" +
  "export const BUILD_SOURCE = 'itch';\n";
fs.writeFileSync(path.join(staging, 'src', 'api-base.js'), PROD);

// Count files + total bytes (guard against itch limits) by walking the staging tree.
let fileCount = 0;
let totalBytes = 0;
const walk = (dir) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else { fileCount++; totalBytes += fs.statSync(p).size; }
  }
};
walk(staging);

if (fileCount > MAX_FILES) throw new Error(`itch export has ${fileCount} files, over the ${MAX_FILES} limit`);
if (totalBytes > MAX_BYTES) throw new Error(`itch export is ${totalBytes} bytes, over the ${MAX_BYTES} limit`);

// Zip the staging dir's CONTENTS (relative paths, index.html at root). `zip` appends to an existing
// archive, so remove any stale one first.
fs.rmSync(zipPath, { force: true });
execFileSync('zip', ['-r', '-X', '-q', zipPath, '.'], { cwd: staging, stdio: 'inherit' });

const zipBytes = fs.statSync(zipPath).size;
const mb = (n) => (n / (1024 * 1024)).toFixed(2);
console.log(`itch export built: ${path.relative(root, zipPath)}`);
console.log(`  files:      ${fileCount} (limit ${MAX_FILES})`);
console.log(`  extracted:  ${mb(totalBytes)} MB (limit ${mb(MAX_BYTES)} MB)`);
console.log(`  zip size:   ${mb(zipBytes)} MB`);
