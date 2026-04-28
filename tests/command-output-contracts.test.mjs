import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, snapshotFiles, writeBoard } from './helpers/workspace.mjs';

function makeContractWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-output-contract-', packageName: 'output-contract-test', runtime: true });
  const { root, coordinationRoot } = workspace;

  writeBoard(root, {
    projectName: 'Output Contract Test',
    updatedAt: '2026-04-28T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: 'active', taskId: 'task-active' },
      { id: 'agent-2', status: 'idle', taskId: null },
    ],
    tasks: [
      {
        id: 'task-active',
        title: 'Active work',
        status: 'active',
        ownerId: 'agent-1',
        summary: 'Build the active feature.',
        claimedPaths: ['src/feature'],
        dependencies: [],
        waitingOn: [],
        verification: ['unit'],
        verificationLog: [{ at: '2026-04-28T01:00:00.000Z', agent: 'agent-1', check: 'unit', outcome: 'pass' }],
        relevantDocs: [],
        notes: [{ at: '2026-04-28T01:30:00.000Z', agent: 'agent-1', kind: 'progress', body: 'Feature is underway.' }],
        updatedAt: '2026-04-28T01:30:00.000Z',
      },
      {
        id: 'task-planned',
        title: 'Planned work',
        status: 'planned',
        ownerId: null,
        summary: 'Ready to claim.',
        claimedPaths: ['docs'],
        dependencies: [],
        waitingOn: [],
        verification: [],
        verificationLog: [],
        relevantDocs: [],
        notes: [],
        updatedAt: '2026-04-28T00:30:00.000Z',
      },
    ],
    resources: [],
    accessRequests: [],
    approvals: [],
    incidents: [],
  });

  fs.appendFileSync(path.join(coordinationRoot, 'journal.md'), '- 2026-04-28T01:30:00.000Z | progress agent-1 on `task-active`: Feature is underway.\n');
  fs.appendFileSync(path.join(coordinationRoot, 'messages.ndjson'), `${JSON.stringify({ at: '2026-04-28T01:45:00.000Z', from: 'agent-1', to: 'agent-2', body: 'Please review docs.' })}\n`);
  fs.writeFileSync(
    path.join(coordinationRoot, 'runtime', 'watcher.status.json'),
    `${JSON.stringify({ pid: 99999999, updatedAt: '2026-04-28T00:00:00.000Z' }, null, 2)}\n`
  );

  return workspace;
}

function coordinationStateFiles(coordinationRoot) {
  return [
    path.join(coordinationRoot, 'board.json'),
    path.join(coordinationRoot, 'journal.md'),
    path.join(coordinationRoot, 'messages.ndjson'),
    path.join(coordinationRoot, 'runtime', 'watcher.status.json'),
  ];
}

function parseJsonStdout(result, commandLabel) {
  assert.equal(result.stderr, '', `${commandLabel} should not write human diagnostics to stderr in JSON mode`);
  const stdout = String(result.stdout ?? '').trim();
  assert.notEqual(stdout, '', `${commandLabel} should write JSON to stdout`);
  try {
    return JSON.parse(stdout);
  } catch (error) {
    assert.fail(`${commandLabel} stdout must be parseable JSON: ${error.message}\nstdout:\n${stdout}`);
  }
}

function runContract(args) {
  const { root, coordinationRoot } = makeContractWorkspace();
  const files = coordinationStateFiles(coordinationRoot);
  const before = snapshotFiles(files);
  const result = runCli(root, args, { coordinationRoot });
  const after = snapshotFiles(files);
  assert.deepEqual(after, before, `${args.join(' ')} should not mutate coordination state`);
  return result;
}

