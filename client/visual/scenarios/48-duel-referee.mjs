// THE DUEL ORACLE: a LIVE-recorded duel, re-simulated in Node, must be the same fight.
//
// `36-sim-divergence` proves browser ↔ Node on a `?playback` re-run of a committed asset. This is the other
// half and the one the duel referee actually rests on: a session recorded by the LIVE loop — a different
// level (level-1), a different driver (the accumulator's per-tick body through `liveTickDeps`, not the
// playback branch) and a fresh `beginLiveSession` seed rather than a fixed one — handed to
// `server/src/seal/verify-duel.js` exactly as the production route hands it over.
//
// It also carries the §3.1a guard in a real browser: `anchor.tick === trace.tickCount`, i.e. the uploaded
// trace contains the tick the fight ENDED on. That off-by-one (capture after update) silently truncated
// every recorded session, and it is invisible to any test that does not compare the two numbers.
//
// The death here fires the real `flushSession('death')`, so this scenario uploads a genuine duel session to
// the harness's local server and leaves a `duel:level-1` row (and a verdict) in `spacegame_test`. That is
// intentional — it exercises the production path end to end — so do not assume an empty sessions table, and
// a duel row appearing locally after a visual run is not a bug.
import { runTrace } from '../../../server/tools/sim-replay.mjs';
import { verifyDuel } from '../../../server/src/seal/verify-duel.js';
import { duelAnchorReached } from '../../src/sim-core/duel-config.js';

export const name = '48-duel-referee';

// Boot a fresh page on a given query string and get past whichever launch screen this level lands on.
// (Copied from 47-duel-room.mjs rather than imported: scenarios do not depend on each other.)
async function boot(page, query) {
  const base = page.url().split('?')[0];
  await page.goto(`${base}?${query}`, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.evaluate(() => {
    const mw = document.getElementById('mw-takeoff');
    const main = document.getElementById('main-window');
    if (mw && main && main.classList.contains('on')) { mw.click(); return; }
    const w = document.getElementById('welcome');
    if (w && w.style.display !== 'none') document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(200);
}

export default async function ({ page, assert, shot }) {
  await boot(page, 'debug&duel');
  // Freeze the rAF accumulator so `stepLive` is the ONLY driver — two drivers feeding one recorder is not
  // wrong, but it makes a failure impossible to read.
  await page.evaluate(() => window.__game.setPaused(true));

  // The player never touches the controls, so an idle starter hull against two aces settles on the death
  // anchor in about nine seconds of sim time. Bounded, and it fails with a readable message rather than
  // hanging: a stepping test must never wait on the wall clock or loop forever.
  const MAX_TICKS = 3000;
  const run = await page.evaluate(async (max) => {
    const g = window.__game;
    let stepped = 0;
    while (stepped < max && !g.sessionAnchor()) { g.stepLive(120); stepped += 120; }
    return { stepped, anchor: g.sessionAnchor(), trace: g.sessionTrace(),
             hp: g.player.hp, alive: g.player.alive, kills: g.kills, enemies: g.enemyCount };
  }, MAX_TICKS);
  await shot('duel-referee-settled');

  assert.ok(run.anchor,
    `the duel never settled in ${run.stepped} ticks (hp=${run.hp} alive=${run.alive} kills=${run.kills} enemies=${run.enemies}) — no anchor to judge`);
  const { anchor, trace } = run;

  // THE §3.1a GUARD, in a real browser: the uploaded trace contains the tick the fight ended on. Before the
  // capture-order fix this was off by one and the referee stopped a tick short of the outcome it judges.
  assert.equal(anchor.tick, trace.tickCount,
    `the trace must contain the tick the fight ended on (anchor tick ${anchor.tick}, trace ${trace.tickCount})`);
  assert.deepEqual(trace.room, { kind: 'duel', aces: 2 }, 'and it names the room it was fought in');

  // --- Node side: the same input, the same room, rebuilt from the trace alone ---
  const node = runTrace(trace, { stopWhen: duelAnchorReached });
  const fmt = (s) => Object.entries(s).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`      node   : ticks=${node.ticksRun}/${node.ticksTotal} hash=0x${node.hash.toString(16)} ${fmt(node.summary)}`);
  console.log(`      browser: ticks=${anchor.tick} hash=0x${(anchor.hash >>> 0).toString(16)} draws=${anchor.draws}`);

  assert.ok(duelAnchorReached(node.world),
    `the headless referee never reached the anchor (ran ${node.ticksRun}/${node.ticksTotal}, ${fmt(node.summary)})`);
  assert.equal(node.ticksRun, anchor.tick,
    `both hosts must settle on the same tick (node ${node.ticksRun}, browser ${anchor.tick})`);
  assert.equal(node.draws, anchor.draws,
    `seeded RNG draws differ (node ${node.draws}, browser ${anchor.draws}) — something drew from the gameplay stream on one host only (DECISIONS §73)`);
  assert.equal(node.hash, anchor.hash,
    `world digests differ (node 0x${node.hash.toString(16)}, browser 0x${(anchor.hash >>> 0).toString(16)}) — the browser and the headless referee simulated different fights`);

  // …and the referee itself, called the way the production route calls it.
  const verdict = await verifyDuel({ trace, claim: { level: trace.level, anchor } });
  assert.equal(verdict.verdict, 'agree', `the referee's verdict on an honest duel: ${verdict.note}`);
}
