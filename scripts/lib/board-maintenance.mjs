import fs from 'node:fs';
import path from 'node:path';

import { getFlagValue, hasFlag } from './args-utils.mjs';
import { fileTimestamp, nowIso, readJsonDetailed, writeJson } from './file-utils.mjs';
import { normalizePath, resolveRepoPath } from './path-utils.mjs';
import { writePreMutationWorkspaceSnapshot } from './workspace-snapshot-commands.mjs';

function getConfiguredAgentIds(context) {
  const { config, defaultAgentIds } = context;
  return Array.isArray(config.agentIds) && config.agentIds.length ? config.agentIds.filter((entry) => typeof entry === 'string' && entry.trim()) : defaultAgentIds;
}

function createStarterBoard(context) {
  const { config, root } = context;
  const timestamp = nowIso();
  return {
    version: 1,
    projectName: config.projectName || path.basename(root),
    agents: getConfiguredAgentIds(context).map((id) => ({ id, status: 'idle', taskId: null, updatedAt: timestamp })),
    tasks: [],
    resources: [],
    incidents: [],
    accessRequests: [],
    updatedAt: timestamp,
  };
}

function readBoardDetailed(paths) {
  return { boardPath: paths.boardPath, ...readJsonDetailed(paths.boardPath) };
}

function countTasksByStatus(tasks) {
  const counts = {};
  for (const task of tasks) counts[task?.status || 'unknown'] = (counts[task?.status || 'unknown'] ?? 0) + 1;
  return counts;
}

function inspectBoard(context) {
  const { paths, validTaskStatuses, activeStatuses } = context;
  const { boardPath, exists, value: board, error } = readBoardDetailed(paths);
  const findings = [];
  const warnings = [];
  if (!exists) return { ok: false, boardPath, exists, findings: ['board.json does not exist. Run doctor --fix or init first.'], warnings, counts: {}, tasks: 0 };
  if (error) return { ok: false, boardPath, exists, malformed: true, findings: [`board.json is not valid JSON: ${error}`], warnings, counts: {}, tasks: 0 };
  if (!board || typeof board !== 'object' || Array.isArray(board)) return { ok: false, boardPath, exists, findings: ['board.json must contain an object.'], warnings, counts: {}, tasks: 0 };
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const agents = Array.isArray(board.agents) ? board.agents : [];
  if (!Array.isArray(board.tasks)) warnings.push('tasks is missing or not an array.');
  if (!Array.isArray(board.agents)) warnings.push('agents is missing or not an array.');
  for (const key of ['resources', 'incidents', 'accessRequests']) {
    if (key in board && !Array.isArray(board[key])) warnings.push(`${key} is not an array.`);
  }
  const taskIds = new Set();
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) {
      findings.push('A task entry is not an object.');
      continue;
    }
    if (!task.id || typeof task.id !== 'string') {
      findings.push('A task is missing a string id.');
      continue;
    }
    if (taskIds.has(task.id)) findings.push(`Task id "${task.id}" is duplicated.`);
    taskIds.add(task.id);
    if (!validTaskStatuses.has(task.status)) findings.push(`Task "${task.id}" has unknown status "${task.status}".`);
    if (activeStatuses.has(task.status) && !task.ownerId) findings.push(`Task "${task.id}" is ${task.status} but has no owner.`);
  }
  const agentIds = new Set();
  for (const agent of agents) {
    if (!agent || typeof agent !== 'object' || Array.isArray(agent)) {
      findings.push('An agent entry is not an object.');
      continue;
    }
    if (!agent.id || typeof agent.id !== 'string') {
      findings.push('An agent is missing a string id.');
      continue;
    }
    if (agentIds.has(agent.id)) findings.push(`Agent id "${agent.id}" is duplicated.`);
    agentIds.add(agent.id);
    if (agent.taskId && !taskIds.has(agent.taskId)) findings.push(`Agent "${agent.id}" points to missing task "${agent.taskId}".`);
  }
  for (const task of tasks) {
    if (!task?.ownerId) continue;
    if (!agentIds.has(task.ownerId)) findings.push(`Task "${task.id}" is owned by unknown agent "${task.ownerId}".`);
  }
  const overlapFindings = [];
  const claimed = tasks.filter((task) => task?.ownerId && activeStatuses.has(task.status) && Array.isArray(task.claimedPaths));
  for (let leftIndex = 0; leftIndex < claimed.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < claimed.length; rightIndex += 1) {
      const overlap = claimed[leftIndex].claimedPaths.find((left) => claimed[rightIndex].claimedPaths.includes(left));
      if (overlap) overlapFindings.push(`Active path overlap between "${claimed[leftIndex].id}" and "${claimed[rightIndex].id}" on "${overlap}".`);
    }
  }
  findings.push(...overlapFindings);
  return { ok: findings.length === 0, boardPath, exists, malformed: false, findings, warnings, counts: countTasksByStatus(tasks), tasks: tasks.length, agents: agents.length, updatedAt: board.updatedAt ?? null };
}

