# Troubleshooting

Use this guide when `ai_agents` setup, Git state, watcher state, or coordination state does not look right.

## Start Here

Run:

```bash
npm run agents:doctor
npm run agents:validate
npm run agents:status
npm run agents:summarize
```

Machine-readable checks:

```bash
npm run agents -- doctor --json
npm run agents -- validate --json
npm run agents -- summarize --json
```

## Run Safe Fixes

For missing starter files, ignored runtime folders, package scripts, starter docs, or runtime folders:

```bash
npm run agents -- doctor --fix
```

This is intentionally conservative. It should not overwrite project-specific config or runtime state that already exists.

## Git Dubious Ownership

Error:

```text
fatal: detected dubious ownership in repository
```

Cause: Git sees that the repo folder is owned by a different OS user than the current terminal user.

Fix:

```bash
git config --global --add safe.directory <repo-path>
```

Windows example:

```powershell
git config --global --add safe.directory "C:/path/to/repo"
```

## Missing Config

Expected file:

```text
agent-coordination.config.json
```

Fix options:

```bash
npm run agents -- doctor --fix
```

Or copy the config from this repo, update project-specific paths, then run:

```bash
npm run validate:agents-config
npm run agents:doctor
```

## Invalid Config JSON

Symptoms:

- coordinator fails before command output
- error mentions JSON parsing
- config validation fails

Fix:

1. Remove trailing commas.
2. Make sure all strings use double quotes.
3. Validate with:

```bash
npm run validate:agents-config
node ./scripts/validate-config.mjs --config ./agent-coordination.config.json --json
```

## Wrong Coordination Folder

Symptoms:

- `status` shows no tasks even though tasks exist.
- `agents` and `agents2` show different boards.
- `summarize` does not show the expected active work.

Default folders:

- `npm run agents` uses `coordination/`.
- `npm run agents2` uses `coordination-two/`.
- `npm run ai-agents` uses `coordination/`.

Check overrides:

```bash
echo $AGENT_COORDINATION_ROOT
echo $AGENT_COORDINATION_DIR
```

PowerShell:

```powershell
echo $env:AGENT_COORDINATION_ROOT
echo $env:AGENT_COORDINATION_DIR
```

## Watcher Does Not Start

Check watcher status and doctor output:

```bash
npm run agents:watch:status
npm run agents:doctor
```

Start watcher:

```bash
npm run agents:watch:start
npm run agents -- watch-start --interval 30000
```

The default watcher is the Node watcher:

```text
scripts/agent-watch-loop.mjs
```

PowerShell watcher scripts remain only as legacy fallback.

## Watcher Looks Stale

Symptoms:

- watcher status exists but does not update
- watcher PID no longer exists
- `watch-status` reports stale runtime state

Fix:

```bash
npm run agents:watch:stop
npm run agents:watch:start
npm run agents:watch:status
```

If runtime state still looks stuck, inspect locks:

```bash
npm run agents -- lock-status
npm run agents -- lock-status --json
```

Runtime diagnostics and cleanup:

```bash
npm run agents -- watch-diagnose
npm run agents -- cleanup-runtime
npm run agents -- cleanup-runtime --apply
```

## Heartbeat Not Updating

Check heartbeat status:

```bash
npm run agents:heartbeat:status
```

Restart heartbeat:

```bash
npm run agents:heartbeat:stop -- agent-1
npm run agents:heartbeat:start -- agent-1
```

If multiple terminals use the same agent ID, set:

```bash
AGENT_TERMINAL_ID=<unique-session-name>
```

PowerShell:

```powershell
$env:AGENT_TERMINAL_ID = "session-1"
```

## Stale Lock

Symptoms:

- commands wait for a long time
- commands report lock contention
- `runtime/state.lock.json` exists after a crash

Inspect first:

```bash
npm run agents -- lock-status
npm run agents -- lock-status --json
```

Clear only stale locks:

```bash
npm run agents -- lock-clear --stale-only
npm run agents -- lock-clear --stale-only --json
```

Use `--force` only when a human has confirmed no command is running:

