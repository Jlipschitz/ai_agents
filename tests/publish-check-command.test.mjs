import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli } from './helpers/workspace.mjs';

function writeFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function makePublishWorkspace(options = {}) {
  const workspace = makeWorkspace({ prefix: 'ai-agents-publish-check-', packageName: 'publish-check-test' });
  const packageJson = {
    name: 'publish-check-test',
    version: '1.2.3',
    private: Boolean(options.private),
    license: 'MIT',
    type: 'module',
    bin: { 'ai-agents': './bin/ai-agents.mjs' },
    files: ['bin', 'scripts', 'docs', 'README.md', 'LICENSE'],
    scripts: {
      check: 'node ./scripts/check-syntax.mjs',
      test: 'node --test',
      lint: 'node ./scripts/lint.mjs',
      'jsdoc:check': 'node ./scripts/jsdoc-check.mjs',
    },
  };
  fs.writeFileSync(path.join(workspace.root, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  for (const file of ['README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'docs/commands.md', 'docs/architecture.md', 'docs/troubleshooting.md']) {
    writeFile(path.join(workspace.root, file), `${file}\n`);
  }
  writeFile(path.join(workspace.root, 'bin', 'ai-agents.mjs'), '#!/usr/bin/env node\n');
  return workspace;
}

test('publish-check reports a ready local package', () => {
  const { root, coordinationRoot } = makePublishWorkspace();
  const result = runCli(root, ['publish-check', '--json'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.ok, true);
  assert.equal(payload.package.name, 'publish-check-test');
  assert.deepEqual(payload.findings, []);
});

test('publish-check reports blockers and strict mode fails', () => {
  const { root, coordinationRoot } = makePublishWorkspace({ private: true });
  const normal = runCli(root, ['publish-check', '--json'], { coordinationRoot });
  const strict = runCli(root, ['publish-check', '--strict', '--json'], { coordinationRoot });
  const payload = JSON.parse(normal.stdout);

  assert.equal(normal.status, 0, normal.stderr);
  assert.equal(payload.ok, false);
  assert.ok(payload.findings.some((entry) => entry.code === 'private-package'));
  assert.equal(strict.status, 1);
});
