# AI Agents

Portable coordination tooling for running multiple coding agents in one repository.

`ai_agents` keeps a repo-local coordination board so agents can claim work, avoid path conflicts, record progress, attach verification, and hand off safely. It is local-first: runtime state lives in `coordination/` or `coordination-two/`, and those folders should stay ignored by Git.

## Quick Start

```bash
npm ci
npm run agents:init
npm run agents:doctor
npm run agents:status
```

Typical result:

```text
Agent coordination doctor
Project: AI Agents
Workspace: coordination

Passes (...):
- Config loaded: agent-coordination.config.json
- Current board snapshot is valid.

Warnings (...):
- Onboarding: Add docs/architecture.md ...

Findings (0):
- none
```

Use the public CLI entrypoint through npm:

```bash
npm run ai-agents -- doctor
npm run ai-agents -- status
npm run ai-agents -- summarize --json
```

If installed as a package or linked locally:

```bash
ai-agents doctor
ai-agents status
ai-agents summarize
```

## Common Workflow

Plan work:

```bash
npm run agents -- plan "Add task labels and reporting"
```

Claim and start a task:

```bash
npm run agents:start -- agent-1 task-labels --paths src/tasks "Starting task label support."
```

Check status:

```bash
npm run agents:status
npm run agents -- summarize --for-chat
```

Record verification and finish:

```bash
npm run agents -- run-check test
npm run agents -- verify agent-1 task-labels unit pass "npm test passed"
npm run agents:finish -- agent-1 task-labels "Implemented and verified."
```

Expected status result:

```text
Project: AI Agents
Tasks by status:
- active: 1
- planned: 2

Active work:
- task-labels owned by agent-1
```

## Bootstrap Another Repo

Preview install:

```bash
npm run bootstrap -- --target C:\path\to\repo --dry-run
```

Apply install:

```bash
npm run bootstrap -- --target C:\path\to\repo --profile react
```

Profiles:

- `react`: frontend defaults, visual checks, UI impact paths.
- `backend`: API, database, migration, and backend test defaults.
- `docs`: documentation-heavy defaults.
- `release`: stricter release policy, build checks, longer artifact retention.

Bootstrap copies the coordinator scripts, schema, config, and docs into the target repo, adds npm shortcuts, updates `.gitignore`, creates starter agent notes, and runs `agents:doctor` unless `--skip-doctor` is passed.

## Useful Commands

```bash
npm run validate:agents-config
npm run agents -- explain-config
npm run agents -- doctor --json
npm run agents -- doctor --fix
npm run agents -- ask "what is blocked?"
npm run agents -- prompt agent-1
npm run agents -- test-impact --paths src/file.js
npm run agents -- artifacts list
npm run agents -- release-check task-id
npm run agents -- pr-summary task-id
npm run agents -- changelog
```

The `agents2` shortcuts mirror `agents` but use `coordination-two/` by default.

## Runtime State

Typical generated files:

```text
coordination/
  board.json
  journal.md
  messages.ndjson
  runtime/state.lock.json
  runtime/watcher.status.json
  runtime/agent-heartbeats/
  tasks/
```

These files are local runtime state. Keep them out of commits unless your repo intentionally tracks coordination state.

## Configuration

Project behavior is controlled by `agent-coordination.config.json`.

Validate and inspect it:

```bash
npm run validate:agents-config
npm run agents -- explain-config
npm run agents -- explain-config --json
```

Important areas:

- `agentIds`: available agent slots.
- `docs`: documentation roots and durable app notes.
- `git`: branch and claim safety policy.
- `capacity`: per-agent active/blocked task limits.
- `paths`: shared-risk and visual-impact paths.
- `verification` and `checks`: required test/check commands.
- `onboarding`: profile-specific and custom doctor checklist items.
- `planning` and `domainRules`: planner defaults.

## Development Checks

Run the same local gates used by CI:

```bash
npm run check
npm run lint
npm run jsdoc:check
npm run format:check
npm run validate:agents-config
npm test
```

CI runs on Node 24, installs with `npm ci`, and uses npm caching keyed by `package-lock.json`.

## Documentation

- [`docs/commands.md`](docs/commands.md): full command reference.
- [`docs/workflows.md`](docs/workflows.md): common workflows and examples.
- [`docs/explain-config.md`](docs/explain-config.md): config explanation output.
- [`docs/state-files.md`](docs/state-files.md): runtime file reference.
- [`docs/troubleshooting.md`](docs/troubleshooting.md): setup and recovery help.
- [`docs/terminal-output-examples.md`](docs/terminal-output-examples.md): output examples.
- [`docs/roadmap-status.md`](docs/roadmap-status.md): current roadmap status.
