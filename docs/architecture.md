# Architecture

`ai_agents` is a portable, file-based coordination layer for running multiple coding agents in the same repository. It does not require a server or database. Runtime coordination state lives in repo-local folders such as `coordination/` and `coordination-two/`.

## Main Layers

```text
bin/ai-agents.mjs
        │
        ├── scripts/agent-coordination.mjs
        ├── scripts/agent-coordination-two.mjs
        │
        ▼
scripts/agent-command-layer.mjs
        │
        ├── handles newer commands and safety checks
        └── delegates legacy/core commands
        │
        ▼
scripts/agent-coordination-core.mjs
        │
        ▼
coordination/ or coordination-two/
```

The architecture is intentionally incremental. Newer behavior is implemented in the command layer so the large core coordinator can be refactored safely over time.

## Public CLI

```text
bin/ai-agents.mjs
```

The public CLI is the long-term entrypoint. It supports package-style usage and handles package-level behavior such as:

```bash
ai-agents --version
ai-agents version
ai-agents doctor
ai-agents status
```

It routes commands through `scripts/agent-command-layer.mjs`.

## Compatibility Wrappers

```text
scripts/agent-coordination.mjs
scripts/agent-coordination-two.mjs
```

These wrappers exist for compatibility and npm-script convenience.

- `scripts/agent-coordination.mjs` defaults to `coordination/`.
- `scripts/agent-coordination-two.mjs` defaults to `coordination-two/`.

Both wrappers route through the command layer before delegating to the core implementation.

## Command Layer

```text
scripts/agent-command-layer.mjs
```

The command layer handles newer commands and safety behavior without requiring a full rewrite of `agent-coordination-core.mjs`.

Currently handled in the command layer:

- `doctor --fix`
- `doctor --json`
- `validate --json`
- `summarize`
- `summarize --for-chat`
- `summarize --json`
- `start`
- `finish`
- `handoff-ready`
- `watch-start`
- `lock-status`
- `lock-clear`
- Git preflight checks before `claim`
- `finish` safety gates:
  - `--require-verification`
  - `--require-doc-review`

When the command layer does not handle a command, it delegates to the core coordinator.

## Core Coordinator

```text
scripts/agent-coordination-core.mjs
```

The core coordinator owns the original board operations and lifecycle transitions.

Core responsibilities include:

- config loading
- path normalization
- board initialization
- planning
- task claiming
- progress, block, wait, review, handoff, done, and release transitions
- manual verification records
- app notes
- messages
- heartbeat status
- watcher status
- core doctor and validation checks
- lock-protected mutations

## Helper Scripts

### `scripts/bootstrap.mjs`

Installs the coordinator into another repository. It copies scripts and docs, adds package scripts, updates `.gitignore`, creates starter notes, and runs `agents:doctor` unless skipped.

### `scripts/validate-config.mjs`

Validates `agent-coordination.config.json` and can emit human-readable or JSON output.

### `scripts/agent-watch-loop.mjs`

Cross-platform Node watcher loop. It repeatedly invokes `watch-tick` and updates watcher runtime status.

### `scripts/lock-runtime.mjs`

Runtime lock diagnostics and safe stale-lock cleanup.

### `scripts/planner-sizing.mjs`

Reusable planner lane sizing helper. It scores product, data, verify, and docs lanes from configured planner keywords. It is currently a regression-test target and should eventually be integrated deeper into the core planner.

## Runtime Workspace

Runtime state is stored in one of these locations:

```text
coordination/
coordination-two/
```

Or via environment overrides:

```text
AGENT_COORDINATION_ROOT
AGENT_COORDINATION_DIR
```

Typical runtime layout:

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
```

Runtime folders are intended to be ignored by Git.

## Board Model

`board.json` is the current source of truth for active coordination state.

It tracks:

- project name
- tasks
- resources
- incidents
- updated timestamp

Common task fields include:

- `id`
- `title`
- `status`
- `ownerId`
- `claimedPaths`
- `dependencies`
- `waitingOn`
- `verification`
- `verificationLog`
- `notes`
- `relevantDocs`
- `docsReviewedAt`

Common task statuses:

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

## Journal Model

`journal.md` is a human-readable event log. It helps reconstruct what happened during a session, but it is not the canonical latest state. The latest state lives in `board.json`.

## Message Model

`messages.ndjson` is a newline-delimited JSON message log.

Each line is one JSON object. Common fields include:

- `from`
- `to`
- `body`
- `message`
- `at`
- `taskId`

Recent messages are included in enhanced `summarize` output.

## Locking Model

Mutating commands use:

```text
runtime/state.lock.json
```

The lock protects board, journal, message, and runtime writes from concurrent mutation.

Diagnostics:

```bash
npm run agents -- lock-status
npm run agents -- lock-clear --stale-only
```

Standalone utility:

```bash
node ./scripts/lock-runtime.mjs status --coordination-dir coordination
node ./scripts/lock-runtime.mjs clear --stale-only --coordination-dir coordination
```

## Heartbeat Model

Heartbeat files live under:

```text
runtime/agent-heartbeats/
```

They help identify active or stale agent sessions. Future work can add richer machine identity, repo path, and SLA warnings.

## Watcher Model

The default watcher is the Node loop:

```text
scripts/agent-watch-loop.mjs
```

`watch-start` launches this watcher through the command layer. The watcher periodically calls the core `watch-tick` command and updates:

```text
runtime/watcher.status.json
```

PowerShell watcher scripts remain as legacy compatibility fallback.

## Configuration Model

Primary config:

```text
agent-coordination.config.json
```

Schema:

```text
agent-coordination.schema.json
```

Validation:

```bash
npm run validate:agents-config
npm run agents -- validate --json
```

Config controls:

- project name
- agent IDs
- docs roots
- Git claim policies
- shared-risk paths
- visual-impact paths
- verification rules
- path classification
- planner sizing
- domain rules

## Environment Overrides

Important overrides:

```text
AGENT_COORDINATION_CONFIG
AGENT_COORDINATION_ROOT
AGENT_COORDINATION_DIR
AGENT_COORDINATION_CLI_ENTRYPOINT
AGENT_COORDINATION_SCRIPT
AGENT_COORDINATION_WATCH_LOOP_SCRIPT
AGENT_COORDINATION_LOCK_WAIT_MS
AGENT_TERMINAL_ID
```

## Design Tradeoffs

### File-based state

Pros:

- easy to inspect
- easy to copy
- no server required
- works in normal Git repositories

Cons:

- requires careful locking
- can grow over time
- not a distributed database

### Command layer before core refactor

Pros:

- safer incremental changes
- easier to test new behavior
- avoids risky rewrites of the large core file

Cons:

- some logic lives outside the core
- long-term architecture should split the core into smaller modules

## Future Direction

Likely architecture improvements:

- split core into board, journal, lock, watcher, config, and planner modules
- move command-layer features into smaller core modules
- add board repair, inspection, migration, and rollback
- add artifact index and retention modules
- add plugin-style check runner
- add universal JSON output support
