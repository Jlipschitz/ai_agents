import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_LARGE_FIXTURE_TASK_COUNT,
  FIXTURE_BOARD_KINDS,
  generateFixtureBoard,
  generateFixtureBoards,
  normalizeFixtureBoardKind,
} from '../scripts/lib/fixture-board-generator.mjs';
import { makeWorkspace, runCli } from './helpers/workspace.mjs';

const EXPECTED_KINDS = [
  'empty',
  'healthy',
  'blocked',
  'stale',
  'large',
  'malformed',
  'multi-agent-conflict',
  'release-ready',
  'approval-required',
  'contract-sensitive',
];

function taskById(board, taskId) {
  return board.tasks.find((task) => task.id === taskId);
}

function assertStandardBoardShape(board, kind) {
  assert.equal(board.fixture, kind);
  assert.equal(board.version, 2);
  if (kind === 'malformed') assert.equal(board.projectName, '');
  else assert.equal(board.projectName, 'Fixture Board');
  assert.equal(Array.isArray(board.agents), true);
  assert.equal(Array.isArray(board.tasks), true);
  assert.equal(Array.isArray(board.resources), true);
  assert.equal(Array.isArray(board.incidents), true);
  assert.equal(Array.isArray(board.accessRequests), true);
  assert.equal(Array.isArray(board.approvals), true);
  assert.equal(Array.isArray(board.plans), true);
}

function assertTaskDefaults(task) {
  assert.equal(Array.isArray(task.claimedPaths), true);
  assert.equal(Array.isArray(task.dependencies), true);
  assert.equal(Array.isArray(task.waitingOn), true);
  assert.equal(Array.isArray(task.verification), true);
  assert.equal(Array.isArray(task.verificationLog), true);
  assert.equal(Array.isArray(task.notes), true);
  assert.equal(Array.isArray(task.relevantDocs), true);
  assert.equal(task.priority, 'normal');
  assert.equal(task.severity, 'none');
  assert.equal(task.dueAt, null);
}

test('fixture board generator exposes the supported fixture kinds', () => {
  assert.deepEqual(FIXTURE_BOARD_KINDS, EXPECTED_KINDS);
  assert.equal(normalizeFixtureBoardKind('multiAgentConflict'), 'multi-agent-conflict');
  assert.equal(normalizeFixtureBoardKind('release_ready'), 'release-ready');

  const boards = generateFixtureBoards();
  assert.deepEqual(Object.keys(boards), EXPECTED_KINDS);
  for (const kind of EXPECTED_KINDS) assertStandardBoardShape(boards[kind], kind);
});

test('empty fixture creates an idle board with no tasks', () => {
  const board = generateFixtureBoard('empty');

  assertStandardBoardShape(board, 'empty');
  assert.equal(board.tasks.length, 0);
  assert.deepEqual(board.agents.map((agent) => [agent.id, agent.status, agent.taskId]), [
    ['agent-1', 'idle', null],
    ['agent-2', 'idle', null],
    ['agent-3', 'idle', null],
    ['agent-4', 'idle', null],
  ]);
});

test('healthy fixture includes active, review, planned, and done tasks', () => {
  const board = generateFixtureBoard('healthy');

  assert.deepEqual(board.tasks.map((task) => [task.id, task.status, task.ownerId]), [
    ['task-active', 'active', 'agent-1'],
    ['task-review', 'review', 'agent-2'],
    ['task-planned', 'planned', null],
    ['task-done', 'done', null],
  ]);
  assert.equal(board.agents.find((agent) => agent.id === 'agent-1').taskId, 'task-active');
  assert.equal(board.agents.find((agent) => agent.id === 'agent-2').taskId, 'task-review');
  assertTaskDefaults(taskById(board, 'task-active'));
  assert.equal(taskById(board, 'task-done').verificationLog[0].outcome, 'pass');
});

test('blocked and stale fixtures set key status fields', () => {
  const blocked = generateFixtureBoard('blocked');
  const blockedTask = taskById(blocked, 'task-blocked');
  assert.equal(blockedTask.status, 'blocked');
  assert.equal(blockedTask.ownerId, 'agent-1');
  assert.deepEqual(blockedTask.waitingOn, ['task-unblocker']);
  assert.equal(blockedTask.priority, 'high');
  assert.equal(blockedTask.severity, 'medium');
  assert.equal(blocked.agents.find((agent) => agent.id === 'agent-1').status, 'blocked');

  const stale = generateFixtureBoard('stale');
  const staleTask = taskById(stale, 'task-stale');
  assert.equal(staleTask.status, 'active');
  assert.equal(staleTask.ownerId, 'agent-1');
  assert.equal(staleTask.updatedAt, '2026-04-25T12:00:00.000Z');
  assert.deepEqual(taskById(stale, 'task-follow-up').dependencies, ['task-stale']);
});

