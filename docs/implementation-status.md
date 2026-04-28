# Implementation Status

This document tracks roadmap items that now have concrete implementation support in the repo.

## Implemented or Partially Implemented

### Installer / bootstrap command

Status: implemented as a standalone script.

```bash
npm run bootstrap -- --target C:\path\to\repo
npm run bootstrap -- --target ../target-repo --dry-run
npm run bootstrap -- --target ../frontend-app --profile react
npm run bootstrap -- --list-profiles
```

Implemented behavior:

- Copies coordinator scripts and docs into a target repo.
- Adds standard `package.json` scripts.
- Adds coordination runtime folders to `.gitignore`.
- Creates starter app notes when missing.
- Applies optional repo bootstrap profiles: `react`, `backend`, `docs`, and `release`.
- Merges profile config into existing `agent-coordination.config.json` without deleting local values.
- Runs `npm run agents:doctor` unless `--skip-doctor` is passed.
- Installs the command layer, planner sizing helper, lock diagnostics, and the new command shortcuts into target repos.

Main files:

- `scripts/bootstrap.mjs`
- `tests/bootstrap.test.mjs`

### Import/update command

Status: implemented in the command layer.

```bash
npm run agents:update
npm run agents -- update-coordinator --source C:\path\to\ai_agents --apply
```

Current behavior:

- Dry-run by default.
- Copies coordinator scripts, the public CLI, schema, and `scripts/lib/` helpers from a source package or checkout.
- Preserves `agent-coordination.config.json`, runtime state, artifacts, and local docs by default.
- Can include bundled docs only when `--include-docs` is passed.

Main files:

- `scripts/lib/update-commands.mjs`
- `scripts/lib/install-manifest.mjs`
- `tests/update-commands.test.mjs`

### Backlog importer

Status: partially implemented in the command layer.

```bash
npm run agents:backlog:import -- --from BACKLOG.md
npm run agents -- backlog-import --from README.md,docs --apply --json
```

Current behavior:

- Dry-run by default.
- Scans Markdown files or directories for unchecked task-list items and `TODO:` lines.
- Creates planned tasks with stable import source metadata.
- Skips existing imports on rerun.
- Writes a compressed pre-mutation workspace snapshot before applied board changes.

Follow-up: add GitHub issue import once auth and write/update policy are defined.

Main files:

- `scripts/lib/backlog-import-commands.mjs`
- `tests/backlog-import-commands.test.mjs`

### Command audit log

Status: partially implemented for command-layer apply flows and legacy core mutations.

Current behavior:

- Applied command-layer mutations append JSON lines to `coordination/runtime/audit.ndjson`.
- Lock-protected legacy core mutations append audit entries after successful writes.
- Audit entries include timestamp, command, applied flag, summary, and command-specific details.
- Covered flows include completed-task archiving, board repair/rollback, config migration, policy packs, templates, and Markdown backlog import.
- Core coverage includes lifecycle and coordination commands such as claim, progress, wait/resume, done/release, access requests, incidents, resource leases, planning apply, and recovery apply.

Follow-up: add richer per-command audit details for legacy core commands beyond the generic command/args/workspace metadata.

Main files:

- `scripts/lib/audit-log.mjs`
- `tests/archive-commands.test.mjs`
- `tests/backlog-import-commands.test.mjs`
- `tests/core-mutation-safety.test.mjs`

### Runtime and CI baseline

Status: implemented.

The repo now targets Node 24 consistently:

- `package.json` uses `engines.node: >=24`.
- `.nvmrc` is set to `24`.
- `.node-version` is set to `24`.
- CI uses `actions/setup-node@v4` with `node-version: 24`.
- CI installs with `npm ci`.
- CI enables npm cache keyed by `package-lock.json`.
- CI runs `npm run check` before `npm test`; `npm test` runs only `node --test` to avoid duplicate syntax checks.

Main files:

- `package.json`
- `package-lock.json`
- `.nvmrc`
- `.node-version`
- `.github/workflows/ci.yml`

### Command layer

Status: implemented.

The command layer wraps the existing core coordinator without rewriting the large core file. It intercepts newer commands and delegates legacy commands to the core implementation.

Main file:

- `scripts/agent-command-layer.mjs`

Wrappers using it:

- `bin/ai-agents.mjs`
- `scripts/agent-coordination.mjs`
- `scripts/agent-coordination-two.mjs`

### Better error formatting

Status: partially implemented for top-level command failures and common inline command-layer errors.

Current behavior:

- Command-layer and legacy core top-level catches use a shared formatter.
- Text mode writes `error:` and optional `hint:` diagnostics to stderr.
- Commands invoked with `--json` emit `{ ok: false, error, code, hint }` on stdout.
- `--verbose` includes stack traces for formatted top-level errors.
- Inline error paths for command help, artifact inspection, board repair/rollback, policy packs, config migration, run-check, lifecycle gates, Git preflight, and command-layer validation use the shared formatter.

Follow-up: continue replacing any older command-specific diagnostic output when those commands are refactored.

Main files:

- `scripts/lib/error-formatting.mjs`
- `tests/error-formatting.test.mjs`

### Mutation dry runs

Status: partially implemented across legacy core mutations and existing command-layer apply flows.

Current behavior:

- Existing command-layer apply flows remain dry-run by default and require `--apply` for writes.
- Legacy core state mutations accept `--dry-run`, validate inputs, run in no-write mode, and print a dry-run notice.
- Heartbeat and watcher commands have explicit `--dry-run` paths that do not spawn or stop background processes.
- `run-check --dry-run` reports the command that would run without executing it or writing artifacts.

Main files:

- `scripts/agent-coordination-core.mjs`
- `scripts/agent-command-layer.mjs`
- `tests/core-mutation-safety.test.mjs`

### State transactions

Status: partially implemented for lock-protected core state mutations and command-layer apply flows.

Current behavior:

