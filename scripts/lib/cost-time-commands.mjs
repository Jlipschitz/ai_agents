import { getFlagValue, getPositionals, hasFlag } from './args-utils.mjs';

const DEFAULT_CURRENCY = 'USD';
const TERMINAL_STATUSES = new Set(['done', 'released']);
const ACTIVE_STATUSES = new Set(['active', 'blocked', 'waiting', 'review', 'handoff']);
const EFFORT_HOURS = new Map([
  ['tiny', 1],
  ['xs', 1],
  ['xsmall', 1],
  ['small', 2],
  ['s', 2],
  ['medium', 6],
  ['m', 6],
  ['large', 16],
  ['l', 16],
  ['xl', 32],
  ['xlarge', 32],
  ['huge', 40],
  ['unknown', 0],
]);

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

function parseNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function hoursBetween(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  return (endMs - startMs) / 36e5;
}

function noteAgentId(note) {
  return stringValue(note?.agent) || stringValue(note?.agentId) || stringValue(note?.by);
}

function verificationAgentId(entry) {
  return stringValue(entry?.agent) || stringValue(entry?.agentId) || stringValue(entry?.by);
}

function addEvent(events, at, agentId, type) {
  const timestamp = parseTimeMs(at);
  if (timestamp === null) return;
  events.push({ at, timestamp, agentId: stringValue(agentId) || null, type });
}

function collectTaskEvents(task) {
  const events = [];
  const ownerId = stringValue(task.ownerId);
  const lastOwnerId = stringValue(task.lastOwnerId);
  const primaryAgentId = ownerId || lastOwnerId;

  addEvent(events, task.createdAt, primaryAgentId, 'created');
  addEvent(events, task.claimedAt || task.startedAt, ownerId || lastOwnerId, 'started');
  addEvent(events, task.updatedAt, ownerId || lastOwnerId, 'updated');
  addEvent(events, task.completedAt, lastOwnerId || ownerId, 'completed');
  addEvent(events, task.releasedAt, lastOwnerId || ownerId, 'released');
  addEvent(events, task.docsReviewedAt, task.docsReviewedBy, 'docs-review');

  for (const note of array(task.notes)) addEvent(events, note.at, noteAgentId(note), stringValue(note.kind) || 'note');
  for (const entry of array(task.verificationLog)) addEvent(events, entry.at || entry.finishedAt || entry.startedAt, verificationAgentId(entry), `verify:${entry.outcome || entry.status || 'unknown'}`);

  const handoff = task.lastHandoff && typeof task.lastHandoff === 'object' ? task.lastHandoff : null;
  if (handoff) {
    addEvent(events, handoff.at || task.updatedAt, handoff.from, 'handoff:given');
    addEvent(events, handoff.at || task.updatedAt, handoff.to, 'handoff:received');
  }

  return events.sort((left, right) => left.timestamp - right.timestamp);
}

