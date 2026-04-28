# Implementation Status

This document tracks roadmap items that now have concrete implementation support in the repo.

## Implemented or Partially Implemented

### Installer / bootstrap command

Status: implemented as a standalone script.

```bash
npm run bootstrap -- --target C:\path\to\repo
npm run bootstrap -- --target ../target-repo --dry-run
```

Implemented behavior:

- Copies coordinator scripts and docs into a target repo.
- Adds standard `package.json` scripts.
- Adds coordination runtime folders to `.gitignore`.
- Creates starter app notes when missing.
- Runs `npm run agents:doctor` unless `--skip-doctor` is passed.

Main files:

- `scripts/bootstrap.mjs`
- `tests/bootstrap.test.mjs`

### JSON schema for config

Status: implemented as schema plus standalone validator.

```bash
npm run validate:agents-config
node ./scripts/validate-config.mjs --config ./agent-coordination.config.json --json
```

Main files:

- `agent-coordination.schema.json`
- `scripts/validate-config.mjs`
- `tests/config-validation.test.mjs`

Follow-up: integrate the validator directly into `doctor` and `validate` so users do not need to remember a separate command.

### Focused tests

Status: started.

Current coverage:

- Config validation accepts valid config.
- Config validation reports duplicate agent IDs, invalid sizing, and empty rule keywords.
- Bootstrap dry-run does not mutate the target.
- Bootstrap writes package scripts, `.gitignore`, copied files, and starter docs.

Main files:

- `tests/config-validation.test.mjs`
- `tests/bootstrap.test.mjs`

Follow-up tests still needed:

- Planner lane sizing.
- Git status parsing.
- Lock behavior.
- Read-only commands not mutating runtime state.

### Cross-platform watcher

Status: implemented as a Node watcher loop, while keeping PowerShell scripts as compatibility fallbacks.

```bash
npm run agents:watch:node
npm run agents2:watch:node
node ./scripts/agent-watch-loop.mjs --coordinator-script ./scripts/agent-coordination.mjs --once
```

Main file:

- `scripts/agent-watch-loop.mjs`

Follow-up: make `watch-start` prefer the Node watcher by default inside `agent-coordination-core.mjs`.

### Package install flow

Status: partially implemented.

Already present:

- `package.json` package name is `ai-agents`.
- `bin.ai-agents` points to `./bin/ai-agents.mjs`.
- `npm run ai-agents -- <command>` works as the local public entrypoint.

Follow-up:

- Test `npx github:Jlipschitz/ai_agents doctor` in a fresh target repo.
- Decide whether/when this should become a published npm package.

### CI workflow

Status: implemented.

Main file:

- `.github/workflows/ci.yml`

The workflow runs:

- `npm run check`
- `npm run validate:agents-config`
- `npm test`

## Not Yet Implemented

These roadmap items still need core integration work:

- `doctor --fix`
- `doctor --json`
- Better Git awareness before claims
- Board `summarize`
- Single-command lifecycle helpers such as `start`, `finish`, and `handoff-ready`
- Core integration for schema validation
- Making the Node watcher the default implementation used by `watch-start`
