const DEFAULT_SIZING = {
  minAgents: 1,
  maxAgents: 4,
  mediumComplexityScore: 10,
  largeComplexityScore: 16,
  productKeywords: ['app', 'ui', 'screen', 'page', 'view', 'component', 'layout', 'modal', 'button', 'nav', 'mobile', 'desktop', 'polish', 'feature'],
  dataKeywords: ['api', 'backend', 'server', 'database', 'db', 'schema', 'migration', 'auth', 'state', 'store', 'query', 'cache', 'sync', 'integration'],
  verifyKeywords: ['test', 'tests', 'verify', 'verification', 'snapshot', 'playwright', 'coverage', 'qa'],
  docsKeywords: ['doc', 'docs', 'documentation', 'readme', 'notes', 'guide', 'roadmap', 'changelog'],
};

function normalizeWords(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function normalizeList(value, fallback) {
  return Array.isArray(value) && value.length ? value.map((entry) => String(entry).toLowerCase()) : fallback;
}

function keywordScore(words, keywords) {
  const wordSet = new Set(words);
  return keywords.reduce((total, keyword) => total + (wordSet.has(keyword) ? 1 : 0), 0);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function normalizePlannerSizing(config = {}, agentCount = DEFAULT_SIZING.maxAgents) {
  const sizing = config.planning?.agentSizing || config.agentSizing || {};
  const maxAvailable = Math.max(1, agentCount || DEFAULT_SIZING.maxAgents);
  return {
    minAgents: clamp(Number.isInteger(sizing.minAgents) ? sizing.minAgents : DEFAULT_SIZING.minAgents, 1, maxAvailable),
    maxAgents: clamp(Number.isInteger(sizing.maxAgents) ? sizing.maxAgents : Math.min(DEFAULT_SIZING.maxAgents, maxAvailable), 1, maxAvailable),
    mediumComplexityScore: Number.isInteger(sizing.mediumComplexityScore) ? sizing.mediumComplexityScore : DEFAULT_SIZING.mediumComplexityScore,
    largeComplexityScore: Number.isInteger(sizing.largeComplexityScore) ? sizing.largeComplexityScore : DEFAULT_SIZING.largeComplexityScore,
    productKeywords: normalizeList(sizing.productKeywords, DEFAULT_SIZING.productKeywords),
    dataKeywords: normalizeList(sizing.dataKeywords, DEFAULT_SIZING.dataKeywords),
    verifyKeywords: normalizeList(sizing.verifyKeywords, DEFAULT_SIZING.verifyKeywords),
    docsKeywords: normalizeList(sizing.docsKeywords, DEFAULT_SIZING.docsKeywords),
  };
}

export function classifyPlannerLanes(summary, config = {}, agentCount = DEFAULT_SIZING.maxAgents) {
  const sizing = normalizePlannerSizing(config, agentCount);
  const words = normalizeWords(summary);
  const scores = {
    product: keywordScore(words, sizing.productKeywords),
    data: keywordScore(words, sizing.dataKeywords),
    verify: keywordScore(words, sizing.verifyKeywords),
    docs: keywordScore(words, sizing.docsKeywords),
  };
  const complexityScore = words.length + scores.product * 3 + scores.data * 3 + scores.verify * 2 + scores.docs * 2;
  const activeLanes = Object.entries(scores).filter(([, score]) => score > 0).map(([lane]) => lane);

  if (!activeLanes.length) activeLanes.push('product');

  let recommendedAgents = sizing.minAgents;
  if (complexityScore >= sizing.largeComplexityScore) recommendedAgents = Math.max(recommendedAgents, Math.min(activeLanes.length, sizing.maxAgents));
  else if (complexityScore >= sizing.mediumComplexityScore) recommendedAgents = Math.max(recommendedAgents, Math.min(Math.max(2, activeLanes.length), sizing.maxAgents));
  recommendedAgents = clamp(recommendedAgents, sizing.minAgents, sizing.maxAgents);

  const lanes = activeLanes.slice(0, recommendedAgents);
  while (lanes.length < recommendedAgents) lanes.push(`support-${lanes.length + 1}`);

  return {
    words,
    scores,
    complexityScore,
    recommendedAgents,
    lanes,
  };
}
