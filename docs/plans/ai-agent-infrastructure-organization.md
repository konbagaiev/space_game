# Claude Code + Codex agent infrastructure organization

**Status:** proposed, planning only.  
**Date:** 2026-09-14.  
**Scope:** repository instructions, reusable agents, reusable skills, the feature pipeline, release boundaries,
personal maintainer automation, and cross-provider verification. No gameplay or server behavior changes.

## Goal

Make the existing Claude Code workflow equally usable from Codex without maintaining two independent sets
of behavioral rules. Keep `CLAUDE.md` as the only team project-instructions file the maintainer edits, preserve
the current Claude behavior, and make the ownership boundary explicit:

- project rules, quality bars, review rules, role contracts, and project runbooks are team-owned and committed;
- provider files are thin adapters, not competing sources of truth;
- `feature-pipeline` is a committed, optional project tool, while the preference to offer it before every code
  change is personal;
- release/publish execution and all credentials remain explicitly authorized and maintainer-controlled;
- Codex uses `gpt-6-astra` for planner, critic, and reviewer, `gpt-5.6-sol` for the implementer, and `ultra`
  reasoning for the planner.

## Current state and constraints

- `CLAUDE.md:3-19` defines the English-only rule, `CLAUDE.md:29-37` currently contains the maintainer's
  automatic pipeline-offer preference, `CLAUDE.md:39-47` contains the mandatory asset-credit checkpoint,
  `CLAUDE.md:49-57` makes `docs/SUMMARY.md` the first lookup, and `CLAUDE.md:59-73` defines planning-only
  behavior. These project rules must remain effective in both providers.
- The four role definitions are currently Claude-specific files: `.claude/agents/feature-planner.md:1-65`,
  `.claude/agents/plan-critic.md:1-56`, `.claude/agents/feature-implementer.md:1-74`, and
  `.claude/agents/code-reviewer.md:1-70`. Their `## Learned guidance` sections are valuable project knowledge,
  especially the reviewer rubric; they must not become personal files.
- `.claude/skills/feature-pipeline/SKILL.md:45-325` is both workflow specification and Claude tool binding.
  It hard-codes `SendMessage`, `AskUserQuestion`, Claude-in-Chrome, and writes lessons back to
  `.claude/agents/*`, so copying it verbatim to Codex would create drift and broken instructions.
- The operational pipeline contract also exists in `docs/plans/multi-agent-pipeline.md:18-154`, including
  the four roles, worktree isolation, human gates, cost controls, and run journal. It still names only Claude
  entry points at `docs/plans/multi-agent-pipeline.md:7-10`.
- Stage 8 currently merges and pushes directly from the orchestrator
  (`.claude/skills/feature-pipeline/SKILL.md:258-271`). This is a privileged release action and should not be
  mixed invisibly into a contributor's development workflow.
- Stage 10 currently appends feedback to provider-owned files
  (`.claude/skills/feature-pipeline/SKILL.md:291-300`). The learned guidance needs a provider-neutral home.
- Stage 2.5 depends on the maintainer's global `~/.claude/skills/grill-with-docs/` installation
  (`.claude/skills/feature-pipeline/SKILL.md:66-107`). A fresh clone therefore cannot execute the documented
  pipeline completely.
- The shared operational skills are currently only under `.claude/skills/`: `run-local`, `build-itch`,
  `record-playback`, `record-backdrop-clip`, `reset-progress`, `update-ship-model`, and `publish-itch`.
- `publish-update`, its channel registry, announcement drafts, and Telegram helper are already deliberately
  local-only through `.git/info/exclude:19-25`. This is maintainer/community automation, not a development
  prerequisite.
- `docs/DECISIONS.md:1030-1053` rejects speculative workflow machinery. Use files and small validation tests;
  do not introduce a registry service, generator framework, package, or orchestration daemon.
- `docs/DECISIONS.md:1917-1938` requires the committed JSONL pipeline journal, while
  `docs/DECISIONS.md:5885-5930` requires bounded retries, opt-in expensive suites, and keeping interactive
  diagnosis with the orchestrator. Both remain provider-independent invariants.

## Chosen ownership model

