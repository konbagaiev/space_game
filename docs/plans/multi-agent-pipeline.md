# Multi-agent development pipeline

**Goal.** Turn "I want feature X" into a shipped, reviewed change with minimal hand-holding, by
orchestrating four single-purpose agents — **planner → critic → implementer → reviewer** — each with a
clean context, plus a final retro that feeds the agents' own improvement.

This file is the self-contained spec. The runnable pieces:
- **Orchestrator:** `.claude/skills/feature-pipeline/SKILL.md` (invoke with `/feature-pipeline`).
- **Agents:** `.claude/agents/feature-planner.md`, `plan-critic.md`, `feature-implementer.md`,
  `code-reviewer.md`.

It follows the project's own rules (`CLAUDE.md`): plans land in `docs/plans/`, docs get updated as part
of the change (SUMMARY / CHANGELOG / DECISIONS), everything is English. It also follows DECISIONS §30 —
**keep the process simple until a real problem forces more** (this is why there is no feature registry).

---

## Roles (each agent = fresh context)

The orchestrator (the main session) owns all interaction with the maintainer and passes each agent
exactly the context it needs — **references to docs, not pasted copies**, plus the small dynamic bits
(feature text, answers, critique, findings). Agents inherit `CLAUDE.md` + project memory automatically,
so the rules are already in their context.

1. **feature-planner** — reads DECISIONS / SUMMARY / relevant `plans/*` (+ CHANGELOG if needed), asks the
   maintainer clarifying questions, then writes a **self-contained, executable** plan to
   `docs/plans/<id>.md`. The plan must be detailed enough that the implementer needs **no further
   questions**. Revises the plan in response to the critic.
2. **plan-critic** — independent, read-only. Judges (feature description + plan) against DECISIONS /
   SUMMARY and a plan-quality rubric. Returns `APPROVE` or `REVISE` + specific **blocking** issues.
3. **feature-implementer** — executes the approved plan inside the worktree: code, tests, doc updates.
   No questions to the maintainer (the plan is self-contained); if genuinely blocked, reports up.
4. **code-reviewer** — independent, read-only. Reviews the diff against the plan + a code rubric. Returns
   `PASS` or `CHANGES` + findings.

## Feature ID (DECISIONS §30)

`YYYY-MM-DD-HHMM-<slug>` — e.g. `2026-06-30-1612-laser-cannon`. From `date +%Y-%m-%d-%H%M` + a kebab
slug. The **same ID** is the plan filename (`docs/plans/<id>.md`), the git branch (`feature/<id>`), the
worktree dir (`../ag-wt/<id>`), and the CHANGELOG tag (`[<id>]`). No registry — a timestamp is
collision-free for a single author.

## Isolation: git worktree

Each feature gets its own worktree so several features can be in flight at once without touching `main`:

```bash
git worktree add -b feature/<id> ../ag-wt/<id>     # new branch + new working dir off current HEAD
# ... planner/implementer/reviewer all operate with absolute paths under ../ag-wt/<id> ...
git worktree remove ../ag-wt/<id>                  # after merge (or --force to abandon)
```

Worktrees share the repo's `.git` (cheap, instant; not a clone). `main` stays clean the whole time.
"Deploy" = merge `feature/<id>` into `main` and push; the GitHub Actions `ci-cd.yml` pipeline tests +
zero-downtime-deploys to vega.tenony.com.

---

## Flow

```
intake → worktree → planner(questions) → ASK MAINTAINER → planner(plan)
       → [critic ⇄ planner]×≤5 (target ≤2) → APPROVE
       → REVIEW GATE (maintainer approve / request-changes / stop)
       → implementer → [reviewer ⇄ implementer]×≤3 → PASS
       → HUMAN CODE REVIEW (maintainer diff walkthrough → approve / request-changes)
       → PERF A/B GATE (node client/bench/run.mjs; A=merge-base, B=worktree)
       → retro (metrics) → deploy? → DEPLOY/park → LIVE TEST → satisfaction + self-improve
       → persist run record (docs/pipeline-runs.jsonl)
```

