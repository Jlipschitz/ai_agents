import fs from 'node:fs';
import path from 'node:path';

import { getNumberFlag, hasFlag } from './args-utils.mjs';
import { buildCriticalPath } from './critical-path-commands.mjs';
import { buildRiskScores } from './risk-score-commands.mjs';

const SECTION_WEIGHTS = {
  setup: 0.25,
  work: 0.3,
  verification: 0.25,
  runtime: 0.2,
};
const REQUIRED_PACKAGE_SCRIPTS = ['agents', 'agents:doctor', 'agents:status', 'check', 'validate:agents-config'];
const STALE_TASK_HOURS = 24;
const STALE_WATCHER_HOURS = 2;
const STALE_HEARTBEAT_HOURS = 2;
const STALE_LOCK_HOURS = 1;
const TERMINAL_STATUSES = new Set(['done', 'released']);

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : [];
}

function readJsonSafe(filePath, fallback = null) {
  if (!filePath) return fallback;
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { malformed: true, error: error.message };
  }
}

function hoursSince(value) {
  const timestamp = Date.parse(String(value ?? ''));
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (Date.now() - timestamp) / 36e5);
}

function severityForPoints(points) {
  if (points >= 15) return 'critical';
  if (points >= 10) return 'high';
  if (points >= 5) return 'medium';
  return 'low';
}

function issue(section, code, points, message, extra = {}) {
  return { section, code, severity: severityForPoints(points), points, message, ...extra };
}

function buildSetupIssues({ root, config, packageJson, paths }) {
  const issues = [];
  if (!fs.existsSync(path.join(root, 'agent-coordination.config.json'))) {
    issues.push(issue('setup', 'missingConfigFile', 15, 'agent-coordination.config.json is missing.'));
  }
  if (!packageJson || typeof packageJson !== 'object') {
    issues.push(issue('setup', 'missingPackageJson', 10, 'package.json is missing or unreadable.'));
  } else {
    const scripts = packageJson.scripts && typeof packageJson.scripts === 'object' ? packageJson.scripts : {};
    const missingScripts = REQUIRED_PACKAGE_SCRIPTS.filter((scriptName) => !scripts[scriptName]);
    if (missingScripts.length) {
      issues.push(issue('setup', 'missingPackageScripts', missingScripts.length * 3, `Missing package scripts: ${missingScripts.join(', ')}.`, { scripts: missingScripts }));
    }
  }
  if (paths?.coordinationRoot && !fs.existsSync(paths.coordinationRoot)) {
    issues.push(issue('setup', 'missingCoordinationRoot', 10, `Coordination root is missing: ${paths.coordinationRoot}.`, { path: paths.coordinationRoot }));
  }
  if (paths?.boardPath && !fs.existsSync(paths.boardPath)) {
    issues.push(issue('setup', 'missingBoard', 10, `Board file is missing: ${paths.boardPath}.`, { path: paths.boardPath }));
  }
  const missingDocsRoots = stringArray(config.docs?.roots).filter((docsRoot) => !fs.existsSync(path.resolve(root, docsRoot)));
  if (missingDocsRoots.length) {
    issues.push(issue('setup', 'missingDocsRoots', missingDocsRoots.length * 4, `Configured docs roots are missing: ${missingDocsRoots.join(', ')}.`, { paths: missingDocsRoots }));
  }
  return issues;
}

function buildWorkIssues({ root, config, board, activeStatuses, criticalPath, riskReport }) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const activeTasks = tasks.filter((task) => activeStatuses.has(task.status));
  const blockedTasks = tasks.filter((task) => task.status === 'blocked');
  const waitingTasks = tasks.filter((task) => task.status === 'waiting');
  const nonTerminalTasks = tasks.filter((task) => !TERMINAL_STATUSES.has(task.status));
  const issues = [];

  if (riskReport.summary.critical) {
    issues.push(issue('work', 'criticalRiskTasks', riskReport.summary.critical * 15, `${riskReport.summary.critical} task(s) have critical risk.`, { count: riskReport.summary.critical }));
  }
  if (riskReport.summary.high) {
    issues.push(issue('work', 'highRiskTasks', riskReport.summary.high * 10, `${riskReport.summary.high} task(s) have high risk.`, { count: riskReport.summary.high }));
  }
  if (blockedTasks.length) {
    issues.push(issue('work', 'blockedTasks', Math.min(15, blockedTasks.length * 5), `${blockedTasks.length} task(s) are blocked.`, { taskIds: blockedTasks.map((task) => task.id) }));
  }
  if (waitingTasks.length) {
    issues.push(issue('work', 'waitingTasks', Math.min(12, waitingTasks.length * 3), `${waitingTasks.length} task(s) are waiting.`, { taskIds: waitingTasks.map((task) => task.id) }));
  }

  const staleTasks = activeTasks.filter((task) => {
    const age = hoursSince(task.updatedAt || task.claimedAt || task.startedAt);
    return age !== null && age >= STALE_TASK_HOURS;
  });
  if (staleTasks.length) {
    issues.push(issue('work', 'staleActiveTasks', Math.min(12, staleTasks.length * 4), `${staleTasks.length} active task(s) have not been updated in ${STALE_TASK_HOURS}+ hours.`, { taskIds: staleTasks.map((task) => task.id) }));
  }

  if (criticalPath.warnings.length) {
    issues.push(issue('work', 'criticalPathWarnings', Math.min(20, criticalPath.warnings.length * 8), `${criticalPath.warnings.length} critical-path warning(s) need attention.`, { warnings: criticalPath.warnings }));
  }
  if (nonTerminalTasks.length && criticalPath.readyTasks.length === 0) {
    issues.push(issue('work', 'noReadyWork', 8, 'No remaining task is ready to start.'));
  }

  return issues;
}

