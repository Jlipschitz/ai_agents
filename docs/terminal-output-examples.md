# Terminal Output Examples

This page shows representative output shapes for common commands. Timestamps, paths, counts, and PIDs vary by machine.

## Runtime Diagnostics

```text
# Runtime Diagnostics

Coordination root: coordination
Lock: missing
Watcher: stale (pid-not-running)
Heartbeats: 1 file(s), 1 stale

Problems:
- Watcher status is stale: pid-not-running
- 1 stale heartbeat file(s) found.

Suggestions:
- Run cleanup-runtime --apply after confirming no coordinator command is still running.
```

## Runtime Cleanup

```text
Runtime cleanup dry run.
- watcher-status: coordination/runtime/watcher.status.json (pid-not-running)
- heartbeat: coordination/runtime/agent-heartbeats/agent-1.json (pid-not-running)
```

## Board Inspection

```text
# Board Inspection

Board: coordination/board.json
Tasks: 3
Agents: 4
Counts: planned=1, active=1, done=1

Findings:
- none

Warnings:
- none
```

## Release Check

```text
# Release Check

task-ui: blocked
- Missing passing verification for unit.
- Docs review is required but docsReviewedAt is missing.
```

## Check Runner

```text
Check smoke passed with exit code 0.
Artifact: artifacts/checks/2026-04-28T09-30-00-000Z-smoke.log
```
