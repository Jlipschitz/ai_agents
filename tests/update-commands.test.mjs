import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace as makeTestWorkspace, repoRoot, runCli } from './helpers/workspace.mjs';

function makeWorkspace() {
  const workspace = makeTestWorkspace({ prefix: 'ai-agents-update-', packageName: 'update-test', runtime: true });
  fs.writeFileSync(path.join(workspace.root, 'docs', 'commands.md'), '# Local commands\n');
  fs.mkdirSync(path.join(workspace.coordinationRoot, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(workspace.coordinationRoot, 'runtime', 'state.lock.json'), '{"owner":"local"}\n');
  return workspace;
}

function run(root, args) {
  return runCli(root, args);
}

test('update-coordinator dry-runs without copying coordinator files', () => {
  const { root } = makeWorkspace();
  const result = run(root, ['update-coordinator', '--source', repoRoot, '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, false);
  assert.equal(payload.counts.create > 0, true);
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'agent-command-layer.mjs')), false);
  assert.equal(fs.readFileSync(path.join(root, 'docs', 'commands.md'), 'utf8'), '# Local commands\n');
});

test('update-coordinator applies tool updates while preserving config, docs, and runtime state', () => {
  const { root, coordinationRoot, configPath } = makeWorkspace();
  const configBefore = fs.readFileSync(configPath, 'utf8');
  const runtimePath = path.join(coordinationRoot, 'runtime', 'state.lock.json');

  const result = run(root, ['update-coordinator', '--source', repoRoot, '--apply', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, true);
  assert.equal(payload.includeDocs, false);
  assert.equal(fs.existsSync(path.join(root, 'bin', 'ai-agents.mjs')), true);
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'agent-command-layer.mjs')), true);
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'lib', 'update-commands.mjs')), true);
  assert.equal(fs.readFileSync(configPath, 'utf8'), configBefore);
  assert.equal(fs.readFileSync(path.join(root, 'docs', 'commands.md'), 'utf8'), '# Local commands\n');
  assert.equal(fs.readFileSync(runtimePath, 'utf8'), '{"owner":"local"}\n');
});

test('update-coordinator only updates bundled docs when requested', () => {
  const { root } = makeWorkspace();
  const docsPath = path.join(root, 'docs', 'commands.md');

  const result = run(root, ['update-coordinator', '--source', repoRoot, '--include-docs', '--apply', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.includeDocs, true);
  assert.equal(fs.readFileSync(docsPath, 'utf8'), fs.readFileSync(path.join(repoRoot, 'docs', 'commands.md'), 'utf8'));
});
