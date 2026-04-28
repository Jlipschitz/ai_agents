# Command Reference

This reference documents the common `ai_agents` commands exposed through the public CLI and the compatibility npm scripts.

Use the public entrypoint when installed as a package:

```bash
ai-agents <command>
npm run ai-agents -- <command>
```

Use the compatibility wrappers when the repo has copied coordinator scripts:

```bash
npm run agents -- <command>
npm run agents2 -- <command>
```

`agents` uses the `coordination/` workspace by default. `agents2` uses `coordination-two/` by default.

## Global Flags

The CLI accepts these flags before or after the command, as long as they appear before a command-specific `--` separator:

```text
--config <path>
--root <path>
--coordination-dir <dir>
--coordination-root <path>
--verbose
--quiet
--no-color
```

Top-level command errors use a consistent shape. Text mode writes diagnostics to stderr:

```text
error: <message>
hint: <next step>
```

Commands that receive `--json` emit structured errors on stdout:

```json
{
  "ok": false,
  "error": "<message>",
  "code": "usage_error",
  "hint": "<next step>"
}
```

Use `--verbose` to include stack traces on formatted top-level errors.

## Mutation Dry Runs

Most command-layer apply flows are dry-run by default and write only when `--apply` is passed. Legacy core mutation commands such as `claim`, `prioritize`, `approvals request|grant|deny|use`, `progress`, `wait`, `resume`, `blocked`, `review`, `verify`, `message`, `app-note`, `handoff`, `done`, `release`, access requests, incidents, resource leases, heartbeat, and watcher commands also accept `--dry-run` to validate inputs and report the intended action without changing coordination state or starting/stopping background processes.

```bash
npm run agents -- claim agent-1 task-ui --paths app/page.tsx --summary "UI fix" --dry-run
npm run agents -- progress agent-1 task-ui "Investigated route state" --dry-run
npm run agents -- run-check test --dry-run
```

Every command can show focused help:

```bash
npm run agents -- claim --help
npm run agents -- help claim
```

## Read-only Commands

These commands should not mutate runtime state.

### `help`

Shows command help.

```bash
npm run agents -- help
```

### `status`

Prints the current board state, active work, blockers, stale work, and task priority/due-date metadata.

```bash
npm run agents:status
npm run agents -- status
```

### `summarize`

Prints an enhanced board handoff summary.

```bash
npm run agents:summarize
npm run agents -- summarize
npm run agents -- summarize --for-chat
npm run agents -- summarize --json
```

Current summary output includes:

- task counts by status
- active work
- blockers
- review queue
- stale active work
- next planned work
- next recommended actions
- recent journal lines
- recent messages

Useful modes:

- `--for-chat`: compact paste-friendly status block.
- `--json`: machine-readable payload containing summary, board state, counts, next actions, recent journal lines, and recent messages.

### `validate`

Validates the current coordination board and task records. The command layer also validates `agent-coordination.config.json` before the core validator runs.

```bash
npm run agents:validate
npm run agents -- validate
npm run agents -- validate --json
```

### `doctor`

Runs setup and health checks for config, package scripts, ignored runtime folders, docs, visual checks, and board state. The command layer validates config before the core doctor runs.

```bash
npm run agents:doctor
npm run agents -- doctor
npm run agents -- doctor --json
npm run agents -- doctor --fix
npm run agents -- doctor --json --fix
```

Useful modes:

- `--json`: prints machine-readable doctor output including config validation and Git state.
- `--fix`: creates safe missing starter files/folders, updates `.gitignore`, adds missing package scripts, and creates starter app notes.

The JSON output includes `configSuggestions`, a list of non-blocking config improvement recommendations such as missing visual checks, missing docs roots, branch policy gaps, or missing domain rules for detected repo types. It also includes `onboardingChecklist` recommendations for architecture, testing, deployment, app notes, and visual workflow docs.

### `heartbeat-status`

Shows known agent heartbeat files and freshness.

```bash
npm run agents:heartbeat:status
```

### `watch-status`

Shows watcher status, if the watcher has been started.

```bash
npm run agents:watch:status
```

### `lock-status`

Inspects the runtime state lock without mutating it. This is routed through the main CLI, so all wrapper forms work.

```bash
npm run agents:lock:status
npm run agents2:lock:status
npm run agents -- lock-status
npm run agents -- lock-status --json
npm run ai-agents -- lock-status --json
node ./scripts/lock-runtime.mjs status --coordination-dir coordination --json
```

The status output reports whether the lock exists, whether it is stale, stale reasons, age, PID status, owner, and command when available.

