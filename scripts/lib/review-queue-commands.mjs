import { appendAuditLog, auditLogPath } from './audit-log.mjs';
import { getFlagValue, getPositionals, hasFlag } from './args-utils.mjs';
import { printCommandError } from './error-formatting.mjs';
import { nowIso, writeJson } from './file-utils.mjs';
import { withStateTransactionSync } from './state-transaction.mjs';
import { taskUrgencyScore } from './task-metadata.mjs';
import { writePreMutationWorkspaceSnapshot } from './workspace-snapshot-commands.mjs';

const REVIEW_STATUSES = new Set(['queued', 'claimed', 'approved', 'changes-requested', 'commented']);
const OPEN_REVIEW_STATUSES = new Set(['queued', 'claimed']);

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

function reviewQueue(task) {
  return task?.reviewQueue && typeof task.reviewQueue === 'object' ? task.reviewQueue : {};
}

function normalizeReviewStatus(value, task) {
  const status = stringValue(value).toLowerCase();
  if (REVIEW_STATUSES.has(status)) return status;
  return task?.status === 'review' ? 'queued' : 'none';
}

function normalizeOutcome(value) {
  const normalized = stringValue(value).toLowerCase();
  if (normalized === 'approve' || normalized === 'approved' || normalized === 'pass') return 'approved';
  if (normalized === 'changes' || normalized === 'changes-requested' || normalized === 'request-changes' || normalized === 'changes_requested') return 'changes-requested';
  if (normalized === 'comment' || normalized === 'commented') return 'commented';
  return '';
}

function taskTitle(task) {
  return task.title || task.summary || task.id;
}

function reviewItem(task, nowMs = Date.now()) {
  const queue = reviewQueue(task);
  const reviewStatus = normalizeReviewStatus(queue.status, task);
  const updatedAt = queue.claimedAt || task.updatedAt || task.createdAt;
  const age = hoursSince(updatedAt, nowMs);
  return {
    taskId: task.id,
    title: taskTitle(task),
    taskStatus: task.status || 'unknown',
    reviewStatus,
    ownerId: task.ownerId ?? null,
    reviewerId: queue.reviewerId ?? null,
    requestedAt: queue.requestedAt ?? (task.status === 'review' ? task.updatedAt ?? null : null),
    claimedAt: queue.claimedAt ?? null,
    completedAt: queue.completedAt ?? null,
    outcome: queue.outcome ?? null,
    priority: task.priority ?? 'normal',
    severity: task.severity ?? 'none',
    ageHours: age === null ? null : Number(age.toFixed(1)),
    claimedPaths: array(task.claimedPaths).filter((entry) => typeof entry === 'string'),
    score: taskUrgencyScore(task) + (age === null ? 0 : Math.min(10, Math.floor(age / 12))) + (reviewStatus === 'claimed' ? 2 : 0),
  };
}

function isReviewCandidate(task, includeAll) {
  const status = normalizeReviewStatus(reviewQueue(task).status, task);
  if (includeAll) return status !== 'none' || task.status === 'review';
  return task.status === 'review' && OPEN_REVIEW_STATUSES.has(status);
}

export function buildReviewQueue(context, argv = []) {
  const includeAll = hasFlag(argv, '--all');
  const taskId = getFlagValue(argv, '--task', '');
  const reviewerId = getFlagValue(argv, '--agent', '');
  const nowMs = Date.now();
  const tasks = array(context.board?.tasks)
    .filter((task) => isReviewCandidate(task, includeAll))
    .filter((task) => !taskId || task.id === taskId)
    .filter((task) => !reviewerId || reviewQueue(task).reviewerId === reviewerId)
    .map((task) => reviewItem(task, nowMs))
    .sort((left, right) => right.score - left.score || left.taskId.localeCompare(right.taskId));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    includeAll,
    filters: { taskId: taskId || null, reviewerId: reviewerId || null },
    summary: {
      total: tasks.length,
      queued: tasks.filter((item) => item.reviewStatus === 'queued').length,
      claimed: tasks.filter((item) => item.reviewStatus === 'claimed').length,
      completed: tasks.filter((item) => !OPEN_REVIEW_STATUSES.has(item.reviewStatus)).length,
    },
    items: tasks,
  };
}

