import { hasFlag } from './args-utils.mjs';
import { buildOwnershipReview } from './impact-commands.mjs';
import { normalizePath } from './path-utils.mjs';

export const DEFAULT_POLICY_ENFORCEMENT = {
  mode: 'warn',
  rules: {
    broadClaims: true,
    codeownersCrossing: true,
    finishRequiresApproval: false,
    finishRequiresDocsReview: false,
    finishApprovalScope: '',
  },
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function booleanRule(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

export function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : [];
}

export function normalizePolicyScope(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizePolicyEnforcement(config = {}) {
  const rawPolicy = isPlainObject(config.policyEnforcement) ? config.policyEnforcement : {};
  const rawRules = isPlainObject(rawPolicy.rules) ? rawPolicy.rules : {};
  const defaultRules = DEFAULT_POLICY_ENFORCEMENT.rules;
  return {
    mode: rawPolicy.mode === 'block' ? 'block' : 'warn',
    rules: {
      broadClaims: booleanRule(rawRules.broadClaims, defaultRules.broadClaims),
      codeownersCrossing: booleanRule(rawRules.codeownersCrossing, defaultRules.codeownersCrossing),
      finishRequiresApproval: booleanRule(rawRules.finishRequiresApproval, defaultRules.finishRequiresApproval),
      finishRequiresDocsReview: booleanRule(rawRules.finishRequiresDocsReview, defaultRules.finishRequiresDocsReview),
      finishApprovalScope: normalizePolicyScope(rawRules.finishApprovalScope ?? defaultRules.finishApprovalScope),
    },
  };
}

export function policyEnabledRules(policy) {
  return Object.entries(policy.rules)
    .filter(([name, value]) => typeof value === 'boolean' && value)
    .map(([name]) => name);
}

function makeFinding(policy, rule, message, extra = {}) {
  return {
    rule,
    mode: policy.mode,
    level: policy.mode === 'block' ? 'error' : 'warning',
    message,
    ...extra,
  };
}

function collectOwnershipPolicyFindings({ root, config, board, activeStatuses, policy }) {
  const review = buildOwnershipReview({ root, config, board, activeStatuses });
  const findings = [];
  const details = Array.isArray(review.findingDetails) ? review.findingDetails : [];

  for (const detail of details) {
    if (detail.type === 'broad-claim' && policy.rules.broadClaims) {
      findings.push(makeFinding(policy, 'broadClaims', detail.message, { taskId: detail.taskId, paths: detail.paths ?? [] }));
    }
    if (detail.type === 'codeowners-crossing' && policy.rules.codeownersCrossing) {
      findings.push(makeFinding(policy, 'codeownersCrossing', detail.message, { taskId: detail.taskId, owners: detail.owners ?? [] }));
    }
  }

  return { codeownersPath: review.codeownersPath, findings };
}

export function hasApprovedTaskApproval(board, taskId, scope = '') {
  const normalizedScope = normalizePolicyScope(scope);
  const approvals = Array.isArray(board?.approvals) ? board.approvals : [];
  return approvals.some((approval) =>
    approval?.taskId === taskId
    && (approval.status === 'approved' || approval.status === 'used')
    && (!normalizedScope || approval.scope === normalizedScope)
  );
}

export function buildFinishPolicyPreflight({ config, board, taskId }) {
  const policy = normalizePolicyEnforcement(config);
  const task = Array.isArray(board?.tasks) ? board.tasks.find((entry) => entry.id === taskId) : null;
  const findings = [];
  const hasFinishPolicy = policy.rules.finishRequiresDocsReview || policy.rules.finishRequiresApproval;

  if (!hasFinishPolicy) {
    return { ok: true, blocking: false, mode: policy.mode, findings };
  }

  if (!task) {
    return { ok: false, blocking: true, mode: policy.mode, findings: [makeFinding(policy, 'finishTaskExists', `Task ${taskId} was not found.`, { taskId })] };
  }

  if (policy.rules.finishRequiresDocsReview && !task.docsReviewedAt) {
    findings.push(makeFinding(policy, 'finishRequiresDocsReview', `Task ${taskId} has not recorded docsReviewedAt.`, { taskId }));
  }

  if (policy.rules.finishRequiresApproval && !hasApprovedTaskApproval(board, taskId, policy.rules.finishApprovalScope)) {
    const scopeLabel = policy.rules.finishApprovalScope ? ` for scope ${policy.rules.finishApprovalScope}` : '';
    findings.push(makeFinding(policy, 'finishRequiresApproval', `Task ${taskId} is missing an approved approval-ledger entry${scopeLabel}.`, { taskId, scope: policy.rules.finishApprovalScope }));
  }

  const blocking = policy.mode === 'block' && findings.length > 0;
  return { ok: !blocking, blocking, mode: policy.mode, findings };
}

export function buildClaimPolicyPreflight({ root, config, agentId, taskId, claimedPaths }) {
  const policy = normalizePolicyEnforcement(config);
  const normalizedPaths = stringArray(claimedPaths).map((entry) => normalizePath(entry));
  const activeStatuses = new Set(['active']);
  const board = {
    tasks: [{ id: taskId || 'claim', ownerId: agentId || null, status: 'active', claimedPaths: normalizedPaths }],
  };
  const ownership = collectOwnershipPolicyFindings({ root, config, board, activeStatuses, policy });
  const blocking = policy.mode === 'block' && ownership.findings.length > 0;
  return {
    ok: !blocking,
    blocking,
    mode: policy.mode,
    enabledRules: policyEnabledRules(policy),
    codeownersPath: ownership.codeownersPath,
    claimedPaths: normalizedPaths,
    findings: ownership.findings,
  };
}

export function buildPolicyCheck({ root, config, board, activeStatuses }) {
  const policy = normalizePolicyEnforcement(config);
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const ownership = collectOwnershipPolicyFindings({ root, config, board: { ...board, tasks }, activeStatuses, policy });
  const findings = [...ownership.findings];

  for (const task of tasks) {
    if (!activeStatuses.has(task.status)) continue;
    if (policy.rules.finishRequiresDocsReview && !task.docsReviewedAt) {
      findings.push(makeFinding(policy, 'finishRequiresDocsReview', `Task ${task.id} has not recorded docsReviewedAt.`, { taskId: task.id }));
    }
    if (policy.rules.finishRequiresApproval && !hasApprovedTaskApproval(board, task.id, policy.rules.finishApprovalScope)) {
      const scopeLabel = policy.rules.finishApprovalScope ? ` for scope ${policy.rules.finishApprovalScope}` : '';
      findings.push(makeFinding(policy, 'finishRequiresApproval', `Task ${task.id} is missing an approved approval-ledger entry${scopeLabel}.`, { taskId: task.id, scope: policy.rules.finishApprovalScope }));
    }
  }

  const blocking = policy.mode === 'block' && findings.length > 0;
  return {
    ok: !blocking,
    mode: policy.mode,
    blocking,
    enabledRules: policyEnabledRules(policy),
    codeownersPath: ownership.codeownersPath,
    findings,
  };
}

export function renderPolicyFindings(findings) {
  if (!findings.length) return '- no policy findings';
  return findings.map((finding) => `- ${finding.level}: [${finding.rule}] ${finding.message}`).join('\n');
}

export function runPolicyCheck(argv, context) {
  const result = buildPolicyCheck(context);
  if (hasFlag(argv, '--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('# Policy Check');
    console.log(`Mode: ${result.mode}`);
    console.log(`Enabled rules: ${result.enabledRules.length ? result.enabledRules.join(', ') : 'none'}`);
    console.log(`CODEOWNERS: ${result.codeownersPath ?? 'not found'}`);
    console.log(renderPolicyFindings(result.findings));
  }
  return result.ok ? 0 : 1;
}
