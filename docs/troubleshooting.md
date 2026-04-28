# Troubleshooting

Use this guide when `ai_agents` setup, Git state, watcher state, or coordination state does not look right.

## Start Here

Run:

```bash
npm run agents:doctor
npm run agents:validate
npm run agents:status
```

Or with the public CLI entrypoint:

```bash
npm run ai-agents -- doctor
npm run ai-agents -- validate
npm run ai-agents -- status
```

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
git config --global --add safe.directory "C:/Users/Shadow/Documents/code/todo_app/.codex-tmp/ai_agents_export"
```

## Missing Config

Expected file:

```text
agent-coordination.config.json
```

Fix:

1. Copy the config from this repo.
2. Update the project-specific paths and docs settings.
3. Run `doctor`.

```bash
npm run agents:doctor
```

## Invalid Config JSON

Symptoms:

- Coordinator fails before command output.
- Error mentions JSON parsing.

Fix:

1. Validate the JSON in an editor.
2. Remove trailing commas.
3. Make sure all strings use double quotes.
4. Run `doctor` again.

A formal JSON schema is planned.

## Wrong Coordination Folder

Symptoms:

- `status` shows no tasks even though you expected tasks.
- `agents` and `agents2` show different boards.

Cause:

- `agents` uses `coordination/`.
- `agents2` uses `coordination-two/`.
- `AGENT_COORDINATION_ROOT` or `AGENT_COORDINATION_DIR` may point somewhere else.

Check active environment variables:

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

Check watcher status:

```bash
npm run agents:watch:status
npm run agents:doctor
```

Current note: the watcher helper is PowerShell-based. If you are on macOS/Linux, use manual commands until the planned Node watcher is implemented.

## Watcher Looks Stale

Symptoms:

- Watcher status exists but does not update.
- Watcher PID no longer exists.
- `doctor` reports stale runtime state.

Fix:

1. Stop the watcher if possible.
2. Back up the coordination folder.
3. Remove stale watcher status only if you are sure the watcher is not running.
4. Restart the watcher.

```bash
npm run agents:watch:stop
npm run agents:watch:start
```

Future commands planned:

```bash
ai-agents watch-diagnose
ai-agents cleanup-runtime
```

## Heartbeat Not Updating

Check heartbeat status:

```bash
npm run agents:heartbeat:status
```

Restart heartbeat:

```bash
npm run agents:heartbeat:stop
npm run agents:heartbeat:start
```

Future heartbeat improvements will track machine name, repo path, and process/session IDs.

## Stale Lock

Symptoms:

- Commands wait for a long time.
- Commands report lock contention.
- `runtime/state.lock.json` exists after a crash.

Recommended approach:

1. Make sure no coordinator command is still running.
2. Back up the coordination folder.
3. Run `doctor`.
4. Only remove a lock manually if you are sure it is stale.

Future commands planned:

```bash
ai-agents lock-status
ai-agents lock-clear --stale-only
```

## Broken `board.json`

Symptoms:

- `status` or `validate` fails.
- JSON parse errors.
- Missing task fields.

Fix:

1. Back up the coordination folder.
2. Validate JSON formatting.
3. Check recent changes in `journal.md`.
4. Repair manually if needed.

Future commands planned:

```bash
ai-agents inspect-board
ai-agents repair-board
ai-agents rollback-state
```

## Agent Claimed Too Much Scope

Symptoms:

- Claimed paths are too broad, such as `src/`, `components/`, or `lib/`.
- Other agents are blocked by broad ownership.

Fix:

- Narrow claimed paths to the smallest practical files/folders.
- Split broad tasks into smaller tasks.
- Add shared-risk paths to config.

Future roadmap items include ownership reviews and task split validation.

## Dirty Git State

Before planning or claiming work, check:

```bash
git status
git branch --show-current
git status --short
git status --branch --short
```

Recommended practice:

- Commit or stash unrelated changes.
- Pull latest changes.
- Avoid claiming work from a stale branch.
- Avoid broad path claims when there are uncommitted changes.

## Runtime Files Accidentally Committed

If `coordination/` or `coordination-two/` files are staged, unstage them:

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

## Need To Move Work To Another Machine

For active coordination state:

1. Stop watchers and heartbeats.
2. Copy the coordination folder.
3. Copy or recreate the same config.
4. Run `doctor` on the new machine.
5. Restart heartbeats/watchers.

Alternatively, set `AGENT_COORDINATION_ROOT` to a synced location before starting work.
