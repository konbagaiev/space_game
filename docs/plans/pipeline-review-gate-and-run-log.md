# Pipeline: pre-implementation review gate + committed run-log

**Status:** planned (2026-07-06). Planning-only — implement when the maintainer says go.

**Goal.** Two additions to the `/feature-pipeline` orchestrator (`.claude/skills/feature-pipeline/SKILL.md`):

1. **Review gate (new Stage 4.5)** — a human-in-the-loop checkpoint *between* critic-APPROVE and the
   implementer. Before any code is written, the maintainer sees a compact digest — **what the critic
   caught (and how it was resolved), which files will change, which tests are planned, open decisions** —
   and chooses **approve / request changes / stop**.
2. **Run-log (`docs/pipeline-runs.jsonl`)** — one committed, append-only JSON line per pipeline run,
   capturing per-agent tokens/tool-calls/time, the loop counters, critic/reviewer findings, and the
   live-test outcome. Enables later longitudinal analysis of **how effective the critic and reviewer are**
   via plain `jq`/DuckDB queries — no database server, no SaaS.

**Why this shape (rationale + industry grounding).** The missing checkpoint is the standard
*human-in-the-loop approval gate* (LangGraph `interrupt()` pattern: pause → show state → approve/edit/reject
→ resume); the design rule "don't interrupt on reversible steps" is why the gate sits at implementation —
the most expensive, least-reversible step — and not earlier. Measuring critic/reviewer effectiveness is
*component-level agent evaluation*; the single most valuable signal is the **escaped defect** — a bug the
live test caught that critic **and** reviewer both passed. The pipeline already produces every input for
this (`criticRounds`, `reviewRounds`, live-test result, and per-agent `subagent_tokens`/`tool_uses`/
`duration_ms` from each `task-notification`); it just never persists them. Storage is a **committed JSONL
file**, not Langfuse/OTel — a deliberate DECISIONS §30 call (see "DECISIONS entry" below); OTel export
stays the documented escape hatch for later if dashboards are ever wanted.

This plan touches **only the dev pipeline** (`.claude/` + `docs/`). No game code, no server, no assets.

---

## Change 1 — Review gate (new Stage 4.5)

### 1a. Insert the stage in `SKILL.md`

In `.claude/skills/feature-pipeline/SKILL.md`, insert a new stage **between the end of Stage 4 (current
line 57) and the start of Stage 5 (current line 59)**. Text:

```markdown
## Stage 4.5 — Review gate (human checkpoint before implementation)

The critic approved the plan; now the **maintainer** approves it before any code is written. This is the
one interrupt on the expensive, least-reversible step (implementation + deploy) — keep it, but make it
fast to clear.

Read the approved plan file (`docs/plans/<id>.md` in the worktree) and assemble a **compact digest** — do
NOT paste the whole plan. It has exactly four parts:

1. **What the critic caught & how it was resolved** — one bullet per blocking issue raised across the
   critic rounds (empty if the critic approved on round 1 — say "critic approved first pass, no blocking
   issues").
2. **Files that will change** — the file list from the plan's implementation steps (paths only).
3. **Tests planned** — the plan's testing section: new test files/cases, or "existing suite only (no new
   tests)" with the reason the plan gives.
4. **Open decisions** — any decisions the plan recorded (with the chosen answer), so the maintainer can
   veto a choice before it is built.

Then ask via `AskUserQuestion` (header "Review gate"): **Approve the plan for implementation?**
- **Approve** → proceed to Stage 5.
- **Request changes** (maintainer types what to change) → `SendMessage` the notes to the planner
  (**REVISE** mode); it edits the plan; then continue the **same** critic (`SendMessage`) to re-verify
  the edited plan is still sound; then **re-show this gate**. Increment `plannerRevisions` (and
  `criticRounds` for the re-verify). Record the maintainer's edit request in the run-log `review_gate`.
- **Stop** → do not implement. Ask whether to **park** (leave worktree + branch) or **abandon**
  (`git worktree remove --force` + `git branch -D`). Persist the run-log record (Stage 11) with
  `outcome: "parked"`/`"abandoned"` and `review_gate.decision: "stop"`, then end the run.

Keep the digest tight — the goal is a 20-second read that lets the maintainer catch a wrong direction
*before* implementation, not a re-review of the whole plan.
```