**PERF A/B GATE (after human review, before retro).** Catches a >2% per-frame **CPU** regression before it
lands (DECISIONS §58). The orchestrator: computes the **merge-base** of the worktree branch vs `main`;
materializes build **A** from that merge-base (`git worktree add` at the merge-base commit, or `git archive`
to a temp dir) and sets `BENCH_A_DIR` = that build's `client/` and `BENCH_B_DIR` = the worktree `client/`;
runs `node client/bench/run.mjs` from the worktree. Then:
- **Any trace verdict `REGRESSION`** → surface the per-bucket table to the maintainer as a **blocking
  question** (same posture as the reviewer returning CHANGES / the deploy y/n): the maintainer decides —
  **accept** (an intended cost), **send back to the implementer**, or **abandon**.
- **All `FLAT`/`IMPROVED`** → note it and continue.
- Runner prints **`gate inactive`** (the merge-base predates the bench harness, so build A has no
  `window.__bench`) → note it and continue. This is the expected result until the first feature merges
  *after* the harness itself.

It is **CPU-only** (the `js.*` buckets); a green gate is not "no weak-phone regression" — the GPU/fill-rate
half stays with real-device `?dev` (§23). It is a **documented stage the orchestrator runs**, not a GitHub
Actions job.

**Agent feedback comes *after* a live test, not before.** Passing automated suites does not prove the
feature works for a human on a real device (esp. touch/feel/visual changes). So the retro asks only the
**deploy** question; the feature is then deployed (or built for a parked worktree) and **exercised live**
— maintainer-manual on a device, or agent-driven via Claude-in-Chrome / a local+tunnel build — against a
concrete checklist derived from the acceptance criteria. A live-test failure the automated tests missed is
itself the most valuable self-improve signal. Only after the live test is settled does the orchestrator
collect per-agent satisfaction and append learned guidance.

**Review gate (before implementation).** After the critic approves, the maintainer sees a compact digest —
what the critic caught & how it was resolved, the files that will change, the tests planned, and any open
decisions — and chooses **approve / request-changes / stop**. This is the one human-in-the-loop interrupt,
placed on the least-reversible step (implementation + deploy) per the "don't interrupt on reversible steps"
rule; earlier stages (discovery questions) already have their own asks. "Request-changes" loops
planner→critic→gate; "stop" parks or abandons the run.

**Human code review (after the agent).** After the `code-reviewer` agent returns PASS, the maintainer
reviews the actual diff before commit (Stage 6.5, every run). This is **not** a correctness re-check — the
agent and the test suite already did that — its purpose is a final human sign-off and, chiefly, to keep the
maintainer's mental model of the codebase current. The orchestrator gives a **guided walkthrough** (per
changed file: what changed, why, how it fits the architecture, with `file:line` refs) **and shows the
diff**, then asks approve / request-changes. "Request-changes" loops implementer→reviewer→walkthrough.

- **Critic loop:** max 5 rounds; aim for ≤2. At 5 without APPROVE → **stop and escalate** to the
  maintainer with the outstanding blockers.
- **Review loop:** max 3 rounds. At 3 without PASS → escalate.
- **Iterating an agent** (planner revising, implementer fixing) continues the *same* agent via
  `SendMessage` so its context is preserved; the critic and reviewer also continue across rounds so they
  can verify their prior points were addressed.

## Retro metrics & flags

The orchestrator counts, and at the end flags when a count suggests an agent needs improvement:

| Signal | Flag when | Likely lesson |
|---|---|---|
| Planner | maintainer added **major new scope** during discovery, or plan revised **>1×** | planner missed context — improve discovery / doc reading |
| Critic | **>2** critic rounds | critic's bar unclear or planner under-specifies repeatedly |
| Reviewer | **>1** review round | implementer missed rubric items, or reviewer's rubric is vague |
| Perf gate | `FLAT` / `REGRESSION(bucket, Δ%)` / `inactive` | a REGRESSION the maintainer accepted may signal a perf-blind implementer or plan |

