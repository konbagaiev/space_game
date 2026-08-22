// How often does the server's re-simulation disagree with the player's own account of a run?
//
// This is the measurement that has to come BEFORE anything is sealed. `POST /api/games` is
// client-authoritative, and the plan for taking that back (docs/plans/seal-the-economy.md) turns on one
// number nobody has yet: the disagreement rate on HONEST players. Judging a run the server cannot faithfully
// reproduce does not catch a cheat, it robs someone who did nothing wrong (DECISIONS §125).
//
// So: READ-ONLY. It writes nothing — not to Postgres, not to S3, not to a balance. It reads recorded
// sessions, re-simulates the ones that can be re-simulated, and prints a table.
//
// The claimed number it can check today is KILLS: `gameplay_sessions` already stores the client's own count
// next to the trace that produced it, so the correlation exists with no schema change and no client change.
// Kills is the load-bearing quantity anyway — credits and XP are functions of which ships died.
//
// Usage (needs DATABASE_URL for the database being surveyed and AWS creds for the trace bucket):
//   node server/tools/verify-sessions.mjs [--limit 200] [--since 30d] [--include-unskilled] [--build SHA] [--json]
//
//   --build SHA          Refuse any run not recorded by SHA. This is what the LIVE verifier must always do —
//                        a trace reproduces only on the build that made it (plan §3.1) — but the survey
//                        defaults to OFF, because looking at the drift is the whole point of a survey.
//   node server/tools/verify-sessions.mjs --rows dumped.json          # survey WITHOUT a database connection
//
//   --rows FILE          Read the session rows from a JSON file instead of querying Postgres. Production's
//                        database is not reachable from a laptop (it is on the Docker network, unpublished),
//                        and the alternative — copying this tool into the running prod container — mutates a
//                        live deployment to run a read-only report. Dumping the rows over SSH and surveying
//                        them here touches nothing:
//                          ssh root@… 'docker exec shared_postgres psql -U spacegame -d spacegame -tAc
//                            "SELECT json_agg(row_to_json(t)) FROM (SELECT s.id, s.player_id, s.level,
//                             s.outcome, s.kills, s.s3_key, s.created_at, s.game_version,
//                             (COALESCE(p.skill_kinetic,0)+COALESCE(p.skill_rocket,0)+COALESCE(p.skill_shields,0)
//                              +COALESCE(p.skill_maneuver,0)+COALESCE(p.skill_mobility,0)) AS spent
//                             FROM gameplay_sessions s LEFT JOIN players p ON p.id = s.player_id
//                             ORDER BY s.created_at DESC) t"' > rows.json
//
//   --include-unskilled  ALSO judge pre-v4 traces whose player currently has no skill points spent.
//                        §125 says a pre-v4 trace is trustworthy exactly for a player who had spent
//                        nothing, and spending is monotonic — so "nothing spent now" implies "nothing spent
//                        then". CALIBRATION ONLY, and it has one hole worth knowing: `resetPlayer` zeroes a
//                        skill allocation but does NOT delete `gameplay_sessions`, so a reset account's old
//                        sessions can land in this bucket wrongly. It is reported as its own bucket for
//                        exactly that reason, and it must never widen what the live verifier accepts.
//
// Do NOT run this while somebody is playing on the same box: it re-simulates whole fights and will starve a
// 60 Hz room's timer (docs/plans/server-authoritative-sim.md §0).
import { readFileSync } from 'node:fs';
import { getTrace } from '../src/s3.js';
import { verifyRun, classifyTrace } from '../src/seal/verify-run.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return fallback;
  const inline = args[i].split('=')[1];
  return inline ?? args[i + 1] ?? fallback;
};
const has = (name) => args.includes(`--${name}`);

const LIMIT = Number(flag('limit', 200));
const SINCE = String(flag('since', '30d'));
const JSON_OUT = has('json');
const ROWS_FILE = flag('rows', null);
const BUILD = flag('build', null);
const INCLUDE_UNSKILLED = has('include-unskilled');

// "30d" / "12h" / "90m" → milliseconds.
function sinceMs(s) {
  const m = /^(\d+)([dhm])$/.exec(s);
  if (!m) throw new Error(`--since wants something like 30d / 12h / 90m, got "${s}"`);
  return Number(m[1]) * { d: 86400e3, h: 3600e3, m: 60e3 }[m[2]];
}

// The skill columns, so "has this player ever had a point to spend" is one query.
const SKILLS = ['skill_kinetic', 'skill_rocket', 'skill_shields', 'skill_maneuver', 'skill_mobility'];

