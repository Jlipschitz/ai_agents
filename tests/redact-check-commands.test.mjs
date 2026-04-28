import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function configurePrivacy(configPath, privacy) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.privacy = { ...(config.privacy ?? {}), ...privacy };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function makeRedactWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-redact-', packageName: 'redact-test' });
  configurePrivacy(workspace.configPath, {
    mode: 'standard',
    offline: false,
    redactPatterns: ['launch-code'],
  });
  writeBoard(workspace.root, {
    projectName: 'Redact Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    agents: [{ id: 'agent-1', status: 'active', taskId: 'task-redact' }],
    tasks: [
      {
        id: 'task-redact',
        status: 'active',
        ownerId: 'agent-1',
        title: 'Check redaction gate',
        summary: 'Use launch-code omega only in local coordination state.',
        claimedPaths: ['src/private.js'],
        verification: ['unit'],
        verificationLog: [{ check: 'unit', outcome: 'pass', details: 'launch-code verified locally' }],
        notes: [{ at: '2026-01-01T00:00:00.000Z', agent: 'agent-1', body: 'Do not export launch-code omega.' }],
      },
    ],
  });
  fs.appendFileSync(path.join(workspace.coordinationRoot, 'journal.md'), 'api_key = "super-secret-production-value"\n');
  return workspace;
}

test('redact-check reports configured patterns and secret rules with redacted previews', () => {
  const { root, coordinationRoot } = makeRedactWorkspace();
  const result = runCli(root, ['redact-check', '--json'], { coordinationRoot });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, false);
  assert.ok(payload.summary.findings >= 2);
  assert.ok(payload.findings.some((finding) => finding.rule === 'generic-secret-assignment'));
  assert.ok(payload.findings.some((finding) => finding.rule === 'redact-pattern' && finding.pattern === 'launch-code'));
  assert.ok(payload.findings.some((finding) => finding.source === 'generated' && finding.path.startsWith('generated:prompt:')));
  assert.ok(payload.findings.some((finding) => finding.source === 'generated' && finding.path.startsWith('generated:handoff-bundle:')));
  assert.ok(payload.findings.every((finding) => finding.preview.includes('[redacted]')));
});

test('redact-check strict mode fails when findings exist', () => {
  const { root, coordinationRoot } = makeRedactWorkspace();
  const result = runCli(root, ['redact-check', '--strict'], { coordinationRoot });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /redact-pattern/);
});

test('redact-check can scan state files without generated prompt sources', () => {
  const { root, coordinationRoot } = makeRedactWorkspace();
  const result = runCli(root, ['redact-check', '--state-only', '--json'], { coordinationRoot });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.stateOnly, true);
  assert.equal(payload.summary.generatedSources, 0);
  assert.ok(payload.findings.every((finding) => finding.source === 'file'));
});

test('redact-check reports clean state when no sensitive patterns are present', () => {
  const workspace = makeWorkspace({ prefix: 'ai-agents-redact-clean-', packageName: 'redact-clean-test' });
  configurePrivacy(workspace.configPath, { redactPatterns: ['launch-code'] });
  writeBoard(workspace.root, {
    projectName: 'Clean Redact Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    agents: [{ id: 'agent-1', status: 'active', taskId: 'task-clean' }],
    tasks: [{ id: 'task-clean', status: 'active', ownerId: 'agent-1', summary: 'Plain coordination work.', verification: [], verificationLog: [] }],
  });

  const result = runCli(workspace.root, ['redact-check', '--json'], { coordinationRoot: workspace.coordinationRoot });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.summary.findings, 0);
});

test('redact-check rejects paths outside the repo root', () => {
  const workspace = makeWorkspace({ prefix: 'ai-agents-redact-paths-', packageName: 'redact-paths-test' });
  writeBoard(workspace.root, {
    projectName: 'Redact Path Test',
    tasks: [],
    agents: [],
  });

  const result = runCli(workspace.root, ['redact-check', '--paths', '..', '--state-only', '--json'], { coordinationRoot: workspace.coordinationRoot });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.summary.fileSources, 0);
  assert.ok(payload.skipped.some((entry) => entry.reason === 'outside-root'));
});
