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
const fixtureRoot = path.join(__dirname, 'fixtures', 'basic-repo');
const snapshotRoot = path.join(__dirname, 'fixtures', 'command-snapshots');

function makeFixtureWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-fixture-'));
  fs.cpSync(fixtureRoot, root, { recursive: true });
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

function readSnapshot(name) {
  return fs.readFileSync(path.join(snapshotRoot, name), 'utf8').trim();
}

test('ownership-review fixture output matches snapshot', () => {
  const root = makeFixtureWorkspace();
  const result = run(root, ['ownership-review', '--json']);

  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), readSnapshot('ownership-review.json'));
});

test('test-impact fixture output matches snapshot', () => {
  const root = makeFixtureWorkspace();
  const result = run(root, ['test-impact', '--paths', 'app/page.js,api/route.js', '--json']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), readSnapshot('test-impact.json'));
});
