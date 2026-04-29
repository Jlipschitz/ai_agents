import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { commandFromPackageScript, commandNames, findCommandMetadata, jsonCommandNames, validateCommandRegistry, validateCommandWiring } from '../scripts/lib/command-registry.mjs';
import { buildLocalPackageScripts, buildPortablePackageScripts } from '../scripts/lib/package-script-manifest.mjs';

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
  assert.ok(jsonCommandNames().includes('status'));
  assert.ok(jsonCommandNames().includes('doctor'));
  assert.match(findCommandMetadata('next').usage, /next \[agent-id\]/);
  assert.match(findCommandMetadata('handoff-bundle').summary, /handoff context|handoff/);
  assert.equal(findCommandMetadata('next').group, 'workflow');
  assert.equal(findCommandMetadata('next').minimal, true);
  assert.equal(findCommandMetadata('github-plan').group, 'github');
  assert.equal(findCommandMetadata('github-plan').minimal, false);
  assert.equal(validation.commands.every((entry) => typeof entry.group === 'string' && typeof entry.minimal === 'boolean'), true);
});

test('command registry validates package script command targets', () => {
  const validation = validateCommandWiring({ packageJson });

  assert.equal(validation.ok, true);
  assert.equal(validation.registry.commandCount, validation.commandCount);
  assert.ok(validation.registry.minimalCommandCount > 0);
  assert.ok(validation.registry.jsonCommandCount > 0);
  assert.ok(validation.registry.groups.workflow.minimalCommands > 0);
  assert.ok(validation.registry.groups.workflow.jsonCommands > 0);
  assert.ok(validation.registry.groups.workflow.jsonCommandNames.includes('next'));
  assert.ok(validation.scriptCoverage.shortcutCommandCount > 0);
  assert.ok(validation.scriptCoverage.minimalCommandsWithShortcuts.includes('next'));
  assert.ok(Array.isArray(validation.scriptCoverage.minimalCommandsWithoutShortcuts));
  assert.ok(validation.checkedScripts.some((entry) => entry.name === 'agents:next' && entry.command === 'next'));
  assert.ok(validation.checkedScripts.some((entry) => entry.name === 'agents:handoff:bundle' && entry.command === 'handoff-bundle'));
});

test('command registry validates generated package script manifests', () => {
  const local = validateCommandWiring({ expectedScripts: buildLocalPackageScripts() });
  const portable = validateCommandWiring({ expectedScripts: buildPortablePackageScripts() });

  assert.equal(local.ok, true);
  assert.equal(portable.ok, true);
  assert.ok(local.checkedScripts.some((entry) => entry.name === 'agents2:redact:check' && entry.command === 'redact-check'));
  assert.ok(portable.checkedScripts.some((entry) => entry.name === 'agents:redact:check' && entry.command === 'redact-check'));
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