| Concern | Canonical location | In GitHub? | Policy |
|---|---|---:|---|
| Project rules | `CLAUDE.md` | Yes | The only shared project-instructions file humans edit |
| Role behavior and learned guidance | `docs/ai/roles/*.md` | Yes | Shared by Claude and Codex; reviewed like code |
| Pipeline and skill behavior | `docs/ai/workflows/*.md` | Yes | Provider-neutral operational contracts |
| Claude discovery/adapters | `.claude/agents/*`, `.claude/skills/*` | Yes | Thin provider binding only |
| Codex project config and agents | `.codex/config.toml`, `.codex/agents/*.toml` | Yes | Thin provider binding and requested model routing |
| Codex skills | `.agents/skills/*` | Yes | Thin provider binding only |
| Code-review rubric | `docs/ai/roles/code-reviewer.md` | Yes | Mandatory shared quality contract, never personal |
| `feature-pipeline` workflow | `docs/ai/workflows/feature-pipeline.md` | Yes | Optional; run only after the user chooses it |
| Preference to offer the pipeline | personal instruction file | No | Maintainer preference, not a team rule |
| Release/reset/publish runbooks | `docs/ai/workflows/*` + adapters | Yes | Auditable, but execution always requires explicit authorization |
| Credentials, browser sessions, tokens | environment/tool credential stores | No | Never copied into prompts or Git |
| Community `publish-update` automation | maintainer-private skill/source directory | No | Personal until another release/community owner needs it |
| Pipeline quality journal | `docs/pipeline-runs.jsonl` | Yes | Project learning; no secrets or personal identifiers |
| Provider runtime state | provider user directories | No | Never committed |

This deliberately separates **who can read the procedure** from **who may execute a privileged action**.
Release and reset procedures belong in the repository so the process is reviewable; credentials and explicit
approval remain the authorization boundary.

## Target repository layout

```text
CLAUDE.md
.codex/
  config.toml
  agents/
    feature-planner.toml
    plan-critic.toml
    feature-implementer.toml
    code-reviewer.toml
.claude/
  agents/                         # thin Claude adapters
  skills/                         # thin Claude adapters
.agents/
  skills/                         # thin Codex adapters
docs/
  ai/
    README.md                     # ownership, invocation, onboarding, safety
    roles/
      feature-planner.md
      plan-critic.md
      feature-implementer.md
      code-reviewer.md
    workflows/
      feature-pipeline.md
      grill-with-docs.md
      maintainer-release.md
      run-local.md
      build-itch.md
      record-playback.md
      record-backdrop-clip.md
      reset-progress.md
      update-ship-model.md
      publish-itch.md
scripts/
  agent-infrastructure.test.mjs
```

Do not add `AGENTS.md` to the repository. Do not use symlinks: thin adapters cost only a few lines, work on
Windows clones, and make provider-specific tool translation explicit.

## Implementation plan

### 1. Add the ownership and onboarding contract

Create `docs/ai/README.md` with:

1. the ownership table above;
2. the target tree and a rule that behavioral changes are made in `docs/ai/roles/` or
   `docs/ai/workflows/`, never independently in both provider adapters;
3. invocation mapping: Claude `/feature-pipeline` and Codex `$feature-pipeline`;
4. onboarding checks for Claude Code and Codex discovery;
5. a safety matrix for read-only, workspace-write, destructive local, production, Git push, itch publish,
   and community publish actions;
