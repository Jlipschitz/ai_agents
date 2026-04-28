import test from 'node:test';
import assert from 'node:assert/strict';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

test('critical-path finds the longest remaining dependency chain', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-critical-path-', packageName: 'critical-path-test' });
  writeBoard(root, {
    projectName: 'Critical Path Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-a', status: 'planned', ownerId: null, title: 'Foundation', effort: 'small', claimedPaths: ['src/a'], dependencies: [], verification: [], verificationLog: [] },
      { id: 'task-b', status: 'planned', ownerId: null, title: 'Middle', effort: 'medium', claimedPaths: ['src/b'], dependencies: ['task-a'], verification: [], verificationLog: [] },
      { id: 'task-c', status: 'planned', ownerId: null, title: 'Finish', effort: 'large', claimedPaths: ['src/c'], dependencies: ['task-b'], verification: [], verificationLog: [] },
      { id: 'task-side', status: 'planned', ownerId: null, title: 'Side quest', effort: 'small', claimedPaths: ['docs'], dependencies: [], verification: [], verificationLog: [] },
    ],
  });

  const result = runCli(root, ['critical-path', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(payload.criticalPath.taskIds, ['task-a', 'task-b', 'task-c']);
  assert.equal(payload.readyTasks[0].taskId, 'task-a');
  assert.ok(payload.blockedTasks.some((entry) => entry.taskId === 'task-c' && entry.waitingOn.includes('task-b')));
});

test('critical-path reports missing dependencies as warnings', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-critical-path-warn-', packageName: 'critical-path-test' });
  writeBoard(root, {
    projectName: 'Critical Path Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-a', status: 'planned', ownerId: null, title: 'Missing dependency', effort: 'small', claimedPaths: ['src/a'], dependencies: ['task-missing'], verification: [], verificationLog: [] },
    ],
  });

  const result = runCli(root, ['critical-path']);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Task task-a depends on missing task task-missing/);
});