- Lock-protected legacy core mutations run inside a transaction covering `board.json`, task docs, `journal.md`, and `messages.ndjson`.
- Command-layer apply flows that write multiple local files use transactions, including doctor fixes, check artifacts, config migration, policy packs, release bundles, archive completed, backlog import, board repair/rollback, templates, artifact pruning, runtime cleanup, and coordinator updates.
- If a write fails after partial state changes, the previous files are restored.
- Shared JSON/text write helpers use atomic temp-file replacement.

Follow-up: external side effects such as Git branch deletion are still outside transaction rollback.

Main files:

- `scripts/lib/state-transaction.mjs`
- `scripts/lib/file-utils.mjs`
- `tests/core-mutation-safety.test.mjs`

### `doctor --fix`

Status: implemented in the command layer.

```bash
npm run agents -- doctor --fix
npm run agents:doctor:fix
```

Safe fixes currently include:

- Create missing starter config.
- Add runtime folders to `.gitignore`.
- Create starter app notes.
- Create missing coordination runtime folders.
- Create starter board, journal, and messages files.
- Add missing package scripts.

### `doctor --json`

Status: implemented in the command layer.

```bash
npm run agents -- doctor --json
npm run agents:doctor:json
npm run agents -- doctor --json --fix
```

Output includes:

- Config validation result.
- Git state and policy summary.
- Coordination path summary.
- Runtime file existence checks.
- Optional applied fixes.

### JSON schema for config

Status: implemented as schema plus standalone validator, and integrated into the command layer for `doctor` and `validate`.

```bash
npm run validate:agents-config
node ./scripts/validate-config.mjs --config ./agent-coordination.config.json --json
npm run agents -- validate --json
```

Main files:

- `agent-coordination.schema.json`
- `scripts/validate-config.mjs`
- `tests/config-validation.test.mjs`
- `tests/command-layer.test.mjs`

### Config inheritance

Status: implemented in the shared config loader.

```json
{
  "extends": ["./config/base.json"],
  "projectName": "Local App",
  "paths": { "sharedRisk": ["package.json"] }
}
```

Current behavior:

- `extends` accepts a string path or array of paths.
- Inherited paths resolve relative to the config file that declares them.
- Objects merge recursively; arrays merge uniquely; named object arrays merge by `name`.
- Local config values override inherited values.
- `validate`, `doctor`, `explain-config`, command-layer commands, and legacy core commands read the merged config.
- Validation JSON includes `configSources`, and `explain-config` reports the source chain.

Main files:

- `scripts/validate-config.mjs`
- `scripts/agent-command-layer.mjs`
- `scripts/agent-coordination-core.mjs`
- `scripts/explain-config.mjs`
- `tests/config-validation.test.mjs`

### Better Git awareness before claims

Status: implemented in the command layer before `claim` delegates to the core command.

The preflight reports:

- Current branch.
- Upstream branch.
- Ahead/behind state.
- Dirty files.
- Untracked files.
- Merge/rebase state.
- Configured Git claim policy.

Blocking rules currently include:

- Merge in progress.
- Rebase in progress.
- Detached HEAD when `git.allowDetachedHead` is false.
- `main`/`master` claims when `git.allowMainBranchClaims` is false.
- Branch names that do not match `git.allowedBranchPatterns` when that allowlist is non-empty.

Config example:

```json
{
  "git": {
    "allowMainBranchClaims": false,
    "allowDetachedHead": false,
    "allowedBranchPatterns": ["agent/*", "feature/*", "fix/*"]
  }
}
```

### Agent capacity and conflict prediction

Status: partially implemented in the core claim path.

Claim-time policy now supports:

- `capacity.maxActiveTasksPerAgent`
- `capacity.maxBlockedTasksPerAgent`
- `capacity.preferredDomainsByAgent`
- `capacity.enforcePreferredDomains`
- `conflictPrediction.enabled`
- `conflictPrediction.blockOnGitOverlap`

Current behavior:

- Blocks claims when the target agent is already at active or blocked work limits.
- Warns or blocks when an agent claims work outside its configured preferred domains.
- Checks local Git changes against other active agents' claimed paths before claim.
- Blocks predicted Git-overlap conflicts unless `--force` is used.

Main files:

- `scripts/lib/claim-policy.mjs`
- `scripts/lib/task-claim-commands.mjs`
- `tests/command-layer.test.mjs`
- `tests/git-policy.test.mjs`

### Board summarize

Status: implemented and enhanced in the command layer.

```bash
npm run agents:summarize
npm run agents -- summarize
npm run agents -- summarize --for-chat
npm run agents -- summarize --json
```

The summary now includes:

- counts by status
- active work
- blockers
- review queue
- stale active work
- next planned work
- next recommended actions
- recent journal lines
- recent messages

### Lifecycle helpers

Status: implemented in the command layer.

```bash
npm run agents -- start agent-1 task-id --paths src/path "Starting work."
npm run agents -- finish agent-1 task-id "Implemented and verified."
npm run agents -- handoff-ready agent-1 task-id "Ready for another agent."
```

Helpers delegate to existing core commands:

- `start` -> `claim`, then optional `progress`.
- `finish` -> `done`.
- `handoff-ready` -> `handoff`.

`finish` now supports optional safety gates:

```bash
npm run agents -- finish agent-1 task-id --require-verification --require-doc-review "Finished safely."
```

Gate behavior:

- `--require-verification`: all task `verification` checks must have latest passing verification log entries.
- `--require-doc-review`: the task must have `docsReviewedAt` recorded.
- If a gate fails, the command exits before delegating to core `done`, so the board is not mutated.

### Conflict-safe resource leases

Status: partially implemented in the core support-operation commands.

```bash
npm run agents -- reserve-resource agent-1 dev-server "Running local server" --ttl-minutes 60
npm run agents -- renew-resource agent-1 dev-server --ttl-minutes 60 --reason "Still validating"
npm run agents -- release-resource agent-1 dev-server
```

Current behavior:

- Resource reservations include owner agent, machine, process ID, terminal/session ID, TTL, renewal time, and expiration time.
- Same-owner reservation renews the lease.
- `renew-resource` refreshes a held lease and can update its reason.
- Other agents are blocked while a lease is active.
- Expired leases can be taken over by another agent.

Main files:

- `scripts/lib/support-operation-commands.mjs`
- `tests/resource-leases.test.mjs`

