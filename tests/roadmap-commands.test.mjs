import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace as makeTestWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeWorkspace() {
  return makeTestWorkspace({ prefix: 'ai-agents-roadmap-', packageName: 'roadmap-test', heartbeatRuntime: true });
}

function run(root, coordinationRoot, args) {
  return runCli(root, args, { coordinationRoot });
}

test('watch-diagnose reports stale runtime state and cleanup-runtime removes it when applied', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const watcherPath = path.join(coordinationRoot, 'runtime', 'watcher.status.json');
  const heartbeatPath = path.join(coordinationRoot, 'runtime', 'agent-heartbeats', 'agent-1.json');
  fs.writeFileSync(watcherPath, JSON.stringify({ pid: 99999999, intervalMs: 1000, lastHeartbeatAt: '2000-01-01T00:00:00.000Z' }, null, 2));
  fs.writeFileSync(heartbeatPath, JSON.stringify({ agentId: 'agent-1', pid: 99999999, intervalMs: 1000, lastHeartbeatAt: '2000-01-01T00:00:00.000Z' }, null, 2));

  const diagnose = run(root, coordinationRoot, ['watch-diagnose', '--json', '--stale-ms', '1000']);
  assert.equal(diagnose.status, 1);
  const report = JSON.parse(diagnose.stdout);
  assert.equal(report.watcher.stale, true);
  assert.equal(report.heartbeats[0].stale, true);

  const dryRun = run(root, coordinationRoot, ['cleanup-runtime', '--json', '--stale-ms', '1000']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(fs.existsSync(watcherPath), true);
  assert.equal(JSON.parse(dryRun.stdout).candidates.length, 2);

  const applied = run(root, coordinationRoot, ['cleanup-runtime', '--apply', '--json', '--stale-ms', '1000']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(fs.existsSync(watcherPath), false);
  assert.equal(fs.existsSync(heartbeatPath), false);
});

test('inspect-board and repair-board handle safe board normalization', () => {
  const { root, coordinationRoot } = makeWorkspace();
  writeBoard(root, {
    projectName: 'Roadmap Test',
    tasks: [
      { id: 'task-one', status: 'active', ownerId: 'agent-1' },
    ],
    resources: {},
  });

  const inspectBefore = run(root, coordinationRoot, ['inspect-board', '--json']);
  assert.equal(inspectBefore.status, 1);
  const beforePayload = JSON.parse(inspectBefore.stdout);
  assert.ok(beforePayload.warnings.some((entry) => entry.includes('agents')));
  assert.ok(beforePayload.findings.some((entry) => entry.includes('unknown agent')));

  const repair = run(root, coordinationRoot, ['repair-board', '--apply', '--json']);
  assert.equal(repair.status, 0, repair.stderr);
  const repairPayload = JSON.parse(repair.stdout);
  assert.ok(repairPayload.changes.some((entry) => entry.includes('initialized agents')));
  assert.equal(typeof repairPayload.snapshotPath, 'string');
  assert.equal(fs.existsSync(repairPayload.workspaceSnapshotPath), true);

  const board = JSON.parse(fs.readFileSync(path.join(coordinationRoot, 'board.json'), 'utf8'));
  assert.equal(Array.isArray(board.agents), true);
  assert.equal(Array.isArray(board.resources), true);
  assert.equal(Array.isArray(board.tasks[0].claimedPaths), true);
});

test('inspect-board reports nested active path overlaps', () => {
  const { root, coordinationRoot } = makeWorkspace();
  writeBoard(root, {
    projectName: 'Overlap Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: 'active', taskId: 'task-parent' },
      { id: 'agent-2', status: 'active', taskId: 'task-child' },
    ],
    tasks: [
      { id: 'task-parent', status: 'active', ownerId: 'agent-1', title: 'Parent claim', claimedPaths: ['src'] },
      { id: 'task-child', status: 'active', ownerId: 'agent-2', title: 'Child claim', claimedPaths: ['src/file.js'] },
    ],
    resources: [],
    incidents: [],
  });

  const result = run(root, coordinationRoot, ['inspect-board', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.ok(payload.findings.some((entry) => entry.includes('Active path overlap')));
});

test('migrate-board dry-runs and applies board schema migrations', () => {
  const { root, coordinationRoot } = makeWorkspace();
  writeBoard(root, {
    version: 1,
    projectName: 'Board Migration Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: 'active', taskId: 'task-old' },
      { id: 'agent-1', status: 'idle', taskId: null },
      { id: 'agent-custom', status: 'active', taskId: 'task-custom', updatedAt: '2026-01-01T00:00:00.000Z' },
      null,
    ],
    tasks: [
      { id: 'task-old', status: 'active', ownerId: 'agent-1', claimedPaths: ['src/old'] },
      { id: 'task-custom', status: 'active', ownerId: 'agent-custom', claimedPaths: ['custom'] },
    ],
    resources: [],
    incidents: [],
  });
  const boardPath = path.join(coordinationRoot, 'board.json');
  const before = fs.readFileSync(boardPath, 'utf8');

  const dryRun = run(root, coordinationRoot, ['migrate-board', '--json']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const dryRunPayload = JSON.parse(dryRun.stdout);
  assert.equal(dryRunPayload.applied, false);
  assert.equal(dryRunPayload.sourceVersion, 1);
  assert.equal(dryRunPayload.targetVersion, 2);
  assert.ok(dryRunPayload.changes.some((entry) => entry.includes('set version 2')));
  assert.equal(fs.readFileSync(boardPath, 'utf8'), before);

  const applied = run(root, coordinationRoot, ['migrate-board', '--apply', '--json']);
  assert.equal(applied.status, 0, applied.stderr);
  const appliedPayload = JSON.parse(applied.stdout);
  const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
  const auditPath = path.join(coordinationRoot, 'runtime', 'audit.ndjson');

  assert.equal(appliedPayload.applied, true);
  assert.equal(board.version, 2);
  assert.equal(board.workspace, 'coordination');
  assert.equal(Array.isArray(board.plans), true);
  assert.equal(Array.isArray(board.approvals), true);
  assert.equal(typeof board.createdAt, 'string');
  assert.equal(board.tasks[0].effort, 'unknown');
  assert.equal(board.tasks[0].priority, 'normal');
  assert.equal(board.tasks[0].dueAt, null);
  assert.equal(board.tasks[0].severity, 'none');
  assert.equal(board.tasks[0].lastOwnerId, 'agent-1');
  assert.equal(board.agents[0].taskId, 'task-old');
  assert.equal(board.agents.filter((agent) => agent?.id === 'agent-1').length, 2);
  assert.equal(board.agents.some((agent) => agent?.id === 'agent-custom'), true);
  assert.equal(board.agents.includes(null), true);
  assert.equal(board.tasks.find((task) => task.id === 'task-custom').ownerId, 'agent-custom');
  assert.equal(fs.existsSync(appliedPayload.workspaceSnapshotPath), true);
  assert.equal(fs.existsSync(appliedPayload.snapshotPath), true);
  assert.match(fs.readFileSync(auditPath, 'utf8'), /"command":"migrate-board"/);
});

test('rollback-state restores a board snapshot', () => {
  const { root, coordinationRoot } = makeWorkspace();
  writeBoard(root, { projectName: 'Rollback Test', tasks: [], resources: [], incidents: [], updatedAt: '2026-01-01T00:00:00.000Z' });
  const repair = run(root, coordinationRoot, ['repair-board', '--apply', '--json']);
  const snapshotPath = JSON.parse(repair.stdout).snapshotPath;
  const boardPath = path.join(coordinationRoot, 'board.json');
  fs.writeFileSync(boardPath, JSON.stringify({ projectName: 'Changed', tasks: [{ id: 'changed', status: 'planned' }] }, null, 2));

  const rollback = run(root, coordinationRoot, ['rollback-state', '--to', snapshotPath, '--apply', '--json']);
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(fs.existsSync(JSON.parse(rollback.stdout).workspaceSnapshotPath), true);
  const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
  assert.equal(board.projectName, 'Rollback Test');
});

test('release-check gates done tasks on verification and docs review', () => {
  const { root, coordinationRoot } = makeWorkspace();
  writeBoard(root, {
    projectName: 'Release Test',
    tasks: [
      { id: 'task-blocked', status: 'done', verification: ['unit'], verificationLog: [], relevantDocs: ['README.md'] },
      { id: 'task-ready', status: 'done', verification: ['unit'], verificationLog: [{ check: 'unit', outcome: 'pass' }], relevantDocs: ['README.md'], docsReviewedAt: '2026-01-01T00:00:00.000Z' },
    ],
    resources: [],
    incidents: [],
  });

  const blocked = run(root, coordinationRoot, ['release-check', 'task-blocked', '--json']);
  assert.equal(blocked.status, 1);
  assert.equal(JSON.parse(blocked.stdout).checks[0].ok, false);

  const ready = run(root, coordinationRoot, ['release-check', 'task-ready', '--json']);
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(JSON.parse(ready.stdout).checks[0].ok, true);

  const readyText = run(root, coordinationRoot, ['release-check', 'task-ready']);
  assert.equal(readyText.status, 0, readyText.stderr);
  assert.match(readyText.stdout, /# Release Check/);
  assert.match(readyText.stdout, /task-ready: ready/);

  const missingText = run(root, coordinationRoot, ['release-check', 'fake-task']);
  assert.equal(missingText.status, 1);
  assert.match(missingText.stdout, /fake-task: blocked/);
  assert.match(missingText.stdout, /Task fake-task was not found/);

  const missingJson = run(root, coordinationRoot, ['release-check', 'fake-task', '--json']);
  assert.equal(missingJson.status, 1);
  assert.equal(JSON.parse(missingJson.stdout).checks[0].findings[0], 'Task fake-task was not found.');
});

test('run-check captures command output artifacts', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const artifactDir = path.join(root, 'check-artifacts');
  const result = run(root, coordinationRoot, ['run-check', 'smoke', '--artifact-dir', artifactDir, '--json', '--', process.execPath, '-e', 'console.log("smoke ok")']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.exitCode, 0);
  assert.equal(fs.existsSync(payload.artifactPath), true);
  assert.match(fs.readFileSync(payload.artifactPath, 'utf8'), /smoke ok/);
  assert.equal(fs.existsSync(path.join(artifactDir, 'index.ndjson')), true);
});

test('run-check captures visual artifact root diffs and classifications', () => {
  const { root, coordinationRoot, configPath } = makeWorkspace();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.verification.visualRequiredChecks = ['visual:test'];
  config.checks = {
    ...config.checks,
    'visual:test': {
      command: 'npm run visual:test',
      artifactRoots: ['playwright-report', 'test-results'],
      requireArtifacts: true,
    },
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  fs.mkdirSync(path.join(root, 'playwright-report'), { recursive: true });
  fs.writeFileSync(path.join(root, 'playwright-report', 'index.html'), 'before');

  const script = [
    'const fs = require("fs");',
    'const path = require("path");',
    'fs.mkdirSync("playwright-report", { recursive: true });',
    'fs.writeFileSync(path.join("playwright-report", "index.html"), "after-report");',
    'fs.mkdirSync("test-results", { recursive: true });',
    'fs.writeFileSync(path.join("test-results", "home.png"), "fake png");',
  ].join(' ');
  const result = run(root, coordinationRoot, ['run-check', 'visual:test', '--task', 'task-ui', '--json', '--', process.execPath, '-e', script]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.checkType, 'visual');
  assert.equal(payload.taskId, 'task-ui');
  assert.deepEqual(payload.visualArtifacts.counts, { added: 1, modified: 1, deleted: 0, changed: 2 });
  assert.equal(payload.visualArtifacts.added[0].path, 'test-results/home.png');
  assert.equal(payload.visualArtifacts.added[0].kind, 'image');
  assert.equal(payload.visualArtifacts.modified[0].path, 'playwright-report/index.html');
  assert.equal(payload.visualArtifacts.modified[0].kind, 'report');

  const list = run(root, coordinationRoot, ['artifacts', 'list', '--task', 'task-ui', '--check', 'visual:test', '--json']);
  assert.equal(list.status, 0, list.stderr);
  const items = JSON.parse(list.stdout).items;
  assert.ok(items.some((entry) => entry.source === 'run-check-artifact' && entry.path === 'test-results/home.png' && entry.kind === 'image'));
  assert.ok(items.some((entry) => entry.source === 'run-check-artifact' && entry.path === 'playwright-report/index.html' && entry.kind === 'report'));
});

test('verify attaches artifact metadata and artifacts commands report it', () => {
  const { root, coordinationRoot } = makeWorkspace();
  writeBoard(root, {
    projectName: 'Artifact Test',
    agents: [{ id: 'agent-1', status: 'active', taskId: 'task-one' }],
    tasks: [{ id: 'task-one', status: 'active', ownerId: 'agent-1', verification: [], verificationLog: [], claimedPaths: ['src/a'] }],
    resources: [],
    incidents: [],
  });
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts', 'evidence.log'), 'evidence');

  const verify = run(root, coordinationRoot, ['verify', 'agent-1', 'task-one', 'unit', 'pass', 'npm test passed', '--artifact', 'artifacts/evidence.log']);
  assert.equal(verify.status, 0, verify.stderr);

  const board = JSON.parse(fs.readFileSync(path.join(coordinationRoot, 'board.json'), 'utf8'));
  assert.equal(board.tasks[0].verificationLog[0].artifacts[0].path, 'artifacts/evidence.log');

  const list = run(root, coordinationRoot, ['artifacts', 'list', '--task', 'task-one', '--json']);
  assert.equal(list.status, 0, list.stderr);
  assert.equal(JSON.parse(list.stdout).items[0].path, 'artifacts/evidence.log');

  const inspect = run(root, coordinationRoot, ['artifacts', 'inspect', 'artifacts/evidence.log', '--json']);
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.equal(JSON.parse(inspect.stdout).references.length, 1);
});

test('graph and ownership-map expose dependencies and path overlaps', () => {
  const { root, coordinationRoot } = makeWorkspace();
  writeBoard(root, {
    projectName: 'Graph Test',
    agents: [{ id: 'agent-1', status: 'active', taskId: 'task-api' }, { id: 'agent-2', status: 'active', taskId: 'task-ui' }],
    tasks: [
      { id: 'task-api', status: 'active', ownerId: 'agent-1', title: 'API', claimedPaths: ['src/api'] },
      { id: 'task-ui', status: 'active', ownerId: 'agent-2', title: 'UI', claimedPaths: ['src/api/routes'], dependencies: ['task-api'] },
    ],
    resources: [],
    incidents: [],
  });

  const graph = run(root, coordinationRoot, ['graph']);
  assert.equal(graph.status, 0, graph.stderr);
  assert.match(graph.stdout, /task_task_api --> task_task_ui/);

  const ownership = run(root, coordinationRoot, ['ownership-map', '--json']);
  assert.equal(ownership.status, 1);
  const payload = JSON.parse(ownership.stdout);
  assert.equal(payload.owners.length, 2);
  assert.equal(payload.overlaps[0].leftTaskId, 'task-api');
});

test('pr-summary and release-bundle generate release handoff output', () => {
  const { root, coordinationRoot } = makeWorkspace();
  writeBoard(root, {
    projectName: 'Release Bundle Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      {
        id: 'task-ready',
        status: 'done',
        title: 'Ship ready task',
        summary: 'Implemented ready task.',
        claimedPaths: ['src/ready'],
        verification: ['unit'],
        verificationLog: [{ check: 'unit', outcome: 'pass', details: 'npm test', artifacts: [{ path: 'artifacts/unit.log', kind: 'log', sizeBytes: 12 }] }],
        relevantDocs: ['README.md'],
        docsReviewedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    resources: [],
    incidents: [],
  });

  const summary = run(root, coordinationRoot, ['pr-summary', 'task-ready', '--json']);
  assert.equal(summary.status, 0, summary.stderr);
  assert.equal(JSON.parse(summary.stdout).tasks[0].id, 'task-ready');

  const outputRoot = path.join(root, 'release-bundle');
  const bundle = run(root, coordinationRoot, ['release-bundle', 'task-ready', '--out-dir', outputRoot, '--apply', '--json']);
  assert.equal(bundle.status, 0, bundle.stderr);
  assert.equal(fs.existsSync(path.join(outputRoot, 'pr-summary.md')), true);
  assert.equal(fs.existsSync(path.join(outputRoot, 'release-check.json')), true);
});

test('migrate-config dry-runs and applies versioned defaults', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const configPath = path.join(root, 'agent-coordination.config.json');
  const oldConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  delete oldConfig.configVersion;
  delete oldConfig.artifacts;
  delete oldConfig.checks;
  fs.writeFileSync(configPath, `${JSON.stringify(oldConfig, null, 2)}\n`);
  const before = fs.readFileSync(configPath, 'utf8');

  const dryRun = run(root, coordinationRoot, ['migrate-config', '--json']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const dryRunPayload = JSON.parse(dryRun.stdout);
  assert.equal(dryRunPayload.applied, false);
  assert.ok(dryRunPayload.changes.some((entry) => entry.path === 'configVersion'));
  assert.equal(fs.readFileSync(configPath, 'utf8'), before);

  const applied = run(root, coordinationRoot, ['migrate-config', '--apply', '--json']);
  assert.equal(applied.status, 0, applied.stderr);
  const nextConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(nextConfig.configVersion, 1);
  assert.deepEqual(nextConfig.artifacts.roots, ['artifacts']);
  const appliedPayload = JSON.parse(applied.stdout);
  assert.equal(typeof appliedPayload.snapshotPath, 'string');
  assert.equal(fs.existsSync(appliedPayload.workspaceSnapshotPath), true);
});

test('policy-packs list, inspect, dry-run, and apply reusable config patches', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const configPath = path.join(root, 'agent-coordination.config.json');

  const list = run(root, coordinationRoot, ['policy-packs', 'list', '--json']);
  assert.equal(list.status, 0, list.stderr);
  assert.ok(JSON.parse(list.stdout).packs.some((entry) => entry.name === 'strict-ui'));

  const inspect = run(root, coordinationRoot, ['policy-packs', 'inspect', 'strict-ui', '--json']);
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.equal(JSON.parse(inspect.stdout).name, 'strict-ui');

  const dryRun = run(root, coordinationRoot, ['policy-packs', 'apply', 'strict-ui', '--json']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.ok(JSON.parse(dryRun.stdout).changes.some((entry) => entry.path === 'git.allowMainBranchClaims'));
  assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).git.allowMainBranchClaims, true);

  const applied = run(root, coordinationRoot, ['policy-packs', 'apply', 'strict-ui', '--apply', '--json']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(fs.existsSync(JSON.parse(applied.stdout).workspaceSnapshotPath), true);
  const nextConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(nextConfig.git.allowMainBranchClaims, false);
  assert.equal(nextConfig.checks['visual:test'].requireArtifacts, true);
});

test('artifacts prune dry-runs and applies retention safely', () => {
  const { root, coordinationRoot } = makeWorkspace();
  const artifactRoot = path.join(root, 'artifacts');
  const oldPath = path.join(artifactRoot, 'old.log');
  const activePath = path.join(artifactRoot, 'active.log');
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(oldPath, 'old');
  fs.writeFileSync(activePath, 'active');
  const oldDate = new Date('2020-01-01T00:00:00.000Z');
  fs.utimesSync(oldPath, oldDate, oldDate);
  fs.utimesSync(activePath, oldDate, oldDate);
  writeBoard(root, {
    projectName: 'Prune Test',
    agents: [{ id: 'agent-1', status: 'active', taskId: 'task-active' }],
    tasks: [
      {
        id: 'task-active',
        status: 'active',
        ownerId: 'agent-1',
        verificationLog: [{ check: 'unit', outcome: 'pass', artifacts: [{ path: 'artifacts/active.log' }] }],
      },
    ],
    resources: [],
    incidents: [],
  });

  const dryRun = run(root, coordinationRoot, ['artifacts', 'prune', '--json']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const dryRunPayload = JSON.parse(dryRun.stdout);
  assert.ok(dryRunPayload.candidates.some((entry) => entry.path === 'artifacts/old.log'));
  assert.equal(dryRunPayload.candidates.some((entry) => entry.path === 'artifacts/active.log'), false);
  assert.equal(fs.existsSync(oldPath), true);

  const applied = run(root, coordinationRoot, ['artifacts', 'prune', '--apply', '--json']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(fs.existsSync(oldPath), false);
  assert.equal(fs.existsSync(activePath), true);
});
