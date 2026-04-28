import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeCompletionWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-completions-', packageName: 'completion-test' });
  const configPath = path.join(workspace.root, 'agent-coordination.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.commandAliases = { qa: ['run-check', 'test'] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  writeBoard(workspace.root, {
    projectName: 'Completion Test',
    agents: [
      { id: 'agent-1', status: 'active', taskId: 'task-one' },
      { id: 'agent-custom', status: 'idle', taskId: null },
    ],
    tasks: [
      { id: 'task-one', status: 'active', ownerId: 'agent-1', verification: ['unit'], verificationLog: [] },
      { id: 'task-two', status: 'planned', ownerId: null, verification: [], verificationLog: [{ check: 'smoke', outcome: 'pass' }] },
    ],
    resources: [],
    incidents: [],
  });
  return workspace;
}

test('completions list reports supported shells', () => {
  const { root, coordinationRoot } = makeCompletionWorkspace();
  const result = runCli(root, ['completions', 'list', '--json'], { coordinationRoot });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.shells, ['powershell', 'bash', 'zsh']);
  assert.ok(payload.commands.includes('claim'));
  assert.ok(payload.commands.includes('approvals'));
  assert.ok(payload.commands.includes('policy-check'));
  assert.ok(payload.commands.includes('format'));
  assert.ok(payload.commands.includes('interactive'));
  assert.ok(payload.commands.includes('critical-path'));
  assert.ok(payload.commands.includes('health-score'));
  assert.ok(payload.commands.includes('agent-history'));
  assert.ok(payload.commands.includes('cost-time'));
  assert.ok(payload.commands.includes('review-queue'));
  assert.ok(payload.commands.includes('secrets-scan'));
  assert.ok(payload.commands.includes('runbooks'));
  assert.ok(payload.commands.includes('path-groups'));
  assert.ok(payload.commands.includes('split-validate'));
  assert.ok(payload.commands.includes('escalation-route'));
  assert.ok(payload.commands.includes('steal-work'));
  assert.ok(payload.commands.includes('contracts'));
  assert.ok(payload.commands.includes('compact-state'));
  assert.ok(payload.commands.includes('prioritize'));
  assert.ok(payload.commands.includes('risk-score'));
  assert.ok(payload.commands.includes('completions'));
  assert.ok(payload.commands.includes('calendar'));
  assert.ok(payload.commands.includes('release-sign'));
  assert.ok(payload.commands.includes('dashboard'));
  assert.ok(payload.commands.includes('timeline'));
  assert.ok(payload.commands.includes('version'));
  assert.ok(payload.commands.includes('publish-check'));
  assert.ok(payload.commands.includes('handoff'));
  assert.ok(payload.commands.includes('s'));
  assert.ok(payload.commands.includes('qa'));
});

test('completions bash includes commands and repo task context', () => {
  const { root, coordinationRoot } = makeCompletionWorkspace();
  const result = runCli(root, ['completions', 'bash'], { coordinationRoot });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /complete -F _ai_agents_complete ai-agents/);
  assert.match(result.stdout, /task-one task-two/);
  assert.match(result.stdout, /agent-custom/);
  assert.match(result.stdout, /unit/);
  assert.match(result.stdout, /smoke/);
  assert.match(result.stdout, /prioritize/);
  assert.match(result.stdout, /approvals/);
  assert.match(result.stdout, /policy-check/);
  assert.match(result.stdout, /format/);
  assert.match(result.stdout, /interactive/);
  assert.match(result.stdout, /critical-path/);
  assert.match(result.stdout, /health-score/);
  assert.match(result.stdout, /agent-history/);
  assert.match(result.stdout, /cost-time/);
  assert.match(result.stdout, /review-queue/);
  assert.match(result.stdout, /secrets-scan/);
  assert.match(result.stdout, /runbooks/);
  assert.match(result.stdout, /path-groups/);
  assert.match(result.stdout, /split-validate/);
  assert.match(result.stdout, /escalation-route/);
  assert.match(result.stdout, /steal-work/);
  assert.match(result.stdout, /contracts/);
  assert.match(result.stdout, /compact-state/);
  assert.match(result.stdout, /risk-score/);
  assert.match(result.stdout, /calendar/);
  assert.match(result.stdout, /release-sign/);
  assert.match(result.stdout, /dashboard/);
  assert.match(result.stdout, /--repos/);
  assert.match(result.stdout, /timeline/);
  assert.match(result.stdout, /version/);
  assert.match(result.stdout, /publish-check/);
  assert.match(result.stdout, /handoff/);
  assert.match(result.stdout, /--dry-run/);
  assert.match(result.stdout, /policy_pack_subcommands="list inspect apply"/);
  assert.match(result.stdout, / qa /);
});

test('completions powershell and zsh render shell-specific registrations', () => {
  const { root, coordinationRoot } = makeCompletionWorkspace();
  const powershell = runCli(root, ['completions', 'powershell'], { coordinationRoot });
  const zsh = runCli(root, ['completions', 'zsh'], { coordinationRoot });

  assert.equal(powershell.status, 0, powershell.stderr);
  assert.equal(zsh.status, 0, zsh.stderr);
  assert.match(powershell.stdout, /Register-ArgumentCompleter/);
  assert.match(zsh.stdout, /#compdef ai-agents agents agents2/);
});

test('completions rejects unsupported shells', () => {
  const { root, coordinationRoot } = makeCompletionWorkspace();
  const result = runCli(root, ['completions', 'fish']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: completions/);
});
