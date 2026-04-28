import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { makeWorkspace as makeTestWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeWorkspace() {
  const workspace = makeTestWorkspace({ prefix: 'ai-agents-snapshot-', packageName: 'snapshot-test', runtime: true });
  writeBoard(workspace.root, {
    projectName: 'Snapshot Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-one', status: 'active', ownerId: 'agent-1', claimedPaths: ['src/a'] }],
  });
  fs.mkdirSync(path.join(workspace.coordinationRoot, 'runtime', 'agent-heartbeats'), { recursive: true });
  fs.writeFileSync(path.join(workspace.coordinationRoot, 'runtime', 'state.lock.json'), '{"owner":"agent-1"}\n');
  fs.writeFileSync(path.join(workspace.coordinationRoot, 'runtime', 'agent-heartbeats', 'agent-1.json'), '{"agentId":"agent-1"}\n');
  fs.mkdirSync(path.join(workspace.coordinationRoot, 'runtime', 'snapshots'), { recursive: true });
  fs.writeFileSync(path.join(workspace.coordinationRoot, 'runtime', 'snapshots', 'old.json'), '{}\n');
  return workspace;
}

function run(root, coordinationRoot, args) {
  return runCli(root, args, { coordinationRoot });
}

function readSnapshot(snapshotPath) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(snapshotPath)).toString('utf8'));
}

test('snapshot-workspace dry-runs without writing a compressed snapshot', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const result = run(root, coordinationRoot, ['snapshot-workspace', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, false);
  assert.equal(payload.snapshotPath.endsWith('.json.gz'), true);
  assert.equal(fs.existsSync(payload.snapshotPath), false);
  assert.ok(payload.files.some((file) => file.path === 'board.json'));
});

test('snapshot-workspace writes compressed board, journal, messages, and runtime state', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const result = run(root, coordinationRoot, ['snapshot-workspace', '--apply', '--json']);
  const payload = JSON.parse(result.stdout);
  const snapshot = readSnapshot(payload.snapshotPath);
  const snapshotPaths = snapshot.files.map((file) => file.path);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, true);
  assert.equal(fs.existsSync(payload.snapshotPath), true);
  assert.ok(snapshotPaths.includes('board.json'));
  assert.ok(snapshotPaths.includes('journal.md'));
  assert.ok(snapshotPaths.includes('messages.ndjson'));
  assert.ok(snapshotPaths.includes('runtime/state.lock.json'));
  assert.ok(snapshotPaths.includes('runtime/agent-heartbeats/agent-1.json'));
  assert.equal(snapshotPaths.includes('runtime/snapshots/old.json'), false);
  assert.match(snapshot.files.find((file) => file.path === 'board.json').content, /task-one/);
});