test('large fixture is deterministic and configurable', () => {
  const board = generateFixtureBoard('large');

  assert.equal(board.tasks.length, DEFAULT_LARGE_FIXTURE_TASK_COUNT);
  assert.deepEqual(board.tasks.slice(0, 6).map((task) => [task.id, task.status, task.ownerId]), [
    ['task-large-001', 'active', 'agent-1'],
    ['task-large-002', 'blocked', 'agent-2'],
    ['task-large-003', 'review', 'agent-3'],
    ['task-large-004', 'waiting', 'agent-4'],
    ['task-large-005', 'planned', null],
    ['task-large-006', 'done', null],
  ]);
  assert.equal(taskById(board, 'task-large-006').verificationLog[0].outcome, 'pass');

  const small = generateFixtureBoard('large', { taskCount: 6 });
  assert.equal(small.tasks.length, 6);
  assert.deepEqual(small.tasks.map((task) => task.id), [
    'task-large-001',
    'task-large-002',
    'task-large-003',
    'task-large-004',
    'task-large-005',
    'task-large-006',
  ]);
});

test('malformed and multi-agent conflict fixtures model invalid board cases', () => {
  const malformed = generateFixtureBoard('malformed');
  const duplicateIds = malformed.tasks.filter((task) => task.id === 'task-duplicate');
  assert.equal(duplicateIds.length, 2);
  assert.equal(duplicateIds[1].status, 'mystery');
  assert.equal(duplicateIds[0].priority, 'immediate');
  assert.equal(malformed.agents.filter((agent) => agent.id === 'agent-1').length, 2);

  const conflict = generateFixtureBoard('multi-agent-conflict');
  assert.deepEqual(conflict.tasks.slice(0, 2).map((task) => [task.id, task.status, task.ownerId, task.issueKey]), [
    ['task-conflict-a', 'active', 'agent-1', 'FX-CONFLICT'],
    ['task-conflict-b', 'active', 'agent-2', 'FX-CONFLICT'],
  ]);
  assert.deepEqual(taskById(conflict, 'task-conflict-b').claimedPaths, ['fixtures/conflict/shared/component.mjs']);
});

test('release, approval, and contract-sensitive fixtures expose gate-specific fields', () => {
  const releaseReady = generateFixtureBoard('release-ready');
  const releaseTask = taskById(releaseReady, 'task-release-ready');
  assert.equal(releaseTask.status, 'done');
  assert.deepEqual(releaseTask.verification, ['unit', 'contract']);
  assert.deepEqual(releaseTask.verificationLog.map((entry) => entry.outcome), ['pass', 'pass']);
  assert.equal(releaseTask.docsReviewedBy, 'agent-2');

  const approvalRequired = generateFixtureBoard('approval-required');
  const approvalTask = taskById(approvalRequired, 'task-approval-required');
  assert.equal(approvalTask.status, 'active');
  assert.equal(approvalTask.priority, 'urgent');
  assert.equal(approvalRequired.approvals[0].status, 'pending');
  assert.equal(approvalRequired.approvals[0].scope, 'release');

  const contractSensitive = generateFixtureBoard('contract-sensitive');
  const producer = taskById(contractSensitive, 'task-contract-producer');
  const consumer = taskById(contractSensitive, 'task-contract-consumer');
  assert.equal(producer.status, 'active');
  assert.deepEqual(producer.claimedPaths, ['api/routes/orders.mjs', 'types/orders.d.ts']);
  assert.deepEqual(consumer.dependencies, ['task-contract-producer']);
  assert.equal(consumer.suggestedOwnerId, 'agent-2');
});

test('fixture-board command dry-runs and applies generated boards', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-fixture-board-cli-', packageName: 'fixture-board-cli', runtime: true });
  const boardPath = path.join(coordinationRoot, 'board.json');
  const dryRun = runCli(root, ['fixture-board', 'blocked', '--json'], { coordinationRoot });
  const dryRunPayload = JSON.parse(dryRun.stdout);

  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(dryRunPayload.applied, false);
  assert.equal(dryRunPayload.kind, 'blocked');
  assert.equal(dryRunPayload.board.tasks[0].id, 'task-blocked');
  assert.equal(fs.existsSync(boardPath), false);

  const applied = runCli(root, ['fixture-board', 'large', '--task-count', '6', '--apply', '--json'], { coordinationRoot });
  const appliedPayload = JSON.parse(applied.stdout);
  const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));

  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(appliedPayload.applied, true);
  assert.equal(appliedPayload.kind, 'large');
  assert.equal(board.tasks.length, 6);
  assert.equal(board.fixture, 'large');
  assert.ok(appliedPayload.workspaceSnapshotPath);
  assert.equal(fs.existsSync(appliedPayload.workspaceSnapshotPath), true);
});
