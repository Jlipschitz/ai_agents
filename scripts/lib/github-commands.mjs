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
  if (applyRequested) warnings.push('Apply is blocked for GitHub write plans until a future live-write flag exists.');

  const resolvedTarget = {
    type: target.targetType,
    number: target.number,
    url: repository && target.targetType && target.number
      ? `${repository.url}/${target.targetType === 'pr' ? 'pull' : 'issues'}/${target.number}`
      : null,
  };

  return {
    ok: errors.length === 0 && !applyRequested,
    dryRun: true,
    applyRequested,
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
