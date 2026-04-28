import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { coordinationRoot, makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function seedState(root) {
  writeBoard(root, {
    projectName: 'Compaction Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [],
    resources: [],
    incidents: [],
  });
  const rootCoordination = coordinationRoot(root);
  fs.writeFileSync(path.join(rootCoordination, 'journal.md'), ['j1', 'j2', 'j3', 'j4', ''].join('\n'));
  fs.writeFileSync(path.join(rootCoordination, 'messages.ndjson'), ['{"n":1}', '{"n":2}', '{"n":3}', ''].join('\n'));
}

test('compact-state dry-runs without mutating journal or messages', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-compact-dry-', packageName: 'compact-test' });
  seedState(root);
  const rootCoordination = coordinationRoot(root);
  const journalPath = path.join(rootCoordination, 'journal.md');
  const messagesPath = path.join(rootCoordination, 'messages.ndjson');
  const beforeJournal = fs.readFileSync(journalPath, 'utf8');
  const beforeMessages = fs.readFileSync(messagesPath, 'utf8');

  const result = runCli(root, ['compact-state', '--keep-journal-lines', '2', '--keep-message-lines', '1', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, false);
  assert.equal(payload.compact.journalLines, 2);
  assert.equal(payload.compact.messageLines, 2);
  assert.equal(fs.readFileSync(journalPath, 'utf8'), beforeJournal);
  assert.equal(fs.readFileSync(messagesPath, 'utf8'), beforeMessages);
});

test('compact-state applies archive and keeps recent lines', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-compact-apply-', packageName: 'compact-test' });
  seedState(root);
  const rootCoordination = coordinationRoot(root);

  const result = runCli(root, ['compact-state', '--keep-journal-lines', '2', '--keep-message-lines', '1', '--apply', '--json']);
  const payload = JSON.parse(result.stdout);
  const archive = JSON.parse(fs.readFileSync(payload.archivePath, 'utf8'));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, true);
  assert.equal(fs.existsSync(payload.workspaceSnapshotPath), true);
  assert.deepEqual(archive.journalLines, ['j1', 'j2']);
  assert.deepEqual(archive.messageLines, ['{"n":1}', '{"n":2}']);
  assert.equal(fs.readFileSync(path.join(rootCoordination, 'journal.md'), 'utf8'), 'j3\nj4\n');
  assert.equal(fs.readFileSync(path.join(rootCoordination, 'messages.ndjson'), 'utf8'), '{"n":3}\n');
});
