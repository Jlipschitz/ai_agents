# AI Agents

Portable coordination tooling for running multiple coding agents in one repository.

## Files

- `scripts/agent-coordination-core.mjs`: shared coordinator implementation.
- `scripts/agent-coordination.mjs`: `agents` workspace wrapper.
- `scripts/agent-coordination-two.mjs`: `agents2` workspace wrapper.
- `scripts/agent-watch-loop.ps1`: Windows watch-loop helper for `agents`.
- `scripts/agent-watch-loop-two.ps1`: Windows watch-loop helper for `agents2`.
- `agent-coordination.config.json`: app-specific planning, docs, paths, and verification config.
- `docs/agent-coordination-portability.md`: configuration and portability notes.

## Quick Start

```powershell
npm run agents:init
npm run agents:doctor
```

or:

```powershell
npm run agents2:init
npm run agents2:doctor
```

Edit `agent-coordination.config.json` for the target app before using the planner heavily. The included config is a working example from Taskbun and should be adapted for each repository.
