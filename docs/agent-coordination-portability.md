# Agent Coordination Portability

The `agents` and `agents2` commands are driven by `agent-coordination.config.json`, so the coordinator can be installed into another repo without editing the core script.

## Package Install Flow

When the scoped package is available from npm, use the package entrypoint directly:

```bash
npm install --save-dev @jlipschitz/ai-agents
npx ai-agents init
npx ai-agents doctor
npx ai-agents status
```

For one-off execution without adding a dependency:

```bash
npx @jlipschitz/ai-agents init
npx @jlipschitz/ai-agents doctor
```

Before npm publication, verify the same executable from GitHub:

```bash
npx github:Jlipschitz/ai_agents --version
npx github:Jlipschitz/ai_agents doctor
```

Package-based installs use the public `ai-agents` binary from `package.json` `bin.ai-agents`. The package name is `@jlipschitz/ai-agents`, the binary should remain `ai-agents`, and the bin target should remain `bin/ai-agents.mjs` so installed projects can run `npx ai-agents <command>` consistently.

## Recommended Install Flow

From the `ai_agents` repo, preview the install:

```bash
npm run bootstrap -- --target C:\path\to\repo --dry-run
```

Apply it:

```bash
npm run bootstrap -- --target C:\path\to\repo
```

The bootstrap command will:

- Copy the coordinator scripts, config, schema, and docs.
- Add useful `package.json` scripts.
- Add coordination runtime folders to `.gitignore`.
- Create starter app notes when missing.
- Run `npm run agents:doctor` unless `--skip-doctor` is passed.

Useful flags:

- `--force`: replace existing copied coordinator files.
- `--dry-run`: print intended operations without writing files.
- `--skip-doctor`: skip the final doctor run.

## Files Installed

Bootstrap copies these files when present:

- `bin/ai-agents.mjs`
- `scripts/agent-coordination-core.mjs`
- `scripts/agent-coordination.mjs`
- `scripts/agent-coordination-two.mjs`
- `scripts/agent-watch-loop.mjs`
- `scripts/agent-watch-loop.ps1`
- `scripts/agent-watch-loop-two.ps1`
- `scripts/validate-config.mjs`
- `agent-coordination.schema.json`
- `agent-coordination.config.json`
- `docs/agent-coordination-portability.md`
- `docs/commands.md`
- `docs/workflows.md`

## Package Scripts Added

Bootstrap adds the standard `agents`, `agents2`, watcher, and config validation scripts to the target `package.json`.

Manual equivalent:

```json
{
  "scripts": {
    "ai-agents": "node ./bin/ai-agents.mjs",
    "agents": "node ./scripts/agent-coordination.mjs",
    "agents:init": "node ./scripts/agent-coordination.mjs init",
    "agents:plan": "node ./scripts/agent-coordination.mjs plan",
    "agents:status": "node ./scripts/agent-coordination.mjs status",
    "agents:validate": "node ./scripts/agent-coordination.mjs validate",
    "agents:doctor": "node ./scripts/agent-coordination.mjs doctor",
    "agents:watch:node": "node ./scripts/agent-watch-loop.mjs --coordinator-script ./scripts/agent-coordination.mjs",
    "agents2": "node ./scripts/agent-coordination-two.mjs",
    "agents2:init": "node ./scripts/agent-coordination-two.mjs init",
    "agents2:plan": "node ./scripts/agent-coordination-two.mjs plan",
    "agents2:status": "node ./scripts/agent-coordination-two.mjs status",
    "agents2:validate": "node ./scripts/agent-coordination-two.mjs validate",
    "agents2:doctor": "node ./scripts/agent-coordination-two.mjs doctor",
    "agents2:watch:node": "node ./scripts/agent-watch-loop.mjs --coordinator-script ./scripts/agent-coordination-two.mjs",
    "validate:agents-config": "node ./scripts/validate-config.mjs"
  }
}
```

Run `npm run agents:init` or `npm run agents2:init` in the new repo to create the local coordination workspace.

Run `npm run validate:agents-config`, then `npm run agents:doctor` or `npm run agents2:doctor` after copying to verify config paths, package scripts, ignored runtime folders, docs, visual checks, and current board state.

## Publish Readiness

Before publishing the package, confirm:

- `package.json` has `name: "@jlipschitz/ai-agents"` and a semver `version`.
- `package.json` is publishable and not marked private.
- `bin.ai-agents` points at `bin/ai-agents.mjs`.
- `README.md`, `docs/commands.md`, and this portability guide describe the public scoped-package install flow.
- The local checks pass and the package contents look correct.

Recommended verification:

```bash
npm ci
npm run check
npm run lint
npm run jsdoc:check
npm run format:check
npm run validate:agents-config
npm test
npm run agents:publish:check
npm run agents -- publish-check --strict
npm pack --dry-run
npm publish --dry-run
```

## Configure A New App

Edit `agent-coordination.config.json` in the target repo:

- `projectName`: human-readable app name shown in help output.
- `agentIds`: supported agent slots.
- `docs.roots`: folders scanned for Markdown docs.
- `docs.appNotes`: short app handoff doc suggested first for every task.
- `docs.visualWorkflow`: optional visual workflow doc for UI work.
- `paths.sharedRisk`: shared files or folders that need stricter merge coordination.
- `paths.visualSuite`: paths that own visual route, fixture, or snapshot work.
- `paths.visualImpact`: UI paths that should require visual verification.
- `verification.requiredChecks`: baseline verification checks used by config suggestions and future command gates.
- `verification.visualRequiredChecks`: checks required before UI-impact work is marked done.
- `notes.categories`: categories accepted by `app-note`.
- `notes.sectionHeading`: section in `docs.appNotes` where agent discoveries are appended.
- `pathClassification`: how changed files are bucketed into product, data, verify, or docs work.
- `planning`: fallback paths and default domains used by `plan`.
- `planning.agentSizing`: thresholds and keywords used by `plan` to decide whether to use one agent or split into product, data, verification, and docs lanes.
- `domainRules`: app-specific keywords and path scopes used by `plan`.

If the target app does not have visual tests, set:

```json
{
  "paths": {
    "visualSuite": [],
    "visualSuiteDefault": [],
    "visualImpact": []
  },
  "verification": {
    "requiredChecks": [],
    "visualRequiredChecks": [],
    "visualSuiteUpdateChecks": []
  }
}
```

Validate config changes with:

```bash
npm run validate:agents-config
node ./scripts/validate-config.mjs --config ./agent-coordination.config.json --json
```

## Environment Overrides

Useful overrides when moving between machines:

- `AGENT_COORDINATION_CONFIG`: use a non-default config path.
- `AGENT_COORDINATION_ROOT`: store board/runtime files outside the repo.
- `AGENT_COORDINATION_DIR`: use a different repo-local workspace folder.
- `AGENT_COORDINATION_CLI_ENTRYPOINT`: change help examples from `agents` to another npm script.
- `AGENT_COORDINATION_LOCK_WAIT_MS`: tune lock wait time for slower shared drives.
- `AGENT_TERMINAL_ID`: identify terminals when the same agent slot is used in multiple shells.

## Moving Machines

For a clean start on a new machine:

1. Clone the app repo.
2. Install dependencies.
3. Run `npm run agents:init` and `npm run agents2:init`.

The `coordination/` and `coordination-two/` folders are runtime state and are intentionally ignored by git. If you need to preserve active tasks, copy those folders manually or set `AGENT_COORDINATION_ROOT` to a synced location before starting work.

## Updating App Notes

Agents should record reusable discoveries with:

```text
npm run agents -- app-note agent-1 inconsistency "Short durable note." --task task-id --paths src/path,docs/path
npm run agents2 -- app-note agent-1 change "Short durable note." --task task-id --paths src/path
```

Use this for:

- errors or failed assumptions that future agents may repeat
- docs/code inconsistencies
- behavior or architecture changes
- verification lessons
- setup or environment gotchas
- product or engineering decisions

The command appends a structured entry to `docs.appNotes` under `notes.sectionHeading` and logs the event in the coordination journal.

## Recommended Extra Improvements

Good next upgrades:

- Add `doctor --fix` to repair common setup issues directly from the coordinator.
- Integrate schema validation into `doctor` and `validate` in addition to the standalone validator.
- Make the Node watcher the default implementation used by `watch-start`.
- Add stale-branch and remote-sync checks before assigning new work.
- Add a `summarize` command that writes a compact handoff from the current board state.
