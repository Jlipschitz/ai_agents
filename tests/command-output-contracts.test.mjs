import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, snapshotFiles, writeBoard } from './helpers/workspace.mjs';
import { jsonCommandNames } from '../scripts/lib/command-registry.mjs';

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

function runContract(args, options = {}) {
  const { root, coordinationRoot } = makeContractWorkspace();
  const files = coordinationStateFiles(coordinationRoot);
  const before = snapshotFiles(files);
  const result = runCli(root, args, { coordinationRoot, ...options });
  const after = snapshotFiles(files);
  assert.deepEqual(after, before, `${args.join(' ')} should not mutate coordination state`);
  return result;
}

function assertJsonContainer(payload, commandLabel) {
  assert.notEqual(payload, null, `${commandLabel} JSON payload should not be null`);
  assert.equal(['object', 'array'].includes(Array.isArray(payload) ? 'array' : typeof payload), true, `${commandLabel} should emit a JSON object or array`);
}

const successContracts = [
  {
    args: ['doctor', '--json'],
    assertPayload(payload) {
      assert.equal(payload.ok, true);
      assert.equal(payload.configValidation.valid, true);
      assert.equal(payload.commandWiring.ok, true);
      assert.ok(payload.commandWiring.registry.minimalCommandCount > 0);
      assert.equal(Array.isArray(payload.commandWiring.scriptCoverage.minimalCommandsWithoutShortcuts), true);
    },
  },
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
    args: ['next', 'agent-1', '--json'],
    assertPayload(payload) {
      assert.equal(payload.ok, true);
      assert.equal(payload.agentId, 'agent-1');
      assert.equal(payload.taskId, 'task-active');
      assert.equal(typeof payload.command, 'string');
      assert.equal(typeof payload.reason, 'string');
    },
  },
  {
    args: ['handoff-bundle', 'agent-1', 'task-active', '--json'],
    assertPayload(payload) {
      assert.equal(payload.ok, true);
      assert.equal(payload.agentId, 'agent-1');
      assert.equal(payload.taskId, 'task-active');
      assert.equal(typeof payload.bundle, 'string');
      assert.equal(typeof payload.prompt, 'string');
      assert.equal(typeof payload.recommendation, 'object');
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

const registryJsonContracts = [
  { args: ['agent-history', '--json'] },
  { args: ['archive-completed', '--json'] },
  {
    args: ['artifacts', 'rebuild-index', '--json'],
    assertPayload(payload) {
      assert.equal(payload.ok, true);
      assert.equal(payload.applied, false);
      assert.equal(payload.indexPath, 'artifacts/checks/index.ndjson');
      assert.equal(Array.isArray(payload.roots), true);
      assert.equal(Array.isArray(payload.entries), true);
      assert.equal(payload.entryCount, payload.entries.length);
      assert.equal(typeof payload.policy, 'object');
    },
  },
  { args: ['backlog-import', '--json'] },
  { args: ['branches', '--json'], expectedStatus: 1 },
  {
    args: ['branches', 'restore', 'missing-recovery-plan.json', '--json'],
    expectedStatus: 1,
    assertPayload(payload) {
      assert.equal(payload.ok, false);
      assert.equal(Array.isArray(payload.restored), true);
      assert.equal(Array.isArray(payload.skipped), true);
      assert.equal(Array.isArray(payload.errors), true);
      assert.match(payload.errors[0], /Failed to read branch recovery plan/);
    },
  },
  { args: ['calendar', '--json'] },
  { args: ['changelog', '--json'] },
  { args: ['cleanup-runtime', '--json'] },
  { args: ['compact-state', '--json'] },
  { args: ['completions', 'list', '--json'] },
  { args: ['cost-time', '--json'] },
  { args: ['critical-path', '--json'] },
  { args: ['dashboard', '--json'] },
  { args: ['escalation-route', '--json'] },
  { args: ['explain-config', '--json'] },
  { args: ['fixture-board', 'healthy', '--json'] },
  { args: ['format', '--json'] },
  {
    args: ['github-plan', 'pr', '1', '--comment', 'note', '--json'],
    assertPayload(payload) {
      assert.equal(payload.ok, true);
      assert.equal(payload.dryRun, true);
      assert.equal(payload.liveWrites, false);
      assert.equal(payload.target.type, 'pr');
      assert.equal(payload.target.number, 1);
      assert.equal(payload.summary.operationCount, 1);
      assert.equal(payload.operations[0].type, 'comment');
      assert.equal(payload.operations[0].body, 'note');
      assert.equal(payload.applyReadiness.checked, false);
    },
  },
  {
    args: ['github-plan', 'pr', '1', '--comment', 'contains customer-token', '--check-apply-readiness', '--json'],
    expectedStatus: 1,
    env: { GH_TOKEN: '', GITHUB_TOKEN: '', GITHUB_PAT: '', GITHUB_ENTERPRISE_TOKEN: '' },
    assertPayload(payload) {
      assert.equal(payload.ok, false);
      assert.equal(payload.readinessRequested, true);
      assert.equal(payload.applyReadiness.checked, true);
      assert.equal(payload.applyReadiness.ready, false);
      assert.equal(payload.applyReadiness.readOnly, true);
      assert.equal(payload.applyReadiness.liveWrites, false);
      assert.equal(payload.applyReadiness.auth.tokenEnvPresent, false);
      assert.equal(payload.applyReadiness.privacy.outboundRedaction, 'inactive');
      assert.ok(payload.applyReadiness.privacy.sensitivePatternMatches.includes('token'));
      assert.ok(payload.applyReadiness.blockers.some((entry) => entry.code === 'repository-missing'));
      assert.ok(payload.applyReadiness.blockers.some((entry) => entry.code === 'target-missing'));
      assert.ok(payload.applyReadiness.blockers.some((entry) => entry.code === 'auth-token-missing'));
    },
  },
  { args: ['github-status', '--json'] },
  { args: ['graph', '--json'] },
  { args: ['inspect-board', '--json'] },
  { args: ['interactive', '--json'] },
  { args: ['lock-status', '--json'] },
  { args: ['migrate-board', '--json'] },
  { args: ['migrate-config', '--json'] },
  { args: ['ownership-map', '--json'] },
  { args: ['ownership-review', '--json'] },
  { args: ['path-groups', '--json'] },
  { args: ['policy-check', '--json'] },
  { args: ['policy-packs', 'list', '--json'] },
  { args: ['pr-summary', '--json'] },
  { args: ['prioritize', 'task-active', '--priority', 'high', '--dry-run', '--json'] },
  { args: ['publish-check', '--json'] },
  { args: ['redact-check', '--json'] },
  { args: ['repair-board', '--json'] },
  { args: ['review-queue', '--json'] },
  { args: ['rollback-state', '--list', '--json'] },
  { args: ['run-check', 'contract-smoke', '--dry-run', '--json', '--', process.execPath, '-e', 'console.log("ok")'] },
  { args: ['secrets-scan', '--json'] },
  { args: ['snapshot-workspace', '--json'] },
  { args: ['split-validate', '--json'] },
  { args: ['state-size', '--json'] },
  { args: ['status-badge', '--json'] },
  { args: ['steal-work', 'agent-2', '--json'] },
  { args: ['templates', 'list', '--json'] },
  { args: ['test-impact', '--json'] },
  { args: ['timeline', '--json'] },
  { args: ['update-coordinator', '--json'] },
  { args: ['validate', '--json'] },
  { args: ['version', '--json'] },
  { args: ['watch-diagnose', '--json'], expectedStatus: 1 },
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

for (const contract of registryJsonContracts) {
  const commandLabel = contract.args.join(' ');
  test(`${commandLabel} emits parseable JSON without mutating coordination state`, () => {
    const result = runContract(contract.args, { env: contract.env });
    assert.equal(result.status, contract.expectedStatus ?? 0, result.stderr);
    const payload = parseJsonStdout(result, commandLabel);
    assertJsonContainer(payload, commandLabel);
    contract.assertPayload?.(payload);
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
  {
    args: ['release-check', '--json'],
    expectedStatus: 1,
    assertPayload(payload) {
      assert.equal(payload.ok, false);
      assert.equal(Array.isArray(payload.checks), true);
      assert.match(payload.checks[0].findings[0], /No done or released tasks/);
    },
  },
  {
    args: ['release-bundle', '--out-dir', 'bundle', '--json'],
    expectedStatus: 1,
    assertPayload(payload) {
      assert.equal(payload.ok, false);
      assert.equal(payload.applied, false);
      assert.equal(Array.isArray(payload.files), true);
      assert.equal(payload.releaseCheck.ok, false);
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

const jsonContractOmissions = [
  {
    command: 'lock-clear',
    reason: 'Clears runtime lock files by design; focused lock-runtime tests cover JSON behavior.',
  },
  {
    command: 'release-sign',
    reason: 'Requires a prepared release directory and can write checksum/signature files; release-signing tests cover JSON behavior.',
  },
];

test('JSON contract fixtures account for every registered JSON command', () => {
  const covered = new Set([
    ...successContracts.map((contract) => contract.args[0]),
    ...registryJsonContracts.map((contract) => contract.args[0]),
    ...failureContracts.map((contract) => contract.args[0]),
  ]);
  const omissions = new Map(jsonContractOmissions.map((entry) => [entry.command, entry.reason]));
  const missing = jsonCommandNames().filter((name) => !covered.has(name) && !omissions.has(name));

  assert.deepEqual(missing, []);
  for (const [command, reason] of omissions) {
    assert.equal(typeof command, 'string');
    assert.match(reason, /\w/);
  }
});
