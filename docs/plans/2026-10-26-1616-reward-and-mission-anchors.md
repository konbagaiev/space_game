# Level reward and mission location as single sources (duplication audit C5, C6)

**Date:** 2026-10-26. **Run:** `2026-10-26-1616-reward-and-mission-anchors`. **Size:** S.
**Parent:** Phase 3 of [`2026-10-24-duplication-audit-closeout.md`](2026-10-24-duplication-audit-closeout.md);
evidence in [`2026-10-20-duplication-audit.md`](2026-10-20-duplication-audit.md) rows C5, C6.

## Goal

Two "the same fact written in several places" items from the duplication audit.

**C5.** A level's reward is stated three times: the cosmetic `lastKillDrop` on the level, the real grant in the
NEXT level's briefing actions, and the ownership check `rewardOwned` that decides whether the cosmetic crate
appears. The ownership check is also wrong in general: for any component reward it asks "is the repair slot
filled?" (`comps.repair != null`), which is only accidentally right for today's single component reward (Repair
drone, id 12) and wrong for a player who has Repair drone II / Nanobot repair equipped. After this change a
component reward is owned **iff some equipped component has exactly that id, or it is in the stash** — the same
rule weapons already use — and a server test pins that each `lastKillDrop` matches the next level's briefing grant.

**C6.** The side-mission centres in `server/src/missions.js` restate the coordinates of `ANCHORS` in
`client/src/sim-core/system-map.js`. After this change `missions.js` reads its centres from `ANCHORS`, and a
server test pins that each generated mission's `center` equals its host object's `pos` and is one of the roam
activity-zone centres.

User-visible effect: none for an ordinary playthrough. The only visible change is the edge case in Decision 1.

## Decisions (all settled — do not re-ask)

