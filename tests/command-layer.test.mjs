import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { coordinationRoot, makeWorkspace as makeTestWorkspace, repoRoot, runCli, runWithoutCoordinationEnv, writeBoard } from './helpers/workspace.mjs';

function makeWorkspace() {
  return makeTestWorkspace({ prefix: 'ai-agents-layer-', packageName: 'layer-test' }).root;
}

function run(root, args) {
  return runCli(root, args);
}

test('doctor --fix creates starter runtime files', () => {
  const root = makeWorkspace();
  const result = run(root, ['doctor', '--fix']);
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /doctor --fix/);
  assert.equal(fs.existsSync(path.join(root, 'coordination', 'board.json')), true);
  assert.equal(fs.existsSync(path.join(root, 'coordination', 'journal.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'coordination', 'messages.ndjson')), true);
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /\/coordination\//);
  assert.equal(packageJson.scripts['agents:doctor'], 'ai-agents doctor');
  assert.equal(packageJson.scripts['agents:doctor:json'], 'ai-agents doctor --json');
});

test('workspace wrappers use distinct default coordination roots', () => {
  const root = makeWorkspace();
  const agentsCli = path.join(repoRoot, 'scripts', 'agent-coordination.mjs');
  const agentsTwoCli = path.join(repoRoot, 'scripts', 'agent-coordination-two.mjs');

  const one = runWithoutCoordinationEnv(agentsCli, root, ['doctor', '--json']);
  const two = runWithoutCoordinationEnv(agentsTwoCli, root, ['doctor', '--json']);

  assert.equal(one.status, 0, one.stderr);
  assert.equal(two.status, 0, two.stderr);
  assert.equal(JSON.parse(one.stdout).coordinationRoot, path.join(root, 'coordination'));
  assert.equal(JSON.parse(two.stdout).coordinationRoot, path.join(root, 'coordination-two'));
});

test('doctor --fix uses copied coordinator scripts when present', () => {
  const root = makeWorkspace();
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'ai-agents.mjs'), '');
  fs.writeFileSync(path.join(root, 'scripts', 'agent-command-layer.mjs'), '');
  fs.writeFileSync(path.join(root, 'scripts', 'agent-coordination.mjs'), '');
  fs.writeFileSync(path.join(root, 'scripts', 'agent-coordination-two.mjs'), '');
  fs.writeFileSync(path.join(root, 'scripts', 'check-syntax.mjs'), '');

  const result = run(root, ['doctor', '--fix']);
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(packageJson.scripts.check, 'node ./scripts/check-syntax.mjs');
  assert.equal(packageJson.scripts['agents:doctor'], 'node ./scripts/agent-coordination.mjs doctor');
  assert.equal(packageJson.scripts['agents2:doctor:json'], 'node ./scripts/agent-coordination-two.mjs doctor --json');
});

test('doctor --fix updates package scripts without reordering unrelated package fields', () => {
  const root = makeWorkspace();
  fs.writeFileSync(path.join(root, 'package.json'), [
    '{',
    '  "name": "layer-test",',
    '  "description": "keep this field before scripts",',
    '  "scripts": {',
    '    "existing": "node existing.js"',
    '  },',
    '  "custom": {',
    '    "nested": true',
    '  }',
    '}',
    '',
  ].join('\n'));

  const result = run(root, ['doctor', '--fix']);
  const content = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

  assert.equal(result.status, 0, result.stderr);
  assert.ok(content.indexOf('"description"') < content.indexOf('"scripts"'));
  assert.ok(content.indexOf('"scripts"') < content.indexOf('"custom"'));
  assert.match(content, /"existing": "node existing\.js"/);
  assert.match(content, /"agents:doctor": "ai-agents doctor"/);
});

