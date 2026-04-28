import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makePromptWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-prompt-', packageName: 'prompt-test' });
  writeBoard(workspace.root, {
    projectName: 'Prompt Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: 'active', taskId: 'task-ui' },
      { id: 'agent-2', status: 'idle', taskId: null },
    ],
    tasks: [
      {
        id: 'task-ui',
        title: 'Build UI',
        status: 'active',
        ownerId: 'agent-1',
        summary: 'Implement the account settings screen.',
        claimedPaths: ['app/settings/page.tsx', 'components/settings'],
        dependencies: ['task-api'],
        waitingOn: ['task-copy'],
        relevantDocs: ['README.md', 'docs/api.md'],
        verification: ['unit', 'visual:test'],
        verificationLog: [{ at: '2026-01-01T01:00:00.000Z', agent: 'agent-1', check: 'unit', outcome: 'pass', details: 'node --test' }],
        docsReviewedAt: null,
        notes: [{ at: '2026-01-01T00:30:00.000Z', agent: 'agent-1', kind: 'claim', body: 'Claimed settings paths.' }],
      },
      {
        id: 'task-api',
        title: 'Settings API',
        status: 'done',
        ownerId: null,
        summary: 'API is ready.',
        claimedPaths: ['server/settings'],
      },
      {
        id: 'task-copy',
        title: 'Finalize copy',
        status: 'review',
        ownerId: 'agent-2',
        summary: 'Needs copy review.',
        claimedPaths: ['docs/copy.md'],
      },
    ],
    resources: [],
    incidents: [],
  });
  return workspace;
}

test('prompt generates assignment context as JSON', () => {
  const { root } = makePromptWorkspace();
  const result = runCli(root, ['prompt', 'agent-1', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.taskId, 'task-ui');
  assert.equal(payload.dependencies.length, 2);
  assert.equal(payload.dependencies[0].id, 'task-api');
  assert.equal(payload.verification.find((entry) => entry.check === 'unit').latestOutcome, 'pass');
  assert.equal(payload.verification.find((entry) => entry.check === 'visual:test').latestOutcome, null);
  assert.ok(payload.recommendations.some((entry) => entry.includes('Review relevant docs')));
  assert.match(payload.prompt, /Assigned task: task-ui - Build UI/);
  assert.match(payload.prompt, /app\/settings\/page\.tsx/);
});

test('prompt renders copy-ready text for an explicit task', () => {
  const { root } = makePromptWorkspace();
  const result = runCli(root, ['prompt', 'agent-2', 'task-ui']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Agent Prompt: agent-2/);
  assert.match(result.stdout, /Workspace: Prompt Test/);
  assert.match(result.stdout, /task-copy - Finalize copy: waiting-on, review, owner agent-2/);
  assert.match(result.stdout, /visual:test: not recorded/);
});

test('prompt reports missing assignments in JSON mode', () => {
  const { root } = makePromptWorkspace();
  const result = runCli(root, ['prompt', 'agent-3', '--json']);

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'No active or assigned task was found for agent-3.');
});

test('prompt redacts exported details in privacy mode', () => {
  const { root, configPath } = makePromptWorkspace();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.privacy = { mode: 'redacted', offline: false };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = runCli(root, ['prompt', 'agent-1', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.privacy.mode, 'redacted');
  assert.deepEqual(payload.task.claimedPaths, ['[redacted]']);
  assert.equal(payload.task.summary, '[redacted]');
  assert.match(payload.prompt, /\[redacted\]/);
  assert.doesNotMatch(payload.prompt, /app\/settings\/page\.tsx/);
});