function explicitHours(task, fieldNames) {
  for (const fieldName of fieldNames) {
    const value = task?.[fieldName];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value.replace(/hours?|hrs?|h/i, '').trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function estimatedHours(task) {
  const explicit = explicitHours(task, ['estimatedHours', 'estimateHours', 'timeEstimateHours', 'hoursEstimate']);
  if (explicit !== null) return explicit;
  const effort = stringValue(task?.effort).toLowerCase();
  if (!effort) return 0;
  if (EFFORT_HOURS.has(effort)) return EFFORT_HOURS.get(effort);
  const parsed = Number.parseFloat(effort.replace(/hours?|hrs?|h/i, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function observedHours(task, events) {
  const explicit = explicitHours(task, ['actualHours', 'spentHours', 'timeSpentHours', 'observedHours']);
  if (explicit !== null) return explicit;
  if (events.length < 2) return 0;
  return hoursBetween(events[0].timestamp, events.at(-1).timestamp);
}

function openAgeHours(task, nowMs = Date.now()) {
  if (!ACTIVE_STATUSES.has(task.status)) return 0;
  const timestamp = parseTimeMs(task.updatedAt || task.claimedAt || task.startedAt || task.createdAt);
  return timestamp === null ? 0 : hoursBetween(timestamp, nowMs);
}

function contributorsForTask(task, events) {
  const contributors = new Set([task.ownerId, task.lastOwnerId, task.docsReviewedBy].map(stringValue).filter(Boolean));
  for (const event of events) if (event.agentId) contributors.add(event.agentId);
  return [...contributors].sort((left, right) => left.localeCompare(right));
}

function primaryAgentForTask(task, contributors) {
  return stringValue(task.ownerId) || stringValue(task.lastOwnerId) || contributors[0] || null;
}

function agentObservedHours(events, agentId) {
  const agentEvents = events.filter((event) => event.agentId === agentId);
  if (agentEvents.length < 2) return 0;
  return hoursBetween(agentEvents[0].timestamp, agentEvents.at(-1).timestamp);
}

function overlapsWindow(events, fromMs, toMs) {
  if (fromMs === null && toMs === null) return true;
  if (!events.length) return false;
  return events.some((event) => (fromMs === null || event.timestamp >= fromMs) && (toMs === null || event.timestamp <= toMs));
}

function createAgentTotals(agentId) {
  return {
    agentId,
    tasks: 0,
    activeTasks: 0,
    completedTasks: 0,
    estimatedHours: 0,
    observedHours: 0,
    openAgeHours: 0,
    estimatedCost: 0,
    observedCost: 0,
    taskIds: [],
  };
}

function addAgentTask(agentTotals, taskReport, agentId, hourlyRate) {
  if (!agentTotals.has(agentId)) agentTotals.set(agentId, createAgentTotals(agentId));
  const totals = agentTotals.get(agentId);
  totals.tasks += 1;
  totals.taskIds.push(taskReport.taskId);
  if (ACTIVE_STATUSES.has(taskReport.status)) totals.activeTasks += 1;
  if (TERMINAL_STATUSES.has(taskReport.status)) totals.completedTasks += 1;
  if (taskReport.primaryAgentId === agentId) {
    totals.estimatedHours += taskReport.estimatedHours;
    totals.openAgeHours += taskReport.openAgeHours;
  }
  totals.observedHours += taskReport.agentObservedHours[agentId] ?? 0;
  totals.estimatedCost = totals.estimatedHours * hourlyRate;
  totals.observedCost = totals.observedHours * hourlyRate;
}

function finalizeAgentTotals(totals) {
  return {
    ...totals,
    estimatedHours: round(totals.estimatedHours),
    observedHours: round(totals.observedHours),
    openAgeHours: round(totals.openAgeHours),
    estimatedCost: round(totals.estimatedCost),
    observedCost: round(totals.observedCost),
  };
}

function taskReport(task, hourlyRate) {
  const events = collectTaskEvents(task);
  const contributors = contributorsForTask(task, events);
  const primaryAgentId = primaryAgentForTask(task, contributors);
  const estimate = estimatedHours(task);
  const observed = observedHours(task, events);
  const openAge = openAgeHours(task);
  const first = events[0] ?? null;
  const last = events.at(-1) ?? null;
  return {
    taskId: task.id,
    title: task.title || task.summary || task.id,
    status: task.status || 'unknown',
    primaryAgentId,
    contributors,
    effort: task.effort ?? null,
    estimatedHours: round(estimate),
    observedHours: round(observed),
    openAgeHours: round(openAge),
    estimatedCost: round(estimate * hourlyRate),
    observedCost: round(observed * hourlyRate),
    firstActivityAt: first?.at ?? null,
    lastActivityAt: last?.at ?? null,
    agentObservedHours: Object.fromEntries(contributors.map((agentId) => [agentId, round(agentObservedHours(events, agentId))])),
    _events: events,
  };
}

function parseDateFlag(argv, flag) {
  const value = getFlagValue(argv, flag, '');
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ${flag} date "${value}".`);
  return timestamp;
}

export function buildCostTimeReport(context, argv = []) {
  const valuedFlags = new Set(['--agent', '--task', '--from', '--to', '--rate', '--currency']);
  const positionalTaskIds = getPositionals(argv, valuedFlags);
  const taskFlagIds = getFlagValue(argv, '--task', '').split(',').map((entry) => entry.trim()).filter(Boolean);
  const selectedTaskIds = new Set([...positionalTaskIds, ...taskFlagIds]);
  const selectedAgents = new Set(getFlagValue(argv, '--agent', '').split(',').map((entry) => entry.trim()).filter(Boolean));
  const fromMs = parseDateFlag(argv, '--from');
  const toMs = parseDateFlag(argv, '--to');
  const hourlyRate = Math.max(0, parseNumber(getFlagValue(argv, '--rate', '0'), 0));
  const currency = stringValue(getFlagValue(argv, '--currency', DEFAULT_CURRENCY)).toUpperCase() || DEFAULT_CURRENCY;
  const tasks = array(context.board?.tasks);
  const agentTotals = new Map();
  const taskReports = [];

  for (const task of tasks) {
    if (selectedTaskIds.size && !selectedTaskIds.has(task.id)) continue;
    const report = taskReport(task, hourlyRate);
    if (!overlapsWindow(report._events, fromMs, toMs)) continue;
    if (selectedAgents.size && !report.contributors.some((agentId) => selectedAgents.has(agentId)) && !selectedAgents.has(report.primaryAgentId)) continue;
    taskReports.push(report);
    for (const agentId of report.contributors) {
      if (selectedAgents.size && !selectedAgents.has(agentId)) continue;
      addAgentTask(agentTotals, report, agentId, hourlyRate);
    }
  }

  const finalizedTasks = taskReports
    .map(({ _events, ...report }) => report)
    .sort((left, right) => right.estimatedHours - left.estimatedHours || left.taskId.localeCompare(right.taskId));
  const agents = [...agentTotals.values()]
    .map(finalizeAgentTotals)
    .sort((left, right) => right.estimatedHours - left.estimatedHours || left.agentId.localeCompare(right.agentId));
  const totals = finalizedTasks.reduce((summary, task) => {
    summary.tasks += 1;
    summary.estimatedHours += task.estimatedHours;
    summary.observedHours += task.observedHours;
    summary.openAgeHours += task.openAgeHours;
    summary.estimatedCost += task.estimatedCost;
    summary.observedCost += task.observedCost;
    if (TERMINAL_STATUSES.has(task.status)) summary.completedTasks += 1;
    if (ACTIVE_STATUSES.has(task.status)) summary.activeTasks += 1;
    return summary;
  }, { tasks: 0, activeTasks: 0, completedTasks: 0, estimatedHours: 0, observedHours: 0, openAgeHours: 0, estimatedCost: 0, observedCost: 0 });

  for (const key of ['estimatedHours', 'observedHours', 'openAgeHours', 'estimatedCost', 'observedCost']) totals[key] = round(totals[key]);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    rate: { hourly: hourlyRate, currency },
    filters: {
      taskIds: [...selectedTaskIds],
      agentIds: [...selectedAgents],
      from: getFlagValue(argv, '--from', '') || null,
      to: getFlagValue(argv, '--to', '') || null,
    },
    totals,
    agents,
    tasks: finalizedTasks,
  };
}

function money(currency, amount) {
  return `${currency} ${amount.toFixed(2)}`;
}

function renderCostTime(report) {
  const lines = ['# Cost/Time Accounting'];
  lines.push(`Rate: ${money(report.rate.currency, report.rate.hourly)}/hour`);
  lines.push(`Totals: ${report.totals.tasks} task(s); estimated ${report.totals.estimatedHours}h (${money(report.rate.currency, report.totals.estimatedCost)}); observed ${report.totals.observedHours}h (${money(report.rate.currency, report.totals.observedCost)}); open age ${report.totals.openAgeHours}h`);
  if (!report.tasks.length) {
    lines.push('- no tasks matched');
    return lines.join('\n');
  }
  lines.push('');
  lines.push('Agents:');
  lines.push(report.agents.length ? report.agents.map((agent) => `- ${agent.agentId}: ${agent.tasks} task(s), estimated ${agent.estimatedHours}h, observed ${agent.observedHours}h, open age ${agent.openAgeHours}h, estimated ${money(report.rate.currency, agent.estimatedCost)}`).join('\n') : '- none');
  lines.push('');
  lines.push('Tasks:');
  for (const task of report.tasks.slice(0, 25)) {
    lines.push(`- ${task.taskId}: ${task.status}${task.primaryAgentId ? ` / ${task.primaryAgentId}` : ''} | estimated ${task.estimatedHours}h (${money(report.rate.currency, task.estimatedCost)}) | observed ${task.observedHours}h (${money(report.rate.currency, task.observedCost)}) | contributors ${task.contributors.join(', ') || 'none'}`);
  }
  return lines.join('\n');
}

export function runCostTime(argv, context) {
  const report = buildCostTimeReport(context, argv);
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(renderCostTime(report));
  return 0;
}