### `watch-diagnose`

Inspects watcher, runtime lock, and heartbeat state together.

```bash
npm run agents:watch:diagnose
npm run agents -- watch-diagnose --json
```

The report flags stale watcher status, stale runtime locks, stale heartbeat files, and suggested cleanup actions.

### `inspect-board`

Inspects `board.json` for structural problems without mutating it.

```bash
npm run agents:board:inspect
npm run agents -- inspect-board --json
```

It reports task counts, duplicate IDs, unknown statuses, missing owners, missing agent references, and simple active path overlaps.

### `release-check`

Checks whether a done task is ready for release.

```bash
npm run agents:release:check -- task-id
npm run agents -- release-check task-id --json
npm run agents -- release-check task-id --require-doc-review
```

The check requires done status, passing latest verification for every task verification item, no latest failing verification, satisfied dependencies, and docs review when relevant docs are attached or `--require-doc-review` is passed.

### `pr-summary`

Generates PR-ready Markdown or JSON from completed tasks, verification logs, release-check findings, and open follow-up work.

```bash
npm run agents -- pr-summary
npm run agents -- pr-summary task-id
npm run agents -- pr-summary task-id --json
npm run agents -- pr-summary task-id --title "Short PR title"
```

The Markdown output includes:

- Changes
- Verification
- Risks
- Follow-ups

### `release-bundle`

Creates a release handoff bundle containing PR summary, board summary, release-check JSON, and artifact index JSON.

```bash
npm run agents -- release-bundle task-id
npm run agents -- release-bundle task-id --apply
npm run agents -- release-bundle task-id --out-dir artifacts/releases/manual --apply --json
```

By default this is a dry run. With `--apply`, files are written under `artifacts/releases/<timestamp>/` unless `--out-dir` is provided.

### `changelog`

Generates human-readable release notes from current and archived completed work.

```bash
npm run agents:changelog
npm run agents -- changelog --since 2026-01-01
npm run agents -- changelog --json
```

The changelog includes done and released tasks from `board.json` plus archived tasks from `coordination/archive/tasks-*.json`, grouped by month. Entries include summaries, claimed paths, latest verification outcomes, and relevant docs when present.

## Setup Commands

### `init`

Creates the local coordination workspace and starter runtime files.

```bash
npm run agents:init
npm run agents2:init
```

### `bootstrap`

Copies the coordinator into another repository, adds package scripts, creates starter docs, updates `.gitignore`, and runs doctor.

```bash
npm run bootstrap -- --target C:\path\to\repo
npm run bootstrap -- --target ../frontend-app --profile react
npm run bootstrap -- --target ../api-service --profile backend --skip-doctor
npm run bootstrap -- --target ../other-repo --dry-run
npm run bootstrap -- --target ../other-repo --force
npm run bootstrap -- --list-profiles
```

Flags:

- `--target <path>`: target repository path.
- `--profile <name>`: apply a repo profile after copying files. Supported profiles are `react`, `backend`, `docs`, and `release`.
- `--list-profiles`: print the available bootstrap profiles.
- `--dry-run`: print intended operations without writing files.
- `--force`: replace existing copied coordinator files.
- `--skip-doctor`: skip the final `agents:doctor` run.

Profiles merge into `agent-coordination.config.json` without removing existing local values. `react` adds visual-impact paths, visual verification checks, and UI planning defaults. `backend` adds API/database risk paths and test checks. `docs` adds README/docs risk and planning defaults. `release` adds stricter branch defaults, release approval expectations, build checks, and longer artifact retention.

### `validate:agents-config`

Validates `agent-coordination.config.json` against the expected portable config shape.

```bash
npm run validate:agents-config
node ./scripts/validate-config.mjs --config ./agent-coordination.config.json --json
```

Flags:

- `--config <path>`: config file to validate.
- `--root <path>`: repo root used for existence warnings.
- `--json`: emit machine-readable validation output.

### `completions`

Generates shell completion scripts for the current repo.

```bash
npm run agents:completions -- powershell
npm run agents -- completions bash
npm run agents -- completions zsh
npm run agents -- completions list --json
```

Generated scripts include command names plus current agent IDs, task IDs, configured checks, verification checks, and common flags.

### `migrate-config`

Adds current optional config defaults such as `configVersion`, `artifacts`, and `checks`. The command is dry-run by default and snapshots the previous config before applying changes.

```bash
npm run agents -- migrate-config
npm run agents -- migrate-config --json
npm run agents -- migrate-config --apply
```

### `templates`