test('doctor --json reports config validation and git fields', () => {
  const root = makeWorkspace();
  const result = run(root, ['doctor', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.configValidation.valid, true);
  assert.equal(Array.isArray(payload.configSuggestions), true);
  assert.equal(typeof payload.git.available, 'boolean');
});

test('doctor text output routes through core diagnostics', () => {
  const root = makeWorkspace();
  const result = run(root, ['doctor']);

  assert.match(result.stdout, /Agent coordination doctor/);
  assert.doesNotMatch(result.stderr, /execGit is not defined/);
});

test('doctor --json includes config improvement suggestions', () => {
  const root = makeWorkspace();
  const config = JSON.parse(fs.readFileSync(path.join(root, 'agent-coordination.config.json'), 'utf8'));
  config.verification.visualRequiredChecks = [];
  fs.writeFileSync(path.join(root, 'agent-coordination.config.json'), `${JSON.stringify(config, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'layer-test', scripts: { 'visual:test': 'playwright test' } }, null, 2));

  const result = run(root, ['doctor', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.configSuggestions.some((entry) => entry.code === 'visual-checks-missing'));
});

test('doctor --json --fix reports post-fix state', () => {
  const root = makeTestWorkspace({ prefix: 'ai-agents-layer-empty-', packageName: 'layer-empty-test', config: false }).root;
  const result = run(root, ['doctor', '--json', '--fix']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.configValidation.valid, true);
  assert.equal(payload.files.board, true);
  assert.equal(payload.files.journal, true);
  assert.equal(payload.files.messages, true);
  assert.ok(payload.fixes.some((entry) => entry.includes('agent-coordination.config.json')));
});

test('summarize prints stale work and next actions', () => {
  const root = makeWorkspace();
  writeBoard(root, {
    projectName: 'Layer Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-one', status: 'active', ownerId: 'agent-1', title: 'Build feature', claimedPaths: ['src/feature'], updatedAt: '2000-01-01T00:00:00.000Z' },
      { id: 'task-two', status: 'blocked', ownerId: 'agent-2', title: 'Fix API', claimedPaths: ['server/api'], updatedAt: '2000-01-01T00:00:00.000Z' },
    ],
  });
  fs.appendFileSync(path.join(coordinationRoot(root), 'journal.md'), 'Recent journal entry\n');
  fs.appendFileSync(path.join(coordinationRoot(root), 'messages.ndjson'), `${JSON.stringify({ from: 'agent-1', to: 'agent-2', body: 'Please review API.' })}\n`);

  const result = run(root, ['summarize', '--for-chat']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Coordination summary for Layer Test/);
  assert.match(result.stdout, /task-one/);
  assert.match(result.stdout, /task-two/);
  assert.match(result.stdout, /Stale work/);
  assert.match(result.stdout, /Next actions/);
});

test('summarize --json includes counts and recent context', () => {
  const root = makeWorkspace();
  writeBoard(root, {
    projectName: 'Layer Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-one', status: 'planned', ownerId: null, title: 'Plan task', claimedPaths: [] }],
  });
  fs.appendFileSync(path.join(coordinationRoot(root), 'journal.md'), 'Journal tail\n');

  const result = run(root, ['summarize', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.counts.planned, 1);
  assert.ok(Array.isArray(payload.nextActions));
  assert.ok(payload.recentJournal.includes('Journal tail'));
});

test('short command aliases route through the command layer and core', () => {
  const root = makeWorkspace();
  writeBoard(root, {
    projectName: 'Alias Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-one', status: 'planned', ownerId: null, title: 'Task one', claimedPaths: [] }],
  });

  const summary = run(root, ['sum', '--json']);
  const doctor = run(root, ['d', '--json']);
  const status = run(root, ['s']);

  assert.equal(summary.status, 0, summary.stderr);
  assert.equal(JSON.parse(summary.stdout).counts.planned, 1);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).configValidation.valid, true);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /task-one/);
});

test('start records the message as the task summary and progress note', () => {
  const root = makeWorkspace();
  writeBoard(root, {
    projectName: 'Layer Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-one', status: 'planned', ownerId: null, title: 'Task one', claimedPaths: [] }],
  });

  const result = run(root, ['start', 'agent-1', 'task-one', '--paths', 'src/a', 'Starting summary']);
  const board = JSON.parse(fs.readFileSync(path.join(coordinationRoot(root), 'board.json'), 'utf8'));
  const task = board.tasks.find((entry) => entry.id === 'task-one');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(task.summary, 'Starting summary');
  assert.ok(task.notes.some((entry) => entry.kind === 'progress' && entry.body === 'Starting summary'));
});

test('claim blocks agents that exceed configured active capacity', () => {
  const root = makeWorkspace();
  const configPath = path.join(root, 'agent-coordination.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.capacity = { maxActiveTasksPerAgent: 1, maxBlockedTasksPerAgent: 1, preferredDomainsByAgent: {}, enforcePreferredDomains: false };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  writeBoard(root, {
    projectName: 'Capacity Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-active', status: 'active', ownerId: 'agent-1', title: 'Current task', claimedPaths: ['app/current'] },
      { id: 'task-next', status: 'planned', ownerId: null, title: 'Next task', claimedPaths: [] },
    ],
  });

  const result = run(root, ['claim', 'agent-1', 'task-next', '--paths', 'app/next']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /capacity policy/);
  assert.match(result.stderr, /active task limit/);
});

test('claim enforces preferred domains when configured', () => {
  const root = makeWorkspace();
  const configPath = path.join(root, 'agent-coordination.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.capacity = {
    maxActiveTasksPerAgent: 1,
    maxBlockedTasksPerAgent: 1,
    preferredDomainsByAgent: { 'agent-1': ['docs'] },
    enforcePreferredDomains: true,
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  writeBoard(root, {
    projectName: 'Capacity Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-app', status: 'planned', ownerId: null, title: 'App task', claimedPaths: [] }],
  });

  const result = run(root, ['claim', 'agent-1', 'task-app', '--paths', 'app/screen']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /prefers domain/);
});

test('validate --json returns machine-readable config validation', () => {
  const root = makeWorkspace();
  const result = run(root, ['validate', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.valid, true);
});

test('lock-status is routed through the main CLI', () => {
  const root = makeWorkspace();
  const result = run(root, ['lock-status', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.exists, false);
});

test('lock-clear is routed through the main CLI', () => {
  const root = makeWorkspace();
  fs.mkdirSync(path.join(coordinationRoot(root), 'runtime'), { recursive: true });
  const lockPath = path.join(coordinationRoot(root), 'runtime', 'state.lock.json');
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999999, updatedAt: '2000-01-01T00:00:00.000Z' }));

  const result = run(root, ['lock-clear', '--stale-only', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.cleared, true);
  assert.equal(fs.existsSync(lockPath), false);
});

test('finish --require-verification blocks missing passing checks before mutating board', () => {
  const root = makeWorkspace();
  writeBoard(root, {
    projectName: 'Layer Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-one', status: 'active', ownerId: 'agent-1', title: 'Needs verification', claimedPaths: ['src/a'], verification: ['unit'], verificationLog: [] }],
  });
  const boardPath = path.join(coordinationRoot(root), 'board.json');
  const before = fs.readFileSync(boardPath, 'utf8');

  const result = run(root, ['finish', 'agent-1', 'task-one', '--require-verification']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing passing verification/);
  assert.equal(fs.readFileSync(boardPath, 'utf8'), before);
});

test('finish --require-doc-review blocks missing docs review before mutating board', () => {
  const root = makeWorkspace();
  writeBoard(root, {
    projectName: 'Layer Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-one', status: 'active', ownerId: 'agent-1', title: 'Needs docs', claimedPaths: ['src/a'], verification: [] }],
  });
  const boardPath = path.join(coordinationRoot(root), 'board.json');
  const before = fs.readFileSync(boardPath, 'utf8');

  const result = run(root, ['finish', 'agent-1', 'task-one', '--require-doc-review']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /docsReviewedAt/);
  assert.equal(fs.readFileSync(boardPath, 'utf8'), before);
});
