import { hasFlag } from './args-utils.mjs';
import { buildRiskScores } from './risk-score-commands.mjs';

const TERMINAL_STATUSES = new Set(['done', 'released']);
const EFFORT_COSTS = {
  tiny: 0.5,
  small: 1,
  medium: 2,
  large: 3,
  xlarge: 5,
  unknown: 1,
};
const RISK_COSTS = {
  none: 0,
  low: 0,
  medium: 0.5,
  high: 1,
  critical: 1.5,
};

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : [];
}

function taskTitle(task) {
  return task.title || task.summary || task.id;
}

function taskBaseCost(task) {
  const effort = String(task.effort || 'unknown').toLowerCase();
  return EFFORT_COSTS[effort] ?? EFFORT_COSTS.unknown;
}

function isReady(task, tasksById) {
  return stringArray(task.dependencies).every((dependencyId) => {
    const dependency = tasksById.get(dependencyId);
    return dependency && TERMINAL_STATUSES.has(dependency.status);
  });
}

function buildDependents(tasks) {
  const dependents = new Map();
  for (const task of tasks) dependents.set(task.id, []);
  for (const task of tasks) {
    for (const dependencyId of stringArray(task.dependencies)) {
      if (!dependents.has(dependencyId)) dependents.set(dependencyId, []);
      dependents.get(dependencyId).push(task.id);
    }
  }
  return dependents;
}

function findCycles(tasks, dependents) {
  const warnings = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(taskId, path) {
    if (visiting.has(taskId)) {
      warnings.push(`Dependency cycle detected: ${[...path.slice(path.indexOf(taskId)), taskId].join(' -> ')}.`);
      return;
    }
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const dependentId of dependents.get(taskId) ?? []) visit(dependentId, [...path, dependentId]);
    visiting.delete(taskId);
    visited.add(taskId);
  }

  for (const task of tasks) visit(task.id, [task.id]);
  return [...new Set(warnings)];
}

function buildPathFrom(startId, dependents, scoredTasks, pathScores) {
  const taskIds = [];
  let currentId = startId;
  const seen = new Set();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    taskIds.push(currentId);
    const next = (dependents.get(currentId) ?? [])
      .filter((dependentId) => scoredTasks.has(dependentId))
      .sort((left, right) => (pathScores.get(right) ?? 0) - (pathScores.get(left) ?? 0) || left.localeCompare(right))[0];
    currentId = next;
  }
  return taskIds;
}

export function buildCriticalPath({ root, config, board, activeStatuses }) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const remainingTasks = tasks.filter((task) => !TERMINAL_STATUSES.has(task.status));
  const remainingIds = new Set(remainingTasks.map((task) => task.id));
  const dependents = buildDependents(tasks);
  const riskReport = buildRiskScores({ root, config, board, activeStatuses });
  const riskByTask = new Map(riskReport.tasks.map((entry) => [entry.taskId, entry]));
  const warnings = [];

  for (const task of tasks) {
    for (const dependencyId of stringArray(task.dependencies)) {
      if (!tasksById.has(dependencyId)) warnings.push(`Task ${task.id} depends on missing task ${dependencyId}.`);
    }
  }
  warnings.push(...findCycles(tasks, dependents));

  const memo = new Map();
  const visiting = new Set();

  function pathCost(taskId) {
    if (!remainingIds.has(taskId)) return 0;
    if (memo.has(taskId)) return memo.get(taskId);
    if (visiting.has(taskId)) return 0;
    visiting.add(taskId);
    const task = tasksById.get(taskId);
    const risk = riskByTask.get(taskId);
    const ownCost = taskBaseCost(task) + (RISK_COSTS[risk?.level ?? 'none'] ?? 0);
    const downstream = (dependents.get(taskId) ?? [])
      .filter((dependentId) => remainingIds.has(dependentId))
      .map((dependentId) => pathCost(dependentId));
    const total = ownCost + (downstream.length ? Math.max(...downstream) : 0);
    visiting.delete(taskId);
    memo.set(taskId, total);
    return total;
  }

  for (const task of remainingTasks) pathCost(task.id);
  const startId = remainingTasks
    .map((task) => task.id)
    .sort((left, right) => (memo.get(right) ?? 0) - (memo.get(left) ?? 0) || left.localeCompare(right))[0] ?? null;
  const criticalTaskIds = startId ? buildPathFrom(startId, dependents, remainingIds, memo) : [];
  const criticalTasks = criticalTaskIds.map((taskId) => {
    const task = tasksById.get(taskId);
    const risk = riskByTask.get(taskId);
    return {
      taskId,
      title: taskTitle(task),
      status: task.status || 'unknown',
      ownerId: task.ownerId ?? null,
      effort: task.effort || 'unknown',
      riskLevel: risk?.level ?? 'none',
      ownCost: taskBaseCost(task) + (RISK_COSTS[risk?.level ?? 'none'] ?? 0),
      downstreamCost: memo.get(taskId) ?? 0,
    };
  });
  const readyTasks = remainingTasks
    .filter((task) => isReady(task, tasksById))
    .map((task) => ({ taskId: task.id, title: taskTitle(task), status: task.status || 'unknown', riskLevel: riskByTask.get(task.id)?.level ?? 'none', downstreamCost: memo.get(task.id) ?? 0 }))
    .sort((left, right) => right.downstreamCost - left.downstreamCost || left.taskId.localeCompare(right.taskId));
  const blockedTasks = remainingTasks
    .filter((task) => !isReady(task, tasksById))
    .map((task) => ({
      taskId: task.id,
      title: taskTitle(task),
      status: task.status || 'unknown',
      waitingOn: stringArray(task.dependencies).filter((dependencyId) => !TERMINAL_STATUSES.has(tasksById.get(dependencyId)?.status)),
      downstreamCost: memo.get(task.id) ?? 0,
    }))
    .sort((left, right) => right.downstreamCost - left.downstreamCost || left.taskId.localeCompare(right.taskId));

  return {
    ok: warnings.length === 0,
    generatedAt: new Date().toISOString(),
    criticalPath: {
      totalCost: startId ? memo.get(startId) ?? 0 : 0,
      taskIds: criticalTaskIds,
      tasks: criticalTasks,
    },
    readyTasks,
    blockedTasks,
    warnings: [...new Set(warnings)],
  };
}

function renderCriticalPath(report) {
  const lines = ['# Critical Path'];
  lines.push(`Total remaining cost: ${report.criticalPath.totalCost}`);
  if (report.criticalPath.tasks.length) {
    lines.push('Path:');
    for (const task of report.criticalPath.tasks) {
      lines.push(`- ${task.taskId}: ${task.title} (${task.status}, effort ${task.effort}, risk ${task.riskLevel}, cost ${task.ownCost})`);
    }
  } else {
    lines.push('Path: none');
  }
  lines.push('');
  lines.push('Ready next:');
  lines.push(report.readyTasks.length ? report.readyTasks.slice(0, 10).map((task) => `- ${task.taskId}: ${task.title} (${task.status}, path cost ${task.downstreamCost})`).join('\n') : '- none');
  if (report.warnings.length) {
    lines.push('');
    lines.push('Warnings:');
    lines.push(report.warnings.map((warning) => `- ${warning}`).join('\n'));
  }
  return lines.join('\n');
}

export function runCriticalPath(argv, context) {
  const report = buildCriticalPath(context);
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(renderCriticalPath(report));
  return report.ok ? 0 : 1;
}
