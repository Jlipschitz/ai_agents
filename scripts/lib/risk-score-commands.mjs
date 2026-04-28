import { getPositionals, hasFlag } from './args-utils.mjs';
import { buildOwnershipReview } from './impact-commands.mjs';
import { normalizePath } from './path-utils.mjs';

const SCORED_STATUSES = new Set(['planned', 'active', 'blocked', 'waiting', 'review', 'handoff', 'done']);
const TERMINAL_STATUSES = new Set(['done', 'released']);
const PRIORITY_POINTS = { low: 0, normal: 0, high: 2, urgent: 4 };
const SEVERITY_POINTS = { none: 0, low: 1, medium: 3, high: 5, critical: 8 };

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : [];
}

function pathMatchesScope(filePath, scope) {
  const normalizedPath = normalizePath(filePath);
  const normalizedScope = normalizePath(scope);
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

function pathsOverlap(left, right) {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(`${normalizedRight}/`) || normalizedRight.startsWith(`${normalizedLeft}/`);
}

function latestVerification(task) {
  const latest = new Map();
  for (const entry of Array.isArray(task?.verificationLog) ? task.verificationLog : []) {
    if (entry?.check) latest.set(entry.check, String(entry.outcome || entry.status || '').toLowerCase());
  }
  return latest;
}

function factor(code, points, message, extra = {}) {
  return { code, points, message, ...extra };
}

function riskLevel(score) {
  if (score >= 30) return 'critical';
  if (score >= 18) return 'high';
  if (score >= 8) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

function visualImpactMatches(config, claimedPaths) {
  const visualPaths = stringArray(config.paths?.visualImpact);
  const visualFiles = stringArray(config.paths?.visualImpactFiles);
  return claimedPaths.filter((filePath) =>
    visualFiles.includes(filePath) || visualPaths.some((scope) => pathMatchesScope(filePath, scope))
  );
}

function sharedRiskMatches(config, claimedPaths) {
  const sharedRisk = stringArray(config.paths?.sharedRisk);
  return claimedPaths.filter((filePath) => sharedRisk.some((scope) => pathMatchesScope(filePath, scope)));
}

function ownershipFactorsByTask({ root, config, board }) {
  const review = buildOwnershipReview({ root, config, board, activeStatuses: SCORED_STATUSES });
  const byTask = new Map();
  for (const detail of Array.isArray(review.findingDetails) ? review.findingDetails : []) {
    const factors = byTask.get(detail.taskId) ?? [];
    if (detail.type === 'broad-claim') {
      factors.push(factor('broadClaim', 8, `Claims broad path(s): ${detail.paths.join(', ')}.`, { paths: detail.paths }));
    } else if (detail.type === 'codeownersCrossing') {
      factors.push(factor('codeownersCrossing', 10, detail.message, { owners: detail.owners }));
    } else if (detail.type === 'codeowners-crossing') {
      factors.push(factor('codeownersCrossing', 10, detail.message, { owners: detail.owners }));
    }
    byTask.set(detail.taskId, factors);
  }
  return byTask;
}

function overlapFactorsByTask(tasks, activeStatuses) {
  const byTask = new Map();
  const activeTasks = tasks.filter((task) => activeStatuses.has(task.status));
  for (let leftIndex = 0; leftIndex < activeTasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < activeTasks.length; rightIndex += 1) {
      const left = activeTasks[leftIndex];
      const right = activeTasks[rightIndex];
      for (const leftPath of stringArray(left.claimedPaths)) {
        const rightPath = stringArray(right.claimedPaths).find((candidate) => pathsOverlap(leftPath, candidate));
        if (!rightPath) continue;
        const leftFactors = byTask.get(left.id) ?? [];
        const rightFactors = byTask.get(right.id) ?? [];
        leftFactors.push(factor('activeOverlap', 12, `Overlaps active task ${right.id}: ${leftPath} vs ${rightPath}.`, { taskId: right.id, paths: [leftPath, rightPath] }));
        rightFactors.push(factor('activeOverlap', 12, `Overlaps active task ${left.id}: ${rightPath} vs ${leftPath}.`, { taskId: left.id, paths: [rightPath, leftPath] }));
        byTask.set(left.id, leftFactors);
        byTask.set(right.id, rightFactors);
      }
    }
  }
  return byTask;
}

function dependencyFactors(task, tasksById) {
  return stringArray(task.dependencies).flatMap((dependencyId) => {
    const dependency = tasksById.get(dependencyId);
    if (!dependency) return [factor('missingDependency', 8, `Dependency ${dependencyId} is missing.`, { dependencyId })];
    if (!TERMINAL_STATUSES.has(dependency.status)) {
      return [factor('openDependency', 6, `Dependency ${dependencyId} is ${dependency.status}; expected done or released.`, { dependencyId, status: dependency.status })];
    }
    return [];
  });
}

function verificationFactors(task) {
  const latest = latestVerification(task);
  const factors = [];
  for (const check of stringArray(task.verification)) {
    const outcome = latest.get(check);
    if (outcome === 'fail') factors.push(factor('failingVerification', 10, `Latest verification is failing for ${check}.`, { check }));
    else if (outcome !== 'pass') factors.push(factor('missingVerification', 5, `Missing passing verification for ${check}.`, { check }));
  }
  return factors;
}

function visualFactors(config, task) {
  const claimedPaths = stringArray(task.claimedPaths);
  const matchedPaths = visualImpactMatches(config, claimedPaths);
  if (!matchedPaths.length) return [];
  const checks = stringArray(config.verification?.visualRequiredChecks);
  if (!checks.length) return [factor('visualImpactNoChecks', 6, `Visual-impact paths have no configured visual required checks: ${matchedPaths.join(', ')}.`, { paths: matchedPaths })];
  const latest = latestVerification(task);
  const missing = checks.filter((check) => latest.get(check) !== 'pass');
  return missing.length ? [factor('visualVerificationMissing', 8, `Visual-impact paths are missing passing checks: ${missing.join(', ')}.`, { paths: matchedPaths, checks: missing })] : [];
}

function metadataFactors(task) {
  const factors = [];
  const priorityPoints = PRIORITY_POINTS[task.priority] ?? 0;
  const severityPoints = SEVERITY_POINTS[task.severity] ?? 0;
  if (priorityPoints) factors.push(factor('priority', priorityPoints, `Priority is ${task.priority}.`, { priority: task.priority }));
  if (severityPoints) factors.push(factor('severity', severityPoints, `Severity is ${task.severity}.`, { severity: task.severity }));
  if (task.dueAt) {
    const due = Date.parse(task.dueAt);
    if (Number.isFinite(due)) {
      const hoursUntilDue = (due - Date.now()) / 36e5;
      if (hoursUntilDue < 0) factors.push(factor('overdue', 6, `Due date is overdue: ${task.dueAt}.`, { dueAt: task.dueAt }));
      else if (hoursUntilDue <= 24) factors.push(factor('dueSoon', 3, `Due date is within 24 hours: ${task.dueAt}.`, { dueAt: task.dueAt }));
    }
  }
  return factors;
}

function taskStatusFactors(task) {
  if (task.status === 'blocked') return [factor('blocked', 7, 'Task is blocked.')];
  if (task.status === 'waiting') return [factor('waiting', 4, 'Task is waiting on another task or external input.')];
  if (task.status === 'handoff') return [factor('handoff', 3, 'Task is in handoff state.')];
  return [];
}

function scoreTask({ task, config, tasksById, ownershipFactors, overlapFactors }) {
  const claimedPaths = stringArray(task.claimedPaths);
  const factors = [
    ...(ownershipFactors.get(task.id) ?? []),
    ...(overlapFactors.get(task.id) ?? []),
    ...sharedRiskMatches(config, claimedPaths).map((filePath) => factor('sharedRiskPath', 6, `Claims shared-risk path: ${filePath}.`, { path: filePath })),
    ...dependencyFactors(task, tasksById),
    ...verificationFactors(task),
    ...visualFactors(config, task),
    ...(stringArray(task.relevantDocs).length && !task.docsReviewedAt ? [factor('docsReviewMissing', 4, `Relevant docs are not reviewed: ${stringArray(task.relevantDocs).join(', ')}.`, { docs: stringArray(task.relevantDocs) })] : []),
    ...metadataFactors(task),
    ...taskStatusFactors(task),
  ];
  const score = factors.reduce((sum, entry) => sum + entry.points, 0);
  return {
    taskId: task.id,
    title: task.title || task.summary || task.id,
    status: task.status || 'unknown',
    ownerId: task.ownerId ?? null,
    claimedPaths,
    score,
    level: riskLevel(score),
    factors,
  };
}

export function buildRiskScores({ root, config, board, activeStatuses, taskIds = [] }) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const requested = new Set(taskIds);
  const selectedTasks = tasks.filter((task) => (requested.size ? requested.has(task.id) : SCORED_STATUSES.has(task.status)));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const ownershipFactors = ownershipFactorsByTask({ root, config, board: { ...board, tasks: selectedTasks } });
  const overlapFactors = overlapFactorsByTask(tasks, activeStatuses);
  const scores = selectedTasks.map((task) => scoreTask({ task, config, tasksById, ownershipFactors, overlapFactors }))
    .sort((left, right) => right.score - left.score || left.taskId.localeCompare(right.taskId));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    tasks: scores,
    summary: {
      total: scores.length,
      critical: scores.filter((entry) => entry.level === 'critical').length,
      high: scores.filter((entry) => entry.level === 'high').length,
      medium: scores.filter((entry) => entry.level === 'medium').length,
      low: scores.filter((entry) => entry.level === 'low').length,
      none: scores.filter((entry) => entry.level === 'none').length,
    },
  };
}

function renderRiskScores(report) {
  const lines = ['# Risk Score'];
  lines.push(`Tasks: ${report.summary.total}; critical: ${report.summary.critical}; high: ${report.summary.high}; medium: ${report.summary.medium}; low: ${report.summary.low}; none: ${report.summary.none}`);
  if (!report.tasks.length) {
    lines.push('- no tasks scored');
    return lines.join('\n');
  }
  for (const task of report.tasks) {
    lines.push(`\n${task.taskId}: ${task.level} (${task.score})`);
    lines.push(`Status: ${task.status}${task.ownerId ? ` / ${task.ownerId}` : ''}`);
    lines.push(task.factors.length ? task.factors.map((entry) => `- +${entry.points} ${entry.code}: ${entry.message}`).join('\n') : '- no risk factors');
  }
  return lines.join('\n');
}

export function runRiskScore(argv, context) {
  const taskIds = getPositionals(argv);
  const report = buildRiskScores({ ...context, taskIds });
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(renderRiskScores(report));
  return 0;
}
