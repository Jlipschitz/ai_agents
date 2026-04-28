# State Files

`ai_agents` stores coordination data in a repo-local runtime workspace. By default, the workspace is one of:

```text
coordination/
coordination-two/
```

These folders are runtime state and should normally be ignored by Git.

## Workspace Selection

| Entry point | Default workspace |
| --- | --- |
| `npm run agents` | `coordination/` |
| `npm run agents2` | `coordination-two/` |
| `npm run ai-agents` | `coordination/` |
| `ai-agents` | `coordination/` |

Environment overrides:

| Variable | Purpose |
| --- | --- |
| `AGENT_COORDINATION_ROOT` | Absolute or relative path to the full coordination workspace. Takes priority over `AGENT_COORDINATION_DIR`. |
| `AGENT_COORDINATION_DIR` | Repo-local coordination directory name. |
| `AGENT_COORDINATION_CONFIG` | Path to a non-default config file. |
| `AGENT_COORDINATION_CLI_ENTRYPOINT` | Changes the command label shown in help/examples. |
| `AGENT_COORDINATION_LOCK_WAIT_MS` | Adjusts lock wait behavior in the core coordinator. |
| `AGENT_TERMINAL_ID` | Identifies a terminal/session when multiple shells use the same agent ID. |

## Standard Workspace Layout

```text
coordination/
  board.json
  journal.md
  messages.ndjson
  tasks/
  runtime/
    state.lock.json
    watcher.status.json
    agent-heartbeats/
    snapshots/
```

## `board.json`

The active coordination board and current source of truth for task state.

Top-level fields commonly include:

- `version`
- `projectName`
- `tasks`
- `resources`
- `incidents`
- `updatedAt`

Task fields commonly include:

- `id`
- `title`
- `status`
- `ownerId`
- `suggestedOwnerId`
- `claimedPaths`
- `dependencies`
- `waitingOn`
- `verification`
- `verificationLog`
- `notes`
- `relevantDocs`
- `docsReviewedAt`
- `docsReviewedBy`
- `createdAt`
- `updatedAt`

Typical statuses:

```text
planned
active
blocked
waiting
review
handoff
done
released
```

Guidance:

- Treat `board.json` as machine-managed state.
- Avoid manual edits unless recovering from corruption.
- Back up the coordination folder before repairing manually.
- Use `validate`, `doctor`, and future repair tools before editing directly.

## `journal.md`

A human-readable event log.

Used for:

- task transitions
- handoff notes
- verification notes
- recovery context
- understanding what happened during a coordination session

Guidance:

- Append-only in normal operation.
- Useful for humans, but not canonical current task state.
- Current state lives in `board.json`.

## `messages.ndjson`

A newline-delimited JSON message log. Each line should be one complete JSON object.

Used for lightweight agent-to-agent communication.

Common fields may include:

- `from`
- `to`
- `body`
- `message`
- `text`
- `taskId`
- `at`

Why NDJSON:

- easy appends
- easy streaming
- friendly to CLI tools
- easier recovery if the final line is incomplete

Enhanced `summarize` reads recent messages and includes them in handoff output.

## `tasks/`

Task-specific workspace folder.

Intended uses:

- task notes
- generated task docs
- handoff files
- future task templates
- future per-task evidence indexes

This folder is runtime state unless a repo intentionally chooses to commit selected task documentation.

## `runtime/`

Runtime-only files used by active coordination sessions. Do not commit this folder.

### `runtime/state.lock.json`

State mutation lock.

Purpose:

- protect `board.json`
- protect `journal.md`
- protect `messages.ndjson`
- prevent concurrent mutation corruption

Inspect safely:

```bash
npm run agents -- lock-status
npm run agents -- lock-status --json
```

Clear stale locks safely:

```bash
npm run agents -- lock-clear --stale-only
npm run agents -- lock-clear --stale-only --json
```

Standalone utility:

```bash
node ./scripts/lock-runtime.mjs status --coordination-dir coordination
node ./scripts/lock-runtime.mjs clear --stale-only --coordination-dir coordination
```

Stale lock detection currently checks:

- malformed JSON
- age threshold
- dead PID

### `runtime/watcher.status.json`

Watcher status file.

Used to understand:

- watcher PID
- last tick/update
- active coordination root
- watcher state

Commands:

```bash
npm run agents:watch:status
npm run agents -- watch-status
```

Commands:

```bash
npm run agents -- watch-diagnose
npm run agents -- cleanup-runtime
npm run agents -- cleanup-runtime --apply
```

### `runtime/agent-heartbeats/`

Folder containing heartbeat files for active agents/sessions.

Used to diagnose:

- active agents
- stale agents
- inactive sessions
- multi-terminal confusion

Commands:

```bash
npm run agents:heartbeat:status
npm run agents:heartbeat:start -- agent-1
npm run agents:heartbeat:stop -- agent-1
```

## Artifact State

`run-check` writes command output artifacts by default under:

```text
artifacts/checks/
artifacts/checks/index.ndjson
```

Potential artifact roots:

```text
artifacts/
playwright-report/
test-results/
```

Current captured data includes:

- check name
- executed command
- start and finish time
- exit code
- stdout/stderr log path

Future artifact support can add screenshots, reports, traces, retention policies, and verification-log references.

## Archive State

Archiving completed tasks is planned but not implemented yet.

Potential future files:

```text
archive/tasks-YYYY-MM.json
archive/journal-YYYY-MM.md
```

Purpose:

- keep `board.json` small
- preserve historical context
- improve status and summarize performance

## Git Ignore Guidance

Target repos should normally ignore:

```gitignore
coordination/
coordination-two/
artifacts/
playwright-report/
test-results/
```

The bootstrap command adds coordination runtime folders to `.gitignore`.

## Backup and Recovery Guidance

Before manual recovery:

1. Stop watchers and heartbeats.
2. Copy the entire coordination folder somewhere safe.
3. Run validation and doctor checks.
4. Inspect `board.json`, `journal.md`, and `messages.ndjson`.
5. Use `lock-status` before clearing locks.
6. Prefer future `repair-board`, `inspect-board`, or `rollback-state` commands when available.

Useful commands:

```bash
npm run agents:doctor
npm run agents:validate
npm run agents:status
npm run agents -- lock-status
```

## What Is Safe To Delete

Usually safe when stale and verified:

- old `runtime/state.lock.json`
- stale heartbeat files
- stale watcher status files
- temporary artifact folders that are not referenced by verification logs

Not safe without backup:

- `board.json`
- `journal.md`
- `messages.ndjson`
- active task files under `tasks/`
