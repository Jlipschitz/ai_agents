import fs from 'node:fs';
import path from 'node:path';

import { getNumberFlag, hasFlag } from './args-utils.mjs';
import { fileTimestamp, nowIso, parseIsoMs, readJsonSafe, writeJson } from './file-utils.mjs';
import { normalizePath } from './path-utils.mjs';
import { writePreMutationWorkspaceSnapshot } from './workspace-snapshot-commands.mjs';

const TERMINAL_STATUSES = new Set(['done', 'released']);
const DEFAULT_OLDER_THAN_DAYS = 14;

function taskUpdatedMs(task) {
  return parseIsoMs(task.updatedAt) ?? parseIsoMs(task.createdAt) ?? 0;
}

function shouldArchiveTask(task, olderThanDays, referenceMs = Date.now()) {
  if (!TERMINAL_STATUSES.has(task.status)) return false;
  const updatedMs = taskUpdatedMs(task);
  if (!updatedMs) return false;
  return (referenceMs - updatedMs) / 86400000 >= olderThanDays;
}

function archiveFilePath(paths, date = new Date()) {
  const month = date.toISOString().slice(0, 7);
  return path.join(paths.coordinationRoot, 'archive', `tasks-${month}.json`);
}

function mergeArchivedTasks(existing, tasks) {
  const byId = new Map((Array.isArray(existing?.tasks) ? existing.tasks : []).map((task) => [task.id, task]));
  for (const task of tasks) byId.set(task.id, task);
  return {
    version: 1,
    updatedAt: nowIso(),
    tasks: [...byId.values()].sort((left, right) => String(left.id).localeCompare(String(right.id))),
  };
}

function snapshotBoard(paths) {
  if (!fs.existsSync(paths.boardPath)) return null;
  fs.mkdirSync(paths.snapshotsRoot, { recursive: true });
  const snapshotPath = path.join(paths.snapshotsRoot, `board-${fileTimestamp()}-before-archive.json`);
  fs.copyFileSync(paths.boardPath, snapshotPath);
  return snapshotPath;
}

function removeTaskDocs(paths, tasks) {
  for (const task of tasks) {
    if (!task.id) continue;
    fs.rmSync(path.join(paths.tasksRoot, `${task.id}.md`), { force: true });
  }
}

export function buildArchiveCompletedPlan(paths, argv) {
  const olderThanDays = getNumberFlag(argv, '--older-than-days', DEFAULT_OLDER_THAN_DAYS);
  const board = readJsonSafe(paths.boardPath, { tasks: [] });
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const archiveTasks = tasks.filter((task) => shouldArchiveTask(task, olderThanDays));
  const keepTasks = tasks.filter((task) => !archiveTasks.includes(task));
  const archivePath = archiveFilePath(paths);
  return {
    ok: true,
    applied: false,
    olderThanDays,
    boardPath: paths.boardPath,
    archivePath,
    snapshotPath: null,
    workspaceSnapshotPath: null,
    archivedTaskIds: archiveTasks.map((task) => task.id),
    archiveTasks,
    nextBoard: { ...board, tasks: keepTasks },
  };
}

export function runArchiveCompleted(argv, paths) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const plan = buildArchiveCompletedPlan(paths, argv);

  if (apply && plan.archiveTasks.length) {
    plan.workspaceSnapshotPath = writePreMutationWorkspaceSnapshot(paths, 'archive-completed');
    plan.snapshotPath = snapshotBoard(paths);
    const existingArchive = readJsonSafe(plan.archivePath, { version: 1, tasks: [] });
    writeJson(plan.archivePath, mergeArchivedTasks(existingArchive, plan.archiveTasks));
    plan.nextBoard.updatedAt = nowIso();
    writeJson(paths.boardPath, plan.nextBoard);
    removeTaskDocs(paths, plan.archiveTasks);
    plan.applied = true;
  }

  const result = {
    ok: true,
    applied: plan.applied,
    olderThanDays: plan.olderThanDays,
    archivedTaskIds: plan.archivedTaskIds,
    archivePath: plan.archivePath,
    snapshotPath: plan.snapshotPath,
    workspaceSnapshotPath: plan.workspaceSnapshotPath,
  };

  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(apply ? 'Archive completed work applied.' : 'Archive completed work dry run.');
    console.log(`Archive: ${normalizePath(plan.archivePath) || plan.archivePath}`);
    console.log(plan.archivedTaskIds.length ? plan.archivedTaskIds.map((id) => `- ${id}`).join('\n') : '- no eligible completed tasks');
    if (plan.workspaceSnapshotPath) console.log(`Workspace snapshot: ${normalizePath(plan.workspaceSnapshotPath) || plan.workspaceSnapshotPath}`);
    if (plan.snapshotPath) console.log(`Snapshot: ${normalizePath(plan.snapshotPath) || plan.snapshotPath}`);
  }

  return 0;
}
