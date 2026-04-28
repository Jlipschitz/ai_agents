import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { makeWorkspace, runCli, snapshotFiles, writeBoard } from './helpers/workspace.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeGitHubWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-github-write-', packageName: 'github-write-test' });
  writeBoard(workspace.root, {
    projectName: 'GitHub Write Test',
    tasks: [{ id: 'task-github', status: 'review', ownerId: 'agent-1', title: 'Review GitHub write plan' }],
    agents: [{ id: 'agent-1', status: 'active', taskId: 'task-github' }],
  });
  git(workspace.root, ['init', '-b', 'main']);
  git(workspace.root, ['config', 'user.email', 'test@example.com']);
  git(workspace.root, ['config', 'user.name', 'Test User']);
  git(workspace.root, ['remote', 'add', 'origin', 'git@github.com:Jlipschitz/ai_agents.git']);
  return workspace;
}

test('github-plan emits dry-run PR comment, label, and checklist operations', () => {
  const { root, coordinationRoot } = makeGitHubWorkspace();
  const result = runCli(root, [
    'github-plan',
    'pr',
    '42',
    '--comment',
    'Ready for review.',
    '--label',
    'needs-review,package-d',
    '--checklist',
    'tests pass|docs updated',
    '--json',
  ], { coordinationRoot });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.ok, true);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.liveWrites, false);
  assert.equal(payload.repository.url, 'https://github.com/Jlipschitz/ai_agents');
  assert.equal(payload.target.url, 'https://github.com/Jlipschitz/ai_agents/pull/42');
  assert.deepEqual(payload.operations.map((operation) => operation.type), ['comment', 'label', 'checklist-comment']);
  assert.equal(payload.operations[0].body, 'Ready for review.');
  assert.deepEqual(payload.operations[1].labels, ['needs-review', 'package-d']);
  assert.equal(payload.operations[2].body, '- [ ] tests pass\n- [ ] docs updated');
});

test('github-plan blocks apply and does not mutate coordination files', () => {
  const { root, coordinationRoot } = makeGitHubWorkspace();
  const files = [
    path.join(coordinationRoot, 'board.json'),
    path.join(coordinationRoot, 'journal.md'),
    path.join(coordinationRoot, 'messages.ndjson'),
  ];
  const before = snapshotFiles(files);
  const result = runCli(root, ['github-plan', 'issue', '7', '--comment', 'Follow-up note.', '--apply', '--json'], { coordinationRoot });
  const after = snapshotFiles(files);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.applyRequested, true);
  assert.equal(payload.blocked, true);
  assert.equal(payload.liveWrites, false);
  assert.ok(payload.warnings.some((entry) => entry.includes('Apply is blocked')));
  assert.deepEqual(after, before);
});

test('github-plan redacts planned write text in privacy mode and honors offline env', () => {
  const { root, coordinationRoot } = makeGitHubWorkspace();
  const result = runCli(root, [
    'github-plan',
    'https://github.com/Example/private-repo/issues/9',
    '--comment',
    'contains customer-token',
    '--label',
    'secret-label',
    '--checklist',
    'private task',
    '--json',
  ], {
    coordinationRoot,
    env: { AI_AGENTS_PRIVACY_MODE: 'redacted', AI_AGENTS_OFFLINE: '1' },
  });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.privacy.redacted, true);
  assert.equal(payload.privacy.offline, true);
  assert.equal(payload.target.url, 'https://github.com/Example/private-repo/issues/9');
  assert.equal(payload.operations[0].body, '[redacted]');
  assert.deepEqual(payload.operations[1].labels, ['[redacted]']);
  assert.equal(payload.operations[2].body, '[redacted]');
  assert.ok(payload.warnings.some((entry) => entry.includes('Offline mode')));
});
