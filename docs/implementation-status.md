# Implementation Status

This document tracks roadmap items that now have concrete implementation support in the repo.

## Implemented or Partially Implemented

### Installer / bootstrap command

Status: implemented as a standalone script.

```bash
npm run bootstrap -- --target C:\path\to\repo
npm run bootstrap -- --target ../target-repo --dry-run
```

Implemented behavior:

- Copies coordinator scripts and docs into a target repo.
- Adds standard `package.json` scripts.
- Adds coordination runtime folders to `.gitignore`.
- Creates starter app notes when missing.
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

### Runtime and CI baseline

Status: implemented.

The repo now targets Node 24 consistently:

- `package.json` uses `engines.node: >=24`.
- `.nvmrc` is set to `24`.
- `.node-version` is set to `24`.
- CI uses `actions/setup-node@v4` with `node-version: 24`.
- CI installs with `npm ci`.
- CI enables npm cache keyed by `package-lock.json`.

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

Follow-up: migrate any remaining core-only validation paths to reuse the standalone validator directly.

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

### Board inspection, repair, and rollback

Status: implemented in the command layer.

```bash
npm run agents -- inspect-board
npm run agents -- repair-board
npm run agents -- repair-board --apply
npm run agents -- rollback-state --list
npm run agents -- rollback-state --to latest --apply
```

Current behavior:

- `inspect-board` reports structural findings and task counts without mutating state.
- `repair-board` is dry-run by default and applies only safe normalization with `--apply`.
- Applied repairs snapshot the previous board under `runtime/snapshots/`.
- `rollback-state` lists snapshots and restores one only with `--apply`.

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

Main files:

- `tests/config-validation.test.mjs`
- `tests/bootstrap.test.mjs`
- `tests/command-layer.test.mjs`
- `tests/read-only-commands.test.mjs`
- `tests/git-policy.test.mjs`
- `tests/lock-runtime.test.mjs`
- `tests/planner-sizing.test.mjs`
- `tests/roadmap-commands.test.mjs`
- `tests/command-snapshots.test.mjs`

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

## Not Yet Implemented

These roadmap items still need core or deeper implementation work:

- `doctor --fix` integration inside the core implementation rather than the command layer.
- `doctor --json` integration inside the core implementation rather than the command layer.
- Deeper integration of planner sizing helper into the core planner.
- More complete lifecycle helpers with configurable verification/doc-review gates.
- `summarize` output that includes richer dependency and owner context from journal/message-derived history.
- Core-native lock diagnostics instead of the standalone utility wrapper.