function printBoardInspection(report, json = false) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`# Board Inspection\n\nBoard: ${normalizePath(report.boardPath) || report.boardPath}`);
  console.log(`Tasks: ${report.tasks}`);
  console.log(`Agents: ${report.agents ?? 0}`);
  console.log(`Counts: ${Object.entries(report.counts).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`);
  console.log('\nFindings:');
  console.log(report.findings.length ? report.findings.map((entry) => `- ${entry}`).join('\n') : '- none');
  console.log('\nWarnings:');
  console.log(report.warnings.length ? report.warnings.map((entry) => `- ${entry}`).join('\n') : '- none');
}

function repairBoardObject(board, context) {
  const { config, root, validTaskStatuses } = context;
  const repaired = board && typeof board === 'object' && !Array.isArray(board) ? JSON.parse(JSON.stringify(board)) : createStarterBoard(context);
  const changes = [];
  const timestamp = nowIso();
  if (!Number.isInteger(repaired.version)) { repaired.version = 1; changes.push('set version'); }
  if (typeof repaired.projectName !== 'string' || !repaired.projectName.trim()) { repaired.projectName = config.projectName || path.basename(root); changes.push('set projectName'); }
  for (const key of ['tasks', 'resources', 'incidents', 'accessRequests']) {
    if (!Array.isArray(repaired[key])) { repaired[key] = []; changes.push(`initialized ${key}`); }
  }
  if (!Array.isArray(repaired.agents)) { repaired.agents = []; changes.push('initialized agents'); }
  for (const agentId of getConfiguredAgentIds(context)) {
    if (!repaired.agents.some((agent) => agent?.id === agentId)) {
      repaired.agents.push({ id: agentId, status: 'idle', taskId: null, updatedAt: timestamp });
      changes.push(`added agent ${agentId}`);
    }
  }
  const agentIds = new Set(repaired.agents.map((agent) => agent?.id).filter(Boolean));
  const taskIds = new Set();
  for (const task of repaired.tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task) || typeof task.id !== 'string' || !task.id) continue;
    taskIds.add(task.id);
    if (!validTaskStatuses.has(task.status) && !task.status) {
      task.status = 'planned';
      changes.push(`set missing status on ${task.id}`);
    }
    for (const key of ['claimedPaths', 'dependencies', 'waitingOn', 'verification', 'verificationLog', 'notes', 'relevantDocs']) {
      if (!Array.isArray(task[key])) { task[key] = []; changes.push(`initialized ${task.id}.${key}`); }
    }
    if (!('docsReviewedAt' in task)) { task.docsReviewedAt = null; changes.push(`initialized ${task.id}.docsReviewedAt`); }
    if (!('lastOwnerId' in task)) { task.lastOwnerId = null; changes.push(`initialized ${task.id}.lastOwnerId`); }
    if (task.ownerId && !agentIds.has(task.ownerId)) { task.lastOwnerId = task.ownerId; task.ownerId = null; task.status = task.status === 'active' ? 'handoff' : task.status; changes.push(`cleared unknown owner on ${task.id}`); }
  }
  for (const agent of repaired.agents) {
    if (!agent || typeof agent !== 'object' || !agent.id) continue;
    if (!agent.status) { agent.status = agent.taskId ? 'active' : 'idle'; changes.push(`set status on ${agent.id}`); }
    if (agent.taskId && !taskIds.has(agent.taskId)) { agent.taskId = null; agent.status = 'idle'; changes.push(`cleared missing task pointer on ${agent.id}`); }
    if (!agent.updatedAt) agent.updatedAt = timestamp;
  }
  if (changes.length) repaired.updatedAt = timestamp;
  return { board: repaired, changes };
}

