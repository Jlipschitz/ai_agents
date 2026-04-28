# AI Agents

Portable coordination tooling for running multiple coding agents in one repository.

`ai_agents` helps multiple coding agents work in the same repo without stepping on each other. It keeps a local coordination board, tracks task ownership, records notes and verification, manages heartbeats, and provides doctor/status commands for safer handoffs.

## Requirements

- Node.js 24 or newer.
- npm with lockfile support.

The repo includes both `.nvmrc` and `.node-version` set to `24`.

## What It Does

- Creates a repo-local coordination workspace.
- Tracks planned, active, blocked, review, handoff, done, and released tasks.
- Records claimed paths so agents can avoid overlapping work.
- Stores journal entries and lightweight messages.
- Supports agent heartbeats and watcher status.
- Provides `doctor`, `validate`, `status`, `plan`, and `summarize` commands.
- Supports `doctor --fix` and `doctor --json` through the command layer.
- Performs Git preflight checks before task claims.
- Provides lifecycle helpers: `start`, `finish`, and `handoff-ready`.
- Validates portable config with `npm run validate:agents-config` and the `validate`/`doctor` command layer.
- Uses a cross-platform Node watcher by default for `watch-start`.
- Bootstraps the coordinator into another repo with `npm run bootstrap`.
- Can be copied into other repos and configured per project.

## Quick Start

Install dependencies from the lockfile:

```bash
npm ci
```

Validate the portable config:

```bash
npm run validate:agents-config
```

Initialize the default coordination workspace:

```bash
npm run agents:init
npm run agents:doctor
```

Run a machine-readable doctor report or apply safe setup fixes:

```bash
npm run agents:doctor:json
npm run agents:doctor:fix
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

## Bootstrap Into Another Repo

Preview the install:

```bash
npm run bootstrap -- --target C:\path\to\repo --dry-run
```

Apply it:

```bash
npm run bootstrap -- --target C:\path\to\repo
```

The bootstrap command copies the coordinator scripts, docs, config, and schema into the target repo, adds useful `package.json` scripts, updates `.gitignore`, creates starter agent notes, and runs `agents:doctor` unless `--skip-doctor` is passed.

Useful flags:

- `--force`: replace existing copied coordinator files.
- `--dry-run`: print intended operations without writing files.
- `--skip-doctor`: skip the final doctor run.

## Common Commands

```bash
npm run bootstrap -- --target C:\path\to\repo --dry-run
npm run validate:agents-config
npm run agents -- help
npm run agents:init
npm run agents:doctor
npm run agents:doctor:json
npm run agents:doctor:fix
npm run agents:plan
npm run agents:status
npm run agents:summarize
npm run agents:validate
npm run agents:start -- agent-1 task-id --paths src/path "Starting work."
npm run agents:finish -- agent-1 task-id "Finished and verified."
npm run agents:handoff-ready -- agent-1 task-id "Ready for handoff."
npm run agents:lock:status
npm run agents:lock:clear
npm run agents:heartbeat:start
npm run agents:heartbeat:status
npm run agents:heartbeat:stop
npm run agents:watch:start
npm run agents:watch:node
npm run agents:watch:status
npm run agents:watch:stop
```

The `agents2` scripts mirror the same commands but use the `coordination-two` workspace by default.

## Default Files

- `.nvmrc` and `.node-version`: Node 24 runtime hints.
- `package-lock.json`: npm lockfile used by CI for reproducible `npm ci` installs and cache keys.
- `bin/ai-agents.mjs`: public CLI entrypoint.
- `scripts/agent-command-layer.mjs`: command-layer features such as `doctor --fix`, `doctor --json`, `summarize`, lifecycle helpers, Git preflight, and Node watcher start.
- `scripts/agent-coordination-core.mjs`: shared coordinator implementation.
- `scripts/agent-coordination.mjs`: `agents` workspace wrapper.
- `scripts/agent-coordination-two.mjs`: `agents2` workspace wrapper.
- `scripts/bootstrap.mjs`: installer for copying `ai_agents` into another repo.
- `scripts/validate-config.mjs`: config validator with text and JSON output.
- `scripts/lock-runtime.mjs`: runtime lock inspection and safe stale-lock cleanup.
- `scripts/agent-watch-loop.mjs`: cross-platform Node watch-loop helper.
- `scripts/agent-watch-loop.ps1`: legacy Windows watch-loop helper for `agents`.
- `scripts/agent-watch-loop-two.ps1`: legacy Windows watch-loop helper for `agents2`.
- `agent-coordination.schema.json`: JSON schema for portable config files.
- `agent-coordination.config.json`: app-specific planning, docs, paths, and verification config.
- `docs/agent-coordination-portability.md`: configuration and portability notes.
- `docs/commands.md`: command reference.
- `docs/workflows.md`: copy/paste workflow examples.
- `docs/implementation-status.md`: implemented vs pending roadmap status.
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

Validate config changes with:

```bash
npm run validate:agents-config
node ./scripts/validate-config.mjs --config ./agent-coordination.config.json --json
npm run agents -- validate --json
```

Important config areas:

- `projectName`
- `agentIds`
- `docs`
- `git`
- `paths.sharedRisk`
- `paths.visualImpact`
- `verification`
- `pathClassification`
- `planning`
- `domainRules`

See [`docs/agent-coordination-portability.md`](docs/agent-coordination-portability.md) for details.

## Using In Another Repo

Use the bootstrap command instead of manually copying files:

```bash
npm run bootstrap -- --target C:\path\to\repo
```

Then open the target repo, adapt `agent-coordination.config.json`, and run:

```bash
npm run validate:agents-config
npm run agents:init
npm run agents:doctor
```

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

`watch-start` uses the Node watcher by default. The PowerShell watcher scripts remain available as legacy compatibility helpers.

```bash
npm run agents:watch:start
npm run agents -- watch-start --interval 30000
npm run agents:watch:node
npm run agents2:watch:node
```

### Config errors

Run:

```bash
npm run validate:agents-config
npm run agents:validate
npm run agents:doctor
```

## Testing

```bash
npm run check
npm test
```

CI runs on Node 24, installs with `npm ci`, and uses GitHub Actions npm caching keyed by `package-lock.json`.

## Roadmap

See [`ai_agents_roadmap.md`](ai_agents_roadmap.md) for the long roadmap and [`docs/implementation-status.md`](docs/implementation-status.md) for the current implemented vs pending status.
