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
- Installs the command layer, lock diagnostics, and the new command shortcuts into target repos.

Main files:

- `scripts/bootstrap.mjs`
- `tests/bootstrap.test.mjs`

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

### Board summarize

Status: implemented in the command layer.

```bash
npm run agents:summarize
npm run agents -- summarize
npm run agents -- summarize --for-chat
npm run agents -- summarize --json
```

The summary includes counts, active work, blockers, review queue, and next planned work.

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

### Runtime lock diagnostics

Status: implemented as a standalone utility and npm scripts.

```bash
npm run agents:lock:status
npm run agents:lock:clear
npm run agents2:lock:status
npm run agents2:lock:clear
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

### Focused tests

Status: expanded.

Current coverage:

- Config validation accepts valid config.
- Config validation reports duplicate agent IDs, invalid sizing, empty rule keywords, and Git policy type errors.
- Bootstrap dry-run does not mutate the target.
- Bootstrap writes package scripts, `.gitignore`, copied files, and starter docs.
- `doctor --fix` creates starter runtime files.
- `doctor --json` emits machine-readable health data.
- `summarize --for-chat` prints compact board state.
- `validate --json` emits machine-readable config validation.
- Read-only command-layer commands do not mutate board, journal, or messages files.
- Git policy blocks disallowed main-branch claims and non-matching branch patterns.
- Git policy allows matching branch patterns.
- Runtime lock diagnostics report missing locks, stale locks, stale lock clearing, and refusal to clear fresh locks.

Main files:

- `tests/config-validation.test.mjs`
- `tests/bootstrap.test.mjs`
- `tests/command-layer.test.mjs`
- `tests/read-only-commands.test.mjs`
- `tests/git-policy.test.mjs`
- `tests/lock-runtime.test.mjs`

Follow-up tests still needed:

- Planner lane sizing.
- Broader read-only mutation coverage for core read-only commands.

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
- More complete lifecycle helpers with verification/doc-review gates.
- Broader read-only mutation tests for every core read-only command.
- `summarize` output that includes journal/message-derived stale-work context.
- Core-native lock diagnostics instead of the standalone utility wrapper.
