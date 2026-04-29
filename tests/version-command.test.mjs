import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { makeWorkspace, repoRoot, runCli, writeBoard } from './helpers/workspace.mjs';

function makeVersionWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-version-', packageName: 'version-test' });
  writeBoard(workspace.root, {
    version: 2,
    projectName: 'Version Test',
    tasks: [],
    agents: [],
    resources: [],
    incidents: [],
  });
  return workspace;
}

test('version command reports package node config and board versions as JSON', () => {
  const { root, coordinationRoot } = makeVersionWorkspace();
  const result = runCli(root, ['version', '--json'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.package.name, 'version-test');
  assert.equal(payload.node.version, process.version);
  assert.equal(payload.config.exists, true);
  assert.equal(payload.config.version, 1);
  assert.equal(payload.board.exists, true);
  assert.equal(payload.board.version, 2);
  assert.equal(payload.board.schemaVersion, 2);
});

test('public cli --version uses installed package metadata and supports json', () => {
  const { root, coordinationRoot } = makeVersionWorkspace();
  const result = runCli(root, ['--version', '--json'], {
    coordinationRoot,
    cliPath: path.join(repoRoot, 'bin', 'ai-agents.mjs'),
  });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.package.name, '@jlipschitz/ai-agents');
  assert.equal(payload.node.version, process.version);
  assert.equal(payload.board.schemaVersion, 2);
});

test('version text output includes config and coordination paths', () => {
  const { root, coordinationRoot } = makeVersionWorkspace();
  const result = runCli(root, ['version'], { coordinationRoot });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /version-test/);
  assert.match(result.stdout, /config agent-coordination\.config\.json/);
  assert.match(result.stdout, /coordination coordination/);
  assert.match(result.stdout, /schema 2/);
});
