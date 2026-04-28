import fs from 'node:fs';

import { auditLogPath } from './audit-log.mjs';
import { getFlagValue, getNumberFlag, hasFlag } from './args-utils.mjs';
import { printCommandError } from './error-formatting.mjs';

const DEFAULT_LIMIT = 50;

function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
}

function parseMs(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsvFlag(argv, flag) {
  return getFlagValue(argv, flag, '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function includesAny(value, needles) {
  if (!needles.length) return true;
  const text = JSON.stringify(value ?? '').toLowerCase();
  return needles.some((needle) => text.includes(needle.toLowerCase()));
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== ''));
}

function event(at, source, summary, extra = {}) {
  return compactObject({
    at: at || null,
    source,
    summary,
    taskId: extra.taskId || null,
    agentId: extra.agentId || null,
    kind: extra.kind || null,
    details: extra.details || null,
  });
}

function journalEvents(paths) {
  return readLines(paths.journalPath).map((line) => {
    const match = line.match(/^-\s+([^|]+)\|\s*(.+)$/);
    if (!match) return event(null, 'journal', line.replace(/^-\s*/, ''));
    return event(match[1].trim(), 'journal', match[2].trim(), { details: { line } });
  });
}

function messageEvents(paths) {
  return readLines(paths.messagesPath).map((line, index) => {
    try {
      const message = JSON.parse(line);
      return event(message.at, 'message', message.body || '', {
        taskId: message.taskId || null,
        agentId: message.from || null,
        details: { from: message.from || '', to: message.to || '' },
      });
    } catch (error) {
      return event(null, 'message', `Malformed message line ${index + 1}: ${error.message}`, { details: { line } });
    }
  });
}

function auditEvents(paths) {
  return readLines(auditLogPath(paths)).map((line, index) => {
    try {
      const entry = JSON.parse(line);
      return event(entry.at, 'audit', entry.summary || entry.command || '', {
        taskId: entry.details?.taskId || (Array.isArray(entry.details?.taskIds) ? entry.details.taskIds.join(',') : null),
        agentId: entry.details?.agentId || entry.details?.ownerId || entry.details?.reviewerId || null,
        kind: entry.command || null,
        details: { applied: Boolean(entry.applied), ...(entry.details || {}) },
      });
    } catch (error) {
      return event(null, 'audit', `Malformed audit line ${index + 1}: ${error.message}`, { details: { line } });
    }
  });
}

function taskEvents(board) {
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  return tasks.flatMap((task) => {
    const notes = Array.isArray(task.notes)
      ? task.notes.map((note) => event(note.at, 'task-note', note.body || '', {
          taskId: task.id,
          agentId: note.agent || task.ownerId || null,
          kind: note.kind || null,
        }))
      : [];
    const verification = Array.isArray(task.verificationLog)
      ? task.verificationLog.map((entry) => event(entry.at || entry.finishedAt || entry.startedAt, 'verification', `${entry.check || 'check'} ${entry.outcome || entry.status || 'unknown'}${entry.details ? ` - ${entry.details}` : ''}`, {
          taskId: task.id,
          agentId: entry.agent || task.ownerId || null,
          kind: entry.check || null,
          details: entry,
        }))
      : [];
    return [...notes, ...verification];
  });
}

export function buildTimeline(argv, context) {
  const taskFilters = parseCsvFlag(argv, '--task');
  const agentFilters = parseCsvFlag(argv, '--agent');
  const fromMs = parseMs(getFlagValue(argv, '--from', ''));
  const toMs = parseMs(getFlagValue(argv, '--to', ''));
  const limit = hasFlag(argv, '--all') ? Number.POSITIVE_INFINITY : getNumberFlag(argv, '--limit', DEFAULT_LIMIT);
  const allEvents = [
    ...journalEvents(context.paths),
    ...messageEvents(context.paths),
    ...auditEvents(context.paths),
    ...taskEvents(context.board || {}),
  ]
    .filter((entry) => includesAny([entry.taskId, entry.summary, entry.details], taskFilters))
    .filter((entry) => includesAny([entry.agentId, entry.summary, entry.details], agentFilters))
    .filter((entry) => {
      const ms = parseMs(entry.at);
      if (fromMs !== null && (ms === null || ms < fromMs)) return false;
      if (toMs !== null && (ms === null || ms > toMs)) return false;
      return true;
    })
    .sort((left, right) => (parseMs(left.at) ?? 0) - (parseMs(right.at) ?? 0));
  const events = Number.isFinite(limit) ? allEvents.slice(-Math.max(0, limit)) : allEvents;
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    filters: {
      tasks: taskFilters,
      agents: agentFilters,
      from: getFlagValue(argv, '--from', '') || null,
      to: getFlagValue(argv, '--to', '') || null,
      limit: Number.isFinite(limit) ? limit : null,
    },
    events,
    counts: events.reduce((counts, entry) => ({ ...counts, [entry.source]: (counts[entry.source] || 0) + 1 }), {}),
  };
}

function renderEvent(entry) {
  const parts = [
    entry.at || 'unknown-time',
    entry.source,
    entry.kind || '',
    entry.taskId ? `task ${entry.taskId}` : '',
    entry.agentId ? `agent ${entry.agentId}` : '',
    entry.summary,
  ].filter(Boolean);
  return `- ${parts.join(' | ')}`;
}

export function renderTimelineText(timeline) {
  const filters = [
    timeline.filters.tasks.length ? `tasks ${timeline.filters.tasks.join(',')}` : '',
    timeline.filters.agents.length ? `agents ${timeline.filters.agents.join(',')}` : '',
    timeline.filters.from ? `from ${timeline.filters.from}` : '',
    timeline.filters.to ? `to ${timeline.filters.to}` : '',
  ].filter(Boolean).join(' | ') || 'none';
  return [
    '# Coordination Timeline',
    `Generated: ${timeline.generatedAt}`,
    `Filters: ${filters}`,
    `Events: ${timeline.events.length}`,
    '',
    ...(timeline.events.length ? timeline.events.map(renderEvent) : ['- none']),
  ].join('\n');
}

export function runTimeline(argv, context) {
  try {
    const timeline = buildTimeline(argv, context);
    if (hasFlag(argv, '--json')) console.log(JSON.stringify(timeline, null, 2));
    else console.log(renderTimelineText(timeline));
    return 0;
  } catch (error) {
    return printCommandError(error.message, { json: hasFlag(argv, '--json') });
  }
}
