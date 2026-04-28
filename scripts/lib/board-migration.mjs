import path from 'node:path';

import { nowIso } from './file-utils.mjs';

export const CURRENT_BOARD_VERSION = 2;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeIso(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function normalizeWorkspaceLabel(root, coordinationRoot) {
  const label = path.relative(root, coordinationRoot).replaceAll('\\', '/');
  return label || '.';
}

function getConfiguredAgentIds(context) {
  const { config, defaultAgentIds } = context;
  return Array.isArray(config.agentIds) && config.agentIds.length ? config.agentIds.filter((entry) => typeof entry === 'string' && entry.trim()) : defaultAgentIds;
}

function ensureArray(board, key, changes) {
  if (!Array.isArray(board[key])) {
    board[key] = [];
    changes.push(`initialized ${key}`);
  }
}

function setIfChanged(target, key, value, changes, label) {
  if (target[key] !== value) {
    target[key] = value;
    changes.push(label || `set ${key}`);
  }
}

function ensureTaskDefaults(task, changes) {
  for (const key of ['claimedPaths', 'dependencies', 'waitingOn', 'verification', 'verificationLog', 'notes', 'relevantDocs']) {
    if (!Array.isArray(task[key])) {
      task[key] = [];
      changes.push(`initialized ${task.id}.${key}`);
    }
  }
  for (const [key, value] of [
    ['suggestedOwnerId', null],
    ['rationale', ''],
    ['effort', 'unknown'],
    ['issueKey', null],
    ['docsReviewedAt', null],
    ['docsReviewedBy', null],
    ['lastOwnerId', task.ownerId ?? null],
    ['lastHandoff', null],
  ]) {
    if (!(key in task)) {
      task[key] = value;
      changes.push(`initialized ${task.id}.${key}`);
    }
  }
}

function ensureAgentSlots(board, context, timestamp, changes) {
  const agentIds = getConfiguredAgentIds(context);
  const agents = Array.isArray(board.agents) ? board.agents : [];
  if (agents.length !== agentIds.length) changes.push('normalized agents');
  const byId = new Map(agents.filter((agent) => agent?.id).map((agent) => [agent.id, agent]));
  board.agents = agentIds.map((agentId) => {
    const existing = byId.get(agentId);
    if (!existing) {
      changes.push(`added agent ${agentId}`);
      return { id: agentId, status: 'idle', taskId: null, updatedAt: timestamp };
    }
    const normalized = {
      id: agentId,
      status: typeof existing.status === 'string' && existing.status ? existing.status : existing.taskId ? 'active' : 'idle',
      taskId: typeof existing.taskId === 'string' && existing.taskId ? existing.taskId : null,
      updatedAt: normalizeIso(existing.updatedAt, timestamp),
    };
    if (existing.status !== normalized.status || existing.taskId !== normalized.taskId || existing.updatedAt !== normalized.updatedAt) {
      changes.push(`normalized agent ${agentId}`);
    }
    return normalized;
  });
}

export function createStarterBoard(context) {
  const { config, root, paths } = context;
  const timestamp = nowIso();
  return {
    version: CURRENT_BOARD_VERSION,
    projectName: config.projectName || path.basename(root),
    workspace: normalizeWorkspaceLabel(root, paths.coordinationRoot),
    createdAt: timestamp,
    updatedAt: timestamp,
    agents: getConfiguredAgentIds(context).map((id) => ({ id, status: 'idle', taskId: null, updatedAt: timestamp })),
    tasks: [],
    resources: [],
    incidents: [],
    accessRequests: [],
    plans: [],
  };
}

export function migrateBoardObject(board, context) {
  const timestamp = nowIso();
  const changes = [];
  const migrations = [];
  const migrated = board && typeof board === 'object' && !Array.isArray(board) ? clone(board) : createStarterBoard(context);
  const sourceVersion = Number.isInteger(migrated.version) ? migrated.version : 0;

  if (sourceVersion > CURRENT_BOARD_VERSION) {
    return {
      ok: false,
      board: migrated,
      sourceVersion,
      targetVersion: CURRENT_BOARD_VERSION,
      changes: [],
      migrations: [],
      error: `Board version ${sourceVersion} is newer than supported version ${CURRENT_BOARD_VERSION}.`,
    };
  }

  if (migrated.version !== CURRENT_BOARD_VERSION) {
    migrated.version = CURRENT_BOARD_VERSION;
    changes.push(`set version ${CURRENT_BOARD_VERSION}`);
    migrations.push({ from: sourceVersion, to: CURRENT_BOARD_VERSION });
  }

  if (typeof migrated.projectName !== 'string' || !migrated.projectName.trim()) {
    migrated.projectName = context.config.projectName || path.basename(context.root);
    changes.push('set projectName');
  }
  if (typeof migrated.workspace !== 'string' || !migrated.workspace.trim()) {
    migrated.workspace = normalizeWorkspaceLabel(context.root, context.paths.coordinationRoot);
    changes.push('set workspace');
  }
  const normalizedUpdatedAt = normalizeIso(migrated.updatedAt, timestamp);
  const normalizedCreatedAt = normalizeIso(migrated.createdAt, normalizedUpdatedAt);
  setIfChanged(migrated, 'createdAt', normalizedCreatedAt, changes, 'set createdAt');
  setIfChanged(migrated, 'updatedAt', normalizedUpdatedAt, changes, 'set updatedAt');

  for (const key of ['tasks', 'resources', 'incidents', 'accessRequests', 'plans']) ensureArray(migrated, key, changes);
  ensureArray(migrated, 'agents', changes);
  ensureAgentSlots(migrated, context, timestamp, changes);

  const validAgentIds = new Set(migrated.agents.map((agent) => agent.id));
  const taskIds = new Set();
  for (const task of migrated.tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task) || typeof task.id !== 'string' || !task.id) continue;
    taskIds.add(task.id);
    if (!task.status) {
      task.status = 'planned';
      changes.push(`set missing status on ${task.id}`);
    }
    if (task.ownerId && !validAgentIds.has(task.ownerId)) {
      task.lastOwnerId = task.ownerId;
      task.ownerId = null;
      if (task.status === 'active') task.status = 'handoff';
      changes.push(`cleared unknown owner on ${task.id}`);
    }
    ensureTaskDefaults(task, changes);
    const taskCreatedAt = normalizeIso(task.createdAt, normalizeIso(migrated.createdAt, timestamp));
    const taskUpdatedAt = normalizeIso(task.updatedAt, taskCreatedAt);
    setIfChanged(task, 'createdAt', taskCreatedAt, changes, `set ${task.id}.createdAt`);
    setIfChanged(task, 'updatedAt', taskUpdatedAt, changes, `set ${task.id}.updatedAt`);
  }

  for (const agent of migrated.agents) {
    if (agent.taskId && !taskIds.has(agent.taskId)) {
      agent.taskId = null;
      agent.status = 'idle';
      changes.push(`cleared missing task pointer on ${agent.id}`);
    }
  }

  if (changes.length) migrated.updatedAt = timestamp;
  return { ok: true, board: migrated, sourceVersion, targetVersion: CURRENT_BOARD_VERSION, changes, migrations };
}
