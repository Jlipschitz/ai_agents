import { nowIso } from './file-utils.mjs';
import { normalizePath } from './path-utils.mjs';
import { formatTaskDueAt, taskMetadataFromOptions } from './task-metadata.mjs';
import { classifyPlannerLanes } from '../planner-sizing.mjs';

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
    const laneSignals = [
      gitBuckets.product.length ? 'product ui component feature' : '',
      gitBuckets.data.length ? 'data api backend database integration' : '',
      gitBuckets.verify.length ? 'verify test coverage qa' : '',
      gitBuckets.docs.length ? 'docs documentation readme guide' : '',
      effectiveDomains.map((rule) => rule.name).join(' '),
      explicitDomains.map((rule) => rule.keywords.join(' ')).join(' '),
      visualRequiredChecks.length || visualSuiteUpdateChecks.length ? 'verify visual test' : '',
    ].filter(Boolean).join(' ');
    const classification = classifyPlannerLanes(`${goal} ${laneSignals}`, { planning: { agentSizing: planningAgentSizing } }, agentIds.length || defaultAgentIds.length);
    const cappedLanes = classification.lanes
      .map((lane) => (lane.startsWith('support-') ? 'product' : lane))
      .filter((lane) => ['product', 'data', 'verify', 'docs'].includes(lane));
    const lanes = [...new Set(cappedLanes.length ? cappedLanes : ['product'])];
    const activeScores = Object.entries(classification.scores)
      .filter(([, score]) => score > 0)
      .map(([lane, score]) => `${lane}:${score}`);
    const reason = activeScores.length
      ? `shared planner sizing (${activeScores.join(', ')})`
      : 'shared planner sizing default';

    return {
      lanes,
      agentCount: lanes.length,
      availableAgentCount: agentIds.length,
      reason,
      complexityScore: classification.complexityScore || complexityScore,
      classification,
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
    const taskMetadata = taskMetadataFromOptions(options, { includeDefaults: true });
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
        ...taskMetadata,
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
        ...taskMetadata,
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
        ...taskMetadata,
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
        ...taskMetadata,
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
      plannerSizing: sizing.classification,
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
      lines.push(`  Priority: ${task.priority}`);
      lines.push(`  Due: ${formatTaskDueAt(task.dueAt)}`);
      lines.push(`  Severity: ${task.severity}`);
      lines.push(`  Verify: ${task.verification.join(', ') || 'none'}`);
      lines.push(`  Docs: ${task.relevantDocs.join(', ') || 'none suggested'}`);
      lines.push(`  Why: ${task.rationale}`);
    }

    return lines.join('\n');
  }

  async function planCommand(positionals, options) {
    const goal = positionals.join(' ').trim();

    if (!goal) {
      throw new Error('Usage: plan <goal> [--apply] [--git-changes] [--priority <level>] [--due-at <date>] [--severity <level>]');
    }

    const planOptions = { gitChanges: Boolean(options['git-changes']) };
    for (const key of ['priority', 'severity', 'due-at', 'due']) {
      if (Object.prototype.hasOwnProperty.call(options, key)) planOptions[key] = options[key];
    }
    const plan = buildPlanProposal(goal, planOptions);

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
        plannerSizing: plan.plannerSizing,
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
