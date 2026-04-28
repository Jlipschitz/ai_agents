import { nowIso } from './file-utils.mjs';
import { normalizePath } from './path-utils.mjs';

function normalizePaths(inputs) {
  return [...new Set(inputs.map((entry) => normalizePath(entry)).filter(Boolean))].sort();
}

export function createPlannerCommands(context) {
  const {
    agentIds,
    appendJournalLine,
    appAgentNotesDoc,
    classifyGitPaths,
    coordinationReadmePath,
    defaultAgentIds,
    defaultDomainNames,
    domainRules,
    getBoard,
    getGitChangedPaths,
    inferDomainsFromPaths,
    inferRelevantDocs,
    plannedTaskStatus,
    planningAgentSizing,
    planningDataFallbackPaths,
    planningDocsFallbackPaths,
    planningProductFallbackPaths,
    planningVerifyFallbackPaths,
    saveBoard,
    slugify,
    visualRequiredChecks,
    visualSuiteDefaultPaths,
    visualSuiteUpdateChecks,
    withMutationLock,
  } = context;

  function mergePaths(...pathGroups) {
    return normalizePaths(pathGroups.flat());
  }

  function getSuggestedAgent(index) {
    return agentIds[index] ?? agentIds[agentIds.length - 1] ?? defaultAgentIds[index] ?? defaultAgentIds[0];
  }

  function hasAnyToken(tokens, keywords) {
    return keywords.some((keyword) => tokens.includes(keyword));
  }

  function collectExplicitMatchedDomains(goal) {
    const loweredGoal = goal.toLowerCase();
    return domainRules.filter((rule) => rule.keywords.some((keyword) => loweredGoal.includes(keyword)));
  }

  function collectMatchedDomains(goal) {
    const matched = collectExplicitMatchedDomains(goal);
    if (matched.length) {
      return matched;
    }

    const defaultDomains = domainRules.filter((rule) => defaultDomainNames.includes(rule.name));
    return defaultDomains.length ? defaultDomains : domainRules.slice(0, 1);
  }

  function buildPlanSizing({ goal, gitBuckets, effectiveDomains, explicitDomains, complexityScore }) {
    const tokens = [...new Set(String(goal || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3))];
    const dataSignal = Boolean(gitBuckets.data.length) || hasAnyToken(tokens, planningAgentSizing.dataKeywords);
    const verifySignal = Boolean(gitBuckets.verify.length) || hasAnyToken(tokens, planningAgentSizing.verifyKeywords);
    const docsSignal = Boolean(gitBuckets.docs.length) || hasAnyToken(tokens, planningAgentSizing.docsKeywords);
    const productKeywordSignal = Boolean(gitBuckets.product.length) || hasAnyToken(tokens, planningAgentSizing.productKeywords);
    const explicitNonDocsDomain = explicitDomains.some((rule) => rule.name !== 'docs');
    const docsOnly = docsSignal && !dataSignal && !verifySignal && !productKeywordSignal && !explicitNonDocsDomain;
    const dataOnly = dataSignal && !docsSignal && !verifySignal && !productKeywordSignal && !explicitDomains.some((rule) => rule.scopes.product.length);
    const verifyOnly = verifySignal && !docsSignal && !dataSignal && !productKeywordSignal && !explicitDomains.some((rule) => rule.scopes.product.length);
    const productSignal = !docsOnly && !dataOnly && !verifyOnly;
    const mediumComplexity = complexityScore >= planningAgentSizing.mediumComplexityScore;
    const largeComplexity = complexityScore >= planningAgentSizing.largeComplexityScore;
    const visualConfigured = visualRequiredChecks.length > 0 || visualSuiteUpdateChecks.length > 0;
    const lanes = [];
    const reasons = [];

    if (docsOnly) {
      lanes.push('docs');
      reasons.push('docs-only goal');
    } else if (verifyOnly) {
      lanes.push('verify');
      reasons.push('verification-only goal');
    } else if (dataOnly) {
      lanes.push('data');
      reasons.push('data-only goal');
    } else {
      if (productSignal) {
        lanes.push('product');
        reasons.push(productKeywordSignal ? 'product/UI signal' : 'default implementation lane');
      }

      if (dataSignal) {
        lanes.push('data');
        reasons.push('data/backend signal');
      }

      if (verifySignal || (visualConfigured && productSignal && (dataSignal || mediumComplexity))) {
        lanes.push('verify');
        reasons.push(verifySignal ? 'verification signal' : 'medium UI/data complexity');
      }

      if (docsSignal || largeComplexity) {
        lanes.push('docs');
        reasons.push(docsSignal ? 'documentation signal' : 'large complexity needs docs cleanup');
      }
    }

    const dedupedLanes = [...new Set(lanes)];
    const maxAgents = Math.max(1, Math.min(planningAgentSizing.maxAgents, agentIds.length || defaultAgentIds.length));
    const minAgents = Math.max(1, Math.min(planningAgentSizing.minAgents, maxAgents));
    const cappedLanes = dedupedLanes.slice(0, maxAgents);

    if (cappedLanes.length < minAgents) {
      for (const lane of ['product', 'data', 'verify', 'docs']) {
        if (cappedLanes.length >= minAgents) {
          break;
        }
        if (!cappedLanes.includes(lane)) {
          cappedLanes.push(lane);
        }
      }
    }

    return {
      lanes: cappedLanes,
      agentCount: cappedLanes.length,
      availableAgentCount: agentIds.length,
      reason: reasons.join('; ') || 'minimal default split',
      complexityScore,
    };
  }

  function buildPlanProposal(goal, options = {}) {
    const gitState = options.gitChanges ? getGitChangedPaths() : { available: false, paths: [] };
    const pathDomains = gitState.paths.length ? inferDomainsFromPaths(gitState.paths) : [];
    const explicitKeywordDomains = collectExplicitMatchedDomains(goal);
    const keywordDomains = explicitKeywordDomains.length ? explicitKeywordDomains : collectMatchedDomains(goal);
    const combinedDomains = [...new Set([...pathDomains, ...keywordDomains])];
    const matchedDomains = domainRules.filter((rule) => combinedDomains.includes(rule.name));
    const effectiveDomains = matchedDomains.length ? matchedDomains : keywordDomains;
    const createdAt = nowIso();
    const goalSlug = slugify(goal) || 'work';
    const planId = `plan-${goalSlug}-${Date.now()}`;

    const gitBuckets = classifyGitPaths(gitState.paths);

    const productPaths = mergePaths(
      gitBuckets.product,
      effectiveDomains.flatMap((rule) => rule.scopes.product),
      planningProductFallbackPaths
    );
    const dataPaths = mergePaths(
      gitBuckets.data,
      effectiveDomains.flatMap((rule) => rule.scopes.data),
      planningDataFallbackPaths
    );
    const verifyPaths = mergePaths(
      gitBuckets.verify,
      effectiveDomains.flatMap((rule) => rule.scopes.verify),
      visualSuiteDefaultPaths,
      planningVerifyFallbackPaths
    );
    const docsPaths = mergePaths(
      gitBuckets.docs,
      effectiveDomains.flatMap((rule) => rule.scopes.docs),
      planningDocsFallbackPaths,
      [appAgentNotesDoc, coordinationReadmePath]
    );

    const focusLabel = effectiveDomains.map((rule) => rule.name).join(', ');
    const gitSummary = gitState.available
      ? gitState.paths.length
        ? `Git changed paths influenced the split (${gitState.paths.length} file(s)).`
        : 'Git was available, but no changed paths were detected.'
      : 'Git changed paths were not available, so the planner used repo heuristics only.';
    const complexityScore = goal.toLowerCase().split(/\s+/).filter(Boolean).length + effectiveDomains.length * 2 + gitState.paths.length;
    const productEffort = complexityScore >= 12 ? 'large' : 'medium';
    const dataEffort = complexityScore >= 14 ? 'large' : 'medium';
    const verifyEffort = complexityScore >= 10 ? 'medium' : 'small';
    const docsEffort = gitBuckets.docs.length > 3 ? 'medium' : 'small';
    const sizing = buildPlanSizing({
      goal,
      gitBuckets,
      effectiveDomains,
      explicitDomains: explicitKeywordDomains,
      complexityScore,
    });

    const taskByLane = {
      product: {
        id: `${goalSlug}-product`,
        ownerId: null,
        lastOwnerId: null,
        suggestedOwnerId: getSuggestedAgent(0),
        status: plannedTaskStatus,
        summary: `Product surface changes for: ${goal}`,
        claimedPaths: productPaths,
        dependencies: [],
        verification: ['typecheck'],
        verificationLog: [],
        relevantDocs: inferRelevantDocs(productPaths, `Product surface changes for: ${goal}`, ['typecheck']),
        docsReviewedAt: null,
        docsReviewedBy: null,
        rationale: `UI-facing work was grouped around ${focusLabel}. ${gitSummary}`,
        effort: productEffort,
        createdAt,
        updatedAt: createdAt,
        lastHandoff: null,
        planId,
        notes: [
          {
            at: createdAt,
            agent: 'planner',
            kind: 'plan',
            body: `Planner split generated from goal. Focus domains: ${focusLabel}. ${gitSummary}`,
          },
        ],
      },
      data: {
        id: `${goalSlug}-data`,
        ownerId: null,
        lastOwnerId: null,
        suggestedOwnerId: getSuggestedAgent(1),
        status: plannedTaskStatus,
        summary: `Data, state, and integration work for: ${goal}`,
        claimedPaths: dataPaths,
        dependencies: [`${goalSlug}-product`],
        verification: ['typecheck'],
        verificationLog: [],
        relevantDocs: inferRelevantDocs(dataPaths, `Data, state, and integration work for: ${goal}`, ['typecheck']),
        docsReviewedAt: null,
        docsReviewedBy: null,
        rationale: `State and API files were isolated so contract changes stay coordinated in one lane before verification starts. ${gitSummary}`,
        effort: dataEffort,
        createdAt,
        updatedAt: createdAt,
        lastHandoff: null,
        planId,
        notes: [
          {
            at: createdAt,
            agent: 'planner',
            kind: 'plan',
            body: `Planner assigned data-facing scope. Focus domains: ${focusLabel}. ${gitSummary}`,
          },
        ],
      },
      verify: {
        id: `${goalSlug}-verify`,
        ownerId: null,
        lastOwnerId: null,
        suggestedOwnerId: getSuggestedAgent(2),
        status: plannedTaskStatus,
        summary: `Verification and visual coverage for: ${goal}`,
        claimedPaths: verifyPaths,
        dependencies: [`${goalSlug}-product`, `${goalSlug}-data`],
        verification: [...visualSuiteUpdateChecks, 'typecheck'],
        verificationLog: [],
        relevantDocs: inferRelevantDocs(verifyPaths, `Verification and visual coverage for: ${goal}`, [...visualSuiteUpdateChecks, 'typecheck']),
        docsReviewedAt: null,
        docsReviewedBy: null,
        rationale: `Visual routes, fixtures, and snapshots were grouped separately so intentional UI changes refresh the visual suite before final verification. ${gitSummary}`,
        effort: verifyEffort,
        createdAt,
        updatedAt: createdAt,
        lastHandoff: null,
        planId,
        notes: [
          {
            at: createdAt,
            agent: 'planner',
            kind: 'plan',
            body: `Planner assigned verification scope. Focus domains: ${focusLabel}. ${gitSummary}`,
          },
        ],
      },
      docs: {
        id: `${goalSlug}-docs`,
        ownerId: null,
        lastOwnerId: null,
        suggestedOwnerId: getSuggestedAgent(3),
        status: plannedTaskStatus,
        summary: `Documentation and coordination cleanup for: ${goal}`,
        claimedPaths: docsPaths,
        dependencies: [`${goalSlug}-product`, `${goalSlug}-data`],
        verification: ['docs-review'],
        verificationLog: [],
        relevantDocs: inferRelevantDocs(docsPaths, `Documentation and coordination cleanup for: ${goal}`, ['docs-review']),
        docsReviewedAt: null,
        docsReviewedBy: null,
        rationale: `Docs and coordination updates are split out so delivery notes can track the final merged behavior rather than drafts. ${gitSummary}`,
        effort: docsEffort,
        createdAt,
        updatedAt: createdAt,
        lastHandoff: null,
        planId,
        notes: [
          {
            at: createdAt,
            agent: 'planner',
            kind: 'plan',
            body: `Planner assigned documentation and wrap-up scope. Focus domains: ${focusLabel}. ${gitSummary}`,
          },
        ],
      },
    };

    const tasks = sizing.lanes
      .map((lane) => taskByLane[lane])
      .filter(Boolean);
    const selectedTaskIds = new Set(tasks.map((task) => task.id));

    for (const [index, task] of tasks.entries()) {
      task.suggestedOwnerId = getSuggestedAgent(index);
      task.dependencies = task.dependencies.filter((dependencyId) => selectedTaskIds.has(dependencyId));
    }

    return {
      id: planId,
      goal,
      createdAt,
      matchedDomains: effectiveDomains.map((rule) => rule.name),
      gitAvailable: gitState.available,
      gitChangedPaths: gitState.paths,
      agentCount: sizing.agentCount,
      availableAgentCount: sizing.availableAgentCount,
      sizingReason: sizing.reason,
      complexityScore: sizing.complexityScore,
      tasks,
    };
  }

  function renderPlan(plan) {
    const lines = [];
    lines.push(`Plan: ${plan.id}`);
    lines.push(`Goal: ${plan.goal}`);
    lines.push(`Domains: ${plan.matchedDomains.join(', ')}`);
    lines.push(`Git changed paths: ${plan.gitAvailable ? (plan.gitChangedPaths.length ? plan.gitChangedPaths.join(', ') : 'none detected') : 'unavailable'}`);
    lines.push(`Suggested agents: ${plan.agentCount ?? plan.tasks.length}/${plan.availableAgentCount ?? agentIds.length} | complexity ${plan.complexityScore ?? 'unknown'} | ${plan.sizingReason ?? 'default split'}`);
    lines.push('');

    for (const task of plan.tasks) {
      lines.push(`- ${task.suggestedOwnerId} -> ${task.id}`);
      lines.push(`  Summary: ${task.summary}`);
      lines.push(`  Paths: ${task.claimedPaths.join(', ') || 'none'}`);
      lines.push(`  Depends on: ${task.dependencies.join(', ') || 'none'}`);
      lines.push(`  Effort: ${task.effort}`);
      lines.push(`  Verify: ${task.verification.join(', ') || 'none'}`);
      lines.push(`  Docs: ${task.relevantDocs.join(', ') || 'none suggested'}`);
      lines.push(`  Why: ${task.rationale}`);
    }

    return lines.join('\n');
  }

  async function planCommand(positionals, options) {
    const goal = positionals.join(' ').trim();

    if (!goal) {
      throw new Error('Usage: plan <goal> [--apply] [--git-changes]');
    }

    const plan = buildPlanProposal(goal, {
      gitChanges: Boolean(options['git-changes']),
    });

    if (!options.apply) {
      console.log(renderPlan(plan));
      console.log('\nRun the same command with --apply to persist these planned tasks.');
      return;
    }

    await withMutationLock(async () => {
      const board = getBoard();
      const plannedTaskIds = new Set(plan.tasks.map((task) => task.id));
      const unsafeCollisions = board.tasks.filter(
        (task) => plannedTaskIds.has(task.id) && (task.status !== plannedTaskStatus || task.ownerId)
      );

      if (unsafeCollisions.length) {
        const summary = unsafeCollisions.map((task) => `${task.id} (${task.status}${task.ownerId ? `, owner ${task.ownerId}` : ''})`).join(', ');
        throw new Error(
          `Plan apply refused because task id(s) already exist outside an unowned planned state: ${summary}. Use a more specific goal or manually release/rename the existing task first.`
        );
      }

      board.tasks = board.tasks.filter((task) => !(plannedTaskIds.has(task.id) && task.status === plannedTaskStatus && !task.ownerId));
      board.plans = board.plans.filter((entry) => entry.id !== plan.id);
      board.plans.push({
        id: plan.id,
        goal: plan.goal,
        createdAt: plan.createdAt,
        matchedDomains: plan.matchedDomains,
        gitAvailable: plan.gitAvailable,
        gitChangedPaths: plan.gitChangedPaths,
        agentCount: plan.agentCount,
        availableAgentCount: plan.availableAgentCount,
        sizingReason: plan.sizingReason,
        complexityScore: plan.complexityScore,
      });
      board.tasks.push(...plan.tasks);

      appendJournalLine(`- ${plan.createdAt} | planner created \`${plan.id}\` for goal: ${plan.goal}`);
      await saveBoard(board);
      console.log(renderPlan(plan));
      console.log('\nPlanned tasks saved. Agents can now claim these task ids directly.');
    });
  }

  return { planCommand };
}
