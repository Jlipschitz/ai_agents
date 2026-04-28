# AI Agents Roadmap

This roadmap tracks planned improvements for `ai_agents`, from easier installation to safer multi-agent coordination, Git awareness, automation, verification, dashboards, release support, and long-term package maturity.

---

## Phase 1: Core Setup and Bootstrap

- [ ] **Installer / bootstrap command**

  Add a command that can install the coordinator into another repo:

  ```bash
  npm run bootstrap -- --target C:\path\to\repo
  ```

  The bootstrap command should:

  - Copy required scripts
  - Add useful `package.json` scripts
  - Create starter config files
  - Update `.gitignore`
  - Run `doctor`

- [ ] **`doctor --fix`**

  Let `doctor` automatically fix common setup issues:

  - Add missing `.gitignore` entries
  - Create starter docs
  - Add missing `package.json` scripts
  - Create missing runtime folders/files where safe

- [ ] **JSON schema for config**

  Add:

  ```text
  agent-coordination.schema.json
  ```

  Validate:

  ```text
  agent-coordination.config.json
  ```

  Validation should return clear, actionable errors.

- [ ] **Focused tests**

  Add tests for:

  - Config validation
  - Planner lane sizing
  - Git status parsing
  - Lock behavior
  - Read-only commands not mutating runtime state

- [ ] **Cross-platform watcher**

  Replace the PowerShell watch-loop dependency with a Node watcher so macOS, Linux, and Windows work consistently.

- [ ] **Package install flow**

  Add `bin` entries so the tool can run like:

  ```bash
  npx github:Jlipschitz/ai_agents doctor
  ```

  Eventually:

  ```bash
  npx ai-agents doctor
  ```

- [ ] **Better Git awareness**

  Before agents claim work, check for:

  - Ahead/behind branch
  - Unpushed commits
  - Dirty worktree
  - Stale branch
  - Active merge/rebase state

- [ ] **Board summary/export**

  Add:

  ```bash
  summarize
  ```

  It should output a compact handoff with:

  - Active tasks
  - Blockers
  - Stale work
  - Next actions

---

## Phase 2: Task Lifecycle and Daily Workflow

- [ ] **Single-command task lifecycle**

  Add commands such as:

  ```bash
  start
  finish
  handoff-ready
  ```

  These should combine common sequences so agents do not forget to review docs, verify work, or update status transitions.

- [ ] **Agent capacity rules**

  Let config define:

  - Max active tasks per agent
  - Preferred domains per agent
  - Blocked-task limits

- [ ] **Conflict prediction**

  Before claim, inspect:

  - Current Git diff
  - Claimed paths
  - Existing task ownership

  Warn about likely merge conflicts.

- [ ] **Machine identity**

  Track in heartbeats:

  - Machine name
  - Repo path
  - Process/session identifier

- [ ] **Remote sync checks**

  Warn if the local branch is behind remote before planning or claiming.

- [ ] **`doctor --json`**

  Add machine-readable output for automation and CI.

- [ ] **CI workflow**

  Add a GitHub Action that runs:

  - Syntax checks
  - Config validation
  - Tests

- [ ] **Templates**

  Add config templates for:

  - Generic Node app
  - React app
  - Expo app
  - Supabase app
  - Docs-only repo

- [ ] **Import/update command**

  In a target repo, run one command to update the local copied coordinator from `ai_agents` while preserving:

  - Repo-specific config
  - Runtime state
  - Local docs

- [ ] **Conflict-safe resource leases**

  Add TTL renewal and explicit owner fields for resources:

  - Owner agent
  - Machine
  - Process/session
  - Expiration time

- [ ] **Transcript-friendly summaries**

  Add:

  ```bash
  summarize --for-chat
  ```

  It should output a compact status block that can be pasted into an agent/chat without dumping the whole board.

- [ ] **Archive completed work**

  Move old `done` or `released` tasks into archive files so `board.json` stays small and readable.

---

## Phase 3: Planning, Prompting, and Release Support

- [ ] **Plugin-style checks**

  Config can define custom checks such as:

  - `typecheck`
  - `unit`
  - `visual`
  - `lint`
  - `build`

  Each check should support:

  - Command
  - Timeout
  - Owning paths

