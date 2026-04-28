import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeAgentHistoryWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-history-', packageName: 'agent-history-test', runtime: true });
  const { root, coordinationRoot } = workspace;
  writeBoard(root, {
    projectName: 'Agent History Test',
    updatedAt: '2026-01-07T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: 'idle', taskId: null },
      { id: 'agent-2', status: 'active', taskId: 'task-stale' },
    ],
    tasks: [
      {
        id: 'task-done',
        status: 'done',
        ownerId: null,
        lastOwnerId: 'agent-1',
        title: 'Completed task',
        claimedPaths: ['src/a'],
        updatedAt: '2026-01-05T00:00:00.000Z',
        docsReviewedAt: '2026-01-04T00:00:00.000Z',
        docsReviewedBy: 'agent-1',
        verificationLog: [
          { at: '2026-01-05T01:00:00.000Z', agent: 'agent-1', check: 'unit', outcome: 'pass', details: 'node --test' },
          { at: '2026-01-05T02:00:00.000Z', agent: 'agent-2', check: 'smoke', outcome: 'fail', details: 'flaky' },
        ],
        notes: [
          { at: '2026-01-03T00:00:00.000Z', agent: 'agent-1', kind: 'progress', body: 'Implemented core path.' },
          { at: '2026-01-05T00:00:00.000Z', agent: 'agent-1', kind: 'done', body: 'Finished.' },
        ],
      },
      {
        id: 'task-released',
        status: 'released',
        ownerId: null,
        lastOwnerId: 'agent-1',
        title: 'Released task',
        claimedPaths: ['docs'],
        updatedAt: '2026-01-06T00:00:00.000Z',
        verificationLog: [],
        notes: [{ at: '2026-01-06T00:00:00.000Z', agent: 'agent-1', kind: 'release', body: 'Released.' }],
      },
      {
        id: 'task-stale',
        status: 'active',
        ownerId: 'agent-2',
        title: 'Stale task',
        claimedPaths: ['api'],
        updatedAt: '2026-01-01T00:00:00.000Z',
        verificationLog: [],
        notes: [],
      },
      {
        id: 'task-handoff',
        status: 'handoff',
        ownerId: null,
        lastOwnerId: 'agent-2',
        title: 'Handoff task',
        claimedPaths: ['app'],
        updatedAt: '2026-01-06T12:00:00.000Z',
        lastHandoff: { at: '2026-01-06T12:00:00.000Z', from: 'agent-2', to: 'agent-1', body: 'Ready for UI follow-up.' },
        verificationLog: [],
        notes: [],
      },
    ],
  });
  fs.mkdirSync(path.join(coordinationRoot, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(coordinationRoot, 'runtime', 'audit.ndjson'), `${JSON.stringify({
    at: '2026-01-07T00:00:00.000Z',
    command: 'steal-work',
    applied: true,
    summary: 'agent-1 stole task-handoff',
    details: { agentId: 'agent-1', previousOwnerId: 'agent-2', taskId: 'task-handoff' },
  })}\n`);
  return workspace;
}

test('agent-history summarizes reputation, task history, and audit signals', () => {
  const { root, coordinationRoot } = makeAgentHistoryWorkspace();
  const result = runCli(root, ['agent-history', 'agent-1', 'agent-2', '--json'], { coordinationRoot });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  const agentOne = payload.agents.find((agent) => agent.agentId === 'agent-1');
  const agentTwo = payload.agents.find((agent) => agent.agentId === 'agent-2');

  assert.equal(payload.summary.agents, 2);
  assert.equal(agentOne.metrics.tasks.completed, 2);
  assert.equal(agentOne.metrics.verification.pass, 1);
  assert.equal(agentOne.metrics.docsReviews, 1);
  assert.equal(agentOne.metrics.handoffs.received, 1);
  assert.equal(agentOne.metrics.auditEntries, 1);
  assert.equal(agentTwo.metrics.verification.fail, 1);
  assert.equal(agentTwo.metrics.tasks.stale, 1);
  assert.equal(agentTwo.metrics.handoffs.given, 1);
  assert.ok(agentOne.score > agentTwo.score);
  assert.ok(agentOne.recentEvents.some((event) => event.type === 'audit:steal-work'));
});

test('agent-history text mode supports filtering and event limits', () => {
  const { root, coordinationRoot } = makeAgentHistoryWorkspace();
  const result = runCli(root, ['agent-history', 'agent-1', '--limit', '2'], { coordinationRoot });
  const jsonResult = runCli(root, ['agent-history', 'agent-1', '--limit', '2', '--json'], { coordinationRoot });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /agent-1:/);
  assert.doesNotMatch(result.stdout, /agent-2:/);
  assert.equal(jsonResult.status, 0, jsonResult.stderr);
  assert.equal(JSON.parse(jsonResult.stdout).agents[0].recentEvents.length, 2);
});
