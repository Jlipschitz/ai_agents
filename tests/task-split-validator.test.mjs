import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function configureSplitWorkspace(root) {
  const configPath = path.join(root, 'agent-coordination.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.paths.sharedRisk = ['package.json', 'src'];
  config.ownership.broadPathPatterns = ['app', 'src', 'components', 'api'];
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

test('split-validate reports overlap, missing dependencies, broad paths, and verification gaps', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-split-validate-', packageName: 'split-validate-test' });
  configureSplitWorkspace(root);
  writeBoard(root, {
    projectName: 'Split Validate Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      {
        id: 'task-wide',
        status: 'planned',
        title: 'Wide change',
        claimedPaths: ['src', 'app/page.tsx', 'api/routes/user.ts', 'docs/spec.md'],
        dependencies: ['task-missing'],
        verification: [],
        verificationLog: [],
      },
      {
        id: 'task-overlap',
        status: 'planned',
        title: 'Overlap',
        claimedPaths: ['src/lib/a.ts'],
        dependencies: [],
        verification: ['unit'],
      },
    ],
  });

  const result = runCli(root, ['split-validate', '--json'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);
  const codes = payload.findings.map((entry) => entry.code);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.ok, false);
  assert.ok(codes.includes('missingDependency'));
  assert.ok(codes.includes('overlappingOwnership'));
  assert.ok(codes.includes('broadClaimedPaths'));
  assert.ok(codes.includes('missingVerification'));
  assert.ok(codes.includes('tooManyCategories'));
});

test('split-validate strict exits non-zero when errors exist', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-split-validate-strict-', packageName: 'split-validate-test' });
  writeBoard(root, {
    projectName: 'Split Validate Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-one', status: 'planned', claimedPaths: ['src/a.ts'], dependencies: ['task-missing'], verification: ['unit'] },
    ],
  });

  const result = runCli(root, ['split-validate', '--strict'], { coordinationRoot });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /missingDependency/);
});
