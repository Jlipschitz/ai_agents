import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { scanTextForSecrets } from '../scripts/lib/secrets-scan-commands.mjs';
import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeSecretsWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-secrets-', packageName: 'secrets-test' });
  const srcRoot = path.join(workspace.root, 'src');
  fs.mkdirSync(srcRoot, { recursive: true });
  fs.writeFileSync(path.join(srcRoot, 'safe.js'), 'const token = "placeholder-token-value";\n');
  fs.writeFileSync(path.join(srcRoot, 'leak.js'), 'const apiKey = "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890";\n');
  fs.writeFileSync(path.join(srcRoot, 'generic.js'), 'password = "super-secret-production-value"\n');
  writeBoard(workspace.root, {
    projectName: 'Secrets Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-secret', status: 'active', ownerId: 'agent-1', claimedPaths: ['src'], verification: [], verificationLog: [] }],
  });
  return workspace;
}

test('secrets-scan reports likely secrets with redacted previews', () => {
  const { root, coordinationRoot } = makeSecretsWorkspace();
  const result = runCli(root, ['secrets-scan', '--paths', 'src', '--json'], { coordinationRoot });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.summary.findings, 2);
  assert.equal(payload.summary.high, 1);
  assert.equal(payload.summary.medium, 1);
  assert.ok(payload.findings.some((finding) => finding.rule === 'openai-key' && finding.path === 'src/leak.js'));
  assert.ok(payload.findings.some((finding) => finding.rule === 'generic-secret-assignment' && finding.path === 'src/generic.js'));
  assert.ok(payload.findings.every((finding) => finding.preview.includes('[redacted]')));
  assert.ok(!payload.findings.some((finding) => finding.path === 'src/safe.js'));
});

test('secrets-scan strict mode fails when findings exist', () => {
  const { root, coordinationRoot } = makeSecretsWorkspace();
  const result = runCli(root, ['secrets-scan', '--paths', 'src/leak.js', '--strict'], { coordinationRoot });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /openai-key/);
});

test('secrets-scan rejects paths outside the repo root', () => {
  const { root, coordinationRoot } = makeSecretsWorkspace();
  const result = runCli(root, ['secrets-scan', '--paths', '..', '--json'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.summary.scannedFiles, 0);
  assert.ok(payload.skipped.some((entry) => entry.reason === 'outside-root'));
});

test('scanTextForSecrets exposes reusable text scanning', () => {
  const findings = scanTextForSecrets('token = "super-secret-production-value"', 'generated:sample');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, 'generated:sample');
  assert.equal(findings[0].rule, 'generic-secret-assignment');
  assert.ok(findings[0].preview.includes('[redacted]'));
});
