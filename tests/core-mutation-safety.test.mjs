import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { coordinationRoot, makeWorkspace, runCli, snapshotFiles, writeBoard } from './helpers/workspace.mjs';

function makeActiveWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-mutation-safety-', runtime: true });
  writeBoard(workspace.root, {
    projectName: 'Mutation Safety',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      {
        id: 'task-one',
        status: 'active',
        ownerId: 'agent-1',
        summary: 'Existing task',
        claimedPaths: ['src/existing'],
        verification: [],
        verificationLog: [],
        notes: [],
      },
    ],
  });
  return workspace;
}

test('legacy core mutation dry-run leaves board, journal, and task docs untouched', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-mutation-safety-', runtime: true });
  writeBoard(root, {
    projectName: 'Mutation Safety',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [],
  });
  const rootCoordination = coordinationRoot(root);
  const boardPath = path.join(rootCoordination, 'board.json');
  const journalPath = path.join(rootCoordination, 'journal.md');
  const taskDocPath = path.join(rootCoordination, 'tasks', 'task-dry.md');
  const before = snapshotFiles([boardPath, journalPath, taskDocPath]);

  const result = runCli(root, ['claim', 'agent-1', 'task-dry', '--paths', 'src/dry', '--summary', 'Dry run task', '--dry-run']);
  const after = snapshotFiles([boardPath, journalPath, taskDocPath]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run: no state was changed for claim\./);
  assert.deepEqual(after, before);
});

test('core state transaction restores board and journal when task doc sync fails', () => {
  const { root } = makeActiveWorkspace();
  const rootCoordination = coordinationRoot(root);
  const boardPath = path.join(rootCoordination, 'board.json');
  const journalPath = path.join(rootCoordination, 'journal.md');
  const tasksRoot = path.join(rootCoordination, 'tasks');
  const taskDocPath = path.join(tasksRoot, 'task-one.md');
  fs.mkdirSync(taskDocPath, { recursive: true });
  const before = snapshotFiles([boardPath, journalPath]);

  const result = runCli(root, ['progress', 'agent-1', 'task-one', 'should rollback']);
  const after = snapshotFiles([boardPath, journalPath]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^error:/);
  assert.deepEqual(after, before);
  assert.equal(fs.statSync(taskDocPath).isDirectory(), true);
});

test('run-check dry-run does not execute commands or write artifacts', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-mutation-safety-', runtime: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'mutation-safety',
    scripts: {
      danger: 'node -e "require(\\"node:fs\\").writeFileSync(\\"ran.txt\\", \\"1\\")"',
    },
  }, null, 2));

  const result = runCli(root, ['run-check', 'danger', '--dry-run', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, false);
  assert.equal(payload.name, 'danger');
  assert.equal(fs.existsSync(path.join(root, 'ran.txt')), false);
  assert.equal(fs.existsSync(path.join(root, 'artifacts', 'checks')), false);
});
