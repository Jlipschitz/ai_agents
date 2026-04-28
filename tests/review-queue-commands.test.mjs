import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeReviewQueueWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-review-queue-', packageName: 'review-queue-test', runtime: true });
  writeBoard(workspace.root, {
    projectName: 'Review Queue Test',
    updatedAt: '2026-01-03T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: 'review', taskId: 'task-review' },
      { id: 'agent-2', status: 'idle', taskId: null },
    ],
    tasks: [
      {
        id: 'task-review',
        status: 'review',
        ownerId: 'agent-1',
        title: 'Needs review',
        claimedPaths: ['src/a'],
        priority: 'urgent',
        severity: 'high',
        updatedAt: '2026-01-01T00:00:00.000Z',
        verification: [],
        verificationLog: [],
        notes: [],
      },
      {
        id: 'task-claimed',
        status: 'review',
        ownerId: 'agent-3',
        title: 'Claimed review',
        claimedPaths: ['src/b'],
        updatedAt: '2026-01-02T00:00:00.000Z',
        reviewQueue: { status: 'claimed', reviewerId: 'agent-2', requestedAt: '2026-01-02T00:00:00.000Z', claimedAt: '2026-01-02T01:00:00.000Z' },
        verification: [],
        verificationLog: [],
        notes: [],
      },
      {
        id: 'task-approved',
        status: 'review',
        ownerId: 'agent-4',
        title: 'Approved review',
        claimedPaths: ['src/c'],
        updatedAt: '2026-01-03T00:00:00.000Z',
        reviewQueue: { status: 'approved', reviewerId: 'agent-2', requestedAt: '2026-01-03T00:00:00.000Z', completedAt: '2026-01-03T01:00:00.000Z', outcome: 'approved' },
        verification: [],
        verificationLog: [],
        notes: [],
      },
    ],
  });
  return workspace;
}

test('review-queue lists open and completed review entries', () => {
  const { root, coordinationRoot } = makeReviewQueueWorkspace();
  const open = runCli(root, ['review-queue', '--json'], { coordinationRoot });
  const all = runCli(root, ['review-queue', '--all', '--json'], { coordinationRoot });

  assert.equal(open.status, 0, open.stderr);
  assert.equal(all.status, 0, all.stderr);
  const openPayload = JSON.parse(open.stdout);
  const allPayload = JSON.parse(all.stdout);

  assert.equal(openPayload.summary.total, 2);
  assert.equal(openPayload.summary.queued, 1);
  assert.equal(openPayload.summary.claimed, 1);
  assert.ok(openPayload.items[0].score >= openPayload.items[1].score);
  assert.equal(allPayload.summary.total, 3);
  assert.equal(allPayload.summary.completed, 1);
});

test('review-queue claims and completes review work with snapshots and audit entries', () => {
  const { root, coordinationRoot } = makeReviewQueueWorkspace();
  const claim = runCli(root, ['review-queue', 'claim', 'task-review', '--agent', 'agent-2', '--apply', '--json'], { coordinationRoot });
  const complete = runCli(root, ['review-queue', 'complete', 'task-review', '--agent', 'agent-2', '--outcome', 'approve', '--note', 'Looks good', '--apply', '--json'], { coordinationRoot });
  const board = JSON.parse(fs.readFileSync(path.join(coordinationRoot, 'board.json'), 'utf8'));
  const task = board.tasks.find((entry) => entry.id === 'task-review');
  const audit = fs.readFileSync(path.join(coordinationRoot, 'runtime', 'audit.ndjson'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const snapshots = fs.readdirSync(path.join(coordinationRoot, 'runtime', 'snapshots'));

  assert.equal(claim.status, 0, claim.stderr);
  assert.equal(complete.status, 0, complete.stderr);
  assert.equal(JSON.parse(claim.stdout).applied, true);
  assert.equal(JSON.parse(complete.stdout).outcome, 'approved');
  assert.equal(task.reviewQueue.status, 'approved');
  assert.equal(task.reviewQueue.reviewerId, 'agent-2');
  assert.equal(task.reviewOutcome, 'approved');
  assert.equal(task.reviewedBy, 'agent-2');
  assert.ok(task.notes.some((note) => note.kind === 'review-claim'));
  assert.ok(task.notes.some((note) => note.kind === 'review-approved'));
  assert.equal(audit.length, 2);
  assert.ok(snapshots.length >= 2);
});
