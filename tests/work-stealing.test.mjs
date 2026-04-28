import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

test('steal-work ranks handoff and stale candidates for an idle agent', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-work-steal-', packageName: 'work-steal-test' });
  writeBoard(root, {
    projectName: 'Work Steal Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: 'active', taskId: 'task-stale' },
      { id: 'agent-2', status: 'idle', taskId: null },
      { id: 'agent-3', status: 'handoff', taskId: 'task-handoff' },
    ],
    tasks: [
      { id: 'task-stale', status: 'active', ownerId: 'agent-1', title: 'Stale task', claimedPaths: ['src/stale'], dependencies: [], verification: [], updatedAt: '2000-01-01T00:00:00.000Z' },
      { id: 'task-handoff', status: 'handoff', ownerId: 'agent-3', title: 'Handoff task', claimedPaths: ['src/handoff'], dependencies: [], verification: [], updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'task-blocked', status: 'blocked', ownerId: 'agent-4', title: 'Blocked dependency', claimedPaths: ['src/blocked'], dependencies: ['task-open'], verification: [], updatedAt: '2000-01-01T00:00:00.000Z' },
      { id: 'task-open', status: 'planned', ownerId: null, title: 'Open dependency', claimedPaths: ['src/open'], dependencies: [], verification: [] },
    ],
  });

  const result = runCli(root, ['steal-work', 'agent-2', '--stale-hours', '1', '--json'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.agentId, 'agent-2');
  assert.ok(payload.candidates.some((candidate) => candidate.taskId === 'task-stale' && candidate.reason === 'stale-active'));
  assert.ok(payload.candidates.some((candidate) => candidate.taskId === 'task-handoff' && candidate.reason === 'handoff'));
  assert.equal(payload.candidates.some((candidate) => candidate.taskId === 'task-blocked'), false);
});

test('steal-work applies reassignment with snapshot and audit log', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-work-steal-apply-', packageName: 'work-steal-test' });
  writeBoard(root, {
    projectName: 'Work Steal Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: 'active', taskId: 'task-stale' },
      { id: 'agent-2', status: 'idle', taskId: null },
    ],
    tasks: [
      { id: 'task-stale', status: 'active', ownerId: 'agent-1', title: 'Stale task', claimedPaths: ['src/stale'], dependencies: [], verification: [], updatedAt: '2000-01-01T00:00:00.000Z' },
    ],
  });

  const result = runCli(root, ['steal-work', 'agent-2', '--task', 'task-stale', '--stale-hours', '1', '--apply', '--json'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);
  const board = JSON.parse(fs.readFileSync(path.join(coordinationRoot, 'board.json'), 'utf8'));
  const task = board.tasks.find((entry) => entry.id === 'task-stale');
  const oldAgent = board.agents.find((entry) => entry.id === 'agent-1');
  const newAgent = board.agents.find((entry) => entry.id === 'agent-2');
  const audit = fs.readFileSync(path.join(coordinationRoot, 'runtime', 'audit.ndjson'), 'utf8');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, true);
  assert.equal(fs.existsSync(payload.workspaceSnapshotPath), true);
  assert.equal(task.ownerId, 'agent-2');
  assert.equal(task.lastOwnerId, 'agent-1');
  assert.equal(task.status, 'active');
  assert.equal(oldAgent.status, 'idle');
  assert.equal(oldAgent.taskId, null);
  assert.equal(newAgent.status, 'active');
  assert.equal(newAgent.taskId, 'task-stale');
  assert.match(audit, /steal-work/);
});