// The rows to survey, from a dump file or from the database. Same shape either way; the file is filtered
// here so `--since`/`--limit` mean the same thing in both modes.
async function loadRows(cutoff) {
  if (ROWS_FILE) {
    const all = JSON.parse(readFileSync(ROWS_FILE, 'utf8')) || [];
    return all.filter((r) => Number(r.created_at) >= cutoff)
      .sort((a, b) => Number(b.created_at) - Number(a.created_at)).slice(0, LIMIT);
  }
  const { pool } = await import('../src/db.js');   // imported lazily: --rows must not need a database at all
  const { rows } = await pool.query(
    `SELECT s.id, s.player_id, s.level, s.outcome, s.kills, s.s3_key, s.created_at, s.game_version,
            (${SKILLS.map((c) => `COALESCE(p.${c},0)`).join(' + ')}) AS spent
       FROM gameplay_sessions s
       LEFT JOIN players p ON p.id = s.player_id
      WHERE s.created_at >= $1
      ORDER BY s.created_at DESC
      LIMIT $2`, [cutoff, LIMIT]);
  closePool = () => pool.end();
  return rows;
}

let closePool = () => {};

async function main() {
  const cutoff = Date.now() - sinceMs(SINCE);
  const rows = await loadRows(cutoff);

  const buckets = new Map();       // classification → count
  const bump = (k) => buckets.set(k, (buckets.get(k) || 0) + 1);
  const judged = [];               // { id, level, claimed, computed, verdict, note, inferred }

  for (const row of rows) {
    const trace = await getTrace(row.s3_key);
    if (!trace) { bump('no-trace'); continue; }

    // The calibration widening: read an old trace as v4 when the account proves nothing was ever spent.
    const spent = Number(row.spent) || 0;
    const inferred = INCLUDE_UNSKILLED && (Number(trace.version) || 0) < 4 && spent === 0;
    const t = inferred ? { ...trace, version: 4, skills: null } : trace;

    const claim = { kills: row.kills, level: row.level, outcome: row.outcome, gameVersion: row.game_version };
    const why = classifyTrace(t, claim, { build: BUILD });
    if (why) { bump(inferred ? `${why} (unskilled)` : why); continue; }

    let r;
    try {
      r = await verifyRun({ trace: t, claim, build: BUILD });
    } catch (e) {
      bump('error');
      judged.push({ id: row.id, level: row.level, claimed: row.kills, computed: null,
        verdict: 'error', note: String(e && e.message || e), inferred });
      continue;
    }
    bump(inferred ? `${r.verdict} (unskilled)` : r.verdict);
    judged.push({ id: row.id, level: row.level, claimed: row.kills, computed: r.kills,
      verdict: r.verdict, note: r.note, inferred, build: row.game_version });
  }

  const verifiable = judged.filter((j) => j.verdict === 'agree' || j.verdict === 'disagree');
  const agree = verifiable.filter((j) => j.verdict === 'agree').length;
  const summary = {
    sessions: rows.length, since: SINCE,
    buckets: Object.fromEntries([...buckets].sort((a, b) => b[1] - a[1])),
    verifiable: verifiable.length, agree, disagree: verifiable.length - agree,
    agreeRate: verifiable.length ? +(agree / verifiable.length).toFixed(3) : null,
  };

  if (JSON_OUT) { console.log(JSON.stringify({ summary, judged }, null, 2)); return; }

  console.log(`sessions ${rows.length} (last ${SINCE})${INCLUDE_UNSKILLED ? '  · pre-v4 unskilled accounts included' : ''}`
    + `${BUILD ? `  · build ${BUILD.slice(0, 8)} only` : '  · every build (drift NOT excluded)'}`);
  for (const [k, n] of Object.entries(summary.buckets)) console.log(`  ${k.padEnd(24)} ${n}`);
  console.log(`\nverifiable ${verifiable.length} → agree ${agree}  disagree ${summary.disagree}`
    + (summary.agreeRate == null ? '' : `  (${(summary.agreeRate * 100).toFixed(1)}%)`));

  const bad = judged.filter((j) => j.verdict !== 'agree');
  if (bad.length) {
    console.log('\ndisagreements (claimed kills → re-simulated):');
    for (const j of bad) {
      console.log(`  ${j.id}  ${String(j.level).padEnd(8)} ${String(j.claimed).padStart(3)} → `
        + `${j.computed == null ? '  ?' : String(j.computed).padStart(3)}  ${j.verdict}`
        + `${j.note ? `  ${j.note}` : ''}${j.inferred ? '  [inferred v4]' : ''}`);
    }
  }
  // The honest caveat, printed rather than buried: kills is the only claimed number stored per session
  // today. Credits and XP become checkable once `games` carries the session id (plan §4.1–4.3).
  console.log('\nchecked: kills only — `games` does not yet record which trace a bank belongs to.');
}

main().then(() => closePool(), (e) => { console.error(e); closePool(); process.exitCode = 1; });