function snapshotBoard(paths, label = 'snapshot') {
  if (!fs.existsSync(paths.boardPath)) return null;
  fs.mkdirSync(paths.snapshotsRoot, { recursive: true });
  const snapshotPath = path.join(paths.snapshotsRoot, `board-${fileTimestamp()}-${label}.json`);
  fs.copyFileSync(paths.boardPath, snapshotPath);
  return snapshotPath;
}

export function runInspectBoard(argv, context) {
  const report = inspectBoard(context);
  printBoardInspection(report, hasFlag(argv, '--json'));
  return report.ok ? 0 : 1;
}

export function runRepairBoard(argv, context) {
  const { paths } = context;
  const apply = hasFlag(argv, '--apply');
  const json = hasFlag(argv, '--json');
  const { exists, value: board, error } = readBoardDetailed(paths);
  if (error) {
    const result = { ok: false, applied: false, error: `Cannot repair malformed JSON automatically: ${error}` };
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.error(result.error);
    return 1;
  }
  const sourceBoard = exists ? board : createStarterBoard(context);
  const repair = repairBoardObject(sourceBoard, context);
  const result = { ok: true, applied: apply, createdBoard: !exists, changes: exists ? repair.changes : ['created board'], snapshotPath: null, workspaceSnapshotPath: null };
  if (apply) {
    result.workspaceSnapshotPath = writePreMutationWorkspaceSnapshot(paths, 'repair-board');
    result.snapshotPath = snapshotBoard(paths, 'before-repair');
    writeJson(paths.boardPath, repair.board);
  }
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(apply ? 'Board repair applied.' : 'Board repair dry run.');
    console.log(result.changes.length ? result.changes.map((entry) => `- ${entry}`).join('\n') : '- no changes needed');
    if (result.workspaceSnapshotPath) console.log(`Workspace snapshot: ${normalizePath(result.workspaceSnapshotPath) || result.workspaceSnapshotPath}`);
    if (result.snapshotPath) console.log(`Snapshot: ${normalizePath(result.snapshotPath) || result.snapshotPath}`);
  }
  return 0;
}

function listBoardSnapshots(paths) {
  if (!fs.existsSync(paths.snapshotsRoot)) return [];
  return fs.readdirSync(paths.snapshotsRoot)
    .filter((entry) => /^board-.*\.json$/.test(entry))
    .map((entry) => path.join(paths.snapshotsRoot, entry))
    .sort();
}

export function runRollbackState(argv, context) {
  const { paths } = context;
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const snapshots = listBoardSnapshots(paths);
  if (hasFlag(argv, '--list') || !getFlagValue(argv, '--to', '')) {
    const result = { snapshots };
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(snapshots.length ? snapshots.map((entry) => `- ${normalizePath(entry) || entry}`).join('\n') : 'No board snapshots found.');
    return 0;
  }
  const target = getFlagValue(argv, '--to', '');
  const snapshotPath = target === 'latest' ? snapshots.at(-1) : resolveRepoPath(target, target);
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    const message = `Snapshot not found: ${target}`;
    if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(message);
    return 1;
  }
  const parsed = readJsonDetailed(snapshotPath);
  if (parsed.error) {
    const message = `Snapshot is not valid JSON: ${parsed.error}`;
    if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(message);
    return 1;
  }
  const result = { ok: true, applied: apply, snapshotPath, backupPath: null, workspaceSnapshotPath: null };
  if (apply) {
    result.workspaceSnapshotPath = writePreMutationWorkspaceSnapshot(paths, 'rollback-state');
    result.backupPath = snapshotBoard(paths, 'before-rollback');
    writeJson(paths.boardPath, parsed.value);
  }
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(apply ? `Rolled back board from ${normalizePath(snapshotPath) || snapshotPath}.` : `Rollback dry run: ${normalizePath(snapshotPath) || snapshotPath}`);
    if (result.workspaceSnapshotPath) console.log(`Workspace snapshot: ${normalizePath(result.workspaceSnapshotPath) || result.workspaceSnapshotPath}`);
    if (result.backupPath) console.log(`Previous board snapshot: ${normalizePath(result.backupPath) || result.backupPath}`);
  }
  return 0;
}
