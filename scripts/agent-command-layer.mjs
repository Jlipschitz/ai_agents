import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validateAgentConfig, readJsonFile } from './validate-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT = process.cwd();
const DEFAULT_AGENT_IDS = ['agent-1', 'agent-2', 'agent-3', 'agent-4'];
const ACTIVE_STATUSES = new Set(['active', 'blocked', 'review', 'waiting', 'handoff']);
const TERMINAL_STATUSES = new Set(['done', 'released']);
const VALID_LIFECYCLE_COMMANDS = new Set(['start', 'finish', 'handoff-ready']);
const DEFAULT_GIT_POLICY = {
  allowMainBranchClaims: true,
  allowDetachedHead: false,
  allowedBranchPatterns: [],
};

function normalizePath(inputPath) {
  if (!inputPath) return '';
  let normalized = String(inputPath).trim().replaceAll('\\', '/');
  if (path.isAbsolute(normalized)) normalized = path.relative(ROOT, normalized).replaceAll('\\', '/');
  return normalized.replace(/^\.\/+/, '').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

function resolveRepoPath(value, fallbackRelativePath) {
  const normalized = String(value ?? '').trim() || fallbackRelativePath;
  return path.isAbsolute(normalized) ? normalized : path.resolve(ROOT, normalized);
}

function resolveCoordinationRoot() {
  const rootOverride = String(process.env.AGENT_COORDINATION_ROOT ?? '').trim();
  if (rootOverride) return path.isAbsolute(rootOverride) ? rootOverride : path.resolve(ROOT, rootOverride);
  const dirOverride = String(process.env.AGENT_COORDINATION_DIR ?? '').trim();
  return path.join(ROOT, dirOverride || 'coordination-two');
}

function resolveConfigPath() {
  return resolveRepoPath(process.env.AGENT_COORDINATION_CONFIG, 'agent-coordination.config.json');
}

function loadConfig() {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) return { configPath, config: {} };
  return { configPath, config: readJsonFile(configPath) };
}

function loadPackageJson() {
  const packageJsonPath = path.join(ROOT, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return { packageJsonPath, packageJson: null };
  return { packageJsonPath, packageJson: readJsonFile(packageJsonPath) };
}

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function appendUniqueLines(filePath, lines) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const existing = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = lines.filter((line) => line === '' || !existing.has(line));
  if (missing.filter(Boolean).length === 0) return false;
  fs.writeFileSync(filePath, `${current.replace(/\s*$/, '')}\n${missing.join('\n')}\n`);
  return true;
}

function ensureFile(filePath, content) {
  if (fs.existsSync(filePath)) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
}

function getCoordinationPaths() {
  const coordinationRoot = resolveCoordinationRoot();
  return {
    coordinationRoot,
    boardPath: path.join(coordinationRoot, 'board.json'),
    journalPath: path.join(coordinationRoot, 'journal.md'),
    messagesPath: path.join(coordinationRoot, 'messages.ndjson'),
    tasksRoot: path.join(coordinationRoot, 'tasks'),
    runtimeRoot: path.join(coordinationRoot, 'runtime'),
    watcherStatusPath: path.join(coordinationRoot, 'runtime', 'watcher.status.json'),
    heartbeatsRoot: path.join(coordinationRoot, 'runtime', 'agent-heartbeats'),
  };
}