Lists built-in config and task templates, applies config template patches, or creates planned tasks from task templates.

```bash
npm run agents:templates -- list
npm run agents -- templates show react
npm run agents -- templates apply react --apply
npm run agents -- templates create-task ui-change --id task-ui --paths app/page.tsx --priority high --due-at 2026-05-01 --apply
```

Config template application and task creation are dry-run by default. Use `--apply` to write changes. Applied config and board changes create snapshots first. Task templates accept `--priority`, `--due-at` or `--due`, and `--severity`.

### `update-coordinator`

Updates copied coordinator/tooling files in the current repo from an installed package or source checkout while preserving repo-specific config, runtime state, and local docs by default.

```bash
npm run agents:update
npm run agents -- update-coordinator --source C:\path\to\ai_agents
npm run agents -- update-coordinator --source C:\path\to\ai_agents --apply --json
```

The default mode is a dry run. The command copies coordinator scripts, the public CLI, the schema, and `scripts/lib/` helper files. It does not copy `agent-coordination.config.json`, `coordination/`, `coordination-two/`, runtime files, artifacts, or docs unless `--include-docs` is passed.

### `backlog-import`

Imports Markdown TODOs into planned tasks.

```bash
npm run agents:backlog:import -- --from BACKLOG.md
npm run agents -- backlog-import --from README.md,docs --owner agent-2 --priority normal --severity none --apply --json
```

The default mode is a dry run. The importer recognizes unchecked Markdown task-list items and `TODO:` lines, skips existing imports by stable source metadata, carries optional priority/due/severity flags onto new tasks, and writes a compressed pre-mutation workspace snapshot before applied board changes.

Applied command-layer mutations and lock-protected legacy core mutations append machine-readable audit entries to `coordination/runtime/audit.ndjson`.

### `policy-packs`

Lists, inspects, or applies reusable config policy packs.

```bash
npm run agents -- policy-packs list
npm run agents -- policy-packs inspect strict-ui
npm run agents -- policy-packs apply strict-ui
npm run agents -- policy-packs apply strict-ui,release-heavy --apply --json
```

Built-in packs:

- `docs-light`
- `strict-ui`
- `backend-safe`
- `release-heavy`

Applying packs is a dry run unless `--apply` is passed. Applied changes snapshot the previous config first.

### `policy-check`

Evaluates the configured policy enforcement rules against active work.

```bash
npm run agents:policy:check
npm run agents -- policy-check --json
```

Configure policy enforcement with `policyEnforcement`:

```json
{
  "policyEnforcement": {
    "mode": "warn",
    "rules": {
      "broadClaims": true,
      "codeownersCrossing": true,
      "finishRequiresApproval": false,
      "finishRequiresDocsReview": false,
      "finishApprovalScope": ""
    }
  }
}
```

`mode: "warn"` reports policy findings but does not fail `policy-check`, `claim`, or `finish`. `mode: "block"` makes enabled findings fail `policy-check`, blocks broad or CODEOWNERS-crossing claims before mutation, and blocks `finish` when configured approval or docs-review gates are missing.

## Planning and Task Commands

### `plan`

Generates a task split from a natural-language work description using configured domains, fallback paths, and sizing rules.

```bash
npm run agents:plan -- "Build task labels and reporting"
npm run agents -- plan "Improve mobile task modal"
```

Planner lane sizing is covered by `scripts/planner-sizing.mjs`, which classifies likely product, data, verify, and docs lanes from the configured `planning.agentSizing` keywords. The helper is currently used as a regression-test target so planner sizing behavior can be stabilized before deeper core planner refactors.

### `prompt`

Generates copy-ready assignment context for an agent.

```bash
npm run agents:prompt -- agent-1
npm run agents -- prompt agent-1 task-ui
npm run agents -- prompt agent-1 --json
```

The prompt includes the assigned task, priority, due date, severity, objective, claimed paths, dependency status, relevant docs, docs-review state, verification expectations, recent task notes, and next actions. If a task ID is omitted, the command uses the agent's recorded assignment or active owned task.

### `ask`

Answers common coordination questions from the current board.

```bash
npm run agents:ask -- "what is blocked?"
npm run agents -- ask "who owns src/path?"
npm run agents -- ask "what can agent-2 do next?" --json
```

Supported question patterns include blocked/waiting/review/handoff work, stale active work, task status, path or task ownership, and next ready work for an agent. The command is deterministic and read-only; it does not call an external model.

### `graph`

Prints task dependencies as a Mermaid graph, or JSON with nodes and edges.

```bash
npm run agents -- graph
npm run agents -- graph --json
```

