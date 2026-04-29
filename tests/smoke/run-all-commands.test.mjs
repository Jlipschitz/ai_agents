import test from 'node:test';
import assert from 'node:assert/strict';

import { commandRegistryEntries } from '../../scripts/lib/command-registry.mjs';
import { runSmokeSuite } from './run-all-commands.mjs';

let smokeResult = null;

function getSmokeResult() {
  smokeResult ??= runSmokeSuite();
  return smokeResult;
}

test('smoke runner bootstraps a target repo and exercises representative commands', () => {
  const result = getSmokeResult();

  assert.equal(result.ok, true);
  assert.equal(result.removed, true);
  assert.ok(result.operations.some((entry) => entry.includes('copy scripts/agent-command-layer.mjs')));
  assert.ok(result.operations.some((entry) => entry.includes('update package.json scripts')));
  assert.ok(result.commands.some((entry) => entry.label === 'doctor json' && entry.status === 0));
  assert.ok(result.commands.some((entry) => entry.label === 'handoff bundle json' && entry.status === 0));
  assert.ok(result.commands.some((entry) => entry.label === 'prioritize dry-run' && entry.status === 0));
});

test('smoke runner covers every minimal registry command', () => {
  const result = getSmokeResult();
  const accounted = new Set([
    ...result.commands.map((entry) => entry.command),
    ...result.skippedMinimalCommands.map((entry) => entry.command),
  ]);
  const uncovered = commandRegistryEntries()
    .filter((entry) => entry.minimal)
    .map((entry) => entry.name)
    .filter((name) => !accounted.has(name));

  assert.deepEqual(uncovered, []);
  assert.ok(result.skippedMinimalCommands.some((entry) => entry.command === 'handoff-ready' && entry.reason));
});
