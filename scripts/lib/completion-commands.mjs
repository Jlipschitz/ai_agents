import { getPositionals, hasFlag } from './args-utils.mjs';
import { printCommandError } from './error-formatting.mjs';
import { COMMANDS } from './help-command.mjs';

const SHELLS = ['powershell', 'bash', 'zsh'];
const STATUSES = ['planned', 'active', 'blocked', 'waiting', 'review', 'handoff', 'done', 'released'];
const COMMON_FLAGS = ['--json', '--help', '--config', '--root', '--coordination-dir', '--coordination-root', '--verbose', '--quiet', '--no-color', '--apply', '--force', '--strict', '--check', '--staged', '--all', '--keep-journal-lines', '--keep-message-lines', '--limit', '--stale-hours', '--fail-under', '--from', '--to', '--rate', '--currency', '--outcome', '--priority', '--due-at', '--due', '--severity', '--approval-scope', '--scope', '--status', '--task', '--agent', '--board', '--by', '--owner', '--producer', '--consumer', '--consumers', '--summary', '--reason', '--note', '--title', '--keywords', '--paths', '--steps', '--checks', '--docs', '--out', '--reminder-minutes', '--dir', '--private-key', '--public-key', '--verify', '--sign'];
const AGENT_COMMANDS = new Set([
  'claim',
  'start',
  'finish',
  'handoff-ready',
  'pick',
  'progress',
  'wait',
  'resume',
  'blocked',
  'review',
  'done',
  'release',
  'verify',
  'review-docs',
  'prompt',
  'agent-history',
  'inbox',
  'heartbeat',
  'heartbeat-start',
  'heartbeat-stop',
  'message',
  'app-note',
  'request-access',
  'reserve-resource',
  'renew-resource',
  'release-resource',
]);
const TASK_COMMANDS = new Set([
  'claim',
  'start',
  'finish',
  'handoff-ready',
  'progress',
  'wait',
  'resume',
  'blocked',
  'review',
  'done',
  'release',
  'verify',
  'review-docs',
  'prioritize',
  'prompt',
  'release-check',
  'pr-summary',
  'release-bundle',
  'risk-score',
  'cost-time',
  'app-note',
  'request-access',
]);
const APPROVAL_SUBCOMMANDS = ['list', 'check', 'request', 'grant', 'deny', 'use'];
const CONTRACT_SUBCOMMANDS = ['list', 'show', 'create', 'check'];
const RUNBOOK_SUBCOMMANDS = ['list', 'show', 'suggest', 'create'];
const REVIEW_QUEUE_SUBCOMMANDS = ['list', 'claim', 'complete'];
const CALENDAR_SUBCOMMANDS = ['export'];

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))].sort((left, right) => left.localeCompare(right));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function powershellQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function collectCompletionData(context) {
  const board = context.board && typeof context.board === 'object' ? context.board : {};
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const agents = Array.isArray(board.agents) ? board.agents : [];
  const configAgents = Array.isArray(context.config?.agentIds) ? context.config.agentIds : [];
  const configChecks = context.config?.checks && typeof context.config.checks === 'object' ? Object.keys(context.config.checks) : [];
  const verificationChecks = tasks.flatMap((task) => [
    ...(Array.isArray(task.verification) ? task.verification : []),
    ...(Array.isArray(task.verificationLog) ? task.verificationLog.map((entry) => entry?.check) : []),
  ]);
  return {
    commands: unique(Object.keys(COMMANDS)),
    flags: unique(COMMON_FLAGS),
    shells: SHELLS,
    agents: unique([...configAgents, ...agents.map((agent) => agent?.id)]),
    tasks: unique(tasks.map((task) => task?.id)),
    checks: unique([...configChecks, ...verificationChecks, 'unit', 'test', 'lint', 'build', 'visual:test']),
    statuses: STATUSES,
    approvalSubcommands: APPROVAL_SUBCOMMANDS,
    contractSubcommands: CONTRACT_SUBCOMMANDS,
    runbookSubcommands: RUNBOOK_SUBCOMMANDS,
    reviewQueueSubcommands: REVIEW_QUEUE_SUBCOMMANDS,
    calendarSubcommands: CALENDAR_SUBCOMMANDS,
    agentCommands: [...AGENT_COMMANDS].sort(),
    taskCommands: [...TASK_COMMANDS].sort(),
  };
}

