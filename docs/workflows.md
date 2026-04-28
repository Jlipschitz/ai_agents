# Example Workflows

These examples show how to use `ai_agents` during normal multi-agent development.

## Start a New Session

```bash
npm install
npm run agents:init
npm run validate:agents-config
npm run agents:doctor
npm run agents:status
```

Use `agents2` when you want a second independent coordination workspace:

```bash
npm run agents2:init
npm run agents2:doctor
```

## Bootstrap Another Repository

Preview the install first:

```bash
npm run bootstrap -- --target C:\path\to\repo --dry-run
```

Apply the install:

```bash
npm run bootstrap -- --target C:\path\to\repo
```

Then open the target repo and adapt `agent-coordination.config.json` for that app.

## Plan Work

Use `plan` with a plain-language description of the work:

```bash
npm run agents -- plan "Build labels, recurring tasks, and reporting for the todo app"
```

Review the generated task split before agents claim work:

```bash
npm run agents:status
```

## Claim Work

Agents should claim narrow, accurate paths:

```bash
npm run agents -- claim agent-1 task-ui --paths src/components/tasks,src/pages/Today.tsx
npm run agents -- claim agent-2 task-api --paths server/routes/tasks.js,server/db
```

Avoid broad claims like `src` or `components` unless the task truly owns the entire area.

## Record Progress

```bash
npm run agents -- progress agent-1 task-ui "Task modal layout is implemented; mobile spacing still needs review."
```

Progress notes help the next agent understand what changed without reading the whole diff.

## Mark Blocked or Waiting

Use `blocked` when an agent cannot continue:

```bash
npm run agents -- blocked agent-2 task-api "Need final recurring date rule format."
```

Use `waiting` when a task depends on another task:

```bash
npm run agents -- waiting agent-1 task-ui --on task-api
```

## Verify Work

Run app-specific checks first, then record the result:

```bash
npm test
npm run agents -- verify agent-1 task-ui unit pass "npm test passed"
```

For UI work, record visual checks when configured:

```bash
npm run agents -- verify agent-1 task-ui visual pass "Checked desktop and mobile task modal."
```

## Finish Work

Move a verified task to review or done:

```bash
npm run agents -- review agent-1 task-ui "Ready for final review."
npm run agents -- done agent-1 task-ui "Implemented, verified, and documented."
```

Then release it after merge or deployment:

```bash
npm run agents -- release agent-1 task-ui "Merged into main."
```

## Keep Watcher and Heartbeats Running

Start an agent heartbeat:

```bash
npm run agents:heartbeat:start -- agent-1
```

Check heartbeat status:

```bash
npm run agents:heartbeat:status
```

Start the watcher with the default coordinator command:

```bash
npm run agents:watch:start
```

On macOS/Linux, or when PowerShell is unavailable, use the Node loop:

```bash
npm run agents:watch:node
```

## Recover from Stale State

Check health first:

```bash
npm run agents:doctor
npm run agents:watch:status
npm run agents:heartbeat:status
```

If a task is stale, add a handoff/progress note before another agent claims follow-up work.

Diagnose stale runtime files:

```bash
npm run agents -- watch-diagnose
npm run agents -- cleanup-runtime
npm run agents -- cleanup-runtime --apply
```

## Check Release Readiness

Before treating done work as release-ready:

```bash
npm run agents -- release-check task-ui
npm run agents -- release-check task-ui --json
```

## Capture Check Output

Run a package script and capture stdout/stderr:

```bash
npm run agents -- run-check test
```

Run an explicit command:

```bash
npm run agents -- run-check smoke -- node ./scripts/smoke.mjs
```

## Repair Board State

Inspect first, then dry-run a repair:

```bash
npm run agents -- inspect-board
npm run agents -- repair-board
```

Apply safe repairs and roll back from a snapshot if needed:

```bash
npm run agents -- repair-board --apply
npm run agents -- rollback-state --list
npm run agents -- rollback-state --to latest --apply
```

## Move Coordination State Between Machines

Runtime files are intentionally ignored by Git:

- `coordination/`
- `coordination-two/`

For a clean new machine, rerun init:

```bash
npm run agents:init
```

To preserve active tasks, copy the coordination folder manually or set `AGENT_COORDINATION_ROOT` to a synced location before starting work.
