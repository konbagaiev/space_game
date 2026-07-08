// Process a hand-recorded backdrop clip into the committed canonical track.
//
// The in-game ?dev "Backdrop" recorder (window.__backdrop) already re-centers (single fixed offset = the
// player's mean path) and quantizes, then downloads a backdrop-battle.js module. This script finishes the
// job the way we do it by hand: TRIM the low-action tail (a recording that winds down plays as a "lag"
// before the loop restarts), RE-CENTER again (trimming shifts the player's mean, and the runtime guard wants
// slot 0's mean ≈ 0), VALIDATE against the same guards ghost-battle-track.test.js enforces, and install it.
//
// Usage:
//   node client/bench/process-recording.mjs [inputFile] [--out <path>] [--keep-tail] [--name <name>]
//     inputFile   defaults to the newest ~/Downloads/backdrop-battle*.js
//     --out       defaults to client/src/backdrop-battle.js
//     --keep-tail skip the dead-tail trim (install the clip as-is, only re-validate)
//     --name      override the track name field
// After it writes, run:  cd client && node --test   (shape + bounded-formation guards over the new track)
//
// See docs/plans/2026-07-07-1606-backdrop-ghost-battle.md + the /record-backdrop-clip skill.

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');            // client/
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] ?? true) : null; };
const keepTail = args.includes('--keep-tail');
const outPath = flag('--out') || path.join(CLIENT, 'src', 'backdrop-battle.js');
const nameOverride = flag('--name');
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]?.startsWith('--') && args[i - 1] !== '--keep-tail'));

// ---- locate the input file (explicit, or newest ~/Downloads/backdrop-battle*.js) ----
function newestDownload() {
  const dir = path.join(homedir(), 'Downloads');
  const hits = readdirSync(dir).filter((f) => /^backdrop-battle.*\.js$/.test(f))
    .map((f) => path.join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!hits.length) throw new Error(`no backdrop-battle*.js found in ${dir} — record one first (?dev Backdrop panel → Start/Stop)`);
  return hits[0];
}
const inFile = positional[0] || newestDownload();

// ---- load the track (parse the `export const BACKDROP_BATTLE = {...}` module without importing) ----
function loadTrack(file) {
  const src = readFileSync(file, 'utf8');
  const m = src.match(/BACKDROP_BATTLE\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!m) throw new Error(`${file} doesn't look like a backdrop-battle.js module (no BACKDROP_BATTLE export)`);
  return JSON.parse(m[1]);
}
const T = loadTrack(inFile);
const q = T.qPos, F = T.fps, N0 = T.frames;
console.log(`input: ${inFile}\n  ${(N0 / F).toFixed(1)}s / ${N0}f / ${T.ships.length} ships`);

const slotAlive = (s, f) => f >= (s.birth || 0) && f < (s.death < 0 ? T.frames : s.death);

// ---- 1. trim the low-action tail: cut to the last frame with >=2 alive enemies still moving ----
let nf = N0;
if (!keepTail) {
  const w = Math.round(F * 0.5); // ~0.5s motion window
  const enemyMotion = (f) => { let em = 0; for (const s of T.ships.slice(1)) if (slotAlive(s, f)) { const pf = Math.max(0, f - w); em += Math.hypot((s.x[f] - s.x[pf]) / q, (s.z[f] - s.z[pf]) / q); } return em; };
  const aliveEnemies = (f) => T.ships.slice(1).filter((s) => slotAlive(s, f)).length;
  let lf = 0; for (let f = 0; f < N0; f++) if (aliveEnemies(f) >= 2 && enemyMotion(f) > 4) lf = f;
  nf = Math.min(N0, lf + 1);
  if (nf < N0) console.log(`  trimmed dead tail: ${(N0 / F).toFixed(1)}s → ${(nf / F).toFixed(1)}s (cut ${((N0 - nf) / F).toFixed(1)}s)`);
}
// slice ships to nf; drop slots born after the cut; a death past the cut → survives to the end
const kept = [];
for (const s of T.ships) {
  if ((s.birth || 0) >= nf) continue;
  kept.push({ shipName: s.shipName, scale: s.scale ?? 1, birth: s.birth || 0,
    death: (s.death >= 0 && s.death >= nf) ? -1 : s.death,
    x: s.x.slice(0, nf), z: s.z.slice(0, nf), yaw: s.yaw.slice(0, nf) });
}
// slice bullets to nf
const bc = T.bullets.counts.slice(0, nf); const bx = [], bz = [];
{ let off = 0; for (let f = 0; f < N0; f++) { if (f < nf) for (let i = 0; i < T.bullets.counts[f]; i++) { bx.push(T.bullets.x[off + i]); bz.push(T.bullets.z[off + i]); } off += T.bullets.counts[f]; } }

