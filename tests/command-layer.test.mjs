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
  assert.equal(packageJson.scripts['agents:handoff:bundle'], 'ai-agents handoff-bundle');
  assert.equal(packageJson.scripts['agents:next'], 'ai-agents next');
  assert.equal(packageJson.scripts['agents:state:size'], 'ai-agents state-size');
  assert.equal(packageJson.scripts['agents:status:badge'], 'ai-agents status-badge');
  assert.equal(packageJson.scripts['agents:fixture:board'], 'ai-agents fixture-board');
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
  assert.equal(packageJson.scripts['agents:handoff:bundle'], 'node ./scripts/agent-coordination.mjs handoff-bundle');
  assert.equal(packageJson.scripts['agents:next'], 'node ./scripts/agent-coordination.mjs next');
  assert.equal(packageJson.scripts['agents:state:size'], 'node ./scripts/agent-coordination.mjs state-size');
  assert.equal(packageJson.scripts['agents:status:badge'], 'node ./scripts/agent-coordination.mjs status-badge');
  assert.equal(packageJson.scripts['agents:fixture:board'], 'node ./scripts/agent-coordination.mjs fixture-board');
  assert.equal(packageJson.scripts['agents2:doctor:json'], 'node ./scripts/agent-coordination-two.mjs doctor --json');
  assert.equal(packageJson.scripts['agents2:state:size'], 'node ./scripts/agent-coordination-two.mjs state-size');
  assert.equal(packageJson.scripts['agents2:status:badge'], 'node ./scripts/agent-coordination-two.mjs status-badge');
  assert.equal(packageJson.scripts['agents2:fixture:board'], 'node ./scripts/agent-coordination-two.mjs fixture-board');
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
  assert.equal(payload.commandWiring.ok, true);
  assert.ok(payload.commandWiring.checkedScripts.some((entry) => entry.name === 'agents:next' && entry.command === 'next'));
  assert.ok(payload.commandWiring.registry.minimalCommandCount > 0);
  assert.ok(payload.commandWiring.registry.groups.workflow.commandNames.includes('next'));
  assert.ok(payload.commandWiring.scriptCoverage.minimalCommandsWithShortcuts.includes('next'));
  assert.ok(Array.isArray(payload.commandWiring.scriptCoverage.minimalCommandsWithoutShortcuts));
  assert.equal(Array.isArray(payload.configSuggestions), true);
  assert.equal(Array.isArray(payload.onboardingChecklist.items), true);
  assert.ok(payload.onboardingChecklist.missing.includes('architecture'));
  assert.equal(typeof payload.git.available, 'boolean');
});

test('doctor --json includes profile and custom onboarding checklist items', () => {
  const root = makeWorkspace();
  const configPath = path.join(root, 'agent-coordination.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.onboarding = {
    profiles: ['backend', 'react'],
    checklist: [
      {
        id: 'support-runbook',
        label: 'Support runbook',
        paths: ['docs/support.md'],
        recommendation: 'Document support escalation steps.',
      },
    ],
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'frontend.md'), '# Frontend\n');

  const result = run(root, ['doctor', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  const items = Object.fromEntries(payload.onboardingChecklist.items.map((item) => [item.id, item]));
  assert.equal(items['react-ui-structure'].status, 'present');
  assert.equal(items['react-ui-structure'].profile, 'react');
  assert.equal(items['backend-api-contracts'].status, 'missing');
  assert.equal(items['backend-data-migrations'].status, 'missing');
  assert.equal(items['support-runbook'].status, 'missing');
  assert.equal(items['support-runbook'].profile, 'custom');
  assert.ok(payload.onboardingChecklist.missing.includes('support-runbook'));
  assert.ok(payload.onboardingChecklist.recommendations.includes('Document support escalation steps.'));
});

test('doctor text output routes through core diagnostics', () => {
  const root = makeWorkspace();
  const result = run(root, ['doctor']);

  assert.match(result.stdout, /Agent coordination doctor/);
  assert.match(result.stdout, /Onboarding checklist:/);
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

test('repo-defined command aliases route through the command layer and core', () => {
  const root = makeWorkspace();
  const configPath = path.join(root, 'agent-coordination.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.commandAliases = {
    qsum: ['summarize', '--json'],
    board: 'status',
    'blocked-now': 'ask "what is blocked?" --json',
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  writeBoard(root, {
    projectName: 'Repo Alias Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-alias', status: 'planned', ownerId: null, title: 'Alias task', claimedPaths: [] }],
  });

  const summary = run(root, ['qsum']);
  const status = run(root, ['board']);
  const blocked = run(root, ['blocked-now']);
  const help = run(root, ['help', 'qsum']);

  assert.equal(summary.status, 0, summary.stderr);
  assert.equal(JSON.parse(summary.stdout).counts.planned, 1);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /task-alias/);
  assert.equal(blocked.status, 0, blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).question, 'what is blocked?');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /summarize/);
});

test('repo-defined command aliases cannot override built-in commands at runtime', () => {
  const root = makeWorkspace();
  const configPath = path.join(root, 'agent-coordination.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.commandAliases = {
    status: ['doctor'],
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  writeBoard(root, {
    projectName: 'Alias Override Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-status', status: 'planned', ownerId: null, title: 'Status task', claimedPaths: [] }],
  });

  const result = run(root, ['status']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /task-status/);
  assert.doesNotMatch(result.stdout, /Agent coordination doctor/);
});

