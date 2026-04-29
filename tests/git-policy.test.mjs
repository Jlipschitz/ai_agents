import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildGitSafeDirectoryCommand, getGitSnapshot, isGitDubiousOwnershipError } from '../scripts/lib/git-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'scripts', 'agent-coordination.mjs');
const baseConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'agent-coordination.config.json'), 'utf8'));
const GIT_BIN = resolveGitBinary();
const gitTest = GIT_BIN ? test : test.skip;

function resolveGitBinary() {
  if (process.env.GIT_BINARY && canRunGit(process.env.GIT_BINARY)) {
    return process.env.GIT_BINARY;
  }
  if (canRunGit('git')) {
    return 'git';
  }
  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Git\\cmd\\git.exe',
        'C:\\Program Files\\Git\\bin\\git.exe',
        'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
      ]
    : ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];
  return candidates.find((candidate) => fs.existsSync(candidate) && canRunGit(candidate)) ?? null;
}

function canRunGit(candidate) {
  try {
    return spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0;
  } catch {
    return false;
  }
}

function pathWithGit() {
  if (!GIT_BIN || GIT_BIN === 'git') return process.env.PATH;
  return `${path.dirname(GIT_BIN)}${path.delimiter}${process.env.PATH ?? ''}`;
}

function git(root, args) {
  return execFileSync(GIT_BIN, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeGitWorkspace(gitConfig) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-git-policy-'));
  const coordinationRoot = path.join(root, 'coordination');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(coordinationRoot, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'git-policy-test', scripts: {} }, null, 2));
  fs.writeFileSync(path.join(root, 'README.md'), '# Test\n');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'shared.js'), 'export const shared = 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'other.js'), 'export const other = 1;\n');
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
      PATH: pathWithGit(),
      AGENT_COORDINATION_ROOT: coordinationRoot,
      AGENT_COORDINATION_CONFIG: path.join(root, 'agent-coordination.config.json'),
    },
  });
}