### Incident mode

Status: implemented in the core support-operation commands.

```bash
npm run agents -- start-incident agent-1 server-down "Investigating outage" --resource dev-server --task task-api
npm run agents -- join-incident agent-2 server-down
npm run agents -- close-incident agent-1 server-down "Recovered after config fix"
```

Current behavior:

- `start-incident` opens a unique incident with owner, participants, optional task, optional resource, summary, and timestamps.
- Incident resources are reserved with the same lease metadata used by resource reservations.
- `join-incident` records additional participants.
- Only the incident owner can close an open incident.
- Closing an incident stores the resolution and releases the incident-held resource.
- Incident lifecycle commands support `--dry-run`.

Main files:

- `scripts/lib/support-operation-commands.mjs`
- `tests/incident-commands.test.mjs`

### Runtime lock diagnostics

Status: implemented as a standalone utility, npm scripts, and routed main CLI commands.

```bash
npm run agents:lock:status
npm run agents:lock:clear
npm run agents2:lock:status
npm run agents2:lock:clear
npm run agents -- lock-status --json
npm run agents -- lock-clear --stale-only --json
node ./scripts/lock-runtime.mjs status --coordination-dir coordination --json
node ./scripts/lock-runtime.mjs clear --stale-only --coordination-dir coordination --json
```

Current behavior:

- Reports missing, valid, malformed, old, or dead-PID runtime locks.
- Detects stale locks by age, malformed JSON, or a non-running PID.
- Refuses to clear non-stale locks when `--stale-only` is used.
- Requires `--stale-only` or `--force` to clear a lock.
- Supports `--json`, `--coordination-dir`, `--coordination-root`, and `--stale-ms`.

Main files:

- `scripts/lock-runtime.mjs`
- `tests/lock-runtime.test.mjs`

### Watcher diagnostics and runtime cleanup

Status: implemented in the command layer.

```bash
npm run agents -- watch-diagnose
npm run agents -- watch-diagnose --json
npm run agents -- cleanup-runtime
npm run agents -- cleanup-runtime --apply
```

Current behavior:

- Reports watcher status, runtime lock state, and heartbeat files in one diagnostic payload.
- Flags stale watcher status, stale runtime locks, and stale heartbeat files.
- `cleanup-runtime` is dry-run by default.
- `cleanup-runtime --apply` removes only stale lock, watcher, and heartbeat runtime files.

Main files:

- `scripts/agent-command-layer.mjs`
- `tests/roadmap-commands.test.mjs`

### Release check

Status: implemented in the command layer.

```bash
npm run agents -- release-check task-id
npm run agents -- release-check task-id --json
```

Current behavior:

- Checks done/released tasks for passing latest verification.
- Blocks latest failing verification.
- Checks dependencies are done or released.
- Requires docs review when relevant docs are attached or `--require-doc-review` is used.

### Board inspection, migration, repair, and rollback

Status: implemented in the command layer.

```bash
npm run agents -- inspect-board
npm run agents -- migrate-board
npm run agents -- migrate-board --apply
npm run agents -- repair-board
npm run agents -- repair-board --apply
npm run agents -- rollback-state --list
npm run agents -- rollback-state --to latest --apply
```

Current behavior:

- `inspect-board` reports structural findings and task counts without mutating state.
- `migrate-board` updates older or missing `board.json` schema fields to the current schema version.
- `repair-board` is dry-run by default and applies only safe normalization with `--apply`.
- Applied migrations and repairs snapshot the previous board under `runtime/snapshots/` and write a compressed pre-mutation workspace snapshot.
- `rollback-state` lists snapshots and restores one only with `--apply`.

Main files:

- `scripts/lib/board-migration.mjs`
- `scripts/lib/board-maintenance.mjs`
- `tests/roadmap-commands.test.mjs`

### Workspace snapshots

Status: partially implemented in the command layer.

```bash
npm run agents:snapshot:workspace -- --apply
npm run agents -- snapshot-workspace --apply --json
```

Current behavior:

- Dry-run by default.
- Captures board, journal, messages, and runtime state files.
- Writes compressed `workspace-<timestamp>.json.gz` files under `runtime/snapshots/` when applied.
- Excludes existing snapshot files from the compressed payload.
- Applied command-layer mutations now write compressed pre-mutation snapshots before board repair, rollback, config migration, policy pack application, template writes, and completed-task archiving.

Follow-up: wire automatic workspace snapshots into legacy core lifecycle mutations such as claim, progress, wait, review, done, and release.

Main files:

- `scripts/lib/workspace-snapshot-commands.mjs`
- `tests/workspace-snapshot-commands.test.mjs`

### Check runner and artifacts

Status: expanded in the command layer and core verification command.

```bash
npm run agents -- run-check test
npm run agents -- run-check smoke -- node ./scripts/smoke.mjs
npm run agents -- verify agent-1 task-id unit pass --artifact artifacts/unit.log
npm run agents -- artifacts list --task task-id
npm run agents -- artifacts inspect artifacts/unit.log --json
```

Current behavior:

- Runs a package script by name, or an explicit command after `--`.
- Captures stdout/stderr into `artifacts/checks/`.
- Appends a machine-readable `index.ndjson` entry.
- `verify --artifact <path[,path...]>` records artifact metadata on verification log entries.
- `artifacts list` reads verification artifacts and `run-check` indexes.
- `artifacts inspect` reports file metadata and known references.

### PR handoff and release bundle

Status: implemented in the command layer.

```bash
npm run agents -- pr-summary
npm run agents -- pr-summary task-id --json
npm run agents -- release-bundle task-id --apply
```

Current behavior:

- `pr-summary` produces PR-ready Markdown or JSON with changes, verification, risks, and follow-ups.
- `release-bundle` is dry-run by default.
- `release-bundle --apply` writes `pr-summary.md`, `board-summary.md`, `release-check.json`, and `artifacts.json`.

### Agent prompt generator

Status: implemented in the command layer.

```bash
npm run agents:prompt -- agent-1
npm run agents -- prompt agent-1 task-id
npm run agents -- prompt agent-1 --json
```

