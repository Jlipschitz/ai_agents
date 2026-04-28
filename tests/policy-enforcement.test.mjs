import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { coordinationRoot, makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function setPolicy(root, policyEnforcement) {
  const configPath = path.join(root, 'agent-coordination.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.policyEnforcement = policyEnforcement;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function writeCodeowners(root) {
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), ['/app/ @frontend', '/api/ @backend', ''].join('\n'));
}

test('policy-check reports warn-mode findings without failing', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-policy-check-', packageName: 'policy-test' });
  writeCodeowners(root);
  writeBoard(root, {
    projectName: 'Policy Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-broad', status: 'active', ownerId: 'agent-1', title: 'Broad task', claimedPaths: ['src'] },
      { id: 'task-cross', status: 'active', ownerId: 'agent-2', title: 'Cross task', claimedPaths: ['app/page.js', 'api/route.js'] },
    ],
  });

  const result = runCli(root, ['policy-check', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.mode, 'warn');
  assert.equal(payload.blocking, false);
  assert.ok(payload.findings.some((entry) => entry.rule === 'broadClaims' && entry.taskId === 'task-broad'));
  assert.ok(payload.findings.some((entry) => entry.rule === 'codeownersCrossing' && entry.taskId === 'task-cross'));
});

test('policy-check fails in block mode when enabled rules have findings', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-policy-block-', packageName: 'policy-test' });
  setPolicy(root, {
    mode: 'block',
    rules: {
      broadClaims: true,
      codeownersCrossing: false,
      finishRequiresApproval: false,
      finishRequiresDocsReview: false,
      finishApprovalScope: '',
    },
  });
  writeBoard(root, {
    projectName: 'Policy Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-broad', status: 'active', ownerId: 'agent-1', title: 'Broad task', claimedPaths: ['src'] }],
  });

  const result = runCli(root, ['policy-check', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(payload.blocking, true);
  assert.equal(payload.findings[0].level, 'error');
});

test('claim is blocked by block-mode broad claim policy before mutation', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-policy-claim-', packageName: 'policy-test' });
  setPolicy(root, {
    mode: 'block',
    rules: {
      broadClaims: true,
      codeownersCrossing: false,
      finishRequiresApproval: false,
      finishRequiresDocsReview: false,
      finishApprovalScope: '',
    },
  });
  writeBoard(root, {
    projectName: 'Policy Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-one', status: 'planned', ownerId: null, title: 'Task one', claimedPaths: [] }],
  });
  const boardPath = path.join(coordinationRoot(root), 'board.json');
  const before = fs.readFileSync(boardPath, 'utf8');

  const result = runCli(root, ['claim', 'agent-1', 'task-one', '--paths', 'src']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Policy enforcement blocked claim/);
  assert.match(result.stderr, /broadClaims/);
  assert.equal(fs.readFileSync(boardPath, 'utf8'), before);
});

test('finish is blocked by configured docs and approval policies', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-policy-finish-', packageName: 'policy-test' });
  setPolicy(root, {
    mode: 'block',
    rules: {
      broadClaims: false,
      codeownersCrossing: false,
      finishRequiresApproval: true,
      finishRequiresDocsReview: true,
      finishApprovalScope: 'release',
    },
  });
  writeBoard(root, {
    projectName: 'Policy Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    approvals: [],
    tasks: [{ id: 'task-one', status: 'active', ownerId: 'agent-1', title: 'Task one', claimedPaths: ['src/a'], verification: [], verificationLog: [], relevantDocs: ['README.md'] }],
  });
  const boardPath = path.join(coordinationRoot(root), 'board.json');
  const before = fs.readFileSync(boardPath, 'utf8');

  const blocked = runCli(root, ['finish', 'agent-1', 'task-one', 'Done']);

  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /Policy enforcement blocked finish/);
  assert.match(blocked.stderr, /docsReviewedAt/);
  assert.match(blocked.stderr, /approval-ledger/);
  assert.equal(fs.readFileSync(boardPath, 'utf8'), before);

  const board = JSON.parse(before);
  board.approvals = [{ id: 'approval-task-one-release', taskId: 'task-one', scope: 'release', status: 'approved' }];
  board.tasks[0].docsReviewedAt = '2026-01-01T00:00:00.000Z';
  board.tasks[0].docsReviewedBy = 'agent-1';
  fs.writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`);

  const allowed = runCli(root, ['finish', 'agent-1', 'task-one', 'Done']);
  const nextBoard = JSON.parse(fs.readFileSync(boardPath, 'utf8'));

  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(nextBoard.tasks[0].status, 'done');
});
