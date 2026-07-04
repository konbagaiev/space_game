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
       → implementer → [reviewer ⇄ implementer]×≤3 → PASS
       → PERF A/B GATE (node client/bench/run.mjs; A=merge-base, B=worktree)
       → retro (metrics + satisfaction) → deploy? → self-improve
```

**PERF A/B GATE (after reviewer PASS, before retro).** Catches a >2% per-frame **CPU** regression before it
lands (DECISIONS §43). The orchestrator: computes the **merge-base** of the worktree branch vs `main`;
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

After PASS the orchestrator: shows what was built + test status + these metrics, asks **deploy y/n**, and
asks **satisfaction per agent**. Any dissatisfaction or flag → capture the concrete gripe and append a
dated note to that agent's `## Learned guidance` section (and a memory `feedback` note). The agents'
rubrics thus grow from *real* feedback, not speculation (DECISIONS §30).

## Initial code-review rubric (grows over time)

Tests exist for new logic **and the full suite passes** (`client && node --test`, `server && npm test`) ·
logic is modularized, **not dumped into `index.html`** (see `docs/plans/client-code-structure.md`) ·
SUMMARY updated to match reality + CHANGELOG bullet added (+ DECISIONS entry if a real trade-off) ·
English-only · matches surrounding style · no secrets / dead code · the plan was actually fulfilled · not
over-engineered (DECISIONS §30).

## Open questions (resolved)

- **IDs:** timestamp, not sequential+registry. (DECISIONS §30.)
- **Implementer:** a dedicated agent (not the orchestrator) so the reviewer judges independent work.
- **Deploy:** merge/push to `main` → CI/CD. Pipeline does it on a "yes".
- **Single author** assumed; multi-author is the trigger to revisit locking/allocation — not now.
