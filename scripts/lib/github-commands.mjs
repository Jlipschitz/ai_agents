import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { hasFlag } from './args-utils.mjs';
import { execGit } from './git-utils.mjs';
import { getPrivacyOptions } from './privacy-utils.mjs';

function parseGitHubRemote(remoteUrl) {
  const match = String(remoteUrl ?? '').trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, ''),
    url: `https://github.com/${match[1]}/${match[2].replace(/\.git$/i, '')}`,
  };
}

function listWorkflowFiles(root) {
  const workflowRoot = path.join(root, '.github', 'workflows');
  if (!fs.existsSync(workflowRoot)) return [];
  return fs.readdirSync(workflowRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ya?ml)$/i.test(entry.name))
    .map((entry) => path.join(workflowRoot, entry.name));
}

function workflowHasTrigger(content, trigger) {
  return new RegExp(`(^|\\n)\\s*-?\\s*${trigger}\\s*:`, 'i').test(content)
    || new RegExp(`(^|\\n)\\s*-\\s*${trigger}\\s*($|\\n)`, 'i').test(content);
}

function inspectWorkflows(root) {
  return listWorkflowFiles(root).map((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    return {
      path: path.relative(root, filePath).replaceAll('\\', '/'),
      pullRequest: workflowHasTrigger(content, 'pull_request'),
      mergeGroup: workflowHasTrigger(content, 'merge_group'),
    };
  });
}

function runGhPrView(root) {
  const result = spawnSync(process.platform === 'win32' ? 'gh.exe' : 'gh', [
    'pr',
    'view',
    '--json',
    'number,url,state,isDraft,mergeStateStatus,reviewDecision,headRefName,baseRefName',
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) return { available: false, error: result.error.message, pr: null };
  if (result.status !== 0) return { available: true, error: result.stderr.trim() || 'gh pr view failed', pr: null };

  try {
    return { available: true, error: null, pr: JSON.parse(result.stdout) };
  } catch (error) {
    return { available: true, error: `Failed to parse gh output: ${error.message}`, pr: null };
  }
}

function getAheadBehind(root, upstream) {
  if (!upstream) return { ahead: null, behind: null };
  const output = execGit(['rev-list', '--left-right', '--count', `${upstream}...HEAD`], { root });
  if (output === null) return { ahead: null, behind: null };
  const [ahead, behind] = output.split(/\s+/).map((value) => Number.parseInt(value, 10));
  return {
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
  };
}

function flagValues(argv, flag) {
  const values = [];
  const prefix = `${flag}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === flag) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        values.push(next);
        index += 1;
      }
    } else if (entry.startsWith(prefix)) {
      values.push(entry.slice(prefix.length));
    }
  }
  return values;
}

function githubPositionals(argv) {
  const valuedFlags = new Set(['--comment', '--label', '--labels', '--checklist', '--check']);
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith('--')) {
      positionals.push(entry);
      continue;
    }
    const flag = entry.includes('=') ? entry.slice(0, entry.indexOf('=')) : entry;
    if (!entry.includes('=') && valuedFlags.has(flag)) index += 1;
  }
  return positionals;
}

function splitCsv(values) {
  return values.flatMap((value) => String(value ?? '').split(',')).map((entry) => entry.trim()).filter(Boolean);
}

function splitChecklist(values) {
  return values.flatMap((value) => String(value ?? '').split(/\s*\|\s*|,/)).map((entry) => entry.trim()).filter(Boolean);
}

function checkGhTool() {
  const command = process.platform === 'win32' ? 'gh.exe' : 'gh';
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    return { command, available: false, version: null, error: result.error.message };
  }
  if (result.status !== 0) {
    return { command, available: false, version: null, error: result.stderr.trim() || 'gh --version failed' };
  }

  return {
    command,
    available: true,
    version: result.stdout.split(/\r?\n/).find(Boolean) ?? null,
    error: null,
  };
}

function hasGitHubToken(env) {
  return ['GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_PAT', 'GITHUB_ENTERPRISE_TOKEN']
    .some((name) => typeof env?.[name] === 'string' && env[name].trim() !== '');
}

function redactPatternRegex(pattern) {
  const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

function rawPlannedWriteValues(argv) {
  return [
    ...flagValues(argv, '--comment'),
    ...splitCsv([...flagValues(argv, '--label'), ...flagValues(argv, '--labels')]),
    ...splitChecklist([...flagValues(argv, '--checklist'), ...flagValues(argv, '--check')]),
  ];
}

function findSensitiveOutboundMatches(argv, privacy) {
  const patterns = Array.isArray(privacy?.redactPatterns) ? privacy.redactPatterns : [];
  const values = rawPlannedWriteValues(argv);
  const matches = [];
  for (const pattern of patterns) {
    const regex = redactPatternRegex(pattern);
    if (values.some((value) => regex.test(String(value ?? '')))) {
      matches.push(pattern);
    }
  }
  return [...new Set(matches)].sort((left, right) => left.localeCompare(right));
}

function parseGitHubTarget(positionals) {
  const [kindOrTarget, maybeNumber] = positionals;
  const urlMatch = String(kindOrTarget ?? '').match(/github\.com\/([^/\s]+)\/([^/\s]+)\/(pull|issues)\/(\d+)/i);
  if (urlMatch) {
    return {
      targetType: urlMatch[3].toLowerCase() === 'pull' ? 'pr' : 'issue',
      number: Number.parseInt(urlMatch[4], 10),
      repository: { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/i, ''), url: `https://github.com/${urlMatch[1]}/${urlMatch[2].replace(/\.git$/i, '')}` },
      source: 'url',
    };
  }

  const normalizedType = String(kindOrTarget ?? '').toLowerCase();
  if ((normalizedType === 'pr' || normalizedType === 'pull' || normalizedType === 'issue') && maybeNumber) {
    const parsed = Number.parseInt(String(maybeNumber), 10);
    return {
      targetType: normalizedType === 'issue' ? 'issue' : 'pr',
      number: Number.isFinite(parsed) ? parsed : null,
      repository: null,
      source: 'args',
    };
  }

  return { targetType: null, number: null, repository: null, source: 'missing' };
}