- [ ] **Visual check runner and artifact capture**

  Add first-class visual verification support so the coordinator can run checks, capture evidence, and record artifact paths.

  Config additions:

  ```json
  {
    "checks": {
      "visual:test": {
        "command": "npm run visual:test",
        "timeoutMs": 120000,
        "artifactRoots": ["artifacts", "playwright-report", "test-results"],
        "requiredForPaths": ["app", "components", "features"],
        "requireArtifacts": true
      }
    },
    "artifacts": {
      "roots": ["artifacts", "playwright-report", "test-results"],
      "keepDays": 14,
      "keepFailedDays": 45,
      "maxMb": 500,
      "protectPatterns": ["**/baseline/**", "**/reference/**"]
    }
  }
  ```

  Implementation steps:

  1. Validate `checks` and `artifacts` in the config schema.
  2. Add `run-check <agent> <task-id> <check> [--allow-fail] [--json]`.
  3. Verify the agent owns the task before running a check.
  4. Snapshot configured artifact roots before the command runs.
  5. Run the configured command with timeout, exit-code capture, stdout capture, and stderr capture.
  6. Snapshot artifact roots after the command finishes.
  7. Diff the before/after snapshots to collect new or changed screenshots, traces, diffs, reports, and logs.
  8. Record a verification log entry with check name, outcome, duration, exit code, command, details, and artifact metadata.
  9. Keep the existing manual `verify` command working for checks that are run outside the coordinator.

  Verification record target shape:

  ```json
  {
    "check": "visual:test",
    "outcome": "pass",
    "details": "npm run visual:test exited 0",
    "durationMs": 83421,
    "exitCode": 0,
    "artifacts": [
      {
        "path": "artifacts/visual/run-2026-04-27/index.html",
        "kind": "report",
        "sizeBytes": 4281,
        "createdAt": "2026-04-27T12:00:00.000Z"
      }
    ],
    "at": "2026-04-27T12:00:00.000Z",
    "agent": "agent-1"
  }
  ```

- [ ] **Artifact index and manual attachments**

  Track artifacts independently from task logs so reports can be listed, inspected, pruned, and attached to existing verification records.

  Add an artifact index at `runtime/artifacts.json` or `artifacts/index.json`:

  ```json
  {
    "version": 1,
    "items": [
      {
        "path": "artifacts/visual/run-2026-04-27/index.html",
        "taskId": "task-ui",
        "check": "visual:test",
        "outcome": "pass",
        "sizeBytes": 4281,
        "createdAt": "2026-04-27T12:00:00.000Z",
        "lastReferencedAt": "2026-04-27T12:00:00.000Z",
        "protected": false
      }
    ]
  }
  ```

  Add commands:

  ```bash
  artifacts list [--task <task-id>] [--check <check>] [--json]
  artifacts inspect <artifact-path>
  verify <agent> <task-id> <check> <pass|fail> --artifact <path[,path...]>
  ```

  Implementation steps:

  1. Rebuild the artifact index from configured roots when it is missing.
  2. Cross-reference indexed artifacts with verification logs.
  3. Reject `verify --artifact` paths outside configured artifact roots unless `--allow-untracked-artifact` is passed.
  4. Reject missing artifact paths.
  5. Attach accepted artifact metadata to the verification log and artifact index.
  6. Include artifact paths in `status`, `summarize`, `summarize --for-chat`, and future `pr-summary` output when useful.

- [ ] **Path ownership map**

  Generate a map showing:

  - Which agent owns which paths
  - Overlapping ownership
  - Conflict warnings

- [ ] **Dependency graph output**

  Add:

  ```bash
  graph
  ```

  It should print tasks and dependencies in Mermaid format for docs or GitHub comments.

- [ ] **PR handoff generator**

  Add:

  ```bash
  pr-summary
  ```

  It should generate a PR-ready summary with:

  - Changes
  - Verification
  - Risks
  - Follow-ups

- [ ] **Stale branch cleanup**

  Detect:

  - Merged branches
  - Old coordination tasks
  - Stale runtime state

  Then suggest cleanup steps.

- [ ] **Session replay**

  Add:

  ```bash
  timeline
  ```

  It should reconstruct task progress from:

  - Journal
  - Messages
  - Board state

- [ ] **Per-repo onboarding checklist**

  `doctor` should recommend missing docs such as:

  - Architecture overview
  - Test instructions
  - Deployment notes
  - Visual workflow

