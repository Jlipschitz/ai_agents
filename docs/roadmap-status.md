# AI Agents Roadmap Status

This file tracks the current implementation status for the larger roadmap in `ai_agents_roadmap.md`.

## Legend

- `[x]` complete enough for normal use
- `[~]` partially implemented, implemented through command-layer/helper scripts, or usable but still needing deeper core integration
- `[ ]` not started

## Current Focus

The project has completed most of the setup, bootstrap, command routing, CI, documentation, config explanation, and safety-test foundation.

Next recommended work:

1. Add automatic workspace snapshots before legacy core lifecycle mutations.

---

## Phase 1: Core Setup and Bootstrap

- [x] Installer / bootstrap command
- [~] `doctor --fix` — implemented through the command layer; core-native integration remains open.
- [x] JSON schema for config
- [x] Focused tests
- [x] Cross-platform watcher
- [~] Package install flow — package/bin flow exists; public npm publishing remains open.
- [~] Better Git awareness — pre-claim Git preflight exists; richer PR/stale-branch checks remain open.
- [x] Board summary/export

## Phase 2: Task Lifecycle and Daily Workflow

- [~] Single-command task lifecycle — `start`, `finish`, and `handoff-ready` exist; more configurable gates remain open.
- [~] Agent capacity rules — claim-time active/blocked/domain gates exist; richer planner integration remains open.
- [~] Conflict prediction — claim-time local Git overlap detection exists; richer merge prediction remains open.
- [~] Machine identity — terminal/session identity is partially supported.
- [~] Remote sync checks — ahead/behind warnings are partially covered before claim.
- [~] `doctor --json` — implemented through the command layer; core-native integration remains open.
- [x] CI workflow
- [~] Templates — config templates and task templates are available through `templates`; external/custom templates remain open.
- [x] Import/update command
- [~] Conflict-safe resource leases — resource reservations now include TTL, owner machine/process/session metadata, renewal, and expired lease takeover; deeper policy/config controls remain open.
- [x] Transcript-friendly summaries
- [x] Archive completed work

## Phase 3: Planning, Prompting, and Release Support

- [~] Plugin-style checks - `run-check` can run package scripts or explicit commands; configurable check plugins remain open.
- [~] Visual check runner and artifact capture - generic command artifact capture exists; visual-specific handling remains open.
- [~] Artifact index and manual attachments - `run-check` writes `artifacts/checks/index.ndjson`; `verify --artifact` and `artifacts list/inspect` exist; retention/pruning remains open.
- [x] Path ownership map
- [x] Dependency graph output
- [x] PR handoff generator
- [~] Stale branch cleanup — `branches` reports dry-run cleanup candidates and can delete them with `--apply`; richer remote/PR checks remain open.
- [~] Session replay — recent journal/message context is included in `summarize`; dedicated `timeline` remains open.
- [ ] Per-repo onboarding checklist
- [ ] Agent prompt generator
- [x] Safe release gate
- [~] Workspace snapshots — `snapshot-workspace` writes compressed snapshots and command-layer apply flows take pre-mutation snapshots; legacy core lifecycle mutations remain open.
- [x] Lock diagnostics
- [ ] Multi-repo dashboard
- [x] Config migration
- [ ] Dry run for every mutation

## Phase 4: Verification, Risk, and GitHub Integration

- [~] Evidence attachments - verification logs can attach artifact metadata; richer artifact root policies and pruning remain open.
- [ ] Risk scoring
- [ ] Critical path planning
- [~] Merge queue awareness — `github-status` detects local merge_group workflow triggers; live queue state remains open.
- [ ] Contract files
- [~] Agent checklists — partially covered by `finish` verification/docs gates.
- [~] Human approval gates — partially covered by `finish` safety gates.
- [ ] Incident mode
- [~] Backlog importer — Markdown TODO import exists; GitHub issue import remains open.
- [~] GitHub integration — `github-status` detects GitHub remotes and optionally calls `gh pr view`; write/API integration remains open.
- [ ] State compaction
- [~] Agent SLA warnings — stale active work appears in `summarize`.
- [~] Ownership reviews — `ownership-review` flags broad claims and CODEOWNERS boundary crossings; periodic automation remains open.
- [~] Test impact selection — `test-impact` maps paths to configured checks; deeper dependency-aware selection remains open.
- [ ] Repo bootstrap profiles
- [~] Portable npm package — package shape and bin exist; publishing remains open.
- [ ] TUI dashboard
- [~] JSON API mode — available for key commands, not yet universal.
- [x] Policy packs

