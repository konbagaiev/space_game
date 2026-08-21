// A jerk probe for a netsim room: catch every moment the DRAWN motion of a networked object breaks, and
// record what the network was doing at that instant.
//
// Why this exists rather than more reasoning. A stutter has several possible authors and they are not
// distinguishable by eye: a late or bursty snapshot (the delivery), a snapshot that carries more sim time
// than the last one (the room fell behind and caught up), an object whose extrapolation was corrected when
// the truth arrived, or simply linear interpolation cutting a corner on a curved path — which is not a
// delivery fault at all and no amount of network work would fix. Each leaves a different fingerprint, so
// the probe records the fingerprint alongside the break.
//
// Off unless `?netjerk` is on the URL: it walks every drawn entity once per frame, which is cheap but not
// free, and it is a diagnostic, not a feature.
//
// THREE-free and stateless about the scene — it reads the poses `renderNet` has already written, so it
// measures exactly what the player sees, and it is unit-testable under `node --test`.

// A break is judged against the object's OWN recent motion, not an absolute number: 0.2 units of change in
// one frame is nothing for a bullet and a lurch for a drifting crate.
//
// And it is judged on SPEED, not on per-frame displacement. Frames are not evenly spaced — a browser at
// ~96 fps varies by a couple of milliseconds a frame — so an object moving perfectly correctly in TIME still
// covers different distances in consecutive frames. Measuring displacement therefore reports the renderer's
// pacing as if it were the object's: a first real-session capture logged 3041 "breaks" on bullets, which fly
// in a straight line at a constant speed and cannot break at all. Dividing by the frame's own duration is
// the difference between measuring the world and measuring the clock that samples it.
export const STEP_BREAK = 0.5;      // |Δ speed| over the object's mean speed — 0.5 = "half its cruise speed"
export const TURN_BREAK_DEG = 0.6;  // |Δ turn| per frame, absolute: the nose stepping the eye actually catches
export const MAX_EVENTS = 400;      // ring buffer; a long session must not grow without bound
export const MAX_ARRIVALS = 4000;  // every packet's arrival, so the jitter DISTRIBUTION can be read offline
export const SLOW_FRAME_MS = 30;   // ~2 frames at 60 Hz: past this the tab itself hitched, and a "lag" the
                                   // player saw may be the renderer, not the room. Recorded separately so
                                   // the two are never confused.

const wrap = (d) => { let x = d; while (x > Math.PI) x -= Math.PI * 2; while (x < -Math.PI) x += Math.PI * 2; return x; };
const DEG = 180 / Math.PI;

