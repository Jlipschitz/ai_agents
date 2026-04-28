import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';

import { validateAgentConfig, readJsonFile } from './validate-config.mjs';
import { runCli as runLockRuntimeCli } from './lock-runtime.mjs';

const ROOT = process.cwd();
const DEFAULT_AGENT_IDS = ['agent-1', 'agent-2', 'agent-3', 'agent-4'];
const VALID_TASK_STATUSES = new Set(['planned', 'active', 'blocked', 'waiting', 'review', 'handoff', 'done', 'released']);
const ACTIVE_STATUSES = new Set(['active', 'blocked', 'review', 'waiting', 'handoff']);
const TERMINAL_STATUSES = new Set(['done', 'released']);
const VALID_LIFECYCLE_COMMANDS = new Set(['start', 'finish', 'handoff-ready']);
const COMMAND_LAYER_COMMANDS = new Set([
  'watch-diagnose',
  'cleanup-runtime',
  'release-check',
  'inspect-board',
  'repair-board',
  'rollback-state',
  'run-check',
  'artifacts',
  'graph',
  'ownership-map',
  'pr-summary',
  'release-bundle',
  'migrate-config',
  'policy-packs',
]);
const COMMAND_ALIASES = new Map([
  ['s', 'status'],
  ['d', 'doctor'],
  ['p', 'plan'],
  ['sum', 'summarize'],
]);
const DEFAULT_GIT_POLICY = {
  allowMainBranchClaims: true,
  allowDetachedHead: false,
  allowedBranchPatterns: [],
};
const DEFAULT_STALE_TASK_HOURS = 6;
const DEFAULT_RECENT_CONTEXT_LINES = 8;
const DEFAULT_RUNTIME_STALE_MS = 300000;
const DEFAULT_HEARTBEAT_TTL_MS = 90000;
const CHECK_COMMAND = 'node --check ./bin/ai-agents.mjs && node --check ./scripts/agent-command-layer.mjs && node --check ./scripts/agent-coordination-core.mjs && node --check ./scripts/agent-coordination.mjs && node --check ./scripts/agent-coordination-two.mjs && node --check ./scripts/agent-watch-loop.mjs && node --check ./scripts/bootstrap.mjs && node --check ./scripts/explain-config.mjs && node --check ./scripts/lock-runtime.mjs && node --check ./scripts/planner-sizing.mjs && node --check ./scripts/validate-config.mjs';
const CURRENT_CONFIG_VERSION = 1;
const DEFAULT_ARTIFACT_POLICY = { roots: ['artifacts'], keepDays: 14, keepFailedDays: 45, maxMb: 500, protectPatterns: [] };
const POLICY_PACKS = {
  'docs-light': {
    description: 'Lightweight docs-focused coordination defaults.',
    config: {
      docs: { roots: ['docs'], appNotes: 'docs/ai-agent-app-notes.md' },
      paths: { sharedRisk: ['README.md', 'docs'], visualImpact: [], visualSuite: [] },
      verification: { visualRequiredChecks: [], visualSuiteUpdateChecks: [] },
    },
  },
  'strict-ui': {
    description: 'Stricter frontend and visual-verification defaults.',
    config: {
      git: { allowMainBranchClaims: false, allowDetachedHead: false, allowedBranchPatterns: ['feature/*', 'fix/*', 'agent/*'] },
      paths: { sharedRisk: ['components', 'src', 'app', 'package.json'], visualImpact: ['app', 'src', 'components', 'features', 'assets'], visualSuite: ['tests/visual', 'playwright-report', 'test-results'] },
      verification: { visualRequiredChecks: ['visual:test'], visualSuiteUpdateChecks: ['visual:update'] },
      checks: { 'visual:test': { command: 'npm run visual:test', timeoutMs: 120000, artifactRoots: ['artifacts', 'playwright-report', 'test-results'], requiredForPaths: ['app', 'src', 'components', 'features'], requireArtifacts: true } },
    },
  },
  'backend-safe': {
    description: 'Backend/data safety defaults for API, database, and auth work.',
    config: {
      git: { allowMainBranchClaims: false, allowDetachedHead: false, allowedBranchPatterns: ['feature/*', 'fix/*', 'agent/*'] },
      paths: { sharedRisk: ['api', 'server', 'lib', 'db', 'database', 'migrations', 'types', 'package.json'] },
      checks: { test: { command: 'npm test', timeoutMs: 120000, artifactRoots: ['artifacts'], requiredForPaths: ['api', 'server', 'lib', 'db', 'database', 'migrations'], requireArtifacts: false } },
      domainRules: [{ name: 'backend', keywords: ['api', 'server', 'backend', 'database', 'db', 'schema', 'migration', 'auth'], scopes: { product: ['app', 'src'], data: ['api', 'server', 'lib', 'db', 'database', 'migrations', 'types'], verify: ['tests'], docs: ['README.md', 'docs'] } }],
    },
  },
  'release-heavy': {
    description: 'Release-focused defaults with stricter branches and artifact retention.',
    config: {
      git: { allowMainBranchClaims: false, allowDetachedHead: false, allowedBranchPatterns: ['release/*', 'hotfix/*', 'fix/*', 'agent/*', 'feature/*'] },
      artifacts: { roots: ['artifacts', 'playwright-report', 'test-results'], keepDays: 30, keepFailedDays: 90, maxMb: 1000, protectPatterns: ['**/baseline/**', '**/reference/**'] },
      checks: { build: { command: 'npm run build', timeoutMs: 180000, artifactRoots: ['artifacts'], requiredForPaths: ['app', 'src', 'components', 'lib', 'server'], requireArtifacts: false } },
    },
  },
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
  return path.join(ROOT, dirOverride || 'coordination');
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

function nowIso() {
  return new Date().toISOString();
}

function fileTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function getFlagValue(argv, flag, fallback = '') {
  const index = argv.indexOf(flag);
  return index >= 0 ? String(argv[index + 1] ?? fallback) : fallback;
}

function getPositionals(argv, valuedFlags = new Set()) {
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

function getNumberFlag(argv, flag, fallback) {
  const value = Number.parseInt(getFlagValue(argv, flag, ''), 10);
  return Number.isFinite(value) ? value : fallback;
}

function readJsonDetailed(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, value: null, error: null };
  try {
    return { exists: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: null };
  } catch (error) {
    return { exists: true, value: null, error: error.message };
  }
}

function isPidAlive(pid) {
  const normalizedPid = Number.parseInt(String(pid ?? ''), 10);
  if (!Number.isFinite(normalizedPid) || normalizedPid <= 0) return null;
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
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
    snapshotsRoot: path.join(coordinationRoot, 'runtime', 'snapshots'),
    artifactsRoot: path.join(ROOT, 'artifacts', 'checks'),
  };
}

function createStarterConfig(configPath) {
  writeJson(configPath, {
    configVersion: 1,
    projectName: path.basename(ROOT),
    agentIds: DEFAULT_AGENT_IDS,
    docs: { roots: ['docs'], appNotes: 'docs/ai-agent-app-notes.md', visualWorkflow: '', apiPrefixes: ['docs/api'] },
    git: DEFAULT_GIT_POLICY,
    paths: { sharedRisk: ['scripts', 'package.json', 'agent-coordination.config.json'], visualSuite: [], visualSuiteDefault: [], visualImpact: [], visualImpactFiles: [] },
    verification: { visualRequiredChecks: [], visualSuiteUpdateChecks: [] },
    artifacts: { roots: ['artifacts'], keepDays: 14, keepFailedDays: 45, maxMb: 500, protectPatterns: [] },
    checks: {},
    notes: { categories: ['error', 'inconsistency', 'change', 'gotcha', 'decision', 'verification', 'setup'], sectionHeading: 'Agent-Maintained Notes' },
    pathClassification: { productPrefixes: ['app', 'src', 'components', 'features', 'packages'], dataPrefixes: ['api', 'db', 'database', 'hooks', 'lib', 'migrations', 'server', 'store', 'types'], verifyPrefixes: ['tests', 'test', '__tests__', 'spec'], docsPrefixes: ['docs', 'scripts'], docsFiles: ['README.md', 'agent-coordination.config.json', 'package.json'] },
    planning: { defaultDomains: ['app'], productFallbackPaths: ['app', 'src', 'components', 'features'], dataFallbackPaths: ['api', 'lib', 'server', 'types'], verifyFallbackPaths: ['tests'], docsFallbackPaths: ['README.md', 'docs'], agentSizing: { minAgents: 1, maxAgents: 4, mediumComplexityScore: 10, largeComplexityScore: 16, productKeywords: ['app', 'ui', 'screen', 'page', 'view', 'component', 'layout', 'modal', 'button', 'nav', 'mobile', 'desktop', 'polish', 'feature'], dataKeywords: ['api', 'backend', 'server', 'database', 'db', 'schema', 'migration', 'auth', 'state', 'store', 'query', 'cache', 'sync', 'integration'], verifyKeywords: ['test', 'tests', 'verify', 'verification', 'snapshot', 'playwright', 'coverage', 'qa'], docsKeywords: ['doc', 'docs', 'documentation', 'readme', 'notes', 'guide', 'roadmap', 'changelog'] } },
    domainRules: [{ name: 'app', keywords: ['app', 'ui', 'screen', 'page', 'component', 'frontend', 'feature'], scopes: { product: ['app', 'src', 'components', 'features'], data: ['lib', 'hooks', 'store', 'types'], verify: ['tests'], docs: ['README.md', 'docs'] } }],
  });
}

function hasLocalCoordinatorFiles() {
  return fs.existsSync(path.join(ROOT, 'bin', 'ai-agents.mjs'))
    && fs.existsSync(path.join(ROOT, 'scripts', 'agent-coordination.mjs'))
    && fs.existsSync(path.join(ROOT, 'scripts', 'agent-coordination-two.mjs'));
}

