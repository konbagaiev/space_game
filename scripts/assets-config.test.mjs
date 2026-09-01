// Unit tests for the asset-pipeline preset table (scripts/assets-config.mjs) and its honesty guard.
//
// The bug these pin: gltf-transform's `optimize` performs its texture RESIZE inside the textureCompress
// stage, so `--texture-size N --texture-compress false` keeps the SOURCE resolution and says nothing. The
// combat preset carried `textureSize: 256` under `textureCompress: false` for its whole life, which is how
// the base station shipped four 1024² PNGs (21.3 MiB of VRAM) under a preset that read 256.
// Run: `npm test` at the repo root (`node --test scripts/`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESET, PRESET_OVERRIDES, presetFor, checkPreset } from './assets-config.mjs';

test('every shipped preset x override is honest (no textureSize under textureCompress:false)', () => {
  // A base name with no override exercises the bare PRESET entries too.
  const bases = [...Object.keys(PRESET_OVERRIDES), '__no_override_sentinel__'];
  for (const kind of Object.keys(PRESET)) {
    for (const base of bases) {
      const p = presetFor(base, kind);
      assert.doesNotThrow(() => checkPreset(p, `${base}/${kind}`), `${base}/${kind} is a silent no-op preset`);
    }
  }
});

test('checkPreset throws on the half-configured combination', () => {
  assert.throws(() => checkPreset({ textureSize: 256, textureCompress: false }), /silent no-op/i);
  // …and names the offender, so a build failure is actionable.
  assert.throws(() => checkPreset({ textureSize: 128, textureCompress: false }, 'thing.glb'), /thing\.glb/);
});

test('checkPreset allows the legitimate keep-the-source-textures case', () => {
  // Most combat models: no resize asked for, textures pass through untouched. Must NOT throw.
  assert.doesNotThrow(() => checkPreset({ textureCompress: false }));
  assert.doesNotThrow(() => checkPreset({ textureSize: 256, textureCompress: 'webp' }));
  assert.doesNotThrow(() => checkPreset(undefined));
});

test('PRESET.combat has no default textureSize (the fix, pinned against a well-meaning re-add)', () => {
  assert.equal('textureSize' in PRESET.combat, false,
    'PRESET.combat must not carry a textureSize: it is a no-op under textureCompress:false. '
    + 'Opt in per model via PRESET_OVERRIDES with textureCompress AND textureSize together.');
  assert.equal(PRESET.combat.textureCompress, false);
});

test('base_station combat preset keeps FULL resolution, compresses to WebP, and keeps its emissive map', () => {
  assert.deepEqual(presetFor('base_station', 'combat'), {
    simplifyRatio: 0.2,
    simplifyError: 0.04,
    compress: 'meshopt',
    instance: false,
    // 1024, NOT a shrink: texture size was measured to move fps by nothing (DECISIONS §140 amendment), so
    // shrinking would buy only VRAM, and 256 visibly smears the solar-panel grid the player docks against.
    // The override exists for `textureCompress` — the source's PNGs shipped verbatim at 1.55 MB without it.
    textureSize: 1024,
    textureCompress: 'webp',
    pruneSolidTextures: false, // the emissive map is ~99.5% black — the solid-texture pruner would flatten it
  });
});
