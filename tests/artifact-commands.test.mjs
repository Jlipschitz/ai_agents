import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, snapshotFiles, writeBoard } from './helpers/workspace.mjs';

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

test('artifacts rebuild-index is a dry run by default', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-artifact-index-dry-run-' });
  const artifactPath = path.join(root, 'artifacts', 'checks', 'smoke.log');
  const indexPath = path.join(root, 'artifacts', 'checks', 'index.ndjson');
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, 'smoke output');
  fs.writeFileSync(indexPath, '{"artifactPath":"artifacts/checks/old.log"}\n');
  const before = snapshotFiles([indexPath]);

  const result = run(root, coordinationRoot, ['artifacts', 'rebuild-index', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.applied, false);
  assert.equal(payload.indexPath, 'artifacts/checks/index.ndjson');
  assert.equal(payload.entryCount, 1);
  assert.equal(payload.entries[0].artifactPath, 'artifacts/checks/smoke.log');
  assert.equal(payload.entries[0].artifactKind, 'log');
  assert.deepEqual(snapshotFiles([indexPath]), before);
});

test('artifacts rebuild-index --apply writes index for configured roots', () => {
  const { root, coordinationRoot, configPath } = makeWorkspace({ prefix: 'ai-agents-artifact-index-apply-' });
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.artifacts = { ...config.artifacts, roots: ['custom-artifacts', '../outside-artifacts'] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  fs.mkdirSync(path.join(root, 'custom-artifacts', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'custom-artifacts', 'nested', 'result.json'), '{"ok":true}\n');
  fs.writeFileSync(path.join(root, 'custom-artifacts', 'screen.png'), 'not really a png');
  const indexPath = path.join(root, 'artifacts', 'checks', 'index.ndjson');

  const result = run(root, coordinationRoot, ['artifacts', 'rebuild-index', '--apply', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.applied, true);
  assert.equal(payload.entryCount, 2);
  assert.equal(payload.roots.find((rootInfo) => rootInfo.root === '../outside-artifacts')?.skipped, true);
  assert.equal(fs.existsSync(indexPath), true);

  const entries = fs.readFileSync(indexPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.deepEqual(entries.map((entry) => entry.artifactPath), ['custom-artifacts/nested/result.json', 'custom-artifacts/screen.png']);
  assert.deepEqual(entries.map((entry) => entry.artifactKind), ['json', 'image']);

  const listResult = run(root, coordinationRoot, ['artifacts', 'list', '--json']);
  assert.equal(listResult.status, 0, listResult.stderr);
  const listPayload = JSON.parse(listResult.stdout);
  assert.deepEqual(
    listPayload.items.map((item) => item.path),
    ['custom-artifacts/nested/result.json', 'custom-artifacts/screen.png']
  );
});
