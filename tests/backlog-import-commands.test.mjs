import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace as makeTestWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeWorkspace() {
  const workspace = makeTestWorkspace({ prefix: 'ai-agents-backlog-', packageName: 'backlog-test', runtime: true });
  writeBoard(workspace.root, {
    projectName: 'Backlog Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [],
  });
  fs.writeFileSync(path.join(workspace.root, 'BACKLOG.md'), [
    '# Backlog',
    '',
    '- [ ] Add import workflow docs',
    '- [x] Already handled',
    'TODO: Wire GitHub issue importer later',
    '',
  ].join('\n'));
  return workspace;
}

function run(root, coordinationRoot, args) {
  return runCli(root, args, { coordinationRoot });
}

test('backlog-import dry-runs Markdown TODOs without mutating the board', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const boardPath = path.join(coordinationRoot, 'board.json');
  const before = fs.readFileSync(boardPath, 'utf8');

  const result = run(root, coordinationRoot, ['backlog-import', '--from', 'BACKLOG.md', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, false);
  assert.equal(payload.candidates.length, 2);
  assert.equal(payload.importedTaskIds.length, 2);
  assert.equal(fs.readFileSync(boardPath, 'utf8'), before);
});

test('backlog-import creates planned tasks with source metadata when applied', () => {
  const { root, coordinationRoot } = makeWorkspace();

  const result = run(root, coordinationRoot, ['backlog-import', '--from', 'BACKLOG.md', '--owner', 'agent-2', '--apply', '--json']);
  const payload = JSON.parse(result.stdout);
  const board = JSON.parse(fs.readFileSync(path.join(coordinationRoot, 'board.json'), 'utf8'));
  const audit = fs.readFileSync(path.join(coordinationRoot, 'runtime', 'audit.ndjson'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, true);
  assert.equal(fs.existsSync(payload.workspaceSnapshotPath), true);
  assert.equal(board.tasks.length, 2);
  assert.equal(board.tasks[0].status, 'planned');
  assert.equal(board.tasks[0].suggestedOwnerId, 'agent-2');
  assert.deepEqual(board.tasks[0].claimedPaths, ['BACKLOG.md']);
  assert.equal(board.tasks[0].importSource.type, 'markdown-todo');
  assert.equal(audit.at(-1).command, 'backlog-import');
  assert.equal(audit.at(-1).details.taskIds.length, 2);

  const secondRun = run(root, coordinationRoot, ['backlog-import', '--from', 'BACKLOG.md', '--apply', '--json']);
  const secondPayload = JSON.parse(secondRun.stdout);
  assert.equal(secondRun.status, 0, secondRun.stderr);
  assert.equal(secondPayload.applied, false);
  assert.equal(secondPayload.skippedExistingTaskIds.length, 2);
});