After PASS the orchestrator: shows what was built + test status + these metrics, asks **deploy y/n**,
deploys (or parks), runs a **live test** of the result, and *then* asks **satisfaction per agent** —
informed by how the feature actually behaved live. Any dissatisfaction, flag, or live-test failure →
capture the concrete gripe and append a dated note to that agent's `## Learned guidance` section (and a
memory `feedback` note). The agents'
rubrics thus grow from *real* feedback, not speculation (DECISIONS §30).

Every run is also persisted as one line in **`docs/pipeline-runs.jsonl`** (committed) — per-agent
tokens/tool-calls/time, the counters, critic/reviewer findings, the review-gate decision, and the
live-test outcome. See "Analyzing runs" below. (DECISIONS §55: a committed JSONL journal, not an
observability platform.)

## Analyzing runs

`docs/pipeline-runs.jsonl` is the longitudinal record. Rates are **derived at query time** (not stored),
so definitions can evolve without a migration. Full schema + a worked example:
`docs/plans/pipeline-review-gate-and-run-log.md`.

Key metrics:
- **Critic catch rate** — runs with ≥1 `critic_findings` ÷ total. (Is the critic earning its slot?)
- **Reviewer catch rate** — runs with `reviewRounds > 0` ÷ total.
- **Escaped-defect rate** — runs with non-empty `live_test.escaped_defects` ÷ deployed+live-tested runs.
  **The headline** — a bug that reached the live test means critic *and* reviewer both missed it.
- **Planner miss rate** — runs with `plannerRevisions > 1` OR `scopeGrewInDiscovery` ÷ total.
- **Cost per feature** — sum of `agents.*.tokens`, split by agent, trended over time.

```bash
# runs, critic catch count, total escaped defects
jq -s '{runs: length,
        critic_caught: (map(select(.critic_findings|length>0))|length),
        escaped: (map(.live_test.escaped_defects|length)|add)}' docs/pipeline-runs.jsonl

# tokens per agent, summed across all runs
jq -s 'map(.agents|to_entries[])|group_by(.key)
       |map({agent: .[0].key, tokens: (map(.value.tokens)|add)})' docs/pipeline-runs.jsonl
```

```sql
-- DuckDB: one row per run, newest first (agents is inferred as a fixed STRUCT)
SELECT date, id, counters.criticRounds, counters.reviewRounds,
       agents.planner.tokens + agents.critic.tokens
     + agents.implementer.tokens + agents.reviewer.tokens AS total_tokens,
       len(live_test.escaped_defects) AS escaped
FROM read_json_auto('docs/pipeline-runs.jsonl')
ORDER BY date DESC;
```
(The `jq` recipes are verified against the seed row; the DuckDB one is a starting point — adjust to your
DuckDB version.)

Note: `duration_ms` is the agent's wall-clock **including** orchestrator pauses between `SendMessage`s — a
good relative cost signal, not pure model latency (that needs the OTel escape hatch, §55). `tokens` is exact.

## Initial code-review rubric (grows over time)

Tests exist for new logic **and the full suite passes** (`client && node --test`, `server && npm test`) ·
logic is modularized, **not dumped into `index.html`** (see `docs/plans/client-code-structure.md`) ·
SUMMARY updated to match reality + CHANGELOG bullet added (+ DECISIONS entry if a real trade-off) ·
English-only · matches surrounding style · no secrets / dead code · the plan was actually fulfilled · not
over-engineered (DECISIONS §30) · **a new/moved UI element is checked for on-screen overlap** — enumerate
what already occupies that screen region (**especially the touch/phone layout**: the bottom-center bar, the
corners, the zoom pair, the rocket/fire buttons) and confirm the new element collides with none of them.
This is a real escaped defect: the Return-to-base button shipped overlapping the bottom-center touch zoom
pair because neither the plan, the critic, nor the reviewer enumerated the existing touch-layout elements.

## Open questions (resolved)

- **IDs:** timestamp, not sequential+registry. (DECISIONS §30.)
- **Implementer:** a dedicated agent (not the orchestrator) so the reviewer judges independent work.
- **Deploy:** merge/push to `main` → CI/CD. Pipeline does it on a "yes".
- **Single author** assumed; multi-author is the trigger to revisit locking/allocation — not now.
