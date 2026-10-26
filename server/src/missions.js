// Side-mission generator (docs/plans/mission-generator.md, phase 2a).
//
// A "mission" is just a level-style descriptor played by the SAME client `levelRunner` as the campaign
// — no new runtime. The board offers THREE flavored side missions, all the SAME difficulty
// (docs/plans/mission-enemies-difficulty.md): they differ only by flavor text, not mechanics. Clearing
// one banks its per-kill ×2 credits like a level (server-sealed rewards are a later integrity item) and
// does NOT advance the story counter (`current_progress`) — pure repeatable grind content.

import { enemyTotalFromPhases } from './enemy_total.js';
// The ship catalog, for the card's reward estimate (no cycle: catalog_seed.js imports only enemy_total.js
// and client/src/sim-core modules).
import { SHIPS } from './catalog_seed.js';
// The fixed world anchors: each side mission fights at its host object's anchor (the single source of the
// coordinates — see FLAVORS below).
import { ANCHORS } from '../../client/src/sim-core/system-map.js';

// Enemy ship names (must match SHIPS in catalog_seed.js).
const GUNNER = 'pirate gunner', ROCKETEER = 'basic rocket pirate', HEAVY = 'pirate mini boss', BOSS = 'first pirate boss';

// The shared wave script for every side mission (same composition / difficulty for all three).
function sideMissionPhases() {
  return [
    { name: 'wave-1', // 40% gunner / 40% rocketeer / 20% heavy until 7 kills
      spawn: { maxConcurrent: 4, total: 7, pool: [
        { ship: GUNNER, chance: 40 }, { ship: ROCKETEER, chance: 40 }, { ship: HEAVY, chance: 20 }] },
      advanceWhen: { kills: 7 } },
    { name: 'wave-2', // 35 / 35 / 30 until 14 cumulative kills ("another 7")
      spawn: { maxConcurrent: 4, total: 7, pool: [
        { ship: GUNNER, chance: 35 }, { ship: ROCKETEER, chance: 35 }, { ship: HEAVY, chance: 30 }] },
      advanceWhen: { kills: 14 } },
    { name: 'clear-out', // deterministic final wave before the bosses (carries the old "carry" count)
      spawn: { maxConcurrent: 4, total: 4, pool: [
        { ship: GUNNER, chance: 35 }, { ship: ROCKETEER, chance: 35 }, { ship: HEAVY, chance: 30 }] },
      advanceWhen: { allCleared: true } },
    { name: 'bosses', // a 2-boss finale (the upgraded "first boss")
      spawn: { maxConcurrent: 4, total: 2, pool: [{ ship: BOSS, chance: 1 }] },
      advanceWhen: { allCleared: true } },
    { name: 'victory', event: 'win', delay: 5, textKey: 'mission.victory', text: 'Mission complete — sector secured, Sentinel!' },
  ];
}

// Expected credits/XP of one full run, from the phases and the ship catalog — never restated by hand, so a
// rebalance of any enemy's reward/xp moves the card with it. Each phase contributes
// `total × Σ(chance·value) / Σchance` (kept in that order so the sum stays exact — today 1752.5 — and the
// card rounds the same way every time). Per-kill credit/XP read exactly like the live entity does
// (ship-entity.js makeEnemyShell: `reward || 0`, `xp || 0`). Assumes the player lands every kill (an ally
// kill pays nothing) and ignores loot resale: it is an "≈".
export function expectedRun(phases, ships = SHIPS) {
  let credits = 0, xp = 0;
  for (const ph of phases) {
    const sp = ph.spawn; if (!sp) continue;
    let w = 0, c = 0, x = 0;
    for (const p of sp.pool) {
      const s = ships.find((r) => r.name === p.ship);
      if (!s) throw new Error(`missions: pool ship "${p.ship}" is not in the catalog`); // fail loudly
      w += p.chance; c += p.chance * (s.stats.reward || 0); x += p.chance * (s.stats.xp || 0);
    }
    credits += (sp.total * c) / w;
    xp += (sp.total * x) / w;
  }
  return { credits, xp };
}
export const round10 = (n) => Math.round(n / 10) * 10;

// One-shot XP bonus banked on clearing any side mission (character progression), on top of the per-kill
// XP the client sums from each enemy's `xp`. Flat 1000 for all three flavors (same difficulty). The card's
// "XP ≈" INCLUDES both: expected per-kill XP + this bonus. Its "Reward ≈" is the expected per-kill credits
// ×2 (clearing a mission doubles the credits — level-runner.js; the XP is not doubled).
const MISSION_XP = 1000;

// The three flavors — same difficulty, different framing (i18n keyed; descriptions in the client catalog).
// `center` is the combat zone's location in the shared world (x,z) — it IS the host object's anchor, read
// from `ANCHORS` (client/src/sim-core/system-map.js), so it is never restated here. The other sides of the
// invariant are pinned by tests: the `home-system` set-piece matches the anchor (system-map.test.js; the
// freighter renders +50 z ahead of its anchor, the one deliberate framing offset), and the anchor is a roam
// activity-zone centre and the mission's host object on the map (missions.test.js).
// (left = -x, right = +x, "up"/north = -z.) Fields are copied so a descriptor can never mutate an anchor.
const FLAVORS = [
  { type: 'mining',    titleKey: 'mission.mining.title',    descKey: 'mission.mining.desc',    center: { x: ANCHORS.mining.x, z: ANCHORS.mining.z } },
  { type: 'research',  titleKey: 'mission.research.title',  descKey: 'mission.research.desc',  center: { x: ANCHORS.science.x, z: ANCHORS.science.z } },
  { type: 'freighter', titleKey: 'mission.freighter.title', descKey: 'mission.freighter.desc', center: { x: ANCHORS.freighter.x, z: ANCHORS.freighter.z } },
];

// The currently-offered side missions. Stateless for 2a (the three flavors are fixed); each carries a
// full descriptor the client plays directly. `sideMission: true` tells the client to bank-without-advance.
// ONE shared world (map `home-system` holds all the set-pieces at fixed positions); a mission only changes
// WHERE you fight — its `center` spawns the player + arena over the matching structure; the others are at
// a distance. Where each centre comes from is explained on FLAVORS above.
export function generateMissions() {
  const phases = sideMissionPhases();
  const enemyTotal = enemyTotalFromPhases(phases);
  const run = expectedRun(phases);
  const estReward = round10(run.credits * 2), estXp = round10(run.xp + MISSION_XP);
  return FLAVORS.map((f) => ({
    id: `side-${f.type}`,
    type: f.type,
    titleKey: f.titleKey,
    descKey: f.descKey,
    estReward,
    estXp,
    descriptor: {
      title: f.type, map: 'home-system', sideMission: true, xpReward: MISSION_XP,
      // Same rule as every campaign level: the reward is granted when the arena is empty, not at the dock
      // (DECISIONS §130). Stated here so the descriptor a room or a referee is handed is self-contained.
      winCondition: { type: 'allEnemiesDead' },
      center: f.center, drift: f.drift || null,
      phases,
      enemyTotal,
    },
  }));
}