function expectedPackageScripts() {
  if (!hasLocalCoordinatorFiles()) {
    return {
      'ai-agents': 'ai-agents',
      'agents': 'ai-agents',
      'agents:init': 'ai-agents init',
      'agents:plan': 'ai-agents plan',
      'agents:status': 'ai-agents status',
      'agents:validate': 'ai-agents validate',
      'agents:doctor': 'ai-agents doctor',
      'agents:doctor:json': 'ai-agents doctor --json',
      'agents:doctor:fix': 'ai-agents doctor --fix',
      'agents:explain-config': 'ai-agents explain-config',
      'agents:summarize': 'ai-agents summarize',
      'agents:start': 'ai-agents start',
      'agents:finish': 'ai-agents finish',
      'agents:handoff-ready': 'ai-agents handoff-ready',
      'agents:lock:status': 'ai-agents lock-status',
      'agents:lock:clear': 'ai-agents lock-clear --stale-only',
      'agents:heartbeat:start': 'ai-agents heartbeat-start',
      'agents:heartbeat:status': 'ai-agents heartbeat-status',
      'agents:heartbeat:stop': 'ai-agents heartbeat-stop',
      'agents:watch:start': 'ai-agents watch-start',
      'agents:watch:status': 'ai-agents watch-status',
      'agents:watch:stop': 'ai-agents watch-stop',
      'agents:watch:diagnose': 'ai-agents watch-diagnose',
      'agents:runtime:cleanup': 'ai-agents cleanup-runtime',
      'agents:release:check': 'ai-agents release-check',
      'agents:board:inspect': 'ai-agents inspect-board',
      'agents:board:repair': 'ai-agents repair-board',
      'agents:state:rollback': 'ai-agents rollback-state',
      'agents:run-check': 'ai-agents run-check',
      'validate:agents-config': 'ai-agents validate --json',
    };
  }

  return {
    'ai-agents': 'node ./bin/ai-agents.mjs',
    'bootstrap': 'node ./scripts/bootstrap.mjs',
    'check': CHECK_COMMAND,
    'lint': 'npm run check',
    'agents': 'node ./scripts/agent-coordination.mjs',
    'agents:init': 'node ./scripts/agent-coordination.mjs init',
    'agents:plan': 'node ./scripts/agent-coordination.mjs plan',
    'agents:status': 'node ./scripts/agent-coordination.mjs status',
    'agents:validate': 'node ./scripts/agent-coordination.mjs validate',
    'agents:doctor': 'node ./scripts/agent-coordination.mjs doctor',
    'agents:doctor:json': 'node ./scripts/agent-coordination.mjs doctor --json',
    'agents:doctor:fix': 'node ./scripts/agent-coordination.mjs doctor --fix',
    'agents:explain-config': 'node ./scripts/agent-coordination.mjs explain-config',
    'agents:summarize': 'node ./scripts/agent-coordination.mjs summarize',
    'agents:start': 'node ./scripts/agent-coordination.mjs start',
    'agents:finish': 'node ./scripts/agent-coordination.mjs finish',
    'agents:handoff-ready': 'node ./scripts/agent-coordination.mjs handoff-ready',
    'agents:lock:status': 'node ./scripts/agent-coordination.mjs lock-status',
    'agents:lock:clear': 'node ./scripts/agent-coordination.mjs lock-clear --stale-only',
    'agents:heartbeat:start': 'node ./scripts/agent-coordination.mjs heartbeat-start',
    'agents:heartbeat:status': 'node ./scripts/agent-coordination.mjs heartbeat-status',
    'agents:heartbeat:stop': 'node ./scripts/agent-coordination.mjs heartbeat-stop',
    'agents:watch:start': 'node ./scripts/agent-coordination.mjs watch-start',
    'agents:watch:status': 'node ./scripts/agent-coordination.mjs watch-status',
    'agents:watch:stop': 'node ./scripts/agent-coordination.mjs watch-stop',
    'agents:watch:node': 'node ./scripts/agent-watch-loop.mjs --coordinator-script ./scripts/agent-coordination.mjs',
    'agents:watch:diagnose': 'node ./scripts/agent-coordination.mjs watch-diagnose',
    'agents:runtime:cleanup': 'node ./scripts/agent-coordination.mjs cleanup-runtime',
    'agents:release:check': 'node ./scripts/agent-coordination.mjs release-check',
    'agents:board:inspect': 'node ./scripts/agent-coordination.mjs inspect-board',
    'agents:board:repair': 'node ./scripts/agent-coordination.mjs repair-board',
    'agents:state:rollback': 'node ./scripts/agent-coordination.mjs rollback-state',
    'agents:run-check': 'node ./scripts/agent-coordination.mjs run-check',
    'agents2': 'node ./scripts/agent-coordination-two.mjs',
    'agents2:init': 'node ./scripts/agent-coordination-two.mjs init',
    'agents2:plan': 'node ./scripts/agent-coordination-two.mjs plan',
    'agents2:status': 'node ./scripts/agent-coordination-two.mjs status',
    'agents2:validate': 'node ./scripts/agent-coordination-two.mjs validate',
    'agents2:doctor': 'node ./scripts/agent-coordination-two.mjs doctor',
    'agents2:doctor:json': 'node ./scripts/agent-coordination-two.mjs doctor --json',
    'agents2:doctor:fix': 'node ./scripts/agent-coordination-two.mjs doctor --fix',
    'agents2:explain-config': 'node ./scripts/agent-coordination-two.mjs explain-config',
    'agents2:summarize': 'node ./scripts/agent-coordination-two.mjs summarize',
    'agents2:start': 'node ./scripts/agent-coordination-two.mjs start',
    'agents2:finish': 'node ./scripts/agent-coordination-two.mjs finish',
    'agents2:handoff-ready': 'node ./scripts/agent-coordination-two.mjs handoff-ready',
    'agents2:lock:status': 'node ./scripts/agent-coordination-two.mjs lock-status',
    'agents2:lock:clear': 'node ./scripts/agent-coordination-two.mjs lock-clear --stale-only',
    'agents2:heartbeat:start': 'node ./scripts/agent-coordination-two.mjs heartbeat-start',
    'agents2:heartbeat:status': 'node ./scripts/agent-coordination-two.mjs heartbeat-status',
    'agents2:heartbeat:stop': 'node ./scripts/agent-coordination-two.mjs heartbeat-stop',
    'agents2:watch:start': 'node ./scripts/agent-coordination-two.mjs watch-start',
    'agents2:watch:status': 'node ./scripts/agent-coordination-two.mjs watch-status',
    'agents2:watch:stop': 'node ./scripts/agent-coordination-two.mjs watch-stop',
    'agents2:watch:node': 'node ./scripts/agent-watch-loop.mjs --coordinator-script ./scripts/agent-coordination-two.mjs',
    'agents2:watch:diagnose': 'node ./scripts/agent-coordination-two.mjs watch-diagnose',
    'agents2:runtime:cleanup': 'node ./scripts/agent-coordination-two.mjs cleanup-runtime',
    'agents2:release:check': 'node ./scripts/agent-coordination-two.mjs release-check',
    'agents2:board:inspect': 'node ./scripts/agent-coordination-two.mjs inspect-board',
    'agents2:board:repair': 'node ./scripts/agent-coordination-two.mjs repair-board',
    'agents2:state:rollback': 'node ./scripts/agent-coordination-two.mjs rollback-state',
    'agents2:run-check': 'node ./scripts/agent-coordination-two.mjs run-check',
    'validate:agents-config': 'node ./scripts/validate-config.mjs',
  };
}

function doctorFix() {
  const fixes = [];
  const { configPath } = loadConfig();
  const paths = getCoordinationPaths();
  if (!fs.existsSync(configPath)) { createStarterConfig(configPath); fixes.push(`created ${normalizePath(configPath)}`); }
  if (appendUniqueLines(path.join(ROOT, '.gitignore'), ['', '# Local AI agent coordination runtime state', '/coordination/', '/coordination-two/', '/artifacts/'])) fixes.push('updated .gitignore');
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
    if (changed.length) { writePackageScripts(packageJsonPath, packageJson.scripts); fixes.push(`updated package.json scripts: ${changed.join(', ')}`); }
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

function findTopLevelObjectProperty(text, propertyName) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      if (depth !== 1) {
        inString = true;
        continue;
      }
      let end = index + 1;
      let key = '';
      let keyEscaped = false;
      for (; end < text.length; end += 1) {
        const keyChar = text[end];
        if (keyEscaped) {
          key += keyChar;
          keyEscaped = false;
        } else if (keyChar === '\\') {
          keyEscaped = true;
        } else if (keyChar === '"') {
          break;
        } else {
          key += keyChar;
        }
      }
      if (key !== propertyName) {
        inString = true;
        continue;
      }
      let colon = end + 1;
      while (/\s/.test(text[colon] ?? '')) colon += 1;
      if (text[colon] !== ':') {
        inString = true;
        continue;
      }
      let valueStart = colon + 1;
      while (/\s/.test(text[valueStart] ?? '')) valueStart += 1;
      if (text[valueStart] !== '{') return null;
      let valueDepth = 0;
      let valueInString = false;
      let valueEscaped = false;
      for (let valueEnd = valueStart; valueEnd < text.length; valueEnd += 1) {
        const valueChar = text[valueEnd];
        if (valueInString) {
          if (valueEscaped) valueEscaped = false;
          else if (valueChar === '\\') valueEscaped = true;
          else if (valueChar === '"') valueInString = false;
          continue;
        }
        if (valueChar === '"') valueInString = true;
        else if (valueChar === '{') valueDepth += 1;
        else if (valueChar === '}') {
          valueDepth -= 1;
          if (valueDepth === 0) return { start: index, end: valueEnd + 1 };
        }
      }
      return null;
    }
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
  }
  return null;
}

function formatScriptsProperty(scripts) {
  return `"scripts": ${JSON.stringify(scripts, null, 2).replace(/\n/g, '\n  ')}`;
}