function renderBash(data) {
  return `# ai-agents bash completion
_ai_agents_complete() {
  local cur prev cmd index
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmd="\${COMP_WORDS[1]}"
  local commands="${data.commands.join(' ')}"
  local flags="${data.flags.join(' ')}"
  local agents="${data.agents.join(' ')}"
  local tasks="${data.tasks.join(' ')}"
  local checks="${data.checks.join(' ')}"
  local approval_subcommands="${data.approvalSubcommands.join(' ')}"
  local contract_subcommands="${data.contractSubcommands.join(' ')}"
  local runbook_subcommands="${data.runbookSubcommands.join(' ')}"
  local review_queue_subcommands="${data.reviewQueueSubcommands.join(' ')}"
  local calendar_subcommands="${data.calendarSubcommands.join(' ')}"
  local shells="${data.shells.join(' ')}"
  local agent_commands="${data.agentCommands.join(' ')}"
  local task_commands="${data.taskCommands.join(' ')}"
  if [[ "$cur" == --* ]]; then COMPREPLY=( $(compgen -W "$flags" -- "$cur") ); return 0; fi
  if [[ $COMP_CWORD -eq 1 ]]; then COMPREPLY=( $(compgen -W "$commands" -- "$cur") ); return 0; fi
  if [[ "$cmd" == "completions" && $COMP_CWORD -eq 2 ]]; then COMPREPLY=( $(compgen -W "$shells" -- "$cur") ); return 0; fi
  if [[ "$cmd" == "approvals" && $COMP_CWORD -eq 2 ]]; then COMPREPLY=( $(compgen -W "$approval_subcommands" -- "$cur") ); return 0; fi
  if [[ "$cmd" == "contracts" && $COMP_CWORD -eq 2 ]]; then COMPREPLY=( $(compgen -W "$contract_subcommands" -- "$cur") ); return 0; fi
  if [[ "$cmd" == "runbooks" && $COMP_CWORD -eq 2 ]]; then COMPREPLY=( $(compgen -W "$runbook_subcommands" -- "$cur") ); return 0; fi
  if [[ "$cmd" == "review-queue" && $COMP_CWORD -eq 2 ]]; then COMPREPLY=( $(compgen -W "$review_queue_subcommands" -- "$cur") ); return 0; fi
  if [[ "$cmd" == "calendar" && $COMP_CWORD -eq 2 ]]; then COMPREPLY=( $(compgen -W "$calendar_subcommands" -- "$cur") ); return 0; fi
  if [[ "$cmd" == "prioritize" && $COMP_CWORD -eq 2 ]]; then COMPREPLY=( $(compgen -W "$tasks" -- "$cur") ); return 0; fi
  if [[ " $agent_commands " == *" $cmd "* && $COMP_CWORD -eq 2 ]]; then COMPREPLY=( $(compgen -W "$agents" -- "$cur") ); return 0; fi
  if [[ " $task_commands " == *" $cmd "* && $COMP_CWORD -eq 3 ]]; then COMPREPLY=( $(compgen -W "$tasks" -- "$cur") ); return 0; fi
  if [[ "$cmd" == "verify" && $COMP_CWORD -eq 4 ]]; then COMPREPLY=( $(compgen -W "$checks" -- "$cur") ); return 0; fi
  if [[ "$cmd" == "verify" && $COMP_CWORD -eq 5 ]]; then COMPREPLY=( $(compgen -W "pass fail" -- "$cur") ); return 0; fi
}
complete -F _ai_agents_complete ai-agents
complete -F _ai_agents_complete agents
complete -F _ai_agents_complete agents2
`;
}

function renderZsh(data) {
  return `#compdef ai-agents agents agents2
# ai-agents zsh completion
_ai_agents_complete() {
  local -a commands flags agents tasks checks shells approval_subcommands contract_subcommands runbook_subcommands review_queue_subcommands calendar_subcommands
  commands=(${data.commands.map(shellQuote).join(' ')})
  flags=(${data.flags.map(shellQuote).join(' ')})
  agents=(${data.agents.map(shellQuote).join(' ')})
  tasks=(${data.tasks.map(shellQuote).join(' ')})
  checks=(${data.checks.map(shellQuote).join(' ')})
  shells=(${data.shells.map(shellQuote).join(' ')})
  approval_subcommands=(${data.approvalSubcommands.map(shellQuote).join(' ')})
  contract_subcommands=(${data.contractSubcommands.map(shellQuote).join(' ')})
  runbook_subcommands=(${data.runbookSubcommands.map(shellQuote).join(' ')})
  review_queue_subcommands=(${data.reviewQueueSubcommands.map(shellQuote).join(' ')})
  calendar_subcommands=(${data.calendarSubcommands.map(shellQuote).join(' ')})
  if [[ CURRENT -eq 2 ]]; then _describe 'command' commands; return; fi
  case "$words[2]" in
    completions) _describe 'shell' shells ;;
    approvals) _describe 'approval command' approval_subcommands ;;
    contracts) _describe 'contract command' contract_subcommands ;;
    runbooks) _describe 'runbook command' runbook_subcommands ;;
    review-queue) _describe 'review queue command' review_queue_subcommands ;;
    calendar) _describe 'calendar command' calendar_subcommands ;;
    claim|start|finish|handoff-ready|pick|progress|wait|resume|blocked|review|done|release|verify|review-docs|prompt|agent-history|inbox|heartbeat|heartbeat-start|heartbeat-stop|message|app-note|request-access|reserve-resource|renew-resource|release-resource)
      if [[ CURRENT -eq 3 ]]; then _describe 'agent' agents; return; fi
      if [[ CURRENT -eq 4 ]]; then _describe 'task' tasks; return; fi
      ;;
    prioritize|release-check|pr-summary|release-bundle|risk-score|cost-time)
      _describe 'task' tasks ;;
  esac
  if [[ "$words[2]" == "verify" && CURRENT -eq 5 ]]; then _describe 'check' checks; return; fi
  if [[ "$words[2]" == "verify" && CURRENT -eq 6 ]]; then compadd pass fail; return; fi
  _describe 'flag' flags
}
_ai_agents_complete "$@"
`;
}

