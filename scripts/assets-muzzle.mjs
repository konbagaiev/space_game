// assets:muzzle — bake each ship's group-local NOSE and TAIL offsets into its `model:{}` block in
// server/src/catalog_seed.js as `muzzle` / `exhaust`.
//
// WHY. Where a bullet is born is simulation input: `ship-build.fireMount` spawns the projectile at
// `noseZ × the ship's world scale`, so that number decides what the shot can hit. Until now it was
// MEASURED at runtime, in `ship-factory.applyShipModel`, off the .glb once it finished downloading — which
// means a piece of the game's rules was produced by code that needs a WebGL scene graph, and a shot fired
// before the model landed silently used the 1.6 primitive default. Neither is survivable once a headless
// Node authority has to agree with the browser about where bullets come from.
//
// The runtime already prefers an authored value (`muzzle ?? lbox.max.z` in applyShipModel), so baking the
// number is a pure DATA change: the client keeps working and simply stops measuring.
//
// This deliberately does NOT re-run the hitbox fit. It reuses the exported normalization from
// assets-hitboxes.mjs — the same group-local frame the boxes live in — and touches only its own
// marker-delimited span, so `hitBoxes`/`broadR` are left byte-identical. Re-fitting them would risk moving
// every collision box in the game to bake two numbers.
//
// Run after `npm run assets:pull` (the combat glbs are gitignored). `--dry` prints and writes nothing.
// See docs/plans/ship-model-pipeline.md and docs/plans/server-authoritative-sim.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { SHIPS } from '../server/src/catalog_seed.js';
import { gatherMesh, normalize, decodeToPlain } from './assets-hitboxes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SEED = path.join(REPO, 'server/src/catalog_seed.js');
const SHIPS_DIR = path.join(REPO, 'client/assets/ships');
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const DRY = process.argv.includes('--dry');

// NO ROUNDING, on purpose. This number must reproduce what `applyShipModel` measures at runtime as closely
// as the float path allows, because the recorded input traces (the shipped Level-0 intro among them) replay
// the simulation bit-for-bit and a shifted muzzle moves every bullet. Measured for the player ship: runtime
// gives 1.104217184011271, this pipeline gives 1.1042171840112711 — one ULP apart (~2e-16), which is the
// irreducible cost of a Float64 offline pass against a Float32 attribute × Matrix4 pass in the browser.
// Rounding to a "tidy" 1e-6 was tried first and is nine orders of magnitude worse (3.6e-7 world units).
const round = (v) => v;

// Insert/replace our own marker span immediately after `model: {`, leaving any hitboxes span alone.
export function upsertMuzzle(fileText, modelUrl, muzzle, exhaust) {
  const anchor = fileText.indexOf(`modelUrl: '${modelUrl}'`);
  if (anchor < 0) throw new Error(`modelUrl not found in seed: ${modelUrl}`);
  const re = /model\s*:\s*\{/g; // `model:` — not `modelUrl:`/`modelUrlHigh:`
  re.lastIndex = anchor;
  const mm = re.exec(fileText);
  if (!mm) throw new Error(`model:{} block not found after ${modelUrl}`);
  const braceIdx = fileText.indexOf('{', mm.index);
  const span = `/* muzzle:auto:start */ muzzle: ${muzzle}, exhaust: ${exhaust} /* muzzle:auto:end */,`;
  const before = fileText.slice(0, braceIdx);
  const rest = fileText.slice(braceIdx);
  const replaced = rest.replace(
    /^\{[ \t]*(?:\/\* muzzle:auto:start \*\/[\s\S]*?\/\* muzzle:auto:end \*\/,[ \t]*)?/,
    () => `{ ${span} `,
  );
  return before + replaced;
}

async function main() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muzzle-'));
  const original = fs.readFileSync(SEED, 'utf8');
  let text = original;
  const rows = [];

  for (const ship of SHIPS.filter((s) => s.modelUrl)) {
    const file = path.join(SHIPS_DIR, path.basename(ship.modelUrl));
    if (!fs.existsSync(file)) {
      console.error(`\nMissing combat glb: ${file}\nRun \`npm run assets:pull\` first (combat glbs are gitignored).`);
      process.exit(1);
    }
    const yaw = ship.stats?.model?.yaw ?? 0;
    const scaleMul = ship.stats?.model?.scaleMul ?? 1;
    const doc = await decodeToPlain(io, file, tmpDir);
    const raw = { pos: [], idx: [] };
    for (const root of doc.getRoot().listScenes()[0].listChildren()) gatherMesh(root, IDENT, raw);
    const { positions } = normalize(raw.pos, raw.idx, yaw, scaleMul);

    let mnz = Infinity, mxz = -Infinity;
    for (let i = 2; i < positions.length; i += 3) {
      const z = positions[i];
      if (z < mnz) mnz = z;
      if (z > mxz) mxz = z;
    }
    const muzzle = round(mxz), exhaust = round(mnz);
    rows.push({ name: ship.name, muzzle, exhaust, authored: ship.stats?.model?.muzzle ?? null });
    text = upsertMuzzle(text, ship.modelUrl, muzzle, exhaust);
  }

  for (const r of rows) {
    console.log(`${r.name.padEnd(26)} muzzle ${String(r.muzzle).padStart(10)}   exhaust ${String(r.exhaust).padStart(10)}`
      + (r.authored != null ? `   (was authored: ${r.authored})` : ''));
  }
  if (DRY) { console.log('\n--dry: seed not written'); return; }
  if (text === original) { console.log('\nSeed already up to date.'); return; }
  fs.writeFileSync(SEED, text);
  console.log(`\nWrote ${rows.length} muzzle/exhaust pairs into ${path.relative(REPO, SEED)}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
