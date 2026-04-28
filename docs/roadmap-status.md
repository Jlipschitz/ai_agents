# AI Agents Roadmap Status

This file tracks the current implementation status for the larger roadmap in `ai_agents_roadmap.md`.

## Legend

- `[x]` complete enough for normal use
- `[~]` partially implemented, implemented through command-layer/helper scripts, or usable but still needing deeper core integration
- `[ ]` not started

## Current Focus

The project has completed most of the setup, bootstrap, command routing, CI, documentation, config explanation, command-layer diagnostics, board maintenance, artifact handling, dashboard surfaces, and safety-test foundation.

Next recommended work:

1. Continue normalizing older command-specific diagnostics.
2. Expand package publishing documentation and automation.
3. Add deeper GitHub write/API integration.

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
- [x] Visual check runner and artifact capture
- [~] Artifact index and manual attachments - `run-check` writes `artifacts/checks/index.ndjson`; `verify --artifact` and `artifacts list/inspect` exist; retention/pruning remains open.
- [x] Path ownership map
- [x] Dependency graph output
- [x] PR handoff generator
- [~] Stale branch cleanup — `branches` reports dry-run cleanup candidates and can delete them with `--apply`; richer remote/PR checks remain open.
- [x] Session replay
- [~] Per-repo onboarding checklist — `doctor` reports repo-doc onboarding recommendations; profile-specific checklist expansion remains open.
- [x] Agent prompt generator
- [x] Safe release gate
- [x] Workspace snapshots
- [x] Lock diagnostics
- [x] Multi-repo dashboard
- [x] Config migration
- [~] Dry run for every mutation - command-layer apply flows are dry-run by default, legacy core state mutations and process commands now support `--dry-run`; remaining follow-up is stricter coverage for external side-effect commands.

## Phase 4: Verification, Risk, and GitHub Integration

- [~] Evidence attachments - verification logs can attach artifact metadata; richer artifact root policies and pruning remain open.
- [x] Risk scoring
- [x] Critical path planning
- [~] Merge queue awareness — `github-status` detects local merge_group workflow triggers; live queue state remains open.
- [x] Contract files
- [~] Agent checklists — partially covered by `finish` verification/docs gates.
- [x] Human approval gates
- [x] Incident mode
- [~] Backlog importer — Markdown TODO import exists; GitHub issue import remains open.
- [~] GitHub integration — `github-status` detects GitHub remotes and optionally calls `gh pr view`; write/API integration remains open.
- [x] State compaction
- [~] Agent SLA warnings — stale active work appears in `summarize`.
- [~] Ownership reviews — `ownership-review` flags broad claims and CODEOWNERS boundary crossings; periodic automation remains open.
- [~] Test impact selection — `test-impact` maps paths to configured checks; deeper dependency-aware selection remains open.
- [x] Repo bootstrap profiles
- [~] Portable npm package — package shape and bin exist; publishing remains open.
- [x] TUI dashboard
- [~] JSON API mode — available for key commands, not yet universal.
- [x] Policy packs

## Phase 5: Safety, Auditing, and Recovery

- [x] Secrets and sensitive-data guardrails
- [~] Command audit log — command-layer apply flows and legacy core mutations append `runtime/audit.ndjson`; richer per-command details remain open.
- [~] State transactions - lock-protected core state mutations and command-layer multi-file apply flows restore prior state on write failure; external side effects such as Git branch deletion remain open.
- [x] Schema migrations for board state
- [x] Concurrency stress tests
- [x] Shell completions
- [x] Policy enforcement mode
- [x] CODEOWNERS integration
- [x] Approval ledger
- [x] Release artifact bundle
- [~] Command aliases - built-in short aliases exist; repo-defined aliases remain open.
- [~] Natural-language query — `ask` answers common deterministic board questions; open-ended model-backed querying remains open.
- [x] Local web dashboard
- [x] Signed releases
- [x] Self-update safety

## Phase 6: Advanced Coordination and Scaling

- [x] Workspace health score
- [x] Partial checkout / monorepo support
- [x] Task priority and deadlines
- [x] Escalation routing
- [x] Reusable runbooks
- [x] Semantic path grouping
- [x] Task split validator
- [x] Work stealing
- [x] Agent reputation/history
- [x] Cost/time accounting
- [x] Review queue
- [~] Artifact retention policy - `artifacts prune` supports dry-run/apply retention and protected active references; deeper storage policy and reporting remain open.
- [x] Human-readable changelog
- [x] Task templates
- [x] External calendar/reminder hooks
- [x] Config inheritance
- [~] Multi-branch awareness — claims record Git branch metadata and `branches` reports task ownership by branch; cross-worktree awareness remains open.
- [x] Offline mode
- [x] Data privacy modes

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
- [x] Add version command
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
- [~] Add better error formatting - top-level failures and common inline command-layer errors now use consistent text/JSON formatting; older command-specific diagnostic paths can still be normalized during future refactors.
- [x] Add short command aliases
- [x] Add interactive mode

## Phase 12: Board Repair, Inspection, and Rollback

- [x] Add board repair command
- [x] Add rollback command
- [x] Add board inspection command

## Phase 13: Git Safety Additions

- [x] Add branch safety policies
- [x] Add Git dubious ownership troubleshooting
- [x] Add Git operation dry-run summaries

## Phase 14: Testing Improvements

- [x] Add fixture repos for testing
- [~] Add command snapshot tests — snapshot coverage exists for representative commands; broader command snapshots remain useful.
- [~] Add CLI argument parsing tests — partial coverage exists.
- [~] Add cross-platform path tests — partial coverage exists.

## Phase 15: Developer Experience and Repo Maintenance