### `ownership-map`

Shows active task ownership by agent and flags overlapping claimed paths.

```bash
npm run agents -- ownership-map
npm run agents -- ownership-map --json
```

The command exits non-zero when active path overlaps are detected.

### `ownership-review`

Reviews active claims for broad ownership and CODEOWNERS boundary crossings.

```bash
npm run agents:ownership:review
npm run agents -- ownership-review --json
```

The command reads `.github/CODEOWNERS`, `CODEOWNERS`, or `docs/CODEOWNERS` by default. Configure alternate files or broad-claim paths with `ownership.codeownersFiles` and `ownership.broadPathPatterns`.

### `test-impact`

Selects the smallest configured verification set for changed paths.

```bash
npm run agents:test-impact -- --paths app/page.tsx,tests/page.test.ts
npm run agents -- test-impact --json
```

Selection uses `checks.<name>.requiredForPaths`, visual-impact config, and the current Git diff when `--paths` is omitted.

### `risk-score`

Scores task risk from ownership breadth, CODEOWNERS crossings, shared-risk paths, active path overlaps, open dependencies, verification state, visual verification, docs review, priority, severity, due dates, and blocked/waiting status.

```bash
npm run agents:risk:score
npm run agents -- risk-score task-id
npm run agents -- risk-score --json
```

The command is read-only and returns `none`, `low`, `medium`, `high`, or `critical` levels with point-by-point factors so coordinators can decide what needs review or sequencing before merge/release work.

### `critical-path`

Finds the longest remaining dependency chain and the ready tasks that unblock the most downstream work.

```bash
npm run agents:critical:path
npm run agents -- critical-path --json
```

The command is read-only. It scores remaining path cost from task effort plus risk level, reports the critical task chain, lists ready work sorted by downstream cost, and warns about missing dependencies or dependency cycles.

### `health-score`

Scores workspace health from setup readiness, current work risk, verification gaps, critical-path warnings, and stale runtime state.

```bash
npm run agents:health:score
npm run agents -- health-score --json
npm run agents -- health-score --fail-under 80
```

The command is read-only. It returns a 0-100 score, `healthy`/`watch`/`degraded`/`critical` level, section scores, top issues, and critical-path signals. `--fail-under <score>` makes the command exit non-zero when the score is below a CI threshold.

### `agent-history`

Summarizes per-agent reputation and recent history from current and completed tasks, notes, verification entries, docs reviews, handoffs, stale owned work, and audit log entries.

```bash
npm run agents:agent:history
npm run agents -- agent-history agent-1 --limit 5
npm run agents -- agent-history agent-1 agent-2 --stale-hours 12 --json
```

The command is read-only. Scores are bounded from 0 to 100 and include positive signals for completed work, passing verification, docs review, handoffs, progress notes, and audit-trail participation, with penalties for failing verification and stale, blocked, or waiting owned work.

### `cost-time`

Reports estimated hours, observed activity spans, open task age, and optional cost from task effort metadata, explicit hour fields, notes, verification logs, docs review timestamps, and handoff timestamps.

```bash
npm run agents:cost:time
npm run agents -- cost-time --rate 150 --currency USD --json
npm run agents -- cost-time task-api --agent agent-1 --from 2026-01-01 --to 2026-01-31
```

The command is read-only. Effort values map to hours (`small` = 2, `medium` = 6, `large` = 16, `xl` = 32) unless a task has explicit `estimatedHours`, `estimateHours`, `timeEstimateHours`, or `hoursEstimate`. `actualHours`, `spentHours`, `timeSpentHours`, or `observedHours` override observed spans.

### `runbooks`

Lists built-in runbooks, suggests matching runbooks for a task or path set, and creates custom runbooks under `coordination/runbooks/`.

```bash
npm run agents:runbooks -- list
npm run agents -- runbooks show migration
npm run agents -- runbooks suggest --task task-id --json
npm run agents -- runbooks suggest --paths migrations/001.sql --summary "auth migration"
npm run agents -- runbooks create custom-release --title "Custom release" --keywords release,deploy --paths deploy --steps "Check status|Deploy|Verify" --apply
```

Built-in runbooks cover migrations, auth changes, releases, incidents, and visual updates. Custom runbooks use JSON files with `id`, `title`, `summary`, `triggers.keywords`, `triggers.paths`, `steps`, `checks`, and `docs`. `create` is a dry run unless `--apply` is passed.

### `path-groups`

Groups paths by package boundary, module prefix, broad work category, and lightweight relative import relationships.