function findTask(board, taskId) {
  return array(board.tasks).find((task) => task.id === taskId) ?? null;
}

function ensureTaskNotes(task) {
  if (!Array.isArray(task.notes)) task.notes = [];
  return task.notes;
}

function applyReviewClaim(board, task, reviewerId) {
  const timestamp = nowIso();
  task.reviewQueue = {
    ...reviewQueue(task),
    status: 'claimed',
    reviewerId,
    requestedAt: reviewQueue(task).requestedAt ?? (task.status === 'review' ? task.updatedAt ?? timestamp : timestamp),
    claimedAt: timestamp,
    completedAt: null,
    outcome: null,
  };
  task.updatedAt = timestamp;
  ensureTaskNotes(task).push({ at: timestamp, agent: reviewerId, kind: 'review-claim', body: `Claimed review for ${task.id}.` });
  board.updatedAt = timestamp;
}

function applyReviewCompletion(board, task, reviewerId, outcome, note) {
  const timestamp = nowIso();
  const queue = reviewQueue(task);
  const history = array(queue.history);
  task.reviewQueue = {
    ...queue,
    status: outcome,
    reviewerId,
    completedAt: timestamp,
    outcome,
    note,
    history: [...history, { at: timestamp, reviewerId, outcome, note }],
  };
  task.reviewedBy = reviewerId;
  task.reviewCompletedAt = timestamp;
  task.reviewOutcome = outcome;
  task.updatedAt = timestamp;
  ensureTaskNotes(task).push({ at: timestamp, agent: reviewerId, kind: `review-${outcome}`, body: note || `Review ${outcome}.` });
  board.updatedAt = timestamp;
}

function mutationContext(context, label, mutator) {
  let result = null;
  withStateTransactionSync([context.paths.boardPath, context.paths.snapshotsRoot, auditLogPath(context.paths)], () => {
    const workspaceSnapshotPath = writePreMutationWorkspaceSnapshot(context.paths, label);
    result = mutator(workspaceSnapshotPath);
    writeJson(context.paths.boardPath, result.board);
    appendAuditLog(context.paths, result.audit);
  });
  return result;
}

function claimPlan(argv, context) {
  const positionals = getPositionals(argv, new Set(['--agent', '--task']));
  const taskId = positionals[1] || getFlagValue(argv, '--task', '');
  const reviewerId = getFlagValue(argv, '--agent', positionals[2] || '');
  const task = taskId ? findTask(context.board, taskId) : null;
  return { taskId, reviewerId, task };
}

function completePlan(argv, context) {
  const positionals = getPositionals(argv, new Set(['--agent', '--task', '--outcome', '--note']));
  const taskId = positionals[1] || getFlagValue(argv, '--task', '');
  const reviewerId = getFlagValue(argv, '--agent', positionals[2] || '');
  const outcome = normalizeOutcome(getFlagValue(argv, '--outcome', positionals[3] || ''));
  const note = getFlagValue(argv, '--note', positionals.slice(4).join(' '));
  const task = taskId ? findTask(context.board, taskId) : null;
  return { taskId, reviewerId, outcome, note, task };
}

function renderReviewQueue(report) {
  const lines = ['# Review Queue'];
  lines.push(`Items: ${report.summary.total}; queued: ${report.summary.queued}; claimed: ${report.summary.claimed}; completed: ${report.summary.completed}`);
  if (!report.items.length) {
    lines.push('- no review work queued');
    return lines.join('\n');
  }
  for (const item of report.items) {
    lines.push(`- ${item.taskId}: ${item.reviewStatus}${item.reviewerId ? ` by ${item.reviewerId}` : ''} | score ${item.score} | ${item.title}`);
  }
  return lines.join('\n');
}

function renderMutationResult(result) {
  return `${result.action} ${result.taskId} for ${result.reviewerId}${result.outcome ? ` (${result.outcome})` : ''}${result.applied ? '.' : ' (dry run).'}`;
}

