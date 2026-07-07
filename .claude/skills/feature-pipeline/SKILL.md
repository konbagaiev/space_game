---
name: feature-pipeline
description: Run a feature end-to-end through four agents — planner → critic → implementer → reviewer — in an isolated git worktree, then a retro + optional deploy. Use when the maintainer wants to build a new feature or change with the full pipeline. Full spec: docs/plans/multi-agent-pipeline.md.
---

# Feature pipeline (orchestrator)

You are the **orchestrator**. You own all interaction with the maintainer; the four agents
(`feature-planner`, `plan-critic`, `feature-implementer`, `code-reviewer`) each run with a **clean
context**, so you must hand each one the context it needs: **references to docs (paths), not pasted
copies**, plus the dynamic bits (feature text, answers, critique, findings). Spawn an agent with the
`Agent` tool (`subagent_type` = the agent name). To iterate an agent while keeping its context, continue
it with `SendMessage` rather than spawning a fresh one.

Full rationale and rules: `docs/plans/multi-agent-pipeline.md`. Follow `CLAUDE.md` and DECISIONS §30
(**keep it simple — don't over-engineer**). Consider using `TaskCreate` to track the stages below.

Track these counters across the run for the retro: `plannerRevisions`, `scopeGrewInDiscovery` (bool),
`criticRounds`, `reviewRounds`, `perfGate` (`FLAT`/`REGRESSION(…)`/`inactive`, from Stage 6.7). These counters, plus per-agent usage (`subagent_tokens` / `tool_uses` /
`duration_ms`) summed from each `task-notification`, are persisted to `docs/pipeline-runs.jsonl` at
Stage 11 — so build the run record in memory as you go.

---

## Stage 0 — Intake

- Get the feature description (skill argument, else ask). Propose a short kebab **slug** and confirm it.
- `ts=$(date +%Y-%m-%d-%H%M)`; **feature ID** = `<ts>-<slug>`. Tell the maintainer the ID.
- Confirm the repo is on `main` and reasonably clean (`git status`).

## Stage 1 — Worktree

From the repo root: `git worktree add -b feature/<id> ../ag-wt/<id>`. The absolute worktree path
(`../ag-wt/<id>` resolved) is passed to every agent — all their file ops use absolute paths under it.

## Stage 2 — Planning: discovery

Spawn `feature-planner` in **DISCOVERY** mode with: the feature description, the feature ID/slug, the
worktree path, and a reminder to read DECISIONS/SUMMARY/relevant plans. It returns clarifying questions
(or `READY — no questions.`).

Relay the questions to the maintainer via `AskUserQuestion` (batch ≤4 per call; include the planner's
suggested defaults as options). If the maintainer's answers introduce **substantial new scope** beyond
the original request, set `scopeGrewInDiscovery = true` (a planner-context signal for the retro).

## Stage 3 — Planning: write

Continue the **same** planner (`SendMessage`) in **PLAN** mode with the answers. It writes
`docs/plans/<id>.md` in the worktree and returns the path + summary. Show the maintainer the summary.

## Stage 4 — Critic loop (max 5, target ≤2)

Spawn `plan-critic` with the feature description, the plan path, and the worktree path.
- If `VERDICT: APPROVE` → break.
- If `VERDICT: REVISE` → `SendMessage` the blocking issues to the planner (**REVISE** mode) → it edits the
  plan → continue the **same** critic (`SendMessage`) with "verify your issues are resolved". Increment
  `criticRounds` and `plannerRevisions`.
- If `criticRounds` reaches **5** without APPROVE → **STOP. Escalate** to the maintainer: summarize the
  critic's outstanding blockers + the planner's last response, and ask how to proceed. Do not implement.

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
  `criticRounds` for the re-verify). Record the maintainer's edit request in the run-log `review_gate.edits`.
- **Stop** → do not implement. Ask whether to **park** (leave worktree + branch) or **abandon**
  (`git worktree remove --force` + `git branch -D`). Persist the run record (Stage 11) with
  `outcome: "parked"`/`"abandoned"` and `review_gate.decision: "stop"`, then end the run.

Keep the digest tight — the goal is a 20-second read that lets the maintainer catch a wrong direction
*before* implementation, not a re-review of the whole plan.

## Stage 5 — Implement

Spawn `feature-implementer` with the plan path and the worktree path. It writes code + tests + doc
updates inside the worktree and reports (with test output). If it reports a hard blocker, escalate to the
maintainer.

## Stage 6 — Review loop (max 3)

Spawn `code-reviewer` with the plan path, worktree path, and branch `feature/<id>`. It runs the suites
and reviews the diff.
- If `VERDICT: PASS` → break.
- If `VERDICT: CHANGES` → `SendMessage` the findings to the implementer (**fix mode**) → it fixes + re-runs
  tests → continue the **same** reviewer (`SendMessage`) to re-check. Increment `reviewRounds`.