Current behavior:

- Finds an agent's current assignment from `agents[].taskId` or active owned tasks.
- Accepts an explicit task ID override.
- Produces copy-ready Markdown with task objective, claimed paths, dependency status, docs, verification expectations, recent notes, and next actions.
- Supports JSON output with the same structured prompt payload.

Main files:

- `scripts/lib/prompt-commands.mjs`
- `tests/prompt-commands.test.mjs`

### Natural-language board query

Status: partially implemented in the command layer.

```bash
npm run agents:ask -- "what is blocked?"
npm run agents -- ask "who owns src/path?"
npm run agents -- ask "what can agent-2 do next?" --json
```

Current behavior:

- Answers deterministic board questions without external model calls.
- Supports blocked, waiting, review, handoff, stale, task-status, path ownership, task ownership, and next-work questions.
- Falls back to a compact board summary for unsupported questions.
- Supports JSON output for automation.
- Is covered by read-only mutation tests.

Follow-up: add broader query patterns and optional model-backed querying if a future integration needs open-ended answers.

Main files:

- `scripts/lib/ask-commands.mjs`
- `tests/ask-commands.test.mjs`

### Task priority and deadlines

Status: implemented in the core lifecycle path with shared command-layer display support.

```bash
npm run agents -- claim agent-1 task-ui --paths app --priority high --due-at 2026-05-01
npm run agents:prioritize -- task-ui --priority urgent --severity critical
npm run agents -- prioritize task-ui --due-at none --dry-run
```

Current behavior:

- Tasks default to `priority: normal`, `dueAt: null`, and `severity: none`.
- `claim`, `start`, `plan`, `templates create-task`, and `backlog-import` can set initial metadata.
- `prioritize` updates existing tasks, supports `--dry-run` and `--json`, writes task docs, journal entries, and audit entries on apply.
- `status`, `summarize`, `prompt`, `ask`, and task Markdown docs surface the metadata.
- `pick` scores priority, severity, and approaching or overdue due dates.

Main files:

- `scripts/lib/task-metadata.mjs`
- `scripts/lib/task-metadata-commands.mjs`
- `tests/task-metadata.test.mjs`

### Approval ledger

Status: implemented in the core lifecycle path.

```bash
npm run agents -- approvals request agent-1 task-ui release "Ready for approval"
npm run agents -- approvals grant approval-task-ui-release-123 --by agent-2
npm run agents -- finish agent-1 task-ui --require-approval --approval-scope release "Done"
```

Current behavior:

- `approvals list|check|request|grant|deny|use` manages approval ledger entries in `board.json`.
- Entries track task, scope, requester, status, decision agent, decision notes, and use metadata.
- `finish --require-approval` blocks completion until an approved or used ledger entry exists, optionally scoped with `--approval-scope`.
- `status`, `prompt`, board migration, and board validation understand the `approvals` array.
- Applied approval mutations write task notes, journal entries, task docs, and core audit entries.

Main files:

- `scripts/lib/approval-ledger-commands.mjs`
- `tests/approval-ledger.test.mjs`

### Policy enforcement mode

Status: implemented in the command layer.

```bash
npm run agents:policy:check
npm run agents -- policy-check --json
```

Current behavior:

- `policyEnforcement.mode` supports `warn` and `block`.
- Enabled `broadClaims` and `codeownersCrossing` rules are evaluated by `policy-check` and during `claim` preflight.
- Enabled `finishRequiresApproval` and `finishRequiresDocsReview` rules are evaluated by `policy-check` and during `finish`.
- `warn` mode reports findings without blocking; `block` mode fails `policy-check` and stops claim/finish before mutation.
- Policy defaults are included in starter config, config migration, validation, schema, docs, completions, and read-only coverage.

Main files:

- `scripts/lib/policy-enforcement.mjs`
- `tests/policy-enforcement.test.mjs`

### Human-readable changelog

Status: implemented in the command layer.

```bash
npm run agents:changelog
npm run agents -- changelog --since 2026-01-01
npm run agents -- changelog --json
```

Current behavior:

- Reads done and released tasks from `board.json`.
- Reads archived tasks from `coordination/archive/tasks-*.json`.
- Groups entries by month in Markdown output.
- Includes task summaries, claimed paths, latest verification outcomes, artifact counts, and relevant docs.
- Supports `--since` filtering and JSON output.
- Is covered by read-only mutation tests.

Main files:

- `scripts/lib/changelog-commands.mjs`
- `tests/changelog-commands.test.mjs`

### Shell completions

Status: implemented in the command layer.

```bash
npm run agents:completions -- powershell
npm run agents -- completions bash
npm run agents -- completions zsh
npm run agents -- completions list --json
```

Current behavior:

- Generates PowerShell, Bash, and Zsh completion scripts.
- Includes command names, common flags, current agent IDs, task IDs, configured checks, and checks from verification history.
- Supports JSON output for tooling that wants to write the generated script elsewhere.
- Is covered by read-only mutation tests.

Main files:

- `scripts/lib/completion-commands.mjs`
- `tests/completion-commands.test.mjs`

### Ownership and dependency views

Status: implemented in the command layer.

```bash
npm run agents -- ownership-map
npm run agents -- graph
```

Current behavior:

- `ownership-map` reports active task ownership by agent and exits non-zero when claimed paths overlap.
- `graph` emits a Mermaid dependency graph or JSON nodes/edges.

### Ownership reviews and test-impact selection

Status: partially implemented in the command layer.

```bash
npm run agents:ownership:review
npm run agents -- ownership-review --json
npm run agents:test-impact -- --paths src/file.js
npm run agents -- test-impact --json
```

Current behavior:

- `ownership-review` reads CODEOWNERS-style files from configured ownership paths.
- Flags active tasks that claim broad paths such as `src`, `app`, or `lib`.
- Flags tasks whose claimed paths cross multiple CODEOWNERS owner groups.
- `test-impact` maps explicit `--paths` or the current Git diff to configured `checks.<name>.requiredForPaths`.
- Adds visual required checks for configured visual-impact paths.
- Falls back to `npm test` when paths changed but no more specific configured check matches.

