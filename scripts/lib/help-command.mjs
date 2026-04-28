import { printCommandError } from './error-formatting.mjs';

const COMMANDS = {
  help: ['help [command]', 'Show general help or command-specific help.'],
  init: ['init', 'Create the coordination board, journal, messages, and runtime folders.'],
  status: ['status', 'Show active, blocked, review, waiting, handoff, planned, and stale work.'],
  summarize: ['summarize [--json] [--for-chat]', 'Print a transcript-friendly board summary.'],
  validate: ['validate [--json]', 'Validate the board and config.'],
  doctor: ['doctor [--json] [--fix]', 'Inspect coordination health and optionally apply safe setup fixes.'],
  plan: ['plan <goal> [--apply] [--git-changes]', 'Split a goal into planned agent tasks.'],
  claim: ['claim <agent> <task-id> --paths <path[,path...]> [--summary <text>] [--force]', 'Claim work for an agent with Git, capacity, and conflict checks.'],
  start: ['start <agent> <task-id> --paths <path[,path...]> <summary>', 'Claim work and record the starting summary as progress.'],
  finish: ['finish <agent> <task-id> [--require-verification] [--require-doc-review] <note>', 'Mark a task done through lifecycle safety gates.'],
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
  graph: ['graph [--json]', 'Print task dependencies as Mermaid or JSON.'],
  'ownership-map': ['ownership-map [--json]', 'Show active path ownership and overlaps.'],
  'inspect-board': ['inspect-board [--json]', 'Inspect board structure and task counts.'],
  'repair-board': ['repair-board [--apply] [--json]', 'Apply safe board repairs.'],
  'rollback-state': ['rollback-state --list|--to <snapshot> [--apply] [--json]', 'List or restore board snapshots.'],
  'migrate-config': ['migrate-config [--apply] [--json]', 'Add current optional config defaults.'],
  'policy-packs': ['policy-packs <list|show|apply> [pack] [--apply] [--json]', 'Inspect or apply reusable policy packs.'],
  branches: ['branches [--json] [--base <ref>] [--stale-days <days>] [--apply]', 'Report branch/task awareness and dry-run stale branch cleanup.'],
  'ownership-review': ['ownership-review [--json]', 'Review active claims for broad paths and CODEOWNERS boundary crossings.'],
  'test-impact': ['test-impact [--paths <path[,path...]>] [--json]', 'Select the smallest configured verification checks for changed paths.'],
  'github-status': ['github-status [--json] [--live]', 'Inspect GitHub remote, branch, PR, and merge queue workflow status.'],
  templates: ['templates list|show <name>|apply <config-template>|create-task <task-template> [--apply] [--json]', 'List, inspect, apply config templates, or create planned tasks from templates.'],
  'archive-completed': ['archive-completed [--older-than-days <days>] [--apply] [--json]', 'Archive old done/released tasks out of board.json.'],
  'update-coordinator': ['update-coordinator [--source <path>] [--include-docs] [--apply] [--json]', 'Update copied coordinator files while preserving config and runtime state.'],
  'snapshot-workspace': ['snapshot-workspace [--apply] [--json]', 'Write a compressed snapshot of board, journal, messages, and runtime state.'],
  'backlog-import': ['backlog-import [--from <path[,path...]>] [--owner <agent>] [--apply] [--json]', 'Import Markdown TODOs as planned tasks.'],
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