### 1b. Reflect it in the flow + notes

- Update the flow diagram in `docs/plans/multi-agent-pipeline.md` (current lines 61-66) to add the gate:
  ```
  → [critic ⇄ planner]×≤5 (target ≤2) → APPROVE
  → REVIEW GATE (maintainer approve/edit/stop)
  → implementer → [reviewer ⇄ implementer]×≤3 → PASS
  ```
- Add a short paragraph under the flow (after current line 74) describing the gate and citing the HITL
  rationale ("the one interrupt on the least-reversible step").

---

## Change 2 — Committed run-log (`docs/pipeline-runs.jsonl`)

### 2a. File + format

- **Path:** `docs/pipeline-runs.jsonl` (repo root `docs/`, committed — **not** gitignored).
- **Format:** one JSON object per line (JSONL), append-only, newest line last. Never rewrite past lines.
- **Why JSONL, not CSV:** the records are nested (per-agent objects, findings arrays) and the schema will
  grow; CSV can't hold that without flattening, JSONL diffs cleanly in git and is read as a table by
  DuckDB/jq directly. (If SQL-with-indexes is ever needed, a committed SQLite file is the next step — not
  now, §30.)

### 2b. Record schema

One record per pipeline run. Fields are gathered **in memory as the run progresses** and the line is
**appended once at the end** (Stage 11). Worked example using this repo's own `return-to-base-button` run:

```json
{
  "id": "2026-07-06-2044-return-to-base-button",
  "slug": "return-to-base-button",
  "date": "2026-07-06",
  "feature": "Bottom-center \"Return to base\" button shown on mission complete; taps engageAutopilot().",
  "outcome": "deployed",
  "counters": {
    "plannerRevisions": 1,
    "criticRounds": 1,
    "reviewRounds": 0,
    "scopeGrewInDiscovery": false
  },
  "agents": {
    "planner":     { "tokens": 172025, "tool_uses": 23, "duration_ms": 252776 },
    "critic":      { "tokens": 114060, "tool_uses": 13, "duration_ms": 177164 },
    "implementer": { "tokens": 61757,  "tool_uses": 33, "duration_ms": 217307 },
    "reviewer":    { "tokens": 28725,  "tool_uses": 9,  "duration_ms": 70699 }
  },
  "critic_findings":   ["DECISIONS §42 touch bug: bare click handler dead while steering — resolved (split touchstart/mouse wiring)"],
  "reviewer_findings": [],
  "planned_tests":     ["existing client suite only (no new test file); i18n JSON parse check — plan's rationale: DOM/CSS/i18n-only affordance"],
  "review_gate":       { "decision": "approve", "edits": [] },
  "human_review":      { "decision": "approve", "rounds": 0 },
  "live_test":         { "channel": "maintainer-manual", "result": "pass", "escaped_defects": [] },
  "flags":             []
}
```

**Field notes / how each is populated:**

| Field | Source | When set |
|---|---|---|
| `id` / `slug` / `date` / `feature` | Stage 0 intake | at start |
| `outcome` | `deployed` / `parked` / `abandoned` / `escalated` | Stage 8 (or terminal point) |
| `counters.*` | the four counters the orchestrator already tracks (SKILL.md line 18-19) | throughout |
| `agents.<name>` | **sum** across ALL of that agent's `task-notification` `<usage>` blocks — planner across discovery + plan + every revision; critic across every round; implementer across the initial run + every fix; reviewer across every round | as notifications arrive |
| `critic_findings` | one short string per blocking issue the critic raised (across rounds); `[]` if approved first pass | Stage 4 / 4.5 |
| `reviewer_findings` | one short string per CHANGES finding the reviewer raised; `[]` if PASS first pass | Stage 6 |
| `planned_tests` | the plan's testing section (what will be added, or "existing suite only" + reason) | Stage 4.5 |
| `review_gate` | `{decision: "approve"\|"stop", edits: [<maintainer change requests>]}` | Stage 4.5 |
| `human_review` | `{decision: "approve"\|"request-changes", rounds: <# of human-requested fix loops>}` | Stage 6.5 |
| `live_test` | `{channel, result: "pass"\|"fail"\|"skipped"\|"accepted-gaps", escaped_defects: [<bugs live-test caught that critic+reviewer both passed>]}` | Stage 9 |
| `flags` | the retro flags that fired (e.g. `"planner:revised>1"`, `"critic:rounds>2"`, `"reviewer:rounds>1"`, `"escaped-defect"`) | Stage 7 + 9 |

