import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const DEFAULT_GIT_POLICY = {
  allowMainBranchClaims: true,
  allowDetachedHead: false,
  allowedBranchPatterns: [],
  defaultBaseBranch: 'main',
  staleBranchDays: 30,
  protectedBranchPatterns: ['main', 'master', 'develop', 'dev', 'trunk', 'release/*'],
};

export function execGit(args, { root = process.cwd(), trim = true } = {}) {
  const candidates = process.platform === 'win32' ? ['git.exe', 'git.cmd', 'git'] : ['git'];

  for (const candidate of candidates) {
    try {
      const output = execFileSync(candidate, args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return trim ? output.trim() : output;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }
    }
  }

  return null;
}

export function isGitDubiousOwnershipError(error) {
  const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf8') : String(error?.stderr ?? '');
  const stdout = Buffer.isBuffer(error?.stdout) ? error.stdout.toString('utf8') : String(error?.stdout ?? '');
  const message = String(error?.message ?? '');
  const combined = `${stderr}\n${stdout}\n${message}`;
  return /detected dubious ownership/i.test(combined) || (/safe\.directory/i.test(combined) && /dubious ownership/i.test(combined));
}

export function buildGitSafeDirectoryCommand(root = process.cwd()) {
  const safePath = path.resolve(root).replaceAll('"', '\\"');
  return `git config --global --add safe.directory "${safePath}"`;
}

function globToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function branchMatchesPattern(branch, pattern) {
  return globToRegExp(pattern).test(branch);
}

export function getGitPolicy(config) {
  return {
    allowMainBranchClaims: config.git?.allowMainBranchClaims ?? DEFAULT_GIT_POLICY.allowMainBranchClaims,
    allowDetachedHead: config.git?.allowDetachedHead ?? DEFAULT_GIT_POLICY.allowDetachedHead,
    allowedBranchPatterns: Array.isArray(config.git?.allowedBranchPatterns) ? config.git.allowedBranchPatterns.filter(Boolean) : [],
    defaultBaseBranch: config.git?.defaultBaseBranch ?? DEFAULT_GIT_POLICY.defaultBaseBranch,
    staleBranchDays: config.git?.staleBranchDays ?? DEFAULT_GIT_POLICY.staleBranchDays,
    protectedBranchPatterns: Array.isArray(config.git?.protectedBranchPatterns) ? config.git.protectedBranchPatterns.filter(Boolean) : DEFAULT_GIT_POLICY.protectedBranchPatterns,
  };
}

function applyGitPolicy(result, policy) {
  const branch = result.branch;
  if (!branch) return;
  if (branch === 'detached' && !policy.allowDetachedHead) result.errors.push('Detached HEAD claims are disabled by git.allowDetachedHead.');
  if ((branch === 'main' || branch === 'master') && !policy.allowMainBranchClaims) result.errors.push(`Claims on ${branch} are disabled by git.allowMainBranchClaims.`);
  if (branch !== 'detached' && policy.allowedBranchPatterns.length && !policy.allowedBranchPatterns.some((pattern) => branchMatchesPattern(branch, pattern))) {
    result.errors.push(`Branch ${branch} does not match git.allowedBranchPatterns: ${policy.allowedBranchPatterns.join(', ')}.`);
  }
}

export function getGitSnapshot({ root = process.cwd(), config = {}, runGit = null } = {}) {
  const result = { available: false, dubiousOwnership: false, safeDirectoryCommand: null, branch: null, upstream: null, ahead: null, behind: null, dirty: [], untracked: [], mergeState: false, rebaseState: false, policy: getGitPolicy(config), warnings: [], errors: [] };
  const gitCandidates = process.platform === 'win32' ? ['git.exe', 'git.cmd', 'git'] : ['git'];
  let gitCommand = null;
  function git(args, options = {}) {
    const trim = options.trim ?? true;
    if (runGit) {
      const output = String(runGit(args) ?? '');
      return trim ? output.trim() : output;
    }
    const candidates = gitCommand ? [gitCommand] : gitCandidates;
    let lastError = null;
    for (const candidate of candidates) {
      try {
        const output = execFileSync(candidate, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        gitCommand = candidate;
        return trim ? output.trim() : output;
      } catch (error) {
        lastError = error;
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
    }
    throw lastError ?? new Error('Git executable was not found.');
  }
  try { git(['rev-parse', '--is-inside-work-tree']); result.available = true; } catch (error) {
    if (isGitDubiousOwnershipError(error)) {
      result.available = true;
      result.dubiousOwnership = true;
      result.safeDirectoryCommand = buildGitSafeDirectoryCommand(root);
      result.errors.push(`Git refuses this worktree because ownership is considered dubious. Run: ${result.safeDirectoryCommand}`);
    } else {
      result.warnings.push('Not inside a Git worktree or Git is unavailable.');
    }
    return result;
  }
  try { result.branch = git(['branch', '--show-current']) || 'detached'; } catch {}
  try { result.upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']); } catch { result.warnings.push('No upstream branch configured.'); }
  if (result.upstream) {
    try { const [ahead, behind] = git(['rev-list', '--left-right', '--count', `${result.upstream}...HEAD`]).split(/\s+/).map((value) => Number.parseInt(value, 10)); result.ahead = Number.isFinite(ahead) ? ahead : null; result.behind = Number.isFinite(behind) ? behind : null; } catch {}
  }
  try {
    const porcelain = git(['status', '--porcelain=v1'], { trim: false });
    for (const line of porcelain.split(/\r?\n/).filter(Boolean)) {
      const filePath = line.slice(3).trim();
      if (line.startsWith('??')) result.untracked.push(filePath); else result.dirty.push(filePath);
    }
  } catch {}
  const gitDir = (() => { try { return git(['rev-parse', '--git-dir']); } catch { return null; } })();
  if (gitDir) {
    const absoluteGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
    result.mergeState = fs.existsSync(path.join(absoluteGitDir, 'MERGE_HEAD'));
    result.rebaseState = fs.existsSync(path.join(absoluteGitDir, 'rebase-merge')) || fs.existsSync(path.join(absoluteGitDir, 'rebase-apply'));
  }
  if (result.behind && result.behind > 0) result.warnings.push(`Branch is behind upstream by ${result.behind} commit(s).`);
  if (result.ahead && result.ahead > 0) result.warnings.push(`Branch has ${result.ahead} unpushed commit(s).`);
  if (result.dirty.length) result.warnings.push(`Worktree has ${result.dirty.length} modified/staged file(s).`);
  if (result.untracked.length) result.warnings.push(`Worktree has ${result.untracked.length} untracked file(s).`);
  if (result.mergeState) result.errors.push('A merge is currently in progress. Resolve it before claiming work.');
  if (result.rebaseState) result.errors.push('A rebase is currently in progress. Resolve it before claiming work.');
  applyGitPolicy(result, result.policy);
  return result;
}
