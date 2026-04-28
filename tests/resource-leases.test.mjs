import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace as makeTestWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeWorkspace() {
  const workspace = makeTestWorkspace({ prefix: 'ai-agents-resources-', packageName: 'resource-test', heartbeatRuntime: true });
  writeBoard(workspace.root, {
    projectName: 'Resource Test',
    agents: [
      { id: 'agent-1', status: 'idle', taskId: null },
      { id: 'agent-2', status: 'idle', taskId: null },
    ],
    tasks: [
      { id: 'task-one', status: 'active', ownerId: 'agent-1', claimedPaths: ['src/a'] },
    ],
    resources: [],
    incidents: [],
    accessRequests: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  return workspace;
}

function run(root, coordinationRoot, args) {
  return runCli(root, args, { coordinationRoot });
}

function readBoard(coordinationRoot) {
  return JSON.parse(fs.readFileSync(path.join(coordinationRoot, 'board.json'), 'utf8'));
}

test('reserve-resource records TTL lease metadata and renew-resource extends it', () => {
  const { root, coordinationRoot } = makeWorkspace();

  const reserved = run(root, coordinationRoot, ['reserve-resource', 'agent-1', 'dev-server', 'Running local server', '--task', 'task-one', '--ttl-minutes', '30']);
  assert.equal(reserved.status, 0, reserved.stderr);

  let resource = readBoard(coordinationRoot).resources[0];
  assert.equal(resource.name, 'dev-server');
  assert.equal(resource.ownerId, 'agent-1');
  assert.equal(resource.taskId, 'task-one');
  assert.equal(resource.ttlMinutes, 30);
  assert.equal(typeof resource.ownerMachine, 'string');
  assert.equal(typeof resource.ownerPid, 'number');
  assert.equal(typeof resource.expiresAt, 'string');

  const blocked = run(root, coordinationRoot, ['reserve-resource', 'agent-2', 'dev-server', 'Need the same server']);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /already reserved by agent-1/);

  const renewed = run(root, coordinationRoot, ['renew-resource', 'agent-1', 'dev-server', '--ttl-minutes', '45', '--reason', 'Still running local server']);
  assert.equal(renewed.status, 0, renewed.stderr);

  resource = readBoard(coordinationRoot).resources[0];
  assert.equal(resource.ttlMinutes, 45);
  assert.equal(resource.reason, 'Still running local server');
  assert.equal(typeof resource.renewedAt, 'string');
});

test('reserve-resource lets another agent take an expired lease', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const boardPath = path.join(coordinationRoot, 'board.json');
  const board = readBoard(coordinationRoot);
  board.resources.push({
    name: 'dev-server',
    ownerId: 'agent-1',
    reason: 'Expired lease',
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
    expiresAt: '2000-01-01T00:00:00.000Z',
    ttlMinutes: 30,
  });
  fs.writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`);
  fs.writeFileSync(path.join(coordinationRoot, 'runtime', 'agent-heartbeats', 'agent-1.json'), `${JSON.stringify({
    agentId: 'agent-1',
    pid: process.pid,
    intervalMs: 30000,
    lastHeartbeatAt: new Date().toISOString(),
  }, null, 2)}\n`);

  const result = run(root, coordinationRoot, ['reserve-resource', 'agent-2', 'dev-server', 'Taking expired lease', '--ttl-minutes', '15']);
  const resource = readBoard(coordinationRoot).resources[0];

  assert.equal(result.status, 0, result.stderr);
  assert.equal(resource.ownerId, 'agent-2');
  assert.equal(resource.previousOwnerId, 'agent-1');
  assert.equal(resource.ttlMinutes, 15);
  assert.equal(resource.reason, 'Taking expired lease');
});
