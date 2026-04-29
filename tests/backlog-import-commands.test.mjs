import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace as makeTestWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeWorkspace() {
  const workspace = makeTestWorkspace({ prefix: 'ai-agents-backlog-', packageName: 'backlog-test', runtime: true });
  writeBoard(workspace.root, {
    projectName: 'Backlog Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [],
  });
  fs.writeFileSync(path.join(workspace.root, 'BACKLOG.md'), [
    '# Backlog',
    '',
    '- [ ] Add import workflow docs',
    '- [x] Already handled',
    'TODO: Wire GitHub issue importer later',
    '',
  ].join('\n'));
  return workspace;
}

function run(root, coordinationRoot, args, options = {}) {
  return runCli(root, args, { coordinationRoot, ...options });
}

function writeFakeGh(root, issues) {
  const fakeGhPath = path.join(root, 'fake-gh.mjs');
  fs.writeFileSync(fakeGhPath, [
    'const args = process.argv.slice(2);',
    'const expected = ["issue", "list", "--repo", "acme/widgets", "--state", "open", "--limit", "100", "--json"];',
    'for (let index = 0; index < expected.length; index += 1) {',
    '  if (args[index] !== expected[index]) {',
    '    console.error(`unexpected gh args: ${args.join(" ")}`);',
    '    process.exit(2);',
    '  }',
    '}',
    'if (!args.at(-1).includes("number,title,body,state,url,labels,assignees,author,createdAt,updatedAt")) {',
    '  console.error(`unexpected gh json fields: ${args.at(-1)}`);',
    '  process.exit(2);',
    '}',
    `console.log(${JSON.stringify(JSON.stringify(issues))});`,
    '',
  ].join('\n'));
  return {
    BACKLOG_IMPORT_GH_PATH: process.execPath,
    BACKLOG_IMPORT_GH_ARGS: JSON.stringify([fakeGhPath]),
  };
}

test('backlog-import dry-runs Markdown TODOs without mutating the board', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const boardPath = path.join(coordinationRoot, 'board.json');
  const before = fs.readFileSync(boardPath, 'utf8');

  const result = run(root, coordinationRoot, ['backlog-import', '--from', 'BACKLOG.md', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, false);
  assert.equal(payload.candidates.length, 2);
  assert.equal(payload.importedTaskIds.length, 2);
  assert.equal(fs.readFileSync(boardPath, 'utf8'), before);
});

test('backlog-import creates planned tasks with source metadata when applied', () => {
  const { root, coordinationRoot } = makeWorkspace();

  const result = run(root, coordinationRoot, ['backlog-import', '--from', 'BACKLOG.md', '--owner', 'agent-2', '--apply', '--json']);
  const payload = JSON.parse(result.stdout);
  const board = JSON.parse(fs.readFileSync(path.join(coordinationRoot, 'board.json'), 'utf8'));
  const audit = fs.readFileSync(path.join(coordinationRoot, 'runtime', 'audit.ndjson'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, true);
  assert.equal(fs.existsSync(payload.workspaceSnapshotPath), true);
  assert.equal(board.tasks.length, 2);
  assert.equal(board.tasks[0].status, 'planned');
  assert.equal(board.tasks[0].suggestedOwnerId, 'agent-2');
  assert.deepEqual(board.tasks[0].claimedPaths, ['BACKLOG.md']);
  assert.equal(board.tasks[0].importSource.type, 'markdown-todo');
  assert.equal(audit.at(-1).command, 'backlog-import');
  assert.equal(audit.at(-1).details.taskIds.length, 2);

  const secondRun = run(root, coordinationRoot, ['backlog-import', '--from', 'BACKLOG.md', '--apply', '--json']);
  const secondPayload = JSON.parse(secondRun.stdout);
  assert.equal(secondRun.status, 0, secondRun.stderr);
  assert.equal(secondPayload.applied, false);
  assert.equal(secondPayload.skippedExistingTaskIds.length, 2);
});

test('backlog-import dry-runs GitHub issues through gh without mutating the board', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const boardPath = path.join(coordinationRoot, 'board.json');
  const before = fs.readFileSync(boardPath, 'utf8');
  const env = writeFakeGh(root, [
    {
      number: 42,
      title: 'Import open issues',
      body: 'Create planned backlog tasks from GitHub issues.',
      state: 'OPEN',
      url: 'https://github.com/acme/widgets/issues/42',
      labels: [{ name: 'backlog' }, { name: 'bug' }],
      assignees: [{ login: 'octo' }],
      author: { login: 'hubot' },
      createdAt: '2026-01-02T00:00:00Z',
      updatedAt: '2026-01-03T00:00:00Z',
    },
  ]);

  const result = run(root, coordinationRoot, ['backlog-import', '--github-issues', 'acme/widgets', '--json'], { env });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, false);
  assert.equal(payload.sourceType, 'github-issues');
  assert.equal(payload.githubRepository, 'acme/widgets');
  assert.equal(payload.candidates.length, 1);
  assert.equal(payload.candidates[0].number, 42);
  assert.equal(payload.importedTaskIds.length, 1);
  assert.equal(fs.readFileSync(boardPath, 'utf8'), before);
});

test('backlog-import applies GitHub issues with stable source metadata and skips repeats', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const env = writeFakeGh(root, [
    {
      number: 42,
      title: 'Import open issues',
      body: 'Create planned backlog tasks from GitHub issues.',
      state: 'OPEN',
      url: 'https://github.com/acme/widgets/issues/42',
      labels: [{ name: 'backlog' }, { name: 'bug' }],
      assignees: [{ login: 'octo' }],
      author: { login: 'hubot' },
      createdAt: '2026-01-02T00:00:00Z',
      updatedAt: '2026-01-03T00:00:00Z',
    },
  ]);

  const result = run(root, coordinationRoot, ['backlog-import', '--github-issues', 'acme/widgets', '--owner', 'agent-3', '--apply', '--json'], { env });
  const payload = JSON.parse(result.stdout);
  const board = JSON.parse(fs.readFileSync(path.join(coordinationRoot, 'board.json'), 'utf8'));
  const task = board.tasks[0];
  const audit = fs.readFileSync(path.join(coordinationRoot, 'runtime', 'audit.ndjson'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, true);
  assert.equal(board.tasks.length, 1);
  assert.equal(task.status, 'planned');
  assert.equal(task.suggestedOwnerId, 'agent-3');
  assert.equal(task.issueKey, 'acme/widgets#42');
  assert.deepEqual(task.claimedPaths, []);
  assert.deepEqual(task.relevantDocs, ['https://github.com/acme/widgets/issues/42']);
  assert.deepEqual(task.importSource, {
    type: 'github-issue',
    repository: 'acme/widgets',
    number: 42,
    url: 'https://github.com/acme/widgets/issues/42',
    state: 'OPEN',
    title: 'Import open issues',
    labels: ['backlog', 'bug'],
    assignees: ['octo'],
    author: 'hubot',
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
  });
  assert.equal(audit.at(-1).details.sourceType, 'github-issues');
  assert.equal(audit.at(-1).details.githubRepository, 'acme/widgets');

  const secondRun = run(root, coordinationRoot, ['backlog-import', '--github-issues', 'acme/widgets', '--apply', '--json'], { env });
  const secondPayload = JSON.parse(secondRun.stdout);
  assert.equal(secondRun.status, 0, secondRun.stderr);
  assert.equal(secondPayload.applied, false);
  assert.equal(secondPayload.skippedExistingTaskIds.length, 1);
});