```bash
npm run agents -- lock-clear --force
```

Recommended safety flow:

1. Make sure no coordinator command is still running.
2. Back up the coordination folder.
3. Run `lock-status`.
4. Use `lock-clear --stale-only`.
5. Run `doctor` and `status` again.

## Broken `board.json`

Symptoms:

- `status` or `validate` fails
- JSON parse errors
- missing task fields
- impossible statuses

Fix:

1. Back up the coordination folder.
2. Validate JSON formatting.
3. Check recent changes in `journal.md`.
4. Repair manually only if necessary.
5. Run:

```bash
npm run agents:validate
npm run agents:doctor
```

Board inspection and repair commands:

```bash
npm run agents -- inspect-board
npm run agents -- repair-board
npm run agents -- repair-board --apply
npm run agents -- rollback-state --list
npm run agents -- rollback-state --to latest --apply
```

## Agent Claimed Too Much Scope

Symptoms:

- claimed paths are too broad, such as `src/`, `components/`, or `lib/`
- other agents are blocked by broad ownership
- conflict warnings appear often

Fix:

- narrow claimed paths to the smallest practical files/folders
- split broad tasks into smaller tasks
- add shared-risk paths to config
- hand off or release paths that are no longer needed

Future roadmap items include ownership reviews and task split validation.

## Claim Blocked By Git Policy

Symptoms:

- `claim` exits before claiming the task
- stderr mentions `git.allowMainBranchClaims`, `git.allowDetachedHead`, or `git.allowedBranchPatterns`

Check the current branch:

```bash
git branch --show-current
git status --branch --short
```

Review config:

```json
{
  "git": {
    "allowMainBranchClaims": false,
    "allowDetachedHead": false,
    "allowedBranchPatterns": ["agent/*", "feature/*", "fix/*"]
  }
}
```

Fix options:

- create a branch that matches the policy
- update the policy intentionally
- avoid claiming from detached HEAD
- avoid claiming from `main` or `master` when disabled

## Dirty Git State

Before planning or claiming work, check:

```bash
git status
git branch --show-current
git status --short
git status --branch --short
```

Recommended practice:

- commit or stash unrelated changes
- pull latest changes
- avoid claiming work from stale branches
- avoid broad path claims when there are uncommitted changes

## Finish Blocked By Safety Gate

Symptoms:

- `finish --require-verification` fails
- `finish --require-doc-review` fails
- task is not marked done

Reason:

- `--require-verification` requires every check in the task `verification` array to have a latest passing entry in `verificationLog`.
- `--require-doc-review` requires `docsReviewedAt` on the task.

Fix:

```bash
npm run agents -- verify agent-1 task-id unit pass "npm test passed"
npm run agents -- finish agent-1 task-id --require-verification "Finished and verified."
```

For docs review, make sure the task records docs review before using the gate.

## Runtime Files Accidentally Committed

If runtime files are staged, unstage them:

```bash
git restore --staged coordination coordination-two
```

Add ignore entries:

```gitignore
coordination/
coordination-two/
artifacts/
playwright-report/
test-results/
```

`doctor --fix` and `bootstrap` can add coordination ignores automatically.

## CI Fails After Adding Tests

Run locally with the same basics used by CI:

```bash
npm ci
npm run check
npm run validate:agents-config
npm test
```

CI uses Node 24. Check your local version:

```bash
node --version
```

Use the repo hints:

```text
.nvmrc
.node-version
```

## Need To Move Work To Another Machine

For active coordination state:

1. Stop watchers and heartbeats.
2. Copy the coordination folder.
3. Copy or recreate the same config.
4. Run `doctor` on the new machine.
5. Restart heartbeats/watchers.

Alternatively, set `AGENT_COORDINATION_ROOT` to a synced location before starting work.

## Useful Recovery Commands

```bash
npm run agents:doctor
npm run agents:validate
npm run agents:status
npm run agents:summarize
npm run agents -- lock-status
npm run agents -- lock-clear --stale-only
npm run agents:watch:status
npm run agents:heartbeat:status
```
