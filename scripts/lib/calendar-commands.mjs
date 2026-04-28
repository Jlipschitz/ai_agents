import fs from 'node:fs';
import path from 'node:path';

import { getFlagValue, getPositionals, hasFlag } from './args-utils.mjs';
import { printCommandError } from './error-formatting.mjs';
import { fileTimestamp } from './file-utils.mjs';
import { normalizePath, resolveRepoPath } from './path-utils.mjs';
import { ensureTaskMetadataDefaults, formatTaskDueAt } from './task-metadata.mjs';

const DEFAULT_STATUSES = ['planned', 'active', 'blocked', 'waiting', 'review', 'handoff'];
const TERMINAL_STATUSES = ['done', 'released'];
const PRIORITY_VALUES = new Map([
  ['urgent', 1],
  ['high', 3],
  ['normal', 5],
  ['low', 7],
]);

function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseStatuses(argv) {
  if (hasFlag(argv, '--all')) return [...DEFAULT_STATUSES, ...TERMINAL_STATUSES];
  const explicit = splitList(getFlagValue(argv, '--status', ''));
  return explicit.length ? explicit : DEFAULT_STATUSES;
}

function parseReminderMinutes(argv) {
  const values = splitList(getFlagValue(argv, '--reminder-minutes', '1440'));
  const minutes = values
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
  return minutes.length ? [...new Set(minutes)].sort((left, right) => right - left) : [1440];
}

function escapeIcsText(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,');
}

function foldIcsLine(line) {
  const folded = [];
  let remaining = line;
  while (remaining.length > 75) {
    folded.push(remaining.slice(0, 75));
    remaining = ` ${remaining.slice(75)}`;
  }
  folded.push(remaining);
  return folded;
}

function formatIcsDate(value) {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    'T',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    'Z',
  ].join('');
}

function addLine(lines, line) {
  lines.push(...foldIcsLine(line));
}

function taskTitle(task) {
  return task.title || task.summary || task.id;
}

function taskDescription(task) {
  const parts = [
    `Status: ${task.status || 'unknown'}`,
    `Owner: ${task.ownerId || task.suggestedOwnerId || 'unowned'}`,
    `Priority: ${task.priority || 'normal'}`,
    `Severity: ${task.severity || 'none'}`,
  ];
  const paths = Array.isArray(task.claimedPaths) ? task.claimedPaths.filter(Boolean) : [];
  if (paths.length) parts.push(`Paths: ${paths.join(', ')}`);
  if (task.summary && task.summary !== task.title) parts.push(`Summary: ${task.summary}`);
  return parts.join('\n');
}

function buildCalendarItems(board, argv) {
  const statuses = new Set(parseStatuses(argv));
  const taskFilter = new Set(splitList(getFlagValue(argv, '--task', '')));
  const agentFilter = new Set(splitList(getFlagValue(argv, '--agent', '')));
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  return tasks
    .filter((task) => {
      ensureTaskMetadataDefaults(task);
      if (!task.dueAt || !Number.isFinite(Date.parse(task.dueAt))) return false;
      if (!statuses.has(task.status || 'unknown')) return false;
      if (taskFilter.size && !taskFilter.has(task.id)) return false;
      if (agentFilter.size && !agentFilter.has(task.ownerId || task.suggestedOwnerId || 'unowned')) return false;
      return true;
    })
    .map((task) => ({
      taskId: task.id,
      title: taskTitle(task),
      status: task.status || 'unknown',
      ownerId: task.ownerId || task.suggestedOwnerId || null,
      priority: task.priority || 'normal',
      severity: task.severity || 'none',
      dueAt: task.dueAt,
      due: formatTaskDueAt(task.dueAt),
      claimedPaths: Array.isArray(task.claimedPaths) ? task.claimedPaths.filter(Boolean) : [],
      task,
    }))
    .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt) || left.taskId.localeCompare(right.taskId));
}

function renderIcs(items, reminderMinutes, now = new Date()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AI Agents//Task Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  const stamp = formatIcsDate(now);
  for (const item of items) {
    const due = new Date(item.dueAt);
    const end = new Date(due.getTime() + 30 * 60 * 1000);
    lines.push('BEGIN:VEVENT');
    addLine(lines, `UID:${encodeURIComponent(item.taskId)}@ai-agents`);
    addLine(lines, `DTSTAMP:${stamp}`);
    addLine(lines, `DTSTART:${formatIcsDate(due)}`);
    addLine(lines, `DTEND:${formatIcsDate(end)}`);
    addLine(lines, `SUMMARY:${escapeIcsText(`[${item.priority}] ${item.title}`)}`);
    addLine(lines, `DESCRIPTION:${escapeIcsText(taskDescription(item.task))}`);
    addLine(lines, 'STATUS:CONFIRMED');
    addLine(lines, `PRIORITY:${PRIORITY_VALUES.get(item.priority) ?? 5}`);
    for (const minutes of reminderMinutes) {
      lines.push('BEGIN:VALARM');
      addLine(lines, `TRIGGER:-PT${minutes}M`);
      lines.push('ACTION:DISPLAY');
      addLine(lines, `DESCRIPTION:${escapeIcsText(`Task due: ${item.title}`)}`);
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

function outputPathFor(argv, context) {
  const explicit = getFlagValue(argv, '--out', '');
  if (explicit) return resolveRepoPath(explicit, explicit, context.root);
  const stamp = hasFlag(argv, '--timestamped') ? `-${fileTimestamp()}` : '';
  return path.join(context.paths.coordinationRoot, 'calendar', `tasks${stamp}.ics`);
}

function publicItems(items) {
  return items.map(({ task, ...item }) => item);
}

function renderText(result) {
  const lines = ['# Calendar Export'];
  lines.push(`Tasks: ${result.summary.tasks}; reminders: ${result.summary.reminders.join(', ')} minutes`);
  lines.push(result.applied ? `Wrote: ${result.outputPath}` : `Dry run: would write ${result.outputPath}`);
  if (!result.tasks.length) {
    lines.push('- no due tasks matched');
    return lines.join('\n');
  }
  for (const item of result.tasks) {
    lines.push(`- ${item.taskId}: ${item.title} due ${item.due} (${item.status}, ${item.priority})`);
  }
  return lines.join('\n');
}

export function buildCalendarExport(context, argv = []) {
  const items = buildCalendarItems(context.board, argv);
  const reminders = parseReminderMinutes(argv);
  const ics = renderIcs(items, reminders);
  const outputPath = outputPathFor(argv, context);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    applied: false,
    outputPath: normalizePath(outputPath, context.root) || outputPath,
    tasks: publicItems(items),
    ics,
    summary: {
      tasks: items.length,
      reminders,
      statuses: parseStatuses(argv),
    },
  };
}

export function runCalendarCommand(argv, context) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const positionals = getPositionals(argv, new Set(['--out', '--status', '--task', '--agent', '--reminder-minutes']));
  if (positionals.length && positionals[0] !== 'export') {
    return printCommandError('Usage: calendar [export] [--out <path>] [--apply] [--json]', { json });
  }

  const result = buildCalendarExport(context, argv);
  if (apply) {
    const absoluteOutputPath = resolveRepoPath(result.outputPath, result.outputPath, context.root);
    fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
    fs.writeFileSync(absoluteOutputPath, result.ics);
    result.applied = true;
  }

  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(renderText(result));
  return 0;
}
