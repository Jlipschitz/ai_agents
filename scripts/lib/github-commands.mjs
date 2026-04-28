import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { hasFlag } from './args-utils.mjs';
import { execGit } from './git-utils.mjs';

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

export function buildGitHubStatus({ root, argv = [] }) {
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

  const live = hasFlag(argv, '--live') ? runGhPrView(root) : { available: null, error: null, pr: null };
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
