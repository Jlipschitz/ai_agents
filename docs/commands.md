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

### `summarize`

Prints an enhanced board handoff summary.

```bash
npm run agents:summarize
npm run agents -- summarize
npm run agents -- summarize --for-chat
npm run agents -- summarize --json
```

Current summary output includes:

- task counts by status
- active work
- blockers
- review queue
- stale active work
- next planned work
- next recommended actions
- recent journal lines
- recent messages

Useful modes:

- `--for-chat`: compact paste-friendly status block.
- `--json`: machine-readable payload containing summary, board state, counts, next actions, recent journal lines, and recent messages.

### `validate`

Validates the current coordination board and task records. The command layer also validates `agent-coordination.config.json` before the core validator runs.

```bash
npm run agents:validate
npm run agents -- validate
npm run agents -- validate --json
```

### `doctor`

Runs setup and health checks for config, package scripts, ignored runtime folders, docs, visual checks, and board state. The command layer validates config before the core doctor runs.

```bash
npm run agents:doctor
npm run agents -- doctor
npm run agents -- doctor --json
npm run agents -- doctor --fix
npm run agents -- doctor --json --fix
```

Useful modes:

- `--json`: prints machine-readable doctor output including config validation and Git state.
- `--fix`: creates safe missing starter files/folders, updates `.gitignore`, adds missing package scripts, and creates starter app notes.

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

### `lock-status`

Inspects the runtime state lock without mutating it. This is routed through the main CLI, so all wrapper forms work.

```bash
npm run agents:lock:status
npm run agents2:lock:status
npm run agents -- lock-status
npm run agents -- lock-status --json
npm run ai-agents -- lock-status --json
node ./scripts/lock-runtime.mjs status --coordination-dir coordination --json
```

The status output reports whether the lock exists, whether it is stale, stale reasons, age, PID status, owner, and command when available.

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

Planner lane sizing is covered by `scripts/planner-sizing.mjs`, which classifies likely product, data, verify, and docs lanes from the configured `planning.agentSizing` keywords. The helper is currently used as a regression-test target so planner sizing behavior can be stabilized before deeper core planner refactors.

### `claim`

Claims a task for an agent and records claimed paths. Before delegating to the core claim command, the command layer performs a Git preflight check for branch, upstream, ahead/behind state, dirty files, untracked files, merge/rebase state, and configured branch policies. Merge/rebase-in-progress state and configured branch policy violations block the claim.

```bash
npm run agents -- claim agent-1 task-id --paths src/tasks,docs/tasks.md
```

Configure branch claim policies in `agent-coordination.config.json`:

```json
{
  "git": {
    "allowMainBranchClaims": false,
    "allowDetachedHead": false,
    "allowedBranchPatterns": ["agent/*", "feature/*", "fix/*"]
  }
}
```

Policy fields:

- `allowMainBranchClaims`: allow claims from `main` or `master`.
- `allowDetachedHead`: allow claims when Git is in detached HEAD state.
- `allowedBranchPatterns`: optional glob-style branch allowlist. When non-empty, the current branch must match at least one pattern.

### `start`

Convenience lifecycle helper that claims a task and optionally records an initial progress note.

```bash
npm run agents:start -- agent-1 task-id --paths src/tasks "Starting task implementation."
npm run agents -- start agent-1 task-id --paths src/tasks,docs/tasks.md "Starting task implementation."
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

### `handoff-ready`

Convenience lifecycle helper that marks a task ready for handoff using the core handoff command.

```bash
npm run agents:handoff-ready -- agent-1 task-id "Ready for agent-2 to continue."
npm run agents -- handoff-ready agent-1 task-id "Ready for agent-2 to continue."
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

### `finish`

Convenience lifecycle helper that marks a task done using the core done command.

```bash
npm run agents:finish -- agent-1 task-id "Implemented and verified."
npm run agents -- finish agent-1 task-id "Implemented and verified."
```

Optional safety gates:

```bash
npm run agents -- finish agent-1 task-id --require-verification "Finished and verified."
npm run agents -- finish agent-1 task-id --require-doc-review "Finished after reviewing docs."
npm run agents -- finish agent-1 task-id --require-verification --require-doc-review "Finished safely."
```

Gate behavior:

- `--require-verification`: all checks listed in the task `verification` array must have a latest `verificationLog` outcome of `pass`.
- `--require-doc-review`: the task must have `docsReviewedAt` recorded.
- If a gate fails, the command exits before delegating to the core `done` command, so the board is not mutated.

### `release`

Marks a done task released.

```bash
npm run agents -- release agent-1 task-id "Merged into main."
```

## Runtime Lock Commands

### `lock-clear`

Clears stale runtime state locks safely. This is routed through the main CLI, so all wrapper forms work.

```bash
npm run agents:lock:clear
npm run agents2:lock:clear
npm run agents -- lock-clear --stale-only
npm run agents -- lock-clear --stale-only --json
npm run ai-agents -- lock-clear --stale-only --json
node ./scripts/lock-runtime.mjs clear --stale-only --coordination-dir coordination
```

Safety rules:

- `clear --stale-only` removes only malformed, old, or dead-PID locks.
- Non-stale locks are refused.
- Use `--force` only when a human has confirmed the lock should be removed.
- Use `--json` for machine-readable output.

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

Starts heartbeat tracking for an agent/session.

```bash
npm run agents:heartbeat:start -- agent-1
```

### `heartbeat-stop`

Stops heartbeat tracking.

```bash
npm run agents:heartbeat:stop -- agent-1
```

### `watch-start`

Starts the Node watcher loop by default.

```bash
npm run agents:watch:start
npm run agents -- watch-start --interval 30000
```

### `agents:watch:node`

Runs the cross-platform Node watcher loop directly. This is useful for diagnostics or one-shot ticks.

```bash
npm run agents:watch:node
npm run agents2:watch:node
node ./scripts/agent-watch-loop.mjs --coordinator-script ./scripts/agent-coordination.mjs --once
```

## Mutation vs Read-only Behavior

Read-only commands should not change board, journal, messages, runtime, or task files. Mutation commands should record meaningful journal entries and keep task status, ownership, verification, and timestamps consistent.

Use tests for new command work so accidental mutations are caught early.
