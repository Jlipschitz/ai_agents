import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

test('runbooks list includes built-in playbooks', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-runbooks-', packageName: 'runbooks-test' });
  writeBoard(root, { projectName: 'Runbooks Test', tasks: [] });

  const result = runCli(root, ['runbooks', 'list', '--json'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(payload.runbooks.some((runbook) => runbook.id === 'migration' && runbook.source === 'built-in'));
  assert.ok(payload.runbooks.some((runbook) => runbook.id === 'visual-update'));
});

test('runbooks suggest matches task paths and summary', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-runbooks-suggest-', packageName: 'runbooks-test' });
  writeBoard(root, {
    projectName: 'Runbooks Test',
    tasks: [
      {
        id: 'task-migration',
        status: 'planned',
        title: 'Auth schema migration',
        summary: 'Add session migration for auth rollout',
        claimedPaths: ['migrations/001_sessions.sql', 'api/auth/session.ts'],
      },
    ],
  });

  const result = runCli(root, ['runbooks', 'suggest', '--task', 'task-migration', '--json'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.input.taskId, 'task-migration');
  assert.ok(payload.suggestions.some((entry) => entry.runbook.id === 'migration'));
  assert.ok(payload.suggestions.some((entry) => entry.runbook.id === 'auth'));
});

test('runbooks create is dry-run by default and writes with apply', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-runbooks-create-', packageName: 'runbooks-test' });
  writeBoard(root, { projectName: 'Runbooks Test', tasks: [] });

  const dryRun = runCli(root, [
    'runbooks',
    'create',
    'custom-release',
    '--title',
    'Custom release',
    '--keywords',
    'release,deploy',
    '--paths',
    'deploy',
    '--steps',
    'Check status|Deploy|Verify',
    '--checks',
    'npm test',
    '--docs',
    'docs/releases.md',
    '--json',
  ], { coordinationRoot });
  const dryRunPayload = JSON.parse(dryRun.stdout);
  const filePath = path.join(coordinationRoot, 'runbooks', 'custom-release.json');

  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(dryRunPayload.applied, false);
  assert.equal(fs.existsSync(filePath), false);

  const applied = runCli(root, [
    'runbooks',
    'create',
    'custom-release',
    '--title',
    'Custom release',
    '--keywords',
    'release,deploy',
    '--paths',
    'deploy',
    '--steps',
    'Check status|Deploy|Verify',
    '--checks',
    'npm test',
    '--docs',
    'docs/releases.md',
    '--apply',
    '--json',
  ], { coordinationRoot });
  const appliedPayload = JSON.parse(applied.stdout);

  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(appliedPayload.applied, true);
  assert.equal(fs.existsSync(filePath), true);

  const show = runCli(root, ['runbooks', 'show', 'custom-release', '--json'], { coordinationRoot });
  const showPayload = JSON.parse(show.stdout);

  assert.equal(show.status, 0, show.stderr);
  assert.equal(showPayload.runbook.title, 'Custom release');
  assert.deepEqual(showPayload.runbook.steps, ['Check status', 'Deploy', 'Verify']);
});