6. a statement that cloning the repository grants instructions, not credentials or authorization;
7. links to the current official provider formats:
   [Claude project agents](https://code.claude.com/docs/en/subagents),
   [Claude skills](https://code.claude.com/docs/en/skills),
   [Codex project instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
   [Codex custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents), and
   [Codex skills](https://learn.chatgpt.com/docs/build-skills).

This file explains the infrastructure; it does not become another always-loaded rules file.

### 2. Keep one shared project-instructions source

Create `.codex/config.toml` with the project-level fallback:

```toml
project_doc_fallback_filenames = ["CLAUDE.md"]
```

Do not create a repository `AGENTS.md`, copy `CLAUDE.md`, or generate one from the other. Verify from the
repository root and from `client/` that Codex reports `CLAUDE.md` as the loaded project instruction source.

Move only the personal activation preference out of `CLAUDE.md:29-37` after Step 8 has installed and verified
its personal replacement. Replace that section with a team-neutral statement:

```md
## Optional feature pipeline

The repository provides `/feature-pipeline` in Claude Code and `$feature-pipeline` in Codex. Run it only when
the user explicitly chooses the full planner -> critic -> implementer -> reviewer workflow; direct edits remain
valid for small changes.
```

Leave every other `CLAUDE.md` rule intact. If the personal replacement cannot be installed or verified, do not
edit `CLAUDE.md:29-37`; preserving the maintainer's current Claude behavior takes precedence over this cleanup.

### 3. Extract shared role contracts without changing their behavior

Create the four `docs/ai/roles/*.md` files. For each corresponding `.claude/agents/*.md` file:

1. move the Markdown body, including its complete `## Learned guidance`, into the shared role file;
2. replace Claude-specific orchestration words such as `/feature-pipeline` only where needed with neutral terms;
3. preserve every existing rubric, attempt limit, test-budget rule, output shape, and project reference;
4. leave the existing Claude YAML `name`, `description`, and `tools` values unchanged;
5. replace only the Claude agent body with a short mandatory instruction to read the matching shared role file
   in full before acting and to treat it as its role contract.

The role split is:

| Role | Shared source | Write permission |
|---|---|---|
| Planner | `docs/ai/roles/feature-planner.md` | Plans/docs only in the feature worktree |
| Critic | `docs/ai/roles/plan-critic.md` | Read-only |
| Implementer | `docs/ai/roles/feature-implementer.md` | Workspace-write in the feature worktree |
| Reviewer | `docs/ai/roles/code-reviewer.md` | Read-only; tests may create normal test artifacts |

Update the feature-pipeline feedback stage to append lessons to `docs/ai/roles/<role>.md`, not to
`.claude/agents/<role>.md`. This makes learned project quality rules immediately available to both providers.

### 4. Add Codex agents with the requested routing

Create the four `.codex/agents/*.toml` adapters. Each must use a concise `developer_instructions` value that:

- requires reading `CLAUDE.md` and the matching `docs/ai/roles/*.md` in full;
- keeps all work inside the supplied worktree;
- preserves the role's output protocol and loop continuity;
- does not duplicate the shared rubric.

Use this exact Codex routing:

| Codex agent | `model` | `model_reasoning_effort` | `sandbox_mode` |
|---|---|---|---|
| `feature-planner` | `gpt-6-astra` | `ultra` | `workspace-write` |
| `plan-critic` | `gpt-6-astra` | omit; use the caller/default setting | `read-only` |
| `feature-implementer` | `gpt-5.6-sol` | omit; use the caller/default setting | `workspace-write` |
| `code-reviewer` | `gpt-6-astra` | omit; use the caller/default setting | `read-only` |

Do not add model fields to `.claude/agents/*.md`; Claude's current model selection and behavior remain
unchanged. In the Codex pipeline adapter, if the host cannot dispatch a named `.codex/agents` definition,
spawn a fresh agent with the same model/effort/sandbox selection and explicitly tell it to read the matching
shared role. That is a compatibility fallback, not a fifth role.

### 5. Make the pipeline contract provider-neutral

Create `docs/ai/workflows/feature-pipeline.md` from the behavior currently split between
`.claude/skills/feature-pipeline/SKILL.md:45-325` and `docs/plans/multi-agent-pipeline.md:59-154`. Preserve:

- timestamp feature IDs, `feature/<id>` branches, and `../ag-wt/<id>` worktrees
  (`docs/plans/multi-agent-pipeline.md:36-55`);
- planner -> critic -> human plan gate -> implementer -> reviewer -> human diff gate;
- critic maximum 5 rounds and review maximum 3 rounds;
- the two-attempt limit, no browser loops, no delegated interactive diagnosis, and the existing opt-in visual
  and performance suites;
- continuation of the same planner/critic/implementer/reviewer across their respective revision loops;
- commit, park, abandon, live-test, learned-guidance, and JSONL terminal-record behavior;
- all existing human confirmations and the rule never to claim unrun tests passed.

Use provider-neutral operations in the shared workflow: `spawn role`, `continue role`, `ask user`,
`interrupt role`, and `inspect live UI`. Put the tool mapping only in the adapters:

| Operation | Claude adapter | Codex adapter |
|---|---|---|
| Spawn fresh role | Claude Agent/subagent invocation | Codex sub-agent/custom-agent invocation |
| Continue same role | Claude resume/message mechanism | Codex follow-up to the same agent |
| Stop grinding role | Claude stop mechanism | Codex interrupt mechanism |
| Human checkpoint | Claude interactive question | Codex interactive user checkpoint |
| Live browser check | available Claude browser tool | available Codex computer-use/browser tool |

Rewrite `.claude/skills/feature-pipeline/SKILL.md` as a Claude binding that requires reading the shared workflow
and preserves `/feature-pipeline`. Create `.agents/skills/feature-pipeline/SKILL.md` as the equivalent Codex
binding for `$feature-pipeline`. Keep invocation opt-in in both descriptions: neither adapter should silently
start a full pipeline merely because a code file is mentioned.

Update `docs/plans/multi-agent-pipeline.md:1-14` to mark it as the original design record and link to
`docs/ai/workflows/feature-pipeline.md` as the live operational contract. Keep its rationale and historical
metrics; do not maintain a second copy of the runnable stages there.

### 6. Separate development completion from privileged release execution

Create `docs/ai/workflows/maintainer-release.md` and provider adapters at
`.claude/skills/maintainer-release/SKILL.md` and `.agents/skills/maintainer-release/SKILL.md`.

Move the privileged part of the current pipeline into this workflow:

- deploy/park/abandon decision and exact branch/worktree validation;
- merge/push and CI monitoring;
- production or parked-build live test;
- post-live-test feedback collection;
- cleanup and terminal JSONL record.

The shared `feature-pipeline` reaches a reviewed, committed feature branch, then offers this release phase.
For the current maintainer, answering **deploy** continues through the same steps as today, so the observable
Claude workflow does not regress. For a contributor, the default handoff is a branch ready for PR/review;
the workflow must not push, deploy, reset production, publish to itch, or delete a branch without explicit
authorization for that exact action.

Do not add a maintainer registry or role service. Explicit confirmation plus possession of credentials is the
simple authorization boundary required by `docs/DECISIONS.md:1030-1053`.

### 7. Vendor the design-grill dependency and port the operational skills

Create `docs/ai/workflows/grill-with-docs.md` from the current personal skill's useful behavior, with the
project mapping already required at `.claude/skills/feature-pipeline/SKILL.md:94-103`:

- ask one question at a time and recommend an answer;
- inspect code/docs instead of asking questions the repository can answer;
- test reachability, player-visible outcomes, and every numeric claim;
- write current-state facts to `docs/SUMMARY.md` and durable trade-offs to numbered
  `docs/DECISIONS.md` entries;
- never create `CONTEXT.md` or `docs/adr/` in this project.

Add thin `grill-with-docs` adapters under both `.claude/skills/` and `.agents/skills/`. The maintainer's
existing personal Claude skill has higher precedence and remains untouched; the committed project version
makes fresh clones and Codex complete.

For each existing shared operational skill, move its behavioral body to the named shared workflow and turn
the Claude file into a thin adapter; then add the Codex adapter:

| Existing Claude skill | Shared workflow | Classification |
|---|---|---|
| `run-local` | `docs/ai/workflows/run-local.md` | Team, routine |
| `build-itch` | `docs/ai/workflows/build-itch.md` | Team, routine build |
| `record-playback` | `docs/ai/workflows/record-playback.md` | Team, interactive |
| `record-backdrop-clip` | `docs/ai/workflows/record-backdrop-clip.md` | Team, interactive/media |
| `reset-progress` | `docs/ai/workflows/reset-progress.md` | Team runbook, destructive gates retained |
| `update-ship-model` | `docs/ai/workflows/update-ship-model.md` | Team runbook, asset/release gates retained |
| `publish-itch` | `docs/ai/workflows/publish-itch.md` | Team runbook, privileged publish |

Keep shell commands, target paths, safety checks, asset-credit prompt, and existing descriptions semantically
unchanged. Translate only provider mechanics such as background-process handling or browser control. Do not
add Codex-only functionality to the shared workflow unless Claude gets the same behavior.

### 8. Move personal activation and community publishing out of the repository surface

Create one maintainer-owned, non-repository source such as
`~/.config/vega-sentinels/agent-preferences.md` containing the project-specific preference to offer the full
pipeline before code edits, but not before discussion/investigation. Reference that one file from:

- `~/.claude/CLAUDE.md` using Claude's supported Markdown import;
- `~/.codex/AGENTS.md` using a short conditional instruction for the Vega Sentinels repository.

Append to existing user files; never overwrite them. These two adapters should be static, leaving the one
personal source file as the only preference text to edit. Home-directory changes require the maintainer's
approval during implementation. Verify the behavior in both providers before applying Step 2's edit to
`CLAUDE.md:29-37`.

Keep `publish-update` private. Move/copy the currently ignored `.claude/skills/publish-update/`,
`scripts/publish-telegram.mjs`, `updates/`, and `docs/plans/publish-update-skill.md` into a maintainer-private
directory or private repository, then expose it to `~/.claude/skills/publish-update` and
`~/.agents/skills/publish-update` through tiny personal adapters. Preserve the current source files until both
providers pass a dry run; remove the old ignored copies only with an explicit cleanup request.

Keep `TELEGRAM_BOT_TOKEN`, channel IDs, AWS credentials, butler authentication, production database URLs,
browser login state, and deploy keys in their existing local credential stores. No adapter or shared workflow
may contain a secret value.

### 9. Make ignore behavior clone-safe

Update `.gitignore` with the generic Claude runtime paths currently present only in the local
`.git/info/exclude:7-17` (`scheduled_tasks*`, routines state, worktrees, checkpoints, mailbox, registry,
local memory, first-run, and daemon state). This prevents runtime noise for every contributor.

After Step 8 succeeds, remove only the obsolete project-specific entries from the local
`.git/info/exclude:19-25`. Do not commit `.git/info/exclude`; it remains machine-local. Do not add broad
patterns that would hide `.claude/agents`, `.claude/skills`, `.codex/agents`, or `.agents/skills`.

### 10. Keep the run journal meaningful across providers

Update `docs/plans/pipeline-review-gate-and-run-log.md:84-180` and
`docs/ai/workflows/feature-pipeline.md` so new JSONL records add:

```json
{
  "provider": "claude-code | codex",
  "agents": {
    "planner": { "model": "...", "effort": "...", "tokens": null }
  }
}
```

Retain the existing fields and do not rewrite historical lines. Make `tokens` nullable when a provider cannot
report a comparable value. Cost comparisons must be grouped by provider/model and must not claim that Claude
and Codex token accounting is directly comparable. Keep findings, loop counts, human decisions, and escaped
defects provider-neutral. Never record developer identity, prompt transcripts, credentials, or local paths.

Amend `docs/DECISIONS.md:1917-1938` rather than creating a second telemetry decision.

### 11. Add a small structural regression test

Create `scripts/agent-infrastructure.test.mjs`; the root `package.json` already runs
`scripts/**/*.test.mjs`, so no package-script change is required. Use `node:test` and built-in Node modules
only. Assert:

- no repository `AGENTS.md` exists;
- `.codex/config.toml` names `CLAUDE.md` as a fallback;
- all four canonical roles have both Claude and Codex adapters;
- planner/critic/reviewer use `gpt-6-astra`, implementer uses `gpt-5.6-sol`, and only the explicit planner
  requirement is pinned to `ultra`;
- all shared workflows in Step 7 have both provider adapters;
- every adapter points to an existing canonical role/workflow;
- read-only roles remain read-only and the implementer remains workspace-write;
- tracked AI files do not contain obvious secret assignments or absolute maintainer-home paths.

Keep this as a direct invariant test, not a manifest/generator system.

### 12. Update project documentation in the implementation change

- Update `docs/SUMMARY.md:459` (`## Tools`), `docs/SUMMARY.md:3955` (`## Deployment & CI/CD`), and
  `docs/SUMMARY.md:5362` (`## Project structure`) with the two-provider layout, invocation names, model routing,
  and privilege boundary. Bump the `Updated:` date.
- Add one `docs/CHANGELOG.md` bullet under the implementation date describing Codex parity and the unchanged
  Claude workflow.
- Add one `docs/DECISIONS.md` entry recording: `CLAUDE.md` as the single team rule source, provider-neutral
  role/workflow bodies with thin adapters, shared-but-optional `feature-pipeline`, personal auto-offer
  preference, and shared runbooks/private credentials.
- Amend `docs/DECISIONS.md:1030-1053`: onboarding a second provider is a present duplication problem, but a
  generator/plugin/registry remains rejected.
- Update provider-specific references in `docs/plans/agent-cost-and-context-control.md:81-118` and
  `docs/plans/pipeline-review-gate-and-run-log.md:223-241` to point at the shared role/workflow sources.
- Leave historical feature plans otherwise unchanged; they describe the implementation that existed when
  they were written.

## Verification

Run from the repository root:

```bash
node --test scripts/agent-infrastructure.test.mjs
npm test
git diff --check
git status --short
```

Then perform provider smoke checks without implementing a real feature:

1. Claude Code lists the four project agents and the shared project skills; opening each role shows the same
   canonical role contract and the existing Claude tool restrictions.
2. Codex loads `CLAUDE.md` without a repository `AGENTS.md`, discovers the four `.codex/agents` definitions,
   and discovers the `.agents/skills` entries.
3. Ask each provider to describe, but not execute, the pipeline. Both must report the same stage order, loop
   caps, human plan/diff gates, opt-in expensive suites, release boundary, live test, and feedback destination.
4. In Codex, inspect the resolved agent configuration: planner = Astra/ultra, critic = Astra, implementer =
   Sol, reviewer = Astra.
5. In Claude, confirm the existing four role descriptions/tool sets and pipeline behavior are unchanged.
6. Confirm a normal code-change request causes the maintainer's personal setup to **offer** the pipeline in
   both providers, while a clean clone without personal preferences does not force it.
7. Confirm `git ls-files` contains no private community publishing files, credentials, browser state, provider
   runtime state, or absolute home paths.

The game client/server test suites are not required for this documentation/config-only change unless an
implementation step touches executable game code.

## Acceptance criteria

- The maintainer edits project-wide rules only in `CLAUDE.md`; Codex consumes that file through configuration.
- Claude Code retains the current agent roles, tool permissions, pipeline stages, safety gates, and personal
  pipeline offer.
- Codex has equivalent project agents and skills with the requested model routing; planner effort is `ultra`.
- `code-reviewer` and its learned guidance are committed team quality policy.
- `feature-pipeline` is committed and available to the team but remains optional; auto-offer is personal.
- A contributor can run development through review without inheriting production/community credentials or
  accidentally crossing the release boundary.
- All shared skills have one behavioral source and two small provider adapters.
- The pipeline no longer depends on an uncommitted global `grill-with-docs` installation.
- Pipeline learning is written to provider-neutral role files and new run records identify provider/model
  without rewriting history.
- No secrets or personal runtime state are committed.
- Structural tests and both provider smoke checks pass.

## Resolved decisions

- **Repository `AGENTS.md`?** No. `.codex/config.toml` points Codex at `CLAUDE.md`.
- **Is `feature-pipeline` personal?** Its availability and workflow are shared; the habit of offering it on
  every code change is personal.
- **Is `code-reviewer` personal?** No. It is the project's shared quality contract.
- **Are planner/critic/implementer roles shared?** Yes. They encode project architecture, tests, and learned
  failure modes, so teammates must receive them.
- **Are release runbooks shared?** Yes, for auditability and continuity. Execution remains privileged and
  explicitly confirmed.
- **Is community publishing shared?** Not yet. It remains maintainer-private until another person owns that
  responsibility.
- **One cross-provider plugin or generator?** No. Provider-native adapters over shared Markdown are simpler and
  sufficient at the current scale.
- **Symlinks?** No. They create avoidable clone/platform problems.
- **Model mapping?** Planner/critic/reviewer use `gpt-6-astra`; implementer uses `gpt-5.6-sol`; only planner is
  pinned to `ultra` effort.
