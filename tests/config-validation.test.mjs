import test from 'node:test';
import assert from 'node:assert/strict';

import { validateAgentConfig } from '../scripts/validate-config.mjs';

function validConfig() {
  return {
    projectName: 'Example App',
    agentIds: ['agent-1', 'agent-2'],
    docs: {
      roots: ['docs'],
      appNotes: 'docs/ai-agent-app-notes.md',
      visualWorkflow: '',
      apiPrefixes: ['docs/api'],
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
  config.planning.agentSizing.minAgents = 3;
  config.planning.agentSizing.maxAgents = 2;
  config.domainRules[0].keywords = [];

  const result = validateAgentConfig(config, { root: process.cwd() });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.includes('agentIds[1]')));
  assert.ok(result.errors.some((entry) => entry.includes('minAgents cannot be greater than maxAgents')));
  assert.ok(result.errors.some((entry) => entry.includes('domainRules[0].keywords')));
});
