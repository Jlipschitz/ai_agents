import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bootstrap, listBootstrapProfiles, parseArgs } from '../scripts/bootstrap.mjs';

test('bootstrap dry-run reports intended setup without writing files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-bootstrap-'));
  const operations = bootstrap(target, { dryRun: true, skipDoctor: true });

  assert.ok(operations.some((entry) => entry.includes('copy scripts/agent-coordination-core.mjs')));
  assert.ok(operations.some((entry) => entry.includes('update package.json scripts')));
  assert.ok(operations.some((entry) => entry.includes('update .gitignore')));
  assert.equal(fs.existsSync(path.join(target, 'package.json')), false);
  assert.equal(fs.existsSync(path.join(target, 'scripts')), false);
});

test('bootstrap creates package scripts and gitignore entries', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-bootstrap-'));
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'target-app', scripts: {} }, null, 2));

  const operations = bootstrap(target, { skipDoctor: true });
  const packageJson = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
  const gitignore = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');

  assert.ok(operations.some((entry) => entry.includes('copy bin/ai-agents.mjs')));
  assert.ok(operations.some((entry) => entry.includes('copy scripts/check-syntax.mjs')));
  assert.ok(operations.some((entry) => entry.includes('copy scripts/jsdoc-check.mjs')));
  assert.ok(operations.some((entry) => entry.includes('copy scripts/lint.mjs')));
  assert.ok(operations.some((entry) => entry.includes('copy scripts/lib/file-utils.mjs')));
  assert.ok(operations.some((entry) => entry.includes('copy scripts/lib/artifact-commands.mjs')));
  assert.equal(packageJson.scripts.check, 'node ./scripts/check-syntax.mjs');
  assert.equal(packageJson.scripts.lint, 'node ./scripts/lint.mjs');
  assert.equal(packageJson.scripts['jsdoc:check'], 'node ./scripts/jsdoc-check.mjs');
  assert.equal(packageJson.scripts.format, 'node ./scripts/agent-coordination.mjs format --apply');
  assert.equal(packageJson.scripts['format:check'], 'node ./scripts/agent-coordination.mjs format --check');
  assert.equal(packageJson.scripts['agents:doctor'], 'node ./scripts/agent-coordination.mjs doctor');
  assert.equal(packageJson.scripts['agents:interactive'], 'node ./scripts/agent-coordination.mjs interactive');
  assert.equal(packageJson.scripts['agents:board:migrate'], 'node ./scripts/agent-coordination.mjs migrate-board');
  assert.equal(packageJson.scripts['agents:state:compact'], 'node ./scripts/agent-coordination.mjs compact-state');
  assert.equal(packageJson.scripts['agents:critical:path'], 'node ./scripts/agent-coordination.mjs critical-path');
  assert.equal(packageJson.scripts['agents:health:score'], 'node ./scripts/agent-coordination.mjs health-score');
  assert.equal(packageJson.scripts['agents:agent:history'], 'node ./scripts/agent-coordination.mjs agent-history');
  assert.equal(packageJson.scripts['agents:cost:time'], 'node ./scripts/agent-coordination.mjs cost-time');
  assert.equal(packageJson.scripts['agents:review:queue'], 'node ./scripts/agent-coordination.mjs review-queue');
  assert.equal(packageJson.scripts['agents:dashboard'], 'node ./scripts/agent-coordination.mjs dashboard');
  assert.equal(packageJson.scripts['agents:timeline'], 'node ./scripts/agent-coordination.mjs timeline');
  assert.equal(packageJson.scripts['agents:publish:check'], 'node ./scripts/agent-coordination.mjs publish-check');
  assert.equal(packageJson.scripts['agents:secrets:scan'], 'node ./scripts/agent-coordination.mjs secrets-scan');
  assert.equal(packageJson.scripts['agents:contracts'], 'node ./scripts/agent-coordination.mjs contracts');
  assert.equal(packageJson.scripts['agents:runbooks'], 'node ./scripts/agent-coordination.mjs runbooks');
  assert.equal(packageJson.scripts['agents:path:groups'], 'node ./scripts/agent-coordination.mjs path-groups');
  assert.equal(packageJson.scripts['agents:split:validate'], 'node ./scripts/agent-coordination.mjs split-validate');
  assert.equal(packageJson.scripts['agents:escalation:route'], 'node ./scripts/agent-coordination.mjs escalation-route');
  assert.equal(packageJson.scripts['agents:work:steal'], 'node ./scripts/agent-coordination.mjs steal-work');
  assert.equal(packageJson.scripts['agents:format'], 'node ./scripts/agent-coordination.mjs format');
  assert.equal(packageJson.scripts['agents:approvals'], 'node ./scripts/agent-coordination.mjs approvals');
  assert.equal(packageJson.scripts['agents:calendar'], 'node ./scripts/agent-coordination.mjs calendar');
  assert.equal(packageJson.scripts['agents:release:sign'], 'node ./scripts/agent-coordination.mjs release-sign');
  assert.equal(packageJson.scripts['agents2:state:compact'], 'node ./scripts/agent-coordination-two.mjs compact-state');
  assert.equal(packageJson.scripts['validate:agents-config'], 'node ./scripts/validate-config.mjs');
  assert.match(gitignore, /\/coordination\//);
  assert.match(gitignore, /\/coordination-two\//);
  assert.equal(fs.existsSync(path.join(target, 'docs', 'ai-agent-app-notes.md')), true);
});

