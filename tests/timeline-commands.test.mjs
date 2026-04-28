import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeTimelineWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-timeline-', packageName: 'timeline-test', runtime: true });
  writeBoard(workspace.root, {
    projectName: 'Timeline Test',
    tasks: [
      {
        id: 'task-one',
        status: 'active',
        ownerId: 'agent-1',
        title: 'Timeline task',
        claimedPaths: ['src/timeline'],
        notes: [{ at: '2026-01-01T01:00:00.000Z', agent: 'agent-1', kind: 'progress', body: 'Started timeline work' }],
        verification: ['unit'],
        verificationLog: [{ at: '2026-01-01T02:00:00.000Z', agent: 'agent-1', check: 'unit', outcome: 'pass', details: 'node --test' }],
      },
    ],
    agents: [{ id: 'agent-1', status: 'active', taskId: 'task-one' }],
    resources: [],
    incidents: [],
  });
  fs.appendFileSync(path.join(workspace.coordinationRoot, 'journal.md'), '- 2026-01-01T00:30:00.000Z | claimed `task-one` by `agent-1`\n');
  fs.appendFileSync(path.join(workspace.coordinationRoot, 'messages.ndjson'), `${JSON.stringify({
    at: '2026-01-01T01:30:00.000Z',
    from: 'agent-1',
    to: 'agent-2',
    taskId: 'task-one',
    body: 'Timeline status update',
  })}\n`);
  fs.writeFileSync(path.join(workspace.coordinationRoot, 'runtime', 'audit.ndjson'), `${JSON.stringify({
    at: '2026-01-01T03:00:00.000Z',
    command: 'finish',
    applied: true,
    summary: 'Finished timeline task',
    details: { taskId: 'task-one', agentId: 'agent-1' },
  })}\n`);
  return workspace;
}

test('timeline replays journal messages audit notes and verification events', () => {
  const { root, coordinationRoot } = makeTimelineWorkspace();
  const result = runCli(root, ['timeline', '--task', 'task-one', '--json'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);
  const sources = new Set(payload.events.map((entry) => entry.source));

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual([...sources].sort(), ['audit', 'journal', 'message', 'task-note', 'verification']);
  assert.equal(payload.events.at(-1).source, 'audit');
  assert.equal(payload.counts.message, 1);
});

test('timeline text mode and filters support session replay slices', () => {
  const { root, coordinationRoot } = makeTimelineWorkspace();
  const text = runCli(root, ['timeline', '--agent', 'agent-2'], { coordinationRoot });
  const limited = runCli(root, ['timeline', '--task', 'task-one', '--limit', '2', '--json'], { coordinationRoot });
  const payload = JSON.parse(limited.stdout);

  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /# Coordination Timeline/);
  assert.match(text.stdout, /Timeline status update/);
  assert.equal(limited.status, 0, limited.stderr);
  assert.equal(payload.events.length, 2);
  assert.deepEqual(payload.events.map((entry) => entry.source), ['verification', 'audit']);
});

test('timeline date filters exclude out-of-window events', () => {
  const { root, coordinationRoot } = makeTimelineWorkspace();
  const result = runCli(root, ['timeline', '--from', '2026-01-01T01:20:00.000Z', '--to', '2026-01-01T02:10:00.000Z', '--json'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(payload.events.map((entry) => entry.source), ['message', 'verification']);
});
