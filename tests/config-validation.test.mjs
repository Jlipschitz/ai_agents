import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadAgentConfigWithSources, validateAgentConfig } from '../scripts/validate-config.mjs';

function validConfig() {
  return {
    configVersion: 1,
    projectName: 'Example App',
    agentIds: ['agent-1', 'agent-2'],
    docs: {
      roots: ['docs'],
      appNotes: 'docs/ai-agent-app-notes.md',
      visualWorkflow: '',
      apiPrefixes: ['docs/api'],
    },
    git: {
      allowMainBranchClaims: true,
      allowDetachedHead: false,
      allowedBranchPatterns: [],
      defaultBaseBranch: 'main',
      staleBranchDays: 30,
      protectedBranchPatterns: ['main', 'release/*'],
    },
    paths: {
      sharedRisk: ['scripts'],
      visualSuite: [],
      visualSuiteDefault: [],
      visualImpact: [],
      visualImpactFiles: [],
    },
    verification: {
      requiredChecks: [],
      visualRequiredChecks: [],
      visualSuiteUpdateChecks: [],
    },
    artifacts: {
      roots: ['artifacts'],
      keepDays: 14,
      keepFailedDays: 45,
      maxMb: 500,
      protectPatterns: ['**/baseline/**'],
    },
    capacity: {
      maxActiveTasksPerAgent: 1,
      maxBlockedTasksPerAgent: 1,
      preferredDomainsByAgent: { 'agent-1': ['app'] },
      enforcePreferredDomains: false,
    },
    conflictPrediction: {
      enabled: true,
      blockOnGitOverlap: true,
    },
    ownership: {
      codeownersFiles: ['.github/CODEOWNERS'],
      broadPathPatterns: ['src'],
    },
    policyEnforcement: {
      mode: 'warn',
      rules: {
        broadClaims: true,
        codeownersCrossing: true,
        finishRequiresApproval: false,
        finishRequiresDocsReview: false,
        finishApprovalScope: '',
      },
    },
    privacy: {
      mode: 'standard',
      offline: false,
      redactPatterns: ['customer-token'],
    },
    monorepo: {
      workspaceRoots: ['packages/*', 'apps/web'],
      partialCheckout: true,
      fallbackRoot: '.',
    },
    checks: {
      unit: {
        command: 'npm test',
        timeoutMs: 120000,
        artifactRoots: ['artifacts'],
        requiredForPaths: ['src'],
        requireArtifacts: false,
      },
    },
    notes: {
      categories: ['change', 'setup'],
      sectionHeading: 'Agent-Maintained Notes',
    },
    commandAliases: {
      qa: ['run-check', 'test'],
      whoBlocked: 'ask "what is blocked?"',
    },
    onboarding: {
      profile: 'react',
      profiles: ['backend'],
      checklist: [
        {
          id: 'security-runbook',
          label: 'Security runbook',
          paths: ['docs/security-runbook.md'],
          required: false,
          recommendation: 'Add a security runbook.',
          profile: 'custom',
        },
      ],
    },
    pathClassification: {
      productPrefixes: ['src'],
      dataPrefixes: ['lib'],
      verifyPrefixes: ['tests'],
      docsPrefixes: ['docs'],
      docsFiles: ['README.md'],
    },
    planning: {
      defaultDomains: ['app'],
      productFallbackPaths: ['src'],
      dataFallbackPaths: ['lib'],
      verifyFallbackPaths: ['tests'],
      docsFallbackPaths: ['README.md'],
      agentSizing: {
        minAgents: 1,
        maxAgents: 2,
        mediumComplexityScore: 10,
        largeComplexityScore: 16,
        productKeywords: ['ui'],
        dataKeywords: ['api'],
        verifyKeywords: ['test'],
        docsKeywords: ['docs'],
      },
    },
    domainRules: [
      {
        name: 'app',
        keywords: ['app'],
        scopes: {
          product: ['src'],
          data: ['lib'],
          verify: ['tests'],
          docs: ['README.md'],
        },
      },
    ],
  };
}

