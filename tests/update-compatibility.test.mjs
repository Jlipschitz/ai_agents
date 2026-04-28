import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { repoRoot, runCli } from './helpers/workspace.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const oldInstallFixture = path.join(__dirname, 'fixtures', 'old-install');

function makeOldInstallWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-old-install-'));
  fs.cpSync(oldInstallFixture, root, { recursive: true });
  return root;
}

function readText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readRepoText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('update-coordinator upgrades an old install while preserving local state', () => {
  const root = makeOldInstallWorkspace();
  const preserved = {
    packageJson: readText(root, 'package.json'),
    config: readText(root, 'agent-coordination.config.json'),
    docs: readText(root, 'docs/commands.md'),
    runtimeLock: readText(root, 'coordination/runtime/state.lock.json'),
    board: readText(root, 'coordination/board.json'),
  };

  const dryRun = runCli(root, ['update-coordinator', '--source', repoRoot, '--json']);
  const dryPayload = JSON.parse(dryRun.stdout);

  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(dryPayload.applied, false);
  assert.equal(dryPayload.counts.update > 0, true);
  assert.equal(dryPayload.counts.create > 0, true);
  assert.match(readText(root, 'scripts/agent-command-layer.mjs'), /old command layer/);
  assert.equal(fs.existsSync(path.join(root, 'scripts/lib/package-script-manifest.mjs')), false);

  const applied = runCli(root, ['update-coordinator', '--source', repoRoot, '--apply', '--reviewed', '--json']);
  const payload = JSON.parse(applied.stdout);

  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(payload.applied, true);
  assert.equal(payload.reviewAcknowledged, true);
  assert.equal(payload.includeDocs, false);
  assert.equal(payload.counts.update > 0, true);
  assert.equal(payload.counts.create > 0, true);

  assert.equal(readText(root, 'scripts/agent-command-layer.mjs'), readRepoText('scripts/agent-command-layer.mjs'));
  assert.equal(readText(root, 'scripts/lib/update-commands.mjs'), readRepoText('scripts/lib/update-commands.mjs'));
  assert.equal(readText(root, 'scripts/lib/package-script-manifest.mjs'), readRepoText('scripts/lib/package-script-manifest.mjs'));
  assert.equal(readText(root, 'agent-coordination.schema.json'), readRepoText('agent-coordination.schema.json'));

  assert.equal(readText(root, 'package.json'), preserved.packageJson);
  assert.equal(readText(root, 'agent-coordination.config.json'), preserved.config);
  assert.equal(readText(root, 'docs/commands.md'), preserved.docs);
  assert.equal(readText(root, 'coordination/runtime/state.lock.json'), preserved.runtimeLock);
  assert.equal(readText(root, 'coordination/board.json'), preserved.board);
});
