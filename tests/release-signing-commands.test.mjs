import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeSigningKeys(root) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privateKeyPath = path.join(root, 'keys', 'release-private.pem');
  const publicKeyPath = path.join(root, 'keys', 'release-public.pem');
  writeFile(privateKeyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }));
  writeFile(publicKeyPath, publicKey.export({ format: 'pem', type: 'spki' }));
  return { privateKeyPath, publicKeyPath };
}

test('release-sign writes checksum manifests and verifies signatures', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-release-sign-', packageName: 'release-sign-test' });
  const { privateKeyPath, publicKeyPath } = writeSigningKeys(root);
  const releaseRoot = path.join(root, 'release');
  writeFile(path.join(releaseRoot, 'notes.md'), '# Release\n');
  writeFile(path.join(releaseRoot, 'data', 'release-check.json'), '{"ok":true}\n');

  const dryRun = runCli(root, ['release-sign', '--dir', releaseRoot, '--private-key', privateKeyPath, '--json'], { coordinationRoot });
  const dryPayload = JSON.parse(dryRun.stdout);

  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(dryPayload.applied, false);
  assert.equal(dryPayload.signature.algorithm, 'ed25519');
  assert.equal(fs.existsSync(path.join(releaseRoot, 'checksums.sha256')), false);

  const applied = runCli(root, ['release-sign', '--dir', releaseRoot, '--private-key', privateKeyPath, '--apply', '--json'], { coordinationRoot });
  const appliedPayload = JSON.parse(applied.stdout);

  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(appliedPayload.applied, true);
  assert.equal(fs.existsSync(path.join(releaseRoot, 'checksums.sha256')), true);
  assert.equal(fs.existsSync(path.join(releaseRoot, 'checksums.sha256.sig')), true);

  const verified = runCli(root, ['release-sign', '--dir', releaseRoot, '--verify', '--public-key', publicKeyPath, '--json'], { coordinationRoot });
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).verification.signature.verified, true);

  fs.writeFileSync(path.join(releaseRoot, 'notes.md'), '# Tampered\n');
  const tampered = runCli(root, ['release-sign', '--dir', releaseRoot, '--verify', '--public-key', publicKeyPath, '--json'], { coordinationRoot });
  assert.equal(tampered.status, 1);
  assert.ok(JSON.parse(tampered.stdout).verification.findings.some((entry) => entry.includes('Checksum mismatch')));
});

test('release-sign verification rejects unsigned added files', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-release-sign-extra-', packageName: 'release-sign-test' });
  const { privateKeyPath, publicKeyPath } = writeSigningKeys(root);
  const releaseRoot = path.join(root, 'release');
  writeFile(path.join(releaseRoot, 'notes.md'), '# Release\n');

  const applied = runCli(root, ['release-sign', '--dir', releaseRoot, '--private-key', privateKeyPath, '--apply', '--json'], { coordinationRoot });
  assert.equal(applied.status, 0, applied.stderr);

  writeFile(path.join(releaseRoot, 'extra.txt'), 'late addition\n');
  const verified = runCli(root, ['release-sign', '--dir', releaseRoot, '--verify', '--public-key', publicKeyPath, '--json'], { coordinationRoot });
  const payload = JSON.parse(verified.stdout);

  assert.equal(verified.status, 1);
  assert.ok(payload.verification.findings.some((entry) => entry.includes('Unsigned file')));
});

test('release-bundle can write signed release artifacts', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-release-bundle-sign-', packageName: 'release-sign-test' });
  const { privateKeyPath, publicKeyPath } = writeSigningKeys(root);
  writeBoard(root, {
    projectName: 'Signed Release Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      {
        id: 'task-ready',
        status: 'done',
        title: 'Ship ready task',
        summary: 'Implemented ready task.',
        claimedPaths: ['src/ready'],
        verification: ['unit'],
        verificationLog: [{ check: 'unit', outcome: 'pass', details: 'npm test' }],
        relevantDocs: ['README.md'],
        docsReviewedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    resources: [],
    incidents: [],
  });

  const outputRoot = path.join(root, 'signed-release');
  const bundle = runCli(root, ['release-bundle', 'task-ready', '--out-dir', outputRoot, '--sign', '--private-key', privateKeyPath, '--apply', '--json'], { coordinationRoot });
  const payload = JSON.parse(bundle.stdout);

  assert.equal(bundle.status, 0, bundle.stderr);
  assert.equal(payload.signing.signature.algorithm, 'ed25519');
  assert.equal(fs.existsSync(path.join(outputRoot, 'checksums.sha256')), true);
  assert.equal(fs.existsSync(path.join(outputRoot, 'checksums.sha256.sig')), true);

  const verified = runCli(root, ['release-sign', '--dir', outputRoot, '--verify', '--public-key', publicKeyPath, '--json'], { coordinationRoot });
  assert.equal(verified.status, 0, verified.stderr);
});