// ---- 2. re-center: subtract slot-0's (player's) mean again in quantized ints (trim shifted it) ----
const s0 = kept[0];
let mx = 0, mz = 0; for (let f = 0; f < nf; f++) { mx += s0.x[f]; mz += s0.z[f]; }
mx = Math.round(mx / nf); mz = Math.round(mz / nf);
for (const s of kept) for (let f = 0; f < nf; f++) { s.x[f] -= mx; s.z[f] -= mz; }
for (let i = 0; i < bx.length; i++) { bx[i] -= mx; bz[i] -= mz; }

const out = { version: 1, name: nameOverride || T.name || 'backdrop', seed: T.seed ?? 0, fps: F, frames: nf,
  qPos: q, qYaw: T.qYaw, ships: kept, bullets: { counts: bc, x: bx, z: bz } };

// ---- 3. validate against the same guards the test suite enforces (fail loudly) ----
const problems = [];
if (kept.length < 1 || kept.length > 16) problems.push(`ship count ${kept.length} out of 1..16`);
let moves = false; for (let f = 1; f < nf; f++) if (s0.x[f] !== s0.x[0] || s0.z[f] !== s0.z[0]) moves = true;
if (!moves) problems.push('slot 0 (player) is CONSTANT — not a fly-free recording (old slot-0-pinned/centroid track?)');
let cx = 0, cz = 0; for (let f = 0; f < nf; f++) { cx += s0.x[f] / q; cz += s0.z[f] / q; } cx /= nf; cz /= nf;
if (Math.hypot(cx, cz) > 1) problems.push(`slot 0 mean (${cx.toFixed(2)},${cz.toFixed(2)}) not ≈ 0`);
let worst = 0; for (const s of kept) { const e = s.death < 0 ? nf : s.death; for (let f = s.birth; f < e; f++) worst = Math.max(worst, Math.hypot(s.x[f] / q, s.z[f] / q)); }
if (worst >= 600) problems.push(`worst live radius ${worst.toFixed(0)}u >= 600u (runaway)`);
for (const s of kept) { if (s.x.length !== nf || s.z.length !== nf || s.yaw.length !== nf) problems.push(`slot '${s.shipName}' array length != frames`);
  if (!(s.birth >= 0 && s.birth <= nf)) problems.push(`slot '${s.shipName}' bad birth ${s.birth}`);
  if (!(s.death === -1 || (s.death >= s.birth && s.death <= nf))) problems.push(`slot '${s.shipName}' bad death ${s.death}`); }
if (bc.length !== nf) problems.push('bullets.counts length != frames');
if (bx.length !== bc.reduce((a, b) => a + b, 0)) problems.push('bullets.x length != sum(counts)');
if (problems.length) { console.error('VALIDATION FAILED:\n  - ' + problems.join('\n  - ')); process.exit(1); }

// ---- 4. write ----
writeFileSync(outPath, `// GENERATED — canonical hand-recorded ghost battle (fixed-offset, tail-trimmed). Do not edit by hand.\n` +
  `// Re-make: record via the ?dev Backdrop panel, then \`node client/bench/process-recording.mjs\` (see /record-backdrop-clip).\n` +
  `export const BACKDROP_BATTLE = ${JSON.stringify(out)};\n`);
console.log(`ok: slot0 flies, mean (${cx.toFixed(2)},${cz.toFixed(2)}), worst ${worst.toFixed(0)}u, ${kept.length} ships, ${(nf / F).toFixed(1)}s`);
console.log(`WROTE ${outPath} (${(statSync(outPath).size / 1024).toFixed(0)} KB)`);
console.log(`\nNext: cd ${path.relative(process.cwd(), CLIENT) || '.'} && node --test   # confirm the shape + bounded-formation guards pass`);
