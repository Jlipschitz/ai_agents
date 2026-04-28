import fs from 'node:fs';
import path from 'node:path';

import { getFlagValue, getNumberFlag, getPositionals, hasFlag } from './args-utils.mjs';
import { appendAuditLog, auditLogPath } from './audit-log.mjs';
import { CURRENT_BOARD_VERSION } from './board-migration.mjs';
import { normalizePath } from './path-utils.mjs';
import { withStateTransactionSync } from './state-transaction.mjs';
import { writeJson } from './file-utils.mjs';
import { writePreMutationWorkspaceSnapshot } from './workspace-snapshot-commands.mjs';

export const DEFAULT_FIXTURE_REFERENCE_AT = '2026-04-28T12:00:00.000Z';
export const DEFAULT_FIXTURE_AGENT_IDS = ['agent-1', 'agent-2', 'agent-3', 'agent-4'];
export const DEFAULT_LARGE_FIXTURE_TASK_COUNT = 48;

export const FIXTURE_BOARD_KINDS = Object.freeze([
  'empty',
  'healthy',
  'blocked',
  'stale',
  'large',
  'malformed',
  'multi-agent-conflict',
  'release-ready',
  'approval-required',
  'contract-sensitive',
]);

const ACTIVE_STATUSES = new Set(['active', 'blocked', 'review', 'waiting', 'handoff']);
const TERMINAL_STATUSES = new Set(['done', 'released']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

function timestampAt(referenceAt, offsetMinutes = 0) {
  const timestamp = Date.parse(referenceAt);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid fixture reference timestamp: ${referenceAt}`);
  }
  return new Date(timestamp + offsetMinutes * 60_000).toISOString();
}

function staleTimestampAt(referenceAt, offsetHours = 48) {
  return timestampAt(referenceAt, -offsetHours * 60);
}

function normalizeAgentIds(agentIds) {
  const normalized = Array.isArray(agentIds)
    ? agentIds.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
    : [];
  return normalized.length ? normalized : [...DEFAULT_FIXTURE_AGENT_IDS];
}

function taskTitleFromId(id) {
  return String(id)
    .replace(/^task-/, '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildTask(id, overrides = {}, options = {}) {
  const referenceAt = options.referenceAt ?? DEFAULT_FIXTURE_REFERENCE_AT;
  const timestamp = timestampAt(referenceAt, options.offsetMinutes ?? 0);
  const task = {
    id,
    status: 'planned',
    ownerId: null,
    title: taskTitleFromId(id),
    summary: '',
    claimedPaths: [],
    dependencies: [],
    waitingOn: [],
    verification: [],
    verificationLog: [],
    notes: [],
    relevantDocs: [],
    suggestedOwnerId: null,
    rationale: '',
    effort: 'unknown',
    issueKey: null,
    docsReviewedAt: null,
    docsReviewedBy: null,
    lastOwnerId: null,
    lastHandoff: null,
    priority: 'normal',
    severity: 'none',
    dueAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };

  if (!hasOwn(overrides, 'lastOwnerId')) task.lastOwnerId = task.ownerId ?? null;
  if (!hasOwn(overrides, 'summary')) task.summary = task.title;
  return task;
}

function verificationEntry(check, outcome = 'pass', options = {}) {
  const referenceAt = options.referenceAt ?? DEFAULT_FIXTURE_REFERENCE_AT;
  const timestamp = timestampAt(referenceAt, options.offsetMinutes ?? 0);
  return {
    check,
    outcome,
    summary: options.summary ?? `${check} ${outcome}`,
    agentId: options.agentId ?? 'agent-1',
    at: timestamp,
  };
}

function noteEntry(kind, body, options = {}) {
  const referenceAt = options.referenceAt ?? DEFAULT_FIXTURE_REFERENCE_AT;
  return {
    at: timestampAt(referenceAt, options.offsetMinutes ?? 0),
    agentId: options.agentId ?? 'agent-1',
    kind,
    body,
  };
}

function createBaseBoard(kind, options = {}) {
  const referenceAt = options.referenceAt ?? DEFAULT_FIXTURE_REFERENCE_AT;
  const timestamp = timestampAt(referenceAt);
  const agentIds = normalizeAgentIds(options.agentIds);
  return {
    version: CURRENT_BOARD_VERSION,
    projectName: options.projectName ?? 'Fixture Board',
    workspace: options.workspace ?? 'coordination',
    createdAt: timestamp,
    updatedAt: timestamp,
    agents: agentIds.map((id) => ({ id, status: 'idle', taskId: null, updatedAt: timestamp })),
    tasks: [],
    resources: [],
    incidents: [],
    accessRequests: [],
    approvals: [],
    plans: [],
    fixture: kind,
  };
}

function statusForAgentTask(task) {
  return task.status === 'handoff' ? 'handoff' : ACTIVE_STATUSES.has(task.status) ? task.status : 'idle';
}

function syncAgentAssignments(board) {
  const agentsById = new Map(board.agents.map((agent) => [agent.id, agent]));
  for (const agent of board.agents) {
    agent.status = 'idle';
    agent.taskId = null;
    agent.updatedAt = board.updatedAt;
  }

  for (const task of board.tasks) {
    if (!task.ownerId || !ACTIVE_STATUSES.has(task.status)) continue;
    const agent = agentsById.get(task.ownerId);
    if (!agent || agent.taskId) continue;
    agent.status = statusForAgentTask(task);
    agent.taskId = task.id;
    agent.updatedAt = task.updatedAt ?? board.updatedAt;
  }

  return board;
}

function finalizeBoard(board) {
  return syncAgentAssignments(clone(board));
}

function emptyBoard(options = {}) {
  return finalizeBoard(createBaseBoard('empty', options));
}

function healthyBoard(options = {}) {
  const board = createBaseBoard('healthy', options);
  const referenceAt = options.referenceAt ?? DEFAULT_FIXTURE_REFERENCE_AT;
  board.tasks = [
    buildTask('task-active', {
      status: 'active',
      ownerId: 'agent-1',
      title: 'Active fixture task',
      claimedPaths: ['fixtures/healthy/active.mjs'],
      verification: ['unit'],
      priority: 'normal',
    }, { referenceAt, offsetMinutes: -20 }),
    buildTask('task-review', {
      status: 'review',
      ownerId: 'agent-2',
      title: 'Review fixture task',
      claimedPaths: ['fixtures/healthy/review.mjs'],
      verification: ['unit'],
      verificationLog: [verificationEntry('unit', 'pass', { referenceAt, agentId: 'agent-2', offsetMinutes: -10 })],
    }, { referenceAt, offsetMinutes: -15 }),
    buildTask('task-planned', {
      status: 'planned',
      title: 'Planned fixture task',
      claimedPaths: ['fixtures/healthy/planned.mjs'],
      dependencies: ['task-active'],
      suggestedOwnerId: 'agent-3',
    }, { referenceAt, offsetMinutes: -5 }),
    buildTask('task-done', {
      status: 'done',
      title: 'Completed fixture task',
      claimedPaths: ['fixtures/healthy/done.mjs'],
      verification: ['unit'],
      verificationLog: [verificationEntry('unit', 'pass', { referenceAt, agentId: 'agent-1', offsetMinutes: -30 })],
    }, { referenceAt, offsetMinutes: -25 }),
  ];
  return finalizeBoard(board);
}

function blockedBoard(options = {}) {
  const board = createBaseBoard('blocked', options);
  const referenceAt = options.referenceAt ?? DEFAULT_FIXTURE_REFERENCE_AT;
  board.tasks = [
    buildTask('task-blocked', {
      status: 'blocked',
      ownerId: 'agent-1',
      title: 'Blocked fixture task',
      claimedPaths: ['fixtures/blocked/workflow.mjs'],
      dependencies: ['task-unblocker'],
      waitingOn: ['task-unblocker'],
      verification: ['unit'],
      priority: 'high',
      severity: 'medium',
      notes: [noteEntry('blocked', 'Waiting on the unblocker task before this can continue.', { referenceAt, offsetMinutes: -30 })],
    }, { referenceAt, offsetMinutes: -30 }),
    buildTask('task-unblocker', {
      status: 'planned',
      title: 'Unblock fixture dependency',
      claimedPaths: ['fixtures/blocked/unblocker.mjs'],
      suggestedOwnerId: 'agent-2',
    }, { referenceAt, offsetMinutes: -20 }),
  ];
  return finalizeBoard(board);
}

function staleBoard(options = {}) {
  const board = createBaseBoard('stale', options);
  const referenceAt = options.referenceAt ?? DEFAULT_FIXTURE_REFERENCE_AT;
  const staleAt = staleTimestampAt(referenceAt, 72);
  board.tasks = [
    buildTask('task-stale', {
      status: 'active',
      ownerId: 'agent-1',
      title: 'Stale active fixture task',
      claimedPaths: ['fixtures/stale/workflow.mjs'],
      verification: ['unit'],
      notes: [noteEntry('change', 'Work started but has not reported progress recently.', { referenceAt, offsetMinutes: -72 * 60 })],
      createdAt: staleAt,
      updatedAt: staleAt,
    }, { referenceAt }),
    buildTask('task-follow-up', {
      status: 'planned',
      title: 'Fresh follow-up task',
      claimedPaths: ['fixtures/stale/follow-up.mjs'],
      dependencies: ['task-stale'],
    }, { referenceAt, offsetMinutes: -5 }),
  ];
  return finalizeBoard(board);
}

function largeTaskStatus(index) {
  if (index === 1) return 'active';
  if (index === 2) return 'blocked';
  if (index === 3) return 'review';
  if (index === 4) return 'waiting';
  return ['planned', 'done', 'released'][(index - 5) % 3];
}

function largeBoard(options = {}) {
  const board = createBaseBoard('large', options);
  const referenceAt = options.referenceAt ?? DEFAULT_FIXTURE_REFERENCE_AT;
  const agentIds = board.agents.map((agent) => agent.id);
  const rawCount = Number.parseInt(String(options.taskCount ?? DEFAULT_LARGE_FIXTURE_TASK_COUNT), 10);
  const taskCount = Number.isFinite(rawCount) && rawCount > 0 ? rawCount : DEFAULT_LARGE_FIXTURE_TASK_COUNT;
  board.tasks = Array.from({ length: taskCount }, (_, taskIndex) => {
    const index = taskIndex + 1;
    const id = `task-large-${String(index).padStart(3, '0')}`;
    const status = largeTaskStatus(index);
    const ownerId = ACTIVE_STATUSES.has(status) ? agentIds[(index - 1) % agentIds.length] : null;
    const verification = TERMINAL_STATUSES.has(status) || status === 'review' ? ['unit'] : [];
    const verificationLog = TERMINAL_STATUSES.has(status)
      ? [verificationEntry('unit', 'pass', { referenceAt, agentId: ownerId ?? 'agent-4', offsetMinutes: -index })]
      : [];
    return buildTask(id, {
      status,
      ownerId,
      title: `Large fixture task ${String(index).padStart(3, '0')}`,
      claimedPaths: [`fixtures/large/module-${String(index).padStart(3, '0')}.mjs`],
      dependencies: index > 5 && status === 'planned' ? [`task-large-${String(index - 1).padStart(3, '0')}`] : [],
      waitingOn: status === 'waiting' ? ['task-large-003'] : [],
      verification,
      verificationLog,
    }, { referenceAt, offsetMinutes: -index });
  });
  return finalizeBoard(board);
}

function malformedBoard(options = {}) {
  const board = createBaseBoard('malformed', options);
  const referenceAt = options.referenceAt ?? DEFAULT_FIXTURE_REFERENCE_AT;
  const timestamp = timestampAt(referenceAt);
  board.projectName = '';
  board.agents = [
    { id: 'agent-1', status: 'active', taskId: 'task-duplicate', updatedAt: timestamp },
    { id: 'agent-1', status: 'idle', taskId: null, updatedAt: timestamp },
    { id: 'agent-99', status: 'active', taskId: 'task-missing-owner', updatedAt: timestamp },
  ];
  board.tasks = [
    {
      id: 'task-duplicate',
      status: 'active',
      ownerId: 'agent-1',
      title: 'Duplicate task one',
      claimedPaths: ['fixtures/malformed/shared.mjs'],
      dependencies: ['task-missing'],
      waitingOn: [],
      verification: [],
      verificationLog: [],
      notes: [],
      relevantDocs: [],
      priority: 'immediate',
      severity: 'severe',
      dueAt: 'not-a-date',
      updatedAt: timestamp,
    },
    {
      id: 'task-duplicate',
      status: 'mystery',
      ownerId: 'agent-99',
      title: 'Duplicate task two',
      claimedPaths: ['fixtures/malformed/shared.mjs'],
      dependencies: ['task-duplicate'],
      waitingOn: [],
      verification: [],
      verificationLog: [],
      notes: [],
      relevantDocs: [],
      updatedAt: timestamp,
    },
    {
      id: 'task-missing-owner',
      status: 'active',
      ownerId: null,
      title: 'Active task without owner',
      claimedPaths: [],
      dependencies: [],
      waitingOn: [],
      verification: [],
      verificationLog: [],
      notes: [],
      relevantDocs: [],
      updatedAt: timestamp,
    },
  ];
  board.resources = [
    { name: 'shared-db', ownerId: 'agent-99', updatedAt: timestamp },
    { name: 'shared-db', ownerId: 'agent-1', updatedAt: timestamp },
  ];
  board.incidents = [
    { id: 'incident-bad-status', status: 'investigating', ownerId: 'agent-1', updatedAt: 'not-a-date' },
  ];
  board.accessRequests = [
    { id: 'access-bad-status', scope: 'prod', requestedBy: 'agent-1', status: 'maybe', updatedAt: timestamp },
  ];
  board.approvals = [
    { id: 'approval-missing-task', taskId: 'task-missing', scope: 'release', status: 'approved', requestedBy: 'agent-1', updatedAt: timestamp },
  ];
  return clone(board);
}

function multiAgentConflictBoard(options = {}) {
  const board = createBaseBoard('multi-agent-conflict', options);
  const referenceAt = options.referenceAt ?? DEFAULT_FIXTURE_REFERENCE_AT;
  board.tasks = [
    buildTask('task-conflict-a', {
      status: 'active',
      ownerId: 'agent-1',
      title: 'Conflict producer task',
      claimedPaths: ['fixtures/conflict/shared'],
      issueKey: 'FX-CONFLICT',
      verification: ['unit'],
    }, { referenceAt, offsetMinutes: -15 }),
    buildTask('task-conflict-b', {
      status: 'active',
      ownerId: 'agent-2',
      title: 'Conflict consumer task',
      claimedPaths: ['fixtures/conflict/shared/component.mjs'],
      issueKey: 'FX-CONFLICT',
      verification: ['unit'],
    }, { referenceAt, offsetMinutes: -10 }),
    buildTask('task-conflict-review', {
      status: 'planned',
      title: 'Resolve conflict fixture task',
      claimedPaths: ['fixtures/conflict/review.md'],
      dependencies: ['task-conflict-a', 'task-conflict-b'],
      suggestedOwnerId: 'agent-3',
    }, { referenceAt, offsetMinutes: -5 }),
  ];
  return finalizeBoard(board);
}

function releaseReadyBoard(options = {}) {
  const board = createBaseBoard('release-ready', options);
  const referenceAt = options.referenceAt ?? DEFAULT_FIXTURE_REFERENCE_AT;
  board.tasks = [
    buildTask('task-release-ready', {
      status: 'done',
      title: 'Release-ready fixture task',
      claimedPaths: ['fixtures/release/ready.mjs'],
      verification: ['unit', 'contract'],
      verificationLog: [
        verificationEntry('unit', 'pass', { referenceAt, agentId: 'agent-1', offsetMinutes: -35 }),
        verificationEntry('contract', 'pass', { referenceAt, agentId: 'agent-2', offsetMinutes: -30 }),
      ],
      relevantDocs: ['README.md'],
      docsReviewedAt: timestampAt(referenceAt, -25),
      docsReviewedBy: 'agent-2',
      priority: 'high',
    }, { referenceAt, offsetMinutes: -40 }),
    buildTask('task-release-notes', {
      status: 'planned',
      title: 'Prepare release notes follow-up',
      claimedPaths: ['docs/release-notes.md'],
      dependencies: ['task-release-ready'],
      suggestedOwnerId: 'agent-3',
    }, { referenceAt, offsetMinutes: -10 }),
  ];
  return finalizeBoard(board);
}

function approvalRequiredBoard(options = {}) {
  const board = createBaseBoard('approval-required', options);
  const referenceAt = options.referenceAt ?? DEFAULT_FIXTURE_REFERENCE_AT;
  const approvalId = 'approval-task-approval-required-release';
  board.tasks = [
    buildTask('task-approval-required', {
      status: 'active',
      ownerId: 'agent-1',
      title: 'Approval-required fixture task',
      claimedPaths: ['fixtures/approval/workflow.mjs'],
      verification: ['unit'],
      notes: [noteEntry('approval-request', `Requested approval ${approvalId} for release.`, { referenceAt, offsetMinutes: -10 })],
      priority: 'urgent',
    }, { referenceAt, offsetMinutes: -15 }),
  ];
  board.approvals = [
    {
      id: approvalId,
      taskId: 'task-approval-required',
      scope: 'release',
      summary: 'Release requires coordinator approval.',
      status: 'pending',
      requestedBy: 'agent-1',
      requestedAt: timestampAt(referenceAt, -10),
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      usedBy: null,
      usedAt: null,
      useNote: null,
      createdAt: timestampAt(referenceAt, -10),
      updatedAt: timestampAt(referenceAt, -10),
    },
  ];
  return finalizeBoard(board);
}

function contractSensitiveBoard(options = {}) {
  const board = createBaseBoard('contract-sensitive', options);
  const referenceAt = options.referenceAt ?? DEFAULT_FIXTURE_REFERENCE_AT;
  board.tasks = [
    buildTask('task-contract-producer', {
      status: 'active',
      ownerId: 'agent-1',
      title: 'Contract producer fixture task',
      claimedPaths: ['api/routes/orders.mjs', 'types/orders.d.ts'],
      verification: ['contract'],
      relevantDocs: ['docs/api/orders.md'],
      docsReviewedAt: timestampAt(referenceAt, -20),
      docsReviewedBy: 'agent-1',
    }, { referenceAt, offsetMinutes: -30 }),
    buildTask('task-contract-consumer', {
      status: 'planned',
      title: 'Contract consumer fixture task',
      claimedPaths: ['app/orders/page.tsx'],
      dependencies: ['task-contract-producer'],
      verification: ['unit'],
      suggestedOwnerId: 'agent-2',
    }, { referenceAt, offsetMinutes: -15 }),
  ];
  return finalizeBoard(board);
}

const FIXTURE_BUILDERS = Object.freeze({
  empty: emptyBoard,
  healthy: healthyBoard,
  blocked: blockedBoard,
  stale: staleBoard,
  large: largeBoard,
  malformed: malformedBoard,
  'multi-agent-conflict': multiAgentConflictBoard,
  'release-ready': releaseReadyBoard,
  'approval-required': approvalRequiredBoard,
  'contract-sensitive': contractSensitiveBoard,
});

export function normalizeFixtureBoardKind(kind = 'healthy') {
  const normalized = String(kind || 'healthy')
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
  if (FIXTURE_BUILDERS[normalized]) return normalized;
  throw new Error(`Unknown fixture board kind "${kind}". Expected one of: ${FIXTURE_BOARD_KINDS.join(', ')}.`);
}

export function generateFixtureBoard(kind = 'healthy', options = {}) {
  if (kind && typeof kind === 'object' && !Array.isArray(kind)) {
    return generateFixtureBoard(kind.kind ?? 'healthy', kind);
  }
  const normalizedKind = normalizeFixtureBoardKind(kind);
  return FIXTURE_BUILDERS[normalizedKind](options);
}

export function generateFixtureBoards(options = {}) {
  return Object.fromEntries(FIXTURE_BOARD_KINDS.map((kind) => [kind, generateFixtureBoard(kind, options)]));
}

function renderFixtureBoardResult(result) {
  const lines = [`${result.applied ? 'Wrote' : 'Dry run for'} ${result.kind} fixture board.`];
  lines.push(`Output: ${result.path}`);
  lines.push(`Tasks: ${result.tasks}`);
  lines.push(`Agents: ${result.agents}`);
  if (!result.applied) lines.push('Pass --apply to write the board.');
  return lines.join('\n');
}

export function runFixtureBoard(argv, context) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const positionals = getPositionals(argv, new Set(['--out', '--task-count', '--reference-at', '--project-name', '--workspace']));
  const kind = normalizeFixtureBoardKind(positionals[0] ?? 'healthy');
  const outValue = getFlagValue(argv, '--out', '');
  const outputPath = outValue ? path.resolve(context.root, outValue) : context.paths.boardPath;
  const board = generateFixtureBoard(kind, {
    referenceAt: getFlagValue(argv, '--reference-at', DEFAULT_FIXTURE_REFERENCE_AT),
    projectName: getFlagValue(argv, '--project-name', '') || undefined,
    workspace: getFlagValue(argv, '--workspace', '') || undefined,
    agentIds: context.config?.agentIds,
    taskCount: getNumberFlag(argv, '--task-count', undefined),
  });
  const result = {
    ok: true,
    applied: apply,
    kind,
    path: normalizePath(path.relative(context.root, outputPath)),
    tasks: Array.isArray(board.tasks) ? board.tasks.length : 0,
    agents: Array.isArray(board.agents) ? board.agents.length : 0,
    workspaceSnapshotPath: null,
  };

  if (apply) {
    withStateTransactionSync([outputPath, context.paths.snapshotsRoot, auditLogPath(context.paths)], () => {
      result.workspaceSnapshotPath = writePreMutationWorkspaceSnapshot(context.paths, `fixture-board-${kind}`);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      writeJson(outputPath, board);
      appendAuditLog(context.paths, {
        command: 'fixture-board',
        applied: true,
        summary: `Generated ${kind} fixture board.`,
        details: { kind, outputPath: result.path, tasks: result.tasks, workspaceSnapshotPath: result.workspaceSnapshotPath },
      });
    });
  }

  if (json) console.log(JSON.stringify({ ...result, board }, null, 2));
  else console.log(renderFixtureBoardResult(result));
  return 0;
}