```bash
npm run agents:path:groups -- --paths app/page.tsx,components/Button.tsx
npm run agents -- path-groups --json
```

When `--paths` is omitted, the command groups claimed paths from the current board. JSON output includes group IDs, package roots, categories, grouped paths, import edges, dependencies, and dependents.

### `split-validate`

Validates a task split for overlapping ownership, bad dependencies, missing verification, overly broad claimed paths, and tasks that span too many path groups or work categories.

```bash
npm run agents:split:validate
npm run agents -- split-validate --json
npm run agents -- split-validate --task task-id --strict
npm run agents -- split-validate --board coordination/board.json --json
```

The command is read-only. By default it reports findings and exits 0; pass `--strict` to exit non-zero when error-level findings are present.

### `escalation-route`

Suggests who to ask for blocked or waiting work using active overlapping ownership, previous completed work on the same paths, and CODEOWNERS.

```bash
npm run agents:escalation:route -- --task task-id
npm run agents -- escalation-route --paths app/page.tsx,api/routes/user.ts --reason "Need contract review"
npm run agents -- escalation-route --task task-id --json
```

Routes are scored with active owners first, then previous task owners and CODEOWNERS. The command is read-only and includes the matched paths, source signals, and reasons for each suggested target.

### `steal-work`

Suggests stale, handoff, review, and unowned ready tasks that an idle agent can safely take over. With `--apply`, it assigns the best candidate or the selected `--task` and records a workspace snapshot plus audit entry.

```bash
npm run agents:work:steal -- agent-2
npm run agents -- steal-work --agent agent-2 --stale-hours 12 --json
npm run agents -- steal-work agent-2 --task task-id --apply --json
```

The default mode is read-only. Candidates require satisfied dependencies unless `--force` is passed. Applied steals move the previous owner to idle when that owner still points at the stolen task.

### `contracts`

Manages contract files for shared API, schema, and cross-task interfaces under `coordination/contracts/`.

```bash
npm run agents:contracts -- list
npm run agents -- contracts create api-v1 --owner agent-1 --scope api --summary "API v1 request/response contract"
npm run agents -- contracts create api-v1 --owner agent-1 --scope api --summary "API v1 request/response contract" --producer task-api --consumer task-ui --apply --json
npm run agents -- contracts check --json
```

Subcommands:

- `list [--json]`
- `show <id> [--json]`
- `create <id> --owner <agent> --scope <path[,path...]> --summary <text> [--producer <task-id>] [--consumer <task-id[,task-id...]>] [--status draft|active|deprecated] [--apply] [--json]`
- `check [--json]`

Creation is a dry run unless `--apply` is passed. `contracts check` validates contract files, task references, scopes, status values, and warns when active/planned work touches contract-sensitive data/API paths without an active contract.

### `branches`

Shows local Git branches, active task branch ownership, merged/gone/stale status, and dry-run cleanup candidates.

```bash
npm run agents:branches
npm run agents -- branches --json
npm run agents -- branches --stale-days 14 --base origin/main
```

`branches --apply` deletes only cleanup candidates: non-current, non-protected branches with no active task branch ownership that are stale and either merged into the selected base or tracking a gone upstream.

### `github-status`

Inspects the local GitHub remote, current branch/upstream state, GitHub Actions merge queue triggers, and optional live PR metadata through the GitHub CLI.

```bash
npm run agents:github:status
npm run agents -- github-status --json
npm run agents -- github-status --live
```

By default the command is local-only and does not contact GitHub. `--live` runs `gh pr view` for the current branch and reports failures as warnings.

### `claim`

Claims a task for an agent and records claimed paths. Claims can also set priority metadata with `--priority low|normal|high|urgent`, `--due-at <iso|YYYY-MM-DD>`, and `--severity none|low|medium|high|critical`. Before delegating to the core claim command, the command layer performs a Git preflight check for branch, upstream, ahead/behind state, dirty files, untracked files, merge/rebase state, and configured branch policies. Merge/rebase-in-progress state and configured branch policy violations block the claim.

The claim command also applies coordination policies from config:

- `capacity.maxActiveTasksPerAgent`: blocks claims when an agent already owns too much active work.
- `capacity.maxBlockedTasksPerAgent`: blocks claims when an agent is carrying too much blocked work.
- `capacity.preferredDomainsByAgent`: warns, or blocks when `enforcePreferredDomains` is true, if a claim does not match the agent's preferred domains.
- `conflictPrediction.blockOnGitOverlap`: blocks claims when current local Git changes overlap another active agent's claimed paths.
- Active claims record the current Git branch when Git is available, which feeds `branches` multi-branch reporting.

