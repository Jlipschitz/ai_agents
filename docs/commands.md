# Command Reference

This reference documents the common `ai_agents` commands exposed through the public CLI and the compatibility npm scripts.

Use the public entrypoint when installed as a package:

```bash
ai-agents <command>
npm run ai-agents -- <command>
```

Use the compatibility wrappers when the repo has copied coordinator scripts:

```bash
npm run agents -- <command>
npm run agents2 -- <command>
```

`agents` uses the `coordination/` workspace by default. `agents2` uses `coordination-two/` by default.

## Read-only Commands

These commands should not mutate runtime state.

### `help`

Shows command help.

```bash
npm run agents -- help
```

### `status`

Prints the current board state, active work, blockers, and stale work.

```bash
npm run agents:status
npm run agents -- status
```

### `validate`

Validates the current coordination board and task records.

```bash
npm run agents:validate
npm run agents -- validate
```

### `doctor`

Runs setup and health checks for config, package scripts, ignored runtime folders, docs, visual checks, and board state.

```bash
npm run agents:doctor
npm run agents -- doctor
```

### `heartbeat-status`

Shows known agent heartbeat files and freshness.

```bash
npm run agents:heartbeat:status
```

### `watch-status`

Shows watcher status, if the watcher has been started.

```bash
npm run agents:watch:status
```

## Setup Commands

### `init`

Creates the local coordination workspace and starter runtime files.

```bash
npm run agents:init
npm run agents2:init
```

### `bootstrap`

Copies the coordinator into another repository, adds package scripts, creates starter docs, updates `.gitignore`, and runs doctor.

```bash
npm run bootstrap -- --target C:\path\to\repo
npm run bootstrap -- --target ../other-repo --dry-run
npm run bootstrap -- --target ../other-repo --force
```

Flags:

- `--target <path>`: target repository path.
- `--dry-run`: print intended operations without writing files.
- `--force`: replace existing copied coordinator files.
- `--skip-doctor`: skip the final `agents:doctor` run.

### `validate:agents-config`

Validates `agent-coordination.config.json` against the expected portable config shape.

```bash
npm run validate:agents-config
node ./scripts/validate-config.mjs --config ./agent-coordination.config.json --json
```

Flags:

- `--config <path>`: config file to validate.
- `--root <path>`: repo root used for existence warnings.
- `--json`: emit machine-readable validation output.

## Planning and Task Commands

### `plan`

Generates a task split from a natural-language work description using configured domains, fallback paths, and sizing rules.

```bash
npm run agents:plan -- "Build task labels and reporting"
npm run agents -- plan "Improve mobile task modal"
```

### `claim`

Claims a task for an agent and records claimed paths.

```bash
npm run agents -- claim agent-1 task-id --paths src/tasks,docs/tasks.md
```

### `progress`

Adds a progress note to a task.

```bash
npm run agents -- progress agent-1 task-id "Implemented parser and started tests."
```

### `blocked`

Marks a task blocked and records the blocker.

```bash
npm run agents -- blocked agent-1 task-id "Waiting for API contract."
```

### `waiting`

Marks a task waiting on one or more dependency tasks.

```bash
npm run agents -- waiting agent-2 task-ui --on task-api
```

### `review`

Moves a task into review.

```bash
npm run agents -- review agent-1 task-id "Ready for verification."
```

### `verify`

Records manual verification evidence for a task.

```bash
npm run agents -- verify agent-1 task-id unit pass "npm test passed"
npm run agents -- verify agent-1 task-id lint fail "lint failed in src/foo.ts"
```

### `done`

Marks a task done when required verification is complete.

```bash
npm run agents -- done agent-1 task-id "Implemented and verified."
```

### `release`

Marks a done task released.

```bash
npm run agents -- release agent-1 task-id "Merged into main."
```

## Notes and Messaging

### `app-note`

Appends a durable note to the configured app notes doc.

```bash
npm run agents -- app-note agent-1 gotcha "The visual suite requires snapshots." --task task-ui --paths tests/visual
```

### `message`

Adds a lightweight coordination message for another agent or the team.

```bash
npm run agents -- message agent-1 agent-2 "API contract is ready."
```

## Heartbeat and Watcher Commands

### `heartbeat-start`

Starts an agent heartbeat process.

```bash
npm run agents:heartbeat:start -- agent-1
```

### `heartbeat-stop`

Stops an agent heartbeat process when supported by the runtime state.

```bash
npm run agents:heartbeat:stop -- agent-1
```

### `watch-start`

Starts the configured watcher process.

```bash
npm run agents:watch:start
```

### `agents:watch:node`

Runs the cross-platform Node watcher loop directly. This is useful on macOS/Linux or when PowerShell is not available.

```bash
npm run agents:watch:node
npm run agents2:watch:node
node ./scripts/agent-watch-loop.mjs --coordinator-script ./scripts/agent-coordination.mjs --once
```

## Mutation vs Read-only Behavior

Read-only commands should not change board, journal, messages, runtime, or task files. Mutation commands should record meaningful journal entries and keep task status, ownership, verification, and timestamps consistent.

Use tests for new command work so accidental mutations are caught early.
