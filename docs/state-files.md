# State Files

`ai_agents` stores coordination data in a repo-local workspace. By default, the workspace is one of:

```text
coordination/
coordination-two/
```

These folders contain runtime state and should normally be ignored by Git.

## Workspace Selection

The active workspace is selected by wrapper or environment variable.

| Method | Default workspace |
| --- | --- |
| `npm run agents` | `coordination/` |
| `npm run agents2` | `coordination-two/` |
| `npm run ai-agents` | `coordination/` |

Environment overrides:

| Variable | Purpose |
| --- | --- |
| `AGENT_COORDINATION_ROOT` | Absolute or relative path to the full coordination workspace. |
| `AGENT_COORDINATION_DIR` | Repo-local coordination directory name. |

If `AGENT_COORDINATION_ROOT` is set, it takes priority over `AGENT_COORDINATION_DIR`.

## `board.json`

The main coordination board.

Tracks:

- Tasks
- Owners
- Statuses
- Dependencies
- Claimed paths
- Verification requirements
- Verification logs
- Notes
- Waiting/blocker information

Typical task statuses:

- `planned`
- `active`
- `blocked`
- `waiting`
- `review`
- `handoff`
- `done`
- `released`

Roadmap improvements:

- Formal board schema
- Board migration support
- Board repair command
- Board inspection command
- State transactions
- Rollback support

## `journal.md`

Human-readable event log.

Use this to understand what happened during a coordination session.

Roadmap improvements:

- State compaction
- Session replay
- Release artifact bundles
- Human-readable changelog generation

## `messages.ndjson`

Structured message log using newline-delimited JSON.

Each line should be one complete JSON object.

Why NDJSON:

- Easy append behavior
- Easy streaming behavior
- Recoverable if the last line is incomplete
- Friendly to CLI tools

Roadmap improvements:

- Message compaction
- Natural-language query
- Dashboard views

## `tasks/`

Task-specific workspace folder.

Intended for task docs, handoff notes, or generated task files.

Roadmap improvements:

- Task templates
- Task archive files
- Per-task checklists
- Evidence attachments

## `runtime/`

Runtime-only files used by active coordination sessions.

This folder should not be committed.

### `runtime/state.lock.json`

Lock file used to protect state mutations.

Roadmap improvements:

- Lock diagnostics
- Stale-only lock clearing
- Transaction log before mutation
- Concurrency stress tests

### `runtime/watcher.status.json`

Watcher status file.

Tracks the current or most recent watcher loop state.

Roadmap improvements:

- Node-based watcher
- `watch-diagnose`
- Runtime cleanup
- Watcher failure recovery

### `runtime/agent-heartbeats/`

Stores heartbeat files for active agents/sessions.

Roadmap improvements:

- Machine name tracking
- Repo path tracking
- Process/session tracking
- Agent SLA warnings
- Cleanup of stale heartbeat files

## Artifact State

Planned artifact state may live under:

```text
runtime/artifacts.json
artifacts/index.json
```

Planned artifact roots may include:

```text
artifacts/
playwright-report/
test-results/
```

Artifact tracking should support:

- Check results
- Screenshots
- Logs
- Reports
- Trace files
- Retention policies
- Pruning with dry-run/apply behavior

## Git Ignore Guidance

A target repo should normally ignore:

```gitignore
coordination/
coordination-two/
artifacts/
playwright-report/
test-results/
```

Some repos may choose to commit selected coordination docs, templates, or release bundles, but active runtime files should stay local unless intentionally shared.

## Recovery Guidance

If state becomes corrupted:

1. Stop watchers and heartbeats.
2. Back up the coordination folder.
3. Run `doctor` and `validate`.
4. Inspect `board.json`, `journal.md`, and `messages.ndjson`.
5. Use future `repair-board`, `inspect-board`, or `rollback-state` commands when available.
