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
const lockScript = path.join(repoRoot, 'scripts', 'lock-runtime.mjs');

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-lock-'));
  const coordinationRoot = path.join(root, 'coordination');
  const runtimeRoot = path.join(coordinationRoot, 'runtime');
  fs.mkdirSync(runtimeRoot, { recursive: true });
  return { root, coordinationRoot, runtimeRoot, lockPath: path.join(runtimeRoot, 'state.lock.json') };
}

function run(root, args) {
  return spawnSync(process.execPath, [lockScript, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('lock status reports missing lock without failing', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const result = run(root, ['status', '--json', '--coordination-root', coordinationRoot]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.exists, false);
  assert.equal(payload.stale, false);
});

test('lock status detects stale lock by age', () => {
  const { root, coordinationRoot, lockPath } = makeWorkspace();
  fs.writeFileSync(lockPath, JSON.stringify({
    command: 'claim',
    owner: 'agent-1',
    pid: process.pid,
    updatedAt: '2000-01-01T00:00:00.000Z',
  }, null, 2));

  const result = run(root, ['status', '--json', '--coordination-root', coordinationRoot, '--stale-ms', '1000']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.exists, true);
  assert.equal(payload.stale, true);
  assert.ok(payload.staleReasons.some((entry) => entry.startsWith('older-than')));
});

test('lock clear --stale-only removes stale lock', () => {
  const { root, coordinationRoot, lockPath } = makeWorkspace();
  fs.writeFileSync(lockPath, JSON.stringify({
    command: 'claim',
    owner: 'agent-1',
    pid: 99999999,
    updatedAt: '2000-01-01T00:00:00.000Z',
  }, null, 2));

  const result = run(root, ['clear', '--stale-only', '--json', '--coordination-root', coordinationRoot, '--stale-ms', '1000']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.cleared, true);
  assert.equal(fs.existsSync(lockPath), false);
});

test('lock clear --stale-only refuses a fresh lock', () => {
  const { root, coordinationRoot, lockPath } = makeWorkspace();
  fs.writeFileSync(lockPath, JSON.stringify({
    command: 'claim',
    owner: 'agent-1',
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  }, null, 2));

  const result = run(root, ['clear', '--stale-only', '--json', '--coordination-root', coordinationRoot, '--stale-ms', '60000']);

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.cleared, false);
  assert.equal(fs.existsSync(lockPath), true);
});
