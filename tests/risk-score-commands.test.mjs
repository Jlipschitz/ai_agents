import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function configureRiskWorkspace(root) {
  const configPath = path.join(root, 'agent-coordination.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.paths.sharedRisk = ['src', 'package.json'];
  config.paths.visualImpact = ['app'];
  config.verification.visualRequiredChecks = ['visual:test'];
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), ['/app/ @frontend', '/api/ @backend', '/src/ @core', ''].join('\n'));
}

test('risk-score ranks risky active work and explains factors', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-risk-score-', packageName: 'risk-score-test' });
  configureRiskWorkspace(root);
  writeBoard(root, {
    projectName: 'Risk Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      {
        id: 'task-risky',
        status: 'blocked',
        ownerId: 'agent-1',
        title: 'Risky task',
        claimedPaths: ['src', 'app/page.js', 'api/route.js'],
        dependencies: ['task-open'],
        verification: ['unit'],
        verificationLog: [{ check: 'unit', outcome: 'fail' }],
        relevantDocs: ['README.md'],
        docsReviewedAt: null,
        priority: 'urgent',
        severity: 'critical',
      },
      { id: 'task-open', status: 'planned', ownerId: null, title: 'Open dependency', claimedPaths: ['docs'], dependencies: [], verification: [], verificationLog: [] },
      { id: 'task-low', status: 'planned', ownerId: null, title: 'Low task', claimedPaths: ['docs/notes.md'], dependencies: [], verification: [], verificationLog: [] },
    ],
  });

  const result = runCli(root, ['risk-score', '--json']);
  const payload = JSON.parse(result.stdout);
  const risky = payload.tasks[0];

  assert.equal(result.status, 0, result.stderr);
  assert.equal(risky.taskId, 'task-risky');
  assert.equal(risky.level, 'critical');
  assert.ok(risky.factors.some((entry) => entry.code === 'broadClaim'));
  assert.ok(risky.factors.some((entry) => entry.code === 'codeownersCrossing'));
  assert.ok(risky.factors.some((entry) => entry.code === 'sharedRiskPath'));
  assert.ok(risky.factors.some((entry) => entry.code === 'openDependency'));
  assert.ok(risky.factors.some((entry) => entry.code === 'failingVerification'));
  assert.ok(risky.factors.some((entry) => entry.code === 'visualVerificationMissing'));
  assert.ok(risky.factors.some((entry) => entry.code === 'docsReviewMissing'));
  assert.equal(payload.summary.critical, 1);
});

test('risk-score filters by task id in text mode', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-risk-score-filter-', packageName: 'risk-score-test' });
  configureRiskWorkspace(root);
  writeBoard(root, {
    projectName: 'Risk Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-one', status: 'active', ownerId: 'agent-1', title: 'Task one', claimedPaths: ['src'], dependencies: [], verification: [], verificationLog: [] },
      { id: 'task-two', status: 'planned', ownerId: null, title: 'Task two', claimedPaths: ['docs'], dependencies: [], verification: [], verificationLog: [] },
    ],
  });

  const result = runCli(root, ['risk-score', 'task-two']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /task-two/);
  assert.doesNotMatch(result.stdout, /task-one/);
});
