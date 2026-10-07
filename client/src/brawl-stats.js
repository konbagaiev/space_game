// The bot brawl's numbers: frame-time statistics, the per-window table, the end rule, the result object
// and the card's text. Pure (no DOM, no Three), so every rule here is unit-tested (`brawl-stats.test.js`).
// The browser half that feeds it is `brawl-host.js`.

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
// The same floor-index percentile `main.js` devPerf uses, so the card and the per-second telemetry agree.
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

// Overall statistics over RAW frame intervals in ms (never the sim's clamped dt, which would hide every
// frame slower than 20 fps). `wallSec` is the measured wall time the frames span.
export function summarizeFrames(ms, wallSec) {
  const frames = ms.length;
  if (!frames) return { frames: 0, avgMs: 0, p95Ms: 0, worstMs: 0, fps: 0 };
  const sorted = [...ms].sort((a, b) => a - b);
  const avg = ms.reduce((s, x) => s + x, 0) / frames;
  return {
    frames,
    avgMs: r1(avg),
    p95Ms: r1(pct(sorted, 95)),
    worstMs: r1(sorted[frames - 1]),
    fps: r1(wallSec > 0 ? frames / wallSec : 0),
  };
}

// Which window a frame belongs to: the window of the sim tick count at the END of that frame. Tick 600 is
// the last tick of window 0, so a frame that ends on it is window 0's.
export const windowOf = (tick, windowTicks) => (tick > 0 ? Math.floor((tick - 1) / windowTicks) : 0);

// One row per 10-sim-second window, keyed to SIM time so two devices are compared over the same stretch of
// the same fight. Each sample is `{ ms, tick, inFrame }`. The trailing window is kept and marked `partial`
// when the run ended inside it. `alive` is joined in by the caller from the fingerprint.
export function windowStats(samples, windowTicks, ticksPerSec = 60) {
  const groups = new Map();
  let maxTick = 0;
  for (const s of samples) {
    const w = windowOf(s.tick, windowTicks);
    if (!groups.has(w)) groups.set(w, []);
    groups.get(w).push(s);
    if (s.tick > maxTick) maxTick = s.tick;
  }
  const rows = [];
  for (const w of [...groups.keys()].sort((a, b) => a - b)) {
    const g = groups.get(w);
    const ms = g.map((s) => s.ms).sort((a, b) => a - b);
    const end = (w + 1) * windowTicks;
    const partial = maxTick < end;
    rows.push({
      w,
      fromSec: r1((w * windowTicks) / ticksPerSec),
      toSec: r1((partial ? maxTick : end) / ticksPerSec),
      avgMs: r1(ms.reduce((a, b) => a + b, 0) / ms.length),
      p95Ms: r1(pct(ms, 95)),
      worstMs: r1(ms[ms.length - 1]),
      frames: ms.length,
      meanInFrame: r1(g.reduce((a, s) => a + s.inFrame, 0) / g.length),
      partial,
    });
  }
  return rows;
}

// ---------- the server's numbers (`?netbrawl`) ----------
// `srvSamples` are the per-second `srv` blocks a server room sent (driver.js), each stamped with the brawl
// tick it arrived at (`brawl-net.js pushSrv`).

// Per 10-sim-second window: the worst server step p95, the mean downstream KB/s and the worst event-loop
// p99, keyed by `w` like `windowStats`, so the card can put them beside the tab's own columns.
export function serverWindowStats(srvSamples, windowTicks) {
  const groups = new Map();
  for (const s of srvSamples || []) {
    const w = windowOf(s.tick, windowTicks);
    if (!groups.has(w)) groups.set(w, []);
    groups.get(w).push(s);
  }
  return [...groups.keys()].sort((a, b) => a - b).map((w) => {
    const g = groups.get(w);
    return {
      w,
      stepP95: r2(Math.max(...g.map((s) => s.stepMs?.p95 ?? 0))),
      kbps: r1(g.reduce((a, s) => a + (s.snapBytes?.sum ?? 0) / 1024, 0) / g.length),
      loopP99: r1(Math.max(...g.map((s) => s.proc?.loopP99 ?? 0))),
    };
  });
}

// The whole run's server summary, or null with no samples.
export function summarizeSrv(srvSamples) {
  const xs = srvSamples || [];
  if (!xs.length) return null;
  const nums = (f) => xs.map(f).filter((v) => Number.isFinite(v));
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const max = (a) => (a.length ? Math.max(...a) : 0);
  const min = (a) => (a.length ? Math.min(...a) : 0);
  const kbps = nums((s) => (s.snapBytes?.sum ?? NaN) / 1024);
  return {
    stepAvg: r2(avg(nums((s) => s.stepMs?.avg))),
    stepP95: r2(max(nums((s) => s.stepMs?.p95))),
    stepMax: r2(max(nums((s) => s.stepMs?.max))),
    ticksMin: min(nums((s) => s.ticks)),
    behind: nums((s) => s.behind).reduce((a, b) => a + b, 0),
    kbpsAvg: r1(avg(kbps)),
    kbpsMax: r1(max(kbps)),
    snapKbMax: r1(max(nums((s) => s.snapBytes?.max)) / 1024),
    cpuAvg: r1(avg(nums((s) => s.proc?.cpuPct))),
    loopP99Max: r1(max(nums((s) => s.proc?.loopP99))),
    rssMaxMB: max(nums((s) => s.proc?.rssMB)),
    bufMaxKB: r1(max(nums((s) => s.bufMax)) / 1024),
  };
}

