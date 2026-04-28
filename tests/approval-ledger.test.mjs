import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { coordinationRoot, makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeApprovalWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-approvals-', packageName: 'approvals-test', runtime: true });
  writeBoard(workspace.root, {
    projectName: 'Approval Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: 'active', taskId: 'task-one', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'agent-2', status: 'idle', taskId: null, updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    tasks: [
      {
        id: 'task-one',
        status: 'active',
        ownerId: 'agent-1',
        summary: 'Needs approval before finish.',
        claimedPaths: ['src/approval'],
        dependencies: [],
        verification: [],
        verificationLog: [],
        notes: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    resources: [],
    incidents: [],
    approvals: [],
  });
  return workspace;
}

function readBoard(root) {
  return JSON.parse(fs.readFileSync(path.join(coordinationRoot(root), 'board.json'), 'utf8'));
}

test('approvals request, grant, check, and use update the ledger', () => {
  const { root } = makeApprovalWorkspace();

  const request = runCli(root, ['approvals', 'request', 'agent-1', 'task-one', 'release', 'Ready for release approval']);
  assert.equal(request.status, 0, request.stderr);
  let board = readBoard(root);
  let approval = board.approvals[0];
  assert.equal(approval.taskId, 'task-one');
  assert.equal(approval.scope, 'release');
  assert.equal(approval.status, 'pending');
  assert.equal(board.tasks[0].notes.at(-1).kind, 'approval-request');

  const grant = runCli(root, ['approvals', 'grant', approval.id, '--by', 'agent-2', '--note', 'Reviewed scope']);
  assert.equal(grant.status, 0, grant.stderr);
  board = readBoard(root);
  approval = board.approvals[0];
  assert.equal(approval.status, 'approved');
  assert.equal(approval.decidedBy, 'agent-2');
  assert.equal(approval.decisionNote, 'Reviewed scope');

  const check = runCli(root, ['approvals', 'check', 'task-one', '--scope', 'release', '--json']);
  assert.equal(check.status, 0, check.stderr);
  assert.equal(JSON.parse(check.stdout).approval.id, approval.id);

  const use = runCli(root, ['approvals', 'use', approval.id, '--by', 'agent-1', '--note', 'Consumed by finish gate']);
  assert.equal(use.status, 0, use.stderr);
  board = readBoard(root);
  approval = board.approvals[0];
  assert.equal(approval.status, 'used');
  assert.equal(approval.usedBy, 'agent-1');
  assert.match(fs.readFileSync(path.join(coordinationRoot(root), 'journal.md'), 'utf8'), /used approval/);
  assert.match(fs.readFileSync(path.join(coordinationRoot(root), 'runtime', 'audit.ndjson'), 'utf8'), /"command":"approvals"/);
});

test('finish approval gate blocks until an approval exists', () => {
  const { root } = makeApprovalWorkspace();
  const boardPath = path.join(coordinationRoot(root), 'board.json');
  const before = fs.readFileSync(boardPath, 'utf8');

  const blocked = runCli(root, ['finish', 'agent-1', 'task-one', '--require-approval', '--approval-scope', 'release', 'Finished after approval']);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /missing an approved approval-ledger entry/);
  assert.equal(fs.readFileSync(boardPath, 'utf8'), before);

  const request = runCli(root, ['approvals', 'request', 'agent-1', 'task-one', 'release', 'Ready for release approval']);
  assert.equal(request.status, 0, request.stderr);
  const approvalId = readBoard(root).approvals[0].id;
  const grant = runCli(root, ['approvals', 'grant', approvalId, '--by', 'agent-2']);
  assert.equal(grant.status, 0, grant.stderr);

  const finished = runCli(root, ['finish', 'agent-1', 'task-one', '--require-approval', '--approval-scope', 'release', 'Finished after approval']);
  assert.equal(finished.status, 0, finished.stderr);
  assert.equal(readBoard(root).tasks[0].status, 'done');
});

test('status and prompt surface approval ledger entries', () => {
  const { root } = makeApprovalWorkspace();
  const request = runCli(root, ['approvals', 'request', 'agent-1', 'task-one', 'release', 'Ready for release approval']);
  assert.equal(request.status, 0, request.stderr);

  const status = runCli(root, ['status']);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Approvals:/);
  assert.match(status.stdout, /scope release/);

  const prompt = runCli(root, ['prompt', 'agent-1', 'task-one']);
  assert.equal(prompt.status, 0, prompt.stderr);
  assert.match(prompt.stdout, /## Approvals/);
  assert.match(prompt.stdout, /Ready for release approval/);
});