function buildVerificationIssues({ config, riskReport }) {
  const issues = [];
  const factorCounts = new Map();
  for (const task of riskReport.tasks) {
    for (const factor of task.factors) {
      factorCounts.set(factor.code, (factorCounts.get(factor.code) ?? 0) + 1);
    }
  }

  const failing = factorCounts.get('failingVerification') ?? 0;
  const missing = factorCounts.get('missingVerification') ?? 0;
  const missingVisual = factorCounts.get('visualVerificationMissing') ?? 0;
  const missingVisualConfig = factorCounts.get('visualImpactNoChecks') ?? 0;
  const missingDocsReview = factorCounts.get('docsReviewMissing') ?? 0;

  if (failing) issues.push(issue('verification', 'failingVerification', Math.min(20, failing * 10), `${failing} task verification check(s) are failing.`, { count: failing }));
  if (missing) issues.push(issue('verification', 'missingVerification', Math.min(15, missing * 5), `${missing} required verification check(s) are missing passing evidence.`, { count: missing }));
  if (missingVisual) issues.push(issue('verification', 'missingVisualVerification', Math.min(18, missingVisual * 8), `${missingVisual} visual-impact task(s) are missing passing visual checks.`, { count: missingVisual }));
  if (missingVisualConfig) issues.push(issue('verification', 'visualChecksNotConfigured', Math.min(12, missingVisualConfig * 6), `${missingVisualConfig} visual-impact task(s) have no configured visual checks.`, { count: missingVisualConfig }));
  if (missingDocsReview) issues.push(issue('verification', 'missingDocsReview', Math.min(12, missingDocsReview * 4), `${missingDocsReview} task(s) reference docs that have not been reviewed.`, { count: missingDocsReview }));

  if (stringArray(config.paths?.visualImpact).length && !stringArray(config.verification?.visualRequiredChecks).length) {
    issues.push(issue('verification', 'visualPolicyMissing', 8, 'Visual-impact paths are configured, but verification.visualRequiredChecks is empty.'));
  }

  return issues;
}

function buildRuntimeIssues({ paths }) {
  const issues = [];
  const runtimeTimestamp = (record) => record?.lastHeartbeatAt || record?.lastSweepAt || record?.updatedAt || record?.timestamp || record?.startedAt || record?.createdAt || record?.at;
  const watcher = readJsonSafe(paths?.watcherStatusPath);
  if (watcher?.malformed) {
    issues.push(issue('runtime', 'malformedWatcherStatus', 6, `Watcher status is malformed: ${watcher.error}.`));
  } else if (watcher) {
    const age = hoursSince(runtimeTimestamp(watcher));
    if (age !== null && age >= STALE_WATCHER_HOURS) {
      issues.push(issue('runtime', 'staleWatcher', 4, `Watcher status has not updated in ${STALE_WATCHER_HOURS}+ hours.`, { path: paths.watcherStatusPath }));
    }
  }

  const lockPath = paths?.runtimeRoot ? path.join(paths.runtimeRoot, 'state.lock.json') : '';
  const lock = lockPath ? readJsonSafe(lockPath) : null;
  if (lock?.malformed) {
    issues.push(issue('runtime', 'malformedStateLock', 8, `State lock is malformed: ${lock.error}.`, { path: lockPath }));
  } else if (lock) {
    const age = hoursSince(lock.updatedAt || lock.lockedAt || lock.createdAt || lock.acquiredAt || lock.at);
    if (age !== null && age >= STALE_LOCK_HOURS) {
      issues.push(issue('runtime', 'staleStateLock', 8, `State lock has been held for ${STALE_LOCK_HOURS}+ hours.`, { path: lockPath }));
    }
  }

  if (paths?.heartbeatsRoot && fs.existsSync(paths.heartbeatsRoot)) {
    const staleHeartbeats = fs.readdirSync(paths.heartbeatsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(paths.heartbeatsRoot, entry.name))
      .filter((filePath) => {
        const heartbeat = readJsonSafe(filePath);
        const age = hoursSince(runtimeTimestamp(heartbeat));
        return age !== null && age >= STALE_HEARTBEAT_HOURS;
      });
    if (staleHeartbeats.length) {
      issues.push(issue('runtime', 'staleHeartbeats', Math.min(10, staleHeartbeats.length * 3), `${staleHeartbeats.length} heartbeat file(s) are stale.`, { paths: staleHeartbeats }));
    }
  }

  return issues;
}