- [ ] **Agent prompt generator**

  Add:

  ```bash
  prompt <agent>
  ```

  It should output exactly what that agent should know:

  - Assigned task
  - Claimed paths
  - Relevant docs
  - Dependencies
  - Verification expectations

- [ ] **Safe release gate**

  Add:

  ```bash
  release-check
  ```

  It should verify:

  - No active tasks
  - No stale locks
  - All done tasks have passing verification
  - Branch is pushed

- [ ] **Workspace snapshots**

  Before mutation commands, save compressed snapshots of:

  - Board
  - Journal
  - Messages
  - Runtime state

- [ ] **Lock diagnostics**

  Add:

  ```bash
  lock-status
  lock-clear --stale-only
  ```

  Humans should be able to inspect stuck locks safely.

- [ ] **Multi-repo dashboard**

  Scan multiple repos and show all active agent work across projects.

- [ ] **Config migration**

  Version the config and add:

  ```bash
  migrate-config
  ```

- [ ] **Dry run for every mutation**

  Support globally:

  ```bash
  --dry-run
  ```

  For commands like:

  - Claim
  - Release
  - Handoff
  - Recover
  - Finish
  - Archive

---

## Phase 4: Verification, Risk, and GitHub Integration

- [ ] **Evidence attachments**

  Let `verify` attach paths to:

  - Logs
  - Screenshots
  - Artifacts
  - Reports

- [ ] **Risk scoring**

  Planner should score tasks based on:

  - Shared files
  - Migrations
  - Auth
  - Billing
  - Deployment
  - UI breadth
  - Test gaps

- [ ] **Critical path planning**

  Planner should identify blocking tasks first and schedule parallel lanes around them.

- [ ] **Merge queue awareness**

  Detect open PRs and touched files. Warn if a new claim overlaps with in-flight PRs.

- [ ] **Contract files**

  For shared API/schema work, require a contract note before dependent agents start.

- [ ] **Agent checklists**

  Generate per-task checklists from config:

  - Docs reviewed
  - Tests run
  - Screenshots updated
  - Migration notes added
  - Deploy notes added

- [ ] **Human approval gates**

  Configurable approval gates for risky scopes like:

  - Auth
  - Payments
  - Production deploys
  - Migrations

- [ ] **Incident mode**

  Add a focused mode that:

  - Pauses normal planning
  - Assigns responders
  - Records incident timeline
  - Generates a postmortem

- [ ] **Backlog importer**

  Import backlog items from:

  - GitHub issues
  - Markdown TODOs

- [ ] **GitHub integration**

  Create or update:

  - Issues
  - PR comments
  - Labels
  - Checklists

  From coordination state.

- [ ] **State compaction**

  Summarize old journal/messages into durable notes, then prune noisy raw history.

- [ ] **Agent SLA warnings**

  Warn if an agent has been:

  - Blocked too long
  - Inactive too long
  - Assigned too much active scope

- [ ] **Ownership reviews**

  Periodically flag broad claimed paths like:

  ```text
  components/
  lib/
  src/
  ```

  Then ask agents to narrow ownership.

- [ ] **Test impact selection**

  Map changed paths to the smallest useful verification set.

- [ ] **Repo bootstrap profiles**

  Support:

  ```bash
  bootstrap --profile expo
  bootstrap --profile next
  bootstrap --profile node-cli
  ```

- [ ] **Portable npm package**

  Publish as a package with bin commands instead of copying scripts.

- [ ] **TUI dashboard**

  Terminal UI showing:

  - Agents
  - Tasks
  - Blockers
  - Claimed paths
  - Messages

- [ ] **JSON API mode**

  Every command should support:

  ```bash
  --json
  ```

- [ ] **Policy packs**

  Share reusable rules across repos, such as:

  - `strict-ui`
  - `backend-safe`
  - `docs-light`
  - `release-heavy`

---

## Phase 5: Safety, Auditing, and Recovery

- [ ] **Secrets and sensitive-data guardrails**

  Redact API keys/tokens from:

  - Notes
  - Journals
  - Messages
  - Logs
  - PR summaries

  Add a `doctor` check for accidental secrets in coordination state.

- [ ] **Command audit log**

  Record every mutation command with:

  - Actor
  - Machine
  - Current working directory
  - Git branch
  - Before/after summary
  - Timestamp

