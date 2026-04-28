import test from 'node:test';
import assert from 'node:assert/strict';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeCompletionWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-completions-', packageName: 'completion-test' });
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
  assert.ok(payload.commands.includes('completions'));
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
