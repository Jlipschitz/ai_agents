import { printCommandError } from './error-formatting.mjs';

export const COMMANDS = {
  help: ['help [command]', 'Show general help or command-specific help.'],
  init: ['init', 'Create the coordination board, journal, messages, and runtime folders.'],
  status: ['status', 'Show active, blocked, review, waiting, handoff, planned, and stale work.'],
  summarize: ['summarize [--json] [--for-chat]', 'Print a transcript-friendly board summary.'],
  validate: ['validate [--json]', 'Validate the board and config.'],
  doctor: ['doctor [--json] [--fix]', 'Inspect coordination health and optionally apply safe setup fixes.'],
  plan: ['plan <goal> [--apply] [--git-changes]', 'Split a goal into planned agent tasks.'],
  prompt: ['prompt <agent-id> [task-id] [--json]', 'Generate copy-ready context for an agent assignment.'],
  ask: ['ask "<question>" [--json]', 'Answer common coordination questions from the board.'],
  claim: ['claim <agent> <task-id> --paths <path[,path...]> [--summary <text>] [--priority <level>] [--due-at <date>] [--severity <level>] [--force]', 'Claim work for an agent with Git, capacity, conflict checks, and optional priority metadata.'],
  prioritize: ['prioritize <task-id> [--priority <level>] [--due-at <date|none>] [--severity <level>] [--by <agent>] [--json] [--dry-run]', 'Update task priority, due date, or severity metadata.'],
  start: ['start <agent> <task-id> --paths <path[,path...]> [--priority <level>] [--due-at <date>] [--severity <level>] <summary>', 'Claim work and record the starting summary as progress.'],
  finish: ['finish <agent> <task-id> [--require-verification] [--require-doc-review] [--require-approval] [--approval-scope <scope>] <note>', 'Mark a task done through lifecycle safety gates.'],
  'handoff-ready': ['handoff-ready <agent> <task-id> <note>', 'Mark a task ready for handoff.'],
  pick: ['pick <agent>', 'Suggest the next planned task for an agent.'],
  progress: ['progress <agent> <task-id> <note>', 'Record a progress note.'],
  wait: ['wait <agent> <task-id> --on <task-id[,task-id...]> --reason <text>', 'Mark a task waiting on dependencies.'],
  resume: ['resume <agent> <task-id> <note>', 'Resume a waiting or blocked task.'],
  blocked: ['blocked <agent> <task-id> <note>', 'Mark a task blocked.'],
  review: ['review <agent> <task-id> <note>', 'Mark a task ready for review.'],
  done: ['done <agent> <task-id> <note>', 'Mark a task done.'],
  release: ['release <agent> <task-id> [--note <text>]', 'Mark a done task released.'],
  verify: ['verify <agent> <task-id> <check> <pass|fail> [--details <text>] [--artifact <path[,path...]>]', 'Record verification evidence.'],
  approvals: ['approvals list|check|request|grant|deny|use [options]', 'Track human or coordinator approvals for tasks and lifecycle gates.'],
  'review-docs': ['review-docs <agent> <task-id> [--docs <path[,path...]>] [--note <text>]', 'Record docs review for a task.'],
  heartbeat: ['heartbeat <agent> [--interval <ms>]', 'Run an agent heartbeat loop.'],
  'heartbeat-start': ['heartbeat-start <agent> [--interval <ms>]', 'Start a background heartbeat.'],
  'heartbeat-stop': ['heartbeat-stop <agent>', 'Stop a background heartbeat.'],
  'heartbeat-status': ['heartbeat-status [agent]', 'Show heartbeat status.'],
  watch: ['watch', 'Run the watcher loop.'],
  'watch-start': ['watch-start [--interval <ms>]', 'Start the Node watcher.'],
  'watch-stop': ['watch-stop', 'Stop the watcher.'],
  'watch-status': ['watch-status', 'Show watcher status.'],
  'watch-diagnose': ['watch-diagnose [--json]', 'Diagnose watcher, lock, and heartbeat runtime state.'],
  'cleanup-runtime': ['cleanup-runtime [--apply] [--json]', 'Clean stale runtime lock, watcher, and heartbeat files.'],
  'lock-status': ['lock-status [--json]', 'Inspect runtime lock state.'],
  'lock-clear': ['lock-clear --stale-only|--force [--json]', 'Clear a stale or forced runtime lock.'],
  'run-check': ['run-check <script-name>|<check-name> [--task <id>] [--json] [--dry-run] [-- <command...>]', 'Run a configured check and capture artifacts.'],
  artifacts: ['artifacts <list|inspect|prune> [options]', 'List, inspect, or prune verification artifacts.'],
  'release-check': ['release-check [task-id...] [--json] [--require-doc-review]', 'Check whether tasks are ready for release.'],
  'release-bundle': ['release-bundle [task-id...] [--apply] [--json]', 'Generate release handoff artifacts.'],
  'pr-summary': ['pr-summary [task-id...] [--json]', 'Generate PR-ready handoff notes.'],
  changelog: ['changelog [--since YYYY-MM-DD] [--json]', 'Generate a human-readable changelog from completed and released tasks.'],
  graph: ['graph [--json]', 'Print task dependencies as Mermaid or JSON.'],
  'ownership-map': ['ownership-map [--json]', 'Show active path ownership and overlaps.'],
  'inspect-board': ['inspect-board [--json]', 'Inspect board structure and task counts.'],
  'repair-board': ['repair-board [--apply] [--json]', 'Apply safe board repairs.'],
  'migrate-board': ['migrate-board [--apply] [--json]', 'Migrate board.json to the current board schema version.'],
  'rollback-state': ['rollback-state --list|--to <snapshot> [--apply] [--json]', 'List or restore board snapshots.'],
  'compact-state': ['compact-state [--keep-journal-lines <n>] [--keep-message-lines <n>] [--apply] [--json]', 'Archive old journal and message lines while keeping recent context.'],
  'migrate-config': ['migrate-config [--apply] [--json]', 'Add current optional config defaults.'],
  'policy-packs': ['policy-packs <list|show|apply> [pack] [--apply] [--json]', 'Inspect or apply reusable policy packs.'],
  'policy-check': ['policy-check [--json]', 'Evaluate configured warn/block policy enforcement rules against active work.'],
  branches: ['branches [--json] [--base <ref>] [--stale-days <days>] [--apply]', 'Report branch/task awareness and dry-run stale branch cleanup.'],
  'ownership-review': ['ownership-review [--json]', 'Review active claims for broad paths and CODEOWNERS boundary crossings.'],
  'test-impact': ['test-impact [--paths <path[,path...]>] [--json]', 'Select the smallest configured verification checks for changed paths.'],
  'risk-score': ['risk-score [task-id...] [--json]', 'Score task risk from ownership, dependencies, verification, docs, and metadata.'],
  'critical-path': ['critical-path [--json]', 'Find the longest remaining dependency chain and ready critical work.'],
  'health-score': ['health-score [--fail-under <score>] [--json]', 'Score workspace health from setup, work risk, verification, and runtime state.'],
  'agent-history': ['agent-history [agent-id...] [--limit <count>] [--stale-hours <hours>] [--json]', 'Summarize per-agent history, reputation, verification, docs review, handoff, and stale-work signals.'],
  'cost-time': ['cost-time [task-id...] [--agent <id[,id...]>] [--task <id[,id...]>] [--from <date>] [--to <date>] [--rate <number>] [--currency <code>] [--json]', 'Report task and per-agent estimated hours, observed activity spans, open age, and optional cost.'],
  'review-queue': ['review-queue [list|claim <task-id>|complete <task-id>] [--agent <id>] [--outcome approve|changes-requested|commented] [--apply] [--json]', 'List, claim, and complete task review queue entries with review metadata and audit logs.'],
  'secrets-scan': ['secrets-scan [--paths <path[,path...]>] [--staged] [--strict] [--json]', 'Scan tracked, staged, or selected files for likely secrets and sensitive tokens.'],
  contracts: ['contracts list|show <id>|create <id>|check [options]', 'Manage contract files for shared API, schema, and cross-task interfaces.'],
  runbooks: ['runbooks list|show <id>|suggest|create <id> [options]', 'List, suggest, or create reusable coordination runbooks.'],
  'path-groups': ['path-groups [--paths <path[,path...]>] [--json]', 'Group paths by package boundary, module prefix, and import relationships.'],
  'split-validate': ['split-validate [--task <id>] [--board <path>] [--strict] [--json]', 'Validate a task split for overlap, dependencies, verification, and broad paths.'],
  'escalation-route': ['escalation-route [--task <id>] [--paths <path[,path...]>] [--reason <text>] [--json]', 'Suggest who to ask for blocked work from active owners, previous tasks, and CODEOWNERS.'],
  'steal-work': ['steal-work <agent-id>|--agent <agent-id> [--task <id>] [--stale-hours <n>] [--apply] [--json]', 'Suggest or apply safe work stealing for idle agents.'],
  'github-status': ['github-status [--json] [--live]', 'Inspect GitHub remote, branch, PR, and merge queue workflow status.'],
  templates: ['templates list|show <name>|apply <config-template>|create-task <task-template> [--apply] [--json]', 'List, inspect, apply config templates, or create planned tasks from templates.'],
  'archive-completed': ['archive-completed [--older-than-days <days>] [--apply] [--json]', 'Archive old done/released tasks out of board.json.'],
  'update-coordinator': ['update-coordinator [--source <path>] [--include-docs] [--apply] [--json]', 'Update copied coordinator files while preserving config and runtime state.'],
  'snapshot-workspace': ['snapshot-workspace [--apply] [--json]', 'Write a compressed snapshot of board, journal, messages, and runtime state.'],
  'backlog-import': ['backlog-import [--from <path[,path...]>] [--owner <agent>] [--apply] [--json]', 'Import Markdown TODOs as planned tasks.'],
  completions: ['completions <powershell|bash|zsh> [--json]', 'Generate shell completion scripts for this repo.'],
  'explain-config': ['explain-config [--json] [--config <path>] [--root <path>]', 'Explain active config and environment overrides.'],
  'request-access': ['request-access <agent> <task-id> <scope> <reason>', 'Request shared resource or elevated operation access.'],
  'grant-access': ['grant-access <request-id> [--by <agent>] [--note <text>]', 'Grant an access request.'],
  'deny-access': ['deny-access <request-id> [--by <agent>] [--note <text>]', 'Deny an access request.'],
  'complete-access': ['complete-access <request-id> [--by <agent>] [--note <text>]', 'Mark granted access complete.'],
  'start-incident': ['start-incident <agent> <incident-key> <summary> [--resource <name>] [--task <task-id>]', 'Open an incident coordination record.'],
  'join-incident': ['join-incident <agent> <incident-key> [--task <task-id>]', 'Join an open incident.'],
  'close-incident': ['close-incident <agent> <incident-key> <resolution>', 'Close an incident.'],
  'reserve-resource': ['reserve-resource <agent> <resource> <reason> [--task <task-id>] [--ttl-minutes <minutes>]', 'Reserve a shared resource with lease metadata.'],
  'renew-resource': ['renew-resource <agent> <resource> [--ttl-minutes <minutes>] [--reason <text>]', 'Renew a held resource lease.'],
  'release-resource': ['release-resource <agent> <resource>', 'Release a shared resource.'],
  message: ['message <from-agent> <to-agent|all> <message> [--task <task-id>]', 'Send an agent coordination message.'],
  'app-note': ['app-note <agent> <category> <note> [--task <task-id>] [--paths <path[,path...]>]', 'Append a maintained app note.'],
  inbox: ['inbox <agent> [--limit <count>]', 'Read recent messages for an agent.'],
  recover: ['recover [--apply]', 'Report or apply stale task/resource/incident recovery.'],
};

const GLOBAL_FLAGS = [
  '--config <path>',
  '--root <path>',
  '--coordination-dir <dir>',
  '--coordination-root <path>',
  '--verbose',
  '--quiet',
  '--no-color',
];

export function hasHelpFlag(argv) {
  return argv.includes('--help') || argv.includes('-h');
}

export function runCommandHelp(commandName, argv, { cli = 'agents' } = {}) {
  const target = commandName === 'help' && argv[0] ? argv[0] : commandName;
  const entry = COMMANDS[target];

  if (!entry) {
    return printCommandError(`No help entry for "${target}". Run "${cli} -- help" for the full command list.`, { json: argv.includes('--json') });
  }

  const [usage, summary] = entry;
  console.log(`${target}\n\nUsage:\n  ${cli} -- ${usage}\n\n${summary}\n\nGlobal flags:\n  ${GLOBAL_FLAGS.join('\n  ')}`);
  return 0;
}
