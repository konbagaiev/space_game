// Duplication audit C5: a level's reward is stated twice in the seed — the cosmetic `lastKillDrop` crate on the
// level, and the real grant in the NEXT level's briefing actions (the briefing is the grant; DECISIONS §169).
// This pins the two together so changing one without the other fails here. Pure — no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from './catalog_seed.js';

// What a briefing action grants, in lastKillDrop's {kind, refId} shape (null for non-granting actions).
const grantOf = (a) => a.type === 'replaceWeapon' ? { kind: 'weapon', refId: a.to }
  : a.type === 'installComponent' ? { kind: 'component', refId: a.component } : null;

test('every level reward drop is granted by the next level\'s briefing', () => {
  const withDrop = LEVELS.filter((l) => l.descriptor.lastKillDrop);
  assert.ok(withDrop.length >= 2, 'level-1 and level-2 carry a reward drop');
  for (const l of withDrop) {
    const next = LEVELS.find((n) => n.id === l.id + 1);
    assert.ok(next && next.descriptor.briefing, `level ${l.id + 1} exists and has a briefing`);
    const grants = (next.descriptor.briefing.actions || []).map(grantOf).filter(Boolean);
    const { kind, refId } = l.descriptor.lastKillDrop;
    assert.ok(grants.some((g) => g.kind === kind && g.refId === refId),
      `level ${l.id} drops ${kind} ${refId}; level ${next.id}'s briefing must grant it (got ${JSON.stringify(grants)})`);
  }
});
