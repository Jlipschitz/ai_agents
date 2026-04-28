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
const agentsCli = path.join(repoRoot, 'scripts', 'agent-coordination.mjs');
const publicCli = path.join(repoRoot, 'bin', 'ai-agents.mjs');
const validConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'agent-coordination.config.json'), 'utf8'));

function makeWorkspace(config = validConfig) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-explain-'));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'agent-coordination-portability.md'), '# Notes\n');
  fs.writeFileSync(path.join(root, 'agent-coordination.config.json'), `${JSON.stringify(config, null, 2)}\n`);
  return root;
}

function run(cliPath, root, args, env = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      AGENT_COORDINATION_CONFIG: path.join(root, 'agent-coordination.config.json'),
    },
  });
}

test('explain-config --json reports config, agents, git policy, docs, and env overrides', () => {
  const root = makeWorkspace();
  const result = run(agentsCli, root, ['explain-config', '--json'], {
    AGENT_TERMINAL_ID: 'terminal-a',
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.validation.valid, true);
  assert.equal(payload.projectName, validConfig.projectName);
  assert.equal(payload.agents.count, validConfig.agentIds.length);
  assert.deepEqual(payload.git.allowedBranchPatterns, validConfig.git.allowedBranchPatterns);
  assert.equal(payload.environmentOverrides.AGENT_TERMINAL_ID, 'terminal-a');
  assert.ok(payload.docs.roots.length > 0);
});

test('explain-config text output includes key sections', () => {
  const root = makeWorkspace();
  const result = run(agentsCli, root, ['explain-config']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Config Explanation/);
  assert.match(result.stdout, /Agents:/);
  assert.match(result.stdout, /Git policy:/);
  assert.match(result.stdout, /Suggestions:/);
});

test('public CLI routes explain-config', () => {
  const root = makeWorkspace();
  const result = run(publicCli, root, ['explain-config', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.validation.valid, true);
});

test('explain-config returns non-zero for invalid config with useful errors', () => {
  const invalid = {
    ...validConfig,
    agentIds: [],
    git: {
      allowMainBranchClaims: 'nope',
      allowDetachedHead: false,
      allowedBranchPatterns: [],
    },
  };
  const root = makeWorkspace(invalid);
  const result = run(agentsCli, root, ['explain-config', '--json']);

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.validation.valid, false);
  assert.ok(payload.validation.errors.some((entry) => entry.includes('agentIds')));
  assert.ok(payload.validation.errors.some((entry) => entry.includes('git.allowMainBranchClaims')));
});
