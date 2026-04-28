import test from 'node:test';
import assert from 'node:assert/strict';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeAskWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-ask-', packageName: 'ask-test' });
  writeBoard(workspace.root, {
    projectName: 'Ask Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: 'active', taskId: 'task-active' },
      { id: 'agent-2', status: 'idle', taskId: null },
    ],
    tasks: [
      {
        id: 'task-active',
        title: 'Active work',
        status: 'active',
        ownerId: 'agent-1',
        summary: 'Build active feature.',
        claimedPaths: ['src/feature'],
        dependencies: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'task-blocked',
        title: 'Blocked work',
        status: 'blocked',
        ownerId: 'agent-3',
        summary: 'Waiting for credentials.',
        claimedPaths: ['server/auth'],
        dependencies: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'task-review',
        title: 'Review work',
        status: 'review',
        ownerId: null,
        summary: 'Needs verification.',
        claimedPaths: ['tests/review'],
        dependencies: [],
        suggestedOwnerId: 'agent-2',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'task-planned',
        title: 'Ready planned work',
        status: 'planned',
        ownerId: null,
        summary: 'Ready to claim.',
        claimedPaths: ['docs/ready'],
        dependencies: ['task-done'],
        suggestedOwnerId: 'agent-2',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'task-done',
        title: 'Done dependency',
        status: 'done',
        ownerId: null,
        summary: 'Dependency complete.',
        claimedPaths: ['lib/done'],
        dependencies: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    resources: [],
    incidents: [],
  });
  return workspace;
}

test('ask reports blocked work in text mode', () => {
  const { root } = makeAskWorkspace();
  const result = runCli(root, ['ask', 'what is blocked?']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /task-blocked - Blocked work/);
  assert.match(result.stdout, /Waiting for credentials/);
});

test('ask answers ownership questions for paths and tasks', () => {
  const { root } = makeAskWorkspace();
  const pathResult = runCli(root, ['ask', 'who owns src/feature/component.tsx?', '--json']);
  const taskResult = runCli(root, ['ask', 'who owns task-blocked?', '--json']);

  assert.equal(pathResult.status, 0, pathResult.stderr);
  assert.equal(taskResult.status, 0, taskResult.stderr);
  const pathPayload = JSON.parse(pathResult.stdout);
  const taskPayload = JSON.parse(taskResult.stdout);
  assert.equal(pathPayload.intent, 'ownership');
  assert.equal(pathPayload.items[0].id, 'task-active');
  assert.match(pathPayload.answer, /agent-1/);
  assert.equal(taskPayload.items[0].id, 'task-blocked');
  assert.match(taskPayload.answer, /agent-3/);
});

test('ask suggests next ready work for an idle agent', () => {
  const { root } = makeAskWorkspace();
  const result = runCli(root, ['ask', 'what can agent-2 do next?', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.intent, 'next');
  assert.equal(payload.items[0].id, 'task-review');
  assert.match(payload.answer, /agent-2 can take task-review/);
});

test('ask falls back to a summary for unsupported questions', () => {
  const { root } = makeAskWorkspace();
  const result = runCli(root, ['ask', 'how many things exist?', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.intent, 'summary');
  assert.equal(payload.matchedFallback, true);
  assert.match(payload.answer, /planned: 1/);
});