export function createJerkProbe({ maxEvents = MAX_EVENTS, maxArrivals = MAX_ARRIVALS, onBreak = null } = {}) {
  const prev = new Map();   // entity → { x, z, h, at, speed, omega, meanSpeed, n }
  const events = [];
  const arrivals = [];      // { tick, at, gap } for EVERY packet — the jitter distribution, not just its victims
  const slowFrames = [];    // { t, dt } for frames the tab itself lost
  // Lifecycle: sockets dropping, runs restarting, the room going idle. A one-off "the whole world jumped"
  // is never explained by per-frame numbers — it is explained by what happened to the LINK at that second.
  const marks = [];
  let lastFrameAt = null;
  let frameCount = 0, frameDtSum = 0;
  // What the last applied snapshot told us, so a break can be attributed to it.
  let last = { at: 0, tick: -1, arrivalGapMs: 0, tickGap: 0, appliedThisFrame: false };
  const counts = { total: 0, onSnapshotFrame: 0, byKind: {} };

  return {
    events, arrivals, slowFrames, marks,

    // A lifecycle moment, stamped on the same clock as everything else so it can be lined up with a break.
    mark(label, data = null, now = 0) {
      marks.push({ t: Math.round(now), label, ...(data ? { data } : {}) });
      if (marks.length > 500) marks.shift();
    },

    // Called by applySnapshot: the delivery fingerprint of THIS packet.
    snapshot(snap, at) {
      // A tick that goes BACKWARDS is a different room, not a stall: the counter restarts at 0 on every
      // join, so a reconnect after six minutes in the menus would otherwise be logged as a six-minute
      // freeze. (It was, in the first capture that had one.)
      if (last.tick >= 0 && snap.tick < last.tick) { last = { at, tick: -1, arrivalGapMs: 0, tickGap: 0, appliedThisFrame: true }; }
      const arrivalGapMs = last.tick >= 0 ? at - last.at : 0;
      const tickGap = last.tick >= 0 ? snap.tick - last.tick : 0;
      last = { at, tick: snap.tick, arrivalGapMs, tickGap, appliedThisFrame: true };
      arrivals.push({ tick: snap.tick, at: Math.round(at), gap: Math.round(arrivalGapMs), tickGap });
      if (arrivals.length > maxArrivals) arrivals.shift();
      // A packet carrying much more than one interval of sim time, or arriving after a long silence, is the
      // fingerprint of a stall — on the server, on the link, or in this tab. Marked so it is findable.
      if (last.tick >= 0 && (tickGap > 8 || arrivalGapMs > 200)) {
        this.mark('delivery-stall', { tick: snap.tick, tickGap, gapMs: Math.round(arrivalGapMs) }, at);
      }
    },

    // Called at the END of renderNet, once the drawn poses are written.
    frame(world, state, now) {
      // The tab's own frame time first. A player who reports "a big lag" may have seen the renderer stall,
      // which no netcode change would touch — so it is recorded, and recorded apart.
      if (lastFrameAt != null) {
        const dt = now - lastFrameAt;
        frameCount++; frameDtSum += dt;
        if (dt > SLOW_FRAME_MS) {
          slowFrames.push({ t: Math.round(now), dt: Math.round(dt) });
          if (slowFrames.length > maxArrivals) slowFrames.shift();
        }
      }
      lastFrameAt = now;
      const seen = new Set();
      for (const list of [world.enemies, world.rockets, world.bullets, world.drops]) {
        for (const e of list) {
          if (!e || !e.pos) continue;
          seen.add(e);
          const p = prev.get(e);
          // Per SECOND, not per frame — see STEP_BREAK. A frame shorter than its neighbour is not a stutter.
          const dt = p && p.at != null ? Math.max(now - p.at, 1e-3) / 1000 : null;
          const speed = dt ? Math.hypot(e.pos.x - p.x, e.pos.z - p.z) / dt : null;
          const omega = dt && e.heading != null && p.h != null ? wrap(e.heading - p.h) / dt : null;
          if (p && p.speed != null && speed != null) {
            const mean = p.meanSpeed || speed || 1e-6;
            const dStep = Math.abs(speed - p.speed);
            const dTurn = p.omega != null && omega != null ? Math.abs(omega - p.omega) : 0;
            const stepBroke = dStep > STEP_BREAK * Math.max(mean, 1e-3);
            // The turn threshold is per FRAME to stay a number a human can picture, so it is scaled back by
            // the frame's share of a second.
            const turnBroke = dTurn * DEG * (dt || 0) > TURN_BREAK_DEG;
            if (stepBroke || turnBroke) {
              const id = state.idOf.get(e) ?? null;
              const kind = id != null ? state.kinds.get(id) : 'unknown';
              const samples = id != null ? state.samples.get(id) : null;
              const n = samples ? samples.length : 0;
              const a = n > 1 ? samples[n - 2] : null, b = n > 0 ? samples[n - 1] : null;
              const ev = {
                t: Math.round(now), kind, id,
                dStep: +dStep.toFixed(4), stepMean: +mean.toFixed(4),   // units per SECOND
                dTurnDeg: +(dTurn * DEG * (dt || 0)).toFixed(3),        // degrees in this frame
                // DELIVERY at this instant. `sampleSpanMs` is the gap between the two samples this entity is
                // being drawn from — a collapsed span (two packets stamped at the same millisecond) and a
                // stretched one (a packet lost or late) are different faults with the same symptom.
                onSnapshotFrame: last.appliedThisFrame,
                arrivalGapMs: Math.round(last.arrivalGapMs),
                tickGap: last.tickGap,
                sampleSpanMs: a && b ? Math.round(b.at - a.at) : null,
                sampleTickGap: a && b ? b.tick - a.tick : null,
                samples: n,
              };
              events.push(ev);
              if (events.length > maxEvents) events.shift();
              counts.total++;
              if (ev.onSnapshotFrame) counts.onSnapshotFrame++;
              counts.byKind[kind] = (counts.byKind[kind] || 0) + 1;
              if (onBreak) onBreak(ev);
            }
          }
          const nn = p ? p.n + 1 : 1;
          const meanSpeed = speed == null ? (p ? p.meanSpeed : null)
            : p && p.meanSpeed != null ? p.meanSpeed + (speed - p.meanSpeed) / Math.min(nn, 30) : speed;
          prev.set(e, { x: e.pos.x, z: e.pos.z, h: e.heading, at: now, speed, omega, meanSpeed, n: nn });
        }
      }
      for (const e of prev.keys()) if (!seen.has(e)) prev.delete(e); // despawned
      last.appliedThisFrame = false;
    },

    // What the session saw. The headline is the ATTRIBUTION: a break that lands on a frame where no packet
    // was applied cannot be the packet's fault — it is the client drawing a curve as a straight line.
    report() {
      const stalls = marks.filter((m) => m.label === 'delivery-stall').length;
      const byCause = { onPacket: 0, betweenPackets: 0, collapsedSpan: 0, stretchedTicks: 0 };
      for (const e of events) {
        if (e.onSnapshotFrame) byCause.onPacket++; else byCause.betweenPackets++;
        if (e.sampleSpanMs != null && e.sampleSpanMs <= 2) byCause.collapsedSpan++;
        if (e.sampleTickGap != null && e.sampleTickGap > 4) byCause.stretchedTicks++;
      }
      // Arrival jitter, which is what an extrapolated object turns into position error.
      const gaps = arrivals.slice(1).map((a) => a.gap).sort((x, y) => x - y);
      const gp = (q) => (gaps.length ? gaps[Math.floor((gaps.length - 1) * q)] : 0);
      const turns = events.map((e) => e.dTurnDeg).sort((a, b) => a - b);
      const steps = events.map((e) => e.dStep).sort((a, b) => a - b);
      const pick = (a, q) => (a.length ? a[Math.floor((a.length - 1) * q)] : 0);
      return {
        total: counts.total, kept: events.length, byKind: { ...counts.byKind }, byCause,
        turnDeg: { p50: pick(turns, 0.5), p95: pick(turns, 0.95), max: pick(turns, 1) },
        step: { p50: pick(steps, 0.5), p95: pick(steps, 0.95), max: pick(steps, 1) },
        // Delivery: the nominal gap is one snapshot interval, so the SPREAD here is the jitter an
        // extrapolated object multiplies by its own speed.
        arrival: { count: arrivals.length, p05: gp(0.05), p50: gp(0.5), p95: gp(0.95), max: gp(1), stalls },
        // The tab: if these are many, the "lag" was the renderer and not the room.
        frames: { count: frameCount, meanDtMs: frameCount ? +(frameDtSum / frameCount).toFixed(2) : 0,
                  slow: slowFrames.length, worstDtMs: slowFrames.reduce((m, f) => Math.max(m, f.dt), 0) },
        // Relative size is what the eye judges: a step change against the object's own cruise step.
        worstRelative: [...events].sort((a, b) => (b.dStep / (b.stepMean || 1)) - (a.dStep / (a.stepMean || 1)))
          .slice(0, 10).map((e) => ({ ...e, ofCruise: +(e.dStep / (e.stepMean || 1)).toFixed(2) })),
        worst: [...events].sort((a, b) => b.dTurnDeg - a.dTurnDeg).slice(0, 10),
      };
    },

    // Everything, ready to be written to a file and read offline. The raw lists matter as much as the
    // summary: the arrival timeline is what a clock estimator would have to survive.
    dump(extra = {}) {
      return { kind: 'netjerk', version: 1, ...extra,
               report: this.report(), marks: [...marks],
               events: [...events], arrivals: [...arrivals], slowFrames: [...slowFrames] };
    },

    clear() {
      events.length = 0; arrivals.length = 0; slowFrames.length = 0; marks.length = 0;
      counts.total = 0; counts.onSnapshotFrame = 0; counts.byKind = {};
      frameCount = 0; frameDtSum = 0; lastFrameAt = null;
    },
  };
}