```bash
npm run agents -- claim agent-1 task-id --paths src/tasks,docs/tasks.md
npm run agents -- claim agent-1 task-id --paths src/tasks --priority high --due-at 2026-05-01 --severity medium
```

Configure branch claim policies in `agent-coordination.config.json`:

```json
{
  "git": {
    "allowMainBranchClaims": false,
    "allowDetachedHead": false,
    "allowedBranchPatterns": ["agent/*", "feature/*", "fix/*"]
  },
  "capacity": {
    "maxActiveTasksPerAgent": 1,
    "maxBlockedTasksPerAgent": 1,
    "preferredDomainsByAgent": {
      "agent-1": ["app"],
      "agent-2": ["backend", "docs"]
    },
    "enforcePreferredDomains": false
  },
  "conflictPrediction": {
    "enabled": true,
    "blockOnGitOverlap": true
  }
}
```

Policy fields:

- `allowMainBranchClaims`: allow claims from `main` or `master`.
- `allowDetachedHead`: allow claims when Git is in detached HEAD state.
- `allowedBranchPatterns`: optional glob-style branch allowlist. When non-empty, the current branch must match at least one pattern.

### `start`

Convenience lifecycle helper that claims a task and optionally records an initial progress note.

```bash
npm run agents:start -- agent-1 task-id --paths src/tasks "Starting task implementation."
npm run agents -- start agent-1 task-id --paths src/tasks,docs/tasks.md "Starting task implementation."
npm run agents -- start agent-1 task-id --paths src/tasks --priority urgent --due-at 2026-05-01 "Starting hotfix."
```

### `prioritize`

Updates task priority, due date, or severity on an existing task.

```bash
npm run agents:prioritize -- task-id --priority high --due-at 2026-05-01 --severity medium
npm run agents -- prioritize task-id --due-at none --by agent-1
npm run agents -- prioritize task-id --priority urgent --json --dry-run
```

Supported values:

- Priority: `low`, `normal`, `high`, `urgent`.
- Severity: `none`, `low`, `medium`, `high`, `critical`.
- Due dates: ISO timestamps, `YYYY-MM-DD`, or `none` to clear.

Priority and due-date metadata appears in `status`, `summarize`, `prompt`, `ask`, task docs under `coordination/tasks/`, and `pick` scoring.

### `approvals`

Maintains a board-backed approval ledger for task gates.

```bash
npm run agents:approvals -- list
npm run agents -- approvals request agent-1 task-id release "Ready for human approval"
npm run agents -- approvals grant approval-task-id-release-123 --by agent-2 --note "Reviewed"
npm run agents -- approvals check task-id --scope release --json
npm run agents -- approvals use approval-task-id-release-123 --by agent-1
```

Subcommands:

- `list [--task <task-id>] [--scope <scope>] [--status pending|approved|denied|used] [--json]`
- `check <task-id> [--scope <scope>] [--json]`
- `request <agent> <task-id> <scope> <summary>`
- `grant <approval-id> --by <agent> [--note <text>]`
- `deny <approval-id> --by <agent> [--note <text>]`
- `use <approval-id> --by <agent> [--note <text>]`

Approval entries are stored in `board.json` under `approvals`, appear in `status` and `prompt`, and are included in board validation.

### `progress`

Adds a progress note to a task.

```bash
npm run agents -- progress agent-1 task-id "Implemented parser and started tests."
```

### `blocked`

Marks a task blocked and records the blocker.

```bash
npm run agents -- blocked agent-1 task-id "Waiting for API contract."
```

### `waiting`

Marks a task waiting on one or more dependency tasks.

```bash
npm run agents -- waiting agent-2 task-ui --on task-api
```

### `review`

Moves a task into review.

```bash
npm run agents -- review agent-1 task-id "Ready for verification."
```

### `handoff-ready`

Convenience lifecycle helper that marks a task ready for handoff using the core handoff command.

```bash
npm run agents:handoff-ready -- agent-1 task-id "Ready for agent-2 to continue."
npm run agents -- handoff-ready agent-1 task-id "Ready for agent-2 to continue."
```

### `verify`

Records manual verification evidence for a task.

```bash
npm run agents -- verify agent-1 task-id unit pass "npm test passed"
npm run agents -- verify agent-1 task-id lint fail "lint failed in src/foo.ts"
npm run agents -- verify agent-1 task-id visual pass --details "visual:test passed" --artifact artifacts/visual/report.html
```

