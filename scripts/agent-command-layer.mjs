import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { validateAgentConfig, readJsonFile } from './validate-config.mjs';
import { runCli as runLockRuntimeCli } from './lock-runtime.mjs';
import { hasFlag, getFlagValue, getNumberFlag, getPositionals } from './lib/args-utils.mjs';
import { runAskCommand } from './lib/ask-commands.mjs';
import { runArchiveCompleted } from './lib/archive-commands.mjs';
import { appendAuditLog, auditLogPath } from './lib/audit-log.mjs';
import { runBacklogImport } from './lib/backlog-import-commands.mjs';
import { runChangelogCommand } from './lib/changelog-commands.mjs';
import { createArtifactCommands } from './lib/artifact-commands.mjs';
import { runCompletionsCommand } from './lib/completion-commands.mjs';
import { runBranchStatus } from './lib/branch-commands.mjs';
import { createStarterBoard } from './lib/board-migration.mjs';
import { runInspectBoard, runMigrateBoard, runRepairBoard, runRollbackState } from './lib/board-maintenance.mjs';
import { exitCodeForError, printCliError, printCommandError } from './lib/error-formatting.mjs';
import { appendUniqueLines, ensureFile, fileTimestamp, hoursSince, nowIso, readJsonSafe, writeJson } from './lib/file-utils.mjs';
import { DEFAULT_GIT_POLICY, getGitSnapshot } from './lib/git-utils.mjs';
import { runGitHubStatus } from './lib/github-commands.mjs';
import { hasHelpFlag, runCommandHelp } from './lib/help-command.mjs';
import { runOwnershipReview, runTestImpact } from './lib/impact-commands.mjs';
import { buildOnboardingChecklist } from './lib/onboarding-checklist.mjs';
import { writePackageScripts } from './lib/package-json-utils.mjs';
import { normalizePath, resolveConfigPath, resolveCoordinationRoot, resolveRepoPath } from './lib/path-utils.mjs';
import { runPromptCommand } from './lib/prompt-commands.mjs';
import { runCleanupRuntime, runWatchDiagnose } from './lib/runtime-diagnostics.mjs';
import { withStateTransactionSync } from './lib/state-transaction.mjs';
import { taskMetadataLabels } from './lib/task-metadata.mjs';
import { runTemplates } from './lib/template-commands.mjs';
import { runUpdateCoordinator } from './lib/update-commands.mjs';
import { runSnapshotWorkspace, writePreMutationWorkspaceSnapshot } from './lib/workspace-snapshot-commands.mjs';

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
  'migrate-board',
  'rollback-state',
  'run-check',
  'artifacts',
  'graph',
  'ownership-map',
  'pr-summary',
  'release-bundle',
  'migrate-config',
  'policy-packs',
  'branches',
  'ownership-review',
  'test-impact',
  'github-status',
  'templates',
  'archive-completed',
  'update-coordinator',
  'snapshot-workspace',
  'backlog-import',
  'prompt',
  'ask',
  'changelog',
  'completions',
]);
const COMMAND_ALIASES = new Map([
  ['s', 'status'],
  ['d', 'doctor'],
  ['p', 'plan'],
  ['sum', 'summarize'],
]);
const DEFAULT_STALE_TASK_HOURS = 6;
const DEFAULT_RECENT_CONTEXT_LINES = 8;
const CHECK_COMMAND = 'node ./scripts/check-syntax.mjs';
const CURRENT_CONFIG_VERSION = 1;
const DEFAULT_ARTIFACT_POLICY = { roots: ['artifacts'], keepDays: 14, keepFailedDays: 45, maxMb: 500, protectPatterns: [] };
const DEFAULT_CAPACITY_POLICY = { maxActiveTasksPerAgent: 1, maxBlockedTasksPerAgent: 1, preferredDomainsByAgent: {}, enforcePreferredDomains: false };
const DEFAULT_CONFLICT_PREDICTION = { enabled: true, blockOnGitOverlap: true };
const DEFAULT_OWNERSHIP_POLICY = { codeownersFiles: ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'], broadPathPatterns: ['app', 'src', 'components', 'features', 'lib', 'api', 'server', 'packages'] };
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
const { buildArtifactItems, collectTaskArtifacts, runArtifactsCommand } = createArtifactCommands({
  activeStatuses: ACTIVE_STATUSES,
  defaultArtifactPolicy: DEFAULT_ARTIFACT_POLICY,
  fileTimestamp,
  getCoordinationPaths,
  getFlagValue,
  getNumberFlag,
  getPositionals,
  hasFlag,
  loadConfig,
  normalizePath,
  readJsonSafe,
  resolveRepoPath,
  root: ROOT,
  stringArray,
});

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

function getBoardMaintenanceContext() {
  const { config } = loadConfig();
  return {
    root: ROOT,
    paths: getCoordinationPaths(),
    config,
    defaultAgentIds: DEFAULT_AGENT_IDS,
    validTaskStatuses: VALID_TASK_STATUSES,
    activeStatuses: ACTIVE_STATUSES,
  };
}

function getBranchCommandContext() {
  const { config } = loadConfig();
  return {
    root: ROOT,
    config,
    board: readJsonSafe(getCoordinationPaths().boardPath, { tasks: [] }),
    activeStatuses: ACTIVE_STATUSES,
  };
}

function getImpactCommandContext() {
  const { config } = loadConfig();
  const { packageJson } = loadPackageJson();
  return {
    root: ROOT,
    config,
    packageJson,
    board: readJsonSafe(getCoordinationPaths().boardPath, { tasks: [] }),
    activeStatuses: ACTIVE_STATUSES,
  };
}

function getGitHubCommandContext() {
  return { root: ROOT };
}

function getTemplateCommandContext() {
  const { configPath, config } = loadConfig();
  const paths = getCoordinationPaths();
  return {
    root: ROOT,
    configPath,
    config,
    paths,
    board: readJsonSafe(paths.boardPath, { tasks: [] }),
  };
}

function getBacklogImportContext() {
  const { config } = loadConfig();
  return {
    root: ROOT,
    config,
    paths: getCoordinationPaths(),
    defaultAgentIds: DEFAULT_AGENT_IDS,
  };
}

function getPromptCommandContext() {
  const paths = getCoordinationPaths();
  return {
    root: ROOT,
    paths,
    board: readJsonSafe(paths.boardPath, { tasks: [], agents: [] }),
  };
}

function getAskCommandContext() {
  const paths = getCoordinationPaths();
  return {
    root: ROOT,
    paths,
    board: readJsonSafe(paths.boardPath, { tasks: [], agents: [] }),
  };
}

function getCompletionsCommandContext() {
  const { config } = loadConfig();
  const paths = getCoordinationPaths();
  return {
    root: ROOT,
    paths,
    config,
    board: readJsonSafe(paths.boardPath, { tasks: [], agents: [] }),
  };
}

function createStarterConfig(configPath) {
  writeJson(configPath, {
    configVersion: 1,
    projectName: path.basename(ROOT),
    agentIds: DEFAULT_AGENT_IDS,
    docs: { roots: ['docs'], appNotes: 'docs/ai-agent-app-notes.md', visualWorkflow: '', apiPrefixes: ['docs/api'] },
    git: DEFAULT_GIT_POLICY,
    capacity: DEFAULT_CAPACITY_POLICY,
    conflictPrediction: DEFAULT_CONFLICT_PREDICTION,
    ownership: DEFAULT_OWNERSHIP_POLICY,
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
    && fs.existsSync(path.join(ROOT, 'scripts', 'agent-command-layer.mjs'))
    && fs.existsSync(path.join(ROOT, 'scripts', 'agent-coordination.mjs'))
    && fs.existsSync(path.join(ROOT, 'scripts', 'agent-coordination-two.mjs'))
    && fs.existsSync(path.join(ROOT, 'scripts', 'check-syntax.mjs'))
    && fs.existsSync(path.join(ROOT, 'scripts', 'lib'));
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
      'agents:board:migrate': 'ai-agents migrate-board',
      'agents:state:rollback': 'ai-agents rollback-state',
      'agents:run-check': 'ai-agents run-check',
      'agents:branches': 'ai-agents branches',
      'agents:ownership:review': 'ai-agents ownership-review',
      'agents:test-impact': 'ai-agents test-impact',
      'agents:github:status': 'ai-agents github-status',
      'agents:templates': 'ai-agents templates',
      'agents:archive:completed': 'ai-agents archive-completed',
      'agents:update': 'ai-agents update-coordinator',
      'agents:snapshot:workspace': 'ai-agents snapshot-workspace',
      'agents:backlog:import': 'ai-agents backlog-import',
      'agents:prompt': 'ai-agents prompt',
      'agents:ask': 'ai-agents ask',
      'agents:changelog': 'ai-agents changelog',
      'agents:prioritize': 'ai-agents prioritize',
      'agents:approvals': 'ai-agents approvals',
      'agents:completions': 'ai-agents completions',
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
    'agents:board:migrate': 'node ./scripts/agent-coordination.mjs migrate-board',
    'agents:state:rollback': 'node ./scripts/agent-coordination.mjs rollback-state',
    'agents:run-check': 'node ./scripts/agent-coordination.mjs run-check',
    'agents:branches': 'node ./scripts/agent-coordination.mjs branches',
    'agents:ownership:review': 'node ./scripts/agent-coordination.mjs ownership-review',
    'agents:test-impact': 'node ./scripts/agent-coordination.mjs test-impact',
    'agents:github:status': 'node ./scripts/agent-coordination.mjs github-status',
    'agents:templates': 'node ./scripts/agent-coordination.mjs templates',
    'agents:archive:completed': 'node ./scripts/agent-coordination.mjs archive-completed',
    'agents:update': 'node ./scripts/agent-coordination.mjs update-coordinator',
    'agents:snapshot:workspace': 'node ./scripts/agent-coordination.mjs snapshot-workspace',
    'agents:backlog:import': 'node ./scripts/agent-coordination.mjs backlog-import',
    'agents:prompt': 'node ./scripts/agent-coordination.mjs prompt',
    'agents:ask': 'node ./scripts/agent-coordination.mjs ask',
    'agents:changelog': 'node ./scripts/agent-coordination.mjs changelog',
    'agents:prioritize': 'node ./scripts/agent-coordination.mjs prioritize',
    'agents:approvals': 'node ./scripts/agent-coordination.mjs approvals',
    'agents:completions': 'node ./scripts/agent-coordination.mjs completions',
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
    'agents2:board:migrate': 'node ./scripts/agent-coordination-two.mjs migrate-board',
    'agents2:state:rollback': 'node ./scripts/agent-coordination-two.mjs rollback-state',
    'agents2:run-check': 'node ./scripts/agent-coordination-two.mjs run-check',
    'agents2:branches': 'node ./scripts/agent-coordination-two.mjs branches',
    'agents2:ownership:review': 'node ./scripts/agent-coordination-two.mjs ownership-review',
    'agents2:test-impact': 'node ./scripts/agent-coordination-two.mjs test-impact',
    'agents2:github:status': 'node ./scripts/agent-coordination-two.mjs github-status',
    'agents2:templates': 'node ./scripts/agent-coordination-two.mjs templates',
    'agents2:archive:completed': 'node ./scripts/agent-coordination-two.mjs archive-completed',
    'agents2:update': 'node ./scripts/agent-coordination-two.mjs update-coordinator',
    'agents2:snapshot:workspace': 'node ./scripts/agent-coordination-two.mjs snapshot-workspace',
    'agents2:backlog:import': 'node ./scripts/agent-coordination-two.mjs backlog-import',
    'agents2:prompt': 'node ./scripts/agent-coordination-two.mjs prompt',
    'agents2:ask': 'node ./scripts/agent-coordination-two.mjs ask',
    'agents2:changelog': 'node ./scripts/agent-coordination-two.mjs changelog',
    'agents2:prioritize': 'node ./scripts/agent-coordination-two.mjs prioritize',
    'agents2:approvals': 'node ./scripts/agent-coordination-two.mjs approvals',
    'agents2:completions': 'node ./scripts/agent-coordination-two.mjs completions',
    'validate:agents-config': 'node ./scripts/validate-config.mjs',
  };
}

function doctorFix() {
  const fixes = [];
  const { configPath, config } = loadConfig();
  const paths = getCoordinationPaths();
  if (!fs.existsSync(configPath)) { createStarterConfig(configPath); fixes.push(`created ${normalizePath(configPath)}`); }
  if (appendUniqueLines(path.join(ROOT, '.gitignore'), ['', '# Local AI agent coordination runtime state', '/coordination/', '/coordination-two/', '/artifacts/'])) fixes.push('updated .gitignore');
  if (ensureFile(path.join(ROOT, 'docs', 'ai-agent-app-notes.md'), '# AI Agent App Notes\n\n## Agent-Maintained Notes\n\n')) fixes.push('created docs/ai-agent-app-notes.md');
  for (const dir of [paths.coordinationRoot, paths.tasksRoot, paths.runtimeRoot, paths.heartbeatsRoot]) {
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); fixes.push(`created ${normalizePath(dir)}`); }
  }
  if (!fs.existsSync(paths.boardPath)) { writeJson(paths.boardPath, createStarterBoard({ config, root: ROOT, paths, defaultAgentIds: DEFAULT_AGENT_IDS })); fixes.push(`created ${normalizePath(paths.boardPath)}`); }
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

function taskSummary(task) {
  const owner = task.ownerId || task.suggestedOwnerId || 'unowned';
  const title = task.title || task.summary || task.id;
  const paths = Array.isArray(task.claimedPaths) && task.claimedPaths.length ? ` paths: ${task.claimedPaths.join(', ')}` : '';
  const labels = taskMetadataLabels(task);
  const metadata = labels.length ? ` ${labels.join(', ')}` : '';
  return `- ${task.id}: ${title} [${task.status || 'unknown'} / ${owner}]${metadata}${paths}`;
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
    for (const check of result.checks) {
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
    dryRun: hasFlag(before, '--dry-run'),
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
      return printCommandError(`No command provided and package.json has no "${args.name}" script.`, { json: args.json });
    }
    command = [process.platform === 'win32' ? 'npm.cmd' : 'npm', 'run', args.name];
  }
  if (args.dryRun) {
    const result = { ok: true, applied: false, name: args.name, command };
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Dry run: would run ${command.join(' ')} and capture check artifacts.`);
    return 0;
  }
  const startedAt = nowIso();
  const result = spawnSync(command[0], command.slice(1), { cwd: ROOT, encoding: 'utf8', shell: false });
  const finishedAt = nowIso();
  const exitCode = result.error ? 1 : result.status ?? 0;
  const paths = getCoordinationPaths();
  const artifactRoot = args.artifactDir ? resolveRepoPath(args.artifactDir, args.artifactDir) : paths.artifactsRoot;
  const artifactPath = path.join(artifactRoot, `${fileTimestamp()}-${sanitizeArtifactName(args.name)}.log`);
  const stdout = result.stdout || '';
  const stderr = result.stderr || (result.error ? result.error.message : '');
  const artifactIndexPath = path.join(artifactRoot, 'index.ndjson');
  const indexEntry = { name: args.name, command, startedAt, finishedAt, exitCode, artifactPath };
  withStateTransactionSync([artifactRoot], () => {
    fs.mkdirSync(artifactRoot, { recursive: true });
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
    fs.mkdirSync(path.dirname(artifactIndexPath), { recursive: true });
    fs.appendFileSync(artifactIndexPath, `${JSON.stringify(indexEntry)}\n`);
  });
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
    git: DEFAULT_GIT_POLICY,
    capacity: DEFAULT_CAPACITY_POLICY,
    conflictPrediction: DEFAULT_CONFLICT_PREDICTION,
    ownership: DEFAULT_OWNERSHIP_POLICY,
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
    return printCommandError(`Config not found: ${configPath}`, { json });
  }
  const migrated = buildMigratedConfig(config);
  const changes = diffConfig(config, migrated);
  const validation = validateAgentConfig(migrated, { root: ROOT });
  const result = { ok: validation.valid, applied: false, configPath, targetVersion: CURRENT_CONFIG_VERSION, changes, validation, snapshotPath: null, workspaceSnapshotPath: null };
  if (apply && validation.valid && changes.length) {
    const paths = getCoordinationPaths();
    withStateTransactionSync([configPath, paths.snapshotsRoot, auditLogPath(paths)], () => {
      result.workspaceSnapshotPath = writePreMutationWorkspaceSnapshot(paths, 'migrate-config');
      result.snapshotPath = snapshotConfig(configPath);
      writeJson(configPath, migrated);
      appendAuditLog(paths, {
        command: 'migrate-config',
        applied: true,
        summary: `Applied ${changes.length} config migration change(s).`,
        details: { changes: changes.map((entry) => entry.path), snapshotPath: result.snapshotPath, workspaceSnapshotPath: result.workspaceSnapshotPath },
      });
    });
    result.applied = true;
  }
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(apply ? 'Config migration applied.' : 'Config migration dry run.');
    console.log(changes.length ? changes.map((change) => `- ${change.path}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`).join('\n') : '- no changes needed');
    if (!validation.valid) console.log(`Validation errors:\n${validation.errors.map((entry) => `- ${entry}`).join('\n')}`);
    if (result.workspaceSnapshotPath) console.log(`Workspace snapshot: ${normalizePath(result.workspaceSnapshotPath) || result.workspaceSnapshotPath}`);
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
      return printCommandError(`Unknown policy pack: ${name || ''}`, { json, code: 'not_found' });
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
      return printCommandError('Usage: policy-packs apply <pack[,pack...]> [--apply] [--json]', { json });
    }
    const result = buildPolicyPackResult(packNames);
    result.applied = false;
    result.snapshotPath = null;
    result.workspaceSnapshotPath = null;
    if (apply && result.ok && result.changes.length) {
      const paths = getCoordinationPaths();
      withStateTransactionSync([result.configPath, paths.snapshotsRoot, auditLogPath(paths)], () => {
        result.workspaceSnapshotPath = writePreMutationWorkspaceSnapshot(paths, `policy-packs-${packNames.join('-')}`);
        result.snapshotPath = snapshotConfig(result.configPath);
        writeJson(result.configPath, result.nextConfig);
        appendAuditLog(paths, {
          command: 'policy-packs apply',
          applied: true,
          summary: `Applied policy pack(s): ${packNames.join(', ')}.`,
          details: { packs: packNames, changes: result.changes.map((entry) => entry.path), snapshotPath: result.snapshotPath, workspaceSnapshotPath: result.workspaceSnapshotPath },
        });
      });
      result.applied = true;
    }
    delete result.nextConfig;
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(apply ? 'Policy pack apply completed.' : 'Policy pack dry run.');
      if (result.unknown.length) console.log(`Unknown packs: ${result.unknown.join(', ')}`);
      console.log(result.changes.length ? result.changes.map((change) => `- ${change.path}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`).join('\n') : '- no changes needed');
      if (!result.validation.valid) console.log(`Validation errors:\n${result.validation.errors.map((entry) => `- ${entry}`).join('\n')}`);
      if (result.workspaceSnapshotPath) console.log(`Workspace snapshot: ${normalizePath(result.workspaceSnapshotPath) || result.workspaceSnapshotPath}`);
      if (result.snapshotPath) console.log(`Snapshot: ${normalizePath(result.snapshotPath) || result.snapshotPath}`);
    }
    return result.ok ? 0 : 1;
  }

  return printCommandError('Usage: policy-packs list [--json] | policy-packs inspect <pack> [--json] | policy-packs apply <pack[,pack...]> [--apply] [--json]', { json });
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
    git: getGitSnapshot({ root: ROOT, config: loadConfig().config }),
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
    withStateTransactionSync([outputRoot], () => {
      fs.mkdirSync(outputRoot, { recursive: true });
      for (const file of files) fs.writeFileSync(file.path, file.content);
    });
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
  const onboardingChecklist = buildOnboardingChecklist({ root: ROOT, config, packageJson });
  const paths = getCoordinationPaths();
  const git = getGitSnapshot({ root: ROOT, config });
  const result = { ok: configValidation.valid && git.errors.length === 0, projectName: config.projectName || path.basename(ROOT), root: ROOT, coordinationRoot: paths.coordinationRoot, configPath, configValidation, configSuggestions, onboardingChecklist, git, files: { board: fs.existsSync(paths.boardPath), journal: fs.existsSync(paths.journalPath), messages: fs.existsSync(paths.messagesPath), runtime: fs.existsSync(paths.runtimeRoot), tasks: fs.existsSync(paths.tasksRoot) } };
  if (includeFixes) result.fixes = fixes;
  return result;
}

function runDoctorJson(argv) {
  const result = doctorJson({ includeFixes: argv.includes('--fix') });
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

function runDoctorFix() {
  const { configPath } = loadConfig();
  const paths = getCoordinationPaths();
  const { packageJsonPath } = loadPackageJson();
  const fixes = withStateTransactionSync([
    configPath,
    path.join(ROOT, '.gitignore'),
    path.join(ROOT, 'docs', 'ai-agent-app-notes.md'),
    paths.coordinationRoot,
    packageJsonPath,
  ], () => doctorFix());
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
    else printCommandError(`Config invalid: ${normalizePath(configPath) || configPath}\n${result.errors.map((error) => `- ${error}`).join('\n')}`, { code: 'validation_error' });
  }
  return result.valid ? 0 : 1;
}

function runGitPreflightForClaim() {
  const { config } = loadConfig();
  const git = getGitSnapshot({ root: ROOT, config });
  for (const warning of git.warnings) console.warn(`git warning: ${warning}`);
  if (git.branch) console.warn(`git branch: ${git.branch}${git.upstream ? ` tracking ${git.upstream}` : ''}`);
  if (git.errors.length) return printCommandError(`Git preflight failed:\n${git.errors.map((error) => `- ${error}`).join('\n')}`, { code: 'git_error' });
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
  const watcherScript = resolveRepoPath(process.env.AGENT_COORDINATION_WATCH_LOOP_SCRIPT, 'scripts/agent-watch-loop.mjs');
  const intervalMs = parseInterval(argv);
  if (hasFlag(argv, '--dry-run')) {
    console.log(`Dry run: would start Node watcher for ${normalizePath(paths.coordinationRoot) || paths.coordinationRoot}.`);
    return 0;
  }
  fs.mkdirSync(paths.runtimeRoot, { recursive: true });
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

function normalizeApprovalScope(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getApprovalGateScope(argv) {
  if (!argv.includes('--require-approval')) return null;
  const index = argv.indexOf('--approval-scope');
  if (index < 0) return '';
  const next = argv[index + 1];
  return next && !next.startsWith('--') ? normalizeApprovalScope(next) : '';
}

function hasApprovedTaskApproval(taskId, scope = '') {
  const board = readJsonSafe(getCoordinationPaths().boardPath, { approvals: [] });
  const approvals = Array.isArray(board.approvals) ? board.approvals : [];
  return approvals.some((approval) =>
    approval?.taskId === taskId
    && (approval.status === 'approved' || approval.status === 'used')
    && (!scope || approval.scope === scope)
  );
}

function assertFinishGates(taskId, argv) {
  const requireVerification = argv.includes('--require-verification');
  const requireDocs = argv.includes('--require-doc-review');
  const approvalScope = getApprovalGateScope(argv);
  const requireApproval = approvalScope !== null;
  if (!requireVerification && !requireDocs && !requireApproval) return { ok: true };
  const task = getTaskById(taskId);
  if (!task) return { ok: false, message: `Cannot enforce finish gates because task ${taskId} was not found.` };
  if (requireDocs && !task.docsReviewedAt) return { ok: false, message: `Task ${taskId} has not recorded docsReviewedAt.` };
  if (requireApproval && !hasApprovedTaskApproval(taskId, approvalScope)) {
    return {
      ok: false,
      message: `Task ${taskId} is missing an approved approval-ledger entry${approvalScope ? ` for scope ${approvalScope}` : ''}.`,
    };
  }
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
  const booleanFlags = new Set(['--require-verification', '--require-doc-review', '--require-approval']);
  const valuedFlags = new Set(['--paths', '--priority', '--due-at', '--due', '--severity', '--approval-scope']);
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
  const json = hasFlag(argv, '--json');
  if (!agentId || !taskId) return printCommandError(`Usage: ${commandName} <agent-id> <task-id> [message] [--paths path[,path...]]`, { json });
  const { flags, message } = parseLifecycleRest(rest);
  const run = (args) => spawnSync(process.execPath, [coordinatorScriptPath, ...args], { cwd: ROOT, stdio: 'inherit', env: process.env }).status ?? 1;
  if (commandName === 'start') {
    const paths = flags.paths || '';
    const args = ['claim', agentId, taskId];
    if (paths) args.push('--paths', paths);
    if (message) args.push('--summary', message);
    for (const flag of ['priority', 'due-at', 'due', 'severity']) {
      if (typeof flags[flag] === 'string') args.push(`--${flag}`, flags[flag]);
    }
    if (flags['dry-run']) args.push('--dry-run');
    const status = run(args);
    if (status !== 0) return status;
    if (flags['dry-run']) return status;
    return message ? run(['progress', agentId, taskId, message, ...(flags['dry-run'] ? ['--dry-run'] : [])]) : 0;
  }
  if (commandName === 'finish') {
    const gate = assertFinishGates(taskId, rest);
    if (!gate.ok) return printCommandError(gate.message, { json });
    return run(['done', agentId, taskId, message || 'Finished implementation.', ...(flags['dry-run'] ? ['--dry-run'] : [])]);
  }
  if (commandName === 'handoff-ready') return run(['handoff', agentId, taskId, message || 'Ready for handoff.', ...(flags['dry-run'] ? ['--dry-run'] : [])]);
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

async function runCommandLayerInner({ coordinatorScriptPath, importCore }) {
  const argv = process.argv.slice(2);
  const rawCommandName = argv[0] || 'help';
  if (rawCommandName === '--help' || rawCommandName === '-h') {
    process.argv = [process.argv[0], process.argv[1], 'help'];
    await importCore();
    return;
  }

  const commandName = COMMAND_ALIASES.get(rawCommandName) || rawCommandName;
  if (commandName !== rawCommandName) process.argv[2] = commandName;
  const commandArgs = argv.slice(1);
  const normalizedCoordinatorPath = resolveRepoPath(coordinatorScriptPath, 'scripts/agent-coordination.mjs');
  const cli = process.env.AGENT_COORDINATION_CLI_ENTRYPOINT || 'agents';

  if (commandName === 'help' && commandArgs[0]) {
    const helpTarget = COMMAND_ALIASES.get(commandArgs[0]) || commandArgs[0];
    process.exit(runCommandHelp(commandName, [helpTarget], { cli }));
  }

  if (hasHelpFlag(commandArgs)) {
    process.exit(runCommandHelp(commandName, commandArgs, { cli }));
  }

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
  else if (commandName === 'watch-diagnose') status = runWatchDiagnose(commandArgs, getCoordinationPaths());
  else if (commandName === 'cleanup-runtime') status = runCleanupRuntime(commandArgs, getCoordinationPaths());
  else if (commandName === 'release-check') status = runReleaseCheck(commandArgs);
  else if (commandName === 'inspect-board') status = runInspectBoard(commandArgs, getBoardMaintenanceContext());
  else if (commandName === 'repair-board') status = runRepairBoard(commandArgs, getBoardMaintenanceContext());
  else if (commandName === 'migrate-board') status = runMigrateBoard(commandArgs, getBoardMaintenanceContext());
  else if (commandName === 'rollback-state') status = runRollbackState(commandArgs, getBoardMaintenanceContext());
  else if (commandName === 'run-check') status = runCheckCommand(commandArgs);
  else if (commandName === 'artifacts') status = runArtifactsCommand(commandArgs);
  else if (commandName === 'graph') status = runDependencyGraph(commandArgs);
  else if (commandName === 'ownership-map') status = runOwnershipMap(commandArgs);
  else if (commandName === 'pr-summary') status = runPrSummary(commandArgs);
  else if (commandName === 'release-bundle') status = runReleaseBundle(commandArgs);
  else if (commandName === 'migrate-config') status = runMigrateConfig(commandArgs);
  else if (commandName === 'policy-packs') status = runPolicyPacks(commandArgs);
  else if (commandName === 'branches') status = runBranchStatus(commandArgs, getBranchCommandContext());
  else if (commandName === 'ownership-review') status = runOwnershipReview(commandArgs, getImpactCommandContext());
  else if (commandName === 'test-impact') status = runTestImpact(commandArgs, getImpactCommandContext());
  else if (commandName === 'github-status') status = runGitHubStatus(commandArgs, getGitHubCommandContext());
  else if (commandName === 'templates') status = runTemplates(commandArgs, getTemplateCommandContext());
  else if (commandName === 'archive-completed') status = runArchiveCompleted(commandArgs, getCoordinationPaths());
  else if (commandName === 'update-coordinator') status = runUpdateCoordinator(commandArgs, { root: ROOT });
  else if (commandName === 'snapshot-workspace') status = runSnapshotWorkspace(commandArgs, getCoordinationPaths());
  else if (commandName === 'backlog-import') status = runBacklogImport(commandArgs, getBacklogImportContext());
  else if (commandName === 'prompt') status = runPromptCommand(commandArgs, getPromptCommandContext());
  else if (commandName === 'ask') status = runAskCommand(commandArgs, getAskCommandContext());
  else if (commandName === 'changelog') status = runChangelogCommand(commandArgs, getCoordinationPaths());
  else if (commandName === 'completions') status = runCompletionsCommand(commandArgs, getCompletionsCommandContext());
  process.exit(status);
}

export async function runCommandLayer(options) {
  try {
    await runCommandLayerInner(options);
  } catch (error) {
    printCliError(error, { argv: process.argv.slice(2) });
    process.exit(exitCodeForError(error));
  }
}