> **`duration_ms` caveat (document it in the doc, not just here):** the notification duration is the
> agent's wall-clock *including* the orchestrator's think/relay pauses between `SendMessage`s — it is a
> good *relative* cost signal but not pure model time. Pure per-call latency needs the OTel layer
> (escape hatch, deferred). `tokens` is exact.

### 2c. Append mechanism (Stage 11)

Add a final stage to `SKILL.md` (after Stage 10, current line 133):

```markdown
## Stage 11 — Persist run record (always, at the terminal point)

Whatever way the run ended (deployed, parked, abandoned, or escalated), append **one** JSONL line to
`docs/pipeline-runs.jsonl` in the **main checkout** (not the worktree — the worktree may already be
removed) with the schema in `docs/plans/pipeline-review-gate-and-run-log.md`. Build the record in memory
across the run and write it once here.

- Append with a single `Write`-free shell append so nothing above is touched:
  `printf '%s\n' "$RECORD_JSON" >> docs/pipeline-runs.jsonl` (the record must be valid single-line JSON;
  verify with `tail -1 docs/pipeline-runs.jsonl | jq .` before finishing).
- **Commit policy:** the log line is committed on `main` as part of, or immediately after, the deploy
  commit sequence. On a **deployed** run, append + `git add docs/pipeline-runs.jsonl && git commit -m
  "chore(pipeline): log run <id>"` AFTER the feature merge/push, so a failed run never dirties `main`. On
  a **parked/abandoned/escalated** run, still append + commit the line (it is data about a real run) but
  tell the maintainer. If the working-tree guard (Stage 8) stashed unrelated work, append the line while
  the stash is applied (after `git stash pop`) so it isn't stashed away.
- If a run dies mid-flight (session lost), the record is simply not written — acceptable (§30); no
  partial/locking machinery.
```

Also add a one-line pointer in the **counters** note (SKILL.md line 18-19): "…these counters, plus
per-agent usage from each `task-notification`, are persisted to `docs/pipeline-runs.jsonl` at Stage 11."

---

## Change 3 — Effectiveness metrics (derived at analysis time, not stored)

Do **not** precompute rates into the log — derive them from the raw records so definitions can evolve.
Document these recipes in `docs/plans/multi-agent-pipeline.md` under a new "## Analyzing runs" section.

**Metric definitions:**
- **Critic catch rate** = runs with ≥1 `critic_findings` ÷ total runs. (Is the critic earning its slot?)
- **Reviewer catch rate** = runs with `reviewRounds > 0` ÷ total runs.
- **Escaped-defect rate** = runs with non-empty `live_test.escaped_defects` ÷ deployed+live-tested runs.
  **The headline metric** — a bug that reached live test means critic *and* reviewer both missed it.
- **Planner miss rate** = runs with `plannerRevisions > 1` OR `scopeGrewInDiscovery` ÷ total.
- **Cost per feature** = sum of `agents.*.tokens`; trend over time; split by agent to see where tokens go.

**jq quick-look (no dependencies):**
```bash
# total runs, critic catch rate, escaped-defect count
jq -s '{runs: length,
        critic_caught: (map(select(.critic_findings|length>0))|length),
        escaped: (map(.live_test.escaped_defects|length)|add)}' docs/pipeline-runs.jsonl

# tokens per agent, summed across all runs
jq -s 'map(.agents|to_entries[])|group_by(.key)
       |map({agent: .[0].key, tokens: (map(.value.tokens)|add)})' docs/pipeline-runs.jsonl
```