- [ ] **State transactions**

  Before mutating `board.json`, write a transaction log so recovery can replay or roll back cleanly after crashes.

- [ ] **Schema migrations for board state**

  Support migrations for:

  - `board.json`
  - Task docs
  - Message logs
  - Archive files
  - Runtime state

- [ ] **Concurrency stress tests**

  Simulate 10-50 parallel commands claiming, releasing, waiting, and verifying to prove locks are reliable.

- [ ] **Shell completions**

  Generate completions for:

  - PowerShell
  - Bash
  - Zsh

  Include completions for:

  - Commands
  - Agent IDs
  - Task IDs
  - Statuses
  - Checks

- [ ] **Policy enforcement mode**

  Config can mark rules as:

  - `warn`
  - `block`

  Example: block `done` if docs were not reviewed.

- [ ] **CODEOWNERS integration**

  Read `CODEOWNERS` or custom ownership files and warn when claimed paths cross ownership boundaries.

- [ ] **Approval ledger**

  Track human approvals for:

  - Risky tasks
  - Escalations
  - Migrations
  - Deploys
  - Destructive operations

- [ ] **Release artifact bundle**

  Export one release bundle containing:

  - Board summary
  - Verification logs
  - PR summary
  - Active risks
  - Deployment notes

- [ ] **Command aliases**

  Let repos define local aliases like:

  ```bash
  ship
  qa
  handoff-ui
  ```

  Mapped to standard commands.

- [ ] **Natural-language query**

  Support commands like:

  ```bash
  ask "what is blocked?"
  ask "who owns auth?"
  ask "what can agent-2 do next?"
  ```

- [ ] **Local web dashboard**

  Add a small local UI for:

  - Board
  - Graph
  - Messages
  - Ownership
  - Doctor results

- [ ] **Signed releases**

  If published as a package, publish tagged releases with checksums so target repos can safely update.

- [ ] **Self-update safety**

  Before import/update:

  - Show a diff
  - Preserve local config
  - Preserve local docs
  - Preserve runtime state

---

## Phase 6: Advanced Coordination and Scaling

- [ ] **Workspace health score**

  Add one numeric or graded summary from `doctor`, such as:

  - Clean
  - Degraded
  - Blocked
  - Unsafe

- [ ] **Partial checkout / monorepo support**

  Better handling for:

  - Workspaces inside subdirectories
  - `pnpm` / `yarn` / `npm` workspaces
  - Multiple packages
  - Partial checkouts

- [ ] **Task priority and deadlines**

  Add task fields for:

  - Priority
  - Due date
  - Severity
  - Escalation rules

- [ ] **Escalation routing**

  When blocked, automatically suggest who or what to ask based on:

  - Owned paths
  - Previous tasks
  - `CODEOWNERS`

- [ ] **Reusable runbooks**

  Configurable playbooks for:

  - Migrations
  - Auth changes
  - Releases
  - Incidents
  - Visual updates

- [ ] **Semantic path grouping**

  Group files by feature/module using:

  - Import graph
  - Package boundaries
  - Path prefixes

- [ ] **Task split validator**

  Before applying a plan, check whether it has:

  - Overlapping ownership
  - Bad dependencies
  - Missing verification
  - Overly broad claimed paths

- [ ] **Work stealing**

  Idle agents can safely pick stale or handoff-ready tasks based on:

  - Dependencies
  - Ownership rules
  - Capacity rules

- [ ] **Agent reputation/history**

  Track what each agent has worked on successfully to improve future assignments.

- [ ] **Cost/time accounting**

  Track:

  - Elapsed time per task
  - Blocked time
  - Review time
  - Verification time

- [ ] **Review queue**

  Add a dedicated review lifecycle separate from implementation:

  ```bash
  review-request
  review-claim
  review-complete
  ```

