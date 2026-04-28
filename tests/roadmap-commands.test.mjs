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
