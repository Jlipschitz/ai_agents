import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(repoRoot, 'scripts', 'agent-coordination.mjs');
const validConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'agent-coordination.config.json'), 'utf8'));

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-layer-'));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agent-coordination.config.json'), `${JSON.stringify(validConfig, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'layer-test', scripts: {} }, null, 2));
  return root;
}

function run(root, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT_COORDINATION_ROOT: path.join(root, 'coordination'),
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

test('summarize prints a compact board summary', () => {
  const root = makeWorkspace();
  fs.mkdirSync(path.join(root, 'coordination'), { recursive: true });
  fs.writeFileSync(path.join(root, 'coordination', 'board.json'), JSON.stringify({
    projectName: 'Layer Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-one', status: 'active', ownerId: 'agent-1', title: 'Build feature', claimedPaths: ['src/feature'] },
      { id: 'task-two', status: 'blocked', ownerId: 'agent-2', title: 'Fix API', claimedPaths: ['server/api'] },
    ],
  }, null, 2));

  const result = run(root, ['summarize', '--for-chat']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Coordination summary for Layer Test/);
  assert.match(result.stdout, /task-one/);
  assert.match(result.stdout, /task-two/);
});

test('validate --json returns machine-readable config validation', () => {
  const root = makeWorkspace();
  const result = run(root, ['validate', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.valid, true);
});
