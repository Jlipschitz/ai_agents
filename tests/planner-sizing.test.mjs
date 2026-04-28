import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyPlannerLanes, normalizePlannerSizing } from '../scripts/planner-sizing.mjs';

const config = {
  planning: {
    agentSizing: {
      minAgents: 1,
      maxAgents: 4,
      mediumComplexityScore: 10,
      largeComplexityScore: 16,
      productKeywords: ['ui', 'screen', 'component', 'mobile'],
      dataKeywords: ['api', 'database', 'auth', 'sync'],
      verifyKeywords: ['test', 'verify', 'coverage'],
      docsKeywords: ['docs', 'readme', 'guide'],
    },
  },
};

test('normalizePlannerSizing clamps max agents to available agents', () => {
  const sizing = normalizePlannerSizing({ planning: { agentSizing: { minAgents: 1, maxAgents: 10 } } }, 3);
  assert.equal(sizing.maxAgents, 3);
});

test('planner sizing keeps simple UI work to one product lane', () => {
  const result = classifyPlannerLanes('Polish mobile UI screen spacing', config, 4);

  assert.equal(result.scores.product > 0, true);
  assert.equal(result.recommendedAgents, 1);
  assert.deepEqual(result.lanes, ['product']);
});

test('planner sizing splits complex full-stack work across lanes', () => {
  const result = classifyPlannerLanes('Build mobile UI component with auth API database sync tests coverage and docs guide', config, 4);

  assert.equal(result.recommendedAgents, 4);
  assert.deepEqual(result.lanes, ['product', 'data', 'verify', 'docs']);
});

test('planner sizing respects configured maxAgents', () => {
  const limited = {
    planning: {
      agentSizing: {
        ...config.planning.agentSizing,
        maxAgents: 2,
      },
    },
  };

  const result = classifyPlannerLanes('Build mobile UI component with auth API database sync tests coverage and docs guide', limited, 4);

  assert.equal(result.recommendedAgents, 2);
  assert.deepEqual(result.lanes, ['product', 'data']);
});

test('planner sizing falls back to product lane when no keywords match', () => {
  const result = classifyPlannerLanes('Small cleanup', config, 4);

  assert.deepEqual(result.lanes, ['product']);
  assert.equal(result.recommendedAgents, 1);
});