1. **Component ownership = exact id (maintainer, 2026-10-26; record as DECISIONS §169).** A component reward is
   owned iff `Object.values(components)` contains `reward.refId`, or the stash holds `{kind:'component', refId}`.
   No catalog lookup, no new field on `lastKillDrop`, **no signature change** to `rewardOwned` /
   `ownsReward` (both hosts' callers stay as they are). Consequences to write down in §169:
   - A player with Repair drone II (19) or Nanobot repair (20) equipped and without drone 12 in the stash now
     sees the cosmetic Level 2 reward crate (before: no crate). This is reachable: the shop opens on the Level 2
     briefing (`unlockShop`, `catalog_seed.js:807`), before the Level 2 fight.
   - The reward branch draws no random number; the fallback loot branch draws `simRandom()`
     (`client/src/sim-core/step-enemies.js:171-178`). So a flipped ownership answer changes the RNG draw count on
     the last kill. An old **level-2** trace recorded in that state (19/20 equipped, 12 not owned) may replay
     differently from the last kill on. Playback already reads ownership from the *viewer's* account, and
     §166 accepted that a differing reward drop in playback does not matter (SUMMARY, Replay section, "a reward
     drop differing in playback does not matter"). Say so in §169; no trace version bump.
   - Alternatives rejected in §169: (a) look up the reward's slot from the catalog (needs the catalog at both
     call sites; keeps "slot filled" semantics, which is the wrong question); (b) stamp `slot` on the
     `lastKillDrop` record (a fourth copy of "component 12 is a repair part", next to the catalog row
     `catalog_seed.js:89`, the briefing action's `slot: 'repair'` at `:862`, and the check itself).
2. **Briefing actions stay the real grant** (closeout brief). Guard agreement with a server test instead of
   generating the action from the drop.
3. **Agreement rule:** for every level `L` in `LEVELS` with a `lastKillDrop`, the level with `id === L.id + 1`
   exists, has a briefing, and its actions grant exactly `{kind, refId}` — `replaceWeapon.to` for a weapon,
   `installComponent.component` for a component. One direction only (a briefing grant without a preceding drop
   is allowed).
4. **Freighter offset — the brief was imprecise, corrected here.** The +50 z offset is between
   `ANCHORS.freighter` (-100,-950) and the `freighter` **set-piece** `pos [-100,-48,-900]`
   (`catalog_seed.js:1106`); it is already pinned by `client/src/sim-core/system-map.test.js:317-340`
   (`freighter: ['freighter', 0, 50]`). The mission **centre** equals the anchor exactly. So all three centres are
   plain anchor reads, and the new guard asserts **exact** equality for all three — no offset term.
5. **Finding: a briefing install destroys a bought component — NOT fixed here.** `installActiveShipComponent`
   (`server/src/db.js:720-729`) overwrites `components[slot]` without stashing the previous part (unlike
   `replaceActiveShipWeapon` at `db.js:698-710`, which deposits the removed weapon). Record it in a new
   follow-ups file (Step 5); do not change `db.js`.

## Steps

Line numbers verified on `main` @ `8a0dd13`; they drift — re-read before editing.

### Step 1 — `rewardOwned` component branch (C5)

`client/src/sim-core/drops-config.js`, `rewardOwned` (around line 42). Replace the component branch:

```js
  if (reward.kind === 'component') {
    const comps = as.components || (as.ship && as.ship.components) || {};
    return Object.values(comps).some((id) => id === reward.refId); // exactly this part, in any slot
  }
```

Keep the `as.components || as.ship.components` fallback exactly as is. Update the function's header comment
("a component reward (the L2 repair drone) is owned if the repair slot is filled (any repair component)") to:
"a component reward is owned if any slot holds exactly that component id (DECISIONS §169)". Leave the stash
branch and the weapon branch untouched. Callers (`client/src/sim-core/drops-sim.js:18` → `step-enemies.js:171`;
`client/src/drops.js:240` → `client/src/sim.js:497`) are unchanged.

Ids compare with `===`: component ids in `components` JSONB and in the seed are numbers
(`server/src/server.test.js:1151` already pins that for stash refs). If a value in `components` could be a
string on some path, the test in Step 3 will show it; do not add coercion speculatively.

### Step 2 — `missions.js` reads `ANCHORS` (C6)

`server/src/missions.js`:
- Add `import { ANCHORS } from '../../client/src/sim-core/system-map.js';` next to the other imports (server
  already imports client `sim-core` via `catalog_seed.js`; `node` loads `system-map.js` from `server/` fine —
  verified).
- `FLAVORS` (around line 81): `center: { x: ANCHORS.mining.x, z: ANCHORS.mining.z }`, likewise
  `ANCHORS.science` for `research` and `ANCHORS.freighter` for `freighter`. Copy the two fields rather than
  sharing the `ANCHORS` object, so a descriptor can never mutate the anchor.
- Rewrite the "FOUR-WAY INVARIANT" comment block (around lines 69-80) shorter: the centre IS the anchor (read
  from `ANCHORS`); the set-piece matches the anchor (pinned in `system-map.test.js`, freighter +50 z framing);
  the anchor is an activity-zone centre and the host of the mission (pinned in `missions.test.js`). Drop the
  history paragraph about the freighter being left behind (it lives in CHANGELOG). Also trim the matching
  sentence on `generateMissions` (around line 90) so it does not restate coordinates.
- `client/src/sim-core/system-map.js` comment above `ANCHORS` (around line 224) and `activityZoneCenters`
  (around line 336): change "missions.js center" wording to "missions.js reads its centres from here".

No numbers change; spawns, the fight and replays are unaffected.

### Step 3 — Client guard for C5

`client/src/drops.test.js` (note: this file is in `client/src/`, not `sim-core/`), the test
`'rewardOwned: L2 component reward is owned iff the repair slot is filled'` (around line 110). Rename to
`'rewardOwned: a component reward is owned iff some slot holds exactly its id'` and make it:

```js
  const drone = { kind: 'component', refId: 12 };
  assert.equal(rewardOwned({ components: { repair: 12 } }, drone), true);
  assert.equal(rewardOwned({ components: {} }, drone), false);
  assert.equal(rewardOwned({ components: { repair: null } }, drone), false);
  assert.equal(rewardOwned({ components: { repair: 19 } }, drone), false); // Repair drone II is not drone 12 — OLD code said owned
  assert.equal(rewardOwned({ components: { engine: 7 } }, { kind: 'component', refId: 7 }), true); // any slot — OLD code said not owned
  assert.equal(rewardOwned({ ship: { components: { repair: 12 } } }, drone), true); // falls back to ship.components
```

**Negative test:** run the file against the old `rewardOwned` (stash the Step 1 edit, or `git stash` the source
file only) and confirm the `repair: 19` and `engine: 7` lines fail; then restore. Report both outcomes.

The existing stash test (around line 117) stays as is and must still pass.

### Step 4 — Server guards for C5 and C6

**4a. Reward agreement** — new pure file `server/src/level-rewards.test.js` (no DB; import `LEVELS` from
`./catalog_seed.js`):

```js
// Illustrative — adapt to the real shapes.
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
      `level ${l.id} drops ${kind} ${refId}; level ${next.id}'s briefing must grant it`);
  }
});
```

Negative test: temporarily change `catalog_seed.js:807` `to: 5` → `to: 6` (or `:862` `component: 12` → `19`),
confirm the test fails, revert.

**4b. Mission location** — add to `server/src/missions.test.js` (already pure, no DB):

```js
import { ANCHORS, objectForMission, activityZoneCenters } from '../../client/src/sim-core/system-map.js';
test('every side mission fights at its host object, inside a roam activity zone', () => {
  const zones = activityZoneCenters();
  for (const m of generateMissions()) {
    const host = objectForMission(m.id);
    assert.ok(host, `${m.id} has a host object on the system map`);
    assert.deepEqual(m.descriptor.center, { x: host.pos.x, z: host.pos.z }, `${m.id} centre == host pos`);
    assert.ok(zones.some((z) => z.x === m.descriptor.center.x && z.z === m.descriptor.center.z),
      `${m.id} centre is an activity-zone centre`);
  }
});
test('missions.js takes its centres from ANCHORS, not literals', () => {
  const src = readFileSync(new URL('./missions.js', import.meta.url), 'utf8');
  assert.match(src, /import \{[^}]*\bANCHORS\b[^}]*\} from '..\/..\/client\/src\/sim-core\/system-map\.js'/);
  assert.doesNotMatch(src, /center:\s*\{\s*x:\s*-?\d/, 'no numeric literal centre');
});
```

The equality test passes on old code too (the values agree today) — it is the guard against future drift.
The source test is the one that **fails on old code**. Negative tests: (1) run the source test against the old
`missions.js` → fails; (2) temporarily set one centre back to a wrong literal (e.g. `{ x: -980, z: 0 }`) → both
tests fail; revert. Report both.

Do not touch `client/src/sim-core/system-map.test.js` — its set-piece test already covers the fourth side.

### Step 5 — Follow-ups audit file (new finding, not fixed)

Create `docs/plans/2026-10-26-duplication-audit-followups.md` (closeout "Closing the audit" step 4: new findings
go into a new short audit file). Short: a header (date, "findings surfaced while closing the 2026-10-20 audit;
not part of it"), a table with one row, and a section per row. Row **F1 — A briefing `installComponent` destroys
the part it replaces**:
- Code: `server/src/db.js:720-729` `installActiveShipComponent` sets `components[slot] = componentId` with no
  deposit; compare `replaceActiveShipWeapon` (`db.js:698-710`), which stashes the removed weapon
  (`depositStash`). Called from `applyBriefingActions` (`db.js:732-738`) for the Level 3 briefing
  (`catalog_seed.js:862`, `installComponent repair 12`).
- Repro: a player clears Level 1 (shop opens on the Level 2 briefing), buys and equips Repair drone II (id 19,
  1800 cr) or Nanobot repair (id 20) before clearing Level 2, then clears Level 2 → the Level 3 briefing sets
  `components.repair = 12`; drone 19/20 is in neither the loadout nor the stash. Reproducible directly in a
  server test: give a fresh player `components.repair = 19`, call the Level 3 briefing, assert the stash.
- Suggested fix (not decided): deposit the replaced component like the weapon path does. Status: open.

Link it from the closeout plan's "Closing the audit" step 4 line ("see
[`2026-10-26-duplication-audit-followups.md`](2026-10-26-duplication-audit-followups.md)").

## Tests

Ask before running suites (standing rule); these are the expected runs:
- Client: `cd client && node --test src/drops.test.js src/sim-core/system-map.test.js`, then `node --test`
  (full unit set — cheap).
- Server: `cd server && npm test` (Postgres; pretest recreates `spacegame_test`). New/changed:
  `level-rewards.test.js`, `missions.test.js`, `reward-drop.test.js`.
- **Level 2 through the real sim (added at the review gate, from the critic).** `server/src/reward-drop.test.js`:
  parametrize its last-kill helper by level name / expected reward / enemy (an enemy from that level's spawn
  pool — Level 2's last kill is the `pirate mini boss`); Repair drone II 19 equipped + empty stash → exactly 1
  reward crate; Repair drone 12 equipped → 0 crates. Negative test: against the old `rewardOwned`, the 19 case
  must fail.
- **Visual scenarios:** `cd client && node visual/run.mjs 22-trace-replay` (check `lsof -i :4173` first). It is
  a cheap sanity check that the sim still loads and re-sims; note it **cannot exercise this change** — its
  fixture is level-0, which has no `lastKillDrop`, and the L1 reward is a weapon. **Skip `36-sim-divergence`**:
  no per-tick loop, hit or death logic changes (standing rule scope). No other scenario touches this.
- Full visual suite and perf gate: not run (opt-in, default skip).

Every new guard must be seen to fail once (negative tests in Steps 3, 4a, 4b); report the outputs.

### Replay / intro impact

- The intro is a live fight; the level-0 trace is a determinism fixture with no reward drop → unaffected.
- Level 1 reward is a weapon → unaffected.
- Level 2: ownership can flip only for an account with drone 19/20 equipped and 12 not owned → RNG draw count on
  the last kill changes → such a recorded trace may diverge from that kill on (Decision 1). Netsim rooms read the
  same `rewardOwned` from the account record, so both hosts agree.
- C6 moves no number → no replay effect.

## Docs to update

- **`docs/CHANGELOG.md`** — new `## 2026-10-26` heading (if missing) with one bullet:
  **"Level reward and mission location have one source each (duplication audit C5, C6)"** —
  `[2026-10-26-1616-reward-and-mission-anchors]` ([plan](plans/2026-10-26-1616-reward-and-mission-anchors.md),
  DECISIONS §169): component reward owned = exact id in any slot or in the stash (player with Repair drone II /
  Nanobot equipped now sees the Level 2 crate); server test pins each `lastKillDrop` against the next briefing's
  grant; `missions.js` reads `ANCHORS`, test pins centre == host pos and in the activity zones; new follow-ups
  audit file with F1.
