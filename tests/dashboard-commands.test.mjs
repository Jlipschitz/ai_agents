import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeDashboardWorkspace(prefix, projectName, taskStatus = 'active') {
  const workspace = makeWorkspace({ prefix, packageName: projectName.toLowerCase().replace(/\s+/g, '-') });
  writeBoard(workspace.root, {
    projectName,
    updatedAt: '2026-01-01T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: taskStatus, taskId: `${projectName}-task` },
      { id: 'agent-2', status: 'idle', taskId: null },
    ],
    tasks: [
      {
        id: `${projectName}-task`,
        status: taskStatus,
        ownerId: 'agent-1',
        title: `Build ${projectName}`,
        claimedPaths: [`packages/${projectName}/src`],
        updatedAt: '2000-01-01T00:00:00.000Z',
      },
      {
        id: `${projectName}-planned`,
        status: 'planned',
        ownerId: null,
        title: `Plan ${projectName}`,
        claimedPaths: [],
      },
    ],
    resources: [],
    incidents: [],
  });
  fs.appendFileSync(path.join(workspace.coordinationRoot, 'messages.ndjson'), `${JSON.stringify({
    at: '2026-01-01T00:00:00.000Z',
    from: 'agent-1',
    to: 'all',
    taskId: `${projectName}-task`,
    body: `${projectName} status update`,
  })}\n`);
  return workspace;
}

test('dashboard aggregates active work across multiple repos', () => {
  const one = makeDashboardWorkspace('ai-agents-dashboard-one-', 'RepoOne', 'active');
  const two = makeDashboardWorkspace('ai-agents-dashboard-two-', 'RepoTwo', 'blocked');
  const result = runCli(one.root, ['dashboard', '--repos', `${one.root},${two.root}`, '--json'], { coordinationRoot: one.coordinationRoot });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.repos.length, 2);
  assert.equal(payload.totals.activeWork, 2);
  assert.equal(payload.totals.blockers, 1);
  assert.equal(payload.repos[1].blockers[0].id, 'RepoTwo-task');
  assert.equal(payload.repos[0].recentMessages[0].body, 'RepoOne status update');
});

test('dashboard text mode shows agents, claimed paths, blockers, and messages', () => {
  const workspace = makeDashboardWorkspace('ai-agents-dashboard-text-', 'RepoText', 'waiting');
  const result = runCli(workspace.root, ['dashboard'], { coordinationRoot: workspace.coordinationRoot });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Coordination Dashboard/);
  assert.match(result.stdout, /agent-1/);
  assert.match(result.stdout, /packages\/RepoText\/src/);
  assert.match(result.stdout, /Blockers:/);
  assert.match(result.stdout, /RepoText status update/);
});

test('dashboard web writes local HTML only when applied', () => {
  const workspace = makeDashboardWorkspace('ai-agents-dashboard-web-', 'RepoWeb', 'review');
  const outputPath = path.join(workspace.root, 'artifacts', 'dashboards', 'index.html');
  const dryRun = runCli(workspace.root, ['dashboard', 'web', '--out', outputPath, '--json'], { coordinationRoot: workspace.coordinationRoot });
  const dryPayload = JSON.parse(dryRun.stdout);

  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(dryPayload.applied, false);
  assert.equal(fs.existsSync(outputPath), false);

  const applied = runCli(workspace.root, ['dashboard', 'web', '--out', outputPath, '--apply', '--json'], { coordinationRoot: workspace.coordinationRoot });
  const html = fs.readFileSync(outputPath, 'utf8');

  assert.equal(applied.status, 0, applied.stderr);
  assert.match(html, /AI Agents Dashboard/);
  assert.match(html, /RepoWeb/);
  assert.match(html, /Messages/);
});

test('dashboard reports missing boards and can fail strict mode', () => {
  const workspace = makeWorkspace({ prefix: 'ai-agents-dashboard-missing-', packageName: 'dashboard-missing' });
  const normal = runCli(workspace.root, ['dashboard', '--json'], { coordinationRoot: workspace.coordinationRoot });
  const strict = runCli(workspace.root, ['dashboard', '--json', '--strict'], { coordinationRoot: workspace.coordinationRoot });

  assert.equal(normal.status, 1);
  assert.equal(strict.status, 1);
  assert.match(JSON.parse(normal.stdout).repos[0].error, /Missing board\.json/);
});
