import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function writeCodeowners(root) {
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'CODEOWNERS'), ['/app/ @frontend', '/api/ @backend', '/src/ @core', ''].join('\n'));
}

test('escalation-route suggests active owners previous owners and CODEOWNERS', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-escalation-route-', packageName: 'escalation-route-test' });
  writeCodeowners(root);
  writeBoard(root, {
    projectName: 'Escalation Route Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-blocked', status: 'blocked', ownerId: 'agent-1', claimedPaths: ['app/page.tsx', 'api/routes/user.ts'], blockedReason: 'Need route contract.' },
      { id: 'task-active-ui', status: 'active', ownerId: 'agent-ui', claimedPaths: ['app'] },
      { id: 'task-api-done', status: 'done', ownerId: 'agent-api', claimedPaths: ['api/routes'] },
    ],
  });

  const result = runCli(root, ['escalation-route', '--task', 'task-blocked', '--json'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);
  const targets = payload.routes.map((route) => route.target);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.input.taskId, 'task-blocked');
  assert.ok(targets.includes('agent-ui'));
  assert.ok(targets.includes('agent-api'));
  assert.ok(targets.includes('@frontend'));
  assert.ok(targets.includes('@backend'));
  assert.equal(payload.routes[0].target, 'agent-ui');
});

test('escalation-route supports explicit paths without a task', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-escalation-route-paths-', packageName: 'escalation-route-test' });
  writeCodeowners(root);
  writeBoard(root, { projectName: 'Escalation Route Test', tasks: [] });

  const result = runCli(root, ['escalation-route', '--paths', 'src/lib/a.ts', '--reason', 'Need core review', '--json'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.input.reason, 'Need core review');
  assert.ok(payload.routes.some((route) => route.target === '@core'));
});
