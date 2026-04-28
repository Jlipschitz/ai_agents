import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildJsdocReport, parseJsdocArgs } from '../scripts/jsdoc-check.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

test('jsdoc check passes on repository source files', () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'jsdoc-check.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /JSDoc OK: \d+ file\(s\), \d+ block\(s\)\./);
});

test('jsdoc check reports malformed tags and types', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-jsdoc-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'bad.mjs'), [
    '/**',
    ' * Adds two numbers.',
    ' * @param number left',
    ' * @param {number right',
    ' * @unknown value',
    ' */',
    'export function add(left, right) { return left + right; }',
    '',
  ].join('\n'));

  const report = buildJsdocReport({ root, paths: ['src'] });

  assert.equal(report.ok, false);
  assert.equal(report.filesScanned, 1);
  assert.deepEqual(report.issues.map((issue) => issue.rule), ['jsdoc-type-braces', 'jsdoc-type-braces', 'jsdoc-known-tag']);
});

test('jsdoc arg parser supports path lists and JSON output', () => {
  assert.deepEqual(parseJsdocArgs(['--paths', 'scripts,tests', '--json']), {
    paths: ['scripts', 'tests'],
    json: true,
  });
});