Use `--artifact <path[,path...]>` to attach logs, screenshots, reports, traces, or other evidence from configured artifact roots. Artifact metadata is stored on the verification log entry and can be listed with `artifacts list`.

### `done`

Marks a task done when required verification is complete.

```bash
npm run agents -- done agent-1 task-id "Implemented and verified."
```

### `finish`

Convenience lifecycle helper that marks a task done using the core done command.

```bash
npm run agents:finish -- agent-1 task-id "Implemented and verified."
npm run agents -- finish agent-1 task-id "Implemented and verified."
```

Optional safety gates:

```bash
npm run agents -- finish agent-1 task-id --require-verification "Finished and verified."
npm run agents -- finish agent-1 task-id --require-doc-review "Finished after reviewing docs."
npm run agents -- finish agent-1 task-id --require-verification --require-doc-review "Finished safely."
npm run agents -- finish agent-1 task-id --require-approval --approval-scope release "Finished after approval."
```

Gate behavior:

- `--require-verification`: all checks listed in the task `verification` array must have a latest `verificationLog` outcome of `pass`.
- `--require-doc-review`: the task must have `docsReviewedAt` recorded.
- `--require-approval`: the task must have an `approved` or `used` approval ledger entry. Use `--approval-scope <scope>` to require a specific scope.
- Configured `policyEnforcement.rules.finishRequiresDocsReview` and `finishRequiresApproval` can apply the same gates automatically; in `block` mode they fail before mutation, and in `warn` mode they print policy warnings.
- If a gate fails, the command exits before delegating to the core `done` command, so the board is not mutated.

### `release`

Marks a done task released.

```bash
npm run agents -- release agent-1 task-id "Merged into main."
```

### Resource Leases

Reserve, renew, and release shared resources such as local servers, devices, or deployment slots.

```bash
npm run agents -- reserve-resource agent-1 dev-server "Running the local server" --task task-ui --ttl-minutes 60
npm run agents -- renew-resource agent-1 dev-server --ttl-minutes 60 --reason "Still validating"
npm run agents -- release-resource agent-1 dev-server
```

Resource leases record owner agent, machine, process, terminal/session, TTL, and expiration time. Another agent cannot reserve the same resource until it is released or the lease has expired.

### Incident Mode

Coordinate urgent shared failures, optionally binding the incident to a task and reserving a shared resource while the incident is open.

```bash
npm run agents -- start-incident agent-1 server-down "Investigating server outage" --resource dev-server --task task-api
npm run agents -- join-incident agent-2 server-down
npm run agents -- close-incident agent-1 server-down "Recovered after config fix"
```

Open incidents are stored on `board.json` under `incidents`, appear in `status`, and participate in stale-session recovery. If `start-incident` reserves a resource, `close-incident` releases that incident-held resource when the owner closes the incident.

## Runtime Lock Commands

### `lock-clear`

Clears stale runtime state locks safely. This is routed through the main CLI, so all wrapper forms work.

```bash
npm run agents:lock:clear
npm run agents2:lock:clear
npm run agents -- lock-clear --stale-only
npm run agents -- lock-clear --stale-only --json
npm run ai-agents -- lock-clear --stale-only --json
node ./scripts/lock-runtime.mjs clear --stale-only --coordination-dir coordination
```

Safety rules:

- `clear --stale-only` removes only malformed, old, or dead-PID locks.
- Non-stale locks are refused.
- Use `--force` only when a human has confirmed the lock should be removed.
- Use `--json` for machine-readable output.

### `cleanup-runtime`

Dry-runs or applies cleanup for stale runtime files.

```bash
npm run agents:runtime:cleanup
npm run agents -- cleanup-runtime --json
npm run agents -- cleanup-runtime --apply
```

By default this is a dry run. With `--apply`, it removes only stale runtime locks, stale watcher status, and stale heartbeat files detected by runtime diagnostics.

## Board Recovery Commands

### `repair-board`

Normalizes safe board fields and creates a snapshot before writing when applied.

```bash
npm run agents:board:repair
npm run agents -- repair-board --json
npm run agents -- repair-board --apply
```

The default mode is a dry run. Applied repairs can initialize missing top-level arrays, configured agent slots, and missing task array fields. Malformed JSON is not repaired automatically.

### `migrate-board`

Migrates `board.json` to the current board schema version and creates snapshots before writing when applied.

```bash
npm run agents:board:migrate
npm run agents -- migrate-board --json
npm run agents -- migrate-board --apply
```

The default mode is a dry run. Applied migrations update older or missing board schema fields, normalize configured agent slots, and append an audit entry.

### `rollback-state`