- [x] Add linting
- [x] Add formatting
- [x] Add type checking or JSDoc validation
- [x] Add contribution guide
- [x] Add security policy
- [x] Add license
- [x] Add examples directory

---

## Recently Completed Implementation Files

- `bin/ai-agents.mjs`
- `scripts/agent-command-layer.mjs`
- `scripts/agent-coordination-core.mjs`
- `scripts/bootstrap.mjs`
- `scripts/validate-config.mjs`
- `scripts/explain-config.mjs`
- `scripts/agent-watch-loop.mjs`
- `scripts/lock-runtime.mjs`
- `scripts/jsdoc-check.mjs`
- `scripts/lint.mjs`
- `scripts/planner-sizing.mjs`
- `scripts/lib/archive-commands.mjs`
- `scripts/lib/approval-ledger-commands.mjs`
- `scripts/lib/ask-commands.mjs`
- `scripts/lib/artifact-commands.mjs`
- `scripts/lib/audit-log.mjs`
- `scripts/lib/agent-history-commands.mjs`
- `scripts/lib/backlog-import-commands.mjs`
- `scripts/lib/board-maintenance.mjs`
- `scripts/lib/board-migration.mjs`
- `scripts/lib/branch-commands.mjs`
- `scripts/lib/calendar-commands.mjs`
- `scripts/lib/changelog-commands.mjs`
- `scripts/lib/claim-policy.mjs`
- `scripts/lib/completion-commands.mjs`
- `scripts/lib/contract-commands.mjs`
- `scripts/lib/cost-time-commands.mjs`
- `scripts/lib/critical-path-commands.mjs`
- `scripts/lib/dashboard-commands.mjs`
- `scripts/lib/error-formatting.mjs`
- `scripts/lib/format-commands.mjs`
- `scripts/lib/github-commands.mjs`
- `scripts/lib/global-flags.mjs`
- `scripts/lib/help-command.mjs`
- `scripts/lib/impact-commands.mjs`
- `scripts/lib/interactive-commands.mjs`
- `scripts/lib/install-manifest.mjs`
- `scripts/lib/monorepo-utils.mjs`
- `scripts/lib/onboarding-checklist.mjs`
- `scripts/lib/path-group-commands.mjs`
- `scripts/lib/policy-enforcement.mjs`
- `scripts/lib/prompt-commands.mjs`
- `scripts/lib/privacy-utils.mjs`
- `scripts/lib/publish-check-command.mjs`
- `scripts/lib/review-queue-commands.mjs`
- `scripts/lib/release-signing-commands.mjs`
- `scripts/lib/risk-score-commands.mjs`
- `scripts/lib/secrets-scan-commands.mjs`
- `scripts/lib/runtime-diagnostics.mjs`
- `scripts/lib/state-compaction-commands.mjs`
- `scripts/lib/state-transaction.mjs`
- `scripts/lib/template-commands.mjs`
- `scripts/lib/task-metadata.mjs`
- `scripts/lib/task-metadata-commands.mjs`
- `scripts/lib/task-split-validator.mjs`
- `scripts/lib/timeline-commands.mjs`
- `scripts/lib/update-commands.mjs`
- `scripts/lib/version-command.mjs`
- `scripts/lib/workspace-snapshot-commands.mjs`
- `agent-coordination.schema.json`
- `.github/workflows/ci.yml`
- `package-lock.json`
- `.nvmrc`
- `.node-version`
- `LICENSE`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `examples/README.md`
- `tests/archive-commands.test.mjs`
- `tests/agent-history-commands.test.mjs`
- `tests/approval-ledger.test.mjs`
- `tests/ask-commands.test.mjs`
- `tests/backlog-import-commands.test.mjs`
- `tests/bootstrap.test.mjs`
- `tests/calendar-commands.test.mjs`
- `tests/changelog-commands.test.mjs`
- `tests/command-layer.test.mjs`
- `tests/command-snapshots.test.mjs`
- `tests/completion-commands.test.mjs`
- `tests/config-validation.test.mjs`
- `tests/concurrency-stress.test.mjs`
- `tests/contract-commands.test.mjs`
- `tests/cost-time-commands.test.mjs`
- `tests/critical-path-commands.test.mjs`
- `tests/dashboard-commands.test.mjs`
- `tests/core-mutation-safety.test.mjs`
- `tests/error-formatting.test.mjs`
- `tests/examples.test.mjs`
- `tests/format-commands.test.mjs`
- `tests/git-policy.test.mjs`
- `tests/github-status.test.mjs`
- `tests/interactive-commands.test.mjs`
- `tests/incident-commands.test.mjs`
- `tests/lock-runtime.test.mjs`
- `tests/jsdoc-check.test.mjs`
- `tests/lint.test.mjs`
- `tests/path-group-commands.test.mjs`
- `tests/policy-enforcement.test.mjs`
- `tests/prompt-commands.test.mjs`
- `tests/publish-check-command.test.mjs`
- `tests/read-only-commands.test.mjs`
- `tests/release-signing-commands.test.mjs`
- `tests/review-queue-commands.test.mjs`
- `tests/risk-score-commands.test.mjs`
- `tests/secrets-scan-commands.test.mjs`
- `tests/roadmap-commands.test.mjs`
- `tests/state-compaction-commands.test.mjs`
- `tests/template-commands.test.mjs`
- `tests/task-metadata.test.mjs`
- `tests/timeline-commands.test.mjs`
- `tests/update-commands.test.mjs`
- `tests/version-command.test.mjs`
- `tests/workspace-snapshot-commands.test.mjs`
- `docs/commands.md`
- `docs/explain-config.md`
- `docs/workflows.md`
- `docs/architecture.md`
- `docs/state-files.md`
- `docs/troubleshooting.md`
- `docs/terminal-output-examples.md`
- `docs/implementation-status.md`
