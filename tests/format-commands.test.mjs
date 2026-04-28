import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli } from './helpers/workspace.mjs';

test('format reports changes without applying by default and applies with --apply', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-format-', packageName: 'format-test' });
  const jsonPath = path.join(root, 'messy.json');
  const textPath = path.join(root, 'messy.md');
  fs.writeFileSync(jsonPath, '{"b":2,"a":1}');
  fs.writeFileSync(textPath, 'hello   \n\n');

  const dryRun = runCli(root, ['format', '--paths', 'messy.json,messy.md', '--json'], { coordinationRoot });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).summary.changedFiles, 2);
  assert.equal(fs.readFileSync(jsonPath, 'utf8'), '{"b":2,"a":1}');

  const check = runCli(root, ['format', '--paths', 'messy.json,messy.md', '--check'], { coordinationRoot });
  const apply = runCli(root, ['format', '--paths', 'messy.json,messy.md', '--apply', '--json'], { coordinationRoot });

  assert.equal(check.status, 1);
  assert.equal(apply.status, 0, apply.stderr);
  assert.equal(fs.readFileSync(jsonPath, 'utf8'), '{\n  "b": 2,\n  "a": 1\n}\n');
  assert.equal(fs.readFileSync(textPath, 'utf8'), 'hello\n');
});

test('format succeeds when files are already normalized', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-format-clean-', packageName: 'format-test' });
  fs.writeFileSync(path.join(root, 'clean.json'), '{\n  "a": 1\n}\n');

  const result = runCli(root, ['format', '--paths', 'clean.json', '--check', '--json'], { coordinationRoot });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary.changedFiles, 0);
});
