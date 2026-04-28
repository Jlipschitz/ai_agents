import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeChangelogWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-changelog-', packageName: 'changelog-test' });
  writeBoard(workspace.root, {
    projectName: 'Changelog Test',
    updatedAt: '2026-02-15T00:00:00.000Z',
    tasks: [
      {
        id: 'task-current',
        title: 'Current done task',
        status: 'done',
        summary: 'Shipped current feature.',
        claimedPaths: ['src/current'],
        relevantDocs: ['README.md'],
        updatedAt: '2026-02-10T12:00:00.000Z',
        verificationLog: [
          { check: 'unit', outcome: 'pass', at: '2026-02-10T11:00:00.000Z', details: 'node --test' },
          { check: 'visual', outcome: 'pass', at: '2026-02-10T11:30:00.000Z', artifacts: [{ path: 'artifacts/visual.html' }] },
        ],
      },
      {
        id: 'task-active',
        title: 'Active task',
        status: 'active',
        summary: 'Still running.',
        claimedPaths: ['src/active'],
        updatedAt: '2026-02-11T12:00:00.000Z',
      },
    ],
    resources: [],
    incidents: [],
  });
  const archiveRoot = path.join(workspace.coordinationRoot, 'archive');
  fs.mkdirSync(archiveRoot, { recursive: true });
  fs.writeFileSync(path.join(archiveRoot, 'tasks-2026-01.json'), JSON.stringify({
    version: 1,
    tasks: [
      {
        id: 'task-archived',
        title: 'Archived released task',
        status: 'released',
        summary: 'Released archived feature.',
        claimedPaths: ['src/archived'],
        updatedAt: '2026-01-05T09:00:00.000Z',
        verificationLog: [{ check: 'smoke', outcome: 'pass', at: '2026-01-05T08:00:00.000Z' }],
      },
    ],
  }, null, 2));
  return workspace;
}

test('changelog renders current and archived completed work as Markdown', () => {
  const { root, coordinationRoot } = makeChangelogWorkspace();
  const result = runCli(root, ['changelog'], { coordinationRoot });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Changelog/);
  assert.match(result.stdout, /## 2026-02/);
  assert.match(result.stdout, /task-current - Current done task/);
  assert.match(result.stdout, /unit pass/);
  assert.match(result.stdout, /visual pass \(1 artifact\(s\)\)/);
  assert.match(result.stdout, /## 2026-01/);
  assert.match(result.stdout, /task-archived - Archived released task/);
  assert.doesNotMatch(result.stdout, /task-active/);
});

test('changelog supports JSON and since filtering', () => {
  const { root, coordinationRoot } = makeChangelogWorkspace();
  const result = runCli(root, ['changelog', '--since', '2026-02-01', '--json'], { coordinationRoot });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.since, '2026-02-01');
  assert.equal(payload.entryCount, 1);
  assert.equal(payload.entries[0].id, 'task-current');
  assert.equal(payload.groups[0].month, '2026-02');
});
