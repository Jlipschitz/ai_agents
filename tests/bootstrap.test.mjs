import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bootstrap } from '../scripts/bootstrap.mjs';

test('bootstrap dry-run reports intended setup without writing files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-bootstrap-'));
  const operations = bootstrap(target, { dryRun: true, skipDoctor: true });

  assert.ok(operations.some((entry) => entry.includes('copy scripts/agent-coordination-core.mjs')));
  assert.ok(operations.some((entry) => entry.includes('update package.json scripts')));
  assert.ok(operations.some((entry) => entry.includes('update .gitignore')));
  assert.equal(fs.existsSync(path.join(target, 'package.json')), false);
  assert.equal(fs.existsSync(path.join(target, 'scripts')), false);
});

test('bootstrap creates package scripts and gitignore entries', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-bootstrap-'));
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'target-app', scripts: {} }, null, 2));

  const operations = bootstrap(target, { skipDoctor: true });
  const packageJson = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
  const gitignore = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');

  assert.ok(operations.some((entry) => entry.includes('copy bin/ai-agents.mjs')));
  assert.ok(operations.some((entry) => entry.includes('copy scripts/check-syntax.mjs')));
  assert.ok(operations.some((entry) => entry.includes('copy scripts/lib/file-utils.mjs')));
  assert.ok(operations.some((entry) => entry.includes('copy scripts/lib/artifact-commands.mjs')));
  assert.equal(packageJson.scripts.check, 'node ./scripts/check-syntax.mjs');
  assert.equal(packageJson.scripts['agents:doctor'], 'node ./scripts/agent-coordination.mjs doctor');
  assert.equal(packageJson.scripts['agents:board:migrate'], 'node ./scripts/agent-coordination.mjs migrate-board');
  assert.equal(packageJson.scripts['validate:agents-config'], 'node ./scripts/validate-config.mjs');
  assert.match(gitignore, /\/coordination\//);
  assert.match(gitignore, /\/coordination-two\//);
  assert.equal(fs.existsSync(path.join(target, 'docs', 'ai-agent-app-notes.md')), true);
});