function writePackageScripts(packageJsonPath, scripts) {
  const current = fs.readFileSync(packageJsonPath, 'utf8');
  const property = formatScriptsProperty(scripts);
  const range = findTopLevelObjectProperty(current, 'scripts');
  if (range) {
    fs.writeFileSync(packageJsonPath, `${current.slice(0, range.start)}${property}${current.slice(range.end)}`);
    return;
  }
  const openBrace = current.indexOf('{');
  if (openBrace < 0) {
    fs.writeFileSync(packageJsonPath, `${JSON.stringify({ scripts }, null, 2)}\n`);
    return;
  }
  const afterOpen = openBrace + 1;
  const suffix = current.slice(afterOpen).replace(/^\s*/, '\n');
  fs.writeFileSync(packageJsonPath, `${current.slice(0, afterOpen)}\n  ${property},${suffix}`);
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
  const gitCandidates = process.platform === 'win32' ? ['git.exe', 'git.cmd', 'git'] : ['git'];
  let gitCommand = null;
  function git(args) {
    const candidates = gitCommand ? [gitCommand] : gitCandidates;
    let lastError = null;
    for (const candidate of candidates) {
      try {
        const output = execFileSync(candidate, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        gitCommand = candidate;
        return output;
      } catch (error) {
        lastError = error;
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
    }
    throw lastError ?? new Error('Git executable was not found.');
  }
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

function parseIsoMs(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function hoursSince(value) {
  const parsed = parseIsoMs(value);
  return parsed ? Math.max(0, (Date.now() - parsed) / 36e5) : null;
}

function taskSummary(task) {
  const owner = task.ownerId || task.suggestedOwnerId || 'unowned';
  const title = task.title || task.summary || task.id;
  const paths = Array.isArray(task.claimedPaths) && task.claimedPaths.length ? ` paths: ${task.claimedPaths.join(', ')}` : '';
  return `- ${task.id}: ${title} [${task.status || 'unknown'} / ${owner}]${paths}`;
}

function isTaskStale(task, staleHours = DEFAULT_STALE_TASK_HOURS) {
  if (!ACTIVE_STATUSES.has(task.status)) return false;
  const age = hoursSince(task.updatedAt || task.lastUpdatedAt || task.createdAt);
  return age !== null && age >= staleHours;
}

function readRecentJournalLines(journalPath, limit = DEFAULT_RECENT_CONTEXT_LINES) {
  if (!fs.existsSync(journalPath)) return [];
  return fs.readFileSync(journalPath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-limit);
}

function readRecentMessages(messagesPath, limit = DEFAULT_RECENT_CONTEXT_LINES) {
  if (!fs.existsSync(messagesPath)) return [];
  const lines = fs.readFileSync(messagesPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-limit);
  return lines.map((line) => {
    try {
      const message = JSON.parse(line);
      const from = message.from || message.agent || message.sender || 'unknown';
      const to = message.to ? ` -> ${message.to}` : '';
      const body = message.body || message.message || message.text || line;
      return `- ${from}${to}: ${body}`;
    } catch {
      return `- ${line}`;
    }
  });
}

function getLockTimestamp(lock) {
  return parseIsoMs(lock?.lockedAt) ?? parseIsoMs(lock?.updatedAt) ?? parseIsoMs(lock?.createdAt) ?? parseIsoMs(lock?.acquiredAt) ?? parseIsoMs(lock?.at);
}

function inspectRuntimeLock(staleMs = DEFAULT_RUNTIME_STALE_MS) {
  const paths = getCoordinationPaths();
  const lockPath = path.join(paths.runtimeRoot, 'state.lock.json');
  const lockFile = readJsonDetailed(lockPath);
  if (!lockFile.exists) return { exists: false, path: lockPath, stale: false, staleReasons: [], ageMs: null, pidAlive: null, lock: null };
  if (lockFile.error) return { exists: true, path: lockPath, stale: true, staleReasons: ['malformed-json'], ageMs: null, pidAlive: null, lock: null, error: lockFile.error };
  const timestamp = getLockTimestamp(lockFile.value);
  const ageMs = timestamp === null ? null : Math.max(0, Date.now() - timestamp);
  const pidAlive = isPidAlive(lockFile.value?.pid);
  const staleByAge = ageMs !== null && ageMs >= staleMs;
  const staleByPid = pidAlive === false;
  return {
    exists: true,
    path: lockPath,
    stale: Boolean(staleByAge || staleByPid),
    staleReasons: [staleByAge ? `older-than-${staleMs}ms` : null, staleByPid ? 'pid-not-running' : null].filter(Boolean),
    ageMs,
    pidAlive,
    lock: lockFile.value,
  };
}

function getWatcherTimestamp(status) {
  return parseIsoMs(status?.lastHeartbeatAt) ?? parseIsoMs(status?.updatedAt) ?? parseIsoMs(status?.lastSweepAt) ?? parseIsoMs(status?.startedAt);
}

function inspectWatcher(staleMs = DEFAULT_RUNTIME_STALE_MS) {
  const paths = getCoordinationPaths();
  const statusFile = readJsonDetailed(paths.watcherStatusPath);
  if (!statusFile.exists) return { exists: false, path: paths.watcherStatusPath, stale: false, staleReasons: [], ageMs: null, pidAlive: null, status: null };
  if (statusFile.error) return { exists: true, path: paths.watcherStatusPath, stale: true, staleReasons: ['malformed-json'], ageMs: null, pidAlive: null, status: null, error: statusFile.error };
  const intervalMs = Number.parseInt(String(statusFile.value?.intervalMs ?? staleMs), 10);
  const maxAgeMs = Math.max(Number.isFinite(intervalMs) ? intervalMs * 3 : staleMs, staleMs);
  const timestamp = getWatcherTimestamp(statusFile.value);
  const ageMs = timestamp === null ? null : Math.max(0, Date.now() - timestamp);
  const pidAlive = isPidAlive(statusFile.value?.pid);
  const staleByAge = ageMs !== null && ageMs >= maxAgeMs;
  const staleByPid = pidAlive === false;
  return {
    exists: true,
    path: paths.watcherStatusPath,
    stale: Boolean(staleByAge || staleByPid || timestamp === null),
    staleReasons: [
      timestamp === null ? 'missing-timestamp' : null,
      staleByAge ? `older-than-${maxAgeMs}ms` : null,
      staleByPid ? 'pid-not-running' : null,
    ].filter(Boolean),
    ageMs,
    pidAlive,
    status: statusFile.value,
  };
}

function getHeartbeatMaxAgeMs(heartbeat) {
  const intervalMs = Number.parseInt(String(heartbeat?.intervalMs ?? 30000), 10);
  return Math.max(Number.isFinite(intervalMs) ? intervalMs * 3 : DEFAULT_HEARTBEAT_TTL_MS, DEFAULT_HEARTBEAT_TTL_MS);
}

function inspectHeartbeatFile(filePath) {
  const heartbeatFile = readJsonDetailed(filePath);
  const agentId = path.basename(filePath, path.extname(filePath));
  if (heartbeatFile.error) return { agentId, path: filePath, exists: true, stale: true, staleReasons: ['malformed-json'], ageMs: null, pidAlive: null, heartbeat: null, error: heartbeatFile.error };
  const heartbeat = heartbeatFile.value;
  const timestamp = parseIsoMs(heartbeat?.lastHeartbeatAt) ?? parseIsoMs(heartbeat?.updatedAt) ?? parseIsoMs(heartbeat?.startedAt);
  const ageMs = timestamp === null ? null : Math.max(0, Date.now() - timestamp);
  const maxAgeMs = getHeartbeatMaxAgeMs(heartbeat);
  const pidAlive = isPidAlive(heartbeat?.pid);
  const staleByAge = ageMs !== null && ageMs >= maxAgeMs;
  const staleByPid = pidAlive === false;
  return {
    agentId: heartbeat?.agentId || agentId,
    path: filePath,
    exists: true,
    stale: Boolean(staleByAge || staleByPid || timestamp === null),
    staleReasons: [
      timestamp === null ? 'missing-timestamp' : null,
      staleByAge ? `older-than-${maxAgeMs}ms` : null,
      staleByPid ? 'pid-not-running' : null,
    ].filter(Boolean),
    ageMs,
    pidAlive,
    heartbeat,
  };
}

function inspectHeartbeats() {
  const { heartbeatsRoot } = getCoordinationPaths();
  if (!fs.existsSync(heartbeatsRoot)) return [];
  return fs.readdirSync(heartbeatsRoot)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => inspectHeartbeatFile(path.join(heartbeatsRoot, entry)));
}

function buildRuntimeDiagnostics(argv = []) {
  const staleMs = getNumberFlag(argv, '--stale-ms', DEFAULT_RUNTIME_STALE_MS);
  const lock = inspectRuntimeLock(staleMs);
  const watcher = inspectWatcher(staleMs);
  const heartbeats = inspectHeartbeats();
  const staleHeartbeats = heartbeats.filter((entry) => entry.stale);
  const problems = [];
  const suggestions = [];
  if (lock.stale) problems.push(`Runtime lock is stale: ${lock.staleReasons.join(', ')}`);
  if (watcher.stale) problems.push(`Watcher status is stale: ${watcher.staleReasons.join(', ')}`);
  if (staleHeartbeats.length) problems.push(`${staleHeartbeats.length} stale heartbeat file(s) found.`);
  if (!watcher.exists) suggestions.push('Start the watcher with watch-start if automatic stale-work recovery is desired.');
  if (lock.stale || watcher.stale || staleHeartbeats.length) suggestions.push('Run cleanup-runtime --apply after confirming no coordinator command is still running.');
  return { ok: problems.length === 0, staleMs, coordinationRoot: getCoordinationPaths().coordinationRoot, lock, watcher, heartbeats, problems, suggestions };
}

function printRuntimeDiagnostics(report, json = false) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`# Runtime Diagnostics\n\nCoordination root: ${normalizePath(report.coordinationRoot) || report.coordinationRoot}`);
  console.log(`Lock: ${report.lock.exists ? (report.lock.stale ? `stale (${report.lock.staleReasons.join(', ')})` : 'present') : 'missing'}`);
  console.log(`Watcher: ${report.watcher.exists ? (report.watcher.stale ? `stale (${report.watcher.staleReasons.join(', ')})` : 'present') : 'missing'}`);
  console.log(`Heartbeats: ${report.heartbeats.length} file(s), ${report.heartbeats.filter((entry) => entry.stale).length} stale`);
  console.log('\nProblems:');
  console.log(report.problems.length ? report.problems.map((entry) => `- ${entry}`).join('\n') : '- none');
  console.log('\nSuggestions:');
  console.log(report.suggestions.length ? report.suggestions.map((entry) => `- ${entry}`).join('\n') : '- none');
}

function runWatchDiagnose(argv) {
  const report = buildRuntimeDiagnostics(argv);
  printRuntimeDiagnostics(report, hasFlag(argv, '--json'));
  return report.ok ? 0 : 1;
}

function runCleanupRuntime(argv) {
  const apply = hasFlag(argv, '--apply');
  const json = hasFlag(argv, '--json');
  const report = buildRuntimeDiagnostics(argv);
  const candidates = [];
  if (report.lock.exists && report.lock.stale) candidates.push({ kind: 'lock', path: report.lock.path, reasons: report.lock.staleReasons });
  if (report.watcher.exists && report.watcher.stale) candidates.push({ kind: 'watcher-status', path: report.watcher.path, reasons: report.watcher.staleReasons });
  for (const heartbeat of report.heartbeats.filter((entry) => entry.stale)) candidates.push({ kind: 'heartbeat', path: heartbeat.path, reasons: heartbeat.staleReasons });
  const removed = [];
  if (apply) {
    for (const candidate of candidates) {
      fs.rmSync(candidate.path, { force: true });
      removed.push(candidate);
    }
  }
  const result = { ok: true, applied: apply, candidates, removed };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(apply ? 'Runtime cleanup applied.' : 'Runtime cleanup dry run.');
    console.log(candidates.length ? candidates.map((entry) => `- ${entry.kind}: ${normalizePath(entry.path) || entry.path} (${entry.reasons.join(', ')})`).join('\n') : '- nothing to clean');
  }
  return 0;
}

function getConfiguredAgentIds() {
  const { config } = loadConfig();
  return Array.isArray(config.agentIds) && config.agentIds.length ? config.agentIds.filter((entry) => typeof entry === 'string' && entry.trim()) : DEFAULT_AGENT_IDS;
}

function createStarterBoard() {
  const { config } = loadConfig();
  const timestamp = nowIso();
  return {
    version: 1,
    projectName: config.projectName || path.basename(ROOT),
    agents: getConfiguredAgentIds().map((id) => ({ id, status: 'idle', taskId: null, updatedAt: timestamp })),
    tasks: [],
    resources: [],
    incidents: [],
    accessRequests: [],
    updatedAt: timestamp,
  };
}

function readBoardDetailed() {
  const { boardPath } = getCoordinationPaths();
  return { boardPath, ...readJsonDetailed(boardPath) };
}

function countTasksByStatus(tasks) {
  const counts = {};
  for (const task of tasks) counts[task?.status || 'unknown'] = (counts[task?.status || 'unknown'] ?? 0) + 1;
  return counts;
}