- [ ] **Artifact retention policy**

  Automatically prune old:

  - Logs
  - Screenshots
  - Snapshots
  - Temporary artifacts

  While keeping important evidence.

  Add commands:

  ```bash
  artifacts prune --dry-run
  artifacts prune --apply
  artifacts prune --task <task-id> --apply
  ```

  Retention rules:

  - Keep artifacts referenced by active, blocked, waiting, or review tasks.
  - Keep failed-check artifacts for `artifacts.keepFailedDays`.
  - Keep passing-check artifacts for `artifacts.keepDays`.
  - Never delete protected patterns.
  - Respect `artifacts.maxMb` by deleting oldest eligible artifacts first.
  - Print exact paths and bytes before deletion.
  - Require `--apply` before deleting anything.

  `doctor` enforcement:

  - Warn when configured artifact roots are missing.
  - Warn when artifact roots are not ignored by Git, unless explicitly protected.
  - Warn when artifact storage exceeds `artifacts.maxMb`.
  - Warn when verification records reference missing artifacts.
  - Warn when required visual checks passed without artifacts and `requireArtifacts` is true.

  Suggested tests:

  - `artifacts prune --dry-run` does not delete files.
  - `artifacts prune --apply` preserves active-task artifacts.
  - Failed-check artifacts survive longer than passed-check artifacts.
  - Protected patterns are never deleted.
  - Missing artifact references are reported by `doctor`.

- [ ] **Human-readable changelog**

  Generate a changelog from completed tasks and verification records.

- [ ] **Task templates**

  Add templates for common task types:

  - UI change
  - Migration
  - API endpoint
  - Test-only
  - Docs-only
  - Refactor

- [ ] **External calendar/reminder hooks**

  Optional reminders for:

  - Stale blocked work
  - Release checkpoints
  - Review deadlines

- [ ] **Config inheritance**

  Support:

  - Base config
  - Repo-specific overrides

- [ ] **Multi-branch awareness**

  Track coordination per branch, or prevent cross-branch state confusion.

- [ ] **Offline mode**

  Add an explicit mode that avoids GitHub/network checks and marks remote-derived checks as skipped.

- [ ] **Data privacy modes**

  Control how much task context is allowed into:

  - Summaries
  - Prompts
  - PR comments
  - External integrations

---

## Phase 7: Documentation and Repo Polish

- [ ] **Expand the README into a full user guide**

  Expand the README with:

  - What `ai_agents` does
  - When to use it
  - How the coordination board works
  - Difference between `agents` and `agents2`
  - Example workflows
  - Common commands
  - Troubleshooting
  - Recommended repo setup

- [ ] **Add a complete command reference**

  Create:

  ```text
  docs/commands.md
  ```

  Document every command, including:

  - Purpose
  - Syntax
  - Arguments
  - Flags
  - Examples
  - JSON output behavior
  - Mutation vs read-only behavior

- [ ] **Add example workflows**

  Create:

  ```text
  docs/workflows.md
  ```

  Include examples for:

  - Starting a new multi-agent session
  - Planning work
  - Claiming work
  - Marking work blocked
  - Handing off work
  - Verifying work
  - Finishing work
  - Recovering from stale locks
  - Moving coordination state between machines

- [ ] **Add terminal output examples**

  Add sample output for:

  - `doctor`
  - `status`
  - `plan`
  - `summarize`
  - `summarize --for-chat`
  - `lock-status`
  - `release-check`

- [ ] **Add architecture documentation**

  Create:

  ```text
  docs/architecture.md
  ```

  Explain:

  - Core script structure
  - Wrapper scripts
  - Runtime state files
  - Board format
  - Journal format
  - Message format
  - Locking model
  - Heartbeat model
  - Watcher model

- [ ] **Add state file reference**

  Create:

  ```text
  docs/state-files.md
  ```

  Document:

  - `board.json`
  - `journal.md`
  - `messages.ndjson`
  - `runtime/state.lock.json`
  - `runtime/watcher.status.json`
  - `runtime/agent-heartbeats/`
  - Artifact indexes
  - Archive files

- [ ] **Add troubleshooting guide**

  Create:

  ```text
  docs/troubleshooting.md
  ```

  Cover:

  - Stale locks
  - Broken JSON
  - Missing package scripts
  - Missing config
  - Wrong coordination folder
  - Watcher not starting
  - Heartbeat not updating
  - Agent claiming too much scope
  - Dirty Git state
  - Dubious Git ownership errors

---

## Phase 8: CLI Packaging, Naming, and Public Distribution

- [ ] **Rename package for npm compatibility**

  Consider renaming the package from:

  ```json
  {
    "name": "ai_agents"
  }
  ```

  To:

  ```json
  {
    "name": "ai-agents"
  }
  ```

- [ ] **Add dedicated CLI entrypoint**

  Add:

  ```text
  bin/ai-agents.mjs
  ```

  This should become the main public CLI entrypoint.