gitTest('doctor --json reports blocked main branch claim policy', () => {
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

gitTest('doctor --json allows matching branch patterns', () => {
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

test('git snapshot reports dubious ownership remediation', () => {
  const root = path.join(os.tmpdir(), 'ai-agents-dubious-owner');
  const error = new Error('git failed');
  error.stderr = Buffer.from([
    `fatal: detected dubious ownership in repository at '${root}'`,
    'To add an exception for this directory, call:',
    '',
    `\tgit config --global --add safe.directory ${root}`,
    '',
  ].join('\n'));
  const snapshot = getGitSnapshot({
    root,
    runGit(args) {
      assert.deepEqual(args, ['rev-parse', '--is-inside-work-tree']);
      throw error;
    },
  });

  assert.equal(isGitDubiousOwnershipError(error), true);
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.dubiousOwnership, true);
  assert.equal(snapshot.safeDirectoryCommand, buildGitSafeDirectoryCommand(root));
  assert.ok(snapshot.errors.some((entry) => entry.includes('safe.directory')));
});

test('git snapshot preserves leading porcelain status columns', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-git-snapshot-'));
  const snapshot = getGitSnapshot({
    root,
    runGit(args) {
      const key = args.join(' ');
      if (key === 'rev-parse --is-inside-work-tree') return 'true';
      if (key === 'branch --show-current') return 'main';
      if (key === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') throw new Error('no upstream');
      if (key === 'status --porcelain=v1') return ' M README.md\n?? scripts/new-file.mjs\n';
      if (key === 'rev-parse --git-dir') return '.git';
      throw new Error(`unexpected git call: ${key}`);
    },
  });

  assert.deepEqual(snapshot.dirty, ['README.md']);
  assert.deepEqual(snapshot.untracked, ['scripts/new-file.mjs']);
});

gitTest('claim is blocked when branch does not match configured patterns', () => {
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

gitTest('claim conflict prediction blocks local changes owned by another active task', () => {
  const { root, coordinationRoot } = makeGitWorkspace({
    allowMainBranchClaims: true,
    allowDetachedHead: false,
    allowedBranchPatterns: [],
  });
  fs.writeFileSync(path.join(root, 'src', 'shared.js'), 'export const shared = 2;\n');
  fs.writeFileSync(path.join(coordinationRoot, 'board.json'), JSON.stringify({
    projectName: 'Git Policy Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-other', status: 'active', ownerId: 'agent-2', title: 'Other task', claimedPaths: ['src/shared.js'] },
      { id: 'task-new', status: 'planned', ownerId: null, title: 'New task', claimedPaths: [] },
    ],
  }, null, 2));

  const result = run(root, coordinationRoot, ['claim', 'agent-1', 'task-new', '--paths', 'src/other.js']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /conflict prediction/);
  assert.match(result.stderr, /src\/shared\.js/);
});

gitTest('claim records current branch metadata on the task', () => {
  const { root, coordinationRoot } = makeGitWorkspace({
    allowMainBranchClaims: true,
    allowDetachedHead: false,
    allowedBranchPatterns: ['agent/*'],
  });
  git(root, ['checkout', '-b', 'agent/task-branch']);

  const result = run(root, coordinationRoot, ['claim', 'agent-1', 'task-one', '--paths', 'src/other.js']);
  const board = JSON.parse(fs.readFileSync(path.join(coordinationRoot, 'board.json'), 'utf8'));
  const task = board.tasks.find((entry) => entry.id === 'task-one');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(task.gitBranch, 'agent/task-branch');
});

gitTest('branches reports active task ownership and stale cleanup candidates', () => {
  const { root, coordinationRoot } = makeGitWorkspace({
    allowMainBranchClaims: true,
    allowDetachedHead: false,
    allowedBranchPatterns: [],
  });
  git(root, ['branch', 'feature/active']);
  git(root, ['branch', 'feature/old']);
  fs.writeFileSync(path.join(coordinationRoot, 'board.json'), JSON.stringify({
    projectName: 'Git Policy Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-active', status: 'active', ownerId: 'agent-1', title: 'Active branch task', claimedPaths: ['src/other.js'], gitBranch: 'feature/active' },
    ],
  }, null, 2));

  const result = run(root, coordinationRoot, ['branches', '--json', '--stale-days', '0', '--base', 'main']);
  const payload = JSON.parse(result.stdout);
  const activeBranch = payload.branches.find((entry) => entry.name === 'feature/active');

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(activeBranch.activeTasks, ['task-active']);
  assert.ok(payload.cleanupCandidates.some((entry) => entry.name === 'feature/old'));
  assert.ok(!payload.cleanupCandidates.some((entry) => entry.name === 'feature/active'));
});

gitTest('branches --apply writes recovery plan before deletion and restore recreates refs', () => {
  const { root, coordinationRoot } = makeGitWorkspace({
    allowMainBranchClaims: true,
    allowDetachedHead: false,
    allowedBranchPatterns: [],
  });
  git(root, ['branch', 'feature/old']);
  const originalSha = git(root, ['rev-parse', 'refs/heads/feature/old']);

  const applyResult = run(root, coordinationRoot, ['branches', '--json', '--stale-days', '0', '--base', 'main', '--apply']);
  assert.equal(applyResult.status, 0, applyResult.stderr);
  const applyPayload = JSON.parse(applyResult.stdout);
  assert.deepEqual(applyPayload.deleted, ['feature/old']);
  assert.ok(applyPayload.recoveryPlanPath);
  assert.notEqual(spawnSync(GIT_BIN, ['rev-parse', '--verify', '--quiet', 'refs/heads/feature/old'], { cwd: root }).status, 0);

  const plan = JSON.parse(fs.readFileSync(applyPayload.recoveryPlanPath, 'utf8'));
  assert.equal(plan.type, 'branch-delete-recovery');
  assert.deepEqual(plan.deleted, ['feature/old']);
  assert.equal(plan.branches[0].name, 'feature/old');
  assert.equal(plan.branches[0].objectName, originalSha);
  assert.match(plan.branches[0].restoreCommand.replaceAll('\\', '/'), /git update-ref refs\/heads\/feature\/old /);

  const restoreResult = run(root, coordinationRoot, ['branches', 'restore', applyPayload.recoveryPlanPath, '--json']);
  assert.equal(restoreResult.status, 0, restoreResult.stderr);
  const restorePayload = JSON.parse(restoreResult.stdout);
  assert.equal(restorePayload.restored[0].branch, 'feature/old');
  assert.equal(git(root, ['rev-parse', 'refs/heads/feature/old']), originalSha);
});

gitTest('branches restore --json returns stable JSON when the plan cannot be read', () => {
  const { root, coordinationRoot } = makeGitWorkspace({
    allowMainBranchClaims: true,
    allowDetachedHead: false,
    allowedBranchPatterns: [],
  });

  const result = run(root, coordinationRoot, ['branches', 'restore', 'missing-recovery-plan.json', '--json']);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.restored, []);
  assert.deepEqual(payload.skipped, []);
  assert.match(payload.errors[0], /Failed to read branch recovery plan/);
});

gitTest('test-impact preserves leading porcelain status columns', () => {
  const { root, coordinationRoot } = makeGitWorkspace({
    allowMainBranchClaims: true,
    allowDetachedHead: false,
    allowedBranchPatterns: [],
  });
  fs.writeFileSync(path.join(root, 'README.md'), '# Changed\n');

  const result = run(root, coordinationRoot, ['test-impact', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(payload.paths.includes('README.md'));
  assert.ok(!payload.paths.includes('EADME.md'));
});
