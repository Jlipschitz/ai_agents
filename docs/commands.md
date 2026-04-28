# Command Reference

This document describes the current `ai_agents` commands and the intended public CLI equivalents.

## Running Commands

From this repo today:

```bash
npm run agents -- <command>
npm run agents2 -- <command>
npm run ai-agents -- <command>
```

After package installation, the intended public form is:

```bash
ai-agents <command>
```

## Workspace Wrappers

### `agents`

Uses the `coordination/` workspace by default.

```bash
npm run agents -- status
```

### `agents2`

Uses the `coordination-two/` workspace by default.

```bash
npm run agents2 -- status
```

### `ai-agents`

Public CLI entrypoint. Uses the `coordination/` workspace by default unless overridden.

```bash
npm run ai-agents -- status
```

## Global Environment Overrides

The coordinator supports environment variables for advanced use:

| Variable | Purpose |
| --- | --- |
| `AGENT_COORDINATION_CONFIG` | Use a non-default config path. |
| `AGENT_COORDINATION_ROOT` | Store board/runtime files outside the repo. |
| `AGENT_COORDINATION_DIR` | Use a different repo-local workspace folder. |
| `AGENT_COORDINATION_CLI_ENTRYPOINT` | Change help examples to another command name. |
| `AGENT_COORDINATION_LOCK_WAIT_MS` | Tune lock wait time. |
| `AGENT_COORDINATION_LOCK_STALE_MS` | Tune stale lock detection. |
| `AGENT_TERMINAL_ID` | Identify terminals when the same agent slot is used in multiple shells. |

## Current Commands

### `help`

Shows coordinator help.

```bash
npm run agents -- help
```

### `init`

Creates the local coordination workspace.

```bash
npm run agents:init
npm run agents -- init
```

Expected effects:

- Creates the coordination directory.
- Creates initial board/runtime files when needed.
- Creates task/runtime folders.

### `doctor`

Checks the coordinator setup and reports issues.

```bash
npm run agents:doctor
npm run agents -- doctor
```

Use this after copying the coordinator into another repo or changing config.

### `validate`

Validates the current board/config state as supported by the coordinator.

```bash
npm run agents:validate
npm run agents -- validate
```

### `plan`

Creates or updates a multi-agent plan based on the coordinator configuration.

```bash
npm run agents:plan
npm run agents -- plan
```

### `status`

Prints current board/task status.

```bash
npm run agents:status
npm run agents -- status
```

### `heartbeat-start`

Starts heartbeat tracking for an agent/session.

```bash
npm run agents:heartbeat:start
npm run agents -- heartbeat-start
```

### `heartbeat-status`

Shows heartbeat status.

```bash
npm run agents:heartbeat:status
npm run agents -- heartbeat-status
```

### `heartbeat-stop`

Stops heartbeat tracking.

```bash
npm run agents:heartbeat:stop
npm run agents -- heartbeat-stop
```

### `watch-start`

Starts the watcher loop.

```bash
npm run agents:watch:start
npm run agents -- watch-start
```

Current note: the watcher is PowerShell-based. A cross-platform Node watcher is planned.

### `watch-status`

Shows watcher state.

```bash
npm run agents:watch:status
npm run agents -- watch-status
```

### `watch-stop`

Stops the watcher loop.

```bash
npm run agents:watch:stop
npm run agents -- watch-stop
```

## Roadmap Commands

The roadmap includes future commands such as:

- `bootstrap`
- `doctor --fix`
- `doctor --json`
- `summarize`
- `summarize --for-chat`
- `start`
- `finish`
- `handoff-ready`
- `run-check`
- `artifacts list`
- `artifacts inspect`
- `artifacts prune`
- `graph`
- `pr-summary`
- `timeline`
- `prompt <agent>`
- `release-check`
- `lock-status`
- `lock-clear --stale-only`
- `migrate-config`
- `repair-board`
- `rollback-state`
- `inspect-board`
- `watch-diagnose`
- `cleanup-runtime`
- `explain-config`

## Read-Only vs Mutation Commands

Read-only commands should not mutate runtime state. Examples:

- `help`
- `status`
- `validate`
- `doctor`
- `watch-status`
- `heartbeat-status`

Mutation commands may create or update coordination files. Examples:

- `init`
- `plan`
- `heartbeat-start`
- `heartbeat-stop`
- `watch-start`
- `watch-stop`

A future global `--dry-run` flag should be supported for every mutation command.