const successContracts = [
  {
    args: ['status', '--json'],
    assertPayload(payload) {
      assert.equal(payload.ok, true);
      assert.equal(typeof payload.workspace, 'string');
      assert.equal(typeof payload.updatedAt, 'string');
      assert.equal(Array.isArray(payload.agents), true);
      assert.equal(typeof payload.tasks, 'object');
    },
  },
  {
    args: ['summarize', '--json'],
    assertPayload(payload) {
      assert.equal(typeof payload.summary, 'string');
      assert.equal(payload.board.projectName, 'Output Contract Test');
      assert.equal(payload.counts.active, 1);
      assert.equal(payload.counts.planned, 1);
      assert.equal(Array.isArray(payload.nextActions), true);
      assert.equal(Array.isArray(payload.recentJournal), true);
      assert.equal(Array.isArray(payload.recentMessages), true);
    },
  },
  {
    args: ['health-score', '--json'],
    assertPayload(payload) {
      assert.equal(typeof payload.ok, 'boolean');
      assert.equal(typeof payload.score, 'number');
      assert.equal(payload.maxScore, 100);
      assert.equal(typeof payload.level, 'string');
      assert.equal(typeof payload.summary, 'object');
      assert.equal(typeof payload.sections, 'object');
      assert.equal(Array.isArray(payload.issues), true);
      assert.equal(payload.failUnder, null);
      assert.equal(payload.passedThreshold, true);
    },
  },
  {
    args: ['risk-score', '--json'],
    assertPayload(payload) {
      assert.equal(payload.ok, true);
      assert.equal(Array.isArray(payload.tasks), true);
      assert.equal(payload.summary.total, 2);
      assert.equal(payload.tasks.some((entry) => entry.taskId === 'task-active'), true);
    },
  },
  {
    args: ['prompt', 'agent-1', '--json'],
    assertPayload(payload) {
      assert.equal(payload.ok, true);
      assert.equal(payload.agentId, 'agent-1');
      assert.equal(payload.taskId, 'task-active');
      assert.equal(payload.task.id, 'task-active');
      assert.equal(Array.isArray(payload.verification), true);
      assert.equal(typeof payload.prompt, 'string');
    },
  },
  {
    args: ['ask', 'who owns src/feature', '--json'],
    assertPayload(payload) {
      assert.equal(payload.ok, true);
      assert.equal(payload.question, 'who owns src/feature');
      assert.equal(payload.intent, 'ownership');
      assert.equal(payload.items[0].id, 'task-active');
      assert.match(payload.answer, /agent-1/);
    },
  },
];

for (const contract of successContracts) {
  const commandLabel = contract.args.join(' ');
  test(`${commandLabel} emits successful JSON without mutating coordination state`, () => {
    const result = runContract(contract.args);
    assert.equal(result.status, 0, result.stderr);
    const payload = parseJsonStdout(result, commandLabel);
    contract.assertPayload(payload);
  });
}

const failureContracts = [
  {
    args: ['prompt', '--json'],
    expectedStatus: 1,
    assertPayload(payload) {
      assert.equal(payload.ok, false);
      assert.equal(payload.code, 'usage_error');
      assert.match(payload.error, /^Usage: prompt/);
    },
  },
  {
    args: ['prompt', 'agent-missing', '--json'],
    expectedStatus: 1,
    assertPayload(payload) {
      assert.equal(payload.ok, false);
      assert.equal(payload.agentId, 'agent-missing');
      assert.equal(typeof payload.reason, 'string');
      assert.match(payload.error, /No active or assigned task/);
    },
  },
  {
    args: ['ask', '--json'],
    expectedStatus: 1,
    assertPayload(payload) {
      assert.equal(payload.ok, false);
      assert.equal(payload.code, 'usage_error');
      assert.match(payload.error, /^Usage: ask/);
    },
  },
  {
    args: ['health-score', '--json', '--fail-under', '101'],
    expectedStatus: 1,
    assertPayload(payload) {
      assert.equal(payload.failUnder, 101);
      assert.equal(payload.passedThreshold, false);
      assert.equal(typeof payload.score, 'number');
      assert.equal(typeof payload.ok, 'boolean');
    },
  },
];

for (const contract of failureContracts) {
  const commandLabel = contract.args.join(' ');
  test(`${commandLabel} emits stable JSON failure output without mutating coordination state`, () => {
    const result = runContract(contract.args);
    assert.equal(result.status, contract.expectedStatus, result.stderr);
    const payload = parseJsonStdout(result, commandLabel);
    contract.assertPayload(payload);
  });
}