function inspectBoard() {
  const { boardPath, exists, value: board, error } = readBoardDetailed();
  const findings = [];
  const warnings = [];
  if (!exists) return { ok: false, boardPath, exists, findings: ['board.json does not exist. Run doctor --fix or init first.'], warnings, counts: {}, tasks: 0 };
  if (error) return { ok: false, boardPath, exists, malformed: true, findings: [`board.json is not valid JSON: ${error}`], warnings, counts: {}, tasks: 0 };
  if (!board || typeof board !== 'object' || Array.isArray(board)) return { ok: false, boardPath, exists, findings: ['board.json must contain an object.'], warnings, counts: {}, tasks: 0 };
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const agents = Array.isArray(board.agents) ? board.agents : [];
  if (!Array.isArray(board.tasks)) warnings.push('tasks is missing or not an array.');
  if (!Array.isArray(board.agents)) warnings.push('agents is missing or not an array.');
  for (const key of ['resources', 'incidents', 'accessRequests']) {
    if (key in board && !Array.isArray(board[key])) warnings.push(`${key} is not an array.`);
  }
  const taskIds = new Set();
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) {
      findings.push('A task entry is not an object.');
      continue;
    }
    if (!task.id || typeof task.id !== 'string') {
      findings.push('A task is missing a string id.');
      continue;
    }
    if (taskIds.has(task.id)) findings.push(`Task id "${task.id}" is duplicated.`);
    taskIds.add(task.id);
    if (!VALID_TASK_STATUSES.has(task.status)) findings.push(`Task "${task.id}" has unknown status "${task.status}".`);
    if (ACTIVE_STATUSES.has(task.status) && !task.ownerId) findings.push(`Task "${task.id}" is ${task.status} but has no owner.`);
  }
  const agentIds = new Set();
  for (const agent of agents) {
    if (!agent || typeof agent !== 'object' || Array.isArray(agent)) {
      findings.push('An agent entry is not an object.');
      continue;
    }
    if (!agent.id || typeof agent.id !== 'string') {
      findings.push('An agent is missing a string id.');
      continue;
    }
    if (agentIds.has(agent.id)) findings.push(`Agent id "${agent.id}" is duplicated.`);
    agentIds.add(agent.id);
    if (agent.taskId && !taskIds.has(agent.taskId)) findings.push(`Agent "${agent.id}" points to missing task "${agent.taskId}".`);
  }
  for (const task of tasks) {
    if (!task?.ownerId) continue;
    if (!agentIds.has(task.ownerId)) findings.push(`Task "${task.id}" is owned by unknown agent "${task.ownerId}".`);
  }
  const overlapFindings = [];
  const claimed = tasks.filter((task) => task?.ownerId && ACTIVE_STATUSES.has(task.status) && Array.isArray(task.claimedPaths));
  for (let leftIndex = 0; leftIndex < claimed.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < claimed.length; rightIndex += 1) {
      const overlap = claimed[leftIndex].claimedPaths.find((left) => claimed[rightIndex].claimedPaths.includes(left));
      if (overlap) overlapFindings.push(`Active path overlap between "${claimed[leftIndex].id}" and "${claimed[rightIndex].id}" on "${overlap}".`);
    }
  }
  findings.push(...overlapFindings);
  return { ok: findings.length === 0, boardPath, exists, malformed: false, findings, warnings, counts: countTasksByStatus(tasks), tasks: tasks.length, agents: agents.length, updatedAt: board.updatedAt ?? null };
}

function printBoardInspection(report, json = false) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`# Board Inspection\n\nBoard: ${normalizePath(report.boardPath) || report.boardPath}`);
  console.log(`Tasks: ${report.tasks}`);
  console.log(`Agents: ${report.agents ?? 0}`);
  console.log(`Counts: ${Object.entries(report.counts).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`);
  console.log('\nFindings:');
  console.log(report.findings.length ? report.findings.map((entry) => `- ${entry}`).join('\n') : '- none');
  console.log('\nWarnings:');
  console.log(report.warnings.length ? report.warnings.map((entry) => `- ${entry}`).join('\n') : '- none');
}

function repairBoardObject(board) {
  const repaired = board && typeof board === 'object' && !Array.isArray(board) ? JSON.parse(JSON.stringify(board)) : createStarterBoard();
  const changes = [];
  const timestamp = nowIso();
  if (!Number.isInteger(repaired.version)) { repaired.version = 1; changes.push('set version'); }
  if (typeof repaired.projectName !== 'string' || !repaired.projectName.trim()) { repaired.projectName = loadConfig().config.projectName || path.basename(ROOT); changes.push('set projectName'); }
  for (const key of ['tasks', 'resources', 'incidents', 'accessRequests']) {
    if (!Array.isArray(repaired[key])) { repaired[key] = []; changes.push(`initialized ${key}`); }
  }
  if (!Array.isArray(repaired.agents)) { repaired.agents = []; changes.push('initialized agents'); }
  for (const agentId of getConfiguredAgentIds()) {
    if (!repaired.agents.some((agent) => agent?.id === agentId)) {
      repaired.agents.push({ id: agentId, status: 'idle', taskId: null, updatedAt: timestamp });
      changes.push(`added agent ${agentId}`);
    }
  }
  const agentIds = new Set(repaired.agents.map((agent) => agent?.id).filter(Boolean));
  const taskIds = new Set();
  for (const task of repaired.tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task) || typeof task.id !== 'string' || !task.id) continue;
    taskIds.add(task.id);
    if (!VALID_TASK_STATUSES.has(task.status)) {
      if (!task.status) { task.status = 'planned'; changes.push(`set missing status on ${task.id}`); }
    }
    for (const key of ['claimedPaths', 'dependencies', 'waitingOn', 'verification', 'verificationLog', 'notes', 'relevantDocs']) {
      if (!Array.isArray(task[key])) { task[key] = []; changes.push(`initialized ${task.id}.${key}`); }
    }
    if (!('docsReviewedAt' in task)) { task.docsReviewedAt = null; changes.push(`initialized ${task.id}.docsReviewedAt`); }
    if (!('lastOwnerId' in task)) { task.lastOwnerId = null; changes.push(`initialized ${task.id}.lastOwnerId`); }
    if (task.ownerId && !agentIds.has(task.ownerId)) { task.lastOwnerId = task.ownerId; task.ownerId = null; task.status = task.status === 'active' ? 'handoff' : task.status; changes.push(`cleared unknown owner on ${task.id}`); }
  }
  for (const agent of repaired.agents) {
    if (!agent || typeof agent !== 'object' || !agent.id) continue;
    if (!agent.status) { agent.status = agent.taskId ? 'active' : 'idle'; changes.push(`set status on ${agent.id}`); }
    if (agent.taskId && !taskIds.has(agent.taskId)) { agent.taskId = null; agent.status = 'idle'; changes.push(`cleared missing task pointer on ${agent.id}`); }
    if (!agent.updatedAt) agent.updatedAt = timestamp;
  }
  if (changes.length) repaired.updatedAt = timestamp;
  return { board: repaired, changes };
}

function snapshotBoard(label = 'snapshot') {
  const { boardPath, snapshotsRoot } = getCoordinationPaths();
  if (!fs.existsSync(boardPath)) return null;
  fs.mkdirSync(snapshotsRoot, { recursive: true });
  const snapshotPath = path.join(snapshotsRoot, `board-${fileTimestamp()}-${label}.json`);
  fs.copyFileSync(boardPath, snapshotPath);
  return snapshotPath;
}

function runInspectBoard(argv) {
  const report = inspectBoard();
  printBoardInspection(report, hasFlag(argv, '--json'));
  return report.ok ? 0 : 1;
}

function runRepairBoard(argv) {
  const apply = hasFlag(argv, '--apply');
  const json = hasFlag(argv, '--json');
  const { exists, value: board, error } = readBoardDetailed();
  if (error) {
    const result = { ok: false, applied: false, error: `Cannot repair malformed JSON automatically: ${error}` };
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.error(result.error);
    return 1;
  }
  const sourceBoard = exists ? board : createStarterBoard();
  const repair = repairBoardObject(sourceBoard);
  const result = { ok: true, applied: apply, createdBoard: !exists, changes: exists ? repair.changes : ['created board'], snapshotPath: null };
  if (apply) {
    result.snapshotPath = snapshotBoard('before-repair');
    writeJson(getCoordinationPaths().boardPath, repair.board);
  }
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(apply ? 'Board repair applied.' : 'Board repair dry run.');
    console.log(result.changes.length ? result.changes.map((entry) => `- ${entry}`).join('\n') : '- no changes needed');
    if (result.snapshotPath) console.log(`Snapshot: ${normalizePath(result.snapshotPath) || result.snapshotPath}`);
  }
  return 0;
}

function listBoardSnapshots() {
  const { snapshotsRoot } = getCoordinationPaths();
  if (!fs.existsSync(snapshotsRoot)) return [];
  return fs.readdirSync(snapshotsRoot)
    .filter((entry) => /^board-.*\.json$/.test(entry))
    .map((entry) => path.join(snapshotsRoot, entry))
    .sort();
}

function runRollbackState(argv) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const snapshots = listBoardSnapshots();
  if (hasFlag(argv, '--list') || !getFlagValue(argv, '--to', '')) {
    const result = { snapshots };
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(snapshots.length ? snapshots.map((entry) => `- ${normalizePath(entry) || entry}`).join('\n') : 'No board snapshots found.');
    return 0;
  }
  const target = getFlagValue(argv, '--to', '');
  const snapshotPath = target === 'latest' ? snapshots.at(-1) : resolveRepoPath(target, target);
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    const message = `Snapshot not found: ${target}`;
    if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(message);
    return 1;
  }
  const parsed = readJsonDetailed(snapshotPath);
  if (parsed.error) {
    const message = `Snapshot is not valid JSON: ${parsed.error}`;
    if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(message);
    return 1;
  }
  const result = { ok: true, applied: apply, snapshotPath, backupPath: null };
  if (apply) {
    result.backupPath = snapshotBoard('before-rollback');
    writeJson(getCoordinationPaths().boardPath, parsed.value);
  }
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(apply ? `Rolled back board from ${normalizePath(snapshotPath) || snapshotPath}.` : `Rollback dry run: ${normalizePath(snapshotPath) || snapshotPath}`);
    if (result.backupPath) console.log(`Previous board snapshot: ${normalizePath(result.backupPath) || result.backupPath}`);
  }
  return 0;
}

function latestVerificationOutcome(task, check) {
  const log = Array.isArray(task?.verificationLog) ? task.verificationLog : [];
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const entry = log[index];
    if (entry?.check === check) return String(entry.outcome || entry.status || '').toLowerCase();
  }
  return null;
}

function buildReleaseCheckForTask(task, board, options = {}) {
  const findings = [];
  const warnings = [];
  if (!task) return { ok: false, taskId: null, findings: ['Task was not found.'], warnings };
  if (task.status === 'released') warnings.push('Task is already released.');
  else if (task.status !== 'done') findings.push(`Task status must be done before release; current status is ${task.status || 'unknown'}.`);
  const requiredChecks = Array.isArray(task.verification) ? task.verification : [];
  for (const check of requiredChecks) {
    const outcome = latestVerificationOutcome(task, check);
    if (outcome !== 'pass') findings.push(`Missing passing verification for ${check}.`);
  }
  const latestFailures = new Set();
  for (const entry of Array.isArray(task.verificationLog) ? task.verificationLog : []) {
    if (entry?.check && String(entry.outcome || entry.status || '').toLowerCase() === 'fail') latestFailures.add(entry.check);
    if (entry?.check && String(entry.outcome || entry.status || '').toLowerCase() === 'pass') latestFailures.delete(entry.check);
  }
  for (const check of latestFailures) findings.push(`Latest verification is failing for ${check}.`);
  const requireDocReview = options.requireDocReview || (Array.isArray(task.relevantDocs) && task.relevantDocs.length > 0);
  if (requireDocReview && !task.docsReviewedAt) findings.push('Docs review is required but docsReviewedAt is missing.');
  for (const dependencyId of Array.isArray(task.dependencies) ? task.dependencies : []) {
    const dependency = Array.isArray(board.tasks) ? board.tasks.find((entry) => entry.id === dependencyId) : null;
    if (!dependency) findings.push(`Dependency ${dependencyId} is missing.`);
    else if (!TERMINAL_STATUSES.has(dependency.status)) findings.push(`Dependency ${dependencyId} is ${dependency.status}; expected done or released.`);
  }
  return { ok: findings.length === 0, taskId: task.id, status: task.status, findings, warnings };
}