## Phase 5: Safety, Auditing, and Recovery

- [ ] Secrets and sensitive-data guardrails
- [ ] Command audit log
- [ ] State transactions
- [ ] Schema migrations for board state
- [ ] Concurrency stress tests
- [ ] Shell completions
- [~] Policy enforcement mode — partially covered by Git branch policy and finish gates.
- [~] CODEOWNERS integration — `ownership-review` reads CODEOWNERS-style files; claim-time enforcement remains open.
- [ ] Approval ledger
- [x] Release artifact bundle
- [~] Command aliases - built-in short aliases exist; repo-defined aliases remain open.
- [ ] Natural-language query
- [ ] Local web dashboard
- [ ] Signed releases
- [ ] Self-update safety

## Phase 6: Advanced Coordination and Scaling

- [ ] Workspace health score
- [ ] Partial checkout / monorepo support
- [ ] Task priority and deadlines
- [ ] Escalation routing
- [ ] Reusable runbooks
- [ ] Semantic path grouping
- [ ] Task split validator
- [ ] Work stealing
- [ ] Agent reputation/history
- [ ] Cost/time accounting
- [ ] Review queue
- [~] Artifact retention policy - `artifacts prune` supports dry-run/apply retention and protected active references; deeper storage policy and reporting remain open.
- [ ] Human-readable changelog
- [x] Task templates
- [ ] External calendar/reminder hooks
- [ ] Config inheritance
- [~] Multi-branch awareness — claims record Git branch metadata and `branches` reports task ownership by branch; cross-worktree awareness remains open.
- [ ] Offline mode
- [ ] Data privacy modes

## Phase 7: Documentation and Repo Polish

- [~] Expand the README into a full user guide — expanded, but deeper narrative documentation remains open.
- [x] Add a complete command reference
- [x] Add example workflows
- [x] Add terminal output examples
- [x] Add architecture documentation
- [x] Add state file reference
- [x] Add troubleshooting guide

## Phase 8: CLI Packaging, Naming, and Public Distribution

- [x] Rename package for npm compatibility
- [x] Add dedicated CLI entrypoint
- [x] Keep existing wrappers as compatibility aliases
- [~] Add version command — package and Node version exist; config/board schema version can be expanded.
- [~] Add installation documentation — basic docs exist; npm-published docs remain open.

## Phase 9: Watcher and Runtime Diagnostics

- [x] Add watcher diagnostics command
- [x] Add runtime cleanup command
- [x] Keep PowerShell watcher as legacy fallback
- [~] Add watcher failure recovery — partially covered by status/doctor/lock diagnostics; `watch-diagnose` remains open.

## Phase 10: Config Developer Experience

- [x] Add config explanation command
- [x] Add config doctor suggestions
- [x] Add environment override report

## Phase 11: Command UX Improvements

- [x] Add per-command help
- [~] Add consistent global flags — global parser supports the requested flags; verbose/quiet behavior can become richer.
- [ ] Add better error formatting
- [x] Add short command aliases
- [ ] Add interactive mode

## Phase 12: Board Repair, Inspection, and Rollback

- [x] Add board repair command
- [x] Add rollback command
- [x] Add board inspection command

## Phase 13: Git Safety Additions

- [x] Add branch safety policies
- [~] Add Git dubious ownership troubleshooting — README includes the fix; dedicated doctor detection remains open.
- [x] Add Git operation dry-run summaries

## Phase 14: Testing Improvements

- [x] Add fixture repos for testing
- [~] Add command snapshot tests — snapshot coverage exists for representative commands; broader command snapshots remain useful.
- [~] Add CLI argument parsing tests — partial coverage exists.
- [~] Add cross-platform path tests — partial coverage exists.

---

## Recently Completed Implementation Files

- `bin/ai-agents.mjs`
- `scripts/agent-command-layer.mjs`
- `scripts/bootstrap.mjs`
- `scripts/validate-config.mjs`
- `scripts/explain-config.mjs`
- `scripts/agent-watch-loop.mjs`
- `scripts/lock-runtime.mjs`
- `scripts/planner-sizing.mjs`
- `agent-coordination.schema.json`
- `.github/workflows/ci.yml`
- `package-lock.json`
- `.nvmrc`
- `.node-version`
- `docs/commands.md`
- `docs/explain-config.md`
- `docs/workflows.md`
- `docs/architecture.md`
- `docs/state-files.md`
- `docs/troubleshooting.md`
- `docs/terminal-output-examples.md`
- `docs/implementation-status.md`
