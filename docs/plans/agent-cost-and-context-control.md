# Agent cost & context control — what the 2026-08-30 visual pass exposed

**Status:** problem statement + proposed measures. Nothing implemented yet.
**Trigger:** the `2026-08-30-1507-expensive-look` pipeline run burned through a Max
subscription's limits in a single session, and two of its agents ground in place for tens of
minutes without producing a result.

---

## 1. What actually happened

The run went planner → critic (1 REVISE round) → implementer → reviewer (1 CHANGES round) →
maintainer live test. The plan was good and the critic earned its keep (see §5). But:

- The **first implementer was killed mid-run by a rate limit**. Its transcript did not survive,
  so it could not be resumed — a second implementer had to be spawned with the work reconstructed
  from a WIP commit.
- A **second implementer ground for ~36 minutes** relaunching a browser in a loop, and was
  stopped by the maintainer's own observation ("он как будто зациклился"), not by any guard.
- A **third agent** repeated the pattern and was stopped for the same reason.
- Only after all of that did a live test on a real GPU reveal that the whole architecture
  (a full-frame `EffectComposer`) was wrong, forcing a pivot that discarded most of the
  implementation.

## 2. The real token accounting

The per-agent numbers reported in `task-notification` (`subagent_tokens`) are **not** the
billable figure. Measured from the agent transcripts themselves
(`~/.claude/projects/<project>/<session>/subagents/agent-*.jsonl`, summing
`input + output + cache_creation + cache_read`):

| agent | role | turns | total tokens |
|---|---|---|---|
| `aa0e776…` | implementer #2 (merge, fixes, D13, the 36-min grind) | 470 | **125.2 M** |
| `aa950ef…` | implementer #1 (killed by the rate limit) | 371 | **83.0 M** |
| `a9882ec…` | reviewer | 156 | 24.2 M |
| `ac58105…` | implementer #3 (the pivot) | 109 | 18.2 M |
| `aadeeb5…` | planner | 144 | 17.0 M |
| `a6315d2…` | critic | 67 | 6.5 M |
| | | | **274.1 M** |

**Two implementers = 208 M of 274 M, i.e. 76% of the run.**

### 2.1 Cost is dominated by cache reads, i.e. by TURN COUNT

Of the 274.1 M total, **267.5 M (97.6%) is `cache_read`**. Actual generation is 682 K.

An agent re-reads its whole accumulated context on **every** turn, so cost scales as
`turns × context size`. The expensive agents were not thinking harder — they were taking
hundreds of short turns against a large context. 470 turns at a few hundred KB of context is
how a single agent reaches 125 M.

The lever is **turn count and context size**, not model choice or "smartness".

### 2.2 The run log has been understating cost by ~375×

`docs/pipeline-runs.jsonl` records `subagent_tokens` from the notifications. For implementer #2
that field read **333 K** while the transcript shows **125.2 M**. Every historical row in the
log is therefore low by roughly two orders of magnitude, because the field excludes cache reads.

Conclusions previously drawn from that log ("this feature cost 800 K") are wrong, and the log
currently provides false reassurance rather than cost control. **Fix the metric before trusting
any trend in it.**

## 3. Why the agents ground

1. **Browser diagnosis is the worst possible subagent task.** It is many short turns
   (navigate → screenshot → probe → repeat) against a context that only grows. The orchestrator
   found the same defect in ~3 tool calls by looking directly; an agent spent tens of millions of
   tokens on the same question.
2. **No attempt budget.** Nothing stopped an agent from re-testing the same hypothesis
   indefinitely. Both grinding agents were stopped by a human noticing, which is not a control.
3. **No escalation path.** An agent that cannot make progress has no way to say so. It keeps
   working because stopping is not one of its options.
4. **Verification was run more than once at full price.** The reviewer independently rebuilt a
   `main` baseline worktree and re-ran the whole 47-scenario visual suite. Methodologically
   correct, and a large fraction of its 24 M.

## 4. Proposed measures

- **Attempt budget per hypothesis.** Two failed attempts at the same question → write down what
  was tried and what it ruled out, and move on or escalate. Never a third identical attempt.
- **Context budget with a hard ceiling.** Track accumulated context per agent; on approach to the
  ceiling, the agent must summarise its state and hand back rather than continue. A long-running
  agent should be split into fresh, narrowly-scoped agents that each start small.
- **An explicit "I am stuck" escalation.** The agent must report to the maintainer — what it is
  trying, what it has ruled out, what it needs — instead of silently grinding. This is a required
  behaviour, not an option of last resort.
- **Do not delegate interactive diagnosis.** Browser/GPU/live-app investigation stays with the
  orchestrator, which can look directly. Delegate the FIX, not the HUNT.
- **Verify once, at full price, at the end.** A full visual suite plus a from-scratch `main`
  baseline is a single scheduled cost, not something each agent repeats.
- **Fix the run-log metric** to sum `cache_read` and `cache_creation`, then re-judge which past
  runs were actually expensive.
- **Live-test earliest, not last.** The pivot here was decided in ten minutes of real play after
  ~208 M had been spent building the wrong architecture. For any render-path or feel change, a
  rough playable build must reach the maintainer before the plan is polished.

## 5. What the pipeline did earn

Recorded so the measures above do not throw it away. The critic and the planner (23.5 M combined,
under 9% of the run) caught four defects that were self-consistent and wrong against a
neighbouring system, each of which would have shipped silently:

- the hull emissive floor placed where `if (tint)` never runs for any real `.glb` ship;
- the dust size overridden by the server descriptor, and again by a stored `?dev` tune;
- a bloom gain applied where a colour is BUILT and wiped where it is RE-ASSIGNED per shot;
- a backdrop-ceiling assertion silently weakened to a metric that could not fail.

The failure was not the review layers. It was that **none of them could see a moving frame on a
real GPU**, and that nothing bounded what an agent could spend looking for one.