Main files:

- `scripts/lib/impact-commands.mjs`
- `tests/command-layer.test.mjs`

### Risk scoring

Status: implemented in the command layer.

```bash
npm run agents:risk:score
npm run agents -- risk-score task-id --json
```

Current behavior:

- Scores planned, active-like, handoff, and done tasks.
- Uses broad claims, CODEOWNERS boundary crossings, shared-risk paths, active path overlaps, open dependencies, missing or failing verification, visual-impact verification, docs review, priority, severity, due dates, and blocked/waiting status.
- Emits `none`, `low`, `medium`, `high`, or `critical` levels plus point-by-point factors.
- Supports task-id filtering and JSON output.
- Is covered by read-only mutation tests.

Main files:

- `scripts/lib/risk-score-commands.mjs`
- `tests/risk-score-commands.test.mjs`

### Critical path planning

Status: implemented in the command layer.

```bash
npm run agents:critical:path
npm run agents -- critical-path --json
```

Current behavior:

- Builds the remaining task dependency graph from `dependencies`.
- Computes the longest downstream path from task effort plus risk level.
- Reports the critical task chain, ready tasks sorted by downstream cost, blocked tasks, and warnings.
- Detects missing dependencies and dependency cycles.
- Is read-only and covered by mutation guard tests.

Main files:

- `scripts/lib/critical-path-commands.mjs`
- `tests/critical-path-commands.test.mjs`

### Workspace health score

Status: implemented in the command layer.

```bash
npm run agents:health:score
npm run agents -- health-score --json
npm run agents -- health-score --fail-under 80
```

Current behavior:

- Produces a 0-100 health score with `healthy`, `watch`, `degraded`, or `critical` levels.
- Scores setup readiness, current work risk, verification gaps, critical-path warnings, and stale runtime state.
- Reuses risk scoring and critical-path planning signals.
- Emits section scores, top issues, and JSON output.
- Supports `--fail-under <score>` for CI gates.
- Is read-only and covered by mutation guard tests.

Main files:

- `scripts/lib/health-score-commands.mjs`
- `tests/health-score-commands.test.mjs`

### Reusable runbooks

Status: implemented in the command layer.

```bash
npm run agents:runbooks -- list
npm run agents -- runbooks show migration
npm run agents -- runbooks suggest --task task-id --json
npm run agents -- runbooks create custom-release --title "Custom release" --keywords release,deploy --steps "Check status|Deploy|Verify" --apply
```

Current behavior:

- Ships built-in runbooks for migrations, auth changes, releases, incidents, and visual updates.
- Loads custom JSON runbooks from `coordination/runbooks/`.
- Suggests runbooks from task summaries, claimed paths, explicit `--paths`, and explicit `--summary` text.
- Supports dry-run custom runbook creation by default, with writes only when `--apply` is passed.
- Validates custom runbook IDs, triggers, title, and steps.
- Is covered by read-only mutation guard tests.

Main files:

- `scripts/lib/runbook-commands.mjs`
- `tests/runbook-commands.test.mjs`

### Semantic path grouping

Status: implemented in the command layer.

```bash
npm run agents:path:groups -- --paths app/page.tsx,components/Button.tsx
npm run agents -- path-groups --json
```

Current behavior:

- Groups explicit `--paths` or board claimed paths.
- Finds package boundaries from nearest `package.json` files.
- Assigns product/data/verify/docs/other categories from path prefixes.
- Parses lightweight relative JS/TS import/export/require statements to report cross-group import edges.
- Emits group dependencies and dependents in JSON or text output.
- Is read-only and covered by mutation guard tests.

Main files:

- `scripts/lib/path-group-commands.mjs`
- `tests/path-group-commands.test.mjs`

### Task split validation

Status: implemented in the command layer.

```bash
npm run agents:split:validate
npm run agents -- split-validate --json
npm run agents -- split-validate --task task-id --strict
```

Current behavior:

- Validates planned and active-like tasks on the current board, or a supplied `--board <path>`.
- Reports overlapping ownership, missing dependencies, self-dependencies, and dependency cycles.
- Warns on missing claimed paths, missing verification, overly broad claimed paths, mixed shared-risk paths, and tasks spanning too many path groups or work categories.
- Supports `--task <id>` filtering, JSON output, and `--strict` non-zero exit behavior.
- Is read-only and covered by mutation guard tests.

Main files:

- `scripts/lib/task-split-validator.mjs`
- `tests/task-split-validator.test.mjs`

### Escalation routing

Status: implemented in the command layer.

```bash
npm run agents:escalation:route -- --task task-id
npm run agents -- escalation-route --paths app/page.tsx,api/routes/user.ts --reason "Need contract review"
npm run agents -- escalation-route --task task-id --json
```

Current behavior:

- Selects an explicit `--task`, the first blocked/waiting task, or explicit `--paths`.
- Suggests active task owners for overlapping paths.
- Suggests owners from previous done/released tasks that touched overlapping paths.
- Suggests CODEOWNERS for the target paths.
- Scores routes by source signal and explains each reason.
- Is read-only and covered by mutation guard tests.

Main files:

- `scripts/lib/escalation-routing-commands.mjs`
- `tests/escalation-routing.test.mjs`

### Work stealing

Status: implemented in the command layer.

```bash
npm run agents:work:steal -- agent-2
npm run agents -- steal-work --agent agent-2 --stale-hours 12 --json
npm run agents -- steal-work agent-2 --task task-id --apply --json
```

Current behavior:

- Suggests handoff, review, stale active/blocked/waiting, and unowned ready planned tasks for an agent.
- Requires dependencies to be satisfied unless `--force` is passed.
- Scores candidates by handoff/review state, staleness, suggested owner, readiness, priority, severity, and due date.
- Supports scope filtering with `--scope <path[,path...]>`.
- Applies one reassignment only with `--apply`, writes a pre-mutation snapshot, idles the previous owner when appropriate, and appends an audit entry.
- Is covered by read-only mutation guard tests.

Main files:

- `scripts/lib/work-stealing-commands.mjs`
- `tests/work-stealing.test.mjs`