Lists board snapshots or restores one.

```bash
npm run agents:state:rollback -- --list
npm run agents -- rollback-state --list --json
npm run agents -- rollback-state --to latest --apply
npm run agents -- rollback-state --to coordination/runtime/snapshots/board-example.json --apply
```

Rollback applies only with `--apply`. Before replacing `board.json`, it snapshots the current board.

### `compact-state`

Archives older journal and message lines while keeping recent coordination context in place.

```bash
npm run agents:state:compact
npm run agents -- compact-state --keep-journal-lines 200 --keep-message-lines 500
npm run agents -- compact-state --keep-journal-lines 100 --keep-message-lines 200 --apply --json
```

The command is a dry run unless `--apply` is passed. Applied compaction writes a compressed workspace snapshot first, stores compacted lines under `coordination/archive/state-compaction-*.json`, then rewrites `journal.md` and `messages.ndjson` with only the retained tail.

### `snapshot-workspace`

Creates a compressed workspace snapshot containing board, journal, messages, and runtime state files.

```bash
npm run agents:snapshot:workspace
npm run agents -- snapshot-workspace --json
npm run agents -- snapshot-workspace --apply --json
```

The default mode is a dry run. Applied snapshots are written under `coordination/runtime/snapshots/workspace-<timestamp>.json.gz`. Runtime snapshot files are excluded from the compressed payload so snapshots do not recursively contain previous snapshots.

Applied command-layer mutations such as board migration/repair, rollback, config migration, policy packs, templates, and completed-task archiving also write a compressed pre-mutation workspace snapshot before changing state.

### `archive-completed`

Moves old done or released tasks out of the active board into a dated archive file.

```bash
npm run agents:archive:completed
npm run agents -- archive-completed --older-than-days 30
npm run agents -- archive-completed --older-than-days 30 --apply --json
```

The default mode is a dry run. Applied archives snapshot the current board first, write archived tasks under `coordination/archive/tasks-YYYY-MM.json`, remove archived task docs from `coordination/tasks/`, and leave active, blocked, waiting, review, handoff, and planned work on the board.

## Check Runner

### `run-check`

Runs a package script or explicit command and captures stdout/stderr as an artifact.

```bash
npm run agents:run-check -- test
npm run agents -- run-check smoke -- node ./scripts/smoke.mjs
npm run agents -- run-check smoke --json -- node -e "console.log('ok')"
```

Artifacts are written under `artifacts/checks/` by default, with an `index.ndjson` entry for each run. Use `--artifact-dir <path>` to write elsewhere.

### `artifacts`

Lists or inspects known artifacts from verification logs and `run-check` indexes.

```bash
npm run agents -- artifacts list
npm run agents -- artifacts list --task task-id --check unit --json
npm run agents -- artifacts inspect artifacts/checks/example.log
npm run agents -- artifacts inspect artifacts/checks/example.log --json
npm run agents -- artifacts prune
npm run agents -- artifacts prune --apply --json
```

`artifacts prune` is dry-run by default. It keeps artifacts referenced by active work, honors configured protected patterns, applies separate retention for failed checks, and can prune oldest eligible files when artifact storage exceeds `artifacts.maxMb`.

## Notes and Messaging

### `app-note`

Appends a durable note to the configured app notes doc.

```bash
npm run agents -- app-note agent-1 gotcha "The visual suite requires snapshots." --task task-ui --paths tests/visual
```

### `message`

Adds a lightweight coordination message for another agent or the team.

```bash
npm run agents -- message agent-1 agent-2 "API contract is ready."
```

## Heartbeat and Watcher Commands

### `heartbeat-start`

Starts heartbeat tracking for an agent/session.

```bash
npm run agents:heartbeat:start -- agent-1
```

### `heartbeat-stop`

Stops heartbeat tracking.

```bash
npm run agents:heartbeat:stop -- agent-1
```

### `watch-start`

Starts the Node watcher loop by default.

```bash
npm run agents:watch:start
npm run agents -- watch-start --interval 30000
```

### `agents:watch:node`

Runs the cross-platform Node watcher loop directly. This is useful for diagnostics or one-shot ticks.

```bash
npm run agents:watch:node
npm run agents2:watch:node
node ./scripts/agent-watch-loop.mjs --coordinator-script ./scripts/agent-coordination.mjs --once
```

## Mutation vs Read-only Behavior

Read-only commands should not change board, journal, messages, runtime, or task files. Mutation commands should record meaningful journal entries and keep task status, ownership, verification, and timestamps consistent.

Use tests for new command work so accidental mutations are caught early.