function buildReleaseCheckReport(argv) {
  const requireDocReview = hasFlag(argv, '--require-doc-review');
  const taskId = getPositionals(argv, new Set(['--out-dir', '--title'])).at(0);
  const { boardPath } = getCoordinationPaths();
  const board = readJsonSafe(boardPath, { tasks: [] });
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const candidates = taskId ? tasks.filter((task) => task.id === taskId) : tasks.filter((task) => task.status === 'done' || task.status === 'released');
  const checks = candidates.length ? candidates.map((task) => buildReleaseCheckForTask(task, board, { requireDocReview })) : [{ ok: false, taskId: taskId || null, findings: [taskId ? `Task ${taskId} was not found.` : 'No done or released tasks found.'], warnings: [] }];
  return { ok: checks.every((check) => check.ok), boardPath, checks };
}

function runReleaseCheck(argv) {
  const json = hasFlag(argv, '--json');
  const result = buildReleaseCheckReport(argv);
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('# Release Check');
    for (const check of checks) {
      console.log(`\n${check.taskId || 'task'}: ${check.ok ? 'ready' : 'blocked'}`);
      console.log(check.findings.length ? check.findings.map((entry) => `- ${entry}`).join('\n') : '- no blocking findings');
      if (check.warnings.length) console.log(check.warnings.map((entry) => `- warning: ${entry}`).join('\n'));
    }
  }
  return result.ok ? 0 : 1;
}

function sanitizeArtifactName(value) {
  return String(value || 'check').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'check';
}

function parseRunCheckArgs(argv) {
  const delimiter = argv.indexOf('--');
  const before = delimiter >= 0 ? argv.slice(0, delimiter) : argv;
  const after = delimiter >= 0 ? argv.slice(delimiter + 1) : [];
  const name = before.find((entry) => !entry.startsWith('--')) || 'check';
  return {
    name,
    json: hasFlag(before, '--json'),
    artifactDir: getFlagValue(before, '--artifact-dir', ''),
    command: after,
  };
}

function runCheckCommand(argv) {
  const args = parseRunCheckArgs(argv);
  const packageJson = loadPackageJson().packageJson;
  let command = args.command;
  if (!command.length) {
    if (!packageJson?.scripts?.[args.name]) {
      console.error(`No command provided and package.json has no "${args.name}" script.`);
      return 1;
    }
    command = [process.platform === 'win32' ? 'npm.cmd' : 'npm', 'run', args.name];
  }
  const startedAt = nowIso();
  const result = spawnSync(command[0], command.slice(1), { cwd: ROOT, encoding: 'utf8', shell: false });
  const finishedAt = nowIso();
  const exitCode = result.error ? 1 : result.status ?? 0;
  const paths = getCoordinationPaths();
  const artifactRoot = args.artifactDir ? resolveRepoPath(args.artifactDir, args.artifactDir) : paths.artifactsRoot;
  fs.mkdirSync(artifactRoot, { recursive: true });
  const artifactPath = path.join(artifactRoot, `${fileTimestamp()}-${sanitizeArtifactName(args.name)}.log`);
  const stdout = result.stdout || '';
  const stderr = result.stderr || (result.error ? result.error.message : '');
  fs.writeFileSync(artifactPath, [
    `check: ${args.name}`,
    `command: ${command.join(' ')}`,
    `startedAt: ${startedAt}`,
    `finishedAt: ${finishedAt}`,
    `exitCode: ${exitCode}`,
    '',
    '--- stdout ---',
    stdout,
    '--- stderr ---',
    stderr,
  ].join('\n'));
  const artifactIndexPath = path.join(artifactRoot, 'index.ndjson');
  fs.mkdirSync(path.dirname(artifactIndexPath), { recursive: true });
  const indexEntry = { name: args.name, command, startedAt, finishedAt, exitCode, artifactPath };
  fs.appendFileSync(artifactIndexPath, `${JSON.stringify(indexEntry)}\n`);
  if (args.json) console.log(JSON.stringify(indexEntry, null, 2));
  else {
    console.log(`Check ${args.name} ${exitCode === 0 ? 'passed' : 'failed'} with exit code ${exitCode}.`);
    console.log(`Artifact: ${normalizePath(artifactPath) || artifactPath}`);
  }
  return exitCode;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : [];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeUniqueArray(left, right) {
  return [...new Set([...stringArray(left), ...stringArray(right)])];
}

function mergeConfigValue(current, patch, options = {}) {
  if (Array.isArray(patch)) return mergeUniqueArray(Array.isArray(current) ? current : [], patch);
  if (isPlainObject(patch)) {
    const target = isPlainObject(current) ? { ...current } : {};
    for (const [key, value] of Object.entries(patch)) {
      target[key] = mergeConfigValue(target[key], value, options);
    }
    return target;
  }
  return options.overrideScalars || current === undefined ? patch : current;
}

function mergeConfigPatch(config, patch, options = {}) {
  return mergeConfigValue(config, patch, options);
}

function diffConfig(before, after, prefix = '') {
  const changes = [];
  const keys = new Set([...Object.keys(isPlainObject(before) ? before : {}), ...Object.keys(isPlainObject(after) ? after : {})]);
  for (const key of [...keys].sort()) {
    const beforeValue = before?.[key];
    const afterValue = after?.[key];
    const pathLabel = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(beforeValue) && isPlainObject(afterValue)) {
      changes.push(...diffConfig(beforeValue, afterValue, pathLabel));
    } else if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes.push({ path: pathLabel, before: beforeValue ?? null, after: afterValue ?? null });
    }
  }
  return changes;
}

function addConfigSuggestion(suggestions, severity, code, message, recommendation) {
  suggestions.push({ severity, code, message, recommendation });
}

function detectRepoSignals(packageJson) {
  const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object' ? packageJson.scripts : {};
  const deps = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };
  const scriptText = Object.entries(scripts).map(([name, command]) => `${name} ${command}`).join(' ').toLowerCase();
  return {
    hasTests: Object.keys(scripts).some((name) => /test|spec|unit/i.test(name)),
    hasBuild: Object.keys(scripts).some((name) => /build/i.test(name)),
    hasVisual: /visual|playwright|screenshot|snapshot/.test(scriptText) || 'playwright' in deps,
    react: 'react' in deps || fs.existsSync(path.join(ROOT, 'src')) || fs.existsSync(path.join(ROOT, 'components')),
    expo: 'expo' in deps || fs.existsSync(path.join(ROOT, 'app.json')) || fs.existsSync(path.join(ROOT, 'app.config.js')) || fs.existsSync(path.join(ROOT, 'app.config.ts')),
    supabase: 'supabase' in deps || fs.existsSync(path.join(ROOT, 'supabase')) || fs.existsSync(path.join(ROOT, 'migrations')),
  };
}

function buildConfigSuggestions(config, validation, packageJson) {
  const suggestions = [];
  const docsRoots = stringArray(config.docs?.roots);
  const sharedRisk = stringArray(config.paths?.sharedRisk);
  const visualImpact = stringArray(config.paths?.visualImpact);
  const visualChecks = stringArray(config.verification?.visualRequiredChecks);
  const branchPatterns = stringArray(config.git?.allowedBranchPatterns);
  const domains = stringArray(Array.isArray(config.domainRules) ? config.domainRules.map((rule) => rule?.name) : []);
  const signals = detectRepoSignals(packageJson);

  if (!docsRoots.length) {
    addConfigSuggestion(suggestions, 'warning', 'docs-roots-empty', 'No docs roots are configured.', 'Set docs.roots to the directories agents should read before claiming work.');
  } else if (!docsRoots.some((entry) => fs.existsSync(path.resolve(ROOT, entry)))) {
    addConfigSuggestion(suggestions, 'warning', 'docs-roots-missing', 'Configured docs roots do not exist yet.', 'Create the docs roots or update docs.roots to existing documentation paths.');
  }

  if (!sharedRisk.length) {
    addConfigSuggestion(suggestions, 'warning', 'shared-risk-empty', 'No shared-risk paths are configured.', 'Set paths.sharedRisk to directories where overlapping edits need extra caution.');
  }

  if ((visualImpact.length || signals.hasVisual || signals.react || signals.expo) && !visualChecks.length) {
    addConfigSuggestion(suggestions, 'warning', 'visual-checks-missing', 'Visual-impact paths or frontend signals exist but no required visual checks are configured.', 'Set verification.visualRequiredChecks to checks such as visual:test or screenshot tests.');
  }

  if (signals.hasTests && !stringArray(config.verification?.requiredChecks).length && !visualChecks.length) {
    addConfigSuggestion(suggestions, 'info', 'verification-checks-light', 'Package test scripts exist, but config does not declare general required checks.', 'Add task verification expectations during planning or introduce a checks policy for common test scripts.');
  }

  if (config.git?.allowMainBranchClaims !== false) {
    addConfigSuggestion(suggestions, 'info', 'main-branch-claims-allowed', 'Claims on main/master are currently allowed.', 'Set git.allowMainBranchClaims to false for stricter multi-agent branch hygiene.');
  }

  if (!branchPatterns.length) {
    addConfigSuggestion(suggestions, 'info', 'branch-patterns-empty', 'No branch allowlist is configured.', 'Set git.allowedBranchPatterns when agents should only claim work on feature, fix, or agent branches.');
  }

  if (signals.supabase && !domains.some((entry) => /backend|data|database|supabase/i.test(entry))) {
    addConfigSuggestion(suggestions, 'info', 'supabase-domain-missing', 'Supabase or migration files were detected without a matching backend/data domain rule.', 'Add a domainRules entry for database or Supabase work.');
  }

  if (signals.expo && !domains.some((entry) => /mobile|expo|app/i.test(entry))) {
    addConfigSuggestion(suggestions, 'info', 'expo-domain-missing', 'Expo project signals were detected without a mobile/expo domain rule.', 'Add a domainRules entry for mobile or Expo work.');
  }

  for (const warning of validation.warnings ?? []) {
    addConfigSuggestion(suggestions, 'info', 'validation-warning', warning, 'Review the config warning and either create the referenced path or update the config.');
  }

  return suggestions;
}

function buildMigratedConfig(config) {
  let migrated = JSON.parse(JSON.stringify(config));
  migrated = mergeConfigPatch(migrated, {
    configVersion: CURRENT_CONFIG_VERSION,
    artifacts: DEFAULT_ARTIFACT_POLICY,
    checks: {},
  });
  if (!Number.isInteger(migrated.configVersion) || migrated.configVersion < CURRENT_CONFIG_VERSION) migrated.configVersion = CURRENT_CONFIG_VERSION;
  if (!isPlainObject(migrated.git)) migrated.git = DEFAULT_GIT_POLICY;
  if (!isPlainObject(migrated.artifacts)) migrated.artifacts = { ...DEFAULT_ARTIFACT_POLICY };
  return migrated;
}

function snapshotConfig(configPath) {
  if (!fs.existsSync(configPath)) return null;
  const { snapshotsRoot } = getCoordinationPaths();
  fs.mkdirSync(snapshotsRoot, { recursive: true });
  const snapshotPath = path.join(snapshotsRoot, `config-${fileTimestamp()}.json`);
  fs.copyFileSync(configPath, snapshotPath);
  return snapshotPath;
}