test('per-command help supports command flags and help aliases', () => {
  const root = makeWorkspace();
  const claim = run(root, ['claim', '--help']);
  const summary = run(root, ['help', 'sum']);
  const handoff = run(root, ['handoff', '--help']);
  const handoffBundle = run(root, ['handoff-bundle', '--help']);
  const next = run(root, ['next', '--help']);
  const policyPacks = run(root, ['policy-packs', '--help']);
  const completions = run(root, ['completions', '--help']);
  const minimal = run(root, ['help', '--minimal']);
  const groups = run(root, ['help', '--groups']);

  assert.equal(claim.status, 0, claim.stderr);
  assert.match(claim.stdout, /Usage:/);
  assert.match(claim.stdout, /claim <agent>/);
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, /summarize/);
  assert.equal(handoff.status, 0, handoff.stderr);
  assert.match(handoff.stdout, /handoff <agent>/);
  assert.equal(handoffBundle.status, 0, handoffBundle.stderr);
  assert.match(handoffBundle.stdout, /handoff-bundle <agent>/);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stdout, /next \[agent-id\]/);
  assert.match(next.stdout, /Group: workflow/);
  assert.match(next.stdout, /Minimal: yes/);
  assert.equal(policyPacks.status, 0, policyPacks.stderr);
  assert.match(policyPacks.stdout, /list\|inspect\|apply/);
  assert.equal(completions.status, 0, completions.stderr);
  assert.match(completions.stdout, /list\|powershell\|bash\|zsh/);
  assert.equal(minimal.status, 0, minimal.stderr);
  assert.match(minimal.stdout, /Minimal commands/);
  assert.match(minimal.stdout, /agents -- next/);
  assert.doesNotMatch(minimal.stdout, /github-plan/);
  assert.equal(groups.status, 0, groups.stderr);
  assert.match(groups.stdout, /workflow - Task lifecycle/);
  assert.match(groups.stdout, /github - Git and GitHub awareness/);
});

test('global coordination-dir flag overrides default coordination root', () => {
  const root = makeWorkspace();
  const result = run(root, ['--coordination-dir', 'custom-coordination', 'doctor', '--json']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).coordinationRoot, path.join(root, 'custom-coordination'));
});

test('global config flag is honored before explain-config routing', () => {
  const root = makeWorkspace();
  const configPath = path.join(root, 'alt-agent-config.json');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'agent-coordination.config.json'), 'utf8'));
  config.projectName = 'Alternate Config';
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = run(root, ['--config', configPath, 'explain-config', '--json']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).projectName, 'Alternate Config');
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

test('ownership-review reports broad claims and CODEOWNERS boundary crossings', () => {
  const root = makeWorkspace();
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), [
    '/app/ @frontend',
    '/api/ @backend',
    '',
  ].join('\n'));
  writeBoard(root, {
    projectName: 'Ownership Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-broad', status: 'active', ownerId: 'agent-1', title: 'Broad task', claimedPaths: ['src'] },
      { id: 'task-cross', status: 'active', ownerId: 'agent-2', title: 'Cross task', claimedPaths: ['app/page.js', 'api/route.js'] },
    ],
  });

  const result = run(root, ['ownership-review', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(payload.codeownersPath, '.github/CODEOWNERS');
  assert.ok(payload.findings.some((entry) => entry.includes('task-broad')));
  assert.ok(payload.findings.some((entry) => entry.includes('task-cross')));
});

test('test-impact selects configured checks from paths', () => {
  const root = makeWorkspace();
  const configPath = path.join(root, 'agent-coordination.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.checks = {
    unit: { command: 'npm run unit', requiredForPaths: ['src', 'lib'] },
    api: { command: 'npm run api:test', requiredForPaths: ['api'] },
  };
  config.paths.visualImpact = ['app'];
  config.verification.visualRequiredChecks = ['visual:test'];
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const api = run(root, ['test-impact', '--paths', 'api/route.js', '--json']);
  const visual = run(root, ['test-impact', '--paths', 'app/page.js', '--json']);

  assert.equal(api.status, 0, api.stderr);
  assert.deepEqual(JSON.parse(api.stdout).checks.map((check) => check.name), ['api']);
  assert.equal(visual.status, 0, visual.stderr);
  assert.ok(JSON.parse(visual.stdout).checks.some((check) => check.name === 'visual:test'));
});

test('test-impact reports impacted monorepo workspaces', () => {
  const root = makeWorkspace();
  const configPath = path.join(root, 'agent-coordination.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.monorepo = { workspaceRoots: ['packages/*'], partialCheckout: true, fallbackRoot: '.' };
  config.checks = {
    api: { command: 'npm run api:test', requiredForPaths: ['packages/api'] },
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = run(root, ['test-impact', '--paths', 'packages/api/src/route.js', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(payload.checks.map((check) => check.name), ['api']);
  assert.equal(payload.workspaces.partialCheckout, true);
  assert.equal(payload.workspaces.impacted[0].root, 'packages/api');
  assert.equal(payload.workspaces.impacted[0].partial, true);
  assert.deepEqual(payload.workspaces.impacted[0].matchedPaths, ['packages/api/src/route.js']);
});

test('validate --json returns machine-readable config validation', () => {
  const root = makeWorkspace();
  writeBoard(root, {
    projectName: 'Valid Board Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    agents: [
      { id: 'agent-1', status: 'idle', taskId: null },
      { id: 'agent-2', status: 'idle', taskId: null },
    ],
    tasks: [],
  });
  const result = run(root, ['validate', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.valid, true);
  assert.equal(payload.board.ok, true);
});

test('validate --json includes board inspection failures', () => {
  const root = makeWorkspace();
  writeBoard(root, {
    projectName: 'Invalid Board Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [{ id: 'task-active', status: 'active', ownerId: null, title: 'Unowned active task', claimedPaths: ['src'] }],
  });

  const result = run(root, ['validate', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(payload.valid, false);
  assert.equal(payload.board.ok, false);
  assert.ok(payload.board.findings.some((entry) => entry.includes('has no owner')));
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
