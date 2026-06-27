// assets:recolor — produce the `enemy_*_orange` source glbs from the red `enemy_*` sources by
// recoloring the pack's RED materials to a single target orange, preserving each material's relative
// brightness. Black/gray materials are left untouched.
//
// How it works: each "red" material (baseColorFactor with G≈0, B≈0, R>0 in LINEAR space — i.e. a pure
// red of some brightness) is rewritten to `targetOrange_linear * R_original`. The pack's main red is
// pure #ff0000 (R_linear = 1) so it gets the FULL target orange; darker reds (e.g. #c40000) get a
// proportionally darker orange. This keeps the model's light/dark shading while shifting the hue.
//
// Reproducible: re-run with a new TARGET to re-tint. Source of truth for the enemy tint. After this,
// run `npm run assets:build enemy_1_orange enemy_2_orange enemy_3_orange enemy_4_orange` to rebuild the
// combat/hangar glbs. See docs/plans/ship-model-pipeline.md. Run: `npm run assets:recolor`.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { DIR } from './assets-config.mjs';

// Target enemy tint (sRGB hex). Bump this to re-tint the whole enemy_*_orange set.
const TARGET = '#f4741f';
// Which red sources to recolor → `<base>_orange.glb`.
const BASES = ['enemy_1', 'enemy_2', 'enemy_3', 'enemy_4'];

const EPS = 1e-3; // treat tiny channel values as zero (sources use exact 0, but be float-safe)
const s2l = (s) => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)); // sRGB → linear
const hexToLinear = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [s2l(((n >> 16) & 255) / 255), s2l(((n >> 8) & 255) / 255), s2l((n & 255) / 255)];
};

async function main() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const orange = hexToLinear(TARGET);
  console.log(`[recolor] target ${TARGET} → linear [${orange.map((x) => x.toFixed(4)).join(', ')}]`);

  for (const base of BASES) {
    const input = path.join(DIR.src, `${base}.glb`);
    const output = path.join(DIR.src, `${base}_orange.glb`);
    if (!fs.existsSync(input)) { console.error(`  missing source ${input}`); process.exit(1); }
    const doc = await io.read(input);
    let n = 0;
    for (const m of doc.getRoot().listMaterials()) {
      const c = m.getBaseColorFactor(); // [r,g,b,a] LINEAR
      const isRed = c[0] > EPS && c[1] < EPS && c[2] < EPS; // pure red of some brightness
      if (!isRed) continue;
      const s = c[0]; // original red brightness (pure #ff0000 → 1.0 → full target)
      m.setBaseColorFactor([orange[0] * s, orange[1] * s, orange[2] * s, c[3]]);
      n++;
    }
    await io.write(output, doc);
    console.log(`  ${base}.glb → ${path.basename(output)}  (${n} red material${n === 1 ? '' : 's'} recolored)`);
  }
  console.log(`\nNext: npm run assets:build ${BASES.map((b) => `${b}_orange`).join(' ')}`);
}

main();
