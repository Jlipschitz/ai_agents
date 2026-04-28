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

function makeWorkspace({ mergeGroup = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-github-status-'));
  const coordinationRoot = path.join(root, 'coordination');
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.mkdirSync(coordinationRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'github-status-test', scripts: {} }, null, 2));
  fs.writeFileSync(path.join(root, 'agent-coordination.config.json'), `${JSON.stringify(baseConfig, null, 2)}\n`);
  fs.writeFileSync(path.join(coordinationRoot, 'board.json'), JSON.stringify({ projectName: 'GitHub Status Test', tasks: [] }, null, 2));
  fs.writeFileSync(path.join(coordinationRoot, 'journal.md'), '# Journal\n\n');
  fs.writeFileSync(path.join(coordinationRoot, 'messages.ndjson'), '');
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), [
    'on:',
    '  pull_request:',
    mergeGroup ? '  merge_group:' : '',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo ok',
    '',
  ].filter(Boolean).join('\n'));

  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test User']);
  git(root, ['remote', 'add', 'origin', 'git@github.com:Jlipschitz/ai_agents.git']);
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

test('github-status reports GitHub remote and merge queue workflow trigger', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const result = run(root, coordinationRoot, ['github-status', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.repository.owner, 'Jlipschitz');
  assert.equal(payload.repository.repo, 'ai_agents');
  assert.equal(payload.mergeQueue.enabledByWorkflow, true);
  assert.deepEqual(payload.mergeQueue.workflows, ['.github/workflows/ci.yml']);
});

test('github-status warns when merge_group workflow trigger is missing', () => {
  const { root, coordinationRoot } = makeWorkspace({ mergeGroup: false });
  const result = run(root, coordinationRoot, ['github-status', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.mergeQueue.enabledByWorkflow, false);
  assert.ok(payload.warnings.some((entry) => entry.includes('merge_group')));
});
