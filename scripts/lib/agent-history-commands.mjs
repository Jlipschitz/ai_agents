import fs from 'node:fs';

import { auditLogPath } from './audit-log.mjs';
import { getNumberFlag, getPositionals, hasFlag } from './args-utils.mjs';

const DEFAULT_EVENT_LIMIT = 8;
const DEFAULT_STALE_HOURS = 24;
const ACTIVE_STATUSES = new Set(['active', 'blocked', 'waiting', 'review', 'handoff']);
const TERMINAL_STATUSES = new Set(['done', 'released']);

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function parseTimeMs(value) {
  const timestamp = Date.parse(String(value ?? ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hoursSince(value, nowMs = Date.now()) {
  const timestamp = parseTimeMs(value);
  return timestamp === null ? null : Math.max(0, (nowMs - timestamp) / 36e5);
}

function increment(object, key, amount = 1) {
  object[key] = (object[key] ?? 0) + amount;
}

function clampScore(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function reputationLevel(score) {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'strong';
  if (score >= 60) return 'steady';
  if (score >= 45) return 'watch';
  return 'at-risk';
}

function compactSummary(value, fallback = '') {
  const text = stringValue(value).replace(/\s+/g, ' ');
  if (!text) return fallback;
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function createAgentStats(agentId) {
  return {
    agentId,
    score: 50,
    level: 'steady',
    metrics: {
      tasks: {
        touched: 0,
        owned: 0,
        active: 0,
        blocked: 0,
        waiting: 0,
        review: 0,
        handoff: 0,
        done: 0,
        released: 0,
        completed: 0,
        stale: 0,
      },
      verification: { pass: 0, fail: 0, other: 0 },
      docsReviews: 0,
      handoffs: { given: 0, received: 0 },
      notes: { total: 0, byKind: {} },
      auditEntries: 0,
    },
    factors: [],
    recentEvents: [],
    firstActivityAt: null,
    lastActivityAt: null,
    _taskIds: new Set(),
    _completedTaskIds: new Set(),
    _staleTaskIds: new Set(),
    _events: [],
  };
}

function ensureStats(statsByAgent, agentId) {
  const normalizedAgentId = stringValue(agentId);
  if (!normalizedAgentId) return null;
  if (!statsByAgent.has(normalizedAgentId)) statsByAgent.set(normalizedAgentId, createAgentStats(normalizedAgentId));
  return statsByAgent.get(normalizedAgentId);
}

function touchTask(stats, taskId) {
  if (!stats || !taskId) return;
  stats._taskIds.add(taskId);
  stats.metrics.tasks.touched = stats._taskIds.size;
}

function addActivity(stats, at) {
  if (!stats || !at || parseTimeMs(at) === null) return;
  if (!stats.firstActivityAt || parseTimeMs(at) < parseTimeMs(stats.firstActivityAt)) stats.firstActivityAt = at;
  if (!stats.lastActivityAt || parseTimeMs(at) > parseTimeMs(stats.lastActivityAt)) stats.lastActivityAt = at;
}

function addEvent(stats, event) {
  if (!stats) return;
  const payload = {
    at: event.at ?? null,
    taskId: event.taskId ?? null,
    type: event.type,
    summary: compactSummary(event.summary, event.type),
  };
  stats._events.push(payload);
  addActivity(stats, payload.at);
  if (payload.taskId) touchTask(stats, payload.taskId);
}

function addFactor(stats, code, points, message) {
  if (!points) return;
  stats.factors.push({ code, points, message });
}

function addCompletedTask(stats, task) {
  if (!stats || !task?.id || !TERMINAL_STATUSES.has(task.status) || stats._completedTaskIds.has(task.id)) return;
  stats._completedTaskIds.add(task.id);
  stats.metrics.tasks.completed = stats._completedTaskIds.size;
  increment(stats.metrics.tasks, task.status);
}

function noteAgentId(note) {
  return stringValue(note?.agent) || stringValue(note?.agentId) || stringValue(note?.by);
}

function noteBody(note) {
  return stringValue(note?.body) || stringValue(note?.note) || stringValue(note?.message);
}

function verificationAgentId(entry) {
  return stringValue(entry?.agent) || stringValue(entry?.agentId) || stringValue(entry?.by);
}

function addTaskOwnershipSignals(statsByAgent, task, staleHours, nowMs) {
  const taskId = stringValue(task?.id);
  const status = stringValue(task?.status) || 'unknown';
  const ownerId = stringValue(task?.ownerId);
  const lastOwnerId = stringValue(task?.lastOwnerId);
  const title = task?.title || task?.summary || taskId;

  if (ownerId) {
    const stats = ensureStats(statsByAgent, ownerId);
    touchTask(stats, taskId);
    stats.metrics.tasks.owned += 1;
    if (Object.hasOwn(stats.metrics.tasks, status)) increment(stats.metrics.tasks, status);
    if (ACTIVE_STATUSES.has(status)) {
      const age = hoursSince(task.updatedAt || task.claimedAt || task.startedAt || task.createdAt, nowMs);
      if (age !== null && age >= staleHours && !stats._staleTaskIds.has(taskId)) {
        stats._staleTaskIds.add(taskId);
        stats.metrics.tasks.stale = stats._staleTaskIds.size;
      }
    }
    addEvent(stats, { at: task.updatedAt || task.claimedAt || task.createdAt, taskId, type: `task:${status}`, summary: title });
  }

  if (lastOwnerId) {
    const stats = ensureStats(statsByAgent, lastOwnerId);
    touchTask(stats, taskId);
    if (status === 'handoff') increment(stats.metrics.tasks, 'handoff');
    addCompletedTask(stats, task);
  }
}

function addNoteSignals(statsByAgent, task) {
  const taskId = stringValue(task?.id);
  for (const note of array(task?.notes)) {
    const agentId = noteAgentId(note);
    if (!agentId) continue;
    const stats = ensureStats(statsByAgent, agentId);
    const kind = stringValue(note.kind) || 'note';
    stats.metrics.notes.total += 1;
    increment(stats.metrics.notes.byKind, kind);
    touchTask(stats, taskId);
    if (kind === 'done' || kind === 'release') addCompletedTask(stats, task);
    addEvent(stats, { at: note.at, taskId, type: kind, summary: noteBody(note) });
  }
}

function addVerificationSignals(statsByAgent, task) {
  const taskId = stringValue(task?.id);
  for (const entry of array(task?.verificationLog)) {
    const agentId = verificationAgentId(entry);
    if (!agentId) continue;
    const stats = ensureStats(statsByAgent, agentId);
    const outcome = stringValue(entry.outcome || entry.status).toLowerCase();
    if (outcome === 'pass') stats.metrics.verification.pass += 1;
    else if (outcome === 'fail') stats.metrics.verification.fail += 1;
    else stats.metrics.verification.other += 1;
    addEvent(stats, { at: entry.at || entry.finishedAt || entry.startedAt, taskId, type: `verify:${outcome || 'unknown'}`, summary: `${entry.check ?? 'check'} ${outcome || 'unknown'}${entry.details ? `: ${entry.details}` : ''}` });
  }
}

function addDocsSignals(statsByAgent, task) {
  const agentId = stringValue(task?.docsReviewedBy);
  if (!agentId || !task?.docsReviewedAt) return;
  const stats = ensureStats(statsByAgent, agentId);
  stats.metrics.docsReviews += 1;
  addEvent(stats, { at: task.docsReviewedAt, taskId: task.id, type: 'docs-review', summary: `Reviewed docs for ${task.id}` });
}

function addHandoffSignals(statsByAgent, task) {
  const handoff = task?.lastHandoff && typeof task.lastHandoff === 'object' ? task.lastHandoff : null;
  if (!handoff) return;
  const taskId = stringValue(task?.id);
  const from = stringValue(handoff.from);
  const to = stringValue(handoff.to);
  if (from) {
    const stats = ensureStats(statsByAgent, from);
    stats.metrics.handoffs.given += 1;
    addEvent(stats, { at: handoff.at || task.updatedAt, taskId, type: 'handoff:given', summary: handoff.body || `Handed off ${taskId}${to ? ` to ${to}` : ''}` });
  }
  if (to) {
    const stats = ensureStats(statsByAgent, to);
    stats.metrics.handoffs.received += 1;
    addEvent(stats, { at: handoff.at || task.updatedAt, taskId, type: 'handoff:received', summary: handoff.body || `Received handoff for ${taskId} from ${from || 'unknown'}` });
  }
}

function readAuditEntries(paths) {
  const filePath = paths?.runtimeRoot ? auditLogPath(paths) : '';
  if (!filePath || !fs.existsSync(filePath)) return { entries: [], warnings: [] };
  const entries = [];
  const warnings = [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  for (let index = 0; index < lines.length; index += 1) {
    try {
      entries.push(JSON.parse(lines[index]));
    } catch (error) {
      warnings.push(`Ignored malformed audit log line ${index + 1}: ${error.message}`);
    }
  }
  return { entries, warnings };
}

function auditAgentIds(entry) {
  const details = entry?.details && typeof entry.details === 'object' ? entry.details : {};
  return [
    details.agentId,
    details.ownerId,
    details.previousOwnerId,
    details.requestedBy,
    details.decidedBy,
    details.by,
  ].map(stringValue).filter(Boolean);
}

function addAuditSignals(statsByAgent, paths) {
  const { entries, warnings } = readAuditEntries(paths);
  for (const entry of entries) {
    for (const agentId of auditAgentIds(entry)) {
      const stats = ensureStats(statsByAgent, agentId);
      stats.metrics.auditEntries += 1;
      addEvent(stats, {
        at: entry.at,
        taskId: stringValue(entry.details?.taskId) || null,
        type: `audit:${entry.command || 'command'}`,
        summary: entry.summary || entry.command || 'audit entry',
      });
    }
  }
  return warnings;
}

function scoreAgent(stats) {
  const { tasks, verification, docsReviews, handoffs, notes, auditEntries } = stats.metrics;
  let score = 50;

  const progressNotes = notes.byKind.progress ?? 0;
  const positiveFactors = [
    ['completedWork', Math.min(40, tasks.completed * 10), `${tasks.completed} completed task(s).`],
    ['releasedWork', Math.min(10, tasks.released * 2), `${tasks.released} released task(s).`],
    ['passingVerification', Math.min(18, verification.pass * 3), `${verification.pass} passing verification entr${verification.pass === 1 ? 'y' : 'ies'}.`],
    ['docsReviews', Math.min(10, docsReviews * 2), `${docsReviews} docs review(s).`],
    ['progressNotes', Math.min(10, progressNotes), `${progressNotes} progress note(s).`],
    ['handoffsReceived', Math.min(6, handoffs.received * 2), `${handoffs.received} received handoff(s).`],
    ['handoffsGiven', Math.min(5, handoffs.given), `${handoffs.given} outgoing handoff(s).`],
    ['auditTrail', Math.min(5, auditEntries), `${auditEntries} audit log entr${auditEntries === 1 ? 'y' : 'ies'}.`],
  ];
  const negativeFactors = [
    ['failingVerification', -Math.min(24, verification.fail * 8), `${verification.fail} failing verification entr${verification.fail === 1 ? 'y' : 'ies'}.`],
    ['staleWork', -Math.min(30, tasks.stale * 12), `${tasks.stale} stale owned task(s).`],
    ['blockedWork', -Math.min(15, tasks.blocked * 5), `${tasks.blocked} blocked task(s).`],
    ['waitingWork', -Math.min(12, tasks.waiting * 4), `${tasks.waiting} waiting task(s).`],
  ];

  for (const [code, points, message] of [...positiveFactors, ...negativeFactors]) {
    if (!points) continue;
    score += points;
    addFactor(stats, code, points, message);
  }

  stats.score = clampScore(score);
  stats.level = reputationLevel(stats.score);
  stats.factors.sort((left, right) => Math.abs(right.points) - Math.abs(left.points) || left.code.localeCompare(right.code));
}

function finalizeAgentStats(stats, limit) {
  scoreAgent(stats);
  stats.recentEvents = stats._events
    .sort((left, right) => (parseTimeMs(right.at) ?? 0) - (parseTimeMs(left.at) ?? 0) || String(left.type).localeCompare(String(right.type)))
    .slice(0, limit);
  delete stats._taskIds;
  delete stats._completedTaskIds;
  delete stats._staleTaskIds;
  delete stats._events;
  return stats;
}

export function buildAgentHistory(context, argv = []) {
  const limit = Math.max(1, getNumberFlag(argv, '--limit', DEFAULT_EVENT_LIMIT));
  const staleHours = Math.max(1, getNumberFlag(argv, '--stale-hours', DEFAULT_STALE_HOURS));
  const requestedAgentIds = getPositionals(argv, new Set(['--limit', '--stale-hours']));
  const requested = new Set(requestedAgentIds);
  const board = context.board && typeof context.board === 'object' ? context.board : { agents: [], tasks: [] };
  const statsByAgent = new Map();
  const nowMs = Date.now();

  for (const agentId of array(context.config?.agentIds)) ensureStats(statsByAgent, agentId);
  for (const agent of array(board.agents)) ensureStats(statsByAgent, agent?.id);
  for (const agentId of requestedAgentIds) ensureStats(statsByAgent, agentId);

  for (const task of array(board.tasks)) {
    addTaskOwnershipSignals(statsByAgent, task, staleHours, nowMs);
    addNoteSignals(statsByAgent, task);
    addVerificationSignals(statsByAgent, task);
    addDocsSignals(statsByAgent, task);
    addHandoffSignals(statsByAgent, task);
  }

  const warnings = addAuditSignals(statsByAgent, context.paths);
  const agents = [...statsByAgent.values()]
    .filter((stats) => !requested.size || requested.has(stats.agentId))
    .map((stats) => finalizeAgentStats(stats, limit))
    .sort((left, right) => right.score - left.score || left.agentId.localeCompare(right.agentId));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    staleHours,
    eventLimit: limit,
    summary: {
      agents: agents.length,
      excellent: agents.filter((agent) => agent.level === 'excellent').length,
      strong: agents.filter((agent) => agent.level === 'strong').length,
      steady: agents.filter((agent) => agent.level === 'steady').length,
      watch: agents.filter((agent) => agent.level === 'watch').length,
      atRisk: agents.filter((agent) => agent.level === 'at-risk').length,
    },
    agents,
    warnings,
  };
}

function renderAgentHistory(report) {
  const lines = ['# Agent History'];
  lines.push(`Agents: ${report.summary.agents}; excellent: ${report.summary.excellent}; strong: ${report.summary.strong}; steady: ${report.summary.steady}; watch: ${report.summary.watch}; at-risk: ${report.summary.atRisk}`);
  lines.push(`Stale threshold: ${report.staleHours}h`);
  if (report.warnings.length) {
    lines.push('Warnings:');
    lines.push(report.warnings.map((warning) => `- ${warning}`).join('\n'));
  }
  if (!report.agents.length) {
    lines.push('- no agents found');
    return lines.join('\n');
  }
  for (const agent of report.agents) {
    const { tasks, verification, handoffs, notes } = agent.metrics;
    lines.push(`\n${agent.agentId}: ${agent.level} (${agent.score}/100)`);
    lines.push(`Tasks: touched ${tasks.touched}, completed ${tasks.completed}, active ${tasks.active}, blocked ${tasks.blocked}, waiting ${tasks.waiting}, stale ${tasks.stale}`);
    lines.push(`Verification: pass ${verification.pass}, fail ${verification.fail}, other ${verification.other}`);
    lines.push(`Docs reviews: ${agent.metrics.docsReviews}; handoffs: given ${handoffs.given}, received ${handoffs.received}; notes ${notes.total}; audit ${agent.metrics.auditEntries}`);
    lines.push('Top factors:');
    lines.push(agent.factors.length ? agent.factors.slice(0, 5).map((factor) => `- ${factor.points > 0 ? '+' : ''}${factor.points} ${factor.code}: ${factor.message}`).join('\n') : '- none');
    lines.push('Recent events:');
    lines.push(agent.recentEvents.length ? agent.recentEvents.map((event) => `- ${event.at ?? 'unknown'}${event.taskId ? ` ${event.taskId}` : ''} ${event.type}: ${event.summary}`).join('\n') : '- none');
  }
  return lines.join('\n');
}

export function runAgentHistory(argv, context) {
  const report = buildAgentHistory(context, argv);
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(renderAgentHistory(report));
  return 0;
}
