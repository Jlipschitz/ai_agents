import { appendAuditLog, auditLogPath } from './audit-log.mjs';
import { getFlagValue, getNumberFlag, hasFlag } from './args-utils.mjs';
import { nowIso, writeJson } from './file-utils.mjs';
import { normalizePath } from './path-utils.mjs';
import { printCommandError } from './error-formatting.mjs';
import { withStateTransactionSync } from './state-transaction.mjs';
import { taskUrgencyScore } from './task-metadata.mjs';
import { writePreMutationWorkspaceSnapshot } from './workspace-snapshot-commands.mjs';

const TERMINAL_STATUSES = new Set(['done', 'released']);
const STEALABLE_STATUSES = new Set(['planned', 'handoff', 'review', 'active', 'blocked', 'waiting']);
const DEFAULT_STALE_HOURS = 24;

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : [];
}

function pathMatchesScope(filePath, scope) {
  const normalizedPath = normalizePath(filePath);
  const normalizedScope = normalizePath(scope);
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

function parseTime(value) {
  const timestamp = Date.parse(String(value ?? ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hoursSince(value, nowMs = Date.now()) {
  const timestamp = parseTime(value);
  return timestamp ? Math.max(0, (nowMs - timestamp) / 36e5) : null;
}

function dependenciesSatisfied(task, tasksById) {
  return stringArray(task.dependencies).every((dependencyId) => {
    const dependency = tasksById.get(dependencyId);
    return dependency && TERMINAL_STATUSES.has(dependency.status);
  });
}

function agentById(board, agentId) {
  return Array.isArray(board.agents) ? board.agents.find((agent) => agent?.id === agentId) : null;
}

function ensureAgent(board, agentId) {
  if (!Array.isArray(board.agents)) board.agents = [];
  let agent = agentById(board, agentId);
  if (!agent) {
    agent = { id: agentId, status: 'idle', taskId: null };
    board.agents.push(agent);
  }
  return agent;
}

function scopeAllowed(task, scopes) {
  if (!scopes.length) return true;
  const claimedPaths = stringArray(task.claimedPaths);
  return claimedPaths.some((filePath) => scopes.some((scope) => pathMatchesScope(filePath, scope)));
}

function candidateReason(task, staleHours, nowMs) {
  const age = hoursSince(task.updatedAt || task.claimedAt || task.startedAt, nowMs);
  if (!task.ownerId && task.status === 'planned') return { type: 'ready-unowned', ageHours: age };
  if (!task.ownerId && (task.status === 'handoff' || task.status === 'review')) return { type: `unowned-${task.status}`, ageHours: age };
  if (task.status === 'handoff') return { type: 'handoff', ageHours: age };
  if (task.status === 'review') return { type: 'review', ageHours: age };
  if (age !== null && age >= staleHours && ['active', 'blocked', 'waiting'].includes(task.status)) return { type: `stale-${task.status}`, ageHours: age };
  return null;
}

function scoreCandidate(task, reason, agentId, ready) {
  let score = 0;
  if (task.suggestedOwnerId === agentId) score += 10;
  if (reason.type === 'handoff' || reason.type === 'unowned-handoff') score += 12;
  else if (reason.type === 'review' || reason.type === 'unowned-review') score += 9;
  else if (reason.type.startsWith('stale-')) score += 7;
  else if (reason.type === 'ready-unowned') score += 5;
  if (ready) score += 4;
  if (reason.ageHours !== null) score += Math.min(8, Math.floor(reason.ageHours / 12));
  score += taskUrgencyScore(task);
  return score;
}

export function buildWorkStealPlan(context, argv = []) {
  const agentId = getFlagValue(argv, '--agent', argv[0] ?? '');
  const taskId = getFlagValue(argv, '--task', '');
  const staleHours = getNumberFlag(argv, '--stale-hours', DEFAULT_STALE_HOURS);
  const force = hasFlag(argv, '--force');
  const scopes = stringArray(getFlagValue(argv, '--scope', '').split(','));
  const board = context.board && typeof context.board === 'object' ? context.board : { tasks: [], agents: [] };
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const nowMs = Date.now();
  const currentAgent = agentId ? agentById(board, agentId) : null;
  const candidates = [];

  for (const task of tasks) {
    if (!STEALABLE_STATUSES.has(task.status)) continue;
    if (taskId && task.id !== taskId) continue;
    if (task.ownerId === agentId) continue;
    if (!scopeAllowed(task, scopes)) continue;
    const ready = dependenciesSatisfied(task, tasksById);
    if (!ready && !force) continue;
    const reason = candidateReason(task, staleHours, nowMs);
    if (!reason) continue;
    candidates.push({
      taskId: task.id,
      title: task.title || task.summary || task.id,
      status: task.status,
      ownerId: task.ownerId ?? null,
      claimedPaths: stringArray(task.claimedPaths),
      ready,
      reason: reason.type,
      ageHours: reason.ageHours === null ? null : Number(reason.ageHours.toFixed(1)),
      score: scoreCandidate(task, reason, agentId, ready),
    });
  }

  candidates.sort((left, right) => right.score - left.score || left.taskId.localeCompare(right.taskId));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    agentId: agentId || null,
    agentAvailable: Boolean(agentId) && (!currentAgent?.taskId || force),
    staleHours,
    candidates,
    selected: candidates[0] ?? null,
    warnings: [
      !agentId ? 'Missing --agent <agent-id> or leading agent id.' : null,
      currentAgent?.taskId && !force ? `${agentId} is already assigned to ${currentAgent.taskId}; pass --force to override.` : null,
      taskId && !candidates.length ? `No stealable candidate found for ${taskId}.` : null,
    ].filter(Boolean),
  };
}

function applySteal(context, plan) {
  const board = JSON.parse(JSON.stringify(context.board));
  const task = board.tasks.find((entry) => entry.id === plan.selected.taskId);
  const agent = ensureAgent(board, plan.agentId);
  const previousOwnerId = task.ownerId ?? null;
  const previousOwner = previousOwnerId ? agentById(board, previousOwnerId) : null;
  const timestamp = nowIso();

  if (previousOwner && previousOwner.taskId === task.id) {
    previousOwner.status = 'idle';
    previousOwner.taskId = null;
    previousOwner.updatedAt = timestamp;
  }

  task.lastOwnerId = previousOwnerId;
  task.ownerId = plan.agentId;
  task.status = 'active';
  task.stolenAt = timestamp;
  task.updatedAt = timestamp;
  task.notes = Array.isArray(task.notes) ? task.notes : [];
  task.notes.push({ at: timestamp, agentId: plan.agentId, kind: 'work-steal', note: `Stole work from ${previousOwnerId ?? 'unowned'}: ${plan.selected.reason}.` });

  agent.status = 'active';
  agent.taskId = task.id;
  agent.updatedAt = timestamp;
  board.updatedAt = timestamp;

  return { board, task, previousOwnerId };
}

function renderWorkSteal(plan) {
  const lines = ['# Work Stealing'];
  lines.push(`Agent: ${plan.agentId ?? 'missing'}`);
  lines.push(`Stale threshold: ${plan.staleHours}h`);
  if (plan.warnings.length) {
    lines.push('Warnings:');
    lines.push(plan.warnings.map((warning) => `- ${warning}`).join('\n'));
  }
  if (!plan.candidates.length) {
    lines.push('Candidates: none');
    return lines.join('\n');
  }
  lines.push('Candidates:');
  for (const candidate of plan.candidates.slice(0, 10)) {
    lines.push(`- ${candidate.taskId}: ${candidate.title} (${candidate.reason}, score ${candidate.score}, owner ${candidate.ownerId ?? 'none'})`);
  }
  return lines.join('\n');
}

export function runWorkSteal(argv, context) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const plan = buildWorkStealPlan(context, argv);
  if (apply) {
    if (!plan.agentId) return printCommandError('Usage: steal-work <agent-id>|--agent <agent-id> [--apply] [--json]', { json });
    if (!plan.agentAvailable) return printCommandError(plan.warnings[0] ?? `${plan.agentId} is not available.`, { json });
    if (!plan.selected) return printCommandError('No stealable work candidate found.', { json });
    let result = null;
    withStateTransactionSync([context.paths.boardPath, context.paths.snapshotsRoot, auditLogPath(context.paths)], () => {
      const workspaceSnapshotPath = writePreMutationWorkspaceSnapshot(context.paths, `steal-work-${plan.agentId}`);
      const applied = applySteal(context, plan);
      writeJson(context.paths.boardPath, applied.board);
      appendAuditLog(context.paths, {
        command: 'steal-work',
        applied: true,
        summary: `${plan.agentId} stole ${applied.task.id}`,
        details: { agentId: plan.agentId, taskId: applied.task.id, previousOwnerId: applied.previousOwnerId, reason: plan.selected.reason },
      });
      result = { ...plan, applied: true, selected: { ...plan.selected, previousOwnerId: applied.previousOwnerId }, workspaceSnapshotPath };
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Assigned ${result.selected.taskId} to ${plan.agentId}.`);
    return 0;
  }

  if (json) console.log(JSON.stringify({ ...plan, applied: false }, null, 2));
  else console.log(renderWorkSteal(plan));
  return 0;
}
