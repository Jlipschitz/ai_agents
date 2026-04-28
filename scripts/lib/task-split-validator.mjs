import fs from 'node:fs';
import path from 'node:path';

import { getFlagValue, hasFlag } from './args-utils.mjs';
import { printCommandError } from './error-formatting.mjs';
import { buildPathGroups } from './path-group-commands.mjs';
import { normalizePath, resolveRepoPath } from './path-utils.mjs';

const VALIDATED_STATUSES = new Set(['planned', 'active', 'blocked', 'waiting', 'review', 'handoff']);
const ERROR_CODES = new Set(['missingDependency', 'selfDependency', 'dependencyCycle', 'overlappingOwnership']);

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => normalizePath(entry.trim())) : [];
}

function pathMatchesScope(filePath, scope) {
  const normalizedPath = normalizePath(filePath);
  const normalizedScope = normalizePath(scope);
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

function pathsOverlap(left, right) {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(`${normalizedRight}/`) || normalizedRight.startsWith(`${normalizedLeft}/`);
}

function finding(code, message, details = {}) {
  return {
    code,
    severity: ERROR_CODES.has(code) ? 'error' : 'warning',
    message,
    ...details,
  };
}

function taskTitle(task) {
  return task.title || task.summary || task.id;
}

function loadBoard(context, argv) {
  const boardPath = getFlagValue(argv, '--board', '');
  if (!boardPath) return context.board;
  const resolved = resolveRepoPath(boardPath, boardPath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function selectedTasks(board, argv) {
  const taskId = getFlagValue(argv, '--task', '');
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  return tasks.filter((task) => {
    if (taskId) return task.id === taskId;
    return VALIDATED_STATUSES.has(task.status);
  });
}

function validateDependencies(tasks, allTasks) {
  const findings = [];
  const tasksById = new Map(allTasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    for (const dependencyId of stringArray(task.dependencies)) {
      if (dependencyId === task.id) {
        findings.push(finding('selfDependency', `Task ${task.id} depends on itself.`, { taskId: task.id, dependencyId }));
      } else if (!tasksById.has(dependencyId)) {
        findings.push(finding('missingDependency', `Task ${task.id} depends on missing task ${dependencyId}.`, { taskId: task.id, dependencyId }));
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(taskId, trail) {
    if (visiting.has(taskId)) {
      findings.push(finding('dependencyCycle', `Dependency cycle detected: ${[...trail.slice(trail.indexOf(taskId)), taskId].join(' -> ')}.`, { taskIds: [...trail, taskId] }));
      return;
    }
    if (visited.has(taskId)) return;
    const task = tasksById.get(taskId);
    if (!task) return;
    visiting.add(taskId);
    for (const dependencyId of stringArray(task.dependencies)) visit(dependencyId, [...trail, dependencyId]);
    visiting.delete(taskId);
    visited.add(taskId);
  }
  for (const task of tasks) visit(task.id, [task.id]);
  return findings;
}

function validateOverlaps(tasks) {
  const findings = [];
  for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tasks.length; rightIndex += 1) {
      const left = tasks[leftIndex];
      const right = tasks[rightIndex];
      for (const leftPath of stringArray(left.claimedPaths)) {
        const rightPath = stringArray(right.claimedPaths).find((candidate) => pathsOverlap(leftPath, candidate));
        if (!rightPath) continue;
        findings.push(finding('overlappingOwnership', `Tasks ${left.id} and ${right.id} overlap on ${leftPath} and ${rightPath}.`, { taskIds: [left.id, right.id], paths: [leftPath, rightPath] }));
      }
    }
  }
  return findings;
}

function validateTaskShape(root, config, task) {
  const findings = [];
  const claimedPaths = stringArray(task.claimedPaths);
  const broadPathPatterns = stringArray(config.ownership?.broadPathPatterns);
  if (!claimedPaths.length) {
    findings.push(finding('missingClaimedPaths', `Task ${task.id} has no claimed paths.`, { taskId: task.id }));
  }
  const broadPaths = claimedPaths.filter((claimedPath) => broadPathPatterns.some((pattern) => normalizePath(pattern) === claimedPath));
  if (broadPaths.length) {
    findings.push(finding('broadClaimedPaths', `Task ${task.id} claims broad path(s): ${broadPaths.join(', ')}.`, { taskId: task.id, paths: broadPaths }));
  }
  const verification = Array.isArray(task.verification) ? task.verification.filter(Boolean) : [];
  const verificationLog = Array.isArray(task.verificationLog) ? task.verificationLog : [];
  if (!verification.length && !verificationLog.length) {
    findings.push(finding('missingVerification', `Task ${task.id} has no planned verification.`, { taskId: task.id }));
  }

  const grouped = buildPathGroups({ root, config, board: { tasks: [task] } }, []);
  const categories = [...new Set(grouped.groups.map((group) => group.category))].filter((category) => category !== 'other');
  if (grouped.groups.length > 3) {
    findings.push(finding('tooManyPathGroups', `Task ${task.id} spans ${grouped.groups.length} path groups.`, { taskId: task.id, groups: grouped.groups.map((group) => group.id) }));
  }
  if (categories.length > 2) {
    findings.push(finding('tooManyCategories', `Task ${task.id} spans ${categories.length} work categories: ${categories.join(', ')}.`, { taskId: task.id, categories }));
  }

  const sharedRisk = stringArray(config.paths?.sharedRisk);
  const sharedRiskPaths = claimedPaths.filter((claimedPath) => sharedRisk.some((scope) => pathMatchesScope(claimedPath, scope)));
  if (sharedRiskPaths.length && claimedPaths.length > 1) {
    findings.push(finding('sharedRiskMixedWithOtherPaths', `Task ${task.id} mixes shared-risk path(s) with other paths: ${sharedRiskPaths.join(', ')}.`, { taskId: task.id, paths: sharedRiskPaths }));
  }

  return findings;
}

export function buildTaskSplitValidation(context, argv = []) {
  const board = loadBoard(context, argv);
  const allTasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const tasks = selectedTasks(board, argv);
  const findings = [
    ...validateDependencies(tasks, allTasks),
    ...validateOverlaps(tasks),
    ...tasks.flatMap((task) => validateTaskShape(context.root, context.config, task)),
  ];
  const uniqueFindings = [];
  const seen = new Set();
  for (const entry of findings) {
    const key = JSON.stringify([entry.code, entry.taskId, entry.dependencyId, entry.taskIds, entry.paths, entry.message]);
    if (!seen.has(key)) {
      uniqueFindings.push(entry);
      seen.add(key);
    }
  }
  return {
    ok: uniqueFindings.every((entry) => entry.severity !== 'error'),
    generatedAt: new Date().toISOString(),
    tasks: tasks.map((task) => ({ taskId: task.id, title: taskTitle(task), status: task.status || 'unknown', claimedPaths: stringArray(task.claimedPaths) })),
    findings: uniqueFindings.sort((left, right) => left.severity.localeCompare(right.severity) || left.code.localeCompare(right.code)),
    summary: {
      tasks: tasks.length,
      errors: uniqueFindings.filter((entry) => entry.severity === 'error').length,
      warnings: uniqueFindings.filter((entry) => entry.severity === 'warning').length,
    },
  };
}

function renderTaskSplitValidation(report, strict) {
  const lines = ['# Task Split Validation'];
  lines.push(`Tasks: ${report.summary.tasks}; errors: ${report.summary.errors}; warnings: ${report.summary.warnings}`);
  if (strict) lines.push('Strict: enabled');
  if (!report.findings.length) {
    lines.push('- no findings');
    return lines.join('\n');
  }
  lines.push('');
  lines.push('Findings:');
  for (const entry of report.findings) {
    lines.push(`- [${entry.severity}] ${entry.code}: ${entry.message}`);
  }
  return lines.join('\n');
}

export function runTaskSplitValidation(argv, context) {
  const json = hasFlag(argv, '--json');
  const strict = hasFlag(argv, '--strict');
  try {
    const report = buildTaskSplitValidation(context, argv);
    if (json) console.log(JSON.stringify({ ...report, strict }, null, 2));
    else console.log(renderTaskSplitValidation(report, strict));
    return strict && !report.ok ? 1 : 0;
  } catch (error) {
    return printCommandError(error.message, { json });
  }
}