export function runReviewQueue(argv, context) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const positionals = getPositionals(argv, new Set(['--agent', '--task', '--outcome', '--note']));
  const subcommand = ['list', 'claim', 'complete'].includes(positionals[0]) ? positionals[0] : 'list';

  if (subcommand === 'list') {
    const report = buildReviewQueue(context, argv);
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log(renderReviewQueue(report));
    return 0;
  }

  if (subcommand === 'claim') {
    const plan = claimPlan(argv, context);
    if (!plan.taskId || !plan.reviewerId) return printCommandError('Usage: review-queue claim <task-id> --agent <agent-id> [--apply] [--json]', { json });
    if (!plan.task) return printCommandError(`Task ${plan.taskId} was not found.`, { json });
    if (plan.task.status !== 'review' && !hasFlag(argv, '--force')) return printCommandError(`Task ${plan.taskId} is ${plan.task.status}; only review tasks can be claimed without --force.`, { json });
    const currentReviewer = reviewQueue(plan.task).reviewerId;
    if (currentReviewer && currentReviewer !== plan.reviewerId && !hasFlag(argv, '--force')) return printCommandError(`Task ${plan.taskId} is already claimed by ${currentReviewer}.`, { json });
    if (!apply) {
      const result = { ok: true, applied: false, action: 'claim', taskId: plan.taskId, reviewerId: plan.reviewerId };
      if (json) console.log(JSON.stringify(result, null, 2));
      else console.log(renderMutationResult(result));
      return 0;
    }
    const result = mutationContext(context, `review-queue-claim-${plan.taskId}`, (workspaceSnapshotPath) => {
      const board = JSON.parse(JSON.stringify(context.board));
      const task = findTask(board, plan.taskId);
      applyReviewClaim(board, task, plan.reviewerId);
      return {
        ok: true,
        applied: true,
        action: 'claim',
        taskId: plan.taskId,
        reviewerId: plan.reviewerId,
        board,
        workspaceSnapshotPath,
        audit: { command: 'review-queue', applied: true, summary: `${plan.reviewerId} claimed review for ${plan.taskId}`, details: { action: 'claim', taskId: plan.taskId, reviewerId: plan.reviewerId } },
      };
    });
    const { board, audit, ...payload } = result;
    if (json) console.log(JSON.stringify(payload, null, 2));
    else console.log(renderMutationResult(payload));
    return 0;
  }

  const plan = completePlan(argv, context);
  if (!plan.taskId || !plan.reviewerId || !plan.outcome) return printCommandError('Usage: review-queue complete <task-id> --agent <agent-id> --outcome approve|changes-requested|commented [--note <text>] [--apply] [--json]', { json });
  if (!plan.task) return printCommandError(`Task ${plan.taskId} was not found.`, { json });
  const currentReviewer = reviewQueue(plan.task).reviewerId;
  if (currentReviewer && currentReviewer !== plan.reviewerId && !hasFlag(argv, '--force')) return printCommandError(`Task ${plan.taskId} is claimed by ${currentReviewer}; use --force to complete as ${plan.reviewerId}.`, { json });
  if (!apply) {
    const result = { ok: true, applied: false, action: 'complete', taskId: plan.taskId, reviewerId: plan.reviewerId, outcome: plan.outcome };
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(renderMutationResult(result));
    return 0;
  }
  const result = mutationContext(context, `review-queue-complete-${plan.taskId}`, (workspaceSnapshotPath) => {
    const board = JSON.parse(JSON.stringify(context.board));
    const task = findTask(board, plan.taskId);
    applyReviewCompletion(board, task, plan.reviewerId, plan.outcome, plan.note);
    return {
      ok: true,
      applied: true,
      action: 'complete',
      taskId: plan.taskId,
      reviewerId: plan.reviewerId,
      outcome: plan.outcome,
      board,
      workspaceSnapshotPath,
      audit: { command: 'review-queue', applied: true, summary: `${plan.reviewerId} completed review for ${plan.taskId}: ${plan.outcome}`, details: { action: 'complete', taskId: plan.taskId, reviewerId: plan.reviewerId, outcome: plan.outcome } },
    };
  });
  const { board, audit, ...payload } = result;
  if (json) console.log(JSON.stringify(payload, null, 2));
  else console.log(renderMutationResult(payload));
  return 0;
}