function createStarterConfig(configPath) {
  writeJson(configPath, {
    projectName: path.basename(ROOT),
    agentIds: DEFAULT_AGENT_IDS,
    docs: { roots: ['docs'], appNotes: 'docs/ai-agent-app-notes.md', visualWorkflow: '', apiPrefixes: ['docs/api'] },
    git: DEFAULT_GIT_POLICY,
    paths: { sharedRisk: ['scripts', 'package.json', 'agent-coordination.config.json'], visualSuite: [], visualSuiteDefault: [], visualImpact: [], visualImpactFiles: [] },
    verification: { visualRequiredChecks: [], visualSuiteUpdateChecks: [] },
    notes: { categories: ['error', 'inconsistency', 'change', 'gotcha', 'decision', 'verification', 'setup'], sectionHeading: 'Agent-Maintained Notes' },
    pathClassification: { productPrefixes: ['app', 'src', 'components', 'features', 'packages'], dataPrefixes: ['api', 'db', 'database', 'hooks', 'lib', 'migrations', 'server', 'store', 'types'], verifyPrefixes: ['tests', 'test', '__tests__', 'spec'], docsPrefixes: ['docs', 'scripts'], docsFiles: ['README.md', 'agent-coordination.config.json', 'package.json'] },
    planning: { defaultDomains: ['app'], productFallbackPaths: ['app', 'src', 'components', 'features'], dataFallbackPaths: ['api', 'lib', 'server', 'types'], verifyFallbackPaths: ['tests'], docsFallbackPaths: ['README.md', 'docs'], agentSizing: { minAgents: 1, maxAgents: 4, mediumComplexityScore: 10, largeComplexityScore: 16, productKeywords: ['app', 'ui', 'screen', 'page', 'view', 'component', 'layout', 'modal', 'button', 'nav', 'mobile', 'desktop', 'polish', 'feature'], dataKeywords: ['api', 'backend', 'server', 'database', 'db', 'schema', 'migration', 'auth', 'state', 'store', 'query', 'cache', 'sync', 'integration'], verifyKeywords: ['test', 'tests', 'verify', 'verification', 'snapshot', 'playwright', 'coverage', 'qa'], docsKeywords: ['doc', 'docs', 'documentation', 'readme', 'notes', 'guide', 'roadmap', 'changelog'] } },
    domainRules: [{ name: 'app', keywords: ['app', 'ui', 'screen', 'page', 'component', 'frontend', 'feature'], scopes: { product: ['app', 'src', 'components', 'features'], data: ['lib', 'hooks', 'store', 'types'], verify: ['tests'], docs: ['README.md', 'docs'] } }],
  });
}

function expectedPackageScripts() {
  return {
    'ai-agents': 'node ./bin/ai-agents.mjs',
    'agents': 'node ./scripts/agent-coordination.mjs',
    'agents:init': 'node ./scripts/agent-coordination.mjs init',
    'agents:plan': 'node ./scripts/agent-coordination.mjs plan',
    'agents:status': 'node ./scripts/agent-coordination.mjs status',
    'agents:validate': 'node ./scripts/agent-coordination.mjs validate',
    'agents:doctor': 'node ./scripts/agent-coordination.mjs doctor',
    'agents:summarize': 'node ./scripts/agent-coordination.mjs summarize',
    'agents:start': 'node ./scripts/agent-coordination.mjs start',
    'agents:finish': 'node ./scripts/agent-coordination.mjs finish',
    'agents:handoff-ready': 'node ./scripts/agent-coordination.mjs handoff-ready',
    'agents:watch:start': 'node ./scripts/agent-coordination.mjs watch-start',
    'agents:watch:node': 'node ./scripts/agent-watch-loop.mjs --coordinator-script ./scripts/agent-coordination.mjs',
    'agents:watch:status': 'node ./scripts/agent-coordination.mjs watch-status',
    'agents:watch:stop': 'node ./scripts/agent-coordination.mjs watch-stop',
    'validate:agents-config': 'node ./scripts/validate-config.mjs',
  };
}

