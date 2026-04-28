import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace as makeTestWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeWorkspace() {
  const workspace = makeTestWorkspace({ prefix: 'ai-agents-state-status-', packageName: 'state-status-test', runtime: true });
  const { root, coordinationRoot } = workspace;
  writeBoard(root, {
    projectName: 'State Status Test',
    updatedAt: '2026-04-28T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: 'active', taskId: 'task-active' },
      { id: 'agent-2', status: 'idle', taskId: null },
    ],
    tasks: [
      {
        id: 'task-active',
        title: 'Active task',
        status: 'active',
        ownerId: 'agent-1',
        summary: 'Active work',
        claimedPaths: ['src/a'],
        verification: ['unit'],
        verificationLog: [{ check: 'unit', outcome: 'pass', at: '2026-04-28T01:00:00.000Z' }],
        dependencies: [],
        waitingOn: [],
        updatedAt: '2026-04-28T01:00:00.000Z',
      },
      {
        id: 'task-blocked',
        title: 'Blocked task',
        status: 'blocked',
        ownerId: 'agent-2',
        summary: 'Waiting for input',
        blocker: 'Need API decision',
        claimedPaths: ['src/b'],
        verification: [],
        verificationLog: [],
        dependencies: [],
        waitingOn: [],
        updatedAt: '2026-04-28T01:00:00.000Z',
      },
    ],
    resources: [],
    accessRequests: [],
    approvals: [],
    incidents: [],
  });
  fs.mkdirSync(path.join(root, 'artifacts', 'checks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts', 'checks', 'index.ndjson'), `${JSON.stringify({ check: 'unit', outcome: 'pass' })}\n`);
  fs.writeFileSync(path.join(coordinationRoot, 'runtime', 'state.lock.json'), `${JSON.stringify({ owner: 'agent-1', updatedAt: '2026-04-28T00:00:00.000Z' })}\n`);
  return workspace;
}

function run(root, coordinationRoot, args) {
  return runCli(root, args, { coordinationRoot });
}

test('state-size reports coordination and runtime sizes as JSON', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const result = run(root, coordinationRoot, ['state-size', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.ok, true);
  assert.ok(payload.files.some((file) => file.label === 'board' && file.exists && file.sizeBytes > 0));
  assert.ok(payload.files.some((file) => file.label === 'artifactIndex' && file.exists && file.sizeBytes > 0));
  assert.equal(payload.runtime.exists, true);
  assert.ok(payload.coordinationTotalBytes > 0);
  assert.ok(payload.recommendations.length >= 1);
});

test('status-badge dry-runs generated status without writing docs file', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const statusPath = path.join(root, 'docs', 'ai-agents-status.md');
  const result = run(root, coordinationRoot, ['status-badge', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.ok, true);
  assert.equal(payload.applied, false);
  assert.equal(payload.path, 'docs/ai-agents-status.md');
  assert.match(payload.content, /Health score:/);
  assert.match(payload.content, /Release readiness: not ready/);
  assert.match(payload.content, /task-active: active by agent-1/);
  assert.match(payload.content, /task-blocked: agent-2 - Need API decision/);
  assert.equal(fs.existsSync(statusPath), false);
});

test('status-badge writes generated status only with apply', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const result = run(root, coordinationRoot, ['status-badge', '--apply', '--json']);
  const payload = JSON.parse(result.stdout);
  const statusPath = path.join(root, 'docs', 'ai-agents-status.md');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, true);
  assert.equal(fs.existsSync(statusPath), true);
  assert.match(fs.readFileSync(statusPath, 'utf8'), /# AI Agents Status/);
  assert.ok(payload.workspaceSnapshotPath);
  assert.equal(fs.existsSync(payload.workspaceSnapshotPath), true);
});
