import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

test('package check script runs recursive syntax checker', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.check, 'node ./scripts/check-syntax.mjs');
  assert.equal(packageJson.scripts.lint, 'node ./scripts/lint.mjs');
  assert.equal(packageJson.scripts['jsdoc:check'], 'node ./scripts/jsdoc-check.mjs');
  assert.equal(packageJson.scripts.test, 'node --test');

  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-syntax.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Syntax OK: \d+ \.mjs file\(s\)\./);
});