- [ ] **Keep existing wrappers as compatibility aliases**

  Keep:

  ```text
  scripts/agent-coordination.mjs
  scripts/agent-coordination-two.mjs
  ```

  But treat them as compatibility wrappers around the main CLI.

- [ ] **Add version command**

  Add:

  ```bash
  ai-agents --version
  ai-agents version
  ```

  Output should include:

  - Package version
  - Node version
  - Config version
  - Board schema version

- [ ] **Add installation documentation**

  Document supported install/run options:

  ```bash
  npx github:Jlipschitz/ai_agents doctor
  npm install github:Jlipschitz/ai_agents
  npm install -D github:Jlipschitz/ai_agents
  npx ai-agents doctor
  ```

---

## Phase 9: Watcher and Runtime Diagnostics

- [ ] **Add watcher diagnostics command**

  Add:

  ```bash
  ai-agents watch-diagnose
  ```

  It should report:

  - Watcher process status
  - PID
  - Last tick time
  - Coordination root
  - Config path
  - Last error
  - Suggested fix

- [ ] **Add runtime cleanup command**

  Add:

  ```bash
  ai-agents cleanup-runtime
  ```

  It should safely clean up:

  - Orphaned watcher status
  - Stale heartbeat files
  - Expired runtime locks
  - Temporary runtime files

- [ ] **Keep PowerShell watcher as legacy fallback**

  After adding the Node watcher, keep the PowerShell watcher for compatibility but make Node the default.

- [ ] **Add watcher failure recovery**

  If the watcher crashes or stops ticking, `doctor` should detect it and suggest:

  - Restart command
  - Stale watcher cleanup
  - Config path correction
  - Coordination root correction

---

## Phase 10: Config Developer Experience

- [ ] **Add config explanation command**

  Add:

  ```bash
  ai-agents explain-config
  ```

  It should explain:

  - What each config section does
  - Which values are defaults
  - Which values are invalid
  - Which paths do not exist
  - Which checks are configured
  - Which agents are available

- [ ] **Add config doctor suggestions**

  `doctor` should recommend config improvements, not just detect invalid config.

  Example warnings:

  - No docs root configured
  - No shared-risk paths configured
  - No verification checks configured
  - Visual paths configured but no visual checks configured
  - Too many agents for repo size
  - Missing templates for common repo type

- [ ] **Add environment override report**

  `doctor` and `explain-config` should show active overrides such as:

  - `AGENT_COORDINATION_CONFIG`
  - `AGENT_COORDINATION_ROOT`
  - `AGENT_COORDINATION_DIR`
  - `AGENT_COORDINATION_CLI_ENTRYPOINT`
  - `AGENT_COORDINATION_LOCK_WAIT_MS`
  - `AGENT_TERMINAL_ID`

---

## Phase 11: Command UX Improvements

- [ ] **Add per-command help**

  Every command should support:

  ```bash
  ai-agents <command> --help
  ```

- [ ] **Add consistent global flags**

  Support:

  ```bash
  --config
  --root
  --coordination-dir
  --verbose
  --quiet
  --no-color
  ```

  The roadmap already covers `--json` and `--dry-run`, but these additional global flags should be explicit.

- [ ] **Add better error formatting**

  Errors should include:

  - What failed
  - Why it failed
  - How to fix it
  - Example command

- [ ] **Add short command aliases**

  The roadmap includes repo-defined aliases, but also add built-in short aliases:

  ```bash
  ai-agents s
  ai-agents d
  ai-agents p
  ```

  For:

  - `status`
  - `doctor`
  - `plan`

- [ ] **Add interactive mode**

  Add:

  ```bash
  ai-agents interactive
  ```

  For guided use:

  - Pick an agent
  - Pick a task
  - Claim paths
  - Mark status
  - Run checks
  - Generate handoff

---

## Phase 12: Board Repair, Inspection, and Rollback

- [ ] **Add board repair command**

  Add:

  ```bash
  ai-agents repair-board
  ```

  It should detect and optionally fix:

  - Missing fields
  - Invalid statuses
  - Duplicate task IDs
  - Missing timestamps
  - Broken dependencies
  - Invalid claimed paths

- [ ] **Add rollback command**

  Add:

  ```bash
  ai-agents rollback-state
  ```

  It should restore from saved workspace snapshots.

