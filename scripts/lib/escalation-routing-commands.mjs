import { getFlagValue, hasFlag } from './args-utils.mjs';
import { findCodeowners, ownersForPath } from './impact-commands.mjs';
import { normalizePath } from './path-utils.mjs';

const SOURCE_POINTS = {
  activeOwner: 10,
  previousTask: 5,
  codeowners: 4,
};
const HISTORICAL_STATUSES = new Set(['done', 'released']);

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => normalizePath(entry.trim())) : [];
}

function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => normalizePath(entry.trim()))
    .filter(Boolean);
}

function pathsOverlap(left, right) {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(`${normalizedRight}/`) || normalizedRight.startsWith(`${normalizedLeft}/`);
}

function selectedTask(board, taskId) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  return taskId ? tasks.find((task) => task.id === taskId) : tasks.find((task) => ['blocked', 'waiting'].includes(task.status));
}

function targetInput(argv, board) {
  const taskId = getFlagValue(argv, '--task', '');
  const task = selectedTask(board, taskId);
  const explicitPaths = splitList(getFlagValue(argv, '--paths', ''));
  const paths = [...new Set([...explicitPaths, ...stringArray(task?.claimedPaths)])];
  const reason = getFlagValue(argv, '--reason', task?.blockedReason || task?.waitReason || task?.status || '');
  return { task: task ?? null, taskId: (task?.id ?? taskId) || null, paths, reason };
}

function addSuggestion(suggestions, target, source, points, reason, extra = {}) {
  if (!target) return;
  const key = String(target);
  const existing = suggestions.get(key) ?? { target: key, score: 0, sources: [], reasons: [], paths: [], taskIds: [] };
  existing.score += points;
  existing.sources = [...new Set([...existing.sources, source])];
  existing.reasons.push(reason);
  existing.paths = [...new Set([...existing.paths, ...stringArray(extra.paths)])];
  existing.taskIds = [...new Set([...existing.taskIds, ...stringArray(extra.taskIds)])];
  suggestions.set(key, existing);
}

export function buildEscalationRoutes({ root, config, board, activeStatuses }, argv = []) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const input = targetInput(argv, board);
  const codeowners = findCodeowners(root, config);
  const suggestions = new Map();

  for (const filePath of input.paths) {
    for (const owner of ownersForPath(filePath, codeowners.rules)) {
      addSuggestion(suggestions, owner, 'codeowners', SOURCE_POINTS.codeowners, `CODEOWNERS owns ${filePath}.`, { paths: [filePath] });
    }
  }

  for (const task of tasks) {
    if (input.task?.id && task.id === input.task.id) continue;
    const matchingPaths = stringArray(task.claimedPaths).filter((claimedPath) => input.paths.some((filePath) => pathsOverlap(filePath, claimedPath)));
    if (!matchingPaths.length || !task.ownerId) continue;
    if (activeStatuses.has(task.status)) {
      addSuggestion(suggestions, task.ownerId, 'activeOwner', SOURCE_POINTS.activeOwner, `Owns overlapping active task ${task.id}.`, { paths: matchingPaths, taskIds: [task.id] });
    } else if (HISTORICAL_STATUSES.has(task.status)) {
      addSuggestion(suggestions, task.ownerId, 'previousTask', SOURCE_POINTS.previousTask, `Previously completed overlapping task ${task.id}.`, { paths: matchingPaths, taskIds: [task.id] });
    }
  }

  const routes = [...suggestions.values()]
    .map((entry) => ({ ...entry, reasons: [...new Set(entry.reasons)] }))
    .sort((left, right) => right.score - left.score || left.target.localeCompare(right.target));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    input,
    codeownersPath: codeowners.path,
    routes,
    summary: {
      routes: routes.length,
      paths: input.paths.length,
      hasTask: Boolean(input.task),
    },
  };
}

function renderEscalationRoutes(report) {
  const lines = ['# Escalation Routes'];
  if (report.input.taskId) lines.push(`Task: ${report.input.taskId}`);
  if (report.input.reason) lines.push(`Reason: ${report.input.reason}`);
  lines.push(`Paths: ${report.input.paths.length ? report.input.paths.join(', ') : 'none'}`);
  lines.push(`CODEOWNERS: ${report.codeownersPath ?? 'not found'}`);
  if (!report.routes.length) {
    lines.push('- no routes found');
    return lines.join('\n');
  }
  lines.push('');
  lines.push('Routes:');
  for (const route of report.routes) {
    lines.push(`- ${route.target} (score ${route.score}; ${route.sources.join(', ')})`);
    for (const reason of route.reasons) lines.push(`  - ${reason}`);
  }
  return lines.join('\n');
}

export function runEscalationRoutes(argv, context) {
  const report = buildEscalationRoutes(context, argv);
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(renderEscalationRoutes(report));
  return 0;
}