function runMigrateConfig(argv) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const { configPath, config } = loadConfig();
  if (!fs.existsSync(configPath)) {
    const result = { ok: false, applied: false, error: `Config not found: ${configPath}` };
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.error(result.error);
    return 1;
  }
  const migrated = buildMigratedConfig(config);
  const changes = diffConfig(config, migrated);
  const validation = validateAgentConfig(migrated, { root: ROOT });
  const result = { ok: validation.valid, applied: false, configPath, targetVersion: CURRENT_CONFIG_VERSION, changes, validation, snapshotPath: null };
  if (apply && validation.valid && changes.length) {
    result.snapshotPath = snapshotConfig(configPath);
    writeJson(configPath, migrated);
    result.applied = true;
  }
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(apply ? 'Config migration applied.' : 'Config migration dry run.');
    console.log(changes.length ? changes.map((change) => `- ${change.path}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`).join('\n') : '- no changes needed');
    if (!validation.valid) console.log(`Validation errors:\n${validation.errors.map((entry) => `- ${entry}`).join('\n')}`);
    if (result.snapshotPath) console.log(`Snapshot: ${normalizePath(result.snapshotPath) || result.snapshotPath}`);
  }
  return validation.valid ? 0 : 1;
}

function getPolicyPackNames(argv) {
  const names = getPositionals(argv).slice(1).flatMap((entry) => entry.split(',')).map((entry) => entry.trim()).filter(Boolean);
  return names;
}

function buildPolicyPackResult(packNames) {
  const { configPath, config } = loadConfig();
  const unknown = packNames.filter((name) => !POLICY_PACKS[name]);
  let nextConfig = JSON.parse(JSON.stringify(config));
  for (const name of packNames.filter((entry) => POLICY_PACKS[entry])) {
    nextConfig = mergeConfigPatch(nextConfig, POLICY_PACKS[name].config, { overrideScalars: true });
  }
  const changes = unknown.length ? [] : diffConfig(config, nextConfig);
  const validation = validateAgentConfig(nextConfig, { root: ROOT });
  return { ok: unknown.length === 0 && validation.valid, configPath, packs: packNames, unknown, changes, validation, nextConfig };
}

function runPolicyPacks(argv) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const subcommand = getPositionals(argv).at(0) || 'list';

  if (subcommand === 'list') {
    const result = { packs: Object.entries(POLICY_PACKS).map(([name, pack]) => ({ name, description: pack.description })) };
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(result.packs.map((pack) => `- ${pack.name}: ${pack.description}`).join('\n'));
    return 0;
  }

  if (subcommand === 'inspect') {
    const name = getPositionals(argv).at(1);
    const pack = POLICY_PACKS[name];
    if (!pack) {
      const result = { ok: false, error: `Unknown policy pack: ${name || ''}`, available: Object.keys(POLICY_PACKS) };
      if (json) console.log(JSON.stringify(result, null, 2));
      else console.error(result.error);
      return 1;
    }
    const result = { ok: true, name, ...pack };
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`# Policy Pack: ${name}\n\n${pack.description}\n`);
      console.log(JSON.stringify(pack.config, null, 2));
    }
    return 0;
  }

  if (subcommand === 'apply') {
    const packNames = getPolicyPackNames(argv);
    if (!packNames.length) {
      console.error('Usage: policy-packs apply <pack[,pack...]> [--apply] [--json]');
      return 1;
    }
    const result = buildPolicyPackResult(packNames);
    result.applied = false;
    result.snapshotPath = null;
    if (apply && result.ok && result.changes.length) {
      result.snapshotPath = snapshotConfig(result.configPath);
      writeJson(result.configPath, result.nextConfig);
      result.applied = true;
    }
    delete result.nextConfig;
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(apply ? 'Policy pack apply completed.' : 'Policy pack dry run.');
      if (result.unknown.length) console.log(`Unknown packs: ${result.unknown.join(', ')}`);
      console.log(result.changes.length ? result.changes.map((change) => `- ${change.path}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`).join('\n') : '- no changes needed');
      if (!result.validation.valid) console.log(`Validation errors:\n${result.validation.errors.map((entry) => `- ${entry}`).join('\n')}`);
      if (result.snapshotPath) console.log(`Snapshot: ${normalizePath(result.snapshotPath) || result.snapshotPath}`);
    }
    return result.ok ? 0 : 1;
  }

  console.error('Usage: policy-packs list [--json] | policy-packs inspect <pack> [--json] | policy-packs apply <pack[,pack...]> [--apply] [--json]');
  return 1;
}

function taskDisplayTitle(task) {
  return task?.title || task?.summary || task?.id || 'untitled task';
}

function latestVerificationEntries(task) {
  const latest = new Map();
  for (const entry of Array.isArray(task?.verificationLog) ? task.verificationLog : []) {
    if (entry?.check) latest.set(entry.check, entry);
  }
  return [...latest.values()];
}

function collectTaskArtifacts(task) {
  const artifacts = [];
  for (const entry of Array.isArray(task?.verificationLog) ? task.verificationLog : []) {
    for (const artifact of Array.isArray(entry?.artifacts) ? entry.artifacts : []) {
      if (artifact?.path) artifacts.push({ taskId: task.id, check: entry.check, outcome: entry.outcome || entry.status || null, ...artifact });
    }
  }
  return artifacts;
}

function readRunCheckArtifactIndex() {
  const indexPath = path.join(getCoordinationPaths().artifactsRoot, 'index.ndjson');
  if (!fs.existsSync(indexPath)) return [];
  return fs.readFileSync(indexPath, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const entry = JSON.parse(line);
      const artifactPath = entry.artifactPath || entry.path;
      if (!artifactPath) return [];
      const absolutePath = path.isAbsolute(artifactPath) ? artifactPath : path.resolve(ROOT, artifactPath);
      return [{
        source: 'run-check',
        path: normalizePath(absolutePath) || artifactPath,
        check: entry.name ?? null,
        taskId: entry.taskId ?? null,
        outcome: typeof entry.exitCode === 'number' ? (entry.exitCode === 0 ? 'pass' : 'fail') : null,
        exitCode: entry.exitCode ?? null,
        createdAt: entry.finishedAt || entry.startedAt || null,
      }];
    } catch {
      return [];
    }
  });
}

function buildArtifactItems() {
  const board = readJsonSafe(getCoordinationPaths().boardPath, { tasks: [] });
  const taskArtifacts = (Array.isArray(board.tasks) ? board.tasks : []).flatMap((task) =>
    collectTaskArtifacts(task).map((artifact) => ({ source: 'verification', ...artifact }))
  );
  return [...taskArtifacts, ...readRunCheckArtifactIndex()];
}

function getArtifactPolicy(argv = []) {
  const { config } = loadConfig();
  const configured = isPlainObject(config.artifacts) ? config.artifacts : {};
  const keepDays = getNumberFlag(argv, '--keep-days', configured.keepDays ?? DEFAULT_ARTIFACT_POLICY.keepDays);
  const keepFailedDays = getNumberFlag(argv, '--keep-failed-days', configured.keepFailedDays ?? DEFAULT_ARTIFACT_POLICY.keepFailedDays);
  const maxMb = getNumberFlag(argv, '--max-mb', configured.maxMb ?? DEFAULT_ARTIFACT_POLICY.maxMb);
  return {
    roots: stringArray(configured.roots).length ? stringArray(configured.roots) : DEFAULT_ARTIFACT_POLICY.roots,
    keepDays: Math.max(1, keepDays),
    keepFailedDays: Math.max(1, keepFailedDays),
    maxMb: Math.max(1, maxMb),
    protectPatterns: stringArray(configured.protectPatterns),
  };
}

function globPatternMatches(pattern, normalizedPath) {
  const normalizedPattern = normalizePath(pattern);
  if (!normalizedPattern) return false;
  if (!/[?*[\]]/.test(normalizedPattern)) return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`);
  const globstarToken = '\0GLOBSTAR\0';
  const escaped = normalizedPattern
    .replace(/\*\*/g, globstarToken)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll(globstarToken, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`).test(normalizedPath);
}

function listFilesRecursive(rootPath) {
  if (!fs.existsSync(rootPath)) return [];
  const files = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function buildTaskStatusMap() {
  const board = readJsonSafe(getCoordinationPaths().boardPath, { tasks: [] });
  return new Map((Array.isArray(board.tasks) ? board.tasks : []).map((task) => [task.id, task.status || 'unknown']));
}

function buildArtifactReferenceMap(items) {
  const references = new Map();
  for (const item of items) {
    if (!item.path) continue;
    const normalized = normalizePath(item.path);
    const current = references.get(normalized) ?? [];
    current.push(item);
    references.set(normalized, current);
  }
  return references;
}

function classifyArtifactFile(filePath, references, taskStatuses, policy, nowMs = Date.now()) {
  const normalizedPath = normalizePath(filePath);
  const stats = fs.statSync(filePath);
  const refs = references.get(normalizedPath) ?? [];
  const protectedByPattern = policy.protectPatterns.some((pattern) => globPatternMatches(pattern, normalizedPath));
  const protectedByActiveTask = refs.some((ref) => ref.taskId && ACTIVE_STATUSES.has(taskStatuses.get(ref.taskId)));
  const ageDays = Math.max(0, (nowMs - stats.mtimeMs) / 86400000);
  const failed = refs.some((ref) => String(ref.outcome || '').toLowerCase() === 'fail');
  const keepDays = failed ? policy.keepFailedDays : policy.keepDays;
  const eligibleByAge = ageDays >= keepDays;
  return {
    path: normalizedPath,
    absolutePath: filePath,
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    ageDays,
    references: refs,
    protected: protectedByPattern || protectedByActiveTask,
    protectedReasons: [protectedByPattern ? 'protected-pattern' : null, protectedByActiveTask ? 'active-task-reference' : null].filter(Boolean),
    eligibleByAge,
    reasons: eligibleByAge ? [`older-than-${keepDays}-days`] : [],
  };
}

function buildArtifactPrunePlan(argv = []) {
  const policy = getArtifactPolicy(argv);
  const items = buildArtifactItems();
  const references = buildArtifactReferenceMap(items);
  const taskStatuses = buildTaskStatusMap();
  const roots = policy.roots.map((root) => {
    const absolutePath = resolveRepoPath(root, root);
    const normalizedPath = normalizePath(absolutePath);
    return { root, absolutePath, normalizedPath, exists: fs.existsSync(absolutePath), skipped: normalizedPath.startsWith('..') };
  });
  const files = roots
    .filter((root) => root.exists && !root.skipped)
    .flatMap((root) => listFilesRecursive(root.absolutePath))
    .map((filePath) => classifyArtifactFile(filePath, references, taskStatuses, policy));
  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const maxBytes = policy.maxMb * 1024 * 1024;
  const candidates = new Map();
  for (const file of files) {
    if (!file.protected && file.eligibleByAge) candidates.set(file.path, { ...file });
  }
  let projectedBytes = totalBytes - [...candidates.values()].reduce((sum, file) => sum + file.sizeBytes, 0);
  if (projectedBytes > maxBytes) {
    const overflowCandidates = files
      .filter((file) => !file.protected && !candidates.has(file.path))
      .sort((left, right) => new Date(left.modifiedAt).getTime() - new Date(right.modifiedAt).getTime());
    for (const file of overflowCandidates) {
      if (projectedBytes <= maxBytes) break;
      candidates.set(file.path, { ...file, reasons: [...file.reasons, 'storage-limit'] });
      projectedBytes -= file.sizeBytes;
    }
  }
  return { policy, roots, totalBytes, maxBytes, files: files.length, candidates: [...candidates.values()] };
}

function runArtifactsPrune(argv) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const plan = buildArtifactPrunePlan(argv);
  const removed = [];
  if (apply) {
    for (const candidate of plan.candidates) {
      fs.rmSync(candidate.absolutePath, { force: true });
      removed.push({ path: candidate.path, sizeBytes: candidate.sizeBytes, reasons: candidate.reasons });
    }
  }
  const result = { ok: true, applied: apply, ...plan, removed };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(apply ? 'Artifact prune applied.' : 'Artifact prune dry run.');
    console.log(`Total: ${plan.totalBytes} bytes; limit: ${plan.maxBytes} bytes`);
    console.log(plan.candidates.length ? plan.candidates.map((candidate) => `- ${candidate.path} (${candidate.sizeBytes} bytes; ${candidate.reasons.join(', ')})`).join('\n') : '- nothing to prune');
  }
  return 0;
}