- [ ] **Add board inspection command**

  Add:

  ```bash
  ai-agents inspect-board
  ```

  It should show:

  - Board version
  - Task count
  - Active tasks
  - Stale tasks
  - Invalid records
  - Archive status
  - Last mutation time

---

## Phase 13: Git Safety Additions

- [ ] **Add branch safety policies**

  Config should define whether agents may work on:

  - `main`
  - Feature branches
  - Release branches
  - Detached HEAD

  Example:

  ```json
  {
    "git": {
      "allowMainBranchClaims": false,
      "allowDetachedHead": false,
      "allowedBranchPatterns": ["feature/*", "agent/*", "fix/*"]
    }
  }
  ```

- [ ] **Add Git dubious ownership troubleshooting**

  Add a `doctor` check or troubleshooting note for Git errors like:

  ```text
  fatal: detected dubious ownership in repository
  ```

  Recommended fix example:

  ```bash
  git config --global --add safe.directory <repo-path>
  ```

- [ ] **Add Git operation dry-run summaries**

  Before commands that depend on Git state, report what Git information was checked:

  - Current branch
  - Upstream branch
  - Ahead/behind count
  - Dirty files
  - Untracked files
  - In-progress operation state

---

## Phase 14: Testing Improvements

- [ ] **Add fixture repos for testing**

  Create:

  ```text
  tests/fixtures/node-app/
  tests/fixtures/react-app/
  tests/fixtures/expo-app/
  tests/fixtures/docs-only/
  ```

- [ ] **Add command snapshot tests**

  Capture expected output for:

  - `doctor`
  - `status`
  - `plan`
  - `summarize`
  - `release-check`

- [ ] **Add CLI argument parsing tests**

  Test:

  - Missing args
  - Invalid flags
  - Unknown commands
  - Conflicting flags
  - `--json`
  - `--dry-run`
  - Path arguments on Windows/macOS/Linux

- [ ] **Add cross-platform path tests**

  Test Windows and POSIX path handling for:

  - Config paths
  - Claimed paths
  - Artifact paths
  - Coordination roots
  - Bootstrap targets
  - Git safe directory suggestions

---

## Phase 15: Developer Experience and Repo Maintenance

- [ ] **Add linting**

  Add:

  ```bash
  npm run lint
  ```

- [ ] **Add formatting**

  Add:

  ```bash
  npm run format
  ```

- [ ] **Add type checking or JSDoc validation**

  Even if the project stays in plain JavaScript, add stronger validation using:

  - JSDoc
  - TypeScript check mode
  - Runtime schemas

- [ ] **Add contribution guide**

  Create:

  ```text
  CONTRIBUTING.md
  ```

- [ ] **Add security policy**

  Create:

  ```text
  SECURITY.md
  ```

- [ ] **Add license**

  Create:

  ```text
  LICENSE
  ```

- [ ] **Add examples directory**

  Create:

  ```text
  examples/
  ```

  Suggested examples:

  - `examples/node-app`
  - `examples/react-app`
  - `examples/expo-app`
  - `examples/docs-only`

---

## Suggested Build Order

### Immediate Priorities

1. Bootstrap command
2. `doctor --fix`
3. Config JSON schema
4. Core tests
5. Cross-platform Node watcher
6. Package bin commands
7. Better Git awareness
8. `summarize --for-chat`
9. Single-command lifecycle
10. `--json` support
11. Visual check runner config model
12. Expanded README
13. Complete command reference
14. Dedicated CLI entrypoint
15. Per-command help

### Next Priorities

1. Agent capacity rules
2. Conflict prediction
3. Machine identity
4. Remote sync checks
5. CI workflow
6. Templates
7. Import/update command
8. Lock diagnostics
9. Dry-run support
10. PR summary generator
11. Visual check runner and artifact attachment
12. Artifact retention dry-run/apply
13. Watcher diagnostics
14. Config explanation command
15. Board repair command
16. Git branch safety policies

### Later / Advanced

1. GitHub integration
2. TUI dashboard
3. Local web dashboard
4. Natural-language query
5. Incident mode
6. Release artifact bundles
7. Multi-repo dashboard
8. Policy packs
9. Work stealing
10. Agent reputation/history
11. Interactive mode
12. Rollback command
13. Public npm release
14. Signed releases
15. Long-term examples and templates
