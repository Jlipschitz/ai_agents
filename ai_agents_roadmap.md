# AI Agents Roadmap

This roadmap tracks planned improvements for `ai_agents`, from easier installation to safer multi-agent coordination, Git awareness, automation, and release support.

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

## Suggested Build Order

### Immediate Priorities

1. Bootstrap command
2. `doctor --fix`
3. Config JSON schema
4. Core tests
5. Cross-platform watcher
6. Package bin commands
7. Better Git awareness
8. `summarize --for-chat`
9. Single-command lifecycle
10. `--json` support
11. Visual check runner config model

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