function runArtifactsCommand(argv) {
  const json = hasFlag(argv, '--json');
  const positionals = getPositionals(argv, new Set(['--task', '--check', '--keep-days', '--keep-failed-days', '--max-mb']));
  const subcommand = positionals[0] || 'list';
  const items = buildArtifactItems();

  if (subcommand === 'prune') return runArtifactsPrune(argv);

  if (subcommand === 'list') {
    const taskFilter = getFlagValue(argv, '--task', '');
    const checkFilter = getFlagValue(argv, '--check', '');
    const filtered = items.filter((item) => (!taskFilter || item.taskId === taskFilter) && (!checkFilter || item.check === checkFilter));
    if (json) console.log(JSON.stringify({ items: filtered }, null, 2));
    else console.log(filtered.length ? filtered.map((item) => `- ${item.path}${item.taskId ? ` (${item.taskId}` : ''}${item.check ? `${item.taskId ? ', ' : ' ('}${item.check}` : ''}${item.taskId || item.check ? ')' : ''}`).join('\n') : 'No artifacts found.');
    return 0;
  }

  if (subcommand === 'inspect') {
    const artifactPath = positionals[1];
    if (!artifactPath) {
      console.error('Usage: artifacts inspect <artifact-path> [--json]');
      return 1;
    }
    const absolutePath = path.isAbsolute(artifactPath) ? artifactPath : path.resolve(ROOT, artifactPath);
    if (!fs.existsSync(absolutePath)) {
      const result = { ok: false, path: artifactPath, error: 'Artifact does not exist.' };
      if (json) console.log(JSON.stringify(result, null, 2));
      else console.error(result.error);
      return 1;
    }
    const normalizedPath = normalizePath(absolutePath) || artifactPath;
    const stats = fs.statSync(absolutePath);
    const result = {
      ok: true,
      path: normalizedPath,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      references: items.filter((item) => item.path === normalizedPath),
    };
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Artifact: ${result.path}`);
      console.log(`Size: ${result.sizeBytes} bytes`);
      console.log(`Modified: ${result.modifiedAt}`);
      console.log(result.references.length ? `References: ${result.references.length}` : 'References: none');
    }
    return 0;
  }

  console.error('Usage: artifacts list [--task <task-id>] [--check <check>] [--json] | artifacts inspect <artifact-path> [--json] | artifacts prune [--apply] [--json]');
  return 1;
}

function pathsOverlap(left, right) {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(`${normalizedRight}/`) || normalizedRight.startsWith(`${normalizedLeft}/`);
}

function buildOwnershipMap() {
  const board = readJsonSafe(getCoordinationPaths().boardPath, { tasks: [] });
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const activeTasks = tasks.filter((task) => task?.ownerId && ACTIVE_STATUSES.has(task.status));
  const owners = [];
  const byOwner = new Map();
  for (const task of activeTasks) {
    const owner = byOwner.get(task.ownerId) ?? { agentId: task.ownerId, tasks: [], paths: [] };
    owner.tasks.push({ id: task.id, status: task.status, title: taskDisplayTitle(task), claimedPaths: stringArray(task.claimedPaths) });
    owner.paths.push(...stringArray(task.claimedPaths));
    byOwner.set(task.ownerId, owner);
  }
  owners.push(...byOwner.values());
  const overlaps = [];
  for (let leftIndex = 0; leftIndex < activeTasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < activeTasks.length; rightIndex += 1) {
      for (const leftPath of stringArray(activeTasks[leftIndex].claimedPaths)) {
        const rightPath = stringArray(activeTasks[rightIndex].claimedPaths).find((candidate) => pathsOverlap(leftPath, candidate));
        if (rightPath) overlaps.push({ leftTaskId: activeTasks[leftIndex].id, rightTaskId: activeTasks[rightIndex].id, leftPath, rightPath });
      }
    }
  }
  return { owners, overlaps };
}

function runOwnershipMap(argv) {
  const map = buildOwnershipMap();
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(map, null, 2));
  else {
    console.log('# Ownership Map');
    console.log(map.owners.length ? map.owners.map((owner) => `\n${owner.agentId}\n${owner.tasks.map((task) => `- ${task.id}: ${task.claimedPaths.join(', ') || 'no paths'}`).join('\n')}`).join('\n') : '\nNo active ownership.');
    console.log('\nOverlaps:');
    console.log(map.overlaps.length ? map.overlaps.map((entry) => `- ${entry.leftTaskId} ${entry.leftPath} overlaps ${entry.rightTaskId} ${entry.rightPath}`).join('\n') : '- none');
  }
  return map.overlaps.length ? 1 : 0;
}

function mermaidId(value) {
  return `task_${String(value).replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function buildDependencyGraph() {
  const board = readJsonSafe(getCoordinationPaths().boardPath, { tasks: [] });
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  return {
    nodes: tasks.map((task) => ({ id: task.id, label: `${task.id}\\n${taskDisplayTitle(task)}\\n${task.status || 'unknown'}` })),
    edges: tasks.flatMap((task) => stringArray(task.dependencies).map((dependencyId) => ({ from: dependencyId, to: task.id }))),
  };
}

function renderDependencyGraph(graph) {
  const lines = ['flowchart TD'];
  for (const node of graph.nodes) lines.push(`  ${mermaidId(node.id)}["${String(node.label).replace(/"/g, '\\"')}"]`);
  for (const edge of graph.edges) lines.push(`  ${mermaidId(edge.from)} --> ${mermaidId(edge.to)}`);
  return lines.join('\n');
}

function runDependencyGraph(argv) {
  const graph = buildDependencyGraph();
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(graph, null, 2));
  else console.log(renderDependencyGraph(graph));
  return 0;
}

function describeTaskForPr(task, board) {
  const releaseCheck = buildReleaseCheckForTask(task, board, { requireDocReview: false });
  return {
    id: task.id,
    title: taskDisplayTitle(task),
    status: task.status || 'unknown',
    summary: task.summary || '',
    ownerId: task.ownerId ?? null,
    lastOwnerId: task.lastOwnerId ?? null,
    claimedPaths: stringArray(task.claimedPaths),
    verification: latestVerificationEntries(task),
    artifacts: collectTaskArtifacts(task),
    releaseCheck,
  };
}

function buildPrSummary(argv = []) {
  const board = readJsonSafe(getCoordinationPaths().boardPath, { tasks: [] });
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const requestedIds = getPositionals(argv, new Set(['--title', '--out-dir'])).filter((entry) => !['true', 'false'].includes(entry));
  const requestedSet = new Set(requestedIds);
  const selected = requestedSet.size
    ? tasks.filter((task) => requestedSet.has(task.id))
    : tasks.filter((task) => TERMINAL_STATUSES.has(task.status));
  const fallbackSelected = selected.length ? selected : tasks.filter((task) => ACTIVE_STATUSES.has(task.status) || task.status === 'handoff' || task.status === 'review');
  const describedTasks = fallbackSelected.map((task) => describeTaskForPr(task, board));
  const activeFollowUps = tasks.filter((task) => !TERMINAL_STATUSES.has(task.status)).map((task) => ({ id: task.id, status: task.status || 'unknown', title: taskDisplayTitle(task), ownerId: task.ownerId ?? null }));
  const risks = describedTasks.flatMap((task) => task.releaseCheck.findings.map((finding) => `${task.id}: ${finding}`));
  return {
    title: getFlagValue(argv, '--title', board.projectName || path.basename(ROOT)),
    boardUpdatedAt: board.updatedAt || null,
    tasks: describedTasks,
    git: getGitSnapshot(loadConfig().config),
    risks,
    followUps: activeFollowUps,
  };
}

function renderPrSummary(summary) {
  const changes = summary.tasks.length
    ? summary.tasks.map((task) => `- ${task.id}: ${task.summary || task.title} (${task.status})${task.claimedPaths.length ? `; paths: ${task.claimedPaths.join(', ')}` : ''}`).join('\n')
    : '- No completed or active tasks found.';
  const verification = summary.tasks.flatMap((task) => {
    if (!task.verification.length) return [`- ${task.id}: no verification recorded`];
    return task.verification.map((entry) => {
      const artifacts = Array.isArray(entry.artifacts) && entry.artifacts.length ? `; artifacts: ${entry.artifacts.map((artifact) => artifact.path).join(', ')}` : '';
      return `- ${task.id}: ${entry.check} ${entry.outcome || entry.status || 'unknown'}${entry.details ? ` - ${entry.details}` : ''}${artifacts}`;
    });
  }).join('\n');
  const risks = summary.risks.length ? summary.risks.map((entry) => `- ${entry}`).join('\n') : '- None identified by release checks.';
  const followUps = summary.followUps.length ? summary.followUps.map((task) => `- ${task.id}: ${task.title} (${task.status}${task.ownerId ? `, ${task.ownerId}` : ''})`).join('\n') : '- None.';
  return [`# PR Summary: ${summary.title}`, '', '## Changes', '', changes, '', '## Verification', '', verification, '', '## Risks', '', risks, '', '## Follow-ups', '', followUps].join('\n');
}

function runPrSummary(argv) {
  const summary = buildPrSummary(argv);
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(summary, null, 2));
  else console.log(renderPrSummary(summary));
  return 0;
}

function runReleaseBundle(argv) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const outputRoot = resolveRepoPath(getFlagValue(argv, '--out-dir', ''), path.join('artifacts', 'releases', fileTimestamp()));
  const prSummary = buildPrSummary(argv);
  const releaseCheck = buildReleaseCheckReport(argv);
  const artifactItems = buildArtifactItems();
  const files = [
    { name: 'pr-summary.md', path: path.join(outputRoot, 'pr-summary.md'), content: renderPrSummary(prSummary) },
    { name: 'board-summary.md', path: path.join(outputRoot, 'board-summary.md'), content: buildBoardSummary() },
    { name: 'release-check.json', path: path.join(outputRoot, 'release-check.json'), content: `${JSON.stringify(releaseCheck, null, 2)}\n` },
    { name: 'artifacts.json', path: path.join(outputRoot, 'artifacts.json'), content: `${JSON.stringify({ items: artifactItems }, null, 2)}\n` },
  ];
  if (apply) {
    fs.mkdirSync(outputRoot, { recursive: true });
    for (const file of files) fs.writeFileSync(file.path, file.content);
  }
  const result = { ok: releaseCheck.ok, applied: apply, outputRoot, files: files.map((file) => ({ name: file.name, path: file.path })), releaseCheck };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(apply ? `Release bundle written to ${normalizePath(outputRoot) || outputRoot}.` : `Release bundle dry run for ${normalizePath(outputRoot) || outputRoot}.`);
    console.log(files.map((file) => `- ${normalizePath(file.path) || file.path}`).join('\n'));
  }
  return releaseCheck.ok ? 0 : 1;
}

