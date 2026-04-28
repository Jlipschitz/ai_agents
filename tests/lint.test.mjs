import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildLintReport, parseLintArgs } from '../scripts/lint.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

test('lint script passes on repository source files', () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'lint.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Lint OK: \d+ file\(s\)\./);
});

test('lint reports unresolved relative imports and bare core imports', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-lint-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'bad.mjs'), [
    "import fs from 'fs';",
    "import './missing.mjs';",
    '',
  ].join('\n'));

  const report = buildLintReport({ root, paths: ['src'] });

  assert.equal(report.ok, false);
  assert.equal(report.filesScanned, 1);
  assert.deepEqual(report.issues.map((issue) => issue.rule), ['node-protocol-import', 'relative-import-exists']);
});

test('lint arg parser supports path lists and JSON output', () => {
  assert.deepEqual(parseLintArgs(['--paths', 'scripts,tests', '--json']), {
    paths: ['scripts', 'tests'],
    json: true,
  });
});
