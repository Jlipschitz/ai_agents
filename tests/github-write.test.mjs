import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { makeWorkspace, runCli, snapshotFiles, writeBoard } from './helpers/workspace.mjs';

function makeGitHubWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-github-write-', packageName: 'github-write-test' });
  writeBoard(workspace.root, {
    projectName: 'GitHub Write Test',
    tasks: [{ id: 'task-github', status: 'review', ownerId: 'agent-1', title: 'Review GitHub write plan' }],
    agents: [{ id: 'agent-1', status: 'active', taskId: 'task-github' }],
  });
  return workspace;
}

function makeFakeGh() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-fake-gh-'));
  const logPath = path.join(root, 'gh-calls.ndjson');
  const scriptPath = path.join(root, 'fake-gh.mjs');
  fs.writeFileSync(scriptPath, `
import fs from 'node:fs';

const args = process.argv.slice(2);
const input = await new Promise((resolve) => {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => resolve(data));
});

if (args[0] === '--version') {
  console.log('gh version 2.0.0 (fake)');
  process.exit(0);
}

fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, input }) + '\\n');
console.log(JSON.stringify({ ok: true }));
`, 'utf8');

  const commandPath = process.platform === 'win32' ? path.join(root, 'gh.cmd') : path.join(root, 'gh');
  if (process.platform === 'win32') {
    fs.writeFileSync(commandPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8');
  } else {
    fs.writeFileSync(commandPath, `#!/bin/sh\n"${process.execPath}" "${scriptPath}" "$@"\n`, 'utf8');
    fs.chmodSync(commandPath, 0o755);
  }

  return { commandPath, logPath };
}

