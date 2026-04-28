import test from 'node:test';
import assert from 'node:assert/strict';

import { validateAgentConfig } from '../scripts/validate-config.mjs';

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
  config.checks.unit.timeoutMs = 500;
  config.checks.unit.requireArtifacts = 'yes';

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
  assert.ok(result.errors.some((entry) => entry.includes('checks.unit.timeoutMs')));
  assert.ok(result.errors.some((entry) => entry.includes('checks.unit.requireArtifacts')));
});
