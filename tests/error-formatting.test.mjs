import test from 'node:test';
import assert from 'node:assert/strict';

import { makeWorkspace, runCli } from './helpers/workspace.mjs';

test('command-layer errors use text formatting by default', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-errors-', runtime: true });
  const result = runCli(root, ['templates', 'show', 'missing-template']);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^error: Unknown template "missing-template"\./);
  assert.match(result.stderr, /hint: Run templates list to see available templates\./);
});

test('command-layer errors use JSON formatting with --json', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-errors-', runtime: true });
  const result = runCli(root, ['templates', 'show', 'missing-template', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(payload, {
    ok: false,
    error: 'Unknown template "missing-template".',
    code: 'not_found',
    hint: 'Run templates list to see available templates.',
  });
});

test('core errors use text formatting by default', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-errors-', runtime: true });
  const result = runCli(root, ['message']);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^error: Usage: message <from-agent> <to-agent\|all> <message>/);
  assert.match(result.stderr, /hint: Run with --help for command usage\./);
});

test('core errors use JSON formatting with --json', () => {
  const { root } = makeWorkspace({ prefix: 'ai-agents-errors-', runtime: true });
  const result = runCli(root, ['message', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'usage_error');
  assert.match(payload.error, /^Usage: message <from-agent> <to-agent\|all> <message>/);
  assert.equal(payload.hint, 'Run with --help for command usage.');
});
