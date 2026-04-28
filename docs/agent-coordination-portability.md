# Agent Coordination Portability

The `agents` and `agents2` commands are now driven by `agent-coordination.config.json`, so the coordinator can be copied to another repo without editing the core script.

## What To Copy

For another repo, copy these files:

- `scripts/agent-coordination-two.mjs`
- `scripts/agent-coordination.mjs`
- `scripts/agent-coordination-core.mjs`
- `scripts/agent-watch-loop-two.ps1`
- `scripts/agent-watch-loop.ps1`
- `agent-coordination.config.json`

Then add package scripts like:

```json
{
  "scripts": {
    "agents": "node ./scripts/agent-coordination.mjs",
    "agents:init": "node ./scripts/agent-coordination.mjs init",
    "agents:status": "node ./scripts/agent-coordination.mjs status",
    "agents:validate": "node ./scripts/agent-coordination.mjs validate",
    "agents:doctor": "node ./scripts/agent-coordination.mjs doctor",
    "agents2": "node ./scripts/agent-coordination-two.mjs",
    "agents2:init": "node ./scripts/agent-coordination-two.mjs init",
    "agents2:status": "node ./scripts/agent-coordination-two.mjs status",
    "agents2:validate": "node ./scripts/agent-coordination-two.mjs validate",
    "agents2:doctor": "node ./scripts/agent-coordination-two.mjs doctor"
  }
}
```

Run `npm run agents:init` or `npm run agents2:init` in the new repo to create the local coordination workspace.

Run `npm run agents:doctor` or `npm run agents2:doctor` after copying to verify config paths, package scripts, ignored runtime folders, docs, visual checks, and current board state.

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
    "visualRequiredChecks": [],
    "visualSuiteUpdateChecks": []
  }
}
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

- Add a `bootstrap` command that writes package scripts and a starter config into a new repo.
- Add JSON schema validation for `agent-coordination.config.json`.
- Add cross-platform shell scripts for macOS/Linux watch loops alongside the PowerShell loops.
- Add stale-branch and remote-sync checks before assigning new work.
- Add a `summarize` command that writes a compact handoff from the current board state.
