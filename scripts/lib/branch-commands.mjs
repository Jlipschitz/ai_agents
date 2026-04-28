import { execGit } from './git-utils.mjs';
import { getFlagValue, getNumberFlag, hasFlag } from './args-utils.mjs';

const DEFAULT_STALE_BRANCH_DAYS = 30;
const DEFAULT_PROTECTED_BRANCHES = ['main', 'master', 'develop', 'dev', 'trunk', 'release/*'];

function globToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function branchMatches(branch, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(branch));
}

function parseIso(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function ageDays(value, referenceTime = Date.now()) {
  const time = parseIso(value);
  if (time === null) return null;
  return Math.floor((referenceTime - time) / 86400000);
}

function stringArray(value, fallback = []) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()) : fallback;
}

function refExists(root, ref) {
  return execGit(['rev-parse', '--verify', '--quiet', ref], { root }) !== null;
}

function resolveBaseRef(root, config, explicitBase) {
  const candidates = [
    explicitBase,
    config.git?.defaultBaseBranch,
    'origin/main',
    'main',
    'origin/master',
    'master',
  ].filter(Boolean);
  return candidates.find((candidate) => refExists(root, candidate)) ?? null;
}

function listMergedBranches(root, baseRef) {
  if (!baseRef) return new Set();
  const output = execGit(['branch', '--merged', baseRef, '--format=%(refname:short)'], { root });
  return new Set((output ?? '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean));
}

function listBranches(root) {
  const output = execGit([
    'for-each-ref',
    'refs/heads',
    '--format=%(refname:short)%09%(committerdate:iso8601)%09%(upstream:short)%09%(upstream:track)%09%(objectname:short)%09%(subject)',
  ], { root });

  if (output === null) return null;
  const branches = [];
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const fields = line.split('\t');
    if (fields.length < 6) continue;
    branches.push({
      name: fields[0],
      committedAt: fields[1],
      upstream: fields[2] || null,
      track: fields[3] || '',
      sha: fields[4],
      subject: fields.slice(5).join('\t'),
    });
  }
  return branches;
}

function collectTaskBranches(board, activeStatuses) {
  const byBranch = new Map();
  for (const task of board.tasks ?? []) {
    if (!task.gitBranch || !activeStatuses.has(task.status)) continue;
    if (!byBranch.has(task.gitBranch)) byBranch.set(task.gitBranch, []);
    byBranch.get(task.gitBranch).push(task.id);
  }
  return byBranch;
}

export function buildBranchReport({ root, config, board, activeStatuses, argv = [] }) {
  const json = hasFlag(argv, '--json');
  const staleDays = getNumberFlag(argv, '--stale-days', config.git?.staleBranchDays ?? DEFAULT_STALE_BRANCH_DAYS);
  const baseRef = resolveBaseRef(root, config, getFlagValue(argv, '--base', ''));
  const branches = listBranches(root);
  const currentBranch = execGit(['branch', '--show-current'], { root }) || 'detached';

  if (!branches) {
    return { ok: false, json, available: false, currentBranch: null, baseRef: null, branches: [], cleanupCandidates: [], deleted: [], errors: ['Git branch data is unavailable.'] };
  }

  const mergedBranches = listMergedBranches(root, baseRef);
  const protectedPatterns = stringArray(config.git?.protectedBranchPatterns, DEFAULT_PROTECTED_BRANCHES);
  const taskBranches = collectTaskBranches(board, activeStatuses);
  const enriched = branches.map((branch) => {
    const branchAgeDays = ageDays(branch.committedAt);
    const activeTasks = taskBranches.get(branch.name) ?? [];
    const protectedBranch = branchMatches(branch.name, protectedPatterns);
    const merged = mergedBranches.has(branch.name);
    const upstreamGone = branch.track.includes('gone');
    const stale = branchAgeDays !== null && branchAgeDays >= staleDays;
    const cleanupCandidate = branch.name !== currentBranch && !protectedBranch && !activeTasks.length && stale && (merged || upstreamGone);
    return { ...branch, ageDays: branchAgeDays, activeTasks, protected: protectedBranch, merged, upstreamGone, stale, cleanupCandidate };
  });

  return {
    ok: true,
    json,
    available: true,
    currentBranch,
    baseRef,
    staleDays,
    protectedPatterns,
    branches: enriched,
    cleanupCandidates: enriched.filter((branch) => branch.cleanupCandidate),
    deleted: [],
    errors: [],
  };
}

function deleteBranch(root, branchName) {
  return execGit(['branch', '-d', branchName], { root }) !== null;
}

function printBranchReport(report) {
  console.log('# Branch Status');
  console.log(`Current: ${report.currentBranch}`);
  console.log(`Base: ${report.baseRef ?? 'unavailable'}`);
  console.log(`Stale threshold: ${report.staleDays} day(s)`);
  console.log('');
  console.log('Branches:');
  for (const branch of report.branches) {
    const labels = [
      branch.protected ? 'protected' : null,
      branch.merged ? 'merged' : null,
      branch.upstreamGone ? 'upstream gone' : null,
      branch.stale ? 'stale' : null,
      branch.activeTasks.length ? `active tasks: ${branch.activeTasks.join(', ')}` : null,
    ].filter(Boolean);
    console.log(`- ${branch.name}${labels.length ? ` (${labels.join(', ')})` : ''}`);
  }
  console.log('');
  console.log('Cleanup candidates:');
  console.log(report.cleanupCandidates.length ? report.cleanupCandidates.map((branch) => `- ${branch.name}`).join('\n') : '- None');
}

export function runBranchStatus(argv, context) {
  const report = buildBranchReport({ ...context, argv });
  if (hasFlag(argv, '--apply')) {
    for (const branch of report.cleanupCandidates) {
      if (deleteBranch(context.root, branch.name)) report.deleted.push(branch.name);
      else report.errors.push(`Failed to delete ${branch.name}.`);
    }
  }

  if (report.json) console.log(JSON.stringify(report, null, 2));
  else printBranchReport(report);
  return report.ok && report.errors.length === 0 ? 0 : 1;
}
