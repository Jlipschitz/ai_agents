import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { cliPath, coordinationRoot, makeWorkspace, writeBoard } from './helpers/workspace.mjs';

function runCliAsync(root, args, options = {}) {
  const rootCoordination = options.coordinationRoot ?? coordinationRoot(root);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: root,
      env: {
        ...process.env,
        AGENT_COORDINATION_ROOT: rootCoordination,
        AGENT_COORDINATION_CONFIG: path.join(root, 'agent-coordination.config.json'),
        AGENT_COORDINATION_LOCK_WAIT_MS: '15000',
        AGENT_COORDINATION_LOCK_STALE_MS: '60000',
        ...(options.env ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({ status: 1, stdout, stderr: `${stderr}${error.stack || error.message}` });
    });
    child.on('close', (status) => {
      resolve({ status: status ?? 1, stdout, stderr });
    });
  });
}

function readBoard(root) {
  return JSON.parse(fs.readFileSync(path.join(coordinationRoot(root), 'board.json'), 'utf8'));
}

function readAudit(root) {
  const auditPath = path.join(coordinationRoot(root), 'runtime', 'audit.ndjson');
  return fs.existsSync(auditPath)
    ? fs.readFileSync(auditPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}

function assertAllSucceeded(results) {
  const failures = results.filter((result) => result.status !== 0);
  assert.deepEqual(failures, [], failures.map((result) => result.stderr || result.stdout).join('\n'));
}

test('parallel progress and verify commands preserve all writes on one task', { timeout: 30000 }, async () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-concurrency-', packageName: 'concurrency-test', runtime: true });
  writeBoard(root, {
    projectName: 'Concurrency Stress',
    updatedAt: '2026-01-01T00:00:00.000Z',
    agents: [{ id: 'agent-1', status: 'active', taskId: 'task-shared' }],
    tasks: [
      {
        id: 'task-shared',
        status: 'active',
        ownerId: 'agent-1',
        summary: 'Shared active task.',
        claimedPaths: ['src/shared'],
        verification: [],
        verificationLog: [],
        notes: [],
      },
    ],
    resources: [],
    incidents: [],
  });

  const commands = [
    ...Array.from({ length: 10 }, (_, index) => ['progress', 'agent-1', 'task-shared', `parallel progress ${index}`]),
    ...Array.from({ length: 10 }, (_, index) => ['verify', 'agent-1', 'task-shared', `check-${index}`, 'pass', '--details', `parallel verify ${index}`]),
  ];
  const results = await Promise.all(commands.map((args) => runCliAsync(root, args)));

  assertAllSucceeded(results);
  const board = readBoard(root);
  const task = board.tasks.find((entry) => entry.id === 'task-shared');
  const progressNotes = task.notes.filter((entry) => entry.kind === 'progress');
  const verifyNotes = task.notes.filter((entry) => entry.kind === 'verify');
  const checks = new Set(task.verificationLog.map((entry) => entry.check));

  assert.equal(progressNotes.length, 10);
  assert.equal(verifyNotes.length, 10);
  assert.equal(task.verificationLog.length, 10);
  for (let index = 0; index < 10; index += 1) {
    assert.equal(checks.has(`check-${index}`), true);
  }
  assert.equal(fs.existsSync(path.join(coordinationRoot(root), 'runtime', 'state.lock.json')), false);
  assert.equal(readAudit(root).length, 20);
});

test('parallel claim verify and done flow leaves board and audit consistent', { timeout: 30000 }, async () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-concurrency-flow-', packageName: 'concurrency-flow-test', runtime: true });
  writeBoard(root, {
    projectName: 'Concurrency Flow Stress',
    updatedAt: '2026-01-01T00:00:00.000Z',
    agents: ['agent-1', 'agent-2', 'agent-3', 'agent-4'].map((id) => ({ id, status: 'idle', taskId: null })),
    tasks: ['task-a', 'task-b', 'task-c', 'task-d'].map((id) => ({
      id,
      status: 'planned',
      ownerId: null,
      summary: `Planned ${id}.`,
      claimedPaths: [],
      dependencies: [],
      verification: [],
      verificationLog: [],
      notes: [],
    })),
    resources: [],
    incidents: [],
  });

  const taskIds = ['task-a', 'task-b', 'task-c', 'task-d'];
  const agentIds = ['agent-1', 'agent-2', 'agent-3', 'agent-4'];
  const claims = await Promise.all(
    taskIds.map((taskId, index) =>
      runCliAsync(root, ['claim', agentIds[index], taskId, '--paths', `src/${taskId}`, '--summary', `Claim ${taskId}`])
    )
  );
  assertAllSucceeded(claims);

  const verifies = await Promise.all(
    taskIds.map((taskId, index) => runCliAsync(root, ['verify', agentIds[index], taskId, 'unit', 'pass', '--details', `verified ${taskId}`]))
  );
  assertAllSucceeded(verifies);

  const done = await Promise.all(
    taskIds.map((taskId, index) => runCliAsync(root, ['done', agentIds[index], taskId, `completed ${taskId}`]))
  );
  assertAllSucceeded(done);

  const board = readBoard(root);
  for (const taskId of taskIds) {
    const task = board.tasks.find((entry) => entry.id === taskId);
    assert.equal(task.status, 'done');
    assert.equal(task.ownerId, null);
    assert.deepEqual(task.claimedPaths, [`src/${taskId}`]);
    assert.equal(task.verificationLog.at(-1).check, 'unit');
    assert.equal(task.verificationLog.at(-1).outcome, 'pass');
  }
  for (const agentId of agentIds) {
    const agent = board.agents.find((entry) => entry.id === agentId);
    assert.equal(agent.status, 'idle');
    assert.equal(agent.taskId, null);
  }
  assert.equal(fs.existsSync(path.join(coordinationRoot(root), 'runtime', 'state.lock.json')), false);
  assert.equal(readAudit(root).length, 12);
});
