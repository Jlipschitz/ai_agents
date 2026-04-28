import test from 'node:test';
import assert from 'node:assert/strict';

import { runSmokeSuite } from './run-all-commands.mjs';

test('smoke runner bootstraps a target repo and exercises representative commands', () => {
  const result = runSmokeSuite();

  assert.equal(result.ok, true);
  assert.equal(result.removed, true);
  assert.ok(result.operations.some((entry) => entry.includes('copy scripts/agent-command-layer.mjs')));
  assert.ok(result.operations.some((entry) => entry.includes('update package.json scripts')));
  assert.ok(result.commands.some((entry) => entry.label === 'doctor json' && entry.status === 0));
  assert.ok(result.commands.some((entry) => entry.label === 'handoff bundle json' && entry.status === 0));
  assert.ok(result.commands.some((entry) => entry.label === 'prioritize dry-run' && entry.status === 0));
});
