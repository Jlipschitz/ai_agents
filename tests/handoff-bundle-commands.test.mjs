import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { makeWorkspace, runCli, snapshotFiles, writeBoard } from './helpers/workspace.mjs';

function makeHandoffWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-handoff-', packageName: 'handoff-test', runtime: true });
  const { root, coordinationRoot } = workspace;
  writeBoard(root, {
    projectName: 'Handoff Test',
    updatedAt: '2026-04-28T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: 'review', taskId: 'task-review' },
      { id: 'agent-2', status: 'idle', taskId: null },
    ],
    tasks: [
      {
        id: 'task-dep',
        title: 'Dependency',
        status: 'done',
        ownerId: 'agent-3',
        claimedPaths: ['api'],
        updatedAt: '2026-04-28T00:30:00.000Z',
      },
      {
        id: 'task-review',
        title: 'Reviewable work',
        summary: 'Finish the handoff view.',
        status: 'review',
        ownerId: 'agent-1',
        claimedPaths: ['src/handoff'],
        dependencies: ['task-dep'],
        waitingOn: [],
        verification: ['unit', 'lint'],
        verificationLog: [{ at: '2026-04-28T01:00:00.000Z', agent: 'agent-1', check: 'unit', outcome: 'pass', details: 'unit passed' }],
        relevantDocs: ['README.md'],
        docsReviewedAt: '2026-04-28T01:10:00.000Z',
        docsReviewedBy: 'agent-1',
        priority: 'high',
        dueAt: '2026-05-01T00:00:00.000Z',
        severity: 'moderate',
        notes: [{ at: '2026-04-28T01:30:00.000Z', agent: 'agent-1', kind: 'handoff', body: 'Ready for final verification.' }],
        updatedAt: '2026-04-28T01:30:00.000Z',
      },
      {
        id: 'task-planned',
        title: 'Planned docs',
        summary: 'Document the handoff command.',
        status: 'planned',
        ownerId: null,
        suggestedOwnerId: 'agent-2',
        claimedPaths: ['docs'],
        dependencies: [],
        waitingOn: [],
        verification: [],
        verificationLog: [],
        relevantDocs: [],
        updatedAt: '2026-04-28T00:45:00.000Z',
      },
    ],
    approvals: [],
    resources: [],
    incidents: [],
  });
  return workspace;
}

function stateFiles(coordinationRoot) {
  return [
    path.join(coordinationRoot, 'board.json'),
    path.join(coordinationRoot, 'journal.md'),
    path.join(coordinationRoot, 'messages.ndjson'),
  ];
}

function runReadOnly(args) {
  const { root, coordinationRoot } = makeHandoffWorkspace();
  const files = stateFiles(coordinationRoot);
  const before = snapshotFiles(files);
  const result = runCli(root, args, { coordinationRoot });
  const after = snapshotFiles(files);
  assert.deepEqual(after, before);
  return result;
}

test('next recommends the missing verification command for active review work', () => {
  const result = runReadOnly(['next', 'agent-1', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.category, 'verification');
  assert.equal(payload.taskId, 'task-review');
  assert.match(payload.reason, /lint/);
  assert.match(payload.command, /npm run agents -- verify agent-1 task-review lint pass/);
});

test('next recommends a claim command for an idle agent with ready planned work', () => {
  const result = runReadOnly(['next', 'agent-2', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.category, 'claim');
  assert.equal(payload.taskId, 'task-planned');
  assert.match(payload.command, /claim agent-2 task-planned/);
  assert.match(payload.command, /--paths docs/);
});

test('handoff-bundle includes task context, prompt, and next command', () => {
  const result = runReadOnly(['handoff-bundle', 'agent-1', 'task-review', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.taskId, 'task-review');
  assert.equal(payload.recommendation.category, 'verification');
  assert.match(payload.recommendation.command, /verify agent-1 task-review lint pass/);
  assert.match(payload.bundle, /# Handoff Bundle: task-review/);
  assert.match(payload.bundle, /## Copy\/Paste Prompt/);
  assert.match(payload.prompt, /# Agent Prompt: agent-1/);
});

test('handoff-bundle reports usage errors as JSON', () => {
  const result = runReadOnly(['handoff-bundle', '--json']);

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'usage_error');
  assert.match(payload.error, /^Usage: handoff-bundle/);
});
