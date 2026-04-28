import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeMetadataWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-metadata-', packageName: 'metadata-test', runtime: true });
  writeBoard(workspace.root, {
    projectName: 'Metadata Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: 'idle', taskId: null, updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'agent-2', status: 'idle', taskId: null, updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    tasks: [
      {
        id: 'task-one',
        status: 'planned',
        ownerId: null,
        summary: 'Metadata target.',
        claimedPaths: ['src/one'],
        dependencies: [],
        verification: [],
        verificationLog: [],
        notes: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'task-urgent',
        status: 'planned',
        ownerId: null,
        summary: 'Urgent task.',
        claimedPaths: ['src/urgent'],
        dependencies: [],
        priority: 'urgent',
        severity: 'critical',
        dueAt: '2026-05-01T00:00:00.000Z',
        suggestedOwnerId: 'agent-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'task-normal',
        status: 'planned',
        ownerId: null,
        summary: 'Normal task.',
        claimedPaths: ['src/normal'],
        dependencies: [],
        priority: 'normal',
        severity: 'none',
        dueAt: null,
        suggestedOwnerId: 'agent-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    resources: [],
    incidents: [],
  });
  return workspace;
}

function readBoard(coordinationRoot) {
  return JSON.parse(fs.readFileSync(path.join(coordinationRoot, 'board.json'), 'utf8'));
}

test('prioritize dry-runs and applies task metadata updates', () => {
  const { root, coordinationRoot } = makeMetadataWorkspace();
  const boardPath = path.join(coordinationRoot, 'board.json');
  const before = fs.readFileSync(boardPath, 'utf8');

  const dryRun = runCli(root, ['prioritize', 'task-one', '--priority', 'high', '--due-at', '2026-05-01', '--severity', 'medium', '--dry-run']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /Dry run: would update task-one metadata/);
  assert.equal(fs.readFileSync(boardPath, 'utf8'), before);

  const applied = runCli(root, ['prioritize', 'task-one', '--priority', 'high', '--due-at', '2026-05-01', '--severity', 'medium', '--by', 'agent-1']);
  assert.equal(applied.status, 0, applied.stderr);
  const board = readBoard(coordinationRoot);
  const task = board.tasks.find((entry) => entry.id === 'task-one');
  assert.equal(task.priority, 'high');
  assert.equal(task.dueAt, '2026-05-01T00:00:00.000Z');
  assert.equal(task.severity, 'medium');
  assert.equal(task.notes.at(-1).kind, 'metadata');
  assert.match(fs.readFileSync(path.join(coordinationRoot, 'journal.md'), 'utf8'), /agent-1 updated metadata/);
  assert.match(fs.readFileSync(path.join(coordinationRoot, 'tasks', 'task-one.md'), 'utf8'), /- Priority: high/);
  assert.match(fs.readFileSync(path.join(coordinationRoot, 'tasks', 'task-one.md'), 'utf8'), /- Due: 2026-05-01/);
  assert.match(fs.readFileSync(path.join(coordinationRoot, 'runtime', 'audit.ndjson'), 'utf8'), /"command":"prioritize"/);
});

test('claim and template creation can set initial task metadata', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-metadata-create-', packageName: 'metadata-create-test', runtime: true });
  writeBoard(root, {
    projectName: 'Metadata Create Test',
    agents: [{ id: 'agent-1', status: 'idle', taskId: null }],
    tasks: [],
    resources: [],
    incidents: [],
  });

  const claim = runCli(root, ['claim', 'agent-1', 'task-claim', '--paths', 'src/claim', '--summary', 'Claim with metadata', '--priority', 'urgent', '--due-at', '2026-06-15', '--severity', 'critical'], { coordinationRoot });
  assert.equal(claim.status, 0, claim.stderr);
  let board = readBoard(coordinationRoot);
  let task = board.tasks.find((entry) => entry.id === 'task-claim');
  assert.equal(task.priority, 'urgent');
  assert.equal(task.dueAt, '2026-06-15T00:00:00.000Z');
  assert.equal(task.severity, 'critical');

  const template = runCli(root, ['templates', 'create-task', 'docs-only', '--id', 'task-template', '--priority', 'high', '--severity', 'low', '--apply', '--json'], { coordinationRoot });
  assert.equal(template.status, 0, template.stderr);
  board = readBoard(coordinationRoot);
  task = board.tasks.find((entry) => entry.id === 'task-template');
  assert.equal(task.priority, 'high');
  assert.equal(task.dueAt, null);
  assert.equal(task.severity, 'low');
});

test('metadata is surfaced in status, prompt, ask, and pick output', () => {
  const { root } = makeMetadataWorkspace();

  const status = runCli(root, ['status']);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /task-urgent: suggested agent-1 -> src\/urgent .*priority urgent.*due 2026-05-01.*severity critical/);

  const prompt = runCli(root, ['prompt', 'agent-1', 'task-urgent']);
  assert.equal(prompt.status, 0, prompt.stderr);
  assert.match(prompt.stdout, /Priority: urgent/);
  assert.match(prompt.stdout, /Due: 2026-05-01/);
  assert.match(prompt.stdout, /Severity: critical/);

  const ask = runCli(root, ['ask', 'what can agent-1 do next?', '--json']);
  assert.equal(ask.status, 0, ask.stderr);
  const payload = JSON.parse(ask.stdout);
  assert.equal(payload.items[0].id, 'task-urgent');
  assert.equal(payload.items[0].priority, 'urgent');

  const pick = runCli(root, ['pick', 'agent-1']);
  assert.equal(pick.status, 0, pick.stderr);
  assert.match(pick.stdout, /Recommended for agent-1: task-urgent/);
  assert.match(pick.stdout, /Priority: urgent/);
});
