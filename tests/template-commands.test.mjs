import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { coordinationRoot, makeWorkspace as makeTestWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeWorkspace() {
  const workspace = makeTestWorkspace({ prefix: 'ai-agents-templates-', packageName: 'templates-test', runtime: true });
  writeBoard(workspace.root, {
    projectName: 'Templates Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [],
  });
  return workspace;
}

function run(root, args) {
  return runCli(root, args);
}

test('templates list and show expose config and task templates', () => {
  const { root } = makeWorkspace();
  const list = run(root, ['templates', 'list', '--json']);
  const show = run(root, ['templates', 'show', 'ui-change', '--json']);

  assert.equal(list.status, 0, list.stderr);
  assert.ok(JSON.parse(list.stdout).configTemplates.react);
  assert.ok(JSON.parse(list.stdout).taskTemplates['ui-change']);
  assert.equal(show.status, 0, show.stderr);
  assert.equal(JSON.parse(show.stdout).kind, 'task');
});

test('templates apply is dry-run by default and snapshots before applying', () => {
  const { root } = makeWorkspace();
  const configPath = path.join(root, 'agent-coordination.config.json');
  const before = fs.readFileSync(configPath, 'utf8');

  const dryRun = run(root, ['templates', 'apply', 'react', '--json']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).applied, false);
  assert.equal(fs.readFileSync(configPath, 'utf8'), before);

  const applied = run(root, ['templates', 'apply', 'react', '--apply', '--json']);
  const payload = JSON.parse(applied.stdout);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(payload.applied, true);
  assert.equal(typeof payload.snapshotPath, 'string');
  assert.equal(fs.existsSync(payload.workspaceSnapshotPath), true);
  assert.ok(config.verification.visualRequiredChecks.includes('visual:test'));
  assert.equal(fs.existsSync(payload.snapshotPath), true);
});

test('templates create-task writes planned task only with --apply', () => {
  const { root } = makeWorkspace();
  const boardPath = path.join(coordinationRoot(root), 'board.json');
  const before = fs.readFileSync(boardPath, 'utf8');

  const dryRun = run(root, ['templates', 'create-task', 'docs-only', '--id', 'task-docs', '--json']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).applied, false);
  assert.equal(fs.readFileSync(boardPath, 'utf8'), before);

  const applied = run(root, ['templates', 'create-task', 'docs-only', '--id', 'task-docs', '--summary', 'Update docs', '--apply', '--json']);
  const payload = JSON.parse(applied.stdout);
  const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
  const task = board.tasks.find((entry) => entry.id === 'task-docs');

  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(payload.applied, true);
  assert.equal(task.status, 'planned');
  assert.equal(task.summary, 'Update docs');
  assert.equal(task.priority, 'normal');
  assert.equal(task.dueAt, null);
  assert.equal(task.severity, 'none');
  assert.deepEqual(task.claimedPaths, ['README.md', 'docs']);
  assert.equal(fs.existsSync(payload.snapshotPath), true);
  assert.equal(fs.existsSync(payload.workspaceSnapshotPath), true);
});
