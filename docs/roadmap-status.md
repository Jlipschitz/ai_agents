# AI Agents Roadmap Status

This file tracks the current implementation status for the larger roadmap in `ai_agents_roadmap.md`.

## Legend

- `[x]` complete enough for normal use
- `[!]` external or parent-integration blocked after local implementation

## Current Focus

The project has completed the code-owned roadmap items across setup, bootstrap, command routing, CI, documentation, config explanation, command-layer diagnostics, board maintenance, artifact handling, dashboard surfaces, safety tests, GitHub planning/writes, and release readiness checks.

Remaining external or integration work:

1. Decide whether this fork should publish `ai-agents` to npm, remove `private: true` only as part of that release decision, and perform the actual registry publish outside the local codebase.
2. After parent integration, refresh these status docs if the parent branch adds, removes, or renames roadmap items.

---

## Phase 1: Core Setup and Bootstrap

- [x] Installer / bootstrap command
- [x] `doctor --fix` — implemented through the command layer and routed by the public entrypoints.
- [x] JSON schema for config
- [x] Focused tests
- [x] Cross-platform watcher
- [!] Package install flow — package/bin flow and `npx` install docs exist; actual public npm publishing is blocked on an external release decision and registry publish.
- [x] Better Git awareness — pre-claim Git preflight, ahead/behind reporting, branch cleanup, and GitHub status checks exist.
- [x] Board summary/export

## Phase 2: Task Lifecycle and Daily Workflow

- [x] Single-command task lifecycle — `start`, `finish`, and `handoff-ready` exist with verification/docs/approval gates.
- [x] Agent capacity rules — claim-time active/blocked/domain gates exist, and planner lane sizing is wired into `plan`.
- [x] Conflict prediction — claim-time local Git overlap detection and ownership review checks exist.
- [x] Machine identity — terminal/session/process metadata is recorded in runtime heartbeats and leases.
- [x] Remote sync checks — ahead/behind warnings are reported before claims and in GitHub/branch status commands.
- [x] `doctor --json` — implemented through the command layer and routed by the public entrypoints.
- [x] CI workflow
- [x] Templates — config templates and task templates are available through `templates`.
- [x] Import/update command
- [x] Conflict-safe resource leases — resource reservations include TTL, owner machine/process/session metadata, renewal, and expired lease takeover.
- [x] Transcript-friendly summaries
- [x] Archive completed work

## Phase 3: Planning, Prompting, and Release Support

- [x] Plugin-style checks - `run-check` can run package scripts or explicit commands from config.
- [x] Visual check runner and artifact capture
- [x] Artifact index and manual attachments - `run-check` writes `artifacts/checks/index.ndjson`; `verify --artifact`, `artifacts list/inspect`, missing-reference reports, `artifacts rebuild-index`, and retention policy commands exist.
- [x] Path ownership map
- [x] Dependency graph output
- [x] PR handoff generator
- [x] Stale branch cleanup — `branches` reports dry-run cleanup candidates and can delete safe candidates with `--apply`.
- [x] Session replay
- [x] Per-repo onboarding checklist - `doctor` reports repo-doc, profile-specific, and custom config onboarding recommendations.
- [x] Agent prompt generator
- [x] Safe release gate
- [x] Workspace snapshots
- [x] Lock diagnostics
- [x] Multi-repo dashboard
- [x] Config migration
- [x] Dry run for every mutation - command-layer apply flows are dry-run by default, legacy core state mutations and process commands support `--dry-run`, and external side-effect commands require explicit apply/live flags.

## Phase 4: Verification, Risk, and GitHub Integration

- [x] Evidence attachments - verification logs can attach artifact metadata, and artifact listing, inspection, missing-reference reporting, rebuild, and pruning commands exist.
- [x] Risk scoring
- [x] Critical path planning
- [x] Merge queue awareness — `github-status` detects local `merge_group` workflow triggers and can report live PR metadata through `gh pr view` when the external GitHub CLI/auth environment is available.
- [x] Contract files
- [x] Agent checklists — covered by `finish` verification/docs/approval gates and checklist-style handoff outputs.
- [x] Human approval gates
- [x] Incident mode
- [x] Backlog importer - Markdown TODO and GitHub issue import exist, and GitHub issue follow-up is handled through `github-plan`.
- [x] GitHub integration — `github-status` detects GitHub remotes and optionally calls `gh pr view`; `github-plan` plans PR/issue comments, labels, and checklist comments, checks apply readiness, and can execute writes only with `--apply --live-write` plus passing external GitHub CLI/auth prerequisites.
- [x] State compaction
- [x] Agent SLA warnings — stale active work appears in `summarize`.
- [x] Ownership reviews — `ownership-review` flags broad claims and CODEOWNERS boundary crossings.
- [x] Test impact selection — `test-impact` maps changed paths to configured checks and semantic groups.
- [x] Repo bootstrap profiles
- [!] Portable npm package — package shape, bin, install docs, and publish readiness commands exist; actual npm publication remains outside this codebase and is currently blocked until release ownership removes `private: true` for a publish candidate.
- [x] Terminal/static dashboard - read-only terminal output and static local HTML dashboard output exist.
- [x] JSON API mode — supported across the command surfaces that expose machine-readable output and covered by registry-accounted contract tests.
- [x] Policy packs