test('validateAgentConfig accepts the expected config shape', () => {
  const result = validateAgentConfig(validConfig(), { root: process.cwd() });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateAgentConfig reports actionable errors', () => {
  const config = validConfig();
  config.agentIds = ['agent-1', 'agent-1'];
  config.configVersion = 0;
  config.planning.agentSizing.minAgents = 3;
  config.planning.agentSizing.maxAgents = 2;
  config.domainRules[0].keywords = [];
  config.git.staleBranchDays = -1;
  config.git.protectedBranchPatterns = ['main', 'main'];
  config.artifacts.keepDays = 0;
  config.capacity.maxActiveTasksPerAgent = 0;
  config.capacity.preferredDomainsByAgent['agent-3'] = ['app'];
  config.conflictPrediction.blockOnGitOverlap = 'yes';
  config.ownership.codeownersFiles = ['CODEOWNERS', 'CODEOWNERS'];
  config.policyEnforcement.mode = 'strict';
  config.policyEnforcement.rules.finishRequiresApproval = 'yes';
  config.privacy.mode = 'public';
  config.privacy.offline = 'yes';
  config.privacy.redactPatterns = [''];
  config.verification.requiredChecks = [''];
  config.monorepo.workspaceRoots = ['packages/*', 'packages/*', 'packages/**'];
  config.monorepo.partialCheckout = 'yes';
  config.monorepo.fallbackRoot = 1;
  config.checks.unit.timeoutMs = 500;
  config.checks.unit.requireArtifacts = 'yes';
  config.commandAliases.status = 'summarize';
  config.commandAliases['bad alias'] = ['status'];
  config.commandAliases.badtarget = 'missing-command';
  config.commandAliases.badvalue = 1;
  config.onboarding.profiles = ['react', 'react'];
  config.onboarding.checklist.push({ id: 'security-runbook', paths: ['docs/other.md'] });
  config.onboarding.checklist[0].required = 'yes';
  config.onboarding.checklist[0].paths = [];

  const result = validateAgentConfig(config, { root: process.cwd() });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.includes('agentIds[1]')));
  assert.ok(result.errors.some((entry) => entry.includes('configVersion')));
  assert.ok(result.errors.some((entry) => entry.includes('minAgents cannot be greater than maxAgents')));
  assert.ok(result.errors.some((entry) => entry.includes('domainRules[0].keywords')));
  assert.ok(result.errors.some((entry) => entry.includes('git.staleBranchDays')));
  assert.ok(result.errors.some((entry) => entry.includes('git.protectedBranchPatterns[1]')));
  assert.ok(result.errors.some((entry) => entry.includes('artifacts.keepDays')));
  assert.ok(result.errors.some((entry) => entry.includes('capacity.maxActiveTasksPerAgent')));
  assert.ok(result.warnings.some((entry) => entry.includes('capacity.preferredDomainsByAgent.agent-3')));
  assert.ok(result.errors.some((entry) => entry.includes('conflictPrediction.blockOnGitOverlap')));
  assert.ok(result.errors.some((entry) => entry.includes('ownership.codeownersFiles[1]')));
  assert.ok(result.errors.some((entry) => entry.includes('policyEnforcement.mode')));
  assert.ok(result.errors.some((entry) => entry.includes('policyEnforcement.rules.finishRequiresApproval')));
  assert.ok(result.errors.some((entry) => entry.includes('privacy.mode')));
  assert.ok(result.errors.some((entry) => entry.includes('privacy.offline')));
  assert.ok(result.errors.some((entry) => entry.includes('privacy.redactPatterns[0]')));
  assert.ok(result.errors.some((entry) => entry.includes('verification.requiredChecks[0]')));
  assert.ok(result.errors.some((entry) => entry.includes('monorepo.workspaceRoots[1]')));
  assert.ok(result.errors.some((entry) => entry.includes('monorepo.workspaceRoots[2]')));
  assert.ok(result.errors.some((entry) => entry.includes('monorepo.partialCheckout')));
  assert.ok(result.errors.some((entry) => entry.includes('monorepo.fallbackRoot')));
  assert.ok(result.errors.some((entry) => entry.includes('checks.unit.timeoutMs')));
  assert.ok(result.errors.some((entry) => entry.includes('checks.unit.requireArtifacts')));
  assert.ok(result.errors.some((entry) => entry.includes('commandAliases.status')));
  assert.ok(result.errors.some((entry) => entry.includes('commandAliases.bad alias')));
  assert.ok(result.errors.some((entry) => entry.includes('commandAliases.badtarget')));
  assert.ok(result.errors.some((entry) => entry.includes('commandAliases.badvalue')));
  assert.ok(result.errors.some((entry) => entry.includes('onboarding.profiles[1]')));
  assert.ok(result.errors.some((entry) => entry.includes('onboarding.checklist[0].paths')));
  assert.ok(result.errors.some((entry) => entry.includes('onboarding.checklist[0].required')));
  assert.ok(result.errors.some((entry) => entry.includes('onboarding.checklist[1].id')));
});

