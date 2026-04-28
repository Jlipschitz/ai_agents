import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'scripts', 'agent-coordination.mjs');
const validConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'agent-coordination.config.json'), 'utf8'));

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-layer-'));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agent-coordination.config.json'), `${JSON.stringify(validConfig, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'layer-test', scripts: {} }, null, 2));
  return root;
}

function coordinationRoot(root) {
  return path.join(root, 'coordination');
}

function writeBoard(root, board) {
  fs.mkdirSync(coordinationRoot(root), { recursive: true });
  fs.writeFileSync(path.join(coordinationRoot(root), 'board.json'), JSON.stringify(board, null, 2));
  fs.writeFileSync(path.join(coordinationRoot(root), 'journal.md'), '# Journal\n\n');
  fs.writeFileSync(path.join(coordinationRoot(root), 'messages.ndjson'), '');
}

function run(root, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT_COORDINATION_ROOT: coordinationRoot(root),
      AGENT_COORDINATION_CONFIG: path.join(root, 'agent-coordination.config.json'),
    },
  });
}

test('doctor --fix creates starter runtime files', () => {
  const root = makeWorkspace();
  const result = run(root, ['doctor', '--fix']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /doctor --fix/);
  assert.equal(fs.existsSync(path.join(root, 'coordination', 'board.json')), true);
  assert.equal(fs.existsSync(path.join(root, 'coordination', 'journal.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'coordination', 'messages.ndjson')), true);
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /\/coordination\//);
});

test('doctor --json reports config validation and git fields', () => {
  const root = makeWorkspace();
  const result = run(root, ['doctor', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.configValidation.valid, true);
  assert.equal(typeof payload.git.available, 'boolean');
});

test('summarize prints stale work and next actions', () => {
  const root = makeWorkspace();
  writeBoard(root, {
    projectName: 'Layer Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-one', status: 'active', ownerId: 'agent-1', title: 'Build feature', claimedPaths: ['src/feature'], updatedAt: '2000-01-01T00:00:00.000Z' },
      { id: 'task-two', status: 'blocked', ownerId: 'agent-2', title: 'Fix API', claimedPaths: ['server/api'], updatedAt: '2000-01-01T00:00:00.000Z' },
    ],
  });
  fs.appendFileSync(path.join(coordinationRoot(root), 'journal.md'), 'Recent journal entry\n');
  fs.appendFileSync(path.join(coordinationRoot(root), 'messages.ndjson'), `${JSON.stringify({ from: 'agent-1', to: 'agent-2', body: 'Please review API.' })}\n`);

  const result = run(root, ['summarize', '--for-chat']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Coordination summary for Layer Test/);
  assert.match(result.stdout, /task-one/);
  assert.match(result.stdout, /task-two/);
  assert.match(result.stdout, /Stale work/);
  assert.match(result.stdout, /Next actions/);
});

test('summarize --json includes counts and recent context', () => {
  const root = makeWorkspace();
  writeBoard(root, {
    projectName: 'Layer Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-one', status: 'planned', ownerId: null, title: 'Plan task', claimedPaths: [] }],
  });
  fs.appendFileSync(path.join(coordinationRoot(root), 'journal.md'), 'Journal tail\n');

  const result = run(root, ['summarize', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.counts.planned, 1);
  assert.ok(Array.isArray(payload.nextActions));
  assert.ok(payload.recentJournal.includes('Journal tail'));
});

test('validate --json returns machine-readable config validation', () => {
  const root = makeWorkspace();
  const result = run(root, ['validate', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.valid, true);
});

test('lock-status is routed through the main CLI', () => {
  const root = makeWorkspace();
  const result = run(root, ['lock-status', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.exists, false);
});

test('lock-clear is routed through the main CLI', () => {
  const root = makeWorkspace();
  fs.mkdirSync(path.join(coordinationRoot(root), 'runtime'), { recursive: true });
  const lockPath = path.join(coordinationRoot(root), 'runtime', 'state.lock.json');
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999999, updatedAt: '2000-01-01T00:00:00.000Z' }));

  const result = run(root, ['lock-clear', '--stale-only', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.cleared, true);
  assert.equal(fs.existsSync(lockPath), false);
});

test('finish --require-verification blocks missing passing checks before mutating board', () => {
  const root = makeWorkspace();
  writeBoard(root, {
    projectName: 'Layer Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-one', status: 'active', ownerId: 'agent-1', title: 'Needs verification', claimedPaths: ['src/a'], verification: ['unit'], verificationLog: [] }],
  });
  const boardPath = path.join(coordinationRoot(root), 'board.json');
  const before = fs.readFileSync(boardPath, 'utf8');

  const result = run(root, ['finish', 'agent-1', 'task-one', '--require-verification']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing passing verification/);
  assert.equal(fs.readFileSync(boardPath, 'utf8'), before);
});

test('finish --require-doc-review blocks missing docs review before mutating board', () => {
  const root = makeWorkspace();
  writeBoard(root, {
    projectName: 'Layer Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-one', status: 'active', ownerId: 'agent-1', title: 'Needs docs', claimedPaths: ['src/a'], verification: [] }],
  });
  const boardPath = path.join(coordinationRoot(root), 'board.json');
  const before = fs.readFileSync(boardPath, 'utf8');

  const result = run(root, ['finish', 'agent-1', 'task-one', '--require-doc-review']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /docsReviewedAt/);
  assert.equal(fs.readFileSync(boardPath, 'utf8'), before);
});
