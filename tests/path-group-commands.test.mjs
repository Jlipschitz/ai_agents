import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test('path-groups groups paths by package boundary and import edges', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-path-groups-', packageName: 'path-groups-test' });
  writeFile(path.join(root, 'packages', 'web', 'package.json'), JSON.stringify({ name: '@app/web' }, null, 2));
  writeFile(path.join(root, 'packages', 'shared', 'package.json'), JSON.stringify({ name: '@app/shared' }, null, 2));
  writeFile(path.join(root, 'packages', 'web', 'src', 'App.tsx'), "import { util } from '../../shared/src/util';\nexport const App = util;\n");
  writeFile(path.join(root, 'packages', 'shared', 'src', 'util.ts'), 'export const util = 1;\n');
  writeFile(path.join(root, 'api', 'routes', 'user.ts'), 'export const user = 1;\n');
  writeBoard(root, { projectName: 'Path Groups Test', tasks: [] });

  const result = runCli(root, ['path-groups', '--paths', 'packages/web/src/App.tsx,packages/shared/src/util.ts,api/routes/user.ts', '--json'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.summary.paths, 3);
  assert.ok(payload.groups.some((group) => group.packageRoot === 'packages/web'));
  assert.ok(payload.groups.some((group) => group.packageRoot === 'packages/shared'));
  assert.ok(payload.groups.some((group) => group.id === 'api'));
  assert.ok(payload.importEdges.some((edge) => edge.fromPath === 'packages/web/src/App.tsx' && edge.toPath === 'packages/shared/src/util.ts'));
});

test('path-groups defaults to board claimed paths', () => {
  const { root, coordinationRoot } = makeWorkspace({ prefix: 'ai-agents-path-groups-board-', packageName: 'path-groups-test' });
  writeBoard(root, {
    projectName: 'Path Groups Test',
    tasks: [
      { id: 'task-ui', status: 'active', ownerId: 'agent-1', claimedPaths: ['app/page.tsx', 'components/Button.tsx'] },
      { id: 'task-api', status: 'planned', ownerId: null, claimedPaths: ['api/routes/user.ts'] },
    ],
  });

  const result = runCli(root, ['path-groups', '--json'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(payload.inputPaths, ['api/routes/user.ts', 'app/page.tsx', 'components/Button.tsx']);
  assert.ok(payload.groups.some((group) => group.category === 'product'));
  assert.ok(payload.groups.some((group) => group.category === 'data'));
});