function renderPowerShell(data) {
  const arrays = [
    `$commands = @(${data.commands.map(powershellQuote).join(', ')})`,
    `$flags = @(${data.flags.map(powershellQuote).join(', ')})`,
    `$agents = @(${data.agents.map(powershellQuote).join(', ')})`,
    `$tasks = @(${data.tasks.map(powershellQuote).join(', ')})`,
    `$checks = @(${data.checks.map(powershellQuote).join(', ')})`,
    `$shells = @(${data.shells.map(powershellQuote).join(', ')})`,
    `$approvalSubcommands = @(${data.approvalSubcommands.map(powershellQuote).join(', ')})`,
    `$contractSubcommands = @(${data.contractSubcommands.map(powershellQuote).join(', ')})`,
    `$runbookSubcommands = @(${data.runbookSubcommands.map(powershellQuote).join(', ')})`,
    `$reviewQueueSubcommands = @(${data.reviewQueueSubcommands.map(powershellQuote).join(', ')})`,
    `$calendarSubcommands = @(${data.calendarSubcommands.map(powershellQuote).join(', ')})`,
  ].join('\n  ');
  return `# ai-agents PowerShell completion
$scriptBlock = {
  param($wordToComplete, $commandAst, $cursorPosition)
  ${arrays}
  $words = $commandAst.CommandElements | ForEach-Object { $_.Extent.Text }
  $cmd = if ($words.Count -gt 1) { $words[1] } else { '' }
  $items = $commands
  if ($wordToComplete -like '--*') { $items = $flags }
  elseif ($words.Count -eq 2) { $items = $commands }
  elseif ($cmd -eq 'completions' -and $words.Count -le 3) { $items = $shells }
  elseif ($cmd -eq 'approvals' -and $words.Count -le 3) { $items = $approvalSubcommands }
  elseif ($cmd -eq 'contracts' -and $words.Count -le 3) { $items = $contractSubcommands }
  elseif ($cmd -eq 'runbooks' -and $words.Count -le 3) { $items = $runbookSubcommands }
  elseif ($cmd -eq 'review-queue' -and $words.Count -le 3) { $items = $reviewQueueSubcommands }
  elseif ($cmd -eq 'calendar' -and $words.Count -le 3) { $items = $calendarSubcommands }
  elseif (@('claim','start','finish','handoff-ready','pick','progress','wait','resume','blocked','review','done','release','verify','review-docs','prompt','agent-history','inbox','heartbeat','heartbeat-start','heartbeat-stop','message','app-note','request-access','reserve-resource','renew-resource','release-resource') -contains $cmd -and $words.Count -le 3) { $items = $agents }
  elseif (@('claim','start','finish','handoff-ready','progress','wait','resume','blocked','review','done','release','verify','review-docs','prioritize','prompt','release-check','pr-summary','release-bundle','risk-score','cost-time','app-note','request-access') -contains $cmd -and $words.Count -le 4) { $items = $tasks }
  elseif ($cmd -eq 'verify' -and $words.Count -le 5) { $items = $checks }
  elseif ($cmd -eq 'verify' -and $words.Count -le 6) { $items = @('pass', 'fail') }
  $items | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
Register-ArgumentCompleter -Native -CommandName ai-agents,agents,agents2 -ScriptBlock $scriptBlock
`;
}

export function renderCompletionScript(shell, data) {
  if (shell === 'bash') return renderBash(data);
  if (shell === 'zsh') return renderZsh(data);
  if (shell === 'powershell') return renderPowerShell(data);
  throw new Error(`Unsupported shell: ${shell}`);
}

export function runCompletionsCommand(argv, context) {
  const json = hasFlag(argv, '--json');
  const [shell] = getPositionals(argv);
  const data = collectCompletionData(context);
  if (!shell || shell === 'list') {
    const payload = { shells: SHELLS, commands: data.commands };
    if (json) console.log(JSON.stringify(payload, null, 2));
    else console.log(SHELLS.join('\n'));
    return 0;
  }
  const normalizedShell = shell.toLowerCase();
  if (!SHELLS.includes(normalizedShell)) {
    return printCommandError(`Usage: completions <${SHELLS.join('|')}> [--json]`, { json });
  }
  const script = renderCompletionScript(normalizedShell, data);
  if (json) console.log(JSON.stringify({ shell: normalizedShell, script }, null, 2));
  else console.log(script);
  return 0;
}
