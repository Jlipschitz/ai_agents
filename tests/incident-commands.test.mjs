import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace as makeTestWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeWorkspace() {
  const workspace = makeTestWorkspace({ prefix: 'ai-agents-incidents-', packageName: 'incident-test', heartbeatRuntime: true });
  writeBoard(workspace.root, {
    projectName: 'Incident Test',
    agents: [
      { id: 'agent-1', status: 'idle', taskId: null },
      { id: 'agent-2', status: 'idle', taskId: null },
    ],
    tasks: [
      { id: 'task-one', status: 'active', ownerId: 'agent-1', claimedPaths: ['server'] },
    ],
    resources: [],
    incidents: [],
    accessRequests: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  return workspace;
}

function readBoard(coordinationRoot) {
  return JSON.parse(fs.readFileSync(path.join(coordinationRoot, 'board.json'), 'utf8'));
}

test('incident lifecycle opens, joins, closes, and releases incident resources', () => {
  const { root, coordinationRoot } = makeWorkspace();

  const started = runCli(root, ['start-incident', 'agent-1', 'server-down', 'Investigating server outage', '--resource', 'dev-server', '--task', 'task-one', '--ttl-minutes', '30'], { coordinationRoot });
  assert.equal(started.status, 0, started.stderr);

  let board = readBoard(coordinationRoot);
  assert.equal(board.incidents.length, 1);
  assert.equal(board.incidents[0].key, 'server-down');
  assert.equal(board.incidents[0].ownerId, 'agent-1');
  assert.deepEqual(board.incidents[0].participants, ['agent-1']);
  assert.equal(board.resources[0].name, 'dev-server');
  assert.equal(board.resources[0].reason, 'Incident server-down: Investigating server outage');

  const joined = runCli(root, ['join-incident', 'agent-2', 'server-down'], { coordinationRoot });
  assert.equal(joined.status, 0, joined.stderr);
  board = readBoard(coordinationRoot);
  assert.deepEqual(board.incidents[0].participants.sort(), ['agent-1', 'agent-2']);

  const blockedClose = runCli(root, ['close-incident', 'agent-2', 'server-down', 'Resolved by agent-2'], { coordinationRoot });
  assert.equal(blockedClose.status, 1);
  assert.match(blockedClose.stderr, /owned by agent-1/);

  const closed = runCli(root, ['close-incident', 'agent-1', 'server-down', 'Recovered after config fix'], { coordinationRoot });
  assert.equal(closed.status, 0, closed.stderr);
  board = readBoard(coordinationRoot);
  assert.equal(board.incidents[0].status, 'closed');
  assert.equal(board.incidents[0].resolution, 'Recovered after config fix');
  assert.equal(board.resources.length, 0);
});

test('start-incident --dry-run leaves board unchanged', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const boardPath = path.join(coordinationRoot, 'board.json');
  const before = fs.readFileSync(boardPath, 'utf8');

  const dryRun = runCli(root, ['start-incident', 'agent-1', 'server-down', 'Investigating server outage', '--resource', 'dev-server', '--dry-run'], { coordinationRoot });

  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(fs.readFileSync(boardPath, 'utf8'), before);
});
