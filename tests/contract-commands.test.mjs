import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { coordinationRoot, makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

test('contracts create is dry-run by default and writes contract files with --apply', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-contracts-', packageName: 'contracts-test' });
  writeBoard(root, {
    projectName: 'Contracts Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-producer', status: 'active', ownerId: 'agent-1', title: 'Producer', claimedPaths: ['api/routes'], dependencies: [], verification: [], verificationLog: [] },
      { id: 'task-consumer', status: 'planned', ownerId: null, title: 'Consumer', claimedPaths: ['app/page'], dependencies: ['task-producer'], verification: [], verificationLog: [] },
    ],
  });
  const contractsRoot = path.join(coordinationRoot(root), 'contracts');

  const dryRun = runCli(root, ['contracts', 'create', 'api-v1', '--owner', 'agent-1', '--scope', 'api', '--summary', 'API v1 contract', '--producer', 'task-producer', '--consumer', 'task-consumer', '--json']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).applied, false);
  assert.equal(fs.existsSync(path.join(contractsRoot, 'api-v1.json')), false);

  const applied = runCli(root, ['contracts', 'create', 'api-v1', '--owner', 'agent-1', '--scope', 'api', '--summary', 'API v1 contract', '--producer', 'task-producer', '--consumer', 'task-consumer', '--apply', '--json']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).applied, true);
  assert.equal(fs.existsSync(path.join(contractsRoot, 'api-v1.json')), true);

  const list = runCli(root, ['contracts', 'list', '--json']);
  const show = runCli(root, ['contracts', 'show', 'api-v1', '--json']);
  assert.equal(list.status, 0, list.stderr);
  assert.equal(JSON.parse(list.stdout).contracts[0].id, 'api-v1');
  assert.equal(show.status, 0, show.stderr);
  assert.equal(JSON.parse(show.stdout).producerTaskId, 'task-producer');
});

test('contracts check validates references and warns on uncovered contract-sensitive work', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-contract-check-', packageName: 'contracts-test' });
  writeBoard(root, {
    projectName: 'Contracts Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-api', status: 'active', ownerId: 'agent-1', title: 'API work', claimedPaths: ['api/routes'], dependencies: [], verification: [], verificationLog: [] },
    ],
  });
  const contractsRoot = path.join(coordinationRoot(root), 'contracts');
  fs.mkdirSync(contractsRoot, { recursive: true });
  fs.writeFileSync(path.join(contractsRoot, 'bad.json'), JSON.stringify({
    contractVersion: 1,
    id: 'bad',
    status: 'active',
    summary: 'Bad contract',
    ownerId: 'agent-1',
    scopes: ['server'],
    producerTaskId: 'task-missing',
    consumerTaskIds: [],
  }, null, 2));

  const result = runCli(root, ['contracts', 'check', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.ok(payload.errors.some((entry) => entry.includes('task-missing')));
  assert.ok(payload.warnings.some((entry) => entry.includes('task-api touches contract-sensitive path')));
});

test('contracts show missing contract uses shared JSON error formatting', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-contract-errors-', packageName: 'contracts-test' });
  writeBoard(root, {
    projectName: 'Contracts Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [],
  });

  const result = runCli(root, ['contracts', 'show', 'missing-contract', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(payload, {
    ok: false,
    error: 'Contract not found: missing-contract',
    code: 'not_found',
  });
});

test('contracts unknown subcommand uses shared text error formatting', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-contract-errors-', packageName: 'contracts-test' });
  writeBoard(root, {
    projectName: 'Contracts Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [],
  });

  const result = runCli(root, ['contracts', 'unknown']);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^error: Usage: contracts list\|show <id>\|create <id>\|check \[options\]/);
  assert.match(result.stderr, /hint: Run with --help for command usage\./);
});
