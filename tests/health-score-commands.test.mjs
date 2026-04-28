import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function configureHealthWorkspace(root, coordinationRoot) {
  const configPath = path.join(root, 'agent-coordination.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.docs.roots = ['docs', 'missing-docs'];
  config.paths.sharedRisk = ['src', 'package.json'];
  config.paths.visualImpact = ['app'];
  config.verification.visualRequiredChecks = ['visual:test'];
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  fs.mkdirSync(path.join(coordinationRoot, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(coordinationRoot, 'runtime', 'watcher.status.json'), `${JSON.stringify({ pid: 999999, updatedAt: '2000-01-01T00:00:00.000Z' }, null, 2)}\n`);
}

test('health-score reports setup, work, verification, and runtime issues', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-health-score-', packageName: 'health-score-test', runtime: true });
  configureHealthWorkspace(root, coordinationRoot);
  writeBoard(root, {
    projectName: 'Health Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      {
        id: 'task-risky',
        status: 'blocked',
        ownerId: 'agent-1',
        title: 'Risky task',
        claimedPaths: ['src', 'app/page.js'],
        dependencies: ['task-missing'],
        verification: ['unit'],
        verificationLog: [{ check: 'unit', outcome: 'fail' }],
        relevantDocs: ['README.md'],
        docsReviewedAt: null,
        priority: 'urgent',
        severity: 'critical',
        updatedAt: '2000-01-01T00:00:00.000Z',
      },
      { id: 'task-ready', status: 'planned', ownerId: null, title: 'Ready task', claimedPaths: ['docs'], dependencies: [], verification: [], verificationLog: [] },
    ],
  });

  const result = runCli(root, ['health-score', '--json'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);
  const issueCodes = payload.issues.map((entry) => entry.code);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.maxScore, 100);
  assert.equal(payload.level === 'healthy', false);
  assert.ok(payload.score < 90);
  assert.ok(issueCodes.includes('criticalRiskTasks'));
  assert.ok(issueCodes.includes('failingVerification'));
  assert.ok(issueCodes.includes('missingDocsRoots'));
  assert.ok(issueCodes.includes('missingPackageScripts'));
  assert.ok(issueCodes.includes('staleWatcher'));
  assert.equal(payload.sections.setup.issues.some((entry) => entry.code === 'missingDocsRoots'), true);
  assert.equal(payload.signals.criticalPath.taskIds.includes('task-risky'), true);
});

test('health-score can fail under a configured threshold', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-health-score-threshold-', packageName: 'health-score-test' });
  writeBoard(root, {
    projectName: 'Health Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-one', status: 'planned', ownerId: null, title: 'Task one', claimedPaths: ['docs'], dependencies: [], verification: [], verificationLog: [] },
    ],
  });

  const result = runCli(root, ['health-score', '--fail-under', '101'], { coordinationRoot });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Score:/);
  assert.match(result.stdout, /Fail under: 101/);
});
