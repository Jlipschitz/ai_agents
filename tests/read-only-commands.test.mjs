import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace as makeTestWorkspace, runCli, snapshotFiles } from './helpers/workspace.mjs';

function makeWorkspace() {
  const workspace = makeTestWorkspace({ prefix: 'ai-agents-readonly-', packageName: 'read-only-test', runtime: true });
  const { root, coordinationRoot } = workspace;
  fs.writeFileSync(path.join(coordinationRoot, 'board.json'), JSON.stringify({
    projectName: 'Read Only Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-active', status: 'active', ownerId: 'agent-1', title: 'Active task', claimedPaths: ['src/a'], updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'task-planned', status: 'planned', ownerId: null, title: 'Planned task', claimedPaths: [], updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(coordinationRoot, 'journal.md'), '# Journal\n\n');
  fs.writeFileSync(path.join(coordinationRoot, 'messages.ndjson'), '');
  fs.writeFileSync(path.join(coordinationRoot, 'runtime', 'watcher.status.json'), JSON.stringify({ pid: 99999999, updatedAt: '2000-01-01T00:00:00.000Z' }, null, 2));
  return workspace;
}

function run(root, coordinationRoot, args) {
  return runCli(root, args, { coordinationRoot });
}

const commandsExpectedToSucceed = new Set([
  'summarize',
  'summarize --for-chat',
  'summarize --json',
  'validate --json',
  'doctor --json',
  'status',
  'heartbeat-status',
  'watch-status',
  'lock-status',
  'lock-status --json',
  'cleanup-runtime',
  'cleanup-runtime --json',
  'repair-board',
  'artifacts list',
  'artifacts prune',
  'graph',
  'ownership-map',
  'ownership-review',
  'ownership-review --json',
  'test-impact',
  'test-impact --json',
  'github-status',
  'github-status --json',
  'pr-summary',
  'migrate-config',
  'policy-packs list',
  'policy-packs apply strict-ui',
  'rollback-state --list',
  'rollback-state --list --json',
]);

for (const args of [
  ['summarize'],
  ['summarize', '--for-chat'],
  ['summarize', '--json'],
  ['validate', '--json'],
  ['doctor', '--json'],
  ['status'],
  ['pick'],
  ['inbox'],
  ['heartbeat-status'],
  ['watch-status'],
  ['lock-status'],
  ['lock-status', '--json'],
  ['watch-diagnose'],
  ['watch-diagnose', '--json'],
  ['cleanup-runtime'],
  ['cleanup-runtime', '--json'],
  ['inspect-board'],
  ['inspect-board', '--json'],
  ['repair-board'],
  ['release-check', '--json'],
  ['artifacts', 'list'],
  ['artifacts', 'prune'],
  ['graph'],
  ['ownership-map'],
  ['branches'],
  ['branches', '--json'],
  ['ownership-review'],
  ['ownership-review', '--json'],
  ['test-impact'],
  ['test-impact', '--json'],
  ['github-status'],
  ['github-status', '--json'],
  ['pr-summary'],
  ['release-bundle', '--out-dir', 'bundle'],
  ['migrate-config'],
  ['policy-packs', 'list'],
  ['policy-packs', 'apply', 'strict-ui'],
  ['rollback-state', '--list'],
  ['rollback-state', '--list', '--json'],
]) {
  test(`${args.join(' ')} does not mutate coordination state`, () => {
    const { root, coordinationRoot } = makeWorkspace();
    const files = [
      path.join(coordinationRoot, 'board.json'),
      path.join(coordinationRoot, 'journal.md'),
      path.join(coordinationRoot, 'messages.ndjson'),
      path.join(coordinationRoot, 'runtime', 'watcher.status.json'),
    ];
    const before = snapshotFiles(files);
    const result = run(root, coordinationRoot, args);
    const after = snapshotFiles(files);

    if (commandsExpectedToSucceed.has(args.join(' '))) {
      assert.equal(result.status, 0, result.stderr);
    }
    assert.deepEqual(after, before);
  });
}
