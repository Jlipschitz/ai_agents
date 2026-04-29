import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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

test('ask open-ended reports a clear error without a configured provider', () => {
  const { root } = makeAskWorkspace();
  const result = runCli(root, ['ask', 'explain the board risk', '--open-ended', '--json'], {
    env: { AI_AGENTS_ASK_MODEL_COMMAND: '' },
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /requires a local provider command/);
  assert.match(payload.error, /AI_AGENTS_ASK_MODEL_COMMAND/);
});

test('ask open-ended sends deterministic board context to a local model command', () => {
  const { root } = makeAskWorkspace();
  const fakeProvider = path.join(root, 'fake-provider.mjs');
  fs.writeFileSync(fakeProvider, `
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  const taskIds = payload.board.tasks.map((task) => task.id).join(',');
  const agentIds = payload.board.agents.map((agent) => agent.id).join(',');
  console.log(JSON.stringify({
    question: payload.question,
    projectName: payload.board.projectName,
    taskIds,
    agentIds,
    blocked: payload.board.counts.blocked,
    firstTaskPaths: payload.board.tasks[0].claimedPaths,
  }));
});
`);
  const command = `"${process.execPath}" "${fakeProvider}"`;
  const result = runCli(root, ['ask', 'explain the board risk', '--model-command', command, '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  const answer = JSON.parse(payload.answer);
  assert.equal(payload.intent, 'open-ended');
  assert.equal(answer.question, 'explain the board risk');
  assert.equal(answer.projectName, 'Ask Test');
  assert.equal(answer.taskIds, 'task-active,task-blocked,task-done,task-planned,task-review');
  assert.equal(answer.agentIds, 'agent-1,agent-2');
  assert.equal(answer.blocked, 1);
  assert.deepEqual(answer.firstTaskPaths, ['src/feature']);
});