test('schema describes command alias shape without duplicating command metadata', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'agent-coordination.schema.json'), 'utf8'));
  const commandAliases = schema.properties.commandAliases;

  assert.equal(commandAliases.propertyNames.pattern, '^[^-\\s][^\\s]*$');
  assert.equal(commandAliases.additionalProperties.oneOf[0].type, 'string');
  assert.equal(commandAliases.additionalProperties.oneOf[1].$ref, '#/$defs/nonEmptyStringArray');
  assert.equal(schema.properties.verification.properties.requiredChecks.$ref, '#/$defs/stringArray');
  assert.equal(schema.properties.privacy.properties.redactPatterns.$ref, '#/$defs/stringArray');
  assert.equal(schema.properties.onboarding.properties.checklist.items.properties.paths.$ref, '#/$defs/nonEmptyStringArray');
  assert.equal(schema.properties.domainRules.items.properties.keywords.$ref, '#/$defs/nonEmptyStringArray');
  assert.equal(schema.$defs.stringArray.items.minLength, 1);
  assert.equal(schema.$defs.commandAliasTarget, undefined);
});

test('loadAgentConfigWithSources merges inherited config files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-config-extends-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  const base = validConfig();
  base.projectName = 'Base App';
  base.agentIds = ['agent-1'];
  base.paths.sharedRisk = ['scripts'];
  base.domainRules = [{ name: 'base', keywords: ['base'], scopes: { product: ['src'], data: ['lib'], verify: ['tests'], docs: ['README.md'] } }];
  fs.writeFileSync(path.join(root, 'config', 'base.json'), `${JSON.stringify(base, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'agent-coordination.config.json'), `${JSON.stringify({
    extends: 'config/base.json',
    projectName: 'Child App',
    agentIds: ['agent-2'],
    paths: { sharedRisk: ['package.json'] },
    domainRules: [{ name: 'child', keywords: ['child'], scopes: { product: ['app'], data: ['api'], verify: ['tests'], docs: ['docs'] } }],
  }, null, 2)}\n`);

  const { config, sources } = loadAgentConfigWithSources(path.join(root, 'agent-coordination.config.json'), { root });
  const validation = validateAgentConfig(config, { root });

  assert.equal(config.projectName, 'Child App');
  assert.deepEqual(config.agentIds, ['agent-1', 'agent-2']);
  assert.deepEqual(config.paths.sharedRisk, ['scripts', 'package.json']);
  assert.deepEqual(config.domainRules.map((rule) => rule.name), ['base', 'child']);
  assert.equal(sources.length, 2);
  assert.equal(validation.valid, true);
});
