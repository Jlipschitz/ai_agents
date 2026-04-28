import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { commandFromPackageScript, commandNames, findCommandMetadata, validateCommandRegistry, validateCommandWiring } from '../scripts/lib/command-registry.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('command registry exposes help metadata for routed commands', () => {
  const names = commandNames();
  const validation = validateCommandRegistry();

  assert.equal(validation.ok, true);
  assert.ok(names.includes('status'));
  assert.ok(names.includes('handoff-bundle'));
  assert.ok(names.includes('next'));
  assert.match(findCommandMetadata('next').usage, /next \[agent-id\]/);
  assert.match(findCommandMetadata('handoff-bundle').summary, /handoff context|handoff/);
});

test('command registry validates package script command targets', () => {
  const validation = validateCommandWiring({ packageJson });

  assert.equal(validation.ok, true);
  assert.ok(validation.checkedScripts.some((entry) => entry.name === 'agents:next' && entry.command === 'next'));
  assert.ok(validation.checkedScripts.some((entry) => entry.name === 'agents:handoff:bundle' && entry.command === 'handoff-bundle'));
});

test('command registry reports unknown package script targets', () => {
  const validation = validateCommandWiring({
    packageJson: {
      scripts: {
        'agents:bad': 'node ./scripts/agent-coordination.mjs no-such-command',
      },
    },
  });

  assert.equal(validation.ok, false);
  assert.match(validation.errors[0], /unknown command "no-such-command"/);
});

test('commandFromPackageScript extracts coordinator command names', () => {
  assert.equal(commandFromPackageScript('node ./scripts/agent-coordination.mjs status --json'), 'status');
  assert.equal(commandFromPackageScript('node ./scripts/agent-coordination-two.mjs next agent-1'), 'next');
  assert.equal(commandFromPackageScript('ai-agents handoff-bundle agent-1 task-id'), 'handoff-bundle');
  assert.equal(commandFromPackageScript('node ./scripts/agent-coordination.mjs'), null);
});
