import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'scripts', 'agent-coordination.mjs');
const baseConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'agent-coordination.config.json'), 'utf8'));

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeGitWorkspace(gitConfig) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-git-policy-'));
  const coordinationRoot = path.join(root, 'coordination');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(coordinationRoot, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'git-policy-test', scripts: {} }, null, 2));
  fs.writeFileSync(path.join(root, 'README.md'), '# Test\n');
  fs.writeFileSync(path.join(root, 'agent-coordination.config.json'), `${JSON.stringify({ ...baseConfig, git: gitConfig }, null, 2)}\n`);
  fs.writeFileSync(path.join(coordinationRoot, 'board.json'), JSON.stringify({
    projectName: 'Git Policy Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-one', status: 'planned', title: 'Task one', claimedPaths: [] },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(coordinationRoot, 'journal.md'), '# Journal\n\n');
  fs.writeFileSync(path.join(coordinationRoot, 'messages.ndjson'), '');

  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test User']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'Initial commit']);

  return { root, coordinationRoot };
}

function run(root, coordinationRoot, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT_COORDINATION_ROOT: coordinationRoot,
      AGENT_COORDINATION_CONFIG: path.join(root, 'agent-coordination.config.json'),
    },
  });
}

test('doctor --json reports blocked main branch claim policy', () => {
  const { root, coordinationRoot } = makeGitWorkspace({
    allowMainBranchClaims: false,
    allowDetachedHead: false,
    allowedBranchPatterns: [],
  });

  const result = run(root, coordinationRoot, ['doctor', '--json']);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.ok(payload.git.errors.some((entry) => entry.includes('git.allowMainBranchClaims')));
});

test('doctor --json allows matching branch patterns', () => {
  const { root, coordinationRoot } = makeGitWorkspace({
    allowMainBranchClaims: false,
    allowDetachedHead: false,
    allowedBranchPatterns: ['agent/*', 'feature/*'],
  });
  git(root, ['checkout', '-b', 'agent/test-work']);

  const result = run(root, coordinationRoot, ['doctor', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.git.branch, 'agent/test-work');
});

test('claim is blocked when branch does not match configured patterns', () => {
  const { root, coordinationRoot } = makeGitWorkspace({
    allowMainBranchClaims: true,
    allowDetachedHead: false,
    allowedBranchPatterns: ['agent/*'],
  });
  git(root, ['checkout', '-b', 'bugfix/nope']);

  const result = run(root, coordinationRoot, ['claim', 'agent-1', 'task-one', '--paths', 'src/a']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /git.allowedBranchPatterns/);
});