### Agent reputation/history

Status: implemented in the command layer.

```bash
npm run agents:agent:history
npm run agents -- agent-history agent-1 --limit 5
npm run agents -- agent-history agent-1 agent-2 --stale-hours 12 --json
```

Current behavior:

- Summarizes per-agent task history from current ownership, last owners, notes, verification logs, docs review metadata, handoffs, and runtime audit entries.
- Computes a bounded 0-100 reputation score with `excellent`, `strong`, `steady`, `watch`, and `at-risk` levels.
- Rewards completed/released work, passing verification, docs reviews, handoffs, progress notes, and audit-trail participation.
- Penalizes failing verification plus stale, blocked, and waiting owned work.
- Supports filtering to one or more agents, limiting recent events, custom stale thresholds, and JSON output.
- Is read-only and covered by mutation guard tests.

Main files:

- `scripts/lib/agent-history-commands.mjs`
- `tests/agent-history-commands.test.mjs`

### Cost/time accounting

Status: implemented in the command layer.

```bash
npm run agents:cost:time
npm run agents -- cost-time --rate 150 --currency USD --json
npm run agents -- cost-time task-api --agent agent-1 --from 2026-01-01 --to 2026-01-31
```

Current behavior:

- Reports task-level estimated hours, observed activity spans, open age, contributors, primary agent, and optional cost.
- Rolls up per-agent estimated hours, observed hours, open age, active/completed counts, and task IDs.
- Reads explicit hour fields when present and otherwise maps task effort values (`small`, `medium`, `large`, `xl`, etc.) to conservative hour estimates.
- Infers observed spans from task timestamps, notes, verification log entries, docs review metadata, and handoffs.
- Supports filtering by task IDs, `--task`, `--agent`, `--from`, `--to`, hourly `--rate`, `--currency`, and JSON output.
- Is read-only and covered by mutation guard tests.

Main files:

- `scripts/lib/cost-time-commands.mjs`
- `tests/cost-time-commands.test.mjs`

### Review queue

Status: implemented in the command layer.

```bash
npm run agents:review:queue
npm run agents -- review-queue --all --json
npm run agents -- review-queue claim task-id --agent agent-2 --apply
npm run agents -- review-queue complete task-id --agent agent-2 --outcome approve --note "Looks good" --apply
```

Current behavior:

- Lists open review tasks with queued/claimed review status, reviewer metadata, age, urgency score, paths, priority, and severity.
- Supports `--all`, `--task`, `--agent`, and JSON output for queue inspection.
- `claim` records `reviewQueue.status = claimed`, reviewer, request/claim timestamps, and a task note.
- `complete` records `approved`, `changes-requested`, or `commented` outcomes, reviewer metadata, completion timestamp, task note, and review history.
- Claim and complete are dry-run by default; applied mutations write a pre-mutation workspace snapshot and audit log entry.
- Does not mark tasks done or released, so existing finish/release gates remain authoritative.

Main files:

- `scripts/lib/review-queue-commands.mjs`
- `tests/review-queue-commands.test.mjs`

### Secrets and sensitive-data guardrails

Status: implemented in the command layer.

```bash
npm run agents:secrets:scan
npm run agents -- secrets-scan --paths src,server --json
npm run agents -- secrets-scan --staged --strict
```

Current behavior:

- Scans tracked files by default, staged files with `--staged`, or selected files/directories with `--paths`.
- Detects private key blocks, OpenAI keys, GitHub tokens, AWS access keys, Slack tokens, and generic secret/password/token assignments.
- Skips common generated/runtime folders, large files, and binary extensions.
- Redacts previews in output and suppresses obvious placeholder/sample values.
- Supports JSON output and `--strict` non-zero exits for local or CI guardrail use.
- Is read-only and covered by mutation guard tests.

Main files:

- `scripts/lib/secrets-scan-commands.mjs`
- `tests/secrets-scan-commands.test.mjs`

### Contract files

Status: implemented in the command layer.

```bash
npm run agents:contracts -- list
npm run agents -- contracts create api-v1 --owner agent-1 --scope api --summary "API contract" --apply
npm run agents -- contracts check --json
```

Current behavior:

- Stores contract files as JSON under `coordination/contracts/`.
- Supports `contracts list`, `show`, `create`, and `check`.
- `create` is dry-run by default and writes only with `--apply`.
- Tracks owner, scopes, producer task, consumer tasks, summary, status, and timestamps.
- `check` validates contract shape and task references, and warns when active/planned data/API work is not covered by an active contract.
- Is covered by read-only mutation tests.

Main files:

- `scripts/lib/contract-commands.mjs`
- `tests/contract-commands.test.mjs`

### State compaction

Status: implemented in the command layer.

```bash
npm run agents:state:compact
npm run agents -- compact-state --keep-journal-lines 200 --keep-message-lines 500 --apply --json
```

Current behavior:

- Archives old `journal.md` and `messages.ndjson` lines to `coordination/archive/state-compaction-*.json`.
- Keeps configurable recent tails in the live journal and messages files.
- Is dry-run by default and writes only with `--apply`.
- Applied compaction writes a compressed workspace snapshot before rewriting state files.
- Supports JSON output and read-only mutation coverage.

Main files:

- `scripts/lib/state-compaction-commands.mjs`
- `tests/state-compaction-commands.test.mjs`

### Branch awareness and stale branch cleanup

Status: partially implemented in the command layer and claim path.

```bash
npm run agents:branches
npm run agents -- branches --json
npm run agents -- branches --stale-days 14 --base origin/main
```

Current behavior:

- Claims record the current Git branch and upstream when Git is available.
- `branches` reports local branches with merged, gone-upstream, protected, stale, and active-task markers.
- Cleanup is dry-run by default.
- `branches --apply` deletes only non-current, non-protected cleanup candidates that have no active task ownership and are stale plus merged or gone upstream.

Main files:

- `scripts/lib/branch-commands.mjs`
- `scripts/lib/task-claim-commands.mjs`
- `tests/git-policy.test.mjs`

### GitHub status and merge queue awareness

Status: partially implemented in the command layer.