function redactedValue(value, privacy) {
  if (!privacy?.redacted) return value;
  return typeof value === 'string' && value.trim() ? '[redacted]' : value;
}

function redactedArray(values, privacy) {
  if (!privacy?.redacted) return values;
  return values.length ? ['[redacted]'] : values;
}

function buildOperations(argv, target, privacy) {
  const comments = flagValues(argv, '--comment');
  const labels = splitCsv([...flagValues(argv, '--label'), ...flagValues(argv, '--labels')]);
  const checklistItems = splitChecklist([...flagValues(argv, '--checklist'), ...flagValues(argv, '--check')]);
  const operations = [];

  for (const body of comments) {
    operations.push({
      type: 'comment',
      targetType: target.targetType,
      number: target.number,
      body: redactedValue(body, privacy),
    });
  }

  if (labels.length) {
    operations.push({
      type: 'label',
      targetType: target.targetType,
      number: target.number,
      labels: redactedArray(labels, privacy),
    });
  }

  if (checklistItems.length) {
    operations.push({
      type: 'checklist-comment',
      targetType: target.targetType,
      number: target.number,
      items: redactedArray(checklistItems, privacy),
      body: privacy?.redacted ? '[redacted]' : checklistItems.map((item) => `- [ ] ${item}`).join('\n'),
    });
  }

  return operations;
}

function blocker(code, message) {
  return { code, message };
}

