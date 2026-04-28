import readline from 'node:readline/promises';

import { getFlagValue, hasFlag } from './args-utils.mjs';

function countByStatus(tasks) {
  const counts = {};
  for (const task of tasks) {
    const status = task?.status || 'unknown';
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function buildActions(board) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const hasPlanned = tasks.some((task) => task?.status === 'planned');
  const hasReview = tasks.some((task) => task?.status === 'review');
  const hasActive = tasks.some((task) => ['active', 'blocked', 'waiting', 'handoff'].includes(task?.status));

  return [
    { id: 'status', label: 'Workspace status', command: ['status'], description: 'Show active, blocked, waiting, review, and planned work.' },
    { id: 'summarize', label: 'Transcript summary', command: ['summarize', '--for-chat'], description: 'Print a compact handoff summary for chat context.' },
    { id: 'doctor', label: 'Doctor check', command: ['doctor', '--json'], description: 'Inspect setup, config, Git, docs, and runtime health.' },
    { id: 'health', label: 'Health score', command: ['health-score'], description: 'Score setup, active work, verification, and runtime state.' },
    ...(hasPlanned ? [{ id: 'pick', label: 'Pick next task', command: ['pick', '<agent-id>'], description: 'Suggest the next planned task for an agent.' }] : []),
    ...(hasReview ? [{ id: 'review', label: 'Review queue', command: ['review-queue'], description: 'List work that is ready for review.' }] : []),
    ...(hasActive ? [{ id: 'risk', label: 'Risk score', command: ['risk-score'], description: 'Rank active work by coordination and verification risk.' }] : []),
    { id: 'help', label: 'Command help', command: ['help'], description: 'Show the complete command list.' },
  ];
}

export function buildInteractiveModel(context = {}) {
  const board = context.board && typeof context.board === 'object' ? context.board : {};
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  return {
    projectName: board.projectName || context.config?.projectName || 'Coordination Workspace',
    taskCounts: countByStatus(tasks),
    actions: buildActions(board),
  };
}

function commandText(cli, action) {
  return `${cli} -- ${action.command.join(' ')}`;
}

function renderMenu(model, { cli = 'agents' } = {}) {
  const lines = [
    '# Interactive Mode',
    '',
    `Workspace: ${model.projectName}`,
    `Tasks: ${Object.entries(model.taskCounts).map(([status, count]) => `${status} ${count}`).join(', ') || 'none'}`,
    '',
    'Actions:',
  ];

  model.actions.forEach((action, index) => {
    lines.push(`${index + 1}. ${action.label}`);
    lines.push(`   ${action.description}`);
    lines.push(`   ${commandText(cli, action)}`);
  });

  lines.push('');
  lines.push('Use --select <id|number> to print one action without prompting.');
  return lines.join('\n');
}

function selectAction(actions, value) {
  if (!value) return null;
  const numeric = Number.parseInt(value, 10);
  if (Number.isInteger(numeric) && String(numeric) === String(value).trim()) return actions[numeric - 1] ?? null;
  return actions.find((action) => action.id === value) ?? null;
}

export async function runInteractive(argv, context = {}) {
  const json = hasFlag(argv, '--json');
  const selectedValue = getFlagValue(argv, '--select') ?? getFlagValue(argv, '--command');
  const cli = context.cli ?? 'agents';
  const stdout = context.stdout ?? process.stdout;
  const stdin = context.stdin ?? process.stdin;
  const model = buildInteractiveModel(context);

  if (json) {
    stdout.write(`${JSON.stringify({ ok: true, interactive: Boolean(stdin.isTTY), ...model }, null, 2)}\n`);
    return 0;
  }

  const selected = selectAction(model.actions, selectedValue);
  if (selectedValue && !selected) {
    stdout.write(`${renderMenu(model, { cli })}\n`);
    stdout.write(`\nNo action matched "${selectedValue}".\n`);
    return 1;
  }

  if (selected) {
    stdout.write(`${commandText(cli, selected)}\n`);
    return 0;
  }

  stdout.write(`${renderMenu(model, { cli })}\n`);
  if (!stdin.isTTY) return 0;

  const terminal = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await terminal.question('\nSelect action: ');
    const action = selectAction(model.actions, answer.trim());
    if (!action) {
      stdout.write('No action selected.\n');
      return 1;
    }
    stdout.write(`${commandText(cli, action)}\n`);
    return 0;
  } finally {
    terminal.close();
  }
}
