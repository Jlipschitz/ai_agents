# AI Agents

Portable coordination tooling for running multiple coding agents in one repository.

`ai_agents` helps multiple coding agents work in the same repo without stepping on each other. It keeps a local coordination board, tracks task ownership, records notes and verification, manages heartbeats, and provides doctor/status commands for safer handoffs.

## What It Does

- Creates a repo-local coordination workspace.
- Tracks planned, active, blocked, review, handoff, done, and released tasks.
- Records claimed paths so agents can avoid overlapping work.
- Stores journal entries and lightweight messages.
- Supports agent heartbeats and watcher status.
- Provides `doctor`, `validate`, `status`, and `plan` commands.
- Can be copied into other repos and configured per project.

## Quick Start

Install dependencies if needed:

```bash
npm install
```

Initialize the default coordination workspace:

```bash
npm run agents:init
npm run agents:doctor
```

Or use the second workspace wrapper:

```bash
npm run agents2:init
npm run agents2:doctor
```

You can also use the public CLI entrypoint:

```bash
npm run ai-agents -- init
npm run ai-agents -- doctor
```

After package installation or through `npx`, the CLI is intended to run as:

```bash
ai-agents init
ai-agents doctor
ai-agents status
```

## Common Commands

```bash
npm run agents -- help
npm run agents:init
npm run agents:doctor
npm run agents:plan
npm run agents:status
npm run agents:validate
npm run agents:heartbeat:start
npm run agents:heartbeat:status
npm run agents:heartbeat:stop
npm run agents:watch:start
npm run agents:watch:status
npm run agents:watch:stop
```

The `agents2` scripts mirror the same commands but use the `coordination-two` workspace by default.

## Default Files

- `bin/ai-agents.mjs`: public CLI entrypoint.
- `scripts/agent-coordination-core.mjs`: shared coordinator implementation.
- `scripts/agent-coordination.mjs`: `agents` workspace wrapper.
- `scripts/agent-coordination-two.mjs`: `agents2` workspace wrapper.
- `scripts/agent-watch-loop.ps1`: Windows watch-loop helper for `agents`.
- `scripts/agent-watch-loop-two.ps1`: Windows watch-loop helper for `agents2`.
- `agent-coordination.config.json`: app-specific planning, docs, paths, and verification config.
- `docs/agent-coordination-portability.md`: configuration and portability notes.
- `ai_agents_roadmap.md`: planned improvements.

## Runtime Files

The coordinator creates local runtime state in `coordination/` or `coordination-two/` depending on the wrapper used. These folders are intended to be ignored by Git.

Typical runtime files include:

- `board.json`
- `journal.md`
- `messages.ndjson`
- `runtime/state.lock.json`
- `runtime/watcher.status.json`
- `runtime/agent-heartbeats/`
- `tasks/`

## Configuration

Edit `agent-coordination.config.json` for the target app before using the planner heavily. The included config is a working example and should be adapted for each repository.

Important config areas:

- `projectName`
- `agentIds`
- `docs`
- `paths.sharedRisk`
- `paths.visualImpact`
- `verification`
- `pathClassification`
- `planning`
- `domainRules`

See [`docs/agent-coordination-portability.md`](docs/agent-coordination-portability.md) for details.

## Using In Another Repo

For now, copy the coordinator files into the target repo and add the package scripts shown in the portability guide.

The roadmap includes a future `bootstrap` command that will automate this process.

## Troubleshooting

### Git says the repository has dubious ownership

If Git shows:

```text
fatal: detected dubious ownership in repository
```

Add the repo as a safe directory:

```bash
git config --global --add safe.directory <repo-path>
```

### Watcher does not start

Run:

```bash
npm run agents:watch:status
npm run agents:doctor
```

The current watcher helper is PowerShell-based. A cross-platform Node watcher is planned.

### Config errors

Run:

```bash
npm run agents:validate
npm run agents:doctor
```

## Roadmap

See [`ai_agents_roadmap.md`](ai_agents_roadmap.md).
