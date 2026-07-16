// assets:build — from each high-poly source in assets-src/, emit TWO content-hashed glbs into
// assets-dist/: a `combat` (aggressively simplified + compressed → KB-scale, served same-origin) and a
// `hangar` (optimized high-poly → CloudFront, lazy-loaded). Uses gltf-transform via npx (no hard dep).
// Prints the resulting filenames + the `modelUrl` / `modelUrlHigh` to paste into catalog_seed.js.
//
// Generation stays LOCAL (needs the source models + human judgment on decimation). See
// docs/plans/ship-model-pipeline.md. Run: `npm run assets:build`.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DIR, presetFor, combatPath, hangarUrl } from './assets-config.mjs';

const GLTF = ['--yes', '@gltf-transform/cli@^4']; // npx package (downloaded on first use)

const sh = (args) => execFileSync('npx', args, { stdio: ['ignore', 'pipe', 'inherit'] });
const hash8 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);

function optimize(input, output, p) {
  // gltf-transform `optimize`: dedup/weld + optional mesh simplification + geometry + texture compression.
  // `compress`/`textureCompress` can be false to keep plain (uncompressed) geometry/textures.
  sh([...GLTF, 'optimize', input, output,
    '--compress', String(p.compress),                  // 'meshopt' | false
    '--texture-compress', String(p.textureCompress),    // 'webp' | false (keep original format)
    '--texture-size', String(p.textureSize),
    '--instance', String(p.instance ?? true),           // EXT_mesh_gpu_instancing
    // `optimize` prunes textures it deems single-color by default; low-contrast rock/asteroid diffuse maps
    // can trip that heuristic and get baked to a flat baseColorFactor (losing all surface detail). Let a
    // preset opt out with `pruneSolidTextures: false`.
    '--prune-solid-textures', String(p.pruneSolidTextures ?? true),
    '--simplify', p.simplifyRatio < 1 ? 'true' : 'false',
    ...(p.simplifyRatio < 1 ? ['--simplify-error', String(p.simplifyError)] : []),
  ]);
}

// content-hash the output and rename to <base>.<hash>.glb (hash = version → caches forever, no invalidation)
function hashRename(file, base, dir) {
  const out = path.join(dir, `${base}.${hash8(file)}.glb`);
  fs.renameSync(file, out);
  return path.basename(out);
}

function main() {
  if (!fs.existsSync(DIR.src)) { console.error(`No ${DIR.src}/ — drop high-poly source .glb files there first.`); process.exit(1); }
  fs.mkdirSync(DIR.dist, { recursive: true });
  // Optional CLI args = base names (with or without .glb) to build a subset; default = all sources.
  const only = process.argv.slice(2).map((a) => a.replace(/\.glb$/i, ''));
  let sources = fs.readdirSync(DIR.src).filter((f) => f.toLowerCase().endsWith('.glb'));
  if (only.length) sources = sources.filter((f) => only.includes(path.basename(f, '.glb')));
  if (!sources.length) { console.error(`No matching .glb files in ${DIR.src}/${only.length ? ` for [${only.join(', ')}]` : ''}.`); process.exit(1); }

  const rows = [];
  for (const src of sources) {
    const base = path.basename(src, path.extname(src));
    const input = path.join(DIR.src, src);
    const tmpCombat = path.join(DIR.dist, `${base}_combat.tmp.glb`);
    const tmpHangar = path.join(DIR.dist, `${base}_hangar.tmp.glb`);
    console.log(`\n[build] ${src}`);
    optimize(input, tmpCombat, presetFor(base, 'combat')); // base preset + any per-model override
    optimize(input, tmpHangar, presetFor(base, 'hangar'));
    const combatFile = hashRename(tmpCombat, `${base}_combat`, DIR.dist);
    const hangarFile = hashRename(tmpHangar, `${base}_hangar`, DIR.dist);
    const kb = (f) => Math.round(fs.statSync(path.join(DIR.dist, f)).size / 1024);
    console.log(`  combat → ${combatFile} (${kb(combatFile)} KB)   hangar → ${hangarFile} (${kb(hangarFile)} KB)`);
    rows.push({ base, combatFile, hangarFile });
  }

  console.log('\nPaste into catalog_seed.js (per ship):');
  for (const r of rows) {
    console.log(`  // ${r.base}`);
    console.log(`  modelUrl: '${combatPath(r.combatFile)}', modelUrlHigh: '${hangarUrl(r.hangarFile)}',`);
  }
  console.log(`\nNext: 'npm run assets:push' to upload ${DIR.dist}/ + sources to S3, then commit catalog_seed.js.`);
}

main();
