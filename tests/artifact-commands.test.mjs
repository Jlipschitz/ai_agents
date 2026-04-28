import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function run(root, coordinationRoot, args) {
  return runCli(root, args, { coordinationRoot });
}

test('artifacts list surfaces missing verification artifact warnings', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-artifacts-' });
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts', 'kept.log'), 'kept');
  writeBoard(root, {
    projectName: 'Artifact Warning Test',
    tasks: [
      {
        id: 'task-artifacts',
        status: 'active',
        verificationLog: [
          {
            check: 'unit',
            outcome: 'pass',
            artifacts: [
              { path: 'artifacts/kept.log', kind: 'log' },
              { path: 'artifacts/missing.log', kind: 'log' },
            ],
          },
        ],
      },
    ],
    resources: [],
    incidents: [],
  });

  const result = run(root, coordinationRoot, ['artifacts', 'list', '--task', 'task-artifacts', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.items.length, 2);
  assert.equal(payload.warnings.length, 1);
  assert.match(payload.warnings[0], /artifacts\/missing\.log/);
  assert.equal(payload.recommendations.length, 1);
});

test('artifacts report is read-only and reports missing verification references', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-artifact-report-' });
  const missingPath = path.join(root, 'artifacts', 'gone.log');
  writeBoard(root, {
    projectName: 'Artifact Report Test',
    tasks: [
      {
        id: 'task-report',
        status: 'done',
        verificationLog: [{ check: 'smoke', outcome: 'pass', artifacts: [{ path: 'artifacts/gone.log', kind: 'log' }] }],
      },
    ],
    resources: [],
    incidents: [],
  });

  const result = run(root, coordinationRoot, ['artifacts', 'report', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.checkedReferences, 1);
  assert.equal(payload.missingReferences.length, 1);
  assert.equal(payload.missingReferences[0].path, 'artifacts/gone.log');
  assert.equal(payload.missingReferences[0].taskId, 'task-report');
  assert.equal(payload.missingReferences[0].check, 'smoke');
  assert.equal(Object.hasOwn(payload.missingReferences[0], 'absolutePath'), false);
  assert.equal(fs.existsSync(missingPath), false);
});