```bash
npm run agents:github:status
npm run agents -- github-status --json
npm run agents -- github-status --live
```

Current behavior:

- Detects whether `remote.origin.url` points at GitHub.
- Reports owner/repo URL, current branch, upstream, ahead, and behind state.
- Scans `.github/workflows/*.yml` and `*.yaml` for `merge_group` triggers.
- Runs without contacting GitHub by default.
- `--live` uses `gh pr view` when available and reports PR metadata or warning details.

Main files:

- `scripts/lib/github-commands.mjs`
- `tests/github-status.test.mjs`

### Config doctor suggestions and aliases

Status: implemented in the command layer.

Current behavior:

- `doctor --json` includes `configSuggestions` with actionable improvement recommendations.
- Built-in short aliases route `s`, `d`, `p`, and `sum` to `status`, `doctor`, `plan`, and `summarize`.

### Per-repo onboarding checklist

Status: partially implemented in `doctor`.

Current behavior:

- `doctor --json` includes an `onboardingChecklist` payload.
- Text `doctor` prints an onboarding checklist section.
- The checklist recommends missing architecture, testing, deployment, app notes, and visual workflow docs.
- Visual workflow docs are required only when visual checks are configured.
- Missing onboarding docs are warnings/recommendations, not hard doctor failures.

Follow-up: expand the checklist by repo profile and allow custom checklist items in config.

Main files:

- `scripts/lib/onboarding-checklist.mjs`
- `scripts/lib/doctor-command.mjs`
- `tests/command-layer.test.mjs`

### Per-command help and global flags

Status: implemented through entrypoint preprocessing and command-layer help routing.

Current behavior:

- `ai-agents <command> --help` prints focused command help.
- `ai-agents help <command>` prints the same focused help.
- Built-in aliases resolve in help output, such as `help sum`.
- Entrypoints support `--config`, `--root`, `--coordination-dir`, `--coordination-root`, `--verbose`, `--quiet`, and `--no-color` before command dispatch.

Main files:

- `scripts/lib/global-flags.mjs`
- `scripts/lib/help-command.mjs`
- `bin/ai-agents.mjs`
- `scripts/agent-coordination.mjs`
- `scripts/agent-coordination-two.mjs`

### Config migration and policy packs

Status: implemented in the command layer.

```bash
npm run agents -- migrate-config
npm run agents -- migrate-config --apply
npm run agents -- policy-packs list
npm run agents -- policy-packs apply strict-ui --apply
```

Current behavior:

- `migrate-config` is dry-run by default and adds current optional defaults such as `configVersion`, `artifacts`, and `checks`.
- Applied config migrations snapshot the previous config under `runtime/snapshots/`.
- `policy-packs` lists and inspects reusable packs.
- `policy-packs apply` is dry-run by default and can apply `docs-light`, `strict-ui`, `backend-safe`, or `release-heavy`.

### Config and task templates

Status: partially implemented in the command layer.

```bash
npm run agents:templates -- list
npm run agents -- templates show react
npm run agents -- templates apply react --apply
npm run agents -- templates create-task ui-change --id task-ui --apply
```

Current behavior:

- Built-in config templates: `generic-node`, `react`, `expo`, `supabase`, and `docs-only`.
- Built-in task templates: `ui-change`, `migration`, `api-endpoint`, `test-only`, `docs-only`, and `refactor`.
- Config template application is dry-run by default and snapshots config before applied writes.
- Task creation is dry-run by default and snapshots the board before applied writes.

Main files:

- `scripts/lib/template-commands.mjs`
- `tests/template-commands.test.mjs`

### Archive completed work

Status: implemented in the command layer.

```bash
npm run agents:archive:completed
npm run agents -- archive-completed --older-than-days 30 --apply
```

Current behavior:

- Dry-run by default.
- Selects old `done` and `released` tasks using `updatedAt` or `createdAt`.
- Snapshots the board before applied writes.
- Appends archived tasks into `coordination/archive/tasks-YYYY-MM.json`.
- Removes archived task docs from `coordination/tasks/`.

Main files:

- `scripts/lib/archive-commands.mjs`
- `tests/archive-commands.test.mjs`

### Artifact retention

Status: partially implemented in the command layer.

```bash
npm run agents -- artifacts prune
npm run agents -- artifacts prune --apply --json
```

Current behavior:

- Dry-run by default.
- Honors `artifacts.roots`, `keepDays`, `keepFailedDays`, `maxMb`, and `protectPatterns`.
- Keeps artifacts referenced by active work.
- Deletes only with `--apply`.

### Planner lane sizing helper

Status: implemented as a reusable helper and regression-test target.

```js
import { classifyPlannerLanes } from './scripts/planner-sizing.mjs';
```

The helper classifies likely product, data, verify, and docs lanes from `planning.agentSizing` keywords and returns:

- keyword scores by lane
- overall complexity score
- recommended agent count
- selected lanes

Main files:

- `scripts/planner-sizing.mjs`
- `tests/planner-sizing.test.mjs`

Follow-up: connect this helper directly into the core planner once the planner refactor is safe.

### Focused tests

Status: expanded.

Current coverage:

- Config validation accepts valid config.
- Config validation reports duplicate agent IDs, invalid sizing, empty rule keywords, and Git policy type errors.
- Bootstrap dry-run does not mutate the target.
- Bootstrap writes package scripts, `.gitignore`, copied files, and starter docs.
- `doctor --fix` creates starter runtime files.
- `doctor --json` emits machine-readable health data.
- `summarize --for-chat` prints compact board state, stale work, and next actions.
- `summarize --json` emits counts and recent context.
- `validate --json` emits machine-readable config validation.
- Read-only command-layer and core read-only commands do not mutate board, journal, messages, or watcher status files.
- Git policy blocks disallowed main-branch claims and non-matching branch patterns.
- Git policy allows matching branch patterns.
- Runtime lock diagnostics report missing locks, stale locks, stale lock clearing, and refusal to clear fresh locks.
- Main CLI routes `lock-status` and `lock-clear` correctly.
- `finish` safety gates block before mutating board state.
- Planner lane sizing covers simple, complex, capped, and fallback cases.
- Verification artifacts, artifact listing/inspection, dependency graph output, ownership-map overlap detection, PR summaries, and release bundles have regression coverage.
- Config migration, policy pack dry-run/apply behavior, artifact retention dry-runs, and artifact pruning apply behavior have regression coverage.
- Static fixture repo coverage exists under `tests/fixtures/basic-repo`.
- Command snapshot coverage exists for representative ownership review and test-impact JSON output.
- Concurrency stress coverage runs parallel progress/verify writes on one task and parallel claim/verify/done flows across multiple agents.