- If `reviewRounds` reaches **3** without PASS → escalate to the maintainer with the open findings.

## Stage 6.5 — Human code review (maintainer reviews the diff)

The `code-reviewer` agent passed; now the **maintainer** reviews the actual diff before commit. This runs
**every run**. It is NOT a correctness re-check (the agent + tests already did that) — its point is a final
human sign-off and, chiefly, to **keep the maintainer's mental model of the codebase current** (where new
code lives, what it touches, why it's placed there).

- Get the diff from the worktree: `git -C <worktree> diff --stat main` (file overview) and
  `git -C <worktree> diff main` (the hunks).
- Present a **guided walkthrough** (the maintainer's stated goal is understanding structure, so lead with
  architecture, not a line-by-line restatement): for **each changed file** — what changed, why, and how it
  fits the existing code — with `file:line` refs and ties back to the plan. **Then show the diff itself**
  (the `--stat` summary + the actual hunks; for a large diff, show `--stat` + the key hunks and point the
  maintainer to read the rest in their editor).
- Ask via `AskUserQuestion` (header "Code review"): **Approve the diff?**
  - **Approve** → proceed to Stage 7 (commit).
  - **Request changes** (maintainer says what) → `SendMessage` the notes to the implementer (**fix mode**)
    → it fixes + re-runs tests → continue the **same** `code-reviewer` agent to re-check (increment
    `reviewRounds`) → **re-show this walkthrough**.
  - Record the decision + how many human rounds in the run-log `human_review`.

## Stage 6.7 — Perf A/B gate (after human review, before commit)

Catch a >2% per-frame **CPU** regression before it lands (DECISIONS §58, `docs/plans/multi-agent-pipeline.md`).
Do this yourself (no agent) after the human review approves:
- Compute the merge-base: `base=$(git -C <worktree> merge-base HEAD main)`.
- Materialize build **A** from the merge-base into a temp dir (e.g. `git -C <worktree> archive "$base" | tar -x
  -C <tmpA>`), and run from the worktree:
  `cd <worktree>/client && BENCH_A_DIR=<tmpA>/client BENCH_B_DIR=<worktree>/client node bench/run.mjs`.
- Read the verdict and record `perfGate` for the retro:
  - **`gate inactive`** (merge-base predates the bench harness → build A has no `window.__bench`) → note it,
    `perfGate = inactive`, continue. Expected until the first feature merges after the harness itself.
  - **All traces `FLAT`/`IMPROVED`** → `perfGate = FLAT`, continue.
  - **Any `REGRESSION`** → set `perfGate = REGRESSION(bucket, Δ%)` and **STOP: surface the per-bucket table to
    the maintainer as a blocking question** (same posture as a reviewer CHANGES): accept the intended cost /
    send back to the implementer (fix mode) / abandon. Only continue on the maintainer's call.
- It is **CPU-only** — a green gate is not "no weak-phone regression"; the GPU half stays with real-device
  `?dev`. Say so if the maintainer treats FLAT as a full all-clear.

## Stage 7 — Commit + retro (metrics only — do NOT collect agent feedback yet)

- Ensure the work is committed on the branch: `git -C <worktree> add -A && git -C <worktree> commit` with
  a message summarizing the feature and ending with the Co-Authored-By trailer (see CLAUDE.md/Bash rules).
- Present a **retro** to the maintainer:
  - What was built + final (automated) test status.
  - **Metrics with flags:**
    - Planner — flag if `scopeGrewInDiscovery` or `plannerRevisions > 1` → "planner likely missed context;
      consider improving its discovery." (Note: `scopeGrewInDiscovery` caused by the *maintainer adding
      scope* during discovery is not a planner miss — say so rather than blaming the planner.)
    - Critic — flag if `criticRounds > 2`.
    - Reviewer — flag if `reviewRounds > 1`.
    - Perf gate — report `perfGate` = `FLAT` / `REGRESSION(bucket, Δ%)` / `inactive`; a REGRESSION the
      maintainer accepted may signal a perf-blind implementer or plan.
  - If any flag fired, name it explicitly to the maintainer (this is the whole point of the retro).
- Ask, via `AskUserQuestion`, the **deploy question ONLY**: **Deploy this feature?** (yes / not yet / abandon).
  **Do NOT ask for per-agent satisfaction here** — agent feedback is collected in Stage 9, *after* the live
  test, because the automated suites don't prove the feature actually works for a human on a real device.

## Stage 8 — Deploy or park