test('bootstrap exposes and parses repo profiles', () => {
  assert.deepEqual(listBootstrapProfiles().map((profile) => profile.name), ['react', 'backend', 'docs', 'release']);
  assert.equal(parseArgs(['--target', '.', '--profile', 'react']).profile, 'react');
  assert.equal(parseArgs(['--target=.', '--profile=backend']).profile, 'backend');
  assert.throws(() => parseArgs(['--target', '.', '--profile', 'missing']), /Unknown bootstrap profile/);
});

test('bootstrap applies react profile to target config', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-bootstrap-'));
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'target-app', scripts: {} }, null, 2));

  const operations = bootstrap(target, { profile: 'react', skipDoctor: true });
  const config = JSON.parse(fs.readFileSync(path.join(target, 'agent-coordination.config.json'), 'utf8'));

  assert.ok(operations.some((entry) => entry.includes('apply bootstrap profile react')));
  assert.equal(config.projectName, 'target-app');
  assert.ok(config.paths.visualImpact.includes('components'));
  assert.ok(config.paths.visualSuite.includes('tests/visual'));
  assert.ok(config.verification.visualRequiredChecks.includes('visual:test'));
  assert.ok(config.onboarding.profiles.includes('react'));
  assert.equal(config.checks['visual:test'].command, 'npm run visual:test');
  assert.equal(config.checks['visual:test'].requireArtifacts, true);
});

test('bootstrap dry-run profile reports config changes without writing files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-bootstrap-'));

  const operations = bootstrap(target, { dryRun: true, profile: 'backend', skipDoctor: true });

  assert.ok(operations.some((entry) => entry.includes('apply bootstrap profile backend')));
  assert.equal(fs.existsSync(path.join(target, 'agent-coordination.config.json')), false);
  assert.equal(fs.existsSync(path.join(target, 'package.json')), false);
});

test('bootstrap profile merges existing named domain rules', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-bootstrap-'));
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'target-app', scripts: {} }, null, 2));
  fs.writeFileSync(path.join(target, 'agent-coordination.config.json'), `${JSON.stringify({
    projectName: 'Target App',
    agentIds: ['agent-1'],
    docs: { roots: ['docs'], appNotes: 'docs/ai-agent-app-notes.md', visualWorkflow: '', apiPrefixes: ['docs/api'] },
    paths: { sharedRisk: [], visualSuite: [], visualSuiteDefault: [], visualImpact: [], visualImpactFiles: [] },
    verification: { visualRequiredChecks: [], visualSuiteUpdateChecks: [] },
    pathClassification: { productPrefixes: [], dataPrefixes: [], verifyPrefixes: [], docsPrefixes: [], docsFiles: [] },
    planning: { defaultDomains: [], productFallbackPaths: [], dataFallbackPaths: [], verifyFallbackPaths: [], docsFallbackPaths: [] },
    domainRules: [{ name: 'backend', keywords: ['existing'], scopes: { data: ['existing-api'] } }],
  }, null, 2)}\n`);

  bootstrap(target, { profile: 'backend', skipDoctor: true });
  const config = JSON.parse(fs.readFileSync(path.join(target, 'agent-coordination.config.json'), 'utf8'));
  const backendRule = config.domainRules.find((rule) => rule.name === 'backend');

  assert.equal(config.domainRules.filter((rule) => rule.name === 'backend').length, 1);
  assert.ok(backendRule.keywords.includes('existing'));
  assert.ok(backendRule.keywords.includes('migration'));
  assert.ok(backendRule.scopes.data.includes('existing-api'));
  assert.ok(backendRule.scopes.data.includes('migrations'));
  assert.ok(config.onboarding.profiles.includes('backend'));
});
