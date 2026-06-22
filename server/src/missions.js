// Side-mission generator (docs/plans/mission-generator.md, phase 2a).
//
// A "mission" is just a level-style descriptor played by the SAME client `levelRunner` as the campaign
// — no new runtime. The board offers THREE flavored side missions, all the SAME difficulty
// (docs/plans/mission-enemies-difficulty.md): they differ only by flavor text, not mechanics. Clearing
// one banks its per-kill ×2 credits like a level (server-sealed rewards are a later integrity item) and
// does NOT advance the story counter (`current_progress`) — pure repeatable grind content.

// Enemy ship names (must match SHIPS in catalog_seed.js).
const GUNNER = 'pirate gunner', ROCKETEER = 'basic rocket enemy', HEAVY = 'basic mini boss', BOSS = 'first boss';

// The shared wave script for every side mission (same composition / difficulty for all three).
function sideMissionPhases() {
  return [
    { name: 'wave-1', // 40% gunner / 40% rocketeer / 20% heavy until 7 kills
      spawn: { maxConcurrent: 4, pool: [
        { ship: GUNNER, chance: 40 }, { ship: ROCKETEER, chance: 40 }, { ship: HEAVY, chance: 20 }] },
      advanceWhen: { kills: 7 } },
    { name: 'wave-2', // 35 / 35 / 30 until 14 cumulative kills ("another 7")
      spawn: { maxConcurrent: 4, pool: [
        { ship: GUNNER, chance: 35 }, { ship: ROCKETEER, chance: 35 }, { ship: HEAVY, chance: 30 }] },
      advanceWhen: { kills: 14 } },
    { name: 'clear-out', spawn: null, advanceWhen: { allCleared: true } },
    { name: 'bosses', // a 2-boss finale (the upgraded "first boss")
      spawn: { maxConcurrent: 4, total: 2, pool: [{ ship: BOSS, chance: 1 }] },
      advanceWhen: { allCleared: true } },
    { name: 'victory', event: 'win', delay: 5, textKey: 'mission.victory', text: 'Mission complete — sector secured, Sentinel!' },
  ];
}

// Rough est. reward shown on the card (per-kill ×2, doubled on victory): ~14 wave kills at a mixed
// average + a 2-boss finale. The actual payout is whatever the player earns; this is just a hint.
const WAVE_KILLS = 14, WAVE_AVG = 0.37 * 40 + 0.37 * 40 + 0.26 * 100; // gunner/rocketeer/heavy mix ≈ 56
const EST_REWARD = Math.round(((WAVE_KILLS * WAVE_AVG + 2 * 200) * 2) / 10) * 10; // ×2 victory bonus, rounded

// The three flavors — same difficulty, different framing (i18n keyed; descriptions in the client catalog).
// `center` is the combat zone's location in the shared world (x,z); it matches the mission's set-piece
// position in catalog_seed.js so each mission fights over its own structure, away from the campaign (0,0).
// (left = -x, right = +x, "up"/north = -z.)
const FLAVORS = [
  { type: 'mining',    titleKey: 'mission.mining.title',    descKey: 'mission.mining.desc',    center: { x: -500, z: 0 } },
  { type: 'research',  titleKey: 'mission.research.title',  descKey: 'mission.research.desc',  center: { x: 350, z: 0 } },
  { type: 'freighter', titleKey: 'mission.freighter.title', descKey: 'mission.freighter.desc', center: { x: -100, z: -400 } },
];

// The currently-offered side missions. Stateless for 2a (the three flavors are fixed); each carries a
// full descriptor the client plays directly. `sideMission: true` tells the client to bank-without-advance.
// ONE shared world (map `home-system` holds all the set-pieces at fixed positions); a mission only changes
// WHERE you fight — its `center` spawns the player + arena over the matching structure; the others are at
// a distance. The mission centers match the set-piece positions in catalog_seed.js's `home-system`.
export function generateMissions() {
  return FLAVORS.map((f) => ({
    id: `side-${f.type}`,
    type: f.type,
    titleKey: f.titleKey,
    descKey: f.descKey,
    estReward: EST_REWARD,
    descriptor: {
      title: f.type, map: 'home-system', sideMission: true,
      center: f.center, drift: f.drift || null,
      phases: sideMissionPhases(),
    },
  }));
}
