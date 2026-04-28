import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { makeWorkspace as makeTestWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeWorkspace() {
  const workspace = makeTestWorkspace({ prefix: 'ai-agents-archive-', packageName: 'archive-test', runtime: true });
  writeBoard(workspace.root, {
    projectName: 'Archive Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-done', status: 'done', title: 'Done task', updatedAt: '2000-01-01T00:00:00.000Z' },
      { id: 'task-released', status: 'released', title: 'Released task', createdAt: '2000-01-01T00:00:00.000Z' },
      { id: 'task-active', status: 'active', title: 'Active task', updatedAt: '2000-01-01T00:00:00.000Z' },
    ],
  });
  fs.mkdirSync(path.join(workspace.coordinationRoot, 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(workspace.coordinationRoot, 'tasks', 'task-done.md'), '# Done task\n');
  fs.writeFileSync(path.join(workspace.coordinationRoot, 'tasks', 'task-released.md'), '# Released task\n');
  return workspace;
}

function run(root, coordinationRoot, args) {
  return runCli(root, args, { coordinationRoot });
}

test('archive-completed dry-runs without mutating board or task docs', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const boardPath = path.join(coordinationRoot, 'board.json');
  const before = fs.readFileSync(boardPath, 'utf8');

  const result = run(root, coordinationRoot, ['archive-completed', '--json', '--older-than-days', '1']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, false);
  assert.deepEqual(payload.archivedTaskIds, ['task-done', 'task-released']);
  assert.equal(fs.readFileSync(boardPath, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(coordinationRoot, 'tasks', 'task-done.md')), true);
  assert.equal(fs.existsSync(payload.archivePath), false);
});

test('archive-completed applies archive, snapshots board, and removes archived task docs', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const boardPath = path.join(coordinationRoot, 'board.json');

  const result = run(root, coordinationRoot, ['archive-completed', '--apply', '--json', '--older-than-days', '1']);
  const payload = JSON.parse(result.stdout);
  const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
  const archive = JSON.parse(fs.readFileSync(payload.archivePath, 'utf8'));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, true);
  assert.equal(fs.existsSync(payload.snapshotPath), true);
  assert.equal(fs.existsSync(payload.workspaceSnapshotPath), true);
  assert.match(zlib.gunzipSync(fs.readFileSync(payload.workspaceSnapshotPath)).toString('utf8'), /task-done/);
  assert.deepEqual(board.tasks.map((task) => task.id), ['task-active']);
  assert.deepEqual(archive.tasks.map((task) => task.id), ['task-done', 'task-released']);
  assert.equal(fs.existsSync(path.join(coordinationRoot, 'tasks', 'task-done.md')), false);
  assert.equal(fs.existsSync(path.join(coordinationRoot, 'tasks', 'task-released.md')), false);
});