- **`docs/SUMMARY.md`** — bump `**Updated:**` to 2026-10-26 with a one-line lead. Edit in place:
  - Reward-drops bullet (around line 1957): replace "L2: `components.repair` filled, any repair component" with
    "a component reward: some slot holds exactly its id (DECISIONS §169)"; add that a server test
    (`level-rewards.test.js`) pins each `lastKillDrop` to the next level's briefing grant; fix the live-test
    sentence so it reads correctly under the new rule (e.g. "Repair drone 12 in the stash or equipped → no
    crate; Repair drone II equipped and 12 not owned → crate").
  - Star-system objects paragraph (around lines 2410-2420): add that `missions.js` reads its centres from
    `ANCHORS` and `missions.test.js` pins centre == host object pos and ∈ `activityZoneCenters()`.
  - Side missions in the server section (around line 3768): one clause — centres come from `ANCHORS`.
- **`docs/DECISIONS.md`** — **§169** (check the tail first; if taken, use the next free number and update every
  reference in this plan's outputs): "A component reward is owned by its exact id, not by its slot" — context
  (C5), decision, the two rejected alternatives, consequences (Decision 1 bullets: visible crate for 19/20
  holders, possible divergence of such old level-2 traces, accepted per §166).
- **`docs/plans/2026-10-20-duplication-audit.md`** — rows C5, C6 (around lines 86-87): status
  `**fixed 2026-10-26** (\`<commit>\`, §169)` / `**fixed 2026-10-26** (\`<commit>\`)`; in the top status list add
  "**C5, C6** fixed 2026-10-26 by Phase 3 of the close-out plan ([plan link], DECISIONS §169)" and remove C5, C6
  from "Not planned yet".
- **`docs/plans/2026-10-24-duplication-audit-closeout.md`** — header status "Phases 1–3 done; Phases 4–8 not
  started"; Phase 3 gets a `**Status:** done 2026-10-26 (\`<commit>\`, merge \`<merge>\`, run
  2026-10-26-1616-reward-and-mission-anchors), [plan](2026-10-26-1616-reward-and-mission-anchors.md).` line in the
  same format as Phases 1–2; fix Phase 3's own test line path (`client/src/drops.test.js`, not
  `sim-core/drops*.test.js`) and its "± the documented freighter offset" wording (exact equality — see
  Decision 4); add the follow-ups link (Step 5).
- **New:** `docs/plans/2026-10-26-duplication-audit-followups.md` (Step 5).

**Consistency grep before finishing:** `grep -rn "repair slot\|comps.repair\|any repair component\|FOUR-WAY" client/src server/src docs/SUMMARY.md`
— every hit must describe the new rule (historic CHANGELOG/DECISIONS entries stay as written).

**Deploy:** a client file changes (`drops-config.js`), so prod deploy + itch re-publish per the closeout's
standing post-phase routine. No model/asset hash changes.

## Out of scope / non-goals

- Fixing F1 (`installActiveShipComponent` stash) — recorded only.
- Generating briefing actions from `lastKillDrop`, or any change to the briefing/grant flow.
- Changing `rewardOwned`'s signature, passing the catalog, or adding fields to `lastKillDrop`.
- Moving `ANCHORS` to a server module, or touching set-piece positions / the freighter's +50 z framing.
- Trace format/version changes.
