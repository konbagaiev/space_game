// Material flattening for COMBAT builds (docs/plans/ship-model-pipeline.md).
//
// WHY. A Sketchfab-sourced hero model is split "part x material" — the same material kind is duplicated
// per body part (Body_Chrome / Gun_Chrome / Canopy_Chrome / Thrusters_Chrome ...), each carrying its own
// base/metallic-roughness/normal/occlusion texture set. gltf-transform's `join` can only merge primitives
// that SHARE a material, so the built combat model keeps ONE DRAW CALL PER MATERIAL — 31 for the player
// ship, against 3-5 for every other ship in the game. Per-frame draw-call submit (`js.render`) is the
// measured weak-phone bottleneck (DECISIONS §23), so that one asset dominated the frame.
//
// WHAT. Before `optimize`, replace every material with a flat, untextured one whose baseColor / metallic /
// roughness / emissive are the AVERAGE of that material's own maps (sampled by `npm run assets:materials`
// into `assets-src/<base>.materials.json`). `optimize --palette` then merges all factor-only materials
// into a single palette-textured material and `--join` collapses the mesh to ONE primitive. Averaging
// per material — rather than grouping materials by hand — keeps each surface's own colour, so the ship
// still reads as itself: red engine accents, teal panels, bluish chrome, yellow wing lights.
//
// A ship is ~50px on a top-down screen; 128px paint detail is invisible there, the colour impression is
// not. The HANGAR build never comes through here — it keeps the full textured material set.
//
// Only the JSON chunk is rewritten; the BIN chunk is passed through untouched. Geometry is unchanged, so
// the catalog's generated `model.hitBoxes` / `broadR` stay valid and collision (and the recorded intro
// replay) are unaffected. The now-unreferenced textures/images/samplers are dropped by `optimize --prune`.
import fs from 'node:fs';
import path from 'node:path';

// Sidecar written by scripts/assets-sample-materials.mjs, next to the source model.
export const sidecarPath = (src) => src.replace(/\.glb$/i, '.materials.json');

// Rewrite `input` glb -> `output` glb with materials flattened to sampled factors.
//
// `keepTexturedAbove` is the colour-spread threshold (0-255, the distance from the material's mean colour
// of its most-deviant 5% of texels) above which a material KEEPS its base-colour map. Averaging is only
// lossless for a map that is one colour with shading; a map that paints several different colours onto
// one material — e.g. this ship's red engine nacelles, which live inside an otherwise grey `Thrusters_
// Material` atlas — loses them entirely. Those few materials stay textured; the rest flatten.
// `null` = flatten everything (max performance, minimum fidelity).
// Even for a kept material the normal / metallic-roughness / occlusion maps are dropped and replaced by
// sampled factors: they cost a texture bind and a heavier shader permutation each, and they are invisible
// on a ~50px top-down ship. Only the base colour survives.
//
// Returns { materials, textured, missing } for the build log (`missing` = names absent from the sidecar,
// which keep their own glTF factors — usually a sign the sidecar is stale and should be re-sampled).
export function flattenMaterials(input, output, { keepTexturedAbove = null } = {}) {
  const sc = sidecarPath(input);
  if (!fs.existsSync(sc)) {
    throw new Error(`No material sidecar at ${sc} — run \`npm run assets:materials -- ${path.basename(input, '.glb')}\` first.`);
  }
  const sampled = JSON.parse(fs.readFileSync(sc, 'utf8'));

  const buf = fs.readFileSync(input);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${input}: not a .glb`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  const rest = buf.slice(20 + jsonLen); // BIN chunk (+ any trailing chunks) — passed through untouched

  const missing = [];
  let textured = 0;
  json.materials = (json.materials || []).map((m) => {
    const s = sampled[m.name];
    if (!s) missing.push(m.name);
    const pbr = m.pbrMetallicRoughness || {};
    const keep = s && keepTexturedAbove !== null && (s.spread ?? 0) >= keepTexturedAbove && pbr.baseColorTexture;
    if (keep) textured++;
    const out = {
      name: m.name,
      doubleSided: !!m.doubleSided,
      alphaMode: m.alphaMode || 'OPAQUE',
      pbrMetallicRoughness: {
        // A kept material kicks its baseColorFactor to white so the map shows through unmodulated.
        baseColorFactor: keep ? [1, 1, 1, 1] : (s ? [...s.color, 1] : (pbr.baseColorFactor || [1, 1, 1, 1])),
        metallicFactor: s ? s.metal : (pbr.metallicFactor ?? 1),
        roughnessFactor: s ? s.rough : (pbr.roughnessFactor ?? 1),
        ...(keep ? { baseColorTexture: pbr.baseColorTexture } : {}),
      },
    };
    // Only carry emissive when the sampled emissive map actually lights up — the source sets an
    // emissiveFactor of 1,1,1 on several materials whose glow lives entirely in the (now dropped) map,
    // which would otherwise turn the whole part into a white light.
    if (s?.emissive) out.emissiveFactor = s.emissive;
    return out;
  });

  // Pad the JSON chunk to a 4-byte boundary with spaces, per the glB spec.
  let jsonOut = Buffer.from(JSON.stringify(json), 'utf8');
  if (jsonOut.length % 4) jsonOut = Buffer.concat([jsonOut, Buffer.alloc(4 - (jsonOut.length % 4), 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonOut.length + rest.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonOut.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  fs.writeFileSync(output, Buffer.concat([header, jsonHeader, jsonOut, rest]));
  return { materials: json.materials.length, textured, missing };
}