**DuckDB (for real trend queries, reads JSONL as a table):**
```sql
-- one row per run, newest first (agents is inferred as a fixed STRUCT, not a MAP)
SELECT date, id, counters.criticRounds, counters.reviewRounds,
       agents.planner.tokens + agents.critic.tokens
     + agents.implementer.tokens + agents.reviewer.tokens AS total_tokens,
       len(live_test.escaped_defects) AS escaped
FROM read_json_auto('docs/pipeline-runs.jsonl')
ORDER BY date DESC;
```
(jq recipes verified against the seed row; the DuckDB snippet is a starting point — DuckDB wasn't
installed locally, adjust to your version.)

Optionally (deferred, only if querying gets frequent) a tiny `scripts/pipeline-stats.mjs` that prints the
rates — **not** part of this plan's first cut; the jq/DuckDB recipes are enough (§30).

---

## Docs to update when implementing

- **`.claude/skills/feature-pipeline/SKILL.md`** — new Stage 4.5, new Stage 11, counters note (2b/2c above).
- **`docs/plans/multi-agent-pipeline.md`** — flow diagram (+ gate line), a gate paragraph, a new
  "## Analyzing runs" section (metric defs + query recipes), and mention the run-log in the retro section.
- **`docs/CHANGELOG.md`** — bullet under today's date: pipeline gained a pre-implementation review gate +
  committed `pipeline-runs.jsonl` run-log with per-agent token/time metrics.
- **`docs/DECISIONS.md`** — **add an entry** (real trade-off): "Pipeline run history = committed JSONL,
  not an observability platform." Rationale: single author, a few runs at a time; a git-diffable
  human-readable journal + jq/DuckDB beats standing up Langfuse/OTel + ClickHouse/Redis; OTel export
  (`CLAUDE_CODE_ENABLE_TELEMETRY=1` → collector) documented as the escape hatch if run volume or a
  dashboard need ever justifies it. Alternatives considered: CSV (rejected — nested/evolving schema),
  SQLite committed (deferred — JSONL is enough until SQL/indexes are needed), SaaS observability
  (rejected now — §30 over-engineering for a single author).
- **`docs/SUMMARY.md`** — no change (SUMMARY describes the game, not the dev pipeline).
- Seed `docs/pipeline-runs.jsonl` with the worked-example line above (the `return-to-base-button` run) so
  the file exists and the queries have data on day one.

## Acceptance criteria (how to verify after implementing)

1. Run `/feature-pipeline` on any small change → after critic APPROVE, the **review gate appears** with
   the four-part digest and approve/edit/stop choices, **before** the implementer is spawned.
2. Choosing **Request changes** loops through planner-revise → critic-reverify → gate re-shown; choosing
   **Stop** ends the run and still writes a run-log line with `outcome != deployed`.
3. After the run, `docs/pipeline-runs.jsonl` has **exactly one new valid line**
   (`tail -1 docs/pipeline-runs.jsonl | jq .` succeeds) with per-agent token sums, the counters, findings,
   and live-test outcome populated.
4. The jq and DuckDB recipes in `multi-agent-pipeline.md` run against the file and return sane numbers.
5. `main` is never dirtied by an abandoned run; the log line is committed only at the terminal point.

## Open questions (resolved)

- **Storage:** committed JSONL in `docs/`. (Maintainer choice 2026-07-06; DECISIONS entry above.)
- **Gate always-on?** Yes — it guards the least-reversible step. A "trust mode" that skips it is deferred
  until the gate proves annoying in practice (§30), not pre-built.
- **Precompute rates into the log?** No — derive at query time so metric definitions can change without a
  migration.
- **Per-agent time fidelity?** `tokens` exact; `duration_ms` is wall-clock incl. orchestrator pauses —
  documented caveat; pure model latency deferred to the OTel escape hatch.
