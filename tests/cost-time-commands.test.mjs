import test from 'node:test';
import assert from 'node:assert/strict';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeCostTimeWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-cost-time-', packageName: 'cost-time-test' });
  writeBoard(workspace.root, {
    projectName: 'Cost Time Test',
    updatedAt: '2026-01-03T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: 'active', taskId: 'task-active' },
      { id: 'agent-2', status: 'idle', taskId: null },
    ],
    tasks: [
      {
        id: 'task-done',
        status: 'done',
        ownerId: null,
        lastOwnerId: 'agent-1',
        title: 'Done task',
        effort: 'medium',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T06:00:00.000Z',
        verificationLog: [{ at: '2026-01-01T05:00:00.000Z', agent: 'agent-1', check: 'unit', outcome: 'pass' }],
        notes: [
          { at: '2026-01-01T00:00:00.000Z', agent: 'agent-1', kind: 'claim', body: 'Started.' },
          { at: '2026-01-01T06:00:00.000Z', agent: 'agent-1', kind: 'done', body: 'Finished.' },
        ],
      },
      {
        id: 'task-release',
        status: 'released',
        ownerId: null,
        lastOwnerId: 'agent-2',
        title: 'Release task',
        estimatedHours: 10,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T04:00:00.000Z',
        verificationLog: [],
        notes: [
          { at: '2026-01-02T00:00:00.000Z', agent: 'agent-2', kind: 'claim', body: 'Started.' },
          { at: '2026-01-02T04:00:00.000Z', agent: 'agent-2', kind: 'release', body: 'Released.' },
        ],
      },
      {
        id: 'task-active',
        status: 'active',
        ownerId: 'agent-1',
        title: 'Active task',
        effort: 'small',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        verificationLog: [],
        notes: [{ at: '2026-01-03T00:00:00.000Z', agent: 'agent-1', kind: 'claim', body: 'Started.' }],
      },
    ],
  });
  return workspace;
}

test('cost-time reports task and per-agent accounting with costs', () => {
  const { root, coordinationRoot } = makeCostTimeWorkspace();
  const result = runCli(root, ['cost-time', '--rate', '100', '--json'], { coordinationRoot });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  const agentOne = payload.agents.find((agent) => agent.agentId === 'agent-1');
  const agentTwo = payload.agents.find((agent) => agent.agentId === 'agent-2');
  const doneTask = payload.tasks.find((task) => task.taskId === 'task-done');

  assert.equal(payload.totals.tasks, 3);
  assert.equal(payload.totals.estimatedHours, 18);
  assert.equal(payload.totals.observedHours, 10);
  assert.equal(payload.totals.estimatedCost, 1800);
  assert.equal(doneTask.estimatedHours, 6);
  assert.equal(doneTask.observedHours, 6);
  assert.equal(doneTask.estimatedCost, 600);
  assert.equal(agentOne.estimatedHours, 8);
  assert.equal(agentOne.observedHours, 6);
  assert.equal(agentTwo.estimatedHours, 10);
  assert.equal(agentTwo.observedHours, 4);
});

test('cost-time text mode filters by agent and task ids', () => {
  const { root, coordinationRoot } = makeCostTimeWorkspace();
  const result = runCli(root, ['cost-time', 'task-release', '--agent', 'agent-2', '--rate', '50'], { coordinationRoot });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /task-release/);
  assert.match(result.stdout, /agent-2/);
  assert.match(result.stdout, /USD 500\.00/);
  assert.doesNotMatch(result.stdout, /task-done/);
});
