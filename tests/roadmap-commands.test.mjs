import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'scripts', 'agent-coordination.mjs');
const validConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'agent-coordination.config.json'), 'utf8'));

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-roadmap-'));
  const coordinationRoot = path.join(root, 'coordination');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(coordinationRoot, 'runtime', 'agent-heartbeats'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agent-coordination.config.json'), `${JSON.stringify(validConfig, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'roadmap-test', scripts: {} }, null, 2));
  return { root, coordinationRoot };
}

function writeBoard(root, board) {
  const coordinationRoot = path.join(root, 'coordination');
  fs.mkdirSync(coordinationRoot, { recursive: true });
  fs.writeFileSync(path.join(coordinationRoot, 'board.json'), `${JSON.stringify(board, null, 2)}\n`);
  fs.writeFileSync(path.join(coordinationRoot, 'journal.md'), '# Journal\n\n');
  fs.writeFileSync(path.join(coordinationRoot, 'messages.ndjson'), '');
}

function run(root, coordinationRoot, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT_COORDINATION_ROOT: coordinationRoot,
      AGENT_COORDINATION_CONFIG: path.join(root, 'agent-coordination.config.json'),
    },
  });
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

  const board = JSON.parse(fs.readFileSync(path.join(coordinationRoot, 'board.json'), 'utf8'));
  assert.equal(Array.isArray(board.agents), true);
  assert.equal(Array.isArray(board.resources), true);
  assert.equal(Array.isArray(board.tasks[0].claimedPaths), true);
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
  assert.equal(typeof JSON.parse(applied.stdout).snapshotPath, 'string');
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