- **Deploy = yes:** from the repo root —
  `git checkout main && git pull --rebase && git merge --no-ff feature/<id> && git push`. The GitHub
  Actions `ci-cd.yml` runs the tests and zero-downtime-deploys to vega.tenony.com — tell the maintainer to
  watch the Actions run. Then clean up: `git worktree remove ../ag-wt/<id>` and `git branch -d feature/<id>`.
  - **Guard the working tree:** if `git status` in the main checkout shows **unrelated uncommitted work**
    (a parallel effort — this is a single-author repo with multiple terminals), do NOT commit or discard it.
    Surface it to the maintainer, then `git stash push -u` around the merge/push and `git stash pop`
    afterward (fully reversible; your feature files won't overlap). Confirm the stash restored cleanly.
- **Not yet:** leave the worktree and branch in place; tell the maintainer the worktree path so they can
  resume or deploy later. Live-test from the worktree build instead (Stage 9).
- **Abandon** (if asked): `git worktree remove --force ../ag-wt/<id>` and `git branch -D feature/<id>` — then
  skip Stages 9–10.

## Stage 9 — Live test (the result must be exercised for real BEFORE agent feedback)

Automated tests passing is **not** proof the feature works — a human (or an agent driving the real app)
must exercise the deployed/built result. Do this before collecting any agent feedback.

- Write a **concrete live-test checklist** derived from the feature's acceptance criteria (the plan's
  goal + any maintainer-reported bug). Each item = a specific action → expected observable result
  (e.g. "on a phone, during return-to-base, tap the station → ship autopilots home and docks").
- Pick the test channel with the maintainer (default per the change's nature):
  - **Maintainer-manual** — give them the URL (prod `https://vega.tenony.com` after deploy, or a
    tunnel/local URL if parked) + the checklist; they report pass/fail per item. Best for touch/feel/device.
  - **Agent-driven** — drive the running app via Claude-in-Chrome (touch emulation) or a local+tunnel build.
    Good for deterministic UI flows; note it's not a real device.
- **Wait for the live-test result.** If an item **fails live**, that's a real miss the automated suite
  didn't catch → loop back to Stage 5 (implementer fix) or escalate, and record it as concrete Stage-10
  feedback for the responsible agent. Only proceed to Stage 10 once the live test is settled (pass, or the
  maintainer accepts the remaining gaps).

## Stage 10 — Feedback + self-improve (informed by the live test)

- Now ask, via `AskUserQuestion`: **Satisfaction per agent** (planner / critic / implementer / reviewer) —
  and for any flagged, live-test-failing, or unhappy agent, ask for the **specific** gripe.
- For each agent the maintainer was unhappy with (or that got flagged, or whose work failed the live test),
  append a **dated** bullet to that agent file's `## Learned guidance` section (`.claude/agents/<agent>.md`)
  capturing the concrete lesson (e.g. "2026-06-30: missed that catalog only reseeds on server restart —
  always check SUMMARY's data-model section"; or a live-test miss the automated tests couldn't catch).
  Also write a short memory `feedback` note. Keep lessons concrete and few — grow rubrics from real misses,
  not speculation (DECISIONS §30).

## Stage 11 — Persist run record (always, at the terminal point)

Whatever way the run ended (deployed, parked, abandoned, or escalated), append **one** JSONL line to
`docs/pipeline-runs.jsonl` in the **main checkout** (not the worktree — the worktree may already be
removed). Build the record in memory across the run and write it once here. Schema + a worked example live
in `docs/plans/pipeline-review-gate-and-run-log.md`; the fields are: `id`, `slug`, `date`, `feature`,
`outcome`, `counters{plannerRevisions,criticRounds,reviewRounds,scopeGrewInDiscovery}`,
`agents{planner,critic,implementer,reviewer}` (each `{tokens,tool_uses,duration_ms}` **summed across all
that agent's notifications**), `critic_findings[]`, `reviewer_findings[]`, `planned_tests[]`,
`review_gate{decision,edits}`, `human_review{decision,rounds}`, `live_test{channel,result,escaped_defects}`, `flags[]`.

- Append without touching prior lines and verify it parses:
  `printf '%s\n' "$RECORD_JSON" >> docs/pipeline-runs.jsonl && tail -1 docs/pipeline-runs.jsonl | jq .`
  (the record must be valid single-line JSON).
- **Commit policy:** on a **deployed** run, append + `git add docs/pipeline-runs.jsonl && git commit -m
  "chore(pipeline): log run <id>"` **after** the feature merge/push, so a failed run never dirties `main`.
  If the Stage 8 working-tree guard stashed unrelated work, append the line **after** `git stash pop` so
  it isn't stashed away. On a **parked/abandoned/escalated** run, still append + commit the line (it's
  data about a real run) and tell the maintainer.
- If a run dies mid-flight (session lost), the record is simply not written — acceptable (§30); no
  partial-write or locking machinery.

For analyzing the accumulated log (critic/reviewer effectiveness, cost trends), see the "Analyzing runs"
section in `docs/plans/multi-agent-pipeline.md`.

---

## Notes

- The plan, code, and doc updates all live on the feature branch and reach `main` only at deploy/merge —
  so `main` stays clean while a feature is in flight, and several features can run in parallel worktrees.
- Never claim tests pass without an agent having actually run them (their reports include the output).
- If the maintainer invokes this skill with a half-built worktree already present, resume at the
  appropriate stage instead of recreating it.
