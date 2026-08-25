// Every `type: 'beam'` row is COMPLETE, and no seeded ship ever puts a beam in a shared fire group.
//
// WHY THESE TWO GUARDS, and why they are not optional.
//
// (1) A beam reads FIVE numbers off its own row every tick — `maxRange`, `chargeTime`, `corridorDeg`,
//     `fireCooldown` and `power` (`client/src/sim-core/beam.js`). That is deliberate: two ships must be
//     able to carry differently-tuned beams, which is why there is no shared tuning object to fall back on.
//     The cost of that choice is that a row missing a field does not throw — it quietly falls back to a
//     default, or to `undefined`, and the weapon becomes a subtly different gun. So the row is checked here.
//
// (2) `isBeamGroup` uses `some`, so a group holding a beam takes the BEAM path — and every other mount in
//     that group goes silent, because `fireMount` never runs for it. That is the right failure direction
//     (a beam must never fall through to the bullet path), but it means a MIXED group is a trap. It is
//     reachable: `equipItem` replaces the FIRST mount of the target group (`db.js`), so a future player
//     ship with two `gun` mounts would end up with a beam in one and a kinetic in the other. No ship has
//     two mounts in one group today, and this test is what keeps it that way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, SHIPS, SOUNDS, SOUND_MAP } from './catalog_seed.js';

const beams = WEAPONS.filter((w) => w.type === 'beam');

test('there is a beam in the catalog to check (a seed edit must not silently empty this guard)', () => {
  assert.ok(beams.length >= 1, `expected at least one type:'beam' weapon, found ${beams.length}`);
});

for (const w of beams) {
  test(`${w.name}: carries every stat a beam is simulated from`, () => {
    const s = w.stats || {};
    for (const field of ['power', 'maxRange', 'chargeTime', 'corridorDeg', 'fireCooldown', 'weight']) {
      assert.equal(typeof s[field], 'number', `${w.name} has no numeric \`${field}\``);
      assert.ok(s[field] > 0, `${w.name}.${field} must be positive (got ${s[field]})`);
    }
    assert.equal(typeof s.class, 'string', `${w.name} has no sound/FX \`class\` — its SFX would not route`);
    // corridorDeg is a HALF-angle in DEGREES, not radians and not a full width. A radian value slipped in
    // here would read as a corridor 57× too wide and nothing would throw.
    assert.ok(s.corridorDeg > 0 && s.corridorDeg <= 45,
      `${w.name}.corridorDeg is a half-angle in DEGREES (got ${s.corridorDeg})`);
  });

  test(`${w.name}: its sound class routes BOTH a charge and a fire sample`, () => {
    for (const event of ['charge', 'fire']) {
      const row = SOUND_MAP.find((m) => m.entity === 'weapon' && m.class === w.stats.class && m.event === event);
      assert.ok(row, `no sound_map row for (weapon, ${w.stats.class}, ${event})`);
      assert.ok(SOUNDS.find((s) => s.key === row.sound), `sound_map points at '${row.sound}', which is not in SOUNDS`);
    }
  });
}

test('NO seeded ship puts a beam in a fire group with any other mount', () => {
  const beamGroups = [];
  const beamIds = new Set(beams.map((w) => w.id));
  for (const ship of SHIPS) {
    const s = ship.stats || {};
    const mounts = Array.isArray(s.mounts) ? s.mounts : [];
    for (const groupName of Object.keys(s.groups || {})) {
      const gm = mounts.filter((m) => m.group === groupName);
      if (!gm.some((m) => beamIds.has(m.weapon))) continue;
      beamGroups.push(`${ship.name}/${groupName}`);
      assert.equal(gm.length, 1,
        `${ship.name}'s '${groupName}' group holds a beam AND ${gm.length - 1} other mount(s) — the other `
        + 'mounts would go silent, because a beam group never reaches fireMount');
    }
  }
  // EXACTLY ONE seeded ship carries a beam: the pirate lancer, the worked example of the right way to arm
  // an enemy with one — its OWN single-mount group, not a weapon id swapped onto an existing pirate
  // (DECISIONS §135). The player's own beam is a hangar PURCHASE and so appears on no seeded ship row.
  // Update this list deliberately, never to make a failure go away.
  assert.deepEqual(beamGroups.sort(), ['pirate lancer/gun']);
});

test('no PLAYER ship has two mounts in one fire group — the hangar\'s mixed-group trap has no foothold', () => {
  // This is the half of the trap that is reachable through the SHOP: `equipItem` replaces the FIRST mount
  // of the target group, so a player ship with two `gun` mounts would end up with a beam in one and a
  // kinetic in the other — and the kinetic would go silent. Restricted to player ships on purpose: several
  // BOSSES do carry multi-mount groups (twin guns / rocket pods, the staggered-volley feature), and that is
  // a real constraint on how an ENEMY may be armed with a beam rather than a defect — see the next test.
  for (const ship of SHIPS.filter((s) => s.type === 'player')) {
    const s = ship.stats || {};
    const mounts = Array.isArray(s.mounts) ? s.mounts : [];
    for (const groupName of Object.keys(s.groups || {})) {
      const gm = mounts.filter((m) => m.group === groupName);
      assert.ok(gm.length <= 1,
        `${ship.name}'s '${groupName}' group has ${gm.length} mounts — installing a beam into it (equipItem `
        + 'replaces the FIRST mount) would silence the rest');
    }
  }
});

test('the enemy ships that DO carry multi-mount groups are known, and none of them is a beam', () => {
  // Documented rather than forbidden. Four bosses/mediums fire twin guns or rocket pods out of ONE group,
  // which is exactly what a beam may never share: `isBeamGroup` uses `some`, so a beam dropped into one of
  // these groups would take the beam path and silence its twin. THIS IS WHY THE PIRATE LANCER IS A NEW SHIP
  // (DECISIONS §135): arming an enemy with a beam means giving it its OWN single-mount group, not swapping a
  // weapon id onto one of these. The first test above is the guard that fires if anyone does it the cheap way.
  const beamIds = new Set(beams.map((w) => w.id));
  const multi = [];
  for (const ship of SHIPS) {
    const s = ship.stats || {};
    const mounts = Array.isArray(s.mounts) ? s.mounts : [];
    for (const groupName of Object.keys(s.groups || {})) {
      const gm = mounts.filter((m) => m.group === groupName);
      if (gm.length > 1) {
        multi.push(`${ship.name}/${groupName}`);
        assert.ok(!gm.some((m) => beamIds.has(m.weapon)),
          `${ship.name}'s '${groupName}' group is multi-mount AND holds a beam — the other mounts are silent`);
      }
    }
  }
  assert.deepEqual(multi.sort(), [
    'advanced medium pirate/rocket',
    'first pirate boss/gun',
    'first pirate boss/rocket',
    'pirate mini boss/rocket',
    'second pirate boss/gun',
    'second pirate boss/rocket',
  ], 'the multi-mount groups in the catalog — update this list deliberately, never to make a failure go away');
});