Main files:

- `tests/archive-commands.test.mjs`
- `tests/backlog-import-commands.test.mjs`
- `tests/config-validation.test.mjs`
- `tests/bootstrap.test.mjs`
- `tests/check-syntax.test.mjs`
- `tests/command-layer.test.mjs`
- `tests/command-snapshots.test.mjs`
- `tests/concurrency-stress.test.mjs`
- `tests/core-mutation-safety.test.mjs`
- `tests/error-formatting.test.mjs`
- `tests/github-status.test.mjs`
- `tests/read-only-commands.test.mjs`
- `tests/git-policy.test.mjs`
- `tests/lock-runtime.test.mjs`
- `tests/planner-sizing.test.mjs`
- `tests/resource-leases.test.mjs`
- `tests/roadmap-commands.test.mjs`
- `tests/template-commands.test.mjs`
- `tests/update-commands.test.mjs`
- `tests/workspace-snapshot-commands.test.mjs`

Follow-up tests still needed:

- Direct core planner integration tests once planner internals are refactored around `scripts/planner-sizing.mjs`.
- Broader read-only mutation coverage for every core read-only edge case.

### Cross-platform watcher

Status: implemented as a Node watcher loop and now used by `watch-start` through the command layer. PowerShell scripts remain as compatibility fallbacks.

```bash
npm run agents:watch:start
npm run agents -- watch-start --interval 30000
npm run agents:watch:node
npm run agents2:watch:node
node ./scripts/agent-watch-loop.mjs --coordinator-script ./scripts/agent-coordination.mjs --once
```

Main files:

- `scripts/agent-watch-loop.mjs`
- `scripts/agent-command-layer.mjs`

Follow-up: eventually remove the core PowerShell-oriented watcher start path or convert it internally to the Node watcher.

### Package install flow

Status: partially implemented.

Already present:

- `package.json` package name is `ai-agents`.
- `bin.ai-agents` points to `./bin/ai-agents.mjs`.
- `npm run ai-agents -- <command>` works as the local public entrypoint.

Follow-up:

- Test `npx github:Jlipschitz/ai_agents doctor` in a fresh target repo.
- Decide whether/when this should become a published npm package.

### Public CLI version output

Status: partially implemented.

```bash
ai-agents --version
ai-agents version
```

Current behavior:

- Prints the package name and package version.
- Prints the active Node runtime version.
- Runs from the dedicated public CLI entrypoint.

Follow-up: expand output with config version, config path, coordination root, and board schema version.

Main files:

- `bin/ai-agents.mjs`

### CI workflow

Status: implemented.

Main file:

- `.github/workflows/ci.yml`

The workflow runs on Node 24 and uses:

- `actions/setup-node@v4`
- npm cache keyed by `package-lock.json`
- `npm ci`
- `npm run check`
- `npm run validate:agents-config`
- `npm test`

### Developer experience baseline

Status: partially implemented.

Current behavior:

- `npm run check` runs the local syntax checker.
- `npm run lint` exists as an alias for the syntax checker.
- `npm run format:check` checks JSON/text formatting without writing.
- `npm run format` applies the formatter.
- `npm run agents -- format --paths <path[,path...]>` supports targeted dry-run/apply formatting.
- `CONTRIBUTING.md` documents local setup, development flow, command expectations, and PR checks.
- `SECURITY.md` documents supported versions, private vulnerability reporting, local guardrails, and disclosure expectations.
- Node version hints are checked into `.nvmrc` and `.node-version`.
- The package lock marks the package as `UNLICENSED`.

Follow-up: add a real lint/style tool, type or JSDoc validation, license file, and examples directory.

Main files:

- `package.json`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `scripts/check-syntax.mjs`
- `scripts/lib/format-commands.mjs`
- `tests/check-syntax.test.mjs`
- `tests/format-commands.test.mjs`

## Not Yet Implemented

These roadmap items still need core, command-layer, or documentation work.

### Core integration and command depth

- Core-native `doctor --fix` and `doctor --json` integration instead of command-layer wrappers.
- Direct planner integration for `scripts/planner-sizing.mjs`.
- More configurable lifecycle and approval gates beyond the current `finish` verification/docs flags.
- Richer `summarize` context from dependency, ownership, journal, and message history.
- Core-native lock diagnostics instead of the standalone utility wrapper.
- Automatic workspace snapshots for remaining legacy lifecycle mutations.
- Rollback semantics for external side effects such as Git branch deletion.

### Planning, prompting, and release support

- Visual-specific check runner behavior, including before/after artifact-root diffs and richer artifact classification.
- Full artifact index rebuild and stricter artifact-root policies for manual `verify --artifact` attachments.
- Dedicated `timeline` or session-replay command.
- Multi-repo dashboard.

### Verification, risk, and GitHub integration

- Live merge-queue or in-flight PR overlap awareness beyond local workflow-trigger detection.
- GitHub write/API integration for issues, PR comments, labels, and checklists.
- TUI dashboard.
- Universal JSON output for every command.

### Safety, auditing, and recovery

- Open-ended model-backed natural-language query mode.
- Local web dashboard.
- Signed releases.
- Self-update safety with diff review.

### Advanced coordination and scaling

- Partial checkout and monorepo support.
- Escalation metadata beyond task priority, due date, and severity.
- External calendar or reminder hooks.
- Offline mode.
- Data privacy modes.

### Developer experience and repo maintenance

- Dedicated linting beyond syntax checks.
- Type checking or JSDoc validation.
- `LICENSE`.
- Example repos under `examples/`.