function buildSummaryData({ staleHours = DEFAULT_STALE_TASK_HOURS } = {}) {
  const paths = getCoordinationPaths();
  const board = readJsonSafe(paths.boardPath, { tasks: [] });
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const active = tasks.filter((task) => ACTIVE_STATUSES.has(task.status));
  const blocked = tasks.filter((task) => task.status === 'blocked');
  const review = tasks.filter((task) => task.status === 'review');
  const planned = tasks.filter((task) => task.status === 'planned');
  const done = tasks.filter((task) => TERMINAL_STATUSES.has(task.status));
  const stale = active.filter((task) => isTaskStale(task, staleHours));
  const recentJournal = readRecentJournalLines(paths.journalPath);
  const recentMessages = readRecentMessages(paths.messagesPath);
  const nextActions = [];
  if (blocked.length) nextActions.push('Unblock blocked tasks before assigning more dependent work.');
  if (review.length) nextActions.push('Review or verify tasks already in review.');
  if (stale.length) nextActions.push('Refresh stale active tasks with progress notes or handoff them.');
  if (!active.length && planned.length) nextActions.push('Claim the next planned task with narrow paths.');
  if (!nextActions.length) nextActions.push('No urgent coordination action detected.');
  return { paths, board, tasks, active, blocked, review, planned, done, stale, recentJournal, recentMessages, nextActions };
}

function buildBoardSummary({ forChat = false, staleHours = DEFAULT_STALE_TASK_HOURS } = {}) {
  const data = buildSummaryData({ staleHours });
  const updatedAt = data.board.updatedAt || data.board.lastUpdatedAt || 'unknown';
  if (forChat) return [`Coordination summary for ${data.board.projectName || path.basename(ROOT)}`, `Updated: ${updatedAt}`, `Active: ${data.active.length}; Blocked: ${data.blocked.length}; Review: ${data.review.length}; Planned: ${data.planned.length}; Done/Released: ${data.done.length}; Stale: ${data.stale.length}`, data.active.length ? `Active work:\n${data.active.map(taskSummary).join('\n')}` : 'Active work: none', data.blocked.length ? `Blockers:\n${data.blocked.map(taskSummary).join('\n')}` : 'Blockers: none', data.review.length ? `Needs review:\n${data.review.map(taskSummary).join('\n')}` : 'Needs review: none', data.stale.length ? `Stale work:\n${data.stale.map(taskSummary).join('\n')}` : 'Stale work: none', `Next actions:\n${data.nextActions.map((entry) => `- ${entry}`).join('\n')}`].join('\n');
  return ['# Board Summary', '', `Project: ${data.board.projectName || path.basename(ROOT)}`, `Coordination root: ${normalizePath(data.paths.coordinationRoot) || data.paths.coordinationRoot}`, `Updated: ${updatedAt}`, '', '## Counts', '', `- Planned: ${data.planned.length}`, `- Active-like: ${data.active.length}`, `- Blocked: ${data.blocked.length}`, `- Review: ${data.review.length}`, `- Done/released: ${data.done.length}`, `- Stale active: ${data.stale.length}`, '', '## Active Work', '', data.active.length ? data.active.map(taskSummary).join('\n') : '- None', '', '## Blockers', '', data.blocked.length ? data.blocked.map(taskSummary).join('\n') : '- None', '', '## Review Queue', '', data.review.length ? data.review.map(taskSummary).join('\n') : '- None', '', '## Stale Work', '', data.stale.length ? data.stale.map(taskSummary).join('\n') : '- None', '', '## Next Planned', '', data.planned.slice(0, 10).length ? data.planned.slice(0, 10).map(taskSummary).join('\n') : '- None', '', '## Next Actions', '', data.nextActions.map((entry) => `- ${entry}`).join('\n'), '', '## Recent Journal', '', data.recentJournal.length ? data.recentJournal.map((entry) => `- ${entry}`).join('\n') : '- None', '', '## Recent Messages', '', data.recentMessages.length ? data.recentMessages.join('\n') : '- None'].join('\n');
}

function doctorJson({ includeFixes = false } = {}) {
  const fixes = includeFixes ? doctorFix() : [];
  const { configPath, config } = loadConfig();
  const configValidation = validateAgentConfig(config, { root: ROOT });
  const { packageJson } = loadPackageJson();
  const configSuggestions = buildConfigSuggestions(config, configValidation, packageJson);
  const paths = getCoordinationPaths();
  const git = getGitSnapshot(config);
  const result = { ok: configValidation.valid && git.errors.length === 0, projectName: config.projectName || path.basename(ROOT), root: ROOT, coordinationRoot: paths.coordinationRoot, configPath, configValidation, configSuggestions, git, files: { board: fs.existsSync(paths.boardPath), journal: fs.existsSync(paths.journalPath), messages: fs.existsSync(paths.messagesPath), runtime: fs.existsSync(paths.runtimeRoot), tasks: fs.existsSync(paths.tasksRoot) } };
  if (includeFixes) result.fixes = fixes;
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

function getTaskById(taskId) {
  const { boardPath } = getCoordinationPaths();
  const board = readJsonSafe(boardPath, { tasks: [] });
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  return tasks.find((task) => task.id === taskId) || null;
}

function latestVerificationByCheck(task) {
  const map = new Map();
  for (const entry of Array.isArray(task?.verificationLog) ? task.verificationLog : []) {
    if (entry?.check) map.set(entry.check, entry.outcome || entry.status || null);
  }
  return map;
}

function assertFinishGates(taskId, argv) {
  const requireVerification = argv.includes('--require-verification');
  const requireDocs = argv.includes('--require-doc-review');
  if (!requireVerification && !requireDocs) return { ok: true };
  const task = getTaskById(taskId);
  if (!task) return { ok: false, message: `Cannot enforce finish gates because task ${taskId} was not found.` };
  if (requireDocs && !task.docsReviewedAt) return { ok: false, message: `Task ${taskId} has not recorded docsReviewedAt.` };
  if (requireVerification) {
    const requiredChecks = Array.isArray(task.verification) ? task.verification : [];
    const latest = latestVerificationByCheck(task);
    const missing = requiredChecks.filter((check) => latest.get(check) !== 'pass');
    if (missing.length) return { ok: false, message: `Task ${taskId} is missing passing verification for: ${missing.join(', ')}.` };
  }
  return { ok: true };
}

function parseLifecycleRest(rest) {
  const messageParts = [];
  const flags = {};
  const booleanFlags = new Set(['--require-verification', '--require-doc-review']);
  const valuedFlags = new Set(['--paths']);
  for (let index = 0; index < rest.length; index += 1) {
    const entry = rest[index];
    if (!entry.startsWith('--')) {
      messageParts.push(entry);
      continue;
    }
    if (valuedFlags.has(entry)) {
      flags[entry.slice(2)] = rest[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (booleanFlags.has(entry)) {
      flags[entry.slice(2)] = true;
      continue;
    }
    if (rest[index + 1] && !rest[index + 1].startsWith('--')) {
      flags[entry.slice(2)] = rest[index + 1];
      index += 1;
    } else {
      flags[entry.slice(2)] = true;
    }
  }
  return { flags, message: messageParts.join(' ').trim() };
}

function runLifecycle(commandName, argv, coordinatorScriptPath) {
  const [agentId, taskId, ...rest] = argv;
  if (!agentId || !taskId) { console.error(`Usage: ${commandName} <agent-id> <task-id> [message] [--paths path[,path...]]`); return 1; }
  const { flags, message } = parseLifecycleRest(rest);
  const run = (args) => spawnSync(process.execPath, [coordinatorScriptPath, ...args], { cwd: ROOT, stdio: 'inherit', env: process.env }).status ?? 1;
  if (commandName === 'start') {
    const paths = flags.paths || '';
    const args = ['claim', agentId, taskId];
    if (paths) args.push('--paths', paths);
    if (message) args.push('--summary', message);
    const status = run(args);
    if (status !== 0) return status;
    return message ? run(['progress', agentId, taskId, message]) : 0;
  }
  if (commandName === 'finish') {
    const gate = assertFinishGates(taskId, rest);
    if (!gate.ok) { console.error(gate.message); return 1; }
    return run(['done', agentId, taskId, message || 'Finished implementation.']);
  }
  if (commandName === 'handoff-ready') return run(['handoff', agentId, taskId, message || 'Ready for handoff.']);
  return 1;
}

function runLockCommand(commandName, argv) {
  const translated = commandName === 'lock-status' ? ['status', ...argv] : ['clear', ...argv];
  if (!translated.includes('--coordination-root') && !translated.includes('--coordination-dir')) translated.push('--coordination-root', resolveCoordinationRoot());
  return runLockRuntimeCli(translated);
}

function shouldHandle(commandName, argv) {
  if (COMMAND_LAYER_COMMANDS.has(commandName)) return true;
  if (commandName === 'doctor' && (argv.includes('--fix') || argv.includes('--json'))) return true;
  if (commandName === 'validate' && argv.includes('--json')) return true;
  if (commandName === 'summarize') return true;
  if (commandName === 'watch-start') return true;
  if (commandName === 'lock-status' || commandName === 'lock-clear') return true;
  if (VALID_LIFECYCLE_COMMANDS.has(commandName)) return true;
  return false;
}

export async function runCommandLayer({ coordinatorScriptPath, importCore }) {
  const argv = process.argv.slice(2);
  const rawCommandName = argv[0] || 'help';
  const commandName = COMMAND_ALIASES.get(rawCommandName) || rawCommandName;
  if (commandName !== rawCommandName) process.argv[2] = commandName;
  const commandArgs = argv.slice(1);
  const normalizedCoordinatorPath = resolveRepoPath(coordinatorScriptPath, 'scripts/agent-coordination.mjs');

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
      const data = buildSummaryData();
      console.log(JSON.stringify({ summary: buildBoardSummary({ forChat: commandArgs.includes('--for-chat') }), board: data.board, counts: { active: data.active.length, blocked: data.blocked.length, review: data.review.length, planned: data.planned.length, done: data.done.length, stale: data.stale.length }, nextActions: data.nextActions, recentJournal: data.recentJournal, recentMessages: data.recentMessages }, null, 2));
    } else console.log(buildBoardSummary({ forChat: commandArgs.includes('--for-chat') }));
  } else if (commandName === 'watch-start') status = runWatchStart(commandArgs, normalizedCoordinatorPath);
  else if (commandName === 'lock-status' || commandName === 'lock-clear') status = runLockCommand(commandName, commandArgs);
  else if (VALID_LIFECYCLE_COMMANDS.has(commandName)) status = runLifecycle(commandName, commandArgs, normalizedCoordinatorPath);
  else if (commandName === 'watch-diagnose') status = runWatchDiagnose(commandArgs);
  else if (commandName === 'cleanup-runtime') status = runCleanupRuntime(commandArgs);
  else if (commandName === 'release-check') status = runReleaseCheck(commandArgs);
  else if (commandName === 'inspect-board') status = runInspectBoard(commandArgs);
  else if (commandName === 'repair-board') status = runRepairBoard(commandArgs);
  else if (commandName === 'rollback-state') status = runRollbackState(commandArgs);
  else if (commandName === 'run-check') status = runCheckCommand(commandArgs);
  else if (commandName === 'artifacts') status = runArtifactsCommand(commandArgs);
  else if (commandName === 'graph') status = runDependencyGraph(commandArgs);
  else if (commandName === 'ownership-map') status = runOwnershipMap(commandArgs);
  else if (commandName === 'pr-summary') status = runPrSummary(commandArgs);
  else if (commandName === 'release-bundle') status = runReleaseBundle(commandArgs);
  else if (commandName === 'migrate-config') status = runMigrateConfig(commandArgs);
  else if (commandName === 'policy-packs') status = runPolicyPacks(commandArgs);
  process.exit(status);
}