function buildApplyReadiness({ plan, argv, env }) {
  const gh = checkGhTool();
  const tokenEnvPresent = hasGitHubToken(env);
  const sensitivePatternMatches = findSensitiveOutboundMatches(argv, plan.privacy);
  const plannedWritesRedacted = plan.privacy?.redacted === true && plan.operations.length > 0;
  const blockers = [];
  const warnings = [];

  for (const error of plan.errors) blockers.push(blocker('plan-invalid', error));
  if (!plan.repository) blockers.push(blocker('repository-missing', 'No GitHub repository was resolved for the planned write.'));
  if (!plan.target?.url) blockers.push(blocker('target-missing', 'No GitHub PR or issue target was resolved for the planned write.'));
  if (!plan.operations.length) blockers.push(blocker('operations-missing', 'No outbound GitHub write operations were planned.'));
  if (plan.privacy?.offline) blockers.push(blocker('offline-mode', 'Offline mode is enabled, so future apply must remain blocked.'));
  if (plannedWritesRedacted) blockers.push(blocker('redacted-payload', 'Planned write text is redacted; future apply must not send placeholder content.'));
  if (!plannedWritesRedacted && sensitivePatternMatches.length) {
    blockers.push(blocker('sensitive-unredacted', `Planned write text matches redaction pattern(s): ${sensitivePatternMatches.join(', ')}.`));
  }
  if (!gh.available) blockers.push(blocker('github-cli-missing', 'GitHub CLI was not found or is not runnable.'));
  if (!tokenEnvPresent) {
    blockers.push(blocker('auth-token-missing', 'No GitHub auth token env var was found: GH_TOKEN, GITHUB_TOKEN, GITHUB_PAT, or GITHUB_ENTERPRISE_TOKEN.'));
  }
  if (gh.available && !tokenEnvPresent) {
    warnings.push('GitHub CLI auth was not probed in this read-only check; provide token env for deterministic apply readiness.');
  }

  return {
    checked: hasFlag(argv, '--check-apply-readiness'),
    ready: blockers.length === 0,
    readOnly: true,
    liveWrites: false,
    tool: { gh },
    auth: {
      tokenEnvPresent,
      status: tokenEnvPresent ? 'token-present' : 'token-missing',
      checkedWithoutNetwork: true,
    },
    privacy: {
      mode: plan.privacy?.mode ?? 'standard',
      offline: plan.privacy?.offline === true,
      redacted: plan.privacy?.redacted === true,
      plannedWritesRedacted,
      outboundRedaction: plannedWritesRedacted ? 'active' : 'inactive',
      sensitivePatternMatches,
    },
    blockers,
    warnings,
  };
}

export function buildGitHubWritePlan({ root, argv = [], config = {}, env = process.env }) {
  const privacy = getPrivacyOptions(config, env);
  const remoteUrl = execGit(['config', '--get', 'remote.origin.url'], { root });
  const remoteRepository = parseGitHubRemote(remoteUrl);
  const positionals = githubPositionals(argv);
  const target = parseGitHubTarget(positionals);
  const repository = target.repository ?? remoteRepository;
  const warnings = [];
  const errors = [];

  if (!target.targetType || !target.number) errors.push('Usage: github-plan <pr|issue> <number|url> [--comment <text>] [--label <label[,label...]>] [--checklist <item[|item...]>] [--json] [--apply]');
  if (!repository) warnings.push('remote.origin.url is not a GitHub remote; plan will not include a repository URL.');
  if (privacy.offline) warnings.push('Offline mode is enabled; no GitHub API or CLI writes will be attempted.');

  const operations = target.targetType && target.number ? buildOperations(argv, target, privacy) : [];
  if (!operations.length && !errors.length) errors.push('No GitHub operations requested. Add --comment, --label, or --checklist.');

  const applyRequested = hasFlag(argv, '--apply');
  const readinessRequested = hasFlag(argv, '--check-apply-readiness');
  if (applyRequested) warnings.push('Apply is blocked for GitHub write plans until a future live-write flag exists.');

  const resolvedTarget = {
    type: target.targetType,
    number: target.number,
    url: repository && target.targetType && target.number
      ? `${repository.url}/${target.targetType === 'pr' ? 'pull' : 'issues'}/${target.number}`
      : null,
  };

  const plan = {
    ok: errors.length === 0 && !applyRequested,
    dryRun: true,
    applyRequested,
    readinessRequested,
    blocked: applyRequested,
    liveWrites: false,
    privacy,
    repository,
    remoteUrl,
    target: resolvedTarget,
    operations,
    summary: {
      operationCount: operations.length,
      comments: operations.filter((operation) => operation.type === 'comment').length,
      labels: operations.filter((operation) => operation.type === 'label').reduce((count, operation) => count + (operation.labels?.length ?? 0), 0),
      checklists: operations.filter((operation) => operation.type === 'checklist-comment').length,
    },
    warnings,
    errors,
  };
  plan.applyReadiness = buildApplyReadiness({ plan, argv, env });
  if (readinessRequested && !plan.applyReadiness.ready) plan.ok = false;
  return plan;
}