function doctorFix() {
  const fixes = [];
  const { configPath } = loadConfig();
  const paths = getCoordinationPaths();
  if (!fs.existsSync(configPath)) { createStarterConfig(configPath); fixes.push(`created ${normalizePath(configPath)}`); }
  if (appendUniqueLines(path.join(ROOT, '.gitignore'), ['', '# Local AI agent coordination runtime state', '/coordination/', '/coordination-two/'])) fixes.push('updated .gitignore');
  if (ensureFile(path.join(ROOT, 'docs', 'ai-agent-app-notes.md'), '# AI Agent App Notes\n\n## Agent-Maintained Notes\n\n')) fixes.push('created docs/ai-agent-app-notes.md');
  for (const dir of [paths.coordinationRoot, paths.tasksRoot, paths.runtimeRoot, paths.heartbeatsRoot]) {
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); fixes.push(`created ${normalizePath(dir)}`); }
  }
  if (!fs.existsSync(paths.boardPath)) { writeJson(paths.boardPath, { version: 1, projectName: path.basename(ROOT), tasks: [], resources: [], incidents: [], updatedAt: new Date().toISOString() }); fixes.push(`created ${normalizePath(paths.boardPath)}`); }
  if (ensureFile(paths.journalPath, '# Coordination Journal\n\n')) fixes.push(`created ${normalizePath(paths.journalPath)}`);
  if (ensureFile(paths.messagesPath, '')) fixes.push(`created ${normalizePath(paths.messagesPath)}`);
  const { packageJsonPath, packageJson } = loadPackageJson();
  if (packageJson) {
    packageJson.scripts = packageJson.scripts && typeof packageJson.scripts === 'object' ? packageJson.scripts : {};
    const changed = [];
    for (const [name, command] of Object.entries(expectedPackageScripts())) {
      if (packageJson.scripts[name] !== command) { packageJson.scripts[name] = command; changed.push(name); }
    }
    if (changed.length) { fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`); fixes.push(`updated package.json scripts: ${changed.join(', ')}`); }
  }
  return fixes;
}

function globToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function branchMatchesPattern(branch, pattern) {
  return globToRegExp(pattern).test(branch);
}

function getGitPolicy(config) {
  return {
    allowMainBranchClaims: config.git?.allowMainBranchClaims ?? DEFAULT_GIT_POLICY.allowMainBranchClaims,
    allowDetachedHead: config.git?.allowDetachedHead ?? DEFAULT_GIT_POLICY.allowDetachedHead,
    allowedBranchPatterns: Array.isArray(config.git?.allowedBranchPatterns) ? config.git.allowedBranchPatterns.filter(Boolean) : [],
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

function getGitSnapshot(config = loadConfig().config) {
  const result = { available: false, branch: null, upstream: null, ahead: null, behind: null, dirty: [], untracked: [], mergeState: false, rebaseState: false, policy: getGitPolicy(config), warnings: [], errors: [] };
  function git(args) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  try { git(['rev-parse', '--is-inside-work-tree']); result.available = true; } catch { result.warnings.push('Not inside a Git worktree or Git is unavailable.'); return result; }
  try { result.branch = git(['branch', '--show-current']) || 'detached'; } catch {}
  try { result.upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']); } catch { result.warnings.push('No upstream branch configured.'); }
  if (result.upstream) {
    try { const [ahead, behind] = git(['rev-list', '--left-right', '--count', `${result.upstream}...HEAD`]).split(/\s+/).map((value) => Number.parseInt(value, 10)); result.ahead = Number.isFinite(ahead) ? ahead : null; result.behind = Number.isFinite(behind) ? behind : null; } catch {}
  }
  try {
    const porcelain = git(['status', '--porcelain=v1']);
    for (const line of porcelain.split(/\r?\n/).filter(Boolean)) {
      const filePath = line.slice(3).trim();
      if (line.startsWith('??')) result.untracked.push(filePath); else result.dirty.push(filePath);
    }
  } catch {}
  const gitDir = (() => { try { return git(['rev-parse', '--git-dir']); } catch { return null; } })();
  if (gitDir) {
    const absoluteGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(ROOT, gitDir);
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

function taskSummary(task) {
  const owner = task.ownerId || task.suggestedOwnerId || 'unowned';
  const title = task.title || task.summary || task.id;
  const paths = Array.isArray(task.claimedPaths) && task.claimedPaths.length ? ` paths: ${task.claimedPaths.join(', ')}` : '';
  return `- ${task.id}: ${title} [${task.status || 'unknown'} / ${owner}]${paths}`;
}

function buildBoardSummary({ forChat = false } = {}) {
  const { boardPath, coordinationRoot } = getCoordinationPaths();
  const board = readJsonSafe(boardPath, { tasks: [] });
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const active = tasks.filter((task) => ACTIVE_STATUSES.has(task.status));
  const blocked = tasks.filter((task) => task.status === 'blocked');
  const review = tasks.filter((task) => task.status === 'review');
  const planned = tasks.filter((task) => task.status === 'planned');
  const done = tasks.filter((task) => TERMINAL_STATUSES.has(task.status));
  const updatedAt = board.updatedAt || board.lastUpdatedAt || 'unknown';
  if (forChat) return [`Coordination summary for ${board.projectName || path.basename(ROOT)}`, `Updated: ${updatedAt}`, `Active: ${active.length}; Blocked: ${blocked.length}; Review: ${review.length}; Planned: ${planned.length}; Done/Released: ${done.length}`, active.length ? `Active work:\n${active.map(taskSummary).join('\n')}` : 'Active work: none', blocked.length ? `Blockers:\n${blocked.map(taskSummary).join('\n')}` : 'Blockers: none', review.length ? `Needs review:\n${review.map(taskSummary).join('\n')}` : 'Needs review: none'].join('\n');
  return ['# Board Summary', '', `Project: ${board.projectName || path.basename(ROOT)}`, `Coordination root: ${normalizePath(coordinationRoot) || coordinationRoot}`, `Updated: ${updatedAt}`, '', '## Counts', '', `- Planned: ${planned.length}`, `- Active-like: ${active.length}`, `- Blocked: ${blocked.length}`, `- Review: ${review.length}`, `- Done/released: ${done.length}`, '', '## Active Work', '', active.length ? active.map(taskSummary).join('\n') : '- None', '', '## Blockers', '', blocked.length ? blocked.map(taskSummary).join('\n') : '- None', '', '## Review Queue', '', review.length ? review.map(taskSummary).join('\n') : '- None', '', '## Next Planned', '', planned.slice(0, 10).length ? planned.slice(0, 10).map(taskSummary).join('\n') : '- None'].join('\n');
}

function doctorJson({ includeFixes = false } = {}) {
  const { configPath, config } = loadConfig();
  const configValidation = validateAgentConfig(config, { root: ROOT });
  const paths = getCoordinationPaths();
  const git = getGitSnapshot(config);
  const result = { ok: configValidation.valid && git.errors.length === 0, projectName: config.projectName || path.basename(ROOT), root: ROOT, coordinationRoot: paths.coordinationRoot, configPath, configValidation, git, files: { board: fs.existsSync(paths.boardPath), journal: fs.existsSync(paths.journalPath), messages: fs.existsSync(paths.messagesPath), runtime: fs.existsSync(paths.runtimeRoot), tasks: fs.existsSync(paths.tasksRoot) } };
  if (includeFixes) result.fixes = doctorFix();
  return result;
}

function runDoctorJson(argv) {
  const result = doctorJson({ includeFixes: argv.includes('--fix') });
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

function runDoctorFix() {
  const fixes = doctorFix();
  if (fixes.length) { console.log('doctor --fix applied:'); for (const fix of fixes) console.log(`- ${fix}`); }
  else console.log('doctor --fix: nothing to fix');
  return 0;
}

function runConfigValidation({ json = false } = {}) {
  const { configPath, config } = loadConfig();
  const result = validateAgentConfig(config, { root: ROOT });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const warning of result.warnings) console.warn(`warning: ${warning}`);
    if (result.valid) console.log(`Config OK: ${normalizePath(configPath) || configPath}`);
    else { console.error(`Config invalid: ${normalizePath(configPath) || configPath}`); for (const error of result.errors) console.error(`- ${error}`); }
  }
  return result.valid ? 0 : 1;
}

function runGitPreflightForClaim() {
  const git = getGitSnapshot();
  for (const warning of git.warnings) console.warn(`git warning: ${warning}`);
  for (const error of git.errors) console.error(`git error: ${error}`);
  if (git.branch) console.warn(`git branch: ${git.branch}${git.upstream ? ` tracking ${git.upstream}` : ''}`);
  return git.errors.length ? 1 : 0;
}

function parseInterval(argv) {
  const index = argv.findIndex((entry) => entry === '--interval');
  if (index < 0) return 30000;
  const parsed = Number.parseInt(String(argv[index + 1] ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 30000;
}

function runWatchStart(argv, coordinatorScriptPath) {
  const paths = getCoordinationPaths();
  fs.mkdirSync(paths.runtimeRoot, { recursive: true });
  const watcherScript = resolveRepoPath(process.env.AGENT_COORDINATION_WATCH_LOOP_SCRIPT, 'scripts/agent-watch-loop.mjs');
  const intervalMs = parseInterval(argv);
  const child = spawn(process.execPath, [watcherScript, '--coordinator-script', coordinatorScriptPath, '--workspace-root', ROOT, '--interval', String(intervalMs), '--coordination-root', paths.coordinationRoot], { cwd: ROOT, env: process.env, detached: true, stdio: 'ignore' });
  child.unref();
  console.log(`Started Node watcher PID ${child.pid} for ${normalizePath(paths.coordinationRoot) || paths.coordinationRoot}.`);
  return 0;
}

function runLifecycle(commandName, argv, coordinatorScriptPath) {
  const [agentId, taskId, ...rest] = argv;
  if (!agentId || !taskId) { console.error(`Usage: ${commandName} <agent-id> <task-id> [message] [--paths path[,path...]]`); return 1; }
  const pathFlagIndex = rest.findIndex((entry) => entry === '--paths');
  const message = rest.filter((entry, index) => !entry.startsWith('--') && index !== pathFlagIndex + 1).join(' ').trim();
  const run = (args) => spawnSync(process.execPath, [coordinatorScriptPath, ...args], { cwd: ROOT, stdio: 'inherit', env: process.env }).status ?? 1;
  if (commandName === 'start') {
    const paths = pathFlagIndex >= 0 ? rest[pathFlagIndex + 1] : '';
    const args = ['claim', agentId, taskId];
    if (paths) args.push('--paths', paths);
    const status = run(args);
    if (status !== 0) return status;
    return message ? run(['progress', agentId, taskId, message]) : 0;
  }
  if (commandName === 'finish') return run(['done', agentId, taskId, message || 'Finished implementation.']);
  if (commandName === 'handoff-ready') return run(['handoff', agentId, taskId, message || 'Ready for handoff.']);
  return 1;
}

function shouldHandle(commandName, argv) {
  if (commandName === 'doctor' && (argv.includes('--fix') || argv.includes('--json'))) return true;
  if (commandName === 'validate' && argv.includes('--json')) return true;
  if (commandName === 'summarize') return true;
  if (commandName === 'watch-start') return true;
  if (VALID_LIFECYCLE_COMMANDS.has(commandName)) return true;
  return false;
}

export async function runCommandLayer({ coordinatorScriptPath, importCore }) {
  const argv = process.argv.slice(2);
  const commandName = argv[0] || 'help';
  const commandArgs = argv.slice(1);
  const normalizedCoordinatorPath = resolveRepoPath(coordinatorScriptPath, 'scripts/agent-coordination-two.mjs');

  if (commandName === 'claim') {
    const preflightStatus = runGitPreflightForClaim();
    if (preflightStatus !== 0) process.exit(preflightStatus);
  }

  if (!shouldHandle(commandName, commandArgs)) {
    if (commandName === 'doctor' || commandName === 'validate') {
      const status = runConfigValidation({ json: false });
      if (status !== 0) process.exit(status);
    }
    await importCore();
    return;
  }

  let status = 0;
  if (commandName === 'doctor' && commandArgs.includes('--json')) status = runDoctorJson(commandArgs);
  else if (commandName === 'doctor' && commandArgs.includes('--fix')) status = runDoctorFix();
  else if (commandName === 'validate' && commandArgs.includes('--json')) status = runConfigValidation({ json: true });
  else if (commandName === 'summarize') {
    if (commandArgs.includes('--json')) {
      const paths = getCoordinationPaths();
      const board = readJsonSafe(paths.boardPath, { tasks: [] });
      console.log(JSON.stringify({ summary: buildBoardSummary({ forChat: commandArgs.includes('--for-chat') }), board }, null, 2));
    } else console.log(buildBoardSummary({ forChat: commandArgs.includes('--for-chat') }));
  } else if (commandName === 'watch-start') status = runWatchStart(commandArgs, normalizedCoordinatorPath);
  else if (VALID_LIFECYCLE_COMMANDS.has(commandName)) status = runLifecycle(commandName, commandArgs, normalizedCoordinatorPath);
  process.exit(status);
}
