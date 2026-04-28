# Explain Config

`explain-config` explains the active `agent-coordination.config.json` in human-readable or JSON form.

It is useful after bootstrapping into a new repo, when debugging config issues, or when another agent needs to understand how the coordinator is configured.

## Commands

```bash
npm run agents:explain-config
npm run agents -- explain-config
npm run agents -- explain-config --json
npm run agents2:explain-config
npm run ai-agents -- explain-config --json
node ./scripts/explain-config.mjs --json
```

## Options

```text
--json            Emit machine-readable JSON output.
--config <path>   Use a non-default config path.
--root <path>     Use a non-default repo root for path existence checks.
--help            Show command help.
```

## What It Reports

`explain-config` reports:

- project name
- repository root
- active config path
- whether the config exists
- config validation result
- validation errors and warnings
- active environment overrides
- configured agent IDs
- docs roots and whether they exist
- configured app notes and visual workflow docs
- API prefixes
- Git claim policy
- shared-risk paths
- visual-impact paths
- visual-suite paths
- visual verification checks
- path classification rules
- planner fallback paths
- planner lane sizing rules
- domain rules
- setup suggestions

## Environment Override Reporting

The command reports active values for these variables when present:

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

This helps diagnose cases where commands appear to read the wrong config or coordination folder.

## Example Text Output

```text
# Config Explanation

Project: AI Agents
Root: /path/to/repo
Config: /path/to/repo/agent-coordination.config.json
Config exists: yes
Valid: yes

Environment overrides:
- AGENT_COORDINATION_DIR=coordination

Agents:
- agent-1
- agent-2
- agent-3
- agent-4

Docs roots:
- docs (exists)

Git policy:
- allowMainBranchClaims: true
- allowDetachedHead: false
- allowedBranchPatterns:
- None

Suggestions:
- No visualRequiredChecks are configured; UI-impact work may rely on manual verification.
```

## Example JSON Output

```bash
npm run agents -- explain-config --json
```

Returns a JSON object with these top-level fields:

```json
{
  "projectName": "AI Agents",
  "root": "/path/to/repo",
  "configPath": "/path/to/repo/agent-coordination.config.json",
  "configExists": true,
  "validation": {
    "valid": true,
    "errors": [],
    "warnings": []
  },
  "environmentOverrides": {},
  "agents": {
    "count": 4,
    "ids": ["agent-1", "agent-2", "agent-3", "agent-4"]
  },
  "docs": {},
  "git": {},
  "paths": {},
  "verification": {},
  "pathClassification": {},
  "planning": {},
  "domainRules": [],
  "suggestions": []
}
```

## Exit Codes

- `0`: config is valid
- `1`: config is invalid or could not be explained

The command can still print useful JSON with validation errors when it exits `1`.

## When To Use It

Use `explain-config` when:

- setting up a new target repo
- debugging missing docs paths
- debugging wrong coordination folders
- reviewing Git claim policy
- checking planner sizing rules
- checking active environment overrides
- preparing another agent for work

## Related Commands

```bash
npm run validate:agents-config
npm run agents -- validate --json
npm run agents -- doctor --json
npm run agents -- summarize --json
```