function sectionScore(sectionIssues) {
  return Math.max(0, 100 - sectionIssues.reduce((sum, entry) => sum + entry.points, 0));
}

function healthLevel(score) {
  if (score >= 90) return 'healthy';
  if (score >= 75) return 'watch';
  if (score >= 60) return 'degraded';
  return 'critical';
}

export function buildWorkspaceHealth(context) {
  const riskReport = buildRiskScores(context);
  const criticalPath = buildCriticalPath(context);
  const setupIssues = buildSetupIssues(context);
  const workIssues = buildWorkIssues({ ...context, criticalPath, riskReport });
  const verificationIssues = buildVerificationIssues({ ...context, riskReport });
  const runtimeIssues = buildRuntimeIssues(context);
  const sectionIssues = {
    setup: setupIssues,
    work: workIssues,
    verification: verificationIssues,
    runtime: runtimeIssues,
  };
  const sections = Object.fromEntries(Object.entries(sectionIssues).map(([name, issues]) => [name, { score: sectionScore(issues), issues }]));
  const score = Math.round(Object.entries(sections).reduce((sum, [name, section]) => sum + section.score * SECTION_WEIGHTS[name], 0));
  const issues = Object.values(sectionIssues).flat().sort((left, right) => right.points - left.points || left.code.localeCompare(right.code));

  return {
    ok: score >= 75 && !criticalPath.warnings.length,
    generatedAt: new Date().toISOString(),
    score,
    maxScore: 100,
    level: healthLevel(score),
    summary: {
      issues: issues.length,
      critical: issues.filter((entry) => entry.severity === 'critical').length,
      high: issues.filter((entry) => entry.severity === 'high').length,
      medium: issues.filter((entry) => entry.severity === 'medium').length,
      low: issues.filter((entry) => entry.severity === 'low').length,
    },
    sections,
    issues,
    signals: {
      riskSummary: riskReport.summary,
      criticalPath: {
        totalCost: criticalPath.criticalPath.totalCost,
        taskIds: criticalPath.criticalPath.taskIds,
        readyTasks: criticalPath.readyTasks.slice(0, 10),
        warnings: criticalPath.warnings,
      },
    },
  };
}

function renderWorkspaceHealth(report, failUnder) {
  const lines = ['# Workspace Health'];
  lines.push(`Score: ${report.score}/${report.maxScore} (${report.level})`);
  if (Number.isFinite(failUnder)) lines.push(`Fail under: ${failUnder}`);
  lines.push(`Issues: ${report.summary.issues}; critical: ${report.summary.critical}; high: ${report.summary.high}; medium: ${report.summary.medium}; low: ${report.summary.low}`);
  lines.push('');
  lines.push('Sections:');
  for (const [name, section] of Object.entries(report.sections)) {
    lines.push(`- ${name}: ${section.score}/100 (${section.issues.length} issue${section.issues.length === 1 ? '' : 's'})`);
  }
  lines.push('');
  lines.push('Top issues:');
  lines.push(report.issues.length ? report.issues.slice(0, 10).map((entry) => `- [${entry.severity}] ${entry.code}: ${entry.message}`).join('\n') : '- none');
  if (report.signals.criticalPath.taskIds.length) {
    lines.push('');
    lines.push(`Critical path: ${report.signals.criticalPath.taskIds.join(' -> ')} (cost ${report.signals.criticalPath.totalCost})`);
  }
  return lines.join('\n');
}

export function runHealthScore(argv, context) {
  const report = buildWorkspaceHealth(context);
  const failUnder = getNumberFlag(argv, '--fail-under', null);
  const failedThreshold = Number.isFinite(failUnder) && report.score < failUnder;
  const payload = { ...report, failUnder: Number.isFinite(failUnder) ? failUnder : null, passedThreshold: !failedThreshold };
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(payload, null, 2));
  else console.log(renderWorkspaceHealth(payload, failUnder));
  return failedThreshold ? 1 : 0;
}
