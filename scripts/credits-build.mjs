// credits:build — parse client/assets/CREDITS.md (the single source of truth for third-party asset
// attributions) into a COMMITTED client/src/credits-data.js the buildless client imports. The vega/local
// serve has no build step (DECISIONS §31), so the generated module must live in git; a drift check wired
// into client/src/credits-data.test.js (and CI) keeps it honest, mirroring assets:check.
//
// Two STRUCTURED parts of CREDITS.md are read (the surrounding narrative prose is ignored):
//  1. the 5-column GFM table `| Asset (file) | Author | Source URL | License | Date added |` — the asset
//     SET plus each row's author, source URL, license and group (ships/ → models, sounds/ → sounds);
//  2. the verbatim CC-BY blockquote attribution lines
//     (`> "TITLE" (URL) by AUTHOR is licensed under Creative Commons Attribution …`) — the TASL-correct
//     work TITLE a compliant CC-BY credit must show, matched to its table row by Source URL.
//
// CLI: `node scripts/credits-build.mjs` writes the module; `--check` fails (exit 1) if it drifted.
// See docs/plans/2026-07-05-1340-credits-screen.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CC_BY = { license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', requiresAttribution: true };
const CC0 = { license: 'CC0 1.0', licenseUrl: null, requiresAttribution: false };
const PIXABAY = { license: 'Pixabay Content License', licenseUrl: null, requiresAttribution: false };

// A verbatim CC-BY blockquote attribution line → its work title + source URL.
const TITLE_RE = /^\s*>\s*"([^"]+)"\s*\((https?:\/\/[^)]+)\)\s*by\b/;
const TABLE_HEADER = '| Asset (file) | Author | Source URL | License | Date added |';