function readFakeGhCalls(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('github-plan emits dry-run PR comment, label, and checklist operations', () => {
  const { root, coordinationRoot } = makeGitHubWorkspace();
  const result = runCli(root, [
    'github-plan',
    'https://github.com/Jlipschitz/ai_agents/pull/42',
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
  const result = runCli(root, ['github-plan', 'https://github.com/Jlipschitz/ai_agents/issues/7', '--comment', 'Follow-up note.', '--apply', '--json'], { coordinationRoot });
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

test('github-plan requires live-write opt-in before apply can write', () => {
  const { root, coordinationRoot } = makeGitHubWorkspace();
  const fakeGh = makeFakeGh();
  const result = runCli(root, [
    'github-plan',
    'https://github.com/Jlipschitz/ai_agents/issues/7',
    '--comment',
    'Follow-up note.',
    '--apply',
    '--json',
  ], {
    coordinationRoot,
    env: {
      AI_AGENTS_GH_COMMAND: fakeGh.commandPath,
      FAKE_GH_LOG: fakeGh.logPath,
      GH_TOKEN: 'test-token',
    },
  });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.applyRequested, true);
  assert.equal(payload.liveWriteRequested, false);
  assert.equal(payload.blocked, true);
  assert.equal(payload.dryRun, true);
  assert.ok(payload.applyReadiness.blockers.some((entry) => entry.code === 'live-write-missing'));
  assert.deepEqual(readFakeGhCalls(fakeGh.logPath), []);
});

test('github-plan applies live writes through fake gh only with apply and live-write', () => {
  const { root, coordinationRoot } = makeGitHubWorkspace();
  const fakeGh = makeFakeGh();
  const result = runCli(root, [
    'github-plan',
    'https://github.com/Jlipschitz/ai_agents/pull/42',
    '--comment',
    'Ready for review.',
    '--label',
    'needs-review,package-d',
    '--checklist',
    'tests pass|docs updated',
    '--apply',
    '--live-write',
    '--json',
  ], {
    coordinationRoot,
    env: {
      AI_AGENTS_GH_COMMAND: fakeGh.commandPath,
      FAKE_GH_LOG: fakeGh.logPath,
      GH_TOKEN: 'test-token',
    },
  });
  const payload = JSON.parse(result.stdout);
  const calls = readFakeGhCalls(fakeGh.logPath);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.ok, true);
  assert.equal(payload.dryRun, false);
  assert.equal(payload.liveWrites, true);
  assert.equal(payload.blocked, false);
  assert.equal(payload.applyResult.ok, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => call.args[1]), [
    'repos/Jlipschitz/ai_agents/issues/42/comments',
    'repos/Jlipschitz/ai_agents/issues/42/labels',
    'repos/Jlipschitz/ai_agents/issues/42/comments',
  ]);
  assert.deepEqual(JSON.parse(calls[0].input), { body: 'Ready for review.' });
  assert.deepEqual(JSON.parse(calls[1].input), { labels: ['needs-review', 'package-d'] });
  assert.deepEqual(JSON.parse(calls[2].input), { body: '- [ ] tests pass\n- [ ] docs updated' });
});

test('github-plan keeps blocked live-write plans in dry-run mode', () => {
  const { root, coordinationRoot } = makeGitHubWorkspace();
  const fakeGh = makeFakeGh();
  const result = runCli(root, [
    'github-plan',
    'https://github.com/Jlipschitz/ai_agents/pull/42',
    '--comment',
    'Ready for review.',
    '--apply',
    '--live-write',
    '--json',
  ], {
    coordinationRoot,
    env: {
      AI_AGENTS_GH_COMMAND: fakeGh.commandPath,
      FAKE_GH_LOG: fakeGh.logPath,
      AI_AGENTS_OFFLINE: '1',
      GH_TOKEN: 'test-token',
    },
  });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.blocked, true);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.liveWrites, false);
  assert.equal(payload.applyReadiness.liveWrites, false);
  assert.ok(payload.applyReadiness.blockers.some((entry) => entry.code === 'offline-mode'));
  assert.deepEqual(readFakeGhCalls(fakeGh.logPath), []);
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

test('github-plan readiness check blocks unredacted sensitive planned writes', () => {
  const { root, coordinationRoot } = makeGitHubWorkspace();
  const files = [
    path.join(coordinationRoot, 'board.json'),
    path.join(coordinationRoot, 'journal.md'),
    path.join(coordinationRoot, 'messages.ndjson'),
  ];
  const before = snapshotFiles(files);
  const result = runCli(root, [
    'github-plan',
    'https://github.com/Jlipschitz/ai_agents/pull/42',
    '--comment',
    'contains customer-token',
    '--check-apply-readiness',
    '--json',
  ], {
    coordinationRoot,
    env: { GH_TOKEN: '', GITHUB_TOKEN: '', GITHUB_PAT: '', GITHUB_ENTERPRISE_TOKEN: '' },
  });
  const after = snapshotFiles(files);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.applyReadiness.checked, true);
  assert.equal(payload.applyReadiness.readOnly, true);
  assert.equal(payload.applyReadiness.liveWrites, false);
  assert.equal(payload.applyReadiness.privacy.outboundRedaction, 'inactive');
  assert.ok(payload.applyReadiness.privacy.sensitivePatternMatches.includes('token'));
  assert.ok(payload.applyReadiness.blockers.some((entry) => entry.code === 'sensitive-unredacted'));
  assert.ok(payload.applyReadiness.blockers.some((entry) => entry.code === 'auth-token-missing'));
  assert.deepEqual(after, before);
});

test('github-plan readiness check prints text blockers without writing', () => {
  const { root, coordinationRoot } = makeGitHubWorkspace();
  const files = [
    path.join(coordinationRoot, 'board.json'),
    path.join(coordinationRoot, 'journal.md'),
    path.join(coordinationRoot, 'messages.ndjson'),
  ];
  const before = snapshotFiles(files);
  const result = runCli(root, [
    'github-plan',
    'https://github.com/Jlipschitz/ai_agents/issues/7',
    '--label',
    'triage',
    '--check-apply-readiness',
  ], {
    coordinationRoot,
    env: {
      AI_AGENTS_OFFLINE: '1',
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
      GITHUB_PAT: '',
      GITHUB_ENTERPRISE_TOKEN: '',
    },
  });
  const after = snapshotFiles(files);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /# GitHub Write Plan/);
  assert.match(result.stdout, /Apply readiness:/);
  assert.match(result.stdout, /- ready: no/);
  assert.match(result.stdout, /- blocker: offline-mode:/);
  assert.deepEqual(after, before);
});