function renderGitHubWritePlan(plan) {
  const lines = ['# GitHub Write Plan'];
  lines.push(`Mode: dry-run${plan.applyRequested ? ' (apply blocked)' : ''}`);
  lines.push(`Repository: ${plan.repository?.url ?? 'not detected'}`);
  lines.push(`Target: ${plan.target.url ?? 'not resolved'}`);
  if (plan.operations.length) {
    lines.push('Operations:');
    for (const operation of plan.operations) {
      if (operation.type === 'comment') lines.push(`- comment on ${operation.targetType} #${operation.number}: ${operation.body}`);
      else if (operation.type === 'label') lines.push(`- label ${operation.targetType} #${operation.number}: ${operation.labels.join(', ')}`);
      else if (operation.type === 'checklist-comment') lines.push(`- checklist comment on ${operation.targetType} #${operation.number}: ${operation.items.join(', ')}`);
    }
  } else {
    lines.push('Operations: none');
  }
  for (const warning of plan.warnings) lines.push(`- warning: ${warning}`);
  for (const error of plan.errors) lines.push(`- error: ${error}`);
  if (plan.applyReadiness?.checked) {
    lines.push('Apply readiness:');
    lines.push(`- ready: ${plan.applyReadiness.ready ? 'yes' : 'no'}`);
    lines.push(`- auth: ${plan.applyReadiness.auth.status}`);
    lines.push(`- github cli: ${plan.applyReadiness.tool.gh.available ? plan.applyReadiness.tool.gh.version ?? 'available' : 'missing'}`);
    lines.push(`- outbound redaction: ${plan.applyReadiness.privacy.outboundRedaction}`);
    if (plan.applyReadiness.privacy.sensitivePatternMatches.length) {
      lines.push(`- sensitive patterns: ${plan.applyReadiness.privacy.sensitivePatternMatches.join(', ')}`);
    }
    for (const entry of plan.applyReadiness.blockers) lines.push(`- blocker: ${entry.code}: ${entry.message}`);
    for (const entry of plan.applyReadiness.warnings) lines.push(`- readiness warning: ${entry}`);
  }
  return lines.join('\n');
}

export function buildGitHubStatus({ root, argv = [], config = {}, env = process.env }) {
  const privacy = getPrivacyOptions(config, env);
  const remoteUrl = execGit(['config', '--get', 'remote.origin.url'], { root });
  const repository = parseGitHubRemote(remoteUrl);
  const branch = execGit(['branch', '--show-current'], { root }) || null;
  const upstream = execGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { root });
  const { ahead, behind } = getAheadBehind(root, upstream);
  const workflows = inspectWorkflows(root);
  const mergeQueue = {
    workflowCount: workflows.filter((workflow) => workflow.mergeGroup).length,
    enabledByWorkflow: workflows.some((workflow) => workflow.mergeGroup),
    workflows: workflows.filter((workflow) => workflow.mergeGroup).map((workflow) => workflow.path),
  };
  const warnings = [];

  if (!repository) warnings.push('remote.origin.url is not a GitHub remote.');
  if (repository && !mergeQueue.enabledByWorkflow) warnings.push('No GitHub Actions merge_group workflow trigger was found.');
  if (!upstream) warnings.push('Current branch has no upstream tracking branch.');
  if (behind && behind > 0) warnings.push(`Current branch is behind upstream by ${behind} commit(s).`);
  if (ahead && ahead > 0) warnings.push(`Current branch has ${ahead} unpushed commit(s).`);

  const live = hasFlag(argv, '--live') && !privacy.offline
    ? runGhPrView(root)
    : { available: null, skipped: hasFlag(argv, '--live') && privacy.offline, error: null, pr: null };
  if (live.skipped) warnings.push('Offline mode is enabled; skipped GitHub CLI live PR check.');
  if (live.error) warnings.push(`GitHub CLI live PR check failed: ${live.error}`);

  return {
    ok: Boolean(repository) && warnings.length === 0,
    repository,
    remoteUrl,
    branch,
    upstream,
    ahead,
    behind,
    workflows,
    mergeQueue,
    live,
    privacy,
    warnings,
  };
}

export function runGitHubStatus(argv, context) {
  const result = buildGitHubStatus({ ...context, argv });
  if (hasFlag(argv, '--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('# GitHub Status');
    console.log(`Repository: ${result.repository?.url ?? 'not detected'}`);
    console.log(`Branch: ${result.branch ?? 'unknown'}${result.upstream ? ` tracking ${result.upstream}` : ''}`);
    console.log(`Merge queue workflow: ${result.mergeQueue.enabledByWorkflow ? result.mergeQueue.workflows.join(', ') : 'not detected'}`);
    console.log(result.warnings.length ? result.warnings.map((entry) => `- warning: ${entry}`).join('\n') : '- no warnings');
  }
  return 0;
}

export function runGitHubWritePlan(argv, context) {
  const plan = buildGitHubWritePlan({ ...context, argv });
  if (hasFlag(argv, '--json')) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(renderGitHubWritePlan(plan));
  }
  return plan.ok ? 0 : 1;
}
