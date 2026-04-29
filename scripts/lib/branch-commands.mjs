import fs from 'node:fs';
import path from 'node:path';

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

function normalizePathForJson(value) {
  return String(value ?? '').replaceAll('\\', '/');
}

function resolveCoordinationRoot(root) {
  const explicitRoot = String(process.env.AGENT_COORDINATION_ROOT ?? '').trim();
  if (explicitRoot) return path.isAbsolute(explicitRoot) ? explicitRoot : path.resolve(root, explicitRoot);
  const explicitDir = String(process.env.AGENT_COORDINATION_DIR ?? '').trim();
  return path.resolve(root, explicitDir || 'coordination');
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

function writeJsonAtomic(filePath, payload) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function getBranchObjectName(root, branchName) {
  const objectName = execGit(['rev-parse', '--verify', `refs/heads/${branchName}`], { root });
  if (!objectName) throw new Error(`Cannot snapshot refs/heads/${branchName}.`);
  return objectName;
}

function buildBranchRecoveryPlan({ root, report, candidates }) {
  const createdAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    type: 'branch-delete-recovery',
    createdAt,
    root: normalizePathForJson(root),
    currentBranch: report.currentBranch,
    baseRef: report.baseRef,
    staleDays: report.staleDays,
    command: process.argv.slice(2),
    branches: candidates.map((branch) => {
      const ref = `refs/heads/${branch.name}`;
      const objectName = getBranchObjectName(root, branch.name);
      return {
        name: branch.name,
        ref,
        objectName,
        shortSha: branch.sha,
        committedAt: branch.committedAt,
        subject: branch.subject,
        upstream: branch.upstream,
        track: branch.track,
        merged: branch.merged,
        upstreamGone: branch.upstreamGone,
        stale: branch.stale,
        activeTasks: branch.activeTasks,
        restoreCommand: `git update-ref ${ref} ${objectName}`,
      };
    }),
    deleted: [],
    errors: [],
  };
}

function writeBranchRecoveryPlan(root, report, candidates) {
  const coordinationRoot = resolveCoordinationRoot(root);
  const recoveryRoot = path.join(coordinationRoot, 'runtime', 'branch-recovery');
  fs.mkdirSync(recoveryRoot, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(recoveryRoot, `branches-delete-${timestamp}-${process.pid}.json`);
  const plan = buildBranchRecoveryPlan({ root, report, candidates });
  writeJsonAtomic(filePath, plan);
  return { filePath, plan };
}

function readRecoveryPlan(planPath) {
  const payload = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (payload?.schemaVersion !== 1 || payload?.type !== 'branch-delete-recovery' || !Array.isArray(payload.branches)) {
    throw new Error(`Invalid branch recovery plan: ${planPath}`);
  }
  return payload;
}

function restoreBranch(root, entry, force) {
  if (!entry?.ref?.startsWith('refs/heads/') || !entry?.objectName) {
    return { ok: false, branch: entry?.name ?? 'unknown', error: 'Recovery entry is missing a branch ref or object name.' };
  }
  if (!force && refExists(root, entry.ref)) {
    return { ok: true, branch: entry.name, skipped: true, reason: 'already exists' };
  }
  const ok = execGit(['update-ref', entry.ref, entry.objectName], { root }) !== null;
  return ok
    ? { ok: true, branch: entry.name, ref: entry.ref, objectName: entry.objectName }
    : { ok: false, branch: entry.name, error: `Failed to restore ${entry.ref}.` };
}

function runBranchRestore(argv, context) {
  const json = hasFlag(argv, '--json');
  const force = hasFlag(argv, '--force');
  const planPath = getFlagValue(argv, '--plan', '') || argv.find((entry) => !entry.startsWith('--') && entry !== 'restore');
  if (!planPath) {
    const message = 'Usage: branches restore <recovery-plan.json> [--force] [--json]';
    if (json) console.log(JSON.stringify({ ok: false, restored: [], errors: [message] }, null, 2));
    else console.error(message);
    return 1;
  }

  const absolutePlanPath = path.isAbsolute(planPath) ? planPath : path.resolve(context.root, planPath);
  const plan = readRecoveryPlan(absolutePlanPath);
  const results = plan.branches.map((entry) => restoreBranch(context.root, entry, force));
  const errors = results.filter((entry) => !entry.ok).map((entry) => entry.error);
  const payload = { ok: errors.length === 0, planPath: absolutePlanPath, restored: results.filter((entry) => entry.ok && !entry.skipped), skipped: results.filter((entry) => entry.skipped), errors };

  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    for (const entry of payload.restored) console.log(`Restored ${entry.branch} -> ${entry.objectName}`);
    for (const entry of payload.skipped) console.log(`Skipped ${entry.branch}: ${entry.reason}`);
    for (const error of errors) console.error(error);
  }
  return payload.ok ? 0 : 1;
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
  if (report.recoveryPlanPath) console.log(`Recovery plan: ${report.recoveryPlanPath}`);
}

export function runBranchStatus(argv, context) {
  if (argv[0] === 'restore') {
    return runBranchRestore(argv.slice(1), context);
  }

  const report = buildBranchReport({ ...context, argv });
  if (hasFlag(argv, '--apply')) {
    let recovery = null;
    if (report.cleanupCandidates.length) {
      try {
        recovery = writeBranchRecoveryPlan(context.root, report, report.cleanupCandidates);
        report.recoveryPlanPath = recovery.filePath;
      } catch (error) {
        report.errors.push(`Failed to write branch recovery plan before deletion: ${error.message}`);
      }
    }

    for (const branch of report.cleanupCandidates) {
      if (report.errors.length && !recovery) break;
      if (deleteBranch(context.root, branch.name)) report.deleted.push(branch.name);
      else report.errors.push(`Failed to delete ${branch.name}.`);
      if (recovery) {
        recovery.plan.deleted = [...report.deleted];
        recovery.plan.errors = [...report.errors];
        writeJsonAtomic(recovery.filePath, recovery.plan);
      }
    }
  }

  if (report.json) console.log(JSON.stringify(report, null, 2));
  else printBranchReport(report);
  return report.ok && report.errors.length === 0 ? 0 : 1;
}