## Phase 5: Safety, Auditing, and Recovery

- [x] Secrets and sensitive-data guardrails
- [x] Command audit log — command-layer apply flows and legacy core mutations append `runtime/audit.ndjson`.
- [x] State transactions - lock-protected core state mutations and command-layer multi-file apply flows restore prior local state on write failure; external side effects are guarded by explicit apply/live flags.
- [x] Schema migrations for board state
- [x] Concurrency stress tests
- [x] Shell completions
- [x] Policy enforcement mode
- [x] CODEOWNERS integration
- [x] Approval ledger
- [x] Release artifact bundle
- [x] Command aliases - built-in and repo-defined command aliases are supported.
- [x] Natural-language query - `ask` answers deterministic board questions and supports opt-in local provider commands for open-ended answers.
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
- [x] Artifact retention policy - `artifacts prune` supports dry-run/apply retention and protected active references; missing verification artifact reporting exists.
- [x] Human-readable changelog
- [x] Task templates
- [x] Calendar/reminder export - local iCalendar export includes reminder alarms.
- [x] Config inheritance
- [x] Multi-branch awareness — claims record Git branch metadata and `branches` reports task ownership by branch.
- [x] Offline mode
- [x] Data privacy modes

## Phase 7: Documentation and Repo Polish

- [x] Expand the README into a full user guide
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
- [!] Add installation documentation — local, GitHub `npx`, and npm package flows are documented; published npm install verification is blocked until an actual npm release exists.

## Phase 9: Watcher and Runtime Diagnostics

- [x] Add watcher diagnostics command
- [x] Add runtime cleanup command
- [x] Keep PowerShell watcher as legacy fallback
- [x] Add watcher failure recovery — `watch-diagnose` reports stale heartbeat details and `cleanup-runtime` reports/applies explicit stale-runtime recovery actions.

## Phase 10: Config Developer Experience

- [x] Add config explanation command
- [x] Add config doctor suggestions
- [x] Add environment override report

## Phase 11: Command UX Improvements

- [x] Add per-command help
- [x] Add consistent global flags — global parser supports the requested flags, including verbose, quiet, no-color, config, root, and coordination-root handling.
- [x] Add better error formatting - top-level failures and common inline command-layer errors use consistent text/JSON formatting, including contract lookup/usage errors and standalone config-validator exceptions.
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
- [x] Add command snapshot tests — snapshot coverage exists for representative commands and is paired with registry-accounted JSON/read-only contract coverage.
- [x] Add CLI argument parsing tests
- [x] Add cross-platform path tests

## Phase 15: Developer Experience and Repo Maintenance

- [x] Add linting
- [x] Add formatting
- [x] Add type checking or JSDoc validation
- [x] Add contribution guide
- [x] Add security policy
- [x] Add license
- [x] Add examples directory

## Phase 16: Command Registry, Contracts, and Agent Handoff

- [x] Central command registry - registry metadata, command groups, minimal-mode membership, JSON-capable command markers, and shared package-script manifest exist.
- [x] Doctor command wiring validation - `doctor --json` validates package-script command targets and reports registry group/minimal/JSON coverage metadata.
- [x] End-to-end CLI smoke tests - temp-repo bootstrap smoke runner covers representative commands and accounts for every minimal registry command.
- [x] Fixture-board generator
- [x] Command output contract tests - high-value JSON shape checks, registry-accounted generic JSON contracts, and explicit omission reasons exist.
- [x] Agent handoff bundle
- [x] Next command recommendation engine
- [x] State size budget - `state-size` reports coordination file sizes and cleanup recommendations.
- [x] Upgrade and migration compatibility tests
- [x] Security and privacy redaction checks - `redact-check` scans coordination state and generated prompt/handoff/task-summary text; GitHub apply readiness blocks unredacted sensitive planned writes.
- [x] Generated repo health status file
- [x] Minimal mode and command groups

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