// Why the run ends, or null if it goes on: a side wiped out first, else the wall-clock limit.
export function brawlShouldEnd({ wallMs, secLimit, over }) {
  if (over) return 'wipeout';
  if (wallMs >= secLimit * 1000) return 'time';
  return null;
}

// The result: the card's content and the `kind: 'brawl-result'` telemetry sample, as one plain object.
export function buildBrawlResult({
  n, tier, build, res, dpr, wallSec, simSec, frameMs = [], windows = [], fingerprint = [],
  killsByBlue = 0, killsByRed = 0, survivors = { blue: 0, red: 0 }, stationInFramePct = null,
  interrupted = false, endedBy = null, engine = null,
  server = false, srv = null, serverWindows = null, closeCode = null,
}) {
  return {
    kind: 'brawl-result',
    n, tier, build: build ?? null, res, dpr,
    wallSec: r2(wallSec), simSec: r2(simSec),
    ratio: wallSec > 0 ? r2(simSec / wallSec) : 0,
    overall: summarizeFrames(frameMs, wallSec),
    windows, fingerprint, killsByBlue, killsByRed, survivors,
    stationInFramePct, interrupted: !!interrupted, endedBy, engine,
    // `?netbrawl`: who simulated the fight, the server's own numbers, and the close code of a lost link.
    server: !!server, srv, serverWindows, closeCode,
  };
}

// The card as English text: `rows` are [label, value] pairs and `table` is the per-window table, with
// window 0 labelled "full load" (every bot alive — the number to compare devices on).
export function formatBrawlCard(r) {
  const o = r.overall || {};
  const eng = r.engine || 'unknown';   // `engine-id.js jsEngine()`: 'Chromium/140.0.0.0' | 'WebKit/18.2' | …
  const rows = [
    ['Simulated by', r.server ? 'server room' : 'this tab'],
    ['Bots per side', String(r.n)],
    ['Tier', String(r.tier)],
    ['Build', r.build || 'unknown'],
    ['Resolution / DPR', `${r.res} @ ${r.dpr}`],
    ['JS engine', eng],
    ['Wall s', String(r.wallSec)],
    ['Sim s reached', String(r.simSec)],
    ['sim/wall', String(r.ratio)],
    ['Ended by', r.endedBy || '—'],
    ['Frame ms avg / p95 / worst', `${o.avgMs} / ${o.p95Ms} / ${o.worstMs}`],
    ['FPS', String(o.fps)],
    ['Station in frame', r.stationInFramePct == null ? 'unknown' : `${r.stationInFramePct} %`],
    ['Kills blue / red', `${r.killsByBlue} / ${r.killsByRed}`],
    ['Survivors blue v red', `${r.survivors?.blue ?? 0} v ${r.survivors?.red ?? 0}`],
  ];
  if (r.server) {
    const s = r.srv || {};
    const v = (x) => (x == null ? '—' : String(x));
    rows.push(
      ['Server step ms avg / p95 / max', `${v(s.stepAvg)} / ${v(s.stepP95)} / ${v(s.stepMax)}`],
      ['Server ticks/s (min)', v(s.ticksMin)],
      ['Down KB/s avg / max', `${v(s.kbpsAvg)} / ${v(s.kbpsMax)}`],
      ['Server CPU % avg (process)', v(s.cpuAvg)],
      ['Event loop p99 max ms', v(s.loopP99Max)],
      ['Snapshot KB max', v(s.snapKbMax)],
    );
    if (r.closeCode != null) rows.push(['Link closed (code)', String(r.closeCode)]);
  }
  if (r.interrupted) rows.unshift(['INTERRUPTED', 'yes — rerun (hidden/paused)']);
  const head = ['Window', 'avg', 'p95', 'worst', 'in frame', 'blue v red'];
  if (r.server) head.push('srv step p95', 'KB/s', 'loop p99');
  const sw = new Map((r.serverWindows || []).map((x) => [x.w, x]));
  const body = (r.windows || []).map((w) => {
    const row = [
      `${w.fromSec}-${w.toSec} s${w.w === 0 ? ' (full load)' : ''}${w.partial ? ' (partial)' : ''}`,
      String(w.avgMs), String(w.p95Ms), String(w.worstMs), String(w.meanInFrame),
      w.alive ? `${w.alive[0]} v ${w.alive[1]}` : '—',
    ];
    if (r.server) {
      const x = sw.get(w.w);
      row.push(x ? String(x.stepP95) : '—', x ? String(x.kbps) : '—', x ? String(x.loopP99) : '—');
    }
    return row;
  });
  const note = 'Fingerprints compare only on the same JS engine, over the windows both runs reached.';
  return { rows, table: { head, body }, note };
}