// Split a GFM table row (`| a | b | … |`) into trimmed cells, dropping the outer-pipe empties.
function splitRow(line) {
  const cells = line.split('|');
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

// Normalize the License cell → { license, licenseUrl, requiresAttribution }. Unknown → throw (fail loud
// so a new license type is handled deliberately).
function normalizeLicense(raw) {
  const s = raw.trim();
  if (s === 'CC-BY 4.0' || s === 'CC BY 4.0') return { ...CC_BY };
  if (s === 'CC0 1.0') return { ...CC0 };
  if (s === 'Pixabay Content License') return { ...PIXABAY };
  throw new Error(`Unknown license "${raw}" in CREDITS.md — extend normalizeLicense() to handle it deliberately`);
}

// Text between the FIRST `(` and the LAST `)` in the Asset cell → a courtesy row's human label, or null.
function parenthetical(assetCell) {
  const first = assetCell.indexOf('(');
  const last = assetCell.lastIndexOf(')');
  if (first === -1 || last === -1 || last <= first + 1) return null;
  return assetCell.slice(first + 1, last).trim() || null;
}

// Last-resort label: strip the ships/ | sounds/ prefix + any extension fragment so a label is never a raw
// path or a dangling extension. Should not fire on current data (CC-BY → title, courtesy → parenthetical).
function cleanFilename(assetCell) {
  let s = (assetCell.match(/^[^\s(]+/) || [assetCell.trim()])[0];
  s = s.replace(/^(ships|sounds)\//, '');
  s = s.replace(/`\.glb`/g, '')                    // literal `.glb` backtick token
    .replace(/\.\\?<hash\\?>\.(glb|mp3)/g, '')     // .\<hash\>.glb / .\<hash\>.mp3
    .replace(/\.(glb|mp3)$/g, '');                  // trailing .glb / .mp3
  s = s.replace(/\.\.+/g, '.').replace(/^\.|\.$/g, '');
  return s.trim();
}

// Derive the player-facing label per the plan's display-label strategy.
function deriveName(assetCell, url, requiresAttribution, titleByUrl) {
  if (requiresAttribution) {
    const title = url && titleByUrl.get(url);
    if (!title) throw new Error(`CC-BY asset ${url || '(no url)'} has no verbatim attribution block in CREDITS.md — add one`);
    return title;
  }
  return parenthetical(assetCell) || cleanFilename(assetCell);
}

export function parseCreditsMd(md) {
  const clean = md.replace(/<!--[\s\S]*?-->/g, ''); // drop HTML-comment blocks (the example row)
  const lines = clean.split('\n');

  // Independent pass: verbatim CC-BY blockquote titles → Map<url, title>.
  const titleByUrl = new Map();
  for (const line of lines) {
    const m = line.match(TITLE_RE);
    if (m) titleByUrl.set(m[2], m[1]);
  }

  // Locate the table header, then read data rows until the first blank / non-table line.
  const headerIdx = lines.findIndex((l) => l.trim() === TABLE_HEADER);
  if (headerIdx === -1) throw new Error(`CREDITS.md: table header "${TABLE_HEADER}" not found`);

  const models = [];
  const sounds = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') break;                       // end of table
    if (!line.trim().startsWith('|')) break;             // non-table line
    if (/^\s*\|[\s|:-]+\|\s*$/.test(line)) continue;      // the |---| separator row
    const cells = splitRow(line);
    if (cells.length < 5) continue;
    const [assetCell, authorCell, urlCell, licenseCell] = cells;

    const lic = normalizeLicense(licenseCell);
    const urlMatch = urlCell.match(/https?:\/\/[^\s)]+/);
    const url = urlMatch ? urlMatch[0] : null;
    const name = deriveName(assetCell, url, lic.requiresAttribution, titleByUrl);

    if (assetCell.startsWith('ships/')) {
      models.push({ name, author: authorCell, url, license: lic.license, licenseUrl: lic.licenseUrl, modified: true, requiresAttribution: lic.requiresAttribution });
    } else if (assetCell.startsWith('sounds/')) {
      sounds.push({ name, author: authorCell, url, license: lic.license, licenseUrl: lic.licenseUrl, modified: false, requiresAttribution: lic.requiresAttribution });
    } else {
      throw new Error(`CREDITS.md row with unexpected asset prefix (want ships/ or sounds/): ${assetCell}`);
    }
  }
  return { models, sounds };
}

// One `{ … },` object line — JSON.stringify the values for deterministic quoting/escaping (the drift test
// compares byte-for-byte).
function assetLine(a) {
  return `    { name: ${JSON.stringify(a.name)}, author: ${JSON.stringify(a.author)}, url: ${JSON.stringify(a.url)}, ` +
    `license: ${JSON.stringify(a.license)}, licenseUrl: ${JSON.stringify(a.licenseUrl)}, ` +
    `modified: ${a.modified}, requiresAttribution: ${a.requiresAttribution} },`;
}

export function generateModuleSource(data) {
  const lines = [
    '// AUTO-GENERATED by scripts/credits-build.mjs from client/assets/CREDITS.md — DO NOT EDIT BY HAND.',
    '// Regenerate with `npm run credits:build`. The drift check in client/src/credits-data.test.js fails',
    '// CI if this file is out of sync with CREDITS.md. See docs/plans/2026-07-05-1340-credits-screen.md.',
    'export const CREDITS = {',
    '  models: [',
    ...data.models.map(assetLine),
    '  ],',
    '  sounds: [',
    ...data.sounds.map(assetLine),
    '  ],',
    '};',
  ];
  return lines.join('\n') + '\n'; // exactly one trailing newline (keeps the drift check stable)
}

export function buildModuleFromFile(mdPath) {
  return generateModuleSource(parseCreditsMd(fs.readFileSync(mdPath, 'utf8')));
}

// ---- CLI ----
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const mdPath = path.join(root, 'client', 'assets', 'CREDITS.md');
  const outPath = path.join(root, 'client', 'src', 'credits-data.js');
  const generated = buildModuleFromFile(mdPath);
  const { models, sounds } = parseCreditsMd(fs.readFileSync(mdPath, 'utf8'));

  if (process.argv.includes('--check')) {
    const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
    if (current !== generated) {
      console.error('credits-data.js is out of date — run `npm run credits:build`');
      process.exit(1);
    }
    console.log('credits-data.js is up to date.');
  } else {
    fs.writeFileSync(outPath, generated);
    console.log(`credits-data.js written: ${models.length} models, ${sounds.length} sounds`);
  }
}
