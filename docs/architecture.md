# Architecture

`ai_agents` is a portable coordination layer for running multiple coding agents in one repository.

The current implementation is intentionally lightweight: a Node.js coordinator script, small wrapper entrypoints, repo-local JSON/Markdown state files, and optional watcher/heartbeat helpers.

## Main Components

### Public CLI

```text
bin/ai-agents.mjs
```

The public CLI entrypoint sets default environment values and loads the shared coordinator core.

### Workspace Wrappers

```text
scripts/agent-coordination.mjs
scripts/agent-coordination-two.mjs
```

These wrappers set workspace-specific defaults before importing the shared core.

- `agent-coordination.mjs` defaults to `coordination/`.
- `agent-coordination-two.mjs` defaults to `coordination-two/`.

They exist so two independent agent groups can coordinate in the same repository without sharing one active board.

### Shared Coordinator Core

```text
scripts/agent-coordination-core.mjs
```

This file contains the main coordinator implementation.

Responsibilities include:

- Config loading
- Path normalization
- Board handling
- Task status handling
- Planning helpers
- Locking helpers
- Heartbeat handling
- Watcher status handling
- Journal/messages handling
- Doctor/validate/status behavior

### Watch Loop Helpers

```text
scripts/agent-watch-loop.ps1
scripts/agent-watch-loop-two.ps1
```

These are Windows PowerShell watcher loops. They repeatedly call `watch-tick` on an interval.

A cross-platform Node watcher is planned so the same behavior works across Windows, macOS, Linux, WSL, and CI.

## Coordination Workspace

The coordinator stores runtime state in a coordination workspace.

Common defaults:

```text
coordination/
coordination-two/
```

The workspace can be changed with:

```text
AGENT_COORDINATION_ROOT
AGENT_COORDINATION_DIR
```

## Core State Files

Typical workspace files:

```text
board.json
journal.md
messages.ndjson
runtime/state.lock.json
runtime/watcher.status.json
runtime/agent-heartbeats/
tasks/
```

These files are runtime state and should normally be ignored by Git.

## Board Model

`board.json` is the active coordination board.

It tracks:

- Tasks
- Task statuses
- Owners
- Claimed paths
- Dependencies
- Verification requirements
- Verification logs
- Notes
- Waiting/blocker state

Task statuses currently include:

- `planned`
- `active`
- `blocked`
- `waiting`
- `review`
- `handoff`
- `done`
- `released`

## Journal Model

`journal.md` is a human-readable event log.

It should be useful when reconstructing what happened during a multi-agent session.

## Message Model

`messages.ndjson` stores lightweight structured messages, one JSON object per line.

NDJSON is used so messages can be appended safely and read incrementally.

## Locking Model

The coordinator uses a runtime lock file:

```text
runtime/state.lock.json
```

The lock protects board/runtime mutations from concurrent writes.

Roadmap improvements include:

- State transactions
- Rollback support
- Lock diagnostics
- Stale-only lock clearing
- Concurrency stress tests

## Heartbeat Model

Agent heartbeat files are stored under:

```text
runtime/agent-heartbeats/
```

Heartbeats help diagnose inactive, stale, or multi-machine sessions.

Roadmap improvements include tracking:

- Machine name
- Repo path
- Process/session ID
- TTL renewal
- Agent SLA warnings

## Watcher Model

The watcher periodically calls into the coordinator to detect stale state, update runtime status, and support long-running coordination sessions.

Current implementation uses PowerShell helpers. Planned implementation uses Node.

## Config Model

Main config file:

```text
agent-coordination.config.json
```

The config controls:

- Project name
- Agent IDs
- Docs roots
- Shared-risk paths
- Visual-impact paths
- Verification rules
- Notes behavior
- Path classification
- Planning behavior
- Domain rules

A formal JSON schema and config migration system are planned.

## Design Goals

- Portable across repositories
- Safe for multi-agent work
- Simple enough to inspect manually
- Mostly file-based
- Friendly to Git workflows
- Useful from terminal, chat, and future dashboards

## Non-Goals For Now

- Replacing Git
- Replacing issue trackers
- Requiring a database
- Requiring a server
- Requiring external APIs for local coordination

Future GitHub integration may sync coordination state with issues, PR comments, labels, and checklists.
